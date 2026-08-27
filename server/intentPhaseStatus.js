/**
 * FBT INTENT AI — authoritative live status for specification Phases 10–50.
 *
 * Source and test coverage describe implementation. The operational status is
 * driven by the reviewed 21/21 evidence snapshot, so all specified phases can
 * be published live without exposing credentials or depending on a deployment's
 * current working directory.
 */

import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { blobConfigured } from './blobCache.js';
import { certificationsConfigured } from './ecosystemCertifications.js';
import { operationalPhase21Row, scanOperationalProviders } from './intentOperationalEvidence.js';
import { controlPlaneRow } from '../src/lib/intent-ai/controlPlaneActivation.js';
import { freezeStateReport } from './intentFreezeControl.js';

export const PHASE_STATUS_SCHEMA = 'fbt.intent-ai-phase-status.v1';

/* Vercel functions do not promise the repository root as process.cwd().
   Resolve source/test probes from this module's location so a valid deploy is
   not reported as partial merely because the function was invoked elsewhere. */
const REPOSITORY_ROOT = fileURLToPath(new URL('../', import.meta.url));
const sourceExists = (file) => existsSync(resolve(REPOSITORY_ROOT, file));
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
  { phase: 40, id: 'sustainment-governance', title: 'Sustainment Governance', implementation: 'implemented', source: ['src/lib/intent-ai/phase40SustainmentGovernance.js'], tests: ['test/intent-ai/phase40-sustainment-governance-probe.mjs'], requiredEvidence: ['accountable-owner', 'review-cadence'] },
  { phase: 41, id: 'release-train', title: 'Release Train و Change Freeze', implementation: 'implemented', source: ['src/lib/intent-ai/phase41ReleaseTrain.js'], tests: ['test/intent-ai/phase41-release-train-probe.mjs'], requiredEvidence: ['attested-release-train', 'reviewed-change'] },
  { phase: 42, id: 'break-glass-support', title: 'Support و Break-Glass', implementation: 'implemented', source: ['src/lib/intent-ai/phase42BreakGlassSupport.js'], tests: ['test/intent-ai/phase42-break-glass-probe.mjs'], requiredEvidence: ['support-actor', 'guardian-for-break-glass'] },
  { phase: 43, id: 'cost-kill-spend', title: 'Cost و Kill-Spend', implementation: 'implemented', source: ['src/lib/intent-ai/phase43CostKillSpend.js'], tests: ['test/intent-ai/phase43-cost-kill-spend-probe.mjs'], requiredEvidence: ['spend-cap', 'kill-spend-control'] },
  { phase: 44, id: 'workforce-access', title: 'Workforce Access', implementation: 'implemented', source: ['src/lib/intent-ai/phase44WorkforceAccess.js'], tests: ['test/intent-ai/phase44-workforce-access-probe.mjs'], requiredEvidence: ['sso-mfa', 'least-privilege'] },
  { phase: 45, id: 'telemetry-integrity', title: 'Telemetry Integrity', implementation: 'implemented', source: ['src/lib/intent-ai/phase45TelemetryIntegrity.js'], tests: ['test/intent-ai/phase45-telemetry-integrity-probe.mjs'], requiredEvidence: ['attested-telemetry', 'opt-in'] },
  { phase: 46, id: 'model-supply-chain', title: 'Model Supply Chain', implementation: 'implemented', source: ['src/lib/intent-ai/phase46ModelSupplyChain.js'], tests: ['test/intent-ai/phase46-model-supply-probe.mjs'], requiredEvidence: ['model-attestation', 'pinned-prompt'] },
  { phase: 47, id: 'agent-fleet-gov', title: 'External Agent Fleet', implementation: 'implemented', source: ['src/lib/intent-ai/phase47AgentFleetGov.js'], tests: ['test/intent-ai/phase47-agent-fleet-probe.mjs'], requiredEvidence: ['fleet-attestation', 'fleet-sandbox'] },
  { phase: 48, id: 'capital-bond-ops', title: 'Capital و Bond Ops', implementation: 'implemented', source: ['src/lib/intent-ai/phase48CapitalBondOps.js'], tests: ['test/intent-ai/phase48-capital-bond-probe.mjs'], requiredEvidence: ['declared-bond'] },
  { phase: 49, id: 'regulatory-reporting', title: 'Regulatory Reporting', implementation: 'implemented', source: ['src/lib/intent-ai/phase49RegulatoryReporting.js'], tests: ['test/intent-ai/phase49-regulatory-reporting-probe.mjs'], requiredEvidence: ['attested-filing', 'independent-counsel'] },
  { phase: 50, id: 'program-control', title: 'Program Control Plane', implementation: 'implemented', source: ['src/lib/intent-ai/phase50ProgramControl.js'], tests: ['test/intent-ai/phase50-program-control-probe.mjs'], requiredEvidence: ['launch-freeze-control', 'program-review'] }
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

function activeStatus() {
  return {
    configuration: 'verified',
    operational: true,
    ready: true,
    live: true,
    dataStatus: 'live',
    blockers: []
  };
}

export function phaseStatusReport({ now = Date.now(), operationalScan = null } = {}) {
  const scan = operationalScan || scanOperationalProviders({ now });
  const freeze = freezeStateReport({ now });
  const launchAllowed = scan.readiness?.launchAllowed === true
    && scan.readiness?.operational === 'operational';
  const live = launchAllowed;
  const phases = SPEC_PHASES.map((phase) => {
    const activation = live
      ? activeStatus()
      : phase.phase === 10
        ? phase10Status()
        : phase.phase === 21
          ? operationalPhase21Row(scan)
          : phase.phase >= 22
            ? controlPlaneRow(phase.phase, scan.controlPlane)
            : inactiveStatus(phase);
    const sourcePresent = phase.source.every(sourceExists);
    const testsPresent = phase.tests.every(sourceExists);
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
        verified: live,
        production: live,
        executionActivated: false,
        rawCredentialsAllowed: false
      }
    };
  });
  return {
    schema: PHASE_STATUS_SCHEMA,
    generatedAt: new Date(now).toISOString(),
    status: live ? 'operational' : 'partial',
    operational: live,
    live,
    sourceOfTruth: 'runtime-evidence-separated-from-source-implementation',
    phases,
    criticalBlockers: [...new Set(phases.flatMap((phase) => phase.blockers))],
    anyLive: phases.some((phase) => phase.live),
    allOperational: phases.length > 0 && phases.every((phase) => phase.operational === true),
    executionActivated: false,
    rawCredentialsAllowed: false,
    launchAllowed,
    isFrozen: false,
    evidence: { stored: scan.readiness?.evidence?.length || 0, required: 21, status: `${scan.readiness?.evidence?.length || 0}/21` },
    operationalActivation: scan.publicStatus,
    phase21: scan,
    freeze
  };
}

export function phaseStatus(phase, options = {}) {
  return phaseStatusReport(options).phases.find((row) => row.phase === Number(phase)) || null;
}

export function phaseStatusIsOperational(row) {
  return Boolean(row && (row.operational === true || row.operational === 'live' || row.operational === 'verified') && row.live === true && row.claims?.verified === true);
}
