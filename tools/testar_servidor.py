#!/usr/bin/env python3
"""Testes do servidor da mesa (servidor.py): operações, protocolo SSE/POST e arquivos servidos.

Uso: python tools/testar_servidor.py
"""
import http.client
import json
import os
import sys
import tempfile
import threading
import time
import unittest
from functools import partial
from http.server import ThreadingHTTPServer

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, RAIZ)
import servidor  # noqa: E402

CASOS = os.path.join(RAIZ, 'vtt', 'tests', 'sync-casos.json')


def canon(v):
    return json.dumps(v, sort_keys=True, ensure_ascii=False)


class Operacoes(unittest.TestCase):
    """Mesmos casos de vtt/tests (applyOps em JS): os dois lados precisam dar o mesmo resultado."""

    def test_casos_compartilhados(self):
        with open(CASOS, encoding='utf-8') as f:
            casos = json.load(f)
        for c in casos:
            with self.subTest(c['nome']):
                estado, _ = servidor.aplicar(json.loads(json.dumps(c['inicial'])), c['ops'])
                self.assertEqual(canon(estado), canon(c['esperado']))

    def test_mesa_nova_so_aceita_estado_inicial(self):
        estado, aplicadas = servidor.aplicar(None, [{'op': 'set', 'path': ['a'], 'value': 1}])
        self.assertIsNone(estado)
        self.assertEqual(aplicadas, [])

    def test_operacao_invalida_e_ignorada(self):
        estado, aplicadas = servidor.aplicar({'a': 1}, [{'op': 'xyz', 'path': ['a']}, 'lixo', {'op': 'set', 'path': ['a'], 'value': 2}])
        self.assertEqual(estado, {'a': 2})
        self.assertEqual(len(aplicadas), 1)

    def test_nome_mesa(self):
        self.assertEqual(servidor.nome_mesa('Sessão 1 / Teste!'), 'sessao-1-teste')
        self.assertEqual(servidor.nome_mesa(''), 'principal')

    def test_caminho_publico(self):
        self.assertTrue(servidor.caminho_publico('/vtt/index.html'))
        self.assertTrue(servidor.caminho_publico('/data/sistema.json'))
        for p in ('/.git/config', '/vtt/../.git/config', '/vtt/%2e%2e/.git/config', '/servidor.py', '/mesas/x.json', '/original/x.pdf', '/'):
            with self.subTest(p):
                self.assertFalse(servidor.caminho_publico(p))


class Sse:
    """Leitor simples de Server-Sent Events."""

    def __init__(self, porta, sala, cliente, nome):
        self.conn = http.client.HTTPConnection('127.0.0.1', porta, timeout=5)
        self.conn.request('GET', f'/api/mesa/{sala}/eventos?cliente={cliente}&nome={nome}')
        self.resp = self.conn.getresponse()
        assert self.resp.status == 200, self.resp.status

    def proxima(self, tipo=None, prazo=5):
        fim = time.monotonic() + prazo
        while True:
            if time.monotonic() > fim:
                raise TimeoutError(f'nenhuma mensagem {tipo or ""} em {prazo} s')
            linha = self.resp.readline().decode('utf-8')
            if not linha:
                raise EOFError('conexão SSE fechada')
            if linha.startswith('data: '):
                msg = json.loads(linha[6:])
                if tipo is None or msg['tipo'] == tipo:
                    return msg

    def fechar(self):
        self.resp.close()  # a resposta segura o socket; sem isso o servidor não percebe a saída
        self.conn.close()


