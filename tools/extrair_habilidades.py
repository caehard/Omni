#!/usr/bin/env python3
"""Extrai as habilidades de docs/livro/08-habilidades.md para data/habilidades.json.

Uso: python3 tools/extrair_habilidades.py
Rode sempre que editar o capítulo de habilidades, para manter o TTS sincronizado.
"""
import json, re, unicodedata, pathlib

ROOT = pathlib.Path(__file__).resolve().parent.parent
SRC = ROOT / 'docs/livro/08-habilidades.md'
OUT = ROOT / 'data/habilidades.json'

PACOTES = {'Defeitos': 'defeito', 'Fatores Hereditários': 'fator', 'Habilidades Humanas': 'humana',
           'Criaturas Naturais': 'criatura', 'Místico': 'mistico', 'Arcano': 'arcano'}
GRAUS_DEFEITO = {'leve': 2, 'médio': 4, 'mediano': 4, 'grave': 6}
GRAUS_FATOR = {'traço': 2, 'vantagem': 4, 'dom': 6}

def slug(s):
    s = unicodedata.normalize('NFKD', s).encode('ascii', 'ignore').decode().lower()
    return re.sub(r'[^a-z0-9]+', '-', s).strip('-')

def clean(t):
    return re.sub(r'\*+', '', t).strip()

def main():
    lines = SRC.read_text(encoding='utf-8').split('\n')
    itens, pacote, nivel_base, atual = [], None, None, None
    def fechar():
        if atual:
            atual['descricao'] = '\n\n'.join(atual['descricao']).strip()
            itens.append(atual)
    for ln in lines:
        m3 = re.match(r'^### (.+)$', ln)
        if m3:
            fechar(); atual = None
            pacote = PACOTES.get(clean(m3.group(1))); nivel_base = None
            continue
        if pacote is None:
            continue
        mn = re.match(r'^#### Nível (\d)$', ln)
        if mn:
            fechar(); atual = None; nivel_base = int(mn.group(1)); continue
        mh = re.match(r'^#{4,5} (.+)$', ln)
        if mh:
            fechar()
            titulo = clean(mh.group(1))
            graus = re.findall(r'\(([^)]+)\)', titulo)
            nome = re.sub(r'\s*\([^)]*\)', '', titulo).strip()
            atual = {'id': f'{pacote}-{slug(nome)}', 'nome': nome, 'pacote': pacote, 'descricao': [], 'niveis': {}}
            if pacote == 'defeito':
                g = [x.strip().lower() for x in graus[0].split('/')] if graus else []
                atual['graus'] = g; atual['pontosConcedidos'] = {x: GRAUS_DEFEITO.get(x, 0) for x in g}
            elif pacote == 'fator':
                g = graus[0].strip().lower() if graus else ''
                atual['grau'] = g; atual['custo'] = GRAUS_FATOR.get(g, 0)
            else:
                atual['nivelMinimo'] = nivel_base or 1
            continue
        if atual is None or not ln.strip():
            continue
        txt = clean(ln)
        ml = re.match(r'^-?\s*Nível (\d):\s*(.+)$', txt)
        if ml and pacote not in ('defeito', 'fator'):
            atual['niveis'][ml.group(1)] = ml.group(2).strip()
        else:
            atual['descricao'].append(txt)
    fechar()
    for it in itens:
        if not it['niveis']:
            del it['niveis']
        else:
            it['nivelMaximo'] = max(int(k) for k in it['niveis'])
    OUT.write_text(json.dumps({'versao': 1, 'habilidades': itens}, ensure_ascii=False, indent=1), encoding='utf-8')
    print(f'{len(itens)} habilidades -> {OUT.relative_to(ROOT)}')

if __name__ == '__main__':
    main()
