/**
 * User-driven loop execution state machine.
 *
 * It contains no wallet/RPC imports and never schedules a step. The only
 * execution entry point requires an explicit `userClicked` token supplied by
 * the button handler. Simulation, risk reads, quote refreshes and cancellation
 * are read-only operations.
 *
 * ─── 2026-10-15: THE STEPS RUN FOR REAL ─────────────────────────────────────
 * Stage C used to stop at a permanently disabled button. The controller now
 * drives the real sequence (loopRuntime.js supplies the callbacks), and gained
 * what that needs — without loosening any rule above:
 *
 *   · prepareStep(step)  resolves the step's concrete amount from a FRESH read
 *                        right before its checks (borrow = safe capacity now,
 *                        supply = what the previous leg actually produced).
 *                        It may answer `finish: true` — no capacity left — and
 *                        the run completes early instead of signing dust.
 *   · per-step risk floor  `risk.minHealthFactor` overrides the default for
 *                        that step; `risk.floorExempt` marks a supply, which
 *                        can only raise the health factor.
 *   · resume()           after a pause, a failure or a stop, the REMAINING
 *                        steps are re-checked (simulatePlan) before READY.
 *   · one step at a time  a second click while a step is being checked or
 *                        signed is refused (STEP_IN_FLIGHT), and a stop
 *                        pressed during the checks prevents the wallet prompt.
 *   · per-step records   every step carries its run state, prepared amount,
 *                        hashes and received amount, for the step list.
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

/** Per-step display state, kept on `state.steps[i].runState`. */
export const LOOP_STEP_STATE = Object.freeze({
  PENDING: 'pending',
  ACTIVE: 'active',
  RUNNING: 'running',
  DONE: 'done',
  BLOCKED: 'blocked',
  FAILED: 'failed',
  SKIPPED: 'skipped'
});

const RESUMABLE = new Set([
  LOOP_RUN_STATE.PAUSED,
  LOOP_RUN_STATE.PARTIAL,
  LOOP_RUN_STATE.FAILED,
  LOOP_RUN_STATE.CANCELLED
]);

const message = (error) => String(error?.message || error || '').slice(0, 240);

