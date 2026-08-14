#!/usr/bin/env node
/**
 * Deploy IntentWorkflowBatch. The contract has no constructor args, no owner
 * and no token rescue — it never holds funds.
 *
 *   node scripts/compile-workflow.mjs
 *   DEPLOYER_PRIVATE_KEY=0x... RPC_URL=https://... CHAIN_ID=42161 \
 *     node scripts/deploy-workflow.mjs
 *
 * SECURITY: DEPLOYER_PRIVATE_KEY is env-only and is never written to disk,
 * printed, or placed in VITE_*. Use a throwaway wallet that holds only gas.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ContractFactory, JsonRpcProvider, Wallet } from 'ethers';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');

const fail = (msg) => {
  console.error(`\n✗ ${msg}\n`);
  process.exit(1);
};

const pk = process.env.DEPLOYER_PRIVATE_KEY;
if (!pk) fail('Set DEPLOYER_PRIVATE_KEY (a wallet with a little gas). Never commit it.');

const rpc = process.env.RPC_URL || process.env.INTENT_WORKFLOW_RPC_URL;
if (!rpc) fail('Set RPC_URL to an HTTPS RPC endpoint.');
if (!/^https:\/\//.test(rpc)) fail('RPC_URL must be https.');

const chainId = Number(process.env.CHAIN_ID || 42161);
if (!Number.isInteger(chainId) || chainId <= 0) fail('CHAIN_ID must be a positive integer.');

const artifactPath = path.join(root, 'src/lib/workflowBatchArtifact.json');
if (!fs.existsSync(artifactPath)) fail('Artifact missing. Run: node scripts/compile-workflow.mjs');
const artifact = JSON.parse(fs.readFileSync(artifactPath, 'utf8'));

const provider = new JsonRpcProvider(rpc, chainId, { staticNetwork: true });
const wallet = new Wallet(pk, provider);

console.log('\n──────────────────────────────────────────────');
console.log(' IntentWorkflowBatch deployment');
console.log('──────────────────────────────────────────────');
console.log(' chainId    :', chainId);
console.log(' deployer   :', wallet.address);
console.log(' custody    : never (no owner, no rescue)');
console.log('──────────────────────────────────────────────\n');

let balance;
try {
  balance = await provider.getBalance(wallet.address);
} catch {
  fail(`Could not reach RPC (${rpc}).`);
}
console.log(' deployer balance:', balance.toString(), 'wei');
if (balance === 0n) fail('Deployer has no gas.');

console.log(' deploying…');
const factory = new ContractFactory(artifact.abi, artifact.bytecode, wallet);
const contract = await factory.deploy();
console.log(' tx sent:', contract.deploymentTransaction().hash);

await contract.waitForDeployment();
const address = await contract.getAddress();

console.log('\n✓ Deployed at', address);
console.log('\nNext steps:');
console.log('  1. Add to the server env (public address only):');
console.log('       INTENT_WORKFLOW_BATCH_ADDRESS=' + address);
console.log('  2. Rebuild / redeploy so /api/intents/v1/capabilities.workflows.contract.configured flips true.');
console.log('  3. Never put DEPLOYER_PRIVATE_KEY in VITE_*, the repo, or chat.\n');
