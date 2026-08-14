/**
 * Commit–reveal intent commitments (Phase 5a).
 * ---------------------------------------------------------------------------
 * The first honest step of the Confidential Intent transfer is a REAL
 * commit–reveal scheme, clearly distinguished from both "Private RPC" and
 * "threshold encryption":
 *
 *   - Before the bidding deadline a solver / requester publishes only a
 *     COMMITMENT (`fbt.intent-commitment.v1`) — the SHA-256 of the reveal
 *     preimage, with no token, amount or strategy in the open log.
 *   - The auction runs on these opaque commitments.
 *   - AFTER the close, a reveal (`fbt.intent-reveal.v1`) is published and any
 *     solver or watcher recomputes the commitment hash and verifies the
 *     reveal MATCHES the committed hash — compliance verification.
 *
 * Honesty boundary, pinned inside every record:
 *   - `preimageHolder: 'fbt-server'` — FBT holds the preimage; this is NOT a
 *     private-RPC or threshold scheme and never claims to hide the intent
 *     from FBT or from a colluding operator.
 *   - `commitRevealMetadataPrivacy: false` — timing and metadata may leak; we
 *     never call commit-reveal a fully confidential compute scheme.
 *   - Nothing here spends funds, escrows tokens or decrypts server-side
 *     without an operator threshold. `custody: false`.
 *
 * The envelope + Risk Engine let a SINGLE-CHAIN swap travelling through this
 * path declare `privacy: 'confidential'` and reach ready-for-client-review.
 * Threshold / TEE claims remain blocked.
 */

import { createHash, createPrivateKey, createPublicKey, randomBytes } from 'node:crypto';
import { blobConfigured } from './blobCache.js';
import {
  canonicalValue,
  signCanonicalPayload,
  verifyCanonicalSignature
} from './intentSignatures.js';
import { withIntentLock } from './intentLocks.js';
import { coordinatorConfig } from './intentAuctions.js';

export const INTENT_COMMITMENT_SCHEMA = 'fbt.intent-commitment.v1';
export const INTENT_REVEAL_SCHEMA = 'fbt.intent-reveal.v1';
export const COMMITMENT_DOMAIN = 'fbt.intent-commitment.v1/signature';
export const REVEAL_DOMAIN = 'fbt.intent-reveal.v1/signature';
const COMMITMENT_ID_DOMAIN = 'fbt.intent-commitment.v1/id';
const REVEAL_ID_DOMAIN = 'fbt.intent-reveal.v1/id';
const PREFIX = 'intent-commitment/v1/';
const TOKEN = process.env.BLOB_READ_WRITE_TOKEN || '';
const TX_RE_64 = /^0x[a-fA-F0-9]{64}$/;
const ID_RE = /^[a-z0-9][a-z0-9._-]{1,47}$/;
const memory = new Map();
const pendingPaths = new Set();
let blobApi = null;

const sha256 = (value) => createHash('sha256').update(value).digest();
const hex = (buffer) => `0x${Buffer.from(buffer).toString('hex')}`;
const sha256Hex = (value) => hex(sha256(value));
const safeIntent = (value) => TX_RE_64.test(String(value || '')) ? String(value).toLowerCase() : null;
const b64url = (value) => Buffer.from(value).toString('base64url');

function privateKeyObject(privateKey) {
  try {
    const key = createPrivateKey({ key: Buffer.from(privateKey, 'base64url'), format: 'der', type: 'pkcs8' });
    if (key.asymmetricKeyType !== 'ed25519') throw new Error('BAD_PRIVATE_KEY');
    return key;
  } catch {
    throw new Error('BAD_PRIVATE_KEY');
  }
}

/** The revealHash is the only thing placed in the public log before close. */
export function revealHashFor(preimage) {
  return sha256Hex(JSON.stringify(canonicalValue(preimage)));
}

function commitmentIdFor(core) {
  return sha256Hex(`${COMMITMENT_ID_DOMAIN}\n${JSON.stringify(canonicalValue(core))}`);
}

