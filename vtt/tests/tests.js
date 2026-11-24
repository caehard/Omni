// Testes das regras do Omni (abrir /vtt/tests/ no navegador via servidor local).
import { loadConfig } from '../js/system/config.js';
import { rollPool, setRandom, applyMaestria, dieForDomain, addHeroicDie, applyVirtue, applyFlaw } from '../js/system/dice.js';
import { createActor, prepareDerived, spentPoints, levelFromPoints } from '../js/system/actor.js';
import { applyDamage, deathRoll, spendAction, processRoundStart, roundDurationSeconds, loseSanity, rest, actionCost } from '../js/system/combat.js';
import { absorptionFor } from '../js/system/actor.js';
import { parseExtra } from '../js/ui/roll-dialog.js';
import { diff, applyOps, clone, keyOf } from '../js/core/sync-ops.js';
import { SyncClient } from '../js/core/sync-client.js';
import { emptyState } from '../js/core/store.js';

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

// --- armaduras (valor fixo) ---
const c = createActor({ system: { dominios: { fortitude: 1, resiliencia: 1, mental: 1, controle: 0 } } });
c.system.absorcao.cortante = 2;
c.system.armaduras = [{ nome: 'Couraça', peso: 'leve', imobilidade: 1, absorcao: { cortante: 7, perfurante: 7 }, equipada: true }];
eq('armadura substitui absorção menor (7 > 2)', absorptionFor(c, 'cortante'), 7);
eq('armadura não cobre fogo', absorptionFor(c, 'fogo'), 0);
eq('imobilidade da armadura', prepareDerived(c).imobilidade, 1);
c.system.armaduras[0].equipada = false;
eq('armadura desequipada não conta', absorptionFor(c, 'cortante'), 2);

// --- recuperação ---
const e = createActor({ system: { dominios: { fortitude: 1, resiliencia: 2, mental: 1, controle: 0 }, atributos: { vitalidade: 3, raciocinio: 3 } } });
let dm = prepareDerived(e); // vida 9, sanidade 4
e.system.recursos.vida = 3; e.system.recursos.sanidade = 4;
rest(e, 'curta');
eq('curta em estado grave: +1 vida', e.system.recursos.vida, 4);
e.system.recursos.vida = 6; rest(e, 'curta');
eq('curta em estado leve: +3 vida', e.system.recursos.vida, 9);
e.system.recursos.vida = 0; e.system.recursos.portasDaMorte = true; rest(e, 'curta');
eq('curta em estado letal: não recupera', e.system.recursos.vida, 0);
e.system.recursos.portasDaMorte = false; e.system.recursos.vida = 3; rest(e, 'rapida');
eq('rápida em estado grave: não recupera', e.system.recursos.vida, 3);
e.system.recursos.vida = 7; e.system.recursos.cansaco = 2; rest(e, 'rapida');
eq('rápida em leve: +1 vida e −1 cansaço', [e.system.recursos.vida, e.system.recursos.cansaco], [8, 1]);
e.system.recursos.cansaco = 4; rest(e, 'curta');
eq('curta: cansaço 4 → 3', e.system.recursos.cansaco, 3);

// --- Grande Guerreiro e Mente de Ferro ---
const g = createActor({ system: { dominios: { fortitude: 1, resiliencia: 1, mental: 1, controle: 0 }, atributos: { ritmo: 2 } } });
g.system.recursos.cansaco = 5;
g.system.habilidades.push({ ref: 'humana-grande-guerreiro', nivel: 4 });
eq('Grande Guerreiro ignora redução de PT do cansaço', prepareDerived(g).pontosTempoMax, 4);
eq('Grande Guerreiro ignora Atordoado do cansaço 5', actionCost({ acoes: 0 }, g), 1);
g.system.habilidades.push({ ref: 'fator-mente-de-ferro' });
g.system.recursos.sanidade = 1;
const mf = loseSanity(g, 3);
eq('Mente de Ferro perde 1 a menos', g.system.recursos.sanidade, -1);

