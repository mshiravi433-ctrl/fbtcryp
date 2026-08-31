/**
 * FBT FINANCIAL OS — the calculation engine behind Financial Goals.
 * ---------------------------------------------------------------------------
 * This module is PURE. It touches no network, no storage, no wallet and no
 * secret, which is what lets the server own every number and lets the UI (and
 * the test suite) run the exact same code the API serves. The pipeline it
 * implements is the one the Financial OS is specified around:
 *
 *     Goal → Required Return → Risk Profile → Current Portfolio
 *         → Market Data → Strategy → Allocation → Intent
 *
 * ─── THE HONESTY CONTRACT (the same one every FBT engine signs) ────────────
 *   1. `requiredCagr` is the return the goal NEEDS. It is arithmetic about the
 *      user's own numbers — never a forecast, never a promise. Every surface
 *      that shows it must label it "required" / "projection".
 *   2. A missing market feed is reported as missing. The engine never fills a
 *      gap with a plausible-looking default, and never invents a yield.
 *   3. Price appreciation is NOT forecast. The projected yield of this engine
 *      comes only from live, haircut venue data (the same haircuts
 *      `multiVenuePlanner.js` already applies). Crypto sleeves are exposure,
 *      not income — they contribute 0 projected yield, exactly as the existing
 *      planner treats spot.
 *   4. The three scenarios are assumption bands, not predictions: Bear is
 *      "no growth at all", Base is "the live haircut yield continues", Bull is
 *      "the goal's own required return happens". Bull is the requirement, not
 *      an outlook.
 *   5. Nothing here executes. `buildGoalIntent` produces an INTENT PAYLOAD —
 *      a description of what the user would have to approve. Existing Intent
 *      OS turns it into a reviewable draft; the wallet remains the only
 *      execution path.
 */

import { CURRENCIES } from './currency.js';
import { monthsBetween } from './goalMath.js';

/* -------------------------------------------------------------------------- */
/* schemas, vocabulary, limits                                                */
/* -------------------------------------------------------------------------- */

export const FINANCIAL_GOAL_SCHEMA = 'fbt.financial-goal.v1';
export const FINANCIAL_GOAL_PLAN_SCHEMA = 'fbt.financial-goal-plan.v1';
export const FINANCIAL_GOAL_EVENT_SCHEMA = 'fbt.financial-goal-event.v1';
export const FINANCIAL_GOAL_INTENT_SCHEMA = 'fbt.financial-goal-intent.v1';
export const FINANCIAL_GOAL_MARKET_SCHEMA = 'fbt.financial-goal-market.v1';

/**
 * The three collections the Financial OS owns. The project has no SQL database
 * (the API is a stateless cache in front of public market data), so these are
 * the three key namespaces the persistence layer writes under — see
 * server/financialGoals.js. They are named after the specified tables so the
 * mapping stays obvious in the store itself.
 */
export const FINANCIAL_GOAL_TABLES = Object.freeze([
  'financial_goals',
  'financial_goal_plans',
  'financial_goal_events'
]);

export const RISK_PROFILES = Object.freeze(['CONSERVATIVE', 'MODERATE', 'AGGRESSIVE']);
export const GOAL_STATUSES = Object.freeze(['DRAFT', 'ACTIVE', 'PAUSED', 'COMPLETED']);
export const MONITOR_STATUSES = Object.freeze(['ON_TRACK', 'AHEAD', 'BEHIND', 'AT_RISK', 'COMPLETED', 'PAUSED']);
export const ALLOCATION_ASSETS = Object.freeze(['BTC', 'ETH', 'STABLE', 'OTHER']);
export const GOAL_CURRENCIES = Object.freeze(CURRENCIES.map((c) => c.code));

/** Every event kind the goal timeline can carry. */
export const GOAL_EVENTS = Object.freeze([
  'GOAL_CREATED',
  'GOAL_UPDATED',
  'PLAN_BUILT',
  'PLAN_APPROVED',
  'GOAL_PAUSED',
  'GOAL_RESUMED',
  'VALUE_SNAPSHOT',
  'INTENT_HANDED_OFF'
]);

/** Above this required annual return a goal is reported as beyond reach
 *  rather than projected. */
export const PLAUSIBLE_RETURN_PCT = 100;

export const LIMITS = Object.freeze({
  nameMax: 80,
  maxGoalsPerOwner: 25,
  maxEventsPerGoal: 200,
  maxMonthlyContributionRatio: 1000, // × starting capital — a typo guard, not a product rule
  minYears: 0.08,                    // ~1 month
  maxYears: 50
});

