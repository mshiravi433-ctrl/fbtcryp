// @vitest-environment jsdom
/**
 * AI FORECAST in the token terminal — the toggle, the request, the badge.
 * -----------------------------------------------------------------------
 * What arithmetic cannot pin: that the projection is REQUESTED only from the
 * inline card OR open terminal with the toggle on, that the candles posted are the ones on
 * screen (feed milliseconds, not the chart's seconds), that the badge names
 * WHICH model answered — Kronos or the labelled baseline — and that a failure
 * says «در دسترس نیست» and draws NOTHING rather than inventing a future.
 *
 * The engine cannot mount here (jsdom, no canvas) — on purpose: the badge and
 * the note live in the component, not the canvas, so they must work in the
 * SVG-fallback path a stripped WebView depends on.
 */
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

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

vi.mock('lightweight-charts', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    createChart: () => {
      throw new Error('canvas unsupported in this environment');
    }
  };
});

/* postTokenForecast is the ONLY network call this feature makes — stub it so
   the tests drive the three answer shapes the server can return (kronos,
   baseline, failure) without a server. */
const postTokenForecast = vi.fn();
vi.mock('../src/lib/api', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    postTokenForecast: (...args) => postTokenForecast(...args)
  };
});

import TokenChart from '../src/components/ProChart/TokenChart.jsx';

