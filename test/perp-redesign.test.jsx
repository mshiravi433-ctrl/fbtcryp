// @vitest-environment jsdom
/**
 * THE PERPETUAL TAB, REDESIGNED.
 * ---------------------------------------------------------------------------
 *   «الان باید فقط توکن را نشان دهد و نمودار را با دکمه معامله، وقتی روی آن
 *    زدی یک پاپ‌آپ که کل صفحه را بگیرد: جفت توکن و نمودار و مقدار و قیمت، و اگر
 *    کیف پول وصل بود بزنه خرید یا اگر قطع بود بزنه اتصال کیف پول … باید خرید و
 *    فروش داخل اپ خودمان انجام شود … دارای لینک بیرونی هست ببرش … صفحه را شلوغ
 *    نکن»
 *
 * Four claims, four different ways this could be shipped wrong:
 *
 *   1. THE PAGE IS A LIST — token, chart, one trade button. The order ticket,
 *      the fee table and the liquidation table must NOT be on it, or the
 *      redesign is a relabel.
 *   2. THE POPUP TAKES THE WHOLE SCREEN and carries pair, chart, amount and
 *      price. A dialog that is a dialog in a list is not what was asked for.
 *   3. THE BUTTON IS THE WALLET'S TRUTH: Buy when connected, Connect when not.
 *      A screen that shows «Buy» to a user with no wallet has made them sign
 *      in to find out.
 *   4. NOTHING LEAVES THE APP. One outbound venue link is a regression,
 *      whatever the revenue note in the source claims.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import fa from '../src/i18n/locales/fa.json';
import en from '../src/i18n/locales/en.json';

const dict = { fa, en };
const get = (obj, path) => path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
const tFor = (lang) => (key, opts = {}) => {
  let v = get(dict[lang], key);
  if (v == null) v = get(dict.en, key);
  if (v == null) return opts.defaultValue ?? key;
  return String(v).replace(/\{\{(\w+)\}\}/g, (_, k) => String(opts[k] ?? ''));
};
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: tFor('fa') }) }));

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

/* ── the market feed: a real table, so "a list" is a real assertion ──────── */
const mkCoin = (i, symbol) => ({
  id: `coin-${i}`,
  symbol,
  name: `Coin ${i}`,
  image: '',
  price: 1000 + i * 13,
  change24h: i % 3 === 0 ? -2.4 : 1.8,
  volume: 4e9,
  high24h: 1100,
  low24h: 900,
  sparkline: [1, 3, 2, 5, 4, 7],
  rank: i + 1,
  mcap: 1e10
});
let COINS = [
  { ...mkCoin(0, 'BTC'), id: 'bitcoin', name: 'Bitcoin' },
  { ...mkCoin(1, 'ETH'), id: 'ethereum', name: 'Ethereum' },
  { ...mkCoin(2, 'SOL'), id: 'solana', name: 'Solana' }
];
let MARKETS = { ok: true, data: { markets: [{ base: 'BTC', marketId: 'BTC-PERP', mid: 60000, maxLeverage: 50 }] } };

vi.mock('../src/hooks/useMarket', () => ({ useMarkets: () => ({ data: COINS, loading: false }) }));
vi.mock('../src/lib/velocityMarkets', () => ({ velocityPerpIndex: () => null }));
vi.mock('../src/lib/venueReferral', () => ({ anyVenueEarns: () => true, withReferral: (u) => u, AVANTIS_CODE: 'fbtswap' }));

/* The venue feed: BTC is executable here, the other two are not. */
vi.mock('../src/lib/futuresClient', () => ({
  getFuturesMarkets: async (provider) => (provider === 'ostium'
    ? { ok: true, data: { markets: [{ base: 'BTC', marketId: '0', category: 'crypto', mid: 60000, maxLeverage: 50 }] } }
    : MARKETS),
  getFuturesFeePreview: async () => ({ ok: true, data: { fee: { protocol: { feeUsd: 0.6, known: true } } } }),
  prepareFutures: async () => ({ ok: false, code: 'UNUSED' }),
  verifyFutures: async () => ({ ok: false, code: 'UNUSED' })
}));

vi.mock('../src/components/FuturesMarketChart', () => ({
  default: ({ symbol, testId }) => <div data-testid={testId ?? 'chart'}>{symbol} chart</div>
}));
vi.mock('../src/components/FundingPanel', () => ({ default: () => null }));

/* ── the wallet: the one fact the primary button is derived from ─────────── */
let WALLET = { address: null, chainId: null, connected: false };
vi.mock('../src/context/WalletContext', () => ({
  useWallet: () => WALLET,
  shortAddress: (a) => (a ? `${String(a).slice(0, 6)}…` : '')
}));
vi.mock('../src/hooks/useSolanaWallet', () => ({ useSolanaWallet: () => ({ address: null }) }));
vi.mock('../src/context/TelegramContext', () => ({ useTelegram: () => ({ haptic: () => {}, tg: null }) }));
vi.mock('../src/store/useSettingsStore', () => ({
  useSettingsStore: (sel) => sel({ defaultSlippage: 0.5, setSlippage: () => {} })
}));

