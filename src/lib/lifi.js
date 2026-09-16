/**
 * LI.FI — the third EXECUTABLE swap source.
 * ---------------------------------------------------------------------------
 * ─── WHY THIS EXISTS ─────────────────────────────────────────────────────────
 * Mantle (5000), Scroll (534352) and zkSync Era (324) have exactly ONE routing
 * source: OpenOcean (Kyber's gateway 404s their slugs — see KYBER_LIVE in
 * lib/aggregator.js). When OpenOcean's Cloudflare edge blocks our server —
 * a real, recurring condition, live-probed 2026-09-13 as UPSTREAM_HTTP_403
 * "Just a moment..." on EVERY chain including BSC — those three chains have
 * no quote path at all and the screen answers «دوباره امتحان کنید» forever.
 *
 * LI.FI is the independent replacement: no API key needed for quoting,
 * same-chain routes on all five of the newly added networks (live-probed
 * 2026-09-13: Mantle/Monad/Scroll/zkSync/Robinhood all return real routes),
 * and its integrator-fee system pays us exactly like KyberSwap's extraFee —
 * a FIXED fee split signed into the transaction calldata by their diamond
 * router, with our share sent to our own wallet inside the same transaction.
 *
 * It is also a second (or third) opinion on Monad (143) and Robinhood (4663),
 * where KyberSwap is primary: if Kyber's API is unreachable from the user's
 * network, LI.FI's quote still lets the swap go through.
 *
 * ─── THE FEE, STATED HONESTLY ───────────────────────────────────────────────
 * The fee split LI.FI signs is: our 70 bps (FEE_BPS) to our wallet PLUS a
 * fixed 25 bps LI.FI fee, so the user pays 95 bps total on a LI.FI-routed
 * swap. The UI shows the TOTAL (0.95%) — the same honesty rule as every other
 * source; hiding LI.FI's 25 bps would be a lie the receipt would expose.
 * `integratorFeeBps` on the quote records OUR cut, and the fee gate below
 * verifies exactly that share and its recipient before anything is signed.
 *
 * ─── WHY PROXY-ONLY (NO DIRECT CALL) ────────────────────────────────────────
 * `integrator` and `fee` decide where our revenue goes. They are attached
 * SERVER-side (server/lifi.js) and verified there too — a client that could
 * talk to li.quest directly could also quote without the fee, and a quote
 * without the fee must never exist in this app. The app's own origin is the
 * one network guarantee we have (see the same design in lib/aggregator.js),
 * so the request travels through GET /api/swap/lifi/quote.
 */

import { apiBase } from './apiBase.js';
import { EVM_CHAINS } from './chains.js';
import { FAMILY, isKnownPayoutAddress } from './payout.js';

const loadEthers = () => import('ethers');

/** How long we will wait for a LI.FI quote. Primary-grade on purpose: on the
 *  OpenOcean-only chains this may be the only source that answers. */
export const LIFI_TIMEOUT_MS = 15000;

/**
 * Chains where LI.FI is offered as a source.
 *
 * The five 2026-09 networks the user reported broken. On 5000/534352/324 it
 * is the primary (OpenOcean is unreachable upstream); on 143/4663 it is the
 * second opinion behind KyberSwap. The original seven chains keep their
 * existing Kyber + OpenOcean + Velora stack untouched — expanding this set
 * is a one-line change once a chain is live-probed with the fee echo.
 */
const LIFI_SWAP_CHAINS = new Set([5000, 534352, 324, 143, 4663]);

export const lifiSupports = (chainId) => LIFI_SWAP_CHAINS.has(Number(chainId));

/** LI.FI's integrator id — mirrored from server/lifi.js (attached server-side). */
export const LIFI_INTEGRATOR = 'fbt-swap';

const isAddr = (a) => typeof a === 'string' && /^0x[a-fA-F0-9]{40}$/.test(a);

