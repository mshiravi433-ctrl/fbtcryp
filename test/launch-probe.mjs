/**
 * FBT LAUNCH — pure-logic probe (no DOM, no network).
 * ---------------------------------------------------------------------------
 * Pins the parts of the launch module that are unforgivable to get wrong:
 *
 *   · spec validation (§ token rules — no silent defaults)
 *   · capability bitmaps (§ advanced powers are pre-disclosed & permanent)
 *   · the deterministic risk engine (§ 0–100, fatal gates)
 *   · fee transparency (v1 = 0, computed before signing)
 *   · calldata byte-exactness (decoded args must equal the intent — the
 *     API, the SDK and the app share one builder)
 *   · the state machine (§ DRAFT → … → LIVE, partial-failure honesty,
 *     retry without re-creating the token)
 *   · history sanitization (§ DB/localStorage never sees sensitive fields)
 *
 * Runs at import time with node:assert and is wired into test/run.mjs.
 */
import assert from 'node:assert/strict';
import {
  validateTokenSpec, capsToBitmap, CAPABILITIES
} from '../src/lib/launch/capabilities.js';
import { scoreLaunch, RISK_BANDS } from '../src/lib/launch/risk.js';
import { computeLaunchFee, LAUNCH_FEES } from '../src/lib/launch/fees.js';
import { LAUNCH_CHAINS, LAUNCH_DEX, SOLANA_LAUNCH_STATUS } from '../src/lib/launch/networks.js';
import * as engine from '../src/lib/launch/engine.js';
import {
  buildLaunchPlan, buildTokenCreateTx, parseTokenCreatedLog,
  FACTORY_ABI, minWithSlippage
} from '../src/lib/launch/calldata.js';
import { sanitizeRecord } from '../src/lib/launch/history.js';
import artifact from '../src/lib/launch/artifacts.js';
import { ethers } from 'ethers';

const t = (name, ok) => {
  assert.ok(ok, name);
  console.log(`✓ ${name}`);
};

/* ── spec validation ─────────────────────────────────────────────────────── */

const goodSpec = validateTokenSpec({ name: 'FBT Gold', symbol: 'FBTG', decimals: 18, supply: '1000000000' });
t('spec: valid token passes', goodSpec.ok === true);
t('spec: supply human is preserved', goodSpec.value.supplyHuman === '1000000000');
t('spec: supply wei is a bigint-sized decimal string', /^\d+$/.test(goodSpec.value.supplyWei) && goodSpec.value.supplyWei === '1000000000' + '0'.repeat(18));

t('spec: empty name rejected', validateTokenSpec({ name: '', symbol: 'X', decimals: 18, supply: '1000' }).ok === false);
t('spec: bad symbol chars rejected', validateTokenSpec({ name: 'A', symbol: 'a!b', decimals: 18, supply: '1000' }).ok === false);
t('spec: negative supply rejected', validateTokenSpec({ name: 'A', symbol: 'A', decimals: 18, supply: '-5' }).ok === false);
t('spec: non-integer supply rejected', validateTokenSpec({ name: 'A', symbol: 'A', decimals: 18, supply: '1.23' }).ok === false);
t('spec: decimals > 18 rejected', validateTokenSpec({ name: 'A', symbol: 'A', decimals: 24, supply: '1000' }).ok === false);
t('spec: zero supply rejected', validateTokenSpec({ name: 'A', symbol: 'A', decimals: 18, supply: '0' }).ok === false);

/* ── capabilities ────────────────────────────────────────────────────────── */

t('capabilities: basic token → bitmap 0', capsToBitmap({}) === 0 && capsToBitmap({ mintable: false }) === 0);
t('capabilities: all flags → bitmap 31', capsToBitmap({ mintable: true, burnable: true, pausable: true, maxWallet: true, maxTx: true }) === 31);
t('capabilities: unknown key rejected', validateTokenSpec({ name: 'A', symbol: 'A', decimals: 18, supply: '1', caps: { evil: true } }).ok === false);
t('capabilities: exactly five flags exist', CAPABILITIES.length === 5);
t('capabilities: every flag has a disclosure label', CAPABILITIES.every((c) => c.labelKey && c.warnKey));

/* ── risk engine ─────────────────────────────────────────────────────────── */

