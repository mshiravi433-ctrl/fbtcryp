/**
 * CHAIN INTELLIGENCE — shared blockchain data layer for Explore and Security.
 *
 * ─── WHAT THIS IS ───────────────────────────────────────────────────────────
 * The single place the two upgraded pages touch the chain: JSON-RPC with
 * endpoint failover over the existing registry (server/chainsLite.js, itself
 * kept in sync with src/lib/chains.js), the Etherscan-compatible explorer
 * module APIs when an operator key is configured, and curated token reads
 * done with hand-encoded eth_call calldata (no new dependency).
 *
 * ─── WHAT THIS IS NOT ───────────────────────────────────────────────────────
 * Not an Intent OS component, and it does not import one; Explore and
 * Security resolve everything here through RPC / explorer APIs / provider
 * feeds and must stay fully functional with the intent layer deleted. This
 * module also NEVER signs, broadcasts, or mutates chain state — every method
 * here is read-only (eth_call, eth_get*, getLogs, and explorer GETs).
 *
 * ─── HONESTY CONTRACT (mirrors the product spec) ────────────────────────────
 *   · A value is returned only when a real source produced it. Missing data
 *     comes back as `null`, with the reason in `notices`, never as 0/false.
 *   · Every payload carries `meta: { source, updatedAt, ttlSeconds,
 *     freshness }` so the UI can say "Updated 14 seconds ago" or
 *     "stale — served from cache" truthfully.
 *   · RPC failure is a typed error (`{ code: 'RPC_UNAVAILABLE' }`), which the
 *     route layer renders as "Data temporarily unavailable".
 *   · Health is observed, never assumed: chain ping ok/fail timestamps drive
 *     the Security overview's infrastructure score.
 */

import { withCache } from './cache.js';
import { EVM_CHAINS, EVM_CHAIN_ORDER, TOKENS, SOLANA } from './chainsLite.js';

const RPC_TIMEOUT_MS = Number(process.env.CHAIN_INTEL_TIMEOUT_MS || 8000);
const HTTP_TIMEOUT_MS = Number(process.env.CHAIN_INTEL_HTTP_TIMEOUT_MS || 9000);

/* -------------------------------------------------------------------------- */
/* Chain config                                                                */
/* -------------------------------------------------------------------------- */

/*
 * Block cadence per chain. Explore uses this to convert block ranges into
 * wall-clock windows ("last ~4 hours"), and to size the log-scan windows the
 * same way whales.js does — so a 4-hour look-back on Arbitrum is ~48k blocks
 * and on Ethereum ~1200, rather than 15-everywhere.
 */
export const BLOCK_TIME_MS = {
  1: 12_000, 56: 3_000, 137: 2_200, 42161: 300, 8453: 2_000,
  10: 2_000, 43114: 2_000, 59144: 12_000, 146: 330
};

/** Max blocks a single eth_getLogs may span on public RPC (rate-limit safety). */
export const LOG_SCAN_MAX_BLOCKS = {
  1: 4_000, 56: 12_000, 137: 12_000, 42161: 48_000, 8453: 12_000,
  10: 12_000, 43114: 12_000, 59144: 4_000, 146: 12_000
};

/*
 * Etherscan-compatible explorer APIs. Keys are OPTIONAL: without one the
 * feature degrades — balances/metadata still come from RPC, while tx
 * histories, contract creation and source verification report
 * `unavailable (no explorer key)` rather than pretending. This is the same
 * fail-open-then-degrade pattern whales.js ships.
 */
export const EXPLORER_APIS = {
  1: { api: 'https://api.etherscan.io/v2/api', legacy: 'https://api.etherscan.io/api', keyEnv: 'ETHERSCAN_API_KEY', multichain: true },
  56: { api: 'https://api.bscscan.com/api', keyEnv: 'BSCSCAN_API_KEY' },
  137: { api: 'https://api.polygonscan.com/api', keyEnv: 'POLYGONSCAN_API_KEY' },
  42161: { api: 'https://api.arbiscan.io/api', keyEnv: 'ARBISCAN_API_KEY' },
  8453: { api: 'https://api.basescan.org/api', keyEnv: 'BASESCAN_API_KEY' },
  10: { api: 'https://api-optimistic.etherscan.io/api', keyEnv: 'OPTIMISTIC_ETHERSCAN_API_KEY' },
  43114: { api: 'https://api.snowtrace.io/api', keyEnv: 'SNOWTRACE_API_KEY' },
  59144: { api: 'https://api.lineascan.build/api', keyEnv: 'LINEASCAN_API_KEY' },
  146: { api: 'https://api.sonicscan.org/api', keyEnv: 'SONICSCAN_API_KEY' }
};

