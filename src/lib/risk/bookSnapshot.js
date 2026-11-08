/**
 * AI RISK ENGINE — THE BOOK SNAPSHOT
 * ===========================================================================
 * «قبل از تصمیم، حین اجرا، و بعد از اجرا.»
 *
 * The pre-trade gate has to answer a question at the moment the user presses
 * "confirm" — and it cannot read sixteen chains while a review sheet is open.
 * So the risk page writes down what it last MEASURED, and the swap review reads
 * that record.
 *
 * ─── WHY THIS IS NOT A SECOND PORTFOLIO CACHE ──────────────────────────────
 * `lib/portfolioSnapshot.js` already exists and stores balances for the first
 * paint. It deliberately stores AMOUNTS and no valuations, because it must
 * never be used to build a transaction. This one stores the opposite: the
 * VALUED rows the risk engine scored, the market rows that gave them a sigma,
 * and the timestamp — because the gate's whole job is a before/after
 * comparison, and a comparison of two different evidence sets is not one.
 *
 * ─── HONESTY RULES ─────────────────────────────────────────────────────────
 *   · Every read returns `ageMs` and `stale`. A snapshot older than
 *     `MAX_AGE_MS` is not returned at all: a gate that scores a trade against
 *     yesterday's book would wave through exactly the concentration it exists
 *     to stop.
 *   · Nothing here is ever used to build a transaction; it is a comparison
 *     input and nothing else.
 *   · It is keyed by address, so a book from another account can never be
 *     applied to this one.
 */
export const RISK_BOOK_KEY = 'fbt-risk-book-v1';
export const RISK_BOOK_VERSION = 1;

/** After this, the record is too old to compare a trade against. */
export const MAX_AGE_MS = 30 * 60 * 1000;

/** How many sparkline points travel with a market row (24h hourly ≈ enough). */
export const SPARK_POINTS = 28;

const isAddress = (v) => typeof v === 'string' && /^0x[0-9a-fA-F]{40}$/.test(v);
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : null);

function storeOf(storage) {
  if (storage) return storage;
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null;
  }
}

/** Only the fields a comparison needs — not the whole report. */
export function buildBookSnapshot({ address, at = Date.now(), rows = [], markets = [], total = null } = {}) {
  if (!isAddress(address)) return null;
  const holdings = (Array.isArray(rows) ? rows : [])
    .filter((r) => (num(r.value) ?? 0) > 0)
    .map((r) => ({
      symbol: String(r.symbol || '').toUpperCase(),
      name: typeof r.name === 'string' ? r.name.slice(0, 48) : null,
      value: num(r.value),
      chainId: Number.isFinite(Number(r.chainId)) ? Number(r.chainId) : null,
      address: typeof r.address === 'string' ? r.address : null,
      coingeckoId: typeof r.coingeckoId === 'string' ? r.coingeckoId : null
    }))
    .slice(0, 60);

  /* The market rows are trimmed to what a sigma and a days-of-volume need:
     a symbol, a price, a 24h volume and the sparkline tail. A price feed with
     forty fields per token has no business in localStorage. */
  const wanted = new Set(holdings.map((h) => h.symbol));
  const slimMarkets = (Array.isArray(markets) ? markets : [])
    .filter((m) => wanted.has(String(m.symbol || '').toUpperCase()))
    .map((m) => ({
      symbol: String(m.symbol || '').toUpperCase(),
      id: typeof m.id === 'string' ? m.id : null,
      price: num(m.price),
      volume: num(m.volume),
      mcap: num(m.mcap),
      change24h: num(m.change24h),
      sparkline: Array.isArray(m.sparkline) ? m.sparkline.slice(-SPARK_POINTS).map(num).filter((v) => v != null) : []
    }))
    .slice(0, 60);

  if (!holdings.length) return null;
  return {
    v: RISK_BOOK_VERSION,
    address: address.toLowerCase(),
    at,
    total: num(total) ?? holdings.reduce((s, h) => s + (h.value ?? 0), 0),
    holdings,
    markets: slimMarkets
  };
}

export function writeBookSnapshot({ address, rows, markets, total, at = Date.now(), storage } = {}) {
  const payload = buildBookSnapshot({ address, rows, markets, total, at });
  if (!payload) return false;
  const target = storeOf(storage);
  if (!target) return false;
  try {
    target.setItem(RISK_BOOK_KEY, JSON.stringify(payload));
    return true;
  } catch {
    /* Quota exceeded: the snapshot is an optimisation, never a requirement. */
    return false;
  }
}

/**
 * Read it back. Returns `{ rows, markets, total, at, ageMs, stale }` or null.
 * `stale` is advisory (the caller may still show the age); past MAX_AGE_MS the
 * record is not returned, because a gate comparing against a book that old is
 * not a gate.
 */
export function readBookSnapshot(address, { storage, at = Date.now(), maxAgeMs = MAX_AGE_MS } = {}) {
  if (!isAddress(address)) return null;
  const target = storeOf(storage);
  if (!target) return null;
  let parsed = null;
  try {
    const raw = target.getItem(RISK_BOOK_KEY);
    if (!raw) return null;
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || parsed.v !== RISK_BOOK_VERSION) return null;
  if (String(parsed.address || '').toLowerCase() !== address.toLowerCase()) return null;
  const taken = Number(parsed.at);
  if (!Number.isFinite(taken) || taken <= 0) return null;
  const ageMs = Math.max(0, at - taken);
  if (ageMs > maxAgeMs) return null;
  if (!Array.isArray(parsed.holdings) || !parsed.holdings.length) return null;
  return {
    rows: parsed.holdings,
    markets: Array.isArray(parsed.markets) ? parsed.markets : [],
    total: num(parsed.total),
    at: taken,
    ageMs,
    stale: ageMs > 5 * 60 * 1000
  };
}

export function clearBookSnapshot(storage) {
  const target = storeOf(storage);
  if (!target) return false;
  try {
    target.removeItem(RISK_BOOK_KEY);
    return true;
  } catch {
    return false;
  }
}
