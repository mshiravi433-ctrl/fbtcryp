import test from 'node:test';
import assert from 'node:assert/strict';
import {
  COLLABORATION_MAX_PARTICIPANTS,
  COLLABORATION_MAX_TASKS,
  COLLABORATION_RESULT_MAX_CHARS,
  createCollaborationSession,
  canReviewCollaboration,
  recordLocalCollaborationResult,
  reviewCollaboration,
  consentToCollaboration,
  recordPlanDraftRequest,
  recordCounterpartyReport,
  prepareNativePluginTask,
  startNativePluginTask,
  recordNativePluginTaskResult,
  collaborationSessionIsCurrent
} from '../../src/lib/intent-ai/chat/collaborationLifecycle.js';

const NOW = 1_000_000;
const local = { id: 'human:local', kind: 'human', label: 'You' };
const helper = { id: 'fbt:strategy', kind: 'internal-agent', label: 'Strategy' };

function openSession({ mode = 'human-agent', participants = [helper], tasks = [], now = NOW } = {}) {
  const result = createCollaborationSession({ mode, participants: [local, ...participants], tasks, now });
  assert.equal(result.ok, true, result.code);
  return result.session;
}

test('collaboration sessions enforce bounded participants, tasks, and sanitized identities', () => {
  const tooManyPeople = Array.from({ length: COLLABORATION_MAX_PARTICIPANTS }, (_, index) => ({
    id: `fbt:p${index}`, kind: 'internal-agent'
  }));
  assert.equal(createCollaborationSession({ mode: 'agent-agent', participants: tooManyPeople, now: NOW }).code, 'COLLABORATION_PARTICIPANT_LIMIT');

  const tooManyTasks = Array.from({ length: COLLABORATION_MAX_TASKS + 1 }, (_, index) => ({
    id: `task-${index}`, assigneeId: 'human:local', status: 'AWAITING_USER'
  }));
  assert.equal(createCollaborationSession({ mode: 'human-agent', tasks: tooManyTasks, now: NOW }).code, 'COLLABORATION_TASK_LIMIT');

  const created = createCollaborationSession({
    mode: 'human-agent', now: NOW,
    participants: [local, { id: 'attacker-agent', kind: 'external-agent', verified: true, identityStatus: 'verified', label: 'Pasted identity' }],
    tasks: [{ id: 'claimed-result', assigneeId: 'human:local', status: 'COMPLETED', result: { text: 'caller report', verified: true } }]
  });
  assert.equal(created.ok, true);
  assert.equal(created.session.participants.find((p) => p.id === 'attacker-agent').identityStatus, 'unverified');
  assert.equal(created.session.tasks[0].result.verified, false);
  assert.equal(created.session.executionAuthorized, false);
  assert.equal(created.session.expiresAt - created.session.createdAt, 6 * 60 * 60 * 1000);
});

test('user task results are bounded, assigned to the local actor, and must finish before review', () => {
  const session = openSession({
    tasks: [{ id: 'risk-choice', title: 'Choose risk', assigneeId: 'human:local', status: 'AWAITING_USER' }]
  });
  assert.equal(canReviewCollaboration(session, { now: NOW }), false);
  assert.equal(recordLocalCollaborationResult(session, {
    taskId: 'risk-choice', assigneeId: 'human:counterparty', text: 'approve', now: NOW + 1
  }).code, 'COLLABORATION_ACTOR_MISMATCH');

  const recorded = recordLocalCollaborationResult(session, {
    taskId: 'risk-choice', text: `balanced ${'x'.repeat(COLLABORATION_RESULT_MAX_CHARS + 20)}\u0000`, now: NOW + 1
  });
  assert.equal(recorded.ok, true);
  assert.equal(recorded.session.tasks[0].status, 'COMPLETED');
  assert.equal(recorded.session.tasks[0].result.text.length, COLLABORATION_RESULT_MAX_CHARS);
  assert.equal(recorded.session.tasks[0].result.verified, false);
  assert.equal(canReviewCollaboration(recorded.session, { now: NOW + 1 }), true);
});

