/**
 * Hyperliquid AI Trade — caps and kill switch.
 *
 * SECURITY: these checks run in code, not only in the UI. Every order intent
 * must pass `checkOrder` before a confirmation card is ever shown. Unknown or
 * unparseable values fail closed (rejected), never default to "allowed".
 *
 * Caps (non-negotiable):
 *   - per-transaction cap: 20,000 USD
 *   - total exposure cap: must be >= per-transaction cap. A lower value is
 *     rejected as incompatible and never stored.
 *   - daily loss, leverage and allowed markets keep their previous values
 *     until the owner sets them; until then any order above the per-tx cap is
 *     rejected and the incompatibility is surfaced.
 *   - kill switch: when on, NO order may be sent, even queued ones.
 */

export const HYPERLIQUID_PER_TX_CAP_USD = 20000;
export const PER_TX_CAP_USD = HYPERLIQUID_PER_TX_CAP_USD;
export const DEFAULT_PER_TX_CAP_USD = HYPERLIQUID_PER_TX_CAP_USD;
export const MAX_PER_TX_USD = HYPERLIQUID_PER_TX_CAP_USD;

export const HYPERLIQUID_CAP_ERROR = Object.freeze({
  UNKNOWN_VALUE: 'HL_CAP_UNKNOWN_VALUE',
  PER_TX_EXCEEDED: 'HL_CAP_PER_TX_EXCEEDED',
  TOTAL_EXPOSURE_TOO_LOW: 'HL_CAP_TOTAL_EXPOSURE_TOO_LOW',
  DAILY_LOSS_EXCEEDED: 'HL_CAP_DAILY_LOSS_EXCEEDED',
  LEVERAGE_EXCEEDED: 'HL_CAP_LEVERAGE_EXCEEDED',
  MARKET_NOT_ALLOWED: 'HL_CAP_MARKET_NOT_ALLOWED',
  KILL_SWITCH: 'HL_CAP_KILL_SWITCH',
  INVALID_CAPS: 'HL_CAP_INVALID_CAPS'
});

// Persian, user-facing reasons. Keep in sync with any copy module.
export const HYPERLIQUID_CAP_REASON_FA = Object.freeze({
  [HYPERLIQUID_CAP_ERROR.UNKNOWN_VALUE]: 'مقدار ناشناخته است؛ به‌صورت پیش‌فرض رد شد.',
  [HYPERLIQUID_CAP_ERROR.PER_TX_EXCEEDED]: 'مبلغ این سفارش از سقف هر تراکنش (۲۰٬۰۰۰ دلار) بیشتر است.',
  [HYPERLIQUID_CAP_ERROR.TOTAL_EXPOSURE_TOO_LOW]: 'سقف کل exposure باید حداقل برابر سقف هر تراکنش (۲۰٬۰۰۰ دلار) باشد.',
  [HYPERLIQUID_CAP_ERROR.DAILY_LOSS_EXCEEDED]: 'زیان روزانه از سقف مجاز فراتر رفته است.',
  [HYPERLIQUID_CAP_ERROR.LEVERAGE_EXCEEDED]: 'اهرم از حد مجاز فراتر است.',
  [HYPERLIQUID_CAP_ERROR.MARKET_NOT_ALLOWED]: 'این بازار در فهرست مجاز نیست.',
  [HYPERLIQUID_CAP_ERROR.KILL_SWITCH]: 'کلید توقف فعال است؛ هیچ سفارشی ارسال نمی‌شود.',
  [HYPERLIQUID_CAP_ERROR.INVALID_CAPS]: 'تنظیمات سقف ناسازگار است و ذخیره نشد.'
});

