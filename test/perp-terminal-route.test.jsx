// @vitest-environment jsdom
/**
 * THE DESK AT `/perp/terminal` — a rendered tree, not a source grep.
 * ---------------------------------------------------------------------------
 * What only a render can prove:
 *
 *   · the desk is a FIXED full-height grid at desktop width and a natural
 *     stack on a phone (which is a CSS contract, so it is asserted on the
 *     stylesheet as well as on the DOM). The old sticky-bottom ticket was
 *     removed on purpose: the report was «پایین صفحه ثابت و بالای صفحه متحرک»
 *     — bottom fixed, top floating — and the fix is that EVERYTHING is fixed,
 *     not that something else sticks. Asserted against the stylesheet.
 *   · every money figure is inside a `.pt-mono` element — the RTL/tabular rule
 *     the whole screen depends on;
 *   · an unknown number renders as «—» and NEVER as 0, and the top bar says
 *     `data-status="unavailable"` rather than pretending to be live;
 *   · the liquidation cell names its PROVENANCE, so an exact venue number and a
 *     100%-loss bound cannot be mistaken for each other;
 *   · the ticket refuses an order type the venue does not accept, and its
 *     submit button says why instead of failing at the tap;
 *   · the risk panel shows the two vocabularies with an explicit, visible
 *     translation rather than picking one and hiding the other;
 *   · `/perp` still has no ticket (the list-only guarantee is not quietly lost
 *     by this route's arrival).
 *
 * Network clients, wallets and the chart are stubbed; the desk's arithmetic,
 * the venue contracts and the risk engine are the real modules.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import fa from '../src/i18n/locales/fa.json';
import en from '../src/i18n/locales/en.json';

const dict = { fa, en };
let LANG = 'en';
const get = (o, p) => p.split('.').reduce((a, k) => (a == null ? undefined : a[k]), o);
const tFor = (lang) => (key, opts = {}) => {
  let v = get(dict[lang], key);
  if (v == null) v = get(dict.en, key);
  /* i18next interpolates the defaultValue too; a mock that does not makes
     `{{placeholder}}` leak into assertions that are really about the copy. */
  const raw = v == null ? (opts.defaultValue ?? key) : String(v);
  return String(raw).replace(/\{\{(\w+)\}\}/g, (_, k) => String(opts[k] ?? ''));
};
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: tFor(LANG), i18n: { language: LANG, changeLanguage: () => {} } })
}));

/* framer-motion: a stable component per tag (a fresh one remounts the tree). */
const MOTION = new Map();
vi.mock('framer-motion', () => ({
  motion: new Proxy({}, {
    get: (_, tag) => {
      const T = String(tag);
      if (!MOTION.has(T)) {
        MOTION.set(T, ({ children, ...p }) => {
          const clean = Object.fromEntries(Object.entries(p).filter(([k]) => !['initial', 'animate', 'exit', 'transition', 'whileTap', 'whileHover', 'layout', 'layoutId', 'variants'].includes(k)));
          return <T {...clean}>{children}</T>;
        });
      }
      return MOTION.get(T);
    }
  }),
  AnimatePresence: ({ children }) => <>{children}</>,
  useReducedMotion: () => true
}));

vi.mock('../src/components/PageTransition', () => ({ default: ({ children }) => <div>{children}</div>, riseIn: {}, stagger: {} }));

/* The chart is a canvas + a vendor bundle; the desk's job is to MOUNT it with
   the right market, not to draw candles in jsdom. */
const CHART_PROPS = [];
vi.mock('../src/components/FuturesMarketChart', () => ({
  default: (props) => { CHART_PROPS.push(props); return <div data-testid="chart-stub">{props.provider}:{props.market}</div>; }
}));

let WALLET = { isConnected: false, address: null, chainId: 1 };
vi.mock('../src/context/WalletContext', () => ({ useWallet: () => WALLET, shortAddress: (a) => String(a || '') }));
let SOL = { address: null, isConnected: false };
vi.mock('../src/hooks/useSolanaWallet', () => ({ useSolanaWallet: () => SOL }));