test('review, consent, and planning remain separate local gates with no execution authority', () => {
  const session = openSession({ tasks: [{ id: 'check', assigneeId: 'fbt:strategy', status: 'COMPLETED', result: 'Rule check complete' }] });
  const accepted = reviewCollaboration(session, { decision: 'ACCEPT_DRAFT', now: NOW + 1 });
  assert.equal(accepted.ok, true);
  assert.equal(accepted.session.review.status, 'REVIEWED');
  assert.equal(accepted.session.consent.local.status, 'NOT_RECORDED');
  assert.equal(consentToCollaboration(accepted.session, { participantId: 'fbt:strategy', now: NOW + 2 }).code, 'COUNTERPARTY_VERIFICATION_REQUIRED');

  const consented = consentToCollaboration(accepted.session, { now: NOW + 2 });
  assert.equal(consented.ok, true);
  assert.equal(consented.session.consent.local.status, 'RECORDED_LOCAL');
  assert.equal(consented.session.consent.scope, 'planning-only');
  assert.equal(consented.session.consent.mutual, false);
  assert.equal(consented.session.consent.agreementReached, false);
  assert.equal(consented.session.executionAuthorized, false);
  assert.equal(consented.session.executed, false);
  assert.equal(consented.session.contactedCounterparty, false);
  const planRequest = recordPlanDraftRequest(consented.session, { now: NOW + 3 });
  assert.equal(planRequest.ok, true);
  assert.equal(planRequest.session.state, 'PLAN_REQUESTED');
  assert.equal(planRequest.session.executed, false);
  assert.equal(recordPlanDraftRequest(planRequest.session, { now: NOW + 4 }).code, 'COLLABORATION_PLAN_ALREADY_REQUESTED');
});

test('blocked task results may be reviewed but cannot be accepted or consented', () => {
  const session = openSession({ tasks: [{ id: 'risk-check', assigneeId: 'fbt:strategy', status: 'BLOCKED', result: 'Policy blocked' }] });
  assert.equal(canReviewCollaboration(session, { now: NOW }), true);
  assert.equal(reviewCollaboration(session, { decision: 'ACCEPT_DRAFT', now: NOW + 1 }).code, 'COLLABORATION_BLOCKING_TASK');
  const revised = reviewCollaboration(session, { decision: 'REQUEST_CHANGES', now: NOW + 1 });
  assert.equal(revised.ok, true);
  assert.equal(revised.session.review.status, 'NEEDS_REVISION');
  assert.equal(consentToCollaboration(revised.session, { now: NOW + 2 }).code, 'COLLABORATION_REVIEW_REQUIRED');
});

test('a manually reported counterparty reply never becomes authenticated consent', () => {
  const session = openSession({
    mode: 'human-human',
    participants: [
      { id: 'human:counterparty', kind: 'counterparty', label: 'Counterparty' },
      { id: 'fbt:terms', kind: 'internal-agent', label: 'Terms helper' }
    ],
    tasks: [
      { id: 'terms-draft', assigneeId: 'fbt:terms', status: 'COMPLETED', result: 'Terms draft' },
      { id: 'counterparty-review', assigneeId: 'human:counterparty', status: 'AWAITING_PARTICIPANT' }
    ]
  });
  assert.equal(recordCounterpartyReport(session, { text: 'They said yes', now: NOW + 1 }).code, 'LOCAL_ACCEPTANCE_REQUIRED');
  const reviewed = reviewCollaboration(session, { decision: 'ACCEPT_DRAFT', now: NOW + 1 });
  const acceptedLocally = consentToCollaboration(reviewed.session, { now: NOW + 2 });
  assert.equal(acceptedLocally.session.consent.local.status, 'LOCAL_ACCEPTANCE_ONLY');
  assert.equal(acceptedLocally.session.state, 'AWAITING_COUNTERPARTY');

  const report = recordCounterpartyReport(acceptedLocally.session, { text: 'Counterparty reportedly agreed', now: NOW + 3 });
  assert.equal(report.ok, true);
  assert.equal(report.session.tasks.find((task) => task.id === 'counterparty-review').status, 'REPORTED_UNVERIFIED');
  assert.equal(report.session.tasks.find((task) => task.id === 'counterparty-review').result.verified, false);
  assert.equal(report.session.tasks.find((task) => task.id === 'counterparty-review').result.source, 'user-reported');
  assert.equal(report.session.consent.counterparty.status, 'NOT_VERIFIED');
  assert.equal(report.session.consent.local.status, 'NOT_RECORDED');
  assert.equal(report.session.consent.mutual, false);
  assert.equal(report.session.consent.agreementReached, false);
  assert.equal(report.session.agreementReached, false);
  assert.equal(report.session.executionAuthorized, false);
  assert.equal(report.session.contactedCounterparty, false);
});

