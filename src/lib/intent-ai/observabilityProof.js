/**
 * FBT INTENT AI — Phase 18: observability and proof.
 *
 * Audit events form an append-only hash chain. Receipts are accepted as
 * COMPLETED only when their integrity, runtime confirmation and execution
 * evidence are independently present. Reorg/outage/partial/retry recovery is
 * observation-first and idempotent: ambiguity never causes a second submit.
 */

import {
  containsRawSecret,
  fail,
  finite,
  noExecutionPermission,
  safeId,
  safeString,
  unavailable
} from './phaseBoundary.js';

export const AUDIT_TIMELINE_SCHEMA = 'fbt.audit-timeline.v1';
export const AUDIT_EVENT_SCHEMA = 'fbt.audit-event.v1';
export const RECEIPT_INTEGRITY_SCHEMA = 'fbt.receipt-integrity.v1';
export const EXECUTION_PROOF_SCHEMA = 'fbt.execution-proof.v2';
export const INCIDENT_SCHEMA = 'fbt.intent-incident.v1';
export const RECOVERY_SCHEMA = 'fbt.intent-recovery.v2';

const MAX_EVENTS = 1000;
const ID = /^[a-z0-9][a-z0-9._:-]{1,127}$/i;
const HEX = /^(?:0x)?[0-9a-f]+$/i;

function canonical(value) {
  if (value == null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (Array.isArray(value)) return value.map(canonical);
  if (typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]).filter(([, item]) => item !== undefined));
  return String(value);
}

