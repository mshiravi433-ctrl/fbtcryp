/**
 * Deterministic auction closure for the FBT signed-commitment log.
 *
 * Closure is deliberately separate from execution. An authenticated operator
 * places an immutable seal, evaluates the sealed commitments with a versioned
 * policy, and signs the resulting close manifest with an Ed25519 coordinator
 * key. The record grants no spending authority and contains no calldata.
 *
 * Vercel Blob provides immutable objects but not a transaction spanning the
 * seal and quote paths. A process-local lock makes local mode atomic; deployed
 * capabilities continue to report that cross-instance completeness is not yet
 * proven. An on-chain anchor can timestamp the exact signed close, but does not
 * magically prove that no quote was censored before the seal.
 */

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { blobConfigured } from './blobCache.js';
import {
  canonicalValue,
  publicKeyFromPrivateKey,
  signCanonicalPayload,
  verifyCanonicalSignature
} from './intentSignatures.js';
import { merkleRoot, readIntentLog } from './intentTransparency.js';
import { withIntentLock } from './intentLocks.js';

export const AUCTION_CLOSE_REQUEST_SCHEMA = 'fbt.auction-close-request.v1';
export const AUCTION_CLOSE_SCHEMA = 'fbt.auction-close.v1';
export const AUCTION_POLICY = 'MAX_OUTPUT_WITHIN_SIGNED_LIMITS_V1';
export const AUCTION_CLOSE_DOMAIN = 'fbt.auction-close.v1/signature';
const CLOSE_ID_DOMAIN = 'fbt.auction-close.v1/id';
const TOKEN = process.env.BLOB_READ_WRITE_TOKEN || '';
const PREFIX = 'intent-auction/v1/';
const memory = new Map();
const pending = new Set();
let blobApi = null;

const sha256Hex = (value) => `0x${createHash('sha256').update(value).digest('hex')}`;
const safeIntent = (value) => /^0x[a-fA-F0-9]{64}$/.test(String(value || ''))
  ? String(value).toLowerCase() : null;
const same = (a, b) => String(a || '').toLowerCase() === String(b || '').toLowerCase();
const sealPath = (intentHash) => `${PREFIX}seals/${intentHash.slice(2)}.json`;
const closePath = (intentHash) => `${PREFIX}closes/${intentHash.slice(2)}.json`;
const anchorPath = (closeId) => `${PREFIX}anchors/${closeId.slice(2)}.json`;

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
  if (!mod) throw new Error('AUCTION_STORE_UNAVAILABLE');
  try {
    const listed = await mod.list({ prefix: path, limit: 10, token: TOKEN });
    const item = (listed?.blobs || []).find((row) => row.pathname === path);
    if (!item) return null;
    const response = await fetch(item.url, { cache: 'no-store' });
    if (!response.ok) throw new Error('AUCTION_OBJECT_UNREADABLE');
    const value = await response.json();
    memory.set(path, value);
    return value;
  } catch (error) {
    if (error?.message === 'AUCTION_OBJECT_UNREADABLE') throw error;
    throw new Error('AUCTION_STORE_UNAVAILABLE');
  }
}

async function writeObject(path, value) {
  if (memory.has(path) || pending.has(path)) return { ok: false, duplicate: true };
  pending.add(path);
  try {
    const mod = await blob();
    if (blobConfigured() && !mod) return { ok: false, code: 'AUCTION_STORE_UNAVAILABLE' };
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
          // Preserve the write failure below; never fall back to memory here.
        }
        return { ok: false, code: 'AUCTION_WRITE_FAILED' };
      }
    }
    memory.set(path, value);
    return { ok: true };
  } finally {
    pending.delete(path);
  }
}

/* Exported as the single source of coordinator identity: admission receipts
   (Phase 2c) must come from exactly the same key that signs auction closes,
   or watcher correlation would compare two different authorities. */
export function coordinatorConfig() {
  const id = String(process.env.INTENT_COORDINATOR_ID || 'fbt-coordinator').toLowerCase();
  const privateKey = process.env.INTENT_COORDINATOR_PRIVATE_KEY || '';
  if (!/^[a-z0-9][a-z0-9._-]{1,47}$/.test(id) || !privateKey) return null;
  try {
    return { id, privateKey, publicKey: publicKeyFromPrivateKey(privateKey) };
  } catch {
    return null;
  }
}

