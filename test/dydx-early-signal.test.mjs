import { test } from 'node:test';
import assert from 'node:assert/strict';
import { earlyTokenSignal } from '../src/lib/futures/dydxTokenBrain.js';
import { assessFuturesRisk } from '../src/lib/futures-engine/risk.js';

const hour = 3600_000;
const start = Date.UTC(2026, 10, 1);
const rows = Array.from({length: 40}, (_, i) => ({startedAt: start + i * hour, open: 100, high: 102, low: 98, close: 100, volume: 100}));
const now = start + 40 * hour;
test('early watch uses completed candles near a prior boundary', () => {
  const up = rows.map((r) => ({...r}));
  up[39] = {...up[39], close: 101, high: 102};
  assert.equal(earlyTokenSignal({candles: up, now}).direction, 'up');
  const down = rows.map((r) => ({...r}));
  down[39] = {...down[39], close: 99, low: 98};
  assert.equal(earlyTokenSignal({candles: down, now}).direction, 'down');
  const quiet = earlyTokenSignal({candles: rows, now});
  assert.equal(quiet.status, 'none');
  assert.equal(quiet.nearestBoundary, 102);
  assert.equal(quiet.nearestDistanceAtr, 0.5);
  assert.equal(quiet.candleTime, start + 39 * hour);
  assert.equal(earlyTokenSignal({candles: up, now: now + 4 * hour}).status, 'unavailable');
  assert.equal(earlyTokenSignal({candles: up, now, live: false}).status, 'unavailable');
  assert.equal(earlyTokenSignal({candles: up.filter((_, i) => i !== 20), now}).status, 'unavailable');
  assert.equal(earlyTokenSignal({candles: up, now: now - hour / 2}).status, 'none');
});
test('zero free collateral blocks a positive order margin', () => {
  const risk = assessFuturesRisk({collateralUsd: 50, availableBalanceUsd: 0, leverage: 2, entryPrice: 100});
  assert.ok(risk.blockReasons.includes('INSUFFICIENT_BALANCE'));
});
