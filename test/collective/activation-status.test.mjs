#!/usr/bin/env node
/**
 * Regression tests for the public activation status of the FBT AI Collective.
 *
 * What is locked here:
 *   1. The payload never claims a live deployment it did not observe.
 *   2. Reading the public GitHub Actions API needs no token, and a failure or
 *      rate-limit falls back to the committed snapshot instead of breaking the
 *      endpoint (the dashboard must degrade, not lie or 500).
 *   3. The workflow-verified snapshot is the only automatic source of chain
 *      addresses, and an explicit `COLLECTIVE_READS_ENABLED=false` disables it.
 *   4. The payload is secret-free by construction.
 */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import test from 'node:test';
import express from 'express';

import {
  buildCollectiveActivationPayload,
  createCollectiveActivationStatus,
  COLLECTIVE_ACTIVATION_SCHEMA
} from '../../server/collective/activation.js';
import { readCollectiveConfig, readSnapshotDeployment, publicCollectiveConfig } from '../../server/collective/config.js';
import { createCollectiveRouter } from '../../server/collective/routes.js';
import { ACTIVATION_SNAPSHOT } from '../../server/collective/activation.snapshot.js';

const FACTORY = '0x1111111111111111111111111111111111111111';
const ASSET = '0x3333333333333333333333333333333333333333';
const RPC = 'https://rpc.example.test';

const emptySnapshot = {
  schema: 'fbt.collective.activation.snapshot.v1',
  generatedAt: null,
  source: 'uninitialized',
  repo: 'mshiravi433-ctrl/fbtcryp',
  commit: null,
  workflow: 'collective-activation.yml',
  run: null,
  checks: [],
  artifacts: [],
  liveDeployment: null
};

const verifiedSnapshot = {
  schema: 'fbt.collective.activation.snapshot.v1',
  generatedAt: '2026-10-19T10:00:00.000Z',
  source: 'github-actions',
  repo: 'mshiravi433-ctrl/fbtcryp',
  commit: 'a'.repeat(40),
  workflow: 'collective-activation.yml',
  run: {
    id: 123,
    number: 7,
    url: 'https://github.com/mshiravi433-ctrl/fbtcryp/actions/runs/123',
    event: 'push',
    conclusion: 'success',
    headSha: 'a'.repeat(40),
    createdAt: '2026-10-19T09:58:00.000Z',
    updatedAt: '2026-10-19T10:00:00.000Z',
    durationSeconds: 120
  },
  checks: [
    { id: 'compile', label: 'Compile 15 contracts (solc)', ok: true },
    { id: 'contract', label: 'Contract probe on Ganache (no funds)', ok: true },
    { id: 'api', label: 'API + activation tests', ok: true },
    { id: 'rehearsal', label: 'Full local rehearsal', ok: true }
  ],
  artifacts: [],
  liveDeployment: {
    status: 'activated',
    chainId: 4663,
    factoryAddress: FACTORY,
    assetAddress: ASSET,
    deploymentBlock: 100,
    rpcUrl: RPC,
    verified: true,
    verifiedAt: '2026-10-19T09:59:00.000Z'
  }
};

const disabledConfig = readCollectiveConfig({ COLLECTIVE_READS_ENABLED: 'false' }, ACTIVATION_SNAPSHOT);

test('unconfigured Collective reports run-deployment and never claims a live chain', () => {
  const payload = buildCollectiveActivationPayload({
    config: disabledConfig,
    pipeline: null,
    snapshot: emptySnapshot,
    now: () => '2026-10-19T10:00:00.000Z'
  });
  assert.equal(payload.schema, COLLECTIVE_ACTIVATION_SCHEMA);
  assert.equal(payload.deployment.configured, false);
  assert.equal(payload.deployment.nextStep, 'run-deployment');
  assert.equal(payload.deployment.command.includes('phase=deploy'), true);
  assert.equal(payload.deployment.liveDeployment, null);
  assert.equal(payload.pipeline.state, 'never-run');
  assert.equal(payload.pipeline.workflow, 'collective-activation.yml');
  assert.equal(payload.policy.pipelineKeyless, true);
  assert.equal(payload.policy.pipelineGasFree, true);
  // The honest half: the pipeline is free, the chain deployment is not.
  assert.equal(payload.policy.onChainDeploymentRequiresGas, true);
  assert.equal(payload.policy.deploymentGasPayer, 'operator-wallet');
  assert.equal(payload.policy.gasSponsorshipEnabled, false);
});

