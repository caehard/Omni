// Gerador de imagens: monta o pedido a partir do que o mestre escreveu (funções puras, testadas em tests.js).
// Calibração em data/gerador.json. O servidor (gerador.py) transforma o pedido num fluxo do ComfyUI.

const semAcento = s => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

const IRREGULARES = { man: 'men', woman: 'women', child: 'children', wolf: 'wolves', elf: 'elves', dwarf: 'dwarves', knife: 'knives', mouse: 'mice', foot: 'feet', tooth: 'teeth', thief: 'thieves', leaf: 'leaves', shelf: 'shelves', undead: 'undead', armor: 'armor', fish: 'fish', sheep: 'sheep' };
/** Plural da \u00faltima palavra de uma tradu\u00e7\u00e3o ("elf woman" -> "elf women"); adjetivos/vazios ficam como est\u00e3o. */
function pluralIngles(t) {
  if (!t || /\s(and|with|in)\s/.test(t)) return t;
  return t.replace(/(\w+)$/, w => IRREGULARES[w] || (/(s|x|ch|sh)$/.test(w) ? w + 'es' : /[^aeiou]y$/.test(w) ? w.slice(0, -1) + 'ies' : w + 's'));
}

/** Tradução palavra a palavra (o SDXL entende bem só inglês). Palavras desconhecidas passam como estão. */
export function traduzir(texto, glossario) {
  if (!glossario) return texto;
  const exp = Object.entries(glossario.expressoes || {}).filter(([k]) => !k.startsWith('_'))
    .map(([k, v]) => [semAcento(k), v]).sort((a, b) => b[0].length - a[0].length);
  const mapa = o => new Map(Object.entries(o || {}).filter(([k]) => !k.startsWith('_')).map(([k, v]) => [semAcento(k), v]));
  const pal = mapa(glossario.palavras), adj = mapa(glossario.adjetivos);
  // [forma em português, é plural?]: plural em português vira plural em inglês (mesas -> tables); adjetivo não varia
  const achar = w => {
    for (const t of [w, w.replace(/s$/, ''), w.replace(/a$/, 'o'), w.replace(/as$/, 'o'), w.replace(/es$/, ''), w.replace(/eis$/, 'el'), w.replace(/is$/, 'l')]) if (adj.has(t)) return adj.get(t);
    const tentativas = [[w, false], [w.replace(/a$/, 'o'), false], [w.replace(/s$/, ''), true], [w.replace(/es$/, ''), true], [w.replace(/as$/, 'os'), false],
      [w.replace(/as$/, 'o'), true], [w.replace(/oes$/, 'ao'), true], [w.replace(/aes$/, 'ao'), true], [w.replace(/ais$/, 'al'), true], [w.replace(/eis$/, 'el'), true], [w.replace(/is$/, 'l'), true]];
    for (const [t, plural] of tentativas) if (t !== w || !plural) { if (pal.has(t)) return plural && t !== w ? pluralIngles(pal.get(t)) : pal.get(t); }
    return null;
  };
  return texto.split(/([,.;:!?()\n]+)/).map(trecho => {
    if (/^[,.;:!?()\n]+$/.test(trecho)) return ', ';
    let t = ' ' + semAcento(trecho).replace(/\s+/g, ' ') + ' ';
    const orig = ' ' + trecho.replace(/\s+/g, ' ') + ' ';
    // expressões: troca no texto sem acento, mantendo um marcador para não traduzir de novo
    const feitas = [];
    for (const [k, v] of exp) {
      const re = new RegExp(`(?<=\\s)${k.replace(/[.*+?^${}()|[\]\\-]/g, '\\$&')}(?=\\s)`, 'g');
      t = t.replace(re, () => { feitas.push(v); return `\u0001${feitas.length - 1}\u0001`; });
    }
    const palavrasOrig = orig.trim().split(' ');
    const semOrig = palavrasOrig.map(semAcento);
    return t.trim().split(' ').map(w => {
      const m = /^\u0001(\d+)\u0001$/.exec(w);
      if (m) return feitas[+m[1]];
      if (w.startsWith('@')) return palavrasOrig[semOrig.indexOf(w)] ?? w; // menção: o nome fica como está
      const tr = achar(w);
      if (tr != null) return tr;
      const i = semOrig.indexOf(w);
      return i >= 0 ? palavrasOrig[i] : w; // nome próprio ou palavra em inglês: mantém como foi escrito
    }).filter(Boolean).join(' ');
  }).join('').replace(/\s+,/g, ',').replace(/,\s*,+/g, ',').replace(/\s{2,}/g, ' ').trim().replace(/^,|,$/g, '').trim();
}

/** @Nome no texto -> personagens da biblioteca citados (na ordem em que aparecem). Nomes com espaço funcionam. */
export function mencoes(texto, personagens) {
  const lista = [...personagens].filter(p => p.nome).sort((a, b) => b.nome.length - a.nome.length);
  const achados = [];
  const s = semAcento(texto);
  for (let i = s.indexOf('@'); i >= 0; i = s.indexOf('@', i + 1)) {
    const resto = s.slice(i + 1);
    const p = lista.find(p => resto.startsWith(semAcento(p.nome)) && !/[a-z0-9]/.test(resto[p.nome.length] || ''));
    if (p && !achados.includes(p)) achados.push(p);
  }
  return achados;
}

