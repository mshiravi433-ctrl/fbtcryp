/**
 * KyberSwap Aggregator — zero-deployment fee collection.
 *
 * WHY THIS EXISTS
 * ---------------------------------------------------------------------------
 * The FeeRouter contract in contracts/ works, but it needs deploying, gas, and
 * ideally an audit before real volume. KyberSwap's aggregator already solves
 * this: their router contract is deployed, audited and handling billions in
 * volume, and its API accepts a `feeReceiver` + `feeAmount` pair. You pass your
 * wallet address, their contract splits the fee out and sends it to you inside
 * the same swap transaction.
 *
 * So: no contract to deploy, no gas to spend, no audit to commission, and
 * better prices as a bonus because the aggregator routes across every DEX on
 * the chain instead of just PancakeSwap.
 *
 * Trade-off, stated honestly: you depend on a third party. If KyberSwap's API
 * is down, quoting fails and the user sees a retry prompt — we deliberately do
 * NOT fall back to a fee-free swap, because this is a commercial product and
 * routing around our own revenue would be the wrong default. Deploy the
 * FeeRouter (`FEE_MODE=contract`) to remove the third-party dependency.
 *
 * Docs: https://docs.kyberswap.com/kyberswap-solutions/kyberswap-aggregator
 */

/** KyberSwap uses this sentinel for the chain's native coin. */
export const NATIVE_SENTINEL = '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE';

const AGG_BASE = 'https://aggregator-api.kyberswap.com';

/** Chain id -> KyberSwap network slug. */
const NETWORK_SLUG = {
  56: 'bsc',
  1: 'ethereum',
  137: 'polygon',
  42161: 'arbitrum',
  10: 'optimism',
  8453: 'base',
  43114: 'avalanche'
};

/** Identifies our app to KyberSwap. Not a secret, not an API key. */
const CLIENT_ID = 'fbt-swap';

export const aggregatorSupports = (chainId) => Boolean(NETWORK_SLUG[chainId]);

/** Map our token shape to what the aggregator expects. */
export const toAggAddress = (token) => (token.native ? NATIVE_SENTINEL : token.address);

async function aggFetch(url, options = {}, timeout = 15000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await fetch(url, {
      ...options,
      signal: ctrl.signal,
      headers: { 'content-type': 'application/json', 'x-client-id': CLIENT_ID, ...(options.headers ?? {}) }
    });
    const body = await res.json().catch(() => null);
    if (!res.ok || (body && body.code && body.code !== 0)) {
      const msg = body?.message || `HTTP ${res.status}`;
      const err = new Error(msg);
      err.status = res.status;
      throw err;
    }
    return body;
  } finally {
    clearTimeout(timer);
  }
}

/* -------------------------------------------------------------------------- */
/* Step 1: get a route (and quote)                                            */
/* -------------------------------------------------------------------------- */

/**
 * Ask the aggregator for the best route across all DEXes on the chain.
 *
 * The platform fee is declared here: `feeAmount` in basis points, charged on
 * the INPUT token, paid to `feeReceiver`. Their router enforces it on-chain —
 * it is not something the client can skip.
 */
export async function getAggregatorRoute({
  chainId,
  tokenIn,
  tokenOut,
  amountInWei,
  feeBps = 0,
  feeReceiver = null
}) {
  const slug = NETWORK_SLUG[chainId];
  if (!slug) throw new Error('CHAIN_UNSUPPORTED');

  const params = new URLSearchParams({
    tokenIn: toAggAddress(tokenIn),
    tokenOut: toAggAddress(tokenOut),
    amountIn: String(amountInWei),
    gasInclude: 'true'
  });

  // Only request a fee when we actually have somewhere to send it.
  if (feeBps > 0 && feeReceiver) {
    params.set('feeAmount', String(feeBps));
    params.set('isInBps', 'true');
    params.set('chargeFeeBy', 'currency_in');
    params.set('feeReceiver', feeReceiver);
  }

  const body = await aggFetch(`${AGG_BASE}/${slug}/api/v1/routes?${params.toString()}`);
  const summary = body?.data?.routeSummary;
  if (!summary) throw new Error('NO_ROUTE');

  return {
    routeSummary: summary,
    routerAddress: body.data.routerAddress,
    amountOutWei: BigInt(summary.amountOut),
    amountInWei: BigInt(summary.amountIn),
    gasUsd: Number(summary.gasUsd) || 0,
    amountInUsd: Number(summary.amountInUsd) || 0,
    amountOutUsd: Number(summary.amountOutUsd) || 0,
    // how many distinct DEXes the trade was split across
    hops: Array.isArray(summary.route) ? summary.route.length : 1
  };
}

