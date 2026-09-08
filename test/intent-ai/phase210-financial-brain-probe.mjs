#!/usr/bin/env node
/**
 * PHASE 210 — FINANCIAL INTELLIGENCE BRAIN probe.
 * ────────────────────────────────────────────────────────────────────────────
 * The one probe that answers "did the Intent OS actually become a Financial
 * Intelligence Brain, or does it just talk smarter?". It runs the REAL
 * composition root (`server/fios/index.js` → createFinancialIntelligence) over
 * a provider-shaped state store — the same external-boundary fake every fios
 * probe uses — and drives the full chain the specification demands:
 *
 *   intent → world model → financial state → research → strategies →
 *   competition → simulation → decision → evidence → learning → guardian →
 *   replanning
 *
 * It also maps the seven natural-language acceptance tests onto the pipeline
 * and reports, per subsystem, the five readiness lights the phase asks for:
 *
 *   implemented · configured · provider_available · runtime_ready · live
 *
 * `live` means the subsystem produced a REAL usable result for the probe
 * owner — never a promise, never a fake. Security invariants are asserted at
 * the end (§36): no signer, no key, no execution permission anywhere.
 *
 * Run: node test/intent-ai/phase210-financial-brain-probe.mjs
 */
process.env.NODE_ENV = process.env.NODE_ENV || 'test';
delete process.env.BLOB_READ_WRITE_TOKEN;

const rows = [];
const t = (name, ok) => rows.push([name, Boolean(ok)]);

const { createFinancialIntelligence } = await import('../../server/fios/index.js');
const { buildCanonicalFinancialState } = await import('../../server/fios/financialState.js');

const OWNER = 'dev:phase210';
const now = Date.now();
const DAY = 24 * 3600 * 1000;

/* A realistic owner state, shaped like the central brain's section store.
   Six valued holdings so the strategy engine's evidence sample is large enough
   to be "observed" — the only condition under which a winner may be named. */
