// Motor de rolagens do Omni.
// Regras (livro 2.2): rola (atributo + 1) dados; o tipo do dado vem do nível do domínio;
// dado ≤ ND = sucesso; 1 natural = crítico (sempre sucesso); Maestria reduz valores;
// Vantagem/Desvantagem somam/subtraem sucessos.

export const DIE_BY_DOMAIN = { '-1': 100, 0: 20, 1: 12, 2: 10, 3: 8, 4: 6, 5: 4, 6: 2 };

export function dieForDomain(level) {
  const l = Math.max(-1, Math.min(6, Number(level) || 0));
  return DIE_BY_DOMAIN[l];
}

let rng = () => Math.random();
/** Permite injetar um gerador determinístico (testes). */
export function setRandom(fn) { rng = fn; }

export function rollDie(faces) {
  return 1 + Math.floor(rng() * faces);
}

/**
 * Distribui a Maestria de forma ótima: transforma o maior número possível de falhas em sucessos.
 * Dados mais próximos do ND são reduzidos primeiro. Dado reduzido nunca vira crítico.
 */
export function applyMaestria(dice, nd, maestria) {
  let budget = Math.max(0, maestria | 0);
  const failing = dice
    .filter(d => !d.success)
    .sort((a, b) => (a.value - nd) - (b.value - nd));
  for (const d of failing) {
    const cost = d.value - nd;
    if (cost <= budget) {
      budget -= cost;
      d.reducedFrom = d.value;
      d.value = nd;
      d.success = true;
      d.reduced = true;
    } else break;
  }
  return budget; // maestria não usada
}

/**
 * Rola uma parada de dados do Omni.
 * @param {object} o
 * @param {number} o.count      número de dados (atributo + 1)
 * @param {number} o.faces      faces do dado
 * @param {number} o.nd         nível de desafio (mín. 1)
 * @param {number} [o.maestria] maestria total (aptidão + manuseio + ...)
 * @param {number} [o.vantagem]
 * @param {number} [o.desvantagem]
 * @param {Array<{count:number,faces:number}>} [o.extra] dados extras (palavra-chave Extra)
 * @param {boolean} [o.criticoExplosivo] regra opcional: cada crítico rola mais um dado
 */
export function rollPool(o) {
  const nd = Math.max(1, o.nd | 0);
  const dice = [];
  const push = (faces, source) => {
    const value = rollDie(faces);
    dice.push({ value, faces, natural: value, crit: value === 1, success: value === 1 || value <= nd, source });
  };
  for (let i = 0; i < Math.max(0, o.count | 0); i++) push(o.faces, 'base');
  for (const e of o.extra || []) for (let i = 0; i < e.count; i++) push(e.faces, 'extra');

  if (o.criticoExplosivo) {
    let pending = dice.filter(d => d.crit).length, guard = 0;
    while (pending > 0 && guard++ < 50) {
      pending--;
      push(o.faces, 'explosao');
      if (dice[dice.length - 1].crit) pending++;
    }
  }

  const maestriaSobra = applyMaestria(dice, nd, o.maestria || 0);
  return evaluate({ dice, nd, faces: o.faces, maestria: o.maestria || 0, maestriaSobra,
    vantagem: o.vantagem || 0, desvantagem: o.desvantagem || 0, ns: o.ns });
}

/** Recalcula o resultado de uma rolagem (usado também após gastar Ponto Heroico). */
export function evaluate(r) {
  const raw = r.dice.filter(d => d.success).length;
  const crits = r.dice.filter(d => d.crit).length;
  const mod = (r.vantagem || 0) - (r.desvantagem || 0);
  const successes = Math.max(0, raw + mod);
  const out = { ...r, raw, crits, successes };
  if (r.ns != null && r.ns !== '') {
    out.ns = Number(r.ns);
    out.passed = successes >= out.ns;
    out.margin = successes - out.ns;
  }
  return out;
}

/** Ponto Heroico: rola 1 dado adicional (mesmo tipo) e o adiciona à rolagem. */
export function addHeroicDie(result) {
  const value = rollDie(result.faces);
  const die = { value, faces: result.faces, natural: value, crit: value === 1,
    success: value === 1 || value <= result.nd, source: 'heroico' };
  const dice = [...result.dice, die];
  // a maestria que sobrou pode ser usada no novo dado
  let sobra = result.maestriaSobra || 0;
  if (!die.success && die.value - result.nd <= sobra) {
    sobra -= die.value - result.nd;
    die.reducedFrom = die.value; die.value = result.nd; die.success = true; die.reduced = true;
  }
  return evaluate({ ...result, dice, maestriaSobra: sobra, heroicosGastos: (result.heroicosGastos || 0) + 1 });
}

/** Virtude ativada: transforma um dado (o pior, por padrão) em sucesso crítico automático. */
export function applyVirtue(result, index) {
  const dice = result.dice.map(d => ({ ...d }));
  const i = index ?? worstIndex(dice);
  if (i < 0) return result;
  Object.assign(dice[i], { value: 1, crit: true, success: true, virtude: true, reduced: false });
  return evaluate({ ...result, dice, virtudeUsada: true });
}

/** Falha ativada (pelo mestre): transforma um dado (o melhor, por padrão) em falha — inclusive crítico. */
export function applyFlaw(result, index) {
  const dice = result.dice.map(d => ({ ...d }));
  const i = index ?? bestIndex(dice);
  if (i < 0) return result;
  Object.assign(dice[i], { crit: false, success: false, falha: true });
  return evaluate({ ...result, dice, falhaUsada: true });
}

function worstIndex(dice) {
  // prefere um dado que falhou; entre eles, o de maior valor
  let idx = -1;
  dice.forEach((d, i) => {
    if (d.crit) return;
    if (idx < 0) { idx = i; return; }
    const b = dice[idx];
    if (!d.success && b.success) idx = i;
    else if (d.success === b.success && d.value > b.value) idx = i;
  });
  return idx;
}
function bestIndex(dice) {
  let idx = -1;
  dice.forEach((d, i) => { if (d.success && (idx < 0 || d.crit || d.value < dice[idx].value)) idx = i; });
  return idx;
}

/** Rolagem simples de "XdY" (ex.: tabela de traumas). */
export function rollFormula(count, faces) {
  const values = Array.from({ length: count }, () => rollDie(faces));
  return { values, total: values.reduce((a, b) => a + b, 0) };
}