/* -------------------------------------------------------------------------- */
/* Step 2: turn the route into signable calldata                              */
/* -------------------------------------------------------------------------- */

/**
 * `slippageBps` is enforced on-chain by their router, exactly like
 * `amountOutMin` on a raw DEX swap.
 */
export async function buildAggregatorTx({
  chainId,
  routeSummary,
  sender,
  recipient,
  slippageBps = 50,
  deadlineMinutes = 20
}) {
  const slug = NETWORK_SLUG[chainId];
  if (!slug) throw new Error('CHAIN_UNSUPPORTED');

  const body = await aggFetch(`${AGG_BASE}/${slug}/api/v1/route/build`, {
    method: 'POST',
    body: JSON.stringify({
      routeSummary,
      sender,
      recipient,
      slippageTolerance: slippageBps,
      deadline: Math.floor(Date.now() / 1000) + deadlineMinutes * 60,
      source: CLIENT_ID
    })
  });

  const data = body?.data;
  if (!data?.data) throw new Error('BUILD_FAILED');

  return {
    calldata: data.data,
    routerAddress: data.routerAddress,
    amountOutWei: BigInt(data.amountOut ?? routeSummary.amountOut),
    minAmountOutWei: BigInt(data.amountOutMin ?? '0'),
    gasLimit: data.gas ? BigInt(data.gas) : undefined,
    value: BigInt(data.transactionValue ?? '0')
  };
}

/* -------------------------------------------------------------------------- */
/* Convenience: quote in the same shape the rest of the app expects           */
/* -------------------------------------------------------------------------- */

/**
 * Produces a quote object structurally compatible with `swap.js`'s
 * `getQuote()`, so the UI renders it without special-casing.
 */
export async function getAggregatorQuote({
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
  const amountInWei = parseUnits(String(amountIn), fromToken.decimals);

  const route = await getAggregatorRoute({
    chainId,
    tokenIn: fromToken,
    tokenOut: toToken,
    amountInWei,
    feeBps,
    feeReceiver
  });

  const bps = BigInt(Math.round((100 - slippage) * 100));
  const minOutWei = (route.amountOutWei * bps) / 10000n;

  const platformFeeWei = feeBps > 0 ? (amountInWei * BigInt(feeBps)) / 10000n : 0n;
  const amountOut = Number(formatUnits(route.amountOutWei, toToken.decimals));

  return {
    source: 'aggregator',
    routeSummary: route.routeSummary,
    routerAddress: route.routerAddress,
    amountInWei,
    amountOutWei: route.amountOutWei,
    minOutWei,
    amountOut,
    minOut: Number(formatUnits(minOutWei, toToken.decimals)),
    rate: amountOut / Number(amountIn),
    platformFeeWei,
    platformFee: Number(formatUnits(platformFeeWei, fromToken.decimals)),
    feeBps,
    hops: route.hops,
    slippage,
    gasUsd: route.gasUsd,
    amountInUsd: route.amountInUsd,
    amountOutUsd: route.amountOutUsd
  };
}

/**
 * Execute an aggregator swap. The user signs a plain transaction carrying the
 * aggregator's calldata — we never take custody at any point.
 */
export async function executeAggregatorSwap({ signer, chainId, quote, slippage = 0.5, deadlineMinutes = 20 }) {
  const sender = await signer.getAddress();

  const built = await buildAggregatorTx({
    chainId,
    routeSummary: quote.routeSummary,
    sender,
    recipient: sender,
    slippageBps: Math.round(slippage * 100),
    deadlineMinutes
  });

  const tx = await signer.sendTransaction({
    to: built.routerAddress,
    data: built.calldata,
    value: built.value,
    ...(built.gasLimit ? { gasLimit: (built.gasLimit * 12n) / 10n } : {}) // +20% headroom
  });

  return { hash: tx.hash, wait: () => tx.wait(), viaAggregator: true };
}
