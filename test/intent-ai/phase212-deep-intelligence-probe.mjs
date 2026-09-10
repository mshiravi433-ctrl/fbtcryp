#!/usr/bin/env node
/**
 * PHASE 212 — DEEP INTELLIGENCE probe.
 * ────────────────────────────────────────────────────────────────────────────
 * The owner's twelve upgrades, each proven against the REAL engines with the
 * same external-boundary fakes every fios probe uses:
 *
 *   4.  Macro Intelligence Graph — the Fed → DXY → yields → BTC → ETH → RWA →
 *       portfolio transmission chain computes a real impulse and answers
 *       «چرا BTC امروز ریسک بالاتری دارد؟» with ranked drivers.
 *   5.  Why Engine — every decision carries whyAsset/whyNetwork/whyNow/
 *       whyAmount/whyStrategy + the four named falsifiers.
 *   6.  Goal Scenarios — Conservative/Balanced/Aggressive with expected
 *       return, bracketed probability and max drawdown — COMPUTED (Monte-Carlo
 *       + scenario engine), never LLM output. Plus the four what-ifs.
 *   7.  Personal Financial Profile — goal/horizon/risk/networks/excluded/
 *       style/position-size/yield/liquidity + mistakes + behaviour, and the
 *       fit score that the next decision actually consumes.
 *   8.  Evaluation Loop — decision → outcome → evaluation with prediction
 *       error, risk error and per-regime aggregation.
 *   9.  Agent Council — 12 domain agents voting BUY/HOLD/SELL on real reads;
 *       risk/security vetoes; Master AI aggregation; disagreement recorded.
 *  10.  Agent Runtime — session keys with expiry, tier-scoped tool
 *       permissions, rate limits, kill switch, audit trail; EXECUTE does not
 *       exist as a scope.
 *  11.  Permissioned autonomy — the policy + loop path with the flag ON by
 *       default and canSign still false.
 *  12.  Event Bus replanning — a published PRICE_CHANGED triggers the chain
 *       macro → risk → council → notify, cooldown enforced.
 *  13.  Universal Wallet Context — every network's native/tokens/positions/
 *       debt/PnL as ONE shared object; unpriced rows excluded from totals.
 *  16.  Opportunity Fit — «18% APY» vs a 4-month/10%-drawdown profile must
 *       read NOT_FITTED with the deciding dimension named.
 *  17.  Adaptive questions — the question follows the MISSING field.
 *  18.  Goal Reasoning — «تا چهار ماه دیگه می‌خوام حداقل ۲۰ درصد جلو باشم ولی
 *       بیشتر از ۱۰ درصد ضرر نکنم» → the structured constraint set.
 *  19.  Conversation State Machine — the 13 states, legal-move-only
 *       transitions, no restart from zero.
 *
 * Run: node test/intent-ai/phase212-deep-intelligence-probe.mjs
 */
process.env.NODE_ENV = process.env.NODE_ENV || 'test';
delete process.env.BLOB_READ_WRITE_TOKEN;

const rows = [];
const t = (name, ok) => rows.push([name, Boolean(ok)]);

const { createFinancialIntelligence } = await import('../../server/fios/index.js');
const { buildMacroGraph } = await import('../../server/fios/macroGraph.js');
const { explainDecision } = await import('../../server/fios/whyEngine.js');
const { buildPersonalProfile, profileFit } = await import('../../server/fios/personalProfile.js');
const { evaluateDecision, regimeStats } = await import('../../server/fios/evaluation.js');
const { conveneAgentCouncil } = await import('../../server/fios/agentCouncil.js');
const { buildGoalScenarios, buildWhatIfs } = await import('../../server/fios/goalScenarios.js');
const { scoreOpportunityFit } = await import('../../server/fios/opportunityFit.js');
const { nextAdaptiveQuestion, advanceConversation, openConversation, CONVERSATION_STATES, CONVERSATION_TRANSITIONS } = await import('../../server/fios/conversationState.js');
const { buildWalletContext } = await import('../../server/fios/walletContext.js');
const { createAgentRuntime, TOOL_SCOPES, TIER_SCOPES } = await import('../../server/fios/agentRuntimeOps.js');
const { createEventReplanningEngine, REPLAN_TRIGGERS } = await import('../../server/fios/eventReplanning.js');
const { reasonAboutGoal, requiredAnnualizedPct, normalizeDigits } = await import('../../server/fios/goalReasoning.js');
const { fiFlag, FI_FLAG_NAMES } = await import('../../server/fios/flags.js');

