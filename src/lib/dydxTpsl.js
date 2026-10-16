/**
 * dYdX take-profit / stop-loss — PURE planning and validation.
 *
 * Nothing in this file touches the network, the SDK, a wallet or storage. It
 * turns a position and two optional prices into the exact conditional-order
 * legs the user is asked to sign, and it refuses — with a named code — every
 * combination that would be wrong on the venue. `src/lib/dydx.js` is the only
 * caller that turns a leg into a signed transaction, and only from a click.
 *
 * ─── TRIGGER SEMANTICS (dYdX Chain, SDK 3.4.0) ───────────────────────────────
 * A conditional order fires when the ORACLE price crosses its trigger:
 *   · stop-loss  SELL (closes a long)   fires when oracle ≤ trigger  → trigger BELOW price
 *   · take-profit SELL (closes a long)  fires when oracle ≥ trigger  → trigger ABOVE price
 *   · stop-loss  BUY  (closes a short)  fires when oracle ≥ trigger  → trigger ABOVE price
 *   · take-profit BUY  (closes a short) fires when oracle ≤ trigger  → trigger BELOW price
 * This is what dYdX's own help centre describes for stop-market and take-profit
 * orders, and what `validateTpSl` enforces below.
 *
 * ─── ROUNDING ────────────────────────────────────────────────────────────────
 * A trigger must sit on the market's tick. Each price is moved to the tick in
 * the direction that puts it FARTHER from the current price, so the rounded
 * trigger is never closer to the market than the one the user typed:
 *   · long  TP → round UP      · long  SL → round DOWN
 *   · short TP → round DOWN    · short SL → round UP
 * Rounding moves a trigger by at most one tick, and the preview shows the
 * rounded value that will actually be signed.
 *
 * ─── WHAT THIS IS NOT ────────────────────────────────────────────────────────
 * The PnL figures are an ESTIMATE at the trigger price: no fees, no funding,
 * no slippage beyond the limit the leg carries. They are labelled «تخمینی» in
 * the UI and must never be shown as a firm outcome.
 */

/** Conditional orders must carry a lifetime; this is the one we ask for (28 days). */
export const TPSL_GOOD_TIL_SECONDS = 28 * 24 * 60 * 60;

export const TPSL_KIND = Object.freeze({ TP: 'tp', SL: 'sl' });
export const TPSL_EXECUTION = Object.freeze({ MARKET: 'market', LIMIT: 'limit' });

/** SDK order-type names (`OrderType` in v4-client-js) for each leg. */
export const TPSL_SDK_TYPE = Object.freeze({
  tp: Object.freeze({ market: 'TAKE_PROFIT_MARKET', limit: 'TAKE_PROFIT_LIMIT' }),
  sl: Object.freeze({ market: 'STOP_MARKET', limit: 'STOP_LIMIT' })
});

/** Error codes the UI maps to copy (`dydx.tpsl.err.*`). Never raw text. */
export const TPSL_ERRORS = Object.freeze({
  NO_LEG: 'NO_LEG',
  BAD_SIZE: 'BAD_SIZE',
  BAD_PRICE: 'BAD_PRICE',
  NO_CURRENT_PRICE: 'NO_CURRENT_PRICE',
  TICK_UNKNOWN: 'TICK_UNKNOWN',
  TRIGGER_PASSED: 'TRIGGER_PASSED',
  LIMIT_PRICE_INVALID: 'LIMIT_PRICE_INVALID',
  BAD_POSITION_SIDE: 'BAD_POSITION_SIDE'
});

const isPos = (n) => Number.isFinite(n) && n > 0;
const toNum = (v) => {
  if (v === null || v === undefined) return NaN;
  if (typeof v === 'string' && v.trim() === '') return NaN;
  return Number(v);
};

/**
 * Number of decimals in a tick like "0.01" or "1". Returns null for anything
 * that is not a positive decimal, so the caller can refuse instead of guessing.
 */
