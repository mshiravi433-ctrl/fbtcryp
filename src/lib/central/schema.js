/**
 * FBT CENTRAL INTELLIGENCE OS — the shared contract (spec v1.0 §2–§45).
 * ---------------------------------------------------------------------------
 * WHY THIS FILE EXISTS AND WHY IT IMPORTS NOTHING
 * The complaint that started this work was not "the prompt is wrong", it was
 * "the brain and the app disagree about what the brain knows". Page-local chat
 * copies each re-derived asset names, statuses, freshness and permissions, and
 * every copy disagreed slightly. So the vocabulary of the Central Intelligence
 * — state sections, capability statuses, permission levels, intent states,
 * action types, event types, the refresh cascade — lives HERE, once, and is
 * imported by:
 *
 *   · the server brain        (server/ci/*.js)   — decides and executes
 *   · the browser gateway     (src/lib/central/client.js) — renders state
 *   · the probes              (test/intent-ai/ci-*.mjs)   — locks the contract
 *
 * It has zero imports and no platform dependencies (no `import.meta.env`, no
 * DOM, no Node builtins) so the same object graph can be evaluated in Vite, in
 * Node, and in jsdom without a shim.
 *
 * THE ONE RULE THIS FILE ENFORCES (§3, §48)
 * Every section of state names a SOURCE. There is no section whose source is
 * "the model". If a value cannot be attributed to a real service it is
 * UNAVAILABLE, and UNAVAILABLE is a value the whole system must be able to
 * carry without inventing something prettier.
 */

export const CI_SCHEMA = 'fbt.central-intelligence.v1';
export const CI_VERSION = '1.0.0';

/* ── §4 Unified System State ─────────────────────────────────────────────── */
/*
 * section        who may write it (module id)         freshness budget
 * The ttl is not decoration: the policy engine refuses EXECUTE on data older
 * than its section budget, which is what stops "you have $X" being read from a
 * thirty-minute-old snapshot after a swap. `authoritative: false` marks the
 * sections the browser pushes (page/tab/wallet addresses) — the server accepts
 * them as *claims about the client*, never as market truth.
 */
export const STATE_SECTIONS = Object.freeze({
  user: { owner: 'session', ttlMs: 15 * 60_000, authoritative: false, required: false },
  session: { owner: 'session', ttlMs: 15 * 60_000, authoritative: false, required: true },
  wallet: { owner: 'wallet', ttlMs: 30_000, authoritative: true, required: true },
  portfolio: { owner: 'portfolio', ttlMs: 60_000, authoritative: true, required: true },
  markets: { owner: 'crypto', ttlMs: 30_000, authoritative: true, required: true },
  positions: { owner: 'lending', ttlMs: 60_000, authoritative: true, required: false },
  orders: { owner: 'orders', ttlMs: 60_000, authoritative: false, required: false },
  lending: { owner: 'lending', ttlMs: 60_000, authoritative: true, required: false },
  borrowing: { owner: 'borrowing', ttlMs: 60_000, authoritative: true, required: false },
  farming: { owner: 'farming', ttlMs: 5 * 60_000, authoritative: true, required: false },
  liquidity: { owner: 'liquidity', ttlMs: 5 * 60_000, authoritative: true, required: false },
  futures: { owner: 'futures', ttlMs: 60_000, authoritative: true, required: false },
  dydx: { owner: 'dydx', ttlMs: 60_000, authoritative: true, required: false },
  transactions: { owner: 'transactions', ttlMs: 30_000, authoritative: true, required: false },
  goals: { owner: 'goals', ttlMs: 10 * 60_000, authoritative: true, required: false },
  profitPlan: { owner: 'profit-plan', ttlMs: 10 * 60_000, authoritative: true, required: false },
  signals: { owner: 'signals', ttlMs: 5 * 60_000, authoritative: true, required: false },
  news: { owner: 'news', ttlMs: 15 * 60_000, authoritative: true, required: false },
  events: { owner: 'events', ttlMs: 60_000, authoritative: true, required: false },
  alerts: { owner: 'alerts', ttlMs: 60_000, authoritative: true, required: false },
  capabilities: { owner: 'registry', ttlMs: 60_000, authoritative: true, required: true },
  health: { owner: 'registry', ttlMs: 60_000, authoritative: true, required: true },
  risk: { owner: 'risk', ttlMs: 60_000, authoritative: true, required: true },
  activePage: { owner: 'session', ttlMs: 24 * 3600_000, authoritative: false, required: true },
  activeModule: { owner: 'session', ttlMs: 24 * 3600_000, authoritative: false, required: false },
  recentActions: { owner: 'actions', ttlMs: 24 * 3600_000, authoritative: true, required: false },
  pendingActions: { owner: 'actions', ttlMs: 24 * 3600_000, authoritative: true, required: false },
  errors: { owner: 'errors', ttlMs: 24 * 3600_000, authoritative: true, required: false },
  lastUpdated: { owner: 'registry', ttlMs: 0, authoritative: true, required: true }
});

