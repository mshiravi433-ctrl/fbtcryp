/**
 * FBT INTENT AI — MULTI-AGENT ORCHESTRATOR (Phase 3)
 * ---------------------------------------------------------------------------
 * Coordinates Strategy (Agent 1) + Execution Orchestrator (Agent 2) + an
 * optional verified EXTERNAL specialist (Agent 3) with Guardian on EVERY step.
 *
 * Invariants:
 *   - Handshake is ALWAYS via the Agent Social Protocol (isCommand=false,
 *     isExecutable=false); social messages are never commands.
 *   - An external agent only ever runs behind a valid capabilityToken + an
 *     already-scoped sessionKey; it sees a handle, never a secret.
 *   - If a specialist is blocked, we REPLAN to the best remaining capability
 *     (never a Guardian bypass) — or surface the honest refusal.
 *   - REPLAN / confirmation never skips Guardian, Risk, or the Gate.
 */

import { guardianReview } from './guardian.js';
import { formulateStrategies } from './strategyAgent.js';
import { orchestrate, reviewProposal } from './executionOrchestrator.js';
import { socialMessage } from './socialProtocol.js';
import { issueSessionKey, scopeFor, revokeAllForPolicy } from './sessionKeys.js';
import {
  issueCapabilityToken, scopeCapabilityToken, revokeAllForPolicy as revokeAllCapabilitiesForPolicy
} from './capabilityToken.js';
import {
  matchAgent, assertAgentForExecute, getAgent as getDirectoryAgent, DIRECTORY_IS_SELF_REPORTED
} from './agentDirectory.js';
import { classifyFailure } from './failureModes.js';
import { audit } from './audit.js';

export const MULTIAGENT_SCHEMA = 'fbt.multi-agent.v1';

/**
 * Run the social handshake across the participating agents. All messages are
 * social (isCommand=false, isExecutable=false) by construction.
 */
export function multiAgentHandshake({ strategy, exec, external = null } = {}) {
  const msgs = [];
  if (strategy?.id) {
    msgs.push(socialMessage(strategy.id, exec?.id || '*', 'greeting', { role: strategy.role, note: 'strategy-agent-online' }));
  }
  if (exec?.id) {
    msgs.push(socialMessage(exec.id, strategy?.id || '*', 'greeting', { role: exec.role, note: 'orchestrator-online' }));
  }
  if (external?.id) {
    msgs.push(socialMessage(external.id, exec?.id, 'greeting', { role: external.role, note: 'specialist-listing-verified' }));
    msgs.push(socialMessage(exec?.id, external.id, 'request-evidence', { request: 'please-present-evidence' }));
  }
  return msgs;
}

/**
 * Orchestrate the whole Intent → Strategy → Directory.match (optional) →
 * Guardian → capabilityToken → plan flow.
 *
 * @param {object} opts
 * @param {object} opts.strategyOutput  output of formulateStrategies()
 * @param {object} opts.policy          sanitized policy
 * @param {object} [opts.ctx]           orchestrate() ctx (selectedProposalId,
 *                                      amountUsd, slippagePct, sessionStartAt,…)
 * @param {object} [opts.external]      { agentId, capabilities, chainId,
 *                                       protocol, amountUsd, request } — the
 *                                       specialist the user is engaging.
 * @param {object} [opts.session]       session (for audit)
 * @returns {object} coordinated plan / honest refusal
 */
