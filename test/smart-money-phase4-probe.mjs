#!/usr/bin/env node
/**
 * Smart Money phase 4 (2026-10-25) — regression probe.
 *
 * Proves, without upstream network access:
 *   1. Stable- and wrapped-native-quoted EVM fills share one FIFO ledger when
 *      (and only when) every sampled native candidate has revalidatable
 *      hourly pricing; one unpriced sibling blocks the whole native stream.
 *   2. Persisted-row consumers revalidate promoted native provenance instead
 *      of trusting labels, so a priced observation or a tampered replay
 *      still cannot vote.
 *   3. Solana signature reads paginate with `before`, transaction details can
 *      cover the same 300-signature bound, and decoded swaps distinguish
 *      balance-only rows from exact instruction-corroborated fills.
 *   4. A complete, fully corroborated Solana sample is labelled shadow-ready
 *      while still producing no verified score, P&L or consensus admission.
 *
 * Run: node test/smart-money-phase4-probe.mjs
 */
process.env.NODE_ENV = 'test';
delete process.env.BLOB_READ_WRITE_TOKEN;
delete process.env.ETHERSCAN_API_KEY;
delete process.env.ETHERSCAN_KEYS;

import assert from 'node:assert/strict';
import { EVM_CHAINS } from '../server/chainsLite.js';
import {
  USD_QUOTES,
  analyzePerformance,
  analyzeSwapLedger,
  isPricedNativeQuoteSwap,
  isVerifiedPairedSwap,
  reconstructNativeQuoteSwaps
} from '../server/smartMoney/performance.js';
import {
  __setFetchForTests,
  solSignatures,
  solTransactions
} from '../server/smartMoney/dataSources.js';
import {
  SOLANA_DEX_PROGRAMS,
  SOLANA_USD_QUOTES,
  assessSolanaSwapLedger,
  decodeSolanaSwap,
  isInstructionCorroboratedSolanaSwap
} from '../server/smartMoney/solanaSwaps.js';
import { analyzeWallet } from '../server/smartMoney/walletIntel.js';
import { buildConsensus, observedLayer } from '../server/smartMoney/consensus.js';
import { readVerifiedIndex, runIntelligenceCycle } from '../server/smartMoney/intelligence.js';
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
const originalFetch = globalThis.fetch;

/* ── EVM unified stable/native ledger ─────────────────────────────────── */
const EVM_WALLET = `0x${'a'.repeat(40)}`;
const WETH = EVM_CHAINS[1].wrapped.toLowerCase();
const USDC = USD_QUOTES[1][0];
const hash = (n) => `0x${n.toString(16).padStart(64, '0')}`;
const evmLeg = (h, ts, direction, token, symbol, amount) => ({
  hash: h, timestamp: ts, direction,
  token: { address: token, symbol }, amount, method: 'swapExactTokensForTokens'
});
const evmTx = (h) => ({ hash: h, success: true, method: 'swapExactTokensForTokens' });

function addPair(transfers, transactions, n, ts, { side, quoteToken, quoteSymbol, quoteAmount,
  token = TOKEN, symbol = 'TEST', tokenAmount = 100 }) {
  const h = hash(n);
  transactions.push(evmTx(h));
  if (side === 'BUY') {
    transfers.push(
      evmLeg(h, ts, 'out', quoteToken, quoteSymbol, quoteAmount),
      evmLeg(h, ts, 'in', token, symbol, tokenAmount)
    );
  } else {
    transfers.push(
      evmLeg(h, ts, 'out', token, symbol, tokenAmount),
      evmLeg(h, ts, 'in', quoteToken, quoteSymbol, quoteAmount)
    );
  }
}
const addStable = (transfers, transactions, n, ts, side, usd, tokenAmount = 100) => addPair(
  transfers, transactions, n, ts,
  { side, quoteToken: USDC, quoteSymbol: 'USDC', quoteAmount: usd, tokenAmount }
);
const addNative = (transfers, transactions, n, ts, side, weth, tokenAmount = 100) => addPair(
  transfers, transactions, n, ts,
  { side, quoteToken: WETH, quoteSymbol: 'WETH', quoteAmount: weth, tokenAmount }
);
const ethPriceAt = (ts) => ({
  usd: 2_000, at: ts + 5 * 60_000, granularity: 'hourly', source: 'phase4-probe-hourly'
});

