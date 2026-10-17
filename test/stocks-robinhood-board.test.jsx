// @vitest-environment jsdom
/* Exercise the ACTUAL Stocks subtab: list -> prices -> real contract history ->
 * card and swap link. The smaller unit suites cannot catch a disconnected
 * effect, stale search results or a swapped chart attached to a share price. */
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import fa from '../src/i18n/locales/fa.json';

const t = (key, values = {}) => {
  const text = key.split('.').reduce((o, part) => o?.[part], fa);
  return typeof text === 'string'
    ? text.replace(/\{\{(\w+)\}\}/g, (_, name) => String(values?.[name] ?? ''))
    : key;
};
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t, i18n: { language: 'fa', resolvedLanguage: 'fa' } }) }));
vi.mock('../src/hooks/useMarket', () => ({ useMarkets: () => ({ data: [], loading: false }) }));
vi.mock('../src/hooks/useSolanaWallet', () => ({ useSolanaWallet: () => ({ address: null }) }));
vi.mock('../src/components/EquityHoldings', () => ({
  default: () => null, useSolanaEquityHoldings: () => ({ byMint: new Map() })
}));
vi.mock('../src/lib/solanaAssetsClient', () => ({
  MIN_EQUITY_LIQUIDITY: 25_000, getSolanaAssets: vi.fn(async () => ({ equities: [], commodities: [] }))
}));
vi.mock('../src/lib/tokenIcon', () => ({ default: ({ token }) => <i data-icon={token.symbol} /> }));
vi.mock('../src/lib/avantisEquities', () => ({ fetchAvantisEquities: vi.fn() }));
vi.mock('../src/lib/stockTokens', async (original) => ({
  ...await original(), loadStockTokenUniverse: vi.fn()
}));
vi.mock('../src/lib/stockPrices', () => ({ loadStockTokenPrices: vi.fn() }));
vi.mock('../src/lib/stockCharts', () => ({ loadStockTokenCharts: vi.fn() }));

import Stocks from '../src/pages/Stocks.jsx';
import { fetchAvantisEquities } from '../src/lib/avantisEquities';
import { loadStockTokenUniverse } from '../src/lib/stockTokens';
import { loadStockTokenPrices } from '../src/lib/stockPrices';
import { loadStockTokenCharts } from '../src/lib/stockCharts';

const NVDA = '0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC';
const TSLA = '0x322f0929c4625ed5bad873c95208d54e1c003b2d';
const tokens = [
  { id: 'rh-nvda', symbol: 'NVDA', name: 'NVIDIA', address: NVDA, chainId: 4663, equity: true },
  { id: 'rh-tsla', symbol: 'TSLA', name: 'Tesla', address: TSLA, chainId: 4663, equity: true }
];
const Location = () => { const { pathname, search } = useLocation(); return <output data-testid="route">{pathname + search}</output>; };

beforeEach(() => {
  window.location.hash = '';
  loadStockTokenUniverse.mockResolvedValue(tokens);
  fetchAvantisEquities.mockResolvedValue({ rows: [{ symbol: 'TSLA', price: 200, marketOpen: false }], live: true });
  loadStockTokenPrices.mockResolvedValue({ [NVDA.toLowerCase()]: { price: 187.43, change24h: 1.8, source: 'market' } });
  loadStockTokenCharts.mockResolvedValue({ [NVDA.toLowerCase()]: [100, 101, 103, 102, 104] });
});
afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe('Robinhood Chain subtab on /stocks', () => {
  it('keeps real token identity, distinguishes share reference, and draws only the priced contract chart', async () => {
    render(<MemoryRouter initialEntries={['/stocks?equity=robinhood']}><Stocks /><Location /></MemoryRouter>);
    await waitFor(() => expect(screen.getAllByTestId('stk-card')).toHaveLength(2));
    await waitFor(() => expect(screen.getByText('$187.43')).toBeTruthy());
    await waitFor(() => expect(document.querySelectorAll('.stk-trend-line')).toHaveLength(1));
    const [nvda, tsla] = screen.getAllByTestId('stk-card');
    expect(nvda.textContent).toContain('NVDA');
    expect(nvda.textContent).toContain(NVDA.slice(0, 6));
    expect(nvda.querySelector('.stk-trend-line')).toBeTruthy();
    expect(tsla.textContent).toContain('TSLA');
    expect(tsla.textContent).toContain('$200');
    expect(tsla.textContent).toContain(fa.stocks.rhRefTag);
    expect(tsla.textContent).toContain(fa.stocks.rhChartUnavailable);
    expect(tsla.querySelector('.stk-trend-line')).toBeNull();
    expect(loadStockTokenCharts).toHaveBeenCalledWith([tokens[0]], { chainId: 4663 });
    fireEvent.click(nvda.querySelector('.stk-buy'));
    expect(screen.getByTestId('route').textContent).toContain(`toAddress=${NVDA}`);
  });

  it('paints a backend quote while the remaining contracts are still loading', async () => {
    let finish;
    const waiting = new Promise((resolve) => { finish = resolve; });
    const quote = { [NVDA.toLowerCase()]: { price: 187.43, change24h: 1.8, source: 'market' } };
    loadStockTokenPrices.mockImplementationOnce(async (_tokens, { onUpdate }) => {
      onUpdate(quote);
      await waiting;
      return quote;
    });
    render(<MemoryRouter initialEntries={['/stocks?equity=robinhood']}><Stocks /></MemoryRouter>);
    await waitFor(() => expect(screen.getByText('$187.43')).toBeTruthy());
    expect(document.querySelectorAll('.stk-trend-line')).toHaveLength(0);
    expect(screen.getAllByText(fa.stocks.rhChartLoading).length).toBeGreaterThan(0);
    finish();
    await waitFor(() => expect(document.querySelectorAll('.stk-trend-line')).toHaveLength(1));
  });

  it('search does not leave another token\'s old price/chart on the filtered card', async () => {
    render(<MemoryRouter initialEntries={['/stocks?equity=robinhood']}><Stocks /></MemoryRouter>);
    await waitFor(() => expect(document.querySelectorAll('.stk-trend-line')).toHaveLength(1));
    fireEvent.change(screen.getByPlaceholderText(fa.stocks.rhSearchPlaceholder), { target: { value: 'TSLA' } });
    await waitFor(() => expect(screen.getAllByTestId('stk-card')).toHaveLength(1));
    const card = screen.getByTestId('stk-card');
    expect(card.textContent).toContain('TSLA');
    expect(card.textContent).toContain(fa.stocks.rhRefTag);
    expect(card.querySelector('.stk-trend-line')).toBeNull();
    expect(loadStockTokenCharts).toHaveBeenCalledTimes(1);
  });
});
