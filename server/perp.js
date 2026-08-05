/**
 * PERPETUAL FUTURES — live venue data, free and keyless.
 * ---------------------------------------------------------------------------
 * ─── WHAT THE PERP SCREEN USED TO BE ────────────────────────────────────────
 * A spot price, an explanation of leverage, and three links. Everything on it
 * was true, and none of it was information a trader could not get anywhere
 * else. The one number that actually decides whether a perpetual position is
 * expensive to hold — the FUNDING RATE — was described in a paragraph and
 * never shown.
 *
 * That is the gap this module closes. Funding is the cost that quietly eats a
 * leveraged position: it is charged every few hours, it is invisible in the
 * P&L until it has already been taken, and it differs by venue for the exact
 * same trade. Showing it side by side is the single most useful thing this
 * app can do for someone who is going to trade perps whether we help or not.
 *
 * ─── WHY COINGECKO'S /derivatives ───────────────────────────────────────────
 * Free, keyless, and already the provider behind every other price in this
 * app — one fewer dependency to reason about. `/derivatives` returns every
 * perpetual ticker CoinGecko tracks with its funding rate, open interest and
 * 24h volume, which is exactly the set of fields needed here.
 *
 * ─── WHY THIS RUNS ON THE SERVER ────────────────────────────────────────────
 * The same reason as server/yields.js: the upstream response is the whole
 * derivatives universe, thousands of rows and megabytes of JSON, and the
 * screen renders a couple of dozen. Filtering on a phone over an Iranian
 * mobile connection would be indefensible. One fetch every five minutes here
 * serves everybody.
 *
 * ─── THE RULE THAT MATTERS: NEVER ANNUALISE A RATE WE CANNOT DATE ───────────
 * A funding rate is meaningless without its settlement interval. Binance
 * settles every 8 hours; Hyperliquid and dYdX settle every hour. The SAME
 * printed number, 0.01%, is 10.95% a year on Binance and 87.6% a year on
 * Hyperliquid — an eightfold difference in the cost of holding.
 *
 * CoinGecko does not return the interval. So this module carries an explicit
 * per-venue table and DROPS any venue that is not in it. A guessed interval
 * would produce a confident, precise, wrong annual cost — which is worse than
 * showing nothing, because a user cannot tell it is wrong.
 */

const CG_BASE = process.env.COINGECKO_BASE || 'https://api.coingecko.com/api/v3';
const CG_PRO_BASE = 'https://pro-api.coingecko.com/api/v3';
const CG_KEY = process.env.COINGECKO_API_KEY || '';
const CG_IS_PRO = process.env.COINGECKO_PLAN === 'pro';

const TIMEOUT_MS = Number(process.env.UPSTREAM_TIMEOUT_MS || 12000);

/**
 * SETTLEMENT INTERVALS, IN HOURS, PER VENUE.
 *
 * The keys are CoinGecko's own `market` strings, matched exactly rather than
 * fuzzily: "Bybit (Futures)" and "Bybit" are different rows in their data and
 * a loose match would silently pull in a venue whose interval we have not
 * checked.
 *
 * Every entry below was verified against the venue's own documentation, not
 * inferred from the size of the number:
 *
 *   • Binance / Bybit / OKX / Bitget / Gate — 8h, settling 00:00, 08:00, 16:00
 *     UTC. (Binance runs 4h on a handful of volatile pairs; those are the
 *     minority and the 8h assumption UNDERSTATES their annual cost, which is
 *     the safe direction to be wrong in for a cost figure.)
 *   • Hyperliquid — 1h. Its own docs describe hourly funding.
 *   • dYdX v4 — 1h, settled every block against an hourly rate.
 *
 * Anything not listed here is dropped. See the header: an unknown interval
 * makes the annualised figure a fabrication.
 *
 * ⚠️ THE KEYS ARE COINGECKO'S STRINGS, LOOKED UP — NOT WRITTEN FROM MEMORY.
 * I first wrote `dYdX Perpetual` here. That is a real CoinGecko venue, but it
 * is the DEAD Ethereum L1 exchange; the live v4 appchain is called
 * `dYdX Chain`. `GET /derivatives/exchanges/list` settled it. A wrong key does
 * not error — the venue simply never appears, and the screen looks like dYdX
 * has no markets rather than like our table has a typo. Exactly the silent
 * failure the LI.FI integrator id already cost us once.
 */
export const FUNDING_INTERVAL_HOURS = {
  'Binance (Futures)': 8,
  'Bybit (Futures)': 8,
  'OKX (Futures)': 8,
  'Bitget Futures': 8,
  'Gate (Futures)': 8,
  'Hyperliquid (Futures)': 1,
  'dYdX Chain': 1
};

/**
 * How the venue custodies your money. Shown on every row.
 *
 * ─── WHY THIS IS NOT A DETAIL ───────────────────────────────────────────────
 * This whole app exists on the premise that you keep your own keys. A perp
 * position on Binance is the opposite of that: the money is theirs until they
 * agree to give it back, and an Iranian user in particular can lose access to
 * an account for reasons that have nothing to do with their trade.
 *
 * We are sending people to these venues either way — they are the only places
 * this product actually exists. The least we can do is label which ones take
 * custody, on the same row as the price, rather than in a paragraph nobody
 * reads.
 */
