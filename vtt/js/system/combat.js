// Regras de combate: dano, sanidade, morte, pontos de tempo e processamento de início de rodada.
import { CONFIG } from './config.js';
import { prepareDerived, absorptionFor, rollBase } from './actor.js';
import { rollPool } from './dice.js';

const num = v => Number(v) || 0;

export function roundDurationSeconds(rodada) {
  return 5 * Math.pow(2, Math.floor((Math.max(1, rodada) - 1) / 2));
}

/**
 * Aplica dano seguindo D6: dano − Resistência (Geral, ou Mental para dano mental) − Absorção do tipo.
 * @returns {{final:number, msgs:string[], vidaPerdida:number}}
 */
export function applyDamage(actor, amount, tipo = 'contundente', opts = {}) {
  const s = actor.system, r = s.recursos, d = prepareDerived(actor);
  const msgs = [];
  amount = Math.max(0, num(amount));

  if (tipo === 'mental') {
    const final = Math.max(0, amount - d.resistenciaMental);
    msgs.push(`Dano mental ${amount} − Resistência Mental ${d.resistenciaMental} = <b>${final}</b> (efeito definido pelo poder; não reduz Vida).`);
    return { final, msgs, vidaPerdida: 0 };
  }

  const resist = opts.ignorarResistencia ? 0 : d.resistenciaGeral;
  const abs = opts.ignorarAbsorcao ? 0 : absorptionFor(actor, tipo) + num(opts.absorcaoExtra);
  const final = Math.max(0, amount - resist - abs);
  const nomeTipo = CONFIG.tipoDano[tipo]?.nome || tipo;
  msgs.push(`${amount} de dano ${nomeTipo} − Resistência ${resist} − Absorção ${abs} = <b>${final}</b>.`);
  if (final === 0) return { final, msgs, vidaPerdida: 0 };

  const antes = num(r.vida);
  let vidaPerdida = 0;
  if (antes > 0) {
    const depois = antes - final;
    vidaPerdida = Math.min(antes, final);
    r.vida = Math.max(0, depois);
    if (antes > d.metadeVida && r.vida <= d.metadeVida) {
      r.cansaco = num(r.cansaco) + 1;
      msgs.push('Caiu abaixo de 50% da Vida: <b>+1 Cansaço</b>.');
    }
    if (final >= d.vidaMax) msgs.push('Dano ≥ 100% da Vida máxima em um golpe: região <b>Inutilizada</b> (torso/cabeça = morte).');
    else if (final >= Math.ceil(d.vidaMax / 2)) msgs.push('Dano ≥ 50% da Vida máxima em um golpe: região <b>Danificada</b>.');
    if (r.vida === 0) {
      r.cansaco = num(r.cansaco) + 1;
      r.portasDaMorte = true;
      msgs.push('Vida chegou a 0: <b>+1 Cansaço</b> e entra nas <b>Portas da Morte</b>. Faça a rolagem de morte.');
      const excesso = final - antes;
      if (excesso > 0) addDeathDamage(actor, excesso, tipo, msgs);
    }
  } else {
    addDeathDamage(actor, final, tipo, msgs);
  }

  if (s.condicoes.concentracao && vidaPerdida > 0) {
    const custo = vidaPerdida * num(s.condicoes.concentracao);
    msgs.push(`Concentração: pague <b>${custo}</b> ponto(s) de conjuração para manter a magia, ou ela se quebra.`);
  }
  if (opts.letal && vidaPerdida > 0) {
    const sang = Math.min(num(opts.letal), vidaPerdida);
    s.condicoes.sangramento = num(s.condicoes.sangramento) + sang;
    msgs.push(`Letal: <b>Sangramento(+${sang})</b>.`);
  }
  checkDeath(actor, msgs);
  return { final, msgs, vidaPerdida };
}

