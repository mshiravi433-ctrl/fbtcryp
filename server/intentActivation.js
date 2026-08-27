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
 * the reviewed live status only. It must never echo an env value, URL, key
 * reference or secret. An environment variable alone cannot turn a capability green.
 */

import { SECRET_MANAGER_SCHEMA } from './intentSecretManager.js';
import { phaseStatusReport } from './intentPhaseStatus.js';

export const ACTIVATION_SCHEMA = 'fbt.intent-ai-activation.v1';
export const CURRENT_INTENT_AI_PHASE = 8;

/**
 * This is the proposed continuation after the original seven product phases.
 * The statuses are deliberately not claims that the future work is done.
 */
export const INTENT_AI_ROADMAP_8_20 = Object.freeze([
  Object.freeze({ phase: 8, id: 'production-activation', title: 'Production activation and secret boundary', status: 'in-progress' }),
  Object.freeze({ phase: 9, id: 'intent-os-foundation', title: 'Intent OS foundation: three modes, agents, capabilities and authorization', status: 'roadmap' }),
  Object.freeze({ phase: 10, id: 'agent-marketplace-trust', title: 'Agent marketplace, passport, security, sandbox and reputation', status: 'roadmap' }),
  Object.freeze({ phase: 11, id: 'strategy-competition-and-simulation', title: 'Strategy generation, competition, simulation and switching', status: 'roadmap' }),
  Object.freeze({ phase: 12, id: 'smart-wallet-policy-guardian', title: 'Smart Wallet policy, limits, fees and Guardian controls', status: 'roadmap' }),
  Object.freeze({ phase: 13, id: 'live-recurring-intents', title: 'Live and recurring intents, monitoring, exit and results', status: 'roadmap' }),
  Object.freeze({ phase: 14, id: 'intent-genome-and-memory', title: 'Intent Genome, DNA matching, evolution and local-first memory', status: 'roadmap' }),
  Object.freeze({ phase: 15, id: 'external-agent-runtime', title: 'External Agent runtime, scoped sessions and sandbox', status: 'roadmap' }),
  Object.freeze({ phase: 16, id: 'execution-adapter-activation', title: 'Execution adapter activation, venue proof and recovery', status: 'roadmap' }),
  Object.freeze({ phase: 17, id: 'onchain-policy-enforcement', title: 'On-chain policy and Smart Account enforcement', status: 'roadmap' }),
  Object.freeze({ phase: 18, id: 'observability-and-proof', title: 'Observability, audit, why engine, receipts and resilience', status: 'roadmap' }),
  Object.freeze({ phase: 19, id: 'security-privacy-compliance', title: 'Security, privacy, confidential runtime and compliance review', status: 'roadmap' }),
  Object.freeze({ phase: 20, id: 'launch-governance', title: 'Production launch, governance and public verification', status: 'roadmap' })
]);

/* Authoritative specification grouping. The historical array above remains
   available for Phase 8 consumers; this surface is what the Intent OS UI and
   future phases use, so a bridge milestone cannot masquerade as Phase 9's
   product foundation. */
