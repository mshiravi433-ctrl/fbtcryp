/**
 * FBT INTENT AI — PHASE 10 EXTERNAL AGENT TRUST PLANE
 * ---------------------------------------------------------------------------
 * Discovery metadata is not authority. This module turns the external-agent
 * requirements into explicit, testable contracts:
 *
 *   discovery → passport → independent security evidence → sandbox stages
 *   → non-executable handshake → observed reputation → scoped authorization
 *
 * A public listing can be shown while it is unverified, but it can never enter
 * an execution scope. Raw credentials are rejected at every boundary. A
 * verified passport still does not authorize a transaction: user confirmation,
 * Guardian approval, Smart Wallet/session-key scope and expiration are all
 * required before a bounded grant is issued.
 */

import { socialMessage, isSocialType, SOCIAL_TYPES } from './socialProtocol.js';
import { issueCapabilityToken, revokeCapabilityToken, scopeCapabilityToken } from './capabilityToken.js';
import { issueSessionKey, revokeSessionKey, scopeFor } from './sessionKeys.js';

export const EXTERNAL_AGENT_TRUST_SCHEMA = 'fbt.external-agent-trust.v1';
export const EXTERNAL_AGENT_PASSPORT_SCHEMA = 'fbt.external-agent-passport.v1';
export const EXTERNAL_AGENT_DISCOVERY_SCHEMA = 'fbt.external-agent-discovery.v1';
export const EXTERNAL_AGENT_SECURITY_SCHEMA = 'fbt.external-agent-security.v1';
export const EXTERNAL_AGENT_SANDBOX_SCHEMA = 'fbt.external-agent-sandbox.v1';
export const EXTERNAL_AGENT_HANDSHAKE_SCHEMA = 'fbt.external-agent-handshake.v1';
export const EXTERNAL_AGENT_REPUTATION_SCHEMA = 'fbt.external-agent-reputation.v1';
export const EXTERNAL_AGENT_RATING_SCHEMA = 'fbt.external-agent-rating.v1';
export const EXTERNAL_AGENT_SCOPE_SCHEMA = 'fbt.external-agent-scope.v1';

export const EXTERNAL_AGENT_SANDBOX_STAGES = Object.freeze([
  'discovery',
  'identity',
  'capability-check',
  'security-check',
  'simulation',
  'paper-trading',
  'limited-capital',
  'monitoring',
  'production'
]);

export const EXTERNAL_AGENT_REPUTATION_CATEGORIES = Object.freeze([
  'successRate',
  'predictionAccuracy',
  'executionQuality',
  'riskDetection',
  'historicalDrawdown',
  'failureRate',
  'communication',
  'reliability',
  'security',
  'userFeedback'
]);

export const EXTERNAL_AGENT_REQUIRED_PERMISSIONS = Object.freeze([
  'smart-wallet',
  'session-key',
  'scoped-permission',
  'transaction-policy',
  'temporary-authorization',
  'spending-limit',
  'expiration'
]);

const ID = /^[a-z0-9][a-z0-9._-]{1,63}$/;
const PUBLIC_TEXT = /^[^\u0000-\u001f\u007f]+$/;
const FORBIDDEN_KEY = /^(?:private.?key|seed(?:.?phrase)?|mnemonic|master.?password|wallet.?secret|raw.?secret|unrestricted.?signer|api.?secret|credential|cookie)$/i;
const RAW_SECRET = /(-----BEGIN[^-]*PRIVATE KEY-----|\b(?:0x)?[a-f0-9]{64}\b|\b(?:seed phrase|recovery phrase|mnemonic|private key|master password|raw secret)\b)/i;
const VERIFICATION_STATUSES = new Set(['unverified', 'under-review', 'verified', 'revoked', 'expired']);
const TRUSTED_CERTIFICATE_STATUSES = new Set(['active', 'certified']);
const TRUSTED_EVIDENCE_TYPES = new Set(['sandbox_test_run', 'code_review', 'documentation', 'signed_attestation', 'security_review']);
const SAFE_HANDSHAKE_TYPES = new Set(SOCIAL_TYPES.filter((type) => !['approve', 'reject'].includes(type)));
const TOKEN_FORBIDDEN = /withdraw|unrestricted|private.?key|seed|mnemonic|master.?password|bypass.?guardian|execute.?without.?user/i;

const finite = (value) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};
const bounded = (value) => {
  const n = finite(value);
  return n != null && n >= 0 && n <= 100 ? n : null;
};
const positive = (value) => {
  const n = finite(value);
  return n != null && n > 0 ? n : null;
};
const list = (value, mapper, max = 32) => Array.isArray(value)
  ? [...new Set(value.map(mapper).filter(Boolean))].slice(0, max)
  : [];
const text = (value, max = 180) => {
  if (typeof value !== 'string') return null;
  const result = value.trim().slice(0, max);
  return result && PUBLIC_TEXT.test(result) ? result : null;
};
const safeId = (value) => {
  const result = String(value || '').trim().toLowerCase();
  if (/^0x[a-f0-9]{40,}$/.test(result)) return null;
  return ID.test(result) ? result : null;
};
const chain = (value) => {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
};
const protocol = (value) => {
  const result = String(value || '').trim().toLowerCase();
  return /^[a-z0-9][a-z0-9._:-]{0,47}$/.test(result) ? result : null;
};
const asset = (value) => {
  const result = String(value || '').trim().toUpperCase();
  return /^[A-Z0-9][A-Z0-9._:-]{0,31}$/.test(result) ? result : null;
};

