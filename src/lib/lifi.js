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
const LIFI_SWAP_CHAINS = new Set([56, 1, 137, 42161, 10, 8453, 43114, 59144, 146, 5000, 80094, 130, 143, 534352, 324, 4663]);

export const lifiSupports = (chainId) => LIFI_SWAP_CHAINS.has(Number(chainId));

/**
 * LI.FI's integrator ids — mirrored from server/lifi.js (attached server-side).
 *
 * ─── WHY A LIST AND NOT ONE STRING ─────────────────────────────────────────
 * LI.FI pays the integrator fee only for a VERIFIED integrator, and a verified
 * id is whatever the portal registered — the string is normalised on
 * registration (`fbt-swap` → `fbtswap` in the portal's own record, see
 * docs/LIFI-SETUP-FA.md §2, and the live lookup pinned in test/units.mjs). The server therefore sends whichever id of ours
 * LI.FI actually honours, and caches the winner. The client cannot know which
 * one that was, so it accepts the whole set: every id here is OURS, and the
 * proof that matters — the amount and the receiving wallet — is checked
 * against the signed fee split regardless of the label it travelled under.
 *
 * The first entry is the code default; the server may pick another.
 */
export const LIFI_INTEGRATOR_CANDIDATES = ['fbtswap', 'fbt-swap'];

/** The default id, kept exported for callers that only need one. */
export const LIFI_INTEGRATOR = LIFI_INTEGRATOR_CANDIDATES[0];

/**
 * Normalise an integrator id the way LI.FI's portal does: lower case, only
 * `[a-z0-9_-]`, at most 23 characters. Returns '' for anything unusable.
 */
export function normalizeIntegratorId(value) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '')
    .slice(0, 23);
}

/** Every integrator id that is ours, normalised and de-duplicated. */
export function integratorCandidates() {
  const out = [];
  for (const raw of LIFI_INTEGRATOR_CANDIDATES) {
    const id = normalizeIntegratorId(raw);
    if (id && !out.includes(id)) out.push(id);
  }
  return out;
}

/** True when `name` is one of our integrator ids (case-insensitive). */
export function isOurIntegratorName(name) {
  const id = normalizeIntegratorId(name);
  return Boolean(id) && integratorCandidates().includes(id);
}

const isAddr = (a) => typeof a === 'string' && /^0x[a-fA-F0-9]{40}$/.test(a);

/**
 * ─── READING A FEE AMOUNT WITHOUT TRUSTING ITS SHAPE ────────────────────────
 * LI.FI echoes fee amounts as integer base-unit strings in the common case —
 * but "common" is not "only": the same value can arrive as a decimal string
 * ("86419.2"), as a JSON number, or in the decimal.js-shaped `{ c: [...] }`
 * form the `includedSteps` payload already uses (see the fixtures in
 * test/fivechain-swap-probe.mjs). `BigInt(String(v))` throws on every one of
 * those except the integer string, and an uncaught throw here is exactly as
 * fatal as a rejection: the quote dies and the screen says «قیمت دریافت نشد».
 *
 * So: parse defensively, floor toward zero, and return null when the value
 * cannot be read at all — null is handled as a fee that is not proven, never
 * as an exception.
 */
export function parseFeeUnits(v) {
  if (v == null) return null;
  if (typeof v === 'bigint') return v < 0n ? null : v;
  if (typeof v === 'number') {
    if (!Number.isFinite(v) || v < 0) return null;
    return BigInt(Math.floor(v));
  }
  if (typeof v === 'object') {
    /* decimal.js-style { c: ['7000000000000'] } — the coefficient carries the
       whole magnitude when there is a single chunk. Anything more exotic is
       unreadable, and unreadable is "not proven". */
    const c = v.c;
    if (Array.isArray(c) && c.length === 1) return parseFeeUnits(c[0]);
    return null;
  }
  const s = String(v).trim();
  if (!/^\d+(\.\d+)?$/.test(s)) return null;
  const [intPart] = s.split('.');
  /* Floor: 86419.2 base units is 86419 units — never round a fee upward in
     our own favour before checking it against what was asked. */
  return BigInt(intPart);
}

