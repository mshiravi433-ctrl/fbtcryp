/**
 * THE RISK BRIDGE — one account, one answer, three modules that used to guess.
 * ---------------------------------------------------------------------------
 * The product now has THREE risk code paths and they had never met:
 *
 *   1. `futures-engine/risk.js`   per-position and per-account futures maths.
 *                                 Vocabulary: LOW / MEDIUM / HIGH / EXTREME.
 *   2. `central/risk.js`          the Intent OS verdict engine, driven by
 *                                 `assessRisk()` over the unified state.
 *                                 Vocabulary: LOW / MODERATE / ELEVATED / HIGH /
 *                                 CRITICAL, with RISK_LIMITS (concentration 45%,
 *                                 leverage 3× block / 1.5× warn, HF floor 1.35,
 *                                 liquidation distance warn 15%).
 *   3. `brain/opportunityEngine.js` the scan's per-row `compositeRisk`.
 *                                 Vocabulary: … / CRITICAL.
 *
 * A user could therefore be told "LOW" by the scan badge, "MEDIUM" by the desk
 * and "ELEVATED" by the brain about the SAME account. This module is the single
 * translation table and the single place where the futures layer feeds the
 * other two.
 *
 * ─── WHAT IT DOES NOT DO ────────────────────────────────────────────────────
 * It does not re-implement any threshold: it CONSUMES the numbers already in
 * `RISK_LIMITS` and in `RISK_POLICY_DEFAULTS`, and it FAILS CLOSED — when the
 * futures account cannot be read, the verdict is `unavailable`, never "fine".
 * It also does not want a rewrite of either engine: the point of the bridge is
 * that both keep their own vocabulary and the mapping is explicit, total and
 * tested, so a badge can never say something the engine did not.
 */
import { RISK_LIMITS } from '../central/risk.js';
import {
  RISK_LEVEL, RISK_POLICY_DEFAULTS, assessPortfolioRisk
} from './risk.js';

/**
 * THE TABLE. Four futures bands ↔ five intent bands, in both directions.
 * The asymmetry is real (only the intent scale has MODERATE) and is stated in
 * the table rather than hidden in a function body.
 */
export const FUTURES_TO_INTENT = Object.freeze({
  [RISK_LEVEL.LOW]: 'LOW',
  [RISK_LEVEL.MEDIUM]: 'ELEVATED',
  [RISK_LEVEL.HIGH]: 'HIGH',
  [RISK_LEVEL.EXTREME]: 'CRITICAL'
});
export const INTENT_TO_FUTURES = Object.freeze({
  LOW: RISK_LEVEL.LOW,
  MODERATE: RISK_LEVEL.MEDIUM,
  ELEVATED: RISK_LEVEL.MEDIUM,
  HIGH: RISK_LEVEL.HIGH,
  CRITICAL: RISK_LEVEL.EXTREME
});

/** Intent word for a futures level, or null (never a guess). */
export const intentWord = (level) => FUTURES_TO_INTENT[String(level || '').toUpperCase()] ?? null;
/** Futures level for an intent word. */
export const futuresLevel = (word) => INTENT_TO_FUTURES[String(word || '').toUpperCase()] ?? null;

/** The rank of an intent word, for `max()` comparisons across modules. */
export const INTENT_RANK = Object.freeze({ LOW: 0, MODERATE: 1, ELEVATED: 2, HIGH: 3, CRITICAL: 4 });

/**
 * THE SHARED THRESHOLDS, read from the existing single sources.
 *
 * `central/risk.js` owns the product's limits and `futures-engine/risk.js` owns
 * the account bands. Both are exposed together here so a panel, a probe and a
 * future engine all cite the SAME numbers — the alternative is what happened
 * before: three files with three opinions about what "high leverage" is.
 */
export const SHARED_LIMITS = Object.freeze({
  concentrationSharePct: RISK_LIMITS.concentrationSharePct,       // 45
  leverageRatioBlock: RISK_LIMITS.leverageRatioBlock,             // 3
  leverageRatioWarn: RISK_LIMITS.leverageRatioWarn,               // 1.5
  liquidationDistanceWarnPct: RISK_LIMITS.liquidationDistanceWarnPct, // 15
  marginRatioWarnPct: RISK_POLICY_DEFAULTS.marginRatioWarnPct,    // 70
  fundingVsEquityWarnPct: RISK_POLICY_DEFAULTS.fundingVsEquityWarnPct, // 1
  hardMaxLeverage: RISK_POLICY_DEFAULTS.hardMaxLeverage           // 50
});

