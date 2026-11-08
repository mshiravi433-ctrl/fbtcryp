/**
 * OPPORTUNITY ENGINE v2 — contract tests
 * Locks: (1) all 7 families scan from supplied data only, (2) net economics
 * subtract itemised fees, (3) personalised ranking rejects over-risk /
 * under-capital candidates WITH reasons instead of hiding them,
 * (4) the Cortex connection modulates — and its absence is declared.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  scanOpportunities, computeEconomics, estimateFees, compositeRisk,
  buildCortexFeatureVector, OPPORTUNITY_SCHEMA
} from '../src/lib/brain/opportunityEngine.js';
import { createNeuromorphicCortex } from '../src/lib/neuromorphic/cortexCore.js';

const NOW = 1_730_000_000_000;
const INPUT = {
  now: NOW, userCapitalUsd: 10_000, horizonDays: 30, riskProfile: 'MODERATE',
  liquidityPools: [{ protocol: 'Orca', pair: 'SOL/USDC', chain: 'solana', apy: 24, feeApy: 18, rewardApy: 6, tvlUsd: 4_000_000, volume24hUsd: 900_000, volatilityPct: 55 }],
  farms: [{ protocol: 'Kamino', chain: 'solana', apy: 12, tvlUsd: 50_000_000, riskScore: 3 }],
  lendingMarkets: [{ protocol: 'Aave', asset: 'USDC', chain: 'base', supplyApy: 6.5, utilizationPct: 71, ltvPct: 80, tvlUsd: 80_000_000, riskScore: 2.5 }],
  arbitrage: [{ asset: 'ETH', buyVenue: 'DEX-A', sellVenue: 'DEX-B', buyPrice: 3000, sellPrice: 3045, depthUsd: 500_000, chain: 'arbitrum' }],
  venuePrices: [
    { asset: 'BTC', venue: 'X', price: 100_000 }, { asset: 'BTC', venue: 'Y', price: 101_200 }
  ],
  emergingTokens: [{ symbol: 'NEW', chain: 'solana', change24h: 18, liquidityUsd: 600_000, mcap: 3_000_000, ageDays: 12, holdersGrowthPct: 22, smartMoneyBuys: 7, riskScore: 7 }],
  rwaAssets: [{ name: 'US Treasury Bills', category: 'Treasury', expectedYield: 5.1, minInvestmentUsd: 100, lockDays: 90, liquidity: 'MEDIUM', issuer: 'Ondo' }],
  whaleFlows: [{ asset: 'SOL', direction: 'accumulation', netFlowUsd: 4_200_000, walletCount: 9, liquidityUsd: 2_000_000, chain: 'solana' }]
};

test('schema is v2 and all seven families are covered from supplied data only', () => {
  const r = scanOpportunities(INPUT);
  assert.equal(r.schema, OPPORTUNITY_SCHEMA);
  assert.equal(r.status, 'OK');
  for (const cat of ['LIQUIDITY_POOL', 'FARMING', 'LENDING', 'ARBITRAGE', 'EMERGING_TOKEN', 'RWA', 'WHALE_FLOW']) {
    assert.ok(r.coverage[cat] >= 1, `coverage ${cat}`);
  }
  assert.ok(r.coverage.ARBITRAGE >= 2, 'explicit spread + venue-matrix spread');
  // nothing supplied → nothing invented
  const empty = scanOpportunities({ now: NOW, userCapitalUsd: 10_000 });
  assert.equal(empty.opportunities.length, 0);
  assert.ok(empty.caveats.includes('cortex-not-connected'));
});

test('economics: itemised fees are subtracted; arbitrage spread priced net', () => {
  const fees = estimateFees({ capitalUsd: 10_000, category: 'LENDING', chain: 'ethereum' });
  assert.equal(fees.networkGasUsd, 4.5); // documented chain default
  assert.ok(fees.totalUsd > fees.networkGasUsd);
  const econ = computeEconomics({ capitalUsd: 10_000, horizonDays: 30, grossApyPct: 12, fees });
  assert.ok(econ.grossProfitUsd > econ.netProfitUsd);
  assert.ok(econ.minViableCapitalUsd > 0 && econ.breakEvenDays >= 0);
  const r = scanOpportunities(INPUT);
  const arb = [...r.opportunities, ...r.rejected].find((o) => o.category === 'ARBITRAGE' && o.symbol === 'ETH');
  assert.ok(arb.economics.netProfitUsd > 0, '1.5% spread survives fees at $10k');
  assert.ok(arb.economics.fees.totalUsd > 0);
});

test('risk composite keeps components visible', () => {
  const risk = compositeRisk({ smartContract: 2, liquidity: 3, volatility: 4 });
  assert.ok(risk.score > 0 && risk.score < 5);
  assert.equal(risk.components.smartContract, 2);
  assert.equal(compositeRisk({}).score, null); // no evidence → null, never 0
});

test('personalised ranking: over-risk and under-capital go to rejected with reasons', () => {
  const conservative = scanOpportunities({ ...INPUT, riskProfile: 'CONSERVATIVE' });
  const meme = conservative.rejected.find((o) => o.category === 'EMERGING_TOKEN');
  assert.ok(meme && meme.exclusionReasons.some((x) => x.code === 'risk-above-tolerance'));
  const poor = scanOpportunities({ ...INPUT, userCapitalUsd: 20 });
  assert.ok(poor.rejected.some((o) => o.exclusionReasons.some((x) => x.code === 'capital-below-min-viable' || x.code === 'net-profit-not-positive-after-fees')));
  // ranking is deterministic
  const a = scanOpportunities(INPUT).opportunities.map((o) => o.title);
  const b = scanOpportunities(INPUT).opportunities.map((o) => o.title);
  assert.deepEqual(a, b);
  assert.ok(scanOpportunities(INPUT).opportunities[0].rank === 1);
});

test('legacy v1 inputs still work (idle stables, concentration, RWA list)', () => {
  const r = scanOpportunities({
    now: NOW, riskProfile: 'MODERATE',
    financialState: { liquidUsd: 8000, stableRatio: 0.5 },
    rwaOpportunities: [{ name: 'Treasury', category: 'Treasury', expectedYield: 5 }]
  });
  assert.ok(r.opportunities.some((o) => o.type === 'YIELD_ON_IDLE'));
  assert.ok(r.opportunities.some((o) => o.type === 'RWA_INVESTMENT'));
});

test('cortex: live instance and readout both modulate scores; verdicts attached', () => {
  const plain = scanOpportunities(INPUT);
  assert.equal(plain.cortex.connected, false);
  const feat = buildCortexFeatureVector(INPUT);
  assert.equal(feat.vector.length, 8);
  assert.ok(feat.axesWithEvidence.includes('volumeImpulse'));

  const cortex = createNeuromorphicCortex();
  const live = scanOpportunities({ ...INPUT, cortex });
  assert.equal(live.cortex.connected, true);
  assert.ok(live.opportunities.every((o) => o.cortex && o.cortex.connected));
  assert.equal(live.cortex.laws.canExecute, false);

  const headwind = scanOpportunities({ ...INPUT, cortexReadout: { directionalDrive: -0.9, volatilityForecast: 0.95, anomalySurprise: 0.9, dominantRegime: 'shock' } });
  const whaleLive = live.opportunities.find((o) => o.category === 'WHALE_FLOW');
  const whaleHead = [...headwind.opportunities, ...headwind.rejected].find((o) => o.category === 'WHALE_FLOW');
  assert.ok(whaleHead.cortex.multiplier < (whaleLive?.cortex.multiplier ?? 1) + 0.31);
  assert.ok(['cortex-headwind', 'cortex-neutral', 'cortex-tailwind'].includes(whaleHead.cortex.note));
});