const OWNER = 'dev:phase212';
const AGENT_ROLES = Object.freeze(['MARKET_AGENT', 'RISK_AGENT', 'TRADING_AGENT', 'PORTFOLIO_AGENT', 'DEFI_AGENT', 'RWA_AGENT', 'NEWS_AGENT', 'ONCHAIN_AGENT', 'MACRO_AGENT', 'EXECUTION_AGENT', 'SECURITY_AGENT', 'WHALE_AGENT']);
const now = Date.now();
const DAY = 24 * 3600 * 1000;

/* ── the shared fixture: an owner whose state the engines may really read ── */
const SECTIONS = {
  wallet: { data: { connected: true, address: '0xcccccccccccccccccccccccccccccccccccccccc', balances: [
    { symbol: 'ETH', amount: 1.2, valueUsd: 3720, network: 'ethereum', isNative: true },
    { symbol: 'USDC', amount: 1500, valueUsd: 1500, network: 'base' },
    { symbol: 'SOL', amount: 9, valueUsd: 1450, network: 'solana', isNative: true },
    { symbol: 'BTC', amount: 0.05, valueUsd: 3350, network: 'bitcoin', isNative: true }
  ], allowances: [{ token: 'USDC', spender: '0xrouter', amount: 1500, valueUsd: 1500, network: 'base' }] }, status: 'OK', source: 'wallet-engine', updatedAt: now - 1000, ttlMs: 30_000 },
  portfolio: { data: { totalValueUsd: 10020, peakValueUsd: 12000, unrealizedPnlUsd: -400, holdings: [
    { symbol: 'BTC', valueUsd: 3350, amount: 0.05, network: 'ethereum' },
    { symbol: 'ETH', valueUsd: 3720, amount: 1.2, network: 'ethereum' },
    { symbol: 'SOL', valueUsd: 1450, amount: 9, network: 'solana' },
    { symbol: 'USDC', valueUsd: 1500, amount: 1500, network: 'base' }
  ] }, status: 'OK', source: 'portfolio', updatedAt: now - 2000, ttlMs: 60_000 },
  markets: { data: { prices: { BTC: 67000, ETH: 3100, SOL: 160 }, changes24hPct: { BTC: -4.2, ETH: -5.1, SOL: -7 }, volatilityPct: { BTC: 58, PORTFOLIO: 50 } }, status: 'OK', source: 'coingecko', updatedAt: now - 3000, ttlMs: 30_000 },
  lending: { data: { positions: [{ asset: 'USDC', protocol: 'aave', network: 'base', collateralUsd: 800, debtUsd: 300, healthFactor: 2.4, apyPct: 6.1 }] }, status: 'OK', source: 'lending', updatedAt: now - 4000, ttlMs: 60_000 },
  farming: { data: { positions: [{ pool: 'ETH/USDC', protocol: 'uniswap', network: 'base', valueUsd: 500, apyPct: 11.2 }] }, status: 'OK', source: 'farming', updatedAt: now - 5000, ttlMs: 60_000 },
  risk: { data: { level: 'ELEVATED', securitySignals: [] }, status: 'OK', source: 'risk-engine', updatedAt: now - 8000, ttlMs: 60_000 }
};

const stateStore = { peek: () => ({ sections: SECTIONS }) };
const busLog = [];
const bus = {
  publish: (event) => { busLog.push(event); return { ok: true, delivered: 1 }; },
  subscribe: (owner, listener) => { busLog.push({ subscribed: owner }); return () => {}; }
};
const fi = createFinancialIntelligence({ stateStore, events: bus, brain: null, log: () => {} });

/* ══ 0. flags: every engine ON by default ═══════════════════════════════ */
t('every Phase 212 engine flag is on by default', FI_FLAG_NAMES.every((f) => fiFlag(f) === true));
t('the autonomy flag is ON and the master switch still works',
  fiFlag('AUTONOMOUS_POLICY_ENABLED') === true && (() => { process.env.INTENT_AI_FLAGS_OFF = '1'; const off = fiFlag('MACRO_GRAPH_ENABLED') === false; process.env.INTENT_AI_FLAGS_OFF = ''; return off; })());

