/**
 * FBT INTENT AI — Spec 65 item 48: Agent Chat Replay.
 *
 * After a session, the user can replay: decisions taken, reasons, warnings,
 * strategy switches and the outcome. The replay is built ONLY from structured
 * session events — never from private chain-of-thought text, and never with
 * secret material. A timeline containing free-form reasoning payloads is
 * rejected.
 */

import { containsRawSecret, fail, noExecutionPermission, safeId, safeString } from './phaseBoundary.js';

export const CHAT_REPLAY_SCHEMA = 'fbt.intent-chat-replay.v1';

export const REPLAY_EVENT_TYPES = Object.freeze([
  'decision', 'reason', 'warning', 'strategy-switch', 'clarification', 'authorization-screen', 'outcome'
]);

const FORBIDDEN_PAYLOAD_KEYS = /^(?:chainOfThought|chain_of_thought|internalReasoning|internal_reasoning|privateThoughts|hiddenPrompt|systemPrompt)$/i;

function eventRow(input, index) {
  if (!input || typeof input !== 'object' || containsRawSecret(input)) return null;
  for (const key of Object.keys(input)) {
    if (FORBIDDEN_PAYLOAD_KEYS.test(key)) return null;
  }
  const type = REPLAY_EVENT_TYPES.includes(input.type) ? input.type : null;
  if (!type) return null;
  return {
    sequence: Number.isFinite(Number(input.sequence)) ? Number(input.sequence) : index + 1,
    type,
    actor: safeId(input.actor) || safeString(String(input.actor || ''), 80) || null,
    summary: safeString(String(input.summary || input.reason || input.decision || ''), 240) || null,
    warning: type === 'warning' ? safeString(String(input.warning || input.summary || ''), 240) : null,
    fromStrategyId: safeId(input.fromStrategyId),
    toStrategyId: safeId(input.toStrategyId),
    at: Number.isFinite(Number(input.at)) ? Number(input.at) : null
  };
}

function isPrivateReasoning(input) {
  if (Object.keys(input).some((key) => FORBIDDEN_PAYLOAD_KEYS.test(key))) return true;
  const type = String(input.type || '').toLowerCase();
  return /chainofthought|internalreasoning|privatethought|hiddenprompt|systemprompt/.test(type);
}

/**
 * Build the replay from structured events. Private reasoning text and secret
 * material cause a rejection of the offending event (it is dropped and
 * counted), never a partial leak.
 */
export function buildSessionReplay({ sessionId = null, events = [], outcome = null, now = Date.now() } = {}) {
  if (containsRawSecret({ sessionId, events, outcome })) return fail('RAW_CREDENTIAL_FORBIDDEN');
  const id = safeId(sessionId);
  if (!id) return fail('SESSION_ID_REQUIRED');
  const dropped = { privateReasoning: 0, invalid: 0 };
  const rows = [];
  (Array.isArray(events) ? events : []).slice(0, 200).forEach((input, index) => {
    if (!input || typeof input !== 'object') { dropped.invalid += 1; return; }
    if (isPrivateReasoning(input)) { dropped.privateReasoning += 1; return; }
    const row = eventRow(input, index);
    if (!row) { dropped.invalid += 1; return; }
    rows.push(row);
  });
  rows.sort((a, b) => a.sequence - b.sequence);
  const safeOutcome = outcome && typeof outcome === 'object' && !containsRawSecret(outcome)
    ? {
        status: safeString(String(outcome.status || ''), 32) || null,
        verifiedReceipt: outcome.verifiedReceipt === true,
        note: 'Outcome is stated only from verified receipts; without one the session is not "completed".'
      }
    : { status: null, verifiedReceipt: false, note: 'Outcome is stated only from verified receipts; without one the session is not "completed".' };
  return noExecutionPermission({
    ok: true,
    schema: CHAT_REPLAY_SCHEMA,
    sessionId: id,
    events: rows,
    counts: {
      decisions: rows.filter((row) => row.type === 'decision').length,
      reasons: rows.filter((row) => row.type === 'reason').length,
      warnings: rows.filter((row) => row.type === 'warning').length,
      strategySwitches: rows.filter((row) => row.type === 'strategy-switch').length
    },
    strategySwitches: rows.filter((row) => row.type === 'strategy-switch').map((row) => ({ from: row.fromStrategyId, to: row.toStrategyId, summary: row.summary })),
    outcome: safeOutcome,
    dropped,
    containsPrivateChainOfThought: false,
    containsSecrets: false,
    builtAt: now
  });
}
