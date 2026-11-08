// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import React from 'react';
import { render, screen, cleanup, waitFor } from '@testing-library/react';

import ParallelUniversesPanel from '../src/components/ai/ParallelUniversesPanel.jsx';
import {
  __resetResearchUniverseRuntime,
  resetResearchUniverses,
  runResearchPulse,
  UNIVERSES_STORAGE_KEY
} from '../src/lib/neuromorphic/useResearchUniverses.js';

function sampleCandles(n = 90) {
  let price = 60000;
  let seed = 20261107;
  const rand = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const out = [];
  for (let i = 0; i < n; i += 1) {
    const z = Math.sqrt(-2 * Math.log(Math.max(1e-9, rand()))) * Math.cos(2 * Math.PI * rand());
   price = Math.max(100, price * (1 + 0.0002 + z * 0.012));
    out.push({
      t: 1_700_000_000_000 + i * 3_600_000,
      o: price * 0.999,
      h: price * 1.003,
      l: price * 0.997,
      c: price
    });
  }
  return out;
}

describe('Phase 8 — Parallel Research Universes panel', () => {
  beforeEach(async () => {
    localStorage.clear();
    __resetResearchUniverseRuntime();
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new Error('NETWORK_MUST_NOT_BE_USED_WHEN_CANDLES_ARE_SUPPLIED');
    }));
    await resetResearchUniverses();
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('renders honest em-dashes before any real observation (fa + en, no NaN)', async () => {
    const { container, rerender } = render(<ParallelUniversesPanel locale="fa" />);

    await waitFor(() => {
      expect(screen.getByTestId('pru-panel')).toBeTruthy();
    });

    expect(screen.getByTestId('pru-consensus-probability').textContent).toBe('—');
    expect(screen.getByTestId('pru-consensus-brier').textContent).toBe('—');
    expect(screen.getByTestId('pru-consensus-hitrate').textContent).toBe('—');
    expect(screen.getByTestId('pru-consensus-ece').textContent).toBe('—');
    expect(screen.getByTestId('pru-diversity').textContent).toBe('—');
    expect(screen.getByTestId('pru-empty')).toBeTruthy();
    expect(screen.getByTestId('pru-resolved').textContent).toMatch(/0/);
    expect(container.textContent).not.toMatch(/NaN|undefined|Infinity/);

    rerender(<ParallelUniversesPanel locale="en" />);
    expect(screen.getByText(/Parallel Research Universes/i)).toBeTruthy();
    expect(screen.getByTestId('pru-consensus-brier').textContent).toBe('—');
    expect(container.textContent).not.toMatch(/NaN|undefined|Infinity/);
  });

  it('fills every surface from a real walk-forward pulse (no network, no placeholders)', async () => {
    const candles = sampleCandles(100);
    const pulse = await runResearchPulse({ symbol: 'BTC', candles, bars: 80 });
    expect(pulse.ok).toBe(true);
    expect(fetch).not.toHaveBeenCalled();

    const { container } = render(<ParallelUniversesPanel locale="fa" />);
    await waitFor(() => {
      expect(screen.getByTestId('pru-resolved').textContent).toMatch(/\d/);
    });

    const brier = screen.getByTestId('pru-consensus-brier').textContent;
    expect(brier).not.toBe('—');
    expect(Number(brier)).toBeGreaterThan(0);
    expect(Number(brier)).toBeLessThan(1);
    expect(screen.getByTestId('pru-consensus-skill').textContent).toMatch(/%/);
    expect(screen.getByTestId('pru-consensus-hitrate').textContent).toMatch(/%/);
    expect(screen.getByTestId('pru-diversity').textContent).toMatch(/%/);
    expect(screen.getByTestId('pru-weight-entropy').textContent).toMatch(/%/);
    expect(screen.getByTestId('pru-selection-rounds').textContent).toMatch(/\d/);
    expect(screen.getByTestId('pru-control').textContent).toMatch(/Brier/);
    expect(screen.getByTestId('pru-best').textContent).toMatch(/Brier/);
    expect(screen.getByTestId('pru-honesty').textContent).toMatch(/canExecute=false/);
    expect(screen.getByTestId('pru-pending-state')).toBeTruthy();
    expect(screen.queryByTestId('pru-empty')).toBeNull();

    // The pulse ends by committing to the next (still unknown) bar: that is a
    // live probability, not a scored one.
    expect(screen.getByTestId('pru-consensus-probability').textContent).toMatch(/%/);
    expect(screen.getByTestId('pru-pending-state').textContent).toMatch(/Waiting|در انتظار/);

    const rows = container.querySelectorAll('[data-testid^="pru-universe-U"]');
    expect(rows.length).toBeGreaterThan(5);
    expect(container.textContent).not.toMatch(/NaN|undefined|Infinity/);

    // The snapshot is persisted for the next visit.
    expect(localStorage.getItem(UNIVERSES_STORAGE_KEY)).toBeTruthy();
  });

  it('exposes a manual selection round only after evidence exists', async () => {
    const candles = sampleCandles(70);
    await runResearchPulse({ symbol: 'BTC', candles, bars: 50 });

    const { container } = render(<ParallelUniversesPanel locale="en" />);
    await waitFor(() => {
      expect(screen.getByTestId('pru-selection-last')).toBeTruthy();
    });
    expect(screen.getByTestId('pru-selection').textContent).toMatch(/mutation/);
    expect(container.textContent).not.toMatch(/NaN|undefined|Infinity/);
  });

  it('reset wipes the population, the record and the persisted snapshot', async () => {
    await runResearchPulse({ symbol: 'BTC', candles: sampleCandles(60), bars: 40 });
    expect(localStorage.getItem(UNIVERSES_STORAGE_KEY)).toBeTruthy();

    await resetResearchUniverses();
    const { container } = render(<ParallelUniversesPanel locale="fa" />);
    await waitFor(() => {
      expect(screen.getByTestId('pru-consensus-brier').textContent).toBe('—');
    });
    expect(localStorage.getItem(UNIVERSES_STORAGE_KEY)).toBeNull();
    expect(screen.getByTestId('pru-empty')).toBeTruthy();
    expect(container.textContent).not.toMatch(/NaN|undefined|Infinity/);
  });
});
