/**
 * Collateral-loop calculator.
 *
 * This module is intentionally pure: it reads no RPC, wallet, browser storage,
 * or price feed and cannot build or submit a transaction. Every price, rate,
 * cost, and round count comes from the caller. The projection assumes the
 * borrowed asset remains close to one US dollar; it is a planning aid, not a
 * forecast or a safety guarantee.
 */

export const LOOP_MIN_HEALTH_FACTOR = 1.05;
export const LOOP_MAX_ROUNDS = 5;

/** Editable examples only. Live market values are never silently substituted. */
export const LOOP_DEFAULTS = Object.freeze({
  collateralUsd: 1000,
  collateralAsset: 'USDC',
  borrowAsset: 'USDT',
  ltvPct: 75,
  liquidationThresholdPct: 85,
  supplyApyPct: 3,
  borrowApyPct: 5,
  swapCostPct: 0.7,
  gasUsdPerRound: 1.5,
  rounds: 3,
  headroomPct: 10,
  startingCollateralUsd: 0,
  startingDebtUsd: 0
});

const finite = (value) => value != null && String(value).trim() !== '' && Number.isFinite(Number(value));
const number = (value) => Number(value);

/**
 * Validate calculator inputs without throwing. `errors` carries stable codes
 * for localization in the UI.
 */
export function validateLoopInput(input = {}) {
  const errors = [];
  const add = (field, code) => errors.push({ field, code });
  const positive = ['collateralUsd'];
  const nonNegative = [
    'startingCollateralUsd', 'startingDebtUsd', 'supplyApyPct', 'borrowApyPct',
    'swapCostPct', 'gasUsdPerRound'
  ];

  for (const field of positive) {
    if (!finite(input[field]) || number(input[field]) <= 0) add(field, 'INVALID_POSITIVE_NUMBER');
  }
  for (const field of nonNegative) {
    if (!finite(input[field]) || number(input[field]) < 0) add(field, 'INVALID_NON_NEGATIVE_NUMBER');
  }
  for (const field of ['ltvPct', 'liquidationThresholdPct']) {
    if (!finite(input[field]) || number(input[field]) <= 0 || number(input[field]) > 100) {
      add(field, 'INVALID_PERCENT');
    }
  }
  if (finite(input.ltvPct) && finite(input.liquidationThresholdPct)
    && number(input.ltvPct) > number(input.liquidationThresholdPct)) {
    add('ltvPct', 'LTV_EXCEEDS_LIQUIDATION_THRESHOLD');
  }
  if (!finite(input.swapCostPct) || number(input.swapCostPct) >= 100) {
    if (!errors.some((e) => e.field === 'swapCostPct')) add('swapCostPct', 'SWAP_COST_TOO_HIGH');
  }
  if (!finite(input.headroomPct) || number(input.headroomPct) < 0 || number(input.headroomPct) >= 100) {
    add('headroomPct', 'INVALID_HEADROOM');
  }
  if (!Number.isInteger(Number(input.rounds)) || Number(input.rounds) < 1 || Number(input.rounds) > LOOP_MAX_ROUNDS) {
    add('rounds', 'INVALID_ROUND_COUNT');
  }
  if (typeof input.collateralAsset !== 'string' || !input.collateralAsset.trim()) add('collateralAsset', 'ASSET_REQUIRED');
  if (typeof input.borrowAsset !== 'string' || !input.borrowAsset.trim()) add('borrowAsset', 'ASSET_REQUIRED');

  return { valid: errors.length === 0, errors };
}

/** Health factor from USD values and a percentage liquidation threshold. */
export function healthFactor({ collateralUsd, debtUsd, liquidationThresholdPct } = {}) {
  if (!finite(collateralUsd) || !finite(debtUsd) || !finite(liquidationThresholdPct)) return null;
  const collateral = number(collateralUsd);
  const debt = number(debtUsd);
  const threshold = number(liquidationThresholdPct);
  if (collateral < 0 || debt < 0 || threshold <= 0 || threshold > 100) return null;
  if (debt === 0) return null;
  return (collateral * (threshold / 100)) / debt;
}

/** Percentage fall in collateral value that would reach HF 1.00. */
export function liquidationDropPct(hf) {
  if (!finite(hf) || number(hf) <= 0) return null;
  const factor = number(hf);
  if (factor <= 1) return 0;
  return (1 - 1 / factor) * 100;
}

/**
 * Borrow capacity after an explicit headroom margin. A null is returned for
 * invalid inputs; zero is a real, valid answer when the position is at or
 * above the selected LTV.
 */
export function maxBorrowUsd({ collateralUsd, debtUsd = 0, ltvPct, headroomPct = 0 } = {}) {
  if (!finite(collateralUsd) || !finite(debtUsd) || !finite(ltvPct) || !finite(headroomPct)) return null;
  const collateral = number(collateralUsd);
  const debt = number(debtUsd);
  const ltv = number(ltvPct);
  const headroom = number(headroomPct);
  if (collateral < 0 || debt < 0 || ltv < 0 || ltv > 100 || headroom < 0 || headroom >= 100) return null;
  return Math.max(0, collateral * (ltv / 100) * (1 - headroom / 100) - debt);
}

/**
 * Simulate a collateral loop using the supplied estimates.
 *
 * Each round borrows only the remaining LTV headroom, deducts the estimated
 * swap cost when the asset pair differs, and supplies the conservative
 * estimated output. The current round is stopped if its borrow would take HF
 * below 1.05. Gas and swap costs are one-off costs; the net rate is shown both
 * before and after those costs for the first year at today's variable rates.
 */
