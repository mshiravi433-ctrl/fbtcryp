#!/usr/bin/env node
/**
 * Smart Money phase 3 (2026-10-25) — regression probe.
 *
 * Proves, without upstream network access:
 *   1. EVM wrapped-native quote pairs are reconstructed exactly, but only as
 *      observed-only evidence; a USD value requires timestamped hourly-or-
 *      finer native pricing near the transaction, never the daily series.
 *   2. Solana swaps are decoded from the wallet's own pre/post token-balance
 *      deltas in successful known-DEX transactions, with exact BigInt raw
 *      deltas and fail-closed rejection of ambiguous transactions.
 *   3. Neither new ledger can leak into score, P&L, qualification or
 *      consensus: the old verified filter still admits only stable-quoted
 *      `paired-explorer-transfers`.
 *   4. `analyzeWallet` wires both observed layers into its response while the
 *      verified fields stay empty/unscored when only phase-3 rows exist.
 *
 * Run: node test/smart-money-phase3-probe.mjs
 */
process.env.NODE_ENV = 'test';
delete process.env.BLOB_READ_WRITE_TOKEN;
delete process.env.ETHERSCAN_API_KEY;
delete process.env.ETHERSCAN_KEYS;

import assert from 'node:assert/strict';
import { EVM_CHAINS } from '../server/chainsLite.js';
import {
  analyzePerformance,
  reconstructNativeQuoteSwaps,
  USD_QUOTES
} from '../server/smartMoney/performance.js';
import { historicalHourlyPriceFn, intradayPriceLookup } from '../server/smartMoney/pricing.js';
import { __setFetchForTests, solTransactions } from '../server/smartMoney/dataSources.js';
import {
  SOLANA_DEX_PROGRAMS,
  SOLANA_USD_QUOTES,
  decodeSolanaSwap,
  reconstructSolanaSwaps
} from '../server/smartMoney/solanaSwaps.js';
import { analyzeWallet } from '../server/smartMoney/walletIntel.js';
import { buildConsensus } from '../server/smartMoney/consensus.js';
import { TOKEN, verifiedFixture } from './fixtures/verifiedSmartMoney.mjs';

const now = Date.now();
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const results = [];
const check = (name, fn) => {
  try { fn(); results.push(`✓ ${name}`); }
  catch (err) { results.push(`✗ ${name} — ${err.message}`); }
};
const checkAsync = async (name, fn) => {
  try { await fn(); results.push(`✓ ${name}`); }
  catch (err) { results.push(`✗ ${name} — ${err.message}`); }
};
const near = (a, b, eps = 1e-6) => Math.abs(Number(a) - Number(b)) <= eps;

/* ── 1. Intraday price discipline ─────────────────────────────────────── */
const priceTarget = now - 2 * DAY;
const hourly = [-2, -1, 0, 1, 2].map((h) => [priceTarget + h * HOUR, 100 + h]);
check('hourly lookup returns nearest point with provenance', () => {
  const at = intradayPriceLookup(hourly, { source: 'probe' });
  const point = at(priceTarget + 10 * 60_000);
  assert.equal(point.usd, 100);
  assert.equal(point.at, priceTarget);
  assert.equal(point.granularity, 'hourly');
  assert.equal(point.source, 'probe');
});
check('daily series and >2h nearest points are refused, never relabelled hourly', () => {
  const daily = [-2, -1, 0, 1, 2].map((d) => [priceTarget + d * DAY, 100 + d]);
  assert.equal(intradayPriceLookup(daily)(priceTarget), null);
  assert.equal(intradayPriceLookup(hourly)(priceTarget + 5 * HOUR), null);
});
const originalFetch = globalThis.fetch;
await checkAsync('historicalHourlyPriceFn reads range data and returns rich points', async () => {
  let seenUrl = '';
  globalThis.fetch = async (url) => {
    seenUrl = String(url);
    return { ok: true, json: async () => ({ prices: hourly }) };
  };
  try {
    const at = await historicalHourlyPriceFn(`phase3-probe-${now}`, {
      fromTs: priceTarget - 2 * HOUR, toTs: priceTarget + 2 * HOUR, timeoutMs: 1_000
    });
    assert.match(seenUrl, /market_chart\/range/);
    assert.deepEqual(at(priceTarget + 1_000), {
      usd: 100, at: priceTarget, granularity: 'hourly',
      source: 'coingecko-market-chart-range', distanceMs: 1_000
    });
  } finally { globalThis.fetch = originalFetch; }
});