class Protocolo(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        servidor.PASTA_MESAS = cls.tmp.name
        servidor.PING_SSE = 0.3  # percebe desconexões rápido
        servidor.MESAS.clear()
        cls.srv = ThreadingHTTPServer(('127.0.0.1', 0), partial(servidor.Handler, directory=RAIZ))
        cls.srv.daemon_threads = True
        cls.porta = cls.srv.server_address[1]
        servidor.Handler.porta = cls.porta
        threading.Thread(target=cls.srv.serve_forever, daemon=True).start()

    @classmethod
    def tearDownClass(cls):
        cls.srv.shutdown()
        cls.srv.server_close()
        cls.tmp.cleanup()

    def req(self, metodo, caminho, corpo=None, headers=None):
        conn = http.client.HTTPConnection('127.0.0.1', self.porta, timeout=5)
        dados = json.dumps(corpo).encode() if corpo is not None else None
        conn.request(metodo, caminho, body=dados, headers=headers or ({'Content-Type': 'application/json'} if dados else {}))
        r = conn.getresponse()
        texto = r.read()
        conn.close()
        return r.status, texto

    def test_ping(self):
        st, txt = self.req('GET', '/api/ping')
        self.assertEqual(st, 200)
        info = json.loads(txt)
        self.assertTrue(info['omni'])
        self.assertEqual(info['porta'], self.porta)
        self.assertIn('limite', info)

    def test_arquivos(self):
        self.assertEqual(self.req('GET', '/vtt/index.html')[0], 200)
        self.assertEqual(self.req('GET', '/data/sistema.json')[0], 200)
        for p in ('/.git/config', '/vtt/../.git/config', '/vtt/%2e%2e/.git/HEAD', '/servidor.py', '/CLAUDE.md'):
            with self.subTest(p):
                self.assertEqual(self.req('GET', p)[0], 404)
        self.assertEqual(self.req('GET', '/')[0], 302)

    def test_corpo_grande_recusado(self):
        conn = http.client.HTTPConnection('127.0.0.1', self.porta, timeout=5)
        conn.putrequest('POST', '/api/mesa/grande/ops')
        conn.putheader('Content-Length', str(servidor.LIMITE_CORPO + 1))
        conn.endheaders()
        self.assertEqual(conn.getresponse().status, 413)
        conn.close()

    def test_pedido_invalido(self):
        self.assertEqual(self.req('POST', '/api/mesa/x/ops', {'ops': []})[0], 400)

    def test_sincronizacao(self):
        a = Sse(self.porta, 'sessao', 'cA', 'Ana')
        try:
            ini = a.proxima('estado')
            self.assertIsNone(ini['estado'])
            self.assertEqual(ini['v'], 0)
            self.assertEqual([j['nome'] for j in a.proxima('presenca')['jogadores']], ['Ana'])

            raiz = {'atores': [], 'chat': [], 'cena': {'tokens': []}}
            st, _ = self.req('POST', '/api/mesa/sessao/ops', {'cliente': 'cA', 'lote': 1, 'ops': [{'op': 'set', 'path': [], 'value': raiz}]})
            self.assertEqual(st, 200)
            m = a.proxima('ops')
            self.assertEqual((m['v'], m['origem'], m['lote']), (1, 'cA', 1))

            # reenvio do mesmo lote é ignorado (não gera nova versão)
            self.req('POST', '/api/mesa/sessao/ops', {'cliente': 'cA', 'lote': 1, 'ops': [{'op': 'set', 'path': [], 'value': {}}]})
            msg = {'op': 'ins', 'path': ['chat'], 'key': 'id', 'value': {'id': 'm1', 'texto': 'olá, mesa'}, 'after': None}
            self.req('POST', '/api/mesa/sessao/ops', {'cliente': 'cA', 'lote': 2, 'ops': [msg]})
            m = a.proxima('ops')
            self.assertEqual(m['v'], 2)
            self.assertEqual(m['ops'], [msg])

            # segundo jogador recebe o estado atual e aparece na presença
            b = Sse(self.porta, 'sessao', 'cB', 'Bruno')
            try:
                e = b.proxima('estado')
                self.assertEqual(e['v'], 2)
                self.assertEqual(e['lote'], 0)
                self.assertEqual(e['estado']['chat'][0]['texto'], 'olá, mesa')
                self.assertEqual(sorted(j['nome'] for j in a.proxima('presenca')['jogadores']), ['Ana', 'Bruno'])

                # operação de B chega aos dois; caminho inexistente não é repassado
                self.req('POST', '/api/mesa/sessao/ops', {'cliente': 'cB', 'lote': 1, 'ops': [
                    {'op': 'set', 'path': ['cena', 'colunas'], 'value': 30},
                    {'op': 'set', 'path': ['atores', {'id': 'sumiu'}, 'nome'], 'value': 'x'}]})
                for leitor in (a, b):
                    m = leitor.proxima('ops')
                    self.assertEqual((m['v'], m['origem']), (3, 'cB'))
                    self.assertEqual(len(m['ops']), 1)
            finally:
                b.fechar()
            self.assertEqual([j['nome'] for j in a.proxima('presenca')['jogadores']], ['Ana'])

            # reconexão de A: o servidor informa o último lote recebido dele
            a.fechar()
            a = Sse(self.porta, 'sessao', 'cA', 'Ana')
            e = a.proxima('estado')
            self.assertEqual((e['v'], e['lote']), (3, 2))
        finally:
            a.fechar()

        servidor.salvar_todas()
        with open(os.path.join(servidor.PASTA_MESAS, 'sessao.json'), encoding='utf-8') as f:
            salvo = json.load(f)
        self.assertEqual(salvo['v'], 3)
        self.assertEqual(salvo['estado']['cena']['colunas'], 30)

        # a mesa é recarregada do arquivo quando o servidor reinicia
        servidor.MESAS.clear()
        self.assertEqual(servidor.mesa('sessao').v, 3)


if __name__ == '__main__':
    unittest.main(verbosity=2)
