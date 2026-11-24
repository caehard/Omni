#!/usr/bin/env python3
"""Servidor da mesa virtual Omni: serve o TTS e sincroniza a mesa entre os jogadores.

Uso:
    python servidor.py              # porta 8000
    python servidor.py --porta 8080

Depois abra http://localhost:8000/vtt/ e use o botão "Convidar" para chamar os jogadores.
Cada mesa fica salva em mesas/<nome>.json. Só usa a biblioteca padrão do Python 3.

Protocolo (usado por vtt/js/core/net.js):
    GET  /api/ping                      -> {"omni": true, "porta": ..., "enderecos": [...]}
    GET  /api/mesa/<nome>/eventos       -> SSE: {"tipo":"estado"}, depois {"tipo":"ops"} e {"tipo":"presenca"}
    POST /api/mesa/<nome>/ops           <- {"cliente", "lote", "ops": [...]}
"""
import argparse
import json
import os
import posixpath
import queue
import re
import socket
import sys
import threading
import time
import unicodedata
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, unquote, urlparse

RAIZ = os.path.dirname(os.path.abspath(__file__))
PASTA_MESAS = os.path.join(RAIZ, 'mesas')
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


def aplicar(raiz, ops):
    """Aplica as operações válidas; devolve (raiz, operações aplicadas)."""
    aplicadas = []
    for op in ops:
        if not isinstance(op, dict) or op.get('op') not in ('set', 'del', 'ins') or not isinstance(op.get('path', []), list):
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


# ---------------------------------------------------------------------------
# Mesas
# ---------------------------------------------------------------------------

def nome_mesa(s):
    s = unicodedata.normalize('NFD', (s or '').lower())
    s = ''.join(c for c in s if not unicodedata.combining(c))
    s = re.sub(r'[^a-z0-9_-]+', '-', s).strip('-')[:40]
    return s or 'principal'


class Mesa:
    def __init__(self, nome):
        self.nome = nome
        self.arquivo = os.path.join(PASTA_MESAS, nome + '.json')
        self.lock = threading.Lock()
        self.estado = None
        self.v = 0
        self.lotes = {}       # cliente -> último lote recebido (para ignorar reenvios)
        self.clientes = {}    # cliente -> {"fila": Queue, "nome": str}
        self.suja = False
        if os.path.exists(self.arquivo):
            try:
                with open(self.arquivo, encoding='utf-8') as f:
                    dados = json.load(f)
                self.estado, self.v = dados.get('estado'), int(dados.get('v', 0))
            except (OSError, ValueError) as e:
                print(f'[aviso] não foi possível ler {self.arquivo}: {e}', file=sys.stderr)

    def _difundir(self, msg):
        for c in self.clientes.values():
            c['fila'].put(msg)

    def _presenca(self):
        jogadores = [{'cliente': k, 'nome': c['nome']} for k, c in self.clientes.items()]
        self._difundir(json.dumps({'tipo': 'presenca', 'jogadores': jogadores}, ensure_ascii=False))

    def entrar(self, cliente, nome):
        fila = queue.Queue()
        with self.lock:
            self.clientes[cliente] = {'fila': fila, 'nome': nome}
            fila.put(json.dumps({'tipo': 'estado', 'v': self.v, 'lote': self.lotes.get(cliente, 0), 'estado': self.estado}, ensure_ascii=False))
            self._presenca()
        return fila

    def sair(self, cliente, fila):
        with self.lock:
            if self.clientes.get(cliente, {}).get('fila') is fila:
                del self.clientes[cliente]
                self._presenca()

    def receber(self, cliente, lote, ops):
        with self.lock:
            if lote <= self.lotes.get(cliente, 0):
                return self.v  # reenvio de algo que já chegou
            self.lotes[cliente] = lote
            self.estado, aplicadas = aplicar(self.estado, ops)
            self.v += 1
            self.suja = True
            self._difundir(json.dumps({'tipo': 'ops', 'v': self.v, 'origem': cliente, 'lote': lote, 'ops': aplicadas}, ensure_ascii=False))
            return self.v

    def evento(self, cliente, dados):
        """Repassa a todos sem guardar nem mudar a versão (ping no mapa etc.)."""
        with self.lock:
            self._difundir(json.dumps({'tipo': 'evento', 'origem': cliente, 'dados': dados}, ensure_ascii=False))

    def salvar(self):
        with self.lock:
            if not self.suja:
                return
            texto = json.dumps({'v': self.v, 'estado': self.estado}, ensure_ascii=False)
            self.suja = False
        os.makedirs(PASTA_MESAS, exist_ok=True)
        tmp = self.arquivo + '.tmp'
        with open(tmp, 'w', encoding='utf-8') as f:
            f.write(texto)
        os.replace(tmp, self.arquivo)


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
            return self._json(200, {'omni': True, 'porta': self.porta, 'enderecos': enderecos_locais(), 'limite': LIMITE_CORPO})
        m = ROTA_MESA.match(url.path)
        if m and m.group(2) == 'eventos':
            return self._eventos(nome_mesa(unquote(m.group(1))), parse_qs(url.query))
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

    def do_POST(self):
        url = urlparse(self.path)
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
        v = mesa(nome_mesa(unquote(m.group(1)))).receber(cliente, lote, ops)
        return self._json(200, {'v': v})

    def _eventos(self, nome, qs):
        cliente = (qs.get('cliente') or [''])[0][:64]
        jogador = ((qs.get('nome') or ['Jogador'])[0].strip() or 'Jogador')[:40]
        if not cliente:
            return self._json(400, {'erro': 'cliente ausente'})
        self.send_response(200)
        self.send_header('Content-Type', 'text/event-stream; charset=utf-8')
        self.send_header('Cache-Control', 'no-cache, no-transform')
        self.send_header('X-Accel-Buffering', 'no')
        self.send_header('Connection', 'close')
        self.end_headers()
        self.close_connection = True
        m = mesa(nome)
        fila = m.entrar(cliente, jogador)
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


def main():
    ap = argparse.ArgumentParser(description='Servidor da mesa virtual Omni (TTS + multiplayer).')
    ap.add_argument('--porta', type=int, default=int(os.environ.get('PORT', 8000)))
    ap.add_argument('--host', default='0.0.0.0', help='0.0.0.0 aceita conexões da rede; 127.0.0.1 só deste PC')
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
    print('  Pela internet:      use um túnel (veja "Jogar online" no README)')
    print('  Ctrl+C para parar. As mesas ficam salvas em mesas/.')
    try:
        servidor.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        salvar_todas()
        print('\nMesas salvas. Até a próxima!')


if __name__ == '__main__':
    main()
