/**
 * Lending executor against the REAL libraries — only the chain and the wallet
 * are faked.
 *
 * The Node probe (`autonomy-execution-probe.mjs`) pins the executor's decisions
 * with hand-written drivers. That is necessary but not sufficient: a mock can
 * answer in a shape the real library never produces (an earlier version of the
 * `runLendingPlan` mock returned a top-level `hash` the real function does not
 * have, so every confirmed deposit would have been reported as NO_TX_HASH).
 *
 * Here the executor runs through the real `buildAutonomyDrivers`, the real
 * `lib/lending.js` (`readReserve`, `readOraclePrices`, `readUserAccount`,
 * `readAssetPosition`, `readAllowance`, `buildLendingPlan`, `runLendingPlan`)
 * and the real ethers transport, with a fake JSON-RPC node and a fake signer.
 * Nothing is signed for real; what is asserted is what WOULD have been sent.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { AbiCoder, FetchRequest, FetchResponse, Interface, JsonRpcProvider } from 'ethers';

import { runAction } from '../../src/lib/intent-ai/executionRuntime.js';
import { buildAutonomyDrivers, warmAutonomyDrivers } from '../../src/lib/intent-ai/autonomy/browserDrivers.js';
import {
  AAVE_ORACLE_ABI, AAVE_POOL_ABI, AAVE_PROVIDER_ABI, ERC20_MIN_ABI, RESERVE_CONFIG_BITS,
  lendingAssetsFor, lendingVenue, rayRateToApyPct
} from '../../src/lib/lending.js';

const CHAIN = 42161;
const POOL = lendingVenue(CHAIN).pool.toLowerCase();
const USDC = lendingAssetsFor(CHAIN).find((a) => a.symbol === 'USDC');
const USDC_ADDR = USDC.address.toLowerCase();
const USER = '0x1111111111111111111111111111111111111111';
const OTHER = '0x2222222222222222222222222222222222222222';
const PROVIDER = '0xa97684ead0e402dc232d5a977953decbae52cdb0'.toLowerCase();
const ORACLE = '0xb56c2f0b653b2e0b10c9b928c8580ac5df02c7c7'.toLowerCase();
const ATOKEN = '0x2222222222222222222222222222222222222223';
const VDEBT = '0x3333333333333333333333333333333333333334';
const ZERO = '0x0000000000000000000000000000000000000000';
const RAY = 10n ** 27n;

const coder = AbiCoder.defaultAbiCoder();
const poolIface = new Interface(AAVE_POOL_ABI);
const providerIface = new Interface(AAVE_PROVIDER_ABI);
const oracleIface = new Interface(AAVE_ORACLE_ABI);
const erc20Iface = new Interface(ERC20_MIN_ABI);
const RESERVE_TUPLE = 'tuple(uint256,uint128,uint128,uint128,uint128,uint128,uint40,uint16,address,address,address,address,uint128,uint128,uint128)';

const B = RESERVE_CONFIG_BITS;
function configuration({ active = true, frozen = false, paused = false, borrowing = true, ltv = 7500, threshold = 7800, decimals = 6, supplyCap = 0n, borrowCap = 0n } = {}) {
  let raw = BigInt(ltv) << B.ltvShift;
  raw |= BigInt(threshold) << B.liquidationThresholdShift;
  raw |= 10500n << B.liquidationBonusShift;
  raw |= BigInt(decimals) << B.decimalsShift;
  if (active) raw |= 1n << B.activeShift;
  if (frozen) raw |= 1n << B.frozenShift;
  if (borrowing) raw |= 1n << B.borrowingEnabledShift;
  if (paused) raw |= 1n << B.pausedShift;
  raw |= BigInt(borrowCap) << B.borrowCapShift;
  raw |= BigInt(supplyCap) << B.supplyCapShift;
  return raw;
}

const usdc = (n) => BigInt(Math.round(n * 1e6));

/** The fake chain. Every test starts from `fresh()` and overrides one thing. */
const fresh = () => ({
  config: {},
  ageSeconds: 30,
  supplyAprRay: (RAY * 4n) / 100n,
  borrowAprRay: (RAY * 5n) / 100n,
  totalSupply: usdc(1_000_000),
  totalVariableDebt: usdc(400_000),
  walletBalance: usdc(5_000),
  allowance: 0n,
  priceBase: 10n ** 8n,
  account: { collateral: 10_000n * 10n ** 8n, debt: 1_000n * 10n ** 8n, available: 5_000n * 10n ** 8n, threshold: 8200n, ltv: 7500n, health: 5n * 10n ** 18n },
  decimalsOnToken: 6,
  zeroConfig: false
});