check('cross-quote FIFO closes stable lots with native exits and native lots with stable exits', () => {
  const transfers = [];
  const transactions = [];
  const t0 = now - 20 * DAY;
  addStable(transfers, transactions, 1, t0, 'BUY', 1_000, 100);
  addNative(transfers, transactions, 2, t0 + DAY, 'SELL', 0.375, 50); // $750
  addNative(transfers, transactions, 3, t0 + 2 * DAY, 'BUY', 0.3, 50); // $600
  addStable(transfers, transactions, 4, t0 + 3 * DAY, 'SELL', 1_500, 100);
  const audit = analyzePerformance({
    chain: 1, address: EVM_WALLET, transfers, transactions,
    prices: new Map(), balances: [{ token: TOKEN, amount: 0 }],
    historyLive: true, nativePriceAt: ethPriceAt, now
  });
  assert.equal(audit.nativePromotion.promoted, true);
  assert.equal(audit.swaps.length, 4);
  assert.equal(audit.smartMoney.sample.stableQuoteSwaps, 2);
  assert.equal(audit.smartMoney.sample.nativeQuoteSwaps, 2);
  assert.equal(audit.nativeCandidates.length, 0);
  assert.equal(audit.closed.length, 2);
  assert.equal(audit.closed[0].pnlUsd, 250);
  assert.equal(audit.closed[0].exitEvidence, 'paired-native-quote-explorer-transfers');
  assert.equal(audit.closed[1].costUsd, 1_100);
  assert.equal(audit.closed[1].pnlUsd, 400);
  assert.deepEqual(audit.closed[1].entryEvidence, [
    'paired-explorer-transfers', 'paired-native-quote-explorer-transfers'
  ]);
  assert.equal(audit.pnl.realizedUsd, 650);
  assert.equal(audit.positions.length, 0);
});

check('a fully priced alternating-quote history can reach the existing verified score gate', () => {
  const transfers = [];
  const transactions = [];
  const t0 = now - 30 * DAY;
  for (let i = 0; i < 6; i++) {
    const buyAt = t0 + i * 2 * DAY;
    const sellAt = buyAt + DAY;
    if (i % 2 === 0) {
      addStable(transfers, transactions, 100 + i * 2, buyAt, 'BUY', 1_000);
      addNative(transfers, transactions, 101 + i * 2, sellAt, 'SELL', 0.6); // $1,200
    } else {
      addNative(transfers, transactions, 100 + i * 2, buyAt, 'BUY', 0.5); // $1,000
      addStable(transfers, transactions, 101 + i * 2, sellAt, 'SELL', 1_200);
    }
  }
  const audit = analyzePerformance({
    chain: 1, address: EVM_WALLET, transfers, transactions,
    prices: new Map(), balances: [{ token: TOKEN, amount: 0 }],
    historyLive: true, nativePriceAt: ethPriceAt, now
  });
  assert.equal(audit.swaps.length, 12);
  assert.equal(audit.closed.length, 6);
  assert.equal(audit.pnl.realizedUsd, 1_200);
  assert.equal(audit.smartMoney.sample.nativeQuotePromoted, true);
  assert.ok(audit.smartMoney.score >= 70);
  assert.equal(audit.smartMoney.qualified, true);
});

check('one unpriced native candidate blocks every native row, including a priced sibling', () => {
  const transfers = [];
  const transactions = [];
  const t0 = now - 12 * DAY;
  addStable(transfers, transactions, 201, t0, 'BUY', 1_000);
  addStable(transfers, transactions, 202, t0 + DAY, 'SELL', 1_100);
  addNative(transfers, transactions, 203, t0 + 2 * DAY, 'BUY', 0.5);
  addNative(transfers, transactions, 204, t0 + 3 * DAY, 'BUY', 0.5);
  const onlyFirstPriced = (ts) => ts === t0 + 2 * DAY ? ethPriceAt(ts) : null;
  const audit = analyzePerformance({
    chain: 1, address: EVM_WALLET, transfers, transactions,
    prices: new Map(), balances: [], historyLive: true,
    nativePriceAt: onlyFirstPriced, now
  });
  assert.equal(audit.nativePromotion.status, 'blocked-unpriced-native-candidate');
  assert.equal(audit.nativePromotion.pricedCandidates, 1);
  assert.equal(audit.nativePromotion.unpricedCandidates, 1);
  assert.equal(audit.swaps.length, 2);
  assert.ok(audit.swaps.every((s) => s.evidence === 'paired-explorer-transfers'));
  assert.equal(audit.nativeCandidates.length, 2);
  assert.equal(audit.nativeCandidates[0].classification, 'observed-only');
  assert.equal(audit.nativeCandidates[0].valueUsd, 1_000);
  assert.equal(audit.nativeCandidates[1].valueUsd, null);
  assert.equal(audit.pnl.realizedUsd, 100);

  const noSource = analyzePerformance({
    chain: 1, address: EVM_WALLET, transfers, transactions,
    prices: new Map(), balances: [], historyLive: true, now
  });
  assert.equal(noSource.nativePromotion.status, 'blocked-no-hourly-price-source');
  assert.equal(noSource.swaps.length, 2);
});