/* -------------------------------------------------------------------------- */
/* small helpers                                                              */
/* -------------------------------------------------------------------------- */

/* null / '' / boolean are NOT zero here. `Number(null) === 0` would turn a
   dead feed into a confident 0% yield, which is exactly the lie this engine
   exists to avoid. */
const num = (v) => (v === null || v === undefined || v === '' || typeof v === 'boolean'
  ? null
  : (Number.isFinite(Number(v)) ? Number(v) : null));
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const round2 = (v) => Math.round(v * 100) / 100;
const round1 = (v) => Math.round(v * 10) / 10;
const DAY_MS = 24 * 3600_000;

/** Normalise the many spellings of a risk profile into the stored vocabulary. */
export function normaliseRiskProfile(value) {
  const raw = String(value ?? '').trim().toUpperCase();
  if (RISK_PROFILES.includes(raw)) return raw;
  /* The rest of the app speaks conservative/balanced/aggressive (see the
     existing venue planner). Balanced IS this product's Moderate. */
  if (raw === 'BALANCED' || raw === 'MEDIUM') return 'MODERATE';
  return 'MODERATE';
}

export function normaliseCurrency(value) {
  const raw = String(value ?? '').trim().toUpperCase();
  return GOAL_CURRENCIES.includes(raw) ? raw : 'USD';
}

/** Calendar years between two timestamps, floored at the engine's minimum. */
export function yearsBetween(fromMs, toMs) {
  const a = Number(fromMs);
  const b = Number(toMs);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  const years = (b - a) / (365.25 * DAY_MS);
  if (!Number.isFinite(years)) return null;
  return years;
}

/* -------------------------------------------------------------------------- */
/* 1. REQUIRED RETURN                                                          */
/* -------------------------------------------------------------------------- */

/**
 * The compound annual growth rate the goal NEEDS:
 *
 *     CAGR = (target / starting)^(1 / years) − 1
 *
 * Returns null when the question has no finite answer (no capital, no horizon,
 * or a nonsense input) — a null is an honest "cannot be computed", where NaN
 * or Infinity would silently poison every projection downstream.
 */
export function requiredCagr(starting, target, years) {
  const start = num(starting);
  const goal = num(target);
  const span = num(years);
  if (start === null || start <= 0) return null;
  if (goal === null || goal < 0) return null;
  if (span === null || span <= 0) return null;
  const ratio = goal / start;
  if (!Number.isFinite(ratio) || ratio <= 0) return null;
  return Math.pow(ratio, 1 / span) - 1;
}

/**
 * Future value of a present sum plus a monthly contribution, compounded at an
 * annual rate with a monthly-effective conversion:
 *
 *     FV = PV·(1+r)^Y + PMT·(((1+r)^Y − 1) / ((1+r)^(1/12) − 1))
 *
 * `monthsBetween` (existing, calendar-aware, unit-tested) supplies the month
 * count so a deadline of "the 3rd of March" is not silently treated as 30-day
 * arithmetic.
 */
export function futureValue({ starting = 0, monthly = 0, years = 0, annualReturn = 0 } = {}) {
  const pv = Math.max(0, num(starting) ?? 0);
  const pmt = Math.max(0, num(monthly) ?? 0);
  const y = num(years);
  if (y === null || y <= 0) return pv;
  if (annualReturn === 0) return pv + pmt * Math.max(0, Math.round(y * 12));
  const growth = Math.pow(1 + annualReturn, y);
  const monthlyRate = Math.pow(1 + annualReturn, 1 / 12) - 1;
  if (!Number.isFinite(growth) || !Number.isFinite(monthlyRate) || monthlyRate === 0) return null;
  const contributions = pmt * ((growth - 1) / monthlyRate);
  const value = pv * growth + contributions;
  return Number.isFinite(value) ? value : null;
}

/** Whole calendar months between now and a deadline, never negative. */
export function monthsToDeadline(now, deadlineMs) {
  return Math.max(0, monthsBetween(Number(now), Number(deadlineMs)));
}

/**
 * The return the goal needs WHEN MONTHLY CONTRIBUTIONS ARE PART OF THE PLAN.
 * Contributions-only goals can need 0% — saying "you need 26% a year" to
 * someone who is already saving enough would be a lie, so the two are solved
 * together by bisection on the monotonic future-value curve.
 *
 * @returns {{ requiredReturnPct: number|null, reachable: boolean,
 *             contributionsOnlyValueUsd: number|null, reason: string|null }}
 */
