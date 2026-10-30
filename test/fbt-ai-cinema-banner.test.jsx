// @vitest-environment jsdom
/**
 * FBT AI — LIVING INTELLIGENCE.
 * ---------------------------------------------------------------------------
 * Pins the Market screen's «سیگنال هوشمند» house ad, rebuilt as the
 * interactive AI showcase. Three things this file exists to prove:
 *
 *   1. The Persian copy, the mascot and the CTA all render, and the CTA still
 *      points at the app's own Market Signals screen — the same destination
 *      the plain `AdBanner slot="signals"` used, not an invented route.
 *   2. Reduced motion freezes the panel instead of animating it.
 *   3. The Market screen wires THIS component in where the old banner sat,
 *      with no leftover `.ad-banner` in the tree.
 *
 * The component renders a plain `<article>` (its entrance is CSS, its
 * IntersectionObserver is local) precisely so the screens' minimal
 * `framer-motion` mock — which cannot forward a `ref` to `motion.article` —
 * never gets between the banner and its own logic.
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

const nav = vi.hoisted(() => ({ to: null }));
vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, useNavigate: () => (to) => { nav.to = to; } };
});

const telegram = vi.hoisted(() => ({ haptic: vi.fn() }));
vi.mock('../src/context/TelegramContext', () => ({ useTelegram: () => telegram }));

/* Controlled from the tests so the freeze path can be exercised. */
let reduced = true;
const MOTION_STUBS = new Map();
vi.mock('framer-motion', () => ({
  motion: new Proxy({}, {
    get: (_, tag) => {
      const T = String(tag);
      if (!MOTION_STUBS.has(T)) {
        MOTION_STUBS.set(T, ({ children, ...p }) => {
          const clean = Object.fromEntries(
            Object.entries(p).filter(([k]) => !['initial', 'animate', 'exit', 'transition', 'whileTap', 'whileHover', 'layout', 'layoutId', 'variants'].includes(k))
          );
          return <T {...clean}>{children}</T>;
        });
      }
      return MOTION_STUBS.get(T);
    }
  }),
  AnimatePresence: ({ children }) => <>{children}</>,
  useReducedMotion: () => reduced
}));

/* ── the feed Market needs to render its rows ──────────────────────────── */
const mkCoin = (i, symbol) => ({
  id: `coin-${i}`, symbol, name: `Coin ${i}`, image: '',
  price: 1 + i / 100, change24h: i % 2 ? 3.2 : -1.4,
  volume: 1_000_000 * (i + 1), mcap: 2_000_000 * (i + 1),
  high24h: 2, low24h: 1, sparkline: [1, 2, 3, 4], rank: i + 1
});
const COINS = [{
  id: 'bitcoin', symbol: 'BTC', name: 'Bitcoin', image: '',
  price: 60000, change24h: 1, volume: 1e10, mcap: 1e12,
  high24h: 1, low24h: 1, sparkline: [1, 2, 3], rank: 1
}, ...Array.from({ length: 40 }, (_, i) => mkCoin(i, `T${i}`))];

const feed = vi.hoisted(() => ({
  data: [], loading: false, error: null, updatedAt: 0, refresh: () => {}
}));
vi.mock('../src/hooks/useMarket', () => ({
  useMarkets: () => feed,
  useGlobalStats: () => ({ data: { mcap: 1e12, volume: 5e11, btcDominance: 52, ethDominance: 15, coins: 10, markets: 20, avgChange: 1, mcapChange: 1 } }),
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
vi.mock('../src/components/TrendChart', () => ({ default: () => null }));

import FBTAICinemaBanner from '../src/components/FBTAICinemaBanner.jsx';
import Market from '../src/pages/Market.jsx';

beforeEach(() => {
  nav.to = null;
  telegram.haptic.mockClear();
  feed.data = COINS;
  feed.loading = false;
  feed.error = null;
  feed.updatedAt = Date.now();
  useAppStore.setState({ favorites: [] });
});

afterEach(() => {
  cleanup();
  useAppStore.setState({ favorites: [] });
});

describe('the FBT AI showcase', () => {
  it('renders the Persian copy, the mascot and a CTA to /signals', () => {
    render(<MemoryRouter><FBTAICinemaBanner /></MemoryRouter>);

    expect(screen.getByRole('heading', { level: 2, name: fa.marketAiBanner.title }))
      .toBeTruthy();
    expect(screen.getByText(fa.marketAiBanner.desc)).toBeTruthy();
    expect(screen.getByText(fa.marketAiBanner.eyebrow)).toBeTruthy();
    expect(screen.getByRole('button', { name: fa.marketAiBanner.cta })).toBeTruthy();

    /* The animated mascot is an SVG, not an image request. */
    expect(document.querySelector('.fbt-ai-banner .fox-svg')).toBeTruthy();
    expect(document.querySelector('.fbt-ai-banner .fbt-ai-chart')).toBeTruthy();
    /* And it is no longer the generic ad card. */
    expect(document.querySelector('.fbt-ai-banner .ad-banner')).toBeNull();
  });

  it('navigates to the Market Signals screen when the CTA is tapped', () => {
    render(<MemoryRouter><FBTAICinemaBanner /></MemoryRouter>);
    fireEvent.click(screen.getByRole('button', { name: fa.marketAiBanner.cta }));

    expect(nav.to).toBe('/signals');
    expect(telegram.haptic).toHaveBeenCalledWith('light');
  });

  it('freezes under reduced motion instead of animating', () => {
    render(<MemoryRouter><FBTAICinemaBanner /></MemoryRouter>);
    const banner = document.querySelector('.fbt-ai-banner');
    expect(banner.getAttribute('data-still')).toBe('true');
    /* A frozen panel must not be held invisible by the entrance. */
    expect(banner.className).toContain('is-entered');
  });

  it('does not freeze when motion is allowed', () => {
    reduced = false;
    try {
      render(<MemoryRouter><FBTAICinemaBanner /></MemoryRouter>);
      expect(document.querySelector('.fbt-ai-banner').hasAttribute('data-still')).toBe(false);
    } finally {
      reduced = true;
    }
  });
});

describe('the Market screen wires it in', () => {
  it('shows the showcase where the old «سیگنال هوشمند» house ad sat', async () => {
    render(<MemoryRouter><Market /></MemoryRouter>);

    /* Wait for the feed, then the banner is already in the tree. */
    await waitFor(() => expect(document.querySelectorAll('.coin-row').length).toBeGreaterThan(0));

    const banner = document.querySelector('.market-signal-promo .fbt-ai-banner');
    expect(banner).toBeTruthy();
    expect(banner.textContent).toContain(fa.marketAiBanner.title);
    expect(banner.textContent).toContain(fa.marketAiBanner.cta);
    expect(document.querySelector('.market-signal-promo .ad-banner')).toBeNull();
  });
});
