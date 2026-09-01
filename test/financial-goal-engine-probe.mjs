/**
 * FINANCIAL GOAL ENGINE PROBE — the assumption-based Outlook / Probability /
 * What-If / Simulator / Goal Health / Evidence layer.
 * ---------------------------------------------------------------------------
 * Pure logic only: no network, no storage, no wallet, no DOM. These functions
 * are exactly what the Goal Engine card in the Financial OS will render, so
 * this probe locks three properties:
 *
 *   1. CORRECTNESS — the numbers behave (probability rises with a bigger
 *      contribution, falls with a market drop, the simulator is monotonic).
 *   2. THE HONESTY RULE — probability/range carry the "assumption, not
 *      forecast" label; a missing scenario yields a null probability instead of
 *      a confident guess; nothing claims a guarantee.
 *   3. ATTRIBUTABILITY — evidence and data-quality are built from the plan's
 *      own computed facts, never invented (a made-up correlation must not
 *      appear).
 */

const rows = [];
const t = (name, ok) => rows.push([name, Boolean(ok)]);
const near = (a, b, eps = 0.01) => Number.isFinite(a) && Math.abs(a - b) <= eps;

const engine = await import('../src/lib/financialGoalEngine.js');
const {
  buildPlan,
  buildGoalOutlook,
  goalProbabilityFromScenarios,
  simulateWhatIf,
  simulateGoal,
  goalHealth,
  planEvidence,
  dataQualityScore,
  buildRiskStrategies,
  futuresExposure,
  FUTURES_CAP,
  STRATEGIES_SCHEMA,
  FUTURES_SCHEMA
} = engine;

const now = Date.now();
const goal = {
  id: 'goal_probe',
  startingCapital: 15000,
  targetAmount: 100000,
  targetDate: now + 36 * 30 * 24 * 3600_000,
  createdAt: now,
  riskProfile: 'MODERATE',
  monthlyContribution: 0,
  currency: 'USD'
};
const market = { live: true, stableYieldPct: 4.0, generatedAt: new Date(now).toISOString(), venuesMissing: [], sources: null };
const plan = buildPlan({ goal, market, currentValueUsd: 15000, now });

/* ------------------------- 1. probability (pure) ------------------------- */
{
  const scenarios = [
    { id: 'bear', ratePct: 0, projectedUsd: 80000 },
    { id: 'base', ratePct: 4, projectedUsd: 101000 },
    { id: 'bull', ratePct: 20, projectedUsd: 132000 }
  ];
  const prob = goalProbabilityFromScenarios({ scenarios, targetAmount: 100000 });
  t('probability is a number in [0,1]', prob && prob.probability >= 0 && prob.probability <= 1);
  t('probability is plausible for a ~median base (45–65%)', prob && prob.probabilityPct >= 45 && prob.probabilityPct <= 65);
  t('probability exposes the assumption model', prob && prob.assumptions?.kind === 'lognormal-quantile');
  t('the assumption range confidence is shown', prob && prob.assumptions?.rangeConfidence === 0.8);

  const degenerate = goalProbabilityFromScenarios({
    scenarios: [
      { id: 'bear', projectedUsd: 120000 },
      { id: 'base', projectedUsd: 120000 },
      { id: 'bull', projectedUsd: 120000 }
    ],
    targetAmount: 100000
  });
  t('a degenerate band that already beats the target is 100%', degenerate && degenerate.probabilityPct === 100);

  const missed = goalProbabilityFromScenarios({
    scenarios: [
      { id: 'bear', projectedUsd: null },
      { id: 'base', projectedUsd: 101000 },
      { id: 'bull', projectedUsd: 132000 }
    ],
    targetAmount: 100000
  });
  t('a missing scenario value yields null, not a confident guess', missed === null);
}

