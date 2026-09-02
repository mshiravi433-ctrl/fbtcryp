/**
 * FBT FUTURES — browser client for /api/v1/futures (spec §19).
 * ---------------------------------------------------------------------------
 * Thin, same-origin, and honest: every function returns the server's envelope
 * (`{ ok, data, meta }` or `{ ok:false, error }`) and NEVER falls back to an
 * offline catalogue. A leveraged order screen that draws a saved price is a
 * liquidation waiting to happen, so when the backend says UNAVAILABLE the tab
 * says UNAVAILABLE. The fee, balance, risk and route on screen are the
 * backend's numbers; this file computes none of them.
 */
import { makeFuturesRequestId, makeFuturesIdempotencyKey } from './futures-engine/ids.js';

const API_BASE = (typeof import.meta !== 'undefined' && import.meta.env?.VITE_API_BASE) || '/api';
const ROOT = `${API_BASE}/v1/futures`;

const DEVICE_KEY = 'fbt-device-id';
function deviceId() {
  try {
    let id = localStorage.getItem(DEVICE_KEY);
    if (!id || !/^[A-Za-z0-9_-]{8,64}$/.test(id)) {
      const bytes = new Uint8Array(16);
      crypto.getRandomValues(bytes);
      id = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
      localStorage.setItem(DEVICE_KEY, id);
    }
    return id;
  } catch { return null; }
}

async function call(path, { method = 'GET', body = null, headers = {}, timeout = 15_000 } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  try {
    const dev = deviceId();
    const res = await fetch(`${ROOT}${path}`, {
      method,
      signal: ctrl.signal,
      headers: { accept: 'application/json', ...(body ? { 'content-type': 'application/json' } : {}), ...(dev ? { 'x-fbt-device': dev } : {}), ...headers },
      body: body ? JSON.stringify(body) : undefined
    });
    let json = null;
    try { json = await res.json(); } catch { json = null; }
    if (!json) return { ok: false, status: res.status, error: { code: res.status === 429 ? 'RATE_LIMITED' : 'PROVIDER_UNAVAILABLE', retryable: true } };
    return { status: res.status, ...json };
  } catch (err) {
    return { ok: false, status: 0, error: { code: err?.name === 'AbortError' ? 'TIMEOUT' : 'PROVIDER_UNAVAILABLE', retryable: true } };
  } finally {
    clearTimeout(timer);
  }
}

/* ── reads ──────────────────────────────────────────────────────────────── */
export const getFuturesProviders = () => call('/providers');
export const getFuturesHealth = () => call('/health');
export const getFuturesMarkets = (provider = 'ostium') => call(`/markets?provider=${encodeURIComponent(provider)}`);
export const getFuturesCandles = ({ provider = 'ostium', market, resolution = '60', limit = 96 } = {}) =>
  call(`/candles?provider=${encodeURIComponent(provider)}&market=${encodeURIComponent(market)}&resolution=${encodeURIComponent(resolution)}&limit=${Number(limit) || 96}`);
export const getFuturesFunding = (provider = 'ostium') => call(`/funding?provider=${encodeURIComponent(provider)}`);
export const getFuturesOpenInterest = (provider = 'ostium') => call(`/open-interest?provider=${encodeURIComponent(provider)}`);
export const getFuturesPositions = (wallet, provider = 'ostium') => call(`/positions/${encodeURIComponent(wallet)}?provider=${encodeURIComponent(provider)}`);
export const getFuturesAccount = (wallet, provider = 'ostium') => call(`/account/${encodeURIComponent(wallet)}?provider=${encodeURIComponent(provider)}`);
export const getFuturesFeePreview = ({ provider = 'ostium', collateralUsd, leverage, market = null, policy = null } = {}) =>
  call(`/fees?provider=${encodeURIComponent(provider)}&collateral=${encodeURIComponent(collateralUsd)}&leverage=${encodeURIComponent(leverage)}${market ? `&market=${encodeURIComponent(market)}` : ''}${policy ? `&policy=${encodeURIComponent(policy)}` : ''}`);
export const getFuturesExecutions = (wallet) => call(`/executions/${encodeURIComponent(wallet)}`);
export const getFuturesFeeLedger = (wallet = null) => call(`/fees/ledger${wallet ? `?wallet=${encodeURIComponent(wallet)}` : ''}`);

/* ── quote / risk / prepare / verify ───────────────────────────────────── */
export const quoteFutures = (order) => call('/quote', { method: 'POST', body: { requestId: makeFuturesRequestId(), ...order } });
export const riskFutures = (order) => call('/risk', { method: 'POST', body: { requestId: makeFuturesRequestId(), ...order } });
export const simulateFutures = (order) => call('/simulate', { method: 'POST', body: { requestId: makeFuturesRequestId(), ...order }, timeout: 25_000 });

/**
 * Build the unsigned open-position transaction(s). The idempotency key is
 * content-derived so a double tap replays the same execution instead of
 * building a second one; `nonce` lets a user intentionally open twice.
 */
export function prepareFutures(order, { nonce = '' } = {}) {
  const idempotencyKey = makeFuturesIdempotencyKey({
    action: 'open', wallet: order.wallet, providerId: order.provider, marketId: order.market, side: order.side,
    collateralUsd: order.collateralUsd, leverage: order.leverage, nonce
  });
  return call('/prepare', { method: 'POST', body: { requestId: makeFuturesRequestId(), ...order, idempotencyKey }, headers: { 'idempotency-key': idempotencyKey }, timeout: 25_000 });
}

export const verifyFutures = ({ executionId, txHash = null, status = null }) =>
  call('/verify', { method: 'POST', body: { executionId, txHash, status }, timeout: 20_000 });

/** Position management: increase | decrease | close | tp | sl. */
export function manageFuturesPosition({ positionId, action, wallet, provider = 'ostium', value = null, closePercent = null, amountUsd = null, slippageBps = null, nonce = '' }) {
  const idempotencyKey = makeFuturesIdempotencyKey({
    action, wallet, providerId: provider, marketId: positionId, side: action, collateralUsd: amountUsd ?? closePercent ?? value ?? '', leverage: '', positionId, nonce
  });
  return call(`/positions/${encodeURIComponent(positionId)}/${encodeURIComponent(action)}`, {
    method: 'POST',
    body: { requestId: makeFuturesRequestId(), wallet, provider, value, closePercent, amountUsd, slippageBps, idempotencyKey },
    headers: { 'idempotency-key': idempotencyKey },
    timeout: 25_000
  });
}

export { API_BASE as FUTURES_API_BASE };
