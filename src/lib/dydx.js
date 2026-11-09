/**
 * dYdX CHAIN — wallet-derived, non-custodial order path with Builder Codes.
 *
 * The user's EVM wallet signs the official dYdX onboarding typed data. The
 * signature deterministically derives the dYdX Chain signing key in memory;
 * no mnemonic/private key is persisted or sent to our server. The protocol
 * client signs and broadcasts directly to a dYdX validator.
 *
 * SECURITY: v4-client-js is pinned EXACTLY to 3.4.0. Versions 3.4.1, 1.22.1,
 * 1.15.2 and 1.0.31 were compromised in the Jan 2026 npm supply-chain attack.
 * 3.4.0 is the preceding official GitHub release, its tarball was scanned for
 * the published IOC before being admitted, and package.json deliberately uses
 * no caret so an install can never float onto a poisoned/new release.
 */

export const DYDX_BUILDER_ADDRESS = 'dydx17493m25rh59j2sf2525r49htr2cva5rqnf76r7';
export const DYDX_BUILDER_FEE_PPM = 1000; // 10 bps = 1000 ppm (dYdX allows up to 10 000 ppm)
/* Kept for the server-side documentation and diagnostics; browser reads use
   the same-origin proxy below so the indexer never has to satisfy CORS. */
export const DYDX_INDEXER = 'https://indexer.dydx.trade';
import { apiBase } from './apiBase.js';
import { TPSL_GOOD_TIL_SECONDS } from './dydxTpsl.js';

/*
 * THE API ORIGIN IS NOT A CONSTANT ANY MORE.
 *
 * This used to read `import.meta.env?.VITE_API_BASE || '/api'`. That is the
 * exact expression lib/apiBase.js was written to replace, and it is wrong in
 * one place only — but the place that matters: inside the packaged Android
 * app the WebView serves the bundle from https://localhost, so a relative
 * '/api' resolves to the phone's OWN static asset server and every request
 * 404s. On the website the same expression is correct (same origin), which is
 * precisely why these modules looked fine and quietly died in the APK.
 *
 * apiBase() answers the question once: VITE_API_BASE when it is a usable
 * absolute origin, the canonical origin inside the native shell, '/api'
 * everywhere else.
 */
const API_BASE = apiBase();

let session = null;
let clientPromise = null;