const baseInput = {
  capabilities: 0n, decimals: 18, supplyWei: '1000000000' + '0'.repeat(18),
  tokenAmount: '100000', quoteAmount: '100000', quoteDecimals: 18,
  dexVerified: true, factoryReady: true, lpqToUser: true
};
const lowRisk = scoreLaunch(baseInput);
t('risk: basic token + sane liquidity = low band', lowRisk.band === 'low' && lowRisk.score < 30);
t('risk: basic token gets the no-tax/no-blacklist positive finding',
  lowRisk.findings.some((f) => f.id === 'noTaxNoBlacklist' && f.weight === 0));

const highRisk = scoreLaunch({ ...baseInput, capabilities: 31n, quoteAmount: '500' });
t('risk: all owner powers + thin liquidity = high/critical',
  ['high', 'critical'].includes(highRisk.band) && highRisk.score >= 70);
t('risk: thin liquidity finding present', highRisk.findings.some((f) => f.id === 'thinLiquidity'));
t('risk: mintable finding present with +20',
  (() => { const f = highRisk.findings.find((x) => x.id === 'mintable'); return f && f.weight === 20; })());

t('risk: unverified DEX is a FATAL gate (blocked)', (() => {
  const r = scoreLaunch({ ...baseInput, dexVerified: false });
  return r.blocked === true && r.gates.some((g) => g.id === 'dexUnverified');
})());
t('risk: missing factory is a FATAL gate (blocked)', (() => {
  const r = scoreLaunch({ ...baseInput, factoryReady: false });
  return r.blocked === true && r.gates.some((g) => g.id === 'factoryNotDeployed');
})());
t('risk: both fatal gates carry user-facing i18n keys', (() => {
  const r = scoreLaunch({ ...baseInput, dexVerified: false, factoryReady: false });
  return r.gates.length === 2 && r.gates.every((g) => typeof g.key === 'string' && g.fatal === true);
})());
t('risk: bands are the five fixed ranges (spec §17)',
  RISK_BANDS.map((b) => b.id).join(',') === 'low,moderate,elevated,high,critical');
t('risk: lpOwnedByCreator is a disclosed finding (not hidden)',
  scoreLaunch(baseInput).findings.some((f) => f.id === 'lpOwnedByCreator'));

/* ── fees ────────────────────────────────────────────────────────────────── */

t('fees: v1 launch fee is 0 bps', LAUNCH_FEES.launchFeeBps === 0);
t('fees: 0 bps ⇒ zero fee at any amount', computeLaunchFee('1234567') === '0');
t('fees: 100 bps of 10000 = 100', computeLaunchFee('10000', 100) === '100');
t('fees: fee is a stable decimal string (client/server identical)', typeof computeLaunchFee('10000', 100) === 'string');
t('fees: swap fee is the existing 0.70% platform fee', LAUNCH_FEES.swapFeeBps === 70);

/* ── networks ────────────────────────────────────────────────────────────── */

t('networks: phase-1 EVM set is the spec set',
  [8453, 56, 42161, 137, 1].every((id) => LAUNCH_CHAINS.includes(id)));
t('networks: every chain has a DEX registry entry (factory + anchor pair)',
  LAUNCH_CHAINS.every((id) => LAUNCH_DEX[id] && LAUNCH_DEX[id].factory && LAUNCH_DEX[id].anchor));
t('networks: anchor entries are 40-hex addresses (token a, token b)',
  LAUNCH_CHAINS.every((id) => {
    const d = LAUNCH_DEX[id];
    return /^0x[0-9a-fA-F]{40}$/.test(d.factory) && /^0x[0-9a-fA-F]{40}$/.test(d.anchor.a) && /^0x[0-9a-fA-F]{40}$/.test(d.anchor.b);
  }));
t('networks: fee tiers are within the V2 1–120 bps sanity band',
  LAUNCH_CHAINS.every((id) => LAUNCH_DEX[id].feeTierBps >= 1 && LAUNCH_DEX[id].feeTierBps <= 120));
t('networks: solana is an honest coming-soon slot (not silently shipped)',
  typeof SOLANA_LAUNCH_STATUS === 'string' && /COMING/i.test(SOLANA_LAUNCH_STATUS));

/* ── calldata: byte-exactness ────────────────────────────────────────────── */

const coder = new ethers.AbiCoder();
const factoryIface = new ethers.Interface(FACTORY_ABI);
const tokenIface = new ethers.Interface(artifact.contracts.FBTBasicToken.abi);

