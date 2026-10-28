/**
 * SMART MONEY — TOKEN FLOW, 24 HOURS ONLY (real, keyless, bounded)
 * ---------------------------------------------------------------------------
 * «شلوعی سرور و cpu و همینطور داده ۲۴ ساعته کافی است؛ نمی‌خواهم داده هفتگی و
 *  ۴ ساعته برای هوشمند مانی توکن‌ها.»
 *
 * WHY THIS MODULE IS NOW ONE WINDOW
 * The previous revision served 1h / 4h / 24h / 7d from a per-token trade tape.
 * That meant every cold token page arrived as a small fan-out of upstream
 * calls: pools + one trade page per pool, PLUS OHLCV candles for the windows
 * the pool attributes do not carry (4h and 7d) — up to ten HTTP requests for a
 * single card, on a serverless instance whose CPU and memory are shared by
 * every visitor. The expensive part was not the numbers: it was asking four
 * different questions about one token when three of those answers were never
 * going to change a decision.
 *
 * So the card now answers ONE question — «what did this contract's real DEX
 * trading look like over the last 24 hours?» — and the upstream surface is:
 *
 *   GeckoTerminal (keyless)
 *     /networks/{net}/tokens/{token}/pools   → the real pools + their h24
 *                                              volume and buy/sell counts
 *     /networks/{net}/pools/{pool}/trades    → real individual trades (wallet,
 *                                              side, USD, timestamp) for the
 *                                              two deepest pools
 *   DexScreener (fallback for pools/aggregates when GT is rate-limited)
 *   Blockscout (fallback tape for EVM when GT's trade feed is down)
 *
 * BOUNDED, ON PURPOSE
 *   · two pools, not three; one capped trade page each (≤ 300 rows total);
 *   · ONE cache entry per token, holding the finished summary (~1 KB), not the
 *     raw tape — the tape is transient and dies with the request;
 *   · 5-minute TTL with stale-while-revalidate, so a warm token costs zero
 *     upstream requests and a stale one is served instantly while one
 *     background read refreshes it;
 *   · a process-wide GeckoTerminal gate: at most 2 concurrent reads, and on
 *     the first 429 every GT read stops for 60 s and falls straight through to
 *     DexScreener. A rate-limited upstream must not turn into a retry storm
 *     (that storm, plus the whale scan it used to fall back to, is what took
 *     the CPU and memory of the instance down).
 *
 * HONESTY CONTRACT (unchanged, and the reason this file still exists)
 *   `0` only ever means «measured zero». A source that did not answer yields
 *   `null` and the card prints «—». Every `basis` below says exactly how the
 *   numbers were produced, and no wallet list is emitted — the card wants a
 *   measurement, not a directory of addresses.
 */

import { withCache, setCached } from '../cache.js';
import { dexPairsForTokens, bsTokenWideTransfers, BLOCKSCOUT } from './dataSources.js';
import { WINDOWS } from './config.js';

const GT_BASE = process.env.GECKOTERMINAL_BASE || 'https://api.geckoterminal.com/api/v2';

/**
 * chainId → GeckoTerminal network id.
 *
 * DexScreener uses DIFFERENT slugs for the same chains (polygon vs
 * polygon_pos, avalanche vs avax). Keeping one map per upstream is the only
 * way a request cannot silently query the wrong network — which would return
 * another chain's pools for the same-looking address.
 */
export const GT_NETWORKS = Object.freeze({
  1: 'eth',
  10: 'optimism',
  56: 'bsc',
  137: 'polygon_pos',
  8453: 'base',
  42161: 'arbitrum',
  43114: 'avalanche',
  solana: 'solana'
});

const EVM_ADDR = /^0x[a-fA-F0-9]{40}$/;
const SOL_ADDR = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

/** The only window this module serves. */
const WINDOW_KEY = '24h';
const WINDOW_MS = WINDOWS.H24;

/* Cache lifetimes. A 24-hour aggregate does not change every 45 seconds;
   five minutes keeps the card honest while cutting upstream reads by ~7×
   compared with the previous per-window, 45-second design. */
const FLOW_TTL_MS = 5 * 60_000;
/** A failed read is retried soon, but not on every request. */
const FLOW_FAIL_TTL_MS = 20_000;

const READ_DEADLINE_MS = 8_000;
const MIN_UPSTREAM_TIMEOUT_MS = 250;
/** Deepest pools first. Two is enough to describe a token's real trading and
 *  halves the upstream fan-out of the previous three-pool version. */
