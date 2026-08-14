/**
 * Verifier-signed disputes over execution outcomes (Phase 3a).
 * ---------------------------------------------------------------------------
 * Disputes are the independent half of the failure-evidence pair: solvers
 * claim outcomes (server/intentExecution.js), registered verifiers challenge
 * them. A dispute is a signed observation, not a verdict — the deterministic
 * grading engine (gradeExecution) treats dispute kinds as contradiction
 * evidence, and the coordinator's adjudication (server/intentAdjudication.js)
 * resolves the grade.
 *
 * Verifier identity comes from `INTENT_VERIFIER_KEYS`, the same public-key-
 * registry shape as solvers and watchers. No private keys anywhere near the
 * registry; verifier keys sign disputes only and grant no fund authority.
 *
 * Dispute kinds (bounded vocabulary — a dispute asserts one of these):
 *   no-execution    — the selected quote was never executed (no claim, no tx)
 *   short-fill      — the received amount was below the quoted minimum
 *   false-claim     — the stored execution claim does not match reality
 *   late-execution  — execution happened after the signed quote window
 *
 * A dispute never moves funds and never decides a penalty by itself.
 */

import { createHash } from 'node:crypto';
import { blobConfigured } from './blobCache.js';
import {
  canonicalValue,
  parseSolverRegistry,
  publicKeyFromPrivateKey,
  signCanonicalPayload,
  verifyCanonicalSignature
} from './intentSignatures.js';

export const DISPUTE_SCHEMA = 'fbt.dispute.v1';
export const DISPUTE_DOMAIN = 'fbt.dispute.v1/signature';
export const DISPUTE_RECORD_SCHEMA = 'fbt.dispute-record.v1';
const DISPUTE_ID_DOMAIN = 'fbt.dispute.v1/id';
const TX_RE_64 = /^0x[a-fA-F0-9]{64}$/;
const ID_RE = /^[a-z0-9][a-z0-9._-]{1,47}$/;
const KINDS = new Set(['no-execution', 'short-fill', 'false-claim', 'late-execution']);
const DISPUTE_FIELDS = new Set([
  'schema', 'intentHash', 'closeId', 'entryHash', 'verifierId', 'kind',
  'observedAt', 'detail', 'verifier', 'disputeId', 'signature', 'claims'
]);
const MAX_CLOCK_SKEW_SECONDS = 30;
const MAX_DISPUTES_PER_CLOSE = 64;
const TOKEN = process.env.BLOB_READ_WRITE_TOKEN || '';
const PREFIX = 'intent-auction/v1/';
const memory = new Map();
const pendingPaths = new Set();
let blobApi = null;

const sha256Hex = (value) => `0x${createHash('sha256').update(value).digest('hex')}`;

