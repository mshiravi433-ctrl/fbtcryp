// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';

let MARKET_ROWS = [];
let RESOLVED_VENUES = {};
const appState = { favorites: [] };

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key) => key }) }));

const MOTION_STUBS = new Map();
vi.mock('framer-motion', () => ({
  motion: new Proxy({}, {
    get: (_, tag) => {
      const name = String(tag);
      if (!MOTION_STUBS.has(name)) {
        MOTION_STUBS.set(name, ({ children, ...props }) => {
          const clean = Object.fromEntries(Object.entries(props).filter(([key]) => ![
            'initial', 'animate', 'exit', 'transition', 'whileTap', 'whileHover', 'layout', 'layoutId', 'variants'
          ].includes(key)));
          return <Tag {...clean}>{children}</Tag>;
        });
      }
      const Tag = name;
      return MOTION_STUBS.get(name);
    }
  }),
  AnimatePresence: ({ children }) => <>{children}</>
}));

vi.mock('../src/components/PageTransition', () => ({
  default: ({ children }) => <main>{children}</main>,
  riseIn: {},
  stagger: {}
}));
vi.mock('../src/components/AdBanner', () => ({ default: () => null }));
vi.mock('../src/components/Ticker', () => ({ default: () => null }));
vi.mock('../src/components/CoinRow', () => ({
  default: ({ coin, onClick }) => (
    <button type="button" className="coin-row" onClick={onClick}>
      <span className="coin-sym">{coin.symbol}</span><span className="coin-name">{coin.name}</span>
    </button>
  )
}));
vi.mock('../src/components/CoinLogo', () => ({ default: ({ coin }) => <span>{coin?.symbol}</span> }));
vi.mock('../src/components/AnimatedNumber', () => ({ default: ({ value }) => <span>{String(value)}</span> }));
vi.mock('../src/components/Sparkline', () => ({ default: () => <span data-testid="sparkline" /> }));
vi.mock('../src/components/TrendChart', () => ({ default: () => <span data-testid="trend-chart" /> }));
vi.mock('../src/hooks/useMarket', () => ({
  useGlobalStats: () => ({ data: { mcap: 1e12, mcapChange: 1, volume: 1e10, btcDominance: 50, ethDominance: 20, coins: 100, markets: 250 } }),
  useMarkets: () => ({ data: MARKET_ROWS, loading: false }),
  useTrending: () => ({ data: [] }),
  useCoinSearch: () => ({ results: [], searching: false })
}));
vi.mock('../src/store/useAppStore', () => ({ useAppStore: (select) => select(appState) }));
vi.mock('../src/store/useSettingsStore', () => ({ useSettingsStore: (select) => select({ currency: 'usd' }) }));
vi.mock('../src/lib/globalTrend', () => ({ marketCapSeries: () => null }));
vi.mock('../src/lib/api', () => ({
  getCategory: async () => [],
  getMarkets: async () => [],
  onMarketVisualsReady: () => () => {}
}));
vi.mock('../src/lib/marketVisuals', () => ({ mergeVisuals: (coin) => coin }));
vi.mock('../src/lib/priceAlerts', () => ({ runPriceAlerts: () => {}, runTopMoverAlerts: () => {} }));
vi.mock('../src/lib/coinVenue', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    getCoinVenues: async (ids) => new Map(ids.filter((id) => RESOLVED_VENUES[id]).map((id) => [id, RESOLVED_VENUES[id]]))
  };
});

import Market from '../src/pages/Market.jsx';
import { venueRoute } from '../src/lib/coinVenue.js';

const LocationProbe = () => {
  const location = useLocation();
  return <output data-testid="route-probe">{location.pathname}{location.search}</output>;
};

const mount = () => render(
  <MemoryRouter initialEntries={['/']}>
    <LocationProbe />
    <Routes>
      <Route path="/" element={<Market />} />
      <Route path="/swap" element={<div data-testid="swap-screen" />} />
      <Route path="/coin/:id" element={<div data-testid="coin-screen" />} />
    </Routes>
  </MemoryRouter>
);

beforeEach(() => {
  MARKET_ROWS = [{
    id: 'fresh-market-token',
    symbol: 'FMT',
    name: 'Fresh Market Token',
    image: '',
    rank: 251,
    price: 0.42,
    change24h: 2.1,
    change1h: 0.2,
    change7d: 3,
    volume: 100000,
    mcap: 900000,
    supply: 2000000,
    low24h: 0.38,
    high24h: 0.45,
    sparkline: [0.4, 0.41, 0.42]
  }];
  RESOLVED_VENUES = {
    'fresh-market-token': {
      chains: { 8453: '0x1111111111111111111111111111111111111111' },
      solana: null,
      tradeable: true
    }
  };
  appState.favorites = [];
});

afterEach(() => cleanup());

describe('market rows and exact-address swap discovery', () => {
  it('rejects symbol-only or malformed venue data instead of constructing a route', () => {
    expect(venueRoute({ tradeable: true, chains: {}, solana: null })).toBeNull();
    expect(venueRoute({ tradeable: true, chains: { 8453: '0x1234' }, solana: null })).toBeNull();
    expect(venueRoute({ tradeable: true, chains: {}, solana: 'PENGU' })).toBeNull();
  });

  it('removes the noisy low/high/volume strip beneath token rows', () => {
    const { container } = mount();
    expect(screen.getAllByText('FMT').length).toBeGreaterThan(0);
    expect(container.querySelector('.market-row-stats')).toBeNull();
    expect(container.textContent).not.toContain('market.low24h');
    expect(container.textContent).not.toContain('market.high24h');
  });

  it('offers a non-curated route check only after an exact supported-chain address resolves', async () => {
    const { container } = mount();
    await waitFor(() => expect(container.querySelector('.market-row-stats')).toBeNull());
    /* Market defers the batch lookup slightly so it never delays first paint. */
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 550)); });
    const swapButton = await screen.findByText('market.checkRoute');
    expect(swapButton.title).toContain('market.checkRouteOnCorrectNetwork');
    fireEvent.click(swapButton);
    await screen.findByTestId('swap-screen');
    expect(screen.getByTestId('route-probe').textContent).toBe(
      '/swap?chain=8453&toAddress=0x1111111111111111111111111111111111111111&side=buy'
    );
  });
});
