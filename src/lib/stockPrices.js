/**
 * TOKEN PRICES FOR THE TOKENIZED-STOCK BOARD — client side.
 * ---------------------------------------------------------------------------
 * ─── WHAT WENT WRONG WITHOUT IT ─────────────────────────────────────────────
 * «تب سهام توکنیزه ۲۰۰ توکن جدید، بدون قیمت خورده» — the Robinhood Chain board
 * on /stocks listed ~200 real contracts and priced almost none of them, because
 * its only quote was the company's SHARE price matched by ticker against a feed
 * that carries about forty names (lib/stockTokens.js, `referencePriceFor`).
 *
 * This module asks for the price of the TOKEN, by CONTRACT, through our own
 * backend (/api/stock-prices → server/stockPrices.js), which resolves the
 * contract to a CoinGecko id and reads the market price for it.
 *
 * ─── WHY THE ADDRESS AND NOT THE SYMBOL ─────────────────────────────────────
 * Same rule as lib/coinId.js, for the same reason: anyone can deploy a token
 * called "NVDA", and symbol matching is how a card ends up wearing a price that
 * belongs to a different contract. An address that resolves to nothing gets no
 * price at all — the card then falls back to the share reference, labelled as
 * such, and says so instead of inventing a number.
 *
 * ─── FAIL-OPEN TO THE SECOND SOURCE, FAIL-CLOSED ON THE NUMBER ──────────────
 * Order of attempts, the same one lib/api.js uses for market data:
 *   1. our backend (one batch call per 40 contracts, cached 45s at the edge);
 *   2. CoinGecko directly for just the addresses the backend couldn't price —
 *      a keyless public endpoint, also covering a cold/stale server id index;
 *   3. nothing. The caller keeps the reference price it already had.
 *
 * A result is cached in memory for a minute, and a result that priced NOTHING
 * is cached for seconds only: caching "we found nothing" for a minute is how a
 * transient rate limit turns into a board that looks permanently priceless.
 */

import { apiBase } from './apiBase.js';

/* Resolved per call, not at import time — the Capacitor shell serves the bundle
   from https://localhost, where a relative '/api' hits the WebView's own asset
   server. apiBase() is the one place that question is answered. */

const CG_BASE = 'https://api.coingecko.com/api/v3';

/**
 * CoinGecko platform slug per chain — mirrors PLATFORM_SLUGS in
 * server/coinIndex.js, and it must keep mirroring it: these are looked-up
 * values, not guesses, and the wrong slug silently matches nothing.
 *
 * Only the chain this board uses carries a slug here. A chain without one has
 * no direct fallback and simply waits for the backend, which is honest — we do
 * not know the slug, so we do not pretend to.
 */
const PLATFORM_SLUGS = { 4663: 'robinhood' };

/** How long a priced answer is reused. Prices age; identities do not. */
const TTL_MS = 60_000;

/**
 * How long an answer that priced NOTHING is remembered. Long enough to absorb
 * a burst of duplicate calls for the same page, short enough that a retry by
 * hand always reaches the network — the `EMPTY_TTL_MS` rule from lib/api.js.
 */
const EMPTY_TTL_MS = 8_000;

/**
 * Contracts per request. 40 EVM addresses is a ~1.7 KB query string, which is
 * comfortably inside what every proxy in the path will pass through unaltered;
 * the server accepts up to 120 and the pages are fetched as they are shown.
 */
export const BATCH_SIZE = 40;

/** Concurrent upstream batches. Two is enough to hide latency without a burst. */
const MAX_PARALLEL = 2;

/** address → { price, change24h, source, at } for this session. */
const memo = new Map();
const inflight = new Map();

const keyOf = (chainId, address) => `${Number(chainId)}:${String(address).toLowerCase()}`;

const isAddress = (a) => /^0x[a-fA-F0-9]{40}$/.test(String(a ?? ''));

/**
 * Token objects or bare strings → validated, lower-cased, de-duplicated
 * addresses. Anything malformed is dropped: an address we cannot parse cannot
 * be priced, and passing it on would only produce a null we already know about.
 */
export function addressesOf(tokens) {
  const list = Array.isArray(tokens) ? tokens : [tokens];
  const seen = new Set();
  const out = [];
  for (const item of list) {
    const raw = typeof item === 'string' ? item : item?.address;
    const addr = String(raw ?? '').trim().toLowerCase();
    if (!isAddress(addr) || seen.has(addr)) continue;
    seen.add(addr);
    out.push(addr);
  }
  return out;
}

