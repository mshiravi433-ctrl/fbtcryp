/**
 * OPENOCEAN — a second aggregator, quoted in parallel with KyberSwap; the
 * historical SOLE source on chains Kyber's gateway no longer serves
 * (Mantle, Scroll, zkSync Era — see KYBER_LIVE in lib/aggregator.js).
 *
 * NOTE 2026-09-13: OpenOcean's Cloudflare edge began challenging our server
 * (UPSTREAM_HTTP_403 on every chain, incl. BSC), so LI.FI (lib/lifi.js) is
 * now the PRIMARY source on Mantle/Scroll/zkSync Era. This module remains
 * the second opinion wherever OpenOcean's edge lets us through — the quote
 * is still fee-verified and executable, nothing about that changed.
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
 *   • As a SECOND opinion this carries a SHORTER timeout than the primary.
 *     If OpenOcean is slow, we do not wait for it — we ship KyberSwap's
 *     answer. As the PRIMARY (chains Kyber dropped) the caller passes a
 *     longer `timeoutMs`, because a 3s leash for the only routing source
 *     converts "slow network" into «مسیری بین این دو توکن وجود ندارد».
 *   • A rejection here is never fatal. The comparison layer treats a failed
 *     second opinion as "no second opinion", not as a broken quote.
 *
 * The result: total quote time is max(A, B) bounded by the shorter timeout,
 * not A + B. In the worst case it equals what we have today.
 *
 * ─── WHY IT IS EXECUTABLE NOW (THE "NO ROUTE" BUG) ──────────────────────────
 * This file used to be quote-only, which made KyberSwap the single point of
 * failure for the whole swap screen: a quote that cannot be signed can never
 * win the comparison (see lib/bestQuote.js), so whenever KyberSwap's API was
 * unreachable — a real, recurring condition for users whose network blocks
 * or throttles those domains, Iranian customers being the loudest — the app
 * answered "no route between these two tokens" even though OpenOcean had
 * found one. Every aggregator outage was a total swap outage.
 *
 * So OpenOcean now executes too. `executable: true` lets its quote WIN the
 * comparison, and `buildOpenOceanSwap()` turns it into signable calldata
 * through their documented /swap endpoint. The platform fee survives on this
 * path the same way it does on KyberSwap's: we pass `referrer` + `referrerFee`
 * and VERIFY, before signing, that the returned calldata actually carries our
 * referrer (via their /decodeInputData endpoint). We never sign a swap we
 * cannot prove pays us.
 *
 * ─── THE COST OF WINNING, STATED HONESTLY ───────────────────────────────────
 * OpenOcean keeps 20% of the referrer fee (their documented business model —
 * the same 20% Jupiter takes). The user still pays the full 70 bps we show
 * on screen; our net is 56 bps on a route we would otherwise have earned
 * nothing on at all. Losing 14 bps to a working route beats losing the whole
 * trade to a "no route" error.
 *
 * See `compareQuotes()` in lib/bestQuote.js for how the winner is chosen and
 * why we do not simply trust the bigger number.
 */

const OO_BASE = 'https://open-api.openocean.finance/v4';

