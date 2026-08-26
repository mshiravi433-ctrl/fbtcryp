/**
 * FBT INTENT AI — Agent Challenge and Council.
 *
 * The council is a bounded decision aid. It never signs, executes or replaces
 * Guardian/Risk. It makes disagreements explicit and uses deterministic
 * precedence: REJECT > REVISE > APPROVE.
 */

export const COUNCIL_SCHEMA = 'fbt.intent-agent-council.v1';
export const CHALLENGE_SCHEMA = 'fbt.intent-agent-challenge.v1';

export const COUNCIL_ROLES = Object.freeze([
  'research',
  'strategy',
  'risk',
  'liquidity',
  'market',
  'fee',
  'portfolio',
  'hedge',
  'guardian',
  'execution',
  'exit',
  'auditor'
]);

const DECISIONS = new Set(['APPROVE', 'REJECT', 'REVISE']);
const bounded = (value) => {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 && n <= 100 ? n : null;
};

function challengeRows(strategy, context = {}) {
  const rows = [];
  const amount = Number(context.amountUsd ?? strategy?.amountUsd);
  const liquidity = Number(context.liquidityUsd ?? strategy?.liquidityUsd);
  const slippage = Number(context.slippagePct ?? strategy?.slippagePct);
  const maxSlippage = Number(context.maxSlippagePct ?? 1);
  const leverage = Number(strategy?.leverage ?? context.leverage ?? 1);
  const maxLeverage = Number(context.maxLeverage ?? 5);

  if (Array.isArray(context.unavailableCapabilities)) {
    for (const id of context.unavailableCapabilities.slice(0, 12)) {
      if (Array.isArray(strategy?.uses) && strategy.uses.includes(id)) {
        rows.push({ code: 'REQUIRED_CAPABILITY_UNAVAILABLE', capability: id, severity: 'block', message: `${id} is required but not operational.` });
      }
    }
  }
  if (Number.isFinite(amount) && Number.isFinite(liquidity) && liquidity < amount * 2) {
    rows.push({ code: 'LIQUIDITY_INSUFFICIENT', severity: 'revise', message: 'Available liquidity does not provide the required buffer for this amount.' });
  }
  if (Number.isFinite(slippage) && slippage > maxSlippage) {
    rows.push({ code: 'SLIPPAGE_ABOVE_POLICY', severity: 'block', message: 'Estimated slippage exceeds the current policy limit.' });
  }
  if (Number.isFinite(leverage) && leverage > maxLeverage) {
    rows.push({ code: 'LEVERAGE_ABOVE_POLICY', severity: 'block', message: 'Requested leverage exceeds the current policy limit.' });
  }
  if (context.eventRisk === 'high') {
    rows.push({ code: 'EVENT_RISK_HIGH', severity: 'revise', message: 'A high-risk event is active; confidence and route assumptions need review.' });
  }
  if (context.evidenceComplete === false) {
    rows.push({ code: 'EVIDENCE_INCOMPLETE', severity: 'revise', message: 'The proposal lacks enough evidence for an unconditional approval.' });
  }
  return rows;
}

/** Agent 2's independent challenge of Agent 1's proposal. */
export function challengeStrategy(strategy, context = {}) {
  if (!strategy || typeof strategy !== 'object') {
    return { ok: false, schema: CHALLENGE_SCHEMA, code: 'STRATEGY_REQUIRED' };
  }
  const challenges = challengeRows(strategy, context);
  const decision = challenges.some((row) => row.severity === 'block')
    ? 'REVISE'
    : challenges.length ? 'REVISE' : 'APPROVE';
  return {
    ok: true,
    schema: CHALLENGE_SCHEMA,
    challenger: 'fbt.execution',
    proposalId: strategy.id || null,
    decision,
    challenged: challenges.length > 0,
    disagreements: challenges,
    independent: true,
    blindAgreement: false,
    canExecute: false,
    nextAction: decision === 'APPROVE' ? 'continue-to-risk-and-gate' : 'recalculate-before-authorization'
  };
}

