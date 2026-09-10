/**
 * FBT STRATEGY BRAIN — STRATEGY RUNTIME (layer 4 of 4).
 * ---------------------------------------------------------------------------
 * A strategy that is built and then never looked at again is a brochure. This
 * is the half that keeps it honest after the first signature:
 *
 *   staged execution — one stage at a time, in order, each stage entering only
 *     when the one before it is CONFIRMED. A failed stage stops the plan; it
 *     does not "continue with the remaining steps" as if nothing happened.
 *   monitoring       — every observation is compared against the plan's own
 *     curve and the user's drawdown budget, and the verdict is CONTINUE,
 *     REVISE, HALT or COMPLETE.
 *   revision         — when a trigger fires, the ecosystem is re-read and the
 *     blueprints are re-scored. A revision never re-uses the old rates, and
 *     the history is capped so a long-running plan cannot grow without bound.
 *
 * ─── WHAT IT CANNOT DO ──────────────────────────────────────────────────────
 * It never signs and never moves funds. `advance()` returns the stage's
 * handoff actions; the venue executes them and reports back through
 * `confirmStage` / `failStage` with a receipt or a named failure. The runtime
 * has no key, no provider and no wallet.
 *
 * ─── HOST BUDGET ────────────────────────────────────────────────────────────
 * No timers, no polling, no persistence: the runtime is a plain object driven
 * by the caller's events, and its revision history is capped at
 * `revisionPolicy.maxRevisions` (5).
 */

import { buildPortfolioStrategy } from './strategyEngine.js';
import { num, r2 } from './numeric.js';

export const STRATEGY_RUNTIME_SCHEMA = 'fbt.strategy-runtime.v1';

export const STAGE_STATES = Object.freeze(['PENDING', 'READY', 'RUNNING', 'CONFIRMED', 'FAILED', 'SKIPPED']);


/**
 * The plan's own expected-return curve. Deployment is not instant — capital
 * only earns from the moment its stage is confirmed — so the curve is the
 * plan's expected return weighted by how much of the horizon each stage has
 * been deployed for. Comparing realised PnL against a straight line would
 * call a healthy two-day-old plan "behind".
 */
export function planCurve({ strategy, stageProgress = {}, at = null, startedAt = null }) {
  const horizonDays = strategy?.goal?.horizonDays || 365;
  const start = startedAt ?? strategy?.builtAt ?? Date.now();
  const now = at ?? Date.now();
  const elapsedDays = Math.max(0, (now - start) / 86_400_000);
  const fraction = Math.min(1, elapsedDays / horizonDays);

  /* Weight each sleeve by the share of the horizon it has been live for. */
  const sleeves = Array.isArray(strategy?.sleeves) ? strategy.sleeves : [];
  let earned = 0;
  for (const sleeve of sleeves) {
    const stageId = sleeve.stageId || stageOfFamily(sleeve.family);
    const live = stageProgress[stageId];
    if (!live || !live.confirmedAt) continue;
    const liveDays = Math.max(0, (now - live.confirmedAt) / 86_400_000);
    const liveFraction = Math.min(1, liveDays / horizonDays);
    const annual = num(sleeve.returnPctAnnual) ?? 0;
    earned += (sleeve.weightPct / 100) * annual * liveFraction;
  }

  /* Cost is paid up front, on day one. */
  const costPct = num(strategy?.cost?.totalPct ?? strategy?.cost?.feePct) ?? 0;
  const expectedReturnPct = earned - (fraction > 0 ? costPct : 0);
  const targetPct = num(strategy?.goal?.targetPct) ?? null;

  return {
    elapsedDays: r2(elapsedDays),
    horizonFraction: r2(fraction),
    expectedReturnPct: r2(expectedReturnPct),
    /* The straight-line share of the target — what "on pace" means. */
    paceReturnPct: targetPct != null ? r2(targetPct * fraction) : null,
    targetPct,
    at: now
  };
}

