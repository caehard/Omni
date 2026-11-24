// Ficha de personagem interativa (mesmo layout da ficha imprimível em docs/ficha).
import { CONFIG } from '../system/config.js';
import { prepareDerived, aptidaoLabel } from '../system/actor.js';
import { applyDamage, heal, loseSanity, deathRoll, spendAction, rest } from '../system/combat.js';
import { blockDistance, zoneForBlocks } from './board.js';
import { rollFormula } from '../system/dice.js';
import { state, local, scene, update, getActor, subscribe } from '../core/store.js';
import { makeWindow, esc, getPath, setPath, toast, closeWindow, readFile, pickFile } from './dom.js';
import { openRollDialog } from './roll-dialog.js';
import { post, postSystem } from './chat.js';

const sheets = new Map(); // actorId -> { w, tab, sig, unsub }

export function openSheet(actorId) {
  const actor = getActor(actorId);
  if (!actor) return;
  if (sheets.has(actorId)) { makeWindow('sheet-' + actorId, ''); return; }
  const w = makeWindow('sheet-' + actorId, actor.nome, {
    width: 980, className: 'sheet-window',
    onClose: () => { sheets.get(actorId)?.unsub(); sheets.delete(actorId); },
  });
  const ctx = { w, tab: 'principal', sig: '' };
  ctx.unsub = subscribe(() => refresh(actorId));
  sheets.set(actorId, ctx);
  w.body.addEventListener('change', e => onChange(actorId, e));
  w.body.addEventListener('click', e => onClick(actorId, e));
  render(actorId);
}

function structureSig(a) {
  const s = a.system;
  return [s.aptidoes.length, s.virtudes.length, s.falhas.length, s.habilidades.length, s.poderes.length,
    s.inventario.length, s.armas.length, (s.armaduras || []).length, Object.keys(s.condicoes).sort().join(','), Object.keys(s.absorcao).join(','),
    a.tipo, a.imagem.length, s.recursos.portasDaMorte, s.recursos.morto].join('|');
}

function refresh(actorId) {
  const ctx = sheets.get(actorId), actor = getActor(actorId);
  if (!ctx) return;
  if (!actor) { closeWindow('sheet-' + actorId); return; }
  if (structureSig(actor) !== ctx.sig) { render(actorId); return; }
  // atualização leve: valores calculados e campos não focados
  const d = prepareDerived(actor);
  ctx.w.setTitle(actor.nome);
  ctx.w.body.querySelectorAll('[data-calc]').forEach(el => { el.textContent = calcValue(d, el.dataset.calc); });
  ctx.w.body.querySelectorAll('[data-path]').forEach(el => {
    if (el === document.activeElement) return;
    const v = getPath(actor, el.dataset.path);
    if (el.type === 'checkbox') el.checked = !!v; else if (el.value !== String(v ?? '')) el.value = v ?? '';
  });
  renderWarnings(ctx.w.body, d);
}

function calcValue(d, key) {
  if (key.startsWith('dado.')) return 'd' + d.dados[key.slice(5)];
  return d[key] ?? '';
}

function render(actorId) {
  const ctx = sheets.get(actorId), actor = getActor(actorId);
  const scroll = ctx.w.body.querySelector('.sheet-page')?.scrollTop || 0;
  ctx.sig = structureSig(actor);
  const d = prepareDerived(actor);
  ctx.w.setTitle(actor.nome);
  ctx.w.body.innerHTML = `
    <nav class="tabs" role="tablist">
      ${[['principal', 'Principal'], ['habilidades', 'Habilidades e Poderes'], ['inventario', 'Inventário e Notas']].map(([id, n]) =>
        `<button role="tab" data-tab="${id}" aria-selected="${ctx.tab === id}">${n}</button>`).join('')}
      <span class="spacer"></span>
      <button data-act="rolar" class="primary">🎲 Rolar</button>
      <button data-act="dano">Dano / Cura</button>
      <button data-act="descanso">Descanso</button>
    </nav>
    <div class="warnings"></div>
    <div class="sheet-page">${ctx.tab === 'principal' ? pagePrincipal(actor, d) : ctx.tab === 'habilidades' ? pageHabilidades(actor, d) : pageInventario(actor, d)}</div>`;
  ctx.w.body.querySelector('.sheet-page').scrollTop = scroll;
  renderWarnings(ctx.w.body, d);
}

function renderWarnings(body, d) {
  const el = body.querySelector('.warnings');
  el.innerHTML = d.avisos.map(a => `<div>⚠ ${esc(a)}</div>`).join('');
}

// ---------- campos ----------
const inp = (path, val, { type = 'text', cls = '', min, max, ph = '', title = '' } = {}) =>
  `<input class="${cls}" data-path="${path}" ${type === 'number' ? 'data-num' : ''} type="${type}" value="${esc(val ?? '')}" ${min != null ? `min="${min}"` : ''} ${max != null ? `max="${max}"` : ''} placeholder="${esc(ph)}" title="${esc(title)}" aria-label="${esc(title || ph || path)}">`;
const calc = (key, d) => `<output data-calc="${key}">${esc(calcValue(d, key))}</output>`;

