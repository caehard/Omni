// Estado central do TTS. Toda alteração passa por update() para que a interface
// (e, no futuro, a sincronização em rede) reaja num único ponto.
const KEY = 'omni-vtt-estado-v1';
const listeners = new Set();

export const state = {
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

export function subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }

let saveTimer = null;
export function update(mutator, { silent = false } = {}) {
  mutator?.(state);
  if (!silent) for (const fn of listeners) fn(state);
  clearTimeout(saveTimer);
  saveTimer = setTimeout(save, 250);
}

export function save() {
  try { localStorage.setItem(KEY, JSON.stringify(state)); }
  catch (e) { console.warn('Não foi possível salvar no navegador:', e); }
}

export function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) Object.assign(state, JSON.parse(raw));
    return !!raw;
  } catch (e) { console.warn('Falha ao carregar estado salvo:', e); return false; }
}

export function replaceState(obj) {
  for (const k of Object.keys(state)) delete state[k];
  Object.assign(state, obj);
  update();
}

export const getActor = id => state.atores.find(a => a.id === id);
