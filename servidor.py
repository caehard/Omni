#!/usr/bin/env python3
"""Servidor da mesa virtual Omni: serve o TTS e sincroniza a mesa entre os jogadores.

Uso:
    python servidor.py              # porta 8000, rede local
    python servidor.py --online     # + link público pela internet (cloudflared)
    python servidor.py --porta 8080

Depois abra http://localhost:8000/vtt/ e use o botão da mesa para convidar os jogadores.
Quem abre a mesa neste PC (localhost) é o mestre; quem entra pelo link é jogador.
Cada mesa fica salva em mesas/<nome>.json. Só usa a biblioteca padrão do Python 3.

Protocolo (usado por vtt/js/core/net.js):
    GET  /api/ping                      -> {"omni": true, "porta", "enderecos", "limite", "publico"}
    GET  /api/mesa/<nome>/eventos?cliente&nome&jogador[&chave][&como=jogador]
                                        -> SSE: {"tipo":"estado"}, depois "ops", "presenca" e "evento"
    POST /api/mesa/<nome>/ops           <- {"cliente", "lote", "ops": [...], "jogador", "chave"?, "como"?}
    POST /api/mesa/<nome>/evento        <- {"cliente", "dados"}   (repassado a todos, não é salvo)
    POST /api/mesa/<nome>/arquivos      <- bytes (Content-Type: imagem, áudio ou PDF) -> {"url"}
    GET  /api/mesa/<nome>/arquivos/<hash>.<ext>   (imagens, músicas... da biblioteca; aceita Range)
    GET  /api/mesa/<nome>/gerador/estado|trabalho?id=  ·  POST .../gerador/ligar|desligar|gerar   (só o mestre)

Papéis: o mestre recebe e muda tudo. Cada jogador recebe só a sua vista (vista_jogador) e só pode
mudar o que é dele (pode); o servidor confere cada operação.
"""
import argparse
import base64
import hashlib
import json
import os
import posixpath
import queue
import re
import secrets
import shutil
import socket
import subprocess
import sys
import threading
import time
import unicodedata
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, unquote, urlparse

import gerador as _gerador

RAIZ = os.path.dirname(os.path.abspath(__file__))
PASTA_MESAS = os.path.join(RAIZ, 'mesas')
PASTA_ARQUIVOS = os.path.join(PASTA_MESAS, 'arquivos')  # arquivos/<mesa>/<hash>.<ext>: biblioteca de cada mesa
LIMITE_ARQUIVO = 40 * 1024 * 1024
TIPOS_ARQUIVO = {
    'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif',
    'audio/mpeg': 'mp3', 'audio/ogg': 'ogg', 'audio/wav': 'wav', 'audio/x-wav': 'wav', 'audio/wave': 'wav',
    'audio/mp4': 'm4a', 'audio/x-m4a': 'm4a', 'audio/aac': 'aac', 'audio/webm': 'weba', 'audio/flac': 'flac',
    'application/pdf': 'pdf',
}  # sem SVG nem HTML: um arquivo de jogador nunca roda script no navegador dos outros
MIME_POR_EXT = {'png': 'image/png', 'jpg': 'image/jpeg', 'webp': 'image/webp', 'gif': 'image/gif', 'mp3': 'audio/mpeg',
                'ogg': 'audio/ogg', 'wav': 'audio/wav', 'm4a': 'audio/mp4', 'aac': 'audio/aac', 'weba': 'audio/webm',
                'flac': 'audio/flac', 'pdf': 'application/pdf'}
PASTAS_PUBLICAS = ('vtt', 'data', 'docs')  # o resto do repositório (.git, mesas/, original/) não é servido
LIMITE_CORPO = 32 * 1024 * 1024            # 32 MB por envio (mapas e retratos vão como imagem embutida)
PING_SSE = 15                              # segundos entre "pings" para manter a conexão viva


# ---------------------------------------------------------------------------
# Operações — mesmo algoritmo de vtt/js/core/sync-ops.js (applyOps). Mantenha os dois iguais.
# ---------------------------------------------------------------------------

def _eh_obj(v):
    return isinstance(v, dict)


def _eh_indice(seg):
    return isinstance(seg, int) and not isinstance(seg, bool) and seg >= 0


def _achar(lista, seg):
    (k, v), = seg.items()
    for i, x in enumerate(lista):
        if _eh_obj(x) and x.get(k) == v:
            return i
    return -1


def _filho(no, seg):
    if _eh_obj(seg):
        if not isinstance(no, list):
            return None
        i = _achar(no, seg)
        return None if i < 0 else no[i]
    if _eh_indice(seg):
        return no[seg] if isinstance(no, list) and 0 <= seg < len(no) else None
    return no.get(seg) if _eh_obj(no) else None


def _resolver(raiz, caminho):
    no = raiz
    for seg in caminho:
        no = _filho(no, seg)
        if no is None:
            return None
    return no


def _copia(v):
    return json.loads(json.dumps(v))


