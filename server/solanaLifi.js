/**
 * SOLANA SWAP VIA LI.FI — the second fee-earning route
 * ---------------------------------------------------------------------------
 * ─── WHY THIS EXISTS ────────────────────────────────────────────────────────
 * The Solana screen had exactly two possible routes: De¹/OpenOcean, which pays
 * us 70 bps and needs a whitelisted upstream key, and Jupiter, which pays us
 * NOTHING and cannot be made to (its referral accounts need on-chain
 * transactions the payout wallet has no SOL to send — see the header of
 * server/solanaOcean.js). When the De¹ gateway rejected us — a missing or
 * unrotated OPENOCEAN_API_KEY is enough — every quote silently fell through to
 * the free path, and the screen looked perfectly healthy while earning zero.
 * Reported as: «در سواپ سولانا فقط با ژوپیتر که کارمزد نمی‌گیریم مسیریابی
 * می‌شه و پروتکل‌های قبل که ما روی ان کارمزد داشتیم مسیریابی نمی‌شه».
 *
 * LI.FI is the protocol the app already trusts for EVM swaps and bridging, and
 * its Solana route can pay OUR OWN wallet per request. That last part is the
 * whole reason this is implementable without touching anyone's portal:
 *
 *   distributionFees[0][receiver]=<base58>   +   [0][percentage]=0.007
 *
 * LI.FI documents this as "receiver entries are supplied per request rather
 * than through the integrator fee-wallet configuration", and on Solana "each
 * receiver is paid with its own transfer instruction (max 2 entries)". The
 * request is therefore self-contained: no key, no dashboard step, no
 * integrator wallet for the Solana chain.
 *
 * ─── VERIFIED LIVE, NOT READ OFF A DOC ──────────────────────────────────────
 * A real GET /v1/quote on 2026-10-08 (SOL → USDC, 1 SOL, chain 1151111081099710)
 * with `distributionFees[0][receiver]` set to our published Solana payout
 * address answered:
 *
 *   tool: okx  ·  toAmount: 113842444  ·  transactionRequest.data: <base64 v0 tx>
 *   estimate.feeCosts[]:
 *     { name: "LIFI Fixed Fee", amount: "2500000", percentage: "0.0025" }   ← their 25 bps
 *     { name: "Distributions",  amount: "7000000", percentage: "0.0070",
 *       feeSplit.recipients: [ { name: "B6gysn5…FLv4", fee: "7000000",
 *                                type: "DISTRIBUTION",
 *                                walletAddress: "B6gysn5…FLv4" } ] }       ← OUR 70 bps
 *
 * 7,000,000 lamports of 1 SOL is 0.70000% exactly, paid to our wallet, in a
 * route LI.FI builds itself. The user pays 0.95% in total (our 0.70% plus
 * LI.FI's own 0.25%), which is the same total the EVM LI.FI swap path already
 * discloses — so the two screens say the same number for the same reason.
 *
 * ─── THE ECHO GATE, AGAIN ───────────────────────────────────────────────────
 * A parameter we send proves nothing about what came back: the KyberSwap fee
 * bug in this repo's history was exactly a fee that was requested, echoed, and
 * silently not applied. So the quote is rejected unless `feeCosts` contains
 * the `Distributions` entry AND its `feeSplit.recipients[]` names OUR wallet
 * with OUR exact amount. LI.FI's own guidance says the same thing: "Treat the
 * split as active only when the returned feeCosts contains `Distributions`".
 *
 * A rejected quote costs the user nothing — the client falls back to De¹
 * (if it did not price) or to Jupiter, which is the same fail-safe the Solana
 * screen has always had. What it must never do is return a route that looks
 * fee-paying and is not.
 *
 * ─── WHAT THIS MODULE DOES NOT DO ───────────────────────────────────────────
 * It does not sign and it does not broadcast. LI.FI returns a base64 versioned
 * transaction; the user's wallet signs it and the CLIENT sends it (the same
 * shape as the De¹ path, and the reason `signAndSendSolana` is the client
 * helper both use). We never hold a Solana key.
 */

