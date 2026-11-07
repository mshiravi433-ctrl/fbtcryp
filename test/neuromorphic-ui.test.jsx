// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import React from 'react';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import NeuromorphicCortexPanel from '../src/components/ai/NeuromorphicCortexPanel.jsx';
import NeuromorphicRoomStrip from '../src/components/ai/NeuromorphicRoomStrip.jsx';
import {
  consolidateLocalBrain,
  resetLocalNeuromorphicCortex,
  setBrainCircuitsEnabled,
  tickNeuromorphicWithCandles
} from '../src/lib/neuromorphic/useNeuromorphicCortex.js';

function sampleCandles(n = 28) {
  let p = 50000;
  return Array.from({ length: n }, (_, i) => {
    const o = p;
    const c = p * (1 + 0.007 + Math.sin(i / 3) * 0.003);
    p = c;
    return { t: 1700000000000 + i * 3600_000, o, h: Math.max(o, c) * 1.003, l: Math.min(o, c) * 0.997, c };
  });
}

describe('Phase 4 — Neuromorphic 2050 UI Console & Chat Room Strip', () => {
  beforeEach(async () => {
    vi.stubGlobal('fetch', vi.fn(async (url) => {
      const href = String(url);
      if (href.includes('/neuromorphic/status')) {
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify({
            ok: true,
            globalGeneration: 3,
            activeNodes24h: 12,
            totalAcceptedDeltas: 29,
            effectiveQuorum: 3,
            callerNode: { neuralXp: 45 }
          })
        };
      }
      if (href.includes('/neuromorphic/genome')) {
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify({ ok: true, upToDate: true, generation: 3 })
        };
      }
      return { ok: true, status: 200, text: async () => '{}' };
    }));
    await resetLocalNeuromorphicCortex();
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('renders honest em-dash before observations and zero NaN/undefined/Infinity in Persian & English', async () => {
    const { container, rerender } = render(<NeuromorphicCortexPanel locale="fa" />);
    await waitFor(() => {
      expect(screen.getByTestId('neuromorphic-cortex-panel')).toBeTruthy();
    });

    // Before any market observation, hit rate and directional drive MUST be '—'
    expect(screen.getByTestId('nmc-hit-rate').textContent).toBe('—');
    expect(screen.getByTestId('nmc-directional-drive').textContent).toBe('—');
    expect(container.textContent).not.toMatch(/NaN|undefined|Infinity/);

    rerender(<NeuromorphicCortexPanel locale="en" />);
    expect(screen.getByText(/FBT Neuromorphic Cortex/i)).toBeTruthy();
    expect(container.textContent).not.toMatch(/NaN|undefined|Infinity/);
  });

  it('updates spike raster, regime bars, and room strip when fed real candles on device', async () => {
    const candles = sampleCandles(24);
    for (let end = 6; end <= 18; end += 1) {
      // eslint-disable-next-line no-await-in-loop
      await tickNeuromorphicWithCandles(candles.slice(0, end), { symbol: 'BTC' });
    }

    const { container } = render(
      <>
        <NeuromorphicCortexPanel locale="fa" />
        <NeuromorphicRoomStrip candles={candles} symbol="BTC" locale="fa" />
      </>
    );

    await waitFor(() => {
      expect(screen.getByTestId('neuromorphic-room-strip')).toBeTruthy();
    });
    expect(screen.getByTestId('nmc-directional-drive').textContent).not.toBe('—');
    expect(screen.getByTestId('nmc-hit-rate').textContent).toMatch(/%/);
    expect(container.textContent).not.toMatch(/NaN|undefined|Infinity/);
  });

  it('renders the Phase-6 brain-inspired block from measured device telemetry only', async () => {
    const candles = sampleCandles(26);
    for (let end = 6; end <= 20; end += 1) {
      // eslint-disable-next-line no-await-in-loop
      await tickNeuromorphicWithCandles(candles.slice(0, end), { symbol: 'BTC' });
    }

    const { container } = render(<NeuromorphicCortexPanel locale="fa" />);
    await waitFor(() => {
      expect(screen.getByTestId('nmc-brain-action')).toBeTruthy();
    });

    // Every Phase-6 surface is populated by the real cognitive cycle.
    expect(screen.getByTestId('nmc-brain-action').textContent).not.toBe('—');
    expect(screen.getByTestId('nmc-free-energy').textContent).toMatch(/انرژی آزاد|Free energy/);
    expect(screen.getByTestId('nmc-wm-load').textContent).toMatch(/%/);
    expect(screen.getByTestId('nmc-forward-error').textContent).not.toBe('—');
    expect(screen.getByTestId('nmc-plasticity-window').textContent).not.toBe('—');
    expect(screen.getByTestId('nmc-energy').textContent).not.toBe('—');
    for (const key of ['dopamine', 'acetylcholine', 'norepinephrine', 'serotonin']) {
      expect(screen.getByTestId(`nmc-neuromod-${key}`).textContent).toMatch(/%/);
    }
    expect(screen.getByTestId('nmc-pc-sensory')).toBeTruthy();
    expect(screen.getByTestId('nmc-pc-associative')).toBeTruthy();
    expect(screen.getByTestId('nmc-brain-toggle')).toBeTruthy();
    expect(screen.getByTestId('nmc-consolidate-btn')).toBeTruthy();
    expect(container.textContent).not.toMatch(/NaN|undefined|Infinity/);
  });

  it('reports NO_EPISODES honestly for consolidation and survives the brain on/off switch', async () => {
    await resetLocalNeuromorphicCortex();

    const empty = await consolidateLocalBrain({ iterations: 4 });
    expect(empty.ok).toBe(false);
    expect(empty.consolidation.code).toBe('NO_EPISODES');

    const off = await setBrainCircuitsEnabled(false);
    expect(off.ok).toBe(true);
    const on = await setBrainCircuitsEnabled(true);
    expect(on.ok).toBe(true);

    const { container } = render(<NeuromorphicCortexPanel locale="en" />);
    await waitFor(() => {
      expect(screen.getByTestId('neuromorphic-cortex-panel')).toBeTruthy();
    });
    // With the circuits on but no observation yet, the brain block must show
    // em-dashes, never invented numbers.
    expect(screen.getByTestId('nmc-brain-action').textContent).toBe('—');
    expect(container.textContent).not.toMatch(/NaN|undefined|Infinity/);
  });
});
