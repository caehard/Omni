// Ponto de entrada do TTS Omni.
import { loadConfig, CONFIG } from './system/config.js';
import { state, local, scene, update, load, replaceState, subscribe, readLocalSave, emptyState, migrate, isGM, ownsActor } from './core/store.js';
import { net, probe, connect, onNetChange, cleanRoom, refreshInfo } from './core/net.js';
import { initHistory, undo, redo } from './core/history.js';
import { initTokenHud } from './ui/token-hud.js';
import { initScenes } from './ui/scenes.js';
import { fillResources } from './system/actor.js';
import { rollFormula } from './system/dice.js';
import { initChat, postText, postSystem } from './ui/chat.js';
import { initBoard, centerView, focusView, worldToScreen, getView, getSelection, selectTokens, redraw } from './ui/board.js';
import { initTools, setTool, refreshPalette } from './ui/tools.js';
import { initDiceTray } from './ui/dice-tray.js';
import { initSidebar, newActor } from './ui/sidebar.js';
import { openSheet } from './ui/sheet.js';
import { makeWindow, toast, downloadFile, pickFile, readFile, esc } from './ui/dom.js';
import { initLibrary, adicionar as addToLibrary, usarComoMapa } from './ui/library.js';
import { initGenerator } from './ui/generator.js';
import { initMusic } from './ui/music.js';
import { guardarImagem } from './core/files.js';
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
  if (isGM()) { // ajustes que mudam a mesa: só o mestre faz (o jogador recebe pronto)
    migrate(state); // mesas antigas (uma cena só) viram o formato com várias cenas
    applyDefaults();
  } else if (!state.cenas) Object.assign(state, emptyState()); // mesa ainda não aberta pelo mestre
  state.atores.filter(ownsActor).forEach(fillResources);
  applyRoleClass();

  initChat(document.getElementById('chat-log'));
  initBoard(document.getElementById('board'), { openSheet });
  initTokenHud(document.querySelector('.board-wrap'), { onOpenSheet: openSheet });
  initTools(document.querySelector('.board-wrap'), { onRedraw: redraw });
  initDiceTray(document.querySelector('.board-wrap'), document.getElementById('btn-dados-animados'));
  subscribe(refreshPalette);
  initScenes({ list: document.getElementById('scenes'), banner: document.getElementById('scene-banner') });
  initSidebar({ actors: document.getElementById('actors'), combat: document.getElementById('combat'), onOpenSheet: openSheet });
  initLibrary(document.getElementById('biblioteca'));
  initGenerator(document.getElementById('gerador'));
  initMusic(document.getElementById('btn-musica'));

  bindToolbar();
  bindChatInput();
  bindNet();
  bindShortcuts();
  initHistory();
  update(undefined, { historico: false }); // primeira renderização
  focusView();
  // para depurar no console do navegador (e para os testes de interface)
  window.omni = { state, local, scene, update, CONFIG, net, board: { worldToScreen, getView, getSelection, selectTokens }, setTool };
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
const store = {
  get: k => { try { return localStorage.getItem(k) || ''; } catch { return ''; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* navegador sem armazenamento */ } },
};
const savedName = () => store.get(NAME_KEY);
const saveName = n => store.set(NAME_KEY, n);
/** Autor das mensagens digitadas no chat. */
const author = () => (net.online ? net.nome : 'Mestre');

/** Identidade persistente deste navegador (é por ela que o mestre dá fichas aos jogadores). */
function playerId(params) {
  const forced = params.get('jid'); // só para testes (duas mesas no mesmo navegador)
  if (forced) return forced.slice(0, 64);
  let id = store.get('omni-jogador-id');
  if (!id) { id = 'j' + Math.random().toString(36).slice(2, 12); store.set('omni-jogador-id', id); }
  return id;
}

