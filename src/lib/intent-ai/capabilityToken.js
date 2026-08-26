/**
 * FBT INTENT AI — CAPABILITY TOKEN (Phase 3)
 * ---------------------------------------------------------------------------
 * A bounded, revocable, least-privilege capability token issued to an EXTERNAL
 * agent for a single execution path. It is NOT a master credential: it can be
 * revoked immediately, expires, and is scoped to one policyId + one agentId +
 * an explicit capability set + allowed chains/protocols + a USD cap.
 *
 * Hard rules:
 *   - NEVER carries a raw key, seed, mnemonic, password, or api secret.
 *   - The agent receives only the token's opaque `handle`; the secret-backed
 *     payload is never revealed (`neverExpose` on the Secret Manager stand-in).
 *   - The following capabilities are FORBIDDEN and silently stripped/failed:
 *       withdrawFunds, executeWithoutUser, bypassGuardian,
 *       holdRawCredential, fabricateReceipt.
 *   - A revoked token cannot scope, even if not yet expired.
 */

import { classifyFailure } from './failureModes.js';

/**
 * Capabilities that are NEVER grantable to an external agent. They appear in a
 * request either as a rejected grant or (if the caller tries to smuggle them
 * in an already-issued token) they strip them.
 */
export const FORBIDDEN_CAPABILITY_TOKENS = Object.freeze([
  'withdrawFunds',
  'executeWithoutUser',
  'bypassGuardian',
  'holdRawCredential',
  'fabricateReceipt',
  'unrestrictedSigner',
  'holdPrivateKey',
  'disableAudit'
]);

/** Capabilities that ARE grantable (advice/execution within a bounded plan). */
export const ALLOWED_CAPABILITY_TOKENS = Object.freeze([
  'quote',
  'research',
  'analyze',
  'route',
  'simulate',
  'submit',
  'monitor',
  'exit'
]);

const FORBIDDEN_REGEX = /privatekey|seed|mnemonic|password|apisecret|mastercredential|walletsecret/i;

/** Case-insensitive forbidden-capability match. */
function isForbiddenCapability(c) {
  const normalized = String(c || '').toLowerCase();
  return FORBIDDEN_CAPABILITY_TOKENS.some((f) => f.toLowerCase() === normalized);
}

function capSet(capabilities) {
  const out = [];
  const seen = new Set();
  for (const raw of (capabilities || [])) {
    const s = String(raw || '').trim();
    if (!s || seen.has(s)) continue;
    if (isForbiddenCapability(s)) continue;
    seen.add(s);
    out.push(s);
  }
  return out;
}

function intSet(values, max) {
  const out = [];
  const seen = new Set();
  for (const raw of (values || [])) {
    const id = Number(raw);
    if (!Number.isInteger(id) || id <= 0 || seen.has(id)) continue;
    if (out.length >= max) break;
    seen.add(id);
    out.push(id);
  }
  return out;
}

function protoSet(values, max) {
  const out = [];
  const seen = new Set();
  for (const raw of (values || [])) {
    const s = String(raw || '').toLowerCase().trim();
    if (!s || seen.has(s)) continue;
    if (out.length >= max) break;
    seen.add(s);
    out.push(s);
  }
  return out;
}

/* In-memory token store. The token's SECRET payload lives only here and is
   never exposed to the agent; the agent holds `handle` only. */
const store = new Map();

