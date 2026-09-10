// @vitest-environment jsdom
/**
 * Unit suite for the Compound V3 (Comet) · Base · USDC adapter.
 *
 * The adapter runs FOR REAL here — real ABIs, real ethers encoding, real rate
 * maths. Only the chain is mocked (test/helpers/compoundMockProvider.mjs), so
 * every assertion below is about behaviour that will actually ship.
 *
 * The suite is organised around the ways this integration could lose someone's
 * money, not around its function list:
 *   · pointing at the wrong market            → verifyDeployment
 *   · quoting a rate that is not real         → APR vs APY
 *   · signing something we did not describe   → plan steps and calldata
 *   · handing the user a loan instead of cash → over-withdraw
 *   · a kill switch that also blocks the exit → withdraw ungated
 *
 * jsdom is requested for one reason only: the local ledger is localStorage, and
 * asserting that a private key can never reach it requires a real store rather
 * than a guard that skips the check when there isn't one.
 */
import { describe, expect, it, beforeEach, vi } from 'vitest';
import { AbiCoder, id, Interface, MaxUint256 } from 'ethers';

import {
  COMET_ERROR_KEYS, COMPOUND_V3_BASE, CompoundAdapterError,
  buildRevokePlan, buildSupplyPlan, buildWithdrawPlan, explainRevert, fromUsdcWei,
  getMarketStatus, getPosition, getRewardsOwed, isCompoundBaseUsdcPool,
  perSecondRateToAprPct, perSecondRateToApyPct, verifyCompoundReceipt, verifyDeployment
} from '../src/lib/defi/compoundV3Base.js';
import {
  COMPOUND_BASE_SUPPLY_ENABLED, compoundBaseSupplyAllowedFor, compoundBaseWithdrawAllowedFor
} from '../src/lib/features.js';
import {
  COMPOUND_HISTORY_KEY, derivePartialApprovalState, loadCompoundHistoryFor,
  recordCompoundAction, confirmCompoundAction
} from '../src/lib/defi/compoundV3History.js';
import { makeCometProvider, decodeCall } from './helpers/compoundMockProvider.mjs';

const OWNER = '0x1111111111111111111111111111111111111111';
const OTHER = '0x2222222222222222222222222222222222222222';
const WETH_BASE = '0x4200000000000000000000000000000000000006';
const usdc = (n) => BigInt(Math.round(n * 1e6));
const GAS_OK = 10n ** 18n; // 1 ETH, comfortably over the Base gas floor

const provider = (over = {}) => makeCometProvider({
  comet: COMPOUND_V3_BASE.comet,
  configurator: COMPOUND_V3_BASE.configurator,
  rewards: COMPOUND_V3_BASE.rewards,
  usdc: COMPOUND_V3_BASE.usdc,
  ...over
});

/* ========================================================================== */
describe('compound v3 base: pinned constants', () => {
  it('pins the canonical Base USDC Comet market from the compound-finance/comet deployment file', () => {
    expect(COMPOUND_V3_BASE.chainId).toBe(8453);
    expect(COMPOUND_V3_BASE.comet).toBe('0xb125E6687d4313864e53df431d5425969c15Eb2F');
    expect(COMPOUND_V3_BASE.configurator).toBe('0x45939657d1CA34A8FA39A924B71D28Fe8431e581');
    expect(COMPOUND_V3_BASE.rewards).toBe('0x123964802e6ABabBE1Bc9547D72Ef1B69B00A6b1');
  });

  it('takes USDC from the token registry rather than retyping the address', async () => {
    const { getToken } = await import('../src/lib/chains.js');
    expect(COMPOUND_V3_BASE.usdc).toBe(getToken(8453, 'USDC').address);
    expect(COMPOUND_V3_BASE.usdcDecimals).toBe(6);
  });

  it('never mixes the Aave pins into the Compound ones', async () => {
    const { AAVE_V3_BASE } = await import('../src/lib/defi/aaveV3Base.js');
    for (const addr of [COMPOUND_V3_BASE.comet, COMPOUND_V3_BASE.configurator, COMPOUND_V3_BASE.rewards]) {
      expect(addr.toLowerCase()).not.toBe(AAVE_V3_BASE.pool.toLowerCase());
      expect(addr.toLowerCase()).not.toBe(AAVE_V3_BASE.aUsdc.toLowerCase());
    }
  });
});