let chain = fresh();
const reads = [];
let rpc;
let originalGetUrl;

function ethCall(tx) {
  const to = String(tx?.to || '').toLowerCase();
  const data = String(tx?.data || '0x');
  const selector = data.slice(0, 10);
  reads.push({ to, selector });
  if (to === POOL && selector === poolIface.getFunction('ADDRESSES_PROVIDER').selector) return coder.encode(['address'], [PROVIDER]);
  if (to === POOL && selector === poolIface.getFunction('getReserveData').selector) {
    const last = BigInt(Math.floor(Date.now() / 1000) - chain.ageSeconds);
    return coder.encode([RESERVE_TUPLE], [[
      chain.zeroConfig ? 0n : configuration(chain.config), RAY, chain.supplyAprRay, RAY, chain.borrowAprRay, 0n, last, 7,
      ATOKEN, ZERO, VDEBT, ZERO, 0n, 0n, 0n
    ]]);
  }
  if (to === POOL && selector === poolIface.getFunction('getUserAccountData').selector) {
    const a = chain.account;
    return coder.encode(['uint256', 'uint256', 'uint256', 'uint256', 'uint256', 'uint256'],
      [a.collateral, a.debt, a.available, a.threshold, a.ltv, a.health]);
  }
  if (to === PROVIDER && selector === providerIface.getFunction('getPriceOracle').selector) return coder.encode(['address'], [ORACLE]);
  if (to === ORACLE && selector === oracleIface.getFunction('BASE_CURRENCY_UNIT').selector) return coder.encode(['uint256'], [10n ** 8n]);
  if (to === ORACLE && selector === oracleIface.getFunction('getAssetsPrices').selector) {
    const [assets] = oracleIface.decodeFunctionData('getAssetsPrices', data);
    return coder.encode(['uint256[]'], [assets.map(() => chain.priceBase)]);
  }
  if (to === ATOKEN && selector === erc20Iface.getFunction('totalSupply').selector) return coder.encode(['uint256'], [chain.totalSupply]);
  if (to === ATOKEN && selector === erc20Iface.getFunction('balanceOf').selector) return coder.encode(['uint256'], [0n]);
  if (to === VDEBT && selector === erc20Iface.getFunction('totalSupply').selector) return coder.encode(['uint256'], [chain.totalVariableDebt]);
  if (to === VDEBT && selector === erc20Iface.getFunction('balanceOf').selector) return coder.encode(['uint256'], [0n]);
  if (to === USDC_ADDR && selector === erc20Iface.getFunction('decimals').selector) return coder.encode(['uint8'], [chain.decimalsOnToken]);
  if (to === USDC_ADDR && selector === erc20Iface.getFunction('balanceOf').selector) return coder.encode(['uint256'], [chain.walletBalance]);
  if (to === USDC_ADDR && selector === erc20Iface.getFunction('allowance').selector) return coder.encode(['uint256'], [chain.allowance]);
  throw new Error(`execution reverted: unhandled ${to} ${selector}`);
}

async function serve(bodyText) {
  let body = null;
  try { body = JSON.parse(bodyText || 'null'); } catch { body = null; }
  if (!body) return JSON.stringify({ error: 'bad request' });
  const one = async (call) => {
    try {
      const result = call.method === 'eth_call'
        ? ethCall(call.params?.[0])
        : call.method === 'eth_chainId' ? `0x${CHAIN.toString(16)}`
          : call.method === 'eth_blockNumber' ? '0x100'
            : '0x';
      return { jsonrpc: '2.0', id: call.id, result };
    } catch (cause) {
      return { jsonrpc: '2.0', id: call.id, error: { code: -32000, message: String(cause?.message || cause) } };
    }
  };
  return JSON.stringify(Array.isArray(body) ? await Promise.all(body.map(one)) : await one(body));
}