export function simulateLoop(input = {}) {
  const validation = validateLoopInput(input);
  if (!validation.valid) return { ok: false, validation, errors: validation.errors, rows: [], warnings: [] };

  const warnings = [];
  const warn = (code) => { if (!warnings.includes(code)) warnings.push(code); };
  const sameAsset = input.collateralAsset.trim().toUpperCase() === input.borrowAsset.trim().toUpperCase();
  const initialAddedCollateral = number(input.collateralUsd);
  const startingCollateral = number(input.startingCollateralUsd ?? 0);
  const startingDebt = number(input.startingDebtUsd ?? 0);
  const capitalUsd = startingCollateral + initialAddedCollateral;
  let collateralUsd = capitalUsd;
  let debtUsd = startingDebt;
  let totalBorrowedUsd = 0;
  let totalSwapCostUsd = 0;
  let totalGasUsd = 0;
  let lowestHealthFactor = healthFactor({
    collateralUsd,
    debtUsd,
    liquidationThresholdPct: input.liquidationThresholdPct
  });
  const rows = [];

  if (startingCollateral > 0 && startingDebt > startingCollateral * number(input.ltvPct) / 100) {
    warn('ALREADY_OVER_LTV');
  }

  for (let round = 1; round <= Number(input.rounds); round += 1) {
    const ltvRoom = maxBorrowUsd({
      collateralUsd,
      debtUsd,
      ltvPct: input.ltvPct,
      headroomPct: input.headroomPct
    });
    const hfRoom = Math.max(0, (collateralUsd * (number(input.liquidationThresholdPct) / 100)) / LOOP_MIN_HEALTH_FACTOR - debtUsd);
    const borrowUsd = Math.max(0, ltvRoom ?? 0);

    if (!(borrowUsd > 0.000001)) {
      warn('NO_LOOP_POSSIBLE');
      break;
    }

    const hfBeforeSupply = healthFactor({
      collateralUsd,
      debtUsd: debtUsd + borrowUsd,
      liquidationThresholdPct: input.liquidationThresholdPct
    });
    if (hfBeforeSupply != null && (lowestHealthFactor == null || hfBeforeSupply < lowestHealthFactor)) {
      lowestHealthFactor = hfBeforeSupply;
    }
    if (borrowUsd > hfRoom + 0.000001 || (hfBeforeSupply != null && hfBeforeSupply < LOOP_MIN_HEALTH_FACTOR)) {
      warn('STOPPED_BY_HEALTH_FACTOR');
      break;
    }

    const swapCostUsd = sameAsset ? 0 : borrowUsd * (number(input.swapCostPct) / 100);
    const suppliedUsd = Math.max(0, borrowUsd - swapCostUsd);
    const gasUsd = number(input.gasUsdPerRound);
    debtUsd += borrowUsd;
    totalBorrowedUsd += borrowUsd;
    collateralUsd += suppliedUsd;
    totalSwapCostUsd += swapCostUsd;
    totalGasUsd += gasUsd;

    const hf = healthFactor({
      collateralUsd,
      debtUsd,
      liquidationThresholdPct: input.liquidationThresholdPct
    });
    const drop = liquidationDropPct(hf);
    if (hf != null && (lowestHealthFactor == null || hf < lowestHealthFactor)) lowestHealthFactor = hf;
    rows.push({
      round,
      borrowUsd,
      healthFactorAtBorrow: hfBeforeSupply,
      liquidationDropAtBorrowPct: liquidationDropPct(hfBeforeSupply),
      suppliedUsd,
      swapCostUsd,
      gasUsd,
      collateralUsd,
      debtUsd,
      healthFactor: hf,
      liquidationDropPct: drop
    });

    if (hf != null && hf < LOOP_MIN_HEALTH_FACTOR) {
      warn('STOPPED_BY_HEALTH_FACTOR');
      break;
    }
  }

  if (rows.length === 0) warn('NO_LOOP_POSSIBLE');
  const finalHealthFactor = rows.length
    ? rows[rows.length - 1].healthFactor
    : healthFactor({ collateralUsd, debtUsd, liquidationThresholdPct: input.liquidationThresholdPct });
  const finalLiquidationDropPct = liquidationDropPct(finalHealthFactor);
  const lowestLiquidationDropPct = liquidationDropPct(lowestHealthFactor);
  const leverage = capitalUsd > 0 ? collateralUsd / capitalUsd : null;
  const supplyYieldUsdYear = collateralUsd * (number(input.supplyApyPct) / 100);
  const borrowCostUsdYear = debtUsd * (number(input.borrowApyPct) / 100);
  const netCarryUsdYear = supplyYieldUsdYear - borrowCostUsdYear;
  const netCarryRatePct = capitalUsd > 0 ? (netCarryUsdYear / capitalUsd) * 100 : null;
  const firstYearNetUsd = netCarryUsdYear - totalSwapCostUsd - totalGasUsd;
  const firstYearNetRatePct = capitalUsd > 0 ? (firstYearNetUsd / capitalUsd) * 100 : null;

  if (lowestHealthFactor != null && lowestHealthFactor < 1.2) warn('LIQUIDATION_NEAR');
  if (firstYearNetRatePct != null && firstYearNetRatePct < 0) warn('NEGATIVE_NET_CARRY');

  return {
    ok: true,
    validation,
    rows,
    warnings,
    initialCapitalUsd: capitalUsd,
    collateralUsd,
    debtUsd,
    totalBorrowedUsd,
    totalSwapCostUsd,
    totalGasUsd,
    leverage,
    finalHealthFactor,
    lowestHealthFactor,
    liquidationDropPct: lowestLiquidationDropPct,
    finalLiquidationDropPct,
    netCarryUsdYear,
    netCarryRatePct,
    firstYearNetUsd,
    firstYearNetRatePct
  };
}