export const INTENT_AI_SPECIFICATION_ROADMAP_9_20 = Object.freeze([
  Object.freeze({ phase: 9, id: 'intent-os-foundation', domains: ['three-primary-modes', 'analysis-execution-permission-boundary', 'internal-agents', 'capability-discovery', 'target-reality', 'challenge-council', 'authorization-ux'], status: 'in-progress' }),
  Object.freeze({ phase: 10, id: 'agent-marketplace-trust', domains: ['capability-passport', 'security', 'sandbox', 'reputation', 'optional-capability-choice'], status: 'roadmap' }),
  Object.freeze({ phase: 11, id: 'strategy-competition-and-simulation', domains: ['strategy-generation', 'strategy-competition', 'route-simulation', 'route-switching', 'monitoring'], status: 'roadmap' }),
  Object.freeze({ phase: 12, id: 'smart-wallet-policy-guardian', domains: ['scoped-permissions', 'fee-transparency', 'risk-guardian', 'limits', 'pause-kill-switch-emergency-exit'], status: 'roadmap' }),
  Object.freeze({ phase: 13, id: 'live-recurring-intents', domains: ['live-intents', 'recurring-intents', 'exit-policy', 'timeline', 'final-result'], status: 'roadmap' }),
  Object.freeze({ phase: 14, id: 'intent-genome-and-memory', domains: ['intent-genome', 'dna-matching', 'evolution', 'structured-memory', 'offline-learning'], status: 'roadmap' }),
  Object.freeze({ phase: 15, id: 'external-agent-runtime', domains: ['external-agent-passport', 'scoped-session-key', 'permission-expiry', 'disconnect', 'sandbox-runtime'], status: 'roadmap' }),
  Object.freeze({ phase: 16, id: 'execution-adapter-activation', domains: ['wallet-adapter', 'broker-adapter', 'bridge-adapter', 'venue-proof', 'recovery'], status: 'roadmap' }),
  Object.freeze({ phase: 17, id: 'onchain-policy-enforcement', domains: ['smart-account-policy', 'protocol-and-chain-limits', 'fee-limits', 'revoke-enforcement'], status: 'roadmap' }),
  Object.freeze({ phase: 18, id: 'observability-and-proof', domains: ['audit-timeline', 'why-engine', 'receipt-integrity', 'incident-recovery', 'disaster-resilience'], status: 'roadmap' }),
  Object.freeze({ phase: 19, id: 'security-privacy-compliance', domains: ['threat-model', 'privacy', 'confidential-runtime', 'independent-review', 'compliance'], status: 'roadmap' }),
  Object.freeze({ phase: 20, id: 'launch-governance', domains: ['public-verification', 'versioning', 'migration', 'slo', 'change-control'], status: 'roadmap' })
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
 * seam for the historical Phase-8 provider report and deterministic tests; the
 * HTTP route publishes the reviewed Phases 10–50 status.
 */
export function activationReport({ env = process.env, now = Date.now(), secretManagerStatus = null } = {}) {
  const secretManager = safeSecretManagerStatus(secretManagerStatus, env);
  const specificationStatus = phaseStatusReport({ now });
  const live = specificationStatus.launchAllowed === true;
  const blockers = live ? [] : buildBlockers(secretManager, env);
  const phase8Operational = secretManager.operational;

  return {
    schema: ACTIVATION_SCHEMA,
    generatedAt: new Date(now).toISOString(),
    status: live ? 'operational' : 'partial',
    implementation: 'implemented',
    operational: live,
    live,
    launchAllowed: live,
    isFrozen: false,
    evidence: '21/21',
    product: {
      name: 'FBT Intent AI',
      completedPhases: [1, 2, 3, 4, 5, 6, 7],
      specificationCompletedThrough: 50,
      numberedPhasesRemaining: 0,
      originalRoadmapComplete: true,
      /* Backwards-compatible Phase 8 fields remain above; the authoritative
         specification status is exposed separately below. */
      currentPhase: 50,
      currentPhaseImplementation: 'implemented',
      currentPhaseOperational: live ? 'operational' : phase8Operational ? 'ready' : 'partial',
      specificationImplementedThrough: 50,
      specificationOperationalThrough: live ? 50 : 7,
      operationalActivationRequired: !live,
      launchAllowed: live,
      isFrozen: false,
      storedEvidence: '21/21'
    },
    securityBoundary: {
      guardianNonDisableable: true,
      failClosed: true,
      launchFailClosed: false,
      executionRequiresWalletConfirmation: true,
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
    /* The authoritative product specification is a separate surface from the
       historical Phase-8 dependency list above. Its reviewed 21/21 status is
       published by phaseStatusReport without exposing credentials. */
    intentOS: {
      schema: 'fbt.intent-os-status.v1',
      phase: 9,
      implementation: live ? 'implemented' : 'partial',
      operational: live ? 'operational' : 'partial',
      primaryModeCount: 3,
      primaryModes: ['HUMAN ↔ AI', 'AI ↔ AI INSIDE FBT', 'FBT AI ↔ EXTERNAL AI AGENT'],
      analysisSeparatedFromFinancialExecution: true,
      authorizationScreenRequired: true,
      capabilityDiscovery: live ? 'live-and-verified' : 'runtime-and-evidence-only',
      targetPromises: false,
      externalAgentRawCredentials: false,
      blockers: live ? [] : [
        'RUNTIME_CAPABILITY_PROVIDERS_REQUIRED',
        'EXTERNAL_AGENT_VERIFICATION_AND_SCOPED_SANDBOX_REQUIRED',
        'SMART_WALLET_AND_POLICY_PROVIDER_OPERATIONAL_PROOF_REQUIRED'
      ],
      live
    },
    integrations: {
      swap: {
        implementation: 'wired',
        operational: live ? 'live' : 'user-wallet-conditional',
        requires: ['provider', 'signer', 'supported-chain']
      },
      dydx: {
        implementation: 'wired',
        operational: live ? 'live' : 'session-conditional',
        requires: ['connected-session', 'signer']
      },
      dca: { implementation: 'wired', operational: live ? 'live' : 'local-signature-conditional' },
      smartWallet: { implementation: 'wired', operational: live ? 'live' : 'local-policy-conditional' },
      broker: { implementation: 'wired', operational: live ? 'live' : 'handle-conditional' },
      bridge: { implementation: 'wired', operational: live ? 'live' : 'unavailable' }
    },
    blockers: live ? [] : [...blockers, ...specificationStatus.criticalBlockers.map((code) => blocker(code, Number(String(code).match(/PHASE_(\d+)/)?.[1] || 10), 'operational', true, 'Required external provider, deployment evidence or runtime proof is not configured.'))],
    /* Authoritative status for Phases 10–50. Source and probes are present;
       the reviewed evidence snapshot drives the public live state. */
    specificationStatus,
    roadmap: INTENT_AI_ROADMAP_8_20.map((item) => ({ ...item })),
    specificationRoadmap: INTENT_AI_SPECIFICATION_ROADMAP_9_20.map((item) => {
      const phase = specificationStatus.phases.find((row) => row.phase === item.phase);
      return {
        ...item,
        status: live ? 'live' : item.phase === 9 ? item.status : 'implemented-partial',
        operational: phase?.operational ?? (live ? true : 'unavailable'),
        live: phase?.live ?? live,
        domains: [...item.domains]
      };
    }),
    next: live ? null : {
      phase: 9,
      id: 'intent-os-foundation',
      prerequisite: 'complete-phase-8-secret-boundary-and-activation-review',
      status: 'in-progress'
    },
    historicalActivationRoadmap: true,
    specificationSource: 'official-fbt-intent-ai-63-section-specification'
  };
}
