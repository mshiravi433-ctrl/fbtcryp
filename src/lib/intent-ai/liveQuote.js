/**
 * FBT INTENT AI — PHASE 52: LIVE QUOTE + SLIPPAGE RE-CHECK
 * ---------------------------------------------------------------------------
 * A price feed is not an executable rate. Before the confirmation screen the
 * pipeline takes a REAL quote, freezes it into the locked terms, and then —
 * at the instant of the final confirm — takes a second quote and compares.
 *
 *   · quote missing / stale / malformed → honest `unavailable`, no execution
 *   · adverse move beyond the slippage limit → NOT executed; the user is sent
 *     back through the EXISTING Confirmation Gate as REAUTHORIZE
 *   · a favourable move is never treated as a reason to block
 *
 * The quote source is injected (`quoteSource`) so this module stays free of
 * Vite-only imports and is fully probe-able in plain Node.
 */

import { classifyFailure } from './failureModes.js';

export const LIVE_QUOTE_SCHEMA = 'fbt.live-quote.v1';
/** A quote older than this is not executable. */
export const QUOTE_MAX_AGE_MS = 30_000;
/** Used when neither the draft nor the policy states a slippage limit. */
export const DEFAULT_MAX_SLIPPAGE_PCT = 1;

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : null);

function unavailable(detail) {
  return {
    ok: false,
    status: 'unavailable',
    quote: null,
    error: classifyFailure('MISSING_DATA', { detail })
  };
}

/** Normalise whatever the injected source returned into an honest quote. */
export function normalizeQuote(raw, { now = Date.now(), maxAgeMs = QUOTE_MAX_AGE_MS } = {}) {
  if (!raw || typeof raw !== 'object') return unavailable('QUOTE_EMPTY');
  const amountOut = num(raw.amountOut ?? raw.toAmount ?? raw.buyAmount);
  const amountIn = num(raw.amountIn ?? raw.fromAmount ?? raw.sellAmount);
  const at = num(raw.at ?? raw.timestamp ?? raw.fetchedAt) ?? now;
  if (amountOut === null || amountOut <= 0) return unavailable('QUOTE_NO_OUTPUT');
  if (now - at > maxAgeMs) return unavailable('QUOTE_STALE');
  const source = typeof raw.source === 'string' && raw.source ? raw.source.slice(0, 40) : null;
  if (!source) return unavailable('QUOTE_NO_SOURCE');
  return {
    ok: true,
    status: 'live',
    quote: Object.freeze({
      schema: LIVE_QUOTE_SCHEMA,
      amountIn,
      amountOut,
      price: amountIn && amountIn > 0 ? amountOut / amountIn : num(raw.price),
      slippagePct: num(raw.slippagePct),
      priceImpactPct: num(raw.priceImpactPct),
      source,
      at,
      ageMs: now - at,
      fabricated: false
    })
  };
}

/**
 * Take a real, executable quote for a draft.
 * @param {object}   draft
 * @param {function} quoteSource async ({fromSymbol,toSymbol,amountIn,chainId}) → raw quote
 */
export async function fetchExecutionQuote({ draft = {}, quoteSource, now = Date.now(), maxAgeMs = QUOTE_MAX_AGE_MS } = {}) {
  if (typeof quoteSource !== 'function') return unavailable('NO_QUOTE_SOURCE');
  let raw = null;
  try {
    raw = await quoteSource({
      fromSymbol: draft.fromSymbol || null,
      toSymbol: draft.toSymbol || null,
      amountIn: num(draft.amountIn ?? draft.amountUsd),
      chainId: num(draft.chainId),
      protocol: draft.protocol || 'swap'
    });
  } catch {
    return unavailable('QUOTE_SOURCE_FAILED');
  }
  return normalizeQuote(raw, { now, maxAgeMs });
}

/** Freeze a live quote into the locked terms so the gate hashes what runs. */
export function lockQuoteIntoTerms(terms = {}, quote = null) {
  if (!quote || quote.schema !== LIVE_QUOTE_SCHEMA) {
    return { ...terms, quote: null, quoteStatus: 'unavailable' };
  }
  return {
    ...terms,
    quoteStatus: 'live',
    quotedAmountOut: quote.amountOut,
    quotedAt: quote.at,
    quoteSource: quote.source,
    quote
  };
}

/** The slippage limit that actually binds: draft → policy → default. */
export function effectiveSlippageLimit({ draft = {}, policy = null } = {}) {
  const fromDraft = num(draft.maxSlippagePct ?? draft.slippagePct);
  const fromPolicy = num(policy?.maxSlippagePct);
  const candidates = [fromDraft, fromPolicy].filter((v) => v !== null && v > 0);
  if (!candidates.length) return DEFAULT_MAX_SLIPPAGE_PCT;
  return Math.min(...candidates);
}

/**
 * The final-confirm re-check. Adverse deviation beyond the limit is a refusal
 * plus REAUTHORIZE — never "hope it fills".
 */
export function recheckQuoteBeforeExecute({
  lockedQuote,
  freshQuote,
  maxSlippagePct = DEFAULT_MAX_SLIPPAGE_PCT,
  now = Date.now(),
  maxAgeMs = QUOTE_MAX_AGE_MS
} = {}) {
  if (!lockedQuote || lockedQuote.schema !== LIVE_QUOTE_SCHEMA) {
    return { ok: false, action: 'UNAVAILABLE', deviationPct: null, error: classifyFailure('MISSING_DATA', { detail: 'NO_LOCKED_QUOTE' }) };
  }
  if (!freshQuote || freshQuote.schema !== LIVE_QUOTE_SCHEMA) {
    return { ok: false, action: 'UNAVAILABLE', deviationPct: null, error: classifyFailure('MISSING_DATA', { detail: 'NO_FRESH_QUOTE' }) };
  }
  if (now - freshQuote.at > maxAgeMs) {
    return { ok: false, action: 'UNAVAILABLE', deviationPct: null, error: classifyFailure('MISSING_DATA', { detail: 'QUOTE_STALE' }) };
  }
  const before = Number(lockedQuote.amountOut);
  const after = Number(freshQuote.amountOut);
  if (!(before > 0) || !(after > 0)) {
    return { ok: false, action: 'UNAVAILABLE', deviationPct: null, error: classifyFailure('MISSING_DATA', { detail: 'QUOTE_NO_OUTPUT' }) };
  }
  // Positive deviation = the user now receives LESS than what was locked.
  const deviationPct = ((before - after) / before) * 100;
  const limit = Number(maxSlippagePct) > 0 ? Number(maxSlippagePct) : DEFAULT_MAX_SLIPPAGE_PCT;
  if (deviationPct > limit) {
    return {
      ok: false,
      action: 'REAUTHORIZE',
      deviationPct,
      limitPct: limit,
      reauthoriseRequired: true,
      error: classifyFailure('TERMS_CHANGED', { detail: `SLIPPAGE_EXCEEDED:${deviationPct.toFixed(3)}` })
    };
  }
  return { ok: true, action: 'EXECUTE', deviationPct, limitPct: limit, minAmountOut: before * (1 - limit / 100) };
}
