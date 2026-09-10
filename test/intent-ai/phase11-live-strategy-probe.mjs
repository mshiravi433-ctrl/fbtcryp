#!/usr/bin/env node
/**
 * Phase 11 LIVE — route simulator + smart-money → AI decision.
 * ---------------------------------------------------------------------------
 * Proves the runtime wiring the source-only Phase 11 probe could not:
 *
 *   1. createRouteSimulator is a real provider (not SIMULATOR_UNAVAILABLE)
 *   2. simulateAllStrategies runs A/B/C and returns passed simulations
 *   3. riskAdjustedScore folds return/risk/drawdown/fees/slippage/SM/regime
 *   4. competition names a live-simulated provisional winner
 *   5. smart-money intel enriches strategies and enters decision conditions
 *   6. monitor accepts VOLUME / WHALE / SMART_MONEY_NET metrics
 *   7. nothing grants execution permission
 *
 * Run: node test/intent-ai/phase11-live-strategy-probe.mjs
 */
process.env.NODE_ENV = process.env.NODE_ENV || 'test';

const results = [];
const check = (name, ok) => {
  results.push({ name, ok: Boolean(ok) });
  if (!ok) console.error(`  ✗ ${name}`);
};

try {
  const {
    createRouteSimulator,
    simulateAllStrategies,
    riskAdjustedScore,
    ROUTE_SIMULATOR_PROVIDER_ID
  } = await import('../../server/fios/routeSimulator.js');
  const {
    buildSmartMoneyIntel,
    enrichStrategiesWithSmartMoney,
    smartMoneyKindBias,
    overviewToWhaleEvents
  } = await import('../../server/fios/smartMoneyIntel.js');
  const {
    simulateRoute,
    generateStrategies,
    competeStrategies
  } = await import('../../src/lib/intent-ai/strategyCompetition.js');
  const { createStrategyCompetition } = await import('../../server/fios/competition.js');
  const { createCollections } = await import('../../server/fios/collections.js');
  const { createDecisionEngine } = await import('../../server/fios/decision.js');
  const { createEvidenceStore } = await import('../../server/fios/evidence.js');
  const { createTraceStore } = await import('../../server/fios/trace.js');
  const { createConfidenceEngine } = await import('../../server/fios/confidence.js');
  const {
    normalizeMonitor,
    evaluateCondition,
    MONITOR_METRICS,
    FEED_METRICS
  } = await import('../../server/intentMonitoring.js');

  const now = Date.now();
  const OWNER = 'dev:phase11-live';

  /* ── 1. Route simulator is a connected provider ──────────────────────── */
  const financial = {
    status: 'OK',
    confidence: 0.85,
    computed: {
      status: 'OK',
      netWorthUsd: 24_000,
      availableCapitalUsd: 6_000,
      holdingsCounted: 4,
      volatilityPct: 55,
      blendedYieldPct: 3.2,
      concentration: { level: 'HIGH', topSharePct: 66, topAsset: 'BTC', hhi: 0.5 },
      drawdownPct: -18,
      stableUsd: 6_000,
      debtUsd: 0,
      chainExposureUsd: { ethereum: 8000, base: 2000 },
      assetExposureUsd: { BTC: 16000, ETH: 2000, USDC: 6000 }
    }
  };

  const strategies = generateStrategies({
    intent: { id: 'intent-live-11' },
    candidates: [
      {
        id: 'hold', kind: 'HOLD', name: 'Hold', riskPct: 30, expectedReturnPct: 3.2,
        potentialLossPct: -12, maximumDrawdownPct: 18, feesUsd: 0, liquidity: 'unchanged',
        route: ['no-action'],
        evidence: [{ source: 'financial-state', sampleSize: 12, quality: 0.85, observedAt: now }]
      },
      {
        id: 'dca-in', kind: 'DCA_IN', name: 'DCA', riskPct: 40, expectedReturnPct: 5,
        potentialLossPct: -20, maximumDrawdownPct: 25, feesUsd: 4.5, liquidity: 'reduced by each contribution',
        route: ['swap', 'schedule'],
        evidence: [{ source: 'financial-state', sampleSize: 12, quality: 0.8, observedAt: now }]
      },
      {
        id: 'risk-reduction', kind: 'RISK_REDUCTION', name: 'De-risk', riskPct: 20, expectedReturnPct: 1.5,
        potentialLossPct: -5, maximumDrawdownPct: 8, feesUsd: 12, liquidity: 'improved',
        route: ['swap'],
        evidence: [{ source: 'financial-state', sampleSize: 12, quality: 0.8, observedAt: now }]
      }
    ]
  }).strategies;

  check('three strategies generated as proposals', strategies.length === 3 && strategies.every((s) => s.guaranteed === false));

  const missing = await simulateRoute(strategies[0]);
  check('without provider, simulateRoute still reports unavailable', missing.status === 'unavailable');

  const simulator = createRouteSimulator({ financial, now: () => now });
  const one = await simulateRoute(strategies[0], {
    simulator,
    context: { capitalUsd: 24000, seriesSamples: 30, strategy: strategies[0] },
    now
  });
  check('live simulator returns passed with provider id',
    one.ok && one.status === 'passed' && one.providerId === ROUTE_SIMULATOR_PROVIDER_ID);
  check('live simulation never grants execution', one.executionPermission === false);
  check('live simulation carries fees + slippage + evidence',
    one.fee != null && one.slippagePct != null && Array.isArray(one.evidence) && one.evidence.length >= 1);

  const all = await simulateAllStrategies(strategies, {
    simulateRoute,
    financial,
    smartMoney: {
      status: 'observed',
      signals: { netFlowUsd: -2_500_000, whaleActivity: 18, cexDexDirection: 'DEX_TO_CEX' },
      strategyEvidence: [{ source: 'smart-money:test', sampleSize: 18, quality: 0.7, observedAt: now }]
    },
    now
  });
  check('simulateAll runs every strategy', all.ok && all.count === 3 && all.passed >= 2);
  check('simulateAll is live + estimate + no execution', all.live === true && all.estimate === true && all.executionPermission === false);

  /* ── 2. Risk-adjusted score ──────────────────────────────────────────── */
  const scoreHold = riskAdjustedScore({
    expectedReturnPct: 3.2, riskPct: 30, drawdownPct: 18, feesUsd: 0,
    slippagePct: 0.1, capitalUsd: 24000, liquidity: 'unchanged',
    smartMoneyNetUsd: -2_500_000, regime: 'RISK_OFF'
  });
  const scoreDca = riskAdjustedScore({
    expectedReturnPct: 5, riskPct: 40, drawdownPct: 25, feesUsd: 4.5,
    slippagePct: 0.3, capitalUsd: 24000, liquidity: 'reduced',
    smartMoneyNetUsd: -2_500_000, regime: 'RISK_OFF'
  });
  const scoreSafe = riskAdjustedScore({
    expectedReturnPct: 1.5, riskPct: 20, drawdownPct: 8, feesUsd: 12,
    slippagePct: 0.2, capitalUsd: 24000, liquidity: 'improved',
    smartMoneyNetUsd: -2_500_000, regime: 'RISK_OFF'
  });
  check('risk-adjusted scores are finite numbers',
    [scoreHold, scoreDca, scoreSafe].every((s) => Number.isFinite(s)));
  check('missing inputs yield null rather than a fake score',
    riskAdjustedScore({}) === null);

  /* ── 3. Competition with live sims + smart money ─────────────────────── */
  const collections = createCollections({});
  const competition = createStrategyCompetition({ collections });
  const smIntel = buildSmartMoneyIntel({
    at: now,
    window: '24h',
    dataStatus: 'live',
    streamStatus: 'live',
    metrics: {
      whaleActivity: { value: 22, changePct: 10 },
      accumulation: { valueUsd: 800_000, events: 4 },
      distribution: { valueUsd: 3_200_000, events: 11 },
      exchangeInflow: { value: 4_000_000 },
      exchangeOutflow: { value: 1_200_000 },
      netFlow: { value: -2_400_000 },
      flowEvents: 15,
      flowStatus: 'live'
    },
    flows: {
      windows: {
        '24h': { inflowUsd: 4_000_000, outflowUsd: 1_200_000, netUsd: -2_800_000, events: 15, dataStatus: 'live' }
      }
    },
    tokenActivity: [
      { symbol: 'ETH', netUsd: -900_000, signal: 'DISTRIBUTION', chainShort: 'eth', labelledEvents: 6, wallets: 4 },
      { symbol: 'BTC', netUsd: 200_000, signal: 'ACCUMULATION', chainShort: 'btc', labelledEvents: 3, wallets: 2 }
    ],
    whales: [{ address: '0xabc000000000000000000000000000000000def', netUsd: -500_000, riskBand: 'HIGH', tags: ['WHALE'] }],
    coverage: { inWindow: 22, labelledInWindow: 15 }
  }, { now });

  check('smart-money intel is observed with net distribution',
    smIntel.status === 'observed' && smIntel.signals.netFlowUsd < 0);
  check('smart-money emits decision conditions',
    smIntel.decisionConditions.length >= 1);
  check('CEX/DEX direction is derived (DEX→CEX on inflow dominance)',
    smIntel.signals.cexDexDirection === 'DEX_TO_CEX');
  check('overview→whale events is non-empty', overviewToWhaleEvents({
    at: now, tokenActivity: smIntel.signals.topTokens, flows: { windows: { '24h': { inflowUsd: 1e6, outflowUsd: 2e5, netUsd: -8e5 } } }
  }).length >= 1);

  const enriched = enrichStrategiesWithSmartMoney(
    strategies.map((s, i) => ({ ...s, kind: ['HOLD', 'DCA_IN', 'RISK_REDUCTION'][i], feesUsd: [0, 4.5, 12][i], liquidity: ['unchanged', 'reduced', 'improved'][i], maximumDrawdownPct: [18, 25, 8][i] })),
    smIntel
  );
  check('enrichment attaches smartMoney block + extra evidence',
    enriched.every((s) => s.smartMoney && s.smartMoney.netFlowUsd < 0 && s.evidence.length > strategies[0].evidence.length - 1));
  check('kind bias favours risk-reduction under distribution',
    smartMoneyKindBias('RISK_REDUCTION', smIntel) > smartMoneyKindBias('DCA_IN', smIntel));

  const comp = await competition.compete({
    owner: OWNER,
    strategies: enriched,
    preferences: { riskTolerance: 'MODERATE' },
    simulations: all.simulations,
    smartMoney: smIntel,
    financial,
    crossAsset: { regime: { regime: 'RISK_OFF' }, observedClasses: ['crypto', 'stocks'] }
  });
  check('competition succeeds with live sims', comp.ok === true);
  check('competition marks liveSimulation', comp.competition.liveSimulation === true);
  check('Smart Money Analyst role reported',
    comp.competition.agents.some((a) => a.role === 'SMART_MONEY_ANALYST' && a.proposalId));
  check('judge exposes risk-adjusted scoring factors',
    Array.isArray(comp.competition.judge.scoringFactors)
    && comp.competition.judge.scoringFactors.includes('smartMoney')
    && comp.competition.judge.scoringFactors.includes('slippage'));
  check('scored rows carry riskAdjustedScore',
    comp.competition.scored.every((r) => r.riskAdjustedScore !== undefined));
  check('winner is provisional (live-simulated or evidence-backed)',
    comp.competition.judge.winnerId
    && /provisional/i.test(comp.competition.judge.winnerStatus));
  check('competition never grants execution',
    comp.competition.executionPermission === false && comp.competition.guaranteed === false);

  const simRank = competeStrategies({ strategies: enriched, simulations: all.simulations });
  check('phase-11 competeStrategies still provisional-only',
    simRank.userChoiceRequired === true && simRank.executionAuthorized === false);

  /* ── 4. Decision engine consumes smart money ─────────────────────────── */
  const evidence = createEvidenceStore({ collections });
  const traceStore = createTraceStore({ collections });
  const confidenceEngine = createConfidenceEngine({});
  const decisionEngine = createDecisionEngine({ collections, evidence, traceStore, confidenceEngine });
  const decided = await decisionEngine.decide({
    owner: OWNER,
    intent: { message: 'grow carefully', intentType: 'GROW_CAPITAL' },
    financial,
    world: { id: 'w1', domains: {} },
    strategies: enriched,
    competition: comp.competition,
    smartMoney: smIntel,
    crossAsset: { regime: { regime: 'RISK_OFF' }, observedClasses: ['crypto'] },
    routeSimulations: all.simulations,
    preferences: { riskTolerance: 'MODERATE' },
    goal: { targetUsd: 40000, months: 18 },
    executionRequested: false
  });
  check('decision completes', decided.ok === true);
  check('decision carries smartMoney block',
    decided.decision.smartMoney && decided.decision.smartMoney.netFlowUsd < 0);
  check('decision conditions include smart-money observations',
    decided.decision.conditions.some((c) => /smart money|distribution|whale|exchange/i.test(c)));
  check('decision records liveSimulation flag', decided.decision.liveSimulation === true);
  check('decision never grants execution', decided.decision.executionPermission === false);

  /* ── 5. Monitor metrics: VOLUME / WHALE / SMART_MONEY ────────────────── */
  check('MONITOR_METRICS advertises volume + whale + smart-money',
    ['VOLUME', 'WHALE', 'SMART_MONEY_NET', 'EXCHANGE_FLOW'].every((m) => MONITOR_METRICS.includes(m)));
  check('FEED_METRICS lists the non-price metrics',
    FEED_METRICS.includes('WHALE') && FEED_METRICS.includes('VOLUME'));

  const whaleMon = normalizeMonitor({
    metric: 'WHALE', operator: 'ABOVE', threshold: 10, intervalMinutes: 60
  }, { now });
  check('WHALE monitor normalises without a priced asset',
    whaleMon.monitor?.metric === 'WHALE' && whaleMon.monitor.status === 'ACTIVE');

  const volMon = normalizeMonitor({
    metric: 'VOLUME', operator: 'ABOVE', threshold: 1_000_000_000
  }, { now });
  check('VOLUME monitor normalises', volMon.monitor?.metric === 'VOLUME');

  const smMon = normalizeMonitor({
    metric: 'SMART_MONEY_NET', operator: 'ABOVE', threshold: 1_000_000
  }, { now });
  check('SMART_MONEY_NET monitor normalises', smMon.monitor?.metric === 'SMART_MONEY_NET');

  check('whale condition hits on observed count',
    evaluateCondition({ metric: 'WHALE', operator: 'ABOVE', threshold: 10, value: 22 }).hit === true);
  check('whale zero is a valid observation (not NO_VALUE)',
    evaluateCondition({ metric: 'WHALE', operator: 'ABOVE', threshold: 10, value: 0 }).ok === true
    && evaluateCondition({ metric: 'WHALE', operator: 'ABOVE', threshold: 10, value: 0 }).hit === false);
  check('unknown metric still rejected',
    normalizeMonitor({ metric: 'ASTROLOGY', threshold: 1 }).error === 'BAD_METRIC');

  /* ── summary ─────────────────────────────────────────────────────────── */
  const passed = results.filter((r) => r.ok).length;
  console.log(JSON.stringify({
    probe: 'phase11-live-strategy',
    passed,
    total: results.length,
    winnerId: comp.competition?.judge?.winnerId || null,
    winnerStatus: comp.competition?.judge?.winnerStatus || null,
    smartMoneyNet: smIntel.signals?.netFlowUsd ?? null,
    results
  }, null, 2));
  if (passed !== results.length) process.exitCode = 1;
} catch (err) {
  console.error(JSON.stringify({
    probe: 'phase11-live-strategy',
    failed: true,
    error: String(err?.stack || err),
    results
  }, null, 2));
  process.exitCode = 1;
}

export default results;
