/**
 * FBT NEUROMORPHIC 2050 — PHASE 8: /api/v1/ai/neuromorphic/universes
 * ===========================================================================
 * Boots only the neuromorphic router (not the whole app) and checks the real
 * HTTP contract:
 *   · deterministic, cached for 60 s, zero server GPU,
 *   · explicitly labelled synthetic self-test (never market evidence),
 *   · no raw candles / device ids uploaded,
 *   · the hard no-execution wall is present in the payload.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';

import { createNeuromorphicRouter } from '../server/aiNeuromorphicRoutes.js';
import { __clearResearchUniversesCache } from '../server/aiResearchUniverses.js';

test('serves a deterministic, cached, zero-GPU universe self-test over real HTTP', async () => {
  __clearResearchUniversesCache();
  const app = express();
  app.use(express.json());
  app.use('/api/v1/ai', createNeuromorphicRouter());

  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  try {
    const { port } = server.address();
    const url = `http://127.0.0.1:${port}/api/v1/ai/neuromorphic/universes?population=10&steps=100`;

    const first = await fetch(url);
    assert.equal(first.status, 200);
    const a = await first.json();
    assert.equal(a.ok, true);
    assert.equal(a.schema, 'fbt.neuromorphic.research-universes.v1');
    assert.equal(a.endpointSchema, 'fbt.neuromorphic.universes-endpoint.v1');
    assert.equal(a.cached, false);
    assert.equal(a.zeroServerGpu, true);
    assert.equal(a.honesty.syntheticDataUsed, true);
    assert.equal(a.honesty.uploadsRawCandles, false);
    assert.equal(a.honesty.accuracyIsNotProfitability, true);
    assert.equal(a.laws.canExecute, false);
    assert.equal(a.laws.canSign, false);
    assert.equal(a.laws.canMoveFunds, false);
    assert.equal(a.laws.uploadsDeviceIds, false);
    assert.equal(a.population, 10);
    assert.ok(a.probe.steps > 40);
    assert.equal(a.probe.syntheticDataUsed, true);
    assert.match(a.probe.disclaimer, /synthetic fixture/);
    assert.ok(a.consensus.brier > 0 && a.consensus.brier < 1);
    assert.ok(a.consensus.control.brier > 0 && a.consensus.control.brier < 1);
    assert.equal(a.oracle.hindsight, true);

    const second = await fetch(url);
    const b = await second.json();
    assert.equal(b.cached, true, 'the second identical read must come from the 60 s cache');
    assert.equal(b.contentHash, a.contentHash);
    assert.deepEqual(b.consensus, a.consensus);
    assert.deepEqual(b.probe, a.probe);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('clamps hostile query parameters instead of trusting them', async () => {
  __clearResearchUniversesCache();
  const app = express();
  app.use('/api/v1/ai', createNeuromorphicRouter());
  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  try {
    const { port } = server.address();
    const url = `http://127.0.0.1:${port}/api/v1/ai/neuromorphic/universes?population=99999&steps=-4`;
    const res = await fetch(url);
    assert.equal(res.status, 200);
    const payload = await res.json();
    assert.equal(payload.population, 32);
    assert.ok(payload.probe.steps >= 20, `clamped probe should still run, got ${payload.probe.steps}`);
    assert.ok(payload.probe.steps <= 600);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
