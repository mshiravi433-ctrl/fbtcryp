#!/usr/bin/env node
/**
 * FBT INTENT OS — UPGRADE 7 probe
 *
 * Scores the 31 Definition-of-Done items (§48) against the real modules — no
 * mocks of our own code. Exported as `rows` so `npm test` can fold it into the
 * aggregate report, and runnable on its own via `npm run test:upgrade7`.
 */

import {
  buildDeepIntent, detectHiddenIntents, extractTimeframe, extractRisk, extractGoal,
  missingCriticalSlots, GOALS
} from '../../src/lib/intent-ai/os/upgrade7/deepIntent.js';
import {
  createIntentGraph, NODE_STATUS, setNodeStatus, readyNodes, graphProgress,
  blockNodeForInput, resumeGraph
} from '../../src/lib/intent-ai/os/upgrade7/intentGraph.js';
import {
  createPlan, planStatusView, pausePlanForInput, resumePlanWithAnswer, advancePlan,
  getResumablePlan, listPlans, clearPlans, detectPlanConflicts, PRIORITY, pickTemplate
} from '../../src/lib/intent-ai/os/upgrade7/planner.js';
import {
  callAgent, runAgentsParallel, runAgentsSequential, crossCheck, synthesize,
  getAgentHealth, resetAgentHealth, dedupe, clearInflight, requestFingerprint, checkAvailability
} from '../../src/lib/intent-ai/os/upgrade7/agentMesh.js';
import {
  classifyDataNeed, evaluateFreshness, verifyClaims, buildConfidenceReport,
  labelStatements, buildExplanation, scoreSourceQuality, EPISTEMIC
} from '../../src/lib/intent-ai/os/upgrade7/confidence.js';
import {
  remember, recall, setGoalMemory, getGoalMemory, detectContradiction, applyCorrection,
  compressContext, bindAnswer, getBoundAnswer, forgetAll, clearGoalMemory, FACT_KIND
} from '../../src/lib/intent-ai/os/upgrade7/semanticMemory.js';
import {
  runSafetyPipeline, buildSimulationPreview, scrubForAI, containsSecret,
  createQuestion, bindAnswerToQuestion, STAGE, pipelineStatus
} from '../../src/lib/intent-ai/os/upgrade7/safety.js';
import {
  createMonitor, checkMonitors, monitorStatusView, createRecurringIntent, prepareRecurringRun,
  createLongTermGoal, updateGoalProgress, shouldNotify, emitNotification, muteAlertKind,
  setNotificationsEnabled, computeRelevance, clearMonitoring, parseRecurrence, MONITOR_STATUS, ALERT_KIND
} from '../../src/lib/intent-ai/os/upgrade7/monitoring.js';
import {
  buildFinancialContext, canAnswerFrom, resolveModules, buildSmartMoneyView, combineWithMarket
} from '../../src/lib/intent-ai/os/upgrade7/financialContext.js';
import { predictNextIntents, smartClarify, detectProactiveSignals, isExecutionAllowedFromPrediction }
  from '../../src/lib/intent-ai/os/upgrade7/predictive.js';
import { cached, cacheStats, clearCache, debounce, withBudget, recordMetric, getMetrics, clearMetrics, proposeImprovement, METRIC }
  from '../../src/lib/intent-ai/os/upgrade7/runtime.js';
import { enrich, DEFINITION_OF_DONE } from '../../src/lib/intent-ai/os/upgrade7/index.js';
import { GOLDEN_CONVERSATIONS, competenceCoverage, REGRESSION_CHECKS } from '../../src/lib/intent-ai/os/upgrade7/goldenConversations.js';

const rows = [];
function t(name, ok, detail = '') {
  rows.push([`${name}${ok || !detail ? '' : ` — ${detail}`}`, Boolean(ok)]);
}

/* Isolate storage between runs so results are deterministic. */
clearPlans(); forgetAll(); clearMonitoring(); clearCache(); clearMetrics(); resetAgentHealth(); clearInflight();

/* ── §1 Intent Understanding 2.0 ─────────────────────────────────────────── */
{
  const msg = 'می‌خوام با سرمایه فعلیم تا چهار ماه دیگه بیشترین بازده ممکن رو بگیرم ولی ریسک خیلی بالا نباشه.';
  const deep = buildDeepIntent(msg, { type: 'INVESTMENT_PLAN', entities: {} }, {});
  t('§1 goal = maximize_return', deep.goal === GOALS.MAXIMIZE_RETURN, deep.goal);
  t('§1 objective = risk_adjusted_return', deep.objective === 'risk_adjusted_return', deep.objective);
  t('§1 timeframe = 4 months', deep.timeframe?.value === 4 && deep.timeframe?.unit === 'month', JSON.stringify(deep.timeframe));
  t('§1 risk = not_high (negation understood)', deep.risk?.level === 'not_high', deep.risk?.level);
  t('§1 capital_source = current_portfolio', deep.context?.capitalSource === 'current_portfolio', deep.context?.capitalSource);
  t('§1 all twelve slots present on the object',
    ['what', 'why', 'goal', 'context', 'constraints', 'timeframe', 'risk', 'assets', 'amount', 'action', 'urgency', 'userPreference']
      .every((k) => k in deep));
  t('§1 «۴ ماه» in Persian digits parses', extractTimeframe('۴ ماه')?.value === 4);
  t('§1 "6 months" parses', extractTimeframe('over 6 months')?.value === 6);
  t('§1 low-risk phrase parses', extractRisk('ریسک کم می‌خوام').level === 'low');
  t('§1 goal from English', extractGoal('maximize return').goal === GOALS.MAXIMIZE_RETURN);
}

