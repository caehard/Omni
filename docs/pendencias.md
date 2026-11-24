# Decisões de Regra e Pendências

Este arquivo registra as **decisões já tomadas** sobre contradições do livro e os **pontos ainda em aberto**, que precisam de decisão do autor antes de serem implementados no TTS.

## ✅ Decisões aplicadas

| # | Tema | Decisão | Onde |
|---|---|---|---|
| D1 | Nomes antigos de atributos | Coordenação e Agilidade → **Destreza**; Resistência (atributo) → **Vitalidade**; Controle(Poder/Especial) → **Potência (Controle)**; Intelecto → **Raciocínio** | Livro inteiro |
| D2 | Fórmula de Vida | **1 + Resiliência (domínio) + 2 × Vitalidade** | 2.3 Vida |
| D3 | Noites em claro | “18 + Resiliência + Resistência” → **18 + 2 × Resiliência** horas (Resistência = domínio Resiliência, conforme D2) | Apêndice |
| D4 | Cansaço níveis 1–3 | Cada nível reduz em **1 os Pontos de Tempo máximos** | 2.3 Cansaço |
| D5 | Sobrecarga | Gera Cicatrizes Arcanas = **1 × nível da magia** | 2.6 e 2.8 |
| D6 | Resistência × Absorção | Dano final = dano − **Resistência Geral** (todo tipo exceto mental) − **Absorção** específica do tipo (armadura/habilidade). Mental usa Resistência Mental | 2.3 Resistência |
| D7 | Concentração | Paga conjuração **por ponto de vida perdido** (após resistência/absorção); perder sanidade sempre quebra | 2.6 e 2.8 |
| D8 | Falha de magia | Teste de **Potência (Controle)**; a rolagem de conjuração é reaproveitada se a magia pedir Potência no efeito (texto do autor) | 2.8 Falha |
| D9 | Teste de Aptidão | Frase estava invertida (“se **não** possuir… ocorre normalmente”). Corrigido para: possuir nível ≥ exigido → normal; caso contrário, desvantagem = diferença (coerente com o parágrafo seguinte) | 2.2 Teste |
| D10 | Categoria “Divino” | Ficha antiga e 3.1 usavam “Divino/divina”; padronizado como **Lendário** | Ficha e 3.1 |
| D11 | Dano “Concussão” | Padronizado como **Contundente** (tipo existente) | Tabela de armas |
| D12 | Estrutura de Status | Vale o livro: **4 Domínios × 2 Atributos** (a ficha antiga tinha 3 atributos por domínio) | Ficha |
| D13 | Numeração | Capítulos renumerados (não havia 2.4); seções do Apêndice numeradas 4.x | Livro |
| D14 | Mente de Ferro | Evita o **trauma** (não o cansaço) ao chegar a 50% de sanidade | 3.1 Fatores |
| D15 | Grande Guerreiro | Ignora os efeitos dos níveis 1–5 de cansaço; o cansaço ainda acumula e o nível 6 (testes contra a morte) se aplica | 3.1 Humanas |
| D16 | Recuperação | “Crítico” = **Grave**. Rápida: leve +1. Curta: grave +1, leve +3, **letal não recupera**. Variante rápida: letal usa a regra do grave, grave usa a do leve | 2.7 |
| D17 | “Ataque” | Não é palavra-chave, é ação básica. Ataque Otimizado: **Maestria(+1)** por uso; nível 3: **Maestria(+2)** por uso | 3.1 Humanas |
| D18 | Enriste | Basta a arma ser **média ou pesada** (2 pontos de criação) | Apêndice 4.3 |
| D19 | Armaduras | Sem pontos gastos em cobertura, a proteção base **não se aplica a nenhum tipo de dano**; é obrigatório gastar ≥ 1 ponto | Apêndice 4.3 |
| D20 | Tabela de armas/armaduras | Recriada: 46 armas e 12 armaduras, todas validadas pelo Criador de Equipamentos (`tools/equipamentos.py`) | 2.5 |
| D21 | Magias e seções incompletas | Adiadas pelo autor (magias, Investigação e Exploração, Classes, Cidades) | — |

## ❓ Pendências (precisam da sua decisão)

### Regras
6. **Extra(N)** exige tipo de dado, mas Superforça (“extra(2)”, “extra(4)”) e Velocista não informam o dado. Usar o dado do domínio do personagem?
7. **Antidesarme**: “Recebe vantagem(2)… igual ao nível de desarme” — texto confuso; qual o efeito por nível?
8. **Resistência Elemental** (Místico) usa “resistência elemental (+2)”; pelo D6, deveria ser **Absorção Elemental (+2)** do tipo escolhido?
9. **Pontos Heroicos** em Testes vs. Disputas: só podem ser gastos por PJs; o NPC do mestre usa a regra opcional. OK como está?
10. **Armas — Alcance**: a seção define “Curto / Longo / Distância(zona)”, mas as tabelas usam “Distante”. Tratei “Longo” = “Distante”.
11. **Armas improvisadas** usam “Letal(+1)” com sinal; nas demais armas é “Letal(N)”.

### Adiado pelo autor
13. Magias (“Pacotes > Magias”; tipos Mahi, Logi e Centi). 14. Investigação e Exploração. 15. Uso de Classes. 16. Cidades.

### Interpretações provisórias (confirme)
18. **Excesso de dano ao chegar a 0 de Vida**: o TTS conta o dano que passa de 0 no mesmo golpe como **Dano de Morte**.
19. **Absorção por tipo** = Geral + categoria (Física/Elemental) + tipo específico, somadas; uma **armadura equipada** (valor fixo) substitui esse total se for maior.
20. **Ponto Heroico** usa a Maestria que sobrou na rolagem para o dado extra.
21. **Virtude** transforma o pior dado em crítico; **Falha** transforma o melhor dado em falha (escolha automática no TTS).
22. **Cobertura de armadura** pode ser comprada mais de uma vez (ex.: 2 × “2 tipos físicos” = 4 tipos por 2 pontos; os 5 tipos físicos custam 3 pontos).
23. **Zonas ideais adicionais** (Distância) custam o valor da tabela + 1; no catálogo só usei zonas adicionais Distante/Longe (custo 1), evitando a ambiguidade.
24. **Escudos** foram criados como **armas** (bloqueiam com Impacto + Bloqueio), não como armaduras.
25. **Ajustes no catálogo para obedecer às regras**: Arcabuz, Mosquete e Revólver foram para **Incomum** (arma de fogo só existe a partir de incomum); o Machado de Guerra comum virou **Machadinha** (o de guerra ficou só em Incomum); “Pike” virou **Pique**.

### Ficha
17. Adicionei **Atributo de Determinação** (Raciocínio/Instinto) como campo explícito na ficha nova — confirme.
