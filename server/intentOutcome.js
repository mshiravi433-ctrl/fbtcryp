/**
 * Outcome marketplace auction (Phase 5: Outcome Marketplace).
 * ---------------------------------------------------------------------------
 * This module generalises the Phase 3 auction machinery to OUTCOME BIDS
 * without duplicating the Phase 3 modules: it reuses the same Ed25519 signing,
 * the same immutable-blob storage discipline and the same deterministic
 * grading / penalty table, with explicit schema branching on the commitment
 * kind (`fbt.outcome-bid.v1`).
 *
 * What is outcome-specific here:
 *   - the immutable outcome-bid log (separate `outcome-log/v1/` prefix),
 *   - a coordinator-signed admission receipt (`fbt.outcome-admission-receipt.v1`)
 *     that corresponds 1:1 to a stored log row (transactional admission +
 *     replay-proof nonce),
 *   - a deterministic close under `MAX_GUARANTEED_MINIMUM_V1` — highest
 *     guaranteedMinimum wins; ties resolve to lowest totalMaxCost, then fee,
 *     then lexical entry hash,
 *   - an independent completeness watcher report
 *     (`fbt.outcome-completeness-report.v1`) that re-grades the sealed set
 *     against the observed admission receipts with the same deterministic
 *     rule set as Phase 2c.
 *
 * Honesty boundary (unchanged from the rest of the protocol):
 *   - FBT holds nothing; `custody: false`, no escrow, no automatic
 *     settlement. The winning bid is a signed promise the USER reviews and
 *     settles with their own signature.
 *   - A failure penalty is DERIVED from the deterministic Phase 3 penalty
 *     table (intentBonds.PENALTY_BPS), never taken as a free value supplied
 *     by the solver.
 *   - `POST /bids` stays closed: bids enter only through the authenticated
 *     signed submission path with a transactional admission receipt.
 */

import { createHash, randomBytes } from 'node:crypto';
import { blobConfigured } from './blobCache.js';
import {
  canonicalValue,
  signCanonicalPayload,
  verifyCanonicalSignature
} from './intentSignatures.js';
import { merkleRoot } from './intentTransparency.js';
import { withIntentLock } from './intentLocks.js';
import { coordinatorConfig } from './intentAuctions.js';
import { verifyOutcomeBid } from './outcomeBids.js';
import {
  PENALTY_BPS,
  bondStatusFor,
  penaltyBpsFor,
  penaltyUsdFor
} from './intentBonds.js';

export const OUTCOME_POLICY = 'MAX_GUARANTEED_MINIMUM_V1';
export const OUTCOME_LOG_PREFIX = 'outcome-log/v1/';
export const OUTCOME_AUCTION_PREFIX = 'outcome-auction/v1/';
export const OUTCOME_ENTRY_SCHEMA = 'fbt.outcome-transparency-entry.v1';
export const OUTCOME_ADMISSION_RECEIPT_SCHEMA = 'fbt.outcome-admission-receipt.v1';
export const OUTCOME_ADMISSION_DOMAIN = 'fbt.outcome-admission-receipt.v1/signature';
export const OUTCOME_CLOSE_REQUEST_SCHEMA = 'fbt.outcome-close-request.v1';
export const OUTCOME_CLOSE_SCHEMA = 'fbt.outcome-close.v1';
export const OUTCOME_CLOSE_DOMAIN = 'fbt.outcome-close.v1/signature';
export const OUTCOME_SEAL_SCHEMA = 'fbt.outcome-seal.v1';
export const OUTCOME_COMPLETENESS_REPORT_SCHEMA = 'fbt.outcome-completeness-report.v1';
export const OUTCOME_COMPLETENESS_DOMAIN = 'fbt.outcome-completeness-report.v1/signature';

const CLOSE_ID_DOMAIN = 'fbt.outcome-close.v1/id';
const RECEIPT_ID_DOMAIN = 'fbt.outcome-admission-receipt.v1/id';
const REPORT_ID_DOMAIN = 'fbt.outcome-completeness-report.v1/id';

const TOKEN = process.env.BLOB_READ_WRITE_TOKEN || '';
const TX_RE_64 = /^0x[a-fA-F0-9]{64}$/;
const ID_RE = /^[a-z0-9][a-z0-9._-]{1,47}$/;
const QUOTE_CAPACITY_GUARD = 64;
const MAX_REPORT_RECEIPTS = 256;
const MAX_STORED_REPORTS_PER_INTENT = 64;

const memory = new Map();
const pendingPaths = new Set();
let blobApi = null;

const sha256 = (value) => createHash('sha256').update(value).digest();
const hex = (buffer) => `0x${Buffer.from(buffer).toString('hex')}`;
const sha256Hex = (value) => hex(sha256(value));
const parentHash = (left, right) => sha256(Buffer.concat([Buffer.from([1]), left, right]));
const safeIntent = (value) => TX_RE_64.test(String(value || '')) ? String(value).toLowerCase() : null;
const same = (a, b) => String(a || '').toLowerCase() === String(b || '').toLowerCase();

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
  if (!mod) throw new Error('OUTCOME_STORE_UNAVAILABLE');
  try {
    const listed = await mod.list({ prefix: path, limit: 10, token: TOKEN });
    const item = (listed?.blobs || []).find((row) => row.pathname === path);
    if (!item) return null;
    const response = await fetch(item.url, { cache: 'no-store' });
    if (!response.ok) throw new Error('OUTCOME_OBJECT_UNREADABLE');
    const value = await response.json();
    memory.set(path, value);
    return value;
  } catch (error) {
    if (error?.message === 'OUTCOME_OBJECT_UNREADABLE') throw error;
    throw new Error('OUTCOME_STORE_UNAVAILABLE');
  }
}

