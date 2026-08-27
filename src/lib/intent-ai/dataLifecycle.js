/**
 * FBT INTENT AI — PHASE 92: DATA LIFECYCLE
 * ---------------------------------------------------------------------------
 * A deletion request is not a deletion. Phase 92 makes export and erasure real
 * operations with evidence: every store is enumerated, each one reports what it
 * removed, and the result is verified by reading back.
 *
 *   · the store list is closed and complete; a store missing from the run makes
 *     the deletion INCOMPLETE, never "done"
 *   · a store that throws or refuses is reported as failed — the overall
 *     receipt then says partial, and the user is told exactly what remains
 *   · verification re-reads every store; leftovers are named
 *   · an export is produced BEFORE erasure and is itself complete or refused
 */

import { classifyFailure } from './failureModes.js';
import { digest } from './onchainReceipt.js';

export const LIFECYCLE_SCHEMA = 'fbt.data-lifecycle.v1';

export const DATA_STORES = Object.freeze([
  'memory', 'sessions', 'audit', 'preferences', 'receipts', 'alerts', 'cache'
]);

/** Things we must never hand back in an export because we never hold them. */
const NEVER_EXPORTED = Object.freeze(['privateKey', 'mnemonic', 'seed', 'sessionKey', 'signature']);

const num = (v) => (v === null || v === undefined || v === '' || typeof v === 'boolean'
  ? null
  : (Number.isFinite(Number(v)) ? Number(v) : null));

function scrub(value, depth = 0) {
  if (!value || typeof value !== 'object' || depth > 5) return value ?? null;
  if (Array.isArray(value)) return value.map((v) => scrub(v, depth + 1));
  const out = {};
  for (const [k, v] of Object.entries(value)) {
    if (NEVER_EXPORTED.includes(k)) continue;
    out[k] = scrub(v, depth + 1);
  }
  return out;
}

/** Everything we hold about this user, or an honest refusal. */
export async function exportUserData({ userId = null, readers = {}, now = Date.now() } = {}) {
  if (!userId) {
    return { ok: false, complete: false, i18nKey: 'intentAI.lifecycle.exportFailed', error: classifyFailure('MISSING_DATA', { detail: 'NO_USER' }) };
  }
  const data = {};
  const failed = [];
  for (const store of DATA_STORES) {
    const reader = readers?.[store];
    if (typeof reader !== 'function') { failed.push({ store, reason: 'NO_READER' }); continue; }
    try {
      data[store] = scrub(await reader({ userId }));
    } catch {
      failed.push({ store, reason: 'READ_FAILED' });
    }
  }
  const complete = failed.length === 0;
  return {
    ok: complete,
    schema: LIFECYCLE_SCHEMA,
    userId,
    data: complete ? data : null,
    // A partial export is not offered as if it were everything.
    complete,
    failedStores: failed,
    storeCount: Object.keys(data).length,
    checksum: complete ? digest(data) : null,
    containsSecrets: false,
    i18nKey: complete ? 'intentAI.lifecycle.exportReady' : 'intentAI.lifecycle.exportPartial',
    at: now,
    error: complete ? null : classifyFailure('PROVIDER_ERROR', { detail: failed[0].reason })
  };
}

