/**
 * FBT INTENT AI — PHASE 79: PRODUCT-LEVEL BUG BOUNTY AND DISCLOSURE POLICY
 * ---------------------------------------------------------------------------
 * Phase 35 gave us a public disclosure surface. Phase 79 puts a policy on it:
 * a researcher can report a product-level flaw, gets a defined response window
 * and a reward — while the policy states plainly that a reward is a thank-you,
 * NOT an admission of liability or a promise to compensate losses.
 *
 *   · safe harbour is explicit: good-faith research within scope is not
 *     treated as an attack
 *   · rewards are banded by severity and capped; the cap is published
 *   · every published policy carries `financialLiabilityAccepted: false` and
 *     `compensatesLosses: false` — a builder cannot accidentally ship a policy
 *     that promises to cover user losses
 *   · coordinated disclosure: a fix window, then publication either way, so a
 *     report is never buried
 */

import { classifyFailure } from './failureModes.js';

export const BOUNTY_SCHEMA = 'fbt.bug-bounty.v1';

export const SEVERITY_BANDS = Object.freeze(['low', 'medium', 'high', 'critical']);

export const REWARD_BANDS = Object.freeze({
  low: { min: 50, max: 250 },
  medium: { min: 250, max: 1500 },
  high: { min: 1500, max: 7500 },
  critical: { min: 7500, max: 25000 }
});

export const REWARD_CAP_USD = 25000;

export const RESPONSE_WINDOW_MS = Object.freeze({
  acknowledge: 3 * 24 * 60 * 60 * 1000,
  triage: 7 * 24 * 60 * 60 * 1000,
  fix: 90 * 24 * 60 * 60 * 1000
});

export const IN_SCOPE = Object.freeze([
  'intent-execution', 'confirmation-gate', 'session-keys', 'receipts',
  'audit-log', 'agent-protocol', 'wallet-integration', 'client-storage'
]);

export const OUT_OF_SCOPE = Object.freeze([
  'social-engineering', 'physical-access', 'denial-of-service',
  'third-party-venue-outage', 'market-loss', 'self-inflicted-key-loss'
]);

export const REPORT_STATES = Object.freeze(['received', 'triaged', 'accepted', 'rejected', 'fixed', 'disclosed']);

const num = (v) => (v === null || v === undefined || v === '' || typeof v === 'boolean'
  ? null
  : (Number.isFinite(Number(v)) ? Number(v) : null));

/** The policy document, machine-readable so the UI and the tests agree. */
export function buildBountyPolicy({ contact = null, version = '1.0.0', now = Date.now() } = {}) {
  const contactOk = typeof contact === 'string' && contact.trim().length >= 3;
  return {
    ok: contactOk,
    schema: BOUNTY_SCHEMA,
    version: String(version),
    contact: contactOk ? contact.trim().slice(0, 128) : null,
    inScope: IN_SCOPE,
    outOfScope: OUT_OF_SCOPE,
    rewardBands: REWARD_BANDS,
    rewardCapUsd: REWARD_CAP_USD,
    responseWindowMs: RESPONSE_WINDOW_MS,
    safeHarbour: true,
    coordinatedDisclosure: true,
    // The two lines that must never flip.
    financialLiabilityAccepted: false,
    compensatesLosses: false,
    rewardIsDiscretionary: true,
    i18nKey: contactOk ? 'intentAI.bounty.policy' : 'intentAI.bounty.policyIncomplete',
    publishedAt: now,
    error: contactOk ? null : classifyFailure('MISSING_DATA', { detail: 'NO_SECURITY_CONTACT' })
  };
}

/** Intake. A report is accepted or refused for a stated reason, never ignored. */
export function submitReport({
  id = null, area = null, severity = null, summary = null, reproSteps = null,
  researcher = null, goodFaith = false, now = Date.now()
} = {}) {
  const reasons = [];
  const reportId = typeof id === 'string' && id.trim() ? id.trim().slice(0, 64) : `bb_${now.toString(36)}`;
  if (!IN_SCOPE.includes(area)) reasons.push(OUT_OF_SCOPE.includes(area) ? 'OUT_OF_SCOPE' : 'UNKNOWN_AREA');
  if (!SEVERITY_BANDS.includes(severity)) reasons.push('SEVERITY_MISSING');
  if (typeof summary !== 'string' || summary.trim().length < 10) reasons.push('SUMMARY_TOO_SHORT');
  if (!Array.isArray(reproSteps) || reproSteps.length === 0) reasons.push('NO_REPRODUCTION');
  if (reasons.length) {
    return {
      ok: false, schema: BOUNTY_SCHEMA, id: reportId, state: 'rejected', reasons,
      // Even a rejected report gets safe harbour if it was made in good faith.
      safeHarbour: goodFaith === true,
      i18nKey: 'intentAI.bounty.rejected', i18nParams: { reason: reasons[0] },
      error: classifyFailure('MISSING_DATA', { detail: reasons[0] })
    };
  }
  return {
    ok: true,
    schema: BOUNTY_SCHEMA,
    id: reportId,
    state: 'received',
    area,
    severity,
    summary: summary.trim().slice(0, 512),
    stepCount: reproSteps.length,
    researcher: typeof researcher === 'string' ? researcher.slice(0, 64) : null,
    safeHarbour: goodFaith === true,
    receivedAt: now,
    acknowledgeBy: now + RESPONSE_WINDOW_MS.acknowledge,
    triageBy: now + RESPONSE_WINDOW_MS.triage,
    fixBy: now + RESPONSE_WINDOW_MS.fix,
    i18nKey: 'intentAI.bounty.received',
    i18nParams: { id: reportId }
  };
}

