// Ferramentas do mapa: selecionar, régua (vários pontos, vista por todos), desenho tipo quadro branco,
// áreas de efeito, borracha e névoa de guerra (mestre). A paleta fica no canto do mapa.
import { state, local, scene, update, isGM } from '../core/store.js';
import { net, sendEvent, onEvent, playerColor } from '../core/net.js';
import { hitDrawing, fixedArea } from './layers.js';
import { uid } from '../system/actor.js';
import { esc } from './dom.js';

const TOOLS = [
  { id: 'selecionar', icon: '↖', nome: 'Selecionar e mover', tecla: 'V' },
  { id: 'regua', icon: '📏', nome: 'Régua: clique para marcar pontos, duplo clique ou Esc termina', tecla: 'R' },
  { id: 'livre', icon: '✎', nome: 'Desenho livre', tecla: 'D' },
  { id: 'linha', icon: '╱', nome: 'Linha', tecla: 'L' },
  { id: 'retangulo', icon: '▭', nome: 'Retângulo', tecla: 'Q' },
  { id: 'circulo', icon: '◯', nome: 'Círculo', tecla: 'C' },
  { id: 'texto', icon: 'T', nome: 'Texto: clique onde escrever', tecla: 'T' },
  { id: 'area', icon: '✺', nome: 'Área de efeito: escolha forma e tamanho (zona) ou arraste livre; mostra quem é atingido', tecla: 'A' },
  { id: 'borracha', icon: '⌫', nome: 'Borracha: clique ou arraste sobre desenhos', tecla: 'E' },
  { id: 'nevoa', icon: '▦', nome: 'Névoa de guerra (mestre): arraste para revelar ou cobrir', tecla: 'F', mestre: true },
];
const CORES = ['#b5462f', '#2f6690', '#3a7d44', '#a0761e', '#6b3fa0', '#111111'];
const FORMAS = [['circulo', '◯', 'Círculo/esfera'], ['quadrado', '▢', 'Quadrado/cubo'], ['cone', '◣', 'Cone (45°)'], ['linha', '━', 'Linha']];

// Tamanho da área: livre (arrasta) ou travado numa zona, pelo limite de cima (D37)
const TAMANHOS = [['', 'Livre', 'Tamanho livre: arraste'], ['C', 'C', 'Curto (0 bl)'], ['D', 'D', 'Distante (1 bl)'], ['L', 'L', 'Longe (3 bl)'], ['ML', 'ML', 'Muito Longe (7 bl)'], ['EL', 'EL', 'Extremamente Longe (15 bl)']];

const opt = { tool: 'selecionar', cor: CORES[0], esp: 3, forma: 'circulo', zona: '', modoNevoa: 'revelar' };
let palette, redraw = () => {}, preview = null, fogBox = null, ruler = null;
const remoteRulers = new Map(); // cliente -> { pts, cor, nome, t }

export const currentTool = () => opt.tool;
/** O que a ferramenta está mostrando agora (desenho em andamento, réguas, caixa da névoa). */
export function toolOverlay() {
  const agora = Date.now();
  for (const [k, r] of remoteRulers) if (agora - r.t > 4000) remoteRulers.delete(k);
  return { preview, fogBox, ruler, remotes: [...remoteRulers.values()].filter(r => r.cena === scene().id) };
}

export function initTools(container, { onRedraw }) {
  redraw = onRedraw;
  palette = document.createElement('div');
  palette.className = 'tool-palette';
  container.append(palette);
  palette.addEventListener('click', onPaletteClick);
  palette.addEventListener('pointerdown', e => e.stopPropagation());
  addEventListener('keydown', onKey);
  onEvent(onNetEvent);
  renderPalette();
}

export function setTool(id) {
  if (!TOOLS.some(t => t.id === id)) return;
  if (id === 'nevoa' && !isGM()) return;
  finishRuler();
  opt.tool = id;
  renderPalette();
  redraw();
}

