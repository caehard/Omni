// Registro de mensagens e cartões de rolagem.
import { state, local, update, getActor, subscribe, isGM, ownsActor, playerName } from '../core/store.js';
import { addHeroicDie, applyVirtue, applyFlaw } from '../system/dice.js';
import { esc, html } from './dom.js';
import { uid } from '../system/actor.js';

let logEl;

export function initChat(container) {
  logEl = container;
  logEl.addEventListener('click', onClick);
  subscribe(render);
  render();
}

/**
 * Publica no chat. `para`: lista de ids de jogadores que podem ver (sussurro); [] = só o mestre.
 * O mestre sempre vê tudo; quem envia sempre vê a própria mensagem. O servidor filtra para os demais.
 */
export function post(msg) {
  update(s => {
    s.chat.push({ id: uid(), ts: Date.now(), de: local.jogadorId, ...msg });
    if (isGM() && s.chat.length > 300) s.chat.splice(0, s.chat.length - 300); // só o mestre apaga as antigas
  });
}

export const postText = (texto, extra = {}) => post({ tipo: 'texto', texto, ...extra });
export const postSystem = (htmlTxt, extra = {}) => post({ tipo: 'sistema', html: htmlTxt, ...extra });

// HTML de mensagens vem de outros jogadores: só formatação simples passa (nada de scripts, links, imagens ou atributos).
const TAGS_OK = new Set(['B', 'I', 'BR', 'DIV', 'SPAN', 'SMALL', 'CODE', 'S', 'EM', 'STRONG']);
export function sanitize(htmlTxt) {
  const tpl = document.createElement('template');
  tpl.innerHTML = String(htmlTxt ?? '');
  const walk = node => {
    for (const el of [...node.children]) {
      if (!TAGS_OK.has(el.tagName)) { el.replaceWith(document.createTextNode(el.textContent)); continue; }
      for (const at of [...el.attributes]) if (at.name !== 'class') el.removeAttribute(at.name);
      walk(el);
    }
  };
  walk(tpl.content);
  return tpl.innerHTML;
}

function privacyTag(m) {
  if (!m.para) return '';
  const nomes = m.para.map(playerName);
  return `<span class="privado" title="Mensagem privada">🔒 ${m.para.length ? 'para ' + esc(nomes.join(', ')) : 'só o mestre'}</span>`;
}

let lastLen = -1, lastSig = '';
function render() {
  if (!logEl) return;
  const sig = state.chat.map(m => m.id + (m.rev || 0)).join('|');
  if (sig === lastSig) return;
  const stick = logEl.scrollTop + logEl.clientHeight >= logEl.scrollHeight - 30 || lastLen < 0;
  lastSig = sig; lastLen = state.chat.length;
  logEl.replaceChildren(...state.chat.map(renderMessage));
  if (stick) logEl.scrollTop = logEl.scrollHeight;
}

function renderMessage(m) {
  const t = new Date(m.ts).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  const who = m.atorId ? getActor(m.atorId)?.nome : m.autor;
  const head = `<header><strong>${esc(who || 'Mestre')}</strong>${privacyTag(m)}<time>${t}</time></header>`;
  const priv = m.para ? ' msg-privada' : '';
  if (m.tipo === 'roll') return rollCard(m, head, priv);
  if (m.tipo === 'sistema') return html`<article class="msg msg-system${priv}">${head}<div>${sanitize(m.html)}</div></article>`;
  return html`<article class="msg${priv}">${head}<p>${esc(m.texto)}</p></article>`;
}