async function writeObject(path, value) {
  if (memory.has(path) || pendingPaths.has(path)) return { ok: false, duplicate: true };
  pendingPaths.add(path);
  try {
    const mod = await blob();
    if (blobConfigured() && !mod) return { ok: false, code: 'OUTCOME_STORE_UNAVAILABLE' };
    if (mod) {
      try {
        await mod.put(path, JSON.stringify(value), {
          token: TOKEN,
          access: 'public',
          contentType: 'application/json',
          addRandomSuffix: false,
          allowOverwrite: false,
          cacheControlMaxAge: 31536000
        });
      } catch {
        try {
          if (await readObject(path)) return { ok: false, duplicate: true };
        } catch {
          // Preserve the write failure; never fall back to memory here.
        }
        return { ok: false, code: 'OUTCOME_WRITE_FAILED' };
      }
    }
    memory.set(path, value);
    return { ok: true };
  } finally {
    pendingPaths.delete(path);
  }
}

async function listObjects(prefix, schema, expectPath) {
  const local = [...memory.entries()]
    .filter(([key]) => key.startsWith(prefix))
    .map(([, row]) => row);
  const mod = await blob();
  if (!blobConfigured()) return local;
  if (!mod) throw new Error('OUTCOME_STORE_UNAVAILABLE');
  const blobs = [];
  let cursor;
  do {
    const page = await mod.list({ prefix, limit: 1000, cursor, token: TOKEN });
    blobs.push(...(page?.blobs || []));
    if (page?.hasMore && !page.cursor) throw new Error('OUTCOME_CURSOR_MISSING');
    cursor = page?.hasMore ? page.cursor : undefined;
  } while (cursor);
  const remote = await Promise.all(blobs.map(async (item) => {
    const res = await fetch(item.url, { cache: 'no-store' });
    if (!res.ok) throw new Error('OUTCOME_OBJECT_UNREADABLE');
    const row = await res.json();
    if (row?.schema !== schema || (expectPath && row.path !== item.pathname)) {
      throw new Error('INVALID_STORED_OUTCOME_OBJECT');
    }
    return row;
  }));
  const byPath = new Map([...remote, ...local].map((row) => [row.path, row]));
  return [...byPath.values()];
}

/* ---------------------------- outcome bid log ----------------------------- */

/** Leaf hash of a signed outcome bid for the immutable outcome log. */
export function signedOutcomeBidHash(bid) {
  const payload = JSON.stringify({
    payload: JSON.parse(JSON.stringify({
      domain: 'fbt.outcome-bid.v1/signature',
      bid: canonicalValue({ ...bid, signature: undefined })
    })),
    signature: bid.signature
  });
  return hex(sha256(Buffer.concat([Buffer.from([0]), Buffer.from(payload, 'utf8')])));
}

function outcomeEntryPath(bid) {
  const intent = safeIntent(bid.intentHash);
  const nonce = String(bid.nonce).toLowerCase().replace(/^0x/, '');
  return `${OUTCOME_LOG_PREFIX}${intent.slice(2)}/${bid.solverId}/${nonce}.json`;
}

export async function appendOutcomeBid(bid, {
  registry = new Map(),
  bondedSolvers = null,
  now = Date.now()
} = {}) {
  const verified = verifyOutcomeBid(bid, { registry, bondedSolvers, now });
  if (!verified.ok) return verified;

  let current;
  try {
    current = await listObjects(
      `${OUTCOME_LOG_PREFIX}${bid.intentHash.toLowerCase().slice(2)}/`,
      OUTCOME_ENTRY_SCHEMA,
      false
    );
  } catch {
    return { ok: false, code: 'LOG_READ_FAILED' };
  }
  if (current.length >= QUOTE_CAPACITY_GUARD) return { ok: false, code: 'OUTCOME_LOG_FULL' };

  const path = outcomeEntryPath(bid);
  const entryHash = signedOutcomeBidHash(bid);
  const row = {
    schema: OUTCOME_ENTRY_SCHEMA,
    path,
    entryHash,
    acceptedAt: now,
    solver: verified.solver,
    bid
  };
  const stored = await writeObject(path, row);
  if (!stored.ok) return { ok: false, code: stored.duplicate ? 'NONCE_REPLAY' : stored.code };

  const hashes = [...current, row].map((r) => r.entryHash);
  const root = merkleRoot(hashes);
  return {
    ok: true,
    accepted: true,
    entryHash,
    acceptedAt: now,
    solverId: verified.solver.id,
    root,
    size: current.length + 1,
    durable: blobConfigured(),
    externallyAnchored: false
  };
}

/** Deterministic, reclaimable admission receipt for a stored outcome log row. */
export function issueOutcomeAdmissionReceipt({
  intentHash,
  entryHash,
  acceptedAt,
  solverId
}, { coordinator = coordinatorConfig() } = {}) {
  if (!coordinator) return null;
  const intent = safeIntent(intentHash);
  const entry = TX_RE_64.test(String(entryHash || '')) ? String(entryHash).toLowerCase() : null;
  if (!intent || !entry || !Number.isSafeInteger(acceptedAt) || acceptedAt <= 0) return null;
  if (!ID_RE.test(String(solverId || ''))) return null;
  const core = {
    schema: OUTCOME_ADMISSION_RECEIPT_SCHEMA,
    intentHash: intent,
    entryHash: entry,
    acceptedAt,
    solverId: String(solverId),
    coordinator: {
      id: coordinator.id,
      publicKey: coordinator.publicKey,
      algorithm: 'Ed25519'
    },
    binding: 'immutable-outcome-log-entry',
    claims: {
      entryStoredImmutably: true,
      coordinatorClockOnly: true,
      closeInclusionGuaranteed: false,
      executionAuthorised: false,
      fundsAccess: false
    }
  };
  const receiptId = sha256Hex(`${RECEIPT_ID_DOMAIN}\n${JSON.stringify(canonicalValue(core))}`);
  return {
    ...core,
    receiptId,
    signature: signCanonicalPayload(OUTCOME_ADMISSION_DOMAIN, { ...core, receiptId }, coordinator.privateKey)
  };
}

