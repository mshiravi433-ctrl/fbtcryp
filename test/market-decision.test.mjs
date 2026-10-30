import { test } from 'node:test';
import assert from 'node:assert/strict';
import { marketDecision } from '../src/lib/marketDecision.js';

test('independent observed breadth and range, including neutral prices', () => {
  const result = marketDecision([
    { change24h: 2, high24h: 110, low24h: 100 },
    { change24h: -3, high24h: 120, low24h: 100 },
    { change24h: 0 }
  ]);
  assert.ok(Math.abs(result[0].value - 15) < 1e-9);
  assert.ok(Math.abs(result[1].value - 100 / 3) < 1e-9);
  assert.ok(Math.abs(result[2].value - 100 / 3) < 1e-9);
});
test('missing and synthetic values never become real percentages', () => {
  const result = marketDecision([
    { change24h: null }, { change24h: '' }, { change24h: false },
    { change24h: 5, offline: true }, { change24h: -2, dataProvenance: 'offline' },
    { high24h: 0, low24h: 0 }
  ]);
  assert.ok(result.every(metric => metric.value === null));
});
test('zero breadth is valid and extreme range is not normalised away', () => {
  const result = marketDecision([{ change24h: 0, high24h: 300, low24h: 100 }]);
  assert.equal(result[0].value, 200);
  assert.equal(result[1].value, 0);
  assert.equal(result[2].value, 0);
});
