/**
 * FBT INTENT AI — AGENT DIRECTORY (Phase 3)
 * ---------------------------------------------------------------------------
 * Discovery + validation for internal and external agents. The directory is an
 * authority ONLY for "is this agent allowed on the execution path": a listing
 * is self-reported metadata and is NEVER itself trust. Only an agent whose
 * `securityStatus === 'verified'` (and, when a certificate exists, an ACTIVE
 * certificate) may take part in an execution path. Everything else is
 * discoverable but "unverified → never execute".
 *
 * Hard rules:
 *   - unverified agents are listed but CANNOT be matched for execution.
 *   - A listing never carries FORBIDDEN_AGENT_KEYS (from externalAgentSecurity).
 *   - `verified` is not the same as "trusted with funds": every step still
 *     goes through Guardian + a scoped capability token.
 */

import { verifyExternalAgent, FORBIDDEN_AGENT_KEYS } from '../externalAgentSecurity.js';

/* In-memory directory of registered agents (self-reported metadata). */
const registry = new Map();

function sanitize(agent) {
  if (!agent || typeof agent !== 'object') return null;
  const forbidden = FORBIDDEN_AGENT_KEYS.filter((k) => agent[k] !== undefined);
  if (forbidden.length) return { error: `FORBIDDEN_AGENT_KEYS:${forbidden.join(',')}` };
  return {
    id: String(agent.id || '').slice(0, 64),
    name: String(agent.name || agent.id || '').slice(0, 80),
    role: String(agent.role || 'external').toLowerCase().slice(0, 32),
    securityStatus: String(agent.securityStatus || 'unknown').toLowerCase(),
    supportedChains: Array.isArray(agent.supportedChains) ? agent.supportedChains.map(Number).filter(Number.isInteger) : [],
    supportedProtocols: Array.isArray(agent.supportedProtocols) ? agent.supportedProtocols.map(String).map((s) => s.toLowerCase()) : [],
    capabilities: Array.isArray(agent.capabilities) ? agent.capabilities.map(String).map((s) => s.toLowerCase()) : [],
    maxLeverage: Number(agent.maxLeverage) || 1,
    certificate: agent.certificate || null,
    selfReported: true,
    listingOnly: true,
    registeredAt: Date.now()
  };
}

export function registerAgent(agent) {
  const s = sanitize(agent);
  if (!s) return { ok: false, error: 'INVALID_AGENT' };
  if (s.error) return { ok: false, error: s.error };
  if (!s.id) return { ok: false, error: 'MISSING_AGENT_ID' };
  registry.set(s.id, s);
  return { ok: true, agent: { ...s } };
}

/** Internal agents are registered with a `verified` status by construction. */
export function registerInternalAgent(agent) {
  return registerAgent({ ...agent, securityStatus: 'verified' });
}

export function deregisterAgent(id) {
  return registry.delete(String(id));
}

export function getAgent(id) {
  const a = registry.get(String(id));
  return a ? { ...a } : null;
}

export function listAgents() {
  return [...registry.values()].map((a) => ({ ...a }));
}

/** True when the agent may be used on an execution path. */
export function isVerified(agent) {
  if (!agent) return false;
  const status = String(agent.securityStatus || '').toLowerCase();
  if (status !== 'verified') return false;
  if (agent.certificate) {
    const cert = String(agent.certificate.status || agent.certificate || '').toLowerCase();
    if (cert && cert !== 'active') return false;
  }
  return true;
}

/**
 * Match an agent for an execution path. Uses `verifyExternalAgent` as the
 * authority check (verified status + chains/protocols/leverage) and then the
 * directory's own verified gate. Fail-closed: unverified → never matched.
 *
 * @param {object} request  { chainId, protocol, leverage, capabilities }
 * @returns {{ok:boolean, agent?:object, reason?:string}}
 */
export function matchAgent(request = {}) {
  const candidates = [...registry.values()]
    .filter((a) => isVerified(a))
    .filter((a) => !request.chainId || !a.supportedChains.length || a.supportedChains.includes(Number(request.chainId)))
    .filter((a) => !request.protocol || !a.supportedProtocols.length || a.supportedProtocols.includes(String(request.protocol).toLowerCase()));
  if (!candidates.length) return { ok: false, reason: 'NO_VERIFIED_AGENT_MATCH' };
  if (request.capabilities && Array.isArray(request.capabilities)) {
    const ranked = candidates.find((a) => request.capabilities.every((c) => a.capabilities.includes(String(c).toLowerCase())));
    if (ranked) return { ok: true, agent: { ...ranked }, agentId: ranked.id };
  }
  return { ok: true, agent: { ...candidates[0] }, agentId: candidates[0].id };
}

export function assertAgentForExecute(agent, request = {}) {
  if (!agent) return { ok: false, reason: 'NO_AGENT' };
  const verified = isVerified(agent);
  if (!verified) return { ok: false, reason: 'AGENT_NOT_VERIFIED' };
  const review = verifyExternalAgent(agent, request);
  if (!review.ok) return { ok: false, reason: review.failures.join(',') };
  return { ok: true };
}

/** The directory's listing is self-reported, not authority — expose this. */
export const DIRECTORY_IS_SELF_REPORTED = true;

export function _resetAgentDirectory() {
  registry.clear();
}