/** Async SHA-256 keeps this usable in browsers without importing Node crypto. */
export async function contentHash(value) {
  if (!globalThis.crypto?.subtle || typeof TextEncoder === 'undefined') throw new Error('CRYPTO_UNAVAILABLE');
  const bytes = new TextEncoder().encode(JSON.stringify(canonical(value)));
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function publicEvent(input, sequence, previousHash, now) {
  if (!input || typeof input !== 'object' || containsRawSecret(input)) return null;
  const eventId = safeId(input.eventId || `event-${sequence}`);
  const actor = safeId(input.actor || input.actorId);
  const action = safeString(input.action, 96);
  const reason = safeString(input.reason || input.reasonCode, 180);
  const policyVersion = safeString(input.policyVersion, 64);
  if (!eventId || !actor || !action || !reason || !policyVersion) return null;
  return {
    schema: AUDIT_EVENT_SCHEMA,
    eventId,
    sequence,
    intentId: safeId(input.intentId),
    actor,
    action,
    reason,
    policyVersion,
    status: safeString(input.status, 48) || null,
    timestamp: finite(input.timestamp) ?? now,
    previousHash: previousHash || null
  };
}

/** Create an append-only, in-memory audit timeline. Storage is injected later. */
export function createAuditTimeline({ intentId, policyVersion, now = Date.now(), maxEvents = MAX_EVENTS } = {}) {
  const id = safeId(intentId);
  const policy = safeString(policyVersion, 64);
  if (!id || !policy) return { ok: false, schema: AUDIT_TIMELINE_SCHEMA, code: 'AUDIT_CONTEXT_REQUIRED' };
  const timeline = {
    schema: AUDIT_TIMELINE_SCHEMA,
    intentId: id,
    policyVersion: policy,
    events: [],
    sealed: false,
    durable: false,
    appendOnly: true,
    storageStatus: 'process-local-not-durable',
    async append(input = {}) {
      if (timeline.sealed) return fail('AUDIT_SEALED');
      if (timeline.events.length >= Math.min(MAX_EVENTS, Math.max(1, Number(maxEvents) || MAX_EVENTS))) return fail('AUDIT_LIMIT_REACHED');
      const event = publicEvent({ ...input, intentId: id, policyVersion: input.policyVersion || policy }, timeline.events.length, timeline.events.at(-1)?.hash || null, now);
      if (!event) return fail('AUDIT_EVENT_INVALID');
      let hash;
      try { hash = await contentHash(event); } catch { return unavailable('CRYPTO_UNAVAILABLE', 'Audit integrity cannot be created without Web Crypto.'); }
      const stored = Object.freeze({ ...event, hash });
      timeline.events.push(stored);
      return { ok: true, event: stored, appendOnly: true };
    },
    seal() {
      timeline.sealed = true;
      return { ok: true, schema: AUDIT_TIMELINE_SCHEMA, sealed: true, eventCount: timeline.events.length, rootHash: timeline.events.at(-1)?.hash || null };
    },
    async verify() { return verifyAuditTimeline(timeline); },
    public() {
      return { schema: AUDIT_TIMELINE_SCHEMA, intentId: id, policyVersion: policy, events: timeline.events.map((event) => ({ ...event })), sealed: timeline.sealed, durable: timeline.durable, appendOnly: true, storageStatus: timeline.storageStatus };
    }
  };
  return timeline;
}

export async function verifyAuditTimeline(timeline) {
  if (!timeline || timeline.schema !== AUDIT_TIMELINE_SCHEMA || !Array.isArray(timeline.events)) return fail('AUDIT_INVALID');
  let previous = null;
  for (let index = 0; index < timeline.events.length; index += 1) {
    const event = timeline.events[index];
    if (event.sequence !== index || event.previousHash !== previous) return fail('AUDIT_CHAIN_BROKEN', `sequence:${index}`);
    const { hash, ...unsigned } = event;
    if (!hash || !HEX.test(hash)) return fail('AUDIT_HASH_MISMATCH', `sequence:${index}`);
    let recalculated;
    try { recalculated = await contentHash(unsigned); } catch { return unavailable('CRYPTO_UNAVAILABLE', 'Audit integrity cannot be verified without Web Crypto.'); }
    if (recalculated !== hash) return fail('AUDIT_HASH_MISMATCH', `sequence:${index}`);
    previous = hash;
  }
  return { ok: true, schema: AUDIT_TIMELINE_SCHEMA, immutable: true, eventCount: timeline.events.length, rootHash: previous };
}

function proofPublic(proof = {}) {
  if (!proof || typeof proof !== 'object' || containsRawSecret(proof)) return null;
  const intentId = safeId(proof.intentId);
  const receiptId = safeId(proof.receiptId);
  const providerId = safeId(proof.providerId);
  const txRef = safeString(proof.txRef || proof.receiptRef, 180);
  if (!intentId || !receiptId || !providerId || !txRef) return null;
  return {
    schema: EXECUTION_PROOF_SCHEMA,
    intentId,
    receiptId,
    providerId,
    txRef,
    status: safeString(proof.status, 32) || 'confirmed',
    confirmed: proof.confirmed === true,
    providerEvidence: proof.providerEvidence === true,
    policyVersion: safeString(proof.policyVersion, 64) || null,
    actualOutput: finite(proof.actualOutput),
    checkedAt: finite(proof.checkedAt),
    reorgChecked: proof.reorgChecked === true,
    createdAt: finite(proof.createdAt) ?? Date.now()
  };
}

/** Build a content-addressed receipt; this does not claim finality by itself. */
export async function createExecutionReceipt(proof = {}) {
  const value = proofPublic(proof);
  if (!value) return fail('EXECUTION_PROOF_INCOMPLETE');
  if (!value.confirmed || !value.providerEvidence || value.checkedAt === null) return unavailable('EXECUTION_PROOF_UNAVAILABLE', 'Confirmed provider evidence is required.');
  let hash;
  try { hash = await contentHash(value); } catch { return unavailable('CRYPTO_UNAVAILABLE', 'Receipt integrity cannot be created without Web Crypto.'); }
  return {
    ok: true,
    schema: RECEIPT_INTEGRITY_SCHEMA,
    receiptId: value.receiptId,
    proof: value,
    integrityHash: hash,
    integrityAlgorithm: 'SHA-256',
    verified: false,
    finality: value.reorgChecked ? 'checked' : 'not-checked',
    completed: false,
    status: 'CONFIRMED_PENDING_FINAL_REVIEW'
  };
}

/** A receipt becomes completed only after recomputation and reorg check. */
export async function verifyExecutionReceipt(receipt, { now = Date.now(), maxAgeMs = 10 * 60_000 } = {}) {
  if (!receipt || receipt.schema !== RECEIPT_INTEGRITY_SCHEMA || !receipt.proof) return fail('RECEIPT_INVALID');
  if (containsRawSecret(receipt)) return fail('RAW_CREDENTIAL_FORBIDDEN');
  let expected;
  try { expected = await contentHash(receipt.proof); } catch { return unavailable('CRYPTO_UNAVAILABLE', 'Receipt integrity cannot be verified without Web Crypto.'); }
  if (expected !== receipt.integrityHash) return fail('RECEIPT_INTEGRITY_MISMATCH');
  const proof = receipt.proof;
  if (proof.status !== 'confirmed' || proof.confirmed !== true || proof.providerEvidence !== true || proof.reorgChecked !== true) return unavailable('RECEIPT_NOT_FINAL', 'Receipt is confirmed but finality/reorg evidence is incomplete.');
  if (proof.checkedAt == null || proof.checkedAt > now || now - proof.checkedAt > maxAgeMs) return unavailable('RECEIPT_EVIDENCE_STALE');
  return { ok: true, schema: RECEIPT_INTEGRITY_SCHEMA, receiptId: receipt.receiptId, verified: true, completed: true, status: 'COMPLETED', integrityHash: receipt.integrityHash, finality: 'checked' };
}

/** Reasons, policy, actor and time are mandatory for every action explanation. */
export function whyEngine({ action, actor, reason, policyVersion, timestamp = Date.now(), evidence = [] } = {}) {
  if (containsRawSecret({ action, actor, reason, policyVersion, evidence })) return fail('RAW_CREDENTIAL_FORBIDDEN');
  if (!safeId(actor) || !safeString(action, 96) || !safeString(reason, 180) || !safeString(policyVersion, 64) || !Number.isFinite(Number(timestamp))) return fail('WHY_FIELDS_REQUIRED');
  return noExecutionPermission({ ok: true, schema: 'fbt.intent-why.v1', action: String(action), actor: safeId(actor), reason: String(reason), policyVersion: String(policyVersion), timestamp: Number(timestamp), evidence: Array.isArray(evidence) ? evidence.slice(0, 12).map((item) => safeString(String(item), 120)).filter(Boolean) : [], guarantee: false });
}

export function classifyIncident({ status, receipt = null, providerError = null, reorg = false, partial = false, retry = false } = {}) {
  const normalized = String(status || '').toLowerCase();
  const type = reorg ? 'reorg' : partial ? 'partial-fill' : providerError ? 'outage' : retry ? 'retry' : normalized === 'confirmed' ? 'none' : 'unknown';
  return { schema: INCIDENT_SCHEMA, type, status: type === 'none' ? 'none' : 'incident', receiptPresent: Boolean(receipt), providerError: safeString(providerError, 120) || null, retryable: type === 'outage' || type === 'retry', secondTransactionCreated: false };
}

/**
 * Recovery is deliberately observation-first. A transaction is only retried
 * when the caller proves that nothing was submitted and explicitly allows it;
 * an unknown/timeout/ambiguous outcome never creates a second transaction.
 */
export async function recoverExecution({ idempotencyKey, existingReceipt = null, incident = {}, observer = null, retryAllowed = false, now = Date.now() } = {}) {
  const key = safeId(idempotencyKey);
  if (!key) return fail('IDEMPOTENCY_KEY_REQUIRED', null, { secondTransactionCreated: false });
  if (typeof observer !== 'function') return unavailable('RECOVERY_OBSERVER_UNAVAILABLE', 'Observe the existing transaction before recovery.', { schema: RECOVERY_SCHEMA, secondTransactionCreated: false });
  try {
    const observed = await observer(key);
    if (observed?.submitted === true || observed?.status === 'unknown' || existingReceipt) return { ok: true, schema: RECOVERY_SCHEMA, action: 'OBSERVE_EXISTING', status: observed?.status || 'ambiguous', retryAllowed: false, secondTransactionCreated: false, idempotencyKey: key, checkedAt: now };
    if (retryAllowed !== true) return { ok: true, schema: RECOVERY_SCHEMA, action: 'WAIT_OR_ABORT', status: observed?.status || 'not-submitted', retryAllowed: false, secondTransactionCreated: false, idempotencyKey: key, checkedAt: now };
    return { ok: true, schema: RECOVERY_SCHEMA, action: 'RETRY_REQUIRES_NEW_EXPLICIT_AUTHORIZATION', status: 'not-submitted', retryAllowed: true, secondTransactionCreated: false, idempotencyKey: key, checkedAt: now, incident: classifyIncident(incident) };
  } catch { return unavailable('RECOVERY_OBSERVER_FAILED', null, { schema: RECOVERY_SCHEMA, secondTransactionCreated: false }); }
}

export function disasterRecoveryStatus({ durableAudit = false, immutableStore = false, backupVerified = false, incidentRunbook = false } = {}) {
  const operational = durableAudit && immutableStore && backupVerified && incidentRunbook;
  return { schema: 'fbt.intent-disaster-resilience.v1', status: operational ? 'configured-not-proven' : 'unavailable', durableAudit: durableAudit === true, immutableStore: immutableStore === true, backupVerified: backupVerified === true, incidentRunbook: incidentRunbook === true, operational: false, blocker: operational ? 'RUNTIME_DRILL_REQUIRED' : 'DURABLE_IMMUTABLE_BACKUP_REQUIRED' };
}
