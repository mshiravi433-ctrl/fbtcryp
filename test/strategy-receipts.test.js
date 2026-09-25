import { describe, expect, it } from 'vitest';
import { Interface, parseUnits } from 'ethers';
import { AAVE_V3_POOLS, lendingAssetsFor } from '../src/lib/lending.js';
import { TOKENS } from '../src/lib/chains.js';
import { STRATEGY_STORE_KEY, saveStrategyPlan, loadStrategyPlan, hydrateRuntimeArgs } from '../src/lib/strategyBrain/strategyStore.js';
import { createStrategyRuntime } from '../src/lib/strategyBrain/strategyRuntime.js';
import {
  STRATEGY_RECEIPT_HINTS_KEY, recordStrategyReceiptHint, reconcileStrategyReceipts,
  strategyActionRoute, strategyReceiptSupport, verifyAaveStrategySupply, verifyStrategySwap
} from '../src/lib/strategyBrain/strategyReceipts.js';

const owner = '0x1111111111111111111111111111111111111111';
const hash = (char) => `0x${char.repeat(64)}`;
const call = new Interface(['function supply(address asset,uint256 amount,address onBehalfOf,uint16 referralCode)']);
// The actual Aave Pool event indexes referralCode as well as reserve and onBehalfOf.
const event = new Interface(['event Supply(address indexed reserve,address user,address indexed onBehalfOf,uint256 amount,uint16 indexed referralCode)']);
const transfer = new Interface(['event Transfer(address indexed from,address indexed to,uint256 value)']);
const swap = { module: 'swap', operation: 'BUY', capabilityId: 'swap.quote', requiresSignature: true,
  route: '/swap?from=USDC&to=LINK&amount=250&chain=1',
  params: { venue: 'ethereum', asset: 'LINK', chainId: 1, amountUsd: 250 } };
const storage = () => {
  const map = new Map();
  return { getItem: (k) => map.get(k) || null, setItem: (k, v) => map.set(k, v) };
};
const action = (chainId, venue, amountUsd = 250) => ({
  module: 'lending', operation: 'SUPPLY', route: `/loan?tab=supply&asset=USDC&chain=${chainId}&amount=${amountUsd}`,
  capabilityId: 'lending.supply', requiresSignature: true,
  params: { asset: 'USDC', chainId, amountUsd, venue }
});
const base = action(8453, 'aave-base');
const arb = action(42161, 'aave-arbitrum');
const strategy = (actions = [base]) => ({
  ok: true, strategyId: 'strat_test_receipt', goal: { capitalUsd: 1000 },
  stages: [{ id: 'preflight', movesFunds: false, actions: [] },
    { id: 'deploy-yield', movesFunds: true, actions }]
});
const makeProvider = ({ chainId = 8453, txHash = hash('a'), from = owner,
  supplyWei = parseUnits('250', 6), eventWei = supplyWei, minedAt = Date.now(),
  status = 1, omitEvent = false, to = AAVE_V3_POOLS[chainId], asset = lendingAssetsFor(chainId).find((a) => a.symbol === 'USDC').address } = {}) => {
  const encoded = event.encodeEventLog(event.getEvent('Supply'), [asset, from, owner, eventWei, 0]);
  const receipt = { hash: txHash, blockNumber: 1234, status, from, to,
    logs: omitEvent ? [] : [{ address: to, topics: encoded.topics, data: encoded.data }] };
  const tx = { hash: txHash, from, to, data: call.encodeFunctionData('supply', [asset, supplyWei, owner, 0]) };
  return {
    getNetwork: async () => ({ chainId: BigInt(chainId) }),
    getTransactionReceipt: async () => receipt,
    getTransaction: async () => tx,
    getBlock: async () => ({ timestamp: Math.floor(minedAt / 1000) })
  };
};
const makeSwapProvider = ({ chainId = 1, from = owner, paid = parseUnits('250', 6),
  acquired = parseUnits('8', 18), omitOutput = false, minedAt = Date.now(), txHash = hash('c') } = {}) => {
  const router = '0x3333333333333333333333333333333333333333';
  const pool = '0x4444444444444444444444444444444444444444';
  const [usdc, link] = ['USDC', 'LINK'].map((s) => TOKENS[1].find((t) => t.symbol === s));
  const log = (address, fromAddr, toAddr, amount) => {
    const encoded = transfer.encodeEventLog(transfer.getEvent('Transfer'), [fromAddr, toAddr, amount]);
    return { address, topics: encoded.topics, data: encoded.data };
  };
  return {
    getNetwork: async () => ({ chainId: BigInt(chainId) }),
    getTransaction: async () => ({ hash: txHash, from, to: router, data: '0xaabbccdd' }),
    getTransactionReceipt: async () => ({ status: 1, hash: txHash, blockNumber: 5300,
      from, to: router, logs: [log(usdc.address, from, router, paid),
        ...(omitOutput ? [] : [log(link.address, pool, owner, acquired)])] }),
    getBlock: async () => ({ timestamp: Math.floor(minedAt / 1000) })
  };
};
const saveRunning = (store, plan) => saveStrategyPlan({
  store, strategy: plan,
  runtime: { stageProgress: { preflight: { state: 'CONFIRMED' }, 'deploy-yield': { state: 'RUNNING', startedAt: Date.now() - 2_000 } } }
});

