/**
 * Deterministic outcome adjudication + declared-bond penalty (Phase 3a).
 * ---------------------------------------------------------------------------
 * This is where Phase 3's "bond + dispute" promise lands as EVIDENCE. After
 * a close, the coordinator re-reads the sealed selection from the immutable
 * log, applies the deterministic grading engine (gradeExecution) to whatever
 * execution claim and verifier disputes exist, computes the penalty the
 * declared bond owes, and signs it all as an fbt.adjudication.v1 record.
 *
 * The record embeds every input it graded over (the selected commitment, the
 * claim, the disputes), so ANY third party can recompute the grade and check
 * the coordinator's arithmetic without trusting anyone — the same discipline
 * the watcher reports use for completeness.
 *
 * Honesty boundary, stated inside the signed record itself:
 *   - `custody: false`, `fundsNotMovedByFbt: true`: the signature proves a
 *     deterministic verdict, never a transfer.
 *   - `enforcement: 'out-of-protocol'`: collecting the declared penalty is
 *     the settlement layer's job (escrow contract, agreement, reputation
 *     registry). The protocol signs the instruction-level evidence.
 *   - An adjudication is a snapshot: it grades what existed when it was
 *     minted, and storage is immutable, so a claim that arrives later
 *     creates a verifiable contradiction rather than rewriting history.
 */

import { createHash } from 'node:crypto';
import { blobConfigured } from './blobCache.js';
import {
  canonicalValue,
  signCanonicalPayload,
  verifyCanonicalSignature
} from './intentSignatures.js';
import { verifyAuctionClose } from './intentAuctions.js';
import {
  commitmentLeafHash,
  gradeExecution,
  verifyExecutionClaim
} from './intentExecution.js';
import { verifyDispute } from './intentDisputes.js';
import {
  bondStatusFor,
  penaltyUsdFor
} from './intentBonds.js';

export const ADJUDICATION_SCHEMA = 'fbt.adjudication.v1';
export const ADJUDICATION_DOMAIN = 'fbt.adjudication.v1/signature';
export const ADJUDICATION_RECORD_SCHEMA = 'fbt.adjudication-record.v1';
const ADJUDICATION_ID_DOMAIN = 'fbt.adjudication.v1/id';
const TX_RE_64 = /^0x[a-fA-F0-9]{64}$/;
const ID_RE = /^[a-z0-9][a-z0-9._-]{1,47}$/;
const TOKEN = process.env.BLOB_READ_WRITE_TOKEN || '';
const PREFIX = 'intent-auction/v1/';
const memory = new Map();
const pendingPaths = new Set();
let blobApi = null;

const sha256Hex = (value) => `0x${createHash('sha256').update(value).digest('hex')}`;

/** Post-deadline grace before an unclaimed execution grades as unexecuted.
    Bounded 0..86400s so a misconfigured env cannot stall adjudication forever. */
export function executionGraceSeconds() {
  const parsed = Number(process.env.INTENT_EXECUTION_GRACE_SECONDS);
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 86400 ? Math.floor(parsed) : 300;
}

function adjudicationIdFor(core) {
  return sha256Hex(`${ADJUDICATION_ID_DOMAIN}\n${JSON.stringify(canonicalValue(core))}`);
}

/**
 * Build a signed adjudication for one sealed close. All inputs are verified
 * first (close, commitment hash-binding, claim, disputes), then graded with
 * the same deterministic rules every third party uses. A grade of 'pending'
 * is refused: the execution window is still open and there is nothing to
 * adjudicate yet.
 */
