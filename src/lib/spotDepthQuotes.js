/**
 * The network half of spot depth: asks the existing aggregator quote path
 * (`getQuote` in swap.js) for one non-binding quote per size, and stores the
 * curve in a short-lived cache. Everything that decides the numbers lives in
 * spotDepth.js; this file only moves bytes.
 */
import { getQuote } from './swap';
import {
  amountForUsd,
  buildDepthCurve,
  fetchDepthQuotes,
  referenceRateFrom,
  SPOT_DEPTH_SIZES_USD
} from './spotDepth';

/**
 * A quoteFn for one pair. Quotes are requested with zero slippage: the depth
 * curve measures price impact, not the user's tolerance. `fromAddress` is passed
 * through as the Swap page does, so sources that need it can answer.
 */
export function makeSpotQuoteFn({ provider, chainId, fromToken, toToken, fromUsdPrice, fromAddress = null }) {
  return async (sizeUsd) => {
    const amountIn = amountForUsd(sizeUsd, fromUsdPrice, fromToken?.decimals ?? 6);
    if (!amountIn) return null;
    const q = await getQuote({
      provider,
      chainId,
      fromToken,
      toToken,
      amountIn,
      slippage: 0,
      fromAddress
    });
    if (!q || q.error) return null;
    return { rate: q.rate, outAmount: q.amountOut };
  };
}

/**
 * Build (or reuse) the curve for one key. A fresh cache entry is returned as
 * is. A stale or missing one is rebuilt; an aborted build throws and stores
 * nothing, so a cancelled request cannot poison the cache.
 */
export async function loadSpotDepth({
  key,
  cache,
  quoteFn,
  sizes = SPOT_DEPTH_SIZES_USD,
  signal = null
}) {
  const hit = cache?.get(key);
  if (hit?.fresh) return { curve: hit.value.curve, refreshedAt: hit.at, fromCache: true };
  const quotes = await fetchDepthQuotes({ sizes, quoteFn, signal });
  if (signal?.aborted) throw Object.assign(new Error('ABORTED'), { name: 'AbortError' });
  const reference = referenceRateFrom(quotes);
  const curve = buildDepthCurve({ quotes, referenceRate: reference });
  const value = { curve, reference };
  cache?.set(key, value);
  return { curve, refreshedAt: Date.now(), fromCache: false };
}
