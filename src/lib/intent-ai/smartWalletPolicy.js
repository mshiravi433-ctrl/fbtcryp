/**
 * FBT INTENT AI — Phase 12: Smart Wallet, Guardian and Risk Policy.
 *
 * The wallet boundary is intentionally split into four records:
 *   policy → fee sheet → independent Guardian decision → authorization screen.
 *
 * None of these records signs a transaction. `authorizeFinancialExecution` only
 * proves that the prerequisites are present; an adapter still has to validate,
 * simulate, sign and submit the exact request. Missing data is a hard refusal.
 */

import {
  FINANCIAL_LIMITS,
  NON_BYPASSABLE_CONTROLS,
  applyNonBypassableControl,
  assertFinancialExecution,
  containsRawSecret,
  fail,
  finite,
  safeId,
  safeList,
  safeString,
  unavailable
} from './phaseBoundary.js';

export const SMART_WALLET_POLICY_SCHEMA = 'fbt.smart-wallet-policy.v1';
export const GUARDIAN_DECISION_SCHEMA = 'fbt.guardian-decision.v1';
export const FEE_SHEET_SCHEMA = 'fbt.fee-transparency.v1';
export const AUTHORIZATION_SCREEN_SCHEMA = 'fbt.authorization-screen.v1';
export const AUTHORIZATION_SCHEMA = 'fbt.financial-execution-authorization.v1';
export const CONTROLS_SCHEMA = 'fbt.intent-controls.v2';

export const FEE_TYPES = Object.freeze([
  'network',
  'protocol',
  'bridge',
  'external-agent',
  'performance',
  'execution',
  'slippage',
  'other'
]);

const POLICY_FIELDS = Object.freeze([
  'capitalLimitUsd',
  'transactionLimitUsd',
  'riskLimitPct',
  'protocolAllowlist',
  'chainAllowlist',
  'timeLimitSeconds',
  'feeLimitUsd',
  'slippageLimitPct'
]);

const amount = (value) => {
  const n = finite(value);
  return n !== null && n >= 0 ? n : null;
};
const nonEmptyList = (value, mapper) => {
  const list = safeList(value, mapper, 64);
  return list.length ? list : null;
};
const nowOf = (value) => Number.isFinite(Number(value)) ? Number(value) : Date.now();

