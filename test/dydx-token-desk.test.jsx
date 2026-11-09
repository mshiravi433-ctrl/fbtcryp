// @vitest-environment jsdom
/**
 * dYdX TAB — leverage, order options and the token desk.
 * ===========================================================================
 *   «در فیوجرز تب dydx اهرم و امکانات دیگر را اضافه کن و نمودار ان را شمعی با
 *    هوش مصنوعی کن، برای هر توکن انتخابی، باکس هوش مصنوعی، موتور ریسک و موتور
 *    فرصت را در یک باکس بازشونده زیر ان بزار و از هوش مصنوعی هم بمرس اضافه کن»
 *
 * This file proves what only a rendered tree can:
 *
 *   · the LEVERAGE control is real: the ladder is clipped to the venue's own
 *     cap for this market, and a rung SIZES THE ORDER from the account's real
 *     equity (through the same step-rounding the venue routes use);
 *   · the two order options dYdX actually accepts — post-only and reduce-only
 *     — are settable and reach the signed order with the chosen lifetime;
 *   · the desk is ONE folded box under the chart of the selected token, holds
 *     the three rooms (AI · risk engine · opportunity engine) plus «از هوش
 *     مصنوعی بپرس», and fetches nothing until it is opened;
 *   · the AI question goes out with the market's measured numbers and the
 *     answer comes back labelled with the model that wrote it;
 *   · the Persian bundle renders every new key — no raw key reaches the
 *     screen.
 *
 * Only network clients, the wallet, the chart engine and framer-motion are
 * stubbed. The page, the leverage arithmetic, the desk, the risk engine and
 * the token brain are real.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import fa from '../src/i18n/locales/fa.json';
import en from '../src/i18n/locales/en.json';

const dict = { fa, en };
let LANG = 'fa';
const get = (obj, path) => path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
const tFor = (lang) => (key, opts = {}) => {
  let v = get(dict[lang], key);
  if (v == null) v = get(dict.en, key);
  if (v == null) return opts.defaultValue ?? key;
  return String(v).replace(/\{\{(\w+)\}\}/g, (_, k) => String(opts[k] ?? ''));
};

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: tFor(LANG), i18n: { language: LANG, changeLanguage: () => {} } })
}));

const MOTION_STUBS = new Map();
vi.mock('framer-motion', () => ({
  motion: new Proxy({}, {
    get: (_, tag) => {
      const T = String(tag);
      if (!MOTION_STUBS.has(T)) {
        MOTION_STUBS.set(T, ({ children, ...p }) => {
          const clean = Object.fromEntries(
            Object.entries(p).filter(([k]) => !['initial', 'animate', 'exit', 'transition', 'whileTap', 'whileHover', 'layout', 'layoutId', 'variants'].includes(k))
          );
          return <T {...clean}>{children}</T>;
        });
      }
      return MOTION_STUBS.get(T);
    }
  }),
  AnimatePresence: ({ children }) => <>{children}</>,
  useReducedMotion: () => true
}));

/* ── the wallet ─────────────────────────────────────────────────────────── */
let WALLET = { isConnected: true, address: '0xabc', mode: 'wc' };
vi.mock('../src/context/WalletContext', () => ({
  useWallet: () => WALLET,
  shortAddress: (a) => `${String(a || '').slice(0, 6)}…${String(a || '').slice(-4)}`
}));

vi.mock('../src/context/TelegramContext', () => ({
  useTelegram: () => ({ haptic: () => {}, tg: null })
}));

/* Build-flag gates: both lazy panels are off so the page renders the ticket
   without pulling the history/TP-SL bundles into the test. */
vi.mock('../src/lib/features', () => ({
  DYDX_TPSL_ENABLED: false,
  FUTURES_HISTORY_ENABLED: false,
  SPECULATION_ENABLED: true,
  PERP_TERMINAL_ENABLED: true,
  SPOT_TRADE_ENABLED: true
}));

/* The chart engine is a lazy vendor bundle; the test asserts the DESK under
   it, not lightweight-charts. */
vi.mock('../src/components/FuturesMarketChart', () => ({
  __esModule: true,
  default: ({ market }) => <div data-testid="dydx-chart" data-market={market} />
}));

