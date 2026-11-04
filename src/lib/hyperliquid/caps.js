/**
 * HYPERLIQUID — RISK CAPS (pure, no network, no clock)
 * ---------------------------------------------------------------------------
 * Every money-moving phase must pass through `checkOrderAgainstCaps`. Phase 0
 * does not place orders, so nothing calls this yet; it exists so the first
 * order cannot be written without a cap check in front of it.
 *
 * Defaults are deliberately smaller than the total budget. The total exposure
 * cap is the ceiling for the whole account; the per-order and daily loss caps
 * decide how much one bad run can cost. All values are overridable, and the
 * owner should confirm them before any live phase.
 */

export const HL_CAP_DEFAULTS = Object.freeze({
  /** Hard ceiling on total notional open at once across the account. */
  totalExposureUsd: 1000,
  /** Largest single order notional. Kept well under the total ceiling. */
  maxOrderUsd: 25,
  /** Stop placing new orders for the rest of the day once realised loss hits this. */
  dailyLossUsd: 50,
  /** Leverage ceiling for any order. */
  maxLeverage: 3,
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
  BAD_INPUT: 'HL_CAP_BAD_INPUT'
});

/**
 * @param {object} order  { coin, notionalUsd, leverage }
 * @param {object} state  { currentExposureUsd, dailyRealisedPnlUsd }
 * @param {object} caps   partial override of HL_CAP_DEFAULTS
 */
export function checkOrderAgainstCaps(order, state, caps = {}) {
  const c = { ...HL_CAP_DEFAULTS, ...caps };
  if (c.killSwitch) return { ok: false, code: HL_CAP_CODES.KILL_SWITCH };

  // Fail closed: a missing exposure or daily PnL is UNKNOWN, not zero. Treating
  // unknown as zero would let an order through exactly when the data is missing.
  const isNum = (v) => v !== null && v !== undefined && v !== '' && Number.isFinite(Number(v));
  const notional = isNum(order?.notionalUsd) ? Number(order.notionalUsd) : NaN;
  const leverage = isNum(order?.leverage) ? Number(order.leverage) : NaN;
  const exposure = isNum(state?.currentExposureUsd) ? Number(state.currentExposureUsd) : NaN;
  const dailyPnl = isNum(state?.dailyRealisedPnlUsd) ? Number(state.dailyRealisedPnlUsd) : NaN;
  if (!order?.coin || !(notional > 0) || !(leverage > 0) || !(exposure >= 0) || !Number.isFinite(dailyPnl)) {
    return { ok: false, code: HL_CAP_CODES.BAD_INPUT };
  }

  if (!c.allowedCoins.includes(order.coin)) return { ok: false, code: HL_CAP_CODES.COIN_NOT_ALLOWED };
  if (leverage > c.maxLeverage) return { ok: false, code: HL_CAP_CODES.LEVERAGE_TOO_HIGH };
  if (notional > c.maxOrderUsd) return { ok: false, code: HL_CAP_CODES.ORDER_TOO_LARGE };
  if (exposure + notional > c.totalExposureUsd) return { ok: false, code: HL_CAP_CODES.EXPOSURE_EXCEEDED };
  if (dailyPnl <= -Math.abs(c.dailyLossUsd)) return { ok: false, code: HL_CAP_CODES.DAILY_LOSS_REACHED };

  return { ok: true, code: null };
}
