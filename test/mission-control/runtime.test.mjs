import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createMissionControl } from '../../server/missionControl/index.js';
import { AGENTS } from '../../server/missionControl/core.js';
import { toolReceipt } from '../../server/missionControl/evidence.js';
import { hash } from '../../server/missionControl/store.js';

const env = { MISSION_CONTROL_ENABLED: '1', MISSION_CONTROL_SECRET: 's'.repeat(40), NODE_ENV: 'test', MISSION_RETRY_BACKOFF_MS: '10' };
const device = 'd'.repeat(43);
function fakeAdapters(overrides = {}) {
  return Object.fromEntries(Object.entries(AGENTS).map(([id, a]) => [id, {
    id, scope: a.scope, inspectRaw: (r) => ({ ok: r.dataStatus === 'live' }),
    run: async ({ evidenceRows }) => ({ output: { kind: id, summary: `Verified source analysis from ${id}`, stance: 'neutral', ...(id === 'final_judge' ? { decision: 'ANSWER', evidenceIds: evidenceRows.map((e) => e.id), opportunities: [] } : {}) }, evidence: toolReceipt({ source: `fixture:${id}`, producer: a.tools[0], raw: { dataStatus: 'live', value: 1 } }) }),
    ...overrides[id]
  }]));
}
async function drain(control, id, max = 80) {
  for (let i = 0; i < max; i++) { await control.runtime.tick(); await new Promise((r) => setTimeout(r, 5)); const m = control.store.mission(id); if (['Completed', 'Failed', 'Waiting Approval', 'Cancelled'].includes(m.status)) return m; }
  throw new Error(`did not settle: ${JSON.stringify(control.store.mission(id))} ${JSON.stringify(control.store.tasksFor(id))}`);
}
const body = (key = 'mission-0001', extra = {}) => ({ goal: 'Analyze BTC market', kind: 'market_analysis', idempotencyKey: key, input: { symbol: 'BTC' }, ...extra });

