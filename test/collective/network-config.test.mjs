import assert from 'node:assert/strict';
import test from 'node:test';
import {
  COLLECTIVE_CHAINS,
  readCollectiveConfig,
  readSnapshotDeployment,
  publicCollectiveConfig
} from '../../server/collective/config.js';
import { buildCollectiveActivationPayload } from '../../server/collective/activation.js';
import { networkByName, networkByChainId } from '../../scripts/lib/collectiveDeployment.mjs';

const FACTORY = '0x1111111111111111111111111111111111111111';
const ASSET = '0x2222222222222222222222222222222222222222';
const TESTNET_RPC = 'https://rpc.testnet.chain.robinhood.com';

function testnetSnapshot(overrides = {}) {
  const record = {
    status: 'activated',
    chainId: 46630,
    testnet: true,
    verified: true,
    verifiedAt: '2026-10-19T12:00:00.000Z',
    factoryAddress: FACTORY,
    assetAddress: ASSET,
    deploymentBlock: 123,
    rpcUrl: TESTNET_RPC,
    timelockReadyAt: '2026-10-18T12:00:00.000Z',
    vaultAddress: '0x3333333333333333333333333333333333333333'
  };
  return {
    schema: 'fbt.collective.activation.snapshot.v1',
    defaultChainId: 46630,
    liveDeployments: { '46630': record },
    liveDeployment: record,
    ...overrides
  };
}

test('network registry explicitly supports only Robinhood mainnet 4663 and testnet 46630', () => {
  assert.deepEqual(Object.keys(COLLECTIVE_CHAINS).sort(), ['4663', '46630']);
  assert.equal(COLLECTIVE_CHAINS[4663].testnet, false);
  assert.equal(COLLECTIVE_CHAINS[46630].testnet, true);
  assert.equal(COLLECTIVE_CHAINS[46630].rpcUrl, TESTNET_RPC);
  assert.equal(COLLECTIVE_CHAINS[46630].explorer, 'https://explorer.testnet.chain.robinhood.com');
  assert.equal(networkByName('robinhood-testnet').chainId, 46630);
  assert.equal(networkByChainId(46630).testnet, true);
  assert.equal(networkByChainId(46631), null);
});

test('a verified testnet record selects its own chain automatically without environment overrides', () => {
  const snapshot = testnetSnapshot();
  const config = readCollectiveConfig({}, snapshot);
  assert.equal(config.chainId, 46630);
  assert.equal(config.testnet, true);
  assert.equal(config.chainName, 'Robinhood Chain Testnet');
  assert.equal(config.explorer, 'https://explorer.testnet.chain.robinhood.com');
  assert.equal(config.rpcUrl, TESTNET_RPC);
  assert.equal(config.configured, true);
  assert.equal(readSnapshotDeployment({}, snapshot).chainId, 46630);

  const publicConfig = publicCollectiveConfig(config);
  assert.equal(publicConfig.chain.id, 46630);
  assert.equal(publicConfig.chain.testnet, true);
  assert.equal(publicConfig.chain.supported, true);
});

test('an explicit chain ID always wins and a testnet snapshot can never configure mainnet', () => {
  const snapshot = testnetSnapshot();
  const config = readCollectiveConfig({ COLLECTIVE_CHAIN_ID: '4663' }, snapshot);
  assert.equal(config.chainId, 4663);
  assert.equal(config.testnet, false);
  assert.equal(config.rpcUrl, COLLECTIVE_CHAINS[4663].rpcUrl);
  assert.equal(config.factoryAddress, null);
  assert.equal(config.assetAddress, null);
  assert.equal(config.configured, false);
  assert.equal(readSnapshotDeployment({ COLLECTIVE_CHAIN_ID: '4663' }, snapshot), null);

  const payload = buildCollectiveActivationPayload({ config, snapshot, now: () => '2026-10-19T13:00:00.000Z' });
  assert.equal(payload.chain.id, 4663);
  assert.equal(payload.chain.testnet, false);
  assert.equal(payload.deployment.liveDeployment, null);
});

test('unknown chain IDs fail closed instead of falling back to either Robinhood network', () => {
  const snapshot = testnetSnapshot();
  const config = readCollectiveConfig({ COLLECTIVE_CHAIN_ID: '46631', COLLECTIVE_READS_ENABLED: 'true' }, snapshot);
  assert.equal(config.chainId, 46631);
  assert.equal(config.configured, false);
  assert.ok(config.issues.includes('UNSUPPORTED_CHAIN'));
  assert.equal(publicCollectiveConfig(config).chain.supported, false);

  const invalid = readCollectiveConfig({ COLLECTIVE_CHAIN_ID: 'not-a-chain' }, snapshot);
  assert.equal(invalid.chainId, null);
  assert.ok(invalid.issues.includes('UNSUPPORTED_CHAIN'));

  const unknownPayload = buildCollectiveActivationPayload({
    config: invalid,
    snapshot,
    now: () => '2026-10-19T13:00:00.000Z'
  });
  assert.equal(unknownPayload.chain.supported, false);
  assert.equal(unknownPayload.deployment.command, null, 'unknown chains must never suggest a mainnet workflow command');
});

test('activation payload carries the selected testnet chain and testnet-specific next phase', () => {
  const snapshot = testnetSnapshot({
    liveDeployments: {
      '46630': {
        ...testnetSnapshot().liveDeployment,
        status: 'queued',
        verified: false,
        vaultAddress: null
      }
    },
    liveDeployment: {
      ...testnetSnapshot().liveDeployment,
      status: 'queued',
      verified: false,
      vaultAddress: null
    }
  });
  const config = readCollectiveConfig({ COLLECTIVE_CHAIN_ID: '46630', COLLECTIVE_READS_ENABLED: 'false' }, snapshot);
  const payload = buildCollectiveActivationPayload({ config, snapshot, now: () => '2026-10-19T13:00:00.000Z' });
  assert.equal(payload.chain.id, 46630);
  assert.equal(payload.chain.testnet, true);
  assert.equal(payload.deployment.liveDeployment.chainId, 46630);
  assert.equal(payload.deployment.liveDeployment.testnet, true);
  assert.match(payload.deployment.command, /phase=testnet-activate/);
});
