import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  INTENT_BACKGROUND_EVIDENCE_INTERVAL_MS,
  intentBackgroundEvidenceEnabled,
  startIntentBackgroundEvidence
} from '../server/intentBackgroundEvidence.js';

const results = [];
const check = (name, predicate) => {
  assert.equal(Boolean(predicate), true, name);
  results.push(name);
};

function fakeTimers() {
  const timeouts = [];
  const intervals = [];
  const cleared = [];
  const make = (collection, callback, ms, kind) => {
    const timer = {
      callback,
      ms,
      kind,
      unrefCalled: false,
      unref() { this.unrefCalled = true; }
    };
    collection.push(timer);
    return timer;
  };
  return {
    timeouts,
    intervals,
    cleared,
    scheduleTimeout: (callback, ms) => make(timeouts, callback, ms, 'timeout'),
    scheduleInterval: (callback, ms) => make(intervals, callback, ms, 'interval'),
    cancelTimeout: (timer) => cleared.push(timer),
    cancelInterval: (timer) => cleared.push(timer)
  };
}

const disabledEnvironments = [
  {},
  { NODE_ENV: 'production' },
  { NODE_ENV: 'production', VERCEL: '1', INTENT_BACKGROUND_EVIDENCE: '1' },
  { NODE_ENV: 'production', VERCEL_ENV: 'production', INTENT_BACKGROUND_EVIDENCE: '1' },
  { NODE_ENV: 'test', INTENT_BACKGROUND_EVIDENCE: '1' }
];
for (const env of disabledEnvironments) {
  const timers = fakeTimers();
  let collected = false;
  const worker = startIntentBackgroundEvidence({
    env,
    collect: () => { collected = true; },
    ...timers
  });
  assert.equal(worker.enabled, false);
  assert.equal(timers.timeouts.length, 0);
  assert.equal(timers.intervals.length, 0);
  assert.equal(collected, false);
}
check('no boot or recurring timer is registered on default, test, or Vercel environments', true);
check('long-lived non-Vercel servers require an explicit opt-in',
  intentBackgroundEvidenceEnabled({ NODE_ENV: 'production', INTENT_BACKGROUND_EVIDENCE: '1' }));
check('Vercel always disables process-local evidence work, even when explicitly opted in',
  !intentBackgroundEvidenceEnabled({ NODE_ENV: 'production', VERCEL: '1', INTENT_BACKGROUND_EVIDENCE: '1' }));

const timers = fakeTimers();
let collectCalls = 0;
let releaseCollection;
const worker = startIntentBackgroundEvidence({
  env: { NODE_ENV: 'production', INTENT_BACKGROUND_EVIDENCE: '1' },
  collect: () => {
    collectCalls += 1;
    return new Promise((resolve) => { releaseCollection = resolve; });
  },
  ...timers
});
assert.equal(worker.enabled, true);
assert.equal(timers.timeouts.length, 1);
assert.equal(timers.timeouts[0].ms, 200);
assert.equal(timers.timeouts[0].unrefCalled, true);
assert.equal(timers.intervals.length, 0);

timers.timeouts[0].callback();
assert.equal(collectCalls, 1);
assert.equal(timers.intervals.length, 1);
assert.equal(timers.intervals[0].ms, INTENT_BACKGROUND_EVIDENCE_INTERVAL_MS);
assert.equal(timers.intervals[0].unrefCalled, true);
timers.intervals[0].callback();
assert.equal(collectCalls, 1, 'a long refresh must not overlap itself');
releaseCollection();
await Promise.resolve();
await Promise.resolve();
timers.intervals[0].callback();
assert.equal(collectCalls, 2);
check('opted-in worker is delayed, unrefed, periodic, and overlap-safe', true);

worker.stop();
assert.equal(timers.cleared.length, 2);
timers.intervals[0].callback();
assert.equal(collectCalls, 2);
check('stopping the worker cancels both timers and prevents another run', true);

const { collectLocalEvidence } = await import('../server/intentAutoEvidence.js');
const evidenceNow = Date.now();
const localEvidence = await collectLocalEvidence({ now: evidenceNow });
check('local evidence remains fresh through the daily cron window',
  localEvidence.length > 0
  && localEvidence.every((record) => record.expiresAt === evidenceNow + 26 * 3600_000));

const appSource = readFileSync(new URL('../server/app.js', import.meta.url), 'utf8');
check('the Express app uses the guarded scheduler', appSource.includes('startIntentBackgroundEvidence({ collect: refreshIntentBackgroundEvidence })'));
check('Vercel refreshes probes from the existing daily cron with a daily-safe TTL',
  appSource.includes('const DAILY_EVIDENCE_TTL_HOURS = 26;')
  && appSource.includes('runSelfProbe({ ttlHours: DAILY_EVIDENCE_TTL_HOURS')
  && appSource.includes('runOpsProbe({ ttlHours: DAILY_EVIDENCE_TTL_HOURS })')
  && appSource.includes('runStage3Probe({ ttlHours: DAILY_EVIDENCE_TTL_HOURS })'));

console.log(JSON.stringify({ probe: 'intent-background-evidence', passed: results.length, results }, null, 2));
