/**
 * Market data layer.
 *
 * All requests go through our own backend (`/api/...`) which caches responses
 * and — crucially — keeps the CoinGecko / Kraken keys server-side. The browser
 * never sees an API key.
 *
 * If the backend is unreachable (e.g. you opened `npm run dev` without the
 * server), we degrade to the public CoinGecko endpoints and finally to a
 * deterministic offline dataset so the UI is never a blank screen.
 */

import { offlineGlobal, offlineMarkets, offlineTrending, offlineChart } from './offlineData';

// `import.meta.env` is Vite-only; guard it so the module also loads under
// plain bundlers / SSR / test harnesses.
const API_BASE = (typeof import.meta !== 'undefined' && import.meta.env?.VITE_API_BASE) || '/api';
const PUBLIC_CG = 'https://api.coingecko.com/api/v3';

const memo = new Map();

async function fetchJson(url, { timeout = 12000 } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { accept: 'application/json' } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

/** Try the backend, then the public API, then the offline snapshot. */
async function resilient(key, { backend, direct, fallback, ttl = 30000 }) {
  const cached = memo.get(key);
  if (cached && Date.now() - cached.at < ttl) return cached.data;

  for (const attempt of [backend, direct]) {
    if (!attempt) continue;
    try {
      const data = await attempt();
      if (data) {
        memo.set(key, { at: Date.now(), data });
        return data;
      }
    } catch {
      /* fall through to the next source */
    }
  }

  const data = fallback();
  memo.set(key, { at: Date.now(), data, stale: true });
  return data;
}

/* -------------------------------------------------------------------------- */
/* Global market stats (CoinLore shape)                                        */
/* -------------------------------------------------------------------------- */

export function getGlobal() {
  return resilient('global', {
    ttl: 45000,
    backend: () => fetchJson(`${API_BASE}/global`),
    direct: async () => {
      const raw = await fetchJson('https://api.coinlore.net/api/global/');
      return normalizeGlobal(Array.isArray(raw) ? raw[0] : raw);
    },
    fallback: () => offlineGlobal()
  });
}

export function normalizeGlobal(g = {}) {
  return {
    coins: Number(g.coins_count) || 0,
    markets: Number(g.active_markets) || 0,
    mcap: Number(g.total_mcap) || 0,
    volume: Number(g.total_volume) || 0,
    btcDominance: Number(g.btc_d) || 0,
    ethDominance: Number(g.eth_d) || 0,
    mcapChange: Number(g.mcap_change) || 0,
    volumeChange: Number(g.volume_change) || 0,
    avgChange: Number(g.avg_change_percent) || 0
  };
}

/* -------------------------------------------------------------------------- */
/* Coin markets                                                                */
/* -------------------------------------------------------------------------- */

export function getMarkets({ page = 1, perPage = 50, vs = 'usd' } = {}) {
  return resilient(`markets:${vs}:${page}:${perPage}`, {
    ttl: 30000,
    backend: () => fetchJson(`${API_BASE}/markets?page=${page}&per_page=${perPage}&vs=${vs}`),
    direct: async () => {
      const raw = await fetchJson(
        `${PUBLIC_CG}/coins/markets?vs_currency=${vs}&order=market_cap_desc&per_page=${perPage}` +
          `&page=${page}&sparkline=true&price_change_percentage=1h,24h,7d`
      );
      return raw.map(normalizeCoin);
    },
    fallback: () => offlineMarkets(perPage)
  });
}

export function normalizeCoin(c = {}) {
  return {
    id: c.id,
    symbol: (c.symbol || '').toUpperCase(),
    name: c.name,
    image: c.image,
    price: c.current_price ?? 0,
    change1h: c.price_change_percentage_1h_in_currency ?? 0,
    change24h: c.price_change_percentage_24h_in_currency ?? c.price_change_percentage_24h ?? 0,
    change7d: c.price_change_percentage_7d_in_currency ?? 0,
    mcap: c.market_cap ?? 0,
    volume: c.total_volume ?? 0,
    rank: c.market_cap_rank ?? 0,
    high24h: c.high_24h ?? 0,
    low24h: c.low_24h ?? 0,
    ath: c.ath ?? 0,
    athChange: c.ath_change_percentage ?? 0,
    supply: c.circulating_supply ?? 0,
    sparkline: c.sparkline_in_7d?.price ?? c.sparkline ?? []
  };
}

/* -------------------------------------------------------------------------- */
/* Trending / charts / DEX                                                     */
/* -------------------------------------------------------------------------- */

export function getTrending() {
  return resilient('trending', {
    ttl: 120000,
    backend: () => fetchJson(`${API_BASE}/trending`),
    direct: async () => {
      const raw = await fetchJson(`${PUBLIC_CG}/search/trending`);
      return (raw.coins || []).slice(0, 10).map(({ item }) => ({
        id: item.id,
        symbol: (item.symbol || '').toUpperCase(),
        name: item.name,
        image: item.small,
        rank: item.market_cap_rank,
        score: item.score
      }));
    },
    fallback: () => offlineTrending()
  });
}

export function getChart(id, days = 1, vs = 'usd') {
  return resilient(`chart:${id}:${days}`, {
    ttl: 60000,
    backend: () => fetchJson(`${API_BASE}/chart/${id}?days=${days}&vs=${vs}`),
    direct: async () => {
      const raw = await fetchJson(`${PUBLIC_CG}/coins/${id}/market_chart?vs_currency=${vs}&days=${days}`);
      return (raw.prices || []).map(([t, p]) => ({ t, p }));
    },
    fallback: () => offlineChart(id, days)
  });
}

/** GeckoTerminal — hottest DEX pools on a given network. */
export function getDexPools(network = 'bsc') {
  return resilient(`dex:${network}`, {
    ttl: 60000,
    backend: () => fetchJson(`${API_BASE}/dex/${network}`),
    direct: async () => {
      const raw = await fetchJson(`https://api.geckoterminal.com/api/v2/networks/${network}/trending_pools`);
      return (raw.data || []).slice(0, 12).map(normalizePool);
    },
    fallback: () => []
  });
}

export function normalizePool(p = {}) {
  const a = p.attributes || {};
  return {
    id: p.id,
    name: a.name,
    price: Number(a.base_token_price_usd) || 0,
    change24h: Number(a.price_change_percentage?.h24) || 0,
    volume24h: Number(a.volume_usd?.h24) || 0,
    liquidity: Number(a.reserve_in_usd) || 0,
    dex: p.relationships?.dex?.data?.id || '—'
  };
}

/** Simple spot price for a handful of symbols — used by the trade screen. */
export async function getSimplePrices(ids = []) {
  if (!ids.length) return {};
  const key = `simple:${ids.join(',')}`;
  return resilient(key, {
    ttl: 20000,
    backend: () => fetchJson(`${API_BASE}/prices?ids=${ids.join(',')}`),
    direct: () => fetchJson(`${PUBLIC_CG}/simple/price?ids=${ids.join(',')}&vs_currencies=usd&include_24hr_change=true`),
    fallback: () =>
      Object.fromEntries(
        offlineMarkets(60)
          .filter((c) => ids.includes(c.id))
          .map((c) => [c.id, { usd: c.price, usd_24h_change: c.change24h }])
      )
  });
}