def aplicar_op(raiz, op):
    """Aplica uma operação. Devolve (raiz, mudou): a raiz pode ser nova (set em []);
    mudou=False quando o caminho não existe mais e nada foi feito."""
    caminho = op.get('path') or []
    tipo = op.get('op')
    valor = op.get('value')
    if tipo == 'ins':
        lista = _resolver(raiz, caminho)
        if not isinstance(lista, list) or not _eh_obj(valor):
            return raiz, False
        k = op.get('key')
        velho = next((i for i, x in enumerate(lista) if _eh_obj(x) and x.get(k) == valor.get(k)), -1)
        if velho >= 0:
            del lista[velho]
        pos = 0
        if op.get('after') is not None:
            j = next((i for i, x in enumerate(lista) if _eh_obj(x) and x.get(k) == op['after']), -1)
            pos = len(lista) if j < 0 else j + 1
        lista.insert(pos, _copia(valor))
        return raiz, True
    if not caminho:
        if tipo == 'set' and _eh_obj(valor):
            return _copia(valor), True
        return raiz, False
    pai = _resolver(raiz, caminho[:-1])
    ultimo = caminho[-1]
    if _eh_obj(ultimo):
        if not isinstance(pai, list):
            return raiz, False
        i = _achar(pai, ultimo)
        if tipo == 'del':
            if i < 0:
                return raiz, False
            del pai[i]
        elif i >= 0:
            pai[i] = _copia(valor)
        else:
            pai.append(_copia(valor))
        return raiz, True
    if _eh_indice(ultimo):
        if not isinstance(pai, list):
            return raiz, False
        if tipo == 'del' and ultimo < len(pai):
            del pai[ultimo]
        elif tipo == 'set' and ultimo < len(pai):
            pai[ultimo] = _copia(valor)
        elif tipo == 'set' and ultimo == len(pai):
            pai.append(_copia(valor))
        else:
            return raiz, False
        return raiz, True
    if not _eh_obj(pai) or not isinstance(ultimo, str):
        return raiz, False
    if tipo == 'del':
        if ultimo not in pai:
            return raiz, False
        del pai[ultimo]
    else:
        pai[ultimo] = _copia(valor)
    return raiz, True


def _op_valida(op):
    return isinstance(op, dict) and op.get('op') in ('set', 'del', 'ins') and isinstance(op.get('path', []), list)


def aplicar(raiz, ops):
    """Aplica as operações válidas; devolve (raiz, operações aplicadas)."""
    aplicadas = []
    for op in ops:
        if not _op_valida(op):
            continue
        if raiz is None and not (op['op'] == 'set' and not op.get('path')):
            continue  # mesa nova: só aceita o estado inicial
        try:
            raiz, mudou = aplicar_op(raiz, op)
            if mudou:
                aplicadas.append(op)
        except (TypeError, ValueError, KeyError, AttributeError, IndexError):
            continue
    return raiz, aplicadas


CHAVES_ID = ('id', 'atorId')


def _chave_lista(*listas):
    """Campo identificador comum a todos os itens (como keyOf em sync-ops.js) ou None."""
    todos = [x for lista in listas for x in lista]
    if not todos:
        return None
    for k in CHAVES_ID:
        if all(_eh_obj(x) and isinstance(x.get(k), str) for x in todos):
            return k if all(len({x[k] for x in lista}) == len(lista) for lista in listas) else None
    return None


def _igual_prim(a, b):
    return type(a) is type(b) and a == b or (a is None and b is None)


def diff(a, b, caminho=None, saida=None):
    """Operações que transformam `a` em `b` — mesmo algoritmo de diff() em sync-ops.js."""
    caminho = caminho or []
    saida = [] if saida is None else saida
    if a is b:
        return saida
    if isinstance(a, list) and isinstance(b, list):
        _diff_lista(a, b, caminho, saida)
        return saida
    if _eh_obj(a) and _eh_obj(b):
        for k in a:
            if k not in b:
                saida.append({'op': 'del', 'path': caminho + [k]})
        for k, v in b.items():
            if k not in a:
                saida.append({'op': 'set', 'path': caminho + [k], 'value': v})
            else:
                diff(a[k], v, caminho + [k], saida)
        return saida
    prim = lambda v: not isinstance(v, (dict, list))
    if prim(a) and prim(b) and _igual_prim(a, b):
        return saida
    saida.append({'op': 'set', 'path': caminho, 'value': b})
    return saida


def _diff_lista(a, b, caminho, saida):
    k = _chave_lista(a, b)
    if k:
        em_a = {x[k]: x for x in a}
        em_b = {x[k] for x in b}
        ordem_a = [x[k] for x in a if x[k] in em_b]
        ordem_b = [x[k] for x in b if x[k] in em_a]
        if ordem_a == ordem_b:
            for x in a:
                if x[k] not in em_b:
                    saida.append({'op': 'del', 'path': caminho + [{k: x[k]}]})
            anterior = None
            for x in b:
                if x[k] in em_a:
                    diff(em_a[x[k]], x, caminho + [{k: x[k]}], saida)
                else:
                    saida.append({'op': 'ins', 'path': caminho, 'key': k, 'value': x, 'after': anterior})
                anterior = x[k]
            return
    elif len(a) == len(b):
        for i, (x, y) in enumerate(zip(a, b)):
            diff(x, y, caminho + [i], saida)
        return
    saida.append({'op': 'set', 'path': caminho, 'value': b})


def _copia_rasa_profunda(v):
    """Cópia da estrutura (dicts/listas); textos e números são compartilhados (imutáveis)."""
    if isinstance(v, dict):
        return {k: _copia_rasa_profunda(x) for k, x in v.items()}
    if isinstance(v, list):
        return [_copia_rasa_profunda(x) for x in v]
    return v


# ---------------------------------------------------------------------------
# Papéis: o que cada jogador vê e pode mudar. O mestre vê e muda tudo.
# ---------------------------------------------------------------------------

def _achar_id(lista, k, valor):
    for x in lista or []:
        if _eh_obj(x) and x.get(k) == valor:
            return x
    return None


def _dono(estado, jogador, ator_id):
    a = _achar_id((estado or {}).get('atores'), 'id', ator_id)
    return bool(a) and jogador in (a.get('donos') or [])


def mensagem_visivel(msg, jogador):
    """Mensagem com `para` (sussurro, rolagem oculta) só aparece para quem enviou e para os destinatários."""
    para = msg.get('para') if _eh_obj(msg) else None
    return para is None or msg.get('de') == jogador or jogador in para


def _token_fora_da_nevoa(nevoa, t):
    """Com a névoa ativa, o jogador só recebe tokens alheios com algum quadrado revelado (como tokenVisible em layers.js)."""
    if not _eh_obj(nevoa) or not nevoa.get('ativa'):
        return True
    rev = nevoa.get('revelado') if _eh_obj(nevoa.get('revelado')) else {}
    try:
        x, y, s = int(t.get('x', 0)), int(t.get('y', 0)), max(1, min(4, int(t.get('tamanho') or 1)))
    except (TypeError, ValueError):
        return False
    return any(f'{x + i},{y + j}' in rev for i in range(s) for j in range(s))


