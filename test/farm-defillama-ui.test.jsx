// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
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
// Transaction panels are tested in farm-defi.test.js and the fork probes.
vi.mock('../src/components/Farm/AaveBaseUsdcPanel', () => ({ default: () => null }));
vi.mock('../src/components/Farm/AaveArbUsdcPanel', () => ({ default: () => null }));
vi.mock('../src/components/Farm/CompoundBaseUsdcPanel', () => ({ default: () => null }));
vi.mock('../src/components/Farm/LidoPanel', () => ({ default: () => null }));
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
import PoolHistory from '../src/components/Farm/PoolHistory';
import { useFarmYields } from '../src/hooks/useFarmYields';
const id = '11111111-1111-4111-8111-111111111111';
const pool = { id, project: 'aave-v3', chain: 'Base', symbol: 'USDC', apy: 5, apyBase: 5, apyReward: 0, apr: null, tvlUsd: 500_000_000, stablecoin: true, ilRisk: false, risk: 'low', exposure: 'single', source: 'defillama' };
const json = (data) => new Response(JSON.stringify(data));
const feed = (pools = [pool], freshness = 'FRESH') => ({ pools, at: Date.now(), freshness, source: 'defillama', considered: pools.length });
const history = (poolId = id) => ({ pool: poolId, points: [
  { timestamp: Date.now() - 86_400_000 * 2, apy: 3, tvlUsd: 10_000_000 },
  { timestamp: Date.now() - 86_400_000, apy: 5, tvlUsd: 20_000_000 }
], at: Date.now(), freshness: 'FRESH' });
const mount = (tab = 'recommended') => render(<MemoryRouter initialEntries={[`/farm?tab=${tab}`]}><Farm /></MemoryRouter>);
beforeEach(() => {
  language = 'en';
  Element.prototype.scrollIntoView = vi.fn();
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => json(String(url).endsWith('/history') ? history() : feed()));
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.useRealTimers(); });

describe('Farm discovery UI', () => {
  it.each(['en', 'fa'])('renders real data and a visible stale warning in %s', async (lang) => {
    language = lang;
    fetch.mockImplementation(async () => json(feed([pool], 'STALE')));
    const { container } = mount();
    await screen.findByText(t('farm.staleNotice'));
    expect(container.textContent).toContain('USDC');
    expect(container.textContent).not.toMatch(/farm\.(refresh|history|sortBy|allNetworks)/);
    expect(screen.getByRole('button', { name: t('farm.refresh') }).disabled).toBe(false);
  });
  it('recovers from a failed feed via the retry button', async () => {
    fetch.mockRejectedValueOnce(new Error('offline'));
    mount();
    await screen.findByText(t('farm.unavailable'));
    fireEvent.click(screen.getByRole('button', { name: t('farm.retry') }));
    await waitFor(() => expect(screen.queryByText(t('farm.unavailable'))).toBeNull());
    expect(screen.getAllByText('USDC').length).toBeGreaterThan(0);
  });
  it('filters by network, searches, sorts and paginates instead of mounting 500 cards', async () => {
    const pools = Array.from({ length: 30 }, (_, i) => ({ ...pool, id: `pool-${i}`, symbol: `ASSET${i}`, chain: i % 2 ? 'Ethereum' : 'Base', apy: i + 1 }));
    fetch.mockImplementation(async () => json(feed(pools)));
    const { container } = mount('pools');
    await screen.findByRole('button', { name: t('farm.showMore') });
    expect(container.querySelectorAll('.farm-pool-with-details').length).toBe(24);
    fireEvent.click(screen.getByRole('button', { name: t('farm.showMore') }));
    expect(container.querySelectorAll('.farm-pool-with-details').length).toBe(30);
    // The pickers are the shared ModernSelect: trigger opens a sheet of
    // options, one tap picks. No native <select> anymore.
    const pick = async (testId, name) => {
      fireEvent.click(container.querySelector(`[data-testid="${testId}"] .modern-select-trigger`));
      fireEvent.click(await screen.findByRole('option', { name }));
    };
    await pick('farm-network-select', 'Base');
    expect(container.querySelectorAll('.farm-pool-with-details').length).toBe(15);
    await pick('farm-sort-select', t('farm.sort.apy'));
    expect(container.querySelector('.farm-pool-with-details').textContent).toContain('ASSET28');
    fireEvent.change(screen.getByRole('textbox', { name: t('farm.search') }), { target: { value: 'not-present' } });
    expect(screen.getByText(t('farm.noneForFilter'))).toBeTruthy();
  });
  it.each(['market', 'strategies'])('actually opens pool analytics from the %s tab', async (tab) => {
    const { container } = mount(tab);
    await waitFor(() => expect(container.querySelector('.farm-pool')).toBeTruthy());
    const card = container.querySelector('.farm-pool');
    // The card is collapsed: open its body first, then click the real
    // analytics CTA (not a stubbed selection callback).
    fireEvent.click(card.querySelector('.farm-pool-toggle'));
    const details = [...card.querySelectorAll('button')].find((b) => b.textContent.includes(t('farm.viewAnalytics')));
    expect(details).toBeTruthy();
    fireEvent.click(details);
    await screen.findByText(t('farm.historyTitle'));
    await waitFor(() => expect(fetch.mock.calls.some(([url]) => String(url).endsWith(`/${id}/history`))).toBe(true));
  });
});

describe('Pool history and request lifecycle', () => {
  it('switches APY/TVL and retries history without losing pool discovery', async () => {
    fetch.mockRejectedValueOnce(new Error('offline')).mockImplementation(async () => json(history()));
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(320);
    const { container } = render(<PoolHistory poolId={id} t={t} />);
    await screen.findByText(t('farm.historyUnavailable'));
    fireEvent.click(screen.getByRole('button', { name: t('farm.retry') }));
    await waitFor(() => expect(screen.queryByText(t('farm.historyUnavailable'))).toBeNull());
    await screen.findByTestId('farm-pool-history');
    await waitFor(() => expect(container.querySelector('[data-testid="farm-pool-history"] svg')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'TVL' }));
    expect(screen.getByRole('button', { name: 'TVL' }).getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: t('farm.historyDays', { count: 90 }) }));
    expect(fetch).toHaveBeenCalledTimes(2); // range and metric use the same real observations
  });
  it('aborts discovery on unmount', async () => {
    let signal;
    fetch.mockImplementation((_url, options) => { signal = options.signal; return new Promise(() => {}); });
    const { unmount } = renderHook(() => useFarmYields());
    expect(signal.aborted).toBe(false);
    unmount(); expect(signal.aborted).toBe(true);
  });
  it('automatically refreshes and removes expired observations', async () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useFarmYields());
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(result.current.data.pools).toHaveLength(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(5 * 60_000); });
    expect(fetch).toHaveBeenCalledTimes(2);
    // Suspend all subsequent requests: expiration still removes old figures.
    fetch.mockImplementation(() => new Promise(() => {}));
    await act(async () => { await vi.advanceTimersByTimeAsync(2 * 60 * 60_000); });
    expect(result.current.data).toBeNull();
    expect(result.current.error.message).toBe('YIELDS_EXPIRED');
  });
});
