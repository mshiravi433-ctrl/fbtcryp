import { beforeEach, describe, expect, it } from 'vitest';
import {
  AUTOCOMPOUND_PROJECTS, FARM_EXECUTION_STATES, FbtFeeEngine, FarmAdapter, VAULT_PROJECTS,
  buildYieldStrategies, farmPoolResearch, metricFreshness, normalizeFarmOpportunity
} from '../src/lib/farmDeFi';

const pool = {
  id: 'pool-1', symbol: 'USDC-USDT', project: 'uniswap-v3', chain: 'Base',
  apy: 10, apyBase: 8, apyReward: 2, apr: 8, rewardApr: 2,
  tvlUsd: 500_000_000, stablecoin: true, ilRisk: true, exposure: 'multi'
};

const single = {
  id: 'pool-2', symbol: 'USDC', project: 'aave-v3', chain: 'Ethereum',
  apy: 5, apyBase: 5, apyReward: 0, apr: 5, rewardApr: 0,
  tvlUsd: 500_000_000, stablecoin: true, ilRisk: false, exposure: 'single'
};

describe('farm DeFi architecture', () => {
  it('calculates operation and net-yield economics from inputs', () => {
    const engine = new FbtFeeEngine({ platformFeeBps: 30 });
    expect(engine.quoteOperation({ amountUsd: 1000, protocolFeeUsd: 2, gasUsd: 3 })).toMatchObject({
      fbtFeeUsd: 3, totalCostUsd: 8
    });
    expect(engine.estimateNetYield({ grossApy: 20, protocolCostApy: 1.8, gasUsd: 2, amountUsd: 1000 })).toMatchObject({
      fbtFeeApy: 0.3, gasCostApy: 0.2, netApy: 17.7, complete: true
    });
  });

  it('refuses unsupported adapter execution', async () => {
    const adapter = new FarmAdapter({ id: 'read-only' });
    await expect(adapter.prepareDeposit()).resolves.toMatchObject({ status: 'UNAVAILABLE' });
    await expect(adapter.execute()).resolves.toMatchObject({ status: 'UNAVAILABLE' });
  });

  it('normalizes risk, freshness and honest action availability', () => {
    const row = normalizeFarmOpportunity(pool, { source: 'defillama', updatedAt: new Date().toISOString() });
    expect(row.freshness).toBe('FRESH');
    expect(row.actions.addLiquidity).toBe('UNAVAILABLE');
    expect(row.actions.view).toBe('AVAILABLE');
    expect(row.score).toBeTypeOf('number');
    expect(metricFreshness(Date.now() - 3 * 60 * 60 * 1000)).toBe('STALE');
  });

  it('builds strategy categories from live rows without inventing products', () => {
    const strategies = buildYieldStrategies([pool]);
    expect(strategies.length).toBeGreaterThan(0);
    expect(strategies.every((row) => row.pool.id === pool.id)).toBe(true);
  });

  it('keeps the full execution lifecycle ordered', () => {
    expect(FARM_EXECUTION_STATES[0]).toBe('IDLE');
    expect(FARM_EXECUTION_STATES.at(-1)).toBe('COMPLETED');
    expect(FARM_EXECUTION_STATES.indexOf('SIMULATING')).toBeLessThan(FARM_EXECUTION_STATES.indexOf('AWAITING_SIGNATURE'));
  });

  it('offers the invest path for single-asset pools, not just pairs', () => {
    const row = normalizeFarmOpportunity(single, { source: 'defillama', updatedAt: new Date().toISOString() });
    expect(row.type).toBe('staking');
    expect(row.actions.getTokens).toBe('AVAILABLE');
    expect(row.actions.addLiquidity).toBe('UNAVAILABLE');
  });

  it('keeps a pair with an unlisted leg honestly unavailable', () => {
    // Base lists USDC but no USDT, so USDC-USDT cannot prefill a swap.
    const row = normalizeFarmOpportunity(pool, { source: 'defillama', updatedAt: new Date().toISOString() });
    expect(row.type).toBe('lp');
    expect(row.actions.getTokens).toBe('UNAVAILABLE');
  });

  it('maps the vault and auto-compound filters to real allow-list projects', () => {
    expect(VAULT_PROJECTS).toContain('yearn-finance');
    expect(VAULT_PROJECTS).toContain('beefy');
    expect(AUTOCOMPOUND_PROJECTS).toContain('lido');
    expect(AUTOCOMPOUND_PROJECTS).toContain('jupiter-staked-sol');
    const strategies = buildYieldStrategies([
      { ...single, project: 'beefy' },
      { ...single, id: 'pool-3', project: 'lido' }
    ]);
    expect(strategies.some((row) => row.category === 'vault')).toBe(true);
    expect(strategies.some((row) => row.category === 'staking')).toBe(true);
  });

  it('passes pool detail and 7d volume through to the analytics view', () => {
    const research = farmPoolResearch({ ...single, poolMeta: '0.05% fee tier', volumeUsd7d: 42 });
    expect(research.poolMeta).toBe('0.05% fee tier');
    expect(research.volumeUsd7d).toBe(42);
    const missing = farmPoolResearch(single);
    expect(missing.poolMeta).toBeNull();
    expect(missing.volumeUsd7d).toBeNull();
  });
});

