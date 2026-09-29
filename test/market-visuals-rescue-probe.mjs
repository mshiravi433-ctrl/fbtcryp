#!/usr/bin/env node
/**
 * Regression probe for the CLIENT side of the market-visuals outage:
 *   «در صفحه بازار فقط ۶ توکن اول قیمت و لوگو و نمودار دارن، بقیه فقط قیمت»
 *
 * When CoinGecko's bulk endpoint is blocked from the server's datacenter IP,
 * our backend answers with live CoinLore tickers — honest prices, no artwork,
 * no history — and its own per-coin visual hydration is rate limited, so it
 * reaches the top of the list first. That is what left rows 7…250 bare.
 *
 * The client now asks CoinGecko directly, from the user's own connection,
 * and merges what it gets into the rows the backend sent. The contract:
 *
 *   • ONE bulk request covers the whole page — not one per row;
 *   • GAP-FILL ONLY: price, changes, market cap, rank and every other number
 *     stay exactly what the live backend said;
 *   • the merge is by CoinGecko id, so a lookalike ticker cannot land here;
 *   • nothing is requested when the rows already have their visuals;
 *   • a failure is quiet, keeps the honest rows on screen, and does not repeat
 *     on every poll (a cooldown), because a blocked user pays for it;
 *   • the rescue never blocks a row's price — it is a bonus on top.
 */
import assert from 'node:assert/strict';

const { getMarkets, clearApiCache } = await import('../src/lib/api.js');
const { clearVisualMemory } = await import('../src/lib/marketVisuals.js');

const jsonResponse = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'content-type': 'application/json' }
});

async function withFetch(mock, run) {
  const original = globalThis.fetch;
  globalThis.fetch = mock;
  try {
    return await run();
  } finally {
    globalThis.fetch = original;
  }
}

/* The backend answer: live tickers, prices only (a CoinLore-shaped page). */
const backendRows = (count = 8) => Array.from({ length: count }, (_, i) => ({
  id: ['bitcoin', 'ethereum', 'tether', 'binancecoin', 'solana', 'ripple', 'usd-coin', 'cardano'][i] || `coin-${i}`,
  symbol: ['BTC', 'ETH', 'USDT', 'BNB', 'SOL', 'XRP', 'USDC', 'ADA'][i] || `C${i}`,
  name: `Coin ${i}`,
  image: null,
  price: 1000 + i,
  change1h: 0.1,
  change24h: 1.5,
  change7d: -2,
  mcap: 1e9,
  volume: 1e8,
  rank: i + 1,
  high24h: null,
  low24h: null,
  ath: null,
  athChange: null,
  supply: 1e6,
  sparkline: [],
  marketProvider: 'coinlore'
}));

/* What CoinGecko would answer for those ids if this connection can reach it. */
const coingeckoRows = (rows) => rows.map((row, i) => ({
  id: row.id,
  symbol: row.symbol.toLowerCase(),
  name: row.name,
  image: `https://coin-images.coingecko.com/coins/images/${i + 1}/large/${row.id}.png`,
  current_price: 999,
  price_change_percentage_1h_in_currency: 9.9,
  price_change_percentage_24h_in_currency: 9.9,
  price_change_percentage_7d_in_currency: 9.9,
  market_cap: 42,
  total_volume: 42,
  market_cap_rank: 999,
  sparkline_in_7d: { price: Array.from({ length: 60 }, (_, k) => 100 + k) }
}));

const urlOf = (input) => new URL(String(input), 'https://fbt.local');
const isBulk = (url) => url.pathname === '/api/v3/coins/markets' && url.hostname === 'api.coingecko.com';

let checks = 0;
const check = (name, fn) => Promise.resolve().then(fn).then(() => {
  checks += 1;
  console.log(`  ✓ ${name}`);
});

console.log('▸ probing client bulk visual rescue…');