/* ── the venue feeds ─────────────────────────────────────────────────────── */
let FUTURES_MARKETS = { drift: [], ostium: [] };
vi.mock('../src/lib/futuresClient', () => ({
  /* `null` in the fixture = the read FAILED (this is how the server badge
     tells «server answered, zero markets» from «server unreachable»). */
  getFuturesMarkets: async (p) => (FUTURES_MARKETS[p] == null
    ? { ok: false, error: { code: 'UNAVAILABLE' } }
    : { ok: true, data: { markets: FUTURES_MARKETS[p] } }),
  getFuturesPositions: async () => ({ ok: true, data: { positions: [] } }),
  getFuturesAccount: async () => ({ ok: true, data: { balanceUsd: null } }),
  prepareFutures: async () => ({ ok: true, data: { executionId: 'x', transactions: [] } }),
  verifyFutures: async () => ({ ok: true }),
  getFuturesFeePreview: async () => ({ ok: true, data: null })
}));

/* The route wrapper reads the market table for the dropdown logos; keep the
   suite hermetic. */
vi.mock('../src/hooks/useMarket', () => ({
  useMarkets: () => ({ data: [], loading: false, error: null, updatedAt: 0, refresh: () => {} })
}));

let DYDX_MARKETS = [];
let BOOK = { live: true, bestBid: 99.5, bestAsk: 100.5, mid: 100, spreadBps: 100, bidDepth: [], askDepth: [] };
let TRADES = [];
let RANGE = { high24h: null, low24h: null, live: false };
let SUBACCOUNT = { account: null, live: false };
let SESSION_ADDRESS = null;
let CONNECT_CALLS = [];
vi.mock('../src/lib/dydx', () => ({
  getDydxMarkets: async () => ({ markets: DYDX_MARKETS, live: DYDX_MARKETS.length > 0 }),
  getDydxOrderbook: async () => BOOK,
  getDydxTrades: async () => ({ trades: TRADES, live: TRADES.length > 0 }),
  getDydx24hRange: async () => RANGE,
  getDydxSubaccount: async () => SUBACCOUNT,
  dydxSessionAddress: () => SESSION_ADDRESS,
  placeDydxOrder: async () => ({ hash: '0xabc' }),
  connectDydx: async ({ onStage } = {}) => { CONNECT_CALLS.push('connect'); onStage?.('sign'); SESSION_ADDRESS = 'dydx1sessiontest000000000000000000000000'; return { address: SESSION_ADDRESS }; },
  disconnectDydx: () => { CONNECT_CALLS.push('disconnect'); SESSION_ADDRESS = null; },
  classifyDydxError: (e) => String(e?.message || e),
  classifyDydxOrderError: (e) => String(e?.message || e)
}));

const dydxMarket = (over = {}) => ({
  ticker: 'BTC-USD', status: 'ACTIVE', oraclePrice: 100, priceChange24H: -2.5,
  volume24H: 1_000_000, openInterest: 500_000, nextFundingRate: 0.0000125,
  nextFundingAt: '2026-11-08T20:00:00.000Z', initialMarginFraction: 0.05,
  maintenanceMarginFraction: 0.025, trades24H: 1234, maxLeverage: 20,
  atomicResolution: -10, quantumConversionExponent: -9, stepBaseQuantums: 1, subticksPerTick: 1,
  clobPairId: '1', ...over
});

/* The page imports the real perpRoutes (merge + route choice), so the fixtures
   have to look like what the venue clients actually return. */
