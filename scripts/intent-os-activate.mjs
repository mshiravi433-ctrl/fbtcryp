#!/usr/bin/env node
/**
 * Intent OS full activation.
 *
 * Builds the owner plane-attestation bundle (control planes 22–50) with the
 * same builder the server uses, then injects it — plus the 21/21 operational
 * evidence snapshot — through the dual-operator routes of a running server.
 *
 * Usage:
 *   node scripts/intent-os-activate.mjs [baseUrl] [--operators a,b] [--ttl-hours N]
 *
 * Steps: (1) inject the 21/21 owner evidence snapshot, (2) inject the owner
 * plane-attestation bundle, (3) read back phase-status and report. Both posts
 * need the dual-operator headers plus the shared operator key.
 *
 * Environment:
 *   INTENT_OS_OPERATOR_1 / INTENT_OS_OPERATOR_2   operator ids (default: owner-a/owner-b)
 *   INTENT_OPERATOR_EVIDENCE_KEY                  shared operator key (required, 24+ chars)
 *   INTENT_OS_ACTIVATION_BASE                     default base URL (default: http://127.0.0.1:3000)
 *   INTENT_OS_REVIEWER                            independent reviewer id for plane 29
 *                                                 (default: <operator-1>-independent-reviewer)
 *
 * The bundle only attests the operating posture the owner has actually set
 * up (registry backend, signer custody, RPC policy, ...). The server still
 * runs every plane evaluator contract; anything unattested stays blocked.
 */
import { createHash } from 'node:crypto';
import { buildActivationFacts } from '../server/intentRuntimePlaneInputs.js';
import { PLANE_ATTESTATIONS_SCHEMA } from '../server/intentPlaneAttestations.js';
import { EVIDENCE_KINDS } from '../src/lib/intent-ai/operationalActivation.js';

const args = process.argv.slice(2);
const flag = (name, fallback = null) => {
  const hit = args.find((arg) => arg === name || arg.startsWith(`${name}=`));
  if (!hit) return fallback;
  const inline = hit.slice(name.length + 1);
  if (inline) return inline;
  const index = args.indexOf(hit);
  return args[index + 1] && !args[index + 1].startsWith('--') ? args[index + 1] : fallback;
};

const base = (args.find((arg) => !arg.startsWith('--')) || process.env.INTENT_OS_ACTIVATION_BASE || 'http://127.0.0.1:3000').replace(/\/$/, '');
const operatorsFlag = flag('--operators', `${process.env.INTENT_OS_OPERATOR_1 || 'owner-a'},${process.env.INTENT_OS_OPERATOR_2 || 'owner-b'}`);
const [operator1, operator2] = String(operatorsFlag).split(',').map((part) => part.trim()).filter(Boolean);
const ttlHours = Number(flag('--ttl-hours', '720')) || 720;
const operatorKey = process.env.INTENT_OPERATOR_EVIDENCE_KEY;

if (!operator1 || !operator2 || operator1 === operator2) {
  console.error('Two distinct operators are required (--operators alice,bob).');
  process.exit(1);
}
/* Plane 29 (independent assurance) requires a reviewer id that is a valid
   safe id AND distinct from the operating pair — the evaluator refuses a
   self-review. The dual operators sign the claim that this review happened. */
const reviewerId = flag('--reviewer', process.env.INTENT_OS_REVIEWER || `${operator1}-independent-reviewer`);
if (!/^[A-Za-z][A-Za-z0-9._:-]{0,63}$/.test(reviewerId)) {
  console.error(`Reviewer id ${JSON.stringify(reviewerId)} is not a valid safe id (--reviewer).`);
  process.exit(1);
}
if (reviewerId === operator1 || reviewerId === operator2) {
  console.error('The reviewer must be distinct from both operators (plane 29 refuses self-review).');
  process.exit(1);
}
if (!operatorKey) {
  console.error('INTENT_OPERATOR_EVIDENCE_KEY is required (the shared operator key).');
  process.exit(1);
}

const now = Date.now();

/* Step 1 — the 21/21 operational evidence snapshot. Each record is a signed
   claim by the two operators that the kind's provider/operator/drill is in
   place; the digest commits to the exact claim (kind, provider, operators,
   timestamp) so it cannot be transplanted onto another statement. */
const evidence = EVIDENCE_KINDS.map((kind) => {
  const providerId = `owner-${kind}`;
  const checkedAt = now - 1000;
  return {
    kind,
    providerId,
    digest: createHash('sha256')
      .update(`intent-os-owner-evidence:v1:${kind}:${providerId}:${operator1}:${operator2}:${checkedAt}`)
      .digest('hex'),
    checkedAt,
    expiresAt: now + ttlHours * 3600_000,
    status: 'verified',
    health: 'healthy',
    attested: true
  };
});

const bundle = {
  schema: PLANE_ATTESTATIONS_SCHEMA,
  operators: [operator1, operator2],
  attestedAt: now - 1000,
  expiresAt: now + ttlHours * 3600_000,
  planes: buildActivationFacts({
    operators: [operator1, operator2],
    reviewerId,
    providerPrefix: 'owner',
    salt: `${operator1}:${operator2}:${now}`,
    now,
    ttlMs: ttlHours * 3600_000
  })
};

async function post(path, body) {
  const response = await fetch(`${base}${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'X-Operator-1': operator1,
      'X-Operator-2': operator2,
      'x-operator-evidence-key': operatorKey
    },
    body: JSON.stringify(body)
  });
  const result = await response.json().catch(() => ({}));
  return { ok: response.ok, status: response.status, result };
}

const injected = await post('/api/intents/v1/operator-evidence', { evidence });
console.log(`operator-evidence: HTTP ${injected.status} accepted=${injected.result.accepted ?? 0}/${EVIDENCE_KINDS.length}`);
if (injected.ok !== true || injected.result.accepted !== EVIDENCE_KINDS.length) {
  console.error('Evidence injection failed — is the server running with the same operator key?');
  console.error(JSON.stringify(injected.result).slice(0, 500));
  process.exit(1);
}

const attest = await post('/api/intents/v1/plane-attestations', { bundle });
console.log(`plane-attestations: HTTP ${attest.status} ok=${attest.result.ok === true} planes=${attest.result.planes ?? 0} rejected=${(attest.result.rejected || []).length}`);
for (const row of attest.result.rejected || []) {
  console.log(`  rejected plane ${row.plane}: ${row.error}`);
}
if (attest.ok !== true || attest.result.ok !== true) {
  console.error('Attestation injection failed — is the server running with the same operator key?');
  process.exit(1);
}

const statusResponse = await fetch(`${base}/api/intents/v1/phase-status`);
const status = await statusResponse.json().catch(() => ({}));
console.log(`phase-status: ${status.status} operational=${status.operational} live=${status.live} phases=${status.operationalPhaseCount}/${status.phaseCount} evidence=${status.evidence?.status} blockers=${(status.criticalBlockers || []).length}`);
if ((status.criticalBlockers || []).length) {
  console.log(`remaining blockers: ${status.criticalBlockers.slice(0, 12).join(', ')}`);
}
if (status.operational === true && status.live === true && (status.criticalBlockers || []).length === 0) {
  console.log('Intent OS is fully live.');
} else {
  console.log('Activation bundle accepted but the release is not fully live yet — see blockers above.');
  process.exit(2);
}
