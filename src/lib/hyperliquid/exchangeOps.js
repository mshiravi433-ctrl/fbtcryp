/**
 * HYPERLIQUID — ORDER FORMATTING, ACTIONS, AND THE EXECUTOR (mainnet)
 * ---------------------------------------------------------------------------
 * The only file in the app that sends money-moving requests. It is called
 * ONLY after a user has approved one specific intent (engine.js). Before the
 * first request it re-checks caps against freshly read account state, and it
 * fails closed on anything it cannot read.
 *
 * Execution order for one approved intent:
 *   1. set leverage (cross)
 *   2. entry: IOC limit at mid ± slippage (fills now or not at all)
 *   3. stop-loss: reduce-only trigger order at the fill price ± stop distance
 *   4. if step 3 fails, the position is closed at once (reduce-only IOC),
 *      so an open position never lives without a stop.
 *
 * Formatting follows the SDK: prices use 5 significant figures and at most
 * (6 - szDecimals) decimals; sizes use szDecimals decimals.
 */

import { signL1Action } from './signing.js';
import { checkOrderAgainstCaps } from './caps.js';
import { HL_ERRORS } from './readonly.js';

export const HL_EXCHANGE_URL = 'https://api.hyperliquid.xyz/exchange';
export const HL_MIN_ORDER_USD = 10;
export const HL_DEFAULT_SLIPPAGE = 0.003;

export const HL_EXEC_CODES = Object.freeze({
  CAPS_REFUSED: 'HL_EXEC_CAPS_REFUSED',
  UNKNOWN_MARKET: 'HL_EXEC_UNKNOWN_MARKET',
  NO_PRICE: 'HL_EXEC_NO_PRICE',
  TOO_SMALL: 'HL_EXEC_TOO_SMALL',
  LEVERAGE_FAILED: 'HL_EXEC_LEVERAGE_FAILED',
  NOT_FILLED: 'HL_EXEC_NOT_FILLED',
  STOP_FAILED_CLOSED: 'HL_EXEC_STOP_FAILED_CLOSED',
  STOP_FAILED_OPEN: 'HL_EXEC_STOP_FAILED_OPEN',
  NETWORK: 'HL_EXEC_NETWORK',
  REJECTED: 'HL_EXEC_REJECTED'
});

/** Price rounding exactly as the SDK does it: 5 significant figures, then decimals. */
export function roundPrice(px, szDecimals) {
  const sig = Number(Number(px).toPrecision(5));
  const decimals = Math.max(0, 6 - szDecimals);
  return Number(sig.toFixed(decimals));
}

export function roundSize(sz, szDecimals) {
  return Number(Number(sz).toFixed(szDecimals));
}

/** Wire string, no trailing zeros: 30000 → "30000", 0.0100 → "0.01". */
export function toWire(x) {
  const fixed = Number(x).toFixed(8);
  const trimmed = fixed.replace(/\.?0+$/, '');
  return trimmed === '-0' ? '0' : trimmed;
}

export function orderAction({ asset, isBuy, px, sz, reduceOnly = false, tif = 'Ioc' }) {
  return {
    type: 'order',
    orders: [{
      a: asset,
      b: isBuy,
      p: toWire(px),
      s: toWire(sz),
      r: reduceOnly,
      t: { limit: { tif } }
    }],
    grouping: 'na'
  };
}

/** Stop-loss: a reduce-only trigger that becomes a market order when hit. */
export function stopAction({ asset, isBuy, triggerPx, sz }) {
  return {
    type: 'order',
    orders: [{
      a: asset,
      b: isBuy,
      p: toWire(triggerPx),
      s: toWire(sz),
      r: true,
      t: { trigger: { isMarket: true, triggerPx: toWire(triggerPx), tpsl: 'sl' } }
    }],
    grouping: 'na'
  };
}

export function leverageAction({ asset, leverage }) {
  return { type: 'updateLeverage', asset, isCross: true, leverage };
}

/** Monotonic nonces: milliseconds, never repeated or going backwards. */
export function makeNonceSource(clock = () => Date.now()) {
  let last = 0;
  return () => {
    last = Math.max(clock(), last + 1);
    return last;
  };
}

/** Reads the per-order statuses out of an /exchange response. */
export function parseOrderStatuses(response) {
  if (!response || response.status !== 'ok') {
    return [{ kind: 'error', error: typeof response?.response === 'string' ? response.response : 'REJECTED' }];
  }
  const statuses = response?.response?.data?.statuses;
  if (!Array.isArray(statuses) || statuses.length === 0) return [{ kind: 'error', error: 'NO_STATUS' }];
  return statuses.map((s) => {
    if (s && typeof s === 'object' && s.filled) {
      return { kind: 'filled', oid: s.filled.oid, totalSz: Number(s.filled.totalSz), avgPx: Number(s.filled.avgPx) };
    }
    if (s && typeof s === 'object' && s.resting) return { kind: 'resting', oid: s.resting.oid };
    if (s && typeof s === 'object' && typeof s.error === 'string') return { kind: 'error', error: s.error };
    return { kind: 'error', error: 'UNKNOWN_STATUS' };
  });
}

