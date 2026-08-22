/**
 * VELORA (formerly ParaSwap) — a THIRD price to compare against.
 * ---------------------------------------------------------------------------
 * ─── WHY IT WAS WORTH ADDING WHEN WE ALREADY HAVE TWO ───────────────────────
 * Asked to look hard for aggregators we had missed. Most of the candidates on
 * the list turned out to be unusable (see docs/API-AUDIT-FA.md for each one
 * and why). Velora is the exception, and it clears the two bars that matter:
 *
 *   1. NO API KEY. Verified by calling it with no credentials at all and
 *      getting a full route back. Every other aggregator tested — 1inch, 0x,
 *      OKX DEX, SimpleSwap, StealthEX — answered `Unauthorized`, `missing api
 *      key`, or `Wrong api key`.
 *
 *   2. IT PAYS US, WITHOUT REGISTRATION. `partnerFeeBps=70` came back as
 *      `partnerFee: 0.7` with a `destAmountAfterFee` field, using a partner
 *      name we invented on the spot. Nothing was signed up for.
 *
 * ─── THE PART THAT MAKES IT ACTUALLY USABLE ─────────────────────────────────
 * Their default is that fees accrue in a FeeClaimer contract which the partner
 * has to claim from later — an extra on-chain transaction, on Ethereum, paid
 * for by us. That would eat a 70 bps fee on any realistic volume.
 *
 * `isDirectFeeTransfer=true` (with `takeSurplus=true`, which their docs say it
 * requires) sends the fee straight to `partnerAddress` inside the same
 * transaction instead. Tested: accepted, with our own payout address, and the
 * fee still reported. That is the same shape as the KyberSwap and 0x
 * integrations and it is the only reason this is worth wiring.
 *
 * ─── QUOTE ONLY (UNLIKE OPENOCEAN, WHICH NOW EXECUTES) ──────────────────────
 * This does not execute. It returns a comparable number so the user can be
 * told when another venue would have paid more, and so we can see whether
 * Velora ever wins before moving real money through a fourth signing path.
 * Adding a second execution route doubles the surface where funds can go to
 * the wrong place, for a benefit we can measure by quoting alone.
 *
 * If it turns out to win often, promoting it to executable is a small change —
 * and by then we will have evidence rather than a guess.
 */

/** Their native-coin sentinel is the same one KyberSwap and OpenOcean use. */
export const VELORA_NATIVE = '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE';

const BASE = 'https://api.velora.xyz';

/**
 * Chains we support AND they support. Deliberately limited to our own list:
 * a better price on a chain we cannot execute on is a number we cannot honour,
 * and showing it would be worse than not showing it.
 */
const SUPPORTED = new Set([1, 56, 137, 42161, 10, 8453, 43114]);

export const veloraSupports = (chainId) => SUPPORTED.has(Number(chainId));

export const toVeloraAddress = (token) => (token.native ? VELORA_NATIVE : token.address);

/**
 * Shorter leash than the primary aggregator, same reasoning as OpenOcean: this
 * is a second opinion, and a user waiting on a spinner is worse off than a
 * user who gets KyberSwap's answer immediately.
 */
const TIMEOUT_MS = 3000;

/**
 * ─── THE SAME-ORIGIN PROXY FALLBACK (missing until now) ────────────────────
 * KyberSwap and OpenOcean both retry a network-level failure through the
 * app's own origin (server/swapProxy.js) — Velora never did, so a user whose
 * network cannot reach api.velora.xyz simply never saw it in the comparison,
 * which for a QUOTE-ONLY source is silent and invisible: the swap still
 * works off KyberSwap/OpenOcean, so nothing ever LOOKED broken, but exactly
 * the network conditions most likely to filter Kyber/OpenOcean (Iranian
 * mobile networks) filter this too, and those are the users this third
 * opinion was added FOR.
 *
 * Resolved through apiBase() so it also works inside the packaged app,
 * where a relative '/api' would 404 against the WebView's own localhost.
 */
import { apiBase } from './apiBase';

const proxyBase = () => apiBase() + '/swap/velora';

/** True when a failure means "the network path is broken", not "no route". */
function isNetworkFailure(err) {
  if (!err) return false;
  if (err.network === true) return true;
  if (err.name === 'AbortError' || err instanceof TypeError) return true;
  if (err.status === 403 || err.status === 429 || (err.status >= 500 && err.status <= 599)) return true;
  return false;
}