/** Troca @Nome por um texto (ex.: "Aria (the character in Picture 1)"). */
export function trocarMencoes(texto, personagens, fn) {
  const lista = [...personagens].filter(p => p.nome).sort((a, b) => b.nome.length - a.nome.length);
  let out = '', i = 0;
  while (i < texto.length) {
    if (texto[i] === '@') {
      const resto = semAcento(texto.slice(i + 1));
      const p = lista.find(p => resto.startsWith(semAcento(p.nome)) && !/[a-z0-9]/.test(resto[p.nome.length] || ''));
      if (p) { out += fn(p); i += 1 + p.nome.length; continue; }
    }
    out += texto[i++];
  }
  return out;
}

const preencher = (tpl, v) => tpl.replace(/\{(\w+)\}/g, (_, k) => v[k] ?? '');

/**
 * Monta o pedido para o servidor.
 * escolha: { modo, enquadramento, estilo, proporcao, texto, personagens (itens da biblioteca citáveis),
 *            cenarioRef (item ou null), extraRefs (itens escolhidos sem @), quantidade, semente, nome, negativoExtra, positivoFinal }
 * Devolve { pedido, item, refs, avisos }.
 */
export function montarPedido(escolha, cal) {
  const modo = cal.modos.find(m => m.id === escolha.modo) || cal.modos[0];
  const enq = modo.enquadramentos.find(e => e.id === escolha.enquadramento) || modo.enquadramentos[0];
  const estilo = cal.estilos.find(e => e.id === escolha.estilo) || cal.estilos[0];
  const avisos = [];
  const texto = (escolha.texto || '').trim();

  // referências (só no modo Cenário e personagem): citados com @, escolhidos à mão e um cenário opcional
  let refs = [];
  if (modo.id === 'cena') {
    const citados = mencoes(texto, escolha.personagens || []);
    for (const p of [...citados, ...(escolha.extraRefs || [])]) if (p.url && !refs.includes(p)) refs.push(p);
    const max = escolha.cenarioRef ? 2 : 3;
    if (refs.length > max) { avisos.push(`Só cabem ${max} personagens de referência${escolha.cenarioRef ? ' com um cenário' : ''}; os outros ficam de fora.`); refs = refs.slice(0, max); }
  }
  const usaQwen = modo.id === 'cena' && (refs.length > 0 || !!escolha.cenarioRef);
  const modelo = usaQwen ? 'qwen' : 'sdxl';
  const prop = cal.proporcoes.find(p => p.id === (escolha.proporcao || enq.proporcao || modo.proporcao)) || cal.proporcoes[0];
  const [largura, altura] = prop[modelo];
  const amostra = cal.amostragem[modelo];

  let positivo, negativo;
  if (usaQwen) {
    const q = modo.qwen;
    const imagens = [...refs];
    if (escolha.cenarioRef) imagens.push(escolha.cenarioRef);
    const n = p => imagens.indexOf(p) + 1;
    const cena = trocarMencoes(texto, refs, p => `${p.nome} (the character in Picture ${n(p)})`);
    positivo = [
      preencher(q.abertura, { estilo: estilo.qwen, proporcao: prop.id === 'retrato' ? 'portrait' : prop.id === 'quadrado' ? 'square' : 'landscape' }),
      ...refs.map(p => preencher(q.personagem, { n: n(p), nome: p.nome, descricao: p.descricao ? ` (${p.descricao.trim().replace(/\.$/, '')})` : '' })),
      escolha.cenarioRef ? preencher(q.cenario, { n: n(escolha.cenarioRef) }) : '',
      refs.length ? q.manter : '',
      preencher(q.cena, { texto: cena || 'the characters together in this place' }),
    ].filter(Boolean).join(' ');
    negativo = enq.negativo;
  } else {
    const assunto = traduzir(texto, cal.glossario) || 'an interesting place';
    positivo = [enq.prefixo + ' ' + assunto, enq.sufixo, estilo.sdxl].filter(Boolean).join(', ');
    negativo = enq.negativo;
  }
  if (escolha.positivoFinal?.trim()) positivo = escolha.positivoFinal.trim(); // o mestre editou o texto final
  if (escolha.negativoExtra?.trim()) negativo = [negativo, escolha.negativoExtra.trim()].filter(Boolean).join(', ');

  const semente = escolha.semente === '' || escolha.semente == null ? null : Number(escolha.semente);
  const imagensRef = [...refs, ...(usaQwen && escolha.cenarioRef ? [escolha.cenarioRef] : [])];
  return {
    pedido: {
      modelo, positivo, negativo, largura, altura, semente,
      passos: amostra.passos, cfg: amostra.cfg, sampler: amostra.sampler, scheduler: amostra.scheduler, shift: amostra.shift,
      quantidade: Math.max(1, Math.min(4, Number(escolha.quantidade) || 1)),
      refs: imagensRef.map(r => r.url),
    },
    item: {
      tipo: modo.tipo,
      nome: (escolha.nome || '').trim() || (texto ? texto.replace(/@/g, '').slice(0, 48) : modo.nome),
      descricao: modo.id === 'personagem' ? texto.replace(/@/g, '') : '',
      origem: { modo: modo.id, enquadramento: enq.id, estilo: estilo.id, proporcao: prop.id, texto, refs: imagensRef.map(r => r.id).filter(Boolean) },
    },
    refs: imagensRef,
    avisos,
  };
}
