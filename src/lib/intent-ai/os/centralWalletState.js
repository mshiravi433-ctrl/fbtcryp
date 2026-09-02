/**
 * FBT CENTRAL INTELLIGENCE — Single source of truth for wallet.
 *
 * Intent OS, Portfolio, Swap, Bridge and every other module MUST read this
 * snapshot rather than keeping a private "wallet = null" that never updates.
 * Nothing here stores a seed, private key or password. The wallet signs.
 */

import { emitEvent, EVENTS } from './eventBus.js';

export const CENTRAL_WALLET_SCHEMA = 'fbt.central-wallet-state.v1';

const DISCONNECTED = Object.freeze({
  schema: CENTRAL_WALLET_SCHEMA,
  connectionStatus: 'DISCONNECTED',
  address: null,
  solanaAddress: null,
  chainType: null,
  chainId: null,
  network: null,
  nativeBalance: null,
  tokenBalances: Object.freeze([]),
  provider: null,
  walletType: null,
  lastUpdated: 0,
  blockNumber: null,
  freshness: 'NONE',
  hydrating: false,
  canSign: false,
  version: 0,
  source: 'wallet-manager'
});

let state = { ...DISCONNECTED, tokenBalances: [] };
let prev = { address: null, chainId: null, solanaAddress: null, connected: false };

function now() {
  return Date.now();
}

export function getCentralWalletState() {
  return {
    ...state,
    tokenBalances: Array.isArray(state.tokenBalances) ? [...state.tokenBalances] : []
  };
}

export function isWalletConnected(snapshot = state) {
  const status = String(snapshot?.connectionStatus || '').toUpperCase();
  if (status === 'CONNECTED' || status === 'HYDRATING') return true;
  return Boolean(snapshot?.address || snapshot?.solanaAddress);
}

export function setCentralWalletState(patch = {}, { emit = true } = {}) {
  const next = {
    ...state,
    ...(patch || {}),
    schema: CENTRAL_WALLET_SCHEMA,
    lastUpdated: now(),
    version: (Number(state.version) || 0) + 1,
    source: patch.source || state.source || 'wallet-manager'
  };
  if (!Array.isArray(next.tokenBalances)) next.tokenBalances = [];

  const connected = isWalletConnected(next);
  if (!connected && !next.hydrating) {
    next.connectionStatus = 'DISCONNECTED';
  } else if (!next.connectionStatus) {
    next.connectionStatus = next.hydrating ? 'HYDRATING' : (connected ? 'CONNECTED' : 'DISCONNECTED');
  }
  if (next.hydrating && next.connectionStatus === 'CONNECTED') {
    next.connectionStatus = 'HYDRATING';
  }
  if (next.freshness == null) {
    next.freshness = !connected ? 'NONE' : (next.hydrating ? 'PENDING' : 'FRESH');
  }

  const was = prev;
  state = next;
  prev = {
    address: next.address || null,
    chainId: next.chainId ?? null,
    solanaAddress: next.solanaAddress || null,
    connected
  };

  if (!emit) return getCentralWalletState();

  try {
    if (connected && !was.connected) {
      emitEvent(EVENTS.WALLET_CONNECTED, sanitize(next), 'wallet-manager');
    } else if (!connected && was.connected) {
      emitEvent(EVENTS.WALLET_DISCONNECTED, sanitize(next), 'wallet-manager');
    } else if (connected && next.address && was.address && next.address !== was.address) {
      emitEvent(EVENTS.WALLET_ACCOUNT_CHANGED, sanitize(next), 'wallet-manager');
    }
    if (connected && next.chainId != null && was.chainId != null && Number(next.chainId) !== Number(was.chainId)) {
      emitEvent(EVENTS.WALLET_NETWORK_CHANGED, sanitize(next), 'wallet-manager');
    }
    if (connected && (was.connected || next.nativeBalance != null || next.tokenBalances.length)) {
      emitEvent(EVENTS.WALLET_UPDATED, sanitize(next), 'wallet-manager');
    }
  } catch { /* event bus is best-effort */ }

  return getCentralWalletState();
}

