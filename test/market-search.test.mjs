import assert from 'node:assert/strict';
import test from 'node:test';
import { contractQuery, mergeSearchResults, rankCoinMatches } from '../src/lib/marketSearch.js';

test('contract queries are exact identifiers, not fuzzy text', () => {
  assert.deepEqual(contractQuery('0x1111111111111111111111111111111111111111'), {
    kind: 'evm', address: '0x1111111111111111111111111111111111111111'
  });
  assert.equal(contractQuery('0x123'), null);
  assert.equal(contractQuery('So11111111111111111111111111111111111111112').kind, 'solana');
  assert.equal(contractQuery('bitcoin'), null);
  assert.equal(contractQuery('0xOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOO'), null);
});

test('autocomplete ranks exact tickers first and deduplicates wider results', () => {
  const rows = [
    { id: 'bitcoin', symbol: 'BTC', name: 'Bitcoin', rank: 1 },
    { id: 'bitcoin-cash', symbol: 'BCH', name: 'Bitcoin Cash', rank: 20 },
    { id: 'wrapped-bitcoin', symbol: 'WBTC', name: 'Wrapped Bitcoin', rank: 15 }
  ];
  assert.equal(rankCoinMatches(rows, 'btc')[0].id, 'bitcoin');
  const merged = mergeSearchResults(rows, [rows[0], { id: 'test-btc', symbol: 'BTC', name: 'Test BTC' }], 'btc');
  assert.equal(merged.filter((row) => row.id === 'bitcoin').length, 1);
  assert.ok(merged.some((row) => row.id === 'test-btc'));
});

test('the API resolves an EVM contract through the cached id index and returns a real quote', async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    if (String(url).includes('/coins/list')) {
      return { ok: true, json: async () => ([{ id: 'test-token', platforms: { ethereum: '0x1111111111111111111111111111111111111111' } }]) };
    }
    if (String(url).includes('/coins/markets')) {
      return { ok: true, json: async () => ([{ id: 'test-token', symbol: 'tst', name: 'Test Token', current_price: 2.5, price_change_percentage_24h_in_currency: 1.2 }]) };
    }
    throw new Error(`Unexpected URL ${url}`);
  };
  try {
    const { fetchSearch } = await import('../server/providers.js');
    const { _resetIndex } = await import('../server/coinIndex.js');
    _resetIndex();
    const rows = await fetchSearch('0x1111111111111111111111111111111111111111', { retry: false });
    assert.equal(rows[0].id, 'test-token');
    assert.equal(rows[0].price, 2.5);
    assert.ok(calls.some((url) => url.includes('/coins/list')));
    assert.ok(calls.some((url) => url.includes('/coins/markets')));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('the API resolves a Solana mint by contract and never invents a missing price', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    assert.ok(String(url).includes('/coins/solana/contract/'));
    return { ok: true, json: async () => ({ id: 'solana-mint', symbol: 'mnt', name: 'Mint', market_data: {} }) };
  };
  try {
    const { fetchSearch } = await import('../server/providers.js');
    const rows = await fetchSearch('So11111111111111111111111111111111111111112', { retry: false });
    assert.equal(rows[0].id, 'solana-mint');
    assert.equal(rows[0].price, null);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
