import { resolve } from 'node:path';
import { createMissionStore, MissionError, hash } from './store.js';
import { normalizeMission, createPolicyEngine, AGENTS } from './core.js';
import { createAdapters } from './adapters.js';
import { createLearningLoop } from './learning.js';
import { createRuntime } from './runtime.js';
import { createMissionRouter } from './router.js';

export function createMissionControl({ env = process.env, path, store: injectedStore, adapters: injectedAdapters, tickMs, concurrency } = {}) {
  const enabled = env.MISSION_CONTROL_ENABLED === '1';
  if (!enabled) return { enabled: false, router: createMissionRouter({ control: null, env }), status: () => ({ enabled: false, code: 'MISSION_CONTROL_DISABLED', durable: false, worker: null }) };
  if (String(env.MISSION_CONTROL_SECRET || '').length < 32) throw new MissionError('MISSION_SECRET_NOT_CONFIGURED', 503);
  const dbPath = path || env.MISSION_CONTROL_DB || resolve(process.cwd(), 'data/mission-control/missions.db');
  if (env.NODE_ENV === 'production' && dbPath === ':memory:') throw new MissionError('DURABLE_STORAGE_REQUIRED', 503);
  const store = injectedStore || createMissionStore({ path: dbPath });
  const policy = createPolicyEngine(store);
  const adapters = injectedAdapters || createAdapters({ store, env });
  const learning = createLearningLoop({ store, adapters, minSamples: Math.max(10, Number(env.MISSION_LEARNING_MIN_SAMPLES) || 10) });
  const runtime = createRuntime({ store, adapters, policy, learning, tickMs: tickMs ?? Math.max(100, Number(env.MISSION_TICK_MS) || 500), concurrency: Math.max(1, Math.min(8, Number(env.MISSION_CONCURRENCY) || 4)), backoffMs: Math.max(10, Number(env.MISSION_RETRY_BACKOFF_MS) || 1000), log: (s) => console.warn(`[mission-control] ${s}`) });
  const control = {
    enabled: true, store, policy, adapters, learning, runtime,
    submit(owner, body) {
      if (!runtime.status().running) throw new MissionError('DURABLE_WORKER_REQUIRED', 503);
      return store.createMission(normalizeMission(body, owner, store.policy(owner).policy));
    },
    get(owner, id) { const mission = store.mission(id, owner); return { mission, tasks: store.tasksFor(id), evidence: store.tasksFor(id).map((t) => store.evidenceFor(t.evidence_id, owner)).filter(Boolean) }; },
    command(owner, id, action, { version, planDigest, confirm } = {}) {
      const m = store.mission(id, owner);
      if (!Number.isInteger(version)) throw new MissionError('VERSION_REQUIRED');
      if (action === 'approve') {
        if (m.status !== 'Waiting Approval' || confirm !== true || planDigest !== hash({ goal: m.goal, input: m.input, plan: m.plan })) throw new MissionError('APPROVAL_PLAN_MISMATCH', 409);
        const updated = store.setMission(id, { approval: { planDigest, approvedAt: Date.now(), stage: 'wallet_signature_required', canSign: false } }, version);
        store.event(owner, 'mission.approved_for_wallet', { planDigest }, id);
        return { mission: updated, handoff: { route: '/intent', requiresWalletSignature: true }, executed: false };
      }
      const transitions = { pause: { from: ['Pending', 'Planning', 'Running', 'Waiting Approval'], to: 'Paused' }, resume: { from: ['Paused'], to: 'Pending' }, cancel: { from: ['Pending', 'Planning', 'Running', 'Waiting Approval', 'Paused', 'Failed'], to: 'Cancelled' } };
      const rule = transitions[action];
      if (!rule || !rule.from.includes(m.status)) throw new MissionError('INVALID_TRANSITION', 409);
      if (action === 'resume' && (store.getState('emergency-stop', false) || store.getState(`emergency-stop:${owner}`, false))) throw new MissionError('EMERGENCY_STOP', 403);
      const out = store.tx(() => {
        const updated = store.setMission(id, { status: rule.to, ...(action === 'cancel' ? { completed_at: Date.now() } : {}) }, version);
        if (action !== 'resume') store.db.prepare("UPDATE tasks SET status='cancelled' WHERE mission_id=? AND status='queued'").run(id);
        else store.db.prepare("UPDATE tasks SET status='queued',available_at=? WHERE mission_id=? AND status='cancelled'").run(Date.now(), id);
        store.event(owner, `mission.${action}`, { version }, id);
        return updated;
      });
      if (action !== 'resume') runtime.abortMission(id);
      return { mission: out };
    },
    emergencyStop(owner, reason = 'user-stop') {
      store.setState(`emergency-stop:${owner}`, true);
      for (const m of store.listMissions(owner, { limit: 1000 })) if (!['Completed', 'Failed', 'Cancelled'].includes(m.status)) store.setMission(m.id, { status: 'Paused', error: { code: 'EMERGENCY_STOP', reason } });
      store.db.prepare("UPDATE tasks SET status='cancelled' WHERE mission_id IN (SELECT id FROM missions WHERE owner=?) AND status='queued'").run(owner);
      store.event(owner, 'emergency.stop', { reason }); runtime.abortOwner(owner);
      return { stopped: true, scope: 'owner', resumedAutomatically: false };
    },
    releaseStop(owner) { store.setState(`emergency-stop:${owner}`, false); store.event(owner, 'emergency.released', {}); return { stopped: false, note: 'Paused missions require explicit resume' }; },
    stopAgent(owner, agentId) { if (!AGENTS[agentId]) throw new MissionError('UNKNOWN_AGENT'); store.setState(`agent-stop:${owner}:${agentId}`, true); store.event(owner, 'agent.stopped', { agentId }); runtime.abortAgent(owner, agentId); return { agentId, stopped: true }; },
    status(owner) {
      const missions = store.listMissions(owner, { limit: 100 });
      const opportunities = missions.flatMap((m) => (m.result?.opportunities || []).map((o) => ({ ...o, missionId: m.id }))).sort((a, b) => b.score - a.score).slice(0, 20);
      return { enabled: true, durable: store.durable, worker: runtime.status(), missions, opportunities, agents: Object.entries(AGENTS).map(([id, a]) => ({ id, ...a, stopped: store.getState(`agent-stop:${id}`, false) || store.getState(`agent-stop:${owner}:${id}`, false), busy: runtime.status().active.some((x) => x.agentId === id) })), learning: learning.summary(owner), stats: store.stats(owner), cost: { chargedUsd: missions.reduce((sum, m) => sum + Number(m.result?.costUsd || 0), 0) }, emergencyStop: store.getState(`emergency-stop:${owner}`, false), globalStop: store.getState('emergency-stop', false), execution: { canSign: false, canMoveFunds: false, financialLimitUsd: 0 } };
    }
  };
  control.router = createMissionRouter({ control, env });
  return control;
}
let singleton;
export function getMissionControl(options = {}) { if (!singleton) singleton = createMissionControl(options); return singleton; }
export async function startMissionWorker() {
  const control = getMissionControl();
  if (control.enabled) { control.runtime.start(); await control.runtime.tick(); }
  return control;
}
export function _resetMissionControlForTests() { singleton = null; }
