/**
 * Phase 152 probe — FBT Flash Liquidity (collateral-free flash-loan arbitrage).
 *
 * What must be TRUE:
 *   - provider registry is fail-closed on unverified addresses;
 *   - AMM math is exact (BigInt) and the optimizer matches the 2-pool closed form;
 *   - routes are token-continuity validated;
 *   - the scanner skips stale quotes with explicit reasons;
 *   - the 9-step pipeline refuses to trade when net profit < intent threshold,
 *     and every "ready" plan still requires simulation + wallet signature;
 *   - the server endpoints are dry-run only and validate bounded inputs;
 *   - the compiled reference contract exposes the Aave + Balancer callbacks
 *     and honestly reports NOT audited.
 *
 * What must NEVER be true: guaranteed profit, auto-broadcast, public-mempool
 * arbitrage, or a plan that executes without a wallet signature.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  FLASH_LIQUIDITY_LIMITS,
  FLASH_PROVIDER_REGISTRY,
  DEMO_SNAPSHOTS,
  constantProductOut,
  evaluateHops,
  netProfitAsset,
  closedFormOptimalTwoPool,
  optimalFlashLoanAmount,
  validateHopChain,
  parseFlashIntent,
  normalizeDigits,
  scanOpportunities,
  selectFlashProvider,
  computeEconomics,
  planFlashArbitrage,
  createFlashPolicy,
  flashPolicyAllows,
  buildFlashReceipt,
  receiptFingerprint,
  flashLiquidityCapabilityReport
} from '../../src/lib/intent-ai/flashLiquidity.js';
import { flashLiquidityCapabilities, flashScan, flashPlan } from '../../server/flashLiquidity.js';
import { flashLiquidityRouterConfigured } from '../../server/flashLiquidityConfig.js';
import { createFlashSimulator, simulationRpcFromEnv } from '../../server/flashLiquiditySimulation.js';

const tests = [];
async function test(name, fn) {
  try { await fn(); tests.push({ name, ok: true }); console.log(`✓ ${name}`); }
  catch (error) { tests.push({ name, ok: false }); console.error(`✗ ${name}: ${error.message}`); }
}

const NOW = 1_700_000_000_000;
const SNAP = (a, b, ageMs = 0, feeBps = 30) => ({
  venueId: `v${a}-${b}`,
  reserveA: String(a),
  reserveB: String(b),
  feeBps,
  observedAtMs: NOW - ageMs
});
/* Pool 1 prices B at 1000 A; pool 2 at 1020 A → ~2% spread after both fees. */
const PROFITABLE_SNAPS = [SNAP(2_500_000_000_000n, 2_500_000_000n), SNAP(2_550_000_000_000n, 2_500_000_000n)];
const FLAT_SNAPS = [SNAP(2_500_000_000_000n, 2_500_000_000n), SNAP(2_500_000_500_000n, 2_500_000_000n)];
const MARKET = {
  chainId: 42161,
  asset: 'USDC',
  assetPriceUsd: 1,
  assetDecimals: 6,
  snapshots: PROFITABLE_SNAPS
};
const FULL_CONFIG = {
  gasPriceGwei: 0.01,
  nativePriceUsd: 0.8,
  gasUnits: 650_000,
  platformFeeBps: 70,
  mevBufferBps: 10,
  slippageBps: 30,
  deadlineSeconds: 60,
  providerId: 'balancer-v2',
  simulation: { ok: true, blockNumber: 42_000_000 },
  routerAddress: '0x1111111111111111111111111111111111111111',
  routerAudited: true
};

