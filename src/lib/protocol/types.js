/**
 * FBT INTENT PROTOCOL V1 — CORE TYPES & SPECIFICATION CONSTANTS
 * ---------------------------------------------------------------------------
 * Canonical protocol definitions for non-custodial, cryptographically verifiable
 * intent architecture.
 */

export const PROTOCOL_VERSION = '1.0.0';
export const PROTOCOL_NAME = 'FBT Intent Protocol';
export const INTENT_SCHEMA_VERSION = 'fbt.intent.v2';
export const SOLVER_SCHEMA_VERSION = 'fbt.solver.v2';
export const QUOTE_SCHEMA_VERSION = 'fbt.solver-quote.v2';
export const RECEIPT_SCHEMA_VERSION = 'fbt.execution-receipt.v2';
export const SETTLEMENT_SCHEMA_VERSION = 'fbt.settlement.v2';

/**
 * 11-stage canonical lifecycle state machine:
 * CREATED -> SIGNED -> VALIDATED -> SUBMITTED -> OPEN -> QUOTING -> COMMITTED -> EXECUTING -> SETTLING -> VERIFIED -> COMPLETED
 */
export const LIFECYCLE_STAGES = Object.freeze([
  'CREATED',
  'SIGNED',
  'VALIDATED',
  'SUBMITTED',
  'OPEN',
  'QUOTING',
  'COMMITTED',
  'EXECUTING',
  'SETTLING',
  'VERIFIED',
  'COMPLETED'
]);

/**
 * Deterministic failure and terminal edge statuses.
 */
export const TERMINAL_STATUSES = Object.freeze([
  'COMPLETED',
  'INVALID',
  'EXPIRED',
  'CANCELLED',
  'REJECTED',
  'FAILED',
  'TIMEOUT'
]);

export const ALL_INTENT_STATUSES = Object.freeze([
  ...LIFECYCLE_STAGES,
  'INVALID',
  'EXPIRED',
  'CANCELLED',
  'REJECTED',
  'FAILED',
  'TIMEOUT',
  'PARTIALLY_FILLED',
  'DISPUTED'
]);

/**
 * Supported chain IDs (EVM integers + Solana chain ID string/number 501 / 1399811149).
 */
export const PROTOCOL_CHAINS = Object.freeze({
  ETHEREUM: 1,
  OPTIMISM: 10,
  BNB: 56,
  POLYGON: 137,
  SONIC: 146,
  BASE: 8453,
  ARBITRUM: 42161,
  AVALANCHE: 43114,
  LINEA: 59144,
  SOLANA: 501,
  SOLANA_DEVNET: 502
});

/**
 * EIP-712 Domain Separator constants for EVM on-chain verification.
 */
export const EIP712_DOMAIN_NAME = 'FBT Intent Protocol';
export const EIP712_DOMAIN_VERSION = '1';

export const EIP712_TYPES = Object.freeze({
  EIP712Domain: [
    { name: 'name', type: 'string' },
    { name: 'version', type: 'string' },
    { name: 'chainId', type: 'uint256' },
    { name: 'verifyingContract', type: 'address' }
  ],
  FBTIntent: [
    { name: 'version', type: 'string' },
    { name: 'user', type: 'address' },
    { name: 'sourceChainId', type: 'uint256' },
    { name: 'destinationChainId', type: 'uint256' },
    { name: 'sourceAsset', type: 'address' },
    { name: 'destinationAsset', type: 'address' },
    { name: 'amount', type: 'uint256' },
    { name: 'minAmountOut', type: 'uint256' },
    { name: 'maxFee', type: 'uint256' },
    { name: 'deadline', type: 'uint256' },
    { name: 'nonce', type: 'uint256' },
    { name: 'constraintsHash', type: 'bytes32' }
  ],
  SolverQuote: [
    { name: 'intentId', type: 'bytes32' },
    { name: 'solverId', type: 'string' },
    { name: 'amountIn', type: 'uint256' },
    { name: 'amountOut', type: 'uint256' },
    { name: 'fee', type: 'uint256' },
    { name: 'executionDeadline', type: 'uint256' },
    { name: 'nonce', type: 'uint256' },
    { name: 'routeHash', type: 'bytes32' }
  ]
});

/**
 * Four-tier evidence taxonomy for Proof-of-Execution.
 */
export const EVIDENCE_TIERS = Object.freeze({
  OBSERVED: 'OBSERVED',
  OPERATOR_REPORTED: 'OPERATOR_REPORTED',
  CRYPTOGRAPHICALLY_VERIFIED: 'CRYPTOGRAPHICALLY_VERIFIED',
  ON_CHAIN_VERIFIED: 'ON_CHAIN_VERIFIED'
});

/**
 * Solver competition policies.
 */
export const AUCTION_POLICIES = Object.freeze({
  MAX_OUTPUT: 'MAX_OUTPUT',
  LOWEST_FEE: 'LOWEST_FEE',
  FASTEST_EXECUTION: 'FASTEST_EXECUTION',
  REPUTATION_WEIGHTED: 'REPUTATION_WEIGHTED',
  MEV_PROTECTED: 'MEV_PROTECTED'
});
