/**
 * TOKENIZED STOCKS — the Robinhood Chain contract universe.
 * ---------------------------------------------------------------------------
 * ─── WHAT THIS IS, AND WHAT IT IS NOT ───────────────────────────────────────
 * Asked for directly: «تعداد توکنهای صفحه سهام — توکنهای توکنیزه و RWA —
 * خیلی کمه … اعداد را خیلی بیشتر کن». The Solana xStocks rail on /stocks is
 * issuer-verified row by row and therefore short by construction: only around
 * two dozen of the ~161 Backed xStocks carry enough depth to be offered
 * (see src/lib/solanaAssets.js). The tokenized-equity market is much larger
 * than that rail, and most of it lives on Robinhood Chain (4663), where the
 * stock tokens are ordinary ERC-20s that our existing EVM swap already
 * routes.
 *
 * This module reads that universe from the ONE list we already trust for
 * contracts — Uniswap's own default token list, the same JSON the swap
 * picker's chain-1 source points at (lib/tokenLists.js). It is a public,
 * static, keyless file on a CDN, and every entry in it was added by Uniswap
 * for a chain Uniswap itself supports.
 *
 * ─── THE HONEST LIMITS, STATED ON THE SCREEN, NOT HIDDEN ────────────────────
 *   · WE HAVE NOT VERIFIED EACH ISSUER. Unlike the Solana rail (mint and
 *     freeze authority checked against Backed's keys on every load), these
 *     addresses are exactly what Uniswap's list says they are and nothing
 *     more. That is why every row shows its contract address and why the
 *     section carries its own provenance line — the same rule the rest of
 *     this app follows: no badge we did not earn.
 *   · BEING IN A LIST IS NOT AN ENDORSEMENT. Anyone can deploy a token called
 *     "NVDA" on any chain. The address is the identity; the symbol is not.
 *     The swap screen shows the contract and its unverified-token warning for
 *     every non-curated entry, and this rail goes through that same screen.
 *   · IT IS NOT A SHARE. Holding the token is a claim on the issuer, not a
 *     place on the company's register — the same sentence the xStock rail
 *     carries, for the same reason.
 *
 * ─── WHY THE LIST IS FILTERED, AND WHAT THE FILTER IS ───────────────────────
 * The chain's list carries the chain's own native and meme layer beside the
 * equities (WETH, USDG, wrapped BTC, a couple of tokens with no equity at
 * all). The rail is about *stocks*, so entries that are not equity-shaped are
 * left out of it — and nothing is lost by that: the swap picker offers the
 * full chain list (lib/tokenLists.js lists chain 4663), so anything filtered
 * here is still swappable by searching for it.
 *
 * A ticker that LOOKS like an equity but is not one would be a wrong label,
 * not a wrong trade, so the classifier is deliberately dumb and inspectable:
 * a short symbol of letters (optionally one class suffix) and not one of the
 * handful of chain-native contracts named below.
 */

import { tickerLogo } from './coinImage.js';

/** The canonical list the app already loads for the swap picker. */
const LIST_URL = 'https://tokens.uniswap.org';

/** Robinhood Chain. Stock tokens are minted as plain ERC-20s here. */
export const ROBINHOOD_CHAIN_ID = 4663;
export const ROBINHOOD_CHAIN_NAME = 'Robinhood Chain';

/** Counter-asset the buy opens on — same rule as lib/rwaTokens.js. */
export const ROBINHOOD_COUNTER = 'USDG';

/* Cached for a day, like the swap picker's lists: the universe changes when a
   company lists, not when a price moves. The key shares the `fbt-tokens-`
   prefix so Settings → «پاککردن حافظه پنهان» clears it with the rest. */
const CACHE_KEY = 'fbt-tokens-robinhood-v1';
const DAY = 24 * 60 * 60 * 1000;

/*
 * The chain's non-equity contracts, by symbol. Kept explicit rather than
 * pattern-guessed: a name-based rule ("BTC", "USD") would eventually drop a
 * real ticker, and dropping a real stock is worse than showing a chain token
 * in a list of contracts.
 */
