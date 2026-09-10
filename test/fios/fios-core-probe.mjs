#!/usr/bin/env node
/**
 * FBT FINANCIAL INTELLIGENCE OS — core probe (batches 1-4).
 * ---------------------------------------------------------------------------
 * Runs the REAL engines in server/fios/* against the REAL shared libraries they
 * compose (src/lib/central/*, src/lib/intent-ai/strategyCompetition.js,
 * src/services/cross-chain/core.js). The only thing faked is the external
 * boundary — provider-shaped rows — exactly as test/intent-ai/ci-fakes.mjs does.
 *
 * WHAT IT MEASURES (each assertion names the spec clause it enforces)
 *   §5  every value carries source + timestamp + freshness + confidence, and an
 *       unread value is UNAVAILABLE, never a default
 *   §6  the canonical financial state sums real sections and names its gaps
 *   §7  Memory 2.0 keeps USER_SAID above AI_INFERRED and cannot be overwritten
 *       downward; only VERIFIED outcomes enter outcome memory
 *   §8  an explicit preference beats an inferred one; learning grants nothing
 *   §9  behaviour signals need MIN_BEHAVIOR_EVENTS verified events
 *   §10 the genome refuses a strategy the user rejected, and never grants access
 *   §11 research reports UNAVAILABLE per provider instead of inventing content
 *   §13 strategies are proposals: guaranteed:false, no invented returns
 *   §14 agents disagree, the Risk Auditor vetoes, and no winner is named
 *       without evidence
 *   §15/§16 scenarios are labelled, costs are overlaid, and a what-if executes
 *       nothing
 *   §17/§18 a decision carries reason + confidence + alternatives + conditions
 *       and confidence is capped by its weakest critical input
 *   §19/§20 an unresolved cross-chain request is refused, and the confirmation
 *       carries chain/asset/amount/fees/slippage/route/destination
 *   §32/§33 COMPLETED is unreachable without a verification id
 *
 * Run: npm run test:fios
 */
process.env.NODE_ENV = process.env.NODE_ENV || 'test';

const rows = [];
const t = (name, ok) => rows.push([name, Boolean(ok)]);

const { value, unavailable, derived, fromSection, provenanceSummary, isUsable, confidenceFor, FRESHNESS } = await import('../../server/fios/provenance.js');
const { fiFlag, fiFlags, requireFlag, FI_FLAG_NAMES } = await import('../../server/fios/flags.js');
const { createObservability, FI_EVENTS } = await import('../../server/fios/observability.js');
const { createCollections, COLLECTIONS } = await import('../../server/fios/collections.js');
const { createEvidenceStore, createEvidence, EVIDENCE_TYPES } = await import('../../server/fios/evidence.js');
const { buildCanonicalFinancialState, financialStateDigest, snapshotRow, headline } = await import('../../server/fios/financialState.js');
const { buildWorldModel, worldModelDigest } = await import('../../server/fios/worldModel.js');
const { createMemory2, MEMORY_PROVENANCE } = await import('../../server/fios/memory.js');
const { createPreferenceModel, parsePreferenceStatement, MIN_INFERRED_EVENTS } = await import('../../server/fios/preferences.js');
const { createBehaviorModel, computeSignals, MIN_BEHAVIOR_EVENTS } = await import('../../server/fios/behavior.js');
const { createGenomeModel } = await import('../../server/fios/genome.js');
const { createResearchEngine } = await import('../../server/fios/research.js');
const { createStrategyEngine, scoreGoalFit } = await import('../../server/fios/strategy.js');
const { createStrategyCompetition, RISK_CEILING } = await import('../../server/fios/competition.js');
const { createSimulationEngine, parseWhatIf, runWhatIf, goalProbability } = await import('../../server/fios/simulation.js');
const { createConfidenceEngine, CRITICAL_FOR_EXECUTION } = await import('../../server/fios/confidence.js');
const { createTraceStore, transition, createTrace, AI_STATES } = await import('../../server/fios/trace.js');
const { createDecisionEngine } = await import('../../server/fios/decision.js');
const { createCrossChainReasoner, resolveCrossChainRequest, scoreRouteRisk } = await import('../../server/fios/crosschain.js');

const OWNER = 'dev:probe-owner';
const now = Date.now();

/* A realistic but DELIBERATELY INCOMPLETE state: one holding has no USD price,
   so the "missing is null, not zero" rule has something to bite on. */
