/**
 * FBT INTENT AI — PHASE 72: AGENT DISPUTE RESOLUTION
 * ---------------------------------------------------------------------------
 * A score is not a verdict. `agentScore.js` reports what was observed; when an
 * agent believes an observation is wrong, there must be somewhere to say so.
 *
 *   · an agent may appeal a score within a window, with evidence
 *   · a FINAL score is only ever set from evidence — an appeal decided on
 *     nothing stays provisional, it does not silently become final
 *   · slashing is transparent: every penalty names the appealable case that
 *     caused it, its size and its expiry. An un-appealable slash is invalid.
 *   · a pending appeal freezes the disputed penalty; it does not delete it
 */

import { classifyFailure } from './failureModes.js';
import { MIN_OBSERVED_SAMPLE_SIZE } from './agentScore.js';

export const DISPUTE_SCHEMA = 'fbt.agent-dispute.v1';
export const APPEAL_WINDOW_MS = 14 * 24 * 60 * 60 * 1000;
export const APPEAL_STATES = Object.freeze(['open', 'upheld', 'rejected', 'withdrawn', 'expired']);
export const SLASH_REASONS = Object.freeze(['undelivered', 'escape-attempt', 'false-claim', 'repeated-failure']);
export const MAX_SLASH_FRACTION = 0.5;
export const SLASH_TTL_MS = 180 * 24 * 60 * 60 * 1000;

const num = (v) => (v === null || v === undefined || v === '' || typeof v === 'boolean'
  ? null
  : (Number.isFinite(Number(v)) ? Number(v) : null));

/** A score is provisional until it survives its appeal window. */
export function provisionalScore({ agentId = null, score = null, sampleSize = 0, now = Date.now() } = {}) {
  const value = num(score);
  const n = num(sampleSize) ?? 0;
  if (!agentId || value === null) {
    return { ok: false, final: false, error: classifyFailure('MISSING_DATA', { detail: 'NO_SCORE' }) };
  }
  const enough = n >= MIN_OBSERVED_SAMPLE_SIZE;
  return {
    ok: true,
    schema: DISPUTE_SCHEMA,
    agentId,
    score: enough ? value : null,
    sampleSize: n,
    // Not enough observations is "unknown", not "average".
    displayable: enough,
    final: false,
    appealableUntil: now + APPEAL_WINDOW_MS,
    i18nKey: enough ? 'intentAI.dispute.provisional' : 'intentAI.dispute.insufficientEvidence'
  };
}

/** File an appeal. Evidence is required to file; a bare denial is not enough. */
export function fileAppeal({ agentId = null, caseId = null, score = null, evidence = [], filedBy = null, now = Date.now() } = {}) {
  const items = Array.isArray(evidence) ? evidence.filter((e) => e && typeof e === 'object' && typeof e.kind === 'string') : [];
  const reasons = [];
  if (!agentId || !caseId) reasons.push('MISSING_CASE');
  if (filedBy !== agentId) reasons.push('NOT_THE_AGENT');
  if (!items.length) reasons.push('NO_EVIDENCE');
  if (score?.appealableUntil !== undefined && now > num(score.appealableUntil)) reasons.push('APPEAL_WINDOW_CLOSED');
  if (reasons.length) {
    return {
      ok: false, appeal: null, reasons,
      i18nKey: 'intentAI.dispute.appealRefused',
      error: classifyFailure(reasons[0] === 'APPEAL_WINDOW_CLOSED' ? 'DEADLINE_PASSED' : 'MISSING_DATA', { detail: reasons[0] })
    };
  }
  return {
    ok: true,
    appeal: {
      schema: DISPUTE_SCHEMA,
      caseId,
      agentId,
      state: 'open',
      evidence: items.slice(0, 16),
      filedAt: now,
      decideBy: now + APPEAL_WINDOW_MS
    },
    // Filing freezes the penalty; it does not erase it.
    penaltyFrozen: true,
    i18nKey: 'intentAI.dispute.appealFiled'
  };
}

