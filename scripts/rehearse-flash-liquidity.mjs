#!/usr/bin/env node
/**
 * FBT Flash Liquidity — LEVEL-2 REHEARSAL (full atomic cycle, local EVM)
 *
 *   npm run rehearse:flash-liquidity
 *
 * Spins up a local EVM (ganache), deploys the REAL FlashLiquidityRouter from
 * the real artifact, builds a real price divergence between two constant-
 * product pools, then runs the production pipeline end to end:
 *
 *   real reserves → scanOpportunities → planFlashArbitrage (GATED)
 *   → build router calldata → REAL eth_call simulation
 *   → planFlashArbitrage (EXECUTE_READY) → wallet-signed transaction
 *   → flash loan → two hops → repay → profit sweep → on-chain verification
 *   → unprofitable variant refused by the simulation gate (nothing sent)
 *   → forced send of the unprofitable variant reverts atomically (no loss)
 *
 * HONEST SCOPE — read before quoting the result anywhere:
 *   - The FBT stack under test (router contract, planner math, simulation
 *     gate, signing flow, atomic settlement) is the REAL production code.
 *   - The counterparties are local harnesses: tokens are MockERC20, the
 *     "vault" replicates Balancer V2 flash-loan semantics (optimistic
 *     transfer → callback → repay-or-revert), and the pools are MiniPairs
 *     whose price formula is byte-identical to the planner's constantProductOut.
 *   - This sandbox has no chain egress, so this is NOT a mainnet fork and NOT
 *     Arbitrum. chainId 42161 is used only so the planner's provider registry
 *     resolves. Aave/Balancer live-contract quirks, real-chain gas and MEV
 *     are validated by the independent audit + a small real first trade.
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { Contract, ContractFactory, HDNodeWallet, Interface, JsonRpcProvider, Network, NonceManager } from 'ethers';
import {
  parseFlashIntent, scanOpportunities, planFlashArbitrage, createFlashPolicy,
  evaluateHops, FLASH_PROVIDER_REGISTRY
} from '../src/lib/intent-ai/flashLiquidity.js';

const require = createRequire(import.meta.url);
const solc = require('solc');
const __dirname = path.dirname(new URL(import.meta.url).pathname);
const root = path.join(__dirname, '..');

const RPC_PORT = Number(process.env.REHEARSAL_RPC_PORT || 18545);
const RPC_URL = process.env.REHEARSAL_RPC_URL || `http://127.0.0.1:${RPC_PORT}`;
const CHAIN_ID = 42161; // registry-compatible label; the chain is LOCAL, not Arbitrum
const MNEMONIC = 'test test test test test test test test test test test junk'; // classic rehearsal seed — holds NOTHING real
const STEPS = [];
const step = (name, ok, detail = '') => { STEPS.push({ name, ok, detail }); console.log(`${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`); };

const fail = (msg) => { console.error(`\n✗ ${msg}`); throw new Error(msg); };

/* ── compile the rehearsal world ──────────────────────────────────────────── */
function compileWorld() {
  const source = fs.readFileSync(path.join(root, 'contracts/rehearsal/RehearsalWorld.sol'), 'utf8');
  const input = {
    language: 'Solidity',
    sources: { 'RehearsalWorld.sol': { content: source } },
    settings: { optimizer: { enabled: true, runs: 200 }, evmVersion: 'paris', outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object'] } } }
  };
  const out = JSON.parse(solc.compile(JSON.stringify(input)));
  const errors = (out.errors || []).filter((e) => e.severity === 'error');
  if (errors.length) { errors.forEach((e) => console.error(e.formattedMessage)); fail('rehearsal world failed to compile'); }
  const contracts = out.contracts['RehearsalWorld.sol'];
  return Object.fromEntries(
    Object.entries(contracts).map(([name, c]) => [name, { abi: c.abi, bytecode: '0x' + c.evm.bytecode.object }])
  );
}

/* ── local chain ──────────────────────────────────────────────────────────── */
async function startChain() {
  // detached:true + group kill: SIGTERM to npx does not reach the ganache
  // node child, which is how zombie chains end up squatting on the port.
  const child = spawn('npx', ['ganache', '--port', String(RPC_PORT), '--chain.chainId', String(CHAIN_ID),
    '--wallet.mnemonic', MNEMONIC, '--miner.blockGasLimit', '30000000', '--quiet'], {
    cwd: root, stdio: ['ignore', 'pipe', 'pipe'], detached: true
  });
  const killTree = () => { try { process.kill(-child.pid, 'SIGKILL'); } catch { /* already gone */ } };
  process.on('exit', killTree);
  child.stderr.on('data', (d) => process.env.REHEARSAL_VERBOSE && console.error('[ganache]', d.toString().trim()));
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(RPC_URL, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_chainId', params: [] }) });
      const json = await res.json();
      if (json?.result) return { child, chainId: parseInt(json.result, 16) };
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 700));
  }
  killTree();
  fail('local EVM did not start');
}

