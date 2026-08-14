/**
 * Confidential Intent commit/reveal primitives.
 *
 * This module deliberately does not provide a production storage adapter.
 * Vercel Blob objects in this repository are written with `access: 'public'`;
 * they are suitable for hash-only transparency records and categorically not
 * for plaintext preimages. Until a durable, access-controlled private store
 * and authenticated requester protocol exist, every storage operation fails
 * closed and the public API remains unavailable.
 */

import { createHash, randomBytes } from 'node:crypto';
import {
  canonicalValue,
  parseSolverRegistry,
  publicKeyFromPrivateKey,
  signCanonicalPayload,
  verifyCanonicalSignature
} from './intentSignatures.js';
import { coordinatorConfig, verifyAuctionClose } from './intentAuctions.js';

export const INTENT_COMMITMENT_SCHEMA = 'fbt.intent-commitment.v1';
export const INTENT_REVEAL_SCHEMA = 'fbt.intent-reveal.v1';
export const PRIVATE_PREIMAGE_SCHEMA = 'fbt.intent-private-preimage.v1';
export const COMMITMENT_DOMAIN = 'fbt.intent-commitment.v1/signature';
export const REVEAL_DOMAIN = 'fbt.intent-reveal.v1/signature';
const COMMITMENT_ID_DOMAIN = 'fbt.intent-commitment.v1/id';
const REVEAL_ID_DOMAIN = 'fbt.intent-reveal.v1/id';
const BOUND_PREIMAGE_DOMAIN = 'fbt.intent-private-preimage.v1/hash';
const TX_RE_64 = /^0x[a-fA-F0-9]{64}$/;
const NONCE_RE = /^0x[a-fA-F0-9]{32,128}$/;
const ID_RE = /^[a-z0-9][a-z0-9._-]{1,47}$/;
const MAX_PREIMAGE_BYTES = 64 * 1024;
const MAX_COMMITMENT_WINDOW_SECONDS = 24 * 60 * 60;
const MAX_CLOCK_SKEW_SECONDS = 30;
const PUBLIC_COMMITMENT_FIELDS = new Set([
  'schema', 'intentHash', 'auctionId', 'revealHash', 'solverId',
  'committedAt', 'issuedAt', 'deadline', 'nonce', 'preimageHolder',
  'commitRevealMetadataPrivacy', 'claims', 'commitmentId', 'signature'
]);
const PUBLIC_COMMITMENT_CLAIMS = new Set([
  'boundToAuctionNonceDeadline', 'fullPrivacyFromAllParties',
  'hiddenFromFbt', 'thresholdOrTeeAttestation', 'custody'
]);

const sha256Hex = (value) => `0x${createHash('sha256').update(value).digest('hex')}`;
const safeHash = (value) => TX_RE_64.test(String(value || '')) ? String(value).toLowerCase() : null;
const same = (a, b) => String(a || '').toLowerCase() === String(b || '').toLowerCase();

function validEd25519Signature(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]+$/.test(value)) return false;
  const raw = Buffer.from(value, 'base64url');
  return raw.length === 64 && raw.toString('base64url') === value;
}

/** Legacy-compatible unbound hash helper. Production commitments use the
 * bound hash below so an identical preimage cannot be replayed into a different
 * auction, requester, nonce, or deadline. */
export function revealHashFor(preimage) {
  return sha256Hex(JSON.stringify(canonicalValue(preimage)));
}

function boundRevealHash(value) {
  return sha256Hex(`${BOUND_PREIMAGE_DOMAIN}\n${JSON.stringify(canonicalValue(value))}`);
}

function commitmentIdFor(core) {
  return sha256Hex(`${COMMITMENT_ID_DOMAIN}\n${JSON.stringify(canonicalValue(core))}`);
}

function revealIdFor(core) {
  return sha256Hex(`${REVEAL_ID_DOMAIN}\n${JSON.stringify(canonicalValue(core))}`);
}

function validPreimage(preimage) {
  if (!preimage || typeof preimage !== 'object' || Array.isArray(preimage)) return false;
  try {
    const encoded = JSON.stringify(canonicalValue(preimage));
    return encoded.length > 2 && Buffer.byteLength(encoded) <= MAX_PREIMAGE_BYTES;
  } catch {
    return false;
  }
}

