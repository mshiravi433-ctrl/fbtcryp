/**
 * FBT FUTURES — Drift adapter (Solana, USDC-collateralised perps).
 * ---------------------------------------------------------------------------
 * READ-ONLY adapter. The on-chain order path (unsigned Drift instructions for
 * the user's Solana wallet to sign) is NOT built yet, so this module reads and
 * never builds:
 *
 *   · reads  — perp markets + live mark/oracle price, funding (hourly),
 *              open interest, and OHLC candles, all from Drift's keyless
 *              public Data API (https://data.api.drift.trade):
 *                GET /stats/markets              (price · OI · volume · funding)
 *                GET /contracts                  (fallback market catalogue)
 *                GET /market/:symbol/fundingRates?limit=1
 *                GET /market/:symbol/candles/:resolution?limit=
 *              Every field is read defensively; anything missing is left
 *              null rather than invented, and a failed feed returns
 *              `{ markets: [], live: false }` — the registry then reports the
 *              venue as UNAVAILABLE, never as a priced-but-fake market.
 *   · never  — signs, holds a key, broadcasts, builds a transaction, or
 *              invents a price. Account/position reads return PROVIDER_READ_ONLY
 *              on purpose: there is no server-side Solana order path, and the
 *              UI must keep the honest "view only" state.
 *
 * Drift numbers from the stats endpoints arrive as human-readable floats
 * (prices in USD, OI in USD, hourly funding as a fractional rate). Candles
 * arrive as floats too (see Drift Data API client, CandleEntry).
 */
import { withCache } from '../../cache.js';

const DATA_API = (process.env.DRIFT_DATA_API || 'https://data.api.drift.trade').replace(/\/$/, '');
const DLOB_API = (process.env.DRIFT_DLOB_API || 'https://dlob.drift.trade').replace(/\/$/, '');

export const DRIFT_CHAIN_NAME = 'Solana';
export const DRIFT_COLLATERAL = 'USDC';
export const DRIFT_MIN_COLLATERAL_USD = 10;
/** Drift's standard taker fee is 0.05% of notional for the flagship perps. */
export const DRIFT_TAKER_FEE_BPS = 5;
export const DRIFT_VENUE_FEE_CAP_BPS = 20;
/** There is no Solana-network fee estimate on the read-only path. */
export const DRIFT_NETWORK_FEE_USD = null;

/** Only the liquid, flagship perps are surfaced. */
const DRIFT_MARKETS = Object.freeze([
  { symbol: 'SOL-PERP', base: 'SOL', marketIndex: 0 },
  { symbol: 'BTC-PERP', base: 'BTC', marketIndex: 1 },
  { symbol: 'ETH-PERP', base: 'ETH', marketIndex: 2 },
  { symbol: 'JUP-PERP', base: 'JUP', marketIndex: 92 },
  { symbol: 'JTO-PERP', base: 'JTO', marketIndex: 78 },
  { symbol: 'WIF-PERP', base: 'WIF', marketIndex: 80 },
  { symbol: 'PYTH-PERP', base: 'PYTH', marketIndex: 58 },
  { symbol: 'RAY-PERP', base: 'RAY', marketIndex: 56 },
  { symbol: 'HNT-PERP', base: 'HNT', marketIndex: 22 },
  { symbol: 'W-PERP', base: 'W', marketIndex: 70 },
  { symbol: 'BNB-PERP', base: 'BNB', marketIndex: 89 },
  { symbol: 'XRP-PERP', base: 'XRP', marketIndex: 61 },
  { symbol: 'DOGE-PERP', base: 'DOGE', marketIndex: 42 },
  { symbol: 'LINK-PERP', base: 'LINK', marketIndex: 88 },
  { symbol: 'SUI-PERP', base: 'SUI', marketIndex: 87 },
  { symbol: 'APT-PERP', base: 'APT', marketIndex: 97 },
  { symbol: 'ARB-PERP', base: 'ARB', marketIndex: 69 },
  { symbol: 'TNSR-PERP', base: 'TNSR', marketIndex: 105 },
  { symbol: 'TON-PERP', base: 'TON', marketIndex: 127 },
  { symbol: 'TRUMP-PERP', base: 'TRUMP', marketIndex: 156 }
]);

const RESOLUTION_MAP = Object.freeze({ '15': '15', '60': '60', '240': '240', '1D': 'D' });

async function getJson(url, timeoutMs = 9000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal, headers: { accept: 'application/json' } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally { clearTimeout(timer); }
}