def vista_jogador(estado, jogador):
    """O que um jogador (não mestre) recebe: sem fichas/tokens ocultos, só a cena ativa, sem sussurros alheios."""
    if estado is None:
        return None
    vista = {}
    visiveis = set()
    for k, v in estado.items():
        if k == 'atores':
            vista[k] = []
            for a in v or []:
                if not _eh_obj(a):
                    continue
                if a.get('oculto') and jogador not in (a.get('donos') or []):
                    continue
                visiveis.add(a.get('id'))
                vista[k].append(_copia_rasa_profunda(a))
    for k, v in estado.items():
        if k == 'atores':
            continue
        if k == 'cenas':
            vista[k] = []
            for c in v or []:
                if not _eh_obj(c) or c.get('id') != estado.get('cenaAtiva'):
                    continue  # cenas em preparo ficam só com o mestre
                cena = {ck: _copia_rasa_profunda(cv) for ck, cv in c.items() if ck != 'tokens'}
                cena['tokens'] = [_copia_rasa_profunda(t) for t in c.get('tokens') or []
                                  if _eh_obj(t) and not t.get('oculto') and t.get('atorId') in visiveis
                                  and (_dono(estado, jogador, t.get('atorId')) or _token_fora_da_nevoa(c.get('nevoa'), t))]
                vista[k].append(cena)
        elif k == 'chat':
            vista[k] = [_copia_rasa_profunda(m) for m in v or [] if mensagem_visivel(m, jogador)]
        elif k == 'biblioteca':  # o que o mestre ainda não mostrou (ex.: imagens geradas) fica só com ele
            vista[k] = [_copia_rasa_profunda(i) for i in v or [] if _eh_obj(i) and (not i.get('oculto') or i.get('de') == jogador)]
        elif k == 'combate' and _eh_obj(v):
            vista[k] = {ck: _copia_rasa_profunda(cv) for ck, cv in v.items() if ck != 'combatentes'}
            vista[k]['combatentes'] = [_copia_rasa_profunda(c) for c in v.get('combatentes') or []
                                       if _eh_obj(c) and c.get('atorId') in visiveis]
        else:
            vista[k] = _copia_rasa_profunda(v)
    return vista


CAMPOS_SO_MESTRE = ('donos', 'oculto', 'permissao', 'id')
TIPOS_DESENHO = ('livre', 'linha', 'retangulo', 'circulo', 'texto', 'area')
TIPOS_BIBLIOTECA = ('imagem', 'personagem', 'musica', 'outro')
CAMPOS_BIBLIOTECA_JOGADOR = ('nome', 'descricao', 'token', 'mini', 'tags')


def pode(estado, jogador, op):
    """Um jogador pode aplicar esta operação? (o mestre pode tudo)"""
    p, t = op.get('path') or [], op.get('op')
    if not p or not estado:
        return False
    raiz = p[0]
    if raiz == 'chat':
        if t == 'ins' and len(p) == 1 and _eh_obj(op.get('value')):
            op['value']['de'] = jogador  # o autor é quem enviou, não o que o navegador diz
            para = op['value'].get('para')
            return para is None or isinstance(para, list)
        if t == 'set' and len(p) >= 3 and _eh_obj(p[1]):  # botões do cartão (Ponto Heroico, Virtude, Falha)
            msg = _achar_id(estado.get('chat'), 'id', p[1].get('id'))
            dela = bool(msg) and (msg.get('de') == jogador or _dono(estado, jogador, msg.get('atorId')))
            return dela and p[2] in ('roll', 'rev')
        return False
    if raiz == 'atores':
        if t == 'ins' and len(p) == 1 and _eh_obj(op.get('value')):
            v = op['value']
            return jogador in (v.get('donos') or []) and not v.get('oculto')
        if len(p) >= 2 and _eh_obj(p[1]) and 'id' in p[1] and _dono(estado, jogador, p[1]['id']):
            return t == 'del' if len(p) == 2 else p[2] not in CAMPOS_SO_MESTRE
        return False
    if raiz == 'cenas' and len(p) >= 3 and _eh_obj(p[1]) and p[2] == 'desenhos':
        cena = _achar_id(estado.get('cenas'), 'id', p[1].get('id'))
        if not cena or cena.get('id') != estado.get('cenaAtiva'):
            return False
        if t == 'ins' and len(p) == 3 and _eh_obj(op.get('value')):
            op['value']['de'] = jogador  # todo desenho é de quem o fez (só ele ou o mestre apaga)
            return op['value'].get('tipo') in TIPOS_DESENHO
        if t == 'del' and len(p) == 4 and _eh_obj(p[3]):
            d = _achar_id(cena.get('desenhos'), 'id', p[3].get('id'))
            return bool(d) and d.get('de') == jogador
        return False
    if raiz == 'cenas' and len(p) >= 3 and _eh_obj(p[1]) and p[2] == 'tokens':
        cena = _achar_id(estado.get('cenas'), 'id', p[1].get('id'))
        if not cena:
            return False
        if t == 'ins' and len(p) == 3 and _eh_obj(op.get('value')):
            v = op['value']
            return _dono(estado, jogador, v.get('atorId')) and not v.get('oculto')
        if len(p) >= 4 and _eh_obj(p[3]):
            tok = _achar_id(cena.get('tokens'), 'id', p[3].get('id'))
            if not tok or not _dono(estado, jogador, tok.get('atorId')):
                return False
            return t == 'del' if len(p) == 4 else (len(p) == 5 and p[4] in ('x', 'y', 'tamanho'))
        return False
    if raiz == 'biblioteca':  # comum a todos: cada um põe o que quiser e só mexe no que é seu
        if t == 'ins' and len(p) == 1 and _eh_obj(op.get('value')) and op.get('key') == 'id':
            v = op['value']
            v['de'], v['oculto'] = jogador, False
            novo = not _achar_id(estado.get('biblioteca'), 'id', v.get('id'))  # "ins" com id repetido substituiria o de outro
            return novo and v.get('tipo') in TIPOS_BIBLIOTECA and isinstance(v.get('id'), str)
        if len(p) >= 2 and _eh_obj(p[1]):
            item = _achar_id(estado.get('biblioteca'), 'id', p[1].get('id'))
            if not item or item.get('de') != jogador:
                return False
            return t == 'del' if len(p) == 2 else p[2] in CAMPOS_BIBLIOTECA_JOGADOR
        return False
    if raiz == 'combate' and len(p) >= 2 and p[1] == 'combatentes':
        if t == 'ins' and len(p) == 2 and _eh_obj(op.get('value')):
            return _dono(estado, jogador, op['value'].get('atorId'))
        if len(p) >= 3 and _eh_obj(p[2]) and 'atorId' in p[2]:
            return _dono(estado, jogador, p[2]['atorId']) and (len(p) > 3 or t == 'del')
        return False
    return False


