/**
 * FINANCIAL GOALS PROBE — the Financial OS feature end to end.
 * ---------------------------------------------------------------------------
 * Three layers, because each one fails differently:
 *
 *   1. ENGINE (src/lib/financialGoalEngine.js, pure): the required-return
 *      arithmetic, the allocation-invariant, the risk score, the monitoring
 *      statuses and the intent payload. No network, no storage, no mocking of
 *      our own code.
 *   2. STORAGE (server/financialGoals.js against the in-memory store): the
 *      three collections, ownership separation, the event timeline and — the
 *      property that matters — that approval creates an INTENT, not a
 *      transaction.
 *   3. HTTP (the real server/app.js): the seven routes, the device/Telegram
 *      scope gate, and the honest `durable` / `dataStatus` reporting.
 */

import { readFileSync } from 'node:fs';

const rows = [];
const t = (name, ok) => rows.push([name, Boolean(ok)]);
const near = (a, b, eps = 0.01) => Number.isFinite(a) && Math.abs(a - b) <= eps;

/* ------------------------------ 1. the engine ----------------------------- */
{
  const engine = await import('../src/lib/financialGoalEngine.js');
  const {
    requiredCagr,
    validateAllocation,
    buildAllocation,
    riskScore,
    monitorGoal,
    buildGoalIntent,
    buildPlan,
    parseGoalFromText,
    requiredReturnWithContributions,
    futureValue,
    expectedPath,
    RISK_PROFILES
  } = engine;

  /* The spec's own example: $10,000 → $20,000 in 3 years is ~25.99%/yr. */
  t('requiredCagr doubles capital in three years at ~26%/yr',
    near(requiredCagr(10000, 20000, 3) * 100, 25.99, 0.02));
  t('requiredCagr returns null instead of NaN/Infinity on a broken input',
    requiredCagr(0, 20000, 3) === null && requiredCagr(1000, 20000, 0) === null && requiredCagr(1000, -5, 3) === null);
  t('a target already met needs no return', near(requiredCagr(20000, 20000, 3), 0, 1e-9));

  t('validateAllocation accepts a plan that sums to 100',
    validateAllocation([{ asset: 'BTC', percentage: 30 }, { asset: 'ETH', percentage: 20 }, { asset: 'STABLE', percentage: 30 }, { asset: 'OTHER', percentage: 20 }]) === true);
  let threw = false;
  try {
    validateAllocation([{ asset: 'BTC', percentage: 30 }, { asset: 'STABLE', percentage: 69 }]);
  } catch (error) {
    threw = error.message === 'Allocation must equal 100%';
  }
  t('validateAllocation throws "Allocation must equal 100%" on a 99% plan', threw);

  /* The invariant is the whole reason the function exists: every profile, at
     every pressure, must produce exactly 100%. */
  let allocationOk = true;
  for (const profile of RISK_PROFILES) {
    for (const required of [0, 5, 12, 26, 45, 90]) {
      for (const market of [null, { stableYieldPct: 4.5 }, { stableYieldPct: 18 }]) {
        const { allocation } = buildAllocation({ riskProfile: profile, requiredReturnPct: required, market });
        const total = allocation.reduce((sum, row) => sum + row.percentage, 0);
        if (Math.abs(total - 100) > 0.001) allocationOk = false;
        if (allocation.length !== 4) allocationOk = false;
        if (allocation.some((row) => row.percentage < 0)) allocationOk = false;
      }
    }
  }
  t('every allocation sums to exactly 100% across profiles, pressures and market states', allocationOk);

  const conservative = buildAllocation({ riskProfile: 'CONSERVATIVE', requiredReturnPct: 40 }).allocation;
  const aggressive = buildAllocation({ riskProfile: 'AGGRESSIVE', requiredReturnPct: 0 }).allocation;
  const stableOf = (rowsIn) => rowsIn.find((r) => r.asset === 'STABLE').percentage;
  t('a conservative goal keeps more in stables than an aggressive one at any pressure',
    stableOf(conservative) > stableOf(aggressive));
  t('a stable sleeve is never drained to zero', stableOf(conservative) >= 45);

  t('riskScore grows with the required return and the risk profile',
    riskScore({ riskProfile: 'CONSERVATIVE', requiredReturnPct: 5, years: 5 }).score
    < riskScore({ riskProfile: 'AGGRESSIVE', requiredReturnPct: 40, years: 1 }).score);
  t('riskScore stays inside 0..100', [[0, 0], [1000, 0]].every(([required, years]) => {
    const value = riskScore({ riskProfile: 'AGGRESSIVE', requiredReturnPct: required, years }).score;
    return value >= 0 && value <= 100;
  }));
  t('riskScore explains itself', riskScore({ riskProfile: 'MODERATE', requiredReturnPct: 26, years: 3 }).factors.length >= 4);

  t('a contribution-heavy goal needs a lower return than the same target without one',
    requiredReturnWithContributions({ startingCapital: 10000, targetAmount: 20000, monthlyContribution: 300, years: 3 }).requiredReturnPct
    < requiredReturnWithContributions({ startingCapital: 10000, targetAmount: 20000, monthlyContribution: 0, years: 3 }).requiredReturnPct);
  t('contributions alone can make the required return zero',
    requiredReturnWithContributions({ startingCapital: 10000, targetAmount: 20000, monthlyContribution: 400, years: 3 }).requiredReturnPct === 0);
  t('an impossible target is reported unreachable, not stretched',
    requiredReturnWithContributions({ startingCapital: 100, targetAmount: 1e9, monthlyContribution: 0, years: 1 }).reachable === false);
  t('future value with no growth is just principal plus contributions',
    near(futureValue({ starting: 1000, monthly: 100, years: 1, annualReturn: 0 }), 2200, 0.01));

  /* Monitoring: the six statuses, computed from the same rules the API uses. */
  const baseGoal = {
    id: 'goal_test',
    startingCapital: 10000,
    targetAmount: 20000,
    createdAt: Date.now() - 180 * 24 * 3600_000,
    targetDate: Date.now() + 180 * 24 * 3600_000,
    status: 'ACTIVE'
  };
  t('half-way through, a portfolio on the required path is ON_TRACK',
    monitorGoal({ goal: baseGoal, currentValueUsd: 14142 }).status === 'ON_TRACK');
  t('well above the path is AHEAD', monitorGoal({ goal: baseGoal, currentValueUsd: 17000 }).status === 'AHEAD');
  t('below the path is BEHIND', monitorGoal({ goal: baseGoal, currentValueUsd: 12500 }).status === 'BEHIND');
  t('far below the path is AT_RISK', monitorGoal({ goal: baseGoal, currentValueUsd: 10500 }).status === 'AT_RISK');
  t('reaching the target is COMPLETED', monitorGoal({ goal: baseGoal, currentValueUsd: 21000 }).status === 'COMPLETED');
  t('a paused goal is PAUSED whatever the value',
    monitorGoal({ goal: { ...baseGoal, status: 'PAUSED' }, currentValueUsd: 21000 }).status === 'PAUSED');
  t('an unreported value is flagged, not silently ranked',
    monitorGoal({ goal: baseGoal, currentValueUsd: null }).valueReported === false);
  t('a reported value is flagged as reported',
    monitorGoal({ goal: baseGoal, currentValueUsd: 12000 }).valueReported === true);
  t('progress is a percentage of the target',
    near(monitorGoal({ goal: baseGoal, currentValueUsd: 10000 }).progressPct, 50, 0.2));
  t('the expected path starts at the starting capital and ends at the target', (() => {
    const path = expectedPath({ startingCapital: 10000, targetAmount: 20000, createdAt: baseGoal.createdAt, targetDate: baseGoal.targetDate, points: 6 });
    return path.length === 6 && near(path[0].valueUsd, 10000, 1) && near(path[5].valueUsd, 20000, 1);
  })());

  /* The intent payload is the hand-off contract. */
  const goal = { id: 'goal_123', startingCapital: 10000, currency: 'USD' };
  const plan = { allocation: [{ asset: 'BTC', percentage: 30 }, { asset: 'ETH', percentage: 20 }, { asset: 'STABLE', percentage: 30 }, { asset: 'OTHER', percentage: 20 }] };
  const intent = buildGoalIntent({ goal, plan });
  t('the intent carries the FINANCIAL_GOAL source and the goal id',
    intent.source === 'FINANCIAL_GOAL' && intent.goalId === 'goal_123');
  t('every allocation becomes an ALLOCATE action with an amount',
    intent.actions.length === 4
    && intent.actions.every((a) => a.type === 'ALLOCATE')
    && intent.actions[0].amount === 3000);
  t('the intent asserts that it cannot execute or hold secrets',
    intent.autonomousExecution === false && intent.requiresUserApproval === true && intent.secretsIncluded === false);
  let intentThrew = false;
  try {
    buildGoalIntent({ goal, plan: { allocation: [{ asset: 'BTC', percentage: 90 }] } });
  } catch {
    intentThrew = true;
  }
  t('a broken allocation cannot become an intent', intentThrew);

  /* The plan: the whole pipeline in one call. */
  const built = buildPlan({
    goal: { id: 'goal_plan', startingCapital: 10000, targetAmount: 20000, monthlyContribution: 0, riskProfile: 'MODERATE', currency: 'USD', createdAt: Date.now(), targetDate: Date.now() + 3 * 365.25 * 24 * 3600_000 },
    market: { live: true, stableYieldPct: 5, generatedAt: new Date().toISOString(), venuesMissing: [] },
    currentValueUsd: 11000
  });
  t('the plan reports the required return as a percentage', near(built.requiredReturnPct, 26, 0.6));
  t('the plan carries a risk score, an allocation and three scenarios',
    Number.isFinite(built.riskScore) && built.allocation.length === 4 && built.scenarios.length === 3);
  t('the bear scenario never projects growth from the market', built.scenarios[0].ratePct === 0);
  t('the bull scenario is the goal’s own required return', near(built.scenarios[2].ratePct, built.requiredReturnPct, 0.01));
  t('a goal that needs an implausible return is reported as beyond reach', (() => {
    const wild = buildPlan({
      goal: { id: 'goal_wild', startingCapital: 10000, targetAmount: 20000, createdAt: Date.now(), targetDate: Date.now() + 20 * 24 * 3600_000 },
      market: { live: true, stableYieldPct: 5 }
    });
    return wild.reachable === false && wild.reachReason === 'BEYOND_REACH' && wild.requiredReturnPct > 100;
  })());
  t('a sane three-year goal stays reachable',
    buildPlan({
      goal: { id: 'goal_sane', startingCapital: 10000, targetAmount: 20000, createdAt: Date.now(), targetDate: Date.now() + 3 * 365.25 * 24 * 3600_000 },
      market: { live: true, stableYieldPct: 5 }
    }).reachable === true);
  t('the plan states that nothing is guaranteed',
    built.guarantees.returnsGuaranteed === false && built.guarantees.priceForecastIncluded === false);
  t('projected yield comes only from the stable sleeve and live data', (() => {
    const stablePct = built.allocation.find((row) => row.asset === 'STABLE').percentage;
    return near(built.projectedYieldPct, (stablePct / 100) * 5, 0.01);
  })());
  t('with no live yield data the projected yield is null, not a guess',
    buildPlan({
      goal: { startingCapital: 10000, targetAmount: 20000, createdAt: Date.now(), targetDate: Date.now() + 3 * 365.25 * 24 * 3600_000 },
      market: { live: false, stableYieldPct: null }
    }).projectedYieldPct === null);

  /* Natural language stays on the device and stays deterministic. */
  t('the parser reads "double my capital in 3 years"',
    parseGoalFromText('I want to double my capital in 3 years').fields.multiplier === 2);
  t('the parser reads an amount range', (() => {
    const parsed = parseGoalFromText('grow 10,000 to 20,000 in 3 years');
    return parsed.fields.startingCapital === 10000 && parsed.fields.targetAmount === 20000 && parsed.fields.years === 3;
  })());
  t('the parser does not invent a target it cannot read',
    parseGoalFromText('make me rich please').matched === false);
}

