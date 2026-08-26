/**
 * FBT INTENT AI — SPECIALIST MARKETPLACE (Phase 4)
 * ---------------------------------------------------------------------------
 * A read-only directory of verified specialists, each of which can only QUOTE
 * (advice-only). Hiring is a deliberate, fully-gated action.
 *
 * Hard rules:
 *   - quote is ALWAYS advice-only, never execution, never custody.
 *   - Only `securityStatus === 'verified'` agents appear in the market.
 *   - hire REQUIRES all of: user confirm + Guardian approval + a scoped
 *     capabilityToken + a scoped sessionKey. Any missing gate → refusal.
 *   - No automaticExecution. No withdraw. No transfer. No destination change.
 *   - A hire never fabricates a receipt and never claims guaranteed profit.
 */

import { classifyFailure } from './failureModes.js';
import { isVerified } from './agentDirectory.js';
import { observedScore, MIN_OBSERVED_SAMPLE_SIZE } from './agentScore.js';

export const MARKET_SCHEMA = 'fbt.specialist-market.v1';

const FORBIDDEN_OPS = new Set(['withdraw', 'transfer', 'change_destination', 'automatic_execution', 'executeWithoutUser']);

/** List verified specialists from the directory, with honest observed scores. */
export function listSpecialists(agents = [], opts = {}) {
  return agents
    .filter((a) => isVerified(a))
    .map((a) => ({
      id: a.id,
      name: a.name || a.id,
      role: a.role,
      supportedChains: a.supportedChains,
      supportedProtocols: a.supportedProtocols,
      capabilities: a.capabilities,
      maxLeverage: a.maxLeverage,
      score: observedScore(opts.samplesFor ? opts.samplesFor(a.id) : [], opts),
      adviceOnly: true,
      verified: true
    }));
}

/**
 * Produce an advice-only quote from a specialist. Never executes.
 * @param {object} specialist  a verified specialist entry
 * @param {object} request     { chainId, protocol, amountUsd, asset }
 */
export function quote(specialist, request = {}) {
  if (!specialist || !isVerified(specialist)) {
    return { ok: false, error: classifyFailure('GUARDIAN_REJECTED', { detail: 'SPECIALIST_NOT_VERIFIED' }) };
  }
  if (FORBIDDEN_OPS.has(String(request.op || '').toLowerCase())) {
    return { ok: false, error: classifyFailure('GUARDIAN_REJECTED', { detail: 'FORBIDDEN_OP' }) };
  }
  return {
    ok: true,
    adviceOnly: true,
    quote: Object.freeze({
      schema: 'fbt.specialist-quote.v1',
      agentId: specialist.id,
      status: 'advice-only',
      chainId: request.chainId || null,
      protocol: request.protocol || null,
      amountUsd: Number(request.amountUsd) || 0,
      note: 'advice only — never an execution order',
      disclaimer: 'NOT_GUARANTEED',
      issuedAt: Date.now()
    })
  };
}

/**
 * Hire a specialist. ALL gates must pass — user confirm, Guardian, a scoped
 * capability token, and a scoped session key.
 *
 * @param {object} opts
 * @param {object} opts.specialist        the verified specialist
 * @param {object} opts.request           the advice request / plan context
 * @param {boolean} opts.userConfirmed    explicit user confirmation
 * @param {object} opts.guardianApproved  { approved:boolean }
 * @param {object} opts.capabilityTokenScoped  { ok:boolean }
 * @param {object} opts.sessionKeyScoped  { ok:boolean }
 * @param {object} [opts.session]         for audit
 */
export function hire({
  specialist,
  request = {},
  userConfirmed = false,
  guardianApproved = null,
  capabilityTokenScoped = null,
  sessionKeyScoped = null,
  session = null
} = {}) {
  if (!specialist || !isVerified(specialist)) {
    return { ok: false, error: classifyFailure('GUARDIAN_REJECTED', { detail: 'SPECIALIST_NOT_VERIFIED' }) };
  }
  if (FORBIDDEN_OPS.has(String(request.op || '').toLowerCase())) {
    return { ok: false, error: classifyFailure('GUARDIAN_REJECTED', { detail: 'FORBIDDEN_OP' }) };
  }
  if (userConfirmed !== true) {
    return { ok: false, error: classifyFailure('GATE_NOT_CONFIRMED', { detail: 'NO_USER_CONFIRM' }) };
  }
  if (!guardianApproved?.approved) {
    return { ok: false, error: classifyFailure('GUARDIAN_REJECTED', { detail: 'GUARDIAN_NOT_APPROVED' }) };
  }
  if (capabilityTokenScoped?.ok !== true) {
    return { ok: false, error: classifyFailure('GUARDIAN_REJECTED', { detail: 'CAPABILITY_TOKEN_INVALID' }) };
  }
  if (sessionKeyScoped?.ok !== true) {
    return { ok: false, error: classifyFailure('GUARDIAN_REJECTED', { detail: 'SESSION_KEY_INVALID' }) };
  }
  // An under-sampled specialist can still be hired, but only as advice-only
  // and only after the honest score is surfaced. It never auto-executes.
  return {
    ok: true,
    hired: true,
    adviceOnly: true,
    automaticExecution: false,
    agreement: Object.freeze({
      schema: 'fbt.specialist-hire.v1',
      agentId: specialist.id,
      scope: { chainId: request.chainId || null, protocol: request.protocol || null, amountUsd: Number(request.amountUsd) || 0 },
      gates: {
        userConfirmed: true,
        guardianApproved: true,
        capabilityToken: true,
        sessionKey: true
      },
      disclaimer: 'NOT_GUARANTEED',
      issuedAt: Date.now()
    })
  };
}
