/**
 * User-driven loop execution state machine.
 *
 * It contains no wallet/RPC imports and never schedules a step. The only
 * execution entry point requires an explicit `userClicked` token supplied by
 * the button handler. Simulation, risk reads, quote refreshes and cancellation
 * are read-only operations.
 */

export const LOOP_RUN_STATE = Object.freeze({
  REVIEW: 'review',
  SIMULATING: 'simulating',
  READY: 'ready',
  QUOTE_REVIEW: 'quote-review',
  RUNNING: 'running',
  PAUSED: 'paused',
  PARTIAL: 'partial',
  FAILED: 'failed',
  COMPLETED: 'completed',
  CANCELLED: 'cancelled'
});

export function createLoopExecutionController({
  steps = [],
  simulatePlan,
  simulateStep,
  readRisk,
  getFreshQuote,
  simulateRemaining,
  executeStep,
  minHealthFactor = 1.05,
  quoteMaxAgeMs = 15_000,
  now = () => Date.now(),
  onChange = null
} = {}) {
  const plannedSteps = Array.isArray(steps) ? steps.map((step) => ({ ...step })) : [];
  let stopRequested = false;
  let state = {
    status: LOOP_RUN_STATE.REVIEW,
    stepIndex: 0,
    steps: plannedSteps,
    completed: [],
    simulation: null,
    stepSimulation: null,
    currentQuote: null,
    remainingSimulation: null,
    error: null,
    unwindSuggested: false,
    stopRequested: false
  };

  const snapshot = () => ({
    ...state,
    steps: state.steps.map((step) => ({ ...step })),
    completed: state.completed.map((step) => ({ ...step }))
  });
  const publish = (patch) => {
    state = { ...state, ...patch };
    onChange?.(snapshot());
    return snapshot();
  };
  const currentStep = () => state.steps[state.stepIndex] ?? null;
  const stopped = (code, status = LOOP_RUN_STATE.PAUSED, detail = null) => {
    const nextStatus = status === LOOP_RUN_STATE.PAUSED && state.completed.length > 0
      ? LOOP_RUN_STATE.PARTIAL
      : status;
    publish({
      status: nextStatus,
      error: { code, detail },
      stepSimulation: null,
      unwindSuggested: nextStatus === LOOP_RUN_STATE.PARTIAL && state.completed.length > 0
    });
    return { ok: false, code, detail, state: snapshot() };
  };

  async function simulate() {
    if (typeof simulatePlan !== 'function' || state.steps.length === 0) {
      return stopped('PLAN_UNAVAILABLE', LOOP_RUN_STATE.PAUSED);
    }
    publish({ status: LOOP_RUN_STATE.SIMULATING, error: null, simulation: null });
    let result;
    try { result = await simulatePlan(snapshot().steps); }
    catch (error) { result = { ok: false, status: 'unknown', reason: 'SIMULATION_FAILED', detail: String(error?.message || error) }; }
    if (!result?.ok || result?.provenSafe !== true) {
      return stopped(result?.reason || result?.status || 'SIMULATION_NOT_PROVEN', LOOP_RUN_STATE.PAUSED, result?.revertReason || result?.detail || null);
    }
    publish({ status: LOOP_RUN_STATE.READY, simulation: result, error: null });
    return { ok: true, simulation: result, state: snapshot() };
  }

  async function advance({ userClicked = false } = {}) {
    if (userClicked !== true) return { ok: false, code: 'USER_CLICK_REQUIRED', state: snapshot() };
    if (stopRequested) return { ok: false, code: 'LOOP_STOPPED', state: snapshot() };
    if (![LOOP_RUN_STATE.READY, LOOP_RUN_STATE.QUOTE_REVIEW].includes(state.status)) {
      return { ok: false, code: 'LOOP_NOT_READY', state: snapshot() };
    }

    const step = currentStep();
    if (!step) {
      publish({ status: LOOP_RUN_STATE.COMPLETED, error: null });
      return { ok: true, completed: true, state: snapshot() };
    }

    let quote = null;
    if (step.id === 'swap') {
      const quoteAge = state.currentQuote ? now() - Number(state.currentQuote.quotedAt) : Infinity;
      const reviewAge = state.currentQuote ? now() - Number(state.currentQuote.reviewedAt) : Infinity;
      const stillFresh = state.currentQuote
        && state.currentQuote.stepIndex === state.stepIndex
        && quoteAge >= 0 && quoteAge <= quoteMaxAgeMs
        && reviewAge >= 0 && reviewAge <= quoteMaxAgeMs;
      if (!stillFresh) {
        if (typeof getFreshQuote !== 'function') return stopped('FRESH_QUOTE_UNAVAILABLE');
        let refreshed;
        try { refreshed = await getFreshQuote(step, snapshot()); }
        catch (error) { refreshed = { ok: false, code: 'QUOTE_FAILED', detail: String(error?.message || error) }; }
        if (!refreshed?.ok || !refreshed.quote) return stopped(refreshed?.code || 'QUOTE_UNAVAILABLE', LOOP_RUN_STATE.PAUSED, refreshed?.detail || null);
        const quotedAt = Number(refreshed.quotedAt);
        const ageAtReview = now() - quotedAt;
        if (!Number.isFinite(quotedAt) || ageAtReview < 0 || ageAtReview > quoteMaxAgeMs) {
          return stopped('FRESH_QUOTE_EXPIRED', LOOP_RUN_STATE.PAUSED);
        }
        if (typeof simulateRemaining !== 'function') return stopped('REMAINING_PLAN_SIMULATOR_UNAVAILABLE');
        let remainingSimulation;
        try { remainingSimulation = await simulateRemaining(state.steps.slice(state.stepIndex), step, refreshed.quote, snapshot()); }
        catch (error) { remainingSimulation = { ok: false, status: 'unknown', detail: String(error?.message || error) }; }
        if (!remainingSimulation?.ok || remainingSimulation?.provenSafe !== true) {
          return stopped(remainingSimulation?.reason || remainingSimulation?.status || 'REMAINING_PLAN_SIMULATION_NOT_PROVEN', LOOP_RUN_STATE.PAUSED, remainingSimulation?.revertReason || remainingSimulation?.detail || null);
        }
        publish({
          status: LOOP_RUN_STATE.QUOTE_REVIEW,
          currentQuote: { stepIndex: state.stepIndex, reviewedAt: now(), quotedAt, quote: refreshed.quote, metadata: refreshed.metadata ?? null },
          remainingSimulation,
          error: null
        });
        return { ok: false, code: 'QUOTE_REVIEW_REQUIRED', quote: refreshed.quote, state: snapshot() };
      }
      quote = state.currentQuote.quote;
    }

    let risk;
    try { risk = await readRisk?.(step, snapshot()); }
    catch (error) { risk = { ok: false, code: 'RISK_READ_FAILED', detail: String(error?.message || error) }; }
    if (!risk?.ok) return stopped(risk?.code || 'RISK_DATA_UNAVAILABLE', LOOP_RUN_STATE.PAUSED, risk?.detail || null);
    const hf = risk.healthFactor == null ? null : Number(risk.healthFactor);
    const debt = risk.debtUsd == null ? null : Number(risk.debtUsd);
    if (hf != null && (!Number.isFinite(hf) || hf < Number(minHealthFactor))) {
      return stopped('HEALTH_FACTOR_BELOW_FLOOR', LOOP_RUN_STATE.PAUSED, { healthFactor: hf, minimum: Number(minHealthFactor) });
    }
    if (debt != null && (!Number.isFinite(debt) || debt < 0)) {
      return stopped('RISK_DATA_UNAVAILABLE', LOOP_RUN_STATE.PAUSED);
    }
    if (hf == null && (debt == null || debt > 0)) {
      return stopped('HEALTH_FACTOR_UNAVAILABLE', LOOP_RUN_STATE.PAUSED);
    }

    let simulation;
    try { simulation = await simulateStep?.(step, quote, snapshot()); }
    catch (error) { simulation = { ok: false, status: 'unknown', detail: String(error?.message || error) }; }
    if (!simulation?.ok || simulation?.provenSafe !== true) {
      return stopped(simulation?.reason || simulation?.status || 'STEP_SIMULATION_NOT_PROVEN', LOOP_RUN_STATE.PAUSED, simulation?.revertReason || simulation?.detail || null);
    }
    publish({ status: LOOP_RUN_STATE.RUNNING, stepSimulation: simulation, error: null });

    let result;
    try { result = await executeStep?.(step, quote, snapshot()); }
    catch (error) { result = { ok: false, code: 'STEP_FAILED', detail: String(error?.message || error) }; }
    if (!result?.ok) {
      const hasCompleted = state.completed.length > 0;
      return stopped(result?.code || 'STEP_FAILED', hasCompleted ? LOOP_RUN_STATE.PARTIAL : LOOP_RUN_STATE.FAILED, {
        stepIndex: state.stepIndex,
        stepId: step.id,
        detail: result?.detail || result?.message || null,
        hash: result?.hash || null
      });
    }

    const completed = [...state.completed, {
      index: state.stepIndex,
      id: step.id,
      asset: step.asset?.symbol ?? step.symbol ?? null,
      amountWei: step.amountWei != null ? String(step.amountWei) : null,
      hash: result.hash ?? null
    }];
    const nextIndex = state.stepIndex + 1;
    const done = nextIndex >= state.steps.length;
    if (stopRequested && !done) {
      publish({
        status: LOOP_RUN_STATE.PARTIAL,
        stepIndex: nextIndex,
        completed,
        currentQuote: null,
        stepSimulation: null,
        error: { code: 'USER_STOPPED' },
        unwindSuggested: completed.length > 0,
        stopRequested: true
      });
      return { ok: true, stopped: true, step, result, state: snapshot() };
    }
    publish({
      status: done ? LOOP_RUN_STATE.COMPLETED : LOOP_RUN_STATE.READY,
      stepIndex: nextIndex,
      completed,
      currentQuote: null,
      remainingSimulation: null,
      stepSimulation: null,
      error: null
    });
    return { ok: true, step, result, state: snapshot() };
  }

  function cancel() {
    if ([LOOP_RUN_STATE.COMPLETED, LOOP_RUN_STATE.FAILED, LOOP_RUN_STATE.CANCELLED, LOOP_RUN_STATE.PARTIAL].includes(state.status)) return snapshot();
    stopRequested = true;
    if (state.status === LOOP_RUN_STATE.RUNNING) {
      publish({ error: { code: 'USER_STOPPED_AFTER_CURRENT_STEP' }, stopRequested: true });
      return snapshot();
    }
    const hasCompleted = state.completed.length > 0;
    publish({
      status: hasCompleted ? LOOP_RUN_STATE.PARTIAL : LOOP_RUN_STATE.CANCELLED,
      error: { code: 'USER_STOPPED' },
      currentQuote: null,
      unwindSuggested: hasCompleted,
      stopRequested: true
    });
    return snapshot();
  }

  return {
    snapshot,
    simulate,
    advance,
    cancel,
    currentStep
  };
}