vi.mock('../src/components/ModernSelect', () => ({
  __esModule: true,
  default: ({ value, onChange, options = [], testId, maxRender }) => (
    <select data-testid={testId} data-max-render={maxRender} value={value} onChange={(e) => onChange(e.target.value)}>
      {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  )
}));

/* ── the dYdX venue ─────────────────────────────────────────────────────── */
const HOUR = 3600_000;
let MARKET_IMF = 0.05;        // 1 / 0.05 → 20× cap
let EQUITY = 1000;
let FREE_COLLATERAL = 1000;
let CANDLES = [];
let CANDLE_LIVE = true;
let BOOK = { live: true, bestBid: 99, bestAsk: 101, spreadBps: 200 };
let BOOK_CALLS = 0;
let CONNECT_CALLS = 0;
let MARKETS_AVAILABLE = true;
let EXTRA_MARKETS = [];
let HISTORY_LIVE = true;
let HISTORY_FILLS = [];
let HISTORY_CALLS = [];
const ORDERS = [];
let AI_ANSWER = { ok: true, text: 'این یک پاسخ آزمایشی است.', provider: 'openrouter', providerName: 'OpenRouter', model: 'test/model' };
const AI_CALLS = [];

const mkCandles = (n = 60) => {
  const out = [];
  const t0 = Date.UTC(2026, 10, 1);
  for (let i = 0; i < n; i += 1) {
    const open = 100 + i * 0.5;
    const close = open + 0.4;
    out.push({
      startedAt: t0 + i * HOUR,
      open: String(open),
      high: String(close + 0.3),
      low: String(open - 0.2),
      close: String(close),
      baseTokenVolume: String(1000 + (i % 7) * 20)
    });
  }
  return out;
};

const marketRow = (base = 'BTC') => ({
  ticker: `${base}-USD`,
  status: 'ACTIVE',
  oraclePrice: 100,
  priceChange24H: 2,
  volume24H: 5000,
  trades24H: 900,
  openInterest: 8000,
  nextFundingRate: 0.0000125,
  nextFundingAt: null,
  initialMarginFraction: MARKET_IMF,
  maintenanceMarginFraction: MARKET_IMF / 2,
  maxLeverage: Math.floor(1 / MARKET_IMF),
  atomicResolution: -6,
  quantumConversionExponent: -9,
  stepBaseQuantums: 1000,
  subticksPerTick: 1000,
  clobPairId: '1',
  raw: { ticker: `${base}-USD`, initialMarginFraction: String(MARKET_IMF) }
});

vi.mock('../src/lib/dydx', async () => {
  const actual = await vi.importActual('../src/lib/dydx');
  return {
    ...actual,
    getDydxMarkets: async () => ({ markets: MARKETS_AVAILABLE ? [marketRow('BTC'), marketRow('ETH'), ...EXTRA_MARKETS] : [], live: MARKETS_AVAILABLE }),
    getDydxSubaccount: async () => ({ account: { subaccount: { equity: String(EQUITY), freeCollateral: FREE_COLLATERAL == null ? null : String(FREE_COLLATERAL) } }, live: true }),
    getDydxOrderbook: async () => { BOOK_CALLS += 1; return BOOK; },
    getDydxFills: async (params) => { HISTORY_CALLS.push(params); return { fills: HISTORY_FILLS, live: HISTORY_LIVE }; },
    getDydxOrders: async () => ({ orders: [{ id: 'order1', reduceOnly: false, type: 'LIMIT' }], live: HISTORY_LIVE }),
    getDydxCandles: async () => ({ candles: CANDLES, live: CANDLE_LIVE, ticker: 'BTC-USD', resolution: '1HOUR' }),
    connectDydx: async () => { CONNECT_CALLS += 1; return { address: 'dydx1testderivedaddress00000000000000000000000' }; },
    disconnectDydx: () => {},
    placeDydxOrder: async (o) => { ORDERS.push(o); return { hash: 'DYDXHASH1', clientId: 1 }; }
  };
});

/* The AI gateway: the desk imports it dynamically on the first question. */
vi.mock('../src/lib/aiGatewayClient.js', () => ({
  executeAiGatewayChat: async (params) => { AI_CALLS.push(params); return AI_ANSWER; },
  getIntelligenceMode: () => 'max'
}));

import Dydx from '../src/pages/Dydx';

/* ─── helpers ─────────────────────────────────────────────────────────────── */

/**
 * Connect the dYdX session first: the account equity is what a leverage rung
 * sizes the order from, so a test that taps a rung before the subaccount has
 * been read is testing the honest "no equity yet" state, not the control.
 */
const connectAccount = async () => {
  const buttons = await screen.findAllByText(fa.dydx.connect);
  fireEvent.click(buttons[0]);
  await waitFor(() => {
    expect(document.body.textContent).not.toContain(fa.dydx.leverage.needEquity);
  });
};

const openDesk = async () => {
  const toggle = await screen.findByTestId('dydx-token-desk-toggle');
  fireEvent.click(toggle);
  return toggle;
};

beforeEach(() => {
  LANG = 'fa';
  MARKET_IMF = 0.05;
  EQUITY = 1000;
  FREE_COLLATERAL = 1000;
  CANDLES = mkCandles();
  CANDLE_LIVE = true;
  BOOK = { live: true, bestBid: 99, bestAsk: 101, spreadBps: 200 };
  BOOK_CALLS = 0;
  CONNECT_CALLS = 0;
  MARKETS_AVAILABLE = true;
  EXTRA_MARKETS = [];
  HISTORY_LIVE = true;
  HISTORY_FILLS = [];
  HISTORY_CALLS = [];
  ORDERS.length = 0;
  AI_CALLS.length = 0;
  AI_ANSWER = { ok: true, text: 'این یک پاسخ آزمایشی است.', provider: 'openrouter', providerName: 'OpenRouter', model: 'test/model' };
  WALLET = { isConnected: true, address: '0xabc', mode: 'wc' };
});

afterEach(() => cleanup());

/* ─── the tests ───────────────────────────────────────────────────────────── */

describe('dYdX tab — leverage', () => {
  it('offers the ladder clipped to this market’s own cap', async () => {
    render(<Dydx embedded />);
    /* imf 0.05 → 20× cap: every rung including 20 is offered. */
    expect(await screen.findByTestId('dydx-leverage-20')).toBeTruthy();
    expect(screen.getByTestId('dydx-leverage-10')).toBeTruthy();
    cleanup();

    /* imf 0.2 → 5× cap: a 20× button would be an order the venue rejects. */
    MARKET_IMF = 0.2;
    render(<Dydx embedded />);
    await screen.findByTestId('dydx-leverage-5');
    expect(screen.queryByTestId('dydx-leverage-20')).toBeNull();
    expect(screen.queryByTestId('dydx-leverage-10')).toBeNull();
  });

  it('sizes the order from the account equity when a rung is tapped', async () => {
    render(<Dydx embedded />);
    await screen.findByTestId('dydx-leverage-5');
    await connectAccount();
    const sizeInput = document.querySelector('input[type="number"]');
    expect(sizeInput).toBeTruthy();
    fireEvent.click(screen.getByTestId('dydx-leverage-5'));
    /* equity 1000 × 5 ÷ price 100 = 50, rounded to the market's own step. */
    await waitFor(() => expect(sizeInput.value).toBe('50'));
  });

  it('does not size from equity when free collateral is zero', async () => {
    FREE_COLLATERAL = 0;
    render(<Dydx embedded />);
    await screen.findByTestId('dydx-leverage-5');
    fireEvent.click((await screen.findAllByText(fa.dydx.connect))[0]);
    await waitFor(() => expect(screen.getByTestId('dydx-account').textContent).toContain('dydx1'));
    const input = document.querySelector('input[type="number"]');
    fireEvent.change(input, { target: { value: '1' } });
    fireEvent.click(screen.getByTestId('dydx-leverage-5'));
    expect(input.value).toBe('1');
  });

  it('reports the leverage the order actually has, not the rung that was tapped', async () => {
    render(<Dydx embedded />);
    await screen.findByTestId('dydx-leverage-5');
    await connectAccount();
    fireEvent.click(screen.getByTestId('dydx-leverage-5'));
    await waitFor(() => {
      const rows = Array.from(document.querySelectorAll('.row-between'));
      const row = rows.find((r) => r.textContent.includes(fa.dydx.leverage.effective));
      expect(row).toBeTruthy();
      expect(row.textContent).toContain('5.00×');
    });
  });
});

describe('dYdX tab — the order options the venue accepts', () => {
  it('sends post-only, reduce-only and the chosen lifetime with the order', async () => {
    render(<Dydx embedded />);
    await screen.findByTestId('dydx-leverage-5');
    await connectAccount();

    /* limit → the lifetime row and the post-only switch appear */
    const limitBtn = screen.getByText(fa.dydx.order.limit);
    fireEvent.click(limitBtn);
    const priceInputs = Array.from(document.querySelectorAll('input[type="number"]'));
    const limitInput = priceInputs[0];
    fireEvent.change(limitInput, { target: { value: '101' } });

    fireEvent.click(screen.getByTestId('dydx-post-only'));
    fireEvent.click(screen.getByTestId('dydx-reduce-only'));
    fireEvent.click(screen.getByTestId('dydx-goodtil-7d'));
    fireEvent.click(screen.getByTestId('dydx-leverage-2'));

    /* review → confirm signs the order */
    fireEvent.click(await screen.findByText(fa.dydx.review));
    fireEvent.click(await screen.findByText(fa.common.confirm));

    await waitFor(() => expect(ORDERS.length).toBe(1));
    expect(ORDERS[0].postOnly).toBe(true);
    expect(ORDERS[0].reduceOnly).toBe(true);
    expect(ORDERS[0].goodTilSeconds).toBe(604800);
    expect(ORDERS[0].orderType).toBe('limit');
  });

  it('does not submit an order for a different market than the reviewed market', async () => {
    render(<Dydx embedded />);
    await screen.findByTestId('dydx-leverage-2');
    await connectAccount();
    fireEvent.click(screen.getByTestId('dydx-leverage-2'));
    fireEvent.click(await screen.findByText(fa.dydx.review));
    const confirm = await screen.findByText(fa.common.confirm);
    expect(confirm.disabled).toBe(false);
    fireEvent.change(screen.getByTestId('dydx-market-select'), { target: { value: 'ETH-USD' } });
    expect(confirm.disabled).toBe(true);
    fireEvent.click(confirm);
    expect(ORDERS).toHaveLength(0);
  });

  it('shows the same flags on the review sheet before they are signed', async () => {
    render(<Dydx embedded />);
    await screen.findByTestId('dydx-leverage-2');
    await connectAccount();
    /* A review sheet only opens for an order that exists: the rung sizes it
       from the equity; without it the button is correctly disabled. */
    fireEvent.click(screen.getByTestId('dydx-leverage-2'));
    fireEvent.click(screen.getByTestId('dydx-reduce-only'));
    fireEvent.click(await screen.findByText(fa.dydx.review));
    await waitFor(() => {
      const rows = Array.from(document.querySelectorAll('.row-between'));
      const row = rows.find((r) => r.textContent.includes(fa.dydx.order.options));
      expect(row).toBeTruthy();
      expect(row.textContent).toContain(fa.dydx.order.reduceOnly);
    });
  });
});

describe('dYdX tab — the token desk', () => {
  it('is folded until it is asked for, and reads nothing until then', async () => {
    render(<Dydx embedded />);
    const box = await screen.findByTestId('dydx-token-desk');
    const toggle = screen.getByTestId('dydx-token-desk-toggle');
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    /* Folded: no room, no question box, and no candle request has been made. */
    expect(screen.queryByTestId('dydx-desk-ai')).toBeNull();
    expect(box.textContent).toContain(fa.dydx.desk.title.replace('{{ticker}}', 'BTC'));

    await openDesk();
    expect(await screen.findByTestId('dydx-desk-ai')).toBeTruthy();
    expect(screen.getByTestId('dydx-desk-ask')).toBeTruthy();
  });

  it('places the desk above the connection card and offers early watch', async () => {
    render(<Dydx embedded />);
    const desk = await screen.findByTestId('dydx-token-desk');
    expect(desk.compareDocumentPosition(screen.getByTestId('dydx-account')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    await openDesk();
    fireEvent.click(screen.getByTestId('dydx-token-desk-tab-early'));
    expect(screen.getByTestId('dydx-desk-early').textContent).toContain(fa.dydx.desk.early.unavailable);
  });

  it('shows dYdX-only history in the desk and clears it on disconnect', async () => {
    HISTORY_FILLS = [{ id: 'fill1', createdAt: new Date().toISOString(), size: '1', price: '123', fee: '0.1', side: 'BUY', orderId: 'order1', market: 'BTC-USD' }];
    render(<Dydx embedded />);
    await openDesk();
    fireEvent.click(screen.getByTestId('dydx-token-desk-tab-history'));
    expect(await screen.findByText(fa.futures.history.notConnected)).toBeTruthy();
    expect(HISTORY_CALLS).toHaveLength(0);
    await connectAccount();
    await waitFor(() => expect(HISTORY_CALLS.length).toBe(1));
    expect(HISTORY_CALLS[0].address).toBe('dydx1testderivedaddress00000000000000000000000');
    expect(await screen.findByText('$123')).toBeTruthy();
    expect(screen.queryByText(fa.futures.history.venue.ostium)).toBeNull();
    expect(document.getElementById('dydx-history-box')).toBeNull();
    fireEvent.click(screen.getByTestId('dydx-history-refresh'));
    await waitFor(() => expect(HISTORY_CALLS.length).toBe(2));
    fireEvent.click(screen.getByText(fa.wallet.disconnect));
    expect(await screen.findByText(fa.futures.history.notConnected)).toBeTruthy();
    expect(screen.queryByText('$123')).toBeNull();
  });

  it('distinguishes an unavailable history feed from an empty history', async () => {
    HISTORY_LIVE = false;
    render(<Dydx embedded />);
    await connectAccount();
    await openDesk();
    fireEvent.click(screen.getByTestId('dydx-token-desk-tab-history'));
    expect(await screen.findByText(fa.futures.history.emptyUnavailable)).toBeTruthy();
  });

  it('shows a fresh completed-candle watch with real evidence', async () => {
    const hour = 3600_000;
    const end = Math.floor(Date.now() / hour) * hour;
    CANDLES = Array.from({ length: 40 }, (_, i) => ({ startedAt: end - (40 - i) * hour, open: 100, high: 102, low: 98, close: i === 39 ? 101 : 100 }));
    render(<Dydx embedded />);
    await openDesk();
    fireEvent.click(screen.getByTestId('dydx-token-desk-tab-early'));
    await waitFor(() => expect(screen.getByTestId('dydx-desk-early').textContent).toContain(fa.dydx.desk.early.watch));
    expect(screen.getByTestId('dydx-desk-early').textContent).toContain('102');
    expect(screen.getByTestId('dydx-desk-early').textContent).toContain(fa.dydx.desk.early.closedAt);
  });

  it('labels a degraded internal answer', async () => {
    AI_ANSWER = { ok: true, text: 'Fallback', provider: 'internal', degraded: true, notice: { fa: 'موتور داخلی' } };
    render(<Dydx embedded />);
    await openDesk();
    fireEvent.click(screen.getByTestId('dydx-token-desk-tab-ask'));
    fireEvent.click(screen.getByTestId('dydx-desk-ask-quick-risk'));
    expect((await screen.findByTestId('dydx-desk-answer')).textContent).toContain('موتور داخلی');
  });

  it('holds the three rooms and the AI question box, all i18n-rendered', async () => {
    render(<Dydx embedded />);
    await openDesk();
    await screen.findByTestId('dydx-desk-ai');

    expect(screen.getByTestId('dydx-token-desk-tab-ai').textContent).toContain(fa.dydx.desk.tabs.ai);
    expect(screen.getByTestId('dydx-token-desk-tab-risk').textContent).toContain(fa.dydx.desk.tabs.risk);
    expect(screen.getByTestId('dydx-token-desk-tab-opp').textContent).toContain(fa.dydx.desk.tabs.opp);
    expect(screen.getByTestId('dydx-token-desk-tab-ask').textContent).toContain(fa.dydx.desk.tabs.ask);
    expect(screen.getByTestId('dydx-desk-ask').parentElement.hidden).toBe(true);

    /* Room 1 — the read, with its verdict translated, not a raw key. */
    expect(screen.getByTestId('dydx-desk-ai').textContent).not.toContain('dydx.desk.ai.read.');

    /* Room 2 — the risk engine, mounted on the ticket. */
    fireEvent.click(screen.getByTestId('dydx-token-desk-tab-risk'));
    expect(await screen.findByTestId('dydx-desk-ai-risk')).toBeTruthy();

    /* Room 3 — the opportunity engine, over this token's own candles. */
    fireEvent.click(screen.getByTestId('dydx-token-desk-tab-opp'));
    const opp = await screen.findByTestId('dydx-desk-opp');
    expect(opp.textContent).toContain(fa.dydx.desk.opp.caveat.notASignal);
  });

  it('reads the book only when open, and refreshes both data sources', async () => {
    render(<Dydx embedded />);
    await screen.findByTestId('dydx-token-desk');
    expect(BOOK_CALLS).toBe(0);
    await openDesk();
    const panel = await screen.findByTestId('dydx-desk-market-data');
    await waitFor(() => expect(panel.textContent).toContain('200.00 bps'));
    expect(panel.textContent).toContain('99');
    expect(screen.getByTestId('dydx-token-desk-refresh').getAttribute('aria-label')).toBe(fa.dydx.desk.refresh);
    fireEvent.click(screen.getByTestId('dydx-token-desk-refresh'));
    await waitFor(() => expect(BOOK_CALLS).toBe(2));
  });

  it('does not show fake order-book numbers when the feed fails', async () => {
    BOOK = { live: false };
    render(<Dydx embedded />);
    await openDesk();
    const panel = await screen.findByTestId('dydx-desk-market-data');
    await waitFor(() => expect(BOOK_CALLS).toBe(1));
    expect(panel.textContent).toContain(fa.dydx.offline);
    expect(panel.textContent).not.toContain('bps');
  });

  it('says so when the indexer sent no candles instead of inventing a read', async () => {
    CANDLES = [];
    CANDLE_LIVE = false;
    render(<Dydx embedded />);
    await openDesk();
    const unavailable = await screen.findByTestId('dydx-token-desk-unavailable');
    expect(unavailable.textContent).toContain(fa.dydx.desk.unavailable.NO_CANDLES);
    expect(screen.queryByTestId('dydx-desk-ai')).toBeNull();
  });

  it('asks the AI with the market’s numbers and prints the model that answered', async () => {
    render(<Dydx embedded />);
    await openDesk();
    await screen.findByTestId('dydx-desk-ai');

    fireEvent.click(screen.getByTestId('dydx-token-desk-tab-ask'));
    fireEvent.click(screen.getByTestId('dydx-desk-ask-quick-risk'));
    await waitFor(() => expect(AI_CALLS.length).toBe(1));
    const [call] = AI_CALLS;
    expect(call.taskType).toBe('fast');
    expect(call.intelligence).toBe('swift');
    expect(String(call.user)).toContain(fa.dydx.desk.ask.quick.risk);
    expect(String(call.user)).toContain('BTC-USD');
    expect(call.user).toContain('Market facts:\nmarket: BTC-USD');
    expect(String(call.system)).toMatch(/Persian|فارسی/);
    expect(call.user).toContain('spread 200.00 bps');
    expect(call.user).toContain('WIDE_SPREAD');
    expect(call.user).toContain('setups and evidence:');

    const answer = await screen.findByTestId('dydx-desk-answer');
    expect(answer.textContent).toContain('این یک پاسخ آزمایشی است.');
    expect(answer.textContent).toContain('OpenRouter');
  });

  it('reports an unanswered question honestly rather than as a blank box', async () => {
    AI_ANSWER = { ok: false, error: 'TIMEOUT' };
    render(<Dydx embedded />);
    await openDesk();
    await screen.findByTestId('dydx-desk-ai');
    fireEvent.click(screen.getByTestId('dydx-token-desk-tab-ask'));
    fireEvent.click(screen.getByTestId('dydx-desk-ask-quick-why'));
    const err = await screen.findByTestId('dydx-desk-ask-error');
    expect(err.textContent).toContain(fa.dydx.desk.ask.err.TIMEOUT);
  });
});

describe('dYdX tab — the chart', () => {
  /*
   * «نمودار آن را شمعی با هوش مصنوعی کن»
   * The candlestick engine and its on-device AI projection live in
   * FuturesMarketChart (lightweight-charts + Kronos), which this suite stubs
   * out — so the wiring is pinned from source instead: the tab must mount the
   * candlestick chart for the selected market, and that chart must carry its
   * own AI forecast control. A test that could not fail is not a test, so
   * both assertions are on strings that exist only if the wiring is real.
   */
  it('mounts the candlestick chart with its AI forecast control', () => {
    const page = readFileSync(resolve(process.cwd(), 'src/pages/Dydx.jsx'), 'utf8');
    const chart = readFileSync(resolve(process.cwd(), 'src/components/FuturesMarketChart.jsx'), 'utf8');
    expect(page).toMatch(/FuturesMarketChart/);
    expect(page).toMatch(/provider="dydx"/);
    expect(page).toMatch(/market=\{ticker\}/);
    expect(chart).toContain('data-testid="futures-chart-ai"');
    expect(chart).toMatch(/TradingChart/);
  });
});

describe('dYdX tab — copy', () => {
  it('renders every new key in Persian with no raw key on screen', async () => {
    render(<Dydx embedded />);
    await openDesk();
    await screen.findByTestId('dydx-desk-ai');
    const body = document.body.textContent || '';
    for (const key of ['dydx.leverage.', 'dydx.order.goodTilOptions.', 'dydx.desk.tabs.', 'dydx.desk.ask.']) {
      expect(body).not.toContain(key);
    }
  });
});


describe('dYdX market catalogue', () => {
  it('offers every active market, including beyond 300, but never settled markets', async () => {
    EXTRA_MARKETS = Array.from({ length: 320 }, (_, i) => marketRow(`T${i}`));
    EXTRA_MARKETS.push({ ...marketRow('CLOSED'), status: 'FINAL_SETTLEMENT' });
    render(<Dydx embedded />);
    const select = await screen.findByTestId('dydx-market-select');
    expect(select.options).toHaveLength(322);
    expect(select.getAttribute('data-max-render')).toBe('322');
    expect(select.querySelector('option[value="T319-USD"]')).toBeTruthy();
    expect(select.querySelector('option[value="CLOSED-USD"]')).toBeNull();
    expect(screen.getByTestId('dydx-market-count').textContent).toContain('322');
    expect(screen.getByTestId('dydx-market-count').textContent).toContain('323');
  });
});

describe('dYdX mobile trading dock', () => {
  const originalMatchMedia = window.matchMedia;
  beforeEach(() => {
    window.matchMedia = vi.fn().mockImplementation((query) => ({ matches: query.includes('767'), media: query, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
  });
  afterEach(() => { window.matchMedia = originalMatchMedia; });

  it('always shows long and short without connecting or submitting an order', async () => {
    render(<Dydx embedded />);
    await screen.findByTestId('dydx-mobile-dock');
    expect(document.body.classList.contains('dydx-screen')).toBe(true);
    expect(screen.queryByTestId('dydx-mobile-connect')).toBeNull();
    expect(screen.getByTestId('dydx-mobile-long').getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(screen.getByTestId('dydx-mobile-short'));
    expect(screen.getByTestId('dydx-mobile-short').getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByTestId('dydx-selected-side').textContent).toContain(fa.dydx.sell);
    expect(document.querySelector('.dydx-order-column .dir-switch')).toBeNull();
    expect(CONNECT_CALLS).toBe(0);
    expect(ORDERS).toHaveLength(0);
    cleanup();
    expect(document.body.classList.contains('dydx-screen')).toBe(false);
  });

  it('opens the full-screen desk and supports switching tabs and closing', async () => {
    render(<Dydx embedded />);
    await screen.findByTestId('dydx-mobile-dock');
    fireEvent.click(screen.getByTestId('dydx-mobile-desk-open'));
    const sheet = await screen.findByTestId('dydx-mobile-desk-sheet');
    expect(sheet.getAttribute('aria-modal')).toBe('true');
    expect(sheet.parentElement.classList.contains('dydx-desk-layer')).toBe(true);
    expect(sheet.getAttribute('aria-label')).toContain('BTC');
    expect(screen.getByTestId('dydx-mobile-desk-token-logo')).toBeTruthy();
    expect(screen.getByTestId('dydx-mobile-desk-snapshot').textContent).toContain('20×');
    expect(screen.getByTestId('dydx-mobile-desk').classList.contains('card')).toBe(false);
    const first = screen.getByTestId('dydx-mobile-desk-tab-ai');
    first.focus();
    fireEvent.keyDown(first, { key: 'End' });
    expect(screen.getByTestId('dydx-mobile-desk-tab-history').getAttribute('aria-selected')).toBe('true');
    expect(document.activeElement).toBe(screen.getByTestId('dydx-mobile-desk-tab-history'));
    fireEvent.click(screen.getByTestId('dydx-mobile-desk-tab-ask'));
    expect(screen.getByTestId('dydx-desk-ask').parentElement.hidden).toBe(false);
    fireEvent.click(screen.getByTestId('dydx-mobile-desk-sheet-close'));
    await waitFor(() => expect(screen.queryByTestId('dydx-mobile-desk-sheet')).toBeNull());
    expect(screen.getByTestId('dydx-mobile-dock')).toBeTruthy();
  });

  it('updates the selected token artwork and falls back safely when unavailable', async () => {
    EXTRA_MARKETS = [marketRow('UNKNOWNCOIN')];
    render(<Dydx embedded />);
    await screen.findByTestId('dydx-market-select');
    fireEvent.click(screen.getByTestId('dydx-mobile-desk-open'));
    let logo = await screen.findByTestId('dydx-mobile-desk-token-logo');
    expect(logo.getAttribute('data-symbol')).toBe('BTC');
    expect(logo.querySelector('svg')).toBeTruthy();
    fireEvent.click(screen.getByTestId('dydx-mobile-desk-sheet-close'));
    fireEvent.change(screen.getByTestId('dydx-market-select'), { target: { value: 'ETH-USD' } });
    fireEvent.click(screen.getByTestId('dydx-mobile-desk-open'));
    logo = await screen.findByTestId('dydx-mobile-desk-token-logo');
    expect(logo.getAttribute('data-symbol')).toBe('ETH');
    expect(logo.querySelector('svg')).toBeTruthy();
    fireEvent.click(screen.getByTestId('dydx-mobile-desk-sheet-close'));
    fireEvent.change(screen.getByTestId('dydx-market-select'), { target: { value: 'UNKNOWNCOIN-USD' } });
    fireEvent.click(screen.getByTestId('dydx-mobile-desk-open'));
    logo = await screen.findByTestId('dydx-mobile-desk-token-logo');
    expect(logo.getAttribute('data-symbol')).toBe('UNKNOWNCOIN');
    expect(logo.querySelector('.dtd-token-fallback').textContent).toBe('UNK');
  });

  it('keeps workflow accessible and marks slippage and leverage selections', async () => {
    render(<Dydx embedded />);
    await screen.findByTestId('dydx-leverage-2');
    const steps = screen.getByRole('button', { name: fa.dydx.steps.title });
    expect(steps.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(steps);
    expect(steps.getAttribute('aria-expanded')).toBe('true');
    expect(document.querySelectorAll('.dydx-workflow-list li')).toHaveLength(5);
    const slip = screen.getByRole('button', { name: '0.5%' });
    fireEvent.click(slip);
    expect(slip.getAttribute('aria-pressed')).toBe('true');
    const lever = screen.getByTestId('dydx-leverage-2');
    fireEvent.click(lever);
    expect(lever.getAttribute('aria-pressed')).toBe('true');
  });

  it('keeps the dock on screen if markets are unavailable, without inventing a desk', async () => {
    MARKETS_AVAILABLE = false;
    render(<Dydx embedded />);
    await screen.findByText(fa.dydx.marketUnavailable);
    expect(screen.getByTestId('dydx-mobile-desk-open').disabled).toBe(true);
    fireEvent.click(screen.getByTestId('dydx-mobile-short'));
    expect(screen.getByTestId('dydx-mobile-short').getAttribute('aria-pressed')).toBe('true');
    expect(CONNECT_CALLS).toBe(0);
  });

  it('scopes full-screen and global navigation replacement to the mobile dYdX screen', () => {
    const css = readFileSync(resolve(process.cwd(), 'src/styles/dydx-token-desk.css'), 'utf8');
    expect(css).toContain('body.dydx-screen .bottom-nav');
    expect(css).toContain('body.dydx-screen .nav-centre');
    expect(css).toContain('.dydx-desk-layer .dydx-desk-sheet');
    expect(css).toContain('height: 100dvh');
  });
});
