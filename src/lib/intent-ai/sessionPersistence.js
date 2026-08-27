/**
 * FBT INTENT AI — PHASE 63: SESSION PERSISTENCE
 * ---------------------------------------------------------------------------
 * A reload is not amnesia. Losing an Intent AI session on refresh means losing
 * the drafts, the gate decisions and — worst of all — the STOPPED flag, which
 * is the one piece of state that must survive everything.
 *
 * This is client-side encrypted persistence with three rules:
 *
 *   · SAFETY STATE SURVIVES EXACTLY. `status: 'STOPPED'`, active controls and
 *     granted permissions are restored verbatim. A restore can only ever be
 *     as permissive as the snapshot, never more; anything unrecognised is
 *     dropped rather than guessed.
 *   · NO SECRETS. Keys, seeds and signatures are stripped before the snapshot
 *     is written. A persisted session can be stolen; it must be worth nothing.
 *   · CORRUPT DATA IS A CLEAN START. A snapshot that does not decrypt, does
 *     not parse, or fails its integrity check produces a fresh session and an
 *     honest notice — never a crash and never a half-restored session.
 */

import { classifyFailure } from './failureModes.js';

export const PERSISTENCE_SCHEMA = 'fbt.session-persistence.v1';
export const SNAPSHOT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

/** Fields that are never written to disk, whatever the caller passes. */
export const FORBIDDEN_FIELDS = Object.freeze([
  'privateKey', 'mnemonic', 'seed', 'seedPhrase', 'signature', 'signedPayload',
  'sessionKeySecret', 'apiKey', 'token', 'password', 'secret'
]);

/** Session fields that are restored verbatim because they constrain behaviour. */
export const SAFETY_FIELDS = Object.freeze(['status', 'level', 'policy', 'controls', 'permissions', 'stoppedAt', 'stopReason']);

const num = (v) => (v === null || v === undefined || v === '' || typeof v === 'boolean'
  ? null
  : (Number.isFinite(Number(v)) ? Number(v) : null));

/** Recursively remove anything that looks like a credential. */
export function stripSecrets(value, depth = 0) {
  if (depth > 8 || value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((row) => stripSecrets(row, depth + 1));
  const out = {};
  for (const [k, v] of Object.entries(value)) {
    if (FORBIDDEN_FIELDS.some((bad) => k.toLowerCase().includes(bad.toLowerCase()))) continue;
    out[k] = stripSecrets(v, depth + 1);
  }
  return out;
}

/** A cheap, dependency-free integrity digest over the serialised snapshot. */
export function snapshotDigest(text) {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  const s = String(text);
  for (let i = 0; i < s.length; i += 1) {
    const c = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 + c + i, 0x85ebca6b) >>> 0;
  }
  return `${h1.toString(16).padStart(8, '0')}${h2.toString(16).padStart(8, '0')}`;
}

/**
 * Build the snapshot. Pure — the caller decides where the bytes go.
 */
export function buildSnapshot({ session = null, messages = [], drafts = [], gates = [], now = Date.now() } = {}) {
  if (!session || typeof session !== 'object') {
    return { ok: false, error: classifyFailure('MISSING_DATA', { detail: 'NO_SESSION' }) };
  }
  const safe = stripSecrets({
    session,
    messages: (Array.isArray(messages) ? messages : []).slice(-120),
    drafts: (Array.isArray(drafts) ? drafts : []).slice(-20),
    gates: (Array.isArray(gates) ? gates : []).slice(-20)
  });
  const payload = { schema: PERSISTENCE_SCHEMA, savedAt: now, data: safe };
  const body = JSON.stringify(payload);
  return {
    ok: true,
    schema: PERSISTENCE_SCHEMA,
    payload,
    body,
    digest: snapshotDigest(body),
    // The proof that the strip actually happened.
    containsSecrets: FORBIDDEN_FIELDS.some((bad) => new RegExp(`"[^"]*${bad}[^"]*"\\s*:`, 'i').test(body)),
    savedAt: now
  };
}

/**
 * Encrypt a snapshot with AES-GCM under a key derived from a device secret.
 * @param {object} crypto  a WebCrypto-compatible object (globalThis.crypto)
 */
export async function encryptSnapshot({ snapshot = null, deviceSecret = null, crypto = globalThis.crypto } = {}) {
  if (!snapshot?.ok) return { ok: false, error: classifyFailure('MISSING_DATA', { detail: 'NO_SNAPSHOT' }) };
  if (typeof deviceSecret !== 'string' || deviceSecret.length < 16) {
    return { ok: false, error: classifyFailure('MISSING_DATA', { detail: 'WEAK_DEVICE_SECRET' }) };
  }
  if (!crypto?.subtle) return { ok: false, error: classifyFailure('PROVIDER_ERROR', { detail: 'NO_WEBCRYPTO' }) };
  const enc = new TextEncoder();
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const base = await crypto.subtle.importKey('raw', enc.encode(deviceSecret), 'PBKDF2', false, ['deriveKey']);
  const key = await crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: 120_000, hash: 'SHA-256' },
    base, { name: 'AES-GCM', length: 256 }, false, ['encrypt']
  );
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(snapshot.body)));
  const b64 = (u8) => Buffer.from(u8).toString('base64');
  return {
    ok: true,
    schema: PERSISTENCE_SCHEMA,
    // No plaintext anywhere in the record.
    envelope: { v: 1, salt: b64(salt), iv: b64(iv), ct: b64(cipher), digest: snapshot.digest },
    savedAt: snapshot.savedAt
  };
}