function normalizeVote(role, input, proposal, context) {
  const requested = typeof input === 'string' ? input.toUpperCase() : input?.decision;
  const decision = DECISIONS.has(requested) ? requested : null;
  const confidence = bounded(typeof input === 'object' ? input.confidence : null);
  if (decision) {
    return {
      role,
      decision,
      confidence,
      reason: typeof input === 'object' && typeof input.reason === 'string'
        ? input.reason.slice(0, 240)
        : 'Explicit bounded council vote.',
      evidence: Array.isArray(input?.evidence) ? input.evidence.slice(0, 8) : []
    };
  }
  if (role === 'guardian' && context.guardianApproved === false) {
    return { role, decision: 'REJECT', confidence: 100, reason: 'Guardian rejected the proposal.', evidence: [] };
  }
  if (role === 'risk' && context.riskDecision === 'block') {
    return { role, decision: 'REJECT', confidence: 100, reason: 'Risk engine blocked the proposal.', evidence: [] };
  }
  const challenge = challengeStrategy(proposal, context);
  return {
    role,
    decision: challenge.decision === 'APPROVE' ? 'APPROVE' : 'REVISE',
    confidence: challenge.decision === 'APPROVE' ? 70 : 85,
    reason: challenge.decision === 'APPROVE' ? 'No deterministic challenge was found.' : challenge.disagreements[0]?.message || 'Proposal needs revision.',
    evidence: challenge.disagreements.map((row) => row.code)
  };
}

/**
 * Run a council with explicit votes or deterministic role checks. The caller
 * can use this for high-value/high-risk sessions before Confirmation Gate.
 */
export function runAgentCouncil({
  proposal,
  votes = {},
  context = {},
  roles = COUNCIL_ROLES,
  highValue = false,
  highRisk = false
} = {}) {
  if (!proposal || typeof proposal !== 'object') return { ok: false, schema: COUNCIL_SCHEMA, code: 'PROPOSAL_REQUIRED' };
  const selectedRoles = [...new Set((Array.isArray(roles) ? roles : COUNCIL_ROLES).filter((role) => COUNCIL_ROLES.includes(role)))];
  const activeRoles = selectedRoles.length ? selectedRoles : [...COUNCIL_ROLES];
  const rows = activeRoles.map((role) => normalizeVote(role, votes[role], proposal, context));
  const guardian = rows.find((row) => row.role === 'guardian');
  const risk = rows.find((row) => row.role === 'risk');
  const decision = guardian?.decision === 'REJECT' || risk?.decision === 'REJECT'
    || rows.some((row) => row.decision === 'REJECT')
    ? 'REJECT'
    : rows.some((row) => row.decision === 'REVISE')
      ? 'REVISE'
      : 'APPROVE';

  return {
    ok: true,
    schema: COUNCIL_SCHEMA,
    proposalId: proposal.id || null,
    trigger: { highValue: highValue === true, highRisk: highRisk === true },
    votes: rows,
    decision,
    counts: {
      approve: rows.filter((row) => row.decision === 'APPROVE').length,
      revise: rows.filter((row) => row.decision === 'REVISE').length,
      reject: rows.filter((row) => row.decision === 'REJECT').length
    },
    guardianIndependent: true,
    guardianApproved: guardian?.decision === 'APPROVE',
    replacesGuardian: false,
    replacesRisk: false,
    canExecute: false,
    requiresUserAuthorization: true,
    rationale: decision === 'APPROVE'
      ? 'All participating roles found no blocking issue.'
      : decision === 'REVISE'
        ? 'At least one role identified a material issue that must be recalculated.'
        : 'At least one safety role rejected the proposal.'
  };
}

export function councilDecisionAllowsReview(council) {
  return Boolean(council?.ok && council.decision === 'APPROVE' && council.guardianApproved === true && council.canExecute === false);
}
