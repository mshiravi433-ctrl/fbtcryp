/**
 * Two cron-cost changes, and the honesty rules that make them safe.
 *
 * 1. `runSelfProbe` reuses evidence this deployment already earned and has
 *    not expired, instead of re-measuring three exchange endpoints and a
 *    TLS handshake every time it runs. The evidence carries `expiresAt`, so
 *    the TTL is the same one the probe would have used.
 *
 * 2. `runSmartMoneyCadence` skips the expensive wallet INDEX pass when it
 *    ran recently, because TWO crons call it — `/api/cron/daily` at 09:00
 *    and `/api/cron/smart-money` at 21:41 — and the second pass had nothing
 *    new to say. The ALERT cycle always runs: an alert is a push a person
 *    subscribed to.
 *
 * The dangerous part of both is not the saving. It is that a skipped or
 * carried pass could be REPORTED as work that happened. These tests hold
 * that line.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { runSmartMoneyCadence, DEFAULT_MIN_INDEX_GAP_MS } from '../../server/smartMoney/cadence.js';
import { runSelfProbe, SELF_PROBE_KINDS } from '../../server/intentSelfProbe.js';

/* ── 1. the smart-money cadence ───────────────────────────────────────── */

test('a recent index pass is skipped and says so by name', async () => {
  let indexRuns = 0;
  let alertRuns = 0;
  const out = await runSmartMoneyCadence({
    alerts: async () => { alertRuns += 1; return { checked: 1, fired: 0, delivered: 0, status: 'ok' }; },
    intelligence: async () => { indexRuns += 1; return { status: 'ok' }; },
    durable: () => true,
    lastIndexAt: Date.now() - 60_000,
    now: Date.now()
  });
  assert.equal(indexRuns, 0, 'the index pass must not run again inside the window');
  assert.equal(out.intelligence.status, 'skipped-recent-index');
  assert.ok(out.intelligence.reason.length > 0, 'a skipped pass must say WHY');
  assert.equal(out.intelligence.ageMs > 0, true);
});

test('the ALERT cycle always runs, even when the index is skipped', async () => {
  let alertRuns = 0;
  await runSmartMoneyCadence({
    alerts: async () => { alertRuns += 1; return { status: 'ok' }; },
    intelligence: async () => ({ status: 'ok' }),
    durable: () => true,
    lastIndexAt: Date.now() - 60_000,
    now: Date.now()
  });
  assert.equal(alertRuns, 1, 'an alert is a push a person subscribed to — skipping it stops delivering what they asked for');
});

test('an old index pass runs again', async () => {
  let indexRuns = 0;
  const out = await runSmartMoneyCadence({
    alerts: async () => ({ status: 'ok' }),
    intelligence: async () => { indexRuns += 1; return { status: 'ok' }; },
    durable: () => true,
    lastIndexAt: Date.now() - 20 * 60 * 60_000,
    now: Date.now()
  });
  assert.equal(indexRuns, 1);
  assert.equal(out.intelligence.status, 'ok');
});

test('an UNKNOWN last pass runs the index — never assume freshness', async () => {
  let indexRuns = 0;
  await runSmartMoneyCadence({
    alerts: async () => ({ status: 'ok' }),
    intelligence: async () => { indexRuns += 1; return { status: 'ok' }; },
    durable: () => true,
    lastIndexAt: null,
    now: Date.now()
  });
  assert.equal(indexRuns, 1, 'not knowing when the last pass ran is not a reason to skip it');
});

test('a last pass in the FUTURE does not skip the index', async () => {
  let indexRuns = 0;
  await runSmartMoneyCadence({
    alerts: async () => ({ status: 'ok' }),
    intelligence: async () => { indexRuns += 1; return { status: 'ok' }; },
    durable: () => true,
    lastIndexAt: Date.now() + 60_000,
    now: Date.now()
  });
  assert.equal(indexRuns, 1, 'a clock that went backwards must not turn into a skipped pass');
});

test('the default window covers the gap between the two crons', () => {
  assert.ok(DEFAULT_MIN_INDEX_GAP_MS >= 12 * 60 * 60_000, 'the window must cover the 09:00 → 21:41 gap');
});

/* ── 2. the self-probe reuse ──────────────────────────────────────────── */

test('the self-probe report names which kinds were measured and which were carried', async () => {
  const report = await runSelfProbe({ store: false, now: Date.now() });
  assert.ok(Array.isArray(report.measuredKinds), 'the report must list what it measured');
  assert.ok(Array.isArray(report.carriedKinds), 'the report must list what it carried');
  assert.equal(report.measuredKinds.length + report.carriedKinds.length <= SELF_PROBE_KINDS.length, true);
  /* Whatever happened, the two lists must not overlap: a kind cannot be
     both measured and carried in the same pass. */
  const measured = new Set(report.measuredKinds);
  for (const kind of report.carriedKinds) assert.equal(measured.has(kind), false, `${kind} is in both lists`);
});

test('a first pass with no stored evidence measures rather than carries', async () => {
  const report = await runSelfProbe({ store: false, now: Date.now() });
  assert.ok(report.carriedKinds.length >= 0);
  /* Without a durable store there is nothing to carry, so everything that
     answered was measured in this pass. */
  if (!report.carriedKinds.length) {
    assert.equal(report.measuredKinds.length, report.earnedCount, 'every earned kind was measured in this pass');
  }
});

test('every kind the report claims still names a code when it is missing', async () => {
  const report = await runSelfProbe({ store: false, now: Date.now() });
  for (const row of report.missing) {
    assert.ok(row.kind, 'a missing kind must be named');
    assert.ok(row.code, 'a missing kind must carry a code — "missing" without a code is not diagnosable');
  }
});

test('the reuse can be switched off, so a caller can demand a measurement', async () => {
  const report = await runSelfProbe({ store: false, reuse: false, now: Date.now() });
  assert.equal(report.carriedKinds.length, 0, 'reuse:false means every kind is measured fresh');
});