await test('constant-product math is exact and fee-aware', () => {
  // Hand-checked Uniswap formula: floor( in·(10000−fee)·Rout / (Rin·10000 + in·(10000−fee)) )
  const out = constantProductOut(1_000_000n, 1_000_000_000n, 3_000_000_000n, 30n);
  const g = 9970n; // (10000 − 30)
  const expect = (1_000_000n * g * 3_000_000_000n) / (1_000_000_000n * 10000n + 1_000_000n * g);
  assert.equal(out, expect);
  assert.equal(out, 2_988_020n); // pinned so fee-direction regressions are loud
  // zero/negative guards
  assert.equal(constantProductOut(0n, 100n, 100n, 30n), 0n);
  assert.equal(constantProductOut(10n, 0n, 100n, 30n), 0n);
  assert.equal(constantProductOut(10n, 100n, 100n, 10000n), 0n); // 100% fee = nothing out
  const chain = evaluateHops([
    { assetIn: 'A', assetOut: 'B', reserveIn: 1_000_000n, reserveOut: 3_000_000n, feeBps: 30 },
    { assetIn: 'B', assetOut: 'A', reserveIn: 3_000_000n, reserveOut: 1_000_000n, feeBps: 30 }
  ], 1_000_000n);
  assert.equal(chain.hops.length, 2);
  assert.ok(chain.amountOut > 0n && chain.amountOut < 1_000_000n, 'round trip after 2×0.3% must lose');
});

await test('optimizer matches the 2-pool closed form; identical pools yield zero', () => {
  const hops = PROFITABLE_SNAPS.map((s, i) => ({
    assetIn: i === 0 ? 'A' : 'B',
    assetOut: i === 0 ? 'B' : 'A',
    reserveIn: BigInt(i === 0 ? s.reserveA : s.reserveB),
    reserveOut: BigInt(i === 0 ? s.reserveB : s.reserveA),
    feeBps: s.feeBps
  }));
  const closed = BigInt(Math.floor(closedFormOptimalTwoPool(
    Number(hops[0].reserveIn), Number(hops[0].reserveOut),
    Number(hops[1].reserveIn), Number(hops[1].reserveOut), 30, 0
  )));
  const numeric = optimalFlashLoanAmount(hops, 0);
  const profitClosed = netProfitAsset(closed, hops, 0);
  const profitNumeric = netProfitAsset(numeric, hops, 0);
  assert.ok(profitNumeric >= (profitClosed * 999n) / 1000n, `optimizer (${profitNumeric}) must reach closed form (${profitClosed})`);
  assert.ok(profitNumeric > 0n, 'spread scenario must be profitable before costs');
  // identical prices → no profitable loan size, ever
  const flat = optimalFlashLoanAmount([
    { assetIn: 'A', assetOut: 'B', reserveIn: 1_000_000n, reserveOut: 1_000_000n, feeBps: 30 },
    { assetIn: 'B', assetOut: 'A', reserveIn: 1_000_000n, reserveOut: 1_000_000n, feeBps: 30 }
  ], 0);
  assert.equal(flat, 0n);
});

await test('hop chains are token-validated; mismatched or open routes refuse', () => {
  assert.equal(validateHopChain([
    { assetIn: 'A', assetOut: 'B', reserveIn: 1n, reserveOut: 1n, feeBps: 30 },
    { assetIn: 'B', assetOut: 'A', reserveIn: 1n, reserveOut: 1n, feeBps: 30 }
  ], 'A').ok, true);
  assert.equal(validateHopChain([
    { assetIn: 'A', assetOut: 'B', reserveIn: 1n, reserveOut: 1n, feeBps: 30 },
    { assetIn: 'C', assetOut: 'A', reserveIn: 1n, reserveOut: 1n, feeBps: 30 }
  ], 'A').code, 'HOP_TOKEN_MISMATCH');
  assert.equal(validateHopChain([{ reserveIn: 1n, reserveOut: 1n, feeBps: 30 }], 'A').code, 'HOP_TOKENS_UNLABELED');
  assert.equal(validateHopChain([
    { assetIn: 'A', assetOut: 'B', reserveIn: 1n, reserveOut: 1n, feeBps: 30 },
    { assetIn: 'B', assetOut: 'C', reserveIn: 1n, reserveOut: 1n, feeBps: 30 }
  ], 'A').code, 'ROUTE_DOES_NOT_CLOSE');
});

