/**
 * CONTRACT → PRICE, for the tokenized-stock board on /stocks.
 * ---------------------------------------------------------------------------
 * ─── THE COMPLAINT THIS ANSWERS ─────────────────────────────────────────────
 * «تب سهام توکنیزه ۲۰۰ توکن جدید، بدون قیمت خورده» — the Robinhood Chain board
 * on the Stocks screen lists ~200 real contracts and priced almost none of
 * them. The only quote that rail ever had was a REFERENCE price for the
 * company's SHARE, matched by TICKER against the Avantis/Pyth equity feed
 * (see server/avantis.js). That feed carries roughly forty names, so every
 * contract outside it — most of the board — rendered «—».
 *
 * ─── WHY THE PRICE IS LOOKED UP BY CONTRACT, NOT BY TICKER ──────────────────
 * The same rule server/coinIndex.js documents at length, for the same reason:
 * anyone can deploy a token called "NVDA". Dozens of contracts share the
 * ticker, and the fakes copy whatever signal you rank on. The address is the
 * identity; the symbol is not. So the lookup is address → CoinGecko id → price,
 * and a contract that resolves to nothing gets NO price rather than the price
 * of whatever else happens to share its ticker.
 *
 * ─── WHERE THE NUMBER COMES FROM, AND WHAT IT IS NOT ────────────────────────
 * `fetchSimplePrices` (server/providers.js) — CoinGecko's /simple/price, the
 * same keyless call the swap screen already prices tokens with. This is the
 * TOKEN's own market price, not the company's share price. The board labels a
 * value that came from the share feed as «مرجع» and prints a market price
 * unlabelled; a card with neither shows «—» and says so. Nothing here invents
 * a number, and a token whose price we could not read is not given a zero.
 *
 * ─── WHY THIS IS A SERVER ROUTE ─────────────────────────────────────────────
 * One screen asks about ~200 contracts. Resolving ids on the phone would mean
 * downloading CoinGecko's whole coin list (~20 MB, see coinIndex.js); asking
 * CoinGecko per contract would be ~200 outbound requests per viewer. Here it
 * is: one 6-hour-cached index (already built for the order screen) plus one
 * /simple/price call per 50 ids, shared by every user through the CDN.
 *
 * ─── FAILURE IS PER-TOKEN, AND IT IS VISIBLE ────────────────────────────────
 * An upstream outage does not throw away the ids we already have: the response
 * carries `prices` with nulls and an `upstreamError` string, so the client can
 * tell "this contract is not listed" from "the price feed is down right now"
 * and fall back to the share reference instead of pretending the token has no
 * market at all.
 */

import { PLATFORM_SLUGS, getIndex } from './coinIndex.js';
import { fetchSimplePrices } from './providers.js';

/** How long a price read is reused. Prices, not identities: this is short. */
const PRICE_TTL_MS = Number(process.env.STOCK_PRICE_TTL_MS || 45_000);

/**
 * Ceiling on one request. The board shows a screenful (24) at a time, and the
 * client batches its own pages; 120 leaves room for «نمایش همه» in slices
 * without letting one caller turn this into a bulk price scraper.
 */
export const MAX_ADDRESSES = Number(process.env.STOCK_PRICE_MAX_ADDRESSES || 120);

/**
 * Ids per CoinGecko call. `/simple/price` accepts a comma-joined list and
 * `include_24hr_change`; fifty keeps the URL comfortably short (a long URL is
 * the one thing that gets silently truncated by a proxy) while still pricing a
 * whole screen in a single request.
 */
export const ID_BATCH = Number(process.env.STOCK_PRICE_ID_BATCH || 50);

const isAddress = (a) => /^0x[a-fA-F0-9]{40}$/.test(String(a ?? ''));

/**
 * Lower-cased, de-duplicated, validated, capped.
 *
 * Malformed entries are DROPPED rather than repaired: an address we cannot
 * parse cannot be priced, and guessing at one is how a card ends up wearing a
 * price that belongs to a different contract.
 *
 * Pure, and exported so the suite can drive it without a network.
 */
export function normalizeAddresses(input) {
  const list = Array.isArray(input) ? input : String(input ?? '').split(',');
  const seen = new Set();
  const out = [];
  for (const raw of list) {
    const addr = String(raw ?? '').trim().toLowerCase();
    if (!isAddress(addr) || seen.has(addr)) continue;
    seen.add(addr);
    out.push(addr);
    if (out.length >= MAX_ADDRESSES) break;
  }
  return out;
}

/** Fixed-size slices. Pure. The last slice may be shorter; nothing is padded. */
export function chunk(list, size) {
  const n = Math.max(1, Number(size) || 1);
  const out = [];
  for (let i = 0; i < list.length; i += n) out.push(list.slice(i, i + n));
  return out;
}