check('consumer admission revalidates native labels, timing, granularity and USD arithmetic', () => {
  const transfers = [];
  const transactions = [];
  const at = now - DAY;
  addNative(transfers, transactions, 301, at, 'BUY', 0.5);
  const observed = reconstructNativeQuoteSwaps({
    chain: 1, address: EVM_WALLET, transfers, transactions, priceAt: ethPriceAt, now
  })[0];
  assert.equal(isPricedNativeQuoteSwap(observed), true);
  assert.equal(isVerifiedPairedSwap(observed), false);

  const audit = analyzePerformance({
    chain: 1, address: EVM_WALLET, transfers, transactions,
    prices: new Map(), balances: [], historyLive: true, nativePriceAt: ethPriceAt, now
  });
  const promoted = audit.swaps[0];
  assert.equal(isVerifiedPairedSwap(promoted), true);
  assert.equal(isVerifiedPairedSwap({ ...promoted, quotePriceGranularity: 'daily' }), false);
  assert.equal(isVerifiedPairedSwap({ ...promoted, quotePriceAt: promoted.quotePriceAt + 2 * HOUR }), false);
  assert.equal(isVerifiedPairedSwap({ ...promoted, valueUsd: promoted.valueUsd + 1_000 }), false);
  assert.equal(isVerifiedPairedSwap({ ...promoted, classification: 'observed-only' }), false);
});

check('promoted native fills count in consensus and the observed layer; tampered replays do not', () => {
  const fixture = verifiedFixture({ now, buyRecently: true });
  const wallet = fixture.profiles[0].address;
  const transfers = [];
  const transactions = [];
  addNative(transfers, transactions, 401, now - 60_000, 'BUY', 2); // $4,000
  const promoted = analyzePerformance({
    chain: 1, address: wallet, transfers, transactions,
    prices: new Map(), balances: [], historyLive: true, nativePriceAt: ethPriceAt, now
  }).swaps[0];
  const before = fixture.snapshot.consensus.find((r) => r.token === TOKEN);
  const afterSnapshot = buildConsensus({
    profiles: fixture.profiles,
    swaps: [...fixture.swaps, promoted],
    now, window: '24h', indexedAt: now - 1_000
  });
  const after = afterSnapshot.consensus.find((r) => r.token === TOKEN);
  assert.ok(before && after);
  assert.ok(near(after.capitalEnteringUsd, before.capitalEnteringUsd + 4_000));
  const edge = afterSnapshot.graph.edges.find((e) => e.to.endsWith(TOKEN));
  assert.equal(edge.evidence, 'paired-stable-and-native-explorer-transfers');

  const layer = observedLayer({
    profiles: fixture.profiles, swaps: [promoted], cutoff: now - DAY, now, win: '24h'
  });
  assert.equal(layer.swapsInWindow, 1);

  const tampered = { ...promoted, quotePriceGranularity: 'daily' };
  const rejected = buildConsensus({
    profiles: fixture.profiles, swaps: [...fixture.swaps, tampered],
    now, window: '24h', indexedAt: now - 1_000
  });
  assert.ok(near(
    rejected.consensus.find((r) => r.token === TOKEN).capitalEnteringUsd,
    before.capitalEnteringUsd
  ));
});

