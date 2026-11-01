import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { memoryStore } from '../server/cache.js';

const request = (port, path) => new Promise((resolve, reject) => {
  http.get({ host: '127.0.0.1', port, path, headers: { origin: 'https://localhost' } }, (response) => {
    let body = '';
    response.setEncoding('utf8');
    response.on('data', (chunk) => { body += chunk; });
    response.on('end', () => resolve({ status: response.statusCode, headers: response.headers, body: JSON.parse(body) }));
  }).on('error', reject);
});
const json = (body, status = 200) => new Response(JSON.stringify(body), { status });

test('category route refuses expired risk membership; thematic stale data is explicitly marked', async () => {
  const realFetch = globalThis.fetch;
  const realNow = Date.now;
  const oldVercel = process.env.VERCEL;
  process.env.VERCEL = '1';
  let now = 1_790_000_000_000;
  Date.now = () => now;
  let offline = false;
  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    if (offline) return json({}, 403);
    if (url.hostname === 'www.binance.com') return json({ code: '000000', success: true, data: [
      { st: 'TRADING', b: 'OG', q: 'USDT', an: 'OG Fan Token', tags: ['Seed'] }
    ] });
    if (url.pathname.endsWith('/coins/list')) return json([{ id: 'og-fan-token', symbol: 'og', name: 'OG Fan Token' }]);
    if (url.pathname.endsWith('/exchanges/binance/tickers')) return json({ tickers: [
      { coin_id: 'og-fan-token', base: 'OG', target: 'USDT', market: { identifier: 'binance' }, is_stale: false }
    ] });
    if (url.pathname.endsWith('/coins/markets')) return json([{
      id: url.searchParams.has('category') ? 'filecoin' : 'og-fan-token',
      symbol: 'fil', name: 'Real coin', current_price: 2, market_cap_rank: 1
    }]);
    return json({}, 403);
  };
  let server;
  try {
    const app = (await import('../server/app.js')).default;
    server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
    const port = server.address().port;
    const seed = await request(port, '/api/category/binance-seed?per_page=250&vs=usd');
    assert.equal(seed.status, 200);
    assert.equal(seed.body[0].id, 'og-fan-token');
    assert.equal(seed.headers['cache-control'], 'no-store');
    assert.equal(Number(seed.headers['x-category-fetched-at']), now);
    assert.match(seed.headers['access-control-expose-headers'], /x-category-fetched-at/);
    const storage = await request(port, '/api/category/storage?per_page=250&vs=usd');
    assert.equal(storage.status, 200);
    assert.equal(storage.body[0].id, 'filecoin');
    assert.equal((await request(port, '/api/category/unknown')).status, 400);

    now += 60_001;
    offline = true;
    const failedSeed = await request(port, '/api/category/binance-seed?per_page=250&vs=usd');
    assert.equal(failedSeed.status, 503);
    assert.deepEqual(failedSeed.body, { error: 'CATEGORY_DATA_UNAVAILABLE' });
    const staleStorage = await request(port, '/api/category/storage?per_page=250&vs=usd');
    assert.equal(staleStorage.status, 200);
    assert.equal(staleStorage.headers['x-data-stale'], '1');
    assert.equal(Number(staleStorage.headers['x-category-fetched-at']), now - 60_001);
    assert.equal(staleStorage.headers['cache-control'], 'no-store');
  } finally {
    if (server) await new Promise((resolve) => server.close(resolve));
    globalThis.fetch = realFetch;
    Date.now = realNow;
    if (oldVercel == null) delete process.env.VERCEL; else process.env.VERCEL = oldVercel;
    memoryStore.clear();
  }
});