/**
 * One CoinGecko `/simple/price` row → our shape, or null.
 *
 * `undefined`, `null`, 0 and NaN are all "we did not read a price": returning
 * 0 would print $0.00 on a card as if the asset had collapsed, which is the
 * exact wrong-number failure lib/stockTokens.js already refuses for the share
 * reference. A missing 24h change is null — the chip is simply not drawn.
 */
export function readPrice(row) {
  const price = Number(row?.usd);
  if (!Number.isFinite(price) || price <= 0) return null;
  const rawChange = row?.usd_24h_change;
  const change = rawChange == null || rawChange === '' ? NaN : Number(rawChange);
  return { price, change24h: Number.isFinite(change) ? change : null };
}

/**
 * Attach ids and prices to the addresses we were asked about.
 *
 * Every requested address appears in the result — with `null` when it could
 * not be priced. That is deliberate: the caller prints «—» for a null and the
 * absence of a key would be indistinguishable from a bug on our side.
 *
 * Pure: `byId` is a plain object of id → raw CoinGecko row.
 */
export function shapePrices(idsByAddress, byId = {}) {
  const out = {};
  for (const [addr, id] of Object.entries(idsByAddress ?? {})) {
    if (!id) {
      out[addr] = null;
      continue;
    }
    const price = readPrice(byId[id]);
    out[addr] = price ? { id, ...price } : null;
  }
  return out;
}

/*
 * id → { price, change24h, at }. Module-level on purpose: the ids are stable
 * for six hours while the prices are good for seconds, so the cache lives on
 * the price, not on the request. Two screens, or two users on the same warm
 * instance, cost one upstream call between them.
 */
const priceCache = new Map();

function fresh(entry, now) {
  return Boolean(entry) && now - entry.at < PRICE_TTL_MS;
}

/** Reset, for tests. */
export function _resetStockPriceCache() {
  priceCache.clear();
}

/** How many distinct ids we are holding a price for. Reported by /api/health-ish callers. */
export const stockPriceCacheSize = () => priceCache.size;

/**
 * Price a set of contracts on one chain.
 *
 * @param  {number|string} chainId
 * @param  {Array|string}  addresses  array of addresses, or a comma-joined string
 * @return {Promise<object>} `{ error }` for a request we cannot serve at all,
 *         otherwise `{ chainId, at, prices, priced, unpriced, indexedOnChain,
 *         upstreamError }` where `prices[address]` is `{ id, price, change24h }`
 *         or null.
 */
export async function priceTokensByAddress(chainId, addresses, { now = Date.now() } = {}) {
  const cid = Number(chainId);
  if (!PLATFORM_SLUGS[cid]) return { error: 'UNSUPPORTED_CHAIN' };

  const list = normalizeAddresses(addresses);
  if (!list.length) return { error: 'NO_ADDRESSES' };

  /*
   * The id index is the expensive half (a ~20 MB download, cached six hours in
   * coinIndex.js). If it cannot be built AND nothing is cached, this throws and
   * the route answers 502 — the client then falls back to its own direct read
   * rather than being told the tokens have no price.
   */
  const { byChain } = await getIndex();
  const map = byChain.get(cid) ?? new Map();

  const idsByAddress = {};
  for (const addr of list) idsByAddress[addr] = map.get(addr) ?? null;

  const need = [...new Set(Object.values(idsByAddress).filter((id) => id && !fresh(priceCache.get(id), now)))];

  let upstreamError = null;
  for (const group of chunk(need, ID_BATCH)) {
    try {
      const payload = await fetchSimplePrices(group);
      for (const id of group) {
        const row = readPrice(payload?.[id]);
        /* A null is remembered too: an id CoinGecko lists no price for costs
           no upstream call for the next 45 seconds either. */
        if (row) priceCache.set(id, { ...row, at: now });
        else priceCache.set(id, { price: null, change24h: null, at: now });
      }
    } catch {
      /* Do not echo provider errors: their URLs can include a private API
         key. A failed batch must not empty the others or be cached as live. */
      upstreamError = 'MARKET_FEED_UNAVAILABLE';
    }
  }

  const byId = {};
  for (const id of new Set(Object.values(idsByAddress).filter(Boolean))) {
    const hit = priceCache.get(id);
    // A failed refresh must not quietly revive an expired quote as "live".
    if (fresh(hit, now) && hit.price != null) byId[id] = { usd: hit.price, usd_24h_change: hit.change24h };
  }

  const prices = shapePrices(idsByAddress, byId);
  const priced = Object.values(prices).filter(Boolean).length;

  return {
    chainId: cid,
    at: now,
    prices,
    priced,
    /* Two different failures, reported separately because they mean different
       things on screen: no id at all = this contract is not in any index we
       read; an id but no price = the market data did not come back. */
    unpriced: list.filter((a) => !idsByAddress[a]).length,
    indexedOnChain: map.size,
    upstreamError
  };
}