function simpleFingerprint(value) {
  const json = JSON.stringify(value, Object.keys(value || {}).sort());
  let hash = 2166136261;
  for (let i = 0; i < json.length; i += 1) {
    hash ^= json.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `terms_${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

/** Strict policy: every limit is explicit, and allowlists cannot be empty. */
export function createSmartWalletPolicy(input = {}, { now = Date.now() } = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || containsRawSecret(input)) {
    return fail('INVALID_POLICY', 'Policy must be a bounded object without credential material.');
  }
  const policy = {
    schema: SMART_WALLET_POLICY_SCHEMA,
    id: safeId(input.id || `policy-${Math.floor(now / 1000)}`),
    version: safeString(input.version || '1', 32),
    capitalLimitUsd: amount(input.capitalLimitUsd),
    transactionLimitUsd: amount(input.transactionLimitUsd),
    riskLimitPct: amount(input.riskLimitPct),
    protocolAllowlist: nonEmptyList(input.protocolAllowlist || input.allowedProtocols, (value) => safeString(String(value).toLowerCase(), 64)),
    chainAllowlist: nonEmptyList(input.chainAllowlist || input.allowedChains, (value) => {
      const chain = finite(value);
      return chain !== null && Number.isInteger(chain) && chain > 0 ? chain : null;
    }),
    timeLimitSeconds: amount(input.timeLimitSeconds),
    feeLimitUsd: amount(input.feeLimitUsd),
    slippageLimitPct: amount(input.slippageLimitPct ?? input.maxSlippagePct),
    guardianRequired: true,
    userAuthorizationRequired: true,
    executionMode: 'explicit-confirmation-only',
    createdAt: nowOf(now),
    expiresAt: finite(input.expiresAt)
  };
  const missing = POLICY_FIELDS.filter((field) => {
    const value = policy[field];
    return (field === 'protocolAllowlist' || field === 'chainAllowlist') ? !Array.isArray(value) || value.length === 0 : value === null;
  });
  if (!policy.id || !policy.version || missing.length) return fail('POLICY_INCOMPLETE', missing.join(','), { missingLimits: missing });
  if (policy.riskLimitPct > 100 || policy.slippageLimitPct > 100) return fail('POLICY_RANGE_INVALID');
  if (policy.expiresAt !== null && policy.expiresAt <= nowOf(now)) return fail('POLICY_EXPIRED');
  return { ok: true, schema: SMART_WALLET_POLICY_SCHEMA, policy, missingLimits: [] };
}

/** Re-normalize a policy and refuse legacy/partial policy shapes. */
export function validateSmartWalletPolicy(policy, { now = Date.now() } = {}) {
  if (!policy || policy.schema !== SMART_WALLET_POLICY_SCHEMA) return fail('POLICY_SCHEMA_REQUIRED');
  return createSmartWalletPolicy(policy, { now });
}

/** Evaluate requested values against all eight bounded checks. */
export function evaluateSmartWalletPolicy({ policy, request = {}, now = Date.now() } = {}) {
  if (!request || typeof request !== 'object' || Array.isArray(request) || containsRawSecret(request)) return fail('RAW_CREDENTIAL_FORBIDDEN');
  const valid = validateSmartWalletPolicy(policy, { now });
  if (!valid.ok) return valid;
  const p = valid.policy;
  const checks = {
    capital: amount(request.capitalUsd),
    transaction: amount(request.amountUsd ?? request.transactionUsd),
    risk: amount(request.riskPct),
    protocol: safeString(String(request.protocol || '').toLowerCase(), 64),
    chain: finite(request.chainId),
    time: amount(request.durationSeconds),
    fee: amount(request.feeUsd),
    slippage: amount(request.slippagePct)
  };
  const missing = FINANCIAL_LIMITS.filter((limit) => {
    if (limit === 'protocol') return !checks.protocol;
    if (limit === 'chain') return checks.chain === null || !Number.isInteger(checks.chain);
    return checks[limit] === null;
  });
  if (missing.length) return fail('LIMITS_INCOMPLETE', missing.join(','), { missingLimits: missing });
  const comparisons = [
    ['CAPITAL_LIMIT_EXCEEDED', checks.capital <= p.capitalLimitUsd, 'capitalLimitUsd'],
    ['TRANSACTION_LIMIT_EXCEEDED', checks.transaction <= p.transactionLimitUsd, 'transactionLimitUsd'],
    ['RISK_LIMIT_EXCEEDED', checks.risk <= p.riskLimitPct, 'riskLimitPct'],
    ['TIME_LIMIT_EXCEEDED', checks.time <= p.timeLimitSeconds, 'timeLimitSeconds'],
    ['FEE_LIMIT_EXCEEDED', checks.fee <= p.feeLimitUsd, 'feeLimitUsd'],
    ['SLIPPAGE_LIMIT_EXCEEDED', checks.slippage <= p.slippageLimitPct, 'slippageLimitPct']
  ];
  for (const [code, passes, field] of comparisons) if (!passes) return fail(code, field, { field });
  if (!p.protocolAllowlist.includes(checks.protocol)) return fail('PROTOCOL_NOT_ALLOWED', checks.protocol);
  if (!p.chainAllowlist.includes(checks.chain)) return fail('CHAIN_NOT_ALLOWED', String(checks.chain));
  if (p.expiresAt !== null && nowOf(now) >= p.expiresAt) return fail('POLICY_EXPIRED');
  return {
    ok: true,
    schema: SMART_WALLET_POLICY_SCHEMA,
    decision: 'ALLOW_REVIEW_ONLY',
    failClosed: true,
    executionStillRequiresAuthorization: true,
    values: checks,
    checked: Object.fromEntries(FINANCIAL_LIMITS.map((limit) => [limit, true]))
  };
}

/** Fee sheet used by the independent review screen. Unknown is never zero. */
export function buildFeeSheet({ fees = {}, currency = 'USD', now = Date.now() } = {}) {
  if (!fees || typeof fees !== 'object' || Array.isArray(fees) || containsRawSecret(fees)) return fail('FEE_SHEET_INVALID');
  const rows = FEE_TYPES.map((type) => {
    const raw = fees[type];
    const value = raw && typeof raw === 'object' ? raw.amount : raw;
    const known = amount(value) !== null;
    return { type, amount: known ? amount(value) : null, currency: safeString(currency, 16) || 'USD', known };
  });
  const unknownFees = rows.filter((row) => !row.known).map((row) => row.type);
  const total = unknownFees.length ? null : rows.reduce((sum, row) => sum + row.amount, 0);
  return {
    ok: unknownFees.length === 0,
    schema: FEE_SHEET_SCHEMA,
    generatedAt: now,
    fees: rows,
    totalFee: total,
    unknownFees,
    executionAllowed: unknownFees.length === 0,
    failClosed: true,
    message: unknownFees.length ? 'Every fee must be known before execution.' : 'All listed fees are visible before authorization.'
  };
}

/** Independent Guardian decision. It cannot be disabled by an agent or UI. */
export function guardianDecision({
  policy,
  request = {},
  guardian = null,
  decision = null,
  evidence = [],
  now = Date.now()
} = {}) {
  const valid = validateSmartWalletPolicy(policy, { now });
  if (!valid.ok) return { ok: false, schema: GUARDIAN_DECISION_SCHEMA, status: 'blocked', code: valid.code, guardianCanBlock: true };
  if (valid.policy.guardianRequired !== true) return { ok: false, schema: GUARDIAN_DECISION_SCHEMA, status: 'blocked', code: 'GUARDIAN_NON_DISABLEABLE' };
  if (containsRawSecret(request) || containsRawSecret(evidence)) return { ok: false, schema: GUARDIAN_DECISION_SCHEMA, status: 'blocked', code: 'RAW_CREDENTIAL_FORBIDDEN' };
  const policyResult = evaluateSmartWalletPolicy({ policy, request, now });
  if (!policyResult.ok) return { ok: false, schema: GUARDIAN_DECISION_SCHEMA, status: 'blocked', code: policyResult.code, guardianCanBlock: true };
  const explicit = decision === 'approve' || decision === 'approved' || guardian?.decision === 'approve' || guardian?.approved === true;
  const independent = guardian?.independent === true || guardian?.source === 'independent-guardian' || typeof guardian === 'function';
  if (!explicit || !independent) {
    return { ok: false, schema: GUARDIAN_DECISION_SCHEMA, status: 'blocked', code: !explicit ? 'GUARDIAN_APPROVAL_REQUIRED' : 'INDEPENDENT_GUARDIAN_REQUIRED', guardianCanBlock: true, approved: false };
  }
  return {
    ok: true,
    schema: GUARDIAN_DECISION_SCHEMA,
    status: 'approved',
    approved: true,
    independent: true,
    guardianCanBlock: true,
    replacesRiskPolicy: false,
    replacesUserConfirmation: false,
    evidence: Array.isArray(evidence) ? evidence.slice(0, 8).map((item) => safeString(String(item), 100)).filter(Boolean) : [],
    decidedAt: now
  };
}

/** Build a screen; showing it is deliberately not equivalent to confirming. */
export function createAuthorizationScreen({ policy, request = {}, fees = {}, guardian = null, now = Date.now() } = {}) {
  const policyResult = evaluateSmartWalletPolicy({ policy, request, now });
  const feeSheet = buildFeeSheet({ fees, now });
  if (!policyResult.ok) return { ok: false, schema: AUTHORIZATION_SCREEN_SCHEMA, code: policyResult.code, screenShown: false };
  if (!feeSheet.ok) return { ok: false, schema: AUTHORIZATION_SCREEN_SCHEMA, code: 'FEE_UNKNOWN', unknownFees: feeSheet.unknownFees, screenShown: false, feeSheet };
  const guardianResult = guardianDecision({ policy, request, guardian, decision: guardian?.decision, evidence: guardian?.evidence, now });
  return {
    ok: true,
    schema: AUTHORIZATION_SCREEN_SCHEMA,
    id: `auth_${Math.floor(now / 1000).toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    screenShown: true,
    userConfirmed: false,
    policy: policyResult,
    feeSheet,
    guardian: guardianResult,
    termsFingerprint: simpleFingerprint({ policyId: policy.id, request, fees, guardianRequired: true }),
    executionAuthorized: false,
    financialExecutionAuthorized: false,
    noAgentOverride: true,
    createdAt: now
  };
}

/** Explicit click/confirmation; a screen and Guardian are still required. */
export function confirmAuthorization({ screen, confirmed = false, confirmationText = '', now = Date.now() } = {}) {
  if (!screen || screen.schema !== AUTHORIZATION_SCREEN_SCHEMA || screen.screenShown !== true) return fail('AUTHORIZATION_SCREEN_REQUIRED');
  if (containsRawSecret(screen)) return fail('RAW_CREDENTIAL_FORBIDDEN');
  if (screen.guardian?.approved !== true) return fail('GUARDIAN_APPROVAL_REQUIRED');
  if (screen.guardian?.independent !== true || screen.guardian?.replacesUserConfirmation !== false) return fail('INDEPENDENT_GUARDIAN_REQUIRED');
  if (screen.feeSheet?.executionAllowed !== true) return fail('FEE_UNKNOWN');
  if (screen.policy?.decision !== 'ALLOW_REVIEW_ONLY') return fail('RISK_POLICY_REQUIRED');
  if (confirmed !== true) return fail('EXPLICIT_USER_CONFIRMATION_REQUIRED');
  if (typeof confirmationText !== 'string' || confirmationText.trim().toUpperCase() !== 'CONFIRM') return fail('CONFIRMATION_TEXT_REQUIRED');
  return {
    ok: true,
    schema: AUTHORIZATION_SCHEMA,
    authorizationScreenId: screen.id,
    screenShown: true,
    userConfirmed: true,
    guardianApproved: true,
    policyDecision: 'ALLOW_REVIEW_ONLY',
    limits: {
      capital: screen.policy.values.capital,
      transaction: screen.policy.values.transaction,
      risk: screen.policy.values.risk,
      protocol: [screen.policy.values.protocol],
      chain: [screen.policy.values.chain],
      time: screen.policy.values.time,
      fee: screen.policy.values.fee,
      slippage: screen.policy.values.slippage
    },
    termsFingerprint: screen.termsFingerprint,
    confirmedAt: now,
    executionAuthorized: false,
    adapterRequired: true,
    failClosed: true
  };
}

/** Last boundary before an adapter: requires current provider/runtime proof. */
export function authorizeFinancialExecution({ screen, authorization, runtimeEvidence, controls = {}, now = Date.now() } = {}) {
  if (!authorization || authorization.schema !== AUTHORIZATION_SCHEMA) return fail('AUTHORIZATION_REQUIRED');
  if (authorization.authorizationScreenId !== screen?.id || authorization.termsFingerprint !== screen?.termsFingerprint) return fail('AUTHORIZATION_MISMATCH');
  const result = assertFinancialExecution({
    authorizationScreenShown: screen?.screenShown === true && authorization.screenShown === true,
    userConfirmed: authorization.userConfirmed === true,
    guardianApproved: authorization.guardianApproved === true,
    policyDecision: authorization.policyDecision,
    limits: authorization.limits,
    runtimeEvidence,
    controls,
    now
  });
  if (!result.ok) return result;
  return {
    ...result,
    schema: AUTHORIZATION_SCHEMA,
    authorizationId: authorization.authorizationScreenId,
    executionAuthorized: true,
    financialExecutionAuthorized: true,
    expiresAt: finite(runtimeEvidence?.expiresAt),
    guardianNonDisableable: true
  };
}

export function createControls(now = Date.now()) {
  return { schema: CONTROLS_SCHEMA, stopped: false, paused: false, revoked: false, disconnected: false, emergency_exit: false, updatedAt: now };
}

export function applyControl(controls, action, now = Date.now()) {
  return applyNonBypassableControl(controls || createControls(now), action, now);
}

export function controlsAreBlocking(controls = {}) {
  const aliases = {
    STOP: ['stop', 'stopped'],
    PAUSE: ['pause', 'paused'],
    REVOKE: ['revoke', 'revoked'],
    DISCONNECT: ['disconnect', 'disconnected'],
    EMERGENCY_EXIT: ['emergency_exit', 'emergency']
  };
  return NON_BYPASSABLE_CONTROLS.some((action) => aliases[action].some((key) => controls?.[key] === true));
}

export function policyPublicSummary(policy) {
  const result = validateSmartWalletPolicy(policy);
  if (!result.ok) return { ok: false, code: result.code };
  return {
    schema: SMART_WALLET_POLICY_SCHEMA,
    id: result.policy.id,
    version: result.policy.version,
    limits: Object.fromEntries(POLICY_FIELDS.map((field) => [field, result.policy[field]])),
    guardianRequired: true,
    executionMode: result.policy.executionMode,
    rawCredentialsAllowed: false
  };
}
