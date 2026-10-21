// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, useSearchParams } from 'react-router-dom';
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
import { FARM_YIELDS_CACHE_KEY, useFarmYields } from '../src/hooks/useFarmYields';
import { useSettingsStore } from '../src/store/useSettingsStore.js';
const id = '11111111-1111-4111-8111-111111111111';
const pool = { id, project: 'aave-v3', chain: 'Base', symbol: 'USDC', apy: 5, apyBase: 5, apyReward: 0, apr: null, tvlUsd: 500_000_000, stablecoin: true, ilRisk: false, risk: 'low', exposure: 'single', source: 'defillama' };
const json = (data) => new Response(JSON.stringify(data));
const feed = (pools = [pool], freshness = 'FRESH') => ({ pools, at: Date.now(), freshness, source: 'defillama', considered: pools.length });
const history = (poolId = id) => ({ pool: poolId, points: [
  { timestamp: Date.now() - 86_400_000 * 2, apy: 3, tvlUsd: 10_000_000 },
  { timestamp: Date.now() - 86_400_000, apy: 5, tvlUsd: 20_000_000 }
], at: Date.now(), freshness: 'FRESH' });
const mount = (tab = 'recommended') => render(<MemoryRouter initialEntries={[`/farm?tab=${tab}`]}><Farm /></MemoryRouter>);
function RouteProbe() {
  const [params] = useSearchParams();
  return <output data-testid="farm-route-query">{params.toString()}</output>;
}
beforeEach(() => {
  language = 'en';
  localStorage.removeItem(FARM_YIELDS_CACHE_KEY);
  useSettingsStore.getState().setFarmWatchlist([]);
  Element.prototype.scrollIntoView = vi.fn();
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => json(String(url).endsWith('/history') ? history() : feed()));
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });

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
  it('filters to evidenced real yield instead of treating rewards as base yield', async () => {
    const pools = [
      { ...pool, id: 'real-yield', symbol: 'REAL', apy: 10, apyBase: 8, apyReward: 2 },
      { ...pool, id: 'reward-only', symbol: 'REWARD', apy: 10, apyBase: 0, apyReward: 10 },
      { ...pool, id: 'unknown-split', symbol: 'UNKNOWN', apy: 10, apyBase: null, apyReward: null }
    ];
    fetch.mockImplementation(async () => json(feed(pools)));
    const { container } = mount('pools');
    await waitFor(() => expect(container.querySelectorAll('.farm-pool-with-details')).toHaveLength(3));
    fireEvent.click(screen.getByRole('button', { name: t('farm.category.realYield') }));
    await waitFor(() => expect(container.querySelectorAll('.farm-pool-with-details')).toHaveLength(1));
    expect(container.querySelector('.farm-pool').textContent).toContain('REAL');
  });

  it('keeps a wallet-free watchlist and configures a fresh-APY threshold alert', async () => {
    const { container } = mount();
    await waitFor(() => expect(container.querySelector(`[data-testid="farm-watch-toggle-${id}"]`)).toBeTruthy());
    fireEvent.click(container.querySelector(`[data-testid="farm-watch-toggle-${id}"]`));
    expect(useSettingsStore.getState().farmWatchlist).toEqual([id]);
    expect(useSettingsStore.getState().farmWatchlist).not.toContain('0x0000000000000000000000000000000000000000');

    fireEvent.click(screen.getByRole('tab', { name: t('farm.tab.watchlist') }));
    await screen.findByTestId('farm-watchlist');
    const threshold = screen.getByRole('spinbutton', { name: t('farm.alerts.threshold') });
    expect(threshold.disabled).toBe(false);
    fireEvent.change(threshold, { target: { value: '7.5' } });
    const enable = screen.getByRole('button', { name: t('farm.alerts.enable') });
    expect(enable.disabled).toBe(false);
    fireEvent.click(enable);
    expect(useSettingsStore.getState().farmRateAlerts[id]).toEqual({ enabled: true, direction: 'above', threshold: 7.5 });
  });

  it('never offers an APY alert for APR-only data', async () => {
    const aprPool = { ...pool, apy: null, apyBase: null, apyReward: null, apr: 3.4 };
    fetch.mockImplementation(async () => json(feed([aprPool])));
    const { container } = mount();
    await waitFor(() => expect(container.querySelector(`[data-testid="farm-watch-toggle-${id}"]`)).toBeTruthy());
    expect(container.querySelector('.farm-apy-label').textContent).toBe(t('farm.apr'));
    fireEvent.click(container.querySelector('.farm-pool-toggle'));
    expect(container.querySelector('.farm-pool').textContent).toContain(t('farm.apr'));
    fireEvent.click(container.querySelector(`[data-testid="farm-watch-toggle-${id}"]`));
    fireEvent.click(screen.getByRole('tab', { name: t('farm.tab.watchlist') }));
    const threshold = await screen.findByRole('spinbutton', { name: t('farm.alerts.threshold') });
    expect(threshold.disabled).toBe(true);
    expect(screen.getByText(t('farm.alerts.apyUnavailable'))).toBeTruthy();
  });

  it('shows an unknown APY as unavailable instead of a fabricated zero', async () => {
    const unknown = { ...pool, apy: null, apyBase: null, apyReward: null, apr: null, rewardApr: null };
    fetch.mockImplementation(async () => json(feed([unknown])));
    const { container } = mount('pools');
    await waitFor(() => expect(container.querySelector('.farm-pool')).toBeTruthy());
    expect(container.querySelector('.farm-apy').textContent).toBe('—');
    expect(container.querySelectorAll('.farm-hero-stat-value')[1].textContent).toBe('—');

    fireEvent.click(container.querySelector('.farm-pool-toggle'));
    fireEvent.click(container.querySelector(`[data-testid="farm-view-analytics-${id}"]`));
    const sheet = await screen.findByTestId('farm-analysis-sheet');
    expect(sheet.querySelector('.farm-ana-apy-value').textContent).toBe('—');
    const grossMetrics = [...sheet.querySelectorAll('.farm-metric')]
      .filter((metric) => metric.textContent.includes(t('farm.grossApy')));
    expect(grossMetrics.length).toBeGreaterThan(0);
    expect(grossMetrics.every((metric) => metric.lastElementChild?.textContent === '—')).toBe(true);
    expect(sheet.textContent).not.toMatch(/(?:null|undefined|NaN)%/);
  });

  it('recovers from a failed feed via the retry button', async () => {
    fetch.mockRejectedValueOnce(new Error('offline'));
    mount();
    await screen.findByText(t('farm.unavailable'));
    fireEvent.click(screen.getByRole('button', { name: t('farm.retry') }));
    await waitFor(() => expect(screen.queryByText(t('farm.unavailable'))).toBeNull());
    expect(screen.getAllByText('USDC').length).toBeGreaterThan(0);
  });
  it('opens the pool-and-amount deep link and preserves other query parameters across tabs', async () => {
    render(
      <MemoryRouter initialEntries={[`/farm?tab=recommended&pool=${id}&amount=250&ref=keep`]}>
        <Farm />
        <RouteProbe />
      </MemoryRouter>
    );
    const sheet = await screen.findByTestId('farm-analysis-sheet');
    expect(sheet.textContent).toMatch(/Amount\$250(?:\D|$)/);
    await waitFor(() => expect(screen.getByTestId('farm-route-query').textContent).toContain('ref=keep'));
    fireEvent.click(screen.getByRole('tab', { name: t('farm.tab.pools') }));
    expect(screen.getByTestId('farm-route-query').textContent).toContain('ref=keep');
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
    const score = await screen.findByTestId(`farm-score-breakdown-${id}`);
    expect(score.textContent).toContain('40%');
    expect(score.textContent).toContain('25%');
    expect(score.textContent).toContain('20%');
    expect(score.textContent).toContain('15%');
    await waitFor(() => expect(fetch.mock.calls.some(([url]) => String(url).endsWith(`/${id}/history`))).toBe(true));
  });

  it('keeps the two analysis actions equal and fades the pinned copy when the inline row is visible', async () => {
    const observers = [];
    class FakeIntersectionObserver {
      constructor(callback, options) { this.callback = callback; this.options = options; observers.push(this); }
      observe(target) { this.target = target; }
      disconnect() {}
      setVisible(isIntersecting) {
        this.callback([{ target: this.target, isIntersecting, intersectionRatio: isIntersecting ? 1 : 0 }], this);
      }
    }
    vi.stubGlobal('IntersectionObserver', FakeIntersectionObserver);
    fetch.mockImplementation(async (url) => String(url).endsWith('/history')
      ? json(history())
      : json(feed([{ ...pool, url: 'https://example.org/pool' }])));

    const { container } = mount();
    await waitFor(() => expect(container.querySelector('.farm-pool')).toBeTruthy());
    const card = container.querySelector('.farm-pool');
    fireEvent.click(card.querySelector('.farm-pool-toggle'));
    const details = [...card.querySelectorAll('button')].find((button) => button.textContent.includes(t('farm.viewAnalytics')));
    fireEvent.click(details);

    const footer = await screen.findByTestId('farm-analysis-sheet-footer');
    await screen.findByTestId('farm-analysis-inline-actions');
    const footerActions = footer.querySelector('.farm-ana-foot');
    expect(footerActions.classList.contains('has-two-actions')).toBe(true);
    expect(footerActions.querySelectorAll('button')).toHaveLength(2);
    expect(observers).toHaveLength(1);
    expect(observers[0].options.root.classList.contains('fsh-body')).toBe(true);

    act(() => observers[0].setVisible(true));
    await waitFor(() => expect(footer.getAttribute('data-footer-visible')).toBe('false'));
    expect(footer.getAttribute('aria-hidden')).toBe('true');
    expect(footer.classList.contains('is-hidden')).toBe(true);

    act(() => observers[0].setVisible(false));
    await waitFor(() => expect(footer.getAttribute('data-footer-visible')).toBe('true'));
    expect(footer.getAttribute('aria-hidden')).toBeNull();
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