/** True when an explorer key for this chain is configured (never exposes it). */
export function explorerConfigured(chainId) {
  const cfg = EXPLORER_APIS[Number(chainId)];
  return Boolean(cfg && String(process.env[cfg.keyEnv] || '').trim());
}

export const CHAIN_IDS = EVM_CHAIN_ORDER;

export function chainKnown(chainId) {
  return Boolean(EVM_CHAINS[Number(chainId)]);
}

/* -------------------------------------------------------------------------- */
/* Health tracking — observed, never assumed                                   */
/* -------------------------------------------------------------------------- */

/*
 * In-process health of every data source the two pages lean on. The Security
 * overview reads this to compute "Infrastructure" and "Threat monitoring"
 * from real evidence: successes/failures with timestamps, latency, and how
 * long since the last good read. Like providerStatus.js, a fresh process
 * honestly reports null until something has actually been attempted.
 */
const health = new Map(); // key -> { lastSuccessAt, lastFailureAt, lastError, okCount, failCount, latencyMs }

export function recordSourceHealth(key, ok, detail = null, latencyMs = null) {
  const cur = health.get(key) || { lastSuccessAt: null, lastFailureAt: null, lastError: null, okCount: 0, failCount: 0, latencyMs: null };
  if (ok) {
    cur.lastSuccessAt = new Date().toISOString();
    cur.okCount += 1;
    if (latencyMs != null) cur.latencyMs = Math.round(latencyMs);
    if (cur.failCount && detail?.clearOnError !== false) cur.lastError = null;
  } else {
    cur.lastFailureAt = new Date().toISOString();
    cur.failCount += 1;
    cur.lastError = String(detail ?? 'unknown').slice(0, 160);
  }
  health.set(key, cur);
  return cur;
}

export function sourceHealth(key) {
  return health.get(key) || null;
}

export function healthSnapshot() {
  const out = {};
  for (const [key, v] of health.entries()) out[key] = { ...v };
  return out;
}

/* -------------------------------------------------------------------------- */
/* Activity log — the Security page's timeline comes from here                 */
/* -------------------------------------------------------------------------- */

/*
 * A bounded, in-process ring of real backend events: feed refreshes, cache
 * rebuilds, watch diffs, analysis runs. The Security timeline renders these
 * with their actual timestamps; there is no simulated tick. Per-process by
 * design — the response meta says so (`scope: 'process'`), because claiming
 * global history from a volatile buffer would be exactly the kind of
 * overstatement this product's rules forbid.
 */
const ACTIVITY_CAP = 400;
const activityRing = [];
const startedAt = new Date().toISOString();

export function recordIntelEvent(type, detail, source = null) {
  const entry = { at: new Date().toISOString(), type, detail: String(detail ?? '').slice(0, 240), source };
  activityRing.push(entry);
  if (activityRing.length > ACTIVITY_CAP) activityRing.shift();
  return entry;
}

export function intelActivity({ limit = 50 } = {}) {
  const n = Math.max(1, Math.min(ACTIVITY_CAP, Number(limit) || 50));
  return {
    events: activityRing.slice(-n).reverse(),
    meta: { scope: 'process', since: startedAt, capacity: ACTIVITY_CAP }
  };
}

/** Fire-and-forget wrapper: run a producer, log + health-record the outcome. */
export async function observed(key, label, producer, { eventOnSuccess = true } = {}) {
  const t0 = Date.now();
  try {
    const value = await producer();
    recordSourceHealth(key, true, null, Date.now() - t0);
    if (eventOnSuccess) recordIntelEvent('feed.refresh', `${label} refreshed`, key);
    return value;
  } catch (err) {
    recordSourceHealth(key, false, err?.message || String(err), Date.now() - t0);
    recordIntelEvent('feed.error', `${label}: ${String(err?.message || err).slice(0, 120)}`, key);
    throw err;
  }
}

/* -------------------------------------------------------------------------- */
/* Cache + freshness meta                                                      */
/* -------------------------------------------------------------------------- */

