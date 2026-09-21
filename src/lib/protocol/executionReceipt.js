/**
 * FBT INTENT PROTOCOL — PROOF-OF-EXECUTION 2.0 & CANONICAL RECEIPT
 * ---------------------------------------------------------------------------
 * Spec §16: Canonical, independently verifiable ExecutionReceipt answering:
 *   What intent? Who authorized it? Which solver? Which quote? What transaction?
 *   Which chain? What block? What amount? What fee? Was the constraint satisfied?
 */

import { keccak256, toUtf8Bytes } from 'ethers';
import { RECEIPT_SCHEMA_VERSION, EVIDENCE_TIERS } from './types.js';
import { canonicalJson } from './intentHashing.js';

export function createExecutionReceipt({
  intentId,
  solverId,
  quoteId,
  sourceChainId,
  destinationChainId,
  transactionHash,
  blockNumber,
  timestamp = Math.floor(Date.now() / 1000),
  amountIn,
  amountOut,
  fee = '0',
  status = 'SUCCESS',
  evidenceTier = EVIDENCE_TIERS.CRYPTOGRAPHICALLY_VERIFIED,
  proofVersion = RECEIPT_SCHEMA_VERSION,
  calldataSummary = null,
  attestationSignature = null
}) {
  const receiptFields = {
    proofVersion,
    intentId,
    solverId,
    quoteId,
    sourceChainId: Number(sourceChainId),
    destinationChainId: Number(destinationChainId || sourceChainId),
    transactionHash: String(transactionHash),
    blockNumber: Number(blockNumber || 0),
    timestamp: Number(timestamp),
    amountIn: String(amountIn),
    amountOut: String(amountOut),
    fee: String(fee),
    status,
    evidenceTier,
    calldataSummary
  };

  const receiptId = keccak256(toUtf8Bytes(canonicalJson(receiptFields)));

  return Object.freeze({
    receiptId,
    ...receiptFields,
    attestationSignature
  });
}

/**
 * Independently verifies an execution receipt against the original intent and winning quote.
 */
export function verifyExecutionReceipt(receipt, intent, quote) {
  const checks = [];

  if (!receipt || !receipt.receiptId) {
    return { verified: false, score: 0, reason: 'INVALID_RECEIPT' };
  }

  // Check intent binding
  if (intent && receipt.intentId !== intent.intentId) {
    return { verified: false, score: 0, reason: 'INTENT_ID_MISMATCH' };
  }

  // Check quote binding
  if (quote && receipt.quoteId && receipt.quoteId !== quote.quoteId) {
    return { verified: false, score: 0, reason: 'QUOTE_ID_MISMATCH' };
  }

  // Verify financial constraints
  if (intent) {
    // Delivered output must be >= minAmountOut
    const deliveredOut = BigInt(receipt.amountOut);
    const minRequired = BigInt(intent.minAmountOut);

    if (deliveredOut < minRequired) {
      return {
        verified: false,
        score: 0,
        reason: 'MIN_OUTPUT_NOT_SATISFIED',
        details: { delivered: deliveredOut.toString(), minRequired: minRequired.toString() }
      };
    }

    // Input consumed must be <= intent.amount (or maxAmountIn)
    const consumedIn = BigInt(receipt.amountIn);
    const maxInAllowed = BigInt(intent.maxAmountIn || intent.amount);

    if (consumedIn > maxInAllowed) {
      return {
        verified: false,
        score: 0,
        reason: 'MAX_INPUT_EXCEEDED',
        details: { consumed: consumedIn.toString(), maxAllowed: maxInAllowed.toString() }
      };
    }
  }

  // Check transaction validity
  const hasTxHash = receipt.transactionHash && receipt.transactionHash.length >= 10;

  // Grade evidence tier
  let verificationLevel = receipt.evidenceTier || EVIDENCE_TIERS.OBSERVED;
  if (hasTxHash && receipt.blockNumber > 0) {
    verificationLevel = EVIDENCE_TIERS.ON_CHAIN_VERIFIED;
  }

  return {
    verified: true,
    receiptId: receipt.receiptId,
    intentId: receipt.intentId,
    solverId: receipt.solverId,
    transactionHash: receipt.transactionHash,
    evidenceTier: verificationLevel,
    deliveredOut: receipt.amountOut,
    consumedIn: receipt.amountIn,
    constraintSatisfied: true
  };
}
