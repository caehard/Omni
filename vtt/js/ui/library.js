// Biblioteca (comum a todos): imagens, personagens, músicas e outros arquivos da mesa.
// Cada um põe o que quiser e mexe no que é seu; o mestre mexe em tudo e decide o que os jogadores veem
// (imagens geradas chegam ocultas). Personagens têm a aba "Criação de token".
import { state, local, update, subscribe, isGM, library, ownsItem, ownsActor, safeUrl, newId, scene } from '../core/store.js';
import { net, sendEvent, onEvent } from '../core/net.js';
import { guardar, guardarImagem, miniatura, tipoDoArquivo, carregarImagem } from '../core/files.js';
import { makeWindow, esc, toast, closeWindow } from './dom.js';
import { montarTokenMaker } from './token-maker.js';
import { tocarParaTodos, pausarMusica } from './music.js';
import { usarNoGerador } from './generator.js';
import { centerView } from './board.js';

const SECOES = [
  { id: 'imagem', nome: 'Imagens', vazio: 'Mapas, cenários, handouts. Envie arquivos ou gere no Gerador de imagens.' },
  { id: 'personagem', nome: 'Personagens', vazio: 'Ilustrações de personagens e NPCs. Daqui saem os retratos e tokens.' },
  { id: 'musica', nome: 'Músicas', vazio: 'Trilhas e ambientes (MP3, OGG, WAV…). O mestre toca para todos.' },
  { id: 'outro', nome: 'Outros', vazio: 'PDFs e outros acessórios da mesa.' },
];
const ui = { sec: 'imagem', sub: 'galeria', busca: '' };
let el, corpo, tokenBox, tokenMaker, chave = '';
const previa = new Audio();
let previaId = null;

export function initLibrary(container) {
  el = container;
  el.innerHTML = `<div class="lib">
    <div class="lib-top"><input type="search" placeholder="Buscar na biblioteca…" data-busca aria-label="Buscar"><button data-add title="Enviar arquivos (ou arraste para cá)">＋ Adicionar</button></div>
    <div class="lib-secoes" role="tablist" data-secoes></div>
    <div class="lib-sub" data-sub hidden><button data-subaba="galeria">Galeria</button><button data-subaba="token">Criação de token</button></div>
    <div data-corpo class="lib-corpo"></div>
    <div data-token class="lib-token" hidden></div>
  </div>`;
  corpo = el.querySelector('[data-corpo]');
  tokenBox = el.querySelector('[data-token]');
  tokenMaker = montarTokenMaker(tokenBox);
  el.querySelector('[data-busca]').addEventListener('input', e => { ui.busca = e.target.value; render(true); });
  el.addEventListener('click', onClick);
  el.querySelector('[data-add]').addEventListener('click', escolherArquivos);
  el.addEventListener('dragover', e => { if ([...e.dataTransfer.types].includes('Files')) { e.preventDefault(); el.classList.add('soltar'); } });
  el.addEventListener('dragleave', e => { if (!el.contains(e.relatedTarget)) el.classList.remove('soltar'); });
  el.addEventListener('drop', e => { if (!e.dataTransfer.files.length) return; e.preventDefault(); el.classList.remove('soltar'); enviar([...e.dataTransfer.files]); });
  previa.addEventListener('ended', () => { previaId = null; render(true); });
  subscribe(() => { render(); if (isGM()) gerarMiniaturas(); });
  onEvent(d => { if (d?.tipo === 'mostrar') mostrar(d); });
  render(true);
}

/** Vai para uma seção (usado pelo gerador e pela janela do item). */
export function irPara(sec, sub = 'galeria') { ui.sec = sec; ui.sub = sub; render(true); }

const filtrar = itens => {
  const b = ui.busca.trim().toLowerCase();
  return b ? itens.filter(i => (i.nome || '').toLowerCase().includes(b) || (i.descricao || '').toLowerCase().includes(b)) : itens;
};