await checkAsync('verified index stores promoted native rows and drops non-revalidatable replays', async () => {
  const wallet = `0x${'9'.repeat(40)}`;
  const transfers = [];
  const transactions = [];
  addNative(transfers, transactions, 501, now - HOUR, 'BUY', 1);
  const promoted = analyzePerformance({
    chain: 1, address: wallet, transfers, transactions,
    prices: new Map(), balances: [], historyLive: true, nativePriceAt: ethPriceAt, now
  }).swaps[0];
  const walletResult = (address, swaps) => ({
    address, chain: 1,
    smartMoney: { score: 90, coverage: 0.8, qualified: true, status: 'SCORED', sample: {} },
    performance: { closedTrades: 6, realizedPnlUsd: 500, winRate: 80 },
    verifiedSwaps: swaps, closedTrades: [], sources: { history: 'live' }
  });
  const good = await runIntelligenceCycle({
    now,
    candidates: [{ chain: 1, address: wallet }],
    analyze: async (address) => walletResult(address, [promoted]),
    maxWallets: 1
  });
  assert.equal(good.indexedSwaps, 1);
  const index = await readVerifiedIndex();
  assert.equal(index.swaps.find((s) => s.id === promoted.id)?.classification, 'verified');

  const otherWallet = `0x${'8'.repeat(40)}`;
  const tampered = {
    ...promoted,
    id: `${promoted.id}:tampered`, wallet: otherWallet,
    quotePriceGranularity: 'daily'
  };
  const bad = await runIntelligenceCycle({
    now: now + 1_000,
    candidates: [{ chain: 1, address: otherWallet }],
    analyze: async (address) => walletResult(address, [tampered]),
    maxWallets: 1
  });
  assert.equal(bad.indexedSwaps, 0);
});

/* ── Solana pagination + instruction-level decoding ───────────────────── */
const SOL_WALLET = '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU';
const OTHER_OWNER = '4Nd1mPz9zVfcYVvJDJdBvwtRz3v3WfNv9x8qW7c1YAAA';
const BONK = 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263';
const SOL_USDC = Object.keys(SOLANA_USD_QUOTES).find((m) => SOLANA_USD_QUOTES[m].symbol === 'USDC');
const JUPITER = Object.keys(SOLANA_DEX_PROGRAMS).find((p) => SOLANA_DEX_PROGRAMS[p] === 'Jupiter v6');
const TOKEN_PROGRAM = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const TOKEN_2022_PROGRAM = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';
const BASE58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const sigFor = (i) => {
  let x = i;
  let prefix = '';
  for (let pos = 0; pos < 4; pos++) {
    prefix = BASE58[x % 58] + prefix;
    x = Math.floor(x / 58);
  }
  return `${prefix}${'A'.repeat(84)}`;
};
const WALLET_USDC_ATA = 'A'.repeat(44);
const WALLET_TARGET_ATA = 'B'.repeat(44);
const POOL_USDC_ATA = 'C'.repeat(44);
const POOL_TARGET_ATA = 'D'.repeat(44);
const pk = (pubkey) => ({ pubkey, signer: pubkey === SOL_WALLET, writable: true });
const bal = (owner, mint, amount, decimals, accountIndex) => ({
  accountIndex, mint, owner, programId: TOKEN_PROGRAM,
  uiTokenAmount: { amount: String(amount), decimals, uiAmount: null, uiAmountString: '0' }
});
const transferChecked = ({ source, destination, mint, amount, decimals, authority }) => ({
  program: 'spl-token', programId: TOKEN_PROGRAM,
  parsed: {
    type: 'transferChecked',
    info: {
      source, destination, mint, authority,
      tokenAmount: { amount: String(amount), decimals, uiAmount: null, uiAmountString: '0' }
    }
  }
});

