"""Gerador de imagens do Omni: ponte entre a mesa (servidor.py) e um ComfyUI rodando neste PC.

Só a biblioteca padrão do Python. O ComfyUI é instalado à parte por tools/instalar-gerador.ps1, que grava
gerador.local.json com a pasta dele. A calibração (modelos, tamanhos, passos, textos-base) fica em
data/gerador.json; o navegador monta o texto do pedido (vtt/js/system/prompt.js) e o servidor monta o
fluxo (workflow) do ComfyUI, põe na fila, acompanha e guarda as imagens prontas na biblioteca da mesa.

Dois modelos:
  sdxl  -> Cenário e Personagem (DreamShaper XL Lightning: poucos passos, rápido)
  qwen  -> Cenário e personagem com imagens de referência (Qwen-Image-Edit-2511: lê até 3 imagens)
"""
import json
import os
import random
import subprocess
import sys
import threading
import time
import uuid
import urllib.error
import urllib.request
from urllib.parse import urlencode

RAIZ = os.path.dirname(os.path.abspath(__file__))
CONFIG_LOCAL = os.path.join(RAIZ, 'gerador.local.json')
CALIBRACAO = os.path.join(RAIZ, 'data', 'gerador.json')
URL_COMFY = os.environ.get('OMNI_COMFY', 'http://127.0.0.1:8188')

SAMPLERS = ('euler', 'euler_ancestral', 'dpmpp_sde', 'dpmpp_2m', 'dpmpp_2m_sde', 'dpmpp_3m_sde', 'lcm', 'uni_pc')
SCHEDULERS = ('simple', 'normal', 'karras', 'exponential', 'sgm_uniform', 'beta')
MAX_REFS = 3
TEMPO_MAXIMO = 20 * 60  # um pedido que passa disso é dado como perdido


def calibracao():
    with open(CALIBRACAO, encoding='utf-8') as f:
        return json.load(f)


# ---------------------------------------------------------------------------
# Pedido -> fluxo do ComfyUI (funções puras, testadas em tools/testar_gerador.py)
# ---------------------------------------------------------------------------

def _int(v, minimo, maximo, padrao):
    try:
        return max(minimo, min(maximo, int(v)))
    except (TypeError, ValueError):
        return padrao


def _num(v, minimo, maximo, padrao):
    try:
        return max(minimo, min(maximo, float(v)))
    except (TypeError, ValueError):
        return padrao


def normalizar(pedido):
    """Confere e limita o pedido vindo do navegador. Erro (ValueError) se não der para gerar."""
    if not isinstance(pedido, dict):
        raise ValueError('pedido inválido')
    modelo = pedido.get('modelo')
    if modelo not in ('sdxl', 'qwen'):
        raise ValueError('modelo deve ser sdxl ou qwen')
    positivo = str(pedido.get('positivo') or '').strip()[:4000]
    if not positivo:
        raise ValueError('descreva a imagem')
    refs = [str(r) for r in (pedido.get('refs') or []) if r][:MAX_REFS] if modelo == 'qwen' else []
    if modelo == 'qwen' and not refs:
        raise ValueError('o modelo de referências precisa de pelo menos uma imagem')
    arred = 16 if modelo == 'qwen' else 8
    lado = lambda v, p: _int(v, 512, 1792, p) // arred * arred
    semente = pedido.get('semente')
    return {
        'modelo': modelo,
        'positivo': positivo,
        'negativo': str(pedido.get('negativo') or '').strip()[:2000],
        'largura': lado(pedido.get('largura'), 1024),
        'altura': lado(pedido.get('altura'), 1024),
        'passos': _int(pedido.get('passos'), 1, 60, 6),
        'cfg': _num(pedido.get('cfg'), 0, 15, 2),
        'sampler': pedido.get('sampler') if pedido.get('sampler') in SAMPLERS else 'euler',
        'scheduler': pedido.get('scheduler') if pedido.get('scheduler') in SCHEDULERS else 'simple',
        'shift': _num(pedido.get('shift'), 0.5, 15, 3.1),
        'semente': _int(semente, 0, 2**48, 0) if semente not in (None, '') else random.randrange(2**48),
        'quantidade': _int(pedido.get('quantidade'), 1, 4, 1),
        'refs': refs,
    }