function pagePrincipal(a, d) {
  const s = a.system;
  const domBlocks = CONFIG.sistema.dominios.map(dom => {
    const [a1, a2] = dom.atributos;
    const A = CONFIG.sistema.atributos;
    return `<div class="dom-block">
      <div class="dom-label">${dom.nome}</div>
      <div class="dom-tri">
        <svg viewBox="0 0 120 104" aria-hidden="true"><polygon points="60,20 22,84 98,84" /></svg>
        <div class="circle big">${inp(`system.dominios.${dom.id}`, s.dominios[dom.id], { type: 'number', min: -1, max: 6, title: dom.nome })}<small>${calc('dado.' + dom.id, d)}</small></div>
        <div class="circle left">${inp(`system.atributos.${a1}`, s.atributos[a1], { type: 'number', min: 0, max: 9, title: A[a1].nome })}</div>
        <div class="circle right">${inp(`system.atributos.${a2}`, s.atributos[a2], { type: 'number', min: 0, max: 9, title: A[a2].nome })}</div>
        <button class="attr-name left" data-act="roll-attr" data-attr="${a1}" title="Rolar ${A[a1].nome}">${A[a1].nome}</button>
        <button class="attr-name right" data-act="roll-attr" data-attr="${a2}" title="Rolar ${A[a2].nome}">${A[a2].nome}</button>
      </div></div>`;
  }).join('');

  const listVF = (key, titulo, icon) => `<div class="vf-col"><h4>${titulo}</h4>${s[key].map((v, i) => `
      <div class="vf-row">${inp(`system.${key}.${i}.nome`, v.nome, { ph: titulo.slice(0, -1) })}
      <label class="use" title="Usada neste arco">${icon}<input type="checkbox" data-path="system.${key}.${i}.usada" ${v.usada ? 'checked' : ''}></label>
      <button class="icon-btn" data-act="del" data-list="${key}" data-i="${i}" title="Remover">✕</button></div>`).join('')}
      ${s[key].length < 3 ? `<button class="add" data-act="add" data-list="${key}">+ adicionar</button>` : ''}</div>`;

  const aptOptions = CONFIG.aptidoes.aptidoes.map(ap => `<option value="${ap.id}">${ap.nome}</option>`).join('');
  const apts = s.aptidoes.map((ap, i) => `<tr>
      <td><button class="link" data-act="roll-apt" data-i="${i}" title="Rolar com esta aptidão">${esc(CONFIG.aptidaoById[ap.id]?.nome || ap.id)}</button>
        ${CONFIG.aptidaoById[ap.id]?.especializavel || ap.nativo ? inp(`system.aptidoes.${i}.especializacao`, ap.especializacao, { ph: 'especialização', cls: 'mini' }) : ''}</td>
      <td>${inp(`system.aptidoes.${i}.nivel`, ap.nivel, { type: 'number', min: 0, max: 5, cls: 'num', title: 'Nível' })}</td>
      <td>${ap.nativo ? '<span class="tag">nativo</span>' : `<button class="icon-btn" data-act="del" data-list="aptidoes" data-i="${i}" title="Remover">✕</button>`}</td></tr>`).join('');

  const conds = Object.entries(s.condicoes).map(([id, lvl]) => {
    const c = CONFIG.condicaoById[id];
    return `<div class="cond-row" title="${esc(c?.descricao || '')}"><span>${esc(c?.nome || id)}</span>
      ${c && c.maxNivel ? inp(`system.condicoes.${id}`, lvl, { type: 'number', min: 0, max: c.maxNivel === 99 ? 99 : c.maxNivel, cls: 'num' }) : ''}
      <button class="icon-btn" data-act="del-cond" data-id="${id}" title="Remover">✕</button></div>`;
  }).join('');
  const condOptions = CONFIG.condicoes.condicoes.filter(c => !(c.id in s.condicoes)).map(c => `<option value="${c.id}">${c.nome}</option>`).join('');

  const absKeys = Object.keys(s.absorcao);
  const absTypes = Object.values(CONFIG.tipoDano).filter(t => !absKeys.includes(t.id));
  const absRows = absKeys.map(k => {
    const nome = { geral: 'Geral', fisico: 'Física', elemental: 'Elemental' }[k] || CONFIG.tipoDano[k]?.nome || k;
    const fixed = ['geral', 'fisico', 'elemental'].includes(k);
    return `<div class="abs-row"><span>${nome}</span>${inp(`system.absorcao.${k}`, s.absorcao[k], { type: 'number', cls: 'num' })}${fixed ? '' : `<button class="icon-btn" data-act="del-abs" data-id="${k}">✕</button>`}</div>`;
  }).join('');

  const r = s.recursos;
  return `
  <div class="sheet-grid">
    <section class="box personal">
      <label>Nome ${inp('nome', a.nome)}</label>
      <label>Altura ${inp('system.dados.altura', s.dados.altura)}</label>
      <label>Peso ${inp('system.dados.peso', s.dados.peso)}</label>
      <label>Família ${inp('system.dados.familia', s.dados.familia)}</label>
      <label>Idade ${inp('system.dados.idade', s.dados.idade)}</label>
      <label>Dinheiro ${inp('system.dados.dinheiro', s.dados.dinheiro)}</label>
      <label>Tipo <select data-path="tipo"><option value="personagem" ${a.tipo === 'personagem' ? 'selected' : ''}>Personagem</option><option value="npc" ${a.tipo === 'npc' ? 'selected' : ''}>NPC</option></select></label>
      <label>Cor do token <input type="color" data-path="cor" value="${esc(a.cor)}"></label>
      <div class="portrait">${a.imagem ? `<img src="${a.imagem}" alt="">` : ''}<button data-act="imagem">Imagem…</button></div>
    </section>
    <section class="box progress">
      <h3>Pontos de Progressão</h3>
      <div class="pp-grid">
        <label>Inicial ${inp('system.progressao.inicial', s.progressao.inicial, { type: 'number', min: 0, cls: 'num' })}</label>
        <label>Ganhos ${inp('system.progressao.ganhos', s.progressao.ganhos, { type: 'number', min: 0, cls: 'num' })}</label>
        <div><span>Gastos</span>${calc('pontosGastos', d)}</div>
        <div><span>Reserva</span>${calc('pontosReserva', d)}</div>
        <div class="pill"><span>Nível</span>${calc('nivel', d)}</div>
        <div class="pill wide"><span>Categoria</span>${calc('categoriaNome', d)}</div>
      </div>
    </section>

    <section class="domains">${domBlocks}</section>

    <section class="middle">
      <div class="box vf">${listVF('virtudes', 'Virtudes', '⇧')}${listVF('falhas', 'Falhas', '⇩')}</div>
      <div class="box apts">
        <table><thead><tr><th>Aptidões</th><th>Nvl</th><th></th></tr></thead><tbody>${apts}</tbody></table>
        <div class="add-row"><select data-new="apt">${aptOptions}</select><button data-act="add-apt">+ aptidão</button></div>
        <label class="native">Língua nativa ${inp('system.dados.idiomaNativo', s.dados.idiomaNativo, { ph: 'ex.: Português' })}</label>
      </div>
      <div class="box conds">
        <h4>Recursos e Condições</h4>${conds || '<p class="muted">Nenhuma condição.</p>'}
        <div class="add-row"><select data-new="cond">${condOptions}</select><button data-act="add-cond">+ condição</button></div>
      </div>
      <div class="box special">
        <div><h4>Pontos de Conjuração</h4><div class="pair">${inp('system.recursos.conjuracao', r.conjuracao, { type: 'number', cls: 'num' })}<span>/</span>${calc('conjuracaoMax', d)}</div></div>
        <div><h4>Pontos Especiais</h4><div class="pair">${inp('system.recursos.pontosEspeciais', r.pontosEspeciais, { type: 'number', cls: 'num' })}<span>/</span>${calc('pontosEspeciaisMax', d)}</div></div>
      </div>
    </section>

    <section class="box combat-stats">
      <h3>Estatísticas de Combate</h3>
      <div class="two">
        <div class="stat"><h4>Sanidade</h4><div class="big-pair">${inp('system.recursos.sanidade', r.sanidade, { type: 'number', cls: 'num big' })}<span>/</span>${calc('sanidadeMax', d)}</div>
          <div class="sub"><span>50%: ${calc('metadeSanidade', d)}</span>
          <label>Determinação <select data-path="system.determinacao"><option value="raciocinio" ${s.determinacao !== 'instinto' ? 'selected' : ''}>Raciocínio</option><option value="instinto" ${s.determinacao === 'instinto' ? 'selected' : ''}>Instinto</option></select></label></div></div>
        <div class="stat"><h4>Vida</h4><div class="big-pair">${inp('system.recursos.vida', r.vida, { type: 'number', cls: 'num big' })}<span>/</span>${calc('vidaMax', d)}</div>
          <div class="sub"><span>50%: ${calc('metadeVida', d)}</span></div></div>
      </div>
      <div class="stat death ${r.portasDaMorte ? 'active' : ''}"><h4>Morte ${r.morto ? '☠️' : r.portasDaMorte ? '— nas portas da morte' : ''}</h4>
        <div class="three"><label>Grau ${inp('system.recursos.grauMorte', r.grauMorte, { type: 'number', cls: 'num' })}</label>
        <label>Sucessos ${inp('system.recursos.sucessosMorte', r.sucessosMorte, { type: 'number', cls: 'num' })}</label>
        <button data-act="death-roll" ${r.portasDaMorte && !r.morto ? '' : 'disabled'}>Rolagem de morte</button></div></div>
      <div class="two">
        <div class="hex"><h4>Evasão</h4>${calc('evasao', d)}</div>
        <div class="stat"><h4>Pontos de Tempo</h4><div class="big-pair">${calc('pontosTempoMax', d)}</div><div class="sub">base ${calc('pontosTempoBase', d)} · críticos ${calc('pontosCriticosMax', d)}</div></div>
      </div>
      <div class="two">
        <label class="stat"><h4>Cansaço</h4>${inp('system.recursos.cansaco', r.cansaco, { type: 'number', min: 0, max: 6, cls: 'num big' })}</label>
        <div class="stat"><h4>Pontos Heroicos</h4><div class="big-pair">${inp('system.recursos.heroicos', r.heroicos, { type: 'number', min: 0, cls: 'num big' })}<span>/</span>${calc('heroicosMax', d)}</div></div>
      </div>
      <div class="stat"><h4>Resistência e Absorção</h4>
        <div class="two small"><div>Resist. Geral <b>${calc('resistenciaGeral', d)}</b></div><div>Resist. Mental <b>${calc('resistenciaMental', d)}</b></div></div>
        ${absRows}
        <div class="add-row"><select data-new="abs">${absTypes.map(t => `<option value="${t.id}">${t.nome}</option>`).join('')}</select><button data-act="add-abs">+ absorção</button></div>
      </div>
      <div class="move"><h4>Movimento</h4><span class="tag-hex">Longe</span><small>demais: Distante · PT+ ${calc('movimentoPT', d)} · Imob. ${calc('imobilidade', d)}</small></div>
      <button data-act="dodge" title="Disputa de Destreza; ND = sua Evasão; Desvantagem = Imobilidade">Esquiva</button>
    </section>
  </div>`;
}

