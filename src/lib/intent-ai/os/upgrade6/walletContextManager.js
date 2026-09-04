/**
 * FBT AI / Intent OS — UPGRADE 6
 * Wallet-Aware Intelligence + Wallet Context Snapshot + Verification before Execution
 * Spec §14, §15, §16
 */

import { getCentralWalletState, isWalletConnected } from '../centralWalletState.js';

function now() { return Date.now(); }
function makeId(prefix = 'snap') {
  try {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return `${prefix}_${crypto.randomUUID()}`;
  } catch {}
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
}

/**
 * Wallet Context Snapshot per §15
 */
export function createWalletSnapshot({ address, chainId, chainType, balances, network, nativeBalance, solanaAddress, canSign } = {}) {
  const central = getCentralWalletState();
  return {
    snapshotId: makeId(),
    address: address || central.address || null,
    solanaAddress: solanaAddress || central.solanaAddress || null,
    chainId: chainId ?? central.chainId ?? null,
    chainType: chainType || central.chainType || (central.address ? 'EVM' : central.solanaAddress ? 'SOLANA' : null),
    chain: chainId ?? central.chainId ?? null,
    network: network || central.network || null,
    balances: balances || central.tokenBalances || [],
    nativeBalance: nativeBalance ?? central.nativeBalance ?? null,
    canSign: canSign ?? central.canSign ?? false,
    connected: isWalletConnected({ address: address || central.address, solanaAddress: solanaAddress || central.solanaAddress, connectionStatus: central.connectionStatus }),
    timestamp: now(),
    freshness: 'FRESH',
    source: 'wallet-context-manager'
  };
}

export function isSnapshotStale(snapshot, maxAgeMs = 30_000) {
  if (!snapshot) return true;
  return now() - (snapshot.timestamp || 0) > maxAgeMs;
}

/**
 * Wallet Context Manager — Global/Persistent
 * Spec §14: Wallet Provider → Global Wallet State → AI Context → Intent OS
 * NOT: Chat Component → Wallet State
 */
export class WalletContextManager {
  constructor() {
    this.currentSnapshot = null;
    this.history = [];
    this.listeners = new Set();
  }

  /**
   * Get current wallet state — always from central, never from chat component
   */
  getCurrent() {
    const central = getCentralWalletState();
    if (!central) return null;
    // Refresh snapshot if stale
    if (!this.currentSnapshot || isSnapshotStale(this.currentSnapshot, 15_000)) {
      this.currentSnapshot = createWalletSnapshot(central);
    }
    return this.currentSnapshot;
  }

  /**
   * Take snapshot before operation — Spec §15
   */
  takeSnapshot(extra = {}) {
    const snap = createWalletSnapshot({ ...getCentralWalletState(), ...extra });
    this.currentSnapshot = snap;
    this.history.push(snap);
    if (this.history.length > 50) this.history.shift();
    this.emit('WALLET_SNAPSHOT_TAKEN', snap);
    return snap;
  }

  /**
   * Restore context after navigation — Spec §15
   */
  restoreAfterNavigation() {
    const central = getCentralWalletState();
    if (!central || !isWalletConnected(central)) {
      return { restored: false, reason: 'no_wallet' };
    }
    this.currentSnapshot = createWalletSnapshot(central);
    this.emit('WALLET_CONTEXT_RESTORED', this.currentSnapshot);
    return { restored: true, snapshot: this.currentSnapshot };
  }

