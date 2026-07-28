/**
 * TOKEN UNIVERSE — thousands of swappable tokens per chain, PancakeSwap-style.
 *
 * WHY THIS EXISTS
 * ---------------------------------------------------------------------------
 * `TOKENS` in chains.js is a hand-verified handful. That is fine for a demo and
 * useless for a real DEX front end: the pair someone actually wants to swap is
 * almost never in a list of seven. PancakeSwap solves this by loading standard
 * "token lists" (the tokenlists.org JSON schema) at runtime — thousands of
 * entries per chain, kept current by whoever maintains the list — plus a
 * "paste any contract address" escape hatch.
 *
 * We do the same:
 *   1. The curated list from chains.js is always present and always first.
 *      Those addresses are hand-checked and cannot be moved by a remote host.
 *   2. Public token lists are fetched in the background and merged in. Each
 *      entry is tagged with its source so the UI can show provenance.
 *   3. Anything the lists don't have can be added by pasting the contract
 *      address; we read `symbol`/`decimals` straight from the chain.
 *
 * SAFETY, STATED PLAINLY
 * A token being *in a list* is not an endorsement. Anyone can deploy a token
 * called "USDT". The picker therefore shows the contract address for every
 * non-curated token, marks curated ones with a badge, and warns before a swap
 * into an unverified token. This mirrors what every serious DEX UI does,
 * because the alternative — a short list — just pushes people to worse UIs.
 *
 * Results are cached in localStorage for a day so the picker opens instantly
 * and works offline after the first load.
 */

import { TOKENS as CURATED } from './chains';
import { BASE_TOKENS } from './tokensBase';

const DAY = 24 * 60 * 60 * 1000;
const CACHE_PREFIX = 'fbt-tokens-v2:';

/**
 * Public token-list endpoints per chain, in priority order.
 *
 * These are the same lists the major DEX front ends use. They are plain static
 * JSON on public CDNs, so no key is needed and nothing about the user leaks.
 */
const LIST_SOURCES = {
  56: [
    { id: 'pancake-extended', url: 'https://tokens.pancakeswap.finance/pancakeswap-extended.json' },
    { id: 'pancake-top100', url: 'https://tokens.pancakeswap.finance/pancakeswap-top-100.json' },
    { id: 'coingecko-bsc', url: 'https://tokens.coingecko.com/binance-smart-chain/all.json' }
  ],
  1: [
    { id: 'uniswap', url: 'https://tokens.uniswap.org' },
    { id: 'coingecko-eth', url: 'https://tokens.coingecko.com/ethereum/all.json' }
  ],
  137: [
    { id: 'quickswap', url: 'https://unpkg.com/quickswap-default-token-list@1.3.20/build/quickswap-default.tokenlist.json' },
    { id: 'coingecko-polygon', url: 'https://tokens.coingecko.com/polygon-pos/all.json' }
  ],
  42161: [
    { id: 'arbitrum', url: 'https://bridge.arbitrum.io/token-list-42161.json' },
    { id: 'coingecko-arb', url: 'https://tokens.coingecko.com/arbitrum-one/all.json' }
  ],
  8453: [
    { id: 'coingecko-base', url: 'https://tokens.coingecko.com/base/all.json' }
  ],
  10: [
    { id: 'optimism', url: 'https://static.optimism.io/optimism.tokenlist.json' },
    { id: 'coingecko-op', url: 'https://tokens.coingecko.com/optimistic-ethereum/all.json' }
  ],
  43114: [
    { id: 'coingecko-avax', url: 'https://tokens.coingecko.com/avalanche/all.json' }
  ]
};

/** Rough per-chain cap so the picker stays responsive on cheap phones. */
const MAX_PER_CHAIN = 4000;

const memory = new Map(); // chainId -> token[]
const inflight = new Map(); // chainId -> Promise

const norm = (a) => String(a || '').toLowerCase();

function readCache(chainId) {
  try {
    const raw = localStorage.getItem(CACHE_PREFIX + chainId);
    if (!raw) return null;
    const { at, tokens } = JSON.parse(raw);
    if (!Array.isArray(tokens) || Date.now() - at > DAY) return null;
    return tokens;
  } catch {
    return null;
  }
}

function writeCache(chainId, tokens) {
  try {
    localStorage.setItem(CACHE_PREFIX + chainId, JSON.stringify({ at: Date.now(), tokens }));
  } catch {
    /* quota exceeded on a small device — the in-memory copy still works */
  }
}

