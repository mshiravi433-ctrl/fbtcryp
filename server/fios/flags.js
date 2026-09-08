/**
 * FBT FINANCIAL INTELLIGENCE OS — feature flags (§51).
 * ---------------------------------------------------------------------------
 * Read from the environment on EVERY call (not captured at import) so an
 * operator, a probe and a test can flip a flag without a redeploy, and so a
 * flag can never be "on" in a process that did not ask for it.
 *
 * A disabled flag is an honest refusal (`FEATURE_DISABLED`). It is never a
 * fake success and it is never a way to hide a broken feature: `/api/ai/health`
 * reports the flag state AND the last real result of the subsystem, so a red
 * subsystem behind a green flag is still visible.
 */

export const FI_FLAG_NAMES = Object.freeze([
  'FINANCIAL_WORLD_MODEL_ENABLED',
  'RESEARCH_ENGINE_ENABLED',
  'STRATEGY_COMPETITION_ENABLED',
  'SIMULATION_ENGINE_ENABLED',
  'DECISION_ENGINE_ENABLED',
  'CROSS_CHAIN_REASONER_ENABLED',
  'AUTONOMOUS_POLICY_ENABLED',
  'LEARNING_ENGINE_ENABLED',
  'PROACTIVE_GUARDIAN_ENABLED'
]);

/** Defaults: everything is ON except autonomous execution, which is opt-in. */
const DEFAULTS = Object.freeze({
  FINANCIAL_WORLD_MODEL_ENABLED: true,
  RESEARCH_ENGINE_ENABLED: true,
  STRATEGY_COMPETITION_ENABLED: true,
  SIMULATION_ENGINE_ENABLED: true,
  DECISION_ENGINE_ENABLED: true,
  CROSS_CHAIN_REASONER_ENABLED: true,
  AUTONOMOUS_POLICY_ENABLED: false,
  LEARNING_ENGINE_ENABLED: true,
  PROACTIVE_GUARDIAN_ENABLED: true
});

const FALSEY = new Set(['0', 'false', 'no', 'off', 'disabled']);
const TRUTHY = new Set(['1', 'true', 'yes', 'on', 'enabled']);

export function fiFlag(name) {
  const key = String(name || '').toUpperCase();
  if (!FI_FLAG_NAMES.includes(key)) return false;
  const raw = process.env[key];
  if (raw === undefined || raw === null || String(raw).trim() === '') return DEFAULTS[key] === true;
  const v = String(raw).trim().toLowerCase();
  if (FALSEY.has(v)) return false;
  if (TRUTHY.has(v)) return true;
  return DEFAULTS[key] === true;
}

export function fiFlags() {
  return Object.fromEntries(FI_FLAG_NAMES.map((n) => [n, fiFlag(n)]));
}

/** Gate helper: `{ ok:false, code:'FEATURE_DISABLED' }` instead of a guess. */
export function requireFlag(name) {
  return fiFlag(name)
    ? { ok: true, flag: String(name).toUpperCase() }
    : { ok: false, code: 'FEATURE_DISABLED', flag: String(name).toUpperCase(), detail: `${name} is off; refusing instead of faking a result` };
}
