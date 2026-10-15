import { useCallback, useEffect, useRef, useState } from 'react';
import { createLoopExecutionController, LOOP_RUN_STATE } from '../../lib/loopExecution.js';
import { createLoopRuntime } from '../../lib/loopRuntime.js';
import { LOOP_MIN_HEALTH_FACTOR } from '../../lib/loopMath.js';

/** Swap quotes older than this are re-fetched (and re-reviewed) before signing. */
export const LOOP_QUOTE_MAX_AGE_MS = 15_000;

const FINISHED = new Set([LOOP_RUN_STATE.COMPLETED, LOOP_RUN_STATE.CANCELLED]);

/**
 * One loop run = one frozen plan + one controller + one runtime.
 *
 * The plan is frozen at "Prepare": the page keeps refreshing the market after
 * every confirmed step, and the live projection would otherwise re-plan on top
 * of the position the run itself just changed. The run walks the plan the user
 * reviewed; every amount inside it is still re-resolved from fresh reads.
 */
export function useLoopRun({ deps, chainId, wallet, swapFeeBps = 70, onStepResult = null } = {}) {
  const controllerRef = useRef(null);
  const [run, setRun] = useState(null);
  const [runPlan, setRunPlan] = useState(null);
  const [runContext, setRunContext] = useState(null);
  const stepResultRef = useRef(onStepResult);
  stepResultRef.current = onStepResult;

  const reset = useCallback(() => {
    if (controllerRef.current?.isBusy?.()) return false;
    controllerRef.current = null;
    setRun(null);
    setRunPlan(null);
    setRunContext(null);
    return true;
  }, []);

  /* A run belongs to one wallet on one chain. If either changes while no
     step is in flight, the run is discarded rather than pointed elsewhere. */
  useEffect(() => {
    if (!runContext) return;
    if (Number(runContext.chainId) !== Number(chainId)
      || String(runContext.wallet || '').toLowerCase() !== String(wallet || '').toLowerCase()) {
      reset();
    }
  }, [chainId, wallet, runContext, reset]);

  const start = useCallback(async (plan) => {
    if (!deps || !plan?.ok || !wallet || controllerRef.current?.isBusy?.()) return null;
    let runtime;
    try {
      runtime = createLoopRuntime({ deps, chainId, wallet, plan, swapFeeBps });
    } catch {
      return null;
    }
    const controller = createLoopExecutionController({
      steps: plan.steps,
      simulatePlan: runtime.simulatePlan,
      prepareStep: runtime.prepareStep,
      simulateStep: runtime.simulateStep,
      readRisk: runtime.readRisk,
      getFreshQuote: runtime.getFreshQuote,
      simulateRemaining: runtime.simulateRemaining,
      executeStep: runtime.executeStep,
      minHealthFactor: LOOP_MIN_HEALTH_FACTOR,
      quoteMaxAgeMs: LOOP_QUOTE_MAX_AGE_MS,
      onChange: (snapshot) => {
        if (controllerRef.current === controller) setRun(snapshot);
      }
    });
    controllerRef.current = controller;
    setRunPlan(plan);
    setRunContext({ chainId, wallet });
    setRun(controller.snapshot());
    return controller.simulate();
  }, [deps, chainId, wallet, swapFeeBps]);

  const advance = useCallback(async () => {
    const controller = controllerRef.current;
    if (!controller) return null;
    const before = controller.snapshot();
    const step = before.steps[before.stepIndex] ?? null;
    const result = await controller.advance({ userClicked: true });
    if (controllerRef.current !== controller) return result;
    if (result?.ok && result.step && result.result) {
      stepResultRef.current?.({ ok: true, step: result.state?.steps?.[before.stepIndex] ?? result.step, result: result.result });
    } else if (result && !result.ok && result.state?.error?.detail?.stepId && step) {
      /* Only failures of a SENT step reach the page's history; a refused
         check never opened the wallet and is not a transaction. */
      stepResultRef.current?.({
        ok: false,
        step: result.state.steps?.[before.stepIndex] ?? step,
        code: result.code,
        result: { hash: result.state.error.detail.hash ?? null }
      });
    }
    return result;
  }, []);

  const stop = useCallback(() => controllerRef.current?.cancel() ?? null, []);
  const resume = useCallback(async () => controllerRef.current?.resume() ?? null, []);

  const busy = Boolean(run?.busy) || run?.status === LOOP_RUN_STATE.SIMULATING || run?.status === LOOP_RUN_STATE.RUNNING;
  const active = Boolean(run) && !FINISHED.has(run.status);

  return { run, runPlan, start, advance, stop, resume, reset, busy, active };
}
