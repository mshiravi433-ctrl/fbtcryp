// @vitest-environment jsdom
/**
 * AI FORECAST in the token terminal — ON-DEVICE edition.
 * ------------------------------------------------------
 * What these tests pin, in the order a reader meets them:
 *
 *   1. the toggle starts OFF and starts nothing — no download, no inference;
 *   2. turning it on with no model on the device shows the SIZE and waits for
 *      a button press (the model is never fetched behind the reader's back);
 *   3. download → preparing → running → a badge that says the bars were
 *      computed ON THIS DEVICE, with the backend and the wall time;
 *   4. cancel really stops (the client is told to abort);
 *   5. an unsupported device / a corrupt file / a short history each have
 *      their own sentence, and none of them draws a projection;
 *   6. switching coin or range throws the old projection away — a late answer
 *      for BTC can never land on the ETH chart;
 *   7. deleting the model puts the reader back at the download prompt;
 *   8. nothing in this path calls the server API.
 *
 * The engine cannot mount here (jsdom, no canvas, no wasm worker) — on purpose:
 * the card and the notes live in the component, not the canvas, so they must
 * work in the SVG-fallback path a stripped WebView depends on. The real model
 * is exercised in test/kronos-local-model.test.mjs.
 */
import React from 'react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

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

/* The server API must never be reached from this feature any more. It stays
   exported for other screens, so the test asserts on the call, not the import. */
const postTokenForecast = vi.fn();
vi.mock('../src/lib/api', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    postTokenForecast: (...args) => postTokenForecast(...args)
  };
});

/* The on-device client is mocked at its own boundary: everything below it
   (worker, ORT, Cache Storage) is covered by test/kronos-local-*.test.mjs. */
const client = vi.hoisted(() => ({
  deviceSupport: vi.fn(),
  modelState: vi.fn(),
  downloadEstimate: vi.fn(),
  prepareModel: vi.fn(),
  runForecast: vi.fn(),
  abortForecast: vi.fn(),
  forgetModel: vi.fn()
}));

vi.mock('../src/lib/kronosLocal/client.js', () => client);

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

const READY_MODEL = { state: 'ready', totalBytes: 33_400_000 };

const forecastResult = (predLen = 12) => ({
  provider: 'kronos-local',
  model: 'NeoQuasar/Kronos-mini',
  backend: 'webgpu',
  intervalMs: DAY,
  repaired: 0,
  options: { window: 80, horizon: predLen },
  timing: { totalMs: 812, generateMs: 120 },
  candles: Array.from({ length: predLen }, (_, i) => ({
    t: candles[candles.length - 1].t + DAY * (i + 1),
    o: 130, h: 133, l: 128, c: 131, v: 12
  }))
});

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

beforeEach(() => {
  window.localStorage.clear();
  postTokenForecast.mockReset();
  client.deviceSupport.mockReset().mockReturnValue({
    ok: true, reasons: [], telegram: false, ios: false, memory: 8, webgpuLikely: true
  });
  client.modelState.mockReset().mockResolvedValue(READY_MODEL);
  client.downloadEstimate.mockReset().mockResolvedValue({
    modelBytes: 33_400_000, runtimeBytes: 23_600_000, totalBytes: 57_000_000, webgpu: true
  });
  client.prepareModel.mockReset().mockImplementation(async ({ onPhase, onProgress } = {}) => {
    onPhase?.('engine');
    onProgress?.({ loaded: 1, total: 1, percent: 100 });
    return { backend: 'webgpu', bytes: 33_400_000 };
  });
  client.runForecast.mockReset().mockResolvedValue(forecastResult(12));
  client.abortForecast.mockReset();
  client.forgetModel.mockReset().mockResolvedValue(undefined);
});

afterEach(() => cleanup());

