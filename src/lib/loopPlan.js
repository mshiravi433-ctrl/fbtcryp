/**
 * COLLATERAL LOOP — THE LIVE PLAN (pure: no ethers, no DOM, no network).
 * ============================================================================
 * Reported (fa): «در صفحه وام، حلقه وثیقه را کاملا عملیاتی کن و اجرای مراحل را
 * عملیاتی کن».
 *
 * The calculator in loopMath.js answers "what if" with numbers the user types.
 * This module answers "what exactly will be signed" with the numbers the
 * protocol reported in the page's last market pass:
 *
 *   · the collateral reserve's own LTV and liquidation threshold,
 *   · the two reserves' live supply / borrow APY,
 *   · the protocol oracle's prices,
 *   · the wallet's real balance and the account's real collateral and debt.
 *
 * It produces two things:
 *
 *   1. a PROJECTION (round table + summary) the user reviews, and
 *   2. the ordered STEP LIST the execution controller walks one signature at a
 *      time: supply → (borrow → swap → supply) × rounds.
 *
 * ─── WHAT IS DECIDED HERE, AND WHAT IS DECIDED LATER ───────────────────────
 * Only the INITIAL supply has a fixed amount. Every later amount is resolved
 * immediately before its own signature from a FRESH read (resolveBorrowAmount
 * below, called by loopRuntime.js), because the chain moves between steps: the
 * swap returns what it returns, interest accrues, prices tick. The projection's
 * borrow figures are therefore CEILINGS — an executed step never borrows more
 * than the plan the user reviewed, and it borrows less whenever the fresh
 * account says the safe amount is smaller.
 *
 * ─── THE TWO SAFETY LIMITS ON EVERY BORROW ─────────────────────────────────
 *   LTV headroom   borrow ≤ collateral × LTV × (1 − headroom) − debt
 *   HF floor       borrow ≤ collateral × LT / targetHF − debt
 * and, at execution time, also ≤ the pool's own availableBorrows, the
 * reserve's free liquidity and its borrow cap. The smallest one wins.
 */

import { LOOP_MAX_ROUNDS, LOOP_MIN_HEALTH_FACTOR, liquidationDropPct } from './loopMath.js';
import { parseAmountWei, formatWeiFloor } from './spot/spotMath.js';

export const LOOP_PLAN_DEFAULTS = Object.freeze({
  rounds: '2',
  headroomPct: '10',
  minHealthFactor: '1.35',
  slippagePct: '0.5'
});

export const LOOP_PLAN_LIMITS = Object.freeze({
  /** A borrow worth less than this ends the loop instead of being signed. */
  minStepUsd: 1,
  maxHeadroomPct: 90,
  maxTargetHealthFactor: 5,
  minSlippagePct: 0.05,
  maxSlippagePct: 3,
  /** Interest accrues between the read and the block: keep 10 bps aside. */
  capacityHeadroomBps: 10
});

/** Steps the controller knows how to run. */
export const LOOP_STEP = Object.freeze({ SUPPLY: 'supply', BORROW: 'borrow', SWAP: 'swap' });

const num = (value) => (value == null || value === '' || !Number.isFinite(Number(value)) ? null : Number(value));
const big = (value) => {
  if (value == null || value === '') return null;
  try { return typeof value === 'bigint' ? value : BigInt(String(value)); } catch { return null; }
};
const sameAddress = (a, b) => typeof a === 'string' && typeof b === 'string' && a.toLowerCase() === b.toLowerCase();

/* ═══════════════════════════════════════════════════════════════════════════
   UNIT CONVERSION
   Floats are used only for USD, and only through micro-token precision, so a
   18-decimal token never meets a float with 21 significant digits.
   ═══════════════════════════════════════════════════════════════════════════ */

