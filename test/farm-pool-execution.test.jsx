// @vitest-environment jsdom
/**
 * WHICH POOLS DOES THE FARM SCREEN SAY IT CAN EXECUTE? — closed-build half.
 *
 * The bug this pins: a pool card offered six permanently-disabled buttons and
 * «تا وصل‌شدن آداپتور اجرایی تأییدشده، اجرا فقط‌خواندنی می‌ماند» for EVERY row
 * in the feed, including the five whose adapters are wired and fork-probed.
 * The other half — what a public-open build must show — lives in
 * test/farm-pool-execution-public.test.jsx, because the build flags are baked
 * by Vite at config load time and cannot be flipped inside one test run.
 *
 * This file runs under the DEFAULT config, where every money-in flag is false,
 * so it asserts the two properties that keep a closed build honest:
 *
 *   · nothing is advertised: no execution badge, no execution panel, no dead
 *     «ناموجود» action buttons, and the read-only notice stays as it was;
 *   · the position hub still MOUNTS for a visitor with no wallet connected —
 *     the panels inside it decide their own visibility, so in this build they
 *     render nothing, but the section itself must not be gated on a connection.
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
vi.mock('../src/components/Farm/AaveBaseUsdcPanel', () => ({ default: () => <div data-testid="panel-aave-base" /> }));
vi.mock('../src/components/Farm/AaveArbUsdcPanel', () => ({ default: () => <div data-testid="panel-aave-arb" /> }));
vi.mock('../src/components/Farm/CompoundBaseUsdcPanel', () => ({ default: () => <div data-testid="panel-compound" /> }));
vi.mock('../src/components/Farm/LidoPanel', () => ({ default: () => <div data-testid="panel-lido" /> }));
vi.mock('../src/components/Farm/MorphoBaseUsdcPanel', () => ({ default: () => <div data-testid="panel-morpho" /> }));
vi.mock('../src/lib/solanaAssetsClient', async (original) => ({ ...await original(), getSolanaAssets: async () => ({ lst: [] }) }));
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
import { farmExecutionAdapterFor } from '../src/components/Farm/FarmPositionHub';
import { AAVE_BASE_SUPPLY_OPEN_TO_PUBLIC, LIDO_STAKE_OPEN_TO_PUBLIC } from '../src/lib/farmRolloutMode';

const id = '11111111-1111-4111-8111-111111111111';
const aaveRow = { id, project: 'aave-v3', chain: 'Base', symbol: 'USDC', apy: 5, apyBase: 5, apyReward: 0, apr: null, tvlUsd: 500_000_000, stablecoin: true, ilRisk: false, risk: 'low', exposure: 'single', source: 'defillama' };
const otherRow = { ...aaveRow, id: '22222222-2222-4222-8222-222222222222', project: 'uniswap-v3', symbol: 'USDC-WETH', ilRisk: true, exposure: 'multi' };
const json = (data) => new Response(JSON.stringify(data));
const feed = (pools) => ({ pools, at: Date.now(), freshness: 'FRESH', source: 'defillama', considered: pools.length });
const history = () => ({ pool: id, points: [
  { timestamp: Date.now() - 86_400_000, apy: 5, tvlUsd: 20_000_000 },
  { timestamp: Date.now(), apy: 5, tvlUsd: 21_000_000 }
], at: Date.now(), freshness: 'FRESH' });
const mount = (pools, tab = 'recommended') => render(<MemoryRouter initialEntries={[`/farm?tab=${tab}`]}><Farm /></MemoryRouter>);

beforeEach(() => {
  language = 'en';
  Element.prototype.scrollIntoView = vi.fn();
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => json(String(url).endsWith('/history') ? history() : feed([aaveRow, otherRow])));
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const openDetails = async (container, symbol) => {
  await waitFor(() => expect(container.querySelector('.farm-pool')).toBeTruthy());
  const card = [...container.querySelectorAll('.farm-pool')].find((c) => c.textContent.includes(symbol));
  // Cards collapse to a header; the analytics CTA lives in the open body.
  fireEvent.click(card.querySelector('.farm-pool-toggle'));
  const details = [...card.querySelectorAll('button')].find((b) => b.textContent.includes(t('farm.viewAnalytics')));
  fireEvent.click(details);
  await screen.findByText(t('farm.historyTitle'));
  return card;
};

describe('Farm execution surface — build with the money path closed', () => {
  it('is the shipped default: no adapter is open to the public', () => {
    expect(AAVE_BASE_SUPPLY_OPEN_TO_PUBLIC).toBe(false);
    expect(LIDO_STAKE_OPEN_TO_PUBLIC).toBe(false);
  });

  it('routes each supported row to its own adapter and nothing else to any', () => {
    expect(farmExecutionAdapterFor(aaveRow)?.id).toBe('aave-base');
    expect(farmExecutionAdapterFor({ project: 'compound-v3', chain: 'Base', symbol: 'USDC', exposure: 'single' })?.id).toBe('compound-base');
    expect(farmExecutionAdapterFor({ project: 'aave-v3', chain: 'Arbitrum', symbol: 'USDC', exposure: 'single' })?.id).toBe('aave-arbitrum');
    expect(farmExecutionAdapterFor({ project: 'lido', chain: 'Ethereum', symbol: 'STETH' })?.id).toBe('lido');
    expect(farmExecutionAdapterFor({
      project: 'morpho-blue', chain: 'Base', pool: '7d33d57d-36dc-414b-9538-22a223250468'
    })?.id).toBe('morpho-base');
    // A different Morpho market on the same chain is NOT the pinned one.
    expect(farmExecutionAdapterFor({ project: 'morpho-blue', chain: 'Base', pool: 'some-other-market' })).toBeNull();
    expect(farmExecutionAdapterFor(otherRow)).toBeNull();
    expect(farmExecutionAdapterFor(null)).toBeNull();
  });

  it('advertises no execution and shows no dead action buttons', async () => {
    const { container } = mount();
    const card = await openDetails(container, 'USDC');
    // No badge: the build cannot offer execution to whoever is looking.
    expect(card.querySelector('[data-testid^="farm-exec-badge-"]')).toBeNull();
    expect(screen.queryByText(t('farm.executionActivated'))).toBeNull();
    expect(screen.queryByTestId('farm-pool-execution-aave-base')).toBeNull();
    /* The "execution stays read-only until a verified adapter is wired"
       notice was deleted on purpose — reported as «زشته، انگار اپ ناقصه»,
       it printed on EVERY analysis and read as an unfinished app. An
       analysis-only pool now simply shows the analysis. */
    expect(screen.queryByText('تحلیل پروتکلی این استخر فعال است. تا وصل‌شدن آداپتور اجرایی تأییدشده، اجرا فقط‌خواندنی می‌ماند.')).toBeNull();
    expect(screen.queryByText('Protocol analytics are active for this pool. Execution stays read-only until a verified adapter is wired in.')).toBeNull();
    // The six permanently-disabled «ناموجود» buttons are GONE — a dead
    // button is clutter, not honesty. The action grid now holds only what
    // exists (swap/stake + pool link), all enabled.
    const gridButtons = [...container.querySelectorAll('.farm-action-grid button')];
    expect(gridButtons.filter((b) => b.disabled)).toHaveLength(0);
    expect(screen.queryByText(t('farm.statusUnavailable'))).toBeNull();
    // The page header keeps calling itself read-only, because in this build it
    // is: the badge is derived from the adapter table, not hardcoded.
    expect(screen.getAllByText(t('farm.readOnly')).length).toBeGreaterThan(0);
    expect(screen.getByText(t('farm.protocolMode'))).toBeTruthy();
    expect(screen.queryByText(t('farm.executionLive'))).toBeNull();
  });

  it.each(['en', 'fa'])('mounts the position hub for a visitor with no wallet connected (%s)', async (lang) => {
    language = lang;
    /* «هر ۵ شبکه که زیر صفحه فارم هست را بیار داخل تب داخل اپ» — the five
     * execution panels moved from below EVERY tab into the in-app tab. They
     * still mount for every visitor on that tab, connected or not: the section
     * used to render the hub only inside the connected branch, so a
     * public-open build showed an empty box to exactly the person the rollout
     * exists to reach. */
    const { container } = mount(null, 'inapp');
    await waitFor(() => expect(container.querySelector('[data-testid="farm-position-hub"]')).toBeTruthy());
    expect(container.querySelector('[data-testid="farm-position-hub"]')).toBeTruthy();
    expect(screen.getByText(t('farm.connectForPositions'))).toBeTruthy();
    // And it is GONE from below the other tabs — one place, not two.
    const { container: recommended } = mount();
    await waitFor(() => expect(recommended.querySelector('.farm-pool')).toBeTruthy());
    expect(recommended.querySelector('[data-testid="farm-position-hub"]')).toBeNull();
  });
});
