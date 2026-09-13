#!/usr/bin/env node
/**
 * Deploy FBTTokenFactory to one EVM chain (or all launch chains) and/or
 * verify an existing deployment. The factory holds no user funds — tokens
 * mint straight to the creator — so the deployer wallet only needs gas.
 *
 * ONE CHAIN:
 *   node scripts/compile-launch.mjs          # first (once)
 *   DEPLOYER_PRIVATE_KEY=0x… CHAIN_ID=56 RPC_URL=https://… \
 *     node scripts/deploy-launch-factory.mjs
 *
 * ALL FIVE LAUNCH CHAINS (uses built-in public RPCs, overridable per chain):
 *   DEPLOYER_PRIVATE_KEY=0x… node scripts/deploy-launch-factory.mjs all
 *   # prints a ready-to-paste FBTLAUNCH_FACTORY_<id> block at the end
 *
 * VERIFY ONLY (no key needed):
 *   RPC_URL=https://… CHAIN_ID=56 \
 *     node scripts/deploy-launch-factory.mjs verify 0xFactoryAddress
 *
 * SECURITY: DEPLOYER_PRIVATE_KEY is env-only — never written to disk, never
 * printed, never committed. Use a THROWAWAY wallet holding only gas. The
 * printed addresses are PUBLIC data; paste them into .env as
 * FBTLAUNCH_FACTORY_<CHAIN_ID> and restart.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ContractFactory, Contract, JsonRpcProvider, Wallet, getAddress } from 'ethers';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');

const fail = (msg) => {
  console.error(`\n✗ ${msg}\n`);
  process.exit(1);
};

const artifactPath = path.join(root, 'src/lib/launch/artifacts.json');
if (!fs.existsSync(artifactPath)) fail('Artifact missing. Run: node scripts/compile-launch.mjs');
const artifact = JSON.parse(fs.readFileSync(artifactPath, 'utf8'));
if (!String(artifact.compiler || '').includes('0.8.24')) {
  fail('Artifact was not compiled with solc 0.8.24. Re-run scripts/compile-launch.mjs.');
}
const factory = artifact.contracts.FBTTokenFactory;

/*
 * Default public HTTPS RPCs for the five phase-one launch chains. Any of
 * them can be overridden with RPC_URL_<CHAIN_ID> (or RPC_URL for a single
 * chain). These are READ-and-TRANSMIT endpoints for the deployer only; the
 * app itself never calls them from this file.
 */
const CHAIN_RPC = {
  8453: 'https://mainnet.base.org',
  56: 'https://data-seed.publicbsc.com',
  42161: 'https://arb1.arbitrum.io/rpc',
  137: 'https://polygon-rpc.com',
  1: 'https://eth.llamarpc.com'
};
const CHAIN_NAME = { 8453: 'Base', 56: 'BNB Chain', 42161: 'Arbitrum', 137: 'Polygon', 1: 'Ethereum' };
const ALL_CHAINS = [8453, 56, 42161, 137, 1];

