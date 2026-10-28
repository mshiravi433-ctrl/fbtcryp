/**
 * SMART MONEY — PER-TOKEN TRADE TAPE (real, windowed, keyless)
 * ---------------------------------------------------------------------------
 * «در صفحه اطلاعات هر توکن، قسمت هوشمند مانی داده‌ها صفرند و با تغییر زمان هم
 *  داده‌ای نشان نمی‌دهد.»
 *
 * The token card used to derive buying / selling / net flow / top buyers /
 * top sellers / wallet count from ONE source: the whale event buffer
 * (`labelledEvents` at a $100k floor). That buffer only contains large
 * transfers observed while the scanner happened to be running. For the
 * overwhelming majority of token contracts it is empty — so `tokenFlow`
 * summed two empty arrays, `tokenSignals` returned `buyUsd: 0, sellUsd: 0`,
 * and because the zero was computed AFTER the window filter, all four window
 * buttons returned the same zero. The page was not broken; it was measuring
 * a firehose of ≥ $100k transfers and reporting "nothing" as "$0".
 *
 * This module gives the token card its own honest, per-token source:
 *
 *   1. GeckoTerminal (keyless, already used by server/providers.js)
 *        /networks/{net}/tokens/{token}/pools        → the real pools
 *        /networks/{net}/pools/{pool}/trades         → the actual trades,
 *                                                      with the sending
 *                                                      wallet, side, USD
 *                                                      value and timestamp
 *        /networks/{net}/pools/{pool}/ohlcv/{tf}     → real traded volume for
 *                                                      windows the pool
 *                                                      attributes do not carry
 *                                                      (4h, 7d)
 *   2. DexScreener pairs (already the spine of tokenIntel) for pool
 *      addresses/volume/counts when GeckoTerminal is rate-limited, plus
 *      Blockscout token-wide transfers matched against those pool addresses
 *      (transfer INTO a pool = that wallet bought, transfer OUT = sold) to
 *      rebuild a tape with wallets on EVM chains.
 *   3. Nothing. A source that did not answer yields `null`, never a zero —
 *      the UI renders «—» and a reason, not «$0».
 *
 * Every trade row here is a real on-chain (or upstream-indexed) event. The
 * module never invents a wallet, a side or a USD value: an unpriced trade is
 * dropped, not estimated.
 */

import { withCache, setCached } from '../cache.js';
import { dexPairsForTokens, bsTokenWideTransfers, BLOCKSCOUT } from './dataSources.js';
import { WINDOWS, WINDOW_KEYS } from './config.js';

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

const TAPE_TTL_MS = 45_000;
const OHLCV_TTL_MS = 180_000;
const READ_DEADLINE_MS = 12_000;
const MIN_UPSTREAM_TIMEOUT_MS = 250;
/** A trade page is capped by the upstream; more than this per token is noise
 *  for a 3-tile summary and multiplies rate-limit pressure. */
const MAX_POOLS = 3;
/** GeckoTerminal's trade page size — a page that comes back full may have
 *  stopped before the window start, so coverage must say so. */
const TRADE_PAGE_CAP = 300;
const MAX_TRADES = 900;

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const shortAddr = (a) => (!a ? '' : `${a.slice(0, 6)}…${a.slice(-4)}`);

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
 * be able to assert the extraction (side, USD, wallet, coverage) without
 * spending an upstream request or needing a network at all. Pass null to
 * restore the global fetch.
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

const normaliseToken = (chain, token) => (chain === 'solana'
  ? String(token || '').trim()
  : String(token || '').trim().toLowerCase());

const validToken = (chain, token) => (chain === 'solana' ? SOL_ADDR.test(token) : EVM_ADDR.test(token));

/* ═════════════════════ GeckoTerminal: pools ═══════════════════════════ */

