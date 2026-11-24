# Omni

Sistema de RPG autoral (em fase de testes) e sua **mesa virtual (TTS)** própria.

O Omni é um sistema de parada de dados: rola-se **Atributo + 1** dados, cujo tipo depende do nível do **Domínio** (d20 → d2), e cada dado **≤ ND** é um sucesso. Combate por **Pontos de Tempo**, distâncias por **zonas**, poderes com **Conjuração**, **Pontos Especiais** e **Variantes**.

## Estrutura do repositório

| Pasta | Conteúdo |
|---|---|
| [`docs/livro/`](docs/livro/README.md) | Livro de regras reformatado em Markdown, um arquivo por capítulo |
| [`docs/ficha/ficha.html`](docs/ficha/ficha.html) | Ficha imprimível (A4, 3 páginas). Abra no navegador → Imprimir → Salvar como PDF |
| [`docs/pendencias.md`](docs/pendencias.md) | Decisões de regra já tomadas e contradições ainda em aberto |
| [`data/`](data/) | Regras em JSON (lido pelo TTS): sistema, aptidões, habilidades, condições, palavras-chave, tipos de dano, equipamentos, tabelas |
| [`vtt/`](vtt/) | Protótipo da mesa virtual (HTML + CSS + JavaScript puro, sem instalação) |
| [`tools/`](tools/) | Scripts de manutenção: `extrair_habilidades.py` (livro → `data/habilidades.json`) e `equipamentos.py` (valida armas/armaduras pelos pontos de criação e regenera a tabela do livro) |
| [`original/`](original/) | Arquivos originais (livro `.docx` V4 e ficha antiga em PDF) |

## Como rodar o TTS

Precisa apenas de Python 3 (já vem no Linux/macOS) e de um navegador.

```sh
./serve.sh            # ou: python3 -m http.server 8000
```

Abra **http://localhost:8000/vtt/**. Na primeira vez, uma mesa de exemplo é criada.
Os testes das regras ficam em **http://localhost:8000/vtt/tests/**.

> Abrir o `index.html` direto pelo arquivo (`file://`) não funciona: o navegador bloqueia o carregamento dos módulos e dos JSON.

### O que o protótipo faz

- **Fichas** de personagens e NPCs com todas as estatísticas derivadas calculadas (Vida, Sanidade, Pontos de Tempo, Evasão, Resistências, Pontos Especiais, Conjuração, Slots, Pontos Heroicos, nível e categoria pelos pontos de progressão) e avisos de limite por categoria.
- **Rolagens** de Teste e Disputa: dado pelo domínio, ND/NS, aptidão (inclusive parcial e teste de aptidão), Maestria distribuída automaticamente, Manuseio, Vantagem/Desvantagem, dados Extra, penalidades automáticas de cansaço e condições. No chat: **Ponto Heroico** em críticos, **Virtude** e **Falha**.
- **Ataque, bloqueio e esquiva** a partir das armas da ficha (dano = sucessos × Impacto + Brutal; ND = Evasão do alvo marcado no mapa; Desvantagem por zona em armas de Distância).
- **Catálogo** de 46 armas e 12 armaduras; armaduras equipadas aplicam absorção (valor fixo) e imobilidade.
- **Dano/cura/sanidade** com Resistência e Absorção por tipo, 50% da vida, Portas da Morte, grau de morte, Letal → Sangramento, Concentração.
- **Combate**: rodadas com duração, custo crescente de ação, Pontos Críticos, cansaço, sangramento, combustão, cicatrizes arcanas, recuperação de conjuração e rolagens de morte automáticas.
- **Mapa** com imagem de fundo, grade em blocos 2×2, tokens arrastáveis e **medição em zonas** (regra do Apêndice 4.1).
- **Descanso** rápido, curto e prolongado. Regras opcionais ligáveis.
- Tudo salvo no navegador; **Exportar/Importar** a mesa em JSON.

## Rumo ao Foundry VTT

O código já está separado como um sistema do Foundry espera:

| Aqui | No Foundry |
|---|---|
| `data/*.json` | compêndios / `CONFIG.OMNI` |
| `data/modelo-personagem.json` | `template.json` / `TypeDataModel` do Actor |
| `vtt/js/system/actor.js` → `prepareDerived()` | `Actor.prepareDerivedData()` |
| `vtt/js/system/dice.js` | subclasse de `Roll` |
| `vtt/js/system/combat.js` | `Combat` / hooks de início de rodada |
| `vtt/js/ui/sheet.js` | `ActorSheet` |

A lógica de regras (`vtt/js/system/`) não depende da interface, então poderá ser reaproveitada quase integralmente.

## Próximos passos sugeridos

1. Resolver as pendências de [`docs/pendencias.md`](docs/pendencias.md).
2. Multiplayer (jogadores entrando por link) — o estado já passa por um único ponto (`vtt/js/core/store.js`), pronto para sincronizar via WebSocket.
3. Catálogo de magias (quando o sistema de magias estiver pronto).
4. Visão de jogador × mestre (fichas e tokens ocultos).
