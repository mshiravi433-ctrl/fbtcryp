// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import React from 'react';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import NeuromorphicCortexPanel from '../src/components/ai/NeuromorphicCortexPanel.jsx';
import NeuromorphicRoomStrip from '../src/components/ai/NeuromorphicRoomStrip.jsx';
import {
  consolidateLocalBrain,
  ingestScientificMemory,
  refreshAdaptiveEcosystem,
  resetLocalNeuromorphicCortex,
  setAdaptiveEcosystemEnabled,
  setBrainCircuitsEnabled,
  setAdaptiveLearningOptIn,
  tickNeuromorphicWithCandles
} from '../src/lib/neuromorphic/useNeuromorphicCortex.js';
import { createAdaptiveEcosystem, DATA_PROFILES } from '../src/lib/neuromorphic/adaptiveEcosystem.js';

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

  it('renders the Phase-7 scientific memory from device evidence only', async () => {
    const candles = sampleCandles(28);
    for (let end = 6; end <= 22; end += 1) {
      // eslint-disable-next-line no-await-in-loop
      await tickNeuromorphicWithCandles(candles.slice(0, end), { symbol: 'BTC' });
    }

    const { container } = render(<NeuromorphicCortexPanel locale="fa" />);
    await waitFor(() => {
      expect(screen.getByTestId('nmc-science-pill')).toBeTruthy();
    });

    // The family is pre-registered in code, so its size is real even with no data.
    expect(screen.getByTestId('nmc-science-hypotheses').textContent).toMatch(/فرضیه|hypoth/i);
    // FDR verdict is a fraction "confirmed / tested" — never a bare marketing %.
    expect(screen.getByTestId('nmc-science-confirmed').textContent).toContain('/');
    // The Bayes factor stays an em-dash until real evidence exists; the moment it
    // exists it must be a finite number, never NaN/Infinity.
    const bf = screen.getByTestId('nmc-science-bf').textContent;
    expect(bf === '—' || /[+-]?[0-9]/.test(bf)).toBe(true);
    expect(screen.getByTestId('nmc-science-meta')).toBeTruthy();
    expect(screen.getByTestId('nmc-science-evidence')).toBeTruthy();
    expect(screen.getByTestId('nmc-science-prior')).toBeTruthy();
    expect(screen.getByTestId('nmc-science-honesty').textContent).toMatch(/FDR|پیش‌ثبت|پیش\u200cثبت/);
    expect(container.textContent).not.toMatch(/NaN|undefined|Infinity/);
    // Retrospective engrams alone must never be presented as a confirmed belief.
    expect(screen.getByTestId('nmc-science-honesty').textContent.length).toBeGreaterThan(40);
  });

  it('answers the science buttons with an explicit, honest status line', async () => {
    const candles = sampleCandles(26);
    for (let end = 6; end <= 20; end += 1) {
      // eslint-disable-next-line no-await-in-loop
      await tickNeuromorphicWithCandles(candles.slice(0, end), { symbol: 'BTC' });
    }

    const ingest = await ingestScientificMemory();
    expect(ingest.ok).toBe(true);
    expect(ingest.science.schema).toBe('fbt.neuromorphic.science.v1');
    expect(ingest.science.laws.canExecute).toBe(false);
    // Ticks already auto-ingest, so a second explicit ingest must either find new
    // evidence or reject every episode as a duplicate — never silently double-count.
    expect(ingest.ingest.ingested + ingest.ingest.duplicates).toBeGreaterThan(0);
    expect(ingest.ingest.totalEngrams).toBeGreaterThan(0);

    const { container } = render(<NeuromorphicCortexPanel locale="en" />);
    await waitFor(() => {
      expect(screen.getByTestId('nmc-science-status')).toBeTruthy();
    });
    expect(screen.getByTestId('nmc-science-status').textContent).toMatch(/observation|Scientific memory|Prior/i);
    expect(screen.getByTestId('nmc-science-ingest-btn')).toBeTruthy();
    expect(screen.getByTestId('nmc-science-share-btn')).toBeTruthy();
    expect(container.textContent).not.toMatch(/NaN|undefined|Infinity/);
  });

  it('renders the Phase-9 adaptive block with em-dashes before any observation', async () => {
    await resetLocalNeuromorphicCortex();
    const { container } = render(<NeuromorphicCortexPanel locale="fa" />);
    await waitFor(() => {
      expect(screen.getByTestId('nmc-adaptive-card')).toBeTruthy();
    });

    // Nothing pre-filled: efficacy, rate, duty and budget are all '—'.
    for (const id of ['nmc-adaptive-efficacy', 'nmc-adaptive-rate', 'nmc-adaptive-budget', 'nmc-adaptive-duty']) {
      expect(screen.getByTestId(id).textContent).toBe('—');
    }
    // The profile line names the honest cold state, not a made-up profile.
    expect(screen.getByTestId('nmc-adaptive-profile').textContent).toMatch(/اولین مشاهده|first observation/);
    // The scores line says nothing has been measured yet.
    expect(screen.getByTestId('nmc-adaptive-scores').textContent).toMatch(/نوشته نشده|pre-filled/);
    expect(container.textContent).not.toMatch(/NaN|undefined|Infinity/);
  });

  it('fills the Phase-9 block from a real on-device run and reports measured spikes', async () => {
    await resetLocalNeuromorphicCortex();
    const candles = sampleCandles(30);
    for (let end = 8; end <= 26; end += 1) {
      // eslint-disable-next-line no-await-in-loop
      await tickNeuromorphicWithCandles(candles.slice(0, end), { symbol: 'BTC' });
    }

    const { container } = render(<NeuromorphicCortexPanel locale="fa" />);
    await waitFor(() => {
      expect(screen.getByTestId('nmc-adaptive-card')).toBeTruthy();
    });

    expect(screen.getByTestId('nmc-adaptive-efficacy').textContent).not.toBe('—');
    expect(screen.getByTestId('nmc-adaptive-rate').textContent).toMatch(/%/);
    // The card explains the number beside it (the testid marks the headline value
    // only, matching the rest of the panel): the counterfactual count must be
    // present so a reader can see what the servo suppressed.
    expect(screen.getByTestId('nmc-adaptive-card').textContent).toMatch(/بدون سرور|without servo/);
    expect(screen.getByTestId('nmc-adaptive-budget').textContent).toMatch(/نورون|neuron/);
    expect(screen.getByTestId('nmc-adaptive-duty').textContent).toMatch(/%/);
    expect(screen.getByTestId('nmc-adaptive-profile').textContent).toMatch(/پروفایل|Profile/);

    // Every condition bar is populated from the cortex's own telemetry.
    for (const key of ['volatility', 'surprise', 'decisionMargin']) {
      expect(screen.getByTestId(`nmc-adaptive-cond-${key}`).textContent).toMatch(/[0-9]/);
    }
    // The saturation line is a count, never a claim.
    expect(screen.getByTestId('nmc-adaptive-saturation').textContent).toMatch(/اشباع|Saturated/);
    // Honesty note must be present and substantial.
    expect(screen.getByTestId('nmc-adaptive-honesty').textContent.length).toBeGreaterThan(60);
    expect(screen.getByTestId('nmc-adaptive-toggle')).toBeTruthy();
    expect(screen.getByTestId('nmc-adaptive-learn-toggle')).toBeTruthy();
    expect(container.textContent).not.toMatch(/NaN|undefined|Infinity/);
  });

  it('toggles the ecosystem off for an A/B against pure Phase-6 dynamics', async () => {
    const off = await setAdaptiveEcosystemEnabled(false);
    expect(off.ok).toBe(true);
    expect(off.adaptiveEnabled).toBe(false);

    const on = await setAdaptiveEcosystemEnabled(true);
    expect(on.ok).toBe(true);
    expect(on.adaptiveEnabled).toBe(true);

    const { container } = render(<NeuromorphicCortexPanel locale="en" />);
    await waitFor(() => {
      expect(screen.getByTestId('nmc-adaptive-toggle').textContent).toMatch(/ON|OFF/);
    });
    expect(container.textContent).not.toMatch(/NaN|undefined|Infinity/);
  });

  it('reports withdrawn learning consent instead of pretending to learn', async () => {
    await resetLocalNeuromorphicCortex();

    // Withdraw consent BEFORE any observation: the report is honestly null, so
    // assert on the return value's flag rather than on a fabricated report.
    const off = await setAdaptiveLearningOptIn(false);
    expect(off.ok).toBe(true);
    expect(off.adaptiveLearningOptIn === undefined || off.adaptive?.learning.optIn === false).toBe(true);

    const candles = sampleCandles(26);
    for (let end = 8; end <= 22; end += 1) {
      // eslint-disable-next-line no-await-in-loop
      await tickNeuromorphicWithCandles(candles.slice(0, end), { symbol: 'BTC' });
    }

    const report = await refreshAdaptiveEcosystem();
    expect(report.adaptive.learning.optIn).toBe(false);
    expect(report.adaptive.learning.dutyCyclePct).toBe(0);
    // Not one learning tick may be claimed while consent is withheld.
    expect(report.adaptive.learning.ticksSpent).toBe(0);
    // The rate servo still works — withdrawing learning consent is not a pause.
    expect(report.adaptive.rateCode.rate).toBeGreaterThan(0);

    // Restore consent for the remaining tests.
    const on = await setAdaptiveLearningOptIn(true);
    expect(on.ok).toBe(true);
  });

  it('exposes the ecosystem constants and never claims accuracy', async () => {
    const eco = createAdaptiveEcosystem();
    const c = eco.constants();
    expect(c.targetRate).toBeGreaterThan(0);
    expect(c.bounds.gainMax).toBe(1);
    expect(c.rules.minDwellTicks).toBeGreaterThan(0);
    expect(DATA_PROFILES.EXPLOIT_FULL).toBe('EXPLOIT_FULL');

    const cold = eco.report();
    expect(cold).toBe(null);

    await resetLocalNeuromorphicCortex();
  });
});