function containsForbiddenMaterial(value, seen = new Set(), depth = 0, keyName = '') {
  if (depth > 6 || value == null) return false;
  if (typeof value === 'string') {
    if (keyName.toLowerCase() === 'sha256' && /^[a-f0-9]{64}$/i.test(value.trim())) return false;
    return RAW_SECRET.test(value);
  }
  if (typeof value !== 'object' || seen.has(value)) return false;
  seen.add(value);
  return Object.entries(value).some(([key, child]) => FORBIDDEN_KEY.test(key) || containsForbiddenMaterial(child, seen, depth + 1, key));
}

function normalizeFees(value) {
  const source = Array.isArray(value)
    ? value
    : value && typeof value === 'object'
      ? Object.entries(value).map(([feeType, amount]) => ({ type: feeType, amount }))
      : [];
  return source.slice(0, 16).map((fee) => {
    const type = text(fee?.type, 48) || 'unspecified';
    const amount = finite(fee?.amount);
    return {
      type,
      amount: amount != null && amount >= 0 ? amount : null,
      currency: asset(fee?.currency) || 'USD',
      known: amount != null && amount >= 0
    };
  });
}

function normalizeEvidence(value) {
  return (Array.isArray(value) ? value : []).slice(0, 12).map((item) => ({
    type: TRUSTED_EVIDENCE_TYPES.has(item?.type) ? item.type : null,
    uri: typeof item?.uri === 'string' && /^https:\/\//i.test(item.uri) ? item.uri.slice(0, 300) : null,
    sha256: typeof item?.sha256 === 'string' && /^[a-f0-9]{64}$/i.test(item.sha256) ? item.sha256.toLowerCase() : null
  })).filter((item) => item.type && (item.uri || item.sha256));
}

function normalizeReputation(value) {
  if (!value || typeof value !== 'object') return {
    schema: EXTERNAL_AGENT_REPUTATION_SCHEMA,
    status: 'insufficient_data',
    sampleSize: null,
    confidence: 'none',
    successRate: null,
    categories: null,
    source: 'no-observed-evidence'
  };
  const sampleSize = positive(value.sampleSize);
  const categoryValues = {};
  for (const category of EXTERNAL_AGENT_REPUTATION_CATEGORIES) {
    const n = bounded(value.categories?.[category] ?? value[category]);
    if (n != null) categoryValues[category] = n;
  }
  const successRate = bounded(value.successRate == null ? null : Number(value.successRate) * (Number(value.successRate) <= 1 ? 1 : 0.01));
  const observed = value.status === 'observed' && sampleSize != null && sampleSize >= 5;
  return {
    schema: EXTERNAL_AGENT_REPUTATION_SCHEMA,
    status: observed ? 'observed' : 'insufficient_data',
    sampleSize: observed ? Math.round(sampleSize) : null,
    confidence: observed && ['low', 'medium', 'high'].includes(value.confidence) ? value.confidence : 'none',
    successRate: observed ? successRate : null,
    categories: observed && Object.keys(categoryValues).length ? categoryValues : null,
    windowDays: positive(value.windowDays),
    source: observed ? 'observed-platform-evidence' : 'no-observed-evidence'
  };
}

function normalizeVerification(input, trustedVerification, now) {
  const verification = input?.verification && typeof input.verification === 'object' ? input.verification : {};
  const certificateStatus = String(verification.status || '').toLowerCase();
  const issuers = list(verification.issuers || (verification.issuer ? [verification.issuer] : []), (item) => text(item, 64), 4);
  const evidence = normalizeEvidence(verification.evidence);
  const expiresAt = finite(verification.expiresAt);
  const active = trustedVerification
    && TRUSTED_CERTIFICATE_STATUSES.has(certificateStatus)
    && issuers.length > 0
    && (evidence.length > 0 || verification.method === 'reviewer_certified')
    && (expiresAt == null || expiresAt > now);
  return {
    status: active ? 'verified' : certificateStatus === 'revoked' ? 'revoked' : 'unverified',
    independentlyVerified: active,
    method: text(verification.method, 48) || 'unknown',
    issuers,
    evidence,
    issuedAt: finite(verification.issuedAt),
    expiresAt
  };
}

/**
 * Sanitize a passport. `trustedVerification` must only be true for a response
 * already derived by FBT's trusted server registry; a listing cannot mark
 * itself verified by setting `securityStatus: "verified"`.
 */
