/**
 * FBT INTENT AI — COLLABORATION SESSION (Phase 4)
 * ---------------------------------------------------------------------------
 * A multi-agent collaboration session bound to a policy + a scoped session
 * key. Every message between agents is purely SOCIAL — it is never a command
 * and never executable. Execution only ever happens through Guardian + a
 * capability token on the execution path, never through a chat message.
 *
 * Hard rules:
 *   - A social message can never carry `command`, `execute`, `sign`, a raw
 *     credential, or a request to bypass Guardian.
 *   - Only agents listed in the session may speak; a stranger is rejected.
 *   - The session is bound to exactly one policy + one scoped session key.
 */

import { socialMessage, isSocialType } from './socialProtocol.js';
import { classifyFailure } from './failureModes.js';
import { isVerified } from './agentDirectory.js';

export const COLLAB_SCHEMA = 'fbt.collaboration-session.v1';

const FORBIDDEN_MESSAGE_WORDS = /command|execute|sign|bypass|secret|privatekey|mnemonic|withdraw|transfer/i;

/** Create a collaboration session among verified agents. */
export function createCollaborationSession({ agents = [], policy = null, sessionKeyScoped = null, agentIds = [] } = {}) {
  const participants = (agentIds.length ? agentIds : agents.map((a) => a.id))
    .filter((id) => agents.some((a) => a.id === id && isVerified(a)));
  if (!participants.length) {
    return { ok: false, error: classifyFailure('MISSING_DATA', { detail: 'NO_VERIFIED_PARTICIPANTS' }) };
  }
  if (!policy || typeof policy !== 'object') {
    return { ok: false, error: classifyFailure('MISSING_DATA', { detail: 'NO_POLICY' }) };
  }
  if (sessionKeyScoped?.ok !== true) {
    return { ok: false, error: classifyFailure('GUARDIAN_REJECTED', { detail: 'SESSION_KEY_INVALID' }) };
  }
  return {
    ok: true,
    session: Object.freeze({
      schema: COLLAB_SCHEMA,
      id: `collab_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
      participants: [...participants],
      policyId: policy.id || 'policy',
      sessionKeyHandle: sessionKeyScoped.scopedHandle || sessionKeyScoped.handle || null,
      messages: [],
      startedAt: Date.now()
    })
  };
}

/** True when a message is purely social (non-command, non-executable). */
export function isExecutableMessage(msg) {
  if (!msg || msg.isCommand === true || msg.isExecutable === true) return true;
  // Defensive: a message type that exists but carries a command-like key is bad.
  if (msg.detail && typeof msg.detail === 'object') {
    return Object.keys(msg.detail).some((k) => /command|execute|sign|secret|bypass/i.test(k));
  }
  return false;
}

/** Append a social message to the session. Rejects commands by construction. */
export function collaborationTurn(session, from, type, detail = {}) {
  if (!session || session.schema !== COLLAB_SCHEMA) {
    return { ok: false, error: classifyFailure('MISSING_DATA', { detail: 'NO_SESSION' }) };
  }
  if (!session.participants.includes(from)) {
    return { ok: false, error: classifyFailure('GUARDIAN_REJECTED', { detail: 'NON_PARTICIPANT' }) };
  }
  if (!isSocialType(type)) {
    return { ok: false, error: classifyFailure('UNKNOWN', { detail: `SOCIAL_TYPE:${type}` }) };
  }
  if (FORBIDDEN_MESSAGE_WORDS.test(JSON.stringify(detail))) {
    return { ok: false, error: classifyFailure('GUARDIAN_REJECTED', { detail: 'FORBIDDEN_MESSAGE_CONTENT' }) };
  }
  let msg;
  try {
    msg = socialMessage(from, '*', type, detail);
  } catch (e) {
    return { ok: false, error: classifyFailure('GUARDIAN_REJECTED', { detail: String(e.message || e) }) };
  }
  session.messages.push(msg);
  if (session.messages.length > 200) session.messages.shift();
  return { ok: true, message: msg };
}

/** Read the session transcript (immutable copy, no commands). */
export function readCollaborationTranscript(session) {
  if (!session || session.schema !== COLLAB_SCHEMA) return [];
  return session.messages.map((m) => ({ ...m }));
}