async function bootOnline(info) {
  const params = new URLSearchParams(location.search);
  const sala = cleanRoom(params.get('mesa'));
  // link de co-mestre (?mestre=chave): guarda a chave e tira do endereço, para não vazar ao copiar o link
  if (params.get('mestre')) store.set('omni-chave-' + sala, params.get('mestre'));
  const como = params.get('como') === 'jogador' ? 'jogador' : '';
  const clean = new URLSearchParams({ mesa: sala, ...(como && { como }), ...(params.get('jid') && { jid: params.get('jid') }) });
  if (location.search !== '?' + clean) history.replaceState(null, '', '?' + clean);
  const nome = savedName() || await askName();
  const existed = await connect({ sala, nome, info, jogador: playerId(params), chave: store.get('omni-chave-' + sala), como });
  if (existed) return;
  if (!isGM()) { toast('Esta mesa ainda não foi aberta pelo mestre. Ela aparece aqui assim que ele entrar.', 6000); return; }
  // mesa nova no servidor: começa com a mesa deste navegador (se houver) ou com o exemplo
  const saved = readLocalSave();
  if (saved?.atores?.length && confirm(`A mesa “${sala}” é nova. Usar nela a mesa salva neste navegador (${saved.atores.length} ficha(s))?\n\nCancelar = começar com a mesa de exemplo.`)) Object.assign(state, saved);
  else seedDemo();
}

/** body.jogador esconde o que é só do mestre (classe .so-mestre). */
function applyRoleClass() {
  document.body.classList.toggle('jogador', !isGM());
  const papel = document.getElementById('papel-badge');
  papel.hidden = !net.online;
  papel.textContent = isGM() ? '👑 Mestre' : (net.como ? 'Vendo como jogador' : 'Jogador');
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
    applyRoleClass();
  };
  onNetChange(render);
  btn.addEventListener('click', openNetDialog);
  render();
}

const fillPlayers = () => {
  const el = document.getElementById('net-players');
  el.innerHTML = net.jogadores.map(j => `<li>${j.mestre ? '👑 ' : ''}${esc(j.nome)}${j.cliente === net.cliente ? ' <small>(você)</small>' : ''}${j.mestre ? ' <small>mestre</small>' : ''}</li>`).join('') || '<li class="muted">Ninguém conectado.</li>';
};

function inviteLinks() {
  const path = `/vtt/?mesa=${encodeURIComponent(net.sala)}`;
  const links = [];
  if (net.info?.publico) links.push({ url: net.info.publico + path, nota: '🌐 internet — mande este para os amigos', destaque: true });
  const isLocal = ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);
  if (!isLocal && !links.some(l => l.url === location.origin + path)) links.push({ url: location.origin + path, nota: 'endereço que você está usando' });
  for (const ip of net.info?.enderecos || []) {
    const url = `http://${ip}:${net.info.porta}${path}`;
    if (!links.some(l => l.url === url)) links.push({ url, nota: 'mesma rede (Wi-Fi/cabo)' });
  }
  return links;
}

const linkRow = l => `<div class="invite ${l.destaque ? 'destaque' : ''}"><input readonly value="${esc(l.url)}"><button data-copy>Copiar</button><small>${esc(l.nota)}</small></div>`;

