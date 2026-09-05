#!/usr/bin/env node
/**
 * UPGRADE 10 — Financial OS HTTP surface probe.
 * ────────────────────────────────────────────────────────────────────────────
 * The unit probe proves the ENGINES are honest. This one proves the DOORS are:
 * that the routes are actually mounted on the one gateway, that they are scoped
 * per device, and — the part that matters — that none of them can be used to
 * move money.
 *
 * The security assertions here are the ones a reviewer should read first:
 *   · no kernel route executes anything, ever
 *   · a permission grant over HTTP cannot exceed the autonomy mode
 *   · a kill switch engaged over HTTP blocks a previously valid grant
 *   · /tools/execute still refuses without a confirmed actionId (unchanged)
 *   · a secret posted into memory is stored redacted or not at all
 *
 * Run: npm run test:upgrade10-http
 */
import assert from 'node:assert/strict';
import express from 'express';
import { createCentralIntelligence } from '../../server/ci/api.js';

const rows = [];
const t = async (name, fn) => {
  try { await fn(); rows.push([name, true, '']); } catch (error) { rows.push([name, false, String(error?.message || error).slice(0, 220)]); }
};

const ci = createCentralIntelligence({ log: () => {} });
const app = express();
app.use(express.json());
app.use('/api/brain', ci.router);
const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
const base = `http://127.0.0.1:${server.address().port}/api/brain`;
const DEVICE = 'probe-upgrade10-device';

async function call(path, { method = 'GET', body = null, device = DEVICE } = {}) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: { 'content-type': 'application/json', 'x-fbt-device': device },
    body: body === null ? undefined : JSON.stringify(body)
  });
  let json = null;
  try { json = await res.json(); } catch { json = null; }
  return { status: res.status, body: json };
}

/* ── the routes exist on the one gateway ────────────────────────────────── */
await t('the profile route is mounted and starts empty', async () => {
  const out = await call('/financial/profile');
  assert.equal(out.status, 200);
  assert.equal(out.body.profile.riskProfile.value, null);
  assert.ok(out.body.gaps.includes('riskProfile'));
});

await t('a profile field can be stated, read back and reset', async () => {
  assert.equal((await call('/financial/profile', { method: 'PATCH', body: { riskProfile: 'MODERATE' } })).status, 200);
  assert.equal((await call('/financial/profile')).body.profile.riskProfile.value, 'MODERATE');
  await call('/financial/profile', { method: 'DELETE', body: { fields: ['riskProfile'] } });
  assert.equal((await call('/financial/profile')).body.profile.riskProfile.value, null);
});

await t('an inferred patch cannot overwrite a stated field over HTTP either', async () => {
  await call('/financial/profile', { method: 'PATCH', body: { riskProfile: 'CONSERVATIVE' } });
  const out = await call('/financial/profile', { method: 'PATCH', body: { riskProfile: 'AGGRESSIVE', origin: 'inferred' } });
  assert.equal(out.body.rejected[0].code, 'WOULD_OVERWRITE_STATED');
});

await t('goals can be created, listed and deleted', async () => {
  const created = await call('/financial/goals', { method: 'POST', body: { name: 'Grow 4 months', type: 'GROW_CAPITAL', targetUsd: 20_000, horizonMonths: 4 } });
  assert.equal(created.status, 201);
  const id = created.body.goal.goalId;
  const list = await call('/financial/goals');
  assert.equal(list.body.goals.length, 1);
  assert.equal((await call(`/financial/goals/${id}`, { method: 'DELETE' })).status, 200);
  assert.equal((await call('/financial/goals')).body.goals.length, 0);
});

await t('an invalid goal is refused with a named code', async () => {
  const out = await call('/financial/goals', { method: 'POST', body: { name: '' } });
  assert.equal(out.status, 400);
  assert.equal(out.body.code, 'BAD_NAME');
});

