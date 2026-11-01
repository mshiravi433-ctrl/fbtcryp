// @vitest-environment jsdom
/**
 * THE MARKET TERMINAL — views, sort menu, breadth, failure.
 * ---------------------------------------------------------------------------
 * Four complaints, and the assertion that pins each one:
 *
 *   «صعودی‌ها رو می‌زنم، بقیهٔ ارزها غیب می‌شن»
 *      → a view REORDERS the loaded page. More than 25 rows survive the tap,
 *        and every coin on the page is still reachable.
 *
 *   «ستاره با نمودار و قیمت توی ردیف تداخل دارد»
 *      → market rows contain no star control; favourites remain available
 *        through each token's own detail page.
 *
 *   «مرتب‌سازی بر اساس حجم می‌کنم ولی حجم رو نمی‌بینم»
 *      → the measure the list is ordered by is printed under the coin's name.
 *
 *   «سرور جواب نمی‌ده، صفحه می‌گه چیزی پیدا نشد»
 *      → a failed feed renders its own card with a working retry, not an
 *        empty-search state.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import fa from '../src/i18n/locales/fa.json';
import en from '../src/i18n/locales/en.json';
import { useAppStore } from '../src/store/useAppStore';

const dict = { fa, en };
const LANG = 'fa';
const get = (obj, path) => path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
const tFor = (lang) => (key, opts = {}) => {
  let v = get(dict[lang], key);
  if (v == null) v = get(dict.en, key);
  if (v == null) return opts.defaultValue ?? key;
  return String(v).replace(/\{\{(\w+)\}\}/g, (_, k) => String(opts[k] ?? ''));
};
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: tFor(LANG), i18n: { language: LANG, changeLanguage: () => {} } })
}));

const MOTION_STUBS = new Map();
vi.mock('framer-motion', () => ({
  motion: new Proxy({}, {
    get: (_, tag) => {
      const T = String(tag);
      if (!MOTION_STUBS.has(T)) {
        MOTION_STUBS.set(T, ({ children, ...p }) => {
          const clean = Object.fromEntries(Object.entries(p).filter(([k]) => !['initial', 'animate', 'exit', 'transition', 'whileTap', 'whileHover', 'layout', 'layoutId', 'variants'].includes(k)));
          return <T {...clean}>{children}</T>;
        });
      }
      return MOTION_STUBS.get(T);
    }
  }),
  AnimatePresence: ({ children }) => <>{children}</>,
  useReducedMotion: () => true
}));

/* ── the feed: one BTC plus 120 alternates (61 up, 60 down, none flat) ───── */
const mkCoin = (i, symbol) => ({
  id: `coin-${i}`,
  symbol,
  name: `Coin ${i}`,
  image: '',
  price: 1 + i / 100,
  change24h: i % 2 ? 3.2 : -1.4,
  volume: 1_000_000 * (i + 1),
  mcap: 2_000_000 * (i + 1),
  high24h: 2,
  low24h: 1,
  sparkline: [1, 2, 3, 4],
  rank: i + 1
});
const BTC = {
  id: 'bitcoin', symbol: 'BTC', name: 'Bitcoin', image: '',
  price: 60000, change24h: 1, volume: 1e10, mcap: 1e12,
  high24h: 1, low24h: 1, sparkline: [1, 2, 3], rank: 1
};
const COINS = [BTC, ...Array.from({ length: 120 }, (_, i) => mkCoin(i, `T${i}`))];

/*
 * The hook's answer is a MUTABLE object: the failure test edits it in place and
 * re-renders, which is how a real poll turns a working feed into a dead one.
 */
const feed = vi.hoisted(() => ({
  data: [],
  loading: false,
  error: null,
  updatedAt: 0,
  refresh: () => {}
}));

vi.mock('../src/hooks/useMarket', () => ({
  useMarkets: () => feed,
  useGlobalStats: () => ({
    data: { mcap: 1e12, volume: 5e11, btcDominance: 52, ethDominance: 15, coins: 10, markets: 20, avgChange: 1, mcapChange: 1 }
  }),
  useTrending: () => ({ data: [] }),
  useCoinSearch: () => ({ results: [], searching: false })
}));

vi.mock('../src/hooks/useCoinVenues', () => ({ useCoinVenues: () => ({ venues: new Map(), loading: false }) }));
vi.mock('../src/lib/refresh', () => ({ onSoftRefresh: () => () => {} }));
vi.mock('../src/lib/api', () => ({
  getMarkets: async () => [],
  getCategory: async () => [],
  getGlobal: async () => ({}),
  getTrending: async () => [],
  searchCoins: async () => [],
  onMarketVisualsReady: () => () => {}
}));
vi.mock('../src/lib/marketVisuals', () => ({ mergeVisuals: (c) => c }));
vi.mock('../src/lib/priceAlerts', () => ({ runPriceAlerts: () => {}, runTopMoverAlerts: () => {}, syncPriceWatch: () => Promise.resolve({ ok: true }) }));
vi.mock('../src/components/Ticker', () => ({ default: () => null }));
vi.mock('../src/components/AdBanner', () => ({ default: () => null }));
vi.mock('../src/components/TrendChart', () => ({ default: () => null }));

