/**
 * Immutable transparency log for signed solver commitments.
 * ---------------------------------------------------------------------------
 * Each accepted quote is stored under:
 *
 *   intent-log/v1/<intentHash>/<solverId>/<nonce>.json
 *
 * The path is immutable (`allowOverwrite:false` on Vercel Blob). Keying by
 * solver + nonce gives replay protection without a read-modify-write list and
 * makes concurrent serverless writes safe: two requests cannot silently
 * replace one another. This is intentionally separate from server/store.js,
 * whose last-writer-wins semantics are fine for a classifieds board but not
 * for financial evidence.
 *
 * The log root is a deterministic Merkle tree over sorted signed-commitment
 * hashes. It is reproducible by any verifier. It is not yet an external anchor;
 * publishing the root on-chain or in an independent append-only service is the
 * next authenticity step.
 */

import { createHash } from 'node:crypto';
import { blobConfigured } from './blobCache.js';
import {
  parseSolverRegistry,
  solverSigningPayload,
  verifySolverCommitment
} from './intentSignatures.js';

const TOKEN = process.env.BLOB_READ_WRITE_TOKEN || '';
const PREFIX = 'intent-log/v1/';
/* Admission/DoS guard, not an auction-finality guarantee: independent
   serverless instances can race near this boundary. */
const QUOTE_CAPACITY_GUARD = 64;
const memory = new Map();
const pendingPaths = new Set();
let blobApi = null;

const sha256 = (value) => createHash('sha256').update(value).digest();
const hex = (buffer) => `0x${Buffer.from(buffer).toString('hex')}`;
const parentHash = (left, right) => sha256(Buffer.concat([Buffer.from([1]), left, right]));

export function signedCommitmentHash(commitment) {
  /* Signature is included in the leaf: two valid signatures over the same
     payload remain two distinct signed statements. */
  const canonicalSigned = JSON.stringify({
    payload: JSON.parse(solverSigningPayload(commitment)),
    signature: commitment.signature
  });
  return hex(sha256(Buffer.concat([Buffer.from([0]), Buffer.from(canonicalSigned, 'utf8')])));
}

export function merkleRoot(hashes = []) {
  let level = [...new Set(hashes.map((h) => String(h).toLowerCase()))]
    .filter((h) => /^0x[a-f0-9]{64}$/.test(h))
    .sort()
    .map((h) => Buffer.from(h.slice(2), 'hex'));
  if (!level.length) return null;
  while (level.length > 1) {
    const next = [];
    for (let i = 0; i < level.length; i += 2) {
      const left = level[i];
      const right = level[i + 1] || left;
      next.push(parentHash(left, right));
    }
    level = next;
  }
  return hex(level[0]);
}

export function merkleProof(hashes, targetHash) {
  let level = [...new Set((hashes || []).map((h) => String(h).toLowerCase()))]
    .filter((h) => /^0x[a-f0-9]{64}$/.test(h))
    .sort();
  let index = level.indexOf(String(targetHash).toLowerCase());
  if (index < 0) return null;
  const proof = [];

  while (level.length > 1) {
    const siblingIndex = index % 2 === 0 ? Math.min(index + 1, level.length - 1) : index - 1;
    proof.push({
      position: index % 2 === 0 ? 'right' : 'left',
      hash: level[siblingIndex]
    });
    const next = [];
    for (let i = 0; i < level.length; i += 2) {
      const left = Buffer.from(level[i].slice(2), 'hex');
      const right = Buffer.from((level[i + 1] || level[i]).slice(2), 'hex');
      next.push(hex(parentHash(left, right)));
    }
    index = Math.floor(index / 2);
    level = next;
  }
  return proof;
}

