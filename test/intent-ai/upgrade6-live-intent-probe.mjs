/**
 * FBT INTENT AI — UPGRADE 6: LIVE INTENT REGRESSION
 *
 * The four behaviors below were reported as version-one bugs on the current
 * code:
 *
 *   1. «می‌خواهم انتقال کراس‌چین انجام دهم»  → SEND /wallet?tab=send  (must be BRIDGE)
 *   2. «یک سفارش خودکار روی eth بزار که وقتی قیمتش به ۲۷۰۰ رسید خبر بده»
 *        → ORDERS but the 2700 threshold was dropped from the reply
 *   3. «میخام سود ۲۰ درصد داشته باشم»
 *        → YIELD_DISCOVERY with targetReturn null (must be a GOAL with targetReturn)
 *   4. «پرتفوی من را متعادل کن» → REBALANCE but a canned empty reply
 *
 * This probe drives the real Intent OS pipeline (understand → route → agents →
 * human response), so it catches both classification and the user-visible text.
 */

import assert from 'node:assert/strict';
import { getIntentOS, resetIntentOS } from '../../src/lib/intent-ai/os/index.js';

let total = 0;
let passed = 0;

async function test(name, fn) {
  total++;
  try {
    await fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    console.error(`  ✗ ${name}`);
    console.error(`    ${e.message}`);
    process.exitCode = 1;
  }
}

global.localStorage = new Proxy({}, { get: () => () => null, set: () => true });

async function runCase(message) {
  resetIntentOS();
  const os = getIntentOS({});
  return os.process({ message, currentPage: '/intent', locale: 'fa', services: {} });
}

await test('cross-chain transfer is BRIDGE (/bridge), not SEND (/wallet?tab=send)', async () => {
  const r = await runCase('می‌خواهم انتقال کراس‌چین انجام دهم');
  assert.equal(r.intent?.type, 'BRIDGE', `expected BRIDGE, got ${r.intent?.type}`);
  assert.ok(String(r.navigated || '').startsWith('/bridge'), `expected /bridge route, got ${r.navigated}`);
  assert.ok(!String(r.navigated || '').startsWith('/wallet'), `must not route to wallet send, got ${r.navigated}`);
});

await test('orders keep the 2700 price trigger in entities and reply', async () => {
  const r = await runCase('یک سفارش خودکار روی eth بزار که وقتی قیمتش به ۲۷۰۰ رسید خبر بده');
  assert.equal(r.intent?.type, 'ORDERS', `expected ORDERS, got ${r.intent?.type}`);
  assert.equal(r.intent?.entities?.token, 'ETH');
  assert.equal(r.intent?.entities?.priceTrigger, 2700, `priceTrigger must be 2700, got ${r.intent?.entities?.priceTrigger}`);
  assert.equal(r.intent?.priceTrigger, 2700);
  assert.equal(r.navigated, '/orders');
  assert.ok(String(r.message || '').includes('2700'), `reply must mention the 2700 trigger, got ${r.message}`);
});

await test('«سود ۲۰ درصد» is a GOAL and records targetReturn 20', async () => {
  const r = await runCase('میخام سود ۲۰ درصد داشته باشم');
  assert.equal(r.intent?.type, 'GOAL', `expected GOAL, got ${r.intent?.type}`);
  assert.equal(r.intent?.entities?.targetReturn, 20, `targetReturn must be 20, got ${r.intent?.entities?.targetReturn}`);
  assert.equal(r.intent?.goal, 'TARGET_RETURN');
  assert.ok(String(r.message || '').includes('هدف'), 'reply must acknowledge a financial goal');
  assert.ok(String(r.message || '').includes('20'), 'reply must mention 20%');
  assert.equal(r.navigated, null);
});

await test('rebalance gives a real answer, not a canned generic line', async () => {
  const r = await runCase('پرتفوی من را متعادل کن');
  assert.equal(r.intent?.type, 'REBALANCE', `expected REBALANCE, got ${r.intent?.type}`);
  const msg = String(r.message || '');
  assert.ok(
    msg.includes('تخصیص هدف') || msg.includes('متعادل‌سازی'),
    `reply must explain what rebalance needs, got ${msg}`
  );
  assert.ok(!msg.includes('به ماژول مربوط وصل کردم'), 'reply must not be the generic fallback');
  assert.equal(r.navigated, null);
});

console.log(`\n=== UPGRADE 6 LIVE INTENT PROBE: ${passed}/${total} passed ===\n`);
if (passed !== total) process.exit(1);