def fluxo_sdxl(p, modelos):
    """Texto -> imagem com um checkpoint SDXL. Gera p['quantidade'] imagens de uma vez (lote)."""
    return {
        '1': {'class_type': 'CheckpointLoaderSimple', 'inputs': {'ckpt_name': modelos['sdxl']}},
        '2': {'class_type': 'CLIPTextEncode', 'inputs': {'clip': ['1', 1], 'text': p['positivo']}},
        '3': {'class_type': 'CLIPTextEncode', 'inputs': {'clip': ['1', 1], 'text': p['negativo']}},
        '4': {'class_type': 'EmptyLatentImage', 'inputs': {'width': p['largura'], 'height': p['altura'], 'batch_size': p['quantidade']}},
        '5': {'class_type': 'KSampler', 'inputs': {
            'model': ['1', 0], 'positive': ['2', 0], 'negative': ['3', 0], 'latent_image': ['4', 0],
            'seed': p['semente'], 'steps': p['passos'], 'cfg': p['cfg'],
            'sampler_name': p['sampler'], 'scheduler': p['scheduler'], 'denoise': 1.0}},
        '6': {'class_type': 'VAEDecode', 'inputs': {'samples': ['5', 0], 'vae': ['1', 2]}},
        '7': {'class_type': 'SaveImage', 'inputs': {'images': ['6', 0], 'filename_prefix': 'omni/sdxl'}},
    }


def fluxo_qwen(p, modelos, imagens, semente=None):
    """Qwen-Image-Edit-2511 com até 3 imagens de referência numa tela nova (mesmo encadeamento do modelo
    oficial do ComfyUI: AuraFlow shift -> CFGNorm -> LoRA Lightning; referências pelo índice com passo zero).
    `imagens` são os nomes já enviados ao ComfyUI (/upload/image)."""
    unet = modelos['qwen_unet']
    carregar = ({'class_type': 'UnetLoaderGGUF', 'inputs': {'unet_name': unet}} if unet.endswith('.gguf')
                else {'class_type': 'UNETLoader', 'inputs': {'unet_name': unet, 'weight_dtype': 'default'}})
    f = {
        '1': carregar,
        '2': {'class_type': 'CLIPLoader', 'inputs': {'clip_name': modelos['qwen_clip'], 'type': 'qwen_image', 'device': 'default'}},
        '3': {'class_type': 'VAELoader', 'inputs': {'vae_name': modelos['qwen_vae']}},
        '4': {'class_type': 'ModelSamplingAuraFlow', 'inputs': {'model': ['1', 0], 'shift': p['shift']}},
        '5': {'class_type': 'CFGNorm', 'inputs': {'model': ['4', 0], 'strength': 1.0}},
    }
    modelo = ['5', 0]
    if modelos.get('qwen_lora'):
        f['6'] = {'class_type': 'LoraLoaderModelOnly', 'inputs': {'model': ['5', 0], 'lora_name': modelos['qwen_lora'], 'strength_model': 1.0}}
        modelo = ['6', 0]
    refs = {}
    for i, nome in enumerate(imagens[:MAX_REFS], start=1):
        f[f'2{i}'] = {'class_type': 'LoadImage', 'inputs': {'image': nome}}
        refs[f'image{i}'] = [f'2{i}', 0]
    f['7'] = {'class_type': 'TextEncodeQwenImageEditPlus', 'inputs': {'clip': ['2', 0], 'vae': ['3', 0], 'prompt': p['positivo'], **refs}}
    f['8'] = {'class_type': 'TextEncodeQwenImageEditPlus', 'inputs': {'clip': ['2', 0], 'vae': ['3', 0], 'prompt': p['negativo'], **refs}}
    f['9'] = {'class_type': 'FluxKontextMultiReferenceLatentMethod', 'inputs': {'conditioning': ['7', 0], 'reference_latents_method': 'index_timestep_zero'}}
    f['10'] = {'class_type': 'FluxKontextMultiReferenceLatentMethod', 'inputs': {'conditioning': ['8', 0], 'reference_latents_method': 'index_timestep_zero'}}
    f['11'] = {'class_type': 'EmptySD3LatentImage', 'inputs': {'width': p['largura'], 'height': p['altura'], 'batch_size': 1}}
    f['12'] = {'class_type': 'KSampler', 'inputs': {
        'model': modelo, 'positive': ['9', 0], 'negative': ['10', 0], 'latent_image': ['11', 0],
        'seed': p['semente'] if semente is None else semente, 'steps': p['passos'], 'cfg': p['cfg'],
        'sampler_name': p['sampler'], 'scheduler': p['scheduler'], 'denoise': 1.0}}
    f['13'] = {'class_type': 'VAEDecode', 'inputs': {'samples': ['12', 0], 'vae': ['3', 0]}}
    f['14'] = {'class_type': 'SaveImage', 'inputs': {'images': ['13', 0], 'filename_prefix': 'omni/qwen'}}
    return f