/* ── the wallet: a fake signer that records what it WOULD have sent ──────── */
const sent = [];
let signerChain = CHAIN;
let signerAddress = USER;
let failSend = null; // { at, error }
const makeSigner = () => ({
  /* ethers' TransactionResponse.wait() asks the signer's provider for the
     receipt, so the fake provider answers that — and the network id the
     executor uses to prove the signer is on the reviewed chain. */
  provider: {
    getNetwork: async () => ({ chainId: BigInt(signerChain) }),
    getTransactionReceipt: async (hash) => ({ status: 1, hash, transactionHash: hash, blockNumber: 256, logs: [] })
  },
  getAddress: async () => signerAddress,
  sendTransaction: async (tx) => {
    if (failSend && sent.length === failSend.at) throw failSend.error;
    sent.push({ to: String(tx.to).toLowerCase(), data: tx.data, from: tx.from });
    const hash = `0x${String(sent.length).padStart(64, '0')}`;
    return { hash, wait: async () => ({ status: 1, hash }) };
  }
});

function wallet() {
  return {
    isConnected: true,
    address: USER,
    chainId: CHAIN,
    getSigner: () => makeSigner(),
    switchChain: async (target) => { signerChain = Number(target); return true; },
    getReadProvider: async () => new Proxy(rpc, {
      get(target, prop) {
        if (prop === 'getTransactionReceipt') {
          return async (hash) => ({ status: 1, transactionHash: hash, hash, blockNumber: 256 });
        }
        const value = Reflect.get(target, prop, target);
        return typeof value === 'function' ? value.bind(target) : value;
      }
    })
  };
}

const RUNTIME_WALLET = { connected: true, canSign: true, address: USER, chainId: CHAIN };

/** The terms the chat review would have confirmed from THIS chain state. */
const review = (side, over = {}) => ({
  requireLiveRateReview: true,
  reviewedAt: Date.now(),
  reviewedPriceUsd: 1,
  reviewedSupplyApyPct: side === 'supply' ? rayRateToApyPct(chain.supplyAprRay) : null,
  reviewedBorrowApyPct: side === 'borrow' ? rayRateToApyPct(chain.borrowAprRay) : null,
  reviewedProjectedHealthFactor: side === 'borrow' ? (10_000 * 0.82) / (1_000 + 500) : null,
  reviewedAvailableBorrowsUsd: side === 'borrow' ? 5_000 : null,
  ...over
});
const supply = (over = {}) => ({
  type: 'LEND', asset: 'USDC', amount: '1000', amountUnit: 'USDC', amountUsd: 1000, chainId: CHAIN,
  venue: 'lend-aave', protocol: 'Aave V3', market: USDC.address, parameters: review('supply'), ...over
});
const borrow = (over = {}) => ({
  type: 'BORROW', asset: 'USDC', amount: '500', amountUnit: 'USDC', amountUsd: 500, chainId: CHAIN,
  venue: 'lend-aave', protocol: 'Aave V3', market: USDC.address, parameters: review('borrow'), ...over
});

async function run(action, { drivers = null } = {}) {
  sent.length = 0;
  const d = drivers || buildAutonomyDrivers({ wallet: wallet(), solana: { connected: false } });
  return runAction(action, { wallet: RUNTIME_WALLET, drivers: d });
}

beforeAll(async () => {
  originalGetUrl = null;
  FetchRequest.registerGetUrl(async (req) => {
    const text = await serve(req.body ? new TextDecoder().decode(req.body) : null);
    return new FetchResponse(200, 'OK', { 'content-type': 'application/json' }, new TextEncoder().encode(text), req);
  });
  rpc = new JsonRpcProvider('http://lending-executor-real.invalid/rpc', CHAIN, { staticNetwork: true });
  await warmAutonomyDrivers();
});
afterAll(() => { try { rpc?.destroy(); } catch { /* best effort */ } });