export function verifyMerkleProof(leafHash, proof, root) {
  if (!/^0x[a-fA-F0-9]{64}$/.test(String(leafHash)) || !/^0x[a-fA-F0-9]{64}$/.test(String(root))) {
    return false;
  }
  let current = Buffer.from(leafHash.slice(2), 'hex');
  for (const row of proof || []) {
    if (!/^0x[a-fA-F0-9]{64}$/.test(String(row?.hash))) return false;
    const sibling = Buffer.from(row.hash.slice(2), 'hex');
    current = row.position === 'left'
      ? parentHash(sibling, current)
      : row.position === 'right'
        ? parentHash(current, sibling)
        : null;
    if (!current) return false;
  }
  return hex(current).toLowerCase() === String(root).toLowerCase();
}

const safeIntent = (value) => /^0x[a-fA-F0-9]{64}$/.test(String(value || ''))
  ? String(value).toLowerCase() : null;

function pathFor(commitment) {
  const intent = safeIntent(commitment.intentHash);
  const nonce = String(commitment.nonce).toLowerCase().replace(/^0x/, '');
  return `${PREFIX}${intent.slice(2)}/${commitment.solverId}/${nonce}.json`;
}

async function blob() {
  if (!blobConfigured()) return null;
  if (!blobApi) {
    try { blobApi = await import('@vercel/blob'); } catch { return null; }
  }
  return blobApi;
}

async function blobRows(intentHash) {
  const mod = await blob();
  if (!mod) throw new Error('LOG_READ_FAILED');
  try {
    const prefix = `${PREFIX}${intentHash.slice(2)}/`;
    const blobs = [];
    let cursor;
    do {
      const page = await mod.list({ prefix, limit: 1000, cursor, token: TOKEN });
      blobs.push(...(page?.blobs || []));
      if (blobs.length > 10_000) throw new Error('LOG_TOO_LARGE');
      if (page?.hasMore && !page.cursor) throw new Error('LOG_CURSOR_MISSING');
      cursor = page?.hasMore ? page.cursor : undefined;
    } while (cursor);

    return await Promise.all(blobs.map(async (item) => {
      const res = await fetch(item.url, { cache: 'no-store' });
      if (!res.ok) throw new Error('LOG_ENTRY_READ_FAILED');
      const row = await res.json();
      if (row?.schema !== 'fbt.transparency-entry.v1'
        || safeIntent(row.commitment?.intentHash) !== intentHash
        || row.path !== pathFor(row.commitment)
        || row.entryHash !== signedCommitmentHash(row.commitment)) {
        throw new Error('LOG_ENTRY_INVALID');
      }
      return row;
    }));
  } catch {
    /* Never turn a storage outage or one unreadable object into an apparently
       valid empty/partial bid set. Callers return 503 instead. */
    throw new Error('LOG_READ_FAILED');
  }
}

async function readRows(intentHash) {
  const intent = safeIntent(intentHash);
  if (!intent) return [];
  const local = [...memory.entries()]
    .filter(([key]) => key.startsWith(`${PREFIX}${intent.slice(2)}/`))
    .map(([, row]) => row);
  if (!blobConfigured()) return local;
  const remote = await blobRows(intent);
  const byHash = new Map([...remote, ...local].map((row) => [row.entryHash, row]));
  return [...byHash.values()];
}

async function writeImmutable(path, row) {
  if (memory.has(path) || pendingPaths.has(path)) return { ok: false, duplicate: true };
  pendingPaths.add(path);
  try {
    const mod = await blob();
    if (mod) {
      try {
        await mod.put(path, JSON.stringify(row), {
          token: TOKEN,
          access: 'public',
          contentType: 'application/json',
          addRandomSuffix: false,
          allowOverwrite: false,
          cacheControlMaxAge: 31536000
        });
      } catch {
        /* A concurrent writer may have won this exact solver+nonce path. Re-read
           before deciding whether this is a duplicate or a storage outage. */
        try {
          const existing = (await blobRows(row.commitment.intentHash))
            .find((item) => item.path === path || (
              item.commitment?.solverId === row.commitment.solverId
              && item.commitment?.nonce?.toLowerCase() === row.commitment.nonce.toLowerCase()
            ));
          if (existing) return { ok: false, duplicate: true };
        } catch {
          /* Storage availability is unknown; do not accept into memory or
             misclassify this as a replay. */
        }
        return { ok: false, code: 'LOG_WRITE_FAILED' };
      }
    }

    memory.set(path, row);
    return { ok: true };
  } finally {
    pendingPaths.delete(path);
  }
}

