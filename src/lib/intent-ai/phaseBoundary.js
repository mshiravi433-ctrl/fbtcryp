/**
 * FBT INTENT AI — shared boundaries for Phases 11–20.
 *
 * These helpers are deliberately small and dependency-free. They are used by
 * every later phase so that a proposal, a runtime handle, and a transaction
 * authorization cannot accidentally grow different safety rules.
 *
 * A phase contract is not an activation claim. The functions below return
 * `unavailable`/`BLOCK` when a real provider, signer, attestation, or durable
 * evidence is missing. Test doubles may be injected by probes, but no test
 * double is treated as a production provider by these helpers.
 */

export const PHASE_BOUNDARY_SCHEMA = 'fbt.intent-ai-phase-boundary.v1';

export const PRIMARY_MODES = Object.freeze([
  'HUMAN ↔ AI',
  'AI ↔ AI INSIDE FBT',
  'FBT AI ↔ EXTERNAL AI AGENT'
]);

export const FINANCIAL_LIMITS = Object.freeze([
  'capital',
  'transaction',
  'risk',
  'protocol',
  'chain',
  'time',
  'fee',
  'slippage'
]);

export const NON_BYPASSABLE_CONTROLS = Object.freeze([
  'STOP',
  'PAUSE',
  'REVOKE',
  'DISCONNECT',
  'EMERGENCY_EXIT'
]);

const SECRET_KEYS = /^(?:seed|seedphrase|mnemonic|privatekey|private_key|rawsecret|raw_secret|masterpassword|master_password|mastercredential|master_credential|credential|credentials|secret|api_secret|unrestrictedsigner|unrestricted_signer)$/i;
const SECRET_WORDS = /\b(?:seed phrase|recovery phrase|mnemonic|private key|master password|master credential|raw secret|unrestricted signer)\b/i;
const PEM_PRIVATE_KEY = /-----BEGIN [^-]*PRIVATE KEY-----/i;
const HEX_PRIVATE_KEY = /^0x[0-9a-f]{64}$/i;
const ID_RE = /^[a-z0-9][a-z0-9._:-]{1,95}$/i;

export const finite = (value) => {
  if (value === null || value === undefined || value === '' || typeof value === 'boolean') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};

export const positive = (value) => {
  const number = finite(value);
  return number !== null && number > 0 ? number : null;
};

export const bounded = (value, min = 0, max = 100) => {
  const number = finite(value);
  return number !== null && number >= min && number <= max ? number : null;
};

export const safeId = (value) => {
  const id = String(value ?? '').trim();
  return ID_RE.test(id) ? id : null;
};

export const safeString = (value, max = 240) => {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  if (!text || text.length > max || /[\u0000-\u001f\u007f]/.test(text)) return null;
  return text;
};

export const safeList = (value, mapper = (item) => item, max = 32) => Array.isArray(value)
  ? [...new Set(value.map(mapper).filter((item) => item !== null && item !== undefined && item !== ''))].slice(0, max)
  : [];

/**
 * Detect credential material recursively. Public wallet addresses and tx hashes
 * are not secrets by themselves; the key name/secret wording is what matters.
 * A bare 32-byte private key is rejected because it is never needed in a
 * client-side phase contract.
 */
export function containsRawSecret(value, seen = new Set(), keyName = '', depth = 0) {
  if (depth > 8 || value == null) return false;
  if (typeof value === 'string') {
    const text = value.trim();
    return SECRET_KEYS.test(keyName) || SECRET_WORDS.test(text) || PEM_PRIVATE_KEY.test(text)
      || (SECRET_KEYS.test(keyName) && HEX_PRIVATE_KEY.test(text));
  }
  if (typeof value !== 'object' || seen.has(value)) return false;
  seen.add(value);
  return Object.entries(value).some(([key, child]) => {
    if (SECRET_KEYS.test(key)) return true;
    return containsRawSecret(child, seen, key, depth + 1);
  });
}

export const fail = (code, detail = null, extra = {}) => ({
  ok: false,
  schema: PHASE_BOUNDARY_SCHEMA,
  decision: 'BLOCK',
  code,
  failClosed: true,
  ...(detail ? { detail: String(detail).slice(0, 240) } : {}),
  ...extra
});

export const unavailable = (code, detail = null, extra = {}) => ({
  ok: false,
  schema: PHASE_BOUNDARY_SCHEMA,
  status: 'unavailable',
  code,
  failClosed: true,
  ...(detail ? { detail: String(detail).slice(0, 240) } : {}),
  ...extra
});

