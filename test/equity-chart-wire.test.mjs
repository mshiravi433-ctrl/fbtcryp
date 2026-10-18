import { afterEach, it } from 'node:test';
import assert from 'node:assert/strict';
import { fetchEquityChart, normalizeEquityChart } from '../src/lib/equityChart.js';
const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });
const points = [{ t: 1700000000000, p: 99 }, { t: 1700000060000, p: 101 }];
it('reads the actual /api/chart response (normalized array), not only CoinGecko envelopes', async () => {
  const calls = [];
  globalThis.fetch = async (url) => { calls.push(String(url)); return { ok: true, json: async () => points }; };
  assert.deepEqual(await fetchEquityChart('wire-proxy-regression', 1), points);
  assert.equal(calls.length, 1);
  assert.match(calls[0], /\/chart\/wire-proxy-regression\?days=1/);
});
it('reads public tuples, rejects invalid data, orders and deduplicates timestamps', () => {
  assert.deepEqual(normalizeEquityChart({ prices: [[points[1].t, 101], [points[0].t, 99], [points[0].t, 99], [null, 5], [5, null], [6, -1], [8, '5'], null] }), points);
  assert.deepEqual(normalizeEquityChart({ error: 'unavailable' }), []);
});
it('an empty HTTP 200 proxy response still tries the public real-data fallback once', async () => {
  let calls = 0;
  globalThis.fetch = async () => ({ ok: true, json: async () => ++calls === 1 ? { prices: [] } : { prices: points.map(({ t, p }) => [t, p]) } });
  assert.deepEqual(await fetchEquityChart('wire-empty-proxy', 14), points);
  assert.equal(calls, 2);
});
it('bounds the requested window before sending any request', async () => {
  globalThis.fetch = async () => { throw new Error('must not fetch'); };
  assert.deepEqual(await fetchEquityChart('wire-invalid-days', NaN), []);
  assert.deepEqual(await fetchEquityChart('wire-invalid-days', -2), []);
});