async function openNetDialog() {
  const w = makeWindow('net', 'Mesa compartilhada', { width: 480 });
  if (isGM()) await refreshInfo(); // o link público do túnel pode ter aparecido depois
  const links = inviteLinks();
  const base = links[0]?.url.split('/vtt/')[0] || location.origin;
  const coMestre = net.chave ? `${base}/vtt/?mesa=${encodeURIComponent(net.sala)}&mestre=${encodeURIComponent(net.chave)}` : '';
  w.body.innerHTML = `<div class="net-dialog">
    <p>Mesa <b>${esc(net.sala)}</b> · você é <b>${esc(net.nome)}</b> (${isGM() ? 'mestre' : 'jogador'})</p>
    <h4>Na mesa agora</h4><ul id="net-players" class="net-players"></ul>
    ${isGM() ? `<h4>Convidar jogadores</h4>
    ${links.map(linkRow).join('') || '<p class="muted">Nenhum endereço de rede encontrado.</p>'}
    ${net.info?.publico ? '' : `<p class="hint">Para jogar <b>pela internet</b>, feche o servidor e abra <code>jogar-online.bat</code> (ou <code>python servidor.py --online</code>): o link 🌐 aparece aqui. Precisa do cloudflared instalado uma vez (veja o README).</p>`}
    <p class="hint">Quem entra pelo link é <b>jogador</b>: vê só a cena ativa, mexe só nas fichas que você der a ele (🔑 na lista de fichas) e não vê o que estiver oculto.</p>
    ${coMestre ? `<details><summary>Link de co-mestre (não compartilhe com jogadores)</summary>${linkRow({ url: coMestre, nota: 'quem abrir vira mestre também' })}</details>` : ''}
    <p><a href="?mesa=${encodeURIComponent(net.sala)}&como=jogador" target="_blank" rel="noopener">Abrir uma aba vendo como jogador ↗</a></p>` : ''}
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
    const f = await pickFile('image/png,image/jpeg,image/webp,image/gif');
    if (!f) return;
    try { // o mapa vai para a biblioteca; a cena guarda só o endereço
      const { url, mini } = await guardarImagem(f);
      await usarComoMapa(addToLibrary({ tipo: 'imagem', nome: f.name.replace(/\.\w+$/, '').slice(0, 80), url, mini, mime: f.type }));
    } catch (e) { toast('Não consegui carregar o mapa: ' + e.message, 5000); }
  });
  on('btn-center', centerView);
  on('btn-scene', openSceneDialog);
  on('btn-rules', openRulesDialog);
  on('btn-export', exportTable);
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

  // abas do painel esquerdo (Biblioteca e Gerador alargam o painel)
  document.querySelectorAll('[data-panel]').forEach(b => b.addEventListener('click', () => {
    document.querySelectorAll('[data-panel]').forEach(x => x.setAttribute('aria-selected', x === b));
    document.querySelectorAll('.panel').forEach(p => (p.hidden = p.id !== b.dataset.panel));
    document.getElementById('app').classList.toggle('painel-largo', ['biblioteca', 'gerador'].includes(b.dataset.panel));
    redraw();
  }));
}

/** Exporta a mesa em JSON com as imagens embutidas (os endereços do servidor não funcionariam em outro lugar). */
async function exportTable() {
  const copia = JSON.parse(JSON.stringify(state));
  const cache = new Map();
  const embutir = async u => {
    if (!cache.has(u)) cache.set(u, fetch(u).then(r => r.blob()).then(b => new Promise(res => { const f = new FileReader(); f.onload = () => res(f.result); f.readAsDataURL(b); })).catch(() => u));
    return cache.get(u);
  };
  const imagem = /^\/api\/mesa\/[\w-]+\/arquivos\/[0-9a-f]{24}\.(png|jpg|webp|gif)$/;
  const andar = async o => {
    for (const [k, v] of Object.entries(o)) {
      if (typeof v === 'string' && imagem.test(v)) o[k] = await embutir(v);
      else if (v && typeof v === 'object') await andar(v);
    }
  };
  if (net.online) { toast('Preparando a exportação (com as imagens)…'); await andar(copia); }
  downloadFile(`omni-mesa-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(copia, null, 1));
}

