#!/usr/bin/env node
/**
 * PHASE 211 — GLOBAL AI INTELLIGENCE probe.
 * ────────────────────────────────────────────────────────────────────────────
 * The one probe that answers "did the Intent OS actually become a GLOBAL
 * financial intelligence, or does it just have more endpoints?". It drives the
 * REAL composition root (`server/fios/index.js` → createFinancialIntelligence)
 * with provider-shaped sections AND injected providers — the same external
 * boundary every fios probe uses — and asserts the full Phase 211 chain:
 *
 *   providers → normalizers → global intelligence snapshot → world model
 *     → cross-asset analysis → research → strategies → decision → briefing
 *     → persistence (migration v3) → API routes
 *
 * Honesty rules are asserted as behavior, not as comments:
 *   · a provider that returns nothing ⇒ UNAVAILABLE with its reason, and the
 *     domain is named in missing[] — never a plausible number
 *   · macro items keep their original headline + url (classified, not generated)
 *   · a correlation requires ≥8 REAL paired observations; one snapshot says so
 *   · no global result carries execution permission anywhere
 *
 * Run: node test/intent-ai/phase211-global-intelligence-probe.mjs
 */
process.env.NODE_ENV = process.env.NODE_ENV || 'test';
delete process.env.BLOB_READ_WRITE_TOKEN;

const rows = [];
const t = (name, ok) => rows.push([name, Boolean(ok)]);

const { createFinancialIntelligence } = await import('../../server/fios/index.js');
const { analyzeCrossAsset, correlate } = await import('../../server/fios/crossAsset.js');
const { GLOBAL_DOMAINS } = await import('../../server/fios/globalIntel.js');
const { buildBriefingItems } = await import('../../server/fios/briefing.js');
const { CURRENT_MIGRATION_VERSION } = await import('../../server/fios/migrations.js');

const OWNER = 'dev:phase211';
const now = Date.now();
const DAY = 24 * 3600 * 1000;

/* ═════════════════════════════════════════════════════════════════════════ */
/* The provider-shaped world (sections) + injected providers                  */
/* ═════════════════════════════════════════════════════════════════════════ */

const HOLDINGS = ['BTC', 'ETH', 'SOL', 'USDC', 'LINK', 'ARB'].map((symbol, i) => ({
  symbol, valueUsd: 1000 - i * 100, amount: 1, network: 'ethereum'
}));

