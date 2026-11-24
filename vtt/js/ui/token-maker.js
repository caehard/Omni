// Criação de token (Biblioteca > Personagens): a ilustração do personagem recortada em círculo ou quadrado,
// com uma borda metálica, pronta para o mapa. O resultado é um PNG transparente fora da borda.
import { state, update, library, ownsActor, ownsItem, newId, local, safeUrl } from '../core/store.js';
import { guardarImagem, carregarImagem } from '../core/files.js';
import { esc, toast, pickFile } from './dom.js';

export const CORES_BORDA = [
  { id: 'ouro', nome: 'Ouro', claro: '#fbe08a', escuro: '#9a6b0c' },
  { id: 'prata', nome: 'Prata', claro: '#f4f5f7', escuro: '#7d838c' },
  { id: 'bronze', nome: 'Bronze', claro: '#eab07a', escuro: '#6e3f17' },
  { id: 'ferro', nome: 'Ferro', claro: '#a7adb3', escuro: '#33373b' },
  { id: 'sangue', nome: 'Sangue', claro: '#ef6b5e', escuro: '#5e0d0d' },
  { id: 'arcano', nome: 'Arcano', claro: '#c7a6ff', escuro: '#35196e' },
  { id: 'natureza', nome: 'Natureza', claro: '#9fdc74', escuro: '#25501a' },
  { id: 'gelo', nome: 'Gelo', claro: '#e4f7ff', escuro: '#3f82ab' },
  { id: 'sombra', nome: 'Sombra', claro: '#5c5c66', escuro: '#0d0d10' },
];
export const ESTILOS_BORDA = [['simples', 'Simples'], ['dupla', 'Dupla'], ['ornada', 'Ornamentada']];

/** Caminho da forma (círculo ou quadrado arredondado) com "raio" r, centrado. */
function forma(ctx, S, r, tipo) {
  const c = S / 2;
  if (tipo === 'quadrado') {
    const k = r * 0.22;
    ctx.roundRect(c - r, c - r, 2 * r, 2 * r, k);
  } else { ctx.moveTo(c + r, c); ctx.arc(c, c, r, 0, Math.PI * 2); }
}

/**
 * Desenha o token. o = { forma, estilo, cor (id ou {claro, escuro}), espessura (fração do lado), zoom, dx, dy (fração), fundo }.
 * img pode ser null (só a borda, para a prévia sem imagem).
 */
