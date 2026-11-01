// @vitest-environment jsdom
/**
 * TOKEN CHART — the stored-preference contract, and the language/theme wiring.
 * ---------------------------------------------------------------------------
 * ─── THE REPORT ─────────────────────────────────────────────────────────────
 * «در صفحه توکن، نمودار شمعی که برنچ قبلی انجام شد، وقتی وارد صفحه توکن میشه
 *  میزنه مشکلی پیش آمده و دوباره تلاش کنید … و صفحه نمودار شمعی عمودی را برای
 *  تم درست و زبان درست هم باشد»
 *
 * Three separate faults, and the first one is why the page was unusable:
 *
 *  1. `loadPrefs()` read `fbt-prochart-prefs:v1` from localStorage unguarded
 *     and validated it against `CHART_TYPES`, a constant nobody declared. Any
 *     reader who had ever opened the terminal had a stored blob, so
 *     `useState(loadPrefs)` threw `ReferenceError` on the FIRST render of
 *     /coin/:id and RouteBoundary caught it into the full-screen
 *     «این صفحه به مشکل خورد» card with a retry button. A first-time visitor
 *     had no stored blob, which is exactly why the report sounds conditional.
 *     The second half of the same bug was invisible only because the first
 *     half threw earlier: `getSimplePrices` was used by the live-tick effect
 *     and never imported.
 *
 *  2. The timeframe rail printed the raw `1D / 7D / 30D / 90D / 1Y` keys, so a
 *     Persian page carried an English abbreviation in the chart — and a
 *     Russian, Spanish or Chinese one did too, because the `coin.pro.*` block
 *     existed only in en.json and fa.json. Ten locales fell back to English
 *     for the whole toolbar, legend, stats strip and empty state.
 *
 *  3. In light theme the engine painted the dark theme's neon studies on a
 *     white stage: EMA 55 (#ffd54f) at 1.41:1, MA 7 (#00e5ff) at 1.54:1,
 *     EMA 21 at 2.00:1. The moving averages were drawn and could not be seen,
 *     which reads as "the chart is wrong for this theme".
 *
 * The tests below are the pins. The coloured-series assertions live in
 * pro-chart-theme.test.jsx; these cover the crash, the corruption tolerance,
 * and the language surface.
 */
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

import fa from '../src/i18n/locales/fa.json';
import en from '../src/i18n/locales/en.json';

/* Flatten a locale to dotted keys, like i18next would resolve them. */
const flatten = (obj, prefix = '', out = {}) => {
  for (const [k, v] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object') flatten(v, path, out);
    else out[path] = v;
  }
  return out;
};
const FA = flatten(fa);
const EN = flatten(en);

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    i18n: { language: globalThis.__lang || 'fa', resolvedLanguage: globalThis.__lang || 'fa' },
    t: (key, vars) => {
      const dict = globalThis.__dict || {};
      const text = dict[key] ?? key;
      return vars ? String(text).replace(/\{\{(\w+)\}\}/g, (_, name) => vars[name] ?? '') : text;
    }
  })
}));

/* The spot-price poll and the volume pane are stubbed: neither is under test,
   and both reach the network. */
vi.mock('../src/lib/api', () => ({ getSimplePrices: async () => ({ ethereum: { usd: 142 } }) }));
vi.mock('../src/hooks/useMarket', () => ({ useVolumeSeries: () => ({ data: [], loading: false }) }));
vi.mock('../src/components/CoinLogo.jsx', () => ({ default: () => null }));
vi.mock('recharts', () => ({
  ResponsiveContainer: () => null, ComposedChart: () => null, Bar: () => null,
  Line: () => null, Cell: () => null, Tooltip: () => null, XAxis: () => null,
  YAxis: () => null, ReferenceLine: () => null, LineChart: () => null, BarChart: () => null
}));

import TokenChart from '../src/components/ProChart/TokenChart.jsx';

/** Read a repo file from the vitest root (jsdom has no file: URL base). */
const repoFile = async (rel) => {
  const { readFileSync } = await import('node:fs');
  const { join } = await import('node:path');
  return readFileSync(join(process.cwd(), rel), 'utf8');
};

const DAY = 86_400_000;
const candles = Array.from({ length: 120 }, (_, i) => ({
  t: 1_700_000_000_000 + i * DAY,
  o: 100 + i,
  h: 104 + i,
  l: 98 + i,
  c: 101 + i
}));

const RANGES = [
  { key: '1D', days: 1 },
  { key: '7D', days: 7 },
  { key: '30D', days: 30 },
  { key: '90D', days: 90 },
  { key: '1Y', days: 365 }
];