/** Decrypt and validate. Anything wrong yields a CLEAN START, not a throw. */
export async function restoreSnapshot({ envelope = null, deviceSecret = null, crypto = globalThis.crypto, now = Date.now(), maxAgeMs = SNAPSHOT_MAX_AGE_MS } = {}) {
  const cleanStart = (detail) => ({
    ok: false,
    schema: PERSISTENCE_SCHEMA,
    // The contract: a bad snapshot is a fresh session, never a crash.
    cleanStart: true,
    session: null,
    i18nKey: 'intentAI.persistence.cleanStart',
    error: classifyFailure('MISSING_DATA', { detail })
  });

  if (!envelope || typeof envelope !== 'object' || !envelope.ct) return cleanStart('NO_SNAPSHOT');
  if (typeof deviceSecret !== 'string' || deviceSecret.length < 16) return cleanStart('WEAK_DEVICE_SECRET');
  if (!crypto?.subtle) return cleanStart('NO_WEBCRYPTO');

  let text = null;
  try {
    const dec = new TextDecoder();
    const enc = new TextEncoder();
    const u8 = (b64) => new Uint8Array(Buffer.from(String(b64), 'base64'));
    const base = await crypto.subtle.importKey('raw', enc.encode(deviceSecret), 'PBKDF2', false, ['deriveKey']);
    const key = await crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt: u8(envelope.salt), iterations: 120_000, hash: 'SHA-256' },
      base, { name: 'AES-GCM', length: 256 }, false, ['decrypt']
    );
    text = dec.decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: u8(envelope.iv) }, key, u8(envelope.ct)));
  } catch {
    return cleanStart('DECRYPT_FAILED');
  }

  if (envelope.digest && snapshotDigest(text) !== envelope.digest) return cleanStart('INTEGRITY_FAILED');

  let payload = null;
  try {
    payload = JSON.parse(text);
  } catch {
    return cleanStart('PARSE_FAILED');
  }
  if (payload?.schema !== PERSISTENCE_SCHEMA || !payload.data?.session) return cleanStart('SCHEMA_MISMATCH');
  if (num(payload.savedAt) === null || now - payload.savedAt > maxAgeMs) return cleanStart('SNAPSHOT_EXPIRED');

  const restored = stripSecrets(payload.data);
  return {
    ok: true,
    schema: PERSISTENCE_SCHEMA,
    cleanStart: false,
    session: restored.session,
    messages: Array.isArray(restored.messages) ? restored.messages : [],
    drafts: Array.isArray(restored.drafts) ? restored.drafts : [],
    gates: Array.isArray(restored.gates) ? restored.gates : [],
    // Restoring is never a re-authorization: every confirmation is taken again.
    executionAuthorized: false,
    requiresReconfirmation: true,
    savedAt: payload.savedAt,
    restoredAt: now
  };
}

/**
 * Fail-closed guard: a restore may never be more permissive than the snapshot.
 * A STOPPED session that comes back running is the failure this catches.
 */
export function assertRestoreNotEscalated(snapshotSession, restoredSession) {
  const reasons = [];
  const before = snapshotSession || {};
  const after = restoredSession || {};
  if (before.status === 'STOPPED' && after.status !== 'STOPPED') reasons.push('STOP_LOST_ON_RESTORE');
  if (num(after.level) !== null && num(before.level) !== null && after.level > before.level) reasons.push('LEVEL_ESCALATED');
  const cap = (s) => num(s?.policy?.maxTransactionUsd);
  if (cap(after) !== null && cap(before) !== null && cap(after) > cap(before)) reasons.push('TX_CAP_WIDENED');
  const capital = (s) => num(s?.policy?.maxCapitalUsd);
  if (capital(after) !== null && capital(before) !== null && capital(after) > capital(before)) reasons.push('CAPITAL_CAP_WIDENED');
  const perms = (s) => (Array.isArray(s?.permissions) ? s.permissions : []);
  if (perms(after).some((p) => !perms(before).includes(p))) reasons.push('PERMISSION_GAINED_ON_RESTORE');
  return reasons.length
    ? { ok: false, reasons, error: classifyFailure('USER_AUTHORIZATION_REQUIRED', { detail: reasons.join(',') }) }
    : { ok: true, reasons: [] };
}