await check('one bulk request gives every row its logo and its 7-day line', async () => {
  clearApiCache();
  clearVisualMemory();
  const rows = backendRows();
  const calls = [];

  const out = await withFetch(async (input) => {
    const url = urlOf(input);
    calls.push(url);
    if (url.hostname === 'api.coingecko.com') return jsonResponse(coingeckoRows(rows));
    return jsonResponse(rows);
  }, () => getMarkets({ perPage: 250, vs: 'usd' }));

  assert.equal(out.length, rows.length);
  assert.equal(calls.filter(isBulk).length, 1, 'one bulk read covers the whole page');
  assert.ok(out.every((row) => /^https:\/\/coin-images\.coingecko\.com\//.test(row.image ?? '')),
    'every row now carries real artwork');
  assert.ok(out.every((row) => Array.isArray(row.sparkline) && row.sparkline.length > 2),
    'and every row carries a real 7-day line');
  assert.equal(out[0].imageSource, 'coingecko-markets');
  assert.equal(out[0].sparklineSource, 'coingecko');
});

await check('the merge is gap-fill only — no live number is replaced', async () => {
  clearApiCache();
  clearVisualMemory();
  const rows = backendRows();
  const out = await withFetch(async (input) => {
    const url = urlOf(input);
    if (url.hostname === 'api.coingecko.com') return jsonResponse(coingeckoRows(rows));
    return jsonResponse(rows);
  }, () => getMarkets({ perPage: 250, vs: 'usd' }));

  const first = out[0];
  assert.equal(first.price, 1000, 'the live price survives the rescue');
  assert.equal(first.change24h, 1.5, 'and the live change');
  assert.equal(first.mcap, 1e9);
  assert.equal(first.rank, 1);
  assert.equal(first.marketProvider, 'coinlore', 'the row is still the provider it came from');
  assert.equal(first.dataProvenance, 'live');
  assert.equal(first.high24h, null, 'a missing number is never back-filled');
});

await check('a row that already has its own visuals keeps them', async () => {
  clearApiCache();
  clearVisualMemory();
  const rows = backendRows();
  rows[0] = { ...rows[0], image: 'https://example.test/own.png', sparkline: [7, 7, 7] };

  const out = await withFetch(async (input) => {
    const url = urlOf(input);
    if (url.hostname === 'api.coingecko.com') return jsonResponse(coingeckoRows(rows));
    return jsonResponse(rows);
  }, () => getMarkets({ perPage: 250, vs: 'usd' }));

  assert.equal(out[0].image, 'https://example.test/own.png');
  assert.deepEqual(out[0].sparkline, [7, 7, 7], 'a row\'s own history always wins');
  assert.equal(out[0].imageSource, undefined);
});

await check('complete rows ask for nothing at all', async () => {
  clearApiCache();
  clearVisualMemory();
  const rows = backendRows().map((row, i) => ({
    ...row,
    image: `https://coin-images.coingecko.com/coins/images/${i + 1}/large/${row.id}.png`,
    sparkline: [1, 2, 3]
  }));
  const calls = [];

  await withFetch(async (input) => {
    calls.push(urlOf(input));
    return jsonResponse(rows);
  }, () => getMarkets({ perPage: 250, vs: 'usd' }));

  assert.equal(calls.length, 1, 'only the backend was called');
  assert.equal(calls.filter(isBulk).length, 0);
});

await check('a rescue that landed earlier keeps completing later polls for free', async () => {
  clearApiCache();
  clearVisualMemory();
  const rows = backendRows();
  let bulkCalls = 0;

  const mock = async (input) => {
    const url = urlOf(input);
    if (url.hostname === 'api.coingecko.com') {
      bulkCalls += 1;
      return jsonResponse(coingeckoRows(rows));
    }
    return jsonResponse(rows);
  };

  const first = await withFetch(mock, () => getMarkets({ perPage: 250, vs: 'usd' }));
  assert.equal(bulkCalls, 1);
  assert.ok(first.every((row) => row.image && row.sparkline.length > 2));

  /* Next poll: the backend sends the SAME bare tickers again (it always does
     — CoinLore has no artwork). The rows must still come out complete, from
     the memory this time, with no second bulk request. */
  clearApiCache();
  const second = await withFetch(mock, () => getMarkets({ perPage: 250, vs: 'usd' }));
  assert.equal(bulkCalls, 1, 'the visuals were remembered, not re-fetched');
  assert.ok(second.every((row) => /^https:\/\/coin-images\.coingecko\.com\//.test(row.image ?? '')),
    'later polls render complete rows from memory');
  assert.ok(second.every((row) => row.sparkline.length > 2));
  assert.equal(second[0].price, 1000, 'and still show the live price from the backend');
});

await check('a blocked rescue is quiet, keeps the honest rows, and cools down', async () => {
  clearApiCache();
  clearVisualMemory();
  const rows = backendRows();
  let bulkAttempts = 0;

  const run = () => withFetch(async (input) => {
    const url = urlOf(input);
    if (url.hostname === 'api.coingecko.com') {
      bulkAttempts += 1;
      throw new TypeError('Failed to fetch');
    }
    return jsonResponse(rows);
  }, () => getMarkets({ perPage: 250, vs: 'usd' }));

  const first = await run();
  assert.equal(bulkAttempts, 1, 'the rescue tried once');
  assert.equal(first.length, rows.length, 'the prices are still on screen');
  assert.equal(first[0].price, 1000);
  assert.equal(first[0].image, null, 'a blocked rescue invents nothing');
  assert.deepEqual(first[0].sparkline, []);

  /* A second poll inside the cooldown must not pay for the same failure. */
  clearApiCache();
  const second = await run();
  assert.equal(bulkAttempts, 1, 'the cooldown stops a failing request per poll');
  assert.equal(second[0].price, 1000);
});

console.log(`  ${checks} client visual rescue checks passed`);