function solSwapTx({ signature, at, side = 'BUY', loaded = false, mutateInstructions = null } = {}) {
  const buy = side === 'BUY';
  const pre = [
    bal(SOL_WALLET, SOL_USDC, buy ? '1000000000' : '750000000', 6, 1),
    bal(SOL_WALLET, BONK, buy ? '0' : '200000000000', 5, 2),
    bal(OTHER_OWNER, SOL_USDC, buy ? '0' : '1000000000', 6, 3),
    bal(OTHER_OWNER, BONK, buy ? '300000000000' : '100000000000', 5, 4)
  ];
  const post = [
    bal(SOL_WALLET, SOL_USDC, buy ? '750000000' : '1050000000', 6, 1),
    bal(SOL_WALLET, BONK, buy ? '200000000000' : '100000000000', 5, 2),
    bal(OTHER_OWNER, SOL_USDC, buy ? '250000000' : '700000000', 6, 3),
    bal(OTHER_OWNER, BONK, buy ? '100000000000' : '200000000000', 5, 4)
  ];
  let instructions = buy ? [
    transferChecked({
      source: WALLET_USDC_ATA, destination: POOL_USDC_ATA, mint: SOL_USDC,
      amount: '250000000', decimals: 6, authority: SOL_WALLET
    }),
    transferChecked({
      source: POOL_TARGET_ATA, destination: WALLET_TARGET_ATA, mint: BONK,
      amount: '120000000000', decimals: 5, authority: OTHER_OWNER
    }),
    transferChecked({
      source: POOL_TARGET_ATA, destination: WALLET_TARGET_ATA, mint: BONK,
      amount: '80000000000', decimals: 5, authority: OTHER_OWNER
    })
  ] : [
    transferChecked({
      source: WALLET_TARGET_ATA, destination: POOL_TARGET_ATA, mint: BONK,
      amount: '100000000000', decimals: 5, authority: SOL_WALLET
    }),
    transferChecked({
      source: POOL_USDC_ATA, destination: WALLET_USDC_ATA, mint: SOL_USDC,
      amount: '300000000', decimals: 6, authority: OTHER_OWNER
    })
  ];
  if (typeof mutateInstructions === 'function') instructions = mutateInstructions(instructions);
  const staticKeys = loaded
    ? [pk(SOL_WALLET), pk(WALLET_USDC_ATA), pk(WALLET_TARGET_ATA)]
    : [pk(SOL_WALLET), pk(WALLET_USDC_ATA), pk(WALLET_TARGET_ATA),
      pk(POOL_USDC_ATA), pk(POOL_TARGET_ATA), pk(JUPITER), pk(TOKEN_PROGRAM)];
  return {
    signature,
    blockTime: Math.floor(at / 1000),
    slot: 321,
    version: loaded ? 0 : 'legacy',
    transaction: {
      signatures: [signature],
      message: {
        accountKeys: staticKeys,
        instructions: [{ programId: JUPITER, accounts: [], data: 'route' }]
      }
    },
    meta: {
      err: null,
      ...(loaded ? { loadedAddresses: { writable: [POOL_USDC_ATA, POOL_TARGET_ATA, JUPITER, TOKEN_PROGRAM], readonly: [] } } : {}),
      preTokenBalances: pre,
      postTokenBalances: post,
      innerInstructions: [{ index: 0, instructions }]
    }
  };
}

const solBuy = solSwapTx({ signature: sigFor(1), at: now - 2 * DAY, side: 'BUY' });
const solSell = solSwapTx({ signature: sigFor(2), at: now - DAY, side: 'SELL' });

check('Solana split instruction fills reconcile exactly with both balance deltas', () => {
  const out = decodeSolanaSwap(solBuy, SOL_WALLET, { now });
  assert.ok(out);
  assert.equal(out.decodeMethod, 'instruction-corroborated-token-balance-deltas');
  assert.equal(out.instructionCorroborated, true);
  assert.equal(out.instructionFillCount, 3);
  assert.deepEqual(out.instructionTransfers, { target: 2, quote: 1 });
  assert.equal(isInstructionCorroboratedSolanaSwap(out), true);
  assert.equal(out.classification, 'observed-only');
  assert.equal(out.admission, 'excluded-from-verified-score-and-consensus');
});

check('Solana corroboration survives lookup-table accounts and plain Token-2022 transfer shape', () => {
  const loaded = solSwapTx({ signature: sigFor(3), at: now - 2 * DAY, side: 'BUY', loaded: true });
  assert.equal(decodeSolanaSwap(loaded, SOL_WALLET, { now }).instructionCorroborated, true);

  const plain = solSwapTx({
    signature: sigFor(4), at: now - 2 * DAY, side: 'BUY',
    mutateInstructions: (rows) => rows.map((row, i) => i === 0 ? {
      program: 'spl-token-2022', programId: TOKEN_2022_PROGRAM,
      parsed: {
        type: 'transfer',
        info: {
          source: WALLET_USDC_ATA, destination: POOL_USDC_ATA,
          amount: '250000000', authority: SOL_WALLET
        }
      }
    } : row)
  });
  assert.equal(decodeSolanaSwap(plain, SOL_WALLET, { now }).instructionCorroborated, true);
});