const bareNetwork = new Network('fbt-rehearsal', CHAIN_ID);

async function deploy(wallet, { abi, bytecode }, args = []) {
  const nonce = await wallet.getNonce('pending');
  if (process.env.REHEARSAL_VERBOSE) console.log('  [deploy] sender', wallet.address, 'pending nonce', nonce.toString());
  const factory = new ContractFactory(abi, bytecode, wallet);
  const c = await factory.deploy(...args);
  await c.waitForDeployment();
  return c;
}

const fmtUsdc = (base) => (Number(base) / 1e6).toLocaleString('en-US', { maximumFractionDigits: 2 });

/* ══════════════════════════════════════════════════════════════════════════ */

const world = compileWorld();
const { child: chain } = await startChain();
step('local EVM up', true, `ganache on :${RPC_PORT} (chainId label ${CHAIN_ID} — LOCAL chain, not Arbitrum)`);

try {
  if (!RPC_URL.startsWith('http://127.0.0.1') && !RPC_URL.startsWith('http://localhost') && !/^https:/.test(RPC_URL)) {
    fail('RPC_URL must be https or a loopback http URL');
  }
  const provider = new JsonRpcProvider(RPC_URL, bareNetwork, { staticNetwork: true });
  /* NonceManager: ethers' JsonRpcProvider caches getTransactionCount('pending')
     briefly, which races ganache's eager instamine; a local nonce counter
     avoids the stale-read double-nonce problem. */
  const owner = new NonceManager(HDNodeWallet.fromPhrase(MNEMONIC, undefined, "m/44'/60'/0'/0/0").connect(provider)); // ganache #0 — REHEARSAL ONLY
  const executor = new NonceManager(HDNodeWallet.fromPhrase(MNEMONIC, undefined, "m/44'/60'/0'/0/1").connect(provider)); // ganache #1 — REHEARSAL ONLY
  /* Guard against a zombie chain squatting on the port with different accounts. */
  const ownerAddress = await owner.getAddress();
  const executorAddress = await executor.getAddress();
  const bootBalance = await provider.getBalance(ownerAddress);
  if (bootBalance === 0n) {
    fail(`port ${RPC_PORT} answered but the mnemonic account is unfunded — kill the stale process on that port and re-run`);
  }

  /* ── deploy the external world ── */
  const usdc = await deploy(owner, world.MockERC20, ['USD Coin', 'USDC', 6]);
  const weth = await deploy(owner, world.MockERC20, ['Wrapped Ether', 'WETH', 18]);
  const vault = await deploy(owner, world.FlashVaultHarness, []);
  const pair1 = await deploy(owner, world.MiniPair, [await usdc.getAddress(), await weth.getAddress()]);
  const pair2 = await deploy(owner, world.MiniPair, [await usdc.getAddress(), await weth.getAddress()]);
  step('rehearsal world deployed', true, `USDC ${await usdc.getAddress()} · WETH ${await weth.getAddress()} · vault ${await vault.getAddress()}`);

  /* ── deploy + configure the REAL router (same artifact the UI bundles) ── */
  const routerArtifact = JSON.parse(fs.readFileSync(path.join(root, 'src/lib/flashLiquidityRouterArtifact.json'), 'utf8'));
  const router = await deploy(owner, routerArtifact, []);
  const routerAddress = await router.getAddress();
  const vaultAddress = await vault.getAddress();
  const pair1Address = await pair1.getAddress();
  const pair2Address = await pair2.getAddress();
  const usdcAddress = await usdc.getAddress();
  for (const [label, fn] of [
    ['setFlashSource', () => router.setFlashSource(vaultAddress, true)],
    ['setExecutor', () => router.setExecutor(executorAddress, true)],
    ['setAsset USDC', () => router.setAsset(usdcAddress, true)],
    ['setTarget pair1', () => router.setTarget(pair1Address, true)],
    ['setTarget pair2', () => router.setTarget(pair2Address, true)]
  ]) {
    const tx = await fn();
    const rc = await tx.wait();
    if (rc.status !== 1) fail(`${label} failed`);
  }
  step('FlashLiquidityRouter deployed + allowlisted', true, routerAddress);

  /* ── liquidity ── */
  const e6 = 10n ** 6n;
  const e18 = 10n ** 18n;
  await (await usdc.mint(ownerAddress, 50_000_000n * e6)).wait();
  await (await weth.mint(ownerAddress, 20_000n * e18)).wait();
  await (await usdc.mint(await vault.getAddress(), 5_000_000n * e6)).wait(); // the vault's lending stock
  await (await usdc.transfer(await pair1.getAddress(), 2_500_000n * e6)).wait();
  await (await weth.transfer(await pair1.getAddress(), 1600n * e18)).wait();
  await (await usdc.transfer(await pair2.getAddress(), 2_500_000n * e6)).wait();
  await (await weth.transfer(await pair2.getAddress(), 1600n * e18)).wait();

  /* ── create a REAL divergence: extra USDC flows into pair 1 ── */
  const SHOCK = 75_000n * e6;
  await (await usdc.transfer(await pair1.getAddress(), SHOCK)).wait();
  step('price divergence created', true, `+${fmtUsdc(SHOCK)} USDC into pair-1 (~2.9% gap)`);

  /* ── read REAL reserves → snapshots ── */
  const observedAtMs = Date.now();
  const snapshotOf = async (pair, venueId) => {
    const [ra, rb] = await pair.reserves();
    return { venueId, reserveA: ra.toString(), reserveB: rb.toString(), feeBps: 30, observedAtMs };
  };
  const snapshots = [
    await snapshotOf(pair1, 'rehearsal-pair-1'),
    await snapshotOf(pair2, 'rehearsal-pair-2')
  ];
  const chainGasPrice = BigInt((await provider.getFeeData()).gasPrice ?? 1_000_000_000n);

  /* ── the REAL planner, on REAL chain state ── */
  const intent = parseFlashIntent('با ۰ سرمایه اولیه، هر آربیتراژی که بعد از Gas + Flash Fee حداقل ۰.۵٪ سود دارد اجرا کن');
  if (!intent.ok) fail('intent parse failed');
  const market = { chainId: CHAIN_ID, asset: 'USDC', assetPriceUsd: 1, assetDecimals: 6, snapshots };
  const baseConfig = {
    providerId: 'balancer-v2',
    flashSourceOverride: { address: await vault.getAddress(), attestedBy: 'rehearsal-vault-harness' },
    gasPriceGwei: Number(chainGasPrice) / 1e9,
    nativePriceUsd: 3000,
    platformFeeBps: 70,
    mevBufferBps: 0,
    slippageBps: 30,
    deadlineSeconds: 120,
    routerAddress,
    routerAudited: true // rehearsal self-attestation on the local chain; production stays audited:false
  };
  const policy = createFlashPolicy({ minNetProfitBps: 50 });

  const gated = planFlashArbitrage({ intent, market, config: baseConfig, policy, context: { now: observedAtMs, attemptsToday: 0 } });
  if (gated.decision !== 'GATED' || !gated.reasons.includes('SIMULATION_PENDING')) {
    fail(`expected GATED plan awaiting simulation, got ${gated.decision}: ${(gated.reasons || []).join(',')}`);
  }
  step('planner: real reserves → GATED plan (simulation pending)', true,
    `loan ${fmtUsdc(gated.economics.loanAmount)} USDC · route ${gated.market.route} · net est $${gated.economics.netProfitUsd.toFixed(4)}`);

  /* ── build the real router calldata from the plan ── */
  const scan = scanOpportunities({ chainId: CHAIN_ID, asset: 'USDC', snapshots, now: observedAtMs });
  const best = scan.opportunities.find((o) => o.profitable);
  if (!best) fail('no profitable cycle from real reserves');
  const pairByVenue = { 'rehearsal-pair-1': pair1, 'rehearsal-pair-2': pair2 };
  const buyPair = pairByVenue[best.buyVenue];
  const sellPair = pairByVenue[best.sellVenue];

  const hopsBig = best.hops.map((h) => ({ reserveIn: BigInt(h.reserveIn), reserveOut: BigInt(h.reserveOut), feeBps: h.feeBps }));
  const loan = BigInt(gated.economics.loanAmount);
  const perHopOut = evaluateHops(hopsBig, loan).hops;
  const premiumBps = FLASH_PROVIDER_REGISTRY['balancer-v2'].premiumBps;
  const repay = (loan * (10000n + BigInt(premiumBps))) / 10000n;
  const finalOut = perHopOut[perHopOut.length - 1];
  const grossNet = finalOut - repay;
  const platformFee = (grossNet * 70n) / 10000n;
  const minProfitAsset = grossNet - platformFee - 1n;
  if (minProfitAsset <= 0n) fail('rehearsal scenario is not profitable — increase the divergence');

  const wethAddress = await weth.getAddress();
  const deadline = BigInt(Math.floor(observedAtMs / 1000) + 120);
  const routerIface = new Interface(routerArtifact.abi);
  const hopStructs = [
    { tokenIn: usdcAddress, amountIn: loan, target: await buyPair.getAddress(), callData: '0x', outToken: wethAddress, minOut: BigInt(gated.route.hops[0].minOut) },
    { tokenIn: wethAddress, amountIn: perHopOut[0], target: await sellPair.getAddress(), callData: '0x', outToken: usdcAddress, minOut: BigInt(gated.route.hops[1].minOut) }
  ];
  // calldata runs ON the router, so encode the two pair calls with the router as the beneficiary
  const pairIface = new Interface(world.MiniPair.abi);
  hopStructs[0].callData = pairIface.encodeFunctionData('swapAtoB', [loan, hopStructs[0].minOut, routerAddress, '0x']);
  hopStructs[1].callData = pairIface.encodeFunctionData('swapBtoA', [perHopOut[0], hopStructs[1].minOut, routerAddress, '0x']);
  const execData = routerIface.encodeFunctionData('executeArbitrageBalancer', [
    await vault.getAddress(), [usdcAddress], [loan], hopStructs, minProfitAsset, ownerAddress, deadline
  ]);
  step('router calldata built from plan', true, `2 hops · minProfit ${fmtUsdc(minProfitAsset)} USDC`);

  /* ── GATE: real eth_call simulation BEFORE any signature ── */
  let simBlock = 0;
  try {
    await provider.call({ to: routerAddress, data: execData, from: executorAddress });
    simBlock = await provider.getBlockNumber();
  } catch (error) {
    fail(`simulation of the PROFITABLE plan should pass: ${error.shortMessage || error.message}`);
  }
  step('simulation gate (eth_call) passed', true, `block ${simBlock}`);

  const ready = planFlashArbitrage({
    intent, market,
    config: { ...baseConfig, simulation: { ok: true, blockNumber: simBlock } },
    policy, context: { now: observedAtMs, attemptsToday: 0 }
  });
  if (ready.decision !== 'EXECUTE_READY') fail(`expected EXECUTE_READY, got ${ready.decision}: ${(ready.reasons || []).join(',')}`);
  step('planner: simulation included → EXECUTE_READY', true, 'wallet signature is the only thing left');

  /* ── execute for real: flash loan → hops → repay → profit ── */
  const vaultBefore = await usdc.balanceOf(vaultAddress);
  const profitToBefore = await usdc.balanceOf(ownerAddress);
  const routerUsdcBefore = await usdc.balanceOf(routerAddress);
  const tx = await executor.sendTransaction({ to: routerAddress, data: execData, gasLimit: 3_000_000 });
  const receipt = await tx.wait();
  if (receipt.status !== 1) fail('profitable execution reverted on-chain');
  const vaultAfter = await usdc.balanceOf(vaultAddress);
  const profitToAfter = await usdc.balanceOf(ownerAddress);
  const routerUsdcAfter = await usdc.balanceOf(routerAddress);
  const profitEvent = receipt.logs
    .map((l) => { try { return routerIface.parseLog({ topics: [...l.topics], data: l.data }); } catch { return null; } })
    .find((p) => p && p.name === 'FlashArbitrageExecuted');
  if (!profitEvent) fail('FlashArbitrageExecuted event missing');
  const onChainProfit = profitEvent.args.profit;

  const checks = [
    ['flash loan fully repaid (vault balance unchanged)', vaultAfter === vaultBefore],
    ['router holds nothing after settlement (exact, no dust)', routerUsdcAfter === routerUsdcBefore && routerUsdcAfter === 0n],
    ['profit swept to profitTo', profitToAfter - profitToBefore === onChainProfit],
    ['on-chain profit ≥ on-chain min-profit check', onChainProfit >= minProfitAsset],
    ['profit positive', onChainProfit > 0n]
  ];
  for (const [name, ok] of checks) step(name, ok, ok ? '' : 'FAILED');
  step('ATOMIC SETTLEMENT SUCCEEDED', checks.every(([, ok]) => ok),
    `profit ${fmtUsdc(onChainProfit)} USDC on ${fmtUsdc(loan)} loan · gas ${(Number(receipt.gasUsed) / 1e4 / 100).toFixed(2)}M units`);

  /* ── the honest failure path: greedy plan must be REFUSED ── */
  const greedyData = routerIface.encodeFunctionData('executeArbitrageBalancer', [
    await vault.getAddress(), [usdcAddress], [loan], hopStructs, onChainProfit * 10n + 1n, ownerAddress, deadline
  ]);
  let greedyReverted = false;
  try {
    await provider.call({ to: routerAddress, data: greedyData, from: executorAddress });
  } catch { greedyReverted = true; }
  step('simulation gate refuses the unprofitable variant', greedyReverted, 'INSUFFICIENT_PROFIT — nothing signed, nothing sent');

  const ownerUsdcGreedy = await usdc.balanceOf(ownerAddress);
  let forcedReverted = false;
  try {
    const bad = await executor.sendTransaction({ to: routerAddress, data: greedyData, gasLimit: 3_000_000 });
    const badRc = await bad.wait();
    forcedReverted = badRc.status === 0;
  } catch { forcedReverted = true; }
  const ownerUsdcAfterGreedy = await usdc.balanceOf(ownerAddress);
  const vaultAfterGreedy = await usdc.balanceOf(vaultAddress);
  step('forced unprofitable send reverts atomically — zero loss', forcedReverted && ownerUsdcGreedy === ownerUsdcAfterGreedy && vaultAfterGreedy === vaultAfter,
    'gas is spent, balances untouched: the contract is the guarantee');

  /* ── report ── */
  const report = {
    kind: 'flash-liquidity-rehearsal',
    chainKind: 'local-evm (ganache) — NOT a mainnet fork; sandbox has no chain egress',
    chainIdLabel: CHAIN_ID,
    version: 'level-2.v1',
    router: routerAddress,
    plannerVersionReady: ready.decision,
    loanUsdcBase: loan.toString(),
    route: gated.market.route,
    onChainProfitUsdcBase: onChainProfit.toString(),
    vaultHarness: await vault.getAddress(),
    honestScope: {
      realProductionCode: ['FlashLiquidityRouter.sol', 'flashLiquidity.js planner', 'simulation gate', 'wallet signing flow'],
      localHarnesses: ['MockERC20 tokens', 'FlashVaultHarness (Balancer V2 flash semantics)', 'MiniPair pools (planner-identical formula)'],
      stillRequiredForMainnet: ['independent audit', 'verified Aave/Balancer addresses per chain', 'private relay submission', 'small first real trade']
    },
    steps: STEPS
  };
  const reportPath = path.join(root, 'test/flash-liquidity/rehearsal-report.json');
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n');
  const failed = STEPS.filter((s) => !s.ok);
  console.log(`\nrehearsal: ${STEPS.length - failed.length}/${STEPS.length} checks passed — report at test/flash-liquidity/rehearsal-report.json`);
  process.exitCode = failed.length ? 1 : 0;
} finally {
  if (chain) { try { process.kill(-chain.pid, 'SIGKILL'); } catch { /* already gone */ } }
}
