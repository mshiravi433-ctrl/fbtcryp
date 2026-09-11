/**
 * FBT INTENT OS — THREAD SNAPSHOT PROBE.
 * ---------------------------------------------------------------------------
 * Proves switching options/tabs NEVER wipes a chat again:
 *
 *   A. save → load round-trip keeps text, roles and full card payloads
 *      (only the strategy plan's raw ecosystem `state` is lightened)
 *   B. each season keeps its own snapshot; resaving overwrites, never merges
 *   C. a greeting-only thread stores nothing; stale snapshots clear
 *   D. history archive + snapshot restore paths agree (click-to-restore UI)
 *   E. oversized threads trim to anchor + newest 60; storage stays bounded
 *      (at most THREAD_SNAPSHOTS_KEPT snapshots survive)
 *
 * The store injected here is an in-memory localStorage-shaped fake — the
 * real storage boundary is the only thing abstracted.
 * Run: node test/intent-ai/thread-snapshot-probe.mjs
 */

import {
  THREAD_SNAPSHOTS_KEPT,
  THREAD_SNAPSHOT_PREFIX,
  appendConversation,
  clearHistory,
  conversationsForSeason,
  loadThreadSnapshot,
  readHistory,
  saveThreadSnapshot,
  seasonsFromHistory
} from '../../src/lib/intent-ai/os/historyStore.js';

const rows = [];
const t = (name, ok, detail = '') => rows.push([`${name}${ok || !detail ? '' : ` — ${detail}`}`, Boolean(ok)]);

const memStore = () => {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { m.set(String(k), String(v)); },
    removeItem: (k) => { m.delete(String(k)); },
    key: (i) => [...m.keys()][i] ?? null,
    get length() { return m.size; }
  };
};
const snapshotKeys = (store) => {
  const out = [];
  for (let i = 0; i < store.length; i += 1) {
    const k = store.key(i);
    if (k && k.startsWith(THREAD_SNAPSHOT_PREFIX)) out.push(k);
  }
  return out;
};
const user = (text, over = {}) => ({ id: `m-${Math.random().toString(36).slice(2)}`, role: 'user', text, ts: Date.now(), ...over });

/* ── A. round-trip ────────────────────────────────────────────────────── */
{
  const store = memStore();
  const msgs = [user('hi'), { id: 'm-ai', role: 'assistant', text: 'plan', ts: Date.now(), strategyPlan: { chosen: 'x', state: { heavy: 1 } } }];
  t('snapshot saves', saveThreadSnapshot('season-a', msgs, { store }) === true);
  const loaded = loadThreadSnapshot('season-a', { store });
  t('texts and roles survive', loaded?.length === 2 && loaded[0].text === 'hi' && loaded[1].role === 'assistant');
  t('card payload survives lightened', loaded?.[1]?.strategyPlan?.chosen === 'x' && !('state' in (loaded?.[1]?.strategyPlan || {})));
  t('unknown season loads null', loadThreadSnapshot('season-x', { store }) === null);
}

/* ── B. seasons stay separate ─────────────────────────────────────────── */
{
  const store = memStore();
  saveThreadSnapshot('season-a', [user('for-a')], { store });
  saveThreadSnapshot('season-b', [user('for-b')], { store });
  t('each season keeps its own thread',
    loadThreadSnapshot('season-a', { store })[0].text === 'for-a'
    && loadThreadSnapshot('season-b', { store })[0].text === 'for-b');
  saveThreadSnapshot('season-a', [user('for-a2')], { store });
  t('resaving overwrites, never merges', loadThreadSnapshot('season-a', { store })[0].text === 'for-a2');
}

/* ── C. greeting-only threads store nothing ───────────────────────────── */
{
  const store = memStore();
  t('empty thread is a no-op', saveThreadSnapshot('season-g', [], { store }) === true);
  t('nothing stored for empty thread', loadThreadSnapshot('season-g', { store }) === null);
  saveThreadSnapshot('season-g', [{ id: 'm-h', role: 'assistant', kind: 'hello', text: 'سلام!', ts: 1 }], { store });
  t('hello-only thread stores nothing', loadThreadSnapshot('season-g', { store }) === null && snapshotKeys(store).length === 0);
}

/* ── D. archive + snapshot agree ──────────────────────────────────────── */
{
  const store = memStore();
  const convId = 'conv-restore-1';
  const seasonId = 'season-restore';
  const turn = user('saved before', { id: 'm-src-1' });
  saveThreadSnapshot(seasonId, [turn], { store });
  appendConversation({ role: 'user', content: 'saved before', conversationId: convId, seasonId, sourceId: 'm-src-1' }, { store });
  const history = readHistory({ store });
  t('history recorded the turn', history.conversations.length === 1);
  const list = conversationsForSeason(seasonId, { history });
  t('season lists its turn', list.length === 1 && list[0].content === 'saved before');
  t('restore path finds the snapshot', loadThreadSnapshot(list[0].seasonId, { store })?.[0]?.text === 'saved before');
  t('seasons index agrees', seasonsFromHistory({ history })[0]?.seasonId === seasonId);
  t('revisiting never duplicates the archive',
    appendConversation({ role: 'user', content: 'saved before', conversationId: convId, seasonId, sourceId: 'm-src-1' }, { store }) === null
    && readHistory({ store }).conversations.length === 1);
  clearHistory({ store });
  t('clearHistory empties the archive', readHistory({ store }).conversations.length === 0);
}

/* ── E. trimming + bounds ─────────────────────────────────────────────── */
{
  const store = memStore();
  const msgs = [user('anchor')];
  for (let i = 0; i < 200; i += 1) msgs.push(user(`turn-${i} ${'x'.repeat(5000)}`));
  t('oversized thread still saves', saveThreadSnapshot('season-big', msgs, { store }) === true);
  const loaded = loadThreadSnapshot('season-big', { store });
  t('trim keeps the anchor plus the tail',
    Array.isArray(loaded) && loaded.length <= 61 && loaded[0].text === 'anchor' && /turn-199/.test(loaded[loaded.length - 1].text));
}
{
  const store = memStore();
  for (let i = 0; i < THREAD_SNAPSHOTS_KEPT + 4; i += 1) {
    saveThreadSnapshot(`season-${i}`, [user(`t${i}`)], { store });
  }
  const keys = snapshotKeys(store);
  t(`at most ${THREAD_SNAPSHOTS_KEPT} snapshots survive`, keys.length === THREAD_SNAPSHOTS_KEPT);
  t('the newest season survives', loadThreadSnapshot(`season-${THREAD_SNAPSHOTS_KEPT + 3}`, { store })?.[0]?.text === `t${THREAD_SNAPSHOTS_KEPT + 3}`);
}

const threadSnapshotFailed = rows.filter(([, ok]) => !ok);
console.log(`\nthread-snapshot probe: ${rows.length - threadSnapshotFailed.length}/${rows.length} passed`);
if (threadSnapshotFailed.length) {
  console.error(threadSnapshotFailed.map(([name]) => `  ✗ ${name}`).join('\n'));
  process.exit(1);
}
console.log('OK: intent-ai/thread-snapshot-probe');
export default rows;
