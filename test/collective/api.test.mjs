import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createServer } from 'node:http';
import test from 'node:test';
import express from 'express';
import { Interface } from 'ethers';
import { buildCollectiveProposals, isAllowedKeeperAction } from '../../server/collective/strategyPolicy.js';
import { readCollectiveConfig, publicCollectiveConfig } from '../../server/collective/config.js';
import { createCollectiveReader } from '../../server/collective/reader.js';
import { createCollectiveRouter } from '../../server/collective/routes.js';
import { VAULT_ABI, VAULT_EVENT_ABI, QUEUE_EVENT_ABI } from '../../server/collective/abi.js';
import { scanVaultEvents } from '../../server/collective/indexer.js';
import { DEFAULT_LIMITS, deploymentEnv, publicDeploymentRecord } from '../../scripts/lib/collectiveDeployment.mjs';

const VAULT = '0x1111111111111111111111111111111111111111';
const QUEUE = '0x2222222222222222222222222222222222222222';
const ASSET = '0x3333333333333333333333333333333333333333';
const TARGET = '0x4444444444444444444444444444444444444444';
const WALLET = '0x5555555555555555555555555555555555555555';

function activeSnapshot(overrides = {}) {
  return {
    address: VAULT,
    latestBlock: 123,
    observedAt: 1_800_000_000,
    asset: { address: ASSET, symbol: 'USDT', decimals: 6 },
    accounting: {
      totalAssetsRaw: '100000000',
      totalSupplyRaw: '100000000',
      availablePrincipalIdleRaw: '70000000',
      queuedPayoutAvailableRaw: '0',
      withdrawalLiabilityRaw: '0'
    },
    strategy: { target: TARGET, protocol: TARGET, totalAssetsRaw: '0', principalBasisRaw: '0', maxWithdrawRaw: '0' },
    epoch: { number: 2, started: true, start: 1_799_000_000, end: 1_802_000_000, subscriptionDeadline: 0 },
    risk: {
      kindEnabled: true,
      assetAllowed: true,
      protocolAllowed: true,
      assetOracleFresh: true,
      nativeOracleFresh: true,
      assetPriceUsdE8: '100000000',
      limits: { enabled: true, maxTradeUsdE8: '1000000000000', minLiquidityUsdE8: '1000000', maxAllocationBps: 2500, maxConcentrationBps: 10000, maxOracleAgeSeconds: 3600 }
    },
    emergency: { paused: false },
    ...overrides
  };
}

test('Collective read configuration fails closed and never publishes RPC credentials or keeper secrets', async () => {
  const config = readCollectiveConfig({ COLLECTIVE_READS_ENABLED: 'false', COLLECTIVE_CHAIN_ID: '4663' });
  assert.equal(config.configured, false);
  assert.equal(config.issues.includes('READS_DISABLED'), true);
  const publicConfig = publicCollectiveConfig(config);
  assert.equal(publicConfig.chain.id, 4663);
  assert.equal(publicConfig.modules.farmingLiquidity.enabled, false);
  assert.equal(publicConfig.modules.approvedTokenTrading.enabled, false);
  assert.equal('rpcUrl' in publicConfig, false);
  assert.equal(JSON.stringify(publicConfig).includes('PRIVATE_KEY'), false);

  const reader = createCollectiveReader({ config });
  const status = await reader.status();
  assert.equal(status.ready, false);
  assert.equal(status.reason, 'READS_DISABLED');

  const common = {
    COLLECTIVE_READS_ENABLED: 'true', COLLECTIVE_CHAIN_ID: '4663',
    COLLECTIVE_FACTORY_ADDRESS: VAULT, COLLECTIVE_ASSET_ADDRESS: ASSET,
    COLLECTIVE_DEPLOYMENT_BLOCK: '1'
  };
  const remoteHttp = readCollectiveConfig({ ...common, NODE_ENV: 'production', COLLECTIVE_RPC_URL: 'http://rpc.example' });
  assert.equal(remoteHttp.configured, false);
  assert.equal(remoteHttp.issues.includes('RPC_MUST_USE_HTTPS'), true);
  const localHttp = readCollectiveConfig({ ...common, NODE_ENV: 'test', COLLECTIVE_RPC_URL: 'http://127.0.0.1:8545' });
  assert.equal(localHttp.configured, true);
  const invalidUrl = readCollectiveConfig({ ...common, COLLECTIVE_RPC_URL: 'not a URL' });
  assert.equal(invalidUrl.issues.includes('RPC_URL_INVALID'), true);
  const credentialedUrl = readCollectiveConfig({ ...common, COLLECTIVE_RPC_URL: 'https://user:secret@rpc.example' });
  assert.equal(credentialedUrl.issues.includes('RPC_URL_CREDENTIALS_NOT_ALLOWED'), true);

  for (const locale of ['en', 'fa']) {
    const translations = JSON.parse(fs.readFileSync(`src/i18n/locales/${locale}.json`, 'utf8'));
    for (const code of ['RPC_URL_INVALID', 'RPC_MUST_USE_HTTPS', 'RPC_URL_CREDENTIALS_NOT_ALLOWED']) {
      assert.equal(typeof translations.collective.reason[code], 'string', `${locale} translation missing for ${code}`);
    }
  }
});

