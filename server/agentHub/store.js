/**
 * FBT EXTERNAL AGENT HUB — durable rows (§11).
 * ---------------------------------------------------------------------------
 * The repository's storage is a key-value store: Upstash Redis when
 * `UPSTASH_REDIS_REST_URL/TOKEN` are set, Vercel Blob when only the blob token
 * is set, an in-process Map otherwise (`server/store.js`). This module follows
 * the FI convention (`server/fios/collections.js`) but with ONE deliberate
 * difference:
 *
 *   A TASK IS ITS OWN KEY, NOT A ROW IN A LIST.
 *
 * `collections.put()` reads the whole array, changes one row and writes it
 * back. Two concurrent requests on two serverless instances therefore lose one
 * another's writes — acceptable for a decision snapshot, unacceptable for the
 * record of a task that may have been created at a provider. Here each task
 * lives at `agenthub:task:v1:<owner>:<taskId>`, so a status update only ever
 * rewrites that one task. The per-owner index that makes `GET /tasks` possible
 * is a list, and it is written best-effort: a lost index entry is a history
 * row missing from a list, never a task that cannot be read by id.
 *
 * EVERY READ EXPOSES `durable`. Without a durable backend the rows live in one
 * process, and `/provider-health` says so instead of implying cloud storage. A
 * task that requires an account or a payment refuses to be created at all in
 * that mode (`DURABLE_STORE_REQUIRED`), because "we may or may not remember
 * that we charged you" is not a state a paid flow may enter.
 */
import { createHash } from 'node:crypto';
import { storeGet, storeGetFresh, storeSet, storeDurable } from '../store.js';

export const HUB_STORE_SCHEMA = 'fbt.agent-hub.store.v1';
export const PREFIX = 'agenthub';

const CAPS = Object.freeze({
  index: 200,
  events: 120,
  usage: 400,
  audit: 300,
  connections: 24,
  userSources: 8
});

const key = (collection, owner, extra = '') => `${PREFIX}:${collection}:v1:${String(owner).slice(0, 90)}${extra ? `:${extra}` : ''}`;

const asArray = (value) => (Array.isArray(value) ? value : []);
const shaKey = (value) => createHash('sha256').update(String(value)).digest('hex').slice(0, 32);