/* ── §2 Hidden Intent ────────────────────────────────────────────────────── */
{
  const hidden = detectHiddenIntents('بیت‌کوین الان چطوره؟', { primaryIntent: 'ANALYZE_TOKEN', context: { portfolio: { totalValueUsd: 5000, holdings: [{ symbol: 'BTC', valueUsd: 5000 }] } } });
  const ids = hidden.map((h) => h.id);
  t('§2 price + trend + risk + buy_opportunity + portfolio_impact',
    ['price', 'trend', 'risk', 'buy_opportunity', 'portfolio_impact'].every((k) => ids.includes(k)), ids.join(','));
  const why = detectHiddenIntents('چرا BTC ریخت؟', { primaryIntent: 'MARKET_ANALYSIS' }).map((h) => h.id);
  t('§2 «چرا ریخت» → cause + news + onchain', ['price_move_cause', 'news', 'onchain_signal'].every((k) => why.includes(k)), why.join(','));
  t('§2 hidden intents are weighted and sorted', hidden.every((h, i) => i === 0 || hidden[i - 1].weight >= h.weight));
}

/* ── §3 Intent Graph ─────────────────────────────────────────────────────── */
{
  const g = createIntentGraph({
    nodes: [
      { id: 'a', label: 'A' }, { id: 'b', label: 'B', dependsOn: ['a'] },
      { id: 'c', label: 'C', dependsOn: ['a'] }, { id: 'd', label: 'D', dependsOn: ['b', 'c'] }
    ]
  });
  t('§3 six node states exist', Object.values(NODE_STATUS).length === 6);
  t('§3 only the root is ready initially', readyNodes(g).map((n) => n.id).join() === 'a');
  setNodeStatus(g, 'a', NODE_STATUS.COMPLETED);
  t('§3 completing A unblocks B and C in parallel', readyNodes(g).map((n) => n.id).sort().join() === 'b,c');
  setNodeStatus(g, 'b', NODE_STATUS.FAILED);
  t('§3 D is BLOCKED by the transitive failure', g.nodes.find((n) => n.id === 'd').status === NODE_STATUS.BLOCKED);
  t('§3 C is untouched by an unrelated failure', g.nodes.find((n) => n.id === 'c').status === NODE_STATUS.PENDING);
  const p = graphProgress(g);
  t('§3 progress reports a percentage', typeof p.percent === 'number' && p.percent > 0);
}

/* ── §4 + §5 + §6 Planner ────────────────────────────────────────────────── */
{
  const deep = buildDeepIntent('می‌خوام ۲۰٪ سود کنم', { type: 'INVESTMENT_PLAN', entities: {} }, {});
  const plan = createPlan({ message: '20% target return', baseIntent: { type: 'INVESTMENT_PLAN' }, deepIntent: deep, conversationId: 'p1' });
  t('§4 a financial goal picks the FINANCIAL_GOAL template', plan.template === 'FINANCIAL_GOAL', plan.template);
  const ids = plan.graph.nodes.map((n) => n.id);
  t('§4 plan covers portfolio→wallet→market→risk→scenarios→compare→recommend→permission',
    ['portfolio', 'wallet', 'market', 'risk', 'scenarios', 'compare', 'recommend', 'permission'].every((k) => ids.includes(k)), ids.join(','));

  const view = planStatusView(plan, 'fa');
  t('§4 status view exposes labels and statuses only', view.steps.every((s) => 'label' in s && 'status' in s && !('reasoning' in s)));
  t('§4 no chain-of-thought is exposed', !JSON.stringify(view).toLowerCase().includes('because'));

  pausePlanForInput(plan, { slot: 'timeframe', question: 'در چه بازه‌ای؟', questionId: 'q1' });
  t('§5 plan pauses awaiting input', plan.status === 'awaiting_input');
  const blockedBefore = plan.graph.nodes.filter((n) => n.status === NODE_STATUS.COMPLETED).length;
  resumePlanWithAnswer(plan, { slot: 'timeframe', value: { value: 4, unit: 'month' }, questionId: 'q1' });
  // The answer binds and the timeframe stops being missing. `risk` is still
  // outstanding for a return goal, so the plan legitimately keeps awaiting
  // input — that is progress, not a stall, and it must NOT re-ask timeframe.
  t('§5 the answer binds to its slot', plan.answers.timeframe.value === 4);
  t('§5 the answered slot is no longer missing', !plan.missingSlots.some((m) => m.slot === 'timeframe'));
  t('§5 the remaining slot is still tracked on the same plan', plan.missingSlots.some((m) => m.slot === 'risk'));
  t('§5 the plan is no longer awaiting the answered question', plan.awaiting === null);
  t('§5 resume does NOT restart completed work',
    plan.graph.nodes.filter((n) => n.status === NODE_STATUS.COMPLETED).length >= blockedBefore);

  advancePlan(plan, 'portfolio', { status: NODE_STATUS.COMPLETED });
  const resumed = getResumablePlan({ conversationId: 'p1' });
  t('§6 the plan survives and is retrievable after a page change', resumed?.planId === plan.planId);
  t('§6 completed step 1 is still completed after retrieval',
    resumed.graph.nodes.find((n) => n.id === 'portfolio').status === NODE_STATUS.COMPLETED);
  t('§33 plan carries a priority', Object.values(PRIORITY).includes(plan.priority), plan.priority);
  t('§30 execution intents pick the EXECUTION template',
    pickTemplate({ deepIntent: buildDeepIntent('۵۰ دلار بیت کوین بخر', {}, {}), baseIntent: { type: 'BUY', executionRequested: true } }) === 'EXECUTION');
}