describe('on-device forecast', () => {
  it('starts OFF — nothing downloaded, nothing computed, no server call', () => {
    mount();
    openTerminal();
    const chip = screen.getByRole('button', { name: 'coin.pro.forecast' });
    expect(chip.getAttribute('aria-pressed')).toBe('false');
    expect(client.prepareModel).not.toHaveBeenCalled();
    expect(client.runForecast).not.toHaveBeenCalled();
    expect(postTokenForecast).not.toHaveBeenCalled();
    expect(screen.queryByTestId('forecast-badge')).toBeNull();
  });

  it('shows the download size and waits for a press when the model is absent', async () => {
    client.modelState.mockResolvedValue({ state: 'absent' });
    mount();
    fireEvent.click(screen.getByRole('button', { name: 'coin.pro.forecast' }));

    const prompt = await screen.findByTestId('forecast-download');
    expect(prompt.textContent).toContain('coin.pro.forecastLocalTag');
    expect(prompt.textContent).toContain('coin.pro.forecastDownloadSize');
    expect(screen.getByTestId('forecast-download-size').textContent).toContain('coin.pro.forecastDownloadSize');
    /* Size is on screen BEFORE anything is fetched. */
    expect(client.prepareModel).not.toHaveBeenCalled();
    expect(client.runForecast).not.toHaveBeenCalled();
  });

  it('download → compute → badge that says the bars were made on this device', async () => {
    client.modelState.mockResolvedValue({ state: 'absent' });
    mount();
    fireEvent.click(screen.getByRole('button', { name: 'coin.pro.forecast' }));
    await screen.findByTestId('forecast-download');

    fireEvent.click(screen.getByTestId('forecast-download-start'));

    const badge = await screen.findByTestId('forecast-badge');
    expect(client.prepareModel).toHaveBeenCalledTimes(1);
    expect(client.runForecast).toHaveBeenCalledTimes(1);
    expect(badge.textContent).toContain('coin.pro.forecastKronos');
    expect(badge.textContent).toContain('coin.pro.forecastLocalTag');
    expect(badge.textContent).toContain('Kronos-mini');
    expect(badge.textContent).toContain('coin.pro.forecastDisclaimer');
    expect(screen.getByTestId('forecast-meta').textContent).toContain('WEBGPU');
    expect(postTokenForecast).not.toHaveBeenCalled();
  });

  it('posts the ON-SCREEN candles to the local engine, in feed milliseconds', async () => {
    mount();
    fireEvent.click(screen.getByRole('button', { name: 'coin.pro.forecast' }));
    await screen.findByTestId('forecast-badge');

    const [payload, opts] = client.runForecast.mock.calls[0];
    expect(payload).toHaveLength(80);
    expect(payload[0].t).toBe(candles[0].t);
    expect(payload[79].c).toBeCloseTo(candles[79].c);
    expect(payload[0]).toHaveProperty('v');
    expect(opts.horizon).toBe(12);
  });

  it('cancel during download stops the work and changes nothing else', async () => {
    client.modelState.mockResolvedValue({ state: 'absent' });
    client.prepareModel.mockImplementation(({ onProgress }) => {
      onProgress?.({ loaded: 10, total: 100, percent: 10 });
      return new Promise(() => {}); // never settles: the reader pressed Stop
    });
    mount();
    fireEvent.click(screen.getByRole('button', { name: 'coin.pro.forecast' }));
    await screen.findByTestId('forecast-download');
    fireEvent.click(screen.getByTestId('forecast-download-start'));
    const progress = await screen.findByTestId('forecast-progress');
    expect(progress.textContent).toContain('coin.pro.forecastDownloadProgress');

    fireEvent.click(screen.getByTestId('forecast-cancel'));
    await waitFor(() => expect(client.abortForecast).toHaveBeenCalled());
    expect(screen.queryByTestId('forecast-badge')).toBeNull();
  });

  it('an unsupported browser gets a sentence, not a projection', async () => {
    client.deviceSupport.mockReturnValue({ ok: false, reasons: ['NO_WASM'], telegram: false, memory: 0 });
    mount();
    fireEvent.click(screen.getByRole('button', { name: 'coin.pro.forecast' }));
    const box = await screen.findByTestId('forecast-error');
    expect(box.textContent).toContain('coin.pro.forecastUnsupported');
    expect(client.runForecast).not.toHaveBeenCalled();
    expect(screen.queryByTestId('forecast-badge')).toBeNull();
  });

  it('a corrupt model file is reported and retryable', async () => {
    client.modelState.mockResolvedValue({ state: 'absent' });
    client.prepareModel.mockRejectedValue(Object.assign(new Error('MODEL_FILE_CORRUPT'), { code: 'MODEL_FILE_CORRUPT' }));
    mount();
    fireEvent.click(screen.getByRole('button', { name: 'coin.pro.forecast' }));
    await screen.findByTestId('forecast-download');
    fireEvent.click(screen.getByTestId('forecast-download-start'));

    const box = await screen.findByTestId('forecast-error');
    expect(box.textContent).toContain('coin.pro.forecastCorrupt');
    expect(screen.getByTestId('forecast-retry')).toBeTruthy();
    expect(screen.queryByTestId('forecast-badge')).toBeNull();
  });

  it('short history is refused before the engine is even asked', async () => {
    mount({ data: candles.slice(0, 20) });
    fireEvent.click(screen.getByRole('button', { name: 'coin.pro.forecast' }));
    await screen.findByText('coin.pro.forecastShortHistory');
    expect(client.runForecast).not.toHaveBeenCalled();
  });

  it('switching the range drops the old projection instead of repainting it', async () => {
    const { rerender } = mount();
    fireEvent.click(screen.getByRole('button', { name: 'coin.pro.forecast' }));
    await screen.findByTestId('forecast-badge');

    rerender(
      <TokenChart
        data={candles}
        symbol="ETH"
        coin={{ id: 'ethereum', symbol: 'ETH', name: 'Ethereum' }}
        coinId="ethereum"
        range={RANGES[2]}
        ranges={RANGES}
        height={300}
      />
    );
    await waitFor(() => expect(screen.queryByTestId('forecast-badge')).toBeNull());
    await waitFor(() => expect(client.runForecast).toHaveBeenCalledTimes(2));
    const firstToken = client.runForecast.mock.results[0];
    expect(firstToken).toBeTruthy();
  });

  it('switching the coin never shows the previous coin bars', async () => {
    const { rerender } = mount();
    fireEvent.click(screen.getByRole('button', { name: 'coin.pro.forecast' }));
    await screen.findByTestId('forecast-badge');

    client.runForecast.mockImplementation(() => new Promise(() => {}));
    rerender(
      <TokenChart
        data={candles}
        symbol="BTC"
        coin={{ id: 'bitcoin', symbol: 'BTC', name: 'Bitcoin' }}
        coinId="bitcoin"
        range={RANGES[1]}
        ranges={RANGES}
        height={300}
      />
    );
    await waitFor(() => expect(screen.queryByTestId('forecast-badge')).toBeNull());
    expect(client.abortForecast).toHaveBeenCalled();
  });

  it('deleting the model returns to the download prompt', async () => {
    mount();
    fireEvent.click(screen.getByRole('button', { name: 'coin.pro.forecast' }));
    await screen.findByTestId('forecast-badge');

    client.modelState.mockResolvedValue({ state: 'absent' });
    fireEvent.click(screen.getByTestId('forecast-delete'));
    await waitFor(() => expect(client.forgetModel).toHaveBeenCalled());
    await screen.findByTestId('forecast-download');
    expect(screen.queryByTestId('forecast-badge')).toBeNull();
  });

  it('toggling OFF drops the projection', async () => {
    mount();
    openTerminal();
    fireEvent.click(screen.getByRole('button', { name: 'coin.pro.forecast' }));
    await screen.findByTestId('forecast-badge');

    fireEvent.click(screen.getAllByRole('button', { name: 'coin.pro.forecast' })[0]);
    await waitFor(() => expect(screen.queryByTestId('forecast-badge')).toBeNull());
    expect(client.abortForecast).toHaveBeenCalled();
  });

  it('an enveloped worker reply still paints the badge instead of crashing the page', async () => {
    /* THE reported crash («این صفحه به مشکل خورد» right after the download
       finished, then again on every re-entry): the worker posts
       `{type:'result', id, result}` and the client used to resolve the whole
       envelope, so `forecast.candles` was undefined and rendering the badge
       threw on `forecast.candles.length`. The client unwraps now; the chart
       must ALSO survive the envelope on its own. */
    client.runForecast.mockResolvedValue({ type: 'result', id: 'job-1', result: forecastResult(12) });
    mount();
    fireEvent.click(screen.getByRole('button', { name: 'coin.pro.forecast' }));

    const badge = await screen.findByTestId('forecast-badge');
    expect(badge.textContent).toContain('Kronos-mini');
    expect(screen.getByTestId('forecast-meta').textContent).toContain('WEBGPU');
    /* The page around the panel is alive: the toggle still works. */
    expect(screen.getByRole('button', { name: 'coin.pro.forecast' })).toBeTruthy();
  });

  it('a reply with no candles anywhere becomes an error panel, never a crash', async () => {
    client.runForecast.mockResolvedValue({ type: 'result', id: 'job-1', result: { provider: 'kronos-local' } });
    mount();
    fireEvent.click(screen.getByRole('button', { name: 'coin.pro.forecast' }));

    const box = await screen.findByTestId('forecast-error');
    expect(box.textContent).toContain('coin.pro.forecastInvalidOutput');
    expect(screen.getByTestId('forecast-retry')).toBeTruthy();
    expect(screen.queryByTestId('forecast-badge')).toBeNull();
    /* The chart itself never went down with the forecast. */
    expect(screen.getByRole('button', { name: 'coin.pro.forecast' })).toBeTruthy();
  });

  it('warns a Telegram in-app browser that it is limited', async () => {
    client.deviceSupport.mockReturnValue({
      ok: true, reasons: [], telegram: true, ios: true, memory: 4, webgpuLikely: false
    });
    client.modelState.mockResolvedValue({ state: 'absent' });
    mount();
    fireEvent.click(screen.getByRole('button', { name: 'coin.pro.forecast' }));
    await screen.findByTestId('forecast-download');
    expect(screen.getByTestId('forecast-telegram').textContent).toContain('coin.pro.forecastTelegram');
  });

  /* The card's modern anatomy is a contract, not just decoration: compact
     retry/delete actions keep accessible names in every layout. */
  it('the ready card has small, named retry/delete pills', async () => {
    mount();
    fireEvent.click(screen.getByRole('button', { name: 'coin.pro.forecast' }));
    const badge = await screen.findByTestId('forecast-badge');

    expect(badge.classList.contains('pc-fc--ambient')).toBe(true);
    expect(badge.querySelector('.pc-fc-mark svg')).toBeTruthy();

    const refresh = screen.getByTestId('forecast-refresh');
    const remove = screen.getByTestId('forecast-delete');
    for (const button of [refresh, remove]) {
      expect(button.classList.contains('pc-fc-btn')).toBe(true);
      expect(button.getAttribute('aria-label')).toBeTruthy();
      expect(button.getAttribute('title')).toBe(button.getAttribute('aria-label'));
      expect(button.querySelector('.pc-fc-btn-ico svg')).toBeTruthy();
      expect(button.querySelector('.pc-fc-btn-label')?.textContent).toBeTruthy();
    }
    expect(remove.getAttribute('aria-label')).toBe('coin.pro.forecastDelete');
    expect(remove.classList.contains('pc-fc-btn--danger')).toBe(true);
    expect(refresh.getAttribute('aria-label')).toBe('coin.pro.forecastRetry');
    /* The header mark is shared by the setup states too. */
    expect(badge.querySelector('.pc-fc-head .pc-fc-title')).toBeTruthy();
  });

  it('the download prompt stays fully opaque — only a RESULT fades', async () => {
    client.modelState.mockResolvedValue({ state: 'absent' });
    mount();
    fireEvent.click(screen.getByRole('button', { name: 'coin.pro.forecast' }));
    const prompt = await screen.findByTestId('forecast-download');
    expect(prompt.classList.contains('pc-fc--ambient')).toBe(false);
    expect(prompt.querySelector('.pc-fc-btn--primary')).toBeTruthy();
    expect(prompt.querySelector('.pc-fc-mark svg')).toBeTruthy();
  });

  it('an error stays fully opaque and its retry keeps its accessible name', async () => {
    client.runForecast.mockRejectedValue(Object.assign(new Error('BUSY'), { code: 'BUSY' }));
    mount();
    fireEvent.click(screen.getByRole('button', { name: 'coin.pro.forecast' }));
    const error = await screen.findByTestId('forecast-error');
    expect(error.classList.contains('pc-fc--ambient')).toBe(false);
    expect(screen.getByTestId('forecast-retry').getAttribute('aria-label')).toBe('coin.pro.forecastRetry');
  });

  /*
   * THE REGRESSION THIS TEST EXISTS FOR
   * -----------------------------------
   * Opening the terminal on a phone (short landscape) used to DELETE the
   * feature: the toolbar chip, the horizon select, the result card, the
   * projected candles, and the run itself. Rotating back restored the chip
   * SWITCHED OFF. The reader's report was one sentence — «دکمش را محو کردی،
   * برگردون» — and the honest fix is not "look harder for it": it is that the
   * control never leaves, in either orientation, and only the CARD adapts.
   */
  it('the AI control exists in the token page AND the terminal, and orientation never deletes it', async () => {
    const originalMatchMedia = window.matchMedia;
    const listeners = new Set();
    let landscape = false;
    window.matchMedia = vi.fn((query) => ({
      media: query,
      get matches() { return query.includes('landscape') ? landscape : true; },
      addEventListener: (_type, listener) => { if (query.includes('landscape')) listeners.add(listener); },
      removeEventListener: (_type, listener) => { if (query.includes('landscape')) listeners.delete(listener); }
    }));
    const viewport = (width, height) => {
      Object.defineProperty(window, 'innerWidth', { configurable: true, value: width });
      Object.defineProperty(window, 'innerHeight', { configurable: true, value: height });
    };
    try {
      /* Room 1: the token page, before the terminal is opened. */
      viewport(390, 844);
      mount();
      expect(screen.getByTestId('forecast-toggle')).toBeTruthy();
      expect(screen.getByRole('button', { name: 'coin.pro.forecast' })).toBeTruthy();

      /* Room 1 leaves the DOM when room 2 arrives — exactly one live toggle,
         and the token page's copy of the card does not linger behind the
         terminal (no second `forecast-badge`). */
      openTerminal();
      expect(screen.getAllByTestId('forecast-toggle')).toHaveLength(1);

      fireEvent.click(screen.getByTestId('forecast-toggle'));
      await screen.findByTestId('forecast-badge');
      /* The mount-time "nothing is on" effect aborts once; from here on, an
         abort can only come from a rotation deleting the run — the bug. */
      client.abortForecast.mockClear();

      /* Rotate into the short landscape the old code treated as "no forecast
         here". Everything stays: the chip, the horizon control, the card and
         the projection the reader paid for. */
      await act(async () => {
        viewport(844, 390);
        landscape = true;
        listeners.forEach((listener) => listener({ matches: true }));
        window.dispatchEvent(new Event('resize'));
      });
      expect(screen.getByTestId('forecast-toggle').getAttribute('aria-pressed')).toBe('true');
      expect(screen.getByLabelText('coin.pro.forecastHorizon')).toBeTruthy();
      expect(screen.getByTestId('forecast-badge')).toBeTruthy();
      expect(client.abortForecast).not.toHaveBeenCalled();

      /* Short viewports start the CARD collapsed: two lines, one chevron. */
      const badge = screen.getByTestId('forecast-badge');
      expect(badge.classList.contains('pc-fc--peek')).toBe(true);
      expect(screen.getByTestId('forecast-collapse').getAttribute('aria-label')).toBe('coin.pro.forecastExpand');

      /* The chevron opens the whole card… */
      fireEvent.click(screen.getByTestId('forecast-collapse'));
      expect(screen.getByTestId('forecast-badge').classList.contains('pc-fc--peek')).toBe(false);
      expect(screen.getByTestId('forecast-collapse').getAttribute('aria-label')).toBe('coin.pro.forecastPeek');
      /* …and it can put it away again — the HUD never covers its own switch. */
      fireEvent.click(screen.getByTestId('forecast-collapse'));
      expect(screen.getByTestId('forecast-badge').classList.contains('pc-fc--peek')).toBe(true);

      /* Back to portrait: the control is still there and still ON. */
      await act(async () => {
        viewport(390, 844);
        landscape = false;
        listeners.forEach((listener) => listener({ matches: false }));
        window.dispatchEvent(new Event('resize'));
      });
      expect(screen.getByTestId('forecast-toggle').getAttribute('aria-pressed')).toBe('true');
      expect(screen.getByTestId('forecast-badge')).toBeTruthy();
      expect(screen.getByTestId('forecast-badge').classList.contains('pc-fc--peek')).toBe(false);
      expect(client.abortForecast).not.toHaveBeenCalled();
    } finally {
      window.matchMedia = originalMatchMedia;
      viewport(1024, 768);
    }
  });
});

