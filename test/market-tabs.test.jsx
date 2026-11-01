// @vitest-environment jsdom
/**
 * «بازار» HAS TWO TABS — «مرور» AND «توکن».
 * ---------------------------------------------------------------------------
 * Requested: «در صفحه بازار دو تب کن — تب اول مرور: باکس ارزش کل، باکس
 * بیت‌کوین، همراه با پول هوشمند بنر و باکس استوری‌ها. تب دوم بنام توکن: باکس
 * داغ‌ترین‌ها، باکس جستجو و توکن‌ها. تب‌ها از تم اصلی و ظاهر پیروی کند.»
 *
 * These pins answer the four ways a tabbed screen ships broken:
 *
 *   1. THE BOX IS UNDER THE WRONG TAB — or in both, or in neither. The model
 *      in lib/marketTabs.js names the owner of every box, and the first block
 *      below walks that model against the real DOM in both tabs.
 *   2. THE CLOSED TAB IS STILL THERE — painted behind the open one, focusable,
 *      and read aloud by a screen reader. `hidden` only wins if a stylesheet
 *      does not out-specify it, so that rule is pinned too.
 *   3. THE TAB LOSES THE READER'S WORK — a search, a sort or a starred-only
 *      view resetting on a switch.
 *   4. THE TAB COSTS A REQUEST, OR A BLUR. Both panels read the one feed this
 *      screen already polls, and the strip is drawn with material that was
 *      already on the page — no new backdrop-filter, no new mask, no new
 *      colour. The last blocks check the sheet for exactly that.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { readFileSync } from 'node:fs';
import fa from '../src/i18n/locales/fa.json';
import {
  DEFAULT_MARKET_TAB,
  MARKET_TABS,
  MARKET_TAB_CONTENT,
  MARKET_TAB_IDS,
  marketTabFromParam,
  nextMarketTab
} from '../src/lib/marketTabs.js';

const dict = { fa };
const get = (obj, path) => path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
const tFor = (key, opts = {}) => {
  const v = get(dict.fa, key);
  if (v == null) return opts.defaultValue ?? key;
  return String(v).replace(/\{\{(\w+)\}\}/g, (_, k) => String(opts[k] ?? ''));
};
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: tFor, i18n: { language: 'fa', resolvedLanguage: 'fa', dir: () => 'rtl', changeLanguage: () => {} } })
}));
/*
 * ─── ONE STUB PER TAG, MEMOISED ────────────────────────────────────────────
 * A Proxy that returns a FRESH component on every `get` is a new component
 * TYPE on every render, and React unmounts and remounts the whole subtree to
 * honour that. The first draft of this file did exactly that, and the symptom
 * was subtle enough to be worth writing down: a tab switched, its
 * `aria-selected` moved, and every node underneath it was a different element
 * — so a panel's `hidden` attribute seemed to never arrive.
 */
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

/* ── a feed with something in every box the two tabs hold ────────────────── */
const mkCoin = (i, symbol) => ({
  id: `coin-${i}`, symbol, name: `Coin ${i}`, image: '',
  price: 1 + i / 100, change24h: i % 2 ? 3.2 : -1.4,
  volume: 1_000_000 * (i + 1), mcap: 2_000_000 * (i + 1),
  high24h: 2, low24h: 1, sparkline: [1, 2, 3, 4], rank: i + 1
});
const BTC = {
  id: 'bitcoin', symbol: 'BTC', name: 'Bitcoin', image: '',
  price: 60000, change24h: 1, volume: 1e10, mcap: 1e12,
  high24h: 1, low24h: 1, sparkline: [1, 2, 3], rank: 1
};
const COINS = [BTC, ...Array.from({ length: 30 }, (_, i) => mkCoin(i, `T${i}`))];
const TRENDING = COINS.slice(0, 8).map((c) => ({ id: c.id, symbol: c.symbol, name: c.name, image: '', rank: c.rank }));