def _multipart(campos, arquivo_campo, nome_arquivo, dados, mime):
    limite = 'omni' + uuid.uuid4().hex
    partes = []
    for k, v in campos.items():
        partes.append(f'--{limite}\r\nContent-Disposition: form-data; name="{k}"\r\n\r\n{v}\r\n'.encode())
    partes.append(f'--{limite}\r\nContent-Disposition: form-data; name="{arquivo_campo}"; filename="{nome_arquivo}"\r\n'
                  f'Content-Type: {mime}\r\n\r\n'.encode() + dados + b'\r\n')
    partes.append(f'--{limite}--\r\n'.encode())
    return b''.join(partes), f'multipart/form-data; boundary={limite}'


def imagens_da_saida(historico):
    """Da resposta de /history/<id>: (pronto, erro, [ {filename, subfolder, type} ])."""
    if not historico:
        return False, None, []
    st = historico.get('status') or {}
    if st.get('status_str') == 'error':
        msg = 'o ComfyUI deu erro'
        for nome, dados in st.get('messages') or []:
            if nome == 'execution_error' and isinstance(dados, dict):
                msg = f"{dados.get('node_type', '')}: {dados.get('exception_message', '')}".strip(': ')
        return True, msg, []
    if not st.get('completed', bool(historico.get('outputs'))):
        return False, None, []
    imgs = []
    for saida in (historico.get('outputs') or {}).values():
        imgs += [i for i in saida.get('images') or [] if i.get('type') == 'output']
    return True, None, imgs


# ---------------------------------------------------------------------------
# Conversa com o ComfyUI
# ---------------------------------------------------------------------------

