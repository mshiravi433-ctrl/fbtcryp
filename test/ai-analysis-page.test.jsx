// @vitest-environment jsdom
/**
 * AI INTELLIGENCE — PAGE RENDER + HONESTY
 * ---------------------------------------------------------------------------
 * The lib tests prove the arithmetic. This one proves the SCREEN: that the
 * page mounts inside the real providers, paints measured values from a mocked
 * feed, switches rooms, withholds the feeds it does not have, and never leaks
 * `NaN` / `undefined` / `Infinity` into the DOM.
 *
 * The mocked feed is deliberately realistic in SHAPE (the same fields the
 * backend sends) and in GAPS (rows with no 24h change, no ATH, no sparkline),
 * because the interesting failures happen on the rows that are missing
 * something.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import React from 'react';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

import '../src/i18n/index.js';
import i18n from '../src/i18n/index.js';

/* ── fixture feed ─────────────────────────────────────────────────────────── */

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
  return {
    t: Date.UTC(2026, 5, 1) + i * 86_400_000,
    o: c - 0.4,
    h: c + 1.2,
    l: c - 1.3,
    c
  };
});

function makeResponse(data, ok = true) {
  return {
    ok,
    status: ok ? 200 : 502,
    headers: { get: () => null },
    json: async () => data,
    text: async () => JSON.stringify(data)
  };
}

function installFeed() {
  global.fetch = vi.fn(async (url) => {
    const href = String(url);
    if (href.includes('/scenario/daily/')) return makeResponse(CANDLES.map(({ t, c }) => ({ t, c })));
    if (href.includes('/scenario/history')) return makeResponse({ schema: 'fbt.scenario-evidence.v1', status: 'NOT_CONFIGURED', rows: [] });
    if (href.includes('/scenario/context')) return makeResponse({ schema: 'fbt.scenario-context.v1', quotes: { US10Y: { status: 'OK', value: 4.1, source: 'treasury', at: Date.now() }, EFFR: { status: 'OK', value: 4.83, source: 'fredcsv:DFF', at: Date.now() } }, stablecoin: { status: 'OK', net24hUsd: -100000, source: 'defillama', at: Date.now() }, exchange: { status: 'UNAVAILABLE' }, headlines: { status: 'OK', items: [{ title: 'Fed decision reported', source: 'source', url: 'https://news.example/story', at: Date.now() }] } });
    if (href.includes('/ohlc/')) return makeResponse(CANDLES);
    if (href.includes('/markets')) return makeResponse(ROWS);
    if (href.includes('/global')) return makeResponse(GLOBAL);
    if (href.includes('/prices')) return makeResponse({});
    return makeResponse({ error: 'not mocked' }, false);
  });
}

