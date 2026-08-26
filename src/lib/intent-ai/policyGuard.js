/**
 * FBT INTENT AI — fail-closed policy and emergency controls.
 *
 * This is a pure policy boundary used before any execution adapter. It does
 * not hold keys and it does not send transactions. Every limit is checked
 * when supplied; missing execution-critical values fail closed.
 */

export const POLICY_SCHEMA = 'fbt.intent-policy.v1';
export const CONTROL_SCHEMA = 'fbt.intent-controls.v1';

export const DEFAULT_POLICY = Object.freeze({
  capitalLimitUsd: 0,
  transactionLimitUsd: 0,
  riskLimitPct: 0,
  protocolAllowlist: [],
  chainAllowlist: [],
  timeLimitSeconds: 0,
  feeLimitUsd: 0,
  maxSlippagePct: 0,
  requireGuardian: true,
  requireUserAuthorization: true
});

const finite = (value) => value !== null
  && value !== undefined
  && value !== ''
  && (typeof value === 'number' || typeof value === 'string')
  && Number.isFinite(Number(value));
const nonNegative = (value) => finite(value) && Number(value) >= 0;
const normalizeList = (value) => Array.isArray(value) ? [...new Set(value.map((item) => String(item).trim()).filter(Boolean))] : [];

function fail(code, message, field = null) {
  return { ok: false, schema: POLICY_SCHEMA, decision: 'BLOCK', code, message, field, failClosed: true };
}

export function normalizePolicy(policy = {}) {
  const source = policy && typeof policy === 'object' ? policy : {};
  const normalized = {
    capitalLimitUsd: source.capitalLimitUsd == null ? 0 : Number(source.capitalLimitUsd),
    transactionLimitUsd: source.transactionLimitUsd == null ? 0 : Number(source.transactionLimitUsd),
    riskLimitPct: source.riskLimitPct == null ? 0 : Number(source.riskLimitPct),
    protocolAllowlist: normalizeList(source.protocolAllowlist),
    chainAllowlist: normalizeList(source.chainAllowlist),
    timeLimitSeconds: source.timeLimitSeconds == null ? 0 : Number(source.timeLimitSeconds),
    feeLimitUsd: source.feeLimitUsd == null ? 0 : Number(source.feeLimitUsd),
    maxSlippagePct: source.maxSlippagePct == null ? 0 : Number(source.maxSlippagePct),
    requireGuardian: source.requireGuardian !== false,
    requireUserAuthorization: source.requireUserAuthorization !== false
  };
  const numericFields = ['capitalLimitUsd', 'transactionLimitUsd', 'riskLimitPct', 'timeLimitSeconds', 'feeLimitUsd', 'maxSlippagePct'];
  if (numericFields.some((field) => !nonNegative(normalized[field]))) return { ok: false, code: 'INVALID_POLICY', policy: null };
  if (normalized.riskLimitPct > 100 || normalized.maxSlippagePct > 100) return { ok: false, code: 'INVALID_POLICY', policy: null };
  return { ok: true, schema: POLICY_SCHEMA, policy: normalized };
}

/**
 * All seven product limits are represented and evaluated. A zero limit is
 * intentional fail-closed configuration, not unlimited spending.
 */
