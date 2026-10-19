#!/usr/bin/env node
/**
 * Focused regression test for the two contracts added to make Collective
 * activation possible without inventing addresses:
 *   - DeclaredPriceOracle / DisabledLiquidityOracle
 *   - NoYield4626Strategy
 *
 * It runs on a local Ganache chain with no public network access and asserts
 * the exact properties the activation documentation promises: fixed declared
 * prices, a fail-closed liquidity oracle, a 1:1 no-yield target, and no admin
 * surface that could change any of that after deployment.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import ganache from 'ganache';
import { BrowserProvider, Contract, ContractFactory } from 'ethers';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const OUT = path.join(ROOT, 'test/.out/collective');
const artifact = (name) => JSON.parse(fs.readFileSync(path.join(OUT, `${name}.json`), 'utf8'));

const rpc = ganache.provider({
  logging: { quiet: true },
  chain: { chainId: 4663 },
  wallet: { totalAccounts: 3, defaultBalance: 1_000 },
  miner: { blockGasLimit: 30_000_000 }
});
const provider = new BrowserProvider(rpc);
const signer = await provider.getSigner(0);
const user = await provider.getSigner(1);

async function deploy(name, args = [], from = signer) {
  const factory = new ContractFactory(artifact(name).abi, artifact(name).bytecode, from);
  const contract = await factory.deploy(...args);
  await contract.waitForDeployment();
  return contract;
}

test('declared oracle reports only its fixed peg and never invents another token price', async () => {
  const asset = await deploy('MockUSDT');
  const assetAddress = await asset.getAddress();
  const oracle = await deploy('DeclaredPriceOracle', [assetAddress, 100_000_000n, 300_000_000_000n]);
  const [assetPrice, assetUpdatedAt] = await oracle.tokenPriceUsdE8(assetAddress);
  assert.equal(assetPrice, 100_000_000n, 'declared asset price must be exactly $1.00');
  const latest = await provider.getBlock('latest');
  assert.equal(Number(assetUpdatedAt), Number(latest.timestamp), 'declared observation is the current block time');
  const [nativePrice, nativeUpdatedAt] = await oracle.nativePriceUsdE8();
  assert.equal(nativePrice, 300_000_000_000n);
  assert.ok(Number(nativeUpdatedAt) > 0);
  const [unknownPrice, unknownUpdatedAt] = await oracle.tokenPriceUsdE8('0x1111111111111111111111111111111111111111');
  assert.equal(unknownPrice, 0n, 'unknown tokens must not inherit the peg');
  assert.equal(Number(unknownUpdatedAt), 0);

  const functions = artifact('DeclaredPriceOracle').abi.filter((entry) => entry.type === 'function').map((entry) => entry.name).sort();
  assert.deepEqual(functions, ['asset', 'declaredAssetPriceUsdE8', 'declaredNativePriceUsdE8', 'nativePriceUsdE8', 'tokenPriceUsdE8'],
    'the oracle must expose no setter or admin function');
  assert.equal(artifact('DeclaredPriceOracle').bytecode.length > 2, true);
});

test('declared oracle rejects invalid construction instead of deploying a zero price', async () => {
  const asset = await deploy('MockUSDT');
  const assetAddress = await asset.getAddress();
  await assert.rejects(
    () => deploy('DeclaredPriceOracle', [assetAddress, 0n, 300_000_000_000n]),
    /InvalidConfiguration|revert/
  );
});

test('disabled liquidity oracle returns zero and a fresh timestamp for every pair', async () => {
  const oracle = await deploy('DisabledLiquidityOracle');
  const [liquidity, updatedAt] = await oracle.pairLiquidityUsdE8(
    '0x1111111111111111111111111111111111111111',
    '0x2222222222222222222222222222222222222222',
    '0x3333333333333333333333333333333333333333'
  );
  assert.equal(liquidity, 0n);
  assert.ok(Number(updatedAt) > 0);
});

test('no-yield target is a plain 1:1 ERC-4626 with no admin and no yield', async () => {
  const asset = await deploy('MockUSDT');
  const assetAddress = await asset.getAddress();
  const target = await deploy('NoYield4626Strategy', [assetAddress]);
  const targetAddress = await target.getAddress();
  const userAddress = await user.getAddress();
  await (await asset.mint(userAddress, 1_000_000n)).wait();
  const userAsset = asset.connect(user);
  const userTarget = target.connect(user);
  await (await userAsset.approve(targetAddress, 1_000_000n)).wait();
  await (await userTarget.deposit(250_000n, userAddress)).wait();
  assert.equal(await target.balanceOf(userAddress), 250_000n, 'shares are minted 1:1');
  assert.equal(await target.totalAssets(), 250_000n);
  assert.equal(await target.previewRedeem(250_000n), 250_000n);

  await provider.send('evm_increaseTime', [365 * 86_400]);
  await provider.send('evm_mine', []);
  assert.equal(await target.totalAssets(), 250_000n, 'time alone cannot create yield');
  assert.equal(await target.previewRedeem(250_000n), 250_000n);

  const names = artifact('NoYield4626Strategy').abi.filter((entry) => entry.type === 'function').map((entry) => entry.name);
  for (const forbidden of ['setFee', 'setTarget', 'setStrategy', 'rescue', 'sweep', 'owner', 'upgradeTo']) {
    assert.equal(names.includes(forbidden), false, `idle target must not expose ${forbidden}`);
  }
  for (const required of ['deposit', 'mint', 'withdraw', 'redeem', 'totalAssets', 'previewRedeem']) {
    assert.ok(names.includes(required), `idle target must expose ${required}`);
  }
});