# ---------------------------------------------------------------------------
# Mesas
# ---------------------------------------------------------------------------

def nome_mesa(s):
    s = unicodedata.normalize('NFD', (s or '').lower())
    s = ''.join(c for c in s if not unicodedata.combining(c))
    s = re.sub(r'[^a-z0-9_-]+', '-', s).strip('-')[:40]
    return s or 'principal'


def _json(obj):
    return json.dumps(obj, ensure_ascii=False)


class Mesa:
    def __init__(self, nome):
        self.nome = nome
        self.arquivo = os.path.join(PASTA_MESAS, nome + '.json')
        self.lock = threading.Lock()
        self.estado = None
        self.v = 0
        self.chave = secrets.token_urlsafe(9)  # chave do mestre (link de co-mestre)
        self.lotes = {}       # cliente -> último lote recebido (para ignorar reenvios)
        self.clientes = {}    # cliente -> {fila, nome, jogador, mestre, vista}
        self.suja = False
        if os.path.exists(self.arquivo):
            try:
                with open(self.arquivo, encoding='utf-8') as f:
                    dados = json.load(f)
                self.estado, self.v = dados.get('estado'), int(dados.get('v', 0))
                self.chave = dados.get('chave') or self.chave
            except (OSError, ValueError) as e:
                print(f'[aviso] não foi possível ler {self.arquivo}: {e}', file=sys.stderr)
        self.suja = not os.path.exists(self.arquivo)  # grava a chave nova

    # ---- envio ----
    def _difundir(self, msg):
        for c in self.clientes.values():
            c['fila'].put(msg)

    def _presenca(self):
        jogadores = [{'cliente': k, 'nome': c['nome'], 'jogador': c['jogador'], 'mestre': c['mestre']} for k, c in self.clientes.items()]
        self._difundir(_json({'tipo': 'presenca', 'jogadores': jogadores}))

    def _msg_estado(self, c, lote):
        msg = {'tipo': 'estado', 'v': self.v, 'lote': lote, 'papel': 'mestre' if c['mestre'] else 'jogador', 'jogador': c['jogador']}
        if c['mestre']:
            msg.update(estado=self.estado, chave=self.chave)
        else:
            c['vista'] = vista_jogador(self.estado, c['jogador'])
            msg['estado'] = c['vista']
        return _json(msg)

    def _transmitir(self, origem, lote, aplicadas, refazer_para=None):
        """Manda o lote a cada cliente: o mestre recebe as operações; cada jogador, a diferença da sua vista."""
        msg_mestre = None
        for k, c in self.clientes.items():
            if c['mestre'] and k != refazer_para:
                msg_mestre = msg_mestre or _json({'tipo': 'ops', 'v': self.v, 'origem': origem, 'lote': lote, 'ops': aplicadas})
                c['fila'].put(msg_mestre)
                continue
            if k == refazer_para:  # algo foi recusado: o cliente recarrega o estado para não ficar diferente
                c['fila'].put(self._msg_estado(c, self.lotes.get(k, 0)))
                continue
            nova = vista_jogador(self.estado, c['jogador'])
            ops = diff(c['vista'], nova) if c['vista'] is not None else [{'op': 'set', 'path': [], 'value': nova}]
            c['vista'] = nova
            c['fila'].put(_json({'tipo': 'ops', 'v': self.v, 'origem': origem, 'lote': lote, 'ops': ops}))

    def _lote_servidor(self, ops):
        self.estado, aplicadas = aplicar(self.estado, ops)
        if aplicadas:
            self.v += 1
            self.suja = True
            self._transmitir('servidor', 0, aplicadas)

    def _registrar_jogadores(self):
        """Mantém estado.jogadores = {id: {nome}} com quem já entrou (o mestre usa para dar fichas aos jogadores)."""
        if not _eh_obj(self.estado):
            return
        lista = self.estado.get('jogadores') if _eh_obj(self.estado.get('jogadores')) else {}
        ops = []
        for c in self.clientes.values():
            atual = lista.get(c['jogador'])
            if not c['mestre'] and (not _eh_obj(atual) or atual.get('nome') != c['nome']):
                ops.append({'op': 'set', 'path': ['jogadores', c['jogador']], 'value': {'nome': c['nome']}})
        if ops and not _eh_obj(self.estado.get('jogadores')):
            ops.insert(0, {'op': 'set', 'path': ['jogadores'], 'value': {}})
        if ops:
            self._lote_servidor(ops)

    # ---- entrada e saída ----
    def entrar(self, cliente, nome, jogador, mestre):
        fila = queue.Queue()
        with self.lock:
            c = {'fila': fila, 'nome': nome, 'jogador': jogador, 'mestre': mestre, 'vista': None}
            self.clientes[cliente] = c
            fila.put(self._msg_estado(c, self.lotes.get(cliente, 0)))
            self._registrar_jogadores()
            self._presenca()
        return fila

    def sair(self, cliente, fila):
        with self.lock:
            if self.clientes.get(cliente, {}).get('fila') is fila:
                del self.clientes[cliente]
                self._presenca()

    def receber(self, cliente, lote, ops, jogador, mestre):
        with self.lock:
            if lote <= self.lotes.get(cliente, 0):
                return self.v  # reenvio de algo que já chegou
            self.lotes[cliente] = lote
            recusou = False
            if mestre:
                self.estado, aplicadas = aplicar(self.estado, ops)
            else:
                aplicadas = []
                for op in ops:
                    if not (_op_valida(op) and pode(self.estado, jogador, op)):
                        recusou = True
                        continue
                    try:
                        self.estado, mudou = aplicar_op(self.estado, op)
                    except (TypeError, ValueError, KeyError, AttributeError, IndexError):
                        recusou = True
                        continue
                    if mudou:
                        aplicadas.append(op)
            self.v += 1
            self.suja = True
            self._transmitir(cliente, lote, aplicadas, refazer_para=cliente if recusou else None)
            self._registrar_jogadores()  # mesa recém-criada ou recarregada pelo mestre
            return self.v

    def evento(self, cliente, dados):
        """Repassa a todos sem guardar nem mudar a versão (ping no mapa etc.)."""
        with self.lock:
            self._difundir(json.dumps({'tipo': 'evento', 'origem': cliente, 'dados': dados}, ensure_ascii=False))

    def salvar(self):
        with self.lock:
            if not self.suja:
                return
            texto = json.dumps({'v': self.v, 'chave': self.chave, 'estado': self.estado}, ensure_ascii=False)
            self.suja = False
        os.makedirs(PASTA_MESAS, exist_ok=True)
        tmp = self.arquivo + '.tmp'
        with open(tmp, 'w', encoding='utf-8') as f:
            f.write(texto)
        os.replace(tmp, self.arquivo)


    def adicionar_biblioteca(self, itens):
        """Põe itens na biblioteca pelo servidor (imagens que o gerador terminou, mesmo com a aba do mestre fechada)."""
        with self.lock:
            if not _eh_obj(self.estado):
                return
            ops = [] if isinstance(self.estado.get('biblioteca'), list) else [{'op': 'set', 'path': ['biblioteca'], 'value': []}]
            ultimo = next((x.get('id') for x in reversed(self.estado.get('biblioteca') or []) if _eh_obj(x)), None)
            for it in itens:
                ops.append({'op': 'ins', 'path': ['biblioteca'], 'key': 'id', 'value': it, 'after': ultimo})
                ultimo = it['id']
            self._lote_servidor(ops)


