#!/usr/bin/env python3
"""Valida o catálogo de armas e armaduras (data/equipamentos.json) pelas regras do
Criador de Equipamentos (Apêndice 4.3) e regenera a tabela do livro
(docs/livro/04-itens-e-equipamentos.md, entre os marcadores <!-- tabela-equipamentos -->).

Uso: python3 tools/equipamentos.py          # valida e regenera
     python3 tools/equipamentos.py --check  # só valida

Formato de uma arma:
  { "id", "nome", "raridade": comum|incomum|raro|mitico, "peso": leve|medio|pesado,
    "alcance": "curto"|"distante"  (corpo a corpo)  OU  "distancia": ["L", ...] (zonas ideais),
    "recarga": 1|3|6|null (só com distancia; null = sem recarga),
    "armaDeFogo": {"limite": 10|15|20|25, "disparo": 4|3|2|1} (opcional),
    "dano": ["cortante", ...], "letal": n, "brutal": n, "bloqueio": n,
    "enriste": bool, "arremesso": bool, "aptidao": 0..3,
    "habilidades": [{"nome", "descricao", "custo": 1|2|3}] }

Formato de uma armadura:
  { "id", "nome", "raridade", "peso", "imobilidade", "protecao",
    "cobertura": [ {"tipo": "fisico2", "danos": [a, b]},     # 1 pt: proteção em 2 tipos físicos
                   {"tipo": "fisico+1", "danos": [a]},       # 1 pt: proteção +1 em 1 tipo físico
                   {"tipo": "elemental", "danos": [a]},      # 2 pts, raro+
                   {"tipo": "especial", "danos": [a]} ],     # 3 pts, mítico
    "habilidades": [...] }
"""
import json, pathlib, re, sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
DATA = ROOT / 'data/equipamentos.json'
BOOK = ROOT / 'docs/livro/04-itens-e-equipamentos.md'

PONTOS = {'comum': 3, 'incomum': 5, 'raro': 8, 'mitico': 12}
ORDEM = ['comum', 'incomum', 'raro', 'mitico']
NOME_RAR = {'comum': 'Comum', 'incomum': 'Incomum', 'raro': 'Raro', 'mitico': 'Mítico'}
MANUSEIO = {'comum': 1, 'incomum': 2, 'raro': 3, 'mitico': 5}
IMPACTO = {'leve': 1, 'medio': 2, 'pesado': 3}
NOME_PESO = {'leve': 'Leve', 'medio': 'Média', 'pesado': 'Pesada'}
FISICOS = {'cortante', 'contundente', 'compressao', 'perfurante', 'lacerante'}
ELEMENTAIS = {'gelido', 'eletrico', 'fogo', 'acido'}
ESPECIAIS = {'alma', 'veneno', 'mental', 'arcano'}
NOME_DANO = {'cortante': 'Cortante', 'contundente': 'Contundente', 'compressao': 'Compressão', 'perfurante': 'Perfurante',
             'lacerante': 'Lacerante', 'gelido': 'Gélido', 'eletrico': 'Elétrico', 'fogo': 'Fogo', 'acido': 'Ácido',
             'alma': 'Alma', 'veneno': 'Veneno', 'mental': 'Mental', 'arcano': 'Arcano'}
ZONA_CUSTO = {'C': -1, 'D': 0, 'L': 0, 'ML': 1, 'EL': 2}
APT_CUSTO = {0: 1, 1: 0, 2: -1, 3: -3}
FOGO_CUSTO = {(10, 4): 2, (15, 3): 1, (20, 2): 1, (25, 1): 1}
RECARGA_CUSTO = {1: 0, 3: 2, 6: 3, None: 4}
BASE_ARMADURA = {'leve': (1, 6), 'medio': (2, 8), 'pesado': (3, 11)}
COBERTURA_CUSTO = {'fisico2': 1, 'fisico+1': 1, 'elemental': 2, 'especial': 3}


