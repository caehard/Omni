// Testes das regras do Omni (abrir /vtt/tests/ no navegador via servidor local).
import { loadConfig } from '../js/system/config.js';
import { rollPool, setRandom, applyMaestria, dieForDomain, addHeroicDie, applyVirtue, applyFlaw } from '../js/system/dice.js';
import { createActor, prepareDerived, spentPoints, levelFromPoints } from '../js/system/actor.js';
import { applyDamage, deathRoll, spendAction, processRoundStart, roundDurationSeconds, loseSanity, rest, actionCost } from '../js/system/combat.js';
import { absorptionFor } from '../js/system/actor.js';
import { parseExtra } from '../js/ui/roll-dialog.js';
import { diff, applyOps, clone, keyOf } from '../js/core/sync-ops.js';
import { SyncClient } from '../js/core/sync-client.js';
import { emptyState, migrate, state, local, update, replaceState, setSyncHook, remoteApplied, ownsActor, sheetAccess } from '../js/core/store.js';
import { sanitize } from '../js/ui/chat.js';
import { insideArea, tokensInArea, areaExtent, pathBlocks, tokenVisible, hitDrawing, zoneBlocks, fixedArea } from '../js/ui/layers.js';
import { initHistory, undo, redo, checkpoint } from '../js/core/history.js';
import { blockDistance } from '../js/ui/board.js';
import { traduzir, mencoes, trocarMencoes, montarPedido } from '../js/system/prompt.js';
import { desenharToken } from '../js/ui/token-maker.js';

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
  A.state.cenas[0].tokens.push({ id: 't1', atorId: 'a1', x: 0, y: 0 }); A.flush(); sendAll(srv, A); deliver(srv, A);
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
  A.state.cenas[0].tokens[0].x = 3; A.flush();
  B.state.cenas[0].tokens[0].x = 5; B.flush();
  sendAll(srv, A); sendAll(srv, B);
  B.state.cenas[0].tokens[0].y = 2; // B continua mexendo antes de receber A
  deliver(srv, B);
  eq('B mantém a própria mudança pendente ao receber a de A', B.state.cenas[0].tokens[0].x, 5);
  B.flush(); sendAll(srv, B); deliver(srv, A); deliver(srv, B);
  same('conflito no mesmo campo: A converge', A.state, srv.estado);
  same('conflito no mesmo campo: B converge', B.state, srv.estado);
  eq('conflito no mesmo campo: vale o último recebido pelo servidor', [srv.estado.cenas[0].tokens[0].x, srv.estado.cenas[0].tokens[0].y], [5, 2]);

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

// diff: os mesmos casos que o servidor testa em Python (diff dos dois lados reproduz o estado novo)
const diffCasos = await (await fetch('./diff-casos.json')).json();
for (const c of diffCasos) same(`diff: ${c.nome}`, applyOps(clone(c.a), diff(c.a, c.b)), c.b);

// --- papéis e segurança ---
eq('HTML de mensagem: scripts e eventos somem', sanitize('<b>ok</b><img src=x onerror="alert(1)"><script>alert(2)</script><div class="effect" onclick="x()">d</div>'),
  '<b>ok</b>alert(2)<div class="effect">d</div>');
eq('HTML de mensagem: links viram texto', sanitize('<a href="javascript:x">clique</a>'), 'clique');
{
  const antes = { ...local };
  Object.assign(local, { mestre: false, jogadorId: 'ana' });
  const meu = { tipo: 'personagem', donos: ['ana'] }, outroPj = { tipo: 'personagem' }, npc = { tipo: 'npc' };
  eq('jogador: dono edita a ficha', [ownsActor(meu), sheetAccess(meu)], [true, 'editar']);
  eq('jogador: personagem de outro é só leitura', sheetAccess(outroPj), 'ver');
  eq('jogador: NPC fica fechado por padrão', sheetAccess(npc), 'nenhum');
  eq('jogador: mestre pode liberar a ficha do NPC', sheetAccess({ ...npc, permissao: 'ver' }), 'ver');
  local.mestre = true;
  eq('mestre edita tudo', sheetAccess(npc), 'editar');
  Object.assign(local, antes);
}

