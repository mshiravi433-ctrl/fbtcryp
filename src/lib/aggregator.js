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
  43114: 'avalanche',
  /* Both verified live against the aggregator with our real fee receiver
     before being listed — see the note in chains.js. */
  59144: 'linea',
  146: 'sonic',
  /* Official KyberSwap slugs — see docs/NETWORKS-ADD-FA.md. The live fee-echo
     quote test that Linea/Sonic passed has NOT been rerun here (sandbox has no
     access to the aggregator); run it before enabling these for real volume. */
  5000: 'mantle',
  80094: 'berachain',
  130: 'unichain',
  143: 'monad'
};

/** Identifies our app to KyberSwap. Not a secret, not an API key. */
const CLIENT_ID = 'fbt-swap';

export const aggregatorSupports = (chainId) => Boolean(NETWORK_SLUG[chainId]);

/** Map our token shape to what the aggregator expects. */
export const toAggAddress = (token) => (token.native ? NATIVE_SENTINEL : token.address);

/**
 * ─── THE SAME-ORIGIN PROXY FALLBACK ────────────────────────────────────────
 * KyberSwap's API is called straight from the browser. For a user whose
 * network cannot reach aggregator-api.kyberswap.com — geo-filtering, a
 * hostile ISP, national censorship; Iranian customers hit all three — that
 * call dies at the network layer and the whole swap screen answers "no route
 * between these two tokens" even though the liquidity exists. The app's OWN
 * origin is reachable by anyone who can open the app at all, so when a
 * direct call fails at the NETWORK level (not with an authoritative
 * no-route answer) we retry the identical request through our server
 * (server/swapProxy.js), which forwards it from a datacenter.
 *
 * Only network-level failures trigger the retry. If the API answered "no
 * route", a datacenter would get the same answer — retrying would just add
 * latency.
 *
 * Resolved through apiBase() rather than a hardcoded '/api': inside the
 * packaged Android app a relative path points at the WebView's own
 * https://localhost and 404s, which silently disabled this fallback for
 * exactly the users it exists for.
 */
import { apiBase } from './apiBase';

const proxyBase = () => apiBase() + '/swap/kyber';

/** True when a failure means "the network path is broken", not "no route". */
function isNetworkFailure(err) {
  if (!err) return false;
  if (err.network === true) return true;
  if (err.name === 'AbortError' || err instanceof TypeError) return true;
  // 403 (geo-block), 429 (rate-limited), 5xx (upstream broken): retrying
  // from a different network can genuinely succeed for all three.
  if (err.status === 403 || err.status === 429 || (err.status >= 500 && err.status <= 599)) return true;
  return false;
}

async function aggFetchOnce(url, options = {}, timeout = 15000) {
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
      if (res.status === 403 || res.status === 429 || res.status >= 500) err.network = true;
      throw err;
    }
    return body;
  } catch (err) {
    if (err?.name === 'AbortError') {
      const e = new Error('AGG_TIMEOUT');
      e.network = true;
      throw e;
    }
    if (err instanceof TypeError) err.network = true;
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Fetch with the same-origin proxy as a network-level fallback.
 *
 * The proxied request carries the same query string (and body) as the direct
 * one, so it is a retry, not a different request. If the proxy also fails,
 * the ORIGINAL error is thrown — the proxy's failure says nothing about the
 * user's network.
 */
async function aggFetch(url, options = {}, timeout = 15000, proxyPath = null) {
  try {
    return await aggFetchOnce(url, options, timeout);
  } catch (err) {
    if (!proxyPath || !isNetworkFailure(err)) throw err;
    const q = url.includes('?') ? url.slice(url.indexOf('?') + 1) : '';
    const proxied = await aggFetchOnce(`${proxyBase()}/${proxyPath}${q ? `?${q}` : ''}`, options, timeout + 2000).catch(
      () => null
    );
    if (proxied) return proxied;
    throw err;
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

  const body = await aggFetch(`${AGG_BASE}/${slug}/api/v1/routes?${params.toString()}`, {}, 15000, 'routes');
  const summary = body?.data?.routeSummary;
  if (!summary) throw new Error('NO_ROUTE');

  /**
   * VERIFY THE FEE CAME BACK.
   *
   * This is the single most important assertion in the file. We ask for the
   * fee via query params, but the fee that actually gets enforced on-chain is
   * whatever ends up inside `routeSummary.extraFee` — that object is signed
   * into the calldata by /route/build. If the aggregator silently ignored our
   * params (bad address, fee larger than amountIn, an API change), the swap
   * would still succeed and the user would still pay gas, but WE would earn
   * nothing and nobody would notice for weeks.
   *
   * So we check the echo, and we check the recipient matches the address we
   * asked for — a mismatch means the fee is going somewhere that is not us,
   * which is worse than earning nothing.
   */
  if (feeBps > 0 && feeReceiver) {
    const echoed = summary.extraFee;
    if (!echoed || String(echoed.feeAmount) !== String(feeBps)) {
      throw new Error('FEE_NOT_APPLIED');
    }
    if (String(echoed.feeReceiver).toLowerCase() !== String(feeReceiver).toLowerCase()) {
      throw new Error('FEE_RECIPIENT_MISMATCH');
    }
  }

  return {
    routeSummary: summary,
    // Echoed back so callers can display and re-verify what will be charged.
    extraFee: summary.extraFee ?? null,
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
  }, 15000, 'build');

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
export async function executeAggregatorSwap({
  signer,
  chainId,
  quote,
  slippage = 0.5,
  deadlineMinutes = 20,
  expectFeeReceiver = null,
  expectFeeBps = 0
}) {
  const sender = await signer.getAddress();

  /**
   * Last line of defence before the user signs.
   *
   * `routeSummary` is what gets encoded into calldata, so this is the final
   * moment the fee can be checked against what we intended. A quote can sit on
   * screen for a while, and a stale or tampered one must not be signed.
   */
  if (expectFeeBps > 0 && expectFeeReceiver) {
    const fee = quote?.routeSummary?.extraFee;
    if (!fee || String(fee.feeAmount) !== String(expectFeeBps)) {
      throw new Error('FEE_NOT_APPLIED');
    }
    if (String(fee.feeReceiver).toLowerCase() !== String(expectFeeReceiver).toLowerCase()) {
      throw new Error('FEE_RECIPIENT_MISMATCH');
    }
  }

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
