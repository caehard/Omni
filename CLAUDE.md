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
| `vtt/js/core/store.js` | Estado único + persistência em localStorage (ponto de entrada para futuro multiplayer) |
| `vtt/tests/` | Testes das regras no navegador (61 passando) |
| `tools/extrair_habilidades.py` | Livro (cap. 08) → `data/habilidades.json`. Rode após editar habilidades |
| `tools/equipamentos.py` | Valida `data/equipamentos.json` pelos pontos de criação e regenera a tabela do livro (cap. 04, entre marcadores). Rode após editar equipamentos |
| `original/` | `.docx` V4 original e ficha antiga em PDF (não editar) |

## Como rodar e testar

```sh
./serve.sh   # ou python3 -m http.server 8000
```
- TTS: http://localhost:8000/vtt/ · Testes: http://localhost:8000/vtt/tests/
- Não funciona via `file://` (módulos/JSON bloqueados).
- Não há Node no PC original; tudo é JS puro + Python 3 para os scripts.

## Núcleo das regras (resumo)

- Rola **Atributo + 1** dados; tipo do dado pelo nível do **Domínio** (−1 d100, 0 d20, 1 d12, 2 d10, 3 d8, 4 d6, 5 d4, 6 d2). Dado ≤ ND = sucesso; 1 natural = crítico. Teste: sucessos ≥ NS. Disputa: mais sucessos vence.
- 4 Domínios × 2 Atributos: Fortitude (Força, Destreza), Resiliência (Vitalidade, Ritmo), Mental (Raciocínio, Instinto), Controle (Potência, Reserva).
- Vida = 1 + Resiliência + 2×Vitalidade · Sanidade = Determinação + 1 · PT = 1 + Ritmo + Resiliência − cansaço(1–3) · Evasão = 7 − Fortitude · Resistência Geral/Mental = triangular do domínio · Pontos Especiais = 1 + Reserva · Conjuração = Controle · Slots = Força + 5 · Heroicos = 2 × nível.
- Dano final = dano − Resistência (Geral, ou Mental p/ dano mental) − Absorção do tipo (armadura = valor fixo, substitui se maior).
- Recuperação: rápida (leve +1), curta (leve +3, grave +1, letal nada), prolongada (tudo).
- Distâncias em zonas; no mapa, blocos 2×2 e distância Manhattan em blocos (0 C, 1 D, 2–3 L, 4–7 ML, 8–15 EL, 16+ FC).

## Estado atual (2026-11-24)

- Feito: livro reformatado, ficha nova, dados JSON, TTS local (fichas, rolagens, combate, dano/morte, mapa com zonas, descanso, armaduras, catálogo de 46 armas e 12 armaduras validadas).
- **Nenhuma pendência de regra aberta.** Adiados pelo autor: magias (tipos Mahi/Logi/Centi), Investigação e Exploração, Uso de Classes, Cidades.

## Próximos passos possíveis

1. Multiplayer (jogadores entrando por link) — sincronizar `store.js` via WebSocket.
2. Visão mestre × jogador (fichas/tokens ocultos).
3. Catálogo de magias quando o autor definir o sistema.
4. Futuro: portar `vtt/js/system` + `data/` para um sistema do Foundry VTT.

## Notas de ambiente

- No PC original, o `gh` ativo era outra conta sem permissão de push; o repositório usa um credential helper **local** com o token da conta `caehard`. Em outro PC, basta estar autenticado com uma conta que tenha push em `caehard/Omni`.
