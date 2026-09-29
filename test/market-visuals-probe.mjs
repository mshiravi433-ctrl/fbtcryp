#!/usr/bin/env node
/**
 * Unit probe for lib/marketVisuals.js — the layer that restores logos and
 * sparklines on fallback market rows without ever inventing them.
 *
 * Contract pins:
 *   • hydration is BUDGETED (the market screen asks for 250 rows; refetching
 *     250 charts would re-create the rate limit we are hiding from);
 *   • one fetch per id even under concurrency (single-flight);
 *   • logos attach on EXACT CoinGecko id match only;
 *   • namespaced pseudo-ids (`coinlore-…`) are never sent upstream;
 *   • a remembered sparkline expires (a 7d line is not a week of lies);
 *   • a row that arrives WITH visuals is served untouched;
 *   • hydration failure is silent and never throws.
 */
import assert from 'node:assert/strict';

const {
  clearVisualMemory,
  hydrateCoinRows,
  mergeVisuals,
  rememberVisuals,
  DEFAULT_CHART_BUDGET,
  DEFAULT_LOGO_BUDGET
} = await import('../src/lib/marketVisuals.js');

const jsonResponse = (body) => new Response(JSON.stringify(body), {
  status: 200,
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

/* A fetchJson in the shape the shared module expects. */
const jsonFetch = async (url) => {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
};

let checks = 0;
const check = (name, fn) => Promise.resolve().then(fn).then(() => {
  checks += 1;
  console.log(`  ✓ ${name}`);
});

console.log('▸ probing market visual enrichment…');

await check('hydration is budgeted per call and skips namespaced pseudo-ids', async () => {
  clearVisualMemory();
  const rows = Array.from({ length: 40 }, (_, i) => ({
    id: i === 39 ? 'coinlore-900001' : `coin-${i}`,
    symbol: `C${i}`,
    name: `Coin ${i}`,
    price: 1,
    change24h: 0,
    sparkline: [],
    image: null
  }));

  const chartUrls = [];
  const logoUrls = [];
  await withFetch(async (input) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith('/market_chart')) {
      chartUrls.push(url);
      return jsonResponse({ prices: [[0, 100], [1, 101], [2, 102]] });
    }
    if (url.pathname === '/api/v3/search') {
      logoUrls.push(url);
      return jsonResponse({ coins: [] });
    }
    throw new Error(`unexpected ${url}`);
  }, () => hydrateCoinRows(rows, {
    fetchJson: jsonFetch,
    cgBase: 'https://api.coingecko.com/api/v3',
    vs: 'usd'
  }));

  assert.equal(chartUrls.length, DEFAULT_CHART_BUDGET, 'chart fetches respect the budget');
  assert.equal(logoUrls.length, DEFAULT_LOGO_BUDGET, 'logo fetches respect the budget');
  assert.ok(chartUrls.every((url) => url.pathname.startsWith('/api/v3/coins/coin-')),
    'the namespaced coinlore- id is never sent upstream');
  assert.ok(!logoUrls.some((url) => url.searchParams.get('query') === 'C39'),
    'nor is its symbol');
});

await check('one fetch per id even when requests overlap (single-flight)', async () => {
  clearVisualMemory();
  const row = { id: 'bitcoin', symbol: 'BTC', name: 'Bitcoin', price: 1, change24h: 0, sparkline: [], image: null };
  let chartCalls = 0;

  const run = () => withFetch(async (input) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith('/market_chart')) {
      chartCalls += 1;
      await new Promise((resolve) => setTimeout(resolve, 20));
      return jsonResponse({ prices: [[0, 1], [1, 2]] });
    }
    return jsonResponse({ coins: [] });
  }, () => hydrateCoinRows([row], { fetchJson: jsonFetch, cgBase: 'https://api.coingecko.com/api/v3' }));

  const [a, b] = await Promise.all([run(), run()]);
  assert.equal(chartCalls, 1, 'concurrent hydrations share one upstream call');
  assert.deepEqual(a[0].sparkline, [1, 2]);
  assert.deepEqual(b[0].sparkline, [1, 2]);
});

