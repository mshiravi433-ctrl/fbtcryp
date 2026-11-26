// @vitest-environment node
/**
 * The risk tab used to answer «حال حاضر برای این حساسیتها گزینهای موجود نیست»
 * whenever a live quote could not be produced (no wallet, terms not accepted,
 * provider timeout). A RECOMMENDATION is not a purchase: when pricing is not
 * available the engine must still show the REAL catalogue options for that
 * exposure, never invent a premium and never claim there are no options.
 */
import { describe, expect, it, vi } from 'vitest';

const discoverProducts = vi.fn(async () => [
  {
    id: 'nexus-97', providerProductId: '97', kind: 'lending', name: 'Aave v3',
    providerId: 'nexus-mutual', providerName: 'Nexus Mutual',
    supportedChains: [1], termsUrl: 'https://example.test/terms'
  },
  {
    id: 'nexus-72', providerProductId: '72', kind: 'smart-contract', name: 'Uniswap v3',
    providerId: 'nexus-mutual', providerName: 'Nexus Mutual', supportedChains: [1]
  }
]);

vi.mock('../../server/insurance/service.js', () => ({
  aggregateQuotes: vi.fn(async () => ({ ok: false, none: true })),
  discoverProducts: (...args) => discoverProducts(...args),
  listProviders: () => []
}));
vi.mock('../../server/insurance/coverage.js', () => ({ listCoverages: async () => [] }));

const { protectPortfolio } = await import('../../server/insurance/protect-portfolio.js');

describe('protect-portfolio without a live quote', () => {
  it('returns real catalogue options instead of «no options»', async () => {
    const out = await protectPortfolio({
      walletAddress: '0x1111111111111111111111111111111111111111',
      chainId: 1,
      durationDays: 28,
      exposures: [
        { kind: 'lending', amountUsd: '5000', chainId: 1 },
        { kind: 'smartContract', amountUsd: '1000', chainId: 1 }
      ]
    });
    expect(Array.isArray(out.recommendations)).toBe(true);
    const lending = out.recommendations.find((r) => r.protectionType === 'lending');
    expect(lending).toBeTruthy();
    expect(lending.catalogueOnly).toBe(true);
    expect(lending.best).toBeNull();
    expect(lending.catalogue[0]).toMatchObject({ productId: 'nexus-97', providerName: 'Nexus Mutual' });
    expect(out.autoExecute).toBe(false);
  });

  it('puts the largest uncovered exposure first', async () => {
    const out = await protectPortfolio({
      walletAddress: '0x1111111111111111111111111111111111111111',
      chainId: 1,
      exposures: [
        { kind: 'smartContract', amountUsd: '1000', chainId: 1 },
        { kind: 'lending', amountUsd: '5000', chainId: 1 }
      ]
    });
    expect(out.recommendations[0]?.protectionType).toBe('lending');
  });
});

describe('insurance shell overlays', () => {
  it('keeps the confirmation dialog wired while removing the notification bell', async () => {
    const { readFileSync } = await import('node:fs');
    const shell = readFileSync(new URL('../../src/pages/insurance/InsuranceShell.jsx', import.meta.url), 'utf8');
    /* The alert bell is gone at the user's request, but `confirm()` is still
       handed to coverage cancellation and quote signing through outlet
       context. Deleting its portal together with the bell left both flows
       waiting on a promise that never resolved. */
    expect(shell).not.toContain('ins-bell');
    expect(shell).toContain('confirmState && typeof document');
    expect(shell).toContain('settleConfirm(true)');
  });
});