import { lifiFetch, integratorId } from './lifi.js';
import { feeReceiver as oceanFeeReceiver, feeBps as oceanFeeBps, SOL_MINT } from './solanaOcean.js';

/** LI.FI's chain id for Solana (SVM). */
export const SOLANA_CHAIN_ID = '1151111081099710';

/** LI.FI's own native-SOL address; also the symbol 'SOL' is accepted. */
const SOL_NATIVE = '11111111111111111111111111111111';

const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const AMOUNT_RE = /^\d+$/;

/**
 * The fee wallet and rate are read from server/solanaOcean.js ON PURPOSE.
 *
 * Two Solana routes that disagree about where our money goes, or charge two
 * different rates for what the user sees as one button, is the kind of drift
 * nobody notices until an audit. One reader, one receiver, one rate.
 */
export const solanaFeeReceiver = () => oceanFeeReceiver();
export const solanaFeeBps = () => oceanFeeBps();

/** Is the fee path configured? (A valid base58 receiver and a non-zero rate.) */
export const solanaFeeReady = () => Boolean(solanaFeeReceiver()) && solanaFeeBps() > 0;

/** Percent, not bps: LI.FI's `fee`/`percentage` are decimal fractions. */
const bpsToFraction = (bps) => Number(bps) / 10000;

/**
 * The mint LI.FI should route from/to.
 *
 * Our app spells wrapped SOL as `So111…112` because that is what the token
 * list, the balance reads and the De¹ route use; LI.FI spells the chain's
 * native coin 'SOL' (its own catalog lists `11111111111111111111111111111111`).
 * Sending the wrapped mint where LI.FI expects the native coin is a route that
 * simply does not exist — and, worse, it would look like "no liquidity on
 * Solana" rather than a spelling mistake.
 */
function lifiTokenRef(mint) {
  const value = String(mint || '');
  if (value === SOL_MINT || value === SOL_NATIVE || value.toUpperCase() === 'SOL') return 'SOL';
  return value;
}

/**
 * Validate the browser-supplied parameters. Split out so the quote and the
 * transaction build cannot disagree about what is acceptable — a transaction
 * built from input the quote rejected is how a user signs something they were
 * never shown.
 */
function validate({ inputMint, outputMint, amount, account }) {
  const from = String(inputMint || '');
  const to = String(outputMint || '');
  const fromRef = lifiTokenRef(from);
  const toRef = lifiTokenRef(to);
  const okRef = (ref) => ref === 'SOL' || BASE58.test(ref);
  if (!okRef(fromRef) || !okRef(toRef)) return { error: 'BAD_MINT' };
  if (from === to) return { error: 'SAME_TOKEN' };
  if (!AMOUNT_RE.test(String(amount || '')) || String(amount) === '0') return { error: 'BAD_AMOUNT' };
  if (!BASE58.test(String(account || ''))) return { error: 'BAD_TAKER' };
  return null;
}

/** LI.FI takes slippage as a decimal fraction (0.005 = 0.5%), we speak bps. */
function slippageFraction(bps) {
  const n = Number(bps);
  if (!Number.isFinite(n)) return 0.005;
  return Math.min(0.5, Math.max(0.0005, n / 10000));
}

/** Slippage as the docs' own range, described once so both callers agree. */
function breakdown(body) {
  const fromWei = BigInt(body?.estimate?.fromAmount ?? body?.action?.fromAmount ?? 0);
  const feeCosts = Array.isArray(body?.estimate?.feeCosts) ? body.estimate.feeCosts : [];
  const distributions = feeCosts.find((c) => String(c?.name) === 'Distributions') ?? null;
  const recipients = Array.isArray(distributions?.feeSplit?.recipients)
    ? distributions.feeSplit.recipients
    : [];
  const lifiCost = feeCosts.find((c) => String(c?.name) === 'LIFI Fixed Fee') ?? null;
  return { fromWei, feeCosts, distributions, recipients, lifiCost };
}

/**
 * The fee echo gate. Returns { ok, code } and never throws.
 *
 * `code` is one of FEE_NOT_APPLIED (LI.FI did not route our share at all) or
 * FEE_AMOUNT_MISMATCH (it routed a different amount than we asked for).
 */