/* ----------------------------- 2. the storage ----------------------------- */
{
  process.env.FINANCIAL_GOALS_SALT = process.env.FINANCIAL_GOALS_SALT || 'probe-salt';
  const store = await import('../server/financialGoals.js');
  const {
    createGoal,
    listGoals,
    getGoal,
    buildGoalPlan,
    approveGoalPlan,
    pauseGoalPlan,
    goalProgress,
    listEvents,
    validateGoalInput
  } = store;

  const now = Date.now();
  const inThreeYears = now + 3 * 365.25 * 24 * 3600_000;
  const good = {
    name: 'Double My Capital',
    startingCapital: 10000,
    targetAmount: 20000,
    targetDate: inThreeYears,
    riskProfile: 'MODERATE',
    monthlyContribution: 100
  };

  t('a target that is not above the start is refused', validateGoalInput({ ...good, targetAmount: 9000 }).code === 'TARGET_NOT_ABOVE_START');
  t('a deadline in the past is refused', validateGoalInput({ ...good, targetDate: now - 86400_000 }).code === 'TARGET_DATE_TOO_SOON');
  t('a nonsense starting capital is refused', validateGoalInput({ ...good, startingCapital: 0 }).code === 'BAD_STARTING_CAPITAL');
  t('an unnamed goal is refused', validateGoalInput({ ...good, name: '  ' }).code === 'BAD_NAME');

  const alice = 'tg:1001';
  const bob = 'tg:1002';

  const created = await createGoal(alice, good, { now });
  t('a goal is created with a draft status', created.ok === true && created.goal.status === 'DRAFT');
  const goalId = created.goal.id;

  t('the goal is listed for its owner', (await listGoals(alice)).length === 1);
  t('another owner sees no goals', (await listGoals(bob)).length === 0);
  t('another owner cannot read the goal', (await getGoal(bob, goalId)).code === 'GOAL_NOT_FOUND');
  t('another owner cannot build a plan for it', (await buildGoalPlan(bob, goalId, {}, { now })).code === 'GOAL_NOT_FOUND');

  const events = await listEvents(alice, goalId);
  t('creating a goal writes an event to financial_goal_events',
    events.some((e) => e.type === 'GOAL_CREATED'));

  /* The plan build hits the live venue feeds; a dead feed must still produce a
     plan with an honest market block rather than throwing. */
  const planResult = await buildGoalPlan(alice, goalId, { currentValueUsd: 12000 }, { now });
  t('a plan is built for the goal', planResult.ok === true && planResult.plan.goalId === goalId);
  t('the stored allocation still sums to 100%',
    Math.abs((planResult.plan.allocation || []).reduce((sum, row) => sum + row.percentage, 0) - 100) < 0.001);
  t('the plan records whether the market data was live', typeof planResult.plan.market.live === 'boolean');
  t('the goal now points at its latest plan', planResult.goal.latestPlanId === planResult.plan.id);
  t('building a plan writes an event',
    (await listEvents(alice, goalId)).some((e) => e.type === 'PLAN_BUILT'));

  t('approving before a plan exists is refused', (await approveGoalPlan(bob, goalId, { now })).code === 'GOAL_NOT_FOUND');

  const approved = await approveGoalPlan(alice, goalId, { now });
  t('approval activates the goal', approved.ok === true && approved.goal.status === 'ACTIVE');
  t('approval produces the FINANCIAL_GOAL intent payload',
    approved.intent?.source === 'FINANCIAL_GOAL' && approved.intent?.goalId === goalId);
  t('approval executes nothing: no transaction, no autonomous flag',
    approved.intent?.autonomousExecution === false && approved.intent?.requiresUserApproval === true);
  t('approval is recorded on the plan and in the timeline',
    approved.plan.approvedAt !== null && (await listEvents(alice, goalId)).some((e) => e.type === 'PLAN_APPROVED'));

  const paused = await pauseGoalPlan(alice, goalId, { paused: true, now });
  t('pausing sets PAUSED', paused.goal.status === 'PAUSED');
  const resumed = await pauseGoalPlan(alice, goalId, { paused: false, now });
  t('the same route resumes the goal', resumed.goal.status === 'ACTIVE');

  const before = await goalProgress(alice, goalId, { currentValueUsd: 12430, now });
  t('progress reports current, target and progress percent',
    before.progress.currentValueUsd === 12430 && before.progress.targetValueUsd === 20000 && before.progress.progressPct > 0);
  t('progress reports a status from the specified vocabulary',
    ['ON_TRACK', 'AHEAD', 'BEHIND', 'AT_RISK', 'COMPLETED', 'PAUSED'].includes(before.progress.status));
  t('a reported value is stored as a snapshot for the actual path',
    (await listEvents(alice, goalId)).some((e) => e.type === 'VALUE_SNAPSHOT' && e.data?.valueUsd === 12430));
  const repeated = await goalProgress(alice, goalId, { currentValueUsd: 12430, now: now + 1000 });
  t('the same value twice does not duplicate the snapshot',
    (await listEvents(alice, goalId)).filter((e) => e.type === 'VALUE_SNAPSHOT').length === 1
    && repeated.progress.actualPath.length === 1);
  const second = await goalProgress(alice, goalId, { currentValueUsd: 13000, now: now + 2000 });
  t('a new value extends the actual path', second.progress.actualPath.length === 2);
}

