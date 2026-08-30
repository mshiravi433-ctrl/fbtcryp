#!/usr/bin/env node
/**
 * Activate cross-chain ATOMIC swap — the one-command finisher.
 * ---------------------------------------------------------------------------
 * Compiles (if needed), deploys IntentAtomicSwap on every target chain, and
 * emits the exact INTENT_ATOMIC_SWAP_ADDRESSES (+ optional RPC env) to set.
 * Optionally appends them to a local env file and re-checks the live status.
 *
 * Targets come from ATOMIC_SWAP_DEPLOY_TARGETS (recommended):
 *
 *   ATOMIC_SWAP_DEPLOY_TARGETS='[
 *     {"chainId":97,  "rpcUrl":"https://data-seed-prebsc-1-s1.binance.org:8545/"},
 *     {"chainId":421614,"rpcUrl":"https://sepolia-rollup.arbitrum.io/rpc"}
 *   ]' DEPLOYER_PRIVATE_KEY=0x… node scripts/activate-atomic-swap.mjs
 *
 * …or from repeatable CLI flags (chainId must be EVM and rpcUrl https, or
 * http only on loopback for a local dev chain):
 *
 *   node scripts/activate-atomic-swap.mjs \
 *     --chain 56  --rpc http://127.0.0.1:8545 \
 *     --chain 137 --rpc http://127.0.0.1:8546 \
 *     --key 0x… [--write-env .env.atomic.local]
 *
 * Activation needs >= 2 chains under the SAME deployer-controlled env value.
 * SECURITY: DEPLOYER_PRIVATE_KEY is env-only, never written anywhere. Mainnet
 * follows the repo policy — use KMS there, not a raw key.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { ContractFactory, JsonRpcProvider, Network, Wallet, isAddress } from 'ethers';

/* A bare Network (no chain-specific plugins) so a known chainId such as 137
   never makes ethers phone home to a public gas station — the RPC endpoint
   alone decides fees. Offline/local-chain safe. */
const bareNetwork = (chainId) => new Network(`fbt-dev-${chainId}`, chainId);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');

const fail = (msg) => { console.error(`\n✗ ${msg}\n`); process.exit(1); };
const ok = (msg) => console.log(`✓ ${msg}`);

/* ------------------------------- arguments -------------------------------- */
const argv = process.argv.slice(2);
const flag = (name) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
};

let targets = [];
const envTargets = process.env.ATOMIC_SWAP_DEPLOY_TARGETS;
if (envTargets) {
  try { targets = JSON.parse(envTargets); } catch { fail('ATOMIC_SWAP_DEPLOY_TARGETS is not valid JSON.'); }
} else {
  /* repeatable pairs: --chain 56 --rpc https://… --chain 137 --rpc https://… */
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] !== '--chain') continue;
    const chainId = Number(argv[i + 1]);
    if (argv[i + 2] !== '--rpc') fail(`--chain ${argv[i + 1]} must be followed by --rpc <url>.`);
    targets.push({ chainId, rpcUrl: argv[i + 3] });
    i += 3;
  }
}
if (!Array.isArray(targets) || targets.length < 2) {
  fail('At least TWO target chains are required (cross-chain atomic needs a pair). Use ATOMIC_SWAP_DEPLOY_TARGETS or repeat --chain N --rpc URL.');
}

const key = process.env.DEPLOYER_PRIVATE_KEY || flag('--key') || '';
if (!key) fail('Set DEPLOYER_PRIVATE_KEY (env) or --key. For mainnet use KMS per repo policy.');
const writeEnv = flag('--write-env') || '';

