/**
 * BUILD SHIM for the Base-mainnet fork probe.
 *
 * test/aave-base-fork-probe.mjs drives a real forked chain, but it cannot
 * `import '../src/lib/defi/aaveV3Base'` from plain Node: the app's modules use
 * extensionless specifiers (`'../chains'`) and `import.meta.env`, neither of
 * which Node resolves. Bundling with the same Vite resolver the app uses means
 * the probe exercises the REAL adapter — the same module the UI imports — not a
 * copy of it. That is the whole point of the probe.
 */
export {
  AAVE_V3_BASE,
  RESERVE_DATA_SHAPES,
  buildRevokePlan,
  buildSupplyPlan,
  buildWithdrawPlan,
  fromUsdcWei,
  getPosition,
  getReserveStatus,
  verifyAaveReceipt,
  verifyDeployment,
  explainRevert
} from '../src/lib/defi/aaveV3Base.js';

export {
  AAVE_BASE_SUPPLY_ENABLED,
} from '../src/lib/features.js';

export { simulateGuardedStep } from '../src/lib/defi/guardedExecution.js';
export {
  assertSignerContext,
  isTransactionReplacement,
  isTransactionTimeout,
  isUserRejection,
  waitForMinedReceipt
} from '../src/lib/defi/executionGuards.js';
