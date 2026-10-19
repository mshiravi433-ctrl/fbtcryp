import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SCRIPT = path.join(ROOT, 'scripts/collective-evidence.mjs');
const MAINNET = {
  status: 'activated',
  chainId: 4663,
  testnet: false,
  verified: true,
  verifiedAt: '2026-10-18T12:00:00.000Z',
  factoryAddress: '0x1111111111111111111111111111111111111111',
  assetAddress: '0x2222222222222222222222222222222222222222',
  deploymentBlock: 100,
  rpcUrl: 'https://rpc.mainnet.chain.robinhood.com',
  timelockReadyAt: '2026-10-17T12:00:00.000Z',
  vaultAddress: '0x3333333333333333333333333333333333333333'
};

test('testnet evidence updates only chain 46630 and preserves the mainnet witness', (t) => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'collective-evidence-network-'));
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }));

  const deploymentFile = path.join(temp, 'testnet-record.json');
  const snapshotFile = path.join(temp, 'activation.snapshot.js');
  const publicFile = path.join(temp, 'activation.json');
  const rehearsalFile = path.join(temp, 'no-rehearsal.json');
  const testnetRecord = {
    schema: 'fbt.collective.deployment.v1',
    chainId: 46630,
    network: 'robinhood-testnet',
    testnet: true,
    phase: 'active',
    verified: true,
    verifiedAt: '2026-10-19T12:00:00.000Z',
    contracts: { factory: '0x4444444444444444444444444444444444444444' },
    asset: { address: '0x5555555555555555555555555555555555555555' },
    factoryDeploymentBlock: 456,
    timelockReadyAt: '2026-10-18T12:00:00.000Z',
    vault: { address: '0x6666666666666666666666666666666666666666' }
  };
  const seed = {
    schema: 'fbt.collective.activation.snapshot.v1',
    defaultChainId: 4663,
    liveDeployments: { '4663': MAINNET },
    liveDeployment: MAINNET
  };
  fs.writeFileSync(deploymentFile, `${JSON.stringify(testnetRecord, null, 2)}\n`);
  fs.writeFileSync(publicFile, `${JSON.stringify(seed, null, 2)}\n`);

  const commonArgs = [
    '--deployment', deploymentFile,
    '--chain', '46630',
    '--snapshot', snapshotFile,
    '--public', publicFile,
    '--rehearsal', rehearsalFile
  ];
  const write = spawnSync(process.execPath, [SCRIPT, ...commonArgs, '--write', '--contract-ok', '--api-ok'], {
    cwd: ROOT,
    encoding: 'utf8',
    env: { ...process.env, COLLECTIVE_VERIFIED: 'true' }
  });
  assert.equal(write.status, 0, write.stderr || write.stdout);

  const snapshot = JSON.parse(fs.readFileSync(publicFile, 'utf8'));
  assert.equal(snapshot.defaultChainId, 46630);
  assert.deepEqual(snapshot.liveDeployments['4663'], MAINNET);
  assert.equal(snapshot.liveDeployments['46630'].chainId, 46630);
  assert.equal(snapshot.liveDeployments['46630'].testnet, true);
  assert.equal(snapshot.liveDeployments['46630'].verified, true);
  assert.equal(snapshot.liveDeployment.chainId, 46630);
  assert.equal(snapshot.liveDeployment.testnet, true);
  assert.equal(snapshot.liveDeployment.factoryAddress, testnetRecord.contracts.factory);
  assert.equal(snapshot.liveDeployment.assetAddress, testnetRecord.asset.address);

  const check = spawnSync(process.execPath, [SCRIPT, ...commonArgs, '--check'], {
    cwd: ROOT,
    encoding: 'utf8',
    env: { ...process.env, COLLECTIVE_VERIFIED: 'true' }
  });
  assert.equal(check.status, 0, check.stderr || check.stdout);
  assert.match(check.stdout, /chain-bound/);
});

test('an explicit missing deployment record cannot produce ambiguous activation evidence', (t) => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'collective-evidence-missing-'));
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
  const deploymentFile = path.join(temp, 'missing-record.json');
  const snapshotFile = path.join(temp, 'activation.snapshot.js');
  const publicFile = path.join(temp, 'activation.json');
  const result = spawnSync(process.execPath, [
    SCRIPT,
    '--deployment', deploymentFile,
    '--snapshot', snapshotFile,
    '--public', publicFile,
    '--write'
  ], {
    cwd: ROOT,
    encoding: 'utf8',
    env: { ...process.env, COLLECTIVE_CHAIN_ID: '', COLLECTIVE_EVIDENCE_CHAIN_ID: '' }
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /cannot infer a chain/);
  assert.equal(fs.existsSync(publicFile), false);
});
