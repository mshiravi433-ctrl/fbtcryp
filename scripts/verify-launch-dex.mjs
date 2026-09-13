#!/usr/bin/env node
/**
 * Verify the launch DEX registry (src/lib/launch/networks.js) against live
 * chains. Run this in CI / after ops changes — it catches a wrong factory
 * constant BEFORE users ever see it.
 *
 *   node scripts/verify-launch-dex.mjs            # all configured chains
 *   node scripts/verify-launch-dex.mjs 56 8453    # specific chainIds
 *
 * For each chain it checks, through that chain's own RPC (from lib/chains.js):
 *   1. the DEX factory contract exists (has code),
 *   2. the factory exposes getPair and returns the REAL anchor pair
 *      (the registry's anchor pair is a long-lived, independently known
 *      address — if getPair(anchorA, anchorB) !== anchorPair, the factory
 *      constant is wrong),
 *   3. the anchor pair's factory() points back at the registry factory.
 *
 * Exit code 0 = all verified, 1 = at least one failure. Safe to automate:
 * no keys, no writes, reads only.
 */
import { JsonRpcProvider, Contract } from 'ethers';
import { EVM_CHAINS } from '../src/lib/chains.js';
import { LAUNCH_DEX, LAUNCH_CHAINS } from '../src/lib/launch/networks.js';

const only = process.argv.slice(2).map(Number).filter((n) => Number.isInteger(n) && n > 0);
const chains = only.length ? only : LAUNCH_CHAINS;

const ERC20_ABI = [
  'function symbol() view returns (string)',
  'function balanceOf(address) view returns (uint256)'
];
const PAIR_ABI = [
  'function getReserves() view returns (uint112, uint112, uint32)',
  'function factory() view returns (address)',
  'function token0() view returns (address)',
  'function token1() view returns (address)'
];
const FACTORY_ABI = [
  'function getPair(address,address) view returns (address)'
];

let failures = 0;

for (const chainId of chains) {
  const chain = EVM_CHAINS[chainId];
  const dex = LAUNCH_DEX[chainId];
  const line = (msg) => console.log(`  ${msg}`);
  if (!chain) { console.log(`✗ ${chainId}: not in EVM_CHAINS`); failures += 1; continue; }
  if (!dex) { console.log(`✗ ${chain} (${chainId}): no DEX entry in the launch registry`); failures += 1; continue; }

  console.log(`• ${chain.name} (${chainId}) — ${dex.dexName}`);
  // lib/chains.js stores `rpc` as an ordered fallback list — walk it until
  // one answers, so verification works from any machine.
  const rpcList = Array.isArray(chain.rpc) ? chain.rpc : (chain.rpc ? [chain.rpc] : []);
  if (!rpcList.length) { console.log('  ✗ no RPC URL in lib/chains.js for this chain'); failures += 1; continue; }

  let provider = null;
  for (const rpc of rpcList) {
    try {
      const candidate = new JsonRpcProvider(rpc, chainId, { staticNetwork: true });
      const block = await Promise.race([
        candidate.getBlockNumber(),
        new Promise((_, rej) => setTimeout(() => rej(new Error('RPC_TIMEOUT')), 15000))
      ]);
      provider = candidate;
      line(`  RPC ok (block ${block}) via ${new URL(rpc).host}`);
      break;
    } catch {
      line(`  rpc ${new URL(rpc).host} unreachable — trying next`);
    }
  }
  if (!provider) {
    console.log(`  ✗ all RPCs unreachable`);
    failures += 1;
    continue;
  }

  try {
    // 1. factory code
    const code = await provider.getCode(dex.factory);
    if (!code || code === '0x') throw new Error('no code at factory address — wrong constant');
    line(`  factory ${dex.factory} has code`);

    // 2. getPair(anchorA, anchorB) returns a REAL pair (non-zero)
    const factory = new Contract(dex.factory, FACTORY_ABI, provider);
    const found = await factory.getPair(dex.anchor.a, dex.anchor.b);
    if (!found || found === '0x0000000000000000000000000000000000000000') {
      throw new Error(`getPair(anchor a=${dex.anchor.a.slice(0,8)}…, b=${dex.anchor.b.slice(0,8)}…) = 0 — factory constant is wrong`);
    }
    line(`  anchor pair resolves: ${found}`);

    // 3. anchor pair points back
    const pair = new Contract(found, PAIR_ABI, provider);
    const back = await pair.factory();
    if (back.toLowerCase() !== dex.factory.toLowerCase()) {
      throw new Error(`pair.factory() = ${back} ≠ registry factory`);
    }
    line('  anchor pair.factory() matches');

    // 4. reserves are non-zero (the pair is real & live)
    const [r0, r1] = await pair.getReserves();
    if (r0 === 0n || r1 === 0n) throw new Error('anchor pair has zero reserves — not a live pair');
    line(`  anchor reserves non-zero (${r0}, ${r1})`);

    console.log('  ✓ VERIFIED\n');
  } catch (e) {
    console.log(`  ✗ FAILED: ${e.message}\n`);
    failures += 1;
  }
}

if (failures) {
  console.log(`✗ ${failures} chain(s) failed DEX verification.`);
  process.exit(1);
}
console.log('✓ All DEX registry entries verified against live chains.');
