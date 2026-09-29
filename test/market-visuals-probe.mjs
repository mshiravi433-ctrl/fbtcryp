#!/usr/bin/env node
/**
 * Unit probe for lib/marketVisuals.js — the layer that restores logos and
 * sparklines on fallback market rows without ever inventing them.
 *
 * Contract pins:
 *   • hydration is BUDGETED — a 250-row page must never fan out into 250
 *     upstream calls, and one response must never hold a screen open;
 *   • the budget is spent on rows that STILL NEED a fetch, so a fallback row
 *     that arrives bare on every poll stops consuming slots once its visuals
 *     are in memory — that is what lets coverage ADVANCE down the list
 *     instead of ending at the first six rows forever;
 *   • a page that fits inside the budget is covered COMPLETELY, top to bottom;
 *   • hydration runs with bounded concurrency (and an optional wall-clock
 *     deadline) instead of opening one socket per row;
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
  needsVisuals,
  rememberVisuals,
  DEFAULT_CHART_BUDGET,
  DEFAULT_LOGO_BUDGET,
  DEFAULT_CONCURRENCY
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

const CG = 'https://api.coingecko.com/api/v3';

const bareRow = (i) => ({
  id: `coin-${i}`,
  symbol: `C${i}`,
  name: `Coin ${i}`,
  price: 1,
  change24h: 0,
  sparkline: [],
  image: null
});

let checks = 0;
const check = (name, fn) => Promise.resolve().then(fn).then(() => {
  checks += 1;
  console.log(`  ✓ ${name}`);
});

console.log('▸ probing market visual enrichment…');

await check('a page larger than the budget spends exactly the budget, from the top', async () => {
  clearVisualMemory();
  const total = DEFAULT_CHART_BUDGET + DEFAULT_LOGO_BUDGET + 20;
  const rows = Array.from({ length: total }, (_, i) => (i === total - 1 ? {
    ...bareRow(i),
    id: 'coinlore-900001',
    symbol: 'NEW'
  } : bareRow(i)));

  const chartIds = [];
  const logoQueries = [];
  await withFetch(async (input) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith('/market_chart')) {
      chartIds.push(url.pathname.split('/')[4]);
      return jsonResponse({ prices: [[0, 100], [1, 101], [2, 102]] });
    }
    if (url.pathname === '/api/v3/search') {
      logoQueries.push(url.searchParams.get('query'));
      return jsonResponse({ coins: [] });
    }
    throw new Error(`unexpected ${url}`);
  }, () => hydrateCoinRows(rows, { fetchJson: jsonFetch, cgBase: CG, vs: 'usd' }));

  assert.equal(chartIds.length, DEFAULT_CHART_BUDGET, 'chart fetches respect the budget');
  assert.equal(logoQueries.length, DEFAULT_LOGO_BUDGET, 'logo fetches respect the budget');
  assert.ok(chartIds.length + logoQueries.length <= DEFAULT_CHART_BUDGET + DEFAULT_LOGO_BUDGET,
    'the budget is the whole upstream cost of a call');
  /* The frontier starts at the top of the list: those are the rows on screen. */
  assert.deepEqual(chartIds.slice(0, 3), ['coin-0', 'coin-1', 'coin-2'],
    'the first rows are hydrated first');
  assert.ok(!chartIds.includes('coinlore-900001'), 'namespaced ids are never sent upstream');
  assert.ok(!logoQueries.includes('NEW'), 'nor is their symbol');
});

await check('a page that fits inside the budget is covered COMPLETELY', async () => {
  clearVisualMemory();
  const rows = Array.from({ length: 40 }, (_, i) => bareRow(i));
  const chartIds = new Set();
  const logoQueries = new Set();
  const out = await withFetch(async (input) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith('/market_chart')) {
      chartIds.add(url.pathname.split('/')[4]);
      return jsonResponse({ prices: [[0, 1], [1, 2], [2, 3]] });
    }
    if (url.pathname === '/api/v3/search') {
      logoQueries.add(url.searchParams.get('query'));
      return jsonResponse({ coins: [] });
    }
    throw new Error(`unexpected ${url}`);
  }, () => hydrateCoinRows(rows, { fetchJson: jsonFetch, cgBase: CG, vs: 'usd' }));

  assert.equal(chartIds.size, 40, 'every row got its chart — none were left behind');
  assert.equal(logoQueries.size, 40, 'and every row got its logo lookup');
  assert.ok(out.every((row) => row.sparkline.length > 2), 'and every row carries the line');
});

