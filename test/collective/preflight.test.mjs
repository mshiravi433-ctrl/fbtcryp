import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { collectivePreflightGas, collectivePreflightGasBudget } from '../../scripts/lib/collectivePreflight.mjs';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const SCRIPT = path.join(ROOT, 'scripts/collective-preflight.mjs');

function run(args, env = {}) {
  return spawnSync(process.execPath, [SCRIPT, ...args], {
    cwd: ROOT,
    encoding: 'utf8',
    env: { ...process.env, ...env }
  });
}

test('preflight rejects an unknown chain before attempting any RPC call', () => {
  const result = run(['--network', 'not-a-robinhood-network']);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /UNSUPPORTED_CHAIN/);
});

test('preflight requires an explicit asset and public deployer address without reading a key', () => {
  const result = run(['--network', 'robinhood-testnet'], {
    COLLECTIVE_ASSET_ADDRESS: '',
    COLLECTIVE_DEPLOYER_ADDRESS: '0xEfFEe508B69B8705F0AA3187aD9d28f1B95D39E9'
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /COLLECTIVE_ASSET_ADDRESS is required/);
  const source = fs.readFileSync(SCRIPT, 'utf8');
  assert.equal(source.includes('COLLECTIVE_DEPLOYER_PRIVATE_KEY'), false, 'preflight must not read the private-key secret');
});

test('preflight gas budget is fee-aware, phase-specific, and includes a safety headroom', () => {
  const deployGas = collectivePreflightGas('testnet-preflight');
  assert.equal(deployGas.operation, 'deploy');
  assert.equal(deployGas.gasUnits, 23_658_989n);

  const deployBudget = collectivePreflightGasBudget('testnet-deploy', 420_000_000n); // 0.42 gwei
  const deployCost = deployGas.gasUnits * 420_000_000n;
  assert.equal(deployBudget.estimatedCostWei, deployCost);
  assert.equal(deployBudget.requiredBalanceWei, (deployCost * 11_000n + 9_999n) / 10_000n);
  assert.ok(deployBudget.requiredBalanceWei > 10n ** 16n, '0.01 ETH must not pass when the reference estimate plus headroom exceeds it');

  const activateBudget = collectivePreflightGasBudget('testnet-activate', 420_000_000n);
  assert.equal(activateBudget.operation, 'activate');
  assert.equal(activateBudget.gasUnits, 7_006_880n);
  assert.equal(collectivePreflightGas('testnet-check').gasUnits, 0n);
  assert.throws(() => collectivePreflightGas('testnet-unknown'), /unsupported preflight phase/);
});

test('preflight refuses credential-bearing or query-token RPC URLs before connecting', () => {
  const result = run(['--network', 'robinhood-testnet'], {
    COLLECTIVE_ASSET_ADDRESS: '0x1111111111111111111111111111111111111111',
    COLLECTIVE_DEPLOYER_ADDRESS: '0xEfFEe508B69B8705F0AA3187aD9d28f1B95D39E9',
    COLLECTIVE_RPC_URL: 'https://rpc.testnet.chain.robinhood.com?api_key=must-not-be-logged'
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /credential-free HTTPS endpoint/);
  assert.equal(result.stderr.includes('must-not-be-logged'), false);
});
