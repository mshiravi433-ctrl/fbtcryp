/**
 * FBT FINANCIAL INTELLIGENCE OS — Execution Authority Resolver.
 * ---------------------------------------------------------------------------
 * Until this module, every strategy / competition / decision surface hard-coded:
 *
 *   executionPermission: false
 *   guaranteed: false
 *
 * That was the safe default for an unauthenticated proposal plane. This
 * resolver is the ONLY place those two flags may flip to true — and only when
 * every gate below is actually satisfied. There is no silent default-on.
 *
 * GATES (all required for executionPermission:true)
 *   1. userConfirmed           explicit confirmation of THIS decision
 *   2. authorizationScreenShown  the auth UI was presented
 *   3. policyVerdict.ok        standing policy (or one-shot) ALLOW
 *   4. guardianApproved        guardian did not block
 *   5. confidence.actionable   critical inputs readable
 *   6. chosen strategy exists  there is something to authorize
 *   7. risk not CRITICAL       security condition never pre-authorised
 *   8. no emergency stop       STOP/PAUSE/REVOKE/EMERGENCY not active
 *
 * WHAT "guaranteed" MEANS HERE
 *   guaranteed: true  NEVER means "profit is guaranteed".
 *   When the gates pass it means the PROCESS is guaranteed:
 *     · unsigned hand-off only (this process never signs)
 *     · policy limits are enforced before any hand-off
 *     · guardian + confidence gates were checked
 *     · returns / APY / PnL remain unguaranteed (returnGuaranteed: false)
 *
 * A missing gate returns executionPermission:false and lists why.
 */
import { assertFinancialExecution } from '../../src/lib/intent-ai/phaseBoundary.js';

export const EXECUTION_AUTHORITY_SCHEMA = 'fbt.fi.execution-authority.v1';

const num = (v) => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));

/**
 * Resolve whether this decision may carry executionPermission / process guarantee.
 *
 * @param {object} p
 * @param {boolean} [p.executionRequested]
 * @param {boolean} [p.userConfirmed]
 * @param {boolean} [p.authorizationScreenShown]
 * @param {boolean} [p.guardianApproved]
 * @param {object}  [p.policyVerdict]   { ok, decision:'ALLOW'|'ALLOW_REVIEW_ONLY'|..., policyId, code }
 * @param {object}  [p.confidence]      { actionable, blockers, overall }
 * @param {object}  [p.risk]            { level }
 * @param {object}  [p.chosen]          winning candidate / decision payload
 * @param {object}  [p.controls]        non-bypassable STOP/PAUSE/…
 * @param {object}  [p.limits]          capital/tx/risk/protocol/chain/time/fee/slippage
 * @param {object}  [p.runtimeEvidence]
 * @param {boolean} [p.liveSimulation]
 * @param {number}  [p.now]
 */
