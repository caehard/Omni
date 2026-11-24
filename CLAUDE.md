# Omni — contexto do projeto

Sistema de RPG **autoral** (em testes) + **mesa virtual própria ("TTS")** para ele. O autor é o dono deste repositório; escreva com ele em **português**.

## Regras de trabalho (pedidas pelo autor)

1. **Toda mudança deve ser commitada e enviada** para `https://github.com/caehard/Omni` (branch `main`). Mensagens de commit em português.
2. **Em caso de dúvida sobre regras, pergunte ao autor antes de assumir.** O livro tem contradições conhecidas. Registre decisões e pendências em [`docs/pendencias.md`](docs/pendencias.md) (decisões D1–D36 até agora).
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
| `vtt/js/core/store.js` | Estado único (`state`, compartilhado) + `local` (só deste jogador, ex.: alvo). Offline salva em localStorage; online chama o hook de sincronização |
| `vtt/js/core/sync-ops.js` | `diff`/`applyOps` do estado (set/del/ins; listas com `id`/`atorId` comparadas por identificador). **Espelhado em `servidor.py`** — mudou um, mude o outro e rode os dois testes |
| `vtt/js/core/sync-client.js` | Lógica de convergência sem rede (lotes pendentes, eco do próprio lote, reconexão) |
| `vtt/js/core/net.js` | Rede: SSE `/api/mesa/<nome>/eventos` + POST `/ops`, presença, status |
| `servidor.py` | Servidor da mesa (stdlib): serve só `vtt/`, `data/`, `docs/`; mesas em `mesas/<nome>.json` (gitignored) |
| `vtt/tests/` | `index.html`: regras + sincronização (101 passando) · `multiplayer.html`: duas mesas em iframes (7 passando, precisa do servidor) · casos compartilhados JS/Python em `sync-casos.json` |
| `tools/testar_servidor.py` | Testes do servidor (operações, protocolo, arquivos bloqueados) |
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
- **Multiplayer por link** (2026-11-24): `servidor.py` + SSE/POST, várias mesas (`?mesa=`), nome do jogador, presença, convite com links da rede local, reconexão. Alvo virou por jogador. Sem permissões ainda (qualquer um edita tudo). Jogar pela internet = túnel (cloudflared) ou Tailscale, documentado no README.
- **Nenhuma pendência de regra aberta.** Adiados pelo autor: magias (tipos Mahi/Logi/Centi), Investigação e Exploração, Uso de Classes, Cidades.

## Próximos passos possíveis

1. Visão mestre × jogador: papel de mestre, dono de cada ficha, fichas/tokens/rolagens ocultos. Vai exigir o servidor filtrar o estado por jogador (hoje todos recebem tudo).
2. Catálogo de magias quando o autor definir o sistema.
3. Futuro: portar `vtt/js/system` + `data/` para um sistema do Foundry VTT.

## Notas de ambiente

- No PC original, o `gh` ativo era outra conta sem permissão de push; o repositório usa um credential helper **local** com o token da conta `caehard`. Em outro PC, basta estar autenticado com uma conta que tenha push em `caehard/Omni`.
- PC Windows (desde 2026-11-24): sem `gh` e sem Node; Python 3.12 e Edge disponíveis. O push precisa que o autor se autentique uma vez (o terminal do Claude não abre janela de login).
