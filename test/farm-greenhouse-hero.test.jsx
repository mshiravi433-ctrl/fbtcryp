// @vitest-environment jsdom
/**
 * THE GREENHOUSE CONSOLE — the three instruments added to the Farm hero.
 *
 * «یک صفحهٔ بی‌نظیر بساز» is a design brief, but the parts that can lie are not
 * decorative: the yield field, the risk mix and the filter counts are all
 * readouts, and a readout that drifts from the list it summarises is worse than
 * no readout at all. So this file pins the three laws the design rests on:
 *
 *   1. THE FIELD IS THE TOP FIVE REAL RATES. Order is descending, the tallest
 *      bar is the highest rate (scaled against its own maximum), and the field
 *      does not exist at all below three usable rows.
 *
 *   2. THE MIX AND THE CHIPS COUNT THE SAME ROWS THE LIST SHOWS. One predicate
 *      (`passesCategoryFilter`) feeds the row filter and the chip badges, so a
 *      chip can never promise twelve and render nine.
 *
 *   3. NOTHING IS INVENTED WHEN THE FEED IS EMPTY. No field, no mix, and the
 *      average stat stays an em-dash.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import en from '../src/i18n/locales/en.json';

const t = (key, values = {}) => {
  const text = key.split('.').reduce((o, k) => o?.[k], en) ?? values.defaultValue ?? key;
  return String(text).replace(/\{\{(\w+)\}\}/g, (_, k) => values[k] ?? '');
};
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t, i18n: { language: 'en' } }) }));
vi.mock('../src/context/WalletContext', () => ({ useWallet: () => ({ isConnected: false, chainId: 8453 }) }));
vi.mock('../src/context/TelegramContext', () => ({ useTelegram: () => ({ haptic: () => {} }) }));
vi.mock('../src/hooks/useHideBalances', () => ({ useHideBalances: () => {} }));
vi.mock('../src/components/AdBanner', () => ({ default: () => null }));
vi.mock('../src/components/Farm/AaveBaseUsdcPanel', () => ({ default: () => null }));
vi.mock('../src/components/Farm/AaveArbUsdcPanel', () => ({ default: () => null }));
vi.mock('../src/components/Farm/CompoundBaseUsdcPanel', () => ({ default: () => null }));
vi.mock('../src/components/Farm/LidoPanel', () => ({ default: () => null }));
vi.mock('../src/components/Farm/MorphoBaseUsdcPanel', () => ({ default: () => null }));
vi.mock('../src/lib/solanaAssetsClient', async (original) => ({ ...await original(), getSolanaAssets: async () => ({ lst: [] }) }));
vi.mock('framer-motion', () => {
  const components = new Map();
  return {
    motion: new Proxy({}, { get: (_, tag) => {
      if (!components.has(tag)) components.set(tag, ({ children, ...props }) => {
        const Tag = String(tag);
        const clean = Object.fromEntries(Object.entries(props).filter(([key]) => !['initial', 'animate', 'exit', 'transition', 'whileTap', 'whileHover', 'layout', 'layoutId', 'variants'].includes(key)));
        return <Tag {...clean}>{children}</Tag>;
      });
      return components.get(tag);
    } }),
    AnimatePresence: ({ children }) => children,
    useReducedMotion: () => true
  };
});

import Farm from '../src/pages/Farm';
import { FARM_YIELDS_CACHE_KEY } from '../src/hooks/useFarmYields';
import { useSettingsStore } from '../src/store/useSettingsStore.js';

const base = { apr: null, apyReward: 0, ilRisk: false, exposure: 'single', source: 'defillama' };
const pools = [
  { ...base, id: '11111111-1111-4111-8111-111111111111', project: 'aave-v3', chain: 'Base', symbol: 'USDC', apy: 4.62, apyBase: 4.62, tvlUsd: 620_000_000, stablecoin: true, risk: 'low' },
  { ...base, id: '22222222-2222-4222-8222-222222222222', project: 'uniswap-v3', chain: 'Base', symbol: 'USDC-WETH', apy: 22, apyBase: 11, apyReward: 11, tvlUsd: 48_000_000, risk: 'high', exposure: 'multi', ilRisk: true },
  { ...base, id: '33333333-3333-4333-8333-333333333333', project: 'pendle', chain: 'Ethereum', symbol: 'USDe', apy: 11.2, apyBase: 11.2, tvlUsd: 780_000_000, stablecoin: true, risk: 'medium' },
  { ...base, id: '44444444-4444-4444-8444-444444444444', project: 'lido', chain: 'Ethereum', symbol: 'STETH', apy: 3.12, apyBase: 3.12, tvlUsd: 14_600_000_000, risk: 'low' },
  { ...base, id: '55555555-5555-4555-8555-555555555555', project: 'curve-dex', chain: 'Arbitrum', symbol: 'USDC-USDT', apy: 8.34, apyBase: 8.34, tvlUsd: 155_000_000, stablecoin: true, risk: 'low', exposure: 'multi' },
  { ...base, id: '66666666-6666-4666-8666-666666666666', project: 'spark', chain: 'Ethereum', symbol: 'DAI', apy: 5.02, apyBase: 5.02, tvlUsd: 88_000_000, stablecoin: true, risk: 'low' }
];

const json = (data) => new Response(JSON.stringify(data));
const feed = (rows = pools) => ({ pools: rows, venues: [], venuesMissing: [], at: Date.now(), freshness: 'FRESH', source: 'defillama', considered: rows.length, passed: rows.length });
const history = (id) => ({ pool: id, points: [{ timestamp: Date.now() - 86_400_000, apy: 4, tvlUsd: 1_000_000 }], at: Date.now(), freshness: 'FRESH' });
const mount = () => render(<MemoryRouter initialEntries={['/farm?tab=recommended']}><Farm /></MemoryRouter>);

beforeEach(() => {
  localStorage.removeItem(FARM_YIELDS_CACHE_KEY);
  useSettingsStore.getState().setFarmWatchlist([]);
  Element.prototype.scrollIntoView = vi.fn();
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => json(String(url).includes('/history') ? history() : feed()));
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('the greenhouse hero reads the feed honestly', () => {
  it('draws the top five rates, highest first, scaled against the top one', async () => {
    const { container } = mount();
    await waitFor(() => expect(container.querySelectorAll('.farm-hero-field-col')).toHaveLength(5));
    const values = [...container.querySelectorAll('.farm-hero-field-val')].map((node) => node.textContent);
    expect(values).toEqual(['22%', '11.2%', '8.34%', '5.02%', '4.62%']);
    const bars = [...container.querySelectorAll('.farm-hero-field-col')].map((node) => node.style.getPropertyValue('--bar'));
    expect(bars[0]).toBe('100%');
    expect(Number(bars[1].replace('%', ''))).toBeLessThan(100);
    // …and the plot says what it is, so a screen reader gets the same claim.
    expect(screen.getByRole('img', { name: t('farm.heroFieldAria', { count: 5 }) })).toBeTruthy();
  });

  it('counts the risk mix from the same rows', async () => {
    const { container } = mount();
    await waitFor(() => expect(container.querySelector('.farm-hero-mix')).toBeTruthy());
    const legend = [...container.querySelectorAll('.farm-hero-mix-legend > span')].map((node) => node.textContent);
    // 4 low · 1 medium · 1 high in the fixture
    expect(legend[0]).toContain('4');
    expect(legend[1]).toContain('1');
    expect(legend[2]).toContain('1');
  });

  it('badges every category chip with the count the list will render', async () => {
    const { container } = mount();
    await waitFor(() => expect(container.querySelectorAll('.farm-filter-count').length).toBeGreaterThan(8));
    const chip = (label) => [...container.querySelectorAll('.farm-secondary-filters .tag')]
      .find((node) => node.textContent.includes(t(`farm.category.${label}`)));
    expect(chip('all').querySelector('.farm-filter-count').textContent).toBe('6');
    expect(chip('stable').querySelector('.farm-filter-count').textContent).toBe('4');
    expect(chip('highYield').querySelector('.farm-filter-count').textContent).toBe('1');
    expect(chip('lowRisk').querySelector('.farm-filter-count').textContent).toBe('4');
    expect(chip('vault').querySelector('.farm-filter-count').textContent).toBe('0');
  });

  it('invents nothing when the feed is empty', async () => {
    fetch.mockImplementation(async () => json(feed([])));
    const { container } = mount();
    await waitFor(() => expect(container.querySelector('.farm-hero-premium')).toBeTruthy());
    expect(container.querySelector('.farm-hero-field')).toBeNull();
    expect(container.querySelector('.farm-hero-mix')).toBeNull();
    expect(container.querySelectorAll('.farm-hero-stat-value')[1].textContent).toBe('—');
  });

  it('prints the same quality score as a meter under the ticker', async () => {
    const { container } = mount();
    await waitFor(() => expect(container.querySelector('.farm-page .farm-pool')).toBeTruthy());
    const meters = container.querySelectorAll('.farm-pool-meter > i');
    expect(meters.length).toBeGreaterThan(0);
    for (const meter of meters) {
      const width = Number(meter.style.width.replace('%', ''));
      expect(width).toBeGreaterThanOrEqual(4);
      expect(width).toBeLessThanOrEqual(100);
    }
  });
});