export function freshnessMeta(source, ttlMs, { cached = false, stale = false } = {}) {
  return {
    source,
    updatedAt: new Date().toISOString(),
    ttlSeconds: Math.round(ttlMs / 1000),
    freshness: stale ? 'STALE' : 'EXACT' // route layer overwrites EXACT→FRESH when served fresh
  };
}

/**
 * withCache + envelope: producer returns a plain payload, we return
 * `{ ...payload, meta }` where meta describes where the data came from and
 * how old it is. `cached`/`stale` from cache.js drive the freshness label:
 *   FRESH — regenerated now or recently and within TTL
 *   STALE — served from cache after TTL because upstream failed
 *   LIVE  — not a cached source at all (per-request reads)
 */
export async function cachedMeta(key, ttlMs, producer, source, opts = {}) {
  const { value, cached, stale } = await withCache(key, ttlMs, producer, opts);
  const meta = {
    source,
    cachedAt: value?.cachedAt || null,
    updatedAt: new Date().toISOString(),
    ttlSeconds: Math.round(ttlMs / 1000),
    freshness: stale ? 'STALE' : cached ? 'FRESH_CACHED' : 'FRESH',
    ...(value?.dataStatus ? { dataStatus: value.dataStatus } : {}),
    ...(opts.scope ? { scope: opts.scope } : {})
  };
  return { ...value, meta };
}

/* -------------------------------------------------------------------------- */
/* JSON-RPC with endpoint failover                                             */
/* -------------------------------------------------------------------------- */

export class IntelError extends Error {
  constructor(code, detail) {
    super(`${code}: ${detail || ''}`.trim());
    this.code = code;
    this.detail = String(detail || '').slice(0, 200);
  }
}

function ctrlTimeout(ms) {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), ms);
  return { signal: c.signal, done: () => clearTimeout(t) };
}

async function rpcOnce(url, method, params, timeout) {
  const { signal, done } = ctrlTimeout(timeout);
  const t0 = Date.now();
  try {
    const res = await fetch(url, {
      method: 'POST',
      signal,
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params })
    });
    if (!res.ok) throw new Error(`rpc http ${res.status}`);
    const j = await res.json();
    if (j.error) throw new Error(j.error.message || 'rpc error');
    if (j.result === undefined) throw new Error('rpc empty result');
    return { result: j.result, latencyMs: Date.now() - t0 };
  } finally {
    done();
  }
}

/**
 * Call an RPC method on a chain, trying every registry endpoint in order
 * until one answers — the same multi-endpoint discipline that rescued the
 * whale feed from single-RPC outages. Health is recorded per chain id.
 */
export async function rpcCall(chainId, method, params, { timeout = RPC_TIMEOUT_MS } = {}) {
  const chain = EVM_CHAINS[Number(chainId)];
  if (!chain) throw new IntelError('UNSUPPORTED_CHAIN', `chain ${chainId} is not in the registry`);
  const key = `rpc:${chainId}`;
  let lastErr = null;
  for (const url of chain.rpc) {
    try {
      const { result, latencyMs } = await rpcOnce(url, method, params, timeout);
      recordSourceHealth(key, true, null, latencyMs);
      return result;
    } catch (err) {
      lastErr = err;
    }
  }
  recordSourceHealth(key, false, lastErr?.message || String(lastErr));
  throw new IntelError('RPC_UNAVAILABLE', `all endpoints failed for chain ${chainId}: ${lastErr?.message || lastErr}`);
}

/** eth_call to an EVM contract; reverts/errors return null via caller guards. */
export async function ethCall(chainId, to, data) {
  try {
    return await rpcCall(chainId, 'eth_call', [{ to, data }, 'latest']);
  } catch {
    return null;
  }
}

/* -------------------------------------------------------------------------- */
/* Solana reads (public RPC; read-only, degrades to unavailable)               */
/* -------------------------------------------------------------------------- */

export async function solanaRpc(method, params, { timeout = HTTP_TIMEOUT_MS } = {}) {
  const { signal, done } = ctrlTimeout(timeout);
  const t0 = Date.now();
  try {
    const res = await fetch(SOLANA.rpc, {
      method: 'POST',
      signal,
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params })
    });
    if (!res.ok) throw new Error(`solana http ${res.status}`);
    const j = await res.json();
    if (j.error) throw new Error(j.error.message || 'solana rpc error');
    if (j.result === undefined) throw new Error('solana empty result');
    recordSourceHealth('rpc:solana', true, null, Date.now() - t0);
    return j.result;
  } catch (err) {
    recordSourceHealth('rpc:solana', false, err?.message || String(err), Date.now() - t0);
    throw new IntelError('RPC_UNAVAILABLE', `solana ${method}: ${err?.message || err}`);
  } finally {
    done();
  }
}

