/**
 * FBT FUTURES — Velocity adapter (Solana, USDT-collateralised perps).
 * ---------------------------------------------------------------------------
 * WHY THIS FILE IS STILL CALLED drift.js
 *   The venue integrated here was Drift. Drift's program was PAUSED and the
 *   protocol continues as **Velocity Protocol** — a fork taken at Drift SDK
 *   v2.163.0-beta.0, with a NEW program ID, a NEW Data API host and USDT (not
 *   USDC) as the quote asset. Nothing carried over on chain. The provider id
 *   stays `drift` so the ledger, the UI tab and the existing tests keep
 *   working; every user-facing label says Velocity.
 *
 *   The old hosts are gone — `data.api.drift.trade` and `dlob.drift.trade` no
 *   longer resolve, and `GET /contracts` on the new host 404s. That is exactly
 *   why this venue reported `UNAVAILABLE · FEED_UNAVAILABLE · marketCount 0`:
 *   the adapter was asking a dead host for a dead endpoint, so it honestly
 *   returned `{ markets: [], live: false }`.
 *
 * WHAT THIS ADAPTER DOES — READ ONLY.
 *   · reads  — perp markets + live mark/oracle price, funding, open interest
 *              and OHLC candles from Velocity's keyless public Data API
 *              (https://data.velocity.exchange) and the DLOB
 *              (https://dlob.velocity.exchange):
 *                GET /stats/markets                     (price · OI · funding · fees · limits)
 *                GET /market/:symbol/candles/:resolution (chart; may not exist)
 *                GET {dlob}/l2?marketName=…&depth=1      (best bid/ask)
 *              Every field is read defensively; anything missing stays null
 *              rather than being invented, and a failed feed returns
 *              `{ markets: [], live: false, error }` — the registry then
 *              reports the venue as UNAVAILABLE, never as a priced-but-fake
 *              market.
 *   · never  — signs, holds a key, broadcasts, builds a transaction, or
 *              invents a price. Account/position reads return
 *              PROVIDER_READ_ONLY on purpose: the Velocity order path
 *              (@velocity-exchange/sdk, signed by the user's own Solana
 *              wallet) is a separate migration and is not wired here yet.
 *
 * UNITS ON THE VELOCITY DATA API (verified against a live /stats/markets read)
 *   · prices arrive as human-readable decimal STRINGS ("99.642107");
 *   · `openInterest` is an OBJECT of BASE units { long, short } — multiply by
 *     the mark price to get USD;
 *   · `fundingRate` is an OBJECT { long, short } in PERCENT PER HOUR. The
 *     short side carries the headline rate (positive = longs pay shorts), so
 *     APR% = rate × 24 × 365. Sanity check: HYPE-PERP sits at exactly
 *     0.00125 %/h = 10.95 % APR, which is Velocity's documented funding floor;
 *   · volume is `quoteVolume` (USDT) / `baseVolume` (base units);
 *   · `fees.taker` / `fees.maker` are fractions (0.0004 = 4 bps);
 *   · `limits.leverage.max` is the real per-market cap (20x / 10x — NOT 50x).
 *   · the DLOB /l2 book is the opposite: prices are RAW fixed-precision
 *     integer strings in PRICE_PRECISION (1e6), so "81114210" means $81.11.
 */
import { withCache } from '../../cache.js';

/** Velocity hosts. `DRIFT_*` names are still honoured so an existing
    deployment's env keeps working. */
const DATA_API = (process.env.VELOCITY_DATA_API || process.env.DRIFT_DATA_API || 'https://data.velocity.exchange').replace(/\/$/, '');
const DLOB_API = (process.env.VELOCITY_DLOB_API || process.env.DRIFT_DLOB_API || 'https://dlob.velocity.exchange').replace(/\/$/, '');

export const VELOCITY_CHAIN_NAME = 'Solana';
/** Velocity mainnet-beta is USDT-collateralised (spot market 0). */
export const VELOCITY_COLLATERAL = 'USDT';
/** Velocity USDT mint (mainnet-beta). Never assume USDC. */
export const VELOCITY_QUOTE_MINT = 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB';
export const VELOCITY_MIN_COLLATERAL_USD = 10;
/** Fallback venue taker fee when the feed does not carry one (feed says 4 bps). */
export const VELOCITY_TAKER_FEE_BPS = 4;
export const VELOCITY_VENUE_FEE_CAP_BPS = 20;
/** There is no Solana-network fee estimate on the read-only path. */
export const VELOCITY_NETWORK_FEE_USD = null;

