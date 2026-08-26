/**
 * FBT INTENT AI — Phase 22: durable registry and CA operations plane.
 * Configuration or an in-memory map is not a production registry.
 */
import { containsRawSecret, fail, finite, safeId, unavailable } from './phaseBoundary.js';

export const PHASE22_SCHEMA = 'fbt.registry-ca-ops.v1';
const DIGEST = /^(?:0x)?[0-9a-f]{64}$/i;

export function operateDurableRegistry({ store = null, action = 'health', record = null, now = Date.now() } = {}) {
  if (containsRawSecret(record)) return fail('RAW_CREDENTIAL_FORBIDDEN');
  if (!store || store.durable !== true || typeof store.read !== 'function' || typeof store.write !== 'function') {
    return unavailable('REGISTRY_UNAVAILABLE', null, { schema: PHASE22_SCHEMA, operational: false });
  }
  if (action === 'write') {
    if (!safeId(record?.id)) return fail('REGISTRY_RECORD_INVALID');
    store.write(record);
    const read = store.read(record.id);
    if (!read || read.id !== record.id) return unavailable('REGISTRY_READ_AFTER_WRITE_FAILED');
    return { ok: true, schema: PHASE22_SCHEMA, persisted: true, restartRecoverable: store.restartRecoverable === true, operational: false };
  }
  if (store.health?.() !== true) return unavailable('REGISTRY_UNAVAILABLE');
  return { ok: true, schema: PHASE22_SCHEMA, health: true, checkedAt: now, operational: false, live: false };
}

export function operateCertificateAuthority({ certificate = null, now = Date.now() } = {}) {
  if (!certificate || containsRawSecret(certificate)) return unavailable('CA_INVALID');
  if (certificate.revoked === true) return unavailable('CA_REVOKED');
  if (finite(certificate.expiresAt) !== null && certificate.expiresAt <= now) return unavailable('CA_EXPIRED');
  if (!safeId(certificate.issuer) || !DIGEST.test(String(certificate.fingerprint || '')) || certificate.signatureValid !== true) {
    return unavailable('CA_INVALID');
  }
  if (certificate.listingCertified !== true) {
    return { ok: true, schema: PHASE22_SCHEMA, listingExecutable: false, verified: false, reason: 'UNCERTIFIED_LISTING' };
  }
  return { ok: true, schema: PHASE22_SCHEMA, verified: true, listingExecutable: false, operational: false, issuer: safeId(certificate.issuer) };
}
