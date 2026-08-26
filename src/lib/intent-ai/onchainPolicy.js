/**
 * FBT INTENT AI — Phase 17: on-chain Smart Account policy enforcement.
 *
 * Local policy and localStorage are advisory only. This boundary accepts an
 * on-chain policy as authoritative only after a provider has returned current
 * deployment/code/policy evidence. Missing contracts, RPCs, versions, or
 * revoke receipts are `unavailable`; another wallet or a changed client cannot
 * turn a local flag into an on-chain permission.
 */

import {
  FINANCIAL_LIMITS,
  containsRawSecret,
  fail,
  finite,
  safeId,
  safeString,
  unavailable
} from './phaseBoundary.js';

export const ONCHAIN_POLICY_SCHEMA = 'fbt.smart-account-policy.v1';
export const DEPLOYMENT_EVIDENCE_SCHEMA = 'fbt.policy-deployment-evidence.v1';
export const ONCHAIN_EVALUATION_SCHEMA = 'fbt.onchain-policy-evaluation.v1';
export const POLICY_MIGRATION_SCHEMA = 'fbt.policy-migration.v1';
export const ONCHAIN_REVOKE_SCHEMA = 'fbt.onchain-session-revoke.v1';

const ADDRESS = /^0x[0-9a-f]{40}$/i;
const HASH = /^(?:0x)?[0-9a-f]{64}$/i;
const VERSION = /^[A-Za-z0-9._:-]{1,64}$/;

function publicDeployment(input = {}) {
  if (!input || typeof input !== 'object' || containsRawSecret(input)) return null;
  const chainId = finite(input.chainId);
  const contractAddress = String(input.contractAddress || '').toLowerCase();
  const codeHash = String(input.codeHash || '').toLowerCase().replace(/^0x/, '');
  if (!Number.isInteger(chainId) || chainId <= 0 || !ADDRESS.test(contractAddress) || !HASH.test(codeHash)) return null;
  return {
    schema: DEPLOYMENT_EVIDENCE_SCHEMA,
    chainId,
    contractAddress,
    codeHash,
    deploymentBlock: Number.isInteger(Number(input.deploymentBlock)) && Number(input.deploymentBlock) >= 0 ? Number(input.deploymentBlock) : null,
    network: safeString(input.network, 48) || null,
    verifiedAt: finite(input.verifiedAt),
    source: safeString(input.source, 64) || 'provider',
    verified: input.verified === true
  };
}

/** Verify deployment against a live RPC/provider, never only a config string. */
export async function verifyPolicyDeployment({ deployment, provider = null, now = Date.now() } = {}) {
  if (deployment == null) return unavailable('ONCHAIN_DEPLOYMENT_UNAVAILABLE', 'No deployment evidence was supplied.');
  const expected = publicDeployment(deployment);
  if (!expected) return fail('DEPLOYMENT_EVIDENCE_INVALID');
  if (!provider || typeof provider.getCode !== 'function' || typeof provider.getPolicy !== 'function') return unavailable('ONCHAIN_PROVIDER_UNAVAILABLE', 'A contract RPC/provider is required.');
  try {
    const [code, policy] = await Promise.all([
      provider.getCode(expected.contractAddress, expected.chainId),
      provider.getPolicy(expected.contractAddress, expected.chainId)
    ]);
    if (typeof code !== 'string' || !/^0x[0-9a-f]+$/i.test(code) || code === '0x') return unavailable('CONTRACT_NOT_DEPLOYED');
    if (!policy || policy.ok !== true) return unavailable('ONCHAIN_POLICY_UNREADABLE');
    if (policy.codeHash && String(policy.codeHash).replace(/^0x/, '').toLowerCase() !== expected.codeHash) return fail('DEPLOYMENT_CODE_HASH_MISMATCH');
    if (expected.verifiedAt !== null && expected.verifiedAt > now) return fail('DEPLOYMENT_EVIDENCE_NOT_YET_VALID');
    const normalizedPolicy = publicOnchainPolicy(policy.policy || policy);
    if (!completeOnchainPolicy(normalizedPolicy)) return unavailable('ONCHAIN_POLICY_INCOMPLETE', 'Provider returned an incomplete policy; enforcement remains unavailable.');
    const providerId = safeId(policy.providerId || provider.id);
    if (!providerId) return unavailable('ONCHAIN_PROVIDER_ID_REQUIRED');
    return {
      ok: true,
      schema: DEPLOYMENT_EVIDENCE_SCHEMA,
      status: 'verified',
      deployment: { ...expected, verified: true, verifiedAt: expected.verifiedAt ?? now },
      policy: normalizedPolicy,
      providerEvidence: { providerId, checkedAt: now, codePresent: true, policyRead: true }
    };
  } catch { return unavailable('ONCHAIN_PROVIDER_ERROR', 'Contract or policy evidence could not be read.'); }
}

