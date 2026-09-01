/**
 * CROSS-CHAIN PERSISTENCE — transactions, quotes, routes, intents.
 * ---------------------------------------------------------------------------
 * ─── WHY NOT A NEW DATABASE ─────────────────────────────────────────────────
 * The spec asks for `cross_chain_transactions`, `cross_chain_quotes`,
 * `cross_chain_routes` and `cross_chain_intents`. This API already has a
 * durable key-value store (server/store.js → Vercel Blob, with an in-process
 * fallback) that the rest of the product uses. Adding Postgres for four small
 * collections would mean a connection pool, migrations and a second deploy
 * target — and, far worse, a SECOND source of truth for money movements.
 *
 * So the four collections live here as namespaced records with explicit
 * schemas. `crossChainStoreHealth()` reports whether the backing store is
 * durable, and `/api/health/cross-chain` passes that through: a history that
 * disappears on a cold start must SAY it can disappear rather than look
 * permanent.
 *
 * ─── THE RULE THIS FILE ENFORCES ────────────────────────────────────────────
 * Status is a state machine, not a field. A browser cannot post COMPLETED:
 * every write goes through `canTransition()` and `guardCompletion()` from the
 * shared engine, so "completed" in this store always means a destination
 * transaction hash exists.
 */

import { randomUUID } from 'node:crypto';
import { storeGet, storeSet, storeDurable } from './store.js';
import {
  CROSS_CHAIN_INTENT_SCHEMA,
  CROSS_CHAIN_QUOTE_SCHEMA,
  CROSS_CHAIN_ROUTE_SCHEMA,
  CROSS_CHAIN_TX_SCHEMA,
  canTransition,
  guardCompletion
} from '../src/services/cross-chain/core.js';

const TX_KEY = (wallet) => `xchain:tx:${String(wallet).toLowerCase()}`;
const TX_INDEX_KEY = (id) => `xchain:txid:${id}`;
const QUOTE_KEY = (quoteId) => `xchain:quote:${quoteId}`;
const ROUTES_KEY = (requestId) => `xchain:routes:${requestId}`;
const INTENT_KEY = (id) => `xchain:intent:${id}`;

/** Per-wallet history cap. Enough to be useful, small enough to write cheaply. */
const MAX_TX_PER_WALLET = 100;

const nowMs = () => Date.now();

async function safeSet(key, value) {
  try {
    await storeSet(key, value);
    return true;
  } catch {
    /* A durable-store failure must not lose the in-memory copy: storeSet()
       writes the Map before it writes Blob, so the record still exists for
       this instance and the health endpoint reports the degradation. */
    return false;
  }
}

/* ── cross_chain_quotes ──────────────────────────────────────────────────── */

/**
 * Snapshot the quote a user was shown.
 *
 * Kept because "the rate changed" is only checkable against the rate that was
 * actually displayed. Without this, a dispute is our word against theirs.
 */
export async function recordQuote(quote) {
  if (!quote?.quoteId) return null;
  const record = {
    schema: CROSS_CHAIN_QUOTE_SCHEMA,
    quoteId: quote.quoteId,
    provider: quote.provider ?? null,
    tool: quote.tool ?? null,
    fromChain: quote.fromChain ?? null,
    toChain: quote.toChain ?? null,
    fromToken: quote.fromToken ?? null,
    toToken: quote.toToken ?? null,
    fromAmount: quote.fromAmount ?? null,
    toAmount: quote.toAmount ?? null,
    toAmountMin: quote.toAmountMin ?? null,
    gasCost: quote.gasCost ?? null,
    bridgeFee: quote.bridgeFee ?? null,
    protocolFee: quote.protocolFee ?? null,
    slippage: quote.slippage ?? null,
    estimatedTime: quote.estimatedTime ?? null,
    createdAt: quote.createdAt ?? nowMs(),
    expiresAt: quote.expiresAt ?? null
  };
  await safeSet(QUOTE_KEY(record.quoteId), record);
  return record;
}

export const getQuoteRecord = (quoteId) => storeGet(QUOTE_KEY(quoteId), null);

/* ── cross_chain_routes ──────────────────────────────────────────────────── */

/**
 * Snapshot the route SET a decision was made from, plus the ranking.
 *
 * "Best route" is a claim. Storing the alternatives and their scores makes it
 * a checkable one.
 */
