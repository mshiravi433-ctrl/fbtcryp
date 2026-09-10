/**
 * FBT STRATEGY BRAIN — PUBLIC SURFACE.
 * ---------------------------------------------------------------------------
 *   goalSpec.js          sentence → { capital, target, horizon, risk }
 *   ecosystemState.js    bounded fan-out read of the whole ecosystem
 *   strategyEngine.js    decide between modules, build the Portfolio Strategy
 *   strategyRuntime.js   staged execution, monitoring, revision
 *   chatBridge.js        browser binding to the app's real readers
 *
 * The first four are pure Node (no DOM, no Vite env, no wallet) so a probe can
 * run them directly. Only chatBridge touches the app.
 */

export * from './goalSpec.js';
export * from './ecosystemState.js';
export * from './strategyEngine.js';
export * from './strategyRuntime.js';