function publicOnchainPolicy(input = {}) {
  if (!input || typeof input !== 'object' || containsRawSecret(input)) return null;
  const limits = input.limits || input;
  const chains = Array.isArray(limits.chainAllowlist || limits.allowedChains) ? (limits.chainAllowlist || limits.allowedChains).map(Number).filter((n) => Number.isInteger(n) && n > 0) : [];
  const protocols = Array.isArray(limits.protocolAllowlist || limits.allowedProtocols) ? (limits.protocolAllowlist || limits.allowedProtocols).map((v) => String(v).toLowerCase()).filter(Boolean) : [];
  const values = {
    schema: ONCHAIN_POLICY_SCHEMA,
    policyId: safeId(input.policyId || input.id) || null,
    version: VERSION.test(String(input.version || '')) ? String(input.version) : null,
    capitalLimitUsd: finite(limits.capitalLimitUsd),
    transactionLimitUsd: finite(limits.transactionLimitUsd),
    riskLimitPct: finite(limits.riskLimitPct),
    protocolAllowlist: protocols,
    chainAllowlist: chains,
    timeLimitSeconds: finite(limits.timeLimitSeconds),
    feeLimitUsd: finite(limits.feeLimitUsd),
    slippageLimitPct: finite(limits.slippageLimitPct ?? limits.maxSlippagePct),
    revoked: input.revoked === true,
    updatedAt: finite(input.updatedAt)
  };
  return values;
}

function completeOnchainPolicy(policy) {
  if (!policy || !policy.version || !Array.isArray(policy.protocolAllowlist) || !policy.protocolAllowlist.length || !Array.isArray(policy.chainAllowlist) || !policy.chainAllowlist.length) return false;
  return ['capitalLimitUsd', 'transactionLimitUsd', 'riskLimitPct', 'timeLimitSeconds', 'feeLimitUsd', 'slippageLimitPct'].every((field) => finite(policy[field]) !== null);
}

function checkLimits(policy, request) {
  const missing = FINANCIAL_LIMITS.filter((limit) => {
    if (limit === 'protocol') return !Array.isArray(request.protocolAllowlist) || request.protocolAllowlist.length === 0;
    if (limit === 'chain') return !Array.isArray(request.chainAllowlist) || request.chainAllowlist.length === 0;
    return finite(request[limit]) === null;
  });
  if (missing.length) return fail('ONCHAIN_LIMITS_INCOMPLETE', missing.join(','), { missingLimits: missing });
  const pairs = [
    ['CAPITAL_LIMIT_EXCEEDED', request.capital <= policy.capitalLimitUsd],
    ['TRANSACTION_LIMIT_EXCEEDED', request.transaction <= policy.transactionLimitUsd],
    ['RISK_LIMIT_EXCEEDED', request.risk <= policy.riskLimitPct],
    ['TIME_LIMIT_EXCEEDED', request.time <= policy.timeLimitSeconds],
    ['FEE_LIMIT_EXCEEDED', request.fee <= policy.feeLimitUsd],
    ['SLIPPAGE_LIMIT_EXCEEDED', request.slippage <= policy.slippageLimitPct]
  ];
  for (const [code, ok] of pairs) if (!ok) return fail(code);
  if (!policy.protocolAllowlist.includes(request.protocol)) return fail('PROTOCOL_NOT_ALLOWED');
  if (!policy.chainAllowlist.includes(request.chain)) return fail('CHAIN_NOT_ALLOWED');
  return { ok: true };
}

/** Fail closed on any disagreement between local and on-chain versions/limits. */
export function evaluateOnchainPolicy({ deploymentEvidence, onchainPolicy, localPolicy = null, request = {}, now = Date.now() } = {}) {
  if (containsRawSecret(deploymentEvidence) || containsRawSecret(onchainPolicy) || containsRawSecret(localPolicy) || containsRawSecret(request)) return fail('RAW_CREDENTIAL_FORBIDDEN');
  const deployment = publicDeployment(deploymentEvidence);
  if (!deployment || deploymentEvidence?.verified !== true || deploymentEvidence?.schema !== DEPLOYMENT_EVIDENCE_SCHEMA) return unavailable('ONCHAIN_DEPLOYMENT_UNAVAILABLE', 'No verified deployment evidence exists.');
  const chainPolicy = publicOnchainPolicy(onchainPolicy);
  if (!completeOnchainPolicy(chainPolicy) || chainPolicy.revoked) return fail(chainPolicy?.revoked ? 'ONCHAIN_POLICY_REVOKED' : 'ONCHAIN_POLICY_UNAVAILABLE');
  if (localPolicy) {
    const local = publicOnchainPolicy(localPolicy);
    const policyFields = ['capitalLimitUsd', 'transactionLimitUsd', 'riskLimitPct', 'timeLimitSeconds', 'feeLimitUsd', 'slippageLimitPct'];
    if (!completeOnchainPolicy(local) || local.version !== chainPolicy.version || JSON.stringify(local.protocolAllowlist) !== JSON.stringify(chainPolicy.protocolAllowlist) || JSON.stringify(local.chainAllowlist) !== JSON.stringify(chainPolicy.chainAllowlist) || policyFields.some((field) => local[field] !== chainPolicy[field])) return fail('LOCAL_ONCHAIN_POLICY_MISMATCH');
  }
  if (deployment.verifiedAt !== null && deployment.verifiedAt > now) return fail('DEPLOYMENT_EVIDENCE_NOT_YET_VALID');
  const values = {
    capital: finite(request.capitalUsd ?? request.capital),
    transaction: finite(request.amountUsd ?? request.transactionUsd ?? request.transaction),
    risk: finite(request.riskPct ?? request.risk),
    protocol: String(request.protocol || '').toLowerCase(),
    chain: finite(request.chainId ?? request.chain),
    time: finite(request.durationSeconds ?? request.time),
    fee: finite(request.feeUsd ?? request.fee),
    slippage: finite(request.slippagePct ?? request.slippage),
    protocolAllowlist: chainPolicy.protocolAllowlist,
    chainAllowlist: chainPolicy.chainAllowlist
  };
  const checked = checkLimits(chainPolicy, values);
  if (!checked.ok) return checked;
  return {
    ok: true,
    schema: ONCHAIN_EVALUATION_SCHEMA,
    decision: 'ALLOW_REVIEW_ONLY',
    enforcement: 'provider-or-smart-account',
    deployment: { chainId: deployment.chainId, contractAddress: deployment.contractAddress, codeHash: deployment.codeHash },
    policyVersion: chainPolicy.version,
    checked: Object.fromEntries(FINANCIAL_LIMITS.map((limit) => [limit, true])),
    localPolicyCompared: Boolean(localPolicy),
    executionStillRequiresUserGuardianAdapter: true
  };
}

