// @vitest-environment jsdom
/**
 * INTELLIGENCE ROOMS IN THE CHAT — RENDER + COST + HONESTY
 * ---------------------------------------------------------------------------
 * The lib test (test/chat-intel-rooms.test.mjs) proves the human layer attaches
 * the right room and never navigates away. This one proves the SCREEN:
 *
 *   · the market room paints the analysis centre's own tiles inside the bubble,
 *   · the token room paints the score, its caveat and the indicator rails from
 *     real candles,
 *   · a COLLAPSED room is not mounted at all — a long thread holding twenty
 *     answers makes zero requests for the nineteen that are closed,
 *   · none of them leaks `NaN` / `undefined` / `Infinity` into the DOM.
 *
 * The feed is stubbed at `fetch`, the same boundary the app uses, so the real
 * api layer, hooks and engines all run.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import React from 'react';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';

import '../src/i18n/index.js';
import i18n from '../src/i18n/index.js';
import { ChatMarketRoom, ChatTokenRoom, ChatPortfolioRoom } from '../src/components/ai/analysis/ChatIntelRooms.jsx';
import { clearApiCache } from '../src/lib/api.js';

const ROWS = [
  ['bitcoin', 'BTC', 'Bitcoin', 61234.5, 1.42, 4.1, -12.4, 1_210_000_000_000, 32e9, 1, 69000, 59800, 73000],
  ['ethereum', 'ETH', 'Ethereum', 3120.4, -0.81, 2.2, -18.9, 375_000_000_000, 18e9, 2, 3300, 3050, 4878],
  ['solana', 'SOL', 'Solana', 148.2, 3.9, 11.4, -6.2, 69_000_000_000, 4.2e9, 5, 152, 141, 294],
  ['aave', 'AAVE', 'Aave', 182.1, null, -5.2, 9.6, 2_700_000_000, 320_000_000, 42, 190, 176, 661],
  ['usdc', 'USDC', 'USD Coin', 1.0, 0.01, 0.02, -0.01, 34_000_000_000, 8e9, 6, 1.01, 0.99, 1.17],
  ['pepe', 'PEPE', 'Pepe', 0.0000112, 7.4, 18.3, 22.1, 4_700_000_000, 2.1e9, 24, 0.000012, 0.0000098, 0.0000172]
].map(([id, symbol, name, price, change1h, change24h, change7d, mcap, volume, rank, high24h, low24h, ath]) => ({
  id,
  symbol,
  name,
  image: null,
  price,
  change1h,
  change24h,
  change7d,
  mcap,
  volume,
  rank,
  high24h,
  low24h,
  ath,
  athChange: ((price - ath) / ath) * 100,
  sparkline: Array.from({ length: 24 }, (_, i) => price * (1 + Math.sin(i / 3) * 0.02)),
  dataProvenance: 'live'
}));

const GLOBAL = {
  data: {
    total_market_cap: { usd: 2_450_000_000_000 },
    total_volume: { usd: 86_000_000_000 },
    market_cap_change_percentage_24h_usd: 1.24,
    volume_change_percentage_24h_usd: -4.2,
    market_cap_percentage: { btc: 58.2, eth: 12.4 },
    active_cryptocurrencies: 17_000,
    markets: 900,
    avg_change_percent: null
  }
};

const CANDLES = Array.from({ length: 120 }, (_, i) => {
  const c = 100 + i * 0.6 + Math.sin(i / 4) * 2;
  return { t: Date.UTC(2026, 5, 1) + i * 86_400_000, o: c - 0.4, h: c + 1.2, l: c - 1.3, c };
});

const response = (data, ok = true) => ({
  ok,
  status: ok ? 200 : 502,
  headers: { get: () => null },
  json: async () => data,
  text: async () => JSON.stringify(data)
});

const fetchMock = vi.fn(async (url) => {
  const href = String(url);
  if (href.includes('/ohlc/')) return response(CANDLES);
  if (href.includes('/markets')) return response(ROWS);
  if (href.includes('/global')) return response(GLOBAL);
  if (href.includes('/prices')) return response({});
  return response({ error: 'not mocked' }, false);
});

const roomsRequested = () => fetchMock.mock.calls
  .map(([url]) => String(url))
  .filter((url) => url.includes('/markets') || url.includes('/global') || url.includes('/ohlc/'));

beforeEach(async () => {
  fetchMock.mockClear();
  /* The api layer memoises for 30s. Without this, a later test would read the
     previous test's rows and its "no request" assertion would pass for the
     wrong reason. */
  clearApiCache();
  global.fetch = fetchMock;
  if (typeof window !== 'undefined' && !window.ResizeObserver) {
    window.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
  }
  await i18n.changeLanguage('en');
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('intelligence rooms inside the chat', () => {
  it('paints the market room from the same feed the analysis centre reads', async () => {
    render(<ChatMarketRoom card={{ kind: 'MARKET', room: 'overview' }} locale="en" defaultOpen />);

    expect(await screen.findByText('$2.45T')).toBeTruthy();
    expect(await screen.findByText('4/6')).toBeTruthy();
    expect(screen.getByText('Fear & Greed index')).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/NaN|undefined|Infinity/);
  });

  it('owns its language, linked disclosure and offline token artwork', async () => {
    render(<ChatMarketRoom locale="fa" defaultOpen />);
    await screen.findByText('$2.45T');
    const frame = screen.getByTestId('intent-ai-market-room');
    expect(frame.getAttribute('dir')).toBe('rtl');
    expect(frame.getAttribute('lang')).toBe('fa');
    const toggle = frame.querySelector('.aix-room-head');
    const body = frame.querySelector('.aix-room-body');
    expect(toggle.getAttribute('aria-controls')).toBe(body.id);
    const movers = frame.querySelectorAll('.aix-mover');
    expect(movers.length).toBeGreaterThan(0);
    movers.forEach((row) => expect(row.querySelector('.coin-logo')).toBeTruthy());
    expect(frame.querySelectorAll('.aix-tab')).toHaveLength(4);
    fireEvent.click(toggle);
    expect(frame.querySelector('.aix-room-body')).toBeNull();
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
  });

  it('opens on the room the sentence asked for', async () => {
    render(<ChatMarketRoom card={{ kind: 'MARKET', room: 'opportunities' }} locale="en" defaultOpen />);
    expect(await screen.findByText('Opportunities')).toBeTruthy();
    await waitFor(() => expect(fetchMock.mock.calls.some(([u]) => String(u).includes('/markets'))).toBe(true));
    /* Switching rooms stays inside the bubble — nothing is navigated. */
    fireEvent.click(screen.getByRole('button', { name: 'Overview' }));
    expect(await screen.findByText('$2.45T')).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/NaN|undefined|Infinity/);
  });

  it('paints the token room with its score, caveat and indicator rails', async () => {
    render(<ChatTokenRoom card={{ kind: 'TOKEN', coinId: 'bitcoin', symbol: 'BTC' }} locale="en" defaultOpen />);

    await waitFor(() => expect(screen.getByText('Composite score')).toBeTruthy());
    await waitFor(() => {
      expect(screen.getByText('SMA20')).toBeTruthy();
      expect(screen.getByText('SMA200')).toBeTruthy();
    });
    expect(screen.getByText('Not a recommendation')).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/NaN|undefined|Infinity/);
  });

  it('asks the wallet screen, not a fabricated P&L, when no wallet is connected', async () => {
    render(<ChatPortfolioRoom locale="en" defaultOpen />);
    expect(await screen.findByText(/Open wallet/)).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/NaN|undefined|Infinity/);
  });

  it('a collapsed room costs nothing: no request, no body in the DOM', async () => {
    render(<ChatMarketRoom card={{ kind: 'MARKET', room: 'overview' }} locale="en" defaultOpen={false} />);

    expect(screen.getByTestId('intent-ai-market-room')).toBeTruthy();
    expect(screen.queryByText('$2.45T')).toBeNull();
    await new Promise((r) => setTimeout(r, 30));
    expect(roomsRequested()).toHaveLength(0);

    /* Opening it is what starts the poll — one tap, one read. */
    fireEvent.click(screen.getByRole('button', { expanded: false }));
    expect(await screen.findByText('$2.45T')).toBeTruthy();
    expect(roomsRequested().length).toBeGreaterThan(0);
  });
});