export function evaluatePolicy({
  policy,
  amountUsd,
  capitalUsd,
  riskPct,
  protocol,
  chain,
  durationSeconds,
  feeUsd,
  slippagePct,
  userAuthorized = false,
  guardianApproved = false,
  now = Date.now(),
  expiresAt = null,
  controls = {}
} = {}) {
  const normalized = normalizePolicy(policy);
  if (!normalized.ok) return fail('INVALID_POLICY', 'Policy is invalid or incomplete.');
  const p = normalized.policy;
  if (controls?.paused === true) return fail('PAUSED', 'Execution is paused.');
  if (controls?.stopped === true) return fail('STOPPED', 'Execution has been stopped.');
  if (controls?.emergency === true) return fail('EMERGENCY_EXIT', 'Emergency exit is active.');
  if (controls?.revoked === true) return fail('PERMISSION_REVOKED', 'The scoped permission has been revoked.');
  if (controls?.disconnected === true) return fail('DISCONNECTED', 'The external agent is disconnected.');

  const fields = [
    ['amountUsd', amountUsd],
    ['capitalUsd', capitalUsd],
    ['riskPct', riskPct],
    ['durationSeconds', durationSeconds],
    ['feeUsd', feeUsd],
    ['slippagePct', slippagePct]
  ];
  if (fields.some(([, value]) => !finite(value))) return fail('MISSING_EXECUTION_INPUT', 'Every execution limit input must be known before authorization.');
  if (!userAuthorized && p.requireUserAuthorization) return fail('USER_AUTHORIZATION_REQUIRED', 'Explicit user authorization is required.');
  if (!guardianApproved && p.requireGuardian) return fail('GUARDIAN_REQUIRED', 'Independent Guardian approval is required.');

  const checks = [
    ['CAPITAL_LIMIT_EXCEEDED', capitalUsd <= p.capitalLimitUsd, 'capitalLimitUsd'],
    ['TRANSACTION_LIMIT_EXCEEDED', amountUsd <= p.transactionLimitUsd, 'transactionLimitUsd'],
    ['RISK_LIMIT_EXCEEDED', riskPct <= p.riskLimitPct, 'riskLimitPct'],
    ['TIME_LIMIT_EXCEEDED', durationSeconds <= p.timeLimitSeconds, 'timeLimitSeconds'],
    ['FEE_LIMIT_EXCEEDED', feeUsd <= p.feeLimitUsd, 'feeLimitUsd'],
    ['SLIPPAGE_LIMIT_EXCEEDED', slippagePct <= p.maxSlippagePct, 'maxSlippagePct']
  ];
  for (const [code, passes, field] of checks) {
    if (!passes) return fail(code, `The ${field} policy limit would be exceeded.`, field);
  }
  if (p.protocolAllowlist.length === 0 || !p.protocolAllowlist.includes(String(protocol || ''))) {
    return fail('PROTOCOL_NOT_ALLOWED', 'The protocol is not explicitly allowed.', 'protocolAllowlist');
  }
  if (p.chainAllowlist.length === 0 || !p.chainAllowlist.includes(String(chain || ''))) {
    return fail('CHAIN_NOT_ALLOWED', 'The chain is not explicitly allowed.', 'chainAllowlist');
  }
  if (expiresAt == null || !finite(expiresAt) || Number(expiresAt) <= Number(now)) {
    return fail('TIME_SCOPE_EXPIRED', 'The scoped permission is missing or expired.', 'expiresAt');
  }
  return {
    ok: true,
    schema: POLICY_SCHEMA,
    decision: 'ALLOW_REVIEW_ONLY',
    failClosed: true,
    executionStillRequiresAdapter: true,
    checked: {
      capitalLimit: true,
      transactionLimit: true,
      riskLimit: true,
      protocolLimit: true,
      chainLimit: true,
      timeLimit: true,
      feeLimit: true,
      slippageLimit: true
    }
  };
}

export function createControlState() {
  return {
    schema: CONTROL_SCHEMA,
    paused: false,
    stopped: false,
    revoked: false,
    disconnected: false,
    emergency: false,
    updatedAt: new Date().toISOString()
  };
}

export function applyControl(controlState, action) {
  const current = { ...createControlState(), ...(controlState || {}) };
  const value = String(action || '').toUpperCase();
  if (value === 'STOP' || value === 'KILL_SWITCH') current.stopped = true;
  else if (value === 'PAUSE') current.paused = true;
  else if (value === 'REVOKE') current.revoked = true;
  else if (value === 'DISCONNECT') current.disconnected = true;
  else if (value === 'EMERGENCY_EXIT') { current.emergency = true; current.stopped = true; current.revoked = true; }
  else if (value === 'RESUME') {
    if (current.stopped || current.emergency || current.revoked) return { ok: false, code: 'RESET_REQUIRES_NEW_SCOPE', controls: current };
    current.paused = false;
  } else return { ok: false, code: 'UNKNOWN_CONTROL', controls: current };
  current.updatedAt = new Date().toISOString();
  return { ok: true, schema: CONTROL_SCHEMA, action: value, controls: current, canExecute: false };
}

export function feeTransparency({ fees = {}, amountUsd = null, currency = 'USD' } = {}) {
  const entries = Object.entries(fees || {}).map(([type, value]) => ({ type, amount: finite(value) ? Number(value) : null, known: finite(value) }));
  const unknown = entries.filter((item) => !item.known).map((item) => item.type);
  const total = unknown.length ? null : entries.reduce((sum, item) => sum + item.amount, 0);
  return {
    ok: unknown.length === 0,
    schema: POLICY_SCHEMA,
    currency,
    amountUsd: finite(amountUsd) ? Number(amountUsd) : null,
    fees: entries,
    totalFee: total,
    unknownFees: unknown,
    executionAllowed: unknown.length === 0,
    message: unknown.length ? 'Execution is blocked until every fee is known.' : 'All supplied fees are visible before authorization.'
  };
}
