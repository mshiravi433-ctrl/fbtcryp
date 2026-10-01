/**
 * FBT Intent AI — user-visible, short-lived swap quote terms.
 *
 * The card stores only terms the user can review (not router calldata). The
 * wallet-side runtime always obtains a second quote and refuses to sign if
 * the route, pair, input, fee, slippage, or reviewed minimum output changed.
 */

export const SWAP_QUOTE_REVIEW_SCHEMA = 'fbt.ai-swap-quote-review.v1';
export const SWAP_QUOTE_REVIEW_TTL_MS = 30_000;

function finite(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function positiveBigInt(value) {
  try {
    if (value === null || value === undefined || value === '') return null;
    const n = BigInt(value);
    return n > 0n ? n : null;
  } catch {
    return null;
  }
}

function nonNegativeBigInt(value) {
  try {
    if (value === null || value === undefined || value === '') return null;
    const n = BigInt(value);
    return n >= 0n ? n : null;
  } catch {
    return null;
  }
}

function addressOf(token) {
  if (token?.native === true) return null;
  const value = String(token?.address || '').trim();
  return /^0x[a-fA-F0-9]{40}$/.test(value) ? value : null;
}

function normalizedPair(value) {
  return String(value || '').trim().toUpperCase();
}

function normalizedAddress(value) {
  return String(value || '').trim().toLowerCase() || null;
}

/** Build a serializable review record from the *exact* getQuote result. */
export function createSwapQuoteReview({ action = {}, quote = null, networkName = null, now = Date.now(), ttlMs = SWAP_QUOTE_REVIEW_TTL_MS } = {}) {
  if (!action?.from || !action?.to || !Number.isFinite(Number(action?.chainId)) || !String(action?.amount ?? '').trim()) {
    return { ok: false, code: 'QUOTE_TERMS_INCOMPLETE' };
  }
  if (normalizedPair(action.amountUnit) !== normalizedPair(action.from)) {
    return { ok: false, code: 'AMOUNT_UNIT_REQUIRED' };
  }
  if (!quote || typeof quote !== 'object' || quote.error || quote.executable === false) {
    return { ok: false, code: quote?.error || 'NO_EXECUTABLE_QUOTE' };
  }

  const chainId = Number(action.chainId);
  const quoteChainId = finite(quote.chainId);
  const inputWei = positiveBigInt(quote.amountInWei);
  const outputWei = positiveBigInt(quote.amountOutWei);
  const minimumWei = positiveBigInt(quote.minOutWei);
  const amountOut = finite(quote.amountOut);
  const minOut = finite(quote.minOut);
  const inputToken = quote.fromToken || {};
  const outputToken = quote.toToken || {};
  const fromAddress = addressOf(inputToken);
  const toAddress = addressOf(outputToken);

  if (quoteChainId !== chainId
    || normalizedPair(inputToken.symbol) !== normalizedPair(action.from)
    || normalizedPair(outputToken.symbol) !== normalizedPair(action.to)
    || !inputWei || !outputWei || !minimumWei || !amountOut || amountOut <= 0
    || !minOut || minOut <= 0
    || (!inputToken.native && !fromAddress)
    || (!outputToken.native && !toAddress)) {
    return { ok: false, code: 'QUOTE_TERMS_INCOMPLETE' };
  }

  const feeBps = finite(quote.feeBps);
  const slippage = finite(quote.slippage);
  if (feeBps == null || feeBps < 0 || slippage == null || slippage < 0 || slippage >= 100) {
    return { ok: false, code: 'QUOTE_TERMS_INCOMPLETE' };
  }

  const timestamp = Math.max(0, Number(now) || Date.now());
  const output = {
    schema: SWAP_QUOTE_REVIEW_SCHEMA,
    status: 'live',
    quotedAt: timestamp,
    expiresAt: timestamp + Math.max(1_000, Number(ttlMs) || SWAP_QUOTE_REVIEW_TTL_MS),
    chainId,
    networkName: String(networkName || quote.chainName || `Chain ${chainId}`),
    from: normalizedPair(action.from),
    to: normalizedPair(action.to),
    amountIn: String(action.amount),
    amountInWei: inputWei.toString(),
    amountOut,
    amountOutWei: outputWei.toString(),
    minOut,
    minOutWei: minimumWei.toString(),
    fromDecimals: Number.isInteger(Number(inputToken.decimals)) ? Number(inputToken.decimals) : null,
    toDecimals: Number.isInteger(Number(outputToken.decimals)) ? Number(outputToken.decimals) : null,
    fromAddress,
    toAddress,
    fromNative: inputToken.native === true,
    toNative: outputToken.native === true,
    routeSource: String(quote.source || 'unknown').slice(0, 40),
    solver: String(quote.selectedSolver || quote.source || 'unknown').slice(0, 40),
    routesChecked: Math.max(1, Math.floor(finite(quote.routesChecked) || 1)),
    hops: Math.max(1, Math.floor(finite(quote.hops) || 1)),
    feeBps,
    platformFee: finite(quote.platformFee),
    platformFeeWei: nonNegativeBigInt(quote.platformFeeWei)?.toString() ?? null,
    slippage,
    gasUsd: finite(quote.gasUsd),
    priceImpactPct: finite(quote.priceImpactPct),
    /* The underlying quote adapters do not attest to anti-MEV protection. */
    mevStatus: 'unverified',
    executable: true
  };

  return { ok: true, review: output };
}

/**
 * Compare the fresh quote obtained immediately before execution to the exact
 * terms shown in the chat. A user must review again if any material term moves.
 */
export function validateFreshQuoteAgainstReview({ review = null, action = {}, quote = null, now = Date.now() } = {}) {
  if (!review || review.schema !== SWAP_QUOTE_REVIEW_SCHEMA) return { ok: false, code: 'QUOTE_REVIEW_REQUIRED' };
  if (!Number.isFinite(Number(review.expiresAt)) || Number(review.expiresAt) <= Number(now)) {
    return { ok: false, code: 'QUOTE_REVIEW_EXPIRED' };
  }
  if (!quote || quote.error || quote.executable === false) return { ok: false, code: 'NO_EXECUTABLE_QUOTE' };

  const inputWei = positiveBigInt(quote.amountInWei);
  const outputWei = positiveBigInt(quote.amountOutWei);
  const minimumWei = positiveBigInt(quote.minOutWei);
  const reviewedMin = positiveBigInt(review.minOutWei);
  const fromAddress = addressOf(quote.fromToken || {});
  const toAddress = addressOf(quote.toToken || {});

  if (!inputWei || !outputWei || !minimumWei || !reviewedMin) return { ok: false, code: 'QUOTE_TERMS_INCOMPLETE' };

  const matches = Number(action.chainId) === Number(review.chainId)
    && Number(quote.chainId) === Number(review.chainId)
    && normalizedPair(action.from) === normalizedPair(review.from)
    && normalizedPair(action.to) === normalizedPair(review.to)
    && normalizedPair(quote.fromToken?.symbol) === normalizedPair(review.from)
    && normalizedPair(quote.toToken?.symbol) === normalizedPair(review.to)
    && String(action.amount ?? '') === String(review.amountIn)
    && inputWei.toString() === String(review.amountInWei)
    && normalizedAddress(fromAddress) === normalizedAddress(review.fromAddress)
    && normalizedAddress(toAddress) === normalizedAddress(review.toAddress)
    && String(quote.source || 'unknown') === String(review.routeSource || 'unknown')
    && String(quote.selectedSolver || quote.source || 'unknown') === String(review.solver || 'unknown')
    && finite(quote.feeBps) === finite(review.feeBps)
    && finite(quote.slippage) === finite(review.slippage);

  if (!matches) return { ok: false, code: 'QUOTE_CHANGED' };
  if (minimumWei < reviewedMin || outputWei < reviewedMin) {
    return { ok: false, code: 'SLIPPAGE_EXCEEDED' };
  }
  return { ok: true, code: 'QUOTE_MATCHED' };
}
