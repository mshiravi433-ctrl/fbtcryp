/**
 * FBT INTENT AI — authoritative status for specification Phases 10–20.
 *
 * This is deliberately separate from the existence of source files. `source`
 * and `tests` describe implementation, while `configuration` and
 * `operational` require external evidence. In this checkout the external
 * registry/CA/sandbox/provider/signer/operator/contracts are not activated, so
 * the default report stays unavailable and never becomes green from an env
 * variable alone.
 */

import { existsSync } from 'node:fs';
import { blobConfigured } from './blobCache.js';
import { certificationsConfigured } from './ecosystemCertifications.js';

export const PHASE_STATUS_SCHEMA = 'fbt.intent-ai-phase-status.v1';
export const SPEC_PHASES = Object.freeze([
  { phase: 10, id: 'agent-marketplace-trust', title: 'External Agent Marketplace و Trust', implementation: 'implemented', source: ['server/ecosystemRegistry.js', 'server/ecosystemCertifications.js', 'src/lib/intent-ai/externalAgentTrust.js'], tests: ['test/intent-ai/phase10-agent-trust-probe.mjs'], requiredEvidence: ['approved-durable-registry', 'certificate-authority', 'sandbox-operator', 'external-transport', 'smart-wallet-session-provider'] },
  { phase: 11, id: 'strategy-competition-and-simulation', title: 'Strategy Generation و Competition و Simulation', implementation: 'implemented', source: ['src/lib/intent-ai/strategyCompetition.js'], tests: ['test/intent-ai/phase11-strategy-competition-probe.mjs'], requiredEvidence: ['route-simulation-provider', 'observed-evidence'] },
  { phase: 12, id: 'smart-wallet-policy-guardian', title: 'Smart Wallet و Guardian Policy', implementation: 'implemented', source: ['src/lib/intent-ai/smartWalletPolicy.js'], tests: ['test/intent-ai/phase12-smart-wallet-policy-probe.mjs'], requiredEvidence: ['smart-wallet-provider', 'independent-guardian', 'signer-runtime'] },
  { phase: 13, id: 'live-recurring-intents', title: 'Live و Recurring Intents', implementation: 'implemented', source: ['src/lib/intent-ai/liveRecurringIntents.js'], tests: ['test/intent-ai/phase13-live-recurring-probe.mjs'], requiredEvidence: ['live-monitor', 'receipt-provider', 'scheduler-operator'] },
  { phase: 14, id: 'intent-genome-and-memory', title: 'Intent Genome و Local-First Memory', implementation: 'implemented', source: ['src/lib/intent-ai/intentGenomeMemory.js'], tests: ['test/intent-ai/phase14-genome-memory-probe.mjs'], requiredEvidence: ['encrypted-device-store', 'learning-consent-store', 'retention-operator'] },
  { phase: 15, id: 'external-agent-runtime', title: 'External Agent Runtime', implementation: 'implemented', source: ['src/lib/intent-ai/externalAgentRuntime.js'], tests: ['test/intent-ai/phase15-external-runtime-probe.mjs'], requiredEvidence: ['runtime-adapter', 'session-key-provider', 'sandbox-runtime', 'operator'] },
  { phase: 16, id: 'execution-adapter-activation', title: 'Execution Adapter Activation', implementation: 'implemented', source: ['src/lib/intent-ai/executionAdapters.js'], tests: ['test/intent-ai/phase16-adapter-activation-probe.mjs'], requiredEvidence: ['wallet-provider', 'broker-provider', 'bridge-provider', 'signer', 'venue-health'] },
  { phase: 17, id: 'onchain-policy-enforcement', title: 'On-Chain Policy Enforcement', implementation: 'implemented', source: ['src/lib/intent-ai/onchainPolicy.js'], tests: ['test/intent-ai/phase17-onchain-policy-probe.mjs'], requiredEvidence: ['deployed-smart-account', 'policy-contract', 'rpc-proof', 'onchain-revoke'] },
  { phase: 18, id: 'observability-and-proof', title: 'Observability و Proof', implementation: 'implemented', source: ['src/lib/intent-ai/observabilityProof.js'], tests: ['test/intent-ai/phase18-observability-proof-probe.mjs'], requiredEvidence: ['durable-immutable-audit', 'receipt-verifier', 'backup-drill', 'incident-operator'] },
  { phase: 19, id: 'security-privacy-compliance', title: 'Security و Privacy و Compliance', implementation: 'implemented', source: ['src/lib/intent-ai/securityCompliance.js'], tests: ['test/intent-ai/phase19-security-compliance-probe.mjs'], requiredEvidence: ['threat-review', 'independent-security-review', 'privacy-review', 'compliance-review'] },
  { phase: 20, id: 'launch-governance', title: 'Launch و Governance', implementation: 'implemented', source: ['src/lib/intent-ai/launchGovernance.js'], tests: ['test/intent-ai/phase20-launch-governance-probe.mjs'], requiredEvidence: ['reproducible-deployment', 'rollback-drill', 'slo-measurement', 'public-runtime-status', 'incident-drill'] }
]);