/* ------------------------------- 3. the API ------------------------------- */
{
  /* Mirror the runner's pinning so the shared app is not the first importer
     to decide the rate budgets for the whole process. */
  process.env.RATE_LIMIT = process.env.RATE_LIMIT || '100000';
  const { default: app } = await import('../server/app.js');
  const server = await new Promise((resolve) => {
    const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  const device = 'probe-device-scope-0001';

  const call = (path, { method = 'GET', body = null, scope = device } = {}) =>
    fetch(base + path, {
      method,
      headers: {
        accept: 'application/json',
        ...(body ? { 'content-type': 'application/json' } : {}),
        ...(scope ? { 'x-fbt-device': scope } : {})
      },
      ...(body ? { body: JSON.stringify(body) } : {})
    }).then(async (r) => ({ status: r.status, body: await r.json().catch(() => null) }));

  try {
    const unscoped = await call('/api/v1/financial-goals', { scope: null });
    t('a request with no scope is refused', unscoped.status === 401 && unscoped.body.error === 'DEVICE_SCOPE_REQUIRED');

    const created = await call('/api/v1/financial-goals', {
      method: 'POST',
      body: {
        name: 'Double My Capital',
        startingCapital: 10000,
        targetAmount: 20000,
        targetDate: Date.now() + 3 * 365.25 * 24 * 3600_000,
        riskProfile: 'MODERATE',
        monthlyContribution: 0
      }
    });
    t('POST /api/v1/financial-goals creates a goal', created.status === 201 && created.body.data?.status === 'DRAFT');
    const goalId = created.body.data?.id;

    const listed = await call('/api/v1/financial-goals');
    t('GET /api/v1/financial-goals lists it', listed.status === 200 && listed.body.data?.length === 1);

    const other = await call('/api/v1/financial-goals', { scope: 'probe-device-scope-0002' });
    t('a different device scope sees a different goal set', other.body.data?.length === 0);

    const fetched = await call(`/api/v1/financial-goals/${goalId}`);
    t('GET /api/v1/financial-goals/:id returns the goal and its plan', fetched.status === 200 && fetched.body.data?.goal?.id === goalId);

    const missing = await call('/api/v1/financial-goals/goal_nope');
    t('an unknown goal is a 404', missing.status === 404 && missing.body.error === 'GOAL_NOT_FOUND');

    const badGoal = await call('/api/v1/financial-goals', { method: 'POST', body: { name: 'x', startingCapital: 100, targetAmount: 50, targetDate: Date.now() + 86400000 } });
    t('an impossible goal is refused with a code, not stored', badGoal.status === 400 && badGoal.body.error === 'TARGET_NOT_ABOVE_START');

    const planned = await call(`/api/v1/financial-goals/${goalId}/build-plan`, { method: 'POST', body: { currentValueUsd: 11000 } });
    t('POST /:id/build-plan returns required return, risk score and allocation',
      planned.status === 200
      && Number.isFinite(planned.body.data?.plan?.requiredReturnPct)
      && Number.isFinite(planned.body.data?.plan?.riskScore)
      && planned.body.data?.plan?.allocation?.length === 4);
    t('the plan response says whether the market feed was live',
      typeof planned.body.meta?.market?.live === 'boolean');
    t('the plan response repeats that no return is guaranteed',
      planned.body.data?.plan?.guarantees?.returnsGuaranteed === false);

    const approved = await call(`/api/v1/financial-goals/${goalId}/approve`, { method: 'POST', body: {} });
    t('POST /:id/approve returns the intent payload',
      approved.status === 200 && approved.body.data?.intent?.source === 'FINANCIAL_GOAL');
    t('approval names the next step instead of executing',
      approved.body.meta?.executed === false && approved.body.meta?.nextStep === 'REVIEW_AND_SIGN_IN_INTENT_OS');

    const paused = await call(`/api/v1/financial-goals/${goalId}/pause`, { method: 'POST', body: {} });
    t('POST /:id/pause pauses the goal', paused.status === 200 && paused.body.data?.goal?.status === 'PAUSED');

    const progress = await call(`/api/v1/financial-goals/${goalId}/progress?currentValueUsd=12430`);
    t('GET /:id/progress returns the monitoring facts',
      progress.status === 200
      && progress.body.data?.progress?.currentValueUsd === 12430
      && progress.body.data?.progress?.targetValueUsd === 20000
      && Array.isArray(progress.body.data?.progress?.expectedPath)
      && Array.isArray(progress.body.data?.progress?.actualPath)
      && typeof progress.body.data?.progress?.status === 'string');
    t('a paused goal reports PAUSED', progress.body.data?.progress?.status === 'PAUSED');

    t('the API reports its durability honestly',
      typeof listed.body.meta?.durable === 'boolean' && listed.body.meta?.tables?.length === 3);
  } finally {
    server.close();
  }
}

/* -------------------- 4. the hand-off into the real Intent OS -------------- */
/*
 * The browser-side hand-off, run for real: the payload becomes an ordinary
 * draft through the existing compiler and lands in the same localStorage
 * collection the compose tab reads. localStorage is stubbed only because this
 * is Node, and the previous value is restored afterwards — run.mjs installs a
 * jsdom DOM for later suites and a probe must not quietly replace it.
 */
{
  const previous = globalThis.localStorage;
  const memory = new Map();
  globalThis.localStorage = {
    getItem: (k) => (memory.has(k) ? memory.get(k) : null),
    setItem: (k, v) => memory.set(k, String(v)),
    removeItem: (k) => memory.delete(k),
    clear: () => memory.clear(),
    get length() { return memory.size; },
    key: (i) => [...memory.keys()][i] ?? null
  };
  try {
    const { handOffToIntentOS, goalIntentLegs, skippedLegs } = await import('../src/lib/financialGoalIntent.js');
    const { loadIntents } = await import('../src/lib/intentOS.js');
    const { getLifecycle } = await import('../src/lib/intentLifecycle.js');

    const goal = { id: 'goal_handoff', name: 'Double My Capital', startingCapital: 10000, currency: 'USD' };
    const intent = {
      schema: 'fbt.financial-goal-intent.v1',
      source: 'FINANCIAL_GOAL',
      goalId: goal.id,
      currency: 'USD',
      totalAmount: 10000,
      actions: [
        { type: 'ALLOCATE', asset: 'BTC', percentage: 24, amount: 2400 },
        { type: 'ALLOCATE', asset: 'ETH', percentage: 14, amount: 1400 },
        { type: 'ALLOCATE', asset: 'STABLE', percentage: 32, amount: 3200 },
        { type: 'ALLOCATE', asset: 'OTHER', percentage: 30, amount: 3000 }
      ]
    };

    t('only the tradable assets become legs', goalIntentLegs(intent).map((l) => l.asset).join(',') === 'BTC,ETH');
    t('the non-tradable sleeves are reported, not invented',
      skippedLegs(intent).join(',') === 'STABLE,OTHER');

    const handed = handOffToIntentOS({ goal, intent });
    t('the hand-off compiles an ordinary Intent OS draft', handed.ok === true && handed.kind === 'workflow');
    t('each leg becomes a swap step in that draft',
      handed.compiled?.intent?.steps?.map((s) => `${s.action}:${s.asset}`).join(' ') === 'swap:BTC swap:ETH');
    t('the draft is not blocked by the existing risk checks', handed.blocked === false);
    t('the draft is saved where the compose tab reads it',
      loadIntents().some((row) => row.intent.id === handed.intentId));
    t('the existing lifecycle tracks it', getLifecycle(handed.intentId)?.status === 'VALIDATED');
    t('the hand-off does not hand over an execution (a workflow has no swap hand-off)',
      handed.compiled?.handoff === null);

    const stableOnly = { ...intent, actions: [{ type: 'ALLOCATE', asset: 'STABLE', percentage: 100, amount: 10000 }] };
    const none = handOffToIntentOS({ goal, intent: stableOnly });
    t('an all-stable allocation makes no fake trade', none.ok === false && none.error === 'NO_TRADABLE_LEGS');

    const notAnIntent = handOffToIntentOS({ goal, intent: { source: 'SOMETHING_ELSE', actions: [] } });
    t('anything that is not a FINANCIAL_GOAL payload is refused', notAnIntent.ok === false);
  } finally {
    if (previous) globalThis.localStorage = previous;
    else delete globalThis.localStorage;
  }
}

/* --------------------------- 5. wiring and safety -------------------------- */
{
  const component = readFileSync('src/components/FinancialGoals.jsx', 'utf8');
  const serverModule = readFileSync('server/financialGoals.js', 'utf8');
  const client = readFileSync('src/lib/financialGoals.js', 'utf8');
  const handoff = readFileSync('src/lib/financialGoalIntent.js', 'utf8');
  const page = readFileSync('src/pages/IntentOS.jsx', 'utf8');
  const app = readFileSync('server/app.js', 'utf8');

  t('the goals screen is rendered on the plan tab', /<FinancialGoals/.test(page) && /tab === 'plan'/.test(page));
  t('the legacy profit planner is still reachable', /<ProfitPlanner/.test(page));
  t('no agent vocabulary is shown to the user', !/agent/i.test(component));
  t('the UI holds no hardcoded Persian or Arabic string', !/[\u0600-\u06FF]/.test(component));
  t('the hand-off compiles through the EXISTING Intent OS compiler', /compileIntent\(/.test(handoff) && /saveCompiledIntent\(/.test(handoff));
  t('the hand-off never signs or broadcasts', !/sendTransaction|signTransaction|broadcast/.test(handoff));
  t('the client exposes the goal-engine one-call surface', /analyzeGoal\s*=/.test(client) && /whatIfGoal\s*=/.test(client) && /simulateGoal\s*=/.test(client));
  t('the HTTP app wires the goal-engine routes', /:id\/analyze/.test(app) && /:id\/what-if/.test(app) && /:id\/simulate/.test(app));
  t('the plan tab renders the GOAL HEALTH card', /fg-goal-health/.test(component));
  t('the plan tab renders the PROFIT PLAN (strategies + futures) card', /fg-profit-plan/.test(component) && /fg-strategies/.test(component) && /fg-futures/.test(component));
  t('the plan tab renders the FORECAST (what-if + simulator) card', /fg-forecast/.test(component) && /fg-whatif/.test(component) && /fg-sim-table/.test(component));
  t('new goal-engine strings exist in English and Persian', (() => {
    const en = JSON.parse(readFileSync('src/i18n/locales/en.json', 'utf8'));
    const fa = JSON.parse(readFileSync('src/i18n/locales/fa.json', 'utf8'));
    const keys = ['healthTitle', 'profitPlan', 'strategies', 'futuresExposure', 'forecast', 'whatIf', 'simulator'];
    return keys.every((k) => en.intentOS.goals[k] && fa.intentOS.goals[k]);
  })());
  t('the client sends no secret anywhere', !/privateKey|seedPhrase|mnemonic|apiKey/i.test(client));
  t('the server module reads no credential', !/privateKey|seedPhrase|mnemonic/i.test(serverModule));
  t('the server module has no execution path', !/sendTransaction|ethers\.Wallet|broadcastTransaction/.test(serverModule));
  t('the UI labels required return as required, not as a promise', /requiredReturn/.test(component) && !/guaranteed return/i.test(component));
}

/* Run the file directly (npm run test:financial-goals) and it prints; import
   it from run.mjs and the shared reporter prints it. Rows are the same in both
   cases, so a probe can never pass in one harness and fail in the other. */
const invokedDirectly = Boolean(process.argv?.[1] && process.argv[1].endsWith('financial-goals-probe.mjs'));
if (invokedDirectly) {
  const fails = rows.filter(([, ok]) => !ok);
  for (const [name, ok] of rows) console.log(`  ${ok ? '\u2713' : '\u2717'} ${name}`);
  console.log(`\npassed ${rows.length - fails.length}/${rows.length}`);
  process.exitCode = fails.length ? 1 : 0;
}

export default rows;
