/**
 * FBT INTENT AI — PHASE 69: AGENT PROTOCOL v2
 * ---------------------------------------------------------------------------
 * A directory is not a protocol. Listing an external agent says nothing about
 * whether the bytes arriving from it can be trusted. v2 adds a real handshake:
 * both sides state a protocol version, exchange a nonce, and sign.
 *
 *   · every message is signed and versioned; an UNSIGNED message is rejected
 *     fail-closed — not "accepted with a warning"
 *   · nonces are single-use, so a captured message cannot be replayed
 *   · version negotiation picks the highest COMMON version; no overlap means
 *     no session, never a silent downgrade to an unversioned mode
 *   · a session grants capabilities, never authority to execute — everything
 *     an agent asks for still goes through the confirmation gate
 */

import { classifyFailure } from './failureModes.js';
import { digest } from './onchainReceipt.js';

export const HANDSHAKE_SCHEMA = 'fbt.agent-protocol.v2';
export const PROTOCOL_VERSIONS = Object.freeze(['2.1', '2.0']);
export const MIN_PROTOCOL_VERSION = '2.0';
export const HANDSHAKE_TTL_MS = 5 * 60 * 1000;
export const SESSION_TTL_MS = 30 * 60 * 1000;
export const NONCE_BYTES = 16;

export const MESSAGE_KINDS = Object.freeze(['hello', 'accept', 'request', 'response', 'close']);

const num = (v) => (v === null || v === undefined || v === '' || typeof v === 'boolean'
  ? null
  : (Number.isFinite(Number(v)) ? Number(v) : null));

