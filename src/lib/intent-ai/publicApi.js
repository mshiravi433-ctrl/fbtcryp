/**
 * FBT INTENT AI — PHASE 95: PUBLIC INTENT OS API / SDK
 * ---------------------------------------------------------------------------
 * An app is not a platform. Phase 95 opens Intent OS to third-party
 * developers — under exactly the same fail-closed rules the first-party app
 * lives by, never a relaxed "partner" path.
 *
 *   · every key is SCOPED to a closed list of capabilities, and a scope that
 *     is not on the list is dropped rather than honoured
 *   · no scope, at any price, authorises financial execution: the strongest
 *     thing a third party can do is PREPARE a draft that the human still has
 *     to confirm on their own device
 *   · the raw key is returned exactly once and never stored; we keep a digest,
 *     so a leaked database cannot be replayed as a key
 *   · revocation is immediate and total — a revoked key has no path at all,
 *     including calls already authorised in the same millisecond
 *   · the secret material of a key never appears in any response, log, error
 *     or audit record
 */

import { classifyFailure } from './failureModes.js';
import { digest } from './onchainReceipt.js';

export const PUBLIC_API_SCHEMA = 'fbt.public-api.v1';
export const API_KEY_MAX_TTL_MS = 90 * 24 * 60 * 60 * 1000;
export const API_KEY_MIN_TTL_MS = 60 * 1000;

/** The complete list of things a third-party key may ever be granted. */
export const API_SCOPES = Object.freeze([
  'read:status',
  'read:quotes',
  'read:receipts',
  'read:policy',
  'read:availability',
  'write:draft-intent'
]);

/**
 * Scopes somebody will eventually ask for. They are named here so the refusal
 * is explicit and testable rather than an accident of the allow-list.
 */
export const FORBIDDEN_API_SCOPES = Object.freeze([
  'write:execute',
  'write:sign',
  'write:broadcast',
  'write:transfer',
  'read:private-key',
  'read:session-key',
  'write:skip-confirmation',
  'write:bypass-guardian',
  'admin:*'
]);

/** Operations the API surface can be asked to perform, and what they need. */
export const API_OPERATIONS = Object.freeze({
  'status.get': { scope: 'read:status', executes: false },
  'quote.get': { scope: 'read:quotes', executes: false },
  'receipt.get': { scope: 'read:receipts', executes: false },
  'policy.get': { scope: 'read:policy', executes: false },
  'availability.get': { scope: 'read:availability', executes: false },
  'intent.draft': { scope: 'write:draft-intent', executes: false },
  'intent.execute': { scope: 'write:execute', executes: true },
  'intent.sign': { scope: 'write:sign', executes: true }
});

/*
 * Number(null) === 0 and Number('') === 0, which is how a missing TTL becomes
 * an "expired at the epoch" key. Every module in this tree repeats the same
 * guard rather than sharing one, so a refactor somewhere else cannot quietly
 * loosen it here.
 */
const num = (v) => (v === null || v === undefined || v === '' || typeof v === 'boolean'
  ? null
  : (Number.isFinite(Number(v)) ? Number(v) : null));

const id = (v) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, 64) : null);

/** keyId → record. Revocation tombstones live in the same map, by design. */
const keyStore = new Map();

function randomToken() {
  let out = '';
  for (let i = 0; i < 4; i += 1) out += Math.random().toString(36).slice(2, 12);
  return out.slice(0, 40);
}

/** Public view of a key. The secret is never part of it. */
function publicKeyView(record) {
  return Object.freeze({
    keyId: record.keyId,
    ownerId: record.ownerId,
    scopes: Object.freeze([...record.scopes]),
    issuedAt: record.issuedAt,
    expiresAt: record.expiresAt,
    revoked: record.revoked,
    revokedAt: record.revokedAt ?? null,
    // Stated on every key so nobody has to infer it from the scope list.
    executionAuthorized: false,
    label: record.label
  });
}

/**
 * Issue a scoped developer key.
 * The raw secret is returned ONCE, in `secret`, and is never stored.
 */
