// Gerador de imagens (aba só do mestre). Três modos calibrados em data/gerador.json:
//   Cenário · Personagem (SDXL, rápido) · Cenário e personagem (Qwen-Image-Edit: lê as imagens dos personagens
//   citados com @Nome e os põe na cena). O ComfyUI roda neste PC; o servidor.py conversa com ele.
// As imagens prontas entram na Biblioteca, ocultas até o mestre mostrar.
import { CONFIG } from '../system/config.js';
import { montarPedido, mencoes } from '../system/prompt.js';
import { state, subscribe, isGM, library, safeUrl } from '../core/store.js';
import { net, mesaApi, quemPede } from '../core/net.js';
import { esc, toast } from './dom.js';
import { abrirItem, selecionarAba } from './library.js';

const g = { modo: 'cenario', enquadramento: '', estilo: 'fantasia', proporcao: '', texto: '', nome: '', quantidade: 1, semente: '',
  extraRefs: [], cenarioRef: null, editarFinal: false, positivoFinal: '', negativoExtra: '' };
let el, status = null, statusTimer = null, enviando = false;
const trabalhos = []; // { id, rotulo, modelo, estado, decorrido, estimado, urls, erro }

const cal = () => CONFIG.gerador;
const personagens = () => library().filter(i => i.tipo === 'personagem' && safeUrl(i.url));
const itemPorId = id => library().find(i => i.id === id);
const qs = () => new URLSearchParams(Object.entries(quemPede()).filter(([, v]) => v)).toString();

export function initGenerator(container) {
  el = container;
  if (!cal()?.modos) { el.innerHTML = '<p class="hint">Não consegui carregar data/gerador.json (recarregue a página com Ctrl+F5).</p>'; el = null; return; }
  el.innerHTML = `<div class="ger">
    <div class="ger-status" data-status></div>
    <div class="ger-modos" data-modos></div>
    <p class="hint" data-dica></p>
    <div class="ger-chips" data-enq></div>
    <label class="ger-texto">Descreva <span class="hint" data-dica-texto></span>
      <textarea data-texto rows="3" maxlength="1500"></textarea>
      <div class="ger-mencao" data-mencao hidden></div></label>
    <div class="ger-refs" data-refs></div>
    <label data-nome-label>Nome <input data-nome maxlength="80"></label>
    <div class="ger-linha">
      <label>Estilo <select data-estilo></select></label>
      <label>Formato <select data-proporcao></select></label>
      <label>Quantas <select data-quantidade>${[1, 2, 3, 4].map(n => `<option>${n}</option>`).join('')}</select></label>
      <label>Semente <input data-semente inputmode="numeric" placeholder="aleatória" size="9"></label>
    </div>
    <details class="ger-avancado"><summary>Avançado: texto enviado ao modelo</summary>
      <p class="hint" data-modelo-info></p>
      <textarea data-final rows="5" readonly></textarea>
      <label class="tp-check"><input type="checkbox" data-editar> Editar o texto final à mão</label>
      <label>Evitar também <input data-negativo placeholder="ex.: chapéu, sangue"></label>
    </details>
    <div data-avisos class="ger-avisos"></div>
    <button class="primary ger-btn" data-gerar>✨ Gerar</button>
    <div class="ger-trabalhos" data-trabalhos></div>
  </div>`;
  el.querySelector('[data-estilo]').innerHTML = cal().estilos.map(s => `<option value="${s.id}">${esc(s.nome)}</option>`).join('');
  el.querySelector('[data-proporcao]').innerHTML = '<option value="">Automático</option>' + cal().proporcoes.map(p => `<option value="${p.id}">${esc(p.nome)}</option>`).join('');
  el.addEventListener('input', onInput);
  el.addEventListener('change', onInput);
  el.addEventListener('click', onClick);
  el.querySelector('[data-texto]').addEventListener('keydown', e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) gerar(); });
  subscribe(() => { if (visivel()) { renderRefs(); renderPrevia(); renderTrabalhos(); } });
  new MutationObserver(() => { if (visivel()) { consultar(); renderTudo(); } }).observe(el, { attributes: true, attributeFilter: ['hidden'] });
  renderTudo();
}

const visivel = () => el && !el.hidden && isGM();