/**
 * ─── THE FEE EVIDENCE GATE ──────────────────────────────────────────────────
 * Same discipline as KyberSwap's extraFee check and OpenOcean's decode check:
 * the fee that gets enforced on-chain is whatever LI.FI signs into the
 * calldata, so we verify the SIGNED SPLIT — the recipients LI.FI put in
 * `estimate.feeCosts[].feeSplit` — and we verify the wallet that split pays.
 * A quote that does not prove our cut goes to our wallet is rejected before it
 * can ever reach a signer.
 *
 * ─── WHERE THE PROOF ACTUALLY LIVES (2026-10-22, the total-outage bug) ──────
 * The gate used to require two TOP-LEVEL fields on the quote body:
 *
 *     body.integrator === <our id>       and   body.fee === feeBps / 10000
 *
 * `fee` is a REQUEST parameter only. LI.FI's own response types — the
 * published `@lifi/types` package, `StepBase`/`LiFiStep` — carry `integrator`
 * (optional), `intermediary`, `referrer`, `action`, `estimate`,
 * `includedSteps`, `transactionRequest` … and NO `fee` field at all. So
 * `Number(body.fee ?? 0)` was always 0, `|0 − 0.007| > 1e-9` was always true,
 * and EVERY LI.FI quote was thrown away as FEE_NOT_APPLIED.
 *
 * That is exactly the reported shape of the outage: zkSync Era (LI.FI is the
 * only fee-carrying executor) showed «مشکلی پیش آمده» for every pair, Scroll
 * almost always, Monad/Robinhood whenever KyberSwap's slug was unavailable —
 * and it survived the earlier rounding/wallet patches because the gate died
 * one line before reaching them.
 *
 * The same audit found the wallet check reading a field that does not exist
 * either: `includedSteps[].action.integratorFees` is absent from the response
 * types. The modern proof is `feeSplit.recipients[].walletAddress` — the
 * source-chain address each recipient is paid at. The legacy shape is still
 * accepted (older/proxied bodies, and the synthetic bodies built at signing
 * time), but it is no longer the ONLY way to prove the wallet.
 *
 * ─── THE ROUNDING BAND, AND WHY EXACT EQUALITY WAS A BUG ────────────────────
 * LI.FI computes the share as a fraction of fromAmount and rounds it DOWN to a
 * whole base unit (their fee-forwarder docs: "each amount rounds down"). The
 * old gate demanded `share * 10000 === fromAmount * feeBps` — an exact
 * product — so EVERY quote whose input amount did not divide cleanly was
 * rejected as FEE_NOT_APPLIED: a MAX-balance swap (18-decimal dust), a
 * 6-decimal stable typed past the third decimal, anything. The band is ±1 base
 * unit around floor(fromAmount × feeBps / 10000): floor is LI.FI's documented
 * rounding, +1 covers a half-up implementation, −1 covers a double
 * truncation. Anything wider is not rounding — a half share is still refused.
 *
 * @returns {{ ok: boolean, code: string|null, totalFeeWei: bigint, shareWei: bigint }}
 */