/* ------------------------- 2. buildGoalOutlook --------------------------- */
{
  const out = buildGoalOutlook({ goal, plan, now });
  t('outlook has the outcome schema', out?.schema === 'fbt.financial-goal-outlook.v1');
  t('outlook exposes the estimated range (bear/base/bull)', out?.range?.bear != null && out?.range?.base != null && out?.range?.bull != null);
  t('outlook labels it a non-forecast, non-guarantee', out?.guaranteed === false && out?.isForecast === false && /assumption/.test(out?.note ?? ''));
  t('outlook reports target and current value', out?.targetAmount === 100000 && out?.currentValueUsd === 15000);
  t('outlook data-quality is 0–1 and explained', out?.dataQuality?.score >= 0 && out?.dataQuality?.score <= 1 && Array.isArray(out?.dataQuality?.reasons));

  const noOutput = buildGoalOutlook({ goal, plan, currentValueUsd: null, now });
  t('an outlook with a missing feed still reports targets', noOutput?.targetAmount === 100000);
}

/* ------------------------- 3. what-if ------------------------------------ */
{
  const drop = simulateWhatIf({ goal, plan, change: { type: 'market-shock', asset: 'crypto', changePct: -30 }, currentValueUsd: 42000, now });
  t('a crypto drop lowers the goal probability', (drop?.after?.probabilityPct ?? 0) < (drop?.before?.probabilityPct ?? 0));
  t('a crypto drop lowers the current value', (drop?.delta?.valueUsd ?? 0) < 0);
  t('a crypto drop raises effective risk', drop?.delta?.risk === 'up');
  t('what-if keeps the same assumption model as the base', drop?.before?.assumptions?.kind === 'lognormal-quantile');

  const add = simulateWhatIf({ goal, plan, change: { type: 'contribution', monthlyDeltaUsd: 500 }, currentValueUsd: 42000, now });
  t('a bigger monthly contribution raises the goal probability', (add?.after?.probabilityPct ?? 0) > (add?.before?.probabilityPct ?? 0));
  t('the contribution what-if reports a positive probability delta', (add?.delta?.probabilityPct ?? 0) > 0);

  const bad = simulateWhatIf({ goal, plan, change: { type: 'market-shock', asset: 'BTC', changePct: -200 }, currentValueUsd: 42000, now });
  t('an invalid shock is refused rather than producing nonsense', bad?.warnings?.includes('invalidShock') === true);
}

/* ------------------------- 4. goal simulator ----------------------------- */
{
  const sim = simulateGoal({ goal, plan, candidates: [0, 250, 500, 750, 1000, 1500], currentValueUsd: 42000, now });
  t('the simulator is monotonic (more monthly → higher probability)',
    sim?.rows?.every((row, i, arr) => i === 0 || (row.probabilityPct ?? 0) >= (arr[i - 1].probabilityPct ?? 0)));
  t('the simulator returns the probability per candidate', sim?.rows?.length === 6 && sim?.rows?.[0]?.monthlyUsd === 0);
  t('the simulator reports a base probability', typeof sim?.baseProbabilityPct === 'number');
  t('the simulator carries the assumption model', sim?.assumptions?.kind === 'lognormal-quantile');
}

/* ------------------------- 5. goal health -------------------------------- */
{
  const completed = goalHealth({ goal, plan, currentValueUsd: 100000, now });
  t('a funded goal is COMPLETED and on track', completed?.status === 'COMPLETED' && completed?.onTrack === true);
  t('a funded goal needs no correction', Array.isArray(completed?.suggestions) && completed?.suggestions?.length === 0);
  t('health score is 0–100 with attributable factors', completed?.healthPct >= 0 && completed?.healthPct <= 100 && completed?.factors?.length >= 1);

  const behind = goalHealth({ goal, plan, currentValueUsd: 12000, now });
  t('an under-funded goal is reported off-track', behind?.onTrack === false);
  t('a drifting goal produces a bounded correction', Array.isArray(behind?.suggestions) && behind?.suggestions?.length > 0);
  t('behind % is reported when below the expected path', behind?.behindPct !== undefined && behind?.behindPct !== null);
}