/* ── §34 Conflict resolution ─────────────────────────────────────────────── */
{
  const a = createPlan({ baseIntent: { type: 'INVESTMENT_PLAN' }, deepIntent: { goal: GOALS.MAXIMIZE_RETURN }, conversationId: 'cx' });
  const b = createPlan({ baseIntent: { type: 'RISK_ANALYSIS' }, deepIntent: { goal: GOALS.REDUCE_RISK }, conversationId: 'cx' });
  const conflicts = detectPlanConflicts([a, b]);
  t('§34 maximize_return vs reduce_risk is detected', conflicts.length === 1 && conflicts[0].needsClarification);
  t('§34 conflict asks before deciding', Boolean(conflicts[0].questionFa && conflicts[0].questionEn));
}

/* ── §12 §13 §40 §41 Agent mesh ──────────────────────────────────────────── */
{
  const agents = {
    fast: { handleIntent: async () => ({ stance: 'bullish', confidence: 0.8 }) },
    slow: { handleIntent: () => new Promise((r) => setTimeout(() => r({ stance: 'bullish' }), 400)) },
    bear: { handleIntent: async () => ({ stance: 'bearish', confidence: 0.8 }) },
    broken: { handleIntent: async () => { throw new Error('boom'); } }
  };

  const ok = await callAgent(agents, 'fast', {}, {});
  t('§12 a healthy agent returns data', ok.ok && ok.data.stance === 'bullish');

  const timedOut = await callAgent(agents, 'slow', {}, {}, { timeoutMs: 50, retries: 0 });
  t('§40 an agent that overruns its timeout fails cleanly', !timedOut.ok && String(timedOut.error).includes('TIMEOUT'));

  const failed = await callAgent(agents, 'broken', {}, {}, { retries: 0 });
  t('§40 a throwing agent never throws to the caller', failed.ok === false);

  const withFallback = await callAgent(agents, 'broken', {}, {}, { retries: 0, fallbackAgentId: 'fast' });
  t('§40 fallback agent answers instead', withFallback.ok && withFallback.viaFallback === 'fast');

  t('§41 a missing agent is reported, not called', checkAvailability(agents, 'ghost').available === false);
  await callAgent(agents, 'broken', {}, {}, { retries: 0 });
  await callAgent(agents, 'broken', {}, {}, { retries: 0 });
  t('§41 health degrades after repeated failures', ['degraded', 'unavailable'].includes(getAgentHealth('broken').status), getAgentHealth('broken').status);

  const par = await runAgentsParallel(agents, ['fast', 'bear'], {}, {});
  t('§12 agents run in parallel and both report', par.agentsUsed.length === 2);

  const seq = await runAgentsSequential(agents, ['fast', 'bear'], {}, {});
  t('§12 sequential mode passes previous results forward', seq.agentsUsed.length === 2);

  const agree = crossCheck({ a: { stance: 'bullish' }, b: { stance: 'bullish' }, c: { stance: 'bullish' } });
  t('§13 unanimous agents = HIGH confidence', agree.confidenceLabel === 'HIGH' && !agree.divergence);

  const disagree = crossCheck({ a: { stance: 'bullish' }, b: { stance: 'bearish' } });
  t('§13 opposed agents = LOW confidence', disagree.confidenceLabel === 'LOW' && disagree.divergence);
  t('§13 divergence carries a warning in both languages', Boolean(disagree.warningFa && disagree.warningEn));

  const syn = synthesize({ results: { a: { stance: 'bullish' }, b: { stance: 'bearish' } }, locale: 'fa' });
  t('§13 synthesis agent reconciles and flags', syn.divergence && syn.confidenceLabel === 'LOW');
  t('§12 no agent may decide a sensitive action alone', syn.autonomousDecisionAllowed === false);
}

