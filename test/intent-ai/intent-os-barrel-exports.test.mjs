import test from 'node:test';
import assert from 'node:assert/strict';
import * as intentOs from '../../src/lib/intent-ai/os/index.js';

test('Intent OS barrel exports both confidence APIs without ambiguous star exports', () => {
  assert.equal(typeof intentOs.calculateConfidenceBreakdown, 'function');
  assert.equal(typeof intentOs.calculateIntentConfidenceBreakdown, 'function');
  assert.notEqual(intentOs.calculateConfidenceBreakdown, intentOs.calculateIntentConfidenceBreakdown);

  const confidence = intentOs.calculateConfidenceBreakdown({ readOnly: true }, {});
  const intentConfidence = intentOs.calculateIntentConfidenceBreakdown({ intentType: 'GENERAL' }, {});
  assert.equal(typeof confidence.overallScore, 'number');
  assert.equal(typeof intentConfidence.overall, 'number');
});