function sid() {
  return `ct_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Issue a capability token.
 *
 * @param {object} opts
 * @param {string} opts.policyId      policy that bounds this grant
 * @param {string} opts.agentId       the external agent that may use it
 * @param {string[]} opts.capabilities grantable capability names (forbidden ones stripped)
 * @param {number[]} [opts.allowedChains]  chain ids the token may touch
 * @param {string[]} [opts.allowedProtocols] protocols the token may use
 * @param {number} [opts.maxAmountUsd]  USD cap for any single action
 * @param {number} [opts.ttlMs]       expiry, min 60s
 * @param {number} [opts.now]         injectable clock (tests)
 * @returns {{ok:boolean, token?:object, error?:object, forbidden?:string[]}}
 */
export function issueCapabilityToken({
  policyId,
  agentId,
  capabilities,
  allowedChains = [],
  allowedProtocols = [],
  maxAmountUsd = 0,
  ttlMs = 15 * 60 * 1000,
  now = Date.now()
} = {}) {
  if (!policyId) return { ok: false, error: classifyFailure('MISSING_DATA', { detail: 'NO_POLICY_ID' }) };
  if (!agentId) return { ok: false, error: classifyFailure('MISSING_DATA', { detail: 'NO_AGENT_ID' }) };
  if (!Array.isArray(capabilities) || capabilities.length === 0) {
    return { ok: false, error: classifyFailure('MISSING_DATA', { detail: 'NO_CAPABILITIES' }) };
  }
  const forbidden = capabilities.filter((c) => isForbiddenCapability(c));
  const granted = capSet(capabilities);
  if (granted.length === 0) {
    return { ok: false, error: classifyFailure('GUARDIAN_REJECTED', { detail: 'NO_GRANTABLE_CAPABILITY' }), forbidden };
  }
  const token = {
    id: sid(),
    policyId: String(policyId).slice(0, 64),
    agentId: String(agentId).slice(0, 64),
    capabilities: granted,
    allowedChains: intSet(allowedChains, 8),
    allowedProtocols: protoSet(allowedProtocols, 16),
    maxAmountUsd: Math.max(0, Number(maxAmountUsd) || 0),
    issuedAt: now,
    expiresAt: now + Math.max(60_000, Number(ttlMs) || 0),
    revoked: false,
    handle: `handle_ct_${Math.random().toString(36).slice(2, 14)}`
  };
  store.set(token.id, token);
  // The handle is what the agent holds; it maps to the in-memory secret entry.
  store.set(token.handle, token.id);
  return { ok: true, token: publicView(token), forbidden };
}

function publicView(token) {
  return Object.freeze({
    id: token.id,
    policyId: token.policyId,
    agentId: token.agentId,
    capabilities: [...token.capabilities],
    allowedChains: [...token.allowedChains],
    allowedProtocols: [...token.allowedProtocols],
    maxAmountUsd: token.maxAmountUsd,
    issuedAt: token.issuedAt,
    expiresAt: token.expiresAt,
    revoked: token.revoked,
    handle: token.handle
  });
}

function resolve(tokenRef) {
  if (typeof tokenRef === 'string') {
    if (!store.has(tokenRef)) return null;
    const entry = store.get(tokenRef);
    // If the entry is a string it is a handle → token-id pointer.
    return typeof entry === 'string' ? store.get(entry) : entry;
  }
  if (tokenRef && typeof tokenRef === 'object') {
    if (tokenRef.id && store.has(tokenRef.id)) return store.get(tokenRef.id);
    if (tokenRef.handle && store.has(tokenRef.handle)) {
      const entry = store.get(tokenRef.handle);
      return typeof entry === 'string' ? store.get(entry) : entry;
    }
  }
  return null;
}

export function revokeCapabilityToken(tokenRef) {
  const token = resolve(tokenRef);
  if (!token) return { ok: false, error: classifyFailure('MISSING_DATA', { detail: 'NO_TOKEN' }) };
  token.revoked = true;
  token.revokedAt = Date.now();
  return { ok: true, token: publicView(token) };
}

/** Revoke every capability token issued for a policy (Emergency Stop path). */
export function revokeAllForPolicy(policyId) {
  let n = 0;
  for (const entry of store.values()) {
    const token = typeof entry === 'string' ? store.get(entry) : entry;
    if (token && token.policyId === policyId && !token.revoked) {
      token.revoked = true;
      token.revokedAt = Date.now();
      n += 1;
    }
  }
  return n;
}

/**
 * Validate that a token is live and BOUNDS a draft/action. Fail-closed: any
 * missing field, expired token, revoked token, forbidden capability, out-of-
 * scope chain/protocol, or over-cap amount is a rejection.
 *
 * @param {object} tokenRef   public token view (or handle)
 * @param {object} action     { chainId, protocol, amountUsd, capabilities[] }
 * @param {object} [opts]     { now }
 */
export function scopeCapabilityToken(tokenRef, action = {}, opts = {}) {
  const token = resolve(tokenRef);
  if (!token) return { ok: false, error: classifyFailure('MISSING_DATA', { detail: 'NO_TOKEN' }) };
  if (token.revoked) return { ok: false, error: classifyFailure('SESSION_KEY_REVOKED') };
  const now = opts.now || Date.now();
  if (now > token.expiresAt) return { ok: false, error: classifyFailure('SESSION_KEY_EXPIRED') };
  if (typeof action !== 'object' || !action) return { ok: false, error: classifyFailure('MISSING_DATA', { detail: 'NO_ACTION' }) };

  // Forbidden capability on the action itself (defence in depth).
  if (Array.isArray(action.capabilities)) {
    const sneaky = action.capabilities.find((c) => isForbiddenCapability(c));
    if (sneaky) return { ok: false, error: classifyFailure('GUARDIAN_REJECTED', { detail: `FORBIDDEN_CAPABILITY:${sneaky}` }) };
    const unknown = action.capabilities.find((c) => !token.capabilities.includes(String(c).toLowerCase()));
    if (unknown) return { ok: false, error: classifyFailure('GUARDIAN_REJECTED', { detail: `CAPABILITY_OUT_OF_SCOPE:${unknown}` }) };
  }

  if (action.chainId != null && token.allowedChains.length && !token.allowedChains.includes(Number(action.chainId))) {
    return { ok: false, error: classifyFailure('GUARDIAN_REJECTED', { detail: 'CHAIN_OUT_OF_TOKEN_SCOPE' }) };
  }
  if (action.protocol && token.allowedProtocols.length) {
    const proto = String(action.protocol).toLowerCase();
    if (!token.allowedProtocols.includes(proto)) {
      return { ok: false, error: classifyFailure('GUARDIAN_REJECTED', { detail: 'PROTOCOL_OUT_OF_TOKEN_SCOPE' }) };
    }
  }
  const amt = Number(action.amountUsd ?? action.amountIn ?? action.value ?? 0);
  if (Number.isFinite(amt) && token.maxAmountUsd > 0 && amt > token.maxAmountUsd) {
    return { ok: false, error: classifyFailure('GUARDIAN_REJECTED', { detail: 'AMOUNT_OUT_OF_TOKEN_SCOPE' }) };
  }
  if (Number.isFinite(amt) && token.maxAmountUsd > 0 && amt > 0 && amt > token.maxAmountUsd) {
    return { ok: false, error: classifyFailure('GUARDIAN_REJECTED', { detail: 'AMOUNT_OUT_OF_TOKEN_SCOPE' }) };
  }
  return { ok: true, scopedHandle: token.handle, token: publicView(token) };
}

/** True when the value contains any secret-shaped key (used by redaction). */
export function tokenHasForbiddenKey(value) {
  if (value == null) return false;
  if (typeof value === 'string') return FORBIDDEN_REGEX.test(value);
  if (typeof value === 'object') {
    return Object.entries(value).some(([k, v]) => FORBIDDEN_REGEX.test(k) || tokenHasForbiddenKey(v));
  }
  return false;
}

export function _resetCapabilityTokenStore() {
  store.clear();
}