/* ========================================================================== */
/* AAVE V3 · BASE · USDC SUPPLY ADAPTER                                        */
/* --------------------------------------------------------------------------- */
/* The adapter under test is the real module: real ABIs, real calldata encoding,
   real bitmap decoding, real ethers. Only the chain is replaced, by
   test/helpers/aaveMockProvider.mjs, which answers each selector the way a Base
   node would. Every assertion below is about a decision the adapter makes that
   would otherwise cost a user money. */
import { MaxUint256 } from 'ethers';
import {
  AAVE_V3_BASE, AAVE_V3_CUSTOM_ERRORS, AAVE_V3_ERROR_KEYS, AaveAdapterError, RESERVE_DATA_SHAPES,
  buildRevokePlan, buildSupplyPlan, buildWithdrawPlan, decodeReserveConfiguration,
  decodeReserveData, explainRevert, fromUsdcWei, getReserveStatus, getPosition,
  isAaveBaseUsdcPool, rayToApyPct, verifyDeployment
} from '../src/lib/defi/aaveV3Base';
import {
  AAVE_BASE_SUPPLY_ENABLED, AAVE_BASE_SUPPLY_MAX_USDC_PER_TX,
  AAVE_BASE_SUPPLY_MAX_USDC_TOTAL, aaveBaseSupplyAllowedFor, aaveBaseWithdrawAllowedFor
} from '../src/lib/features';
import { derivePartialApprovalState } from '../src/lib/defi/aaveV3History';
import {
  SHAPE_CORE_V30X, SHAPE_ORIGIN_V31, SHAPE_PHANTOM_13W,
  encodeReserveConfig, encodeReserveData, makeAaveProvider, decodeCall, ZERO_ADDRESS
} from './helpers/aaveMockProvider.mjs';

const OWNER = '0x1111111111111111111111111111111111111111';
const USDC_1 = 10n ** BigInt(AAVE_V3_BASE.usdcDecimals);
const goodConfig = () => encodeReserveConfig({
  ltvBps: 7500, liquidationThresholdBps: 7800, decimals: 6,
  active: true, frozen: false, paused: false, supplyCapWhole: 1_000_000n
});
const healthy = (over = {}) => makeAaveProvider({
  pool: AAVE_V3_BASE.pool,
  aToken: AAVE_V3_BASE.aUsdc,
  usdc: AAVE_V3_BASE.usdc,
  pinnedPool: AAVE_V3_BASE.pool,
  pinnedAToken: AAVE_V3_BASE.aUsdc,
  configBitmap: goodConfig(),
  allowanceWei: 0n,
  usdcBalanceWei: 1_000n * USDC_1,
  aTokenBalanceWei: 0n,
  totalSupplyWei: 100_000n * USDC_1,
  ...over
});
const plan = (provider, amountUsdc, over = {}) =>
  buildSupplyPlan({ provider, owner: OWNER, amountUsdc, nativeBalance: 10n ** 18n, ...over });

