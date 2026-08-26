/**
 * FBT INTENT AI — Spec 65 item 59: Goal Negotiation.
 *
 * An unrealistic goal is rejected with reasons, not silently accepted and not
 * silently rewritten. The user always gets three bounded options:
 * KEEP_TARGET / REDUCE_RISK / EXTEND_DURATION. Accepting a target never grants
 * execution permission; Guardian, Risk and the authorization screen are
 * untouched by this module.
 */

import { assessTarget, TARGET_REALITY_SCHEMA } from './targetReality.js';
import { containsRawSecret, fail, noExecutionPermission, safeString } from './phaseBoundary.js';

export const GOAL_NEGOTIATION_SCHEMA = 'fbt.intent-goal-negotiation.v1';

export const GOAL_NEGOTIATION_OPTIONS = Object.freeze(['KEEP_TARGET', 'REDUCE_RISK', 'EXTEND_DURATION']);
export const GOAL_REJECT_LEVELS = Object.freeze(['extreme', 'very-high-risk']);

const REJECT_REASONS = Object.freeze({
  extreme: 'This target requires unusually large market movement within a very short horizon and carries a material loss/liquidation risk.',
  'very-high-risk': 'This target is very high for the stated horizon; a loss scenario must be shown next to every projection.'
});

const OPTION_MEANING = Object.freeze({
  KEEP_TARGET: 'Keep the stated target. The plan continues only with explicit acknowledgment of the assessed risk level.',
  REDUCE_RISK: 'Reduce the risk budget (lower leverage, tighter limits, safer routes) for the same horizon.',
  EXTEND_DURATION: 'Extend the time horizon so the target no longer requires extreme movement.'
});

/**
 * Negotiate a user goal against the target reality check. A goal whose
 * realism level is `extreme` or `very-high-risk` is REJECTED with the
 * deterministic reason plus the three options. Acceptance is a user choice,
 * never an execution permission.
 */
export function negotiateGoal(input = {}, { now = Date.now() } = {}) {
  if (!input || typeof input !== 'object' || containsRawSecret(input)) return fail('RAW_CREDENTIAL_FORBIDDEN');
  const assessment = assessTarget(input);
  if (!assessment.ok) return fail(assessment.code || 'ASSESSMENT_FAILED', assessment.detail || null, { schema: GOAL_NEGOTIATION_SCHEMA });
  const level = assessment.realism?.level || 'unknown';
  const rejected = GOAL_REJECT_LEVELS.includes(level);
  const recommendations = Array.isArray(assessment.recommendations) ? assessment.recommendations : [];
  const options = (rejected
    ? GOAL_NEGOTIATION_OPTIONS.filter((option) => recommendations.includes(option) || option === 'KEEP_TARGET')
    : recommendations.slice(0, 3)
  ).map((option) => ({
    choice: option,
    meaning: OPTION_MEANING[option] || 'User choice with unchanged safety boundaries.',
    grantsExecution: false
  }));
  return noExecutionPermission({
    ok: true,
    schema: GOAL_NEGOTIATION_SCHEMA,
    decision: rejected ? 'NEGOTIATE' : 'ACKNOWLEDGE',
    targetRejected: rejected,
    realismLevel: level,
    reasons: rejected ? [REJECT_REASONS[level]] : [],
    assessment: {
      schema: TARGET_REALITY_SCHEMA,
      capital: assessment.capital,
      targetPct: assessment.targetPct,
      durationHrs: assessment.durationHrs,
      realism: assessment.realism,
      potentialLossPct: assessment.potentialLossPct,
      disclaimers: assessment.disclaimers
    },
    options: options.length ? options : GOAL_NEGOTIATION_OPTIONS.map((choice) => ({ choice, meaning: OPTION_MEANING[choice], grantsExecution: false })),
    guaranteed: false,
    automaticExecution: false,
    userChoiceRequired: true,
    evaluatedAt: now
  });
}

/**
 * Apply the user's negotiation choice. The choice is recorded for planning;
 * it never authorizes execution and never relaxes Guardian/Risk/policy.
 */
export function applyGoalChoice(negotiation, choice, { note = null } = {}) {
  if (!negotiation || negotiation.schema !== GOAL_NEGOTIATION_SCHEMA) return fail('BAD_NEGOTIATION');
  const value = safeString(String(choice || '').toUpperCase(), 32);
  if (!GOAL_NEGOTIATION_OPTIONS.includes(value)) return fail('UNKNOWN_GOAL_CHOICE', value);
  const known = (negotiation.options || []).some((option) => option.choice === value);
  return noExecutionPermission({
    ok: true,
    schema: GOAL_NEGOTIATION_SCHEMA,
    decision: 'CHOICE_RECORDED',
    choice: value,
    acknowledgedRiskLevel: negotiation.realismLevel || null,
    note: note === null ? null : safeString(note, 240),
    executionAuthorized: false,
    financialExecutionAuthorized: false,
    guardianPrecheckStillRequired: true,
    userChoiceRecorded: true
  });
}

/**
 * A negotiation result is arithmetic and policy labeling only. This helper is
 * used by probes/UI to prove acceptance changed nothing about execution.
 */
export function negotiationGrantsExecution(negotiation) {
  return negotiation?.executionAuthorized === true || negotiation?.financialExecutionAuthorized === true;
}
