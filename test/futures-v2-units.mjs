#!/usr/bin/env node
/**
 * FBT FUTURES v2 — pure-logic probe for the terminal upgrade.
 * ---------------------------------------------------------------------------
 * Pins the four pure layers added for the v2 terminal, with the numbers a
 * reviewer can check by hand rather than by trusting the code:
 *
 *   1. LIQUIDATION — the maintenance-margin model, and the rule that it is only
 *      used when the venue ITSELF published the maintenance fraction. The old
 *      behaviour (100%-loss upper bound for everything) is pinned too, so a
 *      future refactor cannot quietly make dYdX conservative-but-wrong again.
 *   2. VENUE CONTRACT — order types, post-only, TIF and TP/SL per venue, and the
 *      "a venue that is not mounted refuses by name" rule.
 *   3. ACCOUNT RISK — margin ratio, utilisation, exposure, correlated assets,
 *      the shock table and the funding horizons.
 *   4. CHART MATH — Heikin Ashi, VWAP, weekly aggregation, volume profile.
 *
 * Runs with `node --test` and no DOM, no network and no clock.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  LIQUIDATION_MODEL, RISK_LEVEL,
  liquidationDistance, liquidationLossPct, assessFuturesRisk, positionHealth,
  accountMargin, portfolioExposure, scenarioShock, fundingCost, assessPortfolioRisk,
  RISK_POLICY_DEFAULTS
} from '../src/lib/futures-engine/risk.js';
import {
  VENUE_CONTRACTS, contractFor, supportsOrderType, orderTypesFor, tpSlFor,
  liquidationPlan, resolveVenueContract, validateOrderForVenue, liquidationPreview,
  LIQUIDATION_SOURCE, ORDER_TYPES, TIME_IN_FORCE
} from '../src/lib/futures-engine/venueContract.js';
import {
  toHeikinAshi, volumeWeightedAveragePrice, aggregateCandles, volumeProfile
} from '../src/lib/proChartMath.js';

const close = (a, b, eps = 1e-9) => Math.abs(a - b) < eps;

/* ─────────────────────── 1 · LIQUIDATION ENGINE ─────────────────────────── */

test('maintenance-margin model: 10x long at 2.5% MMR liquidates 7.64% below entry', () => {
  /* long: P = 100000 × (10 − 1 + 0.0005×10) / (10 × 0.975)
          = 100000 × 9.005 / 9.75 = 92358.97 → 7.641% below */
  const l = liquidationDistance({
    providerId: 'dydx', side: 'long', entryPrice: 100000, leverage: 10,
    maintenanceMarginFraction: 0.025, takerFeeRate: 0.0005
  });
  assert.equal(l.model, LIQUIDATION_MODEL.MAINTENANCE_MARGIN);
  assert.ok(close(l.liquidationPrice, 92358.97435897436, 1e-6), String(l.liquidationPrice));
  assert.ok(close(l.distancePct, 7.6410256410256405, 1e-9));
  assert.equal(l.movePct < 0, true, 'a long liquidates BELOW entry');
  assert.ok(close(l.lossPct, 97.5));
});

test('maintenance-margin model: the short side mirrors the long side', () => {
  /* short: P = 100000 × (10 + 1 − 0) / (10 × 1.025) = 107317.07 → 7.317% above */
  const l = liquidationDistance({
    providerId: 'dydx', side: 'short', entryPrice: 100000, leverage: 10, maintenanceMarginFraction: 0.025
  });
  assert.ok(close(l.liquidationPrice, 107317.07317073172, 1e-6));
  assert.ok(close(l.distancePct, 7.3170731707317165, 1e-9));
  assert.equal(l.movePct > 0, true, 'a short liquidates ABOVE entry');
});

