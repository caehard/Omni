#!/usr/bin/env python3
"""Testes do gerador de imagens (gerador.py) e da biblioteca no servidor (arquivos, permissões).

Usa um ComfyUI de mentira (servidor HTTP local que responde como o ComfyUI), então não precisa de placa de vídeo.
Uso: python tools/testar_gerador.py
"""
import http.client
import json
import os
import struct
import sys
import tempfile
import threading
import time
import unittest
import zlib
from functools import partial
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, RAIZ)
import gerador  # noqa: E402
import servidor  # noqa: E402


def png(cor=(200, 30, 30)):
    """PNG 1×1 válido."""
    def bloco(tipo, dados):
        return struct.pack('>I', len(dados)) + tipo + dados + struct.pack('>I', zlib.crc32(tipo + dados) & 0xffffffff)
    return (b'\x89PNG\r\n\x1a\n' + bloco(b'IHDR', struct.pack('>IIBBBBB', 1, 1, 8, 2, 0, 0, 0))
            + bloco(b'IDAT', zlib.compress(b'\x00' + bytes(cor))) + bloco(b'IEND', b''))


CAL = gerador.calibracao()
MODELOS = CAL['modelos']


class Fluxos(unittest.TestCase):
    def test_normalizar_limita(self):
        p = gerador.normalizar({'modelo': 'sdxl', 'positivo': ' taverna ', 'largura': 99999, 'altura': 100, 'passos': 500, 'cfg': -3, 'quantidade': 9, 'sampler': 'rm -rf'})
        self.assertEqual((p['positivo'], p['largura'], p['altura'], p['passos'], p['cfg'], p['quantidade'], p['sampler']), ('taverna', 1792, 512, 60, 0, 4, 'euler'))
        self.assertIsInstance(p['semente'], int)
        self.assertEqual(gerador.normalizar({'modelo': 'sdxl', 'positivo': 'x', 'semente': '42'})['semente'], 42)
        self.assertEqual(gerador.normalizar({'modelo': 'qwen', 'positivo': 'x', 'refs': ['a'], 'largura': 1000})['largura'], 992)  # múltiplo de 16

    def test_normalizar_recusa(self):
        for ped in ({'modelo': 'outro', 'positivo': 'x'}, {'modelo': 'sdxl', 'positivo': '  '}, {'modelo': 'qwen', 'positivo': 'x', 'refs': []}, 'lixo'):
            with self.subTest(ped):
                with self.assertRaises(ValueError):
                    gerador.normalizar(ped)

    def test_fluxo_sdxl(self):
        p = gerador.normalizar({'modelo': 'sdxl', 'positivo': 'tavern', 'negativo': 'people', 'largura': 1344, 'altura': 768, 'passos': 6, 'cfg': 2,
                                'sampler': 'dpmpp_sde', 'scheduler': 'karras', 'semente': 7, 'quantidade': 2})
        f = gerador.fluxo_sdxl(p, MODELOS)
        self.assertEqual(f['1']['inputs']['ckpt_name'], MODELOS['sdxl'])
        self.assertEqual(f['4']['inputs'], {'width': 1344, 'height': 768, 'batch_size': 2})
        k = f['5']['inputs']
        self.assertEqual((k['seed'], k['steps'], k['cfg'], k['sampler_name'], k['scheduler']), (7, 6, 2.0, 'dpmpp_sde', 'karras'))
        self.assertEqual(f['3']['inputs']['text'], 'people')
        self.assertEqual(f['7']['class_type'], 'SaveImage')

    def test_fluxo_qwen_com_referencias(self):
        p = gerador.normalizar({'modelo': 'qwen', 'positivo': 'Aria na ponte', 'refs': ['a', 'b'], 'passos': 4, 'cfg': 1, 'shift': 3.1, 'semente': 5})
        f = gerador.fluxo_qwen(p, MODELOS, ['omni/ref-a.png', 'omni/ref-b.png'])
        self.assertEqual(f['1']['class_type'], 'UnetLoaderGGUF')  # o Qwen compactado (GGUF)
        self.assertEqual(f['2']['inputs'], {'clip_name': MODELOS['qwen_clip'], 'type': 'qwen_image', 'device': 'default'})
        enc = f['7']['inputs']
        self.assertEqual((enc['image1'], enc['image2'], 'image3' in enc), (['21', 0], ['22', 0], False))
        self.assertEqual(f['21']['inputs']['image'], 'omni/ref-a.png')
        self.assertEqual(f['12']['inputs']['model'], ['6', 0])  # passa pela LoRA Lightning
        self.assertEqual(f['4']['inputs']['shift'], 3.1)
        self.assertEqual(f['9']['inputs']['reference_latents_method'], 'index_timestep_zero')
        self.assertEqual(f['11']['class_type'], 'EmptySD3LatentImage')
        # todas as ligações apontam para nós que existem
        for nid, no in f.items():
            for v in no['inputs'].values():
                if isinstance(v, list) and len(v) == 2 and isinstance(v[0], str):
                    self.assertIn(v[0], f, f'{nid} liga em {v[0]}')
        sem_gguf = gerador.fluxo_qwen(p, {**MODELOS, 'qwen_unet': 'modelo.safetensors', 'qwen_lora': ''}, ['x.png'])
        self.assertEqual(sem_gguf['1']['class_type'], 'UNETLoader')
        self.assertEqual(sem_gguf['12']['inputs']['model'], ['5', 0])

    def test_saida_do_historico(self):
        self.assertEqual(gerador.imagens_da_saida(None), (False, None, []))
        ok = {'status': {'status_str': 'success', 'completed': True}, 'outputs': {'7': {'images': [{'filename': 'a.png', 'subfolder': 'omni', 'type': 'output'}, {'filename': 'p.png', 'type': 'temp'}]}}}
        self.assertEqual(gerador.imagens_da_saida(ok), (True, None, [{'filename': 'a.png', 'subfolder': 'omni', 'type': 'output'}]))
        erro = {'status': {'status_str': 'error', 'messages': [['execution_error', {'node_type': 'KSampler', 'exception_message': 'CUDA out of memory'}]]}}
        self.assertEqual(gerador.imagens_da_saida(erro), (True, 'KSampler: CUDA out of memory', []))


