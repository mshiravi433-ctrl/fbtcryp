import { afterEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import http from 'node:http';
import {
  KAMINO_MAIN_MARKET,
  KAMINO_RESERVES_URL,
  fetchKaminoMainMarketPools,
  fetchYields,
  fetchYieldHistory,
  isEligible,
  isYieldPoolId,
  mapKaminoReserveToPool,
  normalizePool
} from '../server/yields.js';
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
    const dayAgo = 86_400_000;
    const midnightUtc = (time) => {
      const date = new Date(time);
      date.setUTCHours(0, 0, 0, 0);
      return date;
    };
    const yesterday = midnightUtc(Date.now() - dayAgo);
    const twoDaysAgo = midnightUtc(Date.now() - 2 * dayAgo);
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(response({ status: 'success', data: [
      { timestamp: new Date(yesterday.getTime() + 12 * 60 * 60_000).toISOString(), apy: 4, tvlUsd: 15 },
      { timestamp: twoDaysAgo.toISOString(), apy: null, tvlUsd: 0 },
      { timestamp: yesterday.toISOString(), apy: 3, tvlUsd: 12 },
      { timestamp: 'invalid', apy: 9 }, null,
      { timestamp: '2099-01-01T00:00:00Z', apy: 999 },
      { timestamp: new Date(Date.now() - 3 * dayAgo).toISOString(), apy: null, tvlUsd: null }
    ] }));
    const data = await fetchYieldHistory(id);
    expect(data.pool).toBe(id);
    expect(data.points).toHaveLength(2);
    expect(data.points[0]).toMatchObject({ apy: null, tvlUsd: 0, apyBase: null });
    expect(data.points[1].apy).toBe(4);
  });
  it.each(['7d', '30d', '90d'])('returns only observed points inside the requested %s history window', async (range) => {
    const now = Date.now();
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(response({ status: 'success', data: [
      { timestamp: new Date(now - 1 * 86_400_000).toISOString(), apy: 5, tvlUsd: 100 },
      { timestamp: new Date(now - 10 * 86_400_000).toISOString(), apy: 4, tvlUsd: 90 },
      { timestamp: new Date(now - 40 * 86_400_000).toISOString(), apy: 3, tvlUsd: 80 },
      { timestamp: new Date(now - 100 * 86_400_000).toISOString(), apy: 2, tvlUsd: 70 }
    ] }));
    const result = await fetchYieldHistory(id, range);
    const expectedCount = range === '7d' ? 1 : range === '30d' ? 2 : 3;
    expect(result).toMatchObject({ pool: id, range, points: expect.any(Array) });
    expect(result.points).toHaveLength(expectedCount);
  });
  it('rejects path injection before any upstream request', async () => {
    const spy = vi.spyOn(globalThis, 'fetch');
    await expect(fetchYieldHistory('../../pools')).rejects.toThrow('INVALID_POOL_ID');
    await expect(fetchYieldHistory('kamino-0OIlInvalidBase58')).rejects.toThrow('INVALID_POOL_ID');
    expect(spy).not.toHaveBeenCalled();
  });
});