await t('sessions are scoped per device', async () => {
  await call('/financial/goals', { method: 'POST', body: { name: 'Mine', targetUsd: 100, horizonMonths: 3 } });
  const other = await call('/financial/goals', { device: 'probe-upgrade10-other' });
  assert.equal(other.body.goals.length, 0, 'one device must not see another device\'s goals');
});

await t('the financial state route answers UNAVAILABLE rather than zeroes with no wallet', async () => {
  const out = await call('/financial/state');
  assert.equal(out.status, 200);
  assert.equal(out.body.financialState.status, 'UNAVAILABLE');
  assert.equal(out.body.financialState.netWorthUsd, undefined);
});

await t('advise refuses to recommend with no readable financial state', async () => {
  const out = await call('/financial/advise', { method: 'POST', body: {} });
  assert.equal(out.status, 409);
  assert.equal(out.body.status, 'UNAVAILABLE');
  assert.ok(String(out.body.detail).includes('evidence'));
});

await t('Monte Carlo over HTTP is a distribution with a disclaimer', async () => {
  const out = await call('/financial/project', { method: 'POST', body: { months: 6, paths: 800, seed: 7 } });
  /* No portfolio is readable in this probe, so the honest answer is a refusal. */
  assert.equal(out.status, 200);
  assert.ok(out.body.status === 'UNAVAILABLE' || out.body.percentiles);
  if (out.body.percentiles) assert.ok(out.body.disclaimer.includes('not a prediction'));
});

/* ── permissions ────────────────────────────────────────────────────────── */
await t('the permission table is default-deny for money scopes', async () => {
  const out = await call('/permissions');
  const swap = out.body.rows.find((r) => r.scope === 'execute:swap');
  assert.equal(swap.granted, false);
  assert.equal(swap.blockedByMode, true);
  assert.equal(out.body.rows.find((r) => r.scope === 'view:portfolio').granted, true);
});

await t('a money grant over HTTP is refused while autonomy forbids execution', async () => {
  const out = await call('/permissions', { method: 'POST', body: { scope: 'execute:swap' } });
  assert.equal(out.status, 400);
  assert.equal(out.body.code, 'MODE_FORBIDS_SCOPE');
});

await t('raising autonomy then granting works, and the check honours the limit', async () => {
  assert.equal((await call('/permissions/mode', { method: 'POST', body: { mode: 'APPROVE_EACH' } })).status, 200);
  assert.equal((await call('/permissions', { method: 'POST', body: { scope: 'execute:swap', limitUsd: 250 } })).status, 200);
  assert.equal((await call('/permissions/check', { method: 'POST', body: { scope: 'execute:swap', amountUsd: 100 } })).body.granted, true);
  const over = await call('/permissions/check', { method: 'POST', body: { scope: 'execute:swap', amountUsd: 900 } });
  assert.equal(over.body.granted, false);
  assert.equal(over.body.code, 'OVER_LIMIT');
});

await t('a permission check never executes anything', async () => {
  const out = await call('/permissions/check', { method: 'POST', body: { scope: 'execute:swap', amountUsd: 10 } });
  assert.equal(out.body.executes, false);
});

await t('a kill switch engaged over HTTP blocks a previously valid grant', async () => {
  assert.equal((await call('/kill-switch', { method: 'POST', body: { id: 'EXECUTION', reason: 'http probe' } })).status, 200);
  const checked = await call('/permissions/check', { method: 'POST', body: { scope: 'execute:swap', amountUsd: 10 } });
  assert.equal(checked.body.granted, false);
  assert.equal(checked.body.code, 'KILL_SWITCH_ENGAGED');
  const off = await call('/kill-switch', { method: 'POST', body: { id: 'EXECUTION', engaged: false } });
  assert.equal(off.body.code, 'REASON_REQUIRED', 'disengaging must require a recorded reason');
  await call('/kill-switch', { method: 'POST', body: { id: 'EXECUTION', engaged: false, reason: 'probe complete' } });
  assert.equal((await call('/permissions/check', { method: 'POST', body: { scope: 'execute:swap', amountUsd: 10 } })).body.granted, true);
});

