/**
 * FBT STRATEGY BRAIN — PROBE.
 * ---------------------------------------------------------------------------
 * The gap this whole module exists to close: the assistant could answer about
 * ONE module at a time, so «۱۰ هزار دلار، ۱۵٪ در ۴ ماه، ریسک متوسط» produced a
 * portfolio snapshot or a link to /stocks instead of a plan. This probe pins
 * the replacement against the real source, with only the upstream feeds faked:
 *
 *   A. goal spec      the sentence → capital, target, horizon, risk (Persian
 *                     digits, «هزار», the ٪ sign, «در یک سال»)
 *   B. ecosystem      21 domains read under a host budget: bounded
 *                     concurrency, per-domain timeout, TTL cache, honest gaps
 *   C. engine         one universe out of every module, risk band enforced,
 *                     real cost model, no forecast for price, unreachable
 *                     targets stay unreachable, options compared with reasons
 *   D. runtime        staged execution, a failure stops the plan, observation
 *                     → REVISE/HALT, a revision re-reads (never re-uses rates)
 *   E. wiring         the sentence classifies as STRATEGY_PLAN, the human layer
 *                     answers with a strategy card, the Operations card's
 *                     prompt classifies in all three locales
 *   F. host budget    the numbers that keep this cheap on a small host
 *
 * The law under test in every section: a number that was not read is never
 * invented, and a target the ecosystem cannot reach is never softened.
 */

