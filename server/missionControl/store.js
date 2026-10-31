/**
 * Mission Control's transactional authority. Never use the legacy Blob/Map for
 * queue leases: last-writer-wins can execute a task twice. SQLite is local to a
 * SINGLE durable Node volume. Multiple processes may share that local database;
 * multiple hosts must use one worker, not independent copies of this file.
 */
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';

export const MISSION_STATUSES = Object.freeze(['Pending', 'Planning', 'Running', 'Waiting Approval', 'Completed', 'Failed', 'Paused', 'Cancelled']);
export const TASK_STATUSES = Object.freeze(['queued', 'running', 'completed', 'failed', 'cancelled']);
export const hash = (value) => createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');
export const newId = (prefix) => `${prefix}_${randomUUID()}`;
const json = (value) => JSON.stringify(value ?? null);
const parse = (row, fields) => row ? { ...row, ...Object.fromEntries(fields.map((k) => [k, JSON.parse(row[k] ?? 'null')])) } : null;
const MISSION_JSON = ['plan', 'permissions', 'schedule', 'result', 'error', 'input', 'approval'];
const TASK_JSON = ['input', 'depends_on', 'output', 'error'];
export class MissionError extends Error {
  constructor(code, status = 400) { super(code); this.code = code; this.status = status; }
}

