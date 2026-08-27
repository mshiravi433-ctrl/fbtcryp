/**
 * PHASE 76 — USER-VISIBLE AUDIT TIMELINE
 * The log already exists; this is the part a person reads. Own events only,
 * append-only, translatable rows, and no secret ever reaches the screen.
 */
import { readFileSync } from 'node:fs';
import {
  buildTimeline, toTimelineRow, assertAppendOnly, assertTimelineSafe,
  TIMELINE_SCHEMA, TIMELINE_GROUPS, TIMELINE_MAX_ROWS
} from '../../src/lib/intent-ai/index.js';

const results = [];
const check = (name, ok) => results.push({ name, ok: Boolean(ok) });

const ME = 'tg:987654';
const NOW = 1_800_000_000_000;
const e = (over = {}) => ({ id: 'a1', ts: NOW - 1000, ownerId: ME, actor: 'user', action: 'gate_confirmed', outcome: 'ok', detail: { intentId: 'i1' }, ...over });

const ENTRIES = [
  e({ id: 'a1', ts: NOW - 5000, action: 'intent_created' }),
  e({ id: 'a2', ts: NOW - 4000, action: 'gate_opened' }),
  e({ id: 'a3', ts: NOW - 3000, action: 'gate_confirmed' }),
  e({ id: 'a4', ts: NOW - 2000, action: 'order_submitted', actor: 'system' }),
  e({ id: 'a5', ts: NOW - 1000, action: 'order_confirmed', actor: 'system' }),
  e({ id: 'b1', ts: NOW - 1500, ownerId: 'tg:someone-else', action: 'order_confirmed' }),
  e({ id: 'c1', ts: NOW - 1200, ownerId: null, action: 'order_confirmed' })
];

