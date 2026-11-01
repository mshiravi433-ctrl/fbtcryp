// @vitest-environment jsdom
/** Prism glass regression: real values, independent surfaces, bare categories,
 * detached swap, and composited motion that respects the user's settings. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { readFileSync } from 'node:fs';
import fa from '../src/i18n/locales/fa.json';
import en from '../src/i18n/locales/en.json';



const dict = { fa, en };
const get = (obj, path) => path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
const tFor = (lang) => (key, opts = {}) => {
  let v = get(dict[lang], key);
  if (v == null) v = get(dict.en, key);
  if (v == null) return opts.defaultValue ?? key;
  return String(v).replace(/\{\{(\w+)\}\}/g, (_, k) => String(opts[k] ?? ''));
};
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: tFor('fa'), i18n: { language: 'fa', resolvedLanguage: 'fa', changeLanguage: () => {} } })
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

/* ── a feed with a face: BTC, ETH and 30 alternates, plus eight trending ─── */
const mkCoin = (i, symbol) => ({
  id: `coin-${i}`, symbol, name: `Coin ${i}`, image: '',
  price: 1 + i / 100, change24h: i % 2 ? 3.2 : -1.4,
  volume: 1_000_000 * (i + 1), mcap: 2_000_000 * (i + 1),
  high24h: 2, low24h: 1, sparkline: [1, 2, 3, 4], rank: i + 3
});
const COINS = [
  { id: 'bitcoin', symbol: 'BTC', name: 'Bitcoin', image: '', price: 92450, change24h: 2.41, volume: 3.9e10, mcap: 1.83e12, high24h: 93200, low24h: 89500, sparkline: [89500, 90200, 91400, 92450], rank: 1 },
  { id: 'ethereum', symbol: 'ETH', name: 'Ethereum', image: '', price: 3420, change24h: 4.12, volume: 1.9e10, mcap: 4.1e11, high24h: 3480, low24h: 3290, sparkline: [3300, 3350, 3400, 3420], rank: 2 },
  ...Array.from({ length: 30 }, (_, i) => mkCoin(i, `T${i}`))
];
const TRENDING = COINS.slice(0, 8).map((c, i) => ({ id: c.id, symbol: c.symbol, name: c.name, image: '', rank: c.rank, score: 40 - i }));

