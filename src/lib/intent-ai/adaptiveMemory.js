/**
 * FBT INTENT AI — LOCAL-FIRST ADAPTIVE MEMORY (Phase 5)
 * ---------------------------------------------------------------------------
 * A bounded, local, user-clearable store of OPT-IN learning outcomes. It holds
 * NO PII: no address, no user id, no IP, no tx hash, no key. It only aggregates
 * the anonymous records written by learningOptIn.js.
 *
 * Hard rules:
 *   - Records require explicit opt-in (`learningOptIn === true`).
 *   - Bounded size; the user may clear everything at any time.
 *   - Never exports a secret; `exportMemorySummary` is aggregate-only.
 *   - Memory only refines STRATEGY SUGGESTIONS — it never loosens Guardian,
 *     Risk, or the Confirmation Gate.
 */

import { loadLearningSamples, clearLearningSamples, learningConsent, recordLearningSample } from './learningOptIn.js';
import { classifyFailure } from './failureModes.js';

export const MEMORY_SCHEMA = 'fbt.adaptive-memory.v1';
export const MAX_MEMORY_RECORDS = 200;

/** Load the anonymous opt-in outcomes (already redacted by learningOptIn). */
export function loadMemory() {
  return loadLearningSamples().map((r) => ({ ...r }));
}

/** Aggregate, PII-free statistics derived from the opt-in memory. */
export function memoryStats(samples) {
  const list = Array.isArray(samples) ? samples : loadMemory();
  const byStrategy = {};
  let success = 0;
  let completed = 0;
  let total = 0;
  for (const r of list) {
    total += 1;
    const key = r.strategy || 'unknown';
    byStrategy[key] = byStrategy[key] || { count: 0, success: 0 };
    byStrategy[key].count += 1;
    if (r.outcome === 'success') { success += 1; byStrategy[key].success += 1; }
    if (r.outcome === 'COMPLETED' && r.confirmed === true) completed += 1;
  }
  return {
    schema: MEMORY_SCHEMA,
    sampleSize: total,
    successCount: success,
    successRate: total ? Math.round((success / total) * 100) : null,
    completedCount: completed,
    byStrategy,
    // Memory never claims guaranteed profit.
    disclaimer: 'NOT_GUARANTEED',
    pii: false
  };
}

/** Clear all adaptive memory (user-controlled). */
export function clearMemory() {
  const cleared = clearLearningSamples();
  return { ok: cleared, cleared: true };
}

/** Honest capability flag: this memory is local-only, not an external AI. */
export function memoryCapabilities(session) {
  return {
    local: true,
    optInRequired: true,
    optInActive: learningConsent(session),
    piiStored: false,
    externalSync: false
  };
}

/** A raw memory record is never accepted without opt-in; bridge to learningOptIn. */
export function rememberOutcome(session, record) {
  if (!learningConsent(session)) {
    return { ok: false, stored: false, error: classifyFailure('UNKNOWN', { detail: 'NO_OPTIN' }) };
  }
  // Delegate to learningOptIn which enforces redaction + honesty.
  return recordLearningSample(session, record);
}
