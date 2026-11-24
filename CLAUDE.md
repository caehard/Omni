# Omni — contexto do projeto

Sistema de RPG **autoral** (em testes) + **mesa virtual própria ("TTS")** para ele. O autor é o dono deste repositório; escreva com ele em **português**.

## Regras de trabalho (pedidas pelo autor)

1. **Toda mudança deve ser commitada e enviada** para `https://github.com/caehard/Omni` (branch `main`). Mensagens de commit em português.
2. **Em caso de dúvida sobre regras, pergunte ao autor antes de assumir.** O livro tem contradições conhecidas. Registre decisões e pendências em [`docs/pendencias.md`](docs/pendencias.md) (decisões D1–D36 e pendência P1 até agora).
3. Ao propor opções de regra, ofereça alternativas concretas (o autor escolhe).

## Estrutura

| Caminho | O que é |
|---|---|
| `docs/livro/*.md` | Livro de regras V4 em Markdown (fonte de verdade das regras), um arquivo por capítulo; índice + referência rápida em `docs/livro/README.md` |
| `docs/pendencias.md` | Decisões tomadas (tabela D#) e itens adiados |
| `docs/ficha/ficha.html` | Ficha imprimível A4 (3 páginas), estilo da ficha original do autor |
| `data/*.json` | Regras estruturadas lidas pelo TTS (sistema, aptidões, habilidades, condições, palavras-chave, tipos de dano, equipamentos, tabelas, modelo de personagem) |
| `vtt/` | Protótipo do TTS: HTML/CSS/JS puro (ES modules), sem build |
| `vtt/js/system/` | Lógica de regras, independente da UI (`dice.js`, `actor.js`, `combat.js`, `config.js`) — pensada para portar ao Foundry VTT |
| `vtt/js/ui/` | Interface (ficha, chat, diálogo de rolagem, mapa, painel lateral) |
| `vtt/js/core/store.js` | Estado único (`state`, compartilhado) + `local` (só deste jogador: alvo, cena vista). `scene()` = cena mostrada. `migrate()` converte mesas antigas (v1 `cena` → v2 `cenas[]` + `cenaAtiva`). Offline salva em localStorage; online chama o hook de sincronização |
| `vtt/js/core/history.js` | Ctrl+Z/Ctrl+Y: guarda as operações inversas das mudanças locais (não do chat nem dos outros jogadores) |
| `vtt/js/ui/board.js` | Mapa: tokens com `tamanho` 1–4, seleção (caixa/Shift), arrasto em grupo, ping (evento passageiro `/evento`), zonas |
| `vtt/js/ui/token-hud.js` · `ui/scenes.js` | Menu do token selecionado (canto do mapa) · aba Cenas e aviso de “vendo outra cena” |
| `vtt/js/ui/tools.js` · `ui/layers.js` | Paleta de ferramentas (régua com pontos compartilhada via evento `regua`, desenho, área, borracha, névoa) · desenho das camadas e geometria pura (áreas, névoa, borracha), em **quadrados**. `cena.desenhos[]` (cada um com `de` = autor) e `cena.nevoa = {ativa, revelado: {"x,y":1}}` |
| `vtt/js/ui/dice-tray.js` | Dados animados para cada rolagem nova (só visual; liga/desliga no 🎲 do Registro) |
| `vtt/js/core/sync-ops.js` | `diff`/`applyOps` do estado (set/del/ins; listas com `id`/`atorId` comparadas por identificador). **Espelhado em `servidor.py`** — mudou um, mude o outro e rode os dois testes |
| `vtt/js/core/sync-client.js` | Lógica de convergência sem rede (lotes pendentes, eco do próprio lote, reconexão) |
| `vtt/js/core/net.js` | Rede: SSE `/api/mesa/<nome>/eventos` + POST `/ops`, presença, status |
| `servidor.py` | Servidor da mesa (stdlib): serve só `vtt/`, `data/`, `docs/`; mesas em `mesas/<nome>.json` (gitignored, com a chave do mestre). **Papéis**: mestre = localhost sem cabeçalho de proxy, ou `chave`; jogador recebe `vista_jogador()` (sem ocultos, só a cena ativa, sem sussurros alheios) e cada op passa por `pode()`; recusa → o jogador recebe o estado de novo. Tem `diff` em Python (espelho do JS, casos em `vtt/tests/diff-casos.json`). `--online` abre túnel do cloudflared e expõe o link em `/api/ping` (`publico`) |
| `jogar-online.bat` / `.sh` | `servidor.py --online` |
| `vtt/tests/` | `index.html`: regras, sincronização, cenas, desfazer, permissões, filtro de HTML, geometria de áreas/névoa (146 passando) · `multiplayer.html`: dois mestres + um jogador (`?como=jogador&jid=`) em iframes, com cliques e arrastos sintéticos (36 passando, precisa do servidor; usa `window.omni`) · casos JS/Python em `sync-casos.json` e `diff-casos.json` |
| `tools/testar_servidor.py` | Testes do servidor (operações, diff, vista do jogador, névoa, desenhos, permissões, papéis via túnel/chave, protocolo, arquivos bloqueados) — 19 passando |
| `tools/extrair_habilidades.py` | Livro (cap. 08) → `data/habilidades.json`. Rode após editar habilidades |
| `tools/equipamentos.py` | Valida `data/equipamentos.json` pelos pontos de criação e regenera a tabela do livro (cap. 04, entre marcadores). Rode após editar equipamentos |
| `original/` | `.docx` V4 original e ficha antiga em PDF (não editar) |

## Como rodar e testar

```sh
./serve.sh   # ou: python servidor.py  (Windows: serve.bat)
python tools/testar_servidor.py
```
- TTS: http://localhost:8000/vtt/ · Testes: /vtt/tests/ e /vtt/tests/multiplayer.html
- Com `python -m http.server` o TTS roda em modo local (sem `/api/ping` → sem multiplayer).
- Não funciona via `file://` (módulos/JSON bloqueados).
- Não há Node; tudo é JS puro + Python 3. Para rodar os testes do navegador sem tela: Edge headless com `--dump-dom --virtual-time-budget` funciona para `/vtt/tests/`, mas **trava com SSE** — para `multiplayer.html` use `?relatar=1` (grava o resultado em `mesas/resultado-teste.json`) e encerre o Edge depois.

## Núcleo das regras (resumo)

- Rola **Atributo + 1** dados; tipo do dado pelo nível do **Domínio** (−1 d100, 0 d20, 1 d12, 2 d10, 3 d8, 4 d6, 5 d4, 6 d2). Dado ≤ ND = sucesso; 1 natural = crítico. Teste: sucessos ≥ NS. Disputa: mais sucessos vence.
- 4 Domínios × 2 Atributos: Fortitude (Força, Destreza), Resiliência (Vitalidade, Ritmo), Mental (Raciocínio, Instinto), Controle (Potência, Reserva).
- Vida = 1 + Resiliência + 2×Vitalidade · Sanidade = Determinação + 1 · PT = 1 + Ritmo + Resiliência − cansaço(1–3) · Evasão = 7 − Fortitude · Resistência Geral/Mental = triangular do domínio · Pontos Especiais = 1 + Reserva · Conjuração = Controle · Slots = Força + 5 · Heroicos = 2 × nível.
- Dano final = dano − Resistência (Geral, ou Mental p/ dano mental) − Absorção do tipo (armadura = valor fixo, substitui se maior).
- Recuperação: rápida (leve +1), curta (leve +3, grave +1, letal nada), prolongada (tudo).
- Distâncias em zonas; no mapa, blocos 2×2 e distância Manhattan em blocos (0 C, 1 D, 2–3 L, 4–7 ML, 8–15 EL, 16+ FC).

## Estado atual (2026-11-24)

- Feito: livro reformatado, ficha nova, dados JSON, TTS (fichas, rolagens, combate, dano/morte, mapa com zonas, descanso, armaduras, catálogo de 46 armas e 12 armaduras validadas).
- **Multiplayer por link** (2026-11-24): `servidor.py` + SSE/POST, várias mesas (`?mesa=`), nome do jogador, presença, convite, reconexão. Alvo é por jogador.
- **Jogar online + papéis** (2026-11-24): `jogar-online.bat` abre túnel cloudflared e mostra o link; mestre × jogador com permissões conferidas no servidor (donos das fichas via 🔑, fichas/tokens ocultos, `permissao` ver/nenhum, estimativa de vida, sussurros `/s`, `/m`, rolagem secreta `/gr`), link de co-mestre, “ver como jogador”, HTML do chat filtrado. Identidade do jogador = `omni-jogador-id` no localStorage.
- **Pesquisa de diferenciais** (pedido do autor): o que mais se elogia em VTTs — entrar por link sem conta (Owlbear), desenho tipo quadro branco e névoa de guerra (lista “mínimo” dos fóruns), dados animados (Dice So Nice, módulo muito instalado no Foundry), régua ao arrastar (Drag Ruler), música/ambiente (Alchemy).
- **Nenhuma pendência de regra aberta.** Adiados pelo autor: magias (tipos Mahi/Logi/Centi), Investigação e Exploração, Uso de Classes, Cidades.

- **Melhorias do VTT** (pedido do autor: ficar “fluido e completo como Roll20/Foundry”, mantendo o visual atual refinado). Plano em 4 pacotes, nesta ordem:
  1. ✅ Mapa e tokens: cenas, tamanhos, menu do token, ícones de condição, seleção múltipla, ping, desfazer.
  2. ✅ Desenho e medição: quadro branco, áreas de efeito (tamanho em zonas, atingidos), régua com vários pontos compartilhada.
  3. ✅ Mestre × jogador e névoa: papéis, donos, ocultos, sussurros, rolagens secretas, névoa (servidor filtra por jogador).
  4. Fluxo de jogo: ✅ dados animados. Falta: barra de ações rápidas, turno ativo destacado, diário/handouts, música ambiente.
- **Pendência de regra aberta: P1** (tamanho das áreas em zonas → blocos), em `docs/pendencias.md`.

## Próximos passos possíveis

1. Continuar os pacotes 2–4 acima.
2. Catálogo de magias quando o autor definir o sistema.
3. Futuro: portar `vtt/js/system` + `data/` para um sistema do Foundry VTT.

## Notas de ambiente

- No PC original, o `gh` ativo era outra conta sem permissão de push; o repositório usa um credential helper **local** com o token da conta `caehard`. Em outro PC, basta estar autenticado com uma conta que tenha push em `caehard/Omni`.
- PC Windows (desde 2026-11-24): sem `gh` e sem Node; Python 3.12 e Edge disponíveis. O push precisa que o autor se autentique uma vez (o terminal do Claude não abre janela de login).
