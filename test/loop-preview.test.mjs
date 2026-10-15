import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPositionPreview, compareLoopPosition } from '../src/lib/loopPreview.js';

const account = {
  ok: true,
  totalCollateralUsd: 1000,
  totalDebtUsd: 400,
  healthFactor: 2,
  availableBorrowsUsd: 200,
  liquidationThresholdPct: 80,
  ltvPct: 60
};

test('unavailable position preview never exposes old numeric values', () => {
  const result = buildPositionPreview({
    account,
    dataStatus: 'unavailable',
    readAt: Date.now() - 600_000,
    ageMs: 600_000
  });
  assert.equal(result.status, 'unavailable');
  assert.equal(result.account, null);
  assert.equal(result.readAt, null);
});

test('cached position carries its age and becomes stale after the configured window', () => {
  const now = 1_000_000;
  const result = buildPositionPreview({ account, dataStatus: 'cached', readAt: now - 120_000, now, staleAfterMs: 90_000 });
  assert.equal(result.status, 'stale');
  assert.equal(result.ageMs, 120_000);
  assert.equal(result.account.healthFactor, 2);
});

test('live and partial position states preserve only finite account values', () => {
  const result = buildPositionPreview({ account: { ...account, totalDebtUsd: null }, dataStatus: 'partial', readAt: 1000, now: 2000 });
  assert.equal(result.status, 'partial');
  assert.equal(result.account.totalDebtUsd, null);
  assert.equal(result.readAt, 1000);
});

test('existing debt and over-LTV positions are explicitly distinguished', () => {
  const result = compareLoopPosition({ account, intendedCollateralUsd: 1000, ltvPct: 30 });
  assert.equal(result.differs, true);
  assert.equal(result.alreadyOverLtv, true);
  assert.equal(result.differenceUsd, 0);
});