async function veloraFetchOnce(url, timeout) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { accept: 'application/json' } });
    const body = await res.json().catch(() => null);
    if (!res.ok || !body?.priceRoute) {
      const err = new Error(body?.error || `VELORA_HTTP_${res.status}`);
      err.status = res.status;
      if (res.status === 403 || res.status === 429 || res.status >= 500) err.network = true;
      throw err;
    }
    return body.priceRoute;
  } catch (err) {
    if (err?.name === 'AbortError') {
      const e = new Error('VELORA_TIMEOUT');
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
 * Fetch with the same-origin proxy as a network-level fallback — see the
 * file header. Only fires when the direct call failed at the network layer;
 * the proxied attempt sends the SAME query string, so it is a retry, not a
 * different request.
 */
async function veloraFetchPrices(params) {
  const direct = `${BASE}/prices?${params}`;
  try {
    return await veloraFetchOnce(direct, TIMEOUT_MS);
  } catch (err) {
    if (!isNetworkFailure(err)) throw err;
    const proxied = await veloraFetchOnce(`${proxyBase()}/prices?${params}`, TIMEOUT_MS + 2000).catch(() => null);
    if (proxied) return proxied;
    throw err;
  }
}

/**
 * Our project name, sent as `partner`.
 *
 * Lower case and unhyphenated to match the LI.FI integrator id, which had to
 * be `fbtswap` rather than `fbt-swap`. Consistency here is not cosmetic: an
 * analytics dashboard that splits our volume across two spellings makes the
 * numbers useless for deciding whether this route is worth executing.
 */
export const VELORA_PARTNER = 'fbtswap';

/**
 * Get a comparable quote.
 *
 * @returns a quote in the SAME shape the KyberSwap path returns, so
 *          lib/bestQuote.js never has to know which source it is holding.
 */
export async function getVeloraQuote({
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
  if (!veloraSupports(chainId)) throw new Error('CHAIN_UNSUPPORTED');

  const amountInWei = parseUnits(String(amountIn), fromToken.decimals);

  const params = new URLSearchParams({
    srcToken: toVeloraAddress(fromToken),
    destToken: toVeloraAddress(toToken),
    amount: String(amountInWei),
    srcDecimals: String(fromToken.decimals),
    destDecimals: String(toToken.decimals),
    side: 'SELL',
    network: String(chainId),
    partner: VELORA_PARTNER
  });

  /*
   * Ask for the fee so the comparison is like-for-like. Quoting Velora WITHOUT
   * our fee while quoting KyberSwap WITH it would make Velora look 70 bps
   * better on every single pair and it would win comparisons it should lose —
   * a bug that would be invisible and would cost the user money.
   */
  if (feeBps > 0 && feeReceiver) {
    params.set('partnerAddress', feeReceiver);
    params.set('partnerFeeBps', String(feeBps));
    /*
     * Straight to our wallet, not into their FeeClaimer. Their docs require
     * takeSurplus alongside it: "When isDirectFeeTransfer=true, please also
     * set takeSurplus=true".
     */
    params.set('isDirectFeeTransfer', 'true');
    params.set('takeSurplus', 'true');
  }

  const data = await veloraFetchPrices(params);

  /*
   * `destAmountAfterFee` when a fee was requested, `destAmount` otherwise.
   * Reading the wrong one would overstate the output by exactly our fee and
   * hand Velora an unearned win — the same trap as quoting without the fee.
   */
  const outRaw = data.destAmountAfterFee ?? data.destAmount;
  if (outRaw == null) throw new Error('NO_ROUTE');
  const amountOutWei = BigInt(outRaw);
  if (amountOutWei <= 0n) throw new Error('NO_LIQUIDITY');

  const bps = BigInt(Math.round((100 - slippage) * 100));
  const minOutWei = (amountOutWei * bps) / 10000n;
  const platformFeeWei = feeBps > 0 ? (amountInWei * BigInt(feeBps)) / 10000n : 0n;
  const amountOut = Number(formatUnits(amountOutWei, toToken.decimals));

  return {
    source: 'velora',
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
    hops: Array.isArray(data.bestRoute) ? data.bestRoute.length : 1,
    amountInUsd: Number(data.srcUSD) || 0,
    amountOutUsd: Number(data.destUSD) || 0,
    /*
     * NOT EXECUTABLE — see the file header. bestQuote.js checks this before a
     * quote is ever offered for signing, so a future refactor cannot
     * accidentally route a signature down a path that was never hardened.
     */
    executable: false
  };
}