const HAB_CATS = [['defeito', 'Defeitos'], ['fator', 'Fatores Hereditários'], [1, 'Básico'], [2, 'Intermediário'], [3, 'Avançado'], [4, 'Lendário']];

function pageHabilidades(a, d) {
  const s = a.system;
  const byCat = Object.fromEntries(HAB_CATS.map(([k]) => [k, []]));
  s.habilidades.forEach((h, i) => {
    const def = CONFIG.habilidadeById[h.ref];
    const k = def?.pacote === 'defeito' ? 'defeito' : def?.pacote === 'fator' ? 'fator' : Math.min(4, Math.max(1, Number(h.nivel) || 1));
    byCat[k].push({ h, i, def });
  });
  const habRow = ({ h, i, def }) => {
    const nome = def?.nome || h.nomeLivre || '(sem nome)';
    let ctrl = '';
    if (def?.pacote === 'defeito') ctrl = `<select data-path="system.habilidades.${i}.grau">${(def.graus || []).map(g => `<option ${h.grau === g ? 'selected' : ''}>${g}</option>`).join('')}</select>`;
    else if (def?.pacote !== 'fator') ctrl = `<label class="mini">nv ${inp(`system.habilidades.${i}.nivel`, h.nivel, { type: 'number', min: def?.nivelMinimo || 1, max: def?.nivelMaximo || 4, cls: 'num' })}</label>`;
    const desc = def ? def.descricao + (def.niveis ? '\n' + Object.entries(def.niveis).map(([n, t]) => `Nível ${n}: ${t}`).join('\n') : '') : (h.descricao || '');
    return `<li><details><summary><b>${esc(nome)}</b> ${ctrl}
      <button class="icon-btn" data-act="del" data-list="habilidades" data-i="${i}" title="Remover">✕</button></summary>
      ${def ? `<p class="desc">${esc(desc).replace(/\n/g, '<br>')}</p>` : `<textarea data-path="system.habilidades.${i}.descricao" placeholder="Descrição">${esc(h.descricao || '')}</textarea>`}</details></li>`;
  };
  const groups = { defeito: 'Defeitos', fator: 'Fatores Hereditários', humana: 'Humanas', criatura: 'Criaturas Naturais', mistico: 'Místico', arcano: 'Arcano' };
  const catalog = Object.entries(groups).map(([g, n]) => `<optgroup label="${n}">${CONFIG.habilidades.habilidades.filter(h => h.pacote === g)
    .map(h => `<option value="${h.id}">${esc(h.nome)}${h.nivelMinimo ? ` (nv ${h.nivelMinimo}+)` : h.grau ? ` (${h.grau})` : ''}</option>`).join('')}</optgroup>`).join('');

  const poderes = s.poderes.map((p, i) => `<article class="power-card">
      <div class="pc-head">${inp(`system.poderes.${i}.nome`, p.nome, { ph: 'Nome' })}<label>Nível ${inp(`system.poderes.${i}.nivel`, p.nivel, { type: 'number', min: 1, max: 4, cls: 'num' })}</label></div>
      <div class="pc-meta">
        <label>Duração ${inp(`system.poderes.${i}.duracao`, p.duracao)}</label>
        <label>Alcance ${inp(`system.poderes.${i}.alcance`, p.alcance)}</label>
        <label>Componentes ${inp(`system.poderes.${i}.componentes`, p.componentes)}</label>
        <label>Aptidão ${inp(`system.poderes.${i}.aptidao`, p.aptidao, { ph: 'ex.: Destruição' })}</label>
      </div>
      <textarea data-path="system.poderes.${i}.descricao" placeholder="Descrição">${esc(p.descricao || '')}</textarea>
      <label class="variants">Variantes ${inp(`system.poderes.${i}.variantes`, p.variantes)}</label>
      <div class="pc-foot">
        <label><input type="checkbox" data-path="system.poderes.${i}.falha" ${p.falha ? 'checked' : ''}> Pode falhar</label>
        <label><input type="checkbox" data-path="system.poderes.${i}.passivo" ${p.passivo ? 'checked' : ''}> Passivo</label>
        <label><input type="checkbox" data-path="system.poderes.${i}.gratuito" ${p.gratuito ? 'checked' : ''}> Gratuito</label>
        <label title="Variantes compradas (1 ponto cada)">Var. compradas ${inp(`system.poderes.${i}.variantesCompradas`, p.variantesCompradas || 0, { type: 'number', min: 0, cls: 'num' })}</label>
        <span class="spacer"></span>
        <button data-act="cast" data-i="${i}" class="primary">Conjurar</button>
        <button class="icon-btn" data-act="del" data-list="poderes" data-i="${i}" title="Remover">✕</button>
      </div></article>`).join('');

  return `<section class="box habs"><h3>Habilidades</h3>
      <div class="hab-cols">${HAB_CATS.map(([k, n]) => `<div><h4>${n}</h4><ul>${byCat[k].map(habRow).join('') || '<li class="muted">—</li>'}</ul></div>`).join('')}</div>
      <div class="add-row"><select data-new="hab">${catalog}</select><button data-act="add-hab">+ do livro</button><button data-act="add-hab-livre">+ personalizada</button></div>
    </section>
    <section class="box"><h3>Poderes e Magias</h3><div class="power-grid">${poderes || '<p class="muted">Nenhum poder.</p>'}</div>
      <button class="add" data-act="add" data-list="poderes">+ poder / magia</button></section>`;
}

