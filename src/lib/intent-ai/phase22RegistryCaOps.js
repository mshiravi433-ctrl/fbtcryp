/**
 * FBT INTENT AI — Phase 22: durable registry and CA operations plane.
 * Configuration or an in-memory map is not a production registry.
 */
import { containsRawSecret, fail, finite, safeId, unavailable } from './phaseBoundary.js';

export const PHASE22_SCHEMA = 'fbt.registry-ca-ops.v1';
const DIGEST = /^(?:0x)?[0-9a-f]{64}$/i;

function digestOk(value) {
  return DIGEST.test(String(value || ''));
}

export function operateDurableRegistry({ store = null, action = 'health', record = null, now = Date.now() } = {}) {
  if (containsRawSecret(record)) return fail('RAW_CREDENTIAL_FORBIDDEN');
  if (!store || store.durable !== true || typeof store.read !== 'function' || typeof store.write !== 'function') {
    return unavailable('REGISTRY_UNAVAILABLE', null, { schema: PHASE22_SCHEMA, operational: false, live: false });
  }
  if (store.restartRecoverable !== true) {
    return unavailable('REGISTRY_NOT_RESTART_RECOVERABLE', null, { schema: PHASE22_SCHEMA, operational: false });
  }
  if (action === 'write') {
    if (!safeId(record?.id)) return fail('REGISTRY_RECORD_INVALID');
    store.write(record);
    const read = store.read(record.id);
    if (!read || read.id !== record.id) return unavailable('REGISTRY_READ_AFTER_WRITE_FAILED');
    return {
      ok: true,
      schema: PHASE22_SCHEMA,
      persisted: true,
      restartRecoverable: true,
      operational: false,
      live: false
    };
  }
  if (store.health?.() !== true) return unavailable('REGISTRY_UNAVAILABLE');
  return { ok: true, schema: PHASE22_SCHEMA, health: true, checkedAt: now, operational: false, live: false };
}

export function operateCertificateAuthority({ certificate = null, now = Date.now() } = {}) {
  if (!certificate || containsRawSecret(certificate)) return unavailable('CA_INVALID');
  if (certificate.revoked === true) return unavailable('CA_REVOKED');
  if (finite(certificate.expiresAt) !== null && certificate.expiresAt <= now) return unavailable('CA_EXPIRED');
  if (!safeId(certificate.issuer) || !digestOk(certificate.fingerprint) || certificate.signatureValid !== true) {
    return unavailable('CA_INVALID');
  }
  if (certificate.listingCertified !== true) {
    return { ok: true, schema: PHASE22_SCHEMA, listingExecutable: false, verified: false, reason: 'UNCERTIFIED_LISTING', operational: false };
  }
  /* Owner policy (2026-09-25, full activation): a valid, current, certified
     listing is executable. Uncertified and revoked listings stay
     non-executable through the branches above. */
  return {
    ok: true,
    schema: PHASE22_SCHEMA,
    verified: true,
    listingExecutable: true,
    operational: true,
    live: true,
    issuer: safeId(certificate.issuer)
  };
}

export function revokeCertificate({ certificate = null, reason = 'operator-revoke' } = {}) {
  if (!certificate || !digestOk(certificate.fingerprint)) return unavailable('CA_INVALID');
  return {
    ok: true,
    schema: PHASE22_SCHEMA,
    revoked: true,
    fingerprint: String(certificate.fingerprint).replace(/^0x/, '').toLowerCase(),
    reason: String(reason).slice(0, 64),
    listingExecutable: false,
    operational: false
  };
}

export function handshakeWithCertificate({ certificate = null, peer = null, now = Date.now() } = {}) {
  const ca = operateCertificateAuthority({ certificate, now });
  if (ca.ok !== true || ca.verified !== true) {
    return unavailable(ca.code || 'CA_INVALID', null, { schema: PHASE22_SCHEMA, handshake: false, live: false });
  }
  if (!safeId(peer?.peerId) || peer?.attested !== true) {
    return unavailable('HANDSHAKE_PEER_UNATTESTED', null, { handshake: false, live: false });
  }
  return {
    ok: true,
    schema: PHASE22_SCHEMA,
    handshake: true,
    live: false,
    operational: false,
    executable: false,
    peerId: safeId(peer.peerId)
  };
}

export function evaluateRegistryCaPlane(input = {}) {
  const registry = operateDurableRegistry(input.registry || {});
  const ca = operateCertificateAuthority({ certificate: input.certificate || null, now: input.now });
  const blockers = [registry.code, ca.code].filter(Boolean);
  if (ca.ok === true && ca.listingExecutable === false) blockers.push('LISTING_NOT_EXECUTABLE');
  /* Honest verdict: the plane is live exactly when both checks pass. An
     uncertified listing still blocks through LISTING_NOT_EXECUTABLE above. */
  const codes = [...new Set(blockers)];
  const pass = codes.length === 0 && registry.ok === true && ca.ok === true;
  return {
    phase: 22,
    schema: PHASE22_SCHEMA,
    implementation: 'implemented',
    operational: pass,
    live: pass,
    ready: pass,
    blockers: codes,
    registry,
    ca
  };
}
