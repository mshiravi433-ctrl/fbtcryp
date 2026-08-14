/**
 * Execution claims + the deterministic execution-grading engine (Phase 3a).
 * ---------------------------------------------------------------------------
 * Phase 2c made admission receipts prove a quote was accepted; it never
 * answered what happened AFTER the close. This module is the first half of
 * that answer: the winning solver signs an execution claim
 * (fbt.execution-claim.v1) binding the sealed close and the selected entry to
 * the actual outcome — tx hash, chain, received amount, fee, timing. The
 * coordinator later grades it deterministically (see server/intentAdjudication.js
 * and, in Phase 3b, independent verifier settlement reports).
 *
 * Honesty boundary, stated in the claim itself:
 *   - The claim is SIGNED EVIDENCE, not machine-verified truth. `onChainVerified`
 *     is always false and `txInclusionCheck` is always 'not-performed' — the
 *     protocol never claims it replayed the transaction.
 *   - No funds pass through FBT. `custody: false`, `fundsNotMovedByFbt: true`.
 *   - A claim can never widen the quote: the graded outcome is recomputed from
 *     the signed commitment's amountOut and slippageBps, not from anything the
 *     claim asserts about itself.
 */

import { createHash } from 'node:crypto';
import { blobConfigured } from './blobCache.js';
import {
  canonicalValue,
  signCanonicalPayload,
  verifyCanonicalSignature
} from './intentSignatures.js';
import { signedCommitmentHash } from './intentTransparency.js';
import { penaltyBpsFor } from './intentBonds.js';

export const EXECUTION_CLAIM_SCHEMA = 'fbt.execution-claim.v1';
export const EXECUTION_CLAIM_DOMAIN = 'fbt.execution-claim.v1/signature';
export const EXECUTION_RECORD_SCHEMA = 'fbt.execution-claim-record.v1';
const CLAIM_ID_DOMAIN = 'fbt.execution-claim.v1/id';
const TX_RE_64 = /^0x[a-fA-F0-9]{64}$/;
const ID_RE = /^[a-z0-9][a-z0-9._-]{1,47}$/;
const OUTCOMES = new Set(['filled', 'short', 'reverted', 'expired']);
const CLAIM_FIELDS = new Set([
  'schema', 'intentHash', 'closeId', 'entryHash', 'solverId', 'chainId',
  'outcome', 'txHash', 'amountReceived', 'feeBpsCharged', 'gasUsedWei',
  'executedAt', 'solver', 'claimId', 'signature', 'claims'
]);
const MAX_CLOCK_SKEW_SECONDS = 30;
const TOKEN = process.env.BLOB_READ_WRITE_TOKEN || '';
const PREFIX = 'intent-auction/v1/';
const memory = new Map();
const pendingPaths = new Set();
let blobApi = null;

const sha256Hex = (value) => `0x${createHash('sha256').update(value).digest('hex')}`;

const positiveIntegerString = (value, maxLength = 78) =>
  typeof value === 'string'
  && new RegExp(`^[0-9]{1,${maxLength}}$`).test(value)
  && BigInt(value) > 0n;

/**
 * The deterministic minimum output of a signed quote: what the solver
 * committed to deliver at its own declared slippage.
 * floor(amountOut × (10000 − slippageBps) / 10000).
 */
export function minOutFor(commitment) {
  const amount = BigInt(String(commitment?.amountOut));
  const slippage = Number(commitment?.slippageBps);
  if (amount <= 0n || !Number.isInteger(slippage) || slippage < 0 || slippage > 10000) return null;
  return ((amount * BigInt(10000 - slippage)) / 10000n).toString();
}

/** Deterministic outcome label for a claim's raw facts. */
function baseOutcomeFor(commitment, claim) {
  const minOut = minOutFor(commitment);
  if (claim.outcome === 'filled' || claim.outcome === 'short') {
    return BigInt(String(claim.amountReceived)) >= BigInt(minOut) ? 'fulfilled' : 'short-filled';
  }
  return 'failed';
}

