import { describe, expect, it } from 'vitest';
import { evaluateStrategyPreflight } from '../src/lib/strategyBrain/strategyPreflight.js';

const NOW = 1_800_000_000_000;
const strategy = {
  ok: true, goal: { capitalUsd: 1000, riskProfile: 'balanced' },
  sleeves: [{ chainId: 8453 }],
  stages: [],
  risk: { weightedRiskRank: 2, breaches: [] }
};
const wallet = { connected: true, canSign: true, address: '0x123', chainId: 8453 };
const portfolio = { dataStatus: 'live', priceDataStatus: 'live', partial: false,
  fetchedAt: NOW - 1000, totalValueUsd: 1500 };

const check = (overrides = {}) => evaluateStrategyPreflight({
  strategy: overrides.strategy || strategy,
  wallet: overrides.wallet || wallet,
  portfolio: overrides.portfolio || portfolio,
  now: NOW
});

describe('strategy local preflight is not a quote or receipt', () => {
  it('passes only a fresh, fully sourced USD read with sufficient capital', () => {
    expect(check()).toMatchObject({ ok: true, code: 'LOCAL_PREFLIGHT_PASSED',
      unverified: ['gas', 'allowances', 'venue quote', 'wallet signature'] });
  });
  it('refuses a plausible dollar total priced from stale, offline or unidentified markets', () => {
    for (const source of ['stale', 'offline', undefined]) {
      expect(check({ portfolio: { ...portfolio, priceDataStatus: source } })).toMatchObject({
        ok: false, code: 'PRICE_NOT_LIVE'
      });
    }
  });
  it('never uses old balances, partial chains or a mismatched signer as a new preflight', () => {
    expect(check({ portfolio: { ...portfolio, fetchedAt: NOW - 120_001 } }).code).toBe('PORTFOLIO_STALE');
    expect(check({ portfolio: { ...portfolio, partial: true } }).code).toBe('PORTFOLIO_NOT_LIVE');
    expect(check({ wallet: { ...wallet, canSign: false } }).code).toBe('WALLET_CANNOT_SIGN');
  });
});
