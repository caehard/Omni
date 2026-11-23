// Utilidades de DOM e janelas flutuantes.

export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function html(strings, ...vals) {
  const tpl = document.createElement('template');
  tpl.innerHTML = String.raw({ raw: strings }, ...vals).trim();
  return tpl.content.firstElementChild;
}

export function getPath(obj, path) {
  return path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
}
export function setPath(obj, path, value) {
  const keys = path.split('.');
  let o = obj;
  for (let i = 0; i < keys.length - 1; i++) {
    if (o[keys[i]] == null) o[keys[i]] = /^\d+$/.test(keys[i + 1]) ? [] : {};
    o = o[keys[i]];
  }
  o[keys[keys.length - 1]] = value;
}

let zTop = 100;
const openWindows = new Map();

/**
 * Cria (ou traz para frente) uma janela flutuante arrastável.
 * @returns {{el:HTMLElement, body:HTMLElement, close:Function}}
 */
export function makeWindow(id, title, { width = 420, onClose, className = '' } = {}) {
  if (openWindows.has(id)) {
    const w = openWindows.get(id);
    w.el.style.zIndex = ++zTop;
    return { ...w, existed: true };
  }
  const el = html`<section class="window ${className}" role="dialog" aria-label="${esc(title)}">
    <header class="window-head"><h2>${esc(title)}</h2><button class="icon-btn" data-close title="Fechar">✕</button></header>
    <div class="window-body"></div></section>`;
  const n = openWindows.size;
  el.style.width = Math.min(width, window.innerWidth - 24) + 'px';
  el.style.left = Math.max(8, Math.min(window.innerWidth - width - 8, 120 + n * 28)) + 'px';
  el.style.top = Math.max(8, 70 + n * 28) + 'px';
  el.style.zIndex = ++zTop;
  document.body.append(el);

  const close = () => { el.remove(); openWindows.delete(id); onClose?.(); };
  el.querySelector('[data-close]').onclick = close;
  el.addEventListener('pointerdown', () => { el.style.zIndex = ++zTop; });

  // arrastar pelo cabeçalho
  const head = el.querySelector('.window-head');
  head.addEventListener('pointerdown', e => {
    if (e.target.closest('button')) return;
    const sx = e.clientX - el.offsetLeft, sy = e.clientY - el.offsetTop;
    const move = ev => {
      el.style.left = Math.max(0, Math.min(window.innerWidth - 60, ev.clientX - sx)) + 'px';
      el.style.top = Math.max(0, Math.min(window.innerHeight - 40, ev.clientY - sy)) + 'px';
    };
    const up = () => { removeEventListener('pointermove', move); removeEventListener('pointerup', up); };
    addEventListener('pointermove', move); addEventListener('pointerup', up);
  });

  const w = { el, body: el.querySelector('.window-body'), close, setTitle: t => (el.querySelector('h2').textContent = t) };
  openWindows.set(id, w);
  return w;
}

export function closeWindow(id) { openWindows.get(id)?.close(); }
export function isOpen(id) { return openWindows.has(id); }

export function toast(msg, ms = 2600) {
  const t = html`<div class="toast" role="status">${esc(msg)}</div>`;
  document.body.append(t);
  setTimeout(() => t.remove(), ms);
}

export function downloadFile(name, text, type = 'application/json') {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

export function pickFile(accept) {
  return new Promise(resolve => {
    const i = document.createElement('input');
    i.type = 'file'; i.accept = accept;
    i.onchange = () => resolve(i.files[0] || null);
    i.click();
  });
}

export function readFile(file, as = 'text') {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result); r.onerror = rej;
    as === 'dataURL' ? r.readAsDataURL(file) : r.readAsText(file);
  });
}