const createTx = await buildTokenCreateTx({ factoryAddress: '0x' + '11'.repeat(20), spec: goodSpec.value });
const [cfg] = factoryIface.decodeFunctionData('createToken', createTx.data);
t('calldata: createToken data decodes to the exact intent (tuple field by field)',
  cfg.name === goodSpec.value.name && cfg.symbol === goodSpec.value.symbol &&
  Number(cfg.decimals) === goodSpec.value.decimals && cfg.initialSupply === BigInt(goodSpec.value.supplyWei) &&
  cfg.capabilities === 0n);
t('calldata: createToken targets the factory and costs nothing (token mints to caller)',
  createTx.to.toLowerCase() === '0x' + '11'.repeat(20) && createTx.value === '0');

t('calldata: slippage floor is exact (floor division)', minWithSlippage('10000', 100) === 9900n);
t('calldata: slippage 0 = unchanged', minWithSlippage('12345', 0) === 12345n);

const usdt = { symbol: 'USDT', name: 'Tether USD', address: '0x' + '55'.repeat(20), decimals: 6, native: false };
const bnb = { symbol: 'BNB', name: 'BNB', address: null, decimals: 18, native: true };

const planA = await buildLaunchPlan({
  chainId: 56,
  factoryAddress: '0x' + '11'.repeat(20),
  spec: { ...goodSpec.value },
  quote: usdt,
  tokenAmount: '100000', quoteAmount: '10000',
  slippageBps: 100,
  creator: '0x' + '22'.repeat(20)
});
t('plan: phase one = token + deferred pool (honest two-phase)',
  planA.phase === 'token' &&
  planA.steps.map((s) => s.id).join(',') === 'create-token,deferred-pool');
t('plan: signatureOrder is the full intended order',
  planA.signatureOrder.join('|') === 'token.create|pool.create|liquidity.approve|liquidity.approveQuote|liquidity.add');
t('plan: deferred step carries the intent (no fake zero-address bytes)',
  planA.steps[1].deferred === true && planA.steps[1].intent && !planA.steps[1].data);

const planB = await buildLaunchPlan({
  chainId: 56,
  spec: null,
  tokenAddress: '0x' + '33'.repeat(20),
  quote: usdt,
  tokenAmount: '100000', quoteAmount: '10000',
  slippageBps: 100,
  creator: '0x' + '22'.repeat(20),
  createPairNeeded: true
});
t('plan: phase two = full liquidity steps',
  planB.phase === 'pool' &&
  planB.steps.map((s) => s.id).join(',') === 'approve-token,approve-quote,create-pair,add-liquidity');

const approveDecoded = factoryIface ? tokenIface.decodeFunctionData('approve', planB.steps[0].data) : null;
t('plan: approve(token→router) decodes to exact amounts',
  approveDecoded[0].toLowerCase() === planB.dex.router.toLowerCase() && approveDecoded[1] === 100000n * 10n ** 18n);
t('plan: addLiquidity min = amount × (10000−slippage)/10000 (floor)',
  BigInt(planB.summary.tokenMin) === (100000n * 10n ** 18n * 9900n) / 10000n &&
  BigInt(planB.summary.quoteMin) === (10000n * 10n ** 6n * 9900n) / 10000n);
// LP recipient + deadline live inside the addLiquidity calldata itself —
// decode them back and compare against the intent.
{
  const add = planB.steps.find((s) => s.id === 'add-liquidity');
  const addIface = new ethers.Interface([
    'function addLiquidity(address tokenA, address tokenB, uint256 amountADesired, uint256 amountBDesired, uint256 amountAMin, uint256 amountBMin, address to, uint256 deadline)'
  ]);
  const dec = addIface.decodeFunctionData('addLiquidity', add.data);
  t('plan: addLiquidity calldata mints LP to the creator (non-custodial)',
    dec.to.toLowerCase() === '0x' + '22'.repeat(20));
  t('plan: addLiquidity deadline ≈ now + 600s',
    Number(dec.deadline) >= Math.floor(Date.now() / 1000) - 10 &&
    Number(dec.deadline) <= Math.floor(Date.now() / 1000) + 610);
  t('plan: addLiquidity amounts match the signed mins and desired amounts',
    dec.tokenA.toLowerCase() === '0x' + '33'.repeat(20) &&
    dec.amountADesired === 100000n * 10n ** 18n &&
    dec.amountAMin === (100000n * 10n ** 18n * 9900n) / 10000n &&
    dec.amountBDesired === 10000n * 10n ** 6n &&
    dec.amountBMin === (10000n * 10n ** 6n * 9900n) / 10000n);
}

