/**
 * PHASE 96 — COMMUNITY PARAMETER GOVERNANCE
 * The community may move a policy parameter inside bounds it did not set. No
 * vote, at any majority, can remove a security proof, and a passing vote still
 * has to get past the phase-50 program control before anything changes.
 */
import { readFileSync } from 'node:fs';
import {
  proposeParameterChange, castParameterVote, tallyParameterVotes, applyParameterChange,
  parameterIsGovernable, assertProofsIntact,
  GOVERNED_PARAMETERS, NON_GOVERNABLE, VOTE_CHOICES, VOTING_PERIOD_MS,
  QUORUM_VOTES, APPROVAL_THRESHOLD, PARAM_GOVERNANCE_SCHEMA
} from '../../src/lib/intent-ai/index.js';
import { FEE_BPS_MAX } from '../../src/lib/feeBps.js';

const results = [];
const check = (name, ok) => results.push({ name, ok: Boolean(ok) });

const NOW = 1_800_000_000_000;
const CLOSED = NOW + VOTING_PERIOD_MS + 1;
const ballots = (n, choice, offset = 0) =>
  Array.from({ length: n }, (_, i) => ({ voterId: `v${i + offset}`, choice, at: NOW + 1 }));

try {
  /* ---------- what is even governable ---------- */
  check('a listed parameter is governable', parameterIsGovernable('feeBps').governable === true);
  check('an unlisted parameter is not', parameterIsGovernable('secretSauce').governable === false);
  check('an unlisted parameter says why', parameterIsGovernable('secretSauce').reason === 'UNKNOWN_PARAMETER');
  for (const proof of NON_GOVERNABLE) {
    check(`${proof} is a security proof, not a parameter`,
      parameterIsGovernable(proof).reason === 'SECURITY_PROOF_NOT_A_PARAMETER');
  }
  check('no security proof leaked into the governable list',
    NON_GOVERNABLE.every((p) => !Object.prototype.hasOwnProperty.call(GOVERNED_PARAMETERS, p)));
  check('every governable parameter has hard bounds',
    Object.values(GOVERNED_PARAMETERS).every((b) => Number.isFinite(b.min) && Number.isFinite(b.max) && b.min <= b.max));
  check('the fee parameter cannot be voted above the product ceiling',
    GOVERNED_PARAMETERS.feeBps.max === FEE_BPS_MAX);

  /* ---------- opening a proposal ---------- */
  const proposal = proposeParameterChange({ parameter: 'feeBps', proposedValue: 50, currentValue: 70, proposerId: 'alice', now: NOW });
  check('a valid proposal opens', proposal.ok === true && proposal.schema === PARAM_GOVERNANCE_SCHEMA);
  check('the proposal is in the voting state', proposal.proposal.state === 'voting');
  check('the proposal has a closing date', proposal.proposal.closesAt === NOW + VOTING_PERIOD_MS);
  check('the proposal is not applied on creation', proposal.proposal.applied === false);
  check('the proposal claims no execution authority', proposal.proposal.executionAuthorized === false);
  check('the proposal is frozen', Object.isFrozen(proposal.proposal));
  check('a proposal on a security proof is refused',
    proposeParameterChange({ parameter: 'guardianEnabled', proposedValue: 0, proposerId: 'mallory', now: NOW }).ok === false);
  check('the security-proof refusal is explicit',
    proposeParameterChange({ parameter: 'confirmationGateRequired', proposedValue: 0, proposerId: 'mallory', now: NOW }).i18nKey === 'intentAI.governance.notVotable');
  check('the security-proof refusal is a guardian rejection',
    proposeParameterChange({ parameter: 'emergencyStopEnabled', proposedValue: 0, proposerId: 'mallory', now: NOW }).error.code === 'GUARDIAN_REJECTED');
  check('a value above the ceiling is refused',
    proposeParameterChange({ parameter: 'feeBps', proposedValue: FEE_BPS_MAX + 1, proposerId: 'alice', now: NOW }).ok === false);
  check('a value below the floor is refused',
    proposeParameterChange({ parameter: 'maxPerTransactionUsd', proposedValue: 1, proposerId: 'alice', now: NOW }).reason === 'OUT_OF_BOUNDS');
  check('the out-of-bounds refusal shows the range',
    proposeParameterChange({ parameter: 'feeBps', proposedValue: 5000, proposerId: 'alice', now: NOW }).i18nParams.max === FEE_BPS_MAX);
  check('a proposal with no proposer is refused',
    proposeParameterChange({ parameter: 'feeBps', proposedValue: 50, now: NOW }).ok === false);
  check('a proposal with no value is refused',
    proposeParameterChange({ parameter: 'feeBps', proposerId: 'alice', now: NOW }).ok === false);
  check('an empty-string value is not read as zero',
    proposeParameterChange({ parameter: 'feeBps', proposedValue: '', proposerId: 'alice', now: NOW }).ok === false);
  check('a boolean value is not read as one',
    proposeParameterChange({ parameter: 'feeBps', proposedValue: true, proposerId: 'alice', now: NOW }).ok === false);
  check('a null value is not read as zero',
    proposeParameterChange({ parameter: 'feeBps', proposedValue: null, proposerId: 'alice', now: NOW }).ok === false);
  check('a zero fee is a legitimate proposal, not a missing value',
    proposeParameterChange({ parameter: 'feeBps', proposedValue: 0, proposerId: 'alice', now: NOW }).ok === true);

  /* ---------- voting ---------- */
  const p = proposal.proposal;
  const first = castParameterVote({ proposal: p, votes: [], voterId: 'bob', choice: 'for', now: NOW + 1 });
  check('a vote is recorded', first.ok === true && first.votes.length === 1);
  check('the vote knows its proposal', first.votes[0].proposalId === p.id);
  check('a second vote from the same person replaces the first',
    castParameterVote({ proposal: p, votes: first.votes, voterId: 'bob', choice: 'against', now: NOW + 2 }).votes.length === 1);
  check('the replacement is the newer choice',
    castParameterVote({ proposal: p, votes: first.votes, voterId: 'bob', choice: 'against', now: NOW + 2 }).votes[0].choice === 'against');
  check('an unknown choice is refused',
    castParameterVote({ proposal: p, votes: [], voterId: 'bob', choice: 'maybe', now: NOW + 1 }).ok === false);
  check('an anonymous vote is refused',
    castParameterVote({ proposal: p, votes: [], choice: 'for', now: NOW + 1 }).ok === false);
  check('a vote after closing is refused',
    castParameterVote({ proposal: p, votes: [], voterId: 'bob', choice: 'for', now: CLOSED }).ok === false);
  check('the late vote is a deadline failure',
    castParameterVote({ proposal: p, votes: [], voterId: 'bob', choice: 'for', now: CLOSED }).error.code === 'DEADLINE_PASSED');
  check('every choice is one of the known choices', VOTE_CHOICES.length === 3 && VOTE_CHOICES.includes('abstain'));

  /* ---------- the tally ---------- */
  const passing = [...ballots(20, 'for'), ...ballots(6, 'against', 100)];
  const open = tallyParameterVotes({ proposal: p, votes: passing, now: NOW + 5 });
  check('an open vote is not passed yet', open.passed === false && open.state === 'voting');
  const closedTally = tallyParameterVotes({ proposal: p, votes: passing, now: CLOSED });
  check('a closed vote with quorum and majority passes', closedTally.passed === true && closedTally.state === 'approved');
  check('the tally counts the real ballots', closedTally.for === 20 && closedTally.against === 6);
  check('the approval share is measured', closedTally.approvalShare === Math.round((20 / 26) * 1000) / 1000);
  check('the tally never claims to have applied anything', closedTally.applied === false);
  check('duplicate ballots are dropped, not double-counted',
    tallyParameterVotes({ proposal: p, votes: [...passing, ...ballots(20, 'for')], now: CLOSED }).counted === 26);
  check('the duplicates are reported',
    tallyParameterVotes({ proposal: p, votes: [...passing, ...ballots(20, 'for')], now: CLOSED }).duplicatesDropped === 20);
  const thin = tallyParameterVotes({ proposal: p, votes: ballots(3, 'for'), now: CLOSED });
  check('a vote below quorum does not pass', thin.passed === false);
  check('a vote below quorum expires rather than being rejected', thin.state === 'expired');
  check('the quorum is a real number', closedTally.quorum === QUORUM_VOTES);
  const narrow = tallyParameterVotes({ proposal: p, votes: [...ballots(14, 'for'), ...ballots(12, 'against', 200)], now: CLOSED });
  check('a majority below the threshold does not pass', narrow.passed === false && narrow.state === 'rejected');
  check('the threshold is published', narrow.threshold === APPROVAL_THRESHOLD);
  check('abstentions do not count towards the threshold',
    tallyParameterVotes({ proposal: p, votes: [...ballots(16, 'for'), ...ballots(9, 'abstain', 300), ...ballots(1, 'against', 400)], now: CLOSED }).passed === true);
  check('a malformed ballot is ignored',
    tallyParameterVotes({ proposal: p, votes: [{ voterId: '', choice: 'for' }, { choice: 'for' }], now: CLOSED }).counted === 0);

  /* ---------- applying ---------- */
  const allowed = { launchAllowed: true, blockers: [] };
  const applied = applyParameterChange({ proposal: p, tally: closedTally, programControl: allowed, now: CLOSED });
  check('an approved change applies when program control allows', applied.ok === true && applied.applied === true);
  check('the applied change reports the new value', applied.value === 50 && applied.parameter === 'feeBps');
  check('the applied change states the proofs are intact', applied.securityProofsIntact === true);
  const blocked = applyParameterChange({ proposal: p, tally: closedTally, programControl: { launchAllowed: false, blockers: ['LAUNCH_FROZEN'] }, now: CLOSED });
  check('phase 50 still holds an approved change', blocked.applied === false);
  check('the block names the program control', blocked.reason === 'PROGRAM_CONTROL_BLOCKED');
  check('the blockers are passed through to the user', blocked.blockers.includes('LAUNCH_FROZEN'));
  check('the block is a translatable notice', blocked.i18nKey === 'intentAI.governance.blockedByProgramControl');
  check('an unapproved proposal never applies',
    applyParameterChange({ proposal: p, tally: narrow, programControl: allowed, now: CLOSED }).applied === false);
  check('a proposal with no tally never applies',
    applyParameterChange({ proposal: p, programControl: allowed, now: CLOSED }).applied === false);
  check('a tampered proposal value is re-checked at apply time',
    applyParameterChange({ proposal: { ...p, proposedValue: 9999 }, tally: closedTally, programControl: allowed, now: CLOSED }).applied === false);
  check('a tampered proposal parameter is re-checked at apply time',
    applyParameterChange({ proposal: { ...p, parameter: 'guardianEnabled' }, tally: closedTally, programControl: allowed, now: CLOSED }).applied === false);

  /* ---------- the guard ---------- */
  check('an honest governance round passes the guard',
    assertProofsIntact({ proposal: p, tally: closedTally, application: applied }).ok === true);
  check('a proposal targeting a proof is caught',
    assertProofsIntact({ proposal: { ...p, parameter: 'guardianEnabled' } }).reasons.includes('PROPOSAL_TARGETS_SECURITY_PROOF'));
  check('a proposal that removes a proof is caught',
    assertProofsIntact({ proposal: { ...p, removesSecurityProof: true } }).reasons.includes('PROPOSAL_REMOVES_PROOF'));
  check('a proposal claiming execution is caught',
    assertProofsIntact({ proposal: { ...p, executionAuthorized: true } }).reasons.includes('PROPOSAL_CLAIMS_EXECUTION'));
  check('passing without quorum is caught',
    assertProofsIntact({ tally: { passed: true, quorumMet: false, closed: true } }).reasons.includes('PASSED_WITHOUT_QUORUM'));
  check('passing before the vote closes is caught',
    assertProofsIntact({ tally: { passed: true, quorumMet: true, closed: false } }).reasons.includes('PASSED_BEFORE_CLOSE'));
  check('applying despite the program control is caught',
    assertProofsIntact({ application: { applied: true, reason: 'PROGRAM_CONTROL_BLOCKED', securityProofsIntact: true } }).reasons.includes('APPLIED_DESPITE_PROGRAM_CONTROL'));
  check('a disabled security proof is caught',
    assertProofsIntact({ proofs: { guardianEnabled: false } }).reasons.includes('SECURITY_PROOF_DISABLED'));
  check('the guard rejection is a guardian rejection',
    assertProofsIntact({ proofs: { confirmationGateRequired: false } }).error.code === 'GUARDIAN_REJECTED');

  /* ---------- copy ---------- */
  const locales = ['en', 'fa', 'ar'].map((l) => JSON.parse(readFileSync(`src/i18n/locales/${l}.json`, 'utf8')));
  check('the governance copy is translated in en, fa and ar',
    locales.every((loc) => ['proposalOpen', 'notVotable', 'outOfBounds', 'voteRecorded', 'approved', 'rejected', 'blockedByProgramControl']
      .every((k) => typeof loc?.intentAI?.governance?.[k] === 'string')));
  check('the english copy says a safety proof is not a setting',
    /safety proof, not a setting/i.test(locales[0].intentAI.governance.notVotable));
  check('the english copy never promises a return on a vote',
    !/profit|return|guaranteed/i.test(Object.values(locales[0].intentAI.governance).join(' ')));

  console.log(JSON.stringify({ probe: 'phase96-param-governance', passed: results.filter((r) => r.ok).length, results }, null, 2));
  if (results.some((r) => !r.ok)) process.exitCode = 1;
} catch (e) {
  console.error(e);
  process.exitCode = 1;
}

export default results;
