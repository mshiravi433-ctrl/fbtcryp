/**
 * FBT FINANCIAL OS — Financial Profile + Goal OS (Upgrade 10 §7, §9).
 * ---------------------------------------------------------------------------
 * Two long-lived user-owned objects and the rules that keep them honest:
 *
 *   FinancialProfile — risk, horizon, liquidity preference, tolerances.
 *   Goal             — a permanent entity with target, horizon, progress.
 *
 * THE RULE THAT MAKES THIS SAFE (§24, §9)
 * The AI may INFER a profile field, but an inference is stored with
 * `confidence: 'MEDIUM'` and `origin: 'inferred'`, and `assertedFacts()` only
 * returns fields the USER stated. A recommendation engine that reads this can
 * tell the difference between "you told me you are conservative" and "you
 * behaved conservatively twice", and only the first may be quoted as fact.
 *
 * Everything here is pure and serialisable: the same object is validated on the
 * server before persistence and rendered in the browser without a second model.
 */
import { CI_SCHEMA, round, usableNumber } from './schema.js';

export const PROFILE_SCHEMA = 'fbt.financial-profile.v1';
export const GOAL_SCHEMA = 'fbt.financial-goal-os.v1';

export const RISK_PROFILES = Object.freeze(['CONSERVATIVE', 'MODERATE', 'GROWTH', 'AGGRESSIVE']);
export const HORIZONS = Object.freeze(['SHORT', 'MEDIUM', 'LONG']);
export const LIQUIDITY_PREFERENCES = Object.freeze(['HIGH', 'NORMAL', 'LOW']);
export const ORIGINS = Object.freeze(['stated', 'inferred', 'default']);
export const CONFIDENCE = Object.freeze(['HIGH', 'MEDIUM', 'LOW']);

const field = (value, origin = 'default', confidence = origin === 'stated' ? 'HIGH' : origin === 'inferred' ? 'MEDIUM' : 'LOW', at = Date.now()) => ({
  value, origin, confidence, at
});

export function emptyProfile(now = Date.now()) {
  return {
    schema: PROFILE_SCHEMA,
    brain: CI_SCHEMA,
    riskProfile: field(null, 'default', 'LOW', now),
    objectives: field([], 'default', 'LOW', now),
    investmentHorizon: field(null, 'default', 'LOW', now),
    liquidityPreference: field(null, 'default', 'LOW', now),
    assetPreferences: field([], 'default', 'LOW', now),
    strategyPreferences: field([], 'default', 'LOW', now),
    tradingFrequency: field(null, 'default', 'LOW', now),
    lossTolerancePct: field(null, 'default', 'LOW', now),
    concentrationTolerancePct: field(null, 'default', 'LOW', now),
    createdAt: now,
    updatedAt: now,
    version: 1
  };
}

const ENUMS = {
  riskProfile: RISK_PROFILES,
  investmentHorizon: HORIZONS,
  liquidityPreference: LIQUIDITY_PREFERENCES
};
const LISTS = new Set(['objectives', 'assetPreferences', 'strategyPreferences']);
const NUMERIC = { lossTolerancePct: [0, 100], concentrationTolerancePct: [0, 100] };

/**
 * Apply a patch. Rejects unknown fields and out-of-range values rather than
 * coercing them, and refuses to let an INFERRED write overwrite a STATED one —
 * §24's "inference must not become fact without the user".
 */
export function updateProfile(profile, patch = {}, { origin = 'stated', now = Date.now() } = {}) {
  if (!ORIGINS.includes(origin)) return { ok: false, code: 'BAD_ORIGIN', detail: `origin must be one of ${ORIGINS.join(', ')}` };
  const base = profile && profile.schema === PROFILE_SCHEMA ? { ...profile } : emptyProfile(now);
  const applied = [];
  const rejected = [];
  for (const [key, raw] of Object.entries(patch)) {
    if (!(key in base) || ['schema', 'brain', 'createdAt', 'updatedAt', 'version'].includes(key)) {
      rejected.push({ key, code: 'UNKNOWN_FIELD' });
      continue;
    }
    const current = base[key];
    if (origin === 'inferred' && current?.origin === 'stated') {
      rejected.push({ key, code: 'WOULD_OVERWRITE_STATED', detail: 'the user stated this; an inference may not silently replace it' });
      continue;
    }
    if (ENUMS[key]) {
      const v = String(raw || '').toUpperCase();
      if (!ENUMS[key].includes(v)) { rejected.push({ key, code: 'BAD_VALUE', allowed: ENUMS[key] }); continue; }
      base[key] = field(v, origin, undefined, now);
      applied.push(key);
      continue;
    }
    if (LISTS.has(key)) {
      if (!Array.isArray(raw)) { rejected.push({ key, code: 'BAD_VALUE', detail: 'expected an array' }); continue; }
      base[key] = field(raw.map((x) => String(x).slice(0, 40)).slice(0, 12), origin, undefined, now);
      applied.push(key);
      continue;
    }
    if (NUMERIC[key]) {
      const n = usableNumber(raw);
      const [lo, hi] = NUMERIC[key];
      if (n === null || n < lo || n > hi) { rejected.push({ key, code: 'BAD_VALUE', range: [lo, hi] }); continue; }
      base[key] = field(round(n, 2), origin, undefined, now);
      applied.push(key);
      continue;
    }
    base[key] = field(typeof raw === 'string' ? raw.slice(0, 60) : raw, origin, undefined, now);
    applied.push(key);
  }
  base.updatedAt = now;
  return { ok: applied.length > 0 || rejected.length === 0, profile: base, applied, rejected };
}

