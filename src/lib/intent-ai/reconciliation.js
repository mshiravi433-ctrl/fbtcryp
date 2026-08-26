/**
 * Honest reconciliation: local lifecycle vs on-chain/broker truth.
 * Never fabricates COMPLETED / success.
 */
import { classifyFailure } from './failureModes.js';

export function reconcile({ lifecycleStatus, observation } = {}) {
  if (!observation || typeof observation !== 'object') {
    return {
      ok: false,
      receipt: honestReceipt({ status: 'UNKNOWN', confirmed: false }),
      error: classifyFailure('MISSING_DATA', { detail: 'NO_OBSERVATION' })
    };
  }
  if (observation.successClaim === true && observation.confirmed !== true) {
    return {
      ok: false,
      receipt: honestReceipt({
        status: 'UNCONFIRMED',
        confirmed: false,
        filledAmount: observation.filledAmount || 0
      }),
      error: classifyFailure('UNKNOWN', { detail: 'FABRICATED_SUCCESS_REFUSED' })
    };
  }
  const filled = Number(observation.filledAmount);
  const requested = Number(observation.requestedAmount);
  if (Number.isFinite(filled) && Number.isFinite(requested) && filled > 0 && filled < requested) {
    return {
      ok: true,
      partial: true,
      receipt: honestReceipt({
        status: 'PARTIAL_EXECUTION',
        confirmed: observation.confirmed === true,
        filledAmount: filled,
        requestedAmount: requested
      }),
      error: classifyFailure('PARTIAL_FILL')
    };
  }
  if (observation.confirmed === true && observation.reverted !== true) {
    return {
      ok: true,
      receipt: honestReceipt({
        status: 'COMPLETED',
        confirmed: true,
        filledAmount: Number.isFinite(filled) ? filled : requested,
        requestedAmount: requested
      })
    };
  }
  if (observation.reverted === true) {
    return {
      ok: false,
      receipt: honestReceipt({ status: 'FAILED', confirmed: true, filledAmount: 0 }),
      error: classifyFailure('ONCHAIN_REVERT')
    };
  }
  return {
    ok: true,
    pending: true,
    receipt: honestReceipt({
      status: lifecycleStatus || 'CONFIRMING',
      confirmed: false,
      filledAmount: Number.isFinite(filled) ? filled : 0
    })
  };
}

function honestReceipt(fields) {
  return Object.freeze({
    schema: 'fbt.execution-receipt.v1',
    fabricated: false,
    ...fields,
    issuedAt: Date.now()
  });
}
