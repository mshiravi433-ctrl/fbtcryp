/**
 * FBT INTENT AI — PHASE 96: COMMUNITY PARAMETER GOVERNANCE
 * ---------------------------------------------------------------------------
 * Ownership is not democracy — and a vote is not a licence to remove a safety
 * proof. Phase 96 lets the community propose and vote on POLICY PARAMETERS
 * (ceilings, fee) inside bounds that the vote itself cannot move.
 *
 *   · only parameters on a closed, bounded list are governable; anything else
 *     is refused by name, not silently ignored
 *   · the non-negotiables — Guardian, the Confirmation Gate, simulation before
 *     signing, Emergency Stop, the phase-50 launch rules — are not parameters
 *     and cannot appear in a proposal at any majority
 *   · a passing vote produces an APPROVED proposal, never a live change: the
 *     phase-50 program control still has to allow it, exactly as before
 *   · one voter, one vote, counted once; quorum and threshold are checked
 *     against real ballots, not claimed totals
 */

import { classifyFailure } from './failureModes.js';
import { digest } from './onchainReceipt.js';
import { FEE_BPS_MAX } from '../feeBps.js';

export const PARAM_GOVERNANCE_SCHEMA = 'fbt.param-governance.v1';
export const PROPOSAL_STATES = Object.freeze(['draft', 'voting', 'approved', 'rejected', 'expired', 'refused']);
export const VOTE_CHOICES = Object.freeze(['for', 'against', 'abstain']);
export const VOTING_PERIOD_MS = 7 * 24 * 60 * 60 * 1000;
export const QUORUM_VOTES = 25;
export const APPROVAL_THRESHOLD = 0.6;

/**
 * The complete list of governable parameters, each with a hard floor and
 * ceiling. A vote moves a value INSIDE this range; it can never widen it.
 */
export const GOVERNED_PARAMETERS = Object.freeze({
  feeBps: Object.freeze({ min: 0, max: FEE_BPS_MAX, unit: 'bps' }),
  maxPerTransactionUsd: Object.freeze({ min: 10, max: 5_000, unit: 'usd' }),
  maxTotalInputUsd: Object.freeze({ min: 100, max: 400_000, unit: 'usd' }),
  maxSlippageBps: Object.freeze({ min: 10, max: 300, unit: 'bps' }),
  goalDurationDaysMax: Object.freeze({ min: 1, max: 30, unit: 'days' }),
  queueTtlMinutes: Object.freeze({ min: 1, max: 60, unit: 'minutes' })
});

/**
 * Things a vote may never touch. These are proofs, not preferences: they are
 * listed so the refusal is explicit and can be tested, rather than depending
 * on their absence from the allow-list.
 */
export const NON_GOVERNABLE = Object.freeze([
  'guardianEnabled',
  'confirmationGateRequired',
  'simulationBeforeSign',
  'emergencyStopEnabled',
  'sessionKeyRevocation',
  'launchFreeze',
  'programControl',
  'phase50Rules',
  'failClosed',
  'receiptHonesty',
  'walletSignatureRequired'
]);

const num = (v) => (v === null || v === undefined || v === '' || typeof v === 'boolean'
  ? null
  : (Number.isFinite(Number(v)) ? Number(v) : null));

const id = (v) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, 64) : null);

/** Is this key something the community is even allowed to have an opinion on? */
export function parameterIsGovernable(parameter) {
  const key = String(parameter || '');
  if (NON_GOVERNABLE.includes(key)) return { governable: false, reason: 'SECURITY_PROOF_NOT_A_PARAMETER' };
  if (!Object.prototype.hasOwnProperty.call(GOVERNED_PARAMETERS, key)) return { governable: false, reason: 'UNKNOWN_PARAMETER' };
  return { governable: true, reason: null, bounds: GOVERNED_PARAMETERS[key] };
}