function addDeathDamage(actor, value, tipo, msgs) {
  const r = actor.system.recursos;
  const extra = tipo === 'alma' ? value : 0; // dano de alma soma +1 por ponto
  r.grauMorte = num(r.grauMorte) + value + extra;
  if (actor.system.condicoes.estabilizado) {
    delete actor.system.condicoes.estabilizado;
    msgs.push('Deixou de estar estável.');
  }
  msgs.push(`Dano de morte: grau de morte <b>${r.grauMorte}</b>.`);
}

export function checkDeath(actor, msgs = []) {
  const r = actor.system.recursos, d = prepareDerived(actor);
  if (r.portasDaMorte && num(r.grauMorte) >= d.vidaMax && !r.morto) {
    r.morto = true;
    msgs.push(`☠️ Grau de morte (${r.grauMorte}) ≥ Vida máxima (${d.vidaMax}): <b>o personagem morre</b>.`);
  }
  return msgs;
}

export function heal(actor, amount) {
  const r = actor.system.recursos, d = prepareDerived(actor);
  r.vida = Math.min(d.vidaMax, num(r.vida) + Math.max(0, num(amount)));
  const msgs = [`Recuperou ${amount} de Vida (${r.vida}/${d.vidaMax}).`];
  if (r.vida > 0 && r.portasDaMorte) {
    r.portasDaMorte = false; r.grauMorte = 0; r.sucessosMorte = 0;
    delete actor.system.condicoes.estabilizado; delete actor.system.condicoes.inconsciente;
    msgs.push('Saiu das Portas da Morte.');
  }
  return msgs;
}

export function loseSanity(actor, amount) {
  const r = actor.system.recursos, d = prepareDerived(actor), s = actor.system;
  const antes = num(r.sanidade);
  r.sanidade = antes - Math.max(0, num(amount));
  const msgs = [`Perdeu ${amount} de Sanidade (${r.sanidade}/${d.sanidadeMax}).`];
  if (s.condicoes.concentracao) { delete s.condicoes.concentracao; msgs.push('Perder sanidade <b>quebra a concentração</b>.'); }
  if (antes > d.metadeSanidade && r.sanidade <= d.metadeSanidade)
    msgs.push('Sanidade caiu a 50% ou menos: <b>trauma permanente</b> (role na tabela de traumas).');
  if (r.sanidade <= 0) msgs.push('Sanidade 0: <b>loucura completa</b> — o jogador perde o controle do personagem.');
  return msgs;
}

/** Rolagem de morte: Vitalidade (Resiliência) com Resistência a Condições, ND 1. */
export function deathRoll(actor, ajudaMedicina = 0) {
  const r = actor.system.recursos, s = actor.system;
  const base = rollBase(actor, 'vitalidade');
  const apt = s.aptidoes.find(a => a.id === 'resistencia-a-condicoes');
  const consist = s.habilidades.some(h => h.ref === 'humana-vontade-imortal');
  const result = rollPool({ ...base, nd: 1, maestria: num(apt?.nivel) + num(ajudaMedicina) });
  const msgs = [];
  r.sucessosMorte = num(r.sucessosMorte) + result.successes;
  if (result.successes === 0) { s.condicoes.inconsciente = 1; msgs.push('Nenhum sucesso: fica <b>inconsciente</b>.'); }
  if (num(r.sucessosMorte) >= num(r.grauMorte)) {
    s.condicoes.estabilizado = 1;
    msgs.push(`Sucessos de morte (${r.sucessosMorte}) ≥ grau (${r.grauMorte}): <b>estabilizou</b>.`);
  } else {
    r.grauMorte = num(r.grauMorte) + 1;
    msgs.push(`Não estabilizou: grau de morte sobe para <b>${r.grauMorte}</b> (sucessos acumulados ${r.sucessosMorte}).`);
  }
  if (consist) msgs.push('Lembrete: Vontade Imortal concede Consistente(1) — re-role um dado se quiser.');
  checkDeath(actor, msgs);
  return { result, msgs };
}

/** Custo da próxima ação: nº de ações já feitas na rodada + 1 + extra (+1 se Atordoado). */
export function actionCost(combatant, actor, extra = 0) {
  const atordoado = actor.system.condicoes.atordoado || num(actor.system.recursos.cansaco) >= 5;
  return num(combatant.acoes) + 1 + num(extra) + (atordoado ? 1 : 0);
}

