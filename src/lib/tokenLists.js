/**
 * MULTI-THOUSAND TOKEN REGISTRY
 * ---------------------------------------------------------------------------
 * The curated list in chains.js holds ~7 tokens per chain. That was fine for a
 * demo and terrible for revenue: every swap we can't quote is a fee we don't
 * earn, and the long tail of new tokens is exactly where trading volume is.
 *
 * This module loads the standard "token list" files the whole DEX ecosystem
 * publishes (the Uniswap Token List spec, https://tokenlists.org). PancakeSwap,
 * Uniswap and CoinGecko all ship one per chain. Between them that is thousands
 * of tokens per network, refreshed by the maintainers, at zero cost to us.
 *
 * DESIGN DECISIONS AND WHY
 *
 * 1. Loaded at runtime, not bundled.
 *    A 1 MB JSON per chain baked into the APK would add ~7 MB and be stale the
 *    day it shipped. Fetched on demand and cached, the APK stays ~6 MB and the
 *    list is as fresh as the maintainer's last publish.
 *
 * 2. Cached in localStorage for 24h.
 *    Token lists change slowly. Re-downloading 1 MB every app open would burn
 *    the user's mobile data for nothing — and many Iranian users pay per MB.
 *
 * 3. Multiple mirrors per chain, tried in order.
 *    Some of these hosts are unreachable on restricted networks. If the first
 *    fails we try the next; if all fail we still have the curated list, so the
 *    Swap screen never ends up empty.
 *
 * 4. Every address is checksum-normalised and validated.
 *    A malformed address in an upstream list would produce a token that can
 *    never be quoted — a confusing dead end for the user.
 *
 * 5. Curated tokens always win on symbol collision.
 *    Scam tokens routinely impersonate USDT/USDC. Our verified addresses take
 *    precedence, and anything from a list is marked with its source so the UI
 *    can show a "verified" badge only where it is earned.
 */

import { getAddress, isAddress } from 'ethers';
import { TOKENS } from './chains';

const CACHE_PREFIX = 'fbt-tokens-v1:';
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24h

/**
 * Sources per chain, in priority order. All are the official, maintained lists
 * used by the DEXes themselves — we are not inventing a registry.
 */
const SOURCES = {
  56: [
    { url: 'https://tokens.pancakeswap.finance/pancakeswap-extended.json', name: 'PancakeSwap' },
    { url: 'https://tokens.coingecko.com/binance-smart-chain/all.json', name: 'CoinGecko' }
  ],
  1: [
    { url: 'https://tokens.coingecko.com/ethereum/all.json', name: 'CoinGecko' },
    { url: 'https://gateway.ipfs.io/ipns/tokens.uniswap.org', name: 'Uniswap' }
  ],
  137: [
    { url: 'https://tokens.coingecko.com/polygon-pos/all.json', name: 'CoinGecko' },
    { url: 'https://unpkg.com/quickswap-default-token-list@latest/build/quickswap-default.tokenlist.json', name: 'QuickSwap' }
  ],
  42161: [
    { url: 'https://tokens.coingecko.com/arbitrum-one/all.json', name: 'CoinGecko' }
  ],
  8453: [
    { url: 'https://tokens.coingecko.com/base/all.json', name: 'CoinGecko' }
  ],
  10: [
    { url: 'https://tokens.coingecko.com/optimistic-ethereum/all.json', name: 'CoinGecko' }
  ],
  43114: [
    { url: 'https://tokens.coingecko.com/avalanche/all.json', name: 'CoinGecko' }
  ]
};

/** In-memory cache so repeated opens of the picker don't re-parse the JSON. */
const memory = new Map();

/* ------------------------------ persistence ------------------------------ */

function readCache(chainId) {
  try {
    const raw = localStorage.getItem(CACHE_PREFIX + chainId);
    if (!raw) return null;
    const { at, tokens } = JSON.parse(raw);
    if (!Array.isArray(tokens) || Date.now() - at > CACHE_TTL_MS) return null;
    return tokens;
  } catch {
    return null; // corrupted or quota-cleared entry: just refetch
  }
}

function writeCache(chainId, tokens) {
  try {
    localStorage.setItem(CACHE_PREFIX + chainId, JSON.stringify({ at: Date.now(), tokens }));
  } catch {
    // Storage full. A stale-but-working list is better than a crash, and the
    // in-memory cache still covers this session.
  }
}

/* ------------------------------ normalising ------------------------------ */

/**
 * Turn one upstream entry into our shape, or null if it is unusable.
 * Being strict here is deliberate: a token we cannot quote is worse than a
 * token that is missing, because the user blames the app.
 */
function normalise(raw, chainId, sourceName) {
  if (!raw || typeof raw !== 'object') return null;
  if (raw.chainId !== undefined && Number(raw.chainId) !== Number(chainId)) return null;

  const addr = raw.address;
  if (typeof addr !== 'string' || !isAddress(addr)) return null;

  const decimals = Number(raw.decimals);
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 36) return null;

  const symbol = String(raw.symbol ?? '').trim();
  if (!symbol || symbol.length > 24) return null;

  return {
    symbol,
    name: String(raw.name ?? symbol).trim().slice(0, 60),
    address: getAddress(addr), // EIP-55 checksum
    decimals,
    logoURI: typeof raw.logoURI === 'string' ? raw.logoURI : null,
    source: sourceName,
    verified: false
  };
}

/* -------------------------------- fetching ------------------------------- */