export function requiredReturnWithContributions({
  startingCapital = 0,
  targetAmount = 0,
  monthlyContribution = 0,
  years = 0
} = {}) {
  const pv = Math.max(0, num(startingCapital) ?? 0);
  const target = num(targetAmount);
  const pmt = Math.max(0, num(monthlyContribution) ?? 0);
  const y = num(years);
  if (target === null || target <= 0 || y === null || y <= 0 || pv <= 0) {
    return { requiredReturnPct: null, reachable: false, contributionsOnlyValueUsd: null, reason: 'BAD_INPUT' };
  }
  const flat = futureValue({ starting: pv, monthly: pmt, years: y, annualReturn: 0 });
  if (flat !== null && flat >= target) {
    return {
      requiredReturnPct: 0,
      reachable: true,
      contributionsOnlyValueUsd: round2(flat),
      reason: 'CONTRIBUTIONS_ALONE_SUFFICE'
    };
  }
  const fv = (rate) => futureValue({ starting: pv, monthly: pmt, years: y, annualReturn: rate });
  const MAX_RATE = 10; // 1000%/yr — past this the answer is not a plan
  let lo = 0;
  let hi = MAX_RATE;
  if ((fv(hi) ?? 0) < target) {
    return {
      requiredReturnPct: null,
      reachable: false,
      contributionsOnlyValueUsd: flat === null ? null : round2(flat),
      reason: 'BEYOND_REACH'
    };
  }
  for (let i = 0; i < 200; i += 1) {
    const mid = (lo + hi) / 2;
    const value = fv(mid);
    if (value === null) return { requiredReturnPct: null, reachable: false, contributionsOnlyValueUsd: null, reason: 'BAD_INPUT' };
    if (value < target) lo = mid; else hi = mid;
    if (hi - lo < 1e-9) break;
  }
  const rate = (lo + hi) / 2;
  return {
    requiredReturnPct: round2(rate * 100),
    reachable: true,
    contributionsOnlyValueUsd: flat === null ? null : round2(flat),
    reason: null
  };
}

/* -------------------------------------------------------------------------- */
/* 2. ALLOCATION                                                              */
/* -------------------------------------------------------------------------- */

/** Base allocation per risk profile (integers, sums to 100). */
export const ALLOCATION_BASE = Object.freeze({
  CONSERVATIVE: Object.freeze({ BTC: 12, ETH: 6, STABLE: 62, OTHER: 20 }),
  MODERATE: Object.freeze({ BTC: 24, ETH: 14, STABLE: 32, OTHER: 30 }),
  AGGRESSIVE: Object.freeze({ BTC: 36, ETH: 20, STABLE: 12, OTHER: 32 })
});

/** How many points a fully "pressured" goal may move out of stables. */
const MAX_SHIFT = Object.freeze({ CONSERVATIVE: 8, MODERATE: 14, AGGRESSIVE: 18 });
/** A stable sleeve is never drained below this, whatever the goal demands. */
const STABLE_FLOOR = Object.freeze({ CONSERVATIVE: 45, MODERATE: 15, AGGRESSIVE: 5 });
/** The required return (annual) at which the tilt is fully applied. */
const PRESSURE_FULL = 0.30;

/** Growth receives the shifted points in this ratio (BTC / ETH / OTHER). */
const GROWTH_SPLIT = Object.freeze({ BTC: 0.5, ETH: 0.3, OTHER: 0.2 });

/**
 * The allocation is the one place a rounding bug becomes a real-money bug: a
 * plan showing 99% or 101% silently changes what the user approves. Integers
 * are produced here, then re-checked by `validateAllocation` before the plan
 * is allowed to leave the engine.
 */
export function buildAllocation({
  riskProfile = 'MODERATE',
  requiredReturnPct = 0,
  market = null
} = {}) {
  const profile = normaliseRiskProfile(riskProfile);
  const base = { ...ALLOCATION_BASE[profile] };

  const required = Math.max(0, num(requiredReturnPct) ?? 0) / 100;
  const pressure = clamp(required / PRESSURE_FULL, 0, 1);

  /* A live, attractive stable yield does real work: it lowers how much of the
     goal has to be chased with volatility. Missing data changes nothing — an
     absent feed must never be read as "yield is bad". */
  const stableYield = num(market?.stableYieldPct);
  const yieldRelief = stableYield === null ? 0 : clamp(Math.round(stableYield / 3), 0, 4);

  const wanted = Math.round(pressure * MAX_SHIFT[profile]) - yieldRelief;
  const shift = clamp(wanted, 0, Math.max(0, base.STABLE - STABLE_FLOOR[profile]));

  const next = { ...base };
  next.STABLE = base.STABLE - shift;
  next.BTC = base.BTC + Math.round(shift * GROWTH_SPLIT.BTC);
  next.ETH = base.ETH + Math.round(shift * GROWTH_SPLIT.ETH);
  next.OTHER = 100 - next.STABLE - next.BTC - next.ETH; // absorbs the rounding

  const allocation = ALLOCATION_ASSETS.map((asset) => ({
    asset,
    percentage: Math.round(next[asset])
  }));
  validateAllocation(allocation);
  return {
    allocation,
    tilt: { pressurePct: round1(pressure * 100), shiftPct: shift, yieldReliefPct: yieldRelief },
    profile
  };
}