await test('scanner ranks cycles, skips stale quotes explicitly', () => {
  const scan = scanOpportunities({ chainId: 42161, asset: 'USDC', snapshots: PROFITABLE_SNAPS, now: NOW });
  assert.equal(scan.ok, true);
  assert.ok(scan.opportunities.length === 2); // both directions evaluated
  const best = scan.opportunities[0];
  assert.equal(best.profitable, true);
  assert.ok(BigInt(best.netProfitBeforeCostsAsset) > 0n);
  assert.equal(best.indicative, true);
  const stale = scanOpportunities({
    chainId: 42161, asset: 'USDC', now: NOW,
    snapshots: [SNAP(2_500_000_000_000n, 2_500_000_000n), SNAP(2_550_000_000_000n, 2_500_000_000n, 60_000)]
  });
  assert.equal(stale.opportunities.length, 0);
  assert.ok(stale.skipped.some((s) => s.reason === 'SELL_QUOTE_STALE' || s.reason === 'BUY_QUOTE_STALE'));
  const flat = scanOpportunities({ chainId: 42161, asset: 'USDC', snapshots: FLAT_SNAPS, now: NOW });
  assert.equal(flat.opportunities.every((o) => !o.profitable), true);
});

await test('provider selection is fail-closed on unverified addresses', () => {
  const mainnet = selectFlashProvider({ chainId: 1, assetCount: 1 });
  assert.equal(mainnet.ok, true);
  assert.ok(['aave-v3', 'balancer-v2'].includes(mainnet.provider.id));
  // every Balancer chain address is the canonical Vault
  for (const [chainId, entry] of Object.entries(FLASH_PROVIDER_REGISTRY['balancer-v2'].chains)) {
    if (entry.verified) assert.equal(entry.vault, '0xBA12222222228d8Ba445958a75a0704d566BF2C8', `chain ${chainId}`);
  }
  const unverified = selectFlashProvider({ chainId: 42161, assetCount: 1, prefer: 'aave-v3' });
  assert.equal(unverified.ok, false);
  assert.equal(unverified.code, 'PROVIDER_ADDRESS_UNVERIFIED');
  const forced = selectFlashProvider({ chainId: 42161, assetCount: 1, prefer: 'balancer-v2' });
  assert.equal(forced.ok, true);
  const none = selectFlashProvider({ chainId: 146 });
  assert.equal(none.ok, false);
});

await test('intent parser reads the canonical Persian and English intents', () => {
  const fa = parseFlashIntent('با ۰ سرمایه اولیه، هر آربیتراژی که بعد از Gas + Flash Fee حداقل ۰.۵٪ سود دارد اجرا کن');
  assert.equal(fa.ok, true);
  assert.equal(fa.kind, 'flash-arbitrage');
  assert.equal(fa.zeroCapital, true);
  assert.equal(fa.initialCapital, 0);
  assert.equal(fa.minNetProfitBps, 50);
  assert.equal(fa.atomic, true);
  assert.equal(fa.settlement, 'same-transaction');
  const en = parseFlashIntent('zero initial capital — run flash loan arbitrage with at least 0.5% profit after gas on Arbitrum in USDC');
  assert.equal(en.ok, true);
  assert.equal(en.chainId, 42161);
  assert.equal(en.asset, 'USDC');
  assert.equal(normalizeDigits('۰.۵٪'), '0.5%');
  assert.equal(parseFlashIntent('swap 1 ETH to USDC').ok, false);
  assert.equal(parseFlashIntent('').code, 'EMPTY_INTENT');
});

await test('9-step pipeline: unprofitable intent means NO_TRADE — nothing is sent', () => {
  const result = planFlashArbitrage({
    intent: parseFlashIntent('flash loan arbitrage with at least 1% net profit'),
    market: MARKET,
    config: FULL_CONFIG,
    policy: createFlashPolicy({}),
    context: { now: NOW }
  });
  assert.equal(result.decision, 'NO_TRADE');
  assert.ok(result.reasons.includes('MIN_NET_PROFIT_BPS'));
  const noCycle = planFlashArbitrage({
    intent: parseFlashIntent('flash loan arbitrage 0.5% profit'),
    market: { ...MARKET, snapshots: FLAT_SNAPS },
    config: FULL_CONFIG,
    policy: createFlashPolicy({}),
    context: { now: NOW }
  });
  assert.equal(noCycle.decision, 'NO_TRADE');
  assert.ok(noCycle.reasons.includes('NO_PROFITABLE_CYCLE'));
});

