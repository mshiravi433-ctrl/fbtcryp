/*
 * Adapter for CoinLore's public ticker rows. Shared by the server and the
 * browser fallback so field normalization, canonical IDs, paging and
 * fail-closed handling never drift between the two paths.
 */
const COINLORE_ID_ALIASES = Object.freeze({
  'binance-coin': 'binancecoin',
  avalanche: 'avalanche-2',
  polygon: 'matic-network',
  'near-protocol': 'near',
  injective: 'injective-protocol',
  pancakeswap: 'pancakeswap-token',
  render: 'render-token',
  worldcoin: 'worldcoin-wld',
  jupiter: 'jupiter-exchange-solana',
  'floki-inu': 'floki',
  hedera: 'hedera-hashgraph',
  immutable: 'immutable-x',
  sei: 'sei-network'
});

/** CoinLore answers at most 100 tickers per request, whatever limit is asked. */
export const COINLORE_MAX_PAGE_SIZE = 100;

/** CoinLore quotes USD only; a caller passing anything else must not relabel it. */
export const COINLORE_BASE = 'https://api.coinlore.net/api';

/**
 * ONE page of tickers, however many upstream requests that takes.
 *
 * ─── WHY THIS LOOPS ─────────────────────────────────────────────────────────
 * The market screen asks for 250 rows and a single CoinLore request answers
 * 100 of them, so the fallback page used to arrive a hundred rows short — the
 * same "بقیه توکن‌ها نیومدن" shape as the missing visuals, one layer lower.
 * Paging here (250 = three requests, in order, stopping early at the end of
 * the list) restores the page length the primary feed used to give, and it
 * lives in the shared adapter so the server and the browser fallback cannot
 * page differently.
 *
 * @param {object} opts
 * @param {(url: string, opts?: object) => Promise<any>} opts.fetchJson
 * @param {string} [opts.base]
 * @param {number} [opts.page]    1-based, in units of `perPage`
 * @param {number} [opts.perPage] how many rows the caller wants
 * @param {number} [opts.maxPages] hard cap on upstream requests
 * @returns {Promise<Array<object>>} normalized, valid rows
 */
export async function fetchCoinLoreTickers({
  fetchJson,
  base = COINLORE_BASE,
  page = 1,
  perPage = COINLORE_MAX_PAGE_SIZE,
  maxPages = 3
} = {}) {
  const requested = Math.max(1, Math.min(250, Math.floor(Number(perPage) || COINLORE_MAX_PAGE_SIZE)));
  const firstStart = (Math.max(1, Math.floor(Number(page) || 1)) - 1) * requested;
  const rows = [];

  for (let chunk = 0; chunk < Math.max(1, maxPages) && rows.length < requested; chunk += 1) {
    const start = firstStart + chunk * COINLORE_MAX_PAGE_SIZE;
    const limit = Math.min(COINLORE_MAX_PAGE_SIZE, requested - rows.length);
    /* eslint-disable no-await-in-loop */
    const raw = await fetchJson(`${base}/tickers/?start=${start}&limit=${limit}`);
    if (!Array.isArray(raw?.data)) {
      if (!rows.length) throw new Error('CoinLore returned an invalid market response');
      break;
    }
    const batch = raw.data.map(normalizeCoinLoreMarket).filter(Boolean);
    if (!batch.length) break;
    rows.push(...batch);
    /* A short page is the end of the list, not a reason to ask again. */
    if (raw.data.length < limit) break;
  }

  if (!rows.length) throw new Error('CoinLore returned no usable market prices');
  return rows;
}

function finiteOrNull(value) {
  if (value == null || value === '') return null;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

/** Normalize a real CoinLore ticker; unavailable fields remain null/empty. */
export function normalizeCoinLoreMarket(c = {}) {
  const nameid = typeof c.nameid === 'string' ? c.nameid.trim().toLowerCase() : '';
  const id = COINLORE_ID_ALIASES[nameid] || nameid || (c.id != null ? `coinlore-${c.id}` : '');
  const symbol = String(c.symbol || '').trim().toUpperCase();
  const name = String(c.name || '').trim();
  const price = finiteOrNull(c.price_usd);
  if (!id || !symbol || !name || price == null || price <= 0) return null;

  return {
    id,
    symbol,
    name,
    image: null,
    price,
    change1h: finiteOrNull(c.percent_change_1h),
    change24h: finiteOrNull(c.percent_change_24h),
    change7d: finiteOrNull(c.percent_change_7d),
    mcap: finiteOrNull(c.market_cap_usd),
    volume: finiteOrNull(c.volume24),
    rank: finiteOrNull(c.rank),
    /* CoinLore's ticker endpoint does not provide these historical extrema. */
    high24h: null,
    low24h: null,
    ath: null,
    athChange: null,
    supply: finiteOrNull(c.csupply),
    /* A ticker is not a historical series; never synthesize a sparkline. */
    sparkline: [],
    marketProvider: 'coinlore',
    coinLoreId: c.id == null ? null : String(c.id)
  };
}