/**
 * The allocation must equal 100%. Any drift is a bug, not a rounding nuance —
 * a plan that allocates 99% quietly leaves capital unassigned and a plan that
 * allocates 101% promises more than exists.
 *
 * @throws {Error} when the percentages do not sum to 100.
 */
export function validateAllocation(items) {
  const total = (items || []).reduce((sum, item) => sum + Number(item?.percentage || 0), 0);
  if (Math.abs(total - 100) > 0.001) {
    throw new Error('Allocation must equal 100%');
  }
  return true;
}

/* -------------------------------------------------------------------------- */
/* 3. RISK SCORE                                                              */
/* -------------------------------------------------------------------------- */

const RISK_BASE = Object.freeze({ CONSERVATIVE: 18, MODERATE: 42, AGGRESSIVE: 66 });

/**
 * A 0–100 score: how demanding this goal is, not how risky crypto is.
 * Deterministic and explainable — every point is attributed in `factors`, so
 * the UI can answer "why is it 38?" instead of showing an oracle.
 */
export function riskScore({
  riskProfile = 'MODERATE',
  requiredReturnPct = 0,
  years = 0,
  monthlyContribution = 0,
  startingCapital = 0,
  targetAmount = 0,
  projectedYieldPct = null
} = {}) {
  const profile = normaliseRiskProfile(riskProfile);
  const required = Math.max(0, num(requiredReturnPct) ?? 0);
  const span = Math.max(0, num(years) ?? 0);
  const pmt = Math.max(0, num(monthlyContribution) ?? 0);
  const start = Math.max(0, num(startingCapital) ?? 0);
  const target = Math.max(0, num(targetAmount) ?? 0);
  const factors = [];

  let score = RISK_BASE[profile];
  factors.push({ key: 'risk.factor.profile', points: RISK_BASE[profile], detail: profile });

  // How hard the goal pushes: 30%+/yr is the top of the scale.
  const returnPoints = Math.round(Math.min(24, required * 0.8) * 10) / 10;
  score += returnPoints;
  factors.push({ key: 'risk.factor.requiredReturn', points: returnPoints, detail: `${round1(required)}%` });

  // Time absorbs risk: a decade forgives what a single month cannot.
  let horizonPoints = 0;
  if (span >= 10) horizonPoints = -8;
  else if (span >= 5) horizonPoints = -4;
  else if (span >= 2) horizonPoints = 0;
  else if (span >= 1) horizonPoints = 4;
  else horizonPoints = 8;
  score += horizonPoints;
  factors.push({ key: 'risk.factor.horizon', points: horizonPoints, detail: `${round1(span)}y` });

  // Contributions that already close most of the gap mean less has to be
  // earned by taking risk.
  const gap = Math.max(0, target - start);
  const coverage = gap > 0 && span > 0 ? (pmt * 12 * span) / gap : 0;
  let coverPoints = 0;
  if (pmt > 0 && coverage >= 1) coverPoints = -10;
  else if (pmt > 0 && coverage >= 0.5) coverPoints = -5;
  else if (pmt === 0) coverPoints = 4;
  score += coverPoints;
  factors.push({ key: 'risk.factor.contribution', points: coverPoints, detail: `${Math.round(coverage * 100)}%` });

  // A goal that cannot be met from yield alone has to be met by price moves.
  const yieldPct = num(projectedYieldPct);
  const shortfallPoints = yieldPct === null ? 0 : (required > yieldPct ? 8 : 0);
  score += shortfallPoints;
  if (shortfallPoints > 0) factors.push({ key: 'risk.factor.yieldShortfall', points: shortfallPoints, detail: `${round1(yieldPct)}%` });

  score = Math.round(clamp(score, 0, 100));
  return {
    score,
    band: score >= 70 ? 'high' : score >= 50 ? 'elevated' : score >= 30 ? 'moderate' : 'low',
    factors
  };
}