/* ── 2. EVM wrapped-native observed swaps ─────────────────────────────── */
const EVM_WALLET = `0x${'a'.repeat(40)}`;
const WETH = EVM_CHAINS[1].wrapped.toLowerCase();
const USDC = USD_QUOTES[1][0];
const hash = (n) => `0x${n.toString(16).padStart(64, '0')}`;
const evmLeg = (h, ts, direction, token, symbol, amount) => ({
  hash: h, timestamp: ts, direction,
  from: direction === 'out' ? EVM_WALLET : undefined,
  to: direction === 'in' ? EVM_WALLET : undefined,
  token: { address: token, symbol }, amount, method: 'swapExactTokensForTokens'
});
const evmTx = (h, { success = true, method = 'swapExactTokensForTokens' } = {}) => ({ hash: h, success, method });
const nativeAt = now - 90 * 60_000;
const nativeInput = { chain: 1, address: EVM_WALLET, now, transfers: [], transactions: [] };
nativeInput.transactions.push(evmTx(hash(1)), evmTx(hash(2)));
nativeInput.transfers.push(
  evmLeg(hash(1), nativeAt, 'out', WETH, 'WETH', 2),
  evmLeg(hash(1), nativeAt, 'in', TOKEN, 'TEST', 100),
  evmLeg(hash(2), nativeAt + HOUR, 'in', WETH, 'WETH', 1),
  evmLeg(hash(2), nativeAt + HOUR, 'out', TOKEN, 'TEST', 50)
);
const priceAt = (ts) => ({
  usd: ts === nativeAt ? 3_000 : 3_100,
  at: ts + 10 * 60_000, granularity: 'hourly', source: 'probe-hourly'
});
const nativeSwaps = reconstructNativeQuoteSwaps({ ...nativeInput, priceAt });
check('wrapped-native BUY/SELL pair is reconstructed with tx-time hourly value', () => {
  assert.equal(nativeSwaps.length, 2);
  assert.deepEqual(nativeSwaps.map((s) => s.side), ['BUY', 'SELL']);
  assert.equal(nativeSwaps[0].valueUsd, 6_000);
  assert.ok(near(nativeSwaps[0].executionPriceUsd, 60));
  assert.equal(nativeSwaps[1].valueUsd, 3_100);
  assert.equal(nativeSwaps[0].evidence, 'paired-native-quote-explorer-transfers');
  assert.equal(nativeSwaps[0].classification, 'observed-only');
  assert.equal(nativeSwaps[0].admission, 'excluded-from-verified-score-and-consensus');
});
check('ambiguous, failed, stable-target and unknown-method native bundles are rejected', () => {
  const transfers = [...nativeInput.transfers];
  const transactions = [...nativeInput.transactions, evmTx(hash(3), { success: false }),
    evmTx(hash(4)), evmTx(hash(5)), evmTx(hash(6), { method: 'transfer' })];
  transfers.push(
    // failed tx
    evmLeg(hash(3), nativeAt, 'out', WETH, 'WETH', 1), evmLeg(hash(3), nativeAt, 'in', TOKEN, 'TEST', 10),
    // three legs: a bundle, not one fill
    evmLeg(hash(4), nativeAt, 'out', WETH, 'WETH', 1), evmLeg(hash(4), nativeAt, 'in', TOKEN, 'TEST', 10),
    evmLeg(hash(4), nativeAt, 'in', USDC, 'USDC', 5),
    // wrapped native into a stablecoin is not a target-token trade here
    evmLeg(hash(5), nativeAt, 'out', WETH, 'WETH', 1), evmLeg(hash(5), nativeAt, 'in', USDC, 'USDC', 3_000),
    // no proven DEX method/router evidence
    { ...evmLeg(hash(6), nativeAt, 'out', WETH, 'WETH', 1), method: 'transfer' },
    { ...evmLeg(hash(6), nativeAt, 'in', TOKEN, 'TEST', 10), method: 'transfer' }
  );
  const out = reconstructNativeQuoteSwaps({ chain: 1, address: EVM_WALLET, transfers, transactions, priceAt, now });
  assert.deepEqual(out.map((s) => s.hash), [hash(1), hash(2)]);
});
check('bare numbers, daily-labelled and distant price points leave USD null', () => {
  const badPrices = [
    () => 3_000,
    (ts) => ({ usd: 3_000, at: ts, granularity: 'daily', source: 'daily' }),
    (ts) => ({ usd: 3_000, at: ts + 3 * HOUR, granularity: 'hourly', source: 'far' })
  ];
  for (const bad of badPrices) {
    const out = reconstructNativeQuoteSwaps({ ...nativeInput, priceAt: bad });
    assert.equal(out.length, 2);
    assert.ok(out.every((s) => s.valueUsd === null && s.executionPriceUsd === null && s.quoteAmount > 0));
  }
});
check('native-quote rows do not enter verified performance or score', () => {
  const audit = analyzePerformance({
    ...nativeInput, prices: new Map(), balances: [], historyLive: true
  });
  assert.equal(audit.swaps.length, 0);
  assert.equal(audit.closed.length, 0);
  assert.equal(audit.smartMoney.score, null);
  assert.equal(audit.smartMoney.qualified, false);
  assert.equal(audit.pnl.reason, 'NO_CONFIRMED_SWAPS');
});
check('native-quote rows cannot alter an existing verified consensus row', () => {
  const fixture = verifiedFixture({ now, buyRecently: true });
  const qualifiedWallet = fixture.profiles[0].address;
  const transfers = [
    { ...evmLeg(hash(99), now - 60_000, 'out', WETH, 'WETH', 10), from: qualifiedWallet },
    { ...evmLeg(hash(99), now - 60_000, 'in', TOKEN, 'TEST', 10_000), to: qualifiedWallet }
  ];
  const observed = reconstructNativeQuoteSwaps({
    chain: 1, address: qualifiedWallet, transfers, transactions: [evmTx(hash(99))],
    priceAt: (ts) => ({ usd: 3_000, at: ts, granularity: 'hourly', source: 'probe' }), now
  });
  assert.equal(observed.length, 1);
  const mixed = buildConsensus({
    profiles: fixture.profiles, swaps: [...fixture.swaps, ...observed],
    now, window: '24h', indexedAt: now - 1_000
  });
  const before = fixture.snapshot.consensus.find((r) => r.token === TOKEN);
  const after = mixed.consensus.find((r) => r.token === TOKEN);
  assert.ok(before && after);
  assert.equal(after.buyUsd, before.buyUsd);
  assert.equal(after.sellUsd, before.sellUsd);
  assert.equal(after.swaps, before.swaps);
  assert.equal(after.confidence, before.confidence);
  const observedOnly = buildConsensus({
    profiles: fixture.profiles, swaps: observed, now, window: '24h', indexedAt: now - 1_000
  });
  assert.equal(observedOnly.consensus.length, 0);
});