function renderPalette() {
  const sc = scene(), nv = sc?.nevoa || {};
  const extra = {
    area: `<div class="tp-row">${FORMAS.map(([f, i, n]) => `<button data-forma="${f}" aria-pressed="${opt.forma === f}" title="${n}">${i}</button>`).join('')}</div>
      <div class="tp-row tp-zonas">${TAMANHOS.map(([z, r, n]) => `<button data-zona="${z}" aria-pressed="${opt.zona === z}" title="${n}">${r}</button>`).join('')}</div>`,
    nevoa: `<div class="tp-col">
      <label class="tp-check"><input type="checkbox" data-nevoa-ativa ${nv.ativa ? 'checked' : ''}> Névoa ativa</label>
      <div class="tp-row"><button data-modo="revelar" aria-pressed="${opt.modoNevoa === 'revelar'}" title="Arrastar revela">Revelar</button><button data-modo="cobrir" aria-pressed="${opt.modoNevoa === 'cobrir'}" title="Arrastar cobre">Cobrir</button></div>
      <div class="tp-row"><button data-nevoa="tudo" title="Revelar o mapa inteiro">Tudo</button><button data-nevoa="nada" title="Cobrir o mapa inteiro">Nada</button></div></div>`,
  };
  const desenha = ['livre', 'linha', 'retangulo', 'circulo', 'texto', 'area'].includes(opt.tool);
  palette.innerHTML = TOOLS.filter(t => !t.mestre || isGM()).map(t =>
    `<button data-tool="${t.id}" aria-pressed="${opt.tool === t.id}" title="${esc(t.nome)} (${t.tecla})">${t.icon}</button>`).join('')
    + (desenha ? `<div class="tp-row tp-cores">${CORES.map(c => `<button data-cor="${c}" aria-pressed="${opt.cor === c}" style="--c:${c}" title="Cor"></button>`).join('')}</div>` : '')
    + (extra[opt.tool] || '')
    + (['livre', 'linha', 'retangulo', 'circulo', 'texto', 'area', 'borracha'].includes(opt.tool)
      ? `<button data-limpar title="${isGM() ? 'Apagar todos os desenhos desta cena' : 'Apagar os seus desenhos'}">Limpar</button>` : '');
}

function onPaletteClick(e) {
  const b = e.target.closest('button, input');
  if (!b) return;
  if (b.dataset.tool) return setTool(b.dataset.tool);
  if (b.dataset.cor) { opt.cor = b.dataset.cor; renderPalette(); return; }
  if (b.dataset.forma) { opt.forma = b.dataset.forma; renderPalette(); return; }
  if (b.dataset.zona != null) { opt.zona = b.dataset.zona; renderPalette(); return; }
  if (b.dataset.modo) { opt.modoNevoa = b.dataset.modo; renderPalette(); return; }
  const sc = scene();
  if (b.matches('[data-nevoa-ativa]')) { update(() => { sc.nevoa = { revelado: {}, ...(sc.nevoa || {}), ativa: b.checked }; }); renderPalette(); return; }
  if (b.dataset.nevoa) {
    update(() => {
      const rev = {};
      if (b.dataset.nevoa === 'tudo') for (let x = 0; x < sc.colunas; x++) for (let y = 0; y < sc.linhas; y++) rev[`${x},${y}`] = 1;
      sc.nevoa = { ...(sc.nevoa || {}), ativa: true, revelado: rev };
    });
    renderPalette();
    return;
  }
  if (b.matches('[data-limpar]')) {
    const meus = (sc.desenhos || []).filter(d => isGM() || d.de === local.jogadorId);
    if (!meus.length || !confirm(`Apagar ${meus.length} desenho(s)${isGM() ? ' desta cena' : ' seus'}?`)) return;
    const ids = new Set(meus.map(d => d.id));
    update(() => { sc.desenhos = sc.desenhos.filter(d => !ids.has(d.id)); });
  }
}

function onKey(e) {
  if (e.ctrlKey || e.metaKey || e.altKey || e.target.closest?.('input, textarea, select, [contenteditable]')) return;
  if (e.key === 'Escape' && opt.tool !== 'selecionar') { if (ruler) finishRuler(); else setTool('selecionar'); return; }
  const t = TOOLS.find(x => x.tecla === e.key.toUpperCase());
  if (t) setTool(t.id);
}