export function verifyLifiFee({ body, feeBps = 0, feeReceiver = null, integratorId = null }) {
  const ids = new Set(integratorCandidates());
  if (integratorId) ids.add(normalizeIntegratorId(integratorId));

  let fromWei = 0n;
  try {
    fromWei = BigInt(body?.action?.fromAmount ?? 0);
  } catch {
    fromWei = 0n;
  }
  if (fromWei <= 0n) {
    return { ok: false, code: 'FEE_NOT_APPLIED', totalFeeWei: 0n, shareWei: 0n };
  }

  /*
   * ─── THE IDENTITY ECHO IS ADVISORY, THE NUMBERS ARE NOT ─────────────────
   * `integrator` is optional in the response. When it IS present it must name
   * one of OUR registered ids: a quote attributed to somebody else's
   * integrator is somebody else's fee. When it is absent the split below still
   * proves everything that matters.
   *
   * `fee` (when present, on older bodies) must agree with the requested rate.
   * A present-but-unreadable value is ignored rather than fatal: it is a label,
   * not the payment.
   */
  if (body?.integrator != null && String(body.integrator) !== '') {
    if (!ids.has(normalizeIntegratorId(body.integrator))) {
      return { ok: false, code: 'FEE_NOT_APPLIED', totalFeeWei: 0n, shareWei: 0n };
    }
  }
  if (body?.fee != null) {
    const echoedRate = Number(body.fee);
    if (Number.isFinite(echoedRate) && Math.abs(echoedRate - feeBps / 10000) > 1e-9) {
      return { ok: false, code: 'FEE_NOT_APPLIED', totalFeeWei: 0n, shareWei: 0n };
    }
  }

  /* Every fee cost is inspected, not just the first with a split: a route can
     carry LI.FI's own fee, distributions and the integrator cut in separate
     entries, and the integrator entry is not guaranteed to come first. */
  const feeCosts = Array.isArray(body?.estimate?.feeCosts) ? body.estimate.feeCosts : [];
  let split = null;
  let ours = null;
  for (const fc of feeCosts) {
    const recipients = Array.isArray(fc?.feeSplit?.recipients) ? fc.feeSplit.recipients : [];
    const hit = recipients.find((r) => ids.has(normalizeIntegratorId(r?.name)));
    if (hit) {
      split = fc.feeSplit;
      ours = hit;
      break;
    }
  }
  if (!ours) {
    return { ok: false, code: 'FEE_NOT_APPLIED', totalFeeWei: 0n, shareWei: 0n };
  }

  const shareWei = parseFeeUnits(ours.fee);
  if (shareWei == null || shareWei < 1n) {
    return { ok: false, code: 'FEE_NOT_APPLIED', totalFeeWei: 0n, shareWei: 0n };
  }
  const expected = (fromWei * BigInt(Math.round(Number(feeBps) || 0))) / 10000n; // floor
  const withinRounding =
    shareWei === expected || shareWei + 1n === expected || shareWei === expected + 1n;
  if (!withinRounding) {
    return { ok: false, code: 'FEE_NOT_APPLIED', totalFeeWei: 0n, shareWei: 0n };
  }
  if (!isAddr(feeReceiver)) {
    return { ok: false, code: 'FEE_RECIPIENT_MISMATCH', totalFeeWei: 0n, shareWei: 0n };
  }

  /*
   * ─── WHERE THE FEE IS PAID — READ FROM EVERY SHAPE LI.FI USES ────────────
   *  1. `feeSplit.recipients[].walletAddress` — the modern, source-chain
   *     recipient address (see FeeRecipient in @lifi/types). This is the
   *     authoritative one: it is the address the router pays.
   *  2. `includedSteps[].action.integratorFees.recipients[].config.defaultWallet`
   *     — the older integrator-fee payload; still accepted, and it is the
   *     shape the signing-time re-verification builds.
   *  3. `includedSteps[].integrator`/`body.integrator` — identity only, never
   *     an address.
   *
   * ─── THE WALLET MUST BE OURS, NOT NECESSARILY THE ONE THIS BUILD NAMED ───
   * The fee wallet is attached SERVER-side from `LIFI_SWAP_FEE_RECIPIENT`
   * (server/lifi.js) — a variable this bundle cannot read. The client used to
   * demand it equal `feeRecipientFor(chainId)`, which is `VITE_FEE_RECIPIENT`
   * when that build variable exists. The website and the APK are built by two
   * pipelines with two variable sets, so the moment those two names diverged,
   * EVERY LI.FI quote failed here with FEE_RECIPIENT_MISMATCH. The security
   * property is unchanged: the wallet still has to be echoed by LI.FI's own
   * signed split AND be one of the operator's own addresses
   * (lib/payout.js#knownPayoutAddresses).
   */
  const steps = Array.isArray(body?.includedSteps) ? body.includedSteps : [];
  const wallets = [];
  if (isAddr(ours.walletAddress)) {
    /*
     * The signed split names the payout address, so it is the ONLY address we
     * accept for this quote. Letting a legacy row add a second candidate would
     * mean a body that pays a stranger could still pass on the strength of a
     * field that is not what the router reads.
     */
    wallets.push(ours.walletAddress);
  }
  for (const s of isAddr(ours.walletAddress) ? [] : steps) {
    for (const r of s?.action?.integratorFees?.recipients ?? []) {
      /* Scoped to OUR name on purpose: accepting any wallet in this array
         would let a body that pays a stranger pass as long as one of the
         entries happened to name an address of ours. */
      if (!ids.has(normalizeIntegratorId(r?.name))) continue;
      if (isAddr(r?.config?.defaultWallet)) wallets.push(r.config.defaultWallet);
      if (isAddr(r?.walletAddress)) wallets.push(r.walletAddress);
    }
  }
  const walletOk = wallets.some(
    (w) =>
      w.toLowerCase() === feeReceiver.toLowerCase() ||
      isKnownPayoutAddress(w, FAMILY.EVM)
  );
  if (!walletOk) {
    return { ok: false, code: 'FEE_RECIPIENT_MISMATCH', totalFeeWei: 0n, shareWei: 0n };
  }

  const lifiFeeWei = parseFeeUnits(split?.lifiFee) ?? 0n;
  return { ok: true, code: null, totalFeeWei: lifiFeeWei + shareWei, shareWei };
}