  /**
   * Verify before execution — Spec §16
   * Intent → Wallet State Refresh → Balance Refresh → Quote Refresh → Risk Check → Permission Check → User Confirmation → Wallet Signature → Execution → Verification
   */
  async verifyBeforeExecution({ intent, walletState = null, portfolioState = null, services = {} } = {}) {
    const steps = [];
    const start = now();

    // 1. Intent check
    steps.push({ step: 'INTENT', status: intent ? 'OK' : 'MISSING', at: now() });
    if (!intent) return { ok: false, reason: 'NO_INTENT', steps };

    // 2. Wallet State Refresh
    let wallet = walletState || this.getCurrent();
    if (!wallet) wallet = createWalletSnapshot();
    // Try to refresh from central
    const central = getCentralWalletState();
    if (central && isWalletConnected(central)) {
      wallet = createWalletSnapshot(central);
      steps.push({ step: 'WALLET_STATE_REFRESH', status: 'OK', at: now(), address: wallet.address });
    } else {
      steps.push({ step: 'WALLET_STATE_REFRESH', status: 'FAILED', at: now(), reason: 'WALLET_NOT_CONNECTED' });
      return { ok: false, reason: 'WALLET_NOT_CONNECTED', steps };
    }

    // 3. Balance Refresh
    try {
      if (services.walletService?.getBalances) {
        const balances = await services.walletService.getBalances({ address: wallet.address, chainId: wallet.chainId });
        if (balances) {
          wallet.balances = balances.balances || balances.tokenBalances || wallet.balances;
          steps.push({ step: 'BALANCE_REFRESH', status: 'OK', at: now(), count: wallet.balances.length });
        } else {
          steps.push({ step: 'BALANCE_REFRESH', status: 'STALE', at: now(), reason: 'NO_BALANCE_DATA' });
        }
      } else {
        steps.push({ step: 'BALANCE_REFRESH', status: 'SKIPPED', at: now(), reason: 'NO_SERVICE' });
      }
    } catch (e) {
      steps.push({ step: 'BALANCE_REFRESH', status: 'FAILED', at: now(), error: e.message });
      // Don't fail outright — use snapshot
    }

    // 4. Quote Refresh (if trading intent)
    if (['SWAP', 'BRIDGE', 'BUY', 'SELL'].includes(intent.type || intent.primaryIntent)) {
      try {
        if (services.swapService?.getQuote || services.bridgeService?.getQuote) {
          steps.push({ step: 'QUOTE_REFRESH', status: 'PENDING', at: now() });
          // Actual quote refresh happens in executionRuntime, mark as pending
        } else {
          steps.push({ step: 'QUOTE_REFRESH', status: 'SKIPPED', at: now() });
        }
      } catch (e) {
        steps.push({ step: 'QUOTE_REFRESH', status: 'FAILED', at: now(), error: e.message });
      }
    }

    // 5. Risk Check
    try {
      if (services.riskService?.check) {
        const risk = await services.riskService.check({ intent, wallet, portfolio: portfolioState });
        steps.push({ step: 'RISK_CHECK', status: risk?.allowed === false ? 'VIOLATION' : 'OK', at: now(), risk });
        if (risk?.allowed === false) {
          return { ok: false, reason: 'RISK_VIOLATION', risk, steps };
        }
      } else {
        steps.push({ step: 'RISK_CHECK', status: 'SKIPPED', at: now() });
      }
    } catch (e) {
      steps.push({ step: 'RISK_CHECK', status: 'FAILED', at: now(), error: e.message });
    }

    // 6. Permission Check
    steps.push({ step: 'PERMISSION_CHECK', status: wallet.canSign ? 'OK' : 'FAILED', at: now(), canSign: wallet.canSign });
    if (!wallet.canSign) {
      return { ok: false, reason: 'WALLET_LOCKED_OR_NO_SIGN', steps };
    }

    // 7. User Confirmation — handled by UI, just mark pending
    steps.push({ step: 'USER_CONFIRMATION', status: 'PENDING', at: now() });

    return {
      ok: true,
      wallet,
      steps,
      duration: now() - start,
      snapshotId: wallet.snapshotId,
      readyForSignature: true
    };
  }

  /**
   * Ensure wallet context is global/persistent, not tied to chat component
   */
  ensureGlobal() {
    // This manager itself is global singleton, not per-component
    return {
      isGlobal: true,
      hasWallet: isWalletConnected(getCentralWalletState()),
      snapshot: this.getCurrent()
    };
  }

  on(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  emit(type, payload) {
    for (const fn of this.listeners) {
      try { fn({ type, payload, at: now() }); } catch {}
    }
    try {
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('fbt:wallet-context', { detail: { type, payload } }));
      }
    } catch {}
  }

  getHistory() {
    return [...this.history];
  }

  clear() {
    this.currentSnapshot = null;
    this.history = [];
  }
}

// Singleton — global wallet state
let walletManagerInstance = null;
export function getWalletContextManager() {
  if (!walletManagerInstance) walletManagerInstance = new WalletContextManager();
  return walletManagerInstance;
}

export function resetWalletContextManager() {
  if (walletManagerInstance) walletManagerInstance.clear();
  walletManagerInstance = null;
}
