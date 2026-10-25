// @vitest-environment jsdom
/**
 * THE PERP VENUE AUTO-ORDER IS A RAIL CARD THAT OPENS A POPUP.
 * ---------------------------------------------------------------------------
 *   «در سفارش خودکار یک باکس شبیه بقیه باکس‌های سفارش خودکار با نام سفارش روی
 *    ونوو پرپتوال درست کن و از صفحه ببر … فقط مثل بقیه داخل باکس باشد که به
 *    صورت پاپ اپ باز شود، بازار دارای لوگو باشد، دکمه لانگ و شورت مدرن شود،
 *    تب dYdX و Ostium مدرن، نوع سفارش مدرن‌تر، تب بازشونده با نام هشدار،
 *    اعتبار سفارش مدرن‌تر، هشدارها درست بشه و دکمه انجام را درست کن»
 *
 * Four claims, four ways to ship it wrong:
 *
 *   1. THE PAGE FACE IS ONE CARD — classed like its seven siblings, named
 *      «سفارش روی ونوو پرپتوال», carrying the live-count badge contract. The
 *      old standing section (title + paragraph inline on the page) must not
 *      come back as a second surface.
 *   2. THE POPUP CARRIES THE SECTION — its title is «سفارش خودکار روی
 *      ونووهای پرپتوال», its paragraph is the section's own, and inside it
 *      are the venue tabs, the kind cards, the long/short pair, the lifetime
 *      segmented control and ONE fold named «هشدار» holding the process and
 *      the warnings.
 *   3. MARKETS WEAR LOGOS — in the picker rows and again in the chosen-market
 *      strip next to the live price, from vendored artwork (an <img>/<svg>
 *      node), never a bare ticker.
 *   4. THE ACTION BUTTON ENDS ON AN ANSWER — review shows the signed price,
 *      placing lands on the success panel, and the resting order appears in
 *      the popup's own list. A popup that just vanishes teaches a second tap.
 *
 * The venues are mocked at the module edge: this suite asserts OUR surface
 * and OUR planner wiring. The planner's arithmetic is owned by
 * test/perp-auto-orders-units.mjs, the venue encoders by their probes.
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

vi.mock('../src/context/WalletContext', () => ({
  useWallet: () => ({
    address: null,
    chainId: null,
    getReadProvider: vi.fn(async () => null),
    switchChain: vi.fn(async () => false),
    ensureSigner: vi.fn(async () => null),
    getSigner: vi.fn(() => null)
  })
}));

vi.mock('../src/context/TelegramContext', () => ({
  useTelegram: () => ({ haptic: vi.fn() })
}));

/* A BTC-USD market with dYdX's real geometry — the same fixture the planner
   units use, so a valid plan here means the same thing there. Hoisted: the
   mock factories below are lifted above every other statement in the file. */
const { BTC, placeDydxAutoOrder } = vi.hoisted(() => ({
  BTC: {
    ticker: 'BTC-USD',
    status: 'ACTIVE',
    oraclePrice: '100000',
    priceChange24H: '1.5',
    raw: {
      ticker: 'BTC-USD',
      tickSize: '1',
      stepSize: '0.0001',
      stepBaseQuantums: 1000000,
      atomicResolution: -10,
      quantumConversionExponent: -9,
      subticksPerTick: 100000
    }
  },
  placeDydxAutoOrder: vi.fn(async () => ({ clientId: 4242, hash: 'ABC123' }))
}));

vi.mock('../src/lib/dydx', () => ({
  dydxSessionAddress: () => 'dydx1test000000000000000000000000000000000',
  getDydxMarkets: async () => ({ markets: [BTC], live: true }),
  getDydxOrders: async () => ({ orders: [], live: true }),
  getDydxSubaccount: async () => ({ account: { positions: [] } }),
  cancelDydxOrder: vi.fn(async () => ({})),
  placeDydxAutoOrder
}));

