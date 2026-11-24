// Menu rápido do token selecionado (vida, sanidade, condições, tamanho e atalhos), no canto do mapa.
import { state, local, scene, update, notify, getActor, subscribe } from '../core/store.js';
import { prepareDerived } from '../system/actor.js';
import { CONFIG } from '../system/config.js';
import { getSelection, isDragging, onViewChange } from './board.js';
import { openDamageDialog } from './sheet.js';
import { esc } from './dom.js';

let el, openSheet, sig = '';

export function initTokenHud(container, { onOpenSheet }) {
  openSheet = onOpenSheet;
  el = document.createElement('div');
  el.className = 'token-hud';
  el.hidden = true;
  container.append(el);
  el.addEventListener('click', onClick);
  el.addEventListener('change', onChange);
  el.addEventListener('pointerdown', e => e.stopPropagation());
  subscribe(refresh);
  onViewChange(refresh);
}

const conds = () => CONFIG.condicoes.condicoes;
const maxLevel = c => (c.maxNivel === 0 ? 1 : c.maxNivel === 99 ? Infinity : c.maxNivel);

function refresh() {
  if (!el) return;
  const sel = getSelection();
  if (!sel.length || isDragging()) { el.hidden = true; sig = ''; return; }
  const s = structureSig(sel);
  if (s !== sig) { sig = s; render(sel); } else syncValues(sel);
  el.hidden = false;
}

/** Muda só quando a estrutura do menu muda (senão só atualiza os valores, sem perder o foco). */
function structureSig(sel) {
  if (sel.length > 1) return 'multi:' + sel.map(t => t.id).join(',');
  const t = sel[0], a = getActor(t.atorId);
  return [t.id, t.tamanho, a?.id, JSON.stringify(a?.system.condicoes), local.alvoId === a?.id,
    state.combate.combatentes.some(c => c.atorId === a?.id)].join('|');
}

function render(sel) {
  if (sel.length > 1) {
    el.innerHTML = `<header><b>${sel.length} tokens</b></header>
      <div class="hud-row"><label>Tamanho ${sizeSelect('')}</label></div>
      <div class="hud-actions">
        <button data-act="combate" title="Adicionar todos ao combate">+ Combate</button>
        <button data-act="remover" class="danger" title="Remover do mapa (Delete)">Remover</button></div>`;
    return;
  }
  const t = sel[0], a = getActor(t.atorId);
  if (!a) { el.innerHTML = ''; return; }
  const d = prepareDerived(a), r = a.system.recursos;
  const ativas = Object.entries(a.system.condicoes || {});
  const emCombate = state.combate.combatentes.some(c => c.atorId === a.id);
  el.innerHTML = `<header><span class="dot" style="background:${esc(a.cor)}"></span><b>${esc(a.nome)}</b><small>Nv ${d.nivel}</small></header>
    ${resource('vida', 'Vida', r.vida, d.vidaMax)}
    ${resource('sanidade', 'Sanidade', r.sanidade, d.sanidadeMax)}
    <div class="hud-conds">${ativas.map(([id, lvl]) => {
      const c = CONFIG.condicaoById[id] || { nome: id, maxNivel: 0 };
      const lv = c.maxNivel !== 0;
      return `<span class="chip" title="${esc(c.descricao || '')}">${esc(c.icone || '')} ${esc(c.nome)}${lv ? ` <b>${lvl}</b>` : ''}
        ${lv ? `<button class="icon-btn" data-act="cond-" data-id="${id}" title="−1 nível">−</button><button class="icon-btn" data-act="cond+" data-id="${id}" title="+1 nível">+</button>` : ''}
        <button class="icon-btn" data-act="cond-x" data-id="${id}" title="Remover">✕</button></span>`;
    }).join('')}
      <select data-field="nova-cond" aria-label="Adicionar condição"><option value="">+ condição</option>
        ${conds().filter(c => !(c.id in (a.system.condicoes || {}))).map(c => `<option value="${c.id}">${esc(c.icone || '')} ${esc(c.nome)}</option>`).join('')}</select></div>
    <div class="hud-row"><label>Tamanho ${sizeSelect(size(t))}</label></div>
    <div class="hud-actions">
      <button data-act="ficha">Ficha</button>
      <button data-act="dano">Dano/Cura</button>
      <button data-act="alvo" aria-pressed="${local.alvoId === a.id}" title="Marcar como alvo (botão direito no token)">◎ Alvo</button>
      <button data-act="combate" ${emCombate ? 'disabled' : ''} title="Adicionar ao combate">${emCombate ? 'Em combate' : '+ Combate'}</button>
      <button data-act="remover" class="danger" title="Remover do mapa (Delete)">Remover</button></div>`;
}

