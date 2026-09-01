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

/* -------------------------------------------------------------------------- */
/* 9. OUTLOOK — GOAL PROBABILITY & ESTIMATED RANGE (assumption-based)         */
/* -------------------------------------------------------------------------- */
/*
 * The plan already produces three scenario values. This section answers the
 * two questions the plan deliberately left open — "how likely am I to reach my
 * target?" and "what is the range around it?" — WITHOUT turning a scenario into
 * a price forecast.
 *
 * THE HONESTY RULE THIS SECTION OWNS
 *   A probability and an estimated range come from a MODEL, and a model is a
 *   collection of assumptions. The only honest way to show them is to show the
 *   assumptions too:
 *     · the three scenarios are treated as the P-bear / P-base / P-bull
 *       percentiles of a log-normal band (adjustable, default 10/50/90);
 *     · the resulting number is labelled "estimate based on assumptions",
 *       never "this will happen";
 *     · if any scenario value is missing, the probability is `null` — a dead
 *       feed is reported as dead, never padded with a plausible-looking number.
 */

export const OUTLOOK_SCHEMA = 'fbt.financial-goal-outlook.v1';
export const WHATIF_SCHEMA = 'fbt.financial-goal-whatif.v1';
export const SIMULATOR_SCHEMA = 'fbt.financial-goal-simulator.v1';
export const GOAL_HEALTH_SCHEMA = 'fbt.financial-goal-health.v1';
export const EVIDENCE_SCHEMA = 'fbt.financial-goal-evidence.v1';

/** The default model treats Bear/Base/Bull as the 10th/50th/90th percentile. */
export const DEFAULT_ASSUMPTION_PERCENTILES = Object.freeze({ bear: 0.10, base: 0.50, bull: 0.90 });

const round4 = (v) => Math.round(v * 10000) / 10000;
const round3 = (v) => Math.round(v * 1000) / 1000;

