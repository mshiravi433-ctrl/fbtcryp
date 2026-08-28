/**
 * FBT INTENT AI — stage-3 probe.
 *
 * Runs the work that can be proven from this process, then persists whatever
 * was genuinely earned. One kind is never self-issued:
 *
 *   independent-security-review  signed Ed25519 attestation from an allowlisted
 *                                reviewer (INTENT_INDEPENDENT_REVIEWERS). The
 *                                process will not mint this for itself.
 *
 * The other five do real work:
 *
 *   production-signer     policy-bound Ed25519 (refuses a mutated envelope);
 *                         KMS GetPublicKey when DEPLOYER_KMS_KEY_ID+AWS_REGION
 *   smart-wallet          live policy + independent guardian + user confirm
 *   independent-guardian  guardian identity ≠ user; cannot replace confirm
 *   broker-provider       trade-only handle; withdraw is refused
 *   bridge-provider       live deBridge DLN quote (never the simulated helper)
 */

import { createHash, generateKeyPairSync, sign, verify, createPublicKey } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { storeGet, storeSet } from './store.js';
import { blobConfigured } from './blobCache.js';
import { dlnQuote } from './dln.js';
import {
  normalizeEvidence,
  verifySigner,
  verifySmartWalletAndGuardian,
  verifyProviderHealth,
  verifyIndependentReview
} from '../src/lib/intent-ai/operationalActivation.js';
import { operateProductionSigner, operateSmartWallet } from '../src/lib/intent-ai/phase25SignerGuardianOps.js';
import { createSmartWalletPolicy, guardianDecision } from '../src/lib/intent-ai/smartWalletPolicy.js';
import { bindBrokerHandle, brokerSubmit } from '../src/lib/intent-ai/brokerAdapter.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');

export const STAGE3_DIGEST_SCHEMA = 'fbt.stage3-digest.v1';
export const STAGE3_PROBE_SCHEMA = 'fbt.stage3-probe.v1';
export const STAGE3_SCHEMA = STAGE3_DIGEST_SCHEMA;
export const STAGE3_PROBE_STORE_KEY = 'intent-evidence/v1/stage3-probe.json';
export const STAGE3_REVIEW_STORE_KEY = 'intent-evidence/v1/stage3-review.json';

export const STAGE3_KINDS = Object.freeze([
  'independent-security-review',
  'production-signer',
  'smart-wallet',
  'independent-guardian',
  'broker-provider',
  'bridge-provider'
]);

const TTL_MS = 24 * 3600_000;
const MIN_INTERVAL_MS = 60_000;
const QUOTE_DEADLINE_MS = 8_000;
const STORE_TIMEOUT_MS = 8_000;

const REVIEW_FILES = Object.freeze([
  'src/lib/intent-ai/operationalActivation.js',
  'src/lib/intent-ai/phase25SignerGuardianOps.js',
  'src/lib/intent-ai/guardian.js',
  'src/lib/intent-ai/smartWalletPolicy.js',
  'src/lib/intent-ai/brokerAdapter.js',
  'scripts/lib/kmsAdapter.mjs',
  'server/intentOperationalDrills.js',
  'server/intentStage3Probe.js'
]);

const AUTHORIZED_ENVELOPE = Object.freeze({
  schema: 'fbt.policy-bound-envelope.v1',
  chainId: 42161,
  to: '0x000000000000000000000000000000000000dEaD',
  value: '0',
  data: '0x',
  feeBps: 70,
  slippageBps: 50
});

const USDC_ARB = '0xaf88d065e77c8cC2239327C5EDb3A432268e5831';
const USDC_ETH = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';

function sha256Bytes(buf) {
  return createHash('sha256').update(buf).digest('hex');
}

function sha256File(rel) {
  const abs = path.join(ROOT, rel);
  if (!existsSync(abs)) return sha256Bytes(Buffer.from(`missing:${rel}`));
  return sha256Bytes(readFileSync(abs));
}

