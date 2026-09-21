#!/usr/bin/env node
/**
 * Deploy FeeRouter to BNB Smart Chain — or ANY EVM chain in generic mode.
 *
 *   node scripts/compile.mjs                 # produces the artifact
 *   DEPLOYER_PRIVATE_KEY=0x... \
 *   FEE_RECIPIENT=0xYourWallet \
 *   node scripts/deploy-feerouter.mjs
 *
 * Optional: NETWORK=testnet to deploy to BSC testnet first (strongly advised).
 *
 * ─── GENERIC MODE — any other chain ────────────────────────────────────────
 *   DEPLOYER_PRIVATE_KEY=0x... \
 *   RPC_URL=https://base-rpc.publicnode.com \
 *   CHAIN_ID=8453 \
 *   ROUTER_ADDRESS=0x<a V2-style router on that chain> \
 *   EXPLORER_URL=https://basescan.org \
 *   node scripts/deploy-feerouter.mjs
 *
 * The contract speaks the Uniswap/PancakeSwap V2 router interface
 * (swapExact*For*SupportingFeeOnTransferTokens), so ROUTER_ADDRESS must be a
 * V2-compatible router on the target chain — NOT an aggregator router, whose
 * calldata this contract does not build. Verify the address against that
 * chain's own docs before passing it: a typo here is gas wasted at best.
 *
 * ⚠ READ THIS BEFORE SETTING VITE_FEE_ROUTERS ⚠
 * FeeRouter routing is PER CHAIN since §2.1 of
 * docs/REVENUE-RAIL-COMPLETION-FA.md: set the deployment map as
 *   VITE_FEE_ROUTERS={"56":"0x…","8453":"0x…"}
 * Chains absent from the map keep their fee-carrying aggregator path —
 * deploying on one chain no longer affects any other chain. The legacy
 * single-address VITE_FEE_ROUTER_ADDRESS is still honoured, as BSC-only.
 *
 * SECURITY: DEPLOYER_PRIVATE_KEY is passed via env and never written to disk.
 * Use a throwaway deployer wallet holding only gas money. The deployer becomes
 * the contract owner, so afterwards transfer ownership to a hardware wallet or
 * multi-sig with `transferOwnership()`.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ContractFactory, JsonRpcProvider, Wallet, isAddress } from 'ethers';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');

const NETWORKS = {
  mainnet: {
    rpc: 'https://bsc-dataseed.binance.org',
    chainId: 56,
    router: '0x10ED43C718714eb63d5aA57B78B54704E256024E', // PancakeSwap V2
    explorer: 'https://bscscan.com'
  },
  testnet: {
    rpc: 'https://data-seed-prebsc-1-s1.binance.org:8545',
    chainId: 97,
    router: '0xD99D1c33F9fC3444f8101754aBC46c52416550D1',
    explorer: 'https://testnet.bscscan.com'
  }
};

/**
 * FBT iran revenue wallet (BNB Smart Chain).
 * Verified EIP-55 checksum. Override with FEE_RECIPIENT=0x... if it ever
 * changes — but prefer calling setFeeRecipient() on the live contract so you
 * don't have to redeploy and migrate users.
 */
const DEFAULT_FEE_RECIPIENT = '0xaf5CE154cEfd22Da5BD1D0a54479E81963A224d6';

const net = NETWORKS[process.env.NETWORK ?? 'mainnet'];
const pk = process.env.DEPLOYER_PRIVATE_KEY;
const recipient = process.env.FEE_RECIPIENT ?? DEFAULT_FEE_RECIPIENT;
/*
 * Default 70 bps = the 0.70% the app actually quotes, displays and charges
 * (VITE_FEE_BPS default in lib/feeBps.js). The old default of 50 was a silent
 * 29% revenue cut versus the fee shown on the review screen — and a mismatch
 * between what the UI promises and what the contract takes. FEE_BPS=50 still
 * works for anyone who really wants the README's historical 0.5% example.
 */
const feeBps = Number(process.env.FEE_BPS ?? 70);

function fail(msg) {
  console.error(`\n✗ ${msg}\n`);
  process.exit(1);
}

if (!pk) fail('Set DEPLOYER_PRIVATE_KEY (a wallet with a little BNB for gas).');
if (!recipient) fail('Set FEE_RECIPIENT (the wallet that receives the 0.5% fee).');

