// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { setLanguage } from '../src/i18n';
import DerivativesDashboard from '../src/pages/DerivativesDashboard';

vi.mock('../src/lib/dydx', () => ({
  getDydxMarkets: async () => ({
    markets: [
      { ticker: 'BTC-USD', oraclePrice: '68000', priceChange24H: '1200', openInterest: '1500', nextFundingRate: '0.0001' },
      { ticker: 'ETH-USD', oraclePrice: '3500', priceChange24H: '-50', openInterest: '2000', nextFundingRate: '0.00005' },
      { ticker: 'SOL-USD', oraclePrice: '180', priceChange24H: '10', openInterest: '5000', nextFundingRate: '-0.00002' }
    ],
    unavailable: false
  }),
  getDydxOrderbook: async () => ({
    live: true,
    bidDepth1Pct: '500000',
    askDepth1Pct: '450000',
    spreadBps: '1.5'
  })
}));

vi.mock('../src/hooks/useMarket', () => ({
  useMarkets: () => ({ data: [] })
}));

vi.mock('../src/context/TelegramContext', () => ({
  useTelegram: () => ({ haptic: vi.fn() })
}));

beforeAll(async () => {
  await setLanguage('fa');
});

afterEach(cleanup);

describe('DerivativesDashboard action buttons and popup token picker', () => {
  it('renders modern trade and earn action buttons with distinct styling', async () => {
    render(
      <MemoryRouter>
        <DerivativesDashboard embedded />
      </MemoryRouter>
    );

    const tradeBtn = screen.getByRole('button', { name: /خرید \/ معامله/i });
    expect(tradeBtn).toBeTruthy();
    expect(tradeBtn.classList.contains('deriv-action-trade')).toBe(true);

    const earnBtn = screen.getByRole('button', { name: /کسب درآمد/i });
    expect(earnBtn).toBeTruthy();
    expect(earnBtn.classList.contains('deriv-action-earn')).toBe(true);
  });

  it('renders compact selected token card with popup trigger and changes market on select', async () => {
    render(
      <MemoryRouter>
        <DerivativesDashboard embedded />
      </MemoryRouter>
    );

    // Initial selected market
    await waitFor(() => {
      expect(screen.getByText('BTC-USD')).toBeTruthy();
    });

    // Quick chip select
    const ethChip = screen.getByRole('button', { name: /ETH/i });
    expect(ethChip).toBeTruthy();
    fireEvent.click(ethChip);

    await waitFor(() => {
      expect(screen.getAllByText('ETH-USD').length).toBeGreaterThan(0);
    });

    // Opening popup picker
    const changeBtn = screen.getAllByRole('button', { name: /تغییر توکن/i })[0];
    fireEvent.click(changeBtn);

    // Sheet title should appear
    expect(await screen.findByText('انتخاب بازار dYdX')).toBeTruthy();

    // Selecting SOL-USD from the popup sheet
    const solRow = screen.getByRole('button', { name: /SOL.*USD/i });
    expect(solRow).toBeTruthy();
    fireEvent.click(solRow);

    // Selected market is now SOL-USD
    await waitFor(() => {
      expect(screen.getAllByText('SOL-USD').length).toBeGreaterThan(0);
    });
  });
});
