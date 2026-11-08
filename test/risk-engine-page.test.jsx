// @vitest-environment jsdom
/**
 * AI RISK ENGINE — PAGE RENDER + HONESTY
 * ---------------------------------------------------------------------------
 * `test/risk-engine.test.mjs` proves the arithmetic with node. This proves the
 * SCREEN: that /risk mounts inside the real providers, paints measured values
 * from a mocked wallet + feed, opens every one of its six rooms, and — the part
 * that matters most for this feature — never turns a missing measurement into a
 * comfortable zero or a green cell.
 *
 * The feed is mocked in the SHAPE the backend sends, including its gaps: a
 * chain that fails to read, a holding with no price, a token with no contract
 * address. Those gaps are where a risk screen lies if nobody is watching.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import React from 'react';
import { render, screen, cleanup, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

import '../src/i18n/index.js';
import i18n from '../src/i18n/index.js';

/* ── fixtures ─────────────────────────────────────────────────────────────── */

const spark = (base, amp, n = 40) => Array.from({ length: n }, (_, i) => base * (1 + Math.sin(i / 4) * amp));

const MARKET_ROWS = [
  {
    id: 'bitcoin', symbol: 'BTC', name: 'Bitcoin', price: 61234.5, change1h: 0.4, change24h: 1.42,
    change7d: 4.1, mcap: 1_210_000_000_000, volume: 32e9, rank: 1,
    high24h: 62000, low24h: 59800, ath: 73000, athChange: -16.1,
    sparkline: spark(61234, 0.03), dataProvenance: 'live'
  },
  {
    id: 'ethereum', symbol: 'ETH', name: 'Ethereum', price: 3120.4, change1h: -0.2, change24h: -0.81,
    change7d: 2.2, mcap: 375_000_000_000, volume: 18e9, rank: 2,
    high24h: 3300, low24h: 3050, ath: 4878, athChange: -36,
    sparkline: spark(3120, 0.05), dataProvenance: 'live'
  },
  {
    id: 'usdc', symbol: 'USDC', name: 'USD Coin', price: 1.0, change1h: 0.01, change24h: 0.02,
    change7d: 0, mcap: 34_000_000_000, volume: 8e9, rank: 6,
    high24h: 1.01, low24h: 0.99, ath: 1.17, athChange: -14.5,
    sparkline: spark(1, 0.0004), dataProvenance: 'live'
  },
  {
    id: 'pepe', symbol: 'PEPE', name: 'Pepe', price: 0.0000112, change1h: 7.4, change24h: 18.3,
    change7d: 22.1, mcap: 4_700_000_000, volume: 2.1e9, rank: 24,
    high24h: 0.000012, low24h: 0.0000098, ath: 0.0000172, athChange: -34.9,
    sparkline: spark(0.0000112, 0.12), dataProvenance: 'live'
  }
];

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

const CANDLES = Array.from({ length: 40 }, (_, i) => {
  const c = 100 + i * 0.6 + Math.sin(i / 4) * 2;
  return { t: Date.UTC(2026, 9, 1) + i * 86_400_000, o: c - 0.4, h: c + 1.2, l: c - 1.3, c };
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
    if (href.includes('/providers/status')) {
      return makeResponse({
        summary: '1/2',
        providers: [
          { id: 'kyberswap', configured: true, reachable: true, authenticated: true },
          { id: 'lifi', configured: true, reachable: false, authenticated: false }
        ]
      });
    }
    if (href.includes('/token-risk')) {
      return makeResponse({
        raw: { is_honeypot: '1', is_open_source: '0', transfer_pausable: '1', holder_count: '120' }
      });
    }
    if (href.includes('/lending/positions/')) {
      return makeResponse({
        totalCollateralUsd: 9000, totalDebtUsd: 6000, ltvPct: 66,
        liquidationThresholdPct: 80, healthFactor: 1.2,
        balances: {}, meta: { schema: 'fbt.lending.positions.v1', dataStatus: 'complete', source: 'server-bff' }
      });
    }
    if (href.includes('/ohlc/')) return makeResponse(CANDLES);
    if (href.includes('/markets')) return makeResponse(MARKET_ROWS);
    if (href.includes('/global')) return makeResponse(GLOBAL);
    if (href.includes('/prices')) return makeResponse({});
    return makeResponse({ error: 'not mocked' }, false);
  });
}

/* A wallet with a real book: a concentrated position, a thin memecoin, a
   stable buffer, and a chain that cannot be read. */
