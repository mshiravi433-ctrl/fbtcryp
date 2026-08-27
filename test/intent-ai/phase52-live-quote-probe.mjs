/**
 * PHASE 52 — LIVE RATE AND SLIPPAGE RE-CHECK
 * A price feed is not an executable rate: the quote is locked into the terms,
 * re-checked at the instant of the confirm, and an adverse move past the limit
 * sends the user back through the EXISTING Confirmation Gate (REAUTHORIZE).
 */
import {
  normalizeQuote, fetchExecutionQuote, lockQuoteIntoTerms,
  effectiveSlippageLimit, recheckQuoteBeforeExecute,
  QUOTE_MAX_AGE_MS, GATE_BUTTONS
} from '../../src/lib/intent-ai/index.js';

const results = [];
const check = (name, ok) => results.push({ name, ok: Boolean(ok) });
const NOW = 1_800_000_000_000;
const rawQuote = (over = {}) => ({ amountIn: 100, amountOut: 0.04, source: 'aggregator', at: NOW, ...over });

try {
  /* --- normalisation is fail-closed --- */
  check('no quote object is unavailable', normalizeQuote(null, { now: NOW }).status === 'unavailable');
  check('a quote with no output is unavailable', normalizeQuote(rawQuote({ amountOut: 0 }), { now: NOW }).status === 'unavailable');
  check('a quote with no named source is unavailable', normalizeQuote(rawQuote({ source: null }), { now: NOW }).status === 'unavailable');
  const stale = normalizeQuote(rawQuote({ at: NOW - QUOTE_MAX_AGE_MS - 1 }), { now: NOW });
  check('a stale quote is unavailable, not executable', stale.ok === false && stale.error.detail === 'QUOTE_STALE');

  const good = normalizeQuote(rawQuote(), { now: NOW });
  check('a live quote is accepted and never marked fabricated', good.ok === true && good.quote.fabricated === false && good.quote.source === 'aggregator');

  /* --- taking the quote --- */
  const noSource = await fetchExecutionQuote({ draft: {}, now: NOW });
  check('no quote source is honest-unavailable', noSource.ok === false && noSource.error.detail === 'NO_QUOTE_SOURCE');

  const deadFeed = await fetchExecutionQuote({ draft: {}, quoteSource: async () => { throw new Error('feed down'); }, now: NOW });
  check('a dead feed is unavailable, never a guessed rate', deadFeed.ok === false && deadFeed.error.detail === 'QUOTE_SOURCE_FAILED');

  let asked = null;
  const fetched = await fetchExecutionQuote({
    draft: { fromSymbol: 'USDC', toSymbol: 'ETH', amountIn: 100, chainId: 42161 },
    quoteSource: async (args) => { asked = args; return rawQuote(); },
    now: NOW
  });
  check('the real quote is taken for the actual draft', fetched.ok === true && asked.fromSymbol === 'USDC' && asked.amountIn === 100);

  /* --- locking it into the terms --- */
  const terms = lockQuoteIntoTerms({ amountIn: 100, chainId: 42161 }, fetched.quote);
  check('the quote is frozen into the locked terms',
    terms.quoteStatus === 'live' && terms.quotedAmountOut === 0.04 && terms.quoteSource === 'aggregator' && terms.quotedAt === NOW);
  check('no quote leaves the terms honestly empty', lockQuoteIntoTerms({}, null).quoteStatus === 'unavailable');

  /* --- the slippage limit that binds --- */
  check('the tightest of draft and policy limits wins',
    effectiveSlippageLimit({ draft: { slippagePct: 0.8 }, policy: { maxSlippagePct: 0.3 } }) === 0.3);
  check('with nothing stated there is still a default limit', effectiveSlippageLimit({}) > 0);

  /* --- the re-check at the instant of the confirm --- */
  const locked = fetched.quote;
  const unchanged = recheckQuoteBeforeExecute({ lockedQuote: locked, freshQuote: locked, maxSlippagePct: 1, now: NOW });
  check('an unchanged rate executes', unchanged.ok === true && unchanged.action === 'EXECUTE');

  const small = normalizeQuote(rawQuote({ amountOut: 0.0398 }), { now: NOW }).quote; // -0.5%
  const withinLimit = recheckQuoteBeforeExecute({ lockedQuote: locked, freshQuote: small, maxSlippagePct: 1, now: NOW });
  check('a move inside the limit still executes', withinLimit.ok === true && withinLimit.deviationPct > 0 && withinLimit.deviationPct < 1);

  const worse = normalizeQuote(rawQuote({ amountOut: 0.0380 }), { now: NOW }).quote; // -5%
  const blocked = recheckQuoteBeforeExecute({ lockedQuote: locked, freshQuote: worse, maxSlippagePct: 1, now: NOW });
  check('a move past the slippage limit does NOT execute', blocked.ok === false);
  check('it routes to REAUTHORIZE through the existing gate action set',
    blocked.action === 'REAUTHORIZE' && blocked.reauthoriseRequired === true && GATE_BUTTONS.includes('REAUTHORIZE'));
  check('the refusal is classified as changed terms, not as a success', blocked.error.code === 'TERMS_CHANGED');

  const better = normalizeQuote(rawQuote({ amountOut: 0.05 }), { now: NOW }).quote;
  const favourable = recheckQuoteBeforeExecute({ lockedQuote: locked, freshQuote: better, maxSlippagePct: 1, now: NOW });
  check('a favourable move is never treated as a reason to block', favourable.ok === true && favourable.deviationPct < 0);

  const goneStale = recheckQuoteBeforeExecute({ lockedQuote: locked, freshQuote: locked, maxSlippagePct: 1, now: NOW + QUOTE_MAX_AGE_MS + 1 });
  check('a stale re-check is unavailable, not an execution', goneStale.ok === false && goneStale.action === 'UNAVAILABLE');

  const noFresh = recheckQuoteBeforeExecute({ lockedQuote: locked, freshQuote: null, now: NOW });
  check('no fresh quote means no execution', noFresh.ok === false && noFresh.action === 'UNAVAILABLE');

  console.log(JSON.stringify({ probe: 'phase52-live-quote', passed: results.filter((r) => r.ok).length, results }, null, 2));
  if (results.some((r) => !r.ok)) process.exitCode = 1;
} catch (e) {
  console.error(e);
  process.exitCode = 1;
}

export default results;