/** Signs and posts one L1 action. Returns the parsed response or an error code. */
export async function postL1Action(privateKey, action, nonce, {
  fetchImpl = globalThis.fetch,
  url = HL_EXCHANGE_URL,
  timeoutMs = 10000,
  isMainnet = true
} = {}) {
  if (typeof fetchImpl !== 'function') return { ok: false, code: HL_ERRORS.NETWORK };
  let signature;
  try {
    signature = await signL1Action(privateKey, action, nonce, { isMainnet });
  } catch {
    return { ok: false, code: HL_EXEC_CODES.REJECTED };
  }
  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
  try {
    const res = await fetchImpl(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action, nonce, signature, vaultAddress: null }),
      signal: controller?.signal
    });
    if (res.status === 429) return { ok: false, code: HL_ERRORS.RATE_LIMITED };
    if (!res.ok) return { ok: false, code: HL_ERRORS.HTTP_ERROR, status: res.status };
    const data = await res.json();
    return { ok: true, data };
  } catch (cause) {
    if (cause?.name === 'AbortError') return { ok: false, code: HL_ERRORS.TIMEOUT };
    return { ok: false, code: HL_EXEC_CODES.NETWORK };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Executes ONE approved intent. Every step is explicit and every failure is
 * reported; nothing here guesses.
 *
 * @param {object} args
 * @param {string} args.privateKey      agent key, session memory only
 * @param {object} args.intent          { coin, side: 'long'|'short', notionalUsd, leverage, stopLossPct }
 * @param {object} args.market          { asset, szDecimals } from meta
 * @param {number} args.mid             current mid price
 * @param {object} args.caps            caps settings (HL_CAP_DEFAULTS shape)
 * @param {object} args.state           fresh { currentExposureUsd, dailyRealisedPnlUsd, dailyUnrealisedPnlUsd }
 * @param {function} args.nextNonce     from makeNonceSource()
 */
export async function executeIntent({
  privateKey, intent, market, mid, caps, state, nextNonce,
  fetchImpl, isMainnet = true, slippage = HL_DEFAULT_SLIPPAGE
}) {
  const net = { fetchImpl, isMainnet };
  const report = { ok: false, code: null, entry: null, stop: null, closed: false, steps: [] };

  // Fail closed: caps are checked again against state read just before this call.
  const verdict = checkOrderAgainstCaps(
    { coin: intent.coin, notionalUsd: intent.notionalUsd, leverage: intent.leverage, stopLossPct: intent.stopLossPct },
    state, caps
  );
  if (!verdict.ok) return { ...report, code: HL_EXEC_CODES.CAPS_REFUSED, capsCode: verdict.code };
  if (!market || !Number.isInteger(market.asset) || !Number.isInteger(market.szDecimals)) {
    return { ...report, code: HL_EXEC_CODES.UNKNOWN_MARKET };
  }
  if (!(mid > 0)) return { ...report, code: HL_EXEC_CODES.NO_PRICE };

  const isBuy = intent.side === 'long';
  const sz = roundSize(intent.notionalUsd / mid, market.szDecimals);
  if (!(sz > 0) || sz * mid < HL_MIN_ORDER_USD) return { ...report, code: HL_EXEC_CODES.TOO_SMALL };

  // 1. leverage
  const lev = await postL1Action(privateKey, leverageAction({ asset: market.asset, leverage: intent.leverage }), nextNonce(), net);
  report.steps.push({ step: 'leverage', ok: lev.ok && lev.data?.status === 'ok' });
  if (!lev.ok || lev.data?.status !== 'ok') return { ...report, code: HL_EXEC_CODES.LEVERAGE_FAILED };

  // 2. entry: IOC limit at mid ± slippage
  const entryPx = roundPrice(isBuy ? mid * (1 + slippage) : mid * (1 - slippage), market.szDecimals);
  const entry = await postL1Action(privateKey, orderAction({ asset: market.asset, isBuy, px: entryPx, sz, tif: 'Ioc' }), nextNonce(), net);
  if (!entry.ok) return { ...report, code: entry.code, steps: [...report.steps, { step: 'entry', ok: false }] };
  const entryStatus = parseOrderStatuses(entry.data)[0];
  report.steps.push({ step: 'entry', ok: entryStatus.kind === 'filled' });
  if (entryStatus.kind !== 'filled' || !(entryStatus.totalSz > 0)) {
    return { ...report, code: HL_EXEC_CODES.NOT_FILLED, entry: entryStatus };
  }
  report.entry = entryStatus;

  // 3. stop-loss on the real filled size and price
  const filledSz = roundSize(entryStatus.totalSz, market.szDecimals);
  const stopPx = roundPrice(isBuy ? entryStatus.avgPx * (1 - intent.stopLossPct) : entryStatus.avgPx * (1 + intent.stopLossPct), market.szDecimals);
  const stop = await postL1Action(privateKey, stopAction({ asset: market.asset, isBuy: !isBuy, triggerPx: stopPx, sz: filledSz }), nextNonce(), net);
  const stopStatus = stop.ok ? parseOrderStatuses(stop.data)[0] : { kind: 'error', error: stop.code };
  const stopPlaced = stopStatus.kind === 'resting' || stopStatus.kind === 'filled';
  report.steps.push({ step: 'stop', ok: stopPlaced });
  if (stopPlaced) {
    report.stop = { oid: stopStatus.oid, triggerPx: stopPx };
    return { ...report, ok: true, code: null };
  }

  // 4. the stop failed: close the position now, so it does not stay unprotected
  const closePx = roundPrice(isBuy ? entryStatus.avgPx * (1 - slippage) : entryStatus.avgPx * (1 + slippage), market.szDecimals);
  const close = await postL1Action(privateKey, orderAction({ asset: market.asset, isBuy: !isBuy, px: closePx, sz: filledSz, reduceOnly: true, tif: 'Ioc' }), nextNonce(), net);
  const closeStatus = close.ok ? parseOrderStatuses(close.data)[0] : { kind: 'error' };
  const closed = closeStatus.kind === 'filled';
  report.steps.push({ step: 'close-after-stop-failure', ok: closed });
  return {
    ...report,
    closed,
    code: closed ? HL_EXEC_CODES.STOP_FAILED_CLOSED : HL_EXEC_CODES.STOP_FAILED_OPEN,
    stopError: stopStatus.error || null
  };
}

