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

/**
 * How long an EMPTY fallback result is allowed to be cached.
 *
 * ─── THE BUG THIS NUMBER FIXES ──────────────────────────────────────────────
 *   «وقتی وارد بازار نمیشوی و روی یک کوین میزنی کرش میخوره ... اما بار دوم
 *    خوب میشه»
 *
 * Open a coin WITHOUT visiting the market list first — error screen. Tap again
 * — fine. That "second time works" shape is the diagnosis, and it is a
 * different bug from the chunk-loading one in lib/lazyRetry.js. The page
 * loads perfectly here; it is the DATA that is missing.
 *
 * The sequence, all of it inside this function:
 *
 *   1. A cold open fires several requests at once — coin, chart, btc chart,
 *      global, markets. CoinGecko's free tier rate-limits that burst, so
 *      `backend` and `direct` both throw for the coin.
 *   2. `fallback()` runs. For getCoin that is a lookup in a 50-coin offline
 *      snapshot, and any coin outside those 50 — PENGU, and most of the
 *      market list — is genuinely absent, so it returns **null**.
 *   3. That null is written into `memo` and served for the full 30s TTL.
 *      A now-healthy backend is never consulted.
 *   4. CoinDetail sees `coin === null` with nothing loading and renders
 *      "ارز پیدا نشد" with Back and Refresh buttons — the screen reported.
 *
 * Step 3 is the actual defect. Caching a SUCCESS for 30s is the point of this
 * function; caching "we found nothing" for 30s is caching a failure and
 * calling it data.
 *
 * ─── WHY IT WORKS THE SECOND TIME ───────────────────────────────────────────
 * Two independent reasons, which is why it feels so reliable:
 *   • by the second tap the burst has passed and the rate limit has reset;
 *   • and if the user went via the market list, `coins` is populated so
 *     CoinDetail's `find()` supplies the row without needing this call.
 * Hence "when you don't enter Market first" — that is precisely the path with
 * no second source of the same data.
 *
 * Four seconds is long enough to still absorb a genuine burst of duplicate
 * calls for the same key, and short enough that a user retrying by hand
 * always gets a real request.
 */
const EMPTY_TTL_MS = 4000;

/** Try the backend, then the public API, then the offline snapshot. */
async function resilient(key, { backend, direct, fallback, ttl = 30000 }) {
  const cached = memo.get(key);
  if (cached) {
    /*
     * An empty answer expires far sooner than a real one.
     *
     * `empty` is recorded at write time rather than re-derived here: by the
     * time we read it back, `[]` and `null` are indistinguishable from a
     * legitimately empty successful response, and treating a real empty list
     * as a failure would re-request it forever.
     */
    const maxAge = cached.empty ? Math.min(EMPTY_TTL_MS, ttl) : ttl;
    if (Date.now() - cached.at < maxAge) return cached.data;
  }

  let lastError = null;
  for (const attempt of [backend, direct]) {
    if (!attempt) continue;
    try {
      const data = await attempt();
      if (data) {
        memo.set(key, { at: Date.now(), data });
        return data;
      }
    } catch (err) {
      /*
       * Remembered, not swallowed. A caller that gets `null` cannot tell
       * "this coin does not exist" from "both sources were rate-limited",
       * and those two deserve completely different screens.
       */
      lastError = err;
    }
  }

  const data = fallback();
  /*
   * `stale` says the value came from the offline snapshot. `empty` says the
   * snapshot had nothing to give — the case that used to pin a null in place
   * for 30 seconds while the network recovered without us.
   */
  const empty = data == null || (Array.isArray(data) && data.length === 0);
  memo.set(key, { at: Date.now(), data, stale: true, empty, error: lastError });
  return data;
}

/**
 * Did the last attempt for this key fail because of the NETWORK, rather than
 * because the thing genuinely does not exist?
 *
 * Lets a screen say "try again in a moment" instead of "this coin does not
 * exist", which are opposite messages and only one of them is ever true.
 * Reads the cache rather than changing what `resilient` returns, so no caller
 * has to be updated to benefit.
 */
export function lastFetchFailed(key) {
  return Boolean(memo.get(key)?.error);
}

