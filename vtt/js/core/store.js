// Estado central do TTS. Toda alteração passa por update() para que a interface
// e a sincronização em rede (core/net.js) reajam num único ponto.
const KEY = 'omni-vtt-estado-v1';
const listeners = new Set();

export const newId = () => Math.random().toString(36).slice(2, 10);

/** Cena vazia. */
export function emptyScene(nome = 'Cena 1') {
  return {
    id: newId(), nome,
    fundo: '',                      // dataURL da imagem do mapa
    tamanhoQuadrado: 48,            // px por quadrado (bloco = 2×2 quadrados)
    colunas: 40, linhas: 28,
    tokens: [],                     // { id, atorId, x, y, tamanho } — posição e tamanho em quadrados
  };
}

/** Estado vazio de uma mesa. */
export function emptyState() {
  const cena = emptyScene();
  return {
    versao: 2,
    atores: [],                     // fichas (personagens e NPCs)
    cenas: [cena],
    cenaAtiva: cena.id,             // onde os jogadores estão
    combate: { ativo: false, rodada: 0, combatentes: [] }, // { atorId, acoes, ptGastos, criticosUsados }
    chat: [],                       // mensagens
    regras: {},                     // regras opcionais ligadas/desligadas
  };
}

/** Converte mesas antigas (versão 1: uma `cena` só) para o formato atual. Modifica no lugar. */
export function migrate(s) {
  if (!Array.isArray(s.cenas)) {
    const antiga = s.cena || {};
    delete antiga.alvoId; // o alvo agora é de cada jogador (local.alvoId)
    const cena = { ...emptyScene(), ...antiga, nome: antiga.nome || 'Cena 1' };
    s.cenas = [cena];
    s.cenaAtiva = cena.id;
    delete s.cena;
  }
  if (!s.cenas.length) s.cenas.push(emptyScene());
  if (!s.cenas.some(c => c.id === s.cenaAtiva)) s.cenaAtiva = s.cenas[0].id;
  for (const c of s.cenas) c.tokens ||= [];
  s.versao = 2;
  return s;
}

/** Estado compartilhado da mesa (sincronizado entre os jogadores quando há servidor). */
export const state = emptyState();

/**
 * Estado só deste navegador/aba (não é sincronizado).
 * alvoId: alvo marcado · cenaVista: cena que estou olhando (null = a ativa, onde os jogadores estão) ·
 * mestre: este jogador é o mestre (sempre, no modo local) · jogadorId: identidade persistente deste navegador.
 */
export const local = { alvoId: null, cenaVista: null, mestre: true, jogadorId: 'local' };

// ---- permissões (o servidor confere de novo; aqui é para a interface mostrar só o que dá para fazer) ----
export const isGM = () => local.mestre;
/** Este jogador controla a ficha (é dono ou mestre)? */
export const ownsActor = a => !!a && (local.mestre || (a.donos || []).includes(local.jogadorId));
/** Acesso à ficha: 'editar' (dono/mestre), 'ver' (permissão de observar) ou 'nenhum'. Personagens são visíveis por padrão. */
export function sheetAccess(a) {
  if (!a) return 'nenhum';
  if (ownsActor(a)) return 'editar';
  return (a.permissao || (a.tipo === 'npc' ? 'nenhum' : 'ver')) === 'ver' ? 'ver' : 'nenhum';
}
/** Nome de um jogador pelo id (lista mantida pelo servidor). */
export const playerName = id => state.jogadores?.[id]?.nome || (id === local.jogadorId ? 'você' : 'jogador');

/** Cena mostrada no mapa deste jogador. */
export function scene() {
  return state.cenas.find(c => c.id === local.cenaVista) || state.cenas.find(c => c.id === state.cenaAtiva) || state.cenas[0];
}
export const getScene = id => state.cenas.find(c => c.id === id);

let syncHook = null;
/** Liga a sincronização em rede: `fn` é chamada após cada update(); a mesa deixa de ser salva no navegador. */
export function setSyncHook(fn) { syncHook = fn; }
export const isOnline = () => !!syncHook;

export function subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }
export function notify() { for (const fn of listeners) fn(state); }

const localHooks = new Set(), remoteHooks = new Set();
/** `fn(opts)` após cada update() local (ex.: histórico de desfazer). */
export function onLocalUpdate(fn) { localHooks.add(fn); return () => localHooks.delete(fn); }
/** `fn(ops)` quando chegam mudanças de outros jogadores; `fn(null)` quando o estado inteiro é recarregado. */
export function onRemoteUpdate(fn) { remoteHooks.add(fn); return () => remoteHooks.delete(fn); }
export function remoteApplied(ops) { for (const fn of remoteHooks) fn(ops); }

let saveTimer = null;
/**
 * Altera o estado. Opções: silent (não redesenha) · historico: false (não entra no Ctrl+Z) ·
 * historico: 'desfazer' | 'refazer' (usado pelo próprio histórico).
 */
export function update(mutator, opts = {}) {
  mutator?.(state);
  if (!opts.silent) notify();
  for (const fn of localHooks) fn(opts);
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
  if (saved) Object.assign(state, migrate(saved));
  return !!saved;
}

export function replaceState(obj) {
  for (const k of Object.keys(state)) delete state[k];
  Object.assign(state, migrate(obj));
  local.cenaVista = null;
  update(undefined, { historico: false });
}

export const getActor = id => state.atores.find(a => a.id === id);