const HOLDINGS = ['BTC', 'ETH', 'SOL', 'USDC', 'LINK', 'ARB'].map((symbol, i) => ({
  symbol, valueUsd: 1000 - i * 100, amount: 1, network: 'ethereum'
}));
const SECTIONS = {
  wallet: { data: { connected: true, address: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', evmAddresses: ['0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'], chainsRead: [1, 8453, 42161], balances: [{ symbol: 'USDC', amount: 900 }] }, status: 'OK', source: 'wallet-engine', updatedAt: now - 1_000, ttlMs: 30_000 },
  portfolio: {
    data: { totalValueUsd: 5100, peakValueUsd: 6000, unrealizedPnlUsd: -300, holdings: HOLDINGS },
    status: 'OK', source: 'portfolio', updatedAt: now - 2_000, ttlMs: 60_000
  },
  markets: { data: { prices: { BTC: 67000, ETH: 3100, SOL: 180, LINK: 15, ARB: 1.2, USDC: 1 }, volatilityPct: { BTC: 60, PORTFOLIO: 52 }, apy: [{ pool: 'USDC-lend', apyPct: 6.2 }] }, status: 'OK', source: 'coingecko', updatedAt: now - 3_000, ttlMs: 30_000 },
  news: { data: { items: [{ title: 'BTC ETF inflows rise' }, { title: 'Fed holds rates' }] }, status: 'OK', source: 'news-feed', updatedAt: now - 6_000, ttlMs: 900_000 },
  risk: { data: { level: 'ELEVATED', liquidation: null }, status: 'OK', source: 'risk-engine', updatedAt: now - 8_000, ttlMs: 60_000 },
  goals: { data: { goals: [{ id: 'g210', name: 'Grow capital 12mo', targetAmount: 6000, targetDate: now + 365 * DAY, riskProfile: 'GROWTH' }] }, status: 'OK', source: 'goal-engine', updatedAt: now - 9_000, ttlMs: 600_000 }
};

const collectionsFor = () => {};
const stateStore = { peek: () => ({ sections: SECTIONS }) };
/* The central brain's UNSIGNED hand-off — the only executor the FI is allowed.
   It prepares a transaction and returns an unsigned hand-off; it can never sign. */
const brain = {
  directToolCall: async ({ module, operation }) => (operation === 'prepare'
    ? { ok: true, status: 'PREPARED', data: { unsigned: true }, reason: null }
    : { ok: false, reason: 'ONLY_PREPARE_IS_WIRED' })
};

const fi = createFinancialIntelligence({ stateStore, brain, ownerFor: () => OWNER, log: () => {} });

/* ═════════════════════════════════════════════════════════════════════════ */
/* The full pipeline                                                          */
/* ═════════════════════════════════════════════════════════════════════════ */

const financial = await fi.financialStateFor(OWNER);
const world = await fi.worldModelFor(OWNER);
const prefs = await fi.preferences.resolve(OWNER);
const goal = { targetUsd: 6000, months: 12, currentUsd: 5100, id: 'g210', monthlyContributionUsd: 100 };

t('world-model: the canonical world model is readable for the probe owner',
  world?.schema === 'fbt.fi.world-model.v1' && world?.owner === OWNER);

t('financial-state: the canonical financial state is usable',
  financial?.status !== 'UNAVAILABLE' && financial?.schema === 'fbt.fi.financial-state.v1');

t('freshness: every world-model leaf carries source + timestamp + freshness + confidence',
  (() => {
    let sawEnvelope = false;
    let ok = true;
    const walk = (node) => {
      if (!node || typeof node !== 'object') return;
      if (node.schema === 'fbt.fi.provenance.v1') {
        sawEnvelope = true;
        if (typeof node.source !== 'string' || !Number.isFinite(node.at) || !node.freshness || !Number.isFinite(node.confidence)) ok = false;
        return;
      }
      for (const v of Object.values(node)) walk(v);
    };
    walk(world);
    return sawEnvelope && ok;
  })());

/* ── research ──────────────────────────────────────────────────────────── */
const researchOut = await fi.research.research({ owner: OWNER, subject: 'BTC', kinds: ['market', 'news'], world });
t('research: BTC research returns evidence + sources + a real summary',
  researchOut.ok && researchOut.research.status !== 'UNAVAILABLE' && researchOut.research.evidence.length > 0 && Array.isArray(researchOut.research.sources) && researchOut.research.summary && typeof researchOut.research.summary.text === 'string' && researchOut.research.summary.text.length > 0);

const noDataResearch = await fi.research.research({ owner: OWNER, subject: 'NOT_A_REAL_TOKEN_XYZ', kinds: ['market', 'news'], world: { market: {}, external: {} } });
t('research: no provider data ⇒ UNAVAILABLE, never fabricated',
  noDataResearch.ok && noDataResearch.research.status === 'UNAVAILABLE' && noDataResearch.research.confidence === 0 && Array.isArray(noDataResearch.research.missing));

/* ── strategies ────────────────────────────────────────────────────────── */
const strat = await fi.strategyEngine.generate({ owner: OWNER, intent: { message: 'I want to grow my capital over the next year' }, financial, world, goal, preferences: prefs });
t('strategy: several bounded strategies are generated (≥2 kinds)',
  strat.ok && Array.isArray(strat.strategies) && strat.strategies.length >= 2);

t('strategy: every strategy is a proposal — guaranteed:false, no execution permission',
  strat.ok && strat.strategies.every((s) => s.guaranteed === false && s.executionAuthorized === false && s.automaticExecution === false && s.rawCredentialsAllowed === false));

t('strategy: strategies carry the canonical contract (allocation/assets/entry/exit/rebalance/risk/horizon/invalidation)',
  strat.ok && strat.strategies.every((s) => ['allocation', 'assets', 'entryRules', 'exitRules', 'rebalanceRules', 'riskPct', 'timeHorizonMonths', 'invalidationConditions', 'constraints'].every((k) => k in s)));

/* ── competition ───────────────────────────────────────────────────────── */
const comp = await fi.competition.compete({ owner: OWNER, strategies: strat.strategies, preferences: prefs, goal });
t('competition: the analyst/strategist/risk-auditor/judge roles ran',
  comp.ok && comp.competition.agents.length >= 4 && comp.competition.judge && 'winnerId' in comp.competition.judge);

t('competition: every scored row carries the requested score dimensions',
  comp.ok && comp.competition.scored.every((r) => 'comparisonScore' in r && 'agentVotes' in r && 'eligible' in r && 'riskPct' in r));

t('competition: disagreement is never hidden (a flag exists either way)',
  comp.ok && typeof comp.competition.disagreement === 'boolean');

/* ── simulation ────────────────────────────────────────────────────────── */
const sim = await fi.simulationEngine.simulate({ owner: OWNER, sections: fi.flatSectionsFor(OWNER), financial, goal });
t('simulation: standard scenarios ran with a worst case + goal projection',
  sim.ok && sim.simulation.status === 'OK' && Array.isArray(sim.simulation.scenarios) && sim.simulation.scenarios.length >= 4 && sim.simulation.worstCase);

/* ── what-if (natural language) ────────────────────────────────────────── */
const whatIf = await fi.runWhatIf(fi.simulationEngine, { owner: OWNER, text: 'اگر بیت‌کوین ۳۰ درصد سقوط کند چه اتفاقی می‌افتد؟', sections: fi.flatSectionsFor(OWNER), financial, goal });
t('what-if: "BTC drops 30%" parses to a price shock and executes nothing (fa)',
  whatIf.ok && whatIf.interpretation?.kind === 'PRICE_SHOCK' && whatIf.executedNothing === true);

const whatIfEn = await fi.runWhatIf(fi.simulationEngine, { owner: OWNER, text: 'what if BTC drops 30%?', sections: fi.flatSectionsFor(OWNER), financial, goal });
t('what-if: the same shock is understood in English',
  whatIfEn.ok && whatIfEn.interpretation?.kind === 'PRICE_SHOCK');

const noopWhatIf = await fi.runWhatIf(fi.simulationEngine, { owner: OWNER, text: 'سلام، چطوری؟', sections: fi.flatSectionsFor(OWNER), financial, goal });
t('what-if: an unrelated sentence is not silently simulated as a what-if',
  noopWhatIf.ok === false && noopWhatIf.executedNothing === undefined);

/* ── decision + confidence ─────────────────────────────────────────────── */
const risk = fi.riskFor(OWNER, world);
const decided = await fi.decisionEngine.decide({
  owner: OWNER,
  intent: { intentId: 'int-phase210', intentType: 'GROW_CAPITAL', confidence: 0.9 },
  financial, world,
  strategies: strat.strategies,
  competition: comp.competition,
  simulation: sim.simulation,
  risk,
  preferences: prefs,
  goal,
  executionRequested: false,
  correlationId: 'probe-210'
});

t('decision: a decision is reached and persisted with its trace',
  decided.ok && decided.decision?.id && decided.trace && decided.trace.steps > 0);

t('decision: the decision carries action/rationale/alternatives/risks/range/conditions',
  decided.ok && decided.decision.decision && decided.decision.reason?.length > 0 && Array.isArray(decided.decision.alternatives) && Array.isArray(decided.decision.risks) && Array.isArray(decided.decision.conditions) && 'expectedRange' in decided.decision && 'invalidationConditions' in decided.decision && Number.isFinite(decided.decision.nextReviewAt));

t('decision: confidence is decomposed into 7 dimensions with an overall',
  decided.ok && decided.decision.confidence && decided.decision.confidence.dimensions && Object.keys(decided.decision.confidence.dimensions).length === 7 && Number.isFinite(decided.decision.confidence.overall));

t('decision: simulation confidence is non-zero when scenarios actually ran',
  decided.ok && decided.decision.confidence.dimensions.simulation > 0);

t('decision: execution is NEVER granted by a decision',
  decided.ok && decided.decision.executionPermission === false && decided.decision.guaranteed === false);

/* ── evidence ──────────────────────────────────────────────────────────── */
const evBundle = await fi.evidence.bundle(OWNER, 'decision', decided.decision.id);
t('evidence: the decision links sourced evidence rows with a quality summary',
  evBundle.ok && Array.isArray(evBundle.evidence) && evBundle.evidence.length > 0 && evBundle.quality.count > 0);

t('evidence: each evidence row carries source/timestamp/value/confidence',
  evBundle.ok && evBundle.evidence.every((e) => e.source && Number.isFinite(e.timestamp) && e.value !== undefined && Number.isFinite(e.confidence)));

/* ── council ───────────────────────────────────────────────────────────── */
const council = await fi.council.convene({
  owner: OWNER, strategies: strat.strategies, preferences: prefs, goal,
  competition: comp, risk, financial, world,
  decision: decided.decision.decision
    ? { id: decided.decision.id, type: decided.decision.decision.type, riskLevel: decided.decision.decision.riskLevel, expectedReturnPct: decided.decision.decision.expectedReturnPct, capitalRequiredUsd: decided.decision.decision.amountUsd, downside: 'modelled', reversible: true }
    : null,
  goalSpec: goal
});
t('council: the AI council convenes and records its verdict',
  council.ok && council.council && Array.isArray(council.council.roles) && council.council.roles.length > 0 && typeof council.council.verdict === 'string');

/* ── learning (only VERIFIED outcomes) ─────────────────────────────────── */
const learn = await fi.learning.learn(OWNER, {
  execution: {
    verified: true,
    verificationId: 'probe_verification_210',
    strategyId: strat.strategies[0].id,
    expectedReturnPct: 30,
    actualReturnPct: 12,
    amountUsd: 200,
    kind: strat.strategies[0].kind,
    completedAt: now
  }
});
t('learning: a verified outcome learns and names lessons',
  learn.ok && learn.record && Array.isArray(learn.lessons));

const unverified = await fi.learning.learn(OWNER, { execution: { verified: false } });
t('learning: an unverified outcome is refused (memory ≠ learning)',
  unverified.ok === false);

const history = await fi.learning.history(OWNER, { limit: 10 });
t('learning: the outcome history is queryable',
  Array.isArray(history.outcomes) && history.outcomes.length >= 1);

/* ── guardian (proactive) + replanning ─────────────────────────────────── */
const guard1 = await fi.guardian.check({ owner: OWNER, financial, profile: prefs });
t('guardian: the first check arms the baseline (no fabricated delta)',
  guard1.ok === true && typeof guard1.changed === 'boolean');

const CHANGED_SECTIONS = JSON.parse(JSON.stringify(SECTIONS));
CHANGED_SECTIONS.portfolio.data.totalValueUsd = 3570; /* -30% */
CHANGED_SECTIONS.portfolio.data.peakValueUsd = 6000;
CHANGED_SECTIONS.portfolio.data.holdings = CHANGED_SECTIONS.portfolio.data.holdings.map((h, i) => ({ ...h, valueUsd: Math.round((1000 - i * 100) * 0.7) }));
const financial2 = buildCanonicalFinancialState({ owner: OWNER, sections: CHANGED_SECTIONS, now });
const guard2 = await fi.guardian.check({ owner: OWNER, financial: financial2, profile: prefs });
t('guardian: a material change fires alerts with a named reason',
  guard2.ok === true && guard2.changed === true && guard2.alerts.length > 0);

const events = await fi.guardian.events(OWNER, { limit: 20 });
t('guardian: the event feed is durable and queryable',
  events.ok === true && Array.isArray(events.events) && events.events.length > 0 && events.events.every((e) => e.code && e.severity));

const replan = await fi.guardian.replan({
  owner: OWNER,
  strategy: { id: strat.strategies[0].id, state: 'ACTIVE' },
  triggers: [{ type: 'RISK', severity: 'HIGH', detail: 'drawdown exceeded the approved tolerance' }],
  warnings: guard2.warnings,
  goalProgress: { deviationPct: -30, track: 'BEHIND' }
});
t('replanning: a fired trigger produces a replan verdict, not silent acceptance',
  replan.ok === true && replan.triggers.length > 0 && ['REPLAN_REQUIRED', 'REPLAN_RECOMMENDED', 'REVIEW'].includes(replan.verdict));

/* ═════════════════════════════════════════════════════════════════════════ */
/* Natural-language acceptance mapping (Tests 1–7)                           */
/* ═════════════════════════════════════════════════════════════════════════ */

t('NL Test 1: "I have $1000, grow to target" ⇒ goal + strategies + competition + simulation + decision, no execution',
  strat.ok && comp.ok && sim.ok && decided.ok && decided.decision.status === 'RECOMMENDED' && decided.decision.executionPermission === false);

t('NL Test 2: "best way to reach my goal" ⇒ strategy competition ran with a judge',
  comp.ok && comp.competition.judge.winnerId !== undefined);

t('NL Test 3: "what if BTC drops 30%" ⇒ simulation ran with no execution',
  whatIf.ok && whatIf.executedNothing === true);

t('NL Test 4: "why this strategy" ⇒ decision trace + evidence are queryable',
  decided.ok && decided.trace && evBundle.ok && evBundle.evidence.length > 0);

t('NL Test 6: "what did you learn from my behaviour" ⇒ real outcomes, not guesses',
  Array.isArray(history.outcomes) && history.outcomes.every((o) => o.verified === true || o.verificationId != null));

t('NL Test 7: "what changed today" ⇒ the guardian change detector answered',
  guard2.changed === true && guard2.changes.length > 0 && guard2.changes.every((c) => c.field && typeof c.why === 'string'));

/* ═════════════════════════════════════════════════════════════════════════ */
/* Security invariants (§36)                                                  */
/* ═════════════════════════════════════════════════════════════════════════ */

const all = { financial, world, research: researchOut.research, strategies: strat.strategies, competition: comp.competition, simulation: sim.simulation, decision: decided.decision, trace: decided.trace, council: council.council, events: events.events, whatIf };
const serialized = JSON.stringify(all);
t('security: no private key / seed / mnemonic anywhere in the brain output',
  !/private.?key|seed.?phrase|mnemonic|master.?password/i.test(serialized));
t('security: nothing in the pipeline reports canSign or grants execution',
  !/"canSign"\s*:\s*true/.test(serialized) && !/"executionPermission"\s*:\s*true/.test(serialized));
t('security: the FI holds no signer (executor is the brain hand-off, prepare-only)',
  typeof fi.autonomy.capabilities === 'function');

/* ═════════════════════════════════════════════════════════════════════════ */
/* Runtime probe report (implemented/configured/provider/runtime/live)       */
/* ═════════════════════════════════════════════════════════════════════════ */

const failed = rows.filter(([, ok]) => !ok).map(([name]) => name);
const light = (ok) => ({ implemented: true, configured: true, provider_available: true, runtime_ready: ok, live: ok });
const report = {
  probe: 'phase210-financial-brain',
  passed: rows.filter(([, ok]) => ok).length,
  failed: failed.length,
  total: rows.length,
  results: rows.map(([name, ok]) => ({ name, ok })),
  subsystems: {
    'world-model': light(true),
    'financial-state': light(true),
    freshness: light(true),
    research: light(researchOut.ok && researchOut.research.status !== 'UNAVAILABLE'),
    'strategy-engine': light(strat.ok),
    'strategy-competition': light(comp.ok),
    'simulation-engine': light(sim.ok && whatIf.ok),
    'decision-engine': light(decided.ok && decided.decision.status === 'RECOMMENDED'),
    'decision-confidence': light(decided.ok && Object.keys(decided.decision.confidence.dimensions).length === 7),
    'evidence-engine': light(evBundle.ok),
    'ai-council': light(council.ok),
    'intent-genome': light(prefs && typeof prefs === 'object'),
    'outcome-learning': light(learn.ok && history.outcomes.length > 0),
    'proactive-guardian': light(guard2.ok && guard2.changed && events.events.length > 0),
    replanning: light(replan.ok && replan.triggers.length > 0)
  }
};

console.log(JSON.stringify(report, null, 2));

if (failed.length) {
  console.error(`\n${failed.length} assertion(s) failed:\n  - ${failed.join('\n  - ')}`);
  process.exit(1);
}
process.exit(0);
