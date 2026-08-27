/**
 * FBT INTENT AI — PHASE 62: HONEST BACKTEST
 * ---------------------------------------------------------------------------
 * A backtest is not a promise. This runs a strategy over REAL historical
 * points and returns a result that is impossible to mistake for a forecast:
 *
 *   · every result is labelled SIMULATION, with its window, its data source
 *     and its sample size attached
 *   · no look-ahead: the decision for bar *i* is computed from bars ≤ i only,
 *     and `assertNoLookAhead()` proves it by re-running each decision against
 *     a truncated series
 *   · commission (feeBps) and slippage are applied to every fill AND disclosed
 *     in the result, so a "profitable" curve cannot hide its costs
 *   · there is no field anywhere in the output that projects a future return;
 *     `futureReturnClaim` is always false and `describeBacktest()` only emits
 *     i18n keys that speak in the past tense about a simulation
 */

import { classifyFailure } from './failureModes.js';
import { normalizeSeries } from './liveMarketRegime.js';

export const BACKTEST_SCHEMA = 'fbt.honest-backtest.v1';
export const BACKTEST_LABEL = 'SIMULATION';
export const MIN_BACKTEST_POINTS = 10;

// Number(null) === 0 and Number('') === 0, so an absent value must be
// rejected BEFORE the finite check or "missing" silently reads as zero.
const num = (v) => (v === null || v === undefined || v === '' || typeof v === 'boolean'
  ? null
  : (Number.isFinite(Number(v)) ? Number(v) : null));
const round = (v, dp = 4) => Math.round(v * 10 ** dp) / 10 ** dp;

function unavailable(detail) {
  return {
    ok: false,
    schema: BACKTEST_SCHEMA,
    label: BACKTEST_LABEL,
    dataStatus: 'unavailable',
    simulated: true,
    futureReturnClaim: false,
    error: classifyFailure('MISSING_DATA', { detail })
  };
}

/**
 * The only decision shape allowed: a pure function of the bars SEEN SO FAR.
 * @callback Decide
 * @param {{history: Array, index: number, position: number}} view
 * @returns {'buy'|'sell'|'hold'}
 */

/** A simple, deterministic default: moving-average crossover on closes. */
export function movingAverageStrategy({ fast = 3, slow = 8 } = {}) {
  const decide = ({ history }) => {
    if (history.length < slow) return 'hold';
    const avg = (n) => history.slice(-n).reduce((sum, row) => sum + row.p, 0) / n;
    const f = avg(fast);
    const s = avg(slow);
    if (f > s) return 'buy';
    if (f < s) return 'sell';
    return 'hold';
  };
  decide.strategyId = `ma-${fast}-${slow}`;
  return decide;
}

/**
 * Run the backtest.
 * @param {Array}    series    real historical points ([{t,p}] or [[t,p]])
 * @param {Decide}   decide    decision function (sees history ≤ i only)
 */
