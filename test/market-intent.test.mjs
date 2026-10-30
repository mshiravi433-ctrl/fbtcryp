import test from 'node:test';
import assert from 'node:assert/strict';
import { interpretMarketQuery, MARKET_INTENT_SUGGESTIONS } from '../src/lib/marketIntent.js';

test('natural language market requests map to live-data sort operations', () => {
  const gainers = interpretMarketQuery('پرسودترین ارزها');
  assert.equal(gainers.key, 'gainers');
  assert.equal(gainers.sortKey, 'change');
  assert.equal(gainers.sortDir, 'desc');
  assert.equal(interpretMarketQuery('ارزهایی با بیشترین حجم').key, 'volume');
  assert.equal(interpretMarketQuery('بزرگترین ارز از نظر ارزش بازار').key, 'mcap');
  assert.equal(interpretMarketQuery('بیشترین افت امروز').sortDir, 'asc');
  assert.equal(interpretMarketQuery('coins with the highest trading volume').sortKey, 'volume');
  assert.equal(interpretMarketQuery('top gainers').key, 'gainers');
  assert.equal(interpretMarketQuery('best coin by market cap').key, 'mcap');
  assert.equal(interpretMarketQuery('بهترین ارز امروز').key, 'gainers');
  assert.equal(interpretMarketQuery('Coins with the highest volume').key, 'volume');
});

test('ordinary coin names remain ordinary search terms', () => {
  for (const query of ['', 'bitcoin', 'BTC', 'اتریوم', 'sol']) {
    assert.equal(interpretMarketQuery(query), null, `${query} is not treated as a market instruction`);
  }
});

test('suggested questions are executable, distinct market intents', () => {
  assert.equal(MARKET_INTENT_SUGGESTIONS.length, 4);
  for (const suggestion of MARKET_INTENT_SUGGESTIONS) {
    assert.equal(interpretMarketQuery(suggestion.query)?.key, suggestion.key);
  }
});
