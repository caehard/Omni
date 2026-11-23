// Painel lateral: lista de atores e rastreador de combate.
import { state, update, getActor, subscribe } from '../core/store.js';
import { createActor, prepareDerived } from '../system/actor.js';
import { processRoundStart, roundDurationSeconds, spendAction, actionCost } from '../system/combat.js';
import { esc } from './dom.js';
import { postSystem } from './chat.js';
import { addToken } from './board.js';

let actorsEl, combatEl, openSheet;

export function initSidebar({ actors, combat, onOpenSheet }) {
  actorsEl = actors; combatEl = combat; openSheet = onOpenSheet;
  actorsEl.addEventListener('click', onActorsClick);
  actorsEl.addEventListener('dragstart', e => {
    const li = e.target.closest('[data-id]');
    if (li) e.dataTransfer.setData('text/omni-ator', li.dataset.id);
  });
  combatEl.addEventListener('click', onCombatClick);
  subscribe(render);
  render();
}

export function newActor(tipo = 'personagem') {
  const a = createActor({ tipo, nome: tipo === 'npc' ? 'Novo NPC' : 'Novo Personagem' });
  update(s => s.atores.push(a));
  openSheet(a.id);
  return a;
}

function bar(cur, max, cls) {
  const p = max > 0 ? Math.max(0, Math.min(100, (cur / max) * 100)) : 0;
  return `<span class="bar ${cls}" title="${cur}/${max}"><i style="width:${p}%"></i></span>`;
}

function render() {
  // atores
  const groups = [['personagem', 'Personagens'], ['npc', 'NPCs']];
  actorsEl.innerHTML = groups.map(([t, n]) => {
    const list = state.atores.filter(a => a.tipo === t);
    return `<h3>${n} <button class="icon-btn" data-act="new" data-tipo="${t}" title="Criar">＋</button></h3>
      <ul class="actor-list">${list.map(a => {
        const d = prepareDerived(a), r = a.system.recursos;
        return `<li data-id="${a.id}" draggable="true" title="Arraste para o mapa · duplo clique abre a ficha">
          <span class="dot" style="background:${esc(a.cor)}"></span>
          <span class="name">${esc(a.nome)}<small>Nv ${d.nivel} · ${d.categoriaNome}</small></span>
          <span class="bars">${bar(r.vida, d.vidaMax, 'hp')}${bar(r.sanidade, d.sanidadeMax, 'san')}</span>
          <span class="actions">
            <button class="icon-btn" data-act="token" title="Colocar no mapa">⬚</button>
            <button class="icon-btn" data-act="combat" title="Adicionar ao combate">⚔</button>
            <button class="icon-btn" data-act="dup" title="Duplicar">⧉</button>
            <button class="icon-btn" data-act="del" title="Excluir">✕</button>
          </span></li>`;
      }).join('') || '<li class="muted">Nenhum.</li>'}</ul>`;
  }).join('');

  // combate
  const c = state.combate;
  if (!c.ativo) {
    combatEl.innerHTML = `<div class="combat-idle"><p class="muted">Sem combate ativo.</p>
      <button class="primary" data-act="start">Iniciar combate</button>
      <p class="hint">Adicione combatentes com ⚔ na lista acima.</p>
      ${c.combatentes.length ? `<p>${c.combatentes.length} combatente(s) prontos.</p>` : ''}</div>`;
    return;
  }
  combatEl.innerHTML = `<div class="combat-head"><strong>Rodada ${c.rodada}</strong>
      <small>${roundDurationSeconds(c.rodada)} s</small>
      <button data-act="next" class="primary">Próxima rodada ▶</button>
      <button data-act="end" title="Encerrar combate">Encerrar</button></div>
    <ul class="combatants">${c.combatentes.map((cb, i) => {
      const a = getActor(cb.atorId);
      if (!a) return '';
      const d = prepareDerived(a), r = a.system.recursos;
      const pt = d.pontosTempoMax, gasto = cb.ptGastos || 0, crit = cb.criticosUsados || 0;
      const cells = Array.from({ length: pt + d.pontosCriticosMax }, (_, k) =>
        `<i class="${k < gasto ? 'used' : ''} ${k >= pt ? 'crit' : ''}"></i>`).join('');
      const conds = Object.entries(a.system.condicoes).map(([k, v]) => `<span class="chip">${esc(k)}${v > 1 ? `(${v})` : ''}</span>`).join('');
      return `<li data-i="${i}" class="${r.portasDaMorte ? 'dying' : ''} ${r.morto ? 'dead' : ''}">
        <div class="cb-top"><button class="link" data-act="sheet">${esc(a.nome)}</button>
          <span class="muted">Vida ${r.vida}/${d.vidaMax} · Cans. ${r.cansaco}</span>
          <button class="icon-btn" data-act="remove" title="Remover do combate">✕</button></div>
        <div class="pt-track" title="Pontos de Tempo: ${gasto}/${pt} (+${d.pontosCriticosMax} críticos)">${cells}</div>
        <div class="cb-actions"><span>Ações: ${cb.acoes || 0} · próxima: <b>${actionCost(cb, a)}</b> PT</span>
          <button data-act="action" title="Registrar uma ação (custo base)">+ ação</button>
          <button data-act="action-x" title="Ação com pontos de tempo extras">+ ação…</button>
          <button data-act="free" title="Gastar pontos sem contar como ação">+ PT</button></div>
        ${conds ? `<div class="chips">${conds}</div>` : ''}${crit ? `<div class="warn">Usando ${crit} ponto(s) crítico(s)</div>` : ''}</li>`;
    }).join('')}</ul>`;
}