/**
 * Chain id -> OpenOcean slug.
 *
 * ⚠️ Slugs are OpenOcean's OWN chain codes from their supported-chains table
 * (docs.openocean.finance/docs/overview/supported-chains, re-checked live
 * 2026-09-13) — not our names for the chains. Two of these were wrong until
 * today: OpenOcean's codes are `bera` (not `berachain`) and `uni` (not
 * `unichain`), so the "second opinion" quote on those two chains never had
 * a chance — it 404ed inside its 3s leash and nobody noticed, because
 * KyberSwap happened to be serving them. A slug that silently never works
 * is worse than no slug: it makes the comparison layer look redundant in
 * the one case where it is the safety net.
 *
 * Every chain we support on the KyberSwap path is here too — and it MUST be,
 * for a reason the 2026-09 chain additions made concrete: on the newer
 * networks OpenOcean is not just a price second-opinion, it is the ONLY
 * second routing source at all (Velora covers the seven originals). A chain
 * where KyberSwap alone has to find every route is a chain where "no route
 * between these two tokens" shows up for pairs the other aggregator would
 * have routed.
 *
 * The "a chain we cannot execute on is a quote we cannot honour" rule still
 * holds and is enforced by the same machinery as on the original seven:
 * execution goes through OpenOcean's own /swap endpoint (their router, their
 * calldata), and verifyOpenOceanFee() refuses to sign unless the built
 * calldata provably carries our referrer. A slug OpenOcean does not serve
 * simply fails its quote — the comparison layer drops it and KyberSwap
 * continues alone. That is strictly better than the chain having no second
 * source at all.
 *
 * Mirrored in server/swapProxy.js (OO_SLUG there) — keep both in lockstep.
 */
const OO_SLUG = {
  56: 'bsc',
  1: 'eth',
  137: 'polygon',
  42161: 'arbitrum',
  10: 'optimism',
  8453: 'base',
  43114: 'avax',
  59144: 'linea',
  146: 'sonic',
  5000: 'mantle',
  80094: 'bera',   /* their chain code is `bera`, not `berachain` */
  130: 'uni',      /* their chain code is `uni`, not `unichain` */
  143: 'monad',
  /* Scroll + zkSync Era + Mantle — OpenOcean serves all three (v4 registry:
     scroll-mainnet, zksync-mainnet, mantle-mainnet). Since 2026-09-11 these
     are not second-opinion slugs: Kyber's aggregator gateway answers HTTP
     *404* for `scroll`, `zksync` and `mantle` (re-probed 2026-09-13), and
     since 2026-09-13 LI.FI is the primary there while OpenOcean's edge
     blocks our server (UPSTREAM_HTTP_403) — see lib/lifi.js. swap.js still
     gives this source a primary-grade timeout, so the moment OpenOcean's
     edge lets us through again its better route can win the comparison. */
  534352: 'scroll',
  324: 'zksync',
  /* Robinhood Chain — OpenOcean's table lists it with the chain id itself
     as the chain code: `4663` (Swap API: Yes, native token address 0x0). */
  4663: '4663'
};

export const openOceanSupports = (chainId) => Boolean(OO_SLUG[chainId]);

/**
 * ─── HOW OPENOCEAN SPELLS "THE NATIVE COIN" (per chain) ────────────────────
 * OpenOcean's supported-chains table publishes a `Native Token Address`
 * column, and the values are NOT uniform. The Ethereum-family chains take
 * the classic 0xEeee…EEeE sentinel — but Mantle, Monad, Berachain, Sonic,
 * Avalanche, Robinhood and friends are listed with the ZERO address, and
 * Polygon with 0x…1010. A quote request that names the native coin with the
 * wrong spelling is not a routable request; it is a request for a token
 * that does not exist, and it dies with an opaque error that the screen
 * renders as «مسیری بین این دو توکن وجود ندارد» — on exactly the chains
 * (Mantle/Scroll/zkSync Era) where OpenOcean is the ONLY routing source,
 * i.e. a total outage.
 *
 * So the quote path no longer guesses one spelling: it tries the DOCUMENTED
 * spelling for the chain first, and on any failure retries once with the
 * other one. Whichever spelling produced the winning quote is carried on
 * the quote (`nativeAddress`) and reused at build/sign time, so the
 * transaction is built exactly like the quote we showed the user.
 *
 * Documented values re-read from OpenOcean's table on 2026-09-13.
 */
export const OO_NATIVE = '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE';
export const OO_ZERO = '0x0000000000000000000000000000000000000000';