/* ------------------------- 6. evidence ----------------------------------- */
{
  const evidence = planEvidence({ goal, plan, now });
  t('evidence lists the plan’s own computed facts', Array.isArray(evidence?.evidence) && evidence?.evidence?.length >= 3);
  t('evidence is attributable (key + value), not invented', evidence?.evidence?.every((row) => row?.key && row?.detail !== undefined));
  t('evidence includes the horizon and risk profile facts',
    evidence?.evidence?.some((row) => row.key === 'evidence.horizon') && evidence?.evidence?.some((row) => row.key === 'evidence.riskProfile'));
  t('evidence carries a non-forecast caveat', Array.isArray(evidence?.caveats) && evidence?.caveats?.some((caveat) => /not a (price )?forecast/i.test(caveat)));
  t('evidence reports data quality and freshness', typeof evidence?.dataQuality?.score === 'number');
}

/* ------------------------- 7. data quality ------------------------------- */
{
  const liveFull = dataQualityScore({ plan: { market: { live: true, venuesMissing: [] }, projectedYieldLive: true } });
  t('a fully live feed scores high', liveFull?.score >= 0.9);
  const dead = dataQualityScore({ plan: { market: { live: false, venuesMissing: ['stocks'] }, projectedYieldLive: false } });
  t('a dead feed scores low and explains why', dead?.score < 0.5 && dead?.reasons?.includes('marketFeedUnavailable'));
}

/* ------------------------- 8. three risk strategies ---------------------- */
{
  const strategies = buildRiskStrategies({ goal, plan, currentValueUsd: 42000, now });
  t('three strategies are returned, all labelled', strategies?.schema === STRATEGIES_SCHEMA && strategies?.rows?.length === 3);
  t('each strategy has an assumption return and drawdown', strategies?.rows?.every((row) => Number.isFinite(row.expectedReturnPct) && Number.isFinite(row.maxDrawdownPct)));
  t('a conservative strategy has the lowest drawdown', strategies?.rows?.find((r) => r.id === 'conservative')?.maxDrawdownPct === 9);
  t('an aggressive strategy has the highest drawdown', strategies?.rows?.find((r) => r.id === 'aggressive')?.maxDrawdownPct === 35);
  t('strategies sum to 100% allocation', strategies?.rows?.every((row) => Math.abs(row.allocation.reduce((sum, a) => sum + a.percentage, 0) - 100) < 0.001));
  t('strategies are labelled not-a-forecast and not guaranteed', strategies?.guaranteed === false && strategies?.isForecast === false);
}

/* ------------------------- 9. futures exposure --------------------------- */
{
  const fx = futuresExposure({ riskProfile: 'MODERATE', probabilityPct: 51, baseProbabilityPct: 68 });
  t('futures is capped, not a nudge', fx?.schema === FUTURES_SCHEMA && fx?.recommendedPct <= FUTURES_CAP.recommendedMaxPct && fx?.maximumPct === FUTURES_CAP.absoluteMaxPct);
  t('futures exposure is profile-driven', futuresExposure({ riskProfile: 'CONSERVATIVE' })?.recommendedPct === 0 && futuresExposure({ riskProfile: 'AGGRESSIVE' })?.recommendedPct === 5);
  t('a probability drop is flagged as a warning, never sold as a boost', fx?.reducesProbability === true && /increases downside risk/i.test(fx?.warning ?? ''));
  t('futures is flagged as non-guaranteed and non-executing', fx?.guaranteed === false && fx?.isForecast === false && /Nothing here executes/.test(fx?.note ?? ''));
  const boost = futuresExposure({ riskProfile: 'AGGRESSIVE', probabilityPct: 70, baseProbabilityPct: 68 });
  t('a probability gain is reported as a lever, not as a guarantee', boost?.reducesProbability === false && /a lever, not a guarantee/.test(boost?.warning ?? ''));
}


