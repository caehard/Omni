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

    def test_diff_reproduz_o_estado_novo(self):
        with open(os.path.join(RAIZ, 'vtt', 'tests', 'diff-casos.json'), encoding='utf-8') as f:
            casos = json.load(f)
        for c in casos:
            with self.subTest(c['nome']):
                ops = servidor.diff(c['a'], c['b'])
                estado, _ = servidor.aplicar(json.loads(json.dumps(c['a'])), json.loads(json.dumps(ops)))
                self.assertEqual(canon(estado), canon(c['b']))
                self.assertEqual(servidor.diff(c['b'], json.loads(json.dumps(c['b']))), [])

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


def mesa_exemplo():
    return {
        'atores': [
            {'id': 'pj', 'nome': 'Aria', 'donos': ['ana'], 'system': {'recursos': {'vida': 5}}},
            {'id': 'npc', 'nome': 'Bandido', 'system': {'recursos': {'vida': 3}}},
            {'id': 'emboscada', 'nome': 'Assassino', 'oculto': True, 'system': {}},
        ],
        'cenaAtiva': 'c1',
        'cenas': [
            {'id': 'c1', 'nome': 'Taverna', 'fundo': '', 'tokens': [
                {'id': 't1', 'atorId': 'pj', 'x': 1, 'y': 1}, {'id': 't2', 'atorId': 'npc', 'x': 5, 'y': 1},
                {'id': 't3', 'atorId': 'npc', 'x': 6, 'y': 1, 'oculto': True}, {'id': 't4', 'atorId': 'emboscada', 'x': 9, 'y': 9}]},
            {'id': 'c2', 'nome': 'Covil (preparando)', 'fundo': '', 'tokens': []},
        ],
        'combate': {'ativo': True, 'rodada': 1, 'combatentes': [{'atorId': 'pj'}, {'atorId': 'emboscada'}]},
        'chat': [
            {'id': 'm1', 'texto': 'oi'},
            {'id': 'm2', 'texto': 'segredo do mestre', 'de': 'mestre', 'para': []},
            {'id': 'm3', 'texto': 'sussurro para Ana', 'de': 'bruno', 'para': ['ana']},
            {'id': 'm4', 'tipo': 'roll', 'atorId': 'pj', 'roll': {}, 'de': 'ana'},
        ],
        'regras': {},
    }