# ---------------------------------------------------------------------------
# Arquivos da biblioteca (imagens, músicas, PDFs): mesas/arquivos/<mesa>/<hash>.<ext>
# ---------------------------------------------------------------------------

ROTA_ARQUIVO = re.compile(r'^/api/mesa/([^/]+)/arquivos(?:/([0-9a-f]{24}\.[a-z0-9]{2,4}))?$')
ASSINATURAS = {  # começo do arquivo de cada tipo de imagem/PDF (o resto é conferido pelo Content-Type)
    'png': (b'\x89PNG',), 'jpg': (b'\xff\xd8\xff',), 'gif': (b'GIF8',), 'pdf': (b'%PDF',),
    'webp': (b'RIFF',),
}


def tipo_do_envio(mime, dados):
    """Extensão do arquivo enviado, ou None se o tipo não é aceito ou o conteúdo não bate com o tipo."""
    ext = TIPOS_ARQUIVO.get((mime or '').split(';')[0].strip().lower())
    if not ext or not dados:
        return None
    assin = ASSINATURAS.get(ext)
    if assin and not any(dados.startswith(a) for a in assin):
        return None
    if ext == 'webp' and dados[8:12] != b'WEBP':
        return None
    return ext


def guardar_arquivo(nome, dados, ext):
    """Grava (se ainda não existe) e devolve o endereço. O nome é o hash do conteúdo: o mesmo arquivo não duplica."""
    pasta = os.path.join(PASTA_ARQUIVOS, nome)
    os.makedirs(pasta, exist_ok=True)
    arq = f'{hashlib.sha256(dados).hexdigest()[:24]}.{ext}'
    destino = os.path.join(pasta, arq)
    if not os.path.exists(destino):
        tmp = destino + '.tmp'
        with open(tmp, 'wb') as f:
            f.write(dados)
        os.replace(tmp, destino)
    return f'/api/mesa/{nome}/arquivos/{arq}'


def ler_arquivo(url):
    """(bytes, mime) de um endereço da biblioteca ou de uma imagem embutida (data:), ou None."""
    url = str(url or '')
    if url.startswith('data:'):
        try:
            cab, b64 = url[5:].split(',', 1)
            return base64.b64decode(b64), cab.split(';')[0] or 'image/png'
        except (ValueError, TypeError):
            return None
    m = ROTA_ARQUIVO.match(urlparse(url).path)
    if not m or not m.group(2):
        return None
    caminho = os.path.join(PASTA_ARQUIVOS, nome_mesa(unquote(m.group(1))), m.group(2))
    if not os.path.isfile(caminho):
        return None
    with open(caminho, 'rb') as f:
        return f.read(), MIME_POR_EXT.get(m.group(2).rsplit('.', 1)[1], 'application/octet-stream')


# ---------------------------------------------------------------------------
# Gerador de imagens (ComfyUI local; ver gerador.py)
# ---------------------------------------------------------------------------

GERADOR = _gerador.Gerador()
ROTA_GERADOR = re.compile(r'^/api/mesa/([^/]+)/gerador/(estado|ligar|desligar|gerar|trabalho)$')


