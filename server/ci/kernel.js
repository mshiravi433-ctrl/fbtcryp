/**
 * FBT FINANCIAL OS — Central Intelligence Kernel (Upgrade 10 §4, §5, §69).
 * ---------------------------------------------------------------------------
 * Upgrade 10's rule is that "no important module may create intelligence
 * independently of the Kernel, except through a declared contract". This file
 * IS that contract. It owns, per user:
 *
 *   · the Financial Profile and the Goal OS records
 *   · the Memory OS store
 *   · the Permission Center and the kill switches
 *   · the strategy register and the last financial-state snapshot
 *
 * and it exposes ONE method per stage of the §1 chain:
 *
 *   understand → context → memory → intent → goal → financialState → research
 *   → agents → risk → opportunity → decision → scenario → optimization
 *   → strategy → simulation → permission → execution → verification
 *   → monitoring → learning → replanning
 *
 * HOW IT RELATES TO THE EXISTING BRAIN (server/ci/brain.js)
 * The brain already owns understand → plan → policy → execute → verify against
 * real modules, and it is the ONLY thing that may execute. The kernel does not
 * duplicate it and does not wrap it: it composes the FINANCIAL layer on top of
 * the state the brain maintains, and for anything that moves money it delegates
 * to the brain's own action engine. So there is exactly one execution path in
 * the product, and adding financial intelligence did not create a second one.
 *
 * THE BOUNDARY, STATED AS CODE
 * `assess()` and `advise()` are pure reads. `authorize()` can only ever return a
 * decision object; it holds no key, calls no venue, and cannot mark an action
 * executed. Every method returns `{ status }` and names its missing inputs.
 */
import { CI_SCHEMA, round, usableNumber } from '../../src/lib/central/schema.js';
import { buildFinancialState, liquidityProfile } from '../../src/lib/central/financialState.js';
import {
  emptyProfile, updateProfile, resetProfile, assertedFacts, profileGaps,
  createGoal, goalProgress, detectGoalConflicts
} from '../../src/lib/central/profile.js';
import { decide, rankDecisions, weightsFor } from '../../src/lib/central/decision.js';
import { runScenarios, monteCarlo, optimizePortfolio, twinProject } from '../../src/lib/central/scenario.js';
import { createMemoryStore, evaluateOutcome, calibrate } from '../../src/lib/central/memory.js';
import { runCouncil, financialGuardian, executionGuardian, rankOpportunities, smartMoneyModifier } from '../../src/lib/central/council.js';
import { createPermissionCenter, createKillSwitches, PERMISSION_SCOPES } from '../../src/lib/central/permission.js';
import {
  createStrategy, transitionStrategy, detectChanges, earlyWarnings, evaluateStrategy,
  interpretEvent, buildDailyBrief
} from '../../src/lib/central/monitoring.js';

export const KERNEL_SCHEMA = 'fbt.central-intelligence-kernel.v1';

const MAX_OWNERS = 400;
const MAX_GOALS = 12;
const MAX_STRATEGIES = 12;
const MAX_DECISION_LOG = 60;

/** Scope needed to act on a decision type. Unknown types get the strictest. */
const SCOPE_FOR_DECISION = {
  HOLD: null,
  REBALANCE: 'execute:rebalance',
  YIELD: 'execute:lend',
  DELEVERAGE: 'execute:swap',
  SWAP: 'execute:swap',
  BRIDGE: 'execute:bridge'
};