const OO_NATIVE_BY_CHAIN = {
  56: OO_NATIVE,
  1: OO_NATIVE,
  137: '0x0000000000000000000000000000000000001010', // Polygon's native POL
  42161: OO_NATIVE,
  10: OO_NATIVE,
  8453: OO_NATIVE,
  43114: OO_ZERO,
  59144: OO_NATIVE,
  146: OO_ZERO,
  130: OO_NATIVE,
  80094: OO_ZERO,
  143: OO_ZERO,
  5000: OO_ZERO,
  534352: OO_NATIVE,
  324: OO_NATIVE,
  4663: OO_ZERO
};

/** The documented native spelling for a chain (falls back to the sentinel). */
export const ooNativeAddress = (chainId) => OO_NATIVE_BY_CHAIN[Number(chainId)] ?? OO_NATIVE;

/**
 * The two spellings a chain may accept, in try order:
 * the documented one first, the classic sentinel second.
 */
function nativeSpellings(chainId) {
  const documented = ooNativeAddress(chainId);
  return documented.toLowerCase() === OO_NATIVE.toLowerCase()
    ? [OO_NATIVE, OO_ZERO]
    : [documented, OO_NATIVE];
}

/** Address with the native coin spelled the way THIS quote's chain wants. */
const asOOAddress = (token, nativeAddress) => (token.native ? nativeAddress : token.address);

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

/*
 * ─── THE SAME-ORIGIN PROXY FALLBACK ────────────────────────────────────────
 * The aggregators are called straight from the browser. That is fast and
 * decentralised, but it means a user whose network cannot reach
 * open-api.openocean.finance (geo-filtering, a hostile ISP, national
 * censorship — Iranian customers hit all three) gets no quote at all, no
 * matter how healthy the API is. The app's OWN origin is reachable by anyone
 * who can open the app at all, so when the direct call fails at the NETWORK
 * level we retry the identical request through our server
 * (server/swapProxy.js), which forwards it from a datacenter. This turns a
 * hard "no route" into a working quote for exactly the users who were
 * locked out.
 *
 * Resolved through apiBase(): a hardcoded relative '/api' resolves to the
 * WebView's own https://localhost inside the packaged app and 404s, which
 * would silently disable this fallback exactly where it matters most.
 */
import { apiBase } from './apiBase';

const proxyBase = () => apiBase() + '/swap/oo';

/**
 * True when a failure means "the network path to the API is broken" rather
 * than "the API answered and this pair has no route". Only those failures
 * are worth retrying through the proxy; an authoritative no-route answer
 * would still be no-route from a datacenter.
 */
function isNetworkFailure(err) {
  if (!err) return false;
  if (err.network === true) return true;
  if (err.name === 'AbortError' || err instanceof TypeError) return true;
  // 403 (geo-block), 429 (rate-limited), 5xx (upstream broken): retrying from
  // a different network can genuinely succeed for all three.
  if (err.status === 403 || err.status === 429 || (err.status >= 500 && err.status <= 599)) return true;
  return false;
}

