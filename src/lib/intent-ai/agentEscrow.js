/**
 * FBT INTENT AI — PHASE 70: AGENT PAYMENT RAIL WITH ESCROW
 * ---------------------------------------------------------------------------
 * An agent's quote is not a payment. Money for agent work sits in escrow and
 * is released only against PROVABLE delivery — a receipt the buyer did not
 * write, matching the deliverable that was agreed.
 *
 *   · funding is explicit and user-confirmed; nothing is escrowed silently
 *   · release requires evidence: a delivery receipt whose hash matches the
 *     agreed deliverable. Self-reported "done" releases nothing.
 *   · a dispute inside the window refunds the buyer. The default direction of
 *     an unresolved dispute is REFUND, never release.
 *   · an escrow that expires undelivered refunds automatically
 *   · the ledger always balances: funded = released + refunded + held
 */

import { classifyFailure } from './failureModes.js';
import { digest } from './onchainReceipt.js';

export const ESCROW_SCHEMA = 'fbt.agent-escrow.v1';
export const ESCROW_STATES = Object.freeze(['funded', 'delivered', 'released', 'disputed', 'refunded', 'expired']);
export const DELIVERY_WINDOW_MS = 24 * 60 * 60 * 1000;
export const DISPUTE_WINDOW_MS = 72 * 60 * 60 * 1000;
export const MAX_ESCROW_USD = 10_000;

const num = (v) => (v === null || v === undefined || v === '' || typeof v === 'boolean'
  ? null
  : (Number.isFinite(Number(v)) ? Number(v) : null));

/** Lock the fee. The user confirms; the agent cannot fund on their behalf. */
export function openEscrow({
  jobId = null, buyerId = null, agentId = null, amountUsd = null,
  deliverable = null, userConfirmed = false, now = Date.now()
} = {}) {
  const amount = num(amountUsd);
  const reasons = [];
  if (!jobId || !buyerId || !agentId) reasons.push('MISSING_PARTIES');
  if (amount === null || amount <= 0) reasons.push('NO_AMOUNT');
  if (amount !== null && amount > MAX_ESCROW_USD) reasons.push('ABOVE_ESCROW_CAP');
  if (!deliverable || typeof deliverable !== 'object') reasons.push('NO_DELIVERABLE');
  // The buyer funds escrow; nobody funds it for them.
  if (userConfirmed !== true) reasons.push('NOT_CONFIRMED_BY_USER');
  if (reasons.length) {
    return {
      ok: false, state: null, escrow: null, reasons,
      i18nKey: 'intentAI.escrow.notOpened',
      error: classifyFailure(reasons[0] === 'NOT_CONFIRMED_BY_USER' ? 'USER_AUTHORIZATION_REQUIRED' : 'MISSING_DATA', { detail: reasons[0] })
    };
  }
  return {
    ok: true,
    schema: ESCROW_SCHEMA,
    escrow: {
      jobId, buyerId, agentId,
      amountUsd: amount,
      heldUsd: amount,
      releasedUsd: 0,
      refundedUsd: 0,
      deliverableHash: digest(deliverable),
      state: 'funded',
      fundedAt: now,
      deliverBy: now + DELIVERY_WINDOW_MS,
      disputeBy: now + DELIVERY_WINDOW_MS + DISPUTE_WINDOW_MS
    },
    i18nKey: 'intentAI.escrow.funded',
    i18nParams: { amount }
  };
}

/** The agent claims delivery. A claim is not a release. */
export function submitDelivery(escrow, { deliverable = null, receipt = null, now = Date.now() } = {}) {
  if (escrow?.state !== 'funded') {
    return { ok: false, escrow, reason: 'NOT_FUNDED', error: classifyFailure('MISSING_DATA', { detail: 'ESCROW_NOT_FUNDED' }) };
  }
  if (now > num(escrow.deliverBy)) {
    return { ok: false, escrow, reason: 'DELIVERY_WINDOW_PASSED', i18nKey: 'intentAI.escrow.late', error: classifyFailure('DEADLINE_PASSED', { detail: 'DELIVERY_LATE' }) };
  }
  if (!deliverable || digest(deliverable) !== escrow.deliverableHash) {
    return { ok: false, escrow, reason: 'DELIVERABLE_MISMATCH', i18nKey: 'intentAI.escrow.mismatch', error: classifyFailure('TERMS_CHANGED', { detail: 'DELIVERABLE_MISMATCH' }) };
  }
  const proofOk = receipt?.verified === true && typeof receipt?.issuer === 'string' && receipt.issuer !== escrow.agentId;
  return {
    ok: true,
    escrow: { ...escrow, state: 'delivered', deliveredAt: now, deliveryProven: proofOk, deliveryIssuer: proofOk ? receipt.issuer : null },
    // Proven or not, the money has not moved yet.
    releasedUsd: 0,
    i18nKey: proofOk ? 'intentAI.escrow.delivered' : 'intentAI.escrow.deliveredUnproven'
  };
}

/** Release. Only against independent proof of delivery. */
export function releaseEscrow(escrow, { now = Date.now() } = {}) {
  const refuse = (reason, code = 'MISSING_DATA') => ({
    ok: false, released: false, escrow, reason,
    i18nKey: 'intentAI.escrow.notReleased',
    error: classifyFailure(code, { detail: reason })
  });
  if (!escrow || escrow.state === 'refunded' || escrow.state === 'released') return refuse('ESCROW_CLOSED');
  if (escrow.state === 'disputed') return refuse('UNDER_DISPUTE');
  if (escrow.state !== 'delivered') return refuse('NOTHING_DELIVERED');
  // Self-attested delivery never releases money.
  if (escrow.deliveryProven !== true) return refuse('DELIVERY_NOT_PROVEN');
  if (now > num(escrow.disputeBy) && escrow.state !== 'delivered') return refuse('WINDOW_PASSED', 'DEADLINE_PASSED');
  return {
    ok: true,
    released: true,
    escrow: { ...escrow, state: 'released', heldUsd: 0, releasedUsd: escrow.amountUsd, releasedAt: now },
    i18nKey: 'intentAI.escrow.released',
    i18nParams: { amount: escrow.amountUsd }
  };
}