/**
 * ─── THE FEE ECHO GATE ──────────────────────────────────────────────────────
 * Same discipline as KyberSwap's extraFee check and OpenOcean's decode check:
 * the fee that gets enforced on-chain is whatever LI.FI signs into the
 * calldata, so we verify the ECHO — the feeSplit signed for this quote — and
 * we verify the recipient. A quote that does not prove our cut goes to our
 * wallet is rejected before it can ever reach a signer.
 *
 * @returns {{ ok: boolean, code: string|null, totalFeeWei: bigint, shareWei: bigint }}
 */
export function verifyLifiFee({ body, feeBps = 0, feeReceiver = null, integratorId = LIFI_INTEGRATOR }) {
  const fromWei = BigInt(body?.action?.fromAmount ?? 0);
  const feeCosts = Array.isArray(body?.estimate?.feeCosts) ? body.estimate.feeCosts : [];
  const split = feeCosts.find((fc) => fc?.feeSplit && Array.isArray(fc.feeSplit.recipients))?.feeSplit ?? null;
  const ours = split?.recipients?.find((r) => String(r?.name) === integratorId) ?? null;

  if (String(body?.integrator ?? '') !== integratorId || Math.abs(Number(body?.fee ?? 0) - feeBps / 10000) > 1e-9) {
    return { ok: false, code: 'FEE_NOT_APPLIED', totalFeeWei: 0n, shareWei: 0n };
  }
  if (!ours || fromWei <= 0n) {
    return { ok: false, code: 'FEE_NOT_APPLIED', totalFeeWei: 0n, shareWei: 0n };
  }
  const shareWei = BigInt(String(ours.fee ?? 0));
  if (shareWei * 10000n !== fromWei * BigInt(feeBps)) {
    return { ok: false, code: 'FEE_NOT_APPLIED', totalFeeWei: 0n, shareWei: 0n };
  }
  if (!isAddr(feeReceiver)) {
    return { ok: false, code: 'FEE_RECIPIENT_MISMATCH', totalFeeWei: 0n, shareWei: 0n };
  }
  /* The recipient's wallet is signed via the integratorFees payload of the
     first step — the same place the server-side gate reads it. */
  const steps = Array.isArray(body?.includedSteps) ? body.includedSteps : [];
  const wallets = steps.flatMap((s) => s?.action?.integratorFees?.recipients ?? []);
  const walletEntry = wallets.find((r) => String(r?.name) === integratorId) ?? null;
  const wallet = walletEntry?.config?.defaultWallet ?? null;
  /*
   * ─── THE WALLET MUST BE OURS, NOT NECESSARILY THE ONE THIS BUILD NAMED ────
   * The fee wallet is attached SERVER-side from `LIFI_SWAP_FEE_RECIPIENT`
   * (server/lifi.js) — a variable this bundle cannot read. The client used to
   * demand it equal `feeRecipientFor(chainId)`, which is `VITE_FEE_RECIPIENT`
   * when that build variable exists. The website and the APK are built by two
   * pipelines with two variable sets, so the moment those two names diverged,
   * EVERY LI.FI quote failed here with FEE_RECIPIENT_MISMATCH — and since
   * LI.FI is the primary router on Mantle / Scroll / zkSync Era, the swap
   * screen reported «no route between these two tokens» for pairs that route
   * perfectly on the website. Same code, different build, opposite behaviour.
   *
   * The security property is unchanged: the wallet still has to be echoed by
   * LI.FI's own signed feeSplit AND be one of the operator's own addresses
   * (lib/payout.js#knownPayoutAddresses). A quote that pays a stranger is
   * still rejected before it can reach a signer.
   */
  const walletOk =
    isAddr(wallet) &&
    (wallet.toLowerCase() === feeReceiver.toLowerCase() || isKnownPayoutAddress(wallet, FAMILY.EVM));
  if (!walletOk) {
    return { ok: false, code: 'FEE_RECIPIENT_MISMATCH', totalFeeWei: 0n, shareWei: 0n };
  }

  const lifiFeeWei = BigInt(String(split.lifiFee ?? 0));
  return { ok: true, code: null, totalFeeWei: lifiFeeWei + shareWei, shareWei };
}