/* -------------------------------------------------------------------------- */
/* Etherscan-compatible explorer API (optional key, keyless → null)            */
/* -------------------------------------------------------------------------- */

/**
 * Query the chain's explorer API. Returns null — never throws — when no key
 * is configured, so every call site can say "explorer data unavailable" and
 * keep the rest of the payload honest. Errors (rate limit, downtime) also
 * return null but are health-recorded so the Security page can report them.
 */
export async function explorerQuery(chainId, module, action, params = {}) {
  const cfg = EXPLORER_APIS[Number(chainId)];
  const key = cfg ? String(process.env[cfg.keyEnv] || '').trim() : '';
  if (!cfg || !key) return null;
  const { signal, done } = ctrlTimeout(HTTP_TIMEOUT_MS);
  const qs = new URLSearchParams({ module, action, ...params, apikey: key });
  // Etherscan moved every non-mainnet chain onto one v2 host with chainid
  // routing; use it for Ethereum entries that declare `multichain` so one key
  // can serve all supported chain ids when operators use a v2 account.
  const base = cfg.api;
  if (cfg.multichain && Number(chainId) !== 1) {
    qs.set('chainid', String(chainId));
  }
  try {
    const res = await fetch(`${base}?${qs}`, { signal, headers: { accept: 'application/json' } });
    if (!res.ok) throw new Error(`explorer http ${res.status}`);
    const j = await res.json();
    recordSourceHealth(`explorer:${chainId}`, true);
    // "0" status with "No transactions Found" is a real answer, not a failure.
    return { status: String(j.status ?? ''), result: j.result, message: String(j.message ?? '') };
  } catch (err) {
    recordSourceHealth(`explorer:${chainId}`, false, err?.message || String(err));
    return null;
  } finally {
    done();
  }
}

/* -------------------------------------------------------------------------- */
/* Hex / ABI helpers (hand-rolled — the server carries no ethers dependency)   */
/* -------------------------------------------------------------------------- */

export const isAddress = (a) => /^0x[a-fA-F0-9]{40}$/.test(String(a || '').trim());
export const isTxHash = (h) => /^0x[a-fA-F0-9]{64}$/.test(String(h || '').trim());
export const normAddr = (a) => String(a || '').trim().toLowerCase();

export function hexToBig(h, fallback = 0n) {
  if (h == null) return fallback;
  try { return BigInt(h); } catch { return fallback; }
}
export function bigToHex(v) {
  return '0x' + BigInt(v).toString(16);
}
export function topicToAddr(t) {
  if (!t || t.length < 66) return null;
  return '0x' + t.slice(-40).toLowerCase();
}
/** Format wei-like values to a decimal string with n places, no Number loss. */
export function formatUnitsBig(wei, decimals) {
  const d = Math.max(0, Math.min(36, Number(decimals) | 0));
  const neg = wei < 0n;
  let v = neg ? -wei : wei;
  const base = 10n ** BigInt(d);
  const whole = v / base;
  const frac = v % base;
  if (d === 0) return `${neg ? '-' : ''}${whole}`;
  const fracStr = frac.toString().padStart(d, '0').replace(/0+$/, '');
  const shown = fracStr.slice(0, Math.min(6, fracStr.length));
  return `${neg ? '-' : ''}${whole}${shown ? '.' + shown : ''}`;
}

/*
 * Selectors and event topics. Every constant below was generated with a
 * keccak-256 implementation pinned against known vectors (Transfer matches the
 * value already shipped in whales.js) rather than transcribed from memory.
 * When adding a method, regenerate — do not hand-encode.
 */
export const SELECTORS = {
  name: '0x06fdde03',
  symbol: '0x95d89b41',
  decimals: '0x313ce567',
  totalSupply: '0x18160ddd',
  balanceOf: '0x70a08231',
  allowance: '0xdd62ed3e',
  owner: '0x8da5cb5b',
  paused: '0x5c975abb',
  implementation: '0x5c60da1b'
};