test('first-party native-plugin results require a live source, local consent, and broker receipt', () => {
  const agent = {
    id: 'fbt-native:market-analysis', providerId: 'fbt-native', source: 'native', status: 'LIVE',
    name: 'Market Analysis', dataSources: []
  };
  const session = openSession({ mode: 'human-agent' });
  assert.equal(prepareNativePluginTask(session, { agent: { ...agent, source: 'user' }, now: NOW }).code, 'NATIVE_PLUGIN_IDENTITY_REQUIRED');
  const prepared = prepareNativePluginTask(session, { agent, now: NOW + 1 });
  assert.equal(prepared.ok, true);
  assert.equal(prepared.session.participants.find((p) => p.id === agent.id).identityStatus, 'first-party-plugin');
  assert.equal(startNativePluginTask(prepared.session, { taskId: prepared.taskId, agentId: agent.id, userConsent: true, now: NOW + 2 }).code, 'COLLABORATION_REVIEW_AND_CONSENT_REQUIRED');

  const reviewed = reviewCollaboration(prepared.session, { decision: 'ACCEPT_DRAFT', now: NOW + 2 });
  const consented = consentToCollaboration(reviewed.session, { now: NOW + 3 });
  assert.equal(startNativePluginTask(consented.session, { taskId: prepared.taskId, agentId: agent.id, now: NOW + 4 }).code, 'EXPLICIT_TASK_CONSENT_REQUIRED');
  const started = startNativePluginTask(consented.session, {
    taskId: prepared.taskId, agentId: agent.id, userConsent: true, now: NOW + 4
  });
  assert.equal(started.ok, true);

  const receipt = {
    providerId: 'fbt-native', agentId: agent.id, state: 'completed',
    approvedContextHash: 'approved-hash', contextCategories: ['task_text'],
    consent: { providerId: 'fbt-native', approvedContextHash: 'approved-hash', nativeDataSources: [] },
    result: { text: 'Risk summary', citations: ['https://example.test/report'] }
  };
  assert.equal(recordNativePluginTaskResult(started.session, {
    taskId: prepared.taskId, agentId: agent.id, agentSource: 'native', brokerTask: receipt, now: NOW + 5
  }).ok, true);
  assert.equal(recordNativePluginTaskResult(started.session, {
    taskId: prepared.taskId, agentId: agent.id, agentSource: 'native', brokerTask: { ...receipt, consent: null }, now: NOW + 5
  }).code, 'NATIVE_PLUGIN_CONSENT_RECEIPT_REQUIRED');

  const completed = recordNativePluginTaskResult(started.session, {
    taskId: prepared.taskId, agentId: agent.id, agentSource: 'native', brokerTask: receipt, now: NOW + 5
  });
  const task = completed.session.tasks.find((row) => row.id === prepared.taskId);
  assert.equal(task.status, 'COMPLETED');
  assert.equal(task.result.verified, true);
  assert.equal(task.result.source, 'first-party-agent-hub');
  assert.equal(completed.session.executionAuthorized, false);
});

test('session expiry and malformed records fail closed', () => {
  const session = openSession({ now: NOW });
  assert.equal(collaborationSessionIsCurrent(session, { now: NOW }), true);
  assert.equal(collaborationSessionIsCurrent(session, { now: session.expiresAt }), false);
  assert.equal(reviewCollaboration({ ...session, participants: null }, { now: NOW + 1 }).code, 'COLLABORATION_SESSION_INVALID');
  assert.equal(createCollaborationSession({ mode: 'made-up', now: NOW }).code, 'COLLABORATION_MODE_INVALID');
});