/** Delete everywhere, count what went, and admit what stayed. */
export async function deleteUserData({ userId = null, erasers = {}, confirmed = false, now = Date.now() } = {}) {
  if (!userId) {
    return { ok: false, deleted: false, i18nKey: 'intentAI.lifecycle.deleteFailed', error: classifyFailure('MISSING_DATA', { detail: 'NO_USER' }) };
  }
  if (confirmed !== true) {
    // Erasure is irreversible; it needs a real confirmation.
    return { ok: false, deleted: false, i18nKey: 'intentAI.lifecycle.deleteNeedsConfirmation', error: classifyFailure('USER_AUTHORIZATION_REQUIRED', { detail: 'DELETION_NOT_CONFIRMED' }) };
  }
  const cleared = [];
  const failed = [];
  for (const store of DATA_STORES) {
    const eraser = erasers?.[store];
    if (typeof eraser !== 'function') { failed.push({ store, reason: 'NO_ERASER' }); continue; }
    try {
      const res = await eraser({ userId });
      if (res === false || res?.ok === false) failed.push({ store, reason: 'ERASER_REFUSED' });
      else cleared.push({ store, removed: num(res?.removed) });
    } catch {
      failed.push({ store, reason: 'ERASE_FAILED' });
    }
  }
  const complete = failed.length === 0 && cleared.length === DATA_STORES.length;
  return {
    ok: complete,
    schema: LIFECYCLE_SCHEMA,
    userId,
    deleted: complete,
    clearedStores: cleared.map((c) => c.store),
    failedStores: failed,
    // A deletion with anything left is PARTIAL, and says so.
    complete,
    i18nKey: complete ? 'intentAI.lifecycle.deleted' : 'intentAI.lifecycle.deletePartial',
    i18nParams: { cleared: cleared.length, remaining: failed.length },
    at: now,
    error: complete ? null : classifyFailure('PROVIDER_ERROR', { detail: failed[0]?.reason || 'INCOMPLETE' })
  };
}

/** Read everything back. Proof, not a promise. */
export async function verifyDeletion({ userId = null, readers = {}, deletion = null, now = Date.now() } = {}) {
  const leftovers = [];
  const unverifiable = [];
  for (const store of DATA_STORES) {
    const reader = readers?.[store];
    if (typeof reader !== 'function') { unverifiable.push({ store, reason: 'NO_READER' }); continue; }
    let value = null;
    try { value = await reader({ userId }); } catch { unverifiable.push({ store, reason: 'READ_FAILED' }); continue; }
    const empty = value === null || value === undefined
      || (Array.isArray(value) && value.length === 0)
      || (typeof value === 'object' && Object.keys(value).length === 0);
    if (!empty) leftovers.push({ store, reason: 'DATA_REMAINS' });
  }
  const proven = leftovers.length === 0 && unverifiable.length === 0;
  return {
    ok: proven,
    schema: LIFECYCLE_SCHEMA,
    userId,
    proven,
    leftovers,
    unverifiable,
    // A deletion we cannot verify is not a proven deletion.
    receipt: proven
      ? Object.freeze({ userId, stores: DATA_STORES.length, at: now, proof: digest({ userId, at: now, stores: DATA_STORES }) })
      : null,
    i18nKey: proven ? 'intentAI.lifecycle.deletionProven' : 'intentAI.lifecycle.deletionUnproven',
    deletionClaimedComplete: deletion?.complete === true,
    at: now
  };
}

/** No claim of erasure without proof of erasure. */
export function assertErasureProven({ deletion = null, verification = null, exportResult = null } = {}) {
  const reasons = [];
  if (deletion?.deleted === true && verification?.proven !== true) reasons.push('DELETION_CLAIMED_WITHOUT_PROOF');
  if (deletion?.complete === true && (deletion.failedStores || []).length) reasons.push('COMPLETE_WITH_FAILED_STORES');
  if (verification?.proven === true && (verification.leftovers || []).length) reasons.push('PROVEN_WITH_LEFTOVERS');
  if (verification?.proven === true && (verification.unverifiable || []).length) reasons.push('PROVEN_WITHOUT_READING_EVERYTHING');
  if (exportResult?.complete === true && (exportResult.failedStores || []).length) reasons.push('EXPORT_CLAIMS_COMPLETE');
  if (exportResult?.containsSecrets === true) reasons.push('EXPORT_CONTAINS_SECRETS');
  const unique = [...new Set(reasons)];
  return unique.length
    ? { ok: false, reasons: unique, error: classifyFailure('MISSING_DATA', { detail: unique[0] }) }
    : { ok: true };
}
