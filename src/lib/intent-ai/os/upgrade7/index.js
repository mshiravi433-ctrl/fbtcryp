/**
 * FBT INTENT OS — UPGRADE 7 · Barrel + Runtime Facade
 * ---------------------------------------------------------------------------
 * Spec §47 architecture, §48 definition of done.
 *
 *   Conversation Engine ─┐
 *   Intent Understanding ├─ deepIntent.js
 *   Intent Memory ───────┤   semanticMemory.js
 *   Intent Planner ──────┤   planner.js
 *   Intent Graph ────────┤   intentGraph.js
 *   Reference Resolver ──┤   (upgrade6 — reused, not replaced)
 *   Slot Engine ─────────┤   (upgrade6 — reused, not replaced)
 *   Agent Orchestrator ──┤   agentMesh.js
 *   Shared Context ──────┤   financialContext.js
 *   Tool Registry ───────┤   (os/toolRegistry.js — reused)
 *   Risk Engine ─────────┤   (intent-ai/riskEngine.js — reused)
 *   Permission Engine ───┤   safety.js
 *   Execution Engine ────┤   (os/agents/executionAgent.js — reused)
 *   Verification Engine ─┤   (os/agents/executionAgent.js — reused)
 *   Monitoring Engine ───┤   monitoring.js
 *   Learning/Evaluation ─┘   runtime.js + goldenConversations.js
 *
 * ─── THE ONE RULE THIS FILE ENFORCES ────────────────────────────────────────
 * `enrich()` is additive and total: it returns a plain object that the caller
 * attaches to an EXISTING response. It never mutates its inputs, never throws,
 * and never decides anything on its own. If every line of Upgrade 7 were
 * deleted, the app would behave exactly as it did before.
 */

export * from './deepIntent.js';
export * from './intentGraph.js';
export * from './planner.js';
export * from './agentMesh.js';
export * from './confidence.js';
export * from './semanticMemory.js';
export * from './safety.js';
export * from './monitoring.js';
export * from './financialContext.js';
export * from './predictive.js';
export * from './runtime.js';

import { buildDeepIntent, missingCriticalSlots } from './deepIntent.js';
import {
  createPlan, planStatusView, getResumablePlan, resumePlanWithAnswer, pausePlanForInput,
  listPlans, detectPlanConflicts, savePlan
} from './planner.js';
import { synthesize, crossCheck, getMeshHealth, requestFingerprint } from './agentMesh.js';
import {
  classifyDataNeed, evaluateFreshness, scoreSourceQuality, verifyClaims,
  buildConfidenceReport, buildExplanation
} from './confidence.js';
import {
  setGoalMemory, getGoalMemory, detectContradiction, applyCorrection,
  extractSemantics, compressContext, getBoundAnswer, recall, FACT_KIND
} from './semanticMemory.js';
import { buildFinancialContext, resolveModules, buildSmartMoneyView, combineWithMarket } from './financialContext.js';
import { predictNextIntents, smartClarify, detectProactiveSignals } from './predictive.js';
import { recordMetric, METRIC, runInBackground } from './runtime.js';
import { listMonitors, parseRecurrence, createRecurringIntent, createMonitor } from './monitoring.js';

export const UPGRADE7_SCHEMA = 'fbt.intent-os.upgrade7';
export const UPGRADE7_VERSION = '7.0.0';

/**
 * The single call the host makes. Everything is optional; anything missing is
 * simply reported as unavailable rather than guessed.
 *
 * @returns {object} an `upgrade7` block to attach to the existing OS response.
 */
