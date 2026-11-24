// Ponto de entrada do TTS Omni.
import { loadConfig, CONFIG } from './system/config.js';
import { state, local, scene, update, load, replaceState, subscribe, readLocalSave, emptyState, migrate } from './core/store.js';
import { net, probe, connect, onNetChange, cleanRoom } from './core/net.js';
import { initHistory, undo, redo } from './core/history.js';
import { initTokenHud } from './ui/token-hud.js';
import { initScenes } from './ui/scenes.js';
import { fillResources } from './system/actor.js';
import { rollFormula } from './system/dice.js';
import { initChat, postText, postSystem } from './ui/chat.js';
import { initBoard, setRulerMode, centerView, focusView, worldToScreen, getView, getSelection, selectTokens } from './ui/board.js';
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
  const info = await probe(); // servida pelo servidor.py? então a mesa é compartilhada
  if (info) await bootOnline(info);
  else if (!load()) seedDemo();
  migrate(state); // mesas antigas (uma cena só) viram o formato com várias cenas
  applyDefaults();
  state.atores.forEach(fillResources);

  initChat(document.getElementById('chat-log'));
  initBoard(document.getElementById('board'), { openSheet });
  initTokenHud(document.querySelector('.board-wrap'), { onOpenSheet: openSheet });
  initScenes({ list: document.getElementById('scenes'), banner: document.getElementById('scene-banner') });
  initSidebar({ actors: document.getElementById('actors'), combat: document.getElementById('combat'), onOpenSheet: openSheet });

  bindToolbar();
  bindChatInput();
  bindNet();
  bindShortcuts();
  initHistory();
  update(undefined, { historico: false }); // primeira renderização
  focusView();
  // para depurar no console do navegador (e para os testes de interface)
  window.omni = { state, local, scene, update, CONFIG, net, board: { worldToScreen, getView, getSelection, selectTokens } };
}

function bindShortcuts() {
  addEventListener('keydown', e => {
    if (!(e.ctrlKey || e.metaKey) || e.target.closest?.('input, textarea, select, [contenteditable]')) return;
    const k = e.key.toLowerCase();
    if (k === 'z' && !e.shiftKey) { e.preventDefault(); if (!undo()) toast('Nada para desfazer.'); }
    else if (k === 'y' || (k === 'z' && e.shiftKey)) { e.preventDefault(); if (!redo()) toast('Nada para refazer.'); }
  });
}

function applyDefaults() {
  for (const [k, r] of Object.entries(CONFIG.sistema.regrasOpcionais)) if (state.regras[k] == null) state.regras[k] = r.padrao;
}

// ---- multiplayer ----
const NAME_KEY = 'omni-nome';
const savedName = () => { try { return localStorage.getItem(NAME_KEY) || ''; } catch { return ''; } };
const saveName = n => { try { localStorage.setItem(NAME_KEY, n); } catch { /* navegador sem armazenamento */ } };
/** Autor das mensagens digitadas no chat. */
const author = () => (net.online ? net.nome : 'Mestre');

async function bootOnline(info) {
  const params = new URLSearchParams(location.search);
  const sala = cleanRoom(params.get('mesa'));
  if (params.get('mesa') !== sala) history.replaceState(null, '', `?mesa=${sala}`);
  const nome = savedName() || await askName();
  const existed = await connect({ sala, nome, info });
  if (existed) return;
  // mesa nova no servidor: começa com a mesa deste navegador (se houver) ou com o exemplo
  const saved = readLocalSave();
  if (saved?.atores?.length && confirm(`A mesa “${sala}” é nova. Usar nela a mesa salva neste navegador (${saved.atores.length} ficha(s))?\n\nCancelar = começar com a mesa de exemplo.`)) Object.assign(state, saved);
  else seedDemo();
}

