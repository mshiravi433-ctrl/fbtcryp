/**
 * FBT INTENT AI — Phase 16: execution adapter activation.
 *
 * Wallet, broker and bridge adapters share one no-sign boundary. An adapter is
 * not live because a module or env variable exists: provider health, signer
 * availability, venue evidence and a passing simulation are required at the
 * exact request boundary. Every failure path returns before `signer` is
 * called. Bridge adapters remain unavailable until a real reviewed adapter is
 * injected.
 */

import {
  assertFinancialExecution,
  containsRawSecret,
  fail,
  finite,
  publicRuntimeEvidence,
  safeId,
  safeString,
  unavailable
} from './phaseBoundary.js';

export const EXECUTION_ADAPTER_SCHEMA = 'fbt.execution-adapter.v1';
export const ADAPTER_READINESS_SCHEMA = 'fbt.execution-adapter-readiness.v1';
export const TRANSACTION_SIMULATION_SCHEMA = 'fbt.transaction-simulation.v1';
export const EXECUTION_ATTEMPT_SCHEMA = 'fbt.execution-attempt.v1';
export const ADAPTER_KINDS = Object.freeze(['wallet', 'broker', 'bridge']);

const executions = new Map();
const TX_RE = /^0x[0-9a-f]+$/i;
const ADDRESS_RE = /^0x[0-9a-f]{40}$/i;
const ID_RE = /^[a-z0-9][a-z0-9._:-]{1,95}$/i;

function publicTransaction(tx = {}) {
  if (!tx || typeof tx !== 'object') return null;
  return {
    chainId: Number.isInteger(Number(tx.chainId)) ? Number(tx.chainId) : null,
    to: ADDRESS_RE.test(String(tx.to || '')) ? String(tx.to).toLowerCase() : null,
    data: TX_RE.test(String(tx.data || '')) ? String(tx.data).toLowerCase() : null,
    value: finite(tx.value),
    nonce: Number.isInteger(Number(tx.nonce)) ? Number(tx.nonce) : null
  };
}

/** The exact recipient and calldata must be rechecked immediately pre-sign. */
export function verifyTransactionRequest({ transaction, expected = {}, chainId = null } = {}) {
  if (!transaction || typeof transaction !== 'object' || containsRawSecret(transaction)) return fail('TRANSACTION_INVALID');
  const tx = publicTransaction(transaction);
  if (tx.chainId === null || tx.to === null || tx.data === null) return fail('TRANSACTION_FIELDS_REQUIRED');
  if (chainId !== null && tx.chainId !== Number(chainId)) return fail('CHAIN_MISMATCH');
  if (expected.chainId != null && tx.chainId !== Number(expected.chainId)) return fail('CHAIN_MISMATCH');
  if (expected.to && tx.to !== String(expected.to).toLowerCase()) return fail('RECIPIENT_MISMATCH');
  if (expected.data && tx.data !== String(expected.data).toLowerCase()) return fail('CALLDATA_MISMATCH');
  if (expected.maxValue != null && (tx.value === null || tx.value > Number(expected.maxValue))) return fail('VALUE_LIMIT_EXCEEDED');
  return { ok: true, schema: EXECUTION_ADAPTER_SCHEMA, transaction: tx, recipientRechecked: true, calldataRechecked: true };
}

function providerHealth(provider, now) {
  if (!provider || typeof provider.health !== 'function') return { ok: false, code: 'PROVIDER_UNAVAILABLE' };
  try {
    const health = provider.health();
    if (!health || health.ok !== true || health.operational !== true || health.attested !== true) return { ok: false, code: 'PROVIDER_NOT_OPERATIONAL' };
    if (health.expiresAt != null && Number(health.expiresAt) <= now) return { ok: false, code: 'PROVIDER_EVIDENCE_EXPIRED' };
    const providerId = safeId(health.providerId || health.id);
    if (!providerId) return { ok: false, code: 'PROVIDER_ID_REQUIRED' };
    const venueHealthy = health.venueHealth === 'healthy' || health.venueHealthy === true || health.venue?.status === 'healthy';
    return { ok: true, health: { providerId, checkedAt: now, expiresAt: finite(health.expiresAt), health: 'operational', attested: true, venueHealthy, signer: health.signer === true, contract: health.contract === true } };
  } catch { return { ok: false, code: 'PROVIDER_HEALTH_FAILED' }; }
}