function shapeGtPool(p) {
  const a = p?.attributes || {};
  const vol = a.volume_usd || {};
  const tx = a.transactions || {};
  const txns = (key) => {
    const row = tx[key];
    if (!row) return null;
    const buys = num(row.buys);
    const sells = num(row.sells);
    return buys == null && sells == null ? null : { buys: buys ?? 0, sells: sells ?? 0 };
  };
  return {
    address: String(a.address || (p?.id ? String(p.id).split('_').slice(1).join('_') : '') || ''),
    name: a.name || null,
    dex: p?.relationships?.dex?.data?.id || null,
    reserveUsd: num(a.reserve_in_usd),
    priceUsd: num(a.base_token_price_usd),
    createdAt: a.pool_created_at ? Date.parse(a.pool_created_at) || null : null,
    volume: { h1: num(vol.h1), h6: num(vol.h6), h24: num(vol.h24) },
    txns: { h1: txns('h1'), h6: txns('h6'), h24: txns('h24') }
  };
}

async function gtPools(chain, token, { timeoutMs }) {
  const network = GT_NETWORKS[chain];
  if (!network) return { dataStatus: 'unsupported-chain', pools: [] };
  try {
    const body = await getJson(`${GT_BASE}/networks/${encodeURIComponent(network)}/tokens/${encodeURIComponent(token)}/pools?page=1`,
      { timeoutMs });
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
     attributed to a wallet (so it never appears in top buyers/sellers). Older
     GeckoTerminal responses omit `tx_from_address`; dropping those rows made a
     busy token look empty. */
  const wallet = a.tx_from_address ? String(a.tx_from_address) : null;
  return {
    chain: null, // filled by the caller
    wallet,
    side,
    usd: Math.round(usd * 100) / 100,
    at,
    hash: a.tx_hash ? String(a.tx_hash).toLowerCase() : null,
    pool
  };
}

async function gtPoolTrades(chain, token, pool, { timeoutMs }) {
  const network = GT_NETWORKS[chain];
  if (!network) return { dataStatus: 'unsupported-chain', trades: [] };
  try {
    const body = await getJson(
      `${GT_BASE}/networks/${encodeURIComponent(network)}/pools/${encodeURIComponent(pool)}/trades`, { timeoutMs });
    const rows = Array.isArray(body?.data) ? body.data : [];
    const trades = rows.map((r) => shapeGtTrade(r, { token, pool })).filter(Boolean);
    return { dataStatus: 'live', trades };
  } catch (err) {
    return { dataStatus: err?.status === 429 ? 'rate-limited' : 'unavailable', trades: [] };
  }
}

/* ═════════════════════ Real volume for windows GT attributes lack ══════ */

/**
 * `4h` and `7d` do not exist as pool attributes (only m5…h24). They DO exist
 * as candles, so the volume is read from the OHLCV endpoint instead of being
 * scaled or interpolated from 24h. A window whose volume is not measured
 * stays `null`.
 */
const OHLCV_SPEC = {
  '4h': { timeframe: 'hour', limit: 4, window: '4h' },
  '7d': { timeframe: 'day', limit: 7, window: '7d' }
};

async function gtOhlcvVolume(chain, pool, spec, { timeoutMs }) {
  const network = GT_NETWORKS[chain];
  if (!network) return { dataStatus: 'unsupported-chain', volumeUsd: null, buys: null, sells: null };
  try {
    const body = await getJson(
      `${GT_BASE}/networks/${encodeURIComponent(network)}/pools/${encodeURIComponent(pool)}/ohlcv/${spec.timeframe}?aggregate=1&limit=${spec.limit}&currency=usd`,
      { timeoutMs });
    const list = body?.data?.attributes?.ohlcv_list;
    if (!Array.isArray(list) || !list.length) return { dataStatus: 'no-candles', volumeUsd: null, buys: null, sells: null };
    let sum = 0;
    for (const row of list) {
      const v = Array.isArray(row) ? num(row[5]) : null;
      if (v != null) sum += v;
    }
    return { dataStatus: 'live', volumeUsd: sum > 0 ? sum : null, buys: null, sells: null };
  } catch (err) {
    return { dataStatus: err?.status === 429 ? 'rate-limited' : 'unavailable', volumeUsd: null, buys: null, sells: null };
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
    trades.push({ chain, wallet, side, usd, at: r.timestamp, hash: r.hash || null, pool: pool.address });
  }
  return trades;
}

/* ══════════════════════════════ tape ══════════════════════════════════ */

function emptyTape(chain, token, reason) {
  return {
    schema: 'fbt.smart-money-tape.v1',
    chain,
    token,
    at: Date.now(),
    status: 'unavailable',
    reason: reason || 'upstream-unavailable',
    source: 'none',
    tradeSource: null,
    pools: [],
    trades: [],
    truncated: false,
    poolWindow: null
  };
}

function dedupeTrades(trades) {
  const seen = new Set();
  const out = [];
  for (const t of trades) {
    const key = `${t.hash || `${t.wallet}:${t.at}:${t.side}`}:${t.side}:${Math.round(t.usd)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(t);
  }
  return out.sort((a, b) => b.at - a.at).slice(0, MAX_TRADES);
}

async function buildTape(chain, token, deadlineAt) {
  if (!validToken(chain, token)) return emptyTape(chain, token, 'bad-address');

  /* ── 1. pools + trades from GeckoTerminal ───────────────────────────── */
  const poolRes = await gtPools(chain, token, { timeoutMs: remainingMs(deadlineAt) || MIN_UPSTREAM_TIMEOUT_MS });
  let pools = poolRes.pools;
  let poolSource = pools.length ? 'geckoterminal' : null;
  let tradeSource = null;
  let trades = [];
  let reason = null;
  let pageCapped = false;

  if (pools.length) {
    /* Keep ONE canonical order: deepest pool first. The trade pages are read
       from these pools and the volume aggregates below sum the same ones — if
       the two used different slices, the window volume could describe pools
       the tape never read. */
    pools = pools.slice().sort((a, b) => (b.reserveUsd ?? 0) - (a.reserveUsd ?? 0)).slice(0, MAX_POOLS);
    const ordered = pools;
    const settled = await Promise.allSettled(ordered.map((p) => {
      const timeoutMs = remainingMs(deadlineAt);
      if (!timeoutMs) return Promise.reject(new Error('DEADLINE'));
      return gtPoolTrades(chain, token, p.address, { timeoutMs });
    }));
    for (const s of settled) {
      if (s.status === 'fulfilled' && s.value.trades.length) {
        trades.push(...s.value.trades.map((t) => ({ ...t, chain })));
        /* A full page means the upstream may have stopped mid-window. */
        if (s.value.trades.length >= TRADE_PAGE_CAP) pageCapped = true;
      }
    }
    if (trades.length) tradeSource = 'geckoterminal';
    else reason = settled.every((s) => s.status === 'fulfilled' && s.value.dataStatus === 'live') ? 'no-trades' : 'trade-read-failed';
  } else {
    /* GT did not answer: pool addresses + aggregates from DexScreener. */
    const ds = await dexPairsForTokens([token], { timeoutMs: remainingMs(deadlineAt) || MIN_UPSTREAM_TIMEOUT_MS })
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
        volume: { h1: p.volume?.h1 ?? null, h6: p.volume?.h6 ?? null, h24: p.volume?.h24 ?? null },
        txns: { h1: p.txns?.h1 ?? null, h6: null, h24: p.txns?.h24 ?? null }
      }));
    if (pools.length) poolSource = 'dexscreener';
    else reason = poolRes.dataStatus === 'rate-limited' ? 'rate-limited' : 'no-pools';

    /* ── 2. Blockscout tape for EVM chains when GT's trade feed is down ── */
    if (pools.length && BLOCKSCOUT[Number(chain)]) {
      const timeoutMs = remainingMs(deadlineAt) || MIN_UPSTREAM_TIMEOUT_MS;
      const res = await bsTokenWideTransfers(Number(chain), token, { timeoutMs }).catch(() => ({ rows: [] }));
      if (res?.rows?.length) {
        trades = tapeFromTransfers(res.rows, { chain, token, pools });
        if (trades.length) tradeSource = 'blockscout';
        if (res.hasMore) pageCapped = true;
      }
    }
  }

  if (!pools.length) return emptyTape(chain, token, reason || 'no-pools');

  trades = dedupeTrades(trades);
  const oldestAt = trades.length ? trades[trades.length - 1].at : null;
  return {
    schema: 'fbt.smart-money-tape.v1',
    chain,
    token,
    at: Date.now(),
    /* `live` means "the source answered and produced trades", `empty` means
       "the source answered and this token genuinely has no indexed trades in
       the page", `unavailable` means "nobody answered". The card renders a
       different sentence for each — an outage is never shown as a flat
       market. */
    status: trades.length ? 'live' : (pools.length ? 'empty' : 'unavailable'),
    reason: trades.length ? null : (reason || 'no-trades'),
    source: [poolSource, tradeSource].filter(Boolean).join('+') || 'none',
    poolSource,
    tradeSource,
    pools: pools.slice(0, MAX_POOLS),
    trades,
    tradeCount: trades.length,
    oldestTradeAt: oldestAt,
    /* True when the upstream page may have stopped before the window start;
       the caller reports coverage instead of pretending it saw the whole
       window. */
    truncated: pageCapped || trades.length >= MAX_TRADES,
    poolWindow: null
  };
}

/**
 * Read (or reuse) the tape for one token. Cached WITHOUT the window key: the
 * tape is a time series, so all four window buttons slice the same read
 * instead of hammering the upstream four times — and switching windows is
 * instant, which is exactly the complaint the zeroes caused.
 */
export async function tokenTape(chainId, tokenAddress, { timeoutMs = READ_DEADLINE_MS } = {}) {
  const chain = String(chainId) === 'solana' ? 'solana' : Number(chainId) || 1;
  const token = normaliseToken(chain, tokenAddress);
  if (!token) return emptyTape(chain, token, 'bad-address');
  const deadlineAt = Date.now() + boundedTimeout(timeoutMs);
  try {
    const { value } = await withCache(`sm:tape:${chain}:${token}`, TAPE_TTL_MS,
      () => buildTape(chain, token, deadlineAt));
    /* A FAILED read must not stay in the cache for the full TTL: the card
       would keep showing «not measured» for 45 s after one
       rate-limited request even though the source recovered in two. Retry
       soon instead of punishing the user for an upstream hiccup. */
    if (value?.status === 'unavailable') setCached(`sm:tape:${chain}:${token}`, value, 8_000);
    return value;
  } catch {
    return emptyTape(chain, token, 'upstream-unavailable');
  }
}

/* ═════════════════════ Window aggregation ═════════════════════════════ */

/** Pool-attribute windows (real upstream volume + buy/sell COUNTS). */
const POOL_WINDOW_KEYS = { '1h': 'h1', '6h': 'h6', '24h': 'h24' };

/**
 * Total real volume and trade counts for the requested window.
 *
 * Returns `{ volumeUsd, buys, sells, windowUsed, source }` where `windowUsed`
 * is the span the upstream actually reported. For 4h/7d the pool attributes
 * have nothing, so the OHLCV candles are summed (`windowUsed` stays the
 * requested window because the candles cover exactly it); when even those are
 * unavailable the caller gets `volumeUsd: null` — never a scaled 24h number.
 */
export async function poolWindowStats(tape, windowKey, { timeoutMs = READ_DEADLINE_MS } = {}) {
  const win = WINDOW_KEYS[windowKey] ? windowKey : '24h';
  const pools = (tape?.pools || []).slice(0, MAX_POOLS);
  const out = { volumeUsd: null, buys: null, sells: null, windowUsed: win, source: null };
  if (!pools.length) return out;

  const key = POOL_WINDOW_KEYS[win];
  if (key) {
    const vols = pools.map((p) => p.volume?.[key]).filter((v) => v != null);
    const buys = pools.map((p) => p.txns?.[key]?.buys).filter((v) => v != null);
    const sells = pools.map((p) => p.txns?.[key]?.sells).filter((v) => v != null);
    if (vols.length) out.volumeUsd = vols.reduce((a, b) => a + b, 0);
    if (buys.length && sells.length) {
      out.buys = buys.reduce((a, b) => a + b, 0);
      out.sells = sells.reduce((a, b) => a + b, 0);
    }
    if (out.volumeUsd != null || out.buys != null) out.source = 'pool-window';
    return out;
  }

  /* 4h / 7d: candles. */
  const spec = OHLCV_SPEC[win];
  if (!spec) return out;
  const chain = tape.chain;
  const deadlineAt = Date.now() + boundedTimeout(timeoutMs);
  const settled = await Promise.allSettled(pools.map((p) => {
    const left = remainingMs(deadlineAt);
    if (!left) return Promise.reject(new Error('DEADLINE'));
    return withCache(`sm:ohlcv:${chain}:${String(p.address).toLowerCase()}:${spec.timeframe}:${spec.limit}`, OHLCV_TTL_MS,
      () => gtOhlcvVolume(chain, p.address, spec, { timeoutMs: left })).then((r) => r.value);
  }));
  let sum = 0;
  let got = false;
  for (const s of settled) {
    if (s.status === 'fulfilled' && s.value?.volumeUsd != null) { sum += s.value.volumeUsd; got = true; }
  }
  if (got) {
    out.volumeUsd = sum;
    out.source = 'ohlcv-candles';
    return out;
  }

  /* Candles unavailable. The largest span the pool attributes DO carry is
     reported as-is with its true window — the UI labels it — rather than
     being multiplied into a fabricated 4h/7d figure. */
  const fallbackKey = win === '4h' ? 'h6' : 'h24';
  const vols = pools.map((p) => p.volume?.[fallbackKey]).filter((v) => v != null);
  if (vols.length) {
    out.volumeUsd = vols.reduce((a, b) => a + b, 0);
    out.windowUsed = fallbackKey === 'h6' ? '6h' : '24h';
    out.source = 'pool-window-nearest';
    const buys = pools.map((p) => p.txns?.[fallbackKey]?.buys).filter((v) => v != null);
    const sells = pools.map((p) => p.txns?.[fallbackKey]?.sells).filter((v) => v != null);
    if (buys.length && sells.length) {
      out.buys = buys.reduce((a, b) => a + b, 0);
      out.sells = sells.reduce((a, b) => a + b, 0);
    }
  }
  return out;
}

/* ══════════════════════════ the signals ═══════════════════════════════ */

function topBy(rows, n = 8) {
  return rows.slice(0, n).map((r) => ({ address: r.wallet, short: shortAddr(r.wallet), usd: Math.round(r.usd), trades: r.trades }));
}

/**
 * Turn the tape into the windowed card numbers.
 *
 * Two independent measurements are combined, and the response says which one
 * produced each number (`basis`), because they are not equally strong:
 *
 *   · `trades`  — every number comes from individual trades inside the
 *                 window. Exact USD per side, exact wallets, exact top
 *                 buyers/sellers.
 *   · `counts`  — the trade page did not reach back to the window start. The
 *                 WINDOW VOLUME and the buy/sell COUNTS are still real
 *                 (pool attributes / candles), so the side split is derived
 *                 from the real transaction counts and flagged
 *                 `estimated: true`. The UI prints that flag.
 *   · `none`    — nothing was measured: every field is null.
 *
 * Nothing here is a zero-filled default: `0` only ever means "measured zero".
 */
export function summariseTape(tape, windowKey, stats, { now = Date.now() } = {}) {
  const win = WINDOW_KEYS[windowKey] ? windowKey : '24h';
  const span = WINDOW_KEYS[win] || WINDOWS.H24;
  const cutoff = now - span;
  const all = Array.isArray(tape?.trades) ? tape.trades : [];
  const inWindow = all.filter((t) => t.at && t.at >= cutoff && t.usd > 0);

  const byWalletBuy = new Map();
  const byWalletSell = new Map();
  let buyUsd = 0;
  let sellUsd = 0;
  for (const t of inWindow) {
    if (t.side === 'BUY') {
      buyUsd += t.usd;
      if (t.wallet) byWalletBuy.set(t.wallet, (byWalletBuy.get(t.wallet) || 0) + t.usd);
    } else if (t.side === 'SELL') {
      sellUsd += t.usd;
      if (t.wallet) byWalletSell.set(t.wallet, (byWalletSell.get(t.wallet) || 0) + t.usd);
    }
  }
  const walletCount = new Set(inWindow.map((t) => t.wallet).filter(Boolean)).size;
  const oldest = inWindow.length ? Math.min(...inWindow.map((t) => t.at)) : null;
  /*
   * COVERAGE — the distinction that keeps a quiet token from being labelled
   * «partial».
   *
   * The trade page is "latest N". If the source returned FEWER than a full
   * page, we hold every trade the source has for this contract, so the
   * window is fully observed even when the newest trade is two hours old:
   * an hour without trades is a measured zero, not missing data.
   *
   * If the page came back FULL (or the explorer says there are more pages),
   * the tape may have stopped mid-window. Then coverage is the distance from
   * its oldest row to now — and the card prints that percentage instead of
   * letting a 20-minute sample describe a 7-day window.
   */
  const oldestAny = all.length ? Math.min(...all.map((t) => t.at)) : null;
  const capped = !!tape?.truncated;
  const reachesCutoff = oldestAny != null && oldestAny <= cutoff;
  const complete = !capped || reachesCutoff || all.length === 0;
  /* No tape at all is NOT «100% covered» — it is unmeasured, and the card says
     so by printing nothing rather than a percentage. */
  let coveredPct = all.length === 0 && tape?.status === 'unavailable' ? null : 100;
  if (!complete) {
    const from = oldestAny ?? now;
    coveredPct = Math.max(1, Math.round(Math.min(1, (now - from) / span) * 100));
  }

  const poolVolume = stats?.volumeUsd != null ? Math.round(stats.volumeUsd) : null;
  const buys = stats?.buys != null ? stats.buys : null;
  const sells = stats?.sells != null ? stats.sells : null;
  const countTotal = (buys ?? 0) + (sells ?? 0);

  const base = {
    schema: 'fbt.smart-money-tokensignals.v2',
    window: win,
    windowMs: span,
    at: now,
    /* The window the upstream aggregate actually covers when it is not the
       requested one (e.g. 6h shown for a 4h request) — null when exact. */
    volumeWindow: stats?.windowUsed && stats.windowUsed !== win ? stats.windowUsed : (poolVolume != null ? win : null),
    volumeUsd: poolVolume,
    buys,
    sells,
    sampled: {
      trades: inWindow.length,
      wallets: walletCount,
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
    topBuyers: [],
    topSellers: [],
    smartWallets: null,
    accumulation: null,
    distribution: null,
    estimated: false,
    basis: 'none',
    priceUsd: tape?.pools?.[0]?.priceUsd ?? null
  };

  /* ── A. exact: the tape covers the window ───────────────────────────── */
  if (inWindow.length >= 1 && complete) {
    const buyers = [...byWalletBuy.entries()].map(([wallet, usd]) => ({ wallet, usd, trades: inWindow.filter((t) => t.wallet === wallet).length }))
      .sort((a, b) => b.usd - a.usd);
    const sellers = [...byWalletSell.entries()].map(([wallet, usd]) => ({ wallet, usd, trades: inWindow.filter((t) => t.wallet === wallet).length }))
      .sort((a, b) => b.usd - a.usd);
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
      wallets: walletCount,
      smartWallets: walletCount,
      topBuyers: topBy(buyers),
      topSellers: topBy(sellers),
      ...detectors({ buyUsd, sellUsd, buyers: byWalletBuy.size, sellers: byWalletSell.size, net, trades: inWindow.length })
    };
  }

  /* ── B. sample exists but does not cover the window ─────────────────── */
  if (inWindow.length >= 1) {
    const net = buyUsd - sellUsd;
    const buyers = [...byWalletBuy.entries()].map(([wallet, usd]) => ({ wallet, usd })).sort((a, b) => b.usd - a.usd);
    const sellers = [...byWalletSell.entries()].map(([wallet, usd]) => ({ wallet, usd })).sort((a, b) => b.usd - a.usd);
    const out = {
      ...base,
      dataStatus: 'live',
      /* These totals are exact for the span the sample covers, but that span
         is shorter than the requested window — so they are NOT "estimated"
         (no number is derived), they are PARTIAL. `estimated` stays false and
         the card prints the coverage percentage instead; the window volume
         travels separately in `volumeUsd`. */
      basis: 'trades-sample',
      estimated: false,
      partial: true,
      buyUsd: Math.round(buyUsd),
      sellUsd: Math.round(sellUsd),
      netUsd: Math.round(net),
      trades: inWindow.length,
      wallets: walletCount,
      smartWallets: walletCount,
      topBuyers: topBy(buyers),
      topSellers: topBy(sellers),
      ...detectors({ buyUsd, sellUsd, buyers: byWalletBuy.size, sellers: byWalletSell.size, net, trades: inWindow.length })
    };
    return out;
  }

  /* ── C. no trades in the tape, but the pool reported the window ─────── */
  if (countTotal > 0) {
    const share = buys / countTotal;
    const buyLeg = poolVolume != null ? poolVolume * share : null;
    const sellLeg = poolVolume != null ? poolVolume * (1 - share) : null;
    return {
      ...base,
      dataStatus: 'live',
      basis: 'counts',
      estimated: true,
      buyUsd: buyLeg != null ? Math.round(buyLeg) : null,
      sellUsd: sellLeg != null ? Math.round(sellLeg) : null,
      netUsd: buyLeg != null && sellLeg != null ? Math.round(buyLeg - sellLeg) : null,
      trades: countTotal,
      wallets: null,
      smartWallets: null,
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
    wallets: null
  };
}

/**
 * Accumulation / distribution from REAL trade evidence.
 *
 * `netBuying` is the USD imbalance of the observed trades; `breadth` is how
 * one-sided the participating wallets are. `smartMoneyBuying` is filled by
 * the caller when the whale/labelled layer recognises a smart wallet on the
 * same side — it is deliberately NOT inferred from size alone here.
 *
 * `null` rather than a 0-confidence object when there is no evidence: the UI
 * prints «—» instead of a 0% meter that reads as "measured distribution".
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

/** Full read: tape + window stats + summary. This is what the route calls. */
export async function tokenTradeSignals(chainId, tokenAddress, windowKey = '24h', { timeoutMs = READ_DEADLINE_MS, now = Date.now() } = {}) {
  const tape = await tokenTape(chainId, tokenAddress, { timeoutMs });
  const stats = await poolWindowStats(tape, windowKey, { timeoutMs });
  return summariseTape(tape, windowKey, stats, { now });
}

export { shapeGtTrade, shapeGtPool, tapeFromTransfers, dedupeTrades };