const isFiniteNumber = (v) => typeof v === 'number' && Number.isFinite(v);
const toNumber = (v) => {
  if (typeof v === 'boolean' || v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/**
 * Fail-closed: any value that cannot be parsed as a finite number is "unknown"
 * and is rejected (returns false / invalid).
 */
export function isKnownValue(value) {
  return toNumber(value) !== null;
}

/**
 * Validate a caps configuration before it is stored.
 * Returns { ok: boolean, errors: string[] }.
 */
export function validateCaps(caps = {}) {
  const errors = [];
  const c = caps && typeof caps === 'object' ? caps : null;
  if (!c) return { ok: false, errors: [HYPERLIQUID_CAP_ERROR.UNKNOWN_VALUE] };

  const perTx = toNumber(c.perTxCapUsd ?? c.perTx ?? c.perTransaction ?? c.maxPerTx);
  const total = toNumber(c.totalExposureCapUsd ?? c.totalExposure ?? c.totalCap ?? c.maxTotalExposure);
  const dailyLoss = c.dailyLossCapUsd == null ? null : toNumber(c.dailyLossCapUsd ?? c.dailyLoss);
  const leverage = c.maxLeverage == null ? null : toNumber(c.maxLeverage ?? c.leverage);
  const killSwitch = c.killSwitch;

  if (perTx === null) errors.push(HYPERLIQUID_CAP_ERROR.UNKNOWN_VALUE);
  if (total === null) errors.push(HYPERLIQUID_CAP_ERROR.UNKNOWN_VALUE);

  // per-tx must never exceed the hard ceiling
  if (perTx !== null && perTx > HYPERLIQUID_PER_TX_CAP_USD) {
    errors.push(HYPERLIQUID_CAP_ERROR.PER_TX_EXCEEDED);
  }
  // total exposure must be >= per-tx
  if (perTx !== null && total !== null && total < perTx) {
    errors.push(HYPERLIQUID_CAP_ERROR.TOTAL_EXPOSURE_TOO_LOW);
  }
  if (perTx !== null && perTx < 0) errors.push(HYPERLIQUID_CAP_ERROR.INVALID_CAPS);
  if (total !== null && total < 0) errors.push(HYPERLIQUID_CAP_ERROR.INVALID_CAPS);
  if (dailyLoss !== null && dailyLoss < 0) errors.push(HYPERLIQUID_CAP_ERROR.INVALID_CAPS);
  if (leverage !== null && !(leverage > 0)) errors.push(HYPERLIQUID_CAP_ERROR.INVALID_CAPS);
  if (killSwitch != null && typeof killSwitch !== 'boolean') errors.push(HYPERLIQUID_CAP_ERROR.UNKNOWN_VALUE);

  const ok = errors.length === 0;
  return { ok, errors: [...new Set(errors)] };
}

/**
 * canStoreCaps: alias used by UI to decide whether to persist.
 */
export function canStoreCaps(caps) {
  return validateCaps(caps).ok;
}

/**
 * Check a single order intent against caps.
 * Returns { ok: boolean, reason: string|null, code: string|null }.
 */
export function checkOrder(caps = {}, intent = {}, state = {}) {
  const c = caps && typeof caps === 'object' ? caps : {};
  const killSwitch = Boolean(c.killSwitch || state.killSwitch);
  if (killSwitch) {
    return { ok: false, code: HYPERLIQUID_CAP_ERROR.KILL_SWITCH, reason: HYPERLIQUID_CAP_REASON_FA[HYPERLIQUID_CAP_ERROR.KILL_SWITCH] };
  }

  const notional = toNumber(intent.notionalUsd ?? intent.sizeUsd ?? intent.amountUsd ?? intent.notional);
  if (notional === null) {
    return { ok: false, code: HYPERLIQUID_CAP_ERROR.UNKNOWN_VALUE, reason: HYPERLIQUID_CAP_REASON_FA[HYPERLIQUID_CAP_ERROR.UNKNOWN_VALUE] };
  }
  if (notional < 0) {
    return { ok: false, code: HYPERLIQUID_CAP_ERROR.INVALID_CAPS, reason: HYPERLIQUID_CAP_REASON_FA[HYPERLIQUID_CAP_ERROR.INVALID_CAPS] };
  }

  const perTx = toNumber(c.perTxCapUsd ?? c.perTx ?? HYPERLIQUID_PER_TX_CAP_USD);
  if (perTx === null) {
    return { ok: false, code: HYPERLIQUID_CAP_ERROR.UNKNOWN_VALUE, reason: HYPERLIQUID_CAP_REASON_FA[HYPERLIQUID_CAP_ERROR.UNKNOWN_VALUE] };
  }
  const effectivePerTx = Math.min(perTx, HYPERLIQUID_PER_TX_CAP_USD);
  if (notional > effectivePerTx) {
    return { ok: false, code: HYPERLIQUID_CAP_ERROR.PER_TX_EXCEEDED, reason: HYPERLIQUID_CAP_REASON_FA[HYPERLIQUID_CAP_ERROR.PER_TX_EXCEEDED] };
  }

  const total = toNumber(c.totalExposureCapUsd ?? c.totalExposure);
  const currentExposure = toNumber(state.currentExposureUsd ?? state.exposureUsd ?? 0);
  if (total !== null && currentExposure !== null) {
    if (currentExposure + notional > total) {
      return { ok: false, code: HYPERLIQUID_CAP_ERROR.TOTAL_EXPOSURE_TOO_LOW, reason: HYPERLIQUID_CAP_REASON_FA[HYPERLIQUID_CAP_ERROR.TOTAL_EXPOSURE_TOO_LOW] };
    }
  }

  const dailyLoss = toNumber(state.dailyLossUsd ?? state.realizedLossUsd);
  const dailyCap = toNumber(c.dailyLossCapUsd ?? c.dailyLoss);
  if (dailyLoss !== null && dailyCap !== null && dailyLoss >= dailyCap) {
    return { ok: false, code: HYPERLIQUID_CAP_ERROR.DAILY_LOSS_EXCEEDED, reason: HYPERLIQUID_CAP_REASON_FA[HYPERLIQUID_CAP_ERROR.DAILY_LOSS_EXCEEDED] };
  }

  const leverage = toNumber(intent.leverage);
  const maxLev = toNumber(c.maxLeverage);
  if (leverage !== null && maxLev !== null && leverage > maxLev) {
    return { ok: false, code: HYPERLIQUID_CAP_ERROR.LEVERAGE_EXCEEDED, reason: HYPERLIQUID_CAP_REASON_FA[HYPERLIQUID_CAP_ERROR.LEVERAGE_EXCEEDED] };
  }

  const market = intent.market ?? intent.symbol ?? intent.coin;
  const allowed = c.allowedMarkets ?? c.markets;
  if (Array.isArray(allowed) && market != null) {
    if (!allowed.map(String).includes(String(market))) {
      return { ok: false, code: HYPERLIQUID_CAP_ERROR.MARKET_NOT_ALLOWED, reason: HYPERLIQUID_CAP_REASON_FA[HYPERLIQUID_CAP_ERROR.MARKET_NOT_ALLOWED] };
    }
  }

  return { ok: true, code: null, reason: null };
}

export function checkCaps(...args) {
  // support checkCaps(caps, intent, state) and checkCaps({caps,intent,state})
  if (args.length === 1 && args[0] && typeof args[0] === 'object' && ('caps' in args[0] || 'intent' in args[0])) {
    const { caps, intent, state } = args[0];
    return checkOrder(caps || {}, intent || {}, state || {});
  }
  return checkOrder(args[0] || {}, args[1] || {}, args[2] || {});
}

export function assertCaps(...args) {
  const r = checkCaps(...args);
  if (!r.ok) throw new Error(r.code || 'CAP_REJECTED');
  return r;
}

export function isKillSwitchOn(caps = {}) {
  return Boolean(caps && caps.killSwitch);
}

export function setKillSwitch(caps = {}, on = true) {
  return { ...(caps || {}), killSwitch: Boolean(on) };
}

// aliases
export const PER_TX_CAP = HYPERLIQUID_PER_TX_CAP_USD;
export const perTxCap = HYPERLIQUID_PER_TX_CAP_USD;
export const TOTAL_EXPOSURE_MIN = HYPERLIQUID_PER_TX_CAP_USD;