export function buildAdjudication({
  close,
  commitment,
  claim = null,
  disputes = [],
  bond = null,
  coordinator,
  solverRegistry = new Map(),
  now = Date.now()
}) {
  if (!verifyAuctionClose(close)) return { ok: false, code: 'INVALID_AUCTION_CLOSE' };
  if (!commitment
    || commitmentLeafHash(commitment) !== String(close.decision?.selectedEntryHash).toLowerCase()) {
    return { ok: false, code: 'BAD_COMMITMENT_BINDING' };
  }
  if (claim) {
    const checked = verifyExecutionClaim(claim, { close, commitment, now });
    if (!checked.ok) return { ok: false, code: 'BAD_EXECUTION_CLAIM' };
  }
  for (const dispute of disputes) {
    if (!verifyDispute(dispute, { close, now }).ok) return { ok: false, code: 'BAD_DISPUTE' };
  }

  const graceSeconds = executionGraceSeconds();
  const grade = gradeExecution({
    commitment,
    claim,
    disputes,
    nowSeconds: Math.floor(now / 1000),
    graceSeconds
  });
  if (!grade.ok) return { ok: false, code: grade.code };
  if (grade.verdict === 'pending') return { ok: false, code: 'EXECUTION_WINDOW_OPEN' };

  /* Bonded status is a snapshot of the public board AT GRADE TIME: declared
     above the minimum, solver still registered, bond not expired. */
  const status = bondStatusFor(bond, { solverRegistry, now });
  const penaltyUsd = status.bonded
    ? penaltyUsdFor(bond.bondUsd, grade.penaltyBps)
    : null;

  const core = {
    schema: ADJUDICATION_SCHEMA,
    intentHash: close.intentHash,
    closeId: close.closeId,
    entryHash: close.decision.selectedEntryHash,
    gradedAt: now,
    graceSeconds,
    verdict: grade.verdict,
    selfReported: grade.selfReported,
    penaltyBps: grade.penaltyBps,
    penaltyUsd,
    bond: {
      solverId: commitment.solverId,
      bondUsd: bond?.bondUsd ?? null,
      asset: bond?.asset ?? null,
      expiresAt: bond?.expiresAt ?? null,
      bonded: status.bonded
    },
    input: {
      commitment,
      claim: claim || null,
      disputes: disputes || []
    },
    coordinator: {
      id: coordinator.id,
      publicKey: coordinator.publicKey,
      algorithm: 'Ed25519'
    },
    claims: {
      custody: false,
      fundsNotMovedByFbt: true,
      deterministicRules: true,
      enforcement: 'out-of-protocol',
      onChainEnforcement: false,
      selfReportedFailureHalvesPenalty: true,
      snapshotOfEvidenceAtGradeTime: true
    }
  };
  const adjudicationId = adjudicationIdFor(core);
  return {
    ok: true,
    adjudication: {
      ...core,
      adjudicationId,
      signature: signCanonicalPayload(ADJUDICATION_DOMAIN, { ...core, adjudicationId }, coordinator.privateKey)
    }
  };
}

/**
 * Full independent verification: recomputes the grade from the embedded
 * inputs and compares verdict, penalty and bonding before checking the
 * signature. A record whose grade does not reproduce — even one with a valid
 * coordinator signature — is rejected, exactly like a watcher report whose
 * verdict does not recompute.
 */
export function verifyAdjudication(record, { close }) {
  if (!record
    || typeof record !== 'object'
    || Array.isArray(record)
    || record.schema !== ADJUDICATION_SCHEMA
    || !TX_RE_64.test(String(record.adjudicationId || ''))) {
    return { ok: false, code: 'BAD_ADJUDICATION_BODY' };
  }
  if (!close || !verifyAuctionClose(close)) return { ok: false, code: 'INVALID_AUCTION_CLOSE' };
  if (String(record.intentHash).toLowerCase() !== String(close.intentHash).toLowerCase()
    || String(record.closeId).toLowerCase() !== String(close.closeId).toLowerCase()) {
    return { ok: false, code: 'ADJUDICATION_CLOSE_MISMATCH' };
  }
  const commitment = record.input?.commitment;
  if (!commitment
    || commitmentLeafHash(commitment) !== String(close.decision?.selectedEntryHash).toLowerCase()
    || String(record.entryHash).toLowerCase() !== String(close.decision.selectedEntryHash).toLowerCase()) {
    return { ok: false, code: 'BAD_COMMITMENT_BINDING' };
  }
  const claim = record.input?.claim;
  if (claim && !verifyExecutionClaim(claim, { close, commitment }).ok) {
    return { ok: false, code: 'BAD_EXECUTION_CLAIM' };
  }
  const disputes = Array.isArray(record.input?.disputes) ? record.input.disputes : null;
  if (!disputes || disputes.some((dispute) => !verifyDispute(dispute, { close }).ok)) {
    return { ok: false, code: 'BAD_DISPUTE' };
  }
  const coordinator = record.coordinator;
  if (!coordinator || !ID_RE.test(String(coordinator.id || '')) || coordinator.algorithm !== 'Ed25519'
    || typeof coordinator.publicKey !== 'string') {
    return { ok: false, code: 'BAD_COORDINATOR_IDENTITY' };
  }
  if (!Number.isSafeInteger(record.gradedAt)
    || !Number.isInteger(record.graceSeconds)
    || record.graceSeconds < 0
    || record.graceSeconds > 86400) {
    return { ok: false, code: 'BAD_ADJUDICATION_META' };
  }

  const grade = gradeExecution({
    commitment,
    claim,
    disputes,
    nowSeconds: Math.floor(Number(record.gradedAt) / 1000),
    graceSeconds: record.graceSeconds
  });
  if (!grade.ok || grade.verdict === 'pending') return { ok: false, code: 'BAD_ADJUDICATION_GRADE' };

  const bond = record.bond;
  const expectedBonded = Boolean(bond?.bonded);
  const expectedPenaltyUsd = expectedBonded
    ? penaltyUsdFor(bond?.bondUsd, grade.penaltyBps)
    : null;
  if (record.verdict !== grade.verdict
    || record.selfReported !== grade.selfReported
    || record.penaltyBps !== grade.penaltyBps
    || record.penaltyUsd !== expectedPenaltyUsd
    || record.bond?.bonded !== expectedBonded
    || record.bond?.solverId !== commitment.solverId) {
    return { ok: false, code: 'ADJUDICATION_RECOMPUTE_MISMATCH' };
  }

  const claims = record.claims;
  if (!claims
    || claims.custody !== false
    || claims.fundsNotMovedByFbt !== true
    || claims.deterministicRules !== true
    || claims.enforcement !== 'out-of-protocol'
    || claims.onChainEnforcement !== false) {
    return { ok: false, code: 'ADJUDICATION_CLAIMS_MISMATCH' };
  }

  const { signature, adjudicationId, ...core } = record;
  if (adjudicationIdFor(core) !== adjudicationId) return { ok: false, code: 'BAD_ADJUDICATION_ID' };
  if (!verifyCanonicalSignature(ADJUDICATION_DOMAIN, { ...core, adjudicationId }, signature, coordinator.publicKey)) {
    return { ok: false, code: 'COORDINATOR_SIGNATURE_MISMATCH' };
  }
  return { ok: true, record };
}

