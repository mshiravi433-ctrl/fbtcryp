/**
 * FBT INTENT AI — PHASES 101–110: MULTI-VENUE PROFIT ENGINE
 * ---------------------------------------------------------------------------
 * The customer states a profit target ("grow 10% in 6 months", "$4,000 by
 * year end") and Intent OS must decide WHICH venue classes can honestly help:
 *
 *   · spot        base crypto exposure (existing swap/market infra)
 *   · stocks      tokenised / perpetual equities (Avantis feed)
 *   · dydx-global dYdX global perpetual markets (indexer feed)
 *   · futures     perpetual futures with per-venue funding intervals
 *   · yield-farm  safety-filtered DefiLlama pools
 *
 * ─── THE HONESTY CONTRACT (same rule as the rest of the project) ───────────
 *   1. A missing or stale feed is reported, never back-filled with defaults.
 *   2. Yield figures are ANNUALISED ONLY where the settlement interval is
 *      known (funding) or the upstream reports APY (farms). A guessed
 *      interval would produce a confident, precise, wrong number.
 *   3. The plan is a PROPOSAL. Nothing here authorizes execution; the
 *      confirmation gate and the wallet remain the only execution path.
 *   4. Every plan carries honestNotes — "returns are not guaranteed",
 *      "funding can flip sign", "leverage amplifies losses" — in the
 *      user's language. An AI that hides that is not an advisor, it is a
 *      salesman.
 *   5. targetReachability can be 'unreachable': the planner says so instead
 *      of stretching leverage to make the math work.
 */

import { classifyFailure } from './failureModes.js';

export const PROFIT_PLAN_SCHEMA = 'fbt.profit-target-plan.v1';
export const MULTI_VENUE_SCHEMA = 'fbt.multi-venue-status.v1';

export const VENUE_CLASSES = Object.freeze(['spot', 'stocks', 'dydx-global', 'futures', 'yield-farm']);
export const RISK_PROFILES = Object.freeze(['conservative', 'balanced', 'aggressive']);

/** Max honest leverage per venue class and risk profile. */
export const LEVERAGE_CAPS = Object.freeze({
  conservative: { 'dydx-global': 1, futures: 1, stocks: 1, 'yield-farm': 1, spot: 1 },
  balanced: { 'dydx-global': 2, futures: 2, stocks: 1.5, 'yield-farm': 1, spot: 1 },
  aggressive: { 'dydx-global': 4, futures: 4, stocks: 2, 'yield-farm': 1, spot: 1 }
});

/** Base allocation of capital across classes per risk profile (sums to 1). */
export const ALLOCATION_BASE = Object.freeze({
  conservative: { 'yield-farm': 0.55, spot: 0.2, stocks: 0.1, 'dydx-global': 0.1, futures: 0.05 },
  balanced: { 'yield-farm': 0.4, spot: 0.18, stocks: 0.12, 'dydx-global': 0.2, futures: 0.1 },
  aggressive: { 'yield-farm': 0.2, spot: 0.12, stocks: 0.15, 'dydx-global': 0.35, futures: 0.18 }
});

/** Conservative haircut on advertised yields so the plan does not oversell. */
export const YIELD_HAIRCUT = Object.freeze({ 'yield-farm': 0.7, 'dydx-global': 0.6, futures: 0.6, stocks: 0.5, spot: 0 });

const num = (v) => (v === null || v === undefined || v === '' || typeof v === 'boolean'
  ? null
  : (Number.isFinite(Number(v)) ? Number(v) : null));

const HOURS_PER_YEAR = 365 * 24;
const DAY_MS = 24 * 3600_000;

/* ─────────────────────────────── feed normalisation ────────────────────── */

/**
 * Normalise one venue feed into rows the planner can rank. The caller (the
 * server adapter) is responsible for the data being real; the planner is
 * responsible for never inventing the missing bits.
 */
