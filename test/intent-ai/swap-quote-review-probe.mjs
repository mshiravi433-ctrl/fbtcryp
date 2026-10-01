import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createSwapQuoteReview,
  validateFreshQuoteAgainstReview
} from '../../src/lib/intent-ai/quoteReview.js';
import { runAction } from '../../src/lib/intent-ai/executionRuntime.js';

const FROM_ADDRESS = '0x1111111111111111111111111111111111111111';
const TO_ADDRESS = '0x2222222222222222222222222222222222222222';
const ACTION = Object.freeze({
  type: 'SWAP',
  chainId: 1,
  from: 'USDC',
  to: 'WETH',
  amount: '10',
  amountUnit: 'USDC'
});

function makeQuote(overrides = {}) {
  return {
    chainId: 1,
    source: 'aggregator',
    selectedSolver: 'kyberswap',
    routesChecked: 2,
    hops: 2,
    amountInWei: 10_000_000n,
    amountOutWei: 5_000_000_000_000_000n,
    minOutWei: 4_975_000_000_000_000n,
    amountOut: 0.005,
    minOut: 0.004975,
    feeBps: 70,
    platformFee: 0.07,
    platformFeeWei: 70_000n,
    slippage: 0.5,
    gasUsd: 0.42,
    priceImpactPct: 0.03,
    fromToken: { symbol: 'USDC', address: FROM_ADDRESS, decimals: 6, native: false },
    toToken: { symbol: 'WETH', address: TO_ADDRESS, decimals: 18, native: false },
    ...overrides
  };
}

function makeReview({ now = 1_000_000, action = ACTION, quote = makeQuote() } = {}) {
  const result = createSwapQuoteReview({ action, quote, networkName: 'Ethereum', now });
  assert.equal(result.ok, true, result.code);
  return result.review;
}

function freshHooks({ quote = makeQuote(), balanceRaw = '100000000', allowance = false, counters = {} } = {}) {
  return {
    async getQuote() { counters.quoted = (counters.quoted || 0) + 1; return quote; },
    async getBalance() {
      counters.balanceRead = (counters.balanceRead || 0) + 1;
      return { ok: true, raw: balanceRaw, symbol: 'USDC', chainId: 1, decimals: 6, tokenAddress: FROM_ADDRESS };
    },
    async checkAllowance() { counters.allowanceRead = (counters.allowanceRead || 0) + 1; return allowance; },
    async simulate() { return { ok: true }; },
    async sendTransaction() { counters.signed = (counters.signed || 0) + 1; return { txHash: '0xreceipt' }; },
    async waitForConfirmation(txHash) {
      return { ok: true, status: 'CONFIRMED', txHash, receipt: { status: 1, transactionHash: txHash } };
    }
  };
}

const wallet = { connected: true, canSign: true, address: '0x3333333333333333333333333333333333333333', chainId: 1 };

test('review records exact pair, raw terms, provenance, and expiry without calldata', () => {
  const review = makeReview();
  assert.equal(review.schema, 'fbt.ai-swap-quote-review.v1');
  assert.equal(review.from, 'USDC');
  assert.equal(review.to, 'WETH');
  assert.equal(review.amountInWei, '10000000');
  assert.equal(review.minOutWei, '4975000000000000');
  assert.equal(review.fromAddress, FROM_ADDRESS);
  assert.equal(review.routeSource, 'aggregator');
  assert.equal(review.solver, 'kyberswap');
  assert.equal(review.mevStatus, 'unverified');
  assert.equal(review.expiresAt - review.quotedAt, 30_000);
  assert.equal(JSON.stringify(review).includes('calldata'), false);
});

test('review creation rejects ambiguous units and incomplete quotes', () => {
  assert.equal(createSwapQuoteReview({ action: { ...ACTION, amountUnit: null }, quote: makeQuote(), now: 1 }).code, 'AMOUNT_UNIT_REQUIRED');
  assert.equal(createSwapQuoteReview({ action: ACTION, quote: { ...makeQuote(), amountOutWei: null }, now: 1 }).code, 'QUOTE_TERMS_INCOMPLETE');
  assert.equal(createSwapQuoteReview({ action: ACTION, quote: { ...makeQuote(), fromToken: { symbol: 'USDC', decimals: 6, native: false } }, now: 1 }).code, 'QUOTE_TERMS_INCOMPLETE');
});