const NON_EQUITY = new Set([
  'WETH', 'ETH', 'USDC', 'USDC.E', 'USDT', 'USDG', 'DAI', 'CBBTC', 'WBTC', 'TBTC', 'WSOL', 'SOL',
  'CASHCAT', 'PONS', 'WBT'
]);

/** Ticker shape of a listed equity or ETF: letters, optional class suffix. */
const EQUITY_SYMBOL = /^[A-Z]{1,5}(?:[.-][A-Z]{1,2})?$/;

/** Is this entry an equity/ETF we should show on the stocks rail? Pure. */
export function isEquityToken(token) {
  const symbol = String(token?.symbol ?? '').trim().toUpperCase();
  if (!symbol || !EQUITY_SYMBOL.test(symbol)) return false;
  return !NON_EQUITY.has(symbol);
}

/** Shape of a 0x address, checked before anything is offered for a swap. */
const isAddress = (a) => /^0x[a-fA-F0-9]{40}$/.test(String(a ?? ''));

/**
 * Pull the Robinhood-Chain entries out of a tokenlists.org payload and make
 * them uniform. Pure and exported so the tests can drive it with a fixture
 * instead of the network (this repo's probes never call a live CDN).
 *
 * Wrong-chain rows, malformed addresses, duplicated addresses and entries
 * with no symbol are DROPPED rather than repaired — a token without a symbol
 * or with a bad address cannot be swapped anyway, and guessing at one is how
 * a user buys the wrong contract.
 */
export function normalizeStockList(payload, chainId = ROBINHOOD_CHAIN_ID) {
  const rows = Array.isArray(payload) ? payload : Array.isArray(payload?.tokens) ? payload.tokens : [];
  const seen = new Set();
  const out = [];
  for (const raw of rows) {
    if (Number(raw?.chainId) !== Number(chainId)) continue;
    if (!isAddress(raw?.address)) continue;
    const symbol = String(raw.symbol ?? '').trim().slice(0, 16);
    const name = String(raw.name ?? '').trim().slice(0, 48);
    if (!symbol || !name) continue;
    const address = String(raw.address);
    const key = address.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const decimals = Number(raw?.decimals);
    /* A supplied https logo wins; otherwise an EQUITY gets the ticker logo —
       the same source the curated Robinhood rows already carry
       (`assets.parqet.com/logos/symbol/<TICKER>`, see lib/chains.js). It is
       recognition, not proof, which is why every row still prints its own
       contract address underneath. A non-equity entry gets no ticker logo:
       the symbol there is not a company. */
    const equity = isEquityToken({ symbol });
    const listLogo = typeof raw?.logoURI === 'string' && /^https:\/\//i.test(raw.logoURI) ? raw.logoURI : null;
    out.push({
      id: `rh-${symbol.toLowerCase()}-${key.slice(2, 8)}`,
      symbol,
      name,
      address,
      decimals: Number.isInteger(decimals) && decimals >= 0 && decimals <= 36 ? decimals : 18,
      chainId,
      chainName: ROBINHOOD_CHAIN_NAME,
      logoURI: listLogo || (equity ? tickerLogo(symbol) : null),
      source: 'uniswap-default-list',
      verified: false,
      equity
    });
  }
  out.sort((a, b) => Number(b.equity) - Number(a.equity) || a.symbol.localeCompare(b.symbol));
  return out;
}

/* In-memory copy so a tab switch never re-fetches. localStorage is the cache
   that survives a reload; the memory map is the one that survives a render. */
const memory = new Map();
const inflight = new Map();

function readCache(chainId) {
  try {
    const raw = localStorage.getItem(`${CACHE_KEY}:${chainId}`);
    if (!raw) return null;
    const { at, tokens } = JSON.parse(raw);
    if (!Array.isArray(tokens) || !tokens.length || Date.now() - at > DAY) return null;
    return tokens;
  } catch {
    return null;
  }
}