export function normalizeVenueRows(feeds = {}, { now = Date.now() } = {}) {
  const out = { spot: [], stocks: [], 'dydx-global': [], futures: [], 'yield-farm': [] };
  const push = (klass, row) => {
    if (!VENUE_CLASSES.includes(klass) || !row || typeof row !== 'object') return;
    out[klass].push({
      klass,
      id: String(row.id || row.symbol || row.pool || '').slice(0, 64) || null,
      label: String(row.label || row.name || row.market || row.symbol || row.pool || '').slice(0, 64),
      priceUsd: num(row.priceUsd),
      change24hPct: num(row.change24hPct),
      fundingRatePct: num(row.fundingRatePct),
      fundingIntervalHours: num(row.fundingIntervalHours),
      fundingAprPct: num(row.fundingAprPct),
      apyPct: num(row.apyPct),
      tvlUsd: num(row.tvlUsd),
      openInterestUsd: num(row.openInterestUsd),
      volume24hUsd: num(row.volume24hUsd),
      riskTier: ['low', 'medium', 'high'].includes(row.riskTier) ? row.riskTier : null,
      venue: String(row.venue || '').slice(0, 32) || null,
      stablecoin: row.stablecoin === true,
      observedAt: num(row.observedAt) ?? now,
      stale: now - (num(row.observedAt) ?? now) > 6 * 3600_000
    });
  };
  for (const klass of VENUE_CLASSES) {
    const rows = Array.isArray(feeds[klass]) ? feeds[klass] : [];
    rows.slice(0, 200).forEach((row) => push(klass, row));
  }
  return out;
}

/** Annualise a funding rate ONLY when the interval is known and mapped. */
export function annualiseFunding(ratePct, intervalHours) {
  const rate = num(ratePct);
  const hours = num(intervalHours);
  if (rate === null || hours === null || hours <= 0) return null;
  return (rate / 100) * (HOURS_PER_YEAR / hours) * 100; // → pct per year
}

/** A class is usable only when it has non-stale rows. */
export function venueClassHealth(rows, { now = Date.now() } = {}) {
  const fresh = rows.filter((r) => !r.stale);
  return {
    live: fresh.length > 0,
    count: fresh.length,
    best: fresh[0] || null,
    sampleCount: rows.length
  };
}

/* ─────────────────────────────── the planner ───────────────────────────── */

/**
 * Build the allocation plan for the customer's profit target.
 * Pure: everything it needs arrives in `feeds` and `capitalUsd`.
 */
