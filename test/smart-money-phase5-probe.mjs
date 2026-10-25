#!/usr/bin/env node
/**
 * Smart Money phase 5 (2026-10-25) — Solana real-replay regression probe.
 *
 * This probe keeps three different claims separate:
 *   1. The committed payloads are real, pinned, licensed mainnet transaction
 *      results and the production decoder reproduces their pinned outcomes.
 *   2. A complete corroborated wallet sample can be quantity-reconciled
 *      against an untruncated legacy-SPL + Token-2022 balance read.
 *   3. Verified promotion stays impossible while the executed replay corpus
 *      is partial, and remains reversible even after a hypothetical complete
 *      corpus: the deploy switch must also be on.
 *
 * Run: node test/smart-money-phase5-probe.mjs
 */
process.env.NODE_ENV = 'test';
delete process.env.BLOB_READ_WRITE_TOKEN;
delete process.env.SM_SOLANA_VERIFIED_PROMOTION;

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { __setFetchForTests, solTokenBalances } from '../server/smartMoney/dataSources.js';
import { isVerifiedPairedSwap } from '../server/smartMoney/performance.js';
import {
  SOLANA_DEX_PROGRAMS,
  SOLANA_USD_QUOTES,
  assessSolanaSwapLedger,
  decodeSolanaSwap,
  isInstructionCorroboratedSolanaSwap
} from '../server/smartMoney/solanaSwaps.js';
import {
  SOLANA_BALANCE_REPLAY_PROGRAMS,
  SOLANA_CORROBORATED_REPLAY_PROGRAMS,
  SOLANA_REPLAY_FIXTURES,
  SOLANA_REPLAY_FIXTURE_BY_ID,
  SOLANA_REPLAY_NOW,
  coverageForSolanaProgram
} from '../server/smartMoney/solanaReplayManifest.js';
import {
  SOLANA_PROMOTION_ENV,
  assessSolanaReplayCorpus,
  assessSolanaVerifiedPromotion,
  getExecutedSolanaReplayCorpus,
  normalizeSolanaTransactionPayload,
  promoteSolanaSwaps,
  reconcileSolanaShadowFifo,
  runSolanaReplayFixtures,
  sha256Hex,
  solanaVerifiedPromotionEnabled,
  verifySolanaReplayFixture
} from '../server/smartMoney/solanaReplay.js';
import { analyzeWallet } from '../server/smartMoney/walletIntel.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const results = [];
const check = (name, fn) => {
  try { fn(); results.push(`✓ ${name}`); }
  catch (err) { results.push(`✗ ${name} — ${err.message}`); }
};
const checkAsync = async (name, fn) => {
  try { await fn(); results.push(`✓ ${name}`); }
  catch (err) { results.push(`✗ ${name} — ${err.message}`); }
};
const originalFetch = globalThis.fetch;

const replayRun = runSolanaReplayFixtures({ rootDir: ROOT });
const replayById = Object.fromEntries(replayRun.results.map((row) => [row.id, row]));

check('replay manifest pins provenance, licence, commit and payload identity for every fixture', () => {
  assert.equal(SOLANA_REPLAY_FIXTURES.length, 4);
  assert.equal(new Set(SOLANA_REPLAY_FIXTURES.map((f) => f.id)).size, 4);
  assert.equal(new Set(SOLANA_REPLAY_FIXTURES.map((f) => f.file)).size, 4);
  assert.equal(new Set(SOLANA_REPLAY_FIXTURES.map((f) => f.signature)).size, 4);
  for (const fixture of SOLANA_REPLAY_FIXTURES) {
    assert.match(fixture.sha256, /^[a-f0-9]{64}$/);
    assert.match(fixture.source.commit, /^[a-f0-9]{40}$/);
    assert.ok(fixture.source.repository.includes('/'));
    assert.ok(fixture.source.path.length > 10);
    assert.ok(['MIT', 'MPL-2.0'].includes(fixture.source.license));
    assert.ok(fixture.source.url.includes(fixture.source.commit));
    assert.ok(SOLANA_DEX_PROGRAMS[fixture.dexProgram]);
  }
});

check('committed real-transaction payloads replay to every pinned decode (4/4)', () => {
  assert.equal(replayRun.passed, true);
  assert.equal(replayRun.corpus.executed, true);
  assert.equal(replayRun.corpus.executionStatus, 'passed');
  assert.equal(replayRun.corpus.passedFixtures, 4);
  assert.equal(replayRun.corpus.failedFixtures, 0);
  assert.deepEqual(replayRun.results.filter((r) => !r.passed), []);
});