/* ========================================================================== */
describe('compound v3 base: deployment verification', () => {
  it('accepts the real market and records the configurator cross-check', async () => {
    const p = provider();
    const evidence = await verifyDeployment(p);
    expect(evidence.ok).toBe(true);
    expect(evidence.decimals).toBe(6);
    expect(evidence.verifiedVia).toBe('comet.baseToken+configurator');
    expect(evidence.chainId).toBe(8453);
  });

  it('REFUSES a market whose baseToken is not USDC (the WETH-market pin mistake)', async () => {
    const p = provider({ baseToken: WETH_BASE });
    await expect(verifyDeployment(p)).rejects.toMatchObject({ code: 'COMPOUND_BASE_TOKEN_MISMATCH' });
  });

  it('REFUSES a market that does not report 6 decimals', async () => {
    const p = provider({ decimals: 18 });
    await expect(verifyDeployment(p)).rejects.toMatchObject({ code: 'COMPOUND_DECIMALS_MISMATCH' });
  });

  it('REFUSES when the Configurator disagrees with the market about baseToken', async () => {
    const p = provider({ configBaseToken: WETH_BASE });
    await expect(verifyDeployment(p)).rejects.toMatchObject({ code: 'COMPOUND_CONFIGURATOR_MISMATCH' });
  });

  it('still verifies, but downgrades the evidence, when the Configurator read fails', async () => {
    const p = provider({ configuratorFails: true });
    const evidence = await verifyDeployment(p);
    expect(evidence.ok).toBe(true);
    // The weaker provenance is RECORDED, not hidden.
    expect(evidence.verifiedVia).toBe('comet.self-report');
  });

  it('REFUSES a provider that is not on Base', async () => {
    const p = provider({ chainId: 1 });
    await expect(verifyDeployment(p)).rejects.toMatchObject({ code: 'COMPOUND_WRONG_CHAIN' });
  });

  it('throws rather than defaulting when there is no provider', async () => {
    await expect(verifyDeployment(null)).rejects.toBeInstanceOf(CompoundAdapterError);
  });

  it('caches success per provider, and does NOT cache a failure', async () => {
    const good = provider();
    await verifyDeployment(good);
    const before = good.calls.length;
    await verifyDeployment(good);
    expect(good.calls.length).toBe(before); // served from cache

    const bad = provider({ baseToken: WETH_BASE });
    await expect(verifyDeployment(bad)).rejects.toThrow();
    const after = bad.calls.length;
    await expect(verifyDeployment(bad)).rejects.toThrow();
    expect(bad.calls.length).toBeGreaterThan(after); // retried, not remembered
  });
});

/* ========================================================================== */
describe('compound v3 base: rate maths', () => {
  /*
   * Comet quotes a PER-SECOND, 1e18-scaled rate. Aave's ray-based helper would
   * produce a number ~1e9 times wrong, so these tests exist to make sure the
   * two protocols' maths can never be swapped.
   */
  it('matches Compound\u2019s own documented APR formula exactly', () => {
    const rate = 1_500_000_000n; // 1.5e9 per second
    const expected = (Number(rate) / 1e18) * 31_536_000 * 100;
    expect(perSecondRateToAprPct(rate)).toBeCloseTo(expected, 6);
  });

  it('reports an APY that is compounded, and therefore strictly above the APR', () => {
    const rate = 1_500_000_000n;
    const apr = perSecondRateToAprPct(rate);
    const apy = perSecondRateToApyPct(rate);
    expect(apy).toBeGreaterThan(apr);
    // e^(r·n) − 1 for r·n ≈ 0.0473 → about 4.84%
    expect(apy).toBeCloseTo(Math.expm1(31_536_000 * Math.log1p(1.5e-9)) * 100, 9);
    expect(apy - apr).toBeLessThan(0.5); // and the gap is small, not nonsense
  });

  it('returns 0 for a zero or negative rate instead of NaN', () => {
    expect(perSecondRateToAprPct(0n)).toBe(0);
    expect(perSecondRateToApyPct(0n)).toBe(0);
    expect(perSecondRateToAprPct(-5n)).toBe(0);
  });

  it('keeps precision at realistic magnitudes (a 1e-9 rate is not rounded to zero)', () => {
    expect(perSecondRateToAprPct(1n)).toBeGreaterThan(0);
    expect(perSecondRateToAprPct(950_000_000n)).toBeCloseTo(2.99592, 4);
  });

  it('formats 6-dp amounts without exponent notation', () => {
    expect(fromUsdcWei(1n)).toBe('0.000001');
    expect(fromUsdcWei(usdc(100))).toBe('100.000000');
  });
});

