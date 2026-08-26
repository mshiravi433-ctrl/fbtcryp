/**
 * FBT INTENT AI — Phase 8 production activation report.
 *
 * The report separates four things that are easy to conflate:
 *   1. the numbered product roadmap that is implemented;
 *   2. code wiring that exists;
 *   3. runtime configuration that is present; and
 *   4. operational proof that is actually verified.
 *
 * It is public and intentionally contains booleans, public identifiers and
 * blocker codes only. It must never echo an env value, URL, key reference or
 * secret. An environment variable alone cannot turn a capability green.
 */

import { SECRET_MANAGER_SCHEMA } from './intentSecretManager.js';

export const ACTIVATION_SCHEMA = 'fbt.intent-ai-activation.v1';
export const CURRENT_INTENT_AI_PHASE = 8;

/**
 * This is the proposed continuation after the original seven product phases.
 * The statuses are deliberately not claims that the future work is done.
 */
export const INTENT_AI_ROADMAP_8_20 = Object.freeze([
  Object.freeze({ phase: 8, id: 'production-activation', title: 'Production activation and secret boundary', status: 'in-progress' }),
  Object.freeze({ phase: 9, id: 'bridge-execution', title: 'Fail-closed bridge execution', status: 'roadmap' }),
  Object.freeze({ phase: 10, id: 'broker-adapter', title: 'Scoped broker and CEX adapter', status: 'roadmap' }),
  Object.freeze({ phase: 11, id: 'dydx-session-lifecycle', title: 'Durable dYdX session lifecycle', status: 'roadmap' }),
  Object.freeze({ phase: 12, id: 'atomic-cross-chain', title: 'Audited on-chain escrow and atomic cross-chain state machine', status: 'roadmap' }),
  Object.freeze({ phase: 13, id: 'independent-operators', title: 'Independent operator attestation and external audit', status: 'roadmap' }),
  Object.freeze({ phase: 14, id: 'key-rotation-anchors', title: 'Coordinator rotation and external root anchors', status: 'roadmap' }),
  Object.freeze({ phase: 15, id: 'bond-enforcement', title: 'Bond custody and settlement enforcement', status: 'roadmap' }),
  Object.freeze({ phase: 16, id: 'confidential-compute', title: 'Operational confidential transport and TEE', status: 'roadmap' }),
  Object.freeze({ phase: 17, id: 'onchain-policy', title: 'On-chain policy and smart-account enforcement', status: 'roadmap' }),
  Object.freeze({ phase: 18, id: 'reliability-recovery', title: 'Observability, recovery and disaster resilience', status: 'roadmap' }),
  Object.freeze({ phase: 19, id: 'security-compliance', title: 'Independent security, privacy and compliance review', status: 'roadmap' }),
  Object.freeze({ phase: 20, id: 'launch-governance', title: 'Production launch, governance and public verification', status: 'roadmap' })
]);

const trim = (value, max = 96) => {
  const text = String(value ?? '').trim();
  return text ? text.slice(0, max) : '';
};
const PUBLIC_NAME_RE = /^[A-Za-z][A-Za-z0-9._:-]{0,63}$/;
const PUBLIC_CODE_RE = /^[A-Z][A-Z0-9_:-]{0,95}$/;
const SECRET_SHAPE_RE = /^(?:0x)?[a-f0-9]{64}$/i;
const safeName = (value) => {
  const text = trim(value, 64);
  return PUBLIC_NAME_RE.test(text) && !SECRET_SHAPE_RE.test(text) ? text : null;
};
const safeCode = (value, fallback) => {
  const text = trim(value, 96);
  return PUBLIC_CODE_RE.test(text) && !SECRET_SHAPE_RE.test(text) ? text : fallback;
};

const present = (value) => trim(value) !== '';

const blocker = (code, phase, severity, conditional, detail) => ({
  code,
  phase,
  severity,
  conditional,
  detail
});

function defaultSecretManagerStatus(env) {
  const provider = trim(env?.INTENT_SECRET_MANAGER_PROVIDER, 64);
  const keyRefPresent = present(env?.INTENT_SECRET_MANAGER_KEY_REF);
  const requested = Boolean(provider || keyRefPresent);

  /* No provider is wired into this repository yet. Even if an operator sets
     these names, the report must remain non-operational until an injected
     provider has passed the attested health contract. */
  return {
    schema: SECRET_MANAGER_SCHEMA,
    provider: safeName(provider),
    configured: requested,
    operational: false,
    durable: false,
    attested: false,
    status: requested ? 'configured-not-verified' : 'unavailable',
    blocker: requested ? 'SECRET_MANAGER_PROVIDER_NOT_VERIFIED' : 'REAL_SECRET_MANAGER_REQUIRED',
    keyRefPresent,
    secretsExposed: false,
    rawSecretsPersisted: false
  };
}

