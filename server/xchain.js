/**
 * CROSS-CHAIN SWAPS (0x) — the only route that reaches Tron
 * ---------------------------------------------------------------------------
 * ─── WHY THIS EXISTS WHEN WE ALREADY HAVE A BRIDGE ──────────────────────────
 * LI.FI already bridges between EVM chains and earns us 0.30%. This is not a
 * replacement for it. It exists for the chains LI.FI's EVM-shaped integration
 * cannot reach from our app — above all TRON, where a very large share of the
 * stablecoin our users actually hold (USDT TRC-20) lives.
 *
 * Tron was checked against the free options first:
 *
 *   OpenOcean  — no. Their own error enumerates every chain they serve and
 *                `tron` is absent from the list.
 *   KyberSwap  — no. EVM only.
 *   LI.FI      — EVM/Solana in our integration; Tron is not wired.
 *   0x         — YES, documented as both origin and destination via the Relay
 *                and NEAR Intents bridges.
 *
 * ─── WHY IT COSTS NOTHING ───────────────────────────────────────────────────
 * We already hold a working 0x API key: /api/gasless/status answers
 * `configured:true` in production today. Cross-Chain is another product on the
 * same key, toggled per-app in their dashboard. No new signup, no new key, no
 * money.
 *
 * ─── THE FEE ────────────────────────────────────────────────────────────────
 * `feeBps` + `feeRecipient`, deducted from sellAmount during the ORIGIN
 * transaction. From their monetisation guide: "Fees are deducted from the
 * sellAmount and sent directly to your wallet during the origin transaction."
 *
 * ⚠️ A CONSTRAINT THAT DECIDES OUR TRON DESIGN:
 * "feeRecipient addresses must be valid for the origin chain's address format."
 *
 * So a Tron-origin swap would need a TRON fee address, not our EVM one. We
 * have one — TJNNUB2zStAvm1wHci5vf9gBGFzbBKjBJZ in lib/payout.js — and
 * `feeRecipientFor()` below picks per origin chain rather than sending an EVM
 * address to Tron, which their validator would reject and which, if it ever
 * slipped through, would be a burn rather than a payment.
 *
 * ─── HONESTY ABOUT WHAT IS PROVEN ───────────────────────────────────────────
 * The EVM fee mechanism is proven live on this key: /api/gasless/price returns
 * `integratorFee.amount = 70000` on a 10 USDC sell, which is exactly 70 bps.
 * The TRON leg is documented but NOT yet measured, because the key lives in
 * Vercel where it belongs and cannot be exercised from a laptop. That is what
 * /api/crosschain/probe is for: it runs the real request from inside our own
 * server and reports whether the fee actually came back, instead of letting us
 * assume it did. This repo has shipped "wired to nothing" three times; a fee
 * that is documented and untested is the same trap wearing a different hat.
 */

const ZEROX_BASE = 'https://api.0x.org';
const TIMEOUT_MS = Number(process.env.UPSTREAM_TIMEOUT_MS || 20000);

const apiKey = () => process.env.ZEROX_API_KEY || '';

/** True when the shared 0x key is present. Cross-chain ACCESS is separate. */
export const crossChainConfigured = () => Boolean(apiKey());

/**
 * 0x's own identifier for Tron. They accept the string 'tron' or the numeric
 * 999999999993; the string is used because it cannot be mistaken for an EVM
 * chainId by anything downstream.
 */
export const TRON = 'tron';

const EVM_ADDRESS = /^0x[a-fA-F0-9]{40}$/;
const TRON_ADDRESS = /^T[1-9A-HJ-NP-Za-km-z]{33}$/;

/** True for either accepted spelling of Tron as an origin. */
export const isTronOrigin = (c) =>
  String(c).toLowerCase() === TRON || String(c) === '999999999993';

/**
 * ⚠️ MEASURED, NOT ASSUMED: 0x DOES NOT PAY A FEE ON A TRON ORIGIN.
 *
 * The monetisation guide describes feeBps/feeRecipient without carving Tron
 * out, so this module was first written expecting a Tron-origin fee paid to
 * our Tron address. Probing the real API from inside our own server returned:
 *
 *   {"field":"feeBps",       "reason":"Fee collection is not supported when origin chain is Tron"}
 *   {"field":"feeRecipient", "reason":"Fee collection is not supported when origin chain is Tron"}
 *   {"field":"feeToken",     "reason":"Fee collection is not supported when origin chain is Tron"}
 *
 * And it is a HARD 400: sending the fee fields does not merely fail to earn,
 * it makes the whole quote fail. So a Tron origin must be requested with no
 * fee at all, or Tron simply does not work.
 *
 * This is exactly why /probe exists. Reading the docs would have shipped a
 * Tron tab that returned INPUT_INVALID on every single request.
 *
 * Consequence for the product, stated plainly: Tron -> elsewhere is a service
 * we can offer but CANNOT charge for. Tron as a DESTINATION is unaffected,
 * because the fee is taken on the origin chain — so EVM -> Tron does earn.
 */