/** Chamado pela biblioteca: abre o gerador com uma referência, um cenário ou para refazer uma imagem. */
export function usarNoGerador({ ref, cenario, refazer } = {}) {
  if (!el) return;
  if (ref) { g.modo = 'cena'; if (!g.extraRefs.includes(ref.id)) g.extraRefs.push(ref.id); }
  if (cenario) { g.modo = 'cena'; g.cenarioRef = cenario.id; }
  if (refazer?.origem) {
    const o = refazer.origem;
    Object.assign(g, { modo: o.modo || g.modo, enquadramento: o.enquadramento || '', estilo: o.estilo || g.estilo, proporcao: o.proporcao || '', texto: o.texto || '', semente: '' });
    g.extraRefs = (o.refs || []).filter(id => itemPorId(id)?.tipo === 'personagem');
    g.cenarioRef = (o.refs || []).find(id => itemPorId(id)?.tipo === 'imagem') || null;
    g.nome = refazer.tipo === 'personagem' ? refazer.nome.replace(/ \(\d+\)$/, '') : '';
  }
  selecionarAba('gerador');
  renderTudo();
  el.querySelector('[data-texto]').focus();
}

// ---------- servidor / ComfyUI ----------
async function consultar() {
  clearTimeout(statusTimer);
  if (!net.online) { status = { semServidor: true }; renderStatus(); return; }
  try {
    const r = await fetch(mesaApi('/gerador/estado?' + qs()), { cache: 'no-store' });
    status = r.ok ? await r.json() : { erro: (await r.json().catch(() => ({}))).erro || `erro ${r.status}` };
  } catch (e) { status = { erro: e.message }; }
  renderStatus();
  if (visivel()) statusTimer = setTimeout(consultar, status?.ligado ? 15000 : 2500);
}

async function ligar(btn) {
  btn.disabled = true;
  try {
    const r = await fetch(mesaApi('/gerador/ligar'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(quemPede()) });
    const j = await r.json();
    if (j.ligar === 'nao-instalado') toast('O gerador não está instalado neste PC (veja o README).', 5000);
  } catch (e) { toast('Não consegui ligar: ' + e.message); }
  consultar();
}

async function desligar(btn) {
  if (trabalhos.some(t => t.estado === 'fila' || t.estado === 'gerando') && !confirm('Ainda há imagens sendo geradas. Desligar mesmo assim?')) return;
  btn.disabled = true;
  try {
    const r = await fetch(mesaApi('/gerador/desligar'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(quemPede()) });
    const j = await r.json();
    toast(j.desligar === 'memoria-liberada' ? 'Memória do gerador liberada (ele foi aberto fora da mesa e continua ligado).' : 'Gerador desligado.');
  } catch (e) { toast('Não consegui desligar: ' + e.message); }
  setTimeout(consultar, 800);
}

function renderStatus() {
  const box = el.querySelector('[data-status]'), s = status;
  const m = cal().modelos;
  let html;
  if (!s) html = '<span class="muted">◌ Verificando o gerador…</span>';
  else if (s.semServidor) html = '⚠ O gerador precisa da mesa aberta pelo <code>servidor.py</code> (serve.bat).';
  else if (s.erro) html = `⚠ ${esc(s.erro)}`;
  else if (!s.instalado && !s.ligado) html = '⚠ Gerador não instalado. Rode <code>tools\\instalar-gerador.ps1</code> (baixa ~30 GB; veja o README).';
  else if (s.ligado) {
    const temSdxl = (s.modelos.checkpoints || []).includes(m.sdxl), temQwen = (s.modelos.unet || []).includes(m.qwen_unet);
    html = `<span class="ok">● Gerador pronto</span>${s.fila ? ` · ${s.fila} na fila` : ''}
      <button class="ger-desligar" data-desligar title="Fecha o gerador e libera a memória da placa de vídeo (para jogar mais leve)">Desligar</button>
      ${temSdxl ? '' : `<br>⚠ Falta o modelo ${esc(m.sdxl)} (Cenário e Personagem).`}
      ${temQwen ? '' : `<br>⚠ Falta o modelo ${esc(m.qwen_unet)} (cenas com referência).`}`;
  } else if (s.iniciando) html = '◌ Ligando o gerador… (leva uns 20–60 s)';
  else html = `○ Gerador desligado ${s.saiu != null ? `<small>(fechou com código ${s.saiu}; veja mesas/comfyui.log)</small>` : ''} <button data-ligar>Ligar gerador</button>`;
  box.innerHTML = html;
  el.querySelector('[data-gerar]').disabled = enviando || !s?.ligado;
}

