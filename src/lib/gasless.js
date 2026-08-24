/**
 * GASLESS SWAPS — client side.
 * ---------------------------------------------------------------------------
 * ─── WHY THIS FILE EXISTS AT ALL ────────────────────────────────────────────
 * `server/gasless.js` has been 245 lines of working, fee-earning code with
 * four live routes since it shipped, and NOTHING in the interface could reach
 * it. The only occurrence of the word `gasless` outside the server was the
 * Developers page — an API listing no ordinary user opens.
 *
 * Verified against production before writing this, 10 USDC on Base:
 *
 *   "integratorFee": { "amount": "70000" }   → exactly 0.70% to our wallet
 *   "gasFee":        { "amount": "17933" }   → taken from the TOKEN, not ETH
 *
 * ─── THE DEAD END THIS OPENS ────────────────────────────────────────────────
 * Someone holding USDT on BNB Chain with no BNB can do NOTHING in this app.
 * Not a swap, not a bridge. Every EVM action needs the chain's native coin for
 * gas, and acquiring that coin is itself a transaction that needs gas. It is
 * the most common dead end in crypto and it hits exactly the person this
 * product is for: someone who was sent stablecoins and has never held BNB.
 *
 * 0x breaks the loop. The user signs an EIP-712 MESSAGE rather than a
 * transaction; 0x submits it and pays the gas; the cost comes out of the token
 * being sold.
 *
 * ─── WHAT THIS FILE IS NOT ALLOWED TO DO ────────────────────────────────────
 * It never sees the API key and it never chooses the fee. Both live on the
 * server, because a `VITE_`-prefixed key is compiled into the bundle and a
 * caller-supplied fee recipient is our revenue redirected by editing a URL.
 * This module only shapes requests and reads responses.
 */

const API_BASE = (typeof import.meta !== 'undefined' && import.meta.env?.VITE_API_BASE) || '/api';

/**
 * Chains where 0x Gasless works AND we already support the chain.
 *
 * Mirrors `SUPPORTED` in server/gasless.js. Duplicated deliberately rather
 * than fetched: the UI has to decide whether to OFFER the option before any
 * request is made, and a network round-trip to answer "should this toggle
 * exist" would make the screen flicker on every chain change.
 */
export const GASLESS_CHAINS = new Set([1, 10, 56, 137, 8453, 42161, 43114]);

export const gaslessSupports = (chainId) => GASLESS_CHAINS.has(Number(chainId));

/**
 * Is the gasless route even worth offering for this pair?
 *
 * ─── BOTH SIDES MUST BE REAL ERC-20s ────────────────────────────────────────
 * Gasless has no native-coin path by definition: if the user had native coin
 * they would not need this. Offering it for a BNB→USDT swap would produce an
 * upstream error the user cannot act on, so the option is simply not shown.
 */
export function gaslessEligible({ chainId, fromToken, toToken }) {
  if (!gaslessSupports(chainId)) return false;
  if (!fromToken || !toToken) return false;
  if (fromToken.native || toToken.native) return false;
  if (!fromToken.address || !toToken.address) return false;
  return fromToken.address.toLowerCase() !== toToken.address.toLowerCase();
}

async function call(path, params, { timeout = 25000, signal: parentSignal } = {}) {
  const ctrl = new AbortController();
  const abortFromParent = () => ctrl.abort();
  if (parentSignal) {
    if (parentSignal.aborted) ctrl.abort();
    else parentSignal.addEventListener('abort', abortFromParent, { once: true });
  }
  const timer = setTimeout(() => ctrl.abort(), timeout);
  try {
    const qs = new URLSearchParams(params);
    const res = await fetch(`${API_BASE}${path}?${qs}`, {
      signal: ctrl.signal,
      headers: { accept: 'application/json' }
    });
    const body = await res.json().catch(() => null);
    if (!res.ok) {
      const err = new Error(body?.error || body?.message || `HTTP ${res.status}`);
      err.code = body?.error;
      throw err;
    }
    return body;
  } finally {
    clearTimeout(timer);
    parentSignal?.removeEventListener('abort', abortFromParent);
  }
}

