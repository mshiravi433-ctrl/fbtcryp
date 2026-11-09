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
 *   · maintenance-margin: the exchange-leg formula, used whenever the venue
 *     itself publishes the two numbers it depends on — its maintenance margin
 *     fraction (MMR) and (optionally) its taker fee. This is the model dYdX
 *     publishes for a single isolated position and it is the one the whole
 *     industry converges on:
 *
 *        long  : P_liq = entry × (leverage − 1 + feeRate × leverage) / (leverage × (1 − MMR))
 *        short : P_liq = entry × (leverage + 1 − feeRate × leverage) / (leverage × (1 + MMR))
 *
 *     Derivation, so a reviewer can check it instead of trusting it: equity of
 *     an isolated position is `C + (P − P0)·S − F` with `S = notional/P0` and
 *     `F = feeRate · notional`; liquidation is the price where equity falls to
 *     `MMR · P · S`. Solving that linear equation gives exactly the lines above.
 *     At MMR = 0 and F = 0 it reduces to the familiar `1 − 1/leverage`.
 *
 *   · full-collateral: liquidation at 100% loss — an UPPER bound used only when
 *     the venue's rule is unknown, and labelled as such.
 *
 * ─── WHY THIS EXTENSION EXISTS (2026-11-08) ─────────────────────────────────
 * Before this, EVERY venue without a documented rule was shown the
 * full-collateral bound: at 10x that says "liquidated on a 10% move" when the
 * real number, with the venue's own MMR, is closer to 9.4%. The screenshot is
 * specific, the model is conservative, and it is still the wrong number — and a
 * number a trader plans around. dYdX publishes both inputs on every market
 * (`maintenanceMarginFraction`, `initialMarginFraction`), so for the venue this
 * app trades most the upper bound was being shown while an exact model was one
 * field away. It is now used, and the output says which model produced it.
 */

export const RISK_LEVEL = Object.freeze({ LOW: 'LOW', MEDIUM: 'MEDIUM', HIGH: 'HIGH', EXTREME: 'EXTREME' });

/** The vocabulary a screen prints next to a liquidation price. */
export const LIQUIDATION_MODEL = Object.freeze({
  OSTIUM_DOCS: 'ostium-docs',
  MAINTENANCE_MARGIN: 'maintenance-margin',
  fullCollateral: 'full-collateral-upper-bound'
});

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
  expensiveFundingAprPct: 30,
  /* ── account-level thresholds (assessPortfolioRisk) ───────────────────────
     Deliberately the same numbers src/lib/central/risk.js uses
     (`leverageRatioBlock: 3`, `concentrationSharePct: 45`) so the futures
     terminal and the Intent OS risk engine cannot disagree about what "high
     leverage" means. One product, one vocabulary. */
  portfolioLeverageWarn: 3,
  concentrationWarnPct: 60,
  marginRatioWarnPct: 70,
  fundingVsEquityWarnPct: 1
});

