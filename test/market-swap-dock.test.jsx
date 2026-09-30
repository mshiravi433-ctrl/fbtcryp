// @vitest-environment jsdom
/**
 * THE MARKET LIST, THE STICKY DOCK, AND THE BATCH VENUE RESOLVER.
 * ---------------------------------------------------------------------------
 * The reported complaints, and what each assertion below is FOR:
 *
 *   «تعداد توکن های صفحه بازار خیلی کمه، بیشترشم قابل سواپ نیست»
 *      → the list asks ONCE for the whole visible page, and a row the curated
 *        table never heard of still gets a real, working swap button.
 *
 *   «این جمله را زیر توکن ها پاک کن: 23.80B market.low24h: — market.high24h:»
 *      → that sub-line is GONE. It rendered as a wall of raw keys glued to a
 *        number, and it is the reason a 250-row list read as noise.
 *
 *   «منو پایین صفحه محو و دکمه زیبا و ندرن سواپ ظاهر شود … مثل یونی سواپ»
 *      → the dock appears on scroll, takes the nav's place, and leads to a
 *        real route — and renders NOTHING for a coin that has none.
 *
 * Only the network and the framework are stubbed. The row markup, the
 * resolver, the route builder and the dock are the real ones.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import fa from '../src/i18n/locales/fa.json';
import en from '../src/i18n/locales/en.json';

const dict = { fa, en };
let LANG = 'fa';
const get = (obj, path) => path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
const tFor = (lang) => (key, opts = {}) => {
  let v = get(dict[lang], key);
  if (v == null) v = get(dict.en, key);
  if (v == null) return opts.defaultValue ?? key;
  return String(v).replace(/\{\{(\w+)\}\}/g, (_, k) => String(opts[k] ?? ''));
};
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: tFor(LANG), i18n: { language: LANG, changeLanguage: () => {} } }) }));

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

/* ── the market feed: a long table, so "too few tokens" is a real assertion ── */
const mkCoin = (i, symbol) => ({
  id: `coin-${i}`,
  symbol,
  name: `Coin ${i}`,
  image: '',
  price: 1 + i / 100,
  change24h: i % 2 ? 3.2 : -1.4,
  volume: 23_800_000_000,
  high24h: 2,
  low24h: null,
  sparkline: [1, 2, 3, 4],
  rank: i + 1,
  mcap: 1e9
});
let COINS = [{ id: 'bitcoin', symbol: 'BTC', name: 'Bitcoin', image: '', price: 60000, change24h: 1, volume: 1e10, high24h: 1, low24h: 1, sparkline: [1, 2, 3], rank: 1, mcap: 1e12 },
  ...Array.from({ length: 120 }, (_, i) => mkCoin(i, `T${i}`))];

vi.mock('../src/hooks/useMarket', () => ({
  useMarkets: () => ({ data: COINS, loading: false }),
  useGlobalStats: () => ({ data: { mcap: 1e12, volume: 5e11, btcDominance: 52, ethDominance: 15, coins: 10, markets: 20, avgChange: 1, mcapChange: 1 } }),
  useTrending: () => ({ data: [] }),
  useCoinSearch: () => ({ results: [], searching: false })
}));
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
vi.mock('../src/lib/priceAlerts', () => ({ runPriceAlerts: () => {}, runTopMoverAlerts: () => {} }));
vi.mock('../src/components/Ticker', () => ({ default: () => null }));
vi.mock('../src/components/AdBanner', () => ({ default: () => null }));
vi.mock('../src/components/TrendChart', () => ({ default: () => null }));

/* ── the venue resolver: ONE request for the whole page, and its answer ──── */
const FETCHES = [];
let VENUE_ANSWER = { venues: {} };
beforeEach(() => {
  FETCHES.length = 0;
  VENUE_ANSWER = { venues: {} };
  globalThis.fetch = vi.fn(async (url) => {
    FETCHES.push(String(url));
    if (String(url).includes('/coin-venues')) {
      return { ok: true, json: async () => VENUE_ANSWER };
    }
    return { ok: false, json: async () => ({}) };
  });
});

import Market from '../src/pages/Market.jsx';
import { getCoinVenues, rememberCoinVenues, cachedCoinVenue, _clearVenueBatchCache } from '../src/lib/coinVenues.js';

afterEach(() => {
  cleanup();
  _clearVenueBatchCache();
  LANG = 'fa';
  COINS = [{ id: 'bitcoin', symbol: 'BTC', name: 'Bitcoin', image: '', price: 60000, change24h: 1, volume: 1e10, high24h: 1, low24h: 1, sparkline: [1, 2, 3], rank: 1, mcap: 1e12 },
    ...Array.from({ length: 120 }, (_, i) => mkCoin(i, `T${i}`))];
});

