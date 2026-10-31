/** Durable queue worker. Browser lifetime is irrelevant; leases survive restarts. */
import { EventEmitter } from 'node:events';
import { newId, MissionError } from './store.js';
import { AGENTS } from './core.js';
import { verifyReceipt, assertMissionCanComplete } from './evidence.js';

export function createRuntime({ store, adapters, policy, learning, concurrency = 4, tickMs = 500, leaseMs = 45000, backoffMs = 1000, now = () => Date.now(), log = () => {} }) {
  const workerId = newId('worker');
  const active = new Map();
  const bus = new EventEmitter();
  let timer = null, ticking = false, stopped = false, lastError = null;
  function abortOwner(owner = null) {
    for (const a of active.values()) if (!owner || a.owner === owner) a.controller.abort();
  }
  function abortMission(id) { for (const [taskId, a] of active) if (a.missionId === id) a.controller.abort(); }
  function abortAgent(owner, agentId) { for (const a of active.values()) if (a.owner === owner && a.agentId === agentId) a.controller.abort(); }
  function failCircuit(agentId, error) {
    const key = `agent-failures:${agentId}`;
    const n = store.getState(key, 0) + 1;
    store.setState(key, n);
    if (n >= 3) { store.setState(`agent-stop:${agentId}`, true); store.event('system', 'agent.circuit.open', { agentId, failures: n, error }); }
  }
  async function runTask(t) {
    const m = store.mission(t.mission_id);
    const controller = new AbortController();
    active.set(t.id, { controller, owner: m.owner, missionId: m.id, agentId: t.agent_id, startedAt: now() });
    const heartbeat = setInterval(() => {
      try { store.renew(t.id, workerId, t.lease_token, leaseMs); }
      catch { controller.abort(); }
    }, Math.max(50, Math.floor(leaseMs / 3)));
    let timeout;
    try {
      const agent = adapters[t.agent_id];
      const auth = policy.authorize({ mission: m, task: t, agent });
      store.event(m.owner, 'policy.checked', { taskId: t.id, ...auth }, m.id);
      if (!auth.ok) throw Object.assign(new MissionError(auth.code, 403), { retryable: false });
      const tasks = store.tasksFor(m.id);
      const prior = Object.fromEntries(tasks.filter((x) => x.status === 'completed' && t.depends_on.includes(x.agent_id)).map((x) => [x.agent_id, x.output]));
      const evidenceRows = tasks.filter((x) => x.evidence_id && x.agent_id !== 'final_judge').map((x) => store.evidenceFor(x.evidence_id)).filter((e) => e?.status === 'verified');
      const work = agent.run({ mission: m, task: t, prior, evidenceRows, signal: controller.signal });
      const result = await Promise.race([
        work,
        new Promise((_, reject) => { timeout = setTimeout(() => { controller.abort(); reject(Object.assign(new Error('TASK_TIMEOUT'), { code: 'TASK_TIMEOUT', retryable: true })); }, t.timeout_ms); })
      ]);
      if (controller.signal.aborted) throw Object.assign(new Error('TASK_ABORTED'), { code: 'TASK_ABORTED', retryable: false });
      const verification = verifyReceipt(result.evidence, { now: now(), inspectRaw: agent.inspectRaw });
      if (!verification.ok) throw Object.assign(new Error(verification.code), { code: verification.code, retryable: false });
      // Recheck after the read: an emergency stop during a read must not commit.
      const after = policy.authorize({ mission: store.mission(m.id), task: t, agent });
      if (!after.ok) throw Object.assign(new Error(after.code), { code: after.code, retryable: false });
      const predictions = t.agent_id === 'final_judge' ? (result.output.opportunities || []).filter((o) => o.prediction && o.metrics?.priceUsd > 0).map((o) => ({ instrument: o.instrument, ...o.prediction, horizonMs: m.input.horizonHours * 3600000 })) : [];
      store.completeTask({ id: t.id, workerId, token: t.lease_token, output: result.output, evidence: result.evidence, verification, observations: result.observations || [], predictions });
      store.setState(`agent-failures:${t.agent_id}`, 0);
      bus.emit('change', { owner: m.owner, missionId: m.id });
    } catch (error) {
      const code = String(error?.code || error?.message || 'AGENT_FAILED').slice(0, 100);
      const retryable = error?.retryable === true;
      try { store.failTask({ id: t.id, workerId, token: t.lease_token, error: { code, retryable }, retryable, backoffMs }); }
      catch (e) { if (e.code !== 'LEASE_LOST') log(`runtime:failure-commit:${e.code || 'ERROR'}`); }
      failCircuit(t.agent_id, { code });
    } finally {
      clearInterval(heartbeat); clearTimeout(timeout); active.delete(t.id);
    }
  }
  function scheduleRecurring(m) {
    if (!m.schedule?.intervalMs || m.status !== 'Completed') return;
    const nextDue = Math.max(m.due_at + m.schedule.intervalMs, now());
    if (nextDue > now()) return;
    if (m.schedule.occurrenceCreated) return;
    // Each write is atomic; the deterministic key also makes a crash between
    // these two writes idempotent. Never nest BEGIN IMMEDIATE transactions.
    store.createMission({
      owner: m.owner, goal: m.goal, kind: m.kind, input: m.input, plan: m.plan, permissions: m.permissions,
      priority: m.priority, schedule: { ...m.schedule, parentId: m.id, nextAt: nextDue + m.schedule.intervalMs },
      dueAt: nextDue, fingerprint: m.fingerprint, idempotencyKey: `schedule_${m.id.slice(4, 40)}_${nextDue}`
    });
    store.setMission(m.id, { schedule: { ...m.schedule, occurrenceCreated: true } });
  }
  function reconcile() {
    store.recover();
    const rows = store.db.prepare("SELECT id FROM missions WHERE status IN ('Pending','Planning','Running','Completed') ORDER BY priority,created_at LIMIT 200").all();
    for (const row of rows) {
      const m = store.mission(row.id);
      if (store.getState('emergency-stop', false) || store.getState(`emergency-stop:${m.owner}`, false)) continue;
      if (m.status === 'Completed') { scheduleRecurring(m); continue; }
      if (m.due_at > now()) continue;
      if (m.status === 'Pending') store.setMission(m.id, { status: 'Planning' });
      if (['Pending', 'Planning'].includes(m.status)) {
        store.addTasks(m.id, m.plan.map((p) => ({ agentId: p.id, toolId: p.toolId, dependsOn: p.dependsOn, timeoutMs: p.timeoutMs, maxAttempts: p.maxAttempts, input: { scope: AGENTS[p.id].scope } })));
        if (store.tasksFor(m.id).length === m.plan.length) store.setMission(m.id, { status: 'Running' });
        continue;
      }
      const tasks = store.tasksFor(m.id);
      if (tasks.some((t) => t.status === 'failed')) { store.setMission(m.id, { status: 'Failed', error: tasks.find((t) => t.status === 'failed').error, completed_at: now() }); continue; }
      if (tasks.length === m.plan.length && tasks.length && tasks.every((t) => t.status === 'completed')) {
        try {
          assertMissionCanComplete(store, m.id);
          const output = tasks.find((t) => t.agent_id === 'final_judge').output;
          store.finishMission(m.id, { ...output, verifiedAt: now(), missionId: m.id }, assertMissionCanComplete);
          store.event(m.owner, 'mission.verified', { evidenceCount: tasks.length }, m.id);
          bus.emit('change', { owner: m.owner, missionId: m.id });
        } catch (e) {
          if (e.code === 'WALLET_SIGNATURE_REQUIRED') store.setMission(m.id, { status: 'Waiting Approval', result: { ...tasks.find((t) => t.agent_id === 'final_judge').output, stage: 'wallet_signature_required' } });
          else store.setMission(m.id, { status: 'Failed', error: { code: e.code || 'VERIFICATION_FAILED' }, completed_at: now() });
        }
      }
    }
  }
  async function tick() {
    if (ticking || stopped) return;
    ticking = true;
    try {
      reconcile();
      store.setState('worker-heartbeat', { workerId, at: now(), active: active.size, durable: store.durable });
      while (active.size < concurrency) {
        const t = store.claim(workerId, { concurrency, leaseMs });
        if (!t) break;
        void runTask(t);
      }
      await learning.tick();
      lastError = null;
    } catch (e) { lastError = { code: String(e?.code || e?.message || 'RUNTIME_ERROR').slice(0, 120), at: now() }; log(`mission-runtime:${lastError.code}`); }
    finally { ticking = false; }
  }
  return {
    workerId, bus, tick, abortOwner, abortMission, abortAgent,
    start() { if (timer || stopped) return; store.recover(); timer = setInterval(() => void tick(), tickMs); timer.unref?.(); void tick(); },
    async stop() { stopped = true; clearInterval(timer); timer = null; abortOwner(); while (active.size) await new Promise((r) => setTimeout(r, 10)); },
    status() { const heartbeat = store.getState('worker-heartbeat'); return { workerId, running: !stopped && !!heartbeat && now() - heartbeat.at < 10000, durable: store.durable, active: [...active.values()].map(({ owner, ...a }) => a), concurrency, lastError, heartbeat, queue: store.db.prepare("SELECT status,count(*) count FROM tasks GROUP BY status").all() }; }
  };
}
