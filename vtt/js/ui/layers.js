// Camadas do mapa além dos tokens: desenhos (quadro branco), áreas de efeito, névoa de guerra e réguas.
// Coordenadas em QUADRADOS (números com fração), para os desenhos não saírem do lugar se o mestre mudar o
// tamanho do quadrado. Funções puras de geometria são exportadas para os testes.
import { CONFIG } from '../system/config.js';

const cssVar = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
const tsize = t => Math.max(1, Math.min(4, Number(t?.tamanho) || 1));

// ---------------------------------------------------------------------------
// Geometria (em quadrados)
// ---------------------------------------------------------------------------

/** Distância em blocos entre duas células (mesma regra do mapa: soma das diferenças entre blocos 2×2). */
export const cellBlocks = (a, b) => Math.abs(Math.floor(a.x / 2) - Math.floor(b.x / 2)) + Math.abs(Math.floor(a.y / 2) - Math.floor(b.y / 2));
export function zoneFor(n) {
  const zs = CONFIG.sistema?.zonas || [];
  return zs.find(z => n >= z.blocos[0] && (z.blocos[1] == null || n <= z.blocos[1])) || zs[zs.length - 1] || { id: '?', nome: '?' };
}
/** Distância total de uma régua com vários pontos (células), em blocos. */
export const pathBlocks = pts => pts.slice(1).reduce((s, p, i) => s + cellBlocks(pts[i], p), 0);

const CONE = Math.PI / 8; // meia abertura: 45° no total (cap. 7, Tabela de Áreas)

/** O ponto p (em quadrados) está dentro da área? a = origem, b = ponto arrastado. */
export function insideArea(area, p) {
  const { a, b, forma } = area;
  const dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy);
  const px = p.x - a.x, py = p.y - a.y;
  switch (forma) {
    case 'circulo': return Math.hypot(px, py) <= len + 1e-9;
    case 'quadrado': { const h = Math.max(Math.abs(dx), Math.abs(dy)); return Math.abs(px) <= h + 1e-9 && Math.abs(py) <= h + 1e-9; }
    case 'cone': {
      const d = Math.hypot(px, py);
      if (d < 1e-9) return true;
      if (d > len + 1e-9 || len < 1e-9) return false;
      const cos = (px * dx + py * dy) / (d * len);
      return cos >= Math.cos(CONE) - 1e-9;
    }
    case 'linha': {
      if (len < 1e-9) return Math.hypot(px, py) <= 0.5;
      const t = (px * dx + py * dy) / (len * len);
      if (t < 0 || t > 1) return false;
      return Math.abs(px * dy - py * dx) / len <= 0.5 + 1e-9; // meio quadrado para cada lado
    }
  }
  return false;
}

/** Tokens atingidos: algum quadrado do token tem o centro dentro da área. */
export function tokensInArea(area, tokens) {
  return tokens.filter(t => {
    const s = tsize(t);
    for (let i = 0; i < s; i++) for (let j = 0; j < s; j++) if (insideArea(area, { x: t.x + i + 0.5, y: t.y + j + 0.5 })) return true;
    return false;
  });
}

/** Tamanho da área medido como na régua: distância em blocos entre as pontas (diâmetro, lado, altura ou comprimento). */
export function areaExtent(area) {
  const { a, b, forma } = area;
  const cell = p => ({ x: Math.floor(p.x), y: Math.floor(p.y) });
  if (forma === 'circulo' || forma === 'quadrado') {
    const r = forma === 'circulo' ? Math.hypot(b.x - a.x, b.y - a.y) : Math.max(Math.abs(b.x - a.x), Math.abs(b.y - a.y));
    return cellBlocks(cell({ x: a.x - r, y: a.y }), cell({ x: a.x + r - 1e-6, y: a.y }));
  }
  return cellBlocks(cell(a), cell(b));
}

/** Névoa: a célula está revelada? */
export const revealed = (nevoa, x, y) => !nevoa?.ativa || !!nevoa.revelado?.[`${x},${y}`];
/** Algum quadrado do token está revelado? */
export function tokenVisible(nevoa, t) {
  if (!nevoa?.ativa) return true;
  const s = tsize(t);
  for (let i = 0; i < s; i++) for (let j = 0; j < s; j++) if (revealed(nevoa, t.x + i, t.y + j)) return true;
  return false;
}