async function fetchJson(url, timeout = 12000) {
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

/** Slices of at most `size`. */
function batches(list, size = BATCH_SIZE) {
  const out = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

/**
 * One CoinGecko `/simple/price`-shaped row → a price we are willing to print.
 * Zero is NOT a price: it would render as $0.00 on a card as if the asset had
 * collapsed, which is worse than an honest «—».
 */
function readRow(row) {
  // Our server returns { price, change24h }; the public token-price endpoint
  // returns { usd, usd_24h_change }. Reading only `usd` discarded EVERY valid
  // backend quote, leaving most cards without a price despite a 200 response.
  const rawPrice = row?.price ?? row?.usd;
  const price = rawPrice == null || rawPrice === '' ? NaN : Number(rawPrice);
  if (!Number.isFinite(price) || price <= 0) return null;
  const rawChange = row?.usd_24h_change ?? row?.change24h;
  const change = rawChange == null || rawChange === '' ? NaN : Number(rawChange);
  return { price, change24h: Number.isFinite(change) ? change : null };
}

function notifyPartial(onUpdate, rows) {
  if (typeof onUpdate !== 'function' || !Object.keys(rows).length) return;
  try { onUpdate({ ...rows }); } catch { /* a rendering callback cannot break pricing */ }
}

/**
 * Fetch one batch from the backend, then ask CoinGecko directly only for any
 * remaining unpriced contracts. A partial backend answer is not a full answer.
 *
 * @returns {Promise<Record<string, {price:number, change24h:number|null, source:string}>>}
 */
async function fetchBatch(chainId, addresses, onUpdate) {
  let out = {};

  try {
    const data = await fetchJson(
      `${apiBase()}/stock-prices?chainId=${Number(chainId)}&addresses=${addresses.join(',')}`
    );
    const requested = new Set(addresses);
    for (const [addr, row] of Object.entries(data?.prices ?? {})) {
      const key = String(addr).toLowerCase();
      if (!requested.has(key)) continue;
      const parsed = readRow(row);
      if (parsed) out[key] = { ...parsed, source: 'market' };
    }
    // Paint verified backend quotes now, rather than waiting for the optional
    // direct fallback (which can time out for the OTHER contracts in a batch).
    notifyPartial(onUpdate, out);
  } catch {
    /* Backend down or rate-limited — the direct read below is why we survive it. */
  }

  const slug = PLATFORM_SLUGS[Number(chainId)];
  const missing = addresses.filter((addr) => !out[addr]);
  if (missing.length && slug) {
    try {
      // A partially priced batch must not strand the other contracts. This
      // direct address lookup can find newly indexed tokens before the server's
      // six-hour coin-id index refreshes. Never overwrite a backend quote.
      const data = await fetchJson(
        `${CG_BASE}/simple/token_price/${slug}?contract_addresses=${missing.join(',')}` +
          '&vs_currencies=usd&include_24hr_change=true'
      );
      const requested = new Set(missing);
      for (const [addr, row] of Object.entries(data ?? {})) {
        const key = String(addr).toLowerCase();
        if (!requested.has(key)) continue;
        const parsed = readRow(row);
        if (parsed) out[key] = { ...parsed, source: 'market' };
      }
    } catch {
      /* No substituted price: the caller keeps a labelled share reference. */
    }
  }

  return out;
}

/**
 * Prices for a set of token contracts.
 *
 * Never throws. Returns an object keyed by lower-cased contract address holding
 * `{ price, change24h, source }` — and simply omits the contracts it could not
 * price, so a missing key and a null mean the same thing to the caller and it
 * has one branch instead of two.
 *
 * @param  {Array}  tokens           token objects (`{ address }`) or address strings
 * @param  {object} [opts]
 * @param  {number} [opts.chainId]
 * @param  {boolean}[opts.force]     ignore the in-memory cache
 * @param  {Function}[opts.onUpdate] paint a partial contract-keyed backend result early
 * @return {Promise<Record<string, {price:number, change24h:number|null, source:string}>>}
 */
export async function loadStockTokenPrices(tokens, { chainId = 4663, force = false, onUpdate } = {}) {
  const cid = Number(chainId);
  const list = addressesOf(tokens);
  if (!list.length) return {};

  const now = Date.now();
  const out = {};
  const need = [];

  for (const addr of list) {
    const hit = memo.get(keyOf(cid, addr));
    if (!hit) {
      need.push(addr);
      continue;
    }
    const maxAge = hit.price == null ? EMPTY_TTL_MS : TTL_MS;
    if (!force && now - hit.at < maxAge) {
      if (hit.price != null) out[addr] = { price: hit.price, change24h: hit.change24h, source: hit.source };
      continue;
    }
    need.push(addr);
  }

  notifyPartial(onUpdate, out);
  if (!need.length) return out;

  const groups = batches(need);
  /*
   * A tiny worker pool: two batches in flight, in order, so a 120-contract page
   * is six requests rather than six simultaneous ones against a free public API
   * that rate-limits bursts. Each worker walks every MAX_PARALLEL-th batch,
   * which keeps the requests in the order the page is painted.
   */
  const workers = [];
  for (let worker = 0; worker < Math.min(MAX_PARALLEL, groups.length); worker += 1) {
    workers.push((async () => {
      for (let i = worker; i < groups.length; i += MAX_PARALLEL) {
        const group = groups[i];
        const key = `${cid}:${group.join(',')}`;
        let job = inflight.get(key);
        if (!job || force) {
          job = fetchBatch(cid, group, onUpdate);
          inflight.set(key, job);
          job.finally(() => { if (inflight.get(key) === job) inflight.delete(key); });
        }
        let found = {};
        try {
          found = await job;
        } catch {
          found = {};
        }
        const at = Date.now();
        for (const addr of group) {
          const hit = found[addr];
          /* Written per address, including the misses — a miss is remembered
             for seconds only, which is what keeps a rate-limit hiccup from
             turning into a board that claims these tokens have no market. */
          memo.set(
            keyOf(cid, addr),
            hit ? { ...hit, at } : { price: null, change24h: null, source: 'none', at }
          );
          if (hit) out[addr] = hit;
        }
      }
    })());
  }
  await Promise.all(workers);

  return out;
}

/** Forget the session's prices — used when the screen offers a manual refresh. */
export function clearStockTokenPrices() {
  memo.clear();
}

/** Forget ONE session's prices for a chain, keeping other chains untouched. */
export function clearStockTokenPricesFor(chainId = 4663) {
  const prefix = `${Number(chainId)}:`;
  for (const key of [...memo.keys()]) if (key.startsWith(prefix)) memo.delete(key);
}