/** Readiness never returns `live`; it returns evidence for the caller to gate. */
export function checkAdapterReadiness({ adapter = null, provider = null, signer = null, environment = 'production', now = Date.now() } = {}) {
  if (!adapter || typeof adapter !== 'object') return unavailable('ADAPTER_UNAVAILABLE', 'No adapter is registered.', { schema: ADAPTER_READINESS_SCHEMA });
  const kind = ADAPTER_KINDS.includes(adapter.kind) ? adapter.kind : null;
  if (!kind) return fail('ADAPTER_KIND_INVALID');
  if ((adapter.mock === true || adapter.environment === 'mock') && environment !== 'test') return unavailable('MOCK_ADAPTER_FORBIDDEN', 'Mock adapters cannot be activated in production.');
  const health = providerHealth(provider, now);
  if (!health.ok) return unavailable(health.code, 'Provider health evidence is missing or not operational.', { schema: ADAPTER_READINESS_SCHEMA, kind });
  const venueHealthy = adapter.venueHealth === 'healthy' || adapter.venueHealthy === true || health.health.venueHealthy === true;
  if (!venueHealthy) return unavailable('VENUE_HEALTH_UNAVAILABLE', 'Current venue health evidence is required before activation.', { schema: ADAPTER_READINESS_SCHEMA, kind });
  if (typeof signer !== 'function') return unavailable('SIGNER_UNAVAILABLE', 'A signer is required and is never supplied by an external agent.', { schema: ADAPTER_READINESS_SCHEMA, kind });
  if (typeof adapter.simulate !== 'function') return unavailable('SIMULATOR_UNAVAILABLE', 'Adapter simulation is required before signing.', { schema: ADAPTER_READINESS_SCHEMA, kind });
  if (typeof adapter.submit !== 'function') return unavailable('SUBMITTER_UNAVAILABLE', 'Adapter submitter is not connected.', { schema: ADAPTER_READINESS_SCHEMA, kind });
  if (kind === 'bridge' && adapter.activated !== true) return unavailable('BRIDGE_ADAPTER_NOT_ACTIVATED', 'Bridge execution remains unavailable until reviewed activation evidence exists.', { schema: ADAPTER_READINESS_SCHEMA, kind });
  return {
    ok: true,
    schema: ADAPTER_READINESS_SCHEMA,
    status: 'configured',
    kind,
    adapterId: safeId(adapter.id) || null,
    evidence: { ...health.health, signer: true, contract: adapter.contract === true, adapter: true },
    noMockProduction: true,
    noSignOnFailure: true
  };
}

/** Run the exact adapter simulation and retain only public evidence. */
export async function simulateTransaction({ adapter, transaction, expected = {}, provider = null, now = Date.now() } = {}) {
  const readiness = checkAdapterReadiness({ adapter, provider, signer: () => null, environment: 'test', now });
  /* `checkAdapterReadiness` requires a function only to validate the adapter
     surface; this function never calls it. A real signer is still required by
     executeWithAdapter. */
  if (!readiness.ok && readiness.code !== 'SIGNER_UNAVAILABLE') return { ...readiness, noSign: true };
  const checked = verifyTransactionRequest({ transaction, expected });
  if (!checked.ok) return { ...checked, schema: TRANSACTION_SIMULATION_SCHEMA, status: 'failed', noSign: true };
  if (!adapter || typeof adapter.simulate !== 'function') return unavailable('SIMULATOR_UNAVAILABLE', null, { schema: TRANSACTION_SIMULATION_SCHEMA, noSign: true });
  try {
    const result = await adapter.simulate({ transaction: checked.transaction });
    if (!result || result.ok !== true || result.status !== 'passed') return unavailable('SIMULATION_FAILED', 'Simulation did not pass; no signature was requested.', { schema: TRANSACTION_SIMULATION_SCHEMA, noSign: true, simulationStatus: safeString(result?.status, 32) || 'failed', reason: safeString(result?.reason, 160) || null });
    return { ok: true, schema: TRANSACTION_SIMULATION_SCHEMA, status: 'passed', noSign: true, transaction: checked.transaction, recipientRechecked: true, calldataRechecked: true, providerId: safeId(result.providerId) || readiness.evidence?.providerId || null, simulationEvidence: safeId(result.evidenceId) || null, checkedAt: now, fee: finite(result.fee), risk: finite(result.risk) };
  } catch { return unavailable('SIMULATION_PROVIDER_ERROR', 'Simulation provider failed; no signature was requested.', { schema: TRANSACTION_SIMULATION_SCHEMA, noSign: true }); }
}

function adapterIdempotencyKey(value) {
  const key = String(value || '').trim();
  return ID_RE.test(key) ? key : null;
}

/**
 * Final execution adapter entry point. It signs only after all gates pass and
 * never retries a submit blindly. A repeated idempotency key returns the first
 * observed result rather than generating a second transaction.
 */