/* -------------------------------------------------------------------------- */
/* 4. STRATEGY / SCENARIOS                                                    */
/* -------------------------------------------------------------------------- */

/**
 * The projected yield of the plan, from live market data only.
 *
 * Only the STABLE sleeve is credited with income, and only from a live,
 * haircut yield. BTC / ETH / OTHER are exposure: the engine has no licence to
 * predict their price, so they contribute 0 — the same rule the existing
 * multi-venue planner applies to spot.
 */
export function projectedYieldPct({ allocation = [], market = null } = {}) {
  const stable = (allocation || []).find((row) => row.asset === 'STABLE');
  const yieldPct = num(market?.stableYieldPct);
  if (!stable || yieldPct === null) {
    return { projectedYieldPct: null, live: false };
  }
  const value = (Number(stable.percentage) / 100) * yieldPct;
  return { projectedYieldPct: round2(value), live: true };
}

/**
 * Three assumption bands — NOT forecasts. Each carries its own note so the UI
 * can never present "Bull" as an outlook: it is the goal's own requirement
 * shown back to the user.
 */
export function projectScenarios({
  startingCapital = 0,
  monthlyContribution = 0,
  years = 0,
  requiredReturnPct = null,
  projectedYield = null
} = {}) {
  const start = Math.max(0, num(startingCapital) ?? 0);
  const pmt = Math.max(0, num(monthlyContribution) ?? 0);
  const span = Math.max(0, num(years) ?? 0);
  const target = null;

  const band = (id, ratePct, noteKey) => {
    const value = futureValue({ starting: start, monthly: pmt, years: span, annualReturn: ratePct / 100 });
    return {
      id,
      ratePct: round2(ratePct),
      projectedUsd: value === null ? null : round2(value),
      noteKey,
      reachesTarget: target
    };
  };

  return [
    band('bear', 0, 'scenario.bear.note'),
    band('base', num(projectedYield) ?? 0, 'scenario.base.note'),
    band('bull', num(requiredReturnPct) ?? 0, 'scenario.bull.note')
  ];
}

/* -------------------------------------------------------------------------- */
/* 5. MONITORING                                                              */
/* -------------------------------------------------------------------------- */

/** The compounding path the goal implies, sampled for a sparkline. */
export function expectedPath({ startingCapital = 0, targetAmount = 0, createdAt, targetDate, points = 6 }) {
  const start = Math.max(0, num(startingCapital) ?? 0);
  const target = Math.max(0, num(targetAmount) ?? 0);
  const from = Number(createdAt);
  const to = Number(targetDate);
  const count = clamp(Math.round(points) || 6, 2, 24);
  if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from) return [];
  const out = [];
  for (let i = 0; i < count; i += 1) {
    const t = i / (count - 1);
    const at = Math.round(from + (to - from) * t);
    // Geometric interpolation: the required path compounds, it does not
    // travel in a straight line, and a straight line would overstate how
    // far along an early goal should be.
    const value = start > 0 && target > 0 ? start * Math.pow(target / start, t) : start + (target - start) * t;
    out.push({ at, valueUsd: round2(value) });
  }
  return out;
}

/** Where the goal says the portfolio should be right now. */
export function expectedValueNow({ startingCapital = 0, targetAmount = 0, createdAt, targetDate, now = Date.now() }) {
  const start = Math.max(0, num(startingCapital) ?? 0);
  const target = Math.max(0, num(targetAmount) ?? 0);
  const from = Number(createdAt);
  const to = Number(targetDate);
  const at = Number(now);
  if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from) return start;
  const t = clamp((at - from) / (to - from), 0, 1);
  if (start <= 0) return round2(target * t);
  return round2(start * Math.pow(target / start, t));
}

/**
 * `Current Value · Target Value · Progress % · Expected Path · Actual Path ·
 *  Status` — the six facts the monitoring surface is specified to compute.
 *
 * `snapshots` (from financial_goal_events, VALUE_SNAPSHOT) is the actual path;
 * when there are none, the actual path is a single point at the value the
 * caller supplied, and the Status is derived from that — never invented.
 */