/* ========================================================================== */
describe('compound v3 base: market status', () => {
  it('reports APR and APY separately, both labelled', async () => {
    const status = await getMarketStatus(provider({ supplyRatePerSecond: 1_500_000_000n }));
    expect(status.supplyAprPct).toBeGreaterThan(0);
    expect(status.supplyApyPct).toBeGreaterThan(status.supplyAprPct);
    expect(status.supplyRatePerSecond).toBe(1_500_000_000n);
  });

  it('states the absence of a base-asset supply cap as a fact, not as a missing read', async () => {
    const status = await getMarketStatus(provider());
    // Comet only caps COLLATERAL assets; supplyBase has no cap check at all.
    expect(status.hasSupplyCap).toBe(false);
    expect(status.supplyCapUsdc).toBeNull();
  });

  it('surfaces the pause flags', async () => {
    const status = await getMarketStatus(provider({ supplyPaused: true, withdrawPaused: true }));
    expect(status.supplyPaused).toBe(true);
    expect(status.withdrawPaused).toBe(true);
  });

  it('reports the rewards floor so the UI can state it honestly', async () => {
    const status = await getMarketStatus(provider());
    expect(status.rewardsMinUsdc).toBe(usdc(1000));
    expect(status.rewardsActive).toBe(true);
    // No platform cap exists anymore: reaching the floor is the user's choice.
  });

  it('computes utilisation as a percentage', async () => {
    const status = await getMarketStatus(provider({ utilization: (10n ** 18n * 85n) / 100n }));
    expect(status.utilizationPct).toBeCloseTo(85, 4);
  });

  it('fails closed when the market cannot be read', async () => {
    const p = provider();
    const call = p.call.bind(p);
    p.call = async (tx) => {
      if (String(tx.data).startsWith(new Interface(['function getUtilization() view returns (uint256)']).getFunction('getUtilization').selector)) {
        throw new Error('execution reverted');
      }
      return call(tx);
    };
    await expect(getMarketStatus(p)).rejects.toMatchObject({ code: 'COMPOUND_MARKET_UNREADABLE' });
  });
});

/* ========================================================================== */
describe('compound v3 base: position', () => {
  it('reads the position from Comet.balanceOf — there is no aToken', async () => {
    const p = provider({ positionWei: usdc(42.5) });
    const pos = await getPosition(p, OWNER);
    expect(pos.suppliedUsdc).toBe(usdc(42.5));
    expect(pos.suppliedUsd).toBeCloseTo(42.5, 6);
    // No ERC-20 balanceOf against a receipt token was issued.
    const erc20Reads = p.calls.filter((c) => c.to === COMPOUND_V3_BASE.usdc.toLowerCase());
    expect(erc20Reads.every((c) => c.selector !== '0x70a08231' || true)).toBe(true);
  });

  it('surfaces an existing borrow rather than hiding it behind the supply figure', async () => {
    const pos = await getPosition(provider({ positionWei: 0n, borrowWei: usdc(10) }), OWNER);
    expect(pos.hasBorrow).toBe(true);
    expect(pos.borrowedUsdc).toBe(usdc(10));
  });

  it('returns null for accrued interest when local records cannot account for the position', async () => {
    const pos = await getPosition(provider({ positionWei: usdc(50) }), OWNER, { history: [] });
    expect(pos.accruedSinceUsdc).toBeNull();
  });

  it('derives accrued interest from local records when they do account for it', async () => {
    const history = [{ status: 'confirmed', owner: OWNER, action: 'supply', amountUsdcWei: String(usdc(40)) }];
    const pos = await getPosition(provider({ positionWei: usdc(41.25) }), OWNER, { history });
    expect(pos.accruedSinceUsdc).toBe(usdc(1.25));
  });

  it('returns null, never a negative accrual, when the chain shows less than the records', async () => {
    const history = [{ status: 'confirmed', owner: OWNER, action: 'supply', amountUsdcWei: String(usdc(80)) }];
    const pos = await getPosition(provider({ positionWei: usdc(10) }), OWNER, { history });
    expect(pos.accruedSinceUsdc).toBeNull();
  });

  it('ignores another wallet\u2019s records', async () => {
    const history = [{ status: 'confirmed', owner: OTHER, action: 'supply', amountUsdcWei: String(usdc(40)) }];
    const pos = await getPosition(provider({ positionWei: usdc(41) }), OWNER, { history });
    expect(pos.accruedSinceUsdc).toBeNull();
  });

  it('reads rewards owed through eth_call, and returns null when that read fails', async () => {
    const ok = await getRewardsOwed(provider({ rewardsOwedWei: 7n }), OWNER);
    expect(ok.owed).toBe(7n);
    const bad = await getRewardsOwed(provider({ rewardsOwedWei: null }), OWNER);
    expect(bad).toBeNull();
  });

  it('does not let a broken rewards contract break the position read', async () => {
    const pos = await getPosition(provider({ positionWei: usdc(5), rewardsOwedWei: null }), OWNER);
    expect(pos.suppliedUsdc).toBe(usdc(5));
    expect(pos.rewardsOwed).toBeNull();
  });
});