async function fetchList(url, timeoutMs = 15000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { accept: 'application/json' } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Merge the curated list with fetched ones.
 *
 * Curated entries are inserted first and marked verified. Later entries with
 * an address we already hold are skipped, so an impostor USDT from a public
 * list can never displace the real one.
 */
function merge(chainId, fetched) {
  const out = [];
  const byAddress = new Set();
  const bySymbol = new Set();

  for (const t of TOKENS[chainId] ?? []) {
    out.push({ ...t, verified: true, source: 'FBT' });
    if (t.address) byAddress.add(t.address.toLowerCase());
    bySymbol.add(t.symbol.toUpperCase());
  }

  for (const t of fetched) {
    const key = t.address.toLowerCase();
    if (byAddress.has(key)) continue;
    byAddress.add(key);
    // Not skipped on symbol collision — two real tokens can share a ticker —
    // but flagged so the UI can warn, since this is how impersonation works.
    out.push({ ...t, symbolCollision: bySymbol.has(t.symbol.toUpperCase()) });
    bySymbol.add(t.symbol.toUpperCase());
  }

  return out;
}

/**
 * Full token list for a chain: curated first, then everything the public lists
 * know about. Never rejects — on total failure you get the curated list.
 *
 * @returns {Promise<{tokens: Array, degraded: boolean, count: number}>}
 */
export async function loadTokens(chainId) {
  const id = Number(chainId);

  if (memory.has(id)) return memory.get(id);

  const cached = readCache(id);
  if (cached?.length) {
    const result = { tokens: cached, degraded: false, count: cached.length };
    memory.set(id, result);
    return result;
  }

  const sources = SOURCES[id] ?? [];
  for (const src of sources) {
    try {
      const json = await fetchList(src.url);
      const rawTokens = Array.isArray(json) ? json : json?.tokens;
      if (!Array.isArray(rawTokens) || rawTokens.length === 0) continue;

      const clean = [];
      for (const raw of rawTokens) {
        const t = normalise(raw, id, src.name);
        if (t) clean.push(t);
      }
      if (clean.length === 0) continue;

      const tokens = merge(id, clean);
      writeCache(id, tokens);
      const result = { tokens, degraded: false, count: tokens.length };
      memory.set(id, result);
      return result;
    } catch {
      // Try the next mirror. Restricted networks make this the normal path,
      // not an exceptional one.
    }
  }

  // Everything failed. The curated list still lets the user trade the majors.
  const fallback = (TOKENS[id] ?? []).map((t) => ({ ...t, verified: true, source: 'FBT' }));
  const result = { tokens: fallback, degraded: true, count: fallback.length };
  memory.set(id, result);
  return result;
}

/**
 * Rank search results so the token someone means is first.
 *
 * Ordering rationale: an exact symbol match is almost always the intent, then
 * a symbol prefix, then a name prefix, then anything containing the query.
 * Within each tier, verified tokens outrank unverified ones — that is the
 * cheapest defence against a user tapping a lookalike.
 */
export function searchTokens(tokens, query, limit = 120) {
  const q = String(query ?? '').trim().toLowerCase();

  if (!q) {
    // No query: verified first, then the order upstream gave us (roughly by
    // liquidity/importance for every list we use).
    return tokens.slice(0, limit);
  }

  // A pasted contract address should resolve to exactly that token.
  if (q.startsWith('0x') && q.length === 42) {
    const hit = tokens.find((t) => t.address?.toLowerCase() === q);
    return hit ? [hit] : [];
  }

  const scored = [];
  for (const t of tokens) {
    const sym = t.symbol.toLowerCase();
    const name = (t.name ?? '').toLowerCase();

    let score = -1;
    if (sym === q) score = 0;
    else if (sym.startsWith(q)) score = 1;
    else if (name.startsWith(q)) score = 2;
    else if (sym.includes(q)) score = 3;
    else if (name.includes(q)) score = 4;
    if (score < 0) continue;

    scored.push({ t, score: score * 2 + (t.verified ? 0 : 1) });
    // Cap the work: scanning 10k tokens on every keystroke on a cheap phone
    // is noticeable, and nobody scrolls past a hundred results.
    if (scored.length > limit * 8) break;
  }

  scored.sort((a, b) => a.score - b.score);
  return scored.slice(0, limit).map((s) => s.t);
}

/**
 * Read an arbitrary contract the lists don't know about.
 *
 * New tokens are exactly where the volume is, and a token list published
 * yesterday won't have the one that launched this morning. Paste an address
 * and we ask the chain itself.
 */
export async function resolveCustomToken(provider, address) {
  if (!isAddress(address)) throw new Error('BAD_ADDRESS');
  const { Contract } = await import('ethers');
  const checksummed = getAddress(address);

  const erc20 = new Contract(
    checksummed,
    [
      'function symbol() view returns (string)',
      'function name() view returns (string)',
      'function decimals() view returns (uint8)'
    ],
    provider
  );

  const [symbol, name, decimals] = await Promise.all([
    erc20.symbol().catch(() => null),
    erc20.name().catch(() => null),
    erc20.decimals().catch(() => null)
  ]);

  // No symbol or decimals means this isn't a usable ERC-20 — could be an NFT,
  // a proxy with no implementation, or simply not a contract at all.
  if (symbol == null || decimals == null) throw new Error('NOT_ERC20');

  return {
    symbol: String(symbol).slice(0, 24),
    name: String(name ?? symbol).slice(0, 60),
    address: checksummed,
    decimals: Number(decimals),
    logoURI: null,
    source: 'custom',
    verified: false,
    custom: true
  };
}

/** Clears caches so the next open refetches. Exposed for a Settings action. */
export function clearTokenCache() {
  memory.clear();
  try {
    for (const k of Object.keys(localStorage)) {
      if (k.startsWith(CACHE_PREFIX)) localStorage.removeItem(k);
    }
  } catch {
    /* nothing we can do, and nothing that should break the app */
  }
}

export const tokenSourceCount = (chainId) => (SOURCES[Number(chainId)] ?? []).length;
