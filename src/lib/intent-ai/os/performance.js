/**
 * FBT INTENT OS — Performance Layer
 * Spec §36: Lazy Context, Tool Routing, Caching, Parallel Reads, Event-driven
 */

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

// Parallel reads helper
export async function parallelReads(tasks = {}) {
  const keys = Object.keys(tasks);
  const promises = keys.map(k => {
    try {
      const fn = tasks[k];
      return typeof fn === 'function' ? fn() : Promise.resolve(fn);
    } catch (e) {
      return Promise.resolve({ ok: false, error: e.message });
    }
  });
  
  const results = await Promise.allSettled(promises);
  const out = {};
  
  results.forEach((r, i) => {
    const key = keys[i];
    if (r.status === 'fulfilled') out[key] = r.value;
    else out[key] = { ok: false, error: r.reason?.message || 'FAILED' };
  });
  
  return out;
}

// Lazy context — only fetch what needed
export function createLazyContext({ walletService, portfolioService, marketService } = {}) {
  let walletCache = null;
  let portfolioCache = null;
  let marketCache = null;
  
  return {
    async getWallet() {
      if (walletCache) return walletCache;
      if (walletService?.getContext) {
        walletCache = await walletService.getContext();
        return walletCache;
      }
      return null;
    },
    
    async getPortfolio() {
      if (portfolioCache) return portfolioCache;
      if (portfolioService?.getSummary) {
        portfolioCache = await portfolioService.getSummary();
        return portfolioCache;
      }
      return null;
    },
    
    async getMarket() {
      if (marketCache) return marketCache;
      if (marketService?.getRelevantData) {
        marketCache = await marketService.getRelevantData();
        return marketCache;
      }
      return null;
    },
    
    // Parallel fetch for financial agent
    async getFinancialContext() {
      const [wallet, portfolio, market] = await Promise.all([
        this.getWallet().catch(() => null),
        this.getPortfolio().catch(() => null),
        this.getMarket().catch(() => null)
      ]);
      return { wallet, portfolio, market };
    },
    
    clear() {
      walletCache = null;
      portfolioCache = null;
      marketCache = null;
    }
  };
}

// Debounce for proactive suggestions
export function debounce(fn, delay = 300) {
  let timer = null;
  return (...args) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
}

// Throttle
export function throttle(fn, limit = 1000) {
  let inThrottle = false;
  return (...args) => {
    if (!inThrottle) {
      fn(...args);
      inThrottle = true;
      setTimeout(() => inThrottle = false, limit);
    }
  };
}