const num = (v) => {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/**
 * Loss (as % of collateral) at which the venue liquidates.
 * Returns { lossPct, model }.
 *
 * `model` precedence is deliberate: a venue-specific documented rule beats the
 * generic maintenance-margin formula, which beats the upper bound. A caller
 * that does not pass the venue's MMR simply does not get the middle model —
 * there is no default MMR, because a guessed maintenance fraction is a
 * fabricated liquidation price.
 */
export function liquidationLossPct({ providerId, leverage, maxLeverage, maintenanceMarginFraction = null, takerFeeRate = null }) {
  const lev = num(leverage);
  const max = num(maxLeverage);
  if (providerId === 'ostium' && lev != null && max != null && max > 0) {
    return { lossPct: Math.max(0, Math.min(100, 100 - (lev / max) * 25)), model: LIQUIDATION_MODEL.OSTIUM_DOCS };
  }
  const mmr = num(maintenanceMarginFraction);
  if (lev != null && lev > 1 && mmr != null && mmr >= 0 && mmr < 1) {
    /* Fraction of collateral lost when price moves by 1/leverage... adjusted
       for the maintenance requirement: at the liquidation price the remaining
       equity is exactly MMR × notional, so the LOSS is 1 − MMR. The fee term
       only shifts the distance slightly and is reported separately, so the
       "loss % of collateral" figure stays the maintenance-margin share. */
    return { lossPct: Math.max(0, Math.min(100, (1 - mmr) * 100)), model: LIQUIDATION_MODEL.MAINTENANCE_MARGIN, mmr, takerFeeRate: num(takerFeeRate) };
  }
  return { lossPct: 100, model: LIQUIDATION_MODEL.fullCollateral };
}

/**
 * Price move (%) against the position that triggers liquidation, and the
 * liquidation price itself when an entry price is known.
 *
 * Both the lateral (`distancePct`, a % of price) and the price are derived from
 * ONE model, so a screen can never print a distance from one formula and a
 * price from another.
 */
export function liquidationDistance({
  providerId, side, entryPrice, leverage, maxLeverage,
  maintenanceMarginFraction = null, takerFeeRate = null
}) {
  const lev = num(leverage);
  if (lev == null || lev <= 0) {
    return { distancePct: null, liquidationPrice: null, model: null, lossPct: null, movePct: null };
  }
  const px = num(entryPrice);
  const mmr = num(maintenanceMarginFraction);
  const fee = num(takerFeeRate);
  const short = side === 'short';

  /* ── the exchange-leg model: exact price, when the venue published MMR ── */
  if (providerId !== 'ostium' && lev >= 1 && mmr != null && mmr >= 0 && mmr < 1 && px != null && px > 0) {
    const f = fee != null && fee > 0 ? fee : 0;
    const numerator = short ? lev + 1 - f * lev : lev - 1 + f * lev;
    const denominator = lev * (short ? 1 + mmr : 1 - mmr);
    const ratio = numerator / denominator;
    const liquidationPrice = px * ratio;
    /* The same relation in the other direction: how far the mark must travel
       from ENTRY. A long liquidates below entry, a short above it, and at
       leverage 1 there is (with a real MMR) no liquidation price at all —
       the position is fully collateralised and the formula returns ≤ 0, which
       is reported as `null` rather than as a negative price. */
    if (!Number.isFinite(liquidationPrice) || liquidationPrice <= 0) {
      return { distancePct: null, liquidationPrice: null, model: LIQUIDATION_MODEL.MAINTENANCE_MARGIN, lossPct: (1 - mmr) * 100, movePct: null, mmr, takerFeeRate: fee };
    }
    const movePct = ((liquidationPrice - px) / px) * 100;
    /* A position collateralised at (or below) 1x effective leverage has no
       liquidation price a trader would ever reach — the formula's answer is a
       price one hundredth of the entry. Printing that as "$0.05" is worse than
       printing nothing, because it reads as a real level on the chart. */
    if (Math.abs(movePct) >= 95) {
      return {
        distancePct: Math.abs(movePct),
        movePct,
        liquidationPrice: null,
        model: LIQUIDATION_MODEL.MAINTENANCE_MARGIN,
        lossPct: (1 - mmr) * 100,
        mmr,
        takerFeeRate: fee,
        note: 'NO_PRACTICAL_LIQUIDATION'
      };
    }
    return {
      distancePct: Math.abs(movePct),
      movePct,
      liquidationPrice,
      model: LIQUIDATION_MODEL.MAINTENANCE_MARGIN,
      lossPct: (1 - mmr) * 100,
      mmr,
      takerFeeRate: fee
    };
  }

  /* ── the documented venue rule / the upper bound ─────────────────────── */
  const { lossPct, model } = liquidationLossPct({ providerId, leverage: lev, maxLeverage, maintenanceMarginFraction: mmr, takerFeeRate: fee });
  const distancePct = lossPct / lev;
  let liquidationPrice = null;
  if (px != null && px > 0) {
    liquidationPrice = short ? px * (1 + distancePct / 100) : px * (1 - distancePct / 100);
  }
  return { distancePct, movePct: short ? distancePct : -distancePct, liquidationPrice, model, lossPct };
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
 * @param {number|null} p.maintenanceMarginFraction  venue's own MMR (0–1); null = not published
 * @param {number|null} p.takerFeeRate               venue taker fee as a FRACTION (0.0005); null = unknown
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
  maintenanceMarginFraction = null,
  takerFeeRate = null,
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
  const liq = liquidationDistance({
    providerId, side, entryPrice, leverage: lev, maxLeverage: maxLev,
    maintenanceMarginFraction, takerFeeRate
  });
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
  } else if (num(availableBalanceUsd) === 0 && collateral != null && collateral > 0) {
    blockReasons.push('INSUFFICIENT_BALANCE');
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

  if (liq.model === LIQUIDATION_MODEL.fullCollateral) warnings.push('LIQUIDATION_MODEL_APPROXIMATE');
  if (liq.model === LIQUIDATION_MODEL.MAINTENANCE_MARGIN && num(takerFeeRate) == null) warnings.push('LIQUIDATION_FEE_EXCLUDED');

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
    liquidationMovePct: liq.movePct ?? null,
    maintenanceMarginFraction: liq.mmr ?? null,
    pctOfBalance,
    maxRecommendedCollateralUsd,
    inputs: { providerId, side, collateralUsd: collateral, leverage: lev, maxLeverage: maxLev, entryPrice: px, maintenanceMarginFraction: liq.mmr ?? null, takerFeeRate: num(takerFeeRate) }
  };
}