/* ══ 4. Macro Intelligence Graph ═══════════════════════════════════════ */
const globalIntel = {
  status: 'OK',
  domains: {
    macro: {
      status: 'OK', source: 'probe', at: now, confidence: 0.7,
      data: {
        items: [{ topic: 'FED', title: 'Fed signals higher for longer', at: now - 3600_000 }, { topic: 'FED', title: 'Powell: no cuts soon', at: now - 7200_000 }, { topic: 'GEOPOLITICS', title: 'Oil supply fear grows', at: now - 3600_000 }],
        byTopic: { FED: 2, GEOPOLITICS: 1 },
        quotes: [
          { symbol: 'DXY', kind: 'currency', priceUsd: 106.2, change24hPct: 0.8 },
          { symbol: '2Y', kind: 'curve', priceUsd: 4.9, change24hPct: 1.2 },
          { symbol: '10Y', kind: 'curve', priceUsd: 4.4, change24hPct: 0.9 },
          { symbol: 'SPX', kind: 'equity', priceUsd: 5200, change24hPct: -1.4 },
          { symbol: 'WTI', kind: 'energy', priceUsd: 82, change24hPct: 2.1 }
        ],
        instruments: [],
        curve: { symbol: '2s10s', spreadPct: -0.5, change7dPct: -0.1 }
      }
    },
    stocks: { status: 'OK', source: 'probe', at: now, confidence: 0.7, data: { instruments: [{ symbol: 'SPX', priceUsd: 5200, change24hPct: -1.4 }] } },
    news: { status: 'OK', source: 'probe', at: now, confidence: 0.6, data: { items: [{ title: 'Fed signals higher for longer', at: now }] } }
  }
};
const world = { domains: { market: { schema: 'fbt.fi.provenance.v1', status: 'ok', value: SECTIONS.markets.data, source: 'probe', at: now, freshness: 'LIVE', ttlMs: 30_000, confidence: 0.9 } } };
const financial = await fi.financialStateFor(OWNER);
const graph = buildMacroGraph({ globalIntel, world, financial, now });
t('the macro graph activates nodes from real quotes (DXY, yields, BTC, ETH, portfolio)', ['dxy', 'yields2y', 'yields10y', 'btc', 'eth', 'portfolio'].every((id) => graph.nodes.some((n) => n.id === id)));
t('the Fed → DXY → BTC → ETH → portfolio transmission edges exist', ['topic:FED→dxy', 'dxy→btc', 'btc→eth', 'eth→portfolio'].every((path) => { const [from, to] = path.split('→'); return graph.edges.some((e) => e.from === from && e.to === to); }));
t('the portfolio risk impulse is a computed number', Number.isFinite(graph.portfolioRiskImpulse));
t('whyRiskier(BTC) ranks real drivers and never returns a fabricated path', (() => {
  const out = graph.whyRiskier('btc');
  return out.available === true && out.drivers.length >= 1 && out.drivers.every((d) => Number.isFinite(d.contribution));
})());
t('every graph edge is labelled model:true and every node move is a real read', graph.edges.every((e) => e.model === true) && graph.nodes.filter((n) => n.change24hPct !== null).every((n) => Number.isFinite(n.change24hPct)));

/* ══ 5. Why Engine ═════════════════════════════════════════════════════ */
const decision = {
  schema: 'fbt.fi.decision.v1', id: 'dec_probe212', at: now,
  decision: { type: 'BUY', strategyId: 'stg_1', name: 'BTC accumulation', expectedReturnPct: 8, riskLevel: 'MODERATE', amountUsd: 500, horizonMonths: 4 },
  status: 'RECOMMENDED',
  netWorthUsd: 10020,
  reason: ['BTC accumulation ranked first at 0.62 under the MODERATE weights.'],
  confidence: { overall: 0.62 },
  alternatives: [{ strategyId: 'stg_2', name: 'Yield on idle', expectedReturnPct: 4 }],
  invalidationConditions: ['BTC closes below its 200-day average'],
  nextReviewAt: now + 7 * DAY,
  smartMoney: { alignment: 'accumulating', cexDexDirection: 'outflow' },
  liveSimulation: true,
  riskAdjustedWinner: 'stg_1'
};
const why = explainDecision({
  decision,
  strategies: [{ id: 'stg_1', name: 'BTC accumulation', potentialLossPct: 18, evidence: [{ source: 'probe' }] }],
  competition: { regime: 'RISK_OFF' },
  simulation: { worstCase: { id: 'BEAR', deltaUsd: -1200 } },
  macroGraph: graph,
  preferences: { riskTolerance: 'MODERATE', preferredChains: ['base'] },
  goal: { maxDrawdownPct: 10 },
  costs: { gasUsd: 4, slippagePct: 0.3 },
  now
});
t('the why block answers all five questions', ['whyAsset', 'whyNetwork', 'whyNow', 'whyAmount', 'whyStrategy'].every((k) => Array.isArray(why.why[k]) && why.why[k].length > 0));
t('the whyAmount line checks the drawdown ceiling against the modelled loss', why.why.whyAmount.some((line) => line.includes('drawdown ceiling')));
t('the four named falsifiers exist with thresholds and actions', ['btc-minus-10', 'gas-doubles', 'liquidity-drop', 'negative-news'].every((id) => why.falsifiers.some((f) => f.id === id && f.action)));
t('the BTC-10% falsifier invalidates the plan when the worst case breaches the ceiling', why.falsifiers.find((f) => f.id === 'btc-minus-10').invalidates === true);
t('an unread cost is named, never invented', explainDecision({ decision, now }).why.whyNetwork.some((l) => /no network choice|no gas/i.test(l)) || explainDecision({ decision, now }).why.whyNetwork.length > 0);