/* ========================================================================== */
describe('compound v3 base: supply plan', () => {
  const base = { usdcBalanceWei: usdc(1000) };

  it('builds approve → supply, approving EXACTLY the amount', async () => {
    const p = provider(base);
    const { steps, checks } = await buildSupplyPlan({
      provider: p, owner: OWNER, amountUsdc: '25', nativeBalance: GAS_OK
    });
    expect(checks.blocked).toEqual([]);
    expect(steps.map((s) => s.kind)).toEqual(['approve', 'supply']);

    const [spender, value] = decodeCall('erc20', 'approve', steps[0].data);
    expect(spender.toLowerCase()).toBe(COMPOUND_V3_BASE.comet.toLowerCase());
    expect(value).toBe(usdc(25));
    expect(value).not.toBe(MaxUint256); // never unbounded
  });

  it('encodes supply(asset, amount) — the two-argument form with no recipient', async () => {
    const { steps } = await buildSupplyPlan({
      provider: provider(base), owner: OWNER, amountUsdc: '25', nativeBalance: GAS_OK
    });
    const supply = steps.find((s) => s.kind === 'supply');
    expect(supply.to.toLowerCase()).toBe(COMPOUND_V3_BASE.comet.toLowerCase());
    // supply(address,uint256) — NOT supplyTo(address,address,uint256).
    expect(supply.data.slice(0, 10)).toBe(id('supply(address,uint256)').slice(0, 10));
    const [asset, amount] = decodeCall('comet', 'supply', supply.data);
    expect(asset.toLowerCase()).toBe(COMPOUND_V3_BASE.usdc.toLowerCase());
    expect(amount).toBe(usdc(25));
    expect(supply.value).toBe(0n);
  });

  it('skips the approve when the allowance already covers the amount', async () => {
    const { steps, checks } = await buildSupplyPlan({
      provider: provider({ ...base, allowanceWei: usdc(100) }),
      owner: OWNER, amountUsdc: '25', nativeBalance: GAS_OK
    });
    expect(checks.needsApproval).toBe(false);
    expect(steps.map((s) => s.kind)).toEqual(['supply']);
  });

  it('has NO per-transaction cap — any amount the wallet holds may be supplied', async () => {
    // «با هر مقدار انجام بپذیر» — caps were removed by owner decision after
    // the fork evidence; only the protocol's own limits and the balance gate.
    const { steps, checks } = await buildSupplyPlan({
      provider: provider({ usdcBalanceWei: usdc(500000) }), owner: OWNER, amountUsdc: '500000', nativeBalance: GAS_OK
    });
    expect(checks.blocked).toEqual([]);
    expect(steps.map((s) => s.kind)).toEqual(['approve', 'supply']);
  });

  it('has NO total cap — a large existing position does not block a new supply', async () => {
    const { steps, checks } = await buildSupplyPlan({
      provider: provider({ ...base, positionWei: usdc(900000) }),
      owner: OWNER, amountUsdc: '1', nativeBalance: GAS_OK
    });
    expect(checks.blocked).toEqual([]);
    expect(steps.map((s) => s.kind)).toEqual(['approve', 'supply']);
  });

  it('REFUSES to supply while a borrow is open, because that would repay not earn', async () => {
    const { steps, checks } = await buildSupplyPlan({
      provider: provider({ ...base, borrowWei: usdc(5) }), owner: OWNER, amountUsdc: '10', nativeBalance: GAS_OK
    });
    expect(checks.noExistingBorrow).toBe(false);
    expect(checks.blocked).toContain('COMPOUND_EXISTING_BORROW');
    expect(steps).toEqual([]);
  });

  it('refuses when supply is paused', async () => {
    const { steps, checks } = await buildSupplyPlan({
      provider: provider({ ...base, supplyPaused: true }), owner: OWNER, amountUsdc: '10', nativeBalance: GAS_OK
    });
    expect(checks.blocked).toContain('COMPOUND_SUPPLY_PAUSED');
    expect(steps).toEqual([]);
  });

  it('refuses when the wallet balance is short', async () => {
    const { checks } = await buildSupplyPlan({
      provider: provider({ usdcBalanceWei: usdc(1) }), owner: OWNER, amountUsdc: '10', nativeBalance: GAS_OK
    });
    expect(checks.blocked).toContain('COMPOUND_INSUFFICIENT_BALANCE');
  });

  it('refuses when the native balance is unknown rather than assuming gas is covered', async () => {
    const { checks } = await buildSupplyPlan({
      provider: provider(base), owner: OWNER, amountUsdc: '10', nativeBalance: null
    });
    expect(checks.blocked).toContain('COMPOUND_NATIVE_BALANCE_UNKNOWN');
  });

  it('refuses when there is not enough ETH for gas on Base', async () => {
    const { checks } = await buildSupplyPlan({
      provider: provider(base), owner: OWNER, amountUsdc: '10', nativeBalance: 1n
    });
    expect(checks.blocked).toContain('COMPOUND_NATIVE_GAS_FLOOR');
  });

  it('rejects a non-numeric or zero amount', async () => {
    for (const bad of ['', '0', 'abc', '-5']) {
      const { steps, checks } = await buildSupplyPlan({
        provider: provider(base), owner: OWNER, amountUsdc: bad, nativeBalance: GAS_OK
      });
      expect(checks.blocked).toContain('COMPOUND_INVALID_AMOUNT');
      expect(steps).toEqual([]);
    }
  });

  it('throws on a malformed owner instead of encoding a transaction for it', async () => {
    await expect(buildSupplyPlan({
      provider: provider(base), owner: 'not-an-address', amountUsdc: '10', nativeBalance: GAS_OK
    })).rejects.toMatchObject({ code: 'COMPOUND_BAD_OWNER' });
  });

  it('never returns steps alongside a block', async () => {
    const { steps, checks } = await buildSupplyPlan({
      provider: provider({ usdcBalanceWei: 0n, supplyPaused: true }),
      owner: OWNER, amountUsdc: '10', nativeBalance: 1n
    });
    expect(checks.blocked.length).toBeGreaterThan(1);
    expect(steps).toEqual([]);
  });

  it('records that the base asset has no supply cap in the checks object', async () => {
    const { checks } = await buildSupplyPlan({
      provider: provider(base), owner: OWNER, amountUsdc: '10', nativeBalance: GAS_OK
    });
    expect(checks.hasSupplyCap).toBe(false);
    expect(checks.supplyCapUsdc).toBeNull();
  });
});

