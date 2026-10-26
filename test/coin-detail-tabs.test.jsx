// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

const FIXTURES = vi.hoisted(() => {
  const coin = {
    id: 'ethereum', symbol: 'ETH', name: 'Ethereum', image: '', rank: 2,
    price: 2400, change1h: 0.2, change24h: 1.1, change7d: 3,
    volume: 1_200_000_000, mcap: 280_000_000_000, supply: 120_000_000,
    high24h: 2450, low24h: 2350, athChange: -25
  };
  const series = Array.from({ length: 90 }, (_, i) => ({ t: 1_700_000_000_000 + i * 86_400_000, p: 2100 + i * 4 + Math.sin(i) * 35 }));
  return { coin, series };
});

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key) => key, i18n: { language: 'en', resolvedLanguage: 'en' } })
}));
vi.mock('../src/hooks/useMarket', () => ({
  useCoin: () => ({ data: FIXTURES.coin, loading: false, refresh: vi.fn() }),
  useMarkets: () => ({ data: [FIXTURES.coin], loading: false }),
  useChart: () => ({ data: FIXTURES.series, loading: false }),
  useOhlc: () => ({ data: [], loading: false }),
  useCoinSearch: () => ({ results: [], searching: false })
}));
vi.mock('../src/lib/coinToSwap', () => ({
  swapTargetFor: () => ({
    kind: 'evm', chainId: 1, chainName: 'Ethereum',
    token: { symbol: 'ETH', address: '0x1111111111111111111111111111111111111111' }
  }),
  swapUrlFor: (_id, side) => `/swap?side=${side}`
}));
vi.mock('../src/lib/coinVenue', () => ({ getCoinVenue: vi.fn(), venueRoute: () => null }));
vi.mock('../src/lib/coinVenues', () => ({ cachedCoinVenue: () => null, rememberCoinVenues: vi.fn() }));
vi.mock('../src/lib/api', () => ({ coinKey: (id) => id, invalidate: vi.fn(), lastFetchFailed: () => false }));
vi.mock('../src/store/useAppStore', () => ({
  useAppStore: (selector) => selector({ favorites: [], toggleFavorite: vi.fn() })
}));
vi.mock('../src/context/TelegramContext', () => ({ useTelegram: () => ({ haptic: vi.fn() }) }));
vi.mock('../src/components/SwapDock.jsx', () => ({
  default: ({ alwaysVisible }) => <div data-testid="swap-dock" data-always-visible={String(alwaysVisible)} />
}));
vi.mock('../src/components/TokenRiskCard.jsx', () => ({
  default: ({ collapsible }) => <div data-testid="risk-card" data-collapsible={String(collapsible)} />
}));
vi.mock('../src/components/TokenSmartMoney.jsx', () => ({
  default: ({ collapsible }) => <div data-testid="smart-money-card" data-collapsible={String(collapsible)} />
}));
vi.mock('recharts', () => ({
  Area: () => null,
  AreaChart: () => null,
  ResponsiveContainer: () => null,
  Tooltip: () => null,
  XAxis: () => null,
  YAxis: () => null,
  Line: () => null,
  LineChart: () => null,
  ReferenceLine: () => null
}));

import CoinDetail from '../src/pages/CoinDetail.jsx';

afterEach(() => cleanup());

function mount() {
  return render(
    <MemoryRouter initialEntries={['/coin/ethereum']}>
      <Routes><Route path="/coin/:id" element={<CoinDetail />} /></Routes>
    </MemoryRouter>
  );
}

describe('coin detail tabs', () => {
  it('orders the four accessible SVG tabs and keeps the buy dock present', () => {
    const { container } = mount();
    const tabs = [...screen.getAllByRole('tab')];
    expect(tabs.map((tab) => tab.textContent)).toEqual([
      'coin.detailTabs.trade', 'coin.detailTabs.history', 'coin.detailTabs.compare', 'coin.detailTabs.smartMoney'
    ]);
    expect(tabs.every((tab) => tab.querySelector('svg'))).toBe(true);
    expect(tabs[0].getAttribute('aria-selected')).toBe('true');
    expect(container.querySelector('[data-testid="swap-dock"]').getAttribute('data-always-visible')).toBe('true');
    expect(container.querySelectorAll('.coin-trade-btn')).toHaveLength(2);
    expect(screen.getByTestId('risk-card').getAttribute('data-collapsible')).toBe('false');
  });

  it('shows history expanded without a disclosure button', () => {
    const { container } = mount();
    fireEvent.click(screen.getByRole('tab', { name: 'coin.detailTabs.history' }));
    const history = container.querySelector('[data-testid="history-panel"]');
    expect(history).toBeTruthy();
    expect(history.getAttribute('data-open')).toBe('true');
    expect(history.querySelector('.hist-head').tagName).toBe('DIV');
    expect(history.querySelector('.hist-chev')).toBeNull();
  });

  it('loads comparison inside the tab without nesting a page wrapper', async () => {
    const { container } = mount();
    fireEvent.click(screen.getByRole('tab', { name: 'coin.detailTabs.compare' }));
    await waitFor(() => expect(container.querySelector('.cmp-embedded')).toBeTruthy());
    const compare = container.querySelector('.cmp-embedded');
    const panel = container.querySelector('.coin-detail-panel');
    expect(compare.closest('.coin-compare-tab')).toBeTruthy();
    expect(compare.closest('.coin-detail-panel')).toBe(panel);
    expect(panel.querySelector('.page')).toBeNull();
    expect(container.querySelectorAll('main.page')).toHaveLength(1);
  });

  it('opens smart-money content and keeps its panel non-collapsible', async () => {
    const { container } = mount();
    /* The card is lazy (lazyRetry, like Compare): nothing of it exists on
       the trade tab, and opening the tab first paints the card-height
       Suspense fallback, then the card itself. */
    expect(screen.queryByTestId('smart-money-card')).toBeNull();
    fireEvent.click(screen.getByRole('tab', { name: 'coin.detailTabs.smartMoney' }));
    expect(container.querySelector('[data-testid="sm-token-lazy-fallback"]')).toBeTruthy();
    await waitFor(() => expect(screen.getByTestId('smart-money-card')).toBeTruthy());
    expect(container.querySelector('[data-testid="sm-token-lazy-fallback"]')).toBeNull();
    expect(screen.getByTestId('smart-money-card').getAttribute('data-collapsible')).toBe('false');
    expect(container.querySelector('[data-testid="swap-dock"]')).toBeTruthy();
  });
});