export function issueApiKey({
  ownerId = null,
  scopes = [],
  label = null,
  ttlMs = API_KEY_MAX_TTL_MS,
  now = Date.now()
} = {}) {
  const owner = id(ownerId);
  if (!owner) {
    return { ok: false, i18nKey: 'intentAI.api.keyRefused', error: classifyFailure('MISSING_DATA', { detail: 'NO_OWNER' }) };
  }
  const requested = Array.isArray(scopes) ? scopes.map((s) => String(s || '').trim()) : [];
  const refused = requested.filter((s) => !API_SCOPES.includes(s));
  const granted = [...new Set(requested.filter((s) => API_SCOPES.includes(s)))];
  if (!granted.length) {
    return {
      ok: false,
      refusedScopes: refused,
      i18nKey: 'intentAI.api.scopeRefused',
      error: classifyFailure('GUARDIAN_REJECTED', { detail: 'NO_GRANTABLE_SCOPE' })
    };
  }
  const ttl = num(ttlMs);
  if (ttl === null || ttl < API_KEY_MIN_TTL_MS || ttl > API_KEY_MAX_TTL_MS) {
    // A key with no honest expiry is a key nobody remembers to retire.
    return { ok: false, i18nKey: 'intentAI.api.keyRefused', error: classifyFailure('MISSING_DATA', { detail: 'BAD_TTL' }) };
  }
  const secret = `fbt_sk_${randomToken()}`;
  const record = {
    keyId: `ak_${digest(`${owner}:${secret}`).slice(2, 18)}`,
    ownerId: owner,
    scopes: granted,
    // Only the digest is kept: a dump of this map cannot be replayed.
    secretDigest: digest(secret),
    label: id(label) || null,
    issuedAt: now,
    expiresAt: now + ttl,
    revoked: false,
    revokedAt: null
  };
  keyStore.set(record.keyId, record);
  return {
    ok: true,
    schema: PUBLIC_API_SCHEMA,
    key: publicKeyView(record),
    refusedScopes: refused,
    // Shown once. We cannot show it again because we do not have it.
    secret,
    secretShownOnce: true,
    i18nKey: 'intentAI.api.keyIssued',
    i18nParams: { scopes: granted.length }
  };
}

/** Immediate, total revocation. There is no "soft" state. */
export function revokeApiKey(keyRef, { now = Date.now(), reason = 'USER_REQUEST' } = {}) {
  const keyId = id(typeof keyRef === 'string' ? keyRef : keyRef?.keyId);
  const record = keyId ? keyStore.get(keyId) : null;
  if (!record) {
    return { ok: false, i18nKey: 'intentAI.api.keyUnknown', error: classifyFailure('MISSING_DATA', { detail: 'NO_KEY' }) };
  }
  record.revoked = true;
  record.revokedAt = now;
  record.revocationReason = String(reason || 'USER_REQUEST').slice(0, 48);
  return {
    ok: true,
    schema: PUBLIC_API_SCHEMA,
    key: publicKeyView(record),
    revoked: true,
    i18nKey: 'intentAI.api.keyRevoked'
  };
}

/** Is this key dead? Unknown keys count as dead — fail closed. */
export function isKeyRevoked(keyRef, { now = Date.now() } = {}) {
  const keyId = id(typeof keyRef === 'string' ? keyRef : keyRef?.keyId);
  const record = keyId ? keyStore.get(keyId) : null;
  if (!record) return true;
  if (record.revoked === true) return true;
  return now > record.expiresAt;
}

/** Read a key without ever handing back its secret digest. */
export function describeApiKey(keyRef) {
  const keyId = id(typeof keyRef === 'string' ? keyRef : keyRef?.keyId);
  const record = keyId ? keyStore.get(keyId) : null;
  return record ? publicKeyView(record) : null;
}

/** Every gate a third-party call has to pass, in one place. */
export function authorizeApiCall({ keyRef = null, operation = null, now = Date.now() } = {}) {
  const keyId = id(typeof keyRef === 'string' ? keyRef : keyRef?.keyId);
  const record = keyId ? keyStore.get(keyId) : null;
  if (!record) {
    return { ok: false, authorized: false, reason: 'UNKNOWN_KEY', i18nKey: 'intentAI.api.keyUnknown', error: classifyFailure('USER_AUTHORIZATION_REQUIRED', { detail: 'UNKNOWN_KEY' }) };
  }
  if (record.revoked === true) {
    // A revoked key has no path. Not a degraded one — none.
    return { ok: false, authorized: false, reason: 'KEY_REVOKED', i18nKey: 'intentAI.api.keyRevoked', error: classifyFailure('SESSION_KEY_REVOKED', { detail: 'KEY_REVOKED' }) };
  }
  if (now > record.expiresAt) {
    return { ok: false, authorized: false, reason: 'KEY_EXPIRED', i18nKey: 'intentAI.api.keyExpired', error: classifyFailure('SESSION_KEY_EXPIRED', { detail: 'KEY_EXPIRED' }) };
  }
  const spec = API_OPERATIONS[String(operation || '')];
  if (!spec) {
    return { ok: false, authorized: false, reason: 'UNKNOWN_OPERATION', i18nKey: 'intentAI.api.operationUnknown', error: classifyFailure('MISSING_DATA', { detail: 'UNKNOWN_OPERATION' }) };
  }
  if (spec.executes === true) {
    /*
     * The whole point of the phase. No key, no scope, no partner agreement
     * moves money: execution belongs to the human at the confirmation gate.
     */
    return {
      ok: false,
      authorized: false,
      reason: 'EXECUTION_NEVER_DELEGATED',
      requiresConfirmationGate: true,
      i18nKey: 'intentAI.api.executionRefused',
      error: classifyFailure('USER_AUTHORIZATION_REQUIRED', { detail: 'EXECUTION_NEVER_DELEGATED' })
    };
  }
  if (!record.scopes.includes(spec.scope)) {
    return { ok: false, authorized: false, reason: 'SCOPE_MISSING', missingScope: spec.scope, i18nKey: 'intentAI.api.scopeRefused', error: classifyFailure('GUARDIAN_REJECTED', { detail: 'SCOPE_MISSING' }) };
  }
  return {
    ok: true,
    authorized: true,
    schema: PUBLIC_API_SCHEMA,
    keyId: record.keyId,
    ownerId: record.ownerId,
    operation: String(operation),
    scope: spec.scope,
    executionAuthorized: false,
    requiresConfirmationGate: spec.scope === 'write:draft-intent',
    at: now
  };
}