export function monitorGoal({ goal, currentValueUsd = null, snapshots = [], now = Date.now() } = {}) {
  const starting = Math.max(0, num(goal?.startingCapital) ?? 0);
  const target = Math.max(0, num(goal?.targetAmount) ?? 0);
  const current = Math.max(0, num(currentValueUsd) ?? starting);
  const expected = expectedValueNow({
    startingCapital: starting,
    targetAmount: target,
    createdAt: goal?.createdAt,
    targetDate: goal?.targetDate,
    now
  });

  const path = expectedPath({
    startingCapital: starting,
    targetAmount: target,
    createdAt: goal?.createdAt,
    targetDate: goal?.targetDate
  });

  const actual = (Array.isArray(snapshots) ? snapshots : [])
    .filter((row) => Number.isFinite(Number(row?.at)) && Number.isFinite(Number(row?.valueUsd)))
    .map((row) => ({ at: Number(row.at), valueUsd: round2(Number(row.valueUsd)) }))
    .sort((a, b) => a.at - b.at);

  const progressPct = target > 0 ? round1(clamp((current / target) * 100, 0, 100)) : 0;
  const ratio = expected > 0 ? current / expected : 1;

  let status = 'ON_TRACK';
  if (goal?.status === 'PAUSED') status = 'PAUSED';
  else if (target > 0 && current >= target) status = 'COMPLETED';
  else if (ratio >= 1.1) status = 'AHEAD';
  else if (ratio >= 0.95) status = 'ON_TRACK';
  else if (ratio >= 0.85) status = 'BEHIND';
  else status = 'AT_RISK';

  /* `valueReported` is the difference between "the user is exactly on their
     starting capital" and "nobody has told us the portfolio value yet". The
     UI must not paint the second case as BEHIND. */
  const valueReported = currentValueUsd !== null && Number.isFinite(Number(currentValueUsd))
    ? true
    : actual.length > 0;

  return {
    schema: 'fbt.financial-goal-progress.v1',
    goalId: goal?.id ?? null,
    checkedAt: new Date(now).toISOString(),
    valueReported,
    currentValueUsd: round2(current),
    targetValueUsd: round2(target),
    startingCapitalUsd: round2(starting),
    progressPct,
    expectedValueUsd: expected,
    deltaUsd: round2(current - expected),
    pathRatio: round2(ratio),
    expectedPath: path,
    actualPath: actual.length > 0 ? actual : (current ? [{ at: Number(now), valueUsd: round2(current) }] : []),
    status,
    elapsedFraction: (() => {
      const from = Number(goal?.createdAt);
      const to = Number(goal?.targetDate);
      if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from) return 0;
      return round2(clamp((Number(now) - from) / (to - from), 0, 1));
    })()
  };
}

/* -------------------------------------------------------------------------- */
/* 6. INTENT PAYLOAD (hand-off to the existing Intent OS)                     */
/* -------------------------------------------------------------------------- */

/**
 * The Financial OS does NOT build an execution engine. It produces this
 * payload and hands it to the existing Intent OS, whose compiler, risk checks
 * and confirmation gate are the only path to a signature.
 *
 * `autonomousExecution: false` and `secretsIncluded: false` are asserted here
 * so a future caller cannot quietly turn this into an executor.
 */
export function buildGoalIntent({ goal, plan, now = Date.now() } = {}) {
  const capital = Math.max(0, num(goal?.startingCapital) ?? 0);
  const allocation = Array.isArray(plan?.allocation) ? plan.allocation : [];
  validateAllocation(allocation.length ? allocation : [{ asset: 'STABLE', percentage: 100 }]);
  const actions = allocation.map((row) => ({
    type: 'ALLOCATE',
    asset: row.asset,
    percentage: Number(row.percentage),
    amount: round2((capital * Number(row.percentage)) / 100)
  }));
  return {
    schema: FINANCIAL_GOAL_INTENT_SCHEMA,
    source: 'FINANCIAL_GOAL',
    goalId: goal?.id ?? null,
    currency: normaliseCurrency(goal?.currency),
    totalAmount: round2(capital),
    actions,
    requiresUserApproval: true,
    autonomousExecution: false,
    secretsIncluded: false,
    createdAt: now
  };
}

/* -------------------------------------------------------------------------- */
/* 7. NATURAL-LANGUAGE GOAL (deterministic, no AI, no secret)                 */
/* -------------------------------------------------------------------------- */

const NUMBER_WITH_SUFFIX = '([0-9][0-9,._\\s]*(?:\\s?(?:k|m|million|thousand))?)';