/*
 * ─── THESE MOUNTS NOW ENTER ON «توکن» ──────────────────────────────────────
 * The screen has two tabs («مرور» / «توکن», see lib/marketTabs.js) and every
 * assertion in this file is about the list, its search field, its sort or its
 * rows — all of which live on the second tab. `?tab=tokens` is a supported,
 * documented entry point (a shared link to the list opens exactly there), so
 * these tests start where a reader with that link would start, instead of
 * re-proving the tab switch in eleven places. The switch itself, the state it
 * keeps and the panel it mounts are pinned once, in market-tabs.test.jsx.
 */
import Market from '../src/pages/Market.jsx';

const rowIds = () => [...document.querySelectorAll('.coin-row')].map((el) => el.dataset.coinId);
const count = () => screen.getByTestId('market-count').textContent;
const chooseSort = (key) => {
  fireEvent.click(screen.getByTestId('market-sort'));
  fireEvent.click(screen.getByRole('menuitemradio', { name: fa.market.sort[key] }));
};

beforeEach(() => {
  feed.data = COINS;
  feed.loading = false;
  feed.error = null;
  feed.updatedAt = Date.now();
  feed.refresh = vi.fn();
  useAppStore.setState({ favorites: [] });
});

afterEach(() => {
  cleanup();
  useAppStore.setState({ favorites: [] });
});

describe('the views reorder the page instead of shrinking it', () => {
  it('keeps more than 25 rows after tapping «صعودی‌ها»', async () => {
    render(<MemoryRouter initialEntries={['/?tab=tokens']}><Market /></MemoryRouter>);
    await waitFor(() => expect(rowIds().length).toBeGreaterThan(40));

    fireEvent.click(screen.getByRole('button', { name: fa.market.filter.gainers }));

    await waitFor(() => {
      /* The old implementation was `sort(...).slice(0, 25)` — this is the
         number that proves the budget is gone. */
      expect(rowIds().length).toBeGreaterThan(25);
      expect(rowIds().length).toBe(60);
    });
    /* …and it really is ordered: the biggest gainer comes first. */
    expect(rowIds()[0]).toBe('coin-1');
    /* Every coin is still in the view — the count is the page, not a slice. */
    expect(count()).toBe('121');
    /* The chip reports its own state to a screen reader. */
    expect(screen.getByRole('button', { name: fa.market.filter.gainers }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: fa.market.filter.all }).getAttribute('aria-pressed')).toBe('false');
  });

  it('losers put the worst change first, and the chip is derived from the sort', async () => {
    render(<MemoryRouter initialEntries={['/?tab=tokens']}><Market /></MemoryRouter>);
    await waitFor(() => expect(rowIds().length).toBeGreaterThan(0));

    fireEvent.click(screen.getByRole('button', { name: fa.market.filter.losers }));
    await waitFor(() => expect(screen.getByTestId('market-sort-dir').getAttribute('data-dir')).toBe('asc'));
    /* -1.4 ties across every even coin, so the tie-break (rank) decides. */
    expect(rowIds()[0]).toBe('coin-0');
    expect(screen.getByRole('button', { name: fa.market.filter.losers }).getAttribute('aria-pressed')).toBe('true');
  });

  it('a sort chosen from the menu un-highlights the preset chips', async () => {
    render(<MemoryRouter initialEntries={['/?tab=tokens']}><Market /></MemoryRouter>);
    await waitFor(() => expect(rowIds().length).toBeGreaterThan(0));

    fireEvent.click(screen.getByRole('button', { name: fa.market.filter.gainers }));
    chooseSort('price');

    await waitFor(() => expect(screen.getByRole('button', { name: fa.market.filter.gainers }).getAttribute('aria-pressed')).toBe('false'));
    expect(screen.getByRole('button', { name: fa.market.filter.all }).getAttribute('aria-pressed')).toBe('false');
  });
});

describe('the ordered measure is visible', () => {
  it('prints market caps under the name when the list is sorted by market cap', async () => {
    render(<MemoryRouter initialEntries={['/?tab=tokens']}><Market /></MemoryRouter>);
    await waitFor(() => expect(rowIds().length).toBeGreaterThan(0));

    chooseSort('mcap');

    await waitFor(() => expect(document.querySelectorAll('.coin-row-metric').length).toBeGreaterThan(0));
    /* the label is translated, never a raw key glued to a number */
    expect(document.querySelector('.coin-row-metric').textContent).toContain(fa.market.mcapShort);
    expect(document.body.textContent).not.toContain('market.mcapShort');
    /* highest cap first */
    expect(rowIds()[0]).toBe('bitcoin');
  });

  it('prints volume instead, once the sort is volume', async () => {
    render(<MemoryRouter initialEntries={['/?tab=tokens']}><Market /></MemoryRouter>);
    await waitFor(() => expect(rowIds().length).toBeGreaterThan(0));

    fireEvent.click(screen.getByRole('button', { name: fa.market.filter.volume }));
    await waitFor(() => expect(document.querySelectorAll('.coin-row-metric').length).toBeGreaterThan(0));
    expect(document.querySelector('.coin-row-metric').textContent).toContain(fa.market.volumeShort);
    expect(rowIds()[0]).toBe('bitcoin');
  });

  it('says nothing extra when the order is price, which every row already shows', async () => {
    render(<MemoryRouter initialEntries={['/?tab=tokens']}><Market /></MemoryRouter>);
    await waitFor(() => expect(rowIds().length).toBeGreaterThan(0));
    chooseSort('price');
    await waitFor(() => expect(document.querySelectorAll('.coin-row-metric').length).toBe(0));
  });
});

