// Tabuleiro: mapa, grade em blocos (2×2 quadrados, Apêndice 4.1), tokens e medição de zonas.
import { state, local, update, notify, getActor, subscribe } from '../core/store.js';
import { prepareDerived, uid } from '../system/actor.js';
import { CONFIG } from '../system/config.js';

let canvas, ctx, view = { x: 40, y: 40, zoom: 1 }, selected = null, ruler = null, rulerMode = false;
const imgCache = new Map();
let onOpenSheet = () => {};

/** Distância em blocos (soma das diferenças — padrão da tabela do Apêndice) e zona correspondente. */
export function blockDistance(a, b) {
  const bx = v => Math.floor(v / 2);
  return Math.abs(bx(a.x) - bx(b.x)) + Math.abs(bx(a.y) - bx(b.y));
}
export function zoneForBlocks(n) {
  const z = CONFIG.sistema.zonas.find(z => n >= z.blocos[0] && (z.blocos[1] == null || n <= z.blocos[1]));
  return z || CONFIG.sistema.zonas[CONFIG.sistema.zonas.length - 1];
}

export function initBoard(el, { openSheet }) {
  canvas = el; ctx = canvas.getContext('2d'); onOpenSheet = openSheet;
  new ResizeObserver(resize).observe(canvas.parentElement);
  subscribe(draw);
  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('dblclick', onDbl);
  canvas.addEventListener('wheel', onWheel, { passive: false });
  canvas.addEventListener('contextmenu', e => e.preventDefault());
  canvas.addEventListener('dragover', e => e.preventDefault());
  canvas.addEventListener('drop', onDrop);
  addEventListener('keydown', onKey);
  resize();
}

export function setRulerMode(v) { rulerMode = v; canvas.style.cursor = v ? 'crosshair' : ''; }
export function getSelected() { return selected; }

function resize() {
  const r = canvas.parentElement.getBoundingClientRect();
  const dpr = devicePixelRatio || 1;
  canvas.width = r.width * dpr; canvas.height = r.height * dpr;
  canvas.style.width = r.width + 'px'; canvas.style.height = r.height + 'px';
  draw();
}

const cssVar = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();

function draw() {
  if (!ctx) return;
  const dpr = devicePixelRatio || 1, sc = state.cena, q = sc.tamanhoQuadrado;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = cssVar('--board-bg'); ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.setTransform(dpr * view.zoom, 0, 0, dpr * view.zoom, dpr * view.x, dpr * view.y);
  const W = sc.colunas * q, H = sc.linhas * q;

  ctx.fillStyle = cssVar('--board-paper'); ctx.fillRect(0, 0, W, H);
  if (sc.fundo) {
    const img = image(sc.fundo);
    if (img.complete && img.naturalWidth) ctx.drawImage(img, 0, 0, W, H);
  }
  // grade: quadrados finos, blocos (2×2) grossos
  ctx.lineWidth = 1 / view.zoom;
  for (let i = 0; i <= sc.colunas; i++) {
    ctx.strokeStyle = i % 2 ? cssVar('--grid-fine') : cssVar('--grid-block');
    ctx.lineWidth = (i % 2 ? 1 : 2) / view.zoom;
    ctx.beginPath(); ctx.moveTo(i * q, 0); ctx.lineTo(i * q, H); ctx.stroke();
  }
  for (let j = 0; j <= sc.linhas; j++) {
    ctx.strokeStyle = j % 2 ? cssVar('--grid-fine') : cssVar('--grid-block');
    ctx.lineWidth = (j % 2 ? 1 : 2) / view.zoom;
    ctx.beginPath(); ctx.moveTo(0, j * q); ctx.lineTo(W, j * q); ctx.stroke();
  }

  const sel = sc.tokens.find(t => t.id === selected);
  // rótulos de zona a partir do token selecionado
  for (const t of sc.tokens) {
    const a = getActor(t.atorId);
    if (!a) continue;
    drawToken(t, a, q, t.id === selected, a.id === local.alvoId);
    if (sel && t !== sel) {
      const n = blockDistance(sel, t), z = zoneForBlocks(n);
      label((t.x + 0.5) * q, (t.y - 0.15) * q, `${z.id} · ${n} bl`, cssVar('--accent'));
    }
  }
  if (ruler) {
    const a = ruler.a, b = ruler.b;
    ctx.strokeStyle = cssVar('--accent'); ctx.lineWidth = 3 / view.zoom; ctx.setLineDash([8 / view.zoom, 6 / view.zoom]);
    ctx.beginPath(); ctx.moveTo((a.x + 0.5) * q, (a.y + 0.5) * q); ctx.lineTo((b.x + 0.5) * q, (b.y + 0.5) * q); ctx.stroke();
    ctx.setLineDash([]);
    const n = blockDistance(a, b), z = zoneForBlocks(n);
    label((b.x + 0.5) * q, (b.y + 1.2) * q, `${z.nome} (${n} blocos)`, cssVar('--accent'));
  }
}

