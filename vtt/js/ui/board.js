// Tabuleiro: mapa, grade em blocos (2×2 quadrados, Apêndice 4.1), tokens, seleção, medição de zonas e ping.
import { state, local, scene, update, notify, getActor, subscribe } from '../core/store.js';
import { prepareDerived, uid } from '../system/actor.js';
import { CONFIG } from '../system/config.js';
import { checkpoint } from '../core/history.js';
import { net, onEvent, sendEvent, playerColor } from '../core/net.js';

let canvas, ctx, view = { x: 40, y: 40, zoom: 1 }, ruler = null, rulerMode = false, box = null, hoverId = null;
let selected = new Set(), dragging = false, lastSceneId = null;
const pings = [];
const imgCache = new Map();
const viewListeners = new Set();
let onOpenSheet = () => {};

// ---------- geometria ----------
const size = t => Math.max(1, Math.min(4, Number(t?.tamanho) || 1));

/** Intervalo de blocos ocupado (bloco = 2 quadrados) por algo em `v` com `n` quadrados de lado. */
const blockRange = (v, n) => [Math.floor(v / 2), Math.floor((v + n - 1) / 2)];

/**
 * Distância em blocos entre dois tokens (ou pontos): soma das diferenças, padrão da tabela do Apêndice.
 * Tokens grandes contam a partir da borda mais próxima.
 */
export function blockDistance(a, b) {
  const gap = (r1, r2) => Math.max(0, r2[0] - r1[1], r1[0] - r2[1]);
  return gap(blockRange(a.x, size(a)), blockRange(b.x, size(b))) + gap(blockRange(a.y, size(a)), blockRange(b.y, size(b)));
}
export function zoneForBlocks(n) {
  const z = CONFIG.sistema.zonas.find(z => n >= z.blocos[0] && (z.blocos[1] == null || n <= z.blocos[1]));
  return z || CONFIG.sistema.zonas[CONFIG.sistema.zonas.length - 1];
}

// ---------- API para outros módulos ----------
export function initBoard(el, { openSheet }) {
  canvas = el; ctx = canvas.getContext('2d'); onOpenSheet = openSheet;
  new ResizeObserver(resize).observe(canvas.parentElement);
  subscribe(draw);
  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointermove', onHover);
  canvas.addEventListener('pointerleave', () => { if (hoverId) { hoverId = null; draw(); } });
  canvas.addEventListener('dblclick', onDbl);
  canvas.addEventListener('wheel', onWheel, { passive: false });
  canvas.addEventListener('contextmenu', e => e.preventDefault());
  canvas.addEventListener('dragover', e => e.preventDefault());
  canvas.addEventListener('drop', onDrop);
  addEventListener('keydown', onKey);
  addEventListener('keyup', e => { if (e.code === 'Space') spaceDown = false; });
  onEvent(onNetEvent);
  resize();
}

export function setRulerMode(v) { rulerMode = v; canvas.style.cursor = v ? 'crosshair' : ''; }
/** Tokens selecionados (ids) que ainda existem na cena. */
export function getSelection() { return scene().tokens.filter(t => selected.has(t.id)); }
export function selectTokens(ids) { selected = new Set(ids); draw(); }
export const isDragging = () => dragging;
/** Converte coordenadas do mundo (px da cena) para a tela (px do canvas). */
export const worldToScreen = (x, y) => ({ x: x * view.zoom + view.x, y: y * view.zoom + view.y });
export const getView = () => ({ ...view });
/** `fn()` sempre que o mapa é redesenhado (zoom, arrasto, mudanças). */
export function onViewChange(fn) { viewListeners.add(fn); return () => viewListeners.delete(fn); }
export function redraw() { draw(); }

/** Enquadra a cena inteira na tela. */
export function centerView() {
  const sc = scene(), q = sc.tamanhoQuadrado, r = canvas.parentElement.getBoundingClientRect();
  const W = sc.colunas * q, H = sc.linhas * q;
  const zoom = Math.max(0.25, Math.min(1.5, (r.width - 60) / W, (r.height - 60) / H));
  view = { zoom, x: (r.width - W * zoom) / 2, y: (r.height - H * zoom) / 2 };
  draw();
}

