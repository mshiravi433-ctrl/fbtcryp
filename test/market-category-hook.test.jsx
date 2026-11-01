// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';

const api = vi.hoisted(() => ({ getCategory: vi.fn() }));
vi.mock('../src/lib/api', () => api);
import { useMarketCategory } from '../src/hooks/useMarketCategory';

const row = (id, extra = {}) => ({ id, symbol: id.toUpperCase(), name: id, price: 1, ...extra });
const page = (start, count) => Array.from({ length: count }, (_, i) => row(`coin-${start + i}`));
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };

beforeEach(() => { api.getCategory.mockReset(); });
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe('category page lifecycle', () => {
  it('asks for full pages and exposes a retryable, deduplicated next page', async () => {
    api.getCategory.mockImplementation(async (_sector, opts) => {
      if (opts.page === 1) return page(0, 250);
      if (opts.page === 2) return [row('coin-249'), ...page(250, 3)];
      throw new Error('unexpected page');
    });
    const { result } = renderHook(() => useMarketCategory('defi', 'usd'));
    await waitFor(() => expect(result.current.rows).toHaveLength(250));
    expect(api.getCategory).toHaveBeenCalledWith('defi', expect.objectContaining({ vs: 'usd', perPage: 250, page: 1, strict: true }));
    expect(result.current.hasMore).toBe(true);
    await act(async () => { await result.current.loadMore(); });
    expect(result.current.rows).toHaveLength(253);
    expect(result.current.hasMore).toBe(false);
    expect(api.getCategory).toHaveBeenLastCalledWith('defi', expect.objectContaining({ page: 2, force: true }));
  });

  it('keeps page one and allows retry if a later page fails', async () => {
    api.getCategory.mockResolvedValueOnce(page(0, 250)).mockRejectedValueOnce(Error('down')).mockResolvedValueOnce([row('next')]);
    const { result } = renderHook(() => useMarketCategory('storage', 'usd'));
    await waitFor(() => expect(result.current.rows).toHaveLength(250));
    await act(async () => { await result.current.loadMore(); });
    expect(result.current.rows).toHaveLength(250);
    expect(result.current.pageError).toBe(true);
    expect(result.current.hasMore).toBe(true);
    await act(async () => { await result.current.loadMore(); });
    expect(result.current.rows).toHaveLength(251);
    expect(result.current.pageError).toBe(false);
  });

  it('also clears risk tags if loading a subsequent page fails', async () => {
    api.getCategory.mockResolvedValueOnce(page(0, 250)).mockRejectedValueOnce(Error('down'));
    const { result } = renderHook(() => useMarketCategory('monitoring', 'usd'));
    await waitFor(() => expect(result.current.rows).toHaveLength(250));
    await act(async () => { await result.current.loadMore(); });
    expect(result.current.rows).toEqual([]);
    expect(result.current.error).toBe(true);
    expect(result.current.updatedAt).toBe(0);
  });

  it('discards late responses as soon as either category or currency changes', async () => {
    const first = deferred(), second = deferred(), third = deferred();
    api.getCategory.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise).mockReturnValueOnce(third.promise);
    const { result, rerender } = renderHook(({ sector, vs }) => useMarketCategory(sector, vs), {
      initialProps: { sector: 'seed', vs: 'usd' }
    });
    rerender({ sector: 'monitoring', vs: 'usd' });
    await act(async () => { second.resolve([row('monitoring')]); });
    expect(result.current.rows.map((r) => r.id)).toEqual(['monitoring']);
    rerender({ sector: 'monitoring', vs: 'eur' });
    expect(result.current.rows).toEqual([]);
    await act(async () => { third.resolve([row('monitoring-eur', { price: 12 })]); });
    await act(async () => { first.resolve([row('seed-from-old-request')]); });
    expect(result.current.rows.map((r) => r.id)).toEqual(['monitoring-eur']);
  });

  it('drops previously verified risk membership after a failed refresh, and retries', async () => {
    api.getCategory.mockResolvedValueOnce([row('known')]).mockRejectedValueOnce(Error('down')).mockResolvedValueOnce([row('new')]);
    const { result } = renderHook(() => useMarketCategory('seed', 'usd'));
    await waitFor(() => expect(result.current.rows.map((r) => r.id)).toEqual(['known']));
    await act(async () => { await result.current.refresh(); });
    expect(result.current.error).toBe(true);
    expect(result.current.rows).toEqual([]);
    expect(result.current.updatedAt).toBe(0);
    await act(async () => { await result.current.refresh(); });
    expect(result.current.rows.map((r) => r.id)).toEqual(['new']);
    expect(result.current.error).toBe(false);
    expect(api.getCategory).toHaveBeenLastCalledWith('seed', expect.objectContaining({ force: true, strict: true }));
  });

  it('reports a thematic refresh failure without pretending the saved data is newly refreshed', async () => {
    api.getCategory.mockResolvedValueOnce([row('filecoin')]).mockRejectedValueOnce(Error('down'));
    const { result } = renderHook(() => useMarketCategory('storage', 'usd'));
    await waitFor(() => expect(result.current.rows).toHaveLength(1));
    const oldTimestamp = result.current.updatedAt;
    await act(async () => { await result.current.refresh(); });
    expect(result.current.error).toBe(true);
    expect(result.current.rows.map((r) => r.id)).toEqual(['filecoin']);
    expect(result.current.updatedAt).toBe(oldTimestamp);
  });

  it('refreshes every loaded page only while the token tab is active', async () => {
    vi.useFakeTimers();
    api.getCategory.mockImplementation(async (_sector, opts) => opts.page === 1 ? page(0, 250) : [row('last')]);
    const { result, rerender } = renderHook(({ active }) => useMarketCategory('defi', 'usd', active), { initialProps: { active: true } });
    await act(async () => {});
    await act(async () => { await result.current.loadMore(); });
    expect(api.getCategory).toHaveBeenCalledTimes(2);
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    expect(api.getCategory).toHaveBeenCalledTimes(4);
    expect(api.getCategory.mock.calls.slice(-2).map(([, options]) => options.page)).toEqual([1, 2]);
    rerender({ active: false });
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    expect(api.getCategory).toHaveBeenCalledTimes(4);
    rerender({ active: true });
    await act(async () => {});
    expect(api.getCategory).toHaveBeenCalledTimes(6);
  });
});
