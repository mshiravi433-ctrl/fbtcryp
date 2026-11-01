// @vitest-environment jsdom
/**
 * PRO CHART ENGINE — the REAL lightweight-charts, exercised end to end.
 * ---------------------------------------------------------------------------
 * Why this file exists: in November 2026 the token-page terminal shipped
 * completely dead («هیچکدام دکمه‌ها داخلش کار نمیده… تصویر هم میگه مرورگر
 * پشتیبانی نمیکنه») because ProChart called
 * `chart.subscribeVisibleLogicalRangeChange()` — a method that lives on
 * `chart.timeScale()`, not on the chart. The TypeError was swallowed by the
 * mount catch and the terminal silently became the static SVG fallback: no
 * zoom, no pinch, no crosshair, dead toolbar, "browser can't build image"
 * on PNG. The older UI test could not see it — jsdom has no canvas, so it
 * intentionally tested the FALLBACK path.
 *
 * This suite does the opposite: it gives jsdom the three things the engine
 * needs (a tolerant 2d canvas context, ResizeObserver, matchMedia) and runs
 * the actual library through the actual component. If anyone calls a
 * non-existent library method during mount again, the canvas never appears
 * and these tests fail loudly instead of a user finding it on production.
 */
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

/* ---- browser surface the engine needs ---- */
function fakeGradient() { return { addColorStop() {} }; }
function fakeCtx(canvas) {
  const target = {
    canvas,
    measureText: (s) => ({
      width: String(s ?? '').length * 6,
      actualBoundingBoxAscent: 8,
      actualBoundingBoxDescent: 2,
      fontBoundingBoxAscent: 8,
      fontBoundingBoxDescent: 2
    }),
    createLinearGradient: fakeGradient,
    createRadialGradient: fakeGradient,
    createPattern: () => null,
    getImageData: (x, y, w, h) => ({ data: new Uint8ClampedArray(Math.max(4, w * h * 4)), width: w, height: h }),
    createImageData: (w, h) => ({ data: new Uint8ClampedArray(Math.max(4, w * h * 4)), width: w, height: h }),
    getLineDash: () => []
  };
  return new Proxy(target, {
    get(t, p) {
      if (p in t) return t[p];
      return () => undefined;
    },
    set(t, p, v) { t[p] = v; return true; }
  });
}

beforeEach(() => {
  window.localStorage.clear();
  HTMLCanvasElement.prototype.getContext = function getContext() {
    if (!this.__ctx) this.__ctx = fakeCtx(this);
    return this.__ctx;
  };
  HTMLCanvasElement.prototype.toDataURL = () => 'data:image/png;base64,AAAA';
  HTMLCanvasElement.prototype.toBlob = function toBlob(cb) { cb(new Blob(['x'], { type: 'image/png' })); };
  if (typeof URL.createObjectURL !== 'function') URL.createObjectURL = () => 'blob:mock';
  if (typeof URL.revokeObjectURL !== 'function') URL.revokeObjectURL = () => {};
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  if (typeof window.matchMedia !== 'function') {
    window.matchMedia = (q) => ({
      matches: false, media: q,
      addEventListener() {}, removeEventListener() {},
      addListener() {}, removeListener() {}
    });
  }
  Object.defineProperty(window, 'devicePixelRatio', { value: 2, configurable: true });
  // jsdom has no layout: give every element a believable box.
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get() { return 800; } });
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get() { return 400; } });
  HTMLElement.prototype.getBoundingClientRect = function rect() {
    return { x: 0, y: 0, top: 0, left: 0, bottom: 400, right: 800, width: 800, height: 400, toJSON() {} };
  };
});

afterEach(() => cleanup());

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key) => key, i18n: { language: 'en', resolvedLanguage: 'en' } })
}));

const DAY = 86_400_000;
const rawCandles = Array.from({ length: 120 }, (_, i) => {
  const close = 100 + Math.sin(i / 5) * 6 + i * 0.4;
  return { t: 1_700_000_000_000 + i * DAY, o: close - 1, h: close + 2, l: close - 2.5, c: close };
});
const volumeRows = rawCandles.map((c, i) => ({ t: c.t, v: 1_000_000 + i * 1000 }));

/* Stub the spot-price poll so the terminal's live-tick effect resolves
   cleanly in jsdom instead of hanging on a real network fetch. */
vi.mock('../src/lib/api', () => ({
  getSimplePrices: async () => ({ ethereum: { usd: 142 } })
}));

vi.mock('../src/hooks/useMarket', () => ({
  useVolumeSeries: () => ({ data: volumeRows, loading: false })
}));

vi.mock('../src/components/CoinLogo.jsx', () => ({
  default: () => <span data-testid="coin-logo" />
}));