const feed = vi.hoisted(() => ({ data: [], loading: false, error: null, updatedAt: 0, refresh: () => {} }));
vi.mock('../src/hooks/useMarket', () => ({
  useMarkets: () => feed,
  useGlobalStats: () => ({
    data: { mcap: 3.152e12, volume: 1.42e11, btcDominance: 56.4, ethDominance: 13.8, coins: 14820, markets: 1124, avgChange: 2.35, mcapChange: 2.84 }
  }),
  useTrending: () => ({ data: TRENDING }),
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
/* The stories rail has its own suite (market-stories-and-aparat); here it only
   has to EXIST, in the right place, so the artwork is stubbed out. */
vi.mock('../src/components/MarketStories', () => ({
  default: () => <div className="market-stories-section" data-testid="market-stories-rail" />
}));

/*
 * ─── EVERY ONE OF THESE MOUNTS NOW OPENS ON «مرور» ─────────────────────────
 * The screen has two tabs (see lib/marketTabs.js). These files were written
 * against a one-page market, so the rows they are about live one tab away.
 *
 * `openTokensTab()` is the tab switch, driven through the real control — the
 * tab is found by ROLE and NAME, exactly as a reader would find it — and it
 * does not shortcut the URL: a test that set `?tab=` directly would prove the
 * URL works while leaving the button itself unproven.
 */
const openTokensTab = () => {
  const tab = screen
    .queryAllByRole('tab')
    .find((node) => node.textContent.includes(fa.market.tabs.tokens));
  if (tab) fireEvent.click(tab);
};

const tabNamed = (key) => screen
  .queryAllByRole('tab')
  .find((node) => node.textContent.includes(fa.market.tabs[key]));

import Market from '../src/pages/Market.jsx';

const css = readFileSync('src/styles/market-intelligence.css', 'utf8');
const bare = css.replace(/\/\*[\s\S]*?\*\//g, '');
const pageSrc = readFileSync('src/pages/Market.jsx', 'utf8');
const after = (a, b) => Boolean(a) && Boolean(b) &&
  (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;

beforeEach(() => {
  feed.data = COINS;
  feed.loading = false;
  feed.error = null;
  feed.updatedAt = Date.now();
  feed.refresh = () => {};
});
afterEach(cleanup);

/*
 * ─── TWO TABS, SO TWO DOORS ────────────────────────────────────────────────
 * The screen is split («مرور» / «توکن», see lib/marketTabs.js). The boxes this
 * file is mostly about — the deck, the trio, Bitcoin, the stories, the blade —
 * are on the first tab, which is where the screen opens; the list, its search
 * field and its controls are on the second.
 *
 * `open()` therefore only waits for the screen, and the tests that then read a
 * row call `openList()` — which switches tab through the REAL control, found
 * by role and name exactly as a reader finds it, rather than by setting a URL
 * the button itself never touches.
 */
const open = async () => {
  render(<MemoryRouter><Market /></MemoryRouter>);
  await waitFor(() => expect(screen.getByTestId('market-tabs-strip')).toBeTruthy());
};
const openList = async () => {
  await open();
  openTokensTab();
  await waitFor(() => expect(document.querySelectorAll('.coin-row').length).toBeGreaterThan(0));
};
describe('۱/۲ · independent overview and Bitcoin readings', () => {
  it('reads deck, then three boxes, then Bitcoin — in that order, in three boxes', async () => {
    await open();
    const overview = screen.getByTestId('market-overview');
    const globalCard = screen.getByTestId('market-global-card');
    const trio = screen.getByTestId('market-trio');
    const btcCard = screen.getByTestId('market-btc-hero-card');

    expect(overview.contains(globalCard)).toBe(true);
    expect(overview.contains(btcCard)).toBe(true);
    /* «بعدش یک فاصله کوچک … سه باکس … بعدش باکس بیت‌کوین», in the document. */
    expect(after(globalCard, trio)).toBe(true);
    expect(after(trio, btcCard)).toBe(true);
    /* three siblings of the deck's own column, so the gap between them is the
       page rhythm and not padding invented inside one of them */
    expect(globalCard.classList.contains('mx-deck')).toBe(true);
    expect(btcCard.classList.contains('mx-btc-card')).toBe(true);

    /* The deck has its own head, its kicker and its painted light field. */
    expect(globalCard.querySelector('.mx-deck-head')).toBeTruthy();
    expect(globalCard.querySelector('.mx-deck-veil')).toBeTruthy();
    expect(globalCard.textContent).toContain(fa.marketIntel.deckLabel);
  });

  it('lines the three stat boxes up on one row of three equal columns', async () => {
    await open();
    const boxes = [...screen.getByTestId('market-trio').querySelectorAll('.mx-trio-box')];
    expect(boxes).toHaveLength(3);
    /* «ارزها · بازارها · میانگین تغییر», in that order, each with its own mark */
    expect(boxes[0].textContent).toContain(fa.marketIntel.statCoins);
    expect(boxes[1].textContent).toContain(fa.marketIntel.statMarkets);
    expect(boxes[2].textContent).toContain(fa.marketIntel.statAvg);
    expect(boxes.every((box) => box.querySelector('.mx-trio-mark svg'))).toBe(true);
    /* the average box carries its own direction, so a green number is a reading */
    expect(boxes[2].dataset.tone).toBe('up');
    /* one line, three equal columns, at every width — never a wrap */
    expect(bare).toMatch(/\.mx-trio \{[^}]*grid-template-columns: repeat\(3, minmax\(0, 1fr\)\)/);
  });

  it('paints the glass with gradients and never with a live blur', () => {
    expect(bare).not.toMatch(/backdrop-filter/);
    expect(bare).not.toMatch(/will-change/);
    /* One shared recipe for the five big surfaces — the reason the page reads
       as one machine instead of six widgets. */
    expect(bare).toMatch(/\.mx-market \.mx-deck,[\s\S]*?\.mx-market \.mx-lens \{[^}]*background: var\(--mx-glass\), var\(--mx-panel\)/);
    expect(bare).toMatch(/\.mx-market \.mx-overview \{[^}]*border-radius: 26px/);
  });

  it('reads dominance as a bar and a legend, with drawn marks for every metric', async () => {
    await open();
    const globalCard = screen.getByTestId('market-global-card');
    expect(globalCard.querySelector('.mx-dominance .is-btc')).toBeTruthy();
    expect(globalCard.querySelector('.mx-dominance-legend')).toBeTruthy();
    /* three metric pods, each with its own icon tile */
    expect(globalCard.querySelectorAll('.mx-metric')).toHaveLength(3);
    expect(globalCard.querySelectorAll('.mx-metric-icon svg')).toHaveLength(3);
    /* the three counts left the deck's footer: they are their own boxes now,
       each with a drawn mark, and the deck does not repeat them */
    expect(globalCard.querySelector('.mx-global-foot')).toBeNull();
    expect(screen.getByTestId('market-trio').querySelectorAll('.mx-trio-mark svg')).toHaveLength(3);
  });

  it('gives Bitcoin its own glass card, a full-bleed logo and one control', async () => {
    await open();
    const btcCard = screen.getByTestId('market-btc-hero-card');
    expect(btcCard.querySelectorAll('button')).toHaveLength(1);
    expect(btcCard.querySelector('.mx-btc-logo svg')).toBeTruthy();
    expect(btcCard.querySelector('.mx-btc-range-track span')).toBeTruthy();
    /* «شیشه‌ای» — a painted bloom over several gradient layers, no live blur */
    expect(btcCard.querySelector('.mx-btc-veil')).toBeTruthy();
    expect(bare).toMatch(/\.mx-market \.mx-btc-card \{[^}]*border-radius: 24px/);
    /* «نمودارش وسط قرار بگیره» — the price column is centred, not left-aligned */
    expect(bare).toMatch(/\.mx-btc-price \{[^}]*text-align: center/);
    /* and it is a CARD now, not the right column of a two-column grid: the
       deck's grid is gone, so nothing can re-nest Bitcoin inside it */
    expect(pageSrc).not.toMatch(/mx-deck-grid/);
    expect(bare).not.toMatch(/grid-template-columns: minmax\(0, 1\.5fr\) minmax\(300px, 1fr\)/);
  });
});

describe('۲ · the Smart Money blade shows the route', () => {
  it('answers its own headline with a route, three destinations and a CTA', async () => {
    await open();
    const blade = screen.getByTestId('market-smart-money-banner');
    expect(blade.querySelector('.mx-smart-mark svg')).toBeTruthy();
    expect(blade.querySelector('.mx-smart-art')).toBeNull();
    expect(blade.textContent).toContain(fa.marketIntel.smartCta);
    /* the eyebrow is translated, never a hardcoded English string */
    expect(pageSrc).not.toContain('FBT SMART MONEY');
    expect(blade.textContent).toContain(fa.marketIntel.smartEyebrow);

    /* «ببین پول هوشمند کجا می‌رود» — wallet, router, destination, drawn */
    const route = blade.querySelector('.mx-smart-route');
    expect(route).toBeTruthy();
    expect(route.querySelectorAll('.mx-route-node')).toHaveLength(3);
    expect(route.textContent).toContain(fa.marketIntel.flowWallet);
    expect(route.textContent).toContain(fa.marketIntel.flowTarget);
    /* three named pools, and not one invented percentage on the card */
    expect(blade.querySelectorAll('.mx-pool')).toHaveLength(3);
    expect(blade.textContent).toContain(fa.marketIntel.pool.whales);
    expect(blade.textContent).not.toMatch(/\d+%/);
  });

  it('keeps its ambient loops travelling instead of blinking', () => {
    expect(bare).toMatch(/\.mx-smart-sheen \{[^}]*animation: mx-blade-sweep 9s[^}]*infinite/);
    /* CSS can stop ALL motion; SVG/SMIL animation bypassed the old guards. */
    const bannerSrc = readFileSync('src/components/market/SmartMoneyBanner.jsx', 'utf8');
    expect(bannerSrc).not.toMatch(/<animate/);
    expect(bannerSrc).toContain('mx-route-traveller');
    expect(bare).toMatch(/@keyframes mx-flow-travel/);
    expect(bare).toMatch(/\.mx-smart-ring \{[^}]*animation: mx-smart-ring/);
    expect(bare).toMatch(/@keyframes mx-blade-sweep/);
    /* No opacity strobe on any dot: the green blink was already banned by
       market-speed.test.mjs, and this pass adds nothing that pulses. */
    expect(bare).toMatch(/\.mx-deck-live i \{(?![^}]*animation)/);
    expect(bare).toMatch(/\.mx-fresh i \{(?![^}]*animation)/);
  });
});

describe('aurora market showcase', () => {
  it('keeps the light wave decorative and breadth values tied to the feed', async () => {
    await openList();
    const breadth = screen.getByTestId('market-breadth');
    const aurora = breadth.querySelector('.mx-breadth-aurora');
    expect(aurora?.getAttribute('aria-hidden')).toBe('true');
    expect(aurora.querySelectorAll('path')).toHaveLength(3);
    expect(breadth.querySelector('.mx-breadth-bar')).toBeTruthy();
    expect(screen.getByTestId('market-breadth-up').textContent).toContain('17');
    expect(screen.getByTestId('market-breadth-down').textContent).toContain('15');
    expect(bare).toMatch(/@keyframes mx-aurora-drift/);
    expect(bare).toMatch(/data-native='true'\] \.mx-market \.mx-aurora-echo/);
    expect(bare).toMatch(/data-lite='true'\] \.mx-market \.mx-aurora-echo/);
  });
});

describe('۳ · «داغ‌ترین کوین‌ها» carries one accent per place', () => {
  it('ranks the first three cards and hands each its own hue', async () => {
    await openList();
    const rail = screen.getByTestId('market-hot-coins');
    const cards = rail.querySelectorAll('.mx-hot-card');
    expect(cards.length).toBe(8);
    expect(cards[0].dataset.place).toBe('1');
    expect(cards[1].dataset.place).toBe('2');
    expect(cards[2].dataset.place).toBe('3');
    expect(cards[3].dataset.place).toBe('n');
    expect(rail.querySelector('.mx-hot-flame svg')).toBeTruthy();
    /* the change chip is a drawn arrow, not a typed one */
    expect(rail.querySelector('.mx-change svg')).toBeTruthy();
    expect(rail.textContent).not.toMatch(/[↗↘▲▼]/);
  });

  it('defines the four accents and lets one property drive the whole card', () => {
    for (const place of ['1', '2', '3', 'n']) {
      expect(bare).toMatch(new RegExp(`\\.mx-hot-card\\[data-place='${place}'\\] \\{ --hot:`));
    }
    expect(bare).toMatch(/\.mx-hot-sheen \{[^}]*var\(--hot\)/);
    expect(bare).toMatch(/\.mx-hot-rank \{[^}]*var\(--hot\)/);
  });
});

describe('۵ · search above the filters, inside «همه ارزها»', () => {
  it('keeps search in the list and sectors on a separate rail below the controls', async () => {
    await openList();
    const lens = document.querySelector('.mx-lens');
    const terminal = document.querySelector('.market-terminal');
    const search = document.querySelector('.mx-search-wrap');
    const heroHead = document.querySelector('.mx-list-hero-head');
    const controls = document.querySelector('.mx-controls');
    const breadth = screen.getByTestId('market-breadth');
    const sectors = document.querySelector('.mx-sectors');
    const firstRow = document.querySelector('.coin-row');

    /* the field still sits between the list's title and its chips */
    expect(terminal.contains(search)).toBe(true);
    expect(after(heroHead, search)).toBe(true);
    expect(after(search, controls)).toBe(true);
    expect(after(controls, firstRow)).toBe(true);

    /* «زیر باکس‌هایی مثل میم‌کوین را از باکس جدا کن … زیر تب» — the sector rail
       is no longer inside the list card at all: it has a surface of its own,
       between the list controls and the rows. */
    expect(terminal.contains(sectors)).toBe(false);
    expect(lens.contains(sectors)).toBe(false);
    expect(after(terminal, sectors)).toBe(true);
    expect(after(sectors, firstRow)).toBe(true);
    expect(lens.contains(breadth)).toBe(true);
    /* «باکس همه ارزها را فاصله بده با باکس نبض بازار» — two boxes, a gap apart */
    expect(lens.contains(terminal)).toBe(false);
    expect(after(lens, terminal)).toBe(true);
  });

  it('is neon by gradient hairline, not by blur or by a mask', () => {
    expect(bare).toMatch(/\.mx-search \{[^}]*padding-box[^}]*border-box/s);
    expect(bare).not.toMatch(/mask(-image)?:/);
    /* the sweep on focus runs ONCE — a permanently pulsing input is a strobe */
    expect(bare).toMatch(/\.mx-search:focus-within \.mx-search-glow \{ animation: mx-neon-sweep 0\.9s[^}]*1; \}/);
  });

  it('offers the natural-language capability as a chip that steps aside when typing', async () => {
    await openList();
    const chip = document.querySelector('.mx-search-ai');
    expect(chip).toBeTruthy();
    expect(chip.textContent).toContain(fa.marketIntel.aiChip);
    expect(bare).toMatch(/\.mx-search\[data-typed='true'\] \.mx-search-ai \{ display: none; \}/);
  });
});

