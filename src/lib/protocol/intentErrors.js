/**
 * FBT INTENT PROTOCOL — DETERMINISTIC ERROR TAXONOMY
 * ---------------------------------------------------------------------------
 * Spec §20: Every failure must produce a machine-readable reason with code,
 * category, retryable status, user guidance, and technical details.
 */

export const ERROR_CATEGORIES = Object.freeze({
  VALIDATION: 'VALIDATION',
  AUTHORIZATION: 'AUTHORIZATION',
  AUCTION: 'AUCTION',
  EXECUTION: 'EXECUTION',
  SETTLEMENT: 'SETTLEMENT',
  NETWORK: 'NETWORK',
  SECURITY: 'SECURITY'
});

export const PROTOCOL_ERROR_CODES = Object.freeze({
  // Validation
  INVALID_SCHEMA: 'INVALID_SCHEMA',
  INVALID_AMOUNT: 'INVALID_AMOUNT',
  INVALID_DEADLINE: 'INVALID_DEADLINE',
  INVALID_CHAIN: 'INVALID_CHAIN',
  INVALID_ASSET: 'INVALID_ASSET',
  INVALID_RECIPIENT: 'INVALID_RECIPIENT',
  CONSTRAINTS_VIOLATED: 'CONSTRAINTS_VIOLATED',

  // Authorization & Replay
  SIGNATURE_INVALID: 'SIGNATURE_INVALID',
  SIGNATURE_EXPIRED: 'SIGNATURE_EXPIRED',
  NONCE_ALREADY_USED: 'NONCE_ALREADY_USED',
  NONCE_INVALID: 'NONCE_INVALID',
  INTENT_ALREADY_CANCELLED: 'INTENT_ALREADY_CANCELLED',
  INTENT_EXPIRED: 'INTENT_EXPIRED',
  UNAUTHORIZED_USER: 'UNAUTHORIZED_USER',
  USER_CONSTRAINTS_MODIFIED: 'USER_CONSTRAINTS_MODIFIED',

  // Auction & Solvers
  NO_ACTIVE_SOLVERS: 'NO_ACTIVE_SOLVERS',
  NO_VALID_QUOTES: 'NO_VALID_QUOTES',
  SOLVER_TIMEOUT: 'SOLVER_TIMEOUT',
  SOLVER_NOT_REGISTERED: 'SOLVER_NOT_REGISTERED',
  SOLVER_SUSPENDED: 'SOLVER_SUSPENDED',
  SOLVER_CAPABILITY_MISMATCH: 'SOLVER_CAPABILITY_MISMATCH',
  QUOTE_EXPIRED: 'QUOTE_EXPIRED',
  QUOTE_COMMITMENT_MISMATCH: 'QUOTE_COMMITMENT_MISMATCH',
  QUOTE_SLIPPAGE_TOO_HIGH: 'QUOTE_SLIPPAGE_TOO_HIGH',
  QUOTE_FEE_TOO_HIGH: 'QUOTE_FEE_TOO_HIGH',

  // Execution
  INSUFFICIENT_LIQUIDITY: 'INSUFFICIENT_LIQUIDITY',
  SIMULATION_FAILED: 'SIMULATION_FAILED',
  TRANSACTION_REVERTED: 'TRANSACTION_REVERTED',
  TRANSACTION_DROPPED: 'TRANSACTION_DROPPED',
  EXECUTION_TIMEOUT: 'EXECUTION_TIMEOUT',
  PARTIAL_FILL_NOT_ALLOWED: 'PARTIAL_FILL_NOT_ALLOWED',

  // Settlement & Verification
  SETTLEMENT_DEFICIT: 'SETTLEMENT_DEFICIT',
  MIN_AMOUNT_OUT_BREACH: 'MIN_AMOUNT_OUT_BREACH',
  PROOF_VERIFICATION_FAILED: 'PROOF_VERIFICATION_FAILED',
  MERKLE_ROOT_MISMATCH: 'MERKLE_ROOT_MISMATCH',
  SETTLEMENT_CONTRACT_REVERT: 'SETTLEMENT_CONTRACT_REVERT',

  // Network & Infra
  RPC_ERROR: 'RPC_ERROR',
  CHAIN_REORG_DETECTED: 'CHAIN_REORG_DETECTED',
  BRIDGE_UNAVAILABLE: 'BRIDGE_UNAVAILABLE',
  BRIDGE_TIMEOUT: 'BRIDGE_TIMEOUT',
  RATE_LIMITED: 'RATE_LIMITED'
});

