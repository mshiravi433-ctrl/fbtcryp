// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, waitFor } from '@testing-library/react';

/* A recording fake chart: enough surface for ProChart's build path, and it
   remembers the options each series was created with. */
const created = { candles: [], line: [], area: [], all: [] };
function makeChart() {
  const made = [];
  const chart = {
    addSeries(_type, options, pane) {
      const rec = { options: { ...options }, pane, color: options?.color ?? options?.upColor ?? options?.lineColor };
      made.push(rec);
      created.all.push(rec);
      const handle = {
        setData() {}, update() {}, applyOptions(o) { rec.options = { ...rec.options, ...o }; rec.color = o?.color ?? o?.upColor ?? rec.color; },
        priceScale: () => ({ applyOptions() {} }), createPriceLine: () => ({}), removePriceLine() {},
        coordinateToPrice: () => 100, attachPrimitive() {}, detachPrimitive() {}
      };
      return handle;
    },
    panes: () => [{ setStretchFactor() {} }, { setStretchFactor() {} }, { setStretchFactor() {} }, { setStretchFactor() {} }],
    timeScale: () => ({
      fitContent() {}, setVisibleLogicalRange() {}, getVisibleLogicalRange: () => ({ from: 0, to: 10 }),
      coordinateToLogical: () => 5, subscribeVisibleLogicalRangeChange() {}, scrollToRealTime() {}
    }),
    applyOptions() {}, subscribeCrosshairMove() {}, subscribeClick() {}, subscribeDblClick() {},
    remove() {}, takeScreenshot: () => null
  };
  return chart;
}

vi.mock('lightweight-charts', () => ({
  createChart: () => makeChart(),
  CandlestickSeries: 'Candlestick', LineSeries: 'Line', AreaSeries: 'Area', HistogramSeries: 'Histogram',
  CrosshairMode: { Normal: 0 }, LineStyle: { Solid: 0, Dotted: 1, Dashed: 2 }, PriceScaleMode: { Normal: 0, Logarithmic: 1 },
  ColorType: { Solid: 'solid' }
}));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ i18n: { language: 'en' }, t: (k) => k }) }));
vi.mock('../src/components/CoinLogo.jsx', () => ({ default: () => null }));

import ProChart from '../src/components/ProChart/ProChart.jsx';

const candles = Array.from({ length: 60 }, (_, i) => ({ time: 1700000000 + i * 86400, open: 100 + i, high: 104 + i, low: 98 + i, close: 101 + i }));

beforeEach(() => {
  Object.keys(created).forEach((k) => { created[k] = []; });
  window.matchMedia = (q) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} });
  globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get() { return 800; } });
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get() { return 400; } });
});
afterEach(() => cleanup());

const CANDLE_OPTS = (all) => all.find((r) => r.options.upColor);

describe('series colours follow the theme', () => {
  it('dark theme: neon candles and neon moving averages', async () => {
    document.documentElement.setAttribute('data-theme', 'dark');
    render(<ProChart candles={candles} overlays={{ ma: { 7: true, 25: true } }} settings={{ grid: true }} dataKey="dark" />);
    await waitFor(() => expect(created.all.length).toBeGreaterThan(0));
    const candle = CANDLE_OPTS(created.all);
    expect(candle.options.upColor).toBe('#26a69a');
    expect(created.all.some((r) => r.color === '#00e5ff'), 'MA7 neon').toBe(true);
    expect(created.all.some((r) => r.color === '#ffd54f'), 'EMA55 neon').toBe(true);
  });

  it('light theme: ink-grade candles and readable moving averages', async () => {
    document.documentElement.setAttribute('data-theme', 'light');
    render(<ProChart candles={candles} overlays={{ ma: { 7: true, 25: true } }} settings={{ grid: true }} dataKey="light" />);
    await waitFor(() => expect(created.all.length).toBeGreaterThan(0));
    const candle = CANDLE_OPTS(created.all);
    expect(candle.options.upColor).toBe('#0f8f7f');
    expect(candle.options.downColor).toBe('#d23a4e');
    /* None of the neon hexes that measure <2:1 on white may appear. */
    const forbidden = ['#00e5ff', '#ffd54f', '#4fc3f7', '#ff9800'];
    for (const hex of forbidden) {
      expect(created.all.some((r) => r.color === hex), `${hex} must not be used on the light theme`).toBe(false);
    }
    expect(created.all.some((r) => r.color === '#007b8f'), 'MA7 ink').toBe(true);
    expect(created.all.some((r) => r.color === '#9a6c00'), 'EMA55 ink').toBe(true);
  });

  it('theme flip repaints the live series without recreating the chart', async () => {
    document.documentElement.setAttribute('data-theme', 'dark');
    const { unmount } = render(<ProChart candles={candles} overlays={{ ma: { 7: true, 25: true } }} settings={{ grid: true }} dataKey="flip" />);
    await waitFor(() => expect(created.all.length).toBeGreaterThan(0));
    const before = created.all.length;
    document.documentElement.setAttribute('data-theme', 'light');
    await waitFor(() => {
      const candle = CANDLE_OPTS(created.all);
      expect(candle.options.upColor).toBe('#0f8f7f');
    }, { timeout: 3000 });
    /* No rebuild: the series list did not grow. */
    expect(created.all.length).toBe(before);
    unmount();
    document.documentElement.setAttribute('data-theme', 'dark');
  });
});