describe('aave v3 base adapter', () => {
  it('pins the deployment from the address book and reads USDC from chains.js', () => {
    expect(AAVE_V3_BASE.chainId).toBe(8453);
    expect(AAVE_V3_BASE.pool).toBe('0xA238Dd80C259a72e81d7e4664a9801593F98d1c5');
    expect(AAVE_V3_BASE.addressesProvider).toBe('0xe20fCBdBfFC4Dd138cE8b2E6FBb6CB49777ad64D');
    expect(AAVE_V3_BASE.aUsdc).toBe('0x4e65fE4DbA92790696d040ac24Aa414708F5c0AB');
    // The single source of truth for token addresses in this repo.
    expect(AAVE_V3_BASE.usdc).toBe('0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913');
    expect(AAVE_V3_BASE.usdcDecimals).toBe(6);
    expect(AAVE_V3_BASE.referralCode).toBe(0);
  });

  it('verifies the deployment through PoolAddressesProvider.getPool()', async () => {
    const provider = healthy();
    const evidence = await verifyDeployment(provider);
    expect(evidence.ok).toBe(true);
    expect(evidence.pool).toBe(AAVE_V3_BASE.pool);
    expect(evidence.verifiedVia).toBe('pool.getReserveData');
    expect(evidence.reserveDataShape).toBe(SHAPE_CORE_V30X);
    // The same provider resolves from the session cache, not a second RPC round trip.
    const before = provider.calls.length;
    await verifyDeployment(provider);
    expect(provider.calls.length).toBe(before);
  });

  it('throws a typed error when the registry names a different Pool', async () => {
    const provider = healthy({ pool: '0x2222222222222222222222222222222222222222' });
    await expect(verifyDeployment(provider)).rejects.toMatchObject({ code: 'AAVE_POOL_MISMATCH' });
  });

  it('throws a typed error when the USDC reserve names a different aToken', async () => {
    const provider = healthy({ aToken: '0x3333333333333333333333333333333333333333' });
    await expect(verifyDeployment(provider)).rejects.toMatchObject({ code: 'AAVE_ATOKEN_MISMATCH' });
    // And a refused verification must not be cached as a success.
    await expect(verifyDeployment(provider)).rejects.toBeInstanceOf(AaveAdapterError);
  });

  it('falls back to the aToken describing itself when no struct layout validates', async () => {
    // The real pinned aToken, but ReserveData returns something no declared shape accepts.
    const provider = healthy({ reserveDataShape: 'garbage' });
    const evidence = await verifyDeployment(provider);
    expect(evidence.verifiedVia).toBe('atoken.self-report');
    expect(evidence.reserveDataShape).toBeNull();
  });

  it('refuses to build a supply plan against an unverified deployment', async () => {
    const provider = healthy({ pool: '0x2222222222222222222222222222222222222222' });
    await expect(plan(provider, '5')).rejects.toMatchObject({ code: 'AAVE_POOL_MISMATCH' });
  });

  it('decodes both real ReserveData layouts and rejects a wrong one', async () => {
    for (const shape of RESERVE_DATA_SHAPES) {
      const decoded = await decodeReserveData(
        // Encode with this shape, decode with the adapter's own candidate list.
        encodeReserveData({
          shape: shape.id, config: goodConfig(), liquidityRateRay: 10n ** 27n / 10n, aToken: AAVE_V3_BASE.aUsdc
        }),
        { expectedDecimals: 6 }
      );
      expect(decoded.shape).toBe(shape.id);
      expect(decoded.aTokenAddress).toBe(AAVE_V3_BASE.aUsdc);
    }
    // A struct claiming 18 decimals cannot be the USDC reserve, whatever shape it has.
    const wrongDecimals = encodeReserveConfig({ decimals: 18, active: true });
    await expect(decodeReserveData(
      encodeReserveData({ shape: SHAPE_ORIGIN_V31, config: wrongDecimals, liquidityRateRay: 10n ** 27n, aToken: AAVE_V3_BASE.aUsdc }),
      { expectedDecimals: 6 }
    )).rejects.toMatchObject({ code: 'AAVE_RESERVE_DATA_UNDECODABLE' });
  });

  it('declares the 15-word legacy getReserveData ABI plus the defensive 17-word internal struct', () => {
    /*
     * Word offsets were verified against the released source, not assumed:
     * every released pool answers getReserveData() with the SAME 15-field
     * legacy ABI — aave-v3-core v3.0.x returns its own struct directly, and
     * every aave-v3-origin tag (v3.1.0 through v3.7.0) returns the dedicated
     * DataTypes.ReserveDataLegacy — so aToken sits at word 8, timestamp at 6,
     * reserve id at 7. The 17-word layout is the INTERNAL struct of origin
     * v3.1+ (aToken at word 9), never returned by a released getReserveData;
     * it is kept as a defensive candidate. If a future Aave release moves
     * aToken again, this pin forces the adapter and its fixture encoder to be
     * updated together.
     */
    const byId = Object.fromEntries(RESERVE_DATA_SHAPES.map((s) => [s.id, s]));
    expect(byId[SHAPE_CORE_V30X]).toMatchObject({ words: 15, aTokenWord: 8, timestampWord: 6, idWord: 7 });
    expect(byId[SHAPE_ORIGIN_V31]).toMatchObject({ words: 17, aTokenWord: 9, timestampWord: 6, idWord: 7 });
    expect(Object.keys(byId).sort()).toEqual([SHAPE_CORE_V30X, SHAPE_ORIGIN_V31]);
  });

  it('rejects the phantom 13-word "v3.3+" layout that matches no released pool', async () => {
    // An earlier version of the adapter declared a 13-word layout with the
    // aToken at word 7. It was inferred from v3.3 release notes, not from the
    // struct source: v3.2 deprecated the stable-rate fields but never removed
    // them, and v3.3's ReserveData is still 17 words. No pool returns 13.
    // Feed the phantom payload: it must decode to nothing, not to a "shape".
    await expect(decodeReserveData(
      encodeReserveData({ shape: SHAPE_PHANTOM_13W, config: goodConfig(), liquidityRateRay: 10n ** 27n, aToken: AAVE_V3_BASE.aUsdc }),
      { expectedDecimals: 6 }
    )).rejects.toMatchObject({ code: 'AAVE_RESERVE_DATA_UNDECODABLE' });
  });

  it('decodes the reserve bitmap against ReserveConfiguration.sol bit positions', () => {
    const cfg = decodeReserveConfiguration(goodConfig());
    expect(cfg.active).toBe(true);
    expect(cfg.frozen).toBe(false);
    expect(cfg.paused).toBe(false);
    expect(cfg.decimals).toBe(6);
    expect(cfg.ltvBps).toBe(7500);
    expect(cfg.liquidationThresholdBps).toBe(7800);
    expect(cfg.supplyCapWhole).toBe(1_000_000n);
    const paused = decodeReserveConfiguration(encodeReserveConfig({ decimals: 6, active: true, paused: true }));
    expect(paused.paused).toBe(true);
    expect(paused.active).toBe(true);
  });

  it('reports reserve status: caps, rate and the paused/frozen bits', async () => {
    const status = await getReserveStatus(healthy({ liquidityRateRay: 10n ** 27n / 20n }));
    expect(status.active).toBe(true);
    expect(status.paused).toBe(false);
    expect(status.frozen).toBe(false);
    expect(status.supplyCapUsdc).toBe(1_000_000n * USDC_1);
    expect(status.currentSuppliedUsdc).toBe(100_000n * USDC_1);
    expect(status.supplyApyPct).toBeCloseTo(5, 4);
    expect(status.ltvBps).toBe(7500);
    expect(rayToApyPct(10n ** 27n / 20n)).toBe(5);
    // supplyCap == 0 means Aave configured no cap; report null, never 0.
    const uncapped = await getReserveStatus(healthy({ configBitmap: encodeReserveConfig({ decimals: 6 }) }));
    expect(uncapped.supplyCapUsdc).toBeNull();
  });

  it('approves EXACTLY the amount, never an infinite allowance', async () => {
    const { steps, checks } = await plan(healthy(), '5');
    expect(checks.blocked).toEqual([]);
    expect(steps.map((s) => s.kind)).toEqual(['approve', 'supply']);
    const [spender, value] = decodeCall('erc20', 'approve', steps[0].data);
    expect(spender).toBe(AAVE_V3_BASE.pool);
    expect(value).toBe(5n * USDC_1);
    expect(value).not.toBe(MaxUint256);
    // The approve targets the USDC contract; the supply targets the Pool.
    expect(steps[0].to).toBe(AAVE_V3_BASE.usdc);
    expect(steps[1].to).toBe(AAVE_V3_BASE.pool);
    expect(steps.every((s) => s.value === 0n)).toBe(true);
  });

  it('omits the approve step when the existing allowance already covers it', async () => {
    const { steps, checks } = await plan(healthy({ allowanceWei: 5n * USDC_1 }), '5');
    expect(checks.needsApproval).toBe(false);
    expect(steps.map((s) => s.kind)).toEqual(['supply']);
  });

  it('supplies on behalf of the connected owner and nothing else', async () => {
    const { steps } = await plan(healthy({ allowanceWei: 10n * USDC_1 }), '5');
    const [asset, amount, onBehalfOf, referralCode] = decodeCall('pool', 'supply', steps[0].data);
    expect(asset).toBe(AAVE_V3_BASE.usdc);
    expect(amount).toBe(5n * USDC_1);
    expect(onBehalfOf.toLowerCase()).toBe(OWNER.toLowerCase());
    expect(Number(referralCode)).toBe(0);
  });

  it('refuses a supply above the per-transaction cap', async () => {
    const over = AAVE_BASE_SUPPLY_MAX_USDC_PER_TX + 0.000001;
    const { steps, checks } = await plan(healthy(), String(over));
    expect(checks.perTxCapOk).toBe(false);
    expect(checks.blocked).toContain('AAVE_PER_TX_CAP');
    expect(steps).toEqual([]);
  });

  it('refuses a supply that would breach the total position cap', async () => {
    const existing = BigInt(AAVE_BASE_SUPPLY_MAX_USDC_TOTAL - 2) * USDC_1;
    const { steps, checks } = await plan(healthy({ aTokenBalanceWei: existing }), '5');
    expect(checks.totalCapOk).toBe(false);
    expect(checks.blocked).toContain('AAVE_TOTAL_CAP');
    expect(checks.remainingTotalCapUsdc).toBeCloseTo(2, 6);
    expect(steps).toEqual([]);
  });

  it('refuses a paused or frozen or inactive reserve', async () => {
    for (const [bits, code] of [
      [{ decimals: 6, active: true, paused: true }, 'AAVE_RESERVE_PAUSED'],
      [{ decimals: 6, active: true, frozen: true }, 'AAVE_RESERVE_FROZEN'],
      [{ decimals: 6, active: false }, 'AAVE_RESERVE_INACTIVE']
    ]) {
      const { steps, checks } = await plan(healthy({ configBitmap: encodeReserveConfig(bits) }), '5');
      expect(checks.blocked).toContain(code);
      expect(steps).toEqual([]);
    }
  });

  it('refuses a supply the reserve cap has no headroom for', async () => {
    const provider = healthy({
      configBitmap: encodeReserveConfig({ decimals: 6, active: true, supplyCapWhole: 1000n }),
      totalSupplyWei: 999n * USDC_1
    });
    const { steps, checks } = await plan(provider, '5');
    expect(checks.supplyCapHeadroomOk).toBe(false);
    expect(checks.blocked).toContain('AAVE_SUPPLY_CAP_EXCEEDED');
    expect(steps).toEqual([]);
    // 1 USDC still fits under a 1000 USDC cap with 999 supplied.
    const ok = await plan(healthy({
      configBitmap: encodeReserveConfig({ decimals: 6, active: true, supplyCapWhole: 1000n }),
      totalSupplyWei: 999n * USDC_1
    }), '1');
    expect(ok.checks.supplyCapHeadroomOk).toBe(true);
  });

  it('refuses when the wallet does not hold the USDC, or the gas floor is short', async () => {
    const poor = await plan(healthy({ usdcBalanceWei: 1n * USDC_1 }), '5');
    expect(poor.checks.blocked).toContain('AAVE_INSUFFICIENT_BALANCE');
    // NATIVE_GAS_FLOOR[8453] is 0.0003 ETH — 1e14 wei is below it.
    const gassed = await buildSupplyPlan({
      provider: healthy(), owner: OWNER, amountUsdc: '5', nativeBalance: 10n ** 14n
    });
    expect(gassed.checks.blocked).toContain('AAVE_NATIVE_GAS_FLOOR');
    // An unknown native balance is not a pass.
    const unknown = await buildSupplyPlan({ provider: healthy(), owner: OWNER, amountUsdc: '5' });
    expect(unknown.checks.blocked).toContain('AAVE_NATIVE_BALANCE_UNKNOWN');
  });

  it('withdraws to the connected owner, and maps "max" to MaxUint256', async () => {
    const provider = healthy();
    const { steps } = await buildWithdrawPlan({ provider, owner: OWNER, amountUsdc: 'max' });
    expect(steps).toHaveLength(1);
    const [asset, amount, to] = decodeCall('pool', 'withdraw', steps[0].data);
    expect(asset).toBe(AAVE_V3_BASE.usdc);
    expect(amount).toBe(MaxUint256);
    expect(to.toLowerCase()).toBe(OWNER.toLowerCase());
    expect(steps[0].to).toBe(AAVE_V3_BASE.pool);
  });

  it('withdraws an explicit amount without touching MaxUint256', async () => {
    const { steps, checks } = await buildWithdrawPlan({ provider: healthy(), owner: OWNER, amountUsdc: '12.5' });
    const [, amount, to] = decodeCall('pool', 'withdraw', steps[0].data);
    expect(amount).toBe(12_500_000n);
    expect(amount).not.toBe(MaxUint256);
    expect(to.toLowerCase()).toBe(OWNER.toLowerCase());
    expect(checks.isMax).toBe(false);
    // Withdrawal is never gated: no caps are applied on the way out.
    expect(checks.perTxCapOk).toBe(true);
    expect(checks.totalCapOk).toBe(true);
    expect(checks.blocked).toEqual([]);
  });

  it('revokes by approving zero', async () => {
    const { steps } = await buildRevokePlan({ provider: healthy(), owner: OWNER });
    const [spender, value] = decodeCall('erc20', 'approve', steps[0].data);
    expect(spender).toBe(AAVE_V3_BASE.pool);
    expect(value).toBe(0n);
  });

  it('reads the position honestly: no debt means no health factor', async () => {
    const position = await getPosition(healthy({ aTokenBalanceWei: 25n * USDC_1 }), OWNER);
    expect(position.suppliedUsdc).toBe(25n * USDC_1);
    expect(position.aTokenBalance).toBe(25n * USDC_1);
    expect(position.hasDebt).toBe(false);
    expect(position.healthFactor).toBeNull();
    expect(position.suppliedUsd).toBeCloseTo(25, 6);
    expect(position.accruedSinceUsdc).toBeNull();
  });

  it('accrues only from local records it can fully account for', async () => {
    const history = [
      { action: 'supply', owner: OWNER, status: 'confirmed', amountUsdcWei: String(20n * USDC_1) },
      { action: 'supply', owner: OWNER, status: 'confirmed', amountUsdcWei: String(4n * USDC_1) }
    ];
    const position = await getPosition(healthy({ aTokenBalanceWei: 25n * USDC_1 }), OWNER, { history });
    expect(position.accruedSinceUsdc).toBe(1n * USDC_1);
    // Records that claim MORE than the chain shows are wrong — report nothing.
    const bad = await getPosition(healthy({ aTokenBalanceWei: 1n * USDC_1 }), OWNER, { history });
    expect(bad.accruedSinceUsdc).toBeNull();
    // Someone else's records must not produce our accrual.
    const other = await getPosition(healthy({ aTokenBalanceWei: 25n * USDC_1 }), OWNER, {
      history: [{ action: 'supply', owner: '0x9999999999999999999999999999999999999999', status: 'confirmed', amountUsdcWei: String(20n * USDC_1) }]
    });
    expect(other.accruedSinceUsdc).toBeNull();
  });

  it('maps Aave v3 numeric revert codes to i18n keys, and falls back when unknown', () => {
    expect(explainRevert(new Error('execution reverted: 26'))).toMatchObject({ code: '26', key: 'farm.aave.err.invalidAmount', known: true });
    expect(explainRevert({ reason: '27' }).key).toBe('farm.aave.err.reserveInactive');
    expect(explainRevert({ reason: '28' }).key).toBe('farm.aave.err.reserveFrozen');
    expect(explainRevert({ reason: '29' }).key).toBe('farm.aave.err.reservePaused');
    expect(explainRevert({ reason: '51' }).key).toBe('farm.aave.err.supplyCapExceeded');
    expect(explainRevert({ reason: '35' }).key).toBe('farm.aave.err.healthFactor');
    // Every mapped code has a key, and every key is namespaced under farm.aave.err
    for (const [code, key] of Object.entries(AAVE_V3_ERROR_KEYS)) {
      expect(explainRevert({ reason: String(code) }).key).toBe(key);
      expect(key.startsWith('farm.aave.err.')).toBe(true);
    }
    // Unmapped: no invented sentence, the raw reason survives.
    const unknown = explainRevert({ reason: 'something exploded', message: 'something exploded' });
    expect(unknown.known).toBe(false);
    expect(unknown.key).toBeNull();
    expect(unknown.reason).toBeTruthy();
    // A revert with no digits at all must not be misread as a code.
    expect(explainRevert({ reason: 'insufficient funds for gas', message: 'insufficient funds for gas' }).key).toBeNull();
  });

  it('maps v3.4+ custom-error reverts by selector to the same i18n keys', async () => {
    /*
     * Aave v3.4+ (aave-v3-origin v3.4.0 … v3.7.0) replaced the numeric string
     * codes with no-argument custom errors of the same name. The revert
     * payload is then just the 4-byte selector — the number "26" appears
     * nowhere. explainRevert must read the selector from err.data (the real
     * ethers shape) and from a bare hex reason (the simulation shape).
     */
    const { id } = await import('ethers');
    // Every selector in the table must BE keccak256 of its error signature —
    // a mistyped selector would silently ship a mapping that never fires.
    const byKey = new Map();
    for (const [selector, key] of Object.entries(AAVE_V3_CUSTOM_ERRORS)) byKey.set(key, selector);
    for (const [code, key] of Object.entries(AAVE_V3_ERROR_KEYS)) {
      if (!byKey.has(key)) continue;
      const name = {
        'farm.aave.err.invalidAmount': 'InvalidAmount',
        'farm.aave.err.invalidBurnAmount': 'InvalidBurnAmount',
        'farm.aave.err.reserveInactive': 'ReserveInactive',
        'farm.aave.err.reserveFrozen': 'ReserveFrozen',
        'farm.aave.err.reservePaused': 'ReservePaused',
        'farm.aave.err.supplyCapExceeded': 'SupplyCapExceeded',
        'farm.aave.err.notEnoughBalance': 'NotEnoughAvailableUserBalance',
        'farm.aave.err.healthFactor': 'HealthFactorLowerThanLiquidationThreshold',
        'farm.aave.err.healthFactorNotBelow': 'HealthFactorNotBelowThreshold',
        'farm.aave.err.oracleSentinel': 'PriceOracleSentinelCheckFailed',
        'farm.aave.err.zeroAddress': 'ZeroAddressNotValid',
        'farm.aave.err.assetNotListed': 'AssetNotListed'
      }[key];
      expect(id(`${name}()`).slice(0, 10).toLowerCase(), `${name} selector`).toBe(byKey.get(key));
    }
    // Behaviour: real ethers shape (data carries the selector) and the
    // simulation shape (the hex lands in reason/message).
    expect(explainRevert({ data: byKey.get('farm.aave.err.invalidAmount') }))
      .toMatchObject({ code: null, key: 'farm.aave.err.invalidAmount', known: true, reason: null });
    expect(explainRevert({ data: byKey.get('farm.aave.err.notEnoughBalance') }).key)
      .toBe('farm.aave.err.notEnoughBalance');
    expect(explainRevert({ reason: byKey.get('farm.aave.err.reservePaused'), message: byKey.get('farm.aave.err.reservePaused') }).key)
      .toBe('farm.aave.err.reservePaused');
    expect(explainRevert({ data: byKey.get('farm.aave.err.supplyCapExceeded') }).key)
      .toBe('farm.aave.err.supplyCapExceeded');
    // An unknown custom selector falls back honestly, never as a known code.
    const unknownCustom = explainRevert({ data: '0xdeadbeef' });
    expect(unknownCustom.known).toBe(false);
    expect(unknownCustom.key).toBeNull();
    // Numeric legacy reverts are still recognised after the selector pass.
    expect(explainRevert({ reason: '26' }).key).toBe('farm.aave.err.invalidAmount');
    expect(explainRevert(new Error('execution reverted: 51')).key).toBe('farm.aave.err.supplyCapExceeded');
  });

  it('matches only the exact Aave v3 / Base / USDC pool', () => {
    const row = { project: 'aave-v3', chain: 'Base', symbol: 'USDC', exposure: 'single', ilRisk: false };
    expect(isAaveBaseUsdcPool(row)).toBe(true);
    expect(isAaveBaseUsdcPool({ ...row, chain: 'Ethereum' })).toBe(false);
    expect(isAaveBaseUsdcPool({ ...row, project: 'aave-v2' })).toBe(false);
    expect(isAaveBaseUsdcPool({ ...row, symbol: 'USDC-WETH', ilRisk: true, exposure: 'multi' })).toBe(false);
    expect(isAaveBaseUsdcPool(null)).toBe(false);
  });

  it('round-trips 6-dp amounts without rounding or exponents', () => {
    expect(fromUsdcWei(1n)).toBe('0.000001');
    expect(fromUsdcWei(5n * USDC_1)).toBe('5.000000');
    expect(fromUsdcWei(1234567n)).toBe('1.234567');
  });
});