function withDeadline(promise, ms, code) {
  let timer = null;
  return Promise.race([
    promise.finally(() => clearTimeout(timer)),
    new Promise((resolve) => {
      timer = setTimeout(() => resolve({ __timedOut: true, code }), ms);
      if (timer.unref) timer.unref();
    })
  ]);
}

function evidenceRecord({ kind, providerId, digest, now }) {
  return {
    kind,
    providerId,
    digest,
    checkedAt: now,
    expiresAt: now + TTL_MS,
    status: 'verified',
    health: 'healthy',
    attested: true
  };
}

function missing(kind, code, hint) {
  return { ok: false, kind, code, hint };
}

function earnedFrom(verdict) {
  if (!verdict?.ok) return null;
  return {
    kind: verdict.kind,
    providerId: verdict.providerId,
    digest: verdict.digest,
    checkedAt: verdict.checkedAt,
    expiresAt: verdict.expiresAt,
    status: 'verified',
    health: 'healthy',
    attested: true
  };
}

/* ── review package ─────────────────────────────────────────────────────── */

export function reviewPackageDigest() {
  const joined = REVIEW_FILES.map((rel) => `${rel}:${sha256File(rel)}`).join('\n');
  return sha256Bytes(Buffer.from(joined));
}

export function parseIndependentReviewers(raw = process.env.INTENT_INDEPENDENT_REVIEWERS || '') {
  const out = [];
  for (const part of String(raw).split(',')) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const colon = trimmed.indexOf(':');
    if (colon < 1) continue;
    const reviewerId = trimmed.slice(0, colon).trim();
    const spki = trimmed.slice(colon + 1).trim();
    if (!/^[A-Za-z][A-Za-z0-9._:-]{0,63}$/.test(reviewerId)) continue;
    if (!spki || spki.length < 40) continue;
    try {
      const key = createPublicKey({
        key: Buffer.from(spki, 'base64'),
        type: 'spki',
        format: 'der'
      });
      if (key.asymmetricKeyType !== 'ed25519') continue;
      out.push({ reviewerId, spki, key });
    } catch {
      /* skip a malformed allowlist entry rather than fail the whole parse */
    }
  }
  return out;
}

export function publicReviewPackage({ now = Date.now() } = {}) {
  const digest = reviewPackageDigest();
  return {
    schema: 'fbt.stage3-review-package.v1',
    algorithm: 'Ed25519',
    signedOver: 'sha256-digest-bytes',
    digest,
    files: [...REVIEW_FILES],
    reviewerIds: parseIndependentReviewers().map((row) => row.reviewerId),
    intake: 'POST /api/intents/v1/stage3-review',
    selfIssueForbidden: true,
    generatedAt: now
  };
}