await test('9-step pipeline: profitable plan is GATED until simulation + audited router exist', () => {
  const gated = planFlashArbitrage({
    intent: parseFlashIntent('flash loan arbitrage with at least 0.5% profit'),
    market: MARKET,
    config: { gasPriceGwei: 0.01, nativePriceUsd: 0.8 },
    policy: createFlashPolicy({}),
    context: { now: NOW }
  });
  assert.equal(gated.decision, 'GATED');
  assert.ok(gated.reasons.includes('SIMULATION_PENDING'));
  assert.ok(gated.reasons.includes('ROUTER_CONTRACT_NOT_CONFIGURED'));
  const ready = planFlashArbitrage({
    intent: parseFlashIntent('flash loan arbitrage with at least 0.5% profit'),
    market: MARKET,
    config: FULL_CONFIG,
    policy: createFlashPolicy({}),
    context: { now: NOW }
  });
  assert.equal(ready.decision, 'EXECUTE_READY');
  assert.equal(ready.safety.requiresWalletSignature, true);
  assert.equal(ready.safety.autoBroadcasts, false);
  assert.equal(ready.mev.posture, 'private-relay');
  assert.equal(ready.mev.publicMempoolRefused, true);
  assert.ok(ready.economics.netProfitUsd > 0);
  assert.ok(ready.economics.netProfitBps >= 50);
  // economics subtract flash premium, gas, platform fee and MEV buffer
  const { grossProfitUsd, gasUsd, platformFeeUsd, mevBufferUsd, netProfitUsd } = ready.economics;
  assert.ok(Math.abs((grossProfitUsd - gasUsd - platformFeeUsd - mevBufferUsd) - netProfitUsd) < 1e-9);
});

await test('policy gates: kill switch, caps, attempt budget, simulation required', () => {
  const policy = createFlashPolicy({ maxLoanUsd: 100, maxGasUsd: 25, dailyMaxAttempts: 2, killSwitch: true });
  const blocked = flashPolicyAllows(policy, { economics: { loanUsd: 5000, gasUsd: 1, netProfitUsd: 10, netProfitBps: 60 }, route: { hopCount: 2 } }, { simulationOk: true });
  assert.equal(blocked.allowed, false);
  assert.ok(blocked.blockers.includes('KILL_SWITCH_ENGAGED'));
  assert.ok(blocked.blockers.includes('LOAN_CAP_EXCEEDED'));
  const live = createFlashPolicy({});
  assert.equal(flashPolicyAllows(live, { economics: { loanUsd: 100, gasUsd: 1, netProfitUsd: 1, netProfitBps: 60 }, route: { hopCount: 2 } }, { simulationOk: true }).allowed, true);
  assert.ok(flashPolicyAllows(live, { economics: { loanUsd: 100, gasUsd: 1, netProfitUsd: 1, netProfitBps: 60 }, route: { hopCount: 2 } }, { simulationOk: false }).blockers.includes('SIMULATION_REQUIRED'));
  assert.ok(flashPolicyAllows(live, { economics: { loanUsd: 100, gasUsd: 1, netProfitUsd: 1, netProfitBps: 60 }, route: { hopCount: 2 } }, { simulationOk: true, attemptsToday: 20 }).blockers.includes('DAILY_ATTEMPT_CAP'));
  // the policy floor: nobody can configure a <10 bps requirement
  assert.equal(createFlashPolicy({ minNetProfitBps: 1 }).minNetProfitBps, 10);
  assert.equal(createFlashPolicy({}).promisesFixedProfit, false);
});

