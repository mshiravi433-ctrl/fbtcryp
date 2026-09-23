/**
 * THE LENDING BFF ON A FROZEN MARKET — the last place in the repository that
 * still treated «frozen» as «paused».
 *
 * On 2026-09-23 the client learned the difference (PR #398: a frozen Aave
 * reserve closes NEW supply and NEW borrow, while repay and withdraw stay open
 * on-chain — which is exactly how the ARFC of 2026-07-30 asks positions on
 * Sonic, Scroll, zkSync, Metis, Soneium and Aptos to unwind). The BFF did not:
 *
 *     if (reserve.status !== 'active') → 423 MARKET_PAUSED
 *     «This market is currently paused by the protocol»
 *
 * for all four actions. On Sonic — where Aave froze every reserve, cut the caps
 * to 1 and raised the reserve factor to 99% — that answer was wrong twice over:
 * the state is not a pause, and the two actions that would get a user's money
 * out of a retiring market were refused by our own server. This suite drives the
 * real router over HTTP against a fake Sonic pool, so the gate is proven the way
 * a caller meets it.
 *
 * No network access is required: the EVM RPC is stubbed, and the pool answers
 * with a real ABI-encoded reserve bitmap carrying the bit under test.
 */
import { describe, expect, it, beforeAll, afterAll, beforeEach } from 'vitest';
import express from 'express';
import { Interface } from 'ethers';
import { lendingRouter, POOL_ABI } from '../server/lending.js';

const POOL = '0x5362dBb1e601abF3a4c14c22ffEdA64042E5eAA3';      // Aave V3 on Sonic
const SONIC_CHAIN_ID = 146;
const USDC = '0x29219dd400f2Bf60E5a23d13Be72B486D4038894';         // Sonic USDC
const ATOKEN = '0x4444444444444444444444444444444444444444';
const DEBT_TOKEN = '0x5555555555555555555555555555555555555555';
const WALLET = '0x1111111111111111111111111111111111111111';

const poolIface = new Interface(POOL_ABI);
const erc20Iface = new Interface([
  'function balanceOf(address owner) view returns (uint256)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function decimals() view returns (uint8)'
]);

const SEL = {
  reserveData: poolIface.getFunction('getReserveData').selector,
  accountData: poolIface.getFunction('getUserAccountData').selector,
  decimals: erc20Iface.getFunction('decimals').selector,
  balanceOf: erc20Iface.getFunction('balanceOf').selector,
  allowance: erc20Iface.getFunction('allowance').selector
};

/* Aave V3 ReserveConfiguration, the bits this suite moves:
   48-55 decimals · 56 active · 57 FROZEN · 58 borrowing · 60 PAUSED
   80-115 borrow cap · 116-151 supply cap (whole tokens; 0 = unlimited).
   The wind-down shape is reproduced exactly: frozen, caps cut to 1. */
const BITS = { decimals: 48n, active: 56n, frozen: 57n, borrowing: 58n, paused: 60n, borrowCap: 80n, supplyCap: 116n };

const configuration = ({ frozen = false, paused = false, unreadable = false } = {}) => {
  if (unreadable) return 0n;
  let raw = 0n;
  raw |= 1n << BITS.active;
  raw |= 1n << BITS.borrowing;
  raw |= 6n << BITS.decimals;                       // USDC
  raw |= 8000n << 0n;                               // 80% LTV
  raw |= 8300n << 16n;                              // 83% liquidation threshold
  raw |= 10500n << 32n;                             // 1.05 liquidation bonus
  raw |= 1n << BITS.supplyCap;                      // cap cut to 1 token
  raw |= 1n << BITS.borrowCap;
  if (frozen) raw |= 1n << BITS.frozen;
  if (paused) raw |= 1n << BITS.paused;
  return raw;
};

const reserveData = (config) => poolIface.encodeFunctionResult('getReserveData', [[
  config,                       // configuration
  10n ** 27n,                   // liquidityIndex (ray)
  30n * 10n ** 24n,             // currentLiquidityRate → ~3% APY
  10n ** 27n,                   // variableBorrowIndex
  50n * 10n ** 24n,             // currentVariableBorrowRate → ~5% APY
  0n,                           // currentStableBorrowRate (deprecated)
  BigInt(Math.floor(Date.now() / 1000)),
  0,                            // reserve id
  ATOKEN,
  '0x0000000000000000000000000000000000000000',
  DEBT_TOKEN,
  '0x6666666666666666666666666666666666666666',
  0n, 0n, 0n
]]);

