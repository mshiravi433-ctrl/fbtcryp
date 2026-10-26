/**
 * DISCOVERY AI — rule-based natural-language interpreter for Web3 discovery.
 *
 * Runs entirely on-device as a fallback when the backend AI is unavailable.
 * It is honest about being a pattern matcher, not a model — the UI calls it
 * "AI Discovery" but shows a badge that says "on-device" when this path is used.
 *
 * Supported intents (spec §5):
 *   - "Find lending protocols on Arbitrum"
 *   - "Discover yield protocols on BNB Smart Chain"
 *   - "Compare DEX protocols across supported networks"
 *   - "Show newly discovered protocols with available security information"
 *
 * Mapping: extract (category, chain, sort, keywords) and return a structured
 * query that the filtering layer can execute deterministically.
 */

const CHAIN_KEYWORDS = {
  arbitrum: ['arbitrum', 'arb'],
  bsc: ['bsc', 'bnb', 'binance', 'bnb smart chain', 'binance smart chain'],
  eth: ['ethereum', 'eth', 'mainnet'],
  base: ['base'],
  polygon: ['polygon', 'matic', 'pol'],
  optimism: ['optimism', 'op'],
  avalanche: ['avalanche', 'avax'],
  sonic: ['sonic'],
  linea: ['linea'],
  solana: ['solana', 'sol'],
};

const CATEGORY_KEYWORDS = {
  lending: ['lending', 'borrow', 'lend', 'aave', 'compound', 'loan'],
  yield: ['yield', 'farm', 'vault', 'apy', 'earn', 'staking', 'yearn', 'pendle'],
  dex: ['dex', 'swap', 'exchange', 'uniswap', 'trading', 'amm'],
  bridges: ['bridge', 'bridges', 'cross-chain', 'cross chain', 'layerzero', 'wormhole', 'stargate'],
  analytics: ['analytics', 'analytic', 'data', 'chart', 'dashboard', ' dunes', 'nansen', 'defillama', 'explorer'],
  rwa: ['rwa', 'real world', 'treasury', 'ondo', 'centrifuge', 'tokenized'],
  nft: ['nft', 'opensea', 'blur', 'marketplace', 'collectible'],
  dev: ['developer', 'dev', 'tool', 'tooling', 'alchemy', 'infura', 'oracle', 'graph', 'tenderly'],
  defi: ['defi', 'decentralized finance'],
};

const SORT_KEYWORDS = {
  tvl: ['tvl', 'liquidity', 'biggest', 'largest', 'top'],
  volume: ['volume', 'trading', 'most traded', 'active'],
  yield: ['apy', 'yield', 'highest apy', 'earn'],
  new: ['new', 'newly', 'recent', 'fresh', 'recently listed', 'discovered'],
  trending: ['trending', 'hot', 'popular', 'compare', 'best'],
};

export function parseAiQuery(raw) {
  const q = String(raw || '').toLowerCase().trim();
  if (!q) return null;

  let chain = null;
  for (const [id, kws] of Object.entries(CHAIN_KEYWORDS)) {
    if (kws.some(kw => q.includes(kw))) { chain = id; break; }
  }

  let category = null;
  // Bridges / analytics / rwa / nft are more specific than dex/defi — check first
  const priority = ['bridges','analytics','rwa','nft','lending','yield','dex','dev','defi'];
  for (const cat of priority) {
    const kws = CATEGORY_KEYWORDS[cat];
    if (kws && kws.some(kw => q.includes(kw))) { category = cat === 'defi' ? 'all' : cat; break; }
  }

  let sort = 'tvl';
  if (/(new|recent|fresh|discovered)/i.test(q)) sort = 'new';
  else if (/(compare|trending|popular|hot)/i.test(q)) sort = 'trending';
  else if (/(volume|active|trading)/i.test(q)) sort = 'volume';
  else if (/(apy|yield)/i.test(q)) sort = 'yield';
  else if (/(tvl|liquidity|biggest)/i.test(q)) sort = 'tvl';

  const wantsSecurity = /(audit|security|safe|risk|warning|hack|verified)/i.test(q);
  const wantsCompare = /(compare|versus|vs\.?|difference)/i.test(q);
  const wantsNew = /(new|fresh|recent|discovered)/i.test(q);

  const keywords = q.split(/\s+/).filter(w => w.length > 2).slice(0, 8);

  return { raw, chain, category, sort, wantsSecurity, wantsCompare, wantsNew, keywords, q };
}

export function aiExplanation(parsed) {
  if (!parsed) return null;
  const parts = [];
  if (parsed.category && parsed.category !== 'all') parts.push(`category: ${parsed.category}`);
  if (parsed.chain) parts.push(`network: ${parsed.chain}`);
  if (parsed.sort !== 'tvl') parts.push(`sorted by ${parsed.sort}`);
  if (parsed.wantsSecurity) parts.push('with security info');
  if (parsed.wantsNew) parts.push('new protocols');
  if (parsed.wantsCompare) parts.push('comparison view');
  if (!parts.length) parts.push(`keywords: ${parsed.keywords.slice(0,3).join(', ')}`);
  return parts.join(' · ');
}

/**
 * Filter a registry array with a parsed AI query.
 * Falls back to keyword search if category/chain are null.
 */
export function filterByAiQuery(list, parsed) {
  if (!parsed) return list;
  let out = [...list];
  if (parsed.category && parsed.category !== 'all') {
    out = out.filter(p => p.category === parsed.category);
  }
  if (parsed.chain) {
    const alias = CHAIN_KEYWORDS[parsed.chain] || [parsed.chain];
    out = out.filter(p => {
      const hay = [...(p.chains||[]), ...(p.chainIds||[]).map(String)].join(' ').toLowerCase();
      return alias.some(a => hay.includes(a)) || (p.chains||[]).some(c => c.toLowerCase().includes(parsed.chain));
    });
  }
  if (parsed.wantsNew) {
    // New = flagged as fresh or with recent listing — here we approximate by featured=false + lower TVL?
    // We keep all matches but move dev/analytics to bottom; actual freshness comes from live API.
    out = [...out].sort((a,b) => (a.featured ? 1 : 0) - (b.featured ? 1 : 0));
  }
  if (parsed.keywords && parsed.keywords.length > 0 && !parsed.category && !parsed.chain) {
    const kws = parsed.keywords;
    out = out.filter(p => {
      const hay = `${p.name} ${p.domain} ${p.category} ${p.description||''}`.toLowerCase();
      return kws.some(kw => hay.includes(kw));
    });
  }
  return out;
}

/**
 * Example prompts shown in the UI. Must match spec §5 examples.
 */
export const AI_EXAMPLES = [
  'Find lending protocols on Arbitrum',
  'Discover yield protocols on BNB Smart Chain',
  'Compare DEX protocols across supported networks',
  'Show newly discovered protocols with available security information',
];

/**
 * Attempt to call the backend AI gateway for a natural-language discovery query.
 * Returns { answer, source } or null if unavailable — caller falls back to
 * rule-based parsing above.
 */
export async function callDiscoveryAi(query, { signal } = {}) {
  const base = (() => {
    try { return (import.meta.env?.VITE_API_BASE || '/api').replace(/\/+$/, ''); } catch { return '/api'; }
  })();
  const url = `${base}/v1/ai/discovery?q=${encodeURIComponent(query)}`;
  try {
    const res = await fetch(url, { signal, headers: { accept: 'application/json' } });
    if (!res.ok) return null;
    const body = await res.json().catch(() => null);
    if (!body?.data) return null;
    return { answer: body.data, source: body.meta?.source || 'ai-gateway' };
  } catch {
    return null;
  }
}