export function publicCoordinator() {
  const config = coordinatorConfig();
  return config ? { id: config.id, publicKey: config.publicKey, algorithm: 'Ed25519' } : null;
}

export function closeAuthenticationConfigured() {
  return Boolean(coordinatorConfig() && String(process.env.INTENT_AUCTION_CLOSE_TOKEN || '').length >= 32);
}

export function authenticateAuctionClose(authorization = '') {
  const expected = process.env.INTENT_AUCTION_CLOSE_TOKEN || '';
  if (expected.length < 32 || !coordinatorConfig()) return { ok: false, code: 'AUCTION_CLOSE_NOT_CONFIGURED' };
  const supplied = String(authorization).match(/^Bearer\s+(.+)$/i)?.[1] || '';
  const a = Buffer.from(supplied);
  const b = Buffer.from(expected);
  return a.length === b.length && a.length > 0 && timingSafeEqual(a, b)
    ? { ok: true }
    : { ok: false, code: 'UNAUTHORIZED_AUCTION_CLOSE' };
}

export function validateCloseRequest(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return { ok: false, code: 'BAD_CLOSE_BODY' };
  if (Object.keys(input).some((key) => !['schema', 'intentHash', 'policy'].includes(key))) {
    return { ok: false, code: 'UNKNOWN_CLOSE_FIELD' };
  }
  const intentHash = safeIntent(input.intentHash);
  if (input.schema !== AUCTION_CLOSE_REQUEST_SCHEMA) return { ok: false, code: 'BAD_CLOSE_SCHEMA' };
  if (!intentHash) return { ok: false, code: 'BAD_INTENT_HASH' };
  const policy = input.policy;
  if (!policy || typeof policy !== 'object' || Array.isArray(policy)) return { ok: false, code: 'BAD_POLICY' };
  if (Object.keys(policy).some((key) => !['id', 'chainId', 'maxFeeBps', 'maxSlippageBps'].includes(key))) {
    return { ok: false, code: 'UNKNOWN_POLICY_FIELD' };
  }
  if (policy.id !== AUCTION_POLICY) return { ok: false, code: 'BAD_POLICY' };
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
      schema: AUCTION_CLOSE_REQUEST_SCHEMA,
      intentHash,
      policy: {
        id: AUCTION_POLICY,
        chainId: policy.chainId,
        maxFeeBps: policy.maxFeeBps,
        maxSlippageBps: policy.maxSlippageBps
      }
    }
  };
}

function rejectionCode(commitment, closedAtSeconds, policy) {
  if (commitment.chainId !== policy.chainId) return 'CHAIN_MISMATCH';
  if (!commitment.executable) return 'NOT_EXECUTABLE';
  if (commitment.issuedAt > closedAtSeconds) return 'ISSUED_AFTER_CLOSE';
  if (commitment.validUntil <= closedAtSeconds) return 'EXPIRED_AT_CLOSE';
  if (commitment.feeBps > policy.maxFeeBps) return 'FEE_LIMIT_EXCEEDED';
  if (commitment.slippageBps > policy.maxSlippageBps) return 'SLIPPAGE_LIMIT_EXCEEDED';
  return null;
}