export function sanitizeExternalAgentPassport(input = {}, { trustedVerification = false, now = Date.now(), source = 'runtime' } = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return { ok: false, code: 'INVALID_EXTERNAL_AGENT' };
  if (containsForbiddenMaterial(input)) return { ok: false, code: 'RAW_CREDENTIAL_FORBIDDEN' };
  const id = safeId(input.id);
  if (!id) return { ok: false, code: 'INVALID_AGENT_ID' };
  const verification = normalizeVerification(input, trustedVerification, now);
  const sandboxInput = input.sandbox && typeof input.sandbox === 'object' ? input.sandbox : {};
  const sandboxStage = EXTERNAL_AGENT_SANDBOX_STAGES.includes(sandboxInput.stage)
    ? sandboxInput.stage
    : 'discovery';
  const completedSandboxStages = list(sandboxInput.completedStages, (item) => EXTERNAL_AGENT_SANDBOX_STAGES.includes(item) ? item : null, EXTERNAL_AGENT_SANDBOX_STAGES.length);
  const sandboxEvidence = Object.fromEntries(EXTERNAL_AGENT_SANDBOX_STAGES
    .filter((stage) => Array.isArray(sandboxInput.evidence?.[stage]))
    .map((stage) => [stage, normalizeEvidence(sandboxInput.evidence[stage])]));
  const sandboxComplete = EXTERNAL_AGENT_SANDBOX_STAGES.every((stage) => completedSandboxStages.includes(stage)
    && sandboxEvidence[stage]?.length > 0);
  const requiredPermissions = list(
    input.requiredPermissions || EXTERNAL_AGENT_REQUIRED_PERMISSIONS,
    (item) => String(item || '').trim().toLowerCase().replace(/\s+/g, '-'),
    16
  ).filter((item) => !TOKEN_FORBIDDEN.test(item));
  const passport = {
    schema: EXTERNAL_AGENT_PASSPORT_SCHEMA,
    version: 1,
    id,
    name: text(input.name, 96) || id,
    creator: text(input.creator, 96) || 'not-disclosed',
    capabilities: list(input.capabilities, (item) => String(item || '').trim().toLowerCase(), 32),
    supportedChains: list(input.supportedChains, chain, 16),
    supportedAssets: list(input.supportedAssets, asset, 48),
    supportedProtocols: list(input.supportedProtocols, protocol, 32),
    financialFunctions: list(input.financialFunctions, (item) => text(item, 64), 24),
    fees: normalizeFees(input.fees),
    verification: {
      status: verification.status,
      independentlyVerified: verification.independentlyVerified,
      method: verification.method,
      issuers: verification.issuers,
      evidence: verification.evidence,
      issuedAt: verification.issuedAt,
      expiresAt: verification.expiresAt
    },
    securityStatus: verification.status,
    security: {
      schema: EXTERNAL_AGENT_SECURITY_SCHEMA,
      independentlyVerified: verification.independentlyVerified,
      rawCredentialsAllowed: false,
      unrestrictedSigner: false,
      custody: false,
      guardianRequired: true,
      userAuthorizationRequired: true,
      issuers: verification.issuers,
      evidence: verification.evidence
    },
    reputation: normalizeReputation(input.reputation),
    historicalPerformance: normalizeReputation(input.historicalPerformance),
    lastVerification: verification.issuedAt,
    verificationExpiresAt: verification.expiresAt,
    requiredPermissions,
    maxCapitalUsd: positive(input.maxCapitalUsd),
    maxTransactionUsd: positive(input.maxTransactionUsd),
    expiresAt: finite(input.expiresAt),
    sandbox: {
      schema: EXTERNAL_AGENT_SANDBOX_SCHEMA,
      stage: sandboxStage,
      completedStages: completedSandboxStages,
      evidence: sandboxEvidence,
      operatorApproved: sandboxInput.operatorApproved === true,
      productionReady: sandboxStage === 'production'
        && verification.independentlyVerified
        && sandboxInput.operatorApproved === true
        && sandboxComplete,
      unrestrictedAuthority: false,
      limitedCapitalOnly: sandboxStage !== 'production' || !sandboxComplete
    },
    source: text(source, 48) || 'runtime',
    automaticExecution: false,
    executionPermission: false,
    rawCredentialsPersisted: false
  };
  return { ok: true, passport };
}

/** Convert a server-derived ecosystem catalog row into a trust-aware passport. */
export function passportFromCatalog(row, options = {}) {
  return sanitizeExternalAgentPassport(row, { ...options, trustedVerification: true, source: 'server-catalog' });
}

function requiredCapabilities(intent = {}) {
  return list(intent.requiredCapabilities || intent.capabilities, (item) => String(item || '').trim().toLowerCase(), 16);
}

function publicFailure(code, detail = null) {
  return { code, detail: detail ? String(detail).slice(0, 160) : null };
}

/**
 * Evaluate a passport for a requested stage. A passport may be discovered and
 * discussed before it is execution-eligible, but the execution result is only
 * true after every trust, scope, Guardian and user gate passes.
 */
