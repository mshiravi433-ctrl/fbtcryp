/**
 * FBT INTENT AI — UPGRADE 6: PENDING INTENT AUTO-RESUME LOOP
 *
 * User request:
 *   «وقتی از عملیات وارد یک لینک میشویم و ... برگردیم، دوباره به هوش مصنوعی به
 *   اجبار میبره همون لینک»
 *
 * Root shape: `resumePendingIntent()` leaves a READY pending intent in
 * localStorage.  `IntentAIUnified` re-mounts every time the user returns to
 * `/intent` (the chat route is remounted), and its wallet-connected effect
 * re-reads `loadPendingIntent()` and re-sends the SAME original message, which
 * the local Intent OS turns into the SAME navigation — again and again.
 *
 * The fix is to persist a `resumedAt` marker the first time the pending intent
 * is actually replayed, and to refuse auto-replay on later mounts.
 */

import assert from 'node:assert/strict';
import {
  createPendingIntent,
  savePendingIntent,
  loadPendingIntent,
  clearPendingIntent,
  resumePendingIntent,
  shouldAutoResumePending,
  markPendingResumed
} from '../../src/lib/intent-ai/pendingIntent.js';
import { PENDING_INTENT_KEY } from '../../src/lib/intent-ai/pendingIntent.js';

let total = 0;
let passed = 0;

function test(name, fn) {
  total++;
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    console.error(`  ✗ ${name}`);
    console.error(`    ${e.message}`);
    process.exitCode = 1;
  }
}

// In-memory localStorage
const store = new Map();
global.localStorage = {
  getItem: (k) => store.get(k) ?? null,
  setItem: (k, v) => store.set(k, v),
  removeItem: (k) => store.delete(k),
  clear: () => store.clear()
};

function seedIntent(msg, type, status = 'WAITING_FOR_WALLET') {
  global.localStorage.clear();
  const made = createPendingIntent({ originalMessage: msg, intentType: type, status });
  assert.equal(made.ok, true);
  savePendingIntent(made.intent);
  return made.intent;
}

test('a fresh WAITING_FOR_WALLET intent is auto-resumable on first mount', () => {
  seedIntent('swap 100 USDT to ETH', 'SWAP', 'WAITING_FOR_WALLET');
  const current = loadPendingIntent();
  assert.equal(shouldAutoResumePending(current), true, 'first mount should auto-resume');
  const resumed = resumePendingIntent();
  assert.equal(resumed.ok, true);
  assert.equal(resumed.originalMessage, 'swap 100 USDT to ETH');
  assert.equal(resumed.intent.status, 'READY');
  assert.equal(resumed.intent.resumedAt != null, true, 'resumedAt is persisted on first replay');
});

test('a READY intent that was already resumed is NOT auto-resumed again', () => {
  seedIntent('rebalance my portfolio', 'REBALANCE_PORTFOLIO', 'READY');
  const before = loadPendingIntent();
  assert.equal(before.resumedAt, null);
  assert.equal(shouldAutoResumePending(before), true);

  const resumed = resumePendingIntent();
  assert.equal(resumed.ok, true);
  assert.equal(resumed.intent.resumedAt != null, true, 'first replay sets resumedAt');

  // Second mount (returns to /intent after opening the link): must NOT re-send.
  const again = loadPendingIntent();
  assert.equal(shouldAutoResumePending(again), false, 'second mount must not auto-resume again');
  const second = resumePendingIntent();
  assert.equal(second.ok, false);
  assert.equal(second.code, 'ALREADY_RESUMED');
});

test('markPendingResumed keeps the original message and refuses to double-mark', () => {
  seedIntent('goal 20%', 'GOAL', 'READY');
  const marked = markPendingResumed(loadPendingIntent());
  assert.equal(marked.resumedAt != null, true);
  assert.equal(loadPendingIntent().originalMessage, 'goal 20%');
  const again = markPendingResumed(loadPendingIntent(), undefined, { now: marked.resumedAt + 999 });
  assert.equal(again.resumedAt, marked.resumedAt, 'resumedAt is not overwritten');
});

test('explicit clear removes the pending intent entirely', () => {
  clearPendingIntent();
  assert.equal(loadPendingIntent(), null);
  assert.equal(store.has(PENDING_INTENT_KEY), false);
});

console.log(`\n=== UPGRADE 6 PENDING RESUME PROBE: ${passed}/${total} passed ===\n`);
if (passed !== total) process.exit(1);
