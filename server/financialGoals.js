/**
 * FBT FINANCIAL OS — persistence and the seven Financial Goals routes' logic.
 * ---------------------------------------------------------------------------
 * WHY THERE IS NO SQL MIGRATION HERE
 * The API is stateless by design: it is a cache in front of public market data
 * and the only durable thing it owns today is a tiny key-value store
 * (server/store.js — Vercel Blob when configured, an in-process Map when it is
 * not). Adding Postgres for one feature would mean a connection pool, a second
 * deploy target and migrations for three collections that hold kilobytes, so
 * the specified tables are implemented as three key namespaces inside that
 * same store — under their specified names, so the mapping stays legible:
 *
 *     financial_goals        :<owner>   one row per goal
 *     financial_goal_plans   :<owner>   the latest plan per goal
 *     financial_goal_events  :<owner>   the append-only goal timeline
 *
 * `dataStatus` and `durable` are returned with every response. Without
 * BLOB_READ_WRITE_TOKEN the store is per-instance and disappears on a cold
 * start, and the UI must say so rather than implying a cloud-synced account.
 *
 * WHAT THIS MODULE DOES NOT DO
 *   · no execution: approval produces an INTENT PAYLOAD for the existing
 *     Intent OS. There is no signer, no scheduler, no broadcast here.
 *   · no forecast: market data is read through the existing venue feeds, with
 *     the existing haircuts, and a dead feed is reported as dead.
 *   · no secrets: nothing in this file reads a key, a seed phrase or a
 *     password, and no AI call is ever handed one.
 */

import { createHash, randomUUID } from 'node:crypto';
import { blobConfigured } from './blobCache.js';
import { storeGet, storeSet } from './store.js';
import { withCache } from './cache.js';
import { collectVenueFeeds } from './multiVenue.js';
import {
  YIELD_HAIRCUT,
  annualiseFunding,
  normalizeVenueRows,
  venueClassHealth
} from '../src/lib/intent-ai/multiVenuePlanner.js';
import {
  FINANCIAL_GOAL_EVENT_SCHEMA,
  FINANCIAL_GOAL_INTENT_SCHEMA,
  FINANCIAL_GOAL_MARKET_SCHEMA,
  FINANCIAL_GOAL_PLAN_SCHEMA,
  FINANCIAL_GOAL_SCHEMA,
  FINANCIAL_GOAL_TABLES,
  GOAL_EVENTS,
  LIMITS,
  RISK_PROFILES,
  buildGoalIntent,
  buildPlan,
  monitorGoal,
  normaliseCurrency,
  normaliseRiskProfile,
  parseGoalFromText,
  validateAllocation,
  yearsBetween
} from '../src/lib/financialGoalEngine.js';

/* -------------------------------------------------------------------------- */
/* who is calling                                                             */
/* -------------------------------------------------------------------------- */

const DEVICE_HEADER = 'x-fbt-device';
/* A device scope is an opaque, client-generated label — long enough not to
   collide, short enough to send on every request. */
const DEVICE_RE = /^[A-Za-z0-9_-]{8,64}$/;

/**
 * Two ways to be the owner of a goal set:
 *
 *   telegram — the verified Mini App session (req.tgUser). Cross-device.
 *   device   — a per-install random id the client generates and keeps in
 *              localStorage. It is hashed with the deployment salt before it
 *              is used as a storage key, so the store never holds the raw
 *              label. This is SCOPE, NOT AUTHENTICATION: it keeps one person's
 *              goals separate from another's on a shared deployment. It is not
 *              a security boundary and must never be treated as one — which is
 *              why the UI says "saved for this device".
 */
const OWNER_SALT = process.env.FINANCIAL_GOALS_SALT || process.env.CRON_SECRET || 'fbt-financial-goals';

function hashScope(value) {
  return createHash('sha256').update(`${value}|${OWNER_SALT}`).digest('hex').slice(0, 32);
}

export function ownerFromRequest(req) {
  if (req?.tgUser?.id) return { ok: true, owner: `tg:${req.tgUser.id}`, via: 'telegram' };
  const device = String(req?.get?.(DEVICE_HEADER) || '').trim();
  if (!DEVICE_RE.test(device)) return { ok: false, code: 'DEVICE_SCOPE_REQUIRED' };
  return { ok: true, owner: `dev:${hashScope(device)}`, via: 'device' };
}