describe('۵ · filters, نبض بازار and طلا→سولانا', () => {
  it('gives every filter chip and every sector tab a distinct drawn mark', async () => {
    await openList();
    const views = [...document.querySelectorAll('.mx-view')];
    expect(views).toHaveLength(5);
    /* the icon class sits on the svg itself — these are inline marks, not sprites */
    expect(views.every((v) => v.querySelector('svg.mx-view-icon'))).toBe(true);

    const sectors = [...document.querySelectorAll('.mx-sector')];
    expect(sectors.map((s) => s.dataset.sector)).toEqual(['all', 'gold', 'meme', 'rwa', 'ai', 'gaming', 'solana']);
    expect(sectors.every((s) => s.querySelector('svg.mx-sector-icon'))).toBe(true);
    /* six tabs, six different silhouettes */
    const shapes = new Set(sectors.map((s) => s.querySelector('svg.mx-sector-icon').innerHTML));
    expect(shapes.size).toBe(7);
  });

  it('pins the sector rail horizontal, snapping, and un-masked', () => {
    expect(bare).toMatch(/\.mx-sectors-rail \{[^}]*overflow-x: auto[^}]*scroll-snap-type: x/s);
    expect(bare).toMatch(/\.mx-sector \{[^}]*scroll-snap-align: start/s);
    expect(pageSrc).toContain('<MarketSectorRail');
    expect(bare).toMatch(/\.mx-market \.mx-sector-rail \{[^}]*border: 0[^}]*background: none/s);
    for (const sector of ['gold', 'meme', 'rwa', 'ai', 'gaming', 'solana']) {
      expect(bare).toMatch(new RegExp(`\\.mx-sector\\[data-sector='${sector}'\\] \\{ --sec: #`));
    }
  });

  it('turns نبض بازار into an instrument with its own accent edge', async () => {
    await openList();
    const breadth = screen.getByTestId('market-breadth');
    expect(breadth.dataset.tone).toBe('up');
    expect(breadth.querySelector('.mx-breadth-mark svg')).toBeTruthy();
    expect(breadth.querySelector('.mx-breadth-avg')).toBeTruthy();
    expect(breadth.querySelectorAll('.mx-breadth-item')).toHaveLength(2);
    expect(breadth.textContent).toContain(fa.market.breadthTitle);
    expect(bare).toMatch(/\.mx-market \.mx-lens \{[^}]*padding-box[^}]*border-box/s);
    expect(bare).toMatch(/\.mx-market \.mx-breadth \{[^}]*border: 0[^}]*background: none/s);
  });

  it('modernises the swap button and the token row without moving a number', async () => {
    await openList();
    const row = document.querySelector('.mx-coin-row');
    expect(row.querySelector('.coin-change-pill svg')).toBeTruthy();
    expect(row.textContent).not.toMatch(/[▲▼]/);
    /* the button keeps its label and its test id — only the artwork changed */
    const swap = screen.getByTestId('market-swap-bitcoin');
    expect(swap.querySelector('svg')).toBeTruthy();
    expect(swap.textContent).toContain(fa.market.swap);
  });
});