function pageInventario(a, d) {
  const s = a.system;
  const tipos = Object.values(CONFIG.tipoDano).map(t => `<option value="${t.id}">${t.nome}</option>`).join('');
  const attrOpts = sel => Object.entries(CONFIG.sistema.atributos).map(([k, v]) => `<option value="${k}" ${sel === k ? 'selected' : ''}>${v.nome}</option>`).join('');
  const aptOpts = sel => `<option value="">—</option>` + s.aptidoes.map((ap, i) => `<option value="${i}" ${String(sel) === String(i) ? 'selected' : ''}>${esc(aptidaoLabel(ap))}</option>`).join('');
  const armas = s.armas.map((w, i) => `<tr>
      <td>${inp(`system.armas.${i}.nome`, w.nome, { ph: 'Arma' })}</td>
      <td><select data-path="system.armas.${i}.atributo">${attrOpts(w.atributo)}</select></td>
      <td><select data-path="system.armas.${i}.aptIndex" data-num>${aptOpts(w.aptIndex)}</select></td>
      <td>${inp(`system.armas.${i}.aptExigida`, w.aptExigida, { type: 'number', min: 0, max: 5, cls: 'num', title: 'Aptidão exigida' })}</td>
      <td>${inp(`system.armas.${i}.impacto`, w.impacto, { type: 'number', min: 0, cls: 'num', title: 'Impacto' })}</td>
      <td>${inp(`system.armas.${i}.brutal`, w.brutal, { type: 'number', min: 0, cls: 'num', title: 'Brutal' })}</td>
      <td>${inp(`system.armas.${i}.letal`, w.letal, { type: 'number', min: 0, cls: 'num', title: 'Letal' })}</td>
      <td>${inp(`system.armas.${i}.bloqueio`, w.bloqueio, { type: 'number', min: 0, cls: 'num', title: 'Bloqueio' })}</td>
      <td>${inp(`system.armas.${i}.manuseio`, w.manuseio, { type: 'number', min: 0, cls: 'num', title: 'Manuseio' })}</td>
      <td>${inp(`system.armas.${i}.tempoExtra`, w.tempoExtra, { type: 'number', min: 0, cls: 'num', title: 'Pontos de tempo extras' })}</td>
      <td><select data-path="system.armas.${i}.dano">${tipos.replace(`value="${w.dano}"`, `value="${w.dano}" selected`)}</select></td>
      <td>${inp(`system.armas.${i}.palavrasChave`, w.palavrasChave, { ph: 'ex.: Distância(L)' })}</td>
      <td class="btns"><button data-act="attack" data-i="${i}" class="primary" title="Atacar">⚔</button><button data-act="block" data-i="${i}" title="Bloquear">🛡</button>
        <button class="icon-btn" data-act="del" data-list="armas" data-i="${i}" title="Remover">✕</button></td></tr>`).join('');
  const catalogo = CONFIG.equipamentos.armas.filter(x => !x.incompleto).map(x => `<option value="${x.id}">${x.nome} (${x.raridade})</option>`).join('');
  const absTxt = ab => Object.entries(ab || {}).map(([k, v]) => `${CONFIG.tipoDano[k]?.nome || k} ${v}`).join(', ');
  const pesoOpts = sel => Object.entries(CONFIG.sistema.pesoArmadura).map(([k, v]) => `<option value="${k}" ${sel === k ? 'selected' : ''}>${v.nome}</option>`).join('');
  const armads = (s.armaduras || []).map((ar, i) => `<tr>
      <td><input type="checkbox" data-path="system.armaduras.${i}.equipada" ${ar.equipada ? 'checked' : ''} title="Equipada"></td>
      <td>${inp(`system.armaduras.${i}.nome`, ar.nome, { ph: 'Armadura' })}</td>
      <td><select data-path="system.armaduras.${i}.peso">${pesoOpts(ar.peso)}</select></td>
      <td>${inp(`system.armaduras.${i}.imobilidade`, ar.imobilidade, { type: 'number', min: 0, cls: 'num', title: 'Imobilidade' })}</td>
      <td><input data-armor-abs="${i}" value="${esc(absTxt(ar.absorcao))}" placeholder="ex.: Cortante 7, Perfurante 7" aria-label="Absorção"></td>
      <td><button class="icon-btn" data-act="del" data-list="armaduras" data-i="${i}" title="Remover">✕</button></td></tr>`).join('');
  const catArm = CONFIG.equipamentos.armaduras.map(x => `<option value="${x.id}">${x.nome} (${x.raridade})</option>`).join('');
  const inv = s.inventario.map((it, i) => `<tr><td>${inp(`system.inventario.${i}.nome`, it.nome, { ph: 'Item' })}</td>
      <td>${inp(`system.inventario.${i}.quantidade`, it.quantidade, { type: 'number', min: 0, cls: 'num' })}</td>
      <td>${inp(`system.inventario.${i}.slots`, it.slots, { type: 'number', min: 0, cls: 'num' })}</td>
      <td><button class="icon-btn" data-act="del" data-list="inventario" data-i="${i}">✕</button></td></tr>`).join('');
  return `<div class="inv-grid">
    <section class="box"><h3>Inventário</h3>
      <table class="inv"><thead><tr><th>Item</th><th>Qtd</th><th>Slots</th><th></th></tr></thead><tbody>${inv}</tbody>
      <tfoot><tr><td>Total</td><td></td><td>${calc('slotsUsados', d)} / ${calc('slotsMax', d)}</td><td></td></tr></tfoot></table>
      <button class="add" data-act="add" data-list="inventario">+ item</button></section>
    <section class="box"><h3>Anotações do Personagem</h3><textarea class="notes" data-path="system.notas.personagem">${esc(s.notas.personagem)}</textarea></section>
    <section class="box wide"><h3>Armas</h3>
      <div class="table-scroll"><table class="weapons"><thead><tr><th>Arma</th><th>Atributo</th><th>Aptidão</th><th title="Aptidão exigida">Apt.</th><th title="Impacto">Imp.</th><th title="Brutal">Brut.</th><th title="Letal">Let.</th><th title="Bloqueio">Bloq.</th><th title="Manuseio">Man.</th><th title="Tempo extra">PT+</th><th>Dano</th><th>Palavras-chave</th><th></th></tr></thead><tbody>${armas}</tbody></table></div>
      <div class="add-row"><select data-new="arma"><option value="">Arma em branco</option>${catalogo}</select><button data-act="add-arma">+ arma</button></div></section>
    <section class="box wide"><h3>Armaduras</h3>
      <div class="table-scroll"><table class="weapons armors"><thead><tr><th title="Equipada">Eq.</th><th>Armadura</th><th>Peso</th><th title="Imobilidade">Imob.</th><th>Absorção (valor fixo por tipo)</th><th></th></tr></thead><tbody>${armads}</tbody></table></div>
      <p class="hint">Absorção de armadura é valor fixo: substitui a absorção do personagem naquele tipo se for maior. Imobilidade: Desvantagem(1) na esquiva e +1 PT no movimento por nível.</p>
      <div class="add-row"><select data-new="armadura"><option value="">Armadura em branco</option>${catArm}</select><button data-act="add-armadura">+ armadura</button></div></section>
    <section class="box wide"><h3>Anotações da História</h3><textarea class="notes tall" data-path="system.notas.historia">${esc(s.notas.historia)}</textarea></section>
  </div>`;
}

