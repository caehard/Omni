// Testes das regras do Omni (abrir /vtt/tests/ no navegador via servidor local).
import { loadConfig } from '../js/system/config.js';
import { rollPool, setRandom, applyMaestria, dieForDomain, addHeroicDie, applyVirtue, applyFlaw } from '../js/system/dice.js';
import { createActor, prepareDerived, spentPoints, levelFromPoints } from '../js/system/actor.js';
import { applyDamage, deathRoll, spendAction, processRoundStart, roundDurationSeconds, loseSanity } from '../js/system/combat.js';

const results = [];
const eq = (name, got, exp) => results.push({ name, ok: JSON.stringify(got) === JSON.stringify(exp), got, exp });
/** gerador que devolve os valores de dado informados, para um dado de `faces` faces */
const seq = (faces, values) => { let i = 0; setRandom(() => (values[i++ % values.length] - 1) / faces + 1e-9); };

await loadConfig('../../data/');

// --- dados ---
eq('dado por domínio 0 = d20', dieForDomain(0), 20);
eq('dado por domínio 2 = d10', dieForDomain(2), 10);
eq('dado por domínio -1 = d100', dieForDomain(-1), 100);

seq(10, [3, 7, 1, 9]);
let r = rollPool({ count: 4, faces: 10, nd: 5, ns: 2 });
eq('sucessos simples (3,7,1,9 vs ND5)', r.successes, 2);
eq('críticos', r.crits, 1);
eq('teste passa com NS 2', r.passed, true);

seq(10, [6, 8, 9]);
r = rollPool({ count: 3, faces: 10, nd: 5, maestria: 4 });
eq('maestria 4 converte 6 e 8 (custos 1 e 3)', r.successes, 2);
eq('dado reduzido não é crítico', r.dice.some(d => d.reduced && d.crit), false);

seq(10, [2, 2, 9]);
r = rollPool({ count: 3, faces: 10, nd: 5, vantagem: 1, desvantagem: 3 });
eq('vantagem/desvantagem líquidas (2 + 1 − 3 = 0)', r.successes, 0);

seq(20, [1, 20]);
r = rollPool({ count: 2, faces: 20, nd: 1 });
eq('crítico sempre é sucesso mesmo com ND 1', r.successes, 1);

seq(10, [1, 9]);
r = rollPool({ count: 2, faces: 10, nd: 4 });
seq(10, [3]);
r = addHeroicDie(r);
eq('ponto heroico adiciona dado', r.dice.length, 3);
eq('dado heroico conta sucesso', r.successes, 2);
eq('virtude transforma o pior dado em crítico', applyVirtue(r).successes, 3);
eq('falha transforma o melhor dado em falha', applyFlaw(r).successes, 1);

// --- personagem ---
const a = createActor({ system: { dominios: { fortitude: 2, resiliencia: 2, mental: 1, controle: 1 },
  atributos: { forca: 1, destreza: 2, vitalidade: 2, ritmo: 1, raciocinio: 1, instinto: 0, potencia: 0, reserva: 1 } } });
let d = prepareDerived(a);
eq('vida = 1 + Resiliência + 2×Vitalidade', d.vidaMax, 1 + 2 + 4);
eq('sanidade = Determinação(Raciocínio) + 1', d.sanidadeMax, 2);
eq('PT = 1 + Ritmo + Resiliência', d.pontosTempoMax, 4);
eq('evasão = 7 − Fortitude', d.evasao, 5);
eq('resistência geral = triangular(Resiliência 2)', d.resistenciaGeral, 3);
eq('resistência mental = triangular(Mental 1)', d.resistenciaMental, 1);
eq('pontos especiais = 1 + Reserva', d.pontosEspeciaisMax, 2);
eq('slots = Força + 5', d.slotsMax, 6);
// domínios: soma 6 − 3 grátis = 3 níveis × 6 = 18; atributos 8 × 3 = 24; idioma nativo 3 grátis
eq('pontos gastos', spentPoints(a), 18 + 24);
eq('nível com 0 pontos ganhos', levelFromPoints(0), 1);
eq('nível com 50 pontos ganhos', levelFromPoints(50), 5);