export const TOPICS = {
  transfer: '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef',
  approval: '0x8c5be1e5ebec7d5bd14f71427d1e84f3dd0314c0f7b2291e5b200ac8c7c3b925',
  deposit: '0xe1fffcc4923d04b559f4d29a8bfc6cda04eb5b0d3c460751c2402c5c5cc9109c',
  withdrawal: '0x7fcf532c15f0a6db0bd6d0e038bea71d30d808c7d98cb3bf7268a95bf5081b65',
  upgraded: '0xbc7cd75a20ee27fd9adebab32041f755214dbc6bffa90cc0225b39da2e5c2d3b',
  adminChanged: '0x7e644d79422f17c01e4894b5f4f588d331ebfa28653d42ae832dc59e38c9798f',
  ownershipTransferred: '0x8be0079c531659141344cd1fd0a4f28419497f9722a3daafe3b4186f6b6457e0',
  mint: '0x0f6798a560793a54c3bcfe86a93cde1e73087d944c0ea20544137d4121396885',
  burn: '0xcc16f5dbb4873280815c1ee09dbd06736cffcc184412cf7a71a0fdb75d397ca5',
  swap: '0xd78ad95fa46c994b6551d0da85fc275fe613ce37657fb8d5e3d130840159d822'
};

/* EIP-1967 proxy storage slots (keccak("eip1967.proxy.<name>") - 1). */
export const EIP1967 = {
  implementation: '0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc',
  admin: '0xb53127684a568b3173ae13b9f8a6016e243e63b6e8ee1178d6a717850b5d6103',
  beacon: '0xa3f0ad74e5423aebfd80d3ef4346578335a9a72aeaee59ff6cb3582b35133d50'
};

const WORD = 64; // hex chars per 32-byte word (after 0x)

/** Encode a static-arg call: selector + 32-byte words (address/uint). */
export function encodeCall(selector, args = []) {
  let data = selector;
  for (const a of args) {
    if (typeof a === 'string' && a.startsWith('0x') && a.length === 42) {
      data += a.slice(2).toLowerCase().padStart(WORD, '0');
    } else {
      data += BigInt(a ?? 0).toString(16).padStart(WORD, '0');
    }
  }
  return data;
}

export function decodeUint(hex, wordIndex = 0) {
  if (!hex || hex === '0x') return null;
  const words = hex.slice(2).match(/.{1,64}/g) || [];
  const w = words[wordIndex];
  if (!w) return null;
  try { return BigInt('0x' + w); } catch { return null; }
}

/** Decode a returned ABI `string` (dynamic bytes): offset → len → utf8. */
export function decodeAbiString(hex) {
  if (!hex || hex === '0x') return null;
  const body = hex.slice(2);
  if (body.length < WORD * 2) {
    // Short non-standard strings some tokens return raw
    try {
      return Buffer.from(body, 'hex').toString('utf8').replace(/\0+$/, '').trim() || null;
    } catch { return null; }
  }
  const offset = Number(decodeUint('0x' + body.slice(0, WORD)) ?? 0n) * 2;
  const lenWord = body.slice(offset, offset + WORD);
  if (!lenWord) return null;
  const len = Number(decodeUint('0x' + lenWord) ?? -1n);
  if (len < 0 || len > 4096) {
    // Not a dynamic string — some "standard" tokens return fixed bytes32.
    try {
      return Buffer.from(body.slice(0, WORD), 'hex').toString('utf8').replace(/[\0\xa0]+$/g, '').trim() || null;
    } catch { return null; }
  }
  try {
    return Buffer.from(body.slice(offset + WORD, offset + WORD + len * 2), 'hex').toString('utf8').trim() || null;
  } catch { return null; }
}

/* -------------------------------------------------------------------------- */
/* Method label table for the "What happened?" decoder                         */
/* -------------------------------------------------------------------------- */

/*
 * Deterministic decoding by selector. Only methods whose ABI we can lay out
 * byte-for-byte are described with parameters; anything else still gets a
 * name (so a wallet address screen can say "this was an approve"), never an
 * invented meaning. Keys are selectors; shape is { label, kind, args }.
 */
