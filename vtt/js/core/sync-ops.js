// Diferenças e aplicação de operações sobre o estado (sincronização multiplayer).
// O mesmo algoritmo existe em servidor.py (seção "operações"): mantenha os dois iguais.
//
// Operações:
//   { op: 'set', path, value }            define o valor no caminho (path [] = estado inteiro)
//   { op: 'del', path }                   remove a chave / o item
//   { op: 'ins', path, key, value, after } insere item identificado na lista `path`, logo após o item `after` (null = início)
// Segmentos de caminho: string = chave de objeto · número = índice de lista ·
//   { id: 'x' } ou { atorId: 'x' } = item de lista identificado por esse campo.
// Listas cujos itens têm `id` (ou `atorId`) únicos são comparadas por identificador, para que
// duas pessoas adicionando mensagens/tokens ao mesmo tempo não sobrescrevam uma à outra.

const isObj = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const KEYS = ['id', 'atorId'];

/** Cópia no formato que trafega pela rede (JSON). */
export const clone = v => (v === null || typeof v !== 'object') ? norm(v) : JSON.parse(JSON.stringify(v));
/** undefined, NaN e Infinity viram null em JSON. */
const norm = v => (v === undefined || (typeof v === 'number' && !Number.isFinite(v))) ? null : v;

/** Campo identificador comum a todos os itens das listas (ou null). */
export function keyOf(...arrays) {
  const all = arrays.flat();
  if (!all.length) return null;
  for (const k of KEYS) {
    if (all.every(x => isObj(x) && typeof x[k] === 'string')) {
      return arrays.every(arr => new Set(arr.map(x => x[k])).size === arr.length) ? k : null;
    }
  }
  return null;
}

/** Operações que transformam `a` em `b`. */
export function diff(a, b, path = [], out = []) {
  if (a === b) return out;
  if (Array.isArray(a) && Array.isArray(b)) { diffArray(a, b, path, out); return out; }
  if (isObj(a) && isObj(b)) {
    for (const k of Object.keys(a)) {
      if (a[k] !== undefined && (!Object.hasOwn(b, k) || b[k] === undefined)) out.push({ op: 'del', path: [...path, k] });
    }
    for (const k of Object.keys(b)) {
      if (b[k] === undefined) continue;
      if (!Object.hasOwn(a, k) || a[k] === undefined) out.push({ op: 'set', path: [...path, k], value: clone(b[k]) });
      else diff(a[k], b[k], [...path, k], out);
    }
    return out;
  }
  const prim = v => v === null || typeof v !== 'object';
  if (prim(a) && prim(b) && norm(a) === norm(b)) return out;
  out.push({ op: 'set', path, value: clone(b) });
  return out;
}

function diffArray(a, b, path, out) {
  const k = keyOf(a, b);
  if (k) {
    const inA = new Map(a.map(x => [x[k], x])), inB = new Set(b.map(x => x[k]));
    const orderA = a.filter(x => inB.has(x[k])).map(x => x[k]);
    const orderB = b.filter(x => inA.has(x[k])).map(x => x[k]);
    if (orderA.length === orderB.length && orderA.every((id, i) => id === orderB[i])) {
      for (const x of a) if (!inB.has(x[k])) out.push({ op: 'del', path: [...path, { [k]: x[k] }] });
      let prev = null;
      for (const x of b) {
        const id = x[k];
        if (inA.has(id)) diff(inA.get(id), x, [...path, { [k]: id }], out);
        else out.push({ op: 'ins', path, key: k, value: clone(x), after: prev });
        prev = id;
      }
      return;
    }
  } else if (a.length === b.length) {
    for (let i = 0; i < a.length; i++) diff(a[i], b[i], [...path, i], out);
    return;
  }
  out.push({ op: 'set', path, value: clone(b) }); // reordenada ou mudou de tamanho: substitui inteira
}

const findIndex = (arr, seg) => { const [k] = Object.keys(seg); return arr.findIndex(x => isObj(x) && x[k] === seg[k]); };

function child(node, seg) {
  if (node === null || typeof node !== 'object') return undefined;
  if (isObj(seg)) { if (!Array.isArray(node)) return undefined; const i = findIndex(node, seg); return i < 0 ? undefined : node[i]; }
  if (typeof seg === 'number') return Array.isArray(node) ? node[seg] : undefined;
  return isObj(node) ? node[seg] : undefined;
}

/** Aplica operações em `root` (modifica no lugar). Operações cujo caminho não existe mais são ignoradas. */
export function applyOps(root, ops) {
  for (const op of ops) applyOp(root, op);
  return root;
}

function applyOp(root, op) {
  const path = op.path || [];
  if (op.op === 'ins') {
    const arr = path.reduce(child, root);
    if (!Array.isArray(arr) || !isObj(op.value)) return;
    const k = op.key, id = op.value[k];
    const old = arr.findIndex(x => isObj(x) && x[k] === id);
    if (old >= 0) arr.splice(old, 1);
    let at = 0;
    if (op.after != null) { const j = arr.findIndex(x => isObj(x) && x[k] === op.after); at = j < 0 ? arr.length : j + 1; }
    arr.splice(at, 0, clone(op.value));
    return;
  }
  if (!path.length) {
    if (op.op === 'set' && isObj(op.value)) { for (const k of Object.keys(root)) delete root[k]; Object.assign(root, clone(op.value)); }
    return;
  }
  const parent = path.slice(0, -1).reduce(child, root), last = path[path.length - 1];
  if (parent === null || typeof parent !== 'object') return;
  if (isObj(last)) {
    if (!Array.isArray(parent)) return;
    const i = findIndex(parent, last);
    if (op.op === 'del') { if (i >= 0) parent.splice(i, 1); }
    else if (i >= 0) parent[i] = clone(op.value);
    else parent.push(clone(op.value));
    return;
  }
  if (typeof last === 'number') {
    if (!Array.isArray(parent) || !(last >= 0)) return;
    if (op.op === 'del') { if (last < parent.length) parent.splice(last, 1); }
    else if (last <= parent.length) parent[last] = clone(op.value);
    return;
  }
  if (!isObj(parent)) return;
  if (op.op === 'del') delete parent[last];
  else parent[last] = clone(op.value);
}
