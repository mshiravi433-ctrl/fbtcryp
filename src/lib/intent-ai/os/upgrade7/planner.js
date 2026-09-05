/**
 * FBT INTENT OS — UPGRADE 7 · Intent Planner (dynamic, resumable)
 * ---------------------------------------------------------------------------
 * Spec §4 (internal plan, status-only display), §5 (dynamic re-planning without
 * restarting), §6 (resume across pages), §30 (goal-based financial brain),
 * §33 (priority), §34 (conflict), §36 (outcomes not commands).
 *
 * The existing `os/orchestrator.plan()` maps ONE intent type to tools and agents
 * for ONE turn. It stays exactly as it is. This planner sits above it and owns
 * the multi-turn, multi-page shape of a goal.
 */

import {
  createIntentGraph, NODE_STATUS, setNodeStatus, readyNodes, graphProgress,
  blockNodeForInput, resumeGraph, serializeGraph
} from './intentGraph.js';
import { GOALS, missingCriticalSlots } from './deepIntent.js';

export const PLANNER_SCHEMA = 'fbt.intent-planner.v7';
const STORE_KEY = 'fbt.upgrade7.plans.v1';
const MAX_PLANS = 12;

export const PRIORITY = Object.freeze({
  CRITICAL: 'critical', HIGH: 'high', NORMAL: 'normal', LOW: 'low', BACKGROUND: 'background'
});
const PRIORITY_RANK = { critical: 0, high: 1, normal: 2, low: 3, background: 4 };

/* -------------------------------------------------------------------------- */
/*  PLAN TEMPLATES — outcome first, tools last (§30, §36)                       */
/* -------------------------------------------------------------------------- */

const N = (id, label, labelFa, extra = {}) => ({ id, label, labelFa, ...extra });

const TEMPLATES = {
  FINANCIAL_GOAL: [
    N('portfolio', 'Analyzing portfolio', 'بررسی پرتفوی', { agent: 'portfolio-agent', kind: 'read' }),
    N('wallet', 'Reading wallet', 'خواندن کیف پول', { agent: 'wallet-agent', kind: 'read' }),
    N('market', 'Checking market', 'بررسی بازار', { agent: 'market-agent', kind: 'read' }),
    N('risk', 'Evaluating risk', 'ارزیابی ریسک', { agent: 'risk-agent', kind: 'analysis', dependsOn: ['portfolio', 'market'] }),
    N('scenarios', 'Preparing scenarios', 'آماده‌سازی سناریوها', { agent: 'strategy-agent', kind: 'analysis', dependsOn: ['risk'] }),
    N('compare', 'Comparing strategies', 'مقایسه استراتژی‌ها', { agent: 'strategy-agent', kind: 'analysis', dependsOn: ['scenarios'] }),
    N('recommend', 'Preparing recommendation', 'تهیه پیشنهاد', { kind: 'synthesis', dependsOn: ['compare'] }),
    N('permission', 'Awaiting your approval', 'در انتظار تایید شما', { kind: 'permission', dependsOn: ['recommend'], optional: true })
  ],
  PORTFOLIO_REVIEW: [
    N('portfolio', 'Analyzing portfolio', 'بررسی پرتفوی', { agent: 'portfolio-agent', kind: 'read' }),
    N('risk', 'Evaluating risk', 'ارزیابی ریسک', { agent: 'risk-agent', kind: 'analysis', dependsOn: ['portfolio'] }),
    N('market', 'Checking market', 'بررسی بازار', { agent: 'market-agent', kind: 'read' }),
    N('recommend', 'Preparing recommendation', 'تهیه پیشنهاد', { kind: 'synthesis', dependsOn: ['risk', 'market'] })
  ],
  ASSET_RESEARCH: [
    N('price', 'Reading price', 'خواندن قیمت', { agent: 'market-agent', kind: 'read' }),
    N('trend', 'Checking trend', 'بررسی روند', { agent: 'market-agent', kind: 'analysis', dependsOn: ['price'] }),
    N('smartmoney', 'Checking smart money', 'بررسی پول هوشمند', { agent: 'market-agent', kind: 'read', optional: true }),
    N('news', 'Reading news', 'خواندن اخبار', { agent: 'research-agent', kind: 'read', optional: true }),
    N('risk', 'Evaluating risk', 'ارزیابی ریسک', { agent: 'risk-agent', kind: 'analysis', dependsOn: ['trend'] }),
    N('recommend', 'Preparing answer', 'تهیه پاسخ', { kind: 'synthesis', dependsOn: ['risk'] })
  ],
  EXECUTION: [
    N('intent', 'Confirming what you asked', 'تایید درخواست', { kind: 'read' }),
    N('policy', 'Checking policy', 'بررسی سیاست‌ها', { agent: 'guardian-agent', kind: 'policy', dependsOn: ['intent'] }),
    N('risk', 'Evaluating risk', 'ارزیابی ریسک', { agent: 'risk-agent', kind: 'analysis', dependsOn: ['policy'] }),
    N('freshdata', 'Refreshing market data', 'به‌روزرسانی داده بازار', { agent: 'market-agent', kind: 'read', dependsOn: ['risk'] }),
    N('simulate', 'Simulating', 'شبیه‌سازی', { kind: 'simulation', dependsOn: ['freshdata'] }),
    N('permission', 'Awaiting your confirmation', 'در انتظار تایید شما', { kind: 'permission', dependsOn: ['simulate'] }),
    N('execute', 'Executing', 'اجرا', { agent: 'execution-agent', kind: 'execution', dependsOn: ['permission'] }),
    N('verify', 'Verifying result', 'راستی‌آزمایی نتیجه', { agent: 'verification-agent', kind: 'verify', dependsOn: ['execute'] })
  ],
  YIELD_SEARCH: [
    N('wallet', 'Reading wallet', 'خواندن کیف پول', { agent: 'wallet-agent', kind: 'read' }),
    N('yield', 'Finding opportunities', 'یافتن فرصت‌ها', { agent: 'yield-agent', kind: 'read' }),
    N('risk', 'Evaluating risk', 'ارزیابی ریسک', { agent: 'risk-agent', kind: 'analysis', dependsOn: ['yield'] }),
    N('recommend', 'Preparing recommendation', 'تهیه پیشنهاد', { kind: 'synthesis', dependsOn: ['risk'] })
  ],
  NEWS_EXPLAIN: [
    N('price', 'Reading price action', 'خواندن حرکت قیمت', { agent: 'market-agent', kind: 'read' }),
    N('news', 'Reading news', 'خواندن اخبار', { agent: 'research-agent', kind: 'read' }),
    N('onchain', 'Checking on-chain flows', 'بررسی جریان آنچین', { agent: 'market-agent', kind: 'read', optional: true }),
    N('synthesis', 'Separating facts from interpretation', 'تفکیک واقعیت از تفسیر', { kind: 'synthesis', dependsOn: ['price', 'news'] })
  ],
  SIMPLE: [
    N('answer', 'Preparing answer', 'تهیه پاسخ', { kind: 'synthesis' })
  ]
};