function bindChatInput() {
  const form = document.getElementById('chat-form');
  form.addEventListener('submit', e => {
    e.preventDefault();
    const txt = form.msg.value.trim();
    if (!txt) return;
    const m = txt.match(/^\/(g?)r(?:oll)?\s+(\d*)d(\d+)\s*([+-]\s*\d+)?$/i);
    if (m) { // /r 2d10 · /gr 2d10 (rolagem oculta: só o mestre vê)
      const n = +(m[2] || 1), f = +m[3], mod = Number((m[4] || '0').replace(/\s/g, ''));
      const r = rollFormula(n, f);
      postSystem(`🎲 ${n}d${f}${mod ? (mod > 0 ? '+' : '') + mod : ''}: [${r.values.join(', ')}] = <b>${r.total + mod}</b>`, { autor: author(), ...(m[1] && { para: [] }) });
    } else if (/^\/m\s+/i.test(txt)) { // para o mestre
      postText(txt.replace(/^\/m\s+/i, ''), { autor: author(), para: [] });
    } else if (/^\/[sw]\s+/i.test(txt)) { // sussurro: /s Nome mensagem
      const resto = txt.replace(/^\/[sw]\s+/i, '');
      const jogs = Object.entries(state.jogadores || {}).sort((a, b) => b[1].nome.length - a[1].nome.length);
      const alvo = jogs.find(([, j]) => resto.toLowerCase().startsWith(j.nome.toLowerCase() + ' '));
      if (!alvo) { toast(`Para quem? Jogadores: ${jogs.map(([, j]) => j.nome).join(', ') || 'nenhum ainda'}. Para o mestre: /m mensagem`, 5000); return; }
      postText(resto.slice(alvo[1].nome.length + 1), { autor: author(), para: [alvo[0]] });
    } else if (txt.startsWith('/')) {
      toast('Comandos: /r 2d10 · /gr 2d10 (oculta) · /s Nome msg (sussurro) · /m msg (para o mestre)', 5000);
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
    <h4>Ferramentas (paleta no canto do mapa)</h4><ul>
      <li><b>V</b> selecionar · <b>R</b> régua com vários pontos (clique marca, duplo clique/Esc/botão direito termina; todos veem) · <b>D</b> desenho livre · <b>L</b> linha · <b>Q</b> retângulo · <b>C</b> círculo · <b>T</b> texto · <b>E</b> borracha.</li>
      <li><b>A</b> área de efeito (círculo, quadrado, cone de 45°, linha): arraste da origem; mostra o tamanho em zonas e destaca quem é atingido.</li>
      <li><b>F</b> névoa de guerra (mestre): arraste para revelar ou cobrir; os jogadores não recebem tokens que estão no escuro.</li>
      <li>🎲 no Registro liga/desliga os dados animados.</li></ul>
    <h4>Biblioteca (todos)</h4><ul>
      <li>Imagens, personagens, músicas e PDFs da mesa. <b>＋ Adicionar</b> ou arraste arquivos para a aba. Mapas e retratos enviados entram aqui sozinhos.</li>
      <li>Clique num item para: mostrar a todos (mestre), usar como mapa, usar como retrato da ficha, criar token, baixar.</li>
      <li><b>Personagens › Criação de token</b>: escolha a ilustração, arraste e use a roda do mouse para enquadrar, escolha forma e borda e salve (pode aplicar direto numa ficha).</li>
      <li><b>Músicas</b>: o mestre toca para todos; cada um ajusta o próprio volume no ♪ do topo.</li>
      <li>O que o mestre gera chega oculto (🔒); “Visível para todos” ou “Mostrar a todos” libera.</li></ul>
    <h4>Gerador de imagens (mestre)</h4><ul>
      <li>Roda no PC do mestre (ComfyUI). <b>Ligar gerador</b> na aba; <b>Desligar</b> libera a memória da placa.</li>
      <li><b>Cenário</b> (vista ou mapa visto de cima) e <b>Personagem</b> (corpo inteiro ou busto): ~10 s por imagem. Escreva em português.</li>
      <li><b>Cenário e personagem</b>: cite personagens da biblioteca com <b>@Nome</b> (e um cenário opcional); o modelo lê as ilustrações e põe os personagens na cena (~1–2 min).</li>
      <li><b>Ctrl+Enter</b> gera. “Avançado” mostra (e deixa editar) o texto enviado ao modelo.</li></ul>
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
