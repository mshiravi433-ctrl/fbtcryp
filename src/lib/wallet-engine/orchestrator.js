/**
 * FBT WALLET ENGINE — WALLET ORCHESTRATOR
 * ---------------------------------------------------------------------------
 * The single door every wallet operation walks through:
 *
 *                    Wallet Core
 *                        │
 *              Wallet Orchestrator   ← this file
 *                        │
 *       ┌────────────────┼────────────────┐
 *       │                │                │
 *   EVM Adapter      Solana Adapter    BTC Adapter
 *
 * It glues three pure pieces together:
 *   · the registry      — which wallets exist
 *   · the capability    — what each wallet is allowed to do
 *   · the state machine — what state each wallet is in, with evidence gates
 *
 * A caller never mutates a wallet directly. It asks the orchestrator to move
 * it, and the orchestrator answers `{ ok, code, wallet, error }` — refusing
 * before anything is signed when the capability is missing, and refusing to
 * broadcast without a hash, to confirm without a receipt, and so on.
 *
 * ─── WHY THIS PREVENTS "تأیید شد ولی اجرا نشد" ──────────────────────────────
 * The state machine already makes SIGNED → CONFIRMED impossible without
 * BROADCASTED + PENDING. The orchestrator adds the capability gate in FRONT:
 * an operation is never even prepared on a wallet that cannot perform it, so
 * a user is never asked to approve something the wallet could not have sent.
 */

import { createWalletRegistry } from './registry.js';
import { declareWallet, hasCapability, selectWalletFor } from './capabilities.js';
import { advanceWallet, createWalletRecord, describeWalletState } from './walletStateMachine.js';

export const ORCHESTRATOR_SCHEMA = 'fbt.wallet-orchestrator.v1';

function recordFor(wallet) {
  if (!wallet) return null;
  /* A wallet registered through the capability engine still needs a state
     record; the orchestrator keeps the two synchronized by id. */
  return createWalletRecord({
    id: wallet.id,
    address: wallet.address || (wallet.accounts && wallet.accounts[0]),
    accounts: wallet.accounts || []
  });
}

export function createWalletOrchestrator({ registry = createWalletRegistry() } = {}) {
  const states = new Map();
  const ensureState = (id) => {
    if (states.has(id)) return states.get(id);
    const wallet = registry.get(id);
    const rec = recordFor(wallet);
    if (rec) states.set(id, rec);
    return rec;
  };

  const transition = (id, next, evidence = {}) => {
    const rec = ensureState(id);
    if (!rec) return { ok: false, code: 'WALLET_UNKNOWN', wallet: null, error: `no wallet "${id}" in the registry` };
    const res = advanceWallet(rec, next, evidence);
    if (res.ok) states.set(id, res.wallet);
    return { ...res, state: res.wallet ? describeWalletState(res.wallet.state) : null };
  };

  return {
    schema: ORCHESTRATOR_SCHEMA,
    registry,

    /** Register a wallet (raw or declared) and give it a state record. */
    register(input) {
      const wallet = registry.register(input);
      states.set(wallet.id, recordFor(wallet));
      return { ok: true, code: 'REGISTERED', wallet, state: 'CREATED' };
    },

    state(walletId) {
      const rec = ensureState(walletId);
      return rec ? { ...rec } : null;
    },

    /* ---- state ladder, each with its evidence gate ---- */
    connect(walletId, { address = null, accounts = null } = {}) {
      const wallet = registry.get(walletId);
      if (wallet) {
        const addr = address || (accounts && accounts[0]) || wallet.address || (wallet.accounts && wallet.accounts[0]);
        return transition(walletId, 'CONNECTED', { address: addr ? String(addr) : null });
      }
      return transition(walletId, 'CONNECTED', { address });
    },
    markReady(walletId) {
      return transition(walletId, 'READY');
    },
    prepareAction(walletId, operation) {
      const wallet = registry.get(walletId);
      if (!wallet) return { ok: false, code: 'WALLET_UNKNOWN', wallet: null, error: `no wallet "${walletId}"` };
      const capability = operation?.capability || operation?.type || null;
      if (capability && !hasCapability(wallet, capability)) {
        return {
          ok: false,
          code: 'CAPABILITY_MISSING',
          wallet,
          error: `wallet "${walletId}" (${wallet.family}) cannot perform "${capability}"`
        };
      }
      /* The spec ladder has READY between CONNECTED and ACTION_PREPARED. The
         orchestrator walks it for the caller — READY has no evidence gate of
         its own (accounts were proven at CONNECTED), so stepping through it
         here is convenience, not a skipped check. */
      const cur = ensureState(walletId)?.state;
      if (cur === 'CONNECTED') {
        const ready = transition(walletId, 'READY');
        if (!ready.ok) return ready;
      }
      return transition(walletId, 'ACTION_PREPARED', { operation });
    },
    requestSignature(walletId) {
      return transition(walletId, 'AWAITING_SIGNATURE');
    },
    markSigned(walletId, signature) {
      return transition(walletId, 'SIGNED', { signature });
    },
    markBroadcast(walletId, txHash) {
      return transition(walletId, 'BROADCASTED', { txHash });
    },
    markPending(walletId) {
      return transition(walletId, 'PENDING');
    },
    markConfirmed(walletId, receipt) {
      return transition(walletId, 'CONFIRMED', { receipt });
    },

    /* ---- terminal failure states ---- */
    fail(walletId, error) {
      return transition(walletId, 'FAILED', { error });
    },
    cancel(walletId, error = 'CANCELLED') {
      return transition(walletId, 'CANCELLED', { error });
    },
    expire(walletId, error = 'EXPIRED') {
      return transition(walletId, 'EXPIRED', { error });
    },

    /**
     * Prepare an operation on the best capable wallet without the caller
     * knowing which wallet that is. Returns the selected wallet + transition.
     * This is the "system decides which wallet fits which operation" path.
     */
    prepareOnBest({ operation, family = null, chainId = null } = {}) {
      const wallets = registry.list();
      const capability = operation?.capability || operation?.type || null;
      const sel = selectWalletFor({ wallets, capability, family, chainId });
      if (!sel.ok) return { ok: false, code: sel.code, wallet: null, reason: sel.reason };
      const step = this.prepareAction(sel.wallet.id, operation);
      return { ...step, selected: sel.wallet };
    }
  };
}

/* Re-export the bits callers most often need together with the orchestrator. */
export { declareWallet, selectWalletFor, hasCapability } from './capabilities.js';
export { advanceWallet, createWalletRecord, WALLET_STATES, WALLET_TERMINAL } from './walletStateMachine.js';