describe('۶ · the stories box sits between the hot rail and the blade', () => {
  it('is in that order in the document, and joins the page rhythm', async () => {
    /*
     * ─── THE SAME THREE BOXES, NOW ONE TAB APART ───────────────────────────
     * «در صفحه بازار دو تب کن» split this column: the stories and the blade
     * are on «مرور» (with the readings), the hot rail and the list are on
     * «توکن». So the order is asserted as the reader meets it — «مرور» holds
     * the deck, then the stories, then the blade; «توکن» holds the hot rail
     * above the list — and the one thing that must not be reordered inside a
     * panel is each panel's own reading order.
     */
    await open();
    const overview = screen.getByTestId('market-overview');
    const stories = screen.getByTestId('market-stories-rail');
    const blade = screen.getByTestId('market-smart-money-banner');
    expect(after(overview, stories)).toBe(true);
    expect(after(stories, blade)).toBe(true);

    fireEvent.click(tabNamed('tokens'));
    await waitFor(() => expect(screen.queryByTestId('market-hot-coins')).toBeTruthy());
    const hot = screen.getByTestId('market-hot-coins');
    expect(after(hot, document.querySelector('.market-terminal'))).toBe(true);
    expect(after(hot, screen.getByTestId('market-lens'))).toBe(true);
    /* its margins come from the page gap now, not from the box itself */
    expect(bare).toMatch(/\.mx-stories \.market-stories-section \{[^}]*margin: 0/s);
  });
});