function privateCore({ intentHash, auctionId, solverId, nonce, deadline, preimage }) {
  return {
    schema: PRIVATE_PREIMAGE_SCHEMA,
    intentHash: String(intentHash).toLowerCase(),
    auctionId: String(auctionId).toLowerCase(),
    solverId: String(solverId),
    nonce: String(nonce).toLowerCase(),
    deadline,
    preimage: canonicalValue(preimage)
  };
}

/**
 * Build strictly separated records:
 *   - `commitment` is safe for a public immutable log and has no preimage.
 *   - `privateRecord` contains plaintext and must only enter a durable private
 *     store. It is never a public response or a public-Blob payload.
 */
export function buildIntentCommitment({
  intentHash,
  auctionId,
  preimage,
  solverId,
  nonce = `0x${randomBytes(16).toString('hex')}`,
  deadline = Math.floor(Date.now() / 1000) + 300,
  issuedAt = Math.floor(Date.now() / 1000)
}, privateKey) {
  const intent = safeHash(intentHash);
  const auction = safeHash(auctionId);
  const requester = String(solverId || '');
  if (!intent || !auction || !ID_RE.test(requester) || !NONCE_RE.test(String(nonce || ''))
    || !Number.isSafeInteger(issuedAt) || !Number.isSafeInteger(deadline)
    || deadline <= issuedAt || deadline - issuedAt > MAX_COMMITMENT_WINDOW_SECONDS
    || !validPreimage(preimage)) {
    return { ok: false, code: 'BAD_COMMITMENT' };
  }

  const privateRecord = privateCore({
    intentHash: intent,
    auctionId: auction,
    solverId: requester,
    nonce,
    deadline,
    preimage
  });
  const revealHash = boundRevealHash(privateRecord);
  const core = {
    schema: INTENT_COMMITMENT_SCHEMA,
    intentHash: intent,
    auctionId: auction,
    revealHash,
    solverId: requester,
    committedAt: Date.now(),
    issuedAt,
    deadline,
    nonce: String(nonce).toLowerCase(),
    preimageHolder: 'fbt-secure-private-store',
    commitRevealMetadataPrivacy: false,
    claims: {
      boundToAuctionNonceDeadline: true,
      fullPrivacyFromAllParties: false,
      hiddenFromFbt: false,
      thresholdOrTeeAttestation: false,
      custody: false
    }
  };
  const commitmentId = commitmentIdFor(core);
  let signature;
  try {
    signature = signCanonicalPayload(COMMITMENT_DOMAIN, { ...core, commitmentId }, privateKey);
  } catch {
    return { ok: false, code: 'BAD_SIGNING_KEY' };
  }
  return {
    ok: true,
    commitment: { ...core, commitmentId, signature },
    privateRecord: { ...privateRecord, commitmentId, revealHash }
  };
}

function validCommitmentShape(commitment) {
  if (!commitment || typeof commitment !== 'object' || Array.isArray(commitment)
    || Object.keys(commitment).some((key) => !PUBLIC_COMMITMENT_FIELDS.has(key))
    || commitment.schema !== INTENT_COMMITMENT_SCHEMA
    || !safeHash(commitment.intentHash) || !safeHash(commitment.auctionId)
    || !safeHash(commitment.revealHash) || !safeHash(commitment.commitmentId)
    || !ID_RE.test(String(commitment.solverId || ''))
    || !NONCE_RE.test(String(commitment.nonce || ''))
    || !Number.isSafeInteger(commitment.committedAt)
    || !Number.isSafeInteger(commitment.issuedAt)
    || !Number.isSafeInteger(commitment.deadline)
    || Math.abs(commitment.committedAt - commitment.issuedAt * 1000) > MAX_CLOCK_SKEW_SECONDS * 1000
    || commitment.committedAt >= commitment.deadline * 1000
    || commitment.deadline <= commitment.issuedAt
    || commitment.deadline - commitment.issuedAt > MAX_COMMITMENT_WINDOW_SECONDS
    || commitment.preimageHolder !== 'fbt-secure-private-store'
    || commitment.commitRevealMetadataPrivacy !== false
    || !commitment.claims || typeof commitment.claims !== 'object' || Array.isArray(commitment.claims)
    || Object.keys(commitment.claims).some((key) => !PUBLIC_COMMITMENT_CLAIMS.has(key))
    || commitment.claims.boundToAuctionNonceDeadline !== true
    || commitment.claims.fullPrivacyFromAllParties !== false
    || commitment.claims.hiddenFromFbt !== false
    || commitment.claims.thresholdOrTeeAttestation !== false
    || commitment.claims.custody !== false
    || !validEd25519Signature(commitment.signature)) return false;
  const { signature: _signature, commitmentId, ...core } = commitment;
  return commitmentIdFor(core) === commitmentId;
}