function askName(atual = '') {
  return new Promise(resolve => {
    const w = makeWindow('name', 'Entrar na mesa', { width: 340, onClose: () => resolve(atual || 'Jogador') });
    w.body.innerHTML = `<form class="roll-form">
      <label class="full">Seu nome (aparece no chat e para os outros jogadores)
        <input name="nome" maxlength="40" required value="${esc(atual)}" autofocus></label>
      <div class="row full"><button class="primary">Entrar</button></div></form>`;
    const f = w.body.querySelector('form');
    f.nome.focus();
    f.addEventListener('submit', e => {
      e.preventDefault();
      const n = f.nome.value.trim().slice(0, 40) || 'Jogador';
      saveName(n);
      atual = n;
      w.close();
    });
  });
}

function bindNet() {
  const btn = document.getElementById('btn-net');
  const render = () => {
    if (!net.online) return;
    btn.hidden = false;
    const n = net.jogadores.length;
    const icons = { conectado: '●', conectando: '◌', reconectando: '◌' };
    btn.dataset.status = net.status;
    btn.textContent = net.status === 'conectado' ? `${icons.conectado} ${net.sala} · ${n} na mesa` : `${icons[net.status] || '○'} ${net.status}…`;
    btn.title = `Mesa “${net.sala}” — ${net.jogadores.map(j => j.nome).join(', ') || 'ninguém'}\nClique para convidar jogadores`;
    if (net.erro) { toast(net.erro, 5000); net.erro = null; }
    if (document.getElementById('net-players')) fillPlayers();
  };
  onNetChange(render);
  btn.addEventListener('click', openNetDialog);
  render();
}

const fillPlayers = () => {
  const el = document.getElementById('net-players');
  el.innerHTML = net.jogadores.map(j => `<li>${esc(j.nome)}${j.cliente === net.cliente ? ' <small>(você)</small>' : ''}</li>`).join('') || '<li class="muted">Ninguém conectado.</li>';
};

function inviteLinks() {
  const path = `/vtt/?mesa=${encodeURIComponent(net.sala)}`;
  const links = [];
  const isLocal = ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);
  if (!isLocal) links.push({ url: location.origin + path, nota: 'endereço que você está usando' });
  for (const ip of net.info?.enderecos || []) {
    const url = `http://${ip}:${net.info.porta}${path}`;
    if (!links.some(l => l.url === url)) links.push({ url, nota: 'mesma rede (Wi-Fi/cabo)' });
  }
  return links;
}

function openNetDialog() {
  const w = makeWindow('net', 'Mesa compartilhada', { width: 460 });
  const links = inviteLinks();
  w.body.innerHTML = `<div class="net-dialog">
    <p>Mesa <b>${esc(net.sala)}</b> · você é <b>${esc(net.nome)}</b></p>
    <h4>Na mesa agora</h4><ul id="net-players" class="net-players"></ul>
    <h4>Convidar</h4>
    ${links.map(l => `<div class="invite"><input readonly value="${esc(l.url)}"><button data-copy>Copiar</button><small>${esc(l.nota)}</small></div>`).join('') || '<p class="muted">Nenhum endereço de rede encontrado.</p>'}
    <p class="hint">Jogadores fora da sua rede: abra um túnel (ex.: <code>cloudflared tunnel --url http://localhost:${net.info?.porta || 8000}</code>) e envie o endereço que ele gerar, terminando em <code>/vtt/?mesa=${esc(net.sala)}</code>. Veja “Jogar online” no README.</p>
    <form class="roll-form" data-room>
      <label>Ir para outra mesa <input name="sala" placeholder="nome-da-mesa"></label>
      <div class="row"><button>Entrar</button></div></form>
    <form class="roll-form" data-name>
      <label>Seu nome <input name="nome" maxlength="40" value="${esc(net.nome)}"></label>
      <div class="row"><button>Trocar</button></div></form>
  </div>`;
  fillPlayers();
  w.body.querySelectorAll('[data-copy]').forEach(b => b.addEventListener('click', async () => {
    const input = b.previousElementSibling;
    try { await navigator.clipboard.writeText(input.value); }
    catch { input.select(); document.execCommand('copy'); }
    toast('Link copiado.');
  }));
  w.body.querySelector('[data-room]').addEventListener('submit', e => {
    e.preventDefault();
    const s = cleanRoom(e.target.sala.value);
    location.search = `?mesa=${s}`;
  });
  w.body.querySelector('[data-name]').addEventListener('submit', e => {
    e.preventDefault();
    const n = e.target.nome.value.trim().slice(0, 40);
    if (!n || n === net.nome) return;
    saveName(n);
    location.reload(); // reconecta com o novo nome
  });
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
      const sc = scene(), q = sc.tamanhoQuadrado;
      update(() => { sc.fundo = url; sc.colunas = Math.max(8, Math.round(img.width / q)); sc.linhas = Math.max(8, Math.round(img.height / q)); });
      centerView();
      toast(`Mapa carregado em “${sc.nome}”. Ajuste a grade em ⚙ Cena.`);
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
      postSystem(`🎲 ${n}d${f}${mod ? (mod > 0 ? '+' : '') + mod : ''}: [${r.values.join(', ')}] = <b>${r.total + mod}</b>`, { autor: author() });
    } else if (txt.startsWith('/')) {
      toast('Comando desconhecido. Use /r 2d10');
      return;
    } else postText(txt, { autor: author() });
    form.msg.value = '';
  });
}

