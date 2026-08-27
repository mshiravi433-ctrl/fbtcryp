/**
 * FBT INTENT AI — PHASE 66: CONSENTED MEMORY
 * ---------------------------------------------------------------------------
 * Memory is not an entitlement. The adaptive-memory layer makes the assistant
 * better across sessions, and that is exactly why it may only run when the
 * user has said yes — in words, on the record, with a date.
 *
 *   · OFF MEANS NOTHING IS STORED. Not "stored but unused", not "kept for
 *     seven days". `recordWithConsent()` with consent off returns a result
 *     that carries no payload at all, and `assertNothingStored()` proves it.
 *   · CONSENT IS SPECIFIC AND REVOCABLE. It names its scopes and its date;
 *     revoking it wipes what was kept and is itself recorded.
 *   · EXPORT IS COMPLETE. Whatever was kept can be handed back in full, or
 *     the export refuses — a partial export is worse than none.
 *   · SECRETS ARE NEVER MEMORABLE, consent or no consent.
 */

import { classifyFailure } from './failureModes.js';
import { stripSecrets, FORBIDDEN_FIELDS } from './sessionPersistence.js';

export const CONSENT_MEMORY_SCHEMA = 'fbt.consented-memory.v1';
export const MEMORY_SCOPES = Object.freeze(['preferences', 'outcomes', 'risk-appetite', 'assets']);
export const CONSENT_MAX_AGE_MS = 365 * 24 * 60 * 60 * 1000;

const num = (v) => (v === null || v === undefined || v === '' || typeof v === 'boolean'
  ? null
  : (Number.isFinite(Number(v)) ? Number(v) : null));

/** Record an explicit opt-in. Nothing here is a default. */
export function grantMemoryConsent({ scopes = [], now = Date.now(), userConfirmed = false } = {}) {
  if (userConfirmed !== true) {
    return { ok: false, error: classifyFailure('USER_AUTHORIZATION_REQUIRED', { detail: 'CONSENT_NOT_CONFIRMED' }) };
  }
  const list = (Array.isArray(scopes) ? scopes : []).filter((s) => MEMORY_SCOPES.includes(s));
  if (!list.length) return { ok: false, error: classifyFailure('MISSING_DATA', { detail: 'NO_SCOPES' }) };
  return {
    ok: true,
    schema: CONSENT_MEMORY_SCHEMA,
    enabled: true,
    scopes: Object.freeze([...new Set(list)]),
    grantedAt: now,
    expiresAt: now + CONSENT_MAX_AGE_MS,
    revocable: true,
    i18nKey: 'intentAI.memory.consentGranted',
    i18nParams: { scopes: list.join(', ') }
  };
}

/** The default state, and the state after a revoke. */
export function memoryOff({ now = Date.now(), reason = 'NOT_GRANTED' } = {}) {
  return {
    ok: true,
    schema: CONSENT_MEMORY_SCHEMA,
    enabled: false,
    scopes: Object.freeze([]),
    reason,
    grantedAt: null,
    i18nKey: 'intentAI.memory.off'
  };
}

/** Is this consent good, for this scope, right now? */
export function consentCovers(consent, scope, { now = Date.now() } = {}) {
  if (!consent || consent.schema !== CONSENT_MEMORY_SCHEMA || consent.enabled !== true) return false;
  if (num(consent.expiresAt) !== null && now > consent.expiresAt) return false;
  return Array.isArray(consent.scopes) && consent.scopes.includes(scope);
}

/**
 * The only way anything is written. With consent off, the returned record has
 * no payload — there is nothing to hand to a store.
 */
export function recordWithConsent({ consent = null, scope = null, record = null, now = Date.now() } = {}) {
  if (!consentCovers(consent, scope, { now })) {
    return {
      ok: false,
      schema: CONSENT_MEMORY_SCHEMA,
      stored: false,
      // No payload. Not an empty object that a caller might still persist.
      payload: null,
      reason: consent?.enabled === true ? 'SCOPE_NOT_CONSENTED' : 'MEMORY_OFF',
      i18nKey: 'intentAI.memory.notStored',
      error: classifyFailure('USER_AUTHORIZATION_REQUIRED', { detail: 'NO_MEMORY_CONSENT' })
    };
  }
  if (!record || typeof record !== 'object') {
    return { ok: false, stored: false, payload: null, error: classifyFailure('MISSING_DATA', { detail: 'NO_RECORD' }) };
  }
  // Consent covers preferences and outcomes. It never covers credentials.
  const safe = stripSecrets(record);
  return {
    ok: true,
    schema: CONSENT_MEMORY_SCHEMA,
    stored: true,
    scope,
    payload: { scope, data: safe, at: now },
    i18nKey: 'intentAI.memory.stored',
    storedAt: now
  };
}

/** Hand everything back, or refuse. There is no partial export. */
export function exportMemory({ consent = null, records = [], now = Date.now() } = {}) {
  if (!consent || consent.schema !== CONSENT_MEMORY_SCHEMA) {
    return { ok: false, error: classifyFailure('MISSING_DATA', { detail: 'NO_CONSENT_RECORD' }) };
  }
  const rows = Array.isArray(records) ? records : null;
  if (rows === null) {
    return { ok: false, complete: false, error: classifyFailure('MISSING_DATA', { detail: 'MEMORY_UNREADABLE' }) };
  }
  return {
    ok: true,
    schema: CONSENT_MEMORY_SCHEMA,
    complete: true,
    consent: { enabled: consent.enabled === true, scopes: consent.scopes, grantedAt: consent.grantedAt },
    records: rows.map((row) => stripSecrets(row)),
    count: rows.length,
    containsSecrets: FORBIDDEN_FIELDS.some((bad) => new RegExp(bad, 'i').test(JSON.stringify(rows.map(stripSecrets)))),
    exportedAt: now
  };
}

/** Revoke and wipe. The wipe is part of the revoke, not a follow-up chore. */
export function revokeMemoryConsent({ consent = null, clearHandler = null, now = Date.now() } = {}) {
  let cleared = false;
  let clearError = null;
  if (typeof clearHandler === 'function') {
    try {
      clearHandler();
      cleared = true;
    } catch (e) {
      clearError = String(e?.message || 'CLEAR_FAILED').slice(0, 80);
    }
  }
  return {
    ok: clearError === null,
    schema: CONSENT_MEMORY_SCHEMA,
    consent: memoryOff({ now, reason: 'USER_REVOKED' }),
    cleared,
    // A revoke that could not wipe is a FAILED revoke, reported as such.
    clearError,
    i18nKey: clearError === null ? 'intentAI.memory.revoked' : 'intentAI.memory.revokeFailed',
    revokedAt: now,
    error: clearError === null ? null : classifyFailure('PROVIDER_ERROR', { detail: clearError })
  };
}

/**
 * Fail-closed guard: with memory off, prove nothing was produced that a caller
 * could persist.
 */
export function assertNothingStored(result) {
  const reasons = [];
  if (!result) reasons.push('NO_RESULT');
  if (result?.stored === true) reasons.push('CLAIMS_STORED');
  if (result?.payload !== null && result?.payload !== undefined) reasons.push('PAYLOAD_PRESENT');
  return reasons.length
    ? { ok: false, reasons, error: classifyFailure('USER_AUTHORIZATION_REQUIRED', { detail: reasons.join(',') }) }
    : { ok: true, reasons: [] };
}