/** Migration requires sequential versions and a provider-confirmed result. */
export async function migrateOnchainPolicy({ provider = null, deploymentEvidence, fromVersion, toPolicy, now = Date.now() } = {}) {
  if (containsRawSecret(deploymentEvidence) || containsRawSecret(toPolicy)) return fail('RAW_CREDENTIAL_FORBIDDEN');
  const deployment = publicDeployment(deploymentEvidence);
  if (!deployment || deploymentEvidence?.verified !== true || deploymentEvidence?.schema !== DEPLOYMENT_EVIDENCE_SCHEMA) return unavailable('ONCHAIN_DEPLOYMENT_UNAVAILABLE');
  if (!provider || typeof provider.migratePolicy !== 'function') return unavailable('ONCHAIN_MIGRATION_PROVIDER_UNAVAILABLE');
  const next = publicOnchainPolicy(toPolicy);
  if (!completeOnchainPolicy(next) || !next?.version || !VERSION.test(String(fromVersion || '')) || next.version === fromVersion) return fail('POLICY_VERSION_INVALID');
  try {
    const result = await provider.migratePolicy({ chainId: deployment.chainId, contractAddress: deployment.contractAddress, fromVersion: String(fromVersion), toVersion: next.version, policy: next });
    if (!result || result.ok !== true || result.confirmed !== true) return unavailable('POLICY_MIGRATION_UNCONFIRMED');
    return { ok: true, schema: POLICY_MIGRATION_SCHEMA, status: 'confirmed', fromVersion: String(fromVersion), toVersion: next.version, receiptRef: safeString(result.receiptRef, 160) || null, confirmedAt: now, localStorageNotAuthoritative: true };
  } catch { return unavailable('POLICY_MIGRATION_FAILED'); }
}

/** Revoke at the provider/Smart Account boundary, not just in the browser. */
export async function revokeOnchainSession({ provider = null, deploymentEvidence, sessionId, now = Date.now() } = {}) {
  const deployment = publicDeployment(deploymentEvidence);
  if (!deployment || deploymentEvidence?.verified !== true || deploymentEvidence?.schema !== DEPLOYMENT_EVIDENCE_SCHEMA) return unavailable('ONCHAIN_DEPLOYMENT_UNAVAILABLE');
  if (!provider || typeof provider.revokeSession !== 'function') return unavailable('ONCHAIN_REVOKE_PROVIDER_UNAVAILABLE');
  const id = safeId(sessionId);
  if (!id) return fail('SESSION_ID_REQUIRED');
  try {
    const result = await provider.revokeSession({ chainId: deployment.chainId, contractAddress: deployment.contractAddress, sessionId: id });
    if (!result || result.ok !== true || result.confirmed !== true) return unavailable('ONCHAIN_REVOKE_UNCONFIRMED');
    return { ok: true, schema: ONCHAIN_REVOKE_SCHEMA, sessionId: id, revoked: true, confirmed: true, receiptRef: safeString(result.receiptRef, 160) || null, revokedAt: now };
  } catch { return unavailable('ONCHAIN_REVOKE_FAILED'); }
}

export function onchainPolicyStatus({ deployment = null, provider = null } = {}) {
  const configured = Boolean(deployment && provider);
  return {
    schema: ONCHAIN_POLICY_SCHEMA,
    configured,
    operational: false,
    status: configured ? 'configured-not-verified' : 'unavailable',
    deploymentEvidence: Boolean(deployment?.verified),
    providerConnected: Boolean(provider),
    enforcementOutsideLocalStorage: Boolean(deployment?.verified),
    blocker: deployment?.verified ? 'RUNTIME_POLICY_HEALTH_CHECK_REQUIRED' : 'ONCHAIN_DEPLOYMENT_EVIDENCE_REQUIRED'
  };
}