export function evaluateExternalAgentSecurity(passport, {
  stage = 'analysis',
  chainId = null,
  asset: requestedAsset = null,
  protocol: requestedProtocol = null,
  amountUsd = null,
  capitalUsd = null,
  requiredCapabilities: requestedCapabilities = [],
  policy = null,
  sandbox = null,
  userAuthorized = false,
  guardianApproved = false,
  now = Date.now()
} = {}) {
  const failures = [];
  if (!passport || passport.schema !== EXTERNAL_AGENT_PASSPORT_SCHEMA) failures.push(publicFailure('INVALID_PASSPORT'));
  if (passport && (passport.securityStatus !== 'verified'
    || passport.verification?.independentlyVerified !== true
    || passport.security?.independentlyVerified !== true)) failures.push(publicFailure('AGENT_NOT_VERIFIED'));
  if (passport?.expiresAt != null && Number(passport.expiresAt) <= now) failures.push(publicFailure('AGENT_PASSPORT_EXPIRED'));
  if (passport?.verificationExpiresAt != null && Number(passport.verificationExpiresAt) <= now) failures.push(publicFailure('AGENT_VERIFICATION_EXPIRED'));
  if (passport?.security?.rawCredentialsAllowed !== false || passport?.security?.unrestrictedSigner !== false || passport?.security?.custody !== false) {
    failures.push(publicFailure('UNSAFE_AGENT_SECURITY_CLAIMS'));
  }
  if (chainId != null && !passport?.supportedChains?.includes(Number(chainId))) failures.push(publicFailure('CHAIN_NOT_SUPPORTED'));
  if (requestedAsset && !passport?.supportedAssets?.includes(asset(requestedAsset))) failures.push(publicFailure('ASSET_NOT_SUPPORTED'));
  if (requestedProtocol && !passport?.supportedProtocols?.includes(protocol(requestedProtocol))) failures.push(publicFailure('PROTOCOL_NOT_SUPPORTED'));
  const capabilities = list(requestedCapabilities, (item) => String(item || '').trim().toLowerCase(), 16);
  for (const capability of capabilities) {
    if (!passport?.capabilities?.includes(capability)) failures.push(publicFailure('CAPABILITY_NOT_SUPPORTED', capability));
  }

  const numericAmount = finite(amountUsd);
  const numericCapital = finite(capitalUsd);
  if (stage === 'execution') {
    if (numericAmount == null || numericAmount <= 0) failures.push(publicFailure('EXECUTION_AMOUNT_REQUIRED'));
    if (numericCapital == null || numericCapital <= 0) failures.push(publicFailure('EXECUTION_CAPITAL_REQUIRED'));
    if (passport?.maxTransactionUsd == null) failures.push(publicFailure('AGENT_TRANSACTION_LIMIT_UNKNOWN'));
    if (passport?.maxCapitalUsd == null) failures.push(publicFailure('AGENT_CAPITAL_LIMIT_UNKNOWN'));
    if (numericAmount != null && passport?.maxTransactionUsd != null && numericAmount > passport.maxTransactionUsd) failures.push(publicFailure('AGENT_TRANSACTION_LIMIT'));
    if (numericCapital != null && passport?.maxCapitalUsd != null && numericCapital > passport.maxCapitalUsd) failures.push(publicFailure('AGENT_CAPITAL_LIMIT'));
    const activeSandbox = sandbox || passport?.sandbox;
    const sandboxStages = Array.isArray(activeSandbox?.completedStages) ? activeSandbox.completedStages : [];
    const sandboxEvidenceComplete = EXTERNAL_AGENT_SANDBOX_STAGES.every((sandboxStage) =>
      sandboxStages.includes(sandboxStage) && Array.isArray(activeSandbox?.evidence?.[sandboxStage]) && activeSandbox.evidence[sandboxStage].length > 0
    );
    if (activeSandbox?.stage !== 'production' || activeSandbox?.productionReady !== true || activeSandbox?.operatorApproved !== true || !sandboxEvidenceComplete) {
      failures.push(publicFailure('SANDBOX_NOT_COMPLETE'));
    }
    const missingPermissions = EXTERNAL_AGENT_REQUIRED_PERMISSIONS.filter((permission) => !passport?.requiredPermissions?.includes(permission));
    if (missingPermissions.length) failures.push(publicFailure('SCOPED_PERMISSIONS_INCOMPLETE', missingPermissions.join(',')));
    if (userAuthorized !== true) failures.push(publicFailure('USER_AUTHORIZATION_REQUIRED'));
    if (guardianApproved !== true) failures.push(publicFailure('GUARDIAN_REQUIRED'));
  }

  const uniqueFailures = [...new Map(failures.map((item) => [`${item.code}:${item.detail || ''}`, item])).values()];
  const trustOk = uniqueFailures.length === 0;
  return {
    ok: trustOk,
    schema: EXTERNAL_AGENT_SECURITY_SCHEMA,
    stage,
    agentId: passport?.id || null,
    failures: uniqueFailures,
    analysisEligible: trustOk && stage !== 'execution',
    executionEligible: trustOk && stage === 'execution',
    rawCredentialsAllowed: false,
    guardianCanBlock: true,
    scoreNeverVerifies: true
  };
}

/**
 * Discover compatible agents. No candidate is automatically enabled or
 * selected; an unverified listing is visible only as a blocked candidate.
 */
