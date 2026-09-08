import { afterEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import http from 'node:http';
import { fetchYields, fetchYieldHistory, isEligible, normalizePool } from '../server/yields.js';
import { createYieldsApi } from '../server/yieldsApi.js';

const id = '11111111-1111-4111-8111-111111111111';
const good = { pool: id, project: 'aave-v3', chain: 'Base', symbol: 'USDC', tvlUsd: 500_000_000, apy: 5, apyBase: 5, apyReward: 0, exposure: 'single', ilRisk: 'no', stablecoin: true };
const response = (data) => new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json' } });
const feed = () => ({ pools: [{ ...normalizePool(good), freshness: 'FRESH' }], at: Date.now(), source: 'defillama' });
function res() {
  return { statusCode: 200, headers: {}, status(n) { this.statusCode = n; return this; }, set(k, v) { this.headers[k.toLowerCase()] = v; return this; }, json(body) { this.body = body; return this; } };
}
afterEach(() => vi.restoreAllMocks());

describe('DefiLlama upstream contract', () => {
  it.each([null, undefined, '', ' ', false, 'not-a-number', Infinity])('keeps missing or invalid metrics unknown: %s', (value) => {
    const row = normalizePool({ ...good, apyBase: value, apyReward: value, apyMean30d: value, volumeUsd1d: value, volumeUsd7d: value });
    for (const key of ['apyBase', 'apyReward', 'apyMean30d', 'volumeUsd1d', 'volumeUsd7d', 'apr', 'rewardApr']) expect(row[key]).toBeNull();
  });
  it('preserves zero, numeric strings, and explicitly reported APR without relabelling APY', () => {
    const row = normalizePool({ ...good, apyBase: '4.25', apyReward: 0, volumeUsd7d: 0, apr: 4.1 });
    expect(row).toMatchObject({ apyBase: 4.3, apyReward: 0, volumeUsd7d: 0, apr: 4.1, rewardApr: null });
  });
  it.each([{ pool: undefined }, { pool: '../malicious' }, { symbol: null }, { apy: true }, { apy: 61 }, { tvlUsd: 4_999_999 }, { outlier: true }, { project: 'unverified' }])('rejects an unsafe row %j', (override) => {
    expect(isEligible({ ...good, ...override })).toBe(false);
  });
  it('filters and deduplicates a real-shaped feed; supports more than the previous top 60', async () => {
    const rows = Array.from({ length: 520 }, (_, i) => ({ ...good, pool: `pool-${i}` }));
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(response({ status: 'success', data: [...rows, rows[0], { ...good, apy: 90000 }] }));
    const data = await fetchYields();
    expect(data.pools).toHaveLength(500);
    expect(data).toMatchObject({ considered: 522, passed: 520, truncated: true, freshness: 'FRESH' });
    expect(data.pools[0]).toMatchObject({ source: 'defillama', apr: null });
    expect(fetchMock.mock.calls[0][0]).toBe('https://yields.llama.fi/pools');
  });
  it.each([{ status: 'error', data: [] }, { status: 'success', data: null }, { status: 'success', data: [] }, {}])('rejects broken upstream JSON instead of caching a healthy empty list', async (body) => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(response(body));
    await expect(fetchYields()).rejects.toThrow('INVALID_YIELDS_RESPONSE');
  });
  it('allows a valid nonempty source whose pools all fail safety filters', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(response({ status: 'success', data: [{ ...good, apy: 9000 }] }));
    expect((await fetchYields()).pools).toEqual([]);
  });
  it('propagates HTTP and invalid JSON errors', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response('', { status: 429 })).mockResolvedValueOnce(new Response('<html>'));
    await expect(fetchYields()).rejects.toThrow('429');
    await expect(fetchYields()).rejects.toThrow();
    expect(spy).toHaveBeenCalledTimes(2);
  });
  it('normalizes chronological daily history, keeping the latest observation and null gaps', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(response({ status: 'success', data: [
      { timestamp: '2026-08-02T12:00:00Z', apy: 4, tvlUsd: 15 },
      { timestamp: '2026-08-01T00:00:00Z', apy: null, tvlUsd: 0 },
      { timestamp: '2026-08-02T00:00:00Z', apy: 3, tvlUsd: 12 },
      { timestamp: 'invalid', apy: 9 }, null,
      { timestamp: '2099-01-01T00:00:00Z', apy: 999 },
      { timestamp: '2026-08-03T00:00:00Z', apy: null, tvlUsd: null }
    ] }));
    const data = await fetchYieldHistory(id);
    expect(data.pool).toBe(id);
    expect(data.points).toHaveLength(2);
    expect(data.points[0]).toMatchObject({ apy: null, tvlUsd: 0, apyBase: null });
    expect(data.points[1].apy).toBe(4);
  });
  it('rejects path injection before any upstream request', async () => {
    const spy = vi.spyOn(globalThis, 'fetch');
    await expect(fetchYieldHistory('../../pools')).rejects.toThrow('INVALID_POOL_ID');
    expect(spy).not.toHaveBeenCalled();
  });
});

