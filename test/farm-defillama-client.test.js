import { afterEach, describe, expect, it, vi } from 'vitest';
import { getYields, getYieldHistory, realShare } from '../src/lib/yields';
import { DefiLlamaYieldAdapter, FbtFeeEngine, farmProtocolSummary, metricFreshness, normalizeFarmOpportunity } from '../src/lib/farmDeFi';
const id = '11111111-1111-4111-8111-111111111111';
const pool = { id, symbol: 'USDC', project: 'aave-v3', chain: 'Base', apy: 5, apyBase: null, apr: null, tvlUsd: 500_000_000, exposure: 'single' };
const response = (body, headers = {}) => new Response(JSON.stringify(body), { headers });
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

describe('DefiLlama client and metrics', () => {
  it('preserves stale response headers for older deployments', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(response({ pools: [pool], at: Date.now() }, { 'x-data-stale': '1' }));
    expect((await getYields()).freshness).toBe('STALE');
  });
  it.each([{ pools: [] }, { pools: null, at: Date.now() }, { pools: [pool], at: Date.now() - 7_200_001 }])('refuses malformed or expired data', async (data) => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(response(data));
    await expect(getYields()).rejects.toThrow();
  });
  it('aborts on caller cancellation and on timeout', async () => {
    vi.useFakeTimers();
    vi.spyOn(globalThis, 'fetch').mockImplementation((_url, { signal }) => new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
    }));
    const ctrl = new AbortController();
    const cancelled = expect(getYields({ signal: ctrl.signal })).rejects.toMatchObject({ name: 'AbortError' });
    ctrl.abort(); await cancelled;
    const timed = expect(getYields({ timeout: 50 })).rejects.toMatchObject({ name: 'AbortError' });
    await vi.advanceTimersByTimeAsync(51); await timed;
    expect(vi.getTimerCount()).toBe(0);
  });
  it('validates history identity and refuses unsafe IDs locally', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(response({ pool: 'different', points: [] }));
    await expect(getYieldHistory('../pools')).rejects.toThrow('INVALID_POOL_ID');
    expect(spy).not.toHaveBeenCalled();
    await expect(getYieldHistory(id)).rejects.toThrow('BAD_SHAPE');
  });
  it('propagates stale state to pool cards and the protocol status', () => {
    const at = Date.now();
    expect(normalizeFarmOpportunity(pool, { updatedAt: at, freshness: 'STALE' }).freshness).toBe('STALE');
    expect(farmProtocolSummary({ pools: [pool], at, freshness: 'STALE' }).status).toBe('STALE');
    expect(farmProtocolSummary({ error: new Error('offline') }).status).toBe('UNAVAILABLE');
    expect(metricFreshness(null)).toBe('UNAVAILABLE');
    expect(metricFreshness(Date.now() + 3_600_000)).toBe('UNAVAILABLE');
    expect(realShare(pool)).toBeNull();
  });
  it('does not quote unknown costs as zero or a complete net yield', () => {
    const engine = new FbtFeeEngine({ platformFeeBps: 30 });
    expect(engine.quoteOperation({ amountUsd: 1000 })).toMatchObject({ protocolFeeUsd: null, gasUsd: null, totalCostUsd: null });
    expect(engine.estimateNetYield({ grossApy: 5, amountUsd: 1000 })).toMatchObject({ netApy: null, gasCostApy: null, protocolCostApy: null, complete: false });
    expect(engine.estimateNetYield({ grossApy: null, amountUsd: 1000 }).status).toBe('UNAVAILABLE');
    expect(engine.quoteOperation({ amountUsd: 1000, gasUsd: 0, protocolFeeUsd: 0 }).totalCostUsd).toBe(3);
  });
  it('loads the adapter from the real client, deduplicates, exposes metrics and refuses transactions', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => response({ pools: [pool], at: Date.now(), freshness: 'FRESH' }));
    const adapter = new DefiLlamaYieldAdapter();
    const [apy, tvl] = await Promise.all([adapter.getAPY(id), adapter.getTVL(id)]);
    expect(apy).toMatchObject({ status: 'AVAILABLE', value: 5 });
    expect(tvl.value).toBe(pool.tvlUsd); expect(spy).toHaveBeenCalledTimes(1);
    expect((await adapter.getAPR(id)).status).toBe('UNAVAILABLE');
    expect((await adapter.execute()).status).toBe('UNAVAILABLE');
    expect((await adapter.getPool('missing')).status).toBe('UNAVAILABLE');
    await adapter.getPools({ refresh: true }); expect(spy).toHaveBeenCalledTimes(2);
  });
  it('does not retain an adapter snapshot after a failed explicit refresh', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('offline'));
    const adapter = new DefiLlamaYieldAdapter([pool]);
    expect((await adapter.getPools({ refresh: true })).status).toBe('UNAVAILABLE');
    expect((await adapter.getAPY(id)).status).toBe('UNAVAILABLE');
  });
});