# ---------------------------------------------------------------------------
# ComfyUI de mentira
# ---------------------------------------------------------------------------

class FalsoComfy(BaseHTTPRequestHandler):
    prompts = {}      # id -> fluxo
    enviados = []     # imagens recebidas em /upload/image
    consultas = {}    # id -> nº de vezes que /history foi consultado

    def log_message(self, *a):
        pass

    def _json(self, obj, codigo=200):
        b = json.dumps(obj).encode()
        self.send_response(codigo)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(b)))
        self.end_headers()
        self.wfile.write(b)

    def do_GET(self):
        u = urlparse(self.path)
        if u.path == '/system_stats':
            return self._json({'system': {}})
        if u.path == '/object_info/CheckpointLoaderSimple':
            return self._json({'CheckpointLoaderSimple': {'input': {'required': {'ckpt_name': [[MODELOS['sdxl']]]}}}})
        if u.path == '/object_info/UnetLoaderGGUF':
            return self._json({'UnetLoaderGGUF': {'input': {'required': {'unet_name': [[MODELOS['qwen_unet']]]}}}})
        if u.path == '/queue':
            return self._json({'queue_running': [[0, pid] for pid in list(self.prompts)[-1:]], 'queue_pending': []})
        if u.path.startswith('/history/'):
            pid = u.path.rsplit('/', 1)[1]
            n = self.consultas[pid] = self.consultas.get(pid, 0) + 1
            if n < 2:
                return self._json({})  # ainda gerando
            fl = self.prompts[pid]
            lote = next((no['inputs'].get('batch_size', 1) for no in fl.values() if no['class_type'] == 'EmptyLatentImage'), 1)
            return self._json({pid: {'status': {'status_str': 'success', 'completed': True},
                                     'outputs': {'7': {'images': [{'filename': f'{pid}-{i}.png', 'subfolder': 'omni', 'type': 'output'} for i in range(lote)]}}}})
        if u.path == '/view':
            nome = parse_qs(u.query)['filename'][0]
            b = png(tuple(zlib.crc32(nome.encode()).to_bytes(4, 'big')[:3]))  # cada imagem diferente
            self.send_response(200)
            self.send_header('Content-Type', 'image/png')
            self.send_header('Content-Length', str(len(b)))
            self.end_headers()
            return self.wfile.write(b)
        self._json({'erro': 'rota'}, 404)

    def do_POST(self):
        corpo = self.rfile.read(int(self.headers.get('Content-Length', 0)))
        if self.path == '/prompt':
            fl = json.loads(corpo)['prompt']
            if any(no['class_type'] == 'CheckpointLoaderSimple' and no['inputs']['ckpt_name'] != MODELOS['sdxl'] for no in fl.values()):
                return self._json({'error': {'message': 'Prompt outputs failed validation'}, 'node_errors': {'1': {'class_type': 'CheckpointLoaderSimple', 'errors': [{'message': 'Value not in list', 'details': 'ckpt_name'}]}}}, 400)
            pid = f'p{len(self.prompts) + 1}'
            self.prompts[pid] = fl
            return self._json({'prompt_id': pid, 'number': len(self.prompts)})
        if self.path == '/free':
            FalsoComfy.liberou = json.loads(corpo)
            return self._json({})
        if self.path == '/upload/image':
            self.enviados.append(corpo)
            return self._json({'name': f'ref-{len(self.enviados)}.png', 'subfolder': 'omni', 'type': 'input'})
        self._json({'erro': 'rota'}, 404)


