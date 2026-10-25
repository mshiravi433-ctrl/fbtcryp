#!/usr/bin/env node
/** Smart Money phases 7–8: chain-aware verified flow + bounded hourly chunks. */
process.env.NODE_ENV = 'test';

import assert from 'node:assert/strict';
import { buildConsensus } from '../server/smartMoney/consensus.js';
import { SOLANA_CORROBORATED_REPLAY_PROGRAMS } from '../server/smartMoney/solanaReplayManifest.js';
import { SOLANA_REPLAY_VERSION } from '../server/smartMoney/solanaReplay.js';
import { SOLANA_USD_QUOTES, SOLANA_INSTRUCTION_CORROBORATED_DECODE, SOLANA_DEX_PROGRAMS } from '../server/smartMoney/solanaSwaps.js';
import { historicalHourlyPriceFn } from '../server/smartMoney/pricing.js';
import { pruneVerifiedIndex } from '../server/smartMoney/intelligence.js';

const DAY = 86_400_000;
const HOUR = 3_600_000;
const now = Date.UTC(2026, 9, 26, 12);
const wallets = [
  'Go5EVXxV3ob4CJVaq6YiGGUKqPmEfDo32kSmbWsYevsF',
  '4Ui9QdDNuUaAGqCPcDSp191QrixLzQiLxJ1Gnqvz3szP',
  '5C1k9yV7y4CjMnKv8eGYDgWND8P89Pdfj79Trk2qmfGo'
];
const token = '2b1kV6DkPAnxd5ixfnxCpjxmKwqjjaYmCZfHsFu24GXo';
const quoteToken = Object.keys(SOLANA_USD_QUOTES)[0];
const dexProgram = Object.keys(SOLANA_DEX_PROGRAMS).find((id) => SOLANA_CORROBORATED_REPLAY_PROGRAMS.includes(id));
const verifiedRows = wallets.map((wallet, i) => ({
  id: `solana-verified-${i}`,
  chain: 'solana', wallet, token, symbol: 'TEST', side: 'BUY',
  amount: 1, amountRaw: '1000000', tokenDecimals: 6,
  quoteToken, quoteSymbol: 'USDC', quoteAmount: 100, quoteAmountRaw: '100000000', quoteDecimals: 6,
  quoteKind: 'allowlisted-usd-stablecoin', valueUsd: 100,
  timestamp: now - (i + 1) * HOUR, hash: `phase7-${i}`,
  evidence: 'decoded-solana-token-balance-deltas',
  decodeMethod: SOLANA_INSTRUCTION_CORROBORATED_DECODE,
  instructionCorroborated: true, instructionFillCount: 2,
  instructionTransfers: { target: 1, quote: 1 }, dexProgram,
  classification: 'verified', admission: 'verified-score-and-consensus',
  replayValidation: { version: SOLANA_REPLAY_VERSION, executionStatus: 'passed' },
  balanceReconciliation: { status: 'reconciled-shadow-fifo', reconciled: true }
}));
const profiles = wallets.map((address) => ({
  chain: 'solana', address, updatedAt: now, qualified: true, score: 80,
  coverage: 0.8, closedTrades: 5, realizedUsd: 100, winRate: 60
}));

const consensus = buildConsensus({ profiles, swaps: verifiedRows, now, chain: 'solana', token });
assert.equal(consensus.coverage.sampledTrades, 3, 'only fully verified Solana swaps enter the verified index');
assert.equal(consensus.consensus.length, 1);
assert.equal(consensus.consensus[0].chain, 'solana');
assert.equal(consensus.consensus[0].signal, 'ACCUMULATION');
assert.equal(consensus.consensus[0].independentVotes, 3);

const caseChangedProfiles = profiles.map((p, i) => i === 0 ? { ...p, address: p.address.toLowerCase() } : p);
const caseSensitive = buildConsensus({ profiles: caseChangedProfiles, swaps: verifiedRows, now, chain: 'solana', token });
assert.equal(caseSensitive.coverage.sampledTrades, 2, 'Solana wallet addresses must not be lowercased or merged');
assert.ok(caseSensitive.consensus.every((row) => row.signal === 'INSUFFICIENT_EVIDENCE'), 'fewer than three independent Solana voters must not create a directional consensus');

const lowerCaseTwin = wallets[0].toLowerCase();
const retained = pruneVerifiedIndex({
  profiles: [
    { chain: 'solana', address: wallets[0], qualified: true, updatedAt: now - 1 },
    { chain: 'solana', address: lowerCaseTwin, qualified: false, updatedAt: now }
  ],
  swaps: [
    { id: 'qualified-solana-fill', chain: 'solana', wallet: wallets[0], timestamp: now - 10 },
    { id: 'unqualified-case-twin-fill', chain: 'solana', wallet: lowerCaseTwin, timestamp: now }
  ],
  maxProfiles: 2, maxSwaps: 1
});
assert.equal(retained.swaps[0].id, 'qualified-solana-fill', 'case-sensitive wallet keys keep the qualified Solana row attached to its own profile');

const originalFetch = globalThis.fetch;
try {
  const from = Date.UTC(2026, 0, 1);
  const to = from + 120 * DAY;
  const seen = [];
  globalThis.fetch = async (url) => {
    const parsed = new URL(String(url));
    const chunkFrom = Number(parsed.searchParams.get('from')) * 1000;
    const chunkTo = Number(parsed.searchParams.get('to')) * 1000;
    seen.push([chunkFrom, chunkTo]);
    const prices = [];
    for (let ts = chunkFrom; ts <= chunkTo; ts += HOUR) prices.push([ts, 100 + (ts - from) / DAY]);
    return { ok: true, json: async () => ({ prices }) };
  };
  const at = await historicalHourlyPriceFn('phase78-chunked-hourly-probe', {
    fromTs: from, toTs: to, timeoutMs: 3_000
  });
  assert.equal(seen.length, 2, '120-day series is split into two hourly-sized chunks');
  const point = at(from + 45 * DAY + 15 * 60_000);
  assert.ok(point && point.usd > 140 && point.usd < 150);
  assert.equal(point.source, 'coingecko-market-chart-range-chunked-hourly');

  let failedCalls = 0;
  globalThis.fetch = async (url) => {
    failedCalls++;
    const parsed = new URL(String(url));
    const chunkFrom = Number(parsed.searchParams.get('from')) * 1000;
    const chunkTo = Number(parsed.searchParams.get('to')) * 1000;
    if (failedCalls === 2) return { ok: false, status: 503 };
    const prices = [];
    for (let ts = chunkFrom; ts <= chunkTo; ts += HOUR) prices.push([ts, 1]);
    return { ok: true, json: async () => ({ prices }) };
  };
  const incomplete = await historicalHourlyPriceFn('phase78-failed-chunk-probe', {
    fromTs: from, toTs: to, timeoutMs: 3_000
  });
  assert.equal(incomplete(from + 45 * DAY), null, 'one failed chunk rejects the whole hourly series');
} finally {
  globalThis.fetch = originalFetch;
}

console.log('✓ chain-aware verified Solana consensus remains behind existing verified-row gate');
console.log('✓ Base58 wallet identity remains case-sensitive in the verified index');
console.log('✓ long historical native-price ranges use complete bounded hourly chunks only');
console.log('✓ a missing chunk fails closed without daily fallback');