check('Jupiter v6 replay is instruction-corroborated, Raydium AMM v4 is honestly balance-only', () => {
  const pyusd = replayById['jupiter-v6-pyusd-usdc-2dyb2hr9'];
  const jup = replayById['jupiter-v6-jup-usdc-5fbwfqrm'];
  const raydium = replayById['raydium-amm-v4-usdc-3p36wgra'];
  for (const row of [pyusd, jup]) {
    assert.equal(row.actual.instructionCorroborated, true);
    assert.equal(isInstructionCorroboratedSolanaSwap(row.actual), true);
    assert.equal(row.actual.classification, 'observed-only');
  }
  assert.equal(raydium.actual.decodeMethod, 'token-balance-deltas');
  assert.equal(raydium.actual.instructionCorroborated, false);
  assert.equal(isInstructionCorroboratedSolanaSwap(raydium.actual), false);
});

check('canonical stable-to-stable real payload is rejected instead of becoming target exposure', () => {
  const stable = replayById['jupiter-v6-usdt-usdc-4vug6xbf'];
  assert.equal(stable.expected, null);
  assert.equal(stable.actual, null);
  const fixture = SOLANA_REPLAY_FIXTURE_BY_ID[stable.id];
  const payload = JSON.parse(readFileSync(path.join(ROOT, fixture.file), 'utf8'));
  assert.equal(decodeSolanaSwap(payload, fixture.wallet, { now: SOLANA_REPLAY_NOW }), null);
});

check('payload normalization unwraps recorded envelopes without searching arbitrary objects', () => {
  const fixture = SOLANA_REPLAY_FIXTURES[0];
  const payload = JSON.parse(readFileSync(path.join(ROOT, fixture.file), 'utf8'));
  assert.equal(normalizeSolanaTransactionPayload(payload), payload);
  assert.equal(normalizeSolanaTransactionPayload([{ result: payload }]), payload);
  assert.equal(normalizeSolanaTransactionPayload([payload, payload]), null);
  assert.equal(normalizeSolanaTransactionPayload({ nested: { transaction: {}, meta: {} } }), null);
});

check('a changed payload hash fails closed even when its decoded shape still looks plausible', () => {
  const fixture = SOLANA_REPLAY_FIXTURES[0];
  const bytes = readFileSync(path.join(ROOT, fixture.file));
  assert.equal(sha256Hex(bytes), fixture.sha256);
  const result = verifySolanaReplayFixture(fixture, JSON.parse(bytes.toString('utf8')), {
    sha256: '0'.repeat(64)
  });
  assert.equal(result.passed, false);
  assert.ok(result.mismatches.includes('payload-sha256-mismatch'));
});

check('replay coverage reports 1/12 corroborated and 2/12 balance-replayed, never complete', () => {
  const declared = assessSolanaReplayCorpus();
  assert.equal(declared.executed, false);
  assert.equal(declared.executionStatus, 'not-executed');
  assert.equal(declared.complete, false);
  assert.equal(declared.supportedPrograms, 12);
  assert.equal(declared.corroboratedPrograms, 1);
  assert.equal(declared.balanceReplayPrograms, 2);
  assert.equal(declared.missingCorroboratedPrograms.length, 11);
  assert.deepEqual(SOLANA_CORROBORATED_REPLAY_PROGRAMS, ['JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4']);
  assert.deepEqual(SOLANA_BALANCE_REPLAY_PROGRAMS, [
    'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4',
    '675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8'
  ]);
  assert.equal(coverageForSolanaProgram('675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8').status, 'balance-delta-replay-only');
  assert.equal(coverageForSolanaProgram('pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA').status, 'missing-replay-fixture');
});

/* Synthetic decoded-shape rows below test only the quantity gate. They are
 * never counted as replay evidence; the real payloads above are the corpus. */