vi.mock('../src/lib/ostium', () => ({
  OSTIUM_CHAIN_ID: 42161,
  getOstiumMarkets: async () => ({
    pairs: [{ pairId: 0, from: 'BTC', to: 'USD', label: 'BTC/USD', mid: 100000, isMarketOpen: true, maxLeverage: 100, group: { name: 'Crypto' } }],
    live: true
  }),
  getOstiumOpenOrders: async () => ({ orders: [], live: true }),
  buildApproveCollateral: vi.fn(async () => ({ to: '0x0', data: '0x' })),
  buildCancelLimitOrder: vi.fn(async () => ({ to: '0x0', data: '0x' })),
  buildOpenTrade: vi.fn(async () => ({ to: '0x0', data: '0x' }))
}));

import PerpAutoOrders from '../src/components/orders/PerpAutoOrders.jsx';
import { PERP_AUTO_COPY_FA as COPY } from '../src/lib/perpAutoCopy.js';

const q = (sel, root = document) => root.querySelector(sel);

function mountCard() {
  return render(
    <MemoryRouter>
      <div className="ord-rail">
        <PerpAutoOrders lang="fa" />
      </div>
    </MemoryRouter>
  );
}

async function openPopup() {
  fireEvent.click(screen.getByTestId('perp-open-sheet'));
  await waitFor(() => expect(q('[data-testid="perp-auto-popup"]')).toBeTruthy());
}

beforeEach(() => {
  localStorage.clear();
  placeDydxAutoOrder.mockClear();
});

afterEach(() => cleanup());

