#!/usr/bin/env node
/**
 * Stage-3 probe.
 *
 * Proves the five kinds this process can earn by real work, and that
 * independent-security-review stays missing until an allowlisted reviewer
 * signs the package digest. The process never self-issues that kind.
 */

process.env.NODE_ENV = process.env.NODE_ENV || 'test';
process.env.RATE_LIMIT = process.env.RATE_LIMIT || '100000';
process.env.LEARNING_EVENT_RATE_LIMIT = process.env.LEARNING_EVENT_RATE_LIMIT || '100';
process.env.INTENT_SETTLEMENT_RATE_LIMIT = process.env.INTENT_SETTLEMENT_RATE_LIMIT || '100';
process.env.TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '0000000000:test-only-token';
process.env.ECOSYSTEM_WRITE_RATE_LIMIT = process.env.ECOSYSTEM_WRITE_RATE_LIMIT || '25';

import http from 'node:http';
import { generateKeyPairSync, sign } from 'node:crypto';
import { readFileSync } from 'node:fs';
import {
  normalizeEvidence,
  verifyIndependentReview,
  EVIDENCE_KINDS
} from '../../src/lib/intent-ai/operationalActivation.js';
import { SELF_VERIFIABLE_KINDS } from '../../server/intentAutoEvidence.js';
import { SELF_PROBE_KINDS } from '../../server/intentSelfProbe.js';
import { brokerSubmit } from '../../src/lib/intent-ai/brokerAdapter.js';

const results = [];
const check = (name, ok) => results.push({ name, ok: Boolean(ok) });

const {
  runStage3Probe,
  runStage3Digest,
  resetStage3ProbeCache,
  reviewPackageDigest,
  publicReviewPackage,
  acceptSignedReview,
  parseIndependentReviewers,
  STAGE3_KINDS,
  productionSignerStatus
} = await import('../../server/intentStage3Probe.js');

const previousReviewers = process.env.INTENT_INDEPENDENT_REVIEWERS;
delete process.env.INTENT_INDEPENDENT_REVIEWERS;
resetStage3ProbeCache();

check('six stage-3 kinds are declared', STAGE3_KINDS.length === 6);
check('stage-3 kinds are valid evidence kinds', STAGE3_KINDS.every((k) => EVIDENCE_KINDS.includes(k)));
check('SELF_VERIFIABLE_KINDS stays at 7 local kinds', SELF_VERIFIABLE_KINDS.length === 7);
check('SELF_VERIFIABLE_KINDS never includes a stage-3 kind',
  STAGE3_KINDS.every((k) => !SELF_VERIFIABLE_KINDS.includes(k)));
check('SELF_PROBE_KINDS stays at 4 measurable kinds', SELF_PROBE_KINDS.length === 4);

const dry = await runStage3Probe({ store: false });
check('schema is the live probe schema', dry.schema === 'fbt.stage3-probe.v1');
check('independent-security-review is never self-issued',
  !dry.earned.some((e) => e.kind === 'independent-security-review'));
check('independent review stays SECURITY_REVIEW_NOT_INDEPENDENT',
  dry.missing.some((m) => m.kind === 'independent-security-review' && m.code === 'SECURITY_REVIEW_NOT_INDEPENDENT'));
check('production-signer is earned by a policy-bound local signer',
  dry.earned.some((e) => e.kind === 'production-signer' && e.providerId === 'policy-bound-local'));
check('smart-wallet is earned with an independent guardian',
  dry.earned.some((e) => e.kind === 'smart-wallet' && e.providerId === 'policy-smart-wallet'));
check('independent-guardian is earned with a distinct identity',
  dry.earned.some((e) => e.kind === 'independent-guardian' && e.providerId === 'process-guardian'));
check('broker-provider is earned from a trade-only handle',
  dry.earned.some((e) => e.kind === 'broker-provider' && e.providerId === 'trade-only-local'));
check('proofs record that the signer refused a mutated envelope',
  dry.proofs?.productionSigner?.refusedMutation === true && dry.proofs?.productionSigner?.policyBound === true);
check('proofs record that the guardian is not the user',
  dry.proofs?.smartWallet?.guardianIsUser === false
  && typeof dry.proofs?.smartWallet?.guardianId === 'string'
  && dry.proofs?.smartWallet?.guardianId !== dry.proofs?.smartWallet?.userId);