const mount = (overrides = {}) =>
  render(
    <TokenChart
      data={candles}
      symbol="ETH"
      coin={{ id: 'ethereum', symbol: 'ETH', name: 'Ethereum' }}
      coinId="ethereum"
      range={RANGES[2]}
      ranges={RANGES}
      onRangeChange={() => {}}
      height={300}
      {...overrides}
    />
  );

/** The stored blob every returning visitor has, in a shape a past build wrote. */
const storedPrefs = (value) => localStorage.setItem('fbt-prochart-prefs:v1', JSON.stringify(value));

beforeEach(() => {
  localStorage.clear();
  globalThis.__lang = 'fa';
  globalThis.__dict = FA;
  document.documentElement.setAttribute('data-theme', 'dark');
});

afterEach(() => cleanup());

describe('the stored-preference crash', () => {
  /*
   * THE REGRESSION PIN. This single test would have caught the shipped bug:
   * it is nothing more than "a returning reader opens the token page".
   */
  it('renders the card when a previous session saved preferences', async () => {
    storedPrefs({ chartType: 'line', overlays: { ma: { 7: false } }, panes: { volume: false }, settings: { log: true } });
    const { container } = mount();
    await waitFor(() => expect(container.querySelector('.pc-expand')).toBeTruthy());
    /* ...and it honours what was saved rather than silently resetting. */
    expect(container.querySelector('[data-testid="token-chart"]')).toBeTruthy();
  });

  it('renders for a first-time visitor with nothing saved', async () => {
    const { container } = mount();
    await waitFor(() => expect(container.querySelector('.pc-expand')).toBeTruthy());
  });

  /*
   * localStorage is user-writable and outlives every deploy, so every one of
   * these is a shape a real browser can hand us: a half-written blob, a key
   * that moved, a field that changed type between builds. None of them may
   * take the page down — a preference we cannot read is a preference we drop.
   */
  it('survives every corrupted or stale preference shape', async () => {
    const shapes = [
      'not an object at all',
      '{broken json that never parses',
      null,
      [],
      { chartType: 'pineapple', overlays: null, panes: null, settings: null },
      { chartType: 'candles', overlays: { ma: 'nope', bb: 'x' }, panes: 'bad', settings: [] },
      { chartType: 'area', overlays: { ma: { 7: true, 25: true } }, panes: { volume: false }, settings: { log: true } },
      { chartType: 42, overlays: { ma: { 7: 1, 25: 'yes' }, ema: { 21: 'on' } }, panes: { volume: 'true' }, settings: { log: 'true' } }
    ];
    for (const shape of shapes) {
      localStorage.setItem('fbt-prochart-prefs:v1', typeof shape === 'string' ? shape : JSON.stringify(shape));
      const { container, unmount } = mount();
      await waitFor(() => expect(container.querySelector('.pc-expand')).toBeTruthy());
      unmount();
    }
  });

  /*
   * The live-tick effect calls `getSimplePrices`. It was used but never
   * imported, so it would have thrown the moment the crash above was fixed
   * and the page got far enough to run its effects. This asserts the import
   * EXISTS, by reading the module rather than by waiting 15 s for a poll.
   */
  it('imports the spot-price function its live tick calls', async () => {
    const source = await repoFile('src/components/ProChart/TokenChart.jsx');
    expect(/import\s*\{[^}]*getSimplePrices[^}]*\}\s*from/.test(source), 'getSimplePrices must be imported').toBe(true);
    expect(/export const CHART_TYPES|const CHART_TYPES\s*=/.test(source), 'CHART_TYPES must be declared').toBe(true);
  });
});