/**
 * Does an account breach a PRODUCT limit (not a venue limit)?
 *
 * Deliberately separate from the engine's own `warnings`, which describe the
 * account. This answers the different question the Intent OS asks: "should the
 * next order be blocked, warned, or allowed?" — and it answers with the exact
 * `RISK_LIMITS` numbers, so a change there is felt here immediately.
 *
 * Codes mirror the Intent OS vocabulary (`leverage-above-block-limit`) so a
 * verdict from either module can be rendered by one component.
 */
export function limitBreaches(portfolio) {
  const out = [];
  if (!portfolio || portfolio.available === false || portfolio.dataStatus === 'unavailable') {
    return [{ code: 'futures-account-unreadable', action: 'block', detail: 'the futures account could not be read' }];
  }
  const lev = Number(portfolio.exposure?.leverageRatio);
  if (Number.isFinite(lev)) {
    if (lev > SHARED_LIMITS.leverageRatioBlock) {
      out.push({ code: 'leverage-above-block-limit', action: 'block', value: lev, limit: SHARED_LIMITS.leverageRatioBlock });
    } else if (lev > SHARED_LIMITS.leverageRatioWarn) {
      out.push({ code: 'leverage-above-warn-limit', action: 'warn', value: lev, limit: SHARED_LIMITS.leverageRatioWarn });
    }
  }
  const share = Number(portfolio.exposure?.largestAsset?.shareOfGrossPct);
  if (Number.isFinite(share) && share >= SHARED_LIMITS.concentrationSharePct) {
    out.push({
      code: 'futures-concentration-above-limit',
      action: share >= SHARED_LIMITS.concentrationSharePct * 1.4 ? 'block' : 'warn',
      value: share,
      limit: SHARED_LIMITS.concentrationSharePct,
      asset: portfolio.exposure?.largestAsset?.base || null
    });
  }
  const ratio = Number(portfolio.margin?.marginRatioPct);
  if (Number.isFinite(ratio) && ratio >= SHARED_LIMITS.marginRatioWarnPct) {
    out.push({ code: 'margin-ratio-above-warn', action: ratio >= 90 ? 'block' : 'warn', value: ratio, limit: SHARED_LIMITS.marginRatioWarnPct });
  }
  const worst = portfolio.shocks?.liquidationScenario;
  if (worst) {
    out.push({ code: 'liquidation-within-shock-window', action: 'warn', movePct: worst.movePct });
  }
  return out;
}

/** The strictest action across a breach list — `block` outranks `warn`. */
export const worstAction = (breaches = []) => (
  breaches.some((b) => b.action === 'block') ? 'block'
    : breaches.some((b) => b.action === 'warn') ? 'warn'
      : 'allow'
);

/**
 * The futures row the Intent OS state and the opportunity scan both need.
 *
 * Shaped to be dropped straight into `state.futures` (which `assessRisk` reads
 * via `analyzeExposure`) and into the scan's `feeds`, without either of them
 * knowing what a perp is:
 *
 *   { dataStatus, exposureUsd, netUsd, leverageRatio, marginRatioPct,
 *     level, levelIntent, breaches, worstAction, warnings, positions, at }
 *
 * `level` stays in the futures vocabulary and `levelIntent` carries the
 * translation, because the Intent OS compares words and the desk compares
 * levels — and both have to be able to say which is which.
 */
export function futuresStateRow(portfolio, { at = Date.now() } = {}) {
  const breaches = limitBreaches(portfolio);
  const level = portfolio?.riskLevel || null;
  return {
    schema: 'fbt.futures-state-row.v1',
    dataStatus: portfolio?.available === false ? 'unavailable' : (portfolio?.dataStatus || 'unavailable'),
    exposureUsd: Number(portfolio?.exposure?.grossUsd) || 0,
    netUsd: Number(portfolio?.exposure?.netUsd) || 0,
    leverageRatio: Number.isFinite(Number(portfolio?.exposure?.leverageRatio)) ? Number(portfolio.exposure.leverageRatio) : null,
    marginRatioPct: Number.isFinite(Number(portfolio?.margin?.marginRatioPct)) ? Number(portfolio.margin.marginRatioPct) : null,
    positionCount: Number(portfolio?.exposure?.positionCount) || 0,
    level,
    levelIntent: intentWord(level),
    breaches,
    worstAction: worstAction(breaches),
    warnings: Array.isArray(portfolio?.warnings) ? portfolio.warnings : [],
    shields: Array.isArray(portfolio?.exposure?.hedgedAssets) ? portfolio.exposure.hedgedAssets : [],
    at
  };
}

