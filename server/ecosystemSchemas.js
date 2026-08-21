/** Pure validation for Phase 2 resources. Deliberately rejects authority-bearing claims. */
const ID = /^[a-z0-9][a-z0-9._-]{1,63}$/;
const chains = (v) => Array.isArray(v) && v.length <= 64 && v.every((x) => Number.isInteger(Number(x)) && Number(x) > 0);
export function validateAgent(input = {}) {
  if (!input || input.schema !== 'fbt.agent.v1' || !ID.test(String(input.id || ''))) return { ok: false, code: 'INVALID_AGENT' };
  const p = input.permissions || {};
  if (p.withdrawFunds === true || p.executeWithoutUser === true) return { ok: false, code: 'FORBIDDEN_PERMISSION' };
  if (!chains(input.supportedChains || [])) return { ok: false, code: 'INVALID_CHAINS' };
  if (!['manual', 'simulation-only'].includes(input.executionMode)) return { ok: false, code: 'INVALID_EXECUTION_MODE' };
  return { ok: true, value: { ...input, permissions: { ...p, executeWithoutUser: false, withdrawFunds: false } } };
}
export function validateStrategy(input = {}) {
  if (!input || input.schema !== 'fbt.strategy.v1' || !ID.test(String(input.id || ''))) return { ok: false, code: 'INVALID_STRATEGY' };
  const policy = input.policy || {};
  if (input.action?.automaticExecution === true) return { ok: false, code: 'AUTOMATIC_EXECUTION_FORBIDDEN' };
  if (!Number.isFinite(Number(policy.maxAmountUsd)) || Number(policy.maxAmountUsd) <= 0) return { ok: false, code: 'MAX_AMOUNT_REQUIRED' };
  if (!Number.isFinite(Number(policy.maxSlippageBps)) || Number(policy.maxSlippageBps) < 0) return { ok: false, code: 'MAX_SLIPPAGE_REQUIRED' };
  if (!chains(policy.allowedChains || [])) return { ok: false, code: 'ALLOWED_CHAINS_REQUIRED' };
  return { ok: true, value: { ...input, action: { ...(input.action || {}), type: 'create_intent', automaticExecution: false }, policy: { ...policy, requiresUserApproval: true } } };
}
/*
 * Liquidity providers are listed, never trusted. This phase has no RFQ
 * settlement and no custody, so a listing that claims to hold user funds,
 * settle them, or quote without a user in the loop is rejected outright rather
 * than stored with a caveat nobody reads.
 */
export function validateLiquidityProvider(input = {}) {
  if (!input || input.schema !== 'fbt.liquidity-provider.v1' || !ID.test(String(input.id || ''))) return { ok: false, code: 'INVALID_LIQUIDITY_PROVIDER' };
  const c = input.capabilities || {};
  if (c.custody === true || c.settlesUserFunds === true || c.autoQuote === true) return { ok: false, code: 'FORBIDDEN_CAPABILITY' };
  if (!chains(input.supportedChains || [])) return { ok: false, code: 'INVALID_CHAINS' };
  return { ok: true, value: { ...input, capabilities: { ...c, custody: false, settlesUserFunds: false, autoQuote: false }, rfqSettlement: 'unavailable' } };
}
export function validateIntentGraph(graph = {}) {
  if (graph.schema !== 'fbt.intent-graph.v1' || !Array.isArray(graph.nodes) || !Array.isArray(graph.edges)) return { ok: false, code: 'INVALID_GRAPH' };
  if (graph.nodes.length > 24 || graph.edges.length > 48 || Number(graph.constraints?.maxDepth || 8) > 8) return { ok: false, code: 'GRAPH_LIMIT_EXCEEDED' };
  const edges = new Map(graph.nodes.map((n) => [n.id, []]));
  for (const e of graph.edges) { if (!edges.has(e.from) || !edges.has(e.to)) return { ok: false, code: 'UNKNOWN_GRAPH_NODE' }; edges.get(e.from).push(e.to); }
  const visiting = new Set(); const done = new Set();
  const visit = (id, depth = 0) => { if (depth > 8 || visiting.has(id)) return false; if (done.has(id)) return true; visiting.add(id); for (const next of edges.get(id) || []) if (!visit(next, depth + 1)) return false; visiting.delete(id); done.add(id); return true; };
  for (const id of edges.keys()) if (!visit(id)) return { ok: false, code: 'CYCLIC_GRAPH' };
  return { ok: true, value: { ...graph, status: 'validated' } };
}
