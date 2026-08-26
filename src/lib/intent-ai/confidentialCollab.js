/**
 * FBT INTENT AI — CONFIDENTIAL COLLABORATION (Phase 5)
 * ---------------------------------------------------------------------------
 * A collaboration envelope between agents that REDACTS secrets at the boundary.
 * No plaintext private key, seed, mnemonic, password, api secret, or broker
 * master credential ever travels inside a message.
 *
 * Honesty rule about TEE / commit-reveal / hiding-from-FBT:
 *   These are NOT claimed unless actually implemented. If the prerequisites do
 *   not exist (no real Trusted Execution Environment, no real secret manager,
 *   no real encryption at rest), the capability is reported as `unavailable`
 *   rather than pretending to provide confidentiality or hiding.
 */

import { tokenHasForbiddenKey } from './capabilityToken.js';
import { classifyFailure } from './failureModes.js';

export const CONFIDENTIAL_COLLAB_SCHEMA = 'fbt.confidential-collab.v1';

const FORBIDDEN_REGEX = /privatekey|mnemonic|seed|password|apisecret|mastercredential|walletsecret|signature/i;
const ADDRESS_REGEX = /0x[a-fA-F0-9]{20,}/;

/** True when a payload carries a secret-shaped value. */
export function carriesSecret(payload) {
  if (payload == null) return false;
  // The redaction marker means the secret was already removed — safe.
  if (payload === '[REDACTED]') return false;
  if (typeof payload === 'string') return FORBIDDEN_REGEX.test(payload) || ADDRESS_REGEX.test(payload);
  if (typeof payload === 'number' || typeof payload === 'boolean') return false;
  if (Array.isArray(payload)) return payload.some((v) => carriesSecret(v));
  if (typeof payload === 'object') {
    return Object.entries(payload).some(([k, v]) => {
      if (v === '[REDACTED]') return false;
      return FORBIDDEN_REGEX.test(k) || carriesSecret(v);
    });
  }
  return false;
}

/** Redact a payload, replacing secret-shaped fields with a redaction marker. */
export function redactForCollab(payload) {
  if (payload == null) return null;
  if (typeof payload === 'string') {
    if (FORBIDDEN_REGEX.test(payload) || ADDRESS_REGEX.test(payload)) return '[REDACTED]';
    return payload;
  }
  if (typeof payload !== 'object') return payload;
  if (Array.isArray(payload)) {
    return payload.slice(0, 32).map((v) => redactForCollab(v));
  }
  const out = {};
  for (const [k, v] of Object.entries(payload)) {
    if (FORBIDDEN_REGEX.test(k)) { out[k] = '[REDACTED]'; continue; }
    out[k] = redactForCollab(v);
  }
  return out;
}

/**
 * Build a confidential collaboration envelope. Secrets in `content` are
 * redacted; anything that would carry a raw secret is rejected outright.
 */
export function buildConfidentialEnvelope({ from, to, topic, content = {}, redacted = false } = {}) {
  if (!from || !to) return { ok: false, error: classifyFailure('MISSING_DATA', { detail: 'FROM_TO_REQUIRED' }) };
  if (carriesSecret(content) && !redacted) {
    return { ok: false, error: classifyFailure('GUARDIAN_REJECTED', { detail: 'SECRET_LEAK_BLOCKED' }) };
  }
  const safe = redactForCollab(content);
  if (carriesSecret(safe)) {
    return { ok: false, error: classifyFailure('GUARDIAN_REJECTED', { detail: 'SECRET_LEAK_BLOCKED' }) };
  }
  return {
    ok: true,
    envelope: Object.freeze({
      schema: CONFIDENTIAL_COLLAB_SCHEMA,
      from: String(from).slice(0, 48),
      to: String(to).slice(0, 48),
      topic: String(topic || '').slice(0, 80),
      content: safe,
      redacted: true,
      isCommand: false,
      isExecutable: false,
      ts: Date.now()
    })
  };
}

/**
 * Honest capability report for confidential collaboration. If the required
 * prerequisites (real Secret Manager / TEE / encrypted-at-rest) are not
 * present, these claims are `unavailable`. We never pretend to hide from FBT.
 */
export function confidentialCapabilities(prerequisites = {}) {
  const tee = prerequisites.tee === true;
  const secretManager = prerequisites.secretManager === true;
  const atRestEncryption = prerequisites.atRestEncryption === true;
  return {
    redaction: 'available',
    secretManager: secretManager ? 'available' : 'unavailable',
    tee: tee ? 'available' : 'unavailable',
    commitReveal: tee && secretManager ? 'available' : 'unavailable',
    hideFromFbt: atRestEncryption ? 'available' : 'unavailable',
    honest: true
  };
}