/**
 * THE PERSONALISED SCAN INPUT.
 *
 * `scanPersonalised({ capital, riskProfile })` ranks DeFi rows against the
 * user's capital and appetite. What it has never known is that the same user is
 * carrying leveraged futures — which changes both the capital that is really
 * free and the risk that is already taken. This function produces the one
 * object the scan needs, and it refuses to invent it:
 *
 *   · no account  → `{ available: false, reason }` and the scan is told nothing
 *                   (its own coverage table reports the gap), rather than being
 *                   told "zero exposure", which would rank a user who is 4×
 *                   levered as if they were flat;
 *   · an account  → exposure, the free capital AFTER maintenance margin, and
 *                   whether the scan should be de-risked (breaches present).
 *
 * `riskProfileCeiling` is the mapping from the SHARED limits to the scan's own
 * four-word appetite, so a user whose futures leverage is already above the
 * warn line cannot be shown "aggressive" rows as if they had room for them.
 */
export const FUTURES_PROFILE_CEILING = Object.freeze({
  AGGRESSIVE: 'BALANCED',
  BALANCED: 'MODERATE',
  MODERATE: 'CONSERVATIVE',
  CONSERVATIVE: 'CONSERVATIVE'
});

export function futuresScanContext({
  positions = [], equityUsd = null, maintenanceMarginUsd = null, availableBalanceUsd = null,
  fundingAprPct = null, riskProfile = 'MODERATE', at = Date.now()
} = {}) {
  const portfolio = assessPortfolioRisk({
    equityUsd, maintenanceMarginUsd, availableBalanceUsd, positions, fundingAprPct
  });
  if (portfolio.dataStatus === 'unavailable') {
    return {
      available: false,
      reason: 'NO_FUTURES_ACCOUNT',
      /* NOT zero exposure: null means "unknown" everywhere downstream. */
      exposureUsd: null,
      freeCapitalUsd: null,
      deRisk: false,
      profile: riskProfile,
      at
    };
  }
  const breaches = limitBreaches({ available: true, ...portfolio });
  const action = worstAction(breaches);
  const freeCapital = Number.isFinite(Number(availableBalanceUsd))
    ? Math.max(0, Number(availableBalanceUsd) - (Number(maintenanceMarginUsd) || 0))
    : null;
  const profile = action === 'block'
    ? FUTURES_PROFILE_CEILING[riskProfile] || 'CONSERVATIVE'
    : action === 'warn'
      ? FUTURES_PROFILE_CEILING[FUTURES_PROFILE_CEILING[riskProfile] || 'MODERATE'] || 'CONSERVATIVE'
      : riskProfile;
  return {
    available: true,
    reason: null,
    exposureUsd: Number(portfolio.exposure?.grossUsd) || 0,
    netUsd: Number(portfolio.exposure?.netUsd) || 0,
    leverageRatio: Number.isFinite(Number(portfolio.exposure?.leverageRatio)) ? Number(portfolio.exposure.leverageRatio) : null,
    marginRatioPct: Number.isFinite(Number(portfolio.margin?.marginRatioPct)) ? Number(portfolio.margin.marginRatioPct) : null,
    freeCapitalUsd: freeCapital,
    level: portfolio.riskLevel,
    levelIntent: intentWord(portfolio.riskLevel),
    breaches,
    action,
    /* true when the scan should rank down risky rows, not when it should stop */
    deRisk: action !== 'allow',
    profile,
    at
  };
}

/**
 * Add the futures family to a scan result, as REPORTED DATA rather than as an
 * opportunity row.
 *
 * Why not a row: the opportunity engine ranks yield-bearing actions, and a perp
 * position is not one — inventing an APY for it would be the exact fabrication
 * this codebase keeps refusing to make. What the scan needs is the CONTEXT, and
 * that is what this adds, under a key of its own so nothing upstream changes
 * shape or count.
 */
export function attachFuturesContext(scan, context) {
  if (!scan || typeof scan !== 'object') return scan;
  if (!context) return { ...scan, futures: { available: false, reason: 'NO_CONTEXT' } };
  return {
    ...scan,
    futures: context,
    /* Coverage gains a ROW, not a category: the scan's coverage array describes
       feed families and this is one more source it consulted. Clients that map
       over it keep working; nothing that counted seven keeps counting. */
    coverage: Array.isArray(scan.coverage)
      ? [...scan.coverage, {
        id: 'FUTURES_ACCOUNT',
        source: 'futures-engine',
        rows: context.available ? (context.exposureUsd > 0 ? 1 : 0) : 0,
        label: { id: 'FUTURES_ACCOUNT', fa: 'حساب فیوچرز', en: 'Futures account' },
        status: context.available ? 'live' : 'unavailable'
      }]
      : scan.coverage
  };
}