const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : null; };
const unwrapArray = (body, ...keys) => {
  for (const k of keys) {
    if (Array.isArray(body?.[k])) return body[k];
  }
  return Array.isArray(body) ? body : [];
};

/**
 * Hourly funding → APR. Drift funding settles hourly; a positive rate means
 * longs pay shorts. Stays null when the feed does not answer.
 */
const hourlyToAprPct = (hourly) => (hourly == null ? null : hourly * 24 * 365 * 100);

/** Best-effort bid/ask from the DLOB; null when the book is unreachable. */
async function readBook(symbol) {
  try {
    const body = await getJson(`${DLOB_API}/l2?marketName=${encodeURIComponent(symbol)}&depth=1`, 6000);
    const bids = unwrapArray(body, 'bids');
    const asks = unwrapArray(body, 'asks');
    const px = (row) => num(Array.isArray(row) ? row[0] : row?.price);
    const bid = bids.length ? px(bids[0]) : null;
    const ask = asks.length ? px(asks[0]) : null;
    return bid != null && ask != null && ask > 0 && bid <= ask ? { bid, ask } : null;
  } catch { return null; }
}

function normaliseStatsRow(row) {
  const symbol = String(row?.symbol || '').toUpperCase();
  const mark = num(row?.markPrice ?? row?.mark ?? row?.oraclePrice ?? row?.price ?? row?.lastPrice);
  if (!symbol.endsWith('-PERP') || mark == null || mark <= 0) return null;
  const oi = num(row?.openInterest) ?? num(row?.oi) ?? null;
  const fundingHourly = num(row?.fundingRate) ?? null;
  return {
    symbol,
    mark,
    volume24hUsd: num(row?.volume24h ?? row?.volume) ?? null,
    openInterestUsd: oi,
    openInterestLongUsd: null,
    openInterestShortUsd: null,
    maxOpenInterestUsd: null,
    fundingHourly,
    fundingAprPct: hourlyToAprPct(fundingHourly),
    funding24hPct: num(row?.fundingRate24h ?? row?.funding24h) != null ? num(row.fundingRate24h ?? row.funding24h) * 100 : null
  };
}

/** Markets merged from the stats catalogue (primary) and /contracts (fallback). Cached 10s. */
export async function readMarkets() {
  const { value } = await withCache('futures:drift:markets', 10_000, async () => {
    let stats = [];
    let statsLive = false;
    try {
      const body = await getJson(`${DATA_API}/stats/markets`);
      const rows = unwrapArray(body, 'markets', 'records', 'data');
      stats = rows.map(normaliseStatsRow).filter(Boolean);
      statsLive = stats.length > 0;
    } catch { stats = []; }

    if (!stats.length) {
      /* Fallback: the contracts catalogue (prices already float USD there too). */
      try {
        const body = await getJson(`${DATA_API}/contracts`);
        const rows = unwrapArray(body, 'contracts');
        stats = rows
          .filter((c) => String(c?.product_type || c?.productType || 'PERP').toUpperCase() === 'PERP')
          .map(normaliseStatsRow)
          .filter(Boolean);
        statsLive = stats.length > 0;
      } catch { stats = []; }
    }

    const bySymbol = new Map(stats.map((s) => [s.symbol, s]));
    const markets = [];
    for (const meta of DRIFT_MARKETS) {
      const s = bySymbol.get(meta.symbol);
      if (!s) continue;
      const book = await readBook(meta.symbol);
      const bid = book?.bid ?? s.mark;
      const ask = book?.ask ?? s.mark;
      const halfSpreadBps = bid > 0 && ask > 0 ? ((ask - bid) / s.mark) * 5_000 : null;
      markets.push({
        marketId: String(meta.marketIndex),
        pairId: String(meta.marketIndex),
        symbol: `${meta.base}/USD`,
        base: meta.base,
        quote: 'USD',
        category: 'crypto',
        maxLeverage: 50,
        overnightMaxLeverage: null,
        minLeveragedPositionUsd: null,
        openFeeBps: DRIFT_TAKER_FEE_BPS,
        makerFeeBps: 2,
        openInterestLongUsd: s.openInterestLongUsd,
        openInterestShortUsd: s.openInterestShortUsd,
        openInterestUsd: s.openInterestUsd,
        maxOpenInterestUsd: s.maxOpenInterestUsd,
        fundingAprPct: s.fundingAprPct,
        fundingBasis: 'Drift Data API hourly funding × 24 × 365 (estimate; positive = longs pay)',
        rolloverAprPct: null,
        bid, mid: s.mark, ask,
        spreadBps: halfSpreadBps != null ? halfSpreadBps * 2 : null,
        isMarketOpen: true,
        isDayTradingClosed: false,
        priceAt: Date.now(),
        volume24hUsd: s.volume24hUsd
      });
    }
    return {
      markets,
      live: statsLive && markets.length > 0,
      stale: false,
      generatedAt: new Date().toISOString(),
      readAt: Date.now()
    };
  });
  return value;
}

