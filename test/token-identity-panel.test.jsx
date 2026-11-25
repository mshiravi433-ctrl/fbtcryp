// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import en from '../src/i18n/locales/en.json';

const state = vi.hoisted(() => ({ language: 'en', profile: null }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({
  t: (key, values = {}) => String(key.split('.').reduce((row, part) => row?.[part], en) ?? key)
    .replace(/\{\{(\w+)\}\}/g, (_, name) => values[name] ?? ''),
  i18n: { language: state.language, resolvedLanguage: state.language }
}) }));
vi.mock('../src/lib/tokenProfile', () => ({ getTokenProfile: vi.fn(() => Promise.resolve(state.profile)) }));
import { getTokenProfile } from '../src/lib/tokenProfile';
import TokenIdentity from '../src/components/TokenIdentity';

const coin = { id: 'bitcoin', name: 'Bitcoin', symbol: 'BTC', description: 'English fallback', homepage: 'https://bitcoin.org' };
afterEach(() => { cleanup(); state.language = 'en'; state.profile = null; vi.clearAllMocks(); });

describe('Token identity profile', () => {
  it('uses one surface and shows verified project facts and safe links', async () => {
    state.profile = { id: 'bitcoin', descriptions: { en: '<p>A <b>peer-to-peer</b> network.</p><script>bad()</script>' },
      categories: ['Currency'], platforms: ['ethereum'], genesisDate: '2009-01-03',
      homepage: 'https://bitcoin.org', whitepaper: 'https://bitcoin.org/bitcoin.pdf' };
    const { container } = render(<TokenIdentity coin={coin} />);
    await waitFor(() => expect(screen.getByTestId('coin-identity-description').textContent).toBe('A peer-to-peer network.'));
    expect(container.querySelectorAll('.coin-identity')).toHaveLength(1);
    expect(container.querySelectorAll('.coin-id-card, .coin-id-metric')).toHaveLength(0);
    expect(screen.getByText('2009-01-03')).toBeTruthy();
    expect(screen.getByText('Currency')).toBeTruthy();
    expect(screen.getByText('ethereum')).toBeTruthy();
    expect(screen.getByText('Whitepaper').getAttribute('href')).toBe('https://bitcoin.org/bitcoin.pdf');
    const description = screen.getByTestId('coin-identity-description');
    expect(description.querySelector('script,b')).toBeNull();
    expect(description.closest('details').open).toBe(true);
  });
  it('uses the requested translation when provided', async () => {
    state.language = 'fa';
    state.profile = { id: 'bitcoin', descriptions: { fa: 'متن فارسی', en: 'English text' } };
    render(<TokenIdentity coin={coin} />);
    await waitFor(() => expect(screen.getByTestId('coin-identity-description').textContent).toBe('متن فارسی'));
    expect(screen.getByTestId('coin-identity-description').getAttribute('lang')).toBe('fa');
  });
  it('falls back silently to English when the selected language is missing', async () => {
    state.language = 'fa';
    state.profile = { id: 'bitcoin', descriptions: { fa: '  ', en: 'English profile' } };
    render(<TokenIdentity coin={coin} />);
    await waitFor(() => expect(screen.getByTestId('coin-identity-description').textContent).toBe('English profile'));
    expect(screen.getByTestId('coin-identity-description').getAttribute('lang')).toBe('en');
    expect(screen.queryByText(/source has not provided/i)).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });
  it('never turns unsafe supplied URLs into links', async () => {
    state.profile = { id: 'bitcoin', descriptions: {}, homepage: 'javascript:alert(1)', whitepaper: 'data:text/html,bad' };
    render(<TokenIdentity coin={{ ...coin, homepage: null }} />);
    await waitFor(() => expect(getTokenProfile).toHaveBeenCalled());
    expect(screen.queryByTestId('coin-identity-homepage')).toBeNull();
    expect(screen.queryByText('Whitepaper')).toBeNull();
  });
  it('ignores a late result after changing the asset', async () => {
    let resolveFirst;
    getTokenProfile.mockImplementationOnce(() => new Promise((resolve) => { resolveFirst = resolve; }))
      .mockResolvedValueOnce({ id: 'ethereum', descriptions: { en: 'Ethereum profile' } });
    const { rerender } = render(<TokenIdentity coin={coin} />);
    rerender(<TokenIdentity coin={{ id: 'ethereum', name: 'Ethereum', symbol: 'ETH' }} />);
    await waitFor(() => expect(screen.getByText('Ethereum profile')).toBeTruthy());
    resolveFirst({ id: 'bitcoin', descriptions: { en: 'Wrong profile' } });
    await Promise.resolve();
    expect(screen.queryByText('Wrong profile')).toBeNull();
  });
});