export function discoverExternalAgents({
  agents = [],
  intent = {},
  now = Date.now(),
  trustedRegistry = false,
  source = 'runtime-input'
} = {}) {
  const candidates = [];
  const rejected = [];
  const required = requiredCapabilities(intent);
  const requestedChain = intent.chainId ?? intent.fromChain ?? null;
  const requestedAsset = intent.asset || intent.fromSymbol || null;
  const requestedProtocol = intent.protocol || null;
  for (const input of Array.isArray(agents) ? agents.slice(0, 100) : []) {
    const converted = trustedRegistry
      ? passportFromCatalog(input, { now })
      : sanitizeExternalAgentPassport(input, { now, source });
    if (!converted.ok) {
      rejected.push({ id: safeId(input?.id), code: converted.code });
      continue;
    }
    const security = evaluateExternalAgentSecurity(converted.passport, {
      stage: 'analysis',
      chainId: requestedChain,
      asset: requestedAsset,
      protocol: requestedProtocol,
      requiredCapabilities: required,
      now
    });
    const compatibility = {
      chain: requestedChain == null || converted.passport.supportedChains.includes(Number(requestedChain)),
      asset: !requestedAsset || converted.passport.supportedAssets.includes(asset(requestedAsset)),
      protocol: !requestedProtocol || converted.passport.supportedProtocols.includes(protocol(requestedProtocol)),
      capabilities: required.every((capability) => converted.passport.capabilities.includes(capability))
    };
    const matches = Object.values(compatibility).every(Boolean);
    const score = converted.passport.reputation.status === 'observed'
      ? Math.round((converted.passport.reputation.successRate ?? 0) * 100)
      : null;
    candidates.push({
      schema: EXTERNAL_AGENT_DISCOVERY_SCHEMA,
      passport: converted.passport,
      compatibility,
      matches,
      trustStatus: converted.passport.securityStatus,
      eligibleForAnalysis: matches && security.analysisEligible,
      eligibleForExecution: false,
      score,
      scoreStatus: score == null ? 'insufficient_data' : 'observed',
      userChoiceRequired: true,
      automaticEnable: false,
      executionBlockers: [
        ...(converted.passport.securityStatus === 'verified' ? [] : ['AGENT_NOT_VERIFIED']),
        'USER_AUTHORIZATION_REQUIRED',
        'GUARDIAN_REQUIRED',
        ...(converted.passport.sandbox.stage === 'production' ? [] : ['SANDBOX_NOT_COMPLETE'])
      ]
    });
  }
  candidates.sort((a, b) => Number(b.eligibleForAnalysis) - Number(a.eligibleForAnalysis) || (b.score ?? -1) - (a.score ?? -1) || a.passport.id.localeCompare(b.passport.id));
  return {
    schema: EXTERNAL_AGENT_DISCOVERY_SCHEMA,
    source,
    dataStatus: source === 'unavailable' ? 'unavailable' : 'live',
    generatedAt: new Date(now).toISOString(),
    intent: intent?.id || null,
    requiredCapabilities: required,
    candidates,
    rejected,
    recommendations: candidates.filter((candidate) => candidate.eligibleForAnalysis).map((candidate) => ({
      agentId: candidate.passport.id,
      name: candidate.passport.name,
      why: 'Compatible evidence-backed capability match; independent verification and user choice remain required.',
      userChoiceRequired: true,
      automaticEnable: false
    })),
    selectedAgentId: null,
    noAutomaticExecution: true,
    rawCredentialsAllowed: false
  };
}

/** Start the mandatory external-agent sandbox pipeline at discovery. */
export function createExternalAgentSandbox(passport, { now = Date.now() } = {}) {
  if (!passport || passport.schema !== EXTERNAL_AGENT_PASSPORT_SCHEMA) return { ok: false, code: 'INVALID_PASSPORT' };
  const discoveryEvidence = normalizeEvidence(passport.security?.evidence);
  return {
    ok: true,
    sandbox: {
      schema: EXTERNAL_AGENT_SANDBOX_SCHEMA,
      agentId: passport.id,
      stage: 'discovery',
      completedStages: discoveryEvidence.length ? ['discovery'] : [],
      evidence: discoveryEvidence.length ? { discovery: discoveryEvidence } : {},
      productionReady: false,
      executionAllowed: false,
      unrestrictedAuthority: false,
      createdAt: now,
      updatedAt: now
    }
  };
}

/** Advance one sandbox stage only; skipping evidence or stages is refused. */
export function advanceExternalAgentSandbox(sandbox, {
  nextStage,
  evidence = [],
  operatorApproved = false,
  now = Date.now()
} = {}) {
  if (!sandbox || sandbox.schema !== EXTERNAL_AGENT_SANDBOX_SCHEMA) return { ok: false, code: 'INVALID_SANDBOX' };
  const currentIndex = EXTERNAL_AGENT_SANDBOX_STAGES.indexOf(sandbox.stage);
  const nextIndex = EXTERNAL_AGENT_SANDBOX_STAGES.indexOf(nextStage);
  if (currentIndex < 0 || nextIndex !== currentIndex + 1) return { ok: false, code: 'SANDBOX_STAGE_ORDER_REQUIRED' };
  if (!sandbox.completedStages?.includes(sandbox.stage) || !Array.isArray(sandbox.evidence?.[sandbox.stage]) || sandbox.evidence[sandbox.stage].length === 0) {
    return { ok: false, code: 'SANDBOX_CURRENT_STAGE_EVIDENCE_REQUIRED' };
  }
  const checkedEvidence = normalizeEvidence(evidence);
  if (!checkedEvidence.length) return { ok: false, code: 'SANDBOX_EVIDENCE_REQUIRED' };
  if (nextStage === 'production' && operatorApproved !== true) return { ok: false, code: 'PRODUCTION_OPERATOR_APPROVAL_REQUIRED' };
  const completedStages = [...new Set([...(sandbox.completedStages || []), nextStage])];
  const next = {
    ...sandbox,
    stage: nextStage,
    completedStages,
    evidence: { ...(sandbox.evidence || {}), [nextStage]: checkedEvidence },
    operatorApproved: nextStage === 'production' ? operatorApproved === true : sandbox.operatorApproved === true,
    productionReady: nextStage === 'production',
    executionAllowed: false,
    unrestrictedAuthority: false,
    updatedAt: now
  };
  return { ok: true, sandbox: next };
}