export async function executeWithAdapter({
  adapter,
  transaction,
  expected = {},
  authorization = null,
  runtimeEvidence = null,
  controls = {},
  provider = null,
  signer = null,
  idempotencyKey,
  environment = 'production',
  now = Date.now()
} = {}) {
  const key = adapterIdempotencyKey(idempotencyKey);
  if (!key) return fail('IDEMPOTENCY_KEY_REQUIRED', null, { noSign: true });
  if (executions.has(key)) return { ...executions.get(key), idempotent: true, signCalled: false };
  const readiness = checkAdapterReadiness({ adapter, provider, signer, environment, now });
  if (!readiness.ok) return { ...readiness, noSign: true, signCalled: false };
  const auth = authorization?.executionAuthorized === true
    ? authorization
    : null;
  const gate = assertFinancialExecution({
    authorizationScreenShown: auth?.screenShown === true,
    userConfirmed: auth?.userConfirmed === true,
    guardianApproved: auth?.guardianApproved === true,
    policyDecision: auth?.policyDecision,
    limits: auth?.limits,
    runtimeEvidence: runtimeEvidence || auth?.runtimeEvidence,
    controls,
    now
  });
  if (!gate.ok) return { ...gate, noSign: true, signCalled: false };
  const checked = verifyTransactionRequest({ transaction, expected });
  if (!checked.ok) return { ...checked, noSign: true, signCalled: false };
  const simulation = await simulateTransaction({ adapter, transaction: checked.transaction, expected, provider, now });
  if (!simulation.ok || simulation.status !== 'passed') return { ...simulation, noSign: true, signCalled: false };
  let signed;
  try {
    signed = await signer({ transaction: checked.transaction, authorizationId: auth.authorizationScreenId || null, providerId: readiness.evidence.providerId });
  } catch { return { ok: false, schema: EXECUTION_ATTEMPT_SCHEMA, code: 'SIGNER_FAILED', noSign: true, signCalled: false };
  }
  if (!signed || signed.ok !== true || !signed.signedTx || !TX_RE.test(String(signed.signedTx))) return { ok: false, schema: EXECUTION_ATTEMPT_SCHEMA, code: 'SIGNATURE_INVALID', noSign: false, signCalled: true };
  /* Recheck public request facts after signer preparation, before broadcast. */
  const beforeSubmit = verifyTransactionRequest({ transaction: checked.transaction, expected });
  if (!beforeSubmit.ok) return { ...beforeSubmit, noSign: false, signCalled: true, broadcasted: false };
  let submitted;
  try { submitted = await adapter.submit({ signedTx: String(signed.signedTx), transaction: beforeSubmit.transaction, idempotencyKey: key }); }
  catch { return { ok: false, schema: EXECUTION_ATTEMPT_SCHEMA, code: 'SUBMIT_FAILED', noSign: false, signCalled: true, broadcasted: false };
  }
  if (!submitted || submitted.ok !== true) return { ok: false, schema: EXECUTION_ATTEMPT_SCHEMA, code: 'SUBMIT_REJECTED', noSign: false, signCalled: true, broadcasted: false };
  const result = {
    ok: true,
    schema: EXECUTION_ATTEMPT_SCHEMA,
    status: 'submitted',
    adapterId: readiness.adapterId,
    kind: readiness.kind,
    providerId: readiness.evidence.providerId,
    receiptRef: safeString(submitted.receiptRef, 160) || null,
    idempotencyKey: key,
    signCalled: true,
    broadcasted: true,
    executionProofPending: true,
    completed: false,
    automaticExecution: false
  };
  executions.set(key, result);
  return result;
}

export function clearExecutionIdempotency() { executions.clear(); }

export function adapterStatus({ wallet = null, broker = null, bridge = null, providers = {} } = {}) {
  return {
    schema: EXECUTION_ADAPTER_SCHEMA,
    adapters: {
      wallet: publicAdapterStatus(wallet, providers.wallet),
      broker: publicAdapterStatus(broker, providers.broker),
      bridge: publicAdapterStatus(bridge, providers.bridge)
    },
    mockProductionEnabled: false,
    noSignOnError: true,
    runtimeEvidenceRequired: true
  };
}
function publicAdapterStatus(adapter, provider) {
  if (!adapter || !provider) return { status: 'unavailable', configured: false, operational: false };
  const health = providerHealth(provider, Date.now());
  return { status: health.ok ? 'configured-not-activated' : 'unavailable', configured: health.ok, operational: false, providerId: health.ok ? health.health.providerId : null };
}