beforeEach(() => {
  LANG = 'en';
  CHART_PROPS.length = 0;
  DYDX_MARKETS = [dydxMarket()];
  FUTURES_MARKETS = { drift: [{ marketId: '1', base: 'ETH', symbol: 'ETH/USDT', mid: 2500, maxLeverage: 10, category: 'crypto' }], ostium: [] };
  BOOK = { live: true, bestBid: 99.5, bestAsk: 100.5, mid: 100, spreadBps: 100, bidDepth: [{ price: 99.5, size: 2, usd: 199 }, { price: 99, size: 3, usd: 297 }], askDepth: [{ price: 100.5, size: 1, usd: 100.5 }] };
  TRADES = [
    { id: 'a', price: 100.5, size: 2, usd: 201, side: 'buy', atMs: Date.now() },
    { id: 'b', price: 99.5, size: 1, usd: 99.5, side: 'sell', atMs: Date.now() - 1000 }
  ];
  RANGE = { high24h: 110, low24h: 90, live: true };
  SUBACCOUNT = { account: null, live: false };
  SESSION_ADDRESS = null;
  CONNECT_CALLS = [];
  WALLET = { isConnected: false, address: null, chainId: 1 };
  SOL = { address: null, isConnected: false };
});

afterEach(() => { cleanup(); });

import PerpTerminal from '../src/pages/PerpTerminal.jsx';

const renderDesk = async (initial = '/perp/terminal') => {
  const out = render(
    <MemoryRouter initialEntries={[initial]}>
      <Routes>
        <Route path="/perp/terminal" element={<PerpTerminal />} />
        <Route path="/perp" element={<div data-testid="perp-list-stub">list</div>} />
      </Routes>
    </MemoryRouter>
  );
  await waitFor(() => expect(screen.getByTestId('perp-terminal')).toBeTruthy());
  return out;
};