const CHAINS = {
  failingChainRead: () => true,
  rows: [
    { key: '1:BTC', symbol: 'BTC', name: 'Bitcoin', amount: 0.65, value: 39802, chainId: 1, native: false, coingeckoId: 'bitcoin', priced: true },
    { key: '1:ETH', symbol: 'ETH', name: 'Ethereum', amount: 9.6, value: 29955, chainId: 1, native: false, coingeckoId: 'ethereum', priced: true },
    { key: '1:USDC', symbol: 'USDC', name: 'USD Coin', amount: 5000, value: 5000, chainId: 1, native: false, coingeckoId: 'usdc', priced: true },
    { key: '56:PEPE', symbol: 'PEPE', name: 'Pepe', amount: 1e9, value: 11200, chainId: 56, native: false, coingeckoId: 'pepe', priced: true },
    /* A holding the feed could not price — it must never be counted as 0. */
    { key: '56:LOCAL', symbol: 'LOCAL', name: 'Untraded Token', amount: 1e6, value: null, chainId: 56, native: false, coingeckoId: null, priced: false }
  ]
};

/*
 * ─── THE ONE RULE EVERY MOCK HERE FOLLOWS ──────────────────────────────────
 * A mocked hook must return THE SAME OBJECT on every call. `usePortfolioRoom`
 * puts this value into `useMemo` dependency lists; a fresh literal per render
 * changes every dependency on every render, which re-runs the report, which
 * re-renders — the loop that once produced a `/api/system/state` storm in this
 * app, and that hangs the test runner rather than failing a test. So every
 * fixture below is a module constant.
 */
const WALLET = {
  address: '0x1234567890abcdef1234567890abcdef12345678',
  chainId: 1,
  connected: true,
  isConnected: true,
  /*
   * `usePortfolioRoom` only takes the MULTI-chain path when the wallet exposes
   * a read provider; without it the room falls back to `useWalletBalances`,
   * which would open real per-chain reads inside the test. Supplying the
   * function is what makes the mocked portfolio below the one that is used —
   * and it is also what the real provider does.
   */
  getReadProvider: () => ({})
};

const CHAIN_ROWS = [
  { chainId: 1, error: null, stale: false, rows: CHAINS.rows.filter((r) => r.chainId === 1) },
  { chainId: 56, error: 'RPC_TIMEOUT', stale: false, rows: CHAINS.rows.filter((r) => r.chainId === 56) }
];

const PORTFOLIO = {
  connected: true,
  loading: false,
  rows: CHAINS.rows,
  marketRows: MARKET_ROWS,
  chains: CHAIN_ROWS,
  totalValue: 75957,
  pricedCount: 4,
  partial: true,
  staleChains: [],
  failedChains: [56],
  chainReads: 1
};

vi.mock('../src/context/WalletContext', () => ({
  useWallet: () => WALLET
}));

vi.mock('../src/hooks/useMultiChainPortfolio', () => ({
  useMultiChainPortfolio: () => PORTFOLIO
}));

