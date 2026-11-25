// @vitest-environment jsdom
/**
 * بازار · تب «توکن» — the six requests of 2026-11-25, pinned.
 *
 * The assertions below are about the reader's complaints, in the same order:
 *   1 · the showcase has its own animated prism layers and a modern shape;
 *   2 · three compact drop-down fields sit under the search box;
 *   3 · no filter is selected on a fresh page, the chip row is NOT pinned,
 *       and the «جستجو و ترتیب فهرست فقط …» sentence is gone at the source;
 *   4 · the token is one glass card and the swap box is a separate sibling;
 *   5 · the layer declares phone/tablet/desktop widths and both themes;
 *   6 · the swap button stays outside the token card.
 *
 * Only the feed, the framework and the network are stubbed. The markup, the
 * state and the stylesheet are the real ones.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { readFileSync } from 'node:fs';
import fa from '../src/i18n/locales/fa.json';
import en from '../src/i18n/locales/en.json';

const dict = { fa, en };
const get = (obj, path) => path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
const tFor = (key, opts = {}) => {
  let v = get(fa, key);
  if (v == null) v = get(en, key);
  if (v == null) return opts.defaultValue ?? key;
  return String(v).replace(/\{\{(\w+)\}\}/g, (_, k) => String(opts[k] ?? ''));
};
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: tFor, i18n: { language: 'fa', resolvedLanguage: 'fa', changeLanguage: () => {} } })
}));

const MOTION_STUBS = new Map();
vi.mock('framer-motion', () => ({
  motion: new Proxy({}, {
    get: (_, tag) => {
      const T = String(tag);
      if (!MOTION_STUBS.has(T)) {
        MOTION_STUBS.set(T, ({ children, ...p }) => {
          const clean = Object.fromEntries(Object.entries(p).filter(([k]) =>
            !['initial', 'animate', 'exit', 'transition', 'whileTap', 'whileHover', 'layout', 'layoutId', 'variants'].includes(k)));
          return <T {...clean}>{children}</T>;
        });
      }
      return MOTION_STUBS.get(T);
    }
  }),
  AnimatePresence: ({ children }) => <>{children}</>,
  useReducedMotion: () => true
}));

const mkCoin = (i) => ({
  id: `coin-${i}`, symbol: `T${i}`, name: `Coin ${i}`, image: '',
  price: 1 + i / 100, change24h: i % 2 ? 3.2 : -1.4,
  volume: 1e6 * (i + 1), mcap: 2e6 * (i + 1),
  high24h: 2, low24h: 1, sparkline: [1, 2, 3, 4], rank: i + 1
});
const COINS = [
  { id: 'bitcoin', symbol: 'BTC', name: 'Bitcoin', image: '', price: 60000, change24h: 1, volume: 1e10, mcap: 1e12, high24h: 1, low24h: 1, sparkline: [1, 2, 3], rank: 1 },
  ...Array.from({ length: 120 }, (_, i) => mkCoin(i))
];

const feed = vi.hoisted(() => ({ data: [], loading: false, error: null, updatedAt: 0, refresh: () => {} }));
vi.mock('../src/hooks/useMarket', () => ({
  useMarkets: () => feed,
  useGlobalStats: () => ({ data: { mcap: 1e12, volume: 5e11, btcDominance: 52, ethDominance: 15, coins: 10, markets: 20, avgChange: 1, mcapChange: 1 } }),
  /* One real trending row: the «داغ‌ترین‌ها» showcase returns null without it. */
  useTrending: () => ({ data: [{
    id: 'bitcoin', symbol: 'BTC', name: 'Bitcoin', image: '', price: 60000,
    price_change_percentage_24h: 1, sparkline: [1, 2, 3]
  }] }),
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

import Market from '../src/pages/Market.jsx';

const css = () => readFileSync('src/styles/market-token-2026.css', 'utf8');
const page = () => readFileSync('src/pages/Market.jsx', 'utf8');
const openList = async () => {
  render(<MemoryRouter initialEntries={['/?tab=tokens']}><Market /></MemoryRouter>);
  await waitFor(() => expect(document.querySelectorAll('.coin-row').length).toBeGreaterThan(0));
};

beforeEach(() => {
  feed.data = COINS;
  feed.loading = false;
  feed.error = null;
  feed.updatedAt = Date.now();
  localStorage.clear();
});
afterEach(() => { cleanup(); localStorage.clear(); });