/* -------------------------------------------------------------------------- */
/* the three collections                                                      */
/* -------------------------------------------------------------------------- */

const KEYS = Object.freeze({
  financial_goals: (owner) => `financial_goals:v1:${owner}`,
  financial_goal_plans: (owner) => `financial_goal_plans:v1:${owner}`,
  financial_goal_events: (owner) => `financial_goal_events:v1:${owner}`
});

async function readCollection(name, owner) {
  const rows = await storeGet(KEYS[name](owner), []);
  return Array.isArray(rows) ? rows : [];
}

async function writeCollection(name, owner, rows) {
  await storeSet(KEYS[name](owner), rows);
  return rows;
}

export const FINANCIAL_GOAL_LIMITATIONS = Object.freeze([
  'Approval-only: the plan becomes an Intent OS draft the user must review and sign.',
  'No execution engine, no scheduler, no server-side signer, no custody.',
  'Required return and projections are arithmetic, not guarantees — no return is promised.',
  'Price appreciation is never forecast; only live, haircut venue yields are projected.'
]);

const meta = () => ({
  schema: FINANCIAL_GOAL_SCHEMA,
  dataStatus: blobConfigured() ? 'live' : 'unavailable',
  durable: blobConfigured(),
  tables: [...FINANCIAL_GOAL_TABLES],
  limitations: [...FINANCIAL_GOAL_LIMITATIONS]
});

/* -------------------------------------------------------------------------- */
/* input validation (fail closed, before anything is stored)                  */
/* -------------------------------------------------------------------------- */

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const DAY_MS = 24 * 3600_000;

const fail = (code) => ({ ok: false, code });

export function validateGoalInput(input = {}, { now = Date.now() } = {}) {
  const body = input && typeof input === 'object' ? input : {};
  const name = String(body.name ?? body.title ?? '').trim().slice(0, LIMITS.nameMax);
  if (!name) return fail('BAD_NAME');

  const startingCapital = num(body.startingCapital);
  if (startingCapital === null || startingCapital <= 0) return fail('BAD_STARTING_CAPITAL');
  if (startingCapital > 1e12) return fail('BAD_STARTING_CAPITAL');

  const targetAmount = num(body.targetAmount);
  if (targetAmount === null || targetAmount <= 0) return fail('BAD_TARGET_AMOUNT');
  if (targetAmount > 1e12) return fail('BAD_TARGET_AMOUNT');
  if (targetAmount <= startingCapital) return fail('TARGET_NOT_ABOVE_START');

  const targetDate = num(body.targetDate);
  if (targetDate === null || !Number.isSafeInteger(Math.round(targetDate))) return fail('BAD_TARGET_DATE');
  const deadline = Math.round(targetDate);
  if (deadline <= now + 24 * 3600_000) return fail('TARGET_DATE_TOO_SOON');
  const years = yearsBetween(now, deadline);
  if (years === null || years > LIMITS.maxYears) return fail('TARGET_DATE_TOO_FAR');

  const monthlyContribution = num(body.monthlyContribution) ?? 0;
  if (monthlyContribution < 0 || monthlyContribution > startingCapital * LIMITS.maxMonthlyContributionRatio) {
    return fail('BAD_MONTHLY_CONTRIBUTION');
  }

  return {
    ok: true,
    value: {
      name,
      startingCapital,
      targetAmount,
      targetDate: deadline,
      currency: normaliseCurrency(body.currency),
      riskProfile: normaliseRiskProfile(body.riskProfile),
      monthlyContribution,
      years
    }
  };
}

/* -------------------------------------------------------------------------- */
/* goals                                                                      */
/* -------------------------------------------------------------------------- */

const publicGoal = (goal) => ({
  id: goal.id,
  name: goal.name,
  startingCapital: goal.startingCapital,
  targetAmount: goal.targetAmount,
  currency: goal.currency,
  targetDate: goal.targetDate,
  riskProfile: goal.riskProfile,
  monthlyContribution: goal.monthlyContribution,
  status: goal.status,
  createdAt: goal.createdAt,
  updatedAt: goal.updatedAt,
  latestPlanId: goal.latestPlanId ?? null
});

export async function listGoals(owner) {
  const rows = await readCollection('financial_goals', owner);
  return rows
    .slice()
    .sort((a, b) => Number(b.createdAt) - Number(a.createdAt))
    .map(publicGoal);
}