/**
 * THE GRADING ENGINE. Pure function of (commitment, claim, disputes, now):
 * the same inputs produce the same verdict, penalty and reasons on every
 * machine — this is what lets a third party re-grade an adjudication or a
 * settlement report without trusting the coordinator.
 *
 * Rules (all deterministic):
 *   - no claim + deadline open        → pending (nothing to grade yet)
 *   - no claim + deadline passed      → unexecuted, full bond penalty
 *   - filled/short, ≥ quoted minOut   → fulfilled, zero penalty
 *   - filled/short, < quoted minOut   → short-filled (self-report halves)
 *   - filled/short, executed after
 *     the quote window                → failed, treated as mislabelled
 *   - reverted / expired              → failed (self-reported)
 *   - a verifier dispute contradicts
 *     the claim                       → contested (parked at half bond)
 */
export function gradeExecution({
  commitment,
  claim = null,
  disputes = [],
  nowSeconds,
  graceSeconds
}) {
  const minOut = minOutFor(commitment);
  const validUntil = Number(commitment?.validUntil);
  if (!minOut || !Number.isSafeInteger(validUntil)) return { ok: false, code: 'BAD_COMMITMENT' };
  const reasons = [];
  const disputeKinds = new Set((disputes || []).map((row) => row?.kind));

  if (!claim) {
    if (nowSeconds <= validUntil + graceSeconds) {
      return {
        ok: true, verdict: 'pending', selfReported: null, penaltyBps: null,
        corroborated: disputeKinds.has('no-execution'),
        promisedOut: commitment.amountOut, deliveredOut: null,
        reasons: ['EXECUTION_WINDOW_OPEN']
      };
    }
    return {
      ok: true, verdict: 'unexecuted', selfReported: false,
      penaltyBps: 10000, corroborated: disputeKinds.has('no-execution'),
      promisedOut: commitment.amountOut, deliveredOut: null,
      reasons: ['DEADLINE_PASSED_WITHOUT_CLAIM']
    };
  }

  let base = baseOutcomeFor(commitment, claim);
  let selfReported = false;
  if (base === 'fulfilled') {
    selfReported = claim.outcome === 'filled';
    reasons.push('RECEIVED_AT_OR_ABOVE_QUOTED_MIN_OUT');
  } else if (base === 'short-filled') {
    selfReported = claim.outcome === 'short';
    reasons.push('RECEIVED_BELOW_QUOTED_MIN_OUT');
  } else {
    selfReported = true;
    reasons.push(claim.outcome === 'expired' ? 'SELF_REPORTED_EXPIRED' : 'SELF_REPORTED_REVERTED');
  }

  /* Executing after the signed quote window is a failure the solver cannot
     relabel as a fill: the quote it won stopped existing at validUntil. */
  if ((claim.outcome === 'filled' || claim.outcome === 'short')
    && Number.isSafeInteger(claim.executedAt)
    && claim.executedAt > validUntil + graceSeconds) {
    base = 'failed';
    selfReported = false;
    reasons.push('EXECUTED_AFTER_QUOTE_WINDOW');
  }

  /* A registered verifier's signed contradiction parks the grade at
     'contested': half the bond, never zero, never full, until resolved. */
  const falseClaimDispute = disputeKinds.has('false-claim');
  const shortFillDispute = disputeKinds.has('short-fill') && base === 'fulfilled';
  const contested = falseClaimDispute || shortFillDispute;

  const verdict = contested ? 'contested' : base;
  const penaltyBps = contested ? 5000 : penaltyBpsFor(verdict, selfReported);
  return {
    ok: true,
    verdict,
    selfReported,
    penaltyBps,
    disputed: falseClaimDispute || shortFillDispute,
    promisedOut: commitment.amountOut,
    deliveredOut: claim.amountReceived ?? null,
    reasons
  };
}

function claimIdFor(core) {
  return sha256Hex(`${CLAIM_ID_DOMAIN}\n${JSON.stringify(canonicalValue(core))}`);
}

