// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
const state = vi.hoisted(() => ({ price: 102, at: 1700000000000, fail: false, history: true }));
vi.mock('../src/components/AnimatedIcon', () => ({ useStill: () => true }));
vi.mock('../src/lib/tokenIcon', () => ({ default: () => null }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k, opts) => opts?.days ? `${k}:${opts.days}` : k }) }));
vi.mock('../src/lib/solanaAssetsClient', () => ({ getSolanaAssets: async () => {
  if (state.fail) throw new Error('offline');
  return { equities: [{ mint: 'mint-a', usdPrice: state.price }], at: state.at };
} }));
vi.mock('../src/lib/equityChart', async (original) => ({ ...(await original()),
  fetchEquityChart: async () => state.history ? [{ t: 1699999900000, p: 100 }, { t: 1699999960000, p: 101 }] : [],
  fetchEquityChartWindowed: async (_id, days) => ({ series: [{ t: 1, p: 80 }, { t: 2, p: 90 }], days })
}));
vi.mock('../src/components/Sparkline', () => ({ default: ({ data }) => <div data-testid="real-line">{data.join(',')}</div> }));
import EquityAnalysis from '../src/components/EquityAnalysis.jsx';
const asset = { mint: 'mint-a', symbol: 'Ax', name: 'Token A', coingeckoId: 'token-a', usdPrice: 100, liquidity: 100000 };
beforeEach(() => { vi.useFakeTimers(); Object.assign(state, { price: 102, at: 1700000000000, fail: false, history: true }); });
afterEach(() => { cleanup(); vi.useRealTimers(); });
const settle = async () => { await act(async () => { await Promise.resolve(); await Promise.resolve(); }); };
it('opens the 24h chart, polls spot prices, and switches to honest historical windows', async () => {
  render(<EquityAnalysis asset={asset} onClose={() => {}} />);
  await settle();
  expect(screen.getByText('eqsheet.live').getAttribute('aria-pressed')).toBe('true');
  expect(screen.getByTestId('real-line').textContent).toBe('100,101,102');
  state.price = 103; state.at += 30000;
  await act(async () => { vi.advanceTimersByTime(30000); });
  await settle();
  expect(screen.getByTestId('real-line').textContent).toBe('100,101,102,103');
  fireEvent.click(screen.getByText('eqsheet.days:14'));
  await settle();
  expect(screen.getByTestId('real-line').textContent).toBe('80,90');
  expect(screen.getByText('eqsheet.chartTitle:14')).toBeTruthy();
});
it('collects real samples without a listing id, never inventing a chart from one price', async () => {
  state.history = false;
  render(<EquityAnalysis asset={{ ...asset, coingeckoId: undefined }} onClose={() => {}} />);
  await settle();
  expect(screen.queryByTestId('real-line')).toBeNull();
  expect(screen.getByText('eqsheet.collecting')).toBeTruthy();
  state.at += 30000; state.price = 104;
  await act(async () => { vi.advanceTimersByTime(30000); });
  await settle();
  expect(screen.getByTestId('real-line').textContent).toBe('102,104');
});
it('marks failed quote refreshes instead of claiming a live price', async () => {
  state.fail = true;
  render(<EquityAnalysis asset={asset} onClose={() => {}} />);
  await settle();
  expect(screen.getByText('eqsheet.refreshFailed')).toBeTruthy();
});
