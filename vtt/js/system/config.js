// Carrega os dados do sistema (pasta /data) — equivalente ao CONFIG.OMNI do Foundry.
export const CONFIG = {};

const FILES = {
  sistema: 'sistema.json',
  aptidoes: 'aptidoes.json',
  habilidades: 'habilidades.json',
  condicoes: 'condicoes.json',
  palavrasChave: 'palavras-chave.json',
  tiposDano: 'tipos-dano.json',
  equipamentos: 'equipamentos.json',
  tabelas: 'tabelas.json',
  gerador: 'gerador.json', // calibração do gerador de imagens (aba do mestre)
};

export async function loadConfig(base = '../data/') {
  const entries = await Promise.all(Object.entries(FILES).map(async ([k, f]) => {
    const res = await fetch(base + f);
    if (!res.ok) throw new Error(`Falha ao carregar ${f}: ${res.status}`);
    return [k, await res.json()];
  }));
  for (const [k, v] of entries) CONFIG[k] = v;

  // índices de acesso rápido
  CONFIG.aptidaoById = Object.fromEntries(CONFIG.aptidoes.aptidoes.map(a => [a.id, a]));
  CONFIG.habilidadeById = Object.fromEntries(CONFIG.habilidades.habilidades.map(h => [h.id, h]));
  CONFIG.condicaoById = Object.fromEntries(CONFIG.condicoes.condicoes.map(c => [c.id, c]));
  CONFIG.tipoDano = {};
  for (const cat of CONFIG.tiposDano.categorias)
    for (const t of cat.tipos) CONFIG.tipoDano[t.id] = { ...t, categoria: cat.id };
  return CONFIG;
}
