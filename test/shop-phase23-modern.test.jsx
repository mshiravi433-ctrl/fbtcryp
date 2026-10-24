// @vitest-environment jsdom
/**
 * SHOP PHASE 2/3 — Gift envelope, loyalty chip, recent rail, regional heat,
 * counter access and the honest Web3-identity card.
 * ---------------------------------------------------------------------------
 * Same harness as `shop-phase1-modern.test.jsx` (mocked i18n, Telegram,
 * wallets, catalogue fetches) so every assertion runs against the REAL
 * components and the REAL pure logic in `src/lib/shopHub.js`; only the
 * network and the contexts stand in. The tests below each pin a property the
 * brief demanded — including the negative ones, because the failure modes
 * this repo keeps dying of are features wired to nothing and buttons that
 * pretend.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import en from '../src/i18n/locales/en.json';
import fa from '../src/i18n/locales/fa.json';

let language = 'fa';
const t = (key, values = {}) => {
  const dict = language === 'fa' ? fa : en;
  const text = key.split('.').reduce((o, k) => o?.[k], dict) ?? values.defaultValue ?? key;
  return String(text)
    .replace(/\{\{(\w+)\}\}/g, (_, k) => (k === 'fee' ? '0.7' : values[k] ?? ''))
    .replace(/<0>.*?<\/0>/g, '');
};

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t, i18n: { language, resolvedLanguage: language, changeLanguage: vi.fn() } }),
  initReact18next: { type: '3rdParty', init: () => {} },
  initReactI18next: { type: '3rdParty', init: () => {} }
}));

vi.mock('../src/context/TelegramContext', () => ({
  useTelegram: () => ({ haptic: () => {}, tg: null, user: { id: 77 } })
}));

let mockWalletState = { isConnected: false, address: null, chainId: 1, getReadProvider: null };
vi.mock('../src/context/WalletContext', () => ({
  useWallet: () => mockWalletState,
  shortAddress: (a) => (a ? `${a.slice(0, 6)}...${a.slice(-4)}` : '')
}));

let mockSolState = { address: null };
vi.mock('../src/hooks/useSolanaWallet', () => ({
  useSolanaWallet: () => mockSolState
}));

vi.mock('../src/lib/swap', () => ({
  getBalances: vi.fn(async () => ({ USDC: '12.5', USDT: '90' })),
  getTokenBalance: vi.fn(async () => null)
}));

vi.mock('../src/store/useAppStore', () => ({
  useAppStore: (sel) => sel({ ensureRefCode: () => 'FBTREF99', points: 2600, addToast: () => {} })
}));

const mockShare = vi.fn(async () => ({ ok: true }));
vi.mock('../src/hooks/useShare', () => ({
  useShare: () => [mockShare, () => null]
}));

const mockOpenUrl = vi.fn();
vi.mock('../src/lib/browser', () => ({ openUrl: (...args) => mockOpenUrl(...args) }));

const mockReportInterest = vi.fn(async () => true);
const mockFetchReadiness = vi.fn(async () => ({ whitelabelConfigured: false, at: Date.now() }));
let mockTrendingRows = [];
let storedCountry = 'US';

vi.mock('../src/lib/shop', () => ({
  SHOP_PRICING_COINS: Object.freeze(['USDC', 'USDT']),
  normalizeShopCoin: (c) => (String(c).toUpperCase() === 'USDT' ? 'USDT' : 'USDC'),
  getShopCountry: () => storedCountry,
  setShopCountry: (cc) => { storedCountry = cc; },
  fetchShopCountries: async () => ({
    rows: [
      { code: 'US', name: 'United States' },
      { code: 'TR', name: 'Turkiye' },
      { code: 'AE', name: 'United Arab Emirates' },
      { code: 'GB', name: 'United Kingdom' },
      { code: 'DE', name: 'Germany' }
    ],
    live: true
  }),
  fetchShopCatalogue: async () => ({
    rows: [
      { id: 'b-steam', family: 'Steam', name: 'Steam', logo: null, bg: '#1b2838', category: 'games', tags: ['games'], kind: 'giftcard', min: '$10', max: '$100', outOfStock: false, country: 'US' },
      { id: 'b-rewarble', family: 'Rewarble', name: 'Rewarble Visa', logo: null, bg: '#102a43', category: 'e-money', tags: ['e-money'], kind: 'giftcard', min: '$20', max: '$200', outOfStock: false, country: 'US' },
      { id: 'b-apple', family: 'Apple', name: 'Apple Gift Card', logo: null, bg: '#111827', category: 'e-commerce', tags: ['e-commerce'], kind: 'giftcard', min: '$15', max: '$500', outOfStock: false, country: 'US' },
      { id: 'b-netflix', family: 'Netflix', name: 'Netflix', logo: null, bg: '#111111', category: 'streaming', tags: ['streaming'], kind: 'giftcard', min: '$25', max: '$150', outOfStock: false, country: 'US' }
    ],
    categories: [
      { id: 'games', count: 1 },
      { id: 'e-money', count: 1 },
      { id: 'e-commerce', count: 1 },
      { id: 'streaming', count: 1 }
    ],
    live: true
  }),
  fetchShopProducts: async () => ({
    rows: [
      { id: 'd20', label: '$20', coinAmount: 21.5, coin: 'USDC', spreadPct: 7.5 },
      { id: 'd50', label: '$50', coinAmount: 53.86, coin: 'USDC', spreadPct: 7.7 }
    ],
    bestSpreadPct: 7.5,
    pricingCoin: 'USDC',
    brand: 'Steam',
    logo: null,
    note: 'Region locked to US accounts.',
    howTo: 'Redeem in Steam Wallet.',
    contentLocale: 'en',
    outOfStock: false,
    live: true
  }),
  fetchShopTrending: async () => ({ rows: mockTrendingRows, live: true }),
  reportShopInterest: (...a) => mockReportInterest(...a),
  fetchShopReadiness: () => mockFetchReadiness()
}));

vi.mock('framer-motion', () => {
  const components = new Map();
  return {
    motion: new Proxy({}, {
      get: (_, tag) => {
        if (!components.has(tag)) {
          components.set(tag, ({ children, ...props }) => {
            const Tag = String(tag);
            const clean = Object.fromEntries(Object.entries(props).filter(([key]) => ![
              'initial', 'animate', 'exit', 'transition', 'whileTap', 'whileHover',
              'layout', 'layoutId', 'variants', 'custom'
            ].includes(key)));
            return <Tag {...clean}>{children}</Tag>;
          });
        }
        return components.get(tag);
      }
    }),
    AnimatePresence: ({ children }) => children,
    useReducedMotion: () => true
  };
});

import Shop from '../src/pages/Shop.jsx';
import {
  GIFT_THEMES,
  buildGiftSharePath,
  giftThemeFor,
  getRecentViews,
  orderRowsByTrending,
  parseGiftArrival,
  pushRecentView,
  resolveRecentViews,
  trendingHasHeat
} from '../src/lib/shopHub';

function RouteProbe() {
  const loc = useLocation();
  return <div data-testid="route-probe">{`${loc.pathname}${loc.search}`}</div>;
}

function renderShop(initialEntry = '/shop') {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <Routes>
        <Route path="/shop" element={<Shop />} />
        <Route path="/swap" element={<RouteProbe />} />
        <Route path="/rewards" element={<RouteProbe />} />
      </Routes>
    </MemoryRouter>
  );
}

beforeEach(() => {
  language = 'fa';
  storedCountry = 'US';
  mockTrendingRows = [];
  localStorage.clear();
  mockOpenUrl.mockClear();
  mockShare.mockClear();
  mockReportInterest.mockClear();
  mockFetchReadiness.mockResolvedValue({ whitelabelConfigured: false, at: Date.now() });
  mockWalletState = { isConnected: false, address: null, chainId: 1, getReadProvider: null };
  mockSolState = { address: null };
});

afterEach(() => cleanup());

describe('pure hub logic — the rules the paint depends on', () => {
  it('builds only well-formed gift paths and ignores junk', () => {
    expect(buildGiftSharePath('us', 'Steam', 'birthday'))
      .toBe('/shop?c=US&b=steam&gift=1&gt=birthday');
    expect(buildGiftSharePath('U', 'Steam', 'gold')).toBe('');
    expect(buildGiftSharePath('US', '  ', 'gold')).toBe('');
  });

  it('defaults an unknown theme to gold, never renders a junk class', () => {
    expect(giftThemeFor('birthday')).toBe('birthday');
    expect(giftThemeFor('../etc/passwd')).toBe('gold');
    expect(GIFT_THEMES.map((g) => g.id)).toEqual(['birthday', 'gaming', 'congrats', 'gold']);
  });

  it('reads a gift arrival ONLY with gift=1 and never from a plain share', () => {
    const g = new Map([['gift', '1'], ['gt', 'gaming']]);
    expect(parseGiftArrival((k) => g.get(k))).toEqual({ theme: 'gaming' });
    const plain = new Map([['c', 'US'], ['b', 'steam']]);
    expect(parseGiftArrival((k) => plain.get(k))).toBeNull();
  });

  it('recent views: unshift, de-dupe, cap, and resolve against the LIVE catalogue only', () => {
    const mem = new Map();
    const storage = {
      getItem: (k) => (mem.has(k) ? mem.get(k) : null),
      setItem: (k, v) => mem.set(k, v)
    };
    let list = pushRecentView({ id: 'a', family: 'A', name: 'A' }, storage);
    list = pushRecentView({ id: 'b', family: 'B', name: 'B' }, storage);
    list = pushRecentView({ id: 'a', family: 'A', name: 'A' }, storage);
    expect(list.map((r) => r.id)).toEqual(['a', 'b']);
    for (let i = 0; i < 15; i++) pushRecentView({ id: `x${i}`, family: `X${i}`, name: `X${i}` }, storage);
    expect(getRecentViews(storage).length).toBeLessThanOrEqual(10);
    const rows = [
      { id: 'a', name: 'A', outOfStock: false },
      { id: 'b', name: 'B', outOfStock: true }
    ];
    expect(resolveRecentViews(list, rows).map((r) => r.id)).toEqual(['a']);
  });

  it('trend re-rank is a re-ORDER, never a rewrite; cold input returns the old rail', () => {
    const rows = [
      { id: '1', name: 'One' }, { id: '2', name: 'Two' }, { id: '3', name: 'Three', outOfStock: true }
    ];
    expect(orderRowsByTrending(rows, [])).toBe(rows);
    const ranked = orderRowsByTrending(rows, [
      { id: '2', score: 9, views: 4 },
      { id: '1', score: 3, views: 1 }
    ]);
    expect(ranked.map((r) => r.id)).toEqual(['2', '1', '3']);
    expect(trendingHasHeat([])).toBe(false);
    expect(trendingHasHeat([{ id: '2', views: 0 }])).toBe(false);
    expect(trendingHasHeat([{ id: '2', views: 4 }])).toBe(true);
  });
});

describe('Shop screen — Phase 2/3 surfaces', () => {
  it('records a view (recent rail + anonymous interest) when a brand sheet opens', async () => {
    renderShop('/shop');
    const steam = (await screen.findAllByText('Steam'))[0];
    fireEvent.click(steam.closest('button'));

    await waitFor(() => expect(mockReportInterest).toHaveBeenCalledWith('US', 'b-steam'));
    const recent = JSON.parse(localStorage.getItem('fbt.shop.recent.v1'));
    expect(recent[0].id).toBe('b-steam');
    expect(recent[0]).not.toHaveProperty('wallet');

    /* the rail appears above the catalogue and re-opens the sheet in one tap */
    const pills = [...document.querySelectorAll('.shop-recent-pill')];
    expect(pills.some((p) => p.textContent === 'Steam')).toBe(true);
  });

  it('counts a brand once per country, but again when the regional catalogue changes', async () => {
    renderShop('/shop');
    fireEvent.click((await screen.findAllByText('Steam'))[0].closest('button'));
    await waitFor(() => expect(mockReportInterest).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole('button', { name: fa.common.close }));
    fireEvent.click((await screen.findAllByText('Steam'))[0].closest('button'));
    await waitFor(() => expect(screen.getByRole('button', { name: fa.common.close })));
    expect(mockReportInterest).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: fa.common.close }));
    fireEvent.click(screen.getByRole('button', { name: new RegExp(fa.shop.quickRegion.names.TR) }));
    await waitFor(() => expect(storedCountry).toBe('TR'));
    fireEvent.click((await screen.findAllByText('Steam'))[0].closest('button'));
    await waitFor(() => expect(mockReportInterest).toHaveBeenCalledWith('TR', 'b-steam'));
    expect(mockReportInterest).toHaveBeenCalledTimes(2);
  });

  it('shows the loyalty chip with the REAL rank wording and links to /rewards', async () => {
    renderShop('/shop');
    await screen.findByTestId('shop-loyalty-card');
    /* visible title, and the SAME tierFor the rewards screen uses:
       2600 points → gold. Persian labels, zero English. */
    const card = screen.getByTestId('shop-loyalty-card');
    expect(card.textContent).toContain(fa.shop.loyalty.title);
    expect(card.textContent).toContain(fa.rank.tier.gold);
    expect(card.textContent).toContain('امتیاز رتبه');
    const link = screen.getByRole('button', { name: fa.shop.loyalty.cta });
    fireEvent.click(link);
    await waitFor(() => {
      expect(screen.getByTestId('route-probe').textContent).toBe('/rewards');
    });
    /* the honesty line is on the card itself, not behind a collapse */
    expect(card.textContent).toContain(fa.shop.loyalty.note);
  });

  it('offers the four gift themes and shares an in-app gift link with the referral code', async () => {
    renderShop('/shop');
    const steam = (await screen.findAllByText('Steam'))[0];
    fireEvent.click(steam.closest('button'));

    for (const g of GIFT_THEMES) {
      expect(screen.getByText(fa.shop.gift.theme[g.id])).toBeTruthy();
    }
    fireEvent.click(screen.getByRole('button', { name: new RegExp(fa.shop.gift.theme.congrats) }));
    fireEvent.click(screen.getByRole('button', { name: new RegExp(fa.shop.gift.send) }));

    await waitFor(() => expect(mockShare).toHaveBeenCalled());
    const { url, text } = mockShare.mock.calls[0][0];
    expect(url).toContain('#/shop?c=US&b=steam&gift=1&gt=congrats');
    expect(url).toContain('ref=FBTREF99');
    expect(text).toContain(fa.shop.gift.theme.congrats);
    /* the chosen theme persists for the next gift, on this device only */
    expect(localStorage.getItem('fbt.shop.gift.theme.v1')).toBe('congrats');
  });

  it('a gift arrival paints the envelope banner and rewrites no URL (no setSearchParams on mount)', async () => {
    let replaced = 0;
    const realReplace = window.history.replaceState.bind(window.history);
    window.history.replaceState = (...args) => { replaced += 1; return realReplace(...args); };

    renderShop('/shop?c=US&b=apple&gift=1&gt=birthday');
    await waitFor(() => {
      const banner = document.querySelector('.shop-gift-envelope');
      expect(banner).toBeTruthy();
      expect(banner.getAttribute('data-theme')).toBe('birthday');
    });
    /* the sender is recorded as a referrer by the app-boot captureReferral;
       this page only READS it — and the banner admits that honestly. */
    expect(document.body.textContent).toContain(fa.shop.gift.receivedBody.slice(0, 14));

    /* the URL a history-obsessed implementation would "clean" stays intact */
    expect(replaced).toBe(0);
    window.history.replaceState = realReplace;
  });

  it('attributes a gift only when the persisted referrer is THIS link sender', async () => {
    localStorage.setItem('fbt-referred-by', 'OTHER99');
    localStorage.setItem('fbt-referred-at', String(Date.now()));
    renderShop('/shop?c=US&b=apple&gift=1&gt=gold&ref=SENDER99');
    await waitFor(() => expect(document.querySelector('.shop-gift-envelope')).toBeTruthy());
    expect(document.body.textContent).not.toContain(fa.shop.gift.referralActive);
    expect(document.querySelector('.shop-gift-envelope-theme')?.textContent).toContain(fa.shop.gift.theme.gold);

    cleanup();
    localStorage.setItem('fbt-referred-by', 'SENDER99');
    renderShop('/shop?c=US&b=apple&gift=1&gt=gold&ref=SENDER99');
    await waitFor(() => expect(document.body.textContent).toContain(fa.shop.gift.referralActive));
  });

  it('keeps every hardware vendor name attached to its stacked comparison facts', async () => {
    renderShop('/shop');
    fireEvent.click(await screen.findByRole('button', { name: new RegExp(fa.hardware.compareTitle) }));
    const labels = [...document.querySelectorAll('.hw-compare-vendor')].map((el) => el.textContent);
    expect(labels.length).toBeGreaterThanOrEqual(8);
    expect(labels).toContain('Ledger');
    expect(labels).toContain('Trezor');
  });

  it('hottest-in-region label appears only when the counter has real heat', async () => {
    mockTrendingRows = [
      { id: 'b-netflix', family: 'Netflix', name: 'Netflix', views: 6, spreadPct: 7.4, score: 12.1 },
      { id: 'b-apple', family: 'Apple', name: 'Apple Gift Card', views: 4, spreadPct: 6.9, score: 8.7 }
    ];
    renderShop('/shop');
    await screen.findByText(fa.shop.trending.title);
    /* the rail still shows every flagship brand, only re-ordered: netflix
       (hot) may lead; nothing is dropped for being un-counted */
    expect(screen.getAllByText('Apple Gift Card').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Netflix').length).toBeGreaterThan(0);
    expect(screen.getAllByText(fa.shop.trending.title).length).toBeGreaterThan(0);
  });

  it('without heat, the rail keeps the classic label — the flame is earned', async () => {
    renderShop('/shop');
    await screen.findByText(fa.shop.featured.title);
    expect(document.body.textContent).not.toContain(fa.shop.trending.title);
  });

  it('the pay tab offers the counter (QR/NFC) door and mounts TapToPay on demand', async () => {
    mockWalletState = {
      isConnected: true,
      address: '0x1111111111111111111111111111111111111111',
      chainId: 56,
      chain: { name: 'BNB Smart Chain' },
      mode: 'local',
      locked: false,
      getReadProvider: () => Promise.resolve(null)
    };
    renderShop('/shop?tab=pay');
    await screen.findByText(fa.shop.pay.counterTitle);
    /* nothing heavy mounts BEFORE the tap — the lazy chunk only runs on demand */
    expect(document.querySelector('.tap-box')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: new RegExp(fa.shop.pay.counterCta) }));
    await waitFor(() => expect(document.querySelector('.tap-box')).toBeTruthy());
  });

  it('renders NO whitelabel card while the server key is unset — and only a quiet truth when set', async () => {
    renderShop('/shop?tab=pay');
    await screen.findByText(fa.shop.pay.counterTitle);
    expect(document.querySelector('[data-testid="shop-whitelabel-ready"]')).toBeNull();

    mockFetchReadiness.mockResolvedValue({ whitelabelConfigured: true, at: Date.now() });
    cleanup();
    renderShop('/shop?tab=pay');
    await waitFor(() => {
      expect(document.querySelector('[data-testid="shop-whitelabel-ready"]')).toBeTruthy();
    });
    /* still no dead form: no <select>, no date input, no order fields */
    expect(document.querySelector('select')).toBeNull();
    expect(document.querySelector('input[type="date"]')).toBeNull();
  });

  it('the Web3 identity card checks shape, prices .eth by the published ladder, and routes the coin to our swap', async () => {
    renderShop('/shop');
    await screen.findByText(fa.shop.web3id.title);
    const input = screen.getByLabelText(fa.shop.web3id.checkLabel);

    fireEvent.change(input, { target: { value: 'ab' } });
    expect(document.querySelector('.shop-web3id-verdict[data-tone="bad"], .shop-web3id-verdict[data-tone="warn"]')).toBeTruthy();

    fireEvent.change(input, { target: { value: 'My-Name.eth' } });
    /* normalised: my-name, 7 chars → the $5/yr tier of the published ladder */
    await waitFor(() => expect(document.body.textContent).toContain('$5 / yr'));

    fireEvent.change(input, { target: { value: 'bad name!' } });
    expect(document.body.textContent).toContain(fa.shop.web3id.err.chars);

    fireEvent.change(input, { target: { value: 'ali' } });
    fireEvent.click(screen.getByRole('button', { name: new RegExp(fa.shop.web3id.buyEth) }));
    await waitFor(() => {
      expect(screen.getByTestId('route-probe').textContent).toBe('/swap?to=ETH&chain=1');
    });
  });

  it('the .sol tab refuses a 40-char label with the length rule, not a fake verdict', async () => {
    renderShop('/shop');
    await screen.findByText(fa.shop.web3id.title);
    fireEvent.click(screen.getByRole('button', { name: '.sol' }));
    const input = screen.getByLabelText(fa.shop.web3id.checkLabel);
    fireEvent.change(input, { target: { value: 'x'.repeat(40) } });
    await waitFor(() => expect(document.body.textContent).toContain(fa.shop.web3id.err.too_long));
  });
});
