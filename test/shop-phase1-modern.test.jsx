// @vitest-environment jsdom
/**
 * SHOP PHASE 1 — Modern Storefront, Use-Case Hub, Smart Wallet Checkout & FBT Pay
 * ---------------------------------------------------------------------------
 * Integration tests covering all four Phase 1 pillars on `/shop`:
 *   1. Quick Region Bar (`US`, `TR`, `AE`, `GB`, `DE` + All countries),
 *      regional Best-Sellers rail, Pinned Favorites (`localStorage`), and
 *      Quick Budget chips (`all`, `10`, `25`, `50`, `100`).
 *   2. Smart Brand Purchase Sheet: `USDC`/`USDT` pricing toggle, selectable
 *      denominations, connected wallet balance shortfall calculation, and
 *      1-click internal Swap CTA (`/swap` on EVM, `/solana` on Solana).
 *   3. Use-Case Hub (6 crypto verticals + localized Persian guidance) and
 *      Travel (`flights` & `stays`) eSIM + payment card cross-sell without
 *      any date inputs.
 *   4. Merchant Payment Gateway (`FBT Pay` / `pay` tab) mounting
 *      `PayGatewayPanel` cleanly inside `/shop`.
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
  return String(text).replace(/\{\{(\w+)\}\}/g, (_, k) => values[k] ?? '');
};

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t, i18n: { language, resolvedLanguage: language, changeLanguage: vi.fn() } }),
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
  getBalances: vi.fn(async () => ({ USDC: '12.5', USDT: '90' }))
}));

vi.mock('../src/store/useAppStore', () => ({
  useAppStore: (sel) =>
    sel({
      ensureRefCode: () => 'FBTREF99',
      addToast: () => {}
    })
}));

const mockShare = vi.fn(async () => ({ ok: true }));
vi.mock('../src/hooks/useShare', () => ({
  useShare: () => [mockShare, () => null]
}));

const mockOpenUrl = vi.fn();
vi.mock('../src/lib/browser', () => ({
  openUrl: (...args) => mockOpenUrl(...args)
}));

let storedCountry = '';
const mockFetchProducts = vi.fn();

const CATALOGUE_ROWS = [
  {
    id: 'b-steam',
    family: 'Steam',
    name: 'Steam',
    logo: null,
    bg: '#1b2838',
    category: 'games',
    tags: ['games'],
    kind: 'giftcard',
    min: '$10',
    max: '$100',
    outOfStock: false,
    country: 'US'
  },
  {
    id: 'b-rewarble',
    family: 'Rewarble',
    name: 'Rewarble Visa',
    logo: null,
    bg: '#102a43',
    category: 'e-money',
    tags: ['e-money'],
    kind: 'giftcard',
    min: '$20',
    max: '$200',
    outOfStock: false,
    country: 'US'
  },
  {
    id: 'b-apple',
    family: 'Apple',
    name: 'Apple Gift Card',
    logo: null,
    bg: '#111827',
    category: 'e-commerce',
    tags: ['e-commerce'],
    kind: 'giftcard',
    min: '$15',
    max: '$500',
    outOfStock: false,
    country: 'US'
  },
  {
    id: 'b-lux',
    family: 'Boutique',
    name: 'Boutique Luxury',
    logo: null,
    bg: '#312e81',
    category: 'retail',
    tags: ['retail'],
    kind: 'giftcard',
    min: '$75',
    max: '$500',
    outOfStock: false,
    country: 'US'
  }
];

vi.mock('../src/lib/shop', async (original) => ({
  ...(await original()),
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
    rows: CATALOGUE_ROWS,
    categories: [
      { id: 'e-money', count: 1 },
      { id: 'games', count: 1 },
      { id: 'e-commerce', count: 1 },
      { id: 'retail', count: 1 }
    ],
    live: true
  }),
  fetchShopProducts: (...args) => mockFetchProducts(...args),
  getShopCountry: () => storedCountry,
  setShopCountry: (cc) => { storedCountry = cc; }
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
        <Route path="/solana" element={<RouteProbe />} />
      </Routes>
    </MemoryRouter>
  );
}

beforeEach(() => {
  language = 'fa';
  storedCountry = '';
  localStorage.clear();
  mockOpenUrl.mockClear();
  mockShare.mockClear();
  mockWalletState = { isConnected: false, address: null, chainId: 1, getReadProvider: null };
  mockSolState = { address: null };
  mockFetchProducts.mockImplementation(async (_cc, _fam, opts = {}) => {
    const coin = opts?.coin === 'USDT' ? 'USDT' : 'USDC';
    return {
      rows: [
        { id: 'd20', label: '$20', coinAmount: coin === 'USDT' ? 21.6 : 21.5, coin, spreadPct: 7.5 },
        { id: 'd50', label: '$50', coinAmount: coin === 'USDT' ? 53.95 : 53.86, coin, spreadPct: 7.7 }
      ],
      bestSpreadPct: 7.5,
      pricingCoin: coin,
      brand: 'Steam',
      logo: null,
      note: 'Region locked to US accounts.',
      howTo: 'Redeem in Steam Wallet.',
      contentLocale: 'en',
      outOfStock: false,
      live: true
    };
  });
});

afterEach(() => cleanup());

describe('Shop Phase 1 — modern storefront, Use-Case Hub, wallet shortfall & FBT Pay', () => {
  it('shows the Quick Region Bar when no country is chosen and switches region in one click', async () => {
    renderShop('/shop');

    expect(screen.getByText(fa.shop.pickCountry)).toBeTruthy();
    const trPill = screen.getByRole('button', { name: /ترکیه/ });
    fireEvent.click(trPill);

    expect(storedCountry).toBe('TR');
    await waitFor(() => expect(screen.getByText(fa.shop.featured.title)).toBeTruthy());
  });

  it('pins favorite brands to localStorage and filters by Use-Case Hub & Quick Budget chips', async () => {
    storedCountry = 'US';
    renderShop('/shop');

    await waitFor(() => expect(screen.getByText(fa.shop.useCase.title)).toBeTruthy());

    /* Pin Rewarble Visa and verify it appears in the Pinned Brands section */
    const pinButtons = screen.getAllByRole('button', { name: /Rewarble Visa/i })
      .filter((b) => b.classList.contains('shop-pin-btn'));
    fireEvent.click(pinButtons[0]);

    expect(screen.getByText(fa.shop.fav.sectionTitle)).toBeTruthy();
    expect(JSON.parse(localStorage.getItem('fbt.shop.favorites.v1'))).toContain('rewarble');

    /* Click AI Use-Case Hub card -> shows localized Persian guide & compatible cards */
    fireEvent.click(screen.getByRole('button', { name: /هوش مصنوعی/ }));
    expect(screen.getByText(fa.shop.useCase.ai.guide)).toBeTruthy();
    expect(screen.queryByText('Boutique Luxury')).toBeNull();

    /* Reset Use-Case and apply Budget "تا ۱۰$" -> keeps Steam ($10), hides $20+ brands */
    fireEvent.click(screen.getAllByText(fa.shop.useCase.clear)[0]);
    fireEvent.click(screen.getByRole('button', { name: fa.shop.budget.tier_10 }));

    expect(screen.getAllByText('Steam').length).toBeGreaterThan(0);
    expect(screen.queryByText('Boutique Luxury')).toBeNull();
  });

  it('switches USDC/USDT pricing, computes connected wallet shortfall, and routes 1-click to /swap', async () => {
    storedCountry = 'US';
    mockWalletState = {
      isConnected: true,
      address: '0x1111111111111111111111111111111111111111',
      chainId: 42161,
      getReadProvider: () => ({})
    };

    renderShop('/shop');
    const steamTiles = await screen.findAllByText('Steam');
    fireEvent.click(steamTiles[0].closest('button'));

    await waitFor(() => expect(screen.getByText('$50')).toBeTruthy());

    /* Select the $50 denomination -> costs 53.86 USDC, wallet has 12.5 USDC -> shortfall 41.36 USDC */
    fireEvent.click(screen.getByText('$50').closest('button'));
    await waitFor(() => {
      expect(document.body.textContent).toContain('41.36');
    });

    /* Switch pricing coin to USDT -> triggers fetchShopProducts with coin: 'USDT' */
    fireEvent.click(screen.getByRole('button', { name: 'USDT' }));
    await waitFor(() => {
      expect(mockFetchProducts).toHaveBeenCalledWith('US', 'Steam', expect.objectContaining({ coin: 'USDT' }));
    });

    /* Switch back to USDC and click 1-click internal Swap shortfall CTA */
    fireEvent.click(screen.getByRole('button', { name: 'USDC' }));
    await waitFor(() => expect(document.body.textContent).toContain('41.36'));

    const swapCta = document.querySelector('.shop-swap-cta');
    expect(swapCta).toBeTruthy();
    fireEvent.click(swapCta);

    await waitFor(() => {
      const target = screen.getByTestId('route-probe').textContent;
      expect(target).toBe('/swap?chain=42161&from=USDT&to=USDC&amount=41.36');
    });
  });

  it('renders travel eSIM & payment card cross-sell in flights/stays without date inputs, and mounts FBT Pay tab', async () => {
    storedCountry = 'AE';
    renderShop('/shop');
    await screen.findByText(fa.shop.featured.title);

    /* Open Flights tab */
    fireEvent.click(screen.getByRole('tab', { name: fa.shop.tab.flights }));
    expect(screen.getByText(fa.shop.travelCross.title)).toBeTruthy();
    expect(document.querySelector('input[type="date"]')).toBeNull();

    /* Clicking travel eSIM CTA calls openUrl with attributed Cryptorefills eSIM link */
    fireEvent.click(screen.getByRole('button', { name: fa.shop.travelCross.esimCta }));
    expect(mockOpenUrl).toHaveBeenCalledWith(expect.stringContaining('cryptorefills.com'));

    /* Open 6th tab: FBT Pay (`درگاه پرداخت`) -> mounts PayGatewayPanel */
    fireEvent.click(screen.getByRole('tab', { name: fa.shop.tab.pay }));
    expect(screen.getByText(fa.shop.pay.heroTitle)).toBeTruthy();
    await waitFor(() => {
      expect(document.querySelector('.pay-gw')).toBeTruthy();
    });
  });
});