async function fetchList(url, timeout = 12000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { accept: 'application/json' } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body = await res.json();
    // tokenlists.org schema puts entries under `tokens`; some CDNs serve a bare array.
    return Array.isArray(body) ? body : Array.isArray(body?.tokens) ? body.tokens : [];
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Hand-verified entries: the pairs wired into the swap engine, plus the
 * bundled high-liquidity set. These ship inside the app, so the picker is
 * never empty — not on a first launch with no network, not behind a filter
 * that blocks the list CDNs, not when a CDN is simply down.
 */
function curatedFor(chainId) {
  const seen = new Set();
  const out = [];
  for (const t of [...(CURATED[chainId] ?? []), ...(BASE_TOKENS[chainId] ?? [])]) {
    const k = t.native ? 'native' : norm(t.address);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push({ ...t, verified: true, source: t.source ?? 'curated' });
  }
  return out;
}

/**
 * Merge remote list entries into the curated base.
 * Curated always wins on conflict — a remote list can never redefine the
 * address we ship for USDT.
 */
function merge(chainId, base, remote, sourceId) {
  const seen = new Set(base.map((t) => norm(t.address)));
  const symbolSeen = new Set(base.map((t) => t.symbol?.toUpperCase()));
  const out = base.slice();

  for (const r of remote) {
    if (out.length >= MAX_PER_CHAIN) break;
    if (Number(r.chainId) !== Number(chainId)) continue;
    const address = r.address;
    if (!/^0x[a-fA-F0-9]{40}$/.test(address || '')) continue;
    if (seen.has(norm(address))) continue;

    const symbol = String(r.symbol || '').slice(0, 16);
    if (!symbol) continue;

    seen.add(norm(address));
    out.push({
      symbol,
      // Two different tokens can legitimately share a ticker. Keep both, but
      // make the duplicate visually distinguishable instead of silently
      // dropping whichever loaded second.
      duplicateSymbol: symbolSeen.has(symbol.toUpperCase()),
      name: String(r.name || symbol).slice(0, 48),
      address,
      decimals: Number(r.decimals ?? 18),
      logoURI: r.logoURI || null,
      native: false,
      verified: false,
      source: sourceId
    });
    symbolSeen.add(symbol.toUpperCase());
  }
  return out;
}

/**
 * Full token universe for a chain.
 *
 * Resolves immediately with the curated + cached set, then (unless
 * `refresh: false`) updates in the background. Callers get a promise for the
 * final list; use `getTokensSync` for the instant paint.
 */
export async function loadTokens(chainId, { refresh = true } = {}) {
  const cid = Number(chainId);
  if (memory.has(cid) && !refresh) return memory.get(cid);
  if (inflight.has(cid)) return inflight.get(cid);

  const cached = readCache(cid);
  if (cached?.length) {
    memory.set(cid, cached);
    if (!refresh) return cached;
  }

  const job = (async () => {
    let list = curatedFor(cid);
    for (const src of LIST_SOURCES[cid] ?? []) {
      if (list.length >= MAX_PER_CHAIN) break;
      try {
        const remote = await fetchList(src.url);
        list = merge(cid, list, remote, src.id);
      } catch {
        /* one dead CDN must not empty the picker */
      }
    }
    // Nothing reachable and nothing cached: at least return the curated set.
    if (list.length <= curatedFor(cid).length && cached?.length) list = cached;

    memory.set(cid, list);
    writeCache(cid, list);
    inflight.delete(cid);
    return list;
  })();

  inflight.set(cid, job);
  return job;
}

/** Whatever we already have for this chain, with no network access. */
export function getTokensSync(chainId) {
  const cid = Number(chainId);
  return memory.get(cid) ?? readCache(cid) ?? curatedFor(cid);
}

/** How many tokens are currently swappable across every supported chain. */
export function totalTokenCount() {
  let n = 0;
  for (const cid of Object.keys(LIST_SOURCES)) n += getTokensSync(cid).length;
  return n;
}

/* -------------------------------------------------------------------------- */
/* search                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Rank matches the way a trader expects: exact ticker first, then prefix,
 * then substring, then name, then address. Without the ranking, typing "BNB"
 * on BSC buries the real BNB under forty scam tokens with "BNB" in the name.
 */
export function searchTokens(tokens, query, limit = 120) {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return tokens.slice(0, limit);

  // A pasted contract address is an exact lookup, not a fuzzy search.
  if (/^0x[a-fA-F0-9]{40}$/.test(q)) {
    const hit = tokens.find((t) => norm(t.address) === q);
    return hit ? [hit] : [];
  }

  const scored = [];
  for (const t of tokens) {
    const sym = (t.symbol || '').toLowerCase();
    const name = (t.name || '').toLowerCase();
    let score = -1;
    if (sym === q) score = 0;
    else if (sym.startsWith(q)) score = 1;
    else if (name === q) score = 2;
    else if (name.startsWith(q)) score = 3;
    else if (sym.includes(q)) score = 4;
    else if (name.includes(q)) score = 5;
    else if (norm(t.address).includes(q)) score = 6;
    if (score < 0) continue;
    // Verified entries win any tie — that is the whole point of curating them.
    scored.push([score * 2 + (t.verified ? 0 : 1), t]);
    if (scored.length > limit * 8) break;
  }
  scored.sort((a, b) => a[0] - b[0]);
  return scored.slice(0, limit).map((x) => x[1]);
}

/* -------------------------------------------------------------------------- */
/* import by address                                                           */
/* -------------------------------------------------------------------------- */

/**
 * Read an arbitrary ERC-20 straight off the chain so a brand-new token — one
 * that launched an hour ago and is in no list yet — is still swappable.
 * This is exactly how PancakeSwap's "import token" works.
 */
export async function importTokenByAddress(provider, chainId, address) {
  const { Contract, isAddress } = await import('ethers');
  if (!isAddress(address)) throw new Error('INVALID_ADDRESS');

  const abi = [
    'function symbol() view returns (string)',
    'function name() view returns (string)',
    'function decimals() view returns (uint8)'
  ];
  const c = new Contract(address, abi, provider);
  const [symbol, name, decimals] = await Promise.all([
    c.symbol().catch(() => 'TOKEN'),
    c.name().catch(() => 'Unknown token'),
    c.decimals().then(Number).catch(() => 18)
  ]);

  const token = {
    symbol: String(symbol).slice(0, 16),
    name: String(name).slice(0, 48),
    address,
    decimals,
    native: false,
    verified: false,
    imported: true,
    source: 'imported'
  };

  // Persist so it survives a reload, like a real DEX front end.
  const cid = Number(chainId);
  const list = getTokensSync(cid);
  if (!list.some((t) => norm(t.address) === norm(address))) {
    const next = [...list, token];
    memory.set(cid, next);
    writeCache(cid, next);
  }
  return token;
}

/** Unique key for a token in a chain — symbols are not unique, addresses are. */
export const tokenKey = (t) => (t?.native ? 'native' : norm(t?.address));

export const findToken = (tokens, key) => tokens.find((t) => tokenKey(t) === key);