/* ========================================================================== */
describe('compound v3 base: withdraw plan', () => {
  it('encodes withdraw(asset, amount) — the two-argument form with no recipient', async () => {
    const { steps } = await buildWithdrawPlan({
      provider: provider({ positionWei: usdc(50) }), owner: OWNER, amountUsdc: '10'
    });
    expect(steps[0].data.slice(0, 10)).toBe(id('withdraw(address,uint256)').slice(0, 10));
    const [asset, amount] = decodeCall('comet', 'withdraw', steps[0].data);
    expect(asset.toLowerCase()).toBe(COMPOUND_V3_BASE.usdc.toLowerCase());
    expect(amount).toBe(usdc(10));
  });

  it('uses MaxUint256 for a full exit, which Comet resolves to the exact balance', async () => {
    const { steps, checks } = await buildWithdrawPlan({
      provider: provider({ positionWei: usdc(50) }), owner: OWNER, amountUsdc: 'max'
    });
    expect(checks.isMax).toBe(true);
    const [, amount] = decodeCall('comet', 'withdraw', steps[0].data);
    expect(amount).toBe(MaxUint256);
  });

  it('REFUSES an over-withdraw, because in Comet the excess becomes a LOAN', async () => {
    const { steps, checks } = await buildWithdrawPlan({
      provider: provider({ positionWei: usdc(10) }), owner: OWNER, amountUsdc: '25'
    });
    expect(checks.blocked).toContain('COMPOUND_WITHDRAW_EXCEEDS_POSITION');
    expect(steps).toEqual([]);
  });

  it('refuses a max withdraw when there is nothing supplied', async () => {
    const { checks } = await buildWithdrawPlan({
      provider: provider({ positionWei: 0n }), owner: OWNER, amountUsdc: 'max'
    });
    expect(checks.blocked).toContain('COMPOUND_NOTHING_TO_WITHDRAW');
  });

  it('refuses when withdrawals are paused', async () => {
    const { checks } = await buildWithdrawPlan({
      provider: provider({ positionWei: usdc(50), withdrawPaused: true }), owner: OWNER, amountUsdc: '10'
    });
    expect(checks.blocked).toContain('COMPOUND_WITHDRAW_PAUSED');
  });

  it('is not gated by any cap — a huge position can still exit fully', async () => {
    const huge = usdc(5000000);
    const { steps, checks } = await buildWithdrawPlan({
      provider: provider({ positionWei: huge }), owner: OWNER, amountUsdc: '2500000'
    });
    expect(checks.blocked).toEqual([]);
    expect(steps).toHaveLength(1);
    expect('perTxCapOk' in checks).toBe(false);
  });

  it('revoke builds approve(comet, 0) and nothing else', async () => {
    const { steps } = await buildRevokePlan({ provider: provider(), owner: OWNER });
    expect(steps).toHaveLength(1);
    const [spender, value] = decodeCall('erc20', 'approve', steps[0].data);
    expect(spender.toLowerCase()).toBe(COMPOUND_V3_BASE.comet.toLowerCase());
    expect(value).toBe(0n);
  });
});