class Gerador:
    def __init__(self, url=URL_COMFY):
        self.url = url.rstrip('/')
        self.proc = None
        self.iniciado_em = None
        self.lock = threading.Lock()
        self.trabalhos = {}            # id -> dict (ver gerar)
        self.duracoes = {}             # modelo -> segundos do último pedido (para a barra de progresso)
        self.cliente = uuid.uuid4().hex

    # ---- instalação e processo ----
    def pasta(self):
        try:
            with open(CONFIG_LOCAL, encoding='utf-8') as f:
                return json.load(f).get('comfyui')
        except (OSError, ValueError):
            return None

    def _python(self):
        p = self.pasta()
        exe = p and os.path.join(p, 'python_embeded', 'python.exe')
        return exe if exe and os.path.isfile(exe) else None

    def _http(self, metodo, caminho, corpo=None, tipo='application/json', tempo=10):
        req = urllib.request.Request(self.url + caminho, data=corpo, method=metodo)
        if corpo is not None:
            req.add_header('Content-Type', tipo)
        with urllib.request.urlopen(req, timeout=tempo) as r:
            return r.read()

    def _json(self, metodo, caminho, obj=None, tempo=10):
        corpo = None if obj is None else json.dumps(obj).encode()
        return json.loads(self._http(metodo, caminho, corpo, tempo=tempo) or b'null')

    def ligado(self):
        try:
            self._http('GET', '/system_stats', tempo=2)
            return True
        except (OSError, ValueError):
            return False

    def ligar(self):
        if self.ligado():
            return 'ligado'
        with self.lock:
            if self.proc and self.proc.poll() is None:
                return 'iniciando'
            py = self._python()
            if not py:
                return 'nao-instalado'
            base = self.pasta()
            os.makedirs(os.path.join(RAIZ, 'mesas'), exist_ok=True)
            log = open(os.path.join(RAIZ, 'mesas', 'comfyui.log'), 'w', encoding='utf-8', errors='replace')
            porta = self.url.rsplit(':', 1)[-1]
            args = [py, '-s', os.path.join(base, 'ComfyUI', 'main.py'), '--windows-standalone-build',
                    '--listen', '127.0.0.1', '--port', porta, '--disable-auto-launch']
            flags = getattr(subprocess, 'CREATE_NO_WINDOW', 0)
            self.proc = subprocess.Popen(args, cwd=base, stdout=log, stderr=subprocess.STDOUT, creationflags=flags)
            self.iniciado_em = time.time()
            return 'iniciando'

    def desligar(self):
        """Fecha o ComfyUI se foi a mesa que o abriu; senão, só pede para ele soltar a memória (placa de vídeo e RAM)."""
        if self.proc and self.proc.poll() is None:
            self.proc.terminate()
            try:
                self.proc.wait(10)
            except subprocess.TimeoutExpired:
                self.proc.kill()
            return 'desligado'
        try:
            self._json('POST', '/free', {'unload_models': True, 'free_memory': True})
            return 'memoria-liberada'
        except (OSError, ValueError):
            return 'desligado'

    def estado(self):
        """O que a aba Gerador mostra: instalado? ligado? quais modelos existem? quantos na fila?"""
        e = {'instalado': bool(self._python()), 'ligado': False,
             'iniciando': bool(self.proc and self.proc.poll() is None), 'modelos': {}, 'fila': 0,
             'duracoes': dict(self.duracoes)}
        if self.proc and self.proc.poll() is not None:
            e['iniciando'] = False
            e['saiu'] = self.proc.returncode
        if not self.ligado():
            return e
        e['ligado'], e['iniciando'] = True, False
        try:
            info = self._json('GET', '/object_info/CheckpointLoaderSimple')
            e['modelos']['checkpoints'] = info['CheckpointLoaderSimple']['input']['required']['ckpt_name'][0]
        except (OSError, ValueError, KeyError, TypeError):
            pass
        try:
            info = self._json('GET', '/object_info/UnetLoaderGGUF')
            e['modelos']['unet'] = info['UnetLoaderGGUF']['input']['required']['unet_name'][0]
        except (OSError, ValueError, KeyError, TypeError):
            e['modelos']['unet'] = []
        try:
            q = self._json('GET', '/queue')
            e['fila'] = len(q.get('queue_running') or []) + len(q.get('queue_pending') or [])
        except (OSError, ValueError, AttributeError):
            pass
        return e

    # ---- pedidos ----
    def enviar_imagem(self, dados, mime='image/png'):
        ext = {'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif'}.get(mime, 'png')
        corpo, tipo = _multipart({'type': 'input', 'overwrite': 'true', 'subfolder': 'omni'}, 'image',
                                 f'ref-{uuid.uuid4().hex[:12]}.{ext}', dados, mime)
        r = json.loads(self._http('POST', '/upload/image', corpo, tipo, tempo=60))
        return f"{r['subfolder']}/{r['name']}" if r.get('subfolder') else r['name']

    def gerar(self, pedido, ler_ref, ao_terminar):
        """Põe na fila. ler_ref(url) -> (bytes, mime) | None; ao_terminar(trabalho, [(bytes, mime)]) guarda as imagens.
        Devolve o id do trabalho (acompanhe com trabalho(id))."""
        p = normalizar(pedido)
        modelos = calibracao()['modelos']
        if p['modelo'] == 'qwen':
            nomes = []
            for url in p['refs']:
                ref = ler_ref(url)
                if not ref:
                    raise ValueError('não achei uma das imagens de referência')
                nomes.append(self.enviar_imagem(*ref))
            fluxos = [fluxo_qwen(p, modelos, nomes, semente=p['semente'] + i) for i in range(p['quantidade'])]
        else:
            fluxos = [fluxo_sdxl(p, modelos)]
        ids = []
        for fl in fluxos:
            try:
                r = self._json('POST', '/prompt', {'prompt': fl, 'client_id': self.cliente}, tempo=30)
            except urllib.error.HTTPError as e:
                raise ValueError(_erro_comfy(e)) from None
            ids.append(r['prompt_id'])
        t = {'id': uuid.uuid4().hex[:12], 'prompts': ids, 'modelo': p['modelo'], 'estado': 'fila', 'criado': time.time(),
             'inicio': None, 'semente': p['semente'], 'urls': [], 'erro': None, 'pedido': pedido}
        with self.lock:
            self.trabalhos[t['id']] = t
            for velho in sorted(self.trabalhos.values(), key=lambda x: x['criado'])[:-40]:
                self.trabalhos.pop(velho['id'], None)
        threading.Thread(target=self._acompanhar, args=(t, ao_terminar), daemon=True).start()
        return t['id']

    def _acompanhar(self, t, ao_terminar):
        prontas, pendentes = [], list(t['prompts'])
        while pendentes:
            if time.time() - t['criado'] > TEMPO_MAXIMO:
                t['estado'], t['erro'] = 'erro', 'demorou demais (o ComfyUI travou?)'
                return
            time.sleep(1)
            try:
                if t['estado'] == 'fila':
                    q = self._json('GET', '/queue')
                    if any(len(x) > 1 and x[1] in t['prompts'] for x in q.get('queue_running') or []):
                        t['estado'], t['inicio'] = 'gerando', time.time()
                hist = self._json('GET', f'/history/{pendentes[0]}', tempo=10)
            except (OSError, ValueError):
                continue
            pronto, erro, imgs = imagens_da_saida((hist or {}).get(pendentes[0]))
            if not pronto:
                continue
            if erro:
                t['estado'], t['erro'] = 'erro', erro
                return
            for i in imgs:
                q = urlencode({'filename': i['filename'], 'subfolder': i.get('subfolder', ''), 'type': i['type']})
                try:
                    prontas.append((self._http('GET', f'/view?{q}', tempo=60), 'image/png'))
                except OSError as e:
                    t['estado'], t['erro'] = 'erro', f'não consegui baixar a imagem: {e}'
                    return
            pendentes.pop(0)
            if t['estado'] == 'fila':
                t['estado'], t['inicio'] = 'gerando', time.time()
        try:
            t['urls'] = ao_terminar(t, prontas)
        except Exception as e:  # noqa: BLE001 — qualquer falha ao guardar vira erro visível na aba
            t['estado'], t['erro'] = 'erro', f'falha ao guardar: {e}'
            print(f'[gerador] {e}', file=sys.stderr)
            return
        self.duracoes[t['modelo']] = round(time.time() - (t['inicio'] or t['criado']), 1)
        t['estado'] = 'pronto'

    def trabalho(self, tid):
        t = self.trabalhos.get(tid)
        if not t:
            return None
        r = {k: t[k] for k in ('id', 'modelo', 'estado', 'urls', 'erro', 'semente')}
        r['decorrido'] = round(time.time() - (t['inicio'] or t['criado']), 1)
        r['estimado'] = self.duracoes.get(t['modelo'])
        return r


def _erro_comfy(e):
    """Mensagem legível de um erro 400 do /prompt (nó que falta, modelo que não existe...)."""
    try:
        d = json.loads(e.read())
        partes = [d.get('error', {}).get('message', '')]
        for no in (d.get('node_errors') or {}).values():
            for er in no.get('errors') or []:
                partes.append(f"{no.get('class_type')}: {er.get('message')} {er.get('details', '')}".strip())
        return ' · '.join(x for x in partes if x) or str(e)
    except (ValueError, AttributeError):
        return str(e)