export function createLoopExecutionController({
  steps = [],
  simulatePlan,
  prepareStep = null,
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
  const plannedSteps = Array.isArray(steps)
    ? steps.map((step) => ({ ...step, runState: LOOP_STEP_STATE.PENDING }))
    : [];
  let stopRequested = false;
  let busy = false;
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
    stopRequested: false,
    busy: false,
    phase: null,
    endedEarly: null
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
  const patchStep = (index, patch) => state.steps.map((step, i) => (i === index ? { ...step, ...patch } : step));
  const currentStep = () => state.steps[state.stepIndex] ?? null;
  /**
   * Stop the run with a reason. `stepState` says what happened to the step
   * that was being prepared: BLOCKED (a check refused it — nothing was sent)
   * or FAILED (its transaction was sent and did not succeed).
   */
  const stopped = (code, status = LOOP_RUN_STATE.PAUSED, detail = null, stepState = LOOP_STEP_STATE.BLOCKED) => {
    const nextStatus = status === LOOP_RUN_STATE.PAUSED && state.completed.length > 0
      ? LOOP_RUN_STATE.PARTIAL
      : status;
    const current = state.steps[state.stepIndex];
    publish({
      status: nextStatus,
      error: { code, detail },
      stepSimulation: null,
      busy: false,
      phase: null,
      steps: current && current.runState !== LOOP_STEP_STATE.DONE
        ? patchStep(state.stepIndex, { runState: stepState, lastError: code })
        : state.steps,
      unwindSuggested: nextStatus === LOOP_RUN_STATE.PARTIAL && state.completed.length > 0
    });
    return { ok: false, code, detail, state: snapshot() };
  };
  /* A stop pressed while the step was being checked: cancel() already
     published the final state, so nothing is signed and nothing is re-published. */
  const aborted = () => ({ ok: false, code: 'LOOP_STOPPED', state: snapshot() });

  async function runPreflight(remaining, context) {
    let result;
    try { result = await simulatePlan(remaining, context); }
    catch (error) { result = { ok: false, status: 'unknown', reason: 'SIMULATION_FAILED', detail: message(error) }; }
    return result;
  }

  async function simulate() {
    if (typeof simulatePlan !== 'function' || state.steps.length === 0) {
      return stopped('PLAN_UNAVAILABLE', LOOP_RUN_STATE.PAUSED);
    }
    if (busy || state.status === LOOP_RUN_STATE.RUNNING) return { ok: false, code: 'STEP_IN_FLIGHT', state: snapshot() };
    busy = true;
    publish({ status: LOOP_RUN_STATE.SIMULATING, error: null, simulation: null, busy: true, phase: 'preflight' });
    try {
      const remaining = snapshot().steps.slice(state.stepIndex);
      const result = await runPreflight(remaining, { resume: state.stepIndex > 0 });
      /* Stop pressed while the checks ran: cancel() already published the
         final state; a late READY must not resurrect the run. */
      if (stopRequested) return aborted();
      if (!result?.ok || result?.provenSafe !== true) {
        return stopped(result?.reason || result?.status || 'SIMULATION_NOT_PROVEN', LOOP_RUN_STATE.PAUSED, result?.revertReason || result?.detail || null);
      }
      publish({
        status: LOOP_RUN_STATE.READY,
        simulation: result,
        error: null,
        busy: false,
        phase: null,
        steps: patchStep(state.stepIndex, { runState: LOOP_STEP_STATE.ACTIVE, lastError: null })
      });
      return { ok: true, simulation: result, state: snapshot() };
    } finally {
      busy = false;
    }
  }

  /**
   * Re-check the remaining steps after a pause, a failed step or a stop. The
   * completed steps stay completed; nothing already signed is repeated.
   */
  async function resume() {
    if (busy) return { ok: false, code: 'STEP_IN_FLIGHT', state: snapshot() };
    if (!RESUMABLE.has(state.status)) return { ok: false, code: 'LOOP_NOT_RESUMABLE', state: snapshot() };
    if (state.stepIndex >= state.steps.length) return { ok: false, code: 'LOOP_NOT_RESUMABLE', state: snapshot() };
    stopRequested = false;
    publish({ stopRequested: false, error: null, currentQuote: null, remainingSimulation: null, unwindSuggested: false });
    return simulate();
  }

  function finishEarly(code, index) {
    const nextSteps = state.steps.map((step, i) => (i >= index && step.runState !== LOOP_STEP_STATE.DONE
      ? { ...step, runState: LOOP_STEP_STATE.SKIPPED }
      : step));
    publish({
      status: LOOP_RUN_STATE.COMPLETED,
      stepIndex: state.steps.length,
      steps: nextSteps,
      currentQuote: null,
      remainingSimulation: null,
      stepSimulation: null,
      error: null,
      busy: false,
      phase: null,
      endedEarly: { code, stepIndex: index }
    });
    return { ok: true, completed: true, endedEarly: code, state: snapshot() };
  }

  async function runStep(step) {
    const index = state.stepIndex;
    const reviewing = state.status === LOOP_RUN_STATE.QUOTE_REVIEW && state.currentQuote?.stepIndex === index;

    /* 1 — resolve the concrete amount from a fresh read. Skipped while the
       user is confirming a quote for this very step: the quote was priced on
       that amount and must be signed with it. */
    if (!reviewing && typeof prepareStep === 'function') {
      publish({ busy: true, phase: 'preparing', error: null, steps: patchStep(index, { runState: LOOP_STEP_STATE.ACTIVE, lastError: null }) });
      let prepared;
      try { prepared = await prepareStep(step, snapshot()); }
      catch (error) { prepared = { ok: false, code: 'PREPARE_FAILED', detail: message(error) }; }
      if (stopRequested) return aborted();
      if (!prepared?.ok) return stopped(prepared?.code || 'PREPARE_FAILED', LOOP_RUN_STATE.PAUSED, prepared?.detail ?? null);
      if (prepared.finish) return finishEarly(prepared.code || 'NO_MORE_CAPACITY', index);
      const { ok: _ok, ...preparedFields } = prepared;
      publish({ steps: patchStep(index, { prepared: preparedFields }) });
      step = state.steps[index];
    } else {
      publish({ busy: true, phase: 'checking', error: null });
    }

    let quote = null;
    if (step.id === 'swap') {
      const quoteAge = state.currentQuote ? now() - Number(state.currentQuote.quotedAt) : Infinity;
      const reviewAge = state.currentQuote ? now() - Number(state.currentQuote.reviewedAt) : Infinity;
      const stillFresh = state.currentQuote
        && state.currentQuote.stepIndex === index
        && quoteAge >= 0 && quoteAge <= quoteMaxAgeMs
        && reviewAge >= 0 && reviewAge <= quoteMaxAgeMs;
      if (!stillFresh) {
        if (typeof getFreshQuote !== 'function') return stopped('FRESH_QUOTE_UNAVAILABLE');
        publish({ phase: 'quoting' });
        let refreshed;
        try { refreshed = await getFreshQuote(step, snapshot()); }
        catch (error) { refreshed = { ok: false, code: 'QUOTE_FAILED', detail: message(error) }; }
        if (stopRequested) return aborted();
        if (!refreshed?.ok || !refreshed.quote) return stopped(refreshed?.code || 'QUOTE_UNAVAILABLE', LOOP_RUN_STATE.PAUSED, refreshed?.detail || null);
        const quotedAt = Number(refreshed.quotedAt);
        const ageAtReview = now() - quotedAt;
        if (!Number.isFinite(quotedAt) || ageAtReview < 0 || ageAtReview > quoteMaxAgeMs) {
          return stopped('FRESH_QUOTE_EXPIRED', LOOP_RUN_STATE.PAUSED);
        }
        if (typeof simulateRemaining !== 'function') return stopped('REMAINING_PLAN_SIMULATOR_UNAVAILABLE');
        let remainingSimulation;
        try { remainingSimulation = await simulateRemaining(state.steps.slice(index), step, refreshed.quote, snapshot()); }
        catch (error) { remainingSimulation = { ok: false, status: 'unknown', detail: message(error) }; }
        if (stopRequested) return aborted();
        if (!remainingSimulation?.ok || remainingSimulation?.provenSafe !== true) {
          return stopped(remainingSimulation?.reason || remainingSimulation?.status || 'REMAINING_PLAN_SIMULATION_NOT_PROVEN', LOOP_RUN_STATE.PAUSED, remainingSimulation?.revertReason || remainingSimulation?.detail || null);
        }
        publish({
          status: LOOP_RUN_STATE.QUOTE_REVIEW,
          currentQuote: { stepIndex: index, reviewedAt: now(), quotedAt, quote: refreshed.quote, metadata: refreshed.metadata ?? null },
          remainingSimulation,
          error: null,
          busy: false,
          phase: null
        });
        return { ok: false, code: 'QUOTE_REVIEW_REQUIRED', quote: refreshed.quote, state: snapshot() };
      }
      quote = state.currentQuote.quote;
    }

    publish({ phase: 'risk' });
    let risk;
    try { risk = await readRisk?.(step, snapshot()); }
    catch (error) { risk = { ok: false, code: 'RISK_READ_FAILED', detail: message(error) }; }
    if (stopRequested) return aborted();
    if (!risk?.ok) return stopped(risk?.code || 'RISK_DATA_UNAVAILABLE', LOOP_RUN_STATE.PAUSED, risk?.detail || null);
    if (risk.floorExempt !== true) {
      const floor = risk.minHealthFactor != null && Number.isFinite(Number(risk.minHealthFactor))
        ? Number(risk.minHealthFactor)
        : Number(minHealthFactor);
      const hf = risk.healthFactor == null ? null : Number(risk.healthFactor);
      const debt = risk.debtUsd == null ? null : Number(risk.debtUsd);
      if (hf != null && (Number.isNaN(hf) || hf < floor)) {
        return stopped('HEALTH_FACTOR_BELOW_FLOOR', LOOP_RUN_STATE.PAUSED, { healthFactor: hf, minimum: floor });
      }
      if (debt != null && (!Number.isFinite(debt) || debt < 0)) {
        return stopped('RISK_DATA_UNAVAILABLE', LOOP_RUN_STATE.PAUSED);
      }
      if (hf == null && (debt == null || debt > 0)) {
        return stopped('HEALTH_FACTOR_UNAVAILABLE', LOOP_RUN_STATE.PAUSED);
      }
    }

    publish({ phase: 'simulating' });
    let simulation;
    try { simulation = await simulateStep?.(step, quote, snapshot()); }
    catch (error) { simulation = { ok: false, status: 'unknown', detail: message(error) }; }
    if (stopRequested) return aborted();
    if (!simulation?.ok || simulation?.provenSafe !== true) {
      return stopped(simulation?.reason || simulation?.status || 'STEP_SIMULATION_NOT_PROVEN', LOOP_RUN_STATE.PAUSED, simulation?.revertReason || simulation?.detail || null);
    }
    publish({
      status: LOOP_RUN_STATE.RUNNING,
      stepSimulation: simulation,
      error: null,
      phase: 'signing',
      steps: patchStep(index, { runState: LOOP_STEP_STATE.RUNNING, risk, simulation: { status: simulation.status ?? null, needsApproval: simulation.needsApproval ?? null } })
    });

    let result;
    try { result = await executeStep?.(step, quote, snapshot()); }
    catch (error) { result = { ok: false, code: 'STEP_FAILED', detail: message(error) }; }
    if (!result?.ok) {
      const hasCompleted = state.completed.length > 0;
      publish({ steps: patchStep(index, { hash: result?.hash || null, approvalHash: result?.approvalHash || null }) });
      return stopped(result?.code || 'STEP_FAILED', hasCompleted ? LOOP_RUN_STATE.PARTIAL : LOOP_RUN_STATE.FAILED, {
        stepIndex: index,
        stepId: step.id,
        detail: result?.detail || result?.message || null,
        hash: result?.hash || null
      }, LOOP_STEP_STATE.FAILED);
    }

    const executedWei = result.amountWei ?? step.prepared?.amountWei ?? step.amountWei;
    const completed = [...state.completed, {
      index,
      key: step.key ?? null,
      id: step.id,
      asset: step.asset?.symbol ?? step.symbol ?? null,
      amountWei: executedWei != null ? String(executedWei) : null,
      receivedWei: result.receivedWei != null ? String(result.receivedWei) : null,
      hash: result.hash ?? null,
      approvalHash: result.approvalHash ?? null
    }];
    const nextIndex = index + 1;
    const done = nextIndex >= state.steps.length;
    let nextSteps = patchStep(index, {
      runState: LOOP_STEP_STATE.DONE,
      hash: result.hash ?? null,
      approvalHash: result.approvalHash ?? null,
      executedWei: executedWei != null ? String(executedWei) : null,
      receivedWei: result.receivedWei != null ? String(result.receivedWei) : null,
      lastError: null
    });
    if (stopRequested && !done) {
      publish({
        status: LOOP_RUN_STATE.PARTIAL,
        stepIndex: nextIndex,
        steps: nextSteps,
        completed,
        currentQuote: null,
        stepSimulation: null,
        error: { code: 'USER_STOPPED' },
        unwindSuggested: completed.length > 0,
        stopRequested: true,
        busy: false,
        phase: null
      });
      return { ok: true, stopped: true, step, result, state: snapshot() };
    }
    if (!done) nextSteps = nextSteps.map((s, i) => (i === nextIndex ? { ...s, runState: LOOP_STEP_STATE.ACTIVE } : s));
    publish({
      status: done ? LOOP_RUN_STATE.COMPLETED : LOOP_RUN_STATE.READY,
      stepIndex: nextIndex,
      steps: nextSteps,
      completed,
      currentQuote: null,
      remainingSimulation: null,
      stepSimulation: null,
      error: null,
      busy: false,
      phase: null
    });
    return { ok: true, step, result, state: snapshot() };
  }

  async function advance({ userClicked = false } = {}) {
    if (userClicked !== true) return { ok: false, code: 'USER_CLICK_REQUIRED', state: snapshot() };
    if (stopRequested) return { ok: false, code: 'LOOP_STOPPED', state: snapshot() };
    if (busy) return { ok: false, code: 'STEP_IN_FLIGHT', state: snapshot() };
    if (![LOOP_RUN_STATE.READY, LOOP_RUN_STATE.QUOTE_REVIEW].includes(state.status)) {
      return { ok: false, code: 'LOOP_NOT_READY', state: snapshot() };
    }

    const step = currentStep();
    if (!step) {
      publish({ status: LOOP_RUN_STATE.COMPLETED, error: null });
      return { ok: true, completed: true, state: snapshot() };
    }

    busy = true;
    try {
      return await runStep(step);
    } finally {
      busy = false;
      if (state.busy) publish({ busy: false, phase: null });
    }
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
      stopRequested: true,
      busy: false,
      phase: null,
      steps: state.steps.map((step, i) => (i === state.stepIndex && step.runState === LOOP_STEP_STATE.ACTIVE
        ? { ...step, runState: LOOP_STEP_STATE.PENDING }
        : step))
    });
    return snapshot();
  }

  return {
    snapshot,
    simulate,
    advance,
    resume,
    cancel,
    currentStep,
    isBusy: () => busy
  };
}
