// Modelo de personagem e cálculo das estatísticas derivadas (equivalente ao prepareDerivedData do Foundry).
import { CONFIG } from './config.js';
import { dieForDomain } from './dice.js';

export const DOMAINS = ['fortitude', 'resiliencia', 'mental', 'controle'];
export const ATTRS = ['forca', 'destreza', 'vitalidade', 'ritmo', 'raciocinio', 'instinto', 'potencia', 'reserva'];

export const uid = () => Math.random().toString(36).slice(2, 10);
const triangular = n => (n > 0 ? (n * (n + 1)) / 2 : 0);
const num = v => Number(v) || 0;

export function createActor(overrides = {}) {
  const a = {
    id: uid(),
    nome: 'Novo Personagem',
    tipo: 'personagem', // personagem | npc
    imagem: '',
    cor: randomColor(),
    system: {
      dados: { altura: '', peso: '', idade: '', familia: '', dinheiro: '', idiomaNativo: '' },
      progressao: { inicial: 10, ganhos: 0 },
      dominios: { fortitude: 1, resiliencia: 1, mental: 1, controle: 0 },
      atributos: Object.fromEntries(ATTRS.map(k => [k, 0])),
      determinacao: 'raciocinio',
      aptidoes: [{ id: 'idiomas', especializacao: 'Nativo', nivel: 3, nativo: true }],
      virtudes: [{ nome: '', usada: false }],
      falhas: [{ nome: '', usada: false }],
      habilidades: [],
      poderes: [],
      inventario: [],
      armas: [],
      armaduras: [],
      absorcao: { geral: 0, fisico: 0, elemental: 0 },
      recursos: { vida: null, sanidade: null, pontosEspeciais: null, conjuracao: null, heroicos: null,
        cansaco: 0, grauMorte: 0, sucessosMorte: 0, portasDaMorte: false, morto: false },
      combate: { penalidadeCriticos: 0 },
      condicoes: {},
      notas: { personagem: '', historia: '' },
    },
  };
  const merged = deepMerge(a, overrides);
  fillResources(merged);
  return merged;
}

/** Preenche recursos atuais vazios com o máximo. */
export function fillResources(actor) {
  const d = prepareDerived(actor);
  const r = actor.system.recursos;
  if (r.vida == null) r.vida = d.vidaMax;
  if (r.sanidade == null) r.sanidade = d.sanidadeMax;
  if (r.pontosEspeciais == null) r.pontosEspeciais = d.pontosEspeciaisMax;
  if (r.conjuracao == null) r.conjuracao = d.conjuracaoMax;
  if (r.heroicos == null) r.heroicos = d.heroicosMax;
  return actor;
}

export function categoryForLevel(nivel) {
  return CONFIG.sistema.categorias.find(c => c.niveis.includes(nivel)) || CONFIG.sistema.categorias[0];
}

export function levelFromPoints(ganhos) {
  const t = CONFIG.sistema.progressao.minimoPorNivel;
  let n = 1;
  for (let i = 0; i < t.length; i++) if (ganhos >= t[i]) n = i + 1;
  return n;
}

export function determinationValue(actor) {
  const s = actor.system;
  return num(s.atributos[s.determinacao === 'instinto' ? 'instinto' : 'raciocinio']);
}

/** Custo, em pontos de progressão, de tudo o que está na ficha. */
export function spentPoints(actor) {
  const s = actor.system, c = CONFIG.sistema.progressao.custos;
  const free = CONFIG.sistema.progressao.criacao;
  let total = 0;
  const domSum = DOMAINS.reduce((acc, k) => acc + num(s.dominios[k]), 0);
  total += c.dominio * Math.max(0, domSum - free.dominiosGratuitos);
  total += c.atributo * ATTRS.reduce((acc, k) => acc + Math.max(0, num(s.atributos[k])), 0);
  for (const ap of s.aptidoes) {
    const lvl = num(ap.nivel);
    total += c.aptidao * (ap.nativo ? Math.max(0, lvl - free.idiomaNativoNivel) : lvl);
  }
  for (const h of s.habilidades) {
    const def = CONFIG.habilidadeById[h.ref];
    if (h.gratuita) continue;
    if (def?.pacote === 'defeito') total -= num(def.pontosConcedidos?.[h.grau] ?? 0);
    else if (def?.pacote === 'fator') total += num(def.custo);
    else total += c.habilidadePorNivel * Math.max(1, num(h.nivel));
  }
  for (const p of s.poderes) {
    if (p.gratuito) continue;
    total += c.poderPorNivel * Math.max(1, num(p.nivel)) + num(p.variantesCompradas);
  }
  return total;
}