await check('logos attach on EXACT id match; symbol clones are ignored', async () => {
  clearVisualMemory();
  const row = { id: 'pepe', symbol: 'PEPE', name: 'Pepe', price: 1, change24h: 0, sparkline: [1, 2], image: null };
  const [out] = await withFetch(async (input) => {
    const url = new URL(String(input));
    assert.equal(url.pathname, '/api/v3/search');
    assert.equal(url.searchParams.get('query'), 'PEPE');
    return jsonResponse({ coins: [
      { id: 'pepe-sol', symbol: 'PEPE', name: 'Pepe on SOL', thumb: 'https://coin-images.coingecko.com/coins/images/38218/thumb/photo.jpg' },
      { id: 'pepe2', symbol: 'PEPE', name: 'Pepe 2', thumb: 'https://coin-images.coingecko.com/coins/images/99999/thumb/nope.jpg' }
    ] });
  }, () => hydrateCoinRows([row], { fetchJson: jsonFetch, cgBase: 'https://api.coingecko.com/api/v3', chartBudget: 0 }));

  assert.equal(out.image, null, 'no exact-id hit means no logo, not a clone\'s face');
});

await check('rows that already carry visuals are served untouched', async () => {
  clearVisualMemory();
  const row = {
    id: 'solana', symbol: 'SOL', name: 'Solana', price: 1, change24h: 0,
    sparkline: [9, 8, 7], image: 'https://coin-images.coingecko.com/coins/images/4128/small/solana.png'
  };
  let calls = 0;
  const [out] = await withFetch(async () => {
    calls += 1;
    return jsonResponse({});
  }, () => hydrateCoinRows([row], { fetchJson: jsonFetch, cgBase: 'https://api.coingecko.com/api/v3' }));

  assert.equal(calls, 0, 'nothing is fetched for a complete row');
  assert.deepEqual(out.sparkline, [9, 8, 7]);
  assert.equal(out.image, row.image);
  assert.equal(out.sparklineSource, undefined);
});

await check('hydration failures are silent and leave the row honest', async () => {
  clearVisualMemory();
  const row = { id: 'bitcoin', symbol: 'BTC', name: 'Bitcoin', price: 1, change24h: 0, sparkline: [], image: null };
  const [out] = await withFetch(async () => new Response('forbidden', { status: 403 }),
    () => hydrateCoinRows([row], { fetchJson: jsonFetch, cgBase: 'https://api.coingecko.com/api/v3' }));

  assert.deepEqual(out.sparkline, []);
  assert.equal(out.image, null);
});

await check('remembered visuals fill gaps only — a row\'s own data always wins', async () => {
  clearVisualMemory();
  const row = {
    id: 'ethereum', symbol: 'ETH', name: 'Ethereum',
    image: 'https://coin-images.coingecko.com/coins/images/279/large/ethereum.png',
    sparkline: [3, 2, 1]
  };
  rememberVisuals([row]);

  /* Gaps merge back from memory. */
  const fresh = mergeVisuals({ id: 'ethereum', symbol: 'ETH', name: 'Ethereum', sparkline: [], image: null });
  assert.deepEqual(fresh.sparkline, [3, 2, 1]);
  assert.equal(fresh.image, row.image);

  /* A row that arrives WITH its own sparkline/image is never overwritten. */
  const owned = mergeVisuals({ id: 'ethereum', symbol: 'ETH', name: 'Ethereum', sparkline: [5, 5, 5], image: 'x' });
  assert.deepEqual(owned.sparkline, [5, 5, 5], 'a live row\'s own history always wins');
  assert.equal(owned.image, 'x');

  /* mergeVisuals is pure: the input row object is not mutated. */
  const input = { id: 'ethereum', symbol: 'ETH', name: 'Ethereum', sparkline: [], image: null };
  const merged = mergeVisuals(input);
  assert.notEqual(merged, input);
  assert.deepEqual(input.sparkline, []);
  assert.equal(input.image, null);
});

console.log(`  ${checks} market visuals checks passed`);