await test('economics refuse routes that lose before costs', () => {
  const loss = computeEconomics({
    loanAmount: '1000000',
    hops: [{ assetIn: 'A', assetOut: 'B', reserveIn: 1_000_000n, reserveOut: 1_000_000n, feeBps: 30 },
           { assetIn: 'B', assetOut: 'A', reserveIn: 1_000_000n, reserveOut: 1_000_000n, feeBps: 30 }],
    loanPremiumBps: 5,
    assetPriceUsd: 1, assetDecimals: 6,
    gasUnits: 650_000, gasPriceGwei: 1, nativePriceUsd: 1,
    platformFeeBps: 70, mevBufferBps: 10
  });
  assert.equal(loss.ok, false);
  assert.equal(loss.code, 'ROUTE_NOT_PROFITABLE_BEFORE_COSTS');
});

await test('server surface is dry-run only and bounded', () => {
  const caps = flashLiquidityCapabilities();
  assert.equal(caps.ok, true);
  assert.equal(caps.executionEnabled, false);
  assert.equal(caps.plannerEnabled, true);
  assert.equal(caps.status, 'planner-active');
  assert.equal(caps.limits.serverExecutesTransactions, false);
  assert.equal(caps.limits.autoBroadcasts, false);

  const res = () => {
    const headers = {};
    return {
      status(code) { this.statusCode = code; return this; },
      set(k, v) { headers[k] = v; return this; },
      json(payload) { this.payload = payload; return this; },
      statusCode: 0, payload: null, headers
    };
  };
  const now = Date.now();
  const good = { chainId: 42161, asset: 'USDC', snapshots: PROFITABLE_SNAPS.map((s) => ({ ...s, observedAtMs: now })) };
  const scanned = flashScan({ body: good }, res());
  assert.equal(scanned.payload.ok, true);
  assert.equal(scanned.payload.mode, 'dry-run');
  assert.equal(scanned.payload.broadcasts, false);
  assert.ok(scanned.payload.opportunities.some((o) => o.profitable));

  assert.equal(flashScan({ body: { chainId: 999, snapshots: good.snapshots } }, res()).payload.error, 'UNSUPPORTED_CHAIN');
  assert.equal(flashScan({ body: { chainId: 42161, snapshots: [] } }, res()).payload.error, 'NEED_AT_LEAST_TWO_VENUES');
  assert.equal(flashScan({ body: { chainId: 42161, snapshots: [{ ...good.snapshots[0], reserveA: '-5' }, good.snapshots[1]] } }, res()).payload.error, 'INVALID_SNAPSHOT');

  const planned = flashPlan({
    body: {
      intentText: 'با ۰ سرمایه اولیه، هر آربیتراژی که بعد از Gas + Flash Fee حداقل ۰.۵٪ سود دارد اجرا کن',
      chainId: 42161, asset: 'USDC', assetPriceUsd: 1, assetDecimals: 6, nativePriceUsd: 0.8,
      snapshots: good.snapshots,
      config: { gasPriceGwei: 0.01 }
    }
  }, res());
  assert.equal(planned.payload.ok, true);
  assert.equal(planned.payload.mode, 'dry-run');
  assert.ok(['GATED', 'EXECUTE_READY', 'NO_TRADE'].includes(planned.payload.plan.decision));
  assert.equal(planned.payload.plan.intent.minNetProfitBps, 50);

  assert.equal(flashPlan({ body: { intentText: 'swap eth to usdc' } }, res()).payload.error, 'NOT_FLASH_INTENT');
  assert.equal(flashPlan({ body: { intent: { kind: 'swap' } } }, res()).payload.error, 'BAD_INTENT');
  assert.equal(flashPlan({ body: { intent: { kind: 'flash-arbitrage', minNetProfitBps: 100000 } } }, res()).payload.error, 'BAD_MIN_PROFIT_BPS');
  assert.equal(flashPlan({ body: { intent: { kind: 'flash-arbitrage', minNetProfitBps: 50 } } }, res()).payload.error, 'UNSUPPORTED_CHAIN');
  assert.equal(
    flashPlan({
      body: { intent: { kind: 'flash-arbitrage', minNetProfitBps: 50 }, chainId: 42161, assetPriceUsd: 1, assetDecimals: 6, nativePriceUsd: 0.8, snapshots: good.snapshots }
    }, res()).payload.error,
    'BAD_GAS_PRICE'
  );
});