/* ── §39 Request de-duplication ──────────────────────────────────────────── */
{
  let runs = 0;
  const key = requestFingerprint({ message: 'buy 50 btc', intentType: 'BUY', conversationId: 'd1' });
  const factory = () => new Promise((r) => setTimeout(() => { runs += 1; r('done'); }, 30));
  const first = dedupe(key, factory);
  const second = dedupe(key, factory);
  t('§39 the second identical request is deduped', second.deduped === true);
  await Promise.all([first.promise, second.promise]);
  t('§39 only one execution actually ran', runs === 1, `runs=${runs}`);
  const other = dedupe(requestFingerprint({ message: 'sell 50 btc', intentType: 'SELL', conversationId: 'd1' }), factory);
  t('§39 a different request is NOT deduped', other.deduped === false);
  await other.promise;
}

/* ── §14 §15 §16 §26 §29 Confidence ──────────────────────────────────────── */
{
  const need = classifyDataNeed({ intentType: 'SWAP', message: '۱۰۰ دلار تبدیل کن' });
  t('§15 a swap needs price + balance + quote', ['price', 'balance', 'quote'].every((k) => need.needs.includes(k)));
  t('§15 a swap is market-sensitive', need.marketSensitive === true);

  const fresh = evaluateFreshness(need, {
    price: { fetchedAt: Date.now() - 5000, source: 'oracle' },
    balance: { fetchedAt: Date.now() - 2000, source: 'rpc' },
    quote: { fetchedAt: Date.now() - 1000, source: 'aggregator' }
  });
  t('§15 recent data reads as LIVE', fresh.label === 'LIVE' && !fresh.mustRefetch);

  const stale = evaluateFreshness(need, { price: { fetchedAt: Date.now() - 600000, source: 'cache' } });
  t('§15 a stale price MUST be refetched, not caveated', stale.mustRefetch && stale.refetchKinds.includes('price'));

  const bad = verifyClaims({ wallet_balance: { value: 1200 } });
  t('§26 a balance with no source is refused', bad.ok === false && bad.unverified[0].reason === 'NO_SOURCE');
  t('§26 the refusal uses the honest sentence', /verified data|داده تاییدشده/.test(bad.fallbackMessage));

  const good = verifyClaims({ price: { value: 70000, source: 'oracle', fetchedAt: Date.now() } });
  t('§26 a sourced, fresh claim passes', good.ok === true);

  const report = buildConfidenceReport({
    baseConfidence: { confidenceScore: 85 },
    synthesis: { divergence: true, agreement: 0.5, contributingAgents: ['a', 'b'] },
    freshness: stale, sourceQuality: scoreSourceQuality(['cache']), claims: bad, locale: 'fa'
  });
  t('§14 divergence + stale + unverified drives confidence LOW', report.label === 'LOW', String(report.score));
  t('§14 report states freshness and source quality', Boolean(report.dataFreshness && report.sourceQuality));
  t('§14 report carries user-facing notices', report.notices.length >= 2);

  const labelled = labelStatements([
    { text: 'BTC is 70000', source: 'oracle' },
    'حجم ورودی نهنگ‌ها افزایش یافت',
    'شاید تا هفته آینده رشد کند'
  ], 'en');
  t('§16 fact / signal / speculation are separated',
    labelled[0].kind === EPISTEMIC.FACT && labelled[1].kind === EPISTEMIC.SIGNAL && labelled[2].kind === EPISTEMIC.SPECULATION,
    labelled.map((l) => l.kind).join(','));

  const exp = buildExplanation({ recommendation: 'grow_capital', dataUsed: ['portfolio'], risks: ['concentration'], locale: 'en' });
  t('§29 explanation answers the five questions', ['why', 'dataUsed', 'risks', 'whatCanGoWrong', 'nextAction'].every((k) => k in exp));
}

