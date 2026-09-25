import { afterEach, describe, expect, it, vi } from 'vitest';
import { clearApiCache, getMarkets, getCategory, getGlobal, normalizeCoin } from '../src/lib/api.js';
import { liveMarketRows } from '../src/lib/strategyBrain/liveMarketRows.js';
import { buildStrategyFromChat, createChatEcosystemReaders, resetSharedReads } from '../src/lib/strategyBrain/chatBridge.js';
import { TOKENS } from '../src/lib/chains.js';
import { getOstiumMarkets } from '../src/lib/ostium.js';

const response = (body, headers = {}) => new Response(JSON.stringify(body), {
  status: 200, headers: { 'content-type': 'application/json', ...headers }
});
const eth = normalizeCoin({ id: 'ethereum', symbol: 'eth', name: 'Ethereum', current_price: 3000,
  price_change_percentage_24h: -2.5, market_cap: 4e11, total_volume: 1e10 });
const paxg = normalizeCoin({ id: 'pax-gold', symbol: 'paxg', current_price: 3300,
  price_change_percentage_24h: 1, market_cap: 9e8, total_volume: 1e7 });

const readers = () => createChatEcosystemReaders({ context: { wallet: { connected: true, chainId: 1 } } });
afterEach(() => { clearApiCache(); resetSharedReads(); vi.restoreAllMocks(); });

describe('strategy market observations', () => {
  it('consumes the normalized backend shape and maps only matching supported tokens', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(response([eth, { ...eth, id: 'wrong-coin' }]));
    const rows = await getMarkets({ perPage: 40 });
    expect(rows[0].dataProvenance).toBe('live');
    expect(liveMarketRows(rows, { registry: TOKENS, preferredChainId: 1 })).toMatchObject([
      { id: 'ethereum', symbol: 'ETH', price: 3000, volatilityPct: 2.5, chainId: 1, executable: true }
    ]);
    expect(await readers().crypto()).toMatchObject([{ id: 'ethereum', price: 3000 }]);
  });

  it('builds an honest, in-app strategy from real API-shaped rows even without a connected wallet', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      if (String(url).includes('/markets?')) return response([eth]);
      if (String(url).includes('/category/')) return response([paxg]);
      return response([]);
    });
    const built = await buildStrategyFromChat({
      text: 'I have 1000 dollars; I want 30% profit in 30 days at medium risk',
      only: ['wallet', 'portfolio', 'crypto', 'rwa', 'fees']
    });
    expect(built.ok).toBe(true);
    expect(built.strategy.goal).toMatchObject({ capitalUsd: 1000, horizonDays: 30, targetPct: 30 });
    expect(built.strategy.sleeves.length).toBeGreaterThan(0);
    expect(built.strategy.sleeves.every((s) => s.dataStatus === 'live')).toBe(true);
    expect(built.strategy.stages.some((s) => s.movesFunds && s.actions.some((a) =>
      a.route?.startsWith('/swap?from=USDC&') && a.requiresSignature))).toBe(true);
    expect(built.strategy.verdict.reachable).toBe(false);
  });

  it('does not label a stale backend cache as a live price, category or macro signal', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      if (String(url).includes('/markets?')) return response([eth], { 'x-data-stale': '1' });
      if (String(url).includes('/category/')) return response([paxg], { 'x-data-stale': '1' });
      if (String(url).includes('/global')) return response({ coins: 10, mcapChange: 4.5, btcDominance: 50 }, { 'x-data-stale': '1' });
      return response([]);
    });
    expect((await getMarkets({ perPage: 40 }))[0].dataProvenance).toBe('stale');
    expect((await getCategory('rwa', { perPage: 25 }))[0].dataProvenance).toBe('stale');
    expect((await getGlobal()).dataProvenance).toBe('stale');
    const read = readers();
    expect(await read.crypto()).toEqual([]);
    expect(await read.rwa()).toEqual([]);
    expect(await read.macro()).toBeNull();
    expect(spy.mock.calls.filter(([url]) => String(url).includes('/markets?'))).toHaveLength(1);
  });

  it('reads live RWA category and does not re-normalize already normalized global data', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      if (String(url).includes('/category/')) return response([paxg]);
      if (String(url).includes('/global')) return response({ coins: 10000, mcapChange: 4.5, btcDominance: 50 });
      return response([]);
    });
    const read = readers();
    expect(await read.rwa()).toMatchObject([{ id: 'pax-gold', symbol: 'PAXG', price: 3300, chainId: 1 }]);
    expect(await read.macro()).toMatchObject({ marketCapChange24hPct: 4.5, btcDominancePct: 50 });
  });

  it('excludes offline snapshots and missing 24-hour change from strategy observations', () => {
    expect(liveMarketRows([{ ...eth, dataProvenance: 'offline' }], { registry: TOKENS })).toEqual([]);
    expect(liveMarketRows([{ ...eth, change24h: null, dataProvenance: 'live' }], { registry: TOKENS })).toEqual([]);
  });

  it('treats an expired Ostium cache as unavailable, even if the JSON says live', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) =>
      String(url).includes('/prices')
        ? response({ prices: [{ pair: 'XAU/USD', from: 'XAU', to: 'USD', mid: 3000, isMarketOpen: true }], stale: false }, { 'x-data-stale': '1' })
        : response({ data: { pairs: [{ id: '42', from: 'XAU', to: 'USD', group: { name: 'Commodities' } }] } }));
    expect(await getOstiumMarkets()).toMatchObject({ pairs: [], live: false });
  });
});