def esperar(cond, tempo=10):
    fim = time.time() + tempo
    while time.time() < fim:
        if cond():
            return True
        time.sleep(0.05)
    return False


class Integracao(unittest.TestCase):
    """Servidor da mesa + ComfyUI de mentira: pedido -> fila -> imagens na biblioteca (ocultas)."""

    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        servidor.PASTA_MESAS = cls.tmp.name
        servidor.PASTA_ARQUIVOS = os.path.join(cls.tmp.name, 'arquivos')
        servidor.MESAS.clear()
        cls.comfy = ThreadingHTTPServer(('127.0.0.1', 0), FalsoComfy)
        threading.Thread(target=cls.comfy.serve_forever, daemon=True).start()
        servidor.GERADOR = gerador.Gerador(f'http://127.0.0.1:{cls.comfy.server_address[1]}')
        cls.srv = ThreadingHTTPServer(('127.0.0.1', 0), partial(servidor.Handler, directory=RAIZ))
        cls.srv.daemon_threads = True
        cls.porta = cls.srv.server_address[1]
        threading.Thread(target=cls.srv.serve_forever, daemon=True).start()
        ms = servidor.mesa('camp')
        ms.estado = {'atores': [], 'cenas': [], 'chat': [], 'biblioteca': [{'id': 'velho', 'tipo': 'imagem', 'nome': 'x', 'url': '', 'de': 'mestre'}]}

    @classmethod
    def tearDownClass(cls):
        for s in (cls.srv, cls.comfy):
            s.shutdown()
            s.server_close()
        cls.tmp.cleanup()

    def req(self, metodo, caminho, corpo=None, headers=None, bruto=False):
        conn = http.client.HTTPConnection('127.0.0.1', self.porta, timeout=10)
        dados = corpo if bruto else (json.dumps(corpo).encode() if corpo is not None else None)
        conn.request(metodo, caminho, body=dados, headers=headers or ({'Content-Type': 'application/json'} if dados else {}))
        r = conn.getresponse()
        texto = r.read()
        cab = dict(r.getheaders())
        conn.close()
        return r.status, texto, cab

    def test_envio_e_leitura_de_arquivos(self):
        img = png()
        st, txt, _ = self.req('POST', '/api/mesa/camp/arquivos', img, {'Content-Type': 'image/png'}, bruto=True)
        self.assertEqual(st, 200)
        url = json.loads(txt)['url']
        self.assertRegex(url, r'^/api/mesa/camp/arquivos/[0-9a-f]{24}\.png$')
        st2, txt2, _ = self.req('POST', '/api/mesa/camp/arquivos', img, {'Content-Type': 'image/png'}, bruto=True)
        self.assertEqual(json.loads(txt2)['url'], url)  # mesmo conteúdo, mesmo arquivo
        st, corpo, cab = self.req('GET', url)
        self.assertEqual((st, corpo, cab['Content-Type'], cab['X-Content-Type-Options']), (200, img, 'image/png', 'nosniff'))
        st, corpo, cab = self.req('GET', url, headers={'Range': 'bytes=0-7'})  # música: pedaços para começar do meio
        self.assertEqual((st, corpo, cab['Content-Range']), (206, img[:8], f'bytes 0-7/{len(img)}'))
        self.assertEqual(self.req('GET', url, headers={'Range': 'bytes=9999-'})[0], 416)
        self.assertEqual(servidor.ler_arquivo(url), (img, 'image/png'))

    def test_arquivo_recusado(self):
        for tipo, dados in (('text/html', b'<script>alert(1)</script>'), ('image/svg+xml', b'<svg onload=alert(1)>'), ('image/png', b'<html>nao e png')):
            with self.subTest(tipo):
                self.assertEqual(self.req('POST', '/api/mesa/camp/arquivos', dados, {'Content-Type': tipo}, bruto=True)[0], 415)
        for p in ('/api/mesa/camp/arquivos/../camp.json', '/api/mesa/camp/arquivos/abc.png', '/api/mesa/camp/arquivos/' + '0' * 24 + '.png'):
            with self.subTest(p):
                self.assertEqual(self.req('GET', p)[0], 404)

    def test_gerador_so_para_o_mestre(self):
        h = {'Content-Type': 'application/json', 'Cf-Connecting-Ip': '1.2.3.4'}  # veio pelo túnel: jogador
        self.assertEqual(self.req('GET', '/api/mesa/camp/gerador/estado', headers=h)[0], 403)
        self.assertEqual(self.req('POST', '/api/mesa/camp/gerador/gerar', json.dumps({'pedido': {}}).encode(), h, bruto=True)[0], 403)
        st, txt, _ = self.req('GET', '/api/mesa/camp/gerador/estado')
        e = json.loads(txt)
        self.assertEqual(st, 200)
        self.assertTrue(e['ligado'])
        self.assertEqual(e['modelos']['checkpoints'], [MODELOS['sdxl']])

    def gerar(self, pedido, item):
        st, txt, _ = self.req('POST', '/api/mesa/camp/gerador/gerar', {'pedido': pedido, 'item': item, 'jogador': 'mestre-1'})
        self.assertEqual(st, 200, txt)
        tid = json.loads(txt)['id']
        t = {}

        def pronto():
            nonlocal t
            t = json.loads(self.req('GET', f'/api/mesa/camp/gerador/trabalho?id={tid}')[1])
            return t['estado'] in ('pronto', 'erro')
        self.assertTrue(esperar(pronto), t)
        return t

    def test_gera_cenario_e_poe_na_biblioteca_oculto(self):
        t = self.gerar({'modelo': 'sdxl', 'positivo': 'tavern', 'quantidade': 2, 'semente': 11},
                       {'tipo': 'imagem', 'nome': 'Taverna', 'origem': {'modo': 'cenario', 'texto': 'taverna'}})
        self.assertEqual(t['estado'], 'pronto', t)
        self.assertEqual(len(t['urls']), 2)
        bib = servidor.mesa('camp').estado['biblioteca']
        novos = [i for i in bib if i['url'] in t['urls']]
        self.assertEqual([i['nome'] for i in novos], ['Taverna (1)', 'Taverna (2)'])
        self.assertTrue(all(i['oculto'] and i['de'] == 'mestre-1' and i['origem']['gerado'] and i['origem']['modo'] == 'cenario' for i in novos))
        self.assertEqual(bib[0]['id'], 'velho')  # entra no fim (a interface mostra os mais novos primeiro)
        self.assertEqual(servidor.ler_arquivo(t['urls'][0])[1], 'image/png')
        # o jogador não recebe o que está oculto
        self.assertEqual([i['id'] for i in servidor.vista_jogador(servidor.mesa('camp').estado, 'ana')['biblioteca']], ['velho'])

    def test_cena_com_personagens_envia_as_referencias(self):
        _, txt, _ = self.req('POST', '/api/mesa/camp/arquivos', png((1, 2, 3)), {'Content-Type': 'image/png'}, bruto=True)
        ref = json.loads(txt)['url']
        antes = len(FalsoComfy.enviados)
        t = self.gerar({'modelo': 'qwen', 'positivo': 'Aria (the character in Picture 1) on a bridge', 'refs': [ref, 'data:image/png;base64,' + __import__('base64').b64encode(png()).decode()], 'quantidade': 2},
                       {'tipo': 'imagem', 'nome': 'Ponte'})
        self.assertEqual(t['estado'], 'pronto', t)
        self.assertEqual(len(FalsoComfy.enviados) - antes, 2)  # as duas imagens de referência foram ao ComfyUI
        self.assertIn(png((1, 2, 3)), FalsoComfy.enviados[antes])
        fluxos = [f for f in FalsoComfy.prompts.values() if any(n['class_type'] == 'TextEncodeQwenImageEditPlus' for n in f.values())][-2:]
        self.assertEqual(len(fluxos), 2)  # um por imagem, com sementes seguidas
        self.assertEqual(fluxos[1]['12']['inputs']['seed'] - fluxos[0]['12']['inputs']['seed'], 1)
        self.assertEqual(fluxos[0]['21']['inputs']['image'], f'omni/ref-{antes + 1}.png')

    def test_erros_legiveis(self):
        st, txt, _ = self.req('POST', '/api/mesa/camp/gerador/gerar', {'pedido': {'modelo': 'qwen', 'positivo': 'x', 'refs': ['/api/mesa/camp/arquivos/' + 'f' * 24 + '.png']}})
        self.assertEqual((st, json.loads(txt)['erro']), (400, 'não achei uma das imagens de referência'))
        velho = servidor.GERADOR
        try:
            servidor.GERADOR = gerador.Gerador(velho.url)
            orig = gerador.calibracao
            gerador.calibracao = lambda: {**CAL, 'modelos': {**MODELOS, 'sdxl': 'nao-existe.safetensors'}}
            st, txt, _ = self.req('POST', '/api/mesa/camp/gerador/gerar', {'pedido': {'modelo': 'sdxl', 'positivo': 'x'}})
            self.assertEqual(st, 400)
            self.assertIn('CheckpointLoaderSimple: Value not in list ckpt_name', json.loads(txt)['erro'])
        finally:
            gerador.calibracao = orig
            servidor.GERADOR = velho
        desligado = gerador.Gerador('http://127.0.0.1:9')  # nada escutando
        self.assertFalse(desligado.estado()['ligado'])

    def test_desligar_libera_a_memoria(self):
        # o ComfyUI de mentira não foi aberto pela mesa: só pede para soltar os modelos
        st, txt, _ = self.req('POST', '/api/mesa/camp/gerador/desligar', {})
        self.assertEqual((st, json.loads(txt)), (200, {'desligar': 'memoria-liberada'}))
        self.assertEqual(FalsoComfy.liberou, {'unload_models': True, 'free_memory': True})
        self.assertEqual(self.req('POST', '/api/mesa/camp/gerador/desligar', b'{}', {'Content-Type': 'application/json', 'X-Forwarded-For': '9.9.9.9'}, bruto=True)[0], 403)


