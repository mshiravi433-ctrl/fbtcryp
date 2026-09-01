/**
 * FBT CENTRAL INTELLIGENCE OS — Universal Action Engine (spec §12, §34, §33, §16).
 * ---------------------------------------------------------------------------
 * Every value-bearing operation — SWAP, BRIDGE, LEND, BORROW, REPAY, WITHDRAW,
 * FARM, ADD_LIQUIDITY, REMOVE_LIQUIDITY, OPEN_FUTURES, CLOSE_FUTURES, DYDX_ORDER,
 * REBALANCE, CREATE_GOAL, OPTIMIZE_PLAN, SET_ALERT — becomes ONE record here.
 * The record is the only way the pipeline knows an action exists, so "did we ask
 * for confirmation?" and "did we already run this?" are lookups, not memory.
 *
 * ─── §34: THE DOUBLE-CLICK RULE, EXACTLY ───────────────────────────────────
 * Three keys are checked, in this order: `requestId` (this HTTP call), `intentId`
 * (this user request), `executionId` (this execution attempt). A claim that hits
 * any of them returns the STORED RESULT instead of executing again, so a
 * double-clicked confirm button replays a quote rather than broadcasting twice.
 * A replay is not silent: it emits `ACTION_REPLAYED` and `replay: true` in the
 * response, because a user who clicked twice deserves to be told the second click
 * did nothing — otherwise a slow UI reads as "it is working on it".
 *
 * ─── WHY A MEMORY DEDUPE IS ALLOWED, AND ONLY IN A NARROW WAY ──────────────
 * `idempotency.js` needs the durable store; without `BLOB_READ_WRITE_TOKEN` it
 * returns `PROJECT_STORE_UNAVAILABLE`. Dropping dedupe there would mean double
 * execution on any deployment without a store, so an in-process claim is used and
 * REPORTED as `scope: 'instance'`. That covers the double-click (same instance,
 * milliseconds apart) which is the actual bug, and it cannot claim cross-instance
 * protection. `scope` ships in the receipt so nobody reads more safety into it
 * than exists.
 */
import { createHash, randomUUID } from 'node:crypto';
import {
  ACTION_STATUS, CI_SCHEMA, MUTATING_OPERATIONS, PERMISSION, SIGNATURE_REQUIRED_ACTIONS,
  STATE_SECTIONS, round
} from '../../src/lib/central/schema.js';
import { claimIdempotency, saveIdempotency } from '../idempotency.js';
import { storeGet, storeSet, storeDurable } from '../store.js';

export const ACTION_ENGINE_SCHEMA = 'fbt.central-action-engine.v1';
const MAX_PENDING = 40;
const MAX_RECENT = 60;
const PENDING_TTL_MS = 30 * 60_000;
const MEMORY_TTL_MS = 10 * 60_000;

const hash = (v) => createHash('sha256').update(String(v)).digest('hex').slice(0, 24);

