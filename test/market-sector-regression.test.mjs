import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fetchCategory } from '../server/providers.js';
import { MARKET_CATEGORIES, sectorFromRows } from '../src/lib/marketSectors.js';

const samples = [
  ['pax-gold', 'PAXG', 'PAX Gold'],
  ['ondo-finance', 'ONDO', 'Ondo'],
  ['bittensor', 'TAO', 'Bittensor'],
  ['immutable-x', 'IMX', 'Immutable'],
  ['solana', 'SOL', 'Solana'],
  ['bitcoin', 'BTC', 'Bitcoin']
].map(([nameid, symbol, name], i) => ({
  id: String(i + 1), nameid, symbol, name, price_usd: String(10 + i),
  rank: i + 1, volume24: '1200', percent_change_24h: '1.5'
}));

const response = (data, status = 200) => new Response(JSON.stringify(data), { status });

test('a CoinGecko category outage returns real CoinLore USD sector quotes, not invented extrema', async () => {
  const original = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (input) => {
    const url = String(input);
    calls.push(url);
    if (url.includes('api.coingecko.com')) return response({ error: 'blocked' }, 403);
    if (url.includes('api.coinlore.net/api/tickers/')) return response({ data: samples });
    // Visuals are optional, and a failed logo/venue/chart provider cannot
    // prevent the backed-up price from reaching the sector page.
    return response({ error: 'unavailable' }, 503);
  };
  try {
    for (const [sector, expected] of [
      ['gold', 'pax-gold'], ['rwa', 'ondo-finance'], ['ai', 'bittensor'],
      ['gaming', 'immutable-x'], ['solana', 'solana']
    ]) {
      const rows = await fetchCategory(MARKET_CATEGORIES[sector]);
      assert.ok(rows.some((row) => row.id === expected), `${sector}: expected ${expected}`);
      assert.ok(rows.every((row) => row.marketProvider === 'coinlore'));
      assert.ok(rows.every((row) => row.high24h == null && row.low24h == null));
      assert.ok(rows.every((row) => row.price > 0));
    }
    assert.equal(calls.filter((url) => url.includes('api.coinlore.net/api/tickers/')).length, 1,
      'sector tabs share a single in-flight/cached ticker read');
    assert.deepEqual(sectorFromRows('gold', [{ id: 'bitcoin', symbol: 'PAXG' }]), [],
      'a copied symbol must never impersonate a sector member');
    await assert.rejects(fetchCategory(MARKET_CATEGORIES.gold, { vs: 'eur' }));
    await assert.rejects(fetchCategory('not-a-sector'));
  } finally {
    globalThis.fetch = original;
  }
});

test('market swap deep links select only curated mints, and SOL opens a real pair', async () => {
  await build({
    entryPoints: ['src/lib/coinToSwap.js'], bundle: true, platform: 'node',
    format: 'esm', outfile: 'test/.out/market-swap.mjs', logLevel: 'silent',
    loader: { '.jsx': 'jsx' }
  });
  const { swapTargetFor, swapUrlFor } = await import('./.out/market-swap.mjs');
  assert.match(swapUrlFor('solana'), /^\/solana\?to=So111/);
  assert.match(swapUrlFor('solana', 'sell'), /side=sell/);
  assert.equal(swapTargetFor('solana')?.kind, 'solana');
  assert.match(swapUrlFor('apple-xstock') || '', /^\/solana\?to=Xs/);
  assert.match(swapUrlFor('jito-staked-sol') || '', /^\/solana\?to=J1toso/);
  assert.equal(swapUrlFor('cardano'), null);
  assert.equal(swapUrlFor('fake-apple-xstock'), null);
});