export function runHonestBacktest({
  series = [],
  decide = movingAverageStrategy(),
  source = null,
  startCapitalUsd = 1000,
  feeBps = 30,
  slippagePct = 0.3,
  now = Date.now()
} = {}) {
  const src = typeof source === 'string' && source.trim() ? source.trim().slice(0, 60) : null;
  if (!src) return unavailable('NO_DATA_SOURCE');
  if (typeof decide !== 'function') return unavailable('NO_STRATEGY');
  const points = normalizeSeries(series);
  if (points.length < MIN_BACKTEST_POINTS) return unavailable('NOT_ENOUGH_HISTORY');

  const capital0 = num(startCapitalUsd);
  if (capital0 === null || capital0 <= 0) return unavailable('NO_START_CAPITAL');
  const fee = Math.max(0, num(feeBps) ?? 0) / 10_000;
  const slip = Math.max(0, num(slippagePct) ?? 0) / 100;

  let cash = capital0;
  let units = 0;
  let feesPaidUsd = 0;
  let slippagePaidUsd = 0;
  const trades = [];
  const equity = [];
  const decisions = [];

  for (let i = 0; i < points.length; i += 1) {
    // The decision only ever sees history up to and including bar i.
    const history = points.slice(0, i + 1);
    const action = decide({ history, index: i, position: units });
    decisions.push(action);
    const price = points[i].p;

    if (action === 'buy' && cash > 0) {
      // Buying fills at a worse price than the mid: slippage is a real cost.
      const fillPrice = price * (1 + slip);
      const feeUsd = cash * fee;
      const spend = cash - feeUsd;
      const slipUsd = spend - (spend / fillPrice) * price;
      units += spend / fillPrice;
      feesPaidUsd += feeUsd;
      slippagePaidUsd += slipUsd;
      cash = 0;
      trades.push({ at: points[i].t, side: 'buy', price: round(fillPrice, 8), feeUsd: round(feeUsd, 4), slippageUsd: round(slipUsd, 4) });
    } else if (action === 'sell' && units > 0) {
      const fillPrice = price * (1 - slip);
      const gross = units * fillPrice;
      const feeUsd = gross * fee;
      const slipUsd = units * price - gross;
      cash = gross - feeUsd;
      feesPaidUsd += feeUsd;
      slippagePaidUsd += slipUsd;
      units = 0;
      trades.push({ at: points[i].t, side: 'sell', price: round(fillPrice, 8), feeUsd: round(feeUsd, 4), slippageUsd: round(slipUsd, 4) });
    }
    equity.push({ t: points[i].t, valueUsd: round(cash + units * price, 4) });
  }

  const finalValue = equity[equity.length - 1].valueUsd;
  const netReturnPct = round(((finalValue - capital0) / capital0) * 100, 4);
  const buyHoldValue = capital0 * (points[points.length - 1].p / points[0].p);
  let peak = -Infinity;
  let maxDrawdownPct = 0;
  for (const row of equity) {
    peak = Math.max(peak, row.valueUsd);
    if (peak > 0) maxDrawdownPct = Math.max(maxDrawdownPct, ((peak - row.valueUsd) / peak) * 100);
  }

  return {
    ok: true,
    schema: BACKTEST_SCHEMA,
    // Impossible to read this as anything but a simulation.
    label: BACKTEST_LABEL,
    simulated: true,
    isForecast: false,
    futureReturnClaim: false,
    dataStatus: 'historical',
    strategyId: decide.strategyId || 'custom',
    window: { fromAt: points[0].t, toAt: points[points.length - 1].t, points: points.length },
    dataSource: src,
    startCapitalUsd: capital0,
    finalValueUsd: finalValue,
    netReturnPct,
    // Costs are part of the headline number AND disclosed separately.
    costs: {
      feeBps: num(feeBps) ?? 0,
      slippagePct: num(slippagePct) ?? 0,
      feesPaidUsd: round(feesPaidUsd, 4),
      slippagePaidUsd: round(slippagePaidUsd, 4),
      totalCostUsd: round(feesPaidUsd + slippagePaidUsd, 4),
      appliedToEveryFill: true
    },
    trades,
    tradeCount: trades.length,
    maxDrawdownPct: round(maxDrawdownPct, 4),
    buyHoldReturnPct: round(((buyHoldValue - capital0) / capital0) * 100, 4),
    equityCurve: equity,
    decisions,
    lookAheadFree: true,
    disclosures: Object.freeze([
      'intentAI.backtest.disclosure.simulation',
      'intentAI.backtest.disclosure.costs',
      'intentAI.backtest.disclosure.noForecast'
    ]),
    executionAuthorized: false,
    ranAt: now
  };
}

/**
 * Prove there is no look-ahead: replay every decision against a series
 * truncated at that bar and require the identical answer.
 */
export function assertNoLookAhead({ series = [], decide = movingAverageStrategy(), result = null } = {}) {
  const points = normalizeSeries(series);
  const expected = Array.isArray(result?.decisions) ? result.decisions : null;
  if (!points.length || !expected || expected.length !== points.length) {
    return { ok: false, error: classifyFailure('MISSING_DATA', { detail: 'NO_DECISION_TRACE' }) };
  }
  let position = 0;
  for (let i = 0; i < points.length; i += 1) {
    const truncated = points.slice(0, i + 1);
    const replay = decide({ history: truncated, index: i, position });
    if (replay !== expected[i]) {
      return { ok: false, index: i, error: classifyFailure('UNKNOWN', { detail: `LOOK_AHEAD_AT:${i}` }) };
    }
    if (replay === 'buy') position = 1;
    if (replay === 'sell') position = 0;
  }
  return { ok: true, checkedBars: points.length };
}

/**
 * The only user-facing text path. i18n keys only, past tense, always carrying
 * the simulation label, the window and the cost basis.
 */
export function describeBacktest(result) {
  if (!result || result.ok !== true) {
    return { available: false, i18nKey: 'intentAI.backtest.unavailable', params: {}, disclosures: ['intentAI.backtest.disclosure.simulation'] };
  }
  return {
    available: true,
    i18nKey: 'intentAI.backtest.summary',
    params: {
      label: result.label,
      returnPct: result.netReturnPct,
      trades: result.tradeCount,
      fromAt: result.window.fromAt,
      toAt: result.window.toAt,
      source: result.dataSource,
      costUsd: result.costs.totalCostUsd,
      drawdownPct: result.maxDrawdownPct
    },
    disclosures: result.disclosures
  };
}

/** Fail-closed guard: nothing may present a backtest as a future return. */
export function assertNoProfitPromise(text = '') {
  const banned = [/\bwill (?:earn|return|make|profit)\b/i, /\bguarantee/i, /\bexpected profit\b/i, /\bforecast\b/i];
  const hit = banned.find((re) => re.test(String(text)));
  return hit
    ? { ok: false, error: classifyFailure('UNKNOWN', { detail: 'PROFIT_PROMISE' }) }
    : { ok: true };
}