const planC = await buildLaunchPlan({
  chainId: 56,
  spec: null,
  tokenAddress: '0x' + '33'.repeat(20),
  quote: bnb,
  tokenAmount: '100000', quoteAmount: '0.5',
  slippageBps: 100,
  creator: '0x' + '22'.repeat(20),
  createPairNeeded: false
});
t('plan: native quote skips quote-approve and uses addLiquidityETH with msg.value',
  planC.steps.map((s) => s.id).join(',') === 'approve-token,add-liquidity' &&
  planC.steps[1].value === '500000000000000000');

/* ── TokenCreated event parsing ──────────────────────────────────────────── */

const tokenFrag = tokenIface.getEvent ? null : null; // tokens emit nothing; factory does
const factoryTokenCreated = factoryIface.getEvent('TokenCreated');
const eventLog = {
  topics: [
    factoryTokenCreated.topicHash,
    ethers.zeroPadValue('0x' + '33'.repeat(20), 32),
    ethers.zeroPadValue('0x' + '22'.repeat(20), 32)
  ],
  data: coder.encode(['string', 'string', 'uint8', 'uint256', 'uint256'],
    ['FBT Gold', 'FBTG', 18, 1000000000n * 10n ** 18n, 0n])
};
const parsed = await parseTokenCreatedLog(eventLog);
t('event: TokenCreated parses token/creator/symbol/decimals/supply',
  parsed.token.toLowerCase() === '0x' + '33'.repeat(20) &&
  parsed.creator.toLowerCase() === '0x' + '22'.repeat(20) &&
  parsed.symbol === 'FBTG' && parsed.decimals === 18 && parsed.supply === '1000000000' + '0'.repeat(18) &&
  parsed.capabilities === 0);

/* ── engine lifecycle ────────────────────────────────────────────────────── */

const makeCfg = (overrides = {}) => ({
  chainId: 56,
  dex: { id: 'pancake', name: 'PancakeSwap', factory: '0x' + '99'.repeat(20) },
  factoryAddress: '0x' + '11'.repeat(20),
  spec: { ...goodSpec.value },
  quote: usdt,
  tokenAmount: '100000', quoteAmount: '10000', slippageBps: 100,
  creator: '0x' + '22'.repeat(20),
  risk: lowRisk,
  steps: [
    { id: 'create-token', status: 'ready', to: '0x' + '11'.repeat(20), data: '0xab', value: '0', description: 'create' },
    { id: 'deferred-pool', status: 'pending', deferred: true, description: 'pool' }
  ],
  ...overrides
});

/* full happy path */
{
  const L = engine.createLaunch();
  engine.configure(L, makeCfg());
  engine.simulateStart(L);
  engine.simulateDone(L, { gas: { 'create-token': '100000' } });
  engine.confirmIntent(L);
  t('engine: DRAFT → CONFIGURED → SIMULATING → SIMULATED → AWAITING_CONFIRMATION',
    L.state === 'AWAITING_CONFIRMATION' && L.simulation);

  engine.signingStarted(L, 'create-token');
  assert.equal(L.state, 'SIGNING');
  engine.stepSubmitted(L, 'create-token', '0x' + 'ab'.repeat(32));
  assert.equal(L.state, 'SUBMITTED');
  engine.stepConfirmed(L, 'create-token', {
    receipt: { transactionHash: '0x' + 'ab'.repeat(32), blockNumber: 1, gasUsed: '100000' },
    tokenFacts: { address: '0x' + '33'.repeat(20), name: 'FBT Gold', symbol: 'FBTG', decimals: 18, supply: '1000000000' + '0'.repeat(18), capabilities: 0n }
  });
  t('engine: token confirmed → facts recorded, deferred step resolved with the REAL address',
    L.token.address.toLowerCase() === '0x' + '33'.repeat(20) &&
    L.steps.find((s) => s.id === 'deferred-pool').resolvedWith.toLowerCase() === '0x' + '33'.repeat(20) &&
    L.steps.find((s) => s.id === 'deferred-pool').needsReprepare === true);

  // materialise pool steps (the UI does this with buildLiquiditySteps)
  const deferredIdx = L.steps.findIndex((s) => s.id === 'deferred-pool');
  L.steps.splice(deferredIdx, 1,
    { id: 'approve-token', status: 'ready' }, { id: 'create-pair', status: 'ready' }, { id: 'add-liquidity', status: 'ready' });
  for (const id of ['approve-token', 'create-pair', 'add-liquidity']) {
    engine.signingStarted(L, id);
    engine.stepSubmitted(L, id, '0x' + 'cd'.repeat(32));
    if (id === 'create-pair') engine.stepConfirmed(L, id, { poolFacts: { address: '0x' + '44'.repeat(20) } });
    else engine.stepConfirmed(L, id, {});
  }
  assert.equal(L.state, 'CONFIRMING', 'last step confirmed → CONFIRMING');

  engine.verified(L, {
    token: { address: '0x' + '33'.repeat(20), name: 'FBT Gold', symbol: 'FBTG' },
    pool: { address: '0x' + '44'.repeat(20), lpBalance: '1000', reserves: { token: '100000', quote: '10000' } }
  });
  assert.equal(L.state, 'VERIFIED');
  engine.live(L);
  t('engine: VERIFIED → LIVE is the only road to LIVE', L.state === 'LIVE' && L.pool.lpBalance === '1000');
}