function revealIdFor(core) {
  return sha256Hex(`${REVEAL_ID_DOMAIN}\n${JSON.stringify(canonicalValue(core))}`);
}

/**
 * Build a signed `fbt.intent-commitment.v1` from a reveal preimage. The
 * preimage is stored server-side (honestly: `preimageHolder: 'fbt-server'`);
 * only the hash is signed into the public commitment.
 */
export function buildIntentCommitment({
  intentHash,
  preimage,
  solverId,
  nonce = `0x${randomBytes(16).toString('hex')}`,
  deadline = Math.floor(Date.now() / 1000) + 300,
  issuedAt = Math.floor(Date.now() / 1000)
}, privateKey) {
  if (!safeIntent(intentHash) || !ID_RE.test(String(solverId || ''))) {
    return { ok: false, code: 'BAD_COMMITMENT' };
  }
  const revealHash = revealHashFor(preimage);
  const core = {
    schema: INTENT_COMMITMENT_SCHEMA,
    intentHash: String(intentHash).toLowerCase(),
    revealHash,
    solverId: String(solverId),
    committedAt: Date.now(),
    issuedAt,
    deadline,
    nonce,
    preimageHolder: 'fbt-server',
    commitRevealMetadataPrivacy: false,
    claims: {
      fullPrivacyFromAllParties: false,
      hiddenFromFbt: false,
      thresholdOrTeeAttestation: false,
      custody: false
    }
  };
  const commitmentId = commitmentIdFor(core);
  return {
    ok: true,
    commitment: {
      ...core,
      commitmentId,
      signature: signCanonicalPayload(COMMITMENT_DOMAIN, { ...core, commitmentId }, privateKey)
    },
    preimage
  };
}

/** Sign a reveal over the preimage for post-close compliance verification. */
export function buildIntentReveal({ commitment, preimage, solverId }, privateKey) {
  const expectedHash = commitment?.revealHash;
  if (!expectedHash || revealHashFor(preimage) !== expectedHash) {
    return { ok: false, code: 'REVEAL_MISMATCH' };
  }
  const core = {
    schema: INTENT_REVEAL_SCHEMA,
    intentHash: commitment.intentHash,
    commitmentId: commitment.commitmentId,
    revealHash: expectedHash,
    solverId,
    revealedAt: Date.now(),
    preimageHolder: 'fbt-server',
    commitRevealMetadataPrivacy: false,
    preimage,
    claims: {
      matchesCommittedHash: true,
      verifiedByVerifier: false,
      custody: false
    }
  };
  const revealId = revealIdFor(core);
  return {
    ok: true,
    reveal: {
      ...core,
      revealId,
      signature: signCanonicalPayload(REVEAL_DOMAIN, { ...core, revealId }, privateKey)
    }
  };
}