/** Checksummed address for a token, or the chain's native symbol. */
async function lifiTokenRef(token, chainId) {
  if (token.native) {
    const sym = EVM_CHAINS[chainId]?.native?.symbol;
    if (sym) return sym;
  }
  if (isAddr(token.address)) {
    try {
      const { getAddress } = await loadEthers();
      return getAddress(token.address);
    } catch {
      /*
       * Invalid EIP-55 mix (a display string that is neither lowercase nor
       * canonically checksummed — live-probed 2026-09-15 against LI.FI:
       * `0x06eFdBfF…F663a4` → 1003 «Could not find token», the lowercase and
       * the canonical forms of the SAME address → real quotes). Forwarding
       * the raw string hands LI.FI an address it refuses to resolve and the
       * screen still answers «مسیری بین این دو توکن وجود ندارد» — for a
       * token that routes perfectly. LI.FI accepts the all-lowercase form
       * and normalises it, so that is the honest fallback: a case the
       * upstream can read rather than one it cannot.
       */
      return token.address.toLowerCase();
    }
  }
  return token.address ?? token.symbol;
}

/**
 * Quote a same-chain swap through LI.FI (via our own proxy, which attaches
 * the integrator + fee and performs the server-side echo check first).
 *
 * Produces a quote object structurally compatible with swap.js's getQuote()
 * and with pickBestQuote() — `executable: true`, bigint amountOutWei — so it
 * can win the comparison and then be signed by executeLifiSwap().
 */
export async function getLifiQuote({
  chainId,
  fromToken,
  toToken,
  amountIn,
  slippage = 0.5,
  feeBps = 0,
  feeReceiver = null,
  fromAddress = null,
  parseUnits,
  formatUnits
}) {
  if (!isAddr(fromAddress)) throw new Error('BAD_FROM_ADDRESS');

  const amountInWei = parseUnits(String(amountIn), fromToken.decimals);

  const params = new URLSearchParams({
    fromChain: String(chainId),
    toChain: String(chainId),
    fromToken: await lifiTokenRef(fromToken, chainId),
    toToken: await lifiTokenRef(toToken, chainId),
    fromAmount: String(amountInWei),
    fromAddress,
    /* LI.FI takes slippage as a fraction (0.005 = 0.5%); the app works in
       percent (0.5). Clamped to LI.FI's accepted range. */
    slippage: String(Math.min(0.5, Math.max(0.0005, Number(slippage) / 100)))
  });

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), LIFI_TIMEOUT_MS);
  let res;
  try {
    res = await fetch(`${apiBase()}/swap/lifi/quote?${params.toString()}`, {
      signal: ctrl.signal,
      headers: { accept: 'application/json' }
    });
  } catch (err) {
    const e = err?.name === 'AbortError' ? new Error('LIFI_TIMEOUT') : new Error('LIFI_NETWORK');
    e.network = true;
    throw e;
  } finally {
    clearTimeout(timer);
  }

  const body = await res.json().catch(() => null);
  if (!res.ok || !body) {
    const err = new Error(body?.error || `LIFI_HTTP_${res.status}`);
    /* 502/504 from our proxy are transport problems, not "no route". */
    if (res.status >= 500 || res.status === 403 || res.status === 429) err.network = true;
    throw err;
  }

  /* Client-side fee gate — the alarm behind the server-side wall. */
  const fee = verifyLifiFee({ body, feeBps, feeReceiver });
  if (!fee.ok) throw new Error(fee.code);

  const est = body?.estimate ?? {};
  const tr = body?.transactionRequest;
  if (!tr?.to || !tr?.data) throw new Error('NO_TRANSACTION_REQUEST');
  if (Number(tr.chainId) !== Number(chainId)) throw new Error('CHAIN_MISMATCH');

  const amountOutWei = BigInt(est.toAmount);
  const minOutWei = BigInt(est.toAmountMin);
  if (amountOutWei <= 0n) throw new Error('NO_ROUTE');

  const amountOut = Number(formatUnits(amountOutWei, toToken.decimals));
  const gasUsd = (Array.isArray(est.gasCosts) ? est.gasCosts : []).reduce(
    (sum, g) => sum + (Number(g?.amountUSD) || 0),
    0
  );

  return {
    source: 'lifi',
    executable: true,
    amountInWei,
    amountOutWei,
    minOutWei,
    amountOut,
    minOut: Number(formatUnits(minOutWei, toToken.decimals)),
    rate: amountOut / Number(amountIn),
    /* The TOTAL the user pays: LI.FI's fixed fee + our cut. Displayed so the
       review sheet cannot understate what leaves the wallet. */
    platformFeeWei: fee.totalFeeWei,
    platformFee: Number(formatUnits(fee.totalFeeWei, fromToken.decimals)),
    feeBps: fee.totalFeeWei > 0n ? Number((fee.totalFeeWei * 10000n) / amountInWei) : 0,
    /* OUR cut, verified above — what the fee gate checks before signing. */
    integratorFeeBps: feeBps,
    slippage,
    hops: body.includedSteps?.filter((s) => s?.type === 'swap').length ?? 1,
    gasUsd,
    approvalAddress: isAddr(est.approvalAddress) ? est.approvalAddress : tr.to,
    routerAddress: tr.to,
    /* Everything executeLifiSwap and buildIntentTransactionRequest re-verify
       at signing time — the signed evidence, kept with the quote. */
    lifi: {
      integrator: body.integrator,
      fee: body.fee,
      feeSplit: body.estimate?.feeCosts?.find((fc) => fc?.feeSplit)?.feeSplit ?? null,
      feeWallet: body.includedSteps
        ?.flatMap((s) => s?.action?.integratorFees?.recipients ?? [])
        .find((r) => String(r?.name) === LIFI_INTEGRATOR)?.config?.defaultWallet ?? null,
      transactionRequest: {
        to: tr.to,
        data: tr.data,
        value: String(tr.value ?? '0'),
        gasLimit: String(tr.gasLimit ?? ''),
        chainId: Number(tr.chainId)
      },
      quotedAt: Date.now()
    }
  };
}

