// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import en from '../src/i18n/locales/en.json';
import InvestButton from '../src/components/Farm/InvestButton';
import { investRoute } from '../src/lib/yields';

vi.mock('../src/components/Sheet', () => ({
  default: ({ open, title, children, testId }) => open
    ? <section data-testid={testId} aria-label={title}>{children}</section>
    : null
}));

const t = (key, values = {}) => {
  const text = key.split('.').reduce((row, part) => row?.[part], en) ?? values.defaultValue ?? key;
  return String(text).replace(/\{\{(\w+)\}\}/g, (_, name) => values[name] ?? '');
};

afterEach(cleanup);

describe('Farm token-preparation actions', () => {
  it('prepares both LP legs through two independent, verified swaps', () => {
    const pool = { id: 'base-pair', symbol: 'USDC-USDT', exposure: 'multi', chain: 'Base' };
    const route = investRoute(pool);
    const onGetTokens = vi.fn();
    expect(route?.legRoutes).toHaveLength(2);

    render(<InvestButton pool={pool} route={route} onGetTokens={onGetTokens} t={t} />);
    fireEvent.click(screen.getByTestId('farm-get-pair-base-pair'));
    // The pair CTA opens a choice; it does not silently swap leg A into leg B.
    expect(onGetTokens).not.toHaveBeenCalled();
    expect(screen.getByTestId('farm-pair-sheet')).toBeTruthy();
    expect(screen.getAllByTestId(/^farm-pair-leg-/)).toHaveLength(2);

    fireEvent.click(screen.getByTestId('farm-pair-leg-1'));
    expect(onGetTokens).toHaveBeenCalledTimes(1);
    expect(onGetTokens).toHaveBeenCalledWith(route.legRoutes[1]);
    expect(screen.queryByTestId('farm-pair-sheet')).toBeNull();
  });

  it('keeps a single-asset acquisition as one direct action', () => {
    const pool = { id: 'single', symbol: 'USDC', exposure: 'single', chain: 'Ethereum' };
    const route = investRoute(pool);
    const onGetTokens = vi.fn();
    render(<InvestButton pool={pool} route={route} onGetTokens={onGetTokens} t={t} />);
    fireEvent.click(screen.getByRole('button', { name: /Get USDC/ }));
    expect(onGetTokens).toHaveBeenCalledWith(route);
    expect(screen.queryByTestId('farm-pair-sheet')).toBeNull();
  });

  it('does not invent routes for unknown or look-alike assets', () => {
    const onGetTokens = vi.fn();
    const unknown = { symbol: 'USDC-UNLISTED', exposure: 'multi', chain: 'Base' };
    const route = investRoute(unknown);
    expect(route).toBeNull();
    expect(investRoute({ symbol: 'WBTC-BNB', exposure: 'multi', chain: 'BSC' })).toBeNull();
    const { container } = render(<InvestButton pool={unknown} route={route} onGetTokens={onGetTokens} t={t} />);
    expect(container.querySelector('button')).toBeNull();
    expect(container.textContent).toBe(t('farm.noRouteHint'));
  });

  it('carries both verified mints for each Solana leg', () => {
    const route = investRoute({ symbol: 'SOL-JUP', exposure: 'multi', chain: 'Solana' });
    expect(route?.legRoutes).toHaveLength(2);
    for (const leg of route.legRoutes) {
      expect(leg.kind).toBe('solana');
      expect(leg.fromMint).toMatch(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/);
      expect(leg.toMint).toMatch(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/);
      expect(leg.fromMint).not.toBe(leg.toMint);
    }
  });
});
