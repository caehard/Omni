// Mesa de exemplo criada no primeiro acesso.
import { state, scene } from './core/store.js';
import { createActor, uid } from './system/actor.js';

export function seedDemo() {
  const pj = createActor({
    nome: 'Aria Valen', cor: '#2f6690',
    system: {
      progressao: { inicial: 30, ganhos: 0 },
      dados: { idade: '24', idiomaNativo: 'Comum' },
      dominios: { fortitude: 2, resiliencia: 1, mental: 1, controle: 0 },
      atributos: { forca: 1, destreza: 2, vitalidade: 1, ritmo: 1, raciocinio: 0, instinto: 1, potencia: 0, reserva: 0 },
      determinacao: 'instinto',
      aptidoes: [
        { id: 'idiomas', especializacao: 'Comum', nivel: 3, nativo: true },
        { id: 'armamento', especializacao: 'Espadas', nivel: 2 },
        { id: 'acrobacia', especializacao: '', nivel: 1 },
        { id: 'percepcao', especializacao: '', nivel: 1 },
      ],
      virtudes: [{ nome: 'Lealdade', usada: false }],
      falhas: [{ nome: 'Impulsividade', usada: false }],
      habilidades: [{ ref: 'humana-postura-de-combate', nivel: 1 }],
      armas: [{ nome: 'Espada Longa', ref: 'espada-longa', atributo: 'forca', aptIndex: 1, aptExigida: 1, impacto: 2, brutal: 2, letal: 2, bloqueio: 0, manuseio: 2, tempoExtra: 1, dano: 'cortante', palavrasChave: 'Alcance distante' }],
      inventario: [{ nome: 'Mochila', quantidade: 1, slots: 2 }, { nome: 'Kit de primeiros socorros (comum)', quantidade: 1, slots: 1 }],
      armaduras: [{ nome: 'Couraça de Couro', ref: 'couraca-de-couro', peso: 'leve', imobilidade: 1, absorcao: { cortante: 7, contundente: 7, perfurante: 7, lacerante: 7 }, equipada: true }],
    },
  });
  const npc = createActor({
    nome: 'Bandido', tipo: 'npc', cor: '#b23a48',
    system: {
      dominios: { fortitude: 1, resiliencia: 1, mental: 0, controle: 0 },
      atributos: { forca: 1, destreza: 1, vitalidade: 1, ritmo: 0, raciocinio: 0, instinto: 1, potencia: 0, reserva: 0 },
      aptidoes: [{ id: 'armamento', especializacao: 'Adagas', nivel: 1 }],
      armas: [{ nome: 'Adaga', ref: 'adaga', atributo: 'destreza', aptIndex: 0, aptExigida: 0, impacto: 1, brutal: 0, letal: 2, bloqueio: 0, manuseio: 1, tempoExtra: 1, dano: 'perfurante', palavrasChave: 'Alcance curto' }],
    },
  });
  state.atores.push(pj, npc);
  scene().tokens.push({ id: uid(), atorId: pj.id, x: 4, y: 6, tamanho: 1 }, { id: uid(), atorId: npc.id, x: 10, y: 7, tamanho: 1 });
  state.chat.push({ id: uid(), ts: Date.now(), tipo: 'sistema', autor: 'Omni',
    html: 'Bem-vindo ao TTS do <b>Omni</b>! Esta é uma mesa de exemplo. Clique em <b>?</b> para ver os atalhos.' });
}
