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
export const DYDX_BUILDER_FEE_PPM = 500; // 5 bps = 500 ppm
/* Kept for the server-side documentation and diagnostics; browser reads use
   the same-origin proxy below so the indexer never has to satisfy CORS. */
export const DYDX_INDEXER = 'https://indexer.dydx.trade';
const API_BASE = (typeof import.meta !== 'undefined' && import.meta.env?.VITE_API_BASE) || '/api';

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

const normaliseMarket = (m) => ({
  ticker: m.ticker,
  status: m.status,
  oraclePrice: Number(m.oraclePrice),
  priceChange24H: Number(m.priceChange24H || 0),
  volume24H: Number(m.volume24H || 0),
  openInterest: Number(m.openInterest || 0),
  nextFundingRate: Number(m.nextFundingRate || 0),
  atomicResolution: Number(m.atomicResolution),
  quantumConversionExponent: Number(m.quantumConversionExponent),
  stepBaseQuantums: Number(m.stepBaseQuantums),
  subticksPerTick: Number(m.subticksPerTick),
  clobPairId: String(m.clobPairId),
  raw: m
});

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
    /* Offline catalogue — the engine stays alive (and honestly labelled)
       when the indexer proxy is unreachable. */
    const fallback = (await import('./dydxOffline.js')).offlineDydxMarkets();
    return { markets: fallback.markets, live: false, offline: true };
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
  const safe = /^[A-Z0-9]+-[A-Z0-9]+$/.test(String(ticker || '')) ? String(ticker).toUpperCase() : '';
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
    /* Offline candles, labelled offline, so the chart teaches the product
       instead of rendering a dead flat line while the indexer is down. */
    const fallback = (await import('./dydxOffline.js')).offlineDydxCandles(safe, resolution, Number(limit) || 96);
    return {
      candles: fallback,
      live: false,
      offline: true,
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
    return {
      live: Number.isFinite(mid) && mid > 0,
      bestBid, bestAsk,
      spreadBps: mid > 0 ? ((bestAsk - bestBid) / mid) * 10_000 : null,
      bidDepth1Pct: sum(bids), askDepth1Pct: sum(asks)
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

/**
 * Create an in-memory dYdX signing session from the user's EVM signature.
 * The returned address should match the account generated by dydx.trade for
 * that EVM wallet. Nothing secret is written to localStorage or React state.
 */
export async function connectDydx(signer) {
  if (!signer?.signTypedData) throw new Error('NO_SIGNER');
  const signature = await signer.signTypedData(
    { name: 'dYdX Chain', chainId: 1 },
    { dYdX: [{ name: 'action', type: 'string' }] },
    { action: 'dYdX Chain Onboarding' }
  );

  const sdk = await loadClient();
  const { mnemonic } = sdk.onboarding.deriveHDKeyFromEthereumSignature(signature);
  try {
    const wallet = await sdk.LocalWallet.fromMnemonic(mnemonic, 'dydx');
    const client = await sdk.CompositeClient.connect(sdk.Network.mainnet());
    const subaccount = sdk.SubaccountInfo.forLocalWallet(wallet, 0);
    session = { sdk, wallet, client, subaccount, address: wallet.address };
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

/** Market/IOC order with our builder address and fee inside the signed order. */
export async function placeDydxOrder({ market, side, size, slippagePct = 0.5, reduceOnly = false, orderType = 'market', limitPrice: userPrice = null }) {
  if (!session) throw new Error('NOT_CONNECTED');
  if (!market?.ticker || !market?.raw) throw new Error('BAD_MARKET');
  const qty = Number(size);
  if (!Number.isFinite(qty) || qty <= 0) throw new Error('BAD_SIZE');
  const buy = side === 'buy';
  const sdkTmp = await loadClient();
  let limitPrice;
  let orderTypeEnum;
  let execution;
  if (orderType === 'limit' && userPrice != null && String(userPrice).trim() !== '') {
    const lp = Number(userPrice);
    if (!Number.isFinite(lp) || lp <= 0) throw new Error('BAD_PRICE');
    limitPrice = lp;
    orderTypeEnum = sdkTmp.OrderType.LIMIT;
    execution = sdkTmp.OrderExecution.GTC;
  } else {
    const slip = Number(slippagePct);
    if (!Number.isFinite(slip) || slip <= 0 || slip > 10) throw new Error('BAD_SLIPPAGE');
    limitPrice = market.oraclePrice * (1 + (buy ? 1 : -1) * slip / 100);
    orderTypeEnum = sdkTmp.OrderType.MARKET;
    execution = sdkTmp.OrderExecution.IOC;
  }
  const clientId = crypto.getRandomValues(new Uint32Array(1))[0];
  const { sdk, client, subaccount } = session;

  const result = await client.placeOrder(
    subaccount,
    market.ticker,
    orderTypeEnum,
    buy ? sdk.OrderSide.BUY : sdk.OrderSide.SELL,
    limitPrice,
    qty,
    clientId,
    undefined,
    undefined,
    execution,
    false,
    Boolean(reduceOnly),
    undefined,
    market.raw,
    undefined,
    undefined,
    'FBT Swap builder order',
    undefined,
    undefined,
    { builderAddress: DYDX_BUILDER_ADDRESS, feePpm: DYDX_BUILDER_FEE_PPM }
  );

  const hash = result?.hash;
  return {
    hash: typeof hash === 'string' ? hash : hash?.toString?.() || null,
    clientId,
    builderAddress: DYDX_BUILDER_ADDRESS,
    feePpm: DYDX_BUILDER_FEE_PPM
  };
}