function commitmentSignatureValid(commitment, publicKey) {
  if (!validCommitmentShape(commitment) || !publicKey) return false;
  const { signature, ...unsigned } = commitment;
  return verifyCanonicalSignature(COMMITMENT_DOMAIN, unsigned, signature, publicKey);
}

/**
 * Authenticate a public commitment against the architecture's Ed25519 solver
 * registry. Optional replay indexes represent the atomic durable indexes a
 * future admission adapter must provide; merely trusting solverId is never
 * enough.
 */
export function verifyIntentCommitment(commitment, {
  registry = parseSolverRegistry(),
  now = Date.now(),
  seenCommitmentIds,
  seenNonces
} = {}) {
  if (!validCommitmentShape(commitment)) return { ok: false, code: 'BAD_COMMITMENT' };
  const nowSeconds = Math.floor(now / 1000);
  if (commitment.issuedAt > nowSeconds + MAX_CLOCK_SKEW_SECONDS
    || commitment.committedAt > now + MAX_CLOCK_SKEW_SECONDS * 1000
    || commitment.deadline <= nowSeconds) return { ok: false, code: 'COMMITMENT_EXPIRED' };
  const requester = registry.get(commitment.solverId);
  if (!requester || requester.active === false) return { ok: false, code: 'UNAUTHENTICATED_REQUESTER' };
  if (!commitmentSignatureValid(commitment, requester.publicKey)) {
    return { ok: false, code: 'SIGNATURE_MISMATCH' };
  }
  const nonceKey = `${commitment.solverId}:${String(commitment.nonce).toLowerCase()}`;
  if (seenCommitmentIds?.has(commitment.commitmentId) || seenNonces?.has(nonceKey)) {
    return { ok: false, code: 'COMMITMENT_REPLAY' };
  }
  return { ok: true, commitment, nonceKey };
}

/** Construct the only payload permitted in public commitment storage. */
export function publicCommitmentRecord(commitment) {
  if (!validCommitmentShape(commitment)) return { ok: false, code: 'BAD_COMMITMENT' };
  const publicOnly = {
    schema: commitment.schema,
    intentHash: commitment.intentHash,
    auctionId: commitment.auctionId,
    revealHash: commitment.revealHash,
    solverId: commitment.solverId,
    committedAt: commitment.committedAt,
    issuedAt: commitment.issuedAt,
    deadline: commitment.deadline,
    nonce: commitment.nonce,
    preimageHolder: commitment.preimageHolder,
    commitRevealMetadataPrivacy: commitment.commitRevealMetadataPrivacy,
    claims: { ...commitment.claims },
    commitmentId: commitment.commitmentId,
    signature: commitment.signature
  };
  return {
    ok: true,
    record: {
      schema: 'fbt.commitment-log-entry.v1',
      storedAt: Date.now(),
      commitment: publicOnly
    }
  };
}

function privateRecordMatches(commitment, privateRecord) {
  if (!privateRecord || privateRecord.schema !== PRIVATE_PREIMAGE_SCHEMA
    || !same(privateRecord.commitmentId, commitment?.commitmentId)
    || !same(privateRecord.intentHash, commitment?.intentHash)
    || !same(privateRecord.auctionId, commitment?.auctionId)
    || privateRecord.solverId !== commitment?.solverId
    || !same(privateRecord.nonce, commitment?.nonce)
    || privateRecord.deadline !== commitment?.deadline
    || !validPreimage(privateRecord.preimage)) return false;
  const { commitmentId: _id, revealHash: _hash, ...core } = privateRecord;
  return boundRevealHash(core) === commitment.revealHash
    && same(privateRecord.revealHash, commitment.revealHash);
}

/**
 * Storage stays unavailable until an atomic durable implementation can commit
 * a public hash and private plaintext without ever routing plaintext through a
 * public writer. An arbitrary configured key or public Blob token is not that
 * implementation.
 */
