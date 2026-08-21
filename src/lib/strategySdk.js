/** fbt.strategy-sdk.v1: a bounded client-side builder. It can draft and simulate, never sign or execute. */
export const STRATEGY_SDK_SCHEMA = 'fbt.strategy-sdk.v1';
const id = (value) => /^[a-z0-9][a-z0-9._-]{1,63}$/.test(String(value || ''));
export function createStrategy({ id: strategyId, projectId = null, name = {}, description = {} } = {}) {
  if (!id(strategyId)) throw new Error('INVALID_STRATEGY_ID');
  return { schema: 'fbt.strategy.v1', id: strategyId, projectId, name, description, trigger: null, policy: { maxAmountUsd: null, maxSlippageBps: null, allowedChains: [], allowedAssets: [], quietHours: null, requiresUserApproval: true }, action: { type: 'create_intent', automaticExecution: false }, status: 'draft', evidence: [], limitations: ['Client-side draft only', 'No signer or automatic execution'] };
}
export function defineTrigger(strategy, trigger) {
  if (!['price', 'time', 'portfolio_drift', 'gas'].includes(trigger?.type) || !trigger.expression) throw new Error('INVALID_TRIGGER');
  return { ...strategy, trigger: { ...trigger, evaluatedBy: trigger.evaluatedBy === 'server_observer' ? 'server_observer' : 'client' } };
}
export function definePolicy(strategy, policy) {
  const amount = Number(policy?.maxAmountUsd); const slip = Number(policy?.maxSlippageBps);
  if (!Number.isFinite(amount) || amount <= 0 || !Number.isFinite(slip) || slip < 0 || !Array.isArray(policy.allowedChains) || !policy.allowedChains.length) throw new Error('INVALID_POLICY');
  return { ...strategy, policy: { ...policy, maxAmountUsd: amount, maxSlippageBps: slip, requiresUserApproval: true }, action: { type: 'create_intent', automaticExecution: false } };
}
export function simulate(strategy, sampleInput = {}) { return { schema: 'fbt.intent-simulation.v1', status: 'simulation_only', strategyId: strategy?.id || null, input: sampleInput, execution: 'unavailable', userApprovalRequired: true }; }
export function getReceipt() { return { status: 'not_available', receipt: null }; }
