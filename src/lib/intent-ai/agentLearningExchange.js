/**
 * FBT INTENT AI — Spec 65 item 54: Agent Learning From Each Other.
 *
 * After a session, participating agents may exchange structured lessons:
 * what was right, what was wrong, which hypothesis failed, which approach
 * performed better. The pipeline runs ONLY with explicit opt-in, carries no
 * private chat text and no secrets, and stays local — upload remains
 * disabled by default and learning never weakens Guardian, Risk or STOP.
 */

import { containsRawSecret, fail, noExecutionPermission, safeId, safeString } from './phaseBoundary.js';

export const AGENT_LEARNING_EXCHANGE_SCHEMA = 'fbt.intent-agent-learning-exchange.v1';

const LESSON_KEYS = /^(?:chainOfThought|chain_of_thought|internalReasoning|chatText|message|rawTranscript|privateNotes)$/i;

function lessonRow(input, index) {
  if (!input || typeof input !== 'object') return null;
  if (Object.keys(input).some((key) => LESSON_KEYS.test(key))) return null;
  if (containsRawSecret(input)) return null;
  const kind = ['what-worked', 'what-failed', 'wrong-hypothesis', 'better-alternative'].includes(input.kind) ? input.kind : null;
  const lesson = safeString(String(input.lesson || input.summary || ''), 240);
  if (!kind || !lesson) return null;
  return {
    sequence: index + 1,
    kind,
    lesson,
    strategyClass: safeString(String(input.strategyClass || ''), 64) || null,
    riskClass: safeString(String(input.riskClass || ''), 64) || null,
    evidenceRows: Array.isArray(input.evidence) ? input.evidence.length : 0
  };
}

function isPrivateLessonKind(input) {
  // Private markers can arrive as payload keys OR as the lesson "kind" value.
  if (Object.keys(input).some((key) => LESSON_KEYS.test(key))) return true;
  return /chattext|privatenote|internalreasoning|chainofthought/.test(String(input.kind || '').toLowerCase());
}

/**
 * Create a learning exchange for a finished session. Opt-in must be explicit
 * for every participating agent; a missing opt-in returns opt-out and stores
 * nothing.
 */
export function createLearningExchange({ sessionId = null, participants = [], optIn = {}, lessons = [], now = Date.now() } = {}) {
  if (containsRawSecret({ sessionId, participants, optIn, lessons })) return fail('RAW_CREDENTIAL_FORBIDDEN');
  const session = safeId(sessionId);
  if (!session) return fail('SESSION_ID_REQUIRED');
  const optedInAgents = (Array.isArray(participants) ? participants : [])
    .map((agentId) => safeId(agentId) || safeString(String(agentId || ''), 80))
    .filter(Boolean)
    .filter((agentId) => optIn?.[agentId] === true);
  if (!participants.length) return fail('PARTICIPANTS_REQUIRED');
  if (!optedInAgents.length) {
    return noExecutionPermission({
      ok: true,
      schema: AGENT_LEARNING_EXCHANGE_SCHEMA,
      sessionId: session,
      status: 'opt-out',
      stored: false,
      lessons: [],
      note: 'No participant opted in; nothing is stored and nothing is exchanged.',
      exchangedAt: now
    });
  }
  const droppedPrivate = { privateText: 0, invalid: 0 };
  const rows = [];
  (Array.isArray(lessons) ? lessons : []).slice(0, 64).forEach((input, index) => {
    if (!input || typeof input !== 'object') { droppedPrivate.invalid += 1; return; }
    if (isPrivateLessonKind(input)) { droppedPrivate.privateText += 1; return; }
    const row = lessonRow(input, index);
    if (!row) { droppedPrivate.invalid += 1; return; }
    rows.push(row);
  });
  return noExecutionPermission({
    ok: true,
    schema: AGENT_LEARNING_EXCHANGE_SCHEMA,
    sessionId: session,
    status: 'opted-in',
    participants: optedInAgents,
    lessons: rows,
    droppedPrivate,
    containsPrivateChatText: false,
    uploadEnabled: false,
    pipeline: 'local-only',
    weakensGuardian: false,
    weakensRiskPolicy: false,
    exchangedAt: now
  });
}
