/**
 * FBT CENTRAL INTELLIGENCE OS — boot.
 * ---------------------------------------------------------------------------
 * Single Brain / Multiple Modules / Shared State / Unified Actions /
 * Verified Execution.
 *
 *   installCentralOS()  — registers every module adapter (§10/§11) and wires
 *                         the event-driven refresh loop (§15/§16/§17).
 *   centralRouter       — the one gateway the frontend talks to (§36/§37).
 *
 * Idempotent: importing twice (tests + server) installs once.
 */
import { installAdapters } from './adapters.js';
import { subscribe } from './eventBus.js';
import { assembleState } from './stateStore.js';
import { CENTRAL_OS_VERSION } from './constants.js';

let installed = false;

export function installCentralOS() {
  if (installed) return { installed: false, already: true, version: CENTRAL_OS_VERSION };
  installAdapters();

  /*
   * §15/§16 — event-driven brain: any domain completion event carrying an
   * owner forces a state rebuild for that session, so no module keeps
   * showing stale data after an execution — including events published by
   * code paths OUTSIDE the pipeline (e.g. the cross-chain store confirming
   * a transfer later).
   */
  const REFRESH_EVENTS = [
    'SWAP_COMPLETED', 'BRIDGE_COMPLETED', 'TRANSACTION_CONFIRMED',
    'LOAN_CREATED', 'LOAN_REPAID', 'BALANCE_CHANGED', 'POSITION_CHANGED',
    'GOAL_PROGRESS_CHANGED'
  ];
  for (const type of REFRESH_EVENTS) {
    subscribe(type, (event) => {
      const owner = event?.payload?.owner;
      if (owner) assembleState(owner, { force: true }).catch(() => {});
    });
  }

  installed = true;
  return { installed: true, version: CENTRAL_OS_VERSION };
}

export { centralRouter } from './router.js';
export { publish, subscribe, recentEvents } from './eventBus.js';
export { getModule, listModules, moduleCoverage, featureCompleteness } from './registry.js';
export { assembleState, ingestClientData } from './stateStore.js';
export { capabilityReport } from './capabilities.js';
export { runTool } from './toolRouter.js';
export { handleIntent, getIntent, confirmIntent, cancelIntent } from './pipeline.js';
export { classifyError, withRetryFallback } from './errorEngine.js';
export { CENTRAL_OS_VERSION };