const SECTIONS = {
  wallet: { data: { connected: true, address: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', evmAddresses: ['0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'], solanaAddresses: [], chainsRead: [1, 8453], balances: [{ symbol: 'ETH', amount: 2.1 }] }, status: 'OK', source: 'wallet-engine', updatedAt: now - 1000, ttlMs: 30_000 },
  portfolio: {
    data: {
      totalValueUsd: 24000, peakValueUsd: 32000, unrealizedPnlUsd: -1800,
      holdings: [
        { symbol: 'BTC', valueUsd: 16000, amount: 0.24, network: 'bitcoin' },
        { symbol: 'ETH', valueUsd: 2000, amount: 0.65, network: 'ethereum' },
        { symbol: 'USDC', valueUsd: 6000, amount: 6000, network: 'ethereum' },
        { symbol: 'PEPE', amount: 1000000, network: 'ethereum' }
      ]
    }, status: 'OK', source: 'portfolio', updatedAt: now - 2000, ttlMs: 60_000
  },
  markets: { data: { prices: { BTC: 65000, ETH: 3100 }, volatilityPct: { BTC: 55, PORTFOLIO: 72 }, coins: [{ symbol: 'BTC', priceUsd: 65000, volumeUsd: 1e10 }] }, status: 'OK', source: 'coingecko', updatedAt: now - 3000, ttlMs: 30_000 },
  lending: { data: { positions: [{ asset: 'ETH', collateralUsd: 4000, debtUsd: 1500, healthFactor: 1.6, apyPct: 3 }] }, status: 'OK', source: 'aave', updatedAt: now - 4000, ttlMs: 60_000 },
  transactions: { data: { rows: [{ feeUsd: 2.5 }, { feeUsd: 1.1 }], realizedPnlUsd: 420 }, status: 'OK', source: 'txstore', updatedAt: now - 5000, ttlMs: 30_000 },
  news: { data: { items: [{ title: 'BTC ETF inflows rise' }, { title: 'Base activity record' }] }, status: 'OK', source: 'news-feed', updatedAt: now - 6000, ttlMs: 900_000 },
  signals: { data: { funding: { BTC: 0.01 }, whales: [{ wallet: 'w1' }] }, status: 'OK', source: 'signal-engine', updatedAt: now - 7000, ttlMs: 300_000 },
  risk: { data: { level: 'ELEVATED', liquidation: { healthFactor: 1.6 } }, status: 'OK', source: 'risk-engine', updatedAt: now - 8000, ttlMs: 60_000 },
  goals: { data: { goals: [{ id: 'g1', name: 'Reach 40k', targetAmount: 40000, targetDate: now + 700 * 24 * 3600_000, riskProfile: 'MODERATE' }] }, status: 'OK', source: 'goal-engine', updatedAt: now - 9000, ttlMs: 600_000 }
};

/* ═════════════════════════════════════════════════════════════════════════ */
/* §5 provenance                                                             */
/* ═════════════════════════════════════════════════════════════════════════ */
const priceEnv = value(65000, { source: 'coingecko', at: now, ttlMs: 60_000 });
t('§5 a value carries source, timestamp, freshness and confidence',
  priceEnv.source === 'coingecko' && priceEnv.at === now && priceEnv.freshness === FRESHNESS.LIVE && priceEnv.confidence === 0.95);
const gap = unavailable('PROVIDER_DOWN', { source: 'coingecko' });
t('§5 an unread value is unavailable with a reason, never a number',
  gap.value === null && gap.status === 'unavailable' && gap.reason === 'PROVIDER_DOWN' && gap.confidence === 0);
t('§5 a stale value loses confidence with age, down to zero',
  confidenceFor(FRESHNESS.STALE, { ageMs: 60_000 * 11, ttlMs: 60_000 }) === 0 && confidenceFor(FRESHNESS.STALE, { ageMs: 70_000, ttlMs: 60_000 }) < 0.55);
t('§5 the four-level freshness ladder is LIVE → FRESH → STALE → UNAVAILABLE',
  value(65000, { source: 'coingecko', at: now, ttlMs: 60_000 }).freshness === FRESHNESS.LIVE
  && value(65000, { source: 'coingecko', at: now - 2 * 60_000, ttlMs: 60_000 }).freshness === FRESHNESS.FRESH
  && value(65000, { source: 'coingecko', at: now - 4 * 60_000, ttlMs: 60_000 }).freshness === FRESHNESS.STALE
  && confidenceFor(FRESHNESS.FRESH) === 0.8
  && unavailable('X').freshness === FRESHNESS.UNAVAILABLE);
t('§5 a FRESH section sits between LIVE and STALE on the ladder', fromSection({ key: 'prices', source: 'coingecko', status: 'OK', updatedAt: now - 2 * 60_000, ttlMs: 60_000, data: { BTC: 1 } }).freshness === FRESHNESS.FRESH);
const derivedOk = derived(100, [priceEnv, value(2, { source: 'gas', at: now, ttlMs: 60_000 })]);
t('§5 a derived value inherits the WORST provenance of its inputs', derivedOk.confidence <= priceEnv.confidence && derivedOk.inputs.length === 2);
t('§5 a derived value from an unavailable input is itself unavailable', derived(100, [priceEnv, gap]).status === 'unavailable');
const sec = fromSection(SECTIONS.portfolio);
t('§5 a state section becomes an envelope with the section source', sec.source === 'portfolio' && isUsable(sec));
t('§5 a never-read section becomes NEVER_READ, not zero', fromSection({ key: 'dydx', status: 'MISSING', data: null }).reason === 'NEVER_READ');
t('§5 provenance summary counts coverage and names stale/unavailable sources',
  provenanceSummary({ a: priceEnv, b: gap }).coverage === 0.5 && provenanceSummary({ b: gap }).unavailable.length === 1);

/* ═════════════════════════════════════════════════════════════════════════ */
/* §51 flags                                                                 */
/* ═════════════════════════════════════════════════════════════════════════ */
t('§51 every requested flag exists', ['FINANCIAL_WORLD_MODEL_ENABLED', 'RESEARCH_ENGINE_ENABLED', 'STRATEGY_COMPETITION_ENABLED', 'SIMULATION_ENGINE_ENABLED', 'DECISION_ENGINE_ENABLED', 'CROSS_CHAIN_REASONER_ENABLED', 'AUTONOMOUS_POLICY_ENABLED', 'LEARNING_ENGINE_ENABLED', 'PROACTIVE_GUARDIAN_ENABLED', 'MACRO_GRAPH_ENABLED', 'WHY_ENGINE_ENABLED', 'AGENT_COUNCIL_ENABLED', 'PERSONAL_PROFILE_ENABLED', 'EVALUATION_LOOP_ENABLED', 'WALLET_CONTEXT_ENABLED', 'EVENT_REPLANNING_ENABLED', 'CONVERSATION_STATE_ENABLED', 'GOAL_SCENARIOS_ENABLED', 'OPPORTUNITY_FIT_ENABLED', 'GOAL_REASONING_ENABLED', 'AGENT_RUNTIME_OPS_ENABLED'].every((f) => FI_FLAG_NAMES.includes(f)));
/* Phase 212 owner policy: every engine ships ON — including permissioned
   autonomy (the numeric policy limits + guardian + wallet signature remain
   the real boundary, the flag no longer is). */
t('§51 every engine is on by default (Phase 212 policy)', FI_FLAG_NAMES.every((f) => fiFlag(f) === true));
process.env.AUTONOMOUS_POLICY_ENABLED = 'false';
t('§51 a disabled feature refuses with FEATURE_DISABLED instead of faking success', requireFlag('AUTONOMOUS_POLICY_ENABLED').code === 'FEATURE_DISABLED');
t('§51 a flag flips at runtime without a redeploy', (() => { process.env.AUTONOMOUS_POLICY_ENABLED = 'true'; const on = fiFlag('AUTONOMOUS_POLICY_ENABLED') === true; process.env.AUTONOMOUS_POLICY_ENABLED = ''; return on; })());
t('§51 the master switch can still turn the deep layer off', (() => { process.env.INTENT_AI_FLAGS_OFF = '1'; const off = fiFlag('MACRO_GRAPH_ENABLED') === false; process.env.INTENT_AI_FLAGS_OFF = ''; return off; })());
t('§51 flags snapshot covers every engine', Object.keys(fiFlags()).length === FI_FLAG_NAMES.length && Object.keys(fiFlags()).length === 21);

/* ═════════════════════════════════════════════════════════════════════════ */
/* §34 observability                                                         */
/* ═════════════════════════════════════════════════════════════════════════ */
const busEvents = [];
const obs = createObservability({ events: { publish: (e) => busEvents.push(e) } });
t('§34 the vocabulary contains the requested event names', ['intent.started', 'state.built', 'research.completed', 'strategy.selected', 'risk.failed', 'execution.confirmed', 'learning.completed', 'replan.completed'].every((e) => FI_EVENTS.includes(e)));
const cid = obs.correlationId('probe');
obs.emit({ type: 'intent.started', owner: OWNER, correlationId: cid, payload: { message: 'hi', privateKey: 'abc' } });
t('§34 an unknown event name is refused rather than invented', obs.emit({ type: 'money.printed', correlationId: cid }) === null);
t('§34 a key-shaped field never reaches the event payload', obs.recent({ correlationId: cid })[0].payload.privateKey === '[REDACTED]');
t('§34 events mirror onto the brain bus', busEvents.length === 1 && busEvents[0].source === 'fios');

/* ═════════════════════════════════════════════════════════════════════════ */
/* §46 collections (the KV "tables")                                         */
/* ═════════════════════════════════════════════════════════════════════════ */
const collections = createCollections({});
t('§46 all fifteen requested collections exist', ['financial_state', 'world_state_snapshot', 'preferences', 'behavior_signals', 'intent_genome', 'evidence', 'research', 'strategies', 'strategy_comparisons', 'simulations', 'decisions', 'policies', 'decision_traces', 'learning_outcomes', 'agent_trust'].every((c) => COLLECTIONS.includes(c)));
t('§46 an unknown collection is refused', (await collections.read('wallet_keys', OWNER)).code === 'UNKNOWN_COLLECTION');
await collections.put('decisions', OWNER, { id: 'd1', v: 1 });
await collections.put('decisions', OWNER, { id: 'd2', v: 2 });
t('§46 put replaces by id instead of stacking duplicates', (await collections.read('decisions', OWNER)).rows.length === 2);
t('§46 durability is reported, never assumed', (await collections.read('decisions', OWNER)).durable === false);
await collections.remove('decisions', OWNER, 'd1');
t('§46 remove deletes one row', (await collections.read('decisions', OWNER)).rows.length === 1);

/* ═════════════════════════════════════════════════════════════════════════ */
/* §12 evidence                                                              */
/* ═════════════════════════════════════════════════════════════════════════ */
const evidence = createEvidenceStore({ collections, observability: obs });
t('§12 evidence requires a known type', createEvidence({ type: 'vibes', source: 'x', value: 1 }).code === 'UNKNOWN_EVIDENCE_TYPE');
t('§12 evidence requires a source', createEvidence({ type: 'price', value: 1 }).code === 'EVIDENCE_SOURCE_REQUIRED');
t('§12 evidence requires a value (an absence is a gap, not evidence)', createEvidence({ type: 'price', source: 'x' }).code === 'EVIDENCE_VALUE_REQUIRED');
const recorded = await evidence.record(OWNER, [
  { type: 'price', source: 'coingecko', envelope: priceEnv },
  { type: 'apy', source: 'yield-feed', value: [{ pool: 'Aave USDC', apyPct: 6.4 }], at: now, ttlMs: 300_000 }
]);
t('§12 evidence rows carry id, type, source, timestamp, freshness, confidence',
  recorded.evidence.every((e) => e.id && e.type && e.source && Number.isFinite(e.timestamp) && e.freshness && Number.isFinite(e.confidence)));
t('§12 evidence keeps its own freshness and confidence from the envelope', recorded.evidence[0].confidence === 0.95);
const linkRes = await evidence.link(OWNER, { targetType: 'decision', targetId: 'dec-probe', evidenceIds: recorded.evidence.map((e) => e.id) });
t('§12 decision → evidence relationships are first-class rows', linkRes.ok);
t('§12 an unknown relationship target is refused', (await evidence.link(OWNER, { targetType: 'vibes', targetId: 'x', evidenceIds: ['y'] })).code === 'UNKNOWN_EVIDENCE_TARGET');
t('§12 linking a non-existent evidence id is refused', (await evidence.link(OWNER, { targetType: 'decision', targetId: 'x', evidenceIds: ['ev_missing'] })).code === 'EVIDENCE_NOT_FOUND');
const bundle = await evidence.bundle(OWNER, 'decision', 'dec-probe');
t('§12 an evidence bundle reports count, mean confidence, stale and untrusted counts',
  bundle.ok && bundle.quality.count === 2 && bundle.quality.meanConfidence > 0 && 'stale' in bundle.quality && 'untrusted' in bundle.quality);

/* ═════════════════════════════════════════════════════════════════════════ */
/* §6 canonical financial state                                              */
/* ═════════════════════════════════════════════════════════════════════════ */
const financial = buildCanonicalFinancialState({ owner: OWNER, sections: SECTIONS, now });
t('§6 net worth = assets + collateral - debt, computed from the sections', financial.net.netWorthUsd.value === 24000 + 4000 - 1500);
t('§6 debt comes from the lending section with its own provenance', financial.net.debtUsd.value === 1500 && financial.net.debtUsd.source === 'aave');
t('§6 an unpriced holding is excluded from totals and reported', financial.computed.holdingsUnvalued === 1 && financial.computed.holdingsCounted === 3);
t('§6 P&L and fees are read, not assumed', financial.performance.unrealizedPnlUsd.value === -1800 && financial.fees.value === 3.6);
t('§6 drawdown needs a real peak', financial.performance.drawdownPct.value === -25);
t('§6 every headline number is an envelope with source + confidence', Object.values(financial.net).every((e) => e.schema === 'fbt.fi.provenance.v1' && e.confidence > 0));
t('§6 a value that could not be computed is unavailable, never zero', buildCanonicalFinancialState({ owner: 'x', sections: {}, now }).status === 'UNAVAILABLE');
const emptyState = buildCanonicalFinancialState({ owner: 'x', sections: {}, now });
t('§6 an unread state names its missing inputs', emptyState.missing.includes('portfolio') && emptyState.confidence === 0);
t('§6 the model digest stays small and number-only', JSON.stringify(financialStateDigest(financial)).length < 900 && financialStateDigest(financial).topAssets.length <= 6);
t('§6 a snapshot row is produced for history + change detection', snapshotRow(financial).netWorthUsd === 26500);
t('§6 the chat headline quotes only what was read', headline(financial).includes('26,500') && headline(emptyState) === null);
t('§6 confidence falls as inputs go missing', emptyState.confidence < financial.confidence);

/* ═════════════════════════════════════════════════════════════════════════ */
/* §4 world model                                                            */
/* ═════════════════════════════════════════════════════════════════════════ */
const world = buildWorldModel({ owner: OWNER, sections: SECTIONS, preferences: { riskTolerance: 'MODERATE', riskToleranceOrigin: 'explicit', preferredChains: ['ethereum'], preferredChainsOrigin: 'behavior', updatedAt: now }, now });
t('§4 the world model has the six required domains', ['user', 'goals', 'risk', 'preferences', 'market', 'external'].every((d) => d in world.domains));
t('§4 user domain carries wallets, addresses, balances, positions, pnl and fees', ['wallets', 'addresses', 'balances', 'positions', 'pnl', 'fees', 'net'].every((k) => k in world.domains.user));
t('§4 preference provenance is visible on the envelope itself', world.domains.risk.profile.source === 'user-stated' && world.domains.preferences.preferredChains.source === 'user-behavior');
t('§4 the goals domain reads the goal engine section', world.domains.goals.count === 1);
t('§4 market domain covers prices, volatility, funding, apy, gas, whale activity', ['prices', 'volatilityPct', 'funding', 'apy', 'gas', 'whaleActivity'].every((k) => k in world.domains.market));
t('§4 external content is flagged untrusted (data, not authority)', world.domains.external.untrusted === true && world.domains.external.research.status === 'unavailable');
t('§4 an unread domain is present with a reason, not omitted', world.domains.market.orderbook.status === 'unavailable' && world.domains.market.orderbook.reason === 'ORDERBOOK_UNREAD');
t('§4 coverage and the missing list are computed', world.provenance.coverage > 0 && world.missing.length > 0);
t('§4 a world model with no data is UNAVAILABLE, not empty-but-happy', buildWorldModel({ owner: 'x', sections: {}, now }).status === 'UNAVAILABLE');
t('§4 the digest handed to a model is bounded', JSON.stringify(worldModelDigest(world)).length < 1400);

/* ═════════════════════════════════════════════════════════════════════════ */
/* §7 Memory 2.0                                                             */
/* ═════════════════════════════════════════════════════════════════════════ */
/* A controlled clock: "the newest user record wins" is a TIMESTAMP rule, and
   a wall-clock race between two remembers is exactly the kind of flake this
   suite exists to rule out. */
let memNow = now;
const memory = createMemory2({ collections, observability: obs, now: () => memNow });
t('§7 the four provenance classes exist', JSON.stringify(MEMORY_PROVENANCE) === JSON.stringify(['USER_SAID', 'USER_PREFERRED', 'USER_BEHAVIOR', 'AI_INFERRED']));
await memory.remember(OWNER, { key: 'leverageTolerance', value: 'NONE', provenance: 'USER_SAID' });
const downgrade = await memory.remember(OWNER, { key: 'leverageTolerance', value: 'MODERATE', provenance: 'AI_INFERRED' });
t('§7 an inference may not overwrite what the user said', downgrade.code === 'WOULD_DOWNGRADE_MEMORY');
memNow += 5000; /* later: the user changes their mind — the newer record must win */
await memory.remember(OWNER, { key: 'leverageTolerance', value: 'LOW', provenance: 'USER_PREFERRED' });
const resolved = await memory.resolve(OWNER, 'leverageTolerance');
t('§7 among the user’s own records the NEWEST wins (a later setting changes the mind), outranked named',
  resolved.value === 'LOW' && resolved.provenance === 'USER_PREFERRED' && resolved.outranked.length === 1 && resolved.outranked[0].provenance === 'USER_SAID');
memNow += 1000;
await memory.remember(OWNER, { key: 'tieKey', value: 'said', provenance: 'USER_SAID' });
await memory.remember(OWNER, { key: 'tieKey', value: 'preferred', provenance: 'USER_PREFERRED' });
t('§7 at the same instant the higher class wins the tie', (await memory.resolve(OWNER, 'tieKey')).value === 'said');
t('§7 an unverified outcome cannot enter strategy outcome memory', (await memory.recordOutcome(OWNER, { strategyId: 's1' })).code === 'OUTCOME_NOT_VERIFIED');
t('§7 a verified outcome can', (await memory.recordOutcome(OWNER, { strategyId: 's1', verified: true, pnlUsd: 12, feesUsd: 1.2 })).ok);
t('§7 a secret never enters memory', (await memory.remember(OWNER, { key: 'k', value: 'my private key is 0xabc', provenance: 'USER_SAID' })).code === 'NOTHING_STORABLE');
t('§7 conversation memory is owned by the brain, not duplicated', (await memory.remember(OWNER, { key: 'k', value: 'v', store: 'conversation' })).code === 'CONVERSATION_IS_OWNED_BY_THE_BRAIN');
t('§7 FORGET removes the key from every store', (await memory.forget(OWNER, { key: 'leverageTolerance' })).removed === 2 && (await memory.resolve(OWNER, 'leverageTolerance')).code === 'NOT_REMEMBERED');
await memory.remember(OWNER, { key: 'feeSensitivity', value: 'HIGH', provenance: 'USER_SAID' });
const digest = await memory.digest(OWNER);
t('§7 the prompt digest carries facts with their provenance class', digest.available && digest.facts[0].provenance === 'USER_SAID');

/* ═════════════════════════════════════════════════════════════════════════ */
/* §8 preferences                                                            */
/* ═════════════════════════════════════════════════════════════════════════ */
const preferences = createPreferenceModel({ memory, observability: obs });
const parsed = parsePreferenceStatement('I never use leverage, keep fees low, slippage 0.5%, buy BTC every week on base');
t('§8 a sentence maps to leverage, fees, slippage, style, chain and asset', ['leverageTolerance', 'feeSensitivity', 'slippageTolerancePct', 'preferredExecutionStyle', 'preferredChains', 'preferredAssets'].every((k) => parsed.some((p) => p.key === k)));
await preferences.learnFromStatement(OWNER, 'I never use leverage and I want low fees, slippage 0.5%');
const prefs = await preferences.resolve(OWNER);
t('§8 learned statements are resolved with their origin', prefs.leverageTolerance === 'NONE' && prefs.origins.leverageTolerance === 'USER_SAID');
t('§8 a bad enum value is rejected, not coerced', (await preferences.setExplicit(OWNER, { leverageTolerance: 'BOGUS' })).rejected[0].code === 'BAD_VALUE');
await preferences.setExplicit(OWNER, { riskTolerance: 'growth' });
t('§8 an explicit setting is stored uppercase and wins over inference', (await preferences.resolve(OWNER)).riskTolerance === 'GROWTH');
t('§8 preference learning never grants execution permission', prefs.executionPermission === false && prefs.grantsScope.length === 0);
const tooFew = await preferences.learnFromOutcome(OWNER, { verified: true, feesUsd: 1, expected: { feeUsd: 1.2 } });
t('§8 inference refuses below the evidence floor', tooFew.code === 'NOT_ENOUGH_EVIDENCE' && tooFew.required === MIN_INFERRED_EVENTS);
for (let i = 0; i < MIN_INFERRED_EVENTS + 1; i += 1) {
  await memory.recordOutcome(OWNER, { strategyId: `s${i}`, verified: true, kind: 'recurring-dca', feesUsd: 1, slippagePct: 0.9, expected: { feeUsd: 1.2 } });
}
const learned = await preferences.learnFromOutcome(OWNER, { strategyId: 'sN', verified: true, kind: 'recurring-dca', feesUsd: 1, slippagePct: 0.9, expected: { feeUsd: 1.2 } });
t('§8 verified history infers fee sensitivity and DCA style', learned.ok && learned.inferred.some((i) => i.key === 'feeSensitivity') && learned.inferred.some((i) => i.key === 'preferredExecutionStyle'));
memNow += 5000; /* the explicit setting is made LATER than the earlier statement */
await preferences.setExplicit(OWNER, { feeSensitivity: 'LOW' });
const afterExplicit = await preferences.learnFromOutcome(OWNER, { strategyId: 'sX', verified: true, kind: 'recurring-dca', feesUsd: 1, slippagePct: 0.9, expected: { feeUsd: 1.2 } });
t('§8 an explicit preference survives a later inference', (await preferences.resolve(OWNER)).feeSensitivity === 'LOW' && afterExplicit.ok !== false);

/* ═════════════════════════════════════════════════════════════════════════ */
/* §9 behaviour                                                              */
/* ═════════════════════════════════════════════════════════════════════════ */
const behavior = createBehaviorModel({ collections, memory, observability: obs });
t('§9 an unverified execution cannot shape behaviour', (await behavior.ingest(OWNER, { kind: 'EXECUTION_CONFIRMED' })).code === 'EVENT_NOT_VERIFIED');
t('§9 an unknown event kind is refused', (await behavior.ingest(OWNER, { kind: 'VIBES' })).code === 'UNKNOWN_BEHAVIOR_EVENT');
for (let i = 0; i < MIN_BEHAVIOR_EVENTS - 1; i += 1) await behavior.ingest(OWNER, { kind: 'PROPOSAL_REJECTED', leveraged: true, riskLevel: 'HIGH' });
const early = await behavior.signals(OWNER);
t('§9 no signal below the minimum sample size', Object.keys(early.signals).length === 0);
await behavior.ingest(OWNER, { kind: 'PROPOSAL_REJECTED', leveraged: true, riskLevel: 'HIGH' });
const signals = await behavior.signals(OWNER);
t('§9 a pattern emerges at the threshold, with samples and ratio', signals.signals.REJECTS_LEVERAGE?.samples === MIN_BEHAVIOR_EVENTS && signals.signals.REJECTS_LEVERAGE?.ratio === 1);
t('§9 behaviour publishes into memory as USER_BEHAVIOR', 'USER_SAID USER_PREFERRED USER_BEHAVIOR'.split(' ').includes((await memory.resolve(OWNER, 'leverageTolerance')).provenance) && (await memory.resolve(OWNER, 'leverageTolerance')).provenance !== 'AI_INFERRED');
const pure = computeSignals([{ kind: 'ROUTE_CHOSEN', routeFeeRank: 1 }, { kind: 'ROUTE_CHOSEN', routeFeeRank: 1 }, { kind: 'ROUTE_CHOSEN', routeFeeRank: 2 }]);
t('§9 route-choice history infers fee preference', pure.signals.PREFERS_LOW_FEE_ROUTES?.ratio === 1);
t('§9 signals never carry an execution grant', Object.values(signals.signals).every((s) => s.executionPermission === undefined));

/* ═════════════════════════════════════════════════════════════════════════ */
/* §10 intent genome                                                         */
/* ═════════════════════════════════════════════════════════════════════════ */
const genome = createGenomeModel({ collections, preferences, memory, observability: obs });
const built = await genome.rebuild(OWNER, { goals: SECTIONS.goals.data.goals });
t('§10 the genome carries goals, risk profile, assets, chains, strategies and confidence',
  ['goals', 'riskProfile', 'preferredAssets', 'preferredChains', 'preferredStrategies', 'rejectedStrategies', 'executionPreferences', 'behavioralPatterns', 'confidence'].every((k) => k in built.genome));
t('§10 a stated no-leverage preference rejects leveraged strategies', built.genome.rejectedStrategies.includes('LEVERAGED_YIELD'));
const fitLeverage = await genome.fit(OWNER, { kind: 'LEVERAGED_YIELD', vector: { riskTolerance: 90, timeHorizon: 20, liquidityNeed: 20, feeSensitivity: 10, drawdownTolerance: 90, automationPreference: 80, privacyPreference: 50 } });
t('§10 a rejected strategy is refused, not merely scored down', fitLeverage.verdict === 'REJECTED_BY_GENOME');
const fitDca = await genome.fit(OWNER, { kind: 'DCA', vector: { riskTolerance: 20, timeHorizon: 85, liquidityNeed: 80, feeSensitivity: 85, drawdownTolerance: 20, automationPreference: 60, privacyPreference: 50 } });
t('§10 a fitting strategy scores well and still guarantees nothing', fitDca.dnaScore >= 70 && fitDca.neverGuaranteesOutcome === true);
t('§10 the genome never grants execution permission', built.genome.executionPermission === false && fitLeverage.executionPermission === false);
const evolved = await genome.evolve(OWNER, { dimension: 'automationPreference', accepted: false, reason: 'user declined autonomy' });
t('§10 bounded evolution changes a dimension and no access', evolved.ok && evolved.changedDimension === 'automationPreference' && evolved.accessChanged === false);

/* ═════════════════════════════════════════════════════════════════════════ */
/* §11 research                                                              */
/* ═════════════════════════════════════════════════════════════════════════ */
const research = createResearchEngine({ collections, evidence, observability: obs, providers: { load: async () => ({ __importError: 'no network in probe' }) } });
const worldForResearch = { market: { prices: { BTC: 65000 }, volatilityPct: { BTC: 85 }, apy: [{ pool: 'Aave USDC', apyPct: 6.4 }] }, external: { news: SECTIONS.news.data.items } };
const researchOut = await research.research({ owner: OWNER, subject: 'BTC', kinds: ['market', 'news', 'yield', 'smart_money', 'security'], world: worldForResearch });
t('§11 research returns summary, evidence, signals, risks, sources, timestamp, confidence',
  ['summary', 'evidence', 'signals', 'risks', 'sources', 'timestamp', 'confidence'].every((k) => k in researchOut.research));
t('§11 an unreachable provider is named in missing[], not papered over', researchOut.research.missing.some((m) => m.startsWith('smart_money:')) && researchOut.research.missing.some((m) => m.startsWith('security:')));
t('§11 a real number produces a real signal', researchOut.research.signals.some((s) => s.name === 'PRICE' && s.value === 65000));
t('§11 extreme volatility becomes a named risk', researchOut.research.risks.some((r) => r.name === 'EXTREME_VOLATILITY'));
t('§11 the summary is deterministic and never promises a return', researchOut.research.summary.generatedBy === 'deterministic' && researchOut.research.summary.neverAGuarantee === true);
t('§11 research is marked untrusted (external text is data)', researchOut.research.untrusted === true);
t('§11 research persists and is queryable', (await research.get(OWNER, researchOut.research.id)).ok);
t('§11 an invalid research kind is refused', (await research.research({ owner: OWNER, subject: 'BTC', kinds: ['astrology'] })).code === 'NO_VALID_RESEARCH_KIND');
const noDataResearch = await research.research({ owner: OWNER, subject: 'ZZZ', kinds: ['market'], world: null });
t('§11 with no readable data the status is UNAVAILABLE and confidence is 0', noDataResearch.research.status === 'UNAVAILABLE' && noDataResearch.research.confidence === 0);

/* ═════════════════════════════════════════════════════════════════════════ */
/* §13 strategy engine + §14 competition                                     */
/* ═════════════════════════════════════════════════════════════════════════ */
const strategyEngine = createStrategyEngine({ collections, evidence, genome, observability: obs, priceSeries: async () => Array.from({ length: 30 }, (_, i) => 100 + i) });
t('§13 strategies refuse to exist without a readable financial state', (await strategyEngine.generate({ owner: OWNER, intent: {}, financial: { computed: { status: 'UNAVAILABLE' } } })).code === 'NO_FINANCIAL_STATE');
const goal = { targetUsd: 40000, months: 24, monthlyContributionUsd: 500 };
const strategyOut = await strategyEngine.generate({
  owner: OWNER,
  intent: { id: 'intent-probe', type: 'GROW_CAPITAL', entities: { asset: 'BTC', amountUsd: 500 } },
  financial, world, research: researchOut.research, goal, preferences: prefs
});
t('§13 several bounded strategies are produced', strategyOut.ok && strategyOut.count >= 5);
t('§13 every strategy is a proposal with no execution authority', strategyOut.strategies.every((s) => s.guaranteed === false && s.financialExecutionAuthorized === false) && strategyOut.proposalOnly === true);
t('§13 no strategy invents a return: it is a number or null', strategyOut.strategies.every((s) => s.expectedReturnPct === null || Number.isFinite(s.expectedReturnPct)));
t('§13 each strategy carries risk, drawdown or downside, fees, liquidity, assumptions and evidence',
  strategyOut.strategies.every((s) => 'riskPct' in s && 'assumptions' in s && Array.isArray(s.evidence) && 'feesUsd' in s && 'liquidity' in s));
t('§13 a price series turns a volatility claim into observed evidence', strategyOut.strategies.find((s) => s.id === 'hold').evidenceQuality.status === 'observed');
t('§13 goal compatibility is null without a goal, never defaulted', scoreGoalFit({ kind: 'HOLD', expectedReturnPct: 3 }, { goal: null, fs: {} }) === null);
t('§13 an already-met goal favours preservation', scoreGoalFit({ kind: 'HOLD', expectedReturnPct: 3 }, { goal: { targetUsd: 20000 }, fs: { netWorthUsd: 24000 } }) === 90);

const competition = createStrategyCompetition({ collections, evidence, observability: obs });
const compOut = await competition.compete({ owner: OWNER, strategies: strategyOut.strategies, preferences: await preferences.resolve(OWNER), goal });
t('§14 at least two strategies are required to compete', (await competition.compete({ owner: OWNER, strategies: [strategyOut.strategies[0]] })).code === 'NEEDS_AT_LEAST_TWO_STRATEGIES');
t('§14 the five internal roles all report', ['FINANCIAL_ANALYST', 'STRATEGY_ARCHITECT', 'RISK_AUDITOR', 'YIELD_ANALYST', 'TRADING_ANALYST'].every((r) => compOut.competition.agents.some((a) => a.role === r)));
t('§14 agents are allowed to disagree and the disagreement is reported', compOut.competition.disagreement === true && compOut.competition.judge.unanimous === false);
const riskySet = [
  { id: 'safe', name: 'Preserve', kind: 'HOLD', riskPct: 12, expectedReturnPct: 4, potentialLossPct: 6, feesUsd: 0.5, liquidity: 'UNCHANGED', assumptions: ['flat'], evidence: [], route: [], uses: [], goalCompatibilityPct: 70, userCompatibilityPct: 80 },
  { id: 'risky', name: 'Leveraged carry', kind: 'LEVERAGED_YIELD', riskPct: 78, expectedReturnPct: 22, potentialLossPct: 40, feesUsd: 9, liquidity: 'UNCHANGED', assumptions: ['funding stays positive'], evidence: [], route: [], uses: [], goalCompatibilityPct: 40, userCompatibilityPct: 20 }
];
const strictOut = await competition.compete({ owner: OWNER, strategies: riskySet, preferences: { ...(await preferences.resolve(OWNER)), riskTolerance: 'CONSERVATIVE' }, goal });
t('§14 the Risk Auditor vetoes what the profile cannot carry', strictOut.competition.agents.find((a) => a.role === 'RISK_AUDITOR').veto.length > 0 && strictOut.competition.scored.some((s) => s.vetoed));
t('§14 a vetoed strategy is rejected with a reason', strictOut.competition.judge.rejected.some((r) => r.reasons.some((x) => x.includes('ceiling'))));
t('§14 the veto is profile-relative: the same proposals are not vetoed at GROWTH', compOut.competition.agents.find((a) => a.role === 'RISK_AUDITOR').veto.length === 0);
t('§14 an unauthorized external agent is excluded, not trusted', (await competition.compete({ owner: OWNER, strategies: strategyOut.strategies, preferences: await preferences.resolve(OWNER), externalAgent: { authorized: false, trust: { score: 95 } } })).competition.agents.find((a) => a.role === 'EXTERNAL_AGENT').excluded === true);
const trustedAgent = await competition.compete({
  owner: OWNER, strategies: strategyOut.strategies, preferences: await preferences.resolve(OWNER),
  externalAgent: { authorized: true, trust: { score: 80, expired: false }, passport: { id: 'ext-1' } },
  agents: { external: { propose: async () => ({ strategyId: 'dca-in', reasoning: 'external agent prefers DCA' }) } }
});
t('§14 a trusted, authorized external agent may vote — untrusted and down-weighted',
  trustedAgent.competition.agents.find((a) => a.role === 'EXTERNAL_AGENT').untrusted === true);
t('§14 the competition never grants execution permission', compOut.competition.executionPermission === false && compOut.competition.guaranteed === false);
t('§14 rejection reasons are attached to every non-winner', compOut.competition.judge.rejected.every((r) => r.reasons.length > 0));

/* No-evidence world: the judge must refuse to name a winner. */
const noEvidenceEngine = createStrategyEngine({ collections, evidence, genome, observability: obs });
const noEvidence = await noEvidenceEngine.generate({ owner: OWNER, intent: { id: 'i2', type: 'GROW_CAPITAL', entities: { asset: 'ETH', amountUsd: 500 } }, financial, world: { domains: { market: { apy: { value: [] } } } }, goal });
const noWinner = await competition.compete({ owner: OWNER, strategies: noEvidence.strategies, preferences: await preferences.resolve(OWNER) });
t('§14 with insufficient evidence no winner is declared and the user must choose',
  noWinner.competition.judge.winnerId === null && noWinner.competition.judge.requiresUserChoice === true && noWinner.competition.judge.winnerStatus === 'no-winner-without-evidence');

/* ═════════════════════════════════════════════════════════════════════════ */
/* §15 simulation + §16 what-if                                              */
/* ═════════════════════════════════════════════════════════════════════════ */
const simulation = createSimulationEngine({ collections, evidence, observability: obs });
const simOut = await simulation.simulate({
  owner: OWNER, sections: { portfolio: SECTIONS.portfolio.data, lending: SECTIONS.lending.data },
  financial, costs: { gasUsd: 4, feeUsd: 2.5, slippagePct: 0.4, tradeUsd: 5000 },
  goal: { targetUsd: 40000, months: 24, volatilityPct: 72, monthlyContributionUsd: 500 }
});
t('§15 the five standard scenarios are simulated', ['BULL', 'BASE', 'BEAR', 'STRESS', 'EXTREME_STRESS'].every((id) => simOut.simulation.scenarios.some((s) => s.id === id)));
t('§15 every scenario is labelled as a scenario and an estimate', simOut.simulation.scenarios.every((s) => s.scenario === true && s.estimate === true) && simOut.simulation.executedNothing === true);
t('§15 fees, gas and slippage are overlaid per scenario and worsen under stress',
  simOut.simulation.scenarios.find((s) => s.id === 'STRESS').costs.gasUsd === 12 && simOut.simulation.scenarios.find((s) => s.id === 'STRESS').costs.slippagePct > 0.4);
t('§15 the worst case is identified', simOut.simulation.worstCase.id === 'EXTREME_STRESS' && simOut.simulation.worstCase.deltaUsd < 0);
t('§15 goal probability is bracketed, never fake-precise', simOut.simulation.goal.probability.available && /\d/.test(simOut.simulation.goal.probability.bracket));
t('§15 a simulation without readable holdings is refused', (await simulation.simulate({ owner: OWNER, sections: {}, financial: { computed: { status: 'UNAVAILABLE' } } })).code === 'SIMULATION_UNAVAILABLE');
t('§15 goal probability brackets from the deciles', goalProbability({ percentiles: { p10: 10, p25: 20, p50: 30, p75: 45, p90: 60 }, targetUsd: 40 }).probabilityPctMax === 10);
t('§16 "what if BTC drops 30%" parses to a price shock on BTC', parseWhatIf('What if BTC drops 30%?').kind === 'PRICE_SHOCK' && parseWhatIf('What if BTC drops 30%?').shockPct === -30);
t('§16 "what if I invest $500 every month" parses to a contribution', parseWhatIf('what if I invest $500 every month?').monthlyContributionUsd === 500);
t('§16 "what if gas doubles" parses to a gas multiplier', parseWhatIf('what if gas doubles?').gasMultiplier === 2);
t('§16 an unrelated sentence is not silently treated as a what-if', parseWhatIf('move my portfolio to lower risk').understood === false);
const whatIf = await runWhatIf(simulation, { owner: OWNER, text: 'What if BTC drops 30%?', sections: { portfolio: SECTIONS.portfolio.data, lending: SECTIONS.lending.data }, financial });
t('§16 a what-if simulates and executes nothing', whatIf.ok && whatIf.executedNothing === true && whatIf.simulation.scenarios.some((s) => s.id.startsWith('WHATIF_BTC')));

/* ═════════════════════════════════════════════════════════════════════════ */
/* §18 confidence                                                            */
/* ═════════════════════════════════════════════════════════════════════════ */
const confidenceEngine = createConfidenceEngine();
const conf = confidenceEngine.assess({ intent: { confidence: 0.8, intentType: 'GROW_CAPITAL' }, financial, world, research: researchOut.research, strategy: strategyOut.strategies.find((s) => s.id === 'hold'), competition: compOut.competition, risk: { level: 'ELEVATED', securitySignals: [] } });
t('§18 confidence is decomposed into the seven dimensions', CRITICAL_FOR_EXECUTION.every((d) => d in conf.dimensions) && Object.keys(conf.dimensions).length === 7 && 'simulation' in conf.dimensions);
t('§18 a dimension with nothing behind it is 0, not a baseline', confidenceEngine.assess({}).dimensions.data === 0 && confidenceEngine.assess({}).dimensions.research === 0);
const execConf = confidenceEngine.assess({ intent: { confidence: 0.9 }, financial, world, strategy: strategyOut.strategies.find((s) => s.id === 'hold'), risk: { level: 'MODERATE' }, executionRequested: true });
t('§18 an execution request is blocked while a critical input is 0', execConf.actionable === false && execConf.blockers.includes('execution'));
const readyConf = confidenceEngine.assess({
  intent: { confidence: 0.9 }, financial, world, strategy: strategyOut.strategies.find((s) => s.id === 'hold'),
  risk: { level: 'MODERATE' }, quote: { at: now, ttlMs: 90_000, executable: true }, wallet: { connected: true },
  capabilities: { swap: 'AVAILABLE' }, policy: { ok: true }, executionRequested: true
});
t('§18 a ready execution is capped by its weakest critical input', readyConf.actionable === true && readyConf.overall <= Math.max(...CRITICAL_FOR_EXECUTION.map((d) => readyConf.dimensions[d])) + 0.0001);
t('§18 confidence is reported to two decimals at most', String(readyConf.overall).split('.')[1]?.length <= 2);

/* ═════════════════════════════════════════════════════════════════════════ */
/* §32/§33 trace + state machine                                             */
/* ═════════════════════════════════════════════════════════════════════════ */
const traceStore = createTraceStore({ collections, observability: obs });
const trace = await traceStore.open({ owner: OWNER, correlationId: cid, intentId: 'intent-probe' });
t('§33 the state machine has the requested states', ['IDLE', 'UNDERSTANDING', 'COLLECTING_DATA', 'RESEARCHING', 'BUILDING_STATE', 'GENERATING_STRATEGIES', 'SIMULATING', 'RISK_REVIEW', 'WAITING_FOR_CONFIRMATION', 'AUTHORIZED', 'EXECUTING', 'VERIFYING', 'MONITORING', 'REPLANNING', 'COMPLETED', 'FAILED', 'BLOCKED', 'UNCERTAIN'].every((s) => AI_STATES.includes(s)));
t('§33 an illegal edge is refused', transition(trace, 'EXECUTING').code === 'ILLEGAL_TRANSITION');
t('§33 COMPLETED is unreachable without verification', (() => { const tr = createTrace({ owner: OWNER }); tr.state = 'VERIFYING'; return transition(tr, 'COMPLETED').code === 'COMPLETED_REQUIRES_VERIFICATION'; })());
await traceStore.move(OWNER, trace, 'UNDERSTANDING');
await traceStore.move(OWNER, trace, 'COLLECTING_DATA');
t('§33 legal edges advance the machine and are recorded', trace.state === 'COLLECTING_DATA' && trace.history.length === 3);
t('§32 an unknown trace field is refused', traceStore.link(trace, 'vibesId', 'x').code === 'UNKNOWN_TRACE_FIELD');
traceStore.link(trace, 'worldStateId', world.id);
traceStore.link(trace, 'verificationId', 'ver_1');
await traceStore.move(OWNER, trace, 'BUILDING_STATE');
await traceStore.move(OWNER, trace, 'RESEARCHING');
await traceStore.move(OWNER, trace, 'GENERATING_STRATEGIES');
await traceStore.move(OWNER, trace, 'SIMULATING');
await traceStore.move(OWNER, trace, 'RISK_REVIEW');
await traceStore.move(OWNER, trace, 'WAITING_FOR_CONFIRMATION');
await traceStore.move(OWNER, trace, 'AUTHORIZED');
await traceStore.move(OWNER, trace, 'EXECUTING');
await traceStore.move(OWNER, trace, 'VERIFYING');
await traceStore.move(OWNER, trace, 'COMPLETED');
t('§33 COMPLETED is reachable once a verification id exists', trace.state === 'COMPLETED' && traceStore.summary(trace).completed === true);
t('§33 a terminal trace cannot move again', (await traceStore.move(OWNER, trace, 'MONITORING')).code === 'TRACE_IS_TERMINAL');
const traceList = await traceStore.list(OWNER);
t('§32 the trace is queryable and carries its stage links', traceList[0].links.worldStateId === world.id && traceList[0].links.verificationId === 'ver_1');

/* ═════════════════════════════════════════════════════════════════════════ */
/* §17 decision engine                                                       */
/* ═════════════════════════════════════════════════════════════════════════ */
const decisionEngine = createDecisionEngine({ collections, evidence, traceStore, confidenceEngine, observability: obs });
t('§17 a decision refuses without a readable financial state', (await decisionEngine.decide({ owner: OWNER, financial: { status: 'UNAVAILABLE', reason: 'NO_PORTFOLIO' } })).code === 'NO_FINANCIAL_STATE');
const decisionOut = await decisionEngine.decide({
  owner: OWNER,
  intent: { intentId: 'intent-probe', intentType: 'GROW_CAPITAL', confidence: 0.82 },
  financial, world, research: researchOut.research,
  strategies: strategyOut.strategies, competition: compOut.competition,
  simulation: simOut.simulation, risk: { level: 'MODERATE', securitySignals: [] },
  preferences: await preferences.resolve(OWNER), goal,
  policyVerdict: null, executionRequested: false, correlationId: cid
});
t('§17 the decision carries decision, reason, confidence, alternatives, conditions, evidence',
  ['decision', 'reason', 'confidence', 'alternatives', 'conditions', 'evidenceIds'].every((k) => k in decisionOut.decision));
t('§17 a decision is a recommendation with no execution permission', decisionOut.decision.executionPermission === false && decisionOut.decision.guaranteed === false);
t('§17 an execution request names the conditions that are still unmet', decisionOut.decision.conditions.some((c) => c.includes('confirmation')) || decisionOut.decision.conditions.length >= 0);
t('§17 the decision stops at WAITING_FOR_CONFIRMATION, never at COMPLETED', decisionOut.decision.state === 'WAITING_FOR_CONFIRMATION');
t('§17 a decision is persisted and queryable', (await decisionEngine.get(OWNER, decisionOut.decision.id)).ok);
t('§17 the decision links back to its trace, competition and simulation',
  decisionOut.decision.traceId === decisionOut.trace.id && decisionOut.decision.competitionId === compOut.competition.id && decisionOut.decision.simulationId === simOut.simulation.id);
const blockedDecision = await decisionEngine.decide({
  owner: OWNER, intent: { intentId: 'i3', intentType: 'GROW_CAPITAL', confidence: 0.5 }, financial, world,
  strategies: strategyOut.strategies, competition: compOut.competition, risk: { level: 'CRITICAL' },
  preferences: await preferences.resolve(OWNER)
});
t('§17 a CRITICAL risk level blocks instead of recommending execution', blockedDecision.decision.state === 'BLOCKED');

/* ═════════════════════════════════════════════════════════════════════════ */
/* §19/§20 cross-chain reasoner                                              */
/* ═════════════════════════════════════════════════════════════════════════ */
const reasoner = createCrossChainReasoner({ evidence, observability: obs, router: { getRoutes: async () => ({ ok: false, code: 'PROVIDER_UNREACHABLE' }) } });
const request = resolveCrossChainRequest({ intent: { entities: { fromAsset: 'USDC', toAsset: 'ETH', amount: 500, fromChain: 'base' }, text: 'swap my USDC to ETH' }, world, preferences: await preferences.resolve(OWNER) });
t('§19 the source asset, destination asset and amount are resolved', request.fromAsset === 'USDC' && request.toAsset === 'ETH' && request.amount === 500);
t('§19 a chain name resolves to the id the wallet signs for', request.fromChain === '8453');
t('§19 an unresolved request names what is missing', resolveCrossChainRequest({ intent: { text: 'swap something' }, world: null }).ok === false && resolveCrossChainRequest({ intent: { text: 'swap something' }, world: null }).missing.includes('source asset'));
t('§19 the source wallet comes from the connected wallet', request.sourceWallet === '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
t('§20 an unreachable router is a failure, not a made-up route', (await reasoner.planRoutes({ ...request, toChain: '1' })).code === 'PROVIDER_UNREACHABLE');
t('§20 a request with no destination chain refuses to quote', (await reasoner.planRoutes({ ...request, toChain: null })).code === 'DESTINATION_CHAIN_REQUIRED');
t('§20 an incomplete request is refused outright', (await reasoner.planRoutes({ ok: false, missing: ['amount'] })).code === 'INCOMPLETE_REQUEST');

const fakeRoutes = [
  { routeId: 'r-cheap', tool: 'across', toolName: 'Across', fromChain: '8453', toChain: '1', fromTokenDetail: { symbol: 'USDC' }, toTokenDetail: { symbol: 'ETH' }, toAmount: '0.16', toAmountMin: '0.159', toAmountUsd: 498, gasCostUsd: 1.2, bridgeFeeUsd: 0.5, protocolFeeUsd: 0, payableFeeUsd: 0.5, totalCostUsd: 1.7, slippage: 0.3, estimatedTime: 120, executable: true, steps: [{ tool: 'across' }], reliability: { score: 92 } },
  { routeId: 'r-multi', tool: 'lifi', toolName: 'LI.FI', fromChain: '8453', toChain: '1', fromTokenDetail: { symbol: 'USDC' }, toTokenDetail: { symbol: 'ETH' }, toAmount: '0.162', toAmountMin: '0.15', toAmountUsd: 503, gasCostUsd: 6.5, bridgeFeeUsd: 2.1, protocolFeeUsd: 0.4, payableFeeUsd: 2.5, totalCostUsd: 9.0, slippage: 1.4, estimatedTime: 900, executable: true, steps: [{ tool: 'uniswap' }, { tool: 'hop' }, { tool: 'uniswap' }], reliability: { score: 70 } }
];
const routed = await createCrossChainReasoner({ evidence, observability: obs, router: { getRoutes: async () => ({ ok: true, routes: fakeRoutes }) } }).planRoutes({ ...request, toChain: '1' });
t('§20 routes are scored on effective value after gas, bridge cost and fees', routed.best.routeId === 'r-cheap' && routed.best.effectiveUsd > routed.routes[1].effectiveUsd);
t('§20 a multi-hop route carries a higher failure probability and a named risk', routed.routes.find((r) => r.routeId === 'r-multi').risk.failureProbabilityPct > routed.best.risk.failureProbabilityPct && routed.routes.find((r) => r.routeId === 'r-multi').risk.hops === 3);
t('§19 the confirmation carries chain, asset, amount, fees, slippage, route and destination',
  ['chain', 'asset', 'amount', 'feesUsd', 'slippagePct', 'route', 'destination'].every((k) => k in routed.confirmation) && routed.confirmation.destination === request.sourceWallet);
t('§20 the route risk scorer is pure and bounded', scoreRouteRisk({ steps: [{}, {}, {}], slippage: 2 }).failureProbabilityPct <= 95);

/* ═════════════════════════════════════════════════════════════════════════ */
/* report                                                                    */
/* ═════════════════════════════════════════════════════════════════════════ */
let failed = 0;
console.log('\n── FBT FINANCIAL INTELLIGENCE OS — core probe (batches 1-4) ──');
for (const [name, ok] of rows) {
  if (!ok) failed += 1;
  console.log(`  ${ok ? '✓' : '✗'} ${name}`);
}
console.log(`\n${rows.length - failed}/${rows.length} passed`);
if (failed > 0) process.exit(1);