export function pickTemplate({ deepIntent = {}, baseIntent = {} } = {}) {
  const type = String(baseIntent.type || baseIntent.primaryIntent || '').toUpperCase();
  const goal = deepIntent.goal;
  const action = deepIntent.action;

  if (['SWAP', 'BUY', 'SELL', 'SEND', 'BRIDGE', 'DCA'].includes(type) && baseIntent.executionRequested) return 'EXECUTION';
  if (goal === GOALS.MAXIMIZE_RETURN || goal === GOALS.ACCUMULATE || deepIntent.targetReturn) return 'FINANCIAL_GOAL';
  if (goal === GOALS.GENERATE_INCOME || ['YIELD_DISCOVERY', 'FARM', 'LEND', 'STAKING'].includes(type)) return 'YIELD_SEARCH';
  if (['PORTFOLIO_ANALYSIS', 'REBALANCE', 'RISK_ANALYSIS'].includes(type) || goal === GOALS.REBALANCE || goal === GOALS.REDUCE_RISK) return 'PORTFOLIO_REVIEW';
  /*
   * "build me a strategy for 6 months" is a planning request, not a chat reply.
   * An explicit PLAN action with a horizon or a goal behind it deserves the full
   * goal template — portfolio, market, risk, scenarios, comparison — rather
   * than a single synthesis node.
   */
  if (action === 'plan' && (deepIntent.timeframe || goal || deepIntent.assets?.length)) return 'FINANCIAL_GOAL';
  if (deepIntent.hiddenIntents?.some((h) => h.id === 'price_move_cause')) return 'NEWS_EXPLAIN';
  if (['ANALYZE_TOKEN', 'MARKET_ANALYSIS', 'MARKET_CONTEXT', 'SMART_MONEY', 'WHALE'].includes(type)) return 'ASSET_RESEARCH';
  if (action === 'compare') return 'ASSET_RESEARCH';
  return 'SIMPLE';
}

