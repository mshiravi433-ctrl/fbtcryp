// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { forwardRef } from 'react';
import { useRadioStore } from '../src/store/useRadioStore';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import fa from '../src/i18n/locales/fa.json';
import en from '../src/i18n/locales/en.json';

vi.mock('../src/lib/audio', () => ({
  getCalm: async () => ({ items: [{ id: 'cinema-test', title: 'Cinematic journey', audioUrl: '/test-score.mp3' }] })
}));

const dict = { fa, en };
let LANG = 'fa';
const get = (obj, path) => path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
const tFor = (lang) => (key, opts = {}) => {
  let v = get(dict[lang], key);
  if (v == null) v = get(dict.en, key);
  if (v == null) return opts.defaultValue ?? key;
  return String(v).replace(/\{\{(\w+)\}\}/g, (_, k) => String(opts[k] ?? ''));
};

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: tFor(LANG),
    i18n: { language: LANG, changeLanguage: (l) => { LANG = l; } }
  })
}));

const MOTION_STUBS = new Map();
vi.mock('framer-motion', () => ({
  motion: new Proxy({}, {
    get: (_, tag) => {
      const T = String(tag);
      if (!MOTION_STUBS.has(T)) {
        MOTION_STUBS.set(T, forwardRef(({ children, ...p }, ref) => {
          const clean = Object.fromEntries(
            Object.entries(p).filter(
              ([k]) => !['initial', 'animate', 'exit', 'transition', 'whileTap', 'whileHover', 'layout', 'layoutId', 'variants'].includes(k)
            )
          );
          return <T ref={ref} {...clean}>{children}</T>;
        }));
      }
      return MOTION_STUBS.get(T);
    }
  }),
  AnimatePresence: ({ children }) => <>{children}</>,
  useReducedMotion: () => true
}));

const COINS = [
  {
    id: 'bitcoin',
    symbol: 'BTC',
    name: 'Bitcoin',
    image: '',
    price: 92450,
    change24h: 3.45,
    volume: 38_000_000_000,
    high24h: 93200,
    low24h: 89500,
    sparkline: [89500, 90200, 91400, 92450],
    rank: 1,
    mcap: 1_820_000_000_000
  },
  {
    id: 'ethereum',
    symbol: 'ETH',
    name: 'Ethereum',
    image: '',
    price: 3420,
    change24h: 4.12,
    volume: 19_000_000_000,
    high24h: 3480,
    low24h: 3290,
    sparkline: [3300, 3350, 3400, 3420],
    rank: 2,
    mcap: 410_000_000_000
  }
];

