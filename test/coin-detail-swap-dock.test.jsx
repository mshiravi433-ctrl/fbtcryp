// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';

const USE_MARKETS = vi.fn();
let RESOLVED_VENUE = null;
const APP_STATE = { favorites: [], toggleFavorite: () => {} };

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key, options = {}) => {
  let out = key;
  for (const [name, value] of Object.entries(options)) out = out.replaceAll(`{{${name}}}`, String(value));
  return out;
} }) }));

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
          const Tag = name;
          return <Tag {...clean}>{children}</Tag>;
        });
      }
      return MOTION_STUBS.get(name);
    }
  })
}));

vi.mock('../src/components/PageTransition', () => ({
  default: ({ children, className = 'page' }) => <main className={className}>{children}</main>,
  riseIn: {},
  stagger: {}
}));
vi.mock('recharts', () => ({
  Area: () => null,
  AreaChart: () => <div data-testid="area-chart" />,
  ResponsiveContainer: ({ children }) => <div>{children}</div>,
  Tooltip: () => null,
  XAxis: () => null,
  YAxis: () => null
}));
vi.mock('../src/lib/coinVenue', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, getCoinVenue: async () => RESOLVED_VENUE };
});
vi.mock('../src/components/InfoBox', () => ({ default: ({ children, title }) => <section><h3>{title}</h3>{children}</section> }));
vi.mock('../src/components/AnimatedNumber', () => ({ default: ({ format, value }) => <span>{format(value)}</span> }));
vi.mock('../src/components/TradingChart', () => ({ default: () => <div data-testid="trading-chart" /> }));
vi.mock('../src/components/CoinLogo', () => ({ default: ({ coin }) => <span>{coin?.symbol}</span> }));
vi.mock('../src/components/SegIndicator', () => ({ default: () => null }));
vi.mock('../src/components/HistoryPanel', () => ({ default: () => <div data-testid="history-panel" /> }));
vi.mock('../src/components/TokenRiskCard', () => ({ default: () => <div data-testid="token-risk" /> }));
vi.mock('../src/components/TokenSmartMoney', () => ({ default: () => <div data-testid="token-smart-money" /> }));
vi.mock('../src/context/TelegramContext', () => ({ useTelegram: () => ({ haptic: () => {} }) }));
vi.mock('../src/store/useAppStore', () => ({ useAppStore: (select) => select(APP_STATE) }));
vi.mock('../src/hooks/useMarket', () => ({
  useCoin: (id) => ({ data: {
    id, symbol: id === 'bitcoin' ? 'BTC' : 'PENGU', name: id === 'bitcoin' ? 'Bitcoin' : 'Pudgy Penguins', image: '', rank: 1,
    price: 65000, change1h: 0.2, change24h: 1.4, change7d: -2.1,
    volume: 2.4e10, mcap: 1.2e12, supply: 19_700_000,
    high24h: 66000, low24h: 64000, athChange: -12.5
  }, loading: false, refresh: () => {} }),
  useChart: () => ({ data: [{ t: 1, p: 64000 }, { t: 2, p: 65000 }], loading: false }),
  useOhlc: () => ({ data: [], loading: false }),
  useMarkets: (...args) => { USE_MARKETS(...args); return { data: [], loading: false }; }
}));

import CoinDetail from '../src/pages/CoinDetail.jsx';

const LocationProbe = () => {
  const location = useLocation();
  return <output data-testid="route-probe">{location.pathname}{location.search}</output>;
};
const mount = (initialPath = '/coin/bitcoin') => render(
  <MemoryRouter initialEntries={[initialPath]}>
    <LocationProbe />
    <Routes>
      <Route path="/coin/:id" element={<CoinDetail />} />
      <Route path="/swap" element={<div data-testid="swap-route" />} />
    </Routes>
  </MemoryRouter>
);

beforeEach(() => { USE_MARKETS.mockClear(); RESOLVED_VENUE = null; });
afterEach(() => cleanup());

describe('coin detail fixed swap dock', () => {
  it('portals real buy/sell actions above navigation and skips the redundant markets request', async () => {
    const { container } = mount();
    const dock = await screen.findByTestId('coin-swap-dock');
    expect(dock.querySelector('[data-testid="coin-swap-buy"]')).toBeTruthy();
    expect(dock.querySelector('[data-testid="coin-swap-sell"]')).toBeTruthy();
    expect(container.querySelector('main.coin-detail-page--dock')).toBeTruthy();
    expect(USE_MARKETS).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId('coin-swap-buy'));
    await waitFor(() => expect(screen.getByTestId('swap-route')).toBeTruthy());
    expect(screen.getByTestId('route-probe').textContent).toMatch(/^\/swap\?/);
  });

  it('labels an exact-address discovery as a route check, not an executable trade', async () => {
    const address = '0x2222222222222222222222222222222222222222';
    RESOLVED_VENUE = { chains: { 8453: address }, solana: null, tradeable: true };
    mount('/coin/unverified-pengu');
    const dock = await screen.findByTestId('coin-swap-dock');
    expect(dock.textContent).toContain('coin.checkRouteDockTitle');
    expect(dock.textContent).toContain('coin.checkRouteDockNetwork');
    expect(dock.textContent).toContain('coin.checkBuyRoute');
    expect(dock.textContent).toContain('coin.checkSellRoute');
    expect(dock.textContent).not.toContain('trade.buy');
    expect(dock.textContent).not.toContain('trade.sell');

    fireEvent.click(screen.getByTestId('coin-swap-buy'));
    await screen.findByTestId('swap-route');
    expect(screen.getByTestId('route-probe').textContent).toBe(
      `/swap?chain=8453&toAddress=${address}&side=buy`
    );
  });
});