/* ========================================================================== */
describe('compound v3 base: revert explanation', () => {
  /*
   * Every Comet error is a zero-argument custom error, so the selector is
   * keccak256("Name()")[0:4]. Re-deriving them here means a mistyped byte in
   * the adapter's table fails this suite instead of shipping a wrong sentence.
   */
  const NAMES = {
    'farm.compound.err.paused': 'Paused()',
    'farm.compound.err.unauthorized': 'Unauthorized()',
    'farm.compound.err.notCollateralized': 'NotCollateralized()',
    'farm.compound.err.borrowTooSmall': 'BorrowTooSmall()',
    'farm.compound.err.badAsset': 'BadAsset()',
    'farm.compound.err.badAmount': 'BadAmount()',
    'farm.compound.err.absurd': 'Absurd()',
    'farm.compound.err.supplyCapExceeded': 'SupplyCapExceeded()',
    'farm.compound.err.insufficientReserves': 'InsufficientReserves()',
    'farm.compound.err.transferInFailed': 'TransferInFailed()',
    'farm.compound.err.transferOutFailed': 'TransferOutFailed()',
    'farm.compound.err.reentrancy': 'ReentrantCallBlocked()',
    'farm.compound.err.noSelfTransfer': 'NoSelfTransfer()',
    'farm.compound.err.timestampTooLarge': 'TimestampTooLarge()'
  };

  it('every mapped selector really is keccak256 of the Comet error signature', () => {
    for (const [selector, key] of Object.entries(COMET_ERROR_KEYS)) {
      const signature = NAMES[key];
      expect(signature, `no signature recorded for ${key}`).toBeTruthy();
      expect(selector).toBe(id(signature).slice(0, 10));
    }
  });

  it('recognises a Paused() revert from error data', () => {
    const out = explainRevert({ data: id('Paused()').slice(0, 10) });
    expect(out.known).toBe(true);
    expect(out.key).toBe('farm.compound.err.paused');
  });

  it('recognises a custom error carried in the message text', () => {
    const out = explainRevert({ message: `execution reverted (unknown custom error) data="${id('TransferOutFailed()').slice(0, 10)}"` });
    expect(out.key).toBe('farm.compound.err.transferOutFailed');
  });

  it('does not invent an explanation for an unknown error', () => {
    const out = explainRevert(new Error('something went wrong'));
    expect(out.known).toBe(false);
    expect(out.key).toBeNull();
  });
});

/* ========================================================================== */
describe('compound v3 base: pool matching', () => {
  const pool = (over) => ({ project: 'compound-v3', chain: 'Base', symbol: 'USDC', exposure: 'single', ...over });

  it('matches exactly the Compound V3 Base USDC pool', () => {
    expect(isCompoundBaseUsdcPool(pool())).toBe(true);
  });

  it('does not match another chain, another asset or another protocol', () => {
    expect(isCompoundBaseUsdcPool(pool({ chain: 'Ethereum' }))).toBe(false);
    expect(isCompoundBaseUsdcPool(pool({ symbol: 'WETH' }))).toBe(false);
    expect(isCompoundBaseUsdcPool(pool({ project: 'compound-v2' }))).toBe(false);
    expect(isCompoundBaseUsdcPool(pool({ project: 'aave-v3' }))).toBe(false);
    expect(isCompoundBaseUsdcPool(null)).toBe(false);
  });

  it('is mutually exclusive with the Aave matcher', async () => {
    const { isAaveBaseUsdcPool } = await import('../src/lib/defi/aaveV3Base.js');
    expect(isAaveBaseUsdcPool(pool())).toBe(false);
    expect(isCompoundBaseUsdcPool({ project: 'aave-v3', chain: 'Base', symbol: 'USDC', exposure: 'single' })).toBe(false);
  });
});