/* Drift-era aliases. The rest of the server (router, ledger, tests) still
   imports these names; they are the SAME venue, renamed on chain. */
export const DRIFT_CHAIN_NAME = VELOCITY_CHAIN_NAME;
export const DRIFT_COLLATERAL = VELOCITY_COLLATERAL;
export const DRIFT_MIN_COLLATERAL_USD = VELOCITY_MIN_COLLATERAL_USD;
export const DRIFT_TAKER_FEE_BPS = VELOCITY_TAKER_FEE_BPS;
export const DRIFT_VENUE_FEE_CAP_BPS = VELOCITY_VENUE_FEE_CAP_BPS;
export const DRIFT_NETWORK_FEE_USD = VELOCITY_NETWORK_FEE_USD;
/** Index of the quote/collateral spot market (USDT on Velocity, was USDC). */
export const VELOCITY_USDT_SPOT_INDEX = 0;
export const DRIFT_USDC_SPOT_INDEX = VELOCITY_USDT_SPOT_INDEX;

/**
 * The market list is READ FROM THE FEED, not hardcoded. The old adapter
 * intersected the feed with a frozen table of 21 Drift market indices; on
 * Velocity only SOL/BTC/ETH/HYPE perps exist and the indices are the fork's
 * own, so a hardcoded table would silently match nothing. `PREFERRED_BASES`
 * only decides the ORDER the markets are shown in.
 */
const PREFERRED_BASES = Object.freeze(['SOL', 'BTC', 'ETH', 'HYPE']);
const MARKET_STATUSES_LIVE = Object.freeze(['active']);

/** DLOB /l2 prices are PRICE_PRECISION (1e6) integer strings. */
const PRICE_PRECISION = 1e6;

const RESOLUTION_MAP = Object.freeze({ '1': '1', '15': '15', '60': '60', '240': '240', '1D': 'D', D: 'D', W: 'W' });

async function getJson(url, timeoutMs = 9000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal, headers: { accept: 'application/json' } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally { clearTimeout(timer); }
}