try {
  /* ---------- own events only ---------- */
  const tl = buildTimeline({ entries: ENTRIES, viewerId: ME, now: NOW });
  check('the timeline builds', tl.ok === true && tl.schema === TIMELINE_SCHEMA);
  check('only my events are shown', tl.rows.length === 5);
  check("another user's event is excluded", tl.rows.every((r) => r.id !== 'b1'));
  check('an ownerless event is excluded, not assumed mine', tl.rows.every((r) => r.id !== 'c1'));
  check('the exclusions are counted honestly', tl.excludedCount === 2);
  check('a filtered timeline does not claim completeness', tl.complete === false);
  check('the filtering is said out loud', tl.i18nKey === 'intentAI.timeline.filtered');
  check('the counts are in the params', tl.i18nParams.shown === 5 && tl.i18nParams.hidden === 2);
  const mineOnly = buildTimeline({ entries: ENTRIES.slice(0, 5), viewerId: ME, now: NOW });
  check('a clean timeline reports itself complete', mineOnly.complete === true && mineOnly.i18nKey === 'intentAI.timeline.complete');
  check('with no viewer identity NOTHING is shown', buildTimeline({ entries: ENTRIES, now: NOW }).rows.length === 0);
  check('the missing identity is reported, not guessed', buildTimeline({ entries: ENTRIES, now: NOW }).i18nKey === 'intentAI.timeline.unavailable');
  check('an empty log is empty, not an error', buildTimeline({ entries: [], viewerId: ME, now: NOW }).ok === true);

  /* ---------- rows are readable and translatable ---------- */
  const row = tl.rows.find((r) => r.id === 'a3');
  check('every row is an i18n key', tl.rows.every((r) => r.i18nKey.startsWith('intentAI.timeline.action.')));
  check('a confirmation reads as a confirmation', row.i18nKey === 'intentAI.timeline.action.gate_confirmed');
  check('rows carry a fallback key for unknown actions', row.fallbackI18nKey === 'intentAI.timeline.action.unknown');
  check('an unknown action lands in the system group',
    toTimelineRow(e({ action: 'something_new' }), { viewerId: ME }).group === 'system');
  check('approvals are grouped as approvals', row.group === 'approval');
  check('executions are grouped as executions', tl.rows.find((r) => r.id === 'a4').group === 'execution');
  check('every group is a known group', tl.rows.every((r) => TIMELINE_GROUPS.includes(r.group)));
  check('the group counts add up', Object.values(tl.groups).reduce((a, b) => a + b, 0) === tl.rows.length);
  check('the newest event is first', tl.rows[0].id === 'a5');
  check('an entry with no timestamp is dropped', toTimelineRow(e({ ts: null }), { viewerId: ME }) === null);
  check('an entry with no action is dropped', toTimelineRow(e({ action: null }), { viewerId: ME }) === null);
  check('a non-entry is dropped', toTimelineRow(null, { viewerId: ME }) === null);

  /* ---------- nothing secret reaches the screen ---------- */
  const secret = toTimelineRow(e({ detail: { recipient: '0x'.concat('a'.repeat(40)), mnemonic: 'word word', amount: 5 } }), { viewerId: ME });
  check('an address in the detail is redacted', secret.i18nParams.recipient === '[REDACTED]');
  check('a seed phrase field is redacted', secret.i18nParams.mnemonic === '[REDACTED]');
  check('ordinary numbers survive', secret.i18nParams.amount === 5);
  check('the row declares itself secret-free', secret.containsSecrets === false);

  /* ---------- append-only ---------- */
  const before = mineOnly.rows;
  const after = buildTimeline({ entries: [...ENTRIES.slice(0, 5), e({ id: 'a6', ts: NOW, action: 'order_confirmed' })], viewerId: ME, now: NOW }).rows;
  check('adding a new event is append-only', assertAppendOnly(before, after).ok === true);
  check('the number added is reported', assertAppendOnly(before, after).added === 1);
  check('deleting an event is caught', assertAppendOnly(before, before.slice(1)).ok === false);
  check('the deletion is named', assertAppendOnly(before, before.slice(1)).reason === 'ENTRIES_REMOVED');
  const mutated = before.map((r, i) => (i === 2 ? { ...r, at: r.at + 1 } : r));
  check('rewriting an old event is caught', assertAppendOnly(before, mutated).ok === false);
  check('the mutation is named', assertAppendOnly(before, mutated).reason === 'ENTRY_MUTATED');
  check('an unchanged timeline is append-only with nothing added', assertAppendOnly(before, before).added === 0);

  /* ---------- the render guard ---------- */
  check('the guard accepts an honest timeline', assertTimelineSafe(tl).ok === true);
  check('the guard rejects a foreign row',
    assertTimelineSafe({ ...tl, rows: [...tl.rows, { id: 'x', at: NOW, ownerId: 'tg:other', i18nKey: 'intentAI.timeline.action.unknown', i18nParams: {} }] }).reasons.includes('FOREIGN_ENTRY'));
  check('the guard rejects a duplicated entry',
    assertTimelineSafe({ ...tl, rows: [...tl.rows, tl.rows[0]] }).reasons.includes('DUPLICATE_ENTRY'));
  check('the guard rejects a leaked address',
    assertTimelineSafe({ ...tl, rows: [{ id: 'z', at: NOW, i18nKey: 'intentAI.timeline.action.unknown', i18nParams: { to: '0x'.concat('b'.repeat(40)) } }] }).reasons.includes('SECRET_IN_TIMELINE'));
  check('the guard rejects raw prose instead of a key',
    assertTimelineSafe({ ...tl, rows: [{ id: 'z', at: NOW, i18nKey: 'You did a thing', i18nParams: {} }] }).reasons.includes('UNTRANSLATED_ROW'));
  check('the guard rejects an out-of-order timeline',
    assertTimelineSafe({ ...tl, rows: [{ id: 'p', at: NOW - 9000, i18nKey: 'intentAI.timeline.action.unknown', i18nParams: {} }, { id: 'q', at: NOW, i18nKey: 'intentAI.timeline.action.unknown', i18nParams: {} }] }).reasons.includes('OUT_OF_ORDER'));
  check('the guard rejects a non-timeline', assertTimelineSafe({ rows: [] }).ok === false);
  check('the timeline is bounded', TIMELINE_MAX_ROWS > 0 && TIMELINE_MAX_ROWS <= 1000);

  const locales = ['en', 'fa', 'ar'].map((l) => JSON.parse(readFileSync(`src/i18n/locales/${l}.json`, 'utf8')));
  check('the timeline chrome is translated in en, fa and ar',
    locales.every((loc) => ['title', 'complete', 'filtered', 'unavailable', 'empty'].every((k) => typeof loc?.intentAI?.timeline?.[k] === 'string')));
  check('every action row this probe produced has a translation in all three languages',
    locales.every((loc) => [...new Set(tl.rows.map((r) => r.i18nKey.split('.').pop()))]
      .every((k) => typeof loc?.intentAI?.timeline?.action?.[k] === 'string')));
  check('the unknown-action fallback is translated everywhere',
    locales.every((loc) => typeof loc?.intentAI?.timeline?.action?.unknown === 'string'));

  console.log(JSON.stringify({ probe: 'phase76-audit-timeline', passed: results.filter((r) => r.ok).length, results }, null, 2));
  if (results.some((r) => !r.ok)) process.exitCode = 1;
} catch (e2) {
  console.error(e2);
  process.exitCode = 1;
}

export default results;