export async function createGoal(owner, input, { now = Date.now() } = {}) {
  const checked = validateGoalInput(input, { now });
  if (!checked.ok) return checked;
  const rows = await readCollection('financial_goals', owner);
  if (rows.length >= LIMITS.maxGoalsPerOwner) return fail('TOO_MANY_GOALS');
  const goal = {
    schema: FINANCIAL_GOAL_SCHEMA,
    id: `goal_${randomUUID().replace(/-/g, '').slice(0, 20)}`,
    ...checked.value,
    status: 'DRAFT',
    createdAt: now,
    updatedAt: now,
    latestPlanId: null
  };
  await writeCollection('financial_goals', owner, [goal, ...rows].slice(0, LIMITS.maxGoalsPerOwner));
  await appendEvent(owner, goal.id, 'GOAL_CREATED', { name: goal.name, targetAmount: goal.targetAmount }, { now });
  return { ok: true, goal, public: publicGoal(goal), created: true };
}

async function findGoal(owner, id) {
  const rows = await readCollection('financial_goals', owner);
  const index = rows.findIndex((row) => row.id === String(id));
  if (index === -1) return { ok: false, code: 'GOAL_NOT_FOUND' };
  return { ok: true, rows, index, goal: rows[index] };
}

export async function getGoal(owner, id) {
  const found = await findGoal(owner, id);
  if (!found.ok) return found;
  const plan = await latestPlan(owner, id);
  return { ok: true, goal: publicGoal(found.goal), plan: plan ? publicPlan(plan) : null };
}

/* -------------------------------------------------------------------------- */
/* events (financial_goal_events)                                             */
/* -------------------------------------------------------------------------- */

export async function appendEvent(owner, goalId, type, data = {}, { now = Date.now() } = {}) {
  if (!GOAL_EVENTS.includes(type)) return fail('BAD_EVENT');
  const rows = await readCollection('financial_goal_events', owner);
  const event = {
    schema: FINANCIAL_GOAL_EVENT_SCHEMA,
    id: `evt_${randomUUID().replace(/-/g, '').slice(0, 20)}`,
    goalId: String(goalId),
    type,
    data: data && typeof data === 'object' ? data : {},
    at: now
  };
  const next = [...rows, event].slice(-LIMITS.maxEventsPerGoal * LIMITS.maxGoalsPerOwner);
  await writeCollection('financial_goal_events', owner, next);
  return { ok: true, event };
}

export async function listEvents(owner, goalId) {
  const rows = await readCollection('financial_goal_events', owner);
  return rows.filter((row) => row.goalId === String(goalId)).slice(-LIMITS.maxEventsPerGoal);
}

/* -------------------------------------------------------------------------- */
/* plans (financial_goal_plans)                                               */
/* -------------------------------------------------------------------------- */

async function latestPlan(owner, goalId) {
  const rows = await readCollection('financial_goal_plans', owner);
  return rows.find((row) => row.goalId === String(goalId)) || null;
}

const publicPlan = (plan) => ({
  schema: FINANCIAL_GOAL_PLAN_SCHEMA,
  id: plan.id,
  goalId: plan.goalId,
  generatedAt: plan.generatedAt,
  inputs: plan.inputs,
  requiredReturnPct: plan.requiredReturnPct,
  requiredReturnSimplePct: plan.requiredReturnSimplePct,
  reachable: plan.reachable,
  reachReason: plan.reachReason,
  contributionsOnlyValueUsd: plan.contributionsOnlyValueUsd,
  riskScore: plan.riskScore,
  riskBand: plan.riskBand,
  riskFactors: plan.riskFactors,
  allocation: plan.allocation,
  tilt: plan.tilt,
  projectedYieldPct: plan.projectedYieldPct,
  projectedYieldLive: plan.projectedYieldLive,
  scenarios: plan.scenarios,
  market: plan.market,
  guarantees: plan.guarantees,
  approvedAt: plan.approvedAt ?? null,
  intent: plan.intent ?? null
});

/* -------------------------------------------------------------------------- */
/* market data — the existing venue feeds, with the existing haircuts          */
/* -------------------------------------------------------------------------- */

const MARKET_TTL_MS = 60_000;