describe('۱ · ویترین: رنگ، انیمیشن و شکل', () => {
  it('mounts the travelling prism layers on both showcases', async () => {
    await openList();
    for (const cls of ['mx26-rim', 'mx26-rim-b', 'mx26-orb', 'mx26-gloss',
      'mx26-terminal-rim', 'mx26-terminal-glow', 'mx26-hot-rim', 'mx26-hot-orb',
      'mx26-search-rim']) {
      expect(document.querySelector(`.${cls}`), cls).toBeTruthy();
    }
    for (const el of document.querySelectorAll('.mx26-rim, .mx26-orb, .mx26-gloss, .mx26-terminal-rim, .mx26-hot-rim')) {
      expect(el.getAttribute('aria-hidden')).toBe('true');
    }
  });

  it('declares finite transform/opacity-only loops, no live blur and a real off-switch', () => {
    const bare = css().replace(/\/\*[\s\S]*?\*\//g, '');
    expect(bare).not.toMatch(/animation[^;]*infinite/);
    expect(bare).not.toMatch(/backdrop-filter:\s*blur/);
    expect(bare).not.toMatch(/will-change|content-visibility|mask-image/);
    for (const [, body] of bare.matchAll(/@keyframes\s+[\w-]+\s*\{([\s\S]*?)\n\}/g)) {
      for (const line of body.split('\n')) {
        const prop = line.match(/^\s*([a-z-]+)\s*:/)?.[1];
        if (!prop || ['from', 'to', '0%', '50%', '100%'].includes(prop)) continue;
        expect(['transform', 'opacity']).toContain(prop);
      }
    }
    expect(bare).toMatch(/@media \(prefers-reduced-motion: reduce\)/);
    expect(bare).toMatch(/:root\[data-reduce-motion='true'\]/);
    expect(bare).toMatch(/:root\[data-theme='light'\] \.mx-market/);
    for (const q of ['@media (min-width: 720px)', '@media (min-width: 1024px)', '@media (max-width: 719px)', '@media (max-width: 430px)']) {
      expect(bare).toContain(q);
    }
    /* The layer is last, and only this route pays for it. */
    const src = page();
    expect(src.lastIndexOf("import '../styles/market-token-2026.css'"))
      .toBeGreaterThan(src.lastIndexOf("import '../styles/market-request-fixes.css'"));
  });
});

describe('۲ · سه باکس بازشونده زیر جستجو', () => {
  it('renders exactly three fields, all closed, with localised labels', async () => {
    await openList();
    const dock = screen.getByTestId('market-filter-dock');
    const terminal = document.querySelector('.market-terminal');
    const chips = screen.getByTestId('market-filter-chips');
    /* «همه ارزها» is ONE box: search, the three fields, then the chip row. */
    expect(terminal.contains(screen.getByTestId('market-search-wrap'))).toBe(true);
    expect(terminal.contains(dock)).toBe(true);
    expect(terminal.contains(chips)).toBe(true);
    expect(dock.compareDocumentPosition(chips) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const fields = dock.querySelectorAll('.mx26-field');
    expect(fields.length).toBe(3);
    expect([...fields].map((f) => f.dataset.field)).toEqual(['horizon', 'change', 'sort']);
    expect(fields[0].querySelector('.mx26-field-label').textContent).toBe(fa.market.filterDock.horizon);
    expect(fields[1].querySelector('.mx26-field-label').textContent).toBe(fa.market.filterDock.change);
    expect(fields[2].querySelector('.mx26-field-label').textContent).toBe(fa.market.filterDock.sort);
    expect(fields[0].dataset.open).toBe('false');
    expect(fields[1].dataset.open).toBe('false');
    /* The real controls survive inside the boxes. */
    expect(screen.getByTestId('market-horizon').getAttribute('role')).toBe('radiogroup');
    expect(screen.getByTestId('market-sort')).toBeTruthy();
    expect(screen.getByTestId('market-sort-dir')).toBeTruthy();
  });

  it('opens the horizon box, applies 7d and closes it again', async () => {
    await openList();
    const field = document.querySelector('.mx26-field[data-field="horizon"]');
    fireEvent.click(field.querySelector('.mx26-field-trigger'));
    expect(field.dataset.open).toBe('true');
    fireEvent.click(screen.getByTestId('market-horizon-7d'));
    expect(screen.getByTestId('market-horizon-7d').getAttribute('aria-checked')).toBe('true');
    expect(field.dataset.open).toBe('false');
    expect(field.querySelector('.mx26-field-value').textContent).toBe(fa.market.horizon['7d']);
    expect(screen.getByTestId('market-filter-chips').dataset.active).toBe('true');
  });

  it('opens the 24h-change box and applies «صعودی‌ها» through the same view state', async () => {
    await openList();
    const field = document.querySelector('.mx26-field[data-field="change"]');
    fireEvent.click(field.querySelector('.mx26-field-trigger'));
    expect(field.dataset.open).toBe('true');
    fireEvent.click(screen.getByRole('menuitemradio', { name: fa.market.filter.gainers }));
    expect(screen.getByRole('button', { name: fa.market.filter.gainers }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByTestId('market-filter-chips').dataset.active).toBe('true');
    expect(field.dataset.open).toBe('false');
  });
});

describe('۳ · بدون فیلتر انتخابی، ردیف با صفحه می‌آید پایین و جمله حذف شد', () => {
  it('starts with NO selected chip, a static row and no loaded-scope sentence', async () => {
    await openList();
    for (const chip of document.querySelectorAll('.mx26-chips .mx-view')) {
      expect(chip.getAttribute('aria-pressed')).toBe('false');
      expect(chip.getAttribute('data-active')).toBeNull();
    }
    const chips = screen.getByTestId('market-filter-chips');
    expect(chips.dataset.active).toBe('false');
    /* `position: static` is the CSS default when nothing is selected. */
    expect(css()).toMatch(/\.mx-market \.mx-controls\.mx26-chips \{[^}]*position: static/s);
    expect(css()).toMatch(/\.mx-market \.mx26-chips\[data-active='true'\] \{[^}]*position: sticky/s);
    expect(document.querySelector('[data-testid="market-loaded-scope"]')).toBeNull();
    expect(document.body.textContent).not.toContain('جستجو و ترتیب فهرست فقط بر اساس توکن');
    /* …and the key is gone from the source locales too, not just hidden. */
    for (const locale of ['fa', 'en', 'ar', 'es', 'fr', 'hi', 'id', 'pt', 'ru', 'tr', 'ur', 'zh']) {
      const text = readFileSync(`src/i18n/locales/${locale}.json`, 'utf8');
      expect(text, locale).not.toContain('"sortLoadedOnly"');
      expect(text, locale).toContain('"filterDock"');
    }
  });
});

describe('۴ و ۶ · کارت توکن شیشه‌ای، باکس سواپ جدا و بیرون از آن', () => {
  it('keeps the swap button OUTSIDE the token card, in its own sibling box', async () => {
    await openList();
    const row = document.querySelector('.mx-coin-row');
    const card = row.querySelector(':scope > .coin-row');
    const slot = row.querySelector(':scope > .mx-swap-slot[data-available="true"]');
    const swap = row.querySelector('[data-testid="market-swap-bitcoin"]');
    expect(card).toBeTruthy();
    expect(slot).toBeTruthy();
    expect(swap).toBeTruthy();
    expect(card.contains(swap)).toBe(false);
    expect(slot.contains(swap)).toBe(true);
    expect(card.nextElementSibling).toBe(slot);
  });

  it('gives the token card and the swap box the SAME glass recipe', () => {
    const bare = css().replace(/\/\*[\s\S]*?\*\//g, '');
    const card = /\.mx-market \.mx-coin-row > \.coin-row \{([\s\S]*?)\n\}/.exec(bare)[1];
    const slot = /\.mx-market \.mx-swap-slot\[data-available='true'\] \{([\s\S]*?)\n\}/.exec(bare)[1];
    for (const needle of ['var(--m26-inner)', 'var(--m26-line)', 'var(--m26-bevel)']) {
      expect(card).toContain(needle);
      expect(slot).toContain(needle);
    }
    /* The row wrapper itself is transparent: the two boxes read as two boxes. */
    expect(bare).toMatch(/\.mx-market \.mx-coin-row \{[\s\S]*?background: none !important/s);
  });

  it('caps the token card width on a desktop instead of stretching it', () => {
    const bare = css().replace(/\/\*[\s\S]*?\*\//g, '');
    expect(bare).toMatch(/@media \(min-width: 1024px\) \{[\s\S]*?\.mx-market \.mx-coin-row \{ max-width: 790px/s);
  });
});