export async function storeIntentCommitment({ commitment, privateRecord } = {}, options = {}) {
  const authenticated = verifyIntentCommitment(commitment, options);
  if (!authenticated.ok) return authenticated;
  if (!publicCommitmentRecord(commitment).ok || !privateRecordMatches(commitment, privateRecord)) {
    return { ok: false, code: 'BAD_COMMITMENT' };
  }
  /* Authentication alone is insufficient: without atomic durable public,
     private, nonce and commitment-id indexes, admitting this would make replay
     and data-loss behavior instance-dependent. */
  return { ok: false, code: 'CONFIDENTIAL_PRIVATE_STORE_UNAVAILABLE' };
}

/** No fallback to historical public records: old public objects may contain a
 * preimage and must never be treated as a private source for reveal. */
export async function readCommitments(intentHash) {
  if (!safeHash(intentHash)) return { error: 'BAD_INTENT_HASH' };
  return { error: 'CONFIDENTIAL_MODE_UNAVAILABLE' };
}

export async function readCommitment(intentHash, commitmentId) {
  if (!safeHash(intentHash) || !safeHash(commitmentId)) return { error: 'BAD_LOOKUP' };
  return { error: 'CONFIDENTIAL_PRIVATE_STORE_UNAVAILABLE' };
}

/**
 * Reveal creation accepts server-loaded private material only and requires a
 * valid signed auction close. A request body preimage is not an input.
 */
export function buildIntentReveal(input, privateKey) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { ok: false, code: 'BAD_REVEAL_REQUEST' };
  }
  if (Object.keys(input).some((key) => !['commitment', 'privateRecord', 'auctionClose', 'solverId'].includes(key))) {
    return { ok: false, code: Object.prototype.hasOwnProperty.call(input, 'preimage')
      ? 'CLIENT_PREIMAGE_FORBIDDEN'
      : 'BAD_REVEAL_REQUEST' };
  }
  const { commitment, privateRecord, auctionClose, solverId } = input;
  if (!privateRecordMatches(commitment, privateRecord)) return { ok: false, code: 'REVEAL_MISMATCH' };
  let solverPublicKey;
  try {
    solverPublicKey = publicKeyFromPrivateKey(privateKey);
  } catch {
    return { ok: false, code: 'BAD_SIGNING_KEY' };
  }
  if (!commitmentSignatureValid(commitment, solverPublicKey)) {
    return { ok: false, code: 'UNAUTHENTICATED_REQUESTER' };
  }
  const trustedCoordinator = coordinatorConfig();
  if (!trustedCoordinator
    || !verifyAuctionClose(auctionClose)
    || auctionClose.coordinator?.publicKey !== trustedCoordinator.publicKey
    || !same(auctionClose.intentHash, commitment.intentHash)
    || !same(auctionClose.intentHash, commitment.auctionId)
    || auctionClose.closedAt < commitment.committedAt) {
    return { ok: false, code: 'AUCTION_NOT_CLOSED' };
  }
  const revealedAt = Date.now();
  if (revealedAt > commitment.deadline * 1000 || auctionClose.closedAt > commitment.deadline * 1000) {
    return { ok: false, code: 'REVEAL_DEADLINE_EXPIRED' };
  }
  if (String(solverId || '') !== commitment.solverId) return { ok: false, code: 'REVEAL_SOLVER_MISMATCH' };

  const core = {
    schema: INTENT_REVEAL_SCHEMA,
    intentHash: commitment.intentHash,
    auctionId: commitment.auctionId,
    closeId: auctionClose.closeId,
    commitmentId: commitment.commitmentId,
    revealHash: commitment.revealHash,
    nonce: commitment.nonce,
    deadline: commitment.deadline,
    solverId: commitment.solverId,
    revealedAt,
    preimageHolder: 'fbt-secure-private-store',
    commitRevealMetadataPrivacy: false,
    preimage: canonicalValue(privateRecord.preimage),
    claims: {
      auctionClosedBeforeReveal: true,
      matchesCommittedHash: true,
      verifiedByVerifier: false,
      custody: false
    }
  };
  const revealId = revealIdFor(core);
  try {
    return {
      ok: true,
      reveal: {
        ...core,
        revealId,
        signature: signCanonicalPayload(REVEAL_DOMAIN, { ...core, revealId }, privateKey)
      }
    };
  } catch {
    return { ok: false, code: 'BAD_SIGNING_KEY' };
  }
}