export function tickDecimals(tickSize) {
  const text = String(tickSize ?? '').trim();
  if (!/^(\d+\.?\d*|\.\d+)$/.test(text)) return null;
  const tick = Number(text);
  if (!isPos(tick)) return null;
  const dot = text.indexOf('.');
  return dot === -1 ? 0 : text.length - dot - 1;
}

/**
 * The rounding direction for a leg. See the header: always AWAY from the market.
 * Returns 'up' or 'down', or null for an unknown position side.
 */
export function roundingFor({ positionSide, kind }) {
  const long = positionSide === 'LONG';
  const short = positionSide === 'SHORT';
  if (!long && !short) return null;
  if (kind === TPSL_KIND.TP) return long ? 'up' : 'down';
  if (kind === TPSL_KIND.SL) return long ? 'down' : 'up';
  return null;
}

/**
 * Move `price` onto the tick in the given direction.
 * The division is nudged by 1e-6 ticks before ceil/floor so that a price which
 * is already on the tick (e.g. 65000.1 on a 0.1 tick) does not jump by a tick
 * because of binary floating-point noise.
 */
export function roundToTick(price, tickSize, mode) {
  const decimals = tickDecimals(tickSize);
  const tick = Number(tickSize);
  const p = toNum(price);
  if (decimals === null || !isPos(p) || (mode !== 'up' && mode !== 'down')) return null;
  const steps = Math.round((p / tick) * 1e6) / 1e6;
  const index = mode === 'up' ? Math.ceil(steps) : Math.floor(steps);
  return Number((index * tick).toFixed(decimals));
}

/** Price-with-slippage for a market-execution leg (the limit the SDK receives). */
export function executionPriceFor({ triggerPrice, sellSide, slippagePct }) {
  const slip = toNum(slippagePct);
  if (!isPos(triggerPrice) || !Number.isFinite(slip) || slip <= 0 || slip > 10) return null;
  return triggerPrice * (sellSide ? 1 - slip / 100 : 1 + slip / 100);
}

/**
 * Plan and validate a TP/SL request for one open position.
 *
 * @param {object} input
 * @param {'LONG'|'SHORT'} input.positionSide
 * @param {number|string}  input.size          absolute position size (base units)
 * @param {number|string}  input.entryPrice    for the estimate only
 * @param {number|string}  input.currentPrice  oracle price now
 * @param {string}         input.tickSize      market tick, e.g. "1" or "0.1"
 * @param {number|string|null} input.tp        take-profit trigger, optional
 * @param {number|string|null} input.sl        stop-loss trigger, optional
 * @param {'market'|'limit'} [input.execution='market']
 * @param {number|string|null} [input.tpLimit] limit price for a TP limit leg
 * @param {number|string|null} [input.slLimit] limit price for an SL limit leg
 * @param {number|string}  [input.slippagePct=0.5] for market legs
 * @returns {{ ok: boolean, errors: string[], legErrors: {kind:string,code:string}[],
 *            legs: object[], estimates: object[] }}
 */
