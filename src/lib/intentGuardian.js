/* Deterministic pre-sign Guardian. It never signs, holds keys, or trusts an Agent. */
export const SENSITIVE_ACTIONS = Object.freeze(new Set([
  'swap', 'bridge', 'deposit', 'withdraw', 'send', 'lend', 'borrow', 'farm', 'futures', 'leverage', 'transfer'
]));

const finiteNonNegative = (value) => Number.isFinite(Number(value)) && Number(value) >= 0;

export function guardianReview(intent, policy = {}) {
  const failures = [];
  if (!intent || typeof intent !== 'object') failures.push('MISSING_INTENT');
  if (!finiteNonNegative(policy.maxCapitalUsd)) failures.push('INVALID_CAPITAL_LIMIT');
  if (!finiteNonNegative(policy.maxTransactionUsd)) failures.push('INVALID_TRANSACTION_LIMIT');
  if (!finiteNonNegative(policy.maxLossUsd)) failures.push('INVALID_LOSS_LIMIT');
  if (policy.autonomousExecution === true) failures.push('AUTONOMOUS_EXECUTION_DISABLED');
  if (policy.confirmationRequired !== true) failures.push('CONFIRMATION_REQUIRED');
  if (intent && finiteNonNegative(intent.amountUsd) && Number(intent.amountUsd) > Number(policy.maxCapitalUsd)) failures.push('CAPITAL_LIMIT');
  if (intent && finiteNonNegative(intent.amountUsd) && Number(intent.amountUsd) > Number(policy.maxTransactionUsd)) failures.push('TRANSACTION_LIMIT');
  return { ok: failures.length === 0, failures, sensitive: true, requiresConfirmation: true };
}

export function isSensitiveAction(action) {
  return SENSITIVE_ACTIONS.has(String(action || '').toLowerCase());
}