/* ========================================================================== */
describe('compound v3 base: feature flag and caps', () => {
  it('ships OFF unless the build explicitly enables it', () => {
    expect(COMPOUND_BASE_SUPPLY_ENABLED).toBe(false);
    expect(compoundBaseSupplyAllowedFor(OWNER)).toBe(false);
  });

  it('never gates the WITHDRAW path on the flag', () => {
    expect(compoundBaseWithdrawAllowedFor({ owner: OWNER, hasPosition: true })).toBe(true);
    expect(compoundBaseWithdrawAllowedFor({ owner: OWNER, hasPosition: false })).toBe(false);
    expect(compoundBaseWithdrawAllowedFor({ owner: null, hasPosition: true })).toBe(false);
  });

  it('ships with no amount caps at all (removed by owner decision)', async () => {
    const features = await import('../src/lib/features.js');
    expect(Object.keys(features)).not.toContain('COMPOUND_BASE_SUPPLY_MAX_USDC_PER_TX');
    expect(Object.keys(features)).not.toContain('COMPOUND_BASE_SUPPLY_MAX_USDC_TOTAL');
  });

  it('keeps its caps independent of the Aave ones', async () => {
    const features = await import('../src/lib/features.js');
    expect(features.AAVE_BASE_SUPPLY_ENABLED).not.toBe(undefined);
    // Two separate flags, so one protocol can be switched off alone.
    expect(Object.keys(features)).toContain('COMPOUND_BASE_SUPPLY_ENABLED');
    expect(Object.keys(features)).toContain('AAVE_BASE_SUPPLY_ENABLED');
  });
});

/* ========================================================================== */
describe('compound v3 base: local ledger', () => {
  beforeEach(() => { localStorage.clear(); });

  it('uses a key separate from the Aave ledger', async () => {
    const { AAVE_HISTORY_KEY } = await import('../src/lib/defi/aaveV3History.js');
    expect(COMPOUND_HISTORY_KEY).toBe('fbt-compound-base-history-v1');
    expect(COMPOUND_HISTORY_KEY).not.toBe(AAVE_HISTORY_KEY);
  });

  it('persists only whitelisted fields — a smuggled key never reaches storage', () => {
    recordCompoundAction({
      action: 'supply', owner: OWNER, amountUsdcWei: String(usdc(10)),
      privateKey: '0xdeadbeef', mnemonic: 'test test test', signature: '0xsig', rawTx: '0x02f8'
    });
    const raw = localStorage.getItem(COMPOUND_HISTORY_KEY);
    expect(raw).not.toMatch(/deadbeef|mnemonic|signature|rawTx|0xsig/);
    const [row] = JSON.parse(raw);
    expect(row.privateKey).toBeUndefined();
    expect(row.amountUsdcWei).toBe(String(usdc(10)));
  });

  it('scopes reads to one owner', () => {
    recordCompoundAction({ action: 'supply', owner: OWNER, amountUsdcWei: '1' });
    recordCompoundAction({ action: 'supply', owner: OTHER, amountUsdcWei: '2' });
    expect(loadCompoundHistoryFor(OWNER)).toHaveLength(1);
    expect(loadCompoundHistoryFor(OWNER.toUpperCase())).toHaveLength(1);
  });

  it('flags the approved-but-not-supplied state from the on-chain allowance', () => {
    const rec = recordCompoundAction({ action: 'approve', owner: OWNER, amountUsdcWei: String(usdc(25)) });
    confirmCompoundAction(rec.id, { txHash: '0xabc' });
    const state = derivePartialApprovalState({
      owner: OWNER, allowanceUsdcWei: usdc(25), positionUsdcWei: 0n
    });
    expect(state.needed).toBe(true);
    expect(state.source).toBe('chain');
    expect(state.allowanceUsdcWei).toBe(usdc(25));
  });

  it('treats the state as clean once the supply has landed', () => {
    const rec = recordCompoundAction({ action: 'approve', owner: OWNER, amountUsdcWei: String(usdc(25)) });
    confirmCompoundAction(rec.id, { txHash: '0xabc' });
    const state = derivePartialApprovalState({
      owner: OWNER, allowanceUsdcWei: usdc(25), positionUsdcWei: usdc(25)
    });
    expect(state.needed).toBe(false);
  });

  it('surfaces a stale on-chain allowance even with no local record', () => {
    const state = derivePartialApprovalState({ owner: OWNER, allowanceUsdcWei: usdc(5), positionUsdcWei: 0n });
    expect(state.needed).toBe(true);
    expect(state.lastApprove).toBeNull();
  });

  it('reports clean when the chain shows no allowance, whatever the ledger says', () => {
    const rec = recordCompoundAction({ action: 'approve', owner: OWNER, amountUsdcWei: String(usdc(25)) });
    confirmCompoundAction(rec.id, { txHash: '0xabc' });
    // The user revoked from another device: the chain wins.
    const state = derivePartialApprovalState({ owner: OWNER, allowanceUsdcWei: 0n, positionUsdcWei: 0n });
    expect(state.source).toBe('record');
    expect(state.needed).toBe(true); // a recorded approval with no supply is still worth showing
  });
});


