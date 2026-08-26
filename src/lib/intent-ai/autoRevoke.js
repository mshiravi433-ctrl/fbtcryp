/**
 * FBT INTENT AI — Spec 65 item 5: Auto-Revoke.
 *
 * When an intent ends — completed with receipt, expired, cancelled, revoked —
 * every standing grant must be revoked in the same sweep: dYdX permissions,
 * external agent scopes and smart wallet sessions. Permanent access is a
 * violation: a grant without an expiry is flagged and blocked from renewal.
 */

import { applyNonBypassableControl, containsRawSecret, fail, finite, noExecutionPermission, safeId, safeString } from './phaseBoundary.js';

export const AUTO_REVOKE_SCHEMA = 'fbt.intent-auto-revoke.v1';

export const REVOCABLE_GRANT_KINDS = Object.freeze(['dydx-permission', 'external-agent-scope', 'smart-wallet-session']);

const TERMINAL_INTENT_STATUSES = new Set(['FAILED', 'EXPIRED', 'COMPLETED', 'CANCELLED', 'REVOKED']);

function normalizeGrant(input, index) {
  if (!input || typeof input !== 'object' || containsRawSecret(input)) return null;
  const kind = REVOCABLE_GRANT_KINDS.includes(input.kind) ? input.kind : null;
  const id = safeId(input.id || `grant-${index + 1}`);
  if (!kind || !id) return null;
  const expiresAt = finite(input.expiresAt);
  return {
    id,
    kind,
    intentId: safeId(input.intentId) || null,
    holderId: safeId(input.holderId) || safeString(String(input.holderId || ''), 80) || null,
    issuedAt: finite(input.issuedAt),
    expiresAt,
    revoked: input.revoked === true,
    permanent: input.permanent === true
  };
}

/**
 * Sweep all grants tied to an intent that has reached a terminal state.
 * Expired grants are revoked automatically; every revocation is recorded with
 * reason and timestamp. Nothing here touches funds — it only revokes standing
 * permissions.
 */
export function sweepAutoRevoke({ intentId = null, intentStatus = null, grants = [], revokeHandler = null, now = Date.now() } = {}) {
  if (containsRawSecret({ intentId, grants })) return fail('RAW_CREDENTIAL_FORBIDDEN');
  const owner = safeId(intentId);
  if (!owner) return fail('INTENT_ID_REQUIRED');
  const status = safeString(String(intentStatus || ''), 24);
  if (!TERMINAL_INTENT_STATUSES.has(status)) {
    return noExecutionPermission({
      ok: true,
      schema: AUTO_REVOKE_SCHEMA,
      intentId: owner,
      status: 'not-terminal',
      revoked: [],
      pending: [],
      violations: [],
      note: 'Auto-revoke runs when the intent ends; a running intent keeps its bounded grants.',
      sweptAt: now
    });
  }
  const rows = (Array.isArray(grants) ? grants : []).map(normalizeGrant).filter(Boolean);
  const scoped = rows.filter((row) => row.intentId === owner || row.intentId === null);
  const revoked = [];
  const pending = [];
  const violations = [];
  for (const grant of scoped) {
    if (grant.revoked) continue;
    const expired = grant.expiresAt !== null && now >= grant.expiresAt;
    if (grant.permanent === true && grant.expiresAt === null) {
      violations.push({ grantId: grant.id, kind: grant.kind, code: 'PERMANENT_ACCESS_FORBIDDEN' });
      continue;
    }
    if (expired || status === 'REVOKED' || status === 'CANCELLED' || status === 'EXPIRED') {
      const result = typeof revokeHandler === 'function'
        ? (() => { try { return revokeHandler(grant, { reason: 'INTENT_TERMINAL', intentStatus: status, now }); } catch { return { ok: false }; } })()
        : { ok: null, handler: 'none' };
      const record = {
        grantId: grant.id,
        kind: grant.kind,
        holderId: grant.holderId,
        reason: expired ? 'GRANT_EXPIRED' : `INTENT_${status}`,
        revokeHandlerResult: result?.ok === true ? 'executed' : result?.ok === false ? 'failed' : 'recorded-without-handler',
        revokedAt: now
      };
      if (result?.ok === false) pending.push(record);
      else revoked.push(record);
    } else {
      pending.push({ grantId: grant.id, kind: grant.kind, reason: 'AWAITING_TERMINAL_OR_EXPIRY' });
    }
  }
  return noExecutionPermission({
    ok: pending.length === 0,
    schema: AUTO_REVOKE_SCHEMA,
    intentId: owner,
    status: 'swept',
    revoked,
    pending,
    violations,
    permanentAccessAllowed: false,
    note: violations.length
      ? 'At least one grant claimed permanent access; this is a violation and blocks renewal.'
      : 'Standing grants are revoked when the intent ends or the grant expires.',
    sweptAt: now
  });
}

/**
 * Validate that a new grant is bounded: it must have an expiry and must not
 * claim permanence. A grant without an expiry is rejected, not silently
 * accepted.
 */
export function assertBoundedGrant({ kind = null, id = null, intentId = null, holderId = null, expiresAt = null, issuedAt = null } = {}) {
  const normalized = normalizeGrant({ kind, id, intentId, holderId, expiresAt, issuedAt });
  if (!normalized) return fail('GRANT_INVALID', 'kind must be a revocable kind and id a safe id.');
  if (normalized.expiresAt === null) return fail('GRANT_EXPIRY_REQUIRED', 'Standing access without an expiry is forbidden.');
  return noExecutionPermission({
    ok: true,
    schema: AUTO_REVOKE_SCHEMA,
    grant: normalized,
    permanent: false,
    autoRevokesOn: ['INTENT_TERMINAL', 'GRANT_EXPIRY', 'USER_REVOKE', 'GUARDIAN_STOP'],
    executionAuthorized: false
  });
}

/** Explicit user/operator revoke of a single grant — never bypasses STOP. */
export function revokeGrantNow(grant, { reason = 'USER_REVOKE', now = Date.now() } = {}) {
  const normalized = normalizeGrant(grant);
  if (!normalized) return fail('GRANT_INVALID');
  return noExecutionPermission({
    ok: true,
    schema: AUTO_REVOKE_SCHEMA,
    grantId: normalized.id,
    kind: normalized.kind,
    revoked: true,
    reason: safeString(reason, 80) || 'USER_REVOKE',
    revokedAt: now,
    reversible: false
  });
}

/** Re-application must respect a non-bypassable control state (e.g. STOP). */
export function reapplyGrantAfterControl(grant, controls, { expiresAt = null, now = Date.now() } = {}) {
  const boundedGrant = assertBoundedGrant({ ...(grant || {}), expiresAt });
  if (!boundedGrant.ok) return boundedGrant;
  const control = applyNonBypassableControl(controls && typeof controls === 'object' ? controls : {}, 'STOP', now);
  const stopped = control?.controls?.stopped === true || control?.controls?.paused === true || control?.controls?.revoked === true;
  if (stopped) return fail('CONTROL_ACTIVE', 'A non-bypassable control is active; the grant cannot be re-applied.');
  return boundedGrant;
}