// ---------- eventos ----------
function onChange(actorId, e) {
  const el = e.target;
  const actor = getActor(actorId);
  if (el.dataset.armorAbs != null) {
    // "Cortante 7, Perfurante 7" -> { cortante: 7, perfurante: 7 }
    const byName = Object.fromEntries(Object.values(CONFIG.tipoDano).map(t => [t.nome.toLowerCase(), t.id]));
    const ab = {};
    for (const part of el.value.split(',')) {
      const m = part.trim().match(/^(.+?)\s+(\d+)$/);
      const id = m && (byName[m[1].toLowerCase()] || CONFIG.tipoDano[m[1].toLowerCase()]?.id);
      if (id) ab[id] = Number(m[2]);
    }
    update(() => { actor.system.armaduras[+el.dataset.armorAbs].absorcao = ab; });
    return;
  }
  if (!el.dataset.path) return;
  let v = el.type === 'checkbox' ? el.checked : el.value;
  if (el.dataset.num !== undefined) v = v === '' ? null : Number(v);
  update(() => {
    setPath(actor, el.dataset.path, v);
    if (el.dataset.path.startsWith('system.condicoes.') && !v) delete actor.system.condicoes[el.dataset.path.split('.')[2]];
  });
}

function onClick(actorId, e) {
  const b = e.target.closest('button');
  if (!b) return;
  const ctx = sheets.get(actorId), actor = getActor(actorId), s = actor.system, body = ctx.w.body;
  if (b.dataset.tab) { ctx.tab = b.dataset.tab; render(actorId); return; }
  const act = b.dataset.act;
  const sel = name => body.querySelector(`[data-new="${name}"]`)?.value;
  const blank = {
    virtudes: { nome: '', usada: false }, falhas: { nome: '', usada: false },
    poderes: { nome: '', nivel: 1, duracao: '', alcance: '', componentes: '', aptidao: '', descricao: '', variantes: '', falha: false, passivo: false },
    inventario: { nome: '', quantidade: 1, slots: 1 },
    armaduras: { nome: '', peso: 'leve', imobilidade: 0, absorcao: {}, equipada: true },
  };
  switch (act) {
    case 'add': update(() => s[b.dataset.list].push(structuredClone(blank[b.dataset.list]))); break;
    case 'del': update(() => s[b.dataset.list].splice(+b.dataset.i, 1)); break;
    case 'add-apt': update(() => s.aptidoes.push({ id: sel('apt'), especializacao: '', nivel: 1 })); break;
    case 'add-cond': { const id = sel('cond'); if (id) update(() => { s.condicoes[id] = 1; }); break; }
    case 'del-cond': update(() => delete s.condicoes[b.dataset.id]); break;
    case 'add-abs': { const id = sel('abs'); if (id) update(() => { s.absorcao[id] = 0; }); break; }
    case 'del-abs': update(() => delete s.absorcao[b.dataset.id]); break;
    case 'add-hab': {
      const def = CONFIG.habilidadeById[sel('hab')];
      if (def) update(() => s.habilidades.push({ ref: def.id, nivel: def.nivelMinimo || 1, grau: def.graus?.[0] }));
      break;
    }
    case 'add-hab-livre': update(() => s.habilidades.push({ nomeLivre: prompt('Nome da habilidade:') || 'Habilidade', nivel: 1, descricao: '' })); break;
    case 'add-arma': {
      const ref = CONFIG.equipamentos.armas.find(x => x.id === sel('arma'));
      update(() => s.armas.push(weaponFromCatalog(ref)));
      break;
    }
    case 'roll-attr': openRollDialog(actorId, { attr: b.dataset.attr }); break;
    case 'roll-apt': openRollDialog(actorId, { aptIndex: b.dataset.i }); break;
    case 'rolar': openRollDialog(actorId); break;
    case 'attack': attack(actor, +b.dataset.i); break;
    case 'block': block(actor, +b.dataset.i); break;
    case 'dodge': dodge(actor); break;
    case 'add-armadura': {
      const ref = CONFIG.equipamentos.armaduras.find(x => x.id === sel('armadura'));
      update(() => (s.armaduras ||= []).push(armorFromCatalog(ref)));
      break;
    }
    case 'cast': cast(actor, +b.dataset.i); break;
    case 'dano': openDamageDialog(actorId); break;
    case 'descanso': openRestDialog(actorId); break;
    case 'death-roll': update(() => { const r = deathRoll(actor); post({ tipo: 'roll', atorId: actorId, roll: r.result, titulo: 'Rolagem de Morte — Vitalidade (Resiliência)', extraHtml: `<div class="effect">${r.msgs.join(' ')}</div>` }); }); break;
    case 'imagem': pickFile('image/*').then(f => f && readFile(f, 'dataURL').then(url => update(() => { actor.imagem = url; }))); break;
  }
}