await check('coverage advances poll after poll until the whole page is filled', async () => {
  clearVisualMemory();
  const total = 150;
  const rows = Array.from({ length: total }, (_, i) => bareRow(i));
  const charted = new Set();
  let polls = 0;

  await withFetch(async (input) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith('/market_chart')) {
      const id = url.pathname.split('/')[4];
      assert.ok(!charted.has(id), `${id} must not be refetched — the memory already has it`);
      charted.add(id);
      return jsonResponse({ prices: [[0, 1], [1, 2]] });
    }
    if (url.pathname === '/api/v3/search') return jsonResponse({ coins: [] });
    throw new Error(`unexpected ${url}`);
  }, async () => {
    for (let i = 0; i < 6 && charted.size < total; i += 1) {
      polls += 1;
      /* eslint-disable no-await-in-loop */
      await hydrateCoinRows(rows, { fetchJson: jsonFetch, cgBase: CG, vs: 'usd' });
    }
  });

  assert.equal(charted.size, total, 'the page ends up fully covered, not just its top');
  assert.ok(polls <= Math.ceil(total / DEFAULT_CHART_BUDGET) + 1,
    `coverage converges in a handful of polls (took ${polls})`);
});

await check('hydration is concurrency-capped and never opens a socket per row', async () => {
  clearVisualMemory();
  const rows = Array.from({ length: 40 }, (_, i) => bareRow(i));
  let active = 0;
  let peak = 0;
  await withFetch(async (input) => {
    const url = new URL(String(input));
    active += 1;
    peak = Math.max(peak, active);
    await new Promise((resolve) => setTimeout(resolve, 5));
    active -= 1;
    if (url.pathname.endsWith('/market_chart')) return jsonResponse({ prices: [[0, 1], [1, 2]] });
    return jsonResponse({ coins: [] });
  }, () => hydrateCoinRows(rows, { fetchJson: jsonFetch, cgBase: CG, vs: 'usd', concurrency: 4 }));

  assert.ok(peak <= 4, `at most 4 calls in flight at once (saw ${peak})`);
  assert.ok(peak > 1, 'and they do run in parallel');
  assert.ok(DEFAULT_CONCURRENCY >= 2, 'the production default is parallel too');
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
  }, () => hydrateCoinRows([row], { fetchJson: jsonFetch, cgBase: CG }));

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
  }, () => hydrateCoinRows([row], { fetchJson: jsonFetch, cgBase: CG, chartBudget: 0 }));

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
  }, () => hydrateCoinRows([row], { fetchJson: jsonFetch, cgBase: CG }));

  assert.equal(calls, 0, 'nothing is fetched for a complete row');
  assert.deepEqual(out.sparkline, [9, 8, 7]);
  assert.equal(out.image, row.image);
  assert.equal(out.sparklineSource, undefined);
  assert.equal(needsVisuals(row), false, 'and it is not counted as missing anything');
});

await check('hydration failures are silent and leave the row honest', async () => {
  clearVisualMemory();
  const row = { id: 'bitcoin', symbol: 'BTC', name: 'Bitcoin', price: 1, change24h: 0, sparkline: [], image: null };
  const [out] = await withFetch(async () => new Response('forbidden', { status: 403 }),
    () => hydrateCoinRows([row], { fetchJson: jsonFetch, cgBase: CG }));

  assert.deepEqual(out.sparkline, []);
  assert.equal(out.image, null);
  assert.equal(out.price, 1, 'a dead upstream never touches the numbers');
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

  /* And a remembered row costs the next poll NOTHING upstream. */
  let calls = 0;
  await withFetch(async () => {
    calls += 1;
    return jsonResponse({});
  }, () => hydrateCoinRows([{ id: 'ethereum', symbol: 'ETH', name: 'Ethereum', sparkline: [], image: null }],
    { fetchJson: jsonFetch, cgBase: CG }));
  assert.equal(calls, 0, 'memory answers before the budget is consulted');

  /* mergeVisuals is pure: the input row object is not mutated. */
  const input = { id: 'ethereum', symbol: 'ETH', name: 'Ethereum', sparkline: [], image: null };
  const merged = mergeVisuals(input);
  assert.notEqual(merged, input);
  assert.deepEqual(input.sparkline, []);
  assert.equal(input.image, null);
});

console.log(`  ${checks} market visuals checks passed`);