/** Raise a proposal. A refused proposal says exactly why. */
export function proposeParameterChange({
  parameter = null,
  proposedValue = null,
  currentValue = null,
  proposerId = null,
  rationale = null,
  now = Date.now()
} = {}) {
  const who = id(proposerId);
  if (!who) {
    return { ok: false, state: 'refused', i18nKey: 'intentAI.governance.proposalRefused', error: classifyFailure('MISSING_DATA', { detail: 'NO_PROPOSER' }) };
  }
  const check = parameterIsGovernable(parameter);
  if (!check.governable) {
    return {
      ok: false,
      state: 'refused',
      parameter: String(parameter || ''),
      reason: check.reason,
      // A security proof is not up for a vote, at any majority.
      i18nKey: check.reason === 'SECURITY_PROOF_NOT_A_PARAMETER'
        ? 'intentAI.governance.notVotable'
        : 'intentAI.governance.unknownParameter',
      error: classifyFailure('GUARDIAN_REJECTED', { detail: check.reason })
    };
  }
  const value = num(proposedValue);
  if (value === null) {
    return { ok: false, state: 'refused', i18nKey: 'intentAI.governance.proposalRefused', error: classifyFailure('MISSING_DATA', { detail: 'NO_VALUE' }) };
  }
  const bounds = check.bounds;
  if (value < bounds.min || value > bounds.max) {
    // The bounds themselves are not governable; a proposal outside them dies here.
    return {
      ok: false,
      state: 'refused',
      parameter,
      bounds,
      reason: 'OUT_OF_BOUNDS',
      i18nKey: 'intentAI.governance.outOfBounds',
      i18nParams: { min: bounds.min, max: bounds.max },
      error: classifyFailure('GUARDIAN_REJECTED', { detail: 'OUT_OF_BOUNDS' })
    };
  }
  const proposal = {
    id: `gp_${digest({ parameter, value, who, now }).slice(2, 16)}`,
    schema: PARAM_GOVERNANCE_SCHEMA,
    parameter: String(parameter),
    proposedValue: value,
    currentValue: num(currentValue),
    bounds,
    proposerId: who,
    rationale: typeof rationale === 'string' ? rationale.slice(0, 280) : null,
    state: 'voting',
    openedAt: now,
    closesAt: now + VOTING_PERIOD_MS,
    // A proposal is a request. It is never, by itself, a change.
    applied: false,
    executionAuthorized: false,
    removesSecurityProof: false
  };
  return {
    ok: true,
    schema: PARAM_GOVERNANCE_SCHEMA,
    proposal: Object.freeze(proposal),
    i18nKey: 'intentAI.governance.proposalOpen',
    i18nParams: { parameter: proposal.parameter, value }
  };
}

/** One voter, one vote. A second ballot replaces the first, never adds to it. */
export function castParameterVote({ proposal = null, votes = [], voterId = null, choice = null, now = Date.now() } = {}) {
  const who = id(voterId);
  const rows = Array.isArray(votes) ? votes : [];
  if (!proposal || proposal.state !== 'voting') {
    return { ok: false, votes: rows, i18nKey: 'intentAI.governance.votingClosed', error: classifyFailure('MISSING_DATA', { detail: 'NOT_OPEN' }) };
  }
  if (now > num(proposal.closesAt)) {
    return { ok: false, votes: rows, i18nKey: 'intentAI.governance.votingClosed', error: classifyFailure('DEADLINE_PASSED', { detail: 'VOTING_CLOSED' }) };
  }
  if (!who) {
    return { ok: false, votes: rows, i18nKey: 'intentAI.governance.voteRefused', error: classifyFailure('MISSING_DATA', { detail: 'NO_VOTER' }) };
  }
  if (!VOTE_CHOICES.includes(choice)) {
    return { ok: false, votes: rows, i18nKey: 'intentAI.governance.voteRefused', error: classifyFailure('MISSING_DATA', { detail: 'BAD_CHOICE' }) };
  }
  const next = rows.filter((v) => v?.voterId !== who);
  next.push(Object.freeze({ voterId: who, choice, at: now, proposalId: proposal.id }));
  return {
    ok: true,
    schema: PARAM_GOVERNANCE_SCHEMA,
    votes: next,
    replaced: next.length === rows.length,
    i18nKey: 'intentAI.governance.voteRecorded',
    i18nParams: { count: next.length }
  };
}

/** Count real ballots. Quorum and threshold are measured, never asserted. */
export function tallyParameterVotes({ proposal = null, votes = [], now = Date.now() } = {}) {
  const rows = (Array.isArray(votes) ? votes : []).filter((v) => id(v?.voterId) && VOTE_CHOICES.includes(v?.choice));
  const seen = new Set();
  const counted = [];
  for (const v of rows) {
    if (seen.has(v.voterId)) continue;
    seen.add(v.voterId);
    counted.push(v);
  }
  const forVotes = counted.filter((v) => v.choice === 'for').length;
  const againstVotes = counted.filter((v) => v.choice === 'against').length;
  const abstain = counted.filter((v) => v.choice === 'abstain').length;
  const decisive = forVotes + againstVotes;
  const quorumMet = counted.length >= QUORUM_VOTES;
  const share = decisive > 0 ? forVotes / decisive : 0;
  const closed = proposal ? now > num(proposal.closesAt) : false;
  const passed = quorumMet && closed && share >= APPROVAL_THRESHOLD;
  let state = 'voting';
  if (closed) state = passed ? 'approved' : (quorumMet ? 'rejected' : 'expired');
  return {
    ok: true,
    schema: PARAM_GOVERNANCE_SCHEMA,
    proposalId: proposal?.id ?? null,
    for: forVotes,
    against: againstVotes,
    abstain,
    counted: counted.length,
    duplicatesDropped: rows.length - counted.length,
    quorum: QUORUM_VOTES,
    quorumMet,
    approvalShare: Math.round(share * 1000) / 1000,
    threshold: APPROVAL_THRESHOLD,
    closed,
    passed,
    state,
    // Passing a vote is not applying a change; phase 50 still decides.
    applied: false,
    i18nKey: closed
      ? (passed ? 'intentAI.governance.approved' : 'intentAI.governance.rejected')
      : 'intentAI.governance.votingOpen',
    i18nParams: { for: forVotes, against: againstVotes, counted: counted.length },
    at: now
  };
}