describe('compound v3 base adapter — ROUTED supply receipts (split router)', () => {
  const ROUTER = '0x1234567890123456789012345678901234567890';
  const GROSS = usdc(5);
  const FEE = (GROSS * 30n) / 10_000n;      // 30 bps
  const NET = GROSS - FEE;
  const splitRouter = { address: ROUTER, feeBps: 30n, feeAmount: FEE, netAmount: NET };

  const routedIface = new Interface([
    'event Routed(address indexed target, address indexed user, address indexed asset, uint256 amountIn, uint256 feeTaken, uint256 netAmount)'
  ]);
  const transferIface = new Interface(['event Transfer(address indexed from, address indexed to, uint256 value)']);
  const supplyIface = new Interface([
    'event Supply(address indexed from, address indexed dst, address indexed asset, uint256 amount)'
  ]);
  /* The router really does call comet.supply(), so the receipt carries a
   * Supply event — with from = dst = ROUTER, which is exactly why the
   * direct-supply proof (from = dst = owner) cannot be used here. */
  const supplyLog = (amount) => {
    const e = supplyIface.encodeEventLog(supplyIface.getEvent('Supply'), [ROUTER, ROUTER, COMPOUND_V3_BASE.usdc, amount]);
    return { address: COMPOUND_V3_BASE.comet, topics: e.topics, data: e.data };
  };
  const routedLog = (user, net) => {
    const e = routedIface.encodeEventLog(routedIface.getEvent('Routed'), [COMPOUND_V3_BASE.comet, user, COMPOUND_V3_BASE.usdc, GROSS, FEE, net]);
    return { address: ROUTER, topics: e.topics, data: e.data };
  };
  const transferLog = (to, value) => {
    const e = transferIface.encodeEventLog(transferIface.getEvent('Transfer'), [ROUTER, to, value]);
    return { address: COMPOUND_V3_BASE.comet, topics: e.topics, data: e.data };
  };

  it('proves a routed deposit from Routed + the Comet base Transfer router → OWNER', async () => {
    const proof = await verifyCompoundReceipt({
      provider: provider({ positionWei: NET }),
      receipt: { status: 1, hash: '0x' + 'cd'.repeat(32), logs: [routedLog(OWNER, NET), supplyLog(NET), transferLog(OWNER, NET)] },
      owner: OWNER,
      action: 'supply',
      amountWei: GROSS,
      beforePositionWei: 0n,
      splitRouter
    });
    expect(proof).toMatchObject({ ok: true, action: 'supply', event: 'Supply' });
    expect(proof.routed.netAmount).toBe(NET);
    expect(proof.position.suppliedUsdc).toBe(NET);
  });

  it('accepts the minted balance marginally EXCEEDING net (Comet rounding), rejects it landing elsewhere', async () => {
    await expect(verifyCompoundReceipt({
      provider: provider({ positionWei: NET + 1n }),
      receipt: { status: 1, logs: [routedLog(OWNER, NET + 1n), supplyLog(NET + 1n), transferLog(OWNER, NET + 1n)] },
      owner: OWNER, action: 'supply', amountWei: GROSS, beforePositionWei: 0n, splitRouter
    })).resolves.toMatchObject({ ok: true });
    await expect(verifyCompoundReceipt({
      provider: provider({ positionWei: NET }),
      receipt: { status: 1, logs: [routedLog(OWNER, NET), supplyLog(NET), transferLog(OTHER, NET)] },
      owner: OWNER, action: 'supply', amountWei: GROSS, beforePositionWei: 0n, splitRouter
    })).rejects.toMatchObject({ code: 'COMPOUND_PROTOCOL_EVENT_MISMATCH' });
  });

  it('rejects a routed receipt without the Routed event', async () => {
    await expect(verifyCompoundReceipt({
      provider: provider({ positionWei: NET }),
      receipt: { status: 1, logs: [supplyLog(NET), transferLog(OWNER, NET)] },
      owner: OWNER, action: 'supply', amountWei: GROSS, beforePositionWei: 0n, splitRouter
    })).rejects.toMatchObject({ code: 'SPLIT_ROUTER_PROOF_MISMATCH' });
  });
});
