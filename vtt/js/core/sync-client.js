// Lógica de sincronização de um cliente, sem rede (testável): quem envia e recebe é core/net.js.
//
// Como as mesas convergem: cada mudança local é aplicada na hora e vira um "lote" numerado, que fica
// pendente até o servidor devolvê-lo. O servidor define a ordem e repassa cada lote a todos.
// - Lote nosso devolvido: já estava aplicado; só sai da lista de pendentes.
// - Lote de outra pessoa: aplicamos e depois reaplicamos por cima os nossos pendentes, que o servidor
//   só vai receber depois dele (e que, portanto, também vão prevalecer lá).
import { diff, applyOps, clone } from './sync-ops.js';

export class SyncClient {
  /** @param {object} state objeto de estado (modificado no lugar) · @param {string} cliente identificador único */
  constructor(state, cliente) {
    this.state = state;
    this.cliente = cliente;
    this.shadow = null;   // estado como ficará no servidor depois dos lotes pendentes
    this.pending = [];    // [{ lote, ops, enviado }]
    this.lote = 0;
    this.v = 0;
  }

  get ready() { return this.shadow !== null; }

  /**
   * Primeira mensagem do servidor. Devolve true se a mesa já existia.
   * Mesa nova: quem pode criar (o mestre) envia o estado local vazio como ponto de partida;
   * um jogador só espera o mestre abrir a mesa.
   */
  start({ v, estado }, podeCriar = true) {
    this.v = v;
    if (estado != null) { this.#load(estado); return true; }
    this.shadow = clone(this.state);
    if (podeCriar) this.#push([{ op: 'set', path: [], value: clone(this.state) }]);
    return false;
  }

  /** Mudanças locais desde o último lote viram um novo lote (ou null se nada mudou). */
  flush() {
    if (!this.ready) return null;
    const ops = diff(this.shadow, this.state);
    if (!ops.length) return null;
    applyOps(this.shadow, ops);
    return this.#push(ops);
  }

  /**
   * Lote vindo do servidor. Devolve 'lacuna' (perdemos mensagens: pedir o estado inteiro),
   * 'nosso' (nada muda na tela) ou 'aplicado'.
   */
  receive(msg) {
    if (msg.v !== this.v + 1) return 'lacuna';
    this.v = msg.v;
    if (msg.origem === this.cliente) {
      this.pending = this.pending.filter(b => b.lote > msg.lote);
      return 'nosso';
    }
    this.flush(); // o que ainda não virou lote entra na fila antes
    applyOps(this.state, msg.ops);
    applyOps(this.shadow, msg.ops);
    this.#reapplyPending();
    return 'aplicado';
  }

  /** Reconexão: estado inteiro do servidor + último lote nosso que ele recebeu. */
  resync({ v, estado, lote = 0 }) {
    this.flush();
    this.v = v;
    this.pending = this.pending.filter(b => b.lote > lote);
    if (estado == null) this.shadow = clone(this.state); // mesa ainda não criada pelo mestre
    else this.#load(estado);
    this.#reapplyPending();
    for (const b of this.pending) b.enviado = false;
  }

  nextUnsent() { return this.pending.find(b => !b.enviado) || null; }
  drop(batch) { this.pending = this.pending.filter(b => b !== batch); }

  #push(ops) {
    const b = { lote: ++this.lote, ops, enviado: false };
    this.pending.push(b);
    return b;
  }
  #load(estado) {
    for (const k of Object.keys(this.state)) delete this.state[k];
    Object.assign(this.state, clone(estado));
    this.shadow = clone(estado);
  }
  #reapplyPending() {
    for (const b of this.pending) { applyOps(this.state, b.ops); applyOps(this.shadow, b.ops); }
  }
}
