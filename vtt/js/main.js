// Ponto de entrada do TTS Omni.
import { loadConfig, CONFIG } from './system/config.js';
import { state, update, load, replaceState, subscribe } from './core/store.js';
import { fillResources } from './system/actor.js';
import { rollFormula } from './system/dice.js';
import { initChat, postText, postSystem } from './ui/chat.js';
import { initBoard, setRulerMode, centerView } from './ui/board.js';
import { initSidebar, newActor } from './ui/sidebar.js';
import { openSheet } from './ui/sheet.js';
import { makeWindow, toast, downloadFile, pickFile, readFile, esc } from './ui/dom.js';
import { seedDemo } from './demo.js';

async function boot() {
  try {
    await loadConfig();
  } catch (e) {
    document.getElementById('app').innerHTML = `<div class="boot-error"><h1>Não foi possível carregar os dados</h1>
      <p>${esc(e.message)}</p><p>Abra o TTS por um servidor local (veja o README): <code>python3 -m http.server 8000</code> na raiz do repositório e acesse <code>http://localhost:8000/vtt/</code>.</p></div>`;
    return;
  }
  const had = load();
  for (const [k, r] of Object.entries(CONFIG.sistema.regrasOpcionais)) if (state.regras[k] == null) state.regras[k] = r.padrao;
  if (!had) seedDemo();
  state.atores.forEach(fillResources);

  initChat(document.getElementById('chat-log'));
  initBoard(document.getElementById('board'), { openSheet });
  initSidebar({ actors: document.getElementById('actors'), combat: document.getElementById('combat'), onOpenSheet: openSheet });

  bindToolbar();
  bindChatInput();
  update(); // primeira renderização
}

