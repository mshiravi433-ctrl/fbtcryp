import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { normalizeMission, ownerIdentity } from '../../server/missionControl/core.js';
import { createMissionControl } from '../../server/missionControl/index.js';
import { createMissionProxyRouter } from '../../server/missionControl/router.js';
import { AGENTS } from '../../server/missionControl/core.js';
import { toolReceipt } from '../../server/missionControl/evidence.js';

const env = { MISSION_CONTROL_ENABLED: '1', MISSION_CONTROL_SECRET: 's'.repeat(40), MISSION_OPS_TOKEN: 'o'.repeat(40), MISSION_WORKER_TOKEN: 'w'.repeat(40), MISSION_RETRY_BACKOFF_MS: '10' };
const device = 'd'.repeat(43);
function fakeAdapters() {
  return Object.fromEntries(Object.entries(AGENTS).map(([id, a]) => [id, { id, scope: a.scope, inspectRaw: (r) => ({ ok: r.dataStatus === 'live' }), run: async ({ evidenceRows }) => ({ output: { kind: id, summary: `Verified ${id}`, stance: 'neutral', ...(id === 'final_judge' ? { decision: 'ANSWER', evidenceIds: evidenceRows.map((e) => e.id), opportunities: [] } : {}) }, evidence: toolReceipt({ source: `fixture:${id}`, producer: a.tools[0], raw: { dataStatus: 'live' } }) }) }]));
}
async function withServer(router, fn) {
  const app = express(); app.use(express.json()); app.use('/api/v1/missions', router);
  const server = app.listen(0, '127.0.0.1'); await new Promise((r) => server.once('listening', r));
  try { await fn(`http://127.0.0.1:${server.address().port}/api/v1/missions`); } finally { server.close(); }
}

test('numeric schedules, locale and reversible learning policy are normalized into the durable plan', () => {
  const startAt = Date.now() + 3600000;
  const m = normalizeMission({ goal: 'Analyze BTC market', kind: 'market_analysis', idempotencyKey: 'policy-0001', input: { locale: 'en', optionalResearch: false }, schedule: { startAt, intervalMs: 60000 }, permissions: { maxModelUsd: 0.01 } }, 'owner-a', { optionalResearch: true, modelEnabled: false, modelProvider: 'groq', minOpportunityConfidence: 0.8 });
  assert.equal(m.dueAt, startAt); assert.equal(m.schedule.nextAt, startAt + 60000); assert.equal(m.input.locale, 'en'); assert.equal(m.input.optionalResearch, false); assert.equal(m.input.modelEnabled, false); assert.equal(m.input.modelProvider, 'groq'); assert.equal(m.input.minOpportunityConfidence, 0.8);
  const withResearch = normalizeMission({ goal: 'Analyze BTC research', kind: 'market_analysis', idempotencyKey: 'policy-0002' }, 'owner-a', { optionalResearch: true });
  const withoutResearch = normalizeMission({ goal: 'Analyze BTC research', kind: 'market_analysis', idempotencyKey: 'policy-0003', input: { optionalResearch: false } }, 'owner-a', { optionalResearch: true });
  assert.ok(withResearch.plan.some((p) => p.id === 'research_agent')); assert.ok(!withoutResearch.plan.some((p) => p.id === 'research_agent'));
});
test('operator emergency stop works while the runtime is stopped and never auto-resumes', async () => {
  const c = createMissionControl({ env, path: ':memory:', adapters: fakeAdapters(), tickMs: 100000 });
  await c.runtime.tick(); const m = c.submit('owner-a', { goal: 'Analyze BTC market', kind: 'market_analysis', idempotencyKey: 'ops-00001' }).mission;
  await c.runtime.stop(); assert.equal(c.runtime.status().running, false);
  await withServer(c.router, async (base) => {
    const headers = { 'content-type': 'application/json', 'x-fbt-mission-request': '1', 'x-fbt-mission-device': device, 'x-mission-ops-token': env.MISSION_OPS_TOKEN };
    const denied = await fetch(`${base}/admin/emergency-stop`, { method: 'POST', headers: { ...headers, 'x-mission-ops-token': 'wrong' }, body: '{}' }); assert.equal(denied.status, 403);
    const stopped = await (await fetch(`${base}/admin/emergency-stop`, { method: 'POST', headers, body: '{}' })).json(); assert.equal(stopped.stopped, true);
    assert.equal(c.store.mission(m.id).status, 'Paused'); assert.equal(c.store.getState('emergency-stop'), true);
    const released = await (await fetch(`${base}/admin/emergency-stop`, { method: 'POST', headers, body: JSON.stringify({ release: true }) })).json(); assert.equal(released.stopped, false);
    assert.equal(c.store.mission(m.id).status, 'Paused');
  });
  c.store.close();
});
test('serverless proxy pins a fixed HTTPS worker and forwards a derived owner, not the device secret', async () => {
  let captured;
  const router = createMissionProxyRouter({ env: { ...env, MISSION_CONTROL_UPSTREAM_URL: 'https://worker.example' }, fetchImpl: async (url, init) => { captured = { url: String(url), init }; return new Response(JSON.stringify({ ok: true, missions: [] }), { status: 200, headers: { 'content-type': 'application/json' } }); } });
  await withServer(router, async (base) => {
    const res = await fetch(`${base}/missions?limit=5`, { headers: { 'x-fbt-mission-request': '1', 'x-fbt-mission-device': device } }); assert.equal(res.status, 200);
    assert.equal(captured.url, 'https://worker.example/api/v1/missions/missions?limit=5');
    assert.equal(captured.init.headers['x-mission-owner'], ownerIdentity({ device, secret: env.MISSION_CONTROL_SECRET }));
    assert.equal(captured.init.headers['x-fbt-mission-device'], undefined);
    assert.equal(captured.init.headers['x-mission-worker-token'], env.MISSION_WORKER_TOKEN);
  });
  const insecure = createMissionProxyRouter({ env: { ...env, MISSION_CONTROL_UPSTREAM_URL: 'http://worker.example' }, fetchImpl: async () => { throw new Error('must not call'); } });
  await withServer(insecure, async (base) => { const res = await fetch(`${base}/status`, { headers: { 'x-fbt-mission-request': '1', 'x-fbt-mission-device': device } }); assert.equal(res.status, 503); });
});
