// Estado central do TTS. Toda alteração passa por update() para que a interface
// e a sincronização em rede (core/net.js) reajam num único ponto.
const KEY = 'omni-vtt-estado-v1';
const listeners = new Set();

/** Estado vazio de uma mesa. */
export function emptyState() {
  return {
    versao: 1,
    atores: [],                     // fichas (personagens e NPCs)
    cena: {
      fundo: '',                    // dataURL da imagem do mapa
      tamanhoQuadrado: 48,          // px por quadrado (bloco = 2×2 quadrados)
      colunas: 40, linhas: 28,
      tokens: [],                   // { id, atorId, x, y } em quadrados
    },
    combate: { ativo: false, rodada: 0, combatentes: [] }, // { atorId, acoes, ptGastos, criticosUsados }
    chat: [],                       // mensagens
    regras: {},                     // regras opcionais ligadas/desligadas
  };
}

/** Estado compartilhado da mesa (sincronizado entre os jogadores quando há servidor). */
export const state = emptyState();

/** Estado só deste navegador/aba (não é sincronizado): alvo marcado etc. */
export const local = { alvoId: null };

let syncHook = null;
/** Liga a sincronização em rede: `fn` é chamada após cada update(); a mesa deixa de ser salva no navegador. */
export function setSyncHook(fn) { syncHook = fn; }
export const isOnline = () => !!syncHook;

export function subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }
export function notify() { for (const fn of listeners) fn(state); }

let saveTimer = null;
export function update(mutator, { silent = false } = {}) {
  mutator?.(state);
  if (!silent) notify();
  if (syncHook) { syncHook(); return; }
  clearTimeout(saveTimer);
  saveTimer = setTimeout(save, 250);
}

export function save() {
  if (syncHook) return;
  try { localStorage.setItem(KEY, JSON.stringify(state)); }
  catch (e) { console.warn('Não foi possível salvar no navegador:', e); }
}

/** Mesa salva neste navegador (modo local), ou null. */
export function readLocalSave() {
  try { const raw = localStorage.getItem(KEY); return raw ? JSON.parse(raw) : null; }
  catch (e) { console.warn('Falha ao ler o estado salvo:', e); return null; }
}

export function load() {
  const saved = readLocalSave();
  if (saved) Object.assign(state, saved);
  return !!saved;
}

export function replaceState(obj) {
  for (const k of Object.keys(state)) delete state[k];
  Object.assign(state, obj);
  update();
}

export const getActor = id => state.atores.find(a => a.id === id);