export function enrich({
  message = '',
  baseIntent = {},
  context = {},
  execution = null,
  conversationId = 'default',
  conversation = [],
  wallet = null,
  portfolio = null,
  market = null,
  smartMoney = null,
  agentResults = null,
  baseConfidence = null,
  dataSnapshots = null,
  claims = null,
  locale = 'fa'
} = {}) {
  try {
    /* 1 ── PERSONAL FINANCIAL CONTEXT (§9) */
    const financialContext = buildFinancialContext({
      wallet,
      portfolio,
      orders: context.orders,
      positions: context.positions || portfolio?.positions,
      yieldPositions: context.yieldPositions,
      loans: context.loans,
      farming: context.farming,
      futures: context.futures,
      watchlist: context.watchlist,
      alerts: context.alerts,
      previousIntent: context.previousIntent || null,
      currentGoal: getGoalMemory(conversationId)
    });

    /* 2 ── DEEP INTENT (§1 §2 §11 §18) */
    const goalMemory = getGoalMemory(conversationId);
    const deep = buildDeepIntent(message, baseIntent, {
      ...context, wallet, portfolio, goalMemory,
      currentPage: context.currentPage || context.currentRoute || null
    });

    /* 3 ── CONTRADICTION (§24) — a new value is an update, unless it costs money */
    const contradictions = [];
    for (const slot of ['risk', 'goal', 'timeframe', 'capitalSource']) {
      const value = slot === 'risk' ? (deep.risk?.explicit ? deep.risk : null) : deep[slot];
      if (value == null) continue;
      const c = detectContradiction({ conversationId, slot, newValue: value, locale });
      if (c.contradiction) contradictions.push(c);
    }

    /* 4 ── CORRECTION (§25) — patch the intent, never reset the conversation */
    const correction = applyCorrection({
      message, conversationId, currentIntent: baseIntent, currentDeepIntent: deep, locale
    });
    if (correction.isCorrection) recordMetric(METRIC.USER_CORRECTION, { intent: baseIntent.type });

    /* 5 ── GOAL MEMORY (§18) */
    setGoalMemory(conversationId, {
      goal: deep.goal,
      objective: deep.objective,
      timeframe: deep.timeframe,
      risk: deep.risk?.explicit ? deep.risk : null,
      targetReturn: deep.targetReturn,
      capitalSource: deep.context?.capitalSource
    });

    /* 6 ── PLAN + GRAPH (§3 §4 §5 §6 §30 §33) */
    const resumable = getResumablePlan({ conversationId });
    const slotAnswer = bareSlotAnswer(deep);
    let plan;
    if (resumable && resumable.status === 'awaiting_input' && resumable.awaiting?.slot) {
      // §6 — the user came back with an answer: continue the SAME plan.
      const slot = resumable.awaiting.slot;
      const answered = deep[slot] ?? deep.risk?.[slot] ?? slotAnswer?.value ?? null;
      plan = answered != null
        ? resumePlanWithAnswer(resumable, { slot, value: answered, questionId: resumable.awaiting.questionId })
        : resumable;
    } else if (resumable && slotAnswer) {
      /*
       * §5/§6 — «۴ ماه» on its own is not a new request. It is the missing
       * piece of the plan already in flight. Building a second plan here is
       * exactly the "start new conversation" failure the spec forbids: the
       * user answers a question and watches the work restart from step 1.
       */
      plan = resumePlanWithAnswer(resumable, { slot: slotAnswer.slot, value: slotAnswer.value });
    } else {
      plan = createPlan({ message, baseIntent, deepIntent: deep, context, conversationId });
      savePlan(plan);
    }

    /* 7 ── CLARIFICATION (§19 §20) — ask only what cannot be inferred */
    const boundAnswers = {};
    for (const slot of ['timeframe', 'risk', 'amount', 'asset', 'goal']) {
      const bound = getBoundAnswer(slot, conversationId);
      if (bound?.value?.value != null) boundAnswers[slot] = bound.value.value;
    }
    const clarification = smartClarify({
      missingSlots: plan.missingSlots || missingCriticalSlots(deep),
      deepIntent: deep, financialContext, goalMemory, boundAnswers, locale
    });
    if (clarification.shouldAsk && plan.status !== 'awaiting_input') {
      pausePlanForInput(plan, { slot: clarification.question.slot, question: clarification.question.text });
    }

    /* 8 ── AGENT CROSS-CHECK + SYNTHESIS (§12 §13) */
    const results = agentResults || execution?.agentResults || {};
    const synthesis = Object.keys(results).length
      ? synthesize({ results, failures: [], intent: baseIntent, deepIntent: deep, locale })
      : null;

    /* 9 ── FRESHNESS + SOURCE QUALITY + CLAIMS (§14 §15 §26) */
    const dataNeed = classifyDataNeed({ intentType: baseIntent.type, deepIntent: deep, message });
    const freshness = dataSnapshots ? evaluateFreshness(dataNeed, dataSnapshots) : null;
    const sourceQuality = scoreSourceQuality(execution?.toolsUsed || context.sources || []);
    const claimCheck = claims ? verifyClaims(claims, { locale }) : null;
    const confidence = buildConfidenceReport({ baseConfidence, synthesis, freshness, sourceQuality, claims: claimCheck, locale });

    /* 10 ── SMART MONEY (§17) */
    const smartMoneyView = smartMoney ? buildSmartMoneyView(smartMoney, { asset: deep.assets?.[0] || null }) : null;
    const smartMoneyMarket = smartMoneyView ? combineWithMarket(smartMoneyView, market || execution?.market || {}) : null;

    /* 11 ── CROSS-MODULE ROUTING (§10) */
    const modules = resolveModules({ goal: deep.goal, intentType: baseIntent.type, assets: deep.assets });

    /* 12 ── PREDICTIVE FOLLOW-UPS (§7) */
    const predicted = predictNextIntents({
      intentType: baseIntent.type, deepIntent: deep, execution, financialContext, locale
    });

    /* 13 ── RECURRING (§32) */
    const recurrence = parseRecurrence(message);

    /* 14 ── CONFLICTS (§34) */
    const conflicts = detectPlanConflicts(listPlans({ conversationId, activeOnly: true }));

    /* 15 ── EXPLAINABILITY (§29) */
    const explanation = buildExplanation({
      recommendation: deep.why,
      dataUsed: [...(execution?.toolsUsed || []), ...(financialContext.availableSlices || [])].slice(0, 8),
      risks: [
        deep.risk?.level ? `risk_preference:${deep.risk.level}` : null,
        smartMoneyView?.concentrationRisk ? `holder_concentration:${smartMoneyView.concentrationRisk}` : null,
        confidence.label === 'LOW' ? 'low_confidence' : null
      ],
      whatCanGoWrong: [
        freshness?.overall === 'stale' ? 'market_data_may_be_outdated' : null,
        synthesis?.divergence ? 'independent_analyses_disagree' : null
      ],
      nextAction: plan.requiresPermission ? 'awaiting_user_confirmation' : 'read_only_answer',
      locale
    });

    /* 16 ── SEMANTIC MEMORY + METRICS — off the interaction path (§22 §23 §38) */
    runInBackground(() => {
      extractSemantics({ message, deepIntent: deep, execution, conversationId });
      recordMetric(execution?.ok === false ? METRIC.FAILED_INTENT : METRIC.SUCCESSFUL_INTENT, { intent: baseIntent.type });
    });

    const compressed = compressContext({ messages: conversation, conversationId, activeIntent: baseIntent, activePlan: plan });

    return {
      schema: UPGRADE7_SCHEMA,
      version: UPGRADE7_VERSION,
      ok: true,
      deepIntent: deep,
      hiddenIntents: deep.hiddenIntents,
      financialContext,
      plan: planStatusView(plan, locale),
      planId: plan.planId,
      intentGraph: plan.graph,
      clarification,
      contradictions,
      correction: correction.isCorrection ? correction : null,
      synthesis,
      agentHealth: getMeshHealth(),
      confidence,
      freshness,
      dataNeed,
      smartMoney: smartMoneyView,
      smartMoneyMarket,
      modules,
      predictedNext: predicted,
      recurrence,
      conflicts,
      explanation,
      compressedContext: compressed,
      monitors: listMonitors({ conversationId, status: 'monitoring' }),
      fingerprint: requestFingerprint({ message, intentType: baseIntent.type, conversationId })
    };
  } catch (err) {
    // A failure in the intelligence layer must never take the answer down.
    return { schema: UPGRADE7_SCHEMA, version: UPGRADE7_VERSION, ok: false, error: err?.message || String(err) };
  }
}


