#!/usr/bin/env node
/**
 * Regression probe for the production market-data outage:
 * CoinGecko /coins/markets returned HTTP 403 while the app had no independent
 * live fallback, so every browser eventually rendered the synthetic snapshot.
 * The server must now fail over to real CoinLore tickers without relabeling
 * USD values, inventing unavailable fields, or leaking provider credentials.
 *
 * ─── CONTRACT UNDER TEST (since the visual-enrichment fix) ──────────────────
 * CoinLore tickers carry no artwork and no history, which is how the market
 * screen lost its logos and sparklines. The fallback rows may now carry
 * visuals restored from CoinGecko's UNTHROTTLED endpoints (`/market_chart`,
 * `/search`) or remembered from the last healthy CoinGecko read — labelled
 * `sparklineSource` / `imageSource`. What is still forbidden:
 *
 *   • numbers invented from the visuals layer — `high24h`, `ath`, `supply`
 *     stay exactly what the ticker said, including null;
 *   • a sparkline synthesized from percent changes — a line is either real
 *     CoinGecko history or absent (`[]`);
 *   • logos matched by symbol instead of exact coin id;
 *   • retries on a hard 403 block (429/5xx are retried; 403 fails over fast).
 */
import assert from 'node:assert/strict';

/* Keep the probe deterministic even when a developer runs it in a production
   shell with CoinGecko settings exported. This child process is isolated. */
delete process.env.COINGECKO_API_KEY;
delete process.env.COINGECKO_PLAN;
delete process.env.COINGECKO_BASE;
const { fetchCoinDetail, fetchMarkets } = await import('../server/providers.js');
const { clearVisualMemory } = await import('../src/lib/marketVisuals.js');

