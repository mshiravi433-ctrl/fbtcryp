/**
 * FBT WALLET ENGINE — WALLET STATE MACHINE
 * ---------------------------------------------------------------------------
 * Every wallet-level action walks a fixed ladder:
 *
 *   CREATED → CONNECTED → READY → ACTION_PREPARED → AWAITING_SIGNATURE
 *           → SIGNED → BROADCASTED → PENDING → CONFIRMED
 *
 * and may land in a terminal failure state at any point:
 *
 *   FAILED | CANCELLED | EXPIRED
 *
 * This exists to make the class of bug the spec calls "تأیید شد ولی اجرا نشد"
 * — "the user approved it but nothing executed" — structurally impossible to
 * claim. Each state has an EVIDENCE GATE:
 *
 *   CONNECTED          requires an address
 *   READY              requires connected accounts
 *   ACTION_PREPARED    requires an operation descriptor
 *   SIGNED             requires a signature (or signed payload)
 *   BROADCASTED        requires a transaction hash
 *   PENDING            requires a transaction hash (still carried from above)
 *   CONFIRMED          requires a successful receipt — never reachable without
 *                      passing through BROADCASTED + PENDING first
 *
 * A wallet that is SIGNED but has no hash can never be CONFIRMED: it can only
 * go to BROADCASTED (with evidence) or FAILED. There is no shortcut from
 * "the user tapped approve" to "done".
 *
 * Pure and synchronous — no SDK, no network. Imported by the orchestrator,
 * the real-time tracker and the probes.
 */

import { isSuccessfulReceipt } from '../intent-ai/executionStateMachine.js';

export const WALLET_STATE_SCHEMA = 'fbt.wallet-state.v1';

export const WALLET_STATES = Object.freeze([
  'CREATED',
  'CONNECTED',
  'READY',
  'ACTION_PREPARED',
  'AWAITING_SIGNATURE',
  'SIGNED',
  'BROADCASTED',
  'PENDING',
  'CONFIRMED'
]);

export const WALLET_TERMINAL = Object.freeze(['FAILED', 'CANCELLED', 'EXPIRED']);

const FORWARD = Object.freeze({
  CREATED: ['CONNECTED'],
  CONNECTED: ['READY'],
  READY: ['ACTION_PREPARED'],
  ACTION_PREPARED: ['AWAITING_SIGNATURE'],
  AWAITING_SIGNATURE: ['SIGNED'],
  SIGNED: ['BROADCASTED'],
  BROADCASTED: ['PENDING'],
  PENDING: ['CONFIRMED'],
  CONFIRMED: []
});

const TERMINAL_SET = new Set(WALLET_TERMINAL);

function nowMs() { return Date.now(); }

/** A fresh wallet record in state CREATED. */
export function createWalletRecord(input = {}, { now = nowMs() } = {}) {
  return {
    schema: WALLET_STATE_SCHEMA,
    id: String(input.id || `wallet_${now.toString(36)}_${Math.random().toString(36).slice(2, 8)}`),
    state: 'CREATED',
    address: input.address ? String(input.address) : null,
    accounts: Array.isArray(input.accounts) ? input.accounts.map(String) : [],
    operation: input.operation && typeof input.operation === 'object' ? { ...input.operation } : null,
    signature: input.signature ?? null,
    txHash: input.txHash ?? null,
    receipt: input.receipt ?? null,
    error: input.error ?? null,
    createdAt: now,
    updatedAt: now
  };
}

export function canWalletAdvance(from, to) {
  return Array.isArray(FORWARD[from]) && FORWARD[from].includes(to);
}

export function isTerminalState(state) {
  return TERMINAL_SET.has(String(state || '').toUpperCase());
}

/** i18n key for a state, plus the human sentence the UI shows. */
export function describeWalletState(state) {
  const s = String(state || '').toUpperCase();
  const keys = {
    CREATED: 'state.created', CONNECTED: 'state.connected', READY: 'state.ready',
    ACTION_PREPARED: 'state.actionPrepared', AWAITING_SIGNATURE: 'state.awaitingSignature',
    SIGNED: 'state.signed', BROADCASTED: 'state.broadcasted', PENDING: 'state.pending',
    CONFIRMED: 'state.confirmed', FAILED: 'state.failed', CANCELLED: 'state.cancelled',
    EXPIRED: 'state.expired'
  };
  return { state: s, key: keys[s] || 'state.unknown' };
}

/**
 * Advance (or fail) a wallet record. Returns `{ ok, code, wallet, error }`.
 *
 * ─── EVIDENCE GATES ─────────────────────────────────────────────────────────
 * The transition is refused (`ok:false`, wallet unchanged) when the required
 * evidence is absent. This is the whole point: a missing hash cannot be
 * papered over.
 */