export function createMissionStore({ path = ':memory:', now = () => Date.now() } = {}) {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
  // A migration and its version marker commit together. Never silently reuse a
  // database written by a newer release.
  const version = db.prepare('PRAGMA user_version').get().user_version;
  if (version > 1) throw new MissionError('DATABASE_VERSION_UNSUPPORTED', 503);
  if (version === 0) {
    db.exec(`BEGIN IMMEDIATE;
      CREATE TABLE missions (
        id TEXT PRIMARY KEY, owner TEXT NOT NULL, goal TEXT NOT NULL, kind TEXT NOT NULL,
        status TEXT NOT NULL, priority INTEGER NOT NULL DEFAULT 5, input TEXT NOT NULL,
        plan TEXT NOT NULL, permissions TEXT NOT NULL, schedule TEXT,
        result TEXT, error TEXT, approval TEXT, fingerprint TEXT NOT NULL,
        idempotency_key TEXT NOT NULL, due_at INTEGER NOT NULL,
        created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, completed_at INTEGER,
        version INTEGER NOT NULL DEFAULT 1,
        UNIQUE(owner,idempotency_key)
      );
      CREATE INDEX mission_owner ON missions(owner,created_at DESC);
      CREATE INDEX mission_due ON missions(status,due_at,priority);
      CREATE TABLE tasks (
        id TEXT PRIMARY KEY, mission_id TEXT NOT NULL REFERENCES missions(id),
        agent_id TEXT NOT NULL, tool_id TEXT NOT NULL, status TEXT NOT NULL,
        input TEXT NOT NULL, depends_on TEXT NOT NULL, output TEXT, error TEXT,
        evidence_id TEXT, attempts INTEGER NOT NULL DEFAULT 0, max_attempts INTEGER NOT NULL DEFAULT 3,
        timeout_ms INTEGER NOT NULL, available_at INTEGER NOT NULL, lease_until INTEGER,
        worker_id TEXT, lease_token TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
        UNIQUE(mission_id,agent_id)
      );
      CREATE INDEX task_claim ON tasks(status,available_at,lease_until);
      CREATE TABLE evidence (
        id TEXT PRIMARY KEY, mission_id TEXT NOT NULL REFERENCES missions(id),
        task_id TEXT REFERENCES tasks(id), owner TEXT NOT NULL,
        source TEXT NOT NULL, source_url TEXT, received_at INTEGER NOT NULL,
        observed_at INTEGER, expires_at INTEGER NOT NULL, raw_json TEXT NOT NULL,
        raw_sha256 TEXT NOT NULL, origin TEXT NOT NULL, producer TEXT NOT NULL,
        status TEXT NOT NULL, verification TEXT, tx_ref TEXT, created_at INTEGER NOT NULL
      );
      CREATE INDEX evidence_mission ON evidence(mission_id,received_at);
      CREATE TABLE events (
        seq INTEGER PRIMARY KEY AUTOINCREMENT, owner TEXT NOT NULL,
        mission_id TEXT, type TEXT NOT NULL, payload TEXT NOT NULL, created_at INTEGER NOT NULL
      );
      CREATE INDEX event_owner ON events(owner,seq);
      CREATE TABLE observations (
        id TEXT PRIMARY KEY, instrument TEXT NOT NULL, metric TEXT NOT NULL,
        asset_class TEXT NOT NULL, value_num REAL NOT NULL, received_at INTEGER NOT NULL,
        evidence_id TEXT NOT NULL REFERENCES evidence(id)
      );
      CREATE INDEX observation_history ON observations(instrument,metric,received_at DESC);
      CREATE TABLE predictions (
        id TEXT PRIMARY KEY, owner TEXT NOT NULL, mission_id TEXT NOT NULL REFERENCES missions(id),
        agent_id TEXT NOT NULL, instrument TEXT NOT NULL, direction TEXT NOT NULL,
        probability REAL NOT NULL, baseline REAL NOT NULL, baseline_evidence TEXT NOT NULL,
        due_at INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'pending',
        outcome_evidence TEXT, brier REAL, correct INTEGER, created_at INTEGER NOT NULL
      );
      CREATE INDEX prediction_due ON predictions(status,due_at);
      CREATE TABLE policies (
        id TEXT PRIMARY KEY, owner TEXT NOT NULL, version INTEGER NOT NULL,
        policy TEXT NOT NULL, previous_id TEXT, created_at INTEGER NOT NULL,
        UNIQUE(owner,version)
      );
      CREATE TABLE state (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at INTEGER NOT NULL);
      PRAGMA user_version=1; COMMIT;`);
  }
  const q = (sql) => db.prepare(sql);
  function tx(fn) {
    db.exec('BEGIN IMMEDIATE');
    try { const result = fn(); db.exec('COMMIT'); return result; }
    catch (error) { db.exec('ROLLBACK'); throw error; }
  }
  function event(owner, type, payload = {}, missionId = null) {
    q('INSERT INTO events(owner,mission_id,type,payload,created_at) VALUES(?,?,?,?,?)')
      .run(owner, missionId, type, json(payload), now());
  }
  function mission(id, owner = null) {
    const row = owner ? q('SELECT * FROM missions WHERE id=? AND owner=?').get(id, owner) : q('SELECT * FROM missions WHERE id=?').get(id);
    if (!row) throw new MissionError('MISSION_NOT_FOUND', 404);
    return parse(row, MISSION_JSON);
  }
  function task(id) {
    const row = q('SELECT * FROM tasks WHERE id=?').get(id);
    if (!row) throw new MissionError('TASK_NOT_FOUND', 404);
    return parse(row, TASK_JSON);
  }
  function setMission(id, patch, expectedVersion = null, { completionVerified = false } = {}) {
    if (patch.status === 'Completed' && !completionVerified) throw new MissionError('EVIDENCE_REQUIRED_FOR_COMPLETION', 409);
    const m = mission(id);
    if (expectedVersion !== null && m.version !== expectedVersion) throw new MissionError('STALE_VERSION', 409);
    const next = { ...m, ...patch };
    if (!MISSION_STATUSES.includes(next.status)) throw new MissionError('INVALID_STATUS');
    q(`UPDATE missions SET status=?,plan=?,permissions=?,schedule=?,result=?,error=?,approval=?,due_at=?,updated_at=?,completed_at=?,version=version+1 WHERE id=?`)
      .run(next.status, json(next.plan), json(next.permissions), json(next.schedule), json(next.result), json(next.error), json(next.approval), next.due_at, now(), next.completed_at ?? null, id);
    if (m.status !== next.status) event(m.owner, 'mission.status', { from: m.status, to: next.status }, id);
    return mission(id);
  }
  function createMission(input) {
    const at = now();
    return tx(() => {
      const existing = q('SELECT id FROM missions WHERE owner=? AND idempotency_key=?').get(input.owner, input.idempotencyKey);
      if (existing) {
        const m = mission(existing.id);
        if (m.fingerprint !== input.fingerprint) throw new MissionError('IDEMPOTENCY_CONFLICT', 409);
        return { mission: m, duplicate: true };
      }
      const active = q("SELECT count(*) n FROM missions WHERE owner=? AND status NOT IN ('Completed','Failed','Cancelled')").get(input.owner).n;
      if (active >= (input.maxActive ?? 20)) throw new MissionError('MISSION_QUOTA_REACHED', 429);
      const id = newId('mis');
      q(`INSERT INTO missions(id,owner,goal,kind,status,priority,input,plan,permissions,schedule,fingerprint,idempotency_key,due_at,created_at,updated_at)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(id, input.owner, input.goal, input.kind, 'Pending', input.priority, json(input.input), json(input.plan), json(input.permissions), json(input.schedule), input.fingerprint, input.idempotencyKey, input.dueAt ?? at, at, at);
      event(input.owner, 'mission.created', { goal: input.goal, kind: input.kind }, id);
      return { mission: mission(id), duplicate: false };
    });
  }
  function finishMission(id, result, verify) {
    return tx(() => {
      verify(this, id);
      return setMission(id, { status: 'Completed', result, error: null, completed_at: now() }, null, { completionVerified: true });
    });
  }
  function addTasks(missionId, tasks) {
    return tx(() => {
      const m = mission(missionId);
      for (const t of tasks) {
        if (q('SELECT id FROM tasks WHERE mission_id=? AND agent_id=?').get(missionId, t.agentId)) continue;
        const at = now();
        q(`INSERT INTO tasks(id,mission_id,agent_id,tool_id,status,input,depends_on,max_attempts,timeout_ms,available_at,created_at,updated_at)
          VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`).run(newId('task'), missionId, t.agentId, t.toolId, 'queued', json(t.input || {}), json(t.dependsOn || []), t.maxAttempts ?? 3, t.timeoutMs ?? 30000, m.due_at, at, at);
      }
      return m;
    });
  }
  function tasksFor(missionId) { return q('SELECT * FROM tasks WHERE mission_id=? ORDER BY created_at,rowid').all(missionId).map((r) => parse(r, TASK_JSON)); }
  function recover() {
    return tx(() => {
      const at = now();
      const expired = q("SELECT * FROM tasks WHERE status='running' AND lease_until<=?").all(at).map((r) => parse(r, TASK_JSON));
      for (const t of expired) {
        // No write/sign adapter is permitted in this release. If one is added,
        // UNKNOWN_EFFECT must be reconciled before any replay, never retried.
        const retry = t.attempts < t.max_attempts;
        q('UPDATE tasks SET status=?,worker_id=NULL,lease_token=NULL,lease_until=NULL,available_at=?,error=?,updated_at=? WHERE id=?')
          .run(retry ? 'queued' : 'failed', at, json({ code: retry ? 'LEASE_RECOVERED' : 'RETRIES_EXHAUSTED' }), at, t.id);
        const m = mission(t.mission_id);
        event(m.owner, 'task.recovered', { taskId: t.id, agentId: t.agent_id, retry }, m.id);
        if (!retry) setMission(m.id, { status: 'Failed', error: { code: 'RETRIES_EXHAUSTED', taskId: t.id }, completed_at: at });
      }
      return expired.length;
    });
  }
  function claim(workerId, { concurrency = 4, leaseMs = 45000 } = {}) {
    return tx(() => {
      const at = now();
      if (q("SELECT count(*) n FROM tasks WHERE status='running' AND lease_until>?").get(at).n >= concurrency) return null;
      const t = q(`SELECT t.* FROM tasks t JOIN missions m ON m.id=t.mission_id
        WHERE t.status='queued' AND t.available_at<=? AND m.status='Running' AND m.due_at<=?
        AND NOT EXISTS (SELECT 1 FROM tasks d WHERE d.mission_id=t.mission_id AND d.agent_id IN (SELECT value FROM json_each(t.depends_on)) AND d.status!='completed')
        ORDER BY m.priority ASC,m.created_at ASC,t.rowid ASC LIMIT 1`).get(at, at);
      if (!t) return null;
      const token = newId('lease');
      q("UPDATE tasks SET status='running',worker_id=?,lease_token=?,lease_until=?,attempts=attempts+1,updated_at=? WHERE id=?")
        .run(workerId, token, at + leaseMs, at, t.id);
      const claimed = task(t.id);
      event(mission(t.mission_id).owner, 'task.started', { taskId: t.id, agentId: t.agent_id, attempt: claimed.attempts }, t.mission_id);
      return { ...claimed, leaseMs };
    });
  }
  function ownsLease(t, workerId, token) {
    if (t.status !== 'running' || t.worker_id !== workerId || t.lease_token !== token || t.lease_until <= now()) throw new MissionError('LEASE_LOST', 409);
  }
  function renew(id, workerId, token, leaseMs = 45000) {
    return tx(() => { const t = task(id); ownsLease(t, workerId, token); q('UPDATE tasks SET lease_until=?,updated_at=? WHERE id=?').run(now() + leaseMs, now(), id); return true; });
  }
  function insertEvidence(e) {
    q(`INSERT INTO evidence(id,mission_id,task_id,owner,source,source_url,received_at,observed_at,expires_at,raw_json,raw_sha256,origin,producer,status,verification,tx_ref,created_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(e.id, e.missionId, e.taskId, e.owner, e.source, e.sourceUrl ?? null, e.receivedAt, e.observedAt ?? null, e.expiresAt, e.rawJson, e.rawSha256, e.origin, e.producer, e.status, json(e.verification), json(e.txRef), now());
  }
  function completeTask({ id, workerId, token, output, evidence, observations = [], verification = null, predictions = [] }) {
    return tx(() => {
      const t = task(id); ownsLease(t, workerId, token);
      const m = mission(t.mission_id);
      if (m.status !== 'Running') throw new MissionError('MISSION_NOT_RUNNING', 409);
      if (evidence) insertEvidence({ ...evidence, missionId: m.id, taskId: id, owner: m.owner, ...(verification ? { status: verification.ok ? 'verified' : 'rejected', verification } : {}) });
      for (const p of predictions) {
        q(`INSERT OR IGNORE INTO predictions(id,owner,mission_id,agent_id,instrument,direction,probability,baseline,baseline_evidence,due_at,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)`)
          .run(`pred_${m.id}_${p.instrument}`, m.owner, m.id, t.agent_id, p.instrument, p.direction, p.probability, p.baseline, evidence.id, now() + p.horizonMs, now());
      }
      for (const o of observations) q('INSERT INTO observations(id,instrument,metric,asset_class,value_num,received_at,evidence_id) VALUES(?,?,?,?,?,?,?)')
        .run(newId('obs'), o.instrument, o.metric, o.assetClass || 'crypto', o.value, o.receivedAt, evidence.id);
      q("UPDATE tasks SET status='completed',output=?,evidence_id=?,error=NULL,lease_until=NULL,updated_at=? WHERE id=?")
        .run(json(output), evidence?.id || null, now(), id);
      event(m.owner, 'task.completed', { taskId: id, agentId: t.agent_id, evidenceId: evidence?.id || null }, m.id);
      return task(id);
    });
  }
  function failTask({ id, workerId, token, error, retryable = false, backoffMs = 1000 }) {
    return tx(() => {
      const t = task(id); ownsLease(t, workerId, token);
      const retry = retryable && t.attempts < t.max_attempts;
      const at = now();
      q('UPDATE tasks SET status=?,error=?,available_at=?,worker_id=NULL,lease_token=NULL,lease_until=NULL,updated_at=? WHERE id=?')
        .run(retry ? 'queued' : 'failed', json(error), at + Math.min(30000, backoffMs * 2 ** (t.attempts - 1)), at, id);
      const m = mission(t.mission_id);
      event(m.owner, retry ? 'task.retry' : 'task.failed', { taskId: id, agentId: t.agent_id, error }, m.id);
      if (!retry) setMission(m.id, { status: 'Failed', error: { ...error, taskId: id, agentId: t.agent_id }, completed_at: at });
      return task(id);
    });
  }
  function evidenceFor(id, owner = null) {
    const row = owner ? q('SELECT * FROM evidence WHERE id=? AND owner=?').get(id, owner) : q('SELECT * FROM evidence WHERE id=?').get(id);
    return parse(row, ['verification', 'tx_ref']);
  }
  function verifyEvidence(id, verification) {
    q('UPDATE evidence SET status=?,verification=? WHERE id=?').run(verification.ok ? 'verified' : 'rejected', json(verification), id);
    return evidenceFor(id);
  }
  function listMissions(owner, { limit = 50, status = null } = {}) {
    const rows = status ? q('SELECT * FROM missions WHERE owner=? AND status=? ORDER BY created_at DESC LIMIT ?').all(owner, status, limit)
      : q('SELECT * FROM missions WHERE owner=? ORDER BY created_at DESC LIMIT ?').all(owner, limit);
    return rows.map((r) => parse(r, MISSION_JSON));
  }
  function events(owner, after = 0, limit = 100) { return q('SELECT * FROM events WHERE owner=? AND seq>? ORDER BY seq LIMIT ?').all(owner, after, limit).map((r) => parse(r, ['payload'])); }
  function getState(key, fallback = null) { const r = q('SELECT value FROM state WHERE key=?').get(key); return r ? JSON.parse(r.value) : fallback; }
  function setState(key, value) { q('INSERT INTO state(key,value,updated_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at').run(key, json(value), now()); return value; }
  function observations(instrument, metric, limit = 30) { return q('SELECT * FROM observations WHERE instrument=? AND metric=? ORDER BY received_at DESC LIMIT ?').all(instrument, metric, limit); }
  function duePredictions(limit = 5) { return q("SELECT * FROM predictions WHERE status='pending' AND due_at<=? ORDER BY due_at LIMIT ?").all(now(), limit); }
  function recordOutcome(prediction, evidence, verification, actualPrice) {
    return tx(() => {
      const p = q("SELECT * FROM predictions WHERE id=? AND status='pending'").get(prediction.id);
      if (!p) return false;
      if (!verification.ok) throw new MissionError('OUTCOME_NOT_VERIFIED');
      insertEvidence({ ...evidence, missionId: p.mission_id, taskId: null, owner: p.owner, status: 'verified', verification });
      const actualDirection = actualPrice > p.baseline ? 'up' : actualPrice < p.baseline ? 'down' : 'flat';
      const correct = actualDirection === p.direction ? 1 : 0;
      const brier = (p.probability - correct) ** 2;
      q("UPDATE predictions SET status='evaluated',outcome_evidence=?,brier=?,correct=? WHERE id=?").run(evidence.id, brier, correct, p.id);
      event(p.owner, 'learning.evaluated', { predictionId: p.id, agentId: p.agent_id, correct, brier }, p.mission_id);
      return true;
    });
  }
  function learningMetrics(owner) {
    return q("SELECT agent_id,count(*) samples,avg(correct) accuracy,avg(brier) brier FROM predictions WHERE owner=? AND status='evaluated' GROUP BY agent_id").all(owner);
  }
  function policy(owner) {
    const row = q('SELECT * FROM policies WHERE owner=? ORDER BY version DESC LIMIT 1').get(owner);
    return row ? { ...row, policy: JSON.parse(row.policy) } : { id: null, version: 0, policy: { optionalResearch: true, modelEnabled: true, modelProvider: null, minOpportunityConfidence: 0.6 } };
  }
  function savePolicy(owner, next) {
    return tx(() => {
      const prev = policy(owner); const id = newId('policy'); const version = prev.version + 1;
      q('INSERT INTO policies(id,owner,version,policy,previous_id,created_at) VALUES(?,?,?,?,?,?)').run(id, owner, version, json(next), prev.id, now());
      event(owner, 'learning.policy.changed', { version, previousId: prev.id, policy: next });
      return { id, version, policy: next, previousId: prev.id };
    });
  }
  function stats(owner) {
    return {
      missions: q('SELECT status,count(*) count FROM missions WHERE owner=? GROUP BY status').all(owner),
      agents: q('SELECT t.agent_id,t.status,count(*) count FROM tasks t JOIN missions m ON m.id=t.mission_id WHERE m.owner=? GROUP BY t.agent_id,t.status').all(owner),
      evidence: q('SELECT status,count(*) count FROM evidence WHERE owner=? GROUP BY status').all(owner),
      bytes: path === ':memory:' ? 0 : Number(db.prepare('SELECT page_count*page_size bytes FROM pragma_page_count(),pragma_page_size()').get().bytes)
    };
  }
  const api = {
    db, durable: path !== ':memory:', path, tx, event, mission, task, setMission, finishMission, createMission, addTasks, tasksFor,
    recover, claim, renew, completeTask, failTask, insertEvidence, evidenceFor, verifyEvidence,
    listMissions, events, getState, setState, observations, duePredictions, recordOutcome, learningMetrics, policy, savePolicy, stats, hash,
    close: () => db.close()
  };
  return api;
}