const MAX_POOLS = 2;
/** GeckoTerminal's trade page size — used to detect a page that may have
 *  stopped before the 24h cutoff. */
const TRADE_PAGE_CAP = 300;
/** Total rows kept transiently for one read. */
const MAX_TRADES = 300;

/* Upstream gate. Two concurrent GeckoTerminal reads are plenty for a card
   that is cached for five minutes, and the cooldown is what stops one 429
   from becoming hundreds of them. */
const GT_MAX_INFLIGHT = 2;
const GT_COOLDOWN_MS = 60_000;

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

function boundedTimeout(value, fallback = READ_DEADLINE_MS) {
  const n = Number(value);
  return Math.max(MIN_UPSTREAM_TIMEOUT_MS, Math.min(READ_DEADLINE_MS,
    Number.isFinite(n) && n > 0 ? n : fallback));
}

function remainingMs(deadlineAt) {
  const left = Number(deadlineAt) - Date.now();
  const headroom = Math.min(120, Math.max(10, Math.floor(left * 0.1)));
  const safe = left - headroom;
  return Number.isFinite(safe) && safe >= MIN_UPSTREAM_TIMEOUT_MS ? Math.floor(safe) : 0;
}

let fetchImpl = (url, opts) => globalThis.fetch(url, opts);

/**
 * Test seam, mirroring `dataSources.__setFetchForTests`. The probe suite must
 * be able to assert the extraction (side, USD, coverage, request count)
 * without spending an upstream request or needing a network at all. Pass null
 * to restore the global fetch.
 */
export function __setFetchForTests(fn) {
  fetchImpl = fn || ((url, opts) => globalThis.fetch(url, opts));
}

