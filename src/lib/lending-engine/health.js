/**
 * LENDING ENGINE — risk levels & health factor (§12 of the production spec).
 * ---------------------------------------------------------------------------
 * The thresholds are NOT hardcoded into the UI. They live here as
 * configuration: the defaults follow the spec's table, and a protocol adapter
 * (or a server config) may pass its own bands — e.g. an isolated pool whose
 * e-mode liquidation threshold differs. `riskLevel` always picks the band by
 * config, never by a colour hardcoded in a component.
 *
 *   > 2.0          healthy        🟢
 *   1.5 – 2.0      moderate       🟡
 *   1.2 – 1.5      warning        🟠
 *   1.0 – 1.2      critical       🔴
 *   < 1.0          liquidatable   ⚫ (position can be liquidated)
 *
 * `assessPosition` is the one function the UI, the alert engine and the
 * server all call, so "health factor is correct" (§33 DoD) cannot drift
 * between screens.
 */

export const DEFAULT_RISK_BANDS = Object.freeze([
  { min: 2.0, level: 'healthy',       color: '#4ade80' },
  { min: 1.5, level: 'moderate',      color: '#facc15' },
  { min: 1.2, level: 'warning',       color: '#fb923c' },
  { min: 1.0, level: 'critical',      color: '#f87171' },
  { min: 0.0, level: 'liquidatable',  color: '#b91c1c' }
]);

/** Bands must be sorted descending and cover [0, ∞) — validated at use time. */
export function validateRiskBands(bands) {
  const list = Array.isArray(bands) && bands.length ? bands : null;
  if (!list) return DEFAULT_RISK_BANDS;
  const sorted = [...list].sort((a, b) => Number(b.min) - Number(a.min));
  for (const band of sorted) {
    if (!Number.isFinite(Number(band.min)) || typeof band.level !== 'string') return DEFAULT_RISK_BANDS;
  }
  return Object.freeze(sorted);
}

/**
 * Risk level for a health factor.
 *   hf == null            → { level: 'none' }        (no debt, nothing to risk)
 *   hf < 0                → { level: 'liquidatable' }
 */
export function riskLevel(healthFactor, bands = DEFAULT_RISK_BANDS) {
  if (healthFactor == null || !Number.isFinite(Number(healthFactor))) return { level: 'none', color: '#9ca3af', healthFactor: null };
  const hf = Number(healthFactor);
  if (hf < 0) return { level: 'liquidatable', color: '#b91c1c', healthFactor: hf };
  const valid = validateRiskBands(bands);
  for (const band of valid) {
    if (hf >= Number(band.min)) return { level: band.level, color: band.color, healthFactor: hf, band };
  }
  return { level: 'liquidatable', color: '#b91c1c', healthFactor: hf };
}

/** LTV in percent: debt / collateral. null when there is no collateral. */
export function ltvOf(totalDebtUsd, totalCollateralUsd) {
  const debt = Number(totalDebtUsd);
  const collateral = Number(totalCollateralUsd);
  if (!Number.isFinite(debt) || !Number.isFinite(collateral)) return null;
  if (collateral <= 0) return debt > 0 ? Infinity : null;
  return (debt / collateral) * 100;
}

/**
 * Distance to liquidation in percent: how much the collateral could still
 * fall before the position is liquidatable. A low number means CLOSE.
 */
export function liquidationDistancePct({ totalDebtUsd, totalCollateralUsd, liquidationThresholdPct }) {
  const debt = Number(totalDebtUsd);
  const collateral = Number(totalCollateralUsd);
  const threshold = Number(liquidationThresholdPct);
  if (!Number.isFinite(debt) || !Number.isFinite(collateral) || !Number.isFinite(threshold)) return null;
  if (debt <= 0) return null;
  if (collateral <= 0 || threshold <= 0) return 0;
  const liqRatio = debt / (collateral * (threshold / 100));
  if (liqRatio >= 1) return 0;
  return (1 - liqRatio) * 100;
}

/** How much of the collateral value is still borrowable, in USD. */
export function remainingBorrowableUsd({ totalCollateralUsd, totalDebtUsd, liquidationThresholdPct }) {
  const collateral = Number(totalCollateralUsd);
  const debt = Number(totalDebtUsd);
  const threshold = Number(liquidationThresholdPct);
  if (!Number.isFinite(collateral) || !Number.isFinite(debt) || !Number.isFinite(threshold)) return null;
  const cap = collateral * (threshold / 100);
  return Math.max(0, cap - debt);
}

/**
 * The single position assessment used everywhere. `liquidationRisk` is the
 * inverse of the liquidation distance, on [0,1] — the §7 API field.
 */
export function assessPosition({
  healthFactor = null,
  totalDebtUsd = 0,
  totalCollateralUsd = 0,
  liquidationThresholdPct = null,
  bands = DEFAULT_RISK_BANDS
} = {}) {
  const level = riskLevel(healthFactor, bands);
  const distance = liquidationDistancePct({ totalDebtUsd, totalCollateralUsd, liquidationThresholdPct });
  const ltv = ltvOf(totalDebtUsd, totalCollateralUsd);
  return {
    healthFactor: healthFactor == null ? null : Number(healthFactor),
    riskLevel: level.level,
    riskColor: level.color,
    ltvPct: ltv == null ? null : (Number.isFinite(ltv) ? ltv : null),
    liquidationThresholdPct: liquidationThresholdPct == null ? null : Number(liquidationThresholdPct),
    liquidationDistancePct: distance,
    liquidationRisk: distance == null ? null : Math.max(0, Math.min(1, 1 - distance / 100)),
    remainingBorrowableUsd: remainingBorrowableUsd({ totalCollateralUsd, totalDebtUsd, liquidationThresholdPct })
  };
}