await test('receipts are content-addressed and outcome-bounded', () => {
  const plan = planFlashArbitrage({
    intent: parseFlashIntent('flash loan arbitrage with at least 0.5% profit'),
    market: MARKET,
    config: FULL_CONFIG,
    policy: createFlashPolicy({}),
    context: { now: NOW }
  });
  const receipt = buildFlashReceipt({ plan, outcome: 'not-sent', now: NOW });
  assert.equal(receipt.ok, true);
  assert.equal(receipt.receipt.outcome, 'not-sent');
  assert.equal(receipt.receipt.notFreeMoney, true);
  assert.equal(receiptFingerprint({ a: 1, b: [2, 3] }), receiptFingerprint({ b: [2, 3], a: 1 }));
  assert.notEqual(receiptFingerprint({ a: 1 }), receiptFingerprint({ a: 2 }));
  assert.equal(buildFlashReceipt({ plan, outcome: 'guaranteed-profit' }).code, 'BAD_OUTCOME');
  const exported = JSON.stringify(receipt.receipt);
  assert.equal(exported.includes('private'), false);
  assert.equal(exported.includes('calldata'), false);
});

await test('flashSourceOverride is attested, not silently trusted', () => {
  const plan = planFlashArbitrage({
    intent: parseFlashIntent('flash loan arbitrage with at least 0.5% profit'),
    market: MARKET,
    config: {
      ...FULL_CONFIG,
      providerId: 'balancer-v2',
      flashSourceOverride: { address: '0x2222222222222222222222222222222222222222', attestedBy: 'rehearsal-vault-harness' }
    },
    policy: createFlashPolicy({}),
    context: { now: NOW }
  });
  assert.equal(plan.decision, 'EXECUTE_READY');
  assert.equal(plan.provider.sourceAddress, '0x2222222222222222222222222222222222222222');
  assert.equal(plan.provider.sourceAttestedBy, 'rehearsal-vault-harness');
  assert.equal(plan.provider.sourceVerified, true); // registry chain entry stays as-is
  // an override without an attestation label is refused (ignored, canonical address kept)
  const sneaky = planFlashArbitrage({
    intent: parseFlashIntent('flash loan arbitrage with at least 0.5% profit'),
    market: MARKET,
    config: { ...FULL_CONFIG, providerId: 'balancer-v2', flashSourceOverride: { address: '0x3333333333333333333333333333333333333333' } },
    policy: createFlashPolicy({}),
    context: { now: NOW }
  });
  assert.equal(sneaky.provider.sourceAddress, '0xBA12222222228d8Ba445958a75a0704d566BF2C8');
  assert.equal(sneaky.provider.sourceAttestedBy, undefined);
});

