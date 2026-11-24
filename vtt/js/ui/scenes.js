// Cenas: lista no painel lateral e aviso quando você está vendo uma cena diferente da dos jogadores.
// A cena "ativa" é onde todos estão; clicar numa cena só muda o que você vê (local.cenaVista).
import { state, local, scene, update, notify, subscribe, emptyScene, newId } from '../core/store.js';
import { esc } from './dom.js';

let listEl, bannerEl;
const thumbs = new Map(); // fundo (dataURL) -> miniatura

export function initScenes({ list, banner }) {
  listEl = list; bannerEl = banner;
  listEl.addEventListener('click', onClick);
  listEl.addEventListener('dblclick', e => { const li = e.target.closest('[data-id]'); if (li && !e.target.closest('button')) rename(li.dataset.id); });
  bannerEl.addEventListener('click', onBanner);
  subscribe(render);
  render();
}

/** Mostra a cena só para você (null = voltar para a cena dos jogadores). */
export function viewScene(id) {
  local.cenaVista = id && id !== state.cenaAtiva ? id : null;
  notify();
}

export function activateScene(id) {
  local.cenaVista = null;
  update(s => { s.cenaAtiva = id; });
}

function thumb(fundo) {
  if (!fundo) return '';
  if (thumbs.has(fundo)) return thumbs.get(fundo);
  thumbs.set(fundo, '');
  const img = new Image();
  img.onload = () => {
    const c = document.createElement('canvas'), w = 72, h = Math.max(24, Math.round(72 * img.height / img.width));
    c.width = w; c.height = Math.min(h, 54);
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    thumbs.set(fundo, c.toDataURL('image/jpeg', 0.7));
    render();
  };
  img.src = fundo;
  return '';
}

let lastSig = '';
function render() {
  const vista = scene().id;
  const sig = JSON.stringify([state.cenaAtiva, vista, state.cenas.map(c => [c.id, c.nome, c.colunas, c.linhas, c.tokens.length, c.fundo.length, thumbs.get(c.fundo)?.length])]);
  if (sig !== lastSig) {
    lastSig = sig;
    listEl.innerHTML = `<h3>Cenas <button class="icon-btn" data-act="nova" title="Nova cena">＋</button></h3>
      <ul class="scene-list">${state.cenas.map(c => {
        const t = thumb(c.fundo), ativa = c.id === state.cenaAtiva, vendo = c.id === vista;
        return `<li data-id="${c.id}" class="${ativa ? 'ativa' : ''} ${vendo ? 'vendo' : ''}" title="Clique para ver · duplo clique renomeia">
          <span class="scene-thumb"${t ? ` style="background-image:url(${t})"` : ''}></span>
          <span class="name">${esc(c.nome)}<small>${c.colunas}×${c.linhas} · ${c.tokens.length} token(s)${ativa ? ' · <b>jogadores aqui</b>' : ''}</small></span>
          <span class="actions">
            ${ativa ? '' : '<button class="icon-btn" data-act="ativar" title="Levar os jogadores para esta cena">▶</button>'}
            <button class="icon-btn" data-act="renomear" title="Renomear">✎</button>
            <button class="icon-btn" data-act="duplicar" title="Duplicar">⧉</button>
            ${state.cenas.length > 1 ? '<button class="icon-btn" data-act="excluir" title="Excluir">✕</button>' : ''}
          </span></li>`;
      }).join('')}</ul>
      <p class="hint">A cena marcada “jogadores aqui” é a que todos veem. Clicar em outra mostra só para você — bom para preparar a próxima.</p>`;
  }
  const ativa = state.cenas.find(c => c.id === state.cenaAtiva);
  const outra = vista !== state.cenaAtiva;
  bannerEl.hidden = !outra;
  if (outra) bannerEl.innerHTML = `Você está vendo <b>${esc(scene().nome)}</b> · os jogadores estão em <b>${esc(ativa?.nome || '?')}</b>
    <button data-act="ativar">Levar jogadores para cá</button><button data-act="voltar">Voltar</button>`;
}

function rename(id) {
  const c = state.cenas.find(x => x.id === id);
  const nome = prompt('Nome da cena:', c.nome);
  if (nome?.trim()) update(() => { c.nome = nome.trim().slice(0, 60); });
}

function onClick(e) {
  const b = e.target.closest('button[data-act]'), li = e.target.closest('[data-id]');
  if (b?.dataset.act === 'nova') {
    const c = emptyScene(`Cena ${state.cenas.length + 1}`);
    update(s => s.cenas.push(c));
    viewScene(c.id);
    return;
  }
  if (!li) return;
  const id = li.dataset.id, c = state.cenas.find(x => x.id === id);
  if (!b) { viewScene(id); return; }
  switch (b.dataset.act) {
    case 'ativar': activateScene(id); break;
    case 'renomear': rename(id); break;
    case 'duplicar': {
      const copia = structuredClone(c);
      copia.id = newId(); copia.nome = `${c.nome} (cópia)`;
      copia.tokens.forEach(t => { t.id = newId(); });
      update(s => s.cenas.splice(s.cenas.indexOf(c) + 1, 0, copia));
      break;
    }
    case 'excluir':
      if (!confirm(`Excluir a cena “${c.nome}” (mapa e tokens)?`)) return;
      update(s => {
        s.cenas = s.cenas.filter(x => x.id !== id);
        if (s.cenaAtiva === id) s.cenaAtiva = s.cenas[0].id;
      });
      if (local.cenaVista === id) viewScene(null);
      break;
  }
}

function onBanner(e) {
  const act = e.target.closest('button[data-act]')?.dataset.act;
  if (act === 'ativar') activateScene(scene().id);
  if (act === 'voltar') viewScene(null);
}