export const feeSupportedOn = (originChain) => !isTronOrigin(originChain);

/**
 * The fee address for a given ORIGIN chain.
 *
 * Mirrors the family rule in src/lib/payout.js: an address never crosses
 * families. Returns empty for Tron because no fee is collectable there at
 * all — returning our Tron address would imply an income that cannot exist.
 */
export function feeRecipientFor(originChain) {
  if (isTronOrigin(originChain)) return '';
  const evm = process.env.CROSSCHAIN_FEE_EVM || process.env.VITE_PAYOUT_EVM ||
    '0xaf5CE154cEfd22Da5BD1D0a54479E81963A224d6';
  return EVM_ADDRESS.test(evm) ? evm : '';
}

/**
 * Our cut in basis points.
 *
 * 30 bps, matching the LI.FI bridge rather than the 70 bps swap. A bridge
 * already carries the bridge provider's own cost, and charging our full swap
 * rate on top would make us the expensive option on precisely the trade a user
 * can most easily compare elsewhere.
 *
 * Clamped 0-100. 0x accepts up to 10,000 (100%), so an unclamped typo here is
 * not a rounding error, it is somebody's entire transfer.
 */
export function feeBps() {
  const raw = Number(process.env.CROSSCHAIN_FEE_BPS ?? 30);
  if (!Number.isFinite(raw)) return 30;
  return Math.min(100, Math.max(0, Math.round(raw)));
}

function headers() {
  return { accept: 'application/json', '0x-api-key': apiKey(), '0x-version': 'v2' };
}