function render(forcar = false) {
  if (!el) return;
  const itens = library();
  const k = JSON.stringify([ui, isGM(), state.musica?.itemId, state.musica?.tocando, previaId, itens.map(i => [i.id, i.nome, i.mini, i.token, i.oculto, i.tipo])]);
  if (!forcar && k === chave) return;
  chave = k;
  el.querySelector('[data-secoes]').innerHTML = SECOES.map(s => {
    const n = itens.filter(i => i.tipo === s.id).length;
    return `<button data-sec="${s.id}" aria-selected="${ui.sec === s.id}" role="tab">${s.nome}${n ? ` <small>${n}</small>` : ''}</button>`;
  }).join('');
  const sub = el.querySelector('[data-sub]');
  sub.hidden = ui.sec !== 'personagem';
  sub.querySelectorAll('[data-subaba]').forEach(b => b.setAttribute('aria-pressed', b.dataset.subaba === ui.sub));
  const token = ui.sec === 'personagem' && ui.sub === 'token';
  tokenBox.hidden = !token; corpo.hidden = token;
  if (token) { tokenMaker.atualizar(); return; }

  const sec = SECOES.find(s => s.id === ui.sec);
  const lista = filtrar(itens.filter(i => i.tipo === ui.sec)).slice().reverse(); // mais novos primeiro
  if (!lista.length) { corpo.innerHTML = `<p class="hint lib-vazio">${ui.busca ? 'Nada encontrado.' : esc(sec.vazio)}</p>`; return; }
  if (ui.sec === 'musica') {
    corpo.innerHTML = `<ul class="lib-linhas">${lista.map(i => {
      const todos = state.musica?.itemId === i.id;
      return `<li class="${todos ? 'tocando' : ''}"><button class="icon-btn" data-previa="${esc(i.id)}" title="Ouvir só aqui">${previaId === i.id ? '⏸' : '▶'}</button>
        <button class="link" data-item="${esc(i.id)}">${esc(i.nome)}</button>${i.oculto ? ' <i title="Só o mestre vê">🔒</i>' : ''}
        ${isGM() ? `<button data-todos="${esc(i.id)}">${todos ? (state.musica.tocando ? '⏸ Pausar' : '▶ Continuar') : '♪ Tocar para todos'}</button>` : todos ? '<small>♪ tocando</small>' : ''}</li>`;
    }).join('')}</ul>`;
    return;
  }
  if (ui.sec === 'outro') {
    corpo.innerHTML = `<ul class="lib-linhas">${lista.map(i => `<li><span>${/pdf/.test(i.mime || '') ? '📄' : '📦'}</span>
      <button class="link" data-item="${esc(i.id)}">${esc(i.nome)}</button>${i.oculto ? ' <i title="Só o mestre vê">🔒</i>' : ''}
      ${safeUrl(i.url) ? `<a href="${esc(safeUrl(i.url))}" target="_blank" rel="noopener">Abrir ↗</a>` : ''}</li>`).join('')}</ul>`;
    return;
  }
  corpo.innerHTML = `<div class="lib-grade">${lista.map(i => `<button class="lib-card" data-item="${esc(i.id)}" title="${esc(i.nome)}">
      <img src="${esc(safeUrl(i.mini) || safeUrl(i.url))}" alt="" loading="lazy">
      <span>${esc(i.nome)}</span>
      ${i.oculto ? '<i class="lib-selo" title="Só o mestre vê">🔒</i>' : ''}${i.token ? `<img class="lib-tok" src="${esc(safeUrl(i.token))}" alt="token" title="Tem token">` : ''}
      ${i.origem?.gerado ? '<i class="lib-selo gerado" title="Gerada no Gerador de imagens">✨</i>' : ''}</button>`).join('')}</div>`;
}

function onClick(e) {
  const b = e.target.closest('button');
  if (!b) return;
  if (b.dataset.sec) { ui.sec = b.dataset.sec; ui.sub = 'galeria'; render(true); }
  else if (b.dataset.subaba) { ui.sub = b.dataset.subaba; render(true); }
  else if (b.dataset.item) abrirItem(b.dataset.item);
  else if (b.dataset.previa) {
    const it = library().find(i => i.id === b.dataset.previa);
    if (previaId === it?.id) { previa.pause(); previaId = null; }
    else if (it) { previa.src = safeUrl(it.url); previa.play().catch(() => toast('O navegador não deixou tocar.')); previaId = it.id; }
    render(true);
  } else if (b.dataset.todos) {
    const it = library().find(i => i.id === b.dataset.todos);
    if (state.musica?.itemId === it?.id) pausarMusica();
    else if (it) { tocarParaTodos(it); revelar(it); }
  }
}

// ---------- enviar arquivos ----------
function escolherArquivos() {
  const i = document.createElement('input');
  i.type = 'file'; i.multiple = true;
  i.accept = 'image/png,image/jpeg,image/webp,image/gif,audio/*,application/pdf';
  i.onchange = () => enviar([...i.files]);
  i.click();
}

