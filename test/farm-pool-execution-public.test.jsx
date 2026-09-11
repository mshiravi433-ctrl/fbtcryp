// @vitest-environment jsdom
/**
 * WHICH POOLS DOES THE FARM SCREEN SAY IT CAN EXECUTE? — public-open half.
 *
 * Runs ONLY under test/vitest.public.config.mjs, which bakes the five
 * `__*_SUPPLY_ENABLED__` / `__*_PUBLIC__` defines to true — the shape of a
 * build that scripts/farm-rollout-policy.mjs has approved as `public-open`
 * (ci/farm-rollout.env.sh, sourced by both the APK and the website build).
 *
 * This is the half that was missing in production: the rollout was open, the
 * adapters were wired, and the pool card STILL said «اجرا فقط‌خواندنی
 * می‌ماند» with six dead «ناموجود» buttons, because nothing on the discovery
 * surface ever asked the adapter table. Here a supported row must:
 *
 *   · carry the execution badge on its card;
 *   · render its OWN adapter panel inside the pool analytics, with the six
 *     placeholder buttons gone (a working supply button next to six
 *     «ناموجود» ones is a screen arguing with itself);
 *   · replace the read-only notice with the execution one, and ask for a
 *     wallet instead of announcing read-only while disconnected.
 *
 * And an unsupported row in the SAME build must keep saying unavailable.
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
// The panels' own behaviour is covered by farm-aave-panel.test.jsx and friends;
// here only WHICH panel a row reaches matters, so each is a marker.
vi.mock('../src/components/Farm/AaveBaseUsdcPanel', () => ({ default: ({ pool }) => <div data-testid="panel-aave-base">{pool.symbol}</div> }));
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
import {
  AAVE_BASE_SUPPLY_OPEN_TO_PUBLIC, AAVE_ARB_SUPPLY_OPEN_TO_PUBLIC,
  COMPOUND_BASE_SUPPLY_OPEN_TO_PUBLIC, MORPHO_BASE_SUPPLY_OPEN_TO_PUBLIC,
  LIDO_STAKE_OPEN_TO_PUBLIC
} from '../src/lib/farmRolloutMode';

const id = '11111111-1111-4111-8111-111111111111';
const aaveRow = { id, project: 'aave-v3', chain: 'Base', symbol: 'USDC', apy: 5, apyBase: 5, apyReward: 0, apr: null, tvlUsd: 500_000_000, stablecoin: true, ilRisk: false, risk: 'low', exposure: 'single', source: 'defillama' };
const otherRow = { ...aaveRow, id: '22222222-2222-4222-8222-222222222222', project: 'uniswap-v3', symbol: 'USDC-WETH', ilRisk: true, exposure: 'multi' };
const json = (data) => new Response(JSON.stringify(data));
const feed = (pools) => ({ pools, at: Date.now(), freshness: 'FRESH', source: 'defillama', considered: pools.length });
const history = () => ({ pool: id, points: [
  { timestamp: Date.now() - 86_400_000, apy: 5, tvlUsd: 20_000_000 },
  { timestamp: Date.now(), apy: 5, tvlUsd: 21_000_000 }
], at: Date.now(), freshness: 'FRESH' });
const mount = () => render(<MemoryRouter initialEntries={['/farm?tab=recommended']}><Farm /></MemoryRouter>);

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

describe('Farm execution surface — public-open build', () => {
  it('is the shipped configuration: every adapter is open to any visitor', () => {
    expect(AAVE_BASE_SUPPLY_OPEN_TO_PUBLIC).toBe(true);
    expect(AAVE_ARB_SUPPLY_OPEN_TO_PUBLIC).toBe(true);
    expect(COMPOUND_BASE_SUPPLY_OPEN_TO_PUBLIC).toBe(true);
    expect(MORPHO_BASE_SUPPLY_OPEN_TO_PUBLIC).toBe(true);
    expect(LIDO_STAKE_OPEN_TO_PUBLIC).toBe(true);
  });

  it.each(['en', 'fa'])('offers the real adapter on a supported pool instead of six dead buttons (%s)', async (lang) => {
    language = lang;
    const { container } = mount();
    const card = await openDetails(container, 'USDC');
    expect(card.querySelector(`[data-testid="farm-exec-badge-${id}"]`)).toBeTruthy();
    expect(screen.getByText(t('farm.executionActivated'))).toBeTruthy();
    /* The deleted read-only notice (see farm-pool-execution.test.jsx) must
       not leak back in anywhere on the screen. */
    expect(screen.queryByText('تحلیل پروتکلی این استخر فعال است. تا وصل‌شدن آداپتور اجرایی تأییدشده، اجرا فقط‌خواندنی می‌ماند.')).toBeNull();
    expect(screen.queryByText('Protocol analytics are active for this pool. Execution stays read-only until a verified adapter is wired in.')).toBeNull();
    // The adapter itself, rendered INSIDE the analytics with the live feed
    // row. Scoped to the wrapper on purpose: the position hub at the bottom of
    // the page renders the same five panels, so an unscoped query finds two.
    const inline = screen.getByTestId('farm-pool-execution-aave-base');
    expect(inline.querySelector('[data-testid="panel-aave-base"]').textContent).toContain('USDC');
    // …and the dead placeholders never render anywhere on the screen.
    expect([...container.querySelectorAll('.farm-action-grid button')].filter((b) => b.disabled)).toHaveLength(0);
    expect(screen.queryByText(t('farm.statusUnavailable'))).toBeNull();
    // Disconnected, the analytics ask for a wallet instead of announcing
    // read-only. Scoped to the details card: the positions section keeps its
    // own "read-only until you connect" pill, which is still true of it.
    const details = container.querySelector('.farm-details');
    expect(details.textContent).toContain(t('farm.connectToExecute'));
    expect(details.textContent).not.toContain(t('farm.readOnly'));
    // …and the page header stops introducing the whole screen as read-only.
    expect(screen.getByText(t('farm.executionLive'))).toBeTruthy();
    expect(screen.getByText(t('farm.protocolModeExec'))).toBeTruthy();
  });

  it('stays honest for a pool no adapter pins, in the same build', async () => {
    const { container } = mount();
    const card = await openDetails(container, 'USDC-WETH');
    expect(card.querySelector('[data-testid^="farm-exec-badge-"]')).toBeNull();
    /* No execution notice on an adapter-less pool — the old "read-only until
       a verified adapter is wired" sentence was deleted (read as an
       unfinished app); the analysis simply stands on its own. */
    expect(screen.queryByText(t('farm.executionActivated'))).toBeNull();
    expect(screen.queryByText('تحلیل پروتکلی این استخر فعال است. تا وصل‌شدن آداپتور اجرایی تأییدشده، اجرا فقط‌خواندنی می‌ماند.')).toBeNull();
    expect(screen.queryByText('Protocol analytics are active for this pool. Execution stays read-only until a verified adapter is wired in.')).toBeNull();
    // No inline adapter for this row (the hub at the bottom is a separate
    // section and always lists the five supported positions).
    expect(container.querySelector('[data-testid^="farm-pool-execution-"]')).toBeNull();
    // No six dead buttons either: what this row cannot do is simply not
    // offered, instead of being offered as six disabled controls.
    expect([...container.querySelectorAll('.farm-action-grid button')].filter((b) => b.disabled)).toHaveLength(0);
    expect(screen.queryByText(t('farm.statusUnavailable'))).toBeNull();
  });
});
