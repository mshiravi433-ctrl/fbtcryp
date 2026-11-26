import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyzeWallet } from '../src/lib/walletOptimizer.js';

test('no priced holdings produces no invented score', () => {
  const r = analyzeWallet({ rows: [{ symbol: 'XYZ', value: null }], totalValue: 0 });
  assert.equal(r.score, null);
  assert.equal(r.findings[0].id, 'noPricedHoldings');
  assert.equal(r.total, 0);
});

test('a concentrated portfolio is flagged with the real share', () => {
  const r = analyzeWallet({
    rows: [
      { symbol: 'BTC', value: 8000, chainId: 'btc' },
      { symbol: 'USDC', value: 2000, chainId: 56 }
    ],
    chains: [{ chainId: 'btc', chainShort: 'BTC', totalValue: 8000 }, { chainId: 56, chainShort: 'BSC', totalValue: 2000 }],
    totalValue: 10000
  });
  const f = r.findings.find((x) => x.id === 'concentration');
  assert.ok(f, 'concentration finding exists');
  assert.equal(r.top.symbol, 'BTC');
  assert.equal(r.top.pct, 80);
  assert.equal(r.chainCount, 2);
  assert.ok(r.score < 100 && r.score > 0);
});

test('low gas on the active chain is a warning, not a guess', () => {
  const r = analyzeWallet({
    rows: [
      { symbol: 'USDC', value: 950, chainId: 56, native: false },
      { symbol: 'BNB', value: 2, chainId: 56, native: true }
    ],
    activeChainId: 56,
    totalValue: 952
  });
  assert.ok(r.findings.some((x) => x.id === 'gasReserve'));
  assert.equal(r.activeNativeUsd, 2);
});

test('a diversified, gassed portfolio is called balanced', () => {
  const r = analyzeWallet({
    rows: [
      { symbol: 'BTC', value: 2400, chainId: 'btc' },
      { symbol: 'ETH', value: 2400, chainId: 1 },
      { symbol: 'SOL', value: 2400, chainId: 'solana' },
      { symbol: 'USDC', value: 2400, chainId: 56 },
      { symbol: 'BNB', value: 400, chainId: 56, native: true }
    ],
    activeChainId: 56,
    totalValue: 10000
  });
  assert.equal(r.stable.pct, 24);
  assert.equal(r.score, 100);
  assert.equal(r.findings[0].id, 'balanced');
});