check('a one-raw-unit instruction mismatch downgrades to balance-only instead of rejecting the observation', () => {
  const mismatched = solSwapTx({
    signature: sigFor(5), at: now - 2 * DAY, side: 'BUY',
    mutateInstructions: (rows) => rows.map((row, i) => i === 2
      ? structuredClone(row) : row).map((row, i) => {
        if (i !== 2) return row;
        row.parsed.info.tokenAmount.amount = '79999999999';
        return row;
      })
  });
  const out = decodeSolanaSwap(mismatched, SOL_WALLET, { now });
  assert.ok(out);
  assert.equal(out.decodeMethod, 'token-balance-deltas');
  assert.equal(out.instructionCorroborated, false);
  assert.equal(out.instructionFillCount, 0);
});

check('shared FIFO core preserves case-sensitive Solana mints and current priceUsd markets', () => {
  const buy = decodeSolanaSwap(solBuy, SOL_WALLET, { now });
  const sell = decodeSolanaSwap(solSell, SOL_WALLET, { now });
  const audit = analyzeSwapLedger({
    swaps: [buy, sell],
    prices: new Map([[BONK, { priceUsd: 0.0002, pairCreatedAt: 0 }]]),
    balances: [{ token: BONK, amount: 1_000_000 }],
    historyLive: true, now,
    quoteSummary: 'canonical Solana USDC ≈ $1'
  });
  assert.equal(audit.invalidSwaps, 0);
  assert.equal(audit.closed.length, 1);
  assert.equal(audit.closed[0].pnlUsd, 175);
  assert.equal(audit.positions.length, 1);
  assert.equal(audit.positions[0].token, BONK);
  assert.equal(audit.positions[0].unrealizedUsd, 75);
});

await checkAsync('solSignatures paginates by before cursor and proves end-of-history only on a short page', async () => {
  const calls = [];
  const rows = [1, 2, 3, 4, 5].map((i) => ({
    signature: sigFor(i), slot: 100 - i, blockTime: Math.floor((now - i * HOUR) / 1000),
    err: i === 2 ? { InstructionError: [0, 'Custom'] } : null
  }));
  __setFetchForTests(async (_url, opts) => {
    const body = JSON.parse(opts.body);
    calls.push(body);
    const before = body.params[1].before;
    const start = before ? rows.findIndex((r) => r.signature === before) + 1 : 0;
    const result = rows.slice(start, start + body.params[1].limit);
    return { ok: true, json: async () => ({ jsonrpc: '2.0', id: 1, result }) };
  });
  try {
    const out = await solSignatures(SOL_WALLET, {
      limit: 10, pageLimit: 2, maxPages: 3, includeFailed: false, timeoutMs: 1_000
    });
    assert.deepEqual(out.rows.map((r) => r.signature), [sigFor(1), sigFor(3), sigFor(4), sigFor(5)]);
    assert.equal(out.scanned, 5);
    assert.equal(out.pagesFetched, 3);
    assert.equal(out.complete, true);
    assert.deepEqual(calls.map((c) => c.params[1].before), [undefined, sigFor(2), sigFor(4)]);

    const capped = await solSignatures(SOL_WALLET, {
      limit: 3, pageLimit: 2, maxPages: 2, timeoutMs: 1_000
    });
    assert.equal(capped.rows.length, 3);
    assert.equal(capped.complete, false);
    assert.equal(capped.hasMore, true);
  } finally { __setFetchForTests(null); }
});

await checkAsync('a failed later signature page stays partial and incomplete', async () => {
  let call = 0;
  __setFetchForTests(async (_url, opts) => {
    call++;
    if (call > 1) throw new Error('rpc down');
    const body = JSON.parse(opts.body);
    assert.equal(body.params[1].limit, 2);
    return {
      ok: true,
      json: async () => ({
        jsonrpc: '2.0', id: 1,
        result: [1, 2].map((i) => ({ signature: sigFor(i), slot: i, blockTime: Math.floor(now / 1000), err: null }))
      })
    };
  });
  try {
    const out = await solSignatures(SOL_WALLET, {
      limit: 10, pageLimit: 2, maxPages: 3, timeoutMs: 1_000
    });
    assert.equal(out.dataStatus, 'partial');
    assert.equal(out.pagesFetched, 1);
    assert.equal(out.complete, false);
    assert.equal(out.rows.length, 2);
  } finally { __setFetchForTests(null); }
});

