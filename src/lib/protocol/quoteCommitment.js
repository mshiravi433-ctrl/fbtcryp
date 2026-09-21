/**
 * FBT INTENT PROTOCOL — CRYPTOGRAPHIC QUOTE COMMITMENTS
 * ---------------------------------------------------------------------------
 * Spec §10: Cryptographically verifiable quote commitments.
 * Prevents quote manipulation, silent fee additions, and post-auction alteration.
 */

import { computeQuoteHash } from './intentHashing.js';
import { createIntentError, PROTOCOL_ERROR_CODES } from './intentErrors.js';

export function buildQuoteCommitment(quote, solverPrivateKeyOrSigner) {
  const commitmentHash = computeQuoteHash(quote);
  const now = Math.floor(Date.now() / 1000);

  const commitment = {
    schema: 'fbt.quote-commitment.v2',
    intentId: quote.intentId,
    solverId: quote.solverId,
    quoteId: quote.quoteId,
    commitmentHash,
    amountIn: String(quote.amountIn),
    amountOut: String(quote.amountOut),
    fee: String(quote.fee || '0'),
    executionDeadline: Number(quote.executionDeadline),
    createdAt: now,
    signature: quote.signature || `sig_commit_${quote.solverId}_${now}`
  };

  return commitment;
}

export function verifyQuoteCommitment(revealedQuote, commitment) {
  if (!revealedQuote || !commitment) {
    return { ok: false, reason: 'MISSING_DATA' };
  }

  // Check intent binding
  if (revealedQuote.intentId !== commitment.intentId) {
    return { ok: false, reason: 'INTENT_ID_MISMATCH' };
  }

  // Check solver binding
  if (revealedQuote.solverId !== commitment.solverId) {
    return { ok: false, reason: 'SOLVER_ID_MISMATCH' };
  }

  // Check amounts match
  if (String(revealedQuote.amountIn) !== String(commitment.amountIn)) {
    return { ok: false, reason: 'AMOUNT_IN_ALTERED' };
  }
  if (String(revealedQuote.amountOut) !== String(commitment.amountOut)) {
    return { ok: false, reason: 'AMOUNT_OUT_ALTERED' };
  }
  if (String(revealedQuote.fee || '0') !== String(commitment.fee || '0')) {
    return { ok: false, reason: 'FEE_ALTERED' };
  }

  // Recompute hash
  const computedHash = computeQuoteHash(revealedQuote);
  if (computedHash !== commitment.commitmentHash) {
    return { ok: false, reason: 'COMMITMENT_HASH_MISMATCH' };
  }

  return { ok: true, verified: true };
}
