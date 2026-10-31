/** Learn only from independently re-read outcomes; every policy revision is reversible. */
import { verifyReceipt } from './evidence.js';
export function createLearningLoop({ store, adapters, minSamples = 10 }) {
  let running = false;
  async function tick() {
    if (running) return { evaluated: 0 };
    running = true;
    let evaluated = 0;
    try {
      for (const p of store.duePredictions(5)) {
        if (store.getState('emergency-stop', false) || store.getState(`emergency-stop:${p.owner}`, false)) continue;
        try {
          const out = await adapters.readOutcome(p.instrument);
          const verification = verifyReceipt(out.evidence, { inspectRaw: out.inspectRaw });
          if (!verification.ok) continue;
          if (store.recordOutcome(p, out.evidence, verification, out.price)) evaluated++;
          const metrics = store.learningMetrics(p.owner);
          const judge = metrics.find((m) => m.agent_id === 'final_judge');
          if (judge?.samples >= minSamples) {
            const current = store.policy(p.owner);
            const next = { ...current.policy, optionalResearch: judge.accuracy >= 0.5, modelEnabled: judge.accuracy >= 0.5, minOpportunityConfidence: judge.accuracy >= 0.6 ? 0.6 : 0.75, measuredAccuracy: judge.accuracy, measuredSamples: judge.samples };
            if (JSON.stringify({ ...current.policy, measuredAccuracy: undefined, measuredSamples: undefined }) !== JSON.stringify({ ...next, measuredAccuracy: undefined, measuredSamples: undefined })) store.savePolicy(p.owner, next);
          }
        } catch (error) {
          // A missing future price is not a wrong prediction. Keep it pending,
          // record the gap, and retry on a later scheduler tick.
          store.event(p.owner, 'learning.outcome.unavailable', { predictionId: p.id, code: String(error?.code || 'OUTCOME_UNAVAILABLE').slice(0, 80) }, p.mission_id);
        }
      }
      return { evaluated };
    } finally { running = false; }
  }
  function rollback(owner, version) {
    const row = store.db.prepare('SELECT * FROM policies WHERE owner=? AND version=?').get(owner, version);
    if (!row) { const e = new Error('POLICY_VERSION_NOT_FOUND'); e.status = 404; throw e; }
    return store.savePolicy(owner, JSON.parse(row.policy));
  }
  return { tick, rollback, summary: (owner) => ({ metrics: store.learningMetrics(owner), policy: store.policy(owner), minSamples, pending: store.db.prepare("SELECT count(*) n FROM predictions WHERE owner=? AND status='pending'").get(owner).n }) };
}
