/**
 * FBT INTENT AI — PHASE 89: CHAOS TESTING FOR THE INTENT PLANE
 * ---------------------------------------------------------------------------
 * Phase 39 rehearsed the platform. Phase 89 breaks the intent plane on purpose
 * and demands one specific behaviour from every fault: honest-unavailable.
 *
 * For each injected fault the plane must:
 *   1. not crash (no exception escapes),
 *   2. not fabricate (no COMPLETED receipt, no invented price, no authorized
 *      execution), and
 *   3. say something true and translatable about what is missing.
 *
 * Anything else is a failed drill, and a failed drill is reported as a failure
 * rather than averaged away into a score.
 */

import { classifyFailure } from './failureModes.js';

export const CHAOS_SCHEMA = 'fbt.intent-chaos.v1';

export const FAULTS = Object.freeze([
  'rpc-down', 'price-feed-dead', 'wallet-disconnected', 'quote-timeout',
  'simulation-unavailable', 'broadcast-rejected', 'receipt-missing',
  'session-key-revoked', 'storage-corrupt', 'clock-skew'
]);

export const REQUIRED_BEHAVIOUR = Object.freeze({
  noCrash: true, noFabrication: true, honestMessage: true, executionAuthorized: false
});

const FORBIDDEN_STATUSES = Object.freeze(['COMPLETED', 'CONFIRMED', 'SUCCESS', 'confirmed']);

/** Run one fault against a handler and judge the outcome strictly. */
export async function injectFault({ fault = null, handler = null, now = Date.now() } = {}) {
  if (!FAULTS.includes(fault)) {
    return { ok: false, fault, passed: false, reason: 'UNKNOWN_FAULT', error: classifyFailure('MISSING_DATA', { detail: 'UNKNOWN_FAULT' }) };
  }
  if (typeof handler !== 'function') {
    return { ok: false, fault, passed: false, reason: 'NO_HANDLER', error: classifyFailure('MISSING_DATA', { detail: 'NO_HANDLER' }) };
  }
  let output = null;
  let crashed = false;
  let thrown = null;
  try {
    output = await handler({ fault, now });
  } catch (e) {
    crashed = true;
    thrown = String(e?.message || e).slice(0, 200);
  }
  const findings = [];
  if (crashed) findings.push('CRASHED');
  if (!crashed) {
    const text = JSON.stringify(output ?? null);
    if (output?.executionAuthorized === true) findings.push('AUTHORIZED_DURING_FAULT');
    if (FORBIDDEN_STATUSES.includes(output?.status)) findings.push('FABRICATED_COMPLETION');
    if (output?.receipt && output.receipt.status && FORBIDDEN_STATUSES.includes(output.receipt.status) && !output.receipt.txHash) {
      findings.push('FABRICATED_RECEIPT');
    }
    if (output?.price !== undefined && output?.price !== null && output?.priceSource == null) findings.push('INVENTED_PRICE');
    if (output?.unavailable !== true && output?.ok !== false) findings.push('PRETENDED_TO_WORK');
    if (typeof output?.i18nKey !== 'string' || !output.i18nKey.startsWith('intentAI.')) findings.push('NO_HONEST_MESSAGE');
    if (text && text.includes('undefinedundefined')) findings.push('BROKEN_OUTPUT');
  }
  const passed = findings.length === 0;
  return {
    ok: true,
    schema: CHAOS_SCHEMA,
    fault,
    passed,
    crashed,
    thrown,
    findings,
    observed: crashed ? null : { unavailable: output?.unavailable === true, i18nKey: output?.i18nKey ?? null },
    i18nKey: passed ? 'intentAI.chaos.passed' : 'intentAI.chaos.failed',
    i18nParams: { fault },
    at: now
  };
}

/** Run the whole drill. One failure fails the drill; nothing is averaged. */
export async function runChaosDrill({ handlers = {}, faults = FAULTS, now = Date.now() } = {}) {
  const list = (Array.isArray(faults) ? faults : []).filter((f) => FAULTS.includes(f));
  if (!list.length) {
    return { ok: false, passed: false, results: [], error: classifyFailure('MISSING_DATA', { detail: 'NO_FAULTS' }) };
  }
  const results = [];
  for (const fault of list) {
    results.push(await injectFault({ fault, handler: handlers?.[fault], now }));
  }
  const failures = results.filter((r) => r.passed !== true);
  const untested = FAULTS.filter((f) => !list.includes(f));
  return {
    ok: failures.length === 0,
    schema: CHAOS_SCHEMA,
    // A partial drill is not a pass.
    passed: failures.length === 0 && untested.length === 0,
    results,
    failures: failures.map((f) => ({ fault: f.fault, findings: f.findings, reason: f.reason ?? null })),
    untested,
    coverage: Math.round((list.length / FAULTS.length) * 100),
    i18nKey: failures.length === 0 && untested.length === 0 ? 'intentAI.chaos.drillPassed' : 'intentAI.chaos.drillFailed',
    i18nParams: { failed: failures.length, untested: untested.length },
    at: now
  };
}

/** The honest-unavailable shape every faulted path should return. */
export function honestUnavailable({ fault = null, i18nKey = 'intentAI.chaos.unavailable', detail = null } = {}) {
  return {
    ok: false,
    unavailable: true,
    status: 'UNAVAILABLE',
    fault,
    i18nKey,
    executionAuthorized: false,
    requiresConfirmationGate: true,
    error: classifyFailure(detail || 'PROVIDER_ERROR', { detail: fault || 'UNAVAILABLE' })
  };
}

/** A drill result may never be presented as a pass unless it is one. */
export function assertDrillHonest(drill) {
  const reasons = [];
  if (!drill || drill.schema !== CHAOS_SCHEMA) reasons.push('NOT_A_DRILL');
  if (drill?.passed === true && (drill.failures || []).length) reasons.push('PASSED_WITH_FAILURES');
  if (drill?.passed === true && (drill.untested || []).length) reasons.push('PASSED_WITH_UNTESTED_FAULTS');
  if (drill?.ok === true && (drill.results || []).some((r) => r.crashed === true)) reasons.push('CRASH_REPORTED_AS_OK');
  const unique = [...new Set(reasons)];
  return unique.length
    ? { ok: false, reasons: unique, error: classifyFailure('MISSING_DATA', { detail: unique[0] }) }
    : { ok: true };
}