test('read ABI covers every historical-balance call the reader makes for income claims', () => {
  const reader = fs.readFileSync('server/collective/reader.js', 'utf8');
  const abi = VAULT_ABI.join('\n');
  for (const method of ['getPastBalance', 'incomeDistribution', 'nextIncomeEpoch', 'fractionalIncomeRemainder']) {
    assert.ok(reader.includes(`vault.${method}(`), `reader no longer calls ${method}`);
    assert.ok(abi.includes(`function ${method}(`), `VAULT_ABI is missing ${method}`);
  }
  assert.ok(abi.includes('function getPastTotalSupply('), 'VAULT_ABI is missing getPastTotalSupply');
});

test('public configuration states the user-paid gas policy and exposes no sponsor path', () => {
  const config = readCollectiveConfig({
    COLLECTIVE_READS_ENABLED: 'true', COLLECTIVE_CHAIN_ID: '4663',
    COLLECTIVE_RPC_URL: 'https://rpc.example', COLLECTIVE_FACTORY_ADDRESS: VAULT,
    COLLECTIVE_ASSET_ADDRESS: ASSET, COLLECTIVE_DEPLOYMENT_BLOCK: '1'
  });
  const publicConfig = publicCollectiveConfig(config);
  assert.equal(publicConfig.operations.gasPayer, 'user-wallet');
  assert.equal(publicConfig.operations.userPaysGas, true);
  assert.equal(publicConfig.operations.gasSponsorshipEnabled, false);
  assert.equal(publicConfig.operations.relayerEnabled, false);
  assert.equal(publicConfig.operations.serverSigning, false);
  assert.equal(publicConfig.operations.privateKeysStoredByApi, false);
  assert.equal(publicConfig.operations.aiCanSign, false);
  assert.ok(publicConfig.disclosures.some((line) => line.includes('connected user wallet')));
  const serialized = JSON.stringify(publicConfig);
  for (const secret of ['PRIVATE_KEY', 'rpc.example', 'paymaster', 'sponsorKey']) {
    assert.equal(serialized.includes(secret), false, `public config leaked ${secret}`);
  }

  const record = publicDeploymentRecord({
    schema: 'fbt.collective.deployment.v1',
    vault: { address: VAULT }, asset: { address: ASSET },
    contracts: { factory: VAULT }, gas: { policy: 'user-wallet-only' },
    deployerKey: '0xshould-never-appear'
  });
  assert.equal('deployerKey' in record, false);
  const env = deploymentEnv(record, { rpcUrl: 'https://rpc.example' });
  assert.ok(env.includes('COLLECTIVE_FACTORY_ADDRESS=' + VAULT));
  assert.ok(env.includes('COLLECTIVE_KEEPER_ENABLED=false'));
  assert.equal(env.includes('PRIVATE_KEY'), false);
  assert.equal(env.includes('rpc.example'), true);
  assert.ok(env.includes('user wallet'));
  assert.ok(BigInt(DEFAULT_LIMITS.maxTradeUsdE8) > 0n);
  assert.ok(BigInt(DEFAULT_LIMITS.minLiquidityUsdE8) > 0n);
  assert.ok(Number(DEFAULT_LIMITS.maxAllocationBps) <= 10_000);
  assert.ok(Number(DEFAULT_LIMITS.maxOracleAgeSeconds) <= 86_400);
});