beforeEach(async () => {
  installFeed();
  try { localStorage.clear(); } catch { /* jsdom without storage */ }
  if (typeof window !== 'undefined' && !window.ResizeObserver) {
    window.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
  }
  if (typeof window !== 'undefined' && !window.matchMedia) {
    window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  }
  await i18n.changeLanguage('fa');
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

async function mount() {
  const Page = (await import('../src/pages/AiRiskEngine.jsx')).default;
  return render(
    <MemoryRouter initialEntries={['/risk']}>
      <Page />
    </MemoryRouter>
  );
}

/* ── tests ────────────────────────────────────────────────────────────────── */

describe('AI Risk Engine page', () => {
  it('mounts with its six rooms and a real tablist', async () => {
    await mount();

    expect(await screen.findByText('موتور ریسک هوش مصنوعی FBT')).toBeTruthy();
    expect(document.querySelectorAll('.rk-tabs [role="tab"]')).toHaveLength(6);
    expect(document.querySelector('[role="tablist"]')).toBeTruthy();
    expect(document.querySelector('.rk-tabs [role="tab"][aria-selected="true"]')).toBeTruthy();
    expect(document.querySelector('[role="tabpanel"]')).toBeTruthy();
    expect(document.querySelector('.rk-page')?.getAttribute('dir')).toBe('rtl');
  });

  it('paints a measured portfolio score with its band and coverage', async () => {
    await mount();

    /* The ring prints the number it was given, out of 100 — never a placeholder
       that looks like a reading. */
    const ring = document.querySelector('.aix-ring-center strong');
    expect(ring).toBeTruthy();
    const value = Number(ring.textContent);
    expect(Number.isFinite(value)).toBe(true);
    expect(value).toBeGreaterThanOrEqual(0);
    expect(value).toBeLessThanOrEqual(100);

    /* The band label is one of the taxonomy's own, in Persian. */
    const band = document.querySelector('.rk-score-band')?.textContent || '';
    expect(band.length).toBeGreaterThan(0);

    /* Coverage, measured families and the direction are all on screen — and
       every one of them is a SENTENCE, not a dictionary key left unresolved. */
    const body = document.body.textContent;
    expect(body).toContain('/100');
    expect(body).toMatch(/\d+\/10/);
    expect(body).toContain('بالاتر باشد، ریسک بیشتر است');
    expect(body).not.toContain('score.coverage');
    expect(body).not.toContain('page.measured');
  });

  it('renders all ten risk families, and never draws an unmeasured one as zero', async () => {
    await mount();

    const cards = document.querySelectorAll('.rk-family');
    expect(cards).toHaveLength(10);

    for (const card of cards) {
      const chip = card.querySelector('.rk-score-chip b');
      expect(chip).toBeTruthy();
      const text = chip.textContent.trim();
      /* Either a real number, or an em dash. A "0" on a family that was never
         measured is the exact lie this screen exists to avoid. */
      if (text === '—') {
        expect(card.classList.contains('is-null')).toBe(true);
      } else {
        expect(Number.isFinite(Number(text))).toBe(true);
      }
    }

    /* The stablecoin family is measured here (USDC is priced), so at least one
       family must carry a real reading. */
    const measured = [...cards].filter((c) => c.querySelector('.rk-score-chip b')?.textContent.trim() !== '—');
    expect(measured.length).toBeGreaterThan(0);
  });

  it('explains the cause under the families it measured', async () => {
    await mount();
    /* Every measured family carries at least one reason line — the owner's
       requirement was «توضیح علت», not a bare number. */
    const reasons = document.querySelectorAll('.rk-family .rk-reasons li');
    expect(reasons.length).toBeGreaterThan(3);
    for (const li of reasons) {
      expect(li.textContent.trim().length).toBeGreaterThan(3);
      /* No unresolved placeholders leaked into the DOM. */
      expect(li.textContent).not.toMatch(/\{[a-zA-Z]+\}/);
    }
  });

  it('opens the heat map and draws a dot, not a zero, for an unmeasured cell', async () => {
    await mount();
    const tabs = document.querySelectorAll('.rk-tabs [role="tab"]');
    fireEvent.click(tabs[1]);

    await waitFor(() => expect(document.querySelector('.rk-heat')).toBeTruthy());

    const rows = document.querySelectorAll('.rk-heat tbody tr');
    expect(rows.length).toBeGreaterThanOrEqual(4);

    /* The contract column must be a dot for every asset whose scan did not
       happen — which is most of them — rather than a green 0. */
    const nullCells = document.querySelectorAll('.rk-cell.is-null');
    expect(nullCells.length).toBeGreaterThan(0);
    for (const cell of nullCells) {
      expect(cell.textContent.trim()).toBe('·');
    }

    /* And the network table shows the chain that could not be read. */
    const networks = document.querySelectorAll('.rk-net');
    expect(networks.length).toBeGreaterThan(0);
    const failed = document.querySelector('.rk-net-failed');
    expect(failed).toBeTruthy();
    expect(failed.textContent).toContain('خوانده نشد');
  });

  it('opens the live monitor, which refuses to invent a trend from one reading', async () => {
    await mount();
    const tabs = document.querySelectorAll('.rk-tabs [role="tab"]');
    fireEvent.click(tabs[2]);

    await waitFor(() => expect(document.querySelector('.rk-monitor-banner')).toBeTruthy());
    /* One reading is not a trend: the panel says so instead of drawing a line. */
    const banner = document.querySelector('.rk-monitor-banner').textContent;
    expect(banner).toMatch(/هنوز تغییری ثبت نشده|No change recorded/);
    expect(document.querySelector('.rk-monitor-idle')).toBeTruthy();
    expect(document.querySelector('.rk-monitor-chart')).toBeNull();
  });

  it('lists alerts with a cause, or says plainly that nothing was found', async () => {
    await mount();
    const tabs = document.querySelectorAll('.rk-tabs [role="tab"]');
    fireEvent.click(tabs[3]);

    await waitFor(() => expect(document.querySelector('.rk-alerts, .aix-empty, .rk-empty, .empty-state')).toBeTruthy());

    const alerts = document.querySelectorAll('.rk-alert');
    if (alerts.length) {
      for (const a of alerts) {
        /* A title, a body, and the «چون» block that names the cause. */
        expect(a.querySelector('.rk-alert-title')?.textContent.trim().length).toBeGreaterThan(2);
        expect(a.querySelector('.rk-alert-body')?.textContent.trim().length).toBeGreaterThan(10);
        expect(a.querySelector('.rk-alert-because li')).toBeTruthy();
        /* No severity colour outside the three the engine emits. */
        expect(a.className).toMatch(/rk-t-(serious|raised|watch)/);
      }
      /* The most severe alert is first. */
      const classes = [...alerts].map((a) => (a.className.match(/rk-t-(\w+)/) || [])[1]);
      const rank = { serious: 0, raised: 1, watch: 2 };
      const order = classes.map((c) => rank[c] ?? 3);
      expect(order).toEqual([...order].sort((x, y) => x - y));
    } else {
      /* The empty state must say "nothing was found", never "all clear". */
      expect(document.body.textContent).toMatch(/هیچ هشدار فعالی نیست|No alert is active/);
    }
  });

  it('runs the stress centre and prints each scenario with its assumptions', async () => {
    await mount();
    const tabs = document.querySelectorAll('.rk-tabs [role="tab"]');
    fireEvent.click(tabs[4]);

    await waitFor(() => expect(document.querySelector('.rk-stress')).toBeTruthy());

    const cards = document.querySelectorAll('.rk-stress');
    expect(cards.length).toBeGreaterThanOrEqual(6);

    /* No scenario may claim a forecast, and each must expose its assumptions. */
    expect(document.querySelectorAll('.rk-assume').length).toBe(cards.length);
    for (const card of cards) {
      const delta = card.querySelector('.rk-stress-figure strong');
      expect(delta).toBeTruthy();
      expect(delta.textContent).not.toMatch(/NaN|undefined|Infinity/);
      const rows = card.querySelectorAll('.rk-stress-rows dd');
      for (const dd of rows) expect(dd.textContent).not.toMatch(/NaN|undefined/);
    }

    /* The Monte-Carlo card prints a distribution, not a single path. */
    const mc = [...cards].find((c) => c.querySelector('.rk-mc-bands'));
    expect(mc).toBeTruthy();
    expect(mc.querySelectorAll('.rk-mc-bands span')).toHaveLength(3);

    /* The assumption text is readable without another click on the first card. */
    const first = cards[0].querySelector('.rk-assume');
    expect(first.tagName.toLowerCase()).toBe('details');
    expect(first.querySelectorAll('li').length).toBeGreaterThanOrEqual(2);
  });

  it('shows recommendations whose impact is measured, and marks the ones that are not', async () => {
    await mount();
    const tabs = document.querySelectorAll('.rk-tabs [role="tab"]');
    fireEvent.click(tabs[5]);

    await waitFor(() => expect(document.querySelector('.rk-rec, .aix-empty, .empty-state')).toBeTruthy());

    const recs = document.querySelectorAll('.rk-rec');
    if (recs.length) {
      /* At least one recommendation must carry a MEASURED effect — the whole
         difference between this and a tip feed. */
      const measured = document.querySelectorAll('.rk-rec-impact.is-good');
      expect(measured.length).toBeGreaterThan(0);
      for (const m of measured) {
        expect(m.textContent).toMatch(/امتیاز/);
        expect(m.textContent).not.toMatch(/NaN/);
      }
      /* Every card ends with the no-execution note. */
      expect(document.querySelector('.rk-not-advice')).toBeTruthy();
    }
  });

  it('never leaks NaN, undefined or a raw key into the rendered page', async () => {
    await mount();
    const tabs = document.querySelectorAll('.rk-tabs [role="tab"]');
    for (let i = 0; i < tabs.length; i += 1) {
      fireEvent.click(document.querySelectorAll('.rk-tabs [role="tab"]')[i]);
      await waitFor(() => expect(document.querySelector('[role="tabpanel"]')).toBeTruthy());
      const text = document.querySelector('[role="tabpanel"]').textContent || '';
      expect(text).not.toMatch(/NaN|undefined|Infinity/);
      /* A key that never resolved into a sentence (e.g. `page.title`). */
      expect(text).not.toMatch(/\b(page|score|family|alert|rec|stress|monitor|actions)\.[a-zA-Z]{3,}\b/);
      expect(text).not.toMatch(/\{[a-zA-Z]+\}/);
    }
  });

  it('states on screen that it does not execute or advise', async () => {
    await mount();
    const body = document.body.textContent;
    expect(body).toMatch(/نه توصیهٔ معاملاتی|not investment advice/);
    expect(body).toMatch(/اجرا|executes/);
    /* The engine's laws are printed in the sources sheet, not merely implied. */
    fireEvent.click(document.querySelectorAll('.aix-head-action')[1]);
    await waitFor(() => expect(document.querySelector('.aix-sources')).toBeTruthy());
    const laws = document.querySelectorAll('.rk-laws li');
    expect(laws.length).toBeGreaterThanOrEqual(5);
  });
});