vi.mock('../src/hooks/useMarket', () => ({
  useMarkets: () => ({ data: COINS, loading: false }),
  useGlobalStats: () => ({
    data: {
      mcap: 3_150_000_000_000,
      volume: 142_000_000_000,
      btcDominance: 56.4,
      ethDominance: 13.8,
      coins: 14820,
      markets: 1120,
      avgChange: 2.35,
      mcapChange: 2.84
    }
  }),
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
vi.mock('../src/components/TrendChart', () => ({ default: () => <div data-testid="global-market-trend-chart" /> }));

import Market from '../src/pages/Market.jsx';
import AparatVideos, { APARAT_CHANNEL_URL } from '../src/pages/AparatVideos.jsx';
import { MARKET_STORY_ITEMS, STORY_DURATION_MS } from '../src/components/MarketStories.jsx';

function LocationProbe({ onChange }) {
  const loc = useLocation();
  onChange(loc.pathname);
  return null;
}

beforeEach(() => {
  LANG = 'fa';
  useRadioStore.getState().stop();
  globalThis.fetch = vi.fn(async () => ({ ok: true, json: async () => ({ venues: {}, rows: [] }) }));
});

afterEach(() => {
  cleanup();
});

describe('Glassmorphic Market Cap & Bitcoin Hero Cards + 1-Minute Stories + Aparat Academy', () => {
  it('renders the glassmorphic Total Market Cap card and Bitcoin hero card with zero-flicker tabular numerals', async () => {
    render(
      <MemoryRouter>
        <Market />
      </MemoryRouter>
    );

    const globalCard = document.querySelector('.market-global-card.market-glass-surface');
    const btcCard = screen.getByTestId('market-btc-hero-card');
    expect(globalCard).toBeTruthy();
    expect(btcCard).toBeTruthy();
    expect(btcCard.classList.contains('market-glass-surface')).toBe(true);
    expect(btcCard.textContent).toContain('Bitcoin');
    expect(btcCard.textContent).toContain('#1');
    expect(document.querySelector('.market-global-watermark')).toBeNull();
    expect(document.querySelector('.market-btc-watermark')).toBeNull();
    expect(document.querySelector('.market-hero-action-chip')).toBeNull();

    const modernCss = readFileSync('src/styles/market-modern.css', 'utf8');
    expect(modernCss).toMatch(/:root\[data-native='true'\]\s*\.market-glass-surface[\s\S]*?backdrop-filter:\s*none\s*!important/);
    expect(modernCss).toMatch(/@media\s*\(prefers-reduced-motion:\s*reduce\)/);
    expect(modernCss).toMatch(/:root\[data-theme='light'\]\s*\.market-glass-surface/);
  });

  it('renders Instagram-style story icons below the Bitcoin box and opens a 1-minute (60s) popup for Stocks with top gainers & CTA', async () => {
    expect(STORY_DURATION_MS).toBe(60_000);
    expect(MARKET_STORY_ITEMS.length).toBeGreaterThanOrEqual(8);

    let currentPath = '/';
    render(
      <MemoryRouter initialEntries={['/']}>
        <LocationProbe onChange={(p) => { currentPath = p; }} />
        <Market />
      </MemoryRouter>
    );

    const rail = screen.getByTestId('market-stories-rail');
    expect(rail).toBeTruthy();

    const stocksBubble = screen.getByTestId('market-story-item-stocks');
    expect(stocksBubble).toBeTruthy();

    fireEvent.click(stocksBubble);

    const popup = await screen.findByTestId('market-story-popup');
    expect(popup).toBeTruthy();
    expect(screen.getByTestId('story-panel-stocks')).toBeTruthy();
    expect(popup.textContent).toContain('NVDA');
    expect(popup.textContent).toContain('TSLA');
    expect(popup.textContent).toContain('AAPL');
    expect(popup.textContent).toContain('60s');

    expect(screen.queryByTestId('story-audio-toggle')).toBeNull();
    expect(screen.queryByTestId('story-pause-toggle')).toBeNull();
    expect(popup.querySelectorAll('.market-story-progress-seg svg').length).toBe(8);

    // Click bottom CTA button to open Stocks page
    const ctaBtn = screen.getByTestId('story-cta-stocks');
    fireEvent.click(ctaBtn);
    await waitFor(() => expect(currentPath).toBe('/stocks'));
  });

  it('shares News music queue and keeps radio selected after closing the story', async () => {
    render(<MemoryRouter><Market /></MemoryRouter>);
    fireEvent.click(screen.getByTestId('market-story-item-radio'));
    fireEvent.click(await screen.findByText('Cinematic journey'));
    expect(useRadioStore.getState().track.id).toBe('cinema-test');
    expect(useRadioStore.getState().queue).toHaveLength(1);
    fireEvent.click(screen.getByTestId('story-close-btn'));
    expect(useRadioStore.getState().track.id).toBe('cinema-test');
    expect(screen.queryByTestId('market-story-popup')).toBeNull();
  });

  it('renders the dedicated Aparat educational videos page with https://www.aparat.com/Fbtcompany and interactive courses', async () => {
    expect(APARAT_CHANNEL_URL).toBe('https://www.aparat.com/Fbtcompany');

    render(
      <MemoryRouter initialEntries={['/aparat']}>
        <AparatVideos />
      </MemoryRouter>
    );

    const page = screen.getByTestId('aparat-videos-page');
    expect(page).toBeTruthy();
    expect(document.querySelector('.aparat-audio-cta')).toBeNull();
    expect(page.textContent).toContain('https://www.aparat.com/Fbtcompany');
    expect(page.textContent).toContain('@Fbtcompany');
    expect(screen.getByTestId('aparat-open-channel-btn')).toBeTruthy();
    expect(screen.getByTestId('aparat-interactive-stage')).toBeTruthy();
    expect(screen.getByTestId('aparat-course-stocks')).toBeTruthy();
    expect(screen.getByTestId('aparat-course-swap')).toBeTruthy();
    expect(screen.getByTestId('aparat-course-wallet')).toBeTruthy();
  });
});