export function desenharToken(ctx, S, img, o) {
  const cor = typeof o.cor === 'object' ? o.cor : CORES_BORDA.find(c => c.id === o.cor) || CORES_BORDA[0];
  const R = S / 2 - S * 0.01, t = Math.max(2, S * (o.espessura ?? 0.07)), ri = R - t;
  ctx.clearRect(0, 0, S, S);
  // imagem dentro da borda (cobrindo; o zoom e o deslocamento escolhem o enquadramento)
  ctx.save();
  ctx.beginPath(); forma(ctx, S, ri + 1, o.forma); ctx.clip();
  if (o.fundo && o.fundo !== 'transparente') { ctx.fillStyle = o.fundo; ctx.fillRect(0, 0, S, S); }
  if (img) {
    const k = Math.max(2 * ri / img.naturalWidth, 2 * ri / img.naturalHeight) * (o.zoom || 1);
    const w = img.naturalWidth * k, h = img.naturalHeight * k;
    ctx.drawImage(img, S / 2 - w / 2 + (o.dx || 0) * S, S / 2 - h / 2 + (o.dy || 0) * S, w, h);
  }
  // sombra interna: a borda "afunda" a imagem
  ctx.shadowColor = 'rgba(0,0,0,.65)'; ctx.shadowBlur = t * 0.9;
  ctx.lineWidth = t; ctx.strokeStyle = '#000';
  ctx.beginPath(); forma(ctx, S, ri + t / 2, o.forma); ctx.stroke();
  ctx.restore();

  // anel metálico
  const g = ctx.createLinearGradient(0, 0, S, S);
  g.addColorStop(0, cor.claro); g.addColorStop(0.35, cor.escuro); g.addColorStop(0.55, cor.claro); g.addColorStop(0.8, cor.escuro); g.addColorStop(1, cor.claro);
  ctx.save();
  ctx.beginPath(); forma(ctx, S, R, o.forma); forma(ctx, S, ri, o.forma);
  ctx.fillStyle = g; ctx.fill('evenodd');
  // brilho por cima (luz vindo de cima)
  const brilho = ctx.createLinearGradient(0, 0, 0, S);
  brilho.addColorStop(0, 'rgba(255,255,255,.35)'); brilho.addColorStop(0.5, 'rgba(255,255,255,0)'); brilho.addColorStop(1, 'rgba(0,0,0,.25)');
  ctx.fillStyle = brilho; ctx.fill('evenodd');
  ctx.restore();
  const linha = (r, w, c) => { ctx.beginPath(); forma(ctx, S, r, o.forma); ctx.lineWidth = w; ctx.strokeStyle = c; ctx.stroke(); };
  linha(R - 0.5, Math.max(1, S * 0.004), 'rgba(0,0,0,.55)');
  linha(ri + 0.5, Math.max(1, S * 0.004), 'rgba(0,0,0,.6)');
  if (o.estilo === 'dupla' || o.estilo === 'ornada') {
    linha(R - t * 0.5, Math.max(1, S * 0.005), 'rgba(0,0,0,.45)');
    linha(R - t * 0.5 - S * 0.004, Math.max(1, S * 0.003), 'rgba(255,255,255,.45)');
  }
  if (o.estilo === 'ornada') { // cravos em volta e uma gema em cima
    const n = 12, rm = R - t / 2, rc = t * 0.26;
    for (let i = 0; i < n; i++) {
      const a = -Math.PI / 2 + (i * 2 * Math.PI) / n;
      let x = S / 2 + Math.cos(a) * rm, y = S / 2 + Math.sin(a) * rm;
      if (o.forma === 'quadrado') { const m = Math.max(Math.abs(Math.cos(a)), Math.abs(Math.sin(a))); x = S / 2 + Math.cos(a) / m * rm; y = S / 2 + Math.sin(a) / m * rm; }
      if (i === 0) continue;
      const gc = ctx.createRadialGradient(x - rc * 0.3, y - rc * 0.3, rc * 0.1, x, y, rc);
      gc.addColorStop(0, '#fff'); gc.addColorStop(0.4, cor.claro); gc.addColorStop(1, cor.escuro);
      ctx.beginPath(); ctx.arc(x, y, rc, 0, Math.PI * 2); ctx.fillStyle = gc; ctx.fill();
      ctx.lineWidth = 1; ctx.strokeStyle = 'rgba(0,0,0,.5)'; ctx.stroke();
    }
    const gx = S / 2, gy = S / 2 - rm, gr = t * 0.48;
    const gg = ctx.createRadialGradient(gx - gr * 0.3, gy - gr * 0.35, gr * 0.1, gx, gy, gr);
    gg.addColorStop(0, '#ffffff'); gg.addColorStop(0.35, o.gema || '#d23b3b'); gg.addColorStop(1, '#2a0606');
    ctx.beginPath(); ctx.moveTo(gx, gy - gr); ctx.lineTo(gx + gr * 0.8, gy); ctx.lineTo(gx, gy + gr); ctx.lineTo(gx - gr * 0.8, gy); ctx.closePath();
    ctx.fillStyle = gg; ctx.fill(); ctx.lineWidth = Math.max(1, S * 0.004); ctx.strokeStyle = cor.escuro; ctx.stroke();
  }
}

const PADRAO = { forma: 'circulo', estilo: 'dupla', cor: 'ouro', espessura: 0.07, zoom: 1, dx: 0, dy: 0, fundo: '#1c1c1c', gema: '#d23b3b' };

