/**
 * SPOT TRADE — pure arithmetic. Decimals for USDC (6), USDT (6), ETH/WETH (18)
 * are pinned because a one-digit error there is a 10^12 mispricing.
 * Run: node --test test/spot-trade-math.test.mjs
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseAmountWei,
  formatWeiFloor,
  floorMinOutWei,
  verifyQuoteProtection,
  isQuoteStale,
  slippageLevel,
  impactLevel,
  directedPair,
  defaultQuoteAsset,
  SPOT_QUOTE_MAX_AGE_MS
} from '../src/lib/spot/spotMath.js';

const USDC = { symbol: 'USDC', address: '0xA0b8', decimals: 6 };
const USDT = { symbol: 'USDT', address: '0xdAC1', decimals: 6 };
const ETH = { symbol: 'ETH', address: null, decimals: 18, native: true };
const WETH = { symbol: 'WETH', address: '0xC02a', decimals: 18 };

describe('parseAmountWei — exact, never rounds the amount the user pays', () => {
  it('USDC/USDT use 6 decimals', () => {
    assert.deepEqual(parseAmountWei('1.5', 6), { ok: true, wei: 1_500_000n });
    assert.deepEqual(parseAmountWei('0.000001', 6), { ok: true, wei: 1n });
    assert.deepEqual(parseAmountWei('1000', 6), { ok: true, wei: 1_000_000_000n });
  });

  it('ETH/WETH use 18 decimals', () => {
    assert.deepEqual(parseAmountWei('1', 18), { ok: true, wei: 10n ** 18n });
    assert.deepEqual(parseAmountWei('0.1', 18), { ok: true, wei: 10n ** 17n });
    assert.deepEqual(parseAmountWei('.000000000000000001', 18), { ok: true, wei: 1n });
  });

  it('refuses more decimals than the token has instead of rounding them away', () => {
    assert.equal(parseAmountWei('0.0000001', 6).code, 'TOO_MANY_DECIMALS');
    assert.equal(parseAmountWei('1.0000000000000000001', 18).code, 'TOO_MANY_DECIMALS');
  });

  it('rejects empty, zero, negative, exponent and garbage input', () => {
    assert.equal(parseAmountWei('', 6).code, 'AMOUNT_REQUIRED');
    assert.equal(parseAmountWei('   ', 6).code, 'AMOUNT_REQUIRED');
    assert.equal(parseAmountWei('0', 6).code, 'AMOUNT_ZERO');
    assert.equal(parseAmountWei('0.000', 6).code, 'AMOUNT_ZERO');
    assert.equal(parseAmountWei('-1', 6).code, 'INVALID_AMOUNT');
    assert.equal(parseAmountWei('1e3', 6).code, 'INVALID_AMOUNT');
    assert.equal(parseAmountWei('abc', 6).code, 'INVALID_AMOUNT');
    assert.equal(parseAmountWei('5.', 6).code, 'INVALID_AMOUNT');
  });
});

describe('formatWeiFloor — the user never sees more than they hold or will get', () => {
  it('floors instead of rounding up', () => {
    // 1.9999999 USDC → "1.999999" with 6 places, never "2"
    assert.equal(formatWeiFloor(1_999_999n, 6, 6), '1.999999');
    assert.equal(formatWeiFloor(1_999_999n, 6, 2), '1.99');
  });

  it('removes trailing zeros and keeps whole numbers clean', () => {
    assert.equal(formatWeiFloor(1_500_000n, 6, 6), '1.5');
    assert.equal(formatWeiFloor(2_000_000n, 6, 6), '2');
    assert.equal(formatWeiFloor(0n, 18, 6), '0');
  });

  it('handles ETH-sized values exactly', () => {
    assert.equal(formatWeiFloor(10n ** 18n + 5n * 10n ** 15n, 18, 6), '1.005');
    assert.equal(formatWeiFloor(123_456_789_012_345_678n, 18, 6), '0.123456');
  });
});

describe('floorMinOutWei and verifyQuoteProtection — slippage is enforced on the quote', () => {
  it('computes the floor minimum with the same integer maths as lib/swap.js', () => {
    // 0.5% slippage keeps 99.5% → floor(1000 × 9950 / 10000) = 995
    assert.equal(floorMinOutWei(1000n, 0.5), 995n);
    // 1 USDC out at 0.5% → 995000 base units
    assert.equal(floorMinOutWei(1_000_000n, 0.5), 995_000n);
  });

  it('accepts a quote whose minimum is exactly the accepted floor', () => {
    const quote = { amountOutWei: 1_000_000n, minOutWei: 995_000n };
    assert.deepEqual(verifyQuoteProtection({ quote, slippagePct: 0.5 }), { ok: true });
  });

  it('refuses a quote whose minimum allows MORE slippage than the user accepted', () => {
    const quote = { amountOutWei: 1_000_000n, minOutWei: 900_000n }; // 10% allowed
    assert.equal(verifyQuoteProtection({ quote, slippagePct: 0.5 }).code, 'SLIPPAGE_EXCEEDED');
  });

  it('refuses missing, errored and internally inconsistent quotes', () => {
    assert.equal(verifyQuoteProtection({ quote: null, slippagePct: 0.5 }).code, 'QUOTE_MISSING');
    assert.equal(verifyQuoteProtection({ quote: { error: 'NO_ROUTE' }, slippagePct: 0.5 }).code, 'QUOTE_MISSING');
    assert.equal(
      verifyQuoteProtection({ quote: { amountOutWei: 10n, minOutWei: 11n }, slippagePct: 0.5 }).code,
      'QUOTE_INVALID'
    );
    assert.equal(
      verifyQuoteProtection({ quote: { amountOutWei: 10, minOutWei: 9 }, slippagePct: 0.5 }).code,
      'QUOTE_INVALID'
    );
  });
});

describe('quote freshness', () => {
  const t0 = 1_000_000;
  it('is fresh just before the window and stale at the window', () => {
    assert.equal(isQuoteStale(t0, t0 + SPOT_QUOTE_MAX_AGE_MS - 1), false);
    assert.equal(isQuoteStale(t0, t0 + SPOT_QUOTE_MAX_AGE_MS), true);
  });
  it('treats a quote with no timestamp as stale, never as fresh', () => {
    assert.equal(isQuoteStale(undefined, t0), true);
    assert.equal(isQuoteStale(NaN, t0), true);
  });
});

describe('slippage and impact levels', () => {
  it('slippage outside [0.01, 5] is invalid; 3 and up is high', () => {
    assert.equal(slippageLevel(0), 'invalid');
    assert.equal(slippageLevel(0.009), 'invalid');
    assert.equal(slippageLevel(5.01), 'invalid');
    assert.equal(slippageLevel(NaN), 'invalid');
    assert.equal(slippageLevel(0.5), 'ok');
    assert.equal(slippageLevel(2.99), 'ok');
    assert.equal(slippageLevel(3), 'high');
    assert.equal(slippageLevel(5), 'high');
  });

  it('price impact warns from 1% and is high from 5%', () => {
    assert.equal(impactLevel(0.99), null);
    assert.equal(impactLevel(1), 'warn');
    assert.equal(impactLevel(4.99), 'warn');
    assert.equal(impactLevel(5), 'high');
    assert.equal(impactLevel(null), null);
  });
});

describe('pairs', () => {
  it('buy pays the quote asset and receives the asset; sell is the reverse', () => {
    assert.deepEqual(directedPair({ side: 'buy', asset: WETH, quoteAsset: USDC }), {
      fromToken: USDC,
      toToken: WETH
    });
    assert.deepEqual(directedPair({ side: 'sell', asset: WETH, quoteAsset: USDC }), {
      fromToken: WETH,
      toToken: USDC
    });
  });

  it('the same token on both sides is no pair at all', () => {
    assert.equal(directedPair({ side: 'buy', asset: USDC, quoteAsset: USDC }), null);
    assert.equal(directedPair({ side: 'buy', asset: null, quoteAsset: USDC }), null);
  });

  it('defaults the quote currency to a stablecoin, and never to the asset itself', () => {
    assert.equal(defaultQuoteAsset([ETH, WETH, USDT, USDC]).symbol, 'USDC');
    assert.equal(defaultQuoteAsset([ETH, WETH, USDT], null).symbol, 'USDT');
    assert.equal(defaultQuoteAsset([USDC, USDT], USDC).symbol, 'USDT');
    assert.equal(defaultQuoteAsset([ETH], ETH), null);
  });
});