export function advanceWallet(wallet, nextStatus, { txHash = null, receipt = null, signature = null, operation = null, error = null, now = nowMs() } = {}) {
  if (!wallet || wallet.schema !== WALLET_STATE_SCHEMA) {
    return { ok: false, code: 'WALLET_INVALID', wallet, error: 'wallet record is not fbt.wallet-state.v1' };
  }
  const next = String(nextStatus || '').toUpperCase();
  const patch = (state, extra = {}) => {
    /* Precedence: an error carried in `extra` (e.g. NO_RECEIPT) wins over the
       generic `error` argument, which wins over whatever the wallet already
       carried. A transition's typed reason must never be clobbered. */
    const err = extra.error != null ? String(extra.error).slice(0, 200)
      : (error != null ? String(error).slice(0, 200) : wallet.error);
    return {
      ok: true,
      code: state === next ? 'OK' : 'TRANSITION_APPLIED',
      wallet: { ...wallet, state, ...extra, error: err, updatedAt: now },
      error: null
    };
  };

  /* Terminal failure states are always allowed (except from CONFIRMED). */
  if (TERMINAL_SET.has(next)) {
    if (wallet.state === 'CONFIRMED') {
      return { ok: false, code: 'ILLEGAL_TRANSITION', from: wallet.state, to: next, wallet, error: 'a confirmed action cannot be un-confirmed' };
    }
    return patch(next, { error: error != null ? String(error).slice(0, 200) : next });
  }

  if (!WALLET_STATES.includes(next)) {
    return { ok: false, code: 'UNKNOWN_STATE', from: wallet.state, to: next, wallet, error: `unknown state "${nextStatus}"` };
  }
  if (!canWalletAdvance(wallet.state, next)) {
    return { ok: false, code: 'ILLEGAL_TRANSITION', from: wallet.state, to: next, wallet, error: `cannot move ${wallet.state} → ${next}` };
  }

  /* Evidence gates — each one turns a missing fact into a typed refusal. */
  if (next === 'CONNECTED') {
    const addr = wallet.address || (wallet.accounts && wallet.accounts[0]);
    if (!addr) return { ok: false, code: 'ADDRESS_REQUIRED', from: wallet.state, to: next, wallet, error: 'CONNECTED requires an address' };
    return patch('CONNECTED', { address: wallet.address || String(wallet.accounts[0]) });
  }
  if (next === 'READY') {
    if (!wallet.address && !(wallet.accounts && wallet.accounts.length)) {
      return { ok: false, code: 'ACCOUNTS_REQUIRED', from: wallet.state, to: next, wallet, error: 'READY requires at least one account' };
    }
    return patch('READY');
  }
  if (next === 'ACTION_PREPARED') {
    if (!operation || typeof operation !== 'object' || Object.keys(operation).length === 0) {
      return { ok: false, code: 'OPERATION_REQUIRED', from: wallet.state, to: next, wallet, error: 'ACTION_PREPARED requires an operation descriptor' };
    }
    return patch('ACTION_PREPARED', { operation: { ...operation } });
  }
  if (next === 'AWAITING_SIGNATURE') {
    if (!wallet.operation) {
      return { ok: false, code: 'OPERATION_REQUIRED', from: wallet.state, to: next, wallet, error: 'cannot await a signature for an unprepared action' };
    }
    return patch('AWAITING_SIGNATURE');
  }
  if (next === 'SIGNED') {
    const evidence = signature != null ? signature : wallet.signature;
    if (evidence == null) {
      return { ok: false, code: 'SIGNATURE_REQUIRED', from: wallet.state, to: next, wallet, error: 'SIGNED requires a signature or signed payload' };
    }
    return patch('SIGNED', { signature: signature != null ? signature : wallet.signature });
  }
  if (next === 'BROADCASTED') {
    const hash = txHash || wallet.txHash;
    if (!hash) {
      /* The exact bug this machine exists to kill: "approved, never sent". */
      return { ok: false, code: 'TX_HASH_REQUIRED', from: wallet.state, to: next, wallet, error: 'BROADCASTED requires a transaction hash' };
    }
    return patch('BROADCASTED', { txHash: String(hash) });
  }
  if (next === 'PENDING') {
    if (!wallet.txHash) {
      return { ok: false, code: 'TX_HASH_REQUIRED', from: wallet.state, to: next, wallet, error: 'PENDING requires a broadcast transaction' };
    }
    return patch('PENDING');
  }
  if (next === 'CONFIRMED') {
    if (!wallet.txHash) {
      return { ok: false, code: 'TX_HASH_REQUIRED', from: wallet.state, to: next, wallet, error: 'CONFIRMED requires a broadcast transaction' };
    }
    const okReceipt = isSuccessfulReceipt(receipt || wallet.receipt);
    if (!okReceipt) {
      /* No receipt → no success. Refuse the confirmation, don't fake it. */
      return patch('FAILED', { error: 'NO_RECEIPT' });
    }
    return patch('CONFIRMED', { receipt: receipt || wallet.receipt });
  }
  return patch(next);
}