const accountData = poolIface.encodeFunctionResult('getUserAccountData', [
  1000n * 10n ** 8n,            // totalCollateralBase  $1,000
  100n * 10n ** 8n,             // totalDebtBase        $100
  700n * 10n ** 8n,             // availableBorrowsBase $700
  8300n,                        // currentLiquidationThreshold
  8000n,                        // ltv
  8n * 10n ** 18n               // healthFactor 8.0
]);

/** What the pool is currently saying. Swapped per test. */
let poolState = { frozen: true };
let rpcCalls = [];

const realFetch = globalThis.fetch;
/* The test's OWN HTTP calls must not go through the RPC stub installed below —
   the same global fetch serves both, so the real one is kept for the client
   side and the fake answers the server's eth_call. */
const httpFetch = realFetch;

function installFakeRpc() {
  globalThis.fetch = async (endpoint, init = {}) => {
    const body = JSON.parse(init.body || '{}');
    rpcCalls.push({ endpoint, method: body.method });
    const answer = (result) => new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result }), {
      status: 200, headers: { 'content-type': 'application/json' }
    });
    if (body.method === 'eth_estimateGas') return answer('0x30d40');
    if (body.method !== 'eth_call') return answer('0x');
    const data = String(body.params?.[0]?.data || '');
    if (data.startsWith(SEL.reserveData)) return answer(reserveData(configuration(poolState)));
    if (data.startsWith(SEL.accountData)) return answer(accountData);
    if (data.startsWith(SEL.decimals)) return answer(erc20Iface.encodeFunctionResult('decimals', [6]));
    if (data.startsWith(SEL.balanceOf)) return answer(erc20Iface.encodeFunctionResult('balanceOf', [10_000n * 10n ** 6n]));
    if (data.startsWith(SEL.allowance)) return answer(erc20Iface.encodeFunctionResult('allowance', [0n]));
    return answer('0x');
  };
}

let server = null;
let base = '';
let seq = 0;

beforeAll(async () => {
  installFakeRpc();
  const app = express();
  app.set('trust proxy', true);
  app.use(express.json());
  app.use('/api/lending', lendingRouter());
  /* A throw inside the handler would otherwise come back as an HTML 500 and hide
     the reason; the suite asserts on JSON, so the failure has to be visible. */
  app.use((err, _req, res, _next) => {
    res.status(500).json({ error: { code: 'THROWN', message: String(err?.stack || err).slice(0, 600) } });
  });
  server = await new Promise((resolve) => {
    const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
  });
  base = `http://127.0.0.1:${server.address().port}`;
});

afterAll(async () => {
  globalThis.fetch = realFetch;
  await new Promise((resolve) => server?.close(resolve));
});

beforeEach(() => {
  poolState = { frozen: true };
  rpcCalls = [];
});

/** POST one quote. A fresh Idempotency-Key every time: §17 replays a stored
    answer for a repeated key, which would hide the gate under test. */