/*
 * The two-room rule is both a React and a CSS contract. The behavioural test
 * above proves the control survives rotation; these pins prevent a future
 * stylesheet or effect from deleting it again, and keep the card out of the
 * terminal's vertical column (the "it overlaps the buttons" half of the
 * report was the card being a flex sibling of the chart).
 */
describe('forecast — two-room, never-hidden contract', () => {
  const css = readFileSync(join(process.cwd(), 'src/styles/pro-chart.css'), 'utf8');
  const source = readFileSync(join(process.cwd(), 'src/components/ProChart/TokenChart.jsx'), 'utf8');
  const cssWithoutComments = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const shortLandscapeBlock = (() => {
    const at = css.indexOf('@media (orientation: landscape) and (max-height: 640px)');
    return at === -1 ? '' : css.slice(at, css.indexOf('\n}\n', at) + 3);
  })();

  it('never hides the AI group or the card in any orientation', () => {
    expect(shortLandscapeBlock.length).toBeGreaterThan(100);
    /* The old rule was literally `display: none` on the chip and the card. */
    expect(cssWithoutComments).not.toMatch(/\.pc-toolgroup--forecast[^{]*\{[^}]*display:\s*none/);
    expect(cssWithoutComments).not.toMatch(/\.pc-fs-main\s*>\s*\.pc-fc[^{]*\{[^}]*display:\s*none/);
  });

  it('keeps the card in the flow, capped and peeked — never floating over the chart', () => {
    /* The overlap report was an absolutely-positioned card. The card is a
       flow row now; the room is found by shrinking it, not by floating it. */
    expect(source).toContain('{forecastPanel ? <div className="pc-fs-hud">{forecastPanel}</div> : null}');
    expect(/\.pc-fs-hud \{[\s\S]*?display:\s*flex;\s*\n\s*flex:\s*0 0 auto;/.test(css)).toBe(true);
    expect(css).not.toMatch(/\.pc-fs-hud \{[^}]*position:\s*(absolute|fixed)/);
    /* A card taller than its own column is a card whose buttons are off-screen. */
    expect(/\.pc-fs-hud > \.pc-fc \{[\s\S]*?max-height:\s*min\(40svh/.test(css)).toBe(true);
    /* Short viewports collapse to the two-line peek — that is where the six
       rows went, instead of a `display: none` on the feature. */
    expect(/\.pc-fc--peek \.pc-fc-summary > span:not\(:first-child\)/.test(css)).toBe(true);
    expect(/\.pc-fc--peek \.pc-fc-disc,/.test(css)).toBe(true);
    /* Nothing is ever faded to "unpressable". */
    expect(cssWithoutComments).not.toMatch(/\.pc-fc--ambient[^{]*\{[^}]*pointer-events:\s*none/);
    expect(/backdrop-filter/.test(cssWithoutComments)).toBe(false);
  });

  it('lets the reader open the peek and put it away again', () => {
    expect(source).toContain("data-testid=\"forecast-collapse\"");
    expect(source).toMatch(/collapseLabel: t\(collapsed \? 'coin\.pro\.forecastExpand' : 'coin\.pro\.forecastPeek'\)/);
    /* Both strings exist in every shipped language (gen-locales.mjs writes the
       nine partial files from the same module). */
    for (const lang of ['en', 'fa']) {
      const dict = JSON.parse(readFileSync(join(process.cwd(), `src/i18n/locales/${lang}.json`), 'utf8'));
      expect(dict.coin.pro.forecastExpand, `${lang} forecastExpand`).toBeTruthy();
      expect(dict.coin.pro.forecastPeek, `${lang} forecastPeek`).toBeTruthy();
    }
  });

  it('never turns the forecast off because the screen changed shape', () => {
    expect(source).not.toContain('forecastLandscapeDisabled');
    expect(source).not.toMatch(/setForecastOn\(false\)[\s\S]{0,200}setShortViewport/);
    /* The projection is gated on the reader's choice alone. */
    expect(source).toMatch(/const forecast = forecastOn && Array\.isArray\(forecastData\?\.candles\)/);
  });

  it('keeps exactly one toggle and one card on screen at a time', () => {
    expect(source).toMatch(/\{!expanded \? <Chip active=\{forecastOn\}/);
    expect(source).toMatch(/\{!expanded \? buildForecastPanel\(inlinePeekClass\) : null\}/);
    expect(source).toMatch(/<div className="pc-toolgroup pc-toolgroup--forecast">/);
  });

  it('keeps the live canvas blur-free and the small actions touch-friendly elsewhere', () => {
    expect(/\.pc-fc-btn \{[\s\S]*?min-height: 28px/.test(css)).toBe(true);
    expect(/@media \(pointer: coarse\)[\s\S]*?\.pc-fc-btn::after/.test(css)).toBe(true);
    expect(/@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.pc-fs \.pc-fs-main > \.pc-fc \{ transition: none/.test(css)).toBe(true);
  });
});
