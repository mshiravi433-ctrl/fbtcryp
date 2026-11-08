import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

const get = (port, path = '/api/scenario/context') => new Promise((resolve, reject) => {
  http.get({ hostname: '127.0.0.1', port, path },  (res) => {
    let data = '';
    res.on('data', (chunk) => { data += chunk; });
    res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: JSON.parse(data) }));
  }).on('error', reject);
});
test('read-only context endpoint degrades without upstream credentials or fabricated observations', { timeout: 25000 }, async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('UPSTREAM_OFFLINE'); };
  let server;
  try {
    const app = (await import('../server/app.js')).default;
    server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
    const response = await get(server.address().port);
    assert.equal(response.status, 200);
    assert.equal(response.body.schema, 'fbt.scenario-context.v1');
    assert.equal(response.body.executes, false);
    assert.equal(response.body.quotes.US10Y.status, 'UNAVAILABLE');
    assert.equal(response.body.stablecoin.status, 'UNAVAILABLE');
    assert.equal(response.body.headlines.status, 'UNAVAILABLE');
    assert.equal(response.body.ok, false);
    assert.equal(response.headers['cache-control'], 'no-store');
    assert.equal(JSON.stringify(response.body).includes('privateKey'), false);
    const cron = await get(server.address().port, '/api/cron/scenario-evidence');
    assert.equal(cron.status, 401, 'public requests cannot run the scheduled capture');
    const history = await get(server.address().port, '/api/scenario/history');
    assert.equal(history.status, 200);
    assert.equal(history.body.schema, 'fbt.scenario-evidence.v1');
    assert.ok(Array.isArray(history.body.rows));
    const invalid = await get(server.address().port, '/api/scenario/daily/INVALID');
    assert.equal(invalid.status, 400);
    const missing = await get(server.address().port, '/api/scenario/daily/bitcoin');
    assert.ok(missing.status >= 500);
    assert.ok(!Array.isArray(missing.body), 'no fabricated or offline historical prices');
    const midnight = Math.floor(Date.now() / 86400000) * 86400000;
    globalThis.fetch = async (url) => {
      if (!String(url).includes('/market_chart')) throw new Error('UPSTREAM_OFFLINE');
      return new Response(JSON.stringify({ prices: [
        [midnight - 2 * 86400000 + 23 * 3600000, 100],
        [midnight - 86400000 + 23 * 3600000, 110],
        [midnight + 3600000, 120]
      ] }), { status: 200, headers: { 'content-type': 'application/json' } });
    };
    const measured = await get(server.address().port, '/api/scenario/daily/ethereum');
    assert.equal(measured.status, 200);
    assert.deepEqual(measured.body, [{ t: midnight - 86400000, c: 100 }, { t: midnight, c: 110 }]);
  } finally {
    if (server) await new Promise((resolve) => server.close(resolve));
    globalThis.fetch = realFetch;
  }
});
