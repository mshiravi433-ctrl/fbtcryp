// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';

const mock = vi.hoisted(() => ({ getYields: vi.fn(), getFarmProtocolFallback: vi.fn(), emitFarmEvent: vi.fn() }));
vi.mock('../src/lib/yields', () => ({ getYields: mock.getYields }));
vi.mock('../src/lib/farmProtocolFallback', () => ({ getFarmProtocolFallback: mock.getFarmProtocolFallback }));
vi.mock('../src/lib/farmDeFi', () => ({ emitFarmEvent: mock.emitFarmEvent }));

import { useFarmYields, FARM_YIELDS_CACHE_KEY } from '../src/hooks/useFarmYields';

const pool = { id: '11111111-1111-4111-8111-111111111111', symbol: 'USDC', apy: 4.5, source: 'defillama' };
const snapshot = (overrides = {}) => ({
  pools: [pool], venues: [], at: Date.now(), freshness: 'FRESH', source: 'defillama', ...overrides
});

afterEach(() => { cleanup(); vi.useRealTimers(); });
beforeEach(() => {
  localStorage.clear();
  mock.getYields.mockReset();
  mock.getFarmProtocolFallback.mockReset().mockResolvedValue(null);
  mock.emitFarmEvent.mockReset();
});

describe('Farm reliable feed lifecycle', () => {
  it('persists a healthy feed and serves it as clearly stale data after a later outage', async () => {
    mock.getYields.mockResolvedValueOnce(snapshot());
    const first = renderHook(() => useFarmYields());
    await waitFor(() => expect(first.result.current.data?.freshness).toBe('FRESH'));
    first.unmount();
    expect(JSON.parse(localStorage.getItem(FARM_YIELDS_CACHE_KEY)).pools[0].apy).toBe(4.5);

    mock.getYields.mockRejectedValueOnce(new Error('offline'));
    mock.getFarmProtocolFallback.mockResolvedValueOnce(null);
    const second = renderHook(() => useFarmYields());
    expect(second.result.current.data.freshness).toBe('STALE');
    await waitFor(() => expect(mock.getYields).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(second.result.current.refreshing).toBe(false));
    expect(second.result.current.error).toBeNull();
    expect(second.result.current.data.pools[0]).toMatchObject({ apy: 4.5, freshness: 'STALE' });
  });

  it('prefers verified direct venue observations when the primary source returns stale data', async () => {
    const direct = {
      pools: [],
      venues: [{ id: 'aave-base-usdc-direct', project: 'aave-v3', chain: 'Base', symbol: 'USDC', apy: 4.2, source: 'aaveBaseOnchain', freshness: 'FRESH' }],
      at: Date.now(), freshness: 'FRESH', source: 'protocolDirect', fallback: true
    };
    mock.getYields.mockResolvedValueOnce(snapshot({ freshness: 'STALE' }));
    mock.getFarmProtocolFallback.mockResolvedValueOnce(direct);
    const provider = vi.fn(async () => ({}));
    const { result } = renderHook(() => useFarmYields({ getReadProvider: provider }));
    await waitFor(() => expect(result.current.data?.source).toBe('protocolDirect'));
    expect(result.current.data.freshness).toBe('FRESH');
    expect(result.current.data.venues[0]).toMatchObject({ apy: 4.2, freshness: 'FRESH' });
    expect(mock.getFarmProtocolFallback).toHaveBeenCalledWith(expect.objectContaining({ getReadProvider: provider }));
  });

  it('does not keep observations past the two-hour freshness limit', async () => {
    vi.useFakeTimers();
    const old = snapshot({ at: Date.now() - 3 * 60 * 60_000 });
    localStorage.setItem(FARM_YIELDS_CACHE_KEY, JSON.stringify(old));
    mock.getYields.mockRejectedValueOnce(new Error('offline'));
    const { result } = renderHook(() => useFarmYields());
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(result.current.data).toBeNull();
    expect(result.current.error?.message).toBe('offline');
  });
});
