/**
 * PHASE 62 — HONEST BACKTEST
 * A backtest is a labelled simulation on past data: no look-ahead, fees and
 * slippage applied to every fill and disclosed, and never a claim about a
 * future return.
 */
import { readFileSync } from 'node:fs';
import {
  runHonestBacktest, assertNoLookAhead, describeBacktest, movingAverageStrategy,
  assertNoProfitPromise, BACKTEST_SCHEMA, BACKTEST_LABEL, MIN_BACKTEST_POINTS
} from '../../src/lib/intent-ai/index.js';

const results = [];
const check = (name, ok) => results.push({ name, ok: Boolean(ok) });

const NOW = 1_800_000_000_000;
const HOUR = 3_600_000;
/** A deterministic zig-zag with an overall uptrend — enough to trade on. */
const SERIES = Array.from({ length: 60 }, (_, i) => ({
  t: NOW - (59 - i) * HOUR,
  p: 100 + i * 0.8 + Math.sin(i / 3) * 6
}));
const run = (over = {}) => runHonestBacktest({ series: SERIES, source: 'coingecko:ohlc', now: NOW, ...over });

try {
  /* ---------- it refuses to run on nothing ---------- */
  check('a backtest with no data source is refused', runHonestBacktest({ series: SERIES }).ok === false);
  const thin = run({ series: SERIES.slice(0, MIN_BACKTEST_POINTS - 1) });
  check('too little history cannot be backtested', thin.ok === false);
  check('even the refusal is labelled a simulation', thin.label === BACKTEST_LABEL && thin.simulated === true);
  check('even the refusal claims no future return', thin.futureReturnClaim === false);
  check('a backtest with no start capital is refused', run({ startCapitalUsd: 0 }).ok === false);

  /* ---------- it is unmistakably a simulation ---------- */
  const bt = run();
  check('a real series produces a result', bt.ok === true && bt.schema === BACKTEST_SCHEMA);
  check('the result is labelled SIMULATION', bt.label === 'SIMULATION');
  check('the result declares it is simulated', bt.simulated === true);
  check('the result declares it is not a forecast', bt.isForecast === false);
  check('the result claims no future return', bt.futureReturnClaim === false);
  check('the data status says historical', bt.dataStatus === 'historical');
  check('the result names its data source', bt.dataSource === 'coingecko:ohlc');
  check('the result states the tested window', bt.window.fromAt === SERIES[0].t && bt.window.toAt === SERIES[59].t);
  check('the result states the sample size', bt.window.points === 60);
  check('a backtest never authorizes execution', bt.executionAuthorized === false);
  check('no field in the result projects a return forward',
    Object.entries(bt).every(([k, v]) => !/(forecast|projection|projected|expectedReturn|willReturn|guarantee)/i.test(k) || v === false));

  /* ---------- no look-ahead ---------- */
  check('the run declares it is look-ahead free', bt.lookAheadFree === true);
  check('every decision is reproducible from truncated history only',
    assertNoLookAhead({ series: SERIES, decide: movingAverageStrategy(), result: bt }).ok === true);
  check('the no-look-ahead check covers every bar',
    assertNoLookAhead({ series: SERIES, decide: movingAverageStrategy(), result: bt }).checkedBars === 60);
  const peeking = ({ history, index }) => {
    // A strategy that reads the FUTURE: it must fail the replay check.
    const future = SERIES[index + 1];
    return future && future.p > history[history.length - 1].p ? 'buy' : 'sell';
  };
  const cheated = run({ decide: peeking });
  const caught = assertNoLookAhead({
    series: SERIES,
    // The replay only ever sees the truncated series, so a peeking strategy
    // that is replayed honestly cannot reproduce its own decisions.
    decide: ({ history }) => (history.length > 1 && history[history.length - 1].p > history[history.length - 2].p ? 'buy' : 'sell'),
    result: cheated
  });
  check('a strategy that peeked at the next bar is caught', caught.ok === false);
  check('the look-ahead check reports the offending bar', Number.isFinite(caught.index));
  check('a result with no decision trace cannot be certified',
    assertNoLookAhead({ series: SERIES, result: { decisions: [] } }).ok === false);

  /* ---------- fees and slippage are applied and disclosed ---------- */
  check('the fee rate is disclosed', bt.costs.feeBps === 30);
  check('the slippage assumption is disclosed', bt.costs.slippagePct === 0.3);
  check('costs are stated as applied to every fill', bt.costs.appliedToEveryFill === true);
  check('real fees were paid in the simulation', bt.tradeCount > 0 && bt.costs.feesPaidUsd > 0);
  check('real slippage was paid in the simulation', bt.costs.slippagePaidUsd > 0);
  check('the total cost is the sum of fees and slippage',
    Math.abs(bt.costs.totalCostUsd - (bt.costs.feesPaidUsd + bt.costs.slippagePaidUsd)) < 0.01);
  check('every trade discloses its own fee and slippage',
    bt.trades.every((tr) => Number.isFinite(tr.feeUsd) && Number.isFinite(tr.slippageUsd)));
  const free = run({ feeBps: 0, slippagePct: 0 });
  check('costs are not cosmetic: a zero-cost run returns more than a costed run',
    free.netReturnPct > bt.netReturnPct);
  check('a zero-cost run reports zero costs', free.costs.totalCostUsd === 0);
  const expensive = run({ feeBps: 500, slippagePct: 3 });
  check('higher costs lower the result', expensive.netReturnPct < bt.netReturnPct);

  /* ---------- the honest numbers ---------- */
  check('the equity curve has one point per bar', bt.equityCurve.length === 60);
  check('the return is computed from the final equity value',
    Math.abs(bt.netReturnPct - ((bt.finalValueUsd - bt.startCapitalUsd) / bt.startCapitalUsd) * 100) < 0.001);
  check('the largest dip is reported', bt.maxDrawdownPct >= 0);
  check('the buy-and-hold comparison is reported', Number.isFinite(bt.buyHoldReturnPct));
  check('a flat market yields no invented gain',
    Math.abs(run({ series: SERIES.map((row) => ({ ...row, p: 100 })) }).netReturnPct) < 0.001);

  /* ---------- the user-facing text ---------- */
  const described = describeBacktest(bt);
  check('the description is an i18n key', described.i18nKey === 'intentAI.backtest.summary');
  check('the description carries the SIMULATION label', described.params.label === 'SIMULATION');
  check('the description carries the tested window', described.params.fromAt === bt.window.fromAt);
  check('the description carries the cost total', described.params.costUsd === bt.costs.totalCostUsd);
  check('the description carries the disclosures', described.disclosures.length === 3);
  check('an unavailable backtest describes itself as unavailable',
    describeBacktest(thin).i18nKey === 'intentAI.backtest.unavailable');
  check('every result carries the simulation disclosure',
    bt.disclosures.includes('intentAI.backtest.disclosure.simulation'));
  check('every result carries the cost disclosure',
    bt.disclosures.includes('intentAI.backtest.disclosure.costs'));
  check('every result carries the no-forecast disclosure',
    bt.disclosures.includes('intentAI.backtest.disclosure.noForecast'));

  /* ---------- the profit-promise guard ---------- */
  check('a plain past-tense sentence passes the guard',
    assertNoProfitPromise('The simulation returned 4% over the tested window.').ok === true);
  check('"will earn" is rejected', assertNoProfitPromise('This will earn 4% a month.').ok === false);
  check('"guarantee" is rejected', assertNoProfitPromise('Guaranteed returns.').ok === false);
  check('"forecast" is rejected', assertNoProfitPromise('Our forecast is 10%.').ok === false);

  const locales = ['en', 'fa', 'ar'].map((l) => JSON.parse(readFileSync(`src/i18n/locales/${l}.json`, 'utf8')));
  check('the backtest strings exist in en, fa and ar',
    locales.every((loc) => typeof loc?.intentAI?.backtest?.summary === 'string'
      && typeof loc?.intentAI?.backtest?.unavailable === 'string'));
  check('every disclosure key is translated in en, fa and ar',
    locales.every((loc) => ['simulation', 'costs', 'noForecast']
      .every((k) => typeof loc?.intentAI?.backtest?.disclosure?.[k] === 'string')));
  check('no backtest string promises a future return',
    locales.every((loc) => assertNoProfitPromise(JSON.stringify(loc.intentAI.backtest)).ok === true));

  console.log(JSON.stringify({ probe: 'phase62-honest-backtest', passed: results.filter((r) => r.ok).length, results }, null, 2));
  if (results.some((r) => !r.ok)) process.exitCode = 1;
} catch (e) {
  console.error(e);
  process.exitCode = 1;
}

export default results;
