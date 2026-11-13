// @vitest-environment jsdom
/**
 * The horizon rail — 1h · 24h · 7d.
 *
 * Why this suite exists: until now the market list ranked and printed exactly
 * one window (24 h) even though every row already carried `change1h` and
 * `change7d` all the way from CoinGecko. A horizon control is only honest if
 * THREE things stay in lockstep, and each of them is a separate way to lie:
 *
 *   1. the control   — which cell is marked active, and that it is a radio,
 *                      not three anonymous buttons;
 *   2. the ordering  — that picking 7d actually re-sorts by `change7d`, and
 *                      that it re-sorts DESCENDING even when the reader had
 *                      the 24 h list sorted ascending (worst first);
 *   3. the copy      — that the number printed in each row's pill is the
 *                      window the rail claims to be showing.
 *
 * The failure mode worth guarding is drift: pills reading 1 h while the order
 * and the header say 24 h. So the last test drives the sort menu and asserts
 * the rail followed, and the first test asserts the rail is labelled as a
 * radiogroup so a screen reader hears one choice rather than three buttons.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import fa from '../src/i18n/locales/fa.json';
import en from '../src/i18n/locales/en.json';

const dict = { fa, en };
const get = (o, p) => p.split('.').reduce((a, k) => (a == null ? undefined : a[k]), o);
const tFor = (lang) => (key, opts = {}) => {
  let v = get(dict[lang], key);
  if (v == null) v = get(dict.en, key);
  if (v == null) return opts.defaultValue ?? key;
  return String(v).replace(/\{\{(\w+)\}\}/g, (_, k) => String(opts[k] ?? ''));
};
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: tFor('fa'), i18n: { language: 'fa', resolvedLanguage: 'fa', changeLanguage: () => {} } })
}));

vi.mock('framer-motion', () => ({
  motion: new Proxy({}, {
    get: (_, tag) => {
      const T = String(tag);
      return ({ children, ...p }) => {
        const clean = Object.fromEntries(Object.entries(p).filter(([k]) =>
          !['initial', 'animate', 'exit', 'transition', 'whileTap', 'whileHover', 'layout', 'layoutId', 'variants'].includes(k)));
        return <T {...clean}>{children}</T>;
      };
    }
  }),
  AnimatePresence: ({ children }) => <>{children}</>,
  useReducedMotion: () => true
}));

/* ── the feed ──────────────────────────────────────────────────────────────
 * Deliberately NOT monotonic across windows: the coin that leads on 24 h is
 * NOT the coin that leads on 7 d, and the coin that leads on 1 h is a third
 * one again. A feed where all three windows agreed would pass even if the
 * rail were wired to the wrong field.
 *
 *   BTC 24h +2.41   7d +11.0    1h +0.31
 *   ETH 24h +4.12   7d  +2.5    1h -0.42   ← biggest 24 h, middling 7 d
 *   SOL 24h -1.20   7d +19.5    1h +1.10   ← biggest 7 d, negative 24 h
 *   ALT 24h +0.80   7d  -6.0    1h +0.90
 *   NOH 24h +1.00   (no 1h, no 7d)         ← the CoinLore-style backup row
 */
const COIN = (id, symbol, name, price, c1h, c24, c7d, rank) => ({
  id, symbol, name, image: '', price, change1h: c1h, change24h: c24, change7d: c7d,
  volume: 1e9, mcap: 1e11, high24h: price * 1.02, low24h: price * 0.98,
  sparkline: [1, 2, 3], rank
});
const COINS = [
  COIN('bitcoin', 'BTC', 'Bitcoin', 92450, 0.31, 2.41, 11.0, 1),
  COIN('ethereum', 'ETH', 'Ethereum', 3420, -0.42, 4.12, 2.5, 2),
  COIN('solana', 'SOL', 'Solana', 198.4, 1.10, -1.20, 19.5, 3),
  COIN('altcoin', 'ALT', 'Altcoin', 3.15, 0.90, 0.80, -6.0, 4),
  { ...COIN('noh', 'NOH', 'NoHorizon', 0.42, null, 1.0, null, 5) }
];
/* CoinLore's backup payload carries neither field, so `undefined` (absent)
   must behave exactly like `null` (present but empty). */