def gerar_para_mesa(ms, pedido, item, jogador):
    """Põe o pedido na fila; quando as imagens ficam prontas, viram itens ocultos na biblioteca da mesa."""
    item = item if _eh_obj(item) else {}
    tipo = item.get('tipo') if item.get('tipo') in TIPOS_BIBLIOTECA else 'imagem'
    nome = str(item.get('nome') or 'Imagem gerada')[:80]

    def ao_terminar(trabalho, imagens):
        urls, itens = [], []
        for i, (dados, _mime) in enumerate(imagens):
            url = guardar_arquivo(ms.nome, dados, 'png')
            urls.append(url)
            itens.append({
                'id': uuid_curto(), 'tipo': tipo, 'nome': nome if len(imagens) == 1 else f'{nome} ({i + 1})',
                'url': url, 'mime': 'image/png', 'de': jogador, 'criado': int(time.time() * 1000), 'oculto': True,
                'descricao': str(item.get('descricao') or '')[:2000],
                'origem': {**(item.get('origem') if _eh_obj(item.get('origem')) else {}), 'semente': trabalho['semente'] + (i if trabalho['modelo'] == 'qwen' else 0), 'gerado': True},
            })
        ms.adicionar_biblioteca(itens)
        return urls
    return GERADOR.gerar(pedido, ler_arquivo, ao_terminar)


def uuid_curto():
    return secrets.token_hex(6)


MESAS = {}
_lock_mesas = threading.Lock()


def mesa(nome):
    with _lock_mesas:
        if nome not in MESAS:
            MESAS[nome] = Mesa(nome)
        return MESAS[nome]


def salvar_todas():
    for m in list(MESAS.values()):
        try:
            m.salvar()
        except OSError as e:
            print(f'[aviso] falha ao salvar a mesa {m.nome}: {e}', file=sys.stderr)


def _salvador():
    while True:
        time.sleep(2)
        salvar_todas()


# ---------------------------------------------------------------------------
# HTTP
# ---------------------------------------------------------------------------

def enderecos_locais():
    ips = set()
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
            s.connect(('10.255.255.255', 1))  # não envia nada; só descobre a interface de saída
            ips.add(s.getsockname()[0])
    except OSError:
        pass
    try:
        for ip in socket.gethostbyname_ex(socket.gethostname())[2]:
            ips.add(ip)
    except OSError:
        pass
    return sorted(ip for ip in ips if not ip.startswith('127.'))


ROTA_MESA = re.compile(r'^/api/mesa/([^/]+)/(eventos|ops|evento)$')
LIMITE_EVENTO = 64 * 1024  # eventos passageiros (ping etc.) são pequenos


def caminho_publico(caminho_url):
    """Só serve arquivos dentro de PASTAS_PUBLICAS (normaliza como o SimpleHTTPRequestHandler, inclusive '..')."""
    p = posixpath.normpath(unquote(urlparse(caminho_url).path)).replace('\\', '/')
    partes = [x for x in p.split('/') if x and x not in ('.', '..')]
    return bool(partes) and partes[0] in PASTAS_PUBLICAS