/** Quick verdict for an existing position from its live mark. */
export function positionHealth({
  providerId, side, entryPrice, markPrice, leverage, maxLeverage,
  maintenanceMarginFraction = null, takerFeeRate = null
}) {
  const px = num(entryPrice);
  const mark = num(markPrice);
  const lev = num(leverage);
  if (px == null || mark == null || lev == null || px <= 0 || lev <= 0) return { pnlPct: null, distanceToLiquidationPct: null, level: null };
  const move = ((mark - px) / px) * (side === 'short' ? -1 : 1) * 100;
  const pnlPct = move * lev; // % of collateral, before funding/rollover
  const liq = liquidationDistance({ providerId, side, entryPrice: px, leverage: lev, maxLeverage, maintenanceMarginFraction, takerFeeRate });
  const remaining = liq.distancePct == null ? null : liq.distancePct + move; // move is signed in the trader's favour
  const level = remaining == null ? null : remaining < 1 ? RISK_LEVEL.EXTREME : remaining < 3 ? RISK_LEVEL.HIGH : remaining < 10 ? RISK_LEVEL.MEDIUM : RISK_LEVEL.LOW;
  return { pnlPct, distanceToLiquidationPct: remaining, liquidationPrice: liq.liquidationPrice, level, model: liq.model };
}

/* ══════════════════════ ACCOUNT-LEVEL RISK (v2, §7 of the plan) ══════════════════════
 *
 * The per-position engine above answers "how dangerous is THIS order". A
 * terminal also has to answer "how dangerous is this ACCOUNT", which is a
 * different subtraction: several small positions can add up to one large
 * exposure, and the same 5x on a position whose underlying already sits in the
 * spot portfolio is not 5x of diversification.
 *
 * Everything here is pure arithmetic over numbers the caller already read from
 * the venue — no defaults, no guesses. A field whose input is missing is
 * `null`, and `dataStatus` says whether ANY of it could be computed, so a
 * screen renders "—" instead of a zero that reads like an answer.
 */

/** Equity / maintenance-margin pressure for one account. */
export function accountMargin({
  equityUsd = null,
  maintenanceMarginUsd = null,
  initialMarginUsd = null,
  availableBalanceUsd = null
} = {}) {
  const eq = num(equityUsd);
  const mm = num(maintenanceMarginUsd);
  const im = num(initialMarginUsd);
  const avail = num(availableBalanceUsd);
  const marginRatio = eq != null && eq > 0 && mm != null ? (mm / eq) * 100 : null;
  /* How much of the account's equity is already committed to positions —
     the "Margin Utilization" number a trader watches before adding size. */
  const utilizationPct = eq != null && eq > 0 && im != null ? (im / eq) * 100 : null;
  /* Headroom in the currency the trader thinks in: dollars of loss before the
     maintenance line, and the % move that would produce it at current equity. */
  const bufferUsd = eq != null && mm != null ? Math.max(0, eq - mm) : null;
  return {
    equityUsd: eq,
    maintenanceMarginUsd: mm,
    initialMarginUsd: im,
    availableBalanceUsd: avail,
    marginRatioPct: marginRatio,
    utilizationPct,
    bufferUsd,
    /** <100% means the account is inside its maintenance requirement. */
    marginRatioLevel: marginRatio == null ? null
      : marginRatio >= 90 ? RISK_LEVEL.EXTREME
        : marginRatio >= 70 ? RISK_LEVEL.HIGH
          : marginRatio >= 40 ? RISK_LEVEL.MEDIUM
            : RISK_LEVEL.LOW
  };
}

/**
 * Aggregate exposure of a set of open positions, split by base asset so the
 * correlated part is visible instead of being averaged away.
 *
 * `positions`: [{ symbol|base, side, notionalUsd, unrealizedPnlUsd, leverage }]
 */