/** Registra uma ação. Usa Pontos Críticos quando passa do máximo. */
export function spendAction(combatant, actor, extra = 0, { contaComoAcao = true } = {}) {
  const d = prepareDerived(actor);
  const cost = contaComoAcao ? actionCost(combatant, actor, extra) : num(extra);
  const novoTotal = num(combatant.ptGastos) + cost;
  const criticos = Math.max(0, novoTotal - d.pontosTempoMax);
  if (criticos > d.pontosCriticosMax) {
    return { ok: false, cost, msg: `Sem pontos suficientes: custo ${cost}, restam ${d.pontosTempoMax + d.pontosCriticosMax - num(combatant.ptGastos)}.` };
  }
  combatant.ptGastos = novoTotal;
  combatant.criticosUsados = criticos;
  if (contaComoAcao) combatant.acoes = num(combatant.acoes) + 1;
  const msg = `Ação custou <b>${cost}</b> PT (${novoTotal}/${d.pontosTempoMax}${criticos ? `, <b>${criticos} crítico(s)</b>` : ''}).`;
  return { ok: true, cost, criticos, msg };
}

/**
 * Processa a virada de rodada para um combatente:
 * fim da rodada anterior (cansaço por críticos, penalidade de PT) e início da nova
 * (sangramento, combustão, cicatriz arcana, conjuração, rolagem de morte).
 */
export function processRoundStart(combatant, actor) {
  const s = actor.system, r = s.recursos, c = s.condicoes, msgs = [];
  const d0 = prepareDerived(actor);

  // fim da rodada anterior
  const crit = num(combatant.criticosUsados);
  if (crit > 0) {
    r.cansaco = num(r.cansaco) + 1;
    s.combate.penalidadeCriticos = crit;
    msgs.push(`Usou ${crit} ponto(s) crítico(s): <b>+1 Cansaço</b> e −${crit} PT nesta rodada.`);
  } else s.combate.penalidadeCriticos = 0;
  combatant.acoes = 0; combatant.ptGastos = 0; combatant.criticosUsados = 0;

  // conjuração (recupera, menos cicatrizes arcanas)
  const cic = num(c['cicatriz-arcana']);
  r.conjuracao = Math.max(0, d0.conjuracaoMax - cic);
  if (cic > 0) {
    msgs.push(`Cicatriz Arcana(${cic}): recupera só ${r.conjuracao} de conjuração.`);
    c['cicatriz-arcana'] = cic - 1; if (!c['cicatriz-arcana']) delete c['cicatriz-arcana'];
  }

  if (c.concentracao) msgs.push(`Concentração(${c.concentracao}): pague ${c.concentracao} de conjuração para manter.`);

  // sangramento
  const sang = num(c.sangramento);
  if (sang > 0) {
    const res = applyDamage(actor, sang, 'sangramento', { ignorarResistencia: true, ignorarAbsorcao: true });
    msgs.push(`Sangramento(${sang}): perde ${res.vidaPerdida} de Vida. ` + res.msgs.slice(1).join(' '));
    c.sangramento = sang - 1; if (!c.sangramento) delete c.sangramento;
  }
  // combustão
  const comb = num(c.combustao);
  if (comb > 0) {
    const res = applyDamage(actor, comb, 'fogo');
    msgs.push(`Combustão(${comb}): ` + res.msgs.join(' '));
    c.combustao = comb - 1; if (!c.combustao) delete c.combustao;
  }

  if (num(r.cansaco) >= 6) msgs.push('Cansaço 6: faça testes contra a morte.');
  let death = null;
  if (r.portasDaMorte && !c.estabilizado && !r.morto) {
    death = deathRoll(actor);
    msgs.push('Rolagem de morte: ' + death.result.successes + ' sucesso(s). ' + death.msgs.join(' '));
  }
  return { msgs, death };
}