/** Zoom 100% centrado nos tokens da cena (ou no canto, se não houver tokens). */
export function focusView() {
  const sc = scene(), q = sc.tamanhoQuadrado, toks = sc.tokens.filter(t => getActor(t.atorId));
  view.zoom = 1;
  if (!toks.length) { view.x = 40; view.y = 40; draw(); return; }
  const x0 = Math.min(...toks.map(t => t.x)), x1 = Math.max(...toks.map(t => t.x + size(t)));
  const y0 = Math.min(...toks.map(t => t.y)), y1 = Math.max(...toks.map(t => t.y + size(t)));
  panTo((x0 + x1) / 2 * q, (y0 + y1) / 2 * q);
}

/** Centraliza a visão num ponto da cena (px do mundo). */
export function panTo(wx, wy) {
  const r = canvas.parentElement.getBoundingClientRect();
  view.x = r.width / 2 - wx * view.zoom; view.y = r.height / 2 - wy * view.zoom;
  draw();
}

export function addToken(atorId, x, y) {
  const sc = scene();
  if (x == null) { // posição livre perto do canto
    const used = new Set(sc.tokens.map(t => t.x + ',' + t.y));
    x = 1; y = 1;
    while (used.has(x + ',' + y)) { x += 2; if (x >= sc.colunas) { x = 1; y += 2; } }
  }
  const t = { id: uid(), atorId, x, y, tamanho: 1 };
  update(() => sc.tokens.push(t));
  selected = new Set([t.id]);
  draw();
}

// ---------- desenho ----------
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
  const sc = scene(), q = sc.tamanhoQuadrado;
  if (sc.id !== lastSceneId) { // trocou de cena: limpa seleção e enquadra
    const first = lastSceneId === null;
    lastSceneId = sc.id; selected.clear(); ruler = null;
    if (!first) { focusView(); return; }
  }
  for (const id of selected) if (!sc.tokens.some(t => t.id === id)) selected.delete(id);

  const dpr = devicePixelRatio || 1;
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

  const sel = getSelection();
  const origin = sel.length === 1 ? sel[0] : null;
  for (const t of sc.tokens) {
    const a = getActor(t.atorId);
    if (a) drawToken(t, a, q, selected.has(t.id), a.id === local.alvoId, t.id === hoverId);
  }
  // zona a partir do token selecionado até os demais
  if (origin) for (const t of sc.tokens) {
    if (t === origin || !getActor(t.atorId)) continue;
    const n = blockDistance(origin, t), z = zoneForBlocks(n);
    const temSelos = Object.keys(getActor(t.atorId).system.condicoes || {}).length > 0;
    label((t.x + size(t) / 2) * q, t.y * q - (temSelos ? Math.max(7, q * 0.17) * 1.6 : 0) - 11 / view.zoom, `${z.id} · ${n} bl`, cssVar('--accent'));
  }
  if (dragging && dragStart) for (const t of sel) {
    const from = dragStart.get(t.id);
    if (from && (from.x !== t.x || from.y !== t.y)) label((t.x + size(t) / 2) * q, (t.y + size(t) + 0.3) * q, `movido: ${zoneForBlocks(blockDistance({ ...from, tamanho: t.tamanho }, t)).nome}`, cssVar('--ink'));
  }
  if (ruler) {
    const a = ruler.a, b = ruler.b;
    ctx.strokeStyle = cssVar('--accent'); ctx.lineWidth = 3 / view.zoom; ctx.setLineDash([8 / view.zoom, 6 / view.zoom]);
    ctx.beginPath(); ctx.moveTo((a.x + 0.5) * q, (a.y + 0.5) * q); ctx.lineTo((b.x + 0.5) * q, (b.y + 0.5) * q); ctx.stroke();
    ctx.setLineDash([]);
    const n = blockDistance(a, b), z = zoneForBlocks(n);
    label((b.x + 0.5) * q, (b.y + 1.2) * q, `${z.nome} (${n} blocos)`, cssVar('--accent'));
  }
  if (box) {
    const x = Math.min(box.a.wx, box.b.wx), y = Math.min(box.a.wy, box.b.wy), w = Math.abs(box.a.wx - box.b.wx), h = Math.abs(box.a.wy - box.b.wy);
    ctx.fillStyle = cssVar('--accent'); ctx.globalAlpha = 0.12;
    ctx.fillRect(x, y, w, h); ctx.globalAlpha = 1;
    ctx.strokeStyle = cssVar('--accent'); ctx.lineWidth = 1.5 / view.zoom; ctx.setLineDash([5 / view.zoom, 4 / view.zoom]);
    ctx.strokeRect(x, y, w, h); ctx.setLineDash([]);
  }
  drawPings();
  for (const fn of viewListeners) fn();
}

