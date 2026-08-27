/**
 * FBT INTENT AI — PHASE 97: GRADUAL AUTONOMY (L1 → L3)
 * ---------------------------------------------------------------------------
 * A level is not a slope. Autonomy has to be earned, and — the part that
 * matters — it has to be TAKEN, not given: the system may say "you are
 * eligible for L2", never "you are now on L2".
 *
 *   · eligibility is computed from real history: confirmed intents the user
 *     actually approved, a clean rejection record, and a passed risk quiz
 *   · promotion is one level at a time; L1 → L3 in one step is refused even
 *     with a perfect record
 *   · promotion ALWAYS requires an explicit, timestamped user request; nothing
 *     in this module can raise a level on its own
 *   · demotion to L1 is instant, needs no eligibility, and no cooldown can
 *     stand in its way
 *   · a demotion or a safety incident resets the clock, so trust is rebuilt
 *     rather than assumed
 */

import { classifyFailure } from './failureModes.js';

export const AUTONOMY_SCHEMA = 'fbt.gradual-autonomy.v1';
export const AUTONOMY_LEVELS = Object.freeze([1, 2, 3]);
export const PROMOTION_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000;

/** What each step up actually costs, in evidence. */
export const PROMOTION_REQUIREMENTS = Object.freeze({
  2: Object.freeze({
    minConfirmedIntents: 5,
    minAccountAgeMs: 7 * 24 * 60 * 60 * 1000,
    maxIncidents: 0,
    riskQuizRequired: true
  }),
  3: Object.freeze({
    minConfirmedIntents: 25,
    minAccountAgeMs: 30 * 24 * 60 * 60 * 1000,
    maxIncidents: 0,
    riskQuizRequired: true
  })
});

const num = (v) => (v === null || v === undefined || v === '' || typeof v === 'boolean'
  ? null
  : (Number.isFinite(Number(v)) ? Number(v) : null));

const id = (v) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, 64) : null);

const clampLevel = (v) => {
  const n = num(v);
  return AUTONOMY_LEVELS.includes(n) ? n : 1;
};

/** Where a user stands today, and what — if anything — is unlocked next. */
export function autonomyProfile({ history = null, currentLevel = 1, now = Date.now() } = {}) {
  const level = clampLevel(currentLevel);
  const confirmed = num(history?.confirmedIntents) ?? 0;
  const incidents = num(history?.safetyIncidents) ?? 0;
  const firstSeenAt = num(history?.firstSeenAt);
  const ageMs = firstSeenAt === null ? 0 : Math.max(0, now - firstSeenAt);
  return {
    ok: true,
    schema: AUTONOMY_SCHEMA,
    userId: id(history?.userId),
    level,
    confirmedIntents: confirmed,
    safetyIncidents: incidents,
    accountAgeMs: ageMs,
    riskQuizPassed: history?.riskQuizPassed === true,
    // The next level is a possibility, never a plan the system executes.
    nextLevel: level < 3 ? level + 1 : null,
    autoPromoted: false,
    i18nKey: `intentAI.autonomy.level${level}`,
    at: now
  };
}

/** Is the user eligible for the NEXT level? Missing evidence is not a maybe. */
export function evaluatePromotion({ history = null, currentLevel = 1, lastPromotedAt = null, now = Date.now() } = {}) {
  const level = clampLevel(currentLevel);
  if (level >= 3) {
    return { ok: true, eligible: false, atMax: true, level, targetLevel: null, missing: [], i18nKey: 'intentAI.autonomy.atMax' };
  }
  const target = level + 1;
  const need = PROMOTION_REQUIREMENTS[target];
  const profile = autonomyProfile({ history, currentLevel: level, now });
  const missing = [];
  if (profile.confirmedIntents < need.minConfirmedIntents) missing.push('NOT_ENOUGH_CONFIRMED_INTENTS');
  if (profile.accountAgeMs < need.minAccountAgeMs) missing.push('ACCOUNT_TOO_NEW');
  if (profile.safetyIncidents > need.maxIncidents) missing.push('SAFETY_INCIDENT_ON_RECORD');
  if (need.riskQuizRequired && profile.riskQuizPassed !== true) missing.push('RISK_UNDERSTANDING_NOT_SHOWN');
  const since = num(lastPromotedAt);
  if (since !== null && now - since < PROMOTION_COOLDOWN_MS) missing.push('COOLDOWN_ACTIVE');
  return {
    ok: true,
    schema: AUTONOMY_SCHEMA,
    level,
    targetLevel: target,
    requirements: need,
    progress: {
      confirmedIntents: profile.confirmedIntents,
      accountAgeMs: profile.accountAgeMs,
      safetyIncidents: profile.safetyIncidents,
      riskQuizPassed: profile.riskQuizPassed
    },
    missing,
    eligible: missing.length === 0,
    // Eligible is not promoted. The user still has to ask.
    promoted: false,
    requiresExplicitRequest: true,
    i18nKey: missing.length ? 'intentAI.autonomy.notEligible' : 'intentAI.autonomy.eligible',
    i18nParams: { level: target, missing: missing.length },
    at: now
  };
}

/**
 * Move up a level. Requires eligibility AND an explicit, timestamped request
 * from the user. One level at a time, always.
 */