export const METHOD_TABLE = {
  '0xa9059cbb': { label: 'transfer', signature: 'transfer(address to, uint256 amount)', kind: 'transfer', args: ['address', 'uint256'] },
  '0x23b872dd': { label: 'transferFrom', signature: 'transferFrom(address from, address to, uint256 amount)', kind: 'transfer', args: ['address', 'address', 'uint256'] },
  '0x095ea7b3': { label: 'approve', signature: 'approve(address spender, uint256 amount)', kind: 'approval', args: ['address', 'uint256'] },
  '0x39509351': { label: 'increaseAllowance', signature: 'increaseAllowance(address spender, uint256 addedValue)', kind: 'approval', args: ['address', 'uint256'] },
  '0xa457c2d7': { label: 'decreaseAllowance', signature: 'decreaseAllowance(address spender, uint256 subtractedValue)', kind: 'approval', args: ['address', 'uint256'] },
  '0x38ed1739': { label: 'swapExactTokensForTokens', signature: 'swapExactTokensForTokens(uint256 amountIn, uint256 amountOutMin, address[] path, address to, uint256 deadline)', kind: 'swap' },
  '0x7ff36ab5': { label: 'swapExactETHForTokens', signature: 'swapExactETHForTokens(uint256 amountOutMin, address[] path, address to, uint256 deadline)', kind: 'swap' },
  '0x18cbafe5': { label: 'swapExactTokensForETH', signature: 'swapExactTokensForETH(uint256 amountIn, uint256 amountOutMin, address[] path, address to, uint256 deadline)', kind: 'swap' },
  '0x5c11d795': { label: 'swapExactTokensForTokens (fee-on-transfer)', kind: 'swap' },
  '0xb6f9de95': { label: 'swapExactETHForTokens (fee-on-transfer)', kind: 'swap' },
  '0x791ac947': { label: 'swapExactTokensForETH (fee-on-transfer)', kind: 'swap' },
  '0xe3219f79': { label: 'swapExactTokensForTokensSimple', kind: 'swap' },
  '0x75a5bf4e': { label: 'swapExactETHForTokensMemo', kind: 'swap' },
  '0x8803dbee': { label: 'swapTokensForExactTokens', kind: 'swap' },
  '0xfb3bdb41': { label: 'swapETHForExactTokens', kind: 'swap' },
  '0x4a25d94a': { label: 'swapTokensForExactETH', kind: 'swap' },
  '0xac9650d8': { label: 'multicall', kind: 'batch' },
  '0x5ae401dc': { label: 'multicall (with deadline)', kind: 'batch' },
  '0x2dee20c4': { label: 'Uniswap V3 swap', kind: 'swap' },
  '0x3593564c': { label: 'Universal Router execute', kind: 'swap' },
  '0xb2977a45': { label: '0x/uni swap', kind: 'swap' },
  '0x47ef6eae': { label: 'Uniswap V3 exactInputSingle', kind: 'swap' },
  '0x17f65294': { label: 'Uniswap V3 exactInput', kind: 'swap' },
  '0xf1bccfdf': { label: 'swap', kind: 'swap' },
  '0x31ebca60': { label: 'fullSwap', kind: 'swap' },
  '0xb7c91737': { label: 'swapTokens', kind: 'swap' },
  '0xf18f91e3': { label: 'swapTokensSimple', kind: 'swap' },
  '0x90f11e84': { label: 'swap', kind: 'swap' },
  '0xf10f1f58': { label: 'swap', kind: 'swap' },
  '0x11b31be4': { label: 'swapGeneric', kind: 'swap' },
  '0xe2a98171': { label: 'swapTokensForTokens', kind: 'swap' },
  '0xe480fead': { label: 'swapTokensToNative', kind: 'swap' },
  '0x0d5f7e37': { label: 'swapNativeToTokens', kind: 'swap' },
  '0xf305d719': { label: 'addLiquidityETH', kind: 'liquidity' },
  '0x02751cec': { label: 'removeLiquidityETH', kind: 'liquidity' },
  '0xd0e30db0': { label: 'deposit (wrap)', kind: 'deposit' },
  '0x2e1a7d4d': { label: 'withdraw (unwrap)', kind: 'withdraw' },
  '0x47e7ef24': { label: 'deposit', kind: 'deposit' },
  '0x4b8a3529': { label: 'borrow', kind: 'lending' },
  '0x22867d78': { label: 'repay', kind: 'lending' },
  '0xe9c7359c': { label: 'supply', kind: 'lending' },
  '0x2b83cccd': { label: 'redeem', kind: 'lending' },
  '0x0313cb8d': { label: 'liquidateBorrow', kind: 'lending' },
  '0xa694fc3a': { label: 'stake', kind: 'staking' },
  '0x2e17de78': { label: 'unstake', kind: 'staking' },
  '0x3a4b66f1': { label: 'stake', kind: 'staking' },
  '0xdb006a75': { label: 'redeem', kind: 'staking' },
  '0x5fed5bdb': { label: 'enterMarket', kind: 'lending' },
  '0xe23c73bd': { label: 'exitMarket', kind: 'lending' },
  '0xa22cb465': { label: 'setApprovalForAll (NFT)', kind: 'nft-approval' },
  '0x42842e0e': { label: 'safeTransferFrom (NFT)', kind: 'nft-transfer' },
  '0xb88d4fde': { label: 'safeTransferFrom (NFT, with data)', kind: 'nft-transfer' },
  '0x40e58ee5': { label: 'cancel order', kind: 'order' },
  '0xf2fde38b': { label: 'transferOwnership', kind: 'admin' },
  '0x8f283970': { label: 'changeAdmin', kind: 'admin' },
  '0x3659cfe6': { label: 'upgradeTo', kind: 'admin' },
  '0x4f1ef286': { label: 'upgradeToAndCall', kind: 'admin' },
  '0x4dd18bf5': { label: 'setPendingAdmin', kind: 'admin' },
  '0x40c10f19': { label: 'mint', kind: 'token-admin' },
  '0x42966c68': { label: 'burn', kind: 'token-admin' },
  '0x79cc6790': { label: 'burnFrom', kind: 'token-admin' },
  '0xf9f92be4': { label: 'blacklist', kind: 'token-admin' },
  '0x75e3661e': { label: 'unblacklist', kind: 'token-admin' },
  '0x3f4ba83a': { label: 'unpause', kind: 'token-admin' },
  '0x87596d5f': { label: 'swap (array form)', kind: 'swap' },
  '0xdfec9ae6': { label: 'swapTokensForExactAmount', kind: 'swap' },
  '0xa4e75735': { label: 'fillOrder', kind: 'order' },
  '0xb18cfc3d': { label: 'claim rewards', kind: 'rewards' }
};