delete COINS[4].change1h;
delete COINS[4].change7d;

const feed = vi.hoisted(() => ({ data: [], loading: false, error: null, updatedAt: 0, refresh: () => {} }));
vi.mock('../src/hooks/useMarket', () => ({
  useMarkets: () => feed,
  useGlobalStats: () => ({
    data: { mcap: 3.152e12, volume: 1.42e11, btcDominance: 56.4, ethDominance: 13.8, coins: 14820, markets: 1124, avgChange: 2.35, mcapChange: 2.84 }
  }),
  useTrending: () => ({ data: [] }),
  useCoinSearch: () => ({ results: [], searching: false })
}));
vi.mock('../src/hooks/useCoinVenues', () => ({ useCoinVenues: () => ({ venues: new Map(), loading: false }) }));
vi.mock('../src/lib/refresh', () => ({ onSoftRefresh: () => () => {} }));
vi.mock('../src/lib/api', () => ({
  getMarkets: async () => [], getCategory: async () => [], getGlobal: async () => ({}),
  getTrending: async () => [], searchCoins: async () => [], onMarketVisualsReady: () => () => {}
}));
vi.mock('../src/lib/marketVisuals', () => ({ mergeVisuals: (c) => c }));
vi.mock('../src/lib/priceAlerts', () => ({
  runPriceAlerts: () => {}, runTopMoverAlerts: () => {}, syncPriceWatch: () => Promise.resolve({ ok: true })
}));
vi.mock('../src/components/Ticker', () => ({ default: () => null }));
vi.mock('../src/components/AdBanner', () => ({ default: () => null }));
vi.mock('../src/components/TrendChart', () => ({ default: () => null }));
vi.mock('../src/components/MarketStories', () => ({ default: () => null }));

import Market from '../src/pages/Market.jsx';
import { MARKET_SORTS } from '../src/lib/marketList.js';

/* Rows live on the «توکنها» tab (lib/marketTabs.js). Drive the real control. */
const openTokensTab = () => {
  const tab = screen.queryAllByRole('tab').find((n) => n.textContent.includes(fa.market.tabs.tokens));
  if (tab) fireEvent.click(tab);
};

const rail = () => screen.getByTestId('market-horizon');
const cell = (h) => screen.getByTestId(`market-horizon-${h}`);

/* Symbols in the order they are rendered, filtered to our five fixtures. */
const rowOrder = () => {
  const known = new Set(COINS.map((c) => c.symbol));
  return Array.from(document.querySelectorAll('.mx-market .coin-row-open'))
    .map((n) => n.textContent)
    .map((text) => COINS.map((c) => c.symbol).find((s) => text.includes(s)))
    .filter((s) => s && known.has(s));
};

beforeEach(() => {
  feed.data = COINS;
  feed.loading = false;
  feed.error = null;
  feed.updatedAt = Date.now();
  localStorage.clear();
});
afterEach(cleanup);

const mount = () => render(<MemoryRouter><Market /></MemoryRouter>);

