/** Live, read-only bridge between the app's feeds and the financial engine.
 * Missing feeds remain missing; catalog entries and offline prices are not rates. */
import { scanOpportunities } from '../../brain/opportunityEngine.js';
import { fetchIntelligence, fetchEarlyTokens } from '../../smartMoneyClient.js';
import { verifiedSignals } from '../../smartMoneyEvidence.js';

const LENDING = /^(aave|compound|morpho|spark|kamino-lend|jupiter-lend|fluid-lending|venus)/i;
const list = (x) => Array.isArray(x) ? x : [];
const usable = (p) => p && Number.isFinite(Number(p.apy)) && Number(p.apy) > 0;
const pair = (p) => p.exposure === 'multi' || /[-/]/.test(String(p.symbol || ''));
const timeout = (promise, ms = 40000) => new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error('TIMEOUT')), ms);
  Promise.resolve(promise).then((v) => { clearTimeout(timer); resolve(v); }, (e) => { clearTimeout(timer); reject(e); });
});

export async function scanOpportunityDashboard({ capitalUsd = 0, riskProfile = 'MODERATE', horizonDays = 30, cortexTick = null, overrides = {} } = {}) {
  const jobs = {
    yields: async () => overrides.yields ? overrides.yields() : (await import('../../yields.js')).getYields(),
    market: async () => overrides.market ? overrides.market() : (await import('../../api.js')).getMarkets({ page: 1, perPage: 40, vs: 'usd' }),
    whale: async () => overrides.whale ? overrides.whale() : fetchIntelligence('24h', undefined, { includePrices: false }),
    // Optional, explicit adapters: no inferred spread, token age or RWA yield.
    arbitrage: async () => overrides.arbitrage ? overrides.arbitrage() : null,
    emerging: async () => overrides.emerging ? overrides.emerging() : fetchEarlyTokens(30),
    rwa: async () => overrides.rwa ? overrides.rwa() : (await import('../../api.js')).getCategory('rwa', { perPage: 50, strict: true })
  };
  const entries = await Promise.all(Object.entries(jobs).map(async ([key, job]) => {
    try { return [key, { value: await timeout(job()), error: null }]; }
    catch (err) { return [key, { value: null, error: String(err?.message || err).slice(0, 100) }]; }
  }));
  const got = Object.fromEntries(entries);
  const yieldData = got.yields.value;
  const stamp = Number(yieldData?.at ?? yieldData?.updatedAt);
  const yieldFresh = Number.isFinite(stamp) && stamp > 0 && stamp <= Date.now() + 60000 && Date.now() - stamp < 7200000;
  const pools = yieldFresh ? list(yieldData?.pools).filter(usable) : [];
  const lp = pools.filter(pair).map((p) => ({ ...p, protocol: p.project || p.protocol, feeApy: p.apyBase, rewardApy: p.apyReward }));
  const lending = pools.filter((p) => !pair(p) && LENDING.test(p.project || p.protocol || '')).map((p) => ({ ...p, protocol: p.project || p.protocol, supplyApy: p.apy }));
  const farms = pools.filter((p) => !pair(p) && !LENDING.test(p.project || p.protocol || '')).map((p) => ({ ...p, protocol: p.project || p.protocol }));
  const consensus = verifiedSignals(got.whale.value);
  const whales = consensus.rows.map((r) => ({ asset: r.symbol, chain: r.chain, direction: r.signal === 'ACCUMULATION' ? 'buy' : 'distribution', netFlowUsd: r.netFlowUsd, walletCount: r.independentVotes, confidence: r.confidence / 100 }));
  const earlyPayload = got.emerging.value;
  const earlyFresh = earlyPayload?.dataStatus === 'live' && Number.isFinite(Number(earlyPayload.at)) && Date.now() - Number(earlyPayload.at) < 600000 && Number(earlyPayload.at) <= Date.now() + 60000;
  const early = Array.isArray(earlyPayload) ? earlyPayload : earlyFresh ? list(earlyPayload.tokens).map((r) => ({ symbol: r.symbol, name: r.name, chain: r.chain, ageDays: Number(r.ageHours) / 24, liquidityUsd: r.liquidityUsd, change24h: r.priceChangeH24, mcap: r.fdv })) : [];
  const rwaRows = list(got.rwa.value).filter((r) => r.dataProvenance === 'live' && Number(r.price ?? r.current_price) > 0).map((r) => ({ name: r.name, symbol: r.symbol, category: 'RWA sector token', priceUsd: Number(r.price ?? r.current_price), priceChange24h: r.change24h ?? r.price_change_percentage_24h }));
  const markets = list(got.market.value).filter((m) => ['live', 'live-bff'].includes(m.dataProvenance));
  let cortexReadout = null;
  if (cortexTick && markets.length) {
    try { const result = await timeout(cortexTick({ markets }), 10000); cortexReadout = result?.ok && !result.skipped ? result.readout || null : null; } catch { /* optional */ }
  }
  const scan = scanOpportunities({ userCapitalUsd: Math.max(0, Number(capitalUsd) || 0), riskProfile, horizonDays, limit: 30,
    liquidityPools: lp, farms, lendingMarkets: lending, whaleFlows: whales,
    arbitrage: list(got.arbitrage.value), emergingTokens: early, rwaAssets: rwaRows, cortexReadout });
  const coverage = [
    ['LIQUIDITY_POOL', 'yields', lp.length], ['FARMING', 'yields', farms.length], ['LENDING', 'yields', lending.length],
    ['ARBITRAGE', 'arbitrage', list(got.arbitrage.value).length], ['EMERGING_TOKEN', 'emerging', early.length],
    ['RWA', 'rwa', rwaRows.length], ['WHALE_FLOW', 'whale', whales.length]
  ].map(([category, source, count]) => ({ category, count, status: source === 'yields' ? (yieldFresh ? (count ? 'live' : 'empty') : 'unavailable') : source === 'whale' ? (count ? 'observed' : 'insufficient-evidence') : source === 'emerging' && !Array.isArray(earlyPayload) && !earlyFresh ? 'unavailable' : got[source].value == null ? 'unavailable' : (count ? 'live' : 'empty') }));
  return { ...scan, coverageDetails: coverage, sources: { yields: { at: yieldFresh ? stamp : null, error: got.yields.error }, market: { rows: markets.length, error: got.market.error }, whale: { status: consensus.dataStatus, error: got.whale.error } }, updatedAt: Date.now(), dataStatus: coverage.some((c) => c.count) ? 'live' : 'unavailable' };
}