function rpcFor(chainId) {
  const envKey = `RPC_URL_${chainId}`;
  const rpc = process.env[envKey] || (Number(process.env.CHAIN_ID) === chainId ? process.env.RPC_URL : null) || CHAIN_RPC[chainId];
  if (!rpc) fail(`No RPC for chain ${chainId}. Set RPC_URL_${chainId} (or RPC_URL with CHAIN_ID=${chainId}).`);
  if (!/^https:\/\//.test(rpc)) fail(`RPC for chain ${chainId} must be https.`);
  return rpc;
}

/**
 * Verify a deployment: exact runtime bytecode match plus a live interface
 * probe (createdCount() static call — the factory is stateless and holds no
 * owner). That is what makes it safe to configure the address in
 * FBTLAUNCH_FACTORY_<chainId>.
 */
async function verifyDeployment(chainId, address, provider) {
  const checksummed = getAddress(address);
  const onChain = await provider.getCode(checksummed);
  if (!onChain || onChain === '0x') fail(`No code at ${checksummed} on chain ${chainId}.`);
  if (onChain.toLowerCase() !== String(factory.deployedBytecode).toLowerCase()) {
    fail(`Deployed bytecode does NOT match the compiled FBTTokenFactory artifact (chain ${chainId}). Do not configure this address.`);
  }
  const contract = new Contract(checksummed, factory.abi, provider);
  try {
    const n = await contract.createdCount.staticCall();
    if (typeof n !== 'bigint') fail('createdCount() did not return a number — interface mismatch.');
  } catch {
    fail('createdCount() static call failed — interface mismatch. Do not configure this address.');
  }
  console.log(`  ✓ bytecode + interface verified on ${CHAIN_NAME[chainId]}: ${checksummed}`);
  return checksummed;
}

async function deployTo(chainId, wallet) {
  console.log(`\n══ ${CHAIN_NAME[chainId]} (chain ${chainId}) ══`);
  const rpc = rpcFor(chainId);
  const provider = new JsonRpcProvider(rpc, chainId, { staticNetwork: true });
  const chain = await provider.getNetwork();
  if (Number(chain.chainId) !== chainId) fail(`RPC answered with chain ${chain.chainId}, expected ${chainId} — check RPC_URL_${chainId}.`);
  const bal = await provider.getBalance(wallet.address);
  console.log(`  rpc ok · deployer ${wallet.address} · balance ${Number(bal) / 1e18} native`);

  const cf = new ContractFactory(factory.abi, factory.bytecode, wallet);
  console.log('  deploying FBTTokenFactory…');
  const contract = await cf.deploy();
  await contract.deployTransaction.wait();
  const address = contract.target;
  console.log(`  ✓ deployed at ${address}`);
  console.log(`  tx: ${contract.deployTransaction.hash}`);
  await verifyDeployment(chainId, address, provider);
  return address;
}

const mode = process.argv[2] || 'deploy';
const target = process.argv[3] || '';

if (mode === 'verify') {
  const chainId = Number(process.env.CHAIN_ID || 0);
  const rpc = process.env.RPC_URL || '';
  if (!chainId || !rpc || !/^https:\/\//.test(rpc)) fail('verify needs CHAIN_ID + RPC_URL (https).');
  if (!/^0x[0-9a-fA-F]{40}$/.test(target)) fail('Usage: node scripts/deploy-launch-factory.mjs verify 0xFactoryAddress');
  const provider = new JsonRpcProvider(rpc, chainId, { staticNetwork: true });
  const addr = await verifyDeployment(chainId, target, provider);
  console.log(`\nConfigure it (public data only — .env, then restart):\n  FBTLAUNCH_FACTORY_${chainId}=${addr}\n`);
  process.exit(0);
}

if (mode !== 'deploy' && mode !== 'all') fail('Unknown mode. Use `deploy`, `all`, or `verify 0x…`.');

const pk = process.env.DEPLOYER_PRIVATE_KEY || '';
if (!pk || !/^0x[0-9a-fA-F]{64}$/.test(pk)) fail('Set DEPLOYER_PRIVATE_KEY (env-only, throwaway gas wallet).');
const wallet = new Wallet(pk);

const chains = mode === 'all' ? ALL_CHAINS : [Number(process.env.CHAIN_ID || 0)];
if (mode === 'deploy' && (!Number.isInteger(chains[0]) || chains[0] <= 0)) fail('deploy (single) needs CHAIN_ID.');

const results = {};
for (const chainId of chains) {
  try {
    results[chainId] = await deployTo(chainId, wallet);
  } catch (e) {
    console.error(`\n✗ ${CHAIN_NAME[chainId] || chainId}: ${e.message}\n`);
    results[chainId] = null;
  }
}

const okCount = Object.values(results).filter(Boolean).length;
console.log(`\n${'═'.repeat(56)}`);
console.log(okCount === chains.length ? '✓ ALL DEPLOYED — add these to .env:' : `⚠ ${okCount}/${chains.length} deployed — add only the successful ones:`);
for (const [chainId, addr] of Object.entries(results)) {
  console.log(addr ? `FBTLAUNCH_FACTORY_${chainId}=${addr}` : `# FBTLAUNCH_FACTORY_${chainId}=   ← ${CHAIN_NAME[chainId] || chainId} FAILED`);
}
console.log(`${'═'.repeat(56)}`);
if (okCount < chains.length) process.exit(1);