/** USD → token base units, floored. null when the price or decimals are unusable. */
export function usdToWei(usd, priceUsd, decimals) {
  const u = num(usd);
  const p = num(priceUsd);
  const d = Number(decimals);
  if (u == null || p == null || p <= 0 || !Number.isInteger(d) || d < 0 || d > 36) return null;
  if (u <= 0) return 0n;
  const micro = Math.floor((u / p) * 1e6);
  if (!Number.isFinite(micro) || micro < 0) return null;
  const microBig = BigInt(micro);
  return d >= 6 ? microBig * 10n ** BigInt(d - 6) : microBig / 10n ** BigInt(6 - d);
}

/** Token base units → USD (float). null when unusable. */
export function weiToUsd(wei, priceUsd, decimals) {
  const w = big(wei);
  const p = num(priceUsd);
  const d = Number(decimals);
  if (w == null || p == null || p < 0 || !Number.isInteger(d) || d < 0 || d > 36) return null;
  if (w <= 0n) return 0;
  return Number(formatWeiFloor(w, d, Math.min(d, 12))) * p;
}

/** Token base units → a decimal string the swap quoter accepts (full precision). */
export function weiToDecimalString(wei, decimals) {
  const w = big(wei);
  const d = Number(decimals);
  if (w == null || w <= 0n || !Number.isInteger(d) || d < 0) return null;
  return formatWeiFloor(w, d, d);
}

/* ═══════════════════════════════════════════════════════════════════════════
   HEALTH-FACTOR PROJECTIONS — Aave's definition, on USD totals
     HF = Σ(collateral × LT) / debt
   ═══════════════════════════════════════════════════════════════════════════ */

/** The account's HF after adding collateral (supply) worth `addUsd` at `addLtPct`. */
export function projectHealthAfterSupply({ account, addUsd, addLtPct }) {
  const coll = num(account?.totalCollateralUsd);
  const debt = num(account?.totalDebtUsd);
  const lt = num(account?.liquidationThresholdPct);
  const add = num(addUsd);
  const addLt = num(addLtPct);
  if (coll == null || debt == null || lt == null || add == null || addLt == null) return null;
  if (debt <= 0) return Infinity;
  return (coll * lt / 100 + add * addLt / 100) / debt;
}

/** The account's HF after adding debt worth `borrowUsd`. */
export function projectHealthAfterBorrow({ account, borrowUsd }) {
  const coll = num(account?.totalCollateralUsd);
  const debt = num(account?.totalDebtUsd);
  const lt = num(account?.liquidationThresholdPct);
  const add = num(borrowUsd);
  if (coll == null || debt == null || lt == null || add == null) return null;
  const nextDebt = debt + add;
  if (nextDebt <= 0) return Infinity;
  return (coll * lt / 100) / nextDebt;
}

/* ═══════════════════════════════════════════════════════════════════════════
   LIVE MARKET INPUTS
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Pull the two legs out of the page's market snapshot and say — with codes,
 * never with a guessed number — why the pair cannot be looped right now.
 */