// --- cenas e tokens ---
{
  const velha = { versao: 1, atores: [], cena: { fundo: 'x', tamanhoQuadrado: 40, colunas: 10, linhas: 8, tokens: [{ id: 't', atorId: 'a', x: 1, y: 1 }], alvoId: 'a' }, chat: [] };
  const m = migrate(structuredClone(velha));
  eq('mesa antiga: vira uma cena só', [m.cenas.length, m.cenas[0].fundo, m.cenas[0].tokens.length, m.cenas[0].colunas], [1, 'x', 1, 10]);
  eq('mesa antiga: cena ativa definida e campos antigos removidos', [m.cenaAtiva === m.cenas[0].id, 'cena' in m, 'alvoId' in m.cenas[0]], [true, false, false]);
  eq('migrar de novo não muda nada', canon(migrate(structuredClone(m))), canon(m));
}
eq('distância: tokens 1×1 vizinhos de bloco', blockDistance({ x: 0, y: 0 }, { x: 2, y: 0 }), 1);
eq('distância: token 2×2 conta da borda', blockDistance({ x: 0, y: 0, tamanho: 2 }, { x: 2, y: 0 }), 1);
eq('distância: token 4×4 encostado = mesmo bloco (Curto)', blockDistance({ x: 0, y: 0, tamanho: 4 }, { x: 3, y: 3 }), 0);
eq('distância: token 4×4 até 2 blocos à direita', blockDistance({ x: 0, y: 0, tamanho: 4 }, { x: 6, y: 1 }), 2);