function weaponFromCatalog(ref) {
  if (!ref) return { nome: '', atributo: 'forca', aptIndex: '', aptExigida: 1, impacto: 2, brutal: 0, letal: 0, bloqueio: 0, manuseio: 1, tempoExtra: 1, dano: 'cortante', palavrasChave: '' };
  const p = CONFIG.sistema.pesoArma[ref.peso];
  const rar = CONFIG.sistema.raridades.find(r => r.id === ref.raridade);
  return { nome: ref.nome, ref: ref.id, atributo: p.atributo, aptIndex: '', aptExigida: ref.aptidao ?? 1, impacto: p.impacto,
    brutal: ref.brutal || 0, letal: ref.letal || 0, bloqueio: ref.bloqueio || 0, manuseio: rar?.manuseio || 0,
    tempoExtra: p.tempoExtra, dano: ref.dano[0], alcance: ref.alcance || null, distancia: ref.distancia || null,
    palavrasChave: [ref.distancia ? '' : `Alcance ${ref.alcance}`, ref.palavrasChaveTexto || ''].filter(Boolean).join(' · ') };
}

function armorFromCatalog(ref) {
  if (!ref) return { nome: '', peso: 'leve', imobilidade: 0, absorcao: {}, equipada: true };
  return { nome: ref.nome, ref: ref.id, peso: ref.peso, imobilidade: ref.imobilidade, absorcao: { ...ref.absorcao }, equipada: true };
}

