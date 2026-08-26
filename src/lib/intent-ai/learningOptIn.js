/**
 * FBT INTENT AI — OPT-IN ANONYMOUS LEARNING (Phase 3)
 * ---------------------------------------------------------------------------
 * Records learning data ONLY after explicit user consent. Each record is
 * ANONYMOUS: it carries no address, no raw tx hash, no user id, no IP, no key,
 * no mnemonic. Without opt-in nothing is stored and nothing is sent.
 *
 * Hard rules:
 *   - Consent is explicit and per-record. `consent === true` is the only gate.
 *   - Records are bounded; the user may clear them at any time.
 *   - Learning NEVER weakens Guardian, Risk, or the Confirmation Gate.
 *   - Learning never claims guaranteed profit; it only stores observed outcome.
 *   - A record is honest: an unconfirmed outcome is flagged `unconfirmed`, and
 *     a rejected plan is recorded as a refusal, never as a success.
 */

import { classifyFailure } from './failureModes.js';
import { audit } from './audit.js';

export const LEARNING_SCHEMA = 'fbt.learning.opt-in.v1';

const STORE_KEY = 'fbt-learning-optin-v1';
const MAX_RECORDS = 200;

/* Keys that must never appear in a learning record. */
const FORBIDDEN_KEYS = new Set([
  'address', 'wallet', 'user', 'userId', 'ip', 'ipAddress', 'privateKey',
  'seed', 'mnemonic', 'password', 'secret', 'apiKey', 'apiSecret',
  'signature', 'brokerMasterCredential', 'txHash', 'tokenId'
]);

function safeRead() {
  try { return JSON.parse(globalThis.localStorage?.getItem(STORE_KEY) || '[]'); }
  catch { return []; }
}
function safeWrite(records) {
  try { globalThis.localStorage?.setItem(STORE_KEY, JSON.stringify(records.slice(0, MAX_RECORDS))); return true; }
  catch { return false; }
}

function redact(value, seen = new Set()) {
  if (value == null) return null;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value;
  if (seen.has(value)) return '[cyclic]';
  seen.add(value);
  if (Array.isArray(value)) return value.slice(0, 12).map((v) => redact(v, seen));
  const out = {};
  for (const [k, v] of Object.entries(value)) {
    if (FORBIDDEN_KEYS.has(k) || /^0x[a-fA-F0-9]{10,}$/.test(String(v))) { out[k] = '[REDACTED]'; continue; }
    out[k] = redact(v, seen);
  }
  return out;
}

/** Return the current consent state. */
export function learningConsent(session) {
  return session?.learningOptIn === true;
}

/**
 * Record a learning sample. Returns { ok } — but only stores when consent is on.
 * @param {object} session  must carry `learningOptIn: true`
 * @param {object} record   { kind, intent, strategy, outcome, confidence }
 */
export function recordLearningSample(session, record = {}) {
  if (!session || session.learningOptIn !== true) {
    return { ok: false, stored: false, error: classifyFailure('UNKNOWN', { detail: 'NO_OPTIN' }) };
  }
  if (!record || typeof record !== 'object' || !record.kind) {
    return { ok: false, stored: false, error: classifyFailure('MISSING_DATA', { detail: 'NO_RECORD' }) };
  }
  // Never store a fabricated success.
  if (record.outcome === 'COMPLETED' && record.confirmed !== true) {
    return { ok: false, stored: false, error: classifyFailure('UNKNOWN', { detail: 'FABRICATED_SUCCESS_REFUSED' }) };
  }
  const safe = redact({
    schema: LEARNING_SCHEMA,
    ts: Date.now(),
    kind: String(record.kind || 'outcome').slice(0, 32),
    intent: String(record.intent || '').slice(0, 64),
    strategy: String(record.strategy || '').slice(0, 64),
    outcome: String(record.outcome || 'unknown').slice(0, 32),
    confirmed: record.confirmed === true,
    confidence: Number(record.confidence) || 0,
    // Honest label: learning data never promises profit.
    disclaimer: 'NOT_GUARANTEED'
  });
  const records = safeRead();
  records.push(safe);
  if (records.length > MAX_RECORDS) records.splice(0, records.length - MAX_RECORDS);
  safeWrite(records);
  if (session?.audit) audit(session, 'fbt.learning', 'record.sample', { kind: safe.kind, outcome: safe.outcome }, 'ok');
  return { ok: true, stored: true, record: safe };
}

/** Read all stored learning samples (no secrets). */
export function loadLearningSamples() {
  return safeRead().filter((r) => r && r.schema === LEARNING_SCHEMA);
}

/** Clear all stored learning samples (user-controlled). */
export function clearLearningSamples() {
  return safeWrite([]);
}