// --- áreas de efeito, régua e névoa ---
{
  const tok = (x, y, tamanho = 1) => ({ id: `${x},${y}`, x, y, tamanho });
  const circ = { forma: 'circulo', a: { x: 5.5, y: 5.5 }, b: { x: 7.5, y: 5.5 } }; // raio 2 quadrados
  eq('círculo: atinge quem tem o centro dentro', tokensInArea(circ, [tok(5, 5), tok(7, 5), tok(8, 5), tok(6, 6), tok(6, 7)]).map(t => t.id), ['5,5', '7,5', '6,6']);
  eq('círculo: token grande atingido pela ponta', tokensInArea(circ, [tok(8, 4, 2)]).length, 0);
  eq('círculo: token grande com um quadrado dentro', tokensInArea(circ, [tok(7, 4, 2)]).length, 1);
  const cone = { forma: 'cone', a: { x: 0.5, y: 0.5 }, b: { x: 6.5, y: 0.5 } }; // 45° no total
  eq('cone: em frente, dentro do alcance', [insideArea(cone, { x: 5.5, y: 0.5 }), insideArea(cone, { x: 5.5, y: 2.5 })], [true, true]);
  eq('cone: fora dos 22,5° de cada lado e além do alcance', [insideArea(cone, { x: 3.5, y: 3.5 }), insideArea(cone, { x: 7.5, y: 0.5 }), insideArea(cone, { x: -1.5, y: 0.5 })], [false, false, false]);
  const linha = { forma: 'linha', a: { x: 0.5, y: 0.5 }, b: { x: 0.5, y: 6.5 } };
  eq('linha: um quadrado de largura', [insideArea(linha, { x: 0.5, y: 3.5 }), insideArea(linha, { x: 1.5, y: 3.5 })], [true, false]);
  eq('quadrado: lado pelo maior deslocamento', [insideArea({ forma: 'quadrado', a: { x: 4.5, y: 4.5 }, b: { x: 6.5, y: 5.5 } }, { x: 2.5, y: 6.5 })], [true]);
  eq('área: tamanho medido como a régua (diâmetro 4 quadrados = 2 blocos)', areaExtent(circ), 2);
  // D37: tamanho em zona = limite de cima (as pontas ficam N blocos distantes)
  eq('zona → blocos pelo limite de cima', ['C', 'D', 'L', 'ML', 'EL'].map(zoneBlocks), [0, 1, 3, 7, 15]);
  const cL = { forma: 'circulo', ...fixedArea('circulo', 'L', { x: 9.3, y: 8.6 }) };
  eq('círculo diâmetro L: 4 blocos, centro num canto de bloco', [cL.a, cL.b.x - cL.a.x, areaExtent(cL)], [{ x: 10, y: 8 }, 4, 3]);
  const qC = { forma: 'quadrado', ...fixedArea('quadrado', 'C', { x: 4.2, y: 4.9 }) };
  const qCatinge = [];
  for (let x = 0; x < 8; x++) for (let y = 0; y < 8; y++) if (insideArea(qC, { x: x + 0.5, y: y + 0.5 })) qCatinge.push(`${x},${y}`);
  eq('quadrado lado C: exatamente um bloco', qCatinge, ['4,4', '4,5', '5,4', '5,5']);
  const qD = { forma: 'quadrado', ...fixedArea('quadrado', 'D', { x: 4.6, y: 4.6 }) };
  eq('quadrado lado D: 2×2 blocos alinhados', [qD.a, [{ x: 1.5, y: 1.5 }, { x: 2.5, y: 4.5 }, { x: 5.5, y: 5.5 }].map(p => insideArea(qD, p))], [{ x: 4, y: 4 }, [false, true, true]]);
  const lL = { forma: 'linha', ...fixedArea('linha', 'L', { x: 0.7, y: 0.4 }, { x: 20.7, y: 0.4 }) };
  const lLatinge = [];
  for (let x = 0; x < 12; x++) for (let y = 0; y < 4; y++) if (insideArea(lL, { x: x + 0.5, y: y + 0.5 })) lLatinge.push(`${x},${y}`);
  eq('linha distância L: uma fileira de 4 blocos inteiros a partir do bloco clicado', [lL.a, lL.b, areaExtent(lL), lLatinge.length, lLatinge.includes('0,0'), lLatinge.includes('7,1'), lLatinge.includes('8,0')], [{ x: 0, y: 1 }, { x: 8, y: 1 }, 3, 16, true, true, false]);
  const coneD = { forma: 'cone', ...fixedArea('cone', 'D', { x: 2.2, y: 2.2 }, { x: 2.2, y: 2.2 }) };
  eq('cone sem arrasto aponta para a direita, altura D', [coneD.a, coneD.b, insideArea(coneD, { x: 5.5, y: 3.5 }), insideArea(coneD, { x: 6.5, y: 3.5 })], [{ x: 3, y: 3 }, { x: 6, y: 3 }, true, false]);
  eq('régua com vários pontos soma os trechos', pathBlocks([{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 6 }]), 5);
  const nv = { ativa: true, revelado: { '3,3': 1 } };
  eq('névoa: token só aparece com algum quadrado revelado', [tokenVisible(nv, tok(3, 3)), tokenVisible(nv, tok(2, 2, 2)), tokenVisible(nv, tok(5, 5)), tokenVisible({ ativa: false }, tok(5, 5))], [true, true, false, true]);
  eq('borracha acerta a linha perto e erra longe', [hitDrawing({ tipo: 'linha', a: { x: 0, y: 0 }, b: { x: 4, y: 0 } }, { x: 2, y: 0.2 }), hitDrawing({ tipo: 'linha', a: { x: 0, y: 0 }, b: { x: 4, y: 0 } }, { x: 2, y: 1 })], [true, false]);
  eq('borracha no desenho livre', hitDrawing({ tipo: 'livre', pts: [0, 0, 1, 1, 2, 1] }, { x: 1.5, y: 1.1 }), true);
}

