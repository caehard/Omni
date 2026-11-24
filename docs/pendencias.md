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
| D22 | Extra(N) | Sem tipo de dado, os dados extras usam o **dado do domínio da rolagem** (texto da palavra-chave atualizado) | 2.6 |
| D23 | Antidesarme | Para desarmá-lo, o oponente precisa vencer por **5 sucessos** (nível 2: 7; nível 3: não pode ser desarmado por meios não mágicos) | 3.1 Humanas |
| D24 | Resistência Elemental | Termos atualizados: **Absorção (+2/+4/+6)** contra o tipo elemental escolhido; nível 4: imunidade | 3.1 Místico |
| D25 | Pontos Heroicos | Só PJs gastam; o mestre só pela regra opcional | 2.2 |
| D26 | Alcance de armas | “Longo” = **Distante** | 2.5 |
| D27 | Armas improvisadas | Letal sem sinal: Letal(1)/(2)/(3) | 2.5 |
| D28 | Dano de morte | Dano que passa de 0 de Vida no mesmo golpe conta como Dano de Morte | 2.3 |
| D29 | Absorção por tipo | Geral + categoria + tipo específico, somadas; armadura equipada (valor fixo) substitui se for maior | 2.3 / 2.5 |
| D30 | Ponto Heroico | O dado extra pode usar a Maestria que sobrou | 2.2 |
| D31 | Virtude/Falha no TTS | Virtude no pior dado, Falha no melhor dado (escolha automática) | TTS |
| D32 | Cobertura de armadura | Pode ser comprada mais de uma vez (os 5 tipos físicos custam 3 pontos) | Apêndice 4.3 |
| D33 | Zonas ideais adicionais | Custam o valor da tabela + 1 | Apêndice 4.3 |
| D34 | Escudos | São armas (bloqueiam com Impacto + Bloqueio) | 2.5 |
| D35 | Catálogo | Arcabuz, Mosquete e Revólver em Incomum; Machadinha no lugar do Machado de Guerra comum; “Pike” → Pique | 2.5 |
| D36 | Ficha | Campo explícito de Atributo de Determinação (Raciocínio/Instinto) | Ficha |

## ❓ Pendências

Nenhuma pendência de regra aberta no momento.

### Adiado pelo autor
- Magias (“Pacotes > Magias”; tipos Mahi, Logi e Centi).
- Regras de Investigação e Exploração.
- Uso de Classes.
- Cidades (nomes de atributos nos exemplos, descrição de Infraestrutura, pontos de criação × construção).