function publicLog(intentHash, rows) {
  const sorted = [...rows].sort((a, b) => a.entryHash.localeCompare(b.entryHash));
  const hashes = sorted.map((row) => row.entryHash);
  const root = merkleRoot(hashes);
  return {
    schema: 'fbt.transparency-log.v1',
    intentHash,
    root,
    size: sorted.length,
    durable: blobConfigured(),
    externallyAnchored: false,
    entries: sorted.map((row) => ({
      ...row,
      inclusionProof: merkleProof(hashes, row.entryHash)
    }))
  };
}

export async function readIntentLog(intentHash) {
  const intent = safeIntent(intentHash);
  if (!intent) return { error: 'BAD_INTENT_HASH' };
  try {
    return publicLog(intent, await readRows(intent));
  } catch {
    return { error: 'LOG_READ_FAILED' };
  }
}

export async function appendSignedCommitment(commitment, {
  registry = parseSolverRegistry(),
  now = Date.now()
} = {}) {
  const verified = verifySolverCommitment(commitment, { registry, now });
  if (!verified.ok) return verified;

  let current;
  try {
    current = await readRows(commitment.intentHash);
  } catch {
    return { ok: false, code: 'LOG_READ_FAILED' };
  }
  if (current.length >= QUOTE_CAPACITY_GUARD) return { ok: false, code: 'INTENT_LOG_FULL' };

  const path = pathFor(commitment);
  const entryHash = signedCommitmentHash(commitment);
  const row = {
    schema: 'fbt.transparency-entry.v1',
    path,
    entryHash,
    acceptedAt: now,
    solver: verified.solver,
    commitment
  };
  const stored = await writeImmutable(path, row);
  if (!stored.ok) return { ok: false, code: stored.duplicate ? 'NONCE_REPLAY' : stored.code };

  const log = publicLog(commitment.intentHash.toLowerCase(), [...current, row]);
  const entry = log.entries.find((item) => item.entryHash === entryHash);
  return {
    ok: true,
    accepted: true,
    entryHash,
    /* Phase 2c: the admission route needs the stored admission time and
       solver identity to mint the transactional admission receipt that
       corresponds 1:1 to this immutable row. */
    acceptedAt: now,
    solverId: verified.solver.id,
    root: log.root,
    size: log.size,
    durable: log.durable,
    externallyAnchored: false,
    inclusionProof: entry?.inclusionProof || []
  };
}

/**
 * Look up one immutable log row by intent + entry hash. Powers the
 * deterministic admission-receipt reclaim endpoint: the receipt is a pure
 * function of the stored row, so reading the row is equivalent to reading
 * the receipt (same coordinator key permitting).
 */
export async function readLogEntry(intentHash, entryHash) {
  const intent = safeIntent(intentHash);
  const entry = /^0x[a-fA-F0-9]{64}$/.test(String(entryHash || ''))
    ? String(entryHash).toLowerCase() : null;
  if (!intent || !entry) return { error: 'BAD_LOOKUP' };
  try {
    const rows = await readRows(intent);
    const row = rows.find((item) => item.entryHash.toLowerCase() === entry);
    return row ? { entry: row } : { error: 'ADMISSION_NOT_FOUND' };
  } catch {
    return { error: 'LOG_READ_FAILED' };
  }
}

export function transparencyStatus(registry = parseSolverRegistry()) {
  const solvers = [...registry.values()].filter((row) => row.active);
  const durable = blobConfigured();
  return {
    acceptingCommitments: solvers.length > 0,
    registeredSolvers: solvers.length,
    signingAlgorithm: 'Ed25519',
    persistenceMode: durable ? 'vercel-blob-immutable' : 'process-memory-ephemeral',
    replayProtection: durable ? 'durable-solver-intent-nonce' : 'process-local-only',
    durable,
    immutableEntries: true,
    merkleRoots: true,
    externallyAnchored: false
  };
}