async function zxFetch(path) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${ZEROX_BASE}${path}`, { headers: headers(), signal: ctrl.signal });
    const text = await res.text();
    let body = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = { error: text.slice(0, 300) };
    }
    return { ok: res.ok, status: res.status, body };
  } catch (err) {
    return { ok: false, status: 504, body: { error: 'UPSTREAM_FAILED', detail: String(err?.name || err) } };
  } finally {
    clearTimeout(timer);
  }
}

/** Accepts either an EVM address or a Tron base58 one. */
const looksLikeAddress = (a) => EVM_ADDRESS.test(a) || TRON_ADDRESS.test(a);

/**
 * GET /api/crosschain/quotes
 *
 * The fee parameters are attached HERE, from our own configuration, and are
 * absent from anything a caller can influence. Exposed to the browser they
 * would let anyone redirect our revenue to their own wallet or set an
 * outrageous rate in our name — the same boundary as server/solanaOcean.js.
 */
export async function crossChainQuotes(query) {
  if (!apiKey()) {
    return { ok: false, status: 503, body: { error: 'CROSSCHAIN_NOT_CONFIGURED' } };
  }

  const originChain = String(query?.originChain || '');
  const destinationChain = String(query?.destinationChain || '');
  const sellToken = String(query?.sellToken || '');
  const buyToken = String(query?.buyToken || '');
  const sellAmount = String(query?.sellAmount || '');
  const originAddress = String(query?.originAddress || '');
  const destinationAddress = String(query?.destinationAddress || '');

  if (!originChain || !destinationChain) {
    return { ok: false, status: 400, body: { error: 'BAD_CHAIN' } };
  }
  if (!looksLikeAddress(sellToken) || !looksLikeAddress(buyToken)) {
    return { ok: false, status: 400, body: { error: 'BAD_TOKEN' } };
  }
  if (!/^\d+$/.test(sellAmount) || sellAmount === '0') {
    return { ok: false, status: 400, body: { error: 'BAD_AMOUNT' } };
  }
  if (!looksLikeAddress(originAddress)) {
    return { ok: false, status: 400, body: { error: 'BAD_ORIGIN_ADDRESS' } };
  }
  /*
   * The destination address is REQUIRED whenever the families differ.
   *
   * 0x defaults it to the origin address. Across a family boundary that
   * default is a Tron address on an EVM chain — an address nobody holds the
   * key to. Refusing is the only safe behaviour: the alternative is a
   * successful bridge into a burn.
   */
  const crossFamily = TRON_ADDRESS.test(originAddress) !== TRON_ADDRESS.test(buyToken);
  if (crossFamily && !looksLikeAddress(destinationAddress)) {
    return { ok: false, status: 400, body: { error: 'DESTINATION_ADDRESS_REQUIRED' } };
  }

  const params = new URLSearchParams({
    originChain,
    destinationChain,
    sellToken,
    buyToken,
    sellAmount,
    originAddress,
    sortQuotesBy: 'price',
    maxNumQuotes: '1'
  });
  if (looksLikeAddress(destinationAddress)) params.set('destinationAddress', destinationAddress);

  /*
   * Attach the fee ONLY where 0x accepts one. On a Tron origin these fields
   * are a hard 400, not a silent zero — sending them would break the quote
   * entirely, so the guard is what makes Tron work at all.
   */
  const recipient = feeRecipientFor(originChain);
  const bps = feeSupportedOn(originChain) ? feeBps() : 0;
  if (recipient && bps > 0) {
    params.set('feeRecipient', recipient);
    params.set('feeBps', String(bps));
  }

  const r = await zxFetch(`/cross-chain/quotes?${params}`);
  if (!r.ok) return r;

  /*
   * The echo check, same rule as every other fee path here: a requested fee
   * that did not arrive must be visible, not assumed. `integratorFees` is an
   * array in the multi-fee shape and `integratorFee` a single object in the
   * older one, so both are read.
   */
  const quote = r.body?.quotes?.[0];
  const f = quote?.fees || {};
  const collected = Array.isArray(f.integratorFees)
    ? f.integratorFees.reduce((n, x) => n + Number(x?.amount || 0), 0)
    : Number(f.integratorFee?.amount || 0);
  const feeApplied = bps === 0 ? true : collected > 0;

  /*
   * Only a fee we ASKED for and did not get is a problem. Tron earns nothing
   * by the upstream's own rule, so warning there would train us to ignore the
   * warning that matters.
   */
  if (!feeApplied && quote && bps > 0) {
    // eslint-disable-next-line no-console
    console.warn(`[xchain] fee not honoured on ${originChain}->${destinationChain}`);
  }

  return {
    ok: true,
    status: 200,
    body: {
      ...r.body,
      feeBps: bps,
      feeRecipient: recipient || null,
      feeApplied,
      // Explicit so the UI never has to infer "0 bps" from a missing field.
      feeSupported: feeSupportedOn(originChain)
    }
  };
}

/**
 * GET /api/crosschain/probe — does Tron actually work on our key?
 *
 * A deliberately tiny, fixed request run from inside our own server, because
 * the key is not reachable from a developer machine. It answers three
 * questions that cannot be answered by reading documentation:
 *
 *   1. Is the Cross-Chain product enabled on this app's key at all?
 *   2. Does Tron return a route?
 *   3. Does our fee actually come back in the response?
 *
 * Read-only: it requests a quote and signs nothing. The amount is 10 USDT and
 * the origin address is our own published Tron payout address, so no user
 * data is involved.
 */
export async function crossChainProbe() {
  if (!apiKey()) {
    return { ok: true, status: 200, body: { configured: false, reason: 'NO_API_KEY' } };
  }

  const r = await crossChainQuotes({
    originChain: TRON,
    destinationChain: '42161',
    // USDT TRC-20, the single most held asset this unlocks.
    sellToken: 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t',
    // USDC on Arbitrum.
    buyToken: '0xaf88d065e77c8cc2239327c5edb3a432268e5831',
    sellAmount: '10000000',
    originAddress: 'TJNNUB2zStAvm1wHci5vf9gBGFzbBKjBJZ',
    destinationAddress: '0xaf5CE154cEfd22Da5BD1D0a54479E81963A224d6'
  });

  const quote = r.body?.quotes?.[0];

  return {
    ok: true,
    status: 200,
    body: {
      configured: true,
      // The distinction that matters: a 401/403 means the product is not
      // enabled on the key, which is a dashboard toggle, not a code problem.
      httpStatus: r.status,
      accessDenied: r.status === 401 || r.status === 403,
      tronRouteFound: Boolean(quote),
      /*
       * Measured, not read: 0x refuse fee collection on a Tron ORIGIN and
       * return 400 if the fields are sent. Reported here so the finding
       * cannot be lost, and so a future upstream change shows up as this
       * flipping to true rather than as a silent zero.
       */
      tronFeeSupported: feeSupportedOn(TRON),
      feeApplied: r.body?.feeApplied ?? null,
      feeBps: feeSupportedOn(TRON) ? feeBps() : 0,
      feeRecipient: feeRecipientFor(TRON) || null,
      buyAmount: quote?.buyAmount ?? null,
      provider: quote?.steps?.[0]?.provider ?? null,
      estimatedSeconds: quote?.estimatedTimeSeconds ?? null,
      detail: r.ok ? null : (r.body?.error || r.body?.message || null)
    }
  };
}

/** Honest status for the UI and for debugging a silent zero. */
export function crossChainStatus() {
  return {
    provider: '0x-cross-chain',
    configured: crossChainConfigured(),
    feeBps: feeBps(),
    feeRecipientEvm: feeRecipientFor('1') || null,
    // Tron works as a route but pays us nothing on the origin side.
    tronRoutable: true,
    tronFeeSupported: feeSupportedOn(TRON)
  };
}