/* ── 3. Solana token-balance delta decoder ────────────────────────────── */
const SOL_WALLET = '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU';
const OTHER_OWNER = '4Nd1mPz9zVfcYVvJDJdBvwtRz3v3WfNv9x8qW7c1YAAA';
const BONK = 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263';
const SOL_USDC = Object.keys(SOLANA_USD_QUOTES).find((m) => SOLANA_USD_QUOTES[m].symbol === 'USDC');
const JUPITER = Object.keys(SOLANA_DEX_PROGRAMS).find((p) => SOLANA_DEX_PROGRAMS[p] === 'Jupiter v6');
const sig = (c) => c.repeat(88);
const bal = (owner, mint, amount, decimals, accountIndex = 1) => ({
  accountIndex, mint, owner,
  programId: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
  uiTokenAmount: { amount: String(amount), decimals, uiAmount: null, uiAmountString: '0' }
});
const solTx = ({
  signature = sig('A'), at = now - HOUR, pre = [], post = [], programId = JUPITER, err = null
} = {}) => ({
  signature,
  blockTime: Math.floor(at / 1000),
  slot: 123,
  transaction: {
    signatures: [signature],
    message: { accountKeys: [SOL_WALLET], instructions: [{ programId: '11111111111111111111111111111111' }] }
  },
  meta: {
    err,
    preTokenBalances: pre,
    postTokenBalances: post,
    innerInstructions: [{ index: 0, instructions: [{ programId }] }]
  }
});
const buyPre = [bal(SOL_WALLET, SOL_USDC, '1000000000', 6, 1), bal(SOL_WALLET, BONK, '0', 5, 2),
  bal(OTHER_OWNER, BONK, '999000000000', 5, 3)];
const buyPost = [bal(SOL_WALLET, SOL_USDC, '750000000', 6, 1), bal(SOL_WALLET, BONK, '200000000000', 5, 2),
  bal(OTHER_OWNER, BONK, '799000000000', 5, 3)];