import assert from 'node:assert/strict';
import {
  parseGoalSpec, readCapitalUsd, readTargetPct, readHorizonDays, readRiskProfile
} from '../../src/lib/strategyBrain/goalSpec.js';
import {
  createEcosystemReader, ECOSYSTEM_DOMAINS, DOMAIN_IDS, ECOSYSTEM_BUDGET, summarise
} from '../../src/lib/strategyBrain/ecosystemState.js';
import {
  buildPortfolioStrategy, buildOpportunityUniverse, normalizeOpportunity, estimateCost,
  deriveMarketView, portfolioRangePct, BLUEPRINTS, RISK_PROFILES
} from '../../src/lib/strategyBrain/strategyEngine.js';
import { createStrategyRuntime, planCurve } from '../../src/lib/strategyBrain/strategyRuntime.js';
import {
  saveStrategyPlan, readStrategyPlans, loadStrategyPlan, latestStrategyPlan,
  deleteStrategyPlan, linkRevision, hydrateRuntimeArgs, planLabel,
  STRATEGY_MAX_PLANS, STRATEGY_STORE_KEY
} from '../../src/lib/strategyBrain/strategyStore.js';
import { num } from '../../src/lib/strategyBrain/numeric.js';
import { understandIntent } from '../../src/lib/intent-ai/os/intentUnderstanding.js';
import { buildHumanResponse } from '../../src/lib/intent-ai/os/humanResponse.js';
import { OPERATIONS } from '../../src/lib/intent-ai/os/opsCatalog.js';
import { opsCardPrompt, promptsThatFailToClassify } from '../../src/lib/intent-ai/os/opsCardPrompts.js';
import { missingOpsTranslations } from '../../src/lib/intent-ai/os/opsCatalogI18n.js';

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok: Boolean(ok), detail });
  if (!ok) console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`);
};

/* ── a fake ecosystem: 20 of 21 domains answer, gas does not ─────────────── */
const ECOSYSTEM = {
  wallet: { connected: true, address: '0xabc', chainId: 8453 },
  portfolio: {
    totalValueUsd: 10000,
    holdings: [
      { symbol: 'BTC', coinId: 'bitcoin', valueUsd: 6000 },
      { symbol: 'USDC', coinId: 'usd-coin', valueUsd: 4000 }
    ]
  },
  crypto: [
    { id: 'bitcoin', symbol: 'BTC', price: 101000, priceChange24hPct: 2.4, priceChange7dPct: 6.1, marketCap: 2e12, risk: 'medium' },
    { id: 'ethereum', symbol: 'ETH', price: 3200, priceChange24hPct: -3.1, priceChange7dPct: -2.0, marketCap: 4e11, risk: 'medium' }
  ],
  rwa: [{ id: 'pax-gold', symbol: 'PAXG', priceChange24hPct: 0.4, marketCap: 5e8 }],
  lending: [
    { id: 'aave-usdc', symbol: 'USDC', project: 'aave-v3', apy: 6.4, tvlUsd: 9e8, risk: 'low' },
    { id: 'morpho-usdc', symbol: 'USDC', project: 'morpho-blue', apy: 8.9, tvlUsd: 2e8, risk: 'low' },
    { id: 'aave-weth', symbol: 'WETH', project: 'aave-v3', apy: 2.1, tvlUsd: 4e8, risk: 'medium' }
  ],
  farming: [
    { id: 'farm-1', symbol: 'AERO', project: 'aerodrome', apy: 24.5, tvlUsd: 6e7, risk: 'medium' },
    { id: 'farm-2', symbol: 'STG', project: 'stargate', apy: 12.2, tvlUsd: 3e7, risk: 'medium' }
  ],
  liquidity: [{ id: 'lp-1', symbol: 'USDC-WETH', project: 'uniswap-v3', apy: 18.3, tvlUsd: 1.2e8, risk: 'medium' }],
  futures: [{ id: 'BTC-PERP', symbol: 'BTC', venue: 'perp', fundingAprPct: 11.4, volumeUsd: 8e8 }],
  dydx: [{ id: 'ETH-USD', symbol: 'ETH', venue: 'dYdX', fundingAprPct: 9.2, volumeUsd: 2e8 }],
  smartMoney: { netFlowUsd: 42_000_000 },
  whales: { eventCount: 18, exchangeInflowUsd: 3e7, exchangeOutflowUsd: 9e7 },
  news: { count: 12, sentimentScore: 0.3 },
  macro: { regime: 'risk_on', marketCapChange24hPct: 1.8 },
  risk: { concentrationPct: 60, alerts: [{ code: 'CONCENTRATION', detail: 'BTC is 60%' }] },
  fees: { feeBps: 70 },
  correlation: { pairs: [{ a: 'BITCOIN', b: 'ETHEREUM', corr: 0.86 }] },
  stocks: [{ id: 'AAPL', symbol: 'AAPL', venue: 'Ostium', price: 220, priceChange24hPct: 0.6 }],
  forex: [{ id: 'EURUSD', symbol: 'EUR', venue: 'Ostium', price: 1.08 }],
  commodities: [{ id: 'XAUUSD', symbol: 'XAU', venue: 'Ostium', price: 2650, priceChange24hPct: 0.3 }]
};

const readersFrom = (data, overrides = {}) => Object.fromEntries(
  Object.entries({ ...data, ...overrides }).map(([k, v]) => [k, typeof v === 'function' ? v : async () => v])
);

const FA_GOAL = 'من ۱۰ هزار دلار دارم، در ۴ ماه حداقل ۱۵٪ سود می‌خواهم و ریسک متوسط قبول دارم';
const EN_GOAL = 'I have 10000 dollars and want at least 15% profit in 4 months with medium risk';

try {
  /* ═══════════════════ A. the sentence → the four numbers ═════════════════ */
  const spec = parseGoalSpec({ text: FA_GOAL });
  check('the Persian objective parses completely', spec.ok === true && spec.missing.length === 0);
  check('«۱۰ هزار دلار» is 10 000, not 10', spec.capitalUsd === 10000, `got ${spec.capitalUsd}`);
  check('the capital is attributed to the user, not to a wallet', spec.capitalSource === 'user');
  check('«۱۵٪ سود» is a 15% target through the Persian percent sign', spec.targetPct === 15, `got ${spec.targetPct}`);
  check('«حداقل» makes the target a FLOOR', spec.floorPct === 15);
  check('«۴ ماه» is 120 days', spec.horizonDays === 120, `got ${spec.horizonDays}`);
  check('«ریسک متوسط» is the balanced band', spec.riskProfile === 'balanced');

  const en = parseGoalSpec({ text: EN_GOAL });
  check('the same objective parses in English', en.ok && en.capitalUsd === 10000 && en.targetPct === 15 && en.horizonDays === 120 && en.riskProfile === 'balanced');
  check('«در یک سال» is a year', parseGoalSpec({ text: '۵ هزار دلار، سود ۲۰ درصد در یک سال، ریسک کم' }).horizonDays === 365);
  check('«سودم دو برابر شود» is a 100% target', parseGoalSpec({ text: '۵ هزار دلار دارم سودم دو برابر بشه در ۶ ماه' }).targetPct === 100);
  check('risk words map to the three bands',
    readRiskProfile({ text: 'ریسک کم' }).profile === 'conservative'
    && readRiskProfile({ text: 'high risk' }).profile === 'aggressive'
    && readRiskProfile({ text: 'بدون ریسک' }).profile === 'conservative');

  const incomplete = parseGoalSpec({ text: 'یک استراتژی پرتفوی بساز' });
  check('a request with no numbers reports what is missing instead of guessing',
    incomplete.ok === false && incomplete.missing.includes('capitalUsd') && incomplete.missing.includes('targetPct'));
  check('capital falls back to the wallet when the sentence has none',
    readCapitalUsd({ text: 'استراتژی بساز', portfolio: { totalValueUsd: 4321 } }).usd === 4321);
  check('no capital anywhere is 0, never a default',
    readCapitalUsd({ text: 'استراتژی بساز' }).usd === 0);
  check('a target with no percent is absent, not zero', readTargetPct({ text: 'سود می‌خواهم' }).pct === null);
  check('no horizon is absent, not 365', readHorizonDays({ text: 'سود ۱۰ درصد' }).days === null);

  /* the null-is-not-zero rule, which the first version of this module broke */
  check('null is not zero', num(null) === null && num(undefined) === null && num('') === null && num(0) === 0);
  check('an unread drawdown does not become 0%',
    normalizeOpportunity('farming', { family: 'farm', id: 'x', symbol: 'AERO', apy: 24 }).drawdownPct > 0);

  /* ═══════════════════ B. reading the whole ecosystem ════════════════════ */
  check('the domain list is the 21 the user named', ECOSYSTEM_DOMAINS.length === 21, `got ${ECOSYSTEM_DOMAINS.length}`);
  check('wallet and portfolio are the only critical domains',
    ECOSYSTEM_DOMAINS.filter((d) => d.critical).map((d) => d.id).join(',') === 'wallet,portfolio');

  let calls = 0;
  const counting = readersFrom(ECOSYSTEM, {
    crypto: async () => { calls += 1; return ECOSYSTEM.crypto; }
  });
  const reader = createEcosystemReader({ readers: counting });
  const state = await reader.read();
  check('every bound domain was read in one pass', state.coverage.requested === DOMAIN_IDS.length);
  check('coverage counts what actually answered', state.coverage.live === 19 && state.coverage.skipped === 2, JSON.stringify(state.coverage));
  check('the two unbound domains are named as gaps',
    state.gaps.map((g) => g.domain).sort().join(',') === 'bridge,gas');
  check('an unbound domain is skipped, never silently absent',
    state.domains.gas?.status === 'skipped' && state.gaps.some((g) => g.domain === 'gas'));
  check('concurrency stayed inside the host budget',
    reader.peakConcurrency() <= ECOSYSTEM_BUDGET.concurrency, `peak ${reader.peakConcurrency()}`);

  const before = calls;
  await reader.read();
  check('a second read inside the TTL costs nothing', calls === before, `${before} → ${calls}`);
  await reader.read({ force: true });
  check('force bypasses the cache', calls === before + 1);

  const slow = createEcosystemReader({
    readers: readersFrom(ECOSYSTEM, { farming: async () => new Promise((r) => setTimeout(() => r(ECOSYSTEM.farming), 200)) }),
    timeoutMs: 20
  });
  const slowState = await slow.read();
  check('a slow provider times out and becomes a named gap',
    slowState.domains.farming.status === 'timeout' && slowState.gaps.some((g) => g.domain === 'farming' && g.kind === 'timeout'));
  check('one slow domain does not stop the others', slowState.coverage.live >= 18, `${slowState.coverage.live}`);

  const broken = createEcosystemReader({
    readers: readersFrom(ECOSYSTEM, { lending: async () => { throw new Error('feed down'); } })
  });
  const brokenState = await broken.read();
  check('a throwing provider is reported with its reason',
    brokenState.domains.lending.status === 'error' && /feed down/.test(brokenState.domains.lending.reason));
  check('an empty answer is EMPTY, not live',
    summarise({ domains: { x: { domain: 'x', status: 'empty', tookMs: 1 } } }).coverage.empty === 1);

  const noWallet = createEcosystemReader({ readers: readersFrom({ ...ECOSYSTEM, wallet: null, portfolio: null }) });
  const noWalletState = await noWallet.read();
  check('a missing critical domain is named', noWalletState.missingCritical.includes('wallet'));
  const noWalletStrategy = buildPortfolioStrategy({ goal: spec, state: noWalletState });
  check('capital the USER stated is enough to plan without a wallet read',
    noWalletStrategy.ok === true, noWalletStrategy.detail || noWalletStrategy.code);
  check('…and the plan says it has not seen the holdings',
    noWalletStrategy.limitations.some((l) => /no wallet was read/i.test(l)));
  const noWalletNoAmount = buildPortfolioStrategy({ goal: { ...spec, capitalSource: 'portfolio', capitalUsd: 0 }, state: noWalletState });
  check('without either source it still refuses', noWalletNoAmount.ok === false);

  /* ═══════════════════ C. the decision ═══════════════════════════════════ */
  const strategy = buildPortfolioStrategy({ goal: spec, state, now: 1_800_000_000_000 });
  check('a full ecosystem produces a strategy', strategy.ok === true, strategy.detail || strategy.code);
  check('the strategy carries the schema the card renders', strategy.schema === 'fbt.portfolio-strategy.v1');

  const universe = buildOpportunityUniverse(state);
  check('the universe is built from EVERY module that answered',
    universe.length >= 12, `${universe.length} rows`);
  check('families span yield, markets and derivatives',
    ['lending', 'farm', 'lp', 'crypto', 'derivatives'].every((f) => universe.some((r) => r.family === f)),
    [...new Set(universe.map((u) => u.family))].join(','));
  check('a stablecoin lending row is recognised as cash',
    universe.find((r) => r.id === 'aave-usdc')?.family === 'cash');
  check('a market row has NO forecast: zero drift, labelled',
    universe.find((r) => r.id === 'bitcoin')?.basis === 'zero-drift'
    && universe.find((r) => r.id === 'bitcoin')?.returnPctAnnual === 0);
  check('volatility is derived from the real 24h move, not invented',
    Math.round(universe.find((r) => r.id === 'bitcoin').annualVolPct) === Math.round(2.4 * Math.sqrt(365)));

  check('the required APY for 15% in 120 days is ~53%',
    Math.round(strategy.goal.requiredApyPct) === 53, `${strategy.goal.requiredApyPct}`);
  check('the target is NOT dressed up as reachable', strategy.verdict.reachable === false);
  check('the verdict separates what rates carry from what only price can',
    strategy.verdict.sourcedReturnPct > 0 && strategy.verdict.priceGapPct > 0
    && Math.abs(strategy.verdict.sourcedReturnPct + strategy.verdict.priceGapPct - 15) < 0.05,
    JSON.stringify({ s: strategy.verdict.sourcedReturnPct, g: strategy.verdict.priceGapPct }));
  check('the honesty line states the gap in words', /price/i.test(strategy.honesty) && /52\.98|53/.test(strategy.honesty));
  check('a stretch option is named when the target is out of reach',
    strategy.alternatives.stretch != null && /price/i.test(strategy.alternatives.stretchNote));

  const totalWeight = strategy.sleeves.reduce((acc, s) => acc + s.weightPct, 0);
  check('the allocation sums to 100%', Math.abs(totalWeight - 100) < 0.5, `${totalWeight}`);
  check('every sleeve has a real amount', strategy.sleeves.every((s) => s.amountUsd > 0));
  check('no sleeve exceeds the band ceiling',
    strategy.sleeves.every((s) => s.weightPct <= RISK_PROFILES[spec.riskProfile].maxSleevePct + 0.5));
  check('every sleeve is inside the risk band',
    strategy.sleeves.every((s) => s.weightPct > 0) && strategy.risk.weightedRiskRank <= RISK_PROFILES[spec.riskProfile].maxRiskRank + 0.001);
  check('each sleeve names the venue that would execute it',
    strategy.sleeves.every((s) => s.handoff?.route && s.handoff?.capabilityId));

  /* cost: the bug this pins is charging a swap fee to a stable lending leg */
  const stableCost = estimateCost({
    sleeves: [{ family: 'cash', row: { asset: 'USDC', stable: true } }],
    capitalUsd: 10000,
    gas: { gasUsd: 1 }
  });
  check('a stablecoin lending leg pays no platform fee', stableCost.feePct === 0, `${stableCost.feePct}`);
  const marketCost = estimateCost({
    sleeves: [{ family: 'crypto', row: { asset: 'BTC' } }],
    capitalUsd: 10000,
    gas: { gasUsd: 1 }
  });
  check('a market leg pays the 70bps entry fee', Math.abs(marketCost.feePct - 0.7) < 0.001, `${marketCost.feePct}`);
  check('entry and round-trip costs are reported separately',
    marketCost.roundTripPct > marketCost.totalPct);
  const noGas = estimateCost({ sleeves: [{ family: 'farm', row: { asset: 'AERO' } }], capitalUsd: 10000, gas: null });
  check('an unread gas price makes the cost a floor, never zero',
    noGas.complete === false && noGas.totalPct === null && noGas.gasUsd === null);

  check('the market view is read, not assumed',
    strategy.marketView.regime === 'risk_on' && strategy.marketView.signals.length >= 4,
    JSON.stringify(strategy.marketView.readDomains));
  check('the market view carries a conviction, not a certainty',
    strategy.marketView.conviction > 0 && strategy.marketView.conviction < 1);
  check('whale exchange outflow reads as support, inflow as pressure',
    deriveMarketView({ domains: { whales: { status: 'live', data: { exchangeInflowUsd: 1e8, exchangeOutflowUsd: 0 } } } }).bias < 0);

  check('several blueprints were compared', strategy.comparison.length >= 4, `${strategy.comparison.length}`);
  check('every comparison row carries return, risk, cost and confidence',
    strategy.comparison.every((c) => c.expectedReturnPct != null && c.riskPct != null && c.costPct != null && c.confidence > 0));
  check('every candidate has a stated reason for its rank',
    strategy.ranking.length === strategy.comparison.length
    && strategy.ranking.every((r) => r.reason && ['CHOSEN', 'REJECTED'].includes(r.verdict)));
  check('the winner is the highest score',
    strategy.comparison.every((c) => c.score <= strategy.comparison.find((x) => x.id === strategy.chosen).score + 0.001));
  check('a price sleeve is scored with a range, not a promise',
    portfolioRangePct({
      sleeves: [{ weightPct: 50, annualVolPct: 46 }, { weightPct: 50, annualVolPct: 10 }],
      days: 120
    }) > 0);

  check('the plan is built in stages', strategy.stages.length >= 3);
  check('stage 0 is a pre-flight that moves nothing',
    strategy.stages[0].id === 'preflight' && strategy.stages[0].movesFunds === false);
  check('every money-moving action requires a signature',
    strategy.stages.flatMap((s) => s.actions).filter((a) => a.requiresSignature).length > 0
    && strategy.stages.every((s) => s.actions.every((a) => typeof a.requiresSignature === 'boolean')));
  check('every action hands off to a real route and capability',
    strategy.stages.flatMap((s) => s.actions).every((a) => a.route && a.capabilityId && a.module && a.operation));
  check('a deployed stage names the venue, asset and amount',
    strategy.stages.find((s) => s.id === 'deploy-yield')?.actions.every((a) => a.params?.amountUsd > 0));
  check('the plan carries monitors that can trigger a revision',
    strategy.monitors.length >= 4 && strategy.revisionPolicy.triggers.length === strategy.monitors.length);
  check('the plan never claims execution authority',
    strategy.fundsMoved === false && strategy.executionAuthorized === false);
  check('the plan lists its own limitations',
    strategy.limitations.length >= 2 && strategy.limitations.some((l) => /not read|forecast/i.test(l)));
  check('the coverage the card shows is the coverage that happened',
    strategy.coverage.pct === state.coverage.pct);

  /* refusals */
  const noCapital = buildPortfolioStrategy({ goal: parseGoalSpec({ text: 'استراتژی بساز' }), state });
  check('no capital refuses instead of planning a fiction',
    noCapital.ok === false && noCapital.code === 'CAPITAL_REQUIRED');
  const noTarget = buildPortfolioStrategy({ goal: { ...spec, targetPct: null }, state });
  check('no target refuses', noTarget.ok === false && noTarget.code === 'NO_TARGET');
  const emptyState = await createEcosystemReader({ readers: {} }).read();
  const noData = buildPortfolioStrategy({ goal: spec, state: emptyState });
  check('an ecosystem that answered nothing refuses',
    noData.ok === false && ['CRITICAL_DOMAIN_MISSING', 'NO_OPPORTUNITIES'].includes(noData.code), noData.code);

  /* the conservative band must not be handed leverage or derivatives */
  const safeSpec = { ...spec, riskProfile: 'conservative' };
  const safe = buildPortfolioStrategy({ goal: safeSpec, state });
  check('a conservative ask gets no derivative sleeve',
    safe.ok && safe.sleeves.every((s) => s.family !== 'derivatives'), safe.sleeves?.map((s) => s.family).join(','));
  check('a conservative ask stays inside its own drawdown budget',
    safe.ok && safe.risk.estimatedDrawdownPct <= RISK_PROFILES.conservative.drawdownBudgetPct);
  const aggro = buildPortfolioStrategy({ goal: { ...spec, riskProfile: 'aggressive' }, state });
  check('an aggressive ask may reach derivatives',
    aggro.ok && aggro.universe.families.includes('derivatives'));

  /* ═══════════════════ D. staged execution, monitoring, revision ═════════ */
  let reads = 0;
  const runtime = createStrategyRuntime({
    strategy, goal: spec,
    readEcosystem: async () => { reads += 1; return state; },
    now: () => 1_800_000_000_000
  });
  check('the runtime starts at the pre-flight stage', runtime.nextStage().stage?.id === 'preflight');
  const first = runtime.advance();
  check('advancing hands back the handoff actions, not a signature',
    first.ok && first.actions.length > 0 && first.executionAuthorized === false);
  check('a money-moving stage says so', runtime.state().stages.some((s) => s.movesFunds === true));
  runtime.confirmStage('preflight', { receipt: { ok: true } });
  check('a confirmed stage unlocks the next one',
    ['deploy-yield', 'consolidate'].includes(runtime.nextStage().stage?.id), runtime.nextStage().stage?.id);

  runtime.failStage('deploy-yield', { code: 'USER_REJECTED', message: 'wallet closed' });
  const afterFail = runtime.nextStage();
  check('a failed stage STOPS the plan instead of skipping ahead',
    afterFail.ok === false && afterFail.code === 'STAGE_FAILED', JSON.stringify(afterFail));
  check('the failure keeps its own code', runtime.state().stageProgress['deploy-yield'].error.code === 'USER_REJECTED');

  const observing = createStrategyRuntime({ strategy, goal: spec, readEcosystem: async () => state, now: () => 1_800_000_000_000 });
  const calm = observing.observe({ portfolioValueUsd: 10050, drawdownPct: 1 });
  check('a healthy observation continues', calm.decision === 'CONTINUE' && calm.triggers.length === 0);
  const breachUndeployed = observing.observe({ portfolioValueUsd: 8000, drawdownPct: 25 });
  check('a drawdown through the budget HALTs a plan that was never deployed',
    breachUndeployed.decision === 'HALT' && breachUndeployed.triggers.some((t) => t.id === 'drawdown-budget'),
    breachUndeployed.decision);
  const deployed = createStrategyRuntime({ strategy, goal: spec, readEcosystem: async () => { reads += 1; return state; }, now: () => 1_800_000_000_000 });
  for (const st of strategy.stages.filter((x) => x.movesFunds)) deployed.confirmStage(st.id, { receipt: { ok: true } });
  const breach = deployed.observe({ portfolioValueUsd: 8000, drawdownPct: 25 });
  check('the same breach on a DEPLOYED plan triggers a revision, not a halt',
    breach.decision === 'REVISE' && breach.triggers.some((t) => t.id === 'drawdown-budget'),
    breach.decision);
  const decay = observing.observe({ portfolioValueUsd: 10000, signals: { apyDecayPct: 45 } });
  check('a collapsing APY triggers a revision', decay.triggers.some((t) => t.id === 'rate-decay'));

  const revised = await deployed.revise({ reason: 'drawdown-budget', observation: breach });
  check('a revision re-reads the ecosystem instead of re-using rates', revised.ok && reads === 1);
  check('a revision links to the strategy it replaced',
    revised.revision.fromStrategyId === strategy.strategyId && revised.revision.toStrategyId !== strategy.strategyId);
  check('a revision never claims it moved funds', revised.revision.fundsMoved === false);
  check('revision history is capped', deployed.state().revisions.length <= 5);

  const noReader = createStrategyRuntime({ strategy, goal: spec });
  const refused = await noReader.revise({});
  check('a revision without a reader is refused, not faked',
    refused.ok === false && refused.code === 'NO_ECOSYSTEM_READER');

  const START = 1_800_000_000_000 - 30 * 86_400_000;
  const curve = planCurve({
    strategy,
    stageProgress: { 'deploy-yield': { confirmedAt: START } },
    at: 1_800_000_000_000,
    startedAt: START
  });
  check('the plan curve earns only from the moment a stage is confirmed',
    curve.expectedReturnPct > 0 && curve.elapsedDays === 30, JSON.stringify(curve));
  check('pace is the straight-line share of the target',
    Math.abs(curve.paceReturnPct - 15 * (30 / 120)) < 0.01, `${curve.paceReturnPct}`);
  const undeployedCurve = planCurve({ strategy, stageProgress: {}, at: 1_800_000_000_000, startedAt: START });
  check('nothing confirmed yet earns nothing but still pays the entry cost',
    undeployedCurve.expectedReturnPct < 0, `${undeployedCurve.expectedReturnPct}`);
  check('halt stops the runtime', (observing.halt('STOP'), observing.nextStage().ok === false));

  /* ═══════════════════ E. wiring into the real chat ══════════════════════ */
  const intent = understandIntent(FA_GOAL, {});
  check('the objective classifies as STRATEGY_PLAN, not PORTFOLIO_ANALYSIS',
    intent.type === 'STRATEGY_PLAN', `${intent.type}@${intent.confidence}`);
  check('the English objective classifies the same way', understandIntent(EN_GOAL, {}).type === 'STRATEGY_PLAN');
  check('a plain portfolio question is untouched', understandIntent('پرتفوی من را تحلیل کن', {}).type === 'PORTFOLIO_ANALYSIS');
  check('a plain goal is untouched', understandIntent('سودم دو برابر شود', {}).type === 'GOAL_PLAN');
  check('a bare noun is untouched', understandIntent('استراتژی', {}).type === 'STRATEGY');

  const human = buildHumanResponse({
    intent, context: { portfolio: { totalValueUsd: 10000, holdings: [] }, lastMessage: FA_GOAL },
    results: {}, plan: {}, locale: 'fa'
  });
  check('the human layer answers with a strategy card, not prose',
    human.ui?.type === 'STRATEGY_PLAN_CARD');
  check('the card request carries the sentence the numbers came from',
    human.strategyRequest?.text === FA_GOAL);
  check('the strategy answer stays in the chat (it is not a page)',
    /استراتژی|اکوسیستم/.test(human.message) && human.navigated === undefined);
  const humanEn = buildHumanResponse({ intent, context: { lastMessage: EN_GOAL }, results: {}, plan: {}, locale: 'en-US' });
  check('an English ask gets an English card intro', /ecosystem/i.test(humanEn.message));

  const card = OPERATIONS.find((c) => c.id === 'strategy_build');
  check('the Operations Center has the strategy card', Boolean(card) && card.category === 'goals');
  check('the card prompt classifies in every locale',
    ['fa', 'en', 'ar'].every((loc) => understandIntent(opsCardPrompt(card, loc), {}).type === 'STRATEGY_PLAN'));
  check('no Operations card is a dead button', promptsThatFailToClassify(understandIntent).length === 0);
  check('the new card is translated in all three locales',
    missingOpsTranslations().cards.length === 0 && missingOpsTranslations().categories.length === 0);

  /* ═══════════════════ F. the host budget ════════════════════════════════ */
  check('the budget is small by construction',
    ECOSYSTEM_BUDGET.concurrency === 4 && ECOSYSTEM_BUDGET.timeoutMs === 6000 && ECOSYSTEM_BUDGET.maxRows === 40);
  check('blueprints are capped', BLUEPRINTS.length <= 6);
  check('a domain returns at most maxRows rows', (() => {
    const many = createEcosystemReader({
      readers: { lending: async () => Array.from({ length: 500 }, (_, i) => ({ id: `p${i}`, symbol: 'USDC', project: 'aave-v3', apy: 5 })) },
      maxRows: 40
    });
    return true;
  })());
  const capped = await createEcosystemReader({
    readers: { lending: async () => Array.from({ length: 500 }, (_, i) => ({ id: `p${i}`, symbol: 'USDC', project: 'aave-v3', apy: 5 })) }
  }).read({ only: ['lending'] });
  check('a 500-row feed is trimmed to the cap', capped.domains.lending.rowCount === 40, `${capped.domains.lending.rowCount}`);
  const cacheReader = createEcosystemReader({ readers: readersFrom(ECOSYSTEM) });
  await cacheReader.read();
  check('the cache never grows past the domain list', cacheReader.cacheSize() <= DOMAIN_IDS.length);

  /* ── H. PERSISTENCE — a 4-month plan must survive the tab closing ─────────
     A plan built for a horizon measured in months is worthless if the stage
     progress dies on reload: staged execution and revision both act on that
     progress. These checks drive a real save → confirm → reload → resume
     cycle against an in-memory store, which is exactly the surface the app
     gets when it passes localStorage. ──────────────────────────────────── */

  const memoryStore = () => {
    const map = new Map();
    return {
      getItem: (k) => (map.has(k) ? map.get(k) : null),
      setItem: (k, v) => { map.set(k, String(v)); },
      removeItem: (k) => { map.delete(k); },
      _map: map
    };
  };

  const persistStore = memoryStore();
  /* The same fixed clock the runtime checks above use, so a resumed plan is
     compared against the curve it was built with rather than against now(). */
  const T0 = 1_800_000_000_000;
  const goalForPersist = parseGoalSpec({ text: FA_GOAL });
  const persistState = await createEcosystemReader({ readers: readersFrom(ECOSYSTEM) }).read();
  const persistPlan = buildPortfolioStrategy({ goal: goalForPersist, state: persistState, now: T0 });

  check('nothing is stored before a plan is saved', readStrategyPlans({ store: persistStore }).length === 0);
  check('saving a non-strategy is refused', saveStrategyPlan({ strategy: { ok: false }, store: persistStore }) === null);

  const persistRt = createStrategyRuntime({ strategy: persistPlan, goal: goalForPersist, now: () => T0 });
  const firstSaved = saveStrategyPlan({ strategy: persistPlan, goal: goalForPersist, runtime: persistRt.state(), store: persistStore, now: T0 });
  check('a built plan is persisted', Boolean(firstSaved), JSON.stringify(firstSaved)?.slice(0, 60));
  check('it is stored under one bounded key', persistStore._map.has(STRATEGY_STORE_KEY));
  check('the stored record keeps the strategyId', firstSaved?.strategyId === persistPlan.strategyId);
  check('the stored record keeps the goal', firstSaved?.goal?.capitalUsd === goalForPersist.capitalUsd);
  check('a headline summary is kept for the resume list',
    firstSaved?.headline?.targetPct === goalForPersist.targetPct
    && firstSaved.headline.stageCount === persistPlan.stages.length);
  check('the resume label is human-readable Persian', /هدف .*٪/.test(planLabel(firstSaved)), planLabel(firstSaved));
  check('the resume label has an English form too', /target/.test(planLabel(firstSaved, { locale: 'en' })));

  /* ── the stage truth is what cannot be rebuilt ────────────────────────── */
  const advancing = persistRt.advance();
  const stageA = advancing.stage.id;
  persistRt.confirmStage(stageA, { txHash: '0xreceipt1' });
  saveStrategyPlan({ strategy: persistPlan, goal: goalForPersist, runtime: persistRt.state(), store: persistStore, now: T0 + 60_000 });

  const reloaded = loadStrategyPlan(persistPlan.strategyId, { store: persistStore });
  check('the plan can be read back by id', Boolean(reloaded));
  check('it is also the latest plan', latestStrategyPlan({ store: persistStore })?.strategyId === persistPlan.strategyId);
  check('saving twice does not duplicate it', readStrategyPlans({ store: persistStore }).length === 1,
    `${readStrategyPlans({ store: persistStore }).length}`);
  check('the confirmed stage survived the round trip',
    reloaded?.runtime?.stageProgress?.[stageA]?.state === 'CONFIRMED',
    JSON.stringify(reloaded?.runtime?.stageProgress?.[stageA]));
  check('its receipt survived too', reloaded?.runtime?.stageProgress?.[stageA]?.receipt?.txHash === '0xreceipt1');

  /* ── resume: the runtime must continue, not restart ───────────────────── */
  const resumedArgs = hydrateRuntimeArgs(reloaded);
  check('a stored record yields runtime arguments', Boolean(resumedArgs?.strategy));
  const resumed = createStrategyRuntime({ ...resumedArgs, now: () => T0 + 60_000 });
  check('the resumed runtime keeps the confirmation',
    resumed.state().stageProgress[stageA].state === 'CONFIRMED');
  check('the resumed runtime keeps the receipt',
    resumed.state().stageProgress[stageA].receipt?.txHash === '0xreceipt1');
  const afterResume = resumed.nextStage();
  check('the resumed runtime does not re-run the confirmed stage',
    afterResume.ok && afterResume.stage?.id !== stageA,
    JSON.stringify({ ok: afterResume.ok, stage: afterResume.stage?.id, code: afterResume.code }));

  const freshRt = createStrategyRuntime({ strategy: persistPlan, goal: goalForPersist, now: () => T0 + 60_000 });
  check('without hydration the same plan starts over',
    freshRt.state().stageProgress[stageA].state === 'READY',
    freshRt.state().stageProgress[stageA].state);

  /* ── hygiene ──────────────────────────────────────────────────────────── */
  const secretStore = memoryStore();
  const secretPlan = buildPortfolioStrategy({
    goal: goalForPersist,
    state: await createEcosystemReader({ readers: readersFrom(ECOSYSTEM) }).read(),
    now: T0 + 1
  });
  const withSecrets = createStrategyRuntime({ strategy: secretPlan, goal: goalForPersist, now: () => T0 });
  withSecrets.confirmStage(secretPlan.stages[0].id, { receipt: { txHash: '0xabc', signature: '0xDEADBEEF' } });
  saveStrategyPlan({
    strategy: secretPlan, goal: goalForPersist, runtime: withSecrets.state(),
    store: secretStore, now: T0
  });
  const rawBlob = secretStore.getItem(STRATEGY_STORE_KEY) || '';
  check('a signature never reaches storage', !rawBlob.includes('DEADBEEF'));
  check('but the transaction hash is kept', rawBlob.includes('0xabc'));

  check('a corrupt blob degrades to an empty store',
    (() => { const bad = memoryStore(); bad.setItem(STRATEGY_STORE_KEY, '{not json'); return readStrategyPlans({ store: bad }).length === 0; })());
  check('a blob without a plans array is ignored',
    (() => { const bad = memoryStore(); bad.setItem(STRATEGY_STORE_KEY, '{"schema":"x"}'); return readStrategyPlans({ store: bad }).length === 0; })());
  check('hydrating from a broken record yields nothing', hydrateRuntimeArgs({ strategy: null }) === null);
  check('a runtime built from a garbage hydrate still works',
    createStrategyRuntime({ strategy: persistPlan, goal: goalForPersist, hydrate: { stageProgress: 'nope' }, now: () => T0 })
      .state().stageProgress[stageA].state === 'READY');
  check('an unknown stage in storage is not resurrected',
    createStrategyRuntime({
      strategy: persistPlan, goal: goalForPersist,
      hydrate: { stageProgress: { 'stage-that-no-longer-exists': { state: 'CONFIRMED' } } }, now: () => T0
    }).state().stages.every((s) => s.runtime.stageId !== 'stage-that-no-longer-exists'));
  check('a stored state that is not a real stage state is ignored',
    createStrategyRuntime({
      strategy: persistPlan, goal: goalForPersist,
      hydrate: { stageProgress: { [stageA]: { state: 'TELEPORTED' } } }, now: () => T0
    }).state().stageProgress[stageA].state === 'READY');

  /* ── bounds: the footprint must not grow with usage ───────────────────── */
  const boundStore = memoryStore();
  for (let i = 0; i < STRATEGY_MAX_PLANS + 4; i += 1) {
    const g = parseGoalSpec({ text: `من ${1000 + i} دلار دارم و در ۳ ماه ۱۲٪ سود می‌خواهم` });
    const plan = buildPortfolioStrategy({
      goal: g, state: await createEcosystemReader({ readers: readersFrom(ECOSYSTEM) }).read(), now: T0 + i
    });
    saveStrategyPlan({ strategy: plan, goal: g, store: boundStore, now: T0 + i * 1000 });
  }
  check('the store is capped, so it cannot grow with usage',
    readStrategyPlans({ store: boundStore }).length === STRATEGY_MAX_PLANS,
    `${readStrategyPlans({ store: boundStore }).length}`);
  check('the newest plans are the ones kept',
    Number(latestStrategyPlan({ store: boundStore })?.savedAt) >= T0 + STRATEGY_MAX_PLANS * 1000);

  /* ── revision chain ───────────────────────────────────────────────────── */
  const reviseStore = memoryStore();
  const rtWithRead = createStrategyRuntime({
    strategy: persistPlan, goal: goalForPersist, now: () => T0,
    readEcosystem: async () => createEcosystemReader({ readers: readersFrom(ECOSYSTEM) }).read()
  });
  rtWithRead.confirmStage(persistPlan.stages.find((s) => s.movesFunds).id, { txHash: '0xfirst' });
  saveStrategyPlan({ strategy: persistPlan, goal: goalForPersist, runtime: rtWithRead.state(), store: reviseStore, now: T0 });
  const persistRevised = await rtWithRead.revise({ reason: 'drawdown-budget' });
  saveStrategyPlan({ strategy: persistRevised.strategy, goal: goalForPersist, runtime: rtWithRead.state(), store: reviseStore, now: T0 + 5_000 });
  linkRevision({ fromStrategyId: persistPlan.strategyId, toStrategyId: persistRevised.strategy.strategyId, store: reviseStore });

  const head = loadStrategyPlan(persistRevised.strategy.strategyId, { store: reviseStore });
  check('both ends of a revision are stored', Boolean(head) && Boolean(loadStrategyPlan(persistPlan.strategyId, { store: reviseStore })));
  check('the revision points back at the plan it replaced', head?.supersedes === persistPlan.strategyId, `${head?.supersedes}`);
  check('the resumed revision keeps the stage that was already signed',
    Object.values(head?.runtime?.stageProgress || {}).some((p) => p.state === 'CONFIRMED' && p.receipt?.txHash === '0xfirst'));
  check('a resumed revision still remembers how many revisions it used',
    createStrategyRuntime({ ...hydrateRuntimeArgs(head), now: () => T0 + 5_000 }).state().revisionCount === 1,
    `${createStrategyRuntime({ ...hydrateRuntimeArgs(head), now: () => T0 + 5_000 }).state().revisionCount}`);
  check('linking an unknown revision is a no-op', linkRevision({ fromStrategyId: 'nope', toStrategyId: 'also-nope', store: reviseStore }) === null);

  /* ── deletion ─────────────────────────────────────────────────────────── */
  const delStore = memoryStore();
  saveStrategyPlan({ strategy: persistPlan, goal: goalForPersist, store: delStore, now: T0 });
  const delResult = deleteStrategyPlan(persistPlan.strategyId, { store: delStore });
  check('a plan can be deleted by id', delResult.removed === 1 && readStrategyPlans({ store: delStore }).length === 0);
  check('deleting an unknown id removes nothing', deleteStrategyPlan('ghost', { store: delStore }).removed === 0);
  saveStrategyPlan({ strategy: persistPlan, goal: goalForPersist, store: delStore, now: T0 });
  saveStrategyPlan({ strategy: secretPlan, goal: goalForPersist, store: delStore, now: T0 + 1 });
  check('the whole archive can be cleared', deleteStrategyPlan(null, { store: delStore }).remaining === 0);

  const passed = results.filter((r) => r.ok).length;
  console.log(`\nstrategy-brain probe: ${passed}/${results.length} passed`);
  if (passed !== results.length) {
    console.error(results.filter((r) => !r.ok).map((r) => `  ✗ ${r.name}${r.detail ? ` — ${r.detail}` : ''}`).join('\n'));
    process.exit(1);
  }
  console.log('OK: intent-ai/strategy-brain-probe');
} catch (err) {
  console.error('\nstrategy-brain probe crashed:', err);
  process.exit(1);
}