function phase10Status() {
  const registry = blobConfigured();
  const certifier = certificationsConfigured();
  return {
    configuration: registry && certifier ? 'partially-configured' : 'not-configured',
    operational: 'unavailable',
    ready: false,
    live: false,
    dataStatus: registry ? 'partial' : 'unavailable',
    blockers: [
      ...(registry ? [] : ['APPROVED_EXTERNAL_REGISTRY_REQUIRED']),
      ...(certifier ? [] : ['CERTIFICATE_AUTHORITY_NOT_CONFIGURED']),
      'SANDBOX_OPERATOR_NOT_CONFIGURED',
      'EXTERNAL_TRANSPORT_NOT_CONFIGURED',
      'SMART_WALLET_SESSION_PROVIDER_NOT_ACTIVATED',
      'REPUTATION_NOT_LIVE'
    ]
  };
}

function inactiveStatus(phase) {
  return {
    configuration: 'not-configured',
    operational: 'unavailable',
    ready: false,
    live: false,
    dataStatus: 'unavailable',
    blockers: phase.requiredEvidence.map((item) => `${item.toUpperCase().replace(/[^A-Z0-9]+/g, '_')}_REQUIRED`)
  };
}

export function phaseStatusReport({ now = Date.now() } = {}) {
  const phases = SPEC_PHASES.map((phase) => {
    const activation = phase.phase === 10 ? phase10Status() : inactiveStatus(phase);
    const sourcePresent = phase.source.every((file) => existsSync(file));
    const testsPresent = phase.tests.every((file) => existsSync(file));
    return {
      phase: phase.phase,
      id: phase.id,
      title: phase.title,
      implementation: sourcePresent && testsPresent ? phase.implementation : 'partial',
      source: [...phase.source],
      tests: [...phase.tests],
      sourcePresent,
      testsPresent,
      configuration: activation.configuration,
      operational: activation.operational,
      ready: activation.ready,
      live: activation.live,
      dataStatus: activation.dataStatus,
      blockers: activation.blockers,
      requiredEvidence: [...phase.requiredEvidence],
      claims: {
        verified: false,
        production: false,
        executionActivated: false,
        rawCredentialsAllowed: false
      }
    };
  });
  return {
    schema: PHASE_STATUS_SCHEMA,
    generatedAt: new Date(now).toISOString(),
    sourceOfTruth: 'runtime-evidence-separated-from-source-implementation',
    phases,
    criticalBlockers: [...new Set(phases.flatMap((phase) => phase.blockers))],
    anyLive: phases.some((phase) => phase.live),
    allOperational: phases.every((phase) => phase.operational === 'live' || phase.operational === 'verified'),
    executionActivated: false,
    rawCredentialsAllowed: false
  };
}

export function phaseStatus(phase, options = {}) {
  return phaseStatusReport(options).phases.find((row) => row.phase === Number(phase)) || null;
}

export function phaseStatusIsOperational(row) {
  return Boolean(row && (row.operational === 'live' || row.operational === 'verified') && row.live === true && row.claims?.verified === true);
}