/**
 * Build a structurally valid claim core for the sealed close's selected
 * entry. `solver` is the public identity row from the solver registry;
 * `privateKey` produces a signed, submittable claim. The claim pins its own
 * solver key (like a watcher report pins its watcher) so third parties can
 * verify it without any registry.
 */
export function buildExecutionClaim({
  close,
  commitment,
  outcome,
  txHash = null,
  amountReceived = null,
  feeBpsCharged = null,
  gasUsedWei = null,
  executedAt = null
}, solver, privateKey) {
  const core = {
    schema: EXECUTION_CLAIM_SCHEMA,
    intentHash: close.intentHash,
    closeId: close.closeId,
    entryHash: close.decision.selectedEntryHash,
    solverId: commitment.solverId,
    chainId: commitment.chainId,
    outcome,
    txHash,
    amountReceived,
    feeBpsCharged,
    gasUsedWei,
    executedAt,
    solver: {
      id: solver.id,
      publicKey: solver.publicKey,
      algorithm: 'Ed25519'
    },
    claims: {
      onChainVerified: false,
      txInclusionCheck: 'not-performed',
      custody: false,
      fundsNotMovedByFbt: true
    }
  };
  const structural = validateExecutionClaim(core);
  if (!structural.ok) return structural;
  const claimId = claimIdFor(core);
  return {
    ok: true,
    claim: {
      ...core,
      claimId,
      signature: signCanonicalPayload(EXECUTION_CLAIM_DOMAIN, { ...core, claimId }, privateKey)
    }
  };
}

/** Strict structural validation before any signature or storage work. */
export function validateExecutionClaim(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return { ok: false, code: 'BAD_CLAIM_BODY' };
  if (Object.keys(input).some((key) => !CLAIM_FIELDS.has(key))) return { ok: false, code: 'UNKNOWN_CLAIM_FIELD' };
  if (input.schema !== EXECUTION_CLAIM_SCHEMA) return { ok: false, code: 'BAD_CLAIM_SCHEMA' };
  if (!TX_RE_64.test(String(input.intentHash || ''))
    || !TX_RE_64.test(String(input.closeId || ''))
    || !TX_RE_64.test(String(input.entryHash || ''))) return { ok: false, code: 'BAD_CLAIM_BINDING' };
  if (!ID_RE.test(String(input.solverId || ''))) return { ok: false, code: 'BAD_SOLVER' };
  if (!Number.isInteger(input.chainId)) return { ok: false, code: 'BAD_CHAIN' };
  if (!OUTCOMES.has(input.outcome)) return { ok: false, code: 'BAD_OUTCOME' };

  const financial = input.outcome === 'filled' || input.outcome === 'short';
  const needsTx = input.outcome === 'filled' || input.outcome === 'short' || input.outcome === 'reverted';
  if (needsTx && !TX_RE_64.test(String(input.txHash || ''))) return { ok: false, code: 'BAD_TX_HASH' };
  if (input.outcome === 'expired' && input.txHash != null) return { ok: false, code: 'BAD_TX_HASH' };
  if (financial && !positiveIntegerString(input.amountReceived)) return { ok: false, code: 'BAD_AMOUNT_RECEIVED' };
  if (!financial && input.amountReceived != null) return { ok: false, code: 'BAD_AMOUNT_RECEIVED' };
  if (financial && !Number.isInteger(input.feeBpsCharged)) return { ok: false, code: 'BAD_FEE' };
  if (input.feeBpsCharged != null
    && (!Number.isInteger(input.feeBpsCharged) || input.feeBpsCharged < 0 || input.feeBpsCharged > 100)) {
    return { ok: false, code: 'BAD_FEE' };
  }
  if (input.gasUsedWei != null && !positiveIntegerString(input.gasUsedWei)) return { ok: false, code: 'BAD_GAS' };
  const needsTime = input.outcome === 'filled' || input.outcome === 'short' || input.outcome === 'reverted';
  if (needsTime && !Number.isSafeInteger(input.executedAt)) return { ok: false, code: 'BAD_EXECUTED_AT' };
  if (input.executedAt != null && !Number.isSafeInteger(input.executedAt)) return { ok: false, code: 'BAD_EXECUTED_AT' };

  const solver = input.solver;
  if (!solver || !ID_RE.test(String(solver.id || '')) || solver.algorithm !== 'Ed25519'
    || typeof solver.publicKey !== 'string') {
    return { ok: false, code: 'BAD_SOLVER_IDENTITY' };
  }
  const claims = input.claims;
  if (!claims
    || claims.onChainVerified !== false
    || claims.txInclusionCheck !== 'not-performed'
    || claims.custody !== false
    || claims.fundsNotMovedByFbt !== true) {
    return { ok: false, code: 'BAD_CLAIM_FLAGS' };
  }
  return { ok: true };
}