check('proofs record that withdraw is forbidden and fills are unconfirmed',
  dry.proofs?.broker?.withdrawForbidden === true
  && dry.proofs?.broker?.tradeSubmitted === true
  && dry.proofs?.broker?.confirmed === false);
check('review proofs never claim a self-issue', dry.proofs?.review?.selfIssued === false);

const digestOnly = await runStage3Digest();
check('digest alias keeps the digest schema', digestOnly.schema === 'fbt.stage3-digest.v1');
check('digest alias still does not self-issue a review',
  !digestOnly.earned.some((e) => e.kind === 'independent-security-review'));

for (const summary of dry.earned) {
  const record = dry.byKind[summary.kind]?.evidence;
  check(`earned ${summary.kind} normalizes to verified`, normalizeEvidence(record).ok === true);
  const blob = JSON.stringify(record);
  check(`earned ${summary.kind} carries no secret wording`,
    !/private.?key|seed.?phrase|mnemonic|raw.?secret/i.test(blob));
}

const bridgeRow = dry.byKind['bridge-provider'];
check('bridge-provider is either a real deBridge quote or a closed failure',
  (bridgeRow.ok === true && /^[0-9a-f]{64}$/.test(bridgeRow.evidence?.digest || '') && bridgeRow.provider === 'debridge-dln')
  || (bridgeRow.ok === false && typeof bridgeRow.code === 'string'));
check('stage-3 never invents evidence for a failed kind',
  dry.earned.every((e) => dry.byKind[e.kind].ok === true));
check('review package digest is 64 hex', /^[0-9a-f]{64}$/.test(reviewPackageDigest()));
check('KMS adapter digest is present even without AWS', /^[0-9a-f]{64}$/.test(productionSignerStatus().adapterDigest));
check('local signer providerId is policy-bound-local when KMS is unset',
  productionSignerStatus().providerId === 'policy-bound-local');

const extraPolicyWithdraw = brokerSubmit({
  draftOrder: { pair: 'ETH-USDC', side: 'buy' },
  handle: 'trade-only-local',
  op: 'withdraw',
  extraPolicy: true,
  idempotencyKey: `stage3-extra-${Date.now()}`
});
check('withdraw still needs extraPolicy — the handle itself is not a payout', extraPolicyWithdraw.ok === true);

/* ── independent review intake ─────────────────────────────────────────── */
const { publicKey, privateKey } = generateKeyPairSync('ed25519');
const spki = publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
process.env.INTENT_INDEPENDENT_REVIEWERS = `acme-audit:${spki}`;
check('allowlist parses the reviewer id', parseIndependentReviewers().some((row) => row.reviewerId === 'acme-audit'));

const pkg = publicReviewPackage();
check('review package refuses to self-issue', pkg.selfIssueForbidden === true);
check('review package digest matches the hashed files', pkg.digest === reviewPackageDigest());
check('review package lists the allowlisted reviewer id', pkg.reviewerIds.includes('acme-audit'));

const signature = sign(null, Buffer.from(pkg.digest, 'hex'), privateKey).toString('hex');
const unsigned = await acceptSignedReview({
  reviewerId: 'acme-audit',
  independent: true,
  signed: true,
  algorithm: 'Ed25519',
  signature: '00'.repeat(64)
});
check('a wrong signature is refused', unsigned.ok === false && unsigned.code === 'REVIEW_SIGNATURE_MISMATCH');

const outsider = generateKeyPairSync('ed25519');
const outsiderSig = sign(null, Buffer.from(pkg.digest, 'hex'), outsider.privateKey).toString('hex');
const outsiderTry = await acceptSignedReview({
  reviewerId: 'acme-audit',
  independent: true,
  signed: true,
  algorithm: 'Ed25519',
  signature: outsiderSig
});
check('a non-allowlisted key cannot sign as the reviewer',
  outsiderTry.ok === false && outsiderTry.code === 'REVIEW_SIGNATURE_MISMATCH');

