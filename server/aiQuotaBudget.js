/**
 * THE DAILY PROVIDER ALLOWANCE
 * ---------------------------------------------------------------------------
 * WHY THIS FILE EXISTS
 *
 * The free tier is the binding constraint on this deployment, and it was
 * invisible. The project knew the numbers — OpenRouter's `:free` seat
 * allows 50 requests a day, ~20 a minute on the others — but nothing
 * counted them. There was:
 *
 *   · a PER-TURN ledger (which model failed, which provider is dead),
 *     which stops one turn from re-walking a dead ladder;
 *   · a PER-TURN call cap (six provider requests), which stops one turn
 *     from spending the whole day.
 *
 * Neither of them can see the DAY. So the deployment learned it had run
 * out by getting a 429, and the answer to «the AI is not working» was
 * «the daily cap is reached» — a fact the product knew and the
 * operator did not.
 *
 * This file is the counter. It counts provider requests per UTC day, per
 * provider, and it is DURABLE: the count must survive a serverless
 * instance, or it would reset on every cold start and be worthless.
 *
 * WHAT IT IS FOR
 *
 * Three things, in order of value:
 *
 *   1. **Honesty.** `/api/v1/ai/gateway/health` can say «18 of 50 used
 *      today, 32 left» instead of failing with a 429 and a shrug.
 *   2. **A second line of defence.** When the day's allowance is nearly
 *      spent, a turn can be told to keep its call cap low, so the LAST
 *      few requests of the day are not spent on the first deep question.
 *   3. **A record.** The count is per provider and per day, so a
 *      deployment can see WHICH provider is eating the allowance — the
 *      OpenRouter `:free` seat and the Groq seat have different limits
 *      and different behaviour.
 *
 * WHAT IT IS NOT
 *
 * It is not an enforcement of the provider's cap — the provider does
 * that, and it does it with a 429. This is the project's own accounting,
 * used to decide how to behave BEFORE the provider says no. It is
 * therefore always an ESTIMATE of what the provider counts (a request
 * the provider rejected for an auth error may not count against the
 * daily cap there, and this counts it anyway). Being slightly pessimistic
 * is the right direction for a budget.
 */

import { storeGet, storeSet, storeDurable } from './store.js';

const DAY_MS = 24 * 60 * 60 * 1000;

/** The per-provider daily limits this project plans for. */
export const DEFAULT_DAILY_LIMITS = Object.freeze({
  openrouterfree: 50,
  groq: 50,
  workersai: 10000,
  openrouter: 1000,
  default: 1000
});

/** The durable key. One per provider per UTC day. */
function keyFor(providerId, day) {
  return `ai-quota/v1/${day}/${providerId}`;
}

/** The current UTC day. The providers reset on UTC, so this is the day. */
export function quotaDay(now = Date.now()) {
  return new Date(now).toISOString().slice(0, 10);
}

/** The configured limit for one provider. */
export function dailyLimitFor(providerId, env = process.env) {
  const raw = env?.AI_DAILY_LIMIT_OVERRIDE;
  if (raw) {
    const n = Number(raw);
    if (Number.isFinite(n) && n > 0) return Math.floor(n);
  }
  return DEFAULT_DAILY_LIMITS[providerId] ?? DEFAULT_DAILY_LIMITS.default;
}

/** Is the durable counter on? It follows the deployment's own store. */
export function quotaBudgetDurable(env = process.env) {
  const raw = String(env?.AI_QUOTA_DURABLE ?? 'auto').trim().toLowerCase();
  if (raw === '0' || raw === 'off' || raw === 'false' || raw === 'no') return false;
  if (raw === '1' || raw === 'on' || raw === 'true' || raw === 'yes') return true;
  return storeDurable();
}

/**
 * Read the day's count for one provider.
 *
 * Returns `{ providerId, day, used, limit, left, durable }`. `used` is
 * never negative and `left` is never negative.
 */
export async function readQuota(providerId, { now = Date.now(), env = process.env } = {}) {
  const day = quotaDay(now);
  const limit = dailyLimitFor(providerId, env);
  let used = 0;
  let durable = false;
  try {
    const row = await storeGet(keyFor(providerId, day), null);
    if (row && typeof row === 'object') {
      used = Number(row.used) || 0;
      durable = true;
    }
  } catch {
    /* A counter that cannot be read is a counter that reads zero, and the
       deployment then behaves as if it had allowance. That is the wrong
       direction — so a read failure is reported as NOT durable, and the
       caller decides what to do about it. */
  }
  if (!durable) used = 0;
  return {
    providerId,
    day,
    used: Math.max(0, used),
    limit,
    left: Math.max(0, limit - Math.max(0, used)),
    durable
  };
}

/**
 * Count one provider request against the day.
 *
 * Best-effort and never throws: a counter that breaks a turn would be
 * worse than a turn with no counter. The count is what the deployment
 * THINKS it spent; the provider remains the authority.
 */
export async function spendQuota(providerId, { now = Date.now(), env = process.env } = {}) {
  const day = quotaDay(now);
  const key = keyFor(providerId, day);
  try {
    const row = await storeGet(key, null);
    const used = (row && typeof row === 'object' ? Number(row.used) || 0 : 0) + 1;
    await storeSet(key, { used, day, at: now }, DAY_MS);
    return { ok: true, providerId, day, used };
  } catch {
    return { ok: false, providerId, day, used: 0 };
  }
}