/** An indicative price. Cheap, and does not lock anything in. */
export const getGaslessPrice = (params, opts) => call('/gasless/price', params, opts);

/** The firm quote, carrying the EIP-712 payload the wallet must sign. */
export const getGaslessQuote = (params, opts) => call('/gasless/quote', params, opts);

/** Relay the signed message. 0x pays the gas and submits it. */
export async function submitGasless(body, { timeout = 30000 } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await fetch(`${API_BASE}/gasless/submit`, {
      method: 'POST',
      signal: ctrl.signal,
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify(body)
    });
    const parsed = await res.json().catch(() => null);
    if (!res.ok) {
      const err = new Error(parsed?.error || parsed?.message || `HTTP ${res.status}`);
      err.code = parsed?.error;
      throw err;
    }
    return parsed;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Pull the numbers a user needs out of 0x's response.
 *
 * ─── EVERY FEE IS NAMED, INCLUDING OURS ─────────────────────────────────────
 * A gasless quote carries three separate deductions: our 0.70%, 0x's own cut,
 * and the gas 0x is fronting. All three come out of the sell token, so the
 * user's balance moves by more than the amount they typed — and if that is
 * not itemised before they sign, they discover it afterwards and reasonably
 * conclude the app skimmed them.
 *
 * The gas fee in particular has to be shown BECAUSE it is the headline
 * feature: "no ETH needed" does not mean "free", it means "paid in the token
 * instead". Hiding it would make the honest version of this feature look
 * dishonest the first time someone did the arithmetic.
 */
/* Keep base-unit arithmetic exact until the final, display-only Number. */
function integerRaw(value) {
  if (value == null || value === '') return null;
  const text = String(value);
  if (!/^\d+$/.test(text)) return null;
  try {
    return BigInt(text);
  } catch {
    return null;
  }
}

function decimalsFor(value, fallback = 6) {
  const n = Number(value);
  return Number.isInteger(n) && n >= 0 && n <= 36 ? n : fallback;
}

/** Parse a human amount without rounding it before it reaches 0x. */
export function parseGaslessAmount(value, decimals = 18) {
  const places = decimalsFor(decimals, 18);
  const text = String(value ?? '').trim().replace(',', '.');
  if (!/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(text)) return null;
  const [wholePart, fractionPart = ''] = text.split('.');
  if (fractionPart.length > places) return null;
  const raw = BigInt(wholePart || '0') * (10n ** BigInt(places))
    + BigInt((fractionPart || '').padEnd(places, '0') || '0');
  return raw > 0n ? raw : null;
}

function formatRaw(value, decimals = 6) {
  const raw = integerRaw(value);
  if (raw == null) return null;
  const places = decimalsFor(decimals);
  if (places === 0) return raw.toString();
  const base = 10n ** BigInt(places);
  const whole = raw / base;
  const fraction = raw % base;
  if (fraction === 0n) return whole.toString();
  return `${whole}.${fraction.toString().padStart(places, '0').replace(/0+$/, '')}`;
}

function numberFromRaw(value, decimals = 6) {
  const formatted = formatRaw(value, decimals);
  if (formatted == null) return null;
  const n = Number(formatted);
  return Number.isFinite(n) ? n : null;
}

function feeAmount(fee) {
  /* Gasless v1 uses `amount`; newer 0x responses use `feeAmount`. */
  return fee?.amount ?? fee?.feeAmount ?? null;
}

function feeRaw(fee) {
  const raw = feeAmount(fee);
  return integerRaw(raw);
}

/**
 * Pull the numbers a user needs out of 0x's response.
 *
 * `feeDecimals` is the SELL token's precision: gas, 0x and integrator fees are
 * deducted from that token. `buyDecimals` is deliberately separate because
 * stablecoin pairs can have different precisions. The raw API fields remain
 * available, while the `amountOut`/`minReceived` fields are ready for the UI.
 */
export function summariseGasless(quote, feeDecimals = 6, buyDecimals = feeDecimals, slippagePct = 0) {
  if (!quote) return null;

  const f = quote.fees ?? {};
  const feePlaces = decimalsFor(feeDecimals);
  const buyPlaces = decimalsFor(buyDecimals, feePlaces);

  /*
   * `integratorFees` is the newer array shape and `integratorFee` the older
   * single object. Both are read because 0x returns whichever suits the route,
   * and assuming one would silently report our fee as zero on half of them.
   */
  const integratorItems = Array.isArray(f.integratorFees) && f.integratorFees.length > 0
    ? f.integratorFees
    : (f.integratorFee?.amount != null || f.integratorFee?.feeAmount != null
      ? [f.integratorFee]
      : []);
  const ourFeeRaw = integratorItems.reduce((total, item) => total + (feeRaw(item) ?? 0n), 0n);
  const zeroExFeeRaw = feeRaw(f.zeroExFee);
  const gasFeeRaw = feeRaw(f.gasFee);

  const buyAmount = quote.buyAmount ?? quote.grossBuyAmount ?? null;
  let minBuyAmount = quote.minBuyAmount ?? quote.minAmountOut ?? null;

  /*
   * Some 0x Gasless v2 responses omit `minBuyAmount`. Derive the exact integer
   * floor from the API's returned buy amount and the same slippage sent in the
   * request instead of falling back to the normal router's quote.
   */
  if (minBuyAmount == null) {
    const buyRaw = integerRaw(buyAmount);
    const slip = Number(slippagePct);
    if (buyRaw != null && Number.isFinite(slip) && slip >= 0 && slip <= 100) {
      const slipBps = BigInt(Math.max(0, Math.min(10_000, Math.round(slip * 100))));
      minBuyAmount = ((buyRaw * (10_000n - slipBps)) / 10_000n).toString();
    }
  }

  const amountOut = numberFromRaw(buyAmount, buyPlaces);
  const minReceived = numberFromRaw(minBuyAmount, buyPlaces);
  const priceImpactRaw =
    quote.estimatedPriceImpact ?? quote.grossEstimatedPriceImpact ?? quote.priceImpact ?? null;
  const priceImpact = priceImpactRaw == null ? null : Number(priceImpactRaw);

  return {
    buyAmount,
    minBuyAmount,
    buyAmountFormatted: formatRaw(buyAmount, buyPlaces),
    minBuyAmountFormatted: formatRaw(minBuyAmount, buyPlaces),
    /* Display-only decimal values used by the existing quantity/MEV widgets. */
    amountOut,
    minReceived,
    ourFee: Number(formatRaw(ourFeeRaw.toString(), feePlaces) ?? 0),
    zeroExFee: zeroExFeeRaw == null ? null : Number(formatRaw(zeroExFeeRaw.toString(), feePlaces)),
    /* The whole point: paid in the sold token, so no native coin is needed. */
    gasFee: gasFeeRaw == null ? null : Number(formatRaw(gasFeeRaw.toString(), feePlaces)),
    gasFeeFormatted: gasFeeRaw == null ? null : formatRaw(gasFeeRaw.toString(), feePlaces),
    totalTokenFees: Number(formatRaw(
      (ourFeeRaw + (zeroExFeeRaw ?? 0n) + (gasFeeRaw ?? 0n)).toString(),
      feePlaces
    ) ?? 0),
    priceImpact: Number.isFinite(priceImpact) ? priceImpact : null,
    liquidityAvailable: quote.liquidityAvailable !== false,
    route: quote.route ?? null,
    /*
     * `approval` and `trade` are the two EIP-712 payloads. A token that already
     * has a Permit2 allowance returns only `trade`, so the UI must not assume
     * both are present — treating a missing approval as an error would break
     * the second swap of any token.
     */
    needsApproval: Boolean(quote.approval),
    /*
     * 0x reports the balance shortfall in `issues`. Surfacing it separately
     * from a generic failure means the user is told "you do not have enough"
     * rather than "something went wrong".
     */
    insufficientBalance: Boolean(quote.issues?.balance),
    sellAmount: quote.sellAmount ?? quote.grossSellAmount ?? null,
    sellToken: quote.sellToken ?? quote.sellTokenAddress ?? null,
    buyToken: quote.buyToken ?? quote.buyTokenAddress ?? null
  };
}