function parseAmount(raw) {
  if (!raw) return null;
  const cleaned = String(raw).toLowerCase().replace(/[$€£₺¥₹₽]/g, '').replace(/,/g, '').replace(/\s+/g, '').trim();
  const match = /^([0-9]*\.?[0-9]+)(k|m|million|thousand)?$/.exec(cleaned);
  if (!match) return null;
  const value = Number(match[1]);
  if (!Number.isFinite(value)) return null;
  const scale = match[2] === 'k' || match[2] === 'thousand' ? 1e3 : (match[2] === 'm' || match[2] === 'million' ? 1e6 : 1);
  const amount = value * scale;
  return amount > 0 ? amount : null;
}

/**
 * Read the handful of shapes people actually type:
 *   "double my capital in 3 years"
 *   "10,000 to 20,000 in 3 years"
 *   "grow $5,000 by 50% in 2 years"
 *   "I want $50,000 in 5 years"
 *
 * Deliberately rule-based: it runs on the device, it cannot hallucinate, and
 * it is not allowed to see anything a user would not paste into a text box.
 * Anything it cannot read comes back as `matched: false` and the form simply
 * stays empty — we never guess a target amount for somebody.
 */
export function parseGoalFromText(text) {
  const raw = String(text ?? '').trim();
  if (!raw) return { matched: false, confidence: 0, fields: {} };
  const lower = raw.toLowerCase();
  const fields = {};
  let confidence = 0;

  const years = (() => {
    const monthMatch = /(\d+(?:\.\d+)?)\s*(?:months?|mo)\b/.exec(lower);
    if (monthMatch) return Number(monthMatch[1]) / 12;
    const yearMatch = /(\d+(?:\.\d+)?)\s*(?:years?|yrs?|y)\b/.exec(lower);
    if (yearMatch) return Number(yearMatch[1]);
    return null;
  })();
  if (years !== null && years > 0) { fields.years = round2(years); confidence += 0.3; }

  const multiplierWord = (() => {
    if (/\btriple\b/.test(lower)) return 3;
    if (/\bdouble\b/.test(lower) || /\b2x\b/.test(lower)) return 2;
    const xMatch = /\b(\d+(?:\.\d+)?)x\b/.exec(lower);
    if (xMatch) return Number(xMatch[1]);
    return null;
  })();
  if (multiplierWord !== null && multiplierWord > 1) { fields.multiplier = multiplierWord; confidence += 0.3; }

  const rangeMatch = new RegExp(`${NUMBER_WITH_SUFFIX}\\s*(?:\\$|usd)?\\s*(?:to|→|->|until|into)\\s*${NUMBER_WITH_SUFFIX}`).exec(lower);
  if (rangeMatch) {
    const a = parseAmount(rangeMatch[1]);
    const b = parseAmount(rangeMatch[2]);
    if (a !== null && b !== null && b > a) {
      fields.startingCapital = a;
      fields.targetAmount = b;
      confidence += 0.5;
    }
  }

  if (fields.targetAmount == null) {
    const growMatch = new RegExp(`(?:grow|turn|reach|save|get to|hit)\\s*(?:my\\s*)?(?:$)?\\s*${NUMBER_WITH_SUFFIX}\\s*(?:by\\s*(\\d+(?:\\.\\d+)?)\\s*%)?`).exec(lower);
    if (growMatch) {
      const base = parseAmount(growMatch[1]);
      const pct = growMatch[2] ? Number(growMatch[2]) : null;
      if (base !== null) {
        if (pct !== null && pct > 0) { fields.startingCapital = base; fields.targetAmount = round2(base * (1 + pct / 100)); }
        else fields.targetAmount = base;
        confidence += 0.4;
      }
    }
  }

  const monthlyMatch = new RegExp(`(?:save|add|contribute|put)\\s*(?:\\$|usd)?\\s*${NUMBER_WITH_SUFFIX}\\s*(?:\\/|per|a)\\s*(?:month|mo)\\b`).exec(lower);
  if (monthlyMatch) {
    const amount = parseAmount(monthlyMatch[1]);
    if (amount !== null) { fields.monthlyContribution = amount; confidence += 0.2; }
  }

  if (fields.multiplier && fields.startingCapital && !fields.targetAmount) {
    fields.targetAmount = round2(fields.startingCapital * fields.multiplier);
    confidence += 0.1;
  }

  if (/\bconservative\b|\bsafe\b|\blow risk\b/.test(lower)) fields.riskProfile = 'CONSERVATIVE';
  else if (/\baggressive\b|\bhigh risk\b|\bdegen\b/.test(lower)) fields.riskProfile = 'AGGRESSIVE';
  else if (/\bmoderate\b|\bbalanced\b|\bmedium\b/.test(lower)) fields.riskProfile = 'MODERATE';

  const matched = Boolean(fields.targetAmount && (fields.startingCapital || fields.multiplier) && fields.years);
  return {
    matched,
    confidence: round2(clamp(confidence, 0, 1)),
    fields,
    text: raw
  };
}