function bindToolbar() {
  const on = (id, fn) => document.getElementById(id).addEventListener('click', fn);
  on('btn-new-pc', () => newActor('personagem'));
  on('btn-new-npc', () => newActor('npc'));
  on('btn-map', async () => {
    const f = await pickFile('image/*');
    if (!f) return;
    const url = await readFile(f, 'dataURL');
    const img = new Image();
    img.onload = () => {
      const q = state.cena.tamanhoQuadrado;
      update(s => { s.cena.fundo = url; s.cena.colunas = Math.max(8, Math.round(img.width / q)); s.cena.linhas = Math.max(8, Math.round(img.height / q)); });
      toast('Mapa carregado. Ajuste a grade em ⚙ Cena.');
    };
    img.src = url;
  });
  const ruler = document.getElementById('btn-ruler');
  ruler.addEventListener('click', () => { const v = ruler.getAttribute('aria-pressed') !== 'true'; ruler.setAttribute('aria-pressed', v); setRulerMode(v); });
  on('btn-center', centerView);
  on('btn-scene', openSceneDialog);
  on('btn-rules', openRulesDialog);
  on('btn-export', () => downloadFile(`omni-mesa-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(state, null, 1)));
  on('btn-import', async () => {
    const f = await pickFile('application/json,.json');
    if (!f) return;
    try {
      const data = JSON.parse(await readFile(f));
      if (Array.isArray(data.atores)) { replaceState(data); toast('Mesa importada.'); }
      else if (data.system && data.nome) { update(s => s.atores.push({ ...data, id: Math.random().toString(36).slice(2, 10) })); toast('Personagem importado.'); }
      else toast('Arquivo não reconhecido.');
    } catch (e) { toast('JSON inválido: ' + e.message); }
  });
  on('btn-help', openHelp);

  // abas do painel esquerdo
  document.querySelectorAll('[data-panel]').forEach(b => b.addEventListener('click', () => {
    document.querySelectorAll('[data-panel]').forEach(x => x.setAttribute('aria-selected', x === b));
    document.querySelectorAll('.panel').forEach(p => (p.hidden = p.id !== b.dataset.panel));
  }));
}

function bindChatInput() {
  const form = document.getElementById('chat-form');
  form.addEventListener('submit', e => {
    e.preventDefault();
    const txt = form.msg.value.trim();
    if (!txt) return;
    const m = txt.match(/^\/r(?:oll)?\s+(\d*)d(\d+)\s*([+-]\s*\d+)?$/i);
    if (m) {
      const n = +(m[1] || 1), f = +m[2], mod = Number((m[3] || '0').replace(/\s/g, ''));
      const r = rollFormula(n, f);
      postSystem(`🎲 ${n}d${f}${mod ? (mod > 0 ? '+' : '') + mod : ''}: [${r.values.join(', ')}] = <b>${r.total + mod}</b>`, { autor: 'Mestre' });
    } else if (txt.startsWith('/')) {
      toast('Comando desconhecido. Use /r 2d10');
      return;
    } else postText(txt, { autor: 'Mestre' });
    form.msg.value = '';
  });
}

function openSceneDialog() {
  const w = makeWindow('scene', 'Cena', { width: 320 });
  const sc = state.cena;
  w.body.innerHTML = `<form class="roll-form">
    <label>Colunas <input type="number" name="colunas" min="4" value="${sc.colunas}"></label>
    <label>Linhas <input type="number" name="linhas" min="4" value="${sc.linhas}"></label>
    <label class="full">Tamanho do quadrado (px) <input type="number" name="q" min="16" max="160" value="${sc.tamanhoQuadrado}"></label>
    <p class="hint full">Cada bloco (linhas grossas) = 2×2 quadrados. Zonas: 0 blocos Curto · 1 Distante · 2–3 Longe · 4–7 Muito Longe · 8–15 Extremamente Longe · 16+ Fora de Cena.</p>
    <div class="row full"><button class="primary">Aplicar</button><button type="button" data-clear>Remover mapa</button><button type="button" data-tokens>Limpar tokens</button></div></form>`;
  const f = w.body.querySelector('form');
  f.addEventListener('submit', e => { e.preventDefault(); update(s => { s.cena.colunas = +f.colunas.value; s.cena.linhas = +f.linhas.value; s.cena.tamanhoQuadrado = +f.q.value; }); w.close(); });
  w.body.querySelector('[data-clear]').onclick = () => update(s => { s.cena.fundo = ''; });
  w.body.querySelector('[data-tokens]').onclick = () => confirm('Remover todos os tokens do mapa?') && update(s => { s.cena.tokens = []; });
}

function openRulesDialog() {
  const w = makeWindow('rules', 'Regras opcionais', { width: 380 });
  w.body.innerHTML = `<form class="rules">${Object.entries(CONFIG.sistema.regrasOpcionais).map(([k, r]) =>
    `<label><input type="checkbox" name="${k}" ${state.regras[k] ? 'checked' : ''}> <b>${esc(r.nome)}</b><small>${esc(r.descricao)}</small></label>`).join('')}
    <div class="row"><button type="button" data-reset class="danger">Apagar mesa (recomeçar)</button></div></form>`;
  w.body.querySelector('form').addEventListener('change', e => update(s => { s.regras[e.target.name] = e.target.checked; }));
  w.body.querySelector('[data-reset]').onclick = () => {
    if (!confirm('Apagar todos os personagens, mapa e chat deste navegador? Exporte antes se quiser guardar.')) return;
    localStorage.clear(); location.reload();
  };
}

function openHelp() {
  const w = makeWindow('help', 'Como usar', { width: 460 });
  w.body.innerHTML = `<div class="help">
    <h4>Mapa</h4><ul>
      <li>Arraste um personagem da lista para o mapa (ou use ⬚).</li>
      <li>Clique e arraste tokens para mover. Duplo clique abre a ficha.</li>
      <li>Botão direito em um token marca o <b>alvo</b> (a Evasão dele vira o ND do ataque).</li>
      <li>Token selecionado mostra a <b>zona</b> até os demais. <b>Ctrl+arrastar</b> ou 📏 mede distâncias.</li>
      <li>Arraste o fundo (ou botão do meio / espaço) para mover; roda do mouse para zoom. Delete remove o token.</li></ul>
    <h4>Rolagens</h4><ul>
      <li>Na ficha, clique no nome de um atributo ou aptidão para rolar.</li>
      <li>No chat: <code>/r 2d10</code> rola dados comuns.</li>
      <li>Nos cartões: ★ gasta Ponto Heroico em críticos; Virtude/Falha alteram um dado.</li></ul>
    <h4>Combate</h4><ul>
      <li>⚔ adiciona ao combate. “+ ação” cobra Pontos de Tempo (ações anteriores + 1 + extras).</li>
      <li>“Próxima rodada” processa cansaço por pontos críticos, sangramento, combustão, cicatrizes arcanas, conjuração e rolagens de morte.</li></ul>
    <h4>Dados</h4><p>Tudo fica salvo neste navegador. Use <b>Exportar</b> para guardar/compartilhar a mesa em JSON.</p></div>`;
}

subscribe(() => { document.getElementById('round-badge').textContent = state.combate.ativo ? `Rodada ${state.combate.rodada}` : ''; });
boot();