// --- gerador de imagens: texto do pedido ---
{
  const cal = (await import('../js/system/config.js')).CONFIG.gerador;
  eq('glossário: português vira inglês, nomes ficam', traduzir('Taverna escura com lareira acesa, Valdric e mesas de madeira', cal.glossario),
    'tavern dark with fireplace lit, Valdric and tables wooden');
  eq('glossário: expressões primeiro e plural/feminino', traduzir('elfa arqueira de cabelo prateado no pôr do sol. Floresta sombria', cal.glossario),
    'elf woman archer hair silver in sunset, dark forest');
  eq('glossário: plural de substantivo, adjetivo não', traduzir('elfas guerreiras, lobos cinzentos e ruínas antigas', cal.glossario), 'elf women warriors, wolves grey and ruins ancient');
  const pers = [{ id: 'p1', nome: 'Aria', url: '/a.png', descricao: 'elfa de capa verde.' }, { id: 'p2', nome: 'Bandido Caolho', url: '/b.png' }, { id: 'p3', nome: 'Ari', url: '/c.png' }];
  eq('menções: @Nome com espaço, sem confundir Ari com Aria', mencoes('@Aria luta com @bandido caolho e @Ari; e-mail@x', pers).map(p => p.id), ['p1', 'p2', 'p3']);
  eq('trocar menções', trocarMencoes('@Aria e @Bandido Caolho', pers, p => `[${p.id}]`), '[p1] e [p2]');
  const cen = montarPedido({ modo: 'cenario', texto: 'taverna escura', estilo: 'aquarela', quantidade: 2 }, cal);
  eq('cenário: SDXL em paisagem com o texto-base', [cen.pedido.modelo, cen.pedido.largura, cen.pedido.altura, cen.pedido.quantidade, cen.pedido.positivo.startsWith('fantasy environment concept art, wide establishing shot of tavern dark'), /watercolor/.test(cen.pedido.positivo), /people/.test(cen.pedido.negativo)],
    ['sdxl', 1344, 768, 2, true, true, true]);
  const mapa = montarPedido({ modo: 'cenario', enquadramento: 'mapa', texto: 'masmorra' }, cal);
  eq('cenário › mapa visto de cima: quadrado e vista de cima', [mapa.pedido.largura, mapa.pedido.altura, /top-down battle map/.test(mapa.pedido.positivo)], [1024, 1024, true]);
  const per = montarPedido({ modo: 'personagem', texto: 'anão ferreiro', nome: 'Borin' }, cal);
  eq('personagem: retrato, vira item "personagem" com a aparência', [per.pedido.modelo, per.pedido.altura > per.pedido.largura, per.item.tipo, per.item.nome, per.item.descricao, /plain light grey background/.test(per.pedido.positivo)],
    ['sdxl', true, 'personagem', 'Borin', 'anão ferreiro', true]);
  const sem = montarPedido({ modo: 'cena', texto: 'uma batalha', personagens: pers }, cal);
  eq('cena sem referência: usa o SDXL', sem.pedido.modelo, 'sdxl');
  const cena = montarPedido({ modo: 'cena', texto: '@Aria enfrenta @Bandido Caolho na ponte', personagens: pers, cenarioRef: { id: 'i1', nome: 'Ponte', url: '/p.png' } }, cal);
  eq('cena com @: Qwen, refs na ordem e cenário por último', [cena.pedido.modelo, cena.pedido.refs, cena.pedido.passos, cena.pedido.cfg], ['qwen', ['/a.png', '/b.png', '/p.png'], 4, 1]);
  eq('cena com @: o texto cita cada imagem', [/Picture 1 shows Aria \(elfa de capa verde\)/.test(cena.pedido.positivo), /Bandido Caolho \(the character in Picture 2\)/.test(cena.pedido.positivo),
    /Picture 3 shows the location/.test(cena.pedido.positivo), /Keep each character's face/.test(cena.pedido.positivo)], [true, true, true, true]);
  const muitos = montarPedido({ modo: 'cena', texto: '@Aria @Ari @Bandido Caolho', personagens: pers, cenarioRef: { id: 'i1', url: '/p.png' } }, cal);
  eq('cena: no máximo 3 imagens (2 personagens + cenário)', [muitos.pedido.refs.length, muitos.avisos.length], [3, 1]);
  eq('texto final editado à mão vale', montarPedido({ modo: 'cenario', texto: 'x', positivoFinal: 'my own prompt' }, cal).pedido.positivo, 'my own prompt');
  eq('semente fixa', montarPedido({ modo: 'cenario', texto: 'x', semente: '42' }, cal).pedido.semente, 42);
}

// --- criação de token ---
{
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const ctx = c.getContext('2d');
  const img = document.createElement('canvas'); img.width = 40; img.height = 80;
  const ic = img.getContext('2d'); ic.fillStyle = '#00ff00'; ic.fillRect(0, 0, 40, 80);
  Object.assign(img, { naturalWidth: 40, naturalHeight: 80 }); // como se fosse uma <img> carregada
  desenharToken(ctx, 128, img, { forma: 'circulo', estilo: 'ornada', cor: 'ouro', espessura: 0.08, zoom: 1, dx: 0, dy: 0, fundo: '#000' });
  const px = (x, y) => [...ctx.getImageData(x, y, 1, 1).data];
  eq('token: centro mostra a imagem', px(64, 64).slice(0, 3), [0, 255, 0]);
  eq('token: canto fica transparente (fora do círculo)', px(2, 2)[3], 0);
  const borda = px(64, 3);
  eq('token: a borda é opaca e dourada', [borda[3], borda[0] > borda[2]], [255, true]);
}

// --- desfazer / refazer ---
{
  setSyncHook(() => {}); // não salvar nada no navegador durante os testes
  replaceState(emptyState());
  initHistory();
  const sc = () => state.cenas[0];
  update(() => sc().tokens.push({ id: 'h1', atorId: 'a', x: 0, y: 0, tamanho: 1 })); checkpoint();
  update(() => { sc().tokens[0].x = 5; }); checkpoint();
  update(() => state.chat.push({ id: 'c1', texto: 'rolagem' }));
  // mudança de outro jogador: não entra no meu desfazer
  const remota = [{ op: 'set', path: ['regras', 'remota'], value: true }];
  applyOps(state, remota); remoteApplied(remota);
  undo();
  eq('desfazer: volta a posição do token', sc().tokens[0]?.x, 0);
  undo();
  eq('desfazer de novo: remove o token adicionado', sc().tokens.length, 0);
  eq('desfazer não apaga o chat', state.chat.length, 1);
  eq('desfazer não mexe no que outro jogador mudou', state.regras.remota, true);
  eq('nada mais para desfazer', undo(), false);
  redo(); redo();
  eq('refazer: token volta na posição nova', [sc().tokens.length, sc().tokens[0]?.x], [1, 5]);
  update(() => { sc().tokens[0].y = 3; });
  eq('mudança nova limpa o refazer', redo(), false);
  update(() => { sc().tokens[0].y = 4; }); // junta com a anterior (digitação/arrasto seguidos)
  undo();
  eq('mudanças seguidas viram um passo só', sc().tokens[0].y, 0);
}

// --- saída ---
const fails = results.filter(x => !x.ok);
document.title = fails.length ? `FALHOU ${fails.length}` : `OK ${results.length}`;
document.getElementById('out').innerHTML = `<p><b>${results.length - fails.length}/${results.length}</b> testes passaram.</p>` +
  results.map(x => `<pre class="${x.ok ? 'ok' : 'fail'}">${x.ok ? '✓' : '✗'} ${x.name}${x.ok ? '' : ` — obtido ${JSON.stringify(x.got)}, esperado ${JSON.stringify(x.exp)}`}</pre>`).join('');
