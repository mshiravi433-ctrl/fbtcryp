/**
 * FBT Insurance OS — entry point.
 *
 * Mount in server/app.js:
 *   app.use('/api/insurance', insuranceRouter());
 */
export { insuranceRouter } from './router.js';
export { default } from './router.js';
export { InsuranceAggregator, InsuranceProviderRouter, CoverageGapEngine, ProtectionScore, ProtectionProfile, JurisdictionEligibilityEngine, ClaimFraudEngine } from './marketplace.js';
export { ProtectionPoolAccounting, PoolSolvencyEngine, POOL_STATUS, POOL_SAFETY_LIMITS, poolEnabled } from './pool.js';