export function verifyOutcomeAdmissionReceipt(receipt, { intentHash } = {}) {
  if (!receipt || receipt.schema !== OUTCOME_ADMISSION_RECEIPT_SCHEMA
    || !TX_RE_64.test(String(receipt.receiptId || ''))) return false;
  if (!safeIntent(receipt.intentHash) || !safeIntent(receipt.entryHash)
    || (intentHash !== undefined && !same(receipt.intentHash, intentHash))) return false;
  if (!Number.isSafeInteger(receipt.acceptedAt) || receipt.acceptedAt <= 0
    || receipt.acceptedAt > Date.now() + 30 * 86400000) return false;
  if (!ID_RE.test(String(receipt.solverId || ''))) return false;
  const coordinator = receipt.coordinator;
  if (!coordinator || !ID_RE.test(String(coordinator.id || ''))
    || coordinator.algorithm !== 'Ed25519' || typeof coordinator.publicKey !== 'string') return false;
  if (receipt.binding !== 'immutable-outcome-log-entry') return false;
  const claims = receipt.claims;
  if (!claims || claims.entryStoredImmutably !== true || claims.coordinatorClockOnly !== true
    || claims.closeInclusionGuaranteed !== false || claims.executionAuthorised !== false
    || claims.fundsAccess !== false) return false;
  const { signature, receiptId, ...core } = receipt;
  if (sha256Hex(`${RECEIPT_ID_DOMAIN}\n${JSON.stringify(canonicalValue(core))}`) !== receiptId) return false;
  return verifyCanonicalSignature(OUTCOME_ADMISSION_DOMAIN, { ...core, receiptId }, signature, coordinator.publicKey);
}

export async function readOutcomeLogEntry(intentHash, entryHash) {
  const intent = safeIntent(intentHash);
  const entry = TX_RE_64.test(String(entryHash || '')) ? String(entryHash).toLowerCase() : null;
  if (!intent || !entry) return { error: 'BAD_LOOKUP' };
  try {
    const rows = await listObjects(`${OUTCOME_LOG_PREFIX}${intent.slice(2)}/`, OUTCOME_ENTRY_SCHEMA, false);
    const row = rows.find((item) => same(item.entryHash, entry));
    return row ? { entry: row } : { error: 'OUTCOME_ADMISSION_NOT_FOUND' };
  } catch {
    return { error: 'LOG_READ_FAILED' };
  }
}

export async function readOutcomeLog(intentHash) {
  const intent = safeIntent(intentHash);
  if (!intent) return { error: 'BAD_INTENT_HASH' };
  try {
    const rows = await listObjects(`${OUTCOME_LOG_PREFIX}${intent.slice(2)}/`, OUTCOME_ENTRY_SCHEMA, false);
    const sorted = [...rows].sort((a, b) => a.entryHash.localeCompare(b.entryHash));
    const hashes = sorted.map((row) => row.entryHash);
    return {
      schema: 'fbt.outcome-log.v1',
      intentHash: intent,
      root: merkleRoot(hashes),
      size: sorted.length,
      durable: blobConfigured(),
      externallyAnchored: false,
      entries: sorted.map((row) => ({
        ...row,
        inclusionProof: merkleProof(hashes, row.entryHash)
      }))
    };
  } catch {
    return { error: 'LOG_READ_FAILED' };
  }
}

