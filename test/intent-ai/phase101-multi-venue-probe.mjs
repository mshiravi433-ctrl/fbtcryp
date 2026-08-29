/**
 * PHASES 101–116 — MULTI-VENUE PROFIT ENGINE
 * The planner must turn synthetic venue feeds into an honest plan: real
 * numbers only, funding annualised ONLY from a known interval, unreachable
 * targets reported instead of stretched, and execution never implied.
 */
import {
  PROFIT_PLAN_SCHEMA, MULTI_VENUE_SCHEMA, VENUE_CLASSES, RISK_PROFILES,
  normalizeVenueRows, annualiseFunding, venueClassHealth,
  planForProfitTarget, trackTargetProgress, suggestVenueSwitch,
  ALLOCATION_BASE, LEVERAGE_CAPS
} from '../../src/lib/intent-ai/index.js';

const results = [];
const check = (name, ok) => results.push({ name, ok: Boolean(ok) });

const NOW = 1_800_000_000_000;
const feeds = {
  spot: [],
  stocks: [
    { id: 'avantis-AAPL', label: 'AAPL', priceUsd: 230, change24hPct: 1.2, venue: 'avantis', observedAt: NOW },
    { id: 'avantis-NVDA', label: 'NVDA', priceUsd: 128, venue: 'avantis', observedAt: NOW }
  ],
  'dydx-global': [
    { id: 'dydx-BTC-USD', label: 'BTC-USD', priceUsd: 60000, fundingRatePct: 0.001, fundingIntervalHours: 1, openInterestUsd: 9e8, venue: 'dydx', observedAt: NOW },
    { id: 'dydx-ETH-USD', label: 'ETH-USD', priceUsd: 3000, fundingRatePct: -0.002, fundingIntervalHours: 1, venue: 'dydx', observedAt: NOW }
  ],
  futures: [
    { id: 'Binance (Futures)-BTC', label: 'BTCUSDT', priceUsd: 60100, fundingRatePct: 0.01, fundingIntervalHours: 8, openInterestUsd: 1e10, venue: 'Binance (Futures)', observedAt: NOW }
  ],
  'yield-farm': [
    { id: 'pool-a', label: 'Aave · USDC', apyPct: 6.2, tvlUsd: 1e9, riskTier: 'low', stablecoin: true, venue: 'ethereum', observedAt: NOW },
    { id: 'pool-b', label: 'Scam · MOON', apyPct: 9000, tvlUsd: 5e6, riskTier: 'high', stablecoin: false, venue: 'ethereum', observedAt: NOW }
  ]
};

try {
  /* ---------- feed normalisation ---------- */
  const rows = normalizeVenueRows(feeds, { now: NOW });
  check('five venue classes exist', VENUE_CLASSES.length === 5);
  check('risk profiles are three', RISK_PROFILES.join(',') === 'conservative,balanced,aggressive');
  check('rows land in their class', rows['yield-farm'].length === 2 && rows['dydx-global'].length === 2 && rows.stocks.length === 2);
  check('a stale row is marked stale', normalizeVenueRows({ 'yield-farm': [{ id: 'old', apyPct: 5, observedAt: NOW - 7 * 3600_000 }] }, { now: NOW })['yield-farm'][0].stale === true);

  /* ---------- funding annualisation ---------- */
  check('0.01% per 8h is 10.95% per year', Math.round(annualiseFunding(0.01, 8) * 100) / 100 === 10.95);
  check('an unknown interval refuses annualisation', annualiseFunding(0.01, null) === null);

  /* ---------- class health ---------- */
  const health = venueClassHealth(rows['yield-farm'], { now: NOW });
  check('class health counts fresh rows', health.live === true && health.count === 2);

  /* ---------- the plan ---------- */
  const plan = planForProfitTarget({ target: { mode: 'pct', value: 20 }, horizonDays: 365, capitalUsd: 1000, riskProfile: 'balanced', feeds, now: NOW });
  check('plan is schema-valid', plan.ok === true && plan.schema === PROFIT_PLAN_SCHEMA);
  check('allocations cover all five classes', plan.allocations.length === 5);
  check('allocations sum to the capital', plan.allocations.reduce((s, a) => s + a.allocatedUsd, 0) === 1000);
  check('farms pick the low-risk pool as the yield source', plan.allocations.find((a) => a.klass === 'yield-farm').bestRowId === 'pool-a');
  check('the scam pool never becomes the yield source', plan.allocations.find((a) => a.klass === 'yield-farm').yieldSource === 'pool:pool-a');
  check('funding APR comes from a known interval', plan.allocations.find((a) => a.klass === 'futures').expectedYieldPct > 0);
  check('spot never fabricates income', plan.allocations.find((a) => a.klass === 'spot').expectedYieldPct === 0);
  check('the plan says returns are not guaranteed', plan.messages.some((m) => m.key === 'plan.notGuaranteed'));
  check('the plan warns funding can flip', plan.messages.some((m) => m.key === 'plan.fundingCanFlip'));
  check('execution is never implied by the plan', plan.executionRequired === false);
  check('no raw credentials in a plan', plan.rawCredentialsInPlan === false);
  check('a 20% target is reachable from the fed yields', plan.targetReachability.feasible === true);
  check('an absurd target is reported unreachable, not stretched',
    planForProfitTarget({ target: { mode: 'pct', value: 9000 }, horizonDays: 30, capitalUsd: 1000, riskProfile: 'conservative', feeds, now: NOW }).targetReachability.feasible === false);
  check('a broken feed class is reported, not invented',
    planForProfitTarget({ target: { mode: 'pct', value: 10 }, horizonDays: 180, capitalUsd: 1000, feeds: {}, now: NOW }).venuesSeen === 0);
  check('aggressive profiles carry the leverage warning', planForProfitTarget({ target: { mode: 'pct', value: 10 }, capitalUsd: 1000, riskProfile: 'aggressive', feeds, now: NOW }).messages.some((m) => m.key === 'plan.leverageAmplifiesLoss'));

  /* ---------- progress ---------- */
  const progress = trackTargetProgress({ plan, portfolioUsd: 1080, now: NOW + 30 * 86400_000 });
  check('progress reports real numbers', progress.ok && progress.currentUsd === 1080 && progress.progressPct === 8);
  check('a broken plan is refused', trackTargetProgress({ plan: null }).ok === false);

  /* ---------- venue switch ---------- */
  const sw = suggestVenueSwitch({ plan, fromClass: 'yield-farm', currentYieldPct: 0.5 });
  check('a switch is proposed when a better live venue exists', sw.ok && sw.switch !== null && sw.switch.requiresConfirmation === true);
  check('a switch from an unknown class is refused', suggestVenueSwitch({ plan, fromClass: 'nonsense' }).ok === false);

  /* ---------- constants ---------- */
  check('allocation base sums to one per profile', Object.values(ALLOCATION_BASE).every((m) => Math.abs(Object.values(m).reduce((s, v) => s + v, 0) - 1) < 1e-9));
  check('leverage caps exist for every class per profile', Object.values(LEVERAGE_CAPS).every((m) => VENUE_CLASSES.every((k) => typeof m[k] === 'number')));
} catch (e) {
  check(`unexpected error: ${e.message}`, false);
}

const failed = results.filter((r) => !r.ok);
for (const r of results) console.log(`${r.ok ? '✓' : '✗'} ${r.name}`);
console.log(`${results.length - failed.length}/${results.length} passed`);
if (failed.length) {
  console.error(`FAILED: ${failed.map((r) => r.name).join(' | ')}`);
  process.exitCode = 1;
}
export default results;
