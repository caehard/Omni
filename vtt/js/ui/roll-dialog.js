// Diálogo de rolagem: Teste ou Disputa de um atributo, com aptidão, ND, NS e modificadores.
import { CONFIG } from '../system/config.js';
import { rollBase, autoPenalties, aptidaoLabel, prepareDerived, ATTRS } from '../system/actor.js';
import { rollPool } from '../system/dice.js';
import { state, getActor, isGM } from '../core/store.js';
import { makeWindow, esc } from './dom.js';
import { post } from './chat.js';

/**
 * @param {string} actorId
 * @param {object} preset { attr, aptIndex, nd, ns, titulo, aptExigida, manuseio, dano, bloqueio, tempoExtra, vantagem, desvantagem }
 */
export function openRollDialog(actorId, preset = {}) {
  const actor = getActor(actorId);
  if (!actor) return;
  const s = actor.system;
  const d = prepareDerived(actor);
  const cat = CONFIG.sistema.categorias.find(c => c.id === d.categoria);
  const w = makeWindow('roll-' + actorId, `Rolagem — ${actor.nome}`, { width: 380, className: 'roll-window' });
  w.body.innerHTML = '';

  const attrOpts = ATTRS.map(k => {
    const a = CONFIG.sistema.atributos[k];
    const dn = CONFIG.sistema.dominios.find(x => x.id === a.dominio).nome;
    return `<option value="${k}" ${k === (preset.attr || 'forca') ? 'selected' : ''}>${a.nome} (${dn})</option>`;
  }).join('');
  const aptOpts = ['<option value="">— nenhuma —</option>', ...s.aptidoes.map((ap, i) =>
    `<option value="${i}" ${String(preset.aptIndex) === String(i) ? 'selected' : ''}>${esc(aptidaoLabel(ap))} · ${ap.nivel}</option>`)].join('');

  w.body.innerHTML = `
  <form class="roll-form">
    <label class="full">Título <input name="titulo" value="${esc(preset.titulo || '')}" placeholder="ex.: Escalar o penhasco"></label>
    <div class="seg full" role="radiogroup" aria-label="Tipo de rolagem">
      <label><input type="radio" name="tipo" value="teste" ${preset.tipo !== 'disputa' ? 'checked' : ''}> Teste</label>
      <label><input type="radio" name="tipo" value="disputa" ${preset.tipo === 'disputa' ? 'checked' : ''}> Disputa</label>
    </div>
    <label class="full">Atributo <select name="attr">${attrOpts}</select></label>
    <label class="full">Aptidão <select name="apt">${aptOpts}</select></label>
    <label><input type="checkbox" name="parcial"> Aptidão parcial (½)</label>
    <label>Aptidão exigida <input type="number" name="aptExigida" min="0" max="5" value="${preset.aptExigida ?? 0}"></label>
    <label>ND <input type="number" name="nd" min="1" value="${preset.nd ?? cat.ndMedio}"></label>
    <label class="ns-field">NS <input type="number" name="ns" min="0" value="${preset.ns ?? cat.ns}"></label>
    <label>Maestria extra <input type="number" name="maestriaExtra" value="${preset.manuseio ?? 0}" title="Manuseio do equipamento, habilidades..."></label>
    <label>Vantagem <input type="number" name="vantagem" min="0" value="${preset.vantagem ?? 0}"></label>
    <label>Desvantagem <input type="number" name="desvantagem" min="0" value="${preset.desvantagem ?? 0}"></label>
    <label>Dados extras <input name="extra" placeholder="ex.: 2 ou 2d4" title="Só o número = dado do domínio" value="${esc(preset.extra || '')}"></label>
    <p class="preview full" aria-live="polite"></p>
    <div class="row full"><label>Quem vê <select name="visivel">
        <option value="todos">Todos</option>
        <option value="mestre" ${preset.oculta || actor.oculto ? 'selected' : ''}>Só o mestre${isGM() ? ' (rolagem secreta)' : ' (e eu)'}</option></select></label>
      <button type="submit" class="primary">Rolar</button></div>
  </form>`;

  const f = w.body.querySelector('form');
  const calc = () => {
    const attr = f.attr.value;
    const base = rollBase(actor, attr);
    const apIdx = f.apt.value;
    const ap = apIdx !== '' ? s.aptidoes[apIdx] : null;
    let aptLvl = ap ? Number(ap.nivel) || 0 : 0;
    if (f.parcial.checked) aptLvl = Math.floor(aptLvl / 2);
    const exig = Number(f.aptExigida.value) || 0;
    const auto = autoPenalties(actor, base.dom);
    const desvAptidao = Math.max(0, exig - aptLvl);
    // Manuseio só se aplica com a aptidão mínima
    const manuseio = desvAptidao > 0 ? 0 : Number(f.maestriaExtra.value) || 0;
    const extra = parseExtra(f.extra.value, base.faces);
    const tipo = f.querySelector('[name=tipo]:checked').value;
    return {
      base, ap, aptLvl, exig, desvAptidao, auto, tipo, extra,
      maestria: aptLvl + manuseio,
      vantagem: Number(f.vantagem.value) || 0,
      desvantagem: (Number(f.desvantagem.value) || 0) + desvAptidao + auto.desvantagem,
      nd: Math.max(1, Number(f.nd.value) || 1),
      ns: tipo === 'teste' ? Number(f.ns.value) || 0 : null,
    };
  };
  const preview = () => {
    const c = calc();
    f.querySelector('.ns-field').style.visibility = c.tipo === 'teste' ? 'visible' : 'hidden';
    const parts = [`<b>${c.base.count}d${c.base.faces}</b>`, `ND ${c.nd}`];
    if (c.ns != null) parts.push(`NS ${c.ns}`);
    if (c.extra.length) parts.push('Extra ' + c.extra.map(e => `${e.count}d${e.faces}`).join(' + '));
    if (c.maestria) parts.push(`Maestria ${c.maestria}`);
    if (c.vantagem) parts.push(`Vant. ${c.vantagem}`);
    if (c.desvantagem) parts.push(`Desv. ${c.desvantagem}`);
    let extra = '';
    if (c.desvAptidao) extra += `<br>Aptidão abaixo da exigida: Desvantagem(${c.desvAptidao}) e sem Manuseio.`;
    if (c.auto.motivos.length) extra += `<br>Automático: ${c.auto.motivos.join(', ')}.`;
    f.querySelector('.preview').innerHTML = parts.join(' · ') + extra;
  };
  f.addEventListener('input', preview);
  preview();

  f.addEventListener('submit', e => {
    e.preventDefault();
    const c = calc();
    const roll = rollPool({ count: c.base.count, faces: c.base.faces, nd: c.nd, ns: c.ns, maestria: c.maestria,
      vantagem: c.vantagem, desvantagem: c.desvantagem, extra: c.extra, criticoExplosivo: !!state.regras.criticoExplosivo });
    const attrNome = CONFIG.sistema.atributos[c.base.attr].nome;
    const domNome = CONFIG.sistema.dominios.find(x => x.id === c.base.dom).nome;
    const tituloBase = `${attrNome} (${domNome})${c.ap ? ' + ' + aptidaoLabel(c.ap) : ''} — ${c.tipo === 'teste' ? 'Teste' : 'Disputa'}`;
    post({ tipo: 'roll', atorId: actor.id, roll,
      titulo: f.titulo.value ? `${f.titulo.value} · ${tituloBase}` : tituloBase,
      notas: c.auto.motivos.length ? 'auto: ' + c.auto.motivos.join(', ') : '',
      dano: preset.dano, bloqueio: preset.bloqueio, ...(f.visivel.value === 'mestre' && { para: [] }) });
    preset.onRolled?.(roll);
    w.close();
  });
}

/**
 * Palavra-chave Extra: "2d4 + 1d6" -> [{count:2,faces:4},{count:1,faces:6}].
 * Sem tipo de dado ("2"), usa o dado do domínio da rolagem (defaultFaces).
 */
export function parseExtra(txt, defaultFaces = 10) {
  return String(txt || '').split(/[+,;]/).map(p => p.trim()).filter(Boolean).map(p => {
    const m = p.match(/^(\d+)\s*(?:d\s*(\d+))?$/i);
    return m ? { count: +m[1], faces: m[2] ? +m[2] : defaultFaces } : null;
  }).filter(Boolean);
}