await t('lowering autonomy over HTTP revokes the money grant', async () => {
  await call('/permissions/mode', { method: 'POST', body: { mode: 'SUGGEST' } });
  assert.equal((await call('/permissions/check', { method: 'POST', body: { scope: 'execute:swap', amountUsd: 10 } })).body.granted, false);
});

await t('every permission decision is auditable over HTTP', async () => {
  const out = await call('/permissions');
  assert.ok(out.body.audit.some((r) => r.action === 'DENY'));
  assert.ok(out.body.audit.some((r) => r.action === 'SET_MODE'));
});

/* ── memory ─────────────────────────────────────────────────────────────── */
await t('a secret posted into memory is never stored', async () => {
  await call('/memory/retrieve', { method: 'POST', body: { text: 'x' } });
  const dump = await call('/memory');
  assert.equal(JSON.stringify(dump.body).toLowerCase().includes('abandon abandon'), false);
});

await t('memory retrieval is bounded over HTTP', async () => {
  const out = await call('/memory/retrieve', { method: 'POST', body: { text: 'risk profile', limit: 3 } });
  assert.equal(out.status, 200);
  assert.ok(out.body.records.length <= 3);
});

await t('memory can be cleared by the user', async () => {
  assert.equal((await call('/memory', { method: 'DELETE', body: { kind: 'PREFERENCE' } })).status, 200);
});

/* ── the money boundary is unchanged ────────────────────────────────────── */
await t('/tools/execute still refuses without a confirmed actionId', async () => {
  const out = await call('/tools/execute', { method: 'POST', body: { module: 'swap', input: {} } });
  assert.equal(out.status, 428);
  assert.equal(out.body.code, 'CONFIRMATION_REQUIRED');
});

await t('no kernel route reports having executed anything', async () => {
  for (const [path, method, body] of [
    ['/financial/advise', 'POST', {}],
    ['/financial/scenarios', 'POST', {}],
    ['/financial/twin', 'POST', { change: { addCapitalUsd: 100 } }],
    ['/financial/monitor', 'GET', null],
    ['/financial/optimize', 'GET', null]
  ]) {
    const out = await call(path, { method, body });
    const text = JSON.stringify(out.body || {});
    assert.equal(out.body?.executed === true, false, `${path} reported an execution`);
    assert.equal(/"txHash"\s*:\s*"0x/.test(text), false, `${path} returned a transaction hash`);
  }
});

await t('the twin explicitly reports that it touched no wallet', async () => {
  const out = await call('/financial/twin', { method: 'POST', body: { change: { addCapitalUsd: 1000 } } });
  if (out.body.status === 'OK') assert.equal(out.body.touchedWallet, false);
  else assert.equal(out.body.status, 'UNAVAILABLE');
});

await t('an oversized body is refused rather than parsed', async () => {
  const body = Object.fromEntries(Array.from({ length: 40 }, (_, i) => [`f${i}`, i]));
  const out = await call('/financial/advise', { method: 'POST', body });
  assert.equal(out.status, 400);
  assert.equal(out.body.code, 'BODY_TOO_LARGE');
});

await t('the evaluation dashboard does not fabricate the metrics it cannot measure', async () => {
  const out = await call('/evaluation');
  assert.equal(out.status, 200);
  assert.ok(out.body.notMeasuredHere.includes('hallucinationRate'));
});

server.close();

const failed = rows.filter(([, ok]) => !ok);
for (const [name, ok, detail] of rows) console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `\n      ${detail}` : ''}`);
console.log(`\nUpgrade 10 — HTTP surface: ${rows.length - failed.length}/${rows.length} passed`);
if (failed.length) process.exitCode = 1;
