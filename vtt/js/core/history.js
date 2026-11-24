// Desfazer/refazer (Ctrl+Z / Ctrl+Y) das mudanças feitas por este jogador.
// Guarda uma cópia de referência do estado; a cada update() local registra as operações que o
// desfazem (diff do estado novo para a cópia). Mudanças de outros jogadores atualizam a cópia sem
// entrar no histórico, então desfazer só mexe no que você mudou. O chat não entra (rolagens ficam).
import { state, update, onLocalUpdate, onRemoteUpdate } from './store.js';
import { diff, applyOps, clone } from './sync-ops.js';

const LIMITE = 100;          // passos guardados
const JUNTAR_MS = 700;       // mudanças seguidas (digitação, arrasto) viram um passo só
const IGNORAR = new Set(['chat']);

let base = null, undoStack = [], redoStack = [], lastAt = 0;

const relevant = ops => ops.filter(op => !IGNORAR.has(op.path?.[0]));

export function initHistory() {
  base = clone(state);
  onLocalUpdate(record);
  onRemoteUpdate(ops => { if (!base || ops === null) base = clone(state); else applyOps(base, ops); });
}

function record({ historico } = {}) {
  if (!base) return;
  const back = relevant(diff(state, base));   // volta ao estado anterior
  applyOps(base, diff(base, state));           // a cópia acompanha o estado
  if (historico === false || !back.length) return;
  if (historico === 'desfazer') { redoStack.push({ ops: back }); lastAt = 0; return; }
  const now = Date.now();
  const last = undoStack[undoStack.length - 1];
  if (historico !== 'refazer' && last && now - lastAt < JUNTAR_MS && !last.fechado) last.ops = [...back, ...last.ops];
  else undoStack.push({ ops: back, fechado: historico === 'refazer' });
  if (undoStack.length > LIMITE) undoStack.shift();
  if (historico !== 'refazer') redoStack = [];
  lastAt = now;
}

/** Encerra o passo atual (o próximo update vira um passo novo). */
export function checkpoint() { const last = undoStack[undoStack.length - 1]; if (last) last.fechado = true; }

export function undo() {
  const step = undoStack.pop();
  if (!step) return false;
  update(s => applyOps(s, step.ops), { historico: 'desfazer' });
  return true;
}

export function redo() {
  const step = redoStack.pop();
  if (!step) return false;
  update(s => applyOps(s, step.ops), { historico: 'refazer' });
  return true;
}

export const canUndo = () => undoStack.length > 0;
export const canRedo = () => redoStack.length > 0;