/** Full compliance verification of a reveal against a commitment. */
export function verifyIntentReveal(reveal, commitment, { solverPublicKey } = {}) {
  if (!reveal || reveal.schema !== INTENT_REVEAL_SCHEMA || !TX_RE_64.test(String(reveal.revealId || ''))) {
    return { ok: false, code: 'BAD_REVEAL' };
  }
  if (!commitment || commitment.schema !== INTENT_COMMITMENT_SCHEMA) {
    return { ok: false, code: 'BAD_COMMITMENT' };
  }
  if (String(reveal.intentHash).toLowerCase() !== String(commitment.intentHash).toLowerCase()
    || String(reveal.commitmentId).toLowerCase() !== String(commitment.commitmentId).toLowerCase()) {
    return { ok: false, code: 'REVEAL_COMMITMENT_MISMATCH' };
  }
  if (String(reveal.solverId) !== String(commitment.solverId)) return { ok: false, code: 'REVEAL_SOLVER_MISMATCH' };
  if (String(reveal.revealHash).toLowerCase() !== String(commitment.revealHash).toLowerCase()) {
    return { ok: false, code: 'REVEAL_MISMATCH' };
  }
  if (revealHashFor(reveal.preimage) !== String(commitment.revealHash).toLowerCase()) {
    return { ok: false, code: 'REVEAL_COMPLIANCE_FAILED' };
  }
  if (reveal.preimageHolder !== 'fbt-server' || reveal.commitRevealMetadataPrivacy !== false) {
    return { ok: false, code: 'REVEAL_HONESTY_FLAGS_MISMATCH' };
  }
  const claims = reveal.claims;
  if (!claims || claims.matchesCommittedHash !== true || claims.verifiedByVerifier !== false
    || claims.custody !== false) return { ok: false, code: 'REVEAL_CLAIMS_MISMATCH' };
  const { signature, revealId, ...core } = reveal;
  if (revealIdFor(core) !== revealId) return { ok: false, code: 'BAD_REVEAL_ID' };
  if (!solverPublicKey) return { ok: false, code: 'SOLVER_PUBLIC_KEY_REQUIRED' };
  return verifyCanonicalSignature(REVEAL_DOMAIN, { ...core, revealId }, signature, solverPublicKey)
    ? { ok: true, reveal }
    : { ok: false, code: 'SIGNATURE_MISMATCH' };
}

/* ---------------------------- immutable storage --------------------------- */

async function blob() {
  if (!blobConfigured()) return null;
  if (!blobApi) {
    try { blobApi = await import('@vercel/blob'); } catch { return null; }
  }
  return blobApi;
}

async function readObject(path) {
  if (memory.has(path)) return memory.get(path);
  const mod = await blob();
  if (!blobConfigured()) return null;
  if (!mod) throw new Error('COMMITMENT_STORE_UNAVAILABLE');
  try {
    const listed = await mod.list({ prefix: path, limit: 10, token: TOKEN });
    const item = (listed?.blobs || []).find((row) => row.pathname === path);
    if (!item) return null;
    const res = await fetch(item.url, { cache: 'no-store' });
    if (!res.ok) throw new Error('COMMITMENT_OBJECT_UNREADABLE');
    const value = await res.json();
    memory.set(path, value);
    return value;
  } catch {
    throw new Error('COMMITMENT_STORE_UNAVAILABLE');
  }
}

async function writeObject(path, value) {
  if (memory.has(path) || pendingPaths.has(path)) return { ok: false, duplicate: true };
  pendingPaths.add(path);
  try {
    const mod = await blob();
    if (blobConfigured() && !mod) return { ok: false, code: 'COMMITMENT_STORE_UNAVAILABLE' };
    if (mod) {
      try {
        await mod.put(path, JSON.stringify(value), {
          token: TOKEN, access: 'public', contentType: 'application/json',
          addRandomSuffix: false, allowOverwrite: false, cacheControlMaxAge: 31536000
        });
      } catch {
        try { if (await readObject(path)) return { ok: false, duplicate: true }; } catch { /* keep failure */ }
        return { ok: false, code: 'COMMITMENT_WRITE_FAILED' };
      }
    }
    memory.set(path, value);
    return { ok: true };
  } finally {
    pendingPaths.delete(path);
  }
}

async function listObjects(prefix) {
  const local = [...memory.entries()].filter(([key]) => key.startsWith(prefix)).map(([, row]) => row);
  const mod = await blob();
  if (!blobConfigured()) return local;
  if (!mod) throw new Error('COMMITMENT_STORE_UNAVAILABLE');
  const blobs = [];
  let cursor;
  do {
    const page = await mod.list({ prefix, limit: 1000, cursor, token: TOKEN });
    blobs.push(...(page?.blobs || []));
    if (page?.hasMore && !page.cursor) throw new Error('COMMITMENT_CURSOR_MISSING');
    cursor = page?.hasMore ? page.cursor : undefined;
  } while (cursor);
  const remote = await Promise.all(blobs.map(async (item) => {
    const res = await fetch(item.url, { cache: 'no-store' });
    if (!res.ok) throw new Error('COMMITMENT_OBJECT_UNREADABLE');
    const row = await res.json();
    if (row?.schema !== 'fbt.commitment-log-entry.v1') throw new Error('INVALID_STORED_COMMITMENT');
    return row;
  }));
  const byPath = new Map([...remote, ...local].map((row) => [row.path, row]));
  return [...byPath.values()];
}