test('server runtime completes only after every independent receipt and judge', async () => {
  const c = createMissionControl({ env, path: ':memory:', adapters: fakeAdapters(), tickMs: 100000 });
  await c.runtime.tick(); const m = c.submit('owner-a', body()).mission;
  const done = await drain(c, m.id); assert.equal(done.status, 'Completed');
  const detail = c.get('owner-a', m.id); assert.equal(detail.evidence.length, 4); assert.ok(detail.evidence.every((e) => e.status === 'verified'));
  assert.ok(done.result.verifiedAt); assert.equal(done.result.canSign, undefined);
  await c.runtime.stop(); c.store.close();
});
test('failed agent never completes; bounded retry and circuit breaker are real', async () => {
  let calls = 0;
  const adapters = fakeAdapters({ market_analyst: { run: async () => { calls++; throw Object.assign(new Error('SOURCE_UNAVAILABLE'), { code: 'SOURCE_UNAVAILABLE', retryable: true }); } } });
  const c = createMissionControl({ env, path: ':memory:', adapters, tickMs: 100000 });
  await c.runtime.tick(); const m = c.submit('owner-a', body()).mission;
  for (let i = 0; i < 200 && c.store.mission(m.id).status !== 'Failed'; i++) { await c.runtime.tick(); await new Promise((r) => setTimeout(r, 10)); }
  assert.equal(c.store.mission(m.id).status, 'Failed'); assert.equal(calls, 3); assert.equal(c.store.getState('agent-stop:market_analyst'), true);
  await c.runtime.stop(); c.store.close();
});
test('timeout aborts the adapter and does not commit late output', async () => {
  let aborted = false, lateCommitted = false;
  const adapters = fakeAdapters({ market_analyst: { run: ({ signal }) => new Promise((resolve) => { const t = setTimeout(() => { lateCommitted = true; resolve({ output: {}, evidence: toolReceipt({ source: 'late', producer: 'world.market', raw: { dataStatus: 'live' } }) }); }, 100); signal.addEventListener('abort', () => { aborted = true; clearTimeout(t); }, { once: true }); }) } });
  const c = createMissionControl({ env, path: ':memory:', adapters, tickMs: 100000 });
  await c.runtime.tick(); const normalized = c.submit('owner-a', body());
  const plan = normalized.mission.plan.map((p) => p.id === 'market_analyst' ? { ...p, timeoutMs: 15, maxAttempts: 1 } : p);
  c.store.setMission(normalized.mission.id, { plan });
  const done = await drain(c, normalized.mission.id); assert.equal(done.status, 'Failed'); assert.equal(aborted, true); assert.equal(lateCommitted, false);
  await c.runtime.stop(); c.store.close();
});
test('trade approval is bound to the plan and never signs or completes', async () => {
  const c = createMissionControl({ env, path: ':memory:', adapters: fakeAdapters(), tickMs: 100000 });
  await c.runtime.tick(); const m = c.submit('owner-a', body('trade-00001', { kind: 'trade_request', goal: 'Buy BTC after review' })).mission;
  const waiting = await drain(c, m.id); assert.equal(waiting.status, 'Waiting Approval');
  assert.throws(() => c.command('owner-a', m.id, 'approve', { version: waiting.version, confirm: true, planDigest: 'wrong' }), /APPROVAL_PLAN_MISMATCH/);
  const out = c.command('owner-a', m.id, 'approve', { version: waiting.version, confirm: true, planDigest: hash({ goal: waiting.goal, input: waiting.input, plan: waiting.plan }) });
  assert.equal(out.executed, false); assert.equal(out.mission.status, 'Waiting Approval'); assert.equal(out.handoff.requiresWalletSignature, true);
  await c.runtime.stop(); c.store.close();
});
test('HTTP identity, idempotency, pause/resume and emergency stop are enforced', async () => {
  const c = createMissionControl({ env, path: ':memory:', adapters: fakeAdapters(), tickMs: 100000 });
  await c.runtime.tick(); const app = express(); app.use(express.json()); app.use('/api/v1/missions', c.router);
  const server = app.listen(0, '127.0.0.1'); await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${server.address().port}/api/v1/missions`;
  const headers = { 'content-type': 'application/json', 'x-fbt-mission-request': '1', 'x-fbt-mission-device': device };
  try {
    assert.equal((await fetch(`${base}/status`)).status, 400);
    assert.equal((await fetch(`${base}/status`, { headers: { ...headers, 'x-fbt-mission-device': 'short' } })).status, 401);
    const created = await (await fetch(`${base}/missions`, { method: 'POST', headers, body: JSON.stringify(body()) })).json(); assert.equal(created.ok, true);
    const again = await (await fetch(`${base}/missions`, { method: 'POST', headers, body: JSON.stringify(body()) })).json(); assert.equal(again.mission.id, created.mission.id);
    const other = await fetch(`${base}/missions/${created.mission.id}`, { headers: { ...headers, 'x-fbt-mission-device': 'x'.repeat(43) } }); assert.equal(other.status, 404);
    const paused = await (await fetch(`${base}/missions/${created.mission.id}/pause`, { method: 'POST', headers, body: JSON.stringify({ version: created.mission.version }) })).json(); assert.equal(paused.mission.status, 'Paused');
    const stopped = await (await fetch(`${base}/emergency-stop`, { method: 'POST', headers, body: '{}' })).json(); assert.equal(stopped.stopped, true);
    const status = await (await fetch(`${base}/status`, { headers })).json(); assert.equal(status.emergencyStop, true); assert.equal(status.execution.canSign, false);
  } finally { server.close(); await c.runtime.stop(); c.store.close(); }
});
test('recurring missions create one durable occurrence per due time', async () => {
  const c = createMissionControl({ env, path: ':memory:', adapters: fakeAdapters(), tickMs: 100000 });
  await c.runtime.tick(); const m = c.submit('owner-a', body('schedule-0001', { schedule: { intervalMs: 60000 } })).mission;
  await drain(c, m.id); c.store.db.prepare('UPDATE missions SET due_at=? WHERE id=?').run(Date.now() - 60001, m.id);
  await c.runtime.tick(); await c.runtime.tick();
  const rows = c.store.listMissions('owner-a'); assert.equal(rows.length, 2); assert.equal(rows.filter((r) => r.schedule?.parentId === m.id).length, 1);
  await c.runtime.stop(); c.store.close();
});