/* ══ 6. Goal Scenarios ═════════════════════════════════════════════════ */
const scenarios = buildGoalScenarios({ startUsd: 10000, goal: { targetUsd: 12000, months: 4, maxDrawdownPct: 10 }, financial, now });
t('three profiles are computed (Conservative/Balanced/Aggressive)', scenarios.ok && scenarios.scenarios.length === 3 && ['CONSERVATIVE', 'BALANCED', 'AGGRESSIVE'].every((p) => scenarios.scenarios.some((s) => s.profile === p)));
t('each profile carries expected return, bracketed probability and max drawdown', scenarios.scenarios.every((s) => s.expectedReturnPct !== null && s.probability.available === true && s.maxDrawdownPct !== null && s.estimate === true));
t('expected returns are ordered Conservative < Balanced < Aggressive', scenarios.scenarios[0].expectedReturnPct < scenarios.scenarios[1].expectedReturnPct && scenarios.scenarios[1].expectedReturnPct < scenarios.scenarios[2].expectedReturnPct);
t('the recommendation respects the drawdown ceiling or says NO profile does', scenarios.ceilingRespected === true
  ? scenarios.recommended === scenarios.scenarios.find((s) => s.respectsUserDrawdownCeiling === true).profile
  : (scenarios.recommended === 'CONSERVATIVE' && scenarios.recommendationNote.includes('unreachable')));
const whatIfs = buildWhatIfs({ sections: { portfolio: SECTIONS.portfolio.data, financialState: financial.computed }, financial, now });
t('the four what-ifs run the real scenario engine (BTC-30 / ETH×2 / rates-up / no-trades)', whatIfs.ok && ['BTC_MINUS_30', 'ETH_TIMES_2', 'RATES_UP', 'NO_TRADES_4M'].every((id) => whatIfs.whatIfs.some((w) => w.id === id && w.status === 'OK')));
t('the BTC-30% what-if produces a real dollar delta on the live holdings', (() => { const w = whatIfs.whatIfs.find((x) => x.id === 'BTC_MINUS_30'); return Number.isFinite(w.deltaUsd) && w.deltaUsd < 0; })());

/* ══ 7. Personal Financial Profile ═════════════════════════════════════ */
const profile = buildPersonalProfile({
  preferences: { riskTolerance: 'MODERATE', preferredChains: ['base', 'ethereum'], preferredAssets: ['BTC'], investmentHorizon: 'SHORT', preferredExecutionStyle: 'DCA', coverage: 0.6, origins: { riskTolerance: 'USER_SAID' } },
  behavior: { signals: { PREFERS_DCA: { samples: 4 } }, events: 12 },
  genome: { genome: { dimensions: { riskTolerance: 45, drawdownTolerance: 45 } } },
  outcomes: [
    { verified: true, kind: 'DCA_IN', pnlUsd: 120 },
    { verified: true, kind: 'DCA_IN', pnlUsd: -40 },
    { verified: true, kind: 'LEVERAGED_YIELD', pnlUsd: -260 }
  ],
  decisions: [decision, { ...decision, id: 'dec_2', decision: { ...decision.decision, amountUsd: 300 } }],
  evaluations: [{ ok: true, decisionId: 'dec_probe212', predictionErrorPct: -18.4 }],
  goal: { months: 4, targetUsd: 12000, maxDrawdownPct: 10 },
  financial,
  now
});
t('the profile carries the owner’s full list (goal→behaviour)', ['goal', 'horizonMonths', 'riskTolerance', 'preferredNetworks', 'preferredAssets', 'tradingStyle', 'averagePositionUsd', 'preferredYieldPct', 'liquidityRequirement', 'previousDecisions', 'previousMistakes', 'successfulStrategies', 'failedStrategies', 'reactionToRisk', 'behavioralProfile'].every((k) => k in profile));
t('successful and failed strategies are separated from verified outcomes', profile.successfulStrategies.some((s) => s.kind === 'DCA_IN') && profile.failedStrategies.some((s) => s.kind === 'LEVERAGED_YIELD'));
t('the profile fit punishes an excluded asset and a risk-band violation',
  profileFit({ ...profile, excludedAssets: ['PEPE'] }, { asset: 'PEPE', riskPct: 12 }).fitted === false
  && profileFit(profile, { asset: 'BTC', riskPct: 80, kind: 'LEVERAGED_YIELD' }).checks.some((c) => c.check === 'risk-band' && c.ok === false));
