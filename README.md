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
| [`servidor.py`](servidor.py) | Servidor da mesa: serve o TTS e sincroniza a mesa entre os jogadores (só biblioteca padrão do Python) |
| [`tools/`](tools/) | Scripts de manutenção: `extrair_habilidades.py` (livro → `data/habilidades.json`), `equipamentos.py` (valida armas/armaduras pelos pontos de criação e regenera a tabela do livro) e `testar_servidor.py` (testes do servidor) |
| [`original/`](original/) | Arquivos originais (livro `.docx` V4 e ficha antiga em PDF) |

## Como rodar o TTS

Precisa apenas de Python 3 e de um navegador (nada para instalar com `pip`).

```sh
./serve.sh            # Linux/macOS  (ou: python3 servidor.py)
serve.bat             # Windows      (ou: python servidor.py)
jogar-online.bat      # Windows, com link pela internet (ou: python servidor.py --online)
```

Abra **http://localhost:8000/vtt/**. Na primeira vez, uma mesa de exemplo é criada.
Testes: **/vtt/tests/** (regras e sincronização) e **/vtt/tests/multiplayer.html** (duas mesas abertas conversando);
o servidor tem os seus em `python tools/testar_servidor.py`.

> Abrir o `index.html` direto pelo arquivo (`file://`) não funciona: o navegador bloqueia o carregamento dos módulos e dos JSON.
> Servido por `python -m http.server`, o TTS funciona como antes, só neste navegador (sem multiplayer).

## Jogar online com os amigos

**Uma vez só:** instale o túnel gratuito do Cloudflare (no Windows, no PowerShell):

```
winget install --id Cloudflare.cloudflared
```

**A cada sessão:**

1. Dê dois cliques em **`jogar-online.bat`** (Linux/macOS: `./jogar-online.sh`). A janela mostra `>>> Link para os amigos: https://….trycloudflare.com/vtt/?mesa=principal`.
2. Abra `http://localhost:8000/vtt/` — quem abre pelo **localhost** é o **mestre** (👑 no topo).
3. Mande o link 🌐 para os amigos (ele também aparece no botão da mesa, no canto superior direito). Quem entra por ele é **jogador**.
4. Para dar uma ficha a um jogador: 🔑 na lista de fichas → marque o nome dele. Os jogadores aparecem ali depois de entrarem uma vez.