test('the fee term moves the liquidation price, and its absence is reported not guessed', () => {
  const withFee = liquidationDistance({ providerId: 'dydx', side: 'long', entryPrice: 100, leverage: 10, maintenanceMarginFraction: 0.025, takerFeeRate: 0.0005 });
  const noFee = liquidationDistance({ providerId: 'dydx', side: 'long', entryPrice: 100, leverage: 10, maintenanceMarginFraction: 0.025 });
  /* A long liquidates HIGHER (closer to entry) when a taker fee is paid:
     the fee is already spent, so less adverse move is needed. */
  assert.ok(withFee.liquidationPrice > noFee.liquidationPrice, 'paying a taker fee liquidates marginally sooner');
  assert.ok(withFee.distancePct < noFee.distancePct);
  const r = assessFuturesRisk({ providerId: 'dydx', side: 'long', collateralUsd: 100, leverage: 10, maxLeverage: 20, entryPrice: 100, maintenanceMarginFraction: 0.025 });
  assert.ok(r.warnings.includes('LIQUIDATION_FEE_EXCLUDED'));
  assert.ok(!r.warnings.includes('LIQUIDATION_MODEL_APPROXIMATE'), 'the maintenance model is not the upper bound');
});

test('without the venue MMR the upper bound is used, and LABELLED', () => {
  const l = liquidationDistance({ providerId: 'velocity', side: 'long', entryPrice: 100, leverage: 10 });
  assert.equal(l.model, LIQUIDATION_MODEL.fullCollateral);
  assert.ok(close(l.distancePct, 10));
  const r = assessFuturesRisk({ providerId: 'velocity', side: 'long', collateralUsd: 100, leverage: 10, maxLeverage: 20, entryPrice: 100 });
  assert.ok(r.warnings.includes('LIQUIDATION_MODEL_APPROXIMATE'));
});

test('a position that cannot practically be liquidated reports null, never a phantom price', () => {
  const l = liquidationDistance({ providerId: 'dydx', side: 'long', entryPrice: 100, leverage: 1, maintenanceMarginFraction: 0.025 });
  assert.equal(l.liquidationPrice, null);
  assert.equal(l.distancePct, null);
  assert.equal(l.model, LIQUIDATION_MODEL.MAINTENANCE_MARGIN);
});

test('the documented Ostium rule still wins over the generic model', () => {
  const l = liquidationDistance({ providerId: 'ostium', side: 'long', entryPrice: 100, leverage: 20, maxLeverage: 100, maintenanceMarginFraction: 0.05 });
  assert.equal(l.model, 'ostium-docs');
  assert.ok(close(l.lossPct, 95));
  assert.ok(close(l.distancePct, 4.75));
  assert.ok(close(l.liquidationPrice, 95.25));
  assert.equal(liquidationLossPct({ providerId: 'ostium', leverage: 20, maxLeverage: 100 }).model, 'ostium-docs');
});

test('an MMR outside (0,1) is refused rather than clamped into a fake price', () => {
  for (const bad of [1, 1.5, -0.1, null, undefined, 'x']) {
    const l = liquidationDistance({ providerId: 'dydx', side: 'long', entryPrice: 100, leverage: 10, maintenanceMarginFraction: bad });
    assert.equal(l.model, LIQUIDATION_MODEL.fullCollateral, `MMR ${bad} fell back to the bound`);
  }
});

test('position health uses the same model as the preview', () => {
  const h = positionHealth({ providerId: 'dydx', side: 'long', entryPrice: 100, markPrice: 102, leverage: 10, maintenanceMarginFraction: 0.025 });
  assert.ok(close(h.pnlPct, 20), 'a +2% move at 10x is +20% of collateral');
  assert.equal(h.model, LIQUIDATION_MODEL.MAINTENANCE_MARGIN);
  assert.ok(h.distanceToLiquidationPct > 7.64, 'a 2% move in the trader\'s favour buys distance');
  const losing = positionHealth({ providerId: 'dydx', side: 'long', entryPrice: 100, markPrice: 98, leverage: 10, maintenanceMarginFraction: 0.025 });
  assert.ok(losing.distanceToLiquidationPct < 7.64, 'a 2% move against the position eats distance');
});

/* ─────────────────────── 2 · VENUE CONTRACT ─────────────────────────────── */

test('every catalogued venue has a contract, and an unknown one has none', () => {
  for (const id of ['dydx', 'drift', 'ostium', 'hyperliquid']) assert.ok(contractFor(id), id);
  assert.equal(contractFor('binance'), null);
  assert.equal(contractFor(''), null);
  assert.deepEqual(Object.keys(VENUE_CONTRACTS).sort(), ['drift', 'dydx', 'hyperliquid', 'ostium']);
});