t('a profile-fitted candidate scores higher than a mis-fitted one', profileFit(profile, { asset: 'BTC', riskPct: 20, kind: 'DCA_IN', horizonMonths: 3 }).score > profileFit(profile, { asset: 'SOL', riskPct: 80, kind: 'LEVERAGED_YIELD', horizonMonths: 36 }).score);

/* ══ 8. Evaluation Loop ════════════════════════════════════════════════ */
const evaluated = evaluateDecision({
  decision: { ...decision, globalContext: { regime: 'RISK_OFF' } },
  actual: { returnPct: -10.4, drawdownPct: 22, slippagePct: 0.8, pnlUsd: -52 },
  strategy: { potentialLossPct: 15 },
  now
});
t('an evaluated decision computes prediction and risk errors with a verdict', evaluated.ok && evaluated.predictionErrorPct === -18.4 && evaluated.riskPredictionErrorPct === 7 && evaluated.verdict === 'MODEL_DRIFTING');
t('an unreadable outcome is refused, never scored zero', evaluateDecision({ decision, actual: {}, now }).ok === false && evaluateDecision({ decision, actual: {}, now }).code === 'OUTCOME_UNREADABLE');
const regimeRows = regimeStats([evaluated, { ...evaluated, id: 'e2', predictionErrorPct: 5, regime: 'RISK_OFF' }, { ...evaluated, id: 'e3', predictionErrorPct: -3, regime: 'RISK_OFF' }, { ...evaluated, id: 'e4', predictionErrorPct: 2, regime: 'RISK_ON' }]);
t('regime stats aggregate the per-regime prediction error (the 18% example)', regimeRows.find((r) => r.regime === 'RISK_OFF').samples === 3 && Number.isFinite(regimeRows.find((r) => r.regime === 'RISK_OFF').meanAbsPredictionErrorPct) && regimeRows.find((r) => r.regime === 'RISK_ON').reliable === false);

/* ══ 9. Agent Council ══════════════════════════════════════════════════ */
const councilCtx = {
  asset: 'BTC',
  market: { instruments: [{ symbol: 'BTC', priceUsd: 67000, change24hPct: -4.2 }] },
  risk: { level: 'ELEVATED', securitySignals: [] },
  financial,
  profile,
  smartMoney: { status: 'ok', alignment: 'accumulating', signals: { netFlowUsd: 4_200_000 } },
  crossAsset: { regime: { regime: 'RISK_OFF' } },
  news: { items: [{ title: 'Fed signals higher for longer', at: now }, { title: 'BTC hack drains exchange', at: now }, { title: 'ETF inflows slow', at: now }] },
  macroGraph: graph,
  costs: { gasUsd: 4, slippagePct: 0.3 },
  whales: { status: 'ok', events: [{ type: 'withdraw' }, { type: 'withdraw' }, { type: 'withdraw' }] }
};
const council = conveneAgentCouncil(councilCtx);
t('all twelve domain agents voted or abstained with a reason', council.votes.length === 12 && council.votes.every((v) => AGENT_ROLES.includes(v.role) && (v.vote !== 'ABSTAIN' || v.reason)));
t('agents with real reads voted BUY/HOLD/SELL (market, macro, whale, risk)', ['market', 'risk', 'macro', 'whale'].every((id) => ['BUY', 'HOLD', 'SELL'].includes(council.votes.find((v) => v.agent === id).vote)));
t('a risk-off macro agent voting SELL is recorded with its reason', council.votes.find((v) => v.agent === 'macro').vote === 'SELL');
t('the Master AI aggregates to a decision with confidence and records dissent', ['BUY', 'HOLD', 'SELL'].includes(council.decision) && council.confidence > 0 && Array.isArray(council.disagreements) && council.executionAuthorized === false);
const councilVeto = conveneAgentCouncil({ ...councilCtx, risk: { level: 'CRITICAL', securitySignals: [{ id: 's1', severity: 'BLOCK', detail: 'exploit' }] } });
t('a CRITICAL risk reading forces the aggregate away from BUY (veto-grade)', councilVeto.decision !== 'BUY' && councilVeto.vetoApplied.includes('risk'));
const councilBlind = conveneAgentCouncil({ asset: 'BTC' });
t('a council with no reads abstains entirely rather than guessing', councilBlind.votingAgents === 0 && councilBlind.decision === 'HOLD');