async function quote(action, amount = '10') {
  seq += 1;
  const res = await httpFetch(`${base}/api/lending/quote/${action}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'idempotency-key': `frozen_bff_test_${String(seq).padStart(6, '0')}` },
    body: JSON.stringify({ network: SONIC_CHAIN_ID, asset: 'USDC', amount, wallet: WALLET })
  });
  let json = null;
  try { json = await res.json(); } catch { /* not json */ }
  return { status: res.status, json };
}

/* ═══════════ the two copies of one ABI cannot drift apart silently ════════ */

describe('the server builds the same calldata the client would', () => {
  it('every action selector matches src/lib/lending.js exactly', async () => {
    /* This is the assertion that was missing while /api/lending/quote/* answered
       500: the server's POOL_ABI carried reads only, so buildActionTx asked an
       Interface to encode a function it had never been given. Two hand-copied
       ABIs are only safe if something compares them. */
    const { AAVE_POOL_ABI } = await import('../src/lib/lending.js');
    const client = new Interface(AAVE_POOL_ABI);
    const actions = ['supply', 'withdraw', 'borrow', 'repay'];
    for (const name of actions) {
      const serverFn = poolIface.getFunction(name);
      expect(serverFn, `the server ABI must be able to encode ${name}`).toBeTruthy();
      expect(serverFn.selector, `${name} selector`).toBe(client.getFunction(name).selector);
    }
    /* And the approval, which is the first transaction of a supply or a repay —
       read from the SERVER's interface, not the one this file builds for its fake
       chain: only the server's copy can be wrong in production. */
    const { erc20Iface: serverErc20 } = await import('../server/lending.js');
    expect(serverErc20.getFunction('approve').selector).toBe('0x095ea7b3');
    /* The signatures buildActionTx encodes by string must resolve — an
       «unknown function» here is exactly the production defect. */
    for (const sig of ['supply(address,uint256,address,uint16)', 'withdraw(address,uint256,address)',
      'borrow(address,uint256,uint256,uint16,address)', 'repay(address,uint256,uint256,address)']) {
      expect(() => poolIface.encodeFunctionData(sig, sig.startsWith('borrow')
        ? [USDC, 1n, 2, 0, WALLET]
        : sig.startsWith('repay') ? [USDC, 1n, 2, WALLET]
          : sig.startsWith('withdraw') ? [USDC, 1n, WALLET] : [USDC, 1n, WALLET, 0]), sig).not.toThrow();
    }
  });
});

/* ═════════════════ the state under test: every Sonic reserve is frozen ════ */

describe('a frozen reserve keeps the two doors Aave left open', () => {
  it('builds a REPAY — unsigned, wallet-only, and says the reserve is frozen', async () => {
    const out = await quote('repay', '10');
    expect(out.status, JSON.stringify(out.json)).toBe(200);
    expect(out.json.data.status).toBe('built');
    expect(out.json.data.transactions.length).toBeGreaterThan(0);
    /* §30 — the server returns calldata and never a signature. */
    expect(out.json.data.transactions.every((tx) => tx.signed === false && tx.broadcast === false)).toBe(true);
    expect(out.json.data.transactions.every((tx) => tx.capabilities.sign === 'wallet-only')).toBe(true);
    /* §41 — a risk that does not block is still communicated. */
    expect(out.json.data.warnings.map((w) => w.code)).toContain('MARKET_FROZEN');
    expect(out.json.data.warnings[0].message).toMatch(/repay and withdraw stay open/i);
    expect(out.json.meta.security.signing).toBe('wallet-only');
  });

  it('builds a WITHDRAW — the action that gets funds out of a retiring market', async () => {
    const out = await quote('withdraw', '10');
    expect(out.status, JSON.stringify(out.json)).toBe(200);
    expect(out.json.data.transactions.at(-1).to.toLowerCase()).toBe(POOL.toLowerCase());
    expect(out.json.data.warnings.map((w) => w.code)).toContain('MARKET_FROZEN');
  });

  it('refuses the two actions the protocol really did close, and names the state', async () => {
    for (const action of ['supply', 'borrow']) {
      const out = await quote(action, '10');
      expect(out.status, `${action} is closed on a frozen reserve`).toBe(423);
      expect(out.json.error.code, action).toBe('MARKET_FROZEN');
      /* The defect in one line: a freeze is not a pause, and the sentence has to
         carry the difference or the user walks away from money they could still
         have withdrawn. */
      expect(out.json.error.message, action).toMatch(/frozen/i);
      expect(out.json.error.message, action).not.toMatch(/paused by the protocol/i);
      expect(out.json.error.message, action).toMatch(/repay and withdraw stay open/i);
    }
  });

  it('does not dial the pool for a market the allowlist does not know', async () => {
    seq += 1;
    const res = await httpFetch(`${base}/api/lending/quote/repay`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': `frozen_bff_test_${String(seq).padStart(6, '0')}` },
      body: JSON.stringify({ network: SONIC_CHAIN_ID, asset: '0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef', amount: '1', wallet: WALLET })
    });
    const json = await res.json();
    expect(res.status).toBe(400);
    expect(json.error.code).toBe('NOT_A_RESERVE');
  });
});

/* ═════════════════ the state that really does close everything ════════════ */

describe('a paused reserve still closes all four actions', () => {
  beforeEach(() => { poolState = { paused: true }; });

  it('refuses repay and withdraw too — bit 60 stops the reserve outright', async () => {
    for (const action of ['supply', 'borrow', 'repay', 'withdraw']) {
      const out = await quote(action, '10');
      expect(out.status, action).toBe(423);
      expect(out.json.error.code, action).toBe('MARKET_PAUSED');
      expect(out.json.error.message, action).toMatch(/paused/i);
    }
  });
});

describe('an active reserve carries no warning at all', () => {
  beforeEach(() => { poolState = {}; });

  it('builds a supply and says nothing about a freeze that is not there', async () => {
    const out = await quote('supply', '10');
    expect(out.status, JSON.stringify(out.json)).toBe(200);
    expect(out.json.data.warnings).toEqual([]);
  });
});

describe('a read that failed is not a protocol refusal', () => {
  beforeEach(() => { poolState = { unreadable: true }; });

  it('still builds the unwind action, because a zero bitmap is «we could not read»', async () => {
    /* §3/§37: inventing a refusal from a failed read is the same class of lie as
       inventing an open market from one. The chain enforces its own state; the
       BFF's job is not to guess it. */
    const out = await quote('withdraw', '10');
    expect(out.status, JSON.stringify(out.json)).toBe(200);
    expect(out.json.data.warnings).toEqual([]);
  });
});
