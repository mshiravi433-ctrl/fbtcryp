import { describe, expect, it } from 'vitest';
import { chooseActiveDydxMarket } from '../src/lib/dydx.js';

const markets = [
  { ticker: 'BTC-USD', status: 'ACTIVE', volume24H: 5 },
  { ticker: 'ALT-USD', status: 'ACTIVE', volume24H: 100 },
  { ticker: 'OLD-USD', status: 'CANCEL_ONLY', volume24H: 500 }
];

describe('dYdX active-market handoff', () => {
  it('keeps the exact active ticker from the Perpetual catalogue', () => {
    expect(chooseActiveDydxMarket(markets, 'BTC-USD', { allowFallback: false })).toBe(markets[0]);
  });

  it('does not silently replace a requested but unavailable/delisted ticker', () => {
    expect(chooseActiveDydxMarket(markets, 'OLD-USD', { allowFallback: false })).toBeNull();
    expect(chooseActiveDydxMarket(markets, 'MISSING-USD', { allowFallback: false })).toBeNull();
  });

  it('uses the first active market only on a landing route with no requested ticker', () => {
    expect(chooseActiveDydxMarket(markets, 'BTC-USD')).toBe(markets[0]);
    expect(chooseActiveDydxMarket([{ ticker: 'OLD-USD', status: 'CANCEL_ONLY' }], '')).toBeNull();
  });
});