/** Reset one field or the whole profile — §9 requires both to be possible. */
export function resetProfile(profile, keys = null, now = Date.now()) {
  if (!keys) return emptyProfile(now);
  const fresh = emptyProfile(now);
  const out = { ...profile };
  for (const key of keys) if (key in fresh) out[key] = fresh[key];
  out.updatedAt = now;
  return out;
}

/** Only what the USER said. This is the set a reply may state as fact. */
export function assertedFacts(profile) {
  const out = {};
  for (const [key, v] of Object.entries(profile || {})) {
    if (v && typeof v === 'object' && v.origin === 'stated' && v.value !== null && !(Array.isArray(v.value) && !v.value.length)) out[key] = v.value;
  }
  return out;
}

/** What the profile still does not know, ordered by how much a decision needs it. */
export function profileGaps(profile) {
  const order = ['riskProfile', 'investmentHorizon', 'liquidityPreference', 'lossTolerancePct', 'objectives'];
  return order.filter((key) => {
    const v = profile?.[key];
    return !v || v.value === null || (Array.isArray(v.value) && !v.value.length);
  });
}

/* ── Goal OS (§7) ──────────────────────────────────────────────────────── */

export const GOAL_TYPES = Object.freeze(['GROW_CAPITAL', 'PRESERVE_CAPITAL', 'INCOME', 'LIQUIDITY', 'DEBT_REDUCTION', 'CUSTOM']);
export const GOAL_STATUSES = Object.freeze(['DRAFT', 'ACTIVE', 'PAUSED', 'ACHIEVED', 'MISSED', 'ARCHIVED']);

export function createGoal(input = {}, { now = Date.now(), idFactory = null } = {}) {
  const name = String(input.name || '').trim().slice(0, 80);
  if (!name) return { ok: false, code: 'BAD_NAME', detail: 'a goal needs a name a person would recognise' };
  const type = GOAL_TYPES.includes(String(input.type || '').toUpperCase()) ? String(input.type).toUpperCase() : 'CUSTOM';
  const target = usableNumber(input.targetUsd ?? input.target);
  const current = usableNumber(input.currentValueUsd ?? input.currentValue);
  const horizonMonths = usableNumber(input.horizonMonths);
  if (horizonMonths !== null && (horizonMonths < 1 || horizonMonths > 600)) return { ok: false, code: 'BAD_HORIZON', detail: 'horizon must be between 1 and 600 months' };
  if (target !== null && target <= 0) return { ok: false, code: 'BAD_TARGET' };
  const risk = RISK_PROFILES.includes(String(input.risk || '').toUpperCase()) ? String(input.risk).toUpperCase() : null;
  return {
    ok: true,
    goal: {
      schema: GOAL_SCHEMA,
      goalId: String(input.goalId || idFactory?.() || `goal_${now.toString(36)}_${Math.random().toString(36).slice(2, 8)}`),
      name,
      type,
      targetUsd: target === null ? null : round(target, 2),
      currentValueUsd: current === null ? null : round(current, 2),
      horizonMonths,
      risk,
      liquidityNeedUsd: usableNumber(input.liquidityNeedUsd),
      constraints: Array.isArray(input.constraints) ? input.constraints.map((c) => String(c).slice(0, 80)).slice(0, 8) : [],
      priority: Math.min(5, Math.max(1, Math.round(usableNumber(input.priority) ?? 3))),
      status: GOAL_STATUSES.includes(String(input.status || '').toUpperCase()) ? String(input.status).toUpperCase() : 'ACTIVE',
      progressPct: null,
      createdAt: now,
      updatedAt: now
    }
  };
}