class Papeis(unittest.TestCase):
    def test_vista_do_jogador(self):
        v = servidor.vista_jogador(mesa_exemplo(), 'ana')
        self.assertEqual([a['id'] for a in v['atores']], ['pj', 'npc'])
        self.assertEqual([c['id'] for c in v['cenas']], ['c1'])
        self.assertEqual([t['id'] for t in v['cenas'][0]['tokens']], ['t1', 't2'])
        self.assertEqual([c['atorId'] for c in v['combate']['combatentes']], ['pj'])
        self.assertEqual([m['id'] for m in v['chat']], ['m1', 'm3', 'm4'])
        self.assertEqual([m['id'] for m in servidor.vista_jogador(mesa_exemplo(), 'bruno')['chat']], ['m1', 'm3', 'm4'])
        self.assertEqual([m['id'] for m in servidor.vista_jogador(mesa_exemplo(), 'carla')['chat']], ['m1', 'm4'])

    def test_vista_e_copia(self):
        e = mesa_exemplo()
        v = servidor.vista_jogador(e, 'ana')
        e['atores'][0]['nome'] = 'mudou'
        self.assertEqual(v['atores'][0]['nome'], 'Aria')

    def test_permissoes(self):
        e = mesa_exemplo()
        sim = [
            {'op': 'set', 'path': ['atores', {'id': 'pj'}, 'system', 'recursos', 'vida'], 'value': 4},
            {'op': 'set', 'path': ['cenas', {'id': 'c1'}, 'tokens', {'id': 't1'}, 'x'], 'value': 3},
            {'op': 'ins', 'path': ['chat'], 'key': 'id', 'value': {'id': 'm9', 'texto': 'oi', 'de': 'outro'}, 'after': 'm3'},
            {'op': 'set', 'path': ['chat', {'id': 'm4'}, 'rev'], 'value': 2},
            {'op': 'ins', 'path': ['atores'], 'key': 'id', 'value': {'id': 'novo', 'donos': ['ana']}, 'after': None},
            {'op': 'set', 'path': ['combate', 'combatentes', {'atorId': 'pj'}, 'acoes'], 'value': 1},
            {'op': 'ins', 'path': ['cenas', {'id': 'c1'}, 'tokens'], 'key': 'id', 'value': {'id': 't9', 'atorId': 'pj'}, 'after': None},
            {'op': 'del', 'path': ['cenas', {'id': 'c1'}, 'tokens', {'id': 't1'}]},
        ]
        nao = [
            {'op': 'set', 'path': ['atores', {'id': 'npc'}, 'system', 'recursos', 'vida'], 'value': 0},
            {'op': 'set', 'path': ['atores', {'id': 'pj'}, 'donos'], 'value': ['ana', 'bruno']},
            {'op': 'set', 'path': ['atores', {'id': 'pj'}, 'oculto'], 'value': True},
            {'op': 'set', 'path': ['cenas', {'id': 'c1'}, 'tokens', {'id': 't2'}, 'x'], 'value': 3},
            {'op': 'set', 'path': ['cenas', {'id': 'c1'}, 'fundo'], 'value': 'x'},
            {'op': 'set', 'path': ['cenaAtiva'], 'value': 'c2'},
            {'op': 'del', 'path': ['chat', {'id': 'm1'}]},
            {'op': 'set', 'path': ['chat', {'id': 'm2'}, 'rev'], 'value': 1},
            {'op': 'set', 'path': ['chat', {'id': 'm1'}, 'roll'], 'value': {}},  # cartão de outra pessoa
            {'op': 'ins', 'path': ['atores'], 'key': 'id', 'value': {'id': 'npc2'}, 'after': None},
            {'op': 'set', 'path': ['combate', 'rodada'], 'value': 2},
            {'op': 'set', 'path': ['regras', 'x'], 'value': True},
            {'op': 'set', 'path': [], 'value': {}},
        ]
        for op in sim:
            with self.subTest(sim=op['path']):
                self.assertTrue(servidor.pode(e, 'ana', op))
        for op in nao:
            with self.subTest(nao=op['path']):
                self.assertFalse(servidor.pode(e, 'ana', op))
        op = sim[2]
        servidor.pode(e, 'ana', op)
        self.assertEqual(op['value']['de'], 'ana')  # o servidor corrige o autor da mensagem

    def test_nevoa_esconde_tokens_alheios(self):
        e = mesa_exemplo()
        e['cenas'][0]['nevoa'] = {'ativa': True, 'revelado': {'5,1': 1}}
        e['cenas'][0]['tokens'].append({'id': 't5', 'atorId': 'npc', 'x': 4, 'y': 0, 'tamanho': 2})  # um quadrado em 5,1
        ids = [t['id'] for t in servidor.vista_jogador(e, 'ana')['cenas'][0]['tokens']]
        self.assertEqual(ids, ['t1', 't2', 't5'])  # t1 é de Ana (sempre vê); t2 e t5 estão revelados
        e['cenas'][0]['nevoa']['revelado'] = {}
        self.assertEqual([t['id'] for t in servidor.vista_jogador(e, 'ana')['cenas'][0]['tokens']], ['t1'])

    def test_desenhos(self):
        e = mesa_exemplo()
        e['cenas'][0]['desenhos'] = [{'id': 'd1', 'tipo': 'linha', 'de': 'mestre'}, {'id': 'd2', 'tipo': 'livre', 'de': 'ana'}]
        e['cenas'][1]['desenhos'] = []
        ins = {'op': 'ins', 'path': ['cenas', {'id': 'c1'}, 'desenhos'], 'key': 'id', 'value': {'id': 'd3', 'tipo': 'area', 'de': 'outro'}, 'after': 'd2'}
        self.assertTrue(servidor.pode(e, 'ana', ins))
        self.assertEqual(ins['value']['de'], 'ana')
        self.assertTrue(servidor.pode(e, 'ana', {'op': 'del', 'path': ['cenas', {'id': 'c1'}, 'desenhos', {'id': 'd2'}]}))
        self.assertFalse(servidor.pode(e, 'ana', {'op': 'del', 'path': ['cenas', {'id': 'c1'}, 'desenhos', {'id': 'd1'}]}))  # do mestre
        self.assertFalse(servidor.pode(e, 'ana', {'op': 'ins', 'path': ['cenas', {'id': 'c2'}, 'desenhos'], 'key': 'id', 'value': {'id': 'x', 'tipo': 'livre'}, 'after': None}))  # cena em preparo
        self.assertFalse(servidor.pode(e, 'ana', {'op': 'ins', 'path': ['cenas', {'id': 'c1'}, 'desenhos'], 'key': 'id', 'value': {'id': 'x', 'tipo': 'script'}, 'after': None}))
        self.assertFalse(servidor.pode(e, 'ana', {'op': 'set', 'path': ['cenas', {'id': 'c1'}, 'nevoa', 'ativa'], 'value': False}))

    def test_le_link_do_tunel(self):
        servidor.TUNEL['url'] = None
        achados = []
        servidor.ler_saida_tunel(['INF Starting tunnel', '|  https://abc-def-123.trycloudflare.com  |', 'https://outro.trycloudflare.com'], achados.append)
        self.assertEqual(achados, ['https://abc-def-123.trycloudflare.com'])
        servidor.TUNEL['url'] = None