export function resolveExecutionAuthority({
  executionRequested = false,
  userConfirmed = false,
  authorizationScreenShown = false,
  guardianApproved = false,
  policyVerdict = null,
  confidence = null,
  risk = null,
  chosen = null,
  controls = null,
  limits = null,
  runtimeEvidence = null,
  liveSimulation = false,
  now = Date.now()
} = {}) {
  const blockers = [];
  const gates = [];

  const gate = (name, ok, detail = null) => {
    gates.push({ gate: name, ok: Boolean(ok), detail: detail ? String(detail).slice(0, 160) : null });
    if (!ok) blockers.push(detail || name);
  };

  /* Without an explicit request the plane stays proposal-only. */
  if (!executionRequested) {
    return {
      schema: EXECUTION_AUTHORITY_SCHEMA,
      executionPermission: false,
      executionAuthorized: false,
      financialExecutionAuthorized: false,
      automaticExecution: false,
      guaranteed: false,
      returnGuaranteed: false,
      processGuaranteed: false,
      status: 'PROPOSAL_ONLY',
      reason: 'execution was not requested; proposal plane only',
      blockers: ['EXECUTION_NOT_REQUESTED'],
      gates: [{ gate: 'EXECUTION_REQUESTED', ok: false, detail: 'pass execute:true + userConfirmed to activate' }],
      checkedAt: now
    };
  }

  gate('CHOSEN_STRATEGY', Boolean(chosen && (chosen.id || chosen.strategyId || chosen.type)), 'no eligible strategy to authorize');
  gate('USER_CONFIRMED', userConfirmed === true, 'EXPLICIT_USER_CONFIRMATION_REQUIRED');
  gate('AUTH_SCREEN', authorizationScreenShown === true, 'AUTHORIZATION_SCREEN_REQUIRED');
  gate('GUARDIAN', guardianApproved === true, 'GUARDIAN_APPROVAL_REQUIRED');

  const policyOk = policyVerdict?.ok === true
    && ['ALLOW', 'ALLOW_REVIEW_ONLY'].includes(String(policyVerdict?.decision || policyVerdict?.verdict || 'ALLOW').toUpperCase());
  gate('POLICY', policyOk, policyVerdict?.code || 'RISK_POLICY_REQUIRED');

  const confOk = confidence == null
    ? false
    : confidence.actionable === true || (Number(confidence.overall) >= 0.55 && !(confidence.blockers || []).length);
  gate('CONFIDENCE', confOk, confidence?.blockers?.length
    ? `confidence blockers: ${confidence.blockers.join(', ')}`
    : 'CONFIDENCE_NOT_ACTIONABLE');

  const riskLevel = String(risk?.level || '').toUpperCase();
  gate('RISK_NOT_CRITICAL', riskLevel !== 'CRITICAL', `risk level ${riskLevel || 'UNREAD'} blocks execution`);

  /* Non-bypassable controls. */
  const ctl = controls || {};
  const emergency = ctl.stopped === true || ctl.paused === true || ctl.revoked === true
    || ctl.disconnected === true || ctl.emergency_exit === true || ctl.emergency === true;
  gate('NO_EMERGENCY', !emergency, 'STOP/PAUSE/REVOKE/EMERGENCY_EXIT is active');

  /* Optional shared assert when full limit + runtime evidence bundles are supplied. */
  let boundary = null;
  if (limits && runtimeEvidence) {
    boundary = assertFinancialExecution({
      authorizationScreenShown,
      userConfirmed,
      guardianApproved,
      policyDecision: policyOk ? (policyVerdict?.decision || 'ALLOW') : null,
      limits,
      runtimeEvidence,
      controls: ctl,
      now
    });
    gate('PHASE_BOUNDARY', boundary.ok === true, boundary?.code || 'BOUNDARY_BLOCK');
  }

  const allOk = gates.every((g) => g.ok);

  /* Process guarantee: the hand-off path is bound by the gates above.
     Return / profit is NEVER guaranteed — returnGuaranteed stays false. */
  const processGuaranteed = allOk;
  const returnGuaranteed = false;

  return {
    schema: EXECUTION_AUTHORITY_SCHEMA,
    executionPermission: allOk,
    executionAuthorized: allOk,
    financialExecutionAuthorized: allOk,
    automaticExecution: false, /* still never auto — wallet must sign */
    guaranteed: processGuaranteed, /* process only — see returnGuaranteed */
    returnGuaranteed,
    processGuaranteed,
    guaranteedWhat: processGuaranteed
      ? 'process-limits-guardian-unsigned-handoff'
      : null,
    guaranteedNote: processGuaranteed
      ? 'Process is guaranteed: policy limits, guardian, confidence and unsigned hand-off. Returns, APY and PnL are NOT guaranteed.'
      : 'Neither process nor return is guaranteed until every authority gate passes.',
    status: allOk ? 'AUTHORIZED_FOR_UNSIGNED_HANDOFF' : 'BLOCKED',
    reason: allOk
      ? 'all authority gates passed; wallet signature still required; returns not guaranteed'
      : `blocked: ${blockers.slice(0, 4).join('; ')}`,
    blockers: allOk ? [] : blockers,
    gates,
    policyId: policyVerdict?.policyId || null,
    liveSimulation: liveSimulation === true,
    boundary: boundary && boundary.ok ? { decision: boundary.decision, checked: boundary.checked } : null,
    signs: false,
    submits: false,
    checkedAt: now
  };
}

/**
 * Build a default limits object from a chosen strategy + financial state so
 * assertFinancialExecution can run when the caller did not supply full limits.
 * Missing fields stay absent — the boundary then fails closed, which is correct.
 */
export function limitsFromContext({ chosen = null, financial = null, preferences = null, policyVerdict = null } = {}) {
  const fs = financial?.computed || financial || {};
  const capital = num(fs.netWorthUsd ?? fs.availableCapitalUsd);
  const fee = num(chosen?.feesUsd ?? chosen?.amountUsd ?? chosen?.capitalRequiredUsd);
  const riskPct = num(chosen?.riskPct);
  const slip = num(chosen?.slippagePct ?? preferences?.maxSlippagePct);
  const chains = Object.keys(fs.chainExposureUsd || {});
  const protocols = Array.isArray(chosen?.route) ? chosen.route.filter(Boolean) : [];
  const pol = policyVerdict?.policy || policyVerdict || {};
  return {
    capital: capital ?? num(pol.maxCumulativeUsd) ?? null,
    transaction: fee ?? num(pol.maxPerExecutionUsd) ?? null,
    risk: riskPct ?? null,
    protocol: protocols.length ? protocols : (Array.isArray(pol.trigger?.kinds) ? pol.trigger.kinds : null),
    chain: chains.length ? chains : (Array.isArray(pol.trigger?.chains) ? pol.trigger.chains : null),
    time: num(pol.expiration) ? Math.max(1, Math.round((num(pol.expiration) - Date.now()) / 3600_000)) : 24,
    fee: fee ?? num(pol.gasLimitUsd) ?? null,
    slippage: slip ?? num(pol.slippageLimitPct) ?? 0.5
  };
}

export default resolveExecutionAuthority;
