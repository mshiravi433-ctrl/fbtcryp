/**
 * FBT INTENT AI — authoritative live status for specification Phases 10–200.
 *
 * Source and test coverage describe implementation. The operational status is
 * driven by reviewed evidence AND the individual control-plane evaluators.
 * An aggregate 21/21 snapshot alone cannot publish every phase as live.
 *
 * Phases 51–100 are product arcs implemented by src/lib/intent-ai modules and
 * exercised by test/intent-ai/phaseNN-*.mjs probes. The reviewed evidence
 * and per-phase control-plane checks together gate any claim that the full
 * release is operational. Granular provider checks live in the 22–50 planes
 * and in /api/intents/v1/later-phase-probe.
 */

import { blobConfigured } from './blobCache.js';
import { certificationsConfigured } from './ecosystemCertifications.js';
import { operationalPhase21Row, scanOperationalProviders } from './intentOperationalEvidence.js';
import { controlPlaneRow } from '../src/lib/intent-ai/controlPlaneActivation.js';
import { freezeStateReport } from './intentFreezeControl.js';

export const PHASE_STATUS_SCHEMA = 'fbt.intent-ai-phase-status.v1';

import { SPEC_PHASES, sourceExists } from './intentSpecPhases.js';

/* Re-exported for status consumers. The registry lives in the leaf module. */
export { SPEC_PHASES };

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
  const evidenceAllowsLaunch = scan.readiness?.launchAllowed === true
    && scan.readiness?.operational === 'operational';
  /* Open mode makes implemented capabilities accessible, not "verified".
     Source files and local probes cannot attest an external provider, signer,
     or production incident drill. Live/launch status depends on reviewed
     operator evidence independently of product accessibility. */
  const openMode = String(process.env.INTENT_OS_OPEN_MODE ?? '1').trim() !== '0';
  // Aggregate evidence alone cannot clear blockers in the individual 22–50 planes.
  const live = evidenceAllowsLaunch && scan.controlPlane?.live === true;
  const gate = live ? 'evidence' : (openMode ? 'open-mode-access' : 'closed');
  const phases = SPEC_PHASES.map((phase) => {
    const sourcePresent = phase.source.every(sourceExists);
    const testsPresent = phase.tests.every(sourceExists);
    const implemented = sourcePresent && testsPresent;
    const activation = !implemented ? inactiveStatus(phase)
      : phase.phase === 10
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
    return {
      phase: phase.phase,
      id: phase.id,
      title: phase.title,
      implementation: sourcePresent && testsPresent ? phase.implementation : 'partial',
      source: [...phase.source],
      tests: [...phase.tests],
      sourcePresent,
      testsPresent,
      available: implemented && (openMode || activation.live === true),
      configuration: activation.configuration,
      operational: activation.operational,
      ready: activation.ready,
      live: activation.live,
      dataStatus: activation.dataStatus,
      blockers: activation.blockers,
      requiredEvidence: [...phase.requiredEvidence],
      claims: {
        verified: activation.live === true,
        /* Production means dual-operator attestation backs the release:
           reviewed 21/21 evidence (operator-reviewed) or the owner plane
           bundle (owner-activated). Sandbox-attested dev never claims it. */
        production: activation.live === true && live
          && (scan.mode === 'operator-reviewed' || scan.mode === 'owner-activated'),
        executionActivated: false,
        rawCredentialsAllowed: false
      }
    };
  });
  const launchAllowed = live;
  return {
    schema: PHASE_STATUS_SCHEMA,
    generatedAt: new Date(now).toISOString(),
    status: live ? 'operational' : (openMode ? 'implementation-available' : 'partial'),
    operational: live,
    live,
    /* Accessibility and reviewed launch are separate. */
    gate,
    openMode,
    capabilitiesAvailable: openMode || live,
    sourceOfTruth: 'runtime-evidence-separated-from-source-implementation',
    specificationImplementedThrough: 216,
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
    sandboxEvidenceCount: scan.sandboxEvidenceCount || 0,
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
