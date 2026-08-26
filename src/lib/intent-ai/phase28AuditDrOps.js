/**
 * FBT INTENT AI — Phase 28: durable immutable audit and disaster-recovery ops.
 */
import { fail, finite, unavailable } from './phaseBoundary.js';

export const PHASE28_SCHEMA = 'fbt.audit-dr-ops.v1';
const DIGEST = /^(?:0x)?[0-9a-f]{64}$/i;

export function operateImmutableAudit({ event = null, tamper = null } = {}) {
  if (tamper?.rewrite || tamper?.delete || tamper?.reorder) return fail('AUDIT_TAMPER', null, { schema: PHASE28_SCHEMA });
  if (!event || !DIGEST.test(String(event.rootHash || '')) || !event.actor || !event.action || !event.reason) {
    return unavailable('AUDIT_ROOT_REQUIRED');
  }
  return { ok: true, schema: PHASE28_SCHEMA, appendOnly: true, secrets: false, operational: false };
}

export function operateBackupRestore({ restored = false, hashBefore = null, hashAfter = null, rpoMs = null, rtoMs = null } = {}) {
  if (restored !== true || hashBefore !== hashAfter || !DIGEST.test(String(hashBefore || ''))) {
    return unavailable('BACKUP_RESTORE_FAILURE', null, { schema: PHASE28_SCHEMA });
  }
  return { ok: true, schema: PHASE28_SCHEMA, rpoMs: finite(rpoMs), rtoMs: finite(rtoMs), operational: false, drilled: true };
}