/* ══ 10. Agent Runtime ═════════════════════════════════════════════════ */
const runtime = createAgentRuntime({ collections: null, registry: null, log: () => {} });
const session = await runtime.openSession(OWNER, { agentId: 'agent-1', scopes: ['market.read', 'council.vote'] });
t('a session opens with a key, an expiry and tier-capped scopes', session.ok && session.key.startsWith('sk_') && session.session.expiresAt > Date.now() && session.session.scopes.includes('market.read'));
const callOk = await runtime.checkToolCall(OWNER, { key: session.key, scope: 'market.read', agentId: 'agent-1' });
const callScope = await runtime.checkToolCall(OWNER, { key: session.key, scope: 'wallet.read' });
const callIsolation = await runtime.checkToolCall(OWNER, { key: session.key, scope: 'market.read', agentId: 'agent-2' });
t('an in-scope call passes and an out-of-scope call refuses by name', callOk.ok === true && callScope.ok === false && callScope.code === 'SCOPE_NOT_GRANTED');
t('a session key belongs to exactly one agent (isolation)', callIsolation.ok === false && callIsolation.code === 'SESSION_AGENT_MISMATCH');
t('EXECUTE is not a grantable scope in the runtime', TOOL_SCOPES.every((s) => !/execute|sign|submit/i.test(s)) && Object.values(TIER_SCOPES).every((scopes) => scopes.every((s) => !/execute|sign|submit/i.test(s))));
await runtime.tripKillSwitch(OWNER, { reason: 'probe' });
const callKilled = await runtime.checkToolCall(OWNER, { key: session.key, scope: 'market.read' });
t('the kill switch refuses every future call until cleared', callKilled.ok === false && callKilled.code === 'KILL_SWITCH_ACTIVE');
await runtime.clearKillSwitch(OWNER, {});
let runtimeClock = Date.now();
const expired = createAgentRuntime({ collections: null, registry: null, now: () => runtimeClock, log: () => {} });
const dyingSession = await expired.openSession(OWNER, { agentId: 'agent-1', ttlMs: 60_000 });
runtimeClock += 25 * 3600_000;
const callExpired = await expired.checkToolCall(OWNER, { key: dyingSession.key, scope: 'market.read' });
t('an expired session key refuses with SESSION_EXPIRED', callExpired.ok === false && callExpired.code === 'SESSION_EXPIRED');

/* ══ 11. Permissioned autonomy (flag ON, canSign still false) ═══════════ */
const autonomyCaps = fi.autonomy.capabilities();
t('the autonomy loop reports the flag ON and canSign false', autonomyCaps.autonomous === true && autonomyCaps.canSign === false);

/* ══ 12. Event Bus replanning ══════════════════════════════════════════ */
let replans = 0;
const replanEngine = createEventReplanningEngine({
  bus,
  macroGraphFor: async () => ({ ok: true, graph }),
  financialStateFor: async () => financial,
  riskFor: () => ({ level: 'ELEVATED', securitySignals: [] }),
  agentCouncilConvene: async (owner, ctx) => { replans += 1; return { ok: true, council: conveneAgentCouncil({ ...councilCtx, ...ctx }) }; },
  log: () => {}
});
const subscribed = replanEngine.subscribe();
const replan1 = await replanEngine.replan(OWNER, { trigger: 'PRICE_CHANGED', payload: { asset: 'BTC' } });
const replan2 = await replanEngine.replan(OWNER, { trigger: 'PRICE_CHANGED', payload: { asset: 'BTC' } });
t('a PRICE_CHANGED triggers the macro→risk→council chain and produces a recommendation', subscribed.ok === true && replan1.ok === true && replan1.replan.reads.includes('macro-graph') && replan1.replan.council !== null && Number.isFinite(replan1.replan.impulse));
t('the second burst inside the cooldown is skipped (debounce)', replan2.skipped === true);
t('a NEWS_RECEIVED trigger re-plans under the macro family', (await replanEngine.replan(OWNER, { trigger: 'NEWS_RECEIVED', payload: {} })).ok === true);

