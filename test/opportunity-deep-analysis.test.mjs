/**
 * OPPORTUNITY — DEEP ANALYSIS contract
 * Locks the "six blocks, all true or explicitly unknown" rule:
 *   technical, on-chain, liquidity, performance, scenarios, contract risk.
 * A block with no evidence must say WHY, and must never render a zero, an empty
 * chart or a passed audit in its place.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  technicalRead, onchainRead, liquidityRead, performanceRead, scenarioTable,
  contractRiskRead, buildDeepAnalysis, impermanentLossPct
} from '../src/lib/opportunity/deepAnalysis.js';

const now = 1_760_000_000_000;

/* 60 daily candles with a mild uptrend, so the indicator engine has real input. */
const candles = Array.from({ length: 60 }, (_, i) => {
  const base = 100 + i * 1.2 + Math.sin(i / 3) * 3;
  return { t: now - (59 - i) * 86400000, o: base - 0.5, h: base + 1.4, l: base - 1.2, c: base };
});

const poolOpp = {
  opportunityId: 'opp_pool',
  category: 'LIQUIDITY_POOL',
  title: 'uniswap-v3 ETH-USDC — 22% APY',
  symbol: 'ETH-USDC',
  chain: 'Base',
  confidence: 0.72,
  score: 62.4,
  scoreBreakdown: { return: 30, confidence: 18, riskFit: 12, capitalFit: 6 },
  metrics: {
    grossApyPct: 22, capitalNeededUsd: 5000, tvlUsd: 9_000_000, liquidityUsd: 9_000_000,
    volume24hUsd: 800_000, feeUsd: 41, slippageUsd: 27.8, gasUsd: 0.1, slippagePctAssumed: 0.55
  },
  economics: {
    capitalUsd: 5000, horizonDays: 30, grossProfitUsd: 90.4, netProfitUsd: 49.4,
    netReturnPct: 0.99, netApyPct: 12.02, breakEvenDays: 6,
    fees: { totalUsd: 41, networkGasUsd: 0.1, slippageUsd: 27.8, slippagePctAssumed: 0.55 }
  },
  risk: { score: 5.4, level: 'MEDIUM', coverage: 0.9, components: { smartContract: 5, liquidity: 1.5, volatility: 4.5, impermanentLoss: 7 } },
  evidence: [{ type: 'POOL', detail: 'APY 22% · TVL 9000000' }],
  caveats: ['not-a-signal']
};

const whaleOpp = {
  opportunityId: 'opp_whale',
  category: 'WHALE_FLOW',
  title: 'Whale accumulation — BTC',
  symbol: 'BTC',
  chain: 'ethereum',
  confidence: 0.8,
  score: 49.9,
  metrics: { netFlowUsd: 2_000_000, sampleSize: 4 },
  economics: null,
  risk: { score: 4.2, level: 'MEDIUM', coverage: 0.7, components: { liquidity: 3, volatility: 6.5 } },
  evidence: [{ type: 'ON_CHAIN', detail: 'net flow 2000000 USD · wallets 4' }],
  caveats: ['not-a-signal']
};

test('technical: real candles produce a read; no candles is unavailable, never empty', () => {
  const live = technicalRead({ candles });
  assert.equal(live.status, 'live');
  assert.ok(live.bars >= 20);
  assert.ok(['uptrend', 'downtrend', 'sideways'].includes(live.trend.label));
  assert.ok(live.signals.some((s) => s.id === 'rsi'));

  const none = technicalRead({ candles: [] });
  assert.equal(none.status, 'unavailable');
  assert.equal(none.reason, 'no-candles');
  assert.ok(none.noteFa && none.noteEn);
});

test('on-chain: evidence rows come only from what the scan verified', () => {
  const live = onchainRead(whaleOpp);
  assert.equal(live.status, 'live');
  assert.ok(live.rows.find((r) => r.id === 'netflow').value === 2_000_000);
  assert.ok(live.rows.find((r) => r.id === 'wallets'));

  const none = onchainRead({ category: 'RWA', evidence: [], metrics: {} });
  assert.equal(none.status, 'unavailable');
  assert.equal(none.reason, 'no-onchain-evidence');
});