async function getJson(url, { timeoutMs = READ_DEADLINE_MS } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), boundedTimeout(timeoutMs));
  try {
    const res = await fetchImpl(url, {
      signal: ctrl.signal,
      headers: {
        accept: 'application/json',
        'user-agent': 'fbt-swap-app/1.0 (+https://fbtswap.ir)'
      }
    });
    if (!res.ok) {
      const err = new Error(`UPSTREAM_${res.status}`);
      err.status = res.status;
      throw err;
    }
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

/* ═════════════════ GeckoTerminal: concurrency gate ════════════════════ */

let gtInflight = 0;
const gtWaiters = [];
let gtCooldownUntil = 0;

/** Reset the gate between probe scenarios (never called by production code). */
export function __resetUpstreamGuardForTests() {
  gtInflight = 0;
  gtWaiters.length = 0;
  gtCooldownUntil = 0;
}

function gtCooling() {
  return Date.now() < gtCooldownUntil;
}

function acquireSlot(deadlineAt) {
  if (gtInflight < GT_MAX_INFLIGHT) {
    gtInflight += 1;
    return Promise.resolve();
  }
  return new Promise((resolve, reject) => {
    const waiter = { resolve: null, timer: null };
    const grant = () => {
      clearTimeout(waiter.timer);
      resolve(); // the slot is transferred: gtInflight stays the same
    };
    waiter.resolve = grant;
    waiter.timer = setTimeout(() => {
      const i = gtWaiters.indexOf(waiter);
      if (i >= 0) gtWaiters.splice(i, 1);
      reject(new Error('GT_QUEUE_DEADLINE'));
    }, Math.max(0, (Number(deadlineAt) || Date.now() + 1_000) - Date.now()));
    gtWaiters.push(waiter);
  });
}

function releaseSlot() {
  const next = gtWaiters.shift();
  if (next) next.resolve();
  else gtInflight = Math.max(0, gtInflight - 1);
}

async function gtGet(url, { timeoutMs, deadlineAt }) {
  if (gtCooling()) {
    const err = new Error('GT_COOLDOWN');
    err.status = 429;
    throw err;
  }
  await acquireSlot(deadlineAt);
  try {
    /* A waiter that was queued before a 429 must not fire after it. */
    if (gtCooling()) {
      const err = new Error('GT_COOLDOWN');
      err.status = 429;
      throw err;
    }
    return await getJson(url, { timeoutMs });
  } catch (err) {
    if (err?.status === 429) {
      gtCooldownUntil = Date.now() + GT_COOLDOWN_MS;
      /* Wake queued readers with the same cooldown instead of leaving them to
         time out one by one (each timeout is a held socket and a timer). */
      while (gtWaiters.length) {
        const w = gtWaiters.shift();
        clearTimeout(w.timer);
        w.resolve();
      }
    }
    throw err;
  } finally {
    releaseSlot();
  }
}

const normaliseToken = (chain, token) => (chain === 'solana'
  ? String(token || '').trim()
  : String(token || '').trim().toLowerCase());

const validToken = (chain, token) => (chain === 'solana' ? SOL_ADDR.test(token) : EVM_ADDR.test(token));

/* ═════════════════════ GeckoTerminal: pools ═══════════════════════════ */

function shapeGtPool(p) {
  const a = p?.attributes || {};
  const vol = a.volume_usd || {};
  const tx = a.transactions || {};
  /* Both legs or neither: defaulting a missing side to 0 would turn «not
     reported» into «measured zero», which is the one thing this file never
     does. */
  const txns = (key) => {
    const row = tx[key];
    if (!row) return null;
    const buys = num(row.buys);
    const sells = num(row.sells);
    return buys == null || sells == null ? null : { buys, sells };
  };
  return {
    address: String(a.address || (p?.id ? String(p.id).split('_').slice(1).join('_') : '') || ''),
    name: a.name || null,
    dex: p?.relationships?.dex?.data?.id || null,
    reserveUsd: num(a.reserve_in_usd),
    priceUsd: num(a.base_token_price_usd),
    createdAt: a.pool_created_at ? Date.parse(a.pool_created_at) || null : null,
    volume: { h24: num(vol.h24) },
    txns: { h24: txns('h24') }
  };
}

async function gtPools(chain, token, budget) {
  const network = GT_NETWORKS[chain];
  if (!network) return { dataStatus: 'unsupported-chain', pools: [] };
  try {
    const body = await gtGet(`${GT_BASE}/networks/${encodeURIComponent(network)}/tokens/${encodeURIComponent(token)}/pools?page=1`,
      budget);
    const rows = Array.isArray(body?.data) ? body.data : [];
    const pools = rows.map(shapeGtPool).filter((p) => p.address);
    return { dataStatus: pools.length ? 'live' : 'no-pools', pools };
  } catch (err) {
    return { dataStatus: err?.status === 429 ? 'rate-limited' : 'unavailable', pools: [] };
  }
}

/* ═════════════════════ GeckoTerminal: the trade tape ══════════════════ */

/**
 * One page of real trades (GeckoTerminal returns the latest ~300 per pool).
 * `volume_in_usd` is authoritative: a trade without it is dropped — the card
 * must never show an invented size.
 *
 * Side is derived from the TOKEN addresses, not from `kind`: `kind` is
 * relative to the pool's BASE token, and the queried contract is the quote
 * token in an inverted pool (e.g. USDC/TOKEN). Comparing the token legs keeps
 * the two legs correct on every pool shape; `kind` is only the tie-breaker.
 */
function shapeGtTrade(t, { token, pool }) {
  const a = t?.attributes || {};
  const usd = num(a.volume_in_usd);
  const at = a.block_timestamp ? Date.parse(a.block_timestamp) : null;
  if (usd == null || usd <= 0 || !Number.isFinite(at)) return null;
  const fromToken = a.from_token_address ? String(a.from_token_address) : null;
  const toToken = a.to_token_address ? String(a.to_token_address) : null;
  const sol = String(pool).length && !pool.startsWith('0x');
  const same = (x) => (x ? (sol ? x === String(token) : x.toLowerCase() === String(token).toLowerCase()) : false);
  let side = null;
  if (same(toToken)) side = 'BUY';
  else if (same(fromToken)) side = 'SELL';
  else if (a.kind === 'buy') side = 'BUY';
  else if (a.kind === 'sell') side = 'SELL';
  if (!side) return null;
  /* A trade the upstream indexed without the sending wallet is still a real
     trade: its USD value counts toward the window totals, it simply cannot be
     attributed to a wallet (and is therefore not counted as one). */
  const wallet = a.tx_from_address ? String(a.tx_from_address) : null;
  return {
    chain: null, // filled by the caller
    wallet,
    side,
    usd: Math.round(usd * 100) / 100,
    at,
    hash: a.tx_hash ? String(a.tx_hash) : null,
    pool
  };
}

async function gtPoolTrades(chain, token, pool, budget) {
  const network = GT_NETWORKS[chain];
  if (!network) return { dataStatus: 'unsupported-chain', trades: [] };
  try {
    const body = await gtGet(
      `${GT_BASE}/networks/${encodeURIComponent(network)}/pools/${encodeURIComponent(pool)}/trades`, budget);
    const rows = Array.isArray(body?.data) ? body.data : [];
    const trades = rows.map((r) => shapeGtTrade(r, { token, pool })).filter(Boolean);
    return { dataStatus: 'live', trades };
  } catch (err) {
    return { dataStatus: err?.status === 429 ? 'rate-limited' : 'unavailable', trades: [] };
  }
}

/* ═════════════════════ Blockscout fallback tape (EVM) ═════════════════ */

/**
 * Rebuild a trade tape from token-wide transfers when GeckoTerminal does not
 * answer (rate limit, outage). A transfer whose counterparty is one of the
 * token's own liquidity pools IS a swap: into the pool = the wallet bought,
 * out of the pool = the wallet sold. Value uses the pool's real USD price, so
 * the row is measured, not guessed. Wallets equal to the pool itself are
 * ignored (that is the pool, not a trader).
 */
function tapeFromTransfers(rows, { chain, token, pools }) {
  const poolByAddr = new Map(pools.map((p) => [String(p.address).toLowerCase(), p]));
  const trades = [];
  for (const r of rows) {
    const from = String(r.from || '').toLowerCase();
    const to = String(r.to || '').toLowerCase();
    const inPool = poolByAddr.get(to);
    const outPool = poolByAddr.get(from);
    if (!inPool && !outPool) continue;
    const side = inPool ? 'BUY' : 'SELL';
    const wallet = inPool ? from : to;
    if (!wallet || wallet === '0x0000000000000000000000000000000000000000') continue;
    const pool = inPool || outPool;
    const price = pool?.priceUsd;
    const amount = num(r.amount);
    if (price == null || amount == null || amount <= 0) continue;
    const usd = Math.round(amount * price * 100) / 100;
    if (!(usd > 0) || !Number.isFinite(r.timestamp)) continue;
    trades.push({ chain, wallet, side, usd, at: r.timestamp, pool: pool.address });
  }
  return trades;
}

/* ══════════════════════════════ tape ══════════════════════════════════ */

function emptyTape(chain, token, reason) {
  return {
    schema: 'fbt.smart-money-tape.v2',
    chain,
    token,
    at: Date.now(),
    status: 'unavailable',
    reason: reason || 'upstream-unavailable',
    source: 'none',
    poolSource: null,
    tradeSource: null,
    pools: [],
    trades: [],
    truncated: false
  };
}

function dedupeTrades(trades) {
  const seen = new Set();
  const out = [];
  for (const t of trades) {
    /* A hash is the row's identity when the upstream supplies one (a wallet
       can legitimately trade the same size twice in the same second); the
       composite key is only a fallback for rows without a hash. */
    const key = t.hash
      ? `${t.hash}:${t.side}:${t.usd}:${t.pool}`
      : `${Math.round(t.at / 1000)}:${t.side}:${t.usd}:${t.pool}:${t.wallet || ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(t);
  }
  return out.sort((a, b) => b.at - a.at).slice(0, MAX_TRADES);
}

async function buildTape(chain, token, deadlineAt) {
  if (!validToken(chain, token)) return emptyTape(chain, token, 'bad-address');

  const budget = () => ({
    timeoutMs: remainingMs(deadlineAt) || MIN_UPSTREAM_TIMEOUT_MS,
    deadlineAt
  });

  /* ── 1. pools ────────────────────────────────────────────────────────── */
  const poolRes = await gtPools(chain, token, budget());
  let pools = poolRes.pools;
  let poolSource = pools.length ? 'geckoterminal' : null;
  let reason = null;
  let pageCapped = false;

  if (!pools.length) {
    /* GT did not answer (or is cooling down after a 429): pool addresses +
       h24 aggregates from DexScreener in ONE request. */
    const ds = await dexPairsForTokens([token], { timeoutMs: budget().timeoutMs })
      .catch(() => ({ dataStatus: 'unavailable', pairs: [] }));
    const seen = new Set();
    pools = (ds.pairs || [])
      .filter((p) => p?.pairAddress && !seen.has(p.pairAddress) && seen.add(p.pairAddress))
      .sort((a, b) => (b.liquidityUsd ?? 0) - (a.liquidityUsd ?? 0))
      .map((p) => ({
        address: p.pairAddress,
        name: `${p.baseToken?.symbol || '?'}/${p.quoteToken?.symbol || '?'}`,
        dex: p.dexId || null,
        reserveUsd: p.liquidityUsd ?? null,
        priceUsd: p.priceUsd ?? null,
        createdAt: p.pairCreatedAt ?? null,
        volume: { h24: p.volume?.h24 ?? null },
        txns: { h24: p.txns?.h24?.buys != null && p.txns?.h24?.sells != null
          ? { buys: p.txns.h24.buys, sells: p.txns.h24.sells }
          : null }
      }));
    if (pools.length) poolSource = 'dexscreener';
    else reason = poolRes.dataStatus === 'rate-limited' ? 'rate-limited' : 'no-pools';
  }

  if (!pools.length) return emptyTape(chain, token, reason || 'no-pools');

  /* One canonical order: deepest pool first. The trade pages and the volume
     aggregate below both use this list. */
  pools = pools.slice().sort((a, b) => (b.reserveUsd ?? 0) - (a.reserveUsd ?? 0));

  /* ── 2. real trades from the two deepest pools (GeckoTerminal) ───────── */
  let trades = [];
  let tradeSource = null;
  let tradeReadFailed = false;
  if (!gtCooling()) {
    const deepest = pools.slice(0, MAX_POOLS);
    const settled = await Promise.allSettled(deepest.map((p) => {
      const b = budget();
      if (!remainingMs(deadlineAt)) return Promise.reject(new Error('DEADLINE'));
      return gtPoolTrades(chain, token, p.address, b);
    }));
    let answered = 0;
    for (const s of settled) {
      if (s.status === 'fulfilled' && s.value.dataStatus === 'live') answered += 1;
      if (s.status === 'fulfilled' && s.value.trades.length) {
        trades.push(...s.value.trades.map((t) => ({ ...t, chain })));
        if (s.value.trades.length >= TRADE_PAGE_CAP) pageCapped = true;
      }
    }
    /* «The source answered but this pool had no trades» and «nobody answered»
       are different facts, and the card words them differently. */
    tradeReadFailed = answered === 0;
    if (trades.length) tradeSource = 'geckoterminal';
  }

  /* ── 3. Blockscout tape when the GT trade feed produced nothing ──────── */
  if (!trades.length && BLOCKSCOUT[Number(chain)]) {
    const b = budget();
    const res = await bsTokenWideTransfers(Number(chain), token, { timeoutMs: b.timeoutMs })
      .catch(() => ({ rows: [] }));
    if (Array.isArray(res?.rows)) tradeReadFailed = tradeReadFailed && res.rows.length === 0;
    if (res?.rows?.length) {
      trades = tapeFromTransfers(res.rows, { chain, token, pools });
      if (trades.length) tradeSource = 'blockscout';
      if (res.hasMore) pageCapped = true;
    }
  }

  trades = dedupeTrades(trades);
  return {
    schema: 'fbt.smart-money-tape.v2',
    chain,
    token,
    at: Date.now(),
    /* `live` = the source answered and produced trades; `empty` = the source
       answered and this token genuinely has no indexed trades; `unavailable`
       = nobody answered. The card renders a different sentence for each — an
       outage is never shown as a flat market. */
    status: trades.length ? 'live' : 'empty',
    reason: trades.length ? null
      : (reason || (tradeReadFailed && !tradeSource ? 'trade-read-failed' : 'no-trades')),
    source: [poolSource, tradeSource].filter(Boolean).join('+'),
    poolSource,
    tradeSource,
    pools,
    trades,
    tradeCount: trades.length,
    oldestTradeAt: trades.length ? trades[trades.length - 1].at : null,
    /* True when the upstream page may have stopped before the 24h cutoff; the
       caller reports coverage instead of pretending it saw the whole day. */
    truncated: pageCapped || trades.length >= MAX_TRADES
  };
}

/**
 * Read the tape for one token WITHOUT caching it. Diagnostic/test surface only:
 * production reads go through `tokenTradeSignals`, which caches the finished
 * summary (a few hundred bytes) rather than hundreds of trade rows.
 */
export async function tokenTape(chainId, tokenAddress, { timeoutMs = READ_DEADLINE_MS } = {}) {
  const chain = String(chainId) === 'solana' ? 'solana' : Number(chainId) || 1;
  const token = normaliseToken(chain, tokenAddress);
  if (!token) return emptyTape(chain, token, 'bad-address');
  return buildTape(chain, token, Date.now() + boundedTimeout(timeoutMs));
}

/* ═════════════════════ Window aggregation ═════════════════════════════ */

/**
 * Real 24-hour volume and trade counts, straight from the pools' own h24
 * attributes. No extra request: these fields arrive with the pool list.
 *
 * Sums EVERY pool the source returned (not only the two whose trade pages we
 * read) so the volume describes the token, not just its deepest pair.
 * A pool that does not report a field is skipped — never treated as zero.
 */
export function poolWindowStats(tape) {
  const pools = Array.isArray(tape?.pools) ? tape.pools : [];
  const out = { volumeUsd: null, buys: null, sells: null, windowUsed: WINDOW_KEY, source: null };
  if (!pools.length) return out;
  const vols = pools.map((p) => p.volume?.h24).filter((v) => v != null);
  const buys = pools.map((p) => p.txns?.h24?.buys).filter((v) => v != null);
  const sells = pools.map((p) => p.txns?.h24?.sells).filter((v) => v != null);
  if (vols.length) out.volumeUsd = vols.reduce((a, b) => a + b, 0);
  if (buys.length && sells.length) {
    out.buys = buys.reduce((a, b) => a + b, 0);
    out.sells = sells.reduce((a, b) => a + b, 0);
  }
  if (out.volumeUsd != null || out.buys != null) out.source = 'pool-window';
  return out;
}

/* ══════════════════════════ the signals ═══════════════════════════════ */

/**
 * Turn a tape into the 24-hour card numbers.
 *
 * `basis` says how the number was produced, because these are not equally
 * strong claims:
 *
 *   · `trades`       — every USD figure comes from individual trades inside
 *                      the window; the sample reaches the cutoff.
 *   · `trades-sample`— the sample reaches the cutoff for MORE than half of the
 *                      window. Exact for what it saw, labelled `partial` with
 *                      its real coverage percentage.
 *   · `counts`       — the trade page covered less than half the day. The 24h
 *                      VOLUME and the buy/sell COUNTS are real (pool
 *                      attributes); the dollar split is derived from those
 *                      counts and flagged `estimated: true`. This is
 *                      deliberately preferred over reporting a 20-minute
 *                      sample as if it were the day.
 *   · `volume`       — volume only; direction unknown → nulls.
 *   · `none`         — nothing measured → nulls in every field.
 *
 * Wallet LISTS are not produced. Only the distinct-wallet count of the sample
 * is reported (`wallets`), because the card shows a measurement, not a
 * directory — and keeping 300 addresses in a cached response was pure weight.
 */
export function summariseTape(tape, { now = Date.now() } = {}) {
  const stats = poolWindowStats(tape);
  const all = Array.isArray(tape?.trades) ? tape.trades : [];
  const cutoff = now - WINDOW_MS;
  const inWindow = all.filter((t) => t.at && t.at >= cutoff && t.usd > 0);

  const buyWallets = new Set();
  const sellWallets = new Set();
  const wallets = new Set();
  let buyUsd = 0;
  let sellUsd = 0;
  for (const t of inWindow) {
    if (t.wallet) wallets.add(t.wallet);
    if (t.side === 'BUY') {
      buyUsd += t.usd;
      if (t.wallet) buyWallets.add(t.wallet);
    } else if (t.side === 'SELL') {
      sellUsd += t.usd;
      if (t.wallet) sellWallets.add(t.wallet);
    }
  }
  const oldest = inWindow.length ? Math.min(...inWindow.map((t) => t.at)) : null;

  /*
   * COVERAGE — the distinction that keeps a quiet token from being labelled
   * «partial».
   *
   * The trade page is "latest N". If the source returned FEWER than a full
   * page, we hold every trade the source has for this contract, so the window
   * is fully observed even when the newest trade is two hours old: an hour
   * without trades is a measured zero, not missing data.
   *
   * If the page came back FULL (or the explorer says there are more pages),
   * the tape may have stopped mid-window. Then coverage is the distance from
   * its oldest row to now — and the card prints that percentage instead of
   * letting a 20-minute sample describe a 24-hour window.
   */
  const oldestAny = all.length ? Math.min(...all.map((t) => t.at)) : null;
  const capped = !!tape?.truncated;
  const reachesCutoff = oldestAny != null && oldestAny <= cutoff;
  const complete = !capped || reachesCutoff || all.length === 0;
  let coveredPct = all.length === 0 && tape?.status === 'unavailable' ? null : 100;
  if (!complete) {
    const from = oldestAny ?? now;
    coveredPct = Math.max(1, Math.round(Math.min(1, (now - from) / WINDOW_MS) * 100));
  }

  const poolVolume = stats.volumeUsd != null ? Math.round(stats.volumeUsd) : null;
  const buys = stats.buys;
  const sells = stats.sells;
  const countTotal = (buys ?? 0) + (sells ?? 0);

  const base = {
    schema: 'fbt.smart-money-tokensignals.v3',
    window: WINDOW_KEY,
    windowMs: WINDOW_MS,
    /* The card serves exactly one window. Says so in the payload, so no
       consumer can ask for another one and silently receive this one. */
    singleWindow: true,
    at: now,
    volumeUsd: poolVolume,
    buys,
    sells,
    sampled: {
      trades: inWindow.length,
      wallets: wallets.size,
      from: oldest,
      to: inWindow.length ? now : null,
      coveredPct,
      complete,
      pageTruncated: !!tape?.truncated,
      tradeSource: tape?.tradeSource || null
    },
    coverage: {
      pools: Array.isArray(tape?.pools) ? tape.pools.length : 0,
      poolSource: tape?.poolSource || null,
      tradeSource: tape?.tradeSource || null,
      tapeStatus: tape?.status || 'unavailable',
      source: tape?.source || 'none'
    },
    wallets: null,
    accumulation: null,
    distribution: null,
    estimated: false,
    basis: 'none'
  };

  /* ── A. exact: the tape covers the whole day ─────────────────────────── */
  if (inWindow.length >= 1 && complete) {
    const net = buyUsd - sellUsd;
    return {
      ...base,
      dataStatus: 'live',
      basis: 'trades',
      estimated: false,
      buyUsd: Math.round(buyUsd),
      sellUsd: Math.round(sellUsd),
      netUsd: Math.round(net),
      trades: inWindow.length,
      wallets: wallets.size,
      ...detectors({ buyUsd, sellUsd, buyers: buyWallets.size, sellers: sellWallets.size, net, trades: inWindow.length })
    };
  }

  /* ── B. a sample that still covers more than half the day ────────────── */
  if (inWindow.length >= 1 && (coveredPct ?? 0) >= 50) {
    const net = buyUsd - sellUsd;
    return {
      ...base,
      dataStatus: 'live',
      basis: 'trades-sample',
      estimated: false,
      partial: true,
      buyUsd: Math.round(buyUsd),
      sellUsd: Math.round(sellUsd),
      netUsd: Math.round(net),
      trades: inWindow.length,
      wallets: wallets.size,
      ...detectors({ buyUsd, sellUsd, buyers: buyWallets.size, sellers: sellWallets.size, net, trades: inWindow.length })
    };
  }

  /* ── C. the 24h aggregates, when the sample is too thin to represent ─── */
  if (countTotal > 0) {
    const share = buys / countTotal;
    const buyLeg = poolVolume != null ? poolVolume * share : null;
    const sellLeg = poolVolume != null ? poolVolume * (1 - share) : null;
    return {
      ...base,
      dataStatus: 'live',
      basis: 'counts',
      /* The split is derived from real counts, so it is flagged. The volume
         and the counts themselves are measured, not derived. */
      estimated: true,
      buyUsd: buyLeg != null ? Math.round(buyLeg) : null,
      sellUsd: sellLeg != null ? Math.round(sellLeg) : null,
      netUsd: buyLeg != null && sellLeg != null ? Math.round(buyLeg - sellLeg) : null,
      /* The COUNT is the pool's 24h count; the wallets we saw are a sample,
         so pairing them would imply a coverage that does not exist. */
      trades: countTotal,
      wallets: null,
      ...detectors({
        buyUsd: buyLeg ?? 0,
        sellUsd: sellLeg ?? 0,
        buyers: buys,
        sellers: sells,
        net: (buyLeg ?? 0) - (sellLeg ?? 0),
        trades: countTotal
      })
    };
  }

  /* ── C2. a thin real sample and no 24h counts: still honest to show ──── */
  if (inWindow.length >= 1) {
    const net = buyUsd - sellUsd;
    return {
      ...base,
      dataStatus: 'live',
      basis: 'trades-sample',
      estimated: false,
      partial: true,
      buyUsd: Math.round(buyUsd),
      sellUsd: Math.round(sellUsd),
      netUsd: Math.round(net),
      trades: inWindow.length,
      wallets: wallets.size,
      ...detectors({ buyUsd, sellUsd, buyers: buyWallets.size, sellers: sellWallets.size, net, trades: inWindow.length })
    };
  }

  /* ── D. volume only, no direction anywhere ──────────────────────────── */
  if (poolVolume != null) {
    return {
      ...base,
      dataStatus: 'partial',
      basis: 'volume',
      estimated: false,
      buyUsd: null,
      sellUsd: null,
      netUsd: null,
      trades: null,
      wallets: null
    };
  }

  /* ── E. nothing was measured ────────────────────────────────────────── */
  return {
    ...base,
    dataStatus: 'unavailable',
    basis: 'none',
    buyUsd: null,
    sellUsd: null,
    netUsd: null,
    trades: null,
    wallets: null,
    reason: tape?.reason || 'no-pools'
  };
}

/**
 * Accumulation / distribution from REAL trade evidence.
 *
 * `netBuying` is the USD imbalance of the observed trades; `breadth` is how
 * one-sided the participating wallets are. `null` rather than a 0-confidence
 * object when there is no evidence: the UI prints «—» instead of a 0% meter
 * that reads as "measured distribution".
 */
function detectors({ buyUsd, sellUsd, buyers, sellers, net, trades }) {
  const scale = Math.max(buyUsd, sellUsd, 1);
  const breadthBuy = buyers + sellers > 0 ? buyers / (buyers + sellers) : null;
  const netBuying = trades ? Math.max(0, net) / scale : null;
  const netSelling = trades ? Math.max(0, -net) / scale : null;
  const accumBreadth = breadthBuy != null ? Math.max(0, (breadthBuy - 0.5) * 2) : null;
  const distribBreadth = breadthBuy != null ? Math.max(0, (0.5 - breadthBuy) * 2) : null;
  return {
    accumulation: {
      /* `confidence` is the key the card and the engines already read; the
         value is the observed strength of the pattern (0–100), never a
         probability of a price move. */
      confidence: Math.round(Math.min(1, (netBuying ?? 0) * 0.7 + (accumBreadth ?? 0) * 0.3) * 100),
      netBuyingUsd: Math.round(Math.max(0, net)),
      buyers,
      sellers
    },
    distribution: {
      confidence: Math.round(Math.min(1, (netSelling ?? 0) * 0.7 + (distribBreadth ?? 0) * 0.3) * 100),
      netSellingUsd: Math.round(Math.max(0, -net)),
      buyers,
      sellers
    }
  };
}

/**
 * Full read for the token card: ONE cached 24-hour summary per token.
 *
 * The raw tape is NOT cached. Caching it meant every visited token pinned up
 * to 900 trade objects (plus pools) in the process heap until the instance
 * died — which is precisely the memory pressure the card was blamed for. The
 * cached value here is the finished summary: a few hundred bytes.
 *
 * Stale-while-revalidate: a warm-but-expired token answers immediately and a
 * single background read refreshes it, so five visitors do not start five
 * fan-outs.
 */
export async function tokenTradeSignals(chainId, tokenAddress, { timeoutMs = READ_DEADLINE_MS, now = Date.now() } = {}) {
  const chain = String(chainId) === 'solana' ? 'solana' : Number(chainId) || 1;
  const token = normaliseToken(chain, tokenAddress);
  if (!token) return summariseTape(emptyTape(chain, token, 'bad-address'), { now });
  const key = `sm:tokenflow:${chain}:${token}`;
  const { value } = await withCache(key, FLOW_TTL_MS, async () => {
    const tape = await buildTape(chain, token, Date.now() + boundedTimeout(timeoutMs));
    return summariseTape(tape, { now: Date.now() });
  }, { swr: true });
  /* An unmeasured answer must not be pinned for the full five minutes: the
     next request retries sooner, without turning every request into a fetch. */
  if (value?.dataStatus === 'unavailable') setCached(key, value, FLOW_FAIL_TTL_MS);
  return value;
}

export { shapeGtTrade, shapeGtPool, tapeFromTransfers, dedupeTrades, WINDOW_KEY as TOKEN_WINDOW };