export function createActionEngine({ modules = {}, events = null, log = () => {} } = {}) {
  const byOwner = new Map();
  const dedupe = new Map();

  const list = (owner) => {
    const key = String(owner || 'anon').slice(0, 80);
    if (!byOwner.has(key)) byOwner.set(key, { pending: [], recent: [] });
    return byOwner.get(key);
  };

  function prune(owner) {
    const bucket = list(owner);
    const now = Date.now();
    bucket.pending = bucket.pending.filter((a) => now - a.createdAt < PENDING_TTL_MS || a.status === ACTION_STATUS.VERIFYING);
    if (bucket.recent.length > MAX_RECENT) bucket.recent.splice(0, bucket.recent.length - MAX_RECENT);
    for (const [k, v] of dedupe) if (now - v.at > MEMORY_TTL_MS) dedupe.delete(k);
    return bucket;
  }

  function find(owner, actionId) {
    const bucket = list(owner);
    return bucket.pending.find((a) => a.actionId === actionId) || bucket.recent.find((a) => a.actionId === actionId) || null;
  }

  /** §34 — the three-key claim. Returns `{ replay: true, action }` on a hit. */
  async function claim({ owner, requestId = null, intentId = null, executionId = null, fingerprint }) {
    const keys = [
      requestId && `req:${hash(requestId)}`,
      intentId && `intent:${hash(intentId)}`,
      executionId && `exec:${hash(executionId)}`
    ].filter(Boolean);
    if (!keys.length) return { ok: true, scope: 'none', keys: [] };
    /* Durable claim first (cross-instance), memory claim as the floor. */
    const durable = await claimIdempotency(String(owner), 'ci-action', String(requestId || intentId || executionId), fingerprint);
    if (durable.ok === false && durable.code === 'IDEMPOTENCY_CONFLICT') {
      return { ok: false, code: 'IDEMPOTENCY_CONFLICT', detail: 'the same key was already used for a different payload', scope: 'durable' };
    }
    if (durable.ok && durable.replay) {
      const existing = [...list(owner).recent, ...list(owner).pending].find((a) => a.requestId && hash(a.requestId) === durable.result?.requestHash);
      return { ok: true, replay: true, action: existing || durable.result || null, scope: 'durable' };
    }
    const hit = keys.find((k) => dedupe.has(k));
    if (hit) {
      const record = dedupe.get(hit);
      const action = find(owner, record.actionId);
      events?.publish({ type: 'ACTION_REPLAYED', owner, payload: { key: record.keyKind, actionId: record.actionId }, source: 'anti-duplicate' });
      return { ok: true, replay: true, action: action || record.action || null, scope: 'instance', key: hit };
    }
    return { ok: true, replay: false, scope: durable.ok ? 'durable+instance' : 'instance', keys, durableClaim: durable.ok ? durable : null };
  }

  /**
   * Create the action record. Nothing runs from here — the record carries the
   * gates (`requiresConfirmation`, `verificationRequired`) so a consumer cannot
   * read a pending action as an instruction.
   */
  function create({
    owner, intentId = null, module: moduleId, actionType, operation = 'execute', input = {},
    quote = null, riskSnapshot = null, planDigest = null, requestId = null, executionId = null,
    requiresConfirmation = SIGNATURE_REQUIRED_ACTIONS.includes(String(actionType || '').toUpperCase()),
    verificationRequired = true, expiresAt = null
  }) {
    const now = Date.now();
    const moduleDef = modules[moduleId];
    const mutating = MUTATING_OPERATIONS.includes(operation) || SIGNATURE_REQUIRED_ACTIONS.includes(String(actionType || '').toUpperCase());
    const action = {
      schema: 'fbt.central-action.v1',
      brain: CI_SCHEMA,
      actionId: `act_${randomUUID().replace(/-/g, '').slice(0, 18)}`,
      intentId,
      requestId: requestId ? String(requestId).slice(0, 128) : null,
      executionId: executionId ? String(executionId).slice(0, 128) : null,
      module: moduleId,
      operation,
      actionType: String(actionType || 'ANALYZE').toUpperCase(),
      status: requiresConfirmation && mutating ? ACTION_STATUS.AWAITING_CONFIRMATION : ACTION_STATUS.PENDING,
      requiresConfirmation: requiresConfirmation && mutating,
      verificationRequired: mutating ? verificationRequired : false,
      confirmation: { granted: false, grantedAt: null, planDigest: null, method: null },
      permissionTier: mutating ? PERMISSION.EXECUTE : PERMISSION.READ,
      input: sanitizeInput(input),
      quote: quote ? { expectedOut: round(Number(quote.expectedOut) ?? null, 8), amountUsd: round(Number(quote.amountUsd) ?? null, 2), fromAsset: quote.fromAsset || null, toAsset: quote.toAsset || null, feeUsd: round(Number(quote.feeUsd) ?? null, 4), priceImpactPct: round(Number(quote.priceImpactPct) ?? null, 4), network: quote.chainId ?? quote.network ?? null, at: quote.at || now, expiresAt: quote.expiresAt || null, provider: quote.provider || quote.source || null } : null,
      risk: riskSnapshot ? { level: riskSnapshot.level || null, reasons: (riskSnapshot.reasons || []).slice(0, 4), confidence: round(Number(riskSnapshot.confidence) ?? null, 3) } : null,
      planDigest,
      signature: null,
      transaction: null,
      verification: null,
      result: null,
      failure: null,
      history: [{ status: requiresConfirmation && mutating ? ACTION_STATUS.AWAITING_CONFIRMATION : ACTION_STATUS.PENDING, at: now, reason: 'created' }],
      moduleComplete: moduleDef?.audit?.complete === true,
      createdAt: now,
      updatedAt: now,
      expiresAt: expiresAt || (mutating ? now + 90_000 : null)
    };
    const bucket = prune(owner);
    if (action.requiresConfirmation) {
      /* One awaiting-confirmation action per owner: two live cards on one screen
         is how a user approves the wrong one. The older card is cancelled
         explicitly rather than silently dropped, so the reply can say so. */
      for (const stale of bucket.pending.filter((a) => a.status === ACTION_STATUS.AWAITING_CONFIRMATION)) {
        transition(stale, ACTION_STATUS.CANCELLED, 'superseded by a newer confirmation request');
        bucket.recent.push(stale);
      }
      bucket.pending = [action, ...bucket.pending.filter((a) => a.status !== ACTION_STATUS.CANCELLED)].slice(0, MAX_PENDING);
    } else {
      bucket.pending.unshift(action);
      bucket.pending = bucket.pending.slice(0, MAX_PENDING);
    }
    return { action, replayed: false };
  }

  function transition(action, status, reason) {
    if (!Object.values(ACTION_STATUS).includes(status)) return { ok: false, code: 'UNKNOWN_ACTION_STATUS' };
    action.status = status;
    action.updatedAt = Date.now();
    action.history.push({ status, at: action.updatedAt, reason: String(reason || '').slice(0, 140) });
    if (action.history.length > 12) action.history.splice(0, action.history.length - 12);
    return { ok: true, action };
  }

  function confirm({ owner, actionId, planDigest = null, method = 'user-card' }) {
    const action = find(owner, actionId);
    if (!action) return { ok: false, code: 'ACTION_NOT_FOUND_OR_EXPIRED' };
    if (action.status !== ACTION_STATUS.AWAITING_CONFIRMATION && action.status !== ACTION_STATUS.PENDING) {
      return { ok: false, code: 'ACTION_NOT_CONFIRMABLE', status: action.status, detail: `the action is already ${action.status}; nothing will run twice` };
    }
    if (action.expiresAt && Date.now() > action.expiresAt) {
      transition(action, ACTION_STATUS.EXPIRED, 'confirmation window elapsed');
      return { ok: false, code: 'CONFIRMATION_EXPIRED', detail: 'the quote aged out; a fresh quote and a fresh confirmation are required' };
    }
    if (action.planDigest && planDigest && action.planDigest !== planDigest) {
      transition(action, ACTION_STATUS.BLOCKED, 'plan digest mismatch');
      return { ok: false, code: 'PLAN_CHANGED', detail: 'what is on screen is no longer what was authorised; nothing ran' };
    }
    action.confirmation = { granted: true, grantedAt: Date.now(), planDigest: planDigest || action.planDigest || null, method: String(method).slice(0, 24) };
    transition(action, ACTION_STATUS.PENDING, 'confirmed by user');
    return { ok: true, action };
  }

  function cancel({ owner, actionId, reason = 'user cancelled' }) {
    const action = find(owner, actionId);
    if (!action) return { ok: false, code: 'ACTION_NOT_FOUND_OR_EXPIRED' };
    if ([ACTION_STATUS.VERIFIED, ACTION_STATUS.BROADCAST].includes(action.status)) {
      return { ok: false, code: 'ALREADY_IN_FLIGHT', detail: 'the transaction is already on its way; cancelling here would not cancel it on chain', action };
    }
    transition(action, ACTION_STATUS.CANCELLED, reason);
    moveToRecent(owner, action);
    return { ok: true, action };
  }

  /** The signature handoff: the wallet signs, the engine records. */
  function recordHandoff({ owner, actionId, handoff }) {
    const action = find(owner, actionId);
    if (!action) return { ok: false, code: 'ACTION_NOT_FOUND_OR_EXPIRED' };
    action.signature = { requestedAt: Date.now(), requiresUserSignature: true, serverSigned: false, serverHoldsKey: false, handoff: handoff?.data?.handoff || handoff || null };
    transition(action, ACTION_STATUS.AWAITING_SIGNATURE, 'unsigned payload handed to the wallet');
    return { ok: true, action };
  }

  function recordSignature({ owner, actionId, txHash, chainId = null, network = null, from = null, to = null }) {
    const action = find(owner, actionId);
    if (!action) return { ok: false, code: 'ACTION_NOT_FOUND_OR_EXPIRED' };
    if (!/^(0x)?[0-9a-fA-F]{64}$/.test(String(txHash || ''))) return { ok: false, code: 'BAD_TX_HASH' };
    if (action.signature?.txHash && action.signature.txHash !== txHash) {
      /* One action, one transaction. A second hash on the same action is either a
         replaced tx or a bug, and executing the second one blind is how a user
         ends up with two swaps from one confirmation. */
      return { ok: false, code: 'ACTION_ALREADY_SIGNED', detail: 'this action already carries a different transaction hash', existing: action.signature.txHash };
    }
    action.signature = { ...(action.signature || {}), txHash, signedAt: Date.now(), from: from || null };
    action.transaction = { txHash, chainId, network: network || chainId || null, to: to || null, broadcastBy: 'user-wallet' };
    transition(action, ACTION_STATUS.BROADCAST, 'signed and broadcast by the wallet');
    return { ok: true, action };
  }

  /**
   * Verification is where §16 starts: the action is only "done" when the chain
   * agrees, and only then are the affected sections marked dirty. Marking them
   * dirty at broadcast time would refresh the UI onto numbers that a reverted
   * transaction never produced.
   */
  async function verify({ owner, actionId, module: moduleIdOverride, input = {} }) {
    const action = find(owner, actionId);
    if (!action) return { ok: false, code: 'ACTION_NOT_FOUND_OR_EXPIRED' };
    const moduleId = moduleIdOverride || action.module;
    const mod = modules[moduleId];
    if (!mod || typeof mod.verify !== 'function') return { ok: false, code: 'MODULE_HAS_NO_VERIFY', action };
    transition(action, ACTION_STATUS.VERIFYING, 'verification requested');
    const result = await mod.verify({ ...input, txHash: input.txHash || action.transaction?.txHash, chainId: input.chainId ?? action.transaction?.chainId }, { owner, intentId: action.intentId, actionId: action.actionId });
    action.verification = { status: result?.status || 'UNKNOWN', detail: result?.data?.consistency || result?.reason || null, at: Date.now(), source: result?.source || moduleId };
    if (result?.status === 'VERIFIED') {
      transition(action, ACTION_STATUS.VERIFIED, 'verified against the source of truth');
      action.result = { status: 'SUCCESS', data: result.data };
      events?.publish({ type: eventFor(action.actionType), owner, actionId: action.actionId, intentId: action.intentId, payload: { actionType: action.actionType, txHash: action.transaction?.txHash || null, module: action.module, verified: true }, source: 'action-engine' });
      events?.publish({ type: 'TRANSACTION_CONFIRMED', owner, actionId: action.actionId, payload: { actionType: action.actionType, chainId: action.transaction?.chainId ?? null }, source: 'action-engine' });
    } else if (result?.status === 'MISMATCH') {
      transition(action, ACTION_STATUS.FAILED, 'verification contradicted the action');
      action.failure = { code: 'VERIFICATION_MISMATCH', detail: action.verification.detail };
      events?.publish({ type: 'TRANSACTION_FAILED', owner, actionId: action.actionId, payload: { reason: 'receipt contradicts the requested action' }, source: 'action-engine' });
    } else {
      transition(action, ACTION_STATUS.BROADCAST, 'still pending on chain');
    }
    return { ok: true, action, pending: action.status === ACTION_STATUS.BROADCAST };
  }

  const eventFor = (actionType) => ({
    SWAP: 'SWAP_COMPLETED', BRIDGE: 'BRIDGE_COMPLETED', LEND: 'LENDING_COMPLETED',
    BORROW: 'LOAN_CREATED', REPAY: 'LOAN_REPAID', WITHDRAW: 'LENDING_COMPLETED',
    FARM: 'POSITION_CHANGED', ADD_LIQUIDITY: 'LIQUIDITY_CHANGED', REMOVE_LIQUIDITY: 'LIQUIDITY_CHANGED',
    OPEN_FUTURES: 'POSITION_CHANGED', CLOSE_FUTURES: 'POSITION_CHANGED', DYDX_ORDER: 'POSITION_CHANGED',
    REBALANCE: 'POSITION_CHANGED', CREATE_GOAL: 'GOAL_PROGRESS_CHANGED', OPTIMIZE_PLAN: 'GOAL_PROGRESS_CHANGED',
    SET_ALERT: 'ALERT_FIRED'
  }[String(actionType || '').toUpperCase()] || 'POSITION_CHANGED');

  function moveToRecent(owner, action) {
    const bucket = prune(owner);
    bucket.pending = bucket.pending.filter((a) => a.actionId !== action.actionId);
    bucket.recent.unshift(action);
    if (bucket.recent.length > MAX_RECENT) bucket.recent.length = MAX_RECENT;
    return action;
  }

  function markDedupe({ owner, action, claimResult }) {
    if (!claimResult?.keys?.length) return;
    for (const raw of claimResult.keys) {
      const kind = raw.split(':')[0];
      const keyKind = kind === 'req' ? 'requestId' : kind === 'intent' ? 'intentId' : 'executionId';
      dedupe.set(raw, { actionId: action.actionId, at: Date.now(), keyKind, action: { actionId: action.actionId, status: action.status } });
    }
    if (claimResult.durableClaim?.storageKey) {
      saveIdempotency(claimResult.durableClaim, { actionId: action.actionId, requestHash: action.requestId ? hash(action.requestId) : null, status: action.status, at: Date.now() }).catch(() => {});
    }
  }

  return {
    schema: ACTION_ENGINE_SCHEMA,
    brain: CI_SCHEMA,
    statuses: ACTION_STATUS,
    create,
    claim,
    markDedupe,
    confirm,
    cancel,
    transition,
    recordHandoff,
    recordSignature,
    verify,
    find,
    pending: (owner) => prune(owner).pending.filter((a) => [ACTION_STATUS.PENDING, ACTION_STATUS.AWAITING_CONFIRMATION, ACTION_STATUS.AWAITING_SIGNATURE, ACTION_STATUS.VERIFYING, ACTION_STATUS.BROADCAST].includes(a.status)),
    recent: (owner) => prune(owner).recent.slice(0, 12),
    /** §16: which sections an action's completion must refresh, via its events. */
    sectionsToRefresh(action) {
      const map = { swap: ['wallet', 'portfolio', 'risk', 'goals', 'alerts', 'transactions'], bridge: ['wallet', 'portfolio', 'risk', 'transactions'], lending: ['lending', 'positions', 'portfolio', 'risk', 'alerts', 'goals'], borrowing: ['borrowing', 'lending', 'positions', 'portfolio', 'risk', 'alerts'], goals: ['goals', 'profitPlan'], alerts: ['alerts'], transactions: ['transactions', 'wallet', 'portfolio'] };
      return map[action?.module] || ['transactions', 'wallet', 'portfolio', 'risk'];
    },
    async mirrorToStore(owner) {
      if (!storeDurable()) return { mirrored: false, reason: 'NO_DURABLE_STORE' };
      const bucket = prune(owner);
      const rows = [...bucket.pending, ...bucket.recent].slice(0, 20).map(({ input, ...rest }) => ({ ...rest, input: { keys: Object.keys(input || {}) } }));
      await storeSet(`ci:actions:v1:${owner}`, { at: Date.now(), actions: rows });
      return { mirrored: true, count: rows.length };
    },
    async restoreFromStore(owner) {
      if (!storeDurable()) return { restored: false, reason: 'NO_DURABLE_STORE' };
      const stored = await storeGet(`ci:actions:v1:${owner}`, null);
      if (!stored?.actions?.length) return { restored: false, reason: 'EMPTY' };
      const bucket = list(owner);
      for (const row of stored.actions) {
        if (!row?.actionId || bucket.pending.some((a) => a.actionId === row.actionId)) continue;
        bucket.pending.push({ ...row, input: {}, restored: true });
      }
      return { restored: true, count: stored.actions.length };
    },
    stats: (owner) => {
      const bucket = prune(owner);
      return { pending: bucket.pending.length, recent: bucket.recent.length, dedupeKeys: dedupe.size, durable: storeDurable() };
    }
  };
}

/**
 * Input sanitisation for stored action records. `input` is what a user asked for,
 * so it is kept small and non-secret; raw signature material and key-shaped
 * strings never enter an action that will be mirrored and logged (§35).
 */
function sanitizeInput(input = {}) {
  const out = {};
  for (const [k, v] of Object.entries(input || {}).slice(0, 24)) {
    if (/key|secret|signature|mnemonic|seed|passphrase|authorization/i.test(k)) continue;
    if (typeof v === 'string') out[k] = v.slice(0, 160);
    else if (typeof v === 'number' || typeof v === 'boolean' || v === null) out[k] = v;
    else if (Array.isArray(v)) out[k] = v.slice(0, 10).map((x) => (typeof x === 'object' ? Object.keys(x || {}).slice(0, 8) : x));
    else if (typeof v === 'object') out[k] = Object.fromEntries(Object.entries(v).slice(0, 12).map(([kk, vv]) => [kk, typeof vv === 'string' ? vv.slice(0, 80) : vv]));
  }
  return out;
}