// Catch the most common and most expensive mistake: pasting an address from
// the wrong chain. BSC cannot pay to a Bitcoin address — funds sent toward one
// are simply unrecoverable, so refuse loudly instead of deploying.
if (/^(bc1|tb1|[13])[a-zA-HJ-NP-Z0-9]{25,62}$/.test(recipient)) {
  fail(
    `FEE_RECIPIENT "${recipient}" looks like a BITCOIN address.\n` +
      '  This contract runs on BNB Smart Chain and can only pay to an EVM\n' +
      '  address (0x + 40 hex characters). Bitcoin and BSC are separate\n' +
      '  networks with incompatible address formats — there is no way to\n' +
      '  forward BEP-20 tokens to a bech32 address, and anything sent that\n' +
      '  way is lost permanently.\n\n' +
      '  Use an EVM wallet you control (MetaMask / Trust / a hardware wallet).\n' +
      '  You can always swap the collected fees to BTC afterwards and withdraw\n' +
      '  to this Bitcoin address from an exchange.'
  );
}
if (!isAddress(recipient)) {
  fail(
    `FEE_RECIPIENT "${recipient}" is not a valid EVM address.\n` +
      '  Expected 0x followed by 40 hexadecimal characters.'
  );
}
if (feeBps > 100) fail('FEE_BPS cannot exceed 100 (1%) — the contract rejects it.');

/* ─── Generic mode: any chain the operator names explicitly ──────────────── */
const customRpc = process.env.RPC_URL;
const customRouter = process.env.ROUTER_ADDRESS;
const customChainId = Number(process.env.CHAIN_ID ?? 0);
const customExplorer = process.env.EXPLORER_URL ?? 'https://explorer.example';

if (customRpc || customRouter) {
  if (!customRpc) fail('Generic mode needs RPC_URL (an HTTP JSON-RPC endpoint for the target chain).');
  if (!customRouter) fail('Generic mode needs ROUTER_ADDRESS (a V2-style DEX router on the target chain).');
  if (!isAddress(customRouter)) fail(`ROUTER_ADDRESS "${customRouter}" is not a valid EVM address.`);
  if (!customChainId) fail('Generic mode needs CHAIN_ID (the target chain\'s numeric id, e.g. 8453 for Base).');
  Object.assign(net, {
    rpc: customRpc,
    chainId: customChainId,
    router: customRouter,
    explorer: customExplorer,
    generic: true
  });
}

const artifactPath = path.join(root, 'src/lib/feeRouterArtifact.json');
if (!fs.existsSync(artifactPath)) fail('Artifact missing. Run: node scripts/compile.mjs');
const artifact = JSON.parse(fs.readFileSync(artifactPath, 'utf8'));

const provider = new JsonRpcProvider(net.rpc, net.chainId, { staticNetwork: true });
const wallet = new Wallet(pk, provider);

console.log('\n──────────────────────────────────────────────');
console.log(' FeeRouter deployment');
console.log('──────────────────────────────────────────────');
console.log(' network    :', net.generic ? 'custom' : process.env.NETWORK ?? 'mainnet', `(chainId ${net.chainId})`);
console.log(' deployer   :', wallet.address);
console.log(' dex router :', net.router);
if (net.generic) {
  console.log('              ^ GENERIC MODE — operator-supplied. Verify it is a V2-style');
  console.log('                router on chain ' + net.chainId + ' before routing real volume.');
}
console.log(' fee wallet :', recipient, process.env.FEE_RECIPIENT ? '(override)' : '(FBT default)');
console.log(' fee        :', `${feeBps} bps = ${feeBps / 100}%`);
console.log('──────────────────────────────────────────────\n');

let balance;
try {
  balance = await provider.getBalance(wallet.address);
} catch {
  fail(
    `Could not reach the ${process.env.NETWORK ?? 'mainnet'} RPC (${net.rpc}).\n` +
      '  Check your internet connection, or set a different endpoint —\n' +
      '  public BSC nodes are sometimes rate-limited or geo-blocked.'
  );
}
console.log(' deployer balance:', (Number(balance) / 1e18).toFixed(5), net.generic ? 'native coin' : 'BNB');
if (balance === 0n) fail(`Deployer has no native coin for gas on chain ${net.chainId}. Fund it with a little ${net.generic ? 'of that chain\'s gas coin' : 'BNB'}.`);

console.log(' deploying…');
const factory = new ContractFactory(artifact.abi, artifact.bytecode, wallet);
const contract = await factory.deploy(net.router, recipient, feeBps);
console.log(' tx sent:', contract.deploymentTransaction().hash);

await contract.waitForDeployment();
const address = await contract.getAddress();

console.log('\n✓ Deployed at', address);
console.log('  explorer:', `${net.explorer}/address/${address}`);
console.log('\nNext steps:');
console.log('  1. Add THIS chain to the per-chain map (other chains are unaffected):');
console.log(`     VITE_FEE_ROUTERS={"${net.chainId}":"${address}"}`);
console.log('     (legacy VITE_FEE_ROUTER_ADDRESS still works, BSC-only)');
console.log('  2. Verify the source on the block explorer so users can read it.');
console.log('  3. Transfer ownership to a hardware wallet / multi-sig:');
console.log('     contract.transferOwnership(<safe address>)');
console.log('  4. Test with a tiny swap before routing real volume.');
console.log('  5. Point scripts/fee-monitor.mjs at it (FEE_ROUTER_ADDRESS) so the');
console.log('     live feeBps/feeRecipient are checked next to the fees it collects.\n');
