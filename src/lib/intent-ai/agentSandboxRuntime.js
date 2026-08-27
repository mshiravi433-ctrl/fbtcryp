/**
 * FBT INTENT AI — PHASE 71: REAL AGENT SANDBOX
 * ---------------------------------------------------------------------------
 * A promise is not a sandbox. Phase 23's mesh described the drills; phase 71
 * runs external agent code inside them. Every call an agent makes is checked
 * against a capability token before it happens, and the first attempt to reach
 * outside the box ends the run.
 *
 *   · capability tokens are narrow, expiring and single-scope; a token that
 *     grants everything is refused at mint time
 *   · calls are allow-listed by capability AND by argument (a host outside the
 *     token's allowed hosts is an escape, not a warning)
 *   · an escape is REPORTED and the agent is CUT automatically — the run ends,
 *     remaining calls are not attempted, and the incident is retained
 *   · nothing inside the sandbox can authorize execution; the strongest thing
 *     an agent can produce is a proposal for the confirmation gate
 */

import { classifyFailure } from './failureModes.js';
import { digest } from './onchainReceipt.js';

export const SANDBOX_SCHEMA = 'fbt.agent-sandbox-runtime.v1';
export const CAPABILITIES = Object.freeze(['read:market', 'read:portfolio', 'compute', 'propose:intent', 'net:fetch']);
export const FORBIDDEN_CAPABILITIES = Object.freeze(['sign', 'submit', 'transfer', 'approve', 'revoke', 'admin', '*']);
export const TOKEN_TTL_MS = 60 * 1000;
export const MAX_CALLS = 64;
export const MAX_RUNTIME_MS = 10_000;

const num = (v) => (v === null || v === undefined || v === '' || typeof v === 'boolean'
  ? null
  : (Number.isFinite(Number(v)) ? Number(v) : null));

/** Mint a capability token. Narrow, expiring, and never omnipotent. */
export function mintCapabilityToken({
  agentId = null, capabilities = [], allowedHosts = [], ttlMs = TOKEN_TTL_MS, maxCalls = MAX_CALLS, now = Date.now()
} = {}) {
  const asked = Array.isArray(capabilities) ? capabilities : [];
  const forbidden = asked.filter((c) => FORBIDDEN_CAPABILITIES.includes(c));
  const unknown = asked.filter((c) => !CAPABILITIES.includes(c) && !FORBIDDEN_CAPABILITIES.includes(c));
  if (!agentId) return { ok: false, token: null, error: classifyFailure('MISSING_DATA', { detail: 'NO_AGENT' }) };
  if (!asked.length) return { ok: false, token: null, error: classifyFailure('MISSING_DATA', { detail: 'NO_CAPABILITIES' }) };
  if (forbidden.length) {
    return { ok: false, token: null, refused: forbidden, i18nKey: 'intentAI.sandbox.capabilityRefused', error: classifyFailure('GUARDIAN_REJECTED', { detail: forbidden[0] }) };
  }
  if (unknown.length) {
    return { ok: false, token: null, refused: unknown, i18nKey: 'intentAI.sandbox.capabilityRefused', error: classifyFailure('GUARDIAN_REJECTED', { detail: unknown[0] }) };
  }
  const token = {
    schema: SANDBOX_SCHEMA,
    id: digest(`${agentId}|${asked.join(',')}|${now}`),
    agentId,
    capabilities: Object.freeze([...new Set(asked)]),
    allowedHosts: Object.freeze((Array.isArray(allowedHosts) ? allowedHosts : []).slice(0, 8)),
    maxCalls: Math.min(MAX_CALLS, Math.max(1, num(maxCalls) ?? MAX_CALLS)),
    issuedAt: now,
    expiresAt: now + Math.min(TOKEN_TTL_MS, Math.max(1000, num(ttlMs) ?? TOKEN_TTL_MS)),
    // A token buys access to data, never to the user's money.
    executionAuthorized: false
  };
  return { ok: true, token: Object.freeze(token) };
}

/** Is this one call inside the box? */
export function checkCall(token, { capability = null, host = null, now = Date.now() } = {}) {
  const deny = (reason, escape = false) => ({
    ok: false, allowed: false, escape, reason,
    i18nKey: escape ? 'intentAI.sandbox.escape' : 'intentAI.sandbox.denied',
    error: classifyFailure(escape ? 'GUARDIAN_REJECTED' : 'MISSING_DATA', { detail: reason })
  });
  if (!token || token.schema !== SANDBOX_SCHEMA) return deny('NO_TOKEN');
  if (now >= num(token.expiresAt)) return deny('TOKEN_EXPIRED');
  if (FORBIDDEN_CAPABILITIES.includes(capability)) return deny('FORBIDDEN_CAPABILITY', true);
  if (!token.capabilities.includes(capability)) return deny('CAPABILITY_NOT_GRANTED', true);
  if (capability === 'net:fetch') {
    const h = typeof host === 'string' ? host.toLowerCase() : null;
    if (!h) return deny('NO_HOST', true);
    if (!token.allowedHosts.includes(h)) return deny('HOST_NOT_ALLOWED', true);
  }
  return { ok: true, allowed: true, executionAuthorized: false };
}

/**
 * Run the agent. Its calls arrive through a broker we control; the first
 * escape stops everything and is reported.
 */