export function readLoopMarket({ assets = [], reserves = {}, prices = {}, collateralId = null, borrowId = null } = {}) {
  const list = Array.isArray(assets) ? assets : [];
  const collateral = list.find((a) => a?.id === collateralId) ?? null;
  const borrow = list.find((a) => a?.id === borrowId) ?? null;
  const errors = [];
  if (!collateral) errors.push('COLLATERAL_REQUIRED');
  if (!borrow) errors.push('BORROW_REQUIRED');

  const cr = collateral ? reserves?.[collateral.id] ?? null : null;
  const br = borrow ? reserves?.[borrow.id] ?? null : null;
  const cp = collateral ? prices?.[collateral.id] ?? null : null;
  const bp = borrow ? prices?.[borrow.id] ?? null : null;

  if (collateral) {
    if (!cr || cr.listed == null) errors.push('MARKET_UNAVAILABLE');
    else if (cr.listed === false) errors.push('COLLATERAL_NOT_LISTED');
    else {
      if (cr.status === 'paused') errors.push('COLLATERAL_PAUSED');
      else if (cr.status === 'frozen') errors.push('COLLATERAL_FROZEN');
      if (!(num(cr.ltvPct) > 0)) errors.push('COLLATERAL_LTV_ZERO');
      if (!(num(cr.liquidationThresholdPct) > 0)) errors.push('COLLATERAL_LTV_ZERO');
    }
  }
  if (borrow) {
    if (!br || br.listed == null) { if (!errors.includes('MARKET_UNAVAILABLE')) errors.push('MARKET_UNAVAILABLE'); }
    else if (br.listed === false) errors.push('BORROW_NOT_LISTED');
    else {
      if (br.status === 'paused') errors.push('BORROW_PAUSED');
      else if (br.status === 'frozen') errors.push('BORROW_FROZEN');
      if (br.borrowingEnabled === false) errors.push('BORROWING_DISABLED');
    }
  }
  const collateralPriceUsd = num(cp?.usd);
  const borrowPriceUsd = num(bp?.usd);
  if ((collateral && !(collateralPriceUsd > 0)) || (borrow && !(borrowPriceUsd > 0))) errors.push('PRICE_UNAVAILABLE');

  const unique = [...new Set(errors)];
  return {
    ok: unique.length === 0,
    errors: unique,
    collateral,
    borrow,
    sameAsset: Boolean(collateral && borrow && sameAddress(collateral.address, borrow.address)),
    collateralReserve: cr,
    borrowReserve: br,
    collateralDecimals: Number(cr?.decimals ?? collateral?.decimals ?? 18),
    borrowDecimals: Number(br?.decimals ?? borrow?.decimals ?? 18),
    ltvPct: num(cr?.ltvPct),
    liquidationThresholdPct: num(cr?.liquidationThresholdPct),
    supplyApyPct: num(cr?.supplyApyPct),
    borrowApyPct: num(br?.borrowApyPct),
    collateralPriceUsd,
    borrowPriceUsd
  };
}

/* ═══════════════════════════════════════════════════════════════════════════
   SETTINGS
   ═══════════════════════════════════════════════════════════════════════════ */

export function validateLoopSettings(settings = {}) {
  const errors = [];
  const rounds = Number(settings.rounds);
  if (!Number.isInteger(rounds) || rounds < 1 || rounds > LOOP_MAX_ROUNDS) errors.push('ROUNDS_INVALID');
  const headroomPct = num(settings.headroomPct);
  if (headroomPct == null || headroomPct < 0 || headroomPct > LOOP_PLAN_LIMITS.maxHeadroomPct) errors.push('HEADROOM_INVALID');
  const minHealthFactor = num(settings.minHealthFactor);
  if (minHealthFactor == null || minHealthFactor < LOOP_MIN_HEALTH_FACTOR || minHealthFactor > LOOP_PLAN_LIMITS.maxTargetHealthFactor) {
    errors.push('MIN_HF_INVALID');
  }
  const slippagePct = num(settings.slippagePct);
  if (slippagePct == null || slippagePct < LOOP_PLAN_LIMITS.minSlippagePct || slippagePct > LOOP_PLAN_LIMITS.maxSlippagePct) {
    errors.push('SLIPPAGE_INVALID');
  }
  return {
    ok: errors.length === 0,
    errors,
    value: { rounds, headroomPct, minHealthFactor, slippagePct }
  };
}

/* ═══════════════════════════════════════════════════════════════════════════
   THE PLAN
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * @param {object} p
 * @param {object[]} p.assets          lendingAssetsFor(chain)
 * @param {object}   p.reserves        snapshot.reserves (keyed by asset id)
 * @param {object}   p.prices          snapshot.prices   (keyed by asset id)
 * @param {object}   p.positions       snapshot.positions (walletWei/suppliedWei/debtWei)
 * @param {object}   p.account         snapshot.account (null = wallet not connected)
 * @param {object}   p.userConfiguration snapshot.userConfiguration
 * @param {string}   p.collateralId
 * @param {string}   p.borrowId
 * @param {string}   p.amount          the initial supply, typed (may be '' / '0')
 * @param {object}   p.settings        { rounds, headroomPct, minHealthFactor, slippagePct }
 * @param {number}   p.swapFeeBps      the platform fee the swap leg carries
 */