const WALLET = '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU';
const TARGET = 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263'; // BONK, 5 decimals
const USDC = Object.keys(SOLANA_USD_QUOTES).find((mint) => SOLANA_USD_QUOTES[mint].symbol === 'USDC');
const JUPITER = 'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4';
const T0 = Date.parse('2026-10-01T00:00:00.000Z');
const syntheticSwap = ({ id, side, amount, amountRaw, quoteAmount, quoteAmountRaw, at, transfers }) => ({
  id: `solana:${WALLET}:${id}:${TARGET}`,
  chain: 'solana', wallet: WALLET, hash: id, signature: id, timestamp: at,
  token: TARGET, symbol: 'BONK', side, amount, amountRaw, tokenDecimals: 5,
  valueUsd: quoteAmount, executionPriceUsd: quoteAmount / amount,
  quoteToken: USDC, quoteKind: 'allowlisted-usd-stablecoin', quoteSymbol: 'USDC',
  quoteAmount, quoteAmountRaw, quoteDecimals: 6,
  dexProgram: JUPITER, dex: 'Jupiter v6',
  decodeMethod: 'instruction-corroborated-token-balance-deltas',
  instructionCorroborated: true,
  instructionFillCount: transfers.target + transfers.quote,
  instructionTransfers: transfers,
  evidence: 'decoded-solana-token-balance-deltas',
  classification: 'observed-only',
  admission: 'excluded-from-verified-score-and-consensus'
});
const buy = syntheticSwap({
  id: 'phase5buy', side: 'BUY', amount: 2_000_000, amountRaw: '200000000000',
  quoteAmount: 250, quoteAmountRaw: '250000000', at: T0,
  transfers: { target: 2, quote: 1 }
});
const sell = syntheticSwap({
  id: 'phase5sell', side: 'SELL', amount: 1_000_000, amountRaw: '100000000000',
  quoteAmount: 300, quoteAmountRaw: '300000000', at: T0 + 86_400_000,
  transfers: { target: 1, quote: 1 }
});
const completeCoverage = { complete: true };
const ledger = assessSolanaSwapLedger({
  swaps: [buy, sell], signatureCoverage: completeCoverage, transactionCoverage: completeCoverage
});
const liveCompleteBalances = { dataStatus: 'live', complete: true, truncated: false };
const currentTarget = [{ token: TARGET, symbol: 'BONK', amount: 1_000_000, amountRaw: '100000000000', decimals: 5 }];
const reconciliation = reconcileSolanaShadowFifo({
  swaps: [buy, sell], balances: currentTarget, balanceCoverage: liveCompleteBalances,
  signatureCoverage: completeCoverage, transactionCoverage: completeCoverage,
  ledgerAssessment: ledger, now: T0 + 2 * 86_400_000
});

check('raw-unit shadow FIFO exactly reconciles open inventory without exposing P&L or a score', () => {
  assert.equal(ledger.shadowEligible, true);
  assert.equal(reconciliation.status, 'reconciled-shadow-fifo');
  assert.equal(reconciliation.reconciled, true);
  assert.equal(reconciliation.closedTrades, 1);
  assert.equal(reconciliation.unmatchedExits, 0);
  assert.equal(reconciliation.checkedMints, 1);
  assert.equal(reconciliation.matchedMints, 1);
  assert.equal(reconciliation.openPositions[0].expectedAmountRaw, '100000000000');
  assert.equal(reconciliation.openPositions[0].currentAmountRaw, '100000000000');
  assert.equal('pnlUsd' in reconciliation, false);
  assert.equal('realizedUsd' in reconciliation, false);
  assert.equal('score' in reconciliation, false);
  assert.equal(reconciliation.promoted, false);
});

check('current-balance mismatch, oversell and truncated balance reads all keep shadow FIFO blocked', () => {
  const mismatch = reconcileSolanaShadowFifo({
    swaps: [buy, sell],
    balances: [{ ...currentTarget[0], amount: 999_999, amountRaw: '99999000000' }],
    balanceCoverage: liveCompleteBalances, ledgerAssessment: ledger
  });
  assert.equal(mismatch.reconciled, false);
  assert.ok(mismatch.blockers.includes('current-balance-mismatch'));

  const oversell = syntheticSwap({
    id: 'phase5oversell', side: 'SELL', amount: 3_000_000, amountRaw: '300000000000',
    quoteAmount: 900, quoteAmountRaw: '900000000', at: T0 + 86_400_000,
    transfers: { target: 1, quote: 1 }
  });
  const oversoldLedger = assessSolanaSwapLedger({
    swaps: [buy, oversell], signatureCoverage: completeCoverage, transactionCoverage: completeCoverage
  });
  const oversold = reconcileSolanaShadowFifo({
    swaps: [buy, oversell], balances: [], balanceCoverage: liveCompleteBalances,
    ledgerAssessment: oversoldLedger
  });
  assert.equal(oversold.unmatchedExits, 1);
  assert.ok(oversold.blockers.includes('unmatched-sell-inventory'));

  const truncated = reconcileSolanaShadowFifo({
    swaps: [buy, sell], balances: currentTarget,
    balanceCoverage: { dataStatus: 'live', complete: false, truncated: true },
    ledgerAssessment: ledger
  });
  assert.ok(truncated.blockers.includes('token-balance-read-incomplete'));
});