def custo_arma(a):
    """Retorna (custo, detalhes, erros)."""
    r, det, err = a['raridade'], [], []
    rar = ORDEM.index(r)
    c = 0
    if a.get('distancia'):
        zs = a['distancia']
        z0 = ZONA_CUSTO[zs[0]]
        extra = sum(ZONA_CUSTO[z] + 1 for z in zs[1:])
        if 'C' in zs[1:]:
            err.append('zona Curto não pode ser zona adicional')
        c += z0 + extra; det.append(f'Distância({",".join(zs)}) {z0 + extra:+d}')
        rec = a.get('recarga', 1)
        rc = RECARGA_CUSTO[rec]
        if rc and rar < 1: err.append('recarga só muda a partir de incomum')
        if rec is None and rar < 2: err.append('remover recarga só em raro/mítico')
        c += rc
        if rc: det.append(f'Recarga({rec if rec else "—"}) +{rc}')
        if a.get('armaDeFogo'):
            f = a['armaDeFogo']; fc = FOGO_CUSTO[(f['limite'], f['disparo'])]
            if rar < 1: err.append('arma de fogo só a partir de incomum')
            c += fc; det.append(f'Arma de Fogo({f["limite"]})/Disparo({f["disparo"]}) +{fc}')
    else:
        if a.get('armaDeFogo') or a.get('recarga') is not None and 'recarga' in a:
            err.append('arma de fogo/recarga exigem Distância')
        if a.get('alcance') == 'distante':
            c += 1; det.append('alcance Distante +1')
    danos = a['dano']
    fis = [d for d in danos if d in FISICOS]
    ele = [d for d in danos if d in ELEMENTAIS]
    esp = [d for d in danos if d in ESPECIAIS]
    if ele:
        if rar < 2: err.append('dano elemental só em raro+')
        c += 2; det.append('dano elemental +2')
    if esp:
        if rar < 3: err.append('dano especial só em mítico')
        c += 4; det.append('dano especial +4')
    if len(fis) > (0 if (ele or esp) else 1):
        c += 1; det.append('tipos físicos extras +1')
    for k in ('letal', 'brutal', 'bloqueio'):
        n = a.get(k, 0)
        if n: c += n; det.append(f'{k.capitalize()}({n}) +{n}')
    imp = IMPACTO[a['peso']]
    b = a.get('bloqueio', 0)
    if rar <= 1 and b > imp: err.append(f'bloqueio {b} > impacto {imp}')
    if rar == 2 and b > imp + 1: err.append(f'bloqueio {b} > impacto+1')
    if a.get('enriste'):
        if a['peso'] == 'leve': err.append('enriste só em média/pesada')
        c += 2; det.append('Enriste +2')
    if a.get('arremesso'):
        if a['peso'] == 'leve': err.append('armas leves não precisam de Arremesso')
        c += 1; det.append('Arremesso +1')
    ac = APT_CUSTO[a.get('aptidao', 1)]
    c += ac
    if ac: det.append(f'aptidão {a.get("aptidao", 1)} {ac:+d}')
    for h in a.get('habilidades', []):
        if rar < 2: err.append('habilidades especiais só em raro/mítico')
        c += h['custo']; det.append(f'{h["nome"]} +{h["custo"]}')
    return c, det, err


def custo_armadura(a):
    r, det, err = a['raridade'], [], []
    rar = ORDEM.index(r)
    ib, pb = BASE_ARMADURA[a['peso']]
    c = 0
    di = ib - a['imobilidade']
    if di: c += di; det.append(f'imobilidade {ib}→{a["imobilidade"]} {di:+d}')
    if a['imobilidade'] < 0: err.append('imobilidade negativa')
    if rar <= 1 and a['imobilidade'] > 4: err.append('imobilidade > 4 em comum/incomum')
    dp = a['protecao'] - pb
    if dp < 0: err.append('proteção abaixo da base')
    if dp: c += dp; det.append(f'proteção {pb}→{a["protecao"]} +{dp}')
    if not a.get('cobertura'): err.append('armadura precisa gastar ao menos 1 ponto em cobertura')
    vistos = set()
    for cob in a.get('cobertura', []):
        t = cob['tipo']; cc = COBERTURA_CUSTO[t]
        if t == 'fisico2' and (len(cob['danos']) != 2 or not set(cob['danos']) <= FISICOS): err.append('fisico2 exige 2 tipos físicos')
        if t == 'fisico+1' and (len(cob['danos']) != 1 or not set(cob['danos']) <= FISICOS): err.append('fisico+1 exige 1 tipo físico')
        if t == 'elemental' and (rar < 2 or not set(cob['danos']) <= ELEMENTAIS): err.append('elemental: raro+ e tipo elemental')
        if t == 'especial' and (rar < 3 or not set(cob['danos']) <= ESPECIAIS): err.append('especial: mítico e tipo especial')
        if vistos & set(cob['danos']): err.append(f'tipo repetido na cobertura: {vistos & set(cob["danos"])}')
        vistos |= set(cob['danos'])
        c += cc; det.append(f'cobertura {"/".join(NOME_DANO[d] for d in cob["danos"])} +{cc}')
    for h in a.get('habilidades', []):
        if rar < 2: err.append('habilidades especiais só em raro/mítico')
        c += h['custo']; det.append(f'{h["nome"]} +{h["custo"]}')
    return c, det, err


def absorcao_armadura(a):
    out = {}
    for cob in a.get('cobertura', []):
        for d in cob['danos']:
            out[d] = a['protecao'] + (1 if cob['tipo'] == 'fisico+1' else 0)
    return out