export async function recordRoutes(requestId, routes, { selectedQuoteId = null } = {}) {
  const record = {
    schema: CROSS_CHAIN_ROUTE_SCHEMA,
    requestId,
    selectedQuoteId,
    createdAt: nowMs(),
    routes: (routes || []).map((r) => ({
      quoteId: r.quoteId,
      routeId: r.routeId ?? null,
      tool: r.tool ?? null,
      toolName: r.toolName ?? null,
      toAmount: r.toAmount ?? null,
      toAmountUsd: r.toAmountUsd ?? null,
      gasCostUsd: r.gasCostUsd ?? null,
      bridgeFeeUsd: r.bridgeFeeUsd ?? null,
      protocolFeeUsd: r.protocolFeeUsd ?? null,
      estimatedTime: r.estimatedTime ?? null,
      slippage: r.slippage ?? null,
      score: r.score ?? null,
      rank: r.rank ?? null,
      best: Boolean(r.best)
    }))
  };
  await safeSet(ROUTES_KEY(requestId), record);
  return record;
}

export const getRoutesRecord = (requestId) => storeGet(ROUTES_KEY(requestId), null);

/* ── cross_chain_transactions ────────────────────────────────────────────── */

function normalizeTxInput(input) {
  return {
    schema: CROSS_CHAIN_TX_SCHEMA,
    id: input.id || randomUUID(),
    walletAddress: String(input.walletAddress || '').trim(),
    fromChain: input.fromChain == null ? null : String(input.fromChain),
    toChain: input.toChain == null ? null : String(input.toChain),
    fromToken: input.fromToken ?? null,
    toToken: input.toToken ?? null,
    fromTokenSymbol: input.fromTokenSymbol ?? null,
    toTokenSymbol: input.toTokenSymbol ?? null,
    fromTokenDecimals: input.fromTokenDecimals ?? null,
    toTokenDecimals: input.toTokenDecimals ?? null,
    fromAmount: input.fromAmount == null ? null : String(input.fromAmount),
    expectedAmount: input.expectedAmount == null ? null : String(input.expectedAmount),
    actualAmount: null,
    provider: input.provider || 'lifi',
    tool: input.tool ?? null,
    toolName: input.toolName ?? null,
    routeId: input.routeId ?? null,
    quoteId: input.quoteId ?? null,
    intentId: input.intentId ?? null,
    source: input.source === 'intent-os' ? 'intent-os' : 'bridge',
    destinationAddress: input.destinationAddress ?? null,
    sourceTxHash: input.sourceTxHash ?? null,
    destinationTxHash: input.destinationTxHash ?? null,
    feesUsd: {
      gas: input.gasCostUsd ?? null,
      bridge: input.bridgeFeeUsd ?? null,
      protocol: input.protocolFeeUsd ?? null,
      total: input.totalCostUsd ?? null
    },
    estimatedTime: input.estimatedTime ?? null,
    status: 'PENDING',
    executionStatus: input.sourceTxHash ? 'SUBMITTED' : 'AWAITING_SIGNATURE',
    providerStatus: null,
    providerSubstatus: null,
    failureReason: null,
    cancelled: false,
    history: [],
    createdAt: nowMs(),
    updatedAt: nowMs(),
    completedAt: null
  };
}

/**
 * The four coarse states the spec names for a history row, derived from the
 * fine-grained execution status rather than tracked separately — two status
 * fields that can disagree is how a UI ends up showing "Completed" next to a
 * pending spinner.
 */
export function coarseStatus(executionStatus) {
  switch (executionStatus) {
    case 'COMPLETED': return 'COMPLETED';
    case 'FAILED': return 'FAILED';
    case 'SUBMITTED':
    case 'BRIDGING':
    case 'DESTINATION_PENDING': return 'BRIDGING';
    default: return 'PENDING';
  }
}

async function writeTx(record) {
  const key = TX_KEY(record.walletAddress);
  const rows = (await storeGet(key, [])) || [];
  const next = [record, ...rows.filter((r) => r.id !== record.id)].slice(0, MAX_TX_PER_WALLET);
  await safeSet(key, next);
  await safeSet(TX_INDEX_KEY(record.id), record.walletAddress.toLowerCase());
  return record;
}

export async function createTransaction(input) {
  const record = normalizeTxInput(input);
  if (!record.walletAddress) return { ok: false, code: 'WALLET_REQUIRED' };
  record.history = [{ status: record.executionStatus, at: record.createdAt, note: 'created' }];
  record.status = coarseStatus(record.executionStatus);
  await writeTx(record);
  return { ok: true, transaction: record };
}

