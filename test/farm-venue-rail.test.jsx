// @vitest-environment jsdom
/**
 * THE FIVE VENUES AT THE TOP OF THE FARM SCREEN.
 *
 * «در صفحه فارم ۵ تا شبکه داریم که هر کدام باید بالای صفحه قرار بگیرند داخل
 * باکس مدرن‌تر؛ وقتی روش می‌زنی تحلیل و نمودار بالاترین و کمترین باشد.»
 *
 * Three properties are pinned here, because each one is a way the feature can
 * look finished and be wrong:
 *
 *   1. THE RAIL AND THE EXECUTION HUB ARE THE SAME FIVE VENUES. The rail is
 *      derived from `FARM_EXECUTION_ADAPTERS`, so a venue can never be
 *      advertised for analysis that the app cannot execute — and a sixth
 *      adapter appears in both places at once.
 *
 *   2. THE RAIL IS ABOVE EVERYTHING ELSE. It used to be five collapsed rows
 *      inside the «داخل اپ» tab, i.e. below the status card, the feed controls
 *      and the tab rail. «بالای صفحه» is the requirement, so it is asserted as
 *      DOM ORDER rather than as presence.
 *
 *   3. «بالاترین و کمترین» ARE REAL NUMBERS OR THEY ARE ABSENT. Opened on a
 *      venue, the drawer must name the highest and the lowest rate on that
 *      network — and when there is no history and no spread to draw, it must
 *      say so instead of rendering a decorative bar chart. The last test
 *      drives exactly that case.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import en from '../src/i18n/locales/en.json';
import fa from '../src/i18n/locales/fa.json';

let language = 'en';
const t = (key, values = {}) => {
  const dict = language === 'fa' ? fa : en;
  const text = key.split('.').reduce((o, k) => o?.[k], dict) ?? values.defaultValue ?? key;
  return String(text).replace(/\{\{(\w+)\}\}/g, (_, k) => values[k] ?? '');
};
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t, i18n: { language } }) }));
vi.mock('../src/context/WalletContext', () => ({ useWallet: () => ({ isConnected: false, chainId: 8453 }) }));
vi.mock('../src/context/TelegramContext', () => ({ useTelegram: () => ({ haptic: () => {} }) }));
vi.mock('../src/hooks/useHideBalances', () => ({ useHideBalances: () => {} }));
vi.mock('../src/components/AdBanner', () => ({ default: () => null }));
// The five transaction panels have their own suites; here only the rail and
// the hub's row ids matter.
vi.mock('../src/components/Farm/AaveBaseUsdcPanel', () => ({ default: () => null }));
vi.mock('../src/components/Farm/AaveArbUsdcPanel', () => ({ default: () => null }));
vi.mock('../src/components/Farm/CompoundBaseUsdcPanel', () => ({ default: () => null }));
vi.mock('../src/components/Farm/LidoPanel', () => ({ default: () => null }));
vi.mock('../src/components/Farm/MorphoBaseUsdcPanel', () => ({ default: () => null }));
/*
 * The in-app tab's two extra sections. The equity rows below are the shape
 * `/api/solana/assets` really returns (issuer-verified, with liquidity and a
 * 24h move), and the depth is deliberately above MIN_EQUITY_LIQUIDITY so the
 * same gate the /stocks screen applies is the gate under test.
 */
vi.mock('../src/lib/solanaAssetsClient', async (original) => ({
  ...await original(),
  getSolanaAssets: async () => ({
    lst: [],
    equities: [
      { id: 'nvdax', mint: 'Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh', symbol: 'NVDAx', name: 'NVIDIA', kind: 'equity', liquidity: 1_200_000, change24h: 1.4 },
      { id: 'hoodx', mint: 'XsvNBAYkrDRNhA7wPHQfX3ZUXZyZLdnCQDfHZ56bzpg', symbol: 'HOODx', name: 'Robinhood', kind: 'equity', liquidity: 480_000, change24h: -0.8 }
    ]
  })
}));
vi.mock('framer-motion', () => {
  const components = new Map();
  return { motion: new Proxy({}, { get: (_, tag) => {
    if (!components.has(tag)) components.set(tag, ({ children, ...props }) => {
      const Tag = String(tag);
      const clean = Object.fromEntries(Object.entries(props).filter(([key]) => !['initial', 'animate', 'exit', 'transition', 'whileTap', 'whileHover', 'layout', 'layoutId', 'variants'].includes(key)));
      return <Tag {...clean}>{children}</Tag>;
    });
    return components.get(tag);
  } }), AnimatePresence: ({ children }) => children, useReducedMotion: () => true };
});