describe('row density and favourites', () => {
  it('keeps star controls out of market rows while preserving the saved favourites view', async () => {
    useAppStore.setState({ favorites: ['coin-3'] });
    render(<MemoryRouter initialEntries={['/?tab=tokens']}><Market /></MemoryRouter>);
    await waitFor(() => expect(rowIds().length).toBeGreaterThan(0));

    expect(screen.queryByTestId('market-star-coin-3')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: fa.market.filter.favorites }));
    await waitFor(() => expect(count()).toBe('1'));
    expect(rowIds()).toEqual(['coin-3']);
  });
});

describe('breadth', () => {
  it('counts the page it is looking at, and says how many that is', async () => {
    render(<MemoryRouter initialEntries={['/?tab=tokens']}><Market /></MemoryRouter>);
    await waitFor(() => expect(screen.getByTestId('market-breadth-up')).toBeTruthy());

    /* BTC +1 and sixty odd coins at +3.2 are up; sixty even coins are down;
       no coin reports exactly 0, so "flat" is not printed at all. */
    expect(screen.getByTestId('market-breadth-up').textContent).toContain('61');
    expect(screen.getByTestId('market-breadth-down').textContent).toContain('60');
    expect(screen.queryByText(/0 بی‌تغییر/)).toBeNull();
    expect(screen.getByText(tFor('fa')('market.breadthNote', { count: '121' }))).toBeTruthy();
  });

  it('does not move when the search box narrows the list', async () => {
    render(<MemoryRouter initialEntries={['/?tab=tokens']}><Market /></MemoryRouter>);
    await waitFor(() => expect(rowIds().length).toBeGreaterThan(0));
    const before = screen.getByTestId('market-breadth-up').textContent;

    fireEvent.change(screen.getByLabelText(fa.market.searchAria), { target: { value: 'T11' } });
    await waitFor(() => expect(screen.getByTestId('market-count').textContent).not.toBe('121'));

    expect(screen.getByTestId('market-breadth-up').textContent).toBe(before);
  });
});

describe('a dead feed', () => {
  it('offers a manual refresh that runs the same poll the timer does', async () => {
    render(<MemoryRouter initialEntries={['/?tab=tokens']}><Market /></MemoryRouter>);
    await waitFor(() => expect(rowIds().length).toBeGreaterThan(0));
    fireEvent.click(screen.getByTestId('market-refresh'));
    expect(feed.refresh).toHaveBeenCalledTimes(1);
  });

  it('shows its own card and a retry instead of "nothing found"', async () => {
    feed.data = [];
    feed.error = new Error('offline');

    render(<MemoryRouter initialEntries={['/?tab=tokens']}><Market /></MemoryRouter>);
    await waitFor(() => expect(screen.getByTestId('market-feed-error')).toBeTruthy());
    expect(screen.getByText(fa.market.feedDown)).toBeTruthy();
    expect(screen.queryByText(fa.market.noResults)).toBeNull();

    fireEvent.click(screen.getByTestId('market-retry'));
    expect(feed.refresh).toHaveBeenCalledTimes(1);
  });
});

describe('accessibility of the row', () => {
  it('is a real button, not a div with a click handler', async () => {
    render(<MemoryRouter initialEntries={['/?tab=tokens']}><Market /></MemoryRouter>);
    await waitFor(() => expect(rowIds().length).toBeGreaterThan(0));

    const open = document.querySelector('.coin-row-open');
    expect(open.tagName).toBe('BUTTON');
    expect(open.getAttribute('aria-label')).toBe('Bitcoin (BTC)');
    /* the row keeps its price/chart area clean; bookmarking lives on detail */
    expect(document.querySelector('.coin-row-star')).toBeNull();
  });

  it('labels the search field and clears it with a button', async () => {
    render(<MemoryRouter initialEntries={['/?tab=tokens']}><Market /></MemoryRouter>);
    await waitFor(() => expect(rowIds().length).toBeGreaterThan(0));

    const input = screen.getByLabelText(fa.market.searchAria);
    expect(screen.queryByLabelText(fa.market.clearSearch)).toBeNull();
    fireEvent.change(input, { target: { value: 'bit' } });
    const clear = await screen.findByLabelText(fa.market.clearSearch);
    fireEvent.click(clear);
    expect(input.value).toBe('');
  });
});