/** Distância de um ponto a um segmento (quadrados). */
function distSeg(p, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y, l2 = dx * dx + dy * dy;
  const t = l2 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2)) : 0;
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/** O desenho está sob o ponto (para a borracha)? */
export function hitDrawing(d, p, tol = 0.35) {
  switch (d.tipo) {
    case 'livre': {
      for (let i = 0; i + 3 < d.pts.length; i += 2) if (distSeg(p, { x: d.pts[i], y: d.pts[i + 1] }, { x: d.pts[i + 2], y: d.pts[i + 3] }) <= tol) return true;
      return d.pts.length === 2 && Math.hypot(p.x - d.pts[0], p.y - d.pts[1]) <= tol;
    }
    case 'linha': return distSeg(p, d.a, d.b) <= tol;
    case 'retangulo': {
      const x0 = Math.min(d.a.x, d.b.x), x1 = Math.max(d.a.x, d.b.x), y0 = Math.min(d.a.y, d.b.y), y1 = Math.max(d.a.y, d.b.y);
      const dentro = p.x >= x0 - tol && p.x <= x1 + tol && p.y >= y0 - tol && p.y <= y1 + tol;
      return dentro && (p.x <= x0 + tol || p.x >= x1 - tol || p.y <= y0 + tol || p.y >= y1 - tol);
    }
    case 'circulo': return Math.abs(Math.hypot(p.x - d.a.x, p.y - d.a.y) - Math.hypot(d.b.x - d.a.x, d.b.y - d.a.y)) <= tol;
    case 'texto': return p.x >= d.a.x - 0.2 && p.x <= d.a.x + Math.max(1, (d.texto || '').length * 0.32 * (d.tam || 1)) && p.y >= d.a.y - 0.9 * (d.tam || 1) && p.y <= d.a.y + 0.3;
    case 'area': return insideArea(d, p);
  }
  return false;
}

// ---------------------------------------------------------------------------
// Desenho
// ---------------------------------------------------------------------------

/** Desenhos e áreas (abaixo dos tokens). */
export function drawDrawings(ctx, sc, view, { preview = null, tokens = [] } = {}) {
  const q = sc.tamanhoQuadrado;
  for (const d of [...(sc.desenhos || []), ...(preview ? [preview] : [])]) {
    ctx.save();
    ctx.strokeStyle = ctx.fillStyle = d.cor || cssVar('--accent');
    ctx.lineWidth = Math.max(1, (d.esp || 3)) / view.zoom * (d.tipo === 'livre' ? 1 : 1);
    ctx.lineCap = ctx.lineJoin = 'round';
    switch (d.tipo) {
      case 'livre':
        ctx.beginPath();
        for (let i = 0; i < d.pts.length; i += 2) (i ? ctx.lineTo : ctx.moveTo).call(ctx, d.pts[i] * q, d.pts[i + 1] * q);
        if (d.pts.length === 2) ctx.lineTo(d.pts[0] * q + 0.1, d.pts[1] * q);
        ctx.stroke();
        break;
      case 'linha': ctx.beginPath(); ctx.moveTo(d.a.x * q, d.a.y * q); ctx.lineTo(d.b.x * q, d.b.y * q); ctx.stroke(); break;
      case 'retangulo': ctx.strokeRect(Math.min(d.a.x, d.b.x) * q, Math.min(d.a.y, d.b.y) * q, Math.abs(d.b.x - d.a.x) * q, Math.abs(d.b.y - d.a.y) * q); break;
      case 'circulo': ctx.beginPath(); ctx.arc(d.a.x * q, d.a.y * q, Math.hypot(d.b.x - d.a.x, d.b.y - d.a.y) * q, 0, Math.PI * 2); ctx.stroke(); break;
      case 'texto':
        ctx.font = `600 ${q * 0.6 * (d.tam || 1)}px ${cssVar('--font-ui')}`; ctx.textBaseline = 'alphabetic'; ctx.textAlign = 'left';
        ctx.lineWidth = 3 / view.zoom; ctx.strokeStyle = cssVar('--paper'); ctx.strokeText(d.texto || '', d.a.x * q, d.a.y * q);
        ctx.fillText(d.texto || '', d.a.x * q, d.a.y * q);
        break;
      case 'area': drawArea(ctx, d, q, view, tokens); break;
    }
    ctx.restore();
  }
}

const FORMAS = { circulo: 'Círculo', quadrado: 'Quadrado', cone: 'Cone', linha: 'Linha' };

