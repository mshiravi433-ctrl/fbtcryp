// @vitest-environment jsdom
import React from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
const getCandles = vi.hoisted(() => vi.fn());
vi.mock('../src/lib/futuresClient', () => ({ getFuturesCandles: getCandles }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key) => key }) }));
vi.mock('../src/components/HistoryPanel', () => ({ default: ({series}) => <div data-testid="past-series">{series.join(',')}</div> }));
import OnchainPast from '../src/components/futures/OnchainPast';
afterEach(() => { cleanup(); vi.clearAllMocks(); });
const day = 86400000;
const today = Math.floor(Date.now() / day) * day;
const candles = Array.from({length: 12}, (_,i) => ({ startedAt: today - (12-i)*day, open:100+i, high:102+i, low:99+i, close:101+i }));
it('reads the selected venue daily and excludes the still-open candle', async () => {
  getCandles.mockResolvedValue({ok:true,data:{live:true,candles:[...candles, { ...candles[11], startedAt:today, close:112 }]}});
  render(<OnchainPast provider="drift" market="1" />);
  await waitFor(() => expect(screen.getByTestId('past-series').textContent.split(',')).toHaveLength(12));
  expect(getCandles).toHaveBeenCalledWith({provider:'drift',market:'1',resolution:'1D',limit:90});
});
it.each([
  {ok:false},
  {ok:true,data:{live:false,candles}},
  {ok:true,data:{live:true,stale:true,candles}},
  {ok:true,data:{live:true,candles:candles.slice(0,10)}},
  {ok:true,data:{live:true,candles:[...candles,candles[11]]}},
  {ok:true,data:{live:true,candles:candles.filter((_,i)=>i!==4)}}
])('refuses failed, stale, duplicate or discontinuous history', async (result) => {
  getCandles.mockResolvedValue(result);
  render(<OnchainPast provider="drift" market="1" />);
  await waitFor(() => expect(screen.getByText('futures.onchain.pastUnavailable')).toBeTruthy());
  expect(screen.queryByTestId('past-series')).toBeNull();
});
