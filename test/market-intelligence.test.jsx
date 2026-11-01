// @vitest-environment jsdom
import { describe, expect, it, vi, afterEach } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import en from '../src/i18n/locales/en.json';
import fa from '../src/i18n/locales/fa.json';

const dict = { en, fa };
const get = (obj, path) => path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key, opts = {}) => {
      const value = get(fa, key) ?? get(en, key) ?? opts.defaultValue ?? key;
      return String(value).replace(/\{\{(\w+)\}\}/g, (_, k) => String(opts[k] ?? ''));
    }
  })
}));
vi.mock('../src/components/AnimatedNumber', () => ({ default: ({ value, format }) => <span>{format(value)}</span> }));
vi.mock('../src/components/CoinLogo', () => ({ default: ({ coin }) => <span data-testid="coin-logo">{coin?.symbol}</span> }));

import MarketOverview from '../src/components/market/MarketOverview';
import SmartMoneyBanner from '../src/components/market/SmartMoneyBanner';
import HotCoins from '../src/components/market/HotCoins';
import MarketSearch from '../src/components/market/MarketSearch';

afterEach(cleanup);

describe('market intelligence surfaces', () => {
  it('omits missing dominance instead of drawing a fake bar', () => {
    render(<MarketOverview global={{}} bitcoin={null} trend={null} liveAvgChange={null} loading={false} />);
    expect(document.querySelector('.mx-dominance')).toBeNull();
    expect(screen.getByTestId('market-global-card').textContent).toContain('—');
  });

  it('does not call absent or offline global data live', () => {
    const { rerender } = render(<MarketOverview global={{}} loading={false} />);
    expect(document.querySelector('.mx-deck-live').textContent).toBe(fa.marketIntel.deckPending);
    rerender(<MarketOverview global={{ mcap: 1e12, offline: true }} loading={false} />);
    expect(document.querySelector('.mx-deck-live').getAttribute('data-unavailable')).toBe('true');
    expect(document.querySelector('.mx-deck-live').textContent).not.toBe(fa.marketIntel.deckLive);
  });

  it('links the Global Intelligence banner to its real route', () => {
    render(<MemoryRouter><SmartMoneyBanner /></MemoryRouter>);
    const link = screen.getByRole('link', { name: fa.marketGlobalAd.cta });
    expect(link.getAttribute('href')).toBe('/global');
    expect(screen.getByText(fa.marketGlobalAd.title)).toBeTruthy();
  });

  it('renders hot coins with real joined volume and opens the coin', () => {
    const onOpen = vi.fn();
    render(<HotCoins coins={[{ id: 'bitcoin', symbol: 'BTC', name: 'Bitcoin', place: 1, price: 60000, change24h: 1.2, volume: 1e9, sparkline: [1, 2, 3] }]} onOpen={onOpen} />);
    expect(screen.getByText(fa.marketIntel.hotTitle)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Bitcoin/ }));
    expect(onOpen).toHaveBeenCalledWith('bitcoin');
    expect(screen.getByTestId('market-hot-coins').textContent).toContain('$1.00B');
  });

  it('offers keyboard-navigable autocomplete without duplicate search controls', () => {
    const onNavigate = vi.fn();
    render(
      <MarketSearch
        query="bit"
        onQueryChange={() => {}}
        onApplyIntent={() => false}
        onNavigate={onNavigate}
        universe={[{ id: 'bitcoin', symbol: 'BTC', name: 'Bitcoin', price: 60000, rank: 1 }]}
        remoteHits={[]}
      />
    );
    const input = screen.getByLabelText(fa.market.searchAria);
    fireEvent.focus(input);
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onNavigate).toHaveBeenCalledWith('/coin/bitcoin');
    expect(document.querySelectorAll('.mx-search-clear').length).toBe(1);
  });
});
