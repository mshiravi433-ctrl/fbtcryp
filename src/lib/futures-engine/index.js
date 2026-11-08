/**
 * FBT FUTURES ENGINE — the UI-independent core under the Futures page.
 * ---------------------------------------------------------------------------
 * Spec "FBT FUTURES ENGINE — PRODUCTION UPGRADE v3.0". The page renders;
 * this package decides. The same pure modules run in the browser, in Node
 * tests and in the server BFF (server/futures/*), so the fee a user sees and
 * the fee the ledger records come from ONE formula.
 *
 *   providers.js    §3/§4  — provider catalogue, status vocabulary, resolver
 *   venueContract.js §12   — what each venue CAN do (order types, margin
 *                            modes, liquidation model), and the per-venue
 *                            ticket validator the UI and the BFF share
 *   fees.js         §7     — Protocol + Network + FBT = Total, policies, caps
 *   risk.js         §8     — riskScore/riskLevel/liquidation distance/warnings
 *                            + account-level margin, exposure, shock and
 *                            funding-horizon maths (v2 terminal, §7/§10)
 *   router.js       §6     — venue selection on execution quality, never revenue
 *   stateMachine.js §13    — IDLE → … → COMPLETED with honest error branches
 *   errors.js       §23    — stable error codes, raw → code mapping
 *   ids.js          §16/21 — request/intent/execution ids, idempotency keys
 *   events.js       §15    — FUTURES_* event vocabulary
 *   store.js        §15    — shared browser state + event fan-out (browser only)
 *
 * store.js is NOT re-exported here so the server can import this index
 * without pulling zustand into Node.
 */

export * from './providers.js';
export * from './venueContract.js';
export * from './fees.js';
export * from './risk.js';
export * from './router.js';
export * from './stateMachine.js';
export * from './errors.js';
export * from './ids.js';
export * from './events.js';