def palavras_arma(a):
    p = []
    if a.get('distancia'):
        p.append(f'Distância({", ".join(a["distancia"])})')
        rec = a.get('recarga', 1)
        if rec: p.append(f'Recarga({rec})')
    if a.get('armaDeFogo'):
        p += [f'Arma de Fogo({a["armaDeFogo"]["limite"]})', f'Disparo({a["armaDeFogo"]["disparo"]})']
    for k, n in (('letal', 'Letal'), ('brutal', 'Brutal'), ('bloqueio', 'Bloqueio')):
        if a.get(k): p.append(f'{n}({a[k]})')
    if a.get('enriste'): p.append('Enriste')
    if a.get('arremesso'): p.append('Arremesso')
    return p


def tabela_md(d):
    L = ['<!-- tabela-equipamentos:inicio (gerado por tools/equipamentos.py — edite data/equipamentos.json) -->', '']
    L.append('> Alcance: **Curto** = mesma zona curta; **Distante** = até a zona Distante; **Distância(zonas)** = zonas ideais (Desvantagem(1) por zona de diferença). '
             'Impacto pelo peso: Leve 1 · Média 2 · Pesada 3. Atributo: Leve = Destreza; Média/Pesada = Força.')
    L.append('')
    for r in ORDEM:
        armas = [a for a in d['armas'] if a['raridade'] == r]
        arm = [a for a in d['armaduras'] if a['raridade'] == r]
        L.append(f'#### {NOME_RAR[r]} — Manuseio({MANUSEIO[r]}) · {PONTOS[r]} pontos de criação'); L.append('')
        if armas:
            L += ['| Arma | Alcance | Peso | Dano | Palavras-Chave | Aptidão |', '|---|---|---|---|---|---|']
            for a in armas:
                alc = 'Distância' if a.get('distancia') else a.get('alcance', 'curto').capitalize()
                pk = ' '.join(palavras_arma(a)) or '—'
                hab = ''.join(f'<br>*{h["nome"]}:* {h["descricao"]}' for h in a.get('habilidades', []))
                L.append(f'| {a["nome"]} | {alc} | {NOME_PESO[a["peso"]]} | {", ".join(NOME_DANO[x] for x in a["dano"])} | {pk}{hab} | {a.get("aptidao", 1)} |')
            L.append('')
        if arm:
            L += ['| Armadura | Peso | Imobilidade | Absorção | Especial |', '|---|---|---|---|---|']
            for a in arm:
                ab = absorcao_armadura(a)
                grupos = {}
                for k, v in ab.items(): grupos.setdefault(v, []).append(NOME_DANO[k])
                abs_txt = '; '.join(f'{", ".join(ns)} ({v})' for v, ns in sorted(grupos.items(), reverse=True))
                hab = '<br>'.join(f'*{h["nome"]}:* {h["descricao"]}' for h in a.get('habilidades', [])) or '—'
                L.append(f'| {a["nome"]} | {NOME_PESO[a["peso"]]} | {a["imobilidade"]} | {abs_txt} | {hab} |')
            L.append('')
    L.append('Os escudos são armas (bloqueiam com o próprio Impacto + Bloqueio). As absorções de armadura são **valor fixo**: substituem a absorção do personagem naquele tipo se forem maiores.')
    L.append('')
    L.append('<!-- tabela-equipamentos:fim -->')
    return '\n'.join(L)


def main():
    d = json.loads(DATA.read_text(encoding='utf-8'))
    erros = 0
    ids = set()
    for kind, fn in (('armas', custo_arma), ('armaduras', custo_armadura)):
        for a in d[kind]:
            if a['id'] in ids: print(f'✗ id repetido: {a["id"]}'); erros += 1
            ids.add(a['id'])
            c, det, err = fn(a)
            alvo = PONTOS[a['raridade']]
            if c != alvo: err.append(f'gasta {c} pontos, mas {a["raridade"]} tem {alvo}')
            a['custoDetalhado'] = det
            if kind == 'armaduras': a['absorcao'] = absorcao_armadura(a)
            else: a['palavrasChaveTexto'] = ' '.join(palavras_arma(a))
            if err:
                erros += 1
                print(f'✗ {a["nome"]}: ' + '; '.join(err) + f'   [{", ".join(det)}]')
    print(f'{len(d["armas"])} armas, {len(d["armaduras"])} armaduras, {erros} com erro.')
    if erros: sys.exit(1)
    if '--check' in sys.argv: return
    DATA.write_text(json.dumps(d, ensure_ascii=False, indent=1) + '\n', encoding='utf-8')
    book = BOOK.read_text(encoding='utf-8')
    novo = tabela_md(d)
    pat = re.compile(r'<!-- tabela-equipamentos:inicio.*?<!-- tabela-equipamentos:fim -->', re.S)
    if not pat.search(book): sys.exit('marcadores da tabela não encontrados no livro')
    BOOK.write_text(pat.sub(lambda m: novo, book), encoding='utf-8')
    print('data/equipamentos.json e tabela do livro atualizados.')


if __name__ == '__main__':
    main()