export function buildLiveLoopPlan({
  assets = [],
  reserves = {},
  prices = {},
  positions = {},
  account = null,
  userConfiguration = null,
  collateralId = null,
  borrowId = null,
  amount = '',
  settings = LOOP_PLAN_DEFAULTS,
  swapFeeBps = 70
} = {}) {
  const market = readLoopMarket({ assets, reserves, prices, collateralId, borrowId });
  const checked = validateLoopSettings(settings);
  const errors = [...market.errors, ...checked.errors];
  const warnings = [];
  const { rounds, headroomPct, minHealthFactor, slippagePct } = checked.value;

  /* ── the initial supply ───────────────────────────────────────────────── */
  let initialWei = 0n;
  const typed = String(amount ?? '').trim();
  if (typed && market.collateral) {
    if (/^0*(\.0*)?$/.test(typed)) {
      initialWei = 0n;
    } else {
      const parsed = parseAmountWei(typed, market.collateralDecimals);
      if (!parsed.ok) errors.push('AMOUNT_INVALID');
      else initialWei = parsed.wei;
    }
  }
  const walletWei = market.collateral ? big(positions?.[market.collateral.id]?.walletWei) : null;
  if (initialWei > 0n && walletWei != null && initialWei > walletWei) errors.push('AMOUNT_OVER_BALANCE');

  /* ── where the account starts ─────────────────────────────────────────── */
  const accountKnown = Boolean(account?.ok);
  if (account && !account.ok) errors.push('ACCOUNT_UNAVAILABLE');
  const startCollateralUsd = accountKnown ? Math.max(0, num(account.totalCollateralUsd) ?? 0) : 0;
  const startDebtUsd = accountKnown ? Math.max(0, num(account.totalDebtUsd) ?? 0) : 0;
  const startLtPct = accountKnown ? Math.max(0, num(account.liquidationThresholdPct) ?? 0) : 0;
  const startLtvPct = accountKnown ? Math.max(0, num(account.ltvPct) ?? 0) : 0;

  /* An empty field is "not decided yet", not "zero": looping on existing
     collateral alone is allowed, but only when the user types 0 for it. */
  if (!typed) errors.push('AMOUNT_REQUIRED');
  else if (initialWei === 0n && startCollateralUsd <= 0 && !errors.includes('AMOUNT_INVALID')) errors.push('NOTHING_TO_LOOP');

  /* Supplying more of an asset whose collateral switch the user turned off
     adds no borrowing power: the loop would borrow nothing. Said up front. */
  if (market.collateral) {
    const supplied = big(positions?.[market.collateral.id]?.suppliedWei);
    const entry = userConfiguration?.entries?.[market.collateral.id];
    if (supplied != null && supplied > 0n && entry && entry.usingAsCollateral === false) errors.push('COLLATERAL_DISABLED');
  }

  const uniqueErrors = [...new Set(errors)];
  const base = {
    ok: false,
    errors: uniqueErrors,
    warnings,
    market,
    settings: checked.value,
    accountKnown,
    sameAsset: market.sameAsset,
    initialWei: initialWei.toString(),
    walletWei: walletWei != null ? walletWei.toString() : null,
    rows: [],
    steps: [],
    summary: null
  };
  /* Without valid market inputs there is nothing honest to project. */
  if (!market.ok || !checked.ok || uniqueErrors.includes('AMOUNT_INVALID')) return base;
  if (uniqueErrors.includes('AMOUNT_REQUIRED') && startCollateralUsd <= 0) return base;

  const ltPct = market.liquidationThresholdPct;
  const ltvPct = market.ltvPct;
  const swapCostPct = market.sameAsset ? 0 : (Number(swapFeeBps) || 0) / 100 + slippagePct;
  const initialUsd = weiToUsd(initialWei, market.collateralPriceUsd, market.collateralDecimals) ?? 0;

  let collateralUsd = startCollateralUsd + initialUsd;
  let ltSum = startCollateralUsd * startLtPct / 100 + initialUsd * ltPct / 100;
  let ltvSum = startCollateralUsd * startLtvPct / 100 + initialUsd * ltvPct / 100;
  let debtUsd = startDebtUsd;
  const startingHealthFactor = debtUsd > 0 ? ltSum / debtUsd : null;

  const rows = [];
  let endedBy = null;
  for (let round = 1; round <= rounds; round += 1) {
    const ltvRoom = ltvSum * (1 - headroomPct / 100) - debtUsd;
    const hfRoom = ltSum / minHealthFactor - debtUsd;
    const borrowUsd = Math.max(0, Math.min(ltvRoom, hfRoom));
    if (borrowUsd < LOOP_PLAN_LIMITS.minStepUsd) { endedBy = round === 1 ? 'NOTHING_TO_BORROW' : 'NO_MORE_CAPACITY'; break; }
    const limitedBy = hfRoom <= ltvRoom ? 'health-factor' : 'ltv-headroom';
    const debtAfter = debtUsd + borrowUsd;
    const healthFactorAtBorrow = ltSum / debtAfter;
    const suppliedUsd = borrowUsd * (1 - swapCostPct / 100);
    collateralUsd += suppliedUsd;
    ltSum += suppliedUsd * ltPct / 100;
    ltvSum += suppliedUsd * ltvPct / 100;
    debtUsd = debtAfter;
    rows.push({
      round,
      borrowUsd,
      borrowWei: (usdToWei(borrowUsd, market.borrowPriceUsd, market.borrowDecimals) ?? 0n).toString(),
      suppliedUsd,
      suppliedWei: (usdToWei(suppliedUsd, market.collateralPriceUsd, market.collateralDecimals) ?? 0n).toString(),
      collateralUsd,
      debtUsd,
      healthFactorAtBorrow,
      healthFactor: ltSum / debtUsd,
      liquidationDropAtBorrowPct: liquidationDropPct(healthFactorAtBorrow),
      limitedBy
    });
  }

  if (endedBy === 'NOTHING_TO_BORROW') uniqueErrors.push('NOTHING_TO_BORROW');
  else if (endedBy === 'NO_MORE_CAPACITY') warnings.push('ROUNDS_TRUNCATED');

  const totalBorrowUsd = rows.reduce((sum, row) => sum + row.borrowUsd, 0);
  const loopSuppliedUsd = rows.reduce((sum, row) => sum + row.suppliedUsd, 0);
  const swapCostUsd = totalBorrowUsd - loopSuppliedUsd;
  const platformFeeUsd = market.sameAsset ? 0 : totalBorrowUsd * (Number(swapFeeBps) || 0) / 10000;
  const equityUsd = startCollateralUsd - startDebtUsd + initialUsd;
  const loopCollateralUsd = initialUsd + loopSuppliedUsd;
  const capitalUsd = initialUsd > 0 ? initialUsd : equityUsd;
  const sApy = market.supplyApyPct;
  const bApy = market.borrowApyPct;
  const yearlyNetUsd = sApy != null && bApy != null
    ? (loopCollateralUsd * sApy - totalBorrowUsd * bApy) / 100
    : null;
  const netApyPct = yearlyNetUsd != null && capitalUsd > 0 ? (yearlyNetUsd / capitalUsd) * 100 : null;
  const last = rows[rows.length - 1] ?? null;
  const finalHealthFactor = last ? last.healthFactor : startingHealthFactor;
  const lowestHealthFactor = rows.length
    ? Math.min(...rows.map((row) => row.healthFactorAtBorrow))
    : startingHealthFactor;

  /* Protocol limits the run would hit part-way. The runtime stops safely at
     them (a supply that would breach the cap reverts in its eth_call; a borrow
     is capped at liquidity and cap room) — the user should know up front. */
  const collateralReserve = market.collateralReserve ?? null;
  const borrowReserve = market.borrowReserve ?? null;
  const plannedSupplyWei = initialWei + rows.reduce((sum, row) => sum + (big(row.suppliedWei) ?? 0n), 0n);
  const supplyCap = big(collateralReserve?.supplyCapWei);
  const totalSupplied = big(collateralReserve?.totalSupplyWei);
  if (supplyCap != null && supplyCap > 0n && totalSupplied != null) {
    const room = supplyCap > totalSupplied ? supplyCap - totalSupplied : 0n;
    if (room === 0n) uniqueErrors.push('SUPPLY_CAP_REACHED');
    else if (plannedSupplyWei > room) warnings.push('SUPPLY_CAP_TIGHT');
  }
  const plannedBorrowWei = rows.reduce((sum, row) => sum + (big(row.borrowWei) ?? 0n), 0n);
  const liquidity = big(borrowReserve?.availableLiquidityWei);
  const borrowCap = big(borrowReserve?.borrowCapWei);
  const totalBorrowed = big(borrowReserve?.totalDebtWei);
  const borrowRoom = borrowCap != null && borrowCap > 0n && totalBorrowed != null
    ? (borrowCap > totalBorrowed ? borrowCap - totalBorrowed : 0n)
    : null;
  if ((liquidity != null && plannedBorrowWei > liquidity) || (borrowRoom != null && plannedBorrowWei > borrowRoom)) {
    warnings.push('BORROW_LIQUIDITY_TIGHT');
  }
  /* Every step is its own transaction; on Ethereum L1 that is real money. */
  if (Number(market.collateral?.chain) === 1) warnings.push('L1_GAS');

  if (netApyPct != null && netApyPct < 0) warnings.push('NEGATIVE_CARRY');
  if (minHealthFactor < 1.2) warnings.push('TIGHT_HEALTH_FACTOR');
  if (accountKnown && (startDebtUsd > 0 || startCollateralUsd > 0)) warnings.push('EXISTING_POSITION');
  if (!accountKnown) warnings.push('PREVIEW_ONLY');
  if (sApy == null || bApy == null) warnings.push('RATES_UNAVAILABLE');

  /* ── the steps the controller will walk ───────────────────────────────── */
  const steps = [];
  const collateral = market.collateral;
  const borrow = market.borrow;
  if (initialWei > 0n) {
    steps.push({
      key: 'supply-0', id: LOOP_STEP.SUPPLY, round: 0,
      asset: collateral, symbol: collateral.symbol,
      amountWei: initialWei.toString(), fixedAmount: true,
      projectedUsd: initialUsd
    });
  }
  for (const row of rows) {
    steps.push({
      key: `borrow-${row.round}`, id: LOOP_STEP.BORROW, round: row.round,
      asset: borrow, symbol: borrow.symbol,
      plannedWei: row.borrowWei, projectedUsd: row.borrowUsd,
      projectedHealthFactor: row.healthFactorAtBorrow
    });
    if (!market.sameAsset) {
      steps.push({
        key: `swap-${row.round}`, id: LOOP_STEP.SWAP, round: row.round,
        asset: borrow, fromAsset: borrow, toAsset: collateral,
        fromSymbol: borrow.symbol, toSymbol: collateral.symbol, symbol: borrow.symbol,
        amountFromKey: `borrow-${row.round}`,
        projectedUsd: row.borrowUsd, projectedOutWei: row.suppliedWei
      });
    }
    steps.push({
      key: `supply-${row.round}`, id: LOOP_STEP.SUPPLY, round: row.round,
      asset: collateral, symbol: collateral.symbol,
      amountFromKey: market.sameAsset ? `borrow-${row.round}` : `swap-${row.round}`,
      projectedUsd: row.suppliedUsd, projectedWei: row.suppliedWei,
      projectedHealthFactor: row.healthFactor
    });
  }

  const finalErrors = [...new Set(uniqueErrors)];
  return {
    ...base,
    ok: finalErrors.length === 0 && steps.length > 0 && rows.length > 0,
    errors: finalErrors,
    warnings: [...new Set(warnings)],
    rows,
    steps,
    summary: {
      roundsPlanned: rounds,
      roundsPossible: rows.length,
      initialUsd,
      startCollateralUsd,
      startDebtUsd,
      startingHealthFactor,
      finalCollateralUsd: collateralUsd,
      finalDebtUsd: debtUsd,
      finalHealthFactor,
      lowestHealthFactor,
      liquidationDropPct: finalHealthFactor != null && Number.isFinite(finalHealthFactor) ? liquidationDropPct(finalHealthFactor) : null,
      leverage: equityUsd > 0 ? collateralUsd / equityUsd : null,
      totalBorrowUsd,
      loopSuppliedUsd,
      swapCostUsd,
      swapCostPct,
      platformFeeUsd,
      yearlyNetUsd,
      netApyPct,
      equityUsd
    }
  };
}

