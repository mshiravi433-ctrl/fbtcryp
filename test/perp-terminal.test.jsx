// @vitest-environment jsdom
/**
 * PERPETUAL OVERVIEW — the pair-trading terminal render probe.
 *
 * The wiring audit pins the SOURCES (tabs, referral links, honesty flags).
 * This file proves what only a rendered tree can: that the redesigned
 * overview really is a trading terminal, that every number it shows comes
 * from a real feed or renders as an honest placeholder, and that the
 * confirm button can never hand an order to a route that earns nothing.
 *
 *   • the pair strip: 12 pairs, live price + 24h change + sparkline, and the
 *     honest "unavailable" text on offline rows — never a snapshot price;
 *   • the ticket: long/short switch, stablecoin collateral, the 2/5/10/20/50
 *     chips, notional = collateral × leverage, and the liquidation preview
 *     from the shared pure engine;
 *   • the fee box: protocol / network / FBT rows from the backend preview,
 *     with placeholders when the backend does not answer;
 *   • the final button: «اتصال کیف پول» when no wallet, the review sheet when
 *     one is connected, and the two earning routes — the in-app venue tab
 *     with the ticket prefilled, or Avantis carrying the registered
 *     `fbtswap` referral code;
 *   • i18n: the Persian bundle renders every new key, no raw keys on screen.
 *
 * Only framework plumbing and network clients are stubbed (i18n, wallet,
 * framer-motion, the futures BFF client and the chart engine). The page,
 * the ticket arithmetic, the referral library and the risk engine are real.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, fireEvent, act } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';
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
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: tFor(LANG), i18n: { language: LANG, changeLanguage: () => {} } }) }));

/* Real framer-motion exports a STABLE component per tag; a fresh function
   per access would change the element type every render and remount the
   subtree (state lives, but the DOM nodes — and the test's captured refs —
   are thrown away). Cache one stub per tag. */
const MOTION_STUBS = new Map();
vi.mock('framer-motion', () => ({
  motion: new Proxy({}, {
    get: (_, tag) => {
      const T = String(tag);
      if (!MOTION_STUBS.has(T)) {
        MOTION_STUBS.set(T, ({ children, ...p }) => {
          const clean = Object.fromEntries(Object.entries(p).filter(([k]) => !['initial', 'animate', 'exit', 'transition', 'whileTap', 'whileHover', 'layout', 'layoutId', 'variants'].includes(k)));
          return <T {...clean}>{children}</T>;
        });
      }
      return MOTION_STUBS.get(T);
    }
  }),
  AnimatePresence: ({ children }) => <>{children}</>,
  useReducedMotion: () => true
}));

/* ── the wallet: a mutable fixture, because the button depends on it ────── */
let WALLET = { isConnected: false, address: null };
vi.mock('../src/context/WalletContext', () => ({
  useWallet: () => WALLET,
  shortAddress: (a) => `${String(a || '').slice(0, 6)}…${String(a || '').slice(-4)}`
}));

/* ── the opened outbound links, so the referral route can be asserted ───── */
const OPENED = [];
vi.mock('../src/context/TelegramContext', () => ({
  useTelegram: () => ({
    haptic: () => {},
    tg: { openLink: (u) => OPENED.push(u) }
  })
}));

/* ── the market feed: 12 pairs, every row live unless a test says offline ── */
const PAIR_IDS = {
  BTC: 'bitcoin', ETH: 'ethereum', SOL: 'solana', BNB: 'binancecoin',
  XRP: 'ripple', DOGE: 'dogecoin', AVAX: 'avalanche-2', LINK: 'chainlink',
  NEAR: 'near', PEPE: 'pepe', SUI: 'sui', APT: 'aptos'
};
let FEED = { loading: false, coins: [], offline: false };
const mkCoins = () => Object.entries(PAIR_IDS).map(([symbol, id], i) => ({
  id,
  symbol,
  name: symbol,
  image: `https://img.example/${symbol}.png`,
  price: 100 + i * 7,
  change24h: i % 2 ? 2.5 : -1.25,
  high24h: 120 + i * 7,
  low24h: 80 + i * 7,
  sparkline: Array.from({ length: 24 }, (_, k) => 100 + i * 7 + k),
  offline: FEED.offline,
  dataProvenance: FEED.offline ? 'offline' : 'live'
}));
vi.mock('../src/hooks/useMarket', () => ({
  useMarkets: () => ({ data: FEED.loading ? null : mkCoins(), loading: FEED.loading })
}));

