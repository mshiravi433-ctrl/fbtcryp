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

async function call(path, params, { timeout = 25000 } = {}) {
  const ctrl = new AbortController();
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
export function summariseGasless(quote, decimals = 6) {
  if (!quote) return null;

  const f = quote.fees ?? {};
  const num = (v) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  };

  /*
   * `integratorFees` is the newer array shape and `integratorFee` the older
   * single object. Both are read because 0x returns whichever suits the route,
   * and assuming one would silently report our fee as zero on half of them.
   */
  const ourFeeRaw = Array.isArray(f.integratorFees)
    ? f.integratorFees.reduce((n, x) => n + num(x?.amount), 0)
    : num(f.integratorFee?.amount);

  const scale = 10 ** (Number(decimals) || 6);

  return {
    buyAmount: quote.buyAmount ?? null,
    minBuyAmount: quote.minBuyAmount ?? null,
    ourFee: ourFeeRaw / scale,
    zeroExFee: num(f.zeroExFee?.amount) / scale,
    /* The whole point: paid in the sold token, so no native coin is needed. */
    gasFee: num(f.gasFee?.amount) / scale,
    liquidityAvailable: quote.liquidityAvailable !== false,
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
    insufficientBalance: Boolean(quote.issues?.balance)
  };
}
