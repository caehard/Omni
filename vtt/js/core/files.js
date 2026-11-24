// Arquivos da mesa (imagens, músicas, PDFs). Online: vão para o servidor (mesas/arquivos/<mesa>/) e a mesa guarda
// só o endereço — assim um mapa ou retrato não é reenviado a todos a cada mudança. Offline: ficam embutidos (data:).
import { net, mesaApi } from './net.js';

const LIMITE = 40 * 1024 * 1024;
const LIMITE_EMBUTIDO = 8 * 1024 * 1024; // no modo local, tudo vai para o localStorage do navegador

export const podeEnviar = () => net.online;

function paraDataURL(blob) {
  return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(blob); });
}

/** Guarda um arquivo e devolve o endereço para usar em <img src>/<audio src>. */
export async function guardar(blob) {
  if (blob.size > LIMITE) throw new Error('arquivo maior que 40 MB');
  if (!net.online) {
    if (blob.size > LIMITE_EMBUTIDO) throw new Error('no modo local, arquivos até 8 MB (abra pelo servidor.py para arquivos maiores)');
    return paraDataURL(blob);
  }
  const tipo = blob.type || 'application/octet-stream';
  const r = await fetch(mesaApi('/arquivos'), { method: 'POST', headers: { 'Content-Type': tipo }, body: blob });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.erro || `o servidor recusou (${r.status})`);
  return j.url;
}

/** Carrega uma imagem (para desenhar no canvas). */
export function carregarImagem(src) {
  return new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => res(img);
    img.onerror = () => rej(new Error('não consegui abrir a imagem'));
    img.src = src;
  });
}

/** Miniatura (lado maior = tam) em WebP/JPEG, para a grade da biblioteca não baixar a imagem inteira. */
export async function miniatura(src, tam = 320) {
  const img = await carregarImagem(src);
  const k = Math.min(1, tam / Math.max(img.naturalWidth, img.naturalHeight));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(img.naturalWidth * k)); c.height = Math.max(1, Math.round(img.naturalHeight * k));
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  const blob = await new Promise(res => c.toBlob(res, 'image/webp', 0.82));
  return blob && blob.type === 'image/webp' ? blob : new Promise(res => c.toBlob(res, 'image/jpeg', 0.82));
}

/** Guarda uma imagem e a miniatura dela. */
export async function guardarImagem(blob) {
  const url = await guardar(blob);
  let mini = '';
  try { mini = await guardar(await miniatura(url)); } catch { /* sem miniatura: a grade usa a imagem inteira */ }
  return { url, mini };
}

export const tipoDoArquivo = mime => /^image\//.test(mime) ? 'imagem' : /^audio\//.test(mime) ? 'musica' : 'outro';