/* ═══════════════════════════════════════════════════════════════════════════
   EXECUTION-TIME AMOUNTS — called with FRESH reads before each signature
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * How much can this borrow step take RIGHT NOW without crossing either safety
 * limit — and never more than the plan the user reviewed.
 *
 * @returns {{ ok:true, finish?:true, amountWei?:string, amountUsd?:number,
 *             projectedHealthFactor?:number, limitedBy?:string, code?:string }
 *          | { ok:false, code:string }}
 */
export function resolveBorrowAmount({
  account,
  priceUsd,
  decimals,
  reserve = null,
  headroomPct,
  minHealthFactor,
  plannedWei = null,
  minStepUsd = LOOP_PLAN_LIMITS.minStepUsd,
  capacityHeadroomBps = LOOP_PLAN_LIMITS.capacityHeadroomBps
} = {}) {
  if (!account?.ok) return { ok: false, code: 'RISK_DATA_UNAVAILABLE' };
  const coll = num(account.totalCollateralUsd);
  const debt = num(account.totalDebtUsd);
  const lt = num(account.liquidationThresholdPct);
  const ltv = num(account.ltvPct);
  const available = num(account.availableBorrowsUsd);
  const price = num(priceUsd);
  const dec = Number(decimals);
  if (coll == null || debt == null || lt == null || ltv == null || available == null) return { ok: false, code: 'RISK_DATA_UNAVAILABLE' };
  if (price == null || price <= 0) return { ok: false, code: 'ORACLE_PRICE_UNAVAILABLE' };
  if (!Number.isInteger(dec) || dec < 0 || dec > 36) return { ok: false, code: 'DECIMALS_UNKNOWN' };
  const floor = Math.max(LOOP_MIN_HEALTH_FACTOR, num(minHealthFactor) ?? LOOP_MIN_HEALTH_FACTOR);
  const headroom = Math.min(LOOP_PLAN_LIMITS.maxHeadroomPct, Math.max(0, num(headroomPct) ?? 0));

  const candidates = [
    { id: 'ltv-headroom', usd: coll * ltv / 100 * (1 - headroom / 100) - debt },
    { id: 'health-factor', usd: coll * lt / 100 / floor - debt },
    { id: 'borrow-capacity', usd: available * (1 - capacityHeadroomBps / 10000) }
  ];
  let binding = candidates[0];
  for (const c of candidates) if (c.usd < binding.usd) binding = c;
  let amountWei = usdToWei(Math.max(0, binding.usd), price, dec);
  if (amountWei == null) return { ok: false, code: 'ORACLE_PRICE_UNAVAILABLE' };
  let limitedBy = binding.id;

  const liquidity = big(reserve?.availableLiquidityWei);
  if (liquidity != null && liquidity < amountWei) { amountWei = liquidity; limitedBy = 'available-liquidity'; }
  const cap = big(reserve?.borrowCapWei);
  const totalDebt = big(reserve?.totalDebtWei);
  if (cap != null && cap > 0n && totalDebt != null) {
    const room = cap > totalDebt ? cap - totalDebt : 0n;
    if (room < amountWei) { amountWei = room; limitedBy = 'borrow-cap'; }
  }
  const planned = big(plannedWei);
  if (planned != null && planned > 0n && planned < amountWei) { amountWei = planned; limitedBy = 'reviewed-plan'; }

  const amountUsd = weiToUsd(amountWei, price, dec) ?? 0;
  if (amountWei <= 0n || amountUsd < minStepUsd) {
    return { ok: true, finish: true, code: 'NO_MORE_CAPACITY', amountWei: '0', amountUsd, limitedBy };
  }
  const projectedHealthFactor = projectHealthAfterBorrow({ account, borrowUsd: amountUsd });
  if (projectedHealthFactor == null || projectedHealthFactor < floor) {
    /* Rounding can only make this smaller than the limit by dust; refusing is
       still the right answer when it happens. */
    return { ok: false, code: 'HEALTH_FACTOR_BELOW_FLOOR', projectedHealthFactor, minimum: floor };
  }
  return { ok: true, amountWei: amountWei.toString(), amountUsd, projectedHealthFactor, limitedBy, minimum: floor };
}