export const STATE_SECTION_IDS = Object.freeze(Object.keys(STATE_SECTIONS));

/** The sections every read-only analysis must have before it may quote a number. */
export const ANALYSIS_MINIMUM = Object.freeze(['wallet', 'portfolio', 'markets', 'risk']);

/* ── §8 Capability statuses ──────────────────────────────────────────────── */
export const CAPABILITY = Object.freeze({
  AVAILABLE: 'AVAILABLE',
  DEGRADED: 'DEGRADED',
  READ_ONLY: 'READ_ONLY',
  UNAVAILABLE: 'UNAVAILABLE',
  INCOMPLETE: 'INCOMPLETE'
});
export const CAPABILITY_STATUSES = Object.freeze(Object.values(CAPABILITY));

/* ── §11 Module operations (the only interface the brain knows) ──────────── */
export const MODULE_OPERATIONS = Object.freeze([
  'getState', 'healthCheck', 'capabilities', 'read', 'quote', 'prepare', 'simulate', 'execute', 'verify', 'recover'
]);

/** Operations that touch money or a chain — every one of them is policy-gated. */
export const MUTATING_OPERATIONS = Object.freeze(['execute', 'recover']);

/* ── §40 Definition of Done — what a registered module must declare ──────── */
export const MODULE_CONTRACT_FIELDS = Object.freeze([
  'id', 'name', 'capability', 'tools', 'stateSections', 'health',
  'read', 'quote', 'prepare', 'simulate', 'execute', 'verify',
  'errors', 'recovery', 'fallbacks', 'events', 'permissions'
]);

/* ── §33 Permission model ───────────────────────────────────────────────── */
export const PERMISSION = Object.freeze({
  READ: 'READ',
  PREPARE: 'PREPARE',
  EXECUTE: 'EXECUTE'
});
export const OPERATION_PERMISSION = Object.freeze({
  getState: PERMISSION.READ,
  healthCheck: PERMISSION.READ,
  capabilities: PERMISSION.READ,
  read: PERMISSION.READ,
  quote: PERMISSION.PREPARE,
  prepare: PERMISSION.PREPARE,
  simulate: PERMISSION.PREPARE,
  verify: PERMISSION.READ,
  recover: PERMISSION.PREPARE,
  execute: PERMISSION.EXECUTE
});

/* ── §12 Universal Action Engine ────────────────────────────────────────── */
export const ACTION_TYPES = Object.freeze([
  'SWAP', 'BRIDGE', 'LEND', 'BORROW', 'REPAY', 'WITHDRAW', 'FARM',
  'ADD_LIQUIDITY', 'REMOVE_LIQUIDITY', 'OPEN_FUTURES', 'CLOSE_FUTURES',
  'DYDX_ORDER', 'REBALANCE', 'CREATE_GOAL', 'OPTIMIZE_PLAN', 'SET_ALERT'
]);
/** The actions a wallet signature is unavoidable for. Everything else is a plan. */
export const SIGNATURE_REQUIRED_ACTIONS = Object.freeze([
  'SWAP', 'BRIDGE', 'LEND', 'BORROW', 'REPAY', 'WITHDRAW', 'FARM',
  'ADD_LIQUIDITY', 'REMOVE_LIQUIDITY', 'OPEN_FUTURES', 'CLOSE_FUTURES', 'DYDX_ORDER', 'REBALANCE'
]);
/** Actions the brain may complete server-side without any signature (no money moves). */
export const NON_TRANSACTIONAL_ACTIONS = Object.freeze(['CREATE_GOAL', 'OPTIMIZE_PLAN', 'SET_ALERT']);