test('dashboard integration is additive, same-origin, and available in every shipped locale', () => {
  const app = fs.readFileSync('src/App.jsx', 'utf8');
  const menu = fs.readFileSync('src/components/MoreSheet.jsx', 'utf8');
  const client = fs.readFileSync('src/lib/collective/api.js', 'utf8');
  const page = fs.readFileSync('src/pages/Collective.jsx', 'utf8');
  assert.ok(app.includes('path="/vault" element={<Vault />}'));
  assert.ok(app.includes('path="/collective" element={<Collective />}'));
  assert.ok(menu.includes("to: '/collective', key: 'nav.collective'"));
  assert.ok(client.includes("const ROOT = '/api/collective'"));
  assert.ok(page.includes('collective.notConfigured'));
  assert.equal(client.includes('http://localhost'), false);
  assert.equal(client.includes('127.0.0.1'), false);

  const localeDir = 'src/i18n/locales';
  const locales = fs.readdirSync(localeDir).filter((file) => file.endsWith('.json'));
  assert.ok(locales.length > 0);
  for (const file of locales) {
    const locale = JSON.parse(fs.readFileSync(path.join(localeDir, file), 'utf8'));
    assert.ok(locale.nav?.collective, `${file} is missing nav.collective`);
  }
});

test('policy planner proposes only bounded fixed actions and fails closed for stale policy data', () => {
  const plan = buildCollectiveProposals(activeSnapshot(), { nowSeconds: 1_800_500_000 });
  assert.equal(plan.status, 'action-ready');
  assert.equal(plan.proposals.length, 1);
  assert.equal(plan.proposals[0].action, 'invest');
  assert.equal(plan.proposals[0].args[0], '25000000'); // 25% of NAV, below idle balance
  const allocationBound = buildCollectiveProposals(activeSnapshot({
    strategy: { ...activeSnapshot().strategy, totalAssetsRaw: '20000000' }
  }), { nowSeconds: 1_800_500_000 });
  assert.equal(allocationBound.proposals[0].args[0], '5000000'); // remaining room to target allocation, not a per-call cap
  assert.equal(plan.proposals[0].transaction.to, VAULT);
  assert.equal(plan.proposals[0].aiCanSign, false);
  assert.equal(plan.proposals[0].onChainRiskChecksRemainAuthoritative, true);
  assert.equal(isAllowedKeeperAction('invest'), true);
  assert.equal(isAllowedKeeperAction('withdrawFromStrategy'), true);
  assert.equal(isAllowedKeeperAction('executeSwap'), false);
  assert.equal(isAllowedKeeperAction('arbitraryCall'), false);

  const stale = buildCollectiveProposals(activeSnapshot({
    risk: { ...activeSnapshot().risk, assetOracleFresh: false }
  }), { nowSeconds: 1_800_500_000 });
  assert.equal(stale.status, 'risk-blocked');
  assert.equal(stale.proposals.length, 0);

  const lowLiquidity = buildCollectiveProposals(activeSnapshot({
    risk: { ...activeSnapshot().risk, limits: { ...activeSnapshot().risk.limits, minLiquidityUsdE8: '10000000000' } }
  }), { nowSeconds: 1_800_500_000 });
  assert.equal(lowLiquidity.status, 'risk-blocked');
  assert.equal(lowLiquidity.reason, 'TARGET_LIQUIDITY_BELOW_POLICY_MINIMUM');

  const ended = buildCollectiveProposals(activeSnapshot({
    epoch: { number: 2, started: true, start: 1, end: 10, subscriptionDeadline: 0 },
    strategy: { target: TARGET, protocol: TARGET, totalAssetsRaw: '50000000', positionSharesRaw: '50000000', maxWithdrawRaw: '50000000', principalBasisRaw: '40000000' }
  }), { nowSeconds: 20 });
  assert.equal(ended.proposals[0].action, 'withdrawFromStrategy');
  assert.equal(ended.proposals[0].args[0], '50000000');
  const lockedStrategy = buildCollectiveProposals(activeSnapshot({
    epoch: { number: 2, started: true, start: 1, end: 10, subscriptionDeadline: 0 },
    strategy: { target: TARGET, protocol: TARGET, totalAssetsRaw: '50000000', positionSharesRaw: '50000000', maxWithdrawRaw: '0' }
  }), { nowSeconds: 20 });
  assert.equal(lockedStrategy.status, 'liquidity-blocked');
  assert.equal(lockedStrategy.reason, 'TARGET_REPORTS_NO_WITHDRAWABLE_LIQUIDITY');

  const blocked = buildCollectiveProposals(activeSnapshot({ emergency: { paused: true } }), { nowSeconds: 1_800_500_000 });
  assert.equal(blocked.status, 'paused');
  assert.equal(blocked.proposals.length, 0);
});