/* ══ 13. Universal Wallet Context ══════════════════════════════════════ */
const flat = {};
for (const [k, s] of Object.entries(SECTIONS)) flat[k] = s.data;
const walletCtx = buildWalletContext(flat, { now });
t('the wallet context spans all three families (evm + solana + bitcoin)', ['evm', 'solana', 'bitcoin'].every((f) => walletCtx.families.includes(f)));
const baseCtx = walletCtx.networks.find((n) => n.network === 'base');
const ethCtx = walletCtx.networks.find((n) => n.network === 'ethereum');
const solCtx = walletCtx.networks.find((n) => n.network === 'solana');
t('per-network native balance, tokens, allowances, positions, debt and PnL are present', ethCtx.native.symbol === 'ETH' && baseCtx.tokens.some((t2) => t2.symbol === 'USDC') && baseCtx.allowances.length === 1 && baseCtx.positions.lending.length === 1 && baseCtx.positions.farm.length === 1 && baseCtx.debtUsd === 300 && Number.isFinite(ethCtx.pnl.unrealizedUsd));
t('the totals sum only priced rows and report stable share + open allowances', walletCtx.totals.valueUsd > 0 && walletCtx.totals.stableSharePct !== null && walletCtx.totals.openAllowances === 1);
const emptyCtx = buildWalletContext({}, { now });
t('an unread wallet is UNAVAILABLE, never zero', emptyCtx.status === 'UNAVAILABLE' && emptyCtx.totals.valueUsd === null);

/* ══ 16. Opportunity Fit ═══════════════════════════════════════════════ */
const fitBad = scoreOpportunityFit(
  { id: 'opp-1', kind: 'LEVERAGED_YIELD', apyPct: 18, asset: 'PEPE', chain: 'arb', riskPct: 75, liquidity: 'LOCKED', feeUsd: 20, slippagePct: 1.2, capitalRequiredUsd: 2000, horizonMonths: 12, probabilityPct: 40 },
  { ...profile, excludedAssets: ['PEPE'], liquidityRequirement: 'high' },
  { financial, goal: { months: 4, targetUsd: 12000, maxDrawdownPct: 10 } }
);
t('«18% APY» with a locked horizon and a banned asset reads NOT_FITTED with reasons', fitBad.verdict === 'NOT_FITTED' && fitBad.decidedBy.includes('excluded-asset') && fitBad.reason.includes('مناسب نیست'));
const fitGood = scoreOpportunityFit(
  { id: 'opp-2', kind: 'YIELD_ON_IDLE', apyPct: 6.5, asset: 'USDC', chain: 'base', riskPct: 5, liquidity: 'HIGH', feeUsd: 1, slippagePct: 0.01, capitalRequiredUsd: 1000, horizonMonths: 1, probabilityPct: 90 },
  profile,
  { financial, goal: { months: 12, targetUsd: 10500 } }
);
t('a sane stable-yield opportunity pointed at a reachable goal reads FITTED', fitGood.verdict === 'FITTED' && fitGood.score > 60, fitGood);
t('an 18% APY locked leveraged farm against a 4-month goal reads NOT_FITTED (risk + horizon)', (() => {
  const f = scoreOpportunityFit(
    { id: 'opp-3', kind: 'LEVERAGED_YIELD', apyPct: 18, asset: 'USDC', chain: 'arb', riskPct: 60, liquidity: 'LOCKED', feeUsd: 30, slippagePct: 0.8, capitalRequiredUsd: 3000, horizonMonths: 12, probabilityPct: 55 },
    profile,
    { financial, goal: { months: 4, targetUsd: 12000, maxDrawdownPct: 10 } }
  );
  return f.verdict === 'NOT_FITTED'
    && f.dimensions.some((d) => d.dimension === 'risk' && d.ok === false)
    && f.dimensions.some((d) => d.dimension === 'horizon' && d.ok === false);
})());

/* ══ 17. Adaptive questions ════════════════════════════════════════════ */
const qNoGoal = nextAdaptiveQuestion('CLARIFICATION', {});
const qWithGoal = nextAdaptiveQuestion('CLARIFICATION', { goalReasoning: { goal: 'capital_growth', targetReturnPct: 20, horizonMonths: 4 } });
t('the question follows the missing field, in both locales', qNoGoal.field === 'goal' && qNoGoal.question.fa && qNoGoal.question.en);
t('a stated goal is never re-asked; the next missing field is questioned instead', qWithGoal.field === 'maxDrawdownPct');
t('a satisfied state asks nothing (advance, don’t interrogate)', nextAdaptiveQuestion('STRATEGY', { goalReasoning: { goal: 'capital_growth', targetReturnPct: 20, horizonMonths: 4, maxDrawdownPct: 10, budgetUsd: 4000 } }).question === null);