/* partial failure — token mined, pool failed */
{
  const F = engine.createLaunch();
  engine.configure(F, makeCfg());
  engine.simulateStart(F);
  engine.simulateDone(F, {});
  engine.confirmIntent(F);
  engine.signingStarted(F, 'create-token');
  engine.stepSubmitted(F, 'create-token', '0x' + 'ee'.repeat(32));
  engine.stepConfirmed(F, 'create-token', { tokenFacts: { address: '0x' + '33'.repeat(20), name: 'FBT Gold', symbol: 'FBTG', decimals: 18, supply: '1', capabilities: 0n } });

  F.steps.find((s) => s.id === 'deferred-pool').deferred = false;
  F.steps.find((s) => s.id === 'deferred-pool').status = 'ready';
  engine.signingStarted(F, 'deferred-pool');
  engine.stepSubmitted(F, 'deferred-pool', '0x' + 'ff'.repeat(32));
  engine.stepFailed(F, 'deferred-pool', 'EXECUTION_REVERTED: slippage');

  t('engine: token ok + pool failed = RETRYABLE with the EXACT partial report',
    F.state === 'RETRYABLE' && F.partial.token === 'SUCCESS' && F.partial.pool === 'FAILED' &&
    F.partial.failedStep === 'deferred-pool' && F.token.address.toLowerCase() === '0x' + '33'.repeat(20));

  engine.retryPool(F);
  t('engine: retry keeps the token (never re-created) and goes back to CONFIGURED for re-simulation',
    F.state === 'CONFIGURED' && F.token.address.toLowerCase() === '0x' + '33'.repeat(20));
}

/* failure before the token = plain FAILED (nothing partial to report) */
{
  const X = engine.createLaunch();
  engine.configure(X, makeCfg());
  engine.simulateStart(X);
  engine.simulateDone(X, {});
  engine.confirmIntent(X);
  engine.signingStarted(X, 'create-token');
  engine.stepFailed(X, 'create-token', 'TX_REVERTED');
  t('engine: token step fails first = FAILED (no token exists on-chain)', X.state === 'FAILED' && X.token === null);
}

/* cancel keeps confirmed facts */
{
  const C = engine.createLaunch();
  engine.configure(C, makeCfg());
  engine.simulateStart(C);
  engine.simulateDone(C, {});
  engine.confirmIntent(C);
  engine.signingStarted(C, 'create-token');
  engine.stepSubmitted(C, 'create-token', '0x' + '11'.repeat(32));
  engine.stepConfirmed(C, 'create-token', { tokenFacts: { address: '0x' + '33'.repeat(20), name: 'A', symbol: 'A', decimals: 18, supply: '1', capabilities: 0n } });
  engine.cancel(C);
  t('engine: cancel → CANCELLED, token fact preserved', C.state === 'CANCELLED' && C.token.address.toLowerCase() === '0x' + '33'.repeat(20));
}

