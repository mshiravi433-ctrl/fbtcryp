#!/usr/bin/env node
/**
 * Deploy FlashLiquidityRouter on ONE chain, then configure its allowlists in
 * the same session. Run it once per chain, then paste the printed env line
 * (FLASH_LIQUIDITY_ROUTER_ADDRESSES=...) into the server/Vercel environment.
 *
 *   node scripts/compile-flash-liquidity.mjs
 *   DEPLOYER_PRIVATE_KEY=0x... RPC_URL=https://... CHAIN_ID=42161 \
 *     FLASH_ASSETS=0xaf88d065e77c8cC2239327C5EDb3A432268e5831 \
 *     FLASH_TARGETS=0xE592427A0AEce92De3Edee1F18E0157C05861564 \
 *     node scripts/deploy-flash-liquidity.mjs
 *
 * FLASH_SOURCE  (optional) flash-loan source. Defaults to the Balancer Vault
 *               when this repo's verified registry covers the chain; override
 *               only with an address you verified from the provider's official
 *               docs — an override outside the registry also needs a registry
 *               update before the planner will plan with it.
 * FLASH_ASSETS  comma-separated settlement tokens the router may borrow
 *               (example above is USDC on Arbitrum).
 * FLASH_TARGETS comma-separated DEX routers/pools the hops may call. Deploying
 *               with none is INERT and safe: every hop would revert with
 *               TARGET_NOT_ALLOWED. Add only contracts you verified.
 *
 * SECURITY: DEPLOYER_PRIVATE_KEY is env-only — never written to disk, never
 * printed, never a VITE_*. Use a throwaway wallet that holds only gas money.
 * The deployer becomes the contract OWNER: move ownership to a hardware wallet
 * with transferOwnership() before any real execution.
 *
 * HONEST STATE: this contract ships UNAUDITED. Deploying it and configuring
 * FLASH_LIQUIDITY_ROUTER_ADDRESSES does NOT enable execution — the capability
 * stays planning-only until an independent audit exists and
 * FLASH_LIQUIDITY_ROUTER_AUDITED=true is set. That gate is the product.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Contract, ContractFactory, JsonRpcProvider, Network, Wallet, isAddress } from 'ethers';
import { FLASH_PROVIDER_REGISTRY, chainName } from '../src/lib/intent-ai/flashLiquidity.js';

const bareNetwork = (chainId) => new Network(`fbt-dev-${chainId}`, chainId);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');

const fail = (msg) => {
  console.error(`\n✗ ${msg}\n`);
  process.exit(1);
};

const pk = process.env.DEPLOYER_PRIVATE_KEY;
if (!pk) fail('Set DEPLOYER_PRIVATE_KEY (a throwaway wallet with a little gas). Never commit it.');

const rpc = process.env.RPC_URL;
if (!rpc) fail('Set RPC_URL to an HTTPS RPC endpoint for the target chain.');
const isLoopback = (() => {
  try { return ['localhost', '127.0.0.1', '::1'].includes(new URL(rpc).hostname); } catch { return false; }
})();
if (!/^https:\/\//.test(rpc) && !(/^http:\/\//.test(rpc) && isLoopback)) {
  fail('RPC_URL must be https (http only for a local dev chain on localhost/127.0.0.1).');
}

const chainId = Number(process.env.CHAIN_ID || 0);
if (!Number.isInteger(chainId) || chainId <= 0) fail('Set CHAIN_ID (e.g. 42161 for Arbitrum).');

const artifactPath = path.join(root, 'src/lib/flashLiquidityRouterArtifact.json');
if (!fs.existsSync(artifactPath)) fail('Artifact missing. Run: node scripts/compile-flash-liquidity.mjs');
const artifact = JSON.parse(fs.readFileSync(artifactPath, 'utf8'));
if (artifact.audited !== false) fail('Artifact audited flag looks wrong — refusing.');

const parseList = (raw) => String(raw || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

const assets = parseList(process.env.FLASH_ASSETS);
const targets = parseList(process.env.FLASH_TARGETS);
for (const a of assets) if (!isAddress(a)) fail(`FLASH_ASSETS entry is not a valid address: ${a}`);
for (const t of targets) if (!isAddress(t)) fail(`FLASH_TARGETS entry is not a valid address: ${t}`);

/* Flash source: verified registry default, or an explicit operator override. */
let flashSource = process.env.FLASH_SOURCE ? String(process.env.FLASH_SOURCE).trim() : null;
let sourceLabel = null;
if (flashSource && !isAddress(flashSource)) fail(`FLASH_SOURCE is not a valid address: ${flashSource}`);
if (!flashSource) {
  const balancer = FLASH_PROVIDER_REGISTRY['balancer-v2'].chains[chainId];
  if (balancer && balancer.verified) {
    flashSource = balancer.vault;
    sourceLabel = 'Balancer Vault (verified registry)';
  } else {
    fail(`No verified flash source for chain ${chainId} (${chainName(chainId)}) in the registry.\n` +
         '  Either deploy on a chain the registry covers, or pass FLASH_SOURCE=0x… from the\n' +
         "  provider's official docs (and add it to src/lib/intent-ai/flashLiquidity.js).");
  }
} else {
  sourceLabel = 'operator override — NOT in the verified registry; update the registry too';
}