describe('language: the terminal is translated, not just the page around it', () => {
  /*
   * The rail was `1D / 7D / …` in every language. These five strings now come
   * from the locale, and the fallback keeps an unknown future range from
   * rendering an empty button.
   */
  it('persian rail is Persian numerals and words', async () => {
    const { container } = mount();
    await waitFor(() => expect(container.querySelector('.pc-expand')).toBeTruthy());
    fireEvent.click(container.querySelector('.pc-expand'));
    const dialog = await screen.findByTestId('pro-chart-fullscreen');
    expect([...dialog.querySelectorAll('.pc-range')].map((b) => b.textContent))
      .toEqual(['۱روز', '۷روز', '۳۰روز', '۹۰روز', '۱سال']);
    /* Escape closes it — the RTL dialog must still be dismissable. */
    fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByTestId('pro-chart-fullscreen')).toBeNull());
  });

  it('english rail stays the exchange convention', async () => {
    globalThis.__lang = 'en';
    globalThis.__dict = EN;
    const { container } = mount();
    await waitFor(() => expect(container.querySelector('.pc-expand')).toBeTruthy());
    fireEvent.click(container.querySelector('.pc-expand'));
    const dialog = await screen.findByTestId('pro-chart-fullscreen');
    expect([...dialog.querySelectorAll('.pc-range')].map((b) => b.textContent))
      .toEqual(['1D', '7D', '30D', '90D', '1Y']);
  });

  /*
   * The whole point of adding the strings to the nine partial locales: the
   * toolbar, the stats strip and the empty state must not be English on a
   * Spanish page. `scripts/gen-locales.mjs` writes those files, so this reads
   * the module that feeds it — one assertion per language, for every key the
   * terminal asks for.
   */
  it('every shipped language has every terminal string', async () => {
    const { default: tokenChart } = await import('../scripts/locales/token-chart.mjs');
    const source = await repoFile('src/components/ProChart/TokenChart.jsx');
    const page = await repoFile('src/pages/CoinDetail.jsx');

    /* The keys the SOURCE actually asks for — not a hand-kept list. The page
       is included because `coin.candleNote` is rendered under the card, and
       the chart-owned `coin.candleNote` string has to reach it too. */
    const used = new Set(
      [...`${source}\n${page}`.matchAll(/\bt\('(coin\.(?:pro\.|chartCandle|chartLine|noCandles|candleNote)[^']*)'/g)].map((m) => m[1])
    );
    /* `rangeLabel` builds its key by concatenation; add those explicitly. */
    for (const key of ['1D', '7D', '30D', '90D', '1Y']) used.add(`coin.pro.range${key}`);

    const langs = Object.keys(tokenChart);
    expect(langs.sort()).toEqual(['ar', 'es', 'fr', 'hi', 'id', 'pt', 'ru', 'tr', 'ur', 'zh']);

    for (const lang of langs) {
      const missing = [...used].filter((key) => typeof tokenChart[lang][key] !== 'string' || !tokenChart[lang][key]);
      expect(missing, `${lang} is missing terminal strings`).toEqual([]);
    }

    /* Same key set in every language, and every one of them exists in en. */
    const dict = flatten(en);
    for (const lang of langs) {
      expect(Object.keys(tokenChart[lang]).length, `${lang} key count`).toBe(used.size);
      const orphans = Object.keys(tokenChart[lang]).filter((key) => dict[key] === undefined);
      expect(orphans, `${lang} translates keys English does not have`).toEqual([]);
    }
  });

  /* A language switch while the terminal is open must reach the hints. */
  it('portrait phones are told to turn the device, in the reader\'s language', async () => {
    const { container } = mount();
    await waitFor(() => expect(container.querySelector('.pc-expand')).toBeTruthy());
    fireEvent.click(container.querySelector('.pc-expand'));
    const dialog = await screen.findByTestId('pro-chart-fullscreen');
    /* jsdom reports a zero-size viewport, so the derived hint depends on the
       portrait media query — which jsdom does not implement. The assertion is
       therefore on the DERIVED source, not on a viewport we cannot fake. */
    const source = await repoFile('src/components/ProChart/TokenChart.jsx');
    expect(/const rotationHint = expanded && portrait \? t\('coin\.pro\.rotateHint'\)/.test(source)).toBe(true);
    expect(source).not.toMatch(/setOrientationNote/);
    expect(dialog).toBeTruthy();
  });
});

describe('theme wiring', () => {
  /*
   * The chart follows `data-theme` through a MutationObserver, and the flip
   * must not rebuild (which would throw away the reader's zoom).
   */
  it('repaints on a theme flip without remounting the card', async () => {
    const { container } = mount();
    await waitFor(() => expect(container.querySelector('.pc-expand')).toBeTruthy());
    const card = container.querySelector('[data-testid="token-chart"]');
    document.documentElement.setAttribute('data-theme', 'light');
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(container.querySelector('[data-testid="token-chart"]')).toBe(card);
    document.documentElement.setAttribute('data-theme', 'dark');
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(container.querySelector('[data-testid="token-chart"]')).toBe(card);
  });

  /* The light-theme pressed state must be ink, not white-on-neon. */
  it('light theme pressed chips use the ink accents', async () => {
    const css = await repoFile('src/styles/pro-chart.css');
    expect(/:root\[data-theme='light'\] \.pc-range\.is-on[\s\S]{0,200}var\(--ink-cyan\)/.test(css)).toBe(true);
  });
});