/** Pure deterministic selection; every tie ends at the lexical entry hash. */
export function evaluateAuction(entries, policy, closedAtSeconds) {
  const eligible = [];
  const rejected = [];
  for (const entry of entries || []) {
    const code = rejectionCode(entry.commitment || {}, closedAtSeconds, policy);
    if (code) rejected.push({ entryHash: entry.entryHash, code });
    else eligible.push(entry);
  }
  eligible.sort((a, b) => {
    const outputA = BigInt(a.commitment.amountOut);
    const outputB = BigInt(b.commitment.amountOut);
    if (outputA !== outputB) return outputA > outputB ? -1 : 1;
    const gasA = BigInt(a.commitment.maxGas);
    const gasB = BigInt(b.commitment.maxGas);
    if (gasA !== gasB) return gasA < gasB ? -1 : 1;
    if (a.commitment.feeBps !== b.commitment.feeBps) return a.commitment.feeBps - b.commitment.feeBps;
    if (a.commitment.slippageBps !== b.commitment.slippageBps) {
      return a.commitment.slippageBps - b.commitment.slippageBps;
    }
    return a.entryHash.localeCompare(b.entryHash);
  });
  rejected.sort((a, b) => a.entryHash.localeCompare(b.entryHash));
  return {
    eligibleEntryHashes: eligible.map((entry) => entry.entryHash),
    rejected,
    selectedEntryHash: eligible[0]?.entryHash || null
  };
}

function closeIdFor(core) {
  return sha256Hex(`${CLOSE_ID_DOMAIN}\n${JSON.stringify(canonicalValue(core))}`);
}

function validSeal(seal, intentHash) {
  if (!seal
    || seal.schema !== 'fbt.auction-seal.v1'
    || !same(seal.intentHash, intentHash)
    || !/^0x[a-fA-F0-9]{32}$/.test(String(seal.sealId || ''))
    || !Number.isSafeInteger(seal.sealedAt)) return false;
  return validateCloseRequest({
    schema: AUCTION_CLOSE_REQUEST_SCHEMA,
    intentHash,
    policy: seal.policy
  }).ok;
}

export function verifyAuctionClose(close) {
  if (!close || close.schema !== AUCTION_CLOSE_SCHEMA || !/^0x[a-f0-9]{64}$/.test(String(close.closeId || ''))) {
    return false;
  }
  const eligible = close.decision?.eligibleEntryHashes;
  const rejected = close.decision?.rejected;
  if (!Array.isArray(eligible) || !Array.isArray(rejected)) return false;
  const hashes = [
    ...eligible,
    ...rejected.map((row) => row?.entryHash)
  ];
  if (hashes.some((hash) => !/^0x[a-f0-9]{64}$/.test(String(hash || '')))
    || new Set(hashes).size !== hashes.length
    || hashes.length !== close.logSize
    || merkleRoot(hashes) !== close.logRoot
    || close.decision.selectedEntryHash !== (eligible[0] || null)) {
    return false;
  }
  const policyCheck = validateCloseRequest({
    schema: AUCTION_CLOSE_REQUEST_SCHEMA,
    intentHash: close.intentHash,
    policy: close.policy
  });
  if (!policyCheck.ok
    || !/^0x[a-f0-9]{32}$/.test(String(close.sealId || ''))
    || !Number.isSafeInteger(close.sealedAt)
    || !Number.isSafeInteger(close.closedAt)
    || close.closedAt < close.sealedAt
    || close.claims?.deterministicSelection !== true
    || close.claims?.userFundsAuthorised !== false
    || close.claims?.auctionCompletenessProven !== false
    || close.claims?.externallyAnchored !== false) return false;
  const { signature, closeId, ...core } = close;
  if (closeIdFor(core) !== closeId) return false;
  return verifyCanonicalSignature(AUCTION_CLOSE_DOMAIN, { ...core, closeId }, signature, close.coordinator?.publicKey);
}

export async function auctionSealStatus(intentHash) {
  const intent = safeIntent(intentHash);
  if (!intent) return { ok: false, code: 'BAD_INTENT_HASH' };
  try {
    const seal = await readObject(sealPath(intent));
    if (seal && !validSeal(seal, intent)) return { ok: false, code: 'INVALID_STORED_SEAL' };
    return { ok: true, sealed: Boolean(seal), seal: seal || null };
  } catch {
    return { ok: false, code: 'AUCTION_STORE_UNAVAILABLE' };
  }
}

