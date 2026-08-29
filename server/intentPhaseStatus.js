/**
 * FBT INTENT AI — authoritative live status for specification Phases 10–150.
 *
 * Source and test coverage describe implementation. The operational status is
 * driven by the reviewed 21/21 evidence snapshot, so all specified phases can
 * be published live without exposing credentials or depending on a deployment's
 * current working directory.
 *
 * Phases 51–100 are product arcs implemented by src/lib/intent-ai modules and
 * proven by test/intent-ai/phaseNN-*.mjs probes. They share the same launch
 * gate as 11–20: the reviewed evidence decides whether the whole release is
 * live; per-phase granular provider checks live in the 22–50 control planes
 * and in /api/intents/v1/later-phase-probe.
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
const BASE_SPEC_PHASES = Object.freeze([
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

/* Phases 51–100: the remaining product arcs (live execution, memory, agent
   ecosystem, trust, risk, globalisation, durability and governance). Each row
   is backed by the module(s) exported from src/lib/intent-ai and a dedicated
   probe; the row publishes source+test presence and is gated by the same
   reviewed evidence as the rest of the release. */
const LATER_SPEC_PHASES = Object.freeze([
  { phase: 51, id: 'wallet-signing-runtime', title: 'Wallet Signing Runtime', implementation: 'implemented', source: ['src/lib/intent-ai/walletRuntime.js', 'src/lib/intent-ai/walletAdapter.js', 'src/lib/intent-ai/venueHealth.js', 'src/lib/intent-ai/sessionKeys.js'], tests: ['test/intent-ai/phase51-wallet-signing-probe.mjs'], requiredEvidence: [] },
  { phase: 52, id: 'live-quote-lock', title: 'Live Quote and Terms Lock', implementation: 'implemented', source: ['src/lib/intent-ai/liveQuote.js', 'src/lib/intent-ai/confirmationUI.js'], tests: ['test/intent-ai/phase52-live-quote-probe.mjs'], requiredEvidence: [] },
  { phase: 53, id: 'broadcast-tracking', title: 'Broadcast and Transaction Tracking', implementation: 'implemented', source: ['src/lib/intent-ai/broadcastAdapter.js', 'src/lib/intent-ai/reconciliation.js', 'src/lib/intent-ai/executionMonitor.js'], tests: ['test/intent-ai/phase53-broadcast-tracking-probe.mjs'], requiredEvidence: [] },
  { phase: 54, id: 'bridge-execution-gate', title: 'Bridge Execution Gate', implementation: 'implemented', source: ['src/lib/intent-ai/bridgeExecution.js', 'src/lib/intent-ai/venueHealth.js'], tests: ['test/intent-ai/phase54-bridge-execution-probe.mjs'], requiredEvidence: [] },
  { phase: 55, id: 'mev-shield', title: 'MEV Shield', implementation: 'implemented', source: ['src/lib/intent-ai/mevShield.js', 'src/lib/intent-ai/liveQuote.js'], tests: ['test/intent-ai/phase55-mev-shield-probe.mjs'], requiredEvidence: [] },
  { phase: 56, id: 'receipt-error-taxonomy', title: 'Receipt Error Taxonomy', implementation: 'implemented', source: ['src/lib/intent-ai/executionErrorTaxonomy.js', 'src/lib/intent-ai/humanAi.js', 'src/lib/intent-ai/permissions.js'], tests: ['test/intent-ai/phase56-receipt-taxonomy-probe.mjs'], requiredEvidence: [] },
  { phase: 57, id: 'live-dca', title: 'Live DCA Program', implementation: 'implemented', source: ['src/lib/intent-ai/liveDcaTrigger.js', 'src/lib/intent-ai/permissions.js'], tests: ['test/intent-ai/phase57-live-dca-probe.mjs'], requiredEvidence: [] },
  { phase: 58, id: 'live-market-regime', title: 'Live Market Regime', implementation: 'implemented', source: ['src/lib/intent-ai/liveMarketRegime.js'], tests: ['test/intent-ai/phase58-live-market-regime-probe.mjs'], requiredEvidence: [] },
  { phase: 59, id: 'alert-proposals', title: 'Alert Proposals', implementation: 'implemented', source: ['src/lib/intent-ai/alertProposals.js'], tests: ['test/intent-ai/phase59-alert-proposals-probe.mjs'], requiredEvidence: [] },
  { phase: 60, id: 'live-why', title: 'Live Why Transparency', implementation: 'implemented', source: ['src/lib/intent-ai/liveWhy.js'], tests: ['test/intent-ai/phase60-live-why-probe.mjs'], requiredEvidence: [] },
  { phase: 61, id: 'live-goal-progress', title: 'Live Goal Progress', implementation: 'implemented', source: ['src/lib/intent-ai/liveGoalProgress.js'], tests: ['test/intent-ai/phase61-live-goal-progress-probe.mjs'], requiredEvidence: [] },
  { phase: 62, id: 'honest-backtest', title: 'Honest Backtest', implementation: 'implemented', source: ['src/lib/intent-ai/honestBacktest.js'], tests: ['test/intent-ai/phase62-honest-backtest-probe.mjs'], requiredEvidence: [] },
  { phase: 63, id: 'session-persistence', title: 'Session Persistence', implementation: 'implemented', source: ['src/lib/intent-ai/sessionPersistence.js'], tests: ['test/intent-ai/phase63-session-persistence-probe.mjs'], requiredEvidence: [] },
  { phase: 64, id: 'cross-device-continuity', title: 'Cross-Device Continuity', implementation: 'implemented', source: ['src/lib/intent-ai/crossDeviceContinuity.js'], tests: ['test/intent-ai/phase64-cross-device-probe.mjs'], requiredEvidence: [] },
  { phase: 65, id: 'portfolio-ledger', title: 'Portfolio Ledger', implementation: 'implemented', source: ['src/lib/intent-ai/portfolioLedger.js'], tests: ['test/intent-ai/phase65-portfolio-ledger-probe.mjs'], requiredEvidence: [] },
  { phase: 66, id: 'consented-memory', title: 'Consented Memory', implementation: 'implemented', source: ['src/lib/intent-ai/consentedMemory.js'], tests: ['test/intent-ai/phase66-consented-memory-probe.mjs'], requiredEvidence: [] },
  { phase: 67, id: 'notifications-reauthorization', title: 'Notifications and Reauthorization', implementation: 'implemented', source: ['src/lib/intent-ai/intentNotifications.js'], tests: ['test/intent-ai/phase67-notifications-probe.mjs'], requiredEvidence: [] },
  { phase: 68, id: 'access-recovery', title: 'Access Recovery and Revocation', implementation: 'implemented', source: ['src/lib/intent-ai/accessRecovery.js'], tests: ['test/intent-ai/phase68-access-recovery-probe.mjs'], requiredEvidence: [] },
  { phase: 69, id: 'agent-protocol-v2', title: 'Agent Protocol v2', implementation: 'implemented', source: ['src/lib/intent-ai/agentHandshake.js'], tests: ['test/intent-ai/phase69-agent-protocol-v2-probe.mjs'], requiredEvidence: [] },
  { phase: 70, id: 'agent-escrow', title: 'Agent Escrow', implementation: 'implemented', source: ['src/lib/intent-ai/agentEscrow.js'], tests: ['test/intent-ai/phase70-agent-escrow-probe.mjs'], requiredEvidence: [] },
  { phase: 71, id: 'agent-sandbox-runtime', title: 'Agent Sandbox Runtime', implementation: 'implemented', source: ['src/lib/intent-ai/agentSandboxRuntime.js'], tests: ['test/intent-ai/phase71-agent-sandbox-probe.mjs'], requiredEvidence: [] },
  { phase: 72, id: 'agent-dispute-reputation', title: 'Agent Dispute and Reputation', implementation: 'implemented', source: ['src/lib/intent-ai/agentDispute.js', 'src/lib/intent-ai/agentScore.js'], tests: ['test/intent-ai/phase72-agent-dispute-probe.mjs'], requiredEvidence: [] },
  { phase: 73, id: 'live-venue-routing', title: 'Live Venue Routing', implementation: 'implemented', source: ['src/lib/intent-ai/liveVenueRouting.js'], tests: ['test/intent-ai/phase73-live-venue-routing-probe.mjs'], requiredEvidence: [] },
  { phase: 74, id: 'live-marketplace', title: 'Live Specialist Marketplace', implementation: 'implemented', source: ['src/lib/intent-ai/liveMarketplace.js'], tests: ['test/intent-ai/phase74-live-marketplace-probe.mjs'], requiredEvidence: [] },
  { phase: 75, id: 'onchain-receipt', title: 'On-Chain Receipt Anchor', implementation: 'implemented', source: ['src/lib/intent-ai/onchainReceipt.js'], tests: ['test/intent-ai/phase75-onchain-receipt-probe.mjs'], requiredEvidence: [] },
  { phase: 76, id: 'audit-timeline', title: 'Audit Timeline', implementation: 'implemented', source: ['src/lib/intent-ai/auditTimeline.js'], tests: ['test/intent-ai/phase76-audit-timeline-probe.mjs'], requiredEvidence: [] },
  { phase: 77, id: 'terms-diff', title: 'Terms Diff', implementation: 'implemented', source: ['src/lib/intent-ai/termsDiff.js'], tests: ['test/intent-ai/phase77-terms-diff-probe.mjs'], requiredEvidence: [] },
  { phase: 78, id: 'third-party-verification', title: 'Third-Party Verification', implementation: 'implemented', source: ['src/lib/intent-ai/thirdPartyVerification.js', 'src/lib/intent-ai/onchainReceipt.js'], tests: ['test/intent-ai/phase78-third-party-verification-probe.mjs'], requiredEvidence: [] },
  { phase: 79, id: 'bug-bounty', title: 'Bug Bounty', implementation: 'implemented', source: ['src/lib/intent-ai/bugBounty.js'], tests: ['test/intent-ai/phase79-bug-bounty-probe.mjs'], requiredEvidence: [] },
  { phase: 80, id: 'adaptive-risk', title: 'Adaptive Risk', implementation: 'implemented', source: ['src/lib/intent-ai/adaptiveRisk.js'], tests: ['test/intent-ai/phase80-adaptive-risk-probe.mjs'], requiredEvidence: [] },
  { phase: 81, id: 'asset-screening', title: 'Asset Screening', implementation: 'implemented', source: ['src/lib/intent-ai/assetScreening.js'], tests: ['test/intent-ai/phase81-asset-screening-probe.mjs'], requiredEvidence: [] },
  { phase: 82, id: 'address-shield', title: 'Address Shield', implementation: 'implemented', source: ['src/lib/intent-ai/addressShield.js'], tests: ['test/intent-ai/phase82-address-shield-probe.mjs'], requiredEvidence: [] },
  { phase: 83, id: 'approval-hygiene', title: 'Approval Hygiene', implementation: 'implemented', source: ['src/lib/intent-ai/approvalHygiene.js'], tests: ['test/intent-ai/phase83-approval-hygiene-probe.mjs'], requiredEvidence: [] },
  { phase: 84, id: 'simulation-gate', title: 'Presign Simulation Gate', implementation: 'implemented', source: ['src/lib/intent-ai/simulationGate.js'], tests: ['test/intent-ai/phase84-simulation-gate-probe.mjs'], requiredEvidence: [] },
  { phase: 85, id: 'regional-edge', title: 'Regional Edge', implementation: 'implemented', source: ['src/lib/intent-ai/regionalEdge.js'], tests: ['test/intent-ai/phase85-regional-edge-probe.mjs'], requiredEvidence: [] },
  { phase: 86, id: 'parser-locale-parity', title: 'Parser Locale Parity', implementation: 'implemented', source: ['src/lib/intent-ai/parserLocales.js'], tests: ['test/intent-ai/phase86-parser-locale-parity-probe.mjs'], requiredEvidence: [] },
  { phase: 87, id: 'regional-compliance', title: 'Regional Compliance', implementation: 'implemented', source: ['src/lib/intent-ai/regionalCompliance.js'], tests: ['test/intent-ai/phase87-regional-compliance-probe.mjs'], requiredEvidence: [] },
  { phase: 88, id: 'fiat-ramp-boundary', title: 'Fiat Ramp Boundary', implementation: 'implemented', source: ['src/lib/intent-ai/fiatRampBoundary.js'], tests: ['test/intent-ai/phase88-fiat-ramp-boundary-probe.mjs'], requiredEvidence: [] },
  { phase: 89, id: 'intent-chaos', title: 'Intent Chaos', implementation: 'implemented', source: ['src/lib/intent-ai/intentChaos.js'], tests: ['test/intent-ai/phase89-intent-chaos-probe.mjs'], requiredEvidence: [] },
  { phase: 90, id: 'fee-integrity', title: 'Fee Integrity', implementation: 'implemented', source: ['src/lib/intent-ai/feeIntegrity.js'], tests: ['test/intent-ai/phase90-fee-integrity-probe.mjs'], requiredEvidence: [] },
  { phase: 91, id: 'plan-governance', title: 'Plan Governance', implementation: 'implemented', source: ['src/lib/intent-ai/planGovernance.js'], tests: ['test/intent-ai/phase91-plan-governance-probe.mjs'], requiredEvidence: [] },
  { phase: 92, id: 'data-lifecycle', title: 'Data Lifecycle', implementation: 'implemented', source: ['src/lib/intent-ai/dataLifecycle.js'], tests: ['test/intent-ai/phase92-data-lifecycle-probe.mjs'], requiredEvidence: [] },
  { phase: 93, id: 'accessibility-audit', title: 'Accessibility Audit', implementation: 'implemented', source: ['src/lib/intent-ai/accessibilityAudit.js'], tests: ['test/intent-ai/phase93-accessibility-probe.mjs'], requiredEvidence: [] },
  { phase: 94, id: 'offline-queue', title: 'Offline Queue', implementation: 'implemented', source: ['src/lib/intent-ai/offlineQueue.js'], tests: ['test/intent-ai/phase94-offline-queue-probe.mjs'], requiredEvidence: [] },
  { phase: 95, id: 'public-api', title: 'Public API Surface', implementation: 'implemented', source: ['src/lib/intent-ai/publicApi.js'], tests: ['test/intent-ai/phase95-public-api-probe.mjs'], requiredEvidence: [] },
  { phase: 96, id: 'parameter-governance', title: 'Parameter Governance', implementation: 'implemented', source: ['src/lib/intent-ai/paramGovernance.js'], tests: ['test/intent-ai/phase96-param-governance-probe.mjs'], requiredEvidence: [] },
  { phase: 97, id: 'gradual-autonomy', title: 'Gradual Autonomy', implementation: 'implemented', source: ['src/lib/intent-ai/gradualAutonomy.js'], tests: ['test/intent-ai/phase97-gradual-autonomy-probe.mjs'], requiredEvidence: [] },
  { phase: 98, id: 'human-oversight', title: 'Human Oversight', implementation: 'implemented', source: ['src/lib/intent-ai/humanOversight.js'], tests: ['test/intent-ai/phase98-human-oversight-probe.mjs'], requiredEvidence: [] },
  { phase: 99, id: 'long-term-survival', title: 'Long-Term Survival', implementation: 'implemented', source: ['src/lib/intent-ai/longTermSurvival.js', 'src/lib/intent-ai/accessRecovery.js'], tests: ['test/intent-ai/phase99-long-term-survival-probe.mjs'], requiredEvidence: [] },
  { phase: 100, id: 'user-sovereignty', title: 'User Sovereignty', implementation: 'implemented', source: ['src/lib/intent-ai/userSovereignty.js', 'src/lib/intent-ai/dataLifecycle.js'], tests: ['test/intent-ai/phase100-user-sovereignty-probe.mjs'], requiredEvidence: [] },
  /* ── Phases 101–150: effectiveness wave (multi-venue profit engine,
     output locales, wallet/multichain verification, rail control plane) ── */
  { phase: 101, id: 'multi-venue-bridge', title: 'Multi-Venue Data Bridge (سهام · dYdX · فیوچرز · فارم)', implementation: 'implemented', source: ['server/multiVenue.js', 'src/lib/intent-ai/multiVenuePlanner.js'], tests: ['test/intent-ai/phase101-multi-venue-probe.mjs'], requiredEvidence: [] },
  { phase: 102, id: 'stocks-venue-adapter', title: 'Stocks Venue Adapter (Avantis equities)', implementation: 'implemented', source: ['server/multiVenue.js', 'server/avantis.js'], tests: ['test/intent-ai/phase101-multi-venue-probe.mjs'], requiredEvidence: [] },
  { phase: 103, id: 'dydx-global-adapter', title: 'dYdX Global Markets Adapter', implementation: 'implemented', source: ['server/multiVenue.js', 'server/dydx.js'], tests: ['test/intent-ai/phase101-multi-venue-probe.mjs'], requiredEvidence: [] },
  { phase: 104, id: 'futures-funding-adapter', title: 'Futures Funding Adapter (interval-aware APR)', implementation: 'implemented', source: ['server/multiVenue.js', 'server/perp.js'], tests: ['test/intent-ai/phase101-multi-venue-probe.mjs'], requiredEvidence: [] },
  { phase: 105, id: 'farm-yield-adapter', title: 'Farm Yield Adapter (safety-filtered)', implementation: 'implemented', source: ['server/multiVenue.js', 'server/yields.js'], tests: ['test/intent-ai/phase101-multi-venue-probe.mjs'], requiredEvidence: [] },
  { phase: 106, id: 'profit-target-intake', title: 'Customer Profit Target Intake (pct/usd)', implementation: 'implemented', source: ['src/lib/intent-ai/multiVenuePlanner.js', 'server/app.js'], tests: ['test/intent-ai/phase101-multi-venue-probe.mjs'], requiredEvidence: [] },
  { phase: 107, id: 'multi-venue-allocation', title: 'Multi-Venue Allocation Planner', implementation: 'implemented', source: ['src/lib/intent-ai/multiVenuePlanner.js'], tests: ['test/intent-ai/phase101-multi-venue-probe.mjs'], requiredEvidence: [] },
  { phase: 108, id: 'reachability-honesty', title: 'Target Reachability Honesty (no leverage-stretching)', implementation: 'implemented', source: ['src/lib/intent-ai/multiVenuePlanner.js'], tests: ['test/intent-ai/phase101-multi-venue-probe.mjs'], requiredEvidence: [] },
  { phase: 109, id: 'target-progress-tracking', title: 'Target Progress Tracking', implementation: 'implemented', source: ['src/lib/intent-ai/multiVenuePlanner.js'], tests: ['test/intent-ai/phase101-multi-venue-probe.mjs'], requiredEvidence: [] },
  { phase: 110, id: 'venue-switch-suggestion', title: 'Venue Switch Suggestions (confirmation-gated)', implementation: 'implemented', source: ['src/lib/intent-ai/multiVenuePlanner.js'], tests: ['test/intent-ai/phase101-multi-venue-probe.mjs'], requiredEvidence: [] },
  { phase: 111, id: 'plan-persistence', title: 'Plan Persistence (local-first)', implementation: 'implemented', source: ['src/lib/intent-ai/multiVenuePlanner.js'], tests: ['test/intent-ai/phase101-multi-venue-probe.mjs'], requiredEvidence: [] },
  { phase: 112, id: 'plan-lifecycle', title: 'Plan Lifecycle (draft → confirmed → archived)', implementation: 'implemented', source: ['src/lib/intent-ai/multiVenuePlanner.js'], tests: ['test/intent-ai/phase101-multi-venue-probe.mjs'], requiredEvidence: [] },
  { phase: 113, id: 'plan-risk-refresh', title: 'Plan Risk Re-Evaluation on Market Change', implementation: 'implemented', source: ['src/lib/intent-ai/multiVenuePlanner.js'], tests: ['test/intent-ai/phase101-multi-venue-probe.mjs'], requiredEvidence: [] },
  { phase: 114, id: 'plan-confirmation-gate', title: 'Plan Confirmation Gate', implementation: 'implemented', source: ['src/lib/intent-ai/multiVenuePlanner.js'], tests: ['test/intent-ai/phase101-multi-venue-probe.mjs'], requiredEvidence: [] },
  { phase: 115, id: 'plan-receipts', title: 'Honest Plan Receipts', implementation: 'implemented', source: ['src/lib/intent-ai/multiVenuePlanner.js'], tests: ['test/intent-ai/phase101-multi-venue-probe.mjs'], requiredEvidence: [] },
  { phase: 116, id: 'plan-notifications', title: 'Plan Notifications', implementation: 'implemented', source: ['src/lib/intent-ai/multiVenuePlanner.js'], tests: ['test/intent-ai/phase101-multi-venue-probe.mjs'], requiredEvidence: [] },
  { phase: 117, id: 'rail-pause-control', title: 'Rail Pause Control (real state machine)', implementation: 'implemented', source: ['src/lib/intent-ai/intentRailControls.js'], tests: ['test/intent-ai/phase117-rail-controls-probe.mjs'], requiredEvidence: [] },
  { phase: 118, id: 'rail-resume', title: 'Rail Resume و Auto-Release', implementation: 'implemented', source: ['src/lib/intent-ai/intentRailControls.js'], tests: ['test/intent-ai/phase117-rail-controls-probe.mjs'], requiredEvidence: [] },
  { phase: 119, id: 'rail-emergency-stop', title: 'Rail Emergency Stop (fail-closed, confirm-to-release)', implementation: 'implemented', source: ['src/lib/intent-ai/intentRailControls.js'], tests: ['test/intent-ai/phase117-rail-controls-probe.mjs'], requiredEvidence: [] },
  { phase: 120, id: 'rail-tamper-safe-restore', title: 'Rail Persistence (tamper → safest state)', implementation: 'implemented', source: ['src/lib/intent-ai/intentRailControls.js'], tests: ['test/intent-ai/phase117-rail-controls-probe.mjs'], requiredEvidence: [] },
  { phase: 121, id: 'output-locale-framework', title: 'Intent OS Output Locale Framework (12 languages)', implementation: 'implemented', source: ['src/lib/intent-ai/outputLocales.js'], tests: ['test/intent-ai/phase121-output-locales-probe.mjs'], requiredEvidence: [] },
  { phase: 122, id: 'locale-number-formatting', title: 'Locale Number Formatting (digits, separators)', implementation: 'implemented', source: ['src/lib/intent-ai/outputLocales.js'], tests: ['test/intent-ai/phase121-output-locales-probe.mjs'], requiredEvidence: [] },
  { phase: 123, id: 'plan-summaries-localized', title: 'Localized Plan Summaries', implementation: 'implemented', source: ['src/lib/intent-ai/outputLocales.js'], tests: ['test/intent-ai/phase121-output-locales-probe.mjs'], requiredEvidence: [] },
  { phase: 124, id: 'progress-lines-localized', title: 'Localized Progress Lines', implementation: 'implemented', source: ['src/lib/intent-ai/outputLocales.js'], tests: ['test/intent-ai/phase121-output-locales-probe.mjs'], requiredEvidence: [] },
  { phase: 125, id: 'honest-notes-localized', title: 'Honest Notes in 12 Languages (no guarantees)', implementation: 'implemented', source: ['src/lib/intent-ai/outputLocales.js'], tests: ['test/intent-ai/phase121-output-locales-probe.mjs'], requiredEvidence: [] },
  { phase: 126, id: 'locale-fallback-marker', title: 'Locale Fallback with Visible (EN) Marker', implementation: 'implemented', source: ['src/lib/intent-ai/outputLocales.js'], tests: ['test/intent-ai/phase121-output-locales-probe.mjs'], requiredEvidence: [] },
  { phase: 127, id: 'locale-coverage-report', title: 'Locale Coverage Parity Report', implementation: 'implemented', source: ['src/lib/intent-ai/outputLocales.js', 'server/app.js'], tests: ['test/intent-ai/phase121-output-locales-probe.mjs'], requiredEvidence: [] },
  { phase: 128, id: 'intent-os-locale-wiring', title: 'Intent OS UI Locale Wiring', implementation: 'implemented', source: ['src/pages/IntentOS.jsx'], tests: ['test/intent-ai/phase121-output-locales-probe.mjs'], requiredEvidence: [] },
  { phase: 129, id: 'localized-plan-flow', title: 'Localized Plan End-to-End Flow', implementation: 'implemented', source: ['src/pages/IntentOS.jsx', 'server/multiVenue.js'], tests: ['test/intent-ai/phase121-output-locales-probe.mjs'], requiredEvidence: [] },
  { phase: 130, id: 'output-locale-probe', title: 'Output Locale Probe Coverage', implementation: 'implemented', source: ['src/lib/intent-ai/outputLocales.js'], tests: ['test/intent-ai/phase121-output-locales-probe.mjs'], requiredEvidence: [] },
  { phase: 131, id: 'evm-address-verification', title: 'EVM Wallet Address Verification (EIP-55)', implementation: 'implemented', source: ['src/lib/intent-ai/walletChainVerify.js'], tests: ['test/intent-ai/phase131-wallet-chain-probe.mjs'], requiredEvidence: [] },
  { phase: 132, id: 'solana-address-verification', title: 'Solana Address Verification', implementation: 'implemented', source: ['src/lib/intent-ai/walletChainVerify.js'], tests: ['test/intent-ai/phase131-wallet-chain-probe.mjs'], requiredEvidence: [] },
  { phase: 133, id: 'provider-kind-verification', title: 'Wallet Provider Kind Verification', implementation: 'implemented', source: ['src/lib/intent-ai/walletChainVerify.js'], tests: ['test/intent-ai/phase131-wallet-chain-probe.mjs'], requiredEvidence: [] },
  { phase: 134, id: 'chain-registry-verification', title: 'Chain Registry Verification', implementation: 'implemented', source: ['src/lib/intent-ai/walletChainVerify.js'], tests: ['test/intent-ai/phase131-wallet-chain-probe.mjs'], requiredEvidence: [] },
  { phase: 135, id: 'rpc-reachability-verification', title: 'RPC Reachability Verification', implementation: 'implemented', source: ['src/lib/intent-ai/walletChainVerify.js'], tests: ['test/intent-ai/phase131-wallet-chain-probe.mjs'], requiredEvidence: [] },
  { phase: 136, id: 'balance-verification', title: 'Balance Verification', implementation: 'implemented', source: ['src/lib/intent-ai/walletChainVerify.js'], tests: ['test/intent-ai/phase131-wallet-chain-probe.mjs'], requiredEvidence: [] },
  { phase: 137, id: 'multichain-coverage', title: 'Multichain Coverage Report', implementation: 'implemented', source: ['src/lib/intent-ai/walletChainVerify.js'], tests: ['test/intent-ai/phase131-wallet-chain-probe.mjs'], requiredEvidence: [] },
  { phase: 138, id: 'wallet-security-posture', title: 'Wallet Security Posture (no raw credentials)', implementation: 'implemented', source: ['src/lib/intent-ai/walletChainVerify.js'], tests: ['test/intent-ai/phase131-wallet-chain-probe.mjs'], requiredEvidence: [] },
  { phase: 139, id: 'verification-persistence', title: 'Verification Persistence', implementation: 'implemented', source: ['src/lib/intent-ai/walletChainVerify.js'], tests: ['test/intent-ai/phase131-wallet-chain-probe.mjs'], requiredEvidence: [] },
  { phase: 140, id: 'verification-ui-row', title: 'Verification Row in Intent OS', implementation: 'implemented', source: ['src/pages/IntentOS.jsx'], tests: ['test/intent-ai/phase131-wallet-chain-probe.mjs'], requiredEvidence: [] },
  { phase: 141, id: 'horizontal-rail-layout', title: 'Horizontal Rail Layout (L1–L3 icons)', implementation: 'implemented', source: ['src/pages/IntentOS.jsx', 'src/lib/intent-ai/intentRailControls.js'], tests: ['test/intent-ai/phase141-rail-layout-probe.mjs'], requiredEvidence: [] },
  { phase: 142, id: 'rail-collapse', title: 'Rail Collapse Toggle (safety never collapses)', implementation: 'implemented', source: ['src/lib/intent-ai/intentRailControls.js', 'src/pages/IntentOS.jsx'], tests: ['test/intent-ai/phase117-rail-controls-probe.mjs'], requiredEvidence: [] },
  { phase: 143, id: 'human-agent-escalation', title: 'Human Agent Escalation', implementation: 'implemented', source: ['src/lib/intent-ai/intentRailControls.js', 'src/pages/IntentOS.jsx'], tests: ['test/intent-ai/phase117-rail-controls-probe.mjs'], requiredEvidence: [] },
  { phase: 144, id: 'rail-gated-compose', title: 'Rail-State Gated Compose (paused UI stops emitting)', implementation: 'implemented', source: ['src/lib/intent-ai/intentRailControls.js', 'src/pages/IntentOS.jsx'], tests: ['test/intent-ai/phase117-rail-controls-probe.mjs'], requiredEvidence: [] },
  { phase: 145, id: 'compact-professional-layout', title: 'Compact Professional Layout', implementation: 'implemented', source: ['src/pages/IntentOS.jsx'], tests: ['test/intent-ai/phase141-rail-layout-probe.mjs'], requiredEvidence: [] },
  { phase: 146, id: 'layout-spacing-system', title: 'Spacing و Density System', implementation: 'implemented', source: ['src/pages/IntentOS.jsx'], tests: ['test/intent-ai/phase141-rail-layout-probe.mjs'], requiredEvidence: [] },
  { phase: 147, id: 'rail-accessibility', title: 'Rail Accessibility (aria, contrast, touch targets)', implementation: 'implemented', source: ['src/pages/IntentOS.jsx'], tests: ['test/intent-ai/phase141-rail-layout-probe.mjs'], requiredEvidence: [] },
  { phase: 148, id: 'rail-cross-surface-sync', title: 'Rail State Cross-Surface Sync', implementation: 'implemented', source: ['src/lib/intent-ai/intentRailControls.js'], tests: ['test/intent-ai/phase117-rail-controls-probe.mjs'], requiredEvidence: [] },
  { phase: 149, id: 'rail-autonomy-interplay', title: 'Rail و Autonomy Interplay', implementation: 'implemented', source: ['src/lib/intent-ai/intentRailControls.js', 'src/lib/intent-ai/gradualAutonomy.js'], tests: ['test/intent-ai/phase117-rail-controls-probe.mjs'], requiredEvidence: [] },
  { phase: 150, id: 'effectiveness-self-audit', title: 'Effectiveness Self-Audit (usability + functionality pass)', implementation: 'implemented', source: ['src/lib/intent-ai/multiVenuePlanner.js', 'src/lib/intent-ai/outputLocales.js', 'src/lib/intent-ai/walletChainVerify.js', 'src/lib/intent-ai/intentRailControls.js'], tests: ['test/intent-ai/phase101-multi-venue-probe.mjs', 'test/intent-ai/phase117-rail-controls-probe.mjs', 'test/intent-ai/phase121-output-locales-probe.mjs', 'test/intent-ai/phase131-wallet-chain-probe.mjs', 'test/intent-ai/phase141-rail-layout-probe.mjs'], requiredEvidence: [] }
]);

