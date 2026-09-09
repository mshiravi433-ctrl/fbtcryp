/**
 * SPLIT ROUTER — client seam unit tests.
 * ---------------------------------------------------------------------------
 * The two contracts this file pins:
 *
 *   1. DORMANT BY DEFAULT. With no VITE_FBT_SPLIT_ROUTER_* set, every
 *      function returns null and routeSupplyPlan() returns the SAME plan
 *      object it was given — the app's money path is byte-for-byte today's,
 *      which is why shipping this seam cannot break a deposit.
 *   2. EXACT WHEN LIVE. With an address configured, the plan rewrite is
 *      mechanical and fee math is BigInt-exact: approve goes to the router,
 *      the supply call becomes the router's method, and checks.splitRouter
 *      carries the numbers the UI must show BEFORE the user signs.
 *
 * The step shapes mirror the real adapters (aaveV3Base.buildSupplyPlan,
 * compoundV3Base, morphoBlueBase, lido's stake plan) one-for-one; when the
 * router is deployed and the panels are wired, the fork rehearsals assert the
 * same shapes against the real builders on a forked chain.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Interface } from 'ethers';
import {
  SPLIT_ROUTER_MAX_FEE_BPS,
  SPLIT_ROUTER_METHODS,
  loadSplitRouterInfo,
  quoteSplit,
  routeSupplyPlan,
  splitRouterAddressFor,
  splitRouterIsLive
} from '../src/lib/defi/splitRouter';

const ROUTER = '0x1234567890123456789012345678901234567890';
const ERC20 = new Interface(['function approve(address spender, uint256 amount)']);
const AMOUNT = 1_000_000_000n; // 1000 USDC, 6 decimals

const approveStep = (spender, amount) => ({
  kind: 'approve',
  to: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
  data: ERC20.encodeFunctionData('approve', [spender, amount]),
  value: 0n,
  description: { key: 'farm.aave.step.approve', amount: 1000 }
});
const supplyStep = (to) => ({
  kind: 'supply',
  to,
  data: '0x617ba037' + 'ff'.repeat(100),
  value: 0n,
  description: { key: 'farm.aave.step.supply', amount: 1000 }
});
const aavePlan = () => ({
  checks: { amountWei: AMOUNT, needsApproval: true },
  steps: [
    approveStep('0xA238Dd80C259a72e81d7e4664a9801593F98d1c5', AMOUNT),
    supplyStep('0xA238Dd80C259a72e81d7e4664a9801593F98d1c5')
  ]
});
const lidoPlan = () => ({
  checks: { amountWei: 10n ** 18n },
  steps: [{
    kind: 'stake',
    to: '0xae7ab96520DE3A18E5e111B5EaAb095312D7fE84',
    data: '0xa1903eab' + '00'.repeat(32),
    value: 10n ** 18n,
    description: { key: 'farm.lido.step.stake', amount: 1, symbol: 'ETH' }
  }]
});

beforeEach(() => {
  vi.unstubAllEnvs();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe('dormant by default (the no-breakage contract)', () => {
  it('returns no router for every supported chain with nothing configured', () => {
    expect(splitRouterAddressFor(8453)).toBeNull();
    expect(splitRouterAddressFor(42161)).toBeNull();
    expect(splitRouterAddressFor(1)).toBeNull();
    expect(splitRouterAddressFor(56)).toBeNull(); // not a farm chain
    expect(splitRouterIsLive(8453)).toBe(false);
  });

  it('routeSupplyPlan returns the SAME plan object untouched', () => {
    const plan = aavePlan();
    expect(routeSupplyPlan(plan, { chainId: 8453, protocolId: 'aave-base', feeBps: 30n })).toBe(plan);
    const stake = lidoPlan();
    expect(routeSupplyPlan(stake, { chainId: 1, protocolId: 'lido', feeBps: 30n })).toBe(stake);
  });

  it('loadSplitRouterInfo returns null without a configured address', async () => {
    expect(await loadSplitRouterInfo({ call: async () => '0x00' }, 8453)).toBeNull();
  });
});

describe('configured address', () => {
  it('reads the env per chain', () => {
    vi.stubEnv('VITE_FBT_SPLIT_ROUTER_BASE', ROUTER);
    expect(splitRouterAddressFor(8453)).toBe(ROUTER);
    expect(splitRouterAddressFor(1)).toBeNull(); // other chains stay off
  });

  it('rejects a malformed address loudly and stays off', () => {
    vi.stubEnv('VITE_FBT_SPLIT_ROUTER_BASE', '0xdeadbeef');
    expect(splitRouterAddressFor(8453)).toBeNull();
    expect(console.warn).toHaveBeenCalled();
  });

  it('reads feeBps from the CONTRACT and refuses an insane value', async () => {
    vi.stubEnv('VITE_FBT_SPLIT_ROUTER_BASE', ROUTER);
    const iface = new Interface(['function feeBps() view returns (uint256)']);
    const encode = (v) => iface.encodeFunctionResult('feeBps', [v]);
    expect(await loadSplitRouterInfo({ call: async () => encode(30n) }, 8453))
      .toEqual({ address: ROUTER, feeBps: 30n });
    expect(await loadSplitRouterInfo({ call: async () => encode(999n) }, 8453)).toBeNull();
    expect(await loadSplitRouterInfo({ call: async () => { throw new Error('rpc down'); } }, 8453)).toBeNull();
  });
});

describe('quoteSplit — BigInt-exact fee math', () => {
  it('30 bps of 1000 USDC is exactly 0.30 / 999.70', () => {
    expect(quoteSplit(1_000_000_000n, 30n)).toEqual({ feeAmount: 3_000_000n, netAmount: 997_000_000n });
  });

  it('floors on dust and supports a zero fee', () => {
    expect(quoteSplit(333n, 30n)).toEqual({ feeAmount: 0n, netAmount: 333n });
    expect(quoteSplit(AMOUNT, 0n)).toEqual({ feeAmount: 0n, netAmount: AMOUNT });
  });

  it('rejects non-bigint amounts and out-of-range fees', () => {
    expect(() => quoteSplit(1000, 30n)).toThrow();
    expect(() => quoteSplit(AMOUNT, 101n)).toThrow();
    expect(() => quoteSplit(AMOUNT, -1n)).toThrow();
    expect(() => quoteSplit(0n, 30n)).toThrow();
  });

  it('the ceiling mirrors the contract (1.00%)', () => {
    expect(SPLIT_ROUTER_MAX_FEE_BPS).toBe(100);
    expect(quoteSplit(AMOUNT, 100n).feeAmount).toBe(10_000_000n);
  });
});

describe('routeSupplyPlan — the rewrite', () => {
  it('routes an Aave plan: approve the ROUTER, call supplyAave, record the fee', () => {
    vi.stubEnv('VITE_FBT_SPLIT_ROUTER_BASE', ROUTER);
    const plan = aavePlan();
    const out = routeSupplyPlan(plan, { chainId: 8453, protocolId: 'aave-base', feeBps: 30n });
    expect(out).not.toBe(plan); // a NEW plan; the original is untouched
    expect(out.steps).toHaveLength(2);
    const [approve, supply] = out.steps;
    expect(approve.kind).toBe('approve');
    expect(ERC20.decodeFunctionData('approve', approve.data)).toEqual([ROUTER, AMOUNT]);
    const routerIface = new Interface(['function supplyAave(uint256 amount)']);
    expect(supply.to).toBe(ROUTER);
    expect(routerIface.decodeFunctionData('supplyAave', supply.data)).toEqual([AMOUNT]);
    expect(out.checks.splitRouter).toEqual({
      address: ROUTER,
      method: 'supplyAave',
      feeBps: 30n,
      feeAmount: 3_000_000n,
      netAmount: 997_000_000n
    });
  });

  it('routes Compound and Morpho plans through their own methods', () => {
    vi.stubEnv('VITE_FBT_SPLIT_ROUTER_BASE', ROUTER);
    const compoundPlan = {
      checks: {},
      steps: [
        approveStep('0xb125E6687d4313864e53df431d5425969c15Eb2F', AMOUNT),
        supplyStep('0xb125E6687d4313864e53df431d5425969c15Eb2F')
      ]
    };
    const outC = routeSupplyPlan(compoundPlan, { chainId: 8453, protocolId: 'compound-base', feeBps: 30n });
    expect(outC.checks.splitRouter.method).toBe('supplyCompound');

    const morphoPlan = {
      checks: {},
      steps: [
        approveStep('0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb', AMOUNT),
        supplyStep('0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb')
      ]
    };
    const outM = routeSupplyPlan(morphoPlan, { chainId: 8453, protocolId: 'morpho-base', feeBps: 30n });
    expect(outM.checks.splitRouter.method).toBe('supplyMorpho');
  });

  it('routes a Lido stake: value preserved, stakeLido() takes no arguments', () => {
    vi.stubEnv('VITE_FBT_SPLIT_ROUTER_ETHEREUM', ROUTER);
    const out = routeSupplyPlan(lidoPlan(), { chainId: 1, protocolId: 'lido', feeBps: 30n });
    const step = out.steps[0];
    expect(step.kind).toBe('stake');
    expect(step.to).toBe(ROUTER);
    expect(step.value).toBe(10n ** 18n);
    const routerIface = new Interface(['function stakeLido() payable']);
    expect(() => routerIface.decodeFunctionData('stakeLido', step.data)).not.toThrow();
    expect(out.checks.splitRouter.feeAmount).toBe((10n ** 18n * 30n) / 10_000n);
  });

  it('fails OPEN to the direct plan on any shape it does not recognise exactly', () => {
    vi.stubEnv('VITE_FBT_SPLIT_ROUTER_BASE', ROUTER);
    /* unknown protocol id */
    const plan = aavePlan();
    expect(routeSupplyPlan(plan, { chainId: 8453, protocolId: 'venus', feeBps: 30n })).toBe(plan);
    /* approve step missing */
    const noApprove = { checks: {}, steps: [supplyStep('0xA238Dd80C259a72e81d7e4664a9801593F98d1c5')] };
    expect(routeSupplyPlan(noApprove, { chainId: 8453, protocolId: 'aave-base', feeBps: 30n })).toBe(noApprove);
    /* supply step missing */
    const noSupply = { checks: {}, steps: [approveStep('0xA238Dd80C259a72e81d7e4664a9801593F98d1c5', AMOUNT)] };
    expect(routeSupplyPlan(noSupply, { chainId: 8453, protocolId: 'aave-base', feeBps: 30n })).toBe(noSupply);
    /* undecodable approve data */
    const garbage = { checks: {}, steps: [{ kind: 'approve', to: '0x1', data: '0xdeadbeef', value: 0n }, supplyStep('0x1')] };
    expect(routeSupplyPlan(garbage, { chainId: 8453, protocolId: 'aave-base', feeBps: 30n })).toBe(garbage);
    /* a router configured on a DIFFERENT chain must not touch this plan */
    vi.stubEnv('VITE_FBT_SPLIT_ROUTER_ETHEREUM', ROUTER);
    expect(routeSupplyPlan(aavePlan(), { chainId: 8453, protocolId: 'aave-base', feeBps: 30n })).not.toBeNull();
  });
});

describe('the five adapter ids are all routable', () => {
  it('SPLIT_ROUTER_METHODS covers exactly the FarmPositionHub adapter ids', () => {
    expect(Object.keys(SPLIT_ROUTER_METHODS).sort()).toEqual(
      ['aave-arbitrum', 'aave-base', 'compound-base', 'lido', 'morpho-base'].sort()
    );
  });
});