export function merkleProof(hashes, targetHash) {
  let level = [...new Set((hashes || []).map((h) => String(h).toLowerCase()))]
    .filter((h) => TX_RE_64.test(h))
    .sort();
  let index = level.indexOf(String(targetHash).toLowerCase());
  if (index < 0) return null;
  const proof = [];
  while (level.length > 1) {
    const siblingIndex = index % 2 === 0 ? Math.min(index + 1, level.length - 1) : index - 1;
    proof.push({ position: index % 2 === 0 ? 'right' : 'left', hash: level[siblingIndex] });
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

/* ----------------------- deterministic close ------------------------------ */

function outcomeRejectionCode(bid, closedAtSeconds, policy) {
  if (bid.chainId !== policy.chainId) return 'CHAIN_MISMATCH';
  if (!bid.executable) return 'NOT_EXECUTABLE';
  if (bid.issuedAt > closedAtSeconds) return 'ISSUED_AFTER_CLOSE';
  if (bid.validUntil <= closedAtSeconds) return 'EXPIRED_AT_CLOSE';
  if (bid.feeBps > policy.maxFeeBps) return 'FEE_LIMIT_EXCEEDED';
  if (bid.slippageBps > policy.maxSlippageBps) return 'SLIPPAGE_LIMIT_EXCEEDED';
  return null;
}

/**
 * Pure deterministic selection under MAX_GUARANTEED_MINIMUM_V1:
 *   rank by highest guaranteedMinimum; tie → lowest totalMaxCost; then fee;
 *   then lexical entry hash. Identical inputs always yield the same winner.
 */
export function evaluateOutcomeAuction(entries, policy, closedAtSeconds) {
  const eligible = [];
  const rejected = [];
  for (const entry of entries || []) {
    const code = outcomeRejectionCode(entry.bid || {}, closedAtSeconds, policy);
    if (code) rejected.push({ entryHash: entry.entryHash, code });
    else eligible.push(entry);
  }
  eligible.sort((a, b) => {
    const guaranteeA = BigInt(a.bid.guaranteedMinimum);
    const guaranteeB = BigInt(b.bid.guaranteedMinimum);
    if (guaranteeA !== guaranteeB) return guaranteeA > guaranteeB ? -1 : 1;
    const costA = BigInt(a.bid.totalMaxCost);
    const costB = BigInt(b.bid.totalMaxCost);
    if (costA !== costB) return costA < costB ? -1 : 1;
    if (a.bid.feeBps !== b.bid.feeBps) return a.bid.feeBps - b.bid.feeBps;
    return a.entryHash.localeCompare(b.entryHash);
  });
  rejected.sort((a, b) => a.entryHash.localeCompare(b.entryHash));
  return {
    eligibleEntryHashes: eligible.map((entry) => entry.entryHash),
    rejected,
    selectedEntryHash: eligible[0]?.entryHash || null
  };
}

function validateOutcomeCloseRequest(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return { ok: false, code: 'BAD_CLOSE_BODY' };
  if (Object.keys(input).some((key) => !['schema', 'intentHash', 'policy'].includes(key))) {
    return { ok: false, code: 'UNKNOWN_CLOSE_FIELD' };
  }
  const intentHash = safeIntent(input.intentHash);
  if (input.schema !== OUTCOME_CLOSE_REQUEST_SCHEMA) return { ok: false, code: 'BAD_CLOSE_SCHEMA' };
  if (!intentHash) return { ok: false, code: 'BAD_INTENT_HASH' };
  const policy = input.policy;
  if (!policy || typeof policy !== 'object' || Array.isArray(policy)) return { ok: false, code: 'BAD_POLICY' };
  if (Object.keys(policy).some((key) => !['id', 'chainId', 'maxFeeBps', 'maxSlippageBps'].includes(key))) {
    return { ok: false, code: 'UNKNOWN_POLICY_FIELD' };
  }
  if (policy.id !== OUTCOME_POLICY) return { ok: false, code: 'BAD_POLICY' };
  if (!Number.isInteger(policy.chainId) || ![1, 10, 56, 137, 146, 8453, 42161, 43114, 59144].includes(policy.chainId)) {
    return { ok: false, code: 'BAD_POLICY_CHAIN' };
  }
  if (!Number.isInteger(policy.maxFeeBps) || policy.maxFeeBps < 0 || policy.maxFeeBps > 100) {
    return { ok: false, code: 'BAD_POLICY_FEE' };
  }
  if (!Number.isInteger(policy.maxSlippageBps) || policy.maxSlippageBps < 5 || policy.maxSlippageBps > 500) {
    return { ok: false, code: 'BAD_POLICY_SLIPPAGE' };
  }
  return {
    ok: true,
    value: {
      schema: OUTCOME_CLOSE_REQUEST_SCHEMA,
      intentHash,
      policy: {
        id: OUTCOME_POLICY,
        chainId: policy.chainId,
        maxFeeBps: policy.maxFeeBps,
        maxSlippageBps: policy.maxSlippageBps
      }
    }
  };
}

function validOutcomeSeal(seal, intentHash) {
  if (!seal || seal.schema !== OUTCOME_SEAL_SCHEMA || !same(seal.intentHash, intentHash)
    || !/^0x[a-fA-F0-9]{32}$/.test(String(seal.sealId || '')) || !Number.isSafeInteger(seal.sealedAt)) return false;
  return validateOutcomeCloseRequest({
    schema: OUTCOME_CLOSE_REQUEST_SCHEMA,
    intentHash,
    policy: seal.policy
  }).ok;
}

export function verifyOutcomeClose(close) {
  if (!close || close.schema !== OUTCOME_CLOSE_SCHEMA || !TX_RE_64.test(String(close.closeId || ''))) return false;
  const eligible = close.decision?.eligibleEntryHashes;
  const rejected = close.decision?.rejected;
  if (!Array.isArray(eligible) || !Array.isArray(rejected)) return false;
  const hashes = [...eligible, ...rejected.map((row) => row?.entryHash)];
  if (hashes.some((h) => !TX_RE_64.test(String(h || '')))
    || new Set(hashes).size !== hashes.length
    || hashes.length !== close.logSize
    || merkleRoot(hashes) !== close.logRoot
    || close.decision.selectedEntryHash !== (eligible[0] || null)) return false;
  const policyCheck = validateOutcomeCloseRequest({
    schema: OUTCOME_CLOSE_REQUEST_SCHEMA,
    intentHash: close.intentHash,
    policy: close.policy
  });
  if (!policyCheck.ok || !/^0x[a-f0-9]{32}$/.test(String(close.sealId || ''))
    || !Number.isSafeInteger(close.sealedAt) || !Number.isSafeInteger(close.closedAt)
    || close.closedAt < close.sealedAt
    || close.claims?.deterministicSelection !== true
    || close.claims?.userFundsAuthorised !== false
    || close.claims?.auctionCompletenessProven !== false
    || close.claims?.externallyAnchored !== false
    || close.claims?.automaticSettlement !== false
    || close.claims?.custody !== false) return false;
  const { signature, closeId, ...core } = close;
  if (sha256Hex(`${CLOSE_ID_DOMAIN}\n${JSON.stringify(canonicalValue(core))}`) !== closeId) return false;
  return verifyCanonicalSignature(OUTCOME_CLOSE_DOMAIN, { ...core, closeId }, signature, close.coordinator?.publicKey);
}

export async function outcomeSealStatus(intentHash) {
  const intent = safeIntent(intentHash);
  if (!intent) return { ok: false, code: 'BAD_INTENT_HASH' };
  try {
    const seal = await readObject(`${OUTCOME_AUCTION_PREFIX}seals/${intent.slice(2)}.json`);
    if (seal && !validOutcomeSeal(seal, intent)) return { ok: false, code: 'INVALID_STORED_SEAL' };
    return { ok: true, sealed: Boolean(seal), seal: seal || null };
  } catch {
    return { ok: false, code: 'OUTCOME_STORE_UNAVAILABLE' };
  }
}

export async function closeOutcomeAuction(request, { now = Date.now() } = {}) {
  const validation = validateOutcomeCloseRequest(request);
  if (!validation.ok) return validation;
  const coordinator = coordinatorConfig();
  if (!coordinator) return { ok: false, code: 'AUCTION_CLOSE_NOT_CONFIGURED' };
  const { intentHash, policy } = validation.value;
  return withIntentLock(intentHash, async () => {
    try {
      const closePath = `${OUTCOME_AUCTION_PREFIX}closes/${intentHash.slice(2)}.json`;
      const sealPath = `${OUTCOME_AUCTION_PREFIX}seals/${intentHash.slice(2)}.json`;
      const existing = await readObject(closePath);
      if (existing) {
        const existingSeal = await readObject(sealPath);
        return existingSeal && validOutcomeSeal(existingSeal, intentHash)
          && same(existing.sealId, existingSeal.sealId) && verifyOutcomeClose(existing)
          ? { ok: true, alreadyClosed: true, close: existing }
          : { ok: false, code: 'INVALID_STORED_CLOSE' };
      }
      let seal = await readObject(sealPath);
      if (seal) {
        if (!validOutcomeSeal(seal, intentHash)) return { ok: false, code: 'INVALID_STORED_SEAL' };
        if (JSON.stringify(canonicalValue(seal.policy)) !== JSON.stringify(canonicalValue(policy))) {
          return { ok: false, code: 'AUCTION_ALREADY_SEALED' };
        }
      } else {
        seal = {
          schema: OUTCOME_SEAL_SCHEMA,
          intentHash,
          sealId: `0x${randomBytes(16).toString('hex')}`,
          sealedAt: now,
          policy
        };
        const storedSeal = await writeObject(sealPath, seal);
        if (!storedSeal.ok) {
          if (!storedSeal.duplicate) return { ok: false, code: storedSeal.code || 'OUTCOME_WRITE_FAILED' };
          seal = await readObject(sealPath);
          if (!seal) return { ok: false, code: 'OUTCOME_STORE_UNAVAILABLE' };
          if (!validOutcomeSeal(seal, intentHash)) return { ok: false, code: 'INVALID_STORED_SEAL' };
        }
      }
      const log = await readOutcomeLog(intentHash);
      if (log.error) return { ok: false, code: log.error };
      const included = log.entries.filter((entry) => Number(entry.acceptedAt) <= Number(seal.sealedAt));
      const observedLateEntryHashes = log.entries
        .filter((entry) => Number(entry.acceptedAt) > Number(seal.sealedAt))
        .map((entry) => entry.entryHash)
        .sort();
      const closedAtSeconds = Math.floor(Number(seal.sealedAt) / 1000);
      const decision = evaluateOutcomeAuction(included, policy, closedAtSeconds);
      const core = {
        schema: OUTCOME_CLOSE_SCHEMA,
        intentHash,
        sealId: seal.sealId,
        sealedAt: seal.sealedAt,
        closedAt: Date.now(),
        logRoot: merkleRoot(included.map((entry) => entry.entryHash)),
        logSize: included.length,
        policy,
        decision,
        observedLateEntryHashes,
        coordinator: { id: coordinator.id, publicKey: coordinator.publicKey, algorithm: 'Ed25519' },
        claims: {
          deterministicSelection: true,
          userFundsAuthorised: false,
          auctionCompletenessProven: false,
          externallyAnchored: false,
          automaticSettlement: false,
          custody: false
        }
      };
      const closeId = sha256Hex(`${CLOSE_ID_DOMAIN}\n${JSON.stringify(canonicalValue(core))}`);
      const unsigned = { ...core, closeId };
      const close = {
        ...unsigned,
        signature: signCanonicalPayload(OUTCOME_CLOSE_DOMAIN, unsigned, coordinator.privateKey)
      };
      const storedClose = await writeObject(closePath, close);
      if (!storedClose.ok) {
        if (!storedClose.duplicate) return { ok: false, code: storedClose.code || 'OUTCOME_WRITE_FAILED' };
        const concurrent = await readObject(closePath);
        return concurrent && same(concurrent.sealId, seal.sealId) && verifyOutcomeClose(concurrent)
          ? { ok: true, alreadyClosed: true, close: concurrent }
          : { ok: false, code: 'INVALID_STORED_CLOSE' };
      }
      return { ok: true, alreadyClosed: false, close };
    } catch {
      return { ok: false, code: 'OUTCOME_STORE_UNAVAILABLE' };
    }
  });
}

export async function readOutcomeAuction(intentHash) {
  const intent = safeIntent(intentHash);
  if (!intent) return { error: 'BAD_INTENT_HASH' };
  try {
    const sealPath = `${OUTCOME_AUCTION_PREFIX}seals/${intent.slice(2)}.json`;
    const closePath = `${OUTCOME_AUCTION_PREFIX}closes/${intent.slice(2)}.json`;
    const seal = await readObject(sealPath);
    const close = await readObject(closePath);
    if (seal && !validOutcomeSeal(seal, intent)) return { error: 'INVALID_STORED_SEAL' };
    if (close && (!seal || !verifyOutcomeClose(close) || !same(close.sealId, seal.sealId))) {
      return { error: 'INVALID_STORED_CLOSE' };
    }
    return {
      schema: 'fbt.outcome-auction-state.v1',
      intentHash: intent,
      status: close ? 'closed' : seal ? 'sealing' : 'open',
      durable: blobConfigured(),
      seal: seal || null,
      close: close || null,
      externallyAnchored: false,
      custody: false,
      automaticSettlement: false
    };
  } catch {
    return { error: 'OUTCOME_STORE_UNAVAILABLE' };
  }
}

/* ---------------------- outcome completeness watcher ---------------------- */

function outcomeCloseSets(close) {
  const eligible = Array.isArray(close.decision?.eligibleEntryHashes) ? close.decision.eligibleEntryHashes : [];
  const rejected = Array.isArray(close.decision?.rejected) ? close.decision.rejected : [];
  const late = Array.isArray(close.observedLateEntryHashes) ? close.observedLateEntryHashes : [];
  return {
    eligible: new Set(eligible.map((h) => String(h).toLowerCase())),
    rejected: new Set(rejected.map((row) => String(row?.entryHash || '').toLowerCase())),
    late: new Set(late.map((h) => String(h).toLowerCase()))
  };
}

export function outcomeClockSkewAllowanceMs() {
  const parsed = Number(process.env.INTENT_WATCHER_SKEW_MS);
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 60000 ? Math.floor(parsed) : 2000;
}

function classifyOutcomeReceipt(receipt, close, sets, skewMs) {
  const valid = verifyOutcomeAdmissionReceipt(receipt, { intentHash: close.intentHash });
  if (!valid) return 'invalid';
  if (!same(receipt.coordinator?.publicKey, close.coordinator?.publicKey)) return 'invalid';
  const entry = String(receipt.entryHash).toLowerCase();
  const at = Number(receipt.acceptedAt);
  if (sets.eligible.has(entry)) return 'eligible';
  if (sets.rejected.has(entry)) return 'rejected';
  if (sets.late.has(entry)) return at <= close.sealedAt - skewMs ? 'late-contradiction' : 'late-observed';
  if (at <= close.sealedAt - skewMs) return 'omitted-pre-seal';
  if (at > close.sealedAt + skewMs) return at > close.closedAt + skewMs ? 'post-close' : 'ambiguous-window';
  return 'ambiguous-window';
}

export function evaluateOutcomeCompleteness(close, receipts = [], { clockSkewMs = outcomeClockSkewAllowanceMs() } = {}) {
  if (!verifyOutcomeClose(close)) return { ok: false, code: 'INVALID_AUCTION_CLOSE' };
  if (!Array.isArray(receipts)) return { ok: false, code: 'BAD_RECEIPTS' };
  if (receipts.length > MAX_REPORT_RECEIPTS) return { ok: false, code: 'TOO_MANY_RECEIPTS' };
  const sets = outcomeCloseSets(close);
  const seen = new Set();
  const rows = [];
  for (const receipt of receipts) {
    const key = typeof receipt?.receiptId === 'string' ? receipt.receiptId.toLowerCase() : null;
    if (key && seen.has(key)) {
      rows.push({ classification: 'duplicate', receiptId: receipt.receiptId, entryHash: receipt.entryHash,
        solverId: receipt.solverId, acceptedAt: receipt.acceptedAt, receipt });
      continue;
    }
    if (key) seen.add(key);
    rows.push({
      classification: classifyOutcomeReceipt(receipt, close, sets, clockSkewMs),
      receiptId: receipt?.receiptId,
      entryHash: receipt?.entryHash,
      solverId: receipt?.solverId,
      acceptedAt: receipt?.acceptedAt,
      receipt
    });
  }
  rows.sort((a, b) => `${String(a?.entryHash || '')}\n${String(a?.receiptId || '')}`
    .localeCompare(`${String(b?.entryHash || '')}\n${String(b?.receiptId || '')}`));

  const counts = {
    submitted: receipts.length, invalid: 0, duplicates: 0, eligible: 0, rejected: 0,
    lateObserved: 0, lateContradiction: 0, omittedPreSeal: 0, ambiguousWindow: 0, postClose: 0
  };
  for (const row of rows) {
    counts[{
      invalid: 'invalid', duplicate: 'duplicates', eligible: 'eligible', rejected: 'rejected',
      'late-observed': 'lateObserved', 'late-contradiction': 'lateContradiction',
      'omitted-pre-seal': 'omittedPreSeal', 'ambiguous-window': 'ambiguousWindow', 'post-close': 'postClose'
    }[row.classification]] += 1;
  }
  let verdict = 'unmonitored';
  if (rows.length) {
    verdict = 'complete';
    if (counts.ambiguousWindow > 0 || counts.invalid > 0) verdict = 'inconclusive';
    if (counts.omittedPreSeal > 0 || counts.lateContradiction > 0) verdict = 'misconduct-evident';
  }
  return { ok: true, rows, counts, verdict, clockSkewMs };
}

export function buildOutcomeCompletenessReport({
  close,
  receipts = [],
  watcher,
  privateKey = null,
  clockSkewMs = outcomeClockSkewAllowanceMs(),
  now = Date.now()
} = {}) {
  const evaluation = evaluateOutcomeCompleteness(close, receipts, { clockSkewMs });
  if (!evaluation.ok) return evaluation;
  if (!watcher || !ID_RE.test(String(watcher.id || '')) || typeof watcher.publicKey !== 'string') {
    return { ok: false, code: 'BAD_WATCHER' };
  }
  const core = {
    schema: OUTCOME_COMPLETENESS_REPORT_SCHEMA,
    intentHash: close.intentHash,
    closeId: close.closeId,
    closeSummary: {
      sealedAt: close.sealedAt,
      closedAt: close.closedAt,
      logRoot: close.logRoot,
      logSize: close.logSize,
      coordinatorId: close.coordinator?.id,
      coordinatorPublicKey: close.coordinator?.publicKey
    },
    evaluatedAt: now,
    clockSkewAllowanceMs: clockSkewMs,
    receipts: evaluation.rows,
    counts: evaluation.counts,
    verdict: evaluation.verdict,
    claims: {
      closeSignatureVerified: true,
      receiptSignaturesVerified: true,
      observedReceiptCoverageOnly: true,
      globalBidUniverseKnown: false,
      executionOrFundsAuthorised: false
    },
    watcher: {
      id: watcher.id,
      name: String(watcher.name || watcher.id).replace(/[<>\"'`\\]/g, '').slice(0, 80),
      publicKey: watcher.publicKey,
      algorithm: 'Ed25519'
    }
  };
  const reportId = sha256Hex(`${REPORT_ID_DOMAIN}\n${JSON.stringify(canonicalValue(core))}`);
  const unsigned = { ...core, reportId };
  return {
    ok: true,
    report: {
      ...unsigned,
      signature: privateKey ? signCanonicalPayload(OUTCOME_COMPLETENESS_DOMAIN, unsigned, privateKey) : null
    }
  };
}

export function verifyOutcomeCompletenessReport(report, { registry = null, close = null, requireRegistered = false } = {}) {
  if (!report || typeof report !== 'object' || Array.isArray(report)
    || report.schema !== OUTCOME_COMPLETENESS_REPORT_SCHEMA
    || !TX_RE_64.test(String(report.reportId || ''))) return { ok: false, code: 'BAD_REPORT_BODY' };
  if (!close || !verifyOutcomeClose(close)) return { ok: false, code: 'INVALID_AUCTION_CLOSE' };
  if (!same(report.intentHash, close.intentHash) || !same(report.closeId, close.closeId)) {
    return { ok: false, code: 'REPORT_CLOSE_MISMATCH' };
  }
  const summary = report.closeSummary || {};
  if (!Number.isSafeInteger(summary.sealedAt) || summary.sealedAt !== close.sealedAt
    || !Number.isSafeInteger(summary.closedAt) || summary.closedAt !== close.closedAt
    || !same(summary.logRoot, close.logRoot) || summary.logSize !== close.logSize
    || summary.coordinatorId !== close.coordinator?.id
    || !same(summary.coordinatorPublicKey, close.coordinator?.publicKey)) {
    return { ok: false, code: 'REPORT_CLOSE_MISMATCH' };
  }
  if (!Number.isSafeInteger(report.evaluatedAt)
    || !Number.isInteger(report.clockSkewAllowanceMs) || report.clockSkewAllowanceMs < 0
    || report.clockSkewAllowanceMs > 60000) return { ok: false, code: 'BAD_EVALUATION_META' };
  const watcher = report.watcher;
  if (!watcher || !ID_RE.test(String(watcher.id || '')) || watcher.algorithm !== 'Ed25519') {
    return { ok: false, code: 'BAD_WATCHER' };
  }
  if (registry) {
    const row = registry.get(watcher.id);
    if (!row || !row.active || row.publicKey !== watcher.publicKey) {
      return { ok: false, code: requireRegistered ? 'UNREGISTERED_WATCHER' : 'WATCHER_NOT_IN_REGISTRY' };
    }
  } else if (requireRegistered) {
    return { ok: false, code: 'WATCHER_REGISTRY_REQUIRED' };
  }
  const embedded = Array.isArray(report.receipts) ? report.receipts.map((row) => row?.receipt) : null;
  if (!embedded || embedded.length > MAX_REPORT_RECEIPTS) return { ok: false, code: 'BAD_RECEIPTS' };
  const recomputed = evaluateOutcomeCompleteness(close, embedded, { clockSkewMs: report.clockSkewAllowanceMs });
  if (!recomputed.ok) return { ok: false, code: recomputed.code };
  if (report.verdict !== recomputed.verdict
    || JSON.stringify(canonicalValue(report.counts)) !== JSON.stringify(canonicalValue(recomputed.counts))
    || JSON.stringify(canonicalValue(report.receipts)) !== JSON.stringify(canonicalValue(recomputed.rows))) {
    return { ok: false, code: 'REPORT_RECOMPUTE_MISMATCH' };
  }
  const claims = report.claims;
  if (!claims || claims.closeSignatureVerified !== true || claims.receiptSignaturesVerified !== true
    || claims.observedReceiptCoverageOnly !== true || claims.globalBidUniverseKnown !== false
    || claims.executionOrFundsAuthorised !== false) return { ok: false, code: 'REPORT_CLAIMS_MISMATCH' };
  const { signature, reportId, ...core } = report;
  if (sha256Hex(`${REPORT_ID_DOMAIN}\n${JSON.stringify(canonicalValue(core))}`) !== reportId) {
    return { ok: false, code: 'BAD_REPORT_ID' };
  }
  if (!verifyCanonicalSignature(OUTCOME_COMPLETENESS_DOMAIN, { ...core, reportId }, signature, watcher.publicKey)) {
    return { ok: false, code: 'WATCHER_SIGNATURE_MISMATCH' };
  }
  return { ok: true, report, recomputed };
}

async function outcomeStoreReport(intentHash, report, schema, prefix) {
  const intent = safeIntent(intentHash);
  if (!intent || !TX_RE_64.test(String(report?.reportId || '')) || !ID_RE.test(String(report?.watcher?.id || ''))) {
    return { ok: false, code: 'BAD_REPORT_BODY' };
  }
  const dir = `${prefix}${intent.slice(2)}/`;
  const path = `${dir}${report.watcher.id}/${report.reportId.slice(2)}.json`;
  const asDuplicate = async () => {
    try {
      const found = (await listObjects(dir, schema, true)).find((item) => item.path === path);
      return found ? { ok: true, alreadyReported: true, record: found } : { ok: false, code: 'OUTCOME_STORE_UNAVAILABLE' };
    } catch {
      return { ok: false, code: 'OUTCOME_STORE_UNAVAILABLE' };
    }
  };
  if (memory.has(path) || pendingPaths.has(path)) return asDuplicate();
  pendingPaths.add(path);
  try {
    const existing = await listObjects(dir, schema, true);
    if (existing.length >= MAX_STORED_REPORTS_PER_INTENT) return { ok: false, code: 'OUTCOME_REPORTS_FULL' };
    const record = { schema, path, storedAt: Date.now(), report };
    const stored = await writeObject(path, record);
    if (!stored.ok) {
      if (!stored.duplicate) return { ok: false, code: stored.code || 'OUTCOME_WRITE_FAILED' };
      const duplicate = await asDuplicate();
      return duplicate.ok ? duplicate : { ok: false, code: 'OUTCOME_WRITE_FAILED' };
    }
    return { ok: true, alreadyReported: false, record };
  } finally {
    pendingPaths.delete(path);
  }
}

export async function storeOutcomeCompletenessReport(intentHash, report) {
  return outcomeStoreReport(intentHash, report, 'fbt.outcome-watcher-report-record.v1',
    `${OUTCOME_AUCTION_PREFIX}watchers/`);
}

export async function readOutcomeCompletenessReports(intentHash, close) {
  const intent = safeIntent(intentHash);
  if (!intent) return { error: 'BAD_INTENT_HASH' };
  try {
    const records = await listObjects(`${OUTCOME_AUCTION_PREFIX}watchers/${intent.slice(2)}/`,
      'fbt.outcome-watcher-report-record.v1', true);
    const verified = [];
    for (const record of records) {
      if (!verifyOutcomeCompletenessReport(record.report, { close }).ok) {
        return { error: 'INVALID_STORED_WATCHER_REPORT' };
      }
      verified.push(record);
    }
    verified.sort((a, b) => String(a.report?.reportId).localeCompare(String(b.report?.reportId)));
    return { reports: verified };
  } catch {
    return { error: 'OUTCOME_STORE_UNAVAILABLE' };
  }
}

export function outcomeCompletenessSummary(records = []) {
  const reports = records.map((record) => record?.report || record).filter(Boolean);
  const verdicts = { complete: 0, 'misconduct-evident': 0, inconclusive: 0, unmonitored: 0 };
  let receiptsChecked = 0;
  let latestEvaluatedAt = null;
  const watchers = new Set();
  for (const report of reports) {
    if (verdicts[report.verdict] !== undefined) verdicts[report.verdict] += 1;
    if (report.watcher?.id) watchers.add(report.watcher.id);
    if (Number.isSafeInteger(report.evaluatedAt)) latestEvaluatedAt = Math.max(latestEvaluatedAt ?? 0, report.evaluatedAt);
    receiptsChecked = Math.max(receiptsChecked, Number(report.counts?.submitted) || 0);
  }
  let status = 'unmonitored';
  if (verdicts['misconduct-evident'] > 0) status = 'misconduct-reported';
  else if (verdicts.inconclusive > 0) status = 'inconclusive';
  else if (verdicts.complete > 0) status = 'watcher-verified';
  return {
    status,
    watcherReports: reports.length,
    watchers: [...watchers].sort(),
    receiptsChecked,
    verdicts,
    latestEvaluatedAt,
    scope: 'observed-admission-receipts-only'
  };
}

/* ------------------------- capabilities + grading ------------------------ */

/** Outcome failure penalty derives from the same deterministic Phase 3 table. */
export function outcomePenaltyBpsFor(verdict, selfReported) {
  return penaltyBpsFor(verdict, selfReported);
}

export function outcomeProtocolStatus({
  solverRegistry = new Map(),
  bondRegistry = new Map(),
  now = Date.now()
} = {}) {
  const board = [...bondRegistry.values()].map((bond) => ({ ...bond, ...bondStatusFor(bond, { solverRegistry, now }) }));
  return {
    schema: OUTCOME_CLOSE_SCHEMA,
    bidSchema: 'fbt.outcome-bid.v1',
    admissionReceiptSchema: OUTCOME_ADMISSION_RECEIPT_SCHEMA,
    completenessReportSchema: OUTCOME_COMPLETENESS_REPORT_SCHEMA,
    policy: OUTCOME_POLICY,
    registeredSolvers: solverRegistry.size,
    bondedSolvers: board.filter((row) => row.bonded).length,
    penaltyTableBps: PENALTY_BPS,
    deterministicPenaltyFromPhase3Table: true,
    automaticSettlement: false,
    custody: false,
    onChainEscrow: false,
    publicBidEndpoint: 'closed'
  };
}

export function outcomePublicCompletenessReport(record) {
  const report = record?.report || {};
  return {
    reportId: report.reportId,
    verdict: report.verdict,
    evaluatedAt: report.evaluatedAt,
    clockSkewAllowanceMs: report.clockSkewAllowanceMs,
    receipts: Array.isArray(report.receipts) ? report.receipts.length : 0,
    counts: report.counts,
    watcher: report.watcher ? {
      id: report.watcher.id, name: report.watcher.name,
      publicKey: report.watcher.publicKey, algorithm: 'Ed25519'
    } : null
  };
}