/**
 * Full verification. `close` and the selected `commitment` (read from the
 * immutable log at admission) bind the claim to one sealed auction: the
 * entry hash must be the sealed selection, the solver must be the solver
 * whose quote won, and the chain must be the close's chain. With a registry
 * and `requireRegistered`, the pinned solver key must match the active
 * registry row — key hijack under a known id fails. Without a registry the
 * signature still verifies against the pinned key (offline verification).
 */
export function verifyExecutionClaim(input, {
  close,
  commitment,
  registry = null,
  requireRegistered = false,
  now = Date.now()
} = {}) {
  const structural = validateExecutionClaim(input);
  if (!structural.ok) return structural;
  if (!close || close.decision?.selectedEntryHash == null) return { ok: false, code: 'BAD_CLOSE_BINDING' };
  if (String(input.intentHash).toLowerCase() !== String(close.intentHash).toLowerCase()
    || String(input.closeId).toLowerCase() !== String(close.closeId).toLowerCase()) {
    return { ok: false, code: 'BAD_CLOSE_BINDING' };
  }
  if (String(input.entryHash).toLowerCase() !== String(close.decision.selectedEntryHash).toLowerCase()) {
    return { ok: false, code: 'BAD_SELECTION_BINDING' };
  }
  if (commitment) {
    if (signedCommitmentHash(commitment) !== String(close.decision.selectedEntryHash).toLowerCase()) {
      return { ok: false, code: 'BAD_COMMITMENT_BINDING' };
    }
    if (String(input.solverId) !== String(commitment.solverId)) return { ok: false, code: 'BAD_SELECTION_BINDING' };
    if (input.chainId !== commitment.chainId || input.chainId !== close.policy?.chainId) {
      return { ok: false, code: 'BAD_CHAIN' };
    }
  }
  const nowSeconds = Math.floor(now / 1000);
  const sealedSeconds = Math.floor(Number(close.sealedAt) / 1000);
  if (Number.isSafeInteger(input.executedAt)
    && (input.executedAt > nowSeconds + MAX_CLOCK_SKEW_SECONDS
      || input.executedAt < sealedSeconds - MAX_CLOCK_SKEW_SECONDS)) {
    return { ok: false, code: 'BAD_EXECUTED_AT' };
  }

  if (registry) {
    const row = registry.get(input.solverId);
    if (!row || !row.active || row.publicKey !== input.solver.publicKey) {
      return { ok: false, code: requireRegistered ? 'UNREGISTERED_SOLVER' : 'SOLVER_NOT_IN_REGISTRY' };
    }
  } else if (requireRegistered) {
    return { ok: false, code: 'SOLVER_REGISTRY_REQUIRED' };
  }

  const { signature, claimId, ...core } = input;
  if (!TX_RE_64.test(String(claimId || '')) || claimIdFor(core) !== claimId) {
    return { ok: false, code: 'BAD_CLAIM_ID' };
  }
  if (!verifyCanonicalSignature(EXECUTION_CLAIM_DOMAIN, { ...core, claimId }, signature, input.solver.publicKey)) {
    return { ok: false, code: 'SIGNATURE_MISMATCH' };
  }
  return { ok: true, claim: input };
}