const DAY = 86_400_000;
const candles = Array.from({ length: 80 }, (_, i) => {
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

function openTerminal() {
  fireEvent.click(screen.getByRole('button', { name: 'coin.pro.open' }));
  return screen.getByTestId('pro-chart-fullscreen');
}

const projection = (predLen) =>
  Array.from({ length: predLen }, (_, i) => ({
    t: candles[candles.length - 1].t + DAY * (i + 1),
    o: 130,
    h: 133,
    l: 128,
    c: 131,
    v: 12
  }));

beforeEach(() => {
  window.localStorage.clear();
  postTokenForecast.mockReset();
});

afterEach(() => cleanup());

describe('ai forecast', () => {
  it('starts OFF — a projection nobody asked for is compute nobody asked for', () => {
    mount();
    openTerminal();
    const chip = screen.getByRole('button', { name: 'coin.pro.forecast' });
    expect(chip.getAttribute('aria-pressed')).toBe('false');
    expect(postTokenForecast).not.toHaveBeenCalled();
    expect(screen.queryByTestId('forecast-badge')).toBeNull();
  });

  it('posts the ON-SCREEN candles in feed milliseconds with a clamped horizon', async () => {
    let answer;
    postTokenForecast.mockImplementation(() => new Promise((resolve) => { answer = resolve; }));
    mount();
    fireEvent.click(screen.getByRole('button', { name: 'coin.pro.forecast' }));

    await waitFor(() => expect(postTokenForecast).toHaveBeenCalledTimes(1));
    const [payload, opts] = postTokenForecast.mock.calls[0];
    /* ms stamps (the chart stores seconds), same bars in the same order */
    expect(payload).toHaveLength(80);
    expect(payload[0].t).toBe(candles[0].t);
    expect(payload[79].c).toBeCloseTo(candles[79].c);
    /* 80/8 = 10 → floored at the12-bar minimum the layout can read */
    expect(opts.predLen).toBe(12);

    answer({ ok: true, provider: 'kronos', model: 'NeoQuasar/Kronos-small', predLen: 12, candles: projection(12) });
    await waitFor(() => expect(screen.getByTestId('forecast-badge')).toBeTruthy());
  });

  it('names Kronos when the model answered', async () => {
    postTokenForecast.mockResolvedValue({
      ok: true,
      provider: 'kronos',
      model: 'NeoQuasar/Kronos-small',
      predLen: 12,
      candles: projection(12)
    });
    mount();
    fireEvent.click(screen.getByRole('button', { name: 'coin.pro.forecast' }));

    const badge = await screen.findByTestId('forecast-badge');
    expect(badge.textContent).toContain('coin.pro.forecastKronos');
    expect(badge.textContent).toContain('Kronos-small');
    /* The caveat rides with the projection, always on screen. */
    expect(badge.textContent).toContain('coin.pro.forecastDisclaimer');
    expect(badge.querySelector('.pc-fc-tag').className).toContain('is-model');
  });

  it('says BASELINE out loud when the worker could not answer', async () => {
    postTokenForecast.mockResolvedValue({
      ok: true,
      provider: 'baseline',
      model: 'drift-volatility baseline',
      predLen: 12,
      candles: projection(12),
      worker: { ok: false, error: 'ECONNREFUSED' }
    });
    mount();
    fireEvent.click(screen.getByRole('button', { name: 'coin.pro.forecast' }));

    const badge = await screen.findByTestId('forecast-badge');
    expect(badge.textContent).toContain('coin.pro.forecastBaseline');
    expect(badge.querySelector('.pc-fc-tag').className).not.toContain('is-model');
    expect(badge.textContent).toContain('coin.pro.forecastDisclaimer');
    expect(badge.textContent).toContain('coin.pro.forecastFallback');
  });

  it('a failed request says unavailable and draws NOTHING', async () => {
    postTokenForecast.mockRejectedValue(new Error('HTTP_500'));
    mount();
    fireEvent.click(screen.getByRole('button', { name: 'coin.pro.forecast' }));

    await screen.findByText('coin.pro.forecastUnavailable');
    expect(screen.queryByTestId('forecast-badge')).toBeNull();
  });

  it('switching the toggle off drops the projection and its request loop', async () => {
    postTokenForecast.mockResolvedValue({
      ok: true,
      provider: 'kronos',
      model: 'NeoQuasar/Kronos-small',
      predLen: 12,
      candles: projection(12)
    });
    mount();
    openTerminal();
    const chip = screen.getByRole('button', { name: 'coin.pro.forecast' });
    fireEvent.click(chip);
    await screen.findByTestId('forecast-badge');

    fireEvent.click(screen.getByRole('button', { name: 'coin.pro.forecast' }));
    await waitFor(() => expect(screen.queryByTestId('forecast-badge')).toBeNull());
    expect(screen.getByRole('button', { name: 'coin.pro.forecast' }).getAttribute('aria-pressed')).toBe('false');
  });
});


describe('forecast regressions', () => {
  it('draws the projection on the SVG fallback too', async () => {
    postTokenForecast.mockResolvedValue({ ok: true, provider: 'baseline', model: 'drift-volatility baseline', predLen: 12, candles: projection(12) });
    const { container } = mount();
    fireEvent.click(screen.getByRole('button', { name: 'coin.pro.forecast' }));
    await screen.findByTestId('forecast-badge');
    await waitFor(() => expect(container.querySelector('[data-forecast-bars="12"]')).toBeTruthy());
  });

  it('aborts an in-flight request when the asset changes and never paints the old answer', async () => {
    let resolveOld;
    postTokenForecast.mockImplementationOnce(() => new Promise((resolve) => { resolveOld = resolve; }));
    const { rerender } = mount();
    fireEvent.click(screen.getByRole('button', { name: 'coin.pro.forecast' }));
    await waitFor(() => expect(postTokenForecast).toHaveBeenCalledTimes(1));
    const oldSignal = postTokenForecast.mock.calls[0][1].signal;
    postTokenForecast.mockResolvedValueOnce({ ok: true, provider: 'kronos', model: 'Kronos-small', predLen: 12, candles: projection(12) });
    rerender(<TokenChart data={candles} symbol="BTC" coin={{ id: 'bitcoin', symbol: 'BTC', name: 'Bitcoin' }} coinId="bitcoin" range={RANGES[1]} ranges={RANGES} height={300} />);
    await waitFor(() => expect(oldSignal.aborted).toBe(true));
    resolveOld({ ok: true, provider: 'kronos', model: 'old', predLen: 12, candles: projection(12) });
    await screen.findByTestId('forecast-badge');
    expect(screen.getByTestId('forecast-badge').textContent).not.toContain('old');
  });

  it('retry is explicit and sends refresh only for the retried series', async () => {
    postTokenForecast.mockRejectedValueOnce(new Error('HTTP_503'));
    postTokenForecast.mockResolvedValue({ ok: true, provider: 'baseline', model: 'drift-volatility baseline', predLen: 12, candles: projection(12) });
    mount();
    fireEvent.click(screen.getByRole('button', { name: 'coin.pro.forecast' }));
    await screen.findByText('coin.pro.forecastUnavailable');
    fireEvent.click(screen.getByRole('button', { name: 'coin.pro.forecastRetry' }));
    await screen.findByTestId('forecast-badge');
    expect(postTokenForecast.mock.calls.at(-1)[1].refresh).toBe(true);
  });

  it('short history explains the minimum instead of posting a doomed request', async () => {
    mount({ data: candles.slice(0, 20) });
    fireEvent.click(screen.getByRole('button', { name: 'coin.pro.forecast' }));
    await screen.findByText('coin.pro.forecastShortHistory');
    expect(postTokenForecast).not.toHaveBeenCalled();
  });
});