import Farm from '../src/pages/Farm';
import { FARM_VENUES, venuePosition } from '../src/components/Farm/VenueRail';
import { FARM_EXECUTION_ADAPTERS } from '../src/components/Farm/FarmPositionHub';

const base = { apyBase: 5, apyReward: 0, apr: null, tvlUsd: 500_000_000, stablecoin: true, ilRisk: false, risk: 'low', exposure: 'single', source: 'defillama' };
/* A UUID id on purpose: getYieldHistory() refuses anything else, and a
   fixture with a made-up id would silently test the ERROR branch. */
const aaveRow = { ...base, id: '11111111-1111-4111-8111-111111111111', project: 'aave-v3', chain: 'Base', symbol: 'USDC', apy: 5 };
const lidoRow = { ...base, id: 'lido-row', project: 'lido', chain: 'Ethereum', symbol: 'STETH', apy: 3.2, stablecoin: false };
const highRow = { ...base, id: 'high-row', project: 'uniswap-v3', chain: 'Base', symbol: 'USDC-WETH', apy: 22, risk: 'high', ilRisk: true, exposure: 'multi' };
const lowRow = { ...base, id: 'low-row', project: 'morpho-blue', chain: 'Base', symbol: 'DAI', apy: 1.4, stablecoin: true };

const json = (data) => new Response(JSON.stringify(data));
const feed = (pools) => ({ pools, at: Date.now(), freshness: 'FRESH', source: 'defillama', considered: pools.length });
const history = (pool) => ({
  pool,
  points: [
    { timestamp: Date.now() - 86_400_000 * 6, apy: 3.5, tvlUsd: 20_000_000 },
    { timestamp: Date.now() - 86_400_000 * 3, apy: 5.4, tvlUsd: 21_000_000 },
    { timestamp: Date.now(), apy: 4.9, tvlUsd: 22_000_000 }
  ],
  at: Date.now(),
  freshness: 'FRESH'
});

const mount = (tab = 'recommended') => render(<MemoryRouter initialEntries={[`/farm?tab=${tab}`]}><Farm /></MemoryRouter>);