const provider = new JsonRpcProvider(rpc, bareNetwork(chainId), { staticNetwork: true });
const wallet = new Wallet(pk, provider);

console.log('\n──────────────────────────────────────────────');
console.log(' FlashLiquidityRouter deployment (UNAUDITED)');
console.log('──────────────────────────────────────────────');
console.log(' chainId      :', chainId, `(${chainName(chainId)})`);
console.log(' deployer     :', wallet.address, '(becomes owner)');
console.log(' flash source :', flashSource);
console.log('                ', sourceLabel);
console.log(' assets       :', assets.length ? assets.join(', ') : 'NONE — borrow calls will revert');
console.log(' targets      :', targets.length ? targets.join(', ') : 'NONE — router is INERT (safe)');
console.log('──────────────────────────────────────────────\n');

let balance;
try {
  balance = await provider.getBalance(wallet.address);
} catch {
  fail('RPC unreachable — check RPC_URL.');
}
console.log(' deployer balance:', balance, 'wei');
if (balance === 0n) fail('Deployer has no gas money on this chain. Fund it first.');

const factory = new ContractFactory(artifact.abi, artifact.bytecode, wallet);
let contract;
try {
  contract = await factory.deploy();
  await contract.waitForDeployment();
} catch (error) {
  fail(`deployment failed: ${error.shortMessage || error.message}`);
}
const address = await contract.getAddress();
console.log('\n✓ deployed at', address);

const doCall = async (label, fn) => {
  try {
    const tx = await fn();
    const receipt = await tx.wait();
    if (receipt.status !== 1) throw new Error(`status ${receipt.status}`);
    console.log('  ✓', label);
  } catch (error) {
    fail(`${label} failed: ${error.shortMessage || error.message}`);
  }
};

console.log('\nconfiguring allowlists…');
await doCall(`setFlashSource(${flashSource})`, () => contract.setFlashSource(flashSource, true));
for (const a of assets) await doCall(`setAsset(${a})`, () => contract.setAsset(a, true));
for (const t of targets) await doCall(`setTarget(${t})`, () => contract.setTarget(t, true));

console.log('\n──────────────────────────────────────────────');
console.log(' NEXT STEPS');
console.log('──────────────────────────────────────────────');
console.log(' 1. Paste into the server/Vercel env:');
console.log(`       FLASH_LIQUIDITY_ROUTER_ADDRESSES=${chainId}:${address}`);
console.log(' 2. Keep FLASH_LIQUIDITY_ROUTER_AUDITED unset until a real');
console.log('    independent audit exists — the planner stays planning-only.');
console.log(' 3. Move ownership off the throwaway deployer key:');
console.log(`       contract.connect(hardwareWallet).transferOwnership(newOwner)`);
console.log(` 4. Verify on the explorer: ${address}`);
console.log(` 5. Check status:  curl -s $BASE/api/flash-liquidity/v1/capabilities | jq .status`);
console.log('──────────────────────────────────────────────\n');
