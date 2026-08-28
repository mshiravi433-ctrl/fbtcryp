#!/usr/bin/env node
/**
 * Shared helper for the activated-release probes.
 *
 * The phase-status, wave1 and wave4 contracts describe the REVIEWED release:
 * a deployment holding the complete 21/21 operator evidence snapshot. The
 * probes boot a fresh server (empty store) and therefore inject that snapshot
 * through the same dual-operator route a real operator uses. Records are
 * public, deterministic digests only — no secrets, no provider contact
 * claims — and they give the probes the exact inputs the route validates.
 */
import { createHash } from 'node:crypto';
import { EVIDENCE_KINDS } from '../../../src/lib/intent-ai/operationalActivation.js';

export const REVIEWED_OPERATORS = Object.freeze(['review-ledger-a', 'review-ledger-b']);

export function reviewedEvidenceRecords({ now = Date.now(), ttlMs = 6 * 3600_000 } = {}) {
  return EVIDENCE_KINDS.map((kind) => ({
    kind,
    providerId: `reviewed-${kind}`,
    digest: createHash('sha256').update(`fbt-reviewed-release:${kind}`).digest('hex'),
    checkedAt: now - 1000,
    expiresAt: now + ttlMs,
    status: 'verified',
    health: 'healthy',
    attested: true
  }));
}

export async function injectReviewedEvidence(base, options = {}) {
  const body = { evidence: reviewedEvidenceRecords(options) };
  const [op1, op2] = options.operators || REVIEWED_OPERATORS;
  const response = await fetch(`${base}/api/intents/v1/operator-evidence`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'X-Operator-1': op1,
      'X-Operator-2': op2
    },
    body: JSON.stringify(body)
  });
  const result = await response.json();
  if (!response.ok || result.accepted !== EVIDENCE_KINDS.length) {
    throw new Error(`reviewed evidence injection failed: ${response.status} ${JSON.stringify(result)}`);
  }
  return result;
}
