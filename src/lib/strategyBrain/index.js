/**
 * FBT STRATEGY BRAIN — PUBLIC SURFACE.
 * ---------------------------------------------------------------------------
 *   goalSpec.js          sentence → { capital, target, horizon, risk }
 *   ecosystemState.js    bounded fan-out read of the whole ecosystem
 *   strategyEngine.js    decide between modules, build the Portfolio Strategy
 *   strategyRuntime.js   staged execution, monitoring, revision
 *   strategyStore.js     keep a plan and its stage truth across reloads
 *   chatBridge.js        browser binding to the app's real readers
 *
 * The first five are pure Node (no DOM, no Vite env, no wallet) so a probe can
 * run them directly; strategyStore takes an injected store instead of reaching
 * for localStorage itself. Only chatBridge touches the app.
 */

export * from './goalSpec.js';
export * from './ecosystemState.js';
export * from './strategyEngine.js';
export * from './strategyRuntime.js';
export * from './strategyStore.js';