export async function getTransaction(id) {
  const wallet = await storeGet(TX_INDEX_KEY(id), null);
  if (!wallet) return null;
  const rows = (await storeGet(TX_KEY(wallet), [])) || [];
  return rows.find((r) => r.id === id) || null;
}

/**
 * Move a transaction forward.
 *
 * Refuses illegal transitions and downgrades COMPLETED without a destination
 * hash. Both refusals are returned as codes, not thrown: a status poll that
 * arrives out of order is normal, not exceptional.
 */
export async function updateTransaction(id, patch = {}) {
  const current = await getTransaction(id);
  if (!current) return { ok: false, code: 'NOT_FOUND' };
  if (current.executionStatus === 'COMPLETED' || current.executionStatus === 'FAILED') {
    /* Terminal. Late provider polls are accepted as no-ops so the client does
       not have to special-case them. */
    return { ok: true, transaction: current, unchanged: true };
  }

  const destinationTxHash = patch.destinationTxHash ?? current.destinationTxHash ?? null;
  const requested = patch.executionStatus || current.executionStatus;
  const guarded = guardCompletion(requested, { destinationTxHash });

  if (!canTransition(current.executionStatus, guarded)) {
    return { ok: false, code: 'ILLEGAL_TRANSITION', from: current.executionStatus, to: guarded };
  }

  const next = {
    ...current,
    sourceTxHash: patch.sourceTxHash ?? current.sourceTxHash,
    destinationTxHash,
    actualAmount: patch.actualAmount ?? current.actualAmount,
    providerStatus: patch.providerStatus ?? current.providerStatus,
    providerSubstatus: patch.providerSubstatus ?? current.providerSubstatus,
    failureReason: patch.failureReason ?? current.failureReason,
    cancelled: patch.cancelled ?? current.cancelled,
    tool: patch.tool ?? current.tool,
    executionStatus: guarded,
    status: coarseStatus(guarded),
    updatedAt: nowMs(),
    completedAt: guarded === 'COMPLETED' ? nowMs() : current.completedAt
  };
  if (guarded !== current.executionStatus) {
    next.history = [...(current.history || []), { status: guarded, at: next.updatedAt, note: patch.note ?? null }];
  }
  await writeTx(next);
  return { ok: true, transaction: next, changed: guarded !== current.executionStatus };
}

export async function listTransactions(wallet, { limit = 25 } = {}) {
  if (!wallet) return [];
  const rows = (await storeGet(TX_KEY(wallet), [])) || [];
  return rows.slice(0, Math.max(1, Math.min(MAX_TX_PER_WALLET, Number(limit) || 25)));
}

/** Rows still in flight — what the status tracker must keep polling. */
export async function pendingTransactions(wallet) {
  const rows = await listTransactions(wallet, { limit: MAX_TX_PER_WALLET });
  return rows.filter((r) => !['COMPLETED', 'FAILED'].includes(r.executionStatus));
}

/* ── cross_chain_intents ─────────────────────────────────────────────────── */

/**
 * The user's stated intent, kept separately from the transaction that served
 * it: «۱۰۰ USDC دارم، روی Ethereum به ETH تبدیلش کن» is a durable fact even if
 * the first route fails and a second one executes it.
 */
export async function recordIntent(input) {
  const record = {
    schema: CROSS_CHAIN_INTENT_SCHEMA,
    id: input.id || randomUUID(),
    walletAddress: String(input.walletAddress || '').toLowerCase(),
    text: input.text ? String(input.text).slice(0, 500) : null,
    fromChain: input.fromChain == null ? null : String(input.fromChain),
    toChain: input.toChain == null ? null : String(input.toChain),
    fromToken: input.fromToken ?? null,
    toToken: input.toToken ?? null,
    fromAmount: input.fromAmount == null ? null : String(input.fromAmount),
    quoteId: input.quoteId ?? null,
    transactionId: input.transactionId ?? null,
    createdAt: nowMs()
  };
  await safeSet(INTENT_KEY(record.id), record);
  return record;
}

export const getIntent = (id) => storeGet(INTENT_KEY(id), null);

/* ── health ──────────────────────────────────────────────────────────────── */

export function crossChainStoreHealth() {
  return {
    component: 'database',
    ok: true,
    durable: storeDurable(),
    /* Honest: without a configured Blob token this is per-instance memory and
       history vanishes on a cold start. The UI is told, not left to assume. */
    detail: storeDurable() ? 'durable-kv' : 'in-process-memory (history is not durable)',
    collections: ['cross_chain_transactions', 'cross_chain_quotes', 'cross_chain_routes', 'cross_chain_intents']
  };
}
