// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import fs from 'node:fs';
import path from 'node:path';

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
  useCoinSearch: () => ({ results: [], searching: false }),
  /* The identity tab's only request. `enabled: false` must resolve to null,
     exactly like the hook does, so a test can tell the gate is closed. */
  useGlobalStats: (enabled = true) => ({
    data: enabled === false ? null : { mcap: 3_000_000_000_000, avgChange: 1.4 },
    loading: false
  })
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
  it('leads with the identity tab, then the four it inherited, all with an SVG', () => {
    const { container } = mount();
    const tabs = [...screen.getAllByRole('tab')];
    expect(tabs.map((tab) => tab.textContent)).toEqual([
      'coin.detailTabs.identity', 'coin.detailTabs.trade', 'coin.detailTabs.history',
      'coin.detailTabs.compare', 'coin.detailTabs.smartMoney'
    ]);
    expect(tabs.every((tab) => tab.querySelector('svg'))).toBe(true);
    /* The new tab LEADS the strip but is not the landing state: landing on it
       would mount its chunk and its global poll for every visitor, which is
       exactly the cost it is designed not to have. */
    expect(tabs[0].getAttribute('aria-selected')).toBe('false');
    expect(screen.getByRole('tab', { name: 'coin.detailTabs.trade' }).getAttribute('aria-selected')).toBe('true');
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

  /* ─── THE CPU PROMISE: nothing exists until the tab is opened ──────────── */
  const detailSource = fs.readFileSync(path.resolve('src/pages/CoinDetail.jsx'), 'utf8');

  it('is the first tab and keeps every inherited tab id stable', () => {
    expect(detailSource).toContain("const DETAIL_TABS = ['identity', 'trade', 'history', 'compare', 'smartMoney'];");
    /* The four old ids survive in the same relative order, so a stored
       selection or a deep link naming a tab still resolves. */
    const decl = detailSource.slice(detailSource.indexOf('const DETAIL_TABS'));
    const order = [...decl.slice(0, 140).matchAll(/'identity'|'trade'|'history'|'compare'|'smartMoney'/g)]
      .slice(0, 5).map((m) => m[0]);
    expect(order).toEqual(["'identity'", "'trade'", "'history'", "'compare'", "'smartMoney'"]);
  });

  it('loads the identity chunk through lazyRetry, not a static import', () => {
    expect(detailSource).toContain("const LazyTokenIdentity = lazyRetry(() => import('../components/TokenIdentity'));");
    expect(detailSource).not.toMatch(/^import TokenIdentity from/m);
  });

  it('never mounts the identity chunk before the tab has been opened', () => {
    const { container } = mount();
    expect(container.querySelector('.coin-identity-tab')).toBeNull();
    expect(container.querySelector('[data-testid="coin-identity-drawdown"]')).toBeNull();
  });

  it('holds the global poll shut until the identity tab is opened once', () => {
    /* The hook is called with `identitySeen`, and `identitySeen` starts false.
       The mock above resolves `enabled: false` to null, so opening the tab is
       what makes the market reading appear on the panel. */
    expect(detailSource).toContain('const [identitySeen, setIdentitySeen] = useState(false);');
    expect(detailSource).toContain('useGlobalStats(identitySeen)');
    /* and the gate is a latch, not a mirror of the active tab: switching away
       and back must not re-fetch, so it is only ever set to true. */
    expect(detailSource).toMatch(/if \(detailTab === 'identity'\) setIdentitySeen\(true\)/);
    expect(detailSource).not.toMatch(/setIdentitySeen\(false\)/);
  });

  it('paints a card-height fallback while the identity chunk lands', async () => {
    const { container } = mount();
    fireEvent.click(screen.getByRole('tab', { name: 'coin.detailTabs.identity' }));
    /* The chunk may resolve faster than the assertion; either the fallback or
       the panel must be present, and never an empty gap. */
    const fallback = container.querySelector('[data-testid="identity-lazy-fallback"]');
    const panel = container.querySelector('[data-testid="coin-identity-drawdown"]')
      ?? container.querySelector('.coin-identity-tab');
    expect(Boolean(fallback) || Boolean(panel)).toBe(true);
    await waitFor(() => expect(container.querySelector('.coin-identity-tab')).toBeTruthy());
  });

  it('does not animate the strip away on tab change', () => {
    /* Five tabs on a phone is a horizontal scroll, so the strip must not be a
       grid of four equal columns any more. */
    const css = fs.readFileSync(path.resolve('src/styles/coin-detail-tabs.css'), 'utf8');
    /* Scope by the exact selector: `.coin-detail-tabs` is a prefix of the
       per-tab class, so slicing on the latter would cut the block short. */
    const strip = css.slice(css.indexOf('.coin-detail-tabs {'), css.indexOf('.coin-detail-tabs::-webkit-scrollbar'));
    expect(strip).not.toMatch(/grid-template-columns:\s*repeat\(4/);
    expect(strip).toMatch(/overflow-x:\s*auto/);
    expect(strip).toMatch(/scroll-snap-type/);
    /* A sticky element with a backdrop-filter forces a composited blur layer on
       every scroll frame of a phone; it was removed for the same reason as the
       market performance strips. Assert on DECLARATIONS: the block's comment
       explains the removal by name, so a naive `toContain` would fail on its
       own documentation. */
    const decls = strip.replace(/\/\*[\s\S]*?\*\//g, '');
    expect(decls).not.toMatch(/backdrop-filter\s*:/);
  });
});
