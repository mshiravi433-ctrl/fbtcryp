/**
 * FBT INTENT AI — VENUE HEALTH (Phase 6)
 * ---------------------------------------------------------------------------
 * Reads whether a venue is CONFIGURED for live execution, without ever
 * revealing a secret. Fail-closed: a missing key, RPC, signer, provider, or
 * broker handle is reported as `status: 'unavailable'` — never a fake success.
 *
 * The status is deliberately coarse and honest:
 *   configured   — the venue has its required runtime inputs.
 *   unavailable  — something is missing; no execution is attempted.
 */

import { routeForDraft, chainSupportedForSwap } from './liveRouterBridge.js';
import { classifyFailure } from './failureModes.js';
import { describeWalletRuntime } from './walletRuntime.js';
import { bridgeWired } from './bridgeExecution.js';

/**
 * Phase 51: a CONNECTED wallet is a provider and a signer. When the caller
 * hands us the live wallet runtime, health is derived from it instead of
 * reporting NO_SIGNER/NO_PROVIDER against a wallet that is right there.
 */
function withWalletRuntime(ctx = {}) {
  if (!ctx.walletRuntime) return ctx;
  const wallet = describeWalletRuntime(ctx.walletRuntime);
  return {
    ...ctx,
    provider: ctx.provider || (wallet.hasProvider ? ctx.walletRuntime.provider : null),
    signer: ctx.signer || (wallet.canSign ? wallet.account : null),
    walletAccount: wallet.account,
    walletChainId: wallet.chainId
  };
}

/** Check health of a venue for a draft, given runtime capabilities. */
export function venueHealth(draft, rawCtx = {}) {
  const ctx = withWalletRuntime(rawCtx);
  const route = routeForDraft(draft);
  if (!route.ok) {
    return { ok: false, status: 'unavailable', venue: null, reasons: [route.reason], error: classifyFailure('UNKNOWN', { detail: route.reason }) };
  }

  const reasons = [];
  const venue = route.venue;

  if (venue === 'swap') {
    if (!chainSupportedForSwap(draft.chainId, ctx.supportedChains)) reasons.push('CHAIN_UNSUPPORTED');
    if (!ctx.provider) reasons.push('NO_PROVIDER');
    if (!ctx.signer) reasons.push('NO_SIGNER');
  } else if (venue === 'dydx') {
    if (!ctx.signer) reasons.push('NO_SIGNER');
    if (ctx.dydxConnected !== true) reasons.push('NO_DYDX_SESSION');
  } else if (venue === 'broker') {
    if (!ctx.brokerHandle) reasons.push('NO_BROKER_HANDLE');
  } else if (venue === 'bridge') {
    // Phase 54: BRIDGE_EXECUTE_UNAVAILABLE disappears only when a real bridge
    // adapter is actually attached — never because we wish it were.
    if (!bridgeWired(ctx)) reasons.push('BRIDGE_EXECUTE_UNAVAILABLE');
    else {
      if (!ctx.provider) reasons.push('NO_PROVIDER');
      if (!ctx.signer) reasons.push('NO_SIGNER');
      if (ctx.bridgeApproval?.confirmed !== true) reasons.push('BRIDGE_APPROVAL_REQUIRED');
    }
  } else if (venue === 'dca') {
    if (ctx.explicitSignature !== true) reasons.push('NO_EXPLICIT_SIGNATURE');
  } else if (venue === 'smartWallet') {
    if (!ctx.policy) reasons.push('NO_POLICY');
  }

  const configured = reasons.length === 0;
  return {
    ok: configured,
    venue,
    route,
    status: configured ? 'configured' : 'unavailable',
    reasons,
    // Never expose a secret-shaped field.
    secretsExposed: false,
    error: configured ? null : classifyFailure('MISSING_DATA', { detail: reasons.join(',') })
  };
}