async function ooFetchOnce(url, timeout) {
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
      const err = new Error(body?.message || `OO_HTTP_${res.status}`);
      err.status = res.status;
      if (!res.ok && (res.status === 403 || res.status === 429 || res.status >= 500)) err.network = true;
      throw err;
    }
    return body.data;
  } catch (err) {
    if (err?.name === 'AbortError' || err instanceof TypeError) {
      if (err instanceof TypeError) err.network = true;
      else {
        const e = new Error('OO_TIMEOUT');
        e.network = true;
        throw e;
      }
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Fetch with the same-origin proxy as a network-level fallback.
 *
 * Only fires when the direct call failed at the network layer (see
 * `isNetworkFailure`); the proxied attempt sends the SAME query string PLUS
 * `chainId`, so it is a retry of the same pair on the same chain. If the
 * proxy also fails, the ORIGINAL error is thrown — the proxy's failure says
 * nothing about the user's network and would only confuse the caller.
 *
 * ─── WHY `chainId` MUST BE RE-INJECTED ──────────────────────────────────────
 * The direct OpenOcean URL puts the chain in the PATH (`/v4/scroll/quote`),
 * not the query string. The same-origin proxy has no path slug — it reads
 * `chainId` from the query and maps it to a slug server-side (see
 * `ooSlug` in server/swapProxy.js). Forwarding only the original query left
 * the proxy with no chain at all, so every network-fallback retry answered
 * `CHAIN_UNSUPPORTED` and the screen showed «اتصال به سرویس مسیریابی برقرار
 * نشد» for every pair on every chain whose direct call was filtered —
 * Iranian mobile networks on Scroll/zkSync/Mantle being the loudest case,
 * because those three have no second aggregator to rescue them.
 */
async function ooFetch(url, { timeout = OO_TIMEOUT_MS, endpoint = null, chainId = null } = {}) {
  try {
    return await ooFetchOnce(url, timeout);
  } catch (err) {
    if (!isNetworkFailure(err)) throw err;
    // The proxy routes are per-endpoint (/api/swap/oo/quote, /api/swap/oo/swap),
    // so the endpoint name has to survive into the proxied URL. chainId is
    // our routing key — inject it even though the direct URL never carried it.
    const q = url.includes('?') ? url.slice(url.indexOf('?') + 1) : '';
    const qs = new URLSearchParams(q);
    if (chainId != null && chainId !== '' && !qs.has('chainId')) qs.set('chainId', String(chainId));
    const proxied = await ooFetchOnce(
      `${proxyBase()}/${endpoint}?${qs.toString()}`,
      timeout + 2000
    ).catch(() => null);
    if (proxied) return proxied;
    throw err;
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
  formatUnits,
  timeoutMs = null
}) {
  const slug = OO_SLUG[chainId];
  if (!slug) throw new Error('CHAIN_UNSUPPORTED');

  const amountInWei = parseUnits(String(amountIn), fromToken.decimals);
  const leash = Number.isFinite(Number(timeoutMs)) && Number(timeoutMs) > 0 ? Number(timeoutMs) : OO_TIMEOUT_MS;

  /*
   * One quote attempt with a specific native-coin spelling. Everything else
   * (amount, fee, slippage) is identical between attempts — only the address
   * that names the chain's gas coin changes, so a retry is a genuinely
   * different request, not a blind re-send.
   */
  const quoteOnce = async (nativeAddress, timeout) => {
    const params = new URLSearchParams({
      inTokenAddress: asOOAddress(fromToken, nativeAddress),
      outTokenAddress: asOOAddress(toToken, nativeAddress),
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
     */
    if (feeBps > 0 && feeReceiver) {
      params.set('referrer', feeReceiver);
      params.set('referrerFee', String(bpsToPercent(feeBps)));
    }

    return ooFetch(`${OO_BASE}/${slug}/quote?${params.toString()}`, {
      endpoint: 'quote',
      chainId,
      timeout
    });
  };

  /*
   * Try the documented native spelling first, then the other one. When
   * neither side of the pair is the native coin, the spellings produce the
   * SAME request — retrying would just double the latency of a failing
   * call, so a single attempt is made.
   */
  const spellings = nativeSpellings(chainId);
  const attempts = fromToken.native || toToken.native
    ? spellings.map((nativeAddress, i) => ({
        nativeAddress,
        timeout: i === 0 ? leash : Math.min(leash, 6000)
      }))
    : [{ nativeAddress: spellings[0], timeout: leash }];

  let data = null;
  let usedNative = spellings[0];
  let lastErr = null;
  for (const attempt of attempts) {
    try {
      data = await quoteOnce(attempt.nativeAddress, attempt.timeout);
      usedNative = attempt.nativeAddress;
      break;
    } catch (err) {
      lastErr = err;
    }
  }
  if (!data) throw lastErr;

  const outWeiRaw = data?.outAmount;
  if (outWeiRaw == null) throw new Error('NO_ROUTE');
  const amountOutWei = BigInt(outWeiRaw);
  if (amountOutWei <= 0n) throw new Error('NO_LIQUIDITY');

  const bps = BigInt(Math.round((100 - slippage) * 100));
  const minOutWei = (amountOutWei * bps) / 10000n;
  const platformFeeWei = feeBps > 0 ? (amountInWei * BigInt(feeBps)) / 10000n : 0n;
  const amountOut = Number(formatUnits(amountOutWei, toToken.decimals));

  /*
   * The contract that will pull the input token when this quote executes.
   * OpenOcean's quote response names it `exchange` (their v4 docs) and the
   * swap response names the same contract `to`. It is what the user must
   * approve, and it is needed even before signing because the approval
   * happens in a separate transaction.
   */
  const spender = data?.exchange ?? data?.to ?? null;

  return {
    source: 'openocean',
    /* The native spelling this quote was priced with — build/sign reuse it. */
    nativeAddress: usedNative,
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
    spender,
    // `dexes` lists the venues the trade was split across.
    hops: Array.isArray(data.dexes) ? data.dexes.length : 1,
    amountInUsd: Number(data?.inToken?.volume) || 0,
    amountOutUsd: Number(data?.outToken?.volume) || 0,
    /*
     * EXECUTABLE — see the file header. A native-coin input needs no approval
     * at all, so a missing spender only disqualifies token inputs. If we
     * cannot name the spender we cannot safely approve, and an unapprovable
     * quote must not be allowed to win the comparison.
     */
    executable: fromToken.native ? true : Boolean(spender)
  };
}

/**
 * The chains where OpenOcean's on-chain `minOutput` guard is documented.
 *
 * `minOutput` is enforced by their exchange contract (the tx reverts if the
 * output would land below it), which is strictly stronger than relying on
 * their API's slippage maths alone. Their docs list support for Base, BNB
 * and Ethereum; it is only sent there, because sending an unsupported
 * parameter on another chain could make the whole request fail.
 */
const MIN_OUTPUT_CHAINS = new Set([56, 1, 8453]);

/**
 * Build the /swap request parameters for a signable OpenOcean transaction.
 *
 * Pure and exported so the unit suite can pin the money-relevant parts: the
 * fee must reach the API as a PERCENT of the input, `account` must be the
 * signer (without it the API returns a quote with no calldata), and
 * `minOutput` must only ever be sent on chains where it is supported.
 *
 * `nativeAddress` is the native-coin spelling the winning quote was priced
 * with (see the OO_NATIVE_BY_CHAIN note). Passing it through keeps the
 * signed transaction on the same interpretation of the pair as the quote
 * the user approved; when absent, the chain's documented spelling is used.
 */
export function ooSwapParams({
  chainId,
  fromToken,
  toToken,
  amountInWei,
  slippage = 0.5,
  account,
  feeBps = 0,
  feeReceiver = null,
  minOutWei = null,
  nativeAddress = null
}) {
  const native = nativeAddress || ooNativeAddress(chainId);
  const params = new URLSearchParams({
    inTokenAddress: asOOAddress(fromToken, native),
    outTokenAddress: asOOAddress(toToken, native),
    amountDecimals: String(amountInWei),
    gasPriceDecimals: String(defaultGasPriceWei(chainId)),
    slippage: String(Math.max(0.05, Math.min(50, slippage))),
    account: String(account)
  });

  if (feeBps > 0 && feeReceiver) {
    params.set('referrer', feeReceiver);
    params.set('referrerFee', String(bpsToPercent(feeBps)));
  }
  if (minOutWei != null && MIN_OUTPUT_CHAINS.has(Number(chainId))) {
    params.set('minOutput', String(minOutWei));
  }
  return params;
}

/**
 * Turn an OpenOcean quote into signable calldata.
 *
 * Called at signing time, not at quote time: like KyberSwap's /route/build,
 * the swap body is a firm quote that expires, so it is fetched fresh right
 * before the user signs.
 *
 * @returns {to, data, value, gasLimit, spender, amountOutWei, minOutWei}
 */
export async function buildOpenOceanSwap({
  chainId,
  fromToken,
  toToken,
  amountInWei,
  slippage = 0.5,
  account,
  feeBps = 0,
  feeReceiver = null,
  minOutWei = null,
  nativeAddress = null
}) {
  const slug = OO_SLUG[chainId];
  if (!slug) throw new Error('CHAIN_UNSUPPORTED');

  const params = ooSwapParams({
    chainId,
    fromToken,
    toToken,
    amountInWei,
    slippage,
    account,
    feeBps,
    feeReceiver,
    minOutWei,
    nativeAddress
  });

  const data = await ooFetch(`${OO_BASE}/${slug}/swap?${params.toString()}`, {
    endpoint: 'swap',
    chainId
  });
  if (!data?.to || !data?.data) throw new Error('BUILD_FAILED');

  const amountOutWei = BigInt(data.outAmount ?? '0');
  const bps = BigInt(Math.round((100 - slippage) * 100));

  return {
    to: data.to,
    data: data.data,
    value: BigInt(data.value ?? '0'),
    /*
     * Their `estimatedGas` is documented as a reference only; the docs
     * recommend estimating ourselves and multiplying by 1.25–2.5. We take
     * the middle of that range and let the wallet raise it if it disagrees —
     * under-estimating a swap reverts after charging gas, which is the one
     * failure mode this headroom exists to prevent.
     */
    gasLimit: data.estimatedGas ? (BigInt(data.estimatedGas) * 15n) / 10n : undefined,
    spender: data.to,
    amountOutWei,
    minOutWei: (amountOutWei * bps) / 10000n
  };
}

/**
 * Verify, by decoding the calldata OpenOcean just built for us, that our
 * `referrer` is actually inside the transaction.
 *
 * ─── WHY THIS EXISTS ────────────────────────────────────────────────────────
 * A JSON field proving we ASKED for a fee proves nothing about the calldata
 * we are about to sign — the same bug class that burned this repo with
 * KyberSwap. OpenOcean's own /decodeInputData endpoint returns the decoded
 * swap call including its `referrer`, so we check that the address inside the
 * transaction is OUR payout address before the user signs. Fail-closed: if
 * the endpoint is unreachable or the referrer does not match, this returns
 * false and the swap is refused (FEE_NOT_APPLIED), exactly like the KyberSwap
 * extraFee echo check.
 */
/**
 * POST once to a decode endpoint (direct OpenOcean or our same-origin proxy).
 * Returns the decoded body on HTTP success, or null on any failure.
 */
async function ooDecodeOnce(url, body, signal) {
  try {
    const res = await fetch(url, {
      method: 'POST',
      signal,
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify(body)
    });
    if (!res.ok) return { ok: false, status: res.status, body: null };
    const json = await res.json().catch(() => null);
    return { ok: true, status: res.status, body: json };
  } catch (err) {
    /* Network / abort — signal to the caller that a proxy retry is worth it. */
    if (err?.name === 'AbortError' || err instanceof TypeError) {
      return { ok: false, status: 0, body: null, network: true };
    }
    return { ok: false, status: 0, body: null, network: true };
  }
}

export async function verifyOpenOceanFee({ chainId, calldata, feeBps = 0, feeReceiver = null }) {
  if (!(feeBps > 0 && feeReceiver)) return true; // no fee configured — nothing to verify
  const slug = OO_SLUG[chainId];
  if (!slug) return false;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), OO_TIMEOUT_MS + 2000);
  try {
    /*
     * Their docs show the decode payload without the 0x prefix; real
     * calldata has it. Some deployments accept both, some only one — try
     * both spellings before giving up, because a formatting quirk must not
     * be able to turn a payable swap into a refused one.
     */
    const spellings = [calldata, String(calldata).replace(/^0x/, '')];
    let referrer = null;
    let lastStatus = 0;
    let sawNetworkFailure = false;
    for (const spelling of new Set(spellings)) {
      const payload = { data: spelling, method: 'swap' };
      const direct = await ooDecodeOnce(`${OO_BASE}/${slug}/decodeInputData`, payload, ctrl.signal);
      lastStatus = direct.status;
      if (direct.network) sawNetworkFailure = true;
      if (direct.ok) {
        referrer = direct.body?.desc?.referrer ?? direct.body?.data?.desc?.referrer ?? null;
        if (referrer) break;
      }
      /*
       * Same reachability rule as quote/swap: a network-level failure on the
       * direct decode is retried through our origin. chainId goes in the body
       * so the proxy can map it to the OpenOcean slug (path has no slug on
       * our side). Without this, SCR/ZK/Mantle users behind a filter could
       * quote and build successfully and then be refused at fee-check with
       * FEE_NOT_APPLIED for a route that actually paid us.
       */
      if (direct.network || direct.status === 403 || direct.status === 429 || direct.status >= 500) {
        const proxied = await ooDecodeOnce(
          `${proxyBase()}/decode`,
          { ...payload, chainId },
          ctrl.signal
        );
        lastStatus = proxied.status || lastStatus;
        if (proxied.ok) {
          referrer = proxied.body?.desc?.referrer ?? proxied.body?.data?.desc?.referrer ?? null;
          if (referrer) break;
        }
      }
    }
    const ok = Boolean(referrer) && String(referrer).toLowerCase() === String(feeReceiver).toLowerCase();
    if (!ok) {
      // eslint-disable-next-line no-console
      console.warn(
        `[openocean] fee verification failed: referrer=${referrer ?? '(missing)'} expected=${feeReceiver} ` +
          `(status ${lastStatus}${sawNetworkFailure ? ', network' : ''}) — swap refused`
      );
    }
    return ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Execute an OpenOcean swap. The user signs a plain transaction to
 * OpenOcean's exchange contract; we never take custody at any point.
 */
export async function executeOpenOceanSwap({
  signer,
  chainId,
  fromToken,
  toToken,
  quote,
  slippage = 0.5,
  expectFeeBps = 0,
  expectFeeReceiver = null
}) {
  const account = await signer.getAddress();

  const built = await buildOpenOceanSwap({
    chainId,
    fromToken,
    toToken,
    amountInWei: quote.amountInWei,
    slippage,
    account,
    feeBps: expectFeeBps,
    feeReceiver: expectFeeReceiver,
    minOutWei: quote.minOutWei,
    /* The native spelling the winning quote was priced with — the signed
       transaction must interpret the pair exactly like the quote shown. */
    nativeAddress: quote.nativeAddress || null
  });

  /*
   * Last line of defence before the user signs: the calldata we just built
   * must actually pay us. A stale or tampered quote must never reach the
   * wallet's signature prompt.
   */
  const feeOk = await verifyOpenOceanFee({
    chainId,
    calldata: built.data,
    feeBps: expectFeeBps,
    feeReceiver: expectFeeReceiver
  });
  if (!feeOk) throw new Error('FEE_NOT_APPLIED');

  const tx = await signer.sendTransaction({
    to: built.to,
    data: built.data,
    value: built.value,
    ...(built.gasLimit ? { gasLimit: built.gasLimit } : {})
  });

  return { hash: tx.hash, wait: () => tx.wait(), viaOpenOcean: true };
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
    43114: 25,    // Avalanche
    // 2026-09 additions. Order-of-magnitude only: a wrong guess costs a
    // slightly suboptimal route split, never user money.
    59144: 0.05,  // Linea
    146: 5,       // Sonic
    5000: 2,      // Mantle
    80094: 1,     // Berachain
    130: 0.05,    // Unichain
    143: 1,       // Monad
    534352: 0.05, // Scroll — ETH L2, same ballpark as Linea/Unichain
    324: 0.05,    // zkSync Era
    4663: 0.03    // Robinhood Chain — Arbitrum Orbit, ~0.03 gwei live probed
  }[chainId] ?? 5;
  // Kept integral: the endpoint wants wei with no decimal point.
  return Math.round(gwei * 1e9);
}
