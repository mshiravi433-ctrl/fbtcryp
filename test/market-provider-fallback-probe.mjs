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
const { clearVisualMemory, rememberVisuals } = await import('../src/lib/marketVisuals.js');
const { clearVenueMemory } = await import('../src/lib/venueSparklines.js');
const { clearLogoIndex } = await import('../src/lib/coinLogoIndex.js');

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
   enrichment attempts (logos/sparklines/venue lines — never fail the
   response, never a reason to consult another PRICE provider).

   The enrichment sources are named on purpose. The visuals may only ever come
   from a market-data provider that really has them, and each one lands on the
   row with its own `sparklineSource` / `imageSource` label:
     CoinGecko   — per-coin charts and exact-id logos
     CryptoCompare — the bulk coin list, used ONLY for artwork, name-verified
     Binance     — that venue's own klines for its own USDT pairs */
const VISUAL_HOSTS = new Set([
  'min-api.cryptocompare.com',
  'data-api.binance.vision',
  'api-gcp.binance.com',
  'api.binance.com'
]);
const isVisualFetch = (url) =>
  VISUAL_HOSTS.has(url.hostname) ||
  url.pathname.endsWith('/market_chart') ||
  url.pathname === '/api/v3/search' ||
  url.pathname === '/api/v3/exchangeInfo';
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
  /* Two hydratable rows in this fixture: a chart and a logo lookup each. The
     bulk sources (coin list, venue pair map) are one call apiece and were
     mocked as forbidden here, so the whole visual pass stays tiny. */
  assert.ok(visualCalls.length <= 12, 'visual hydration is budgeted, never a fan-out');
  assert.ok(visualCalls.every((url) => url.hostname === 'api.coingecko.com' || VISUAL_HOSTS.has(url.hostname)),
    'visuals come only from named market-data sources');

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

/* ── the two bulk sources: a whole page's artwork and a whole week's line ── */

await check('a venue covers the page in one pass — real klines, exact ticker only', async () => {
  clearVisualMemory();
  clearVenueMemory();
  clearLogoIndex();
  const calls = [];
  const rows = await withFetch(async (input) => {
    const url = new URL(String(input));
    calls.push(url);
    if (url.hostname === 'api.coingecko.com') return new Response('forbidden', { status: 403 });
    if (url.hostname === 'api.coinlore.net') {
      return jsonResponse({ data: [coinLoreRows[0], coinLoreRows[1], coinLoreRows[2]] });
    }
    if (url.hostname === 'min-api.cryptocompare.com') return new Response('nope', { status: 503 });
    if (url.pathname === '/api/v3/exchangeInfo') {
      return jsonResponse({ symbols: [
        { symbol: 'BTCUSDT', baseAsset: 'BTC', quoteAsset: 'USDT', status: 'TRADING' },
        { symbol: 'BNBUSDT', baseAsset: 'BNB', quoteAsset: 'USDT', status: 'TRADING' },
        /* Not trading: a delisted market must not supply a line. */
        { symbol: 'ETHUSDT', baseAsset: 'ETH', quoteAsset: 'USDT', status: 'BREAK' },
        /* Right base, wrong quote: not a USD series. */
        { symbol: 'BTCTRY', baseAsset: 'BTC', quoteAsset: 'TRY', status: 'TRADING' }
      ] });
    }
    if (url.pathname === '/api/v3/klines') {
      assert.equal(url.searchParams.get('interval'), '1h', 'hourly closes, like the sparkline it replaces');
      assert.equal(url.searchParams.get('limit'), '168', 'exactly 7 days of points');
      return jsonResponse(Array.from({ length: 168 }, (_, i) => [0, '1', '1', '1', String(100 + i)]));
    }
    return new Response('forbidden', { status: 403 });
  }, () => fetchMarkets({ page: 1, perPage: 50, vs: 'usd' }));

  const klines = calls.filter((url) => url.pathname === '/api/v3/klines');
  assert.equal(klines.length, 2, 'one kline call per traded pair — and none for the BREAK pair');

  const bitcoin = rows.find((row) => row.symbol === 'BTC');
  assert.equal(bitcoin.sparkline.length, 168);
  assert.equal(bitcoin.sparkline[167], 267, 'the series is the venue closes, oldest first');
  assert.equal(bitcoin.sparklineSource, 'binance-klines', 'and the row says where the line came from');
  assert.equal(bitcoin.price, 84046.86, 'the venue line never touches the live price');
  assert.equal(bitcoin.high24h, null);

  const unlisted = rows.find((row) => row.symbol === 'NEW');
  assert.deepEqual(unlisted.sparkline, [], 'a ticker no venue trades gets no borrowed line');
});

