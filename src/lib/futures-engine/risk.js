/**
 * FBT FUTURES RISK ENGINE (spec §8).
 * ---------------------------------------------------------------------------
 * Pure computation over REAL inputs. Outputs:
 *
 *   riskScore (0–100) · riskLevel LOW/MEDIUM/HIGH/EXTREME · liquidationDistancePct
 *   · maxRecommendedCollateralUsd · warnings[] · blocked + blockReasons[]
 *
 * Two honesty rules:
 *   · Every number states its basis. The liquidation distance names the model
 *     it used (`liquidationModel`), because different venues liquidate at
 *     different loss thresholds and a generic guess is a fabricated number.
 *   · Unknown inputs produce `null` fields and a warning, never a default that
 *     looks like data. A missing balance does not become "$0".
 *
 * Venue liquidation models (documented, not assumed):
 *   · ostium: liquidation when loss reaches 100% − (leverage / pairMaxLeverage × 25%)
 *     of collateral (Ostium docs, "Closing Trades → Liquidation").
 *   · full-collateral: liquidation at 100% loss — an UPPER bound used only when
 *     the venue's rule is unknown, and labelled as such.
 */

export const RISK_LEVEL = Object.freeze({ LOW: 'LOW', MEDIUM: 'MEDIUM', HIGH: 'HIGH', EXTREME: 'EXTREME' });

export const RISK_POLICY_DEFAULTS = Object.freeze({
  /** Above this leverage the engine refuses outright (product policy, not venue). */
  hardMaxLeverage: 50,
  /** Below this price distance to liquidation the trade is blocked. */
  minLiquidationDistancePct: 0.5,
  /** Recommended collateral is at most this share of the available balance. */
  riskBudgetPctOfBalance: 25,
  /** Warn when a single position risks more than this share of balance. */
  warnPctOfBalance: 50,
  /** Annualised funding above this is flagged as an expensive hold. */
  expensiveFundingAprPct: 30
});

