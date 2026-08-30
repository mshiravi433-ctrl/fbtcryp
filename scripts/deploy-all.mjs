#!/usr/bin/env node
/**
 * Deploy All — orchestrates deployment of all 4 contracts.
 *
 * Preflight: chainId, balance, gas
 * Deploys: FeeRouter, IntentWorkflowBatch, IntentMerkleRootAnchor, IntentAuctionAnchor
 * Prints resulting env variables.
 *
 * Usage:
 *   DEPLOYER_PRIVATE_KEY=0x... RPC_URL=https://... CHAIN_ID=421614 \
 *     node scripts/deploy-all.mjs
 *
 * SECURITY: DEPLOYER_PRIVATE_KEY is env-only. Never written to disk.
 * Raw key only for testnet. For mainnet use DEPLOYER_KMS_KEY_ID.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import { maskBytecodeImmutables } from '../server/intentOperationalDrills.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');

const fail = (msg) => { console.error(`\n✗ ${msg}\n`); process.exit(1); };

const rpc = process.env.RPC_URL || '';
if (!rpc) fail('Set RPC_URL to an HTTPS RPC endpoint.');
if (!/^https:\/\//.test(rpc)) fail('RPC_URL must be https.');

const chainId = Number(process.env.CHAIN_ID || 0);
if (!Number.isInteger(chainId) || chainId <= 0) fail('CHAIN_ID must be a positive integer.');

const pk = process.env.DEPLOYER_PRIVATE_KEY || '';
const kmsKeyId = process.env.DEPLOYER_KMS_KEY_ID || '';
if (!pk && !kmsKeyId) fail('Set DEPLOYER_PRIVATE_KEY (testnet) or DEPLOYER_KMS_KEY_ID+AWS_REGION (mainnet).');

const TESTNET_CHAINS = new Set([421614, 11155111, 84532, 97, 80002]);
if (pk && !TESTNET_CHAINS.has(chainId)) {
  fail(`DEPLOYER_PRIVATE_KEY only for testnet (${[...TESTNET_CHAINS].join(',')}). For mainnet, use KMS.`);
}

const { JsonRpcProvider, Wallet, ContractFactory } = await import('ethers');
const provider = new JsonRpcProvider(rpc, chainId, { staticNetwork: true });
const wallet = new Wallet(pk, provider);

console.log('\n═══════════════════════════════════════════════════');
console.log(' FBT Intent AI — Deploy All Contracts');
console.log('═══════════════════════════════════════════════════');
console.log(` chainId  : ${chainId}`);
console.log(` deployer : ${wallet.address}`);
console.log('═══════════════════════════════════════════════════\n');

let balance;
try { balance = await provider.getBalance(wallet.address); }
catch { fail('Cannot reach RPC.'); }
console.log(` balance: ${balance.toString()} wei`);
if (balance === 0n) fail('Deployer has no gas.');

const ROUTERS = {
  56: '0x10ED43C718714eb63d5aA57B78B54704E256024E',
  97: '0xD99D1c33F9fC3444f8101754aBC46c52416550D1',
  42161: '0x10ED43C718714eb63d5aA57B78B54704E256024E',
  421614: '0x10ED43C718714eb63d5aA57B78B54704E256024E'
};

const defaultDexRouter = ROUTERS[chainId] || '0x10ED43C718714eb63d5aA57B78B54704E256024E';
const feeRecipient = process.env.FEE_RECIPIENT || '0xaf5CE154cEfd22Da5BD1D0a54479E81963A224d6';
const feeBps = Number(process.env.FEE_BPS || 50);

const contracts = [
  { name: 'IntentWorkflowBatch', artifact: 'src/lib/workflowBatchArtifact.json', compile: 'scripts/compile-workflow.mjs', envKey: 'INTENT_WORKFLOW_BATCH_ADDRESS', args: [] },
  { name: 'IntentMerkleRootAnchor', artifact: 'src/lib/merkleRootAnchorArtifact.json', compile: 'scripts/compile-merkle-anchor.mjs', envKey: 'INTENT_MERKLE_ANCHOR_ADDRESS', args: [] },
  { name: 'IntentAuctionAnchor', artifact: 'src/lib/auctionAnchorArtifact.json', compile: 'scripts/compile-auction-anchor.mjs', envKey: 'INTENT_ANCHOR_ADDRESS', args: [] },
  { name: 'FeeRouter', artifact: 'src/lib/feeRouterArtifact.json', compile: 'scripts/compile.mjs', envKey: 'INTENT_FEE_ROUTER_ADDRESS', args: [defaultDexRouter, feeRecipient, feeBps] }
];

for (const c of contracts) {
  const p = path.join(root, c.artifact);
  if (!fs.existsSync(p)) {
    console.log(`  ▸ Compiling ${c.name}…`);
    try { execSync(`node ${c.compile}`, { cwd: root, stdio: 'pipe' }); }
    catch (e) { fail(`Compile failed for ${c.name}: ${e.stderr?.toString() || e.message}`); }
  }
}

const deployed = {};
const errors = [];

for (const c of contracts) {
  const art = JSON.parse(fs.readFileSync(path.join(root, c.artifact), 'utf8'));
  console.log(`\n── ${c.name} ──`);
  try {
    const factory = new ContractFactory(art.abi, art.bytecode, wallet);
    const tx = await factory.deploy(...(c.args || []));
    console.log(`  tx: ${tx.deploymentTransaction().hash}`);
    await tx.waitForDeployment();
    const addr = await tx.getAddress();
    console.log(`  ✓ ${addr}`);
    deployed[c.envKey] = addr;

    if (art.deployedBytecode) {
      const onChain = await provider.getCode(addr);
      const maskedOnChain = maskBytecodeImmutables(onChain, art.immutableReferences || {});
      const maskedLocal = maskBytecodeImmutables(art.deployedBytecode, art.immutableReferences || {});
      if (maskedOnChain.toLowerCase() !== maskedLocal.toLowerCase()) {
        console.log('  ⚠ bytecode mismatch');
        errors.push(`${c.name}: bytecode mismatch`);
      } else console.log('  ✓ bytecode verified');
    }
  } catch (e) {
    console.error(`  ✗ ${e.message}`);
    errors.push(`${c.name}: ${e.message}`);
  }
}

console.log('\n═══════════════════════════════════════════════════');
console.log(' SUMMARY');
console.log('═══════════════════════════════════════════════════\n');

if (Object.keys(deployed).length > 0) {
  console.log(' Set these env variables:\n');
  for (const [k, v] of Object.entries(deployed)) console.log(`  ${k}=${v}`);

  if (deployed.INTENT_MERKLE_ANCHOR_ADDRESS) {
    const nets = [{ chainId, name: chainId === 421614 ? 'Arbitrum Sepolia' : `chain-${chainId}`, contract: deployed.INTENT_MERKLE_ANCHOR_ADDRESS, rpcUrl: rpc, minConfirmations: 2 }];
    console.log(`\n  INTENT_MERKLE_ANCHOR_NETWORKS=${JSON.stringify(nets)}`);
  }
  if (deployed.INTENT_ANCHOR_ADDRESS) {
    const nets = [{ chainId, name: chainId === 421614 ? 'Arbitrum Sepolia' : `chain-${chainId}`, contract: deployed.INTENT_ANCHOR_ADDRESS, rpcUrl: rpc, explorerBaseUrl: chainId === 421614 ? 'https://sepolia.arbiscan.io' : 'https://arbiscan.io', minConfirmations: 12 }];
    console.log(`\n  INTENT_ANCHOR_NETWORKS=${JSON.stringify(nets)}`);
  }
}
if (errors.length) { console.log(`\n ✗ ${errors.length} error(s)`); errors.forEach(e => console.log(`   - ${e}`)); }
console.log('\n DEPLOYER_PRIVATE_KEY never goes into repo, VITE_*, chat, or Vercel.\n');
if (errors.length) process.exit(1);