export function prepareDerived(actor) {
  const s = actor.system;
  const dom = k => num(s.dominios[k]);
  const at = k => num(s.atributos[k]);
  const ganhos = num(s.progressao.ganhos);
  const nivel = levelFromPoints(ganhos);
  const cat = categoryForLevel(nivel);
  const gastos = spentPoints(actor);
  const disponiveis = num(s.progressao.inicial) + ganhos;
  const cansaco = fatigueForPenalties(actor);

  const slotsUsados = s.inventario.reduce((acc, i) => acc + num(i.slots) * Math.max(1, num(i.quantidade) || 1), 0);

  const d = {
    nivel,
    categoria: cat.id,
    categoriaNome: cat.nome,
    pontosDisponiveis: disponiveis,
    pontosGastos: gastos,
    pontosReserva: disponiveis - gastos,
    vidaMax: Math.max(1, 1 + dom('resiliencia') + 2 * at('vitalidade')),
    sanidadeMax: determinationValue(actor) + 1,
    pontosTempoBase: 1 + at('ritmo') + dom('resiliencia'),
    pontosCriticosMax: 3 + num(s.combate?.criticosBonus),
    evasao: Math.max(1, 7 - dom('fortitude')),
    resistenciaGeral: triangular(dom('resiliencia')),
    resistenciaMental: triangular(dom('mental')),
    pontosEspeciaisMax: 1 + at('reserva'),
    conjuracaoMax: Math.max(0, dom('controle')),
    slotsMax: at('forca') + 5,
    slotsUsados,
    heroicosMax: 2 * nivel,
    dados: Object.fromEntries(DOMAINS.map(k => [k, dieForDomain(dom(k))])),
    avisos: [],
  };
  d.pontosTempoMax = Math.max(0, d.pontosTempoBase - Math.min(cansaco, 3) - num(s.combate?.penalidadeCriticos));
  const armad = (s.armaduras || []).filter(a => a.equipada);
  d.imobilidade = armad.reduce((acc, a) => acc + num(a.imobilidade), 0) + num(s.condicoes['terreno-dificil']);
  d.movimentoPT = Math.max(0, ...armad.map(a => CONFIG.sistema.pesoArmadura[a.peso]?.tempoMovimento || 0)) + d.imobilidade;
  d.metadeVida = Math.floor(d.vidaMax / 2);
  d.metadeSanidade = Math.floor(d.sanidadeMax / 2);

  // validações de limite por categoria
  if (actor.tipo === 'personagem') {
    for (const k of DOMAINS) if (dom(k) > cat.maxDominio)
      d.avisos.push(`${CONFIG.sistema.dominios.find(x => x.id === k).nome} acima do máximo da categoria ${cat.nome} (${cat.maxDominio}).`);
    for (const k of ATTRS) if (at(k) > cat.maxAtributo)
      d.avisos.push(`${CONFIG.sistema.atributos[k].nome} acima do máximo da categoria ${cat.nome} (${cat.maxAtributo}).`);
    for (const ap of s.aptidoes) if (!ap.nativo && num(ap.nivel) > cat.maxAptidao)
      d.avisos.push(`Aptidão ${aptidaoLabel(ap)} acima do máximo da categoria (${cat.maxAptidao}).`);
    if (d.pontosReserva < 0) d.avisos.push(`Pontos de progressão gastos além do disponível (${d.pontosReserva}).`);
    if (s.virtudes.filter(v => v.nome).length > 3) d.avisos.push('Mais de 3 virtudes.');
    if (s.falhas.filter(v => v.nome).length > 3) d.avisos.push('Mais de 3 falhas.');
  }
  if (slotsUsados > d.slotsMax) d.avisos.push(`Inventário acima do limite de slots (${slotsUsados}/${d.slotsMax}).`);
  return d;
}

export function aptidaoLabel(ap) {
  const nome = CONFIG.aptidaoById[ap.id]?.nome || ap.nomeLivre || ap.id;
  return ap.especializacao ? `${nome} (${ap.especializacao})` : nome;
}

/** Absorção total contra um tipo de dano = geral + categoria + específica. */
export function absorptionFor(actor, tipo) {
  const ab = actor.system.absorcao || {};
  const cat = CONFIG.tipoDano[tipo]?.categoria;
  const atual = num(ab.geral) + (cat ? num(ab[cat]) : 0) + num(ab[tipo]);
  // armaduras equipadas: absorção de valor fixo — substitui se for maior
  const armadura = Math.max(0, ...(actor.system.armaduras || []).filter(a => a.equipada).map(a => num(a.absorcao?.[tipo])));
  return Math.max(atual, armadura);
}

export const hasSkill = (actor, ref) => actor.system.habilidades.some(h => h.ref === ref);

/** Cansaço que conta para penalidades (Grande Guerreiro ignora os níveis 1 a 5). */
export function fatigueForPenalties(actor) {
  const c = num(actor.system.recursos.cansaco);
  return hasSkill(actor, 'humana-grande-guerreiro') && c < 6 ? 0 : c;
}

/** Atributo -> domínio. */
export function domainOf(attr) {
  return CONFIG.sistema.atributos[attr]?.dominio;
}

/** Parâmetros base de rolagem para um atributo do personagem. */
export function rollBase(actor, attr) {
  const dom = domainOf(attr);
  return {
    count: num(actor.system.atributos[attr]) + 1,
    faces: dieForDomain(num(actor.system.dominios[dom])),
    attr, dom,
  };
}

/** Desvantagem automática por condições e cansaço. */
export function autoPenalties(actor, dom) {
  const s = actor.system, list = [];
  let desv = 0;
  const cans = fatigueForPenalties(actor);
  if (cans >= 4) { desv += 1; list.push('Cansaço 4+'); }
  if (s.condicoes.atordoado || cans >= 5 || num(s.condicoes.aterrorizado) === 3) {
    desv += 1; list.push('Atordoado');
  }
  const terror = num(s.condicoes.aterrorizado);
  if (terror >= 2 || (terror === 1 && dom === 'mental')) { desv += 1; list.push(`Aterrorizado(${terror})`); }
  return { desvantagem: desv, motivos: list };
}

// ---------- utilidades ----------
function deepMerge(target, src) {
  for (const [k, v] of Object.entries(src || {})) {
    if (v && typeof v === 'object' && !Array.isArray(v) && target[k] && typeof target[k] === 'object') deepMerge(target[k], v);
    else target[k] = v;
  }
  return target;
}

function randomColor() {
  const palette = ['#b23a48', '#2f6690', '#3a7d44', '#8e5572', '#c97c1a', '#5b5f97', '#1b998b', '#6d4c41'];
  return palette[Math.floor(Math.random() * palette.length)];
}
