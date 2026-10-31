import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMissionStore, hash } from '../../server/missionControl/store.js';
import { normalizeMission, ownerIdentity, createPolicyEngine, AGENTS } from '../../server/missionControl/core.js';
import { toolReceipt, verifyReceipt, assertMissionCanComplete } from '../../server/missionControl/evidence.js';

const input = (key = 'request-0001') => normalizeMission({ goal: 'بررسی جریان سرمایه بیت کوین', kind: 'smart_money_scan', idempotencyKey: key, input: { symbol: 'BTC' } }, 'owner-a');
function completeFixture(store, verified = true) {
  const m = store.createMission(input()).mission;
  store.addTasks(m.id, [{ agentId: 'market_analyst', toolId: 'world.market' }, { agentId: 'final_judge', toolId: 'analysis.judge', dependsOn: ['market_analyst'] }]);
  store.setMission(m.id, { status: 'Running' });
  const t = store.claim('w1');
  const e = toolReceipt({ source: 'test-source', producer: 'world.market', raw: { dataStatus: 'live', price: 100 } });
  store.completeTask({ id: t.id, workerId: 'w1', token: t.lease_token, output: { price: 100 }, evidence: e });
  store.verifyEvidence(e.id, { ok: verified, code: verified ? 'VERIFIED' : 'DIGEST_MISMATCH' });
  const j = store.claim('w1');
  store.completeTask({ id: j.id, workerId: 'w1', token: j.lease_token, output: { decision: 'ANSWER', evidenceIds: [e.id] }, evidence: toolReceipt({ source: 'judge', producer: 'analysis.judge', raw: { dataStatus: 'observed', evidenceIds: [e.id] } }) });
  store.verifyEvidence(j.evidence_id, { ok: true });
  return store.mission(m.id);
}

