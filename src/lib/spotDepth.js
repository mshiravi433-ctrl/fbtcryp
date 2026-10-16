/**
 * Spot depth from aggregator QUOTES — indicative, not an order book.
 *
 * Each point on the curve is one non-binding quote for one trade size. The
 * curve answers a single question: how much worse per unit does a larger
 * trade get than the smallest one? It says nothing about resting orders,
 * and nothing here may be presented as market depth or a firm fill.
 * The UI carries that caveat on every view of this data.
 *
 * Pure functions are at the top (testable with no network). `fetchDepthQuotes`
 * takes the quote function as a parameter, so tests can drive it with a fake.
 */

/** Trade sizes in USD. Adjust here; nothing else in the app hard-codes them. */
export const SPOT_DEPTH_SIZES_USD = Object.freeze([100, 500, 2000, 10000]);

/** A curve older than this is shown as stale and offers a refresh. */
export const SPOT_DEPTH_TTL_MS = 20_000;

/** At most this many quote requests in flight, to stay under aggregator rate limits. */
export const SPOT_DEPTH_CONCURRENCY = 2;

/** Pause between batches of quote requests. */
export const SPOT_DEPTH_BATCH_GAP_MS = 150;

/**
 * Impact bands, in percent versus the reference rate. These are a presentation
 * choice, not a risk model: they are labelled as estimates wherever shown.
 */
export const SPOT_DEPTH_BANDS = Object.freeze({ mediumPct: 0.5, highPct: 2 });

/** 'low' | 'medium' | 'high' for a non-negative impact in percent, else null. */
export function impactBand(impactPct) {
  const v = Number(impactPct);
  if (!Number.isFinite(v) || v < 0) return null;
  if (v >= SPOT_DEPTH_BANDS.highPct) return 'high';
  if (v >= SPOT_DEPTH_BANDS.mediumPct) return 'medium';
  return 'low';
}

const usable = (n) => Number.isFinite(n) && n > 0;

/**
 * The reference rate is the rate of the SMALLEST size that answered. Returns
 * null when no size answered — the caller then marks every point unavailable.
 */
export function referenceRateFrom(quotes = []) {
  const valid = (Array.isArray(quotes) ? quotes : [])
    .filter((q) => q && usable(Number(q.sizeUsd)) && usable(Number(q.rate)) && !q.error)
    .sort((a, b) => Number(a.sizeUsd) - Number(b.sizeUsd));
  return valid.length ? Number(valid[0].rate) : null;
}

/**
 * Build the curve. Pure.
 *
 * @param {object} input
 * @param {Array<{sizeUsd:number, rate?:number, outAmount?:number, error?:string}>} input.quotes
 * @param {number|null} input.referenceRate  rate of the smallest size
 * @returns {Array<{sizeUsd:number, outAmount:number|null, rate:number|null,
 *   impactPct:number|null, band:string|null, status:'ok'|'unavailable'}>}
 *
 * Invariants (tested): sorted ascending by size; no NaN or Infinity in any
 * field; an unavailable point keeps its size so the table can still show it;
 * a missing or non-positive reference makes every point unavailable.
 */
export function buildDepthCurve({ quotes = [], referenceRate = null } = {}) {
  const list = (Array.isArray(quotes) ? quotes : [])
    .filter((q) => q && usable(Number(q.sizeUsd)))
    .map((q) => ({ ...q, sizeUsd: Number(q.sizeUsd) }))
    .sort((a, b) => a.sizeUsd - b.sizeUsd);
  const refOk = usable(Number(referenceRate));
  return list.map((q) => {
    const rate = Number(q.rate);
    const out = Number.isFinite(Number(q.outAmount)) && Number(q.outAmount) >= 0 ? Number(q.outAmount) : null;
    if (!refOk || q.error || !usable(rate)) {
      return { sizeUsd: q.sizeUsd, outAmount: null, rate: null, impactPct: null, band: null, status: 'unavailable' };
    }
    const impactPct = Math.max(0, ((Number(referenceRate) - rate) / Number(referenceRate)) * 100);
    return {
      sizeUsd: q.sizeUsd,
      outAmount: out,
      rate,
      impactPct,
      band: impactBand(impactPct),
      status: 'ok'
    };
  });
}

/**
 * Ask for one quote per size, in small batches with a gap between them.
 * A size whose quote throws or returns nothing becomes `{ error }` and does
 * not stop the others. An abort stops the loop and rethrows an AbortError.
 *
 * @param {object} input
 * @param {number[]} input.sizes
 * @param {(sizeUsd:number) => Promise<object|null>} input.quoteFn
 * @param {AbortSignal} [input.signal]
 */
export async function fetchDepthQuotes({
  sizes = SPOT_DEPTH_SIZES_USD,
  quoteFn,
  signal = null,
  concurrency = SPOT_DEPTH_CONCURRENCY,
  gapMs = SPOT_DEPTH_BATCH_GAP_MS
} = {}) {
  const out = [];
  const list = [...sizes];
  for (let i = 0; i < list.length; i += concurrency) {
    if (signal?.aborted) throw Object.assign(new Error('ABORTED'), { name: 'AbortError' });
    const batch = list.slice(i, i + concurrency);
    const results = await Promise.all(
      batch.map(async (sizeUsd) => {
        try {
          const q = await quoteFn(sizeUsd);
          if (!q || !usable(Number(q.rate))) return { sizeUsd, error: 'NO_QUOTE' };
          return { sizeUsd, rate: Number(q.rate), outAmount: Number(q.outAmount) };
        } catch (err) {
          if (err?.name === 'AbortError') throw err;
          return { sizeUsd, error: 'QUOTE_FAILED' };
        }
      })
    );
    out.push(...results);
    if (i + concurrency < list.length && gapMs > 0) {
      await new Promise((r) => setTimeout(r, gapMs));
    }
  }
  return out;
}

/**
 * A tiny TTL cache keyed by the pair. Entries never leak across pairs because
 * the key includes chain and both tokens.
 */
export function createDepthCache({ ttlMs = SPOT_DEPTH_TTL_MS, now = () => Date.now() } = {}) {
  const map = new Map();
  return {
    get(key) {
      const hit = map.get(key);
      if (!hit) return null;
      return { value: hit.value, at: hit.at, fresh: now() - hit.at <= ttlMs };
    },
    set(key, value) {
      map.set(key, { value, at: now() });
    },
    del(key) {
      map.delete(key);
    },
    clear() {
      map.clear();
    }
  };
}

/**
 * The USD price of a token, looked up by its CoinGecko id from the market feed.
 * Never by symbol: two tokens can share a symbol, and a depth curve sized off
 * the wrong one would be a wrong number. Returns null when the id is absent.
 */
export function usdPriceFor(coins = [], coingeckoId = null) {
  if (!coingeckoId || !Array.isArray(coins)) return null;
  const hit = coins.find((c) => c && c.id === coingeckoId);
  const p = Number(hit?.price);
  return usable(p) ? p : null;
}

/**
 * Convert a USD trade size to a decimal amount of the input token, as a plain
 * string (no exponent notation) with at most `decimals` places.
 * Returns null when the price is unusable or the amount rounds to zero.
 */
export function amountForUsd(sizeUsd, priceUsd, decimals = 6) {
  const s = Number(sizeUsd);
  const p = Number(priceUsd);
  if (!usable(s) || !usable(p)) return null;
  const places = Math.min(Math.max(0, Math.trunc(Number(decimals) || 0)), 18);
  const amount = s / p;
  const text = amount.toFixed(places);
  return Number(text) > 0 ? text : null;
}
