// @vitest-environment jsdom
/**
 * Insurance UI render probe (run: `npm run test:insurance-ui`, part of
 * `npm run test:insurance`).
 *
 * The HTTP half of the product-selector fix lives in
 * insurance-marketplace-probe.mjs (real router, real adapters). This file
 * covers the half that only a rendered tree can prove:
 *
 *   • every insurance route mounts inside the shell with the Persian bundle
 *     and no React error, exactly one transparency accordion, no emoji;
 *   • marketplace: products load for the wallet's chain, are filtered by the
 *     selected protection type, the chosen product's details (min price,
 *     grace period, cover assets, terms/annex links, exclusions) are shown
 *     BEFORE quoting, and the quote request carries `productId`;
 *   • a chain with no LIVE product says so honestly, and a PRODUCT_REQUIRED
 *     answer from the server renders the new copy;
 *   • the tab rail keeps its tablist contract and every tab has an SVG icon.
 *
 * Only framework plumbing is stubbed (i18n, wallet context, framer-motion) and
 * the network client — the pages, icons, shell and ModernSelect are real.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import fa from '../../src/i18n/locales/fa.json';
import en from '../../src/i18n/locales/en.json';

const dict = { fa, en };
let LANG = 'fa';
const get = (obj, path) => path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
const tFor = (lang) => (key, opts = {}) => {
  let v = get(dict[lang], key);
  if (v == null && opts.count != null) v = get(dict[lang], key + '_other') ?? get(dict[lang], key + '_one');
  if (v == null) v = get(dict.en, key) ?? (opts.count != null ? get(dict.en, key + '_other') : undefined);
  if (v == null) return opts.defaultValue ?? key;
  return String(v).replace(/\{\{(\w+)\}\}/g, (_, k) => String(opts[k] ?? ''));
};
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: tFor(LANG), i18n: { language: LANG, changeLanguage: () => {} } }) }));

const PRODUCTS_1 = [
  { id: 'nexus-97', providerProductId: '97', kind: 'lending', name: 'Aave v3', label: 'Aave v3', productTypeName: 'Single Protocol Cover', supportedChains: [1], coverAssets: [{ assetId: 0, symbol: 'ETH' }, { assetId: 6, symbol: 'USDC' }], minPrice: 50, gracePeriodDays: 35, claimMethod: 'nexus-assessment', claimMembershipRequired: true, exclusions: ['Losses caused by oracle manipulation'], annexUrl: 'https://app.nexusmutual.io/cover/product/97/annex', termsUrl: 'https://app.nexusmutual.io/cover/product/97/cover-wording', providerId: 'nexus-mutual', providerName: 'Nexus Mutual', providerStatus: 'LIVE' },
  { id: 'nexus-118', providerProductId: '118', kind: 'lending', name: 'Compound v3', supportedChains: [1], coverAssets: [{ assetId: 6, symbol: 'USDC' }], minPrice: 100, gracePeriodDays: 35, providerId: 'nexus-mutual', providerName: 'Nexus Mutual', providerStatus: 'LIVE' },
  { id: 'nexus-72', providerProductId: '72', kind: 'smart-contract', name: 'Uniswap v3', supportedChains: [1], coverAssets: [{ assetId: 6, symbol: 'USDC' }], minPrice: 50, gracePeriodDays: 35, providerId: 'nexus-mutual', providerName: 'Nexus Mutual', providerStatus: 'LIVE' }
];
const calls = { quote: [] };
vi.mock('../../src/lib/insuranceClient.js', () => ({
  usd: (m) => String(Number(m || 0) / 1e6),
  insuranceApi: {
    providers: async () => [{ providerId: 'nexus-mutual', name: 'Nexus Mutual', displayName: 'Nexus Mutual', status: 'LIVE', enabled: true, configured: true, healthStatus: 'HEALTHY', supportedChains: [1], settlementModel: 'DIRECT' }],
    products: async (chainId) => (Number(chainId) === 1 ? PRODUCTS_1 : []),
    quote: async (body) => { calls.quote.push(body); return body.productId ? { ok: true, data: { quotes: [{ quoteId: 'q-1', provider: 'nexus-mutual', providerName: 'Nexus Mutual', providerHealth: 'HEALTHY', productId: body.productId, product: { id: body.productId, name: 'Aave v3' }, protectionType: body.protectionType, durationDays: body.durationDays, coverageAmountMicro: '10000000000', premiumUsd: '12.00', fbtFeeUsd: '0.12', totalCostUsd: '12.12', settlementModel: 'DIRECT', claimMethod: 'nexus-assessment', termsHash: 'abcdef1234567890abcdef1234567890', quoteSource: 'provider-api', sandbox: false }] }, warnings: [] } : { ok: false, errors: [{ code: 'NO_ELIGIBLE_PROTECTION' }], warnings: ['LIVE_QUOTE_NOT_AVAILABLE'], data: { detail: [{ providerId: 'nexus-mutual', reason: 'PRODUCT_REQUIRED' }] } }; },
    capabilities: async () => ({ ok: true }), events: async () => [], coverage: async () => ({ summary: { totalProtectedUsd: '0', activeCovers: 0, totalPremiumUsd: '0', active: [] }, coverages: [] }),
    claims: async () => ({ claims: [] }), quoteById: async () => ({ ok: true, data: { quote: { quoteId: 'q-1', protectionType: 'lending', product: { name: 'Aave v3' }, coverageAmountMicro: '10000000000', durationDays: 28, premiumUsd: '12', fbtFeeUsd: '0.12', fbtFeeMicro: '120000', networkFeeUsd: '0', totalCostUsd: '12.12', providerName: 'Nexus Mutual', currency: 'usdc', claimMethod: 'nexus-assessment', quoteSource: 'provider-api', exclusions: ['x'], termsUrl: 'https://t', annexUrl: 'https://a', chainId: 1 } } })
  }
}));
vi.mock('../../src/context/WalletContext', () => ({ useWallet: () => ({ isConnected: true, address: '0x1111111111111111111111111111111111111111', chainId: 1, chain: { short: 'ETH' }, disconnect: () => {}, switchChain: async () => true, getEip1193Provider: () => null, getSigner: () => null, mode: 'injected' }) }));
vi.mock('framer-motion', () => ({ motion: new Proxy({}, { get: (_, tag) => ({ children, ...p }) => { const T = String(tag); const clean = Object.fromEntries(Object.entries(p).filter(([k]) => !['initial','animate','exit','transition','whileTap','whileHover','layout','layoutId','variants'].includes(k))); return <T {...clean}>{children}</T>; } }), AnimatePresence: ({ children }) => <>{children}</>, useReducedMotion: () => true }));

import InsuranceShell from '../../src/pages/insurance/InsuranceShell.jsx';
import InsuranceMarketplace from '../../src/pages/insurance/InsuranceMarketplace.jsx';
import InsuranceDashboard from '../../src/pages/insurance/InsuranceDashboard.jsx';
import InsuranceCoverage from '../../src/pages/insurance/InsuranceCoverage.jsx';
import InsuranceClaims from '../../src/pages/insurance/InsuranceClaims.jsx';
import InsuranceRisk from '../../src/pages/insurance/InsuranceRisk.jsx';
import InsuranceProviders from '../../src/pages/insurance/InsuranceProviders.jsx';
import InsuranceQuote from '../../src/pages/insurance/InsuranceQuote.jsx';
import InsuranceSettings from '../../src/pages/insurance/InsuranceSettings.jsx';

const mount = (path) => render(
  <MemoryRouter initialEntries={[path]}>
    <Routes>
      <Route path="/insurance" element={<InsuranceShell />}>
        <Route index element={<InsuranceDashboard />} />
        <Route path="marketplace" element={<InsuranceMarketplace />} />
        <Route path="coverage" element={<InsuranceCoverage />} />
        <Route path="claims" element={<InsuranceClaims />} />
        <Route path="risk" element={<InsuranceRisk />} />
        <Route path="providers" element={<InsuranceProviders />} />
        <Route path="quote/:quoteId" element={<InsuranceQuote />} />
        <Route path="settings" element={<InsuranceSettings />} />
      </Route>
    </Routes>
  </MemoryRouter>
);
afterEach(cleanup);

describe('insurance pages render (fa, RTL strings) without crashing', () => {
  for (const p of ['/insurance', '/insurance/coverage', '/insurance/claims', '/insurance/risk', '/insurance/providers', '/insurance/quote/q-1', '/insurance/settings']) {
    it(`renders ${p}`, async () => {
      const errs = []; const orig = console.error; console.error = (...a) => { errs.push(a.join(' ')); };
      const { container } = mount(p);
      await waitFor(() => expect(container.querySelector('[role="tablist"]')).toBeTruthy());
      await new Promise((r) => setTimeout(r, 50));
      console.error = orig;
      const real = errs.filter((e) => !/act\(|not wrapped/.test(e));
      expect(real, real.join('\n')).toEqual([]);
      expect(container.querySelectorAll('details.ins-explain').length).toBe(1);
      expect(container.textContent).not.toMatch(/[\u{1F300}-\u{1FAFF}]/u);
    });
  }
});

describe('marketplace: select product → quote with productId', () => {
  it('loads products for chain 1, filters by kind, shows details, sends productId', async () => {
    const { container } = mount('/insurance/marketplace?type=lending');
    await waitFor(() => expect(container.querySelector('[data-testid="ins-product-select"]')).toBeTruthy());
    // 2 lending products → nothing preselected; CTA disabled; hint shown
    const cta = container.querySelector('button.ins-cta');
    expect(cta.disabled).toBe(true);
    expect(container.textContent).toContain(fa.insurance.market.productRequiredHint);
    // open the sheet and pick Aave v3
    fireEvent.click(container.querySelector('[data-testid="ins-product-select"] .modern-select-trigger'));
    const opt = await screen.findByText('Aave v3', { selector: '.modern-select-opt-label' });
    fireEvent.click(opt.closest('button'));
    await waitFor(() => expect(container.querySelector('[data-testid="ins-product-details"]')).toBeTruthy());
    const details = container.querySelector('[data-testid="ins-product-details"]').textContent;
    expect(details).toContain('0.5'); // minPrice 50 bps → 0.5 %
    expect(details).toContain('35'); // grace period
    expect(details).toContain('USDC');
    expect(details).toContain('Losses caused by oracle manipulation');
    expect(container.querySelector('a[href="https://app.nexusmutual.io/cover/product/97/annex"]')).toBeTruthy();
    expect(container.querySelector('a[href="https://app.nexusmutual.io/cover/product/97/cover-wording"]')).toBeTruthy();
    expect(cta.disabled).toBe(false);
    fireEvent.click(cta);
    await waitFor(() => expect(calls.quote.length).toBe(1));
    expect(calls.quote[0].productId).toBe('nexus-97');
    expect(calls.quote[0].protectionType).toBe('lending');
    expect(calls.quote[0].durationDays).toBe(28);
    await waitFor(() => expect(container.textContent).toContain('12.12'));
  });
  it('single product of a kind is preselected; switching type clears an incompatible selection', async () => {
    const { container } = mount('/insurance/marketplace?type=smart-contract');
    await waitFor(() => expect(container.querySelector('[data-testid="ins-product-details"]')).toBeTruthy());
    expect(container.textContent).toContain('Uniswap v3');
    // switch to a type that has no products on chain 1 → honest empty state
    const bridge = [...container.querySelectorAll('.ins-type')].find((b) => b.textContent.includes(fa.insurance.types.bridge));
    fireEvent.click(bridge);
    await waitFor(() => expect(container.textContent).toContain(fa.insurance.market.noProductsForType));
    expect(container.querySelector('[data-testid="ins-product-details"]')).toBeFalsy();
  });
  it('a network with no LIVE product shows «برای این شبکه محصولی موجود نیست»', async () => {
    const { container } = mount('/insurance/marketplace?type=lending&chain=56');
    await waitFor(() => expect(container.textContent).toContain('برای این شبکه محصولی موجود نیست'));
    expect(container.querySelector('[data-testid="ins-product-select"]')).toBeFalsy();
    expect(container.querySelector('button.ins-cta').disabled).toBe(false); // nothing to select → server answers honestly
  });
  it('PRODUCT_REQUIRED from the server renders the new fa copy', async () => {
    calls.quote.length = 0;
    const { container } = mount('/insurance/marketplace?type=lending&chain=56');
    await waitFor(() => expect(container.textContent).toContain('برای این شبکه محصولی موجود نیست'));
    fireEvent.click(container.querySelector('button.ins-cta'));
    await waitFor(() => expect(container.textContent).toContain('ابتدا پروتکل مورد بیمه را انتخاب کنید'));
  });
});

describe('shell tab rail', () => {
  it('has tablist + 6 tabs with icons + arrows wrapper', async () => {
    const { container } = mount('/insurance');
    await waitFor(() => expect(container.querySelector('[role="tablist"]')).toBeTruthy());
    const rail = container.querySelector('.ins-tabs[role="tablist"]');
    expect(rail.getAttribute('aria-label')).toBe(fa.insurance.tabs.ariaLabel);
    expect(rail.querySelectorAll('a.ins-tab').length).toBe(6);
    expect(rail.querySelectorAll('a.ins-tab .ins-tab-ico svg').length).toBe(6);
    expect(container.querySelector('.ins-tabs-wrap')).toBeTruthy();
    expect(container.querySelector('.ins-tabs-wrap').getAttribute('data-edge-end')).toBeDefined();
    expect(container.querySelector('a.ins-tab.active')).toBeTruthy();
  });
});
