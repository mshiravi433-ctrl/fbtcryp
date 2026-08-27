/**
 * FBT INTENT AI — PHASE 76: USER-VISIBLE AUDIT TIMELINE
 * ---------------------------------------------------------------------------
 * `audit.js` already records every decision. Phase 76 is the part that matters
 * to a person: turning that append-only log into a timeline they can read,
 * scoped strictly to their own events.
 *
 *   · OWN EVENTS ONLY. An entry with no owner, or another owner, is dropped —
 *     not rendered greyed out, not summarised. Dropped.
 *   · every row is an i18n key plus params, so the timeline is translatable
 *   · the log is append-only; a timeline whose entries are out of order or
 *     whose ids repeat is reported as tampered rather than quietly sorted
 *   · no secrets: the timeline re-checks redaction instead of trusting it
 */

import { classifyFailure } from './failureModes.js';

export const TIMELINE_SCHEMA = 'fbt.audit-timeline.v1';
export const TIMELINE_MAX_ROWS = 500;

export const TIMELINE_GROUPS = Object.freeze(['intent', 'approval', 'execution', 'safety', 'system']);

const ACTION_GROUP = Object.freeze({
  intent_created: 'intent', intent_parsed: 'intent', plan_built: 'intent',
  gate_opened: 'approval', gate_confirmed: 'approval', gate_rejected: 'approval',
  reauthorization_requested: 'approval',
  order_submitted: 'execution', order_confirmed: 'execution', order_failed: 'execution',
  guardian_review: 'safety', risk_blocked: 'safety', emergency_stop: 'safety',
  session_key_revoked: 'safety', simulation_failed: 'safety'
});

const SECRET_PATTERNS = [/^0x[a-f0-9]{40}$/i, /\b(seed|mnemonic|privateKey|private_key)\b/i];

const num = (v) => (v === null || v === undefined || v === '' || typeof v === 'boolean'
  ? null
  : (Number.isFinite(Number(v)) ? Number(v) : null));

function looksSecret(value) {
  if (typeof value !== 'string') return false;
  return SECRET_PATTERNS.some((re) => re.test(value));
}

function scrub(detail) {
  if (!detail || typeof detail !== 'object') return null;
  const out = {};
  for (const [k, v] of Object.entries(detail)) {
    if (typeof v === 'string' && looksSecret(v)) { out[k] = '[REDACTED]'; continue; }
    if (SECRET_PATTERNS[1].test(k)) { out[k] = '[REDACTED]'; continue; }
    if (v && typeof v === 'object') continue;
    out[k] = v;
  }
  return out;
}

/** One audit entry → one readable, translatable row (or null if not mine). */
export function toTimelineRow(entry, { viewerId = null } = {}) {
  if (!entry || typeof entry !== 'object') return null;
  const owner = typeof entry.ownerId === 'string' ? entry.ownerId : null;
  // Fail closed on ownership: unknown owner is not "probably mine".
  if (!viewerId || !owner || owner !== viewerId) return null;
  const action = typeof entry.action === 'string' ? entry.action : null;
  const ts = num(entry.ts);
  if (!action || ts === null) return null;
  const group = ACTION_GROUP[action] || 'system';
  return {
    id: typeof entry.id === 'string' ? entry.id : null,
    at: ts,
    group,
    actor: typeof entry.actor === 'string' ? entry.actor : 'system',
    outcome: entry.outcome === 'error' ? 'error' : (entry.outcome === 'warn' ? 'warn' : 'ok'),
    i18nKey: `intentAI.timeline.action.${action}`,
    fallbackI18nKey: 'intentAI.timeline.action.unknown',
    i18nParams: scrub(entry.detail) || {},
    containsSecrets: false
  };
}

/**
 * Build the timeline. Anything not provably the viewer's is excluded and
 * counted, so the UI can honestly say "some entries are not shown".
 */
export function buildTimeline({ entries = [], viewerId = null, now = Date.now() } = {}) {
  const list = Array.isArray(entries) ? entries : [];
  if (!viewerId) {
    return {
      ok: false, schema: TIMELINE_SCHEMA, rows: [], excludedCount: list.length,
      i18nKey: 'intentAI.timeline.unavailable',
      error: classifyFailure('MISSING_DATA', { detail: 'NO_VIEWER_IDENTITY' })
    };
  }
  const rows = [];
  let excluded = 0;
  for (const e of list) {
    const row = toTimelineRow(e, { viewerId });
    if (row) rows.push(row); else excluded += 1;
  }
  rows.sort((a, b) => b.at - a.at);
  const capped = rows.slice(0, TIMELINE_MAX_ROWS);
  return {
    ok: true,
    schema: TIMELINE_SCHEMA,
    viewerId,
    rows: capped,
    total: rows.length,
    truncated: rows.length > capped.length,
    excludedCount: excluded,
    // "Complete" means every entry we were given was ours.
    complete: excluded === 0 && rows.length === capped.length,
    groups: TIMELINE_GROUPS.reduce((acc, g) => ({ ...acc, [g]: capped.filter((r) => r.group === g).length }), {}),
    i18nKey: excluded === 0 ? 'intentAI.timeline.complete' : 'intentAI.timeline.filtered',
    i18nParams: { shown: capped.length, hidden: excluded },
    builtAt: now
  };
}

/** Append-only means: same ids, same order, only additions at the head. */
export function assertAppendOnly(previousRows = [], nextRows = []) {
  const prev = Array.isArray(previousRows) ? previousRows : [];
  const next = Array.isArray(nextRows) ? nextRows : [];
  if (next.length < prev.length) {
    return { ok: false, reason: 'ENTRIES_REMOVED', error: classifyFailure('MISSING_DATA', { detail: 'AUDIT_ENTRIES_REMOVED' }) };
  }
  const tail = next.slice(next.length - prev.length);
  for (let i = 0; i < prev.length; i += 1) {
    if (tail[i]?.id !== prev[i]?.id || tail[i]?.at !== prev[i]?.at) {
      return { ok: false, reason: 'ENTRY_MUTATED', index: i, error: classifyFailure('MISSING_DATA', { detail: 'AUDIT_ENTRY_MUTATED' }) };
    }
  }
  return { ok: true, added: next.length - prev.length };
}

/** A last line of defence before anything is rendered to the user. */
export function assertTimelineSafe(timeline) {
  const reasons = [];
  if (!timeline || timeline.schema !== TIMELINE_SCHEMA) reasons.push('NOT_A_TIMELINE');
  const rows = Array.isArray(timeline?.rows) ? timeline.rows : [];
  const ids = new Set();
  for (const r of rows) {
    if (r.id && ids.has(r.id)) reasons.push('DUPLICATE_ENTRY');
    if (r.id) ids.add(r.id);
    if (timeline.viewerId && r.ownerId && r.ownerId !== timeline.viewerId) reasons.push('FOREIGN_ENTRY');
    for (const v of Object.values(r.i18nParams || {})) {
      if (looksSecret(v)) reasons.push('SECRET_IN_TIMELINE');
    }
    if (typeof r.i18nKey !== 'string' || !r.i18nKey.startsWith('intentAI.')) reasons.push('UNTRANSLATED_ROW');
  }
  for (let i = 1; i < rows.length; i += 1) {
    if (rows[i].at > rows[i - 1].at) reasons.push('OUT_OF_ORDER');
  }
  const unique = [...new Set(reasons)];
  return unique.length
    ? { ok: false, reasons: unique, error: classifyFailure('MISSING_DATA', { detail: unique[0] }) }
    : { ok: true, rows: rows.length };
}