test('fresh quote comparison allows only same reviewed terms and non-worse minimum output', () => {
  const review = makeReview();
  assert.equal(validateFreshQuoteAgainstReview({ review, action: ACTION, quote: makeQuote(), now: review.quotedAt + 1 }).ok, true);
  const worse = makeQuote({
    amountOutWei: 4_900_000_000_000_000n,
    minOutWei: 4_875_500_000_000_000n,
    amountOut: 0.0049,
    minOut: 0.0048755
  });
  assert.equal(validateFreshQuoteAgainstReview({ review, action: ACTION, quote: worse, now: review.quotedAt + 1 }).code, 'SLIPPAGE_EXCEEDED');
  assert.equal(validateFreshQuoteAgainstReview({ review, action: ACTION, quote: makeQuote({ source: 'openocean' }), now: review.quotedAt + 1 }).code, 'QUOTE_CHANGED');
  assert.equal(validateFreshQuoteAgainstReview({ review, action: ACTION, quote: makeQuote(), now: review.expiresAt }).code, 'QUOTE_REVIEW_EXPIRED');
});

test('runtime refuses a worse fresh quote before checking balances or requesting a signature', async () => {
  const review = makeReview();
  const counters = {};
  const hooks = freshHooks({
    quote: makeQuote({
      amountOutWei: 4_900_000_000_000_000n,
      minOutWei: 4_875_500_000_000_000n,
      amountOut: 0.0049,
      minOut: 0.0048755
    }),
    counters
  });
  const result = await runAction({ ...ACTION, quoteReview: review, requiresQuoteReview: true }, { hooks, wallet, now: review.quotedAt + 1 });
  assert.equal(result.success, false);
  assert.equal(result.error?.code, 'SLIPPAGE_EXCEEDED');
  assert.equal(counters.quoted, 1);
  assert.equal(counters.balanceRead || 0, 0);
  assert.equal(counters.signed || 0, 0);
});

test('runtime checks exact balance and allowance before signing, then requires a confirmed receipt', async () => {
  const review = makeReview();
  const counters = {};
  const hooks = freshHooks({ counters });
  const result = await runAction({ ...ACTION, quoteReview: review, requiresQuoteReview: true }, { hooks, wallet, now: review.quotedAt + 1 });
  assert.equal(result.success, true, String(result.error?.code || result.status));
  assert.equal(result.status, 'CONFIRMED');
  assert.equal(counters.balanceRead, 1);
  assert.equal(counters.allowanceRead, 1);
  assert.equal(counters.signed, 1);

  const insufficient = freshHooks({ balanceRaw: '9999999', counters: {} });
  const short = await runAction({ ...ACTION, quoteReview: review, requiresQuoteReview: true }, { hooks: insufficient, wallet, now: review.quotedAt + 1 });
  assert.equal(short.success, false);
  assert.equal(short.error?.code, 'INSUFFICIENT_FUNDS');
  assert.equal(insufficient.signed || 0, 0);
});

test('runtime rejects expired reviews and missing allowance verification before signing', async () => {
  const review = makeReview();
  const expiredHooks = freshHooks({ counters: {} });
  const expired = await runAction({ ...ACTION, quoteReview: review, requiresQuoteReview: true }, { hooks: expiredHooks, wallet, now: review.expiresAt });
  assert.equal(expired.success, false);
  assert.equal(expired.error?.code, 'QUOTE_REVIEW_EXPIRED');
  assert.equal(expiredHooks.signed || 0, 0);

  const hooks = freshHooks({ counters: {} });
  delete hooks.checkAllowance;
  const missingAllowance = await runAction({ ...ACTION, quoteReview: review, requiresQuoteReview: true }, { hooks, wallet, now: review.quotedAt + 1 });
  assert.equal(missingAllowance.success, false);
  assert.equal(missingAllowance.error?.code, 'ALLOWANCE_READ_FAILED');
  assert.equal(hooks.signed || 0, 0);
});