/** Decode static args of a listed method from calldata. */
export function decodeMethodArgs(entry, input) {
  if (!entry?.args || !input || input.length < 10) return null;
  let body = input.slice(10); // strip the selector
  const out = [];
  for (const type of entry.args) {
    const word = body.slice(0, WORD);
    if (word.length < WORD) return null;
    if (type === 'address') out.push('0x' + word.slice(WORD - 40).toLowerCase());
    else out.push(decodeUint('0x' + word));
    body = body.slice(WORD);
  }
  return out;
}

/* -------------------------------------------------------------------------- */
/* Registry token metadata (curated) + per-chain token lookup                  */
/* -------------------------------------------------------------------------- */

export function registryToken(chainId, address) {
  const list = TOKENS[Number(chainId)] || [];
  const a = normAddr(address);
  return list.find((t) => t.address && normAddr(t.address) === a) || null;
}

/**
 * Read ERC-20 metadata via eth_call with registry override and per-chain
 * 30-minute cache — name/symbol/decimals never change on standard tokens,
 * so one read per contract per half hour serves every viewer.
 */
export async function tokenMeta(chainId, address) {
  const chain = Number(chainId);
  const key = `token-meta:${chain}:${normAddr(address)}`;
  return cachedMeta(key, 30 * 60_000, async () => {
    const reg = registryToken(chain, address);
    if (reg) {
      return {
        data: { name: reg.name, symbol: reg.symbol, decimals: reg.decimals, coingeckoId: reg.coingeckoId ?? null, registry: true, verified: reg.verified ?? false },
        cachedAt: new Date().toISOString()
      };
    }
    const [rawName, rawSymbol, rawDec] = await Promise.all([
      ethCall(chain, normAddr(address), SELECTORS.name),
      ethCall(chain, normAddr(address), SELECTORS.symbol),
      ethCall(chain, normAddr(address), SELECTORS.decimals)
    ]);
    if (rawName === null && rawSymbol === null && rawDec === null) {
      throw new IntelError('RPC_UNAVAILABLE', 'eth_call failed for token metadata');
    }
    const decimals = rawDec === null ? null : Number(decodeUint(rawDec) ?? 18);
    const data = {
      name: decodeAbiString(rawName),
      symbol: decodeAbiString(rawSymbol),
      decimals: Number.isFinite(decimals) ? decimals : null,
      coingeckoId: null,
      registry: false,
      verified: false
    };
    return {
      data,
      dataStatus: data.name || data.symbol ? 'live' : 'partial',
      notices: data.name ? [] : ['Metadata read returned nothing; this contract may not implement ERC-20 name().'],
      cachedAt: new Date().toISOString()
    };
  }, 'blockchain-rpc');
}

