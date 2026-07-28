/**
 * Upstream market-data providers.
 *
 * Keys live here (server-side, from env) and are never shipped to the browser.
 * Every provider has a timeout and normalises into the shape `src/lib/api.js`
 * expects, so the client doesn't care which source answered.
 */

const CG_BASE = process.env.COINGECKO_BASE || 'https://api.coingecko.com/api/v3';
const CG_PRO_BASE = 'https://pro-api.coingecko.com/api/v3';
const GT_BASE = 'https://api.geckoterminal.com/api/v2';
const COINLORE_BASE = 'https://api.coinlore.net/api';

const CG_KEY = process.env.COINGECKO_API_KEY || '';
const CG_IS_PRO = process.env.COINGECKO_PLAN === 'pro';

const TIMEOUT_MS = Number(process.env.UPSTREAM_TIMEOUT_MS || 12000);

async function req(url, { headers = {}, timeout = TIMEOUT_MS } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { accept: 'application/json', 'user-agent': 'fbt-swap-app/1.0', ...headers }
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      const err = new Error(`Upstream ${res.status} for ${url}: ${body.slice(0, 160)}`);
      err.status = res.status;
      throw err;
    }
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

function cgUrl(path, params = {}) {
  const base = CG_IS_PRO ? CG_PRO_BASE : CG_BASE;
  const qs = new URLSearchParams(params);
  if (CG_KEY) qs.set(CG_IS_PRO ? 'x_cg_pro_api_key' : 'x_cg_demo_api_key', CG_KEY);
  return `${base}${path}?${qs.toString()}`;
}

/* ------------------------------- normalisers ------------------------------ */

export function normalizeCoin(c) {
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
    sparkline: c.sparkline_in_7d?.price ?? []
  };
}

function normalizeGlobalLore(g = {}) {
  return {
    coins: Number(g.coins_count) || 0,
    markets: Number(g.active_markets) || 0,
    mcap: Number(g.total_mcap) || 0,
    volume: Number(g.total_volume) || 0,
    btcDominance: Number(g.btc_d) || 0,
    ethDominance: Number(g.eth_d) || 0,
    mcapChange: Number(g.mcap_change) || 0,
    volumeChange: Number(g.volume_change) || 0,
    avgChange: Number(g.avg_change_percent) || 0,
    source: 'coinlore'
  };
}

function normalizeGlobalCg(raw = {}) {
  const d = raw.data ?? {};
  return {
    coins: d.active_cryptocurrencies ?? 0,
    markets: d.markets ?? 0,
    mcap: d.total_market_cap?.usd ?? 0,
    volume: d.total_volume?.usd ?? 0,
    btcDominance: d.market_cap_percentage?.btc ?? 0,
    ethDominance: d.market_cap_percentage?.eth ?? 0,
    mcapChange: d.market_cap_change_percentage_24h_usd ?? 0,
    volumeChange: 0,
    avgChange: 0,
    source: 'coingecko'
  };
}

/* -------------------------------- endpoints ------------------------------- */

/** CoinLore first (no key, richer fields), CoinGecko as the fallback. */
export async function fetchGlobal() {
  try {
    const raw = await req(`${COINLORE_BASE}/global/`);
    return normalizeGlobalLore(Array.isArray(raw) ? raw[0] : raw);
  } catch {
    const raw = await req(cgUrl('/global'));
    return normalizeGlobalCg(raw);
  }
}

export async function fetchMarkets({ page = 1, perPage = 50, vs = 'usd' } = {}) {
  const raw = await req(
    cgUrl('/coins/markets', {
      vs_currency: vs,
      order: 'market_cap_desc',
      per_page: String(Math.min(250, perPage)),
      page: String(page),
      sparkline: 'true',
      price_change_percentage: '1h,24h,7d'
    })
  );
  return raw.map(normalizeCoin);
}

export async function fetchTrending() {
  const raw = await req(cgUrl('/search/trending'));
  return (raw.coins || []).slice(0, 10).map(({ item }) => ({
    id: item.id,
    symbol: (item.symbol || '').toUpperCase(),
    name: item.name,
    image: item.small,
    rank: item.market_cap_rank,
    score: item.score
  }));
}

export async function fetchChart(id, days = 1, vs = 'usd') {
  const raw = await req(cgUrl(`/coins/${encodeURIComponent(id)}/market_chart`, { vs_currency: vs, days: String(days) }));
  return (raw.prices || []).map(([t, p]) => ({ t, p }));
}

export async function fetchSimplePrices(ids = [], vs = 'usd') {
  if (!ids.length) return {};
  return req(cgUrl('/simple/price', { ids: ids.join(','), vs_currencies: vs, include_24hr_change: 'true' }));
}

/** GeckoTerminal trending DEX pools (no key required). */
export async function fetchDexPools(network = 'bsc') {
  const raw = await req(`${GT_BASE}/networks/${encodeURIComponent(network)}/trending_pools`);
  return (raw.data || []).slice(0, 12).map((p) => {
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
  });
}

/**
 * One coin, in the SAME shape as a `/markets` row.
 *
 * The client's coin screen renders market rows, so returning a different shape
 * here meant the detail page silently lost 1h/7d change, high/low and the
 * sparkline. We try `/coins/markets?ids=` first for exactly that reason and
 * only fall back to the heavier detail endpoint for ids it does not cover.
 */
export async function fetchCoinDetail(id, vs = 'usd') {
  try {
    const rows = await req(
      cgUrl('/coins/markets', {
        vs_currency: vs,
        ids: id,
        sparkline: 'true',
        price_change_percentage: '1h,24h,7d'
      })
    );
    if (Array.isArray(rows) && rows[0]) return normalizeCoin(rows[0]);
  } catch {
    /* fall through to the detail endpoint */
  }

  const raw = await req(
    cgUrl(`/coins/${encodeURIComponent(id)}`, {
      localization: 'false',
      tickers: 'false',
      market_data: 'true',
      community_data: 'false',
      developer_data: 'false'
    })
  );
  const md = raw.market_data || {};
  return {
    id: raw.id,
    symbol: (raw.symbol || '').toUpperCase(),
    name: raw.name,
    image: raw.image?.large ?? raw.image?.small,
    description: raw.description?.en?.slice(0, 700) || '',
    homepage: raw.links?.homepage?.[0] || null,
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
    atl: md.atl?.[vs] ?? 0,
    athChange: md.ath_change_percentage?.[vs] ?? 0,
    supply: md.circulating_supply ?? 0,
    sparkline: md.sparkline_7d?.price ?? []
  };
}

/** Universe-wide coin search by name or ticker. */
export async function fetchSearch(query) {
  const raw = await req(cgUrl('/search', { query }));
  return (raw.coins || []).slice(0, 25).map((c) => ({
    id: c.id,
    symbol: (c.symbol || '').toUpperCase(),
    name: c.name,
    image: c.thumb || c.large,
    rank: c.market_cap_rank ?? 0
  }));
}