const solBuy = solTx({ pre: buyPre, post: buyPost });
check('Solana stable-quoted balance-delta BUY decodes as observed-only', () => {
  const out = decodeSolanaSwap(solBuy, SOL_WALLET, { now });
  assert.ok(out);
  assert.equal(out.side, 'BUY');
  assert.equal(out.amount, 2_000_000);
  assert.equal(out.valueUsd, 250);
  assert.ok(near(out.executionPriceUsd, 0.000125));
  assert.equal(out.dex, 'Jupiter v6');
  assert.equal(out.evidence, 'decoded-solana-token-balance-deltas');
  assert.equal(out.classification, 'observed-only');
});
check('Solana decoder uses exact BigInt deltas above Number.MAX_SAFE_INTEGER', () => {
  const bigPre = '9007199254740993';
  const bigPost = '9007199254740994';
  const tx = solTx({
    signature: sig('B'),
    pre: [bal(SOL_WALLET, SOL_USDC, '2000000', 6, 1), bal(SOL_WALLET, BONK, bigPre, 0, 2)],
    post: [bal(SOL_WALLET, SOL_USDC, '1000000', 6, 1), bal(SOL_WALLET, BONK, bigPost, 0, 2)]
  });
  const out = decodeSolanaSwap(tx, SOL_WALLET, { now });
  assert.equal(out.amount, 1);
});
check('Solana decoder rejects failed, unknown-program, 3-mint, same-sign, WSOL and ownerless proofs', () => {
  const failed = solTx({ pre: buyPre, post: buyPost, err: { InstructionError: [0, 'Custom'] } });
  const unknown = solTx({ signature: sig('C'), pre: buyPre, post: buyPost, programId: OTHER_OWNER });
  const thirdMint = 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB';
  const three = solTx({
    signature: sig('D'),
    pre: [...buyPre, bal(SOL_WALLET, thirdMint, '1000000', 6, 4)],
    post: [...buyPost, bal(SOL_WALLET, thirdMint, '2000000', 6, 4)]
  });
  const sameSign = solTx({
    signature: sig('E'),
    pre: [bal(SOL_WALLET, SOL_USDC, '1000000', 6, 1), bal(SOL_WALLET, BONK, '0', 5, 2)],
    post: [bal(SOL_WALLET, SOL_USDC, '2000000', 6, 1), bal(SOL_WALLET, BONK, '100000', 5, 2)]
  });
  const wsol = 'So11111111111111111111111111111111111111112';
  const nativeTarget = solTx({
    signature: sig('F'),
    pre: [bal(SOL_WALLET, SOL_USDC, '2000000', 6, 1), bal(SOL_WALLET, wsol, '0', 9, 2)],
    post: [bal(SOL_WALLET, SOL_USDC, '1000000', 6, 1), bal(SOL_WALLET, wsol, '1000000000', 9, 2)]
  });
  const ownerless = structuredClone(solBuy);
  delete ownerless.meta.postTokenBalances[0].owner;
  for (const tx of [failed, unknown, three, sameSign, nativeTarget, ownerless]) {
    assert.equal(decodeSolanaSwap(tx, SOL_WALLET, { now }), null);
  }
  const sorted = reconstructSolanaSwaps({
    address: SOL_WALLET,
    transactions: [solTx({ signature: sig('G'), at: now - 30 * 60_000, pre: buyPre, post: buyPost }), solBuy],
    now
  });
  assert.equal(sorted.length, 2);
  assert.ok(sorted[0].timestamp < sorted[1].timestamp);
});

/* ── 4. Solana getTransaction source accounting ───────────────────────── */
await checkAsync('solTransactions caps/dedupes and reports partial reads honestly', async () => {
  const calls = [];
  __setFetchForTests(async (_url, opts) => {
    const body = JSON.parse(opts.body);
    calls.push(body);
    const s = body.params[0];
    if (s === sig('H')) throw new Error('rpc down');
    const result = s === sig('A') ? solBuy : null;
    return { ok: true, json: async () => ({ jsonrpc: '2.0', id: 1, result }) };
  });
  try {
    const out = await solTransactions([sig('A'), sig('A'), 'bad', sig('H'), sig('J')], {
      limit: 25, timeoutMs: 2_000, concurrency: 2
    });
    assert.equal(out.dataStatus, 'partial');
    assert.equal(out.requested, 3);
    assert.equal(out.attempted, 3);
    assert.equal(out.fetched, 1);
    assert.equal(out.failed, 2);
    assert.equal(out.rows[0].signature, sig('A'));
    assert.ok(calls.every((c) => c.method === 'getTransaction'));
    assert.ok(calls.every((c) => c.params[1].encoding === 'jsonParsed'
      && c.params[1].maxSupportedTransactionVersion === 0));
  } finally { __setFetchForTests(null); }
});

