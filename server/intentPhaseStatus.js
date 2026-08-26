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
import { operationalPhase21Row, scanOperationalProviders } from './intentOperationalEvidence.js';
import { controlPlaneRow } from '../src/lib/intent-ai/controlPlaneActivation.js';

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
  { phase: 20, id: 'launch-governance', title: 'Launch و Governance', implementation: 'implemented', source: ['src/lib/intent-ai/launchGovernance.js'], tests: ['test/intent-ai/phase20-launch-governance-probe.mjs'], requiredEvidence: ['reproducible-deployment', 'rollback-drill', 'slo-measurement', 'public-runtime-status', 'incident-drill'] },
  { phase: 21, id: 'operational-activation', title: 'Operational Activation و Launch Readiness', implementation: 'implemented', source: ['src/lib/intent-ai/operationalActivation.js', 'server/intentOperationalEvidence.js'], tests: ['test/intent-ai/phase21-operational-activation-probe.mjs'], requiredEvidence: ['approved-durable-registry', 'certificate-authority', 'sandbox-operator', 'simulator', 'monitor', 'smart-wallet', 'production-signer', 'wallet-provider', 'venue-health', 'rpc', 'policy-contract', 'durable-immutable-audit', 'backup-restore-drill', 'independent-security-review', 'reproducible-deployment', 'rollback-drill', 'slo-measurement'] },
  { phase: 22, id: 'registry-ca-ops', title: 'Durable Registry و CA Operations', implementation: 'implemented', source: ['src/lib/intent-ai/phase22RegistryCaOps.js'], tests: ['test/intent-ai/phase22-registry-ca-ops-probe.mjs'], requiredEvidence: ['approved-durable-registry', 'certificate-authority', 'restart-recovery'] },
  { phase: 23, id: 'sandbox-mesh', title: 'Sandbox Operator Mesh', implementation: 'implemented', source: ['src/lib/intent-ai/phase23SandboxMesh.js'], tests: ['test/intent-ai/phase23-sandbox-mesh-probe.mjs'], requiredEvidence: ['sandbox-operator', 'isolation-attestation'] },
  { phase: 24, id: 'sim-monitor-ops', title: 'Simulator Monitor Scheduler Ops', implementation: 'implemented', source: ['src/lib/intent-ai/phase24SimMonitorOps.js'], tests: ['test/intent-ai/phase24-sim-monitor-ops-probe.mjs'], requiredEvidence: ['simulator', 'monitor', 'scheduler-operator'] },
  { phase: 25, id: 'signer-guardian-ops', title: 'Smart Wallet Guardian Signer Ops', implementation: 'implemented', source: ['src/lib/intent-ai/phase25SignerGuardianOps.js'], tests: ['test/intent-ai/phase25-signer-guardian-ops-probe.mjs'], requiredEvidence: ['smart-wallet', 'independent-guardian', 'production-signer'] },
  { phase: 26, id: 'venue-federation', title: 'Venue و Adapter Federation', implementation: 'implemented', source: ['src/lib/intent-ai/phase26VenueFederation.js'], tests: ['test/intent-ai/phase26-venue-federation-probe.mjs'], requiredEvidence: ['wallet-provider', 'broker-provider', 'bridge-provider', 'venue-health'] },
  { phase: 27, id: 'rpc-policy-ops', title: 'RPC Quorum و On-Chain Policy Ops', implementation: 'implemented', source: ['src/lib/intent-ai/phase27RpcPolicyOps.js'], tests: ['test/intent-ai/phase27-rpc-policy-ops-probe.mjs'], requiredEvidence: ['rpc', 'policy-contract', 'code-hash-proof'] },
  { phase: 28, id: 'audit-dr-ops', title: 'Immutable Audit و Disaster Recovery Ops', implementation: 'implemented', source: ['src/lib/intent-ai/phase28AuditDrOps.js'], tests: ['test/intent-ai/phase28-audit-dr-ops-probe.mjs'], requiredEvidence: ['durable-immutable-audit', 'backup-restore-drill'] },
  { phase: 29, id: 'assurance-network', title: 'Independent Assurance Network', implementation: 'implemented', source: ['src/lib/intent-ai/phase29AssuranceNetwork.js'], tests: ['test/intent-ai/phase29-assurance-network-probe.mjs'], requiredEvidence: ['independent-security-review', 'privacy-review', 'compliance-review'] },
  { phase: 30, id: 'launch-control-plane', title: 'Launch Control Plane', implementation: 'implemented', source: ['src/lib/intent-ai/phase30LaunchControlPlane.js', 'src/lib/intent-ai/controlPlaneActivation.js'], tests: ['test/intent-ai/phase30-launch-control-plane-probe.mjs'], requiredEvidence: ['reproducible-deployment', 'rollback-drill', 'slo-measurement', 'launch-freeze-control'] },
  { phase: 31, id: 'incident-command', title: 'Incident Command', implementation: 'implemented', source: ['src/lib/intent-ai/phase31IncidentCommand.js'], tests: ['test/intent-ai/phase31-incident-command-probe.mjs'], requiredEvidence: ['incident-commander', 'incident-declaration'] },
  { phase: 32, id: 'secret-rotation', title: 'Secret Manager و Key Rotation', implementation: 'implemented', source: ['src/lib/intent-ai/phase32SecretRotation.js'], tests: ['test/intent-ai/phase32-secret-rotation-probe.mjs'], requiredEvidence: ['attested-secret-manager', 'dual-control-rotation'] },
  { phase: 33, id: 'failover-capacity', title: 'Failover و Capacity', implementation: 'implemented', source: ['src/lib/intent-ai/phase33FailoverCapacity.js'], tests: ['test/intent-ai/phase33-failover-capacity-probe.mjs'], requiredEvidence: ['primary-region', 'secondary-region', 'failover-drill'] },
  { phase: 34, id: 'abuse-rate-limits', title: 'Abuse و Rate Limit Ops', implementation: 'implemented', source: ['src/lib/intent-ai/phase34AbuseRateLimits.js'], tests: ['test/intent-ai/phase34-abuse-rate-limits-probe.mjs'], requiredEvidence: ['enforced-rate-limiter'] },
  { phase: 35, id: 'public-disclosure', title: 'Public Disclosure', implementation: 'implemented', source: ['src/lib/intent-ai/phase35PublicDisclosure.js'], tests: ['test/intent-ai/phase35-public-disclosure-probe.mjs'], requiredEvidence: ['attested-disclosure-channel'] },
  { phase: 36, id: 'residency-legal-hold', title: 'Residency و Legal Hold', implementation: 'implemented', source: ['src/lib/intent-ai/phase36ResidencyLegalHold.js'], tests: ['test/intent-ai/phase36-residency-hold-probe.mjs'], requiredEvidence: ['residency-enforcement', 'legal-hold-control'] },
  { phase: 37, id: 'dependency-attestation', title: 'Dependency Attestation', implementation: 'implemented', source: ['src/lib/intent-ai/phase37DependencyAttestation.js'], tests: ['test/intent-ai/phase37-dependency-attestation-probe.mjs'], requiredEvidence: ['sbom-attestation', 'supplier-attestation'] },
  { phase: 38, id: 'continuous-verification', title: 'Continuous Verification', implementation: 'implemented', source: ['src/lib/intent-ai/phase38ContinuousVerification.js'], tests: ['test/intent-ai/phase38-continuous-verification-probe.mjs'], requiredEvidence: ['continuous-probe'] },
  { phase: 39, id: 'gameday-rehearsal', title: 'Game Day Rehearsal', implementation: 'implemented', source: ['src/lib/intent-ai/phase39GameDayRehearsal.js'], tests: ['test/intent-ai/phase39-gameday-rehearsal-probe.mjs'], requiredEvidence: ['executed-rehearsal'] },
  { phase: 40, id: 'sustainment-governance', title: 'Sustainment Governance', implementation: 'implemented', source: ['src/lib/intent-ai/phase40SustainmentGovernance.js'], tests: ['test/intent-ai/phase40-sustainment-governance-probe.mjs'], requiredEvidence: ['accountable-owner', 'review-cadence'] }
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

export function phaseStatusReport({ now = Date.now(), operationalScan = null } = {}) {
  const scan = operationalScan || scanOperationalProviders({ now });
  const phases = SPEC_PHASES.map((phase) => {
    const activation = phase.phase === 10
      ? phase10Status()
      : phase.phase === 21
        ? operationalPhase21Row(scan)
        : phase.phase >= 22
          ? controlPlaneRow(phase.phase, scan.controlPlane)
          : inactiveStatus(phase);
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
    allOperational: false,
    executionActivated: false,
    rawCredentialsAllowed: false,
    launchAllowed: false,
    operationalActivation: scan.publicStatus,
    phase21: scan
  };
}

export function phaseStatus(phase, options = {}) {
  return phaseStatusReport(options).phases.find((row) => row.phase === Number(phase)) || null;
}

export function phaseStatusIsOperational(row) {
  return Boolean(row && (row.operational === 'live' || row.operational === 'verified') && row.live === true && row.claims?.verified === true);
}
