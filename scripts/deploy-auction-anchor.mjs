#!/usr/bin/env node
/**
 * Deploy + verify IntentAuctionAnchor. The contract is permissionless, has no
 * constructor args, no owner and never holds funds.
 *
 *   node scripts/compile-auction-anchor.mjs
 *   DEPLOYER_PRIVATE_KEY=0x... RPC_URL=https://... CHAIN_ID=8453 \
 *     node scripts/deploy-auction-anchor.mjs
 *
 * Verification of an existing deployment (no key needed):
 *   RPC_URL=https://... CHAIN_ID=8453 \
 *     node scripts/deploy-auction-anchor.mjs verify 0xDeployedAddress
 *
 * SECURITY: DEPLOYER_PRIVATE_KEY is env-only. It is never written to disk,
 * printed, echoed, committed, or placed in VITE_*. Use a throwaway wallet
 * that holds only gas. Without a real deployment, leave
 * INTENT_ANCHOR_NETWORKS empty — capabilities honestly reports the anchor
 * capability as unconfigured and /anchor-networks stays {"networks":[]}.
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

const rpc = process.env.RPC_URL || '';
if (!rpc) fail('Set RPC_URL to an HTTPS RPC endpoint (server/operator env only — never printed, never VITE_*).');
if (!/^https:\/\//.test(rpc)) fail('RPC_URL must be https.');

const chainId = Number(process.env.CHAIN_ID || 0);
if (!Number.isInteger(chainId) || chainId <= 0) fail('CHAIN_ID must be a positive integer.');

const artifactPath = path.join(root, 'src/lib/auctionAnchorArtifact.json');
if (!fs.existsSync(artifactPath)) fail('Artifact missing. Run: node scripts/compile-auction-anchor.mjs');
const artifact = JSON.parse(fs.readFileSync(artifactPath, 'utf8'));
if (!String(artifact.compiler || '').includes('0.8.24')) {
  fail('Artifact was not compiled with solc 0.8.24. Re-run scripts/compile-auction-anchor.mjs.');
}

const provider = new JsonRpcProvider(rpc, chainId, { staticNetwork: true });

/**
 * Verify a deployment: exact runtime bytecode match plus a live interface
 * probe via a static call. This is what makes it safe to put the address into
 * INTENT_ANCHOR_NETWORKS.
 */
async function verifyDeployment(address) {
  const checksummed = getAddress(address);
  const onChain = await provider.getCode(checksummed);
  if (!onChain || onChain === '0x') fail('No code at that address on this chain.');
  if (onChain.toLowerCase() !== String(artifact.deployedBytecode).toLowerCase()) {
    fail('Deployed bytecode does NOT match the compiled IntentAuctionAnchor artifact. Do not configure this address.');
  }
  const contract = new Contract(checksummed, artifact.abi, provider);
  /* Static-call anchor with fresh values: it must succeed (view of a would-be
     event) and a duplicate tuple must revert with AlreadyAnchored semantics.
     staticCall never spends gas or mutates state. */
  const closeId = `0x${'11'.repeat(32)}`;
  const intentHash = `0x${'22'.repeat(32)}`;
  const logRoot = `0x${'33'.repeat(32)}`;
  try {
    await contract.anchor.staticCall(closeId, intentHash, logRoot, 1n, 1n);
  } catch (error) {
    /* An AlreadyAnchored revert on these test values still proves the exact
       interface; anything else is a mismatch. */
    if (!String(error?.message || '').includes('AlreadyAnchored')) {
      fail('anchor static call failed — interface mismatch. Do not configure this address.');
    }
  }
  console.log('\n✓ bytecode + interface verified for', checksummed);
  console.log('\nConfigure it (public data only):');
  console.log(`  INTENT_ANCHOR_NETWORKS=[{"chainId":${chainId},"name":"…","contract":"${checksummed}","rpcUrl":"https://…","explorerBaseUrl":"https://…","minConfirmations":12}]`);
  console.log('  (rpcUrl stays server-side; it is never exposed by any public endpoint.)\n');
}

const [, , command, addressArg] = process.argv;
if (command === 'verify') {
  if (!addressArg) fail('Usage: deploy-auction-anchor.mjs verify <address>');
  await verifyDeployment(addressArg);
  process.exit(0);
}

const pk = process.env.DEPLOYER_PRIVATE_KEY;
if (!pk) {
  fail([
    'Set DEPLOYER_PRIVATE_KEY (a throwaway wallet holding only gas).',
    'Never commit it, never paste it into chat, never prefix it with VITE_.',
    'Without a real deployment, keep INTENT_ANCHOR_NETWORKS empty:',
    'the anchor capability then honestly reports itself as unconfigured.'
  ].join('\n  '));
}

const wallet = new Wallet(pk, provider);

console.log('\n──────────────────────────────────────────────');
console.log(' IntentAuctionAnchor deployment');
console.log('──────────────────────────────────────────────');
console.log(' chainId    :', chainId);
console.log(' deployer   :', wallet.address);
console.log(' compiler   :', artifact.compiler);
console.log(' custody    : never (permissionless, no owner, no funds)');
console.log('──────────────────────────────────────────────\n');

let balance;
try {
  balance = await provider.getBalance(wallet.address);
} catch {
  fail('Could not reach the RPC endpoint.');
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

console.log('\nVerifying the deployment bytecode + event interface…');
await verifyDeployment(address);

console.log('Next steps:');
console.log('  1. Publish + verify the source on the chain explorer (exact solc 0.8.24, paris, optimizer 200).');
console.log('  2. Anchor a REAL signed close via GET /api/intents/v1/auctions/{intentHash}/anchor-calldata/' + chainId + '.');
console.log('  3. Submit the claim through POST /api/intents/v1/auctions/{intentHash}/anchor.');
console.log('  4. Only then does the external-anchor capability become configured — a failed anchor never invalidates the signed close.');
console.log('  5. DEPLOYER_PRIVATE_KEY never goes into the repo, VITE_*, chat or Vercel.\n');
