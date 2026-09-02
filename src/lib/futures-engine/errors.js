/**
 * FBT FUTURES — error taxonomy (spec §23).
 * ---------------------------------------------------------------------------
 * Every failure the engine can surface has a stable code, a retryable flag
 * and a recovery hint. Raw wallet / RPC / provider messages are mapped here so
 * the UI shows a translated sentence (t(`futures.err.${code}`)), never a hex
 * revert string. Security-class errors are terminal: the caller must STOP.
 */

export const FUTURES_ERRORS = Object.freeze({
  WALLET_NOT_CONNECTED: { retryable: true, recovery: 'CONNECT_WALLET', security: false },
  WRONG_NETWORK: { retryable: true, recovery: 'SWITCH_NETWORK', security: false },
  INSUFFICIENT_BALANCE: { retryable: false, recovery: 'FUND_WALLET', security: false },
  INSUFFICIENT_ALLOWANCE: { retryable: true, recovery: 'APPROVE', security: false },
  NO_GAS: { retryable: false, recovery: 'FUND_GAS', security: false },
  USER_REJECTED: { retryable: false, recovery: 'NONE', security: false },
  BELOW_MIN: { retryable: false, recovery: 'ADJUST_INPUT', security: false },
  LEVERAGE_TOO_HIGH: { retryable: false, recovery: 'ADJUST_INPUT', security: false },
  MARKET_CLOSED: { retryable: true, recovery: 'WAIT', security: false },
  MARKET_NOT_LISTED: { retryable: false, recovery: 'CHOOSE_MARKET', security: false },
  PROVIDER_UNAVAILABLE: { retryable: true, recovery: 'RETRY_LATER', security: false },
  PROVIDER_READ_ONLY: { retryable: false, recovery: 'NONE', security: false },
  PROVIDER_MAINTENANCE: { retryable: true, recovery: 'RETRY_LATER', security: false },
  PROVIDER_BLOCKED: { retryable: false, recovery: 'NONE', security: true },
  FEED_STALE: { retryable: true, recovery: 'REFRESH', security: false },
  QUOTE_EXPIRED: { retryable: true, recovery: 'REQUOTE', security: false },
  QUOTE_MISMATCH: { retryable: true, recovery: 'REQUOTE', security: true },
  RISK_BLOCKED: { retryable: false, recovery: 'ADJUST_INPUT', security: false },
  SIMULATION_FAILED: { retryable: true, recovery: 'RETRY', security: false },
  GAS_ESTIMATION_FAILED: { retryable: true, recovery: 'RETRY', security: false },
  TRANSACTION_REVERTED: { retryable: false, recovery: 'VERIFY', security: false },
  TRANSACTION_PENDING: { retryable: true, recovery: 'VERIFY', security: false },
  TRANSACTION_DROPPED: { retryable: true, recovery: 'RETRY', security: false },
  TIMEOUT: { retryable: true, recovery: 'VERIFY', security: false },
  IDEMPOTENCY_CONFLICT: { retryable: false, recovery: 'NONE', security: false },
  IDEMPOTENCY_KEY_REQUIRED: { retryable: false, recovery: 'NONE', security: false },
  INVALID_INPUT: { retryable: false, recovery: 'ADJUST_INPUT', security: false },
  CONTRACT_MISMATCH: { retryable: false, recovery: 'NONE', security: true },
  RATE_LIMITED: { retryable: true, recovery: 'RETRY_LATER', security: false },
  POSITION_NOT_FOUND: { retryable: true, recovery: 'REFRESH', security: false },
  NOT_CONFIGURED: { retryable: false, recovery: 'NONE', security: false },
  UNKNOWN: { retryable: true, recovery: 'RETRY', security: false }
});

export const FUTURES_ERROR_CODES = Object.freeze(Object.keys(FUTURES_ERRORS));

const RULES = [
  [/user rejected|user denied|rejected the request|denied transaction|cancelled/i, 'USER_REJECTED'],
  [/^4001$|action_rejected/i, 'USER_REJECTED'],
  [/insufficient funds for gas|insufficient funds/i, 'NO_GAS'],
  [/insufficient balance|transfer amount exceeds balance/i, 'INSUFFICIENT_BALANCE'],
  [/allowance|insufficient allowance|erc20: transfer amount exceeds allowance/i, 'INSUFFICIENT_ALLOWANCE'],
  [/wrong[_ ]chain|wrong network|unsupported chain|chain mismatch/i, 'WRONG_NETWORK'],
  [/market[_ ]closed|market is closed/i, 'MARKET_CLOSED'],
  [/below[_ ]min|too small|min position/i, 'BELOW_MIN'],
  [/leverage/i, 'LEVERAGE_TOO_HIGH'],
  [/nonce too low|replacement transaction underpriced/i, 'TRANSACTION_DROPPED'],
  [/execution reverted|revert/i, 'TRANSACTION_REVERTED'],
  [/cannot estimate gas|gas required exceeds|estimateGas|unpredictable_gas_limit/i, 'GAS_ESTIMATION_FAILED'],
  [/timeout|timed out|aborted/i, 'TIMEOUT'],
  [/429|rate limit/i, 'RATE_LIMITED'],
  [/http_5\d\d|upstream|unavailable|econnrefused|fetch failed/i, 'PROVIDER_UNAVAILABLE']
];

/** Map any thrown thing to a stable code. Never leaks hex payloads. */
export function mapFuturesError(err) {
  const code = String(err?.code || '');
  if (FUTURES_ERRORS[code]) return { code, ...FUTURES_ERRORS[code] };
  const msg = String(err?.shortMessage || err?.reason || err?.message || err || '');
  if (FUTURES_ERRORS[msg]) return { code: msg, ...FUTURES_ERRORS[msg] };
  if (code === '4001' || code === 'ACTION_REJECTED') return { code: 'USER_REJECTED', ...FUTURES_ERRORS.USER_REJECTED };
  for (const [re, mapped] of RULES) {
    if (re.test(msg) || re.test(code)) return { code: mapped, ...FUTURES_ERRORS[mapped] };
  }
  return { code: 'UNKNOWN', ...FUTURES_ERRORS.UNKNOWN, rawSanitized: msg.replace(/0x[0-9a-fA-F]{8,}/g, '0x…').slice(0, 120) };
}

export const isFuturesSecurityStop = (code) => Boolean(FUTURES_ERRORS[code]?.security);
export const isFuturesRetryable = (code) => Boolean(FUTURES_ERRORS[code]?.retryable);