/**
 * The amount a supply step deposits: the fixed initial amount, or what the
 * previous leg actually produced — capped by what the wallet really holds.
 */
export function resolveSupplyAmount({ step, resolved = {}, walletWei = null } = {}) {
  let amount = null;
  if (step?.fixedAmount) amount = big(step.amountWei);
  else if (step?.amountFromKey) {
    const source = resolved[step.amountFromKey];
    amount = big(source?.receivedWei ?? source?.amountWei);
  }
  if (amount == null) return { ok: false, code: 'PREVIOUS_STEP_UNRESOLVED' };
  const balance = big(walletWei);
  if (balance != null && balance < amount) {
    /* A fixed amount the wallet no longer holds is the user's decision to
       revisit, not ours to shrink. A derived amount (swap/borrow output) is
       capped: a fee-on-transfer or rounding dust must not stall the loop. */
    if (step?.fixedAmount) return { ok: false, code: 'INSUFFICIENT_BALANCE' };
    amount = balance;
  }
  if (amount <= 0n) return { ok: false, code: 'INSUFFICIENT_BALANCE' };
  return { ok: true, amountWei: amount.toString() };
}

/**
 * The swap's worst case, measured against the protocol's own oracle: how much
 * value is lost if the swap fills at its on-chain minimum. A route that would
 * lose more than fee + slippage + a 1% allowance for oracle/DEX drift is
 * refused, because the next supply would then deposit less than the borrow
 * the user just took on.
 */