export class IntentError extends Error {
  constructor({
    code,
    category = ERROR_CATEGORIES.EXECUTION,
    intentId = null,
    solverId = null,
    chainId = null,
    retryable = false,
    userAction = 'Please try again or review your parameters.',
    technicalDetails = null,
    cause = null
  }) {
    const fullMsg = technicalDetails ? `[${code}] ${userAction} (${technicalDetails})` : `[${code}] ${userAction}`;
    super(fullMsg);
    this.name = 'IntentError';
    this.code = code;
    this.category = category;
    this.intentId = intentId;
    this.solverId = solverId;
    this.chainId = chainId;
    this.retryable = Boolean(retryable);
    this.userAction = userAction;
    this.technicalDetails = technicalDetails;
    if (cause) this.cause = cause;
  }

  toJSON() {
    return {
      name: this.name,
      code: this.code,
      category: this.category,
      intentId: this.intentId,
      solverId: this.solverId,
      chainId: this.chainId,
      retryable: this.retryable,
      userAction: this.userAction,
      technicalDetails: this.technicalDetails,
      message: this.message
    };
  }
}

export function createIntentError(code, overrides = {}) {
  const defaults = {
    [PROTOCOL_ERROR_CODES.INVALID_SCHEMA]: {
      category: ERROR_CATEGORIES.VALIDATION,
      retryable: false,
      userAction: 'The intent parameters do not match the canonical protocol schema.'
    },
    [PROTOCOL_ERROR_CODES.INVALID_DEADLINE]: {
      category: ERROR_CATEGORIES.VALIDATION,
      retryable: false,
      userAction: 'The execution deadline must be in the future.'
    },
    [PROTOCOL_ERROR_CODES.INTENT_EXPIRED]: {
      category: ERROR_CATEGORIES.AUTHORIZATION,
      retryable: true,
      userAction: 'This intent has passed its execution deadline. Create a new intent to continue.'
    },
    [PROTOCOL_ERROR_CODES.NONCE_ALREADY_USED]: {
      category: ERROR_CATEGORIES.AUTHORIZATION,
      retryable: false,
      userAction: 'This authorization nonce was already spent. Replay attacks are prohibited.'
    },
    [PROTOCOL_ERROR_CODES.SIGNATURE_INVALID]: {
      category: ERROR_CATEGORIES.AUTHORIZATION,
      retryable: true,
      userAction: 'The cryptographic signature could not be verified against the user address.'
    },
    [PROTOCOL_ERROR_CODES.USER_CONSTRAINTS_MODIFIED]: {
      category: ERROR_CATEGORIES.SECURITY,
      retryable: false,
      userAction: 'Security stop: signed user constraints cannot be modified by any solver or relayer.'
    },
    [PROTOCOL_ERROR_CODES.NO_VALID_QUOTES]: {
      category: ERROR_CATEGORIES.AUCTION,
      retryable: true,
      userAction: 'No solver could satisfy your minimum output and fee limits. Consider adjusting slippage.'
    },
    [PROTOCOL_ERROR_CODES.MIN_AMOUNT_OUT_BREACH]: {
      category: ERROR_CATEGORIES.SETTLEMENT,
      retryable: false,
      userAction: 'Settlement stopped: executed output is below the signed guaranteed minimum.'
    },
    [PROTOCOL_ERROR_CODES.RPC_ERROR]: {
      category: ERROR_CATEGORIES.NETWORK,
      retryable: true,
      userAction: 'Network RPC endpoint temporarily unresponsive. Reconnecting…'
    }
  };

  const base = defaults[code] || {
    category: ERROR_CATEGORIES.EXECUTION,
    retryable: false,
    userAction: 'An error occurred processing the intent.'
  };

  return new IntentError({
    code,
    ...base,
    ...overrides
  });
}