function drawToken(t, a, q, isSel, isTarget) {
  const cx = (t.x + 0.5) * q, cy = (t.y + 0.5) * q, r = q * 0.42;
  ctx.save();
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.closePath();
  ctx.fillStyle = a.cor || '#333'; ctx.fill();
  if (a.imagem) {
    const img = image(a.imagem);
    if (img.complete && img.naturalWidth) { ctx.save(); ctx.clip(); ctx.drawImage(img, cx - r, cy - r, r * 2, r * 2); ctx.restore(); }
  } else {
    ctx.fillStyle = '#fff'; ctx.font = `600 ${q * 0.34}px ${cssVar('--font-ui')}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(initials(a.nome), cx, cy + 1);
  }
  ctx.lineWidth = (isSel ? 4 : 2) / view.zoom;
  ctx.strokeStyle = isSel ? cssVar('--accent') : cssVar('--ink');
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke();
  if (isTarget) {
    ctx.strokeStyle = cssVar('--danger'); ctx.lineWidth = 2 / view.zoom; ctx.setLineDash([4 / view.zoom, 3 / view.zoom]);
    ctx.beginPath(); ctx.arc(cx, cy, r + 5 / view.zoom, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
  }
  // barra de vida
  const d = prepareDerived(a), v = Math.max(0, a.system.recursos.vida ?? d.vidaMax);
  const bw = q * 0.84, bx = cx - bw / 2, by = cy + r + 3;
  ctx.fillStyle = 'rgba(0,0,0,.55)'; ctx.fillRect(bx, by, bw, 5);
  ctx.fillStyle = v <= d.metadeVida ? cssVar('--danger') : cssVar('--ok');
  ctx.fillRect(bx, by, bw * Math.min(1, v / d.vidaMax), 5);
  ctx.restore();
  // nome
  ctx.fillStyle = cssVar('--ink'); ctx.font = `500 ${Math.max(10, q * 0.24)}px ${cssVar('--font-ui')}`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'top';
  ctx.fillText(a.nome, cx, by + 7);
}

function label(x, y, txt, color) {
  ctx.font = `600 ${13 / view.zoom}px ${cssVar('--font-ui')}`;
  const w = ctx.measureText(txt).width + 10 / view.zoom, h = 18 / view.zoom;
  ctx.fillStyle = color; ctx.fillRect(x - w / 2, y - h / 2, w, h);
  ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(txt, x, y);
}

const initials = n => (n || '?').split(/\s+/).filter(Boolean).slice(0, 2).map(p => p[0].toUpperCase()).join('');

function image(src) {
  if (!imgCache.has(src)) { const i = new Image(); i.onload = draw; i.src = src; imgCache.set(src, i); }
  return imgCache.get(src);
}

function toCell(e) {
  const r = canvas.getBoundingClientRect(), q = state.cena.tamanhoQuadrado;
  const wx = (e.clientX - r.left - view.x) / view.zoom, wy = (e.clientY - r.top - view.y) / view.zoom;
  return { x: Math.floor(wx / q), y: Math.floor(wy / q), wx, wy };
}
const tokenAt = c => [...state.cena.tokens].reverse().find(t => t.x === c.x && t.y === c.y);

function onDown(e) {
  canvas.setPointerCapture(e.pointerId);
  const c = toCell(e);
  // botão do meio/direito ou espaço: arrastar o mapa
  if (e.button === 1 || (e.button === 2 && !tokenAt(c)) || spaceDown) return pan(e);
  if (e.button === 2) { // botão direito em token = marcar alvo (cada jogador tem o seu; não é sincronizado)
    const t = tokenAt(c);
    local.alvoId = local.alvoId === t.atorId ? null : t.atorId;
    notify();
    return;
  }
  if (rulerMode || e.ctrlKey) {
    ruler = { a: c, b: c };
    const move = ev => { ruler.b = toCell(ev); draw(); };
    const up = () => { ruler = null; draw(); canvas.removeEventListener('pointermove', move); canvas.removeEventListener('pointerup', up); };
    canvas.addEventListener('pointermove', move); canvas.addEventListener('pointerup', up);
    return;
  }
  const t = tokenAt(c);
  selected = t?.id || null;
  draw();
  if (!t) return pan(e);
  const start = { x: t.x, y: t.y };
  const move = ev => {
    const n = toCell(ev);
    t.x = Math.max(0, Math.min(state.cena.colunas - 1, n.x)); t.y = Math.max(0, Math.min(state.cena.linhas - 1, n.y));
    draw();
    if (t.x !== start.x || t.y !== start.y) drawMoveHint(start, t);
  };
  const up = () => {
    canvas.removeEventListener('pointermove', move); canvas.removeEventListener('pointerup', up);
    update(() => {}); // salva a nova posição
  };
  canvas.addEventListener('pointermove', move); canvas.addEventListener('pointerup', up);
}

function drawMoveHint(from, t) {
  const q = state.cena.tamanhoQuadrado, n = blockDistance(from, t), z = zoneForBlocks(n);
  label((t.x + 0.5) * q, (t.y + 1.25) * q, `movido: ${z.nome}`, cssVar('--ink'));
}

function pan(e) {
  const sx = e.clientX - view.x, sy = e.clientY - view.y;
  const move = ev => { view.x = ev.clientX - sx; view.y = ev.clientY - sy; draw(); };
  const up = () => { canvas.removeEventListener('pointermove', move); canvas.removeEventListener('pointerup', up); };
  canvas.addEventListener('pointermove', move); canvas.addEventListener('pointerup', up);
}

function onWheel(e) {
  e.preventDefault();
  const r = canvas.getBoundingClientRect(), mx = e.clientX - r.left, my = e.clientY - r.top;
  const z = Math.max(0.25, Math.min(3, view.zoom * (e.deltaY < 0 ? 1.1 : 0.9)));
  view.x = mx - (mx - view.x) * (z / view.zoom); view.y = my - (my - view.y) * (z / view.zoom); view.zoom = z;
  draw();
}

function onDbl(e) {
  const t = tokenAt(toCell(e));
  if (t) onOpenSheet(t.atorId);
}

function onDrop(e) {
  e.preventDefault();
  const id = e.dataTransfer.getData('text/omni-ator');
  if (!id) return;
  const c = toCell(e);
  addToken(id, c.x, c.y);
}

export function addToken(atorId, x, y) {
  if (x == null) { // posição livre perto do canto visível
    const used = new Set(state.cena.tokens.map(t => t.x + ',' + t.y));
    x = 1; y = 1;
    while (used.has(x + ',' + y)) { x += 2; if (x >= state.cena.colunas) { x = 1; y += 2; } }
  }
  update(s => s.cena.tokens.push({ id: uid(), atorId, x, y }));
}

let spaceDown = false;
function onKey(e) {
  if (e.target.matches('input, textarea, select')) return;
  if (e.type === 'keydown' && e.code === 'Space') spaceDown = true;
  if ((e.key === 'Delete' || e.key === 'Backspace') && selected) {
    update(s => { s.cena.tokens = s.cena.tokens.filter(t => t.id !== selected); });
    selected = null;
  }
}
addEventListener('keyup', e => { if (e.code === 'Space') spaceDown = false; });

export function centerView() { view = { x: 40, y: 40, zoom: 1 }; draw(); }
export function redraw() { draw(); }