function drawArea(ctx, d, q, view, tokens) {
  const { a, b } = d, dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy);
  ctx.beginPath();
  if (d.forma === 'circulo') ctx.arc(a.x * q, a.y * q, len * q, 0, Math.PI * 2);
  else if (d.forma === 'quadrado') { const h = Math.max(Math.abs(dx), Math.abs(dy)); ctx.rect((a.x - h) * q, (a.y - h) * q, 2 * h * q, 2 * h * q); }
  else if (d.forma === 'cone') { const ang = Math.atan2(dy, dx); ctx.moveTo(a.x * q, a.y * q); ctx.arc(a.x * q, a.y * q, len * q, ang - CONE, ang + CONE); ctx.closePath(); }
  else if (d.forma === 'linha') {
    const nx = len ? -dy / len * 0.5 : 0.5, ny = len ? dx / len * 0.5 : 0;
    ctx.moveTo((a.x + nx) * q, (a.y + ny) * q); ctx.lineTo((b.x + nx) * q, (b.y + ny) * q); ctx.lineTo((b.x - nx) * q, (b.y - ny) * q); ctx.lineTo((a.x - nx) * q, (a.y - ny) * q); ctx.closePath();
  }
  ctx.globalAlpha = 0.18; ctx.fill(); ctx.globalAlpha = 0.9;
  ctx.lineWidth = 2 / view.zoom; ctx.setLineDash([6 / view.zoom, 4 / view.zoom]); ctx.stroke(); ctx.setLineDash([]);
  ctx.globalAlpha = 1;
  // atingidos
  ctx.lineWidth = 3 / view.zoom;
  for (const t of tokensInArea(d, tokens)) { const s = tsize(t); ctx.beginPath(); ctx.arc((t.x + s / 2) * q, (t.y + s / 2) * q, s * q * 0.5, 0, Math.PI * 2); ctx.stroke(); }
}

/** Rótulos das áreas (tamanho em zonas e quantos foram atingidos), por cima dos tokens. */
export function drawAreaLabels(ctx, sc, view, { preview = null, tokens = [] } = {}) {
  const q = sc.tamanhoQuadrado;
  for (const d of [...(sc.desenhos || []), ...(preview ? [preview] : [])]) {
    if (d.tipo !== 'area') continue;
    const { a, b } = d, len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    // fora da área, depois da ponta arrastada
    const ux = (b.x - a.x) / len, uy = (b.y - a.y) / len;
    const [lx, ly] = d.forma === 'circulo' || d.forma === 'quadrado' ? [a.x, a.y - (d.forma === 'circulo' ? len : Math.max(Math.abs(b.x - a.x), Math.abs(b.y - a.y))) - 0.5] : [b.x + ux * 0.9, b.y + uy * 0.9];
    const n = areaExtent(d), z = zoneFor(n), hit = tokensInArea(d, tokens).length;
    const medida = { circulo: 'diâmetro', quadrado: 'lado', cone: 'altura', linha: 'distância' }[d.forma];
    pill(ctx, view, lx * q, ly * q, `${FORMAS[d.forma]} · ${medida} ${z.id} (${n} bl) · ${hit} atingido(s)`, d.cor || cssVar('--accent'));
  }
}

export function pill(ctx, view, x, y, txt, color) {
  ctx.font = `600 ${12 / view.zoom}px ${cssVar('--font-ui')}`;
  const w = ctx.measureText(txt).width + 12 / view.zoom, h = 18 / view.zoom;
  ctx.fillStyle = color; ctx.globalAlpha = 0.92; ctx.fillRect(x - w / 2, y - h / 2, w, h); ctx.globalAlpha = 1;
  ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(txt, x, y);
}

/** Névoa de guerra (por cima de tudo). Jogador: preta. Mestre: translúcida, para continuar vendo o mapa. */
export function drawFog(ctx, sc, view, gm) {
  const nv = sc.nevoa;
  if (!nv?.ativa) return;
  const q = sc.tamanhoQuadrado;
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, sc.colunas * q, sc.linhas * q);
  for (const k of Object.keys(nv.revelado || {})) { const [x, y] = k.split(',').map(Number); ctx.rect(x * q, y * q, q, q); }
  ctx.fillStyle = gm ? 'rgba(20, 20, 30, .45)' : '#111';
  ctx.fill('evenodd');
  ctx.restore();
}

/** Régua com vários pontos (células). */
export function drawRuler(ctx, view, q, pts, color, nome = '') {
  if (pts.length < 2) return;
  ctx.save();
  ctx.strokeStyle = color; ctx.lineWidth = 3 / view.zoom; ctx.setLineDash([8 / view.zoom, 6 / view.zoom]);
  ctx.beginPath();
  pts.forEach((p, i) => (i ? ctx.lineTo : ctx.moveTo).call(ctx, (p.x + 0.5) * q, (p.y + 0.5) * q));
  ctx.stroke(); ctx.setLineDash([]);
  ctx.fillStyle = color;
  for (const p of pts.slice(1, -1)) { ctx.beginPath(); ctx.arc((p.x + 0.5) * q, (p.y + 0.5) * q, 4 / view.zoom, 0, Math.PI * 2); ctx.fill(); }
  const n = pathBlocks(pts), z = zoneFor(n), end = pts[pts.length - 1];
  const parcial = pts.length > 2 ? ` · trecho ${zoneFor(cellBlocks(pts[pts.length - 2], end)).id}` : '';
  pill(ctx, view, (end.x + 0.5) * q, (end.y + 1.3) * q, `${nome ? nome + ': ' : ''}${z.nome} (${n} blocos)${parcial}`, color);
  ctx.restore();
}