class Sse:
    """Leitor simples de Server-Sent Events."""

    def __init__(self, porta, sala, cliente, nome, extra='', headers=None):
        self.conn = http.client.HTTPConnection('127.0.0.1', porta, timeout=5)
        self.conn.request('GET', f'/api/mesa/{sala}/eventos?cliente={cliente}&nome={nome}{extra}', headers=headers or {})
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

    def test_papeis(self):
        ops_url = '/api/mesa/papeis/ops'
        m = Sse(self.porta, 'papeis', 'gm', 'Mestre')
        try:
            e = m.proxima('estado')
            self.assertEqual(e['papel'], 'mestre')
            chave = e['chave']
            self.req('POST', ops_url, {'cliente': 'gm', 'lote': 1, 'ops': [{'op': 'set', 'path': [], 'value': mesa_exemplo()}]})
            m.proxima('ops')

            # jogador pelo túnel (cabeçalho do Cloudflare) não é mestre
            j = Sse(self.porta, 'papeis', 'cj', 'Ana', '&jogador=ana', headers={'Cf-Connecting-Ip': '203.0.113.9'})
            try:
                e = j.proxima('estado')
                self.assertEqual(e['papel'], 'jogador')
                self.assertNotIn('chave', e)
                self.assertEqual([t['id'] for t in e['estado']['cenas'][0]['tokens']], ['t1', 't2'])
                r = m.proxima('ops')  # o mestre recebe Ana na lista de jogadores
                self.assertEqual(r['origem'], 'servidor')
                self.assertEqual(servidor.mesa('papeis').estado['jogadores']['ana']['nome'], 'Ana')

                # o mestre revela o token oculto: o jogador recebe a inserção
                self.req('POST', ops_url, {'cliente': 'gm', 'lote': 2, 'ops': [{'op': 'del', 'path': ['cenas', {'id': 'c1'}, 'tokens', {'id': 't3'}, 'oculto']}]})
                r = j.proxima('ops')
                if r['origem'] == 'servidor':  # antes: a própria entrada de Ana na lista de jogadores
                    self.assertEqual(r['ops'][-1]['path'][0], 'jogadores')
                    r = j.proxima('ops')
                self.assertEqual([(o['op'], o['value']['id']) for o in r['ops']], [('ins', 't3')])
                self.assertEqual(m.proxima('ops')['origem'], 'gm')  # eco do próprio mestre

                # jogador move o próprio token: vale; o do NPC: recusado e o jogador recebe o estado de novo
                st, _ = self.req('POST', ops_url, {'cliente': 'cj', 'jogador': 'ana', 'lote': 1, 'ops': [{'op': 'set', 'path': ['cenas', {'id': 'c1'}, 'tokens', {'id': 't1'}, 'x'], 'value': 7}]},
                                 headers={'Content-Type': 'application/json', 'Cf-Connecting-Ip': '203.0.113.9'})
                self.assertEqual(st, 200)
                self.assertEqual(m.proxima('ops')['ops'][0]['value'], 7)
                j.proxima('ops')
                self.req('POST', ops_url, {'cliente': 'cj', 'jogador': 'ana', 'lote': 2, 'ops': [{'op': 'set', 'path': ['cenas', {'id': 'c1'}, 'tokens', {'id': 't2'}, 'x'], 'value': 0}]},
                         headers={'Content-Type': 'application/json', 'Cf-Connecting-Ip': '203.0.113.9'})
                self.assertEqual(m.proxima('ops')['ops'], [])
                e = j.proxima('estado')
                self.assertEqual((e['lote'], e['estado']['cenas'][0]['tokens'][1]['x']), (2, 5))
                self.assertEqual(servidor.mesa('papeis').estado['cenas'][0]['tokens'][1]['x'], 5)
            finally:
                j.fechar()

            # com a chave, mesmo pelo túnel, é mestre (link de co-mestre); "como=jogador" vira jogador
            c = Sse(self.porta, 'papeis', 'co', 'Co', f'&chave={chave}', headers={'Cf-Connecting-Ip': '203.0.113.9'})
            self.assertEqual(c.proxima('estado')['papel'], 'mestre')
            c.fechar()
            c = Sse(self.porta, 'papeis', 'vc', 'Eu', '&como=jogador')
            self.assertEqual(c.proxima('estado')['papel'], 'jogador')
            c.fechar()
        finally:
            m.fechar()

    def test_evento_passageiro(self):
        a = Sse(self.porta, 'ping', 'cA', 'Ana')
        try:
            a.proxima('estado')
            dados = {'tipo': 'ping', 'x': 10, 'y': 20}
            self.assertEqual(self.req('POST', '/api/mesa/ping/evento', {'cliente': 'cB', 'dados': dados})[0], 200)
            m = a.proxima('evento')
            self.assertEqual((m['origem'], m['dados']), ('cB', dados))
            self.assertEqual(servidor.mesa('ping').v, 0)  # não muda a versão nem é salvo
        finally:
            a.fechar()
        conn = http.client.HTTPConnection('127.0.0.1', self.porta, timeout=5)
        conn.putrequest('POST', '/api/mesa/ping/evento')
        conn.putheader('Content-Length', str(servidor.LIMITE_EVENTO + 1))
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
