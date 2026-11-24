// Painel lateral: lista de atores e rastreador de combate.
import { state, local, scene, update, getActor, subscribe, isGM, ownsActor, playerName } from '../core/store.js';
import { createActor, prepareDerived } from '../system/actor.js';
import { processRoundStart, roundDurationSeconds, spendAction, actionCost } from '../system/combat.js';
import { esc, makeWindow } from './dom.js';
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
  if (!isGM()) tipo = 'personagem'; // jogador cria o próprio personagem (e vira dono dele)
  const a = createActor({ tipo, nome: tipo === 'npc' ? 'Novo NPC' : 'Novo Personagem' });
  if (!isGM()) a.donos = [local.jogadorId];
  update(s => s.atores.push(a));
  openSheet(a.id);
  return a;
}

/** Mestre: quem controla a ficha, quem pode vê-la e se ela está oculta. */
export function openPermissionsDialog(actorId) {
  const a = getActor(actorId);
  if (!a || !isGM()) return;
  const w = makeWindow('perm-' + actorId, `Permissões — ${a.nome}`, { width: 360 });
  const jogs = Object.entries(state.jogadores || {});
  const acesso = a.permissao || (a.tipo === 'npc' ? 'nenhum' : 'ver');
  w.body.innerHTML = `<form class="perm-form">
    <fieldset><legend>Donos (controlam a ficha e o token)</legend>
      ${jogs.length ? jogs.map(([id, j]) => `<label><input type="checkbox" name="dono" value="${esc(id)}" ${(a.donos || []).includes(id) ? 'checked' : ''}> ${esc(j.nome)}</label>`).join('')
        : '<p class="hint">Nenhum jogador entrou nesta mesa ainda. Eles aparecem aqui depois de abrir o link.</p>'}
    </fieldset>
    <label>Os demais jogadores <select name="permissao">
      <option value="ver" ${acesso === 'ver' ? 'selected' : ''}>podem ver a ficha</option>
      <option value="nenhum" ${acesso === 'nenhum' ? 'selected' : ''}>não veem a ficha (só o token)</option></select></label>
    <label><input type="checkbox" name="oculto" ${a.oculto ? 'checked' : ''}> Oculto: jogadores não veem nem a ficha nem os tokens</label>
    <div class="row"><button class="primary">Salvar</button></div></form>`;
  w.body.querySelector('form').addEventListener('submit', e => {
    e.preventDefault();
    const f = e.target;
    update(() => {
      a.donos = [...f.querySelectorAll('[name=dono]:checked')].map(x => x.value);
      a.permissao = f.permissao.value;
      if (f.oculto.checked) a.oculto = true; else delete a.oculto;
    });
    w.close();
  });
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
    const podeCriar = isGM() || t === 'personagem';
    return `<h3>${n} ${podeCriar ? `<button class="icon-btn" data-act="new" data-tipo="${t}" title="Criar">＋</button>` : ''}</h3>
      <ul class="actor-list">${list.map(a => {
        const d = prepareDerived(a), r = a.system.recursos, meu = ownsActor(a);
        const donos = (a.donos || []).map(playerName).join(', ');
        return `<li data-id="${a.id}" draggable="${meu}" class="${a.oculto ? 'oculto' : ''} ${meu ? '' : 'alheio'}" title="${meu ? 'Arraste para o mapa · ' : ''}duplo clique abre a ficha">
          <span class="dot" style="background:${esc(a.cor)}"></span>
          <span class="name">${esc(a.nome)}<small>Nv ${d.nivel} · ${d.categoriaNome}${a.oculto ? ' · <b>oculto</b>' : ''}${isGM() && donos ? ` · ${esc(donos)}` : ''}</small></span>
          <span class="bars">${meu || a.tipo !== 'npc' ? bar(r.vida, d.vidaMax, 'hp') + bar(r.sanidade, d.sanidadeMax, 'san') : ''}</span>
          <span class="actions">${meu ? `
            <button class="icon-btn" data-act="token" title="Colocar no mapa">⬚</button>
            <button class="icon-btn" data-act="combat" title="Adicionar ao combate">⚔</button>
            <button class="icon-btn" data-act="dup" title="Duplicar">⧉</button>
            ${isGM() ? `<button class="icon-btn" data-act="perm" title="Permissões: dar a ficha a um jogador, ocultar">🔑</button>` : ''}
            <button class="icon-btn" data-act="del" title="Excluir">✕</button>` : ''}
          </span></li>`;
      }).join('') || '<li class="muted">Nenhum.</li>'}</ul>`;
  }).join('');

  // combate
  const c = state.combate;
  if (!c.ativo) {
    combatEl.innerHTML = `<div class="combat-idle"><p class="muted">Sem combate ativo.</p>
      ${isGM() ? '<button class="primary" data-act="start">Iniciar combate</button>' : '<p class="hint">O mestre inicia o combate.</p>'}
      <p class="hint">Adicione combatentes com ⚔ na lista de fichas.</p>
      ${c.combatentes.length ? `<p>${c.combatentes.length} combatente(s) prontos.</p>` : ''}</div>`;
    return;
  }
  combatEl.innerHTML = `<div class="combat-head"><strong>Rodada ${c.rodada}</strong>
      <small>${roundDurationSeconds(c.rodada)} s</small>
      ${isGM() ? `<button data-act="next" class="primary">Próxima rodada ▶</button>
      <button data-act="end" title="Encerrar combate">Encerrar</button>` : ''}</div>
    <ul class="combatants">${c.combatentes.map((cb, i) => {
      const a = getActor(cb.atorId);
      if (!a) return '';
      const d = prepareDerived(a), r = a.system.recursos;
      const pt = d.pontosTempoMax, gasto = cb.ptGastos || 0, crit = cb.criticosUsados || 0;
      const cells = Array.from({ length: pt + d.pontosCriticosMax }, (_, k) =>
        `<i class="${k < gasto ? 'used' : ''} ${k >= pt ? 'crit' : ''}"></i>`).join('');
      const conds = Object.entries(a.system.condicoes).map(([k, v]) => `<span class="chip">${esc(k)}${v > 1 ? `(${v})` : ''}</span>`).join('');
      const meu = ownsActor(a);
      return `<li data-i="${i}" class="${r.portasDaMorte ? 'dying' : ''} ${r.morto ? 'dead' : ''}">
        <div class="cb-top"><button class="link" data-act="sheet">${esc(a.nome)}</button>
          <span class="muted">${meu || a.tipo !== 'npc' ? `Vida ${r.vida}/${d.vidaMax} · ` : ''}Cans. ${r.cansaco}</span>
          ${isGM() ? '<button class="icon-btn" data-act="remove" title="Remover do combate">✕</button>' : ''}</div>
        <div class="pt-track" title="Pontos de Tempo: ${gasto}/${pt} (+${d.pontosCriticosMax} críticos)">${cells}</div>
        <div class="cb-actions"><span>Ações: ${cb.acoes || 0} · próxima: <b>${actionCost(cb, a)}</b> PT</span>
          ${meu ? `<button data-act="action" title="Registrar uma ação (custo base)">+ ação</button>
          <button data-act="action-x" title="Ação com pontos de tempo extras">+ ação…</button>
          <button data-act="free" title="Gastar pontos sem contar como ação">+ PT</button>` : ''}</div>
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
  if (!ownsActor(getActor(id))) return;
  if (act === 'perm') openPermissionsDialog(id);
  if (act === 'token') addToken(id);
  if (act === 'combat') update(s => { if (!s.combate.combatentes.some(c => c.atorId === id)) s.combate.combatentes.push({ atorId: id, acoes: 0, ptGastos: 0, criticosUsados: 0 }); });
  if (act === 'dup') { const a = structuredClone(getActor(id)); a.id = Math.random().toString(36).slice(2, 10); a.nome += ' (cópia)'; update(s => s.atores.push(a)); }
  if (act === 'del' && confirm(`Excluir “${getActor(id).nome}”?`)) update(s => {
    s.atores = s.atores.filter(a => a.id !== id);
    for (const c of s.cenas) c.tokens = c.tokens.filter(t => t.atorId !== id);
    s.combate.combatentes = s.combate.combatentes.filter(c => c.atorId !== id);
  });
}

function onCombatClick(e) {
  const b = e.target.closest('button');
  if (!b) return;
  const act = b.dataset.act, c = state.combate;
  const li = b.closest('[data-i]'), cb = li ? c.combatentes[+li.dataset.i] : null, a = cb && getActor(cb.atorId);
  if (['start', 'end', 'next', 'remove'].includes(act) && !isGM()) return;
  if (['action', 'action-x', 'free'].includes(act) && !ownsActor(a)) return;
  if (act === 'start') {
    if (!c.combatentes.length) for (const t of scene().tokens) if (!c.combatentes.some(x => x.atorId === t.atorId)) c.combatentes.push({ atorId: t.atorId, acoes: 0, ptGastos: 0, criticosUsados: 0 });
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
