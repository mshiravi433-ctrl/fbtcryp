/**
 * FBT INTENT AI — PHASE 53: REAL BROADCAST & TRACKING
 * ---------------------------------------------------------------------------
 * A signed transaction is not an executed one. This module owns the honest
 * boundary between "we handed it to the network" and "the chain agrees".
 *
 *   submitted  → we have a transaction hash from a real broadcaster
 *   pending    → the hash exists, no receipt yet
 *   confirmed  → a real receipt with status 1 AND enough confirmations
 *   failed     → a real receipt with status 0 (revert)
 *
 * There is no path in this file that produces `confirmed` without a receipt
 * object coming back from the injected `receiptSource`. COMPLETED is never
 * fabricated.
 */

import { classifyFailure } from './failureModes.js';

export const BROADCAST_SCHEMA = 'fbt.broadcast.v1';
export const TX_STATUSES = Object.freeze(['pending', 'submitted', 'confirmed', 'failed']);

const TX_HASH_RE = /^0x[a-fA-F0-9]{64}$/;

/** Accept only a real 32-byte transaction hash. */
export function normalizeTxHash(value) {
  const s = typeof value === 'string' ? value.trim() : '';
  return TX_HASH_RE.test(s) ? s.toLowerCase() : null;
}

/**
 * Hand a signed transaction to a real broadcaster.
 * @param {object}   tx           the transaction request (already MEV-shielded)
 * @param {function} broadcaster  async (tx) → txHash  (e.g. eth_sendTransaction)
 */
export async function broadcastSigned({ tx = {}, signedTx = null, broadcaster, idempotencyKey = null } = {}) {
  if (typeof broadcaster !== 'function') {
    return {
      ok: false,
      status: 'unavailable',
      txHash: null,
      error: classifyFailure('MISSING_DATA', { detail: 'NO_BROADCASTER' })
    };
  }
  let raw = null;
  try {
    raw = await broadcaster({ ...tx, ...(signedTx ? { signedTx } : {}) }, { idempotencyKey });
  } catch (err) {
    const message = String(err?.message || err || '');
    if (Number(err?.code) === 4001 || /user\s*(rejected|denied)/i.test(message)) {
      return { ok: false, status: 'failed', txHash: null, error: classifyFailure('USER_REJECTED', { detail: 'WALLET_REJECTED' }) };
    }
    return { ok: false, status: 'failed', txHash: null, error: classifyFailure('SUBMIT_REJECTED', { detail: message.slice(0, 120) }) };
  }
  const txHash = normalizeTxHash(typeof raw === 'string' ? raw : raw?.hash ?? raw?.txHash);
  if (!txHash) {
    return { ok: false, status: 'failed', txHash: null, error: classifyFailure('SUBMIT_REJECTED', { detail: 'NO_TX_HASH' }) };
  }
  return {
    ok: true,
    schema: BROADCAST_SCHEMA,
    status: 'submitted',
    submitted: true,
    confirmed: false,
    txHash,
    receiptRef: txHash,
    idempotencyKey: idempotencyKey || null,
    fabricated: false
  };
}

/**
 * Ask the chain what really happened. Returns the `observation` shape the
 * existing monitor/reconciliation pipeline already understands.
 *
 * @param {function} receiptSource async (txHash) → { status, blockNumber, ... }
 * @param {function} [blockNumberSource] async () → current head, for confirmations
 */
export async function trackTransaction({
  txHash,
  receiptSource,
  blockNumberSource = null,
  requiredConfirmations = 1,
  requestedAmount = null
} = {}) {
  const hash = normalizeTxHash(txHash);
  if (!hash) {
    return { ok: false, status: 'pending', observation: emptyObservation(requestedAmount), error: classifyFailure('MISSING_DATA', { detail: 'NO_TX_HASH' }) };
  }
  if (typeof receiptSource !== 'function') {
    return { ok: false, status: 'submitted', txHash: hash, observation: emptyObservation(requestedAmount), error: classifyFailure('MISSING_DATA', { detail: 'NO_RECEIPT_SOURCE' }) };
  }
  let receipt = null;
  try {
    receipt = await receiptSource(hash);
  } catch (err) {
    return {
      ok: false,
      status: 'submitted',
      txHash: hash,
      observation: emptyObservation(requestedAmount),
      error: classifyFailure('PROVIDER_ERROR', { detail: String(err?.message || err).slice(0, 120) })
    };
  }
  if (!receipt || typeof receipt !== 'object') {
    // No receipt yet is NOT a failure and is NOT a success.
    return { ok: true, status: 'submitted', txHash: hash, observation: emptyObservation(requestedAmount) };
  }
  const reverted = receipt.status === 0 || receipt.status === '0x0' || receipt.status === false;
  const blockNumber = Number(receipt.blockNumber ?? receipt.block ?? NaN);
  let confirmations = Number(receipt.confirmations);
  if (!Number.isFinite(confirmations) && typeof blockNumberSource === 'function' && Number.isFinite(blockNumber)) {
    try {
      const head = Number(await blockNumberSource());
      if (Number.isFinite(head)) confirmations = Math.max(0, head - blockNumber + 1);
    } catch { confirmations = 0; }
  }
  if (!Number.isFinite(confirmations)) confirmations = Number.isFinite(blockNumber) ? 1 : 0;
  const enough = confirmations >= Math.max(1, Number(requiredConfirmations) || 1);
  const filledAmount = Number.isFinite(Number(receipt.filledAmount)) ? Number(receipt.filledAmount) : null;
  return {
    ok: !reverted,
    status: reverted ? 'failed' : enough ? 'confirmed' : 'submitted',
    txHash: hash,
    blockNumber: Number.isFinite(blockNumber) ? blockNumber : null,
    confirmations,
    observation: {
      confirmed: !reverted && enough,
      confirmations,
      reverted,
      terminal: reverted || enough,
      txHash: hash,
      ...(filledAmount !== null ? { filledAmount } : {}),
      ...(requestedAmount !== null ? { requestedAmount: Number(requestedAmount) } : {})
    },
    ...(reverted ? { error: classifyFailure('ONCHAIN_REVERT', { detail: hash }) } : {})
  };
}

/** The honest status word for a receipt, derived only from evidence. */
export function receiptStatusFor(observation = {}) {
  if (observation.reverted === true) return 'failed';
  if (observation.confirmed === true) return 'confirmed';
  if (observation.txHash) return 'submitted';
  return 'pending';
}

function emptyObservation(requestedAmount) {
  return {
    confirmed: false,
    confirmations: 0,
    reverted: false,
    terminal: false,
    ...(requestedAmount !== null && requestedAmount !== undefined ? { requestedAmount: Number(requestedAmount) } : {})
  };
}
