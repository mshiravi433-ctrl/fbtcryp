/**
 * BUILD SHIM for the Compound V3 Base-mainnet fork probe.
 *
 * test/compound-base-fork-probe.mjs drives a real forked chain, but it cannot
 * `import '../src/lib/defi/compoundV3Base'` from plain Node: the app's modules
 * use extensionless specifiers (`'../chains'`) and `import.meta.env`, neither
 * of which Node resolves. Bundling with the same Vite resolver the app uses
 * means the probe exercises the REAL adapter — the same module the UI imports —
 * not a copy of it. That is the whole point of the probe.
 */
export {
  COMPOUND_V3_BASE,
  buildRevokePlan,
  buildSupplyPlan,
  buildWithdrawPlan,
  explainRevert,
  fromUsdcWei,
  getMarketStatus,
  getPosition,
  getRewardsOwed,
  perSecondRateToAprPct,
  perSecondRateToApyPct,
  verifyDeployment
} from '../src/lib/defi/compoundV3Base.js';

export {
  COMPOUND_BASE_SUPPLY_ENABLED,
  COMPOUND_BASE_SUPPLY_MAX_USDC_PER_TX,
  COMPOUND_BASE_SUPPLY_MAX_USDC_TOTAL
} from '../src/lib/features.js';