/** Forget one key so the next call is guaranteed to hit the network. */
export function invalidate(key) {
  memo.delete(key);
}

/** Clear all in-memory memoized API responses. */
export function clearApiCache() {
  memo.clear();
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

/**
 * SECTOR CATEGORIES — gold, memecoins, RWA, AI…
 *
 * ─── WHY THIS IS A SEPARATE FUNCTION AND NOT A FILTER ───────────────────────
 * The Market screen's existing filters (gainers, losers, volume) all re-sort
 * the SAME 250 rows already in memory. A sector cannot work that way: there
 * are only a handful of tokenized-gold tokens in existence and none of them
 * is in the top 250 by market cap, so filtering the loaded page for "gold"
 * would correctly return almost nothing.
 *
 * CoinGecko's `category` parameter queries the whole universe instead. It is
 * free, needs no key, and is the same endpoint we already use — verified
 * live before writing this: `category=tokenized-gold` returns XAUT, PAXG,
 * Kinesis and others, none of which appear in the default list.
 *
 * ─── WHY THE CATEGORY IDS ARE HARD-CODED ────────────────────────────────────
 * CoinGecko's category slugs are not guessable ("meme-token", not "memes";
 * "tokenized-gold", not "gold"). A wrong slug returns an empty array rather
 * than an error, which would render as a blank screen with no explanation.
 * The slugs below were each checked against the live API.
 */
export const MARKET_CATEGORIES = {
  gold: 'tokenized-gold',
  meme: 'meme-token',
  rwa: 'real-world-assets-rwa',
  ai: 'artificial-intelligence',
  gaming: 'gaming'
};

export function getCategory(category, { perPage = 50, vs = 'usd' } = {}) {
  const slug = MARKET_CATEGORIES[category];
  if (!slug) return Promise.resolve([]);

  return resilient(`cat:${slug}:${vs}:${perPage}`, {
    /*
     * Five minutes. A sector list moves far more slowly than a price ticker,
     * and every extra request here is spent against a free public rate limit
     * we share with the rest of the app.
     */
    ttl: 300_000,
    backend: () => fetchJson(`${API_BASE}/category/${slug}?per_page=${perPage}&vs=${vs}`),
    direct: async () => {
      const raw = await fetchJson(
        `${PUBLIC_CG}/coins/markets?vs_currency=${vs}&category=${slug}` +
          `&order=market_cap_desc&per_page=${perPage}&page=1&sparkline=true` +
          `&price_change_percentage=1h,24h,7d`
      );
      return raw.map(normalizeCoin);
    },
    /*
     * Empty, not the offline snapshot. That snapshot is the top coins by
     * market cap — showing Bitcoin under a "Gold" tab because the network was
     * down would be worse than an honest empty state.
     */
    fallback: () => []
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
/* Single coin                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Look up ONE coin by id.
 *
 * WHY THIS EXISTS
 * The coin detail screen used to search the already-loaded markets page for
 * the id and render "coin not found" when it wasn't there. That is not an API
 * failure — the markets list is paged (top 60 by market cap), so tapping any
 * coin found via search, trending, or a deep link outside that window always
 * produced the error, and it looked like the data provider was broken.
 *
 * Now the detail screen asks for the coin directly. Order: our backend, then
 * public CoinGecko `/coins/markets?ids=`, then the single-coin endpoint, then
 * the offline snapshot. Only a coin that exists nowhere returns null.
 */
/**
 * The memo key for one coin, exported so a screen can ask `lastFetchFailed()`
 * about it. Derived in one place because a hand-built key that drifts from
 * this one would silently always answer false.
 */
export const coinKey = (id, vs = 'usd') => `coin:${id}:${vs}`;

export function getCoin(id, vs = 'usd') {
  if (!id) return Promise.resolve(null);
  return resilient(coinKey(id, vs), {
    ttl: 30000,
    backend: () => fetchJson(`${API_BASE}/coin/${encodeURIComponent(id)}`),
    direct: async () => {
      // The markets endpoint gives us sparkline + 1h/7d changes in one call,
      // which is exactly the shape the detail screen renders.
      const rows = await fetchJson(
        `${PUBLIC_CG}/coins/markets?vs_currency=${vs}&ids=${encodeURIComponent(id)}` +
          `&sparkline=true&price_change_percentage=1h,24h,7d`
      );
      if (Array.isArray(rows) && rows[0]) return normalizeCoin(rows[0]);

      // Some ids only resolve on the detail endpoint (delisted, or an id that
      // came from /search rather than /markets).
      const raw = await fetchJson(
        `${PUBLIC_CG}/coins/${encodeURIComponent(id)}?localization=false&tickers=false` +
          `&market_data=true&community_data=false&developer_data=false`
      );
      const md = raw.market_data ?? {};
      return {
        id: raw.id,
        symbol: (raw.symbol || '').toUpperCase(),
        name: raw.name,
        image: raw.image?.large ?? raw.image?.small,
        price: md.current_price?.[vs] ?? 0,
        change1h: md.price_change_percentage_1h_in_currency?.[vs] ?? 0,
        change24h: md.price_change_percentage_24h ?? 0,
        change7d: md.price_change_percentage_7d ?? 0,
        mcap: md.market_cap?.[vs] ?? 0,
        volume: md.total_volume?.[vs] ?? 0,
        rank: raw.market_cap_rank ?? 0,
        high24h: md.high_24h?.[vs] ?? 0,
        low24h: md.low_24h?.[vs] ?? 0,
        ath: md.ath?.[vs] ?? 0,
        athChange: md.ath_change_percentage?.[vs] ?? 0,
        supply: md.circulating_supply ?? 0,
        description: raw.description?.en?.slice(0, 700) || '',
        homepage: raw.links?.homepage?.[0] || null,
        sparkline: md.sparkline_7d?.price ?? []
      };
    },
    fallback: () => offlineMarkets(250).find((c) => c.id === id) ?? null
  });
}

/**
 * Search the whole coin universe by name/ticker, not just the loaded page.
 * Falls back to filtering the offline snapshot so the box still does something
 * useful with no network.
 */
export function searchCoins(query) {
  const q = String(query || '').trim();
  if (q.length < 2) return Promise.resolve([]);
  return resilient(`search:${q.toLowerCase()}`, {
    ttl: 120000,
    backend: () => fetchJson(`${API_BASE}/search?q=${encodeURIComponent(q)}`),
    direct: async () => {
      const raw = await fetchJson(`${PUBLIC_CG}/search?query=${encodeURIComponent(q)}`);
      return (raw.coins || []).slice(0, 25).map((c) => ({
        id: c.id,
        symbol: (c.symbol || '').toUpperCase(),
        name: c.name,
        image: c.thumb || c.large,
        rank: c.market_cap_rank ?? 0
      }));
    },
    fallback: () => {
      const lower = q.toLowerCase();
      return offlineMarkets(250)
        .filter((c) => c.symbol.toLowerCase().includes(lower) || c.name.toLowerCase().includes(lower))
        .slice(0, 25);
    }
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

/**
 * OHLC candles.
 *
 * Deliberately NO offline fallback, unlike getChart. The bundled snapshot
 * holds closing prices only, so a fabricated candle would have to invent its
 * high and low — and those two numbers are the entire reason someone switched
 * to the candle view. Inventing them would be making up the data the user
 * came for. When it cannot load, the UI says so.
 */
export function getOhlc(id, days = 30, vs = 'usd') {
  return resilient(`ohlc:${id}:${days}`, {
    ttl: 60000,
    backend: () => fetchJson(`${API_BASE}/ohlc/${id}?days=${days}&vs=${vs}`),
    direct: async () => {
      const raw = await fetchJson(`${PUBLIC_CG}/coins/${id}/ohlc?vs_currency=${vs}&days=${days}`);
      return (Array.isArray(raw) ? raw : [])
        .map(([t, o, h, l, c]) => ({ t, o, h, l, c }))
        .filter((d) => [d.t, d.o, d.h, d.l, d.c].every(Number.isFinite) && d.h >= d.l);
    },
    fallback: () => []
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