export function verifySolanaFeeEcho(body, { bps, receiver, integratorId: id = null } = {}) {
  const wanted = Number(bps);
  if (!(wanted > 0)) return { ok: false, code: 'FEE_NOT_APPLIED' };
  if (!BASE58.test(String(receiver || ''))) return { ok: false, code: 'FEE_RECIPIENT_MISMATCH' };

  const { fromWei, distributions, recipients } = breakdown(body);
  if (!distributions || fromWei <= 0n) return { ok: false, code: 'FEE_NOT_APPLIED' };

  /* The entry's own percentage must be the one we asked for. A mismatch here
     means LI.FI understood a different request than we sent. */
  const echoPct = Number(distributions.percentage);
  if (!Number.isFinite(echoPct) || Math.abs(echoPct - wanted / 10000) > 1e-9) {
    return { ok: false, code: 'FEE_AMOUNT_MISMATCH' };
  }

  /* Our wallet, named exactly. base58 is case-sensitive, so this is a
     case-sensitive comparison — a "close" match is a different wallet. */
  const ours = recipients.find((r) => String(r?.walletAddress || r?.name || '') === receiver);
  if (!ours) return { ok: false, code: 'FEE_RECIPIENT_MISMATCH' };

  let paid;
  try {
    paid = BigInt(String(ours.fee ?? 0));
  } catch {
    return { ok: false, code: 'FEE_AMOUNT_MISMATCH' };
  }

  /*
   * LI.FI rounds the share DOWN to a whole base unit, so the comparison is
   * against floor(fromAmount × bps / 10000) with a single unit of slack — not
   * against an exact product. Demanding equality would fail on every amount
   * that does not divide cleanly (123456789 lamports × 0.7% is 864197.523 →
   * 864197), and a gate that fails on most real amounts gets deleted rather
   * than fixed. The upper bound is exact: we never accept MORE than we asked
   * for, because that is money out of the user's swap that they never
   * consented to.
   */
  const expected = (fromWei * BigInt(Math.round(wanted))) / 10000n;
  if (paid > expected || paid + 1n < expected) return { ok: false, code: 'FEE_AMOUNT_MISMATCH' };

  /* Tracking identity, when it is echoed at all. */
  if (id && body?.integrator && String(body.integrator) !== String(id)) {
    return { ok: false, code: 'FEE_RECIPIENT_MISMATCH' };
  }

  return { ok: true, code: null, paid };
}

/**
 * GET /api/solana/lifi/quote — price AND the unsigned transaction, in one call.
 *
 * LI.FI's quote endpoint always returns a ready-to-sign transaction when a
 * `fromAddress` is supplied, so unlike the De¹ path there is no separate build
 * call: the same request that prices it produces the bytes. The client still
 * re-requests at swap time (a stale transaction is exactly what a user should
 * not sign) — the freshness rule is unchanged, only the endpoint count is.
 */