test('order types are per-venue and case-insensitive', () => {
  assert.equal(supportsOrderType('dydx', 'limit'), true);
  assert.equal(supportsOrderType('dydx', 'STOP_MARKET'), true);
  assert.equal(supportsOrderType('dydx', 'stop-limit'), false);
  assert.equal(supportsOrderType('ostium', 'stopMarket'), false);
  assert.equal(supportsOrderType('drift', 'market'), true);
  assert.deepEqual(orderTypesFor('hyperliquid'), [], 'a venue with no mounted order path offers no ticket');
  assert.deepEqual(orderTypesFor('nope'), []);
});

test('a ticket is refused BEFORE anything is built, with a reason a UI can show', () => {
  const v = (o) => validateOrderForVenue(o);
  assert.equal(v({ providerId: 'dydx', orderType: 'market' }).ok, true);
  assert.equal(v({ providerId: 'dydx', orderType: 'limit', price: 100 }).ok, true);
  assert.equal(v({ providerId: 'dydx', orderType: 'limit' }).code, 'PRICE_REQUIRED');
  assert.equal(v({ providerId: 'dydx', orderType: 'stopMarket' }).code, 'STOP_PRICE_REQUIRED');
  assert.equal(v({ providerId: 'dydx', orderType: 'stopLimit', price: 1, stopPrice: 2 }).code, 'ORDER_TYPE_NOT_SUPPORTED');
  assert.equal(v({ providerId: 'dydx', orderType: 'limit', price: 1, postOnly: true }).code, 'POST_ONLY_NOT_SUPPORTED');
  assert.equal(v({ providerId: 'dydx', orderType: 'limit', price: 1, timeInForce: 'FOK' }).code, 'TIME_IN_FORCE_NOT_SUPPORTED');
  assert.equal(v({ providerId: 'drift', orderType: 'limit', price: 1, postOnly: true, timeInForce: 'GTC' }).ok, true);
  assert.equal(v({ providerId: 'drift', orderType: 'limit', price: 1, postOnly: true, timeInForce: 'IOC' }).code, 'POST_ONLY_REQUIRES_GTC');
  assert.equal(v({ providerId: 'ostium', orderType: 'market', takeProfit: 100 }).ok, true);
  assert.equal(v({ providerId: 'drift', orderType: 'market', stopLoss: 1 }).ok, true);
  assert.equal(v({ providerId: 'nope', orderType: 'market' }).code, 'UNKNOWN_VENUE');
  assert.equal(v({ providerId: 'dydx', orderType: 'teleport' }).code, 'BAD_ORDER_TYPE');
});

test('Hyperliquid refuses by NAME today, because no route sends its orders', () => {
  const r = validateOrderForVenue({ providerId: 'hyperliquid', orderType: 'market' });
  assert.equal(r.ok, false);
  assert.equal(r.code, 'EXECUTION_NOT_MOUNTED');
  const resolved = resolveVenueContract('hyperliquid');
  assert.equal(resolved.ok, false);
  assert.equal(resolved.blocked, 'EXECUTION_NOT_MOUNTED');
  assert.equal(resolved.venue.canPlaceOrders, false);
  /* …and the moment that route is mounted, one flag flips the answer. */
  const mounted = resolveVenueContract('hyperliquid', { executionMounted: true });
  assert.equal(mounted.blocked, 'MARKET_UNKNOWN', 'not knowing whether the market is open is a refusal, not a yes');
  assert.equal(resolveVenueContract('hyperliquid', { executionMounted: true, marketLive: false }).blocked, 'MARKET_CLOSED');
  assert.equal(resolveVenueContract('hyperliquid', { executionMounted: true, marketLive: true }).ok, true);
  assert.equal(resolveVenueContract('dydx', { marketLive: true, status: 'READ_ONLY' }).blocked, 'VENUE_READ_ONLY');
});

test('TP/SL is a per-venue fact, not a ternary in a page', () => {
  assert.equal(tpSlFor('dydx'), true);
  assert.equal(tpSlFor('drift'), true);
  assert.equal(tpSlFor('ostium'), true);
  assert.equal(tpSlFor('hyperliquid'), false);
  assert.equal(tpSlFor('dydx', { adapterSupports: false }), false, 'an adapter that cannot carry the leg still says no');
});