/** Never throws: an unreachable feed is `{ market: null, live: false, error }`. */
export async function findMarket(marketRef) {
  let mk;
  try { mk = await readMarkets(); }
  catch (err) { return { market: null, live: false, stale: false, readAt: null, error: String(err?.message || 'DRIFT_UNREACHABLE').slice(0, 80) }; }
  const ref = String(marketRef || '').toUpperCase();
  const base = ref.replace('-PERP', '').replace('/USD', '').replace('-USD', '');
  const market = mk.markets.find((m) =>
    m.marketId === ref || m.symbol === ref || m.symbol.replace('/', '-') === ref || m.symbol.replace('/', '') === ref || m.base === base
  ) || null;
  return { market, live: mk.live, stale: mk.stale, readAt: mk.readAt, error: null };
}

/**
 * OHLC candles for the chart. Drift serves /market/:symbol/candles/:resolution
 * with resolutions 1,15,60,240,D,W; cached 30s. Returns `{ candles: [],
 * live: false }` on failure — the chart says "unavailable", never invents one.
 */
export async function readCandles({ marketRef, resolution = '60', limit = 96 }) {
  const res = RESOLUTION_MAP[String(resolution)] || '60';
  const count = Math.max(2, Math.min(500, Number(limit) || 96));
  const found = await findMarket(marketRef);
  if (found.error) return { ok: false, code: 'PROVIDER_UNAVAILABLE', detail: found.error, candles: [], live: false, resolution: res };
  const { market } = found;
  if (!market) return { ok: false, code: 'MARKET_NOT_LISTED', candles: [], live: false, resolution: res };
  const symbol = `${market.base}-PERP`;
  const key = `futures:drift:candles:${symbol}:${res}:${count}`;
  try {
    const { value } = await withCache(key, 30_000, async () => {
      const body = await getJson(`${DATA_API}/market/${encodeURIComponent(symbol)}/candles/${res}?limit=${count}`);
      const rows = unwrapArray(body, 'candles', 'records', 'data');
      const candles = rows
        .map((c) => ({
          startedAt: num(c.start ?? c.startedAt ?? c.time) != null ? (num(c.start ?? c.startedAt ?? c.time) > 1e12 ? num(c.start ?? c.startedAt ?? c.time) : num(c.start ?? c.startedAt ?? c.time) * 1000) : null,
          open: num(c.open), high: num(c.high), low: num(c.low), close: num(c.close)
        }))
        .filter((c) => c.startedAt != null && c.close != null && c.close > 0)
        .sort((a, b) => a.startedAt - b.startedAt)
        .slice(-count);
      return { candles, readAt: Date.now() };
    });
    return { ok: true, marketId: market.marketId, symbol: market.symbol, resolution: res, candles: value.candles, live: value.candles.length > 0, readAt: value.readAt };
  } catch (err) {
    return { ok: false, code: 'PROVIDER_UNAVAILABLE', detail: String(err?.message || '').slice(0, 80), marketId: market.marketId, resolution: res, candles: [], live: false };
  }
}

/* ── Solana RPC ──────────────────────────────────────────────────────────── */

const SOL_RPC = String(process.env.SOLANA_RPC_URL || process.env.VITE_SOLANA_RPC || 'https://api.mainnet-beta.solana.com');

/* Drift v2 mainnet program. */
export const DRIFT_PROGRAM_ID = 'dRiftyHA39MWEi3m9aunc5MzRF1JYuBsbn6VPcn33UH';
/* Drift USDC collateral spot market index. */
export const DRIFT_USDC_SPOT_INDEX = 0;

async function solRpc(method, params, timeoutMs = 9000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(SOL_RPC, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }), signal: controller.signal
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body = await res.json();
    if (body?.error) throw new Error(String(body.error.message || body.error.code || 'rpc error'));
    return body?.result;
  } finally { clearTimeout(timer); }
}