function writeCache(chainId, tokens) {
  try {
    localStorage.setItem(`${CACHE_KEY}:${chainId}`, JSON.stringify({ at: Date.now(), tokens }));
  } catch {
    /* quota exceeded on a small device — the in-memory copy still works */
  }
}

/**
 * The Robinhood Chain stock-token universe.
 *
 * Never throws: an unreachable CDN yields the cached copy when there is one
 * and an empty array otherwise, and the Stocks screen then simply does not
 * render the section. A missing section is an honest "we could not read it";
 * a fabricated row would be the failure this file exists to avoid.
 *
 * @returns {Promise<Array>} every entry from the list, equities first
 */
export async function loadStockTokenUniverse({ refresh = false, chainId = ROBINHOOD_CHAIN_ID } = {}) {
  const key = Number(chainId);
  if (!refresh && memory.has(key)) return memory.get(key);
  if (!refresh && inflight.has(key)) return inflight.get(key);

  const cached = !refresh ? readCache(key) : null;
  if (cached) {
    memory.set(key, cached);
    return cached;
  }

  const job = (async () => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 12000);
    try {
      const res = await fetch(LIST_URL, { signal: ctrl.signal, headers: { accept: 'application/json' } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const tokens = normalizeStockList(await res.json(), key);
      if (!tokens.length) throw new Error('EMPTY_LIST');
      memory.set(key, tokens);
      writeCache(key, tokens);
      return tokens;
    } catch {
      /* Keep whatever the cached read had (already returned above), else an
         honest empty list. */
      return [];
    } finally {
      clearTimeout(timer);
      inflight.delete(key);
    }
  })();

  inflight.set(key, job);
  return job;
}

/** Whatever is already in memory or localStorage — no network. */
export function getStockTokenUniverseSync(chainId = ROBINHOOD_CHAIN_ID) {
  const key = Number(chainId);
  return memory.get(key) ?? readCache(key) ?? [];
}

/** How many of them are equities (what the rail labels itself with). */
export const equityCount = (tokens) => (Array.isArray(tokens) ? tokens.filter((t) => t.equity).length : 0);

/**
 * The buy link. Reuses the exact contract lib/rwaTokens.js already uses for
 * this chain (/swap?chain=4663&from=USDG&to=…&toAddress=…) rather than
 * inventing a second one, so «خرید» here and «خرید» on an RWA row are
 * provably the same action on the same screen — the one that shows the
 * recipient contract before signing.
 */
export function stockTokenSwapUrl(token, amount = null) {
  const address = String(token?.address ?? '');
  if (!isAddress(address)) return '/swap';
  const symbol = encodeURIComponent(String(token?.symbol ?? ''));
  const amt = amount && Number(amount) > 0 ? `&amount=${encodeURIComponent(amount)}` : '';
  return `/swap?chain=${ROBINHOOD_CHAIN_ID}&from=${ROBINHOOD_COUNTER}&to=${symbol}` +
    `&toAddress=${encodeURIComponent(address)}${amt}`;
}

/**
 * A reference price for one ticker, taken from the equity rows the Avantis /
 * Pyth feed already returns on this screen (server/avantis.js).
 *
 * This is a REFERENCE quote for the company's share, not a quote for the
 * token — the token trades in its own pool and can sit at a premium or a
 * discount. The UI labels it as a reference for exactly that reason; when the
 * ticker is not in the feed we return null and the row shows «—» instead of a
 * number we did not read.
 */
export function referencePriceFor(symbol, referenceRows = []) {
  const wanted = String(symbol ?? '').trim().toUpperCase();
  if (!wanted) return null;
  const hit = (Array.isArray(referenceRows) ? referenceRows : []).find(
    (r) => String(r?.symbol ?? '').trim().toUpperCase() === wanted
  );
  const price = Number(hit?.price);
  if (!hit || !Number.isFinite(price) || price <= 0) return null;
  return {
    price,
    change24h: hit.change24h == null || hit.change24h === ''
      ? null
      : (Number.isFinite(Number(hit.change24h)) ? Number(hit.change24h) : null),
    marketOpen: hit.marketOpen ?? null
  };
}