// --- Extra ---
eq('Extra(2) sem dado usa o dado do domínio', parseExtra('2', 8), [{ count: 2, faces: 8 }]);
eq('Extra(2d4) usa o dado indicado', parseExtra('2d4', 8), [{ count: 2, faces: 4 }]);
eq('Extras combinados', parseExtra('1d6 + 2', 10), [{ count: 1, faces: 6 }, { count: 2, faces: 10 }]);

// --- sincronização multiplayer ---
const canon = v => JSON.stringify(v, (k, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.keys(x).sort().map(c => [c, x[c]])) : x));
const same = (name, got, exp) => results.push({ name, ok: canon(got) === canon(exp), got, exp });

// casos compartilhados com o servidor (tools/testar_servidor.py roda os mesmos em Python)
const casos = await (await fetch('./sync-casos.json')).json();
for (const c of casos) same(`sync: ${c.nome}`, applyOps(clone(c.inicial), c.ops), c.esperado);

// diff + apply reproduz o estado novo
{
  const a = createActor({ nome: 'A' }), b = structuredClone(a);
  b.nome = 'B'; b.system.recursos.vida = 3; b.system.aptidoes.push({ id: 'atletismo', especializacao: '', nivel: 2 }); delete b.system.dados;
  const pares = [
    [{ atores: [a], chat: [] }, { atores: [b], chat: [{ id: 'm1', texto: 'oi' }] }],
    [{ l: [{ id: 'x' }, { id: 'y' }, { id: 'z' }] }, { l: [{ id: 'z' }, { id: 'x' }] }],          // reordenada: substitui
    [{ l: [{ id: 'x', v: 1 }, { id: 'y' }] }, { l: [{ id: 'w' }, { id: 'x', v: 2 }, { id: 'q' }] }],
    [{ l: [1, 2, 3] }, { l: [1, 5, 3, 4] }], [{ l: [{ v: 1 }, { v: 2 }] }, { l: [{ v: 1 }, { v: 3 }] }],
    [{ x: 1, y: { z: [] } }, { x: null, y: 'texto' }],
  ];
  pares.forEach(([x, y], i) => same(`diff+apply par ${i + 1}`, applyOps(clone(x), diff(x, y)), y));
  eq('sem mudança, sem operação', diff(clone(pares[0][1]), clone(pares[0][1])).length, 0);
  const ops = diff({ cena: { tokens: [{ id: 't', x: 1, y: 1 }] } }, { cena: { tokens: [{ id: 't', x: 4, y: 1 }] } });
  eq('mover token gera uma operação só no campo x', ops, [{ op: 'set', path: ['cena', 'tokens', { id: 't' }, 'x'], value: 4 }]);
  eq('mensagem nova no chat vira inserção identificada', diff({ chat: [{ id: 'a' }] }, { chat: [{ id: 'a' }, { id: 'b' }] })[0].op, 'ins');
  eq('ids repetidos: lista tratada por posição', keyOf([{ id: 'x' }, { id: 'x' }]), null);
}

