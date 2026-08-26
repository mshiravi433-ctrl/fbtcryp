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

export const PHASE21_STATUS_SCHEMA = 'fbt.intent-ai-phase21-status.v1';

function configurationSnapshot(env = process.env) {
  return {
    durableRegistryConfigured: blobConfigured(),
    certifierAllowlistConfigured: certificationsConfigured(),
    secretManagerNamed: Boolean(String(env.INTENT_SECRET_MANAGER_PROVIDER || '').trim()),
    independentReviewNamed: Boolean(String(env.INTENT_INDEPENDENT_OPERATOR_ATTESTATIONS || '').trim()),
    workflowBatchNamed: Boolean(String(env.INTENT_WORKFLOW_BATCH_ADDRESS || '').trim()),
    merkleAnchorNamed: Boolean(String(env.INTENT_MERKLE_ANCHOR_NETWORKS || '').trim())
  };
}

/**
 * Convert configuration into *candidate* evidence only. Candidates are never
 * verified unless `injectedEvidence` already passed the public contract.
 */
export function scanOperationalProviders({ env = process.env, injectedEvidence = [], now = Date.now() } = {}) {
  const config = configurationSnapshot(env);
  const readiness = aggregateOperationalReadiness({ evidence: injectedEvidence, now });
  const publicDigest = createHash('sha256')
    .update(JSON.stringify({ kinds: EVIDENCE_KINDS, blockers: readiness.blockers, at: now }))
    .digest('hex');

  return {
    schema: PHASE21_STATUS_SCHEMA,
    generatedAt: new Date(now).toISOString(),
    configuration: config,
    connectedProviders: [],
    candidates: Object.entries(config)
      .filter(([, present]) => present)
      .map(([name]) => ({ name, status: 'configured-not-verified' })),
    readiness,
    publicStatus: phase21PublicStatus(readiness),
    publicDigest,
    controlPlane: activateControlPlane({ evidence: injectedEvidence, freeze: true, now }),
    secretsExposed: false
  };
}

export function operationalPhase21Row(scan = scanOperationalProviders()) {
  const readiness = scan.readiness;
  return {
    configuration: readiness.configuration,
    operational: 'unavailable',
    ready: false,
    live: false,
    dataStatus: 'unavailable',
    blockers: readiness.blockers.length ? readiness.blockers : ['CRITICAL_EVIDENCE_MISSING'],
    evidence: readiness.evidence,
    launchAllowed: false,
    claims: {
      verified: false,
      production: false,
      executionActivated: false,
      rawCredentialsAllowed: false
    }
  };
}
