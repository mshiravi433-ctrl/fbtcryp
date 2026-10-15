import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assessSwapQuote,
  buildLiveLoopPlan,
  readLoopMarket,
  resolveBorrowAmount,
  resolveSupplyAmount,
  usdToWei,
  validateLoopSettings,
  weiToDecimalString
} from '../src/lib/loopPlan.js';

const USDC = { id: 'arb-usdc', symbol: 'USDC', address: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831', decimals: 6 };
const USDT = { id: 'arb-usdt', symbol: 'USDT', address: '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9', decimals: 6 };
const WBTC = { id: 'arb-wbtc', symbol: 'WBTC', address: '0x2f2a2543B76A4166549F7aaB2e75Bef0aefC5B0f', decimals: 8 };
const assets = [USDT, USDC, WBTC];

const reserve = (over = {}) => ({
  listed: true, status: 'active', ltvPct: 75, liquidationThresholdPct: 78,
  supplyApyPct: 5, borrowApyPct: 3, borrowingEnabled: true, decimals: 6, ...over
});
const reserves = {
  [USDC.id]: reserve(),
  [USDT.id]: reserve({ supplyApyPct: 4, borrowApyPct: 3.5 }),
  [WBTC.id]: reserve({ decimals: 8, ltvPct: 73, liquidationThresholdPct: 78 })
};
const prices = { [USDC.id]: { usd: 1 }, [USDT.id]: { usd: 1 }, [WBTC.id]: { usd: 60000 } };
const settings = { rounds: '2', headroomPct: '10', minHealthFactor: '1.35', slippagePct: '0.5' };
const emptyAccount = { ok: true, totalCollateralUsd: 0, totalDebtUsd: 0, availableBorrowsUsd: 0, liquidationThresholdPct: 0, ltvPct: 0, healthFactor: null };

const plan = (over = {}) => buildLiveLoopPlan({
  assets, reserves, prices,
  positions: { [USDC.id]: { ok: true, walletWei: '1000000000', suppliedWei: '0', debtWei: '0' } },
  account: emptyAccount,
  collateralId: USDC.id,
  borrowId: USDT.id,
  amount: '100',
  settings,
  ...over
});

test('unit helpers convert USD and base units without float drift in the integer part', () => {
  assert.equal(usdToWei(67.5, 1, 6), 67_500_000n);
  assert.equal(usdToWei(600, 60000, 8), 1_000_000n);
  assert.equal(weiToDecimalString(67_500_000n, 6), '67.5');
  assert.equal(weiToDecimalString(1n, 6), '0.000001');
});

test('the market reader names every reason a pair cannot loop', () => {
  assert.deepEqual(readLoopMarket({ assets, reserves, prices }).errors.sort(), ['BORROW_REQUIRED', 'COLLATERAL_REQUIRED']);
  const paused = readLoopMarket({ assets, reserves: { ...reserves, [USDC.id]: reserve({ status: 'paused' }) }, prices, collateralId: USDC.id, borrowId: USDT.id });
  assert.ok(paused.errors.includes('COLLATERAL_PAUSED'));
  const noLtv = readLoopMarket({ assets, reserves: { ...reserves, [USDC.id]: reserve({ ltvPct: 0 }) }, prices, collateralId: USDC.id, borrowId: USDT.id });
  assert.ok(noLtv.errors.includes('COLLATERAL_LTV_ZERO'));
  const noBorrow = readLoopMarket({ assets, reserves: { ...reserves, [USDT.id]: reserve({ borrowingEnabled: false }) }, prices, collateralId: USDC.id, borrowId: USDT.id });
  assert.ok(noBorrow.errors.includes('BORROWING_DISABLED'));
  const noPrice = readLoopMarket({ assets, reserves, prices: { [USDC.id]: { usd: 1 } }, collateralId: USDC.id, borrowId: USDT.id });
  assert.ok(noPrice.errors.includes('PRICE_UNAVAILABLE'));
  const unread = readLoopMarket({ assets, reserves: {}, prices, collateralId: USDC.id, borrowId: USDT.id });
  assert.ok(unread.errors.includes('MARKET_UNAVAILABLE'));
});

test('settings are bounded: HF floor never below the protocol-safe 1.05, slippage 0.05–3%', () => {
  assert.equal(validateLoopSettings(settings).ok, true);
  assert.ok(validateLoopSettings({ ...settings, minHealthFactor: '1.01' }).errors.includes('MIN_HF_INVALID'));
  assert.ok(validateLoopSettings({ ...settings, rounds: '6' }).errors.includes('ROUNDS_INVALID'));
  assert.ok(validateLoopSettings({ ...settings, slippagePct: '5' }).errors.includes('SLIPPAGE_INVALID'));
  assert.ok(validateLoopSettings({ ...settings, headroomPct: '-1' }).errors.includes('HEADROOM_INVALID'));
});

test('a two-asset live plan alternates supply → borrow → swap → supply and respects the HF floor', () => {
  const p = plan();
  assert.equal(p.ok, true, p.errors.join(','));
  assert.deepEqual(p.steps.map((s) => s.key), ['supply-0', 'borrow-1', 'swap-1', 'supply-1', 'borrow-2', 'swap-2', 'supply-2']);
  assert.equal(p.steps[0].amountWei, '100000000');
  assert.equal(p.steps[0].fixedAmount, true);
  assert.equal(p.steps[2].amountFromKey, 'borrow-1');
  assert.equal(p.steps[3].amountFromKey, 'swap-1');
  /* Round 1: LTV room = 100 × 0.75 × 0.9 = 67.5, HF room = 100 × 0.78 / 1.35
     = 57.78 — the tighter one (the HF floor) binds. */
  assert.ok(Math.abs(p.rows[0].borrowUsd - 78 / 1.35) < 1e-9);
  assert.equal(p.rows[0].limitedBy, 'health-factor');
  const loose = plan({ settings: { ...settings, minHealthFactor: '1.05' } });
  assert.ok(Math.abs(loose.rows[0].borrowUsd - 67.5) < 1e-9);
  assert.equal(loose.rows[0].limitedBy, 'ltv-headroom');
  for (const row of p.rows) assert.ok(row.healthFactorAtBorrow >= 1.35 - 1e-9);
  assert.ok(p.summary.finalHealthFactor >= 1.35);
  assert.ok(p.summary.leverage > 1);
  assert.ok(p.summary.platformFeeUsd > 0);
});

test('a same-asset plan has no swap leg and no swap cost', () => {
  const p = plan({ borrowId: USDC.id });
  assert.equal(p.ok, true, p.errors.join(','));
  assert.equal(p.steps.some((s) => s.id === 'swap'), false);
  assert.equal(p.steps[2].amountFromKey, 'borrow-1');
  assert.equal(p.summary.swapCostUsd, 0);
});

test('amount problems are explicit: empty, over balance, malformed, nothing to loop', () => {
  assert.ok(plan({ amount: '' }).errors.includes('AMOUNT_REQUIRED'));
  assert.equal(plan({ amount: '' }).ok, false);
  assert.ok(plan({ amount: '5000' }).errors.includes('AMOUNT_OVER_BALANCE'));
  assert.ok(plan({ amount: '1.2.3' }).errors.includes('AMOUNT_INVALID'));
  assert.ok(plan({ amount: '0' }).errors.includes('NOTHING_TO_LOOP'));
});

test('typing 0 loops on existing collateral and starts with a borrow', () => {
  const account = { ok: true, totalCollateralUsd: 1000, totalDebtUsd: 0, availableBorrowsUsd: 750, liquidationThresholdPct: 78, ltvPct: 75, healthFactor: null };
  const p = plan({ amount: '0', account });
  assert.equal(p.ok, true, p.errors.join(','));
  assert.equal(p.steps[0].key, 'borrow-1');
  assert.ok(p.warnings.includes('EXISTING_POSITION'));
});

test('a position already at its HF floor cannot borrow — NOTHING_TO_BORROW, no steps executable', () => {
  const account = { ok: true, totalCollateralUsd: 1000, totalDebtUsd: 700, availableBorrowsUsd: 50, liquidationThresholdPct: 78, ltvPct: 75, healthFactor: 1.11 };
  const p = plan({ amount: '0', account });
  assert.equal(p.ok, false);
  assert.ok(p.errors.includes('NOTHING_TO_BORROW'));
});

test('a disconnected preview still projects, labelled PREVIEW_ONLY', () => {
  const p = plan({ account: null, positions: {} });
  assert.ok(p.warnings.includes('PREVIEW_ONLY'));
  assert.ok(p.rows.length > 0);
});

test('borrow resolution takes the tightest of LTV room, HF room, pool capacity, liquidity, cap and the plan', () => {
  const account = { ok: true, totalCollateralUsd: 100, totalDebtUsd: 0, availableBorrowsUsd: 75, liquidationThresholdPct: 78, ltvPct: 75, healthFactor: null };
  const base = { account, priceUsd: 1, decimals: 6, headroomPct: 10, minHealthFactor: 1.35 };
  const free = resolveBorrowAmount(base);
  assert.equal(free.ok, true);
  assert.equal(free.limitedBy, 'health-factor');
  assert.ok(Math.abs(Number(free.amountWei) - 57_777_777) <= 1);
  assert.ok(free.projectedHealthFactor >= 1.35);
  const ltvBound = resolveBorrowAmount({ ...base, minHealthFactor: 1.05 });
  assert.equal(ltvBound.limitedBy, 'ltv-headroom');
  assert.equal(ltvBound.amountWei, '67500000');
  const poolBound = resolveBorrowAmount({ ...base, minHealthFactor: 1.05, account: { ...account, availableBorrowsUsd: 20 } });
  assert.equal(poolBound.limitedBy, 'borrow-capacity');
  assert.ok(Number(poolBound.amountWei) < 20_000_000);

  const planned = resolveBorrowAmount({ ...base, plannedWei: '10000000' });
  assert.equal(planned.amountWei, '10000000');
  assert.equal(planned.limitedBy, 'reviewed-plan');

  const thin = resolveBorrowAmount({ ...base, reserve: { availableLiquidityWei: '5000000' } });
  assert.equal(thin.amountWei, '5000000');
  assert.equal(thin.limitedBy, 'available-liquidity');

  const capped = resolveBorrowAmount({ ...base, reserve: { borrowCapWei: '1000000000', totalDebtWei: '998000000' } });
  assert.equal(capped.amountWei, '2000000');
  assert.equal(capped.limitedBy, 'borrow-cap');

  const full = resolveBorrowAmount({ ...base, account: { ...account, totalDebtUsd: 57.7, availableBorrowsUsd: 17.3 } });
  assert.equal(full.ok, true);
  assert.equal(full.finish, true);

  assert.equal(resolveBorrowAmount({ ...base, account: { ok: false } }).code, 'RISK_DATA_UNAVAILABLE');
  assert.equal(resolveBorrowAmount({ ...base, priceUsd: 0 }).code, 'ORACLE_PRICE_UNAVAILABLE');
});

test('the HF floor passed below 1.05 is raised to 1.05', () => {
  const account = { ok: true, totalCollateralUsd: 100, totalDebtUsd: 0, availableBorrowsUsd: 1000, liquidationThresholdPct: 78, ltvPct: 99, healthFactor: null };
  const r = resolveBorrowAmount({ account, priceUsd: 1, decimals: 6, headroomPct: 0, minHealthFactor: 1.0 });
  assert.equal(r.ok, true);
  assert.equal(r.limitedBy, 'health-factor');
  assert.ok(r.projectedHealthFactor >= 1.05);
});

test('supply resolution: fixed amount must exist; derived amounts cap at the real balance', () => {
  const fixed = { key: 'supply-0', fixedAmount: true, amountWei: '100' };
  assert.deepEqual(resolveSupplyAmount({ step: fixed, walletWei: '100' }), { ok: true, amountWei: '100' });
  assert.equal(resolveSupplyAmount({ step: fixed, walletWei: '99' }).code, 'INSUFFICIENT_BALANCE');
  const derived = { key: 'supply-1', amountFromKey: 'swap-1' };
  assert.equal(resolveSupplyAmount({ step: derived, resolved: {} }).code, 'PREVIOUS_STEP_UNRESOLVED');
  assert.deepEqual(resolveSupplyAmount({ step: derived, resolved: { 'swap-1': { amountWei: '70', receivedWei: '66' } }, walletWei: '1000' }), { ok: true, amountWei: '66' });
  assert.deepEqual(resolveSupplyAmount({ step: derived, resolved: { 'swap-1': { receivedWei: '66' } }, walletWei: '65' }), { ok: true, amountWei: '65' });
});

test('a swap quote that could lose more than fee + slippage + 1% against the oracle is refused', () => {
  const good = { amountInWei: 100_000_000n, amountOutWei: 99_200_000n, minOutWei: 98_700_000n };
  const ok = assessSwapQuote({ quote: good, fromPriceUsd: 1, toPriceUsd: 1, fromDecimals: 6, toDecimals: 6, slippagePct: 0.5, feeBps: 70 });
  assert.equal(ok.ok, true);
  const bad = { amountInWei: 100_000_000n, amountOutWei: 95_000_000n, minOutWei: 94_000_000n };
  const refused = assessSwapQuote({ quote: bad, fromPriceUsd: 1, toPriceUsd: 1, fromDecimals: 6, toDecimals: 6, slippagePct: 0.5, feeBps: 70 });
  assert.equal(refused.ok, false);
  assert.equal(refused.code, 'SWAP_LOSS_TOO_HIGH');
  assert.equal(assessSwapQuote({ quote: { amountInWei: 0n } }).code, 'QUOTE_INVALID');
});

test('protocol limits the run would hit are named before it starts', () => {
  const capped = plan({ reserves: { ...reserves, [USDC.id]: reserve({ supplyCapWei: '1000000000', totalSupplyWei: '1000000000' }) } });
  assert.equal(capped.ok, false);
  assert.ok(capped.errors.includes('SUPPLY_CAP_REACHED'));
  const tight = plan({ reserves: { ...reserves, [USDC.id]: reserve({ supplyCapWei: '1000000000', totalSupplyWei: '900000000' }) } });
  assert.ok(tight.warnings.includes('SUPPLY_CAP_TIGHT'));
  assert.equal(tight.ok, true);
  const thin = plan({ reserves: { ...reserves, [USDT.id]: reserve({ availableLiquidityWei: '10000000' }) } });
  assert.ok(thin.warnings.includes('BORROW_LIQUIDITY_TIGHT'));
  const mainnet = plan({ assets: [{ ...USDT, chain: 1 }, { ...USDC, chain: 1 }] });
  assert.ok(mainnet.warnings.includes('L1_GAS'));
  assert.equal(plan().warnings.includes('L1_GAS'), false);
});
