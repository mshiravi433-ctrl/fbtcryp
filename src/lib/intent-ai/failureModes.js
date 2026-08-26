/**
 * FBT INTENT AI — FAILURE MODES (fail-closed, translatable codes)
 * ---------------------------------------------------------------------------
 * Maps errors onto honest lifecycle outcomes. Never invents COMPLETED.
 */

export const FAILURE_CLASSES = Object.freeze([
  'RECOVERABLE',
  'FAILED',
  'EXPIRED',
  'CANCELLED',
  'PARTIAL_EXECUTION'
]);

export const CAUSE_CODES = Object.freeze({
  MISSING_DATA: { cls: 'FAILED', retry: false },
  GUARDIAN_REJECTED: { cls: 'FAILED', retry: false },
  RISK_BLOCKED: { cls: 'FAILED', retry: false },
  GATE_NOT_CONFIRMED: { cls: 'FAILED', retry: false },
  TERMS_CHANGED: { cls: 'FAILED', retry: false },
  SESSION_KEY_EXPIRED: { cls: 'EXPIRED', retry: false },
  SESSION_KEY_REVOKED: { cls: 'CANCELLED', retry: false },
  EMERGENCY_STOP: { cls: 'CANCELLED', retry: false },
  PROVIDER_TIMEOUT: { cls: 'RECOVERABLE', retry: true },
  PROVIDER_ERROR: { cls: 'RECOVERABLE', retry: true },
  SIMULATION_REVERT: { cls: 'FAILED', retry: false },
  SIMULATION_UNAVAILABLE: { cls: 'RECOVERABLE', retry: true },
  SUBMIT_REJECTED: { cls: 'FAILED', retry: false },
  SUBMIT_TIMEOUT: { cls: 'RECOVERABLE', retry: true },
  PARTIAL_FILL: { cls: 'PARTIAL_EXECUTION', retry: false },
  CONFIRMATION_TIMEOUT: { cls: 'RECOVERABLE', retry: true },
  ONCHAIN_REVERT: { cls: 'FAILED', retry: false },
  DEADLINE_PASSED: { cls: 'EXPIRED', retry: false },
  USER_CANCELLED: { cls: 'CANCELLED', retry: false },
  USER_REJECTED: { cls: 'CANCELLED', retry: false },
  UNKNOWN: { cls: 'FAILED', retry: false }
});

export function classifyFailure(code, extra = {}) {
  const key = String(code || 'UNKNOWN').toUpperCase().replace(/[^A-Z0-9_]/g, '_').slice(0, 48);
  const spec = CAUSE_CODES[key] || CAUSE_CODES.UNKNOWN;
  return {
    code: CAUSE_CODES[key] ? key : 'UNKNOWN',
    original: key,
    class: extra.class || spec.cls,
    retryable: extra.retryable != null ? Boolean(extra.retryable) : spec.retry,
    translatable: `intentAi.error.${CAUSE_CODES[key] ? key : 'UNKNOWN'}`,
    detail: extra.detail ? String(extra.detail).slice(0, 200) : null
  };
}

export function lifecycleStatusForFailure(classified) {
  switch (classified.class) {
    case 'RECOVERABLE': return 'RECOVERABLE';
    case 'EXPIRED': return 'EXPIRED';
    case 'CANCELLED': return 'CANCELLED';
    case 'PARTIAL_EXECUTION': return 'RECOVERABLE';
    case 'FAILED':
    default: return 'FAILED';
  }
}

export function isRetryable(classified) {
  return classified?.retryable === true && classified.class === 'RECOVERABLE';
}