/** A dispute freezes the money and defaults to the buyer. */
export function openDispute(escrow, { raisedBy = null, reason = null, now = Date.now() } = {}) {
  if (!escrow || ['released', 'refunded'].includes(escrow.state)) {
    return { ok: false, escrow, reason: 'ESCROW_CLOSED', error: classifyFailure('MISSING_DATA', { detail: 'ESCROW_CLOSED' }) };
  }
  if (now > num(escrow.disputeBy)) {
    return { ok: false, escrow, reason: 'DISPUTE_WINDOW_PASSED', error: classifyFailure('DEADLINE_PASSED', { detail: 'DISPUTE_LATE' }) };
  }
  if (raisedBy !== escrow.buyerId && raisedBy !== escrow.agentId) {
    return { ok: false, escrow, reason: 'NOT_A_PARTY', error: classifyFailure('GUARDIAN_REJECTED', { detail: 'NOT_A_PARTY' }) };
  }
  return {
    ok: true,
    escrow: { ...escrow, state: 'disputed', disputedAt: now, disputedBy: raisedBy, disputeReason: typeof reason === 'string' ? reason.slice(0, 256) : null },
    // Until somebody proves otherwise, the buyer gets their money back.
    defaultOutcome: 'REFUND_BUYER',
    i18nKey: 'intentAI.escrow.disputed'
  };
}

/** Resolve a dispute. Releasing to the agent needs proof; refunding does not. */
export function resolveDispute(escrow, { outcome = null, evidence = null, now = Date.now() } = {}) {
  if (escrow?.state !== 'disputed') {
    return { ok: false, escrow, reason: 'NOT_DISPUTED', error: classifyFailure('MISSING_DATA', { detail: 'NOT_DISPUTED' }) };
  }
  if (outcome === 'RELEASE_AGENT') {
    const proven = evidence?.verified === true && typeof evidence?.issuer === 'string' && evidence.issuer !== escrow.agentId;
    if (!proven) {
      // Cannot prove delivery in a dispute → the buyer is refunded.
      return {
        ok: true, escrow: { ...escrow, state: 'refunded', heldUsd: 0, refundedUsd: escrow.amountUsd, resolvedAt: now, resolution: 'REFUND_BUYER' },
        refunded: true, released: false, reason: 'EVIDENCE_INSUFFICIENT', i18nKey: 'intentAI.escrow.refunded'
      };
    }
    return {
      ok: true, escrow: { ...escrow, state: 'released', heldUsd: 0, releasedUsd: escrow.amountUsd, resolvedAt: now, resolution: 'RELEASE_AGENT' },
      released: true, refunded: false, i18nKey: 'intentAI.escrow.released', i18nParams: { amount: escrow.amountUsd }
    };
  }
  return {
    ok: true,
    escrow: { ...escrow, state: 'refunded', heldUsd: 0, refundedUsd: escrow.amountUsd, resolvedAt: now, resolution: 'REFUND_BUYER' },
    refunded: true, released: false,
    i18nKey: 'intentAI.escrow.refunded', i18nParams: { amount: escrow.amountUsd }
  };
}

/** Nobody delivered, nobody disputed: the buyer gets the money back. */
export function expireEscrow(escrow, { now = Date.now() } = {}) {
  if (!escrow || ['released', 'refunded'].includes(escrow.state)) {
    return { ok: false, escrow, reason: 'ESCROW_CLOSED' };
  }
  if (now <= num(escrow.deliverBy)) {
    return { ok: false, escrow, reason: 'STILL_IN_WINDOW' };
  }
  if (escrow.state === 'delivered' && now <= num(escrow.disputeBy)) {
    return { ok: false, escrow, reason: 'AWAITING_RELEASE' };
  }
  return {
    ok: true,
    escrow: { ...escrow, state: escrow.state === 'delivered' ? 'expired' : 'refunded', heldUsd: 0, refundedUsd: escrow.amountUsd, resolvedAt: now, resolution: 'REFUND_BUYER' },
    refunded: true,
    i18nKey: 'intentAI.escrow.refunded', i18nParams: { amount: escrow.amountUsd }
  };
}

/** The books must balance, and money must never leave without proof. */
export function assertEscrowSound(escrow) {
  const reasons = [];
  if (!escrow || typeof escrow !== 'object') reasons.push('NOT_AN_ESCROW');
  const amount = num(escrow?.amountUsd) ?? 0;
  const held = num(escrow?.heldUsd) ?? 0;
  const released = num(escrow?.releasedUsd) ?? 0;
  const refunded = num(escrow?.refundedUsd) ?? 0;
  if (Math.abs(amount - (held + released + refunded)) > 1e-9) reasons.push('LEDGER_DOES_NOT_BALANCE');
  if (released > 0 && escrow?.deliveryProven !== true && escrow?.resolution !== 'RELEASE_AGENT') reasons.push('RELEASED_WITHOUT_PROOF');
  if (released > 0 && refunded > 0) reasons.push('PAID_TWICE');
  if (escrow && !ESCROW_STATES.includes(escrow.state)) reasons.push('UNKNOWN_STATE');
  const unique = [...new Set(reasons)];
  return unique.length
    ? { ok: false, reasons: unique, error: classifyFailure('MISSING_DATA', { detail: unique[0] }) }
    : { ok: true, balanced: true };
}