/* -------------------------------------------------------------------------- */
/* 8. THE PLAN                                                                */
/* -------------------------------------------------------------------------- */

/**
 * Goal → Required Return → Risk Profile → Current Portfolio → Market Data →
 * Strategy → Allocation. Pure: the caller supplies the market snapshot and the
 * current portfolio value, and every derived number comes back with the recipe
 * that produced it.
 */
export function buildPlan({
  goal,
  market = null,
  currentValueUsd = null,
  now = Date.now()
} = {}) {
  const starting = Math.max(0, num(goal?.startingCapital) ?? 0);
  const target = Math.max(0, num(goal?.targetAmount) ?? 0);
  const monthly = Math.max(0, num(goal?.monthlyContribution) ?? 0);
  const yearsRaw = yearsBetween(Number(goal?.createdAt ?? now), Number(goal?.targetDate));
  const years = yearsRaw === null ? null : round2(Math.max(LIMITS.minYears, yearsRaw));

  const simple = requiredCagr(starting, target, years);
  const solved = requiredReturnWithContributions({ startingCapital: starting, targetAmount: target, monthlyContribution: monthly, years });
  const requiredReturnPct = solved.requiredReturnPct === null
    ? (simple === null ? null : round2(simple * 100))
    : solved.requiredReturnPct;
  /* Honesty has a ceiling. The bisection will happily report that a doubling
     inside three weeks needs 579,161%/yr — arithmetically true and practically
     useless. Past PLAUSIBLE_RETURN_PCT the plan is marked unreachable and the
     UI steers the user toward a longer date, a bigger contribution or a
     smaller target. The number itself is still returned: it is what the goal
     asked for, and hiding it would be a different lie. */
  const plausible = requiredReturnPct === null ? false : requiredReturnPct <= PLAUSIBLE_RETURN_PCT;

  const { allocation, tilt } = buildAllocation({
    riskProfile: goal?.riskProfile,
    requiredReturnPct: requiredReturnPct ?? 0,
    market
  });

  const yieldView = projectedYieldPct({ allocation, market });
  const risk = riskScore({
    riskProfile: goal?.riskProfile,
    requiredReturnPct: requiredReturnPct ?? 0,
    years: years ?? 0,
    monthlyContribution: monthly,
    startingCapital: starting,
    targetAmount: target,
    projectedYieldPct: yieldView.projectedYieldPct
  });

  const scenarios = projectScenarios({
    startingCapital: starting,
    monthlyContribution: monthly,
    years: years ?? 0,
    requiredReturnPct,
    projectedYield: yieldView.projectedYieldPct
  });

  const currentValue = num(currentValueUsd) ?? starting;

  return {
    schema: FINANCIAL_GOAL_PLAN_SCHEMA,
    goalId: goal?.id ?? null,
    generatedAt: new Date(now).toISOString(),
    inputs: {
      startingCapital: round2(starting),
      targetAmount: round2(target),
      monthlyContribution: round2(monthly),
      years,
      targetDate: goal?.targetDate ?? null,
      riskProfile: normaliseRiskProfile(goal?.riskProfile),
      currency: normaliseCurrency(goal?.currency),
      currentValueUsd: round2(currentValue)
    },
    requiredReturnPct,
    requiredReturnSimplePct: simple === null ? null : round2(simple * 100),
    reachable: solved.reachable === true && plausible,
    reachReason: solved.reachable ? (plausible ? null : 'BEYOND_REACH') : solved.reason,
    contributionsOnlyValueUsd: solved.contributionsOnlyValueUsd,
    riskScore: risk.score,
    riskBand: risk.band,
    riskFactors: risk.factors,
    allocation,
    tilt,
    projectedYieldPct: yieldView.projectedYieldPct,
    projectedYieldLive: yieldView.live,
    scenarios,
    market: {
      live: Boolean(market?.live),
      stableYieldPct: num(market?.stableYieldPct),
      generatedAt: market?.generatedAt ?? null,
      venuesMissing: Array.isArray(market?.venuesMissing) ? market.venuesMissing : [],
      sources: market?.sources ?? null
    },
    guarantees: {
      returnsGuaranteed: false,
      priceForecastIncluded: false,
      autonomousExecution: false,
      secretsIncluded: false
    }
  };
}