const size = t => Math.max(1, Math.min(4, Number(t.tamanho) || 1));
const sizeSelect = cur => `<select data-field="tamanho">${cur === '' ? '<option value="">—</option>' : ''}${[1, 2, 3, 4].map(n => `<option value="${n}" ${n === cur ? 'selected' : ''}>${n}×${n}</option>`).join('')}</select>`;

function resource(key, nome, cur, max) {
  const p = max > 0 ? Math.max(0, Math.min(100, (cur / max) * 100)) : 0;
  return `<div class="hud-res" data-res="${key}">
    <span class="hud-label">${nome}</span>
    <button class="icon-btn" data-act="res-" data-res="${key}" title="−1">−</button>
    <input type="number" data-field="res" data-res="${key}" value="${cur ?? 0}" aria-label="${nome}">
    <span class="muted">/ ${max}</span>
    <button class="icon-btn" data-act="res+" data-res="${key}" title="+1">+</button>
    <span class="bar ${key === 'vida' ? 'hp' : 'san'}"><i style="width:${p}%"></i></span></div>`;
}

function syncValues(sel) {
  if (sel.length !== 1) return;
  const a = getActor(sel[0].atorId);
  if (!a) return;
  const d = prepareDerived(a), r = a.system.recursos, max = { vida: d.vidaMax, sanidade: d.sanidadeMax };
  for (const row of el.querySelectorAll('.hud-res')) {
    const k = row.dataset.res, input = row.querySelector('input');
    if (input !== document.activeElement) input.value = r[k] ?? 0;
    row.querySelector('.muted').textContent = `/ ${max[k]}`;
    row.querySelector('.bar i').style.width = `${max[k] > 0 ? Math.max(0, Math.min(100, (r[k] / max[k]) * 100)) : 0}%`;
  }
}

function onClick(e) {
  const b = e.target.closest('button[data-act]');
  if (!b) return;
  const sel = getSelection(), t = sel[0], a = t && getActor(t.atorId);
  const act = b.dataset.act;
  if (act === 'remover') {
    const ids = new Set(sel.map(x => x.id));
    update(() => { const sc = scene(); sc.tokens = sc.tokens.filter(x => !ids.has(x.id)); });
    return;
  }
  if (act === 'combate') {
    update(s => { for (const x of sel) if (!s.combate.combatentes.some(c => c.atorId === x.atorId)) s.combate.combatentes.push({ atorId: x.atorId, acoes: 0, ptGastos: 0, criticosUsados: 0 }); });
    return;
  }
  if (!a) return;
  const r = a.system.recursos;
  if (act === 'ficha') openSheet(a.id);
  else if (act === 'dano') openDamageDialog(a.id);
  else if (act === 'alvo') { local.alvoId = local.alvoId === a.id ? null : a.id; notify(); }
  else if (act === 'res-' || act === 'res+') update(() => { r[b.dataset.res] = (Number(r[b.dataset.res]) || 0) + (act === 'res+' ? 1 : -1); });
  else if (act === 'cond-x') update(() => { delete a.system.condicoes[b.dataset.id]; });
  else if (act === 'cond+' || act === 'cond-') {
    const id = b.dataset.id, c = CONFIG.condicaoById[id], cur = a.system.condicoes[id] || 1;
    const next = cur + (act === 'cond+' ? 1 : -1);
    update(() => { if (next < 1) delete a.system.condicoes[id]; else a.system.condicoes[id] = Math.min(maxLevel(c), next); });
  }
}

function onChange(e) {
  const f = e.target.dataset.field, sel = getSelection();
  if (!f || !sel.length) return;
  if (f === 'tamanho' && e.target.value) {
    const n = Number(e.target.value), sc = scene();
    update(() => { for (const t of sel) { t.tamanho = n; t.x = Math.min(t.x, sc.colunas - n); t.y = Math.min(t.y, sc.linhas - n); } });
    return;
  }
  const a = getActor(sel[0].atorId);
  if (!a) return;
  if (f === 'res') update(() => { a.system.recursos[e.target.dataset.res] = Number(e.target.value) || 0; });
  if (f === 'nova-cond' && e.target.value) update(() => { a.system.condicoes[e.target.value] = 1; });
}