/* ── the futures BFF client: markets, candles and the fee preview ───────── */
const FEE_FOR_CALLS = [];
let VENUE_MARKETS = [
  { marketId: '1', base: 'BTC', symbol: 'BTC/USDT', mid: 60123 },
  { marketId: '2', base: 'ETH', symbol: 'ETH/USDT', mid: 3010 },
  { marketId: '0', base: 'SOL', symbol: 'SOL/USDT', mid: 150 }
];
let FEE_ANSWER = {
  ok: true,
  data: {
    fee: {
      notionalUsd: 500,
      protocol: { bps: 5, flatUsd: 0, feeUsd: 0.25, known: true },
      network: { feeUsd: null, known: false },
      fbt: { bps: 7, feeUsd: 0.35, recipient: '0xaf5CE154cEfd22Da5BD1D0a54479E81963A224d6' },
      totalFeeUsd: null,
      complete: false
    }
  }
};
vi.mock('../src/lib/futuresClient', () => ({
  getFuturesMarkets: async () => ({ ok: true, data: { markets: VENUE_MARKETS } }),
  getFuturesCandles: async () => ({ ok: false }),
  getFuturesFeePreview: async (q) => { FEE_FOR_CALLS.push(q); return FEE_ANSWER; }
}));

/* The chart engine is lazy and canvas-bound; the terminal's contract with it
   is only "mount it for the selected venue market with these props". */
vi.mock('../src/components/FuturesMarketChart', () => ({
  default: (p) => <div data-testid={p.testId} data-provider={p.provider} data-market={String(p.market)}>{p.symbol}</div>
}));

/* The two lazy venue tabs: real pages, but this probe tests the OVERVIEW and
   the hand-off URL — not their internals. */
vi.mock('../src/pages/Dydx', () => ({ default: () => <div data-testid="stub-dydx" /> }));
vi.mock('../src/pages/FuturesOnchain', () => ({ default: () => <div data-testid="stub-onchain" /> }));

/* FundingPanel's own network client — it has its own honest states. */
vi.mock('../src/lib/perp', () => ({
  getPerpMarkets: async () => { throw new Error('feed down'); },
  bestVenue: () => null,
  fundingCost: () => null
}));

import Perp from '../src/pages/Perp.jsx';

/* Where the confirm button navigated, without touching window.location. */
const LocationProbe = () => {
  const loc = useLocation();
  return <div data-testid="loc-probe">{loc.pathname}?{loc.search}</div>;
};

const mount = () => render(
  <MemoryRouter initialEntries={['/perp']}>
    <LocationProbe />
    <Routes>
      <Route path="/perp" element={<Perp />} />
    </Routes>
  </MemoryRouter>
);

beforeEach(() => {
  LANG = 'fa';
  WALLET = { isConnected: false, address: null };
  FEED = { loading: false, coins: [], offline: false };
  VENUE_MARKETS = [
    { marketId: '1', base: 'BTC', symbol: 'BTC/USDT', mid: 60123 },
    { marketId: '2', base: 'ETH', symbol: 'ETH/USDT', mid: 3010 },
    { marketId: '0', base: 'SOL', symbol: 'SOL/USDT', mid: 150 }
  ];
  FEE_ANSWER = {
    ok: true,
    data: {
      fee: {
        notionalUsd: 500,
        protocol: { bps: 5, flatUsd: 0, feeUsd: 0.25, known: true },
        network: { feeUsd: null, known: false },
        fbt: { bps: 7, feeUsd: 0.35, recipient: '0xaf5CE154cEfd22Da5BD1D0a54479E81963A224d6' },
        totalFeeUsd: null,
        complete: false
      }
    }
  };
  FEE_FOR_CALLS.length = 0;
  OPENED.length = 0;
});

/* vitest runs without globals here, so RTL's auto-cleanup never registers. */
afterEach(() => cleanup());