export async function closeAuction(request, { now = Date.now() } = {}) {
  const validation = validateCloseRequest(request);
  if (!validation.ok) return validation;
  const coordinator = coordinatorConfig();
  if (!coordinator) return { ok: false, code: 'AUCTION_CLOSE_NOT_CONFIGURED' };
  const { intentHash, policy } = validation.value;

  return withIntentLock(intentHash, async () => {
    try {
      const existing = await readObject(closePath(intentHash));
      if (existing) {
        const existingSeal = await readObject(sealPath(intentHash));
        return existingSeal
          && validSeal(existingSeal, intentHash)
          && same(existing.sealId, existingSeal.sealId)
          && verifyAuctionClose(existing)
          ? { ok: true, alreadyClosed: true, close: existing }
          : { ok: false, code: 'INVALID_STORED_CLOSE' };
      }

      let seal = await readObject(sealPath(intentHash));
      if (seal) {
        if (!validSeal(seal, intentHash)) return { ok: false, code: 'INVALID_STORED_SEAL' };
        if (JSON.stringify(canonicalValue(seal.policy)) !== JSON.stringify(canonicalValue(policy))) {
          return { ok: false, code: 'AUCTION_ALREADY_SEALED' };
        }
      } else {
        seal = {
          schema: 'fbt.auction-seal.v1',
          intentHash,
          sealId: `0x${randomBytes(16).toString('hex')}`,
          sealedAt: now,
          policy
        };
        const storedSeal = await writeObject(sealPath(intentHash), seal);
        if (!storedSeal.ok) {
          if (!storedSeal.duplicate) return { ok: false, code: storedSeal.code || 'AUCTION_WRITE_FAILED' };
          seal = await readObject(sealPath(intentHash));
          if (!seal) return { ok: false, code: 'AUCTION_STORE_UNAVAILABLE' };
          if (!validSeal(seal, intentHash)) return { ok: false, code: 'INVALID_STORED_SEAL' };
        }
      }

      const log = await readIntentLog(intentHash);
      if (log.error) return { ok: false, code: log.error };
      const included = log.entries.filter((entry) => Number(entry.acceptedAt) <= Number(seal.sealedAt));
      const observedLateEntryHashes = log.entries
        .filter((entry) => Number(entry.acceptedAt) > Number(seal.sealedAt))
        .map((entry) => entry.entryHash)
        .sort();
      const closedAtSeconds = Math.floor(Number(seal.sealedAt) / 1000);
      const decision = evaluateAuction(included, policy, closedAtSeconds);
      const core = {
        schema: AUCTION_CLOSE_SCHEMA,
        intentHash,
        sealId: seal.sealId,
        sealedAt: seal.sealedAt,
        closedAt: Date.now(),
        logRoot: merkleRoot(included.map((entry) => entry.entryHash)),
        logSize: included.length,
        policy,
        decision,
        observedLateEntryHashes,
        coordinator: {
          id: coordinator.id,
          publicKey: coordinator.publicKey,
          algorithm: 'Ed25519'
        },
        claims: {
          deterministicSelection: true,
          userFundsAuthorised: false,
          auctionCompletenessProven: false,
          externallyAnchored: false
        }
      };
      const closeId = closeIdFor(core);
      const unsigned = { ...core, closeId };
      const close = {
        ...unsigned,
        signature: signCanonicalPayload(AUCTION_CLOSE_DOMAIN, unsigned, coordinator.privateKey)
      };
      const storedClose = await writeObject(closePath(intentHash), close);
      if (!storedClose.ok) {
        if (!storedClose.duplicate) return { ok: false, code: storedClose.code || 'AUCTION_WRITE_FAILED' };
        const concurrent = await readObject(closePath(intentHash));
        return concurrent && same(concurrent.sealId, seal.sealId) && verifyAuctionClose(concurrent)
          ? { ok: true, alreadyClosed: true, close: concurrent }
          : { ok: false, code: 'INVALID_STORED_CLOSE' };
      }
      return { ok: true, alreadyClosed: false, close };
    } catch {
      return { ok: false, code: 'AUCTION_STORE_UNAVAILABLE' };
    }
  });
}

function validStoredAnchor(close, anchor) {
  return Boolean(anchor
    && anchor.schema === 'fbt.auction-anchor-record.v1'
    && anchor.verified === true
    && same(anchor.closeId, close.closeId)
    && same(anchor.intentHash, close.intentHash)
    && same(anchor.logRoot, close.logRoot)
    && Number.isInteger(anchor.chainId)
    && /^0x[a-fA-F0-9]{64}$/.test(String(anchor.txHash || ''))
    && /^0x[a-fA-F0-9]{40}$/.test(String(anchor.contract || '')));
}