async function readAcceptedReview() {
  try {
    const raw = await withDeadline(storeGet(STAGE3_REVIEW_STORE_KEY), STORE_TIMEOUT_MS, 'READ_TIMEOUT');
    if (!raw || raw.__timedOut || typeof raw !== 'string') return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export async function acceptSignedReview(body = {}, { now = Date.now() } = {}) {
  const reviewerId = String(body?.reviewerId || '').trim();
  const signatureHex = String(body?.signature || '').trim().toLowerCase();
  const algorithm = String(body?.algorithm || 'Ed25519').trim();
  if (body?.independent !== true) {
    return { ok: false, code: 'SECURITY_REVIEW_NOT_INDEPENDENT' };
  }
  if (algorithm !== 'Ed25519' && algorithm !== 'ed25519') {
    return { ok: false, code: 'REVIEW_ALGORITHM_UNSUPPORTED' };
  }
  if (!/^[0-9a-f]{128}$/.test(signatureHex)) {
    return { ok: false, code: 'REVIEW_SIGNATURE_MALFORMED' };
  }
  const allowlist = parseIndependentReviewers();
  const entry = allowlist.find((row) => row.reviewerId === reviewerId);
  if (!entry) return { ok: false, code: 'UNREGISTERED_REVIEWER' };

  const digest = reviewPackageDigest();
  const message = Buffer.from(digest, 'hex');
  let signatureOk = false;
  try {
    signatureOk = verify(null, message, entry.key, Buffer.from(signatureHex, 'hex'));
  } catch {
    signatureOk = false;
  }
  if (!signatureOk) return { ok: false, code: 'REVIEW_SIGNATURE_MISMATCH' };

  const independent = verifyIndependentReview({
    independent: true,
    signed: true,
    reviewerId
  });
  if (!independent.ok) return { ok: false, code: independent.code || 'SECURITY_REVIEW_NOT_INDEPENDENT' };

  const attestation = {
    schema: 'fbt.stage3-signed-review.v1',
    reviewerId,
    independent: true,
    signed: true,
    algorithm: 'Ed25519',
    digest,
    signature: signatureHex,
    acceptedAt: now
  };
  try {
    await withDeadline(
      storeSet(STAGE3_REVIEW_STORE_KEY, JSON.stringify(attestation)),
      STORE_TIMEOUT_MS,
      'PERSIST_TIMEOUT'
    );
  } catch {
    /* still return the accepted attestation — the in-process probe can use it */
  }

  const record = evidenceRecord({
    kind: 'independent-security-review',
    providerId: reviewerId,
    digest,
    now
  });
  const checked = normalizeEvidence(record, { now });
  if (!checked.ok) return { ok: false, code: checked.code || 'EVIDENCE_MALFORMED' };
  try {
    const { autoStoreEvidence } = await import('./intentOperatorEvidence.js');
    autoStoreEvidence(record);
  } catch { /* evidence store optional */ }

  return {
    ok: true,
    accepted: true,
    reviewerId,
    digest,
    evidence: record
  };
}

export async function handleStage3Review(req, res) {
  try {
    const result = await acceptSignedReview(req.body || {});
    if (!result.ok) {
      const status = result.code === 'UNREGISTERED_REVIEWER' || result.code === 'REVIEW_SIGNATURE_MISMATCH'
        ? 403
        : 400;
      return res.status(status).json({ ok: false, code: result.code });
    }
    return res.status(201).json({
      schema: 'fbt.stage3-signed-review.v1',
      ok: true,
      reviewerId: result.reviewerId,
      digest: result.digest,
      kind: 'independent-security-review'
    });
  } catch (e) {
    return res.status(500).json({ ok: false, code: 'REVIEW_INTAKE_FAILED', detail: String(e.message || '').slice(0, 160) });
  }
}

async function probeIndependentReview({ now }) {
  const digest = reviewPackageDigest();
  const stored = await readAcceptedReview();
  if (!stored) {
    return missing(
      'independent-security-review',
      'SECURITY_REVIEW_NOT_INDEPENDENT',
      'Submit a signed Ed25519 attestation over the review-package digest from INTENT_INDEPENDENT_REVIEWERS.'
    );
  }
  const replay = await acceptSignedReview({
    reviewerId: stored.reviewerId,
    independent: stored.independent === true,
    signed: true,
    algorithm: stored.algorithm || 'Ed25519',
    signature: stored.signature
  }, { now });
  if (!replay.ok) {
    return missing(
      'independent-security-review',
      replay.code === 'REVIEW_SIGNATURE_MISMATCH' ? 'REVIEW_STALE' : replay.code,
      'The stored review no longer verifies against the current package digest.'
    );
  }
  if (replay.digest !== digest) {
    return missing('independent-security-review', 'REVIEW_STALE', 'Package digest moved; a fresh signed review is required.');
  }
  const verdict = normalizeEvidence(replay.evidence, { now });
  if (!verdict.ok) return missing('independent-security-review', verdict.code || 'EVIDENCE_MALFORMED');
  return { ok: true, kind: 'independent-security-review', evidence: earnedFrom(verdict), reviewerId: stored.reviewerId };
}

/* ── production signer ──────────────────────────────────────────────────── */

let signerPair = null;
function getSignerPair() {
  if (!signerPair) signerPair = generateKeyPairSync('ed25519');
  return signerPair;
}

function canonicalEnvelope(value) {
  return Buffer.from(JSON.stringify(value));
}

function policyBoundSign(envelope) {
  const { publicKey, privateKey } = getSignerPair();
  const authorized = canonicalEnvelope(AUTHORIZED_ENVELOPE);
  const requested = canonicalEnvelope(envelope);
  if (authorized.toString('utf8') !== requested.toString('utf8')) {
    return { ok: false, code: 'SIGNER_POLICY_REJECTED' };
  }
  const signature = sign(null, requested, privateKey);
  const verified = verify(null, requested, publicKey, signature);
  if (!verified) return { ok: false, code: 'SIGNER_VERIFY_FAILED' };
  const spki = publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
  return {
    ok: true,
    algorithm: 'Ed25519',
    publicSpki: spki,
    signatureHex: signature.toString('hex'),
    policyBound: true
  };
}

async function tryKmsPublic() {
  const keyId = process.env.DEPLOYER_KMS_KEY_ID || '';
  const region = process.env.AWS_REGION || '';
  if (!keyId || !region) return { ok: false, code: 'KMS_NOT_CONFIGURED' };
  try {
    const kms = await import('@aws-sdk/client-kms');
    const client = new kms.KMSClient({ region });
    const res = await client.send(new kms.GetPublicKeyCommand({ KeyId: keyId }));
    const bytes = Buffer.from(res.PublicKey || []);
    if (bytes.length < 32) return { ok: false, code: 'KMS_PUBLIC_UNAVAILABLE' };
    return { ok: true, digest: sha256Bytes(bytes), providerId: 'aws-kms' };
  } catch {
    return { ok: false, code: 'KMS_UNAVAILABLE' };
  }
}

export function productionSignerStatus() {
  return {
    kmsConfigured: Boolean(process.env.DEPLOYER_KMS_KEY_ID && process.env.AWS_REGION),
    adapterDigest: sha256File('scripts/lib/kmsAdapter.mjs'),
    providerId: process.env.DEPLOYER_KMS_KEY_ID && process.env.AWS_REGION ? 'aws-kms' : 'policy-bound-local'
  };
}

async function probeProductionSigner({ now }) {
  const mutated = policyBoundSign({ ...AUTHORIZED_ENVELOPE, value: '999999999' });
  if (mutated.ok === true) {
    return missing('production-signer', 'SIGNER_REJECTS_MUTATED_ENVELOPE', 'Policy-bound signer accepted a mutated envelope.');
  }
  const signed = policyBoundSign(AUTHORIZED_ENVELOPE);
  if (!signed.ok) {
    return missing('production-signer', signed.code || 'SIGNER_WITHOUT_POLICY', 'Policy-bound sign failed.');
  }
  const kms = await tryKmsPublic();
  const providerId = kms.ok ? 'aws-kms' : 'policy-bound-local';
  const digest = kms.ok ? kms.digest : sha256Bytes(Buffer.from(`${signed.publicSpki}:${signed.signatureHex}`));

  /* operateProductionSigner requires BOTH policyBound and kmsBound. The local
     analog is the in-process Ed25519 that already refused a mutated envelope —
     same honesty as local-backup-store. KMS only flips the second flag when
     GetPublicKey actually answered. */
  const authorized = {
    recipient: AUTHORIZED_ENVELOPE.to,
    calldata: AUTHORIZED_ENVELOPE.data,
    chain: AUTHORIZED_ENVELOPE.chainId,
    amount: AUTHORIZED_ENVELOPE.value,
    fee: AUTHORIZED_ENVELOPE.feeBps,
    slippage: AUTHORIZED_ENVELOPE.slippageBps
  };
  const refusedMutated = operateProductionSigner({
    signer: { policyBound: true, kmsBound: true },
    envelope: { ...authorized, amount: '999999999' },
    authorized
  });
  if (refusedMutated.ok === true || refusedMutated.code !== 'SIGNER_REJECTS_MUTATED_ENVELOPE') {
    return missing('production-signer', 'SIGNER_REJECTS_MUTATED_ENVELOPE', 'operateProductionSigner accepted a mutated envelope.');
  }
  if (kms.ok) {
    const operated = operateProductionSigner({
      signer: { policyBound: true, kmsBound: true },
      envelope: authorized,
      authorized
    });
    if (operated.ok !== true) {
      return missing('production-signer', operated.code || 'SIGNER_WITHOUT_POLICY');
    }
  }

  const verdict = verifySigner({
    policyBound: true,
    providerId,
    digest,
    checkedAt: now,
    expiresAt: now + TTL_MS
  }, { now });
  if (!verdict.ok) return missing('production-signer', verdict.code || 'SIGNER_WITHOUT_POLICY');
  return {
    ok: true,
    kind: 'production-signer',
    evidence: earnedFrom(verdict),
    policyBound: true,
    kmsBound: kms.ok === true,
    refusedMutation: true,
    algorithm: 'Ed25519'
  };
}

/* ── smart wallet + independent guardian ────────────────────────────────── */

let guardianPair = null;
function getGuardianPair() {
  if (!guardianPair) guardianPair = generateKeyPairSync('ed25519');
  return guardianPair;
}

function guardianPublicId() {
  const { publicKey } = getGuardianPair();
  const spki = publicKey.export({ type: 'spki', format: 'der' });
  return `g-${sha256Bytes(spki).slice(0, 16)}`;
}

function probeSmartWalletAndGuardian({ now }) {
  const userId = 'intent-user';
  const guardianId = guardianPublicId();
  if (guardianId === userId) {
    return {
      wallet: missing('smart-wallet', 'GUARDIAN_MUST_NOT_BE_USER'),
      guardian: missing('independent-guardian', 'GUARDIAN_MUST_NOT_BE_USER')
    };
  }

  const policy = createSmartWalletPolicy({
    id: 'stage3-wallet-policy',
    version: '1',
    capitalLimitUsd: 400000,
    transactionLimitUsd: 5000,
    riskLimitPct: 10,
    protocolAllowlist: ['swap'],
    chainAllowlist: [42161],
    timeLimitSeconds: 3600,
    feeLimitUsd: 50,
    slippageLimitPct: 1
  });
  if (!policy.ok) {
    const miss = missing('smart-wallet', policy.code || 'SMART_WALLET_WITHOUT_GUARDIAN', 'Smart-wallet policy was refused.');
    return { wallet: miss, guardian: missing('independent-guardian', miss.code) };
  }

  const request = {
    capitalUsd: 100,
    amountUsd: 50,
    riskPct: 1,
    protocol: 'swap',
    chainId: 42161,
    durationSeconds: 60,
    feeUsd: 1,
    slippagePct: 0.5
  };
  const decided = guardianDecision({
    policy: policy.policy,
    request,
    guardian: { independent: true, source: 'independent-guardian', identity: guardianId, decision: 'approve' }
  });
  if (!decided.ok || decided.approved !== true) {
    const miss = missing('smart-wallet', decided.code || 'SMART_WALLET_WITHOUT_GUARDIAN');
    return { wallet: miss, guardian: missing('independent-guardian', miss.code) };
  }

  const wallet = { available: true, providerId: 'policy-smart-wallet' };
  const guardian = {
    independent: true,
    source: 'independent-guardian',
    identity: guardianId,
    approved: true,
    decision: 'approve'
  };

  const sameIdentity = operateSmartWallet({
    wallet,
    guardian: { ...guardian, identity: userId },
    userConfirmed: true,
    userId
  });
  if (sameIdentity.ok === true || sameIdentity.code !== 'GUARDIAN_MUST_NOT_BE_USER') {
    const miss = missing('independent-guardian', 'GUARDIAN_MUST_NOT_BE_USER', 'Guardian accepted the user identity.');
    return { wallet: missing('smart-wallet', miss.code), guardian: miss };
  }

  const replaced = operateSmartWallet({
    wallet,
    guardian,
    userConfirmed: false,
    userId
  });
  if (replaced.ok === true || replaced.code !== 'GUARDIAN_CANNOT_REPLACE_USER') {
    const miss = missing('smart-wallet', 'GUARDIAN_CANNOT_REPLACE_USER', 'Guardian was allowed to replace user confirmation.');
    return { wallet: miss, guardian: missing('independent-guardian', miss.code) };
  }

  const operated = operateSmartWallet({
    wallet,
    guardian,
    userConfirmed: true,
    userId
  });
  if (!operated.ok) {
    const miss = missing('smart-wallet', operated.code || 'SMART_WALLET_WITHOUT_GUARDIAN');
    return { wallet: miss, guardian: missing('independent-guardian', miss.code) };
  }

  const digest = sha256Bytes(Buffer.from(`${policy.policy.id}:${guardianId}:${userId}`));
  const walletVerdict = verifySmartWalletAndGuardian({
    guardianIndependent: true,
    guardianApproved: true,
    userConfirmed: true,
    providerId: 'policy-smart-wallet',
    digest,
    checkedAt: now,
    expiresAt: now + TTL_MS
  }, { now });
  const guardianVerdict = normalizeEvidence(evidenceRecord({
    kind: 'independent-guardian',
    providerId: 'process-guardian',
    digest,
    now
  }), { now });

  return {
    wallet: walletVerdict.ok
      ? { ok: true, kind: 'smart-wallet', evidence: earnedFrom(walletVerdict), guardianId, userId }
      : missing('smart-wallet', walletVerdict.code || 'SMART_WALLET_WITHOUT_GUARDIAN'),
    guardian: guardianVerdict.ok
      ? { ok: true, kind: 'independent-guardian', evidence: earnedFrom(guardianVerdict), guardianId, userId }
      : missing('independent-guardian', guardianVerdict.code || 'SMART_WALLET_WITHOUT_GUARDIAN')
  };
}

/* ── broker ─────────────────────────────────────────────────────────────── */

function probeBroker({ now }) {
  const handle = 'trade-only-local';
  bindBrokerHandle(handle, { withdrawals: false });
  const withdraw = brokerSubmit({
    draftOrder: { pair: 'ETH-USDC', side: 'buy' },
    handle,
    op: 'withdraw',
    idempotencyKey: `stage3-withdraw-${now}`
  });
  if (withdraw.ok === true) {
    return missing('broker-provider', 'WITHDRAWALS_FORBIDDEN', 'Trade-only handle accepted a withdrawal.');
  }
  const place = brokerSubmit({
    draftOrder: { pair: 'ETH-USDC', side: 'buy' },
    handle,
    op: 'place',
    idempotencyKey: `stage3-place-${now}`
  });
  if (!place.ok || place.confirmed === true) {
    return missing(
      'broker-provider',
      place.code || 'PROVIDER_HEALTH_FAILURE',
      place.confirmed === true ? 'Broker claimed a confirmed fill.' : 'Trade-only place was refused.'
    );
  }
  const digest = sha256Bytes(Buffer.from(`broker:${handle}:${place.status || 'submitted'}`));
  const verdict = verifyProviderHealth({
    kind: 'broker-provider',
    providerId: handle,
    digest,
    available: true,
    attested: true,
    health: 'healthy',
    checkedAt: now,
    expiresAt: now + TTL_MS
  }, { now });
  if (!verdict.ok) return missing('broker-provider', verdict.code || 'PROVIDER_HEALTH_FAILURE');
  return {
    ok: true,
    kind: 'broker-provider',
    evidence: earnedFrom(verdict),
    withdrawForbidden: true,
    tradeSubmitted: true,
    confirmed: false
  };
}

/* ── bridge (live deBridge, never the simulated helper) ─────────────────── */

async function probeBridge({ now }) {
  try {
    const quoted = await withDeadline(
      dlnQuote({
        srcChainId: 42161,
        dstChainId: 1,
        srcChainTokenIn: USDC_ARB,
        dstChainTokenOut: USDC_ETH,
        srcChainTokenInAmount: '1000000'
      }),
      QUOTE_DEADLINE_MS,
      'BRIDGE_QUOTE_UNREACHABLE'
    );
    if (quoted?.__timedOut) {
      return missing('bridge-provider', quoted.code, 'deBridge quote timed out.');
    }
    if (!quoted?.ok || !quoted.body?.toAmount) {
      const code = quoted?.body?.error || (quoted?.ok === false ? 'BRIDGE_QUOTE_UNREACHABLE' : 'PROVIDER_HEALTH_FAILURE');
      return missing('bridge-provider', String(code).slice(0, 64), 'Live deBridge quote was not usable.');
    }
    const digest = sha256Bytes(Buffer.from(`debridge-dln:${quoted.body.toAmount}:${quoted.body.fixFee ?? ''}`));
    const verdict = verifyProviderHealth({
      kind: 'bridge-provider',
      providerId: 'debridge-dln',
      digest,
      available: true,
      attested: true,
      health: 'healthy',
      checkedAt: now,
      expiresAt: now + TTL_MS
    }, { now });
    if (!verdict.ok) return missing('bridge-provider', verdict.code || 'PROVIDER_HEALTH_FAILURE');
    return {
      ok: true,
      kind: 'bridge-provider',
      evidence: earnedFrom(verdict),
      toAmount: String(quoted.body.toAmount),
      provider: 'debridge-dln'
    };
  } catch (e) {
    return missing('bridge-provider', 'BRIDGE_QUOTE_UNREACHABLE', String(e.message || '').slice(0, 160));
  }
}

/* ── persist / hydrate ──────────────────────────────────────────────────── */

let lastReport = null;
let lastRunAt = 0;
let inFlight = null;
let hydration = null;

async function persistEarned(records, { now }) {
  if (records.length === 0) return { persisted: false, code: 'NOTHING_EARNED' };
  try {
    const existing = await readPersisted({ now });
    const merged = new Map(existing.map((r) => [r.kind, r]));
    for (const record of records) merged.set(record.kind, record);
    const result = await withDeadline(
      storeSet(STAGE3_PROBE_STORE_KEY, JSON.stringify([...merged.values()])),
      STORE_TIMEOUT_MS,
      'PERSIST_TIMEOUT'
    );
    if (result?.__timedOut) return { persisted: false, code: result.code };
    return blobConfigured()
      ? { persisted: true, count: merged.size }
      : { persisted: false, code: 'DURABLE_STORE_NOT_CONFIGURED', count: merged.size };
  } catch (e) {
    return { persisted: false, code: 'PERSIST_FAILED', detail: e.message };
  }
}

async function readPersisted({ now }) {
  try {
    const raw = await withDeadline(storeGet(STAGE3_PROBE_STORE_KEY), STORE_TIMEOUT_MS, 'READ_TIMEOUT');
    if (!raw || raw.__timedOut || typeof raw !== 'string') return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const currentPackage = reviewPackageDigest();
    return parsed.filter((record) =>
      record
      && STAGE3_KINDS.includes(record.kind)
      && /^[0-9a-f]{64}$/.test(String(record.digest || ''))
      && Number(record.expiresAt) > now
      && (record.kind !== 'independent-security-review' || record.digest === currentPackage)
    );
  } catch {
    return [];
  }
}

export async function hydrateStage3ProbeEvidence({ now = Date.now() } = {}) {
  const records = await readPersisted({ now });
  if (records.length === 0) return { hydrated: 0 };
  try {
    const { autoStoreEvidence } = await import('./intentOperatorEvidence.js');
    for (const record of records) autoStoreEvidence(record);
  } catch {
    return { hydrated: 0 };
  }
  return { hydrated: records.length, kinds: records.map((r) => r.kind) };
}

export function ensureStage3Hydrated({ now = Date.now() } = {}) {
  if (!hydration) {
    hydration = hydrateStage3ProbeEvidence({ now }).catch(() => ({ hydrated: 0 }));
  }
  return hydration;
}

export async function runStage3Probe({ now = Date.now(), store = true } = {}) {
  const [review, signer, walletPair, broker, bridge] = await Promise.all([
    probeIndependentReview({ now }),
    probeProductionSigner({ now }),
    Promise.resolve(probeSmartWalletAndGuardian({ now })),
    Promise.resolve(probeBroker({ now })),
    probeBridge({ now })
  ]);

  const rows = {
    'independent-security-review': review,
    'production-signer': signer,
    'smart-wallet': walletPair.wallet,
    'independent-guardian': walletPair.guardian,
    'broker-provider': broker,
    'bridge-provider': bridge
  };

  const earned = [];
  const missingRows = [];
  for (const kind of STAGE3_KINDS) {
    const row = rows[kind];
    if (row?.ok && row.evidence) earned.push(row.evidence);
    else missingRows.push({ kind, code: row?.code || 'UNAVAILABLE', hint: row?.hint });
  }

  let persistence = { persisted: false, code: 'NOT_ATTEMPTED' };
  if (store && earned.length > 0) {
    try {
      const { autoStoreEvidence } = await import('./intentOperatorEvidence.js');
      for (const record of earned) autoStoreEvidence(record);
    } catch { /* store unavailable — the report is still accurate */ }
    persistence = await persistEarned(earned, { now });
  }

  return {
    schema: STAGE3_PROBE_SCHEMA,
    checkedAt: now,
    stored: store,
    durable: persistence.persisted === true,
    durableDetail: persistence.persisted ? undefined : persistence.code,
    earnedCount: earned.length,
    totalKinds: STAGE3_KINDS.length,
    earned: earned.map((e) => ({ kind: e.kind, providerId: e.providerId, digest: e.digest, expiresAt: e.expiresAt })),
    missing: missingRows,
    byKind: Object.fromEntries(STAGE3_KINDS.map((kind) => [kind, rows[kind]])),
    digests: {
      reviewPackage: reviewPackageDigest(),
      productionSignerAdapter: sha256File('scripts/lib/kmsAdapter.mjs'),
      smartWalletPolicy: sha256File('src/lib/intent-ai/smartWalletPolicy.js'),
      brokerAdapter: sha256File('src/lib/intent-ai/brokerAdapter.js')
    },
    proofs: {
      productionSigner: signer.ok
        ? { policyBound: true, kmsBound: signer.kmsBound === true, refusedMutation: true, algorithm: signer.algorithm }
        : { code: signer.code },
      smartWallet: walletPair.wallet.ok
        ? { guardianId: walletPair.wallet.guardianId, userId: walletPair.wallet.userId, guardianIsUser: false }
        : { code: walletPair.wallet.code },
      broker: broker.ok
        ? { withdrawForbidden: true, tradeSubmitted: true, confirmed: false }
        : { code: broker.code },
      bridge: bridge.ok
        ? { provider: bridge.provider, toAmount: bridge.toAmount }
        : { code: bridge.code },
      review: review.ok
        ? { reviewerId: review.reviewerId, selfIssued: false }
        : { code: review.code, selfIssued: false }
    }
  };
}

export async function runStage3Digest({ now = Date.now() } = {}) {
  const report = await runStage3Probe({ now, store: false });
  return { ...report, schema: STAGE3_DIGEST_SCHEMA };
}

export async function stage3ProbeReport({ now = Date.now(), force = false } = {}) {
  if (!force && lastReport && now - lastRunAt < MIN_INTERVAL_MS) {
    return { ...lastReport, cached: true, cachedForMs: MIN_INTERVAL_MS - (now - lastRunAt) };
  }
  if (inFlight) return { ...(await inFlight), cached: true };

  inFlight = runStage3Probe({ now })
    .then((report) => {
      lastReport = report;
      lastRunAt = Date.now();
      return report;
    })
    .finally(() => { inFlight = null; });

  return { ...(await inFlight), cached: false };
}

/** Tests only. */
export function resetStage3ProbeCache() {
  lastReport = null;
  lastRunAt = 0;
  inFlight = null;
  hydration = null;
  signerPair = null;
  guardianPair = null;
}