describe('the perpetual overview terminal', () => {
  it('renders all twelve pairs with a live price, a change and a sparkline', async () => {
    mount();
    const strip = await screen.findByTestId('perp-pair-strip');
    const pairs = screen.getAllByRole('tab').filter((el) => /-PERP/.test(el.textContent) && el.closest('.perp-pairs'));
    expect(pairs.length).toBe(12);
    expect(strip.textContent).toContain('BTC-PERP');
    expect(strip.textContent).toContain('APT-PERP');
    /* a live row shows its dollar price and its 24h change */
    expect(strip.textContent).toContain('$1');
    expect(strip.querySelectorAll('.perp-pair-spark svg').length).toBe(12);
    expect(screen.queryByText('داده بازار موقتاً در دسترس نیست')).toBeNull();
  });

  it('shows the honest unavailable sentence for offline rows, never a snapshot price', async () => {
    FEED.offline = true;
    mount();
    const strip = await screen.findByTestId('perp-pair-strip');
    await waitFor(() => expect(strip.querySelectorAll('.perp-pair-nodata').length).toBe(12));
    /* the offline snapshot price must not leak into a live-price slot */
    expect(strip.querySelectorAll('.perp-pair-price').length).toBe(0);
    expect(screen.getByTestId('perp-index-unavailable')).toBeTruthy();
    expect(screen.getByText('داده بازار موقتاً در دسترس نیست. در صفحه اهرم هیچ قیمت ذخیره‌شده‌ای نمایش داده نمی‌شود.')).toBeTruthy();
  });

  it('mounts the shared candle chart for a venue pair and the honest note for the rest', async () => {
    mount();
    await waitFor(() => expect(screen.getByTestId('perp-terminal-chart')).toBeTruthy());
    expect(screen.getByTestId('perp-terminal-chart').dataset.provider).toBe('drift');
    expect(screen.getByTestId('perp-terminal-chart').dataset.market).toBe('1');
    /* switch to a pair the venue does not list */
    fireEvent.click(screen.getAllByRole('tab').find((el) => /PEPE-PERP/.test(el.textContent)));
    await waitFor(() => expect(screen.getByTestId('perp-chart-unavailable')).toBeTruthy());
    expect(screen.queryByTestId('perp-terminal-chart')).toBeNull();
  });

  it('computes notional and the liquidation preview live from the ticket inputs', async () => {
    mount();
    await screen.findByTestId('perp-ticket');
    const summary = screen.getByTestId('perp-summary');
    /* default: 100 × 5 = 500, liquidation at the full-collateral bound = 20% */
    expect(summary.textContent).toContain('$500');
    expect(summary.textContent).toContain('−20.00%');
    /* 10× leverage halves the distance */
    fireEvent.click(screen.getAllByRole('button').find((b) => b.textContent.trim() === '10×'));
    await waitFor(() => expect(screen.getByTestId('perp-summary').textContent).toContain('−10.00%'));
    expect(screen.getByTestId('perp-summary').textContent).toContain('$1,000');
    /* the chips are exactly the requested presets */
    for (const n of ['2×', '5×', '10×', '20×', '50×']) {
      expect(screen.getAllByRole('button').some((b) => b.textContent.trim() === n)).toBe(true);
    }
    /* the direction switch flips which side the liquidation price sits on:
       a 10× short entered at $100 liquidates at $110, above the entry */
    fireEvent.click(screen.getAllByRole('button').find((b) => /شورت/.test(b.textContent)));
    await waitFor(() => expect(screen.getByTestId('perp-summary').textContent).toContain('$110'));
    /* stablecoin choice */
    expect(screen.getAllByRole('button').some((b) => b.textContent === 'USDC')).toBe(true);
    expect(screen.getAllByRole('button').some((b) => b.textContent === 'USDT')).toBe(true);
  });

  it('shows the backend fee breakdown with honest placeholders, and who the share goes to', async () => {
    mount();
    const fees = await screen.findByTestId('perp-fee-breakdown');
    await waitFor(() => expect(FEE_FOR_CALLS.length).toBeGreaterThan(0));
    expect(FEE_FOR_CALLS[0].market).toBe('1');
    expect(fees.textContent).toContain('کارمزد پروتکل');
    await waitFor(() => expect(fees.textContent).toContain('$0.25'));
    expect(fees.textContent).toContain('0.35');
    expect(fees.textContent).toContain('7 bps');
    /* the network fee is unknown → the placeholder sentence, not a zero */
    expect(fees.textContent).toContain('برآورد در مرحلهٔ تأیید');
    /* the treasury line names the recipient */
    expect(fees.textContent).toContain('0xaf5C…24d6');
  });

  it('offers connect-wallet when no wallet is connected, and the review flow when one is', async () => {
    mount();
    await screen.findByTestId('perp-ticket');
    expect(screen.getByTestId('perp-connect').textContent).toContain('اتصال کیف پول');
    expect(screen.queryByTestId('perp-submit')).toBeNull();

    cleanup();
    WALLET = { isConnected: true, address: '0x1111111111111111111111111111111111111111' };
    mount();
    expect(screen.getByTestId('perp-submit').textContent).toContain('بازبینی و تأیید معامله');
    expect(screen.getByTestId('perp-wallet-row').textContent).toContain('0x1111…1111');
    fireEvent.click(screen.getByTestId('perp-submit'));
    const review = await screen.findByTestId('perp-review');
    expect(review.textContent).toContain('BTC-PERP');
    expect(review.textContent).toContain('لانگ / صعودی');
    expect(review.textContent).toContain('$100 USDC');
    expect(review.textContent).toContain('$500');
  });

  it('confirms an in-app pair by handing the exact ticket to the venue tab', async () => {
    WALLET = { isConnected: true, address: '0x1111111111111111111111111111111111111111' };
    mount();
    await screen.findByTestId('perp-ticket');
    fireEvent.click(screen.getByTestId('perp-submit'));
    await screen.findByTestId('perp-review');
    fireEvent.click(screen.getByTestId('perp-review-confirm'));
    await waitFor(() => {
      const probe = screen.getByTestId('loc-probe').textContent;
      expect(probe).toContain('tab=onchain');
      expect(probe).toContain('market=BTC-PERP');
      expect(probe).toContain('side=long');
      expect(probe).toContain('collateral=100');
      expect(probe).toContain('leverage=5');
    });
    await waitFor(() => expect(screen.getByTestId('stub-onchain')).toBeTruthy());
    expect(OPENED.length).toBe(0);
  });

  it('confirms a venue-only pair through the registered Avantis referral code', async () => {
    WALLET = { isConnected: true, address: '0x1111111111111111111111111111111111111111' };
    mount();
    await screen.findByTestId('perp-ticket');
    fireEvent.click(screen.getAllByRole('tab').find((el) => /PEPE-PERP/.test(el.textContent)));
    await waitFor(() => expect(screen.getByTestId('perp-chart-unavailable')).toBeTruthy());
    /* the fee card names the referral arrangement for this route */
    expect(screen.getByTestId('perp-fee-breakdown').textContent).toContain('fbtswap');
    expect(screen.getByTestId('perp-fee-breakdown').textContent).toContain('5٪');
    fireEvent.click(screen.getByTestId('perp-submit'));
    const review = await screen.findByTestId('perp-review');
    expect(review.textContent).toContain('fbtswap');
    fireEvent.click(screen.getByTestId('perp-review-confirm'));
    await waitFor(() => expect(OPENED.length).toBe(1));
    /* withReferral's output for Avantis: attribution happens on /referral?code= */
    expect(OPENED[0]).toBe('https://www.avantisfi.com/referral?code=fbtswap');
    expect(screen.getByTestId('loc-probe').textContent).not.toContain('tab=onchain');
  });

  it('renders no raw i18n keys in either language', async () => {
    for (const lang of ['fa', 'en']) {
      LANG = lang;
      cleanup();
      WALLET = { isConnected: true, address: '0x1111111111111111111111111111111111111111' };
      const { container } = mount();
      await screen.findByTestId('perp-ticket');
      const raw = container.textContent.match(/perp\.terminal\.[a-z.]+/i);
      expect(raw, `raw key leaked in ${lang}`).toBeNull();
      cleanup();
    }
  });
});