test('liquidity: depth gives a real share and the same slippage the card showed', () => {
  const live = liquidityRead(poolOpp);
  assert.equal(live.status, 'live');
  assert.equal(live.depthUsd, 9_000_000);
  assert.ok(live.depthSharePct > 0 && live.depthSharePct < 1);
  assert.equal(live.slippagePct, 0.55, 'the card and the page cannot disagree');
  const flat = liquidityRead({ category: 'RWA', metrics: {} });
  assert.equal(flat.status, 'unavailable');
});

test('performance: a real yield series becomes stats; nothing becomes nothing', () => {
  const points = Array.from({ length: 10 }, (_, i) => ({ timestamp: now - (9 - i) * 86400000, apy: 18 + i }));
  const live = performanceRead({ history: { pool: 'p', range: '30d', source: 'defillama', points } });
  assert.equal(live.status, 'live');
  assert.equal(live.kind, 'yield');
  assert.equal(live.stats.lastApyPct, 27);
  assert.ok(live.stats.aboveMeanPct != null);

  const price = performanceRead({ priceSeries: [100, 90, 110] });
  assert.equal(price.kind, 'price');
  assert.equal(price.stats.changePct, 10);

  const none = performanceRead({});
  assert.equal(none.status, 'unavailable');
  assert.ok(none.noteEn.includes('no number is invented'));
});

test('scenarios: fees are subtracted, IL is applied to LPs, no yield means no scenario', () => {
  const table = scenarioTable(poolOpp, { capitalUsd: 5000, horizonDays: 30 });
  assert.equal(table.status, 'live');
  assert.equal(table.rows.length, 5);
  assert.equal(table.impermanentLoss, true);
  const down = table.rows.find((r) => r.movePct === -30);
  const up = table.rows.find((r) => r.movePct === 30);
  assert.ok(down.netPct < 0, 'a 30% fall in an LP loses money');
  assert.ok(up.netPct < up.pricePct + up.yieldPct, 'IL and fees bite even on the way up');
  assert.ok(down.ilPct < 0);
  /* Every row charges the same fee % the card showed, as a share of capital. */
  const feePctExpected = (41 / 5000) * 100;
  assert.ok(Math.abs(table.rows[0].feesPct - feePctExpected) < 0.01);

  const noEcon = scenarioTable(whaleOpp, { capitalUsd: 5000 });
  assert.equal(noEcon.status, 'unavailable');
  assert.equal(noEcon.reason, 'no-economics');

  const noCapital = scenarioTable(poolOpp, { capitalUsd: 0 });
  assert.equal(noCapital.reason, 'no-capital');
});

test('impermanent loss matches the standard 50/50 formula', () => {
  assert.equal(impermanentLossPct(1), 0);
  assert.ok(Math.abs(impermanentLossPct(2) - -5.72) < 0.05);
  assert.ok(Math.abs(impermanentLossPct(0.5) - -5.72) < 0.05);
});

test('contract risk: audited / upgradeable / oracle are UNKNOWN, not passed', () => {
  const risk = contractRiskRead(poolOpp);
  assert.equal(risk.status, 'live');
  assert.equal(risk.score, 5.4);
  const audit = risk.checks.find((c) => c.id === 'audit');
  assert.equal(audit.status, 'unknown');
  assert.ok(audit.detailEn.includes('not reported as passed'));
  assert.equal(risk.checks.find((c) => c.id === 'smartContract').value, 5);
  const none = contractRiskRead({});
  assert.equal(none.status, 'unavailable');
});

test('assembly: all six blocks present in one model', () => {
  const model = buildDeepAnalysis(poolOpp, {
    capitalUsd: 5000, horizonDays: 30, candles,
    yieldHistory: { range: '30d', source: 'defillama', points: [{ timestamp: now - 86400000, apy: 20 }, { timestamp: now, apy: 22 }] }
  });
  for (const key of ['technical', 'onchain', 'liquidity', 'performance', 'scenarios', 'contractRisk', 'score']) {
    assert.ok(model[key], `missing ${key}`);
  }
  assert.equal(model.technical.status, 'live');
  assert.equal(model.performance.kind, 'yield');
  assert.equal(model.score.total, 62.4);
  assert.equal(model.score.confidencePct, 72);
});