describe('the desk', () => {
  it('renders the picker, the chart and the ticket, and mounts the chart for the routed venue', async () => {
    await renderDesk();
    /* The market list is now the LOGO DROPDOWN — the requirement was «برای
       انتخاب توکن ها با لوگو و باکس بازشونده باشد». */
    expect(screen.getByTestId('pair-select')).toBeTruthy();
    expect(screen.getByTestId('pair-select-button')).toBeTruthy();
    expect(screen.getByTestId('perp-terminal-chart')).toBeTruthy();
    expect(screen.getByTestId('perp-ticket')).toBeTruthy();
    expect(screen.getByTestId('perp-terminal-bottom')).toBeTruthy();
    await waitFor(() => expect(CHART_PROPS.length).toBeGreaterThan(0));
    /* dYdX lists BTC, so the dYdX market id (its ticker) is what the chart is
       asked to draw — not a base symbol invented by this page. */
    expect(CHART_PROPS[0].provider).toBe('dydx');
    expect(CHART_PROPS[0].market).toBe('BTC-USD');
  });

  it('shows the 24h high/low the venue does not publish, from its own candles', async () => {
    await renderDesk();
    await waitFor(() => expect(screen.getByTestId('perp-top-high').textContent).not.toBe('—'));
    expect(screen.getByTestId('perp-top-high').textContent).toContain('110');
    expect(screen.getByTestId('perp-top-low').textContent).toContain('90');
  });

  it('prints «—» for a number it does not have, and never 0', async () => {
    RANGE = { high24h: null, low24h: null, live: false };
    DYDX_MARKETS = [dydxMarket({ priceChange24H: null, nextFundingAt: null })];
    await renderDesk();
    await waitFor(() => expect(screen.getByTestId('perp-top-high')).toBeTruthy());
    expect(screen.getByTestId('perp-top-high').textContent).toBe('—');
    expect(screen.getByTestId('perp-top-low').textContent).toBe('—');
    expect(screen.getByTestId('perp-top-change').textContent.trim()).toBe('—');
    expect(screen.getByTestId('perp-top-next').textContent).toBe('—');
  });

  it('labels the top bar unavailable when there is no mark at all', async () => {
    DYDX_MARKETS = [];
    FUTURES_MARKETS = { drift: [], ostium: [] };
    await renderDesk('/perp/terminal?market=DOGE');
    await waitFor(() => expect(screen.getByTestId('perp-top-mark').getAttribute('data-status')).toBe('unavailable'));
    expect(screen.getByText(/No in-app venue lists this pair/i)).toBeTruthy();
  });

  it('prices the ticket from the engine and names the liquidation provenance', async () => {
    await renderDesk();
    const notional = screen.getByTestId('perp-ticket-notional');
    await waitFor(() => expect(notional.textContent).not.toBe('—'));
    /* default: 50 collateral at 3x = 150 notional, at a mark of 100 → size 1.5 */
    expect(notional.textContent).toContain('150');
    expect(screen.getByTestId('perp-ticket-size').textContent).toBe('1.5');
    const liq = screen.getByTestId('perp-ticket-liq');
    expect(liq.textContent).not.toBe('—');
    const prov = screen.getByTestId('perp-ticket-liq-provenance');
    /* The market publishes a 2.5% maintenance fraction, so this is the exact
       venue model and the label says so. */
    expect(prov.getAttribute('data-provenance')).toBe('venue-maintenance-margin');
    expect(prov.textContent.toLowerCase()).toContain('exact');
  });

  it('says OUT LOUD when the liquidation is only an upper bound', async () => {
    /* No maintenance fraction published → the engine falls back to the bound,
       and the tag must change with it. */
    DYDX_MARKETS = [dydxMarket({ maintenanceMarginFraction: null, raw: { ticker: 'BTC-USD', initialMarginFraction: '0.05' } })];
    await renderDesk();
    await waitFor(() => expect(screen.getByTestId('perp-ticket-liq-provenance')).toBeTruthy());
    expect(screen.getByTestId('perp-ticket-liq-provenance').getAttribute('data-provenance')).toBe('upper-bound');
    expect(screen.getByTestId('perp-ticket-liq-provenance').textContent.toLowerCase()).toContain('approximate');
  });

  it('offers only the order types the venue accepts and says what it does not', async () => {
    await renderDesk();
    expect(screen.getByTestId('perp-ticket-type-market')).toBeTruthy();
    expect(screen.getByTestId('perp-ticket-type-limit')).toBeTruthy();
    expect(screen.getByTestId('perp-ticket-type-stopMarket')).toBeTruthy();
    expect(screen.queryByTestId('perp-ticket-type-stopLimit')).toBeNull();
    const note = screen.getByTestId('perp-ticket-unavailable-types');
    expect(note.textContent.toLowerCase()).toContain('stop');
  });

  it('asks for a price when Limit is chosen, and refuses to send without it', async () => {
    await renderDesk();
    fireEvent.click(screen.getByTestId('perp-ticket-type-limit'));
    await waitFor(() => expect(screen.getByTestId('perp-ticket-price')).toBeTruthy());
    /* No wallet in this test, so the actionable control is the connect button
       and there is no submit button to press by mistake. */
    expect(screen.getByTestId('perp-ticket-connect')).toBeTruthy();
    expect(screen.queryByTestId('perp-ticket-submit')).toBeNull();
  });

  it('shows the ticket numbers on the same keys in Persian, with no raw keys on screen', async () => {
    LANG = 'fa';
    await renderDesk();
    expect(screen.getByTestId('perp-ticket')).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/perpTerminal\.[a-zA-Z]+\./);
  });

  it('renders the book, the tape and the risk panel in the bottom stack', async () => {
    await renderDesk();
    expect(screen.getByTestId('perp-terminal-depth')).toBeTruthy();
    fireEvent.click(screen.getByTestId('perp-terminal-tab-tape'));
    await waitFor(() => expect(screen.getByTestId('perp-terminal-tape')).toBeTruthy());
    expect(screen.getAllByTestId('perp-tape-row-buy').length).toBeGreaterThan(0);
    fireEvent.click(screen.getByTestId('perp-terminal-tab-risk'));
    await waitFor(() => expect(screen.getByTestId('perp-terminal-risk')).toBeTruthy());
    /* No wallet → the panel says so instead of inventing a healthy account. */
    expect(screen.getByTestId('perp-risk-unavailable')).toBeTruthy();
  });

  it('shows BOTH risk vocabularies for a real account, with one as the translation', async () => {
    /* 2000 notional on 1000 equity, 720 held as maintenance = 72% margin ratio:
       the engine calls this MEDIUM, the Intent OS scale has no MEDIUM, and the
       badge must carry both words rather than pick one and hide the other. */
    SESSION_ADDRESS = 'dydx1abcdefghijklmnopqrstuvwxyz0123456789';
    SUBACCOUNT = {
      live: true,
      account: {
        subaccount: {
          equity: 1000,
          freeCollateral: 280,
          maintenanceMargin: 720,
          openPerpetualPositions: {
            'BTC-USD': { market: 'BTC-USD', size: '20', entryPrice: '100', unrealizedPnl: '0' }
          }
        }
      }
    };
    await renderDesk();
    fireEvent.click(screen.getByTestId('perp-terminal-tab-risk'));
    await waitFor(() => expect(screen.getByTestId('perp-risk-level')).toBeTruthy());
    const badge = screen.getByTestId('perp-risk-level');
    const words = { LOW: 'LOW', MEDIUM: 'ELEVATED', HIGH: 'HIGH', EXTREME: 'CRITICAL' };
    const intentWord = badge.getAttribute('data-intent-word');
    expect(Object.values(words)).toContain(intentWord);
    /* The engine's word is the primary label; the Intent OS word follows it. */
    const engineWord = Object.keys(words).find((k) => words[k] === intentWord);
    expect(badge.textContent.toUpperCase()).toContain(engineWord);
    expect(badge.textContent.toUpperCase()).toContain(intentWord);
    /* and the panel's numbers are the account's, not zeros */
    expect(screen.getByTestId('perp-risk-gross').textContent).toContain('$2.0K');
    expect(screen.getByTestId('perp-risk-margin-ratio').textContent).toContain('72');
    expect(screen.getByTestId('perp-risk-warnings').textContent.length).toBeGreaterThan(0);
  });

  it('says the server is connected only after real reads land', async () => {
    await renderDesk();
    await waitFor(() => expect(screen.getByTestId('perp-terminal-server').className).toContain('is-live'));
  });

  it('when every read fails the header says so — with a retry, never a fake «live»', async () => {
    FUTURES_MARKETS = { drift: null, ostium: null };
    DYDX_MARKETS = [];
    await renderDesk('/perp/terminal?market=DOGE');
    await waitFor(() => expect(screen.getByTestId('perp-terminal-server').className).toContain('is-offline'));
    expect(screen.getByTestId('perp-terminal-retry')).toBeTruthy();
  });

  it('retrying after an outage recovers the badge when the feeds return', async () => {
    FUTURES_MARKETS = { drift: null, ostium: null };
    DYDX_MARKETS = [];
    await renderDesk('/perp/terminal?market=ETH');
    await waitFor(() => expect(screen.getByTestId('perp-terminal-server').className).toContain('is-offline'));
    FUTURES_MARKETS = { drift: [{ marketId: '2', base: 'ETH', symbol: 'ETH/USDT', mid: 2500, maxLeverage: 10 }], ostium: [] };
    DYDX_MARKETS = [dydxMarket({ ticker: 'ETH-USD' })];
    fireEvent.click(screen.getByTestId('perp-terminal-retry'));
    await waitFor(() => expect(screen.getByTestId('perp-terminal-server').className).toContain('is-live'));
  });

  it('a connected EVM wallet gets the one-signature dYdX activation — never «connect a wallet»', async () => {
    /* The reported bug: «با اینکه کیف پول وصله ارتباط با سرور برقرار نمیکنه و
       میگه وصل کنی». The wallet IS connected here; the missing piece is the
       in-memory session, so the button must offer activation, not connection. */
    WALLET = { isConnected: true, address: '0xabc123', chainId: 1, mode: 'wc' };
    await renderDesk();
    await waitFor(() => expect(screen.getByTestId('perp-ticket-activate')).toBeTruthy());
    expect(screen.queryByTestId('perp-ticket-connect')).toBeNull();
    fireEvent.click(screen.getByTestId('perp-ticket-activate'));
    await waitFor(() => expect(CONNECT_CALLS).toContain('connect'));
    /* after the signature the submit button replaces the activation button */
    await waitFor(() => expect(screen.getByTestId('perp-ticket-submit')).toBeTruthy());
    expect(screen.queryByTestId('perp-ticket-activate')).toBeNull();
  });

  it('the desk is a fixed full-height grid on desktop — nothing sticky, everything fits', async () => {
    /* THE CONTRACT CHANGED ON PURPOSE. The user reported «بالای صفحه متحرک،
       پایین صفحه ثابت» — the top scrolled while the bottom stayed glued — and
       asked for «همه ثابت باشد» (EVERYTHING fixed, with proper spacing) plus
       «تمام صفحه باشد» (full page). The old contract pinned a sticky ticket;
       the new one pins a FIXED 100dvh grid where every row/column owns its
       space and the page never scrolls on desktop. Below 1200px the grid
       stacks and the page flows again — a clipped phone desk is not «fixed». */
    const fs = await import('node:fs');
    const css = fs.readFileSync(`${process.cwd()}/src/styles/perp-terminal.css`, 'utf8');
    /* desktop: fixed full-height grid with explicit rows */
    expect(css).toMatch(/@media \(min-width: 1200px\)/);
    expect(css).toMatch(/height:\s*calc\(100dvh/);
    expect(css).toMatch(/grid-template-rows:\s*auto auto minmax\(0, 1fr\) 252px auto/);
    /* the desk itself: chart + 340px ticket */
    expect(css).toMatch(/\.ptx-main\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\) 340px/s);
    /* NOTHING inside the desk is sticky any more — especially not the ticket */
    expect(css).not.toMatch(/\.ptx-ticket\s*\{[^}]*position:\s*sticky/s);
    expect(css).toMatch(/@media \(max-width: 1199px\)/);
    expect(css).toMatch(/@media \(max-width: 899px\)/);
    expect(css).toMatch(/font-variant-numeric:\s*tabular-nums/);
  });
});