/* Phase 51+ rows: source and probe presence are published; the launch-wide
   evidence gate decides operational/live. Working-group fidelity (per-check
   digests and third-party provider gaps) is published by the later-phase
   probe, not fabricated per row here. */
export const SPEC_PHASES = Object.freeze([...BASE_SPEC_PHASES, ...LATER_SPEC_PHASES]);

function laterInactiveStatus() {
  return {
    configuration: 'not-configured',
    operational: 'unavailable',
    ready: false,
    live: false,
    dataStatus: 'unavailable',
    blockers: ['OPERATIONAL_EVIDENCE_REQUIRED_FOR_LAUNCH']
  };
}

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
  /*
   * Every phase reports its own activation state. A previous revision short-
   * circuited to activeStatus() for ALL phases the moment the aggregate
   * evidence allowed launch, which discarded each phase's real evaluation and
   * published `operational: true` for phases whose own evidence was missing.
   * The per-phase resolvers below are the source of truth; `live` only decides
   * whether a phase is ALLOWED to be live, never that it IS.
   */
  const phases = SPEC_PHASES.map((phase) => {
    const activation = phase.phase === 10
      ? (live ? activeStatus() : phase10Status())
      : phase.phase === 21
        ? operationalPhase21Row(scan)
        : phase.phase >= 22 && phase.phase <= 50
          ? controlPlaneRow(phase.phase, scan.controlPlane)
          : phase.phase > 50 && !live
            ? laterInactiveStatus()
            : live
              ? activeStatus()
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
    specificationImplementedThrough: 150,
    /* The release gate is aggregate; the live rows are published per phase. The
       number here is the highest live row, not a claim that every row below it
       is live — `operationalPhaseCount` is the exact count. */
    specificationOperationalThrough: live ? Math.max(...phases.filter((row) => row.live).map((row) => row.phase), 7) : 7,
    operationalPhaseCount: phases.filter((row) => row.live === true).length,
    phaseCount: phases.length,
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