export function requestPromotion({
  history = null,
  currentLevel = 1,
  targetLevel = null,
  userRequest = null,
  lastPromotedAt = null,
  now = Date.now()
} = {}) {
  const level = clampLevel(currentLevel);
  const wanted = num(targetLevel);
  if (!AUTONOMY_LEVELS.includes(wanted)) {
    return { ok: false, promoted: false, level, i18nKey: 'intentAI.autonomy.promotionRefused', error: classifyFailure('MISSING_DATA', { detail: 'BAD_TARGET_LEVEL' }) };
  }
  if (wanted <= level) {
    return { ok: false, promoted: false, level, reason: 'NOT_A_PROMOTION', i18nKey: 'intentAI.autonomy.promotionRefused', error: classifyFailure('MISSING_DATA', { detail: 'NOT_A_PROMOTION' }) };
  }
  if (wanted !== level + 1) {
    // Skipping a level is how an unproven user ends up with the widest policy.
    return {
      ok: false, promoted: false, level, reason: 'NO_LEVEL_SKIPPING',
      i18nKey: 'intentAI.autonomy.noSkipping',
      error: classifyFailure('GUARDIAN_REJECTED', { detail: 'NO_LEVEL_SKIPPING' })
    };
  }
  if (userRequest?.userConfirmed !== true || num(userRequest?.at) === null) {
    // The system never promotes anybody. Ever.
    return {
      ok: false, promoted: false, level, reason: 'NO_EXPLICIT_REQUEST',
      i18nKey: 'intentAI.autonomy.needsRequest',
      error: classifyFailure('USER_AUTHORIZATION_REQUIRED', { detail: 'NO_EXPLICIT_REQUEST' })
    };
  }
  const evaluation = evaluatePromotion({ history, currentLevel: level, lastPromotedAt, now });
  if (!evaluation.eligible) {
    return {
      ok: false, promoted: false, level, missing: evaluation.missing,
      i18nKey: 'intentAI.autonomy.notEligible',
      i18nParams: { level: wanted, missing: evaluation.missing.length },
      error: classifyFailure('GUARDIAN_REJECTED', { detail: evaluation.missing[0] })
    };
  }
  return {
    ok: true,
    schema: AUTONOMY_SCHEMA,
    promoted: true,
    autoPromoted: false,
    level: wanted,
    previousLevel: level,
    promotedAt: now,
    requestedAt: num(userRequest.at),
    // Even at L3 the confirmation gate is still the last word.
    requiresConfirmationGate: true,
    reversible: true,
    i18nKey: 'intentAI.autonomy.promoted',
    i18nParams: { level: wanted }
  };
}

/** Back to L1. No conditions, no cooldown, no eligibility check. */
export function demoteToL1({ currentLevel = 3, reason = 'USER_REQUEST', now = Date.now() } = {}) {
  const level = clampLevel(currentLevel);
  return {
    ok: true,
    schema: AUTONOMY_SCHEMA,
    level: 1,
    previousLevel: level,
    demoted: true,
    reason: String(reason || 'USER_REQUEST').slice(0, 48),
    // A safety incident restarts the clock; trust is rebuilt, not restored.
    cooldownResetAt: now,
    lastPromotedAt: now,
    i18nKey: 'intentAI.autonomy.demoted',
    at: now
  };
}

/** Nothing here may raise a level without the user asking for it. */
export function assertNoAutoPromotion({ evaluation = null, promotion = null, profile = null, transitions = [] } = {}) {
  const reasons = [];
  if (evaluation) {
    if (evaluation.promoted === true) reasons.push('EVALUATION_PROMOTED');
    if (evaluation.eligible === true && evaluation.requiresExplicitRequest !== true) reasons.push('ELIGIBILITY_TREATED_AS_PROMOTION');
  }
  if (promotion) {
    if (promotion.promoted === true && promotion.autoPromoted === true) reasons.push('AUTO_PROMOTED');
    if (promotion.promoted === true && num(promotion.requestedAt) === null) reasons.push('PROMOTED_WITHOUT_REQUEST');
    if (promotion.promoted === true && promotion.previousLevel != null && promotion.level - promotion.previousLevel > 1) reasons.push('LEVEL_SKIPPED');
    if (promotion.promoted === true && promotion.reversible !== true) reasons.push('PROMOTION_IRREVERSIBLE');
    if (promotion.promoted === true && promotion.requiresConfirmationGate !== true) reasons.push('PROMOTION_SKIPS_GATE');
  }
  if (profile && profile.autoPromoted === true) reasons.push('PROFILE_AUTO_PROMOTED');
  for (const step of Array.isArray(transitions) ? transitions : []) {
    const from = num(step?.from);
    const to = num(step?.to);
    if (from === null || to === null) continue;
    if (to > from && step?.userRequested !== true) reasons.push('UNREQUESTED_LEVEL_RISE');
    if (to > from && to - from > 1) reasons.push('LEVEL_SKIPPED');
    if (to === 1 && step?.blocked === true) reasons.push('DEMOTION_BLOCKED');
  }
  const unique = [...new Set(reasons)];
  return unique.length
    ? { ok: false, reasons: unique, error: classifyFailure('GUARDIAN_REJECTED', { detail: unique[0] }) }
    : { ok: true };
}