/** Create a non-executable greeting/evidence handshake after independent verification. */
export function createExternalAgentHandshake(passport, { intent = {}, now = Date.now() } = {}) {
  if (!passport || passport.schema !== EXTERNAL_AGENT_PASSPORT_SCHEMA) return { ok: false, code: 'INVALID_PASSPORT' };
  if (passport.securityStatus !== 'verified') return { ok: false, code: 'AGENT_NOT_VERIFIED' };
  const first = socialMessage('fbt-ai', passport.id, 'greeting', {
    role: 'FBT Intent AI',
    objective: 'Find a strategy matching the user intent and risk limits.',
    credentialsRequested: false,
    intentId: text(intent.id, 96)
  });
  return {
    ok: true,
    handshake: {
      schema: EXTERNAL_AGENT_HANDSHAKE_SCHEMA,
      id: `handshake_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
      participants: ['fbt-ai', passport.id],
      agentId: passport.id,
      status: 'awaiting-evidence',
      messages: [first],
      executable: false,
      credentialsRequested: false,
      startedAt: now
    }
  };
}

/** Append only social/evidence dialogue; command-like or secret content is rejected. */
export function externalAgentHandshakeTurn(handshake, from, type, detail = {}) {
  if (!handshake || handshake.schema !== EXTERNAL_AGENT_HANDSHAKE_SCHEMA) return { ok: false, code: 'INVALID_HANDSHAKE' };
  if (!handshake.participants.includes(String(from))) return { ok: false, code: 'NON_PARTICIPANT' };
  if (!SAFE_HANDSHAKE_TYPES.has(type) || !isSocialType(type)) return { ok: false, code: 'NON_SOCIAL_MESSAGE' };
  if (containsForbiddenMaterial(detail) || TOKEN_FORBIDDEN.test(JSON.stringify(detail || {}))) return { ok: false, code: 'FORBIDDEN_MESSAGE_CONTENT' };
  let message;
  try {
    message = socialMessage(String(from), handshake.participants.find((id) => id !== String(from)) || 'fbt-ai', type, {
      ...(detail && typeof detail === 'object' ? detail : { message: String(detail || '') }),
      credentialsRequested: false
    });
  } catch {
    return { ok: false, code: 'FORBIDDEN_MESSAGE_CONTENT' };
  }
  const messages = [...handshake.messages, message].slice(-200);
  return {
    ok: true,
    handshake: {
      ...handshake,
      messages,
      status: type === 'goodbye' ? 'closed' : type === 'request-evidence' ? 'awaiting-evidence' : 'active',
      executable: false,
      credentialsRequested: false
    },
    message
  };
}

export function handshakeTranscript(handshake) {
  return Array.isArray(handshake?.messages)
    ? handshake.messages.map((message) => ({ ...message, isCommand: false, isExecutable: false }))
    : [];
}

/**
 * Build observed reputation from aggregate samples. Thin samples expose no
 * percentage, and no caller can turn this result into verification.
 */
export function buildExternalAgentReputation(samples = [], { now = Date.now(), windowDays = 30 } = {}) {
  const valid = (Array.isArray(samples) ? samples : []).filter((sample) => (
    sample && typeof sample === 'object'
    && typeof sample.agentId === 'string'
    && safeId(sample.agentId)
    && sample.observed === true
    && (sample.confirmed === true || sample.outcome === 'failed' || sample.outcome === 'cancelled')
  ));
  const subjectIds = [...new Set(valid.map((sample) => safeId(sample.agentId)))].slice(0, 100);
  const agents = {};
  for (const agentId of subjectIds) {
    const rows = valid.filter((sample) => safeId(sample.agentId) === agentId);
    const decided = rows.filter((sample) => sample.outcome === 'completed' || sample.outcome === 'failed');
    const categories = {};
    for (const category of EXTERNAL_AGENT_REPUTATION_CATEGORIES) {
      const values = rows.map((row) => bounded(row.categories?.[category] ?? row[category])).filter((value) => value != null);
      if (values.length) categories[category] = Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
    }
    if (decided.length < 5) {
      agents[agentId] = {
        schema: EXTERNAL_AGENT_REPUTATION_SCHEMA,
        agentId,
        status: 'insufficient_data',
        sampleSize: null,
        successRate: null,
        categories: null,
        confidence: 'none',
        windowDays,
        source: 'observed-session-evidence'
      };
    } else {
      agents[agentId] = {
        schema: EXTERNAL_AGENT_REPUTATION_SCHEMA,
        agentId,
        status: 'observed',
        sampleSize: decided.length,
        successRate: Number((decided.filter((row) => row.outcome === 'completed').length / decided.length).toFixed(4)),
        categories: Object.keys(categories).length ? categories : null,
        confidence: decided.length >= 50 ? 'medium' : 'low',
        windowDays,
        source: 'observed-session-evidence'
      };
    }
  }
  return { schema: EXTERNAL_AGENT_REPUTATION_SCHEMA, generatedAt: now, windowDays, agents };
}

/** Ratings are audit data only; they never change trust, Guardian or execution permissions. */
export function createBidirectionalAgentRating({
  sessionCompleted = false,
  fromAgent,
  toAgent,
  ratings = {},
  evidence = [],
  now = Date.now()
} = {}) {
  const from = safeId(fromAgent);
  const to = safeId(toAgent);
  if (!sessionCompleted) return { ok: false, code: 'SESSION_NOT_COMPLETED' };
  if (!from || !to || from === to) return { ok: false, code: 'INVALID_RATING_PARTICIPANTS' };
  if (containsForbiddenMaterial(ratings) || containsForbiddenMaterial(evidence)) return { ok: false, code: 'RAW_CREDENTIAL_FORBIDDEN' };
  const normalized = {};
  for (const category of EXTERNAL_AGENT_REPUTATION_CATEGORIES) {
    const value = bounded(ratings[category]);
    if (value == null) return { ok: false, code: 'RATING_CATEGORY_REQUIRED', category };
    normalized[category] = value;
  }
  return {
    ok: true,
    rating: {
      schema: EXTERNAL_AGENT_RATING_SCHEMA,
      fromAgent: from,
      toAgent: to,
      categories: normalized,
      evidence: normalizeEvidence(evidence),
      observed: false,
      trustChanged: false,
      executionPermissionChanged: false,
      createdAt: now
    }
  };
}

/**
 * Issue opaque, bounded external-agent handles only after all gates pass.
 * The returned public objects contain no private key or master credential.
 */
export function authorizeExternalAgentScope({
  passport,
  intent = {},
  policy = {},
  sandbox = null,
  userAuthorized = false,
  guardianApproved = false,
  now = Date.now(),
  ttlMs = 15 * 60 * 1000
} = {}) {
  const amountUsd = finite(intent.amountUsd);
  const capitalUsd = finite(intent.capitalUsd ?? intent.amountUsd);
  const security = evaluateExternalAgentSecurity(passport, {
    stage: 'execution',
    chainId: intent.chainId,
    asset: intent.asset || intent.fromSymbol,
    protocol: intent.protocol,
    amountUsd,
    capitalUsd,
    requiredCapabilities: requiredCapabilities(intent),
    policy,
    sandbox,
    userAuthorized,
    guardianApproved,
    now
  });
  if (!security.executionEligible) return { ok: false, code: security.failures[0]?.code || 'EXTERNAL_AGENT_NOT_AUTHORIZED', security };

  const policyId = safeId(policy.id);
  if (!policyId) return { ok: false, code: 'POLICY_ID_REQUIRED', security };
  const passportChains = new Set(passport.supportedChains || []);
  const passportProtocols = new Set(passport.supportedProtocols || []);
  const requestedChains = Array.isArray(policy.allowedChains) ? policy.allowedChains : passport.supportedChains;
  const requestedProtocols = Array.isArray(policy.allowedProtocols) ? policy.allowedProtocols : passport.supportedProtocols;
  const allowedChains = list(requestedChains, chain, 16).filter((value) => passportChains.has(value));
  const allowedProtocols = list(requestedProtocols, protocol, 16).filter((value) => passportProtocols.has(value));
  if (!allowedChains.length) return { ok: false, code: 'CHAIN_SCOPE_REQUIRED', security };
  if (!allowedProtocols.length) return { ok: false, code: 'PROTOCOL_SCOPE_REQUIRED', security };
  if (intent.chainId != null && !allowedChains.includes(Number(intent.chainId))) return { ok: false, code: 'CHAIN_OUT_OF_SCOPE', security };
  if (intent.protocol && !allowedProtocols.includes(protocol(intent.protocol))) return { ok: false, code: 'PROTOCOL_OUT_OF_SCOPE', security };
  const capabilities = requiredCapabilities(intent).length ? requiredCapabilities(intent) : ['analyze'];
  if (capabilities.some((capability) => TOKEN_FORBIDDEN.test(capability))) return { ok: false, code: 'FORBIDDEN_CAPABILITY', security };

  const policyCapitalLimit = finite(policy.maxCapitalUsd ?? policy.capitalLimitUsd);
  if (policyCapitalLimit != null && (policyCapitalLimit <= 0 || capitalUsd > policyCapitalLimit)) return { ok: false, code: 'POLICY_CAPITAL_LIMIT', security };
  const policyTransactionLimit = finite(policy.maxTransactionUsd ?? policy.transactionLimitUsd);
  if (policyTransactionLimit != null && (policyTransactionLimit <= 0 || amountUsd > policyTransactionLimit)) return { ok: false, code: 'POLICY_TRANSACTION_LIMIT', security };
  const policyRiskLimit = finite(policy.riskLimitPct);
  if (policyRiskLimit != null) {
    const riskPct = finite(intent.riskPct);
    if (riskPct == null) return { ok: false, code: 'RISK_LIMIT_UNKNOWN', security };
    if (riskPct > policyRiskLimit) return { ok: false, code: 'RISK_LIMIT_EXCEEDED', security };
  }
  const policyFeeLimit = finite(policy.feeLimitUsd ?? policy.maxFeeUsd);
  if (policyFeeLimit != null) {
    const feeUsd = finite(intent.feeUsd ?? intent.totalFeeUsd);
    if (feeUsd == null) return { ok: false, code: 'FEE_LIMIT_UNKNOWN', security };
    if (feeUsd > policyFeeLimit) return { ok: false, code: 'FEE_LIMIT_EXCEEDED', security };
  }
  const policyTimeLimit = finite(policy.timeLimitSeconds);
  if (policyTimeLimit != null) {
    const durationSeconds = finite(intent.durationSeconds);
    if (durationSeconds == null) return { ok: false, code: 'TIME_LIMIT_UNKNOWN', security };
    if (durationSeconds > policyTimeLimit) return { ok: false, code: 'TIME_LIMIT_EXCEEDED', security };
  }
  const policySlippageLimit = finite(policy.maxSlippagePct);
  if (policySlippageLimit != null) {
    const slippagePct = finite(intent.slippagePct);
    if (slippagePct == null) return { ok: false, code: 'SLIPPAGE_LIMIT_UNKNOWN', security };
    if (slippagePct > policySlippageLimit) return { ok: false, code: 'SLIPPAGE_LIMIT_EXCEEDED', security };
  }

  const externalExpiry = positive(passport.expiresAt);
  const policyExpiry = positive(policy.expiresAt);
  const requestedTtl = Math.max(0, Number(ttlMs) || 0);
  const ttlCandidates = [requestedTtl];
  if (externalExpiry != null) ttlCandidates.push(externalExpiry - now);
  if (policyExpiry != null) ttlCandidates.push(policyExpiry - now);
  const effectiveTtl = Math.min(...ttlCandidates);
  if (!Number.isFinite(effectiveTtl) || effectiveTtl < 60_000) return { ok: false, code: 'SCOPE_EXPIRATION_TOO_SHORT', security };
  const maxAmountUsd = Math.min(
    positive(passport.maxTransactionUsd) ?? Infinity,
    positive(policy.maxTransactionUsd) ?? Infinity,
    amountUsd ?? Infinity
  );
  if (!Number.isFinite(maxAmountUsd) || maxAmountUsd <= 0) return { ok: false, code: 'SCOPE_TRANSACTION_LIMIT_REQUIRED', security };

  const tokenResult = issueCapabilityToken({
    policyId,
    agentId: passport.id,
    capabilities,
    allowedChains,
    allowedProtocols,
    maxAmountUsd,
    ttlMs: effectiveTtl,
    now
  });
  if (!tokenResult.ok) return { ok: false, code: tokenResult.error?.code || 'CAPABILITY_TOKEN_FAILED', security };
  const keyResult = issueSessionKey({
    policyId,
    allowedChains,
    allowedProtocols,
    maxAmountUsd,
    ttlMs: effectiveTtl,
    now
  });
  if (!keyResult.ok) {
    revokeCapabilityToken(tokenResult.token);
    return { ok: false, code: keyResult.error?.code || 'SESSION_KEY_FAILED', security };
  }

  const action = {
    chainId: intent.chainId,
    protocol: intent.protocol,
    amountUsd,
    capabilities
  };
  const tokenScope = scopeCapabilityToken(tokenResult.token, action, { now });
  const keyScope = scopeFor(keyResult.sessionKey, {
    chainId: intent.chainId,
    protocol: intent.protocol,
    amountUsd
  }, { now });
  if (!tokenScope.ok || !keyScope.ok) {
    revokeCapabilityToken(tokenResult.token);
    revokeSessionKey(keyResult.sessionKey.id);
    return { ok: false, code: 'SCOPE_BOUNDARY_FAILED', tokenScope, keyScope, security };
  }

  const expiresAt = now + effectiveTtl;
  return {
    ok: true,
    schema: EXTERNAL_AGENT_SCOPE_SCHEMA,
    agentId: passport.id,
    policyId,
    capabilities,
    allowedChains,
    allowedProtocols,
    maxAmountUsd,
    issuedAt: now,
    expiresAt,
    userAuthorized: true,
    guardianApproved: true,
    smartWallet: true,
    rawCredentialsAllowed: false,
    automaticExecution: false,
    capabilityToken: tokenResult.token,
    sessionKey: keyResult.sessionKey,
    handlesOnly: true
  };
}

export function revokeExternalAgentScope(scope) {
  if (!scope || scope.schema !== EXTERNAL_AGENT_SCOPE_SCHEMA) return { ok: false, code: 'INVALID_SCOPE' };
  const token = scope.capabilityToken?.id || scope.capabilityToken?.handle || scope.capabilityToken;
  const key = scope.sessionKey?.id || scope.sessionKey;
  const tokenResult = token ? revokeCapabilityToken(token) : { ok: false, code: 'NO_CAPABILITY_TOKEN' };
  const keyResult = key ? revokeSessionKey(key) : { ok: false, code: 'NO_SESSION_KEY' };
  return { ok: tokenResult.ok && keyResult.ok, token: tokenResult, sessionKey: keyResult, revoked: true };
}