const safeDetail = (value) => {
  const cleaned = String(value ?? '').replace(/[<>"'`\\]/g, '').trim();
  return cleaned ? cleaned.slice(0, 240) : null;
};

/** Verifiers authenticate with the same registry JSON shape as solvers. */
export function parseVerifierRegistry(raw = process.env.INTENT_VERIFIER_KEYS || '') {
  return parseSolverRegistry(raw);
}

export function verifierConfigFromPrivateKey(privateKey = process.env.INTENT_VERIFIER_PRIVATE_KEY || '') {
  if (!privateKey) return null;
  const id = String(process.env.INTENT_VERIFIER_ID || 'independent-verifier').toLowerCase();
  if (!ID_RE.test(id)) return null;
  try {
    return {
      id,
      name: String(process.env.INTENT_VERIFIER_NAME || id).replace(/[<>"'`\\]/g, '').slice(0, 80),
      privateKey,
      publicKey: publicKeyFromPrivateKey(privateKey)
    };
  } catch {
    return null;
  }
}

function disputeIdFor(core) {
  return sha256Hex(`${DISPUTE_ID_DOMAIN}\n${JSON.stringify(canonicalValue(core))}`);
}

/**
 * Build a signed dispute. `verifier` is the public identity row; the dispute
 * pins its own verifier key so third parties can verify it registry-free.
 */
export function buildDispute({
  close,
  kind,
  observedAt = Math.floor(Date.now() / 1000),
  detail = null
}, verifier, privateKey) {
  const core = {
    schema: DISPUTE_SCHEMA,
    intentHash: close.intentHash,
    closeId: close.closeId,
    entryHash: close.decision.selectedEntryHash,
    verifierId: verifier.id,
    kind,
    observedAt,
    detail: safeDetail(detail),
    verifier: {
      id: verifier.id,
      name: String(verifier.name || verifier.id).replace(/[<>"'`\\]/g, '').slice(0, 80),
      publicKey: verifier.publicKey,
      algorithm: 'Ed25519'
    },
    claims: {
      signedObservationOnly: true,
      fundsAccess: false
    }
  };
  const structural = validateDispute(core);
  if (!structural.ok) return structural;
  const disputeId = disputeIdFor(core);
  return {
    ok: true,
    dispute: {
      ...core,
      disputeId,
      signature: signCanonicalPayload(DISPUTE_DOMAIN, { ...core, disputeId }, privateKey)
    }
  };
}

/** Strict structural validation before any signature or storage work. */
export function validateDispute(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return { ok: false, code: 'BAD_DISPUTE_BODY' };
  if (Object.keys(input).some((key) => !DISPUTE_FIELDS.has(key))) return { ok: false, code: 'UNKNOWN_DISPUTE_FIELD' };
  if (input.schema !== DISPUTE_SCHEMA) return { ok: false, code: 'BAD_DISPUTE_SCHEMA' };
  if (!TX_RE_64.test(String(input.intentHash || ''))
    || !TX_RE_64.test(String(input.closeId || ''))
    || !TX_RE_64.test(String(input.entryHash || ''))) return { ok: false, code: 'BAD_DISPUTE_BINDING' };
  if (!ID_RE.test(String(input.verifierId || ''))) return { ok: false, code: 'BAD_VERIFIER' };
  if (!KINDS.has(input.kind)) return { ok: false, code: 'BAD_DISPUTE_KIND' };
  if (!Number.isSafeInteger(input.observedAt)) return { ok: false, code: 'BAD_OBSERVED_AT' };
  if (input.detail != null && typeof input.detail !== 'string') return { ok: false, code: 'BAD_DISPUTE_DETAIL' };
  const verifier = input.verifier;
  if (!verifier || !ID_RE.test(String(verifier.id || '')) || verifier.algorithm !== 'Ed25519'
    || typeof verifier.publicKey !== 'string') {
    return { ok: false, code: 'BAD_VERIFIER_IDENTITY' };
  }
  const claims = input.claims;
  if (!claims || claims.signedObservationOnly !== true || claims.fundsAccess !== false) {
    return { ok: false, code: 'BAD_DISPUTE_FLAGS' };
  }
  return { ok: true };
}

/**
 * Full verification against a sealed close. The dispute must target the
 * close's selected entry. With a registry and `requireRegistered`, the
 * verifier key must match the active registry row (key hijack under a known
 * id fails); without one, the pinned key still verifies offline.
 */
export function verifyDispute(input, {
  close,
  registry = null,
  requireRegistered = false,
  now = Date.now()
} = {}) {
  const structural = validateDispute(input);
  if (!structural.ok) return structural;
  if (!close || close.decision?.selectedEntryHash == null) return { ok: false, code: 'BAD_CLOSE_BINDING' };
  if (String(input.intentHash).toLowerCase() !== String(close.intentHash).toLowerCase()
    || String(input.closeId).toLowerCase() !== String(close.closeId).toLowerCase()) {
    return { ok: false, code: 'BAD_CLOSE_BINDING' };
  }
  if (String(input.entryHash).toLowerCase() !== String(close.decision.selectedEntryHash).toLowerCase()) {
    return { ok: false, code: 'BAD_SELECTION_BINDING' };
  }
  const nowSeconds = Math.floor(now / 1000);
  const sealedSeconds = Math.floor(Number(close.sealedAt) / 1000);
  if (input.observedAt > nowSeconds + MAX_CLOCK_SKEW_SECONDS
    || input.observedAt < sealedSeconds - 3600) {
    return { ok: false, code: 'BAD_OBSERVED_AT' };
  }

  if (registry) {
    const row = registry.get(input.verifierId);
    if (!row || !row.active || row.publicKey !== input.verifier.publicKey) {
      return { ok: false, code: requireRegistered ? 'UNREGISTERED_VERIFIER' : 'VERIFIER_NOT_IN_REGISTRY' };
    }
  } else if (requireRegistered) {
    return { ok: false, code: 'VERIFIER_REGISTRY_REQUIRED' };
  }

  const { signature, disputeId, ...core } = input;
  if (!TX_RE_64.test(String(disputeId || '')) || disputeIdFor(core) !== disputeId) {
    return { ok: false, code: 'BAD_DISPUTE_ID' };
  }
  if (!verifyCanonicalSignature(DISPUTE_DOMAIN, { ...core, disputeId }, signature, input.verifier.publicKey)) {
    return { ok: false, code: 'SIGNATURE_MISMATCH' };
  }
  return { ok: true, dispute: input };
}

/* ---------------------------- immutable storage -------------------------- */

async function blob() {
  if (!blobConfigured()) return null;
  if (!blobApi) {
    try { blobApi = await import('@vercel/blob'); } catch { return null; }
  }
  return blobApi;
}

const disputeDir = (closeId) => `${PREFIX}disputes/${String(closeId).slice(2)}/`;
const disputePath = (closeId, verifierId) => `${disputeDir(closeId)}${verifierId}.json`;

async function readObject(path) {
  if (memory.has(path)) return memory.get(path);
  const mod = await blob();
  if (!blobConfigured()) return null;
  if (!mod) throw new Error('DISPUTE_STORE_UNAVAILABLE');
  try {
    const listed = await mod.list({ prefix: path, limit: 10, token: TOKEN });
    const item = (listed?.blobs || []).find((row) => row.pathname === path);
    if (!item) return null;
    const response = await fetch(item.url, { cache: 'no-store' });
    if (!response.ok) throw new Error('DISPUTE_OBJECT_UNREADABLE');
    const value = await response.json();
    memory.set(path, value);
    return value;
  } catch {
    throw new Error('DISPUTE_STORE_UNAVAILABLE');
  }
}

async function writeImmutable(path, record) {
  if (memory.has(path) || pendingPaths.has(path)) {
    const existing = await readObject(path);
    return existing
      ? { ok: false, duplicate: true, existing }
      : { ok: false, code: 'DISPUTE_STORE_UNAVAILABLE' };
  }
  pendingPaths.add(path);
  try {
    const mod = await blob();
    if (blobConfigured() && !mod) return { ok: false, code: 'DISPUTE_STORE_UNAVAILABLE' };
    if (mod) {
      try {
        await mod.put(path, JSON.stringify(record), {
          token: TOKEN,
          access: 'public',
          contentType: 'application/json',
          addRandomSuffix: false,
          allowOverwrite: false,
          cacheControlMaxAge: 31536000
        });
      } catch {
        try {
          const existing = await readObject(path);
          if (existing) return { ok: false, duplicate: true, existing };
        } catch {
          // Preserve the write failure; never fall back to memory here.
        }
        return { ok: false, code: 'DISPUTE_WRITE_FAILED' };
      }
    }
    memory.set(path, record);
    return { ok: true };
  } finally {
    pendingPaths.delete(path);
  }
}

/**
 * Store a verified dispute: one immutable slot per close per verifier.
 * Identical bytes replay idempotently; different bytes conflict.
 */
export async function storeDispute(closeId, dispute) {
  if (!TX_RE_64.test(String(closeId || '')) || !dispute || !ID_RE.test(String(dispute.verifierId || ''))) {
    return { ok: false, code: 'BAD_DISPUTE_BODY' };
  }
  const path = disputePath(closeId, dispute.verifierId);
  const record = { schema: DISPUTE_RECORD_SCHEMA, path, storedAt: Date.now(), dispute };
  const stored = await writeImmutable(path, record);
  if (stored.ok) return { ok: true, alreadyStored: false, record };
  if (!stored.duplicate) return { ok: false, code: stored.code };
  return JSON.stringify(stored.existing.dispute) === JSON.stringify(dispute)
    ? { ok: true, alreadyStored: true, record: stored.existing }
    : { ok: false, code: 'DISPUTE_CONFLICT' };
}

export async function listDisputes(closeId) {
  if (!TX_RE_64.test(String(closeId || ''))) return { ok: false, code: 'BAD_LOOKUP' };
  try {
    const records = [...memory.entries()]
      .filter(([key]) => key.startsWith(disputeDir(closeId)))
      .map(([, record]) => record);
    const mod = await blob();
    if (!blobConfigured()) return { ok: true, records };
    if (!mod) throw new Error('DISPUTE_STORE_UNAVAILABLE');
    const blobs = [];
    let cursor;
    do {
      const page = await mod.list({ prefix: disputeDir(closeId), limit: 1000, cursor, token: TOKEN });
      blobs.push(...(page?.blobs || []));
      if (blobs.length > MAX_DISPUTES_PER_CLOSE * 2) throw new Error('DISPUTE_STORE_TOO_LARGE');
      if (page?.hasMore && !page.cursor) throw new Error('DISPUTE_STORE_CURSOR_MISSING');
      cursor = page?.hasMore ? page.cursor : undefined;
    } while (cursor);
    const remote = await Promise.all(blobs.map(async (item) => {
      const response = await fetch(item.url, { cache: 'no-store' });
      if (!response.ok) throw new Error('DISPUTE_OBJECT_UNREADABLE');
      const record = await response.json();
      if (record?.schema !== DISPUTE_RECORD_SCHEMA || record.path !== item.pathname) {
        throw new Error('INVALID_STORED_DISPUTE');
      }
      return record;
    }));
    const byPath = new Map([...remote, ...records].map((record) => [record.path, record]));
    return { ok: true, records: [...byPath.values()].sort(
      (a, b) => String(a.dispute?.disputeId).localeCompare(String(b.dispute?.disputeId))
    ) };
  } catch {
    return { ok: false, code: 'DISPUTE_STORE_UNAVAILABLE' };
  }
}

/** Public projection of a stored dispute record: no storage internals. */
export function publicDispute(record) {
  const dispute = record?.dispute || {};
  return {
    disputeId: dispute.disputeId,
    kind: dispute.kind,
    observedAt: dispute.observedAt,
    detail: dispute.detail,
    verifier: dispute.verifier ? {
      id: dispute.verifier.id,
      name: dispute.verifier.name,
      publicKey: dispute.verifier.publicKey,
      algorithm: 'Ed25519'
    } : null
  };
}