/** Zona entre os tokens do atacante e do alvo (ou null se algum não estiver no mapa). */
function zoneBetween(a, b) {
  const tokens = scene().tokens;
  const ta = tokens.find(t => t.atorId === a.id), tb = b && tokens.find(t => t.atorId === b.id);
  if (!ta || !tb) return null;
  return zoneForBlocks(blockDistance(ta, tb));
}

/** Desvantagem por distância (palavra-chave Distância) ou aviso de alcance corpo a corpo. */
function rangeCheck(w, zona) {
  if (!zona) return { desv: 0, nota: '' };
  const ids = CONFIG.sistema.zonas.map(z => z.id), idx = ids.indexOf(zona.id);
  if (w.distancia?.length) {
    const desv = Math.min(...w.distancia.map(z => Math.abs(ids.indexOf(z) - idx)));
    return { desv, nota: desv ? `alvo a ${zona.nome}: Desvantagem(${desv}) por distância` : `alvo a ${zona.nome}` };
  }
  const max = w.alcance === 'distante' ? 1 : 0;
  return { desv: 0, nota: idx > max ? `⚠ alvo a ${zona.nome}: fora do alcance da arma` : `alvo a ${zona.nome}` };
}

function combatantFor(actorId) {
  return state.combate.ativo ? state.combate.combatentes.find(c => c.atorId === actorId) : null;
}

function chargeTime(actor, extra, label) {
  const c = combatantFor(actor.id);
  if (!c) return true;
  let res;
  update(() => { res = spendAction(c, actor, extra); });
  if (!res.ok) { toast(res.msg); return false; }
  postSystem(`${esc(label)}: ${res.msg}`, { atorId: actor.id });
  return true;
}

function attack(actor, i) {
  const w = actor.system.armas[i];
  if (!chargeTime(actor, w.tempoExtra, `Ataque com ${w.nome || 'arma'}`)) return;
  const limite = Number((w.palavrasChave || '').match(/arma de fogo\s*\((\d+)\)/i)?.[1]) || 0;
  const disparo = Number((w.palavrasChave || '').match(/disparo\s*\((\d+)\)/i)?.[1]) || 0;
  const alvo = getActor(local.alvoId); // ND do ataque = Evasão do alvo
  const rc = rangeCheck(w, alvo && zoneBetween(actor, alvo));
  if (rc.nota.startsWith('⚠')) toast(rc.nota);
  openRollDialog(actor.id, { attr: w.atributo, aptIndex: w.aptIndex, aptExigida: w.aptExigida, manuseio: w.manuseio,
    titulo: `Ataque: ${w.nome}${alvo ? ' → ' + alvo.nome : ''}${rc.nota ? ` (${rc.nota})` : ''}`, nd: alvo ? prepareDerived(alvo).evasao : 6,
    desvantagem: rc.desv,
    dano: { impacto: (Number(w.impacto) || 1) + disparo, brutal: Number(w.brutal) || 0, letal: Number(w.letal) || 0, limite, tipo: CONFIG.tipoDano[w.dano]?.nome || w.dano } });
}

function dodge(actor) {
  if (!chargeTime(actor, 0, 'Esquiva')) return;
  const d = prepareDerived(actor);
  openRollDialog(actor.id, { attr: 'destreza', titulo: 'Esquiva', nd: d.evasao, tipo: 'disputa', desvantagem: d.imobilidade });
}