export const ACTION_STATUS = Object.freeze({
  PENDING: 'PENDING',
  QUOTED: 'QUOTED',
  SIMULATED: 'SIMULATED',
  AWAITING_CONFIRMATION: 'AWAITING_CONFIRMATION',
  AWAITING_SIGNATURE: 'AWAITING_SIGNATURE',
  BROADCAST: 'BROADCAST',
  EXPIRED: 'EXPIRED',
  VERIFYING: 'VERIFYING',
  VERIFIED: 'VERIFIED',
  REJECTED: 'REJECTED',
  CANCELLED: 'CANCELLED',
  FAILED: 'FAILED',
  BLOCKED: 'BLOCKED'
});

/* ── §32 Central state machine ─────────────────────────────────────────── */
export const INTENT_STATES = Object.freeze([
  'RECEIVED', 'UNDERSTANDING', 'CONTEXT_RESOLUTION', 'STATE_INSPECTION',
  'PLANNING', 'POLICY_CHECK', 'QUOTE', 'SIMULATION', 'CONFIRMATION',
  'EXECUTION', 'VERIFICATION', 'STATE_UPDATE', 'COMPLETED',
  'ERROR', 'SAFE_STOP', 'CANCELLED', 'DUPLICATE'
]);

export const INTENT_STATE_TRANSITIONS = Object.freeze({
  RECEIVED: ['UNDERSTANDING', 'ERROR', 'CANCELLED', 'DUPLICATE'],
  UNDERSTANDING: ['CONTEXT_RESOLUTION', 'ERROR', 'CANCELLED', 'DUPLICATE'],
  CONTEXT_RESOLUTION: ['STATE_INSPECTION', 'CONFIRMATION', 'ERROR', 'CANCELLED'],
  STATE_INSPECTION: ['PLANNING', 'ERROR', 'CANCELLED'],
  PLANNING: ['POLICY_CHECK', 'ERROR', 'CANCELLED'],
  /* POLICY_CHECK may reach EXECUTION directly when the confirmation was granted
     earlier in the same turn (the /confirm route), and CONFIRMATION may close the
     INTENT while the ACTION stays open in the action engine: the turn is finished
     (we asked), the money has not moved. Those are two different records, so a
     parked confirmation must not be modelled as a live intent forever. */
  POLICY_CHECK: ['QUOTE', 'SIMULATION', 'CONFIRMATION', 'EXECUTION', 'COMPLETED', 'SAFE_STOP', 'ERROR'],
  QUOTE: ['SIMULATION', 'CONFIRMATION', 'ERROR', 'CANCELLED'],
  SIMULATION: ['CONFIRMATION', 'COMPLETED', 'SAFE_STOP', 'ERROR'],
  CONFIRMATION: ['EXECUTION', 'CANCELLED', 'ERROR', 'SAFE_STOP', 'COMPLETED'],
  EXECUTION: ['VERIFICATION', 'ERROR', 'SAFE_STOP'],
  VERIFICATION: ['STATE_UPDATE', 'ERROR', 'SAFE_STOP'],
  STATE_UPDATE: ['COMPLETED', 'ERROR'],
  ERROR: ['CONTEXT_RESOLUTION', 'PLANNING', 'RECOVER', 'SAFE_STOP', 'CANCELLED', 'COMPLETED'],
  COMPLETED: [],
  SAFE_STOP: [],
  CANCELLED: [],
  DUPLICATE: [],
  RECOVER: ['QUOTE', 'SIMULATION', 'STATE_INSPECTION', 'ERROR', 'SAFE_STOP']
});

/* ── §15 Event types ───────────────────────────────────────────────────── */
export const EVENT_TYPES = Object.freeze([
  'WALLET_CONNECTED', 'WALLET_DISCONNECTED', 'BALANCE_CHANGED', 'PRICE_CHANGED',
  'POSITION_CHANGED', 'SWAP_COMPLETED', 'BRIDGE_COMPLETED', 'LENDING_COMPLETED',
  'LOAN_CREATED', 'LOAN_REPAID', 'LIQUIDITY_CHANGED', 'LIQUIDATION_RISK_CHANGED',
  'SIGNAL_CHANGED', 'NEWS_RECEIVED', 'GOAL_PROGRESS_CHANGED', 'ALERT_FIRED',
  'TRANSACTION_CONFIRMED', 'TRANSACTION_FAILED', 'RISK_CHANGED',
  'CAPABILITY_CHANGED', 'MODULE_DEGRADED', 'MODULE_RECOVERED', 'ACTION_REPLAYED',
  'SAFE_STOP', 'POLICY_BLOCKED',
  /* The two halves of a hand-off that are NOT transactions: a confirmation card
     that exists (nothing has moved, so nothing may be invalidated — only the UI
     needs to show it) and a signature that has been broadcast but not yet
     confirmed on-chain (the transaction list must stop showing it as absent). */
  'ACTION_PROPOSED', 'TRANSACTION_PENDING'
]);