check('promotion switch accepts only the exact value 1 and defaults off', () => {
  assert.equal(SOLANA_PROMOTION_ENV, 'SM_SOLANA_VERIFIED_PROMOTION');
  assert.equal(solanaVerifiedPromotionEnabled({}), false);
  assert.equal(solanaVerifiedPromotionEnabled({ SM_SOLANA_VERIFIED_PROMOTION: '0' }), false);
  assert.equal(solanaVerifiedPromotionEnabled({ SM_SOLANA_VERIFIED_PROMOTION: 'true' }), false);
  assert.equal(solanaVerifiedPromotionEnabled({ SM_SOLANA_VERIFIED_PROMOTION: '1' }), true);
});

check('today\'s executed-but-partial corpus blocks promotion with the switch off or on', () => {
  for (const env of [{}, { SM_SOLANA_VERIFIED_PROMOTION: '1' }]) {
    const assessment = assessSolanaVerifiedPromotion({
      swaps: [buy, sell], ledgerAssessment: ledger, reconciliation,
      replayCorpus: replayRun, env, now: T0 + 2 * 86_400_000
    });
    assert.equal(assessment.evidenceEligible, false);
    assert.equal(assessment.promoted, false);
    assert.ok(assessment.blockers.includes('replay-corpus-incomplete'));
    assert.deepEqual(promoteSolanaSwaps({ swaps: [buy, sell], assessment, reconciliation }), []);
  }
});

check('a hypothetical complete executed corpus is evidence-ready off, and verified only when switched on', () => {
  const allPrograms = Object.keys(SOLANA_DEX_PROGRAMS);
  const completeCorpus = {
    ...replayRun.corpus,
    status: 'complete-real-transaction-replay',
    complete: true,
    corroboratedPrograms: allPrograms.length,
    corroboratedProgramIds: allPrograms,
    missingCorroboratedPrograms: []
  };
  const off = assessSolanaVerifiedPromotion({
    swaps: [buy, sell], ledgerAssessment: ledger, reconciliation,
    replayCorpus: completeCorpus, env: {}, now: T0 + 2 * 86_400_000
  });
  assert.equal(off.evidenceEligible, true);
  assert.equal(off.status, 'evidence-ready-promotion-disabled');
  assert.equal(off.promoted, false);
  assert.ok(off.blockers.includes('promotion-switch-disabled'));
  assert.deepEqual(promoteSolanaSwaps({ swaps: [buy, sell], assessment: off, reconciliation }), []);

  const on = assessSolanaVerifiedPromotion({
    swaps: [buy, sell], ledgerAssessment: ledger, reconciliation,
    replayCorpus: completeCorpus,
    env: { SM_SOLANA_VERIFIED_PROMOTION: '1' },
    now: T0 + 2 * 86_400_000
  });
  assert.equal(on.promoted, true);
  const promoted = promoteSolanaSwaps({ swaps: [buy, sell], assessment: on, reconciliation });
  assert.equal(promoted.length, 2);
  assert.ok(promoted.every((row) => row.classification === 'verified'));
  assert.ok(promoted.every(isVerifiedPairedSwap));

  const tamperedRaw = { ...promoted[0], amountRaw: '200000000001' };
  assert.equal(isVerifiedPairedSwap(tamperedRaw), false);
  const noFifoProof = { ...promoted[0], balanceReconciliation: null };
  assert.equal(isVerifiedPairedSwap(noFifoProof), false);
  const balanceOnlyProgram = {
    ...promoted[0],
    dexProgram: '675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8',
    dex: 'Raydium AMM v4'
  };
  assert.equal(isVerifiedPairedSwap(balanceOnlyProgram), false);
});