test('atomic idempotency is owner-scoped and rejects changed payloads', () => {
  const s = createMissionStore();
  const a = s.createMission(input()); const b = s.createMission(input());
  assert.equal(a.mission.id, b.mission.id); assert.equal(b.duplicate, true);
  assert.throws(() => s.createMission(normalizeMission({ goal: 'changed goal', kind: 'smart_money_scan', idempotencyKey: 'request-0001' }, 'owner-a')), /IDEMPOTENCY_CONFLICT/);
  assert.notEqual(s.createMission({ ...input(), owner: 'owner-b' }).mission.id, a.mission.id);
  assert.throws(() => s.mission(a.mission.id, 'owner-b'), /MISSION_NOT_FOUND/);
  s.close();
});
test('durable SQLite recovers expired leases and preserves attempt count', () => {
  const dir = mkdtempSync(join(tmpdir(), 'fbt-mission-')); const path = join(dir, 'missions.db');
  let s = createMissionStore({ path }); const m = s.createMission(input()).mission;
  s.addTasks(m.id, [{ agentId: 'market_analyst', toolId: 'world.market', maxAttempts: 2 }]);
  s.setMission(m.id, { status: 'Running' }); const t = s.claim('dead-worker', { leaseMs: 1 });
  s.close();
  {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5);
    s = createMissionStore({ path }); assert.equal(s.recover(), 1);
    const next = s.claim('new-worker'); assert.equal(next.id, t.id); assert.equal(next.attempts, 2);
    assert.equal(s.claim('second-worker'), null);
    s.close(); rmSync(dir, { recursive: true, force: true });
  }
});
test('dependencies gate dispatch and stale lease cannot commit', () => {
  const s = createMissionStore(); const m = completeFixture(s);
  assert.equal(s.tasksFor(m.id).filter((t) => t.status === 'completed').length, 2);
  const n = s.createMission(input('request-0002')).mission;
  s.addTasks(n.id, [{ agentId: 'market_analyst', toolId: 'world.market' }, { agentId: 'final_judge', toolId: 'analysis.judge', dependsOn: ['market_analyst'] }]);
  s.setMission(n.id, { status: 'Running' }); const a = s.claim('w'); assert.equal(a.agent_id, 'market_analyst');
  assert.equal(s.claim('w'), null);
  assert.throws(() => s.renew(a.id, 'w', 'wrong-token'), /LEASE_LOST/);
  assert.throws(() => s.completeTask({ id: a.id, workerId: 'w', token: 'wrong-token', output: {} }), /LEASE_LOST/);
  s.close();
});
test('mission text, failed task or rejected evidence cannot become Completed', () => {
  const s = createMissionStore(); const m = completeFixture(s, false);
  assert.throws(() => assertMissionCanComplete(s, m.id), /EVIDENCE_NOT_VERIFIED/);
  assert.throws(() => s.setMission(m.id, { status: 'Completed' }), /never|not allowed|EVIDENCE/);
  s.close();
});
test('independent verification checks digest, freshness, raw observation and chain receipt', () => {
  const e = toolReceipt({ source: 'fixture', producer: 'world.market', raw: { dataStatus: 'live', price: 100 } });
  const row = { ...e, raw_json: e.rawJson, raw_sha256: e.rawSha256, received_at: e.receivedAt, expires_at: e.expiresAt };
  const inspectRaw = (raw) => ({ ok: Number.isFinite(raw.price) && raw.price > 0 });
  assert.equal(verifyReceipt(row, { inspectRaw }).ok, true);
  assert.equal(verifyReceipt({ ...row, raw_json: '{"dataStatus":"live","price":999}' }, { inspectRaw }).code, 'DIGEST_MISMATCH');
  assert.equal(verifyReceipt({ ...row, expires_at: 1 }, { inspectRaw }).ok, false);
  assert.equal(verifyReceipt({ ...row, origin: 'agent' }, { inspectRaw }).ok, false);
  assert.equal(verifyReceipt({ ...row, origin: 'execution', tx_ref: { txHash: '0xabc', chain: 'base' } }, { inspectRaw }).ok, false);
  assert.equal(verifyReceipt({ ...row, origin: 'execution', tx_ref: { txHash: '0xabc', chain: 'base' } }, { inspectRaw, verifyTransaction: () => ({ ok: true, confirmed: true, txHash: '0xabc' }) }).ok, true);
});
test('dynamic plan selects needed agents, scopes cannot widen and secrets are refused', () => {
  const m = input(); assert.deepEqual(m.plan.map((p) => p.id), ['smart_money', 'market_analyst', 'risk_manager', 'final_judge']);
  assert.equal(m.permissions.canSign, false);
  assert.throws(() => normalizeMission({ ...m, agents: ['shell'] }), /UNKNOWN_AGENT/);
  assert.throws(() => normalizeMission({ goal: 'private key را ذخیره کن', idempotencyKey: 'request-0003' }), /SECRET_INPUT_REFUSED/);
  assert.throws(() => normalizeMission({ goal: 'بازار را بررسی کن', kind: 'trade_request', idempotencyKey: 'request-0004', schedule: { intervalMs: 60000 } }), /RECURRING_EXECUTION_FORBIDDEN/);
  const s = createMissionStore(); const mission = s.createMission(m).mission;
  const policy = createPolicyEngine(s); const task = { agent_id: 'market_analyst', tool_id: 'world.market', input: { scope: AGENTS.market_analyst.scope } };
  assert.equal(policy.authorize({ mission, task, agent: { id: 'market_analyst', ...AGENTS.market_analyst } }).ok, true);
  s.setState('emergency-stop', true);
  assert.equal(policy.authorize({ mission, task, agent: { id: 'market_analyst', ...AGENTS.market_analyst } }).code, 'EMERGENCY_STOP');
  s.close();
});
test('owner identity requires high entropy and never uses an IP fallback', () => {
  const secret = 'a'.repeat(32); const device = 'b'.repeat(43);
  assert.equal(ownerIdentity({ device, secret }), ownerIdentity({ device, secret }));
  assert.throws(() => ownerIdentity({ device: 'short', secret, ip: '1.2.3.4' }), /STRONG_IDENTITY_REQUIRED/);
  assert.throws(() => ownerIdentity({ device, secret: 'short' }), /MISSION_SECRET_NOT_CONFIGURED/);
});