/* -------------------------------------------------------------------------- */
/*  PLAN OBJECT                                                                 */
/* -------------------------------------------------------------------------- */

function planId() {
  return `plan7_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
}

export function derivePriority({ baseIntent = {}, deepIntent = {}, context = {} } = {}) {
  const type = String(baseIntent.type || '').toUpperCase();
  if (context.failedTransaction || context.txFailure) return PRIORITY.CRITICAL;
  if (['SWAP', 'BUY', 'SELL', 'SEND', 'BRIDGE'].includes(type) && baseIntent.executionRequested) return PRIORITY.HIGH;
  if (deepIntent.urgency === 'high') return PRIORITY.HIGH;
  if (deepIntent.goal === GOALS.MONITOR) return PRIORITY.LOW;
  if (baseIntent.readOnly) return PRIORITY.NORMAL;
  return PRIORITY.NORMAL;
}

/**
 * Build (or extend) the plan for this turn.
 * Returns a plain object — safe to serialise, safe to ignore.
 */
export function createPlan({ message = '', baseIntent = {}, deepIntent = {}, context = {}, intentId = null, conversationId = 'default' } = {}) {
  const templateName = pickTemplate({ deepIntent, baseIntent });
  const nodes = (TEMPLATES[templateName] || TEMPLATES.SIMPLE).map((n) => ({ ...n }));
  const graph = createIntentGraph({ intentId: intentId || planId(), goal: deepIntent.goal || null, nodes });

  const requiresExecution = templateName === 'EXECUTION';
  const missing = missingCriticalSlots(deepIntent, { requireForExecution: requiresExecution });

  return {
    schema: PLANNER_SCHEMA,
    planId: planId(),
    conversationId,
    intentId: graph.intentId,
    template: templateName,
    goal: deepIntent.goal || null,
    objective: deepIntent.objective || null,
    timeframe: deepIntent.timeframe || null,
    risk: deepIntent.risk || null,
    assets: deepIntent.assets || [],
    priority: derivePriority({ baseIntent, deepIntent, context }),
    graph,
    missingSlots: missing,
    requiresPermission: requiresExecution,
    status: missing.length ? 'awaiting_input' : 'ready',
    message: String(message || '').slice(0, 400),
    createdAt: Date.now(),
    updatedAt: Date.now()
  };
}

/** §4 — the ONLY thing the user may see about the plan. Never the reasoning. */
export function planStatusView(plan, locale = 'fa') {
  const fa = String(locale || 'fa').startsWith('fa');
  const progress = graphProgress(plan?.graph);
  return {
    planId: plan?.planId || null,
    priority: plan?.priority || PRIORITY.NORMAL,
    percent: progress.percent,
    isComplete: progress.isComplete,
    isBlocked: progress.isBlocked,
    current: progress.currentNode ? (fa ? (progress.currentNode.labelFa || progress.currentNode.label) : progress.currentNode.label) : null,
    steps: (plan?.graph?.nodes || []).map((n) => ({
      id: n.id,
      label: fa ? (n.labelFa || n.label) : n.label,
      status: n.status
    }))
  };
}

/* -------------------------------------------------------------------------- */
/*  §5 DYNAMIC PLANNING — pause for input, resume in place                      */
/* -------------------------------------------------------------------------- */

export function pausePlanForInput(plan, { slot, question = null, questionId = null, nodeId = null } = {}) {
  if (!plan?.graph) return plan;
  const target = nodeId || graphProgress(plan.graph).currentNode?.id || plan.graph.nodes[0]?.id;
  if (target) blockNodeForInput(plan.graph, target, { slot, question, questionId });
  plan.status = 'awaiting_input';
  plan.awaiting = { slot, question, questionId, nodeId: target, since: Date.now() };
  plan.updatedAt = Date.now();
  savePlan(plan);
  return plan;
}

/**
 * §5 + §21 — the answer binds to the question that asked for it, and the SAME
 * plan continues. It is never rebuilt from step 1.
 */
export function resumePlanWithAnswer(plan, { slot = null, value = undefined, questionId = null } = {}) {
  if (!plan) return plan;
  const boundSlot = slot || (questionId && plan.awaiting?.questionId === questionId ? plan.awaiting.slot : plan.awaiting?.slot) || null;
  if (plan.graph) resumeGraph(plan.graph, { slot: boundSlot, value });
  plan.answers = { ...(plan.answers || {}), ...(boundSlot ? { [boundSlot]: value } : {}) };
  plan.missingSlots = (plan.missingSlots || []).filter((m) => m.slot !== boundSlot);
  plan.awaiting = null;
  plan.status = plan.missingSlots.length ? 'awaiting_input' : 'ready';
  plan.resumedAt = Date.now();
  plan.updatedAt = Date.now();
  savePlan(plan);
  return plan;
}

export function advancePlan(plan, nodeId, { status = NODE_STATUS.COMPLETED, result = null, error = null } = {}) {
  if (!plan?.graph) return plan;
  setNodeStatus(plan.graph, nodeId, status, { result, error });
  const progress = graphProgress(plan.graph);
  if (progress.isComplete) plan.status = 'completed';
  else if (progress.isBlocked) plan.status = 'blocked';
  else plan.status = 'running';
  plan.updatedAt = Date.now();
  savePlan(plan);
  return plan;
}

export function nextSteps(plan) {
  return readyNodes(plan?.graph);
}

/* -------------------------------------------------------------------------- */
/*  §6 RESUME CAPABILITY — persistence across pages                             */
/* -------------------------------------------------------------------------- */

function readStore() {
  try {
    if (typeof localStorage === 'undefined') return memStore;
    const raw = localStorage.getItem(STORE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return memStore; }
}

let memStore = [];

function writeStore(list) {
  const trimmed = list.slice(-MAX_PLANS);
  memStore = trimmed;
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(STORE_KEY, JSON.stringify(trimmed));
  } catch { /* quota / private mode — memory copy still works */ }
}

export function savePlan(plan) {
  if (!plan?.planId) return plan;
  const list = readStore();
  const idx = list.findIndex((p) => p.planId === plan.planId);
  const snapshot = { ...plan, graph: serializeGraph(plan.graph) };
  if (idx >= 0) list[idx] = snapshot; else list.push(snapshot);
  writeStore(list);
  return plan;
}

export function getPlan(planId) {
  return readStore().find((p) => p.planId === planId) || null;
}

export function listPlans({ conversationId = null, activeOnly = false } = {}) {
  let list = readStore();
  if (conversationId) list = list.filter((p) => p.conversationId === conversationId);
  if (activeOnly) list = list.filter((p) => !['completed', 'cancelled', 'failed'].includes(p.status));
  return [...list].sort((a, b) => (PRIORITY_RANK[a.priority] ?? 2) - (PRIORITY_RANK[b.priority] ?? 2) || b.updatedAt - a.updatedAt);
}

/** The plan a returning user should land back inside (§6). */
export function getResumablePlan({ conversationId = null } = {}) {
  const active = listPlans({ conversationId, activeOnly: true });
  return active.find((p) => p.status === 'awaiting_input' || p.status === 'blocked') || active[0] || null;
}

export function cancelPlan(planId) {
  const list = readStore();
  const p = list.find((x) => x.planId === planId);
  if (p) { p.status = 'cancelled'; p.updatedAt = Date.now(); writeStore(list); }
  return p || null;
}

export function clearPlans() { writeStore([]); }

/* -------------------------------------------------------------------------- */
/*  §34 CONFLICT RESOLUTION                                                     */
/* -------------------------------------------------------------------------- */

const CONFLICTING_GOALS = [
  [GOALS.MAXIMIZE_RETURN, GOALS.PRESERVE_CAPITAL],
  [GOALS.MAXIMIZE_RETURN, GOALS.REDUCE_RISK],
  [GOALS.ACCUMULATE, GOALS.EXIT],
  [GOALS.GENERATE_INCOME, GOALS.EXIT]
];

export function detectPlanConflicts(plans = []) {
  const active = plans.filter((p) => p && !['completed', 'cancelled', 'failed'].includes(p.status));
  const conflicts = [];
  for (let i = 0; i < active.length; i++) {
    for (let j = i + 1; j < active.length; j++) {
      const a = active[i]; const b = active[j];
      if (!a.goal || !b.goal) continue;
      const clash = CONFLICTING_GOALS.some(([x, y]) => (a.goal === x && b.goal === y) || (a.goal === y && b.goal === x));
      if (clash) {
        conflicts.push({
          a: a.planId, b: b.planId, goalA: a.goal, goalB: b.goal,
          severity: (a.priority === PRIORITY.CRITICAL || b.priority === PRIORITY.CRITICAL) ? 'high' : 'medium',
          needsClarification: true,
          questionFa: `دو هدف همزمان دارید: «${a.goal}» و «${b.goal}». برای این درخواست کدام مقدم است؟`,
          questionEn: `You have two active goals: "${a.goal}" and "${b.goal}". Which one takes priority here?`
        });
      }
    }
  }
  return conflicts;
}