await checkAsync('SPL balance read covers Token-2022, sums raw units and reports truncation or malformed accounts', async () => {
  const malformedWallet = '4Ui9QdDNuUaAGqCPcDSp191QrixLzQiLxJ1Gnqvz3szP';
  const calls = [];
  const account = (mint, amount, decimals) => ({
    pubkey: '11111111111111111111111111111111',
    account: { data: { parsed: { info: { mint, tokenAmount: { amount, decimals } } } } }
  });
  __setFetchForTests(async (_url, opts) => {
    const body = JSON.parse(opts.body);
    calls.push(body);
    assert.equal(body.method, 'getTokenAccountsByOwner');
    const programId = body.params[1].programId;
    const value = programId === 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEB'
      ? [account('JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN', '1234567', 6)]
      : [
          account(TARGET, '60000000000', 5),
          account(TARGET, '40000000000', 5),
          account(TARGET, '0', 5),
          ...(body.params[0] === malformedWallet ? [account(TARGET, '12x', 5)] : [])
        ];
    return { ok: true, json: async () => ({ jsonrpc: '2.0', id: 1, result: { value } }) };
  });
  try {
    const full = await solTokenBalances(WALLET, { limit: 500, timeoutMs: 2_000 });
    assert.equal(full.dataStatus, 'live');
    assert.equal(full.mintCount, 2);
    assert.equal(full.accounts, 4);
    assert.equal(full.invalidAccounts, 0);
    assert.equal(full.complete, true);
    assert.equal(full.truncated, false);
    assert.deepEqual(new Set(calls.map((c) => c.params[1].programId)), new Set(full.tokenPrograms));
    const bonk = full.tokens.find((row) => row.token === TARGET);
    assert.equal(bonk.amountRaw, '100000000000');
    assert.equal(bonk.amount, 1_000_000);

    const limited = await solTokenBalances(WALLET, { limit: 1, timeoutMs: 2_000 });
    assert.equal(limited.tokens.length, 1);
    assert.equal(limited.complete, false);
    assert.equal(limited.truncated, true);

    const malformed = await solTokenBalances(malformedWallet, { limit: 500, timeoutMs: 2_000 });
    assert.equal(malformed.dataStatus, 'live');
    assert.equal(malformed.accounts, 5);
    assert.equal(malformed.invalidAccounts, 1);
    assert.equal(malformed.complete, false);
    assert.equal(malformed.truncated, false);
  } finally {
    __setFetchForTests(null);
  }
});

await checkAsync('wallet integration exposes phase-5 diagnostics while keeping Solana unscored', async () => {
  const fixture = SOLANA_REPLAY_FIXTURE_BY_ID['jupiter-v6-pyusd-usdc-2dyb2hr9'];
  const payload = JSON.parse(readFileSync(path.join(ROOT, fixture.file), 'utf8'));
  __setFetchForTests(async (url, opts) => {
    const u = String(url);
    if (u.includes('api.dexscreener.com')) return { ok: true, json: async () => ({ pairs: [] }) };
    const body = JSON.parse(opts.body);
    let result;
    if (body.method === 'getSignaturesForAddress') {
      result = [{ signature: fixture.signature, slot: payload.slot, blockTime: payload.blockTime, err: null }];
    } else if (body.method === 'getBalance') result = { value: 1_000_000_000 };
    else if (body.method === 'getTokenAccountsByOwner') result = { value: [] };
    else if (body.method === 'getTransaction') result = payload;
    else throw new Error(`unexpected method ${body.method}`);
    return { ok: true, json: async () => ({ jsonrpc: '2.0', id: 1, result }) };
  });
  globalThis.fetch = async () => { throw new Error('optional price source disabled in probe'); };
  try {
    const out = await analyzeWallet(fixture.wallet, 'solana', { timeoutMs: 6_000 });
    const observed = out.swapEvidence.observedOnly;
    assert.equal(out.verifiedSwaps.length, 0);
    assert.equal(out.observedSwaps.length, 1);
    assert.equal(out.smartMoney.score, null);
    assert.equal(out.smartMoney.qualified, false);
    assert.equal(observed.shadowEligible, true);
    assert.equal(observed.shadowFifo.unmatchedExits, 1);
    assert.equal(observed.shadowFifoReconciled, false);
    assert.equal(observed.replayCorpus.executionStatus, 'passed');
    assert.equal(observed.replayCorpus.corroboratedPrograms, 1);
    assert.equal(observed.replayCorpus.supportedPrograms, 12);
    assert.equal(observed.promotion.promoted, false);
    assert.ok(observed.promotion.blockers.includes('replay-corpus-incomplete'));
    assert.equal(observed.admittedToScore, false);
    assert.equal(observed.admittedToConsensus, false);
  } finally {
    __setFetchForTests(null);
    globalThis.fetch = originalFetch;
  }
});

check('process-level executed corpus is cached and still reports partial coverage', () => {
  const cached = getExecutedSolanaReplayCorpus({ refresh: true, rootDir: ROOT });
  assert.equal(cached.passed, true);
  assert.equal(cached.corpus.complete, false);
  assert.equal(getExecutedSolanaReplayCorpus({ rootDir: ROOT }), cached);
});

for (const line of results) console.log(line);
const failed = results.filter((line) => line.startsWith('✗'));
console.log(`\nSmart Money phase-5 probe: ${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) process.exit(1);