beforeEach(async () => {
  installFeed();
  if (typeof window !== 'undefined' && !window.ResizeObserver) {
    window.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
  }
  await i18n.changeLanguage('en');
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

async function mount() {
  const Page = (await import('../src/pages/AiAnalysis.jsx')).default;
  return render(
    <MemoryRouter initialEntries={['/ai-analysis']}>
      <Page />
    </MemoryRouter>
  );
}

/* ── tests ────────────────────────────────────────────────────────────────── */

describe('AI intelligence page', () => {
  it('paints measured market values from the feed and names what it lacks', async () => {
    await mount();

    expect(await screen.findByText('FBT AI Intelligence')).toBeTruthy();
    /* The navigation is a product landmark, not seven anonymous text pills. */
    expect(document.querySelectorAll('.aix-tab .aix-tab-icon')).toHaveLength(8);
    expect(document.querySelector('.aix-tab-overview')?.getAttribute('aria-selected')).toBe('true');
    expect(document.querySelector('[role="tablist"]')).toBeTruthy();
    expect(document.querySelector('[role="tabpanel"]')?.getAttribute('aria-labelledby')).toBe('aix-analysis-tabs-overview');
    expect(document.querySelector('.aix-regime-layout')).toBeTruthy();
    expect(document.querySelector('.aix-regime-narrative')).toBeTruthy();
    expect(await screen.findByText('$2.45T')).toBeTruthy(); // total market cap
    expect(await screen.findByText('58.2%')).toBeTruthy(); // BTC dominance

    /* Breadth is DERIVED, not copied: four of six reported a move above the
       flat band, one is flat (USDC +0.02%) and one is down (AAVE −5.2%). A
       page that printed "advancing" without a denominator could say 4 and
       mean anything. */
    expect(await screen.findByText('4/6')).toBeTruthy();
    expect(screen.getAllByText('6 of 6 tokens carry a 24h change').length).toBeGreaterThan(0);

    /* The feeds we do not have are printed, never replaced by a number. */
    expect(screen.getByText('Fear & Greed index')).toBeTruthy();
    expect(screen.getByText('Derivatives open interest')).toBeTruthy();

    expect(document.body.textContent).not.toMatch(/NaN|undefined|Infinity/);
  });

  it('renders scenario intelligence from measured candles and labels the limits of calibration', async () => {
    await mount();
    fireEvent.click(await screen.findByRole('tab', { name: 'Scenarios 2.0' }));
    expect(await screen.findByText('Scenario Lab 2.0')).toBeTruthy();
    expect(await screen.findByText('Walk-forward model performance')).toBeTruthy();
    expect(screen.getByText('Bull')).toBeTruthy();
    expect(screen.getByText('Neutral')).toBeTruthy();
    expect(screen.getByText('Bear')).toBeTruthy();
    expect(screen.getByText(/Live rates, news and whale flows are context only/)).toBeTruthy();
    expect(await screen.findByText('Live driver readings')).toBeTruthy();
    expect(await screen.findByText('Fed decision reported')).toBeTruthy();
    expect(screen.getByText('Effective Fed funds rate (not the target range)')).toBeTruthy();
    expect(screen.getByText('Forecasts actually issued on this device')).toBeTruthy();
    expect(screen.getByText('Leakage-safe multi-factor validation')).toBeTruthy();
    expect(await screen.findByText('Configure Upstash Redis on the server to collect a shared archive.')).toBeTruthy();
    expect(screen.queryByText(/Held-out association validated/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Test a shock equal to BTC move' }));
    expect(screen.getByLabelText('Uniform price shock (%)').value).toBe('4.1');
    fireEvent.click(screen.getByRole('button', { name: 'Portfolio' }));
    expect(await screen.findByText('Connect a wallet to simulate your portfolio.')).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/NaN|undefined|Infinity/);
  });

  it('switches to the screener and renders the whole feed with a filter', async () => {
    await mount();
    await screen.findByText('FBT AI Intelligence');

    fireEvent.click(screen.getByRole('tab', { name: 'Token screener' }));
    expect(await screen.findByText('AAVE')).toBeTruthy();
    expect(screen.getByText('PEPE')).toBeTruthy();
    expect(document.querySelector('.aix-tab-screener')?.getAttribute('aria-selected')).toBe('true');
    expect(document.querySelector('.aix-table-shell')).toBeTruthy();
    expect(document.querySelectorAll('.aix-trow .coin-logo').length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole('button', { name: 'Losers' }));
    await waitFor(() => {
      expect(screen.queryByText('PEPE')).toBeNull();
      expect(screen.getByText('AAVE')).toBeTruthy();
    });
    expect(document.body.textContent).not.toMatch(/NaN|undefined|Infinity/);
  });

  it('opens a token file and shows the score breakdown with its coverage', async () => {
    await mount();
    await screen.findByText('FBT AI Intelligence');

    fireEvent.click(screen.getByRole('tab', { name: 'Token analysis' }));
    await waitFor(() => {
      expect(screen.getByText('Composite score')).toBeTruthy();
    });

    /* Candles arrived from the mocked OHLC feed, so the chart drew and the
       indicator rails exist. */
    await waitFor(() => {
      expect(screen.getByText('SMA20')).toBeTruthy();
      expect(screen.getByText('SMA200')).toBeTruthy();
    });

    expect(screen.getByText(/Score coverage: \d+% of the weights/)).toBeTruthy();
    /* The score never ships without its caveat. */
    expect(screen.getByText('Not a recommendation')).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/NaN|undefined|Infinity/);
  });

  it('composes the daily report with a source line and six sections', async () => {
    await mount();
    await screen.findByText('FBT AI Intelligence');

    fireEvent.click(screen.getByRole('tab', { name: 'Daily report' }));
    await waitFor(() => {
      expect(screen.getByText('Market overview')).toBeTruthy();
    });
    expect(screen.getByText('Top gainers and losers')).toBeTruthy();
    expect(screen.getByText('What to watch over the next 24h')).toBeTruthy();
    expect(screen.getByText(/^Source: /)).toBeTruthy();
    expect(screen.getByText('Copy text')).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/NaN|undefined|Infinity/);
  });

  it('supports keyboard navigation and keeps opportunity and comparison rooms structured', async () => {
    await mount();
    const overview = await screen.findByRole('tab', { name: 'Overview' });
    fireEvent.keyDown(overview, { key: 'ArrowRight' });
    expect(await screen.findByText('AAVE')).toBeTruthy();
    expect(document.querySelector('.aix-tab-screener')?.getAttribute('aria-selected')).toBe('true');

    fireEvent.click(screen.getByRole('tab', { name: 'Opportunities' }));
    expect(await screen.findByText('Opportunity scanner')).toBeTruthy();
    expect(document.querySelectorAll('.aix-opp').length).toBeGreaterThan(0);
    expect(document.querySelectorAll('.aix-opp-identity .coin-logo').length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole('tab', { name: 'Compare' }));
    expect(await screen.findByText('7-day performance (normalised to 100)')).toBeTruthy();
    expect(document.querySelectorAll('.aix-compare-add .aix-chip')).toHaveLength(3);
    expect(document.querySelector('.aix-swipe-hint')).toBeTruthy();
    expect(document.querySelector('.aix-tab-compare')?.getAttribute('aria-selected')).toBe('true');
    expect(document.body.textContent).not.toMatch(/NaN|undefined|Infinity/);
  });

  it('shows the portfolio as not-connected rather than inventing a P&L', async () => {
    await mount();
    await screen.findByText('FBT AI Intelligence');

    fireEvent.click(screen.getByRole('tab', { name: 'Portfolio' }));
    await waitFor(() => {
      expect(screen.getAllByText(/Connect a wallet/).length).toBeGreaterThan(0);
    });
    expect(document.body.textContent).not.toMatch(/NaN|undefined|Infinity/);
  });
});