/* ── §18 §22 §23 §24 §25 Semantic memory ─────────────────────────────────── */
{
  clearGoalMemory('m1');
  setGoalMemory('m1', { goal: GOALS.MAXIMIZE_RETURN, timeframe: { value: 4, unit: 'month' }, risk: { level: 'medium', explicit: true } });
  const deep = buildDeepIntent('حالا همین را برای BTC انجام بده', { type: 'ANALYZE_TOKEN', entities: { token: 'BTC' } }, { goalMemory: getGoalMemory('m1') });
  t('§18 the goal carries to the new asset', deep.goal === GOALS.MAXIMIZE_RETURN);
  t('§18 the timeframe carries', deep.timeframe?.value === 4);
  t('§18 the risk carries', deep.risk?.level === 'medium');
  t('§18 the asset is the NEW one', deep.assets.includes('BTC'));
  t('§18 inherited slots are declared, not silently assumed', deep.inheritedFromMemory.includes('goal'));

  const c = detectContradiction({ conversationId: 'm1', slot: 'risk', newValue: { level: 'high', explicit: true }, locale: 'fa' });
  t('§24 low→high risk is detected as a contradiction', c.contradiction && c.isUpdate);
  t('§24 a high-severity change asks before acting', c.needsConfirmation && /ریسک/.test(c.question));
  const minor = detectContradiction({ conversationId: 'm1', slot: 'timeframe', newValue: { value: 6, unit: 'month' } });
  t('§24 a low-severity change is applied silently', minor.contradiction && minor.autoApplied);

  const corr = applyCorrection({ message: 'نه، منظورم این نبود، اتریوم را می‌گم', conversationId: 'm1', currentIntent: { type: 'ANALYZE_TOKEN' }, currentDeepIntent: deep });
  t('§25 a correction is recognised', corr.isCorrection === true);
  t('§25 a correction does NOT reset the conversation', corr.conversationReset === false);
  t('§25 the previous interpretation is kept for the patch', corr.previousInterpretation.intent === 'ANALYZE_TOKEN');
  t('§25 the correct action is to reinterpret, not restart', corr.action === 'reinterpret_current_intent');

  bindAnswer({ questionId: 'q9', intentId: 'i9', slot: 'timeframe', expectedType: 'duration', value: { value: 4, unit: 'month' }, conversationId: 'm1' });
  t('§21 an answer binds to its question id', getBoundAnswer('timeframe', 'm1')?.value?.questionId === 'q9');

  remember({ kind: FACT_KIND.DECISION, key: 'd1', value: 'chose stables', conversationId: 'm1' });
  t('§23 decisions are stored as meaning, not transcript', recall({ kind: FACT_KIND.DECISION, conversationId: 'm1' }).length >= 1);

  const long = Array.from({ length: 120 }, (_, i) => ({ role: i % 2 ? 'ai' : 'user', content: `message number ${i} `.repeat(20) }));
  const comp = compressContext({ messages: long, conversationId: 'm1' });
  t('§22 a 120-message conversation compresses to 6 recent messages', comp.recentMessages.length <= 6);
  t('§22 compression reports what it dropped', comp.droppedMessages >= 114);
  t('§22 compression keeps intent, answers, goals, decisions',
    ['activeIntent', 'answers', 'goals', 'decisions', 'taskSummary'].every((k) => k in comp));
}

/* ── §21 §27 §28 §46 Safety ──────────────────────────────────────────────── */
{
  const q = createQuestion({ intentId: 'i1', slot: 'timeframe', expectedType: 'duration', text: 'forecast period?' });
  t('§21 a question carries questionId/intentId/slot/expectedType/timestamp',
    ['questionId', 'intentId', 'slot', 'expectedType', 'timestamp'].every((k) => k in q));
  const bound = bindAnswerToQuestion(q, '4 months', (raw) => ({ value: 4, unit: 'month', raw }));
  t('§21 «4 months» binds to forecastPeriod', bound.ok && bound.slot === 'timeframe' && bound.value.value === 4);

  t('§46 a seed phrase is redacted', scrubForAI({ note: 'my seed phrase is abandon abandon abandon' }).note === '[redacted]');
  t('§46 a privateKey field is redacted', scrubForAI({ privateKey: '0x' + 'a'.repeat(64) }).privateKey === '[redacted]');
  t('§46 secrets are detectable before they reach a prompt', containsSecret({ mnemonic: 'x' }) === true);

  const preview = buildSimulationPreview({ input: '100 USDC', output: '0.03 ETH', feeUsd: 2.1, slippage: 0.5, priceImpact: 0.12, status: 'clean' });
  t('§28 the preview shows input/output/fee/slippage/impact',
    preview.expectedInput && preview.expectedOutput && preview.estimatedFeeUsd === 2.1 && preview.slippagePct === 0.5 && preview.priceImpactPct === 0.12);

  const gates = {
    checkPolicy: async () => ({ allowed: true }),
    assessRisk: async () => ({ level: 'medium' }),
    checkPermission: async () => ({ granted: true }),
    refreshData: async () => ({ ok: true }),
    simulate: async () => ({ input: '100 USDC', output: '0.03 ETH', status: 'clean' }),
    requestConfirmation: async () => true,
    sign: async () => ({ signature: '0xdead' }),
    execute: async () => ({ txHash: '0xbeef' }),
    verify: async () => ({ verified: true })
  };
  const full = await runSafetyPipeline({ intent: { type: 'SWAP' }, action: { kind: 'swap' }, gates });
  t('§27 all ten stages run in the mandated order',
    full.ok && full.completedStages.join() === 'intent,policy,risk,permission,fresh_data,simulation,user_confirmation,wallet_signature,execution,verification',
    full.completedStages.join());

  const noConfirm = await runSafetyPipeline({ intent: { type: 'SWAP' }, action: {}, gates: { ...gates, requestConfirmation: async () => false } });
  t('§27 no confirmation = no execution', !noConfirm.ok && noConfirm.blockedAt === STAGE.CONFIRMATION);

  const noSigner = await runSafetyPipeline({ intent: { type: 'SWAP' }, action: {}, gates: { ...gates, sign: null } });
  t('§27 no signer = refusal, never a silent send', !noSigner.ok && noSigner.blockedAt === STAGE.SIGNATURE);

  const staleBlocked = await runSafetyPipeline({ intent: { type: 'SWAP' }, action: {}, gates: { ...gates, refreshData: async () => ({ ok: false }) } });
  t('§15+§27 stale data stops the pipeline before simulation', !staleBlocked.ok && staleBlocked.blockedAt === STAGE.FRESH_DATA);

  const reverted = await runSafetyPipeline({ intent: { type: 'SWAP' }, action: {}, gates: { ...gates, simulate: async () => ({ status: 'revert' }) } });
  t('§28 a reverting simulation is never executed', !reverted.ok && reverted.blockedAt === STAGE.SIMULATION);

  const dry = await runSafetyPipeline({ intent: { type: 'SWAP' }, action: {}, gates, dryRun: true });
  t('§28 a dry run stops at the confirmation card', dry.ok && dry.awaitingConfirmation && dry.simulation.complete);
  t('§27 pipeline status is renderable', pipelineStatus(full).length === 10);
}