class Handler(SimpleHTTPRequestHandler):
    server_version = 'OmniMesa/1.0'
    porta = 8000

    def log_message(self, fmt, *args):
        if self.path.startswith('/api/'):
            return  # não poluir o terminal com a sincronização
        super().log_message(fmt, *args)

    def end_headers(self):
        if not self.path.startswith('/api/'):
            self.send_header('Cache-Control', 'no-cache')  # sempre a versão mais nova dos arquivos
        super().end_headers()

    def _eh_mestre(self, m, chave, como):
        """Mestre = quem abre a mesa neste PC (localhost, sem passar por túnel/proxy) ou tem a chave do mestre."""
        if como == 'jogador':
            return False  # "ver como jogador"
        if chave and secrets.compare_digest(str(chave), m.chave):
            return True
        ip = self.client_address[0]
        encaminhado = any(self.headers.get(h) for h in ('Cf-Connecting-Ip', 'X-Forwarded-For', 'Forwarded', 'X-Real-Ip'))
        return ip in ('127.0.0.1', '::1', '::ffff:127.0.0.1') and not encaminhado

    def _json(self, codigo, obj):
        corpo = json.dumps(obj, ensure_ascii=False).encode('utf-8')
        self.send_response(codigo)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(corpo)))
        self.send_header('Cache-Control', 'no-store')
        self.end_headers()
        self.wfile.write(corpo)

    def do_GET(self):
        url = urlparse(self.path)
        if url.path == '/api/ping':
            return self._json(200, {'omni': True, 'porta': self.porta, 'enderecos': enderecos_locais(), 'limite': LIMITE_CORPO, 'publico': TUNEL['url']})
        m = ROTA_MESA.match(url.path)
        if m and m.group(2) == 'eventos':
            return self._eventos(nome_mesa(unquote(m.group(1))), parse_qs(url.query))
        m = ROTA_ARQUIVO.match(url.path)
        if m and m.group(2):
            return self._servir_arquivo(nome_mesa(unquote(m.group(1))), m.group(2))
        m = ROTA_GERADOR.match(url.path)
        if m and m.group(2) in ('estado', 'trabalho'):
            qs = parse_qs(url.query)
            arg = lambda k: (qs.get(k) or [''])[0]
            if not self._eh_mestre(mesa(nome_mesa(unquote(m.group(1)))), arg('chave'), arg('como')):
                return self._json(403, {'erro': 'só o mestre usa o gerador'})
            if m.group(2) == 'estado':
                return self._json(200, GERADOR.estado())
            t = GERADOR.trabalho(arg('id'))
            return self._json(200, t) if t else self._json(404, {'erro': 'pedido não encontrado (o servidor reiniciou?)'})
        if url.path.startswith('/api/'):
            return self._json(404, {'erro': 'rota desconhecida'})
        if url.path in ('/', ''):
            self.send_response(302)
            self.send_header('Location', '/vtt/')
            self.end_headers()
            return
        if not caminho_publico(self.path):
            return self.send_error(404, 'Nao encontrado')
        return super().do_GET()

    def do_HEAD(self):
        if not caminho_publico(self.path):
            return self.send_error(404, 'Nao encontrado')
        return super().do_HEAD()

    def _servir_arquivo(self, nome, arq):
        caminho = os.path.join(PASTA_ARQUIVOS, nome, arq)
        if not os.path.isfile(caminho):
            return self._json(404, {'erro': 'arquivo não encontrado'})
        tam = os.path.getsize(caminho)
        ini, fim, codigo = 0, tam - 1, 200
        rng = re.match(r'bytes=(\d*)-(\d*)$', self.headers.get('Range') or '')
        if rng and (rng.group(1) or rng.group(2)):  # música: o navegador pede pedaços para começar do meio
            if rng.group(1):
                ini, fim = int(rng.group(1)), int(rng.group(2)) if rng.group(2) else tam - 1
            else:
                ini = max(0, tam - int(rng.group(2)))
            fim = min(fim, tam - 1)
            if ini > fim:
                self.send_response(416)
                self.send_header('Content-Range', f'bytes */{tam}')
                self.send_header('Content-Length', '0')
                self.end_headers()
                return
            codigo = 206
        self.send_response(codigo)
        self.send_header('Content-Type', MIME_POR_EXT.get(arq.rsplit('.', 1)[1], 'application/octet-stream'))
        self.send_header('Content-Length', str(fim - ini + 1))
        self.send_header('Accept-Ranges', 'bytes')
        self.send_header('Cache-Control', 'public, max-age=31536000, immutable')  # o nome é o hash: nunca muda
        self.send_header('X-Content-Type-Options', 'nosniff')
        if codigo == 206:
            self.send_header('Content-Range', f'bytes {ini}-{fim}/{tam}')
        self.end_headers()
        try:
            with open(caminho, 'rb') as f:
                f.seek(ini)
                falta = fim - ini + 1
                while falta > 0:
                    bloco = f.read(min(256 * 1024, falta))
                    if not bloco:
                        break
                    self.wfile.write(bloco)
                    falta -= len(bloco)
        except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError):
            pass

    def _ler_corpo(self, limite):
        """Lê o corpo do POST. Devolve bytes, ou None depois de já ter respondido com o erro."""
        try:
            tamanho = int(self.headers.get('Content-Length', 0))
        except ValueError:
            self._json(400, {'erro': 'Content-Length inválido'})
            return None
        if tamanho > limite:
            self._json(413, {'erro': f'envio maior que {limite // (1024 * 1024) or 1} MB'})
            return None
        return self.rfile.read(tamanho)

    def _post_arquivo(self, nome):
        dados = self._ler_corpo(LIMITE_ARQUIVO)
        if dados is None:
            return
        ext = tipo_do_envio(self.headers.get('Content-Type'), dados)
        if not ext:
            return self._json(415, {'erro': 'tipo de arquivo não aceito (imagens PNG/JPG/WebP/GIF, áudio ou PDF)'})
        try:
            return self._json(200, {'url': guardar_arquivo(nome, dados, ext)})
        except OSError as e:
            return self._json(500, {'erro': f'não consegui gravar: {e}'})

    def _post_gerador(self, nome, acao):
        corpo = self._ler_corpo(64 * 1024)
        if corpo is None:
            return
        try:
            dados = json.loads(corpo.decode('utf-8') or '{}')
        except (ValueError, UnicodeDecodeError):
            return self._json(400, {'erro': 'pedido inválido'})
        ms = mesa(nome)
        if not self._eh_mestre(ms, dados.get('chave'), dados.get('como')):
            return self._json(403, {'erro': 'só o mestre usa o gerador'})
        if acao == 'ligar':
            return self._json(200, {'ligar': GERADOR.ligar()})
        if acao == 'desligar':
            return self._json(200, {'desligar': GERADOR.desligar()})
        if acao != 'gerar':
            return self._json(404, {'erro': 'rota desconhecida'})
        try:
            tid = gerar_para_mesa(ms, dados.get('pedido'), dados.get('item'), str(dados.get('jogador') or 'mestre')[:64])
        except ValueError as e:
            return self._json(400, {'erro': str(e)})
        except OSError as e:
            return self._json(503, {'erro': f'o gerador não respondeu ({e}). Ligue-o na aba Gerador.'})
        return self._json(200, {'id': tid})

    def do_POST(self):
        url = urlparse(self.path)
        m = ROTA_ARQUIVO.match(url.path)
        if m and not m.group(2):
            return self._post_arquivo(nome_mesa(unquote(m.group(1))))
        m = ROTA_GERADOR.match(url.path)
        if m and m.group(2) in ('ligar', 'desligar', 'gerar'):
            return self._post_gerador(nome_mesa(unquote(m.group(1))), m.group(2))
        m = ROTA_MESA.match(url.path)
        if not (m and m.group(2) in ('ops', 'evento')):
            return self._json(404, {'erro': 'rota desconhecida'})
        try:
            tamanho = int(self.headers.get('Content-Length', 0))
        except ValueError:
            return self._json(400, {'erro': 'Content-Length inválido'})
        limite = LIMITE_EVENTO if m.group(2) == 'evento' else LIMITE_CORPO
        if tamanho > limite:
            return self._json(413, {'erro': f'envio maior que {limite // 1024} KB'})
        if m.group(2) == 'evento':
            try:
                dados = json.loads(self.rfile.read(tamanho).decode('utf-8'))
                cliente = str(dados['cliente'])[:64]
                evento = dados['dados']
            except (ValueError, KeyError, TypeError, UnicodeDecodeError) as e:
                return self._json(400, {'erro': f'pedido inválido: {e}'})
            mesa(nome_mesa(unquote(m.group(1)))).evento(cliente, evento)
            return self._json(200, {'ok': True})
        try:
            dados = json.loads(self.rfile.read(tamanho).decode('utf-8'))
            cliente, lote, ops = str(dados['cliente'])[:64], int(dados['lote']), dados['ops']
            if not isinstance(ops, list):
                raise ValueError('ops deve ser uma lista')
        except (ValueError, KeyError, TypeError, UnicodeDecodeError) as e:
            return self._json(400, {'erro': f'pedido inválido: {e}'})
        ms = mesa(nome_mesa(unquote(m.group(1))))
        jogador = str(dados.get('jogador') or cliente)[:64]
        v = ms.receber(cliente, lote, ops, jogador, self._eh_mestre(ms, dados.get('chave'), dados.get('como')))
        return self._json(200, {'v': v})

    def _eventos(self, nome, qs):
        arg = lambda k, padrao='': (qs.get(k) or [padrao])[0]
        cliente = arg('cliente')[:64]
        nome_jogador = (arg('nome', 'Jogador').strip() or 'Jogador')[:40]
        jogador = (arg('jogador') or cliente)[:64]
        if not cliente:
            return self._json(400, {'erro': 'cliente ausente'})
        m = mesa(nome)
        mestre = self._eh_mestre(m, arg('chave'), arg('como'))
        self.send_response(200)
        self.send_header('Content-Type', 'text/event-stream; charset=utf-8')
        self.send_header('Cache-Control', 'no-cache, no-transform')
        self.send_header('X-Accel-Buffering', 'no')
        self.send_header('Connection', 'close')
        self.end_headers()
        self.close_connection = True
        fila = m.entrar(cliente, nome_jogador, jogador, mestre)
        try:
            self.wfile.write(b'retry: 2000\n\n')
            while True:
                try:
                    msg = fila.get(timeout=PING_SSE)
                except queue.Empty:
                    self.wfile.write(b': ping\n\n')
                    self.wfile.flush()
                    continue
                self.wfile.write(b'data: ' + msg.encode('utf-8') + b'\n\n')
                self.wfile.flush()
        except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError, OSError):
            pass
        finally:
            m.sair(cliente, fila)