describe('Farm API cache and HTTP handlers', () => {
  it('single-flights concurrent requests and caches fresh results', async () => {
    const producer = vi.fn(async () => feed());
    const api = createYieldsApi({ pools: producer });
    const a = res(), b = res();
    await Promise.all([api.list({}, a), api.list({}, b)]);
    await api.list({}, res());
    expect(producer).toHaveBeenCalledTimes(1);
    expect(a.body).toEqual(b.body);
    expect(a.headers['cache-control']).toBe('no-store');
  });
  it('labels stale fallback for EVERY concurrent caller, keeps its timestamp, expires at 2 hours, then recovers', async () => {
    let time = Date.now();
    const producer = vi.fn().mockResolvedValueOnce(feed()).mockRejectedValue(new Error('offline'));
    const api = createYieldsApi({ pools: producer, now: () => time });
    const initial = res(); await api.list({}, initial);
    time += 3_600_001;
    const results = [res(), res(), res()];
    await Promise.all(results.map((r) => api.list({}, r)));
    expect(producer).toHaveBeenCalledTimes(2);
    for (const r of results) {
      expect(r.statusCode).toBe(200);
      expect(r.body.freshness).toBe('STALE');
      expect(r.body.pools[0].freshness).toBe('STALE');
      expect(r.body.at).toBe(initial.body.at);
      expect(r.headers['x-data-stale']).toBe('1');
    }
    expect(initial.body.pools[0].freshness).toBe('FRESH'); // no mutation
    await api.list({}, res());
    expect(producer).toHaveBeenCalledTimes(2); // backoff
    time += 3_600_000;
    const expired = res(); await api.list({}, expired);
    expect(expired.statusCode).toBe(502);
    expect(expired.body.pools).toBeUndefined();
    time += 30_001;
    producer.mockResolvedValue(feed());
    const recovered = res(); await api.list({}, recovered);
    expect(recovered.body.freshness).toBe('FRESH');
  });
  it('validates pool IDs and membership before fetching history', async () => {
    const history = vi.fn(async (pool) => ({ pool, points: [], at: Date.now() }));
    const pools = vi.fn(async () => feed());
    const api = createYieldsApi({ pools, history });
    const bad = res(); await api.history({ params: { id: '../pools' } }, bad);
    expect(bad.statusCode).toBe(400); expect(pools).not.toHaveBeenCalled();
    const absent = res(); await api.history({ params: { id: id.replace(/^1/, '2') } }, absent);
    expect(absent.statusCode).toBe(404); expect(history).not.toHaveBeenCalled();
    const ok = res(); await api.history({ params: { id } }, ok);
    await api.history({ params: { id } }, res());
    expect(ok.body.pool).toBe(id); expect(history).toHaveBeenCalledTimes(1);
  });
  it('serves real HTTP routes with structured errors and no CDN caching', async () => {
    const api = createYieldsApi({ pools: async () => feed(), history: async (pool) => ({ pool, points: [], at: Date.now() }) });
    const app = express();
    app.get('/api/yields', api.list);
    app.get('/api/yields/:id/history', api.history);
    const server = app.listen(0, '127.0.0.1');
    await new Promise((resolve) => server.once('listening', resolve));
    try {
      const get = (path) => new Promise((resolve, reject) => {
        http.get({ host: '127.0.0.1', port: server.address().port, path }, (r) => {
          let body = ''; r.on('data', (b) => { body += b; });
          r.on('end', () => resolve({ status: r.statusCode, body: JSON.parse(body), headers: r.headers }));
        }).on('error', reject);
      });
      const list = await get('/api/yields');
      expect(list.status).toBe(200); expect(list.body.pools[0].id).toBe(id);
      expect(list.headers['cache-control']).toBe('no-store');
      expect((await get(`/api/yields/${id}/history`)).status).toBe(200);
      expect((await get('/api/yields/bad/history')).status).toBe(400);
    } finally { await new Promise((resolve) => server.close(resolve)); }
  });
});