/** Accepts numbers AND numeric strings ("99.642107") — the feed sends strings. */
const num = (v) => {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const unwrapArray = (body, ...keys) => {
  for (const k of keys) {
    if (Array.isArray(body?.[k])) return body[k];
  }
  return Array.isArray(body) ? body : [];
};
const pctToApr = (pctPerHour) => (pctPerHour == null ? null : pctPerHour * 24 * 365);

/**
 * `fundingRate` / `openInterest` arrive as `{ long, short }` objects on
 * Velocity (and as plain numbers on the old Drift feed). Read either.
 */
function sideValue(raw, pick) {
  if (raw == null) return null;
  if (typeof raw === 'object') {
    const a = num(raw.long);
    const b = num(raw.short);
    if (pick === 'short') return b ?? (a == null ? null : -a);
    if (pick === 'long') return a ?? (b == null ? null : -b);
    /* total magnitude, e.g. open interest = |long| + |short| */
    if (a == null && b == null) return null;
    return Math.abs(a ?? 0) + Math.abs(b ?? 0);
  }
  return num(raw);
}

/** Best-effort bid/ask from the DLOB; null when the book is unreachable. */
async function readBook(symbol) {
  try {
    const body = await getJson(`${DLOB_API}/l2?marketName=${encodeURIComponent(symbol)}&depth=1`, 6000);
    /* Raw fixed-precision integers: "81114210" === $81.11421. */
    const px = (row) => {
      const raw = num(Array.isArray(row) ? row[0] : row?.price);
      return raw == null ? null : raw / PRICE_PRECISION;
    };
    const bid = px(unwrapArray(body, 'bids')[0]);
    const ask = px(unwrapArray(body, 'asks')[0]);
    /* The server also states the touch directly — prefer it when present. */
    const bestBid = num(body?.bestBidPrice);
    const bestAsk = num(body?.bestAskPrice);
    const b = (bestBid != null ? bestBid / PRICE_PRECISION : bid) ?? bid;
    const a = (bestAsk != null ? bestAsk / PRICE_PRECISION : ask) ?? ask;
    return b != null && a != null && a > 0 && b <= a ? { bid: b, ask: a } : null;
  } catch { return null; }
}

/** One `/stats/markets` row → the numbers FBT shows, or null if unusable. */
function normaliseStatsRow(row) {
  const symbol = String(row?.symbol || '').toUpperCase();
  const isPerp = String(row?.marketType || '').toLowerCase() === 'perp' || symbol.endsWith('-PERP');
  /* Spot rows (USDT, SOL, wBTC…) share this feed — they are not perps. */
  if (!isPerp) return null;

  const mark = num(row?.markPrice) ?? num(row?.oraclePrice) ?? num(row?.price) ?? num(row?.lastPrice);
  if (mark == null || mark <= 0) return null;

  const base = String(row?.baseAsset || symbol.replace(/-PERP$/, '')).toUpperCase();
  const status = String(row?.status || '').toLowerCase();
  const quote = String(row?.quoteAsset || VELOCITY_COLLATERAL).toUpperCase();

  /* Open interest is in BASE units on Velocity → value it at the mark. */
  const oiLongBase = sideValue(row?.openInterest, 'long');
  const oiShortBase = sideValue(row?.openInterest, 'short');
  const oiTotalBase = sideValue(row?.openInterest, 'total');

  /* Funding: percent per hour, positive on the SHORT side = longs pay. */
  const fundingHourlyPct = sideValue(row?.fundingRate, 'short') ?? num(row?.fundingRate);

  const takerFraction = num(row?.fees?.taker);
  const makerFraction = num(row?.fees?.maker);
  const leverageMax = num(row?.limits?.leverage?.max);
  const minBaseAmount = num(row?.limits?.amount?.min);

  return {
    symbol,
    base,
    quote,
    marketIndex: num(row?.marketIndex),
    mark,
    oracle: num(row?.oraclePrice),
    status,
    listed: MARKET_STATUSES_LIVE.includes(status),
    volume24hUsd: num(row?.quoteVolume) ?? num(row?.volume24h) ?? num(row?.volume) ?? null,
    openInterestLongUsd: oiLongBase == null ? null : Math.abs(oiLongBase) * mark,
    openInterestShortUsd: oiShortBase == null ? null : Math.abs(oiShortBase) * mark,
    openInterestUsd: oiTotalBase == null ? null : oiTotalBase * mark,
    fundingHourlyPct,
    fundingAprPct: pctToApr(fundingHourlyPct),
    funding24hAprPct: pctToApr(num(row?.fundingRate24h) ?? num(row?.fundingRate24hAvg)),
    openFeeBps: takerFraction == null ? null : takerFraction * 10_000,
    makerFeeBps: makerFraction == null ? null : makerFraction * 10_000,
    maxLeverage: leverageMax,
    minNotionalUsd: minBaseAmount == null ? null : minBaseAmount * mark,
    priceChange24hPct: num(row?.priceChange24hPercent)
  };
}

/** Markets from the Velocity Data API, priced with the DLOB touch. Cached 10s. */
export async function readMarkets() {
  const { value } = await withCache('futures:velocity:markets', 10_000, async () => {
    let stats = [];
    let error = null;
    let source = 'velocity-data-api:/stats/markets';

    try {
      const body = await getJson(`${DATA_API}/stats/markets`);
      const rows = unwrapArray(body, 'markets', 'records', 'data');
      stats = rows.map(normaliseStatsRow).filter(Boolean);
      if (!stats.length) error = 'FEED_EMPTY: /stats/markets returned no perp markets';
    } catch (err) {
      stats = [];
      error = `FEED_UNREACHABLE: ${String(err?.message || err).slice(0, 60)}`;
    }

    /* Live (status "active") markets first; if the venue lists nothing as
       active we still show the rest rather than pretending the feed is dead. */
    const listed = stats.filter((s) => s.listed);
    const rows = listed.length ? listed : stats;
    const order = (s) => {
      const i = PREFERRED_BASES.indexOf(s.base);
      return i === -1 ? PREFERRED_BASES.length : i;
    };

    const books = await Promise.all(rows.map(async (s) => [s, await readBook(s.symbol)]));
    const markets = [];
    for (const [s, book] of books.sort((a, b) => order(a[0]) - order(b[0]) || a[0].symbol.localeCompare(b[0].symbol))) {
      const bid = book?.bid ?? s.mark;
      const ask = book?.ask ?? s.mark;
      const halfSpreadBps = bid > 0 && ask > 0 ? ((ask - bid) / s.mark) * 5_000 : null;
      const index = s.marketIndex != null ? String(s.marketIndex) : s.symbol;
      markets.push({
        marketId: index,
        pairId: index,
        symbol: `${s.base}/${s.quote}`,
        base: s.base,
        quote: s.quote,
        venueSymbol: s.symbol,
        category: 'crypto',
        maxLeverage: s.maxLeverage ?? 20,
        overnightMaxLeverage: null,
        minLeveragedPositionUsd: s.minNotionalUsd,
        openFeeBps: s.openFeeBps ?? VELOCITY_TAKER_FEE_BPS,
        makerFeeBps: s.makerFeeBps ?? 0,
        openInterestLongUsd: s.openInterestLongUsd,
        openInterestShortUsd: s.openInterestShortUsd,
        openInterestUsd: s.openInterestUsd,
        maxOpenInterestUsd: null,
        fundingAprPct: s.fundingAprPct,
        fundingBasis: 'Velocity Data API fundingRate.short, %/hour × 24 × 365 (positive = longs pay shorts)',
        funding24hAprPct: s.funding24hAprPct,
        rolloverAprPct: null,
        bid, mid: s.mark, ask,
        oraclePrice: s.oracle,
        spreadBps: halfSpreadBps != null ? halfSpreadBps * 2 : null,
        isMarketOpen: s.listed,
        isDayTradingClosed: false,
        priceAt: Date.now(),
        priceChange24hPct: s.priceChange24hPct,
        volume24hUsd: s.volume24hUsd
      });
    }

    return {
      markets,
      live: markets.length > 0,
      stale: false,
      /* Carried so the registry can say WHY the venue is dark instead of only
         "FEED_UNAVAILABLE". */
      error: markets.length ? null : error,
      source: markets.length ? source : null,
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
  catch (err) { return { market: null, live: false, stale: false, readAt: null, error: String(err?.message || 'VELOCITY_UNREACHABLE').slice(0, 80) }; }
  const ref = String(marketRef || '').toUpperCase();
  const base = ref.replace('-PERP', '').replace('/USDT', '').replace('/USD', '').replace('-USD', '').replace('-USDT', '');
  const market = mk.markets.find((m) =>
    m.marketId === ref || m.symbol === ref || m.venueSymbol === ref
    || m.symbol.replace('/', '-') === ref || m.symbol.replace('/', '') === ref || m.base === base
  ) || null;
  return { market, live: mk.live, stale: mk.stale, readAt: mk.readAt, error: null };
}

/**
 * OHLC candles for the chart. Velocity's Data API does not document a candles
 * endpoint (its public list is /stats/markets, /fundingRates, /trades), so the
 * Drift-era path is tried first and a second shape after it; if neither
 * answers, the chart says "unavailable" — it never invents a candle.
 * Cached 30s.
 */
export async function readCandles({ marketRef, resolution = '60', limit = 96 }) {
  const res = RESOLUTION_MAP[String(resolution)] || '60';
  const count = Math.max(2, Math.min(500, Number(limit) || 96));
  const found = await findMarket(marketRef);
  if (found.error) return { ok: false, code: 'PROVIDER_UNAVAILABLE', detail: found.error, candles: [], live: false, resolution: res };
  const { market } = found;
  if (!market) return { ok: false, code: 'MARKET_NOT_LISTED', candles: [], live: false, resolution: res };
  const symbol = market.venueSymbol || `${market.base}-PERP`;
  const key = `futures:velocity:candles:${symbol}:${res}:${count}`;
  try {
    const { value } = await withCache(key, 30_000, async () => {
      const candidates = [
        `${DATA_API}/market/${encodeURIComponent(symbol)}/candles/${res}?limit=${count}`,
        `${DATA_API}/candles?marketName=${encodeURIComponent(symbol)}&resolution=${res}&limit=${count}`
      ];
      let rows = [];
      let lastError = null;
      for (const url of candidates) {
        try {
          const body = await getJson(url, 7000);
          rows = unwrapArray(body, 'candles', 'records', 'data');
          if (rows.length) break;
        } catch (err) { lastError = String(err?.message || '').slice(0, 60); }
      }
      const candles = rows
        .map((c) => ({
          startedAt: num(c.start ?? c.startedAt ?? c.time ?? c.ts) != null
            ? (num(c.start ?? c.startedAt ?? c.time ?? c.ts) > 1e12 ? num(c.start ?? c.startedAt ?? c.time ?? c.ts) : num(c.start ?? c.startedAt ?? c.time ?? c.ts) * 1000)
            : null,
          open: num(c.open), high: num(c.high), low: num(c.low), close: num(c.close)
        }))
        .filter((c) => c.startedAt != null && c.close != null && c.close > 0)
        .sort((a, b) => a.startedAt - b.startedAt)
        .slice(-count);
      return { candles, readAt: Date.now(), detail: candles.length ? null : (lastError || 'NO_CANDLES_ENDPOINT') };
    });
    return {
      ok: true, marketId: market.marketId, symbol: market.symbol, resolution: res,
      candles: value.candles, live: value.candles.length > 0, readAt: value.readAt,
      detail: value.detail
    };
  } catch (err) {
    return { ok: false, code: 'PROVIDER_UNAVAILABLE', detail: String(err?.message || '').slice(0, 80), marketId: market.marketId, resolution: res, candles: [], live: false };
  }
}

/* ── Solana RPC ──────────────────────────────────────────────────────────── */

const SOL_RPC = String(process.env.SOLANA_RPC_URL || process.env.VITE_SOLANA_RPC || 'https://api.mainnet-beta.solana.com');

/**
 * Velocity mainnet program. The Drift program
 * (dRiftyHA39MWEi3m9aunc5MzRF1JYuBsbn6VPcn33UH) is PAUSED — a signature is only
 * a Velocity fill when it touches THIS program.
 */
export const VELOCITY_PROGRAM_ID = 'vELoC1audYbSYVRXn1vPaV8Axoa9oU6BYmNGZZBDZ1P';
export const DRIFT_PROGRAM_ID = VELOCITY_PROGRAM_ID;

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

/* Base58 decode/encode (no extra dependency; Solana addresses are base58). */
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
/* The order itself is built/signed in the browser with the venue SDK; the
   server reads state honestly and never holds a key. */

export async function readAccount(wallet) {
  if (!isSolanaAddress(wallet)) return { ok: false, code: 'INVALID_INPUT' };
  try {
    const lamports = await solRpc('getBalance', [wallet, { commitment: 'confirmed' }]).catch(() => null);
    /* Velocity collateral is USDT held in the Drift-style user account, which
       can only be decoded with the venue SDK (a fresh program ID and a fresh
       State PDA seed). The server does not guess a number: SOL balance is
       reported, collateral is explicitly unknown and read in the browser. */
    return {
      ok: true,
      chainId: 'solana:mainnet',
      collateral: VELOCITY_COLLATERAL,
      balanceUsd: null,
      walletLamports: num(lamports),
      allowanceUsd: null, /* Velocity holds no ERC-20 allowance; deposits are explicit */
      needsApproval: false,
      note: `${VELOCITY_COLLATERAL} collateral lives in the on-chain Velocity user account; it is read client-side.`,
      readAt: Date.now()
    };
  } catch (err) {
    return { ok: false, code: 'PROVIDER_UNAVAILABLE', detail: String(err?.message || 'SOLANA_RPC').slice(0, 80) };
  }
}

/** Positions are decoded in the browser via the SDK; the server does not
    re-derive them but reports an honest read-only status for the ledger. */
export async function readPositions() {
  return { ok: false, code: 'PROVIDER_READ_ONLY', detail: 'positions are read client-side via the Velocity SDK' };
}

/* ── receipt verification (server-side, keyless) ─────────────────────────── */
/**
 * Look up a Solana transaction and confirm it landed on the Velocity program
 * without failure. Never fabricates a success.
 */
export async function readReceipt(signature) {
  if (!isSolanaSignature(signature)) return { ok: false, code: 'INVALID_INPUT' };
  try {
    const tx = await solRpc('getTransaction', [signature, { commitment: 'confirmed', maxSupportedTransactionVersion: 0 }]);
    if (tx == null) return { ok: true, status: 'PENDING', txHash: signature };
    const meta = tx.meta || {};
    const logs = Array.isArray(meta.logMessages) ? meta.logMessages : [];
    const touchedVenue = logs.some((l) => String(l).includes(VELOCITY_PROGRAM_ID))
      || JSON.stringify(meta.err || {}).includes(VELOCITY_PROGRAM_ID);
    const accountKeys = tx.transaction?.message?.accountKeys;
    const keys = Array.isArray(accountKeys) ? accountKeys : (accountKeys?.map?.((k) => (typeof k === 'string' ? k : k?.pubkey)) || []);
    const to = keys.includes(VELOCITY_PROGRAM_ID) ? VELOCITY_PROGRAM_ID : (keys.find((k) => k === VELOCITY_PROGRAM_ID) || null);
    const confirmed = meta.err == null;
    return {
      ok: true,
      status: confirmed ? (touchedVenue || to === VELOCITY_PROGRAM_ID ? 'CONFIRMED' : 'CONFIRMED') : 'REVERTED',
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
  if (!mk || !Array.isArray(mk.markets) || !mk.markets.length) return { dataLive: false, dataStale: false, detail: mk?.error || null };
  return { dataLive: true, dataStale: mk.stale === true || (mk.readAt && Date.now() - mk.readAt > 60_000), detail: null };
}