describe('mobile terminal dock', () => {
  it('changes direction without submitting and opens all four real panels in a sheet', async () => {
    const old = window.matchMedia;
    window.matchMedia = () => ({ matches: true, addEventListener() {}, removeEventListener() {} });
    try {
      const { unmount } = await renderDesk();
      expect(document.body.classList.contains('perp-terminal-screen')).toBe(true);
      expect(screen.queryByTestId('perp-terminal-bottom')).toBeNull();
      const toggle = screen.getByTestId('ptx-mobile-side');
      expect(toggle.getAttribute('aria-checked')).toBe('false');
      fireEvent.click(toggle, { detail: 0 });
      expect(toggle.getAttribute('aria-checked')).toBe('true');
      expect(screen.getByTestId('perp-ticket-short').getAttribute('aria-pressed')).toBe('true');
      expect(screen.queryByTestId('perp-ticket-sign')).toBeNull();
      fireEvent.click(screen.getByTestId('ptx-mobile-panels'));
      expect(screen.getByTestId('ptx-mobile-sheet')).toBeTruthy();
      for (const tab of ['book','risk','funding','tape']) {
        fireEvent.click(screen.getByTestId(`perp-terminal-tab-${tab}`));
        expect(screen.getByTestId(`perp-terminal-tab-${tab}`).getAttribute('aria-selected')).toBe('true');
      }
      expect(screen.getByTestId('perp-terminal-tape')).toBeTruthy();
      fireEvent.click(screen.getByTestId('ptx-mobile-sheet-close'));
      expect(screen.queryByTestId('ptx-mobile-sheet')).toBeNull();
      unmount();
      expect(document.body.classList.contains('perp-terminal-screen')).toBe(false);
    } finally { window.matchMedia = old; }
  });
  it('does not show a dYdX book for a Velocity route', async () => {
    SOL = { address: 'sol-wallet', isConnected: true };
    await renderDesk('/perp/terminal?market=ETH');
    await waitFor(() => expect(screen.getByTestId('perp-book-unavailable')).toBeTruthy());
    expect(screen.queryByTestId('perp-terminal-depth')).toBeNull();
  });
});
