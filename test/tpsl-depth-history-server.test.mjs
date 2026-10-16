/**
 * Route tests for the two dYdX read proxies used by TP/SL and history:
 *   GET /api/dydx/orders/:address/:number?status=…
 *   GET /api/dydx/fills/:address/:number?limit=…&before=…
 *
 * The real Express app is imported and driven over HTTP. The upstream indexer
 * is replaced by a stub on globalThis.fetch, so nothing leaves the sandbox.
 * Run with --test-force-exit: server/app.js starts background timers at import.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';

const ADDRESS = 'dydx1' + 'q'.repeat(38); // bech32-shaped, passes validAddress

const realFetch = globalThis.fetch;
let stub = null; // (url) => Response
const upstreamCalls = [];
globalThis.fetch = async (url, init) => {
  upstreamCalls.push(String(url));
  if (!stub) throw new Error('unexpected upstream fetch');
  return stub(String(url), init);
};

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

let app;
let server;
let base;

before(async () => {
  app = (await import('../server/app.js')).default;
  server = createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  base = `http://127.0.0.1:${port}`;
});

after(async () => {
  stub = null;
  globalThis.fetch = realFetch;
  if (server) await new Promise((resolve) => server.close(resolve));
});

async function get(path) {
  upstreamCalls.length = 0;
  const response = await realFetch(`${base}${path}`);
  let body = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  return { status: response.status, headers: response.headers, body };
}

/* ------------------------------ orders ----------------------------------- */

test('orders route: a bare-array indexer answer is returned as { orders }, no-store', async () => {
  stub = () => json([{ clobOrderId: 'a', ticker: 'BTC-USD' }]);
  const r = await get(`/api/dydx/orders/${ADDRESS}/0?status=UNTRIGGERED`);
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, { orders: [{ clobOrderId: 'a', ticker: 'BTC-USD' }] });
  assert.equal(r.headers.get('cache-control'), 'no-store');
  assert.equal(upstreamCalls.length, 1);
  assert.match(upstreamCalls[0], /\/v4\/orders\?/);
  assert.match(upstreamCalls[0], /status=UNTRIGGERED/);
});

test('orders route: a { orders } wrapper is also accepted', async () => {
  stub = () => json({ orders: [{ clobOrderId: 'b' }] });
  const r = await get(`/api/dydx/orders/${ADDRESS}/0`);
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, { orders: [{ clobOrderId: 'b' }] });
});

test('orders route: an unexpected body becomes an empty list, never a crash', async () => {
  stub = () => json({ something: 'else' });
  const r = await get(`/api/dydx/orders/${ADDRESS}/0`);
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, { orders: [] });
});

test('orders route: a status outside the allow-list is a 400 and never reaches the indexer', async () => {
  stub = () => json([]);
  const r = await get(`/api/dydx/orders/${ADDRESS}/0?status=ALL_THE_THINGS`);
  assert.equal(r.status, 400);
  assert.equal(upstreamCalls.length, 0);
  assert.equal(r.headers.get('cache-control'), 'no-store');
});

test('orders route: an invalid address is a 400 before any upstream fetch', async () => {
  stub = () => json([]);
  const r = await get('/api/dydx/orders/not-an-address/0');
  assert.equal(r.status, 400);
  assert.equal(upstreamCalls.length, 0);
});

test('orders route: an out-of-range subaccount is a 400 before any upstream fetch', async () => {
  stub = () => json([]);
  const r = await get(`/api/dydx/orders/${ADDRESS}/99`);
  assert.equal(r.status, 400);
  assert.equal(upstreamCalls.length, 0);
});

test('orders route: an indexer 404 is passed through as 404, not turned into an error', async () => {
  stub = () => new Response('nope', { status: 404 });
  const r = await get(`/api/dydx/orders/${ADDRESS}/0`);
  assert.equal(r.status, 404);
  assert.equal(r.headers.get('cache-control'), 'no-store');
});

test('orders route: an indexer 500 becomes 502 with no-store', async () => {
  stub = () => new Response('boom', { status: 500 });
  const r = await get(`/api/dydx/orders/${ADDRESS}/0`);
  assert.equal(r.status, 502);
  assert.equal(r.headers.get('cache-control'), 'no-store');
});

test('orders route: a network failure becomes 502, not a hang', async () => {
  stub = () => {
    throw new TypeError('fetch failed');
  };
  const r = await get(`/api/dydx/orders/${ADDRESS}/0`);
  assert.equal(r.status, 502);
});

/* ------------------------------ fills ------------------------------------ */

test('fills route: { fills } is returned as-is and capped at 100 rows', async () => {
  const rows = Array.from({ length: 150 }, (_, i) => ({ id: String(i) }));
  stub = () => json({ fills: rows });
  const r = await get(`/api/dydx/fills/${ADDRESS}/0?limit=25`);
  assert.equal(r.status, 200);
  assert.equal(r.body.fills.length, 100);
  assert.equal(r.body.fills[0].id, '0');
  assert.equal(r.headers.get('cache-control'), 'no-store');
  assert.match(upstreamCalls[0], /\/v4\/fills\?/);
  assert.match(upstreamCalls[0], /limit=25/);
});

test('fills route: a bare array is not read as fills (only the { fills } wrapper is)', async () => {
  stub = () => json([{ id: 'x' }]);
  const r = await get(`/api/dydx/fills/${ADDRESS}/0`);
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, { fills: [] });
});

test('fills route: a malformed cursor is a 400 before any upstream fetch', async () => {
  stub = () => json({ fills: [] });
  const r = await get(`/api/dydx/fills/${ADDRESS}/0?before=${encodeURIComponent('not a date')}`);
  assert.equal(r.status, 400);
  assert.equal(upstreamCalls.length, 0);
});

test('fills route: a valid cursor is sent upstream as an ISO createdBeforeOrAt', async () => {
  stub = () => json({ fills: [] });
  const r = await get(`/api/dydx/fills/${ADDRESS}/0?before=${encodeURIComponent('2026-10-10T00:00:00Z')}`);
  assert.equal(r.status, 200);
  assert.match(upstreamCalls[0], /createdBeforeOrAt=2026-10-10T00%3A00%3A00\.000Z/);
});

test('fills route: an indexer failure is a 502 with no-store', async () => {
  stub = () => new Response('x', { status: 503 });
  const r = await get(`/api/dydx/fills/${ADDRESS}/0`);
  assert.equal(r.status, 502);
  assert.equal(r.headers.get('cache-control'), 'no-store');
});