/** Monta o editor dentro de `el`. Devolve { setFonte(item|{url,nome}) }. */
export function montarTokenMaker(el, { onSalvo } = {}) {
  const o = { ...PADRAO };
  let fonte = null, img = null;
  el.innerHTML = `<div class="token-maker">
    <div class="tm-preview"><canvas width="512" height="512" aria-label="Prévia do token"></canvas>
      <p class="hint">Arraste a imagem para enquadrar · roda do mouse aproxima</p></div>
    <div class="tm-fonte"><span data-fonte class="muted">Escolha uma ilustração abaixo ou envie uma.</span> <button data-enviar>Enviar imagem…</button></div>
    <div class="tm-escolha" data-lista></div>
    <div class="tm-opcoes">
      <label>Forma <select data-o="forma"><option value="circulo">Círculo</option><option value="quadrado">Quadrado</option></select></label>
      <label>Borda <select data-o="estilo">${ESTILOS_BORDA.map(([v, n]) => `<option value="${v}">${n}</option>`).join('')}</select></label>
      <div class="tm-cores">${CORES_BORDA.map(c => `<button data-cor="${c.id}" title="${c.nome}" style="--a:${c.claro};--b:${c.escuro}"></button>`).join('')}</div>
      <label>Espessura <input type="range" min="0.03" max="0.14" step="0.005" data-o="espessura"></label>
      <label>Zoom <input type="range" min="0.5" max="3" step="0.01" data-o="zoom"></label>
      <label>Fundo <input type="color" data-o="fundo"></label>
      <label data-gema hidden>Gema <input type="color" data-o="gema"></label>
    </div>
    <div class="tm-salvar">
      <label>Usar na ficha <select data-ficha><option value="">— só salvar na biblioteca —</option></select></label>
      <button class="primary" data-salvar>Salvar token</button>
    </div></div>`;
  const cv = el.querySelector('canvas'), ctx = cv.getContext('2d');
  const desenha = () => desenharToken(ctx, 512, img, o);
  const sync = () => {
    el.querySelectorAll('[data-o]').forEach(i => { i.value = o[i.dataset.o]; });
    el.querySelectorAll('[data-cor]').forEach(b => b.setAttribute('aria-pressed', b.dataset.cor === o.cor));
    el.querySelector('[data-gema]').hidden = o.estilo !== 'ornada';
    desenha();
  };
  const lista = () => {
    const itens = library().filter(i => (i.tipo === 'personagem' || i.tipo === 'imagem') && safeUrl(i.url));
    el.querySelector('[data-lista]').innerHTML = itens.length ? itens.slice().reverse().map(i =>
      `<button data-src="${esc(i.id)}" title="${esc(i.nome)}" aria-pressed="${fonte?.id === i.id}"><img src="${esc(safeUrl(i.mini) || safeUrl(i.url))}" alt="" loading="lazy"></button>`).join('')
      : '<p class="hint">A biblioteca ainda não tem ilustrações.</p>';
    const sel = el.querySelector('[data-ficha]'), atual = sel.value;
    sel.innerHTML = '<option value="">— só salvar na biblioteca —</option>' + state.atores.filter(ownsActor).map(a => `<option value="${esc(a.id)}">${esc(a.nome)}</option>`).join('');
    sel.value = state.atores.some(a => a.id === atual) ? atual : '';
  };
  async function setFonte(f) {
    fonte = f; img = null;
    Object.assign(o, { zoom: 1, dx: 0, dy: 0 });
    el.querySelector('[data-fonte]').innerHTML = f ? `Ilustração: <b>${esc(f.nome || 'imagem')}</b>` : '';
    lista(); sync();
    if (!f) return;
    try { img = await carregarImagem(safeUrl(f.url)); } catch (e) { toast(e.message); }
    // ilustração de corpo inteiro: começa no busto (rosto um pouco acima do centro)
    if (img && img.naturalHeight > img.naturalWidth * 1.2) {
      const zoom = 2.2, ri = 0.49 - o.espessura;                          // raio interno, em fração do lado
      const altura = zoom * 2 * ri * img.naturalHeight / img.naturalWidth; // altura da imagem desenhada, em fração do lado
      Object.assign(o, { zoom, dy: (0.5 - 0.17) * altura });
    }
    sync();
  }

  el.addEventListener('input', e => {
    const k = e.target.dataset.o;
    if (!k) return;
    o[k] = e.target.type === 'range' ? +e.target.value : e.target.value;
    if (k === 'estilo') sync(); else desenha();
  });
  el.addEventListener('click', async e => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.cor) { o.cor = b.dataset.cor; sync(); }
    if (b.dataset.src) setFonte(library().find(i => i.id === b.dataset.src));
    if (b.matches('[data-enviar]')) {
      const f = await pickFile('image/png,image/jpeg,image/webp');
      if (!f) return;
      try {
        const { url, mini } = await guardarImagem(f);
        const item = { id: newId(), tipo: 'personagem', nome: f.name.replace(/\.\w+$/, '').slice(0, 60), url, mini, mime: f.type, de: local.jogadorId, criado: Date.now(), descricao: '' };
        update(s => { (s.biblioteca ||= []).push(item); });
        setFonte(item);
      } catch (err) { toast('Não consegui enviar: ' + err.message); }
    }
    if (b.matches('[data-salvar]')) salvar(b);
  });
  // arrastar e zoom na prévia
  cv.addEventListener('pointerdown', e => {
    if (!img) return;
    cv.setPointerCapture(e.pointerId);
    const k = 1 / cv.getBoundingClientRect().width, sx = e.clientX, sy = e.clientY, ox = o.dx, oy = o.dy;
    const mv = ev => { o.dx = ox + (ev.clientX - sx) * k; o.dy = oy + (ev.clientY - sy) * k; desenha(); };
    const up = () => { cv.removeEventListener('pointermove', mv); cv.removeEventListener('pointerup', up); };
    cv.addEventListener('pointermove', mv); cv.addEventListener('pointerup', up);
  });
  cv.addEventListener('wheel', e => {
    if (!img) return;
    e.preventDefault();
    o.zoom = Math.max(0.5, Math.min(3, o.zoom * (e.deltaY < 0 ? 1.08 : 1 / 1.08)));
    sync();
  }, { passive: false });

  async function salvar(btn) {
    if (!img) { toast('Escolha uma ilustração primeiro.'); return; }
    btn.disabled = true;
    try {
      const S = 512, c = document.createElement('canvas');
      c.width = c.height = S;
      desenharToken(c.getContext('2d'), S, img, o);
      const blob = await new Promise(res => c.toBlob(res, 'image/png'));
      const { url } = await guardarImagem(blob);
      const fichaId = el.querySelector('[data-ficha]').value;
      update(s => {
        const it = (s.biblioteca ||= []).find(i => i.id === fonte?.id);
        if (it && it.tipo === 'personagem' && ownsItem(it)) it.token = url;
        else s.biblioteca.push({ id: newId(), tipo: 'personagem', nome: fonte?.nome || 'Token', url: fonte?.url || url, mini: fonte?.mini || '', token: url, de: local.jogadorId, criado: Date.now(), descricao: fonte?.descricao || '' });
        const a = s.atores.find(x => x.id === fichaId);
        if (a) { a.token = url; if (!a.imagem) a.imagem = fonte?.url || url; }
      });
      toast(fichaId ? 'Token salvo e aplicado à ficha.' : 'Token salvo na biblioteca.');
      onSalvo?.(url);
    } catch (err) { toast('Não consegui salvar o token: ' + err.message); }
    btn.disabled = false;
  }

  sync(); lista();
  return { setFonte, atualizar: lista };
}