// simulação de servidor + clientes (mesma regra do servidor.py)
function simServer() { return { estado: null, v: 0, lotes: {}, log: [] }; }
function srvReceive(srv, cliente, b) {
  if (b.lote <= (srv.lotes[cliente] || 0)) return;
  srv.lotes[cliente] = b.lote;
  for (const op of b.ops) {
    if (srv.estado == null) { if (op.op === 'set' && !op.path.length) srv.estado = clone(op.value); continue; }
    applyOps(srv.estado, [op]);
  }
  b.enviado = true;
  srv.log.push({ tipo: 'ops', v: ++srv.v, origem: cliente, lote: b.lote, ops: clone(b.ops) });
}
const sendAll = (srv, c) => { let b; while ((b = c.nextUnsent())) srvReceive(srv, c.cliente, b); };
const deliver = (srv, c) => { while (c.v < srv.v) c.receive(srv.log[c.v]); };
const join = (srv, cliente) => { const c = new SyncClient({}, cliente); c.start({ v: srv.v, estado: srv.estado }); return c; };
{
  const srv = simServer();
  const A = new SyncClient(emptyState(), 'A');
  eq('mesa nova: cliente envia o estado inicial', A.start({ v: 0, estado: null }), false);
  sendAll(srv, A); deliver(srv, A);
  A.state.cena.tokens.push({ id: 't1', atorId: 'a1', x: 0, y: 0 }); A.flush(); sendAll(srv, A); deliver(srv, A);
  const B = join(srv, 'B');
  same('quem entra recebe a mesa', B.state, A.state);

  // os dois escrevem no chat ao mesmo tempo; o servidor recebe B antes de A
  A.state.chat.push({ id: 'mA', texto: 'oi' }); A.flush();
  B.state.chat.push({ id: 'mB', texto: 'olá' }); B.flush();
  sendAll(srv, B); sendAll(srv, A);
  deliver(srv, A); deliver(srv, B);
  eq('mensagens simultâneas: nenhuma se perde', srv.estado.chat.map(m => m.id).sort(), ['mA', 'mB']);
  same('mensagens simultâneas: A igual ao servidor', A.state, srv.estado);
  same('mensagens simultâneas: B igual ao servidor', B.state, srv.estado);

  // mesmo campo: o último que chega ao servidor vale para todos
  A.state.cena.tokens[0].x = 3; A.flush();
  B.state.cena.tokens[0].x = 5; B.flush();
  sendAll(srv, A); sendAll(srv, B);
  B.state.cena.tokens[0].y = 2; // B continua mexendo antes de receber A
  deliver(srv, B);
  eq('B mantém a própria mudança pendente ao receber a de A', B.state.cena.tokens[0].x, 5);
  B.flush(); sendAll(srv, B); deliver(srv, A); deliver(srv, B);
  same('conflito no mesmo campo: A converge', A.state, srv.estado);
  same('conflito no mesmo campo: B converge', B.state, srv.estado);
  eq('conflito no mesmo campo: vale o último recebido pelo servidor', [srv.estado.cena.tokens[0].x, srv.estado.cena.tokens[0].y], [5, 2]);

  // lote devolvido só sai da fila; reenvio duplicado é ignorado pelo servidor
  A.state.regras.teste = true; const lote = A.flush();
  srvReceive(srv, 'A', lote); srvReceive(srv, 'A', { ...lote });
  deliver(srv, A); deliver(srv, B);
  eq('reenvio do mesmo lote não duplica', srv.log.filter(m => m.origem === 'A' && m.lote === lote.lote).length, 1);
  eq('lote devolvido sai dos pendentes', A.pending.length, 0);

  // reconexão: o servidor já tinha recebido o lote, mas a devolução se perdeu
  B.state.atores.push({ id: 'n1', nome: 'NPC' }); const lb = B.flush(); srvReceive(srv, 'B', lb);
  B.state.atores[0].nome = 'NPC 2'; B.flush(); // ainda não enviado
  B.resync({ v: srv.v, estado: clone(srv.estado), lote: srv.lotes.B });
  eq('reconexão: lote já recebido sai dos pendentes', B.pending.map(b => b.lote), [lb.lote + 1]);
  eq('reconexão: mudança não enviada continua na tela', B.state.atores[0].nome, 'NPC 2');
  sendAll(srv, B); deliver(srv, A); deliver(srv, B);
  same('reconexão: A converge', A.state, srv.estado);
  same('reconexão: B converge', B.state, srv.estado);
  eq('mensagem fora de ordem pede o estado inteiro', A.receive({ tipo: 'ops', v: A.v + 2, ops: [] }), 'lacuna');
}

// --- saída ---
const fails = results.filter(x => !x.ok);
document.title = fails.length ? `FALHOU ${fails.length}` : `OK ${results.length}`;
document.getElementById('out').innerHTML = `<p><b>${results.length - fails.length}/${results.length}</b> testes passaram.</p>` +
  results.map(x => `<pre class="${x.ok ? 'ok' : 'fail'}">${x.ok ? '✓' : '✗'} ${x.name}${x.ok ? '' : ` — obtido ${JSON.stringify(x.got)}, esperado ${JSON.stringify(x.exp)}`}</pre>`).join('');