/** Decide it. Without evidence on the record, nothing becomes final. */
export function decideAppeal(appeal, { upheld = null, reviewerId = null, evidenceReviewed = [], now = Date.now() } = {}) {
  if (appeal?.state !== 'open') {
    return { ok: false, appeal, reason: 'NOT_OPEN', error: classifyFailure('MISSING_DATA', { detail: 'APPEAL_NOT_OPEN' }) };
  }
  if (now > num(appeal.decideBy)) {
    return {
      ok: true, appeal: { ...appeal, state: 'expired', resolvedAt: now },
      final: false, i18nKey: 'intentAI.dispute.appealExpired',
      // An expired appeal does not hand the case to either side.
      scoreFinal: false
    };
  }
  const reviewed = Array.isArray(evidenceReviewed) ? evidenceReviewed : [];
  if (!reviewerId || !reviewed.length) {
    return {
      ok: false, appeal, reason: 'DECISION_WITHOUT_EVIDENCE', scoreFinal: false,
      i18nKey: 'intentAI.dispute.needsEvidence',
      error: classifyFailure('MISSING_DATA', { detail: 'DECISION_WITHOUT_EVIDENCE' })
    };
  }
  const state = upheld === true ? 'upheld' : 'rejected';
  return {
    ok: true,
    appeal: { ...appeal, state, reviewerId, evidenceReviewed: reviewed.slice(0, 16), resolvedAt: now },
    scoreFinal: true,
    penaltyFrozen: false,
    penaltyReversed: state === 'upheld',
    i18nKey: state === 'upheld' ? 'intentAI.dispute.appealUpheld' : 'intentAI.dispute.appealRejected'
  };
}

/** Finalise a score. Only an evidenced decision, or an unappealed window. */
export function finalizeScore(score, { appealDecision = null, now = Date.now() } = {}) {
  if (!score?.ok) return { ok: false, final: false, error: classifyFailure('MISSING_DATA', { detail: 'NO_SCORE' }) };
  if (appealDecision) {
    if (appealDecision.scoreFinal !== true) {
      return { ok: false, final: false, score, reason: 'APPEAL_UNRESOLVED', i18nKey: 'intentAI.dispute.provisional' };
    }
    return {
      ok: true, final: true,
      score: { ...score, final: true, score: appealDecision.penaltyReversed ? null : score.score, revisedByAppeal: appealDecision.penaltyReversed === true },
      i18nKey: 'intentAI.dispute.final'
    };
  }
  if (now <= num(score.appealableUntil)) {
    return { ok: false, final: false, score, reason: 'APPEAL_WINDOW_OPEN', i18nKey: 'intentAI.dispute.provisional' };
  }
  return { ok: true, final: true, score: { ...score, final: true }, i18nKey: 'intentAI.dispute.final' };
}

/** A penalty nobody can contest is not a penalty, it is a punishment. */
export function applySlash({ agentId = null, reason = null, stakeUsd = null, fraction = 0.1, caseId = null, now = Date.now() } = {}) {
  const stake = num(stakeUsd);
  const frac = Math.min(MAX_SLASH_FRACTION, Math.max(0, num(fraction) ?? 0));
  const reasons = [];
  if (!agentId) reasons.push('NO_AGENT');
  if (!SLASH_REASONS.includes(reason)) reasons.push('UNKNOWN_REASON');
  if (!caseId) reasons.push('NO_CASE_REFERENCE');
  if (stake === null || stake <= 0) reasons.push('NO_STAKE');
  if (reasons.length) {
    return { ok: false, slash: null, reasons, i18nKey: 'intentAI.dispute.slashRefused', error: classifyFailure('MISSING_DATA', { detail: reasons[0] }) };
  }
  const amount = Math.round(stake * frac * 100) / 100;
  return {
    ok: true,
    slash: Object.freeze({
      schema: DISPUTE_SCHEMA,
      agentId,
      caseId,
      reason,
      amountUsd: amount,
      fraction: frac,
      // Every slash is public, contestable, and it ends.
      transparent: true,
      appealable: true,
      appealableUntil: now + APPEAL_WINDOW_MS,
      expiresAt: now + SLASH_TTL_MS,
      at: now
    }),
    i18nKey: 'intentAI.dispute.slashed',
    i18nParams: { amount, reason }
  };
}

/** The guard on everything above. */
export function assertDueProcess({ slash = null, score = null } = {}) {
  const reasons = [];
  if (slash) {
    if (slash.appealable !== true) reasons.push('SLASH_NOT_APPEALABLE');
    if (!slash.caseId) reasons.push('SLASH_WITHOUT_CASE');
    if (slash.transparent !== true) reasons.push('SLASH_NOT_TRANSPARENT');
    if ((num(slash.fraction) ?? 0) > MAX_SLASH_FRACTION) reasons.push('SLASH_ABOVE_CAP');
    if (num(slash.expiresAt) === null) reasons.push('SLASH_NEVER_EXPIRES');
  }
  if (score) {
    if (score.final === true && score.appealableUntil === undefined) reasons.push('FINAL_WITHOUT_APPEAL_PATH');
    if (score.displayable === true && (num(score.sampleSize) ?? 0) < MIN_OBSERVED_SAMPLE_SIZE) reasons.push('SCORE_UNDER_SAMPLED');
  }
  const unique = [...new Set(reasons)];
  return unique.length
    ? { ok: false, reasons: unique, error: classifyFailure('GUARDIAN_REJECTED', { detail: unique[0] }) }
    : { ok: true };
}