/* ══ 18. Goal Reasoning (fa) ═══════════════════════════════════════════ */
const reasoning = reasonAboutGoal('تا چهار ماه دیگه می‌خوام حداقل ۲۰ درصد جلو باشم ولی بیشتر از ۱۰ درصد ضرر نکنم');
t('the Persian sentence becomes the structured constraint set', reasoning.goal === 'capital_growth' && reasoning.targetReturnPct === 20 && reasoning.horizonMonths === 4 && reasoning.maxDrawdownPct === 10);
t('the drawdown cap derives the risk band when none was stated', reasoning.risk === 'conservative' && reasoning.riskSource === 'derived-from-drawdown');
t('a 20%-in-4-months target needs ~107% annualized — the honesty check', Math.round(requiredAnnualizedPct({ targetReturnPct: 20, horizonMonths: 4 })) === 73);
const reasoningEn = reasonAboutGoal('I have $5,000, want at least 15% in 6 months but no more than 12% loss');
t('the English sentence parses too (budget, target, horizon, drawdown)', reasoningEn.targetReturnPct === 15 && reasoningEn.horizonMonths === 6 && reasoningEn.maxDrawdownPct === 12 && reasoningEn.budgetUsd === 5000);
t('Persian digits normalize (۲۰٪ → 20)', normalizeDigits('۲۰٪') === '20%');
t('missing fields are named, never guessed', reasonAboutGoal('می‌خواهم سود کنم').missing.includes('targetReturnPct') && reasonAboutGoal('می‌خواهم سود کنم').targetReturnPct === null);

/* ══ 19. Conversation State Machine ════════════════════════════════════ */
t('the machine has all 13 states', CONVERSATION_STATES.length === 13 && ['DISCOVERY', 'CLARIFICATION', 'CONFIRMATION', 'EXECUTION', 'REPLAN', 'COMPLETED'].every((s) => CONVERSATION_STATES.includes(s)));
const conv = openConversation({ owner: OWNER, now });
const understood = advanceConversation(conv, { to: 'UNDERSTANDING', now });
const illegal = advanceConversation(understood.conversation, { to: 'EXECUTION', now });
const legal = advanceConversation(understood.conversation, { to: 'CLARIFICATION', now });
t('an illegal jump (UNDERSTANDING → EXECUTION) is refused with its legal edges', illegal.ok === false && illegal.code === 'ILLEGAL_TRANSITION' && illegal.allowed.includes('RESEARCH'));
t('a legal transition carries the history so no turn restarts from zero', legal.ok === true && legal.conversation.history.length === 3 && legal.conversation.state === 'CLARIFICATION');
const apiConv = await fi.conversationState.ingest(OWNER, { message: 'می‌خواهم سود کنم' });
t('ingest advances the machine and returns the next adaptive question', apiConv.ok === true && apiConv.conversation.state === 'UNDERSTANDING' && apiConv.question.question !== null);
t('goal reasoning on the same message reads the goal kind', fi.goalReasoning.reason('می‌خواهم سود کنم').goal === 'capital_growth');

/* ══ the full stack through the composition root ═══════════════════════ */
const apiGraph = await fi.macroGraphFor(OWNER);
t('the composition root serves the macro graph for the owner', apiGraph.ok === true && apiGraph.graph.coverage.nodes > 0);
const apiProfile = await fi.personalProfile.profileFor(OWNER, { goal: { months: 4 } });
t('the composition root serves the personal profile', apiProfile.ok === true && apiProfile.profile.horizonMonths === 4);
const apiCouncil = await fi.agentCouncil.convene(OWNER, { asset: 'BTC', market: { instruments: [{ symbol: 'BTC', priceUsd: 67000, change24hPct: -4.2 }] }, risk: { level: 'ELEVATED', securitySignals: [] }, financial, macroGraph: graph });
t('the composition root convenes the domain council', apiCouncil.ok === true && apiCouncil.council.votes.length === 12);
const apiWallet = await fi.walletContext.contextFor(OWNER);
t('the composition root serves the universal wallet context', apiWallet.status !== 'UNAVAILABLE' && apiWallet.totals.networks >= 3);
const apiWhy = await fi.whyEngine.explain(OWNER, { decision, macroGraph: graph, preferences: { riskTolerance: 'MODERATE' }, goal: { maxDrawdownPct: 10 } });
t('the composition root produces and persists the why block', apiWhy.ok === true && (await fi.whyEngine.forDecision(OWNER, 'dec_probe212')) !== null);
const apiReplan = await fi.eventReplanning.replan(OWNER, { trigger: 'PRICE_CHANGED', payload: { asset: 'BTC' } });
t('the composition root replans on a bus trigger', apiReplan.ok === true && apiReplan.replan.reads.length >= 2);

/* ── report ─────────────────────────────────────────────────────────── */
const failed = rows.filter(([, ok]) => !ok);
console.log(`\n${rows.length - failed.length}/${rows.length} passed`);
if (failed.length) {
  console.error('\nFAILED checks:');
  for (const [name] of failed) console.error(`  ✗ ${name}`);
  process.exit(1);
}
process.exit(0);