function randomNonce() {
  const bytes = new Uint8Array(NONCE_BYTES);
  if (globalThis.crypto?.getRandomValues) globalThis.crypto.getRandomValues(bytes);
  else for (let i = 0; i < bytes.length; i += 1) bytes[i] = Math.floor(Math.random() * 256);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/** The exact bytes both sides sign. Order matters, so both derive the same. */
export function canonicalPayload(message) {
  const m = message || {};
  return JSON.stringify({
    schema: HANDSHAKE_SCHEMA,
    version: m.version ?? null,
    kind: m.kind ?? null,
    from: m.from ?? null,
    to: m.to ?? null,
    nonce: m.nonce ?? null,
    sessionId: m.sessionId ?? null,
    body: m.body ?? null,
    at: m.at ?? null
  });
}

/** Sign an outgoing message. No signer, no message — we do not send unsigned. */
export function signMessage(message, { sign = null } = {}) {
  if (typeof sign !== 'function') {
    return { ok: false, message: null, error: classifyFailure('MISSING_DATA', { detail: 'NO_SIGNER' }) };
  }
  const payload = canonicalPayload(message);
  let signature = null;
  try { signature = sign(payload); } catch { signature = null; }
  if (typeof signature !== 'string' || signature.length < 8) {
    return { ok: false, message: null, error: classifyFailure('MISSING_DATA', { detail: 'SIGNING_FAILED' }) };
  }
  return { ok: true, message: Object.freeze({ ...message, schema: HANDSHAKE_SCHEMA, payloadHash: digest(payload), signature }) };
}

/**
 * Verify an incoming message. This is the fail-closed door of the protocol:
 * anything unsigned, unversioned, replayed or stale is rejected.
 */
export function verifyMessage(message, {
  verify = null, expectedFrom = null, seenNonces = null, now = Date.now(), ttlMs = HANDSHAKE_TTL_MS
} = {}) {
  const reject = (reason, code = 'MISSING_DATA') => ({
    ok: false, accepted: false, reason,
    i18nKey: 'intentAI.protocol.rejected',
    error: classifyFailure(code, { detail: reason })
  });
  if (!message || typeof message !== 'object') return reject('NOT_A_MESSAGE');
  if (message.schema !== HANDSHAKE_SCHEMA) return reject('WRONG_SCHEMA');
  if (!MESSAGE_KINDS.includes(message.kind)) return reject('UNKNOWN_KIND');
  if (!PROTOCOL_VERSIONS.includes(message.version)) return reject('UNSUPPORTED_VERSION');
  // The whole point of v2.
  if (typeof message.signature !== 'string' || message.signature.length < 8) return reject('UNSIGNED_MESSAGE');
  if (typeof message.nonce !== 'string' || message.nonce.length < 8) return reject('NO_NONCE');
  const at = num(message.at);
  if (at === null) return reject('NO_TIMESTAMP');
  if (Math.abs(now - at) > (num(ttlMs) ?? HANDSHAKE_TTL_MS)) return reject('STALE_MESSAGE', 'DEADLINE_PASSED');
  if (expectedFrom && message.from !== expectedFrom) return reject('WRONG_SENDER');
  if (seenNonces?.has?.(message.nonce)) return reject('REPLAYED_NONCE');
  if (typeof verify !== 'function') return reject('NO_VERIFIER');
  let valid = false;
  try { valid = verify(canonicalPayload(message), message.signature, message.from) === true; } catch { valid = false; }
  if (!valid) return reject('BAD_SIGNATURE');
  if (digest(canonicalPayload(message)) !== message.payloadHash) return reject('PAYLOAD_TAMPERED');
  seenNonces?.add?.(message.nonce);
  return { ok: true, accepted: true, from: message.from, kind: message.kind, version: message.version, nonce: message.nonce };
}

/** Highest common version, or nothing. Never an unversioned fallback. */
export function negotiateVersion(theirs = []) {
  const list = Array.isArray(theirs) ? theirs.filter((v) => typeof v === 'string') : [];
  const common = PROTOCOL_VERSIONS.filter((v) => list.includes(v));
  if (!common.length) {
    return { ok: false, version: null, i18nKey: 'intentAI.protocol.versionMismatch', error: classifyFailure('MISSING_DATA', { detail: 'NO_COMMON_VERSION' }) };
  }
  return { ok: true, version: common[0] };
}

/** Open the handshake: our hello, signed, with a fresh nonce. */
export function startHandshake({ selfId = null, peerId = null, capabilities = [], sign = null, now = Date.now() } = {}) {
  if (!selfId || !peerId) {
    return { ok: false, error: classifyFailure('MISSING_DATA', { detail: 'NO_PEER' }) };
  }
  const hello = {
    version: PROTOCOL_VERSIONS[0],
    kind: 'hello',
    from: selfId,
    to: peerId,
    nonce: randomNonce(),
    sessionId: null,
    body: { versions: PROTOCOL_VERSIONS, capabilities: (Array.isArray(capabilities) ? capabilities : []).slice(0, 16) },
    at: now
  };
  const signed = signMessage(hello, { sign });
  return signed.ok
    ? { ok: true, hello: signed.message, expiresAt: now + HANDSHAKE_TTL_MS }
    : { ok: false, hello: null, error: signed.error };
}

/**
 * Complete the handshake from the peer's reply. A session is capability-scoped
 * and time-bounded, and it authorizes nothing on its own.
 */
export function completeHandshake({
  hello = null, reply = null, verify = null, seenNonces = null, grantedCapabilities = [], now = Date.now()
} = {}) {
  const checked = verifyMessage(reply, { verify, expectedFrom: hello?.to, seenNonces, now });
  if (!checked.ok) {
    return { ok: false, session: null, reason: checked.reason, i18nKey: 'intentAI.protocol.handshakeFailed', error: checked.error };
  }
  if (reply.kind !== 'accept') {
    return { ok: false, session: null, reason: 'NOT_AN_ACCEPT', i18nKey: 'intentAI.protocol.handshakeFailed', error: classifyFailure('MISSING_DATA', { detail: 'NOT_AN_ACCEPT' }) };
  }
  if (reply.body?.replyTo !== hello?.nonce) {
    // A reply that does not answer OUR hello is somebody else's traffic.
    return { ok: false, session: null, reason: 'NONCE_NOT_ECHOED', i18nKey: 'intentAI.protocol.handshakeFailed', error: classifyFailure('MISSING_DATA', { detail: 'NONCE_NOT_ECHOED' }) };
  }
  const negotiated = negotiateVersion(reply.body?.versions || [reply.version]);
  if (!negotiated.ok) return { ok: false, session: null, reason: 'NO_COMMON_VERSION', i18nKey: 'intentAI.protocol.versionMismatch', error: negotiated.error };
  const asked = Array.isArray(reply.body?.capabilities) ? reply.body.capabilities : [];
  const granted = asked.filter((c) => (Array.isArray(grantedCapabilities) ? grantedCapabilities : []).includes(c));
  return {
    ok: true,
    session: Object.freeze({
      schema: HANDSHAKE_SCHEMA,
      sessionId: digest(`${hello.nonce}|${reply.nonce}`),
      peerId: reply.from,
      version: negotiated.version,
      capabilities: Object.freeze(granted),
      // A session is a channel, not a mandate.
      executionAuthorized: false,
      requiresConfirmationGate: true,
      establishedAt: now,
      expiresAt: now + SESSION_TTL_MS
    }),
    i18nKey: 'intentAI.protocol.established'
  };
}

/** Is this session still allowed to carry this request? */
export function assertSessionUsable(session, { capability = null, now = Date.now() } = {}) {
  if (!session || session.schema !== HANDSHAKE_SCHEMA) {
    return { ok: false, usable: false, reason: 'NOT_A_SESSION', error: classifyFailure('MISSING_DATA', { detail: 'NOT_A_SESSION' }) };
  }
  if (now >= num(session.expiresAt)) {
    return { ok: false, usable: false, reason: 'SESSION_EXPIRED', i18nKey: 'intentAI.protocol.expired', error: classifyFailure('SESSION_KEY_EXPIRED', { detail: 'AGENT_SESSION_EXPIRED' }) };
  }
  if (capability && !session.capabilities.includes(capability)) {
    return { ok: false, usable: false, reason: 'CAPABILITY_NOT_GRANTED', i18nKey: 'intentAI.protocol.notPermitted', error: classifyFailure('GUARDIAN_REJECTED', { detail: capability }) };
  }
  if (session.executionAuthorized === true) {
    return { ok: false, usable: false, reason: 'SESSION_CLAIMS_AUTHORITY', error: classifyFailure('GUARDIAN_REJECTED', { detail: 'SESSION_CLAIMS_AUTHORITY' }) };
  }
  return { ok: true, usable: true, executionAuthorized: false, requiresConfirmationGate: true };
}