const iconFor = id => CONFIG.condicaoById?.[id]?.icone || (id[0] || '?').toUpperCase();

function drawToken(t, a, q, isSel, isTarget, isHover) {
  const s = size(t), r0 = q * s / 2;
  const cx = t.x * q + r0, cy = t.y * q + r0, r = r0 * 0.84;
  const rec = a.system.recursos;
  ctx.save();
  if (rec.morto) ctx.globalAlpha = 0.55;
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.closePath();
  ctx.fillStyle = a.cor || '#333'; ctx.fill();
  if (a.imagem) {
    const img = image(a.imagem);
    if (img.complete && img.naturalWidth) { ctx.save(); ctx.clip(); ctx.drawImage(img, cx - r, cy - r, r * 2, r * 2); ctx.restore(); }
  } else {
    ctx.fillStyle = '#fff'; ctx.font = `600 ${r * 0.8}px ${cssVar('--font-ui')}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(initials(a.nome), cx, cy + 1);
  }
  ctx.lineWidth = (isSel ? 4 : isHover ? 3 : 2) / view.zoom;
  ctx.strokeStyle = isSel ? cssVar('--accent') : cssVar('--ink');
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke();
  ctx.globalAlpha = 1;
  if (isTarget) {
    ctx.strokeStyle = cssVar('--danger'); ctx.lineWidth = 2.5 / view.zoom; ctx.setLineDash([4 / view.zoom, 3 / view.zoom]);
    ctx.beginPath(); ctx.arc(cx, cy, r + 6 / view.zoom, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
    // mira
    for (const ang of [0, 90, 180, 270]) {
      const rad = ang * Math.PI / 180, r1 = r + 3 / view.zoom, r2 = r + 12 / view.zoom;
      ctx.beginPath(); ctx.moveTo(cx + Math.cos(rad) * r1, cy + Math.sin(rad) * r1); ctx.lineTo(cx + Math.cos(rad) * r2, cy + Math.sin(rad) * r2); ctx.stroke();
    }
  }
  if (rec.portasDaMorte && !rec.morto) {
    ctx.strokeStyle = cssVar('--danger'); ctx.lineWidth = 3 / view.zoom;
    ctx.setLineDash([2 / view.zoom, 4 / view.zoom]);
    ctx.beginPath(); ctx.arc(cx, cy, r - 4 / view.zoom, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
  }
  if (rec.morto) { // X
    ctx.strokeStyle = cssVar('--danger'); ctx.lineWidth = Math.max(3, r * 0.14); ctx.lineCap = 'round';
    const k = r * 0.6;
    ctx.beginPath(); ctx.moveTo(cx - k, cy - k); ctx.lineTo(cx + k, cy + k); ctx.moveTo(cx + k, cy - k); ctx.lineTo(cx - k, cy + k); ctx.stroke();
  }
  // barra de vida
  const d = prepareDerived(a), v = Math.max(0, rec.vida ?? d.vidaMax);
  const bw = q * s * 0.84, bx = cx - bw / 2, by = cy + r + 3;
  ctx.fillStyle = 'rgba(0,0,0,.55)'; ctx.fillRect(bx, by, bw, 5);
  ctx.fillStyle = v <= d.metadeVida ? cssVar('--danger') : cssVar('--ok');
  ctx.fillRect(bx, by, bw * Math.min(1, v / Math.max(1, d.vidaMax)), 5);
  // condições: selos no topo, da direita para a esquerda
  const conds = Object.entries(a.system.condicoes || {});
  if (conds.length) {
    const br = Math.max(7, q * 0.17), max = Math.max(3, Math.floor((q * s) / (br * 2.1)));
    const shown = conds.length > max ? conds.slice(0, max - 1) : conds;
    shown.forEach(([id, lvl], i) => badge(t.x * q + q * s - br - i * br * 2.1, t.y * q + br * 0.6, br, iconFor(id), lvl > 1 ? lvl : null));
    if (shown.length < conds.length) badge(t.x * q + q * s - br - shown.length * br * 2.1, t.y * q + br * 0.6, br, `+${conds.length - shown.length}`);
  }
  ctx.restore();
  // nome
  ctx.fillStyle = cssVar('--ink'); ctx.font = `500 ${Math.max(10, q * 0.24)}px ${cssVar('--font-ui')}`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'top';
  ctx.fillText(a.nome, cx, by + 7);
}

function badge(x, y, r, txt, n) {
  ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = cssVar('--paper'); ctx.fill();
  ctx.lineWidth = 1.2 / view.zoom; ctx.strokeStyle = cssVar('--ink'); ctx.stroke();
  ctx.fillStyle = cssVar('--ink'); ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.font = `600 ${r * 1.15}px ${cssVar('--font-ui')}, "Segoe UI Emoji", "Apple Color Emoji", sans-serif`;
  ctx.fillText(txt, x, y + r * 0.06);
  if (n != null) {
    ctx.font = `700 ${r * 0.85}px ${cssVar('--font-ui')}`;
    ctx.fillStyle = cssVar('--danger'); ctx.fillText(String(n), x + r * 0.8, y + r * 0.8);
  }
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

// ---------- ping ----------
const PING_MS = 1600;
function drawPings() {
  const now = performance.now();
  for (let i = pings.length - 1; i >= 0; i--) if (now - pings[i].t0 > PING_MS) pings.splice(i, 1);
  for (const p of pings) {
    const k = (now - p.t0) / PING_MS;
    for (const off of [0, 0.3]) {
      const kk = k - off;
      if (kk < 0 || kk > 1) continue;
      ctx.beginPath(); ctx.arc(p.x, p.y, (8 + kk * 60) / view.zoom, 0, Math.PI * 2);
      ctx.strokeStyle = p.cor; ctx.globalAlpha = 1 - kk; ctx.lineWidth = 4 / view.zoom; ctx.stroke();
    }
    ctx.globalAlpha = 1;
    if (p.nome && k < 0.8) label(p.x, p.y - 26 / view.zoom, p.nome, p.cor);
  }
  if (pings.length) requestAnimationFrame(draw);
}

function ping(c, puxar) {
  const nome = net.online ? net.nome : '';
  sendEvent({ tipo: 'ping', cena: scene().id, x: c.wx, y: c.wy, nome, cor: playerColor(nome || 'mestre'), puxar });
}

function onNetEvent(d) {
  if (d?.tipo !== 'ping' || d.cena !== scene().id) return;
  pings.push({ x: d.x, y: d.y, cor: d.cor || cssVar('--accent'), nome: d.nome, t0: performance.now() });
  if (d.puxar) panTo(d.x, d.y); else draw();
}

// ---------- interação ----------
function toCell(e) {
  const r = canvas.getBoundingClientRect(), q = scene().tamanhoQuadrado;
  const wx = (e.clientX - r.left - view.x) / view.zoom, wy = (e.clientY - r.top - view.y) / view.zoom;
  return { x: Math.floor(wx / q), y: Math.floor(wy / q), wx, wy };
}
const tokenAt = c => [...scene().tokens].reverse().find(t => getActor(t.atorId) && c.x >= t.x && c.x < t.x + size(t) && c.y >= t.y && c.y < t.y + size(t));

function onHover(e) {
  if (dragging || box || ruler) return;
  const id = tokenAt(toCell(e))?.id || null;
  if (id !== hoverId) { hoverId = id; canvas.style.cursor = rulerMode ? 'crosshair' : id ? 'pointer' : ''; draw(); }
}

/** Acompanha um arrasto do ponteiro até soltar. */
function track(e, move, up) {
  const mv = ev => move(ev), u = ev => { canvas.removeEventListener('pointermove', mv); canvas.removeEventListener('pointerup', u); canvas.removeEventListener('pointercancel', u); up?.(ev); };
  canvas.addEventListener('pointermove', mv); canvas.addEventListener('pointerup', u); canvas.addEventListener('pointercancel', u);
}

let dragStart = null;
function onDown(e) {
  try { canvas.setPointerCapture(e.pointerId); } catch { /* evento sintético (testes) */ }
  const c = toCell(e), t = tokenAt(c);
  if (e.button === 0 && e.altKey) { ping(c, e.shiftKey); return; }
  if (e.button === 1 || (e.button === 0 && spaceDown)) return pan(e);
  if (e.button === 2) { // direito: arrastar = mover o mapa; clique num token = marcar alvo
    const sx = e.clientX, sy = e.clientY;
    let moved = false;
    const v0 = { x: view.x, y: view.y };
    track(e, ev => {
      if (!moved && Math.hypot(ev.clientX - sx, ev.clientY - sy) > 4) moved = true;
      if (moved) { view.x = v0.x + ev.clientX - sx; view.y = v0.y + ev.clientY - sy; draw(); }
    }, () => {
      if (moved || !t) return;
      local.alvoId = local.alvoId === t.atorId ? null : t.atorId; // cada jogador tem o seu alvo
      notify();
    });
    return;
  }
  if (e.button !== 0) return;
  if (rulerMode || e.ctrlKey || e.metaKey) {
    ruler = { a: c, b: c };
    track(e, ev => { ruler.b = toCell(ev); draw(); }, () => { ruler = null; draw(); });
    return;
  }
  if (t) {
    if (e.shiftKey) { selected.has(t.id) ? selected.delete(t.id) : selected.add(t.id); }
    else if (!selected.has(t.id)) selected = new Set([t.id]);
    draw();
    if (!selected.has(t.id)) return;
    startDrag(e, c);
    return;
  }
  // vazio: caixa de seleção
  if (!e.shiftKey) selected.clear();
  const before = new Set(selected);
  box = { a: c, b: c };
  draw();
  track(e, ev => {
    box.b = toCell(ev);
    const x0 = Math.min(box.a.x, box.b.x), x1 = Math.max(box.a.x, box.b.x), y0 = Math.min(box.a.y, box.b.y), y1 = Math.max(box.a.y, box.b.y);
    selected = new Set(before);
    for (const tk of scene().tokens) if (tk.x + size(tk) - 1 >= x0 && tk.x <= x1 && tk.y + size(tk) - 1 >= y0 && tk.y <= y1) selected.add(tk.id);
    draw();
  }, () => { box = null; draw(); });
}

function startDrag(e, c0) {
  const sc = scene(), toks = getSelection();
  dragStart = new Map(toks.map(t => [t.id, { x: t.x, y: t.y }]));
  let moved = false;
  track(e, ev => {
    const c = toCell(ev);
    const dx = c.x - c0.x, dy = c.y - c0.y;
    if (!dx && !dy && !moved) return;
    moved = dragging = true;
    for (const t of toks) {
      const s0 = dragStart.get(t.id), n = size(t);
      t.x = Math.max(0, Math.min(sc.colunas - n, s0.x + dx));
      t.y = Math.max(0, Math.min(sc.linhas - n, s0.y + dy));
    }
    draw();
  }, () => {
    dragging = false;
    const changed = toks.some(t => { const s0 = dragStart.get(t.id); return s0.x !== t.x || s0.y !== t.y; });
    dragStart = null;
    if (changed) { checkpoint(); update(() => {}); checkpoint(); } else draw(); // um passo de desfazer por movimento
  });
}

function pan(e) {
  const sx = e.clientX - view.x, sy = e.clientY - view.y;
  canvas.style.cursor = 'grabbing';
  track(e, ev => { view.x = ev.clientX - sx; view.y = ev.clientY - sy; draw(); }, () => { canvas.style.cursor = rulerMode ? 'crosshair' : ''; });
}

function onWheel(e) {
  e.preventDefault();
  const r = canvas.getBoundingClientRect(), mx = e.clientX - r.left, my = e.clientY - r.top;
  const z = Math.max(0.2, Math.min(4, view.zoom * (e.deltaY < 0 ? 1.1 : 0.9)));
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

let spaceDown = false;
function onKey(e) {
  if (e.target.closest?.('input, textarea, select, [contenteditable]')) return;
  if (e.code === 'Space') { spaceDown = true; if (e.target === document.body) e.preventDefault(); return; }
  if (e.key === 'Escape') { selected.clear(); ruler = null; box = null; draw(); return; }
  const toks = getSelection();
  if (!toks.length) return;
  if (e.key === 'Delete' || e.key === 'Backspace') {
    const ids = new Set(toks.map(t => t.id));
    checkpoint();
    update(() => { const sc = scene(); sc.tokens = sc.tokens.filter(t => !ids.has(t.id)); });
    checkpoint();
    selected.clear();
    e.preventDefault();
    return;
  }
  const dir = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
  if (dir) {
    e.preventDefault();
    const step = e.shiftKey ? 2 : 1, sc = scene();
    update(() => {
      for (const t of toks) {
        t.x = Math.max(0, Math.min(sc.colunas - size(t), t.x + dir[0] * step));
        t.y = Math.max(0, Math.min(sc.linhas - size(t), t.y + dir[1] * step));
      }
    });
  }
}
