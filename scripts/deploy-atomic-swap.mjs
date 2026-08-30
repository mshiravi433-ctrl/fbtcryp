#!/usr/bin/env node
/**
 * Deploy IntentAtomicSwap (HTLC escrow) on ONE chain. Run it on at least two
 * chains, then set INTENT_ATOMIC_SWAP_ADDRESSES as a JSON map of both.
 *
 *   node scripts/compile-atomic-swap.mjs
 *   DEPLOYER_PRIVATE_KEY=0x... RPC_URL=https://... CHAIN_ID=42161 \
 *     node scripts/deploy-atomic-swap.mjs
 *
 * The contract has no constructor args, no owner, no pause and no rescue. It
 * DOES escrow funds while a swap is open — that escrow is the entire atomicity
 * mechanism. Anyone may verify the deployed bytecode against the artifact.
 *
 * SECURITY: DEPLOYER_PRIVATE_KEY is env-only and is never written to disk,
 * printed, or placed in VITE_*. Use a throwaway wallet that holds only gas.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ContractFactory, JsonRpcProvider, Network, Wallet } from 'ethers';

/* A bare Network (no chain-specific plugins) so a known chainId such as 137
   never makes ethers phone home to a public gas station — the RPC endpoint
   alone decides fees. Offline/local-chain safe. */
const bareNetwork = (chainId) => new Network(`fbt-dev-${chainId}`, chainId);
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
const isLoopback = (() => {
  try {
    const host = new URL(rpc).hostname;
    return ['localhost', '127.0.0.1', '::1'].includes(host);
  } catch { return false; }
})();
if (!/^https:\/\//.test(rpc) && !(/^http:\/\//.test(rpc) && isLoopback)) {
  fail('RPC_URL must be https (http is allowed only for a local dev chain on localhost/127.0.0.1).');
}

const chainId = Number(process.env.CHAIN_ID || 42161);
if (!Number.isInteger(chainId) || chainId <= 0) fail('CHAIN_ID must be a positive integer.');

const artifactPath = path.join(root, 'src/lib/atomicSwapArtifact.json');
if (!fs.existsSync(artifactPath)) fail('Artifact missing. Run: node scripts/compile-atomic-swap.mjs');
const artifact = JSON.parse(fs.readFileSync(artifactPath, 'utf8'));

const provider = new JsonRpcProvider(rpc, bareNetwork(chainId), { staticNetwork: true });
const wallet = new Wallet(pk, provider);

console.log('\n──────────────────────────────────────────────');
console.log(' IntentAtomicSwap (HTLC) deployment');
console.log('──────────────────────────────────────────────');
console.log(' chainId    :', chainId);
console.log(' deployer   :', wallet.address);
console.log(' custody    : on-chain escrow while a swap is open (no owner, no rescue)');
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
console.log(`  1. Repeat on a SECOND chain (cross-chain atomic needs >= 2).`);
console.log('  2. Collect the addresses into ONE env value, e.g.:');
console.log(`       INTENT_ATOMIC_SWAP_ADDRESSES={"${chainId}":"${address}","<otherChainId>":"0x…"}`);
console.log('  3. Rebuild / redeploy so /api/intents/v1/atomic-swap/status.available flips true.');
console.log('  4. Never put DEPLOYER_PRIVATE_KEY in VITE_*, the repo, or chat.\n');