export async function storeAuctionAnchor(close, anchor) {
  if (!verifyAuctionClose(close) || !anchor?.verified || !/^0x[a-f0-9]{64}$/.test(String(close.closeId))) {
    return { ok: false, code: 'BAD_ANCHOR_RECORD' };
  }
  const path = anchorPath(close.closeId);
  try {
    const existing = await readObject(path);
    if (existing) return validStoredAnchor(close, existing)
      ? { ok: true, alreadyAnchored: true, anchor: existing }
      : { ok: false, code: 'INVALID_STORED_ANCHOR' };
    const record = {
      ...anchor,
      schema: 'fbt.auction-anchor-record.v1',
      closeId: close.closeId,
      intentHash: close.intentHash,
      logRoot: close.logRoot,
      verified: true
    };
    const stored = await writeObject(path, record);
    if (!stored.ok) {
      if (!stored.duplicate) return { ok: false, code: stored.code || 'AUCTION_WRITE_FAILED' };
      const concurrent = await readObject(path);
      return concurrent && validStoredAnchor(close, concurrent)
        ? { ok: true, alreadyAnchored: true, anchor: concurrent }
        : { ok: false, code: concurrent ? 'INVALID_STORED_ANCHOR' : 'AUCTION_STORE_UNAVAILABLE' };
    }
    return { ok: true, alreadyAnchored: false, anchor: record };
  } catch {
    return { ok: false, code: 'AUCTION_STORE_UNAVAILABLE' };
  }
}

export async function readAuction(intentHash) {
  const intent = safeIntent(intentHash);
  if (!intent) return { error: 'BAD_INTENT_HASH' };
  try {
    const seal = await readObject(sealPath(intent));
    const close = await readObject(closePath(intent));
    if (seal && !validSeal(seal, intent)) return { error: 'INVALID_STORED_SEAL' };
    if (close && (!seal || !verifyAuctionClose(close) || !same(close.sealId, seal.sealId))) {
      return { error: 'INVALID_STORED_CLOSE' };
    }
    const anchor = close ? await readObject(anchorPath(close.closeId)) : null;
    if (anchor && !validStoredAnchor(close, anchor)) return { error: 'INVALID_STORED_ANCHOR' };
    return {
      schema: 'fbt.auction-state.v1',
      intentHash: intent,
      status: close ? 'closed' : seal ? 'sealing' : 'open',
      durable: blobConfigured(),
      seal: seal || null,
      close: close || null,
      anchor: anchor || null,
      externallyAnchored: Boolean(anchor?.verified)
    };
  } catch {
    return { error: 'AUCTION_STORE_UNAVAILABLE' };
  }
}

export function auctionProtocolStatus(anchorNetworks = 0, registeredWatchers = 0) {
  const durable = blobConfigured();
  const coordinator = publicCoordinator();
  return {
    closeConfigured: closeAuthenticationConfigured(),
    coordinator,
    policy: AUCTION_POLICY,
    signedCloseReceipts: true,
    immutableSeals: true,
    persistenceMode: durable ? 'vercel-blob-immutable' : 'process-memory-ephemeral',
    processAtomicAdmissionClose: true,
    crossInstanceTransactionalClose: false,
    /* Phase 2c evidence model: the close object itself still never asserts
       completeness; completeness is a per-auction verdict derived from
       signed admission receipts by recomputable watcher reports. */
    auctionCompletenessProof: false,
    signedAdmissionReceipts: Boolean(coordinator),
    admissionReceiptSchema: 'fbt.admission-receipt.v1',
    completenessWatchersRegistered: registeredWatchers,
    completenessWatcherReports: 'fbt.completeness-report.v1',
    perAuctionCompletenessEvidence: 'observed-admission-receipts-vs-sealed-close',
    externalAnchorVerificationConfigured: anchorNetworks > 0,
    configuredAnchorNetworks: anchorNetworks
  };
}