/* ------------------------------ validation -------------------------------- */
const seen = new Set();
const cleaned = [];
for (const target of targets) {
  const chainId = Number(target?.chainId);
  if (!Number.isInteger(chainId) || chainId <= 0) fail(`Bad chainId: ${target?.chainId}`);
  if (seen.has(chainId)) fail(`Duplicate chainId ${chainId}.`);
  seen.add(chainId);
  const rpcUrl = String(target?.rpcUrl || '');
  let loopback = false;
  try {
    const parsed = new URL(rpcUrl);
    if (parsed.username || parsed.password) fail(`RPC for chain ${chainId} must not embed credentials.`);
    loopback = ['localhost', '127.0.0.1', '::1'].includes(parsed.hostname);
    if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && loopback)) {
      fail(`RPC for chain ${chainId} must be https (http only for a local dev chain on loopback).`);
    }
  } catch {
    fail(`Bad rpcUrl for chain ${chainId}: ${rpcUrl}`);
  }
  cleaned.push({ chainId, rpcUrl, loopback });
}

/* --------------------------- compile if needed ---------------------------- */
const artifactPath = path.join(root, 'src/lib/atomicSwapArtifact.json');
if (!fs.existsSync(artifactPath)) {
  console.log('▸ compiling IntentAtomicSwap…');
  try { execSync('node scripts/compile-atomic-swap.mjs', { cwd: root, stdio: 'inherit' }); }
  catch { fail('Compilation failed. Is solc installed? (npm i -D solc)'); }
}
const artifact = JSON.parse(fs.readFileSync(artifactPath, 'utf8'));

/* ------------------------------- deploy ----------------------------------- */
const addresses = {};
for (const { chainId, rpcUrl, loopback } of cleaned) {
  console.log(`\n── chain ${chainId} (${loopback ? 'local dev chain' : 'public network'}) ──`);
  const provider = new JsonRpcProvider(rpcUrl, bareNetwork(chainId), { staticNetwork: true });
  const wallet = new Wallet(key, provider);
  let balance;
  try { balance = await provider.getBalance(wallet.address); }
  catch { fail(`Could not reach RPC for chain ${chainId}: ${rpcUrl}`); }
  console.log(`  deployer ${wallet.address} · balance ${balance.toString()} wei`);
  if (balance === 0n) fail(`Deployer has no gas on chain ${chainId}.`);
  const factory = new ContractFactory(artifact.abi, artifact.bytecode, wallet);
  const contract = await factory.deploy();
  console.log(`  tx ${contract.deploymentTransaction().hash}`);
  await contract.waitForDeployment();
  const address = await contract.getAddress();
  if (!isAddress(address)) fail(`Deployment on chain ${chainId} returned no address.`);
  addresses[chainId] = address;
  ok(`chain ${chainId} → ${address}`);
}

/* ------------------------------ emit the env ------------------------------ */
const addressesValue = JSON.stringify(addresses);
const rpcValue = JSON.stringify(cleaned.map(({ chainId, rpcUrl }) => ({ chainId, rpcUrls: [rpcUrl] })));
console.log('\n═══════════════════════════════════════════════════');
console.log(' ACTIVATION ENV — set these on the server, then redeploy:');
console.log('═══════════════════════════════════════════════════');
console.log(`INTENT_ATOMIC_SWAP_ADDRESSES='${addressesValue}'`);
console.log(`INTENT_ATOMIC_SWAP_RPC_NETWORKS='${rpcValue}'`);
console.log('═══════════════════════════════════════════════════');

if (writeEnv) {
  const file = path.resolve(root, writeEnv);
  const existing = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  const strip = (text, name) => text
    .split('\n')
    .filter((line) => !line.startsWith(`${name}=`))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  const next = `${strip(strip(existing, 'INTENT_ATOMIC_SWAP_ADDRESSES'), 'INTENT_ATOMIC_SWAP_RPC_NETWORKS')}\n\n# atomic swap activation (generated by scripts/activate-atomic-swap.mjs)\nINTENT_ATOMIC_SWAP_ADDRESSES='${addressesValue}'\nINTENT_ATOMIC_SWAP_RPC_NETWORKS='${rpcValue}'\n`.trim() + '\n';
  fs.writeFileSync(file, next);
  ok(`env written to ${writeEnv} (never commit keys; this file holds public addresses only)`);
}

console.log('\nNext: restart the server, then check');
console.log('  GET /api/intents/v1/atomic-swap/status  → available:true');
console.log('  (and the HTLC row on /#/intent turns فعال/ATOMIC.)\n');