test('the liquidation plan predicts which model the risk engine will use', () => {
  assert.equal(liquidationPlan('ostium').source, LIQUIDATION_SOURCE.VENUE_DOCS);
  assert.equal(liquidationPlan('ostium').exact, true);
  assert.equal(liquidationPlan('dydx').source, LIQUIDATION_SOURCE.MAINTENANCE);
  assert.equal(liquidationPlan('dydx').exact, false, 'without the MMR it is not exact');
  assert.equal(liquidationPlan('dydx', { maintenanceMarginFraction: 0.025 }).exact, true);
  assert.equal(liquidationPlan('drift').source, LIQUIDATION_SOURCE.UPPER_BOUND);
  assert.equal(liquidationPlan('nope').exact, false);
});

test('the ticket preview comes from the risk engine, not a second formula', () => {
  const p = liquidationPreview(
    { providerId: 'dydx', side: 'long', entryPrice: 100, leverage: 10, maintenanceMarginFraction: 0.025, takerFeeRate: 0.0005 },
    { liquidationDistance }
  );
  assert.equal(p.available, true);
  assert.equal(p.label, 'maintenance-margin');
  assert.equal(p.exact, true);
  assert.ok(close(p.price, 92.35897435897436, 1e-9));
  assert.deepEqual(liquidationPreview({ providerId: 'dydx', side: 'long', entryPrice: 1, leverage: 2 }, null), { available: false, reason: 'RISK_ENGINE_MISSING' });
});

test('order-type metadata is complete, so no ticket renders a control with no rule', () => {
  for (const o of ORDER_TYPES) {
    assert.equal(typeof o.id, 'string');
    assert.equal(typeof o.label, 'string');
    assert.equal(typeof o.needsPrice, 'boolean');
    assert.equal(typeof o.needsStopPrice, 'boolean');
  }
  assert.deepEqual([...TIME_IN_FORCE], ['GTC', 'IOC', 'FOK']);
});

/* ────────────────────── 3 · ACCOUNT-LEVEL RISK ──────────────────────────── */

test('margin ratio and utilisation are plain arithmetic over the venue numbers', () => {
  const m = accountMargin({ equityUsd: 1000, maintenanceMarginUsd: 600, initialMarginUsd: 400, availableBalanceUsd: 600 });
  assert.equal(m.marginRatioPct, 60);
  assert.equal(m.utilizationPct, 40);
  assert.equal(m.bufferUsd, 400);
  assert.equal(m.marginRatioLevel, RISK_LEVEL.MEDIUM);
  assert.equal(accountMargin({ equityUsd: 1000, maintenanceMarginUsd: 950 }).marginRatioLevel, RISK_LEVEL.EXTREME);
  assert.equal(accountMargin({}).marginRatioPct, null, 'no equity is null, never 0');
  assert.equal(accountMargin({ equityUsd: 0, maintenanceMarginUsd: 10 }).marginRatioPct, null, 'dividing by zero equity is not a percentage');
});

test('exposure separates NET direction from GROSS deployment', () => {
  const e = portfolioExposure([
    { symbol: 'BTC-USD', side: 'long', notionalUsd: 600 },
    { symbol: 'ETH-USD', side: 'short', notionalUsd: 200 },
    { symbol: 'BTC-USD', side: 'short', notionalUsd: 100 }
  ], { equityUsd: 1000 });
  assert.equal(e.grossUsd, 900);
  assert.equal(e.netUsd, 300);
  assert.equal(e.longUsd, 600);
  assert.equal(e.shortUsd, 300);
  assert.ok(close(e.leverageRatio, 0.9));
  assert.ok(close(e.directionalBiasPct, (300 / 900) * 100));
  assert.deepEqual(e.hedgedAssets, ['BTC'], 'BTC is held on both sides at once');
  assert.equal(e.largestAsset.base, 'BTC');
  assert.equal(e.largestAsset.grossUsd, 700);
  assert.equal(e.dataStatus, 'live');
  assert.equal(portfolioExposure([], { equityUsd: 10 }).dataStatus, 'empty');
});

test('the shock table is per position, so a hedged book does not look exposed', () => {
  const s = scenarioShock({
    positions: [
      { symbol: 'BTC-USD', side: 'long', notionalUsd: 1000 },
      { symbol: 'BTC-USD', side: 'short', notionalUsd: 900 }
    ],
    equityUsd: 500, maintenanceMarginUsd: 100, movesPct: [-5, 5]
  });
  const down = s.rows.find((r) => r.movePct === -5);
  /* 1000 long vs 900 short = 100 net → −$5 on the book at −5%, NOT −$50:
     the hedge is the whole point of computing per position. */
  assert.ok(close(down.pnlUsd, -5), String(down.pnlUsd));
  assert.ok(close(s.rows.find((r) => r.movePct === 5).pnlUsd, 5));
  assert.equal(s.liquidationScenario, null);
  assert.ok(close(s.worstPnlUsd, -5));
});