describe('the perp venue auto-order card and its popup', () => {
  it('the page face is one rail card like the other order types — and no inline section', () => {
    mountCard();
    const card = screen.getByTestId('perp-open-sheet');
    expect(card.className).toContain('ord-new-card');
    expect(card.className).toContain('ord-new-perp');
    expect(card.textContent).toContain(COPY.openSheet);
    expect(card.textContent).toContain(COPY.cardSub);
    /* The retired standing section: its title and paragraph must NOT be on
       the page before the card is tapped. */
    expect(q('[data-testid="perp-auto-section"]')).toBeNull();
    expect(document.body.textContent).not.toContain(COPY.sectionTitle);
    expect(document.body.textContent).not.toContain(COPY.sectionBody);
  });

  it('the popup carries the section title, its paragraph and the modern controls', async () => {
    mountCard();
    await openPopup();

    expect(screen.getByText(COPY.sectionTitle)).toBeTruthy();
    expect(screen.getByText(COPY.sectionBody)).toBeTruthy();

    /* Venue tabs: both venues, dYdX selected first, each with its mark. */
    const dydxTab = screen.getByTestId('perp-venue-dydx');
    const ostiumTab = screen.getByTestId('perp-venue-ostium');
    expect(dydxTab.getAttribute('aria-checked')).toBe('true');
    expect(dydxTab.textContent).toContain(COPY.venueSubDydx);
    expect(ostiumTab.textContent).toContain(COPY.venueSubOstium);
    expect(dydxTab.querySelector('img, svg')).toBeTruthy();
    expect(ostiumTab.querySelector('svg, img')).toBeTruthy();

    /* dYdX offers all four kinds as cards. */
    for (const k of ['entry-limit', 'entry-stop', 'take-profit', 'stop-loss']) {
      expect(screen.getByTestId(`perp-kind-${k}`)).toBeTruthy();
    }
    expect(screen.getByTestId('perp-kind-entry-limit').textContent).toContain(COPY.kindShort['entry-limit']);

    /* Long / short, named as such. */
    expect(screen.getByTestId('perp-side-buy').textContent).toContain(COPY.sideLong);
    expect(screen.getByTestId('perp-side-sell').textContent).toContain(COPY.sideShort);
    fireEvent.click(screen.getByTestId('perp-side-sell'));
    expect(screen.getByTestId('perp-side-sell').getAttribute('aria-checked')).toBe('true');
    fireEvent.click(screen.getByTestId('perp-side-buy'));

    /* The lifetime is a segmented control with all four choices. */
    for (const k of ['1d', '7d', '28d', '90d']) {
      expect(screen.getByTestId(`perp-expiry-${k}`)).toBeTruthy();
    }

    /* One fold named «هشدار», open, holding the process AND the warnings. */
    const fold = q('[data-testid="perp-warn-fold"]');
    expect(fold).toBeTruthy();
    expect(fold.getAttribute('data-open')).toBe('true');
    expect(fold.textContent).toContain(COPY.warnTitle);
    expect(fold.textContent).toContain(COPY.howTitle);
    expect(fold.textContent).toContain(COPY.howStep1);
    expect(fold.textContent).toContain(COPY.howStep3);
    expect(fold.textContent).toContain(COPY.riskBody);
    expect(fold.textContent).toContain(COPY.nonCustodyBody);

    /* Switching venue swaps the kind set and drops the lifetime control —
       Ostium resting orders carry no expiry to choose. */
    fireEvent.click(ostiumTab);
    await waitFor(() => expect(screen.getByTestId('perp-side-long')).toBeTruthy());
    expect(q('[data-testid="perp-kind-take-profit"]')).toBeNull();
    expect(q('[data-testid="perp-expiry-select"]')).toBeNull();
    /* …and the fold gains Ostium's two protocol warnings. */
    expect(fold.textContent).toContain(COPY.slippageNote);
    expect(fold.textContent).toContain(COPY.cancelCostNote);
  });

  it('markets wear logos, and placing ends on the success panel with the order listed', async () => {
    mountCard();
    await openPopup();

    /* Open the picker: the BTC-USD row carries artwork, not a bare ticker. */
    const trigger = q('[data-testid="perp-market-select"] button');
    expect(trigger).toBeTruthy();
    fireEvent.click(trigger);
    await waitFor(() => expect(screen.getByRole('option', { name: /BTC-USD/ })).toBeTruthy());
    const option = screen.getByRole('option', { name: /BTC-USD/ });
    expect(option.querySelector('img, svg')).toBeTruthy();
    fireEvent.click(option);

    /* The chosen-market strip: logo again, beside the live price. */
    await waitFor(() => expect(q('.pao-market-live')).toBeTruthy());
    expect(q('.pao-market-live').querySelector('img, svg')).toBeTruthy();
    expect(q('.pao-market-live').textContent).toContain('BTC-USD');

    /* Numbers the planner accepts: 0.001 BTC limit-buy below the market. */
    fireEvent.change(screen.getByTestId('perp-size'), { target: { value: '0.001' } });
    fireEvent.change(screen.getByTestId('perp-price'), { target: { value: '90000' } });

    const reviewBtn = await screen.findByTestId('perp-review');
    await waitFor(() => expect(reviewBtn.disabled).toBe(false));
    fireEvent.click(reviewBtn);

    /* The receipt shows what will be signed — venue, market, the price. */
    const review = await screen.findByTestId('perp-review-card');
    expect(review.textContent).toContain('BTC-USD');
    expect(review.textContent).toContain(COPY.riskBody);

    fireEvent.click(screen.getByTestId('perp-place'));
    await waitFor(() => expect(placeDydxAutoOrder).toHaveBeenCalledTimes(1));

    /* The end state says what happened, and the order is in the list. */
    await waitFor(() => expect(q('[data-testid="perp-placed"]')).toBeTruthy());
    expect(q('[data-testid="perp-placed"]').textContent).toContain(COPY.placedTitle);
    const row = q('[data-testid^="perp-order-"]');
    expect(row).toBeTruthy();
    expect(row.textContent).toContain('BTC-USD');
    expect(row.querySelector('img, svg')).toBeTruthy();

    /* The card back on the page now reports the resting order. */
    expect(screen.getByTestId('perp-open-sheet').querySelector('.ord-new-count')?.textContent).toBe('1');
  });
});