await checkAsync('solTransactions covers more than the old 50-row cap and reports exact completeness', async () => {
  __setFetchForTests(async (_url, opts) => {
    const body = JSON.parse(opts.body);
    const signature = body.params[0];
    return {
      ok: true,
      json: async () => ({
        jsonrpc: '2.0', id: 1,
        result: {
          slot: 1, blockTime: Math.floor(now / 1000), version: 0,
          transaction: { signatures: [signature] }, meta: { err: null }
        }
      })
    };
  });
  try {
    const sigs = Array.from({ length: 60 }, (_, i) => sigFor(i + 1));
    const out = await solTransactions(sigs, { limit: 75, timeoutMs: 2_000, concurrency: 8 });
    assert.equal(out.requested, 60);
    assert.equal(out.attempted, 60);
    assert.equal(out.fetched, 60);
    assert.equal(out.complete, true);
    assert.equal(out.coverage, 1);
  } finally { __setFetchForTests(null); }
});

check('Solana shadow gate requires complete reads and corroboration for every decoded row', () => {
  const buy = decodeSolanaSwap(solBuy, SOL_WALLET, { now });
  const ready = assessSolanaSwapLedger({
    swaps: [buy],
    signatureCoverage: { complete: true },
    transactionCoverage: { complete: true }
  });
  assert.equal(ready.shadowEligible, true);
  assert.equal(ready.promoted, false);
  assert.equal(ready.admission, 'excluded-from-verified-score-and-consensus');

  const balanceOnly = { ...buy, id: `${buy.id}:balance-only`, decodeMethod: 'token-balance-deltas', instructionCorroborated: false };
  const mixed = assessSolanaSwapLedger({
    swaps: [buy, balanceOnly],
    signatureCoverage: { complete: true },
    transactionCoverage: { complete: true }
  });
  assert.equal(mixed.shadowEligible, false);
  assert.ok(mixed.blockers.includes('instruction-corroboration-incomplete'));

  const incomplete = assessSolanaSwapLedger({
    swaps: [buy],
    signatureCoverage: { complete: false },
    transactionCoverage: { complete: false }
  });
  assert.ok(incomplete.blockers.includes('signature-history-incomplete'));
  assert.ok(incomplete.blockers.includes('transaction-details-incomplete'));
});

await checkAsync('Solana wallet reports a shadow-ready sample without inventing a verified score', async () => {
  __setFetchForTests(async (url, opts) => {
    const u = String(url);
    if (u.includes('api.dexscreener.com')) return { ok: true, json: async () => ({ pairs: [] }) };
    const body = JSON.parse(opts.body);
    let result;
    if (body.method === 'getSignaturesForAddress') {
      assert.equal(body.params[1].limit, 100);
      result = [{ signature: sigFor(1), slot: 321, blockTime: Math.floor((now - 2 * DAY) / 1000), err: null }];
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
    assert.equal(out.observedSwaps[0].instructionCorroborated, true);
    assert.equal(out.smartMoney.score, null);
    assert.equal(out.smartMoney.qualified, false);
    assert.equal(out.smartMoney.sample.solanaShadowEligible, true);
    assert.equal(out.swapEvidence.observedOnly.signatureHistoryComplete, true);
    assert.equal(out.swapEvidence.observedOnly.transactionDetailsComplete, true);
    assert.equal(out.swapEvidence.observedOnly.shadowEligible, true);
    assert.equal(out.swapEvidence.observedOnly.admittedToScore, false);
    assert.equal(out.swapEvidence.observedOnly.admittedToConsensus, false);
  } finally {
    __setFetchForTests(null);
    globalThis.fetch = originalFetch;
  }
});

for (const line of results) console.log(line);
const failed = results.filter((r) => r.startsWith('✗'));
console.log(`\nSmart Money phase-4 probe: ${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) process.exit(1);
