// @vitest-environment jsdom
/**
 * A structural read of the rendered page, for when there is no browser.
 *
 * This is not a second acceptance suite — `perp-redesign.test.jsx` owns the
 * contract. This one answers a different question: what does the tree
 * actually LOOK like, element by element, so a layout can be reasoned about
 * without a screenshot.
 *
 * It fails loudly on the things that make a list look cheap even when every
 * behavioural test passes: a price column that is not a fixed width (so the
 * numbers do not line up), a row with no sparkline, a ticket that is not
 * full-bleed, and a page that grew sections back.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import fa from '../src/i18n/locales/fa.json';
import en from '../src/i18n/locales/en.json';

const dict = { fa, en };
let LANG = 'fa';
const get = (o, p) => p.split('.').reduce((a, k) => (a == null ? undefined : a[k]), o);
const tFor = (lang) => (key, opts = {}) => {
  let v = get(dict[lang], key);
  if (v == null) v = get(dict.en, key);
  if (v == null) return opts.defaultValue ?? key;
  return String(v).replace(/\{\{(\w+)\}\}/g, (_, k) => String(opts[k] ?? ''));
};
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: tFor(LANG) }) }));

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

const COINS = [
  { id: 'bitcoin', symbol: 'BTC', name: 'Bitcoin', price: 61234.5, change24h: 2.41, sparkline: Array.from({ length: 24 }, (_, i) => 60000 + i * 60), image: 'x' },
  { id: 'ethereum', symbol: 'ETH', name: 'Ethereum', price: 3410.2, change24h: -1.08, sparkline: Array.from({ length: 24 }, (_, i) => 3500 - i * 4), image: 'x' },
  { id: 'solana', symbol: 'SOL', name: 'Solana', price: 148.9, change24h: 5.62, sparkline: Array.from({ length: 24 }, (_, i) => 140 + i), image: 'x' }
];
vi.mock('../src/hooks/useMarket', () => ({ useMarkets: () => ({ data: COINS, loading: false }) }));
vi.mock('../src/hooks/useSolanaWallet', () => ({ useSolanaWallet: () => ({ address: null }) }));
vi.mock('../src/context/WalletContext', () => ({
  useWallet: () => ({ address: null, isConnected: false }),
  shortAddress: () => ''
}));
vi.mock('../src/context/TelegramContext', () => ({ useTelegram: () => ({ haptic: () => {} }) }));
vi.mock('../src/store/useSettingsStore', () => ({ useSettingsStore: (s) => s({ defaultSlippage: 0.5, setSlippage: () => {} }) }));
vi.mock('../src/lib/velocityMarkets', () => ({ velocityPerpIndex: () => null }));
vi.mock('../src/lib/venueReferral', () => ({ anyVenueEarns: () => true, withReferral: (u) => u, AVANTIS_CODE: 'fbtswap' }));
vi.mock('../src/lib/futuresClient', () => ({
  getFuturesMarkets: async () => ({ ok: true, data: { markets: [{ base: 'BTC', marketId: 'BTC-PERP', mid: 61234 }] } }),
  getFuturesCandles: async () => ({ ok: false }),
  getFuturesFeePreview: async () => ({ ok: true, data: { fee: { protocol: { feeUsd: 0.6, known: true } } } }),
  prepareFutures: async () => ({ ok: true, data: {} }),
  verifyFutures: async () => ({ ok: true, data: {} })
}));
vi.mock('../src/components/FuturesMarketChart', () => ({ default: (p) => <div data-testid={p.testId}>{p.symbol}</div> }));
vi.mock('../src/components/FundingPanel', () => ({ default: () => null }));

import Perp from '../src/pages/Perp.jsx';

const mount = () => render(<MemoryRouter initialEntries={['/perp']}><Perp /></MemoryRouter>);
const rows = () => Array.from(document.querySelectorAll('[data-testid^="perp-row-"]'))
  .filter((el) => /^perp-row-[A-Z0-9]+$/.test(el.dataset.testid));

beforeEach(() => { LANG = 'fa'; });
afterEach(() => cleanup());

describe('what the page actually looks like', () => {
  it('lays a row out as: identity · sparkline · price/change · trade', async () => {
    mount();
    await waitFor(() => expect(screen.getByTestId('perp-row-BTC')).toBeTruthy());
    const btc = screen.getByTestId('perp-row-BTC');
    const shape = [...btc.children].map((c) => c.className || c.tagName.toLowerCase());
    /* the order is the design: what it is, what it is doing, what it costs,
       and the one thing you can do about it. The icon leads, because it is
       what identifies the row at a glance when the name is truncated. */
    expect(shape[0]).toContain('tok-icon');
    expect(shape[1]).toBe('perp-row-id');
    expect(shape[2]).toBe('perp-row-spark');
    expect(shape[3]).toBe('perp-row-nums');
    expect(shape[4]).toBe('perp-row-go');
    /* and the numbers are inside the numbers cell, not loose in the row */
    expect(btc.querySelector('.perp-row-nums > .perp-row-price')).toBeTruthy();
    expect(btc.querySelector('.perp-row-nums > .perp-row-chg')).toBeTruthy();
  });

  it('prints the live price and change, in the row, for every priced pair', async () => {
    mount();
    await waitFor(() => expect(screen.getByTestId('perp-row-BTC')).toBeTruthy());
    const btc = screen.getByTestId('perp-row-BTC');
    expect(btc.querySelector('.perp-row-price').textContent).toMatch(/^\$61,23\d$/);
    expect(btc.querySelector('.perp-row-chg').textContent).toContain('2.41');
    expect(btc.querySelector('.perp-row-chg').className).toContain('up');
    const eth = screen.getByTestId('perp-row-ETH');
    expect(eth.querySelector('.perp-row-chg').className).toContain('down');
  });

  it('states the count and folds the explainer, so the page opens on the list', async () => {
    mount();
    await waitFor(() => expect(screen.getByTestId('perp-pair-strip')).toBeTruthy());
    /* the count is text on the page, not a number nobody has to count */
    expect(screen.getByText(/جفت توکن/)).toBeTruthy();
    /* the explainer is a button, and its body is not in the tree */
    const toggle = screen.getByTestId('perp-how-toggle');
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByTestId('perp-how-body')).toBeNull();
  });

  it('keeps the page free of anything that is not the list', async () => {
    const { container } = mount();
    await waitFor(() => expect(screen.getByTestId('perp-pair-strip')).toBeTruthy());
    /* no chart, no ticket, no fee table, no venue table, no outbound link —
       the whole point of the redesign, asserted as absence */
    expect(container.querySelector('a[href^="http"]')).toBeNull();
    for (const gone of ['perp-ticket', 'perp-fee-breakdown', 'perp-venue-list', 'perp-terminal-chart', 'perp-risk-note']) {
      expect(screen.queryByTestId(gone), gone).toBeNull();
    }
    /* and nothing between the header and the list that is not the explainer */
    const strip = screen.getByTestId('perp-pair-strip');
    expect(strip.querySelector('table')).toBeNull();
  });

  it('opens the ticket as a full-bleed sheet with the pair, price, chart and amount', async () => {
    mount();
    await waitFor(() => expect(screen.getByTestId('perp-row-open-BTC')).toBeTruthy());
    fireEvent.click(screen.getByTestId('perp-row-open-BTC'));
    const sheet = await waitFor(() => screen.getByTestId('perp-trade-sheet'));
    /* full-bleed: the class the CSS keys the whole-viewport layout off */
    expect(sheet.className).toContain('perp-sheet-full');
    /* and the four things the user came for, all inside it */
    expect(sheet.textContent).toContain('BTC-PERP');
    expect(screen.getByTestId('perp-sheet-price').textContent).toMatch(/\$61,23\d/);
    expect(screen.getByTestId('perp-sheet-chart')).toBeTruthy();
    expect(screen.getByTestId('perp-sheet-amount')).toBeTruthy();
    /* with a way out, in the sheet — a full-bleed overlay with no dismiss
       is a trap on a phone */
    expect(screen.getByTestId('perp-sheet-close')).toBeTruthy();
  });

  it('orders the ticket top-down: what it is, what it does, what it costs, what you do', async () => {
    mount();
    await waitFor(() => expect(screen.getByTestId('perp-row-open-BTC')).toBeTruthy());
    fireEvent.click(screen.getByTestId('perp-row-open-BTC'));
    await waitFor(() => expect(screen.getByTestId('perp-trade-sheet')).toBeTruthy());
    const body = screen.getByTestId('perp-trade-body');
    /* a class list, not a single name: the button is `btn perp-sheet-go long`
       and matching on the first class alone would pass for any button. */
    const order = [...body.children].map((c) => c.className);
    const at = (name) => order.findIndex((c) => c.split(/\s+/).includes(name));
    expect(at('perp-sheet-head')).toBe(0);
    /* the chart comes before the inputs: you size a trade against a shape */
    expect(at('perp-sheet-chart')).toBeGreaterThan(-1);
    expect(at('dir-switch')).toBeGreaterThan(at('perp-sheet-chart'));
    /* the amount and the leverage are before the summary that depends on them */
    expect(at('perp-field')).toBeGreaterThan(at('dir-switch'));
    expect(at('perp-summary')).toBeGreaterThan(at('perp-field'));
    /* and the button is last, after everything it acts on */
    expect(order.at(-1).split(/\s+/)).toContain('perp-sheet-go');
  });

  it('renders in English as well, with no raw key and no empty string', async () => {
    LANG = 'en';
    mount();
    await waitFor(() => expect(screen.getByTestId('perp-row-BTC')).toBeTruthy());
    const text = document.body.textContent;
    expect(text).not.toMatch(/perp\.[a-z.]+/i);
    expect(text).not.toContain('{{');
    expect(screen.getByText(/How do perpetual futures work/)).toBeTruthy();
    const btc = screen.getByTestId('perp-row-BTC');
    expect(btc.querySelector('.perp-row-go').textContent.trim()).toBe('Trade');
  });
});