import TokenChart from '../src/components/ProChart/TokenChart.jsx';
import ProChart from '../src/components/ProChart/ProChart.jsx';
import { toCandles } from '../src/lib/proChartMath.js';

const RANGES = [
  { key: '1D', days: 1 },
  { key: '7D', days: 7 },
  { key: '30D', days: 30 }
];

function mountToken(overrides = {}) {
  const onRangeChange = vi.fn();
  const utils = render(
    <TokenChart
      data={rawCandles}
      symbol="ETH"
      coin={{ id: 'ethereum', symbol: 'ETH', name: 'Ethereum' }}
      coinId="ethereum"
      range={RANGES[1]}
      ranges={RANGES}
      onRangeChange={onRangeChange}
      height={300}
      {...overrides}
    />
  );
  return { ...utils, onRangeChange };
}

const engineCanvas = (root) => root.querySelector('[data-testid="pro-chart-canvas"] canvas');

describe('pro chart engine (real lightweight-charts)', () => {
  it('mounts the real canvas engine inline — not the SVG fallback', async () => {
    const { container } = mountToken();
    await waitFor(() => {
      expect(engineCanvas(container), 'engine should create canvases').toBeTruthy();
    }, { timeout: 4000 });
    /* The regression pin for the dead-terminal bug: the fallback must NOT
       be what a capable browser ends up with. */
    expect(container.querySelector('[data-testid="pro-chart-fallback"]')).toBeNull();
  });

  it('fullscreen terminal: every control works against the live engine', async () => {
    const { onRangeChange } = mountToken();
    await waitFor(() => expect(engineCanvas(document.body)).toBeTruthy(), { timeout: 4000 });

    fireEvent.click(screen.getByRole('button', { name: 'coin.pro.open' }));
    const dialog = await screen.findByTestId('pro-chart-fullscreen');
    await waitFor(() => {
      expect(engineCanvas(dialog), 'fullscreen engine canvas').toBeTruthy();
      expect(dialog.querySelector('[data-testid="pro-chart-fallback"]')).toBeNull();
    }, { timeout: 4000 });
    const press = (name) => {
      const btn = screen.getByRole('button', { name });
      fireEvent.click(btn);
      return btn;
    };


    // chart type: candles → line → area → candles, engine alive throughout
    expect(press('coin.chartLine').getAttribute('aria-pressed')).toBe('true');
    await waitFor(() => expect(engineCanvas(dialog)).toBeTruthy());
    expect(press('coin.pro.area').getAttribute('aria-pressed')).toBe('true');
    await waitFor(() => expect(engineCanvas(dialog)).toBeTruthy());
    expect(press('coin.chartCandle').getAttribute('aria-pressed')).toBe('true');
    await waitFor(() => expect(engineCanvas(dialog)).toBeTruthy());

    // overlays
    expect(press('MA99').getAttribute('aria-pressed')).toBe('true');
    expect(press('EMA21').getAttribute('aria-pressed')).toBe('true');
    expect(press('EMA55').getAttribute('aria-pressed')).toBe('true');
    expect(press('coin.pro.bb').getAttribute('aria-pressed')).toBe('true');
    // panes (structural rebuilds)
    expect(press('coin.pro.rsi').getAttribute('aria-pressed')).toBe('true');
    await waitFor(() => expect(engineCanvas(dialog)).toBeTruthy());
    expect(press('coin.pro.macd').getAttribute('aria-pressed')).toBe('true');
    await waitFor(() => expect(engineCanvas(dialog)).toBeTruthy());
    expect(dialog.querySelector('[data-testid="pro-chart-fallback"]')).toBeNull();
    // fib / log / grid
    expect(press('coin.pro.fib').getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: 'coin.pro.linear' }));
    expect(screen.getByRole('button', { name: 'coin.pro.log' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'coin.pro.grid' }));

    // zoom buttons must REALLY move the visible window: the stats strip
    // counts visible bars, and zooming in must shrink that count.
    const barsNow = () => Number(dialog.querySelector('.pc-stats-bars')?.textContent.replace(/\D/g, '') || NaN);
    await waitFor(() => expect(barsNow()).toBeGreaterThan(50));
    const before = barsNow();
    fireEvent.click(screen.getByTitle('coin.pro.zoomIn'));
    await waitFor(() => expect(barsNow()).toBeLessThan(before), { timeout: 3000 });
    fireEvent.click(screen.getByTitle('coin.pro.fit'));
    await waitFor(() => expect(barsNow()).toBeGreaterThanOrEqual(before - 2), { timeout: 3000 });
    fireEvent.click(screen.getByTitle('coin.pro.zoomOut'));
    expect(engineCanvas(dialog)).toBeTruthy();

    // snapshot must succeed against a real engine (this was the
    // «مرورگر پشتیبانی نمیکنه» symptom: "could not build image").
    fireEvent.click(screen.getByRole('button', { name: 'coin.pro.png' }));
    await waitFor(() => expect(dialog.textContent).toContain('coin.pro.snapshotSaved'), { timeout: 3000 });
    expect(dialog.textContent).not.toContain('coin.pro.snapshotFailed');

    // range rail reaches the page
    fireEvent.click(screen.getByRole('button', { name: '30D' }));
    expect(onRangeChange).toHaveBeenCalled();

    // reset + close
    fireEvent.click(screen.getByRole('button', { name: 'coin.pro.reset' }));
    fireEvent.click(screen.getByRole('button', { name: 'coin.pro.close' }));
    await waitFor(() => expect(screen.queryByTestId('pro-chart-fullscreen')).toBeNull());
  });

  it('live data path: poll syncs in place, spot tick moves the forming candle, view survives', async () => {
    const candles = toCandles(rawCandles);
    const ref = React.createRef();
    let api = null;
    const onWindowStats = vi.fn();
    const { rerender } = render(
      <div style={{ position: 'relative', width: 800, height: 400 }}>
        <ProChart
          ref={ref}
          dataKey="ethereum:7D"
          candles={candles}
          onReady={(a) => { api = a; }}
          onWindowStats={onWindowStats}
        />
      </div>
    );
    await waitFor(() => expect(api, 'engine ready').toBeTruthy(), { timeout: 4000 });

    // visible-range subscription actually fires (the original TypeError site)
    onWindowStats.mockClear();
    ref.current.zoom(0.4);
    await waitFor(() => expect(onWindowStats).toHaveBeenCalled(), { timeout: 3000 });
    const zoomedRange = api.chart.timeScale().getVisibleLogicalRange();
    expect(zoomedRange.to - zoomedRange.from).toBeLessThan(candles.length);

    // double-tap toggle: zoomed in → back out to fit
    ref.current.toggleZoom();
    await waitFor(() => {
      const r = api.chart.timeScale().getVisibleLogicalRange();
      expect(r.to - r.from).toBeGreaterThan(zoomedRange.to - zoomedRange.from);
    }, { timeout: 3000 });

    // zoom in again, then a POLL arrives: last close moved + one new bar.
    ref.current.zoom(0.4);
    const rangeBeforePoll = api.chart.timeScale().getVisibleLogicalRange();
    const last = candles[candles.length - 1];
    const nextBar = { time: last.time + 86400, open: last.close, high: last.close + 3, low: last.close - 1, close: last.close + 2 };
    const polled = [...candles.slice(0, -1), { ...last, close: last.close + 1, high: Math.max(last.high, last.close + 1) }, nextBar];
    rerender(
      <div style={{ position: 'relative', width: 800, height: 400 }}>
        <ProChart ref={ref} dataKey="ethereum:7D" candles={polled} onReady={(a) => { api = a; }} onWindowStats={onWindowStats} />
      </div>
    );
    await waitFor(() => {
      const tail = api.main.dataByIndex(polled.length - 1);
      expect(tail?.close).toBe(nextBar.close);
    }, { timeout: 3000 });
    /* The view must NOT have been reset by the poll (no rebuild happened). */
    const rangeAfterPoll = api.chart.timeScale().getVisibleLogicalRange();
    expect(Math.abs(rangeAfterPoll.from - rangeBeforePoll.from)).toBeLessThan(2);

    // SPOT TICK: forming candle close follows, high widens, open untouched.
    const tickPrice = nextBar.close + 5;
    rerender(
      <div style={{ position: 'relative', width: 800, height: 400 }}>
        <ProChart ref={ref} dataKey="ethereum:7D" candles={polled} livePrice={tickPrice} onReady={(a) => { api = a; }} onWindowStats={onWindowStats} />
      </div>
    );
    await waitFor(() => {
      const tail = api.main.dataByIndex(polled.length - 1);
      expect(tail?.close).toBe(tickPrice);
      expect(tail?.high).toBe(tickPrice);
      expect(tail?.open).toBe(nextBar.open);
    }, { timeout: 3000 });

    // an absurd tick (wrong asset/currency) is refused, not drawn
    rerender(
      <div style={{ position: 'relative', width: 800, height: 400 }}>
        <ProChart ref={ref} dataKey="ethereum:7D" candles={polled} livePrice={nextBar.close * 3} onReady={(a) => { api = a; }} onWindowStats={onWindowStats} />
      </div>
    );
    const tail = api.main.dataByIndex(polled.length - 1);
    expect(tail?.close).toBe(tickPrice);
  });
});