function openSceneDialog() {
  const sc = scene();
  const w = makeWindow('scene', `Cena — ${sc.nome}`, { width: 320 });
  w.body.innerHTML = `<form class="roll-form">
    <label class="full">Nome <input name="nome" maxlength="60" value="${esc(sc.nome)}"></label>
    <label>Colunas <input type="number" name="colunas" min="4" value="${sc.colunas}"></label>
    <label>Linhas <input type="number" name="linhas" min="4" value="${sc.linhas}"></label>
    <label class="full">Tamanho do quadrado (px) <input type="number" name="q" min="16" max="160" value="${sc.tamanhoQuadrado}"></label>
    <p class="hint full">Cada bloco (linhas grossas) = 2×2 quadrados. Zonas: 0 blocos Curto · 1 Distante · 2–3 Longe · 4–7 Muito Longe · 8–15 Extremamente Longe · 16+ Fora de Cena.</p>
    <div class="row full"><button class="primary">Aplicar</button><button type="button" data-clear>Remover mapa</button><button type="button" data-tokens>Limpar tokens</button></div></form>`;
  const f = w.body.querySelector('form');
  f.addEventListener('submit', e => {
    e.preventDefault();
    update(() => {
      sc.nome = f.nome.value.trim().slice(0, 60) || sc.nome;
      sc.colunas = Math.max(4, +f.colunas.value || sc.colunas); sc.linhas = Math.max(4, +f.linhas.value || sc.linhas);
      sc.tamanhoQuadrado = Math.max(16, Math.min(160, +f.q.value || sc.tamanhoQuadrado));
    });
    w.close();
  });
  w.body.querySelector('[data-clear]').onclick = () => update(() => { sc.fundo = ''; });
  w.body.querySelector('[data-tokens]').onclick = () => confirm(`Remover todos os tokens de “${sc.nome}”?`) && update(() => { sc.tokens = []; });
}

function openRulesDialog() {
  const w = makeWindow('rules', 'Regras opcionais', { width: 380 });
  w.body.innerHTML = `<form class="rules">${Object.entries(CONFIG.sistema.regrasOpcionais).map(([k, r]) =>
    `<label><input type="checkbox" name="${k}" ${state.regras[k] ? 'checked' : ''}> <b>${esc(r.nome)}</b><small>${esc(r.descricao)}</small></label>`).join('')}
    <div class="row"><button type="button" data-reset class="danger">Apagar mesa (recomeçar)</button></div></form>`;
  w.body.querySelector('form').addEventListener('change', e => update(s => { s.regras[e.target.name] = e.target.checked; }));
  w.body.querySelector('[data-reset]').onclick = () => {
    if (net.online) {
      if (!confirm(`Apagar todos os personagens, mapa e chat da mesa “${net.sala}” para TODOS os jogadores? Exporte antes se quiser guardar.`)) return;
      replaceState(emptyState());
      applyDefaults();
      update();
      w.close();
      toast('Mesa apagada.');
      return;
    }
    if (!confirm('Apagar todos os personagens, mapa e chat deste navegador? Exporte antes se quiser guardar.')) return;
    try { localStorage.removeItem('omni-vtt-estado-v1'); } catch { /* sem armazenamento */ }
    location.reload();
  };
}

