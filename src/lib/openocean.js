/**
 * OPENOCEAN — a second aggregator, quoted in parallel with KyberSwap.
 * ---------------------------------------------------------------------------
 * ─── WHY A SECOND ONE AT ALL ────────────────────────────────────────────────
 * We already route through KyberSwap, which searches every DEX on the chain —
 * so we are not going from "one pool" to "many". What changes is that no
 * single aggregator wins every pair. Their DEX coverage differs, their
 * splitting maths differs, and on any given trade one of them is simply
 * better. Asking both and taking the larger output is free money for the user
 * and costs us nothing.
 *
 * ─── WHY OPENOCEAN SPECIFICALLY ─────────────────────────────────────────────
 * Checked against the alternatives in 2026:
 *
 *   1inch   — requires an API key. Sign-up from Iran is unreliable.
 *   0x      — requires a key, and no free tier.
 *   LI.FI   — key required for anything but trivial volume.
 *   OpenOcean — NO API KEY, 40+ chains, and it supports `referrer` +
 *               `referrerFee`, which is how our 0.70% survives.
 *
 * That last point is not optional. A swap routed through an aggregator that
 * cannot pay us a fee is a swap we lose money on, so an integration without
 * fee support would be worse than none.
 *
 * ─── THE SPEED RULE, WHICH IS THE WHOLE DESIGN CONSTRAINT ───────────────────
 * The owner's requirement was "better price, without making the site slower".
 * A second HTTP call CAN make quoting twice as slow — if you await them in
 * sequence. So:
 *
 *   • Both aggregators are queried CONCURRENTLY (Promise.allSettled).
 *   • This one carries a SHORTER timeout than the primary. If OpenOcean is
 *     slow, we do not wait for it — we ship KyberSwap's answer.
 *   • A rejection here is never fatal. The comparison layer treats a failed
 *     second opinion as "no second opinion", not as a broken quote.
 *
 * The result: total quote time is max(A, B) bounded by the shorter timeout,
 * not A + B. In the worst case it equals what we have today.
 *
 * ─── WHAT THIS FILE DELIBERATELY DOES NOT DO ────────────────────────────────
 * It does not execute. It returns a comparable quote and nothing else.
 * Execution stays on the KyberSwap path we have already hardened — the fee
 * echo check, the recipient check, the re-quote before signing. Adding a
 * second signing path would double the surface area where money can go to the
 * wrong address, for a benefit we can get by quoting alone.
 *
 * See `compareQuotes()` in lib/bestQuote.js for how the winner is chosen and
 * why we do not simply trust the bigger number.
 */

/** OpenOcean uses the same native-coin sentinel as KyberSwap. */
export const OO_NATIVE = '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE';

const OO_BASE = 'https://open-api.openocean.finance/v4';

/**
 * Chain id -> OpenOcean slug.
 *
 * Deliberately limited to the chains we already support on the KyberSwap
 * path. OpenOcean covers 40+, but a chain we cannot execute on is a quote we
 * cannot honour, and showing a better price we are unable to deliver is worse
 * than not showing it.
 */
const OO_SLUG = {
  56: 'bsc',
  1: 'eth',
  137: 'polygon',
  42161: 'arbitrum',
  10: 'optimism',
  8453: 'base',
  43114: 'avax'
};

export const openOceanSupports = (chainId) => Boolean(OO_SLUG[chainId]);

export const toOOAddress = (token) => (token.native ? OO_NATIVE : token.address);

/**
 * Timeout for a second opinion.
 *
 * Shorter than the primary aggregator's 15s on purpose. This call is a bonus:
 * if it has not answered in three seconds, the user is better served by the
 * quote we already have than by a spinner. Three seconds is comfortably above
 * OpenOcean's typical response and well below the point a user notices a
 * delay.
 */
const OO_TIMEOUT_MS = 3000;

async function ooFetch(url, timeout = OO_TIMEOUT_MS) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { accept: 'application/json' }
    });
    const body = await res.json().catch(() => null);
    // OpenOcean answers 200 with a `code` field; a non-200 code is still a
    // failure even though the HTTP status was fine.
    if (!res.ok || !body || body.code !== 200) {
      throw new Error(body?.message || `OO_HTTP_${res.status}`);
    }
    return body.data;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Quote a swap.
 *
 * ─── WHY `gasPriceDecimals` IS SENT AND WHY IT IS A GUESS ───────────────────
 * The endpoint requires it. It only affects OpenOcean's internal
 * gas-vs-output optimisation, not the gas the user actually pays — the wallet
 * decides that at signing time. So a per-chain approximation is honest and
 * sufficient; fetching a live gas price would add a round trip to a call
 * whose entire purpose is to be fast.
 *
 * @returns a quote in the same shape the KyberSwap path returns, so the
 *          comparison layer never has to know which one it is holding.
 */
