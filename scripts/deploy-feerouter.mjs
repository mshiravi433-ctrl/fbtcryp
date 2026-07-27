#!/usr/bin/env node
/**
 * Deploy FeeRouter to BNB Smart Chain.
 *
 *   node scripts/compile.mjs                 # produces the artifact
 *   DEPLOYER_PRIVATE_KEY=0x... \
 *   FEE_RECIPIENT=0xYourWallet \
 *   node scripts/deploy-feerouter.mjs
 *
 * Optional: NETWORK=testnet to deploy to BSC testnet first (strongly advised).
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
const feeBps = Number(process.env.FEE_BPS ?? 50);

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

const artifactPath = path.join(root, 'src/lib/feeRouterArtifact.json');
if (!fs.existsSync(artifactPath)) fail('Artifact missing. Run: node scripts/compile.mjs');
const artifact = JSON.parse(fs.readFileSync(artifactPath, 'utf8'));

const provider = new JsonRpcProvider(net.rpc, net.chainId, { staticNetwork: true });
const wallet = new Wallet(pk, provider);

console.log('\n──────────────────────────────────────────────');
console.log(' FeeRouter deployment');
console.log('──────────────────────────────────────────────');
console.log(' network    :', process.env.NETWORK ?? 'mainnet', `(chainId ${net.chainId})`);
console.log(' deployer   :', wallet.address);
console.log(' dex router :', net.router);
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
console.log(' deployer balance:', (Number(balance) / 1e18).toFixed(5), 'BNB');
if (balance === 0n) fail('Deployer has no BNB. Fund it with ~0.01 BNB for gas.');

console.log(' deploying…');
const factory = new ContractFactory(artifact.abi, artifact.bytecode, wallet);
const contract = await factory.deploy(net.router, recipient, feeBps);
console.log(' tx sent:', contract.deploymentTransaction().hash);

await contract.waitForDeployment();
const address = await contract.getAddress();

console.log('\n✓ Deployed at', address);
console.log('  explorer:', `${net.explorer}/address/${address}`);
console.log('\nNext steps:');
console.log('  1. Add to .env:      VITE_FEE_ROUTER_ADDRESS=' + address);
console.log('  2. Rebuild:          npm run build');
console.log('  3. Verify on BscScan so users can read the source.');
console.log('  4. Transfer ownership to a hardware wallet / multi-sig:');
console.log('     contract.transferOwnership(<safe address>)');
console.log('  5. Test with a tiny swap before announcing it.\n');