/**
 * Is this message nothing but the value of a slot? «۴ ماه», «ریسک متوسط»,
 * «۵۰۰ دلار» carry a value and no verb — they answer, they do not ask.
 * A message that also names an action or a goal is a new request, not an answer.
 */
function bareSlotAnswer(deep) {
  if (!deep) return null;
  const short = String(deep.raw || '').trim().split(/\s+/).length <= 6;
  if (!short) return null;
  // An explicit action ("بخر", "تحلیل کن") means the user started something new.
  if (deep.action && deep.action !== 'analyze') return null;
  if (deep.goal) return null;
  if (deep.timeframe) return { slot: 'timeframe', value: deep.timeframe };
  if (deep.risk?.explicit) return { slot: 'risk', value: deep.risk };
  if (deep.amount?.usd != null) return { slot: 'amount', value: deep.amount };
  if (deep.amount?.percent != null) return { slot: 'amount', value: deep.amount };
  return null;
}

/** Convenience factory for hosts that want to hold a handle. */
export function createUpgrade7({ locale = 'fa' } = {}) {
  return {
    schema: UPGRADE7_SCHEMA,
    version: UPGRADE7_VERSION,
    enrich: (args = {}) => enrich({ locale, ...args }),
    getGoalMemory,
    setGoalMemory,
    getMeshHealth,
    listPlans,
    listMonitors,
    createMonitor,
    createRecurringIntent,
    crossCheck,
    recall: (opts) => recall(opts),
    FACT_KIND
  };
}

/** §48 — machine-readable Definition of Done, used by the probes. */
export const DEFINITION_OF_DONE = Object.freeze([
  'intent_understanding_2', 'hidden_intent_detection', 'intent_graph', 'ai_planner',
  'dynamic_planning', 'resume_capability', 'predictive_intent', 'proactive_intelligence',
  'cross_module_intelligence', 'multi_agent_collaboration', 'agent_cross_check',
  'confidence_layer', 'fresh_data_awareness', 'smart_money_integration', 'goal_memory',
  'semantic_memory', 'contradiction_detection', 'user_correction_learning',
  'no_hallucination_checks', 'simulation_before_execution', 'goal_based_financial_brain',
  'continuous_monitoring', 'recurring_intent', 'intent_priority', 'conflict_resolution',
  'agent_health', 'agent_timeout_fallback', 'request_deduplication',
  'golden_conversation_tests', 'regression_tests', 'security_validation'
]);
