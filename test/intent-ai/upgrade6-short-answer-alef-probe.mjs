/**
 * FBT INTENT AI — UPGRADE 6: Persian alef folding in short answers.
 *
 * Regression probe for the «اره» (U+0627 U+0631 U+0647) vs «آره»
 * (U+0622 U+0631 U+0647) mis-match.  normalizeText in slotFillingEngine.js
 * must fold أ/إ/آ to ا (and ۀ/ؤ like the rest of the repo's normalizers),
 * and the confirmation lexicon must accept the folded plain-alef forms so the
 * madda form keeps working too, i.e.:
 *   parseShortAnswer('اره') === confirm
 *   parseShortAnswer('آره') === confirm
 */

import assert from 'node:assert/strict';
import { parseShortAnswer } from '../../src/lib/intent-ai/os/upgrade6/slotFillingEngine.js';

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

test('»اره« (plain alef) is a confirm answer', () => {
  const r = parseShortAnswer('اره');
  assert.equal(r.type, 'confirm', `expected confirm, got ${JSON.stringify(r)}`);
  assert.equal(r.value, true);
  assert.equal(r.confidence, 0.99);
});

test('»آره« (alef with madda) stays a confirm answer', () => {
  const r = parseShortAnswer('آره');
  assert.equal(r.type, 'confirm', `expected confirm, got ${JSON.stringify(r)}`);
  assert.equal(r.value, true);
  assert.equal(r.confidence, 0.99);
});

test('Arabic أ/إ alef variants fold into confirm', () => {
  assert.equal(parseShortAnswer('أره').type, 'confirm');
  assert.equal(parseShortAnswer('إره').type, 'confirm');
});

test('»آری/اری« remain confirm answers after alef folding', () => {
  assert.equal(parseShortAnswer('آری').type, 'confirm');
  assert.equal(parseShortAnswer('اری').type, 'confirm');
});

test('unrelated short answers are unchanged', () => {
  assert.equal(parseShortAnswer('بله').type, 'confirm');
  assert.equal(parseShortAnswer('نه').type, 'reject');
  assert.equal(parseShortAnswer('۴ ماه').type, 'duration');
  assert.equal(parseShortAnswer('۲۰ درصد').type, 'percent');
  assert.equal(parseShortAnswer('اولی').type, 'selection');
});

console.log(`\n=== SHORT ANSWER ALEF PROBE: ${passed}/${total} passed ===\n`);
if (passed !== total) process.exit(1);
