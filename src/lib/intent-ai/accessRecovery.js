/**
 * FBT INTENT AI — PHASE 68: ACCESS RECOVERY
 * ---------------------------------------------------------------------------
 * A lost device is not lost capital. If a phone with an active Intent AI
 * session goes missing, the user must be able to kill every session key from
 * somewhere else — and after that, nothing that phone holds may work again.
 *
 *   · a revocation can be raised from ANY device that proves the same linked
 *     identity, including the one being revoked
 *   · revocation is a TOMBSTONE, not a deletion: the record of "this key is
 *     dead" is what makes a replayed key fail, so it is kept and checked
 *   · `assertKeyUsable()` is the single question every signing path asks, and
 *     after a revoke it answers no for every key in scope — including keys
 *     issued before the revoke that a stale client might still be holding
 *   · "revoke everything" is available without knowing the key ids, because a
 *     panicking user does not have a list
 */

import { classifyFailure } from './failureModes.js';

export const RECOVERY_SCHEMA = 'fbt.access-recovery.v1';
export const REVOKE_SCOPES = Object.freeze(['key', 'device', 'identity']);
export const REVOCATION_REASONS = Object.freeze([
  'DEVICE_LOST', 'DEVICE_STOLEN', 'USER_REQUEST', 'SUSPECTED_COMPROMISE', 'ROUTINE_ROTATION'
]);

const num = (v) => (v === null || v === undefined || v === '' || typeof v === 'boolean'
  ? null
  : (Number.isFinite(Number(v)) ? Number(v) : null));
const id = (v) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, 64) : null);

/**
 * Raise a revocation from another device.
 * @param {object} opts { scope, identityId, targetDeviceId, targetKeyId, reason, requestedFromDeviceId, identityProven }
 */
export function revokeAccess({
  scope = 'identity',
  identityId = null,
  targetDeviceId = null,
  targetKeyId = null,
  reason = 'USER_REQUEST',
  requestedFromDeviceId = null,
  identityProven = false,
  now = Date.now()
} = {}) {
  if (!REVOKE_SCOPES.includes(scope)) {
    return { ok: false, error: classifyFailure('MISSING_DATA', { detail: 'BAD_SCOPE' }) };
  }
  const who = id(identityId);
  if (!who) return { ok: false, error: classifyFailure('MISSING_DATA', { detail: 'NO_IDENTITY' }) };
  // The one thing that must be proven: it is really this account asking.
  if (identityProven !== true) {
    return { ok: false, error: classifyFailure('USER_AUTHORIZATION_REQUIRED', { detail: 'IDENTITY_NOT_PROVEN' }) };
  }
  if (scope === 'device' && !id(targetDeviceId)) return { ok: false, error: classifyFailure('MISSING_DATA', { detail: 'NO_TARGET_DEVICE' }) };
  if (scope === 'key' && !id(targetKeyId)) return { ok: false, error: classifyFailure('MISSING_DATA', { detail: 'NO_TARGET_KEY' }) };

  return {
    ok: true,
    schema: RECOVERY_SCHEMA,
    // The tombstone. Kept forever; checked on every use.
    tombstone: Object.freeze({
      scope,
      identityId: who,
      deviceId: id(targetDeviceId),
      keyId: id(targetKeyId),
      reason: REVOCATION_REASONS.includes(reason) ? reason : 'USER_REQUEST',
      revokedAt: now,
      // Keys issued before this instant are dead even if the client never
      // heard about the revoke.
      revokesIssuedBefore: now,
      requestedFromDeviceId: id(requestedFromDeviceId),
      permanent: true
    }),
    i18nKey: 'intentAI.recovery.revoked',
    i18nParams: { scope, reason },
    revokedAt: now
  };
}

/** Panic button: kill everything for this identity, no key list required. */
export function revokeEverything({ identityId = null, identityProven = false, requestedFromDeviceId = null, reason = 'DEVICE_LOST', now = Date.now() } = {}) {
  return revokeAccess({ scope: 'identity', identityId, identityProven, requestedFromDeviceId, reason, now });
}

/**
 * The single question every signing path asks.
 * @param {object} key         { id, deviceId, identityId, issuedAt, expiresAt }
 * @param {Array}  tombstones  every revocation ever recorded for this identity
 */
export function assertKeyUsable(key = {}, tombstones = [], { now = Date.now() } = {}) {
  const keyId = id(key?.id ?? key?.keyId);
  const deviceId = id(key?.deviceId);
  const identityId = id(key?.identityId);
  const issuedAt = num(key?.issuedAt);
  if (!keyId || !identityId) {
    return { ok: false, usable: false, reason: 'KEY_INCOMPLETE', error: classifyFailure('MISSING_DATA', { detail: 'KEY_INCOMPLETE' }) };
  }
  if (num(key?.expiresAt) !== null && now > key.expiresAt) {
    return { ok: false, usable: false, reason: 'KEY_EXPIRED', error: classifyFailure('SESSION_KEY_EXPIRED', { detail: keyId }) };
  }
  const rows = (Array.isArray(tombstones) ? tombstones : []).map((t) => t?.tombstone || t).filter(Boolean);
  for (const t of rows) {
    if (id(t.identityId) !== identityId) continue;
    const coversTime = num(t.revokesIssuedBefore) === null || issuedAt === null || issuedAt <= t.revokesIssuedBefore;
    const hit =
      (t.scope === 'identity' && coversTime)
      || (t.scope === 'device' && id(t.deviceId) === deviceId && coversTime)
      || (t.scope === 'key' && id(t.keyId) === keyId);
    if (hit) {
      return {
        ok: false,
        usable: false,
        reason: 'KEY_REVOKED',
        revokedAt: t.revokedAt,
        revocationScope: t.scope,
        i18nKey: 'intentAI.recovery.keyDead',
        error: classifyFailure('SESSION_KEY_REVOKED', { detail: `${t.scope}:${t.reason}` })
      };
    }
  }
  return { ok: true, usable: true, keyId, checkedAt: now };
}

/**
 * Apply a revocation to a set of keys and report exactly what died.
 * Used by the UI to say "4 keys on 2 devices were revoked".
 */
export function applyRevocation({ keys = [], tombstones = [], now = Date.now() } = {}) {
  const rows = (Array.isArray(keys) ? keys : []).map((key) => {
    const verdict = assertKeyUsable(key, tombstones, { now });
    return { keyId: id(key?.id ?? key?.keyId), deviceId: id(key?.deviceId), usable: verdict.usable === true, reason: verdict.reason || null };
  });
  const dead = rows.filter((r) => r.usable === false);
  return {
    ok: true,
    schema: RECOVERY_SCHEMA,
    keys: rows,
    revokedCount: dead.length,
    remainingUsable: rows.length - dead.length,
    devicesAffected: [...new Set(dead.map((r) => r.deviceId).filter(Boolean))],
    i18nKey: 'intentAI.recovery.summary',
    i18nParams: { revoked: dead.length, remaining: rows.length - dead.length },
    appliedAt: now
  };
}

/** Fail-closed guard: after a revoke, no key in scope may still be usable. */
export function assertNothingSurvives({ keys = [], tombstones = [], now = Date.now() } = {}) {
  const survivors = (Array.isArray(keys) ? keys : [])
    .filter((key) => assertKeyUsable(key, tombstones, { now }).usable === true)
    .map((key) => id(key?.id ?? key?.keyId));
  return survivors.length
    ? { ok: false, survivors, error: classifyFailure('SESSION_KEY_REVOKED', { detail: `SURVIVED:${survivors.join(',')}` }) }
    : { ok: true, survivors: [] };
}