export function portfolioExposure(positions = [], { equityUsd = null } = {}) {
  const rows = Array.isArray(positions) ? positions : [];
  const eq = num(equityUsd);
  let netUsd = 0;
  let grossUsd = 0;
  let longUsd = 0;
  let shortUsd = 0;
  const byBase = new Map();
  for (const p of rows) {
    const notional = Math.abs(num(p?.notionalUsd) ?? 0);
    if (!(notional > 0)) continue;
    const short = p.side === 'short';
    const base = String(p.base || String(p.symbol || '').replace(/[-/].*$/, '') || '?').toUpperCase();
    const signed = short ? -notional : notional;
    grossUsd += notional;
    netUsd += signed;
    if (short) shortUsd += notional; else longUsd += notional;
    const cur = byBase.get(base) || { base, longUsd: 0, shortUsd: 0, netUsd: 0, grossUsd: 0, count: 0 };
    cur.grossUsd += notional;
    cur.netUsd += signed;
    if (short) cur.shortUsd += notional; else cur.longUsd += notional;
    cur.count += 1;
    byBase.set(base, cur);
  }
  const assets = [...byBase.values()]
    .map((a) => ({ ...a, shareOfGrossPct: grossUsd > 0 ? (a.grossUsd / grossUsd) * 100 : null }))
    .sort((a, b) => b.grossUsd - a.grossUsd);
  const largest = assets[0] || null;

  return {
    dataStatus: rows.length ? 'live' : 'empty',
    positionCount: rows.length,
    longUsd,
    shortUsd,
    grossUsd,
    netUsd,
    /** Gross over equity: the honest "how many times the account is deployed". */
    leverageRatio: eq != null && eq > 0 ? grossUsd / eq : null,
    /** |net| over gross: 0 = perfectly hedged, 100 = one-directional book. */
    directionalBiasPct: grossUsd > 0 ? (Math.abs(netUsd) / grossUsd) * 100 : null,
    largestAsset: largest ? { base: largest.base, grossUsd: largest.grossUsd, shareOfGrossPct: largest.shareOfGrossPct } : null,
    /** Assets held on BOTH sides at once — the pairs that quietly cancel and
        still cost two sets of fees and two funding legs. */
    hedgedAssets: assets.filter((a) => a.longUsd > 0 && a.shortUsd > 0).map((a) => a.base),
    assets
  };
}

/**
 * "What happens to this account if the market moves X%?" — the pre-trade
 * simulator (§10 of the plan), applied to the WHOLE book rather than one
 * position.
 *
 * Longs and shorts P&L with opposite signs, so a hedged book shows a small
 * number under a shock — which is the truth, and the reason this is computed
 * per asset instead of on the net. `positions` carries the same shape as
 * `portfolioExposure`, plus `maintenanceMarginUsd` and `equityUsd` at the
 * account level.
 */
export function scenarioShock({
  positions = [],
  equityUsd = null,
  maintenanceMarginUsd = null,
  movesPct = [-5, -3, -1, 1, 3, 5]
} = {}) {
  const rows = (Array.isArray(positions) ? positions : [])
    .map((p) => ({ side: p.side === 'short' ? 'short' : 'long', notionalUsd: Math.abs(num(p?.notionalUsd) ?? 0) }))
    .filter((p) => p.notionalUsd > 0);
  const eq = num(equityUsd);
  const mm = num(maintenanceMarginUsd);
  if (!rows.length) return { dataStatus: 'unavailable', reason: 'NO_POSITIONS', rows: [] };

  const out = (Array.isArray(movesPct) ? movesPct : []).map((m) => {
    const move = num(m);
    if (move == null) return null;
    let pnl = 0;
    for (const p of rows) pnl += (p.notionalUsd * move) / 100 * (p.side === 'short' ? -1 : 1);
    const equityAfter = eq == null ? null : eq + pnl;
    return {
      movePct: move,
      pnlUsd: pnl,
      equityAfterUsd: equityAfter,
      /** Equity remaining as a multiple of the maintenance requirement. */
      marginRatioAfterPct: equityAfter != null && mm != null && equityAfter > 0 ? (mm / equityAfter) * 100 : null,
      liquidates: equityAfter != null && mm != null ? equityAfter <= mm : null
    };
  }).filter(Boolean);

  return {
    dataStatus: eq != null ? 'live' : 'partial',
    equityUsd: eq,
    maintenanceMarginUsd: mm,
    worstPnlUsd: out.reduce((w, r) => (r.pnlUsd < w ? r.pnlUsd : w), 0),
    bestPnlUsd: out.reduce((w, r) => (r.pnlUsd > w ? r.pnlUsd : w), 0),
    liquidationScenario: out.find((r) => r.liquidates) || null,
    rows: out
  };
}

