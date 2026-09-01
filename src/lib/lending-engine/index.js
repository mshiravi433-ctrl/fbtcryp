/**
 * FBT LENDING ENGINE — the UI-independent core behind the Lending page.
 * ---------------------------------------------------------------------------
 * The production spec's §35: the engine is a standalone unit under the three
 * tabs (LEND | BORROW | MY POSITIONS). The frontend renders; this package
 * decides. New protocols and networks plug in here — the UI never changes.
 *
 *   errors.js        §14 — error taxonomy, raw→code mapping
 *   stateMachine.js  §15/§16 — transaction state machine + progress checklist
 *   health.js        §12 — configurable risk bands & position assessment
 *   networkConfig.js §5 — network registry with feature flags
 *   adapter.js       §8/§31 — protocol adapter interface + allowlist + Aave
 *   router.js        §9 — multi-protocol scoring (never APY-only)
 *   alerts.js        §22/§23 — alert rules, independent of the frontend
 *   idempotency.js   §17 — request ids, idempotency keys, duplicate guards
 *   circuitBreaker.js §27/§28 — NORMAL → DEGRADED → READ_ONLY
 *
 * Everything here is dependency-free (except adapter.js, which dynamically
 * imports ethers and src/lib/lending.js), so the same modules run in the
 * browser, in Node tests and in the server BFF.
 */

export * from './errors.js';
export * from './stateMachine.js';
export * from './health.js';
export * from './networkConfig.js';
export * from './adapter.js';
export * from './router.js';
export * from './alerts.js';
export * from './idempotency.js';
export * from './circuitBreaker.js';
