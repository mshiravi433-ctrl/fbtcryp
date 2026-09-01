/**
 * FBT INTENT AI — bridge quote adapter (read-only).
 * ---------------------------------------------------------------------------
 * ─── WHAT THIS FILE USED TO BE ──────────────────────────────────────────────
 * A mock. Verbatim:
 *
 *     const quote = {
 *       estimatedOutput: amount || '999000',
 *       fee: '1000',
 *       estimatedTime: 120,
 *       provider: 'lifi',
 *     };
 *
 * …with the comment "in production this would call LiFi/DeBridge". It fed
 * /api/intents/v1/bridge-quote, which fed the «نرخ پل» button on the Intent OS
 * cross-chain tab, AND it minted `bridge-provider` phase evidence attesting
 * that a provider had been health-checked. Both were false: nothing had been
 * checked, and 999000 was a number somebody typed.
 *
 * It now calls server/crossChain.js, which calls LI.FI. If the provider is
 * unavailable, this returns an error and the evidence goes stale — which is
 * the correct behaviour and was previously impossible, because a hard-coded
 * object can never be unavailable.
 */

import { createHash } from 'node:crypto';
import { verifyProviderHealth } from '../src/lib/intent-ai/operationalActivation.js';
import { getRoutes, resolveToken } from './crossChain.js';
import { summariseQuote } from '../src/services/cross-chain/core.js';

export const BRIDGE_QUOTE_SCHEMA = 'fbt.bridge-quote.v1';

/* Last REAL provider answer, for the evidence report below. */
let lastQuote = null;

/**
 * A real bridge quote for the Intent OS desk.
 *
 * Accepts either token addresses (`fromToken`/`toToken`) or plain symbols
 * (`token`), which are resolved against the provider's registry for each
 * chain. A symbol that does not exist on the destination chain is refused
 * rather than routed to something that merely shares a ticker.
 *
 * `fromAddress` is optional: without a connected wallet the answer is an
 * indicative route comparison, clearly flagged, and never signable.
 */
export async function getBridgeQuote(input = {}, { now = Date.now() } = {}) {
  const fromChain = input.fromChain;
  const toChain = input.toChain;

  const fromTokenRef = input.fromToken || input.token;
  const toTokenRef = input.toToken || input.token;

  const fromToken = await resolveToken(fromChain, fromTokenRef);
  if (!fromToken.ok) return { ok: false, code: fromToken.code, detail: fromToken.detail ?? null, side: 'from' };

  const toToken = await resolveToken(toChain, toTokenRef);
  if (!toToken.ok) return { ok: false, code: toToken.code, detail: toToken.detail ?? null, side: 'to' };

  const routes = await getRoutes({
    fromChain,
    toChain,
    fromToken: fromToken.token.address,
    toToken: toToken.token.address,
    fromAmount: input.amount ?? input.fromAmount,
    fromAddress: input.fromAddress || null,
    toAddress: input.toAddress || null,
    slippage: input.slippage ?? null
  }, { now });

  if (!routes.ok) return { ok: false, code: routes.code, detail: routes.detail ?? null };

  const best = routes.best;
  const digest = createHash('sha256')
    .update(JSON.stringify({ quoteId: best.quoteId, toAmount: best.toAmount, tool: best.tool }))
    .digest('hex');

  lastQuote = {
    provider: best.provider,
    digest,
    checkedAt: now,
    expiresAt: best.expiresAt
  };

  return {
    ok: true,
    schema: BRIDGE_QUOTE_SCHEMA,
    requestId: routes.requestId,
    quote: best,
    summary: summariseQuote(best),
    routes: routes.routes,
    provider: best.provider,
    indicative: Boolean(best.indicative),
    fromToken: fromToken.token,
    toToken: toToken.token
  };
}

/**
 * Bridge provider evidence for phase activation.
 *
 * Only earnable from a REAL answer that has not expired. The mock version
 * could mint this forever; now a provider outage correctly stales it.
 */
export function bridgeProviderEvidence({ now = Date.now() } = {}) {
  if (!lastQuote || lastQuote.expiresAt <= now) {
    return { ok: false, code: 'BRIDGE_QUOTE_STALE' };
  }

  return verifyProviderHealth({
    kind: 'bridge-provider',
    providerId: lastQuote.provider,
    digest: lastQuote.digest,
    checkedAt: lastQuote.checkedAt,
    expiresAt: lastQuote.expiresAt,
    available: true,
    attested: true,
    health: 'healthy'
  }, { now });
}

/** Bridge status for public reporting. */
export function bridgeStatus({ now = Date.now() } = {}) {
  return {
    schema: BRIDGE_QUOTE_SCHEMA,
    hasQuote: Boolean(lastQuote && lastQuote.expiresAt > now),
    provider: lastQuote?.provider || null,
    checkedAt: lastQuote?.checkedAt || null,
    stale: !lastQuote || lastQuote.expiresAt <= now
  };
}

/** Test seam — the evidence cache is process-wide. */
export function _resetBridgeQuoteCache() {
  lastQuote = null;
}