/** Reward: banded, capped, discretionary, and never a liability admission. */
export function assessReward({ report = null, severity = null, quality = 1, now = Date.now() } = {}) {
  const sev = SEVERITY_BANDS.includes(severity) ? severity : (SEVERITY_BANDS.includes(report?.severity) ? report.severity : null);
  if (!report?.ok || !sev) {
    return { ok: false, amountUsd: 0, i18nKey: 'intentAI.bounty.noReward', financialLiabilityAccepted: false, error: classifyFailure('MISSING_DATA', { detail: 'NO_ELIGIBLE_REPORT' }) };
  }
  const band = REWARD_BANDS[sev];
  const q = Math.min(1, Math.max(0, num(quality) ?? 1));
  const raw = Math.round(band.min + (band.max - band.min) * q);
  const amount = Math.min(REWARD_CAP_USD, raw);
  return {
    ok: true,
    schema: BOUNTY_SCHEMA,
    reportId: report.id,
    severity: sev,
    band,
    amountUsd: amount,
    capped: raw > REWARD_CAP_USD,
    discretionary: true,
    // Paying a bounty is gratitude, not settlement.
    financialLiabilityAccepted: false,
    compensatesLosses: false,
    i18nKey: 'intentAI.bounty.reward',
    i18nParams: { amount, severity: sev },
    assessedAt: now
  };
}

/** Coordinated disclosure: fixed or not, it becomes public when the window ends. */
export function disclosureDecision({ report = null, fixed = false, now = Date.now() } = {}) {
  if (!report?.ok) return { ok: false, publish: false, i18nKey: 'intentAI.bounty.noReport', error: classifyFailure('MISSING_DATA', { detail: 'NO_REPORT' }) };
  const windowOver = now >= num(report.fixBy);
  if (fixed) {
    return { ok: true, publish: true, state: 'disclosed', reason: 'FIXED', withholdDetails: false, i18nKey: 'intentAI.bounty.disclosedFixed', decidedAt: now };
  }
  if (windowOver) {
    // Unfixed and out of time: publish anyway, minus the exploit details.
    return { ok: true, publish: true, state: 'disclosed', reason: 'WINDOW_ELAPSED', withholdDetails: true, i18nKey: 'intentAI.bounty.disclosedUnfixed', decidedAt: now };
  }
  return { ok: true, publish: false, state: 'accepted', reason: 'FIX_IN_PROGRESS', withholdDetails: true, i18nKey: 'intentAI.bounty.embargoed', publishAt: report.fixBy, decidedAt: now };
}

/** The guard: a policy that promises compensation must never ship. */
export function assertNoLiabilityPromise(doc) {
  const reasons = [];
  if (!doc || typeof doc !== 'object') reasons.push('NOT_A_POLICY');
  if (doc?.financialLiabilityAccepted === true) reasons.push('ACCEPTS_FINANCIAL_LIABILITY');
  if (doc?.compensatesLosses === true) reasons.push('PROMISES_LOSS_COMPENSATION');
  if (doc?.guaranteedPayout === true) reasons.push('GUARANTEES_PAYOUT');
  if (num(doc?.rewardCapUsd) !== null && num(doc.rewardCapUsd) > REWARD_CAP_USD) reasons.push('REWARD_ABOVE_CAP');
  if (num(doc?.amountUsd) !== null && num(doc.amountUsd) > REWARD_CAP_USD) reasons.push('REWARD_ABOVE_CAP');
  const unique = [...new Set(reasons)];
  return unique.length
    ? { ok: false, mayPublish: false, reasons: unique, error: classifyFailure('MISSING_DATA', { detail: unique[0] }) }
    : { ok: true, mayPublish: true };
}
