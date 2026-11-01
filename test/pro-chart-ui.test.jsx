// @vitest-environment jsdom
/**
 * TOKEN CHART — the terminal's behaviour, pinned.
 * ---------------------------------------------------------------------------
 * The arithmetic is covered in pro-chart-math.test.mjs. This file covers the
 * things arithmetic cannot: that the coin page renders a candlestick card with
 * a SMALL expand control, that the control opens a real dialog (in a portal,
 * above the page), that the dialog carries the analysis toolbar and the
 * timeframe rail, that Escape closes it, and that a choice made in the toolbar
 * is remembered.
 *
 * The chart engine itself cannot mount here (jsdom has no matchMedia or
 * ResizeObserver), and that is on purpose: the component must degrade to the
 * SVG candle fallback instead of throwing, which is exactly the behaviour a
 * stripped WebView depends on.
 */
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key) => key, i18n: { language: 'en', resolvedLanguage: 'en' } })
}));

vi.mock('../src/hooks/useMarket', () => ({
  useVolumeSeries: () => ({ data: [], loading: false })
}));

vi.mock('../src/components/CoinLogo.jsx', () => ({
  default: () => <span data-testid="coin-logo" />
}));

vi.mock('recharts', () => ({
  Bar: () => null,
  BarChart: () => null,
  Cell: () => null,
  ComposedChart: () => null,
  Line: () => null,
  LineChart: () => null,
  ResponsiveContainer: () => null,
  Tooltip: () => null,
  XAxis: () => null,
  YAxis: () => null,
  ReferenceLine: () => null
}));

/* The token-page terminal must degrade gracefully when the chart engine
   cannot build (no canvas / lightweight-charts throws). Force that path in
   this file so every test exercises the fallback UI, and the dedicated
   fallback assertion below has a deterministic trigger. */
vi.mock('lightweight-charts', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    createChart: () => {
      throw new Error('canvas unsupported in this environment');
    }
  };
});

import TokenChart from '../src/components/ProChart/TokenChart.jsx';

const DAY = 86_400_000;
const candles = Array.from({ length: 60 }, (_, i) => {
  const close = 100 + Math.sin(i / 5) * 6 + i * 0.4;
  return {
    t: 1_700_000_000_000 + i * DAY,
    o: close - 1,
    h: close + 2,
    l: close - 2.5,
    c: close
  };
});

const RANGES = [
  { key: '1D', days: 1 },
  { key: '7D', days: 7 },
  { key: '30D', days: 30 }
];

function mount(overrides = {}) {
  return render(
    <TokenChart
      data={candles}
      symbol="ETH"
      coin={{ id: 'ethereum', symbol: 'ETH', name: 'Ethereum' }}
      coinId="ethereum"
      range={RANGES[1]}
      ranges={RANGES}
      height={300}
      {...overrides}
    />
  );
}

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => cleanup());

describe('token chart', () => {
  it('renders the inline candle card with a legend and the small expand button', () => {
    const { container } = mount();
    expect(screen.getByTestId('token-chart')).toBeTruthy();
    /* The small button is the whole request: it is a 32/40px corner control
       with an accessible name, not a full-width call to action. */
    const expand = screen.getByRole('button', { name: 'coin.pro.open' });
    expect(expand.className).toContain('pc-expand');
    expect(expand.getAttribute('aria-haspopup')).toBe('dialog');
    expect(expand.getAttribute('aria-expanded')).toBe('false');
    expect(container.querySelector('.pc-stage--inline')).toBeTruthy();
    /* Legend carries the symbol and the OHLC labels, not a bare number. */
    expect(container.querySelector('.pc-legend').textContent).toContain('ETH');
    expect(container.querySelector('.pc-legend').textContent).toContain('coin.pro.c');
  });

  it('opens a full-screen dialog with the analysis toolbar and closes on Escape', () => {
    mount();
    fireEvent.click(screen.getByRole('button', { name: 'coin.pro.open' }));

    const dialog = screen.getByTestId('pro-chart-fullscreen');
    expect(dialog.getAttribute('role')).toBe('dialog');
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    /* Rendered in a portal on <body>, so page transforms cannot clip it. */
    expect(dialog.parentElement).toBe(document.body);

    /* Every timeframe of the page is reachable from inside the terminal. */
    for (const range of RANGES) {
      expect(screen.getByRole('button', { name: range.key })).toBeTruthy();
    }

    const toolbar = dialog.querySelector('[role="toolbar"]');
    expect(toolbar).toBeTruthy();
    const chips = toolbar.querySelectorAll('.pc-chip');
    expect(chips.length).toBeGreaterThanOrEqual(15);

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByTestId('pro-chart-fullscreen')).toBeNull();
  });

  it('remembers a toolbar choice in the terminal and in storage', () => {
    mount();
    fireEvent.click(screen.getByRole('button', { name: 'coin.pro.open' }));
    const ma7 = screen.getByRole('button', { name: 'MA7' });
    expect(ma7.getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(ma7);
    expect(screen.getByRole('button', { name: 'MA7' }).getAttribute('aria-pressed')).toBe('false');
    const stored = JSON.parse(window.localStorage.getItem('fbt-prochart-prefs:v1'));
    expect(stored.overlays.ma['7']).toBe(false);
  });

  it('changes timeframe through the page handler instead of owning a second range', () => {
    const onRangeChange = vi.fn();
    mount({ onRangeChange });
    fireEvent.click(screen.getByRole('button', { name: 'coin.pro.open' }));
    fireEvent.click(screen.getByRole('button', { name: '30D' }));
    expect(onRangeChange).toHaveBeenCalledTimes(1);
    expect(onRangeChange.mock.calls[0][0]).toEqual(RANGES[2]);
  });

  it('arms the measure and level tools without pretending they already drew something', () => {
    mount();
    fireEvent.click(screen.getByRole('button', { name: 'coin.pro.open' }));
    const level = screen.getByRole('button', { name: 'coin.pro.level' });
    fireEvent.click(level);
    expect(screen.getByRole('button', { name: 'coin.pro.level' }).getAttribute('aria-pressed')).toBe('true');
    const measure = screen.getByRole('button', { name: 'coin.pro.measure' });
    fireEvent.click(measure);
    expect(screen.getByRole('button', { name: 'coin.pro.measure' }).getAttribute('aria-pressed')).toBe('true');
    /* The hint explains the next tap; there is no fake result box yet. */
    expect(document.body.textContent).toContain('coin.pro.measureHint');
    expect(document.body.querySelector('.pc-measure')).toBeNull();
  });

  it('degrades to the fallback candle chart when the engine cannot mount', () => {
    /* lightweight-charts throws when it cannot build a canvas surface (no
       2d context / stripped WebView). ProChart must not throw: it logs a
       warning, renders the SVG fallback, and keeps the host mounted so a
       later rebuild can retry the real engine. */
    const { container } = mount();
    /* The engine host stays mounted (visibility: hidden) so a later rebuild
       can retry the real engine; the SVG fallback paints on top of it. */
    const host = container.querySelector('[data-testid="pro-chart-canvas"]');
    expect(host).toBeTruthy();
    expect(host.style.visibility).toBe('hidden');
    expect(container.querySelector('[data-testid="pro-chart-fallback"]')).toBeTruthy();
    expect(screen.getByTestId('token-chart')).toBeTruthy();
  });
});