await test('simulation gate: eth_call dry-run with honest pass/revert/refusal', async () => {
  // not configured → explicit refusal, never a fake pass
  const off = createFlashSimulator({});
  assert.equal(off.configured, false);
  assert.equal((await off.simulate({ to: '0x1111111111111111111111111111111111111111', data: '0x' })).code, 'SIMULATION_RPC_NOT_CONFIGURED');
  // injected provider: pass path
  const pass = createFlashSimulator({ provider: { call: async () => '0x', getBlockNumber: async () => 4_200_000 } });
  assert.equal(pass.configured, true);
  const ok = await pass.simulate({ to: '0x1111111111111111111111111111111111111111', data: '0xdeadbeef' });
  assert.equal(ok.ok, true);
  assert.equal(ok.simulated, true);
  assert.equal(ok.broadcasts, false);
  assert.equal(ok.blockNumber, 4_200_000);
  // injected provider: revert path surfaces the reason
  const fail = createFlashSimulator({ provider: { call: async () => { throw Object.assign(new Error('execution reverted'), { shortMessage: 'execution reverted: INSUFFICIENT_PROFIT' }); }, getBlockNumber: async () => 1 } });
  const bad = await fail.simulate({ to: '0x1111111111111111111111111111111111111111', data: '0xdeadbeef' });
  assert.equal(bad.ok, false);
  assert.ok(/INSUFFICIENT_PROFIT/.test(bad.revertReason));
  // bounded inputs
  assert.equal((await pass.simulate({ to: 'not-an-address', data: '0x' })).code, 'BAD_TARGET');
  assert.equal((await pass.simulate({ to: '0x1111111111111111111111111111111111111111', data: 'zz' })).code, 'BAD_DATA');
  assert.equal((await pass.simulate({ to: '0x1111111111111111111111111111111111111111', data: '0x', from: '0xnope' })).code, 'BAD_FROM');
  // env parsing: https anywhere, http only on loopback
  assert.equal(simulationRpcFromEnv({ FLASH_LIQUIDITY_SIMULATION_RPC: 'https://rpc.example.com' }), 'https://rpc.example.com');
  assert.equal(simulationRpcFromEnv({ FLASH_LIQUIDITY_SIMULATION_RPC: 'http://127.0.0.1:8545' }), 'http://127.0.0.1:8545');
  assert.equal(simulationRpcFromEnv({ FLASH_LIQUIDITY_SIMULATION_RPC: 'http://rpc.example.com' }), null);
  assert.equal(simulationRpcFromEnv({}), null);
});

await test('capability report keeps the planner active while wallet execution waits for audit + config', () => {
  const bare = flashLiquidityCapabilityReport({});
  assert.equal(bare.executionEnabled, false);
  assert.equal(bare.plannerEnabled, true);
  assert.equal(bare.status, 'planner-active');
  assert.ok(bare.executionPrerequisites.includes('ROUTER_CONTRACT_NOT_AUDITED'));
  const full = flashLiquidityCapabilityReport({ routerConfigured: true, routerAudited: true, simulationAvailable: true });
  assert.equal(full.status, 'execution-gated-by-wallet');
  assert.equal(full.guaranteedProfit, false);
  assert.equal(full.notFreeMoney, true);
  // and the constant is not negotiable at runtime
  assert.equal(Object.isFrozen(FLASH_LIQUIDITY_LIMITS), true);
});

await test('router config accepts a single address env as well as the chain map', () => {
  const single = flashLiquidityRouterConfigured({
    FLASH_LIQUIDITY_ROUTER_ADDRESS: '0x1111111111111111111111111111111111111111',
    FLASH_LIQUIDITY_ROUTER_CHAIN_ID: '42161',
    FLASH_LIQUIDITY_ROUTER_AUDITED: 'true'
  });
  assert.equal(single.configured, true);
  assert.equal(single.audited, true);
  assert.equal(single.addresses[42161], '0x1111111111111111111111111111111111111111');
});

await test('compiled reference contract exposes both provider callbacks and admits it is unaudited', () => {
  const artifactPath = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'src', 'lib', 'flashLiquidityRouterArtifact.json');
  const artifact = JSON.parse(fs.readFileSync(artifactPath, 'utf8'));
  const names = artifact.abi.filter((x) => x.type === 'function').map((x) => x.name);
  for (const required of ['executeOperation', 'receiveFlashLoan', 'executeArbitrageAave', 'executeArbitrageBalancer', 'rescue']) {
    assert.ok(names.includes(required), `missing ${required} in ABI`);
  }
  assert.equal(artifact.audited, false);
  assert.ok(/audit/i.test(artifact.notAuditedNotice));
  assert.ok(artifact.bytecode.startsWith('0x'));
});

await test('demo snapshots are honestly labeled educational data', () => {
  assert.equal(DEMO_SNAPSHOTS.live, false);
  assert.equal(DEMO_SNAPSHOTS.label, 'demo-educational');
  assert.ok(DEMO_SNAPSHOTS.sets.flat.length >= 2);
});

let failed = 0;
for (const t of tests) if (!t.ok) failed += 1;
console.log(`\nphase152-flash-liquidity: ${tests.length - failed}/${tests.length} passed`);
process.exit(failed > 0 ? 1 : 0);
