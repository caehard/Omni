// Conexão com o servidor da mesa (servidor.py).
// Recebe o estado e as mudanças dos outros por SSE (/eventos) e envia as mudanças locais por POST (/ops).
// A lógica de convergência fica em sync-client.js.
import { state, local, setSyncHook, notify, remoteApplied } from './store.js';
import { SyncClient } from './sync-client.js';

export const net = {
  online: false,
  sala: null,
  nome: null,
  cliente: null,
  status: 'offline',   // offline | conectando | conectado | reconectando
  jogadores: [],       // [{ cliente, nome, jogador, mestre }] — quem está conectado agora
  info: null,          // resposta de /api/ping (endereços para convite, link público)
  papel: 'mestre',     // mestre | jogador (no modo local, sempre mestre)
  chave: null,         // chave do mestre (só o mestre recebe; vai no link de co-mestre)
  erro: null,
};

/** Atualiza as informações do servidor (o link público do túnel pode aparecer depois de abrir). */
export async function refreshInfo() { const i = await probe(); if (i) net.info = i; return net.info; }

const listeners = new Set();
export function onNetChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }
const changed = () => { for (const fn of listeners) fn(net); };
const setStatus = s => { if (net.status !== s) { net.status = s; changed(); } };

const api = path => `/api/mesa/${encodeURIComponent(net.sala)}${path}`;
/** Endereço de uma rota desta mesa (arquivos, gerador). */
export const mesaApi = api;
/** Quem está pedindo (o servidor decide se é mestre pela chave/localhost). */
export const quemPede = () => ({ jogador: net.jogador, ...(net.chaveUsada && { chave: net.chaveUsada }), ...(net.como && { como: net.como }) });

let sync = null, es = null, timer = null, sending = false, reopen = null;

/** Verifica se a página foi servida pelo servidor da mesa. */
export async function probe() {
  try {
    const r = await fetch('/api/ping', { cache: 'no-store' });
    if (!r.ok) return null;
    const j = await r.json();
    return j && j.omni ? j : null;
  } catch { return null; }
}

/** Nome de mesa seguro (mesma regra do servidor). */
export const cleanRoom = s => (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'principal';

/** Aplica o papel informado pelo servidor (mestre ou jogador). */
function setRole(msg) {
  const mestre = msg.papel !== 'jogador';
  if (msg.chave) net.chave = msg.chave;
  if (local.mestre !== mestre || net.papel !== msg.papel) { local.mestre = mestre; net.papel = msg.papel || 'mestre'; changed(); }
}

/**
 * Entra na mesa. Resolve com `true` se a mesa já existia no servidor (o estado foi carregado)
 * ou `false` se é nova (o mestre envia o estado local, vazio, como ponto de partida; o jogador espera).
 * jogador: id persistente deste navegador · chave: chave do mestre (link de co-mestre) · como: 'jogador' para ver como jogador.
 */
export function connect({ sala, nome, info, jogador, chave = '', como = '' }) {
  const cliente = Math.random().toString(36).slice(2, 10) + Date.now().toString(36); // um por carregamento de página
  Object.assign(net, { online: true, sala, nome, cliente, info, jogador, chaveUsada: chave, como });
  local.jogadorId = jogador;
  sync = new SyncClient(state, cliente);
  setSyncHook(schedule);
  addEventListener('pagehide', () => { flush(); pump(true); });
  const q = new URLSearchParams({ cliente, nome, jogador, ...(chave && { chave }), ...(como && { como }) });
  return new Promise(resolve => {
    let first = true;
    const open = () => {
      setStatus(first ? 'conectando' : 'reconectando');
      es = new EventSource(api(`/eventos?${q}`));
      es.onerror = () => {
        setStatus('reconectando');
        // o EventSource tenta de novo sozinho, exceto se o servidor respondeu com erro
        if (es.readyState === EventSource.CLOSED) setTimeout(reopen, 3000);
      };
      es.onmessage = ev => {
        const msg = JSON.parse(ev.data);
        if (msg.tipo === 'estado') {
          setStatus('conectado');
          setRole(msg);
          if (first) { first = false; const existed = sync.start(msg, local.mestre); pump(); resolve(existed); }
          else { sync.resync(msg); remoteApplied(null); notify(); pump(); }
        } else if (msg.tipo === 'ops') {
          const r = sync.receive(msg);
          if (r === 'lacuna') reopen(); // o servidor reenvia o estado inteiro ao reconectar
          else if (r === 'aplicado') { remoteApplied(msg.ops); notify(); pump(); }
        } else if (msg.tipo === 'evento') {
          if (msg.origem !== net.cliente) emitEvent(msg.dados, msg.origem);
        } else if (msg.tipo === 'presenca') {
          net.jogadores = msg.jogadores || [];
          changed();
        }
      };
    };
    reopen = () => { es?.close(); open(); };
    open();
  });
}

// ---- eventos passageiros (ping no mapa etc.): vão para todos, mas não ficam salvos ----
const eventListeners = new Set();
/** `fn(dados, origem)` para cada evento recebido (inclusive os enviados por este jogador). */
export function onEvent(fn) { eventListeners.add(fn); return () => eventListeners.delete(fn); }
function emitEvent(dados, origem) { for (const fn of eventListeners) fn(dados, origem); }

/** Envia um evento a todos da mesa (no modo local, só para este navegador). */
export function sendEvent(dados) {
  emitEvent(dados, net.cliente);
  if (!net.online) return;
  fetch(api('/evento'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ cliente: net.cliente, dados }) })
    .catch(() => { /* evento perdido: não tem importância */ });
}

/** Cor estável para um nome de jogador (pings, presença). */
export function playerColor(nome = '') {
  let h = 0;
  for (const c of nome) h = (h * 31 + c.codePointAt(0)) % 360;
  return `hsl(${h} 65% 45%)`;
}

function schedule() {
  if (!timer) timer = setTimeout(flush, 40); // junta as mudanças de uma digitação/arrasto
}

function flush() {
  clearTimeout(timer); timer = null;
  if (sync?.flush()) pump();
}

async function pump(keepalive = false) {
  if (sending || !sync) return;
  sending = true;
  let b;
  while ((b = sync.nextUnsent())) {
    const body = JSON.stringify({ cliente: net.cliente, lote: b.lote, ops: b.ops, jogador: net.jogador,
      ...(net.chaveUsada && { chave: net.chaveUsada }), ...(net.como && { como: net.como }) });
    try {
      // grande demais: nem tenta (o servidor fecharia a conexão e a fila tentaria para sempre)
      const r = body.length > (net.info?.limite || Infinity) ? { status: 413, text: async () => 'local' } : await fetch(api('/ops'), {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body,
        keepalive: keepalive && body.length < 60000,
      });
      if (r.status >= 400 && r.status < 500) { // recusado (ex.: grande demais): descarta para não travar a fila
        sync.drop(b);
        console.warn('Servidor recusou a mudança:', r.status, await r.text());
        net.erro = r.status === 413 ? 'Arquivo grande demais para enviar à mesa (limite de 32 MB).' : `Mudança recusada pelo servidor (${r.status}).`;
        changed();
        reopen?.(); // volta ao estado do servidor para não ficar diferente dos outros
        continue;
      }
      if (!r.ok) throw new Error('HTTP ' + r.status);
      b.enviado = true;
      if (es?.readyState === EventSource.OPEN) setStatus('conectado');
    } catch {
      setStatus('reconectando');
      await new Promise(res => setTimeout(res, 1500));
    }
  }
  sending = false;
}
