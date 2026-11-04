/**
 * HYPERLIQUID — RISK CAPS (pure, no network, no clock)
 * ---------------------------------------------------------------------------
 * Every money-moving phase must pass through `checkOrderAgainstCaps`. Nothing
 * places orders yet, so nothing calls this; it exists so the first order cannot
 * be written without a cap check in front of it.
 *
 * Defaults are the owner's chosen values: a 20,000 USD per-order cap, the same
 * 20,000 USD as the total exposure ceiling, and a 1,000 USD daily loss stop.
 * Every value is overridable through capsSettings.js, which refuses incoherent
 * combinations (for example, total exposure below the per-order cap).
 *
 * Loss accounting is deliberately conservative:
 *   - the daily loss counts realised losses PLUS open unrealised losses;
 *   - unrealised GAINS are never counted, so they cannot hide a loss;
 *   - every order carries its own stop-loss, and its worst-case loss
 *     (notional × stop distance) must fit inside the daily budget that is
 *     still left. Otherwise the order is refused before it is sent.
 */

export const HL_CAP_DEFAULTS = Object.freeze({
  /** Hard ceiling on total notional open at once across the account. */
  totalExposureUsd: 20000,
  /** Largest single order notional. Equal to the total ceiling by owner choice. */
  maxOrderUsd: 20000,
  /** Stop placing new orders for the rest of the day once loss hits this. */
  dailyLossUsd: 1000,
  /** Leverage ceiling for any order. 2x: margin = notional / 2. */
  maxLeverage: 2,
  /** Widest stop-loss distance (fraction of notional) an order may use. */
  maxStopLossPct: 0.05,
  /** Only these markets may be traded. Empty list means nothing is allowed. */
  allowedCoins: Object.freeze(['BTC', 'ETH']),
  /** Global kill switch. When true, every order is refused. */
  killSwitch: false
});

export const HL_CAP_CODES = Object.freeze({
  KILL_SWITCH: 'HL_CAP_KILL_SWITCH',
  COIN_NOT_ALLOWED: 'HL_CAP_COIN_NOT_ALLOWED',
  ORDER_TOO_LARGE: 'HL_CAP_ORDER_TOO_LARGE',
  EXPOSURE_EXCEEDED: 'HL_CAP_EXPOSURE_EXCEEDED',
  LEVERAGE_TOO_HIGH: 'HL_CAP_LEVERAGE_TOO_HIGH',
  DAILY_LOSS_REACHED: 'HL_CAP_DAILY_LOSS_REACHED',
  STOP_LOSS_MISSING: 'HL_CAP_STOP_LOSS_MISSING',
  STOP_LOSS_TOO_WIDE: 'HL_CAP_STOP_LOSS_TOO_WIDE',
  STOP_LOSS_OVER_BUDGET: 'HL_CAP_STOP_LOSS_OVER_BUDGET',
  BAD_INPUT: 'HL_CAP_BAD_INPUT'
});

/**
 * @param {object} order  { coin, notionalUsd, leverage, stopLossPct }
 *                        stopLossPct is the stop distance as a fraction (0.05 = 5%)
 * @param {object} state  { currentExposureUsd, dailyRealisedPnlUsd,
 *                          dailyUnrealisedPnlUsd }  (realised PnL is negative on loss)
 * @param {object} caps   partial override of HL_CAP_DEFAULTS
 */
export function checkOrderAgainstCaps(order, state, caps = {}) {
  const c = { ...HL_CAP_DEFAULTS, ...caps };
  if (c.killSwitch) return { ok: false, code: HL_CAP_CODES.KILL_SWITCH };

  // Fail closed: a missing value is UNKNOWN, not zero. Treating unknown as zero
  // would let an order through exactly when the data is missing.
  const isNum = (v) => v !== null && v !== undefined && v !== '' && Number.isFinite(Number(v));
  const notional = isNum(order?.notionalUsd) ? Number(order.notionalUsd) : NaN;
  const leverage = isNum(order?.leverage) ? Number(order.leverage) : NaN;
  const exposure = isNum(state?.currentExposureUsd) ? Number(state.currentExposureUsd) : NaN;
  const realised = isNum(state?.dailyRealisedPnlUsd) ? Number(state.dailyRealisedPnlUsd) : NaN;
  const unrealised = isNum(state?.dailyUnrealisedPnlUsd) ? Number(state.dailyUnrealisedPnlUsd) : NaN;
  if (!order?.coin || !(notional > 0) || !(leverage > 0) || !(exposure >= 0)
      || !Number.isFinite(realised) || !Number.isFinite(unrealised)) {
    return { ok: false, code: HL_CAP_CODES.BAD_INPUT };
  }

  // A stop is mandatory. Missing, zero, negative or non-numeric means no stop.
  const stopLossPct = isNum(order?.stopLossPct) ? Number(order.stopLossPct) : NaN;
  if (!(stopLossPct > 0)) return { ok: false, code: HL_CAP_CODES.STOP_LOSS_MISSING };
  if (stopLossPct > c.maxStopLossPct) return { ok: false, code: HL_CAP_CODES.STOP_LOSS_TOO_WIDE };

  if (!c.allowedCoins.includes(order.coin)) return { ok: false, code: HL_CAP_CODES.COIN_NOT_ALLOWED };
  if (leverage > c.maxLeverage) return { ok: false, code: HL_CAP_CODES.LEVERAGE_TOO_HIGH };
  if (notional > c.maxOrderUsd) return { ok: false, code: HL_CAP_CODES.ORDER_TOO_LARGE };
  if (exposure + notional > c.totalExposureUsd) return { ok: false, code: HL_CAP_CODES.EXPOSURE_EXCEEDED };

  // Loss so far today: realised losses plus open unrealised losses. Gains are
  // not netted in, so an open profit cannot hide a realised loss.
  const dailyLimit = Math.abs(c.dailyLossUsd);
  const lossSoFar = Math.max(0, -(realised + Math.min(0, unrealised)));
  if (lossSoFar >= dailyLimit) return { ok: false, code: HL_CAP_CODES.DAILY_LOSS_REACHED };

  // The new order's worst case (stop hit) must still fit in what is left of the day.
  const worstCaseLoss = notional * stopLossPct;
  if (lossSoFar + worstCaseLoss > dailyLimit) {
    return { ok: false, code: HL_CAP_CODES.STOP_LOSS_OVER_BUDGET };
  }

  return { ok: true, code: null };
}
