/**
 * LEARNING CORE — trusted price lookup.
 * ---------------------------------------------------------------------------
 * The second-generation telemetry pipeline NEVER trusts a price from the
 * client. Both ends of a forward return come from here: the baseline price
 * when the event is ingested, and the resolution price when the daily cron
 * sweeps the pending manifest.
 *
 * "Here" is strictly the server's own in-memory market cache (server/cache.js
 * memoryStore) — the same entries the /api/markets and /api/coin endpoints
 * already populate from CoinGecko. There is NO outbound fetch on this path:
 * a cache miss is a miss, and the caller drops the sample rather than
 * inventing a number (guardrail: fallback miss → drop, DO NOT invent).
 */

import { memoryStore } from '../cache.js';

/** A cached price older than this is a miss — six hours of staleness is the
 *  most a "current" price is allowed to mean. */
const MAX_PRICE_AGE_MS = 6 * 3600 * 1000;

/**
 * USD price for a public CoinGecko id from the in-memory market cache.
 * Returns a finite positive number or null. Synchronous, zero I/O.
 */
export function cachedPriceUSD(coinId, { store = memoryStore, now = Date.now() } = {}) {
  const id = String(coinId ?? '');
  if (!id) return null;
  let best = null; // { price, at }
  const consider = (price, at) => {
    const p = Number(price);
    if (!Number.isFinite(p) || p <= 0) return;
    if (now - at > MAX_PRICE_AGE_MS) return;
    if (!best || at > best.at) best = { price: p, at };
  };
  try {
    for (const [key, entry] of store) {
      if (!entry || typeof entry !== 'object') continue;
      const at = Number(entry.at) || 0;
      const value = entry.value;
      if (key === `coin:${id}` && value && typeof value === 'object') {
        consider(value.price, at);
      } else if (key.startsWith('markets:usd:') && Array.isArray(value)) {
        const row = value.find((c) => c?.id === id);
        if (row) consider(row.price, at);
      }
    }
  } catch {
    return null;
  }
  return best ? best.price : null;
}

export default cachedPriceUSD;
