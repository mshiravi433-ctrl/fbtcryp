/**
 * FBT INTENT AI — PHASE 75: ON-CHAIN RECEIPT
 * ---------------------------------------------------------------------------
 * A UI receipt is not a document. Everything the panel shows about a past
 * execution is, ultimately, this app telling the user what this app did. The
 * fix is to put the *commitment* somewhere neither party controls: a hash of
 * the agreed terms and the observed outcome, anchored on chain.
 *
 *   · what is anchored is a HASH, never the terms themselves — the anchor
 *     proves "these terms, this outcome, by this time", and reveals nothing
 *   · anchoring is batched into a Merkle root, because paying gas per receipt
 *     would price honesty out of the product
 *   · an anchor that has not been mined is `pending`, never "anchored". The
 *     verification link only appears once there is a real transaction hash.
 *   · `verifyAgainstAnchor()` recomputes the leaf from the terms the user is
 *     looking at, so a receipt edited after the fact fails to verify
 */

import { classifyFailure } from './failureModes.js';

export const ANCHOR_SCHEMA = 'fbt.onchain-receipt.v1';
export const ANCHOR_STATES = Object.freeze(['unanchored', 'pending', 'anchored', 'failed']);
export const MAX_BATCH_SIZE = 256;

const TX_HASH = /^0x[a-f0-9]{64}$/i;
const num = (v) => (v === null || v === undefined || v === '' || typeof v === 'boolean'
  ? null
  : (Number.isFinite(Number(v)) ? Number(v) : null));

/** Deterministic, dependency-free digest used for leaves and nodes. */
export function digest(value) {
  const s = typeof value === 'string' ? value : JSON.stringify(value);
  let a = 0x6a09e667; let b = 0xbb67ae85; let c = 0x3c6ef372; let d = 0xa54ff53a;
  for (let i = 0; i < s.length; i += 1) {
    const ch = s.charCodeAt(i);
    a = Math.imul(a ^ ch, 0x01000193) >>> 0;
    b = Math.imul(b + ch + i, 0x85ebca6b) >>> 0;
    c = (c ^ Math.imul(a ^ b, 0xc2b2ae35)) >>> 0;
    d = Math.imul(d ^ c, 0x27d4eb2f) >>> 0;
  }
  const hex = (n) => n.toString(16).padStart(8, '0');
  return `0x${hex(a)}${hex(b)}${hex(c)}${hex(d)}`;
}

/**
 * The leaf: a commitment to the terms AND the outcome. Both, or neither —
 * anchoring terms without the result would prove only that we promised.
 */
export function buildReceiptLeaf({ intentId = null, terms = null, outcome = null, txHash = null, at = Date.now() } = {}) {
  const id = typeof intentId === 'string' && intentId.trim() ? intentId.trim().slice(0, 64) : null;
  if (!id) return { ok: false, error: classifyFailure('MISSING_DATA', { detail: 'NO_INTENT_ID' }) };
  if (!terms || typeof terms !== 'object') return { ok: false, error: classifyFailure('MISSING_DATA', { detail: 'NO_TERMS' }) };
  if (!outcome || typeof outcome !== 'object') return { ok: false, error: classifyFailure('MISSING_DATA', { detail: 'NO_OUTCOME' }) };
  const termsHash = digest(terms);
  const outcomeHash = digest(outcome);
  return {
    ok: true,
    schema: ANCHOR_SCHEMA,
    intentId: id,
    termsHash,
    outcomeHash,
    executionTxHash: TX_HASH.test(String(txHash || '')) ? String(txHash).toLowerCase() : null,
    leaf: digest(`${id}|${termsHash}|${outcomeHash}`),
    // Only the hashes travel. The terms stay with the user.
    revealsTerms: false,
    at
  };
}

/** Merkle root over the batch, so one transaction anchors many receipts. */
export function buildBatch({ leaves = [], now = Date.now() } = {}) {
  const rows = (Array.isArray(leaves) ? leaves : []).filter((l) => l?.ok === true).slice(0, MAX_BATCH_SIZE);
  if (!rows.length) return { ok: false, error: classifyFailure('MISSING_DATA', { detail: 'EMPTY_BATCH' }) };
  let level = rows.map((r) => r.leaf);
  const layers = [level];
  while (level.length > 1) {
    const next = [];
    for (let i = 0; i < level.length; i += 2) {
      next.push(i + 1 < level.length ? digest(`${level[i]}${level[i + 1]}`) : level[i]);
    }
    level = next;
    layers.push(level);
  }
  return {
    ok: true,
    schema: ANCHOR_SCHEMA,
    root: level[0],
    layers,
    leaves: rows,
    size: rows.length,
    // Gas is paid once for the whole batch.
    transactionsRequired: 1,
    state: 'unanchored',
    builtAt: now
  };
}

/** The inclusion proof one user needs for one receipt. */
export function merkleProof(batch, leafHash) {
  if (!batch?.ok || !batch.layers?.length) return { ok: false, error: classifyFailure('MISSING_DATA', { detail: 'NO_BATCH' }) };
  let index = batch.layers[0].indexOf(leafHash);
  if (index < 0) return { ok: false, error: classifyFailure('MISSING_DATA', { detail: 'LEAF_NOT_IN_BATCH' }) };
  const path = [];
  for (let l = 0; l < batch.layers.length - 1; l += 1) {
    const level = batch.layers[l];
    const pairIndex = index % 2 === 0 ? index + 1 : index - 1;
    if (pairIndex < level.length) path.push({ hash: level[pairIndex], right: index % 2 === 0 });
    index = Math.floor(index / 2);
  }
  return { ok: true, schema: ANCHOR_SCHEMA, leaf: leafHash, path, root: batch.root };
}