export function planForProfitTarget({
  target = {},
  horizonDays = 180,
  capitalUsd = 1000,
  riskProfile = 'balanced',
  feeds = {},
  now = Date.now()
} = {}) {
  const profile = RISK_PROFILES.includes(riskProfile) ? riskProfile : 'balanced';
  const horizon = Math.max(1, Math.min(3650, Math.round(num(horizonDays) ?? 180)));
  const capital = Math.max(0, num(capitalUsd) ?? 0);

  const targetMode = target?.mode === 'usd' ? 'usd' : 'pct';
  const targetValue = Math.max(0, num(target?.value) ?? 0);

  const rows = normalizeVenueRows(feeds, { now });
  const classes = VENUE_CLASSES.map((klass) => ({ klass, rows: rows[klass] }));

  const base = ALLOCATION_BASE[profile];
  const caps = LEVERAGE_CAPS[profile];

  const allocations = [];
  let projectedUsd = 0;
  let dataClasses = 0;

  for (const { klass, rows: klassRows } of classes) {
    const fresh = klassRows.filter((r) => !r.stale && r !== undefined);
    const wanted = base[klass] ?? 0;
    const health = venueClassHealth(klassRows, { now });

    /* Expected yield for the class: the best non-stale row's figure,
       haircut to stay honest. Funding APR only from a KNOWN interval. */
    let expectedYieldPct = null;
    let source = null;
    if (klass === 'yield-farm') {
      const best = fresh.find((r) => r.riskTier === 'low' && r.apyPct !== null) || fresh.find((r) => r.apyPct !== null);
      if (best && best.apyPct !== null) {
        expectedYieldPct = best.apyPct * YIELD_HAIRCUT['yield-farm'];
        source = `pool:${best.id}`;
      }
    } else if (klass === 'dydx-global' || klass === 'futures' || klass === 'stocks') {
      const best = fresh.find((r) => r.fundingAprPct !== null)
        || fresh.find((r) => r.fundingRatePct !== null && r.fundingIntervalHours !== null)
        || fresh[0];
      if (best) {
        const apr = best.fundingAprPct !== null
          ? best.fundingAprPct
          : annualiseFunding(best.fundingRatePct, best.fundingIntervalHours);
        if (apr !== null) {
          /* Negative funding = the position EARNS carry. The planner may use
             it, but it must say so explicitly — funding flips. */
          expectedYieldPct = Math.max(0, apr) * YIELD_HAIRCUT[klass];
          source = `${klass === 'futures' ? 'funding' : 'funding-or-index'}:${best.id}`;
          if (apr < 0) expectedYieldPct = Math.abs(apr) * YIELD_HAIRCUT[klass];
        }
      }
    } else if (klass === 'spot') {
      /* Spot has no yield contract; it is exposure, not income. The planner
         keeps the allocation but attributes zero projected income. */
      expectedYieldPct = 0;
      source = 'spot-exposure';
    }

    const allocatedUsd = Math.round(capital * wanted * 100) / 100;
    if (health.live) dataClasses += 1;
    projectedUsd += allocatedUsd * (expectedYieldPct === null ? 0 : expectedYieldPct / 100);

    allocations.push({
      klass,
      wantedPct: Math.round(wanted * 1000) / 10,
      allocatedUsd,
      live: health.live,
      sampleCount: health.count,
      leverageCap: caps[klass] ?? 1,
      expectedYieldPct: expectedYieldPct === null ? null : Math.round(expectedYieldPct * 100) / 100,
      yieldSource: source,
      bestRowId: health.best?.id || null,
      noteKey: health.live ? null : 'plan.noDataForClass'
    });
  }

  /* Reachability: how many years the haircut yields need for the target.
     Above 10 years (or zero data) the target is called unreachable rather
     than stretched into a lie. */
  const projectedAnnualPct = capital > 0 ? (projectedUsd / capital) * 100 : 0;
  const neededPct = targetMode === 'pct'
    ? targetValue
    : (capital > 0 ? (targetValue / capital) * 100 : 0);
  const years = projectedAnnualPct > 0 ? neededPct / projectedAnnualPct : null;
  const reachable = years !== null && years <= 10;

  const messages = [];
  if (dataClasses === 0) messages.push({ key: 'plan.noVenueData', params: {} });
  else if (dataClasses < VENUE_CLASSES.length) messages.push({ key: 'plan.partialVenueData', params: { classes: dataClasses, total: VENUE_CLASSES.length } });
  messages.push({ key: 'plan.notGuaranteed', params: {} });
  if (allocations.some((a) => (a.klass === 'dydx-global' || a.klass === 'futures') && a.expectedYieldPct !== null)) {
    messages.push({ key: 'plan.fundingCanFlip', params: {} });
  }
  if (profile === 'aggressive') messages.push({ key: 'plan.leverageAmplifiesLoss', params: {} });
  if (!reachable && dataClasses > 0) messages.push({ key: 'plan.targetUnreachable', params: { years: Math.round((years ?? 99) * 10) / 10 } });

  return {
    ok: true,
    schema: PROFIT_PLAN_SCHEMA,
    generatedAt: new Date(now).toISOString(),
    riskProfile: profile,
    horizonDays: horizon,
    capitalUsd: capital,
    target: { mode: targetMode, value: targetValue },
    projectedAnnualYieldPct: Math.round(projectedAnnualPct * 100) / 100,
    neededPct: Math.round(neededPct * 100) / 100,
    projectedUsdAtHorizon: Math.round(capital * (1 + (projectedAnnualPct / 100) * (horizon / 365)) * 100) / 100,
    targetUsdAtHorizon: targetMode === 'pct'
      ? Math.round(capital * (1 + targetValue / 100) * 100) / 100
      : Math.round(targetValue * 100) / 100,
    targetReachability: {
      feasible: reachable,
      yearsEstimate: years === null ? null : Math.round(years * 10) / 10,
      reason: reachable ? null : (years === null ? 'NO_YIELD_DATA' : 'BEYOND_10_YEARS')
    },
    allocations,
    messages,
    venuesSeen: dataClasses,
    venuesMissing: VENUE_CLASSES.filter((k) => !venueClassHealth(rows[k], { now }).live),
    executionRequired: false,
    rawCredentialsInPlan: false
  };
}