const unknownReviewer = await acceptSignedReview({
  reviewerId: 'not-on-the-list',
  independent: true,
  signed: true,
  algorithm: 'Ed25519',
  signature
});
check('an unregistered reviewer id is refused',
  unknownReviewer.ok === false && unknownReviewer.code === 'UNREGISTERED_REVIEWER');

const notIndependent = await acceptSignedReview({
  reviewerId: 'acme-audit',
  independent: false,
  signed: true,
  algorithm: 'Ed25519',
  signature
});
check('a non-independent payload is refused',
  notIndependent.ok === false && notIndependent.code === 'SECURITY_REVIEW_NOT_INDEPENDENT');

const accepted = await acceptSignedReview({
  reviewerId: 'acme-audit',
  independent: true,
  signed: true,
  algorithm: 'Ed25519',
  signature
});
check('a matching allowlisted signature is accepted', accepted.ok === true && accepted.reviewerId === 'acme-audit');
check('accepted review digest is the current package', accepted.digest === pkg.digest);
check('verifyIndependentReview accepts the allowlisted reviewer',
  verifyIndependentReview({ independent: true, signed: true, reviewerId: 'acme-audit' }).ok === true);

resetStage3ProbeCache();
const afterReview = await runStage3Probe({ store: false });
check('probe earns independent-security-review only after a signed intake',
  afterReview.earned.some((e) => e.kind === 'independent-security-review' && e.providerId === 'acme-audit'));
check('the review evidence digest is the current package',
  afterReview.earned.find((e) => e.kind === 'independent-security-review')?.digest === pkg.digest);

/* ── HTTP surfaces ─────────────────────────────────────────────────────── */
const app = (await import('../../server/app.js')).default;
const server = http.createServer(app);
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const port = server.address().port;
const base = `http://127.0.0.1:${port}`;

try {
  const probeStatus = await fetch(`${base}/api/intents/v1/stage3-probe?dry=1`).then((r) => r.json());
  check('stage3-probe route returns the probe schema', probeStatus.schema === 'fbt.stage3-probe.v1');
  check('stage3-probe dry run does not claim a durable write', probeStatus.stored === false);
  check('stage3-probe dry run still earns in-process kinds', probeStatus.earnedCount >= 4);

  const packageStatus = await fetch(`${base}/api/intents/v1/stage3-review-package`).then((r) => r.json());
  check('review-package route returns the package schema', packageStatus.schema === 'fbt.stage3-review-package.v1');
  check('review-package route never self-issues', packageStatus.selfIssueForbidden === true);

  const digestStatus = await fetch(`${base}/api/intents/v1/stage3-digest`).then((r) => r.json());
  check('stage3-digest route keeps the digest schema', digestStatus.schema === 'fbt.stage3-digest.v1');

  const forged = await fetch(`${base}/api/intents/v1/stage3-review`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      reviewerId: 'acme-audit',
      independent: true,
      signed: true,
      algorithm: 'Ed25519',
      signature: '11'.repeat(64)
    })
  });
  check('POST stage3-review refuses a forged signature', forged.status === 403 || forged.status === 400);

  const posted = await fetch(`${base}/api/intents/v1/stage3-review`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      reviewerId: 'acme-audit',
      independent: true,
      signed: true,
      algorithm: 'Ed25519',
      signature
    })
  });
  const postedBody = await posted.json();
  check('POST stage3-review accepts an allowlisted signature', posted.status === 201 && postedBody.ok === true);
} finally {
  server.close();
}

const src = readFileSync(new URL('../../server/intentStage3Probe.js', import.meta.url), 'utf8');
check('probe source never imports the simulated bridge helper', !src.includes('intentBridgeQuote'));
check('probe source quotes deBridge DLN, not a simulation', src.includes('dlnQuote') && src.includes('debridge-dln'));
check('probe source never adds stage-3 kinds to SELF_VERIFIABLE_KINDS',
  !src.includes('SELF_VERIFIABLE_KINDS'));

if (previousReviewers === undefined) delete process.env.INTENT_INDEPENDENT_REVIEWERS;
else process.env.INTENT_INDEPENDENT_REVIEWERS = previousReviewers;

const passed = results.filter((r) => r.ok).length;
console.log(JSON.stringify({ probe: 'stage3', passed, total: results.length, results }, null, 2));
if (passed !== results.length) process.exitCode = 1;
export default results;
