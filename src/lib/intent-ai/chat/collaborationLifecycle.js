/**
 * Bounded collaboration state for the chat negotiation surface.
 *
 * This is a workflow record, not an agent runtime. Internal results are only
 * recorded after the named local rule/engine has run. First-party plugin work
 * is recorded only from a completed Agent Hub task with its server consent
 * receipt. A user-reported counterparty reply stays explicitly unverified.
 * Nothing in this module grants execution authority or proves a human deal.
 */

export const COLLABORATION_SCHEMA = 'fbt.chat-collaboration.v1';
export const COLLABORATION_TTL_MS = 6 * 60 * 60 * 1000;
export const COLLABORATION_MAX_PARTICIPANTS = 8;
export const COLLABORATION_MAX_TASKS = 8;
export const COLLABORATION_MAX_NATIVE_PLUGIN_RUNS = 3;
export const COLLABORATION_RESULT_MAX_CHARS = 1200;

const MODES = new Set(['human-human', 'human-agent', 'agent-agent', 'fbt-external-agent']);
const PARTICIPANT_KINDS = new Set(['human', 'internal-agent', 'native-plugin', 'counterparty', 'external-agent']);
const TASK_STATUSES = new Set([
  'OFFERED', 'AWAITING_USER', 'AWAITING_USER_SEND', 'IN_PROGRESS', 'AWAITING_PROVIDER',
  'AWAITING_INPUT', 'AWAITING_PARTICIPANT', 'COMPLETED', 'REPORTED_UNVERIFIED', 'BLOCKED', 'UNAVAILABLE'
]);
const REVIEW_DECISIONS = new Set(['ACCEPT_DRAFT', 'REQUEST_CHANGES', 'REJECT_DRAFT']);
const LOCAL_USER_ID = 'human:local';
const NATIVE_PROVIDER_ID = 'fbt-native';

