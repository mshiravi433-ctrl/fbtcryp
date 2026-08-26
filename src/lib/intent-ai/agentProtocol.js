/**
 * FBT INTENT AI — Spec 65 items 51, 53, 57: FBT Agent Protocol envelope,
 * passport completeness gate, and the Multi-Agent Chain.
 *
 * The envelope standardizes every agent interaction: Agent ID, Capabilities,
 * Permissions, Intent, Risk, Fee, Input, Output, Status, Reputation,
 * Expiration. An envelope backed by an incomplete passport is non-executable.
 * The chain User → Goal → Research → Strategy → (External?) → Risk → Guardian
 * → Execution → Exit lets ANY link halt the flow, and NO link can sign.
 */

import { bounded, containsRawSecret, fail, finite, noExecutionPermission, safeId, safeString } from './phaseBoundary.js';
import { sanitizeExternalAgentPassport } from './externalAgentTrust.js';
import { SPECIALIST_ROLES } from './specialistAgents.js';

export const AGENT_PROTOCOL_SCHEMA = 'fbt.agent-protocol.v1';
export const AGENT_CHAIN_SCHEMA = 'fbt.intent-agent-chain.v1';

export const ENVELOPE_FIELDS = Object.freeze([
  'agentId', 'capabilities', 'permissions', 'intent', 'risk', 'fee', 'input', 'output', 'status', 'reputation', 'expiration'
]);

export const CHAIN_LINKS = Object.freeze([
  'user', 'goal', 'research', 'strategy', 'external-specialist', 'risk', 'guardian', 'execution', 'exit'
]);

/**
 * Build a protocol envelope. For external agents the passport must sanitize
 * cleanly — an incomplete passport marks the envelope non-executable rather
 * than being padded with defaults.
 */
export function createAgentEnvelope({
  agentId = null,
  agent = null,
  externalPassport = null,
  capabilities = [],
  permissions = [],
  intent = null,
  risk = null,
  fee = null,
  input = null,
  output = null,
  status = 'draft',
  reputation = null,
  expiration = null,
  now = Date.now()
} = {}) {
  if (containsRawSecret({ agentId, capabilities, permissions, intent, risk, fee, input, output, reputation, expiration })) {
    return fail('RAW_CREDENTIAL_FORBIDDEN');
  }
  const id = safeId(agentId) || safeString(String(agentId || ''), 80);
  if (!id) return fail('AGENT_ID_REQUIRED');
  const passport = externalPassport ? sanitizeExternalAgentPassport(externalPassport, { now, source: 'protocol-envelope' }) : null;
  // "Complete" per spec item 53: sanitized passport + verified identity +
  // at least one capability. An unverified/empty passport is incomplete and
  // the envelope becomes non-executable — nothing is padded with defaults.
  const passportComplete = externalPassport
    ? Boolean(passport?.ok)
      && passport.passport?.securityStatus === 'verified'
      && (Array.isArray(passport.passport?.capabilities) ? passport.passport.capabilities.length : 0) > 0
    : null;
  const missing = !passportComplete && externalPassport ? [passport?.ok ? 'PASSPORT_UNVERIFIED_OR_EMPTY' : (passport?.code || 'PASSPORT_INCOMPLETE')] : [];
  const expiresAt = expiration === null ? null : finite(expiration);
  const expired = expiresAt !== null && now >= expiresAt;
  return noExecutionPermission({
    ok: true,
    schema: AGENT_PROTOCOL_SCHEMA,
    envelope: {
      agentId: id,
      capabilities: (Array.isArray(capabilities) ? capabilities : []).slice(0, 24).map((row) => safeString(String(row), 64)).filter(Boolean),
      permissions: (Array.isArray(permissions) ? permissions : []).slice(0, 24).map((row) => safeString(String(row), 64)).filter(Boolean),
      intent: safeId(intent?.id) || safeId(intent) || null,
      risk: risk && typeof risk === 'object' ? { level: safeString(String(risk.level || ''), 24) || null, bounded: bounded(risk.score) } : null,
      fee: fee && typeof fee === 'object' ? { serviceUsd: finite(fee.serviceUsd), performancePct: finite(fee.performancePct), networkUsd: finite(fee.networkUsd) } : null,
      input: input && typeof input === 'object' ? Object.keys(input).slice(0, 24) : null,
      output: output && typeof output === 'object' ? Object.keys(output).slice(0, 24) : null,
      status: safeString(String(status), 32) || 'draft',
      reputation: reputation && typeof reputation === 'object'
        ? { compositeStatus: safeString(String(reputation.compositeStatus || ''), 24) || null, compositeScore: bounded(reputation.compositeScore) }
        : null,
      expiration: expiresAt,
      expired
    },
    passportComplete,
    passportMissing: missing,
    incompletePassportNonExecutable: passportComplete === false,
    executable: false,
    signsTransactions: false,
    createdAt: now
  });
}

/**
 * Spec 65 item 57 — build the chain for a goal. Every link carries a halt
 * authority and none carries a signing authority. The external link is the
 * only conditional one.
 */
export function buildAgentChain({ goalId = null, externalNeeded = false, now = Date.now() } = {}) {
  if (containsRawSecret({ goalId })) return fail('RAW_CREDENTIAL_FORBIDDEN');
  const goal = safeId(goalId) || safeString(String(goalId || ''), 80);
  if (!goal) return fail('GOAL_ID_REQUIRED');
  const links = CHAIN_LINKS
    .filter((link) => link !== 'external-specialist' || externalNeeded === true)
    .map((link) => ({
      link,
      role: SPECIALIST_ROLES.includes(link === 'external-specialist' ? 'research' : link) ? link : (link === 'goal' || link === 'user' ? 'human' : null),
      canHalt: true,
      canSign: false,
      canExecute: link === 'execution' ? false : false,
      note: link === 'execution'
        ? 'Execution prepares plans only; signing stays with the user through the authorization screen.'
        : 'Any link may halt the chain; no link signs.'
    }));
  return noExecutionPermission({
    ok: true,
    schema: AGENT_CHAIN_SCHEMA,
    goalId: goal,
    links,
    anyLinkCanHalt: true,
    noLinkSigns: true,
    guardianLinkIndependent: true,
    builtAt: now
  });
}

/**
 * Advance the chain one link. A link blocks when its check returns a blocking
 * decision; the chain then halts with the blocking link named. Nothing in the
 * chain produces a signature or an execution grant.
 */
export function advanceAgentChain(chain, { toLink = null, checkResult = null, now = Date.now() } = {}) {
  if (!chain || chain.schema !== AGENT_CHAIN_SCHEMA) return fail('BAD_AGENT_CHAIN');
  const target = safeString(String(toLink || ''), 32);
  const link = (chain.links || []).find((row) => row.link === target);
  if (!link) return fail('LINK_NOT_IN_CHAIN', target);
  const blocked = checkResult && typeof checkResult === 'object'
    && (checkResult.decision === 'BLOCK' || checkResult.block === true || checkResult.ok === false);
  return noExecutionPermission({
    ok: !blocked,
    schema: AGENT_CHAIN_SCHEMA,
    haltedAt: blocked ? target : null,
    advancedTo: blocked ? null : target,
    blockedBy: blocked ? (safeString(String(checkResult.code || ''), 64) || 'LINK_BLOCKED') : null,
    noLinkSigns: true,
    executionAuthorized: false,
    advancedAt: now
  });
}
