/**
 * FBT CENTRAL INTELLIGENCE OS — shared constants.
 * ---------------------------------------------------------------------------
 * One vocabulary for the whole brain. Modules, statuses, states and event
 * names live here so the registry, planner, policy engine, action engine and
 * the HTTP surface can never drift apart.
 *
 * Design law (§45): Intent OS is NOT a feature — it is the central brain.
 * Everything below exists so that Wallet, Swap, Bridge, Lending, Futures…
 * behave as limbs of ONE system: Single Brain / Multiple Modules / Shared
 * State / Unified Actions / Verified Execution.
 */

/** §10 — Module Registry: every module the brain must know about. */
export const MODULES = Object.freeze([
  'wallet', 'portfolio', 'swap', 'bridge', 'lending', 'borrowing',
  'farming', 'liquidity', 'staking', 'futures', 'dydx', 'stocks', 'etf',
  'funds', 'forex', 'commodities', 'rwa', 'crypto', 'signals', 'news',
  'events', 'alerts', 'goals', 'profit-plan', 'prediction', 'lab', 'risk',
  'forecast', 'transactions', 'notifications', 'buy-sell'
]);

/** §8 — capability statuses. The AI must never claim what is not true. */
export const CAPABILITY_STATUSES = Object.freeze([
  'AVAILABLE', 'DEGRADED', 'READ_ONLY', 'UNAVAILABLE'
]);

/** §33 — permission model. */
export const PERMISSION_LEVELS = Object.freeze(['READ', 'PREPARE', 'EXECUTE']);

/** §32 — central intent state machine. */
export const INTENT_STATES = Object.freeze([
  'RECEIVED', 'UNDERSTANDING', 'CONTEXT_RESOLUTION', 'STATE_INSPECTION',
  'PLANNING', 'POLICY_CHECK', 'QUOTE', 'SIMULATION', 'CONFIRMATION',
  'EXECUTION', 'VERIFICATION', 'STATE_UPDATE', 'COMPLETED', 'ERROR',
  'SAFE_STOP', 'CANCELLED'
]);

/** §12 — universal action states. */
export const ACTION_STATES = Object.freeze([
  'PENDING', 'CONFIRMED', 'EXECUTING', 'VERIFYING', 'COMPLETED', 'FAILED',
  'CANCELLED', 'REJECTED'
]);

/** §15 — the event vocabulary of the brain. */
export const EVENT_TYPES = Object.freeze([
  'WALLET_CONNECTED', 'BALANCE_CHANGED', 'PRICE_CHANGED', 'POSITION_CHANGED',
  'SWAP_COMPLETED', 'BRIDGE_COMPLETED', 'LOAN_CREATED', 'LOAN_REPAID',
  'LIQUIDATION_RISK_CHANGED', 'SIGNAL_CHANGED', 'NEWS_RECEIVED',
  'GOAL_PROGRESS_CHANGED', 'TRANSACTION_CONFIRMED', 'STATE_REFRESHED',
  'BUY_CREATED', 'QUOTE_READY', 'CHECKOUT_STARTED', 'PAYMENT_CONFIRMED', 'SETTLEMENT_STARTED',
  'TX_DETECTED', 'TX_CONFIRMED', 'BUY_COMPLETED', 'SELL_CREATED', 'SELL_COMPLETED',
  'PAYMENT_FAILED', 'SETTLEMENT_FAILED', 'VERIFICATION_FAILED',
  'INTENT_RECEIVED', 'INTENT_COMPLETED', 'INTENT_FAILED', 'TOOL_EXECUTED',
  'TOOL_FAILED', 'RECOVERY_TRIGGERED', 'SECURITY_STOP', 'CAPABILITY_CHANGED'
]);

/**
 * §23 — errors that must HARD STOP. Never retried, never routed around.
 * These are matched against classifier categories, not free text.
 */
export const SECURITY_STOP_CODES = Object.freeze([
  'SECURITY_VIOLATION', 'INVALID_RECIPIENT', 'ORACLE_ANOMALY',
  'CONTRACT_MISMATCH', 'POLICY_VIOLATION', 'UNSIGNED_EXECUTION_ATTEMPT'
]);

/**
 * §20 — forbidden generic fallbacks. The reply builder refuses these when
 * real state was available; the probe suite asserts they never surface.
 */
export const FORBIDDEN_GENERIC_PHRASES = Object.freeze([
  'متوجه شدم',
  'چطور می‌توانم کمکتان کنم',
  'به نظر می‌رسد',
  'لطفاً بیشتر توضیح دهید',
  'how can i help you',
  'please explain more'
]);

/**
 * §40 — what a COMPLETE feature must register. A module missing any of these
 * is reported INCOMPLETE by the registry, never silently "good enough".
 */
export const FEATURE_REQUIREMENTS = Object.freeze([
  'capability', 'tool', 'state', 'health', 'read', 'quote', 'prepare',
  'simulate', 'execute', 'verify', 'error', 'recovery', 'fallback',
  'events', 'permissions'
]);

/** §11 — the adapter interface every module implements. */
export const ADAPTER_METHODS = Object.freeze([
  'getState', 'healthCheck', 'capabilities', 'read', 'quote', 'prepare',
  'simulate', 'execute', 'verify', 'recover'
]);

/**
 * §31 — Universal Intent Object statuses. (INTENT_STATES above governs the
 * state machine; this is the status field vocabulary of the stored object.)
 */
export const INTENT_STATUS = Object.freeze({
  PLANNING: 'PLANNING',
  AWAITING_CONFIRMATION: 'AWAITING_CONFIRMATION',
  EXECUTING: 'EXECUTING',
  COMPLETED: 'COMPLETED',
  ERROR: 'ERROR',
  SAFE_STOP: 'SAFE_STOP',
  CANCELLED: 'CANCELLED'
});
export const INTENT_STATUS_VALUES = Object.freeze(Object.values(INTENT_STATUS));

/** §26 — recommendation skeleton: never a recommendation without why + data. */
export function emptyRecommendation() {
  return {
    recommendation: null,
    reason: [],
    data: [],
    risk: {},
    confidence: 0,
    alternatives: [],
    actions: []
  };
}

export const CENTRAL_OS_VERSION = 'fbt.central-intelligence-os.v1.0';