describe('the horizon rail', () => {
  it('is one radiogroup of three cells, and marks 24h active by default', () => {
    mount();
    openTokensTab();

    const group = rail();
    expect(group.getAttribute('role')).toBe('radiogroup');
    /* The label is translated, not hardcoded English. */
    expect(group.getAttribute('aria-label')).toBe(fa.market.horizonAria);

    const radios = within(group).getAllByRole('radio');
    expect(radios).toHaveLength(3);
    expect(radios.map((r) => r.getAttribute('data-horizon'))).toEqual(['1h', '24h', '7d']);

    expect(cell('24h').getAttribute('aria-checked')).toBe('true');
    expect(cell('1h').getAttribute('aria-checked')).toBe('false');
    expect(cell('7d').getAttribute('aria-checked')).toBe('false');

    /* Roving tabindex: only the current cell is in the tab order, so Tab does
       not walk through all three. */
    expect(cell('24h').getAttribute('tabindex')).toBe('0');
    expect(cell('1h').getAttribute('tabindex')).toBe('-1');
    expect(cell('7d').getAttribute('tabindex')).toBe('-1');
  });

  it('sits above the view controls, because it governs them', () => {
    mount();
    openTokensTab();
    const controls = document.querySelector('.mx-market .mx-controls');
    expect(controls).toBeTruthy();
    /* FOLLOWING means `controls` comes after the rail in document order. */
    expect(rail().compareDocumentPosition(controls) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('re-sorts by 7d descending when 7d is chosen, from whatever order was showing', () => {
    mount();
    openTokensTab();

    /* Start from an ASCENDING 24 h list so a stale `dir` cannot pass by luck:
       the worst 24 h coin leads, and it is also the biggest 7 d riser (SOL),
       which is exactly the pair that hides a direction bug. */
    /* The sort menu is a popover: open it the way a reader does, then pick the
       24 h sort, then force the direction to ASCENDING. */
    const chooseSort = (key) => {
      fireEvent.click(screen.getByTestId('market-sort'));
      const label = fa.market.sort[key];
      const option = screen.getAllByRole('menuitemradio')
        .find((n) => n.textContent.trim() === label);
      expect(option, `sort option «${key}» must carry its translated label`).toBeTruthy();
      fireEvent.click(option);
    };
    chooseSort('change');
    /* Read the direction from the button itself, then force ascending. */
    const readDir = () => screen.getByTestId('market-sort-dir').getAttribute('data-dir');
    if (readDir() === 'desc') fireEvent.click(screen.getByTestId('market-sort-dir'));
    expect(readDir()).toBe('asc');

    fireEvent.click(cell('7d'));

    expect(cell('7d').getAttribute('aria-checked')).toBe('true');
    expect(cell('24h').getAttribute('aria-checked')).toBe('false');

    /* 7 d, best first: SOL +19.5, BTC +11.0, ETH +2.5, ALT -6.0 … and the row
       with no 7 d figure parks at the end rather than being printed as 0%. */
    expect(rowOrder().slice(0, 4)).toEqual(['SOL', 'BTC', 'ETH', 'ALT']);
    expect(rowOrder().at(-1)).toBe('NOH');
  });

  it('prints the move for the chosen window, not always the 24h move', () => {
    mount();
    openTokensTab();

    const pillFor = (symbol) => {
      const row = Array.from(document.querySelectorAll('.mx-market .coin-row-open'))
        .find((n) => n.textContent.includes(symbol));
      expect(row).toBeTruthy();
      return row.textContent;
    };

    /* 24 h default: BTC reads +2.41%, which is NOT its 1 h (+0.31) or 7 d (+11). */
    expect(pillFor('BTC')).toMatch(/2\.4/);
    expect(pillFor('BTC')).not.toMatch(/11\.0/);

    fireEvent.click(cell('7d'));
    expect(pillFor('BTC')).toMatch(/11\.0?/);
    expect(pillFor('BTC')).not.toMatch(/2\.4/);

    fireEvent.click(cell('1h'));
    expect(pillFor('BTC')).toMatch(/0\.3/);
  });

  it('counts the rows it cannot show for the window instead of printing 0%', () => {
    mount();
    openTokensTab();

    /* 24 h is the default and needs no excuse: the feed always has it. */
    expect(screen.queryByTestId('market-horizon-note')).toBeNull();

    fireEvent.click(cell('1h'));
    const note = screen.getByTestId('market-horizon-note');
    /* One row (NOH) has no 1 h figure. */
    expect(note.textContent).toMatch(/1/);
    expect(note.textContent).not.toMatch(/^0$/);

    fireEvent.click(cell('7d'));
    expect(screen.getByTestId('market-horizon-note').textContent).toMatch(/1/);
  });

  it('moves the rail when the SORT menu picks a horizon, so the two cannot disagree', () => {
    mount();
    openTokensTab();

    /* The sort menu gained change1h / change7d; choosing one there must drag
       the rail with it. Otherwise the header says 24h while the list is in 7 d
       order — the drift this suite exists to prevent. */
    const pickSort = (key) => {
      fireEvent.click(screen.getByTestId('market-sort'));
      const label = fa.market.sort[key];
      const option = screen.getAllByRole('menuitemradio')
        .find((n) => n.textContent.trim() === label);
      expect(option, `sort option «${key}» must carry its translated label`).toBeTruthy();
      fireEvent.click(option);
    };

    pickSort('change7d');
    expect(cell('7d').getAttribute('aria-checked')).toBe('true');
    expect(cell('7d').getAttribute('data-active')).toBe('true');

    pickSort('change1h');
    expect(cell('1h').getAttribute('aria-checked')).toBe('true');
    expect(cell('24h').getAttribute('aria-checked')).toBe('false');
    expect(cell('7d').getAttribute('aria-checked')).toBe('false');
  });

  it('remembers the horizon across mounts, and ignores a bad stored value', () => {
    localStorage.setItem('fbt.market.horizon', '7d');
    mount();
    openTokensTab();
    expect(cell('7d').getAttribute('aria-checked')).toBe('true');
    cleanup();

    /* A stale or hand-edited value must not leave the rail with no selection. */
    localStorage.setItem('fbt.market.horizon', '30d');
    mount();
    openTokensTab();
    expect(cell('24h').getAttribute('aria-checked')).toBe('true');
  });

  it('declares a CSS rule for every class it renders', () => {
    /* The rail shipped styled in the same commit as the markup: a class with
       no rule is an unstyled control, which is how the last two of these got
       through review. */
    const css = require('node:fs').readFileSync('src/styles/market-tabs.css', 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '');
    for (const cls of ['.mx-horizon', '.mx-horizon-btn', '.mx-horizon-note']) {
      expect(css.includes(cls)).toBe(true);
    }
  });
  it('labels every sort key it offers in ALL twelve locales, not just English', () => {
    /* The sort menu is built by `MARKET_SORTS.map(... t(`market.sort.${key}`))`.
       A missing key does not throw: i18next (and the test double) render the
       literal string `market.sort.change7d` into the menu. That is exactly what
       happened when the two horizon keys were added to MARKET_SORTS before
       their labels existed — this test is the guard, and it checks all twelve
       dictionaries, because a reader in Arabic should not get English keys. */
    const dir = 'src/i18n/locales';
    const files = require('node:fs').readdirSync(dir).filter((f) => f.endsWith('.json'));
    expect(files.length).toBe(12);
    /* Read the list from the REAL module, not a regex over its source: the
       question is what the menu iterates, and only the module knows that. */
    const keys = [...MARKET_SORTS];
    expect(keys).toContain('change1h');
    expect(keys).toContain('change7d');

    for (const file of files) {
      const dict = JSON.parse(require('node:fs').readFileSync(`${dir}/${file}`, 'utf8'));
      for (const key of keys) {
        const value = dict?.market?.sort?.[key];
        expect(typeof value, `${file} is missing market.sort.${key}`).toBe('string');
        expect(value.trim().length, `${file} has an empty market.sort.${key}`).toBeGreaterThan(0);
        expect(value).not.toContain('market.sort');
      }
      /* The rail's own copy has to reach every dictionary too. */
      for (const key of ['1h', '24h', '7d']) {
        expect(typeof dict?.market?.horizon?.[key], `${file} is missing market.horizon.${key}`).toBe('string');
      }
      expect(typeof dict?.market?.horizonAria, `${file} is missing market.horizonAria`).toBe('string');
      expect(typeof dict?.market?.horizonMissing, `${file} is missing market.horizonMissing`).toBe('string');
    }
  });
});
