#!/usr/bin/env node
/**
 * Regression probe for the production market-data outage:
 * CoinGecko /coins/markets returned HTTP 403 while the app had no independent
 * live fallback, so every browser eventually rendered the synthetic snapshot.
 * The server must now fail over to real CoinLore tickers without relabeling
 * USD values, inventing unavailable fields, or leaking provider credentials.
 */
import assert from 'node:assert/strict';

/* Keep the probe deterministic even when a developer runs it in a production
   shell with CoinGecko settings exported. This child process is isolated. */
delete process.env.COINGECKO_API_KEY;
delete process.env.COINGECKO_PLAN;
delete process.env.COINGECKO_BASE;
const { fetchCoinDetail, fetchMarkets } = await import('../server/providers.js');

const jsonResponse = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'content-type': 'application/json' }
});

const coinLoreRows = [
  {
    id: '90', symbol: 'BTC', name: 'Bitcoin', nameid: 'bitcoin', rank: 1,
    price_usd: '84046.86', percent_change_1h: '0.11', percent_change_24h: '1.20',
    percent_change_7d: '-3.02', market_cap_usd: '1678487381102.80', volume24: 28566500501.4,
    csupply: '19970852.00'
  },
  {
    id: '2710', symbol: 'BNB', name: 'Binance Coin', nameid: 'binance-coin', rank: 4,
    price_usd: '765.80', percent_change_1h: '-0.09', percent_change_24h: '0.47',
    percent_change_7d: '-4.28', market_cap_usd: '106589120448.19', volume24: 707771788.38,
    csupply: '139186427.32'
  },
  {
    id: '900001', symbol: 'NEW', name: 'New Asset', rank: 99,
    price_usd: '0.25', percent_change_24h: '2.5', volume24: 1000
  },
  {
    id: 'bad', symbol: 'BAD', name: 'Bad Price', nameid: 'bad-price',
    price_usd: 'N/A', rank: 100
  }
];

async function withFetch(mock, run) {
  const original = globalThis.fetch;
  globalThis.fetch = mock;
  try {
    return await run();
  } finally {
    globalThis.fetch = original;
  }
}

let checks = 0;
const check = (name, fn) => Promise.resolve().then(fn).then(() => {
  checks += 1;
  console.log(`  ✓ ${name}`);
});

console.log('▸ probing market-data provider failover…');

await check('CoinGecko remains primary when its live response is healthy', async () => {
  const calls = [];
  const rows = await withFetch(async (input) => {
    const url = new URL(String(input));
    calls.push(url);
    assert.equal(url.hostname, 'api.coingecko.com');
    return jsonResponse([{
      id: 'bitcoin', symbol: 'btc', name: 'Bitcoin', current_price: 84000,
      price_change_percentage_24h: 1.2, market_cap: 1.6e12, total_volume: 2.8e10
    }]);
  }, () => fetchMarkets({ page: 1, perPage: 50, vs: 'usd' }));

  assert.equal(calls.length, 1, 'a healthy primary must not call the backup');
  assert.equal(rows[0].id, 'bitcoin');
  assert.equal(rows[0].marketProvider, 'coingecko');
  assert.equal(rows[0].price, 84000);
});

await check('CoinGecko 403 falls back to real CoinLore prices with truthful missing fields', async () => {
  const calls = [];
  const rows = await withFetch(async (input) => {
    const url = new URL(String(input));
    calls.push(url);
    if (url.hostname === 'api.coingecko.com') return new Response('forbidden', { status: 403 });
    assert.equal(url.hostname, 'api.coinlore.net');
    return jsonResponse({ data: coinLoreRows, info: { coins_num: 14993, time: 1790669282 } });
  }, () => fetchMarkets({ page: 1, perPage: 250, vs: 'usd' }));

  assert.equal(calls.length, 2, 'the backup is requested once after the primary fails');
  assert.equal(calls[1].pathname, '/api/tickers/');
  assert.equal(calls[1].searchParams.get('start'), '0');
  assert.equal(calls[1].searchParams.get('limit'), '100', 'CoinLore page size is capped at 100');
  assert.equal(rows.length, 3, 'rows with missing or invalid prices are discarded');

  const bitcoin = rows.find((row) => row.symbol === 'BTC');
  assert.equal(bitcoin.id, 'bitcoin');
  assert.equal(bitcoin.price, 84046.86);
  assert.equal(bitcoin.change24h, 1.2);
  assert.equal(bitcoin.marketProvider, 'coinlore');
  assert.equal(bitcoin.coinLoreId, '90');
  assert.equal(bitcoin.high24h, null, 'unprovided highs are not fabricated as zero');
  assert.deepEqual(bitcoin.sparkline, [], 'a live ticker is not a historical price series');

  const bnb = rows.find((row) => row.symbol === 'BNB');
  assert.equal(bnb.id, 'binancecoin', 'CoinLore nameid aliases to the known CoinGecko id');
  assert.equal(bnb.price, 765.8);

  const uncurated = rows.find((row) => row.symbol === 'NEW');
  assert.equal(uncurated.id, 'coinlore-900001', 'unknown numeric provider IDs stay namespaced');
  assert.equal(uncurated.change1h, null);
});

await check('CoinLore fallback pagination preserves requested page offsets', async () => {
  const calls = [];
  await withFetch(async (input) => {
    const url = new URL(String(input));
    calls.push(url);
    if (url.hostname === 'api.coingecko.com') return new Response('forbidden', { status: 403 });
    return jsonResponse({ data: coinLoreRows.slice(0, 1) });
  }, () => fetchMarkets({ page: 2, perPage: 250, vs: 'usd' }));

  assert.equal(calls[1].searchParams.get('start'), '250');
  assert.equal(calls[1].searchParams.get('limit'), '100');
});

await check('coin detail also fails over to the live backup, not the offline seed', async () => {
  const calls = [];
  const coin = await withFetch(async (input) => {
    const url = new URL(String(input));
    calls.push(url);
    if (url.hostname === 'api.coingecko.com') return new Response('forbidden', { status: 403 });
    return jsonResponse({ data: coinLoreRows });
  }, () => fetchCoinDetail('bitcoin'));

  assert.equal(calls.filter((url) => url.hostname === 'api.coingecko.com').length, 2,
    'CoinGecko markets and detail endpoints are both attempted before failover');
  assert.equal(coin.id, 'bitcoin');
  assert.equal(coin.price, 84046.86);
  assert.equal(coin.marketProvider, 'coinlore');
  assert.equal(coin.high24h, null);
  assert.deepEqual(coin.sparkline, []);
});

await check('USD-only backup is never mislabeled for a different display currency', async () => {
  const calls = [];
  await withFetch(async (input) => {
    const url = new URL(String(input));
    calls.push(url);
    return new Response('forbidden', { status: 403 });
  }, async () => {
    await assert.rejects(fetchMarkets({ vs: 'eur' }), /Upstream 403/);
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].hostname, 'api.coingecko.com');
});

await check('no usable live provider fails closed with a safe diagnostic', async () => {
  await withFetch(async (input) => {
    const url = new URL(String(input));
    if (url.hostname === 'api.coingecko.com') return new Response('forbidden', { status: 403 });
    return jsonResponse({ error: 'temporarily unavailable' });
  }, async () => {
    await assert.rejects(
      fetchMarkets({ vs: 'usd' }),
      (error) => error.message === 'MARKET_DATA_UNAVAILABLE: CoinGecko and CoinLore returned no usable market data'
        && !error.message.includes('https://')
    );
  });
});

console.log(`  ${checks}/6 market provider checks passed`);
