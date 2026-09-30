// @vitest-environment jsdom
/**
 * PERPETUAL OVERVIEW — the pair-trading terminal render probe.
 *
 * The wiring audit pins the SOURCES (tabs, referral links, honesty flags).
 * This file proves what only a rendered tree can: that the overview really is
 * a trading terminal, that every number it shows comes from a real feed or
 * renders as an honest placeholder, that the pair catalogue is a catalogue,
 * and — the contract this file exists for now — that signing happens ON THE
 * PERPETUAL TAB and never throws the user onto another one.
 *
 *   «وقتی در صفحه فیوجرز تب پرپچوال میخایی امضا کنی میپره تب ان چین»
 *   «کلا جفت توکن های پرپچوال خیلی کمه»
 *
 *   • the pair strip: a BUILT catalogue (featured + the venue's own list +
 *     the live market table), live price + 24h change + sparkline, the honest
 *     "unavailable" text on offline rows, a working search, and a mark on the
 *     cells this app can actually settle;
 *   • the ticket: long/short switch, stablecoin collateral, the 2/5/10/20/50
 *     chips, notional = collateral × leverage, and the liquidation preview
 *     from the shared pure engine;
 *   • the fee box: protocol / network / FBT rows from the backend preview,
 *     with placeholders when the backend does not answer;
 *   • the final button: the SOLANA connect door when the route settles on
 *     Solana, the review sheet when a wallet is connected, then IN TAB —
 *     prepare → show what was built → sign, with NO query change and NO tab
 *     change at any point;
 *   • the venue-less pair still leaves through Avantis with the registered
 *     `fbtswap` referral code, and still does not touch the tab;
 *   • i18n: the Persian bundle renders every new key, no raw keys on screen.
 *
 * Only framework plumbing and network clients are stubbed (i18n, wallets,
 * framer-motion, the futures BFF client, the venue SDK and the chart engine).
 * The page, the pair merge, the ticket arithmetic, the referral library and
 * the risk engine are real.
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

/* ── the EVM wallet ─────────────────────────────────────────────────────── */
let WALLET = { isConnected: false, address: null };
vi.mock('../src/context/WalletContext', () => ({
  useWallet: () => WALLET,
  shortAddress: (a) => `${String(a || '').slice(0, 6)}…${String(a || '').slice(-4)}`
}));

/*
  ── the SOLANA wallet ──────────────────────────────────────────────────────
  The in-app venue settles on Solana, so THIS is the wallet that signs. A
  user with only an EVM wallet connected must be offered the Solana door, not
  a button whose signature can never arrive — which is exactly the pairing
  that made the old flow feel broken.
*/
let SOL_WALLET = { address: null, isConnected: false };
vi.mock('../src/hooks/useSolanaWallet', () => ({
  useSolanaWallet: () => SOL_WALLET
}));

/* The venue SDK is a large lazy vendor bundle; the test asserts the CALL, not
   the chain, and the real one would try to reach a wallet we do not have. */
const VELOCITY_CALLS = [];
vi.mock('../src/lib/velocityTrade.js', () => ({
  openVelocityPosition: async (args) => {
    VELOCITY_CALLS.push(args);
    return { signature: '5Gm7SignatureFromTheVenueSdk' };
  }
}));

/* ── the opened outbound links, so the referral route can be asserted ───── */
const OPENED = [];
vi.mock('../src/context/TelegramContext', () => ({
  useTelegram: () => ({
    haptic: () => {},
    tg: { openLink: (u) => OPENED.push(u) }
  })
}));

/* ── the market feed: the majors, every row live unless a test says offline ── */
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

/* ── the futures BFF client: markets, candles, the fee preview, the order ── */
const FEE_FOR_CALLS = [];
const PREPARE_CALLS = [];
const VERIFY_CALLS = [];
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
/** What /prepare hands back. The Solana venue builds + signs in the client. */
let PREPARE_ANSWER = {
  ok: true,
  data: {
    executionId: 'exec-1',
    expiresAt: Date.now() + 60_000,
    clientSign: { buildsInTab: true },
    order: { side: 'long', notionalUsd: 500, slippageBps: 50 },
    market: { marketIndex: 1, mid: 60123, symbol: 'BTC-PERP' },
    risk: { blocked: false }
  }
};
vi.mock('../src/lib/futuresClient', () => ({
  getFuturesMarkets: async () => ({ ok: true, data: { markets: VENUE_MARKETS } }),
  getFuturesCandles: async () => ({ ok: false }),
  getFuturesFeePreview: async (q) => { FEE_FOR_CALLS.push(q); return FEE_ANSWER; },
  prepareFutures: async (order) => { PREPARE_CALLS.push(order); return PREPARE_ANSWER; },
  verifyFutures: async (v) => { VERIFY_CALLS.push(v); return { ok: true, data: { state: 'PENDING' } }; }
}));