const num = (v) => {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/**
 * Loss (as % of collateral) at which the venue liquidates.
 * Returns { lossPct, model }.
 */
export function liquidationLossPct({ providerId, leverage, maxLeverage }) {
  const lev = num(leverage);
  const max = num(maxLeverage);
  if (providerId === 'ostium' && lev != null && max != null && max > 0) {
    return { lossPct: Math.max(0, Math.min(100, 100 - (lev / max) * 25)), model: 'ostium-docs' };
  }
  return { lossPct: 100, model: 'full-collateral-upper-bound' };
}

/**
 * Price move (%) against the position that triggers liquidation, and the
 * liquidation price itself when an entry price is known.
 */
export function liquidationDistance({ providerId, side, entryPrice, leverage, maxLeverage }) {
  const lev = num(leverage);
  if (lev == null || lev <= 0) return { distancePct: null, liquidationPrice: null, model: null, lossPct: null };
  const { lossPct, model } = liquidationLossPct({ providerId, leverage: lev, maxLeverage });
  const distancePct = lossPct / lev;
  const px = num(entryPrice);
  let liquidationPrice = null;
  if (px != null && px > 0) {
    liquidationPrice = side === 'short' ? px * (1 + distancePct / 100) : px * (1 - distancePct / 100);
  }
  return { distancePct, liquidationPrice, model, lossPct };
}

function levelFor(score) {
  if (score >= 80) return RISK_LEVEL.EXTREME;
  if (score >= 55) return RISK_LEVEL.HIGH;
  if (score >= 30) return RISK_LEVEL.MEDIUM;
  return RISK_LEVEL.LOW;
}

/**
 * Assess one proposed (or open) position.
 *
 * @param {object} p
 * @param {string}  p.providerId
 * @param {'long'|'short'} p.side
 * @param {number}  p.collateralUsd
 * @param {number}  p.leverage
 * @param {number|null} p.maxLeverage          venue/pair max
 * @param {number|null} p.entryPrice
 * @param {number|null} p.takeProfit
 * @param {number|null} p.stopLoss
 * @param {number|null} p.availableBalanceUsd  wallet collateral balance (null = unknown)
 * @param {number|null} p.fundingAprPct        annualised funding paid by this side (null = unknown)
 * @param {boolean|null} p.isMarketOpen
 * @param {number|null} p.spreadBps
 * @param {number|null} p.openInterestUsd
 * @param {number|null} p.maxOpenInterestUsd
 * @param {object}  p.policy                   overrides for RISK_POLICY_DEFAULTS
 */
export function assessFuturesRisk({
  providerId = null,
  side = 'long',
  collateralUsd,
  leverage,
  maxLeverage = null,
  entryPrice = null,
  takeProfit = null,
  stopLoss = null,
  availableBalanceUsd = null,
  fundingAprPct = null,
  isMarketOpen = null,
  spreadBps = null,
  openInterestUsd = null,
  maxOpenInterestUsd = null,
  policy = {}
} = {}) {
  const P = { ...RISK_POLICY_DEFAULTS, ...(policy || {}) };
  const warnings = [];
  const blockReasons = [];
  const collateral = num(collateralUsd);
  const lev = num(leverage);
  const maxLev = num(maxLeverage);

  if (collateral == null || collateral <= 0) blockReasons.push('NO_COLLATERAL');
  if (lev == null || lev <= 0) blockReasons.push('NO_LEVERAGE');
  if (lev != null && lev > P.hardMaxLeverage) blockReasons.push('LEVERAGE_ABOVE_POLICY');
  if (lev != null && maxLev != null && maxLev > 0 && lev > maxLev) blockReasons.push('LEVERAGE_ABOVE_VENUE_MAX');
  if (isMarketOpen === false) blockReasons.push('MARKET_CLOSED');

  const notional = collateral != null && lev != null ? collateral * lev : null;
  const liq = liquidationDistance({ providerId, side, entryPrice, leverage: lev, maxLeverage: maxLev });
  if (liq.distancePct != null && liq.distancePct < P.minLiquidationDistancePct) blockReasons.push('LIQUIDATION_TOO_CLOSE');

  /* ── score components (each 0..weight) ─────────────────────────────── */
  let score = 0;

  // Leverage: 0 at 1x → 40 at policy max (and beyond).
  if (lev != null) score += Math.min(40, (lev / P.hardMaxLeverage) * 40);

  // Liquidation distance: <2% → +30, 2–5% → +20, 5–10% → +10, else 0.
  // (A 2% adverse move is an ordinary hour in crypto, and a normal day in FX.)
  if (liq.distancePct != null) {
    if (liq.distancePct < 2) score += 30;
    else if (liq.distancePct < 5) score += 20;
    else if (liq.distancePct < 10) score += 10;
  }

  // Share of balance at risk.
  let pctOfBalance = null;
  if (collateral != null && availableBalanceUsd != null && availableBalanceUsd > 0) {
    pctOfBalance = (collateral / availableBalanceUsd) * 100;
    if (collateral > availableBalanceUsd + 1e-9) blockReasons.push('INSUFFICIENT_BALANCE');
    else if (pctOfBalance > P.warnPctOfBalance) { score += 15; warnings.push('LARGE_SHARE_OF_BALANCE'); }
    else if (pctOfBalance > P.riskBudgetPctOfBalance) { score += 8; warnings.push('ABOVE_RISK_BUDGET'); }
  } else if (availableBalanceUsd == null) {
    warnings.push('BALANCE_UNKNOWN');
  }

  // Stop loss: absence is a risk factor, misplacement is a block.
  const px = num(entryPrice);
  const sl = num(stopLoss);
  const tp = num(takeProfit);
  if (sl == null || sl <= 0) { score += 10; warnings.push('NO_STOP_LOSS'); }
  if (px != null && px > 0) {
    if (sl != null && sl > 0 && ((side === 'long' && sl >= px) || (side === 'short' && sl <= px))) blockReasons.push('STOP_LOSS_WRONG_SIDE');
    if (tp != null && tp > 0 && ((side === 'long' && tp <= px) || (side === 'short' && tp >= px))) blockReasons.push('TAKE_PROFIT_WRONG_SIDE');
    if (sl != null && sl > 0 && liq.liquidationPrice != null) {
      const slBeyondLiq = side === 'long' ? sl < liq.liquidationPrice : sl > liq.liquidationPrice;
      if (slBeyondLiq) warnings.push('STOP_LOSS_BEYOND_LIQUIDATION');
    }
  }

  // Funding cost of holding.
  const fApr = num(fundingAprPct);
  if (fApr != null && fApr > P.expensiveFundingAprPct) { score += 5; warnings.push('EXPENSIVE_FUNDING'); }

  // Spread / liquidity.
  const spread = num(spreadBps);
  if (spread != null && spread > 50) { score += 5; warnings.push('WIDE_SPREAD'); }
  const oi = num(openInterestUsd);
  const maxOi = num(maxOpenInterestUsd);
  if (notional != null && oi != null && maxOi != null && maxOi > 0 && oi + notional > maxOi) blockReasons.push('EXCEEDS_OPEN_INTEREST_CAP');

  if (liq.model === 'full-collateral-upper-bound') warnings.push('LIQUIDATION_MODEL_APPROXIMATE');

  score = Math.max(0, Math.min(100, Math.round(score)));
  const riskLevel = blockReasons.length ? RISK_LEVEL.EXTREME : levelFor(score);

  const maxRecommendedCollateralUsd = availableBalanceUsd != null && availableBalanceUsd > 0
    ? Math.max(0, availableBalanceUsd * (P.riskBudgetPctOfBalance / 100))
    : null;

  return {
    schema: 'fbt.futures-risk.v1',
    riskScore: score,
    riskLevel,
    blocked: blockReasons.length > 0,
    blockReasons,
    warnings: [...new Set(warnings)],
    notionalUsd: notional,
    liquidationDistancePct: liq.distancePct,
    liquidationPrice: liq.liquidationPrice,
    liquidationLossPct: liq.lossPct,
    liquidationModel: liq.model,
    pctOfBalance,
    maxRecommendedCollateralUsd,
    inputs: { providerId, side, collateralUsd: collateral, leverage: lev, maxLeverage: maxLev, entryPrice: px }
  };
}

/** Quick verdict for an existing position from its live mark. */
export function positionHealth({ providerId, side, entryPrice, markPrice, leverage, maxLeverage }) {
  const px = num(entryPrice);
  const mark = num(markPrice);
  const lev = num(leverage);
  if (px == null || mark == null || lev == null || px <= 0 || lev <= 0) return { pnlPct: null, distanceToLiquidationPct: null, level: null };
  const move = ((mark - px) / px) * (side === 'short' ? -1 : 1) * 100;
  const pnlPct = move * lev; // % of collateral, before funding/rollover
  const liq = liquidationDistance({ providerId, side, entryPrice: px, leverage: lev, maxLeverage });
  const remaining = liq.distancePct == null ? null : liq.distancePct + move; // move is signed in the trader's favour
  const level = remaining == null ? null : remaining < 1 ? RISK_LEVEL.EXTREME : remaining < 3 ? RISK_LEVEL.HIGH : remaining < 10 ? RISK_LEVEL.MEDIUM : RISK_LEVEL.LOW;
  return { pnlPct, distanceToLiquidationPct: remaining, liquidationPrice: liq.liquidationPrice, level, model: liq.model };
}