function median(values) {
  if (!values.length) return null;
  const sorted = values.slice().sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

async function readMarket({ now = Date.now() } = {}) {
  const feeds = await collectVenueFeeds({ now });
  const rows = normalizeVenueRows(feeds?.feeds || {}, { now });

  const fresh = (klass) => (rows[klass] || []).filter((row) => !row.stale);

  const poolYield = (stablecoinOnly) => {
    const pools = fresh('yield-farm')
      .filter((row) => Number.isFinite(Number(row.apyPct)) && (stablecoinOnly ? row.stablecoin === true : true))
      .filter((row) => (stablecoinOnly ? true : row.riskTier !== 'high'))
      .sort((a, b) => Number(b.tvlUsd ?? 0) - Number(a.tvlUsd ?? 0))
      .slice(0, 12);
    const raw = median(pools.map((row) => Number(row.apyPct)));
    return raw === null ? null : Math.round(raw * YIELD_HAIRCUT['yield-farm'] * 100) / 100;
  };

  const fundingRows = [...fresh('futures'), ...fresh('dydx-global')]
    .map((row) => (Number.isFinite(Number(row.fundingAprPct))
      ? Number(row.fundingAprPct)
      : annualiseFunding(row.fundingRatePct, row.fundingIntervalHours)))
    .filter((apr) => Number.isFinite(apr) && apr > 0)
    .slice(0, 20);
  const fundingApr = median(fundingRows);
  const fundingHaircut = fundingApr === null
    ? null
    : Math.round(fundingApr * YIELD_HAIRCUT.futures * 100) / 100;

  const liveClasses = Object.keys(rows).filter((klass) => venueClassHealth(rows[klass], { now }).live);
  const stableYieldPct = poolYield(true) ?? poolYield(false);

  return {
    schema: FINANCIAL_GOAL_MARKET_SCHEMA,
    generatedAt: new Date(now).toISOString(),
    live: liveClasses.length > 0,
    stableYieldPct,
    farmYieldPct: poolYield(false),
    fundingAprPct: fundingHaircut,
    venuesLive: liveClasses.length,
    venuesMissing: Object.keys(rows).filter((klass) => !venueClassHealth(rows[klass], { now }).live),
    reasons: feeds?.reasons ?? null,
    sources: feeds?.sources ?? null,
    secretsExposed: false
  };
}

/**
 * The four venue feeds are already budgeted and timed upstream; this adds a
 * one-minute process cache so a user rebuilding a plan twice cannot pay for it
 * in someone else's latency. A failed read returns an honest dead market —
 * never a cached guess from another hour.
 */
export async function marketSnapshot({ now = Date.now() } = {}) {
  try {
    const { value } = await withCache('financial-goals:market:v1', MARKET_TTL_MS, () => readMarket({ now }));
    return value;
  } catch (error) {
    return {
      schema: FINANCIAL_GOAL_MARKET_SCHEMA,
      generatedAt: new Date(now).toISOString(),
      live: false,
      stableYieldPct: null,
      farmYieldPct: null,
      fundingAprPct: null,
      venuesLive: 0,
      venuesMissing: ['yield-farm', 'futures', 'dydx-global', 'stocks'],
      reasons: { market: String(error?.message || 'FAILED').slice(0, 80) },
      secretsExposed: false
    };
  }
}

/* -------------------------------------------------------------------------- */
/* the pipeline                                                               */
/* -------------------------------------------------------------------------- */

export async function buildGoalPlan(owner, goalId, input = {}, { now = Date.now() } = {}) {
  const found = await findGoal(owner, goalId);
  if (!found.ok) return found;

  const currentValueUsd = num(input.currentValueUsd);
  const market = await marketSnapshot({ now });
  const plan = buildPlan({
    goal: found.goal,
    market,
    currentValueUsd: currentValueUsd === null ? null : Math.max(0, currentValueUsd),
    now
  });
  /* The engine already validates on the way out; re-assert here so a stored
     plan can never carry a broken allocation. */
  validateAllocation(plan.allocation);

  const record = {
    ...plan,
    id: `plan_${randomUUID().replace(/-/g, '').slice(0, 20)}`,
    goalId: found.goal.id,
    approvedAt: null,
    intent: null
  };
  const rows = await readCollection('financial_goal_plans', owner);
  await writeCollection('financial_goal_plans', owner, [record, ...rows.filter((row) => row.goalId !== record.goalId)]);

  const updated = { ...found.goal, latestPlanId: record.id, updatedAt: now };
  const goals = [...found.rows];
  goals[found.index] = updated;
  await writeCollection('financial_goals', owner, goals);
  await appendEvent(owner, goalId, 'PLAN_BUILT', {
    planId: record.id,
    requiredReturnPct: record.requiredReturnPct,
    riskScore: record.riskScore,
    marketLive: market.live
  }, { now });

  return { ok: true, goal: publicGoal(updated), plan: publicPlan(record), market };
}

/**
 * Approval does NOT execute. It freezes the plan, produces the Intent OS
 * payload and marks the goal active; the draft is then compiled, reviewed and
 * signed by the user inside the existing Intent OS.
 */
export async function approveGoalPlan(owner, goalId, { now = Date.now() } = {}) {
  const found = await findGoal(owner, goalId);
  if (!found.ok) return found;
  const plan = await latestPlan(owner, goalId);
  if (!plan) return fail('NO_PLAN');
  validateAllocation(plan.allocation);

  const intent = buildGoalIntent({ goal: found.goal, plan, now });
  const approved = { ...plan, approvedAt: now, intent };
  const rows = await readCollection('financial_goal_plans', owner);
  const index = rows.findIndex((row) => row.id === plan.id);
  if (index >= 0) rows[index] = approved; else rows.unshift(approved);
  await writeCollection('financial_goal_plans', owner, rows);

  const next = { ...found.goal, status: 'ACTIVE', updatedAt: now };
  const goals = [...found.rows];
  goals[found.index] = next;
  await writeCollection('financial_goals', owner, goals);
  await appendEvent(owner, goalId, 'PLAN_APPROVED', { planId: plan.id, actions: intent.actions.length }, { now });

  return { ok: true, goal: publicGoal(next), plan: publicPlan(approved), intent };
}

export async function pauseGoalPlan(owner, goalId, { paused = true, now = Date.now() } = {}) {
  const found = await findGoal(owner, goalId);
  if (!found.ok) return found;
  const status = paused ? 'PAUSED' : 'ACTIVE';
  const next = { ...found.goal, status, updatedAt: now };
  const goals = [...found.rows];
  goals[found.index] = next;
  await writeCollection('financial_goals', owner, goals);
  await appendEvent(owner, goalId, paused ? 'GOAL_PAUSED' : 'GOAL_RESUMED', {}, { now });
  return { ok: true, goal: publicGoal(next) };
}

/**
 * Monitoring. A snapshot is recorded only when the caller actually supplies a
 * value and it differs from the last one, so refreshing the screen cannot
 * write an unbounded timeline.
 */
export async function goalProgress(owner, goalId, { currentValueUsd = null, now = Date.now() } = {}) {
  const found = await findGoal(owner, goalId);
  if (!found.ok) return found;
  const value = num(currentValueUsd);
  const events = await listEvents(owner, goalId);
  const snapshots = events
    .filter((row) => row.type === 'VALUE_SNAPSHOT')
    .map((row) => ({ at: row.at, valueUsd: row.data?.valueUsd }));

  if (value !== null && value >= 0) {
    const last = snapshots[snapshots.length - 1];
    if (!last || Math.abs(Number(last.valueUsd) - value) > 0.005) {
      await appendEvent(owner, goalId, 'VALUE_SNAPSHOT', { valueUsd: Math.round(value * 100) / 100 }, { now });
      snapshots.push({ at: now, valueUsd: Math.round(value * 100) / 100 });
    }
  }

  const report = monitorGoal({
    goal: found.goal,
    currentValueUsd: value === null ? null : Math.max(0, value),
    snapshots,
    now
  });
  return { ok: true, goal: publicGoal(found.goal), progress: report };
}

/* -------------------------------------------------------------------------- */
/* natural language (rule-based, no model, no secret)                         */
/* -------------------------------------------------------------------------- */

export { parseGoalFromText, FINANCIAL_GOAL_INTENT_SCHEMA, meta as financialGoalMeta };
export const FINANCIAL_GOAL_SCHEMAS = Object.freeze({
  goal: FINANCIAL_GOAL_SCHEMA,
  plan: FINANCIAL_GOAL_PLAN_SCHEMA,
  event: FINANCIAL_GOAL_EVENT_SCHEMA,
  intent: FINANCIAL_GOAL_INTENT_SCHEMA,
  market: FINANCIAL_GOAL_MARKET_SCHEMA
});
export { RISK_PROFILES };