async function enviar(arquivos) {
  for (const f of arquivos) {
    let tipo = tipoDoArquivo(f.type);
    if (tipo === 'imagem' && ui.sec === 'personagem') tipo = 'personagem';
    if (tipo === 'outro' && f.type !== 'application/pdf') { toast(`${f.name}: tipo não aceito (imagens, áudio ou PDF).`); continue; }
    toast(`Enviando ${f.name}…`, 1500);
    try {
      const { url, mini } = /^image\//.test(f.type) ? await guardarImagem(f) : { url: await guardar(f), mini: '' };
      adicionar({ tipo, nome: f.name.replace(/\.\w+$/, '').slice(0, 80), url, mini, mime: f.type });
      if (ui.sec !== tipo) ui.sec = tipo;
    } catch (err) { toast(`${f.name}: ${err.message}`, 4000); }
  }
  render(true);
}

/** Põe um item na biblioteca (se a mesma imagem ainda não estiver lá). Devolve o item. */
export function adicionar(dados) {
  const existente = library().find(i => i.url === dados.url && i.tipo === dados.tipo);
  if (existente) return existente;
  const item = { id: newId(), descricao: '', ...dados, de: local.jogadorId, criado: Date.now() };
  update(s => { (s.biblioteca ||= []).push(item); });
  return item;
}

/** Mestre: miniaturas das imagens que o gerador pôs na biblioteca (o servidor não sabe redimensionar). */
const tentadas = new Set();
let fazendoMini = false;
async function gerarMiniaturas() {
  if (fazendoMini || !net.online) return;
  const it = library().find(i => (i.tipo === 'imagem' || i.tipo === 'personagem') && !i.mini && safeUrl(i.url).startsWith('/api/') && !tentadas.has(i.id));
  if (!it) return;
  fazendoMini = true; tentadas.add(it.id);
  try {
    const mini = await guardar(await miniatura(it.url));
    update(s => { const x = s.biblioteca.find(i => i.id === it.id); if (x) x.mini = mini; }, { historico: false });
  } catch { /* fica sem miniatura */ }
  fazendoMini = false;
  gerarMiniaturas();
}

const revelar = it => { if (it.oculto && isGM()) update(s => { const x = s.biblioteca.find(i => i.id === it.id); if (x) x.oculto = false; }); };

