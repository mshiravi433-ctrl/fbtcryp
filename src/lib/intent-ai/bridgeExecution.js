/**
 * FBT INTENT AI — PHASE 54: BRIDGE EXECUTION
 * ---------------------------------------------------------------------------
 * A swap route is not a cross-chain route. The repo has always QUOTED bridges
 * honestly and refused to pretend it could execute them
 * (`BRIDGE_EXECUTE_UNAVAILABLE`). This module is the real adapter seam:
 *
 *   · `BRIDGE_EXECUTE_UNAVAILABLE` disappears ONLY when a real bridge adapter
 *     with an `execute` function is actually attached to the runtime.
 *   · A bridge NEVER runs on the swap step's approval. It requires its own
 *     explicit approval, bound to the bridge terms hash.
 *   · Destination-side delivery is reported honestly: `submitted` on the
 *     source chain is not `completed` on the destination chain.
 */

import { classifyFailure } from './failureModes.js';
import { normalizeTxHash } from './broadcastAdapter.js';

export const BRIDGE_EXECUTION_SCHEMA = 'fbt.bridge-execution.v1';

/** A bridge adapter is only "wired" when it can actually execute. */
export function bridgeWired(ctx = {}) {
  return typeof ctx?.bridgeAdapter?.execute === 'function';
}

/** Honest health for the bridge venue. */
export function bridgeHealth(ctx = {}) {
  const reasons = [];
  if (!bridgeWired(ctx)) reasons.push('BRIDGE_EXECUTE_UNAVAILABLE');
  if (bridgeWired(ctx) && !ctx.provider) reasons.push('NO_PROVIDER');
  if (bridgeWired(ctx) && !ctx.signer) reasons.push('NO_SIGNER');
  return {
    ok: reasons.length === 0,
    wired: bridgeWired(ctx),
    status: reasons.length === 0 ? 'configured' : 'unavailable',
    reasons,
    error: reasons.length === 0 ? null : classifyFailure('MISSING_DATA', { detail: reasons.join(',') })
  };
}

/**
 * A bridge approval is separate, explicit and bound to the bridge terms.
 * Reusing the swap step's approval is refused.
 */
export function assertBridgeApproval({ approval, termsHash } = {}) {
  if (!approval || typeof approval !== 'object') {
    return { ok: false, error: classifyFailure('USER_AUTHORIZATION_REQUIRED', { detail: 'BRIDGE_APPROVAL_REQUIRED' }) };
  }
  if (approval.scope !== 'bridge') {
    return { ok: false, error: classifyFailure('USER_AUTHORIZATION_REQUIRED', { detail: 'BRIDGE_APPROVAL_SCOPE' }) };
  }
  if (approval.confirmed !== true) {
    return { ok: false, error: classifyFailure('USER_AUTHORIZATION_REQUIRED', { detail: 'BRIDGE_APPROVAL_REQUIRED' }) };
  }
  if (termsHash && approval.termsHash && approval.termsHash !== termsHash) {
    return { ok: false, error: classifyFailure('TERMS_CHANGED', { detail: 'BRIDGE_TERMS_CHANGED' }) };
  }
  return { ok: true };
}

/**
 * Execute a bridge through a real adapter.
 * @param {object} draft    { fromChainId, toChainId, fromSymbol, toSymbol, amountIn }
 * @param {object} ctx      { bridgeAdapter, provider, signer }
 * @param {object} approval the SEPARATE bridge approval
 */
export async function executeBridge({ draft = {}, ctx = {}, approval = null, termsHash = null } = {}) {
  const health = bridgeHealth(ctx);
  if (!health.ok) {
    return { ok: false, status: 'unavailable', reasons: health.reasons, error: health.error };
  }
  const approved = assertBridgeApproval({ approval, termsHash });
  if (!approved.ok) return { ok: false, status: 'unavailable', error: approved.error };

  let raw = null;
  try {
    raw = await ctx.bridgeAdapter.execute({
      fromChainId: Number(draft.fromChainId ?? draft.chainId) || null,
      toChainId: Number(draft.toChainId ?? draft.destinationChainId) || null,
      fromSymbol: draft.fromSymbol || null,
      toSymbol: draft.toSymbol || null,
      amountIn: draft.amountIn ?? draft.amountUsd ?? null,
      recipient: draft.recipient || null
    });
  } catch (err) {
    return { ok: false, status: 'failed', error: classifyFailure('SUBMIT_REJECTED', { detail: String(err?.message || err).slice(0, 120) }) };
  }
  const sourceTxHash = normalizeTxHash(raw?.sourceTxHash ?? raw?.txHash ?? raw);
  if (!sourceTxHash) {
    return { ok: false, status: 'failed', error: classifyFailure('SUBMIT_REJECTED', { detail: 'NO_SOURCE_TX_HASH' }) };
  }
  return {
    ok: true,
    schema: BRIDGE_EXECUTION_SCHEMA,
    // Source-chain submission is NOT destination-chain delivery.
    status: 'submitted',
    submitted: true,
    confirmed: false,
    delivered: false,
    sourceTxHash,
    receiptRef: sourceTxHash,
    trackingId: typeof raw?.trackingId === 'string' ? raw.trackingId.slice(0, 80) : null,
    fabricated: false
  };
}

/**
 * Destination-side truth. Delivery is only claimed when the adapter reports a
 * destination transaction; anything else stays `submitted`.
 */
export async function trackBridgeDelivery({ execution, ctx = {} } = {}) {
  if (!execution?.sourceTxHash) {
    return { ok: false, status: 'unavailable', error: classifyFailure('MISSING_DATA', { detail: 'NO_BRIDGE_EXECUTION' }) };
  }
  if (typeof ctx?.bridgeAdapter?.status !== 'function') {
    return { ok: false, status: 'submitted', delivered: false, error: classifyFailure('MISSING_DATA', { detail: 'NO_BRIDGE_STATUS_SOURCE' }) };
  }
  let raw = null;
  try {
    raw = await ctx.bridgeAdapter.status({ sourceTxHash: execution.sourceTxHash, trackingId: execution.trackingId });
  } catch (err) {
    return { ok: false, status: 'submitted', delivered: false, error: classifyFailure('PROVIDER_ERROR', { detail: String(err?.message || err).slice(0, 120) }) };
  }
  const destinationTxHash = normalizeTxHash(raw?.destinationTxHash);
  const failed = raw?.status === 'failed' || raw?.reverted === true;
  if (failed) {
    return { ok: false, status: 'failed', delivered: false, error: classifyFailure('ONCHAIN_REVERT', { detail: 'BRIDGE_FAILED' }) };
  }
  if (!destinationTxHash) {
    return { ok: true, status: 'submitted', delivered: false, sourceTxHash: execution.sourceTxHash };
  }
  return {
    ok: true,
    status: 'confirmed',
    delivered: true,
    sourceTxHash: execution.sourceTxHash,
    destinationTxHash,
    observation: { confirmed: true, confirmations: 1, reverted: false, terminal: true, txHash: destinationTxHash }
  };
}