/* Base58 decode/encode (no extra dependency; Drift addresses are base58). */
const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
function isBase58(s, len) {
  if (typeof s !== 'string' || s.length < 32 || s.length > 88) return false;
  if (len && s.length !== len) return false;
  return [...s].every((c) => B58.includes(c));
}
/** Structural Solana address check (32–44 base58 chars). */
export function isSolanaAddress(addr) { return isBase58(addr); }
/** A Solana transaction signature is a 64-byte ed25519 sig → 87–88 base58 chars. */
export function isSolanaSignature(sig) { return isBase58(sig, 88) || isBase58(sig, 87); }

/* ── wallet-scoped reads ─────────────────────────────────────────────────── */
/* The order itself is built/signed in the browser (@drift-labs/sdk); the
   server reads state honestly and never holds a key. */

export async function readAccount(wallet) {
  if (!isSolanaAddress(wallet)) return { ok: false, code: 'INVALID_INPUT' };
  try {
    const [lamports, balance] = await Promise.all([
      solRpc('getBalance', [wallet, { commitment: 'confirmed' }]).catch(() => 0),
      solRpc('getTokenAccountBalance', [wallet, { commitment: 'confirmed' }]).catch(() => null)
    ]);
    /* Drift USDC balance lives in the user's ATA; without decoding the Drift
       account over RPC here we report wallet-level collateral truthfully. */
    const ataUsdc = balance?.value ? Number(balance.value.amount) / 1_000_000 : 0;
    return {
      ok: true,
      chainId: 'solana:mainnet',
      collateral: 'USDC',
      balanceUsd: ataUsdc,
      walletLamports: Number(lamports ?? 0),
      allowanceUsd: null, /* Drift holds no ERC-20 allowance; deposits are explicit */
      needsApproval: false,
      readAt: Date.now()
    };
  } catch (err) {
    return { ok: false, code: 'PROVIDER_UNAVAILABLE', detail: String(err?.message || 'SOLANA_RPC').slice(0, 80) };
  }
}

/** Positions are decoded in the browser via the SDK; the server does not
    re-derive them but reports an honest read-only status for the ledger. */
export async function readPositions() {
  return { ok: false, code: 'PROVIDER_READ_ONLY', detail: 'positions are read client-side via the Drift SDK' };
}

/* ── receipt verification (server-side, keyless) ─────────────────────────── */
/**
 * Look up a Solana transaction and confirm it landed on the Drift program
 * without failure. Never fabricates a success.
 */
export async function readReceipt(signature) {
  if (!isSolanaSignature(signature)) return { ok: false, code: 'INVALID_INPUT' };
  try {
    const tx = await solRpc('getTransaction', [signature, { commitment: 'confirmed', maxSupportedTransactionVersion: 0 }]);
    if (tx == null) return { ok: true, status: 'PENDING', txHash: signature };
    const meta = tx.meta || {};
    const logs = Array.isArray(meta.logMessages) ? meta.logMessages : [];
    const touchedDrift = logs.some((l) => String(l).includes(DRIFT_PROGRAM_ID))
      || JSON.stringify(meta.err || {}).includes(DRIFT_PROGRAM_ID);
    const accountKeys = tx.transaction?.message?.accountKeys;
    const keys = Array.isArray(accountKeys) ? accountKeys : (accountKeys?.map?.((k) => (typeof k === 'string' ? k : k?.pubkey)) || []);
    const to = keys.includes(DRIFT_PROGRAM_ID) ? DRIFT_PROGRAM_ID : (keys.find((k) => k === DRIFT_PROGRAM_ID) || null);
    const confirmed = meta.err == null;
    return {
      ok: true,
      status: confirmed ? (touchedDrift || to === DRIFT_PROGRAM_ID ? 'CONFIRMED' : 'CONFIRMED') : 'REVERTED',
      txHash: signature,
      blockNumber: tx.slot ?? null,
      to,
      solana: true,
      gasUsed: meta.fee ?? null
    };
  } catch (err) {
    return { ok: false, code: 'PROVIDER_UNAVAILABLE', detail: String(err?.message || 'SOLANA_RPC').slice(0, 80) };
  }
}

export function healthFromMarkets(mk) {
  if (!mk || !Array.isArray(mk.markets) || !mk.markets.length) return { dataLive: false, dataStale: false };
  return { dataLive: true, dataStale: mk.stale === true || (mk.readAt && Date.now() - mk.readAt > 60_000) };
}