/* ---------------------------- immutable storage -------------------------- */

async function blob() {
  if (!blobConfigured()) return null;
  if (!blobApi) {
    try { blobApi = await import('@vercel/blob'); } catch { return null; }
  }
  return blobApi;
}

const adjudicationPath = (closeId) => `${PREFIX}adjudications/${String(closeId).slice(2)}.json`;

async function readObject(path) {
  if (memory.has(path)) return memory.get(path);
  const mod = await blob();
  if (!blobConfigured()) return null;
  if (!mod) throw new Error('ADJUDICATION_STORE_UNAVAILABLE');
  try {
    const listed = await mod.list({ prefix: path, limit: 10, token: TOKEN });
    const item = (listed?.blobs || []).find((row) => row.pathname === path);
    if (!item) return null;
    const response = await fetch(item.url, { cache: 'no-store' });
    if (!response.ok) throw new Error('ADJUDICATION_OBJECT_UNREADABLE');
    const value = await response.json();
    memory.set(path, value);
    return value;
  } catch {
    throw new Error('ADJUDICATION_STORE_UNAVAILABLE');
  }
}

async function writeImmutable(path, record) {
  if (memory.has(path) || pendingPaths.has(path)) {
    const existing = await readObject(path);
    return existing
      ? { ok: false, duplicate: true, existing }
      : { ok: false, code: 'ADJUDICATION_STORE_UNAVAILABLE' };
  }
  pendingPaths.add(path);
  try {
    const mod = await blob();
    if (blobConfigured() && !mod) return { ok: false, code: 'ADJUDICATION_STORE_UNAVAILABLE' };
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
        return { ok: false, code: 'ADJUDICATION_WRITE_FAILED' };
      }
    }
    memory.set(path, record);
    return { ok: true };
  } finally {
    pendingPaths.delete(path);
  }
}

/** One immutable adjudication slot per close. Adjudications are
    deterministic per input set, so identical bytes replay idempotently and
    different bytes are a conflict rather than an overwrite. */
export async function storeAdjudication(closeId, adjudication) {
  if (!TX_RE_64.test(String(closeId || '')) || !adjudication) return { ok: false, code: 'BAD_ADJUDICATION_BODY' };
  const path = adjudicationPath(closeId);
  const record = { schema: ADJUDICATION_RECORD_SCHEMA, path, storedAt: Date.now(), adjudication };
  const stored = await writeImmutable(path, record);
  if (stored.ok) return { ok: true, alreadyStored: false, record };
  if (!stored.duplicate) return { ok: false, code: stored.code };
  return JSON.stringify(stored.existing.adjudication) === JSON.stringify(adjudication)
    ? { ok: true, alreadyStored: true, record: stored.existing }
    : { ok: false, code: 'ADJUDICATION_CONFLICT' };
}

export async function readAdjudication(closeId) {
  if (!TX_RE_64.test(String(closeId || ''))) return null;
  try {
    const record = await readObject(adjudicationPath(closeId));
    if (!record) return null;
    if (record?.schema !== ADJUDICATION_RECORD_SCHEMA || record.path !== adjudicationPath(closeId)) {
      throw new Error('INVALID_STORED_ADJUDICATION');
    }
    return record;
  } catch {
    return null;
  }
}