// ---------- formulário ----------
function escolha() {
  return {
    ...g,
    personagens: personagens(),
    extraRefs: g.extraRefs.map(itemPorId).filter(Boolean),
    cenarioRef: g.cenarioRef ? itemPorId(g.cenarioRef) || null : null,
    positivoFinal: g.editarFinal ? g.positivoFinal : '',
  };
}

function renderTudo() {
  if (!el) return;
  const c = cal(), modo = c.modos.find(m => m.id === g.modo);
  if (!modo.enquadramentos.some(e => e.id === g.enquadramento)) g.enquadramento = modo.enquadramentos[0].id;
  el.querySelector('[data-modos]').innerHTML = c.modos.map(m => `<button data-modo="${m.id}" aria-pressed="${m.id === g.modo}"><span>${m.icone}</span>${esc(m.nome)}</button>`).join('');
  el.querySelector('[data-dica]').textContent = modo.dica;
  el.querySelector('[data-enq]').innerHTML = modo.enquadramentos.length > 1 ? modo.enquadramentos.map(e => `<button data-enquadramento="${e.id}" aria-pressed="${e.id === g.enquadramento}">${esc(e.nome)}</button>`).join('') : '';
  const t = el.querySelector('[data-texto]');
  if (t.value !== g.texto) t.value = g.texto;
  t.placeholder = { cenario: 'ex.: taverna escura com lareira acesa, mesas de madeira e barris', personagem: 'ex.: elfa arqueira de cabelo prateado, capa verde com capuz, arco longo', cena: 'ex.: @Aria e @Bandido lutando na ponte de pedra durante uma tempestade' }[g.modo];
  el.querySelector('[data-dica-texto]').textContent = g.modo === 'cena' ? '(@ cita um personagem da biblioteca)' : '(em português; vira inglês para o modelo)';
  el.querySelector('[data-nome-label]').firstChild.textContent = g.modo === 'personagem' ? 'Nome do personagem ' : 'Nome da imagem ';
  const nome = el.querySelector('[data-nome]');
  if (nome.value !== g.nome) nome.value = g.nome;
  nome.placeholder = g.modo === 'personagem' ? 'ex.: Aria Valen (para citar depois com @)' : 'opcional';
  el.querySelector('[data-estilo]').value = g.estilo;
  el.querySelector('[data-proporcao]').value = g.proporcao;
  el.querySelector('[data-quantidade]').value = g.quantidade;
  el.querySelector('[data-semente]').value = g.semente;
  el.querySelector('[data-editar]').checked = g.editarFinal;
  el.querySelector('[data-negativo]').value = g.negativoExtra;
  renderRefs(); renderPrevia(); renderStatus(); renderTrabalhos();
}

const chip = (it, attr) => `<span class="ger-chip"><img src="${esc(safeUrl(it.mini) || safeUrl(it.url))}" alt="">${esc(it.nome)}<button class="icon-btn" ${attr}="${esc(it.id)}" title="Tirar">✕</button></span>`;

function renderRefs() {
  const box = el.querySelector('[data-refs]');
  if (g.modo !== 'cena') { box.innerHTML = ''; return; }
  const citados = mencoes(g.texto, personagens());
  const extras = g.extraRefs.map(itemPorId).filter(it => it && !citados.includes(it));
  const cen = g.cenarioRef && itemPorId(g.cenarioRef);
  const livres = personagens().filter(p => !citados.includes(p) && !extras.includes(p));
  const imagens = library().filter(i => i.tipo === 'imagem' && safeUrl(i.url));
  box.innerHTML = `<div><b>Personagens</b> ${citados.map(p => `<span class="ger-chip"><img src="${esc(safeUrl(p.mini) || safeUrl(p.url))}" alt="">@${esc(p.nome)}</span>`).join('')}${extras.map(p => chip(p, 'data-tirar')).join('')}
      ${livres.length ? `<select data-addref><option value="">＋ personagem…</option>${livres.map(p => `<option value="${esc(p.id)}">${esc(p.nome)}</option>`).join('')}</select>` : ''}
      ${!personagens().length ? '<span class="hint">Nenhum personagem na biblioteca ainda: gere um no modo Personagem ou envie uma ilustração em Biblioteca › Personagens.</span>' : ''}</div>
    <div><b>Cenário</b> <span class="hint">(opcional)</span> ${cen ? chip(cen, 'data-tirarcen') : imagens.length ? `<select data-addcen><option value="">escolher uma imagem…</option>${imagens.map(i => `<option value="${esc(i.id)}">${esc(i.nome)}</option>`).join('')}</select>` : '<span class="hint">sem imagens na biblioteca</span>'}</div>`;
}