function stageOfFamily(family) {
  if (['cash', 'lending', 'staking', 'farm', 'lp'].includes(family)) return 'deploy-yield';
  if (['crypto', 'rwa', 'equity', 'fx', 'commodity', 'derivatives'].includes(family)) return 'deploy-market';
  return 'deploy-yield';
}

/**
 * Create a runtime around a built strategy.
 *
 * @param {object} opts
 * @param {object} opts.strategy   the object buildPortfolioStrategy returned
 * @param {object} [opts.goal]     goal spec, kept for re-planning
 * @param {Function} [opts.readEcosystem]  async () => state (layer 2)
 * @param {Function} [opts.now]
 * @param {Function} [opts.onEvent] ({ type, ... }) => void  (telemetry only)
 */
export function createStrategyRuntime({ strategy, goal = null, readEcosystem = null, now = () => Date.now(), onEvent = null } = {}) {
  if (!strategy?.ok) throw new Error('STRATEGY_REQUIRED');

  const emit = (payload) => { try { onEvent?.(payload); } catch { /* telemetry is never load-bearing */ } };

  /** Sleeve → stage, so the curve knows what has been live and for how long. */
  const sleeveStage = new Map(
    (strategy.sleeves || []).map((s) => [s.id, s.stageId || stageOfFamily(s.family)])
  );
  for (const sleeve of strategy.sleeves || []) {
    if (!sleeve.stageId) sleeve.stageId = stageOfFamily(sleeve.family);
  }

  let current = strategy;
  const stageProgress = Object.fromEntries((strategy.stages || []).map((s) => [s.id, {
    stageId: s.id, state: s.order === 0 ? 'READY' : 'PENDING', confirmedAt: null, receipt: null, error: null, attempts: 0
  }]));
  const observations = [];
  const revisions = [];
  let halted = null;

  const stageOrder = (strategy.stages || []).slice().sort((a, b) => a.order - b.order);

  function state() {
    return {
      schema: STRATEGY_RUNTIME_SCHEMA,
      strategyId: current.strategyId,
      revisionCount: revisions.length,
      stages: (current.stages || []).map((s) => ({ ...s, runtime: stageProgress[s.id] })),
      stageProgress: { ...stageProgress },
      observations: observations.slice(-10),
      revisions: revisions.slice(-5).map(({ strategy: _s, ...rest }) => rest),
      halted,
      curve: planCurve({ strategy: current, stageProgress, at: now() }),
      fundsMoved: revisions.length ? revisions.some((r) => r.fundsMoved) : false,
      executionAuthorized: false
    };
  }

  /** The next stage that may run, and its handoff actions. */
  function nextStage() {
    if (halted) return { ok: false, code: 'HALTED', detail: halted.reason };
    for (const stage of stageOrder) {
      const progress = stageProgress[stage.id];
      if (!progress || progress.state === 'CONFIRMED' || progress.state === 'SKIPPED') continue;
      if (progress.state === 'FAILED') return { ok: false, code: 'STAGE_FAILED', stageId: stage.id, detail: progress.error?.code || 'FAILED' };
      const blockers = stageOrder.filter((s) => s.order < stage.order).filter((s) => stageProgress[s.id]?.state !== 'CONFIRMED');
      if (blockers.length) return { ok: false, code: 'BLOCKED', stageId: stage.id, waitingOn: blockers.map((b) => b.id) };
      return { ok: true, stage, actions: stage.actions || [], movesFunds: Boolean(stage.movesFunds) };
    }
    return { ok: true, done: true, stage: null, actions: [] };
  }

  /** Mark a stage as running. Returns the handoff actions to give the venue. */
  function advance() {
    const next = nextStage();
    if (!next.ok || next.done) return next;
    const progress = stageProgress[next.stage.id];
    progress.state = 'RUNNING';
    progress.attempts += 1;
    progress.startedAt = now();
    emit({ type: 'STAGE_STARTED', strategyId: current.strategyId, stageId: next.stage.id, movesFunds: next.movesFunds });
    return { ...next, executionAuthorized: false, requiresSignature: next.actions.some((a) => a.requiresSignature) };
  }

  /** The venue signed and the receipt verifies. */
  function confirmStage(stageId, { receipt = null, txHash = null } = {}) {
    const progress = stageProgress[stageId];
    if (!progress) return { ok: false, code: 'UNKNOWN_STAGE' };
    progress.state = 'CONFIRMED';
    progress.confirmedAt = now();
    progress.receipt = receipt || (txHash ? { txHash } : null);
    emit({ type: 'STAGE_CONFIRMED', strategyId: current.strategyId, stageId, receipt: progress.receipt });
    return { ok: true, stage: stageId, next: nextStage() };
  }

  /** The venue failed. The plan stops here — it does not skip ahead. */
  function failStage(stageId, error = {}) {
    const progress = stageProgress[stageId];
    if (!progress) return { ok: false, code: 'UNKNOWN_STAGE' };
    progress.state = 'FAILED';
    progress.error = { code: String(error.code || 'FAILED'), message: String(error.message || '').slice(0, 160) };
    emit({ type: 'STAGE_FAILED', strategyId: current.strategyId, stageId, error: progress.error });
    return { ok: true, stage: stageId, decision: 'HALT', reason: `stage ${stageId} failed: ${progress.error.code}` };
  }

  function skipStage(stageId, reason = 'SKIPPED_BY_USER') {
    const progress = stageProgress[stageId];
    if (!progress) return { ok: false, code: 'UNKNOWN_STAGE' };
    progress.state = 'SKIPPED';
    progress.error = { code: reason };
    emit({ type: 'STAGE_SKIPPED', strategyId: current.strategyId, stageId, reason });
    return { ok: true, stage: stageId, next: nextStage() };
  }

  /**
   * Feed the runtime one observation of reality and get a decision.
   *
   * @param {object} observation
   * @param {number} observation.portfolioValueUsd  what the wallet is worth now
   * @param {object} [observation.signals]          { apyDecayPct, regime, fundingFlipped }
   */
  function observe(observation = {}) {
    const value = num(observation.portfolioValueUsd);
    const capital = num(current.goal?.capitalUsd) || 0;
    const realisedPct = value != null && capital > 0 ? ((value - capital) / capital) * 100 : null;
    const curve = planCurve({ strategy: current, stageProgress, at: now(), startedAt: observation.startedAt });
    const record = {
      at: now(),
      portfolioValueUsd: value,
      realisedPct: r2(realisedPct),
      expectedReturnPct: curve.expectedReturnPct,
      paceReturnPct: curve.paceReturnPct,
      behindPct: realisedPct != null && curve.paceReturnPct != null ? r2(curve.paceReturnPct - realisedPct) : null,
      drawdownPct: observation.drawdownPct != null ? r2(observation.drawdownPct) : null,
      signals: observation.signals || null
    };
    observations.push(record);
    if (observations.length > 50) observations.splice(0, observations.length - 50);

    const triggers = [];
    const budget = num(current.risk?.drawdownBudgetPct);
    if (record.drawdownPct != null && budget != null && record.drawdownPct > budget) {
      triggers.push({ id: 'drawdown-budget', detail: `${record.drawdownPct}% > ${budget}% budget` });
    }
    /* Only judge pace once a third of the horizon has passed — before that,
       the difference between "behind" and "not deployed yet" is noise. */
    if (curve.horizonFraction >= 0.33 && record.behindPct != null && record.behindPct > Math.max(2, Math.abs(curve.paceReturnPct || 0) * 0.5)) {
      triggers.push({ id: 'target-pace', detail: `behind the plan curve by ${record.behindPct}pp` });
    }
    const floor = num(current.goal?.floorPct ?? current.goal?.targetPct);
    if (floor != null && curve.horizonFraction >= 0.9 && record.realisedPct != null && record.realisedPct < floor * 0.75) {
      triggers.push({ id: 'floor-breach', detail: `${record.realisedPct}% realised vs ${floor}% minimum` });
    }
    const decay = num(observation.signals?.apyDecayPct);
    if (decay != null && decay > 30) triggers.push({ id: 'rate-decay', detail: `a sleeve's APY fell ${decay}%` });
    if (observation.signals?.regimeFlipped) triggers.push({ id: 'regime-flip', detail: `regime → ${observation.signals.regime}` });

    const deployed = stageOrder.filter((s) => s.movesFunds).every((s) => stageProgress[s.id]?.state === 'CONFIRMED');
    const finished = curve.horizonFraction >= 1;

    let decision = 'CONTINUE';
    if (halted) decision = 'HALT';
    else if (finished) decision = 'COMPLETE';
    else if (triggers.some((t) => t.id === 'drawdown-budget' || t.id === 'floor-breach')) decision = deployed ? 'REVISE' : 'HALT';
    else if (triggers.length) decision = 'REVISE';

    emit({ type: 'OBSERVED', strategyId: current.strategyId, decision, triggers });
    return { ok: true, decision, triggers, observation: record, curve, revisionsUsed: revisions.length };
  }

  /**
   * Re-read the ecosystem and re-score. The old strategy is kept as a link,
   * not as a fallback: a revision that re-uses stale rates is the exact
   * failure this module exists to prevent.
   */
  async function revise({ reason = 'MANUAL', observation = null } = {}) {
    if (typeof readEcosystem !== 'function') {
      return { ok: false, code: 'NO_ECOSYSTEM_READER', detail: 'a revision needs a fresh read; none is bound' };
    }
    const max = num(current.revisionPolicy?.maxRevisions) ?? 5;
    if (revisions.length >= max) {
      return { ok: false, code: 'REVISION_LIMIT', detail: `${revisions.length}/${max} revisions used — a human decides from here` };
    }
    const freshState = await readEcosystem();
    const next = buildPortfolioStrategy({ goal: goal || current.goal, state: freshState, now: now() });
    if (!next.ok) {
      return { ok: false, code: next.code, detail: next.detail || 're-plan refused', previousStrategyId: current.strategyId };
    }
    revisions.push({
      at: now(),
      reason,
      fromStrategyId: current.strategyId,
      toStrategyId: next.strategyId,
      expectedReturnPct: next.verdict?.expectedReturnPct ?? null,
      previousExpectedReturnPct: current.verdict?.expectedReturnPct ?? null,
      changedChosen: next.chosen !== current.chosen,
      triggers: observation?.triggers || [],
      fundsMoved: false
    });
    if (revisions.length > max) revisions.splice(0, revisions.length - max);

    /* Carry the deployment truth forward: a stage already signed stays
       confirmed, the new plan's remaining stages start from READY. */
    const confirmed = Object.entries(stageProgress).filter(([, p]) => p.state === 'CONFIRMED').map(([id]) => id);
    current = next;
    for (const stage of current.stages || []) {
      const prior = stageProgress[stage.id];
      stageProgress[stage.id] = prior && confirmed.includes(stage.id)
        ? prior
        : { stageId: stage.id, state: stage.order === 0 ? 'CONFIRMED' : 'READY', confirmedAt: prior?.confirmedAt ?? null, receipt: prior?.receipt ?? null, error: null, attempts: 0 };
    }
    for (const sleeve of current.sleeves || []) sleeve.stageId = stageOfFamily(sleeve.family);

    emit({ type: 'REVISED', strategyId: current.strategyId, reason, revision: revisions[revisions.length - 1] });
    return { ok: true, strategy: current, revision: revisions[revisions.length - 1], state: state() };
  }

  function halt(reason = 'HALTED_BY_USER') {
    halted = { reason, at: now() };
    emit({ type: 'HALTED', strategyId: current.strategyId, reason });
    return { ok: true, halted };
  }

  function resume() { halted = null; return { ok: true }; }

  return {
    get strategy() { return current; },
    state, nextStage, advance, confirmStage, failStage, skipStage, observe, revise, halt, resume,
    planCurve: (at = null) => planCurve({ strategy: current, stageProgress, at, startedAt: observations[0]?.at })
  };
}