/** Checksummed address for a token, or the chain's native symbol. */
async function lifiTokenRef(token, chainId) {
  if (token.native) {
    const sym = EVM_CHAINS[chainId]?.native?.symbol;
    if (sym) return sym;
    return '0x0000000000000000000000000000000000000000';
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
    /*
     * The server's own refusals are NAMED in the body and only make sense as
     * themselves: `CHAIN_UNSUPPORTED` means the proxy allowlist dropped this
     * chain, and classifyQuoteFailure must see exactly that code (a generic
     * `LIFI_HTTP_400` is not a configuration error and would be reported as
     * «مسیری بین این دو توکن وجود ندارد» on a chain whose liquidity is fine).
     */
    const named = body?.error && body.error !== 'UPSTREAM_FAILED' ? body.error : null;
    const err = new Error(named || `LIFI_HTTP_${res.status}`);
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
      feeSplit:
        body.estimate?.feeCosts?.find((fc) =>
          Array.isArray(fc?.feeSplit?.recipients) &&
          fc.feeSplit.recipients.some((r) => isOurIntegratorName(r?.name))
        )?.feeSplit ?? null,
      /*
       * Where our cut is paid, from whichever shape this body carries: the
       * modern recipient-level `walletAddress` first (what LI.FI's router
       * actually pays), then the legacy integrator-fee payload. Reading only
       * the legacy one is what left this field null on every current quote —
       * and a null here made the signing-time re-verification fail with
       * FEE_RECIPIENT_MISMATCH, i.e. a swap that priced but could never be
       * signed.
       */
      feeWallet:
        body.estimate?.feeCosts
          ?.flatMap((fc) => fc?.feeSplit?.recipients ?? [])
          .find((r) => isOurIntegratorName(r?.name) && isAddr(r?.walletAddress))
          ?.walletAddress ??
        body.includedSteps
          ?.flatMap((s) => s?.action?.integratorFees?.recipients ?? [])
          .find((r) => isOurIntegratorName(r?.name))
          ?.config?.defaultWallet ??
        null,
      /*
       * ─── THE WHOLE REQUEST, NOT JUST to/data/value ─────────────────────
       * LI.FI builds a CHAIN-SPECIFIC transaction, and on zkSync Era that
       * means `customData` (gasPerPubdata, paymaster params) — the fields the
       * Era node needs to accept the transaction at all. Keeping only
       * to/data/value/gasLimit meant the quote worked and the SIGNATURE could
       * not be broadcast on the one chain whose only executor is LI.FI. Fee
       * fields are carried for the same reason: on an L2 the quote knows the
       * gas price it priced against, and re-deriving it a minute later is how
       * an otherwise valid swap reverts on `maxFeePerGas`.
       */
      transactionRequest: {
        to: tr.to,
        data: tr.data,
        value: String(tr.value ?? '0'),
        gasLimit: String(tr.gasLimit ?? ''),
        chainId: Number(tr.chainId),
        ...(tr.customData ? { customData: tr.customData } : {}),
        ...(tr.gasPrice ? { gasPrice: String(tr.gasPrice) } : {}),
        ...(tr.maxFeePerGas ? { maxFeePerGas: String(tr.maxFeePerGas) } : {}),
        ...(tr.maxPriorityFeePerGas ? { maxPriorityFeePerGas: String(tr.maxPriorityFeePerGas) } : {})
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
    ...(tr.gasLimit ? { gasLimit: (BigInt(tr.gasLimit) * 12n) / 10n } : {}), // +20% headroom
    /* zkSync Era's transaction envelope. Harmless elsewhere, required there. */
    ...(tr.customData ? { customData: tr.customData } : {}),
    ...(tr.gasPrice ? { gasPrice: BigInt(tr.gasPrice) } : {}),
    ...(tr.maxFeePerGas ? { maxFeePerGas: BigInt(tr.maxFeePerGas) } : {}),
    ...(tr.maxPriorityFeePerGas ? { maxPriorityFeePerGas: BigInt(tr.maxPriorityFeePerGas) } : {})
  });

  return { hash: tx.hash, wait: () => tx.wait(), viaLifi: true };
}