/**
 * Execute a LI.FI swap: send the exact transactionRequest LI.FI signed the
 * fee into. The user signs a plain transaction to LI.FI's diamond router —
 * we never take custody at any point.
 */
export async function executeLifiSwap({
  signer,
  chainId,
  quote,
  expectFeeBps = 0,
  expectFeeReceiver = null
}) {
  const lifi = quote?.lifi;
  const tr = lifi?.transactionRequest;
  if (quote?.source !== 'lifi' || !tr?.to || !tr?.data) throw new Error('LIFI_QUOTE_REQUIRED');
  if (Number(tr.chainId) !== Number(chainId)) throw new Error('CHAIN_MISMATCH');

  /* Last line of defence before the user signs — same rule as the aggregator
     and OpenOcean paths: re-verify OUR share and OUR wallet from the signed
     evidence, never from the display fields. */
  const fee = verifyLifiFee({
    body: {
      action: { fromAmount: String(quote.amountInWei) },
      estimate: { feeCosts: lifi.feeSplit ? [{ feeSplit: lifi.feeSplit }] : [] },
      includedSteps: lifi.feeWallet ? [{ action: { integratorFees: { recipients: [{ name: LIFI_INTEGRATOR, config: { defaultWallet: lifi.feeWallet } }] } } }] : [],
      integrator: lifi.integrator,
      fee: lifi.fee
    },
    feeBps: expectFeeBps,
    feeReceiver: expectFeeReceiver
  });
  if (!fee.ok) throw new Error(fee.code);

  const value = BigInt(tr.value || '0');
  const tx = await signer.sendTransaction({
    to: tr.to,
    data: tr.data,
    value,
    ...(tr.gasLimit ? { gasLimit: (BigInt(tr.gasLimit) * 12n) / 10n } : {}) // +20% headroom
  });

  return { hash: tx.hash, wait: () => tx.wait(), viaLifi: true };
}