function block(actor, i) {
  const w = actor.system.armas[i];
  if (!chargeTime(actor, w.tempoExtra, `Bloqueio com ${w.nome || 'arma'}`)) return;
  const d = prepareDerived(actor);
  openRollDialog(actor.id, { attr: w.atributo, aptIndex: w.aptIndex, aptExigida: w.aptExigida, manuseio: w.manuseio,
    titulo: `Bloqueio: ${w.nome}`, nd: d.evasao, tipo: 'disputa', bloqueio: (Number(w.impacto) || 1) + (Number(w.bloqueio) || 0) });
}

function cast(actor, i) {
  const p = actor.system.poderes[i], r = actor.system.recursos, lvl = Math.max(1, Number(p.nivel) || 1);
  if (p.passivo) { toast('Poder passivo: reduza os Pontos Especiais máximos enquanto ativo.'); return; }
  if ((r.conjuracao || 0) < lvl) { toast(`Pontos de Conjuração insuficientes (${r.conjuracao}/${lvl}).`); return; }
  const usaVida = (r.pontosEspeciais || 0) < lvl;
  if (usaVida && !confirm(`Pontos Especiais insuficientes. Pagar a diferença com Vida?`)) return;
  if (!chargeTime(actor, lvl, `Conjurar ${p.nome || 'poder'}`)) return;
  update(() => {
    r.conjuracao -= lvl;
    const mana = Math.min(r.pontosEspeciais || 0, lvl);
    r.pontosEspeciais -= mana;
    if (lvl - mana > 0) r.vida = Math.max(0, (r.vida || 0) - (lvl - mana));
  });
  postSystem(`Conjurou <b>${esc(p.nome || 'poder')}</b> (nível ${lvl}): −${lvl} conjuração, −${lvl} pontos especiais${usaVida ? ' (parte paga com Vida)' : ''}.`, { atorId: actor.id });
  if (p.falha) {
    const t = CONFIG.sistema.falhaMagia.find(x => x.nivel === lvl) || CONFIG.sistema.falhaMagia[0];
    openRollDialog(actor.id, { attr: 'potencia', nd: t.nd, ns: t.ns, aptExigida: lvl, titulo: `Conjuração (falha): ${p.nome}` });
  }
}

// ---------- dano / cura ----------
export function openDamageDialog(actorId) {
  const actor = getActor(actorId);
  const w = makeWindow('dmg-' + actorId, `Dano / Cura — ${actor.nome}`, { width: 340 });
  const tipos = CONFIG.tiposDano.categorias.map(c => `<optgroup label="${c.nome}">${c.tipos.map(t => `<option value="${t.id}">${t.nome}</option>`).join('')}</optgroup>`).join('');
  w.body.innerHTML = `<form class="roll-form">
    <label class="full">Quantidade <input type="number" name="qtd" min="0" value="1"></label>
    <label class="full">Tipo de dano <select name="tipo">${tipos}</select></label>
    <label>Letal <input type="number" name="letal" min="0" value="0"></label>
    <label>Absorção extra (bloqueio) <input type="number" name="absExtra" min="0" value="0"></label>
    <label class="full"><input type="checkbox" name="ignRes"> Ignorar Resistência</label>
    <div class="row full"><button type="submit" class="primary" name="acao" value="dano">Aplicar dano</button>
      <button type="submit" name="acao" value="cura">Curar Vida</button>
      <button type="submit" name="acao" value="sanidade">Perder Sanidade</button></div></form>`;
  const f = w.body.querySelector('form');
  f.addEventListener('submit', e => {
    e.preventDefault();
    const acao = e.submitter?.value || 'dano';
    const q = Number(f.qtd.value) || 0;
    let msgs = [];
    update(() => {
      if (acao === 'dano') msgs = applyDamage(actor, q, f.tipo.value, { letal: Number(f.letal.value) || 0, absorcaoExtra: Number(f.absExtra.value) || 0, ignorarResistencia: f.ignRes.checked }).msgs;
      else if (acao === 'cura') msgs = heal(actor, q);
      else msgs = loseSanity(actor, q);
    });
    if (acao === 'sanidade' && msgs.some(m => m.includes('trauma'))) {
      const t = rollFormula(1, 10).total;
      msgs.push(`Trauma (1d10 = ${t}): <i>${esc(CONFIG.tabelas.traumas.resultados[t - 1])}</i>`);
    }
    postSystem(msgs.join('<br>'), { atorId: actorId });
    w.close();
  });
}

// ---------- descanso ----------
export function openRestDialog(actorId) {
  const actor = getActor(actorId);
  const w = makeWindow('rest-' + actorId, `Descanso — ${actor.nome}`, { width: 330 });
  w.body.innerHTML = `<div class="rest">
    <button data-r="rapida">Recuperação rápida <small>alguns minutos</small></button>
    <button data-r="curta">Recuperação curta <small>horas / 1 dia</small></button>
    <button data-r="prolongada">Recuperação prolongada <small>dias / semanas</small></button>
    <p class="hint">Rápida: só estado leve. Curta: leve +3, grave +1, letal não recupera.</p>
    <p class="muted">Pontos Heroicos voltam no início de cada sessão: <button data-r="sessao" class="link">nova sessão</button></p></div>`;
  w.body.addEventListener('click', e => {
    const k = e.target.closest('[data-r]')?.dataset.r;
    if (!k) return;
    let msgs = [];
    update(() => { msgs = rest(actor, k); });
    const nomes = { rapida: 'rápida', curta: 'curta', prolongada: 'prolongada', sessao: 'nova sessão' };
    postSystem(`<b>Descanso (${nomes[k]})</b>: ${msgs.join(' ')}`, { atorId: actorId });
    w.close();
  });
}