function openHelp() {
  const w = makeWindow('help', 'Como usar', { width: 480 });
  w.body.innerHTML = `<div class="help">
    <h4>Mapa e tokens</h4><ul>
      <li>Arraste um personagem da lista para o mapa (ou use ⬚). Duplo clique no token abre a ficha.</li>
      <li><b>Clique</b> seleciona e mostra o menu do token (vida, sanidade, condições, tamanho). <b>Shift+clique</b> soma à seleção; <b>arrastar no vazio</b> seleciona vários.</li>
      <li>Arraste para mover os selecionados; <b>setas</b> movem 1 quadrado (Shift: 1 bloco). <b>Delete</b> remove. <b>Esc</b> limpa a seleção.</li>
      <li><b>Botão direito</b> num token marca o alvo (a Evasão dele vira o ND do ataque). Arrastar com o botão direito, o do meio ou com <b>espaço</b> move o mapa; roda do mouse dá zoom.</li>
      <li>Token selecionado mostra a <b>zona</b> até os demais (tokens grandes contam da borda). <b>Ctrl+arrastar</b> ou 📏 mede distâncias.</li>
      <li><b>Alt+clique</b> faz um ping para todos; <b>Alt+Shift+clique</b> também leva a visão de todos até lá.</li>
      <li><b>Ctrl+Z</b> desfaz e <b>Ctrl+Y</b> refaz o que você mudou (o chat não entra).</li></ul>
    <h4>Cenas</h4><ul>
      <li>Na aba <b>Cenas</b>: a marcada “jogadores aqui” é a que todos veem. Clicar em outra mostra só para você; ▶ leva os jogadores para ela.</li>
      <li>🗺 Mapa e ⚙ Cena mexem na cena que você está vendo.</li></ul>
    <h4>Rolagens</h4><ul>
      <li>Na ficha, clique no nome de um atributo ou aptidão para rolar.</li>
      <li>No chat: <code>/r 2d10</code> rola dados comuns.</li>
      <li>Nos cartões: ★ gasta Ponto Heroico em críticos; Virtude/Falha alteram um dado.</li></ul>
    <h4>Combate</h4><ul>
      <li>⚔ adiciona ao combate. “+ ação” cobra Pontos de Tempo (ações anteriores + 1 + extras).</li>
      <li>“Próxima rodada” processa cansaço por pontos críticos, sangramento, combustão, cicatrizes arcanas, conjuração e rolagens de morte.</li></ul>
    <h4>Mesa compartilhada</h4><ul>
      <li>Rodando pelo <code>servidor.py</code>, a mesa é a mesma para todos que abrirem o link: fichas, mapa, combate e chat atualizam na hora.</li>
      <li>O botão com o nome da mesa (no topo) mostra quem está conectado e os links de convite.</li>
      <li>O alvo marcado (botão direito) é só seu.</li></ul>
    <h4>Dados</h4><p>${net.online ? `A mesa fica salva no servidor (<code>mesas/${esc(net.sala)}.json</code>).` : 'Tudo fica salvo neste navegador.'} Use <b>Exportar</b> para guardar/compartilhar a mesa em JSON.</p></div>`;
}

subscribe(() => { document.getElementById('round-badge').textContent = state.combate.ativo ? `Rodada ${state.combate.rodada}` : ''; });
boot();