// ---------- ponteiro (chamado pelo board) ----------
/** pointerdown com o botão esquerdo numa ferramenta que não é "selecionar". api: { cell(e), track(e, move, up) } */
export function toolDown(e, api) {
  const c = api.cell(e), sc = scene();
  const p = { x: c.fx, y: c.fy };
  const r2 = v => Math.round(v * 100) / 100;
  switch (opt.tool) {
    case 'regua':
      if (!ruler) ruler = { pts: [{ x: c.x, y: c.y }, { x: c.x, y: c.y }] };
      else if (e.detail >= 2) { finishRuler(); return; }
      else ruler.pts.push({ x: c.x, y: c.y });
      shareRuler(); redraw();
      return;
    case 'livre': {
      preview = { tipo: 'livre', pts: [r2(p.x), r2(p.y)], cor: opt.cor, esp: opt.esp };
      api.track(e, ev => {
        const q = api.cell(ev), n = preview.pts.length;
        if (Math.hypot(q.fx - preview.pts[n - 2], q.fy - preview.pts[n - 1]) > 0.12) { preview.pts.push(r2(q.fx), r2(q.fy)); redraw(); }
      }, () => commit());
      return;
    }
    case 'linha': case 'retangulo': case 'circulo': {
      preview = { tipo: opt.tool, a: { x: r2(p.x), y: r2(p.y) }, b: { x: r2(p.x), y: r2(p.y) }, cor: opt.cor, esp: opt.esp };
      api.track(e, ev => { const q = api.cell(ev); preview.b = { x: r2(q.fx), y: r2(q.fy) }; redraw(); },
        () => commit(Math.hypot(preview.b.x - preview.a.x, preview.b.y - preview.a.y) > 0.2));
      return;
    }
    case 'area': {
      if (opt.zona) { // tamanho travado: clique posiciona, arrastar só aponta (cone e linha)
        const forma = opt.forma, zona = opt.zona, origem = { x: c.fx, y: c.fy };
        const monta = q => ({ tipo: 'area', forma, ...fixedArea(forma, zona, origem, q), cor: opt.cor });
        preview = monta(origem);
        redraw();
        api.track(e, ev => { const q = api.cell(ev); preview = monta({ x: q.fx, y: q.fy }); redraw(); }, () => commit(true));
        return;
      }
      const centro = { x: c.x + 0.5, y: c.y + 0.5 }; // origem no centro do quadrado
      preview = { tipo: 'area', forma: opt.forma, a: centro, b: { ...centro }, cor: opt.cor };
      api.track(e, ev => { const q = api.cell(ev); preview.b = { x: q.x + 0.5, y: q.y + 0.5 }; redraw(); }, () => commit(true));
      return;
    }
    case 'texto': {
      const texto = prompt('Texto:');
      if (texto?.trim()) { preview = { tipo: 'texto', a: { x: r2(p.x), y: r2(p.y) }, texto: texto.trim().slice(0, 200), cor: opt.cor, tam: 1 }; commit(); }
      return;
    }
    case 'borracha': {
      const apagar = q => {
        const pt = { x: q.fx, y: q.fy };
        const alvo = [...(sc.desenhos || [])].reverse().find(d => (isGM() || d.de === local.jogadorId) && hitDrawing(d, pt));
        if (alvo) update(() => { sc.desenhos = sc.desenhos.filter(d => d.id !== alvo.id); });
      };
      apagar(c);
      api.track(e, ev => apagar(api.cell(ev)));
      return;
    }
    case 'nevoa': {
      if (!isGM()) return;
      fogBox = { a: c, b: c, modo: opt.modoNevoa };
      api.track(e, ev => { fogBox.b = api.cell(ev); redraw(); }, () => {
        const { a, b, modo } = fogBox;
        fogBox = null;
        update(() => {
          const nv = sc.nevoa = { ativa: true, revelado: {}, ...(sc.nevoa || {}) };
          nv.ativa = true;
          for (let x = Math.max(0, Math.min(a.x, b.x)); x <= Math.min(sc.colunas - 1, Math.max(a.x, b.x)); x++)
            for (let y = Math.max(0, Math.min(a.y, b.y)); y <= Math.min(sc.linhas - 1, Math.max(a.y, b.y)); y++) {
              if (modo === 'revelar') nv.revelado[`${x},${y}`] = 1; else delete nv.revelado[`${x},${y}`];
            }
        });
        renderPalette();
      });
    }
  }
}

/** Movimento do mouse sem botão (a régua segue o cursor). */
export function toolHover(c) {
  if (opt.tool !== 'regua' || !ruler) return false;
  const last = ruler.pts[ruler.pts.length - 1];
  if (last.x !== c.x || last.y !== c.y) { ruler.pts[ruler.pts.length - 1] = { x: c.x, y: c.y }; shareRuler(); redraw(); }
  return true;
}

/** Botão direito com a régua aberta: termina a medição. */
export function toolRightClick() {
  if (!ruler) return false;
  finishRuler();
  return true;
}

function commit(valido = true) {
  const d = preview;
  preview = null;
  if (!d || !valido) { redraw(); return; }
  const sc = scene();
  update(() => { (sc.desenhos ||= []).push({ ...d, id: uid(), de: local.jogadorId }); });
}

// ---------- régua compartilhada ----------
let lastShare = 0, shareTimer = null;
function shareRuler() {
  clearTimeout(shareTimer);
  const envia = () => {
    lastShare = Date.now();
    const nome = net.online ? net.nome : '';
    sendEvent({ tipo: 'regua', cena: scene().id, pts: ruler ? ruler.pts : [], nome, cor: playerColor(nome || 'mestre') });
  };
  if (Date.now() - lastShare > 70) envia(); else shareTimer = setTimeout(envia, 70);
}

function finishRuler() {
  if (!ruler) return;
  ruler = null;
  shareRuler();
  redraw();
}

/** Mede de a até b sem a ferramenta (Ctrl+arrastar). */
export function quickRuler(a, b) { ruler = b ? { pts: [a, b], rapida: true } : null; shareRuler(); }

function onNetEvent(d, origem) {
  if (d?.tipo !== 'regua' || origem === net.cliente) return;
  if (!d.pts?.length) remoteRulers.delete(origem);
  else remoteRulers.set(origem, { pts: d.pts, cor: d.cor, nome: d.nome, cena: d.cena, t: Date.now() });
  redraw();
}

/** Para a paleta refletir a névoa quando outra pessoa muda a cena. */
export function refreshPalette() { if (palette && opt.tool === 'nevoa') renderPalette(); }