export function createHubStore({ now = () => Date.now(), log = () => {} } = {}) {
  const durable = () => storeDurable();

  async function readRaw(storageKey, fallback) {
    try {
      return await storeGet(storageKey, fallback);
    } catch (error) {
      log(`agenthub:read-failed:${String(error?.message || error).slice(0, 80)}`);
      return fallback;
    }
  }

  async function writeRaw(storageKey, value) {
    try {
      await storeSet(storageKey, value);
      return { ok: true, durable: durable() };
    } catch (error) {
      log(`agenthub:write-failed:${String(error?.message || error).slice(0, 80)}`);
      return { ok: false, code: 'STORE_WRITE_FAILED', durable: false };
    }
  }

  /* ── tasks ─────────────────────────────────────────────────────────────── */

  async function putTask(owner, task) {
    const saved = await writeRaw(key('task', owner, task.id), task);
    if (!saved.ok) return saved;
    await indexTask(owner, task);
    return { ok: true, durable: saved.durable, task };
  }

  async function indexTask(owner, task) {
    const storageKey = key('index', owner);
    const ids = asArray(await readRaw(storageKey, []));
    const next = [task.id, ...ids.filter((id) => id !== task.id)].slice(0, CAPS.index);
    await writeRaw(storageKey, next);
  }

  /** A task read that bypasses this process's warm cache: another instance may have advanced it. */
  async function getTask(owner, taskId) {
    try {
      const row = await storeGetFresh(key('task', owner, taskId), null);
      return row && typeof row === 'object' ? { ok: true, task: row } : { ok: false, code: 'TASK_NOT_FOUND' };
    } catch (error) {
      log(`agenthub:task-read-failed:${String(error?.message || error).slice(0, 80)}`);
      return { ok: false, code: 'STORE_READ_FAILED' };
    }
  }

  async function listTasks(owner, limit = 40) {
    const ids = asArray(await readRaw(key('index', owner), [])).slice(0, Math.max(1, Math.min(CAPS.index, limit)));
    const rows = [];
    for (const id of ids) {
      const got = await getTask(owner, id);
      if (got.ok) rows.push(got.task);
    }
    return { ok: true, tasks: rows, durable: durable() };
  }

  /**
   * The provider's task id → the row that owns it. A webhook arrives with ONLY
   * the provider's id; without this link it could not be attributed to an owner,
   * and the honest failure mode of an unattributable webhook is to drop it.
   */
  async function linkRemoteTask(providerId, remoteTaskId, { owner, taskId }) {
    if (!remoteTaskId) return { ok: false, code: 'REMOTE_TASK_ID_REQUIRED' };
    const storageKey = `${PREFIX}:remote:v1:${String(providerId).slice(0, 40)}:${shaKey(remoteTaskId)}`;
    return writeRaw(storageKey, { owner, taskId, providerId, remoteTaskId, at: now() });
  }

  async function resolveRemoteTask(providerId, remoteTaskId) {
    if (!remoteTaskId) return { ok: false, code: 'REMOTE_TASK_ID_REQUIRED' };
    const storageKey = `${PREFIX}:remote:v1:${String(providerId).slice(0, 40)}:${shaKey(remoteTaskId)}`;
    try {
      const row = await storeGetFresh(storageKey, null);
      return row && row.owner && row.taskId ? { ok: true, ...row } : { ok: false, code: 'REMOTE_TASK_UNKNOWN' };
    } catch {
      return { ok: false, code: 'STORE_READ_FAILED' };
    }
  }

  /* ── task events (append-only) ─────────────────────────────────────────── */

  async function appendEvent(owner, taskId, event) {
    const storageKey = key('events', owner, taskId);
    const rows = asArray(await readRaw(storageKey, []));
    const next = [...rows, { ...event, at: event.at || now() }].slice(-CAPS.events);
    const saved = await writeRaw(storageKey, next);
    return { ok: saved.ok, durable: saved.durable, count: next.length };
  }

  async function listEvents(owner, taskId) {
    return { ok: true, events: asArray(await readRaw(key('events', owner, taskId), [])) };
  }

  /* ── connections ───────────────────────────────────────────────────────── */

  async function putConnection(owner, connection) {
    return writeRaw(key('connection', owner, connection.id), connection);
  }

  async function getConnection(owner, connectionId) {
    try {
      const row = await storeGetFresh(key('connection', owner, connectionId), null);
      return row && typeof row === 'object' ? { ok: true, connection: row } : { ok: false, code: 'CONNECTION_NOT_FOUND' };
    } catch {
      return { ok: false, code: 'STORE_READ_FAILED' };
    }
  }

  async function listConnections(owner) {
    const ids = asArray(await readRaw(key('connections', owner), []));
    const rows = [];
    for (const id of ids.slice(0, CAPS.connections)) {
      const got = await getConnection(owner, id);
      if (got.ok) rows.push(got.connection);
    }
    return { ok: true, connections: rows, durable: durable() };
  }

  async function indexConnection(owner, connectionId) {
    const storageKey = key('connections', owner);
    const ids = asArray(await readRaw(storageKey, []));
    const next = [connectionId, ...ids.filter((id) => id !== connectionId)].slice(0, CAPS.connections);
    return writeRaw(storageKey, next);
  }

  async function deleteConnection(owner, connectionId) {
    /* Tombstone instead of a delete: an audit trail that can lose a row is not
       an audit trail. The credential itself is removed separately. */
    const found = await getConnection(owner, connectionId);
    if (!found.ok) return { ok: false, code: found.code };
    const tombstoned = { ...found.connection, status: 'REVOKED', revokedAt: now(), credentialRef: null };
    const saved = await putConnection(owner, tombstoned);
    return { ok: saved.ok, durable: saved.durable, connection: tombstoned };
  }

  /* ── user-supplied agent sources ─────────────────────────────────────────
     A row here is a card URL THE USER typed, not a reviewed listing. It is
     owner-scoped (the same URL added by two people is two rows, two ids) so a
     delete can never touch somebody else's source, and it is capped per owner
     because an unbounded list of outbound endpoints is a way to make the
     deployment do work for free. */

  async function putUserSource(owner, source) {
    return writeRaw(key('usource', owner, source.id), source);
  }

  async function getUserSource(owner, sourceId) {
    try {
      const row = await storeGetFresh(key('usource', owner, sourceId), null);
      return row && typeof row === 'object' ? { ok: true, source: row } : { ok: false, code: 'SOURCE_NOT_FOUND' };
    } catch {
      return { ok: false, code: 'STORE_READ_FAILED' };
    }
  }

  async function indexUserSource(owner, sourceId) {
    const storageKey = key('usources', owner);
    const ids = asArray(await readRaw(storageKey, []));
    const next = [sourceId, ...ids.filter((id) => id !== sourceId)].slice(0, CAPS.userSources);
    return writeRaw(storageKey, next);
  }

  async function listUserSources(owner) {
    const ids = asArray(await readRaw(key('usources', owner), [])).slice(0, CAPS.userSources);
    const rows = [];
    for (const id of ids) {
      const got = await getUserSource(owner, id);
      if (got.ok && got.source.status !== 'REMOVED') rows.push(got.source);
    }
    return { ok: true, sources: rows, durable: durable() };
  }

  async function deleteUserSource(owner, sourceId) {
    const found = await getUserSource(owner, sourceId);
    if (!found.ok) return { ok: false, code: found.code };
    /* Tombstone, same reason as a connection: the row is removed from the
       index but the record of it having existed survives. Nothing secret is
       in a source row — a card URL is already public. */
    const saved = await putUserSource(owner, { ...found.source, status: 'REMOVED', removedAt: now() });
    const storageKey = key('usources', owner);
    const ids = asArray(await readRaw(storageKey, [])).filter((id) => id !== sourceId);
    await writeRaw(storageKey, ids);
    return { ok: saved.ok, durable: saved.durable, source: { ...found.source, status: 'REMOVED', removedAt: now() } };
  }

  /* ── usage + audit ─────────────────────────────────────────────────────── */

  async function appendUsage(owner, row) {
    const storageKey = key('usage', owner);
    const rows = asArray(await readRaw(storageKey, []));
    const next = [{ ...row, at: row.at || now() }, ...rows].slice(0, CAPS.usage);
    return writeRaw(storageKey, next);
  }

  async function listUsage(owner, limit = 50) {
    return { ok: true, usage: asArray(await readRaw(key('usage', owner), [])).slice(0, limit) };
  }

  async function appendAudit(owner, row) {
    const storageKey = key('audit', owner);
    const rows = asArray(await readRaw(storageKey, []));
    const next = [{ ...row, at: row.at || now() }, ...rows].slice(0, CAPS.audit);
    return writeRaw(storageKey, next);
  }

  /* ── kill switches (durable, not process memory) ───────────────────────── */

  async function setKillSwitch(target, { tripped, reason = null, by = 'ops' }) {
    return writeRaw(key('kill', 'global', target), { target, tripped: Boolean(tripped), reason: reason ? String(reason).slice(0, 160) : null, by, at: now() });
  }

  async function getKillSwitch(target) {
    try {
      const row = await storeGetFresh(key('kill', 'global', target), null);
      return { ok: true, tripped: row?.tripped === true, reason: row?.reason || null, at: row?.at || null };
    } catch {
      /* Fail CLOSED on the global switch: if the store cannot be read we do not
         know whether an operator stopped the feature, so we behave as stopped. */
      return { ok: false, tripped: target === 'global', reason: 'KILL_SWITCH_UNREADABLE', at: null };
    }
  }

  return {
    schema: HUB_STORE_SCHEMA,
    caps: CAPS,
    durable,
    putTask, getTask, listTasks, indexTask,
    linkRemoteTask, resolveRemoteTask,
    appendEvent, listEvents,
    putConnection, getConnection, listConnections, indexConnection, deleteConnection,
    putUserSource, getUserSource, listUserSources, indexUserSource, deleteUserSource,
    appendUsage, listUsage, appendAudit,
    setKillSwitch, getKillSwitch,
    keyFor: key
  };
}