export function snapshotFromAppWallet(wallet = {}, extras = {}) {
  const address = wallet.address || extras.address || null;
  const solanaAddress = extras.solanaAddress || wallet.solanaAddress || null;
  const connected = Boolean((wallet.isConnected ?? wallet.connected) && (address || solanaAddress))
    || Boolean(address || solanaAddress);
  const hydrating = extras.hydrating === true || (connected && extras.balancesPending === true);
  return {
    schema: CENTRAL_WALLET_SCHEMA,
    connectionStatus: wallet.connecting ? 'CONNECTING' : (hydrating ? 'HYDRATING' : (connected ? 'CONNECTED' : 'DISCONNECTED')),
    address,
    solanaAddress,
    chainType: address ? 'EVM' : (solanaAddress ? 'SOLANA' : null),
    chainId: wallet.chainId ?? extras.chainId ?? null,
    network: wallet.chain?.name || extras.network || null,
    nativeBalance: wallet.nativeBalance ?? extras.nativeBalance ?? null,
    tokenBalances: extras.tokenBalances || extras.balances || [],
    provider: wallet.mode || extras.provider || null,
    walletType: wallet.mode || extras.walletType || null,
    canSign: Boolean((connected && wallet.locked !== true) || extras.canSign),
    hydrating,
    freshness: hydrating ? 'PENDING' : (connected ? (extras.freshness || 'FRESH') : 'NONE'),
    lastUpdated: now(),
    blockNumber: extras.blockNumber ?? null,
    source: extras.source || 'wallet-manager'
  };
}

export function mergeWalletSnapshots(primary, fallback) {
  const a = primary && typeof primary === 'object' ? primary : null;
  const b = fallback && typeof fallback === 'object' ? fallback : null;
  if (!a) return b ? { ...b } : getCentralWalletState();
  if (!b) return { ...a };
  const aConnected = isWalletConnected(a);
  const bConnected = isWalletConnected(b);
  if (bConnected && !aConnected) return { ...b, ...a, ...pickConnected(b), lastUpdated: Math.max(a.lastUpdated || 0, b.lastUpdated || 0) };
  return {
    ...b,
    ...a,
    address: a.address || b.address || null,
    solanaAddress: a.solanaAddress || b.solanaAddress || null,
    chainId: a.chainId ?? b.chainId ?? null,
    nativeBalance: a.nativeBalance ?? b.nativeBalance ?? null,
    tokenBalances: (Array.isArray(a.tokenBalances) && a.tokenBalances.length) ? a.tokenBalances : (b.tokenBalances || []),
    connectionStatus: aConnected ? (a.connectionStatus || 'CONNECTED') : (bConnected ? (b.connectionStatus || 'CONNECTED') : (a.connectionStatus || b.connectionStatus || 'DISCONNECTED')),
    hydrating: Boolean(a.hydrating || b.hydrating),
    canSign: Boolean(a.canSign || b.canSign),
    lastUpdated: Math.max(Number(a.lastUpdated) || 0, Number(b.lastUpdated) || 0)
  };
}

function pickConnected(snap) {
  return {
    connectionStatus: snap.connectionStatus || 'CONNECTED',
    address: snap.address || null,
    solanaAddress: snap.solanaAddress || null,
    canSign: snap.canSign,
    hydrating: snap.hydrating
  };
}

function sanitize(snap) {
  const out = { ...snap };
  for (const key of ['privateKey', 'seedPhrase', 'mnemonic', 'secret', 'password']) delete out[key];
  return out;
}

export function resetCentralWalletState() {
  state = { ...DISCONNECTED, tokenBalances: [] };
  prev = { address: null, chainId: null, solanaAddress: null, connected: false };
  return getCentralWalletState();
}