// ---------- janela do item ----------
export function abrirItem(id) {
  const it = library().find(i => i.id === id);
  if (!it) return;
  const w = makeWindow('item-' + id, it.nome || 'Item', { width: it.tipo === 'musica' || it.tipo === 'outro' ? 420 : 620, className: 'lib-win' });
  const meu = ownsItem(it), gm = isGM(), url = safeUrl(it.url), img = it.tipo === 'imagem' || it.tipo === 'personagem';
  const fichas = state.atores.filter(ownsActor);
  const o = it.origem || {};
  w.body.innerHTML = `<div class="lib-item">
    ${img ? `<div class="lib-item-img"><img src="${esc(url)}" alt="">${it.token ? `<img class="lib-item-tok" src="${esc(safeUrl(it.token))}" alt="token" title="Token">` : ''}</div>` : ''}
    ${it.tipo === 'musica' ? `<audio controls src="${esc(url)}" preload="metadata"></audio>` : ''}
    ${it.tipo === 'outro' && url ? `<p><a href="${esc(url)}" target="_blank" rel="noopener">Abrir o arquivo ↗</a></p>` : ''}
    <form class="roll-form lib-item-campos">
      <label class="full">Nome <input name="nome" maxlength="80" value="${esc(it.nome)}" ${meu ? '' : 'readonly'}></label>
      ${it.tipo === 'personagem' ? `<label class="full">Aparência <small class="muted">(o gerador usa ao citar @${esc(it.nome)})</small>
        <textarea name="descricao" rows="2" maxlength="600" ${meu ? '' : 'readonly'} placeholder="ex.: elfa de cabelo prateado, capa verde, arco longo">${esc(it.descricao || '')}</textarea></label>` : ''}
    </form>
    ${o.gerado ? `<p class="hint">✨ Gerada · ${esc({ cenario: 'Cenário', personagem: 'Personagem', cena: 'Cenário e personagem' }[o.modo] || '')}${o.texto ? ` · “${esc(o.texto)}”` : ''} · semente ${esc(o.semente)}</p>` : ''}
    <p class="hint">${it.de === local.jogadorId ? 'Posto por você' : `Posto por ${esc(state.jogadores?.[it.de]?.nome || 'mestre')}`}${gm ? (it.oculto ? ' · <b>só o mestre vê</b>' : ' · visível para todos') : ''}</p>
    <div class="lib-acoes">
      ${img && gm ? '<button data-a="mostrar" title="Abre a imagem na tela de todos (e deixa visível na biblioteca)">📜 Mostrar a todos</button>' : ''}
      ${img && gm ? '<button data-a="mapa">🗺 Usar como mapa da cena</button>' : ''}
      ${img && fichas.length ? `<span class="lib-ficha"><select data-ficha>${fichas.map(a => `<option value="${esc(a.id)}">${esc(a.nome)}</option>`).join('')}</select><button data-a="retrato">Usar como retrato${it.token ? ' e token' : ''}</button></span>` : ''}
      ${img ? '<button data-a="token">◉ Criar token</button>' : ''}
      ${img && gm ? `<button data-a="ref" title="Abre o Gerador com esta imagem como referência">✨ ${it.tipo === 'personagem' ? 'Pôr numa cena' : 'Usar como cenário'}</button>` : ''}
      ${o.gerado && gm ? '<button data-a="parecido">↻ Gerar parecido</button>' : ''}
      ${it.tipo === 'musica' && gm ? '<button data-a="tocar">♪ Tocar para todos</button>' : ''}
      ${gm ? `<label class="tp-check"><input type="checkbox" data-visivel ${it.oculto ? '' : 'checked'}> Visível para todos</label>` : ''}
      ${url ? `<a class="btn-link" href="${esc(url)}" download="${esc((it.nome || 'arquivo').replace(/[\\/:*?"<>|]/g, '_'))}">⬇ Baixar</a>` : ''}
      ${meu ? '<button data-a="apagar" class="danger">Apagar</button>' : ''}
    </div></div>`;
  const muda = (campo, valor) => update(s => { const x = s.biblioteca.find(i => i.id === id); if (x) x[campo] = valor; });
  w.body.querySelector('form').addEventListener('change', e => {
    if (!meu) return;
    const v = e.target.value.trim().slice(0, e.target.name === 'nome' ? 80 : 600);
    if (e.target.name === 'nome') { muda('nome', v || it.nome); w.setTitle(v || it.nome); }
    if (e.target.name === 'descricao') muda('descricao', v);
  });
  w.body.querySelector('[data-visivel]')?.addEventListener('change', e => muda('oculto', !e.target.checked));
  w.body.addEventListener('click', async e => {
    const a = e.target.closest('[data-a]')?.dataset.a;
    if (!a) return;
    const atual = library().find(i => i.id === id) || it;
    if (a === 'mostrar') { revelar(atual); sendEvent({ tipo: 'mostrar', url: atual.url, nome: atual.nome, por: net.online ? net.nome : 'Mestre' }); }
    if (a === 'mapa') usarComoMapa(atual);
    if (a === 'retrato') {
      const fid = w.body.querySelector('[data-ficha]').value;
      update(s => { const f = s.atores.find(x => x.id === fid); if (f) { f.imagem = atual.url; if (atual.token) f.token = atual.token; } });
      toast('Retrato aplicado à ficha.');
    }
    if (a === 'token') { irPara('personagem', 'token'); selecionarAba('biblioteca'); tokenMaker.setFonte(atual); w.close(); }
    if (a === 'ref') { usarNoGerador(atual.tipo === 'personagem' ? { ref: atual } : { cenario: atual }); w.close(); }
    if (a === 'parecido') { usarNoGerador({ refazer: atual }); w.close(); }
    if (a === 'tocar') { tocarParaTodos(atual); revelar(atual); }
    if (a === 'apagar') {
      if (!confirm(`Apagar “${atual.nome}” da biblioteca?`)) return;
      update(s => { s.biblioteca = s.biblioteca.filter(i => i.id !== id); if (s.musica?.itemId === id) s.musica = null; });
      w.close();
    }
  });
}

/** Clica na aba do painel esquerdo. */
export const selecionarAba = id => document.querySelector(`[data-panel="${id}"]`)?.click();

export async function usarComoMapa(it) {
  try {
    const img = await carregarImagem(safeUrl(it.url));
    const sc = scene(), q = sc.tamanhoQuadrado;
    update(() => { sc.fundo = it.url; sc.colunas = Math.max(8, Math.round(img.naturalWidth / q)); sc.linhas = Math.max(8, Math.round(img.naturalHeight / q)); });
    centerView();
    toast(`Mapa de “${sc.nome}”: ${it.nome}. Ajuste a grade em ⚙ Cena.`);
  } catch (e) { toast(e.message); }
}

/** Abre na tela de todos (evento passageiro "mostrar"). */
function mostrar(d) {
  const url = safeUrl(d.url);
  if (!url) return;
  closeWindow('mostrar');
  const w = makeWindow('mostrar', `📜 ${d.nome || 'Imagem'}`, { width: Math.min(900, innerWidth - 40), className: 'lib-win mostrar-win' });
  w.body.innerHTML = `<img class="mostrar-img" src="${esc(url)}" alt="${esc(d.nome || '')}">${d.por ? `<p class="hint">Mostrada por ${esc(d.por)}</p>` : ''}`;
}