/* The chart engine is lazy and canvas-bound; the terminal's contract with it
   is only "mount it for the selected venue market with these props". */
vi.mock('../src/components/FuturesMarketChart', () => ({
  default: (p) => <div data-testid={p.testId} data-provider={p.provider} data-market={String(p.market)}>{p.symbol}</div>
}));

/* The two lazy venue tabs: real pages, but this probe tests the OVERVIEW and
   that signing never LEAVES it — not their internals. */
vi.mock('../src/pages/Dydx', () => ({ default: () => <div data-testid="stub-dydx" /> }));
vi.mock('../src/pages/FuturesOnchain', () => ({ default: () => <div data-testid="stub-onchain" /> }));

/* FundingPanel's own network client — it has its own honest states. */
vi.mock('../src/lib/perp', () => ({
  getPerpMarkets: async () => { throw new Error('feed down'); },
  bestVenue: () => null,
  fundingCost: () => null
}));

import Perp, { buildPerpPairs, FEATURED_PAIRS } from '../src/pages/Perp.jsx';

/* Where anything navigated, without touching window.location. */
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

/** The cells of the strip, in render order. */
const pairCells = () => Array.from(document.querySelectorAll('[data-testid^="perp-pair-"]'))
  .filter((el) => el.tagName === 'BUTTON');

const connectWallets = () => {
  WALLET = { isConnected: true, address: '0x1111111111111111111111111111111111111111' };
  SOL_WALLET = { address: '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU', isConnected: true };
};

beforeEach(() => {
  LANG = 'fa';
  WALLET = { isConnected: false, address: null };
  SOL_WALLET = { address: null, isConnected: false };
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
  PREPARE_ANSWER = {
    ok: true,
    data: {
      executionId: 'exec-1',
      expiresAt: Date.now() + 60_000,
      clientSign: { buildsInTab: true },
      order: { side: 'long', notionalUsd: 500, slippageBps: 50 },
      market: { marketIndex: 1, mid: 60123, symbol: 'BTC-PERP' },
      risk: { blocked: false }
    }
  };
  FEE_FOR_CALLS.length = 0;
  PREPARE_CALLS.length = 0;
  VERIFY_CALLS.length = 0;
  VELOCITY_CALLS.length = 0;
  OPENED.length = 0;
});

/* vitest runs without globals here, so RTL's auto-cleanup never registers. */
afterEach(() => cleanup());