/* Log windows: "recent" = a bounded look-back sized by chain cadence. */
export function recentBlockWindow(chainId, hours = 4) {
  const bt = BLOCK_TIME_MS[Number(chainId)] || 5_000;
  const cap = LOG_SCAN_MAX_BLOCKS[Number(chainId)] || 5_000;
  return Math.max(100, Math.min(cap, Math.round((hours * 3_600_000) / bt)));
}

/* Native + token balance reads used by both the wallet explorer and scanner. */
export async function nativeBalance(chainId, address) {
  const hex = await rpcCall(chainId, 'eth_getBalance', [normAddr(address), 'latest']);
  return hexToBig(hex);
}

export async function tokenBalance(chainId, tokenAddress, owner) {
  const data = encodeCall(SELECTORS.balanceOf, [normAddr(owner)]);
  const hex = await ethCall(chainId, normAddr(tokenAddress), data);
  return hex === null ? null : decodeUint(hex);
}

export async function readAllowance(chainId, tokenAddress, owner, spender) {
  const data = encodeCall(SELECTORS.allowance, [normAddr(owner), normAddr(spender)]);
  const hex = await ethCall(chainId, normAddr(tokenAddress), data);
  return hex === null ? null : decodeUint(hex);
}

/** The allowance value every known router/deadline pattern uses for "never expires". */
export const UNLIMITED = (2n ** 256n) - 1n;
export const isUnlimitedAllowance = (v) => v != null && (v >= UNLIMITED / 2n || v === UNLIMITED);

/**
 * Recent transfer events involving an address, via eth_getLogs over a bounded
 * window. `partial: true` tells the route/UI the scan covered only the window,
 * which is the difference between an explorer and a lie.
 */
export async function recentTransferLogs(chainId, address, { extraTopics = null } = {}) {
  const chain = Number(chainId);
  const latest = hexToBig(await rpcCall(chain, 'eth_blockNumber', []));
  const window = recentBlockWindow(chain, 4);
  const from = latest > BigInt(window) ? '0x' + (latest - BigInt(window)).toString(16) : '0x0';
  const addrWord = '0x' + '0'.repeat(24) + normAddr(address).slice(2);
  const base = { fromBlock: from, toBlock: 'latest' };
  const filterIn = { ...base, topics: [TOPICS.transfer, null, addrWord] };
  const filterOut = { ...base, topics: [TOPICS.transfer, addrWord, null] };
  if (extraTopics) { filterIn.address = extraTopics; filterOut.address = extraTopics; }
  const [logsIn, logsOut] = await Promise.all([
    rpcCall(chain, 'eth_getLogs', [filterIn]).catch(() => []),
    rpcCall(chain, 'eth_getLogs', [filterOut]).catch(() => [])
  ]);
  const latestBlock = await rpcCall(chain, 'eth_getBlockByNumber', ['latest', false]).catch(() => null);
  const latestTs = latestBlock ? Number(hexToBig(latestBlock.timestamp)) * 1000 : null;
  const seen = new Map();
  for (const [dir, logs] of [['in', logsIn], ['out', logsOut]]) {
    for (const log of Array.isArray(logs) ? logs : []) {
      const id = `${log.transactionHash}:${log.logIndex ?? log.index ?? seen.size}`;
      if (seen.has(id)) continue;
      const blockMs = latestTs != null && log.blockNumber
        ? latestTs - Number(hexToBig(log.blockNumber)) * (BLOCK_TIME_MS[chain] || 5000)
        : null;
      seen.set(id, {
        hash: log.transactionHash,
        block: log.blockNumber ? Number(hexToBig(log.blockNumber)) : null,
        at: blockMs,
        token: normAddr(log.address),
        from: topicToAddr(log.topics?.[1]),
        to: topicToAddr(log.topics?.[2]),
        value: hexToBig(log.data),
        direction: dir
      });
    }
  }
  const rows = [...seen.values()].sort((a, b) => (b.block ?? 0) - (a.block ?? 0));
  return {
    transfers: rows,
    window: { fromBlock: Number(hexToBig(from)), toBlock: Number(latest), coveredFromMs: latestTs != null ? latestTs - Number(latest - hexToBig(from)) * (BLOCK_TIME_MS[chain] || 5000) : null },
    partial: true
  };
}

export { EVM_CHAINS, EVM_CHAIN_ORDER, TOKENS, SOLANA };
