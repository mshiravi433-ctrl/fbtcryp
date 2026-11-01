// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import fa from '../src/i18n/locales/fa.json';

const get = (obj, path) => path.split('.').reduce((value, key) => value?.[key], obj);
const t = (key, opts = {}) => String(get(fa, key) ?? opts.defaultValue ?? key).replace(/\{\{(\w+)\}\}/g, (_, k) => String(opts[k] ?? ''));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t, i18n: { language: 'fa', dir: () => 'rtl' } }) }));
const api = vi.hoisted(() => ({ getCategory: vi.fn(), getMarkets: vi.fn(), onMarketVisualsReady: () => () => {} }));
vi.mock('../src/lib/api', () => api);
vi.mock('../src/hooks/useMarket', () => ({
  useMarkets: () => ({ data: [{ id: 'bitcoin', symbol: 'BTC', name: 'Bitcoin', price: 100, change24h: 1, rank: 1 }], loading: false, updatedAt: Date.now(), refresh: () => {} }),
  useGlobalStats: () => ({ data: {} }), useTrending: () => ({ data: [] }),
  useCoinSearch: () => ({ results: [], searching: false, error: null })
}));
vi.mock('../src/hooks/useCoinVenues', () => ({ useCoinVenues: () => ({ venues: new Map() }) }));
vi.mock('../src/lib/marketVisuals', () => ({ mergeVisuals: (coin) => coin }));
vi.mock('../src/lib/priceAlerts', () => ({ runPriceAlerts: () => {}, runTopMoverAlerts: () => {}, syncPriceWatch: async () => ({ ok: true }) }));
vi.mock('../src/components/PageTransition', () => ({ default: ({ children, ...props }) => <div {...props}>{children}</div> }));
vi.mock('../src/components/DecisionOrb', () => ({ default: () => null }));
vi.mock('../src/components/CoinRow', () => ({ default: ({ coin }) => <button data-testid={`row-${coin.id}`}>{coin.name}</button> }));
vi.mock('../src/components/MarketStories', () => ({ default: () => null }));
vi.mock('../src/components/market/MarketHeroBanner', () => ({ default: () => null }));
vi.mock('../src/components/market/MarketOverview', () => ({ default: () => null }));
vi.mock('../src/components/market/HotCoins', () => ({ default: () => null }));
vi.mock('../src/components/market/SmartMoneyBanner', () => ({ default: () => null }));

import Market from '../src/pages/Market.jsx';
const row = (i) => ({ id: `id-${i}`, symbol: `T${i}`, name: `Token ${i}`, price: 1, change24h: 1, rank: i + 1 });
const mount = () => render(<MemoryRouter initialEntries={['/market?tab=tokens']}><Market /></MemoryRouter>);
const select = (name) => fireEvent.click(document.querySelector(`.mx-sector[data-sector="${name}"]`));

beforeEach(() => { api.getCategory.mockReset(); api.getMarkets.mockReset(); });
afterEach(cleanup);

it('shows a truthful risk outage, does not substitute market rows, and retries', async () => {
  api.getCategory.mockRejectedValueOnce(Error('offline')).mockResolvedValueOnce([{ ...row(1), id: 'verified', name: 'Verified Seed Token' }]);
  mount();
  select('seed');
  const retry = await screen.findByTestId('market-category-retry');
  expect(screen.getByTestId('market-category-source').textContent).toContain(fa.market.categoryRiskSource);
  expect(screen.queryByTestId('row-bitcoin')).toBeNull();
  expect(screen.getByText(fa.market.categoryError)).toBeTruthy();
  fireEvent.click(retry);
  expect(await screen.findByTestId('row-verified')).toBeTruthy();
  expect(screen.queryByTestId('market-category-retry')).toBeNull();
  expect(api.getCategory).toHaveBeenLastCalledWith('seed', expect.objectContaining({ strict: true, force: true }));
});

it('lets a reader reveal the first 250 tokens and request the next page', async () => {
  api.getCategory.mockImplementation(async (_sector, opts) => opts.page === 1
    ? Array.from({ length: 250 }, (_, i) => row(i))
    : [{ ...row(250), name: 'Token on next page' }]);
  mount();
  select('storage');
  await screen.findByTestId('row-id-0');
  expect(screen.getByTestId('market-category-source').textContent).toContain('CoinGecko');
  for (let i = 0; i < 4; i += 1) {
    fireEvent.click(document.querySelector('.market-show-more'));
  }
  expect(screen.getByText(fa.market.nextPage)).toBeTruthy();
  fireEvent.click(screen.getByText(fa.market.nextPage));
  await waitFor(() => expect(screen.getByText('Token on next page')).toBeTruthy());
  expect(api.getCategory).toHaveBeenLastCalledWith('storage', expect.objectContaining({ perPage: 250, page: 2 }));
});