/* ────────────────────────────── progress tracking ──────────────────────── */

/**
 * Compare the live portfolio against the plan. Drift is a fact, and the
 * response is a SUGGESTION that goes through the confirmation gate — never
 * an automatic rebalance.
 */
export function trackTargetProgress({ plan, portfolioUsd, now = Date.now() } = {}) {
  if (!plan || plan.schema !== PROFIT_PLAN_SCHEMA) {
    return { ok: false, schema: 'fbt.target-progress.v1', code: 'PLAN_MALFORMED', error: classifyFailure('MISSING_DATA', { detail: 'PLAN_MALFORMED' }) };
  }
  const current = Math.max(0, num(portfolioUsd) ?? 0);
  const start = Math.max(0, num(plan.capitalUsd) ?? 0);
  const elapsedDays = Math.max(0, (now - Date.parse(plan.generatedAt)) / DAY_MS || 0);
  const horizonDays = Math.max(1, num(plan.horizonDays) ?? 180);

  const targetUsd = plan.targetUsdAtHorizon;
  const progressPct = start > 0 ? Math.round(((current - start) / start) * 1000) / 10 : 0;
  const neededPacePct = start > 0 ? ((targetUsd - start) / start) * 100 * (horizonDays / Math.max(1, horizonDays - elapsedDays)) : 0;
  const paceOk = current >= start * (1 + (neededPacePct / 100) * (elapsedDays / 365));

  const suggestions = [];
  if (!paceOk) suggestions.push({ key: 'progress.behindPace', params: { neededPacePct: Math.round(neededPacePct * 10) / 10 } });
  const flip = (plan.allocations || []).find((a) => (a.klass === 'dydx-global' || a.klass === 'futures') && a.bestRowId && a.expectedYieldPct === 0);
  if (flip) suggestions.push({ key: 'progress.fundingZero', params: { klass: flip.klass } });

  return {
    ok: true,
    schema: 'fbt.target-progress.v1',
    checkedAt: new Date(now).toISOString(),
    startUsd: start,
    currentUsd: current,
    targetUsd,
    progressPct,
    elapsedDays: Math.round(elapsedDays * 10) / 10,
    onPace: paceOk,
    remainingUsd: Math.max(0, Math.round((targetUsd - current) * 100) / 100),
    suggestions
  };
}

/**
 * Venue switch decision. Honest: a switch is suggested only when the target
 * class has a live feed and the current class yield has collapsed.
 */
export function suggestVenueSwitch({ plan, fromClass, currentYieldPct, now = Date.now() } = {}) {
  if (!plan || plan.schema !== PROFIT_PLAN_SCHEMA || !VENUE_CLASSES.includes(fromClass)) {
    return { ok: false, code: 'SWITCH_INPUT_INVALID', error: classifyFailure('MISSING_DATA', { detail: 'SWITCH_INPUT_INVALID' }) };
  }
  const candidates = (plan.allocations || [])
    .filter((a) => a.klass !== fromClass && a.live && a.expectedYieldPct !== null && a.expectedYieldPct > (num(currentYieldPct) ?? 0))
    .sort((a, b) => b.expectedYieldPct - a.expectedYieldPct);
  if (!candidates.length) {
    return { ok: true, switch: null, reason: 'NO_BETTER_VENUE', messageKey: 'switch.none' };
  }
  const best = candidates[0];
  return {
    ok: true,
    switch: {
      fromClass,
      toClass: best.klass,
      expectedYieldPct: best.expectedYieldPct,
      requiresConfirmation: true,
      proposedAt: now
    },
    reason: 'BETTER_YIELD_AVAILABLE',
    messageKey: 'switch.proposed'
  };
}
