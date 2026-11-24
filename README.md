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
```

Abra **http://localhost:8000/vtt/**. Na primeira vez, uma mesa de exemplo é criada.
Testes: **/vtt/tests/** (regras e sincronização) e **/vtt/tests/multiplayer.html** (duas mesas abertas conversando);
o servidor tem os seus em `python tools/testar_servidor.py`.

> Abrir o `index.html` direto pelo arquivo (`file://`) não funciona: o navegador bloqueia o carregamento dos módulos e dos JSON.
> Servido por `python -m http.server`, o TTS funciona como antes, só neste navegador (sem multiplayer).

## Jogar online (multiplayer)

Com o `servidor.py` rodando, a mesa é **compartilhada**: todos que abrirem o link veem e mexem nas mesmas fichas, mapa, combate e chat, atualizando na hora.

1. O mestre roda o servidor e abre `http://localhost:8000/vtt/`. Na primeira vez o TTS pede o seu nome.
2. O botão com o nome da mesa (canto superior direito) mostra quem está conectado e os **links de convite**.
3. Cada jogador abre o link, informa o nome e entra.

Como os jogadores chegam até o seu PC:

| Situação | O que fazer |
|---|---|
| Mesma rede (Wi-Fi/cabo) | Use o link `http://192.168.x.x:8000/vtt/?mesa=...` mostrado no convite. No Windows, permita o Python no firewall quando ele perguntar. |
| Pela internet (mais fácil) | Instale o [cloudflared](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/) e rode `cloudflared tunnel --url http://localhost:8000`. Ele mostra um endereço `https://….trycloudflare.com`; envie `https://….trycloudflare.com/vtt/?mesa=principal`. Muda a cada execução. |
| Grupo fixo | [Tailscale](https://tailscale.com/) (rede privada entre os PCs do grupo) ou redirecionamento da porta 8000 no roteador. |

- **Mesas separadas**: `?mesa=nome` no endereço (ex.: uma por campanha). Cada uma fica salva em `mesas/<nome>.json` (fora do git).
- **Mesa nova**: o TTS oferece usar a mesa que você já tinha salva no navegador (modo local); senão, começa com o exemplo.
- **Alvo** (botão direito num token) é de cada jogador; o resto é compartilhado.
- Ainda **não há permissões**: quem tem o link pode editar tudo. Só o servidor serve as pastas `vtt/`, `data/` e `docs/` (o resto do repositório não fica exposto). A visão mestre × jogador é o próximo passo.

### Como a sincronização funciona

Toda mudança passa por `store.update()`. O cliente compara o estado com a última versão enviada (`vtt/js/core/sync-ops.js`) e manda só as diferenças por `POST`; listas com `id` (fichas, tokens, chat) são comparadas pelo identificador, para duas pessoas poderem adicionar coisas ao mesmo tempo. O servidor define a ordem, guarda o estado e repassa as mudanças a todos por Server-Sent Events; cada cliente reaplica por cima as suas mudanças ainda não confirmadas (`sync-client.js`), e todos convergem para o estado do servidor. Em caso de conflito no mesmo campo, vale a última mudança recebida pelo servidor.

### O que o protótipo faz

- **Fichas** de personagens e NPCs com todas as estatísticas derivadas calculadas (Vida, Sanidade, Pontos de Tempo, Evasão, Resistências, Pontos Especiais, Conjuração, Slots, Pontos Heroicos, nível e categoria pelos pontos de progressão) e avisos de limite por categoria.
- **Rolagens** de Teste e Disputa: dado pelo domínio, ND/NS, aptidão (inclusive parcial e teste de aptidão), Maestria distribuída automaticamente, Manuseio, Vantagem/Desvantagem, dados Extra, penalidades automáticas de cansaço e condições. No chat: **Ponto Heroico** em críticos, **Virtude** e **Falha**.
- **Ataque, bloqueio e esquiva** a partir das armas da ficha (dano = sucessos × Impacto + Brutal; ND = Evasão do alvo marcado no mapa; Desvantagem por zona em armas de Distância).
- **Catálogo** de 46 armas e 12 armaduras; armaduras equipadas aplicam absorção (valor fixo) e imobilidade.
- **Dano/cura/sanidade** com Resistência e Absorção por tipo, 50% da vida, Portas da Morte, grau de morte, Letal → Sangramento, Concentração.
- **Combate**: rodadas com duração, custo crescente de ação, Pontos Críticos, cansaço, sangramento, combustão, cicatrizes arcanas, recuperação de conjuração e rolagens de morte automáticas.
- **Mapa** com imagem de fundo, grade em blocos 2×2, tokens arrastáveis e **medição em zonas** (regra do Apêndice 4.1).
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
