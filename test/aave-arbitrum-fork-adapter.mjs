/**
 * BUILD SHIM for the Arbitrum-mainnet fork probe.
 *
 * test/aave-arbitrum-fork-probe.mjs drives a real forked chain, but it cannot
 * `import '../src/lib/defi/aaveV3Arbitrum'` from plain Node: the app's modules use
 * extensionless specifiers (`'../chains'`) and `import.meta.env`, neither of
 * which Node resolves. Bundling with the same Vite resolver the app uses means
 * the probe exercises the REAL adapter — the same module the UI imports — not a
 * copy of it. That is the whole point of the probe.
 */
export {
  AAVE_V3_ARBITRUM,
  RESERVE_DATA_SHAPES,
  buildRevokePlan,
  buildSupplyPlan,
  buildWithdrawPlan,
  fromUsdcWei,
  getPosition,
  getReserveStatus,
  verifyDeployment,
  explainRevert
} from '../src/lib/defi/aaveV3Arbitrum.js';

export {
  AAVE_ARB_SUPPLY_ENABLED,
  AAVE_ARB_SUPPLY_MAX_USDC_PER_TX,
  AAVE_ARB_SUPPLY_MAX_USDC_TOTAL
} from '../src/lib/features.js';