test('the shock table flags the move that takes the account under maintenance', () => {
  const s = scenarioShock({
    positions: [{ symbol: 'BTC-USD', side: 'long', notionalUsd: 2000 }],
    equityUsd: 300, maintenanceMarginUsd: 250, movesPct: [-5, -1]
  });
  const bad = s.rows.find((r) => r.movePct === -5);
  assert.equal(bad.liquidates, true, '300 − 100 = 200 < 250 maintenance');
  assert.equal(s.liquidationScenario.movePct, -5);
  assert.equal(scenarioShock({ positions: [], equityUsd: 1 }).reason, 'NO_POSITIONS');
});

test('funding horizons are computed from an APR, never from a raw interval rate', () => {
  /* $10,000 notional at 87.6% APR = $8,760/yr = $1.00/hr exactly → 24h = $24. */
  assert.ok(close(fundingCost({ notionalUsd: 10000, fundingAprPct: 87.6, hours: 24 }).usd, 24, 1e-9));
  /* 10.95% APR = 0.00125% per hour → 8h is 0.01% of notional = $1 on $10k. */
  assert.ok(close(fundingCost({ notionalUsd: 10000, fundingAprPct: 10.95, hours: 8 }).usd, 1, 1e-9));
  assert.equal(fundingCost({ notionalUsd: 10000, hours: 24 }).usd, null, 'no rate is null, not zero');
  assert.equal(fundingCost({ notionalUsd: null, fundingAprPct: 10, hours: 24 }).usd, null);
});

test('assessPortfolioRisk joins margin, exposure, funding and shocks with the product thresholds', () => {
  const r = assessPortfolioRisk({
    equityUsd: 1000,
    maintenanceMarginUsd: 720,
    initialMarginUsd: 500,
    availableBalanceUsd: 280,
    positions: [
      { symbol: 'BTC-USD', side: 'long', notionalUsd: 2500 },
      { symbol: 'ETH-USD', side: 'long', notionalUsd: 1500 }
    ],
    fundingAprPct: 120
  });
  assert.equal(r.schema, 'fbt.futures-portfolio-risk.v1');
  assert.equal(r.dataStatus, 'live');
  assert.equal(r.margin.marginRatioPct, 72);
  assert.ok(r.warnings.includes('MARGIN_RATIO_HIGH'), r.warnings.join(','));
  assert.ok(r.warnings.includes('PORTFOLIO_LEVERAGE_HIGH'), '4000 of notional on 1000 equity is 4x');
  assert.ok(r.funding.length === 3 && r.funding[0].hours === 8 && r.funding[2].hours === 72);
  assert.ok(r.shocks.rows.length > 0);
  assert.ok(r.riskLevel === RISK_LEVEL.HIGH || r.riskLevel === RISK_LEVEL.EXTREME, r.riskLevel);
  assert.equal(assessPortfolioRisk({}).dataStatus, 'unavailable');
});

test('the account thresholds are the SAME numbers the Intent OS risk engine uses', () => {
  assert.equal(RISK_POLICY_DEFAULTS.portfolioLeverageWarn, 3);
  assert.equal(RISK_POLICY_DEFAULTS.concentrationWarnPct, 60);
  assert.equal(RISK_POLICY_DEFAULTS.marginRatioWarnPct, 70);
  assert.equal(RISK_POLICY_DEFAULTS.fundingVsEquityWarnPct, 1);
});

/* ──────────────────────── 4 · CHART MATH ────────────────────────────────── */

const series = [
  { time: 1, open: 10, high: 12, low: 9, close: 11 },
  { time: 2, open: 11, high: 13, low: 10, close: 12 },
  { time: 3, open: 12, high: 12.5, low: 11, close: 11.5 }
];