describe('lending executor on the real libraries', () => {
  it('supplies a reviewed amount: approve EXACTLY the amount, then supply, receipt = the supply tx', async () => {
    chain = fresh(); reads.length = 0;
    const result = await run(supply());
    expect(result.error, JSON.stringify(result.error)).toBeNull();
    expect(result.success).toBe(true);
    expect(result.status).toBe('CONFIRMED');
    expect(sent).toHaveLength(2);
    const [approve, supplyTx] = sent;
    expect(approve.to).toBe(USDC_ADDR);
    expect(erc20Iface.parseTransaction({ data: approve.data }).args[1]).toBe(usdc(1000));
    expect(erc20Iface.parseTransaction({ data: approve.data }).args[0].toLowerCase()).toBe(POOL);
    expect(supplyTx.to).toBe(POOL);
    const args = poolIface.parseTransaction({ data: supplyTx.data }).args;
    expect(args[0].toLowerCase()).toBe(USDC_ADDR);
    expect(args[1]).toBe(usdc(1000));
    expect(args[2].toLowerCase()).toBe(USER);
    /* The proof is the supply transaction's own hash — not the approval's. */
    expect(result.txHash).toBe(`0x${'2'.padStart(64, '0')}`);
    expect(result.plan.actions[0].venue).toBe('lend-aave');
  });

  it('skips the approval when the allowance already covers the amount', async () => {
    chain = fresh(); chain.allowance = usdc(1000);
    const result = await run(supply());
    expect(result.success, JSON.stringify(result.error)).toBe(true);
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toBe(POOL);
  });

  it('really read every live input from the pool and its oracle before signing', async () => {
    chain = fresh(); reads.length = 0;
    await run(supply());
    const selectors = new Set(reads.map((r) => `${r.to}:${r.selector}`));
    expect(selectors.has(`${POOL}:${poolIface.getFunction('getReserveData').selector}`)).toBe(true);
    expect(selectors.has(`${ORACLE}:${oracleIface.getFunction('getAssetsPrices').selector}`)).toBe(true);
    expect(selectors.has(`${USDC_ADDR}:${erc20Iface.getFunction('balanceOf').selector}`)).toBe(true);
    expect(selectors.has(`${USDC_ADDR}:${erc20Iface.getFunction('allowance').selector}`)).toBe(true);
  });

  it.each([
    ['a paused reserve', (c) => { c.config = { paused: true }; }, 'RESERVE_PAUSED'],
    ['a frozen reserve', (c) => { c.config = { frozen: true }; }, 'RESERVE_NOT_ACTIVE'],
    ['an unreadable (all-zero) reserve configuration', (c) => { c.zeroConfig = true; }, 'RESERVE_NOT_ACTIVE'],
    ['a stale reserve', (c) => { c.ageSeconds = 7200; }, 'RATE_STALE'],
    ['a zero oracle price', (c) => { c.priceBase = 0n; }, 'ORACLE_PRICE_UNAVAILABLE'],
    ['a balance below the amount', (c) => { c.walletBalance = usdc(10); }, 'INSUFFICIENT_FUNDS'],
    ['a supply cap already reached', (c) => { c.config = { supplyCap: 1_000_000n }; }, 'SUPPLY_CAP_EXCEEDED'],
    ['a token whose own decimals disagree', (c) => { c.decimalsOnToken = 18; }, 'DECIMALS_UNVERIFIED'],
    ['a rate that moved since the review', (c) => { c.supplyAprRay = (RAY * 12n) / 100n; }, 'QUOTE_CHANGED'],
    ['an oracle price that moved', (c) => { c.priceBase = 103n * 10n ** 6n; }, 'QUOTE_CHANGED']
  ])('refuses %s, and signs nothing', async (_name, mutate, expected) => {
    chain = fresh();
    /* The review is built from the chain as the user saw it… */
    const action = supply();
    /* …then the chain changes before the user confirms. */
    mutate(chain);
    const result = await run(action);
    expect(result.success).not.toBe(true);
    expect(result.error?.message).toBe(expected);
    expect(sent).toHaveLength(0);
  });

  it('switches a wallet that is on another network, then signs on the reviewed one', async () => {
    chain = fresh(); signerChain = 1;
    const result = await run(supply());
    expect(result.success, JSON.stringify(result.error)).toBe(true);
    expect(signerChain).toBe(CHAIN);
    expect(sent).toHaveLength(2);
  });

  it('refuses when the wallet cannot be put on the reviewed network, signing nothing', async () => {
    chain = fresh(); signerChain = 1;
    const refusing = wallet();
    refusing.switchChain = async () => false;
    const refused = await run(supply(), { drivers: buildAutonomyDrivers({ wallet: refusing, solana: { connected: false } }) });
    expect(refused.success).not.toBe(true);
    expect(refused.error?.message).toBe('CHAIN_SWITCH_FAILED');

    const noSwitch = wallet();
    delete noSwitch.switchChain;
    const mismatch = await run(supply(), { drivers: buildAutonomyDrivers({ wallet: noSwitch, solana: { connected: false } }) });
    expect(mismatch.success).not.toBe(true);
    expect(mismatch.error?.message).toBe('CHAIN_MISMATCH');
    expect(sent).toHaveLength(0);
    signerChain = CHAIN;
  });

  it('refuses a signer that is not the account the review was built for', async () => {
    chain = fresh(); signerAddress = OTHER;
    const result = await run(supply());
    signerAddress = USER;
    expect(result.success).not.toBe(true);
    expect(result.error?.message).toBe('WALLET_ACCOUNT_CHANGED');
    expect(sent).toHaveLength(0);
  });

  it('reports a partial run honestly: the approval landed, the deposit did not', async () => {
    chain = fresh();
    failSend = { at: 1, error: Object.assign(new Error('execution reverted: boom'), { code: 'CALL_EXCEPTION' }) };
    const result = await run(supply());
    failSend = null;
    expect(result.success).not.toBe(true);
    expect(result.error?.message).toBe('LENDING_PARTIAL');
    expect(sent).toHaveLength(1);
  });

  it('treats a rejected first signature as the user\'s choice, never as a failure of the venue', async () => {
    chain = fresh();
    failSend = { at: 0, error: Object.assign(new Error('user rejected transaction'), { code: 4001 }) };
    const result = await run(supply());
    failSend = null;
    expect(result.success).not.toBe(true);
    expect(result.status).toBe('USER_REJECTED');
    expect(sent).toHaveLength(0);
  });

  it('borrows a reviewed amount through a single, reviewed borrow step', async () => {
    chain = fresh();
    const result = await run(borrow({ collateral: '999' }));
    expect(result.error, JSON.stringify(result.error)).toBeNull();
    expect(result.success).toBe(true);
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toBe(POOL);
    const parsed = poolIface.parseTransaction({ data: sent[0].data });
    expect(parsed.name).toBe('borrow');
    expect(parsed.args[0].toLowerCase()).toBe(USDC_ADDR);
    expect(parsed.args[1]).toBe(usdc(500));
    expect(parsed.args[2]).toBe(2n);
    expect(parsed.args[4].toLowerCase()).toBe(USER);
    expect(result.txHash).toBe(`0x${'1'.padStart(64, '0')}`);
  });

  it.each([
    ['too little collateral headroom (health factor)', (c) => { c.account.debt = 8_000n * 10n ** 8n; }, 'HEALTH_FACTOR_TOO_LOW'],
    ['capacity above what the pool allows', (c) => { c.account.available = 100n * 10n ** 8n; }, 'BORROW_LIMIT_EXCEEDED'],
    ['borrowing disabled on the reserve', (c) => { c.config = { borrowing: false }; }, 'BORROW_DISABLED'],
    ['no collateral at all', (c) => { c.account.collateral = 0n; }, 'BORROW_CAPACITY_UNAVAILABLE'],
    ['liquidity below the amount', (c) => { c.totalSupply = usdc(500_100); c.totalVariableDebt = usdc(500_000); }, 'BORROW_LIQUIDITY_EXCEEDED'],
    ['a borrow cap that would be crossed', (c) => { c.config = { borrowCap: 400_100n }; }, 'BORROW_CAP_EXCEEDED']
  ])('refuses a borrow with %s, and signs nothing', async (_name, mutate, expected) => {
    chain = fresh();
    const action = borrow();
    mutate(chain);
    const result = await run(action);
    expect(result.success).not.toBe(true);
    expect(result.error?.message).toBe(expected);
    expect(sent).toHaveLength(0);
  });

  it('never executes a lending action that was not reviewed', async () => {
    chain = fresh();
    for (const action of [supply({ parameters: {} }), supply({ amountUnit: null }), borrow({ parameters: {} })]) {
      const result = await run(action);
      expect(result.success).not.toBe(true);
      expect(result.error?.message).toBe('LENDING_REVIEW_REQUIRED');
    }
    expect(sent).toHaveLength(0);
  });

  it('never maps FARM to an Aave supply, even with the Aave venue named', async () => {
    chain = fresh();
    const result = await run({ ...supply(), type: 'FARM' });
    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('FARM_EXECUTOR_UNAVAILABLE');
    expect(sent).toHaveLength(0);
  });
});