/** Progress is computed from the CURRENT financial state, never stored stale. */
export function goalProgress(goal, financialState, { now = Date.now() } = {}) {
  if (!goal) return { status: 'UNAVAILABLE', reason: 'NO_GOAL' };
  const target = usableNumber(goal.targetUsd);
  const current = usableNumber(goal.currentValueUsd ?? financialState?.netWorthUsd ?? financialState?.availableCapitalUsd);
  if (target === null || current === null) {
    return { status: 'UNAVAILABLE', reason: 'GOAL_INPUTS_INCOMPLETE', needed: [target === null ? 'targetUsd' : null, current === null ? 'a readable portfolio value' : null].filter(Boolean) };
  }
  const progressPct = round(Math.max(0, Math.min(200, (current / target) * 100)), 2);
  const monthsElapsed = goal.createdAt ? Math.max(0, (now - goal.createdAt) / (30 * 86_400_000)) : 0;
  const expectedPct = goal.horizonMonths ? round(Math.min(100, (monthsElapsed / goal.horizonMonths) * 100), 2) : null;
  const deviationPct = expectedPct === null ? null : round(progressPct - expectedPct, 2);
  const track = deviationPct === null ? 'UNKNOWN' : deviationPct >= 5 ? 'AHEAD' : deviationPct >= -10 ? 'ON_TRACK' : deviationPct >= -25 ? 'BEHIND' : 'AT_RISK';
  return {
    status: 'OK', goalId: goal.goalId, progressPct, expectedPct, deviationPct, track,
    currentUsd: round(current, 2), targetUsd: round(target, 2), monthsElapsed: round(monthsElapsed, 1),
    monthsRemaining: goal.horizonMonths === null || goal.horizonMonths === undefined ? null : round(Math.max(0, goal.horizonMonths - monthsElapsed), 1),
    inputs: ['goal record', 'financial state']
  };
}

/**
 * §7's hard part: goals that fight each other. Detected structurally, not by
 * vibe — a preservation goal and a growth goal over the same capital in the
 * same window is a real conflict the user has to resolve, and hiding it is how
 * an AI ends up recommending both.
 */
export function detectGoalConflicts(goals = [], financialState = null) {
  const active = goals.filter((g) => g && (g.status === 'ACTIVE' || g.status === 'DRAFT'));
  const conflicts = [];
  for (let i = 0; i < active.length; i += 1) {
    for (let j = i + 1; j < active.length; j += 1) {
      const a = active[i];
      const b = active[j];
      const overlapping = a.horizonMonths && b.horizonMonths
        ? Math.min(a.horizonMonths, b.horizonMonths) > 0 : true;
      if (!overlapping) continue;
      const pair = [a.type, b.type].sort().join('|');
      if (pair === 'GROW_CAPITAL|PRESERVE_CAPITAL') {
        conflicts.push({
          code: 'RISK_DIRECTION_CONFLICT', goals: [a.goalId, b.goalId], severity: 'HIGH',
          detail: `«${a.name}» and «${b.name}» pull the same capital in opposite risk directions over overlapping horizons`,
          resolution: 'split the capital explicitly per goal, or set a priority so one goal governs allocation'
        });
      }
      if (pair === 'INCOME|GROW_CAPITAL' && Math.abs((a.priority || 3) - (b.priority || 3)) < 1) {
        conflicts.push({
          code: 'PRIORITY_AMBIGUOUS', goals: [a.goalId, b.goalId], severity: 'MEDIUM',
          detail: 'an income goal and a growth goal share the same priority, so no allocation rule can be derived',
          resolution: 'give one of them a higher priority'
        });
      }
    }
  }
  const capital = usableNumber(financialState?.availableCapitalUsd ?? financialState?.netWorthUsd);
  const demanded = active.reduce((a, g) => a + (usableNumber(g.liquidityNeedUsd) ?? 0), 0);
  if (capital !== null && demanded > capital) {
    conflicts.push({
      code: 'CAPITAL_OVERSUBSCRIBED', goals: active.map((g) => g.goalId), severity: 'HIGH',
      detail: `goals reserve ${round(demanded, 2)} USD of liquidity but only ${round(capital, 2)} USD is available`,
      resolution: 'reduce a liquidity requirement or extend a horizon'
    });
  }
  return { schema: GOAL_SCHEMA, status: 'OK', count: conflicts.length, conflicts, evaluated: active.length };
}
