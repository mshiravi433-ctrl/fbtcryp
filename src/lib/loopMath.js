/**
 * LOOP MATH — pure preview calculator for collateral-borrow loops.
 * ---------------------------------------------------------------------------
 * Stage M0+M1 of the lending-loop plan (docs/LENDING-LOOP-STAGE-FA.md).
 *
 * This module does NO network, NO wallet, NO signing and NO storage. Every
 * number it returns is a PREVIEW computed from inputs the caller supplies
 * (prices, rates, LTV and liquidation threshold read from the market). It is
 * deliberately USD-denominated and floating-point: it is for display and
 * warning only. On-chain amounts stay in bigint inside lending-service.js.
 *
 * Model (one loop round):
 *   1. borrow B = (C × LTV − D) × (1 − headroom)   — never the full limit
 *   2. swap B into collateral; the swap costs a fraction `swapCostRate`
 *   3. C += B × (1 − swapCostRate);  D += B
 *   4. health factor HF = C × LT / D
 * The loop stops when the next borrow is below `minBorrowUsd`, when HF would
 * fall below `minHealthFactor`, or after `maxRounds`.
 *
 * Assumption (stated in the UI, not hidden): the borrowed asset is priced as
 * a stable unit, so a drop in the COLLATERAL price is the only liquidation
 * driver modelled here. A volatile borrow asset needs its own calculator.
 */

export const LOOP_DEFAULTS = Object.freeze({
  headroom: 0.05,          // borrow only 95% of the free LTV room
  minHealthFactor: 1.05,   // mirrors MIN_HEALTH_FACTOR_AFTER_BORROW in lending-service.js
  maxRounds: 5,
  minBorrowUsd: 10,
  swapCostRate: 0.01,      // swap fee + slippage assumed on every round
  gasUsdPerRound: 0,
  liquidationWarnDropPct: 15 // warn when the liquidation drop is below this
});

const isNum = (x) => typeof x === 'number' && Number.isFinite(x);

/** Returns { ok, errors[] } for the inputs a loop needs. Never throws. */
export function validateLoopInput(input = {}) {
  const errors = [];
  const { collateralUsd, debtUsd = 0, ltv, liquidationThreshold, supplyApy = 0, borrowApy = 0 } = input;
  if (!isNum(collateralUsd) || collateralUsd <= 0) errors.push('COLLATERAL_INVALID');
  if (!isNum(debtUsd) || debtUsd < 0) errors.push('DEBT_INVALID');
  if (!isNum(ltv) || ltv <= 0 || ltv >= 1) errors.push('LTV_INVALID');
  if (!isNum(liquidationThreshold) || liquidationThreshold <= 0 || liquidationThreshold > 1) errors.push('LT_INVALID');
  if (isNum(ltv) && isNum(liquidationThreshold) && ltv > liquidationThreshold) errors.push('LTV_ABOVE_LT');
  if (!isNum(supplyApy) || supplyApy < 0 || supplyApy > 1) errors.push('SUPPLY_APY_INVALID');
  if (!isNum(borrowApy) || borrowApy < 0 || borrowApy > 1) errors.push('BORROW_APY_INVALID');
  if (isNum(debtUsd) && isNum(collateralUsd) && debtUsd > 0 && (collateralUsd * ltv) < debtUsd) {
    errors.push('ALREADY_OVER_LTV');
  }
  return { ok: errors.length === 0, errors };
}

/** HF = C × LT / D. Infinite when there is no debt. */
export function healthFactor({ collateralUsd, debtUsd, liquidationThreshold }) {
  if (!(debtUsd > 0)) return Infinity;
  return (collateralUsd * liquidationThreshold) / debtUsd;
}

/**
 * Fraction by which the COLLATERAL price must fall (0..1) before HF hits 1.
 * Returns null when there is no debt (no liquidation risk) or inputs are bad.
 */
export function liquidationDropPct({ collateralUsd, debtUsd, liquidationThreshold }) {
  if (!(debtUsd > 0) || !(collateralUsd > 0) || !(liquidationThreshold > 0)) return null;
  const drop = 1 - debtUsd / (collateralUsd * liquidationThreshold);
  return drop <= 0 ? 0 : drop;
}