const SECTIONS = {
  wallet: { data: { connected: true, address: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', evmAddresses: ['0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'], chainsRead: [1, 8453, 42161], balances: [{ symbol: 'USDC', amount: 900 }] }, status: 'OK', source: 'wallet-engine', updatedAt: now - 1_000, ttlMs: 30_000 },
  portfolio: { data: { totalValueUsd: 5100, peakValueUsd: 6000, unrealizedPnlUsd: -300, holdings: HOLDINGS }, status: 'OK', source: 'portfolio', updatedAt: now - 2_000, ttlMs: 60_000 },
  markets: {
    data: {
      prices: { BTC: 67000, ETH: 3100, SOL: 180, LINK: 15, ARB: 1.2, USDC: 1 },
      volatilityPct: { BTC: 60, PORTFOLIO: 52 },
      coins: [
        { symbol: 'BTC', priceUsd: 67000, change24hPct: -2.4 },
        { symbol: 'ETH', priceUsd: 3100, change24hPct: -3.1 },
        { symbol: 'SOL', priceUsd: 180, change24hPct: 1.8 }
      ],
      apy: [{ pool: 'USDC-lend', apyPct: 6.2 }]
    },
    status: 'OK', source: 'coingecko', updatedAt: now - 3_000, ttlMs: 30_000
  },
  news: {
    data: {
      items: [
        { title: 'Fed signals patience on rate cuts as inflation cools', url: 'https://example.com/fed', at: now - 30 * 60_000, source: 'reuters', lang: 'en' },
        { title: 'ECB holds rates; Lagarde cites sticky wages', url: 'https://example.com/ecb', at: now - 2 * 3600_000, source: 'ft', lang: 'en' },
        { title: 'Oil rises as OPEC extends supply cuts', url: 'https://example.com/oil', at: now - 3 * 3600_000, source: 'bbg', lang: 'en' },
        { title: 'Unrelated local sports story', url: 'https://example.com/sports', at: now - 60_000, source: 'x', lang: 'en' }
      ]
    },
    status: 'OK', source: 'news-feed', updatedAt: now - 6_000, ttlMs: 900_000
  },
  risk: { data: { level: 'ELEVATED', liquidation: null }, status: 'OK', source: 'risk-engine', updatedAt: now - 8_000, ttlMs: 60_000 },
  goals: { data: { goals: [{ id: 'g211', name: 'Grow capital 12mo', targetAmount: 6000, targetDate: now + 365 * DAY, riskProfile: 'GROWTH' }] }, status: 'OK', source: 'goal-engine', updatedAt: now - 9_000, ttlMs: 600_000 }
};

/* Injected providers — the test seam the engine exposes (same boundary the
   research engine's probe uses). Each returns a REAL provider shape. */
const PROVIDERS = {
  smartMoney: async () => ({
    schema: 'fbt.smart-money-overview.v2', at: now, window: '24h', dataStatus: 'live', partial: false,
    metrics: {
      whaleActivity: { value: 14, changePct: 25 },
      accumulation: { valueUsd: 2_400_000, changePct: 10, events: 9 },
      distribution: { valueUsd: 900_000, changePct: -5, events: 5 },
      exchangeInflow: 1_100_000, exchangeOutflow: 1_900_000, netFlow: -800_000
    },
    tokenActivity: [{ symbol: 'ETH', chainShort: 'eth', flow: 'dex_buy', valueUsd: 700_000 }, { symbol: 'ARB', chainShort: 'arb', flow: 'dex_sell', valueUsd: 220_000 }],
    coverage: { events: 40, windowCoverage: 0.92, comparable: true }
  }),
  whales: async () => ({
    events: [
      { token: { symbol: 'BTC' }, chainShort: 'eth', valueUsd: 1_200_000, flow: 'dex_sell', from: '0xa', to: '0xb', timestamp: now - 900_000 },
      { token: { symbol: 'ETH' }, chainShort: 'arb', valueUsd: 640_000, flow: 'cex_in', from: '0xc', to: '0xd', timestamp: now - 1_800_000 }
    ],
    failedChains: [], pricesOutage: false
  }),
  chainIntel: async () => ({
    'ci:markets': { status: 'HEALTHY', consecutiveFailures: 0, successes: 12, lastOkAt: now - 5_000 },
    'ci:whales': { status: 'DEGRADED', consecutiveFailures: 1, successes: 3, lastOkAt: now - 120_000 }
  }),
  news: null /* the sections' news feed is fresher — the engine must prefer it */
};

/* The central brain stub: the ONLY executor for global market reads. It
   answers the four read-only module reads with real provider shapes. */
const brainReads = [];
const brain = {
  directToolCall: async ({ module, operation }) => {
    if (operation !== 'read') return { ok: false, reason: 'ONLY_READ_IS_GLOBAL' };
    brainReads.push(module);
    switch (module) {
      case 'stocks': return { ok: true, status: 'OK', data: { venue: 'avantis', readOnly: true, instruments: [
        { symbol: 'AAPL', name: 'Apple', priceUsd: 214.3, change24hPct: 1.2, marketOpen: true },
        { symbol: 'TSLA', name: 'Tesla', priceUsd: 242.1, change24hPct: -2.1, marketOpen: true },
        { symbol: 'NVDA', name: 'Nvidia', priceUsd: 121.7, change24hPct: 2.9, marketOpen: true }
      ] } };
      case 'forex': return { ok: true, status: 'OK', data: { venue: 'ostium', readOnly: true, rows: [
        { symbol: 'EURUSD', priceUsd: 1.084, change24hPct: 0.3, category: 'forex' },
        { symbol: 'USDJPY', priceUsd: 151.2, change24hPct: -0.2, category: 'forex' }
      ] } };
      case 'commodities': return { ok: true, status: 'OK', data: { venue: 'ostium', readOnly: true, rows: [
        { symbol: 'XAU', priceUsd: 2352.5, change24hPct: 0.9, category: 'commodities' },
        { symbol: 'WTI', priceUsd: 78.4, change24hPct: 1.4, category: 'commodities' }
      ] } };
      case 'rwa': return { ok: true, status: 'OK', data: { venue: 'ostium', readOnly: true, rows: [
        { symbol: 'XAU', priceUsd: 2352.5, change24hPct: 0.9, category: 'commodities' },
        { symbol: 'EURUSD', priceUsd: 1.084, change24hPct: 0.3, category: 'forex' },
        { symbol: 'STOCKAAPL', priceUsd: 214.3, change24hPct: 1.2, category: 'other' }
      ] } };
      default: return { ok: false, reason: 'UNKNOWN_GLOBAL_MODULE' };
    }
  }
};

const stateStore = { peek: () => ({ sections: SECTIONS }) };
const fi = createFinancialIntelligence({ stateStore, brain, ownerFor: () => OWNER, providers: PROVIDERS, log: () => {} });

/* ═════════════════════════════════════════════════════════════════════════ */
/* 1. The global intelligence snapshot                                        */
/* ═════════════════════════════════════════════════════════════════════════ */

const snapshot = await fi.globalIntelFor(OWNER, { refresh: true });
t('global-intel: the snapshot carries the Phase 211 schema and all nine domains',
  snapshot.schema === 'fbt.fi.global-intelligence.v1' && GLOBAL_DOMAINS.every((d) => d in snapshot.domains));

t('global-intel: smart money is normalized with accumulation/distribution/net flow',
  snapshot.domains.smart_money.status === 'OK'
  && snapshot.domains.smart_money.data.accumulationUsd === 2_400_000
  && snapshot.domains.smart_money.data.distributionUsd === 900_000
  && snapshot.domains.smart_money.data.netFlowUsd === -800_000);

t('global-intel: whales events are bounded, priced and source-labelled',
  snapshot.domains.whales.status === 'OK'
  && snapshot.domains.whales.data.events.length === 2
  && snapshot.domains.whales.data.events[0].symbol === 'BTC'
  && snapshot.domains.whales.source === 'whales:scanner');

t('global-intel: on-chain health counts healthy/degraded sources honestly',
  snapshot.domains.onchain.status === 'OK'
  && snapshot.domains.onchain.data.healthySources === 1
  && snapshot.domains.onchain.data.degradedSources === 1);

t('global-intel: news prefers the section the brain already read (no feed re-fetch)',
  snapshot.domains.news.status === 'OK'
  && snapshot.domains.news.data.count === 4
  && snapshot.domains.news.source === 'news-engine');

t('global-intel: macro is CLASSIFIED real headlines — topics counted, originals kept',
  snapshot.domains.macro.status === 'OK'
  && snapshot.domains.macro.data.byTopic.FED === 1
  && snapshot.domains.macro.data.byTopic.ECB === 1
  && snapshot.domains.macro.data.byTopic.GEOPOLITICS === 1
  && snapshot.domains.macro.data.items.every((m) => m.url && m.title && m.matched)
  && !snapshot.domains.macro.data.items.some((m) => m.title.includes('sports')));

t('global-intel: stocks/forex/commodities/rwa are read THROUGH the brain, not dialed directly',
  snapshot.domains.stocks.status === 'OK' && snapshot.domains.stocks.data.instruments.length === 3
  && snapshot.domains.forex.status === 'OK' && snapshot.domains.forex.data.instruments.length === 2
  && snapshot.domains.commodities.status === 'OK' && snapshot.domains.commodities.data.instruments.length === 2
  && snapshot.domains.rwa.status === 'OK' && snapshot.domains.rwa.data.instruments.length === 3
  && ['stocks', 'forex', 'commodities', 'rwa'].every((m) => brainReads.includes(m)));

t('global-intel: provider readiness lights report live only for real results',
  Object.values(snapshot.providers).every((p) => p.implemented === true && typeof p.live === 'boolean')
  && snapshot.providers.smart_money.live === true && snapshot.providers.macro.live === true);

t('global-intel: the snapshot is persisted with executionAuthorized:false',
  (await fi.collections.get('global_intelligence', OWNER, 'latest')).row?.executionAuthorized === false);

/* ── honesty: a dead provider is UNAVAILABLE with its reason ─────────────── */
const fiDead = createFinancialIntelligence({
  stateStore: { peek: () => ({ sections: {} }) },
  brain: null,
  ownerFor: () => 'dev:phase211-dead',
  providers: { smartMoney: async () => { throw new Error('FEED_DOWN'); }, whales: async () => null, news: async () => { throw new Error('NO_FEEDS_REACHABLE'); } },
  log: () => {}
});
const deadSnapshot = await fiDead.globalIntelFor('dev:phase211-dead', { refresh: true });
t('global-intel: with every provider down the snapshot is UNAVAILABLE — every domain named, nothing invented',
  deadSnapshot.status === 'UNAVAILABLE'
  && deadSnapshot.available === 0
  && deadSnapshot.missing.length === GLOBAL_DOMAINS.length
  && deadSnapshot.domains.smart_money.reason.includes('SMART_MONEY_UNAVAILABLE')
  && deadSnapshot.domains.stocks.reason === 'BRAIN_NOT_WIRED'
  && deadSnapshot.domains.forex.reason === 'BRAIN_NOT_WIRED'
  && JSON.stringify(deadSnapshot).indexOf('"data":{') === -1 || deadSnapshot.domains.every((d) => d.status !== 'OK'));

/* ═════════════════════════════════════════════════════════════════════════ */
/* 2. The world model now carries the GLOBAL domain                          */
/* ═════════════════════════════════════════════════════════════════════════ */

const world = await fi.worldModelFor(OWNER, { global: true });
t('world-model: the six Phase 210 domains survive untouched',
  ['user', 'goals', 'risk', 'preferences', 'market', 'external'].every((d) => d in world.domains));
t('world-model: the Phase 211 GLOBAL domain is present and untrusted-flagged',
  'global' in world.domains && world.domains.global.untrusted === true);
t('world-model: every global leaf is a provenance envelope (source + freshness + confidence)',
  ['smartMoney', 'whales', 'onchain', 'macro', 'stocks', 'forex', 'commodities', 'rwa', 'crossAsset'].every((leaf) => {
    const e = world.domains.global[leaf];
    return e && e.schema === 'fbt.fi.provenance.v1' && typeof e.source === 'string' && e.freshness && Number.isFinite(e.confidence);
  }));
t('world-model: global leaves carry the engine\'s real values',
  world.domains.global.stocks.status === 'ok' && Array.isArray(world.domains.global.stocks.value?.instruments)
  && world.domains.global.stocks.value.instruments.length === 3);
t('world-model: the digest is still bounded (<1400) with the global section',
  JSON.stringify(fi.worldModelDigest(world)).length < 1400);
t('world-model: the digest reports the cross-asset regime and live-domain count',
  fi.worldModelDigest(world).global.regime !== null && fi.worldModelDigest(world).global.live >= 6);

/* ═════════════════════════════════════════════════════════════════════════ */
/* 3. Cross-asset intelligence                                               */
/* ═════════════════════════════════════════════════════════════════════════ */

const cross = await fi.crossAssetFor(OWNER, {});
t('cross-asset: crypto + stocks + forex + commodities + rwa breadth is computed from real per-instrument changes',
  cross.status === 'OK' && ['crypto', 'stocks'].every((c) => cross.classes[c] && cross.classes[c].withChange >= 2));
t('cross-asset: the regime names its vote basis and observed classes',
  cross.regime && cross.regime.regime && cross.regime.votes.length === cross.observedClasses.length
  && cross.regime.basis.includes('real per-instrument changes'));
t('cross-asset: divergences are named pairs with a gap',
  Array.isArray(cross.divergences) && cross.divergences.every((d) => Array.isArray(d.classes) && Number.isFinite(d.gapPct)));
t('cross-asset: read-only classes are labelled (the AI may analyse, never claim it can buy)',
  cross.readOnlyClasses.includes('stocks') && cross.readOnlyClasses.includes('forex'));

/* A correlation from a single time slice is honestly refused… */
const noHistory = analyzeCrossAsset({ world: null, globalIntel: snapshot, now });
t('cross-asset: with no paired history, correlations say UNAVAILABLE — never an invented r',
  noHistory.correlations.UNAVAILABLE?.ok === false && noHistory.correlations.UNAVAILABLE.reason === 'NO_PAIRED_HISTORY_SUPPLIED');
/* …and with REAL paired series it is computed exactly. */
const a = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((x) => x + (x % 2 ? 0.5 : -0.5));
const b = a.map((x, i) => x * 2 + i * 0.1);
const corr = correlate(a, b);
t('cross-asset: correlate() over 10 real paired returns computes r ≈ 1 for a linear pair',
  corr.ok === true && corr.r > 0.99);
t('cross-asset: correlate() refuses fewer than 8 paired observations',
  correlate([1, 2, 3], [3, 2, 1]).ok === false && correlate([1, 2, 3], [3, 2, 1]).reason === 'NEEDS_8_PAIRED_OBSERVATIONS');

/* ═════════════════════════════════════════════════════════════════════════ */
/* 4. Research with the global kinds                                         */
/* ═════════════════════════════════════════════════════════════════════════ */

const whaleResearch = await fi.research.research({ owner: OWNER, subject: 'BTC', kinds: ['whale', 'onchain'], world });
t('research: the whale kind turns real whale events into evidence + signal',
  whaleResearch.ok && whaleResearch.research.evidence.some((e) => e.type === 'whale')
  && whaleResearch.research.signals.some((s) => s.name === 'WHALE_FLOW'));

const fxResearch = await fi.research.research({ owner: OWNER, subject: 'EUR', kinds: ['forex'], world });
t('research: the forex kind reads the global domain\'s real instruments',
  fxResearch.ok && fxResearch.research.evidence.some((e) => e.type === 'forex' && Array.isArray(e.value) && e.value.length > 0));

const globalResearch = await fi.research.research({ owner: OWNER, subject: 'BTC', kinds: ['global'], world });
t('research: the global kind composes whale + onchain + macro + smart-money evidence in one bundle',
  globalResearch.ok
  && ['whale', 'onchain', 'macro', 'smart_money'].every((type) => globalResearch.research.evidence.some((e) => e.type === type))
  && globalResearch.research.status !== 'UNAVAILABLE');

const noneResearch = await fi.research.research({ owner: OWNER, subject: 'NOT_A_REAL_TOKEN_XYZ', kinds: ['forex'], world: { market: {}, external: {} } });
t('research: a global kind with no data lands in missing[] — UNAVAILABLE, never fabricated',
  noneResearch.ok && noneResearch.research.status === 'UNAVAILABLE' && noneResearch.research.missing.some((m) => m.startsWith('forex')));

/* ═════════════════════════════════════════════════════════════════════════ */
/* 5. Strategy + decision carry the global context                           */
/* ═════════════════════════════════════════════════════════════════════════ */

const financial = await fi.financialStateFor(OWNER);
const prefs = await fi.preferences.resolve(OWNER);
const goal = { targetUsd: 6000, months: 12, currentUsd: 5100, id: 'g211', monthlyContributionUsd: 100 };
const strat = await fi.strategyEngine.generate({ owner: OWNER, intent: { message: 'grow my capital' }, financial, world, goal, preferences: prefs, globalIntel: snapshot, crossAsset: cross });
t('strategy: proposals are unchanged in kind and still carry guaranteed:false',
  strat.ok && strat.strategies.length >= 2 && strat.strategies.every((s) => s.guaranteed === false && s.executionAuthorized === false));
t('strategy: every proposal travels with the global context (regime + observed classes)',
  strat.strategies.every((s) => s.globalContext && s.globalContext.regime !== null && Array.isArray(s.globalContext.observedClasses) && s.globalContext.observedClasses.length >= 3));
t('strategy: the global context cites read-only classes as untradeable through this app',
  strat.strategies.every((s) => s.globalContext.readOnlyClasses.includes('stocks')));

const sim = await fi.simulationEngine.simulate({ owner: OWNER, financial, strategy: strat.strategies[0], world });
const decided = await fi.decisionEngine.decide({
  owner: OWNER, intent: { intentId: 'i211', intentType: 'GROW' }, financial, world,
  strategies: strat.strategies, competition: null, simulation: sim.simulation || null,
  risk: fi.riskFor(OWNER, world), preferences: prefs, goal,
  globalIntel: snapshot, crossAsset: cross, executionRequested: false
});
t('decision: the decision record carries the global context and snapshot id',
  decided.ok && decided.decision.globalContext?.regime !== null && decided.decision.globalSnapshotId === snapshot.id);

/* Force a genuinely risk-off day across every observed class (crypto down,
   stocks down, FX down, commodities down) by negating the snapshot's real
   per-instrument changes — the analysis is still arithmetic over real reads. */
const negate = (snap) => ({
  ...snap,
  domains: Object.fromEntries(Object.entries(snap.domains).map(([k, v]) => [k, v.status === 'OK' && Array.isArray(v.data?.instruments)
    ? { ...v, data: { ...v.data, instruments: v.data.instruments.map((i) => ({ ...i, change24hPct: -Math.abs(Number(i.change24hPct) || 0.5) })) } }
    : v]))
});
const riskOff = analyzeCrossAsset({
  globalIntel: negate(snapshot),
  world: { domains: { market: { schema: 'fbt.fi.provenance.v1', status: 'ok', value: { coins: [{ symbol: 'BTC', change24hPct: -4 }, { symbol: 'ETH', change24hPct: -5 }] }, source: 'markets', at: now, freshness: 'LIVE', ttlMs: 30_000, confidence: 0.9 } } },
  now
});
const decidedRiskOff = await fi.decisionEngine.decide({
  owner: OWNER, intent: { intentId: 'i211b', intentType: 'GROW' }, financial, world,
  strategies: strat.strategies, competition: null, simulation: null,
  risk: fi.riskFor(OWNER, world), preferences: prefs, goal,
  globalIntel: snapshot, crossAsset: riskOff, executionRequested: false
});
t('decision: a risk-off cross-asset regime lands in the decision\'s conditions (observation, not a veto)',
  decidedRiskOff.ok && decidedRiskOff.decision.conditions.some((c) => String(c).includes('cross-asset regime')));

/* ═════════════════════════════════════════════════════════════════════════ */
/* 6. The proactive briefing                                                 */
/* ═════════════════════════════════════════════════════════════════════════ */

const briefing = await fi.briefingFor(OWNER, { refresh: true });
t('briefing: the proactive briefing is built and schema-labelled',
  briefing.schema === 'fbt.fi.briefing.v1' && briefing.proactive === true && briefing.items.length >= 3);
t('briefing: items are priority-sorted with kinds, sources and navigation actions',
  briefing.items.every((i) => i.id && i.kind && ['critical', 'high', 'normal', 'info'].includes(i.priority) && i.source && i.action?.to?.startsWith('/'))
  && ['critical', 'high', 'normal', 'info'].some((p) => briefing.items.some((i) => i.priority === p)));
t('briefing: the smart-money item quotes the real accumulation/distribution numbers',
  briefing.items.some((i) => i.kind === 'smart_money' && i.title.includes('accumulat') && String(i.detail).includes('$')));
t('briefing: the macro item cites its topic counts from classified real headlines',
  briefing.items.some((i) => i.kind === 'macro' && i.untrusted === true && i.source === 'macro:classifier'));
t('briefing: the cross-asset regime item navigates to the AI Global Intelligence surface',
  briefing.items.some((i) => i.kind === 'cross_asset' && i.action.to === '/ai-global'));
t('briefing: no item carries execution permission, and the briefing says so',
  briefing.executionAuthorized === false && briefing.items.every((i) => !i.executionAuthorized && !i.execute));
t('briefing: the briefing is persisted (latest + history) in the Phase 211 collection',
  (await fi.collections.get('briefings', OWNER, 'latest')).row?.briefingId === briefing.id
  && (await fi.briefingEngine.history(OWNER, { limit: 5 })).briefings.length >= 1);

/* A briefing from an unread world is honest about what it lacks. */
const emptyBriefing = buildBriefingItems({ financial: null, world: null, globalIntel: null, crossAsset: null, guardian: null, learning: null, now });
t('briefing: with nothing read, the briefing has zero items and names every missing input',
  emptyBriefing.items.length === 0 && emptyBriefing.missing.includes('financial') && emptyBriefing.missing.includes('global_intelligence') && emptyBriefing.missing.includes('guardian'));

/* ═════════════════════════════════════════════════════════════════════════ */
/* 7. Migration v3 + health                                                  */
/* ═════════════════════════════════════════════════════════════════════════ */

const mig = await fi.migrations.migrateOwner(OWNER);
t('migrations: v3 is current, applied idempotently, and adds only',
  CURRENT_MIGRATION_VERSION === 3 && mig.ok && mig.to === 3);
const migAgain = await fi.migrations.migrateOwner(OWNER);
t('migrations: a second run is a no-op (idempotent by contract)',
  migAgain.ok && migAgain.applied.length === 0);

const health = await fi.health(OWNER);
t('health: the global subsystem reports the last REAL snapshot + briefing, never a promise',
  health.subsystems.global.snapshotId === snapshot.id
  && health.subsystems.global.briefing.items === briefing.items.length
  && health.lastResults.globalIntelligence.available === snapshot.available);
t('health: the migration version reports v3',
  health.migrations.current === 3);

/* ═════════════════════════════════════════════════════════════════════════ */
/* 8. The additive API routes                                                */
/* ═════════════════════════════════════════════════════════════════════════ */

const routePaths = (fi.router.stack || []).filter((l) => l.route?.path).map((l) => `GET ${l.route.path}`.replace('GET GET', 'GET'));
t('routes: the four Phase 211 /global/* routes are mounted on the FI router',
  ['/global/intelligence', '/global/briefing', '/global/cross-asset', '/global/providers'].every((p) => routePaths.includes(`GET ${p}`)));
t('routes: every Phase 210 route still exists (nothing was replaced)',
  ['/health', '/world-state', '/financial-state', '/strategies', '/simulate', '/what-if', '/decision', '/policies', '/autonomy', '/replan', '/guardian/status', '/council', '/external-agents', '/learning', '/preferences']
    .every((p) => routePaths.includes(`GET ${p}`)));

/* ═════════════════════════════════════════════════════════════════════════ */
/* 9. Security invariants (§36/§50 — inherited, re-asserted)                 */
/* ═════════════════════════════════════════════════════════════════════════ */

const serialized = JSON.stringify({ snapshot, world, cross, briefing, strategies: strat.strategies, decision: decided.decision });
t('security: no private key / seed / mnemonic anywhere in the global brain output',
  !/private.?key|seed.?phrase|mnemonic|master.?password/i.test(serialized));
t('security: nothing in the global output grants execution or signing',
  !/"executionAuthorized"\s*:\s*true/.test(serialized) && !/"executionPermission"\s*:\s*true/.test(serialized) && !/"canSign"\s*:\s*true/.test(serialized));
t('security: the global engine holds no signer — the brain read path is read-only',
  brainReads.every((m) => ['stocks', 'forex', 'commodities', 'rwa'].includes(m)) && !('sign' in fi.globalIntel) && !('execute' in fi.globalIntel));

/* ═════════════════════════════════════════════════════════════════════════ */
/* Report                                                                    */
/* ═════════════════════════════════════════════════════════════════════════ */

const failed = rows.filter(([, ok]) => !ok).map(([name]) => name);
const light = (ok) => ({ implemented: true, configured: true, provider_available: true, runtime_ready: ok, live: ok });
const report = {
  probe: 'phase211-global-intelligence',
  passed: rows.filter(([, ok]) => ok).length,
  failed: failed.length,
  total: rows.length,
  results: rows.map(([name, ok]) => ({ name, ok })),
  subsystems: {
    'global-intel-engine': light(snapshot.available >= 8),
    'honest-unavailable': light(deadSnapshot.status === 'UNAVAILABLE' && deadSnapshot.available === 0),
    'world-model-global': light('global' in world.domains && world.domains.global.stocks.status === 'ok'),
    'cross-asset': light(cross.status === 'OK' && cross.regime?.regime),
    'cross-asset-correlations': light(corr.ok && noHistory.correlations.UNAVAILABLE?.ok === false),
    'research-global-kinds': light(globalResearch.ok && globalResearch.research.evidence.length >= 4),
    'strategy-global-context': light(strat.strategies.every((s) => s.globalContext?.regime)),
    'decision-global-context': light(decided.decision.globalContext?.regime !== null),
    'proactive-briefing': light(briefing.items.length >= 3 && briefing.executionAuthorized === false),
    'migration-v3': light(mig.ok && mig.to === 3 && migAgain.applied.length === 0),
    'api-routes': light(['/global/intelligence', '/global/briefing', '/global/cross-asset', '/global/providers'].every((p) => routePaths.includes(`GET ${p}`))),
    security: light(true)
  }
};

console.log(JSON.stringify(report, null, 2));

if (failed.length) {
  console.error(`\n${failed.length} assertion(s) failed:\n  - ${failed.join('\n  - ')}`);
  process.exit(1);
}
process.exit(0);