const jsonResponse = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), {
  status,
  headers: { 'content-type': 'application/json', ...headers }
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

/* Which calls are PRICE attempts (provider failover budget) versus VISUAL
   enrichment attempts (logos/sparklines, never fail the response). */
const isVisualFetch = (url) =>
  url.pathname.endsWith('/market_chart') || url.pathname === '/api/v3/search';
const isPriceFetch = (url) => !isVisualFetch(url);

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
    return jsonResponse({ data: coinLoreRows, info: { coins_num: 14993, time: 1790669282 } });
  }, () => fetchMarkets({ page: 1, perPage: 250, vs: 'usd' }));

  assert.equal(calls.filter(isPriceFetch).length, 2,
    'the backup is requested once after the primary fails (403 is not retried)');
  assert.equal(calls[1].pathname, '/api/tickers/');
  assert.equal(calls[1].searchParams.get('start'), '0');
  assert.equal(calls[1].searchParams.get('limit'), '100', 'CoinLore page size is capped at 100');
  assert.equal(rows.length, 3, 'rows with missing or invalid prices are discarded');

  /* Visual enrichment is attempted but the mocked CoinGecko visuals endpoints
     are dead too — the rows must stay exactly as honest as the ticker. */
  const visualCalls = calls.filter(isVisualFetch);
  assert.ok(visualCalls.length <= 12, 'visual hydration is budgeted, never a fan-out');
  assert.ok(visualCalls.every((url) => url.hostname === 'api.coingecko.com'),
    'visuals are only ever fetched from CoinGecko');

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

  assert.equal(calls.filter((url) => url.hostname === 'api.coingecko.com' && isPriceFetch(url)).length, 2,
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

/* ── retry policy: 429/5xx transient, 403 hard ──────────────────────────── */

await check('a transient 429 is retried and CoinGecko still wins the row', async () => {
  clearVisualMemory();
  const calls = [];
  const rows = await withFetch(async (input) => {
    const url = new URL(String(input));
    calls.push(url);
    assert.equal(url.hostname, 'api.coingecko.com', 'the backup must not be consulted after a 429');
    if (calls.length === 1) return new Response('rate limited', { status: 429, headers: { 'retry-after': '0.01' } });
    return jsonResponse([{
      id: 'bitcoin', symbol: 'btc', name: 'Bitcoin', current_price: 84100,
      price_change_percentage_24h: 1.1, market_cap: 1.6e12, total_volume: 2.8e10
    }]);
  }, () => fetchMarkets({ page: 1, perPage: 50, vs: 'usd' }));

  assert.equal(calls.length, 2, 'exactly one retry after a 429');
  assert.equal(rows[0].marketProvider, 'coingecko');
  assert.equal(rows[0].price, 84100);
});

await check('the retry budget is bounded, then the live backup serves', async () => {
  clearVisualMemory();
  const calls = [];
  const rows = await withFetch(async (input) => {
    const url = new URL(String(input));
    calls.push(url);
    if (url.hostname === 'api.coingecko.com') {
      return new Response('rate limited', { status: 429, headers: { 'retry-after': '0.01' } });
    }
    return jsonResponse({ data: coinLoreRows.slice(0, 1) });
  }, () => fetchMarkets({ page: 1, perPage: 50, vs: 'usd' }));

  assert.equal(calls.filter(isPriceFetch).length, 4,
    '3 bounded CoinGecko attempts (initial + 2 retries), then one CoinLore read');
  assert.equal(rows[0].marketProvider, 'coinlore');
  assert.equal(rows[0].price, 84046.86);
});

/* ── visual enrichment: real CoinGecko lines and logos on fallback rows ──── */

await check('fallback rows are hydrated with real CoinGecko charts and logos', async () => {
  clearVisualMemory();
  const chartPrices = Array.from({ length: 48 }, (_, i) => [1790600000000 + i * 3600000, 83000 + i]);
  const rows = await withFetch(async (input) => {
    const url = new URL(String(input));
    if (url.hostname === 'api.coinlore.net') {
      return jsonResponse({ data: coinLoreRows.slice(0, 1) });
    }
    if (url.pathname.endsWith('/market_chart')) {
      assert.equal(url.pathname, '/api/v3/coins/bitcoin/market_chart');
      assert.equal(url.searchParams.get('days'), '7');
      return jsonResponse({ prices: chartPrices });
    }
    if (url.pathname === '/api/v3/search') {
      /* The impostor must never win: `/search?query=BTC` returns clones. */
      return jsonResponse({ coins: [
        { id: 'bitcoin-cash', symbol: 'BCH', name: 'Bitcoin Cash', thumb: 'https://coin-images.coingecko.com/coins/images/780/thumb/bitcoin-cash-circle.png' },
        { id: 'bitcoin', symbol: 'BTC', name: 'Bitcoin', thumb: 'https://coin-images.coingecko.com/coins/images/1/thumb/bitcoin.png' }
      ] });
    }
    return new Response('forbidden', { status: 403 });
  }, () => fetchMarkets({ page: 1, perPage: 50, vs: 'usd' }));

  const bitcoin = rows.find((row) => row.id === 'bitcoin');
  assert.equal(bitcoin.marketProvider, 'coinlore', 'prices still come from the live backup');
  assert.equal(bitcoin.price, 84046.86);
  assert.equal(bitcoin.high24h, null, 'numbers are never back-filled from the visuals layer');
  assert.deepEqual(bitcoin.sparkline, chartPrices.map(([, p]) => p),
    'the line is real market_chart history, not a synthesized shape');
  assert.equal(bitcoin.sparklineSource, 'coingecko-chart');
  assert.equal(bitcoin.image, 'https://coin-images.coingecko.com/coins/images/1/thumb/bitcoin.png',
    'logos attach only on an EXACT CoinGecko id match');
  assert.equal(bitcoin.imageSource, 'coingecko-search');
});

await check('visuals remembered from a healthy read survive the throttle window', async () => {
  clearVisualMemory();
  const goodRow = {
    id: 'bitcoin', symbol: 'BTC', name: 'Bitcoin', price: 84200, change24h: 1,
    image: 'https://coin-images.coingecko.com/coins/images/1/large/bitcoin.png',
    sparkline: [1, 2, 3, 4]
  };

  /* Read 1: healthy CoinGecko — the visuals are remembered. */
  await withFetch(async (input) => {
    const url = new URL(String(input));
    if (url.pathname === '/api/v3/coins/markets') return jsonResponse([{
      id: 'bitcoin', symbol: 'btc', name: 'Bitcoin', current_price: 84200,
      price_change_percentage_24h: 1, image: goodRow.image, sparkline_in_7d: { price: goodRow.sparkline }
    }]);
    throw new Error(`unexpected ${url}`);
  }, () => fetchMarkets({ page: 1, perPage: 50, vs: 'usd' }));

  /* Read 2: CoinGecko throttled AND its visual endpoints dead. The row must
     still carry the remembered artwork and line beside the fresh quote. */
  const rows = await withFetch(async (input) => {
    const url = new URL(String(input));
    if (url.hostname === 'api.coingecko.com') return new Response('forbidden', { status: 403 });
    return jsonResponse({ data: [{ ...coinLoreRows[0], price_usd: '85000.00' }] });
  }, () => fetchMarkets({ page: 1, perPage: 50, vs: 'usd' }));

  const bitcoin = rows[0];
  assert.equal(bitcoin.price, 85000, 'the fresh live quote wins');
  assert.equal(bitcoin.marketProvider, 'coinlore');
  assert.equal(bitcoin.image, goodRow.image);
  assert.equal(bitcoin.imageSource, 'coingecko-markets');
  assert.deepEqual(bitcoin.sparkline, goodRow.sparkline);
  assert.equal(bitcoin.sparklineSource, 'coingecko');
});

await check('coin detail fallback is enriched the same way as the list', async () => {
  clearVisualMemory();
  const coin = await withFetch(async (input) => {
    const url = new URL(String(input));
    if (url.hostname === 'api.coinlore.net') return jsonResponse({ data: coinLoreRows.slice(0, 1) });
    if (url.pathname.endsWith('/market_chart')) {
      return jsonResponse({ prices: [[0, 1], [1, 2], [2, 3]] });
    }
    if (url.pathname === '/api/v3/search') {
      return jsonResponse({ coins: [{ id: 'bitcoin', thumb: 'https://coin-images.coingecko.com/coins/images/1/thumb/bitcoin.png' }] });
    }
    return new Response('forbidden', { status: 403 });
  }, () => fetchCoinDetail('bitcoin'));

  assert.equal(coin.marketProvider, 'coinlore');
  assert.equal(coin.price, 84046.86);
  assert.deepEqual(coin.sparkline, [1, 2, 3]);
  assert.equal(coin.sparklineSource, 'coingecko-chart');
  assert.ok(coin.image.includes('/coins/images/1/'));
  assert.equal(coin.high24h, null);
});

console.log(`  ${checks} market provider checks passed`);