test('Heikin Ashi keeps time and derives the four prices from the previous bar', () => {
  const ha = toHeikinAshi(series);
  assert.equal(ha.length, 3);
  assert.deepEqual(ha.map((c) => c.time), [1, 2, 3]);
  assert.ok(close(ha[0].close, (10 + 12 + 9 + 11) / 4));
  assert.ok(close(ha[0].open, (10 + 11) / 2));
  assert.ok(close(ha[1].open, (ha[0].open + ha[0].close) / 2));
  for (const c of ha) {
    assert.ok(c.high >= Math.max(c.open, c.close) && c.low <= Math.min(c.open, c.close));
  }
  assert.deepEqual(toHeikinAshi([]), []);
  assert.deepEqual(toHeikinAshi(null), []);
});

test('VWAP uses real volume, skips empty bars, and refuses mismatched lengths', () => {
  const v = volumeWeightedAveragePrice(series, [100, 300, 0]);
  assert.equal(v.length, 3, 'a zero-volume bar still reports the running VWAP');
  /* typical price = (high + low + close) / 3, the convention this uses. */
  const tp1 = (12 + 9 + 11) / 3;
  const tp2 = (13 + 10 + 12) / 3;
  assert.ok(close(v[0].value, tp1));
  assert.ok(close(v[1].value, (tp1 * 100 + tp2 * 300) / 400, 1e-9));
  assert.deepEqual(volumeWeightedAveragePrice(series, [1, 2]), [], 'positional volume, no guessing');
  assert.deepEqual(volumeWeightedAveragePrice(series, []), []);
});

test('VWAP resets per session when a session length is given', () => {
  const day = 86400000;
  const bar = (time, close) => ({ time, open: close, high: close, low: close, close });
  const bars = [bar(0, 100), bar(3600, 200), bar(day / 1000, 300)];
  const v = volumeWeightedAveragePrice(bars, [1, 1, 1], { sessionMs: day });
  assert.ok(close(v[1].value, 150));
  assert.ok(close(v[2].value, 300), 'the new session starts from its own prices');
});

test('aggregateCandles builds a REAL weekly bar from daily candles', () => {
  const daily = [];
  for (let i = 0; i < 21; i++) {
    daily.push({ time: i * 86400, open: 100 + i, high: 102 + i, low: 99 + i, close: 101 + i });
  }
  const weekly = aggregateCandles(daily, 7 * 86400000);
  assert.equal(weekly.length, 3);
  assert.equal(weekly[0].open, 100);
  assert.equal(weekly[0].high, 102 + 6);
  assert.equal(weekly[0].close, 101 + 6);
  assert.equal(weekly[0].low, 99);
  assert.deepEqual(aggregateCandles([], 1000), []);
  assert.deepEqual(aggregateCandles(daily, 0), []);
});

test('aggregation refuses a bucket that is not a multiple of the candle spacing', () => {
  const hourly = Array.from({ length: 10 }, (_, i) => ({ time: i * 3600, open: 1, high: 2, low: 0.5, close: 1.5 }));
  assert.deepEqual(aggregateCandles(hourly, 90 * 60_000), [], 'a 90-minute bucket from 1h candles has no clean boundary');
  assert.equal(aggregateCandles(hourly, 4 * 3600000).length, 3);
  assert.equal(aggregateCandles(hourly, 24 * 3600000).length, 1);
});

test('volume profile bins by price, names the point of control, and labels the approximation', () => {
  const candles = [
    { time: 1, open: 100, high: 110, low: 100, close: 105 },
    { time: 2, open: 110, high: 120, low: 110, close: 115 }
  ];
  const vp = volumeProfile(candles, [100, 300], { bins: 10 });
  assert.equal(vp.bins.length, 10);
  assert.ok(close(vp.totalVolume, 400));
  assert.ok(vp.pointOfControl >= 110 && vp.pointOfControl <= 120, String(vp.pointOfControl));
  assert.ok(/uniformly/i.test(vp.approximation));
  const shares = vp.bins.reduce((s, b) => s + b.sharePct, 0);
  assert.ok(close(shares, 100, 1e-6), 'the shares are of the same total');
  assert.deepEqual(volumeProfile([candles[0]], [1]).bins, []);
  assert.deepEqual(volumeProfile(candles, [1]).bins, []);
  assert.deepEqual(volumeProfile([{ time: 1, open: 1, high: 1, low: 1, close: 1 }], [1]).bins, [], 'a flat range has no profile');
});