function onActorsClick(e) {
  const b = e.target.closest('button');
  const li = e.target.closest('[data-id]');
  if (!b) { if (li && e.detail === 2) openSheet(li.dataset.id); return; }
  const act = b.dataset.act;
  if (act === 'new') { newActor(b.dataset.tipo); return; }
  if (!li) return;
  const id = li.dataset.id;
  if (act === 'token') addToken(id);
  if (act === 'combat') update(s => { if (!s.combate.combatentes.some(c => c.atorId === id)) s.combate.combatentes.push({ atorId: id, acoes: 0, ptGastos: 0, criticosUsados: 0 }); });
  if (act === 'dup') { const a = structuredClone(getActor(id)); a.id = Math.random().toString(36).slice(2, 10); a.nome += ' (cópia)'; update(s => s.atores.push(a)); }
  if (act === 'del' && confirm(`Excluir “${getActor(id).nome}”?`)) update(s => {
    s.atores = s.atores.filter(a => a.id !== id);
    s.cena.tokens = s.cena.tokens.filter(t => t.atorId !== id);
    s.combate.combatentes = s.combate.combatentes.filter(c => c.atorId !== id);
  });
}

function onCombatClick(e) {
  const b = e.target.closest('button');
  if (!b) return;
  const act = b.dataset.act, c = state.combate;
  const li = b.closest('[data-i]'), cb = li ? c.combatentes[+li.dataset.i] : null, a = cb && getActor(cb.atorId);
  if (act === 'start') {
    if (!c.combatentes.length) for (const t of state.cena.tokens) if (!c.combatentes.some(x => x.atorId === t.atorId)) c.combatentes.push({ atorId: t.atorId, acoes: 0, ptGastos: 0, criticosUsados: 0 });
    update(s => { s.combate.ativo = true; s.combate.rodada = 1; s.combate.combatentes.forEach(x => Object.assign(x, { acoes: 0, ptGastos: 0, criticosUsados: 0 })); });
    postSystem('<b>Combate iniciado.</b> Rodada 1 (5 s).');
  }
  if (act === 'end') { update(s => { s.combate.ativo = false; s.combate.rodada = 0; s.atores.forEach(x => { x.system.combate.penalidadeCriticos = 0; }); }); postSystem('<b>Combate encerrado.</b>'); }
  if (act === 'next') nextRound();
  if (act === 'sheet') openSheet(cb.atorId);
  if (act === 'remove') update(s => s.combate.combatentes.splice(+li.dataset.i, 1));
  if (act === 'action' || act === 'action-x' || act === 'free') {
    let extra = 0;
    if (act !== 'action') { extra = Number(prompt(act === 'free' ? 'Pontos de tempo a gastar:' : 'Pontos de tempo extras da ação:', '1')); if (!Number.isFinite(extra)) return; }
    let res;
    update(() => { res = spendAction(cb, a, extra, { contaComoAcao: act !== 'free' }); });
    postSystem(res.ok ? `${esc(a.nome)}: ${res.msg}` : `${esc(a.nome)}: ${res.msg}`, { atorId: a.id });
  }
}

export function nextRound() {
  const out = [];
  update(s => {
    s.combate.rodada++;
    for (const cb of s.combate.combatentes) {
      const a = getActor(cb.atorId);
      if (!a) continue;
      const r = processRoundStart(cb, a);
      if (r.msgs.length) out.push(`<b>${esc(a.nome)}</b>: ${r.msgs.join(' ')}`);
    }
  });
  postSystem(`<b>Rodada ${state.combate.rodada}</b> (${roundDurationSeconds(state.combate.rodada)} s)${out.length ? '<br>' + out.join('<br>') : ''}`);
}