/* user rejection is a choice, never a failure */
{
  const R = engine.createLaunch();
  engine.configure(R, makeCfg());
  engine.simulateStart(R);
  engine.simulateDone(R, {});
  engine.confirmIntent(R);
  engine.signingStarted(R, 'create-token');
  engine.stepRejected(R, 'create-token');
  t('engine: user rejection (nothing mined) → CANCELLED, not FAILED',
    R.state === 'CANCELLED' && R.steps[0].error === 'USER_REJECTED');

  // …but a rejection AFTER the token mined keeps the retry path open
  const R2 = engine.createLaunch();
  engine.configure(R2, makeCfg());
  engine.simulateStart(R2);
  engine.simulateDone(R2, {});
  engine.confirmIntent(R2);
  engine.signingStarted(R2, 'create-token');
  engine.stepSubmitted(R2, 'create-token', '0x' + '55'.repeat(32));
  engine.stepConfirmed(R2, 'create-token', { tokenFacts: { address: '0x' + '33'.repeat(20), name: 'A', symbol: 'A', decimals: 18, supply: '1', capabilities: 0 } });
  R2.steps.find((s) => s.id === 'deferred-pool').deferred = false;
  R2.steps.find((s) => s.id === 'deferred-pool').status = 'ready';
  engine.signingStarted(R2, 'deferred-pool');
  engine.stepRejected(R2, 'deferred-pool');
  t('engine: user rejection (token mined) → RETRYABLE with recovery', R2.state === 'RETRYABLE' && R2.partial.recovery === 'retry-pool');
}

/* ── history sanitization ────────────────────────────────────────────────── */

{
  const clean = sanitizeRecord({
    launchId: 'l_123',
    creatorPublicAddress: '0x' + '22'.repeat(20),
    network: 56,
    tokenAddress: '0x' + '33'.repeat(20),
    txHashes: ['0x' + 'aa'.repeat(32)],
    status: 'LIVE',
    riskScore: 42,
    /* fields that must NEVER persist */
    privateKey: '0xdeadbeef',
    seedPhrase: 'abandon abandon',
    secret: 'shh',
    wallet: 'me@example.com',
    nonce: 7,
    badAddress: 'not-an-address',
    badHash: '0x123'
  });
  t('history: sensitive fields dropped (keys, phrases, emails, extras)',
    clean.privateKey === undefined && clean.seedPhrase === undefined && clean.wallet === undefined && clean.nonce === undefined);
  t('history: good records pass through intact',
    clean.launchId === 'l_123' && clean.status === 'LIVE' && clean.txHashes.length === 1 && clean.tokenAddress === '0x' + '33'.repeat(20));
  t('history: malformed hashes are dropped, valid ones kept',
    sanitizeRecord({ txHashes: ['0x' + 'aa'.repeat(32), '0x123'] }).txHashes.length === 1);
  t('history: garbage input → empty record (nothing leaks)',
    Object.keys(sanitizeRecord(null)).length === 0 && Object.keys(sanitizeRecord('x')).length === 0);
}

/* ── artifacts ───────────────────────────────────────────────────────────── */

t('artifacts: both contracts present with bytecode under the 24KB init limit',
  artifact.contracts.FBTBasicToken && artifact.contracts.FBTTokenFactory &&
  artifact.contracts.FBTBasicToken.bytecode.length < 2 * 24576 + 2 &&
  artifact.contracts.FBTTokenFactory.bytecode.length < 2 * 24576 + 2);
t('artifacts: factory ABI exposes createToken + isFbtToken (stateless, no owner)',
  ['createToken', 'isFbtToken', 'createdCount'].every((fn) => artifact.contracts.FBTTokenFactory.abi.some((e) => e.type === 'function' && e.name === fn)));
t('artifacts: token ABI has the exact capability surface (owner-gated powers)',
  ['transfer', 'balanceOf', 'approve', 'transferFrom', 'owner', 'setPaused', 'setCapabilityLimits', 'mint', 'burn', 'capabilities'].every((fn) =>
    artifact.contracts.FBTBasicToken.abi.some((e) => e.type === 'function' && e.name === fn)));
t('artifacts: token ABI emits no tax/blacklist surface (no blacklist function exists)',
  !artifact.contracts.FBTBasicToken.abi.some((e) => /blacklist|isBlacklisted|setTax/i.test(e.name || '')));

console.log('\n✓ launch-probe: all assertions passed\n');