export async function lifiSolanaSwapQuote(query = {}) {
  const inputMint = String(query?.inputMint || '');
  const outputMint = String(query?.outputMint || '');
  const amount = String(query?.amount || '');
  const account = String(query?.account || '');

  const bad = validate({ inputMint, outputMint, amount, account });
  if (bad) return { ok: false, status: 400, body: bad };

  const receiver = solanaFeeReceiver();
  const bps = solanaFeeBps();
  if (!receiver || !(bps > 0)) {
    /*
     * No valid receiver means no fee — and a fee-less LI.FI quote is a route
     * this app refuses to offer, for the same reason lib/solanaOcean.js has no
     * keyless fallback: our revenue would become optional.
     */
    return { ok: false, status: 503, body: { error: 'SOLANA_FEE_NOT_CONFIGURED' } };
  }

  const params = new URLSearchParams({
    fromChain: SOLANA_CHAIN_ID,
    toChain: SOLANA_CHAIN_ID,
    fromToken: lifiTokenRef(inputMint),
    toToken: lifiTokenRef(outputMint),
    fromAmount: amount,
    fromAddress: account,
    /* Same-chain swap: the user receives at their own address. */
    toAddress: account,
    slippage: String(slippageFraction(query?.slippageBps)),
    integrator: integratorId()
  });
  /* Indexed keys, exactly as the docs require on GET:
     a JSON string in one parameter is rejected by the validator. */
  params.set('distributionFees[0][receiver]', receiver);
  params.set('distributionFees[0][percentage]', String(bpsToFraction(bps)));

  const res = await lifiFetch(`/quote?${params.toString()}`);
  if (!res.ok) {
    return {
      ok: false,
      status: res.status,
      body: { error: 'UPSTREAM_FAILED', detail: res.body?.message || res.body?.error || null }
    };
  }

  const body = res.body;
  const echo = verifySolanaFeeEcho(body, { bps, receiver, integratorId: integratorId() });
  if (!echo.ok) {
    // eslint-disable-next-line no-console
    console.warn(`[solanaLifi] fee echo rejected: ${echo.code}`);
    return { ok: false, status: 502, body: { error: echo.code } };
  }

  const tx = body?.transactionRequest?.data;
  if (typeof tx !== 'string' || !tx) {
    return { ok: false, status: 502, body: { error: 'NO_TRANSACTION' } };
  }

  const { fromWei, lifiCost } = breakdown(body);
  const lifiFee = (() => {
    try {
      return BigInt(String(lifiCost?.amount ?? 0));
    } catch {
      return 0n;
    }
  })();
  /*
   * What the USER pays in total: our share plus LI.FI's fixed 25 bps, both
   * taken from the input token. Stated as a number rather than assumed, so the
   * screen can disclose the same figure the feeCosts array will show on the
   * receipt.
   */
  const totalBps = fromWei > 0n ? Number(((echo.paid + lifiFee) * 10000n) / fromWei) : bps;

  return {
    ok: true,
    status: 200,
    body: {
      provider: 'lifi',
      transaction: tx,
      // LI.FI returns a serialized (versioned) Solana transaction; the client
      // passes this straight to signAndSendSolana, which detects the envelope
      // itself and only uses the flag for MWA.
      versioned: true,
      inAmount: body?.estimate?.fromAmount ?? body?.action?.fromAmount ?? null,
      outAmount: body?.estimate?.toAmount ?? null,
      minOutAmount: body?.estimate?.toAmountMin ?? null,
      priceImpact: body?.estimate?.priceImpact ?? null,
      tool: body?.tool ?? null,
      feeBps: bps,
      totalFeeBps: totalBps,
      feeReceiver: receiver,
      feeApplied: true
    }
  };
}

/**
 * Fee-FREE reachability quote, for the Ecosystem network light only.
 *
 * The light answers "can Solana price a swap at all", and `distributionFees`
 * is a statement about our configuration rather than about the chain: a
 * missing fee wallet would be reported to the user as "Solana is down". So
 * this variant asks LI.FI the same question with no fee parameters, and the
 * provider probe (server/providerProbe.js) uses it. It is not a swap path —
 * nothing it returns is ever signed, and it is never reachable from a HTTP
 * route.
 */
export async function lifiSolanaReachability({ account }) {
  if (!BASE58.test(String(account || ''))) return { ok: false, status: 400, body: { error: 'BAD_TAKER' } };
  const params = new URLSearchParams({
    fromChain: SOLANA_CHAIN_ID,
    toChain: SOLANA_CHAIN_ID,
    fromToken: 'SOL',
    toToken: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
    fromAmount: '1000000000',
    fromAddress: String(account),
    toAddress: String(account),
    slippage: '0.005'
  });
  const res = await lifiFetch(`/quote?${params.toString()}`);
  return { ok: Boolean(res?.ok), status: Number(res?.status || 0), body: res?.body ?? null };
}

/** Honest status for the screen and for anyone debugging a silent zero. */
export function lifiSolanaStatus() {
  return {
    provider: 'lifi',
    chainId: SOLANA_CHAIN_ID,
    integrator: integratorId(),
    feeReady: solanaFeeReady(),
    feeBps: solanaFeeBps(),
    feeReceiver: solanaFeeReceiver() || null,
    /* LI.FI pays the receiver named in the request, so there is no provider
       cut on our share — unlike the De¹ route's documented 20%. */
    providerCutPercent: 0
  };
}