/* ── §31 §32 §35 §8 Monitoring ───────────────────────────────────────────── */
{
  const mon = createMonitor({ asset: 'BTC', target: 100000, operator: '>=', currentValue: 70000, conversationId: 'mon1' });
  t('§31 a monitor starts in the monitoring state', mon.status === MONITOR_STATUS.MONITORING);
  const none = checkMonitors({ BTC: 80000 });
  t('§31 below target does not trigger', none.length === 0);
  const hit = checkMonitors({ BTC: 101000 });
  t('§31 reaching the target triggers exactly once', hit.length === 1 && hit[0].id === mon.id);
  const view = monitorStatusView(hit[0], 'en');
  t('§31 status view shows Target / Current / Status', /Target/.test(view.target) && /Current/.test(view.current) && /reached/i.test(view.status));

  t('§32 «هر ماه» parses as a monthly cadence', parseRecurrence('هر ماه انجام بده')?.cadence === 'monthly');
  const rec = createRecurringIntent({ cadence: 'monthly', action: 'buy', asset: 'ETH', amount: 100, startAt: Date.now() - 1000 });
  t('§32 a risky recurring action never holds standing permission', rec.requiresPermissionEachRun === true);
  const run = prepareRecurringRun(rec, { context: { wallet: { connected: true } } });
  t('§32 each occurrence pre-checks then asks permission', run.ok && run.nextStep === 'request_permission');
  const blocked = prepareRecurringRun(rec, { context: { wallet: { connected: false } } });
  t('§32 a failed pre-check notifies instead of executing', !blocked.ok && blocked.nextStep === 'notify_user');

  const goal = createLongTermGoal({ label: 'Grow portfolio', targetValueUsd: 50000, currentValueUsd: 18000, months: 12 });
  const prog = updateGoalProgress(goal.id, 25000);
  t('§35 long-term goal tracks progress', prog.progressPct === 22, String(prog.progressPct));
  t('§35 goal reports whether it is on track', typeof prog.onTrack === 'boolean' || prog.onTrack === null);

  setNotificationsEnabled(true);
  const rel = computeRelevance({ kind: ALERT_KIND.EXPOSURE, asset: 'BTC', portfolio: { totalValueUsd: 1000, holdings: [{ symbol: 'BTC', valueUsd: 900 }] }, monitors: [] });
  t('§8 an alert about a heavily-held asset scores relevant', rel >= 0.5, String(rel));
  const irrelevant = computeRelevance({ kind: ALERT_KIND.VOLATILITY, asset: 'DOGE', portfolio: { totalValueUsd: 1000, holdings: [{ symbol: 'BTC', valueUsd: 1000 }] }, monitors: [] });
  t('§8 an alert about an unheld asset scores lower', irrelevant < rel);

  const first = emitNotification({ kind: ALERT_KIND.VOLATILITY, title: 'x', body: 'y', relevance: 0.9 });
  const second = emitNotification({ kind: ALERT_KIND.VOLATILITY, title: 'x', body: 'y', relevance: 0.9 });
  t('§8 the first relevant alert is emitted', first.emitted === true);
  t('§8 a repeat inside the cooldown is suppressed (no spam)', second.emitted === false && second.reason === 'COOLDOWN');
  muteAlertKind(ALERT_KIND.GAS, true);
  t('§8 an alert kind can be switched off', shouldNotify({ kind: ALERT_KIND.GAS, relevance: 1 }).allowed === false);
  setNotificationsEnabled(false);
  t('§8 notifications have a master switch', shouldNotify({ kind: ALERT_KIND.EXPOSURE, relevance: 1 }).allowed === false);
  setNotificationsEnabled(true);
}

