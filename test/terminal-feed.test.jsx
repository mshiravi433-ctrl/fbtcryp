// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import useTerminalFeed from '../src/components/perp-terminal/useTerminalFeed';

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.useRealTimers(); });

it('only polls for an active, visible tab, skips overlapping reads, and isolates markets', async () => {
  vi.useFakeTimers();
  let visible = 'visible';
  vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visible);
  let resolve;
  const read = vi.fn().mockImplementationOnce(() => new Promise((done) => { resolve = done; }))
    .mockResolvedValueOnce({ live: false })
    .mockResolvedValue({ live: true, id: 'new' });
  const { result, rerender } = renderHook(({ key }) => useTerminalFeed(key, read, 5000), { initialProps: { key: null } });
  expect(read).not.toHaveBeenCalled();
  rerender({ key: 'BTC-USD' });
  await act(() => vi.advanceTimersByTimeAsync(15000));
  expect(read).toHaveBeenCalledTimes(1);
  await act(async () => resolve({ live: true, id: 'btc' }));
  await act(() => vi.advanceTimersByTimeAsync(5000));
  expect(result.current.failed).toBe(true);
  expect(result.current.lastGood.id).toBe('btc');
  visible = 'hidden';
  await act(() => vi.advanceTimersByTimeAsync(15000));
  expect(read).toHaveBeenCalledTimes(2);
  rerender({ key: 'ETH-USD' });
  expect(result.current).toBeNull();
  visible = 'visible';
  await act(async () => document.dispatchEvent(new Event('visibilitychange')));
  expect(read).toHaveBeenLastCalledWith('ETH-USD');
  expect(result.current.lastGood.id).toBe('new');
  rerender({ key: null });
  await act(() => vi.advanceTimersByTimeAsync(15000));
  expect(read).toHaveBeenCalledTimes(3);
});

it('reuses the in-flight request if the same panel is reopened', async () => {
  let resolve;
  const read = vi.fn(() => new Promise((done) => { resolve = done; }));
  const { result, rerender } = renderHook(({ key }) => useTerminalFeed(key, read, 5000), { initialProps: { key: 'BTC-USD' } });
  await act(async () => {});
  rerender({ key: null });
  rerender({ key: 'BTC-USD' });
  await act(async () => resolve({ live: true, id: 'btc' }));
  expect(read).toHaveBeenCalledTimes(1);
  expect(result.current.lastGood.id).toBe('btc');
});
