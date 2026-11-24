// Conexão com o servidor da mesa (servidor.py).
// Recebe o estado e as mudanças dos outros por SSE (/eventos) e envia as mudanças locais por POST (/ops).
// A lógica de convergência fica em sync-client.js.
import { state, setSyncHook, notify } from './store.js';
import { SyncClient } from './sync-client.js';

export const net = {
  online: false,
  sala: null,
  nome: null,
  cliente: null,
  status: 'offline',   // offline | conectando | conectado | reconectando
  jogadores: [],       // [{ cliente, nome }]
  info: null,          // resposta de /api/ping (endereços para convite)
  erro: null,
};

const listeners = new Set();
export function onNetChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }
const changed = () => { for (const fn of listeners) fn(net); };
const setStatus = s => { if (net.status !== s) { net.status = s; changed(); } };

const api = path => `/api/mesa/${encodeURIComponent(net.sala)}${path}`;

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

/**
 * Entra na mesa. Resolve com `true` se a mesa já existia no servidor (o estado foi carregado)
 * ou `false` se é nova (o estado local, vazio, é enviado como ponto de partida).
 */
export function connect({ sala, nome, info }) {
  const cliente = Math.random().toString(36).slice(2, 10) + Date.now().toString(36); // um por carregamento de página
  Object.assign(net, { online: true, sala, nome, cliente, info });
  sync = new SyncClient(state, cliente);
  setSyncHook(schedule);
  addEventListener('pagehide', () => { flush(); pump(true); });
  return new Promise(resolve => {
    let first = true;
    const open = () => {
      setStatus(first ? 'conectando' : 'reconectando');
      es = new EventSource(api(`/eventos?cliente=${encodeURIComponent(cliente)}&nome=${encodeURIComponent(nome)}`));
      es.onerror = () => {
        setStatus('reconectando');
        // o EventSource tenta de novo sozinho, exceto se o servidor respondeu com erro
        if (es.readyState === EventSource.CLOSED) setTimeout(reopen, 3000);
      };
      es.onmessage = ev => {
        const msg = JSON.parse(ev.data);
        if (msg.tipo === 'estado') {
          setStatus('conectado');
          if (first) { first = false; const existed = sync.start(msg); pump(); resolve(existed); }
          else { sync.resync(msg); notify(); pump(); }
        } else if (msg.tipo === 'ops') {
          const r = sync.receive(msg);
          if (r === 'lacuna') reopen(); // o servidor reenvia o estado inteiro ao reconectar
          else if (r === 'aplicado') { notify(); pump(); }
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
    const body = JSON.stringify({ cliente: net.cliente, lote: b.lote, ops: b.ops });
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