export function assessSwapQuote({ quote, fromPriceUsd, toPriceUsd, fromDecimals, toDecimals, slippagePct, feeBps, driftAllowancePct = 1 } = {}) {
  const amountIn = big(quote?.amountInWei);
  const minOut = big(quote?.minOutWei);
  const out = big(quote?.amountOutWei);
  if (amountIn == null || minOut == null || out == null || amountIn <= 0n || out <= 0n || minOut <= 0n) {
    return { ok: false, code: 'QUOTE_INVALID' };
  }
  const inUsd = weiToUsd(amountIn, fromPriceUsd, fromDecimals);
  const minOutUsd = weiToUsd(minOut, toPriceUsd, toDecimals);
  const outUsd = weiToUsd(out, toPriceUsd, toDecimals);
  if (inUsd == null || minOutUsd == null || outUsd == null || inUsd <= 0) return { ok: false, code: 'ORACLE_PRICE_UNAVAILABLE' };
  const worstLossPct = (1 - minOutUsd / inUsd) * 100;
  const expectedLossPct = (1 - outUsd / inUsd) * 100;
  const allowedLossPct = (Number(feeBps) || 0) / 100 + Number(slippagePct || 0) + Number(driftAllowancePct || 0);
  if (!(worstLossPct <= allowedLossPct)) {
    return { ok: false, code: 'SWAP_LOSS_TOO_HIGH', worstLossPct, expectedLossPct, allowedLossPct };
  }
  return { ok: true, inUsd, minOutUsd, outUsd, worstLossPct, expectedLossPct, allowedLossPct };
}
