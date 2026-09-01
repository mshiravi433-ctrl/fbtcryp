/**
 * FBT INTENT OS — Performance
 * Spec §36: Lazy Context, Tool Routing, Caching, Parallel Reads, Event-driven
 */

export const PERF_SCHEMA = 'fbt.perf.v1';

const cache = new Map();
const CACHE_TTL = 30_000;

export function getCached(key) {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.at > CACHE_TTL) {
    cache.delete(key);
    return null;
  }
  return entry.value;
}

export function setCached(key, value, ttl = CACHE_TTL) {
  cache.set(key, { value, at: Date.now(), ttl });
}

export function clearCache() {
  cache.clear();
}

/**
 * Parallel reads example (Spec §36)
 * const [wallet, portfolio, market] = await Promise.all([
 *   walletService.getContext(),
 *   portfolioService.getSummary(),
 *   marketService.getRelevantData()
 * ]);
 */
export async function parallelFetch(tasks = {}) {
  const keys = Object.keys(tasks);
  const promises = keys.map(k => {
    const fn = tasks[k];
    if (typeof fn === 'function') {
      return fn().then(v => ({ key: k, value: v, ok: true })).catch(e => ({ key: k, error: e.message, ok: false }));
    }
    return Promise.resolve({ key: k, value: fn, ok: true });
  });
  
  const results = await Promise.all(promises);
  const out = {};
  
  for (const r of results) {
    out[r.key] = r.ok ? r.value : { ok: false, error: r.error, dataStatus: 'unavailable' };
  }
  
  return out;
}

/**
 * Lazy context — only fetch what's needed for intent
 */
export function getRequiredContextKeys(intentType) {
  const type = String(intentType || '').toUpperCase();
  
  if (['WALLET_BALANCE'].includes(type)) return ['wallet', 'balances'];
  if (['PORTFOLIO_ANALYSIS', 'REBALANCE'].includes(type)) return ['wallet', 'portfolio', 'balances'];
  if (['MARKET_ANALYSIS', 'MARKET_CONTEXT'].includes(type)) return ['market', 'news'];
  if (['YIELD_DISCOVERY', 'FARM', 'LEND'].includes(type)) return ['wallet', 'portfolio', 'yields'];
  if (['SWAP', 'BUY', 'SELL', 'BRIDGE'].includes(type)) return ['wallet', 'portfolio', 'balances', 'market'];
  if (['NEWS_SEARCH'].includes(type)) return ['news'];
  if (['OPEN_CALM', 'PLAY_MUSIC'].includes(type)) return [];
  if (['NAVIGATION'].includes(type)) return [];
  if (['SMART_MONEY', 'WHALE'].includes(type)) return ['market', 'smartMoney'];
  if (['INVESTMENT_PLAN', 'GOAL'].includes(type)) return ['wallet', 'portfolio', 'market', 'yields'];
  
  return ['wallet', 'portfolio', 'market'];
}

export async function buildLazyContext({ intentType, services = {}, walletState = null } = {}) {
  const keys = getRequiredContextKeys(intentType);
  const cacheKey = `lazy:${intentType}:${walletState?.address || 'anon'}`;
  
  const cached = getCached(cacheKey);
  if (cached) return cached;
  
  const tasks = {};
  
  if (keys.includes('wallet') && services.walletService?.getContext) {
    tasks.wallet = () => services.walletService.getContext();
  }
  if (keys.includes('portfolio') && services.portfolioService?.getSummary) {
    tasks.portfolio = () => services.portfolioService.getSummary();
  }
  if (keys.includes('market') && services.marketService?.getRelevantData) {
    tasks.market = () => services.marketService.getRelevantData();
  }
  if (keys.includes('balances') && services.walletService?.getBalances) {
    tasks.balances = () => services.walletService.getBalances({ address: walletState?.address });
  }
  if (keys.includes('yields') && services.yieldService?.discover) {
    tasks.yields = () => services.yieldService.discover({});
  }
  if (keys.includes('news') && services.newsService?.search) {
    tasks.news = () => services.newsService.search({ query: 'crypto', limit: 5 });
  }
  
  const result = await parallelFetch(tasks);
  setCached(cacheKey, result);
  
  return result;
}