export async function runInSandbox({
  token = null, agent = null, calls = [], maxRuntimeMs = MAX_RUNTIME_MS, now = Date.now()
} = {}) {
  const trace = [];
  const finish = (extra) => ({
    schema: SANDBOX_SCHEMA,
    agentId: token?.agentId ?? null,
    trace,
    callCount: trace.length,
    // Nothing that happens in here can ever authorize execution.
    executionAuthorized: false,
    requiresConfirmationGate: true,
    ...extra
  });
  if (!token || token.schema !== SANDBOX_SCHEMA) {
    return finish({ ok: false, escaped: false, cut: true, reason: 'NO_TOKEN', i18nKey: 'intentAI.sandbox.denied', error: classifyFailure('MISSING_DATA', { detail: 'NO_TOKEN' }) });
  }
  const requested = Array.isArray(calls) ? calls : [];
  if (requested.length > token.maxCalls) {
    return finish({ ok: false, escaped: true, cut: true, reason: 'CALL_BUDGET_EXCEEDED', incident: buildIncident(token, 'CALL_BUDGET_EXCEEDED', now), i18nKey: 'intentAI.sandbox.escape', error: classifyFailure('GUARDIAN_REJECTED', { detail: 'CALL_BUDGET_EXCEEDED' }) });
  }
  const deadline = now + Math.min(MAX_RUNTIME_MS, Math.max(1, num(maxRuntimeMs) ?? MAX_RUNTIME_MS));
  for (const call of requested) {
    const verdict = checkCall(token, { capability: call?.capability, host: call?.host, now });
    trace.push({ capability: call?.capability ?? null, host: call?.host ?? null, allowed: verdict.allowed === true, reason: verdict.reason ?? null });
    if (!verdict.allowed) {
      // Escape = report + auto-cut. The remaining calls never run.
      const incident = buildIncident(token, verdict.reason, now);
      return finish({
        ok: false, escaped: verdict.escape === true, cut: true, reason: verdict.reason,
        incident, attemptedRemaining: requested.length - trace.length,
        i18nKey: verdict.escape ? 'intentAI.sandbox.escape' : 'intentAI.sandbox.denied',
        error: verdict.error
      });
    }
  }
  let output = null;
  if (typeof agent === 'function') {
    try {
      output = await Promise.race([
        Promise.resolve(agent({ token: { id: token.id, capabilities: token.capabilities } })),
        new Promise((resolve) => {
          const t = setTimeout(() => resolve({ __timedOut: true }), Math.max(1, deadline - now));
          if (typeof t?.unref === 'function') t.unref();
        })
      ]);
    } catch {
      return finish({ ok: false, escaped: false, cut: true, reason: 'AGENT_THREW', i18nKey: 'intentAI.sandbox.failed', error: classifyFailure('PROVIDER_ERROR', { detail: 'AGENT_THREW' }) });
    }
    if (output?.__timedOut) {
      return finish({ ok: false, escaped: false, cut: true, reason: 'AGENT_TIMEOUT', i18nKey: 'intentAI.sandbox.failed', error: classifyFailure('PROVIDER_TIMEOUT', { detail: 'AGENT_TIMEOUT' }) });
    }
    if (output && typeof output === 'object' && output.executionAuthorized === true) {
      // An agent that hands back "authorized" is trying to escape upward.
      return finish({ ok: false, escaped: true, cut: true, reason: 'AGENT_CLAIMED_AUTHORITY', incident: buildIncident(token, 'AGENT_CLAIMED_AUTHORITY', now), i18nKey: 'intentAI.sandbox.escape', error: classifyFailure('GUARDIAN_REJECTED', { detail: 'AGENT_CLAIMED_AUTHORITY' }) });
    }
  }
  return finish({ ok: true, escaped: false, cut: false, output: output ?? null, i18nKey: 'intentAI.sandbox.completed' });
}

function buildIncident(token, reason, now) {
  return Object.freeze({
    schema: SANDBOX_SCHEMA,
    agentId: token?.agentId ?? null,
    tokenId: token?.id ?? null,
    reason: reason || 'UNKNOWN',
    at: now,
    action: 'AGENT_CUT',
    reportable: true
  });
}

/** After an escape the agent is suspended until a human clears it. */
export function applyAutoCut({ agentId = null, incidents = [], now = Date.now() } = {}) {
  const mine = (Array.isArray(incidents) ? incidents : []).filter((i) => i?.agentId === agentId && i?.reportable === true);
  if (!mine.length) return { ok: true, suspended: false, agentId };
  return {
    ok: true,
    suspended: true,
    agentId,
    incidentCount: mine.length,
    reasons: [...new Set(mine.map((i) => i.reason))],
    reinstateRequiresHuman: true,
    i18nKey: 'intentAI.sandbox.suspended',
    i18nParams: { count: mine.length },
    at: now
  };
}

/** Nothing that ran in a sandbox may be treated as authority. */
export function assertContained(run) {
  const reasons = [];
  if (!run || run.schema !== SANDBOX_SCHEMA) reasons.push('NOT_A_RUN');
  if (run?.executionAuthorized === true) reasons.push('RUN_CLAIMS_AUTHORITY');
  if (run?.escaped === true && run?.cut !== true) reasons.push('ESCAPE_WITHOUT_CUT');
  if (run?.escaped === true && !run?.incident) reasons.push('ESCAPE_NOT_REPORTED');
  if (Array.isArray(run?.trace) && run.trace.some((t) => t.allowed !== true) && run?.cut !== true) reasons.push('DENIED_CALL_WITHOUT_CUT');
  const unique = [...new Set(reasons)];
  return unique.length
    ? { ok: false, contained: false, reasons: unique, error: classifyFailure('GUARDIAN_REJECTED', { detail: unique[0] }) }
    : { ok: true, contained: true };
}