/** Recompute the root from a leaf and its path. */
export function verifyProof({ leaf = null, path = [], root = null } = {}) {
  if (!leaf || !root) return { ok: false, verified: false, error: classifyFailure('MISSING_DATA', { detail: 'NO_PROOF' }) };
  let cur = leaf;
  for (const step of Array.isArray(path) ? path : []) {
    cur = step?.right ? digest(`${cur}${step.hash}`) : digest(`${step.hash}${cur}`);
  }
  return cur === root
    ? { ok: true, verified: true, root }
    : { ok: false, verified: false, computed: cur, expected: root, error: classifyFailure('MISSING_DATA', { detail: 'PROOF_MISMATCH' }) };
}

/**
 * Submit the batch. Until a real transaction hash comes back this is PENDING;
 * a pending anchor is never described as anchored and gets no verify link.
 */
export async function anchorBatch({ batch = null, submit = null, chainId = null, now = Date.now() } = {}) {
  if (!batch?.ok) return { ok: false, state: 'failed', error: classifyFailure('MISSING_DATA', { detail: 'NO_BATCH' }) };
  if (typeof submit !== 'function') {
    return { ok: false, state: 'unanchored', anchored: false, verifyUrl: null, error: classifyFailure('MISSING_DATA', { detail: 'NO_ANCHOR_ADAPTER' }) };
  }
  let res = null;
  try {
    res = await submit({ root: batch.root, size: batch.size });
  } catch {
    return { ok: false, state: 'failed', anchored: false, verifyUrl: null, error: classifyFailure('SUBMIT_REJECTED', { detail: 'ANCHOR_SUBMIT_FAILED' }) };
  }
  const txHash = TX_HASH.test(String(res?.txHash || '')) ? String(res.txHash).toLowerCase() : null;
  if (!txHash) {
    return { ok: false, state: 'failed', anchored: false, verifyUrl: null, error: classifyFailure('SUBMIT_REJECTED', { detail: 'NO_ANCHOR_TX_HASH' }) };
  }
  const mined = num(res?.blockNumber) !== null && res?.confirmed === true;
  return {
    ok: true,
    schema: ANCHOR_SCHEMA,
    root: batch.root,
    txHash,
    chainId: num(chainId ?? res?.chainId),
    blockNumber: num(res?.blockNumber),
    // Submitted is not mined. Only a mined anchor is "anchored".
    state: mined ? 'anchored' : 'pending',
    anchored: mined,
    verifyUrl: mined ? explorerUrl({ chainId: num(chainId ?? res?.chainId), txHash }) : null,
    i18nKey: mined ? 'intentAI.anchor.anchored' : 'intentAI.anchor.pending',
    i18nParams: { count: batch.size },
    anchoredAt: mined ? now : null,
    submittedAt: now
  };
}

const EXPLORERS = Object.freeze({
  1: 'https://etherscan.io/tx/', 42161: 'https://arbiscan.io/tx/',
  8453: 'https://basescan.org/tx/', 10: 'https://optimistic.etherscan.io/tx/',
  137: 'https://polygonscan.com/tx/', 56: 'https://bscscan.com/tx/'
});

/** A link the user can open, or null. Never a guessed explorer. */
export function explorerUrl({ chainId = null, txHash = null } = {}) {
  const base = EXPLORERS[num(chainId)];
  if (!base || !TX_HASH.test(String(txHash || ''))) return null;
  return `${base}${String(txHash).toLowerCase()}`;
}

/** Re-derive the leaf from what the user is looking at NOW and compare. */
export function verifyAgainstAnchor({ intentId = null, terms = null, outcome = null, proof = null, anchor = null } = {}) {
  const leaf = buildReceiptLeaf({ intentId, terms, outcome });
  if (leaf.ok !== true) return { ok: false, verified: false, error: leaf.error };
  if (!anchor || anchor.anchored !== true) {
    return { ok: false, verified: false, reason: 'NOT_ANCHORED_YET', i18nKey: 'intentAI.anchor.pending', error: classifyFailure('MISSING_DATA', { detail: 'ANCHOR_NOT_MINED' }) };
  }
  if (leaf.leaf !== proof?.leaf) {
    // The receipt on screen is not the receipt that was anchored.
    return { ok: false, verified: false, reason: 'RECEIPT_ALTERED', i18nKey: 'intentAI.anchor.mismatch', error: classifyFailure('TERMS_CHANGED', { detail: 'RECEIPT_DOES_NOT_MATCH_ANCHOR' }) };
  }
  const proven = verifyProof({ leaf: leaf.leaf, path: proof.path, root: anchor.root });
  return proven.verified === true
    ? { ok: true, verified: true, root: anchor.root, txHash: anchor.txHash, verifyUrl: anchor.verifyUrl, i18nKey: 'intentAI.anchor.verified' }
    : { ok: false, verified: false, reason: 'PROOF_FAILED', i18nKey: 'intentAI.anchor.mismatch', error: proven.error };
}
