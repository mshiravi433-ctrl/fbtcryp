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
 *
 * DEFAULT POLICY (owner decision, Phase 212): EVERY engine ships ON — the
 * deep-intelligence wave (macro graph, why engine, agent council, personal
 * profile, evaluation loop, wallet context, event replanning, conversation
 * state, goal scenarios, opportunity fit, goal reasoning, agent runtime ops)
 * and the autonomous policy loop. Autonomy remains *permissioned*: a policy
 * the user wrote with numbers is still the only standing authority, every
 * transaction still ends at the user's wallet signature, and
 * `INTENT_AI_FLAGS_OFF=1` can still disable the whole deep layer at once for
 * an operator who needs a minimal deployment.
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
  'PROACTIVE_GUARDIAN_ENABLED',
  /* Phase 212 — Deep Intelligence (مغز تصمیم‌گیری). */
  'MACRO_GRAPH_ENABLED',
  'WHY_ENGINE_ENABLED',
  'AGENT_COUNCIL_ENABLED',
  'PERSONAL_PROFILE_ENABLED',
  'EVALUATION_LOOP_ENABLED',
  'WALLET_CONTEXT_ENABLED',
  'EVENT_REPLANNING_ENABLED',
  'CONVERSATION_STATE_ENABLED',
  'GOAL_SCENARIOS_ENABLED',
  'OPPORTUNITY_FIT_ENABLED',
  'GOAL_REASONING_ENABLED',
  'AGENT_RUNTIME_OPS_ENABLED',
  /* Phase 214 — Cross-Chain Route Intelligence. */
  'ROUTE_INTELLIGENCE_ENABLED',
  /* Phase 215 — Traditional assets (RWA/stocks/forex/commodities) in the
     decision engine. */
  'TRADITIONAL_ASSETS_ENABLED',
  /* Phase 216 — the pending lending adapters (compound-v3, morpho,
     solana-lending) surfaced through the FI. */
  'LENDING_ADAPTERS_ENABLED'
]);

/** Defaults: everything is ON. Autonomy is ON and stays PERMISSIONED — the
 *  policy engine's numeric limits, the guardian and the wallet signature are
 *  the boundary, not the flag. */
const DEFAULTS = Object.freeze({
  FINANCIAL_WORLD_MODEL_ENABLED: true,
  RESEARCH_ENGINE_ENABLED: true,
  STRATEGY_COMPETITION_ENABLED: true,
  SIMULATION_ENGINE_ENABLED: true,
  DECISION_ENGINE_ENABLED: true,
  CROSS_CHAIN_REASONER_ENABLED: true,
  AUTONOMOUS_POLICY_ENABLED: true,
  LEARNING_ENGINE_ENABLED: true,
  PROACTIVE_GUARDIAN_ENABLED: true,
  MACRO_GRAPH_ENABLED: true,
  WHY_ENGINE_ENABLED: true,
  AGENT_COUNCIL_ENABLED: true,
  PERSONAL_PROFILE_ENABLED: true,
  EVALUATION_LOOP_ENABLED: true,
  WALLET_CONTEXT_ENABLED: true,
  EVENT_REPLANNING_ENABLED: true,
  CONVERSATION_STATE_ENABLED: true,
  GOAL_SCENARIOS_ENABLED: true,
  OPPORTUNITY_FIT_ENABLED: true,
  GOAL_REASONING_ENABLED: true,
  AGENT_RUNTIME_OPS_ENABLED: true,
  ROUTE_INTELLIGENCE_ENABLED: true,
  TRADITIONAL_ASSETS_ENABLED: true,
  LENDING_ADAPTERS_ENABLED: true
});

const FALSEY = new Set(['0', 'false', 'no', 'off', 'disabled']);
const TRUTHY = new Set(['1', 'true', 'yes', 'on', 'enabled']);

/** Master switch for an operator who wants the pre-212 minimal surface back:
 *  `INTENT_AI_FLAGS_OFF=1` turns every engine flag off in one move (the env
 *  flag of a single engine still wins, so a surgical probe stays possible). */
export function fiFlagsMasterOff(env = process.env) {
  return String(env.INTENT_AI_FLAGS_OFF || '').trim().toLowerCase() === '1';
}

export function fiFlag(name, env = process.env) {
  const key = String(name || '').toUpperCase();
  if (!FI_FLAG_NAMES.includes(key)) return false;
  if (fiFlagsMasterOff(env) && String(env[key] || '').trim() === '') return false;
  const raw = env[key];
  if (raw === undefined || raw === null || String(raw).trim() === '') return DEFAULTS[key] === true;
  const v = String(raw).trim().toLowerCase();
  if (FALSEY.has(v)) return false;
  if (TRUTHY.has(v)) return true;
  return DEFAULTS[key] === true;
}

export function fiFlags(env = process.env) {
  return Object.fromEntries(FI_FLAG_NAMES.map((n) => [n, fiFlag(n, env)]));
}

/** Gate helper: `{ ok:false, code:'FEATURE_DISABLED' }` instead of a guess. */
export function requireFlag(name, env = process.env) {
  return fiFlag(name, env)
    ? { ok: true, flag: String(name).toUpperCase() }
    : { ok: false, code: 'FEATURE_DISABLED', flag: String(name).toUpperCase(), detail: `${name} is off; refusing instead of faking a result` };
}