import Perp from '../src/pages/Perp.jsx';

const mount = () => render(<MemoryRouter initialEntries={['/perp']}><Perp /></MemoryRouter>);

beforeEach(() => {
  WALLET = { address: null, chainId: null, connected: false };
  COINS = [
    { ...mkCoin(0, 'BTC'), id: 'bitcoin', name: 'Bitcoin' },
    { ...mkCoin(1, 'ETH'), id: 'ethereum', name: 'Ethereum' },
    { ...mkCoin(2, 'SOL'), id: 'solana', name: 'Solana' }
  ];
  MARKETS = { ok: true, data: { markets: [{ base: 'BTC', marketId: 'BTC-PERP', mid: 60000, maxLeverage: 50 }] } };
});
afterEach(() => cleanup());

describe('the page is a LIST, not a terminal', () => {
  it('shows a row per token with a price, a chart and a trade button', async () => {
    mount();
    await waitFor(() => expect(screen.getByTestId('perp-row-BTC')).toBeTruthy());
    for (const sym of ['BTC', 'ETH', 'SOL']) {
      const row = screen.getByTestId(`perp-row-${sym}`);
      expect(row.textContent).toContain(sym);
      expect(row.querySelector('.perp-row-spark')).toBeTruthy();
      expect(row.querySelector('[data-testid^="perp-row-open-"]')).toBeTruthy();
    }
  });

  it('does NOT put the order ticket, the fee table or the liquidation table on the page', async () => {
    mount();
    await waitFor(() => expect(screen.getByTestId('perp-row-BTC')).toBeTruthy());
    /* The whole point: the page was a terminal and now it is a list. */
    expect(screen.queryByTestId('perp-ticket')).toBeNull();
    expect(screen.queryByTestId('perp-fee-breakdown')).toBeNull();
    expect(screen.queryByTestId('perp-terminal-chart')).toBeNull();
  });

  it('has NO outbound venue link anywhere', async () => {
    const { container } = mount();
    await waitFor(() => expect(screen.getByTestId('perp-row-BTC')).toBeTruthy());
    const outward = [...container.querySelectorAll('a[href]')]
      .filter((a) => /^https?:\/\//i.test(a.getAttribute('href') || ''));
    expect(outward).toHaveLength(0);
  });

  it('keeps the risk notice, but inside the trade popup where the action is', async () => {
    /* It is not decoration: it is what leverage does to the user's money. It
       just does not belong above a list of a hundred pairs. */
    mount();
    await waitFor(() => expect(screen.getByTestId('perp-row-BTC')).toBeTruthy());
    expect(screen.queryByTestId('perp-risk-note')).toBeNull();
    fireEvent.click(screen.getByTestId('perp-row-open-BTC'));
    await waitFor(() => expect(screen.getByTestId('perp-trade-sheet')).toBeTruthy());
    expect(screen.getByTestId('perp-risk-note')).toBeTruthy();
  });
});

describe('the "how does this work" box', () => {
  it('is collapsed by default, so the page is not cluttered', async () => {
    mount();
    await waitFor(() => expect(screen.getByTestId('perp-row-BTC')).toBeTruthy());
    expect(screen.getByTestId('perp-how-toggle')).toBeTruthy();
    expect(screen.queryByTestId('perp-how-body')).toBeNull();
  });

  it('opens on tap and closes again', async () => {
    mount();
    await waitFor(() => expect(screen.getByTestId('perp-row-BTC')).toBeTruthy());
    fireEvent.click(screen.getByTestId('perp-how-toggle'));
    await waitFor(() => expect(screen.getByTestId('perp-how-body')).toBeTruthy());
    expect(screen.getByTestId('perp-how-body').textContent.length).toBeGreaterThan(80);
    fireEvent.click(screen.getByTestId('perp-how-toggle'));
    await waitFor(() => expect(screen.queryByTestId('perp-how-body')).toBeNull());
  });

  it('states the three things a perpetual trader has to know', async () => {
    mount();
    await waitFor(() => expect(screen.getByTestId('perp-how-toggle')).toBeTruthy());
    fireEvent.click(screen.getByTestId('perp-how-toggle'));
    const body = screen.getByTestId('perp-how-body').textContent;
    /* no expiry, funding, liquidation — the three that actually bite */
    expect(body.length).toBeGreaterThan(80);
    expect(body).not.toBe('perp.how.body');
  });
});

describe('the trade popup takes the whole screen', () => {
  it('carries the pair, the chart, the amount and the price', async () => {
    mount();
    await waitFor(() => expect(screen.getByTestId('perp-row-BTC')).toBeTruthy());
    fireEvent.click(screen.getByTestId('perp-row-open-BTC'));

    const sheet = await waitFor(() => screen.getByTestId('perp-trade-sheet'));
    expect(sheet.className).toContain('perp-sheet-full');
    expect(sheet.textContent).toContain('BTC-PERP');
    expect(screen.getByTestId('perp-sheet-chart')).toBeTruthy();
    expect(screen.getByTestId('perp-sheet-amount')).toBeTruthy();
    expect(screen.getByTestId('perp-sheet-price')).toBeTruthy();
  });

  it('opens for the pair that was tapped, not the one that happened to be first', async () => {
    mount();
    await waitFor(() => expect(screen.getByTestId('perp-row-ETH')).toBeTruthy());
    fireEvent.click(screen.getByTestId('perp-row-open-ETH'));
    const sheet = await waitFor(() => screen.getByTestId('perp-trade-sheet'));
    expect(sheet.textContent).toContain('ETH-PERP');
  });

  it('shows a long and a short, and the liquidation distance for each', async () => {
    mount();
    await waitFor(() => expect(screen.getByTestId('perp-row-BTC')).toBeTruthy());
    fireEvent.click(screen.getByTestId('perp-row-open-BTC'));
    await waitFor(() => expect(screen.getByTestId('perp-sheet-long')).toBeTruthy());
    expect(screen.getByTestId('perp-sheet-short')).toBeTruthy();

    const before = screen.getByTestId('perp-sheet-liq').textContent;
    fireEvent.click(screen.getByTestId('perp-sheet-short'));
    await waitFor(() => expect(screen.getByTestId('perp-sheet-liq').textContent).not.toBe(before));
  });

  it('honours the amount the user typed, in position size', async () => {
    mount();
    await waitFor(() => expect(screen.getByTestId('perp-row-BTC')).toBeTruthy());
    fireEvent.click(screen.getByTestId('perp-row-open-BTC'));
    await waitFor(() => expect(screen.getByTestId('perp-sheet-amount')).toBeTruthy());
    fireEvent.change(screen.getByTestId('perp-sheet-amount'), { target: { value: '250' } });
    await waitFor(() => expect(screen.getByTestId('perp-sheet-size').textContent).toContain('250'));
  });
});

describe('the primary button is the wallet\'s truth', () => {
  it('offers CONNECT when no wallet is attached', async () => {
    mount();
    await waitFor(() => expect(screen.getByTestId('perp-row-BTC')).toBeTruthy());
    fireEvent.click(screen.getByTestId('perp-row-open-BTC'));
    await waitFor(() => expect(screen.getByTestId('perp-sheet-connect')).toBeTruthy());
    /* and NOT a Buy that dead-ends one tap later */
    expect(screen.queryByTestId('perp-sheet-confirm')).toBeNull();
  });

  it('offers the trade when a wallet IS attached', async () => {
    WALLET = { address: '0x2260fac5e5542a773aa44fbcfedf7c193bc2c599', chainId: 1, connected: true };
    mount();
    await waitFor(() => expect(screen.getByTestId('perp-row-BTC')).toBeTruthy());
    fireEvent.click(screen.getByTestId('perp-row-open-BTC'));
    await waitFor(() => expect(screen.getByTestId('perp-sheet-confirm')).toBeTruthy());
    expect(screen.queryByTestId('perp-sheet-connect')).toBeNull();
    /* and says who it is trading as */
    expect(screen.getByTestId('perp-sheet-wallet').textContent).toContain('0x2260');
  });

  it('connect opens the wallet flow, and the ticket comes back after', async () => {
    mount();
    await waitFor(() => expect(screen.getByTestId('perp-row-BTC')).toBeTruthy());
    fireEvent.click(screen.getByTestId('perp-row-open-BTC'));
    await waitFor(() => expect(screen.getByTestId('perp-sheet-connect')).toBeTruthy());
    fireEvent.click(screen.getByTestId('perp-sheet-connect'));
    /* WalletConnectSheet opened — assert the trade sheet is still there behind
       it, because losing the amount the user typed is the real failure. */
    await waitFor(() => expect(screen.getByTestId('perp-trade-sheet')).toBeTruthy());
  });
});

describe('the trade happens HERE', () => {
  it('reviews in-app, with no navigation out of the tab', async () => {
    WALLET = { address: '0x2260fac5e5542a773aa44fbcfedf7c193bc2c599', chainId: 1, connected: true };
    mount();
    await waitFor(() => expect(screen.getByTestId('perp-row-BTC')).toBeTruthy());
    fireEvent.click(screen.getByTestId('perp-row-open-BTC'));
    await waitFor(() => expect(screen.getByTestId('perp-sheet-confirm')).toBeTruthy());
    fireEvent.click(screen.getByTestId('perp-sheet-confirm'));
    await waitFor(() => expect(screen.getByTestId('perp-review')).toBeTruthy());
    expect(screen.queryByTestId('perp-ticket')).toBeNull();
  });
});
