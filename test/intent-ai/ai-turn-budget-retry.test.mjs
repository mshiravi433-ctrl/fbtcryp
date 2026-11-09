/**
 * «در هوش عمیقش وقت می‌چرخد بی‌نهایت … Service temporarily unavailable»
 * ---------------------------------------------------------------------
 * A deep turn spent the whole serverless budget and was killed by the platform
 * (60 s on this plan) while the browser was still waiting 58 s; the failure was
 * then retried with `attempt: 0` hard-coded, so it retried itself forever and the
 * orb never stopped spinning.
 *
 * Two invariants are tested here, both offline:
 *   1. the default turn ceiling leaves the platform real headroom;
 *   2. the surface retries ONCE, at a lighter mode, and then stops.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { turnCeilingMs, turnSafeCeilingMs, intelligenceDeadlineMs, describeIntelligence } from '../../server/aiIntelligence.js';

const PLATFORM_LIMIT_MS = 60000; /* functions.api/index.js maxDuration in vercel.json */

test('B1 · the ceiling the ROUTE uses leaves the platform at least 15 s of headroom', () => {
  const safe = turnSafeCeilingMs({});
  assert.equal(safe, 42000);
  assert.ok(safe <= PLATFORM_LIMIT_MS - 15000, `safe ceiling ${safe} is too close to ${PLATFORM_LIMIT_MS}`);
  /* Safety is a clamp, never an opinion: it cannot exceed the mode ceiling. */
  assert.ok(safe <= turnCeilingMs({}));
  const route = readFileSync(new URL('../../server/aiIntentOS.js', import.meta.url), 'utf8');
  assert.match(route, /const turnCeiling = turnSafeCeilingMs\(\)/);
});

test('B2 · the published contract is untouched (a ceiling, not a rewrite)', () => {
  assert.equal(intelligenceDeadlineMs('max', null, { env: {} }).deadlineMs, 45000);
  const report = describeIntelligence({ env: {}, requested: 'max' });
  assert.equal(report.features.turnCeilingMs, 52000, 'the panel still reports the mode ceiling');
  assert.ok(report.features.turnDeadlineMs <= report.features.turnCeilingMs);
  /* …and the runtime reserve is smaller than both, by design. */
  assert.ok(turnSafeCeilingMs({}) < 45000);
});

test('B3 · an operator can still raise the ceiling, but never past the platform', () => {
  assert.equal(turnCeilingMs({ AI_TURN_CEILING_MS: '48000' }), 48000);
  assert.equal(turnCeilingMs({ AI_TURN_CEILING_MS: '900000' }), 58000);
  assert.ok(turnCeilingMs({ AI_TURN_CEILING_MS: '900000' }) < PLATFORM_LIMIT_MS);
  /* The reserve keeps its own floor even when an operator shrinks it to nothing. */
  assert.ok(turnSafeCeilingMs({ AI_TURN_HEADROOM_MS: '1' }) <= PLATFORM_LIMIT_MS - 5000);
  assert.equal(turnSafeCeilingMs({ AI_TURN_HEADROOM_MS: '30000' }), 30000);
});

test('B4 · the surface retries once, not forever', () => {
  const ui = readFileSync(new URL('../../src/components/IntentAIUnified.jsx', import.meta.url), 'utf8');
  assert.match(ui, /const canRetry = attempt < 1/);
  assert.match(ui, /attempt: attempt \+ 1/);
  /* The bug: the retry passed a fresh 0 every time, so the cap could never trip. */
  assert.doesNotMatch(ui, /getRetryStrategy\(\{ message: code \}, \{ attempt: 0 \}\)/);
});

test('B5 · a timeout retries in a lighter mode, not in the one that ran out of clock', () => {
  const ui = readFileSync(new URL('../../src/components/IntentAIUnified.jsx', import.meta.url), 'utf8');
  assert.match(ui, /intelligenceOverride: timedOut \? 'balanced'/);
  assert.match(ui, /intelligence: opts\.intelligenceOverride/);
});

test('B6 · the retry notice is Persian in a Persian chat, not an English stub', () => {
  const ui = readFileSync(new URL('../../src/components/IntentAIUnified.jsx', import.meta.url), 'utf8');
  assert.match(ui, /پاسخ در مهلت نرسید؛ یک‌بار دیگر/);
});

test('B7 · the offline reading is not stapled under a retry that is still coming', () => {
  const ui = readFileSync(new URL('../../src/components/IntentAIUnified.jsx', import.meta.url), 'utf8');
  assert.match(ui, /const localReading = !canRetry && osResult\?\.understood === false/);
});