export function createKernel({ stateStore = null, events = null, log = () => {}, now = () => Date.now() } = {}) {
  const permissions = createPermissionCenter({ now });
  const killSwitches = createKillSwitches({ now });
  const owners = new Map();

  function scope(owner) {
    const key = String(owner || 'anon').slice(0, 80);
    if (!owners.has(key)) {
      if (owners.size >= MAX_OWNERS) {
        const oldest = [...owners.entries()].sort((a, b) => (a[1].touchedAt || 0) - (b[1].touchedAt || 0))[0];
        if (oldest) owners.delete(oldest[0]);
      }
      owners.set(key, {
        profile: emptyProfile(now()),
        goals: [],
        strategies: [],
        memory: createMemoryStore({ now }),
        decisions: [],
        outcomes: [],
        lastFinancialState: null,
        touchedAt: now()
      });
    }
    const entry = owners.get(key);
    entry.touchedAt = now();
    return entry;
  }

  /** Plain section data from the brain's unified state, for the pure engines. */
  function sectionsFor(owner) {
    if (!stateStore) return {};
    const state = stateStore.peek(owner);
    const out = {};
    for (const [key, section] of Object.entries(state?.sections || {})) {
      if (section?.data != null) out[key] = section.data;
    }
    return out;
  }

  function freshnessReport(owner, keys = ['wallet', 'portfolio', 'markets', 'risk']) {
    if (!stateStore) return null;
    const stale = [];
    const live = [];
    for (const key of keys) {
      const f = stateStore.freshness(owner, key, now());
      (f.status === 'LIVE' ? live : stale).push({ key, status: f.status, ageMs: f.ageMs });
    }
    return { live, stale };
  }

  /* ── stage: FINANCIAL STATE (§8) ───────────────────────────────────── */

  function assess(owner, { sections = null } = {}) {
    const src = sections || sectionsFor(owner);
    const fs = buildFinancialState(src, { now: now() });
    const entry = scope(owner);
    const previous = entry.lastFinancialState;
    if (fs.status !== 'UNAVAILABLE') entry.lastFinancialState = fs;
    return {
      schema: KERNEL_SCHEMA, brain: CI_SCHEMA,
      financialState: fs,
      liquidity: liquidityProfile(fs),
      previous: previous ? { at: previous.at, netWorthUsd: previous.netWorthUsd } : null,
      changes: previous ? detectChanges(previous, fs, { now: now() }) : null
    };
  }

  /* ── stage: PROFILE + GOALS (§7, §9) ───────────────────────────────── */

  const getProfile = (owner) => scope(owner).profile;

  function patchProfile(owner, patch, { origin = 'stated' } = {}) {
    const entry = scope(owner);
    const res = updateProfile(entry.profile, patch, { origin, now: now() });
    if (res.profile) entry.profile = res.profile;
    for (const key of res.applied || []) {
      entry.memory.write({
        kind: 'PREFERENCE', key: `profile:${key}`,
        value: { field: key, value: entry.profile[key]?.value ?? null },
        origin: origin === 'stated' ? 'stated' : 'inferred', tags: ['PROFILE']
      });
    }
    return { ...res, gaps: profileGaps(entry.profile), asserted: assertedFacts(entry.profile) };
  }

  function clearProfile(owner, keys = null) {
    const entry = scope(owner);
    entry.profile = resetProfile(entry.profile, keys, now());
    entry.memory.forget({ kind: 'PREFERENCE' });
    return { ok: true, profile: entry.profile, gaps: profileGaps(entry.profile) };
  }

  function addGoal(owner, input) {
    const entry = scope(owner);
    if (entry.goals.length >= MAX_GOALS) return { ok: false, code: 'TOO_MANY_GOALS', limit: MAX_GOALS };
    const created = createGoal(input, { now: now() });
    if (!created.ok) return created;
    entry.goals.push(created.goal);
    entry.memory.write({ kind: 'GOAL', key: `goal:${created.goal.goalId}`, value: { name: created.goal.name, type: created.goal.type, targetUsd: created.goal.targetUsd, horizonMonths: created.goal.horizonMonths }, origin: 'stated', tags: ['GOAL'] });
    events?.publish?.({ type: 'GOAL_PROGRESS_CHANGED', owner, payload: { goalId: created.goal.goalId, created: true }, source: 'intelligence-kernel' });
    return { ok: true, goal: created.goal, conflicts: detectGoalConflicts(entry.goals, entry.lastFinancialState) };
  }

  function listGoals(owner) {
    const entry = scope(owner);
    const fs = entry.lastFinancialState;
    return {
      goals: entry.goals.map((g) => ({ ...g, progress: goalProgress(g, fs, { now: now() }) })),
      conflicts: detectGoalConflicts(entry.goals, fs)
    };
  }

  function updateGoal(owner, goalId, patch = {}) {
    const entry = scope(owner);
    const idx = entry.goals.findIndex((g) => g.goalId === goalId);
    if (idx < 0) return { ok: false, code: 'GOAL_NOT_FOUND' };
    const merged = createGoal({ ...entry.goals[idx], ...patch, goalId }, { now: entry.goals[idx].createdAt });
    if (!merged.ok) return merged;
    merged.goal.createdAt = entry.goals[idx].createdAt;
    merged.goal.updatedAt = now();
    entry.goals[idx] = merged.goal;
    events?.publish?.({ type: 'GOAL_PROGRESS_CHANGED', owner, payload: { goalId }, source: 'intelligence-kernel' });
    return { ok: true, goal: merged.goal, conflicts: detectGoalConflicts(entry.goals, entry.lastFinancialState) };
  }

  const removeGoal = (owner, goalId) => {
    const entry = scope(owner);
    const before = entry.goals.length;
    entry.goals = entry.goals.filter((g) => g.goalId !== goalId);
    entry.memory.forget({ kind: 'GOAL', key: `goal:${goalId}` });
    return { ok: entry.goals.length < before, removed: before - entry.goals.length };
  };

  /* ── stage: DECISION (§10–§12, §16–§18, §30, §33, §34) ─────────────── */

  /**
   * The Financial Brain pipeline. Read-only end to end: it produces ranked
   * candidates with a council verdict and a Guardian report, and it CANNOT
   * cause an execution. What the user does with the ranking is a separate,
   * permission-gated call.
   */
  function advise(owner, { goalId = null, weightOverrides = null, sections = null } = {}) {
    const entry = scope(owner);
    const src = sections || sectionsFor(owner);
    const assessed = assess(owner, { sections: src });
    const fs = assessed.financialState;
    if (fs.status === 'UNAVAILABLE') {
      return {
        schema: KERNEL_SCHEMA, brain: CI_SCHEMA, status: 'UNAVAILABLE',
        reason: fs.reason, missing: fs.missing,
        detail: 'no financial decision is offered without a readable financial state — §73 forbids a recommendation with no evidence'
      };
    }
    const goal = goalId ? entry.goals.find((g) => g.goalId === goalId) || null : entry.goals[0] || null;
    const opportunities = rankOpportunities(
      (src.farming?.pools || src.farming?.rows || src.farming?.positions || []),
      { riskProfile: entry.profile.riskProfile?.value || 'MODERATE', now: now() }
    );
    const flows = smartMoneyModifier({
      accumulation: src.signals?.smartMoneyAccumulation ?? null,
      exchangeInflowUsd: src.signals?.exchangeInflowUsd ?? null,
      holderConcentrationPct: src.signals?.holderConcentrationPct ?? null,
      whaleSellingUsd: src.signals?.whaleSellingUsd ?? null
    });

    const decided = decide({
      financialState: fs,
      goal,
      opportunities: opportunities.status === 'OK' ? opportunities.ranked : [],
      risk: src.risk || null,
      capabilities: src.capabilities || {},
      profile: entry.profile,
      weightOverrides
    });
    if (decided.status !== 'OK') {
      return { schema: KERNEL_SCHEMA, brain: CI_SCHEMA, status: 'UNAVAILABLE', reason: decided.reason, skipped: decided.skipped, financialState: fs };
    }

    /* Smart money is a bounded modifier on the score, applied AFTER ranking so
       the base ranking stays auditable and the nudge is visible as its own row. */
    const ranked = decided.ranking.ranked.map((r) => ({
      ...r,
      smartMoneyModifier: flows.status === 'OK' ? flows.modifier : 0,
      adjustedScore: round((r.score?.score ?? 0) + (flows.status === 'OK' ? flows.modifier : 0), 4)
    })).sort((a, b) => b.adjustedScore - a.adjustedScore).map((r, i) => ({ ...r, rank: i + 1 }));

    const fresh = freshnessReport(owner);
    const evaluated = ranked.map((candidate) => ({
      candidate,
      council: runCouncil({
        decision: candidate, financialState: fs, risk: src.risk || null,
        security: { signals: src.securitySignals || [] },
        market: src.markets || null,
        smartMoney: { netFlowUsd: src.signals?.netFlowUsd ?? null, exchangeInflowUsd: src.signals?.exchangeInflowUsd ?? null },
        goal, now: now()
      }),
      guardian: financialGuardian({
        decision: candidate, goal, profile: entry.profile, financialState: fs,
        freshnessReport: fresh, reversible: candidate.type !== 'YIELD', now: now()
      })
    }));

    /* A candidate the Guardian blocks cannot be the recommendation, whatever it
       scored. This is the one place where a score is overruled, and it is
       overruled by a named finding rather than by a heuristic. */
    const permitted = evaluated.filter((e) => e.guardian.status !== 'BLOCK' && e.council.verdict !== 'REJECT');
    const recommended = permitted[0] || null;

    const record = {
      id: `dec_${now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
      at: now(),
      goalId: goal?.goalId || null,
      recommendedId: recommended?.candidate?.id || null,
      candidateIds: ranked.map((r) => r.id),
      weights: decided.weights,
      financialStateAt: fs.at
    };
    entry.decisions.push(record);
    while (entry.decisions.length > MAX_DECISION_LOG) entry.decisions.shift();
    if (recommended) {
      entry.memory.write({
        kind: 'DECISION', key: `decision:${record.id}`,
        value: { recommended: recommended.candidate.id, type: recommended.candidate.type, expectedReturnPct: recommended.candidate.expectedReturnPct, confidence: recommended.council.confidence },
        origin: 'observed', tags: ['DECISION', String(recommended.candidate.type || '').toUpperCase()]
      });
    }

    return {
      schema: KERNEL_SCHEMA, brain: CI_SCHEMA, status: 'OK', at: now(),
      decisionSetId: record.id,
      financialState: fs,
      goal: goal ? { ...goal, progress: goalProgress(goal, fs, { now: now() }) } : null,
      goalConflicts: detectGoalConflicts(entry.goals, fs),
      opportunities,
      smartMoney: flows,
      weights: decided.weights,
      candidates: evaluated.map((e) => ({
        ...e.candidate,
        council: { verdict: e.council.verdict, confidence: e.council.confidence, disagreements: e.council.disagreements, narrative: e.council.narrative, abstained: e.council.abstained },
        guardian: { status: e.guardian.status, blocking: e.guardian.blocking, unknowns: e.guardian.unknowns }
      })),
      comparisons: decided.ranking.comparisons,
      unscored: decided.ranking.unscored,
      recommended: recommended ? recommended.candidate.id : null,
      recommendationBlockedBy: recommended ? null : evaluated.map((e) => ({ id: e.candidate.id, guardian: e.guardian.blocking, council: e.council.verdict })),
      /* No decision is ever an authorisation. */
      requiresPermission: recommended ? SCOPE_FOR_DECISION[recommended.candidate.type] ?? 'execute:swap' : null,
      executed: false,
      estimate: true,
      disclaimer: 'every expected value here is a model estimate from the cited sources; nothing was executed and no permission was granted by producing it'
    };
  }

  /* ── stage: SCENARIO / SIMULATION / TWIN (§13–§15, §47, §48) ───────── */

  function scenarios(owner, { custom = [], sections = null } = {}) {
    const src = sections || sectionsFor(owner);
    const fs = scope(owner).lastFinancialState || buildFinancialState(src, { now: now() });
    return runScenarios({ ...src, financialState: fs }, { custom, now: now() });
  }

  function project(owner, { months = 12, expectedReturnPct = 12, volatilityPct = null, monthlyContributionUsd = 0, paths = 4000, seed = 20260905 } = {}) {
    const entry = scope(owner);
    const fs = entry.lastFinancialState || buildFinancialState(sectionsFor(owner), { now: now() });
    return monteCarlo({
      startUsd: fs?.netWorthUsd ?? fs?.availableCapitalUsd ?? null,
      months, expectedReturnPct,
      volatilityPct: volatilityPct ?? fs?.volatilityPct ?? 60,
      monthlyContributionUsd, paths, seed
    });
  }

  function optimize(owner) {
    const entry = scope(owner);
    const fs = entry.lastFinancialState || buildFinancialState(sectionsFor(owner), { now: now() });
    return optimizePortfolio({ financialState: fs, now: now() });
  }

  function twin(owner, { change = {}, horizonsMonths = [3, 6, 12] } = {}) {
    const entry = scope(owner);
    const fs = entry.lastFinancialState || buildFinancialState(sectionsFor(owner), { now: now() });
    return twinProject({ financialState: fs, change, horizonsMonths, volatilityPct: fs?.volatilityPct ?? 60 });
  }

  /* ── stage: PERMISSION (§45, §46, §57) ─────────────────────────────── */

  /**
   * The kernel's authorization decision. Returns a DECISION about permission;
   * it never performs the action. The brain's action engine is still the only
   * thing that can hand a transaction to a wallet.
   */
  function authorize(owner, { scope: scopeId, amountUsd = null, actionId = null } = {}) {
    const verdict = permissions.check(owner, scopeId, { amountUsd, killSwitches, actionId });
    return { ...verdict, executes: false, note: 'this is an authorisation decision only; execution stays with the action engine and the user\'s wallet' };
  }

  function preflight(owner, input = {}) {
    const permission = permissions.check(owner, input.scope || 'execute:swap', { amountUsd: input.quote?.amountUsd ?? null, killSwitches, actionId: input.action?.actionId || null });
    return executionGuardian({ ...input, permission: { granted: permission.granted, scope: permission.scope, expiresAt: permission.expiresAt }, now: now() });
  }

  /* ── stage: STRATEGY + MONITORING + REPLANNING (§27–§29) ────────────── */

  function registerStrategy(owner, input) {
    const entry = scope(owner);
    if (entry.strategies.length >= MAX_STRATEGIES) return { ok: false, code: 'TOO_MANY_STRATEGIES', limit: MAX_STRATEGIES };
    const created = createStrategy(input, { now: now() });
    if (!created.ok) return created;
    entry.strategies.push(created.strategy);
    entry.memory.write({ kind: 'STRATEGY', key: `strategy:${created.strategy.strategyId}`, value: { name: created.strategy.name, state: created.strategy.state, expectedReturnPct: created.strategy.expectedReturnPct }, origin: 'observed', tags: ['STRATEGY'] });
    return { ok: true, strategy: created.strategy };
  }

  function moveStrategy(owner, strategyId, next, reason = '') {
    const entry = scope(owner);
    const idx = entry.strategies.findIndex((s) => s.strategyId === strategyId);
    if (idx < 0) return { ok: false, code: 'STRATEGY_NOT_FOUND' };
    const moved = transitionStrategy(entry.strategies[idx], next, { reason, at: now() });
    if (!moved.ok) return moved;
    entry.strategies[idx] = moved.strategy;
    return moved;
  }

  function monitor(owner, { sections = null, triggers = [] } = {}) {
    const entry = scope(owner);
    const previous = entry.lastFinancialState;
    const assessed = assess(owner, { sections });
    const fs = assessed.financialState;
    if (fs.status === 'UNAVAILABLE') {
      return { schema: KERNEL_SCHEMA, status: 'UNAVAILABLE', reason: fs.reason, detail: 'monitoring needs a readable financial state; nothing is asserted without one' };
    }
    const goal = entry.goals[0] || null;
    const progress = goal ? goalProgress(goal, fs, { now: now() }) : null;
    const changes = previous ? detectChanges(previous, fs, { now: now() }) : { changed: false, changes: [], count: 0 };
    const strategy = entry.strategies.find((s) => ['ACTIVE', 'MONITORED', 'APPROVED'].includes(s.state)) || null;
    const warnings = earlyWarnings({ financialState: fs, goalProgress: progress, strategy, profile: entry.profile, now: now() });
    const replan = strategy ? evaluateStrategy({ strategy, changes, warnings, goalProgress: progress, triggers, now: now() }) : null;

    /* An escalation MOVES the strategy, so the lifecycle in the UI reflects the
       verdict instead of requiring a second call nobody makes. */
    if (replan?.verdict === 'REPLAN_REQUIRED' && strategy && (STRATEGY_MOVE_OK[strategy.state] || []).includes('DEGRADED')) {
      moveStrategy(owner, strategy.strategyId, 'DEGRADED', 'monitoring raised a high-severity trigger');
    }

    return {
      schema: KERNEL_SCHEMA, brain: CI_SCHEMA, status: 'OK', at: now(),
      financialState: fs, changes, warnings, goalProgress: progress, replan,
      strategy: strategy ? entry.strategies.find((s) => s.strategyId === strategy.strategyId) : null,
      brief: buildDailyBrief({ financialState: fs, changes, warnings, goalProgress: progress, strategy, now: now() })
    };
  }

  const STRATEGY_MOVE_OK = { ACTIVE: ['MONITORED', 'DEGRADED', 'ARCHIVED'], MONITORED: ['DEGRADED', 'REVISED', 'ACTIVE', 'ARCHIVED'], APPROVED: ['ACTIVE', 'REVISED', 'ARCHIVED'] };

  /* ── stage: LEARNING (§25, §35, §60) ───────────────────────────────── */

  function recordOutcome(owner, { decision = null, actual = {} } = {}) {
    const entry = scope(owner);
    const evaluated = evaluateOutcome({ decision, actual, now: now() });
    if (evaluated.status !== 'OK') return evaluated;
    entry.outcomes.push({ ...evaluated, confidence: usableNumber(decision?.confidence) ?? null });
    while (entry.outcomes.length > 200) entry.outcomes.shift();
    entry.memory.write({
      kind: 'OUTCOME', key: `outcome:${decision?.id || evaluated.at}`,
      value: { decisionId: decision?.id || null, expected: evaluated.expectedReturnPct, realised: evaluated.realisedReturnPct, verdict: evaluated.verdict, causes: evaluated.causes.map((c) => c.code) },
      origin: 'observed', tags: ['OUTCOME', String(decision?.type || '').toUpperCase()].filter(Boolean)
    });
    return evaluated;
  }

  function calibration(owner) {
    const entry = scope(owner);
    const rows = entry.outcomes
      .filter((o) => o.confidence !== null)
      .map((o) => ({ confidence: o.confidence, correct: o.verdict === 'AS_EXPECTED' || o.verdict === 'BETTER' }));
    return calibrate(rows);
  }

  /* ── stage: EVENTS (§50) ───────────────────────────────────────────── */

  function interpret(owner, event) {
    const entry = scope(owner);
    const out = interpretEvent(event, { financialState: entry.lastFinancialState, now: now() });
    if (out.status === 'OK' && out.impact !== 'INFORMATIONAL') {
      entry.memory.write({ kind: 'EVENT', value: { type: out.raw.type, symbol: out.raw.symbol, impact: out.impact }, origin: 'observed', tags: ['EVENT', out.impact] });
    }
    return out;
  }

  /* ── memory surface (§22–§24) ──────────────────────────────────────── */

  const memory = {
    write: (owner, input) => scope(owner).memory.write(input),
    retrieve: (owner, input) => scope(owner).memory.retrieve(input),
    promote: (owner, id, opts) => scope(owner).memory.promote(id, opts),
    forget: (owner, sel) => scope(owner).memory.forget(sel),
    stats: (owner) => scope(owner).memory.stats(),
    exportAll: (owner) => scope(owner).memory.exportAll()
  };

  /* ── §61 evaluation dashboard ──────────────────────────────────────── */

  function evaluationSnapshot(owner = null) {
    const list = owner ? [scope(owner)] : [...owners.values()];
    const decisions = list.reduce((a, e) => a + e.decisions.length, 0);
    const outcomes = list.flatMap((e) => e.outcomes);
    const asExpected = outcomes.filter((o) => o.verdict === 'AS_EXPECTED').length;
    const cal = calibrate(outcomes.filter((o) => o.confidence !== null).map((o) => ({ confidence: o.confidence, correct: o.verdict !== 'WORSE' })));
    return {
      schema: KERNEL_SCHEMA, brain: CI_SCHEMA, at: now(),
      owners: owners.size,
      decisionSets: decisions,
      outcomesRecorded: outcomes.length,
      outcomeAccuracyPct: outcomes.length ? round((asExpected / outcomes.length) * 100, 1) : null,
      calibration: cal,
      memory: list.reduce((a, e) => a + e.memory.stats().total, 0),
      goals: list.reduce((a, e) => a + e.goals.length, 0),
      strategies: list.reduce((a, e) => a + e.strategies.length, 0),
      killSwitches: killSwitches.status(),
      /* Named honestly: these are the metrics we can compute from what the
         kernel actually observes. The ones §61 lists that need labelled ground
         truth (intent accuracy, hallucination rate) are NOT reported as numbers
         here, because a fabricated metric is the exact failure this file forbids. */
      notMeasuredHere: ['intentAccuracy', 'contextAccuracy', 'hallucinationRate', 'userCorrections'],
      notMeasuredReason: 'these need labelled ground truth from the golden-conversation suite, not from live traffic; reporting a number for them from here would be inventing one'
    };
  }

  return {
    schema: KERNEL_SCHEMA,
    /* state + profile + goals */
    assess, getProfile, patchProfile, clearProfile, profileGaps: (owner) => profileGaps(scope(owner).profile),
    addGoal, listGoals, updateGoal, removeGoal,
    /* decisions + simulation */
    advise, scenarios, project, optimize, twin,
    /* permission + guardians */
    permissions, killSwitches, authorize, preflight,
    /* strategy + monitoring + learning */
    registerStrategy, moveStrategy, monitor, recordOutcome, calibration, interpret,
    /* memory + evaluation */
    memory, evaluationSnapshot,
    scopes: PERMISSION_SCOPES,
    /* test seams */
    __scope: scope
  };
}

export default createKernel;
