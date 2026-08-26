/**
 * Least-privilege broker / custodial / sub-account adapter.
 * Agent never receives raw credentials. Fail-closed. Idempotent.
 */
import { classifyFailure } from './failureModes.js';
import { hasSecret, putSecret } from './secureMemoryMap.js';

const IDEMPOTENT = new Map();

const FORBIDDEN_OPS = new Set(['withdraw', 'transfer', 'change_destination', 'payout']);

export function bindBrokerHandle(handle, meta = {}) {
  putSecret(handle, { kind: 'broker', ...meta });
  return { ok: true, handle };
}

export function brokerSubmit({
  draftOrder,
  handle,
  op = 'place',
  idempotencyKey,
  extraPolicy = false
} = {}) {
  if (!draftOrder) return { ok: false, error: classifyFailure('MISSING_DATA', { detail: 'NO_DRAFT' }) };
  if (!handle || !hasSecret(handle)) {
    return { ok: false, error: classifyFailure('MISSING_DATA', { detail: 'NO_BROKER_HANDLE' }) };
  }
  if (!idempotencyKey) {
    return { ok: false, error: classifyFailure('MISSING_DATA', { detail: 'NO_IDEMPOTENCY_KEY' }) };
  }
  if (FORBIDDEN_OPS.has(String(op).toLowerCase()) && extraPolicy !== true) {
    return { ok: false, error: classifyFailure('GUARDIAN_REJECTED', { detail: 'SEPARATE_POLICY_REQUIRED' }) };
  }
  if (IDEMPOTENT.has(idempotencyKey)) {
    return { ok: true, idempotent: true, receiptRef: IDEMPOTENT.get(idempotencyKey) };
  }
  const receiptRef = `brk_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  IDEMPOTENT.set(idempotencyKey, receiptRef);
  return {
    ok: true,
    submitted: true,
    receiptRef,
    status: 'SUBMITTED',
    confirmed: false
  };
}

export function _resetBrokerIdempotency() {
  IDEMPOTENT.clear();
}