const timeoutFetch = async (url, options = {}, timeout = 12000) => {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await fetch(url, { ...options, signal: ctrl.signal, headers: { accept: 'application/json', ...(options.headers || {}) } });
    if (!res.ok) throw new Error(`HTTP_${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
};

/** Bech32 shape guard; the official client performs the checksum validation. */
export const isDydxAddress = (value) => /^dydx1[02-9ac-hj-np-z]{38}$/.test(String(value || '').toLowerCase());

export function dydxFeeUsd(notional) {
  const n = Number(notional);
  if (!Number.isFinite(n) || n <= 0) return null;
  return (n * DYDX_BUILDER_FEE_PPM) / 1_000_000;
}

/**
 * The indexer's numbers, as numbers — and `null` when the field is absent.
 *
 * The difference matters more than it looks. The old map wrote
 * `Number(m.priceChange24H || 0)` and `Number(m.nextFundingRate || 0)`, so a
 * market whose row arrived without a funding rate printed **0.000%**, which on
 * a leveraged screen is not "unknown", it is a promise that holding the
 * position is free. Every optional field here is `null` when absent and the UI
 * shows «—». Only the fields a market cannot exist without are coerced.
 */
const num = (v) => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

const normaliseMarket = (m) => {
  /* Margin fractions, the pair the liquidation model reads. dYdX publishes
     them as decimal strings ("0.025" = 2.5%); they are the difference between
     an exact liquidation price and the 100%-loss bound we used to print. */
  const imf = num(m.initialMarginFraction);
  const mmf = num(m.maintenanceMarginFraction);
  return {
    ticker: m.ticker,
    status: m.status,
    oraclePrice: Number(m.oraclePrice),
    priceChange24H: num(m.priceChange24H),
    volume24H: num(m.volume24H),
    /** Real trades in the last 24h (the indexer's `trades24H`), not notional. */
    trades24H: num(m.trades24H),
    openInterest: num(m.openInterest),
    nextFundingRate: num(m.nextFundingRate),
    /** Epoch seconds after which the next funding payment lands. */
    nextFundingAt: m.nextFundingAt || null,
    nextFundingAtMs: m.nextFundingAt ? Date.parse(m.nextFundingAt) : null,
    initialMarginFraction: imf,
    maintenanceMarginFraction: mmf,
    /** 1 / IMF, floored — the venue's own leverage cap for this market. */
    maxLeverage: imf != null && imf > 0 ? Math.max(1, Math.floor(1 / imf)) : null,
    atomicResolution: Number(m.atomicResolution),
    quantumConversionExponent: Number(m.quantumConversionExponent),
    stepBaseQuantums: Number(m.stepBaseQuantums),
    subticksPerTick: Number(m.subticksPerTick),
    clobPairId: String(m.clobPairId),
    raw: m
  };
};

/** Public market metadata through our same-origin CORS proxy. */
export async function getDydxMarkets() {
  try {
    const body = await timeoutFetch(`${API_BASE}/dydx/markets`);
    const values = Array.isArray(body?.markets)
      ? body.markets
      : Object.values(body?.markets || {});
    const markets = values
      .map(normaliseMarket)
      .filter((m) => m.ticker && Number.isFinite(m.oraclePrice) && m.oraclePrice > 0);
    return { markets, live: markets.length > 0 };
  } catch {
    /*
     * ─── NO OFFLINE CATALOGUE ─────────────────────────────────────────────
     * Futures Engine v3 rule: no fabricated markets, prices or funding on a
     * leveraged screen, ever. An unreachable indexer is reported as exactly
     * that (`unavailable: true`, empty list) and the page shows its honest
     * "indexer unavailable — orders disabled" state instead of a demo list a
     * user could mistake for a market.
     */
    return { markets: [], live: false, unavailable: true };
  }
}

/**
 * Historical candles through the same proxy.
 *
 * Added because the dYdX screen asked someone to size a leveraged position
 * from a single oracle price and an open-interest number — the two least
 * informative figures on the page — with no view of how the market had moved.
 *
 * Returns `{ candles, live, resolution }` and NEVER throws: a chart that can
 * crash the page it decorates is worse than no chart. `live: false` plus an
 * empty array is the honest answer when the indexer is unreachable, and the
 * component says so instead of drawing a flat line at zero.
 */
export async function getDydxCandles(ticker, resolution = '1HOUR', limit = 96) {
  const safe = normaliseTicker(ticker);
  if (!safe) return { candles: [], live: false, ticker: null, resolution };
  try {
    const body = await timeoutFetch(
      `${API_BASE}/dydx/candles?ticker=${encodeURIComponent(safe)}&resolution=${encodeURIComponent(resolution)}&limit=${Number(limit) || 96}`
    );
    const candles = Array.isArray(body?.candles) ? body.candles : [];
    return {
      candles,
      live: candles.length > 1,
      ticker: safe,
      resolution: body?.resolution || resolution
    };
  } catch {
    /* No synthetic candles either: an empty series makes the chart say
       "indexer did not return candles" — a claim about us, not the market. */
    return {
      candles: [],
      live: false,
      unavailable: true,
      ticker: safe,
      resolution
    };
  }
}

/** Public orderbook data through our same-origin CORS proxy. */
export async function getDydxOrderbook(ticker) {
  if (!/^[A-Z0-9]+-[A-Z0-9]+$/.test(String(ticker || ''))) return { live: false };
  try {
    const body = await timeoutFetch(`${API_BASE}/dydx/orderbook/${encodeURIComponent(ticker)}`);
    const bids = Array.isArray(body?.bids) ? body.bids : [];
    const asks = Array.isArray(body?.asks) ? body.asks : [];
    const bestBid = Number(bids[0]?.price);
    const bestAsk = Number(asks[0]?.price);
    const mid = (bestBid + bestAsk) / 2;
    const sum = (rows) => rows.reduce((n, r) => {
      const p = Number(r.price); const s = Number(r.size);
      return Number.isFinite(p) && Number.isFinite(s) && mid > 0 && Math.abs(p / mid - 1) <= 0.01 ? n + p * s : n;
    }, 0);
    /*
     * THE LADDER, not just the ±1% total.
     *
     * `bidDepth1Pct` answered "how much is within 1%", which is the wrong
     * question for a depth chart and for the slippage estimate a ticket needs:
     * the terminal draws 10–20 levels per side and asks "what would my size
     * cost me at each price". The rows are already in the response (the indexer
     * sends the whole book), so keeping them costs nothing but honest shape.
     * `offsetPct` is distance from the mid, so a component can scale the chart
     * without knowing the price scale.
     */
    const ladder = (rows, sign) => (Array.isArray(rows) ? rows : [])
      .map((r) => {
        const price = Number(r.price);
        const size = Number(r.size);
        if (!Number.isFinite(price) || !Number.isFinite(size) || price <= 0 || size <= 0 || !(mid > 0)) return null;
        return {
          price,
          size,
          usd: price * size,
          offsetPct: ((price - mid) / mid) * 100 * sign,
          /* cumulative notional from the touch outward — the curve a slippage
             estimate walks. */
        };
      })
      .filter(Boolean)
      .sort((a, b) => a.offsetPct - b.offsetPct);
    const bidLadder = ladder(bids, -1);
    const askLadder = ladder(asks, 1);
    const withCumulative = (rows) => {
      let run = 0;
      return rows.map((r) => { run += r.usd; return { ...r, cumulativeUsd: run }; });
    };
    const bidDepth = withCumulative(bidLadder);
    const askDepth = withCumulative(askLadder);
    const bidUsd1Pct = sum(bids);
    const askUsd1Pct = sum(asks);
    const total1Pct = bidUsd1Pct + askUsd1Pct;
    return {
      live: Number.isFinite(mid) && mid > 0,
      bestBid, bestAsk, mid: Number.isFinite(mid) && mid > 0 ? mid : null,
      spreadBps: mid > 0 ? ((bestAsk - bestBid) / mid) * 10_000 : null,
      bidDepth1Pct: bidUsd1Pct,
      askDepth1Pct: askUsd1Pct,
      bidDepth,
      askDepth,
      /* Share of the ±1% book that is bids. 50% is balanced; 80% means the
         book is bid-heavy and a market sell is the cheaper side. */
      imbalancePct: total1Pct > 0 ? (bidUsd1Pct / total1Pct) * 100 : null,
      ticker: String(ticker).toUpperCase()
    };
  } catch {
    return { live: false };
  }
}

/** Public subaccount data through our same-origin CORS proxy. */
export async function getDydxSubaccount(address, number = 0) {
  if (!isDydxAddress(address)) return { account: null, live: false };
  try {
    const account = await timeoutFetch(
      `${API_BASE}/dydx/account/${encodeURIComponent(address)}/${encodeURIComponent(number)}`
    );
    return { account, live: true };
  } catch (err) {
    /* An unfunded derived address is a legitimate empty account. */
    if (String(err?.message).includes('HTTP_404')) return { account: null, live: true };
    return { account: null, live: false };
  }
}

/*
 * ─── READS FOR THE TP/SL AND HISTORY SECTIONS ────────────────────────────────
 * Both go through the same-origin proxy (server/dydx.js) and never through the
 * browser directly. The address travels in the request path only; it is kept
 * in the caller's memory and is not written to storage or to any log here.
 */
export const DYDX_ORDER_STATUSES = Object.freeze(['UNTRIGGERED', 'OPEN', 'FILLED', 'CANCELED', 'BEST_EFFORT_CANCELED']);

export async function getDydxFills({ address, subaccount = 0, limit = 25, before = null } = {}) {
  if (!isDydxAddress(address)) return { fills: [], live: false, reason: 'BAD_ADDRESS' };
  const sub = Number.isInteger(Number(subaccount)) ? Number(subaccount) : 0;
  const qs = new URLSearchParams({ limit: String(Math.min(100, Math.max(1, Math.trunc(Number(limit) || 25)))) });
  if (before) qs.set('before', String(before));
  try {
    const body = await timeoutFetch(`${API_BASE}/dydx/fills/${encodeURIComponent(address)}/${sub}?${qs.toString()}`);
    return { fills: Array.isArray(body?.fills) ? body.fills : [], live: true };
  } catch (err) {
    /* An account that has never traded is a legitimate empty history. */
    if (String(err?.message).includes('HTTP_404')) return { fills: [], live: true };
    return { fills: [], live: false, reason: 'INDEXER_UNAVAILABLE' };
  }
}

export async function getDydxOrders({ address, subaccount = 0, status = 'UNTRIGGERED' } = {}) {
  if (!isDydxAddress(address)) return { orders: [], live: false, reason: 'BAD_ADDRESS' };
  if (!DYDX_ORDER_STATUSES.includes(status)) return { orders: [], live: false, reason: 'BAD_STATUS' };
  const sub = Number.isInteger(Number(subaccount)) ? Number(subaccount) : 0;
  try {
    const body = await timeoutFetch(
      `${API_BASE}/dydx/orders/${encodeURIComponent(address)}/${sub}?status=${encodeURIComponent(status)}`
    );
    return { orders: Array.isArray(body?.orders) ? body.orders : [], live: true };
  } catch (err) {
    if (String(err?.message).includes('HTTP_404')) return { orders: [], live: true };
    return { orders: [], live: false, reason: 'INDEXER_UNAVAILABLE' };
  }
}

/**
 * Normalise a ticker BEFORE validating it.
 *
 * The three reads below shipped with `test(ticker) ? upper(ticker) : ''`, which
 * rejects `btc-usd` because the regex runs on the RAW string — a lowercase
 * ticker from a deep link, a URL, or a user's own pair shortcut would silently
 * become "BAD_TICKER" and the panel would sit empty for no stated reason. The
 * shape is all that matters; normalise first, then test.
 */
const normaliseTicker = (ticker) => {
  const up = String(ticker || '').trim().toUpperCase();
  return /^[A-Z0-9]+-[A-Z0-9]+$/.test(up) ? up : '';
};

/**
 * 24h HIGH / LOW from the venue's own hourly candles (server-side, one call).
 *
 * Returns `{ high24h, low24h, bars, live }`; nulls mean "the indexer did not
 * give us enough bars", which the UI renders as «—» rather than as a zero.
 */
export async function getDydx24hRange(ticker) {
  const safe = normaliseTicker(ticker);
  if (!safe) return { high24h: null, low24h: null, live: false, reason: 'BAD_TICKER' };
  try {
    const body = await timeoutFetch(`${API_BASE}/dydx/range/${encodeURIComponent(safe)}`);
    /* Number(null) is 0 — the exact trap this panel must not fall into. A
       missing high is NOT a high of zero, so absence is checked before the
       conversion, not after it. */
    const high24h = body?.high24h == null ? null : Number(body.high24h);
    const low24h = body?.low24h == null ? null : Number(body.low24h);
    return {
      high24h: Number.isFinite(high24h) ? high24h : null,
      low24h: Number.isFinite(low24h) ? low24h : null,
      bars: Number(body?.bars) || 0,
      live: Number.isFinite(high24h) && Number.isFinite(low24h)
    };
  } catch {
    return { high24h: null, low24h: null, live: false, reason: 'INDEXER_UNAVAILABLE' };
  }
}

/**
 * The tape. Newest first, normalised to `{ price, size, usd, side, at }`.
 *
 * `side` comes from the indexer's taker side (`BUY`/`SELL`), which is the only
 * honest way to colour a print: the side of the RESTING order is the opposite
 * one, and colouring by it would paint every buy green and every sell red
 * backwards. Trades with no side drop to 'UNKNOWN' and the UI draws them
 * neutral rather than guessing.
 */
export async function getDydxTrades(ticker, limit = 50) {
  const safe = normaliseTicker(ticker);
  if (!safe) return { trades: [], live: false, reason: 'BAD_TICKER' };
  const count = Math.min(100, Math.max(1, Math.trunc(Number(limit) || 50)));
  try {
    const body = await timeoutFetch(`${API_BASE}/dydx/trades/${encodeURIComponent(safe)}?limit=${count}`);
    const rows = Array.isArray(body?.trades) ? body.trades : [];
    const trades = rows.map((t) => {
      const price = Number(t.price);
      const size = Number(t.size);
      return {
        id: String(t.id || `${t.createdAt}-${price}-${size}`),
        price: Number.isFinite(price) ? price : null,
        size: Number.isFinite(size) ? size : null,
        usd: Number.isFinite(price) && Number.isFinite(size) ? price * size : null,
        side: t.side === 'BUY' ? 'buy' : t.side === 'SELL' ? 'sell' : 'unknown',
        at: t.createdAt || null,
        atMs: t.createdAt ? Date.parse(t.createdAt) : null,
        type: t.type || null
      };
    }).filter((t) => t.price != null && t.size != null);
    return { trades, live: trades.length > 0, ticker: safe };
  } catch {
    return { trades: [], live: false, reason: 'INDEXER_UNAVAILABLE', ticker: safe };
  }
}

/**
 * Historical funding — the realised cost of holding, not the next payment.
 *
 * Rows come back oldest-first with `effectiveAt`, an hourly rate and the
 * annualised figure the venue itself computes. `aprPct` here is that published
 * number; when the row omits it the client derives from the hourly rate with
 * the same 24×365 the rest of the app uses, never with a different constant.
 */
export async function getDydxFundingHistory(ticker, limit = 48) {
  const safe = normaliseTicker(ticker);
  if (!safe) return { rows: [], live: false, reason: 'BAD_TICKER' };
  const count = Math.min(100, Math.max(1, Math.trunc(Number(limit) || 48)));
  try {
    const body = await timeoutFetch(`${API_BASE}/dydx/funding-history/${encodeURIComponent(safe)}?limit=${count}`);
    const raw = Array.isArray(body?.historicalFunding) ? body.historicalFunding : [];
    /* The indexer sends an HOURLY rate as a decimal string ("0.0000125").
       % = ×100; APR = the same 24 × 365 every other funding number in this app
       uses. The row's `price` is the oracle at settlement, not a rate, so it is
       carried through only for reference — deriving an APR from it would
       multiply a price by a year. */
    const rows = raw.map((r) => {
      const hourly = Number(r.rate);
      return {
        at: r.effectiveAt || null,
        atMs: r.effectiveAt ? Date.parse(r.effectiveAt) : null,
        rateHourlyPct: Number.isFinite(hourly) ? hourly * 100 : null,
        aprPct: Number.isFinite(hourly) ? hourly * 100 * 24 * 365 : null,
        oracleAtSettlement: Number.isFinite(Number(r.price)) ? Number(r.price) : null
      };
    }).filter((r) => Number.isFinite(r.atMs)).sort((a, b) => a.atMs - b.atMs);
    const paid = rows.reduce((n, r) => n + (r.rateHourlyPct || 0), 0);
    return {
      rows,
      live: rows.length > 0,
      ticker: safe,
      /* Sum of the hourly rates over the window: the total % of notional a long
         paid (positive) or received (negative) across these settlements. */
      cumulativePct: rows.length ? paid : null,
      hourlyVolatilityPct: rows.length > 1
        ? Math.sqrt(rows.reduce((n, r) => n + (r.rateHourlyPct || 0) ** 2, 0) / rows.length)
        : null
    };
  } catch {
    return { rows: [], live: false, reason: 'INDEXER_UNAVAILABLE', ticker: safe };
  }
}

async function loadClient() {
  if (!clientPromise) {
    clientPromise = (async () => {
      /* The official client and CosmJS expect Buffer. Keep it inside this lazy
         chunk so users who never open dYdX do not pay for the polyfill. */
      if (!globalThis.Buffer) {
        const { Buffer } = await import('buffer');
        globalThis.Buffer = Buffer;
      }
      return import('@dydxprotocol/v4-client-js');
    })();
  }
  return clientPromise;
}

/*
 * ─── THE ONBOARDING SIGNATURE — WHY IT IS ON ETHEREUM, AND WHY IT IS RAW ───
 * The report: «اتصال dYdX → could not coalesce error (WALLET_RETURNED_UNSIGNED)
 * … eth_signTypedData_v4 … "chainId":"0x1"».
 *
 * dYdX derives the Chain key from a signature over EIP-712 typed data whose
 * domain is `{ name: 'dYdX Chain', chainId: 1 }`. The `chainId: 1` is not
 * negotiable — it is part of what is signed, and a different value derives a
 * different dYdX account from the one dydx.trade shows for the same wallet.
 *
 * The app's default network is BNB Chain (56), so the wallet was on 56 and
 * WalletConnect tagged the request `eip155:56` — while the domain inside it
 * said chain 1. Wallets refuse that mismatch (MetaMask: «Provided chainId
 * must match the active chainId»; Trust and most mobile wallets drop it
 * without drawing a prompt). The user saw the wallet open with nothing to
 * sign, came back, and the signing guard reported WALLET_RETURNED_UNSIGNED
 * through ethers' «could not coalesce error». That code was only a timeout
 * heuristic, not proof of an unsigned return. The guard now retains the
 * pending request across app switches so relay recovery can deliver it.
 *
 * dydx.trade itself switches the wallet to Ethereum before asking (v4-web
 * `useMatchingEvmNetwork` in its key-generation step). So does this, now:
 *
 *   1. move the wallet to Ethereum mainnet (a WalletConnect session that
 *      already approved eip155:1 switches locally, with no extra prompt);
 *   2. send the typed data RAW over EIP-1193, with `chainId` as the JSON number
 *      1 — byte-for-byte the payload viem/wagmi send for dydx.trade — instead
 *      of ethers' hex-string "0x1", which some wallets parse differently;
 *   3. verify the signature recovers to the connected address before a key is
 *      derived from it, so a wallet that signed something else can never
 *      silently produce a different dYdX account;
 *   4. put a WalletConnect wallet back on the network it came from (a local,
 *      prompt-free switch for an approved chain).
 */
export const DYDX_ONBOARDING_CHAIN_ID = 1;

export function dydxOnboardingTypedData() {
  return {
    types: {
      EIP712Domain: [
        { name: 'name', type: 'string' },
        { name: 'chainId', type: 'uint256' }
      ],
      dYdX: [{ name: 'action', type: 'string' }]
    },
    domain: { name: 'dYdX Chain', chainId: DYDX_ONBOARDING_CHAIN_ID },
    primaryType: 'dYdX',
    message: { action: 'dYdX Chain Onboarding' }
  };
}

/** A coded error the page can translate (see `dydx.err.*`). */
const dydxError = (code, cause) => {
  const error = new Error(code);
  error.code = code;
  error.dydx = true;
  if (cause) error.cause = cause;
  return error;
};

const withTimeout = (pending, ms, code) =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(dydxError(code)), ms);
    Promise.resolve(pending).then(
      (value) => { clearTimeout(timer); resolve(value); },
      (err) => { clearTimeout(timer); reject(err); }
    );
  });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const parseChainId = (raw) => {
  if (raw == null) return null;
  const text = String(raw);
  const n = text.startsWith('eip155:')
    ? Number(text.slice(7))
    : /^0x/i.test(text) ? parseInt(text, 16) : Number(text);
  return Number.isInteger(n) && n > 0 ? n : null;
};

async function readChainId(provider) {
  try {
    const hex = await withTimeout(provider.request({ method: 'eth_chainId' }), 8_000, 'CHAIN_READ_TIMEOUT');
    const n = parseChainId(hex);
    if (n) return n;
  } catch { /* fall back to the provider's own field */ }
  return parseChainId(provider?.chainId);
}

/**
 * Collapse every shape a wallet failure arrives in — a signing-guard code, an
 * EIP-1193 `{code:4001}`, an ethers «could not coalesce error» wrapping either
 * — into one code for `dydx.err.*`.
 */
export function classifyDydxError(error) {
  if (!error) return 'CONNECT_FAILED';
  const layers = [error, error.error, error.info?.error, error.cause, error.data?.originalError].filter(Boolean);
  const codes = layers.map((e) => e?.code).filter((c) => c != null).map(String);
  const text = layers.map((e) => String(e?.message ?? e?.shortMessage ?? '')).join(' | ');
  const has = (re) => codes.some((c) => re.test(c)) || re.test(text);

  if (error.dydx && error.code) return error.code;
  if (codes.includes('4001') || codes.includes('ACTION_REJECTED') || /user rejected|user denied|rejected by user|request rejected|cancell?ed by user|user cancell?ed/i.test(text)) {
    return 'REJECTED';
  }
  if (has(/WALLET_RETURNED_UNSIGNED/)) return 'RETURNED_UNSIGNED';
  if (has(/WALLET_NO_RESPONSE/)) return 'NO_RESPONSE';
  if (has(/WALLET_CHAIN_NOT_APPROVED|WALLET_CHAIN_UNAPPROVED|must match the active chain|chainid.*(mismatch|match)|unsupported chain/i)) {
    return 'NEEDS_ETHEREUM';
  }
  if (has(/WALLET_SESSION_GONE|WALLET_RELAY_DOWN|WALLET_NO_ACCOUNT|session not found|no matching key/i)) return 'SESSION_GONE';
  if (has(/WALLET_METHOD_UNAPPROVED|method not (found|supported)|unsupported .*method|4200/i)) return 'METHOD_UNSUPPORTED';
  if (has(/NO_SIGNER/)) return 'NO_SIGNER';
  return 'CONNECT_FAILED';
}

/**
 * Ask the connected EVM wallet for the dYdX onboarding signature.
 *
 * @param {object}   options
 * @param {() => object} options.getProvider  the live EIP-1193 provider (read
 *        through a function: a local vault rebuilds its adapter on a switch)
 * @param {string}   [options.address]       the connected EVM address
 * @param {(chainId:number) => Promise<boolean>} [options.switchChain]
 * @param {boolean}  [options.requireChain=true]  false for the in-app vault,
 *        whose local signer has no «active chain» to disagree with
 * @param {boolean}  [options.restoreChain=false] put the wallet back afterwards
 * @param {(stage:'switch'|'sign'|'derive') => void} [options.onStage]
 * @returns {Promise<string>} a 65-byte signature
 */
export async function requestDydxOnboardingSignature({
  getProvider,
  address = null,
  switchChain = null,
  requireChain = true,
  restoreChain = false,
  onStage = null
} = {}) {
  let provider = typeof getProvider === 'function' ? getProvider() : null;
  if (!provider || typeof provider.request !== 'function') throw dydxError('NO_SIGNER');

  let account = String(address || '').trim();
  if (!account) {
    try {
      const accs = await withTimeout(provider.request({ method: 'eth_accounts' }), 8_000, 'NO_SIGNER');
      account = Array.isArray(accs) && accs[0] ? String(accs[0]) : '';
    } catch { /* handled below */ }
  }
  if (!/^0x[0-9a-fA-F]{40}$/.test(account)) throw dydxError('NO_SIGNER');

  const target = DYDX_ONBOARDING_CHAIN_ID;
  let previousChain = null;
  if (requireChain) {
    previousChain = await readChainId(provider);
    if (previousChain !== target) {
      if (typeof switchChain !== 'function') throw dydxError('NEEDS_ETHEREUM');
      try { onStage?.('switch'); } catch { /* advisory */ }
      let ok = false;
      try {
        /* A switch the wallet has to show can wait for the human; a switch
           nobody answers must not spin forever. */
        ok = await withTimeout(switchChain(target), 90_000, 'SWITCH_TIMEOUT');
      } catch (err) {
        if (classifyDydxError(err) === 'REJECTED') throw dydxError('SWITCH_REJECTED', err);
        ok = false;
      }
      if (!ok) throw dydxError('NEEDS_ETHEREUM');
      /* The switch resolves before every layer has heard `chainChanged`;
         the request below must be tagged eip155:1, so wait for the provider
         to say so (bounded). */
      let now = null;
      for (let i = 0; i < 20; i += 1) {
        provider = (typeof getProvider === 'function' && getProvider()) || provider;
        now = await readChainId(provider);
        if (now === target) break;
        await sleep(250);
      }
      if (now !== target) throw dydxError('NEEDS_ETHEREUM');
    }
  }

  const typed = dydxOnboardingTypedData();
  try { onStage?.('sign'); } catch { /* advisory */ }
  let signature;
  try {
    signature = await provider.request({
      method: 'eth_signTypedData_v4',
      params: [account, JSON.stringify(typed)]
    });
  } finally {
    if (restoreChain && previousChain && previousChain !== target && typeof switchChain === 'function') {
      /* Best effort and never awaited by the caller's success path: the
         signature is already in hand (or already failed). */
      Promise.resolve()
        .then(() => switchChain(previousChain))
        .catch(() => {});
    }
  }

  const sig = typeof signature === 'string' ? signature.trim() : '';
  /* dYdX derives the key from r‖s of a 65-byte ECDSA signature. A smart-
     contract wallet (ERC-1271/6492) returns something else and cannot hold a
     dYdX account — say so instead of deriving garbage. */
  if (!/^0x[0-9a-fA-F]{130}$/.test(sig)) throw dydxError('BAD_SIGNATURE');

  try {
    const { verifyTypedData } = await import('ethers');
    const types = { dYdX: typed.types.dYdX };
    const recovered = verifyTypedData(typed.domain, types, typed.message, sig);
    if (String(recovered).toLowerCase() !== account.toLowerCase()) throw dydxError('SIGNER_MISMATCH');
  } catch (err) {
    if (err?.dydx) throw err;
    throw dydxError('BAD_SIGNATURE', err);
  }
  return sig;
}

/*
 * Validator endpoints, tried in order. The derived address needs no network
 * at all, so connecting no longer fails because one RPC was slow: the client
 * is opened lazily (and retried) when an order is actually placed.
 */
const DYDX_VALIDATORS = [
  'https://dydx-ops-rpc.kingnodes.com:443',
  'https://dydx-dao-rpc.polkachu.com:443'
];

async function openCompositeClient(sdk) {
  let lastError = null;
  for (const endpoint of DYDX_VALIDATORS) {
    try {
      const base = sdk.Network.mainnet();
      const vc = base.validatorConfig;
      const network = endpoint === vc.restEndpoint || endpoint.replace(/\/$/, '') === vc.restEndpoint
        ? base
        : new sdk.Network(
            base.env,
            base.indexerConfig,
            new sdk.ValidatorConfig(endpoint, vc.chainId, vc.denoms, vc.broadcastOptions, vc.defaultClientMemo)
          );
      return await withTimeout(sdk.CompositeClient.connect(network), 20_000, 'VALIDATOR_TIMEOUT');
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError || new Error('VALIDATOR_UNREACHABLE');
}

async function ensureDydxClient() {
  if (!session) throw new Error('NOT_CONNECTED');
  if (session.client) return session.client;
  if (!session.clientPromise) {
    const owner = session;
    owner.clientPromise = openCompositeClient(owner.sdk).then(
      (client) => { owner.client = client; return client; },
      (err) => { owner.clientPromise = null; throw err; }
    );
  }
  return session.clientPromise;
}

/**
 * Create an in-memory dYdX signing session from the user's EVM signature.
 * The returned address matches the account dydx.trade generates for the same
 * EVM wallet. Nothing secret is written to localStorage or React state.
 *
 * Accepts either the options of `requestDydxOnboardingSignature` or — for
 * older callers — an ethers signer (which is adapted, not trusted blindly:
 * the same Ethereum-domain rules apply through its provider).
 */
export async function connectDydx(options) {
  let signature;
  if (options && typeof options.getProvider === 'function') {
    signature = await requestDydxOnboardingSignature(options);
  } else if (options?.signTypedData) {
    const typed = dydxOnboardingTypedData();
    signature = await options.signTypedData(typed.domain, { dYdX: typed.types.dYdX }, typed.message);
    if (!/^0x[0-9a-fA-F]{130}$/.test(String(signature || ''))) throw dydxError('BAD_SIGNATURE');
  } else {
    throw dydxError('NO_SIGNER');
  }

  try { options?.onStage?.('derive'); } catch { /* advisory */ }
  const sdk = await loadClient();
  const { mnemonic } = sdk.onboarding.deriveHDKeyFromEthereumSignature(signature);
  try {
    const wallet = await sdk.LocalWallet.fromMnemonic(mnemonic, 'dydx');
    const subaccount = sdk.SubaccountInfo.forLocalWallet(wallet, 0);
    session = { sdk, wallet, client: null, clientPromise: null, subaccount, address: wallet.address };
    /* Warm the validator connection in the background; an order awaits it. */
    ensureDydxClient().catch(() => {});
    return { address: wallet.address };
  } finally {
    /* Strings cannot be zeroed, but dropping the only reference immediately is
       still materially safer than retaining or persisting the mnemonic. */
    // eslint-disable-next-line no-unused-vars
    void mnemonic;
  }
}

export function disconnectDydx() {
  session = null;
}

export const dydxSessionAddress = () => session?.address || null;

/**
 * Lifetime asked for a resting (LONG_TERM) limit order: 28 days, the same
 * window the conditional TP/SL orders already use. dYdX measures a stateful
 * order's life in absolute seconds from the block it lands in, so this is the
 * number that becomes `goodTilTimeInSeconds`.
 */
export const DYDX_LIMIT_GOOD_TIL_SECONDS = 28 * 24 * 60 * 60;

/*
 * ─── THE ONE PLACE THE 22 POSITIONAL ARGUMENTS ARE WRITTEN DOWN ───────────────
 * `CompositeClient.placeOrder` takes twenty-two positional parameters. Three
 * call sites used to spell them out, and one of them spelled argument 8 wrong
 * in a way that only shows up at runtime:
 *
 *   «سفارش لیمیت dYdX → nothing happens»
 *
 * `placeDydxOrder({ orderType: 'limit' })` passed `undefined` for
 * `timeInForce`, and the pinned SDK's own flag helper refuses that combination
 * before any signature is requested:
 *
 *   calculateOrderFlags(OrderType.LIMIT, undefined)
 *     → throws 'timeInForce must be set if orderType is LIMIT'
 *
 * MARKET orders were unaffected — `calculateOrderFlags(MARKET, undefined)`
 * returns SHORT_TERM without looking at the time-in-force — which is exactly
 * why the screen worked in testing and every limit order on it failed.
 *
 * A resting limit also needs two more arguments that a market order does not:
 *   · LIMIT + GTT computes to OrderFlags.LONG_TERM, and `placeOrderMessage`
 *     throws 'goodTilTimeInSeconds must be set for LONG_TERM or CONDITIONAL
 *     order' unless argument 9 is present;
 *   · `calculateTimeInForce(LIMIT, GTT, …, postOnly)` throws 'postOnly must be
 *     set if order type is LIMIT and timeInForce is GTT' unless argument 11 is
 *     a boolean, so `false` is passed explicitly rather than left undefined.
 *
 * All three verified against the pinned 3.4.0 build in
 * test/perp-auto-orders-units.mjs, which calls the SDK's own helpers with the
 * tuples this function produces.
 */
async function sendDydxOrder({ market, type, side, price, size, triggerPrice = null, reduceOnly = false, timeInForce = null, goodTilTimeInSeconds = null, execution = null, postOnly = null, memo = 'FBT Swap builder order' }) {
  const sdk = await loadClient();
  const clientId = crypto.getRandomValues(new Uint32Array(1))[0];
  let client;
  try {
    client = await ensureDydxClient();
  } catch {
    throw new Error('VALIDATOR_UNREACHABLE');
  }
  /* The session can be dropped by a disconnect in another tab while the user
     was reading the review screen. */
  if (!session) throw new Error('NOT_CONNECTED');

  const orderType = sdk.OrderType[type];
  if (!orderType) throw new Error('BAD_ORDER_TYPE');
  const orderSide = side === 'sell' ? sdk.OrderSide.SELL : sdk.OrderSide.BUY;

  const result = await client.placeOrder(
    session.subaccount,      //  1 subaccount
    market.ticker,           //  2 marketId
    orderType,               //  3 type
    orderSide,               //  4 side
    price,                   //  5 price (limit price, or the worst price a triggered order may pay)
    size,                    //  6 size in base units
    clientId,                //  7 clientId
    timeInForce == null ? undefined : sdk.OrderTimeInForce[timeInForce], // 8 — MUST be set for LIMIT
    goodTilTimeInSeconds,    //  9 — MUST be set for LONG_TERM and CONDITIONAL
    execution == null ? undefined : sdk.OrderExecution[execution],       // 10
    postOnly,                // 11 — MUST be a boolean for LIMIT + GTT
    Boolean(reduceOnly),     // 12
    triggerPrice,            // 13 — conditional orders only
    market.raw,              // 14 marketInfo (skips an indexer round-trip)
    undefined,               // 15 currentHeight (only SHORT_TERM needs it, and the SDK fetches it)
    undefined,               // 16 goodTilBlock (SHORT_TERM only)
    memo,                    // 17
    undefined,               // 18 broadcastMode
    undefined,               // 19 twapParameters
    { builderAddress: DYDX_BUILDER_ADDRESS, feePpm: DYDX_BUILDER_FEE_PPM } // 20
  );

  const hash = result?.hash;
  return {
    hash: typeof hash === 'string' ? hash : hash?.toString?.() || null,
    clientId,
    /* Echoed so a caller can say «دستور بستن ثبت شد» instead of «سفارش ثبت
       شد» — the two are the same request and opposite news. */
    reduceOnly: Boolean(reduceOnly),
    /* What a cancel has to reproduce: the flags follow from the order type and
       the time-in-force, and the expiry is the one that was signed. */
    orderFlags: orderFlagsFor(type, timeInForce),
    goodTilTimeInSeconds: goodTilTimeInSeconds == null ? null : Number(goodTilTimeInSeconds),
    builderAddress: DYDX_BUILDER_ADDRESS,
    feePpm: DYDX_BUILDER_FEE_PPM
  };
}

/**
 * OrderFlags for a type/time-in-force pair, as the SDK computes it.
 *
 * Duplicated as a plain string map rather than read from the SDK because this
 * runs before the client is loaded (a stored order has to say how to cancel
 * itself) and because the mapping is a protocol constant, not a preference:
 * MARKET → SHORT_TERM, LIMIT + GTT → LONG_TERM, LIMIT + IOC/FOK → SHORT_TERM,
 * every trigger type → CONDITIONAL.
 */
export function orderFlagsFor(type, timeInForce = null) {
  const t = String(type || '').toUpperCase();
  if (t === 'STOP_MARKET' || t === 'STOP_LIMIT' || t === 'TAKE_PROFIT_MARKET' || t === 'TAKE_PROFIT' || t === 'TAKE_PROFIT_LIMIT') {
    return 'CONDITIONAL';
  }
  if (t === 'LIMIT') return String(timeInForce || '').toUpperCase() === 'GTT' ? 'LONG_TERM' : 'SHORT_TERM';
  return 'SHORT_TERM';
}

/**
 * Market/IOC or resting-limit order with our builder address and fee inside
 * the signed order.
 *
 * `postOnly` is the venue's own maker-only flag and is only meaningful for a
 * LIMIT + GTT order (see sendDydxOrder): a post-only order that would cross
 * the book is CANCELLED by the matching engine instead of taking liquidity,
 * which is what "maker" has to mean. It is ignored for market orders, where
 * the SDK's flag helper would reject the combination anyway.
 */
export async function placeDydxOrder({ market, side, size, slippagePct = 0.5, reduceOnly = false, orderType = 'market', limitPrice: userPrice = null, goodTilSeconds = DYDX_LIMIT_GOOD_TIL_SECONDS, postOnly = false }) {
  if (!session) throw new Error('NOT_CONNECTED');
  if (!market?.ticker || !market?.raw) throw new Error('BAD_MARKET');
  const qty = Number(size);
  if (!Number.isFinite(qty) || qty <= 0) throw new Error('BAD_SIZE');
  const buy = side === 'buy';

  if (orderType === 'limit' && userPrice != null && String(userPrice).trim() !== '') {
    const lp = Number(userPrice);
    if (!Number.isFinite(lp) || lp <= 0) throw new Error('BAD_PRICE');
    const seconds = Math.round(Number(goodTilSeconds));
    if (!Number.isFinite(seconds) || seconds < 60) throw new Error('BAD_EXPIRY');
    /*
     * A resting limit: LIMIT + GTT + an absolute lifetime + postOnly=false.
     * See sendDydxOrder for why each of those four is mandatory and what the
     * SDK throws when one is missing.
     */
    return sendDydxOrder({
      market,
      type: 'LIMIT',
      side: buy ? 'buy' : 'sell',
      price: lp,
      size: qty,
      reduceOnly,
      timeInForce: 'GTT',
      goodTilTimeInSeconds: seconds,
      execution: 'DEFAULT',
      postOnly: Boolean(postOnly),
      memo: 'FBT Swap builder limit order'
    });
  }

  const slip = Number(slippagePct);
  if (!Number.isFinite(slip) || slip <= 0 || slip > 10) throw new Error('BAD_SLIPPAGE');
  return sendDydxOrder({
    market,
    type: 'MARKET',
    side: buy ? 'buy' : 'sell',
    price: market.oraclePrice * (1 + (buy ? 1 : -1) * slip / 100),
    size: qty,
    reduceOnly,
    /* A market order is SHORT_TERM: no time-in-force, no lifetime, and the SDK
       computes goodTilBlock from the current height. IOC is the execution the
       screen has always used. */
    execution: 'IOC',
    postOnly: false
  });
}

/**
 * Place one PLANNED auto-order — the request produced by `planDydxOrder`
 * (src/lib/perpOrders.js).
 *
 * The plan is re-checked here rather than trusted, because the object crosses a
 * render boundary and a malformed one must not reach the chain: a caller that
 * hands over something the planner would have refused gets the same refusal.
 * The planner owns the price/size/trigger arithmetic; this function owns the
 * signature, and nothing else calls it.
 */
export async function placeDydxAutoOrder({ market, request }) {
  if (!session) throw new Error('NOT_CONNECTED');
  if (!market?.ticker || !market?.raw) throw new Error('BAD_MARKET');
  const r = request || {};
  if (r.venue !== 'dydx') throw new Error('BAD_REQUEST');
  if (market.ticker !== r.ticker) throw new Error('BAD_MARKET');

  const qty = Number(r.size);
  const price = Number(r.price);
  if (!Number.isFinite(qty) || qty <= 0) throw new Error('BAD_SIZE');
  if (!Number.isFinite(price) || price <= 0) throw new Error('BAD_PRICE');

  const seconds = Math.round(Number(r.goodTilTimeInSeconds));
  if (!Number.isFinite(seconds) || seconds < 60) throw new Error('BAD_EXPIRY');

  const isLimit = r.orderType === 'LIMIT';
  const trigger = Number(r.triggerPrice);
  if (!isLimit && (!Number.isFinite(trigger) || trigger <= 0)) throw new Error('BAD_PRICE');

  return sendDydxOrder({
    market,
    type: r.orderType,
    side: r.side,
    price,
    size: qty,
    triggerPrice: isLimit ? null : trigger,
    reduceOnly: Boolean(r.reduceOnly),
    /* The two shapes the venue accepts for an order that has to survive this
       tab being closed, and nothing else. */
    timeInForce: isLimit ? 'GTT' : null,
    goodTilTimeInSeconds: seconds,
    execution: isLimit ? 'DEFAULT' : 'IOC',
    /* A boolean, never undefined: LIMIT + GTT throws without one, and a
       trigger order ignores it. */
    postOnly: false,
    memo: isLimit ? 'FBT Swap auto limit order' : 'FBT Swap auto trigger order'
  });
}

/*
 * ─── TAKE-PROFIT / STOP-LOSS: SIGNED ONLY FROM A CLICK ───────────────────────
 * `leg` is one planned leg from `validateTpSl` (src/lib/dydxTpsl.js). The
 * caller has already refused an invalid plan; this function re-checks the leg's
 * shape so a malformed object can never reach the chain. It is called from the
 * «تایید و ارسال» handler and from nothing else. Nothing schedules it.
 */
export async function placeDydxConditionalOrder({ market, leg }) {
  if (!session) throw new Error('NOT_CONNECTED');
  if (!market?.ticker || !market?.raw) throw new Error('BAD_MARKET');
  if (!leg || !leg.sdkType || leg.reduceOnly !== true) throw new Error('BAD_LEG');
  const qty = Number(leg.size);
  const trigger = Number(leg.triggerPrice);
  const limit = Number(leg.limitPrice);
  if (!Number.isFinite(qty) || qty <= 0 || !Number.isFinite(trigger) || trigger <= 0 || !Number.isFinite(limit) || limit <= 0) {
    throw new Error('BAD_LEG');
  }
  const sdk = await loadClient();
  const orderType = sdk.OrderType[leg.sdkType];
  if (!orderType) throw new Error('BAD_LEG');
  const isSell = leg.side === 'SELL';
  /* Same conditional tuple the auto-order path uses: no time-in-force (the
     flags come from the trigger type), IOC execution — the SDK refuses DEFAULT
     and POST_ONLY for the two market-trigger types — and a mandatory lifetime. */
  const sent = await sendDydxOrder({
    market,
    type: leg.sdkType,
    side: isSell ? 'sell' : 'buy',
    price: limit,
    size: qty,
    triggerPrice: trigger,
    reduceOnly: true,
    timeInForce: null,
    goodTilTimeInSeconds: TPSL_GOOD_TIL_SECONDS,
    execution: 'IOC',
    postOnly: false,
    memo: 'FBT Swap TP/SL order'
  });
  return {
    ...sent,
    kind: leg.kind,
    triggerPrice: trigger
  };
}

/**
 * Cancel one STATEFUL dYdX order — a resting LONG_TERM limit or an
 * untriggered CONDITIONAL trigger — signed by the session.
 *
 * ─── WHY `orderFlags` IS AN ARGUMENT AND NOT A CONSTANT ───────────────────────
 * A cancel has to name the order it cancels by the same coordinates the order
 * was placed with, and the SDK refuses a mismatch in both directions
 * (`CompositeClient.cancelOrder`, pinned 3.4.0):
 *
 *   · LONG_TERM / CONDITIONAL — `goodTilTimeInSeconds` must be non-zero AND
 *     `goodTilBlock` must be EXACTLY 0. Passing `undefined` for the block,
 *     which is what this function used to do, throws
 *     'goodTilBlock should be zero since LONG_TERM or CONDITIONAL orders use
 *     goodTilTimeInSeconds instead of goodTilBlock.' So a cancel of a TP/SL
 *     order could never have worked, and the button that offered it was a
 *     button that always failed.
 *   · SHORT_TERM — the mirror image: a non-zero `goodTilBlock` and no lifetime.
 *
 * The expiry is taken from the order the indexer reported rather than computed
 * fresh, so the cancel targets the same stateful order instead of a lifetime
 * that no longer matches.
 */
export async function cancelDydxOrder({ market, clientId, orderFlags = 'CONDITIONAL', goodTilBlockTime = null, goodTilSeconds = null }) {
  if (!session) throw new Error('NOT_CONNECTED');
  if (!market?.ticker || !market?.raw) throw new Error('BAD_MARKET');
  const id = Number(clientId);
  if (!Number.isInteger(id) || id < 0) throw new Error('BAD_CLIENT_ID');

  const flags = String(orderFlags || 'CONDITIONAL').toUpperCase();
  if (flags !== 'CONDITIONAL' && flags !== 'LONG_TERM' && flags !== 'SHORT_TERM') {
    throw new Error('BAD_ORDER_FLAGS');
  }

  const expiryMs = Date.parse(String(goodTilBlockTime || ''));
  const seconds = Number.isFinite(expiryMs)
    ? Math.max(1, Math.round((expiryMs - Date.now()) / 1000))
    : Math.max(1, Math.round(Number(goodTilSeconds) || TPSL_GOOD_TIL_SECONDS));

  const sdk = await loadClient();
  let client;
  try {
    client = await ensureDydxClient();
  } catch {
    throw new Error('VALIDATOR_UNREACHABLE');
  }
  if (!session) throw new Error('NOT_CONNECTED');

  const stateful = flags !== 'SHORT_TERM';
  const result = await client.cancelOrder(
    session.subaccount,
    id,
    sdk.OrderFlags[flags],
    market.ticker,
    /* Exactly 0 for a stateful order, exactly non-zero for a short-term one.
       Neither may be `undefined` — see the header. */
    stateful ? 0 : undefined,
    stateful ? seconds : 0
  );
  const hash = result?.hash;
  return { hash: typeof hash === 'string' ? hash : hash?.toString?.() || null, clientId: id, orderFlags: flags };
}

/**
 * Cancel one untriggered conditional order.
 *
 * Kept as its own name because the TP/SL card calls it and because the caller
 * should not have to know that a trigger order is CONDITIONAL-flagged; it is
 * now a one-line specialisation of `cancelDydxOrder`, which is where the
 * goodTil rules live.
 */
export async function cancelDydxConditionalOrder({ market, clientId, goodTilBlockTime = null }) {
  return cancelDydxOrder({ market, clientId, orderFlags: 'CONDITIONAL', goodTilBlockTime });
}