/*
 * §16 — after every transaction, and §14 cross-module intelligence.
 * This map is the single reason "no module shows stale data after an operation"
 * is enforceable: it says which sections an event invalidates, and the brain
 * re-reads exactly those (no more, no less) through the module that owns them.
 * `cascade: true` means a refresh of that section re-runs the risk engine,
 * because a risk number computed from a superseded portfolio is worse than none.
 */
export const REFRESH_CASCADE = Object.freeze({
  WALLET_CONNECTED: { invalidate: ['wallet', 'portfolio', 'positions', 'risk'], cascade: true },
  BALANCE_CHANGED: { invalidate: ['wallet', 'portfolio', 'risk', 'goals'], cascade: true },
  PRICE_CHANGED: { invalidate: ['markets', 'portfolio', 'risk', 'signals', 'goals'], cascade: true },
  POSITION_CHANGED: { invalidate: ['positions', 'portfolio', 'risk', 'alerts'], cascade: true },
  SWAP_COMPLETED: { invalidate: ['wallet', 'portfolio', 'markets', 'risk', 'goals', 'alerts', 'transactions'], cascade: true },
  BRIDGE_COMPLETED: { invalidate: ['wallet', 'portfolio', 'risk', 'transactions'], cascade: true },
  LENDING_COMPLETED: { invalidate: ['lending', 'positions', 'portfolio', 'risk', 'alerts', 'goals'], cascade: true },
  LOAN_CREATED: { invalidate: ['lending', 'borrowing', 'positions', 'portfolio', 'risk', 'alerts'], cascade: true },
  LOAN_REPAID: { invalidate: ['lending', 'borrowing', 'positions', 'portfolio', 'risk', 'alerts'], cascade: true },
  LIQUIDITY_CHANGED: { invalidate: ['liquidity', 'portfolio', 'risk'], cascade: true },
  LIQUIDATION_RISK_CHANGED: { invalidate: ['risk', 'alerts', 'positions'], cascade: true },
  SIGNAL_CHANGED: { invalidate: ['signals', 'risk'], cascade: false },
  NEWS_RECEIVED: { invalidate: ['news'], cascade: false },
  GOAL_PROGRESS_CHANGED: { invalidate: ['goals', 'profitPlan'], cascade: false },
  TRANSACTION_CONFIRMED: { invalidate: ['wallet', 'portfolio', 'transactions', 'risk'], cascade: true },
  TRANSACTION_FAILED: { invalidate: ['transactions', 'risk'], cascade: true },
  RISK_CHANGED: { invalidate: ['risk'], cascade: false },
  ACTION_PROPOSED: { invalidate: [], cascade: false },
  TRANSACTION_PENDING: { invalidate: ['transactions'], cascade: false },
  ALERT_FIRED: { invalidate: ['alerts'], cascade: false },
  MODULE_DEGRADED: { invalidate: ['capabilities', 'health'], cascade: false },
  MODULE_RECOVERED: { invalidate: ['capabilities', 'health'], cascade: false }
});

/** §10 Module registry — the ids the brain must be able to discover. */
export const MODULE_IDS = Object.freeze([
  'wallet', 'portfolio', 'swap', 'bridge', 'lending', 'borrowing', 'farming',
  'liquidity', 'staking', 'futures', 'dydx', 'stocks', 'etf', 'funds', 'forex',
  'commodities', 'rwa', 'crypto', 'signals', 'news', 'events', 'alerts', 'goals',
  'profit-plan', 'prediction', 'lab', 'risk', 'forecast', 'transactions', 'notifications'
]);

/**
 * §24 — every action module must pass through the SAME risk engine, and the
 * engine must know which portfolio sections to fold in. A module absent from
 * this map has no risk view and therefore cannot reach EXECUTE.
 */