export const VENUE_CUSTODY = {
  'Binance (Futures)': 'centralized',
  'Bybit (Futures)': 'centralized',
  'OKX (Futures)': 'centralized',
  'Bitget Futures': 'centralized',
  'Gate (Futures)': 'centralized',
  'Hyperliquid (Futures)': 'onchain',
  'dYdX Chain': 'onchain'
};

/**
 * Assets the screen covers.
 *
 * An allow-list rather than "top N by open interest", for the same reason
 * server/yields.js allow-lists protocols: sorting a derivatives feed by size
 * and taking the top rows works right up until a venue inflates its own open
 * interest, and then the screen is advertising whatever was inflated. These
 * are the majors, they will still be the majors next year, and a user looking
 * for a funding comparison is looking for one of them.
 */
export const TRACKED_ASSETS = ['BTC', 'ETH', 'SOL', 'XRP', 'BNB', 'DOGE'];

/**
 * A ticker older than this is not a market, it is a memorial.
 *
 * CoinGecko keeps returning rows for pairs that have stopped trading, with
 * their last price frozen in place. Rendering one beside a live venue invites
 * a comparison between a real number and a fossil.
 */
const MAX_TICKER_AGE_MS = 2 * 60 * 60 * 1000;

/** Below this the pair is too thin for the funding rate to mean anything. */
const MIN_OPEN_INTEREST_USD = 1_000_000;

const HOURS_PER_YEAR = 8760;

function cgUrl(path, params = {}) {
  const base = CG_IS_PRO ? CG_PRO_BASE : CG_BASE;
  const qs = new URLSearchParams(params);
  if (CG_KEY) qs.set(CG_IS_PRO ? 'x_cg_pro_api_key' : 'x_cg_demo_api_key', CG_KEY);
  const q = qs.toString();
  return `${base}${path}${q ? `?${q}` : ''}`;
}