O link muda a cada vez que o servidor abre. Sem o cloudflared, `serve.bat` funciona na **mesma rede** (Wi-Fi/cabo) com o link `http://192.168.x.x:8000/…` do convite — no Windows, permita o Python no firewall quando ele perguntar. Para um grupo fixo também dá para usar o [Tailscale](https://tailscale.com/).

### Mestre × jogador

| | Mestre | Jogador |
|---|---|---|
| Fichas | todas | edita as suas (🔑); vê as de personagens de outros só para leitura; NPCs ficam fechados (o mestre pode liberar) |
| Mapa | todas as cenas; tokens ocultos aparecem translúcidos | só a cena ativa; não recebe tokens ocultos; move só os próprios tokens |
| Vida de quem não é seu | número | estimativa (Ileso, Ferido, Muito ferido…) |
| Chat | vê tudo | não recebe sussurros alheios nem rolagens secretas |
| Combate, cenas, regras, NPCs | controla | — |

- **O servidor confere tudo**: cada jogador só recebe a sua vista da mesa e cada mudança que ele manda é checada (não adianta trapacear pelo console).
- **Chat**: `/s Nome mensagem` (sussurro), `/m mensagem` (só o mestre), `/gr 2d10` (rolagem secreta). No diálogo de rolagem, “Quem vê: Só o mestre”.
- **Ocultar**: no menu do token, 👁 Ocultar esconde o token; no 🔑, “Oculto” esconde a ficha e todos os tokens dela (emboscadas).
- **Co-mestre**: o botão da mesa tem um “link de co-mestre” (com uma chave secreta). **Ver como jogador**: o mesmo botão abre uma aba com a visão dos jogadores.
- **Mesas separadas**: `?mesa=nome` no endereço (ex.: uma por campanha). Cada uma fica salva em `mesas/<nome>.json` (fora do git).
- **Mesa nova**: o TTS oferece usar a mesa que você já tinha salva no navegador (modo local); senão, começa com o exemplo. Um jogador que chega antes do mestre espera ele abrir.
- Só as pastas `vtt/`, `data/` e `docs/` são servidas (o resto do repositório não fica exposto), e o HTML das mensagens é filtrado (nada de scripts vindos de outros jogadores).

### Como a sincronização funciona

Toda mudança passa por `store.update()`. O cliente compara o estado com a última versão enviada (`vtt/js/core/sync-ops.js`) e manda só as diferenças por `POST`; listas com `id` (fichas, tokens, chat) são comparadas pelo identificador, para duas pessoas poderem adicionar coisas ao mesmo tempo. O servidor define a ordem, guarda o estado e repassa as mudanças a todos por Server-Sent Events; cada cliente reaplica por cima as suas mudanças ainda não confirmadas (`sync-client.js`), e todos convergem para o estado do servidor. Em caso de conflito no mesmo campo, vale a última mudança recebida pelo servidor.

### O que o protótipo faz

- **Fichas** de personagens e NPCs com todas as estatísticas derivadas calculadas (Vida, Sanidade, Pontos de Tempo, Evasão, Resistências, Pontos Especiais, Conjuração, Slots, Pontos Heroicos, nível e categoria pelos pontos de progressão) e avisos de limite por categoria.
- **Rolagens** de Teste e Disputa: dado pelo domínio, ND/NS, aptidão (inclusive parcial e teste de aptidão), Maestria distribuída automaticamente, Manuseio, Vantagem/Desvantagem, dados Extra, penalidades automáticas de cansaço e condições. No chat: **Ponto Heroico** em críticos, **Virtude** e **Falha**.
- **Ataque, bloqueio e esquiva** a partir das armas da ficha (dano = sucessos × Impacto + Brutal; ND = Evasão do alvo marcado no mapa; Desvantagem por zona em armas de Distância).
- **Catálogo** de 46 armas e 12 armaduras; armaduras equipadas aplicam absorção (valor fixo) e imobilidade.
- **Dano/cura/sanidade** com Resistência e Absorção por tipo, 50% da vida, Portas da Morte, grau de morte, Letal → Sangramento, Concentração.
- **Combate**: rodadas com duração, custo crescente de ação, Pontos Críticos, cansaço, sangramento, combustão, cicatrizes arcanas, recuperação de conjuração e rolagens de morte automáticas.
- **Cenas**: várias por mesa, cada uma com mapa, grade e tokens. Uma é a dos jogadores; o mestre pode preparar outra sem tirá-los de onde estão.
- **Mapa** com imagem de fundo, grade em blocos 2×2 e **medição em zonas** (regra do Apêndice 4.1; tokens grandes contam da borda).
- **Tokens** de 1×1 a 4×4 com barra de vida, ícones de condição, marcas de alvo, Portas da Morte e morte; menu rápido do token selecionado (vida, sanidade, condições, tamanho, ficha, dano/cura); seleção múltipla com caixa e Shift; setas movem.
- **Ping** no mapa (Alt+clique; com Shift leva a visão de todos) e **desfazer/refazer** (Ctrl+Z / Ctrl+Y).
- **Descanso** rápido, curto e prolongado. Regras opcionais ligáveis.
- **Multiplayer** por link (veja acima), com lista de quem está conectado e reconexão automática.
- Mesa salva no servidor (ou no navegador, no modo local); **Exportar/Importar** a mesa em JSON.

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

1. Visão de jogador × mestre (fichas e tokens ocultos, permissões por ficha).
2. Catálogo de magias (quando o sistema de magias estiver pronto).
3. Portar para o Foundry VTT.
