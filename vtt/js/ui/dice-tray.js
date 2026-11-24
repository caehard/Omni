// Dados animados: cada rolagem nova aparece sobre o mapa, rolando e parando nos valores sorteados.
// Os valores vêm do cartão do chat (a rolagem já aconteceu); a animação é só visual e local.
// Pode ser desligada no botão 🎲 do Registro (fica salvo neste navegador).
import { state, subscribe, getActor } from '../core/store.js';
import { esc } from './dom.js';

const KEY = 'omni-dados-animados';
let tray, seen = null, timer = null, enabled = true;

export function initDiceTray(container, toggleBtn) {
  try { enabled = localStorage.getItem(KEY) !== '0'; } catch { /* sem armazenamento */ }
  tray = document.createElement('div');
  tray.className = 'dice-tray';
  tray.hidden = true;
  tray.addEventListener('click', () => hide());
  container.append(tray);
  const paint = () => { toggleBtn.setAttribute('aria-pressed', enabled); toggleBtn.title = enabled ? 'Dados animados: ligados' : 'Dados animados: desligados'; };
  toggleBtn.addEventListener('click', () => {
    enabled = !enabled;
    try { localStorage.setItem(KEY, enabled ? '1' : '0'); } catch { /* sem armazenamento */ }
    paint();
  });
  paint();
  subscribe(onState);
  onState();
}

function onState() {
  const ids = state.chat.map(m => m.id);
  if (seen === null) { seen = new Set(ids); return; } // o que já estava no chat ao abrir não anima
  const novas = state.chat.filter(m => !seen.has(m.id));
  for (const id of ids) seen.add(id);
  const roll = novas.reverse().find(m => m.tipo === 'roll' && m.roll?.dice?.length);
  if (roll && enabled) show(roll);
}

function show(m) {
  const r = m.roll, dice = r.dice.slice(0, 24);
  const quem = (m.atorId && getActor(m.atorId)?.nome) || m.autor || '';
  tray.innerHTML = `<div class="dt-title">${esc(quem)}${quem ? ' · ' : ''}${esc(m.titulo || 'Rolagem')}</div>
    <div class="dt-dice">${dice.map((d, i) => `<span class="dt-die" style="--i:${i};--r:${Math.round(Math.random() * 720 - 360)}deg;--dx:${Math.round(Math.random() * 120 - 60)}px" data-i="${i}">${rand(d.faces)}</span>`).join('')}</div>
    <div class="dt-result" hidden><b>${r.successes}</b> sucesso(s)${r.crits ? ` · ${r.crits} crítico(s)` : ''}${r.passed != null ? ` — <span class="${r.passed ? 'ok' : 'falha'}">${r.passed ? 'SUCESSO' : 'FALHA'}</span>` : ''}</div>`;
  tray.hidden = false;
  tray.classList.remove('saindo');
  tray.classList.add('rolando');
  const els = [...tray.querySelectorAll('.dt-die')];
  clearInterval(timer); clearTimeout(show.t1); clearTimeout(show.t2);
  timer = setInterval(() => els.forEach((el, i) => { el.textContent = rand(dice[i].faces); }), 60);
  show.t1 = setTimeout(() => { // para nos valores reais
    clearInterval(timer);
    tray.classList.remove('rolando');
    els.forEach((el, i) => {
      const d = dice[i];
      el.textContent = d.value;
      el.classList.add(d.success ? 'ok' : 'fail');
      if (d.crit) el.classList.add('crit');
      el.title = `d${d.faces}: ${d.natural}${d.crit ? ' — crítico' : ''}`;
    });
    tray.querySelector('.dt-result').hidden = false;
    show.t2 = setTimeout(hide, 2600);
  }, 850);
}

function hide() {
  clearInterval(timer);
  tray.classList.add('saindo');
  setTimeout(() => { tray.hidden = true; tray.classList.remove('saindo'); }, 300);
}

const rand = f => 1 + Math.floor(Math.random() * (f || 6));