/* ---------------------------- immutable storage -------------------------- */

async function blob() {
  if (!blobConfigured()) return null;
  if (!blobApi) {
    try { blobApi = await import('@vercel/blob'); } catch { return null; }
  }
  return blobApi;
}

const claimPath = (closeId) => `${PREFIX}execution/${String(closeId).slice(2)}.json`;

async function readObject(path) {
  if (memory.has(path)) return memory.get(path);
  const mod = await blob();
  if (!blobConfigured()) return null;
  if (!mod) throw new Error('EXECUTION_STORE_UNAVAILABLE');
  try {
    const listed = await mod.list({ prefix: path, limit: 10, token: TOKEN });
    const item = (listed?.blobs || []).find((row) => row.pathname === path);
    if (!item) return null;
    const response = await fetch(item.url, { cache: 'no-store' });
    if (!response.ok) throw new Error('EXECUTION_OBJECT_UNREADABLE');
    const value = await response.json();
    memory.set(path, value);
    return value;
  } catch {
    throw new Error('EXECUTION_STORE_UNAVAILABLE');
  }
}

async function writeImmutable(path, record) {
  if (memory.has(path) || pendingPaths.has(path)) {
    const existing = await readObject(path);
    return existing
      ? { ok: false, duplicate: true, existing }
      : { ok: false, code: 'EXECUTION_STORE_UNAVAILABLE' };
  }
  pendingPaths.add(path);
  try {
    const mod = await blob();
    if (blobConfigured() && !mod) return { ok: false, code: 'EXECUTION_STORE_UNAVAILABLE' };
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
        return { ok: false, code: 'EXECUTION_WRITE_FAILED' };
      }
    }
    memory.set(path, record);
    return { ok: true };
  } finally {
    pendingPaths.delete(path);
  }
}

/**
 * Store a verified execution claim: one immutable slot per close. Identical
 * bytes replay idempotently; different bytes for the same close are a
 * conflict — a close has one outcome and one claimant.
 */
export async function storeExecutionClaim(closeId, claim) {
  if (!TX_RE_64.test(String(closeId || '')) || !claim) return { ok: false, code: 'BAD_CLAIM_BODY' };
  const path = claimPath(closeId);
  const record = { schema: EXECUTION_RECORD_SCHEMA, path, storedAt: Date.now(), claim };
  const stored = await writeImmutable(path, record);
  if (stored.ok) return { ok: true, alreadyStored: false, record };
  if (!stored.duplicate) return { ok: false, code: stored.code };
  return JSON.stringify(stored.existing.claim) === JSON.stringify(claim)
    ? { ok: true, alreadyStored: true, record: stored.existing }
    : { ok: false, code: 'EXECUTION_CLAIM_CONFLICT' };
}

export async function readExecutionClaim(closeId) {
  if (!TX_RE_64.test(String(closeId || ''))) return null;
  try {
    const record = await readObject(claimPath(closeId));
    if (!record) return null;
    if (record?.schema !== EXECUTION_RECORD_SCHEMA || record.path !== claimPath(closeId)) {
      throw new Error('INVALID_STORED_EXECUTION_CLAIM');
    }
    return record.claim;
  } catch {
    return null;
  }
}

/** Capabilities block for claims, disputes and adjudication. */
export function executionProtocolStatus({ registeredVerifiers = 0, graceSeconds = null } = {}) {
  return {
    claimSchema: EXECUTION_CLAIM_SCHEMA,
    disputeSchema: 'fbt.dispute.v1',
    adjudicationSchema: 'fbt.adjudication.v1',
    registeredVerifiers,
    graceSeconds,
    deterministicGrading: true,
    quotedMinOutBindsOutcome: true,
    selfReportedFailureHalvesPenalty: true,
    onChainTxVerification: false,
    penaltyEnforcement: 'out-of-protocol',
    custody: false
  };
}