function renderPrevia() {
  const r = montarPedido(escolha(), cal());
  const fin = el.querySelector('[data-final]');
  fin.readOnly = !g.editarFinal;
  if (!g.editarFinal || !g.positivoFinal) fin.value = r.pedido.positivo;
  const nomes = { sdxl: 'SDXL (DreamShaper XL Lightning)', qwen: 'Qwen-Image-Edit-2511 (lê as imagens de referência)' };
  const dur = status?.duracoes?.[r.pedido.modelo];
  el.querySelector('[data-modelo-info]').textContent = `Modelo: ${nomes[r.pedido.modelo]} · ${r.pedido.largura}×${r.pedido.altura} · ${r.pedido.passos} passos${dur ? ` · última levou ${Math.round(dur)} s` : r.pedido.modelo === 'qwen' ? ' · a primeira vez demora mais (carrega o modelo)' : ''}`;
  el.querySelector('[data-avisos]').innerHTML = r.avisos.map(a => `<p class="hint">⚠ ${esc(a)}</p>`).join('');
}

function onInput(e) {
  const d = e.target.dataset;
  if ('texto' in d) { g.texto = e.target.value; mostrarMencoes(e.target); }
  else if ('nome' in d) g.nome = e.target.value;
  else if ('estilo' in d) g.estilo = e.target.value;
  else if ('proporcao' in d) g.proporcao = e.target.value;
  else if ('quantidade' in d) g.quantidade = +e.target.value;
  else if ('semente' in d) g.semente = e.target.value.replace(/\D/g, '');
  else if ('editar' in d) { g.editarFinal = e.target.checked; g.positivoFinal = el.querySelector('[data-final]').value; }
  else if ('final' in d) { g.positivoFinal = e.target.value; return; }
  else if ('negativo' in d) g.negativoExtra = e.target.value;
  else if ('addref' in d && e.type === 'change') { if (e.target.value) g.extraRefs.push(e.target.value); }
  else if ('addcen' in d && e.type === 'change') { g.cenarioRef = e.target.value || null; }
  else return;
  renderRefs(); renderPrevia();
}

function onClick(e) {
  const b = e.target.closest('button');
  if (!b) return;
  if (b.dataset.modo) { g.modo = b.dataset.modo; g.enquadramento = ''; renderTudo(); }
  else if (b.dataset.enquadramento) { g.enquadramento = b.dataset.enquadramento; renderTudo(); }
  else if (b.dataset.tirar) { g.extraRefs = g.extraRefs.filter(id => id !== b.dataset.tirar); renderRefs(); renderPrevia(); }
  else if (b.dataset.tirarcen != null) { g.cenarioRef = null; renderRefs(); renderPrevia(); }
  else if (b.dataset.mencao) inserirMencao(b.dataset.mencao);
  else if (b.matches('[data-ligar]')) ligar(b);
  else if (b.matches('[data-desligar]')) desligar(b);
  else if (b.matches('[data-gerar]')) gerar();
  else if (b.dataset.ver) abrirItem(b.dataset.ver);
  else if (b.dataset.fechar) { const i = trabalhos.findIndex(t => t.id === b.dataset.fechar); if (i >= 0) trabalhos.splice(i, 1); renderTrabalhos(); }
}

