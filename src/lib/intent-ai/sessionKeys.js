/**
 * Scoped, time-bounded, capability-bound session keys.
 * Never stores raw private keys, seeds, or mnemonics.
 */
import { classifyFailure } from './failureModes.js';

const FORBIDDEN = /privatekey|mnemonic|seed|password|apisecret|mastercredential/i;

const store = new Map();

function sid() {
  return `sk_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

export function issueSessionKey({
  policyId,
  allowedChains = [],
  allowedProtocols = [],
  maxAmountUsd = 0,
  ttlMs = 15 * 60 * 1000,
  now = Date.now()
} = {}) {
  if (!policyId) return { ok: false, error: classifyFailure('MISSING_DATA', { detail: 'NO_POLICY_ID' }) };
  const key = {
    id: sid(),
    policyId: String(policyId).slice(0, 64),
    allowedChains: (allowedChains || []).map(Number).filter(Number.isFinite).slice(0, 8),
    allowedProtocols: (allowedProtocols || []).map((p) => String(p).toLowerCase()).slice(0, 16),
    maxAmountUsd: Math.max(0, Number(maxAmountUsd) || 0),
    issuedAt: now,
    expiresAt: now + Math.max(60_000, Number(ttlMs) || 0),
    revoked: false,
    handle: `handle_${Math.random().toString(36).slice(2, 12)}`
  };
  store.set(key.id, key);
  return { ok: true, sessionKey: publicView(key) };
}

function publicView(key) {
  return Object.freeze({
    id: key.id,
    policyId: key.policyId,
    allowedChains: key.allowedChains,
    allowedProtocols: key.allowedProtocols,
    maxAmountUsd: key.maxAmountUsd,
    issuedAt: key.issuedAt,
    expiresAt: key.expiresAt,
    revoked: key.revoked,
    handle: key.handle
  });
}

export function revokeSessionKey(id) {
  const key = store.get(id);
  if (!key) return { ok: false, error: classifyFailure('SESSION_KEY_REVOKED') };
  key.revoked = true;
  key.revokedAt = Date.now();
  return { ok: true, sessionKey: publicView(key) };
}

export function revokeAllForPolicy(policyId) {
  let n = 0;
  for (const key of store.values()) {
    if (key.policyId === policyId && !key.revoked) {
      key.revoked = true;
      key.revokedAt = Date.now();
      n += 1;
    }
  }
  return n;
}

export function scopeFor(sessionKey, draft, { now = Date.now() } = {}) {
  const key = typeof sessionKey === 'string' ? store.get(sessionKey) : store.get(sessionKey?.id);
  if (!key) return { ok: false, error: classifyFailure('MISSING_DATA', { detail: 'NO_SESSION_KEY' }) };
  if (key.revoked) return { ok: false, error: classifyFailure('SESSION_KEY_REVOKED') };
  if (now > key.expiresAt) return { ok: false, error: classifyFailure('SESSION_KEY_EXPIRED') };
  if (!draft) return { ok: false, error: classifyFailure('MISSING_DATA', { detail: 'NO_DRAFT' }) };
  if (key.allowedChains.length && !key.allowedChains.includes(Number(draft.chainId))) {
    return { ok: false, error: classifyFailure('GUARDIAN_REJECTED', { detail: 'CHAIN_OUT_OF_SCOPE' }) };
  }
  const proto = String(draft.protocol || '').toLowerCase();
  if (key.allowedProtocols.length && proto && !key.allowedProtocols.includes(proto)
      && !key.allowedProtocols.includes(proto === 'dex_aggregator' ? 'swap' : proto)) {
    return { ok: false, error: classifyFailure('GUARDIAN_REJECTED', { detail: 'PROTOCOL_OUT_OF_SCOPE' }) };
  }
  const amt = Number(draft.amountUsd ?? draft.amountIn);
  if (Number.isFinite(amt) && amt > key.maxAmountUsd) {
    return { ok: false, error: classifyFailure('GUARDIAN_REJECTED', { detail: 'AMOUNT_OUT_OF_SCOPE' }) };
  }
  return { ok: true, scopedHandle: key.handle, sessionKey: publicView(key) };
}

export function assertNoSecrets(obj) {
  const json = JSON.stringify(obj || {});
  return !FORBIDDEN.test(json);
}

export function _resetSessionKeyStore() {
  store.clear();
}