/* Inverse standard-normal CDF (Acklam's rational approximation, ~1e-9). */
function probit(p) {
  if (!(p > 0 && p < 1)) return 0;
  const a = [-3.969683028665376e+01, 2.209460984245205e+02, -2.759285104469687e+02, 1.383577518672690e+02, -3.066479806614716e+01, 2.506628277459239e+00];
  const b = [-5.447609879822406e+01, 1.615858368580409e+02, -1.556989798598866e+02, 6.680131188771972e+01, -1.328068155288572e+01];
  const c = [-7.784894002430293e-03, -3.223964580411365e-01, -2.400758277161838e+00, -2.549732539343734e+00, 4.374664141464968e+00, 2.938163982698783e+00];
  const d = [7.784695709041462e-03, 3.224671290700398e-01, 2.445134137142996e+00, 3.754408661907416e+00];
  const plow = 0.02425;
  const phigh = 1 - plow;
  let q; let r;
  if (p < plow) {
    q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  if (p <= phigh) {
    q = p - 0.5;
    r = q * q;
    return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
  }
  q = Math.sqrt(-2 * Math.log(1 - p));
  return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
}

/* Standard normal CDF. */
function normalCdf(x) {
  return 0.5 * (1 + erf(x / Math.SQRT2));
}
function erf(x) {
  const sign = x < 0 ? -1 : 1;
  const ax = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * ax);
  const y = 1 - ((((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t) * Math.exp(-ax * ax);
  return sign * y;
}

/**
 * Probability of reaching `targetAmount` from the three scenario values, via a
 * log-normal band fitted to the three percentiles. Returns null when any
 * scenario value is missing (a dead feed is reported as dead, never guessed).
 *
 * @returns {{ probability: number|null, probabilityPct: number|null,
 *             mu: number|null, sigma: number|null,
 *             assumptions: object, method: string } | null}
 */
export function goalProbabilityFromScenarios({
  scenarios = [],
  targetAmount = null,
  percentiles = DEFAULT_ASSUMPTION_PERCENTILES
} = {}) {
  const byId = {};
  for (const row of (Array.isArray(scenarios) ? scenarios : [])) {
    if (row?.id) byId[row.id] = num(row.projectedUsd);
  }
  const bear = byId.bear ?? null;
  const base = byId.base ?? null;
  const bull = byId.bull ?? null;
  const target = num(targetAmount);
  if (target === null || target <= 0) return null;
  if (bear === null || base === null || bull === null) return null;
  if (bear <= 0 || base <= 0 || bull <= 0) return null;
  // A degenerate band: all three the same. No distribution to fit.
  if (bear === base && base === bull) {
    return {
      probability: base >= target ? 1 : 0,
      probabilityPct: base >= target ? 100 : 0,
      mu: Math.log(base),
      sigma: 0,
      assumptions: { kind: 'lognormal-quantile', percentiles: { ...DEFAULT_ASSUMPTION_PERCENTILES, bear, base, bull } },
      method: 'degenerate-band'
    };
  }
  const pBear = num(percentiles?.bear) ?? DEFAULT_ASSUMPTION_PERCENTILES.bear;
  const pBase = num(percentiles?.base) ?? DEFAULT_ASSUMPTION_PERCENTILES.base;
  const pBull = num(percentiles?.bull) ?? DEFAULT_ASSUMPTION_PERCENTILES.bull;
  const zBear = probit(pBear);
  const zBase = probit(pBase);
  const zBull = probit(pBull);
  const mu = Math.log(base);
  // sigma from the base↔bull spread and the bear↔base spread. They are
  // averaged ONLY when both sides are real; a degenerate side (e.g. base ==
  // bear when there is no yield) must not drag the spread to half its value.
  const sigmaBull = (Math.log(bull) - Math.log(base)) / (zBull - zBase);
  const sigmaBear = (Math.log(base) - Math.log(bear)) / (zBase - zBear);
  const sigmas = [];
  if (Number.isFinite(sigmaBull) && sigmaBull > 1e-9) sigmas.push(sigmaBull);
  if (Number.isFinite(sigmaBear) && sigmaBear > 1e-9) sigmas.push(sigmaBear);
  const sigma = sigmas.length ? sigmas.reduce((a, b) => a + b, 0) / sigmas.length : 0;
  if (sigma < 1e-9) {
    return {
      probability: base >= target ? 1 : 0,
      probabilityPct: base >= target ? 100 : 0,
      mu,
      sigma: 0,
      assumptions: { kind: 'lognormal-quantile', percentiles: { bear: pBear, base: pBase, bull: pBull }, used: { bear, base, bull } },
      method: 'degenerate-band'
    };
  }
  // P(X >= target) = Φ((mu − ln target) / sigma) for a log-normal.
  const probability = clamp(normalCdf((mu - Math.log(target)) / sigma), 0, 1);
  return {
    probability: round4(probability),
    probabilityPct: Math.round(probability * 100),
    mu: round4(mu),
    sigma: round4(sigma),
    assumptions: {
      kind: 'lognormal-quantile',
      percentiles: { bear: pBear, base: pBase, bull: pBull },
      used: { bear: round2(bear), base: round2(base), bull: round2(bull) },
      rangeConfidence: round2(pBull - pBear)
    },
    method: 'lognormal-quantile'
  };
}

/**
 * 0–1 data-quality score for a plan, explained. A dead market feed is LOW, a
 * live feed with missing venues is MEDIUM, a fully live feed is HIGH. The
 * score is a transparency device, not a promise: it says how much *live
 * evidence* went into the numbers, never how good those numbers are.
 */
export function dataQualityScore({ plan = null } = {}) {
  const live = plan?.market?.live === true;
  const venuesMissing = Array.isArray(plan?.market?.venuesMissing) ? plan.market.venuesMissing : [];
  const yieldLive = plan?.projectedYieldLive === true;
  const reasons = [];
  let score;
  if (!live) {
    score = 0.35;
    reasons.push('marketFeedUnavailable');
  } else if (venuesMissing.length === 0 && yieldLive) {
    score = 0.95;
    reasons.push('marketFeedLive');
    reasons.push('yieldFeedLive');
  } else if (venuesMissing.length > 0 && yieldLive) {
    score = 0.75;
    reasons.push('marketFeedLive');
    reasons.push('someVenuesMissing');
    reasons.push('yieldFeedLive');
  } else {
    score = 0.6;
    reasons.push('marketFeedLive');
    reasons.push('yieldFeedNotLive');
  }
  return {
    score: round2(score),
    scorePct: Math.round(score * 100),
    reasons,
    venuesMissing: venuesMissing.slice(0, 20)
  };
}

/**
 * The full outlook: scenarios, probability, estimated range, data quality and
 * the assumption model behind every number. This is what the Goal Probability
 * card in the spec renders. Called with the goal + the plan (plus optional
 * overrides for a what-if / simulator run), it recomputes the three band
 * values from the same engine functions `buildPlan` uses, so a what-if result
 * can never disagree with the base plan.
 *
 * @returns {{ schema, goalId, targetAmount, currentValueUsd, scenarios,
 *             probability: number|null, probabilityPct: number|null,
 *             range, dataQuality, confidence, assumptions, method,
 *             guaranteed: false, computedAt, warnings: string[] }}
 */
export function buildGoalOutlook({
  goal = {},
  plan = {},
  currentValueUsd = null,
  monthlyContribution = null,
  assumptions = {},
  now = Date.now()
} = {}) {
  const target = num(plan?.inputs?.targetAmount) ?? num(goal?.targetAmount);
  const start = num(currentValueUsd) ?? num(plan?.inputs?.currentValueUsd) ?? num(plan?.inputs?.startingCapital) ?? num(goal?.startingCapital);
  const monthly = num(monthlyContribution) ?? num(plan?.inputs?.monthlyContribution) ?? num(goal?.monthlyContribution) ?? 0;
  const years = num(plan?.inputs?.years) ?? null;
  const requiredPct = num(plan?.requiredReturnPct) ?? null;
  const projectedYield = num(plan?.projectedYieldPct) ?? null;

  const warnings = [];
  let scenarios = [];
  if (years === null || years <= 0) {
    warnings.push('invalidHorizon');
  } else {
    scenarios = projectScenarios({
      startingCapital: Math.max(0, start),
      monthlyContribution: Math.max(0, monthly),
      years,
      requiredReturnPct: requiredPct,
      projectedYield
    });
  }
  if (!plan?.projectedYieldLive && plan?.projectedYieldPct === null) warnings.push('noYieldFeed');

  const percentiles = { ...DEFAULT_ASSUMPTION_PERCENTILES, ...(assumptions?.percentiles || {}) };
  const probability = goalProbabilityFromScenarios({ scenarios, targetAmount: target, percentiles });
  const dataQuality = dataQualityScore({ plan });
  const range = {
    bear: scenarios.find((row) => row.id === 'bear')?.projectedUsd ?? null,
    base: scenarios.find((row) => row.id === 'base')?.projectedUsd ?? null,
    bull: scenarios.find((row) => row.id === 'bull')?.projectedUsd ?? null
  };

  return {
    schema: OUTLOOK_SCHEMA,
    goalId: goal?.id ?? null,
    targetAmount: target === null ? null : round2(target),
    currentValueUsd: round2(Math.max(0, start)),
    monthlyContribution: round2(Math.max(0, monthly)),
    years: years === null ? null : round3(years),
    scenarios,
    probability: probability?.probability ?? null,
    probabilityPct: probability?.probabilityPct ?? null,
    range,
    dataQuality,
    confidence: probability?.assumptions?.rangeConfidence ?? null,
    assumptions: probability?.assumptions ?? null,
    method: probability?.method ?? null,
    guaranteed: false,
    isForecast: false,
    note: 'Estimate based on adjustable assumption bands (the three scenarios), not a forecast.',
    warnings,
    computedAt: new Date(now).toISOString()
  };
}

/* -------------------------------------------------------------------------- */
/* 10. WHAT-IF                                                               */
/* -------------------------------------------------------------------------- */

/** The allocation's exposure to one asset (or the 'crypto' sleeve) as a 0–1 weight. */
function exposureWeightFor(plan, asset) {
  const rows = Array.isArray(plan?.allocation) ? plan.allocation : [];
  const byAsset = {};
  for (const row of rows) byAsset[String(row.asset).toUpperCase()] = Number(row.percentage) ?? 0;
  const weight = (a) => (byAsset[a] || 0) / 100;
  const normalized = String(asset || '').toUpperCase();
  if (normalized === 'CRYPTO') return weight('BTC') + weight('ETH') + weight('OTHER');
  return weight(normalized);
}

function riskDeltaLabel(beforeProbabilityPct, afterProbabilityPct) {
  const b = num(beforeProbabilityPct);
  const a = num(afterProbabilityPct);
  if (b === null || a === null) return 'unknown';
  // A drop in goal probability is a rise in effective risk, and vice versa.
  if (a > b + 2) return 'down';
  if (a < b - 2) return 'up';
  return 'same';
}

/**
 * Recompute the outlook after a single change and report the difference —
 * never a guarantee, always labelled as the assumptions' consequence.
 *
 * `change` is one of:
 *   { type: 'market-shock', asset: 'BTC' | 'ETH' | 'crypto', changePct: -30 }
 *   { type: 'contribution', monthlyDeltaUsd: 500 }
 *
 * @returns {{ schema, kind, change, before, after, delta, assumptions,
 *             guaranteed: false, note, computedAt, warnings }}
 */
export function simulateWhatIf({
  goal = {},
  plan = {},
  change = null,
  currentValueUsd = null,
  monthlyContribution = null,
  assumptions = {},
  now = Date.now()
} = {}) {
  const before = buildGoalOutlook({ goal, plan, currentValueUsd, monthlyContribution, assumptions, now });
  const target = num(plan?.inputs?.targetAmount) ?? num(goal?.targetAmount);
  const baseValue = Math.max(0, num(currentValueUsd) ?? num(plan?.inputs?.currentValueUsd) ?? num(plan?.inputs?.startingCapital) ?? num(goal?.startingCapital) ?? 0);
  const baseMonthly = Math.max(0, num(monthlyContribution) ?? num(plan?.inputs?.monthlyContribution) ?? num(goal?.monthlyContribution) ?? 0);
  const warnings = [];

  let after;
  let delta = { valueUsd: 0, probabilityPct: 0 };

  if (change?.type === 'market-shock') {
    const pct = num(change.changePct);
    if (pct === null || pct === 0 || pct < -99) {
      return { schema: WHATIF_SCHEMA, kind: change?.type, change, before, after: before, delta, guaranteed: false, note: 'No change — invalid shock.', computedAt: new Date(now).toISOString(), warnings: ['invalidShock'] };
    }
    const weight = exposureWeightFor(plan, change.asset);
    const shocked = baseValue * (1 + (pct / 100) * weight);
    const afterOutlook = buildGoalOutlook({ goal, plan, currentValueUsd: shocked, monthlyContribution: baseMonthly, assumptions, now });
    after = afterOutlook;
    delta = {
      valueUsd: round2(shocked - baseValue),
      probabilityPct: (afterOutlook.probabilityPct ?? 0) - (before.probabilityPct ?? 0),
      risk: riskDeltaLabel(before.probabilityPct, afterOutlook.probabilityPct)
    };
    warnings.push('marketShockIsAssumption');
  } else if (change?.type === 'contribution') {
    const deltaMonthly = Math.max(-baseMonthly, num(change.monthlyDeltaUsd) ?? 0);
    const newMonthly = baseMonthly + deltaMonthly;
    const afterOutlook = buildGoalOutlook({ goal, plan, currentValueUsd: baseValue, monthlyContribution: newMonthly, assumptions, now });
    after = afterOutlook;
    delta = {
      valueUsd: round2(afterOutlook.range.base ?? 0) - round2(before.range.base ?? 0),
      probabilityPct: (afterOutlook.probabilityPct ?? 0) - (before.probabilityPct ?? 0),
      risk: riskDeltaLabel(before.probabilityPct, afterOutlook.probabilityPct)
    };
  } else {
    return { schema: WHATIF_SCHEMA, kind: null, change, before, after: before, delta, guaranteed: false, note: 'Unknown what-if change.', computedAt: new Date(now).toISOString(), warnings: ['unknownChange'] };
  }

  return {
    schema: WHATIF_SCHEMA,
    kind: change.type,
    change,
    before,
    after,
    delta,
    guaranteed: false,
    note: 'Recomputed under the same assumption band as the base plan. This is a model consequence, not a prediction.',
    warnings,
    computedAt: new Date(now).toISOString()
  };
}

/* -------------------------------------------------------------------------- */
/* 11. GOAL SIMULATOR — monthly contribution → target probability             */
/* -------------------------------------------------------------------------- */

/**
 * For the simulator slider / table: given a set of candidate monthly
 * contributions, compute the target probability of each. Single pass, pure.
 *
 * @returns {{ schema, targetAmount, currentValueUsd, baseMonthlyUsd,
 *             rows: Array<{ monthlyUsd, probabilityPct, probability,
 *                           rangeBaseUsd, deltaProbabilityPct }>,
 *             assumptions, guaranteed: false, computedAt, warnings }}
 */
export function simulateGoal({
  goal = {},
  plan = {},
  candidates = [0, 250, 500, 750, 1000, 1500, 2500, 5000],
  currentValueUsd = null,
  assumptions = {},
  now = Date.now()
} = {}) {
  const target = num(plan?.inputs?.targetAmount) ?? num(goal?.targetAmount);
  const start = Math.max(0, num(currentValueUsd) ?? num(plan?.inputs?.currentValueUsd) ?? num(plan?.inputs?.startingCapital) ?? num(goal?.startingCapital) ?? 0);
  const baseMonthly = Math.max(0, num(plan?.inputs?.monthlyContribution) ?? num(goal?.monthlyContribution) ?? 0);
  const warnings = [];
  const list = Array.isArray(candidates) ? candidates : [candidates];

  const base = buildGoalOutlook({ goal, plan, currentValueUsd: start, monthlyContribution: baseMonthly, assumptions, now });
  const rows = list
    .map((value) => {
      const monthly = Math.max(0, num(value) ?? 0);
      const out = buildGoalOutlook({ goal, plan, currentValueUsd: start, monthlyContribution: monthly, assumptions, now });
      return {
        monthlyUsd: round2(monthly),
        probabilityPct: out.probabilityPct ?? null,
        probability: out.probability ?? null,
        rangeBaseUsd: out.range?.base ?? null,
        rangeBullUsd: out.range?.bull ?? null,
        deltaProbabilityPct: (out.probabilityPct ?? 0) - (base.probabilityPct ?? 0)
      };
    });
  if (!plan?.projectedYieldLive && plan?.projectedYieldPct === null) warnings.push('noYieldFeed');
  return {
    schema: SIMULATOR_SCHEMA,
    targetAmount: target === null ? null : round2(target),
    currentValueUsd: round2(start),
    baseMonthlyUsd: round2(baseMonthly),
    baseProbabilityPct: base.probabilityPct,
    rows,
    assumptions: base.assumptions,
    guaranteed: false,
    computedAt: new Date(now).toISOString(),
    warnings
  };
}

/* -------------------------------------------------------------------------- */
/* 12. GOAL HEALTH                                                            */
/* -------------------------------------------------------------------------- */

/** Whole months needed to reach target with a fixed monthly at a given rate. */
function monthsToReach({ currentUsd, targetUsd, monthlyUsd, annualRate }) {
  const c = Math.max(0, num(currentUsd) ?? 0);
  const t = num(targetUsd);
  const p = Math.max(0, num(monthlyUsd) ?? 0);
  const rate = Math.max(0, num(annualRate) ?? 0);
  if (t === null || t <= c) return 0;
  if (p <= 0 && rate <= 0) return null; // nothing can close the gap
  if (p <= 0) {
    // pure growth
    if (rate <= 0 || c <= 0) return null;
    return Math.log(t / c) / Math.log(1 + rate) * 12;
  }
  // solve FV(c, p, m/12, rate) = t for m by bisection (months).
  const fv = (months) => futureValue({ starting: c, monthly: p, years: months / 12, annualReturn: rate });
  let lo = 0;
  let hi = 12 * 120; // 120 years cap
  if ((fv(hi) ?? 0) < t) return null;
  for (let i = 0; i < 120; i += 1) {
    const mid = (lo + hi) / 2;
    const value = fv(mid);
    if (value === null || value === undefined) return null;
    if (value < t) lo = mid; else hi = mid;
    if (hi - lo < 1e-6) break;
  }
  return Math.ceil((lo + hi) / 2);
}

/** The monthly contribution that reaches the target from the current value. */
function monthlyToReach({ currentUsd, targetUsd, years, annualRate }) {
  const c = Math.max(0, num(currentUsd) ?? 0);
  const t = num(targetUsd);
  const y = num(years);
  const rate = Math.max(0, num(annualRate) ?? 0);
  if (t === null || t <= 0 || y === null || y <= 0) return null;
  if (c >= t) return 0;
  // FV = c·(1+r)^y + p·(( (1+r)^y −1 ) / r_monthly)  → solve p
  const growth = Math.pow(1 + rate, y);
  const monthlyRate = Math.pow(1 + rate, 1 / 12) - 1;
  if (!Number.isFinite(growth) || !Number.isFinite(monthlyRate) || monthlyRate <= 0) {
    const flat = t - c;
    return flat / (Math.max(1, Math.round(y * 12)));
  }
  const numerator = Math.max(0, t - c * growth);
  const denominator = (growth - 1) / monthlyRate;
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator <= 0) return null;
  return numerator / denominator;
}

/**
 * Goal health: how far along the path the portfolio is, how likely the goal
 * still is, and — when the goal is drifting — the three bounded corrections.
 *
 * @returns {{ schema, goalId, healthPct, status, onTrack, behindPct,
 *             probabilityPct, progressPct, currentValueUsd, targetValueUsd,
 *             expectedValueUsd, deltaUsd, pathRatio, factors, suggestions,
 *             computedAt, warnings }}
 */
export function goalHealth({
  goal = {},
  plan = {},
  currentValueUsd = null,
  snapshots = [],
  assumptions = {},
  now = Date.now()
} = {}) {
  const report = monitorGoal({ goal, currentValueUsd, snapshots, now });
  const outlook = buildGoalOutlook({ goal, plan, currentValueUsd, assumptions, now });
  const target = Math.max(0, num(goal?.targetAmount) ?? 0);
  const current = Math.max(0, report.currentValueUsd ?? 0);
  const expected = report.expectedValueUsd ?? 0;
  const pathRatio = report.pathRatio ?? 1;
  const probability = outlook.probabilityPct ?? null;

  const factors = [];
  let health = 0;
  // 40 pts: how close to the expected path (1.0 = exactly on it).
  const pathPts = Math.round(clamp(pathRatio, 0, 1.2) / 1.2 * 40);
  health += pathPts;
  factors.push({ key: 'health.factor.path', points: pathPts, detail: `${Math.round(pathRatio * 100)}%` });
  // 35 pts: the goal probability (assumption-based).
  const probPts = probability === null ? 0 : Math.round(clamp(probability / 100, 0, 1) * 35);
  health += probPts;
  factors.push({ key: 'health.factor.probability', points: probPts, detail: probability === null ? null : `${probability}%` });
  // 25 pts: how much of the target is already funded.
  const fundedPts = target > 0 ? Math.round(clamp(current / target, 0, 1) * 25) : 0;
  health += fundedPts;
  factors.push({ key: 'health.factor.funded', points: fundedPts, detail: target > 0 ? `${Math.round((current / target) * 100)}%` : null });

  let status = report.status;
  let onTrack = true;
  if (status === 'COMPLETED') { onTrack = true; }
  else if (status === 'AHEAD' || status === 'ON_TRACK') { onTrack = true; }
  else if (status === 'PAUSED') { onTrack = false; }
  else { onTrack = false; } // BEHIND / AT_RISK

  const behindPct = expected > 0 && current < expected ? round2(((expected - current) / expected) * 100) : 0;

  const yieldPct = Math.max(0, num(plan?.projectedYieldPct) ?? 0) / 100;
  const baseMonthly = Math.max(0, num(plan?.inputs?.monthlyContribution) ?? num(goal?.monthlyContribution) ?? 0);
  const years = num(plan?.inputs?.years) ?? null;
  const suggestions = [];

  if (!onTrack && status !== 'PAUSED') {
    const neededMonthly = monthlyToReach({ currentUsd: current, targetUsd: target, years, annualRate: yieldPct });
    const extraMonthly = neededMonthly === null ? null : Math.max(0, Math.round(neededMonthly - baseMonthly));
    if (extraMonthly !== null && extraMonthly > 0) {
      suggestions.push({ kind: 'increaseMonthly', detail: extraMonthly, present: true });
    }

    const achievable = years !== null
      ? futureValue({ starting: current, monthly: baseMonthly, years, annualReturn: yieldPct })
      : null;
    const reduceBy = (achievable !== null && Number.isFinite(achievable)) ? Math.max(0, Math.round(target - achievable)) : null;
    if (reduceBy !== null && reduceBy > 0) {
      suggestions.push({ kind: 'reduceTarget', detail: reduceBy, present: true });
    }

    const extraMonths = monthsToReach({ currentUsd: current, targetUsd: target, monthlyUsd: baseMonthly, annualRate: yieldPct });
    if (extraMonths !== null) {
      suggestions.push({ kind: 'extendTimeline', detail: extraMonths, present: true });
    }
  }
  if (suggestions.length === 0 && !onTrack) {
    suggestions.push({ kind: 'reviewPlan', present: true });
  }

  return {
    schema: GOAL_HEALTH_SCHEMA,
    goalId: goal?.id ?? null,
    healthPct: Math.round(clamp(health, 0, 100)),
    status,
    onTrack,
    behindPct,
    probabilityPct: probability,
    progressPct: report.progressPct,
    currentValueUsd: report.currentValueUsd,
    targetValueUsd: report.targetValueUsd,
    expectedValueUsd: report.expectedValueUsd,
    deltaUsd: report.deltaUsd,
    pathRatio: report.pathRatio,
    factors,
    suggestions,
    valueReported: report.valueReported,
    guaranteed: false,
    computedAt: new Date(now).toISOString(),
    warnings: outlook.warnings
  };
}

/* -------------------------------------------------------------------------- */
/* 13. EVIDENCE — WHY THIS PLAN                                               */
/* -------------------------------------------------------------------------- */

/**
 * Every number the engine shows is attributable. This builds the "why this
 * plan?" list from the plan's own computed facts — never a made-up correlation
 * or a price view — plus the data-quality and freshness of the feed behind it.
 *
 * @returns {{ schema, goalId, evidence: Array<{key, ok, detail}>, dataQuality,
 *             dataUpdatedAt, computedAt }}
 */
export function planEvidence({ goal = {}, plan = {}, now = Date.now() } = {}) {
  const evidence = [];
  const years = num(plan?.inputs?.years);
  if (years !== null && years > 0) {
    evidence.push({ key: 'evidence.horizon', ok: true, detail: String(Math.round(years * 10) / 10) });
  }
  const profile = normaliseRiskProfile(goal?.riskProfile ?? plan?.inputs?.riskProfile);
  evidence.push({ key: 'evidence.riskProfile', ok: true, detail: profile });
  if (plan?.requiredReturnPct !== null && plan?.requiredReturnPct !== undefined) {
    evidence.push({ key: 'evidence.requiredReturn', ok: true, detail: String(round2(plan.requiredReturnPct)) });
  }
  const stablePct = (plan?.allocation || []).find((row) => row.asset === 'STABLE')?.percentage;
  if (Number.isFinite(Number(stablePct))) {
    evidence.push({ key: 'evidence.stableReserve', ok: true, detail: String(stablePct) });
  }
  const btcPct = (plan?.allocation || []).find((row) => row.asset === 'BTC')?.percentage;
  if (Number.isFinite(Number(btcPct)) && Number(btcPct) >= 30) {
    evidence.push({ key: 'evidence.concentration', ok: Number(btcPct) < 50, detail: String(btcPct) });
  }
  const projectedYield = num(plan?.projectedYieldPct);
  const requiredReturn = num(plan?.requiredReturnPct);
  if (projectedYield !== null && requiredReturn !== null) {
    evidence.push({
      key: requiredReturn > projectedYield ? 'evidence.yieldGap' : 'evidence.yieldSufficient',
      ok: requiredReturn <= projectedYield,
      detail: `${round2(projectedYield)}%`
    });
  }
  const goalProbability = num(buildGoalOutlook({ goal, plan, now })?.probabilityPct);
  if (goalProbability !== null) {
    evidence.push({ key: 'evidence.goalProbability', ok: goalProbability >= 60, detail: String(goalProbability) });
  }
  const dq = dataQualityScore({ plan });
  return {
    schema: EVIDENCE_SCHEMA,
    goalId: goal?.id ?? null,
    evidence,
    dataQuality: dq,
    dataUpdatedAt: plan?.market?.generatedAt ?? null,
    caveats: ['Nothing here is a price forecast — not a forecast, not a guarantee; the goal probability is a model estimate under adjustable assumptions.'].concat(
      plan?.projectedYieldLive ? [] : ['No live yield feed — the base scenario is unchanged from bear.'],
      plan?.market?.live ? [] : ['No live market feed — the plan is built on the user’s own numbers only.']
    ),
    computedAt: new Date(now).toISOString()
  };
}

/* -------------------------------------------------------------------------- */
/* 14. THREE RISK STRATEGIES + FUTURES EXPOSURE (assumption bands)            */
/* -------------------------------------------------------------------------- */

export const STRATEGIES_SCHEMA = 'fbt.financial-goal-strategies.v1';
export const FUTURES_SCHEMA = 'fbt.financial-goal-futures.v1';

/**
 * Futures exposure is a bounded recommendation, never a "buy futures to get
 * there faster" nudge:
 *   recommendedPct — a small ceiling, driven by the risk profile;
 *   maximumPct     — the hard cap the product will allow;
 *   riskContribution — high for an aggressive profile;
 * and, when the caller compares the goal probability with and without futures,
 * a warning if futures would LOWER the chance of reaching the goal. A message
 * like "futures makes you more likely to succeed" is exactly what this module
 * is built to stop.
 */
export const FUTURES_CAP = Object.freeze({ recommendedMaxPct: 5, absoluteMaxPct: 10 });

export function futuresExposure({
  riskProfile = 'MODERATE',
  probabilityPct = null,
  baseProbabilityPct = null
} = {}) {
  const profile = normaliseRiskProfile(riskProfile);
  const recommendedPct = { CONSERVATIVE: 0, MODERATE: 2.5, AGGRESSIVE: 5 }[profile] ?? 2.5;
  const base = num(baseProbabilityPct);
  const withFutures = num(probabilityPct);
  const impact = (base !== null && withFutures !== null) ? round2(withFutures - base) : null;
  const reducesProbability = impact !== null && impact < 0;
  return {
    schema: FUTURES_SCHEMA,
    recommendedPct,
    maximumPct: FUTURES_CAP.absoluteMaxPct,
    riskContribution: profile === 'AGGRESSIVE' ? 'high' : profile === 'CONSERVATIVE' ? 'low' : 'medium',
    quotedSlippageAllowedPct: 1.0,
    probabilityImpactPct: impact,
    reducesProbability,
    isBoostOnly: false,
    warning: reducesProbability
      ? 'Futures may increase expected return but significantly increases downside risk.'
      : (impact !== null && impact > 0 ? 'Futures increases the model estimate here — treat it as a lever, not a guarantee.' : null),
    guaranteed: false,
    isForecast: false,
    note: 'Futures is a leveraged execution path outside the core engine; the numbers above are assumption-based, not a forecast. Nothing here executes.'
  };
}

/** Per-profile assumption presets for the three strategies. */
const STRATEGY_META = Object.freeze({
  CONSERVATIVE: Object.freeze({ bullFactor: 0.6, drawdownPct: 9, riskBand: 'low' }),
  MODERATE: Object.freeze({ bullFactor: 1.0, drawdownPct: 18, riskBand: 'medium' }),
  AGGRESSIVE: Object.freeze({ bullFactor: 1.5, drawdownPct: 35, riskBand: 'high' })
});
const STRATEGY_PROFILES = Object.freeze(['CONSERVATIVE', 'MODERATE', 'AGGRESSIVE']);

/**
 * The three strategies (conservative / balanced / aggressive). Each row is
 * built from a real allocation (via `buildAllocation`) and a scenario band, so
 * the numbers are internally consistent with the rest of the engine. The
 * return and drawdown shown are labelled assumption values — a wider band means
 * a higher midpoint return and a harder chance of missing the goal, which is
 * exactly the conservative ↔ aggressive trade. Nothing here is a forecast.
 */
export function buildRiskStrategies({
  goal = {},
  plan = {},
  currentValueUsd = null,
  assumptions = {},
  now = Date.now()
} = {}) {
  const target = num(plan?.inputs?.targetAmount) ?? num(goal?.targetAmount);
  const start = Math.max(0, num(currentValueUsd) ?? num(plan?.inputs?.currentValueUsd) ?? num(plan?.inputs?.startingCapital) ?? num(goal?.startingCapital) ?? 0);
  const monthly = Math.max(0, num(plan?.inputs?.monthlyContribution) ?? num(goal?.monthlyContribution) ?? 0);
  const years = num(plan?.inputs?.years) ?? null;
  const required = num(plan?.requiredReturnPct) ?? 0;
  const percentiles = { ...DEFAULT_ASSUMPTION_PERCENTILES, ...(assumptions?.percentiles || {}) };
  const liveYield = num(plan?.projectedYieldPct) ?? 0;

  const rows = STRATEGY_PROFILES.map((profile) => {
    const meta = STRATEGY_META[profile];
    const { allocation } = buildAllocation({ riskProfile: profile, requiredReturnPct: required, market: plan?.market });
    const yieldView = projectedYieldPct({ allocation, market: plan?.market });
    const baseRate = num(yieldView.projectedYieldPct) ?? liveYield;
    const bullRate = clamp(required * meta.bullFactor, baseRate, 100);
    const scenarios = years === null || years <= 0
      ? []
      : projectScenarios({
        startingCapital: start,
        monthlyContribution: monthly,
        years,
        requiredReturnPct: bullRate,
        projectedYield: baseRate
      });
    const prob = goalProbabilityFromScenarios({ scenarios, targetAmount: target, percentiles });
    const midpoint = (baseRate + bullRate) / 2;
    return {
      id: profile.toLowerCase(),
      riskProfile: profile,
      expectedReturnPct: round2(Math.max(baseRate, midpoint)),
      expectedReturnAssumptionPct: round2(midpoint),
      maxDrawdownPct: meta.drawdownPct,
      probabilityPct: prob?.probabilityPct ?? null,
      riskBand: meta.riskBand,
      allocation,
      projectedYieldPct: baseRate,
      bullRatePct: round2(bullRate),
      assumptions: { kind: 'scenario-band', bullFactor: meta.bullFactor, drawdownPct: meta.drawdownPct, percentiles }
    };
  });

  return {
    schema: STRATEGIES_SCHEMA,
    goalId: goal?.id ?? null,
    targetAmount: target === null ? null : round2(target),
    rows,
    guaranteed: false,
    isForecast: false,
    note: 'Return and drawdown here are assumption bands (wider band = higher midpoint return, lower goal probability). Not a forecast, not a guarantee.',
    selected: 'balanced',
    computedAt: new Date(now).toISOString()
  };
}
