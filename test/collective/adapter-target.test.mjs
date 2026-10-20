#!/usr/bin/env node
/**
 * Regression test for the ethers v6 `Contract.target` name collision that
 * aborted the read-only testnet check with:
 *
 *   verification aborted: adapter.target is not a function
 *
 * ethers v6 exposes the contract's own address as the read-only `target`
 * property, so an ABI method named `target()` is shadowed and cannot be called
 * as `adapter.target()`. The activation check must reach the ABI method
 * explicitly via `adapter.getFunction('target')()`.
 *
 * The test deploys the real StrategyAdapter (whose Solidity `target` immutable
 * generates the `target() view returns (address)` getter listed in ADAPTER_ABI)
 * on a local Ganache chain. No public RPC, no live network, no transactions
 * beyond the in-memory test chain.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test, { after } from 'node:test';
import ganache from 'ganache';
import { BrowserProvider, Contract, ContractFactory } from 'ethers';
import { ADAPTER_ABI } from '../../server/collective/abi.js';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const OUT = path.join(ROOT, 'test/.out/collective');
const SCRIPT = path.join(ROOT, 'scripts/collective-activate.mjs');
const artifact = (name) => JSON.parse(fs.readFileSync(path.join(OUT, `${name}.json`), 'utf8'));

const rpc = ganache.provider({
  logging: { quiet: true },
  chain: { chainId: 4663 },
  wallet: { totalAccounts: 2, defaultBalance: 1_000 },
  miner: { blockGasLimit: 30_000_000 }
});
after(async () => rpc.disconnect());

const provider = new BrowserProvider(rpc);
const deployer = await provider.getSigner(0);
const placeholderVault = await provider.getSigner(1);

async function deploy(name, args = []) {
  const factory = new ContractFactory(artifact(name).abi, artifact(name).bytecode, deployer);
  const contract = await factory.deploy(...args);
  await contract.waitForDeployment();
  return contract;
}

async function deployAdapterWithTargetAbi() {
  const token = await deploy('MockUSDT');
  const strategy = await deploy('Mock4626Strategy', [await token.getAddress()]);
  const deployed = await deploy('StrategyAdapter', [
    await placeholderVault.getAddress(),
    await token.getAddress(),
    await strategy.getAddress()
  ]);
  // Rebuild the contract exactly the way scripts/collective-activate.mjs does:
  // production ADAPTER_ABI slice instead of the full compiled artifact ABI.
  const adapter = new Contract(await deployed.getAddress(), ADAPTER_ABI, provider);
  return { adapter, token, strategy };
}

test('ethers v6 reserves Contract.target for the contract address and shadows the ABI target() method', async () => {
  const { adapter } = await deployAdapterWithTargetAbi();
  const adapterAddress = await adapter.getAddress();

  assert.equal(typeof adapter.target, 'string', 'Contract.target is the address property, not a method');
  assert.equal(adapter.target, adapterAddress);
  assert.throws(
    () => adapter.target(),
    /is not a function/,
    'the pre-fix call shape must reproduce the production abort'
  );
});

test('the activation check reads the on-chain target via getFunction without an error', async () => {
  const { adapter, token, strategy } = await deployAdapterWithTargetAbi();
  const expectedTarget = await strategy.getAddress();

  const targetMethod = adapter.getFunction('target');
  assert.equal(typeof targetMethod, 'function');
  const adapterTarget = await targetMethod();
  assert.equal(adapterTarget.toLowerCase(), expectedTarget.toLowerCase());

  // The exact comparison shape used by the fixed --check record, including a
  // deployment-record style address to compare against.
  const lower = (value) => String(value).toLowerCase();
  const deploymentRecord = { address: expectedTarget };
  assert.equal(lower(await adapter.getFunction('target')()) === lower(deploymentRecord.address), true);

  // The non-colliding adapter views remain callable through the normal path.
  assert.equal((await adapter.asset()).toLowerCase(), (await token.getAddress()).toLowerCase());
});

test('collective-activate.mjs reaches the ABI target() explicitly instead of the reserved property', () => {
  const source = fs.readFileSync(SCRIPT, 'utf8');
  assert.match(source, /getFunction\('target'\)\(\)/, 'the script must call the ABI method via getFunction');
  assert.equal(
    source.includes('adapter.target('),
    false,
    'adapter.target() is the reserved-address collision and must never be called'
  );
});