/**
 * The day's state for every provider in the fleet.
 *
 * This is what the health route publishes, so the operator can see the
 * allowance being spent instead of discovering it through a 429.
 */
export async function readQuotaForFleet(providerIds = [], { now = Date.now(), env = process.env } = {}) {
  const rows = [];
  for (const id of providerIds) {
    rows.push(await readQuota(id, { now, env }));
  }
  const totalUsed = rows.reduce((n, r) => n + r.used, 0);
  const totalLimit = rows.reduce((n, r) => n + r.limit, 0);
  const tightest = rows
    .filter((r) => r.limit > 0)
    .sort((a, b) => (a.left - a.limit) - (b.left - b.limit))[0] || null;
  return {
    schema: 'fbt.ai-quota-budget.v1',
    day: quotaDay(now),
    durable: quotaBudgetDurable(env),
    providers: rows,
    used: totalUsed,
    limit: totalLimit,
    left: Math.max(0, totalLimit - totalUsed),
    /* The provider with the least headroom, and how little that is. */
    tightest: tightest ? { providerId: tightest.providerId, left: tightest.left, limit: tightest.limit } : null,
    /* The share of the tightest provider's allowance that is gone. */
    pressure: tightest && tightest.limit > 0 ? Math.min(1, tightest.used / tightest.limit) : 0
  };
}

/**
 * The call cap this turn should use, given how much of the day is left.
 *
 * This is the second line of defence. The turn's own cap (six) is the
 * normal shape of a deep turn. But when the day's allowance is nearly
 * gone, the turn keeps its cap LOW, so the last few requests of the day
 * are spread over several questions instead of spent on the first one.
 *
 * The thresholds are deliberately blunt:
 *
 *   · under 25 % headroom → the cap drops to a third;
 *   · under 10 % headroom → the cap drops to one call.
 *
 * A turn with one call still answers — it answers from its own analyses
 * and says that the depth was reduced. A turn with no answer is worse
 * than a shallow one.
 */
export async function quotaAwareCallCap(providerIds = [], { now = Date.now(), env = process.env, baseCap = null } = {}) {
  /* The base cap is the turn's own ceiling, and the caller normally
     passes it. When it does not, the turn's default is used — six,
     which is the shape of a deep turn with its repair pass. */
  const base = Number.isFinite(Number(baseCap)) && Number(baseCap) > 0 ? Math.floor(Number(baseCap)) : 6;
  const fleet = await readQuotaForFleet(providerIds, { now, env });
  const headroom = fleet.limit > 0 ? fleet.left / fleet.limit : 1;
  if (!fleet.durable) {
    /* No durable counter means no knowledge of the day. The turn keeps
       its normal cap, and the deployment is told the counter is off. */
    return { cap: base, headroom: null, durable: false, fleet };
  }
  if (headroom <= 0.10) return { cap: Math.min(base, 1), headroom, durable: true, fleet };
  if (headroom <= 0.25) return { cap: Math.min(base, Math.max(2, Math.ceil(base / 3))), headroom, durable: true, fleet };
  return { cap: base, headroom, durable: true, fleet };
}

/**
 * Whether the day's allowance is SPENT.
 *
 * This is the one case where the turn must not call a provider at all.
 *
 * The call cap lowers the turn's DEPTH as the day runs out — a turn with
 * one call left answers from one role instead of five. That is a real
 * saving, and it is also the honest one: the number of turns the day can
 * buy does not change, so the depth is what has to give.
 *
 * But at zero the arithmetic is different. A call made against an
 * exhausted allowance is not a shallow answer — it is a request that
 * will come back 429, and on this tier a failed request COUNTS. So the
 * turn must stop calling, and say so.
 *
 * The threshold is deliberately not exactly zero: a request that fails
 * for the provider's own reasons counts against the daily cap there, so
 * the last few requests are worth spending on questions that can be
 * answered from the cache or from the local corpus — which is what the
 * cache-first path is for.
 */
export async function quotaExhausted(providerIds = [], { now = Date.now(), env = process.env } = {}) {
  const fleet = await readQuotaForFleet(providerIds, { now, env });
  if (!fleet.durable) return { exhausted: false, reason: 'the day is not counted', fleet };
  const headroom = fleet.limit > 0 ? fleet.left / fleet.limit : 1;
  /* One request left is still worth spending on a cache miss — it is the
     difference between an answer and a refusal. Zero is not. */
  if (fleet.left <= 0) {
    return { exhausted: true, reason: 'the daily provider allowance is spent', fleet };
  }
  if (headroom <= 0.02 && fleet.left <= 1) {
    return { exhausted: true, reason: 'the daily provider allowance is spent', fleet };
  }
  return { exhausted: false, reason: null, fleet };
}

/**
 * How many turns the day's remaining allowance can still buy.
 *
 * The number that matters to the operator is not «how many requests
 * are left» but «how many QUESTIONS can still be answered». A deep turn
 * costs several requests, so the answer is the remainder divided by the
 * turn's cost — and the honest answer names the cost it assumed.
 */
export function turnsRemaining(fleet, callsPerTurn = 5) {
  const per = Math.max(1, Number(callsPerTurn) || 1);
  if (!fleet || fleet.left <= 0) return 0;
  return Math.floor(fleet.left / per);
}
