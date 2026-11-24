// Música da mesa: o mestre toca uma música da biblioteca e todos ouvem (estado.musica). Cada um ajusta o
// próprio volume ou silencia (só neste navegador). Navegadores só tocam som depois de um clique na página.
import { state, subscribe, update, isGM, safeUrl } from '../core/store.js';
import { esc } from './dom.js';

const PREF = 'omni-musica-volume';
const audio = new Audio();
audio.preload = 'auto';
let botao, aviso, tocandoUrl = '', bloqueado = false;
const pref = { volume: 0.7, mudo: false };
try { Object.assign(pref, JSON.parse(localStorage.getItem(PREF) || '{}')); } catch { /* sem armazenamento */ }
const salvarPref = () => { try { localStorage.setItem(PREF, JSON.stringify(pref)); } catch { /* idem */ } };

export function initMusic(btn) {
  botao = btn;
  botao.addEventListener('click', abrirControle);
  aviso = document.createElement('button');
  aviso.className = 'music-unlock';
  aviso.hidden = true;
  aviso.textContent = '🔈 Clique para ouvir a música da mesa';
  aviso.onclick = () => { bloqueado = false; aviso.hidden = true; sincronizar(true); };
  document.body.append(aviso);
  audio.addEventListener('loadedmetadata', () => sincronizar(true));
  subscribe(() => sincronizar());
  sincronizar();
}

/** Posição (s) em que a música deve estar agora, para todos ouvirem o mesmo trecho. */
function posicao(m) {
  if (!m.tocando) return m.pausadoEm || 0;
  let t = (Date.now() - (m.desde || Date.now())) / 1000;
  if (m.repetir !== false && audio.duration > 0 && isFinite(audio.duration)) t %= audio.duration;
  return Math.max(0, t);
}

function sincronizar(forcar = false) {
  const m = state.musica;
  const url = safeUrl(m?.url);
  if (botao) {
    botao.hidden = !url;
    botao.textContent = m?.tocando ? (pref.mudo ? '🔇' : '♪') + ' ' + (m.nome || 'Música') : '⏸ ' + (m?.nome || '');
    botao.title = 'Música da mesa — clique para volume/silenciar';
  }
  if (!url) { if (tocandoUrl) { audio.pause(); audio.removeAttribute('src'); tocandoUrl = ''; } return; }
  if (url !== tocandoUrl) { tocandoUrl = url; audio.src = url; forcar = true; }
  audio.loop = m.repetir !== false;
  audio.volume = Math.max(0, Math.min(1, (m.volume ?? 1) * pref.volume));
  audio.muted = pref.mudo;
  if (!m.tocando) { if (!audio.paused) audio.pause(); return; }
  const alvo = posicao(m);
  if (forcar || Math.abs(audio.currentTime - alvo) > 2.5) { try { audio.currentTime = alvo; } catch { /* metadados ainda não chegaram */ } }
  if (audio.paused && !bloqueado) {
    audio.play().catch(() => { bloqueado = true; aviso.hidden = false; });
  }
}

/** Controles do mestre (na biblioteca). */
export function tocarParaTodos(item) {
  update(s => { s.musica = { url: item.url, nome: item.nome, itemId: item.id, tocando: true, desde: Date.now(), pausadoEm: 0, volume: s.musica?.volume ?? 0.8, repetir: s.musica?.repetir ?? true }; });
}
export function pausarMusica() {
  const m = state.musica;
  if (!m) return;
  update(s => { s.musica = m.tocando ? { ...m, tocando: false, pausadoEm: posicao(m) } : { ...m, tocando: true, desde: Date.now() - (m.pausadoEm || 0) * 1000 }; });
}
export const pararMusica = () => update(s => { s.musica = null; });

function abrirControle() {
  const m = state.musica;
  const pop = document.createElement('div');
  pop.className = 'music-pop';
  pop.innerHTML = `<b>♪ ${esc(m?.nome || 'Música')}</b>
    <label>Meu volume <input type="range" min="0" max="1" step="0.05" value="${pref.volume}" data-vol></label>
    <label class="tp-check"><input type="checkbox" data-mudo ${pref.mudo ? 'checked' : ''}> Silenciar para mim</label>
    ${isGM() ? `<div class="row"><button data-pausa>${m?.tocando ? '⏸ Pausar' : '▶ Continuar'}</button><button data-parar>⏹ Parar</button></div>
    <label>Volume para todos <input type="range" min="0" max="1" step="0.05" value="${m?.volume ?? 0.8}" data-volm></label>
    <label class="tp-check"><input type="checkbox" data-rep ${m?.repetir !== false ? 'checked' : ''}> Repetir</label>` : ''}`;
  const r = botao.getBoundingClientRect();
  pop.style.top = r.bottom + 6 + 'px'; pop.style.right = Math.max(8, innerWidth - r.right) + 'px';
  document.body.append(pop);
  const fechar = e => { if (!pop.contains(e.target) && e.target !== botao) { pop.remove(); removeEventListener('pointerdown', fechar); } };
  setTimeout(() => addEventListener('pointerdown', fechar));
  pop.addEventListener('input', e => {
    if (e.target.matches('[data-vol]')) { pref.volume = +e.target.value; salvarPref(); sincronizar(); }
    if (e.target.matches('[data-mudo]')) { pref.mudo = e.target.checked; salvarPref(); sincronizar(); }
    if (e.target.matches('[data-volm]')) update(s => { if (s.musica) s.musica.volume = +e.target.value; });
    if (e.target.matches('[data-rep]')) update(s => { if (s.musica) s.musica.repetir = e.target.checked; });
  });
  pop.addEventListener('click', e => {
    if (e.target.matches('[data-pausa]')) { pausarMusica(); pop.remove(); }
    if (e.target.matches('[data-parar]')) { pararMusica(); pop.remove(); }
  });
}