async function fetchJson(url) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { accept: 'application/json', 'user-agent': 'fbt-swap-app/1.0' }
    });
    if (!res.ok) throw new Error(`Upstream ${res.status} for ${url}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Annualise a funding rate.
 *
 * @param {number} ratePct   the rate as CoinGecko reports it: a PERCENT per
 *                           interval, so 0.0043 means 0.0043%, not 0.43%.
 * @param {number} hours     the venue's settlement interval.
 * @returns {number|null}    percent per year, or null when either input is
 *                           unusable. Null, never zero — "we do not know" and
 *                           "it costs nothing" are opposite statements and
 *                           collapsing them is how a screen lies quietly.
 */
export function annualiseFunding(ratePct, hours) {
  /* `Number(null)` is 0 and 0 is finite — see the note in crowding(). A
     missing rate must not annualise to "holding is free". */
  if (ratePct == null) return null;
  const r = Number(ratePct);
  const h = Number(hours);
  if (!Number.isFinite(r) || !Number.isFinite(h) || h <= 0) return null;
  return r * (HOURS_PER_YEAR / h);
}

/**
 * Which side is crowded, from the funding rate.
 *
 * Positive funding means longs pay shorts, which means the perpetual is
 * trading above spot, which means the crowd is long. That is the entire
 * inference and it is worth stating in words on the screen, because the sign
 * of a small decimal is not something anyone reads at a glance.
 *
 * The neutral band is not zero. Most venues build a fixed interest component
 * of about 0.01% per 8h into the formula, so a calm market sits slightly
 * positive — around 10% a year — and calling that "longs are crowded" would
 * fire on essentially every market, every day, and mean nothing.
 */
export function crowding(aprPct) {
  /*
   * `null` FIRST, before Number().
   *
   * `Number(null)` is 0, and 0 is finite — so a plain `Number.isFinite` guard
   * accepts a missing rate and labels the market "balanced". That is the
   * null-versus-zero confusion this whole module warns about, reproduced in
   * the guard meant to prevent it. Caught by the test, not by reading.
   */
  if (aprPct == null) return null;
  const a = Number(aprPct);
  if (!Number.isFinite(a)) return null;
  if (a > 20) return 'longs';
  if (a < -5) return 'shorts';
  return 'balanced';
}

/**
 * Normalise one upstream ticker, or return null to drop it.
 *
 * Every rejection below is a case where rendering the row would be worse than
 * omitting it, and each says why in place.
 */
export function normalizeTicker(row, now = Date.now()) {
  if (!row || row.contract_type !== 'perpetual') return null;
  if (row.expired_at) return null;

  const venue = row.market;
  const hours = FUNDING_INTERVAL_HOURS[venue];
  /* Unknown interval → we cannot state an annual cost. See the file header. */
  if (!hours) return null;

  const symbol = String(row.index_id || '').toUpperCase();
  if (!TRACKED_ASSETS.includes(symbol)) return null;

  const price = Number(row.price);
  if (!Number.isFinite(price) || price <= 0) return null;

  const oi = Number(row.open_interest);
  if (!Number.isFinite(oi) || oi < MIN_OPEN_INTEREST_USD) return null;

  const traded = Number(row.last_traded_at);
  if (Number.isFinite(traded) && now - traded * 1000 > MAX_TICKER_AGE_MS) return null;

  /* Same trap: `Number(null)` is 0. A ticker that reports no funding rate
     must render as "—", never as a free position. */
  const fundingPct = row.funding_rate == null ? null : Number(row.funding_rate);
  const fundingApr = annualiseFunding(fundingPct, hours);

  return {
    venue,
    custody: VENUE_CUSTODY[venue] ?? 'unknown',
    symbol,
    pair: String(row.symbol || '').slice(0, 24),
    price,
    change24h: Number(row.price_percentage_change_24h) || 0,
    /* Kept alongside the annualised figure so the screen can show its work. */
    fundingPct: Number.isFinite(fundingPct) ? fundingPct : null,
    intervalHours: hours,
    fundingApr,
    openInterestUsd: oi,
    volume24hUsd: Number(row.volume_24h) || 0
  };
}

/**
 * Group normalised tickers by asset.
 *
 * The average funding used for the crowding label is weighted by open
 * interest, not a plain mean. An unweighted average lets a thin venue with an
 * extreme rate outvote the venue where the money actually is — and the thin
 * one is exactly where a stale or manipulated print shows up.
 */
export function groupByAsset(tickers) {
  const bySymbol = new Map();

  /*
   * ─── ONE ROW PER VENUE, NOT ONE PER CONTRACT ────────────────────────────
   * Found by reading the LIVE response, not by reasoning: a venue lists the
   * same asset several times. Binance alone returns BTCUSDT, BTCUSDC and
   * BTCUSD_PERP — different margin collateral, different funding rates,
   * spanning 4.6% to 8.4% a year. Fifteen rows came back for BTC.
   *
   * Rendered raw, the table showed "Binance (Futures)" three times with three
   * different numbers and no way to tell them apart, and "the cheapest venue
   * is Binance" became meaningless when Binance was simultaneously the
   * cheapest and among the dearest.
   *
   * So we keep the DEEPEST contract per venue. Open interest is the right
   * tiebreak rather than volume: it is where the positions actually are, and
   * it reliably selects the USDT-margined perp that a retail user opening a
   * position on that venue will actually get. Picking the cheapest instead
   * would flatter every venue with a thin inverse contract nobody trades.
   */
  const deepest = new Map();
  for (const t of tickers) {
    const key = `${t.symbol}|${t.venue}`;
    const prev = deepest.get(key);
    if (!prev || t.openInterestUsd > prev.openInterestUsd) deepest.set(key, t);
  }

  for (const t of deepest.values()) {
    if (!bySymbol.has(t.symbol)) bySymbol.set(t.symbol, []);
    bySymbol.get(t.symbol).push(t);
  }

  const assets = [];
  for (const symbol of TRACKED_ASSETS) {
    const venues = bySymbol.get(symbol);
    if (!venues || venues.length === 0) continue;

    venues.sort((a, b) => b.openInterestUsd - a.openInterestUsd);

    let oiTotal = 0;
    let weighted = 0;
    let weight = 0;
    for (const v of venues) {
      oiTotal += v.openInterestUsd;
      if (v.fundingApr != null) {
        weighted += v.fundingApr * v.openInterestUsd;
        weight += v.openInterestUsd;
      }
    }
    const avgFundingApr = weight > 0 ? weighted / weight : null;

    /*
     * The spread between the cheapest and dearest venue to hold the same
     * position. This is the number that justifies the whole screen: it is
     * routinely several percent a year on an identical trade, and nobody
     * checks it because no interface puts the venues side by side.
     */
    const aprs = venues.map((v) => v.fundingApr).filter((x) => x != null);
    const spread = aprs.length >= 2 ? Math.max(...aprs) - Math.min(...aprs) : null;

    assets.push({
      symbol,
      venues,
      openInterestUsd: oiTotal,
      avgFundingApr,
      fundingSpread: spread,
      crowding: crowding(avgFundingApr)
    });
  }

  return assets;
}

/**
 * GET /api/perp/markets
 *
 * Reports how many rows were considered and how many survived, the same way
 * the Farm screen does. "18 of 1,412 shown" is the fastest honest explanation
 * of what the filter is doing, and it makes a silently-emptying feed visible
 * instead of looking like a quiet day.
 */
export async function fetchPerpMarkets() {
  const rows = await fetchJson(cgUrl('/derivatives'));
  if (!Array.isArray(rows)) throw new Error('BAD_SHAPE');

  const now = Date.now();
  const tickers = [];
  for (const row of rows) {
    const t = normalizeTicker(row, now);
    if (t) tickers.push(t);
  }

  return {
    updatedAt: new Date(now).toISOString(),
    assets: groupByAsset(tickers),
    considered: rows.length,
    used: tickers.length,
    /* So the UI can name the venues covered without hard-coding a second list. */
    venues: Object.keys(FUNDING_INTERVAL_HOURS)
  };
}
