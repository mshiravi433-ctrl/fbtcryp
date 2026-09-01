/**
 * FBT CENTRAL INTELLIGENCE OS — Universal Action Engine (§12, §34).
 * ---------------------------------------------------------------------------
 * Every operation — SWAP, BRIDGE, LEND, BORROW, REPAY, OPEN_FUTURES,
 * DYDX_ORDER, REBALANCE, CREATE_GOAL, SET_ALERT… — is materialised as one
 * Action object with a state machine:
 *
 *   PENDING → CONFIRMED → EXECUTING → VERIFYING → COMPLETED | FAILED
 *                     └→ CANCELLED / REJECTED
 *
 * §34 Anti-Duplicate: an action is keyed by requestId|intentId|executionId.
 * A replayed request returns the SAME action instead of executing twice —
 * double-click can never create a second trade.
 */
import { randomUUID } from 'node:crypto';
import { ACTION_STATES } from './constants.js';
import { storeGet, storeSet } from '../store.js';

const actions = new Map(); // actionId -> record
const dedupe = new Map();  // dedupeKey -> actionId

const dedupeKeyOf = ({ requestId, intentId, executionId }) =>
  [requestId, intentId, executionId].map((v) => String(v ?? '')).join('|');

export function createAction({ intentId, module, operation, params = {}, requiresConfirmation = true, verificationRequired = true, requestId = null, executionId = null, owner = null }) {
  const key = dedupeKeyOf({ requestId, intentId, executionId });
  const existingId = dedupe.get(key);
  if (existingId && actions.has(existingId)) {
    return { action: actions.get(existingId), deduplicated: true };
  }
  const action = {
    actionId: `act_${randomUUID()}`,
    intentId: intentId || null,
    requestId: requestId || null,
    executionId: executionId || `exec_${randomUUID()}`,
    module,
    operation,
    params,
    owner,
    status: 'PENDING',
    requiresConfirmation,
    verificationRequired,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    history: [{ status: 'PENDING', at: Date.now() }]
  };
  actions.set(action.actionId, action);
  dedupe.set(key, action.actionId);
  if (requestId) dedupe.set(`req|${requestId}`, action.actionId);
  if (executionId) dedupe.set(`exec|${executionId}`, action.actionId);
  return { action, deduplicated: false };
}

export const getAction = (actionId) => actions.get(String(actionId || '')) || null;

export function findActionByRequestId(requestId) {
  const id = dedupe.get(`req|${String(requestId || '')}`);
  return id ? actions.get(id) || null : null;
}

export function transitionAction(actionId, status, extra = {}) {
  const action = actions.get(actionId);
  if (!action) return null;
  if (!ACTION_STATES.includes(status)) throw new Error(`BAD_ACTION_STATE:${status}`);
  const legal = {
    PENDING: ['CONFIRMED', 'CANCELLED', 'REJECTED', 'EXECUTING'],
    CONFIRMED: ['EXECUTING', 'CANCELLED'],
    EXECUTING: ['VERIFYING', 'COMPLETED', 'FAILED', 'CANCELLED'],
    VERIFYING: ['COMPLETED', 'FAILED'],
    COMPLETED: [], FAILED: [], CANCELLED: [], REJECTED: []
  };
  if (!legal[action.status].includes(status)) {
    const err = new Error(`ILLEGAL_ACTION_TRANSITION:${action.status}→${status}`);
    err.code = 'ILLEGAL_ACTION_TRANSITION';
    throw err;
  }
  Object.assign(action, extra, { status, updatedAt: Date.now() });
  action.history.push({ status, at: Date.now(), ...(extra?.note ? { note: extra.note } : {}) });
  return action;
}

export function listActions({ owner = null, limit = 20 } = {}) {
  const rows = [...actions.values()]
    .filter((a) => (owner ? a.owner === owner : true))
    .sort((a, b) => b.createdAt - a.createdAt);
  return rows.slice(0, limit);
}

/** §16 hook: completed actions publish their verification for state refresh. */
export function actionSummary(action) {
  return {
    actionId: action.actionId,
    intentId: action.intentId,
    module: action.module,
    operation: action.operation,
    /* params are part of the §43 execution report (Action/Amount/Network);
       they carry no secrets — secrets never enter action params (§35). */
    params: action.params || {},
    status: action.status,
    requiresConfirmation: action.requiresConfirmation,
    verificationRequired: action.verificationRequired,
    createdAt: action.createdAt,
    updatedAt: action.updatedAt,
    result: action.result || null,
    verification: action.verification || null
  };
}

/** Test hook. */
export function resetActionEngine() { actions.clear(); dedupe.clear(); }

export const _internal = { actions, dedupe };
