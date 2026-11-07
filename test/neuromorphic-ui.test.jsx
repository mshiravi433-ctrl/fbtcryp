// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import React from 'react';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import NeuromorphicCortexPanel from '../src/components/ai/NeuromorphicCortexPanel.jsx';
import NeuromorphicRoomStrip from '../src/components/ai/NeuromorphicRoomStrip.jsx';
import {
  resetLocalNeuromorphicCortex,
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
});