const cleanText = (value, max = COLLABORATION_RESULT_MAX_CHARS) => String(value ?? '')
  .replace(/\u0000/g, '')
  // eslint-disable-next-line no-control-regex
  .replace(/[\u0001-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
  .replace(/[\u200B-\u200F\u202A-\u202E\u2060-\u2064\uFEFF]/g, '')
  .trim()
  .slice(0, max);

const safeId = (value) => {
  const id = cleanText(value, 96);
  return /^[A-Za-z0-9][A-Za-z0-9:._-]{0,95}$/.test(id) ? id : '';
};

const safeDataSources = (value) => (Array.isArray(value) ? [...new Set(value
  .filter((item) => typeof item === 'string')
  .map((item) => cleanText(item, 80))
  .filter(Boolean))].slice(0, 8) : []);

function normalizeParticipant(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const id = safeId(raw.id);
  const kind = PARTICIPANT_KINDS.has(raw.kind) ? raw.kind : null;
  if (!id || !kind) return null;
  let identityStatus = 'unverified';
  if (kind === 'human' && id === LOCAL_USER_ID) identityStatus = 'local-user';
  if (kind === 'internal-agent' && id.startsWith('fbt:')) identityStatus = 'first-party-local';
  if (kind === 'native-plugin' && id.startsWith(`${NATIVE_PROVIDER_ID}:`)) identityStatus = 'first-party-plugin';
  // Never accept an identity claim from a chat payload for a counterparty or
  // external agent. Those statuses need evidence from a real trust boundary.
  return {
    id,
    kind,
    label: cleanText(raw.label || id, 80),
    identityStatus,
    status: cleanText(raw.status || 'available', 40),
    ...(kind === 'native-plugin' ? { dataSources: safeDataSources(raw.dataSources) } : {})
  };
}

function normalizeTask(raw, participantIds, now) {
  if (!raw || typeof raw !== 'object') return null;
  const id = safeId(raw.id);
  const assigneeId = safeId(raw.assigneeId);
  const status = TASK_STATUSES.has(raw.status) ? raw.status : null;
  if (!id || !assigneeId || !participantIds.has(assigneeId) || !status) return null;
  const resultText = raw.result == null
    ? ''
    : (typeof raw.result === 'string' ? cleanText(raw.result) : cleanText(raw.result?.text));
  const source = cleanText(raw.result?.source || raw.source || '', 48) || null;
  const result = resultText ? {
    text: resultText,
    source,
    dataStatus: cleanText(raw.result?.dataStatus || '', 32) || null,
    verified: false,
    citations: Array.isArray(raw.result?.citations)
      ? raw.result.citations.filter((url) => typeof url === 'string' && /^https:\/\//i.test(url)).slice(0, 4).map((url) => url.slice(0, 300))
      : []
  } : null;
  return {
    id,
    title: cleanText(raw.title || id, 120),
    assigneeId,
    kind: cleanText(raw.kind || 'internal', 32),
    status,
    assignedAt: Number.isFinite(Number(raw.assignedAt)) ? Number(raw.assignedAt) : now,
    updatedAt: now,
    result,
    ...(raw.reason ? { reason: cleanText(raw.reason, 100) } : {})
  };
}

function cloneSession(session) {
  return {
    ...session,
    participants: (session.participants || []).map((participant) => ({
      ...participant,
      ...(Array.isArray(participant.dataSources) ? { dataSources: [...participant.dataSources] } : {})
    })),
    tasks: (session.tasks || []).map((task) => ({
      ...task,
      result: task.result ? { ...task.result, citations: [...(task.result.citations || [])] } : null
    })),
    review: { ...(session.review || {}) },
    consent: {
      ...(session.consent || {}),
      local: { ...(session.consent?.local || {}) },
      counterparty: { ...(session.consent?.counterparty || {}) }
    }
  };
}

function validSession(session, now = Date.now()) {
  if (!session || typeof session !== 'object' || session.schema !== COLLABORATION_SCHEMA || !MODES.has(session.mode)) {
    return { ok: false, code: 'COLLABORATION_SESSION_INVALID' };
  }
  if (!Number.isFinite(Number(session.expiresAt)) || now >= Number(session.expiresAt)) return { ok: false, code: 'COLLABORATION_SESSION_EXPIRED' };
  if (!Array.isArray(session.participants) || session.participants.length < 1 || session.participants.length > COLLABORATION_MAX_PARTICIPANTS
    || !Array.isArray(session.tasks) || session.tasks.length > COLLABORATION_MAX_TASKS
    || !session.review || !session.consent?.local || !session.consent?.counterparty) {
    return { ok: false, code: 'COLLABORATION_SESSION_INVALID' };
  }
  const participants = session.participants.map(normalizeParticipant).filter(Boolean);
  const participantIds = new Set(participants.map((participant) => participant.id));
  if (participants.length !== session.participants.length || participantIds.size !== participants.length
    || !participantIds.has(LOCAL_USER_ID)) return { ok: false, code: 'COLLABORATION_SESSION_INVALID' };
  if (session.tasks.some((task) => !normalizeTask(task, participantIds, Number(now)))) {
    return { ok: false, code: 'COLLABORATION_SESSION_INVALID' };
  }
  return { ok: true };
}

function touch(session, now) {
  session.updatedAt = now;
  session.state = session.tasks.some((task) => ['IN_PROGRESS', 'AWAITING_PROVIDER'].includes(task.status))
    ? 'IN_PROGRESS'
    : session.tasks.some((task) => ['AWAITING_USER', 'AWAITING_USER_SEND', 'AWAITING_INPUT'].includes(task.status))
      ? 'AWAITING_USER'
      : session.planDraftState === 'REQUESTED'
        ? 'PLAN_REQUESTED'
        : session.review.status === 'REVIEWED'
      ? (session.mode === 'human-human' && session.consent.local.status === 'LOCAL_ACCEPTANCE_ONLY'
        ? 'AWAITING_COUNTERPARTY'
        : session.consent.local.status === 'RECORDED_LOCAL' ? 'CONSENT_RECORDED' : 'AWAITING_CONSENT')
      : session.review.status === 'NEEDS_REVISION' ? 'REVISION_REQUIRED'
        : session.review.status === 'REJECTED' ? 'REJECTED'
          : (session.tasks.some((task) => task.status === 'BLOCKED') ? 'PARTIAL_REVIEW' : 'AWAITING_REVIEW');
  session.executionAuthorized = false;
  session.agreementReached = false;
  session.contactedCounterparty = false;
  return session;
}

function invalidateReviewAndConsent(session) {
  session.review = { status: 'PENDING', decision: null, reviewerId: null, at: null };
  session.consent.local = { status: 'NOT_RECORDED', at: null, scope: null };
  session.consent.mutual = false;
  session.consent.agreementReached = false;
  session.consent.executionAuthorized = false;
  session.planDraftState = 'NOT_REQUESTED';
  session.planDraftRequestedAt = null;
}

/** Build a JSON-safe session record that can live in a persisted chat card. */
export function createCollaborationSession({ mode, subject = '', participants = [], tasks = [], now = Date.now(), id = null } = {}) {
  if (!MODES.has(mode)) return { ok: false, code: 'COLLABORATION_MODE_INVALID' };
  if (!Number.isFinite(Number(now)) || Number(now) < 0) return { ok: false, code: 'COLLABORATION_TIME_INVALID' };
  if (!Array.isArray(participants) || participants.length > COLLABORATION_MAX_PARTICIPANTS) {
    return { ok: false, code: 'COLLABORATION_PARTICIPANT_LIMIT' };
  }
  if (!Array.isArray(tasks) || tasks.length > COLLABORATION_MAX_TASKS) return { ok: false, code: 'COLLABORATION_TASK_LIMIT' };
  const people = participants.map(normalizeParticipant).filter(Boolean);
  if (!people.some((participant) => participant.id === LOCAL_USER_ID)) {
    people.unshift(normalizeParticipant({ id: LOCAL_USER_ID, kind: 'human', label: 'You' }));
  }
  if (people.length > COLLABORATION_MAX_PARTICIPANTS) return { ok: false, code: 'COLLABORATION_PARTICIPANT_LIMIT' };
  const participantIds = new Set(people.map((participant) => participant.id));
  if (participantIds.size !== people.length) return { ok: false, code: 'COLLABORATION_PARTICIPANT_DUPLICATE' };
  const taskRows = tasks.map((task) => normalizeTask(task, participantIds, Number(now))).filter(Boolean);
  if (taskRows.length !== tasks.length) return { ok: false, code: 'COLLABORATION_TASK_INVALID' };
  const session = {
    schema: COLLABORATION_SCHEMA,
    id: safeId(id) || `collab_${Number(now).toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    mode,
    subject: cleanText(subject, 300) || null,
    createdAt: Number(now),
    updatedAt: Number(now),
    expiresAt: Number(now) + COLLABORATION_TTL_MS,
    state: 'AWAITING_REVIEW',
    participants: people,
    tasks: taskRows,
    review: { status: 'PENDING', decision: null, reviewerId: null, at: null },
    consent: {
      scope: mode === 'human-human' ? 'terms-only' : 'planning-only',
      local: { status: 'NOT_RECORDED', at: null, scope: null },
      counterparty: { status: mode === 'human-human' ? 'NOT_VERIFIED' : 'NOT_REQUIRED', at: null, scope: null },
      mutual: false,
      agreementReached: false,
      executionAuthorized: false
    },
    planDraftState: 'NOT_REQUESTED',
    planDraftRequestedAt: null,
    executed: false,
    contactedCounterparty: false,
    agreementReached: false,
    executionAuthorized: false
  };
  return { ok: true, session: touch(session, Number(now)) };
}

/** Whether a user may review the results already collected in this session. */
export function canReviewCollaboration(session, { now = Date.now() } = {}) {
  const valid = validSession(session, now);
  if (!valid.ok || session.review?.status === 'REJECTED') return false;
  return !(session.tasks || []).some((task) => ['AWAITING_USER', 'IN_PROGRESS', 'AWAITING_PROVIDER', 'AWAITING_INPUT'].includes(task.status));
}

/** Record a local user's answer to a task assigned to them (for example, risk selection). */
export function recordLocalCollaborationResult(session, { taskId, assigneeId = LOCAL_USER_ID, text = '', now = Date.now() } = {}) {
  const valid = validSession(session, now);
  if (!valid.ok) return valid;
  if (assigneeId !== LOCAL_USER_ID) return { ok: false, code: 'COLLABORATION_ACTOR_MISMATCH' };
  const next = cloneSession(session);
  const task = next.tasks.find((row) => row.id === taskId && row.assigneeId === assigneeId);
  const value = cleanText(text, COLLABORATION_RESULT_MAX_CHARS);
  if (!task || task.status !== 'AWAITING_USER' || !value) return { ok: false, code: 'COLLABORATION_TASK_NOT_AWAITING_USER' };
  task.status = 'COMPLETED';
  task.updatedAt = Number(now);
  task.result = { text: value, source: 'local-user-input', dataStatus: 'local', verified: false, citations: [] };
  invalidateReviewAndConsent(next);
  return { ok: true, session: touch(next, Number(now)) };
}

/** Assign a first-party native plugin task, still requiring a visible user send/consent. */
export function prepareNativePluginTask(session, { agent = null, now = Date.now() } = {}) {
  const valid = validSession(session, now);
  if (!valid.ok) return valid;
  if (session.mode === 'fbt-external-agent') return { ok: false, code: 'EXTERNAL_COLLABORATION_BLOCKED' };
  const id = safeId(agent?.id);
  const isNative = agent?.source === 'native' || agent?.native === true;
  if (!isNative || agent?.providerId !== NATIVE_PROVIDER_ID || !id.startsWith(`${NATIVE_PROVIDER_ID}:`)) {
    return { ok: false, code: 'NATIVE_PLUGIN_IDENTITY_REQUIRED' };
  }
  if (String(agent?.status || '').toUpperCase() !== 'LIVE') return { ok: false, code: 'NATIVE_PLUGIN_NOT_LIVE' };
  const next = cloneSession(session);
  const nativeTasks = next.tasks.filter((task) => task.kind === 'native-plugin');
  if (next.tasks.length >= COLLABORATION_MAX_TASKS) return { ok: false, code: 'COLLABORATION_TASK_LIMIT' };
  if (nativeTasks.some((task) => task.assigneeId === id && ['AWAITING_USER_SEND', 'IN_PROGRESS', 'AWAITING_PROVIDER'].includes(task.status))) {
    return { ok: false, code: 'NATIVE_PLUGIN_TASK_ALREADY_ACTIVE' };
  }
  if (nativeTasks.length >= COLLABORATION_MAX_NATIVE_PLUGIN_RUNS) return { ok: false, code: 'NATIVE_PLUGIN_TASK_LIMIT' };
  const participant = next.participants.find((row) => row.id === id);
  if (!participant) {
    if (next.participants.length >= COLLABORATION_MAX_PARTICIPANTS) return { ok: false, code: 'COLLABORATION_PARTICIPANT_LIMIT' };
    next.participants.push(normalizeParticipant({
      id,
      kind: 'native-plugin',
      label: agent.nameFa || agent.name || id,
      status: 'selected',
      dataSources: agent.dataSources
    }));
  }
  const slug = id.slice(`${NATIVE_PROVIDER_ID}:`.length).replace(/[^A-Za-z0-9._-]/g, '').slice(0, 40) || 'plugin';
  const attempt = nativeTasks.filter((task) => task.assigneeId === id).length + 1;
  const taskId = `native_${slug}_${attempt}`;
  if (next.tasks.some((task) => task.id === taskId)) return { ok: false, code: 'COLLABORATION_TASK_DUPLICATE' };
  next.tasks.push({
    id: taskId,
    title: `First-party plugin review · ${cleanText(agent.nameFa || agent.name || id, 80)}`,
    assigneeId: id,
    kind: 'native-plugin',
    status: 'AWAITING_USER_SEND',
    assignedAt: Number(now),
    updatedAt: Number(now),
    dataSources: safeDataSources(agent.dataSources),
    result: null
  });
  invalidateReviewAndConsent(next);
  return { ok: true, session: touch(next, Number(now)), taskId };
}

/** Mark the broker task as started only after the user sends the reviewed draft. */
export function startNativePluginTask(session, { taskId, agentId, userConsent = false, now = Date.now() } = {}) {
  const valid = validSession(session, now);
  if (!valid.ok) return valid;
  if (session.review?.status !== 'REVIEWED' || session.consent?.local?.status !== 'RECORDED_LOCAL') {
    return { ok: false, code: 'COLLABORATION_REVIEW_AND_CONSENT_REQUIRED' };
  }
  if (userConsent !== true) return { ok: false, code: 'EXPLICIT_TASK_CONSENT_REQUIRED' };
  const next = cloneSession(session);
  const task = next.tasks.find((row) => row.id === taskId);
  if (!task || task.kind !== 'native-plugin' || task.assigneeId !== agentId || task.status !== 'AWAITING_USER_SEND') {
    return { ok: false, code: 'COLLABORATION_TASK_NOT_READY' };
  }
  task.status = 'IN_PROGRESS';
  task.updatedAt = Number(now);
  invalidateReviewAndConsent(next);
  return { ok: true, session: touch(next, Number(now)) };
}

function consentReceiptMatches(task, participant, brokerTask) {
  const consent = brokerTask?.consent;
  if (!consent || consent.providerId !== NATIVE_PROVIDER_ID || !consent.approvedContextHash
    || consent.approvedContextHash !== brokerTask.approvedContextHash
    || !Array.isArray(brokerTask.contextCategories) || !brokerTask.contextCategories.includes('task_text')) return false;
  const expectedSources = safeDataSources(participant?.dataSources).sort();
  const grantedSources = safeDataSources(consent.nativeDataSources).sort();
  if (expectedSources.length !== grantedSources.length || expectedSources.some((source, index) => source !== grantedSources[index])) return false;
  return expectedSources.length === 0 || consent.nativeDataApproved === true;
}

/** Accept a completed result only from a completed, consented FBT-native broker task. */
export function recordNativePluginTaskResult(session, { taskId, agentId, agentSource = 'native', brokerTask = null, now = Date.now() } = {}) {
  const valid = validSession(session, now);
  if (!valid.ok) return valid;
  const next = cloneSession(session);
  const task = next.tasks.find((row) => row.id === taskId);
  const participant = next.participants.find((row) => row.id === agentId);
  if (!task || task.kind !== 'native-plugin' || task.assigneeId !== agentId
    || !participant || participant.kind !== 'native-plugin' || participant.identityStatus !== 'first-party-plugin'
    || agentSource !== 'native' || brokerTask?.providerId !== NATIVE_PROVIDER_ID || brokerTask?.agentId !== agentId) {
    return { ok: false, code: 'NATIVE_PLUGIN_RESULT_IDENTITY_MISMATCH' };
  }
  if (!['IN_PROGRESS', 'AWAITING_PROVIDER', 'AWAITING_INPUT'].includes(task.status)) return { ok: false, code: 'COLLABORATION_TASK_NOT_READY' };
  if (!consentReceiptMatches(task, participant, brokerTask)) return { ok: false, code: 'NATIVE_PLUGIN_CONSENT_RECEIPT_REQUIRED' };
  if (brokerTask.state !== 'completed') {
    task.status = brokerTask.state === 'failed' || brokerTask.state === 'canceled' ? 'BLOCKED' : 'AWAITING_PROVIDER';
    task.reason = cleanText(brokerTask.errorCode || brokerTask.state || 'PROVIDER_PENDING', 100);
    task.updatedAt = Number(now);
    invalidateReviewAndConsent(next);
    return { ok: true, session: touch(next, Number(now)) };
  }
  const result = brokerTask.result;
  const resultText = cleanText(result?.text || '', COLLABORATION_RESULT_MAX_CHARS);
  if (!resultText) return { ok: false, code: 'NATIVE_PLUGIN_RESULT_EMPTY' };
  const resultData = result?.data && typeof result.data === 'object' ? result.data : {};
  const needsInput = resultData.needsInput === true || resultData.dataStatus === 'awaiting_input';
  task.status = needsInput ? 'AWAITING_INPUT' : 'COMPLETED';
  task.updatedAt = Number(now);
  task.reason = needsInput ? 'PLUGIN_NEEDS_INPUT' : null;
  task.result = {
    text: resultText,
    source: 'first-party-agent-hub',
    dataStatus: cleanText(resultData.dataStatus || 'unknown', 32),
    verified: true,
    citations: Array.isArray(result?.citations)
      ? result.citations.filter((url) => typeof url === 'string' && /^https:\/\//i.test(url)).slice(0, 4).map((url) => url.slice(0, 300))
      : []
  };
  invalidateReviewAndConsent(next);
  return { ok: true, session: touch(next, Number(now)) };
}

/** Mark a broker refusal/transport failure without turning it into a result. */
export function failNativePluginTask(session, { taskId, agentId, code = 'PLUGIN_TASK_FAILED', now = Date.now() } = {}) {
  const valid = validSession(session, now);
  if (!valid.ok) return valid;
  const next = cloneSession(session);
  const task = next.tasks.find((row) => row.id === taskId);
  if (!task || task.kind !== 'native-plugin' || task.assigneeId !== agentId) return { ok: false, code: 'COLLABORATION_TASK_NOT_FOUND' };
  if (!['IN_PROGRESS', 'AWAITING_PROVIDER', 'AWAITING_INPUT'].includes(task.status)) return { ok: false, code: 'COLLABORATION_TASK_NOT_READY' };
  task.status = 'BLOCKED';
  task.reason = cleanText(code, 100) || 'PLUGIN_TASK_FAILED';
  task.updatedAt = Number(now);
  invalidateReviewAndConsent(next);
  return { ok: true, session: touch(next, Number(now)) };
}

/** Record an explicit human review; approval here is only approval of a draft. */
export function reviewCollaboration(session, { reviewerId = LOCAL_USER_ID, decision = 'ACCEPT_DRAFT', now = Date.now() } = {}) {
  const valid = validSession(session, now);
  if (!valid.ok) return valid;
  if (!REVIEW_DECISIONS.has(decision)) return { ok: false, code: 'COLLABORATION_REVIEW_DECISION_INVALID' };
  if (reviewerId !== LOCAL_USER_ID || !session.participants.some((participant) => participant.id === LOCAL_USER_ID && participant.kind === 'human')) {
    return { ok: false, code: 'COLLABORATION_REVIEWER_NOT_AUTHORIZED' };
  }
  if (!canReviewCollaboration(session, { now })) return { ok: false, code: 'COLLABORATION_RESULTS_PENDING' };
  if (decision === 'ACCEPT_DRAFT' && (session.tasks || []).some((task) => task.status === 'BLOCKED')) {
    return { ok: false, code: 'COLLABORATION_BLOCKING_TASK' };
  }
  const next = cloneSession(session);
  next.review = {
    status: decision === 'ACCEPT_DRAFT' ? 'REVIEWED' : decision === 'REQUEST_CHANGES' ? 'NEEDS_REVISION' : 'REJECTED',
    decision,
    reviewerId,
    at: Number(now)
  };
  next.consent.local = { status: 'NOT_RECORDED', at: null, scope: null };
  next.consent.mutual = false;
  next.consent.agreementReached = false;
  next.consent.executionAuthorized = false;
  if (decision !== 'ACCEPT_DRAFT') {
    next.planDraftState = 'NOT_REQUESTED';
    next.planDraftRequestedAt = null;
  }
  return { ok: true, session: touch(next, Number(now)) };
}

/** Local consent is scoped to planning, or to this user's terms only. */
export function consentToCollaboration(session, { participantId = LOCAL_USER_ID, now = Date.now() } = {}) {
  const valid = validSession(session, now);
  if (!valid.ok) return valid;
  if (participantId !== LOCAL_USER_ID) return { ok: false, code: 'COUNTERPARTY_VERIFICATION_REQUIRED' };
  if (session.review?.status !== 'REVIEWED' || session.review?.decision !== 'ACCEPT_DRAFT') {
    return { ok: false, code: 'COLLABORATION_REVIEW_REQUIRED' };
  }
  if ((session.tasks || []).some((task) => task.status === 'BLOCKED')) return { ok: false, code: 'COLLABORATION_BLOCKING_TASK' };
  if (!canReviewCollaboration(session, { now })) return { ok: false, code: 'COLLABORATION_RESULTS_PENDING' };
  const next = cloneSession(session);
  if (next.mode === 'human-human') {
    next.consent.local = { status: 'LOCAL_ACCEPTANCE_ONLY', at: Number(now), scope: 'terms-only' };
    next.consent.counterparty = { status: 'NOT_VERIFIED', at: null, scope: null };
    next.consent.mutual = false;
    next.consent.agreementReached = false;
  } else {
    next.consent.local = { status: 'RECORDED_LOCAL', at: Number(now), scope: 'planning-only' };
  }
  next.consent.executionAuthorized = false;
  return { ok: true, session: touch(next, Number(now)) };
}

/** Record the single planning hand-off, never the plan's eventual execution. */
export function recordPlanDraftRequest(session, { now = Date.now() } = {}) {
  const valid = validSession(session, now);
  if (!valid.ok) return valid;
  if (!['human-agent', 'agent-agent'].includes(session.mode)) return { ok: false, code: 'COLLABORATION_PLAN_MODE_INVALID' };
  if (session.review?.status !== 'REVIEWED' || session.review?.decision !== 'ACCEPT_DRAFT'
    || session.consent?.local?.status !== 'RECORDED_LOCAL') return { ok: false, code: 'PLANNING_CONSENT_REQUIRED' };
  if ((session.tasks || []).some((task) => task.status === 'BLOCKED')) return { ok: false, code: 'COLLABORATION_BLOCKING_TASK' };
  if (!canReviewCollaboration(session, { now })) return { ok: false, code: 'COLLABORATION_RESULTS_PENDING' };
  if (session.planDraftState === 'REQUESTED' || session.planDraftRequestedAt != null) {
    return { ok: false, code: 'COLLABORATION_PLAN_ALREADY_REQUESTED' };
  }
  const next = cloneSession(session);
  next.planDraftState = 'REQUESTED';
  next.planDraftRequestedAt = Number(now);
  return { ok: true, session: touch(next, Number(now)) };
}

/** A manually transcribed counterparty reply is collected as a report, never verified consent. */
export function recordCounterpartyReport(session, { reporterId = LOCAL_USER_ID, text = '', now = Date.now() } = {}) {
  const valid = validSession(session, now);
  if (!valid.ok) return valid;
  if (session.mode !== 'human-human' || reporterId !== LOCAL_USER_ID) return { ok: false, code: 'COUNTERPARTY_REPORT_NOT_ALLOWED' };
  if (session.review?.status !== 'REVIEWED' || session.consent?.local?.status !== 'LOCAL_ACCEPTANCE_ONLY') {
    return { ok: false, code: 'LOCAL_ACCEPTANCE_REQUIRED' };
  }
  const report = cleanText(text, COLLABORATION_RESULT_MAX_CHARS);
  if (!report) return { ok: false, code: 'COUNTERPARTY_REPORT_EMPTY' };
  const next = cloneSession(session);
  const task = next.tasks.find((row) => row.id === 'counterparty-review' && row.assigneeId === 'human:counterparty');
  if (!task || task.status !== 'AWAITING_PARTICIPANT') return { ok: false, code: 'COUNTERPARTY_TASK_NOT_FOUND' };
  task.status = 'REPORTED_UNVERIFIED';
  task.updatedAt = Number(now);
  task.reason = 'USER_REPORTED_NOT_AUTHENTICATED';
  task.result = { text: report, source: 'user-reported', dataStatus: 'unverified', verified: false, citations: [] };
  next.consent.counterparty = { status: 'NOT_VERIFIED', at: null, scope: null };
  next.consent.mutual = false;
  next.consent.agreementReached = false;
  next.consent.executionAuthorized = false;
  invalidateReviewAndConsent(next);
  return { ok: true, session: touch(next, Number(now)) };
}

/** Is this a live collaboration record that may accept a chat task event? */
export function collaborationSessionIsCurrent(session, { now = Date.now() } = {}) {
  return validSession(session, now).ok;
}

export const COLLABORATION_LOCAL_USER_ID = LOCAL_USER_ID;