export const RISK_CONTEXT = Object.freeze({
  swap: { sections: ['wallet', 'markets', 'portfolio'], checks: ['slippage', 'priceImpact', 'tokenRisk', 'balance'] },
  bridge: { sections: ['wallet', 'markets'], checks: ['destinationChain', 'minTransport', 'feeDrift', 'providerHealth'] },
  lending: { sections: ['portfolio', 'wallet'], checks: ['healthFactor', 'oracle', 'liquidity'] },
  borrowing: { sections: ['portfolio', 'wallet', 'markets'], checks: ['healthFactor', 'liquidationDistance', 'borrowRate', 'oracle'] },
  farming: { sections: ['portfolio'], checks: ['ilRisk', 'protocolRisk', 'aprStability'] },
  liquidity: { sections: ['portfolio', 'markets'], checks: ['ilRisk', 'poolDepth'] },
  staking: { sections: ['portfolio'], checks: ['unbonding', 'protocolRisk'] },
  futures: { sections: ['portfolio', 'markets'], checks: ['leverageVsPortfolio', 'funding', 'liquidationPrice', 'margin'] },
  dydx: { sections: ['portfolio', 'markets'], checks: ['leverageVsPortfolio', 'funding', 'margin'] },
  'profit-plan': { sections: ['portfolio', 'markets', 'risk', 'goals'], checks: ['goalFeasibility', 'volatility'] },
  goals: { sections: ['portfolio', 'markets'], checks: ['goalFeasibility'] },
  rebalance: { sections: ['portfolio', 'markets', 'risk'], checks: ['concentration', 'turnoverCost', 'priceImpact'] }
});

/** §20 Phrases that must never be the whole answer. */
export const FORBIDDEN_PHRASES = Object.freeze([
  'متوجه شدم',
  'چطور می‌توانم کمکتان کنم',
  'چطور می‌توانم کمکتان کنم؟',
  'به نظر می‌رسد',
  'لطفاً بیشتر توضیح دهید',
  'I see.',
  'How can I help you',
  'It seems that',
  'Please provide more details'
]);

/** §44 The Ultimate Rule — the chain every request walks, in order. */
export const ULTIMATE_CHAIN = Object.freeze([
  'USER_REQUEST', 'UNDERSTAND', 'RESOLVE_CONTEXT', 'READ_REAL_STATE',
  'DISCOVER_CAPABILITIES', 'SELECT_TOOLS', 'BUILD_PLAN', 'CHECK_POLICY',
  'QUOTE_OR_SIMULATE', 'ASK_CONFIRMATION', 'EXECUTE', 'VERIFY',
  'UPDATE_CENTRAL_STATE', 'PUBLISH_EVENTS', 'UPDATE_RELATED_MODULES', 'RESPOND'
]);

/** §19 Response modes: an answer always carries its origin. */
export const RESPONSE_MODES = Object.freeze(['ANSWER', 'ACTION', 'QUESTION', 'ERROR_AND_RECOVERY', 'SAFE_STOP']);

/** §3/§48 Where a value came from. `model` is never an acceptable source for a number. */
export const DATA_SOURCES = Object.freeze({
  WALLET_SERVICE: 'wallet-service',
  PORTFOLIO_SERVICE: 'portfolio-service',
  MARKET_DATA: 'market-data',
  BLOCKCHAIN: 'blockchain',
  TRANSACTION_SERVICE: 'transaction-service',
  LENDING_PROTOCOL: 'lending-protocol',
  DEX_AGGREGATOR: 'dex-aggregator',
  BRIDGE: 'bridge',
  DYDX: 'dydx',
  FUTURES_ENGINE: 'futures-engine',
  SIGNALS_ENGINE: 'signals-engine',
  NEWS_ENGINE: 'news-engine',
  EVENTS_ENGINE: 'events-engine',
  GOALS_ENGINE: 'goals-engine',
  RISK_ENGINE: 'risk-engine',
  CLIENT_CONTEXT: 'client-context',
  MODEL: 'model'
});

/** §48 Non-negotiable: the model never authors a number. */
export const MODEL_MAY_PRODUCE = Object.freeze(['explanation', 'planStepSelection', 'entityNormalization']);
export const MODEL_MAY_NOT_PRODUCE = Object.freeze([
  'balance', 'price', 'address', 'txHash', 'amount', 'fee', 'healthFactor', 'apr', 'position'
]);