/** Free borrow room in USD at the given LTV (never negative). */
export function maxBorrowUsd({ collateralUsd, debtUsd = 0, ltv }) {
  return Math.max(0, collateralUsd * ltv - debtUsd);
}

/**
 * Simulate up to maxRounds loop rounds. Pure: the input object is not mutated.
 * Returns the round table, the final position and the warnings the UI shows.
 */
export function simulateLoop(rawInput = {}) {
  const check = validateLoopInput(rawInput);
  if (!check.ok) return { ok: false, errors: check.errors, rounds: [], final: null, warnings: [] };

  const cfg = { ...LOOP_DEFAULTS, ...pickDefined(rawInput) };
  const { ltv, liquidationThreshold, supplyApy = 0, borrowApy = 0 } = rawInput;
  const equity0 = rawInput.collateralUsd - (rawInput.debtUsd ?? 0);

  let C = rawInput.collateralUsd;
  let D = rawInput.debtUsd ?? 0;
  const rounds = [];
  let stopReason = 'MAX_ROUNDS';

  for (let i = 1; i <= cfg.maxRounds; i += 1) {
    const room = maxBorrowUsd({ collateralUsd: C, debtUsd: D, ltv });
    const borrow = room * (1 - cfg.headroom);
    if (borrow < cfg.minBorrowUsd) { stopReason = 'NO_ROOM'; break; }

    const nextD = D + borrow;
    const nextC = C + borrow * (1 - cfg.swapCostRate);
    const hf = healthFactor({ collateralUsd: nextC, debtUsd: nextD, liquidationThreshold });
    if (hf < cfg.minHealthFactor) { stopReason = 'MIN_HEALTH_FACTOR'; break; }

    C = nextC;
    D = nextD;
    rounds.push({
      round: i,
      borrowUsd: round2(borrow),
      collateralUsd: round2(C),
      debtUsd: round2(D),
      healthFactor: round4(hf),
      gasUsd: cfg.gasUsdPerRound
    });
  }

  const totalGasUsd = rounds.length * cfg.gasUsdPerRound;
  const equity = C - D - totalGasUsd;
  const hfFinal = healthFactor({ collateralUsd: C, debtUsd: D, liquidationThreshold });
  const dropFinal = liquidationDropPct({ collateralUsd: C, debtUsd: D, liquidationThreshold });

  /* Net yearly figure on the ORIGINAL equity: supply income on all collateral
     minus borrow cost on all debt, less the gas paid once per round. */
  const annualNetUsd = C * supplyApy - D * borrowApy;
  const netApyOnEquity = equity0 > 0 ? (annualNetUsd - totalGasUsd) / equity0 : null;

  const warnings = [];
  if (rounds.length === 0) warnings.push('NO_LOOP_POSSIBLE');
  if (dropFinal !== null && dropFinal * 100 < cfg.liquidationWarnDropPct) warnings.push('LIQUIDATION_NEAR');
  if (netApyOnEquity !== null && netApyOnEquity < 0) warnings.push('NEGATIVE_NET_CARRY');
  if (stopReason === 'MIN_HEALTH_FACTOR') warnings.push('STOPPED_BY_HEALTH_FACTOR');

  return {
    ok: true,
    errors: [],
    stopReason,
    rounds,
    final: {
      collateralUsd: round2(C),
      debtUsd: round2(D),
      equityUsd: round2(equity),
      leverage: equity0 > 0 ? round2(C / equity0) : null,
      healthFactor: round4(hfFinal),
      liquidationDropPct: dropFinal === null ? null : round4(dropFinal),
      netApyOnEquity: netApyOnEquity === null ? null : round4(netApyOnEquity)
    },
    warnings
  };
}

/* ── helpers ─────────────────────────────────────────────────────────────── */
function pickDefined(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj)) if (v !== undefined && v !== null) out[k] = v;
  return out;
}
const round2 = (x) => Math.round(x * 100) / 100;
const round4 = (x) => (Number.isFinite(x) ? Math.round(x * 10000) / 10000 : x);