/**
 * Apply an approved change — only if the phase-50 program control allows it.
 * A vote never overrides the launch rules; it queues a change behind them.
 */
export function applyParameterChange({ proposal = null, tally = null, programControl = null, now = Date.now() } = {}) {
  if (!proposal || !tally) {
    return { ok: false, applied: false, i18nKey: 'intentAI.governance.applyRefused', error: classifyFailure('MISSING_DATA', { detail: 'NO_PROPOSAL' }) };
  }
  if (tally.passed !== true) {
    return { ok: false, applied: false, reason: 'NOT_APPROVED', i18nKey: 'intentAI.governance.applyRefused', error: classifyFailure('GUARDIAN_REJECTED', { detail: 'NOT_APPROVED' }) };
  }
  const check = parameterIsGovernable(proposal.parameter);
  if (!check.governable) {
    return { ok: false, applied: false, reason: check.reason, i18nKey: 'intentAI.governance.notVotable', error: classifyFailure('GUARDIAN_REJECTED', { detail: check.reason }) };
  }
  const value = num(proposal.proposedValue);
  if (value === null || value < check.bounds.min || value > check.bounds.max) {
    return { ok: false, applied: false, reason: 'OUT_OF_BOUNDS', i18nKey: 'intentAI.governance.outOfBounds', error: classifyFailure('GUARDIAN_REJECTED', { detail: 'OUT_OF_BOUNDS' }) };
  }
  if (programControl?.launchAllowed !== true) {
    /*
     * Phase 50 stays exactly where it was: a community vote can decide WHAT
     * changes, never WHETHER the program control opens.
     */
    return {
      ok: false,
      applied: false,
      reason: 'PROGRAM_CONTROL_BLOCKED',
      blockers: Array.isArray(programControl?.blockers) ? [...programControl.blockers] : [],
      i18nKey: 'intentAI.governance.blockedByProgramControl',
      error: classifyFailure('GUARDIAN_REJECTED', { detail: 'PROGRAM_CONTROL_BLOCKED' })
    };
  }
  return {
    ok: true,
    schema: PARAM_GOVERNANCE_SCHEMA,
    applied: true,
    parameter: proposal.parameter,
    value,
    previousValue: num(proposal.currentValue),
    securityProofsIntact: true,
    i18nKey: 'intentAI.governance.applied',
    i18nParams: { parameter: proposal.parameter, value },
    at: now
  };
}

/** No vote, no majority, no outcome may take a security proof away. */
export function assertProofsIntact({ proposal = null, tally = null, application = null, proofs = null } = {}) {
  const reasons = [];
  if (proposal) {
    if (NON_GOVERNABLE.includes(String(proposal.parameter))) reasons.push('PROPOSAL_TARGETS_SECURITY_PROOF');
    if (proposal.removesSecurityProof === true) reasons.push('PROPOSAL_REMOVES_PROOF');
    if (proposal.executionAuthorized === true) reasons.push('PROPOSAL_CLAIMS_EXECUTION');
    if (proposal.state === 'voting' && proposal.applied === true) reasons.push('APPLIED_WHILE_VOTING');
  }
  if (tally) {
    if (tally.passed === true && tally.quorumMet !== true) reasons.push('PASSED_WITHOUT_QUORUM');
    if (tally.passed === true && tally.closed !== true) reasons.push('PASSED_BEFORE_CLOSE');
    if (tally.applied === true) reasons.push('TALLY_CLAIMS_APPLIED');
  }
  if (application) {
    if (application.applied === true && application.securityProofsIntact !== true) reasons.push('APPLIED_WITHOUT_PROOFS');
    if (application.applied === true && application.reason === 'PROGRAM_CONTROL_BLOCKED') reasons.push('APPLIED_DESPITE_PROGRAM_CONTROL');
  }
  if (proofs) {
    for (const key of NON_GOVERNABLE) {
      if (key in proofs && proofs[key] === false) reasons.push('SECURITY_PROOF_DISABLED');
    }
  }
  const unique = [...new Set(reasons)];
  return unique.length
    ? { ok: false, reasons: unique, error: classifyFailure('GUARDIAN_REJECTED', { detail: unique[0] }) }
    : { ok: true };
}