test('bounded event indexer decodes immutable receipts, filters wallets, and rejects oversized scans', async () => {
  const vaultIface = new Interface(VAULT_EVENT_ABI);
  const queueIface = new Interface(QUEUE_EVENT_ABI);
  const income = vaultIface.encodeEventLog(vaultIface.getEvent('IncomeClaimed'), [WALLET, 12n, 3n, 0n]);
  const paid = queueIface.encodeEventLog(queueIface.getEvent('WithdrawalPaid'), [1n, WALLET, 5n, 0n]);
  const provider = {
    async getLogs({ address }) {
      if (address.toLowerCase() === VAULT.toLowerCase()) return [{
        address: VAULT, topics: income.topics, data: income.data, blockNumber: 8,
        transactionIndex: 0, index: 2, transactionHash: `0x${'a'.repeat(64)}`
      }];
      return [{
        address: QUEUE, topics: paid.topics, data: paid.data, blockNumber: 9,
        transactionIndex: 0, index: 1, transactionHash: `0x${'b'.repeat(64)}`
      }];
    }
  };
  const result = await scanVaultEvents(provider, {
    vaultAddress: VAULT, queueAddress: QUEUE, fromBlock: 1, toBlock: 10,
    walletAddress: WALLET, maxSpan: 10
  });
  assert.deepEqual(result.events.map((event) => event.event), ['IncomeClaimed', 'WithdrawalPaid']);
  assert.equal(result.events[0].args.account.toLowerCase(), WALLET.toLowerCase());
  assert.equal(result.nextFromBlock, 11);
  await assert.rejects(() => scanVaultEvents(provider, {
    vaultAddress: VAULT, queueAddress: QUEUE, fromBlock: 1, toBlock: 11, maxSpan: 10
  }), /BLOCK_RANGE_TOO_LARGE/);
});

test('Collective HTTP router exposes only read paths with no-store responses', async (t) => {
  const reader = {
    status: async () => ({ ready: false, reason: 'COLLECTIVE_NOT_CONFIGURED' }),
    listVaults: async () => [],
    getVault: async (address) => ({ address }),
    getPosition: async (vault, wallet) => ({ vault, wallet }),
    getEvents: async () => ({ events: [], count: 0 }),
    getProposals: async () => ({ proposals: [] })
  };
  const app = express();
  app.use('/api/collective', createCollectiveRouter({ reader }));
  const server = createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const url = `http://127.0.0.1:${server.address().port}`;

  const statusResponse = await fetch(`${url}/api/collective/status`);
  assert.equal(statusResponse.status, 200);
  assert.match(statusResponse.headers.get('cache-control'), /no-store/);
  assert.deepEqual(await statusResponse.json(), { ready: false, reason: 'COLLECTIVE_NOT_CONFIGURED' });

  const vaultResponse = await fetch(`${url}/api/collective/vaults`);
  assert.equal(vaultResponse.status, 200);
  assert.deepEqual(await vaultResponse.json(), { schema: 'fbt.collective.vault-list.v1', count: 0, vaults: [] });

  const writeResponse = await fetch(`${url}/api/collective/execute`, { method: 'POST' });
  assert.equal(writeResponse.status, 404);
});
