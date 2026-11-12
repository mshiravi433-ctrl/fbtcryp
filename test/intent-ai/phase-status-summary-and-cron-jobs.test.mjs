/**
 * TWO THINGS THAT MUST NOT REGRESS.
 *
 * ─── 1. THE PHASE REPORT HAS TWO FORMS ───────────────────────────────────
 *
 * The full report is 148 KB: 116 KB of phase rows and a 30 KB readiness
 * block. A dashboard that renders a badge reads none of it, and a
 * monitoring client polling every minute was spending a real part of its
 * budget on bytes it never looked at.
 *
 * So:
 *
 *   ?detail=0  → the SUMMARY (default): counts, verdict, and a
 *                per-phase line of phase/id/live/blockers;
 *   ?detail=1  → the DETAIL: everything, unchanged;
 *   ?phase=N   → ONE phase's full record.
 *
 * The default is the summary on purpose: the cheap form should be what a
 * careless client gets, and the expensive form should have to be asked
 * for by name.
 *
 * ─── 2. THE DAILY CRON HAS ELEVEN NAMED JOBS ─────────────────────────────
 *
 * `/api/cron/daily` was 563 ms of CPU — 66 % of all cron CPU — and it
 * was ONE number. Now the eleven jobs are a registry, each with its own
 * route and its own timing, so a cost is attributable and a job can be
 * scheduled on its own.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

const CRON_SECRET = 'phase-status-contract-secret';
process.env.CRON_SECRET = CRON_SECRET;

const boot = async () => {
  const app = (await import('../../server/app.js')).default;
  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  const port = server.address().port;
  return {
    server,
    get: (path, headers = {}) => fetch(`http://127.0.0.1:${port}${path}`, { headers }),
    close: () => new Promise((resolve) => server.close(resolve))
  };
};

test('the phase report has a summary form and a detail form', async () => {
  const { get, close } = await boot();
  try {
    const summaryRes = await get('/api/intents/v1/phase-status');
    const summaryText = await summaryRes.text();
    assert.equal(summaryRes.status, 200);

    const detailRes = await get('/api/intents/v1/phase-status?detail=1');
    const detailText = await detailRes.text();
    assert.equal(detailRes.status, 200);

    /* The summary must be materially smaller. */
    assert.ok(
      summaryText.length < detailText.length / 3,
      `the summary must be far smaller than the detail: ${summaryText.length} vs ${detailText.length}`
    );

    /* And it must still answer the question it exists to answer. */
    const summary = JSON.parse(summaryText);
    assert.ok(summary.phaseCount > 0, 'the summary must say how many phases there are');
    assert.ok(
      typeof summary.operationalPhaseCount === 'number',
      'the summary must say how many are live'
    );
    assert.ok(Array.isArray(summary.phases), 'the summary must list the phases');
    assert.equal(summary.phases.length, summary.phaseCount);
    for (const row of summary.phases.slice(0, 5)) {
      assert.equal(typeof row.phase, 'number');
      assert.equal(typeof row.live, 'boolean');
      assert.ok(Array.isArray(row.blockers));
      /* A summary row must NOT carry the heavy per-phase record. */
      assert.equal(row.source, undefined, 'a summary row must not carry the source list');
      assert.equal(row.tests, undefined, 'a summary row must not carry the test list');
      assert.equal(row.claims, undefined, 'a summary row must not carry the claims block');
    }
  } finally {
    await close();
  }
});

test('the detail form is still the full report', async () => {
  const { get, close } = await boot();
  try {
    const detail = JSON.parse(await (await get('/api/intents/v1/phase-status?detail=1')).text());
    assert.ok(detail.phases.length > 0);
    const row = detail.phases[0];
    assert.ok(Array.isArray(row.source), 'the detail row must carry the source list');
    assert.ok(row.claims, 'the detail row must carry the claims block');
    assert.ok(detail.phase21, 'the detail form must carry the phase21 readiness block');
  } finally {
    await close();
  }
});

test('a single phase can be asked for by number', async () => {
  const { get, close } = await boot();
  try {
    const res = await get('/api/intents/v1/phase-status?phase=51');
    const body = JSON.parse(await res.text());
    assert.equal(res.status, 200);
    assert.equal(body.found, true);
    assert.equal(body.phase.phase, 51);
    assert.ok(body.phase.source, 'the single-phase form must carry the full record');
  } finally {
    await close();
  }
});

test('the summary route works under its own name', async () => {
  const { get, close } = await boot();
  try {
    const res = await get('/api/intents/v1/phase-status/summary');
    assert.equal(res.status, 200);
    const body = JSON.parse(await res.text());
    assert.ok(body.phaseCount > 0);
    assert.equal(body.phases.length, body.phaseCount);
  } finally {
    await close();
  }
});

test('the daily cron runs eleven named jobs, each with its own cost', async () => {
  const { get, close } = await boot();
  try {
    const res = await get('/api/cron/daily', { authorization: `Bearer ${CRON_SECRET}` });
    assert.equal(res.status, 200);
    const body = JSON.parse(await res.text());

    assert.ok(Array.isArray(body.jobs), 'the daily route must report the jobs it ran');
    assert.equal(body.jobs.length, 11, 'there are eleven daily jobs');
    for (const job of body.jobs) {
      assert.equal(typeof job.name, 'string');
      assert.equal(typeof job.ms, 'number');
      assert.ok(job.result !== undefined, `${job.name} must report a result`);
    }
    /* The names are stable — a schedule depends on them. */
    const names = body.jobs.map((j) => j.name).sort();
    assert.deepEqual(names, [
      'certifications', 'fcm-promo', 'monitors', 'ops-probe', 'price-watch',
      'reputation', 'self-probe', 'smart-money', 'stage3-probe', 'watch', 'web-promo'
    ]);
  } finally {
    await close();
  }
});

test('one daily job can be run on its own', async () => {
  const { get, close } = await boot();
  try {
    const res = await get('/api/cron/daily/certifications', { authorization: `Bearer ${CRON_SECRET}` });
    assert.equal(res.status, 200);
    const body = JSON.parse(await res.text());
    assert.equal(body.job, 'certifications');
    assert.equal(typeof body.ms, 'number');
  } finally {
    await close();
  }
});

test('an unknown daily job is a 404 that says what is available', async () => {
  const { get, close } = await boot();
  try {
    const res = await get('/api/cron/daily/not-a-job', { authorization: `Bearer ${CRON_SECRET}` });
    assert.equal(res.status, 404);
    const body = JSON.parse(await res.text());
    assert.equal(body.error, 'UNKNOWN_JOB');
    assert.ok(Array.isArray(body.available) && body.available.length === 11);
  } finally {
    await close();
  }
});

test('the cron routes still refuse an unauthorised caller', async () => {
  const { get, close } = await boot();
  try {
    assert.equal((await get('/api/cron/daily')).status, 401);
    assert.equal((await get('/api/cron/daily/ops-probe')).status, 401);
  } finally {
    await close();
  }
});