a.system.recursos.cansaco = 2;
eq('cansaço 2 reduz PT em 2', prepareDerived(a).pontosTempoMax, 2);
a.system.recursos.cansaco = 0;

// --- dano ---
a.system.recursos.vida = 7;
a.system.absorcao.cortante = 1;
let res = applyDamage(a, 6, 'cortante');
eq('dano 6 − resist 3 − absorção 1 = 2', res.final, 2);
eq('vida após dano', a.system.recursos.vida, 5);
res = applyDamage(a, 6, 'fogo');
eq('dano de fogo ignora absorção cortante (6 − 3 = 3)', res.final, 3);
eq('cruzar 50% da vida dá +1 cansaço', a.system.recursos.cansaco, 1);
res = applyDamage(a, 8, 'contundente');
eq('vida chega a 0 → portas da morte', a.system.recursos.portasDaMorte, true);
eq('excesso vira grau de morte (8−3=5; vida 2 → excesso 3)', a.system.recursos.grauMorte, 3);
eq('0 de vida dá mais +1 cansaço', a.system.recursos.cansaco, 2);
res = applyDamage(a, 5, 'mental');
eq('dano mental usa resistência mental e não tira vida', [res.final, a.system.recursos.vida], [4, 0]);

seq(10, [1, 1, 1]);
const dr = deathRoll(a);
eq('rolagem de morte soma sucessos', a.system.recursos.sucessosMorte, 3);
eq('estabiliza com sucessos ≥ grau', !!a.system.condicoes.estabilizado, true);

// --- pontos de tempo ---
const b = createActor({ system: { dominios: { fortitude: 1, resiliencia: 1, mental: 1, controle: 0 }, atributos: { ritmo: 1 } } });
const cb = { acoes: 0, ptGastos: 0, criticosUsados: 0 };
eq('1ª ação custa 1 + extra 1', spendAction(cb, b, 1).cost, 2);
eq('2ª ação custa 2 + extra 1', spendAction(cb, b, 1).cost, 3);
eq('passou do máximo (3) → 2 críticos', cb.criticosUsados, 2);
processRoundStart(cb, b);
eq('críticos usados → +1 cansaço', b.system.recursos.cansaco, 1);
eq('PT na rodada seguinte: 3 − 1 cansaço − 2 penalidade', prepareDerived(b).pontosTempoMax, 0);
processRoundStart(cb, b);
eq('rodada sem críticos remove penalidade', prepareDerived(b).pontosTempoMax, 2);

b.system.condicoes.sangramento = 2; b.system.recursos.vida = 5;
processRoundStart(cb, b);
eq('sangramento tira vida e reduz 1', [b.system.recursos.vida, b.system.condicoes.sangramento], [3, 1]);

eq('duração: rodadas 1,2,3,5,7', [1, 2, 3, 5, 7].map(roundDurationSeconds), [5, 5, 10, 20, 40]);

b.system.recursos.sanidade = 2; b.system.condicoes.concentracao = 1;
const sm = loseSanity(b, 1);
eq('perder sanidade quebra concentração', !!b.system.condicoes.concentracao, false);

// --- saída ---
const fails = results.filter(x => !x.ok);
document.title = fails.length ? `FALHOU ${fails.length}` : `OK ${results.length}`;
document.getElementById('out').innerHTML = `<p><b>${results.length - fails.length}/${results.length}</b> testes passaram.</p>` +
  results.map(x => `<pre class="${x.ok ? 'ok' : 'fail'}">${x.ok ? '✓' : '✗'} ${x.name}${x.ok ? '' : ` — obtido ${JSON.stringify(x.got)}, esperado ${JSON.stringify(x.exp)}`}</pre>`).join('');