describe('strategy venue receipt reconciliation', () => {
  it('binds a staged loan route to action identity without treating its query as proof', () => {
    const route = strategyActionRoute(base, { strategyId: 'strat_test_receipt', stageId: 'deploy-yield', actionIndex: 0 });
    expect(route).toContain('actionIndex=0');
    expect(route).toContain('strategyId=strat_test_receipt');
    expect(route).toContain('asset=USDC');
    expect(strategyActionRoute(base, { strategyId: 's', stageId: 'd', actionIndex: -1 })).toBe(base.route);
    expect(strategyReceiptSupport(base)).toBe('aave-supply');
    expect(strategyReceiptSupport({ ...base, params: { ...base.params, amountUsd: null } })).toBeNull();
    expect(strategyReceiptSupport({ ...base, route: base.route.replace('asset=USDC', 'asset=DAI') })).toBeNull();
    expect(strategyReceiptSupport({ ...base, route: base.route.replace('amount=250', 'amount=2500') })).toBeNull();
    expect(strategyReceiptSupport(swap)).toBe('erc20-swap');
    expect(strategyReceiptSupport({ ...swap, route: swap.route.replace('amount=250', 'amount=2500') })).toBeNull();
    expect(strategyReceiptSupport({ ...swap, route: swap.route.replace('LINK', 'ETH'),
      params: { ...swap.params, asset: 'ETH' } })).toBeNull();
    expect(strategyReceiptSupport({ ...base, capabilityId: 'bridge.quote', route: '/bridge' })).toBeNull();
  });

  it('records only a mined venue action with the correct stage, asset, chain and expected input', () => {
    const store = storage();
    const plan = strategy();
    saveRunning(store, plan);
    expect(loadStrategyPlan(plan.strategyId, { store }).strategy.stages[1].actions[0].requiresSignature).toBe(true);
    const record = (override = {}) => recordStrategyReceiptHint({ store, strategyId: plan.strategyId,
      stageId: 'deploy-yield', actionIndex: 0, txHash: hash('a'), owner, chainId: 8453,
      asset: 'USDC', amountWei: String(parseUnits('250', 6)), ...override });
    expect(record({ amountWei: '1' }).ok).toBe(false);
    expect(record({ chainId: 1 }).ok).toBe(false);
    expect(record({ asset: 'DAI' }).ok).toBe(false);
    expect(record({ stageId: 'preflight' }).ok).toBe(false);
    expect(record({ txHash: 'done' }).ok).toBe(false);
    expect(record()).toMatchObject({ ok: true });
    expect(JSON.parse(store.getItem(STRATEGY_RECEIPT_HINTS_KEY))).toHaveLength(1);
  });

  it('resumes older saved engine stages whose public signature-requirement flag was scrubbed', async () => {
    const store = storage();
    const plan = strategy();
    saveRunning(store, plan);
    const disk = JSON.parse(store.getItem(STRATEGY_STORE_KEY));
    delete disk.plans[0].strategy.stages[1].actions[0].requiresSignature;
    store.setItem(STRATEGY_STORE_KEY, JSON.stringify(disk));
    expect(loadStrategyPlan(plan.strategyId, { store }).strategy.stages[1].actions[0].requiresSignature).toBe(true);
    const hint = recordStrategyReceiptHint({ store, strategyId: plan.strategyId,
      stageId: 'deploy-yield', actionIndex: 0, txHash: hash('a'), owner, chainId: 8453,
      asset: 'USDC', amountWei: String(parseUnits('250', 6)) });
    expect(hint.ok).toBe(true);
    expect((await reconcileStrategyReceipts({ strategy: plan, stageId: 'deploy-yield', owner, store,
      getProvider: async () => makeProvider() })).ok).toBe(true);
  });

  it('checks tx sender, chain, calldata, asset, input size and the emitted protocol event', async () => {
    const check = (provider, expectedAction = base) => verifyAaveStrategySupply({
      provider, action: expectedAction, owner, txHash: hash('a')
    });
    expect((await makeProvider().getTransactionReceipt(hash('a'))).logs[0].topics).toHaveLength(4);
    expect(await check(makeProvider())).toMatchObject({ ok: true, txHash: hash('a'), chainId: 8453 });
    expect((await check(makeProvider({ status: 0 }))).ok).toBe(false);
    expect((await check(makeProvider({ from: '0x2222222222222222222222222222222222222222' }))).ok).toBe(false);
    expect((await check(makeProvider({ supplyWei: parseUnits('1', 6) }))).ok).toBe(false);
    expect((await check(makeProvider({ omitEvent: true }))).ok).toBe(false);
    expect((await check(makeProvider({ eventWei: parseUnits('249', 6) }))).ok).toBe(false);
    expect((await check(makeProvider({ chainId: 42161 }))).ok).toBe(false);
  });

  it('verifies an exact-wallet USDC-to-curated-ERC20 swap with both token flows', async () => {
    const check = (provider, expectedAction = swap) => verifyStrategySwap({
      action: expectedAction, txHash: hash('c'), owner, provider
    });
    expect(await check(makeSwapProvider())).toMatchObject({ ok: true, verified: true,
      capabilityId: 'swap.quote', amountWei: String(parseUnits('250', 6)), acquiredWei: String(parseUnits('8', 18)) });
    expect((await check(makeSwapProvider({ omitOutput: true }))).code).toBe('SWAP_OUTPUT_MISSING');
    expect((await check(makeSwapProvider({ paid: parseUnits('1', 6) }))).code).toBe('SWAP_INPUT_MISMATCH');
    expect((await check(makeSwapProvider({ acquired: 0n }))).code).toBe('SWAP_OUTPUT_MISSING');
    expect((await check(makeSwapProvider({ from: '0x2222222222222222222222222222222222222222' }))).ok).toBe(false);
    expect((await check(makeSwapProvider({ chainId: 8453 }))).ok).toBe(false);
    expect((await check(makeSwapProvider(), { ...swap, route: swap.route.replace('LINK', 'ETH'),
      params: { ...swap.params, asset: 'ETH' } })).code).toBe('UNSUPPORTED_ACTION');
  });

  it('records the swap only under its planned output and re-reads real logs after return', async () => {
    const store = storage();
    const plan = strategy([swap]);
    saveRunning(store, plan);
    const hint = (asset) => recordStrategyReceiptHint({ store, strategyId: plan.strategyId,
      stageId: 'deploy-yield', actionIndex: 0, txHash: hash('c'), owner, chainId: 1,
      asset, amountWei: String(parseUnits('250', 6)) });
    expect(hint('ETH').ok).toBe(false);
    expect(hint('LINK').ok).toBe(true);
    const reconcile = (provider) => reconcileStrategyReceipts({ strategy: plan,
      stageId: 'deploy-yield', owner, store, getProvider: async () => provider });
    expect(await reconcile(makeSwapProvider())).toMatchObject({ ok: true,
      receipt: { actions: [{ verified: true, asset: 'LINK', txHash: hash('c') }] } });
    expect(await reconcile(makeSwapProvider({ omitOutput: true }))).toMatchObject({ ok: false,
      missing: [{ actionIndex: 0, code: 'SWAP_OUTPUT_MISSING' }] });
  });

  it('rejects an old matching deposit even with a matching event and a forged local hint', async () => {
    const store = storage();
    const plan = strategy();
    saveRunning(store, plan);
    recordStrategyReceiptHint({ store, strategyId: plan.strategyId,
      stageId: 'deploy-yield', actionIndex: 0, txHash: hash('a'), owner,
      chainId: 8453, asset: 'USDC', amountWei: String(parseUnits('250', 6)) });
    const reconciled = await reconcileStrategyReceipts({ strategy: plan,
      stageId: 'deploy-yield', owner, store,
      getProvider: async () => makeProvider({ minedAt: Date.now() - 3600_000 }) });
    expect(reconciled).toMatchObject({ ok: false,
      missing: [{ actionIndex: 0, code: 'TRANSACTION_BEFORE_STAGE' }] });
  });

  it('never unlocks on one leg of two or on a forged local verified flag; all legs are rechecked', async () => {
    const store = storage();
    const plan = strategy([base, arb]);
    saveRunning(store, plan);
    const first = recordStrategyReceiptHint({ store, strategyId: plan.strategyId,
      stageId: 'deploy-yield', actionIndex: 0, txHash: hash('a'), owner,
      chainId: 8453, asset: 'USDC', amountWei: String(parseUnits('250', 6)) });
    expect(first).toMatchObject({ ok: true });
    let reads = 0;
    const getProvider = async (chainId) => { reads += 1; return makeProvider({ chainId, txHash: hash(chainId === 8453 ? 'a' : 'b') }); };
    const input = { strategy: plan, stageId: 'deploy-yield', owner, getProvider, store };
    expect(await reconcileStrategyReceipts(input)).toMatchObject({ ok: false, verifiedCount: 1, requiredCount: 2,
      missing: [{ actionIndex: 1, code: 'RECEIPT_HINT_MISSING' }] });
    recordStrategyReceiptHint({ store, strategyId: plan.strategyId,
      stageId: 'deploy-yield', actionIndex: 1, txHash: hash('b'), owner,
      chainId: 42161, asset: 'USDC', amountWei: String(parseUnits('250', 6)) });
    const result = await reconcileStrategyReceipts(input);
    expect(result).toMatchObject({ ok: true, receipt: { verified: true,
      actions: [{ capabilityId: 'lending.supply', txHash: hash('a') }, { capabilityId: 'lending.supply', txHash: hash('b') }] } });
    expect(reads).toBe(3); // first checked twice, second once; no cached trust
    const forged = JSON.parse(store.getItem(STRATEGY_RECEIPT_HINTS_KEY));
    forged[0].txHash = hash('f');
    forged[0].verified = true;
    store.setItem(STRATEGY_RECEIPT_HINTS_KEY, JSON.stringify(forged));
    expect((await reconcileStrategyReceipts(input)).ok).toBe(false);
  });

  it('after reload rechecks preflight and provider proof rather than trusting a saved CONFIRMED stage', async () => {
    const store = storage();
    const plan = strategy();
    saveRunning(store, plan);
    recordStrategyReceiptHint({ store, strategyId: plan.strategyId,
      stageId: 'deploy-yield', actionIndex: 0, txHash: hash('a'), owner,
      chainId: 8453, asset: 'USDC', amountWei: String(parseUnits('250', 6)) });
    const read = () => reconcileStrategyReceipts({ strategy: plan,
      stageId: 'deploy-yield', owner, store, getProvider: async () => makeProvider() });
    const before = await read();
    const resumed = createStrategyRuntime(hydrateRuntimeArgs(loadStrategyPlan(plan.strategyId, { store })));
    expect(resumed.nextStage().stage.id).toBe('preflight');
    resumed.advance();
    expect(resumed.confirmStage('preflight', { receipt: { ok: true, kind: 'fresh-check' } }).ok).toBe(true);
    expect(resumed.nextStage()).toMatchObject({ ok: false, code: 'AWAITING_RECEIPT', stageId: 'deploy-yield' });
    saveStrategyPlan({ strategy: plan, runtime: resumed.state(), store });
    const checked = await read();
    expect(checked.ok).toBe(true);
    expect(resumed.confirmStage('deploy-yield', { receipt: checked.receipt }).ok).toBe(true);
    saveStrategyPlan({ strategy: plan, runtime: resumed.state(), store });
    const secondReload = createStrategyRuntime(hydrateRuntimeArgs(loadStrategyPlan(plan.strategyId, { store })));
    expect(secondReload.nextStage().stage.id).toBe('preflight');
    secondReload.advance();
    secondReload.confirmStage('preflight', { receipt: { ok: true, kind: 'fresh-check' } });
    expect(secondReload.nextStage()).toMatchObject({ ok: false, code: 'AWAITING_RECEIPT', stageId: 'deploy-yield' });
    expect(before.ok).toBe(true);
  });
});