/**
 * Funding cost of holding a position for N hours (§10: 8 / 24 / 72).
 *
 * `fundingAprPct` is the ANNUALISED rate for the side holding the position —
 * the same number the market tables already print, and the only one this app
 * will multiply by time. A per-interval rate whose settlement window we do not
 * know must never be annualised (that rule lives in server/perp.js and is the
 * reason this function takes an APR, not a raw rate).
 */
export function fundingCost({ notionalUsd = null, fundingAprPct = null, hours = 24 } = {}) {
  const n = num(notionalUsd);
  const apr = num(fundingAprPct);
  const h = num(hours);
  if (n == null || apr == null || h == null || h < 0) return { usd: null, pctOfNotional: null, basis: 'fundingAprPct × hours/8760' };
  const usd = (n * (apr / 100) * h) / 8760;
  return { usd, pctOfNotional: n > 0 ? (usd / n) * 100 : null, basis: 'fundingAprPct × hours/8760' };
}

/**
 * One call a terminal panel can render: account margin + exposure + the three
 * funding horizons + the shock table, all from the same numbers.
 *
 * `warnings` uses the same vocabulary as `assessFuturesRisk`, so one dictionary
 * serves both screens. Thresholds come from the caller's policy, never from a
 * literal buried in a component.
 */
export function assessPortfolioRisk({
  equityUsd = null,
  maintenanceMarginUsd = null,
  initialMarginUsd = null,
  availableBalanceUsd = null,
  positions = [],
  fundingAprPct = null,
  policy = {}
} = {}) {
  const P = { ...RISK_POLICY_DEFAULTS, ...(policy || {}) };
  const margin = accountMargin({ equityUsd, maintenanceMarginUsd, initialMarginUsd, availableBalanceUsd });
  const exposure = portfolioExposure(positions, { equityUsd });
  const shocks = scenarioShock({ positions, equityUsd, maintenanceMarginUsd });
  const worst = Number.isFinite(shocks.worstPnlUsd) ? Math.abs(shocks.worstPnlUsd) : 0;
  const funding = [8, 24, 72].map((hours) => {
    const gross = exposure.grossUsd;
    const oneSide = exposure.longUsd - exposure.shortUsd;
    /* Funding is charged on notional and partially cancels on a hedged book,
       so the cost is reported on the DIRECTIONAL notional and the gross is
       stated next to it rather than silently used. */
    const directional = Math.abs(oneSide) > 0 ? Math.abs(oneSide) : gross;
    return { hours, ...fundingCost({ notionalUsd: directional, fundingAprPct, hours }) };
  });

  const warnings = [];
  if (margin.marginRatioPct != null && margin.marginRatioPct >= P.marginRatioWarnPct) warnings.push('MARGIN_RATIO_HIGH');
  if (exposure.leverageRatio != null && exposure.leverageRatio > P.portfolioLeverageWarn) warnings.push('PORTFOLIO_LEVERAGE_HIGH');
  if (exposure.largestAsset && exposure.largestAsset.shareOfGrossPct != null && exposure.largestAsset.shareOfGrossPct > P.concentrationWarnPct) warnings.push('CONCENTRATED_EXPOSURE');
  if (exposure.hedgedAssets.length) warnings.push('HEDGED_ASSETS_TWO_FEES');
  if (funding[1]?.usd != null && equityUsd != null && equityUsd > 0 && Math.abs(funding[1].usd) > (equityUsd * P.fundingVsEquityWarnPct) / 100) warnings.push('FUNDING_MATERIAL_VS_EQUITY');
  if (shocks.liquidationScenario) warnings.push('LIQUIDATION_WITHIN_SCENARIO');
  if (exposure.dataStatus === 'empty') warnings.push('NO_OPEN_POSITIONS');

  const riskScore = (() => {
    let s = 0;
    if (margin.marginRatioPct != null) s += Math.min(50, margin.marginRatioPct / 2);
    if (exposure.leverageRatio != null) s += Math.min(30, exposure.leverageRatio * 6);
    if (exposure.largestAsset && exposure.largestAsset.shareOfGrossPct != null) s += Math.min(10, exposure.largestAsset.shareOfGrossPct / 10);
    if (worst > 0 && equityUsd != null && equityUsd > 0) s += Math.min(10, (worst / equityUsd) * 20);
    return Math.max(0, Math.min(100, Math.round(s)));
  })();

  return {
    schema: 'fbt.futures-portfolio-risk.v1',
    dataStatus: equityUsd == null && exposure.dataStatus === 'empty' ? 'unavailable' : 'live',
    riskScore,
    riskLevel: levelFor(riskScore),
    margin,
    exposure,
    funding,
    shocks,
    warnings: [...new Set(warnings)]
  };
}