beforeEach(() => {
  language = 'en';
  Element.prototype.scrollIntoView = vi.fn();
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(320);
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
    const href = String(url);
    if (href.endsWith('/history')) return json(history(aaveRow.id));
    return json(feed([aaveRow, lidoRow, highRow, lowRow]));
  });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('the venue rail at the top of Farm', () => {
  it('is the same five venues as the execution hub, in the same order', () => {
    expect(FARM_VENUES).toHaveLength(5);
    expect(FARM_VENUES.map((v) => v.id)).toEqual(FARM_EXECUTION_ADAPTERS.map((a) => a.id));
    for (const venue of FARM_VENUES) {
      expect(venue.chainId).toBeTruthy();
      expect(venue.product ?? null).toBeNull(); // a rail card carries no rate of its own
      expect(venue).not.toHaveProperty('apy');
    }
  });

  it('marks the venue position inside the spread only when the spread is real', () => {
    expect(venuePosition(5, 1, 9)).toBeCloseTo(0.5);
    expect(venuePosition(1, 1, 9)).toBe(0);
    expect(venuePosition(9, 1, 9)).toBe(1);
    // A flat or unknown spread has no position — the caller draws no marker.
    expect(venuePosition(5, 5, 5)).toBeNull();
    expect(venuePosition(5, 9, 1)).toBeNull();
    expect(venuePosition(null, 1, 9)).toBeNull();
    expect(venuePosition(5, null, null)).toBeNull();
  });

  it('renders above the feed controls and the tab rail', async () => {
    const { container } = mount();
    await waitFor(() => expect(container.querySelector('.farm-venue-rail')).toBeTruthy());
    const rail = container.querySelector('.farm-venue-box');
    const tabs = container.querySelector('.farm-tabs');
    const status = container.querySelector('.farm-protocol-card');
    expect(container.querySelectorAll('.farm-venue-card')).toHaveLength(5);
    // «بالای صفحه» — the box precedes the status card, the filters and the tabs.
    expect(rail.compareDocumentPosition(tabs) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(rail.compareDocumentPosition(status) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(container.querySelector('.farm-venue-box').textContent).toContain('5');
  });

  it.each(['en', 'fa'])('opens the analysis with the highest and the lowest on that network (%s)', async (lang) => {
    language = lang;
    const { container } = mount();
    await waitFor(() => expect(container.querySelector('.farm-venue-rail')).toBeTruthy());
    fireEvent.click(screen.getByTestId('farm-venue-card-aave-base'));
    const detail = await screen.findByTestId('farm-venue-detail-aave-base');
    // The three numbers: highest on the network, this pool, lowest on it.
    expect(detail.textContent).toContain(t('farm.venue.highOnChain'));
    expect(detail.textContent).toContain(t('farm.venue.lowOnChain'));
    expect(detail.textContent).toContain(t('farm.venue.thisPool'));
    expect(detail.querySelector('.farm-venue-range-cell.is-high').textContent).toContain('22%');
    expect(detail.querySelector('.farm-venue-range-cell.is-low').textContent).toContain('1.4%');
    expect(detail.querySelector('.farm-venue-range-cell.is-here').textContent).toContain('5%');
    // …and the chart: this row has history, so the high/low tiles come from it.
    await screen.findByText(t('farm.venue.highInWindow', { days: 30 }));
    expect(screen.getByTestId('farm-venue-history-aave-base')).toBeTruthy();
  });

  it('falls back to the live spread — and says so — when a venue has no feed row', async () => {
    const { container } = mount();
    await waitFor(() => expect(container.querySelector('.farm-venue-rail')).toBeTruthy());
    fireEvent.click(screen.getByTestId('farm-venue-card-compound-base'));
    const detail = await screen.findByTestId('farm-venue-detail-compound-base');
    // No invented rate for a venue the feed did not return.
    expect(detail.textContent).toContain(t('farm.venue.noPoolNote', { chain: 'Base' }));
    expect(detail.querySelector('.farm-venue-range-cell.is-high').textContent).toContain('22%');
    expect(detail.querySelector('.farm-venue-range-cell.is-low').textContent).toContain('1.4%');
    // The breadth chart names its own highest and lowest bars.
    await waitFor(() => expect(detail.querySelector('.farm-venue-bar.is-high')).toBeTruthy());
    expect(detail.querySelector('.farm-venue-bar.is-low')).toBeTruthy();
    expect(detail.textContent).toContain(t('farm.venue.breadthNote'));
  });

  it('stays five honest cards when the feed is down — no invented rate', async () => {
    /* This is the state a user sees the moment the feed is unreachable, and it
       is the one that has to be checked by hand most often: the rail must still
       be five cards (so the venues are discoverable), every rate must be an
       em-dash, and opening one must say the spread is unknown rather than draw
       an empty or decorative chart. */
    fetch.mockImplementation(async () => { throw new Error('offline'); });
    const { container } = mount();
    await screen.findByText(t('farm.unavailable'));
    expect(container.querySelectorAll('.farm-venue-card')).toHaveLength(5);
    fireEvent.click(screen.getByTestId('farm-venue-card-lido'));
    const detail = await screen.findByTestId('farm-venue-detail-lido');
    expect(detail.textContent).toContain(t('farm.venue.noPoolNote', { chain: 'Ethereum' }));
    expect(detail.textContent).toContain(t('farm.venue.noSpread'));
    expect(detail.querySelector('.farm-venue-bar')).toBeNull();
    expect(detail.querySelector('.farm-venue-range-cell.is-high').textContent).toContain('—');
  });

  it.each(['en', 'fa'])('offers the tokenised equities inside the in-app tab, Robinhood included (%s)', async (lang) => {
    language = lang;
    const { container } = mount('inapp');
    await waitFor(() => expect(container.querySelector('#farm-inapp-equity')).toBeTruthy());
    const section = container.querySelector('#farm-inapp-equity');
    expect(section.textContent).toContain('NVDAx');
    expect(section.textContent).toContain('HOODx');
    // The two facts this asset class cannot be sold without.
    expect(section.textContent).toContain(t('farm.equityFreeze'));
    expect(section.textContent).toContain(t('farm.equityNew'));
    // …and every buy hands off by MINT, never by symbol.
    expect(section.textContent).toContain(t('farm.buyHere', { sym: 'HOODx' }));
  });

  it('sends «execute» to the in-app tab where the adapter lives', async () => {
    const { container } = mount();
    await waitFor(() => expect(container.querySelector('.farm-venue-rail')).toBeTruthy());
    fireEvent.click(screen.getByTestId('farm-venue-card-aave-base'));
    const cta = await screen.findByText(t('farm.venue.executeCta'));
    fireEvent.click(cta);
    await waitFor(() => expect(container.querySelector('[data-testid="farm-position-hub"]')).toBeTruthy());
  });
});