await check('one coin-list request puts real artwork on rows — ticker AND name must agree', async () => {
  clearVisualMemory();
  clearVenueMemory();
  clearLogoIndex();
  const calls = [];
  const rows = await withFetch(async (input) => {
    const url = new URL(String(input));
    calls.push(url);
    if (url.hostname === 'api.coingecko.com') return new Response('forbidden', { status: 403 });
    if (url.hostname === 'api.coinlore.net') {
      return jsonResponse({ data: [coinLoreRows[0], coinLoreRows[1], coinLoreRows[2]] });
    }
    if (url.hostname === 'min-api.cryptocompare.com') {
      return jsonResponse({ Response: 'Success', Data: {
        BTC: { Symbol: 'BTC', Name: 'Bitcoin', CoinName: 'Bitcoin', ImageUrl: '/media/37746251/btc.png' },
        BNB: { Symbol: 'BNB', Name: 'BNB', CoinName: 'Binance Coin', ImageUrl: '/media/1383652/bnb.png' },
        /* Same ticker as our "NEW" row, different project: must be refused. */
        NEW: { Symbol: 'NEW', Name: 'Something Else', ImageUrl: '/media/999/new.png' }
      } });
    }
    if (url.pathname === '/api/v3/exchangeInfo') return jsonResponse({ symbols: [] });
    return new Response('forbidden', { status: 403 });
  }, () => fetchMarkets({ page: 1, perPage: 50, vs: 'usd' }));

  assert.equal(calls.filter((url) => url.hostname === 'min-api.cryptocompare.com').length, 1,
    'one request answers the artwork question for every row');

  const bitcoin = rows.find((row) => row.symbol === 'BTC');
  assert.equal(bitcoin.image, 'https://www.cryptocompare.com/media/37746251/btc.png');
  assert.equal(bitcoin.imageSource, 'cryptocompare-list');
  assert.equal(bitcoin.price, 84046.86);

  const bnb = rows.find((row) => row.symbol === 'BNB');
  assert.equal(bnb.image, 'https://www.cryptocompare.com/media/1383652/bnb.png',
    'a longer list name still matches the row name');

  const lookalike = rows.find((row) => row.symbol === 'NEW');
  assert.equal(lookalike.image, null, 'a ticker match with a different name is not a logo');
});

await check('a 250-row fallback page is paged in full, not truncated at 100', async () => {
  clearVisualMemory();
  clearVenueMemory();
  clearLogoIndex();
  const calls = [];
  const tickerPage = (start, limit) => ({
    data: Array.from({ length: limit }, (_, i) => ({
      id: String(start + i + 1),
      symbol: `T${start + i}`,
      name: `Token ${start + i}`,
      nameid: `token-${start + i}`,
      rank: start + i + 1,
      price_usd: String(1 + (start + i) / 1000),
      percent_change_24h: '0'
    }))
  });

  const rows = await withFetch(async (input) => {
    const url = new URL(String(input));
    calls.push(url);
    if (url.hostname === 'api.coingecko.com') return new Response('forbidden', { status: 403 });
    if (url.hostname === 'api.coinlore.net') {
      return jsonResponse(tickerPage(
        Number(url.searchParams.get('start')) || 0,
        Number(url.searchParams.get('limit')) || 100
      ));
    }
    if (url.pathname === '/api/v3/exchangeInfo') return jsonResponse({ symbols: [] });
    return new Response('nope', { status: 503 });
  }, () => fetchMarkets({ page: 1, perPage: 250, vs: 'usd' }));

  const tickers = calls.filter((url) => url.hostname === 'api.coinlore.net');
  assert.deepEqual(tickers.map((url) => url.searchParams.get('start')), ['0', '100', '200'],
    'the page is filled with ordered CoinLore requests');
  assert.deepEqual(tickers.map((url) => url.searchParams.get('limit')), ['100', '100', '50'],
    'and the last request asks only for what is still missing');
  assert.equal(rows.length, 250, 'and the market screen gets the number of rows it asked for');
  assert.equal(rows[249].rank, 250);
});

await check('a fallback page never DROPS visuals it already had', async () => {
  clearVisualMemory();
  clearVenueMemory();
  clearLogoIndex();
  const image = 'https://coin-images.coingecko.com/coins/images/1/large/bitcoin.png';
  rememberVisuals([{ id: 'bitcoin', symbol: 'BTC', name: 'Bitcoin', image, sparkline: [1, 2, 3] }]);

  const rows = await withFetch(async (input) => {
    const url = new URL(String(input));
    if (url.hostname === 'api.coingecko.com') return new Response('forbidden', { status: 403 });
    if (url.hostname === 'api.coinlore.net') return jsonResponse({ data: [coinLoreRows[0]] });
    if (url.pathname === '/api/v3/exchangeInfo') return jsonResponse({ symbols: [] });
    return new Response('nope', { status: 503 });
  }, () => fetchMarkets({ page: 1, perPage: 50, vs: 'usd' }));

  assert.equal(rows[0].price, 84046.86, 'the fresh live quote is what is shown');
  assert.equal(rows[0].image, image, 'and the artwork from memory is still on the row');
  assert.deepEqual(rows[0].sparkline, [1, 2, 3], 'as is the line — an empty pass must not erase it');
});

console.log(`  ${checks} market provider checks passed`);
