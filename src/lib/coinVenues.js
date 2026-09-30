/**
 * A WHOLE PAGE OF COINS, RESOLVED AT ONCE.
 * ---------------------------------------------------------------------------
 * ─── THE BUG THIS CLOSES ────────────────────────────────────────────────────
 *   «تعداد توکن های صفحه بازار خیلی کمه، بیشترشم قابل سواپ نیست»
 *
 * The market list asked NOTHING. Every swap button on it was decided by
 * `isSwappable()`, which scans the hand-written curated table in chains.js —
 * 46 EVM entries — so a screen holding 250 coins showed a swap button on a
 * dozen of them and answered "cannot swap" for coins our own /solana screen
 * routes through Jupiter every day.
 *
 * `lib/coinVenue.js` already knew the real answer for ONE coin, and the coin
 * page already used it. The list could not: asking 250 times is 250 round
 * trips, 250 abort controllers, and a phone that has burned its data before
 * the user has scrolled twice.
 *
 * ─── ONE REQUEST PER PAGE, NOT ONE PER ROW ─────────────────────────────────
 * The server holds the whole id→contract index in memory for six hours (built
 * from the same CoinGecko download `coinIndex.js` already makes), so asking
 * for 250 ids costs exactly what asking for one costs.
 *
 * ─── STILL NEVER BY SYMBOL ──────────────────────────────────────────────────
 * The request is keyed by CoinGecko coin id — the same key the market feed
 * used to produce the row and the price on it. A scam token can copy the
 * ticker; it cannot occupy the contract recorded against that id.
 */

import { apiBase } from './apiBase.js';

const API_BASE = apiBase();

/**
 * Session cache, keyed by coin id — the same one `lib/coinVenue.js` keeps for
 * single coins, so tapping a row from the list is instant and costs no second
 * request when the detail page asks for the same id.
 */
const memo = new Map();

/** How many ids travel in one request. A URL past this is a server limit, not a style choice. */
const MAX_BATCH = 250;

/** In-flight batches, keyed by the joined id string — a re-render never re-fetches. */
const inflight = new Map();

/**
 * Resolve many coins at once.
 *
 * @param {string[]} coinIds
 * @returns {Promise<Map<string, {chains:object, solana:string|null, tradeable:boolean}>>}
 *          A Map so a row lookup is O(1) and a MISS is simply absent rather
 *          than a promise the list has to await one row at a time.
 */
export async function getCoinVenues(coinIds, { timeout = 15000 } = {}) {
  const out = new Map();
  const wanted = [];
  const seen = new Set();

  for (const raw of Array.isArray(coinIds) ? coinIds : []) {
    const id = String(raw ?? '').trim().toLowerCase();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const hit = memo.get(id);
    /* Only a SUCCESSFUL answer is cached, for the reason lib/coinVenue.js
       documents: caching a failure would mark a coin unresolvable for the
       rest of the session over one bad request. */
    if (hit) out.set(id, hit);
    else wanted.push(id);
  }
  if (!wanted.length) return out;

  const batches = [];
  for (let i = 0; i < wanted.length; i += MAX_BATCH) batches.push(wanted.slice(i, i + MAX_BATCH));

  await Promise.all(batches.map(async (batch) => {
    const key = batch.join(',');
    if (inflight.has(key)) {
      for (const [id, v] of await inflight.get(key)) out.set(id, v);
      return;
    }
    const job = (async () => {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), timeout);
      try {
        const res = await fetch(`${API_BASE}/coin-venues?ids=${encodeURIComponent(key)}`, {
          signal: ctrl.signal,
          headers: { accept: 'application/json' }
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (!data || typeof data !== 'object' || data.error) throw new Error('BAD_SHAPE');
        const rows = data.venues && typeof data.venues === 'object' ? data.venues : {};
        const found = new Map();
        for (const [id, v] of Object.entries(rows)) {
          if (!v || typeof v !== 'object') continue;
          const entry = {
            chains: v.chains && typeof v.chains === 'object' ? v.chains : {},
            solana: typeof v.solana === 'string' ? v.solana : null,
            tradeable: Boolean(v.tradeable)
          };
          memo.set(id, entry);
          found.set(id, entry);
        }
        return found;
      } finally {
        clearTimeout(timer);
        inflight.delete(key);
      }
    })().catch(() => new Map());
    inflight.set(key, job);
    for (const [id, v] of await job) out.set(id, v);
  }));

  return out;
}

/**
 * Seed the cache from rows the page ALREADY has.
 *
 * Zero requests, and it matters: the market feed and the venue index are two
 * views of the same universe, and the coin page benefits from whatever the
 * list resolved. Called by the list before it renders so a tap on a row never
 * waits on the network for an answer we already hold.
 */
export function rememberCoinVenues(coinId, venue) {
  const id = String(coinId ?? '').trim().toLowerCase();
  if (!id || !venue || typeof venue !== 'object') return;
  memo.set(id, {
    chains: venue.chains && typeof venue.chains === 'object' ? venue.chains : {},
    solana: typeof venue.solana === 'string' ? venue.solana : null,
    tradeable: Boolean(venue.tradeable)
  });
}

/** Read the cache without a request. `null` means "not known yet", not "no". */
export const cachedCoinVenue = (coinId) => memo.get(String(coinId ?? '').trim().toLowerCase()) ?? null;

/** Reset, for tests. */
export function _clearVenueBatchCache() {
  memo.clear();
  inflight.clear();
}