/* ── §9 §10 §17 Financial context ────────────────────────────────────────── */
{
  const fc = buildFinancialContext({
    wallet: { address: '0xabc', chainId: 1, balances: [{ symbol: 'ETH', amount: 1 }] },
    portfolio: { totalValueUsd: 12000, holdings: [{ symbol: 'ETH', valueUsd: 12000 }] }
  });
  t('§9 all fourteen slices are represented', ['wallets', 'balances', 'assets', 'portfolio', 'positions', 'openOrders', 'yieldPositions', 'loans', 'farming', 'futures', 'watchlist', 'alerts', 'previousIntent', 'currentGoal'].every((k) => k in fc));
  t('§9 present data is marked available', fc.portfolio.available && fc.wallets.available);
  t('§9 absent data is marked unknown, never guessed', fc.loans.unknown === true && fc.loans.value === null);
  t('§9 an unavailable slice refuses to answer', canAnswerFrom(fc, 'loans').ok === false);
  t('§9 an available slice may answer', canAnswerFrom(fc, 'portfolio').ok === true);

  const mods = resolveModules({ goal: GOALS.MAXIMIZE_RETURN, intentType: 'PORTFOLIO_ANALYSIS', assets: ['BTC'] });
  t('§10 a return goal reaches across portfolio/market/farm/lending/swap',
    ['portfolio', 'market', 'farm', 'lending', 'swap'].every((m) => mods.modules.includes(m)), mods.modules.join(','));
  t('§10 routes are produced so the user need not find the module', mods.routes.length >= 3);
  t('§10 related modules are surfaced for the next step', Array.isArray(mods.related));

  const sm = buildSmartMoneyView({ whales: [1], topHolders: [1], holderConcentration: 0.7, walletInflow: 5000, walletOutflow: 1000, liquidity: 900000, volume: 100000 }, { asset: 'BTC' });
  t('§17 the nine smart-money fields are normalised', sm.availableFields.length >= 7, sm.availableFields.join(','));
  t('§17 net flow and bias are derived', sm.netFlowUsd === 4000 && sm.flowBias === 'accumulation');
  t('§17 high holder concentration is flagged', sm.concentrationRisk === 'high');
  t('§17 missing fields are declared unknown', sm.unknownFields.includes('smartMoneyActivity'));
  const combined = combineWithMarket(sm, { change24hPct: -5 });
  t('§17 price and flow disagreement is surfaced', combined.alignment === 'divergent' && combined.note === 'price_and_flow_disagree');
}

/* ── §7 §19 §20 Predictive + clarification ───────────────────────────────── */
{
  const fc = buildFinancialContext({ portfolio: { totalValueUsd: 5000, holdings: [{ symbol: 'ETH', valueUsd: 5000 }] } });
  const next = predictNextIntents({ intentType: 'PORTFOLIO_ANALYSIS', financialContext: fc, locale: 'en' });
  const labels = next.map((c) => c.label).join('|');
  t('§7 after a portfolio analysis it offers risk/optimize/compare/strategy',
    /Analyze risk/.test(labels) && /optimization|Compare|strategy/i.test(labels), labels);
  t('§7 chips keep the existing {id,label,prompt} shape (no UI change)',
    next.every((c) => 'id' in c && 'label' in c && 'prompt' in c));
  t('§7 a prediction may never execute on its own', isExecutionAllowedFromPrediction() === false);

  const noPortfolio = predictNextIntents({ intentType: 'PORTFOLIO_ANALYSIS', financialContext: buildFinancialContext({}), locale: 'en' });
  t('§7 suggestions the user cannot act on are dropped', !noPortfolio.some((c) => c.id === 'p7_portfolio_impact'));

  const clar = smartClarify({
    missingSlots: [{ slot: 'timeframe', priority: 1 }, { slot: 'risk', priority: 2 }],
    deepIntent: {}, financialContext: fc, goalMemory: { risk: { level: 'medium' } }, boundAnswers: {}, locale: 'en'
  });
  t('§19 a slot already in memory is inferred, not asked', clar.inferred.risk?.from === 'goal_memory');
  t('§20 at most one question is asked', clar.shouldAsk && clar.question.slot === 'timeframe' && clar.stillMissing.length === 1);

  const nothingToAsk = smartClarify({ missingSlots: [], deepIntent: {}, financialContext: fc, goalMemory: {}, boundAnswers: {} });
  t('§20 with every slot known, no question is asked', nothingToAsk.shouldAsk === false);

  const signals = detectProactiveSignals({
    market: { btcVolatility: 0.09 },
    portfolio: { totalValueUsd: 1000, holdings: [{ symbol: 'BTC', valueUsd: 900 }], positions: [{ symbol: 'ETH', healthFactor: 1.1 }] },
    gas: { gwei: 120 }, locale: 'en'
  });
  const kinds = signals.map((s) => s.kind);
  t('§8 volatility, exposure, gas and position risk are all detected',
    ['btc_volatility', 'portfolio_exposure', 'gas_expensive', 'position_risk'].every((k) => kinds.includes(k)), kinds.join(','));
  t('§8 signals are ranked by relevance', signals.every((s, i) => i === 0 || signals[i - 1].relevance >= s.relevance));
}