test('payload is secret-free', () => {
  const payload = buildCollectiveActivationPayload({
    config: readCollectiveConfig({}, verifiedSnapshot),
    snapshot: verifiedSnapshot,
    now: () => '2026-10-19T10:00:00.000Z'
  });
  const text = JSON.stringify(payload);
  // No 32-byte hex secret anywhere (addresses are 20 bytes, hashes are only
  // ever published as short shas).
  assert.equal(/0x[0-9a-f]{64}/i.test(text), false);
  assert.equal(/"(privateKey|deployerKey|secretValue)"/i.test(text), false);
  assert.equal(/https?:\/\/[^"'@]+:[^"'@]+@/.test(text), false);
  // The *name* of the required secret is public knowledge; its value is not.
  assert.deepEqual(payload.deployment.requiredSecrets, ['COLLECTIVE_DEPLOYER_PRIVATE_KEY']);
  assert.deepEqual(payload.deployment.requiredVariables, []);
  assert.ok(payload.deployment.optionalVariables.includes('COLLECTIVE_ASSET_ADDRESS'));
  assert.ok(payload.deployment.optionalVariables.includes('COLLECTIVE_GUARDIAN_ADDRESS'));
});

test('verified snapshot turns reads on with zero environment variables', () => {
  const config = readCollectiveConfig({}, verifiedSnapshot);
  assert.equal(config.configured, true);
  assert.equal(config.status, 'configured');
  assert.equal(config.rpcUrl, RPC);
  assert.equal(config.factoryAddress, FACTORY);
  assert.equal(config.deploymentBlock, 100);

  const publicConfig = publicCollectiveConfig(config);
  assert.equal(publicConfig.deployment.configured, true);
  assert.equal(publicConfig.operations.gasPayer, 'user-wallet');
  assert.equal(JSON.stringify(publicConfig).includes('rpc.example.test'), false, 'the RPC URL is server-side only');
});

test('an explicit disable and an unverified record both fail closed', () => {
  assert.equal(readSnapshotDeployment({ COLLECTIVE_READS_ENABLED: 'false' }, verifiedSnapshot), null);

  const unverified = { ...verifiedSnapshot, liveDeployment: { ...verifiedSnapshot.liveDeployment, verified: false } };
  assert.equal(readSnapshotDeployment({}, unverified), null);
  assert.equal(readCollectiveConfig({}, unverified).configured, false);

  const queued = { ...verifiedSnapshot, liveDeployment: { ...verifiedSnapshot.liveDeployment, status: 'queued' } };
  assert.equal(readSnapshotDeployment({}, queued), null);

  const wrongChain = { ...verifiedSnapshot, liveDeployment: { ...verifiedSnapshot.liveDeployment, chainId: 1 } };
  assert.equal(readSnapshotDeployment({}, wrongChain), null);

  const credentialed = { ...verifiedSnapshot, liveDeployment: { ...verifiedSnapshot.liveDeployment, rpcUrl: 'http://user:pass@rpc.example.test' } };
  assert.equal(readSnapshotDeployment({}, credentialed), null);
});

function githubFetch({ runs, jobsById = {}, failRuns = false, failJobs = false, counter = { calls: 0 } }) {
  return async (url) => {
    counter.calls += 1;
    if (url.includes('/runs?branch=main')) {
      if (failRuns) return { ok: false, status: 429, json: async () => ({}) };
      return { ok: true, status: 200, json: async () => ({ workflow_runs: runs }) };
    }
    if (url.includes('/jobs')) {
      if (failJobs) return { ok: false, status: 500, json: async () => ({}) };
      const id = Number(url.match(/runs\/(\d+)\/jobs/)?.[1]);
      return { ok: true, status: 200, json: async () => ({ jobs: jobsById[id] ?? [] }) };
    }
    throw new Error(`unexpected URL ${url}`);
  };
}

const run = {
  id: 9001,
  run_number: 12,
  status: 'completed',
  conclusion: 'success',
  event: 'push',
  head_sha: 'b'.repeat(40),
  html_url: 'https://github.com/mshiravi433-ctrl/fbtcryp/actions/runs/9001',
  created_at: '2026-10-19T09:00:00Z',
  updated_at: '2026-10-19T09:06:00Z'
};

const jobs = [{
  name: 'Keyless rehearsal (no secrets, no gas)',
  steps: [
    { number: 1, name: 'Set up job', status: 'completed', conclusion: 'success' },
    { number: 2, name: 'Compile Collective contracts (solc 0.8.24)', status: 'completed', conclusion: 'success' },
    { number: 3, name: 'Contract probe (Ganache, no funds)', status: 'completed', conclusion: 'success' },
    { number: 4, name: 'API + activation tests', status: 'completed', conclusion: 'success' },
    { number: 5, name: 'Full local rehearsal (deploy → timelock → activate → deposit)', status: 'completed', conclusion: 'success' },
    { number: 6, name: 'Publish evidence to main', status: 'completed', conclusion: 'success' }
  ]
}, {
  name: 'Live deployment (your wallet pays gas)',
  steps: [{ number: 1, name: 'Preflight', status: 'completed', conclusion: 'skipped' }]
}];

test('the public GitHub API is mapped to a passed pipeline with stable step ids', async () => {
  const status = createCollectiveActivationStatus({
    fetchImpl: githubFetch({ runs: [run], jobsById: { 9001: jobs } }),
    snapshot: ACTIVATION_SNAPSHOT,
    cacheMs: 0
  });
  const payload = await status.get({ config: disabledConfig });
  assert.equal(payload.pipeline.source, 'github-api');
  assert.equal(payload.pipeline.state, 'passed');
  assert.equal(payload.pipeline.runId, 9001);
  assert.equal(payload.pipeline.headShaShort, 'bbbbbbb');
  assert.equal(payload.pipeline.durationSeconds, 360);
  const ids = payload.pipeline.steps.map((row) => row.id);
  for (const expected of ['compile', 'contract', 'api', 'rehearsal']) assert.ok(ids.includes(expected), `missing ${expected}`);
  assert.equal(payload.pipeline.steps.every((row) => row.status === 'passed'), true);
  // The gas-paying live job must never be presented as part of the free run.
  assert.equal(payload.pipeline.steps.some((row) => row.name === 'Preflight'), false);
});

test('a rate-limited or broken GitHub API falls back to the committed snapshot', async () => {
  const fromSnapshot = createCollectiveActivationStatus({
    fetchImpl: githubFetch({ runs: [], failRuns: true }),
    snapshot: verifiedSnapshot,
    cacheMs: 0
  });
  const payload = await fromSnapshot.get({ config: disabledConfig });
  assert.equal(payload.pipeline.source, 'snapshot');
  assert.equal(payload.pipeline.state, 'passed');
  assert.equal(payload.pipeline.runId, 123);
  assert.equal(payload.pipeline.evidenceSource, 'github-actions');

  const jobsFailed = createCollectiveActivationStatus({
    fetchImpl: githubFetch({ runs: [run], failJobs: true }),
    snapshot: ACTIVATION_SNAPSHOT,
    cacheMs: 0
  });
  const partial = await jobsFailed.get({ config: disabledConfig });
  assert.equal(partial.pipeline.state, 'passed');
  assert.deepEqual(partial.pipeline.steps, []);
});

test('a missing workflow file is reported as not installed, not as a green run', async () => {
  const status = createCollectiveActivationStatus({
    fetchImpl: async () => ({ ok: false, status: 404, json: async () => ({ message: 'Not Found' }) }),
    snapshot: emptySnapshot,
    cacheMs: 0
  });
  const payload = await status.get({ config: disabledConfig });
  assert.equal(payload.pipeline.installed, false);
  assert.equal(payload.pipeline.state, 'never-run');
  assert.ok(payload.deployment.installUrl.includes('/new/main?filename=.github/workflows/collective-activation.yml'));
  assert.ok(payload.deployment.sourceUrl.endsWith('/blob/main/ci/collective-activation.yml'));
});

test('a local rehearsal snapshot is labelled as such', async () => {
  const local = {
    ...verifiedSnapshot,
    source: 'local-rehearsal',
    run: { ...verifiedSnapshot.run, id: null, url: null }
  };
  const status = createCollectiveActivationStatus({
    fetchImpl: async () => ({ ok: false, status: 503, json: async () => ({}) }),
    snapshot: local,
    cacheMs: 0
  });
  const payload = await status.get({ config: disabledConfig });
  assert.equal(payload.pipeline.source, 'snapshot');
  assert.equal(payload.pipeline.evidenceSource, 'local-rehearsal');
  assert.equal(payload.pipeline.url, null);
});

test('the run list is cached for the configured TTL', async () => {
  const counter = { calls: 0 };
  let clock = 1_000_000;
  const status = createCollectiveActivationStatus({
    fetchImpl: githubFetch({ runs: [run], jobsById: { 9001: jobs }, counter }),
    snapshot: ACTIVATION_SNAPSHOT,
    cacheMs: 60_000,
    now: () => clock
  });
  await status.get({ config: disabledConfig });
  const afterFirst = counter.calls;
  assert.ok(afterFirst >= 1);
  clock += 30_000;
  await status.get({ config: disabledConfig });
  assert.equal(counter.calls, afterFirst, 'a second call inside the TTL must not hit the network');
  clock += 120_000;
  await status.get({ config: disabledConfig });
  assert.ok(counter.calls > afterFirst, 'an expired cache must refresh');
});

test('GET /api/collective/activation answers with the public payload', async () => {
  const activation = {
    get: async () => buildCollectiveActivationPayload({
      config: disabledConfig,
      pipeline: null,
      snapshot: emptySnapshot,
      now: () => '2026-10-19T10:00:00.000Z'
    })
  };
  const app = express();
  app.use('/api/collective', createCollectiveRouter({ activation }));
  const server = createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/collective/activation`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store, max-age=0');
    const body = await response.json();
    assert.equal(body.schema, COLLECTIVE_ACTIVATION_SCHEMA);
    assert.equal(body.deployment.nextStep, 'run-deployment');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