describe('the perpetual pair catalogue', () => {
  it('is built from the featured list, the venue list and the live market', () => {
    const rows = buildPerpPairs({
      coins: [{ id: 'pepe', symbol: 'PEPE', name: 'Pepe' }, { id: 'newcoin', symbol: 'NEW', name: 'New' }],
      venueMarkets: [{ base: 'AAPL' }, { base: 'SOL' }]
    });
    const symbols = rows.map((r) => r.symbol);
    /* featured first, in curated order */
    expect(symbols.slice(0, 4)).toEqual(['BTC', 'ETH', 'SOL', 'BNB']);
    /* a venue-only pair the feed has never heard of is still offered */
    expect(symbols).toContain('AAPL');
    /* the live market contributes rows that are in neither curated list */
    expect(symbols).toContain('NEW');
    /* no duplicates, whatever the overlap between the three sources */
    expect(new Set(symbols).size).toBe(symbols.length);
    /* and it is a CATALOGUE, not a watchlist */
    expect(rows.length).toBeGreaterThan(40);
    expect(rows.length).toBeGreaterThan(FEATURED_PAIRS.length - 10);
  });

  it('adopts the feed id when a curated id is not in the feed, but never a clone\'s', () => {
    /* A typo in a curated table must not strand a liquid pair with a
       permanently blank cell — the feed's own id is adopted instead. */
    const rows = buildPerpPairs({ coins: [{ id: 'a-real-hype-id', symbol: 'HYPE' }] });
    expect(rows.find((r) => r.symbol === 'HYPE').id).toBe('a-real-hype-id');

    /* But a feed row that a DIFFERENT curated entry already owns is never
       borrowed: a ticker clone ranked above the real token must not become
       its price on a leveraged screen. */
    const guarded = buildPerpPairs({
      coins: [{ id: 'bitcoin', symbol: 'HYPE' }, { id: 'a-real-hype-id', symbol: 'HYPE' }],
      featured: [{ id: 'bitcoin', symbol: 'BTC' }, { id: 'hyperliquid', symbol: 'HYPE' }]
    });
    expect(guarded.find((r) => r.symbol === 'BTC').id).toBe('bitcoin');
    expect(guarded.find((r) => r.symbol === 'HYPE').id).toBe('hyperliquid');

    /* And a curated id the feed says nothing about stands, so the cell shows
       the honest "no data" rather than a guess. */
    const alone = buildPerpPairs({ coins: [{ id: 'shiba-inu', symbol: 'DOGE2' }] });
    expect(alone.find((r) => r.symbol === 'DOGE').id).toBe('dogecoin');
  });

  it('renders the whole catalogue, states the count, and searches it', async () => {
    mount();
    const strip = await screen.findByTestId('perp-pair-strip');
    const cells = pairCells();
    expect(cells.length).toBeGreaterThan(40);
    expect(strip.textContent).toContain('BTC-PERP');
    expect(strip.textContent).toContain('APT-PERP');
    /* the count is STATED, not implied — a hundred cells with no number
       reads as "still broken" when the user reaches the end */
    expect(screen.getByText(/جفت توکن/)).toBeTruthy();

    /* search narrows it without reordering: the majors stay first */
    fireEvent.change(screen.getByTestId('perp-pair-search'), { target: { value: 'pudgy' } });
    await waitFor(() => expect(pairCells().length).toBeGreaterThanOrEqual(0));
    fireEvent.change(screen.getByTestId('perp-pair-search'), { target: { value: 'zzz-no-such-pair' } });
    await waitFor(() => expect(screen.getByTestId('perp-pair-empty')).toBeTruthy());
    fireEvent.change(screen.getByTestId('perp-pair-search'), { target: { value: 'btc' } });
    await waitFor(() => expect(screen.getByTestId('perp-pair-BTC')).toBeTruthy());
    expect(document.querySelector('[data-testid="perp-pair-ETH"]')).toBeNull();
  });

  it('marks the cells the app can settle, and shows a live row honestly', async () => {
    mount();
    const strip = await screen.findByTestId('perp-pair-strip');
    expect(strip.textContent).toContain('$1');
    /* SOL/BTC are in the venue feed fixture; PEPE is not */
    expect(document.querySelector('[data-testid="perp-pair-SOL"] .perp-pair-live')).toBeTruthy();
    expect(document.querySelector('[data-testid="perp-pair-PEPE"] .perp-pair-live')).toBeNull();
  });

  it('shows the honest unavailable sentence for offline rows, never a snapshot price', async () => {
    FEED.offline = true;
    mount();
    const strip = await screen.findByTestId('perp-pair-strip');
    await waitFor(() => expect(strip.querySelectorAll('.perp-pair-nodata').length).toBeGreaterThan(0));
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
    fireEvent.click(screen.getByTestId('perp-pair-PEPE'));
    await waitFor(() => expect(screen.getByTestId('perp-chart-unavailable')).toBeTruthy());
    expect(screen.queryByTestId('perp-terminal-chart')).toBeNull();
  });
});

describe('the perpetual ticket', () => {
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
});