describe('the market list', () => {
  it('loads a full page of tokens, not a short list', async () => {
    render(<MemoryRouter><Market /></MemoryRouter>);
    await waitFor(() => expect(screen.getAllByText(/^T\d+$/).length).toBeGreaterThan(40));
    const rows = document.querySelectorAll('.coin-row');
    expect(rows.length).toBeGreaterThanOrEqual(60);
  });

  it('does not render the volume / low / high sub-line under any token', async () => {
    /* The literal complaint: "23.80Bmarket.low24h: —market.high24h:". The
       number was fine; the sentence around it was raw keys glued together,
       repeated under every row of a 250-row list. */
    render(<MemoryRouter><Market /></MemoryRouter>);
    await waitFor(() => expect(document.querySelectorAll('.coin-row').length).toBeGreaterThan(0));
    expect(document.querySelector('.market-row-stats')).toBeNull();
    const body = document.body.textContent;
    expect(body).not.toContain('market.low24h');
    expect(body).not.toContain('market.high24h');
    expect(body).not.toContain('23.80Bmarket');
  });

  it('asks for swappability ONCE for the page, and lights a button on a coin the curated table never heard of', async () => {
    /* Only BTC is in the curated EVM table. T7 is not. If the list still
       decided from that table, T7 would have no button — which is exactly
       «بیشترشم قابل سواپ نیست». */
    VENUE_ANSWER = {
      venues: {
        'coin-7': { chains: { 8453: '0x1111111111111111111111111111111111111111' }, solana: null, tradeable: true },
        'coin-8': { chains: {}, solana: 'So11111111111111111111111111111111111111112', tradeable: true }
      }
    };
    render(<MemoryRouter><Market /></MemoryRouter>);

    await waitFor(() => expect(screen.getByTestId('market-swap-coin-7')).toBeTruthy());
    expect(screen.getByTestId('market-swap-coin-8')).toBeTruthy();
    /* the curated row keeps its own route and is not displaced */
    expect(screen.getByTestId('market-swap-bitcoin')).toBeTruthy();
    /* a coin with genuinely nowhere to go gets NO button — not a dead one */
    expect(screen.queryByTestId('market-swap-coin-9')).toBeNull();

    /* ONE request for the whole visible page, and it names the visible ids */
    const venueCalls = FETCHES.filter((u) => u.includes('/coin-venues'));
    expect(venueCalls.length).toBe(1);
    const asked = decodeURIComponent(venueCalls[0].split('ids=')[1]).split(',');
    expect(asked[0]).toBe('bitcoin');
    expect(asked.length).toBe(60);
    /* the page's render budget, not the whole market: a coin nobody can see
       has no button to light up */
    expect(asked).not.toContain('coin-100');
  });

  it('keeps the buttons it already had when the resolver fails', async () => {
    /* A network blip must never turn a working swap button into a dead one —
       the curated answer is synchronous and does not depend on this call. */
    globalThis.fetch = vi.fn(async () => ({ ok: false, status: 502, json: async () => ({}) }));
    render(<MemoryRouter><Market /></MemoryRouter>);
    await waitFor(() => expect(screen.getByTestId('market-swap-bitcoin')).toBeTruthy());
    expect(screen.queryByTestId('market-swap-coin-7')).toBeNull();
  });
});

describe('the batch venue client', () => {
  it('resolves many ids in one call and reuses the answer', async () => {
    VENUE_ANSWER = {
      venues: {
        a: { chains: { 56: '0xabc' }, solana: null, tradeable: true },
        b: { chains: {}, solana: null, tradeable: false }
      }
    };
    const first = await getCoinVenues(['a', 'b', 'A']);
    expect(FETCHES.length).toBe(1);
    expect(first.get('a').tradeable).toBe(true);
    /* 'b' genuinely has no contract: an explicit false, not a missing row */
    expect(first.get('b')).toEqual({ chains: {}, solana: null, tradeable: false });
    /* a second call for the same ids is served from memory */
    await getCoinVenues(['a', 'b']);
    expect(FETCHES.length).toBe(1);
  });

  it('is seeded by a page that already knows, with no request at all', async () => {
    rememberCoinVenues('pudgy-penguins', { chains: {}, solana: 'So111', tradeable: true });
    expect(cachedCoinVenue('pudgy-penguins').solana).toBe('So111');
    await getCoinVenues(['pudgy-penguins']);
    expect(FETCHES.length).toBe(0);
  });

  it('does not cache a failure as an answer', async () => {
    globalThis.fetch = vi.fn(async () => { throw new Error('offline'); });
    await getCoinVenues(['ghost']);
    /* nothing was learned, so nothing was remembered */
    expect(cachedCoinVenue('ghost')).toBeNull();
  });
});