function safeSecretManagerStatus(input, env) {
  const source = input && typeof input === 'object' ? input : defaultSecretManagerStatus(env);
  const operational = source.operational === true
    && source.durable === true
    && source.attested === true;
  const configured = source.configured === true;
  return {
    schema: SECRET_MANAGER_SCHEMA,
    provider: safeName(source.provider),
    configured,
    operational,
    durable: source.durable === true,
    attested: source.attested === true,
    status: operational ? 'operational' : configured ? 'configured-not-verified' : 'unavailable',
    blocker: operational ? null : safeCode(source.blocker, configured ? 'PROVIDER_HEALTH_NOT_VERIFIED' : 'REAL_SECRET_MANAGER_REQUIRED'),
    keyRefPresent: source.keyRefPresent === true,
    secretsExposed: false,
    rawSecretsPersisted: false
  };
}

function buildBlockers(secretManager, env) {
  const rows = [];
  if (!secretManager.operational) {
    rows.push(blocker(
      secretManager.blocker || 'REAL_SECRET_MANAGER_REQUIRED',
      8,
      'required-for-confidential',
      false,
      'A real attested Secret Manager/KMS provider is not operational; confidential claims remain unavailable.'
    ));
  }

  rows.push(blocker(
    'BRIDGE_EXECUTION_NOT_WIRED',
    9,
    'conditional',
    true,
    'Bridge has quote support only; execution is intentionally unavailable until a reviewed adapter exists.'
  ));
  rows.push(blocker(
    'BROKER_HANDLE_REQUIRED',
    10,
    'conditional',
    true,
    'Broker execution needs a scoped runtime handle; no handle is accepted from the client or an agent.'
  ));
  rows.push(blocker(
    'DYDX_SESSION_REQUIRED',
    11,
    'conditional',
    true,
    'dYdX execution requires a connected session; absence must remain unavailable rather than successful.'
  ));

  if (!present(env?.INTENT_INDEPENDENT_OPERATOR_ATTESTATIONS)) {
    rows.push(blocker(
      'INDEPENDENT_OPERATOR_ATTESTATION_REQUIRED',
      13,
      'operational',
      true,
      'Active watcher/verifier keys have no current signed public attestation in this deployment.'
    ));
  }
  if (!present(env?.INTENT_COORDINATOR_ROTATIONS)) {
    rows.push(blocker(
      'COORDINATOR_ROTATION_NOT_CONFIGURED',
      14,
      'operational',
      true,
      'No dual-signed old/new Coordinator rotation record is configured.'
    ));
  }
  if (!present(env?.INTENT_MERKLE_ANCHOR_NETWORKS)) {
    rows.push(blocker(
      'MERKLE_ROOT_ANCHOR_NOT_CONFIGURED',
      14,
      'operational',
      true,
      'No verified deployed root-anchor network is configured; local hashes are not external timestamps.'
    ));
  }
  if (!present(env?.INTENT_WORKFLOW_BATCH_ADDRESS)) {
    rows.push(blocker(
      'WORKFLOW_BATCH_CONTRACT_NOT_CONFIGURED',
      12,
      'operational',
      true,
      'No real mainnet workflow batch contract address is configured.'
    ));
  }

  return rows;
}

/**
 * Public activation report. `secretManagerStatus` is an internal injection
 * seam for a future real provider and for deterministic tests; the HTTP route
 * uses the default fail-closed path.
 */
export function activationReport({ env = process.env, now = Date.now(), secretManagerStatus = null } = {}) {
  const secretManager = safeSecretManagerStatus(secretManagerStatus, env);
  const blockers = buildBlockers(secretManager, env);
  const phase8Operational = secretManager.operational;

  return {
    schema: ACTIVATION_SCHEMA,
    generatedAt: new Date(now).toISOString(),
    product: {
      name: 'FBT Intent AI',
      completedPhases: [1, 2, 3, 4, 5, 6, 7],
      numberedPhasesRemaining: 0,
      originalRoadmapComplete: true,
      currentPhase: CURRENT_INTENT_AI_PHASE,
      currentPhaseImplementation: 'implemented',
      currentPhaseOperational: phase8Operational ? 'ready' : 'partial'
    },
    securityBoundary: {
      guardianNonDisableable: true,
      failClosed: true,
      rawCredentialsToAgents: false,
      rawCredentialsToClient: false,
      publicReportContainsSecrets: false
    },
    phase8: {
      id: 'production-activation',
      implementation: 'implemented',
      operational: phase8Operational ? 'ready' : 'partial',
      secretManager
    },
    integrations: {
      swap: {
        implementation: 'wired',
        operational: 'user-wallet-conditional',
        requires: ['provider', 'signer', 'supported-chain']
      },
      dydx: {
        implementation: 'wired',
        operational: 'session-conditional',
        requires: ['connected-session', 'signer']
      },
      dca: { implementation: 'wired', operational: 'local-signature-conditional' },
      smartWallet: { implementation: 'wired', operational: 'local-policy-conditional' },
      broker: { implementation: 'wired', operational: 'handle-conditional' },
      bridge: { implementation: 'not-wired', operational: 'unavailable' }
    },
    blockers,
    roadmap: INTENT_AI_ROADMAP_8_20.map((item) => ({ ...item })),
    next: {
      phase: 9,
      id: 'bridge-execution',
      prerequisite: 'complete-phase-8-secret-boundary-and-activation-review'
    }
  };
}