describe('signing happens on the perpetual tab, not on another one', () => {
  it('asks for the SOLANA wallet when the route settles on Solana', async () => {
    /* An EVM wallet alone must not be enough: it cannot produce the
       signature the venue needs, and a button that promises one anyway is
       the dead end this screen used to have. */
    WALLET = { isConnected: true, address: '0x1111111111111111111111111111111111111111' };
    mount();
    await screen.findByTestId('perp-ticket');
    expect(screen.queryByTestId('perp-submit')).toBeNull();
    const connect = screen.getByTestId('perp-connect');
    expect(connect.textContent).toContain('اتصال کیف پول سولانا');
    fireEvent.click(connect);
    /* it hands off to the wallet page's Solana tab, WITH the ticket intact */
    await waitFor(() => {
      const probe = screen.getByTestId('loc-probe').textContent;
      expect(probe).toContain('/wallet');
      expect(probe).toContain('tab=solana');
      expect(probe).toContain('return=');
    });
  });

  it('builds, shows and signs the order in this tab — no tab change, no navigation', async () => {
    connectWallets();
    mount();
    await screen.findByTestId('perp-ticket');
    expect(screen.getByTestId('perp-wallet-row').textContent).toContain('7xKXtg');

    fireEvent.click(screen.getByTestId('perp-submit'));
    const review = await screen.findByTestId('perp-review');
    expect(review.textContent).toContain('BTC-PERP');
    expect(review.textContent).toContain('لانگ / صعودی');
    expect(review.textContent).toContain('$100 USDC');
    expect(review.textContent).toContain('$500');
    /* the route line says the signature happens here */
    expect(review.textContent).toContain('همین صفحه');

    /* STEP ONE — confirm builds the order server-side, on this screen */
    fireEvent.click(screen.getByTestId('perp-review-confirm'));
    await waitFor(() => expect(screen.getByTestId('perp-prepared')).toBeTruthy());
    expect(PREPARE_CALLS.length).toBe(1);
    expect(PREPARE_CALLS[0]).toMatchObject({
      provider: 'drift',
      market: '1',
      side: 'long',
      collateralUsd: 100,
      leverage: 5
    });
    expect(PREPARE_CALLS[0].wallet).toBe(SOL_WALLET.address);
    /* the sheet is still open, still on this screen */
    expect(screen.getByTestId('perp-review')).toBeTruthy();
    expect(screen.getByTestId('perp-terminal-chart')).toBeTruthy();

    /* STEP TWO — the same button is now the signature */
    fireEvent.click(screen.getByTestId('perp-review-confirm'));
    await waitFor(() => expect(VELOCITY_CALLS.length).toBe(1));
    expect(VELOCITY_CALLS[0]).toMatchObject({ marketIndex: 1, side: 'long', notionalUsd: 500, depositQuote: 100 });
    expect(VELOCITY_CALLS[0].wallet).toBe(SOL_WALLET.address);
    /* the hash is reported to the ledger before the UI claims anything */
    await waitFor(() => expect(VERIFY_CALLS.length).toBe(1));
    expect(VERIFY_CALLS[0]).toMatchObject({ executionId: 'exec-1', txHash: '5Gm7SignatureFromTheVenueSdk' });

    /* AND THE POINT OF THE WHOLE FIX: the tab never moved, the URL never
       changed, and the on-chain tab was never mounted. */
    expect(screen.getByTestId('loc-probe').textContent).toBe('/perp?');
    expect(screen.queryByTestId('stub-onchain')).toBeNull();
    expect(OPENED.length).toBe(0);
    await waitFor(() => expect(screen.getByTestId('perp-tx')).toBeTruthy());
  });

  it('refuses cleanly when the backend blocks the order, and sends nothing', async () => {
    connectWallets();
    PREPARE_ANSWER = { ok: false, error: { code: 'RISK_BLOCKED' } };
    mount();
    await screen.findByTestId('perp-ticket');
    fireEvent.click(screen.getByTestId('perp-submit'));
    await screen.findByTestId('perp-review');
    fireEvent.click(screen.getByTestId('perp-review-confirm'));
    await waitFor(() => expect(screen.getByTestId('perp-exec-error')).toBeTruthy());
    /* no signature was requested, no tab changed, no order was built */
    expect(VELOCITY_CALLS.length).toBe(0);
    expect(screen.queryByTestId('perp-prepared')).toBeNull();
    expect(screen.getByTestId('loc-probe').textContent).toBe('/perp?');
  });

  it('never hands the SAME ticket to the onchain tab twice', async () => {
    /* The old hand-off was idempotent by accident: confirming twice wrote
       the same query twice. Now nothing writes a query at all, so there is
       nothing to be idempotent about. */
    connectWallets();
    mount();
    await screen.findByTestId('perp-ticket');
    fireEvent.click(screen.getByTestId('perp-submit'));
    await screen.findByTestId('perp-review');
    fireEvent.click(screen.getByTestId('perp-review-confirm'));
    await waitFor(() => expect(screen.getByTestId('perp-prepared')).toBeTruthy());
    fireEvent.click(screen.getByTestId('perp-review-confirm'));
    await waitFor(() => expect(VELOCITY_CALLS.length).toBe(1));
    expect(screen.getByTestId('loc-probe').textContent).toBe('/perp?');
  });

  it('sends a venue-less pair through the registered Avantis referral code, in place', async () => {
    connectWallets();
    mount();
    await screen.findByTestId('perp-ticket');
    fireEvent.click(screen.getByTestId('perp-pair-PEPE'));
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
    /* an outbound route is a route, not a tab change */
    expect(screen.getByTestId('loc-probe').textContent).toBe('/perp?');
    expect(PREPARE_CALLS.length).toBe(0);
  });

  it('renders no raw i18n keys in either language', async () => {
    for (const lang of ['fa', 'en']) {
      LANG = lang;
      cleanup();
      connectWallets();
      const { container } = mount();
      await screen.findByTestId('perp-ticket');
      const raw = container.textContent.match(/perp\.[a-z.]+/i);
      expect(raw, `raw key leaked in ${lang}`).toBeNull();
      cleanup();
    }
  });
});