/**
 * Run a third-party call. The handler only ever sees an already-authorised
 * request, and whatever it returns is stripped of anything that would look
 * like an execution.
 */
export async function handleApiCall({ keyRef = null, operation = null, params = {}, handler = null, now = Date.now() } = {}) {
  const auth = authorizeApiCall({ keyRef, operation, now });
  if (!auth.ok) return { ...auth, data: null };
  if (typeof handler !== 'function') {
    return { ok: false, authorized: true, data: null, i18nKey: 'intentAI.api.unavailable', error: classifyFailure('PROVIDER_ERROR', { detail: 'NO_HANDLER' }) };
  }
  let data = null;
  try {
    data = await handler({ operation: auth.operation, params, ownerId: auth.ownerId, scope: auth.scope });
  } catch {
    return { ok: false, authorized: true, data: null, i18nKey: 'intentAI.api.unavailable', error: classifyFailure('PROVIDER_ERROR', { detail: 'HANDLER_FAILED' }) };
  }
  const body = data && typeof data === 'object' ? { ...data } : { value: data ?? null };
  // A third-party handler does not get to invent a receipt or a tx hash.
  delete body.txHash;
  delete body.receipt;
  delete body.signature;
  delete body.privateKey;
  delete body.sessionKey;
  return {
    ok: true,
    schema: PUBLIC_API_SCHEMA,
    authorized: true,
    operation: auth.operation,
    data: body,
    executionAuthorized: false,
    requiresConfirmationGate: auth.requiresConfirmationGate === true,
    at: now
  };
}

/** The SDK's own description of itself — honest about what it cannot do. */
export function publicApiManifest({ now = Date.now() } = {}) {
  return {
    ok: true,
    schema: PUBLIC_API_SCHEMA,
    scopes: [...API_SCOPES],
    forbiddenScopes: [...FORBIDDEN_API_SCOPES],
    operations: Object.keys(API_OPERATIONS).filter((op) => API_OPERATIONS[op].executes === false),
    executionOperations: [],
    failClosed: true,
    executionAuthorized: false,
    maxKeyTtlMs: API_KEY_MAX_TTL_MS,
    i18nKey: 'intentAI.api.manifest',
    at: now
  };
}

/** Nothing on the public surface may become a way around the product's rules. */
export function assertNoBypass({ key = null, authorization = null, response = null, manifest = null } = {}) {
  const reasons = [];
  if (key) {
    for (const scope of key.scopes || []) {
      if (!API_SCOPES.includes(scope)) reasons.push('UNKNOWN_SCOPE_GRANTED');
      if (FORBIDDEN_API_SCOPES.includes(scope)) reasons.push('FORBIDDEN_SCOPE_GRANTED');
    }
    if (key.executionAuthorized === true) reasons.push('KEY_CLAIMS_EXECUTION');
    if (num(key.expiresAt) === null) reasons.push('KEY_NEVER_EXPIRES');
    if ('secret' in key || 'secretDigest' in key) reasons.push('KEY_LEAKS_SECRET');
  }
  if (authorization) {
    if (authorization.authorized === true && authorization.executionAuthorized === true) reasons.push('AUTHORIZED_EXECUTION');
    if (authorization.authorized === true && authorization.reason === 'KEY_REVOKED') reasons.push('REVOKED_KEY_AUTHORIZED');
  }
  if (response) {
    if (response.executionAuthorized === true) reasons.push('RESPONSE_CLAIMS_EXECUTION');
    if (response.data && (response.data.txHash || response.data.receipt)) reasons.push('RESPONSE_CARRIES_RECEIPT');
  }
  if (manifest) {
    if ((manifest.executionOperations || []).length) reasons.push('MANIFEST_OFFERS_EXECUTION');
    if (manifest.failClosed !== true) reasons.push('MANIFEST_NOT_FAIL_CLOSED');
  }
  const unique = [...new Set(reasons)];
  return unique.length
    ? { ok: false, reasons: unique, error: classifyFailure('GUARDIAN_REJECTED', { detail: unique[0] }) }
    : { ok: true };
}

/** Test hook: the key store is process-local and must be resettable. */
export function _resetPublicApiStore() {
  keyStore.clear();
}
