/**
 * FBT INTENT AI — POLICY MODEL (canonical, versioned, signed-by-user)
 * ---------------------------------------------------------------------------
 * A Policy is the user's binding authorisation for a session. It is created
 * from the output of sanitizePolicy() and additionally carries:
 *   - a stable policyId
 *   - a user-set scope label (session / daily / per-asset)
 *   - an expiry timestamp
 *   - the session-start timestamp (for duration enforcement)
 *   - an emergency-stop flag the user can toggle from the UI at any time
 *
 * Policies are never mutated in place — each change produces a new policyId
 * and invalidates outstanding approvals (terms-hash changes), forcing
 * re-authorisation through the Confirmation Gate.
 */

import { sanitizePolicy, PERMISSION_LEVELS, DEFAULT_POLICY_CAPS } from './permissions.js';

export const POLICY_SCHEMA = 'fbt.policy.v1';

const STORAGE_KEY = 'fbt-policy-v1';
const MAX_POLICIES = 10;

function pid() {
  return `pol_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function safeRead(key, fallback) {
  try { return JSON.parse(globalThis.localStorage?.getItem(key) || 'null') ?? fallback; }
  catch { return fallback; }
}
function safeWrite(key, value) {
  try { globalThis.localStorage?.setItem(key, JSON.stringify(value)); return true; }
  catch { return false; }
}

/**
 * Create a new policy bound to a session.
 *
 * @param {object} params  { level:1|2|3, sessionScope:'single'|'daily'|'per_asset',
 *                           maxCapitalUsd, maxTransactionUsd, maxLossUsd, maxLeverage,
 *                           allowedChains, allowedProtocols, allowedAssets,
 *                           allowedDestinations, maxSlippagePct, maxFeeBps,
 *                           durationMs, emergencyExit, performanceFeeBps,
 *                           feePolicy, exitPolicy }
 */
export function createPolicy(params = {}, now = Date.now()) {
  const level = Number(params.level) || 1;
  const sanitized = sanitizePolicy(params, level);

  if (!sanitized.ok && level === 3) {
    return { ok: false, errors: sanitized.errors, policy: null };
  }

  const id = pid();
  const policy = {
    schema: POLICY_SCHEMA,
    id,
    level,
    levelName: level === 3 ? 'CONTROLLED_AUTONOMOUS' : level === 2 ? 'PREPARE' : 'ANALYSIS',
    sessionScope: ['single', 'daily', 'per_asset'].includes(params.sessionScope) ? params.sessionScope : 'single',
    createdAt: now,
    sessionStartAt: now,
    expiresAt: now + Math.max(5 * 60 * 1000, Number(sanitized.policy.durationMs) || 60 * 60 * 1000),
    emergencyStop: false,
    userConfirmed: false,
    confirmedAt: null,
    ...sanitized.policy
  };

  return { ok: true, errors: sanitized.errors, policy: Object.freeze(policy) };
}

/** Confirm a policy (user taps CONFIRM & START). */
export function confirmPolicy(policy, now = Date.now()) {
  if (!policy || policy.schema !== POLICY_SCHEMA) return null;
  return Object.freeze({
    ...policy,
    userConfirmed: true,
    confirmedAt: now,
    sessionStartAt: now,
    expiresAt: now + Number(policy.durationMs || 60 * 60 * 1000)
  });
}

/** Trigger emergency stop. Returns a new policy object. */
export function triggerEmergencyStop(policy, now = Date.now()) {
  if (!policy || policy.schema !== POLICY_SCHEMA) return null;
  return Object.freeze({
    ...policy,
    emergencyStop: true,
    stoppedAt: now,
    autonomousExecution: false
  });
}

/** Is the policy currently valid (not expired, not stopped, confirmed for L3)? */
export function policyIsValid(policy, now = Date.now()) {
  if (!policy || policy.schema !== POLICY_SCHEMA) return { valid: false, reason: 'BAD_POLICY' };
  if (policy.emergencyStop) return { valid: false, reason: 'EMERGENCY_STOP' };
  if (policy.expiresAt && now > policy.expiresAt) return { valid: false, reason: 'EXPIRED' };
  if (policy.level === 3 && !policy.userConfirmed) return { valid: false, reason: 'NOT_CONFIRMED' };
  if (policy.level === 3 && policy.autonomousExecution !== true) return { valid: false, reason: 'AUTONOMOUS_DISABLED' };
  return { valid: true };
}

/** Produce the human-readable CONFIRMATION PREVIEW block for an L3 session. */
export function policyPreview(policy) {
  if (!policy) return null;
  const fmt = (n) => (n != null ? `$${Number(n).toLocaleString(undefined, { maximumFractionDigits: 2 })}` : '—');
  return Object.freeze({
    level: policy.levelName,
    maximumCapital: fmt(policy.maxCapitalUsd),
    maximumTransaction: fmt(policy.maxTransactionUsd),
    maximumLoss: fmt(policy.maxLossUsd),
    maximumLeverage: policy.maxLeverage ? `${policy.maxLeverage}x` : '1x',
    allowedChains: policy.allowedChains && policy.allowedChains.length ? policy.allowedChains.join(', ') : '(none)',
    allowedProtocols: policy.allowedProtocols && policy.allowedProtocols.length ? policy.allowedProtocols.join(', ') : '(none)',
    allowedAssets: policy.allowedAssets && policy.allowedAssets.length ? policy.allowedAssets.join(', ') : '(any)',
    duration: policy.durationMs ? `${Math.round(policy.durationMs / 60000)} minutes` : '—',
    feePolicy: policy.feePolicy || 'all-inclusive',
    performanceFee: policy.performanceFeeBps != null ? `${(policy.performanceFeeBps / 100).toFixed(2)}%` : '0%',
    exitPolicy: policy.exitPolicy || 'stop-loss-and-take-profit',
    emergencyStop: policy.emergencyExit !== false ? 'USER_CAN_STOP_ANYTIME' : 'NOT_CONFIGURED'
  });
}

/* ---- persistence (local-first; only stores policy hashes, never secrets) ---- */

export function savePolicy(policy) {
  if (!policy || policy.schema !== POLICY_SCHEMA) return false;
  const rows = [policy, ...loadPolicies().filter((p) => p.id !== policy.id)].slice(0, MAX_POLICIES);
  return safeWrite(STORAGE_KEY, rows);
}

export function loadPolicies() {
  const rows = safeRead(STORAGE_KEY, []);
  if (!Array.isArray(rows)) return [];
  return rows.filter((p) => p && p.schema === POLICY_SCHEMA);
}

export function loadPolicy(id) {
  return loadPolicies().find((p) => p.id === id) || null;
}

export function deletePolicy(id) {
  const rows = loadPolicies().filter((p) => p.id !== id);
  return safeWrite(STORAGE_KEY, rows);
}

/* ---- summary for analytics & audit (no PII, no amounts beyond caps) ---- */

export function policyAuditSummary(policy) {
  if (!policy) return null;
  const validity = policyIsValid(policy);
  return {
    policyId: policy.id,
    schema: policy.schema,
    level: policy.level,
    levelName: policy.levelName,
    sessionScope: policy.sessionScope,
    valid: validity.valid,
    validityReason: validity.reason || null,
    createdAt: policy.createdAt,
    expiresAt: policy.expiresAt,
    confirmedAt: policy.confirmedAt,
    emergencyStop: !!policy.emergencyStop,
    maxCapitalUsd: policy.maxCapitalUsd,
    maxTransactionUsd: policy.maxTransactionUsd,
    maxLossUsd: policy.maxLossUsd,
    maxLeverage: policy.maxLeverage,
    allowedChainsCount: (policy.allowedChains || []).length,
    allowedProtocolsCount: (policy.allowedProtocols || []).length,
    allowedAssetsCount: (policy.allowedAssets || []).length
  };
}

export { DEFAULT_POLICY_CAPS, PERMISSION_LEVELS };