/* ------------------------- 10. HTTP: the goal-engine routes --------------- */
{
  process.env.RATE_LIMIT = process.env.RATE_LIMIT || '100000';
  const { default: app } = await import('../server/app.js');
  const server = await new Promise((resolve) => {
    const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  const device = 'probe-goal-engine-0001';
  const call = (path, { method = 'GET', body = null } = {}) =>
    fetch(base + path, {
      method,
      headers: { accept: 'application/json', ...(body ? { 'content-type': 'application/json' } : {}), 'x-fbt-device': device },
      ...(body ? { body: JSON.stringify(body) } : {})
    }).then(async (r) => ({ status: r.status, body: await r.json().catch(() => null) }));

  try {
    const created = await call('/api/v1/financial-goals', {
      method: 'POST',
      body: {
        name: 'Goal Engine Probe',
        startingCapital: 15000,
        targetAmount: 100000,
        targetDate: Date.now() + 36 * 365.25 * 24 * 3600_000,
        riskProfile: 'MODERATE',
        monthlyContribution: 0
      }
    });
    const goalId = created.body?.data?.id;

    const analyze = await call(`/api/v1/financial-goals/${goalId}/analyze`, { method: 'POST', body: { currentValueUsd: 42000 } });
    t('POST /:id/analyze returns outlook + health + evidence + strategies + futures',
      analyze.status === 200
      && analyze.body.data?.outlook?.schema === 'fbt.financial-goal-outlook.v1'
      && analyze.body.data?.health?.schema === 'fbt.financial-goal-health.v1'
      && analyze.body.data?.evidence?.schema === 'fbt.financial-goal-evidence.v1'
      && analyze.body.data?.strategies?.rows?.length === 3
      && analyze.body.data?.futures?.schema === 'fbt.financial-goal-futures.v1');
    t('analyze does NOT execute', analyze.body.meta?.executed === false && analyze.body.meta?.nextStep === 'REVIEW_AND_SIGN_IN_INTENT_OS');
    t('analyze labels the outlook as assumption-based', analyze.body.data?.outlook?.guaranteed === false && analyze.body.data?.outlook?.isForecast === false);

    const whatif = await call(`/api/v1/financial-goals/${goalId}/what-if`, {
      method: 'POST',
      body: { currentValueUsd: 42000, change: { type: 'market-shock', asset: 'crypto', changePct: -30 } }
    });
    t('POST /:id/what-if returns before/after + delta', whatif.status === 200 && whatif.body.data?.before?.probabilityPct !== undefined && whatif.body.data?.after?.probabilityPct !== undefined && whatif.body.data?.delta !== undefined);

    const sim = await call(`/api/v1/financial-goals/${goalId}/simulate`, {
      method: 'POST',
      body: { currentValueUsd: 42000, candidates: [0, 500, 1000] }
    });
    t('POST /:id/simulate returns the monthly → probability rows', sim.status === 200 && sim.body.data?.rows?.length === 3);
    t('the simulator is monotonic over the server response', sim.body.data?.rows?.every((row, i, arr) => i === 0 || (row.probabilityPct ?? 0) >= (arr[i - 1].probabilityPct ?? 0)));

    const badChange = await call(`/api/v1/financial-goals/${goalId}/what-if`, {
      method: 'POST',
      body: { currentValueUsd: 42000, change: { type: 'unknown', foo: 'bar' } }
    });
    t('an unknown what-if change is refused with a code', badChange.status === 400 && badChange.body?.error === 'BAD_WHATIF_CHANGE');
  } finally {
    server.close();
  }
}

/* Run direct or via run.mjs (same rows). */
const invokedDirectly = Boolean(process.argv?.[1] && process.argv[1].endsWith('financial-goal-engine-probe.mjs'));
if (invokedDirectly) {
  const fails = rows.filter(([, ok]) => !ok);
  for (const [name, ok] of rows) console.log(`  ${ok ? '\u2713' : '\u2717'} ${name}`);
  console.log(`\npassed ${rows.length - fails.length}/${rows.length}`);
  process.exitCode = fails.length ? 1 : 0;
}

export default rows;
