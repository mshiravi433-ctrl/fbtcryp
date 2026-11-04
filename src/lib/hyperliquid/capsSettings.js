/**
 * HYPERLIQUID — CAPS SETTINGS VALIDATION (pure)
 * ---------------------------------------------------------------------------
 * Checks a user's requested caps before they are saved. The engine in
 * caps.js enforces them per order; this file only decides whether a set of
 * numbers is coherent. Incoherent settings are refused, never silently fixed.
 *
 * System ceilings are hard limits: the UI cannot exceed them.
 */

import { HL_CAP_DEFAULTS } from './caps.js';

export const HL_SYSTEM_LIMITS = Object.freeze({
  /** Largest single order the product will ever allow. */
  maxOrderUsd: 20000,
  /** Highest leverage the product will ever allow. */
  maxLeverage: 10,
  /** Widest stop-loss distance the product will ever allow (fraction of notional). */
  maxStopLossPct: 0.10,
  /** Most markets a user can allow at once. Real availability is checked live against Hyperliquid. */
  maxAllowedMarkets: 40,
  /** A market name as Hyperliquid writes it (BTC, ETH, kPEPE). */
  coinNamePattern: /^[A-Za-z0-9]{1,16}$/
});

export const HL_SETTINGS_CODES = Object.freeze({
  NOT_A_NUMBER: 'HL_SETTINGS_NOT_A_NUMBER',
  NOT_POSITIVE: 'HL_SETTINGS_NOT_POSITIVE',
  ORDER_OVER_SYSTEM_LIMIT: 'HL_SETTINGS_ORDER_OVER_SYSTEM_LIMIT',
  EXPOSURE_BELOW_ORDER: 'HL_SETTINGS_EXPOSURE_BELOW_ORDER',
  LEVERAGE_OVER_SYSTEM_LIMIT: 'HL_SETTINGS_LEVERAGE_OVER_SYSTEM_LIMIT',
  LEVERAGE_NOT_INTEGER: 'HL_SETTINGS_LEVERAGE_NOT_INTEGER',
  STOP_LOSS_OVER_SYSTEM_LIMIT: 'HL_SETTINGS_STOP_LOSS_OVER_SYSTEM_LIMIT',
  COIN_INVALID: 'HL_SETTINGS_COIN_INVALID',
  TOO_MANY_COINS: 'HL_SETTINGS_TOO_MANY_COINS'
});

export function defaultCapsSettings() {
  return { ...HL_CAP_DEFAULTS, allowedCoins: [...HL_CAP_DEFAULTS.allowedCoins] };
}

/**
 * @param {object} input  the values as the form holds them (strings allowed)
 * @returns {{ok: boolean, errors: string[], value: object|null}}
 */
export function validateCapsSettings(input = {}) {
  const errors = [];
  const num = (v, field) => {
    if (v === null || v === undefined || v === '') {
      errors.push(HL_SETTINGS_CODES.NOT_A_NUMBER);
      return NaN;
    }
    const n = Number(v);
    if (!Number.isFinite(n)) {
      errors.push(HL_SETTINGS_CODES.NOT_A_NUMBER);
      return NaN;
    }
    if (n <= 0) {
      errors.push(HL_SETTINGS_CODES.NOT_POSITIVE);
      return NaN;
    }
    return n;
  };

  const totalExposureUsd = num(input.totalExposureUsd);
  const maxOrderUsd = num(input.maxOrderUsd);
  const dailyLossUsd = num(input.dailyLossUsd);
  const maxLeverage = num(input.maxLeverage);

  if (Number.isFinite(maxOrderUsd) && maxOrderUsd > HL_SYSTEM_LIMITS.maxOrderUsd) {
    errors.push(HL_SETTINGS_CODES.ORDER_OVER_SYSTEM_LIMIT);
  }
  if (Number.isFinite(totalExposureUsd) && Number.isFinite(maxOrderUsd)
      && totalExposureUsd < maxOrderUsd) {
    errors.push(HL_SETTINGS_CODES.EXPOSURE_BELOW_ORDER);
  }
  if (Number.isFinite(maxLeverage)) {
    if (!Number.isInteger(maxLeverage)) errors.push(HL_SETTINGS_CODES.LEVERAGE_NOT_INTEGER);
    else if (maxLeverage > HL_SYSTEM_LIMITS.maxLeverage) errors.push(HL_SETTINGS_CODES.LEVERAGE_OVER_SYSTEM_LIMIT);
  }

  // Stop-loss ceiling: optional in the input, defaults to caps.js when absent.
  let maxStopLossPct = HL_CAP_DEFAULTS.maxStopLossPct;
  if (input.maxStopLossPct !== undefined && input.maxStopLossPct !== null && input.maxStopLossPct !== '') {
    const n = Number(input.maxStopLossPct);
    if (!Number.isFinite(n) || n <= 0) errors.push(HL_SETTINGS_CODES.NOT_POSITIVE);
    else if (n > HL_SYSTEM_LIMITS.maxStopLossPct) errors.push(HL_SETTINGS_CODES.STOP_LOSS_OVER_SYSTEM_LIMIT);
    else maxStopLossPct = n;
  }

  const coins = Array.isArray(input.allowedCoins) ? input.allowedCoins : [];
  if (coins.some((c) => typeof c !== 'string' || !HL_SYSTEM_LIMITS.coinNamePattern.test(c))) {
    errors.push(HL_SETTINGS_CODES.COIN_INVALID);
  }
  if (new Set(coins).size > HL_SYSTEM_LIMITS.maxAllowedMarkets) errors.push(HL_SETTINGS_CODES.TOO_MANY_COINS);

  if (errors.length) return { ok: false, errors: [...new Set(errors)], value: null };
  return {
    ok: true,
    errors: [],
    value: {
      totalExposureUsd,
      maxOrderUsd,
      dailyLossUsd,
      maxLeverage,
      maxStopLossPct,
      allowedCoins: [...new Set(coins)],
      killSwitch: input.killSwitch === true
    }
  };
}