export function publicRuntimeEvidence(evidence = {}, { now = Date.now() } = {}) {
  if (!evidence || typeof evidence !== 'object' || Array.isArray(evidence)) return null;
  const providerId = safeId(evidence.providerId || evidence.provider || evidence.adapterId);
  const health = evidence.health === 'healthy' || evidence.health === 'operational' ? evidence.health : null;
  const attested = evidence.attested === true;
  const checkedAt = finite(evidence.checkedAt);
  const expiresAt = finite(evidence.expiresAt);
  const signer = evidence.signer === true || evidence.signerStatus === 'available';
  const contract = evidence.contract === true || evidence.contractAddress != null;
  const operator = evidence.operator === true || evidence.operatorStatus === 'approved';
  const certificate = evidence.certificate === true || evidence.certificateStatus === 'active';
  return {
    providerId,
    health,
    attested,
    checkedAt,
    expiresAt,
    signer,
    contract,
    operator,
    certificate,
    valid: Boolean(providerId && health && attested && (expiresAt == null || expiresAt > Number(now)))
  };
}

export function allRequiredLimitsKnown(values = {}, { requireSlippage = true } = {}) {
  const limits = requireSlippage ? FINANCIAL_LIMITS : FINANCIAL_LIMITS.filter((limit) => limit !== 'slippage');
  const missing = limits.filter((limit) => {
    if (limit === 'protocol' || limit === 'chain') return !Array.isArray(values[limit]) || values[limit].length === 0;
    const value = values[limit];
    return finite(value) === null;
  });
  return { ok: missing.length === 0, missing };
}

/**
 * Shared authorization assertion. This is intentionally stricter than a
 * strategy review: every financial execution must show its independent screen,
 * explicit user confirmation, Guardian decision, policy decision, every limit,
 * and current provider/runtime evidence.
 */
export function assertFinancialExecution({
  authorizationScreenShown = false,
  userConfirmed = false,
  guardianApproved = false,
  policyDecision = null,
  limits = {},
  runtimeEvidence = null,
  controls = {},
  now = Date.now()
} = {}) {
  const controlKeys = {
    STOP: ['stop', 'stopped', 'STOP'],
    PAUSE: ['pause', 'paused', 'PAUSE'],
    REVOKE: ['revoke', 'revoked', 'REVOKE'],
    DISCONNECT: ['disconnect', 'disconnected', 'DISCONNECT'],
    EMERGENCY_EXIT: ['emergency_exit', 'emergency', 'EMERGENCY_EXIT']
  };
  for (const control of NON_BYPASSABLE_CONTROLS) {
    if (controlKeys[control].some((key) => controls?.[key] === true)) {
      return fail(`${control}_ACTIVE`, `${control} is active; a new authorization is required.`);
    }
  }
  if (authorizationScreenShown !== true) return fail('AUTHORIZATION_SCREEN_REQUIRED');
  if (userConfirmed !== true) return fail('EXPLICIT_USER_CONFIRMATION_REQUIRED');
  if (guardianApproved !== true) return fail('GUARDIAN_APPROVAL_REQUIRED');
  if (policyDecision !== 'ALLOW_REVIEW_ONLY' && policyDecision !== 'ALLOW') return fail('RISK_POLICY_REQUIRED');
  const known = allRequiredLimitsKnown(limits);
  if (!known.ok) return fail('LIMITS_INCOMPLETE', known.missing.join(','), { missingLimits: known.missing });
  const evidence = publicRuntimeEvidence(runtimeEvidence, { now });
  if (!evidence?.valid) return unavailable('RUNTIME_EVIDENCE_UNAVAILABLE', 'Provider health and attestation must be current.', { runtimeEvidence: evidence });
  return {
    ok: true,
    schema: PHASE_BOUNDARY_SCHEMA,
    decision: 'ALLOW_REVIEW_ONLY',
    executionRequiresAdapter: true,
    checked: Object.fromEntries(FINANCIAL_LIMITS.map((limit) => [limit, true])),
    runtimeEvidence: evidence,
    rawCredentialsAllowed: false
  };
}

export function createNonBypassableControls(now = Date.now()) {
  return {
    schema: 'fbt.intent-controls.v2',
    stopped: false,
    paused: false,
    revoked: false,
    disconnected: false,
    emergency_exit: false,
    updatedAt: now
  };
}

export function applyNonBypassableControl(current = {}, action, now = Date.now()) {
  const controls = { ...createNonBypassableControls(now), ...(current || {}) };
  const normalized = String(action || '').trim().toUpperCase();
  if (!NON_BYPASSABLE_CONTROLS.includes(normalized)) return fail('UNKNOWN_CONTROL', normalized, { controls });
  const aliases = {
    STOP: 'stopped',
    PAUSE: 'paused',
    REVOKE: 'revoked',
    DISCONNECT: 'disconnected',
    EMERGENCY_EXIT: 'emergency_exit'
  };
  controls[aliases[normalized]] = true;
  if (normalized === 'EMERGENCY_EXIT') {
    controls.stopped = true;
    controls.revoked = true;
    controls.paused = true;
    controls.emergency_exit = true;
  }
  controls.updatedAt = now;
  return { ok: true, schema: controls.schema, action: normalized, controls, canExecute: false };
}

export function executionProofRequired(status) {
  return status === 'completed' || status === 'COMPLETED';
}

export function noExecutionPermission(value = {}) {
  return {
    ...value,
    executionAuthorized: false,
    financialExecutionAuthorized: false,
    automaticExecution: false,
    rawCredentialsAllowed: false
  };
}