class Biblioteca(unittest.TestCase):
    def estado(self):
        return {'biblioteca': [
            {'id': 'a', 'tipo': 'imagem', 'nome': 'Mapa', 'url': 'u1', 'de': 'mestre'},
            {'id': 'b', 'tipo': 'personagem', 'nome': 'Aria', 'url': 'u2', 'de': 'ana'},
            {'id': 'c', 'tipo': 'imagem', 'nome': 'Segredo', 'url': 'u3', 'de': 'mestre', 'oculto': True},
            {'id': 'd', 'tipo': 'imagem', 'nome': 'Meu rascunho', 'url': 'u4', 'de': 'ana', 'oculto': True},
        ]}

    def test_vista(self):
        self.assertEqual([i['id'] for i in servidor.vista_jogador(self.estado(), 'ana')['biblioteca']], ['a', 'b', 'd'])
        self.assertEqual([i['id'] for i in servidor.vista_jogador(self.estado(), 'bruno')['biblioteca']], ['a', 'b'])

    def test_permissoes(self):
        e = self.estado()
        ins = {'op': 'ins', 'path': ['biblioteca'], 'key': 'id', 'value': {'id': 'n', 'tipo': 'musica', 'nome': 'x', 'de': 'mestre', 'oculto': True}, 'after': 'd'}
        self.assertTrue(servidor.pode(e, 'ana', ins))
        self.assertEqual((ins['value']['de'], ins['value']['oculto']), ('ana', False))  # o autor é quem enviou; jogador não esconde
        nao = [
            {'op': 'ins', 'path': ['biblioteca'], 'key': 'id', 'value': {'id': 'c', 'tipo': 'imagem'}},  # substituiria o do mestre
            {'op': 'ins', 'path': ['biblioteca'], 'key': 'id', 'value': {'id': 'z', 'tipo': 'script'}},
            {'op': 'set', 'path': ['biblioteca', {'id': 'a'}, 'nome'], 'value': 'meu'},
            {'op': 'del', 'path': ['biblioteca', {'id': 'a'}]},
            {'op': 'set', 'path': ['biblioteca', {'id': 'b'}, 'oculto'], 'value': True},
            {'op': 'set', 'path': ['biblioteca', {'id': 'b'}, 'de'], 'value': 'mestre'},
            {'op': 'set', 'path': ['biblioteca'], 'value': []},
            {'op': 'set', 'path': ['musica'], 'value': {'url': 'x', 'tocando': True}},
        ]
        for op in nao:
            with self.subTest(op):
                self.assertFalse(servidor.pode(e, 'ana', op))
        for op in ({'op': 'set', 'path': ['biblioteca', {'id': 'b'}, 'token'], 'value': 'tok'}, {'op': 'set', 'path': ['biblioteca', {'id': 'b'}, 'descricao'], 'value': 'elfa'},
                   {'op': 'del', 'path': ['biblioteca', {'id': 'b'}]}):
            with self.subTest(op):
                self.assertTrue(servidor.pode(e, 'ana', op))

    def test_tipo_do_envio(self):
        self.assertEqual(servidor.tipo_do_envio('image/png', png()), 'png')
        self.assertEqual(servidor.tipo_do_envio('image/jpeg; charset=x', b'\xff\xd8\xff\xe0...'), 'jpg')
        self.assertEqual(servidor.tipo_do_envio('audio/mpeg', b'ID3...'), 'mp3')
        self.assertEqual(servidor.tipo_do_envio('application/pdf', b'%PDF-1.7'), 'pdf')
        self.assertIsNone(servidor.tipo_do_envio('image/webp', b'RIFF....WAVE'))
        self.assertIsNone(servidor.tipo_do_envio('image/png', b''))


if __name__ == '__main__':
    unittest.main(verbosity=1)