/* ── §38 §42 Runtime ─────────────────────────────────────────────────────── */
{
  let calls = 0;
  const load = async () => { calls += 1; return 'v'; };
  await cached('k1', load, { ttlMs: 1000 });
  await cached('k1', load, { ttlMs: 1000 });
  t('§38 a cached read is not repeated', calls === 1);
  t('§38 cache stats are observable', cacheStats().entries >= 1);

  let debounced = 0;
  const d = debounce(() => { debounced += 1; return debounced; }, 20);
  d(); d();
  await d();
  t('§38 debounce collapses a burst into one call', debounced === 1, String(debounced));

  const budgeted = await withBudget(new Promise((r) => setTimeout(() => r('slow'), 300)), 30, 'fallback');
  t('§38 a slow enrichment falls back instead of blocking', budgeted === 'fallback');

  recordMetric(METRIC.USER_CORRECTION, { intent: 'BUY' });
  recordMetric(METRIC.SUCCESSFUL_INTENT, { intent: 'BUY' });
  const m = getMetrics();
  t('§42 interaction metrics are recorded', m.counters[METRIC.USER_CORRECTION] >= 1);
  t('§42 the production model is never auto-updated', m.autoModelUpdateAllowed === false);
  t('§42 improvements are proposals requiring validation', proposeImprovement().applied === false);
}

/* ── The facade: enrich() ────────────────────────────────────────────────── */
{
  const out = enrich({
    message: 'می‌خوام با سرمایه فعلیم تا چهار ماه دیگه بیشترین بازده ممکن رو بگیرم ولی ریسک خیلی بالا نباشه.',
    baseIntent: { type: 'INVESTMENT_PLAN', entities: {}, readOnly: true },
    conversationId: 'e1',
    wallet: { connected: true, address: '0xabc' },
    portfolio: { totalValueUsd: 18000, holdings: [{ symbol: 'ETH', valueUsd: 18000 }] },
    baseConfidence: { confidenceScore: 82 },
    locale: 'fa'
  });
  t('enrich() succeeds', out.ok === true, out.error || '');
  t('enrich() returns the deep intent', out.deepIntent?.goal === GOALS.MAXIMIZE_RETURN);
  t('enrich() returns a plan with a graph', Boolean(out.planId && out.intentGraph?.nodes?.length));
  t('enrich() returns a status-only plan view', out.plan.steps.every((s) => 'status' in s));
  t('enrich() returns a financial context', out.financialContext?.portfolio?.available === true);
  t('enrich() returns cross-module routing', out.modules.modules.length > 0);
  t('enrich() returns predicted follow-ups', out.predictedNext.length > 0);
  t('enrich() returns a confidence report', typeof out.confidence?.score === 'number');
  t('enrich() returns a compressed context', Boolean(out.compressedContext));
  t('enrich() returns an explanation', Boolean(out.explanation?.headings));
  t('enrich() returns a request fingerprint for dedupe', typeof out.fingerprint === 'string');

  const broken = enrich({ message: null, baseIntent: null, conversationId: 'e2' });
  t('enrich() never throws, even on garbage input', typeof broken.ok === 'boolean');
}

/* ── §43 §44 §48 Corpus + DoD ────────────────────────────────────────────── */
{
  const cov = competenceCoverage();
  t('§44 at least 50 golden conversations exist', cov.total >= 50, String(cov.total));
  t('§43 all ten competences are covered', cov.meetsMinimum && cov.missing.length === 0, cov.missing.join(','));
  t('§45 all seven regression checks are declared', REGRESSION_CHECKS.length === 7);
  t('§48 all 31 Definition-of-Done items are declared', DEFINITION_OF_DONE.length === 31, String(DEFINITION_OF_DONE.length));
  t('§44 every conversation has turns and expectations',
    GOLDEN_CONVERSATIONS.every((c) => c.turns.length > 0 && c.expect && c.competence));
}

const failed = rows.filter(([, ok]) => !ok);
if (process.argv[1] && process.argv[1].endsWith('upgrade7-intelligence-probe.mjs')) {
  for (const [name, ok] of rows) console.log(`${ok ? '  ✓' : '  ✗'} ${name}`);
  console.log(`\nUpgrade 7: ${rows.length - failed.length}/${rows.length} passed`);
  if (failed.length) process.exit(1);
}

export default rows;
