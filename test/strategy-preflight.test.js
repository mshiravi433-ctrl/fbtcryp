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

  /*
   * The reported live failure, as a test: «پیش‌پرواز تأیید نشد (WALLET_REQUIRED).
   * کیف پول را وصل کن» shown to a user whose in-app wallet was attached but
   * LOCKED — address on screen, lease alive, password missing. Attached is not
   * "no wallet"; it is a signer problem, and its remedy is unlocking. A
   * snapshot with no session at all still gets WALLET_REQUIRED.
   */
  it('calls a locked but attached wallet a signer problem, not a missing wallet', () => {
    const locked = { ...wallet, connected: false, isConnected: false, attached: true, locked: true, canSign: false };
    expect(check({ wallet: locked })).toMatchObject({
      ok: false, code: 'WALLET_CANNOT_SIGN', remedy: 'UNLOCK_WALLET'
    });
    expect(check({ wallet: { ...locked, attached: false } })).toMatchObject({
      ok: false, code: 'WALLET_REQUIRED', remedy: 'CONNECT_WALLET'
    });
  });

  /*
   * A chain the plan never touches cannot invalidate its capital. The reader
   * polls sixteen networks; on a phone one of them is always slow, and the
   * whole-book `partial` flag used to refuse a Base-only plan for it — the
   * report «هیچ مرحله‌ای اجرا یا تأیید نشد» with the wallet connected and the
   * money sitting right there on the signer chain.
   */
  it('judges completeness on the plan\'s own chains when the read names them', () => {
    const scoped = {
      ...portfolio, partial: true, totalValueUsd: 1500,
      chains: [
        { chainId: 8453, failed: false, stale: false, unpriced: 0 },
        { chainId: 137, failed: true, stale: false, unpriced: 0 }
      ],
      holdings: [
        { symbol: 'USDC', chainId: 8453, valueUsd: 1200 },
        { symbol: 'POL', chainId: 137, valueUsd: 300 }
      ]
    };
    /* The app's own shape: `dataStatus` is 'partial' because ONE unrelated
       chain failed, while every chain the plan uses read completely. */
    expect(check({ portfolio: { ...scoped, dataStatus: 'partial' } }))
      .toMatchObject({ ok: true, availableUsd: 1200 });
    /* A read still running, or failed everywhere, is never scoped away. */
    expect(check({ portfolio: { ...scoped, dataStatus: 'pending' } })).toMatchObject({ ok: false, code: 'PORTFOLIO_NOT_LIVE' });
    expect(check({ portfolio: { ...scoped, dataStatus: 'error' } })).toMatchObject({ ok: false, code: 'PORTFOLIO_NOT_LIVE' });
    /* The plan's OWN chain is the one that failed — now it must refuse. */
    expect(check({ portfolio: { ...scoped, chains: [
      { chainId: 8453, failed: true, stale: false, unpriced: 0 },
      { chainId: 137, failed: false, stale: false, unpriced: 0 }
    ] } })).toMatchObject({ ok: false, code: 'PORTFOLIO_NOT_LIVE' });
    /* An unpriced non-zero row on the plan chain is a gap too. */
    expect(check({ portfolio: { ...scoped, chains: [
      { chainId: 8453, failed: false, stale: false, unpriced: 1 }
    ] } })).toMatchObject({ ok: false, code: 'PORTFOLIO_NOT_LIVE' });
  });
});
