import test from 'node:test';
import assert from 'node:assert/strict';
import { scanOpportunityDashboard } from '../src/lib/intent-ai/os/opportunityDashboard.js';

const now = Date.now();
const sources = {
  yields: async () => ({ at: now, pools: [
    { project: 'uniswap-v3', symbol: 'ETH-USDC', exposure: 'multi', chain: 'Base', apy: 15, tvlUsd: 10000000 },
    { project: 'aave-v3', symbol: 'USDC', exposure: 'single', chain: 'Base', apy: 8, tvlUsd: 30000000 },
    { project: 'lido', symbol: 'STETH', exposure: 'single', chain: 'Ethereum', apy: 5, tvlUsd: 20000000 }
  ] }),
  market: async () => [{ price: 1, change24h: 1, dataProvenance: 'live' }],
  whale: async () => null,
  emerging: async () => ({ dataStatus: 'live', at: now, tokens: [{ symbol: 'NEW', chain: 'base', ageHours: 12, liquidityUsd: 500000, priceChangeH24: 10 }] }),
  rwa: async () => [{ symbol: 'PAXG', name: 'Gold', price: 2000, dataProvenance: 'live' }],
  arbitrage: async () => [{ asset: 'ETH', buyVenue: 'A', sellVenue: 'B', buyPrice: 100, sellPrice: 103, depthUsd: 1000000, chain: 'base' }]
};

test('dashboard connects actual feeds and cortex to personalized economics and all families', async () => {
  let cortexCalled = false;
  const scan = await scanOpportunityDashboard({ capitalUsd: 10000, riskProfile: 'AGGRESSIVE', overrides: sources,
    cortexTick: async ({ markets }) => { cortexCalled = markets.length === 1; return { ok: true, readout: { directionalDrive: 0.3 } }; } });
  assert.equal(scan.dataStatus, 'live');
  assert.ok(cortexCalled && scan.cortex.connected);
  for (const item of scan.coverageDetails) assert.equal(item.count, item.category === 'WHALE_FLOW' ? 0 : 1, item.category);
  const rows = [...scan.opportunities, ...scan.rejected];
  assert.ok(rows.find((r) => r.category === 'LENDING').economics.fees.totalUsd > 0);
  assert.equal(rows.find((r) => r.category === 'EMERGING_TOKEN').economics, null);
  assert.equal(rows.find((r) => r.category === 'RWA').economics, null);
  assert.ok(rows.find((r) => r.category === 'ARBITRAGE').economics.netProfitUsd > 0);
});

test('failed, stale and offline feeds never masquerade as live; no capital is assumed', async () => {
  const out = await scanOpportunityDashboard({ overrides: {
    ...sources, yields: async () => ({ ...(await sources.yields()), at: now - 7200001 }),
    market: async () => [{ price: 2, dataProvenance: 'offline' }],
    emerging: async () => ({ dataStatus: 'live', at: now - 700000, tokens: [{ symbol: 'OLD' }] }),
    rwa: async () => [{ symbol: 'OLD', price: 1, dataProvenance: 'stale' }],
    arbitrage: async () => { throw new Error('offline'); }
  }, cortexTick: async () => { throw new Error('must not run'); } });
  assert.equal(out.dataStatus, 'unavailable');
  assert.equal(out.profile.capitalUsd, 0);
  assert.equal(out.opportunities.length, 0);
  assert.equal(out.cortex.connected, false);
  assert.equal(out.coverageDetails.find((x) => x.category === 'LIQUIDITY_POOL').status, 'unavailable');
});

test('fees and risk affect exclusions for the user capital and profile', async () => {
  const scan = await scanOpportunityDashboard({ capitalUsd: 1, riskProfile: 'CONSERVATIVE', overrides: sources });
  assert.ok(scan.rejected.some((o) => o.exclusionReasons.some((r) => r.code === 'net-profit-not-positive-after-fees')));
  assert.ok(scan.rejected.some((o) => o.exclusionReasons.some((r) => r.code === 'risk-above-tolerance')));
});

test('only fresh, independently verified paired swaps enter whale coverage', async () => {
  const snapshot = { dataStatus: 'observed', indexedAt: now, window: '24h', consensus: [{ chain: 1,
    token: '0x1111111111111111111111111111111111111111', symbol: 'ABC', confidence: 80,
    swaps: 4, independentVotes: 3, independentBuyers: 3, independentSellers: 0,
    netFlowUsd: 500000, lastAt: now, signal: 'ACCUMULATION' }] };
  const scan = await scanOpportunityDashboard({ capitalUsd: 1000, riskProfile: 'AGGRESSIVE', overrides: { ...sources, whale: async () => snapshot } });
  assert.equal(scan.coverageDetails.find((x) => x.category === 'WHALE_FLOW').count, 1);
  const whale = [...scan.opportunities, ...scan.rejected].find((x) => x.category === 'WHALE_FLOW');
  assert.equal(whale.economics, null);
  assert.ok(whale.feesIfActedUsd > 0);
  const stale = await scanOpportunityDashboard({ overrides: { ...sources, whale: async () => ({ ...snapshot, indexedAt: now - 37 * 3600000 }) } });
  assert.equal(stale.coverageDetails.find((x) => x.category === 'WHALE_FLOW').status, 'insufficient-evidence');
});
