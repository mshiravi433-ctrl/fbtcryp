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
//
// NOTE for the Android build: the APK serves its pages from https://localhost,
// so a relative '/api' has no host to resolve against. Set VITE_API_BASE to
// your deployed origin (e.g. https://fbt-swap.vercel.app/api) when building
// the APK. Market data still falls back to the public CoinGecko endpoints, but
// the AI routes have no fallback and simply won't work without it.
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

/**
 * One coin by id.
 *
 * WHY THIS EXISTS: CoinDetail used to look the coin up inside the 60-row
 * markets list. Anything outside the top 60 — every trending coin, every
 * search result, every bookmarked altcoin — rendered "coin not found" even
 * though the API knew about it perfectly well. It looked like the API was
 * broken; it was never asked.
 */
export function getCoin(id) {
  if (!id) return Promise.resolve(null);
  return resilient(`coin:${id}`, {
    ttl: 60000,
    backend: () => fetchJson(`${API_BASE}/coin/${id}`),
    direct: async () => {
      const c = await fetchJson(
        `${PUBLIC_CG}/coins/${encodeURIComponent(id)}` +
          '?localization=false&tickers=false&market_data=true&community_data=false&developer_data=false&sparkline=true'
      );
      const m = c.market_data ?? {};
      const pick = (o) => (o && typeof o === 'object' ? o.usd ?? 0 : o ?? 0);
      return {
        id: c.id,
        symbol: (c.symbol || '').toUpperCase(),
        name: c.name,
        image: c.image?.large ?? c.image?.small ?? c.image?.thumb ?? null,
        price: pick(m.current_price),
        change1h: m.price_change_percentage_1h_in_currency?.usd ?? 0,
        change24h: m.price_change_percentage_24h ?? 0,
        change7d: m.price_change_percentage_7d ?? 0,
        mcap: pick(m.market_cap),
        volume: pick(m.total_volume),
        rank: c.market_cap_rank ?? 0,
        high24h: pick(m.high_24h),
        low24h: pick(m.low_24h),
        ath: pick(m.ath),
        athChange: m.ath_change_percentage?.usd ?? 0,
        supply: m.circulating_supply ?? 0,
        sparkline: m.sparkline_7d?.price ?? [],
        description: typeof c.description?.en === 'string' ? c.description.en.slice(0, 1200) : '',
        homepage: c.links?.homepage?.find(Boolean) ?? null,
        categories: Array.isArray(c.categories) ? c.categories.filter(Boolean).slice(0, 6) : []
      };
    },
    // No offline record for an arbitrary coin — null lets the UI say "couldn't
    // load, retry" rather than inventing numbers for a real asset.
    fallback: () => null
  });
}

/**
 * Coin search across the whole CoinGecko universe (~17k assets), not just the
 * page of markets currently in memory.
 */
export function searchCoins(query) {
  const q = String(query ?? '').trim();
  if (q.length < 2) return Promise.resolve([]);
  return resilient(`search:${q.toLowerCase()}`, {
    ttl: 300000,
    backend: () => fetchJson(`${API_BASE}/search?q=${encodeURIComponent(q)}`),
    direct: async () => {
      const raw = await fetchJson(`${PUBLIC_CG}/search?query=${encodeURIComponent(q)}`);
      return (raw.coins || []).slice(0, 30).map((c) => ({
        id: c.id,
        symbol: (c.symbol || '').toUpperCase(),
        name: c.name,
        image: c.thumb ?? c.large ?? null,
        rank: c.market_cap_rank ?? 0
      }));
    },
    fallback: () => []
  });
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

/**
 * Crypto news. Refreshed at most once every 6 hours on the client and cached
 * 30 minutes on the server — a headline feed does not need to be live, and
 * every needless refresh spends the user's mobile data.
 */
export function getNews(limit = 30) {
  return resilient(`news:${limit}`, {
    ttl: 6 * 3600 * 1000,
    backend: () => fetchJson(`${API_BASE}/news?limit=${limit}`),
    direct: async () => {
      const raw = await fetchJson('https://min-api.cryptocompare.com/data/v2/news/?lang=EN&sortOrder=latest');
      const items = Array.isArray(raw?.Data) ? raw.Data : [];
      return items.slice(0, limit).map((n) => ({
        id: String(n.id ?? n.guid ?? n.url),
        title: String(n.title ?? '').slice(0, 240),
        body: String(n.body ?? '').slice(0, 600),
        url: n.url,
        source: n.source_info?.name ?? n.source ?? '',
        image: n.imageurl || null,
        publishedAt: Number(n.published_on ?? 0) * 1000,
        categories: String(n.categories ?? '').split('|').filter(Boolean).slice(0, 4)
      }));
    },
    fallback: () => []
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