export function coordinateMultiAgent({ strategyOutput, policy, ctx = {}, external = null, session = null } = {}) {
  if (!policy || typeof policy !== 'object') {
    return { ok: false, error: classifyFailure('MISSING_DATA', { detail: 'NO_POLICY' }), schema: MULTIAGENT_SCHEMA };
  }

  const stratId = strategyOutput?.agentId || 'fbt.strategy';
  const execId = 'fbt.exec';

  /* ---- 1. social handshake (never a command) ---- */
  const handshake = multiAgentHandshake({ strategy: { id: stratId }, exec: { id: execId } });

  /* ---- 2. Strategy → Execution Orchestrator review + plan ---- */
  const reviewed = orchestrate(strategyOutput, policy, ctx);
  if (!reviewed.ok) {
    const refusal = {
      ok: false,
      schema: MULTIAGENT_SCHEMA,
      handshake,
      reason: reviewed.guardian?.reasons || ['ORCHESTRATION_BLOCKED'],
      guardian: reviewed.guardian,
      plan: null,
      requiresConfirmation: false
    };
    if (session) audit(session, execId, 'multi-agent.blocked', { reason: refusal.reason }, 'rejected');
    return refusal;
  }

  /* ---- 3. External specialist (optional, Directory-match + capabilityToken) ---- */
  let externalBinding = null;
  let selectedExternal = null;
  let tokenResult = null;

  if (external) {
    // Determine the agent to use. If the user named a SPECIFIC agent, we verify
    // exactly that one — we never silently substitute a different, unrequested
    // specialist. If they did not name one, we pick a verified generic match.
    const requested = external.agentId ? getDirectoryAgent(external.agentId) : null;
    let agentToUse = null;
    let skipReason = null;

    if (requested) {
      const gate = assertAgentForExecute(requested, {
        chainId: external.chainId,
        protocol: external.protocol
      });
      if (gate.ok) {
        agentToUse = requested;
      } else {
        skipReason = gate.reason;
      }
    } else if (external.agentId) {
      // The user asked for a specific agent that is not in the directory.
      skipReason = 'AGENT_NOT_FOUND';
    } else {
      const matched = matchAgent({
        chainId: external.chainId || reviewed.selected?.chainId,
        protocol: external.protocol || reviewed.selected?.uses?.[0],
        capabilities: external.capabilities
      });
      if (matched.ok) agentToUse = matched.agent;
    }

    if (!agentToUse) {
      // REPLAN: specialist unavailable/blocked → fall back to the best
      // non-specialist plan. Never a Guardian bypass.
      const replanned = replayWithoutSpecialist(strategyOutput, reviewed, policy, ctx);
      if (replanned.ok) {
        if (session) audit(session, execId, 'multi-agent.external.replanned', { reason: skipReason }, 'warning');
        return {
          ok: true,
          schema: MULTIAGENT_SCHEMA,
          replanned: true,
          handshake,
          strategyOutput,
          reviewed: replanned.reviewed,
          plan: replanned.plan,
          terms: replanned.terms,
          termsHash: replanned.termsHash,
          external: { skipped: true, reason: skipReason },
          directorySelfReported: DIRECTORY_IS_SELF_REPORTED,
          requiresConfirmation: true
        };
      }
      if (session) audit(session, execId, 'multi-agent.external.blocked', { agentId: external.agentId, reason: skipReason }, 'rejected');
      return {
        ok: false,
        schema: MULTIAGENT_SCHEMA,
        handshake,
        reason: ['EXTERNAL_AGENT_NOT_VERIFIED'],
        detail: skipReason,
        guardian: reviewed.guardian,
        plan: null
      };
    }

    selectedExternal = agentToUse;

    /* ---- capability bindings ---- */
    const sessionKey = issueSessionKey({
      policyId: policy.id || 'policy',
      allowedChains: [external.chainId || reviewed.selected?.chainId],
      allowedProtocols: [external.protocol],
      maxAmountUsd: external.amountUsd || ctx.amountUsd || 0
    });
    if (!sessionKey.ok) {
      return { ok: false, schema: MULTIAGENT_SCHEMA, handshake, reason: [sessionKey.error.code], plan: null };
    }
    const scoped = scopeFor(sessionKey.sessionKey, {
      chainId: external.chainId,
      protocol: external.protocol,
      amountUsd: external.amountUsd || ctx.amountUsd || 0
    });
    if (!scoped.ok) {
      return { ok: false, schema: MULTIAGENT_SCHEMA, handshake, reason: [scoped.error.code], plan: null };
    }

    tokenResult = issueCapabilityToken({
      policyId: policy.id || 'policy',
      agentId: selectedExternal.id,
      capabilities: external.capabilities || ['quote', 'research', 'analyze'],
      allowedChains: external.allowedChains || [external.chainId || reviewed.selected?.chainId],
      allowedProtocols: external.allowedProtocols || [external.protocol],
      maxAmountUsd: external.amountUsd || ctx.amountUsd || 0
    });
    if (!tokenResult.ok) {
      return { ok: false, schema: MULTIAGENT_SCHEMA, handshake, reason: [tokenResult.error.code], plan: null };
    }
    const tokenScoped = scopeCapabilityToken(tokenResult.token, {
      chainId: external.chainId,
      protocol: external.protocol,
      amountUsd: external.amountUsd || ctx.amountUsd || 0
    });
    if (!tokenScoped.ok) {
      return { ok: false, schema: MULTIAGENT_SCHEMA, handshake, reason: [tokenScoped.error.code], plan: null };
    }

    externalBinding = {
      agentId: selectedExternal.id,
      capabilityToken: tokenResult.token,
      scopedHandle: tokenScoped.scopedHandle,
      sessionKeyScoped: scoped.ok,
      adviceOnly: true
    };
  }

  /* ---- 4. Guardian per-step (already executed for internal steps) ---- */
  const plan = reviewed.plan;
  const guardianOk = reviewed.guardian?.approved === true;

  if (session) {
    audit(session, execId, 'multi-agent.coordinated', {
      planId: plan?.planId,
      external: externalBinding ? { agentId: externalBinding.agentId } : null
    }, 'ok');
  }

  return {
    ok: guardianOk && Boolean(plan),
    schema: MULTIAGENT_SCHEMA,
    handshake,
    strategyOutput,
    reviewed,
    plan,
    terms: reviewed.terms,
    termsHash: reviewed.termsHash,
    external: externalBinding,
    capabilityToken: tokenResult?.token || null,
    tokenForbidden: tokenResult?.forbidden || [],
    requiresConfirmation: true,
    directorySelfReported: DIRECTORY_IS_SELF_REPORTED
  };
}

/**
 * Replan to the best remaining proposal that does NOT need a specialist.
 * Never a Guardian bypass: the fallback plan is still reviewed + guardian-gated.
 */
function replayWithoutSpecialist(strategyOutput, reviewed, policy, ctx) {
  const proposals = strategyOutput?.proposals;
  if (!Array.isArray(proposals) || !proposals.length) {
    return { ok: false };
  }
  const fallback = proposals
    .filter((p) => !p.requiresExternalDiscovery)
    .sort((a, b) => (b.confidence || 0) - (a.confidence || 0))
    .find((p) => reviewProposal(p, policy, ctx).every((i) => i.level !== 'block'));
  if (!fallback) return { ok: false };
  const alt = orchestrate({ ...strategyOutput, proposals: [fallback] }, policy, ctx);
  if (alt.ok) return { ok: true, reviewed: alt, plan: alt.plan, terms: alt.terms, termsHash: alt.termsHash };
  return { ok: false };
}

/** Emergency stop: revoke every session key + capability token for a policy. */
export function emergencyStopAllForPolicy(policyId, session = null) {
  const revokedKeys = revokeAllForPolicy(policyId);
  const revokedTokens = revokeAllCapabilitiesForPolicy(policyId);
  if (session) audit(session, 'guardian', 'multi-agent.emergency-stop', { revokedKeys, revokedTokens }, 'error');
  return { ok: true, revokedKeys, revokedTokens };
}