export async function getOpenOceanQuote({
  chainId,
  fromToken,
  toToken,
  amountIn,
  slippage = 0.5,
  feeBps = 0,
  feeReceiver = null,
  parseUnits,
  formatUnits
}) {
  const slug = OO_SLUG[chainId];
  if (!slug) throw new Error('CHAIN_UNSUPPORTED');

  const amountInWei = parseUnits(String(amountIn), fromToken.decimals);

  const params = new URLSearchParams({
    inTokenAddress: toOOAddress(fromToken),
    outTokenAddress: toOOAddress(toToken),
    amountDecimals: String(amountInWei),
    gasPriceDecimals: String(defaultGasPriceWei(chainId)),
    slippage: String(Math.max(0.05, Math.min(50, slippage)))
  });

  /*
   * Ask for the fee so the comparison is like-for-like.
   *
   * OpenOcean expresses `referrerFee` as a PERCENT (1.2 means 1.2%), while we
   * hold basis points. 70 bps -> 0.7. Getting this conversion wrong by a
   * factor of 100 would either quote a 70% fee (every quote fails) or a
   * 0.007% one (we compare against a number we cannot actually charge), so it
   * is unit-tested.
   *
   * Note this only makes the QUOTE comparable. We do not execute here, so no
   * fee is ever actually collected through OpenOcean today.
   */
  if (feeBps > 0 && feeReceiver) {
    params.set('referrer', feeReceiver);
    params.set('referrerFee', String(bpsToPercent(feeBps)));
  }

  const data = await ooFetch(`${OO_BASE}/${slug}/quote?${params.toString()}`);

  const outWeiRaw = data?.outAmount;
  if (outWeiRaw == null) throw new Error('NO_ROUTE');
  const amountOutWei = BigInt(outWeiRaw);
  if (amountOutWei <= 0n) throw new Error('NO_LIQUIDITY');

  const bps = BigInt(Math.round((100 - slippage) * 100));
  const minOutWei = (amountOutWei * bps) / 10000n;
  const platformFeeWei = feeBps > 0 ? (amountInWei * BigInt(feeBps)) / 10000n : 0n;
  const amountOut = Number(formatUnits(amountOutWei, toToken.decimals));

  return {
    source: 'openocean',
    amountInWei,
    amountOutWei,
    minOutWei,
    amountOut,
    minOut: Number(formatUnits(minOutWei, toToken.decimals)),
    rate: amountOut / Number(amountIn),
    platformFeeWei,
    platformFee: Number(formatUnits(platformFeeWei, fromToken.decimals)),
    feeBps,
    slippage,
    // `dexes` lists the venues the trade was split across.
    hops: Array.isArray(data.dexes) ? data.dexes.length : 1,
    amountInUsd: Number(data?.inToken?.volume) || 0,
    amountOutUsd: Number(data?.outToken?.volume) || 0,
    /*
     * NOT EXECUTABLE. The comparison layer checks this flag before ever
     * offering a quote for signing. OpenOcean's /swap endpoint would return
     * calldata, but we deliberately do not execute through it — see the file
     * header. Marking it explicitly means a future refactor cannot
     * accidentally route a signature down a path that was never hardened.
     */
    executable: false
  };
}

/** basis points -> percent, e.g. 70 -> 0.7 */
export function bpsToPercent(bps) {
  return Number(bps) / 100;
}

/**
 * A rough gas price per chain, in wei.
 *
 * Only used to let OpenOcean weigh route complexity against gas. The user's
 * wallet sets the real gas price at signing, so an approximation here cannot
 * cost anyone money — it can only make OpenOcean's route choice slightly less
 * optimal, and being roughly right is enough for that.
 */
function defaultGasPriceWei(chainId) {
  const gwei = {
    56: 1,        // BNB Chain is famously flat at ~1 gwei
    1: 20,        // Ethereum mainnet, order-of-magnitude
    137: 40,      // Polygon runs hot on gwei but the unit is worth little
    42161: 0.1,   // Arbitrum
    10: 0.001,    // Optimism
    8453: 0.005,  // Base
    43114: 25     // Avalanche
  }[chainId] ?? 5;
  // Kept integral: the endpoint wants wei with no decimal point.
  return Math.round(gwei * 1e9);
}