/* ── 5. Wallet API wiring (real module, stubbed network boundary) ─────── */
await checkAsync('EVM wallet response carries priced native observation while verified stays empty', async () => {
  const wallet = `0x${'7'.repeat(40)}`;
  const pool = `0x${'8'.repeat(40)}`;
  const txHash = hash(777);
  const atIso = new Date(nativeAt).toISOString();
  const party = (addressHash, isContract = false) => ({ hash: addressHash, is_contract: isContract, is_scam: false, metadata: null, name: null });
  const transfer = (from, to, token, symbol, raw, decimals) => ({
    transaction_hash: txHash, timestamp: atIso, method: 'swapExactTokensForTokens',
    from: party(from, from === pool), to: party(to, to === pool),
    total: { value: String(raw), decimals: String(decimals) },
    token: { address_hash: token, symbol, decimals: String(decimals), type: 'ERC-20' }
  });
  __setFetchForTests(async (url) => {
    const u = String(url);
    if (u.includes('api.dexscreener.com')) return { ok: true, json: async () => ({ pairs: [] }) };
    if (u.includes('/token-transfers')) return { ok: true, json: async () => ({ items: [
      transfer(wallet, pool, WETH, 'WETH', '2000000000000000000', 18),
      transfer(pool, wallet, TOKEN, 'TEST', '100000000000000000000', 18)
    ] }) };
    if (u.includes('/transactions')) return { ok: true, json: async () => ({ items: [{
      hash: txHash, timestamp: atIso, status: 'ok', method: 'swapExactTokensForTokens', value: '0',
      from: party(wallet), to: party(pool, true)
    }] }) };
    if (u.includes('/token-balances')) return { ok: true, json: async () => [] };
    if (u.includes('/counters')) return { ok: true, json: async () => ({ transactions_count: 1, token_transfers_count: 2 }) };
    throw new Error(`unexpected url ${u}`);
  });
  const series = [-2, -1, 0, 1, 2].map((h) => [nativeAt + h * HOUR, 3_000 + h]);
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ prices: series }) });
  try {
    const out = await analyzeWallet(wallet, 1, { timeoutMs: 6_000 });
    assert.equal(out.verifiedSwaps.length, 0);
    assert.equal(out.observedSwaps.length, 1);
    assert.equal(out.observedSwaps[0].valueUsd, 6_000);
    assert.equal(out.swapEvidence.observedOnly.admittedToConsensus, false);
    assert.equal(out.smartMoney.score, null);
    assert.equal(out.smartMoney.qualified, false);
    assert.equal(out.pnl.reason, 'NO_CONFIRMED_SWAPS');
    assert.equal(out.sources.nativeQuotePricing, 'live');
  } finally {
    __setFetchForTests(null);
    globalThis.fetch = originalFetch;
  }
});
await checkAsync('Solana wallet response carries decoded observation but no score or verified swaps', async () => {
  __setFetchForTests(async (url, opts) => {
    const u = String(url);
    if (u.includes('api.dexscreener.com')) return { ok: true, json: async () => ({ pairs: [] }) };
    const body = JSON.parse(opts.body);
    let result;
    if (body.method === 'getSignaturesForAddress') {
      result = [{ signature: sig('A'), slot: 123, blockTime: Math.floor((now - HOUR) / 1000), err: null }];
    } else if (body.method === 'getBalance') result = { value: 1_000_000_000 };
    else if (body.method === 'getTokenAccountsByOwner') result = { value: [] };
    else if (body.method === 'getTransaction') result = solBuy;
    else throw new Error(`unexpected method ${body.method}`);
    return { ok: true, json: async () => ({ jsonrpc: '2.0', id: 1, result }) };
  });
  globalThis.fetch = async () => { throw new Error('price source down for probe'); };
  try {
    const out = await analyzeWallet(SOL_WALLET, 'solana', { timeoutMs: 6_000 });
    assert.equal(out.verifiedSwaps.length, 0);
    assert.equal(out.observedSwaps.length, 1);
    assert.equal(out.observedSwaps[0].valueUsd, 250);
    assert.equal(out.smartMoney.score, null);
    assert.equal(out.smartMoney.status, 'UNAVAILABLE');
    assert.equal(out.smartMoney.qualified, false);
    assert.equal(out.smartMoney.sample.swaps, 0);
    assert.equal(out.smartMoney.sample.observedOnlySwaps, 1);
    assert.equal(out.swapEvidence.observedOnly.decodedTransactions, 1);
    assert.equal(out.sources.decodedTransactions, 'live');
  } finally {
    __setFetchForTests(null);
    globalThis.fetch = originalFetch;
  }
});

for (const line of results) console.log(line);
const failed = results.filter((r) => r.startsWith('✗'));
console.log(`\nSmart Money phase-3 probe: ${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) process.exit(1);