/** Store the preimage privately and the commitment (hash only) publicly. */
export async function storeIntentCommitment({ commitment, preimage }) {
  const intent = safeIntent(commitment?.intentHash);
  if (!intent || !TX_RE_64.test(String(commitment?.commitmentId || ''))
    || !ID_RE.test(String(commitment?.solverId || ''))) return { ok: false, code: 'BAD_COMMITMENT' };
  const path = `${PREFIX}log/${intent.slice(2)}/${commitment.commitmentId.slice(2)}.json`;
  const record = {
    schema: 'fbt.commitment-log-entry.v1',
    path,
    storedAt: Date.now(),
    commitment,
    preimage: canonicalValue(preimage)
  };
  return withIntentLock(intent, async () => {
    const stored = await writeObject(path, record);
    if (!stored.ok) return { ok: false, code: stored.duplicate ? 'COMMITMENT_REPLAY' : stored.code };
    return { ok: true, commitmentId: commitment.commitmentId, stored: record };
  });
}

export async function readCommitments(intentHash) {
  const intent = safeIntent(intentHash);
  if (!intent) return { error: 'BAD_INTENT_HASH' };
  try {
    const rows = await listObjects(`${PREFIX}log/${intent.slice(2)}/`);
    return {
      schema: 'fbt.commitment-log.v1',
      intentHash: intent,
      size: rows.length,
      durable: blobConfigured(),
      commitments: rows.map((row) => row.commitment)
    };
  } catch {
    return { error: 'COMMITMENT_STORE_UNAVAILABLE' };
  }
}

export async function readCommitment(intentHash, commitmentId) {
  const intent = safeIntent(intentHash);
  const id = TX_RE_64.test(String(commitmentId || '')) ? String(commitmentId).toLowerCase() : null;
  if (!intent || !id) return { error: 'BAD_LOOKUP' };
  try {
    const rows = await listObjects(`${PREFIX}log/${intent.slice(2)}/`);
    const row = rows.find((r) => String(r.commitment?.commitmentId).toLowerCase() === id);
    return row ? { commitment: row.commitment, preimage: row.preimage } : { error: 'COMMITMENT_NOT_FOUND' };
  } catch {
    return { error: 'COMMITMENT_STORE_UNAVAILABLE' };
  }
}

export async function storeReveal({ intentHash, commitmentId, reveal }) {
  const intent = safeIntent(intentHash);
  if (!intent || !TX_RE_64.test(String(commitmentId || '')) || !reveal) return { ok: false, code: 'BAD_REVEAL' };
  const path = `${PREFIX}reveals/${intent.slice(2)}/${String(commitmentId).slice(2)}.json`;
  const record = { schema: 'fbt.reveal-record.v1', path, storedAt: Date.now(), reveal };
  const stored = await writeObject(path, record);
  if (!stored.ok) return { ok: false, code: stored.duplicate ? 'REVEAL_REPLAY' : stored.code };
  return { ok: true, revealId: reveal.revealId };
}

export function intentCommitmentStatus({ operatorRegistrySize = 0 } = {}) {
  return {
    schema: INTENT_COMMITMENT_SCHEMA,
    revealSchema: INTENT_REVEAL_SCHEMA,
    preimageHolder: 'fbt-server',
    commitRevealMetadataPrivacy: false,
    hiddenFromFbt: false,
    thresholdOrTeeAttestation: false,
    encryptedTransport: false,
    tee: false,
    confidentialityLevel: 'commit-reveal',
    singleChainConfidentialSwaps: true
  };
}

/** Coordinator signature helper reused by routes. */
export function commitmentCoordinator() {
  return coordinatorConfig();
}