export function verifyIntentReveal(reveal, commitment, {
  solverPublicKey,
  coordinatorPublicKey,
  auctionClose
} = {}) {
  if (!reveal || reveal.schema !== INTENT_REVEAL_SCHEMA || !safeHash(reveal.revealId)) {
    return { ok: false, code: 'BAD_REVEAL' };
  }
  if (!validCommitmentShape(commitment)) return { ok: false, code: 'BAD_COMMITMENT' };
  if (!solverPublicKey || !commitmentSignatureValid(commitment, solverPublicKey)) {
    return { ok: false, code: 'UNAUTHENTICATED_REQUESTER' };
  }
  if (!coordinatorPublicKey) return { ok: false, code: 'COORDINATOR_PUBLIC_KEY_REQUIRED' };
  if (!verifyAuctionClose(auctionClose)
    || auctionClose.coordinator?.publicKey !== coordinatorPublicKey
    || !same(auctionClose.closeId, reveal.closeId)
    || !same(auctionClose.intentHash, commitment.intentHash)
    || !same(auctionClose.intentHash, commitment.auctionId)
    || auctionClose.closedAt < commitment.committedAt) {
    return { ok: false, code: 'AUCTION_NOT_CLOSED' };
  }
  if (!same(reveal.intentHash, commitment.intentHash)
    || !same(reveal.auctionId, commitment.auctionId)
    || !same(reveal.commitmentId, commitment.commitmentId)
    || !same(reveal.revealHash, commitment.revealHash)
    || !same(reveal.nonce, commitment.nonce)
    || reveal.deadline !== commitment.deadline) {
    return { ok: false, code: 'REVEAL_COMMITMENT_MISMATCH' };
  }
  if (reveal.solverId !== commitment.solverId) return { ok: false, code: 'REVEAL_SOLVER_MISMATCH' };
  if (!Number.isSafeInteger(reveal.revealedAt)
    || reveal.revealedAt < auctionClose.closedAt
    || reveal.revealedAt > commitment.deadline * 1000
    || auctionClose.closedAt > commitment.deadline * 1000) {
    return { ok: false, code: 'REVEAL_OUTSIDE_CLOSED_WINDOW' };
  }
  const privateRecord = {
    ...privateCore({
      intentHash: reveal.intentHash,
      auctionId: reveal.auctionId,
      solverId: reveal.solverId,
      nonce: reveal.nonce,
      deadline: reveal.deadline,
      preimage: reveal.preimage
    }),
    commitmentId: reveal.commitmentId,
    revealHash: reveal.revealHash
  };
  if (!privateRecordMatches(commitment, privateRecord)) return { ok: false, code: 'REVEAL_COMPLIANCE_FAILED' };
  if (reveal.preimageHolder !== 'fbt-secure-private-store'
    || reveal.commitRevealMetadataPrivacy !== false
    || reveal.claims?.auctionClosedBeforeReveal !== true
    || reveal.claims?.matchesCommittedHash !== true
    || reveal.claims?.verifiedByVerifier !== false
    || reveal.claims?.custody !== false) {
    return { ok: false, code: 'REVEAL_HONESTY_FLAGS_MISMATCH' };
  }
  const { signature, revealId, ...core } = reveal;
  if (revealIdFor(core) !== revealId) return { ok: false, code: 'BAD_REVEAL_ID' };
  if (!solverPublicKey) return { ok: false, code: 'SOLVER_PUBLIC_KEY_REQUIRED' };
  return verifyCanonicalSignature(REVEAL_DOMAIN, { ...core, revealId }, signature, solverPublicKey)
    ? { ok: true, reveal }
    : { ok: false, code: 'SIGNATURE_MISMATCH' };
}

export async function storeReveal() {
  return { ok: false, code: 'CONFIDENTIAL_PRIVATE_STORE_UNAVAILABLE' };
}

export function intentCommitmentStatus() {
  return {
    schema: INTENT_COMMITMENT_SCHEMA,
    revealSchema: INTENT_REVEAL_SCHEMA,
    available: false,
    frontendIntegrated: false,
    durablePrivateStorage: false,
    requesterAuthentication: false,
    earlyRevealProtection: false,
    unavailableReason: 'CONFIDENTIAL_PREREQUISITES_UNAVAILABLE',
    preimageHolder: 'none-operational',
    commitRevealMetadataPrivacy: false,
    metadataPrivacy: false,
    hiddenFromFbt: false,
    thresholdOrTeeAttestation: false,
    encryptedTransport: false,
    tee: false,
    attestation: false,
    confidentialityLevel: 'unavailable',
    singleChainConfidentialSwaps: false
  };
}

export function commitmentCoordinator() {
  return coordinatorConfig();
}
