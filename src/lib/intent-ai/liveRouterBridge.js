/**
 * FBT INTENT AI — LIVE ROUTER BRIDGE (Phase 6)
 * ---------------------------------------------------------------------------
 * Selects the EXISTING adapter for a draft's kind/chain. This is NOT a new
 * router — it is a thin selector over the real execution modules already in
 * the repo (swap.js, bridge.js, dydx.js, perp.js, dcaExecution.js,
 * smartWallet.js). It never builds a parallel route and never claims a venue
 * is live when it is not.
 *
 * Each venue descriptor carries:
 *   - `adapterName`  — which existing module is used
 *   - `requiresSigner / requiresProvider / requiresBrokerHandle / requiresDydxSession`
 *   - whether the venue is even implemented for live execution.
 *
 * IMPORTANT: This module stays import-safe in pure Node ESM — it does NOT
 * import ../chains.js (which uses extensionless imports that only resolve under
 * Vite). Chain support is supplied by the caller via `supportedChains`.
 */

export const LIVE_VENUES = Object.freeze(['swap', 'dydx', 'bridge', 'dca', 'broker', 'smartWallet']);

/**
 * Map a draft/plan to a live venue descriptor.
 * @param {object} draft  { kind, chainId, protocol, executionProvider }
 * @returns {{ok:boolean, venue?:string, adapterName?:string, requiresSigner?:boolean,
 *            requiresProvider?:boolean, requiresBrokerHandle?:boolean,
 *            requiresDydxSession?:boolean, implemented?:boolean, reason?:string}}
 */
export function routeForDraft(draft = {}) {
  const kind = String(draft.kind || draft.strategy || 'swap').toLowerCase();
  const chainId = draft.chainId;
  const proto = String(draft.protocol || '').toLowerCase();

  // Broker / custodial path (Phase 2).
  if (kind === 'broker' || proto === 'broker' || draft.broker === true) {
    return { ok: true, venue: 'broker', adapterName: 'brokerAdapter', requiresBrokerHandle: true, implemented: true };
  }

  // dYdX perp / futures path (Phase 2 adapter exists).
  if (kind === 'futures_open' || kind === 'futures' || kind === 'perp' || kind === 'perpetual_dydx' || proto === 'dydx') {
    return { ok: true, venue: 'dydx', adapterName: 'dydx', requiresSigner: true, requiresDydxSession: true, implemented: true };
  }

  // DCA schedule activation (local scheduling, not a one-shot swap).
  if (kind === 'dca' || kind === 'dcaschedule') {
    return { ok: true, venue: 'dca', adapterName: 'dcaExecution', requiresExplicitSignature: true, implemented: true };
  }

  // Smart wallet policy check (Phase 2 policy gate).
  if (kind === 'smart_wallet' || kind === 'smartwallet' || proto === 'smartwallet') {
    return { ok: true, venue: 'smartWallet', adapterName: 'smartWallet', requiresPolicy: true, implemented: true };
  }

  // Bridge: the repo only QUOTES bridges (no live execute bridge present).
  // Be honest: quote exists, live execution does not.
  if (kind === 'bridge' || kind === 'bridge_then_swap' || proto === 'bridge' || proto === 'bridge_router') {
    return { ok: true, venue: 'bridge', adapterName: 'bridge', requiresProvider: true, implemented: false, reason: 'BRIDGE_EXECUTE_UNAVAILABLE' };
  }

  // Same-chain swap (direct DEX + aggregator) — the default live path.
  if (kind === 'swap' || kind === 'spot_swap' || kind === 'smart_routed_spot' || kind === 'dex_aggregator' || proto === 'swap') {
    return { ok: true, venue: 'swap', adapterName: 'swap', requiresSigner: true, requiresProvider: true, implemented: true };
  }

  // Defi / others: not wired for live execution.
  return { ok: false, venue: null, adapterName: null, implemented: false, reason: 'NO_LIVE_ADAPTER' };
}

/** True when the chain id is contained in the runtime-supported chain set. */
export function chainSupportedForSwap(chainId, supportedChains = null) {
  if (!Array.isArray(supportedChains)) return true; // caller-controlled; no false exclusion
  return supportedChains.includes(Number(chainId));
}

/** Honest list of which venues are actually wired vs only configured:false. */
export function venueReadiness() {
  return {
    swap: { wired: true, configured: true, note: 'direct DEX + aggregator on EVM_CHAINS' },
    dydx: { wired: true, configured: true, note: 'requires a connected dYdX session + signer' },
    bridge: { wired: false, configured: false, note: 'quote exists; execute-bridge is not wired' },
    dca: { wired: true, configured: true, note: 'local schedule activation' },
    broker: { wired: true, configured: false, note: 'requires a bound broker handle' },
    smartWallet: { wired: true, configured: true, note: 'local policy gate' }
  };
}