describe('aave v3 base feature flag', () => {
  it('is off by default, with finite caps', () => {
    expect(AAVE_BASE_SUPPLY_ENABLED).toBe(false);
    expect(AAVE_BASE_SUPPLY_MAX_USDC_PER_TX).toBe(100);
    expect(AAVE_BASE_SUPPLY_MAX_USDC_TOTAL).toBe(500);
    expect(aaveBaseSupplyAllowedFor(OWNER)).toBe(false);
  });

  it('never gates the way out on a position', () => {
    // Flag off, no allowlist, position exists: withdraw still allowed.
    expect(aaveBaseWithdrawAllowedFor({ owner: OWNER, hasPosition: true })).toBe(true);
    expect(aaveBaseWithdrawAllowedFor({ owner: OWNER, hasPosition: false })).toBe(false);
    expect(aaveBaseWithdrawAllowedFor({ owner: '', hasPosition: true })).toBe(false);
  });
});

describe('aave v3 base partial-state recovery', () => {
  beforeEach(() => { if (typeof localStorage !== 'undefined') localStorage.clear(); });

  it('derives the stuck-approval state from the chain, not just the ledger', () => {
    // Chain says an allowance is standing and nothing was supplied.
    const stuck = derivePartialApprovalState({
      owner: OWNER, allowanceUsdcWei: 5n * USDC_1, positionUsdcWei: 0n
    });
    expect(stuck.needed).toBe(true);
    expect(stuck.source).toBe('chain');
    // The supply landed, so the allowance is simply consumed.
    const landed = derivePartialApprovalState({
      owner: OWNER, allowanceUsdcWei: 5n * USDC_1, positionUsdcWei: 5n * USDC_1
    });
    expect(landed.needed).toBe(false);
    // Nothing standing anywhere: clean.
    expect(derivePartialApprovalState({ owner: OWNER }).needed).toBe(false);
  });
});