// @ no texto: lista os personagens da biblioteca
function mostrarMencoes(t) {
  const box = el.querySelector('[data-mencao]');
  const m = /@([^@\n]{0,30})$/.exec(t.value.slice(0, t.selectionStart));
  const lista = m ? personagens().filter(p => p.nome.toLowerCase().startsWith(m[1].toLowerCase())).slice(0, 6) : [];
  box.hidden = !lista.length;
  box.innerHTML = lista.map(p => `<button data-mencao="${esc(p.id)}"><img src="${esc(safeUrl(p.mini) || safeUrl(p.url))}" alt="">${esc(p.nome)}</button>`).join('');
}
function inserirMencao(id) {
  const p = itemPorId(id), t = el.querySelector('[data-texto]');
  const antes = t.value.slice(0, t.selectionStart).replace(/@([^@\n]{0,30})$/, `@${p.nome} `);
  g.texto = antes + t.value.slice(t.selectionStart);
  t.value = g.texto; t.focus(); t.selectionStart = t.selectionEnd = antes.length;
  el.querySelector('[data-mencao]').hidden = true;
  renderRefs(); renderPrevia();
}

// ---------- gerar e acompanhar ----------
async function gerar() {
  if (enviando || !status?.ligado) return;
  const r = montarPedido(escolha(), cal());
  if (!g.texto.trim() && !r.refs.length) { toast('Descreva a imagem.'); return; }
  enviando = true; renderStatus();
  try {
    const resp = await fetch(mesaApi('/gerador/gerar'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pedido: r.pedido, item: r.item, ...quemPede() }) });
    const j = await resp.json();
    if (!resp.ok) throw new Error(j.erro || resp.status);
    trabalhos.unshift({ id: j.id, rotulo: r.item.nome, modelo: r.pedido.modelo, estado: 'fila', decorrido: 0, urls: [], quantidade: r.pedido.quantidade });
    acompanhar(j.id);
  } catch (e) { toast('Não deu para gerar: ' + e.message, 6000); }
  enviando = false; renderStatus(); renderTrabalhos();
}

async function acompanhar(id) {
  const t = trabalhos.find(x => x.id === id);
  while (t && (t.estado === 'fila' || t.estado === 'gerando')) {
    await new Promise(res => setTimeout(res, 1000));
    try {
      const r = await fetch(mesaApi(`/gerador/trabalho?id=${encodeURIComponent(id)}&${qs()}`), { cache: 'no-store' });
      const j = await r.json();
      if (!r.ok) { Object.assign(t, { estado: 'erro', erro: j.erro }); break; }
      Object.assign(t, j);
    } catch { /* servidor ocupado: tenta de novo */ }
    renderTrabalhos();
  }
  if (t?.estado === 'pronto') toast(`✨ “${t.rotulo}” pronta (na Biblioteca, oculta para os jogadores).`);
  renderTrabalhos();
}

function renderTrabalhos() {
  const box = el?.querySelector('[data-trabalhos]');
  if (!box) return;
  box.innerHTML = trabalhos.map(t => {
    const itens = t.urls?.length ? library().filter(i => t.urls.includes(i.url)) : [];
    const est = t.estimado || (t.modelo === 'qwen' ? 90 : 12);
    const pct = t.estado === 'pronto' ? 100 : t.estado === 'gerando' ? Math.min(95, (t.decorrido / est) * 100) : 3;
    return `<div class="ger-trab ${t.estado}">
      <div class="ger-trab-top"><b>${esc(t.rotulo)}</b> <small>${{ fila: 'na fila…', gerando: `gerando… ${Math.round(t.decorrido)} s`, pronto: 'pronta ✓', erro: 'erro' }[t.estado] || ''}</small>
        <button class="icon-btn" data-fechar="${esc(t.id)}" title="Tirar da lista">✕</button></div>
      ${t.estado === 'erro' ? `<p class="hint">⚠ ${esc(t.erro || 'falhou')}</p>` : t.estado !== 'pronto' ? `<div class="ger-barra"><i style="width:${pct}%"></i></div>` : ''}
      ${itens.length ? `<div class="ger-res">${itens.map(i => `<button data-ver="${esc(i.id)}" title="${esc(i.nome)}"><img src="${esc(safeUrl(i.mini) || safeUrl(i.url))}" alt=""></button>`).join('')}</div>` : ''}
    </div>`;
  }).join('');
}
