/**
 * FBT INTENT AI — Phase 21 server-side evidence scan.
 *
 * This adapter inspects whether real providers are present. Configuration
 * names and env flags never flip a row to verified/operational. Only an
 * injected, attested, current evidence object can do that.
 */

import { createHash } from 'node:crypto';
import { blobConfigured } from './blobCache.js';
import { certificationsConfigured } from './ecosystemCertifications.js';
import {
  aggregateOperationalReadiness,
  EVIDENCE_KINDS,
  phase21PublicStatus
} from '../src/lib/intent-ai/operationalActivation.js';
import { activateControlPlane } from '../src/lib/intent-ai/controlPlaneActivation.js';
import { sandboxEvidenceEnabled, SANDBOX_EVIDENCE_PROVENANCE } from './intentSandboxEvidence.js';
import { getPlaneAttestations, resolveActivationMode } from './intentPlaneAttestations.js';
import { collectPlaneInputs } from './intentRuntimePlaneInputs.js';

/* Read the operator store directly. Keeping this adapter on a global registry
   made the first serverless invocation dependent on module load order and
   could expose stale evidence after a warm restart. The store contains only
   the already-normalized public records. */
import { getStoredEvidence } from './intentOperatorEvidence.js';

function getInjectedEvidence() {
  return getStoredEvidence();
}

export const PHASE21_STATUS_SCHEMA = 'fbt.intent-ai-phase21-status.v1';

function configurationSnapshot(env = process.env) {
  return {
    durableRegistryConfigured: blobConfigured(),
    certifierAllowlistConfigured: certificationsConfigured(),
    secretManagerNamed: Boolean(String(env.INTENT_SECRET_MANAGER_PROVIDER || '').trim()),
    independentReviewNamed: Boolean(String(env.INTENT_INDEPENDENT_OPERATOR_ATTESTATIONS || '').trim()),
    workflowBatchNamed: Boolean(String(env.INTENT_WORKFLOW_BATCH_ADDRESS || '').trim()),
    merkleAnchorNamed: Boolean(String(env.INTENT_MERKLE_ANCHOR_NETWORKS || '').trim()),
    sandboxEvidence: sandboxEvidenceEnabled(env)
  };
}

/**
 * Convert configuration into public provider metadata. Operational readiness
 * itself comes from the reviewed evidence records, never from an env flag.
 */
export function scanOperationalProviders({ env = process.env, injectedEvidence = null, now = Date.now() } = {}) {
  const config = configurationSnapshot(env);
  /* If no injectedEvidence is explicitly passed, pull from operator store */
  const evidence = injectedEvidence !== null ? injectedEvidence : getInjectedEvidence();
  const sandboxRecords = evidence.filter((row) => row.source === 'sandbox-operator'
    || row.provenance === SANDBOX_EVIDENCE_PROVENANCE);
  /* Owner policy (2026-09-25, full activation): which records count toward
     launch depends on the activation mode.
     - off     — historic behaviour: only dual-operator reviewed records.
     - owner   — owner-bundle + reviewed + the process's own real local
                 measurements (auto-local) count; sandbox stays separate.
     - sandbox — dev/preview: the labelled sandbox self-attestations count.
     Unattributed leftovers and v1 operator posts never count in any mode. */
  const attestations = injectedEvidence !== null ? null : getPlaneAttestations({ now });
  const activationMode = injectedEvidence !== null
    ? 'off'
    : resolveActivationMode({ env, attestations, now });
  const reviewedRecords = evidence.filter((row) => {
    const isSandbox = row.source === 'sandbox-operator'
      || row.provenance === SANDBOX_EVIDENCE_PROVENANCE;
    if (isSandbox) return activationMode === 'sandbox';
    if (row.source === 'auto-local-evidence') return activationMode !== 'off';
    if (row.source === 'unattributed-durable-evidence') return false;
    if (row.source === 'operator-evidence-endpoint' && row.authVersion !== 'operator-v2') return false;
    return true;
  });
  // Hashes of source files prove code existed, NOT that a production RPC,
  // signer, independent reviewer or broker answered. Keep the two modes apart.
  const readiness = aggregateOperationalReadiness({ evidence: reviewedRecords, now });
  const sandboxReadiness = aggregateOperationalReadiness({ evidence: sandboxRecords, now });
  const publicDigest = createHash('sha256')
    .update(JSON.stringify({ kinds: EVIDENCE_KINDS, blockers: readiness.blockers, at: now }))
    .digest('hex');

  /* Control-plane inputs: attested facts + live runtime overlays. In `off`
     mode every plane gets empty inputs and stays blocked (historic). */
  const launchAllowed = readiness.launchAllowed === true && readiness.operational === 'operational';
  const collected = collectPlaneInputs({
    mode: activationMode,
    facts: activationMode === 'owner' ? (attestations?.normalized.planes || null) : null,
    launchAllowed,
    now
  });

  const countedSandbox = reviewedRecords.some((row) => row.source === 'sandbox-operator'
    || row.provenance === SANDBOX_EVIDENCE_PROVENANCE);
  return {
    schema: PHASE21_STATUS_SCHEMA,
    generatedAt: new Date(now).toISOString(),
    mode: activationMode === 'owner' && launchAllowed ? 'owner-activated'
      : activationMode === 'sandbox' && countedSandbox ? 'sandbox-attested'
      : launchAllowed ? 'operator-reviewed'
      : (sandboxRecords.length ? SANDBOX_EVIDENCE_PROVENANCE : 'unverified'),
    activation: {
      mode: activationMode,
      provenance: collected.meta.provenance,
      planes: collected.meta.planes,
      attestations: attestations ? {
        operators: attestations.normalized.operators,
        source: attestations.source,
        attestedAt: attestations.normalized.attestedAt,
        expiresAt: attestations.normalized.expiresAt,
        planes: attestations.normalized.present.length
      } : null
    },
    sandboxEnabled: sandboxEvidenceEnabled(env),
    sandboxEvidenceCount: sandboxReadiness.evidence.length,
    configuration: config,
    connectedProviders: readiness.evidence.map((row) => ({
      kind: row.kind,
      providerId: row.providerId,
      status: 'verified'
    })),
    candidates: Object.entries(config)
      .filter(([, present]) => present)
      .map(([name]) => ({ name, status: 'configured' })),
    readiness,
    sandboxReadiness,
    publicStatus: phase21PublicStatus(readiness),
    publicDigest,
    controlPlane: activateControlPlane({ evidence: reviewedRecords, ...collected.inputs, freeze: false, now }),
    secretsExposed: false
  };
}

export function operationalPhase21Row(scan = scanOperationalProviders()) {
  const readiness = scan.readiness;
  const evidenceReady = readiness?.launchAllowed === true && readiness?.operational === 'operational';
  const live = evidenceReady && scan.controlPlane?.live === true;
  return {
    configuration: live ? 'verified' : (evidenceReady ? 'operator-attested' : readiness.configuration),
    operational: live,
    ready: live,
    evidenceReady,
    live,
    dataStatus: live ? 'live' : 'unavailable',
    blockers: live ? [] : (evidenceReady ? (scan.controlPlane?.blockers || ['CONTROL_PLANES_UNVERIFIED'])
      : (readiness.blockers.length ? readiness.blockers : ['CRITICAL_EVIDENCE_MISSING'])),
    evidence: readiness.evidence,
    launchAllowed: live,
    claims: {
      verified: live,
      production: live,
      executionActivated: false,
      rawCredentialsAllowed: false
    }
  };
}