/* ── §22/§23 Error taxonomy ───────────────────────────────────────────── */
export const ERROR_CLASSES = Object.freeze({
  TRANSIENT: 'TRANSIENT',
  DEGRADED: 'DEGRADED',
  RECOVERABLE_DATA: 'RECOVERABLE_DATA',
  FATAL: 'FATAL',
  SECURITY: 'SECURITY',
  USER: 'USER'
});

/** §23 — these codes stop the pipeline. No retry, no alternative route, no exceptions. */
export const SAFE_STOP_CODES = Object.freeze([
  'CONTRACT_MISMATCH', 'ORACLE_MANIPULATION_SUSPECTED', 'INVALID_RECIPIENT',
  'SECURITY_VIOLATION', 'HONEYPOT_DETECTED', 'SIGNER_MISMATCH',
  'NETWORK_MISMATCH', 'POLICY_BYPAGE_ATTEMPT', 'TAMPERED_QUOTE', 'SENDER_BINDING_MISMATCH'
]);

/** §39 Recoverable problems, with the ladder each one gets. */
export const RECOVERY_LADDER = Object.freeze({
  RPC_TIMEOUT: ['RETRY', 'FAILOVER_RPC', 'RETRY', 'MARK_DEGRADED'],
  RPC_ERROR: ['RETRY', 'FAILOVER_RPC', 'MARK_DEGRADED'],
  PROVIDER_TIMEOUT: ['RETRY', 'FAILOVER_PROVIDER', 'SERVE_STALE_WITH_FLAG'],
  PROVIDER_DOWN: ['FAILOVER_PROVIDER', 'SERVE_STALE_WITH_FLAG', 'MARK_UNAVAILABLE'],
  RATE_LIMITED: ['BACKOFF_RETRY', 'FAILOVER_PROVIDER', 'SERVE_STALE_WITH_FLAG'],
  INDEXER_LAG: ['REVALIDATE', 'SERVE_STALE_WITH_FLAG'],
  QUOTE_EXPIRED: ['REQUOTE', 'POLICY_CHECK'],
  STALE_DATA: ['REFRESH', 'POLICY_CHECK'],
  UPSTREAM_HTTP_5XX: ['RETRY', 'FAILOVER_PROVIDER', 'MARK_DEGRADED'],
  UPSTREAM_HTTP_4XX: ['VALIDATE_INPUT', 'SAFE_ANSWER'],
  NETWORK_UNAVAILABLE: ['SERVE_STALE_WITH_FLAG', 'MARK_UNAVAILABLE'],
  TIMEOUT: ['RETRY', 'MARK_DEGRADED']
});

/** §34 Anti-duplicate keys. Any of these seen twice short-circuits execution. */
export const DEDUPE_KEYS = Object.freeze(['requestId', 'intentId', 'executionId']);

/* ── small shared helpers (pure, no platform) ─────────────────────────── */
export const clamp = (n, min, max) => Math.min(max, Math.max(min, Number(n)));

/** Round to a fixed decimal without the floating-point dust that breaks comparisons. */
export const round = (n, digits = 2) => {
  const f = 10 ** digits;
  const v = Number(n);
  return Number.isFinite(v) ? Math.round(v * f) / f : null;
};

/**
 * FNV-1a, 32-bit, hex. Deterministic in Node, the browser and jsdom with no
 * crypto import, which is what lets the SAME digest be computed by the brain that
 * asks for a confirmation and by the browser that answers it.
 */
export function hashString(input) {
  let h = 0x811c9dc5;
  const s = String(input);
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

/**
 * A value is only usable when it is a real finite number.
 *
 * The empty cases are spelled out because `Number(null)` is `0` and
 * `Number('')` is `0` in JavaScript. A helper that returns 0 for "the provider
 * did not answer" turns an unreadable fee into a FREE trade, an unreadable
 * price impact into "no impact", and an unreadable funding rate into 0% — the
 * single most dangerous coercion in this file, because every one of those looks
 * like data downstream. So: null in, null out, always.
 */
export const usableNumber = (v) => {
  if (v === null || v === undefined || typeof v === 'boolean') return null;
  if (typeof v === 'string' && !v.trim()) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