function rollCard(m, head, priv = '') {
  const r = m.roll;
  const dice = r.dice.map((d, i) => {
    const cls = ['die', d.crit ? 'crit' : '', d.success ? 'ok' : 'fail', d.reduced ? 'reduced' : '', d.source !== 'base' ? 'bonus' : '', d.virtude ? 'virtue' : '', d.falha ? 'flaw' : ''].join(' ');
    const tip = `d${d.faces}: ${d.natural}${d.reduced ? ` → ${d.value} (maestria)` : ''}${d.crit ? ' — crítico' : ''}${d.source !== 'base' ? ` (${d.source})` : ''}${d.virtude ? ' — virtude' : ''}${d.falha ? ' — falha' : ''}`;
    return `<span class="${cls}" title="${esc(tip)}" data-i="${i}">${d.reduced ? `<s>${d.natural}</s>` : ''}${d.value}</span>`;
  }).join('');
  const mods = [];
  if (r.maestria) mods.push(`Maestria ${r.maestria}`);
  if (r.vantagem) mods.push(`Vant. ${r.vantagem}`);
  if (r.desvantagem) mods.push(`Desv. ${r.desvantagem}`);
  let verdict = '';
  if (r.passed != null) verdict = `<div class="verdict ${r.passed ? 'pass' : 'fail'}">${r.passed ? 'SUCESSO' : 'FALHA'} <small>(${r.successes}/${r.ns}, margem ${r.margin >= 0 ? '+' : ''}${r.margin})</small></div>`;
  const actor = m.atorId && getActor(m.atorId);
  const mine = actor && ownsActor(actor);
  const heroAvail = mine && state.regras.pontosHeroicos !== false && r.crits > (r.heroicosGastos || 0) && (actor.system.recursos.heroicos || 0) > 0;
  const buttons = [];
  if (heroAvail) buttons.push(`<button data-act="heroico" data-id="${m.id}">★ Ponto Heroico (+1 dado)</button>`);
  if (mine && state.regras.virtudesEFalhas !== false && !r.virtudeUsada) buttons.push(`<button data-act="virtude" data-id="${m.id}" title="Transforma o pior dado em crítico">Virtude</button>`);
  if (isGM() && state.regras.virtudesEFalhas !== false && !r.falhaUsada) buttons.push(`<button data-act="falha" data-id="${m.id}" title="Mestre: transforma o melhor dado em falha">Falha</button>`);
  return html`<article class="msg msg-roll${priv}">${head}
    <div class="roll-title">${esc(m.titulo || 'Rolagem')}</div>
    <div class="roll-meta">${r.dice.filter(d => d.source === 'base').length}d${r.faces} · ND ${r.nd}${mods.length ? ' · ' + mods.join(' · ') : ''}${m.notas ? ' · ' + esc(m.notas) : ''}</div>
    <div class="dice">${dice}</div>
    <div class="roll-total"><span class="big">${r.successes}</span> sucesso(s)${r.crits ? ` · ${r.crits} crítico(s)` : ''}</div>
    ${verdict}
    ${effectLine(m)}
    ${m.extraHtml ? sanitize(m.extraHtml) : ''}
    ${buttons.length ? `<div class="roll-actions">${buttons.join('')}</div>` : ''}
  </article>`;
}

/** Linha de efeito calculada a partir dos sucessos (atualiza junto com Ponto Heroico/Virtude/Falha). */
function effectLine(m) {
  const r = m.roll;
  if (m.dano) {
    const { impacto = 1, brutal = 0, limite = 0, tipo = '', letal = 0 } = m.dano;
    let total = r.successes > 0 ? r.successes * impacto + brutal : 0;
    const capped = limite && total > limite;
    if (capped) total = limite;
    return `<div class="effect">Dano: ${r.successes} × ${impacto}${brutal ? ` + ${brutal}` : ''} = <b>${total}</b> ${esc(tipo)}${capped ? ' (limite da arma de fogo)' : ''}${letal ? ` · Letal(${letal})` : ''}</div>`;
  }
  if (m.bloqueio) {
    const v = r.successes * m.bloqueio;
    return `<div class="effect">Bloqueio: +<b>${v}</b> de absorção física contra este ataque</div>`;
  }
  return '';
}

function onClick(e) {
  const b = e.target.closest('button[data-act]');
  if (!b) return;
  const m = state.chat.find(x => x.id === b.dataset.id);
  if (!m) return;
  const actor = m.atorId && getActor(m.atorId);
  update(() => {
    if (b.dataset.act === 'heroico' && actor) {
      actor.system.recursos.heroicos = Math.max(0, (actor.system.recursos.heroicos || 0) - 1);
      m.roll = addHeroicDie(m.roll);
    } else if (b.dataset.act === 'virtude') m.roll = applyVirtue(m.roll);
    else if (b.dataset.act === 'falha') m.roll = applyFlaw(m.roll);
    m.rev = (m.rev || 0) + 1;
  });
}