export function validateTpSl(input = {}) {
  const errors = [];
  const legErrors = [];
  const legs = [];
  const estimates = [];
  const { positionSide } = input;
  const long = positionSide === 'LONG';
  const short = positionSide === 'SHORT';
  const execution = input.execution === TPSL_EXECUTION.LIMIT ? TPSL_EXECUTION.LIMIT : TPSL_EXECUTION.MARKET;
  const optional = (v) => (v === null || v === undefined || v === '' ? null : toNum(v));
  const size = toNum(input.size);
  const entry = toNum(input.entryPrice);
  const current = toNum(input.currentPrice);
  const tp = optional(input.tp);
  const sl = optional(input.sl);
  const tpLimit = optional(input.tpLimit);
  const slLimit = optional(input.slLimit);

  if (!long && !short) errors.push(TPSL_ERRORS.BAD_POSITION_SIDE);
  if (!isPos(size)) errors.push(TPSL_ERRORS.BAD_SIZE);
  if (!isPos(current)) errors.push(TPSL_ERRORS.NO_CURRENT_PRICE);
  if (tickDecimals(input.tickSize) === null) errors.push(TPSL_ERRORS.TICK_UNKNOWN);
  if (tp === null && sl === null) errors.push(TPSL_ERRORS.NO_LEG);
  if (tp !== null && !isPos(tp)) errors.push(TPSL_ERRORS.BAD_PRICE);
  if (sl !== null && !isPos(sl)) errors.push(TPSL_ERRORS.BAD_PRICE);
  if (errors.length) {
    return { ok: false, errors: [...new Set(errors)], legErrors, legs, estimates };
  }

  /* Both legs close the position: a long is closed by SELL, a short by BUY. */
  const sellSide = long;

  const planLeg = (kind, raw, limitRaw) => {
    const mode = roundingFor({ positionSide, kind });
    const trigger = roundToTick(raw, input.tickSize, mode);
    if (trigger === null) {
      legErrors.push({ kind, code: TPSL_ERRORS.TICK_UNKNOWN });
      return;
    }
    /* Which side of the market the trigger must sit on:
       long TP above, long SL below, short TP below, short SL above. */
    const wantAbove = (kind === TPSL_KIND.TP) === long;
    if (wantAbove ? trigger <= current : trigger >= current) {
      /* The market is already on or past this trigger: it would fire at once
         (or never). Refuse, with the reason, instead of sending it. */
      legErrors.push({ kind, code: TPSL_ERRORS.TRIGGER_PASSED });
      return;
    }
    let limitPrice;
    if (execution === TPSL_EXECUTION.LIMIT) {
      const lim = limitRaw === null ? NaN : Number(limitRaw);
      /* Sell legs fill at or above their limit, so the limit must not sit above
         the trigger; buy legs fill at or below theirs, so it must not sit below it. */
      const fits = isPos(lim) && (sellSide ? lim <= trigger : lim >= trigger);
      if (!fits) {
        legErrors.push({ kind, code: TPSL_ERRORS.LIMIT_PRICE_INVALID });
        return;
      }
      limitPrice = Number(lim.toFixed(tickDecimals(input.tickSize)));
    } else {
      const exec = executionPriceFor({ triggerPrice: trigger, sellSide, slippagePct: input.slippagePct ?? 0.5 });
      if (exec === null) {
        legErrors.push({ kind, code: TPSL_ERRORS.BAD_PRICE });
        return;
      }
      limitPrice = Number(exec.toFixed(tickDecimals(input.tickSize)));
    }
    legs.push({
      kind,
      execution,
      sdkType: TPSL_SDK_TYPE[kind][execution],
      side: sellSide ? 'SELL' : 'BUY',
      requestedTrigger: Number(raw),
      triggerPrice: trigger,
      limitPrice,
      size,
      reduceOnly: true,
      roundedBy: Number((trigger - Number(raw)).toFixed(12))
    });
    /* Estimate at the trigger: no fees, no funding. Long gains as price rises. */
    const move = trigger - entry;
    const pnl = (long ? move : -move) * size;
    const notional = entry * size;
    estimates.push({
      kind,
      triggerPrice: trigger,
      pnlUsd: Number.isFinite(pnl) ? pnl : null,
      pnlPct: Number.isFinite(pnl) && notional > 0 ? (pnl / notional) * 100 : null
    });
  };

  if (tp !== null) planLeg(TPSL_KIND.TP, tp, tpLimit);
  if (sl !== null) planLeg(TPSL_KIND.SL, sl, slLimit);
  const unique = [...new Set(legErrors.map((e) => e.code))];
  return {
    ok: legErrors.length === 0 && legs.length > 0,
    errors: unique,
    legErrors,
    legs,
    estimates
  };
}

/**
 * Human-facing summary of a plan, for the preview card. Pure, so the same
 * numbers appear in the preview and in the signed request.
 */
export function describeTpSlPlan(plan) {
  if (!plan?.ok) return null;
  return {
    legCount: plan.legs.length,
    legs: plan.legs.map((l) => ({
      kind: l.kind,
      triggerPrice: l.triggerPrice,
      limitPrice: l.limitPrice,
      execution: l.execution,
      side: l.side,
      size: l.size,
      roundedBy: l.roundedBy
    })),
    estimates: plan.estimates
  };
}