describe('Kamino Solana free source & audited allow-list', () => {
  // Real metrics snapshot captured from api.kamino.finance/kamino-market/7u3HeHx.../reserves/metrics on 2026-10-26
  const kaminoUsdcRaw = {
    reserve: 'D6q6wuQSrifJKZYpR1M8R4YawnLDtDsMmWM1NbBmgJ59',
    liquidityToken: 'USDC',
    liquidityTokenMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
    maxLtv: '0.8',
    borrowApy: '0.0595172415205758',
    supplyApy: '0.044231808908655745',
    totalSupply: '131417885.41741740282',
    totalBorrow: '119665886.920939317455694670326672712779',
    totalBorrowUsd: '119645135.6594883573686546783138913644639',
    totalSupplyUsd: '131395096.24190716847'
  };
  const kaminoSolRaw = {
    reserve: 'd4A2prbA2whesmvHaL88BH6Ewn5N4bTSU2Ze8P6Bc4Q',
    liquidityToken: 'SOL',
    liquidityTokenMint: 'So11111111111111111111111111111111111111112',
    maxLtv: '0.65',
    borrowApy: '0.06711580098878329',
    supplyApy: '0.05213878863574353',
    totalSupplyUsd: '241212047.84546952897',
    totalBorrowUsd: '222063825.55046910332'
  };

  it('maps real Kamino Main Market reserves with withdrawable TVL, percentage APY, and mint-verified stablecoin flag', () => {
    const usdc = mapKaminoReserveToPool(kaminoUsdcRaw);
    expect(usdc).toMatchObject({
      pool: 'kamino-D6q6wuQSrifJKZYpR1M8R4YawnLDtDsMmWM1NbBmgJ59',
      chain: 'Solana',
      project: 'kamino-lend',
      symbol: 'USDC',
      poolMeta: 'SOL/BTC Market',
      stablecoin: true,
      exposure: 'single',
      ilRisk: 'no',
      apyReward: null,
      source: 'kamino',
      url: `https://kamino.com/borrow/reserve/${KAMINO_MAIN_MARKET}/D6q6wuQSrifJKZYpR1M8R4YawnLDtDsMmWM1NbBmgJ59`
    });
    expect(usdc.tvlUsd).toBeCloseTo(11_749_960.58, 1);
    expect(usdc.apy).toBeCloseTo(4.42318, 4);
    expect(isEligible(usdc)).toBe(true);
    expect(normalizePool(usdc)).toMatchObject({
      id: 'kamino-D6q6wuQSrifJKZYpR1M8R4YawnLDtDsMmWM1NbBmgJ59',
      apy: 4.4,
      apyBase: 4.4,
      apyReward: null,
      stablecoin: true,
      source: 'kamino',
      url: `https://kamino.com/borrow/reserve/${KAMINO_MAIN_MARKET}/D6q6wuQSrifJKZYpR1M8R4YawnLDtDsMmWM1NbBmgJ59`
    });

    const sol = mapKaminoReserveToPool(kaminoSolRaw);
    expect(sol.stablecoin).toBe(false);
    expect(sol.tvlUsd).toBeCloseTo(19_148_222.30, 1);
    expect(sol.apy).toBeCloseTo(5.21388, 4);
    expect(isEligible(sol)).toBe(true);
  });

  it('never classifies spoofed stablecoin symbols without a verified mint, and drops illiquid/wrapper/corrupted reserves', () => {
    const spoofedUsdc = mapKaminoReserveToPool({
      ...kaminoUsdcRaw,
      liquidityToken: 'USDC',
      liquidityTokenMint: 'So11111111111111111111111111111111111111112'
    });
    expect(spoofedUsdc.stablecoin).toBe(false);

    // 100%-utilized illiquid reserve (AWnKJ9... on Main Market) gets tvlUsd = 0 and fails MIN_TVL
    const fullyBorrowed = mapKaminoReserveToPool({
      ...kaminoUsdcRaw,
      reserve: 'AWnKJ9dsiHcoDCThxE5E93ikDTAXkApoNwrKM2tp9KFJ',
      totalSupplyUsd: '104.552461',
      totalBorrowUsd: '104.552461',
      supplyApy: '0.110396'
    });
    expect(fullyBorrowed.tvlUsd).toBe(0);
    expect(isEligible(fullyBorrowed)).toBe(false);

    // kToken LP-collateral wrappers, invalid base58, negative APY, and insolvent borrow > supply are rejected
    expect(mapKaminoReserveToPool({ ...kaminoSolRaw, liquidityToken: 'kSOLJITOSOLOrca' })).toBeNull();
    expect(mapKaminoReserveToPool({ ...kaminoSolRaw, liquidityToken: 'kSOLMSOLRaydium' })).toBeNull();
    expect(mapKaminoReserveToPool({ ...kaminoSolRaw, reserve: 'bad' })).toBeNull();
    expect(mapKaminoReserveToPool({ ...kaminoSolRaw, supplyApy: '-0.02' })).toBeNull();
    expect(mapKaminoReserveToPool({ ...kaminoSolRaw, totalBorrowUsd: '300000000', totalSupplyUsd: '240000000' })).toBeNull();
  });

  it.each([
    'kamino-lend', 'kamino-liquidity', 'jupiter-lend', 'save',
    'raydium-amm', 'orca-dex', 'spark-savings', 'benqi-lending',
    'benqi-staked-avax', 'binance-staked-sol', 'drift-staked-sol'
  ])('accepts verified protocol slug %s when safety floors pass', (project) => {
    const chain = project.startsWith('benqi') ? 'Avalanche' : project === 'spark-savings' ? 'Ethereum' : 'Solana';
    expect(isEligible({ ...good, project, chain, tvlUsd: 15_000_000, apy: 4.8, apyBase: 4.8 })).toBe(true);
  });

  it.each([
    'meteora', 'ajna-v2',
    'kamino', 'raydium', 'orca', 'spark', 'benqi',
    'stargate', 'stargate-v1', 'pendle', 'pendle-v2',
    'gmx', 'gmx-evm', 'gmx-v1-perps', 'eigenlayer',
    'seamless-v2', 'radiant-v2'
  ])('rejects dead or unsafe/broken slug %s in isEligible()', (project) => {
    expect(isEligible({ ...good, project, chain: 'Solana', tvlUsd: 50_000_000, apy: 5, apyBase: 5 })).toBe(false);
    expect(isEligible({ ...good, project, chain: 'Ethereum', tvlUsd: 50_000_000, apy: 5, apyBase: 5 })).toBe(false);
  });

  it('deduplicates Kamino Main Market reserves already in DefiLlama while adding missing eligible Kamino reserves', async () => {
    const llamaSolRow = {
      pool: '525b2dab-ea6a-4cbc-a07f-84ce561d1f83',
      project: 'kamino-lend',
      chain: 'Solana',
      symbol: 'SOL',
      poolMeta: 'SOL/BTC Market',
      underlyingTokens: ['So11111111111111111111111111111111111111112'],
      tvlUsd: 19_170_978,
      apy: 5.21637,
      apyBase: 5.21637,
      apyReward: null,
      apyMean30d: 4.80551,
      stablecoin: false,
      ilRisk: 'no',
      exposure: 'single',
      outlier: false
    };
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      if (String(url) === KAMINO_RESERVES_URL) return response([kaminoSolRaw, kaminoUsdcRaw]);
      return response({ status: 'success', data: [llamaSolRow] });
    });

    const data = await fetchYields();
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(data.pools).toHaveLength(2);
    // SOL comes once (from DefiLlama with UUID + apyMean30d), USDC comes from direct Kamino API
    const solPools = data.pools.filter((p) => p.symbol === 'SOL');
    const usdcPools = data.pools.filter((p) => p.symbol === 'USDC');
    expect(solPools).toHaveLength(1);
    expect(solPools[0]).toMatchObject({ id: '525b2dab-ea6a-4cbc-a07f-84ce561d1f83', source: 'defillama', apyMean30d: 4.8 });
    expect(usdcPools).toHaveLength(1);
    expect(usdcPools[0]).toMatchObject({
      id: 'kamino-D6q6wuQSrifJKZYpR1M8R4YawnLDtDsMmWM1NbBmgJ59',
      source: 'kamino',
      project: 'kamino-lend',
      chain: 'Solana'
    });
    expect(data.source).toBe('protocolDirect');
  });

  it('survives a Kamino direct-API outage without failing fetchYields()', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      if (String(url) === KAMINO_RESERVES_URL) return new Response('Service Unavailable', { status: 503 });
      return response({ status: 'success', data: [good] });
    });
    const data = await fetchYields();
    expect(data.pools).toHaveLength(1);
    expect(data.pools[0].id).toBe(id);
    expect(data.source).toBe('defillama');
    await expect(fetchKaminoMainMarketPools({ strict: true })).rejects.toThrow('503');
  });

  it('serves 7d/30d/90d history for direct Kamino reserve pool IDs', async () => {
    const kaminoPoolId = 'kamino-d4A2prbA2whesmvHaL88BH6Ewn5N4bTSU2Ze8P6Bc4Q';
    expect(isYieldPoolId(kaminoPoolId)).toBe(true);
    const now = Date.now();
    const dayIso = (daysAgo) => new Date(now - daysAgo * 86_400_000 + 60_000).toISOString();
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(response({
      reserve: 'd4A2prbA2whesmvHaL88BH6Ewn5N4bTSU2Ze8P6Bc4Q',
      history: [
        { timestamp: dayIso(40), metrics: { supplyInterestAPY: 0.041, actualAvailableLiquidityUsd: '15000000' } },
        { timestamp: dayIso(5), metrics: { supplyInterestAPY: 0.048, actualAvailableLiquidityUsd: '18500000.4' } },
        { timestamp: dayIso(1), metrics: { supplyInterestAPY: 0.0521, depositTvl: '241212047.8', borrowTvl: '222063825.5' } }
      ]
    }));
    const hist = await fetchYieldHistory(kaminoPoolId, '30d');
    expect(hist).toMatchObject({ pool: kaminoPoolId, range: '30d', source: 'kamino', freshness: 'FRESH' });
    expect(hist.points).toHaveLength(2);
    expect(hist.points[0]).toMatchObject({ apy: 4.8, apyBase: 4.8, apyReward: null, tvlUsd: 18_500_000 });
    expect(hist.points[1]).toMatchObject({ apy: 5.2, apyBase: 5.2, apyReward: null, tvlUsd: 19_148_222 });
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
  it('validates range names and caches each history window independently for an hour', async () => {
    const history = vi.fn(async (pool, range) => ({ pool, range, points: [], at: Date.now() }));
    const api = createYieldsApi({ pools: async () => feed(), history });
    const bad = res();
    await api.history({ params: { id }, query: { range: '365d' } }, bad);
    expect(bad.statusCode).toBe(400);
    expect(history).not.toHaveBeenCalled();

    const read = (range) => api.history({ params: { id }, query: { range } }, res());
    await read('7d');
    await read('30d');
    await read('7d');
    expect(history.mock.calls.map((call) => call[1])).toEqual(['7d', '30d']);
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