# ---------------------------------------------------------------------------
# Jogar pela internet: túnel gratuito do Cloudflare (cloudflared), sem conta nem configuração
# ---------------------------------------------------------------------------

TUNEL = {'url': None, 'proc': None}
URL_TUNEL = re.compile(r'https://[a-z0-9-]+\.trycloudflare\.com')


def achar_cloudflared():
    candidatos = [shutil.which('cloudflared'), os.path.join(RAIZ, 'tools', 'cloudflared.exe'), os.path.join(RAIZ, 'tools', 'cloudflared')]
    for pasta in (os.environ.get('ProgramFiles(x86)'), os.environ.get('ProgramFiles'), os.environ.get('LOCALAPPDATA')):
        if pasta:
            candidatos += [os.path.join(pasta, 'cloudflared', 'cloudflared.exe'), os.path.join(pasta, 'Microsoft', 'WinGet', 'Links', 'cloudflared.exe')]
    return next((c for c in candidatos if c and os.path.isfile(c)), None)


def ler_saida_tunel(linhas, ao_achar):
    """Lê a saída do cloudflared até aparecer o endereço público (função separada para os testes)."""
    for linha in linhas:
        m = URL_TUNEL.search(linha)
        if m and not TUNEL['url']:
            TUNEL['url'] = m.group(0)
            ao_achar(TUNEL['url'])


def iniciar_tunel(porta):
    exe = achar_cloudflared()
    if not exe:
        print('  [online] cloudflared não encontrado. Instale uma vez com:')
        print('           winget install --id Cloudflare.cloudflared   (Windows)')
        print('           brew install cloudflared                     (macOS)')
        print('           e rode de novo. Enquanto isso, só a rede local funciona.')
        return
    print('  [online] abrindo o túnel pela internet…')
    proc = subprocess.Popen([exe, 'tunnel', '--no-autoupdate', '--url', f'http://127.0.0.1:{porta}'],
                            stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, encoding='utf-8', errors='replace')
    TUNEL['proc'] = proc

    def achou(url):
        print(f'\n  >>> Link para os amigos:  {url}/vtt/?mesa=principal')
        print('      (muda a cada vez que o servidor abre; o botão da mesa no TTS mostra o link certo)\n')
    threading.Thread(target=ler_saida_tunel, args=(proc.stdout, achou), daemon=True).start()


def main():
    ap = argparse.ArgumentParser(description='Servidor da mesa virtual Omni (TTS + multiplayer).')
    ap.add_argument('--porta', type=int, default=int(os.environ.get('PORT', 8000)))
    ap.add_argument('--host', default='0.0.0.0', help='0.0.0.0 aceita conexões da rede; 127.0.0.1 só deste PC')
    ap.add_argument('--online', action='store_true', help='abre um link público pela internet (precisa do cloudflared)')
    args = ap.parse_args()

    Handler.porta = args.porta
    servidor = ThreadingHTTPServer((args.host, args.porta), partial(Handler, directory=RAIZ))
    servidor.daemon_threads = True
    threading.Thread(target=_salvador, daemon=True).start()

    print('Omni — mesa virtual')
    print(f'  Neste PC (mestre):  http://localhost:{args.porta}/vtt/')
    if args.host != '127.0.0.1':
        for ip in enderecos_locais():
            print(f'  Na mesma rede:      http://{ip}:{args.porta}/vtt/')
    if args.online:
        iniciar_tunel(args.porta)
    else:
        print('  Pela internet:      rode jogar-online.bat (ou: python servidor.py --online)')
    print('  Ctrl+C para parar. As mesas ficam salvas em mesas/.')
    try:
        servidor.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        if TUNEL['proc']:
            TUNEL['proc'].terminate()
        GERADOR.desligar()  # só se foi a mesa que ligou o ComfyUI
        salvar_todas()
        print('\nMesas salvas. Até a próxima!')


if __name__ == '__main__':
    main()
