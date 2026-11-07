// @vitest-environment jsdom
import React from 'react';
import { it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';

it('requires consent, keeps all cortex operations local and respects eco / pause', async () => {
  Object.defineProperty(navigator, 'hardwareConcurrency', { configurable: true, value: 8 });
  Object.defineProperty(navigator, 'deviceMemory', { configurable: true, value: 8 });
  localStorage.clear();
  localStorage.setItem('fbt.neuromorphic.prefs.v1', JSON.stringify({ paused: false, swarmOptIn: true }));
  const fetchSpy = vi.fn(() => { throw new Error('unexpected network request'); });
  vi.stubGlobal('fetch', fetchSpy);
  const runtime = await import('../src/lib/neuromorphic/useNeuromorphicCortex.js');
  const { default: Panel } = await import('../src/components/ai/NeuromorphicCortexPanel.jsx');
  render(<Panel locale="en" />);
  expect(screen.getByTestId('nmc-pause-toggle').textContent).toMatch(/Resume/);
  expect(screen.getByTestId('nmc-evolve-btn').disabled).toBe(true);
  expect(await runtime.syncWithGlobalSwarm()).toMatchObject({ ok: false, reason: 'LOCAL_ONLY' });
  const candles = Array.from({ length: 32 }, (_, i) => {
    const c = 100 + i + Math.sin(i);
    return { time: i, open: c - .2, high: c + 1, low: c - 1, close: c };
  });
  expect(await runtime.tickNeuromorphicWithCandles(candles)).toMatchObject({ reason: 'USER_PAUSED' });
  fireEvent.click(screen.getByTestId('nmc-pause-toggle'));
  await waitFor(() => expect(screen.getByTestId('nmc-pause-toggle').textContent).toMatch(/Pause/));
  await act(async () => { await runtime.tickNeuromorphicWithCandles(candles, { symbol: 'TEST' }); });
  expect(screen.getByTestId('nmc-directional-drive').textContent).not.toBe('—');
  expect(screen.getByTestId('nmc-local-mode').textContent).toMatch(/On-device/);
  fireEvent.change(screen.getByTestId('nmc-compute-mode'), { target: { value: 'eco' } });
  await waitFor(() => expect(localStorage.getItem('fbt.neuromorphic.local.v2')).toContain('eco'));
  await act(async () => { expect((await runtime.evolveNeuromorphicOnLiveCandles()).ok).toBe(false); });
  await act(async () => { await runtime.setNeuromorphicPreferences({ computeMode: 'balanced' }); });
  let result;
  await act(async () => { result = await runtime.evolveNeuromorphicOnLiveCandles(); });
  expect(result.ok).toBe(true);
  expect(result.evolution.candidateApplied).toBe(false);
  expect(screen.getByTestId('nmc-evolution-summary').textContent).toMatch(/not an independent test/);
  fireEvent.click(screen.getByTestId('nmc-pause-toggle'));
  await waitFor(() => expect(screen.getByTestId('nmc-evolve-btn').disabled).toBe(true));
  expect(fetchSpy).not.toHaveBeenCalled();
  vi.unstubAllGlobals();
});