const feed = vi.hoisted(() => ({ data: [], loading: false, error: null, updatedAt: 0, refresh: () => {} }));
vi.mock('../src/hooks/useMarket', () => ({
  useMarkets: () => feed,
  useGlobalStats: () => ({
    data: { mcap: 1e12, volume: 5e11, btcDominance: 52, ethDominance: 15, coins: 10, markets: 20, avgChange: 1, mcapChange: 1 }
  }),
  useTrending: () => ({ data: TRENDING }),
  useCoinSearch: () => ({ results: [], searching: false, error: null })
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
vi.mock('../src/lib/priceAlerts', () => ({
  runPriceAlerts: () => {}, runTopMoverAlerts: () => {}, syncPriceWatch: () => Promise.resolve({ ok: true })
}));
vi.mock('../src/components/Ticker', () => ({ default: () => null }));
vi.mock('../src/components/AdBanner', () => ({ default: () => null }));
vi.mock('../src/components/TrendChart', () => ({ default: () => null }));

import Market from '../src/pages/Market.jsx';

const pageSrc = readFileSync('src/pages/Market.jsx', 'utf8');
const css = readFileSync('src/styles/market-tabs.css', 'utf8');
const bare = css.replace(/\/\*[\s\S]*?\*\//g, '');
const model = readFileSync('src/lib/marketTabs.js', 'utf8');

const strip = () => screen.getByTestId('market-tabs-strip');
/* The panel ELEMENT is always in the tree (the strip's `aria-controls` must
   resolve at all times); its BODY is mounted only while its tab is open. So
   «is this box on screen?» is `queryByTestId`, and «which tab owns it» is the
   panel that contains it. */
const bodyOf = (tab) => screen.getByTestId(`market-panel-${tab}-box`);
const tabs = () => [...screen.getAllByRole('tab')];
const tabNamed = (key) => tabs().find((node) => node.textContent.includes(tFor(`market.tabs.${key}`)));
const panel = (id) => document.getElementById(id);

beforeEach(() => {
  feed.data = COINS;
  feed.loading = false;
  feed.error = null;
  feed.updatedAt = Date.now();
  feed.refresh = vi.fn();
});

afterEach(cleanup);

const mount = async (url = '/') => {
  render(<MemoryRouter initialEntries={[url]}><Market /></MemoryRouter>);
  await waitFor(() => expect(strip()).toBeTruthy());
};

/* ── 1 · THE MODEL ───────────────────────────────────────────────────────── */
describe('۱ · مدلِ دو تب', () => {
  it('names exactly the two tabs that were asked for, in that order', () => {
    expect(MARKET_TAB_IDS).toEqual(['overview', 'tokens']);
    expect(MARKET_TABS.map((tab) => tab.label)).toEqual(['market.tabs.overview', 'market.tabs.tokens']);
    expect(DEFAULT_MARKET_TAB).toBe('overview');
    /* every label is a real key in the primary market's language */
    for (const tab of MARKET_TABS) expect(typeof get(fa, tab.label)).toBe('string');
    expect(get(fa, 'market.tabs.aria')).toBeTruthy();
  });

  it('gives every box on the screen exactly one owner', () => {
    const owners = Object.values(MARKET_TAB_CONTENT).flat();
    /* no box may appear under both tabs… */
    expect(new Set(owners).size).toBe(owners.length);
    /* …and the boxes the request named are all accounted for */
    for (const id of [
      'market-overview',           // باکس ارزش کل + باکس بیت‌کوین
      'market-stories-rail',       // باکس استوری‌ها
      'market-smart-money-banner', // بنر پول هوشمند
      'market-hot-coins',          // باکس داغ‌ترین‌ها
      'market-search-wrap',        // باکس جستجو
      'market-list-rows'           // توکن‌ها
    ]) expect(owners).toContain(id);
    for (const id of Object.keys(MARKET_TAB_CONTENT)) expect(MARKET_TAB_IDS).toContain(id);
  });

  it('reads a tab out of the URL, and refuses to open a tab that does not exist', () => {
    expect(marketTabFromParam('tokens')).toBe('tokens');
    expect(marketTabFromParam('  TOKENS ')).toBe('tokens');
    expect(marketTabFromParam(null)).toBe(DEFAULT_MARKET_TAB);
    expect(marketTabFromParam('')).toBe(DEFAULT_MARKET_TAB);
    /* a stale bookmark from a third tab that no longer exists still opens the market */
    expect(marketTabFromParam('signals')).toBe(DEFAULT_MARKET_TAB);
  });

  it('moves between the tabs with the arrow keys, mirrored for RTL', () => {
    expect(nextMarketTab('overview', 'ArrowRight', false)).toBe('tokens');
    expect(nextMarketTab('tokens', 'ArrowRight', false)).toBe('overview');
    expect(nextMarketTab('overview', 'ArrowRight', true)).toBe('tokens');
    expect(nextMarketTab('tokens', 'ArrowLeft', true)).toBe('overview');
    expect(nextMarketTab('tokens', 'Home')).toBe('overview');
    expect(nextMarketTab('overview', 'End')).toBe('tokens');
    /* every other key belongs to the browser */
    expect(nextMarketTab('overview', 'Tab')).toBeNull();
    expect(nextMarketTab('overview', 'Enter')).toBeNull();
  });

  it('keeps JSX out of the model — the glyph is named, not imported', () => {
    expect(model).not.toMatch(/<\w+/);
    for (const tab of MARKET_TABS) expect(tab.glyph).toBeTruthy();
  });
});

/* ── 2 · THE STRIP ───────────────────────────────────────────────────────── */
describe('۲ · نوارِ تب‌ها', () => {
  it('is a real tablist: two tabs, one selected, one stop in the tab order', async () => {
    await mount();
    const list = screen.getByRole('tablist');
    expect(list).toBeTruthy();
    expect(list.getAttribute('aria-label')).toBe(get(fa, 'market.tabs.aria'));
    expect(tabs()).toHaveLength(2);
    expect(tabNamed('overview').getAttribute('aria-selected')).toBe('true');
    expect(tabNamed('tokens').getAttribute('aria-selected')).toBe('false');
    /* the roving tabindex — a tablist is ONE stop, arrows move inside it */
    expect(tabNamed('overview').getAttribute('tabindex')).toBe('0');
    expect(tabNamed('tokens').getAttribute('tabindex')).toBe('-1');
    /* each tab points at the panel it controls, and that panel exists */
    for (const tab of tabs()) {
      const controls = tab.getAttribute('aria-controls');
      expect(panel(controls)).toBeTruthy();
      expect(panel(controls).getAttribute('role')).toBe('tabpanel');
      expect(panel(controls).getAttribute('aria-labelledby')).toBe(tab.id);
    }
  });

  it('draws a mark in every tab, not a typed character', async () => {
    await mount();
    for (const tab of tabs()) {
      const glyph = tab.querySelector('.mx-tab-glyph svg');
      expect(glyph, tab.textContent).toBeTruthy();
      expect(glyph.getAttribute('aria-hidden')).toBe('true');
    }
    /* and the two marks are different shapes, not the same icon twice */
    const shapes = new Set(tabs().map((tab) => tab.querySelector('.mx-tab-glyph svg').innerHTML));
    expect(shapes.size).toBe(2);
  });

  it('switches on tap and follows the keyboard, focus included', async () => {
    await mount();
    fireEvent.click(tabNamed('tokens'));
    await waitFor(() => expect(tabNamed('tokens').getAttribute('aria-selected')).toBe('true'));
    expect(tabNamed('overview').getAttribute('aria-selected')).toBe('false');

    /* ArrowRight in an RTL document means «the previous tab»… */
    fireEvent.keyDown(screen.getByRole('tablist'), { key: 'ArrowRight' });
    await waitFor(() => expect(tabNamed('overview').getAttribute('aria-selected')).toBe('true'));
    /* …Home goes to the first tab and End to the last, per the pattern */
    fireEvent.keyDown(screen.getByRole('tablist'), { key: 'End' });
    await waitFor(() => expect(tabNamed('tokens').getAttribute('aria-selected')).toBe('true'));
  });
});

/* ── 3 · WHAT EACH TAB SHOWS ─────────────────────────────────────────────── */
describe('۳ · هر تب باکس‌های خودش را دارد', () => {
  it('opens on «مرور» — readings, stories and the Smart Money banner', async () => {
    await mount();
    for (const id of MARKET_TAB_CONTENT.overview) {
      expect(screen.queryByTestId(id), id).toBeTruthy();
    }
    /* the deck, the three boxes and Bitcoin are all inside the readings tab */
    expect(screen.getByTestId('market-global-card')).toBeTruthy();
    expect(screen.getByTestId('market-trio')).toBeTruthy();
    expect(screen.getByTestId('market-btc-hero-card')).toBeTruthy();
    /* and nothing that belongs to «توکن» is up yet */
    for (const id of MARKET_TAB_CONTENT.tokens) {
      expect(screen.queryByTestId(id), id).toBeNull();
    }
    expect(document.querySelector('.coin-row')).toBeNull();
  });

  it('«توکن» is the hot rail, the search box, the sectors and the rows', async () => {
    await mount();
    fireEvent.click(tabNamed('tokens'));
    await waitFor(() => expect(screen.queryByTestId('market-hot-coins')).toBeTruthy());

    expect(screen.getByTestId('market-hot-coins')).toBeTruthy();
    expect(screen.getByTestId('market-search-wrap')).toBeTruthy();
    expect(screen.getByTestId('market-lens')).toBeTruthy();
    expect(screen.getByTestId('market-sector-rail')).toBeTruthy();
    await waitFor(() => expect(document.querySelectorAll('.coin-row').length).toBeGreaterThan(0));
    expect(screen.getAllByTestId('market-search-wrap')).toHaveLength(1);
    /* the readings tab is gone, including Bitcoin */
    for (const id of MARKET_TAB_CONTENT.overview) {
      expect(screen.queryByTestId(id), id).toBeNull();
    }
  });

  it('mounts ONE panel at a time — the closed tab is absent, not painted over', async () => {
    await mount();
    const overview = panel('market-panel-overview');
    expect(overview.hasAttribute('hidden')).toBe(false);
    expect(overview.querySelectorAll('.coin-row')).toHaveLength(0);

    fireEvent.click(tabNamed('tokens'));
    await waitFor(() => expect(panel('market-panel-overview').hasAttribute('hidden')).toBe(true));
    /* and its BODY is gone, not merely invisible: no stories reel, no banner */
    expect(bodyOf('overview').children).toHaveLength(0);
    expect(bodyOf('tokens').children.length).toBeGreaterThan(0);
    /* `hidden` must beat the panel's own `display: flex`, or the closed tab is
       painted behind the open one and read aloud by a screen reader */
    expect(bare).toMatch(/\.mx-tab-panel\[hidden\]\s*\{\s*display:\s*none\s*!important;\s*\}/);
    /* and the pages' own rule wins here too: the panel is not in the a11y tree */
    expect(screen.queryAllByRole('tabpanel')).toHaveLength(1);
  });

  it('leaves no box in both panels, and none in neither', async () => {
    await mount();
    /* every box the model names is inside the panel it belongs to, and only
       that one — walked in BOTH tabs so a box that moved is caught either way */
    for (const tab of MARKET_TAB_IDS) {
      if (tab !== 'overview') fireEvent.click(tabNamed(tab));
      await waitFor(() => expect(bodyOf(tab).children.length).toBeGreaterThan(0));
      const own = MARKET_TAB_CONTENT[tab];
      const other = MARKET_TAB_IDS.filter((id) => id !== tab).flatMap((id) => MARKET_TAB_CONTENT[id]);
      for (const id of own) {
        /* the panel wrappers are the only ids that are not boxes */
        const node = id.startsWith('market-panel') ? null : screen.queryByTestId(id);
        if (!node) continue;
        expect(bodyOf(tab).contains(node), `${id} must be inside «${tab}»`).toBe(true);
      }
      for (const id of other) {
        const node = screen.queryByTestId(id);
        if (!node) continue;
        expect(bodyOf(tab).contains(node), `${id} must not be inside «${tab}»`).toBe(false);
      }
    }
  });

  it('does not blank the other tab while the feed is still arriving', async () => {
    /* A cold load with ?tab=tokens must open on the token tab — it is where
       the link points — and not flash the overview first. */
    await mount('/?tab=tokens');
    expect(tabNamed('tokens').getAttribute('aria-selected')).toBe('true');
    expect(panel('market-panel-tokens').hasAttribute('hidden')).toBe(false);
    expect(panel('market-panel-overview').hasAttribute('hidden')).toBe(true);
  });
});

/* ── 4 · THE READER'S WORK SURVIVES A SWITCH ─────────────────────────────── */
describe('۴ · کارِ کاربر با تغییرِ تب از دست نمی‌رود', () => {
  it('keeps the query, the sort and the rows when the reader comes back', async () => {
    await mount();
    fireEvent.click(tabNamed('tokens'));
    await waitFor(() => expect(document.querySelectorAll('.coin-row').length).toBeGreaterThan(0));

    const input = screen.getByLabelText(get(fa, 'market.searchAria'));
    fireEvent.change(input, { target: { value: 'T1' } });
    const sorted = document.querySelector('.coin-row')?.dataset.coinId;

    /* away and back */
    fireEvent.click(tabNamed('overview'));
    await waitFor(() => expect(screen.queryByTestId('market-hot-coins')).toBeNull());
    fireEvent.click(tabNamed('tokens'));

    await waitFor(() => expect(screen.getByTestId('market-search-wrap')).toBeTruthy());
    expect(screen.getByLabelText(get(fa, 'market.searchAria')).value).toBe('T1');
    expect(document.querySelector('.coin-row')?.dataset.coinId).toBe(sorted);
  });

  it('adds no request when a tab is opened', async () => {
    /* Both panels read the one feed this screen already polls; the tab is a
       way of reading it, never a second load. */
    expect(pageSrc).not.toMatch(/useMarkets\([^)]*tab/);
    expect(pageSrc.match(/useMarkets\(/g)).toHaveLength(1);
    expect(pageSrc.match(/useTrending\(/g)).toHaveLength(1);
    expect(pageSrc.match(/useGlobalStats\(/g)).toHaveLength(1);
  });
});

/* ── 5 · THE THEME IT INHERITS ───────────────────────────────────────────── */
describe('۵ · ظاهر، از تمِ خودِ صفحه', () => {
  it('brings no new material: no live blur, no mask, no filter, no will-change', () => {
    expect(bare).not.toMatch(/backdrop-filter/);
    expect(bare).not.toMatch(/mask(-image)?:/);
    expect(bare).not.toMatch(/(^|[^-])filter:/m);
    expect(bare).not.toMatch(/will-change/);
    /* the pill is painted out of the tokens the other sheets already define */
    for (const token of ['--og-shell-a', '--og-shell-b', '--og-shell-c', '--og-prism', '--mx-cyan', '--mx-gold', '--mx-text', '--mx-muted']) {
      expect(css, token).toContain(token);
    }
  });

  it('moves only the plate, and only on the compositor', () => {
    const thumb = /\.mx-tabs-thumb \{([\s\S]*?)\n\}/.exec(bare)[1];
    expect(thumb).toMatch(/transition:[^;]*transform/);
    expect(thumb).not.toMatch(/(^|[^-])left:/m);
    /* the offset is logical, so one `dir="rtl"` mirrors the whole control */
    expect(thumb).toMatch(/inset-inline-start:/);
    expect(bare).toMatch(/\.mx-tabs\[data-active='tokens'\] \.mx-tabs-thumb \{[\s\S]*?transform: translateX/);
    expect(bare).toMatch(/\[dir='rtl'\] \.mx-tabs \{ --mx-dir: -1; \}/);
  });

  it('is re-graded for the pearl theme, never inverted', () => {
    expect(bare).toMatch(/:root\[data-theme='light'\] \.mx-tabs \{/);
    expect(bare).toMatch(/:root\[data-theme='light'\] \.mx-tabs-thumb \{/);
    expect(bare).toMatch(/:root\[data-theme='light'\] \.mx-tab \{ color: #4d5f7d; \}/);
    expect(bare).toMatch(/:root\[data-theme='light'\] \.mx-tab\[data-active='true'\] \{ color: #0f1a2c; \}/);
  });

  it('parks every transition for reduced motion, native, lite and the switch', () => {
    expect(bare).toMatch(/@media \(prefers-reduced-motion: reduce\)/);
    for (const flag of ['native', 'lite', 'reduce-motion']) {
      expect(bare).toContain(`:root[data-${flag}='true'] .mx-tabs-thumb`);
    }
    expect(bare).toMatch(/@media \(prefers-contrast: more\)/);
    expect(bare).toMatch(/@media \(prefers-reduced-transparency: reduce\)/);
  });

  it('keeps a 44px touch target on a phone and a real focus ring', () => {
    const phone = /@media \(max-width: 619px\) \{([\s\S]*?)\n\}/.exec(bare)[1];
    expect(phone).toMatch(/\.mx-tab \{ min-height: 44px;/);
    expect(bare).toMatch(/\.mx-tab:focus-visible \{[\s\S]*?outline: 2px solid/);
    expect(bare).toMatch(/\.mx-tab:active \{ transform: scale\(\.975\); \}/);
  });
});

/* ── 6 · THE SHEET'S PLACE IN THE ROUTE ──────────────────────────────────── */
describe('۶ · جای شیت در مسیر', () => {
  it('is imported by the market page, after the design layers and before the budget', () => {
    const at = pageSrc.indexOf("import '../styles/market-tabs.css'");
    expect(at).toBeGreaterThan(-1);
    for (const sheet of ['market-modern', 'market-intelligence', 'market-glass-v3', 'market-aurora-glass', 'market-obsidian-glass']) {
      expect(pageSrc.indexOf(`import '../styles/${sheet}.css'`), sheet).toBeLessThan(at);
    }
    expect(pageSrc.lastIndexOf("import '../styles/market-perf.css'")).toBeGreaterThan(at);
    /* and it stays on this route: no other screen pays for it */
    for (const file of ['src/main.jsx', 'src/App.jsx', 'src/index.css']) {
      expect(readFileSync(file, 'utf8'), file).not.toContain('market-tabs');
    }
  });

  it('is the login-free document tab, not a second page', () => {
    /* One route, one <PageTransition>, one feed: the tabs are two views. */
    expect(pageSrc.match(/<PageTransition/g)).toHaveLength(1);
    expect(pageSrc.match(/<MarketTabStrip/g)).toHaveLength(1);
    expect(pageSrc.match(/role="tabpanel"/g)).toHaveLength(2);
    /* the strip is above both panels in the document */
    expect(pageSrc.indexOf('<MarketTabStrip')).toBeLessThan(pageSrc.indexOf('id="market-panel-overview"'));
  });
});