describe('۷ · motion, theme and language on the first screen', () => {
  it('animates transform and opacity only, in every keyframe it ships', () => {
    /* Brace-matched, not regex-matched: two of these keyframes are written on
       one line and a `[^}]*` scan would have read half of each. */
    const frames = [];
    for (const m of bare.matchAll(/@keyframes\s+([\w-]+)\s*\{/g)) {
      let depth = 1;
      let i = m.index + m[0].length;
      const start = i;
      while (i < bare.length && depth > 0) {
        if (bare[i] === '{') depth += 1;
        else if (bare[i] === '}') depth -= 1;
        i += 1;
      }
      frames.push([m[1], bare.slice(start, i - 1)]);
    }
    expect(frames.length).toBeGreaterThanOrEqual(3);
    for (const [name, body] of frames) {
      const props = new Set([...body.matchAll(/[{;]\s*([a-z-]+)\s*:/g)].map((x) => x[1]));
      /* The whitelist is "what the compositor can carry on its own": transform
         and opacity, plus the individual transform properties. Nothing that
         forces a repaint per frame — a stroke dash offset and a live filter are
         exactly what this catches. */
      const legal = ['transform', 'opacity', 'scale', 'translate', 'rotate'];
      const illegal = [...props].filter((prop) => !legal.includes(prop));
      expect(illegal, `${name} animates ${illegal.join(', ')}`).toEqual([]);
    }
    /* …and the sheet keeps the float keyframe the stories suite pins. */
    expect(bare).toMatch(/@keyframes mx-float/);
  });

  it('stops every loop and transition for reduced motion, native and lite', () => {
    const guard = bare.slice(bare.indexOf('@media (prefers-reduced-motion: reduce)'));
    expect(guard).toMatch(/animation: none !important/);
    expect(guard).toMatch(/transition: none !important/);
    expect(guard).toMatch(/transform: none/);
    expect(bare).toMatch(/:root\[data-native='true'\] \.mx-market \.mx-deck-veil i/);
    expect(bare).toMatch(/:root\[data-lite='true'\] \.mx-market \.mx-smart-sheen/);
  });

  it('re-grades the same hierarchy for the light theme instead of inverting it', () => {
    expect(bare).toMatch(/:root\[data-theme='light'\] \.mx-market \{[^}]*--mx-panel: #ffffff/s);
    expect(bare).toMatch(/:root\[data-theme='light'\] \.mx-market \{[^}]*--mx-up:/s);
    /* the chips the earlier pass themed in market-modern.css are re-graded here
       at a specificity that actually wins, so light mode is the same design */
    expect(bare).toMatch(/:root\[data-theme='light'\] \.mx-market \.mx-view\[data-active='true'\]/);
    expect(bare).toMatch(/:root\[data-theme='light'\] \.mx-market \.mx-sector\[data-active='true'\]/);
    expect(bare).toMatch(/:root\[data-theme='light'\] \.mx-market \.mx-breadth \{/);
  });

  it('adds its four new strings to fa and en, and to nothing else', () => {
    for (const key of ['marketIntel.deckLabel', 'marketIntel.deckLive', 'marketIntel.aiChip', 'marketIntel.smartEyebrow']) {
      expect(get(fa, key), `fa.${key}`).toBeTruthy();
      expect(get(en, key), `en.${key}`).toBeTruthy();
    }
    /* The blade's headline is sentence case in English now: an ALL-CAPS banner
       is the loud version of the thing the request asked to make minimal. */
    expect(en.marketIntel.smartTitle).toBe('See where smart money moves');
  });

  it('draws the pulse rail\'s three rings instead of typing them', async () => {
    await openList();
    /* «نبض بازار» is on this screen twice: the breadth instrument inside the
       list, and the edge rail the owner built to dismiss itself. Both are SVG. */
    const orb = document.querySelector('.dor');
    expect(orb).toBeTruthy();
    expect(orb.querySelectorAll('.dor-ring > svg')).toHaveLength(3);
    expect(orb.querySelector('.dor-info summary svg')).toBeTruthy();
    expect(orb.textContent).not.toMatch(/[◈ⓘ↗↘]/);
  });

  it('leaves no typed arrow, tick or emoji in the screen it redraws', async () => {
    /* Both tabs, because the rule is about the whole screen: nothing may
       arrive as platform artwork with its own weight and baseline. */
    await openList();
    fireEvent.click(tabNamed('overview'));
    await waitFor(() => expect(screen.queryByTestId('market-overview')).toBeTruthy());
    const body = document.body.textContent;
    expect(body).not.toMatch(/[↗↘↑↓▲▼✓◈ⓘ]/);
    for (const file of ['src/pages/Market.jsx', 'src/components/market/MarketOverview.jsx',
      'src/components/market/HotCoins.jsx', 'src/components/market/SmartMoneyBanner.jsx',
      'src/components/CoinRow.jsx', 'src/components/market/MarketGlyphs.jsx',
      'src/components/DecisionOrb.jsx']) {
      const src = readFileSync(file, 'utf8');
      expect(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2190}-\u{21FF}\u{25B2}\u{25BC}]/u.test(src), file).toBe(false);
    }
  });
});

describe('۸ · relocated folding and honest progressive pagination', () => {
  it('keeps 60 initial rows; folds from the footer without losing total or pagination', async () => {
    feed.data = [...COINS, ...Array.from({ length: 43 }, (_, i) => mkCoin(100 + i, `X${i}`))];
    await openList();
    const fold = screen.getByTestId('market-list-fold');
    const count = screen.getByTestId('market-count').textContent;
    const rows = () => document.querySelectorAll('#market-list-rows .coin-row').length;
    expect(fold.closest('.mx-more')).not.toBeNull();
    expect(document.querySelector('.mx-list-hero').contains(fold)).toBe(false);
    expect(fold.getAttribute('aria-controls')).toBe('market-list-rows');
    expect(fold.getAttribute('aria-expanded')).toBe('true');
    expect(rows()).toBe(60);
    fireEvent.click(fold);
    expect(rows()).toBe(12);
    expect(fold.getAttribute('aria-expanded')).toBe('false');
    expect(screen.getByTestId('market-count').textContent).toBe(count);
    expect(screen.getByTestId('market-showing').textContent).toContain('12');
    expect(document.querySelector('.market-show-more')).toBeNull();
    fireEvent.click(fold);
    expect(rows()).toBe(60);
    fireEvent.click(document.querySelector('.market-show-more'));
    expect(rows()).toBe(75);
    expect(document.querySelector('.market-show-more')).toBeNull();
    fireEvent.click(fold);
    expect(rows()).toBe(12);
    fireEvent.click(fold);
    expect(rows()).toBe(75);
    expect(screen.getByTestId('market-count').textContent).toBe(count);
  });

  it('does not offer a useless fold for a short search result', async () => {
    feed.data = COINS.slice(0, 5);
    await openList();
    expect(screen.queryByTestId('market-list-fold')).toBeNull();
    expect(document.querySelectorAll('#market-list-rows .coin-row')).toHaveLength(5);
  });

  it('paints only the coin card, with an independently named swap beside it', async () => {
    await openList();
    const swap = screen.getByTestId('market-swap-bitcoin');
    const row = swap.closest('.mx-coin-row');
    expect(row.querySelector('.coin-row').contains(swap)).toBe(false);
    expect(swap.getAttribute('aria-label')).toContain('BTC');
    expect(bare).toMatch(/\.mx-market \.mx-coin-row \{[^}]*background: none/s);
    expect(bare).toMatch(/\.mx-market \.mx-coin-row > \.coin-row \{[^}]*gradient/s);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   ۹ · THE NEON DECK
   «باکس نمای بازار شیشه‌ای با نئون نورانی دور باکس … دامیننس بیت‌کوین،
    اتریوم و حجم ۲۴ ساعته خیلی مدرن‌تر … انیمیشن خاص و مدرن»
   The pins below hold the three promises that matter: the neon is painted
   (not a live blur), the motion is compositor-only, and every bright number is
   still the feed's number.
   ══════════════════════════════════════════════════════════════════════════ */
describe('۹ · the neon deck', () => {
  it('builds the rim out of a gradient hairline, comets and one breathing glow', () => {
    expect(bare).toMatch(/\.mx-market \.mx-deck \{[^}]*border: 1\.5px solid transparent/s);
    expect(bare).toMatch(/\.mx-market \.mx-deck \{[^}]*border-box/s);
    expect(bare).toMatch(/\.mx-deck-orbit\b/);
    expect(bare).toMatch(/\.mx-deck-sheen \{[^}]*animation: mx-blade-sweep/s);
    /* the comets travel; they never strobe */
    expect(bare).toMatch(/\.mx-deck-orbit i \{[^}]*animation: mx-orbit-x/s);
    expect(bare).toMatch(/@keyframes mx-orbit-x\b/);
    expect(bare).toMatch(/@keyframes mx-orbit-y\b/);
    expect(bare).toMatch(/@keyframes mx-rim-breathe/);
    expect(bare).toMatch(/@keyframes mx-chart-scan/);
    expect(bare).toMatch(/@keyframes mx-live-ping/);
    expect(bare).not.toMatch(/animation:[^;]*filter/);
  });

  it('draws each dominance arc from the reading itself', async () => {
    await open();
    const arcs = [...document.querySelectorAll('.mx-deck .mx-ring-arc')];
    expect(arcs).toHaveLength(2);
    /* pathLength="100" means the dash array IS the percentage */
    expect(arcs[0].getAttribute('stroke-dasharray')).toBe('56.4 43.6');
    expect(arcs[1].getAttribute('stroke-dasharray')).toBe('13.8 86.2');
    expect(arcs.every((arc) => arc.getAttribute('pathLength') === '100')).toBe(true);
    expect(bare).toMatch(/\.mx-ring-arc \{[^}]*stroke: var\(--mx-accent\)/);
    /* the ring is the metric's own accent, one token for ring, tile and text */
    expect(bare).toMatch(/\.mx-metric\[data-tone='gold'\] \{ --mx-accent: var\(--mx-gold\)/);
    expect(bare).toMatch(/\.mx-metric\[data-tone='violet'\] \{ --mx-accent: var\(--mx-violet\)/);
  });

  it('keeps volume a number plus a real ratio, never a decorative meter', async () => {
    await open();
    const metrics = [...document.querySelectorAll('.mx-deck .mx-metric')];
    expect(metrics).toHaveLength(3);
    const volume = metrics.find((m) => m.textContent.includes(fa.market.volume24h));
    expect(volume.querySelector('.mx-metric-ring')).toBeNull();
    expect(volume.textContent).toContain('$142.00B');
    /* 1.42e11 ÷ 3.152e12 = 4.5% — computed from the same two feed values */
    expect(volume.textContent).toContain(fa.market.turnover.replace('{{pct}}', '4.5%'));
    /* the note never drags the reading off its line: it is the last child */
    expect(volume.querySelector('.mx-metric-text').lastElementChild.classList.contains('mx-metric-note')).toBe(true);
  });

  it('lights the trend with a bloom path, a live dot and a one-shot reveal', async () => {
    await open();
    const trend = screen.getByTestId('global-market-trend');
    expect(trend.querySelector('.mx-spark-bloom')).toBeTruthy();
    expect(trend.querySelector('.mx-spark-live i')).toBeTruthy();
    expect(trend.querySelector('.mx-trend-scan')).toBeTruthy();
    expect(trend.querySelector('.mx-trend-halo')).toBeTruthy();
    expect(bare).toMatch(/\.mx-trend-chart svg \{[^}]*animation: mx-chart-unfold/s);
    /* the dot marks the newest sample (the chart is always LTR) */
    const live = trend.querySelector('.mx-spark-live');
    expect(parseFloat(live.style.left)).toBeGreaterThan(95);
    /* the bloom is a second path, not a CSS filter on the stroke */
    expect(bare).toMatch(/\.mx-spark-bloom \{[^}]*stroke-width/s);
  });

  it('counts every light layer as decoration', async () => {
    await open();
    const card = screen.getByTestId('market-global-card');
    expect(card.querySelectorAll('.mx-deck-orbit i')).toHaveLength(6);
    for (const selector of ['.mx-deck-veil', '.mx-deck-matrix', '.mx-deck-orbit', '.mx-deck-sheen']) {
      expect(card.querySelector(selector).getAttribute('aria-hidden'), selector).toBe('true');
    }
    /* and the deck keeps the flat, honest "live" dot it had */
    expect(bare).toMatch(/\.mx-deck-live i \{(?![^}]*animation)/);
  });

  it('stops the deck light for native, lite and reduced motion', () => {
    expect(bare).toMatch(/:root\[data-native='true'\] \.mx-market \.mx-deck-orbit i/);
    expect(bare).toMatch(/:root\[data-lite='true'\] \.mx-market \.mx-deck-orbit i/);
    expect(bare).toMatch(/:root\[data-native='true'\] \.mx-market \.mx-trend-chart svg/);
    expect(bare).toMatch(/:root\[data-lite='true'\] \.mx-market \.mx-deck::after/);
    expect(bare).toMatch(/:root\[data-native='true'\] \.mx-market :is\(\.mx-deck-sheen/s);
  });

  it('re-grades the same rim for the pearl theme', () => {
    expect(bare).toMatch(/:root\[data-theme='light'\] \.mx-market \.mx-deck \{[^}]*border-box/s);
    expect(bare).toMatch(/:root\[data-theme='light'\] \.mx-market \.mx-metric \{/);
    expect(bare).toMatch(/:root\[data-theme='light'\] \.mx-market \.mx-dominance \{/);
  });
});

describe('۱۰ · «ویترین بازار» — the frame travels, the glass crosses, the chart lights up', () => {
  it('cross-fades a second rim phase so the frame colour moves — opacity only', async () => {
    await open();
    const card = screen.getByTestId('market-global-card');
    const rim = card.querySelector('.mx-deck-rim');
    expect(rim).toBeTruthy();
    expect(rim.getAttribute('aria-hidden')).toBe('true');
    /* the rim replicates the deck interior from ONE token and only its border
       phase differs — no second hand-maintained copy of the glass stack */
    expect(bare).toMatch(/\.mx-market \.mx-deck \{[^}]*--mx-deck-interior:/s);
    expect(bare).toMatch(/\.mx-market \.mx-deck-rim \{[^}]*background: var\(--mx-deck-interior\), var\(--mx-deck-rim-b\) border-box/s);
    expect(bare).toMatch(/\.mx-market \.mx-deck-rim \{[^}]*animation: mx-rim-shift/s);
    expect(bare).toMatch(/@keyframes mx-rim-shift \{ 0%, 100% \{ opacity: \.08; \} 50% \{ opacity: \.95; \} \}/);
    /* the Bitcoin card answers with its own amber twin, same technique */
    const btcRim = screen.getByTestId('market-btc-hero-card').querySelector('.mx-btc-rim');
    expect(btcRim.getAttribute('aria-hidden')).toBe('true');
    expect(bare).toMatch(/\.mx-market \.mx-btc-rim \{[^}]*background: var\(--mx-btc-interior\), var\(--mx-btc-rim-b\) border-box/s);
  });

  it('keeps the trio accent inside its own frame, breathing out of lockstep', () => {
    expect(bare).toMatch(/\.mx-trio-box::before \{[^}]*inset 0 0 0 1px color-mix\(in srgb, var\(--mx-accent\)/s);
    expect(bare).toMatch(/\.mx-trio-box::before \{[^}]*animation: mx-rim-breathe/s);
    expect(bare).toMatch(/\.mx-trio-box:nth-child\(2\)::before \{ animation-delay: -2\.6s; \}/);
    expect(bare).toMatch(/\.mx-trio-box:nth-child\(3\)::before \{ animation-delay: -5\.2s; \}/);
  });

  it('sweeps one glass gloss per card on a long cycle, above the light and below the readings', async () => {
    await open();
    for (const selector of ['.mx-deck .mx-deck-gloss', '.mx-btc-card .mx-btc-gloss']) {
      const gloss = document.querySelector(selector);
      expect(gloss, selector).toBeTruthy();
      expect(gloss.getAttribute('aria-hidden')).toBe('true');
    }
    expect(bare).toMatch(/\.mx-market \.mx-deck-gloss \{ z-index: 1; animation: mx-gloss-sweep 16s/s);
    expect(bare).toMatch(/\.mx-market \.mx-btc-gloss \{ z-index: -1; animation-duration: 19s/s);
    expect(bare).toMatch(/@keyframes mx-gloss-sweep/);
    /* the sweep stays a compositor job: rotate lives in the same transform */
    const glossFrame = /@keyframes mx-gloss-sweep \{([\s\S]*?)\n\}/.exec(bare)[1];
    expect(glossFrame).not.toMatch(/backdrop-filter|filter:|background:/);
  });

  it('gives the Bitcoin chart the trend rig: bloom, scan and a one-shot unfold', async () => {
    await open();
    const plot = screen.getByTestId('market-btc-plot');
    expect(plot.querySelector('.mx-btc-halo').getAttribute('aria-hidden')).toBe('true');
    expect(plot.querySelector('.mx-btc-scan').getAttribute('aria-hidden')).toBe('true');
    expect(plot.querySelector('[data-testid="market-btc-chart"] .mx-spark-live i')).toBeTruthy();
    expect(bare).toMatch(/\.mx-btc-chart svg \{[^}]*animation: mx-chart-unfold/s);
    expect(bare).toMatch(/\[dir='rtl'\] \.mx-btc-chart svg \{ transform-origin: right center; \}/);
    expect(bare).toMatch(/\.mx-btc-halo \{[^}]*animation: mx-halo-breathe/s);
    expect(bare).toMatch(/\.mx-btc-scan \{[^}]*animation: mx-chart-scan/s);
  });

  it('enters as one instrument in three movements, and never re-runs', () => {
    expect(bare).toMatch(/\.mx-market \.mx-overview > \* \{ animation: mx-rise \.6s cubic-bezier\(\.2, \.7, \.3, 1\) both; \}/);
    expect(bare).toMatch(/\.mx-market \.mx-overview > :nth-child\(2\) \{ animation-delay: \.08s; \}/);
    expect(bare).toMatch(/\.mx-market \.mx-overview > :nth-child\(3\) \{ animation-delay: \.16s; \}/);
    expect(bare).toMatch(/@keyframes mx-rise \{ from \{ transform: translateY\(16px\); opacity: 0; \} to \{ transform: translateY\(0\); opacity: 1; \} \}/);
    /* one-shot: nothing in the new layer set loops except the rim and gloss */
    expect(bare).toMatch(/\.mx-overview > \* \{ animation: mx-rise [^}]*both/);
    expect(bare).not.toMatch(/mx-rise[^;]*infinite/);
  });

  it('freezes the new light for native and lite — rim at half fade, gloss parked', () => {
    expect(bare).toMatch(/:root\[data-native='true'\] \.mx-market :is\(\.mx-deck-rim, \.mx-btc-rim\)/);
    expect(bare).toMatch(/:root\[data-lite='true'\] \.mx-market :is\(\.mx-deck-rim, \.mx-btc-rim\) \{ animation: none !important; opacity: \.5; \}/);
    expect(bare).toMatch(/:root\[data-native='true'\] \.mx-market \.mx-trio-box::before/);
    expect(bare).toMatch(/:root\[data-native='true'\] \.mx-market \.mx-overview > \*/);
    expect(bare).toMatch(/:root\[data-lite='true'\] \.mx-market :is\(\.mx-deck-gloss, \.mx-btc-gloss, \.mx-btc-scan\) \{ animation: none !important; opacity: 0; \}/);
    expect(bare).toMatch(/:root\[data-native='true'\] \.mx-market \.mx-btc-chart svg/);
    /* and reduced motion parks the gloss bands with the other sweeps */
    const guard = bare.slice(bare.indexOf('@media (prefers-reduced-motion: reduce)'));
    expect(guard).toMatch(/\.mx-market \.mx-deck-gloss, \.mx-market \.mx-btc-gloss, \.mx-market \.mx-btc-scan \{ opacity: 0; transform: none; \}/);
  });

  it('re-grades the travelling rim and the gloss for the pearl theme', () => {
    expect(bare).toMatch(/:root\[data-theme='light'\] \.mx-market \.mx-deck \{[^}]*--mx-deck-rim-b:/s);
    expect(bare).toMatch(/:root\[data-theme='light'\] \.mx-market \.mx-btc-card \{[^}]*--mx-btc-rim-b:/s);
    expect(bare).toMatch(/:root\[data-theme='light'\] \.mx-market \.mx-deck-gloss,/);
    expect(bare).toMatch(/:root\[data-theme='light'\] \.mx-market \.mx-btc-halo \{/);
    /* the light rim replica replicates the LIGHT interior — #fff, not the navy */
    const lightDeck = /:root\[data-theme='light'\] \.mx-market \.mx-deck \{([\s\S]*?)\n\}/.exec(bare)[1];
    expect(lightDeck).toMatch(/linear-gradient\(#fff, #fff\) padding-box/);
    expect(lightDeck).not.toMatch(/#08232a|--mx-panel\)/);
  });
});
