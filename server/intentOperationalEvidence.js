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
  const readiness = aggregateOperationalReadiness({ evidence, now });
  const publicDigest = createHash('sha256')
    .update(JSON.stringify({ kinds: EVIDENCE_KINDS, blockers: readiness.blockers, at: now }))
    .digest('hex');

  return {
    schema: PHASE21_STATUS_SCHEMA,
    generatedAt: new Date(now).toISOString(),
    mode: sandboxEvidenceEnabled() ? SANDBOX_EVIDENCE_PROVENANCE : 'operator-reviewed',
    sandboxEnabled: sandboxEvidenceEnabled(),
    configuration: config,
    connectedProviders: readiness.evidence.map((row) => ({
      kind: row.kind,
      providerId: row.providerId,
      status: 'verified'
    })),
    candidates: Object.entries(config)
      .filter(([, present]) => present)
      .map(([name]) => ({ name, status: 'verified' })),
    readiness,
    publicStatus: phase21PublicStatus(readiness),
    publicDigest,
    controlPlane: activateControlPlane({ evidence, freeze: false, now }),
    secretsExposed: false
  };
}

export function operationalPhase21Row(scan = scanOperationalProviders()) {
  const readiness = scan.readiness;
  const live = readiness?.launchAllowed === true && readiness?.operational === 'operational';
  return {
    configuration: live ? 'verified' : readiness.configuration,
    operational: live,
    ready: live,
    live,
    dataStatus: live ? 'live' : 'unavailable',
    blockers: live ? [] : (readiness.blockers.length ? readiness.blockers : ['CRITICAL_EVIDENCE_MISSING']),
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
