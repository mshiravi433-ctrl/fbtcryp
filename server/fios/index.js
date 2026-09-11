/**
 * FBT FINANCIAL INTELLIGENCE OS — composition root (batch 7).
 * ---------------------------------------------------------------------------
 * One state store, one execution path.
 *
 * This is the ONLY place the Financial Intelligence OS is assembled. Every
 * engine below is constructed here, with the SAME collections and the SAME
 * observability, and the router is built from exactly these instances — so a
 * route cannot reach a model that differs from the one the next route reads.
 *
 * The audit's "no third gateway" rule is structural, not aspirational: the FI
 * reads the CENTRAL brain's stateStore (the sections the brain already read
 * for the user — wallet, portfolio, market, risk) and hands execution back to
 * the brain's own unsigned hand-off. FI holds no wallet, no signer, no second
 * market feed, and no key. What FI adds on top of the state store is
 * interpretation: the world model, the decision, the council, the policy, the
 * guardian — all reading the same numbers the chat quoted.
 *
 * Per-owner lazy migration runs once per owner on first touch (see
 * migrations.js); the applied version is reported on /api/ai/health.
 */
import { createCollections } from './collections.js';
import { createObservability } from './observability.js';
import { createMemory2 } from './memory.js';
import { createPreferenceModel } from './preferences.js';
import { createBehaviorModel } from './behavior.js';
import { createGenomeModel } from './genome.js';
import { createEvidenceStore } from './evidence.js';
import { createTraceStore } from './trace.js';
import { createConfidenceEngine } from './confidence.js';
import { createResearchEngine } from './research.js';
import { createStrategyEngine } from './strategy.js';
import { createStrategyCompetition } from './competition.js';
import { createSimulationEngine } from './simulation.js';
import { runWhatIf } from './simulation.js';
import { createCrossChainReasoner } from './crosschain.js';
import { createDecisionEngine } from './decision.js';
import { buildCanonicalFinancialState, snapshotRow, headline } from './financialState.js';
import { buildWorldModel, worldModelDigest } from './worldModel.js';
import { createPolicyEngine } from './policy.js';
import { createGuardian } from './guardian.js';
import { createAutonomyLoop } from './autonomy.js';
import { createCouncil } from './council.js';
import { createAgentRegistry } from './agents.js';
import { createLearningEngine } from './learning.js';
/* Phase 11 live — route simulator + smart-money intel for AI decisions. */
import { createRouteSimulator, simulateAllStrategies, riskAdjustedScore } from './routeSimulator.js';
import { fetchSmartMoneyIntel, buildSmartMoneyIntel, enrichStrategiesWithSmartMoney } from './smartMoneyIntel.js';
import { simulateRoute as phase11SimulateRoute, monitorStrategy as phase11MonitorStrategy } from '../../src/lib/intent-ai/strategyCompetition.js';
/* Phase 211 — Global AI Intelligence. */
import { createGlobalIntelEngine, GLOBAL_DOMAINS } from './globalIntel.js';
import { analyzeCrossAsset, crossAssetDigest } from './crossAsset.js';
import { crossCommentary } from './crossNarrative.js';
import { createBriefingEngine } from './briefing.js';
import { createMigrations, CURRENT_MIGRATION_VERSION } from './migrations.js';
/* Phase 212 — DEEP INTELLIGENCE (مغز تصمیم‌گیری): the macro graph, the why
 * engine, the personal profile, the evaluation loop, the domain agent
 * council, the goal scenarios, the opportunity fit, the conversation state
 * machine, the universal wallet context, the agent runtime and the
 * event-driven replanning layer. Every engine ships ON (flags.js defaults). */
import { createMacroGraphEngine, macroGraphDigest } from './macroGraph.js';
import { createWhyEngine } from './whyEngine.js';
import { createPersonalProfileEngine } from './personalProfile.js';
import { createEvaluationEngine } from './evaluation.js';
import { createAgentCouncilEngine } from './agentCouncil.js';
import { createGoalScenariosEngine } from './goalScenarios.js';
import { createOpportunityFitEngine } from './opportunityFit.js';
/* Phase 214 — Cross-Chain Route Intelligence: candidate-route ranking over
 * the real quote dimensions (cost, liquidity, time, historical success,
 * bridge risk) with per-dimension scores and an honest UNKNOWN when data
 * is missing. Phase 215 — Traditional asset classes (etf/funds/stocks/
 * forex/commodities/rwa) through the SAME opportunity contract as crypto. */
import { createRouteIntelligenceEngine } from './routeIntelligence.js';
import { createTraditionalAssetsEngine } from './traditionalAssets.js';
import { createConversationStateEngine } from './conversationState.js';
import { createWalletContextEngine } from './walletContext.js';
import { createAgentRuntime } from './agentRuntimeOps.js';
import { createEventReplanningEngine } from './eventReplanning.js';
import { reasonAboutGoal, requiredAnnualizedPct } from './goalReasoning.js';
import { fiFlags } from './flags.js';
import { createFiRouter, setLendingProvider } from './router.js';

export const FI_ROOT_SCHEMA = 'fbt.fi.composition-root.v1';

const num = (v) => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));

export function createFinancialIntelligence({ stateStore = null, events = null, brain = null, ownerFor = null, providers = {}, log = () => {} } = {}) {
  /* ── shared substrate ────────────────────────────────────────────────── */
  const collections = createCollections({ log });
  const observability = createObservability({ log });
  const now = () => Date.now();

  /* ── memory family (§7–§10) ──────────────────────────────────────────── */
  const memory = createMemory2({ collections, observability, log });
  const preferences = createPreferenceModel({ memory, observability, log });
  const behavior = createBehaviorModel({ collections, memory, observability, log });
  const genome = createGenomeModel({ collections, preferences, memory, observability, log });

  /* ── evidence + trace + confidence (§17–§19) ─────────────────────────── */
  const evidence = createEvidenceStore({ collections, observability, log });
  const traceStore = createTraceStore({ collections, observability, log });
  const confidenceEngine = createConfidenceEngine({ log });

  /* ── state interpretation (§2–§6) ────────────────────────────────────── */
  const research = createResearchEngine({ collections, evidence, observability, log });

  /* Live price series for strategy evidence (CoinGecko chart). Failures are
     swallowed inside the engine — a dead feed simply leaves volatility
     unevidenced rather than inventing candles. */
  const SYMBOL_TO_CG = Object.freeze({
    BTC: 'bitcoin', ETH: 'ethereum', SOL: 'solana', BNB: 'binancecoin',
    AVAX: 'avalanche-2', ARB: 'arbitrum', OP: 'optimism', LINK: 'chainlink',
    UNI: 'uniswap', AAVE: 'aave', MATIC: 'matic-network', POL: 'matic-network',
    DOGE: 'dogecoin', PEPE: 'pepe', USDC: 'usd-coin', USDT: 'tether'
  });
  async function livePriceSeries({ symbol = 'BTC' } = {}) {
    const sym = String(symbol || 'BTC').toUpperCase();
    const id = SYMBOL_TO_CG[sym] || String(symbol || '').toLowerCase() || 'bitcoin';
    try {
      const { fetchChart } = await import('../providers.js');
      const rows = await fetchChart(id, 30, 'usd');
      if (!Array.isArray(rows) || !rows.length) return null;
      return rows.map((r) => (typeof r === 'number' ? r : Number(r?.p))).filter(Number.isFinite);
    } catch (err) {
      log(`strategy:price-series-failed:${String(err?.message || err).slice(0, 80)}`);
      return null;
    }
  }

  const strategyEngine = createStrategyEngine({
    collections, evidence, genome, observability, log,
    priceSeries: livePriceSeries
  });
  const competition = createStrategyCompetition({ collections, evidence, observability, log });
  const simulationEngine = createSimulationEngine({ collections, evidence, observability, log });
  const crossChain = createCrossChainReasoner({ evidence, observability, log });
  const decisionEngine = createDecisionEngine({ collections, evidence, traceStore, confidenceEngine, observability, log });

  /* Phase 11 live providers — route simulator + strategy monitor. */
  async function liveSmartMoney(opts = {}) {
    return fetchSmartMoneyIntel({
      window: opts.window || '24h',
      getOverview: providers.smartMoney
        ? async ({ window }) => providers.smartMoney({ window })
        : null,
      now: now()
    });
  }

  async function liveRouteSimulate(strategies, {
    financial = null, world = null, globalIntel = null, crossAsset = null, smartMoney = null
  } = {}) {
    return simulateAllStrategies(strategies, {
      simulateRoute: phase11SimulateRoute,
      financial, world, globalIntel, crossAsset, smartMoney,
      now: now()
    });
  }

  /** Strategy monitor provider — reads last competition/decision state. */
  async function liveStrategyMonitor(strategyId) {
    /* A monitor "check" is a durable read of the last stored strategy row +
       any linked competition score. Missing rows → unavailable, never fake OK. */
    try {
      const got = await strategyEngine.get?.('system', strategyId).catch(() => null);
      /* Per-owner lookups happen at the router; here we only prove the provider
         is connected. The router supplies owner-scoped checks. */
      return {
        ok: true,
        state: got?.row || got ? 'stored' : 'no-local-row',
        evidence: [{
          source: 'strategy-monitor:runtime',
          observedAt: now(),
          sampleSize: 1,
          quality: 0.5,
          assumptions: ['monitor is read-only', 'no execution']
        }]
      };
    } catch (err) {
      return { ok: false, reason: String(err?.message || err).slice(0, 120) };
    }
  }

  /* ── the authority stack (§21–§22) ───────────────────────────────────── */
  const policyEngine = createPolicyEngine({ collections, observability, log });
  const guardian = createGuardian({ collections, observability, policyEngine, log });

  /* ── the autonomy loop, with the brain's UNSIGNED hand-off as executor ─
   * The executor is the one real wire to the execution path: it asks the
   * central brain to PREPARE the transaction through its own policy ladder,
   * and returns the unsigned hand-off. The loop then stops: nothing in this
   * process signs, and COMPLETED is unreachable without a verification id
   * that only a confirmed on-chain receipt can produce. */
  async function brainExecutor({ owner, policy, request, runId }) {
    if (!brain || typeof brain.directToolCall !== 'function') {
      return { ok: false, code: 'EXECUTOR_NOT_WIRED', detail: 'the central brain is not available to this deployment; nothing was executed' };
    }
    const kind = String(request.kind || '').toUpperCase();
    const module = kind === 'CROSS_CHAIN_CONSOLIDATE' ? 'bridge' : 'swap';
    let out;
    try {
      out = await brain.directToolCall({
        owner,
        module,
        operation: 'prepare',
        input: {
          from: request.fromAsset || null,
          to: request.asset || null,
          amountUsd: request.amountUsd,
          slippagePct: request.slippagePct ?? 0.5,
          chainId: request.chainId ?? null
        }
      });
    } catch (err) {
      return { ok: false, code: 'EXECUTOR_ERROR', detail: String(err?.message || err).slice(0, 200) };
    }
    if (!out?.ok) {
      return { ok: false, code: out?.reason || 'HANDOFF_FAILED', detail: `the brain's ${module}.prepare hand-off failed: ${out?.reason || out?.status || 'unknown'}` };
    }
    return {
      ok: true,
      detail: `unsigned hand-off produced via ${module}.prepare; the signature is the user's wallet alone`,
      handoff: { module, status: out.status, tx: out.data ?? null, runId },
      verificationId: request.verificationId || null,
      actualAmountUsd: num(request.amountUsd)
    };
  }

  const autonomy = createAutonomyLoop({ policyEngine, traceStore, confidenceEngine, guardian, executor: brainExecutor, observability, log });

  /* ── intelligence (batch 6) ──────────────────────────────────────────── */
  const council = createCouncil({ collections, competition, observability, log });
  const agents = createAgentRegistry({ collections, observability, log });
  const learning = createLearningEngine({ collections, memory, preferences, behavior, genome, observability, log });

  /* ── Phase 211: GLOBAL AI INTELLIGENCE ────────────────────────────────
   * One global intelligence engine, wired to the SAME brain the execution
   * path uses (brain.directToolCall for stocks/forex/commodities/rwa) and to
   * the provider seam the research engine established (smart money, whales,
   * chain intel, news). It reads; it never signs and never executes.
   * The cross-asset analysis is pure arithmetic over what the engine read.
   * The briefing is the proactive layer: what the OS believes the owner
   * should know before they ask. */
  const globalIntel = createGlobalIntelEngine({ collections, evidence, observability, brain, providers, log });
  const briefingEngine = createBriefingEngine({ collections, observability, log });

  /* ── migrations (batch 7) ────────────────────────────────────────────── */
  const migrations = createMigrations({ collections, log });

  /* ── Phase 212 — DEEP INTELLIGENCE ─────────────────────────────────────
   * Every engine below reads the SAME substrate (collections, the same
   * financial state the chat quotes, the same global snapshot the panel
   * shows) and holds no wallet, no signer and no second feed. All are ON by
   * default (flags.js); each can still be flipped off per deployment. */
  const macroGraph = createMacroGraphEngine({ collections, observability, log });
  const whyEngine = createWhyEngine({ collections, observability, log });
  const evaluation = createEvaluationEngine({ collections, learning, observability, log });
  const agentCouncil = createAgentCouncilEngine({ collections, observability, log });
  /* Phase 214 — the route plan is RANKING over candidate routes the quote
     step produced; it dials no provider itself (no second gateway). */
  const routeIntelligence = createRouteIntelligenceEngine({ collections, observability, log });
  /* Phase 215 — built BEFORE goalScenarios: the multi-class hook below
     allocates through this engine. */
  const traditionalAssets = createTraditionalAssetsEngine({ collections, observability, log });
  const goalScenarios = createGoalScenariosEngine({
    collections, observability, log,
    /* Phase 215 — the goal scenarios now carry a multi-class allocation
       (stable/stocks/commodities/crypto) alongside the crypto ones; a
       failure here is logged and the crypto scenarios stand on their own. */
    multiClassFor: (owner, { financial, goal }) => multiClassFor(owner, { financial, goal })
  });
  const opportunityFit = createOpportunityFitEngine({ collections, observability, log });
  const conversationState = createConversationStateEngine({ collections, observability, log });
  const agentRuntime = createAgentRuntime({ collections, registry: agents, observability, log });

  /* The personal profile needs the readers defined further down
     (financialStateFor), so it is constructed after them — see below. */
  let personalProfile = null;
  let walletContext = null;
  let eventReplanning = null;

  /* ── shared readers: the sections provider is the brain's state ──────── */
  /** The raw sections the brain already read for this owner. */
  const sectionsFor = (owner) => (stateStore?.peek?.(owner)?.sections ?? stateStore?.peek?.(owner) ?? {});

  /** Canonical financial state straight from the state store, persisted as
   *  the guardian's baseline row. UNAVAILABLE is an honest result, not an
   *  error — the panel says "unread", it never says zero. */
  async function financialStateFor(owner) {
    const sections = sectionsFor(owner);
    const financial = buildCanonicalFinancialState({ owner, sections, now: now() });
    if (financial.status !== 'UNAVAILABLE') {
      /* The guardian's baseline: ONE pinned row per owner (id 'snapshot'),
         the same shape guardian.check writes after a pass. A read of the
         financial state therefore also arms the monitor, and the status
         endpoint's lastCheckAt is the last real read, not a promise. */
      const at = financial.at;
      const row = { id: 'snapshot', at, values: snapshotRow(financial), headline: headline(financial) };
      await collections.put('financial_state', owner, row, { idKey: 'id' }).catch(() => {});
    }
    return financial;
  }

  /* ── Phase 212 — the deep-intelligence readers, on the SAME sections ─── */

  /** The macro graph for one owner: global snapshot + world model + state. */
  async function macroGraphFor(owner, { refresh = false } = {}) {
    const [globalSnapshot, world, financial] = await Promise.all([
      globalIntelFor(owner, { refresh }).catch(() => null),
      worldModelFor(owner, { global: true }).catch(() => null),
      financialStateFor(owner).catch(() => null)
    ]);
    return macroGraph.graphFor(owner, {
      globalIntel: globalSnapshot,
      world,
      financial: financial && financial.status !== 'UNAVAILABLE' ? financial : null
    });
  }

  /* Engines that need the readers above: profile, wallet context, replanning. */
  personalProfile = createPersonalProfileEngine({
    collections, preferences, behavior, genome, memory, decisionEngine,
    learning, evaluation, financialStateFor, observability, log
  });
  walletContext = createWalletContextEngine({ collections, sectionsFor, observability, log });
  eventReplanning = createEventReplanningEngine({
    bus: events, collections, observability,
    macroGraphFor: (owner) => macroGraphFor(owner).catch(() => null),
    financialStateFor,
    riskFor: (owner) => riskFor(owner),
    agentCouncilConvene: (owner, context) => agentCouncil.convene(owner, context).catch(() => ({ ok: false })),
    guardianCheck: (owner) => guardian.check(owner).catch(() => null),
    log
  });
  /* Attach the AI to the central event bus the moment the FI is built —
   * the bus becomes the spine, exactly as the owner drew it. */
  eventReplanning.subscribe();

  /** Flat section DATA (not the envelopes) — the shape the scenario engine
   *  and the risk engine read (portfolio.holdings, lending.positions, …). */
  const flatSectionsFor = (owner) => {
    const sections = sectionsFor(owner) || {};
    const out = {};
    for (const [key, section] of Object.entries(sections)) {
      if (section && typeof section === 'object' && 'data' in section) out[key] = section.data;
      else if (section && typeof section === 'object') out[key] = section;
    }
    return out;
  };

  /** The world model over the same sections, with the user's own inputs.
   *  Phase 211: the model now also carries the GLOBAL domain — filled from
   *  the Global Intelligence Engine's cached snapshot (TTL-bounded, so a
   *  world-model read does not re-dial providers) and the cross-asset
   *  analysis computed from it. `global: false` keeps the Phase 210 shape
   *  exactly (a pure sections read) for callers that want no global pass. */
  async function worldModelFor(owner, { global = true } = {}) {
    const sections = sectionsFor(owner);
    const prefs = await preferences.resolve(owner).catch(() => null);
    const gGot = await genome.get(owner).catch(() => ({ ok: false }));
    let globalSnapshot = null;
    let crossAssetOut = null;
    if (global) {
      globalSnapshot = await globalIntelFor(owner).catch(() => null);
      if (globalSnapshot && globalSnapshot.status !== 'UNAVAILABLE') {
        /* Phase 211.2 — the same ACTIVE inputs the cross-asset route uses:
           the brain's crypto read when the section is empty, and the named
           macro-desk fallbacks when a class's own feed did not answer. */
        const inputs = await crossInputsFor(owner, { globalSnapshot, sections }).catch(() => null);
        crossAssetOut = inputs ? analyzeCrossAsset(inputs) : null;
      }
    }
    const model = buildWorldModel({
      owner,
      sections,
      preferences: prefs || null,
      genome: gGot.ok && gGot.genome ? gGot.genome : null,
      globalIntel: globalSnapshot,
      crossAsset: crossAssetOut,
      now: now()
    });
    return model;
  }

  /** Phase 211 — the raw global sections shape crossAsset expects (pure). */
  function envOf(sections, keys) {
    for (const key of keys) {
      const s = sections?.[key];
      if (s && typeof s === 'object' && s.data != null) {
        return { schema: 'fbt.fi.provenance.v1', status: 'ok', value: s.data, source: s.source || key, at: s.updatedAt || now(), freshness: 'LIVE', ttlMs: s.ttlMs || 60_000, confidence: 0.9 };
      }
    }
    return { schema: 'fbt.fi.provenance.v1', status: 'unavailable', value: null, reason: 'UNREAD', source: keys.join('|'), at: now(), freshnessMs: 0, freshness: 'UNAVAILABLE', ttlMs: 0, confidence: 0, note: null };
  }

  /* ── Phase 211.2 — THE ACTIVE CROSS-ASSET READ ─────────────────────────
   * Before this block the cross-asset engine only DIGESTED whatever the
   * state store and the global snapshot already held — so a fresh owner (no
   * markets section yet) and a deployment whose Avantis/Ostium feeds are
   * blocked saw ALL five classes «unread» and the cross tab permanently
   * empty. Three fixes, all still inside the no-second-gateway rule:
   *
   *   1. crypto: when the state store has no market section, the brain's
   *      `crypto.read` answers (module `crypto` — the same guarded market
   *      source chat uses) and the section is written back for every later
   *      reader. The market domain shape stays exactly what crossAsset
   *      already parsed (symbols array OR prices/changes24hPct maps).
   *   2. stocks/forex/commodities: when a class's brain feed answered
   *      nothing, the macro desk's REAL daily series (stooq → yahoo — SPX,
   *      DXY, GOLD, WTI) stand in as named fallbacks. Narrower, real, and
   *      labelled on the class (`fallbackSource`) — never passed off as the
   *      primary feed. rwa has no honest fallback and stays missing.
   *   3. the AI commentary (crossNarrative.js) synthesizes the bounded
   *      digest over the ONE gateway — with no external provider configured
   *      it says NO_AI_PROVIDER and the screen keeps the local narrative.
   */

  /** The market domain for cross-asset: the state store's section, else the
   *  brain's crypto read (which also warms the section for the OWNER).
   *  A short per-owner cache (30s) bounds the upstream cost: a dead market
   *  feed must not re-dial on every world-model build and cross-asset poll. */
  const marketReadCache = new Map(); // owner → { at, world }
  async function marketDomainFor(owner, sections) {
    const sectionEnv = envOf(sections, ['markets', 'crypto', 'signals']);
    if (sectionEnv?.value != null) {
      marketReadCache.delete(owner); /* the section answers — drop any failure memo */
      return { world: { domains: { market: sectionEnv } } };
    }
    const hit = marketReadCache.get(owner);
    if (hit && now() - hit.at < 30_000) return { world: hit.world };
    let world = { domains: { market: sectionEnv } };
    if (brain && typeof brain.directToolCall === 'function') {
      try {
        const out = await brain.directToolCall({ owner, module: 'crypto', operation: 'read', input: {} });
        if (out?.ok && out?.data != null) {
          world = {
            domains: {
              market: {
                schema: 'fbt.fi.provenance.v1', status: 'ok', value: out.data,
                source: 'brain:crypto', at: now(), freshness: 'LIVE', ttlMs: 60_000, confidence: 0.85
              }
            }
          };
        }
      } catch { /* the class stays honestly missing — no invented market */ }
    }
    marketReadCache.set(owner, { at: now(), world });
    return { world };
  }

  /** Per-class REAL fallback instruments from the macro desk, for the global
   *  classes whose own feed did not answer this pass. The macro-desk cache is
   *  GLOBAL (quotes are owner-independent) and also memoises FAILURE for 60s:
   *  a fully offline deployment pays the dead-upstream cost once a minute,
   *  not on every poll. */
  let macroFallbackMemo = null; // { at, value }
  async function macroFallbacksFor(globalSnapshot) {
    const domains = globalSnapshot?.domains || {};
    const needFallback = ['stocks', 'forex', 'commodities', 'rwa'].some((cls) => !domains[cls] || domains[cls].status !== 'OK');
    if (!needFallback) return null;
    if (macroFallbackMemo && now() - macroFallbackMemo.at < 60_000) return macroFallbackMemo.value;
    let quotes = null;
    const macroData = domains.macro;
    if (macroData?.status === 'OK' && Array.isArray(macroData?.data?.instruments) && macroData.data.instruments.length) {
      quotes = macroData.data.instruments; /* the SAME pass's macro read — no second upstream call */
    } else {
      try {
        const mod = await import('../macroData.js');
        const out = await mod.fetchMacroQuotes();
        quotes = Array.isArray(out?.items) ? out.items : [];
      } catch { quotes = null; }
    }
    let value = null;
    if (Array.isArray(quotes) && quotes.length) {
      const rowsFor = (kinds) => quotes
        .filter((q) => kinds.includes(String(q?.kind || '')) && (q?.change1dPct ?? q?.change24hPct) != null)
        .map((q) => ({ symbol: q.symbol, priceUsd: q.priceUsd, change24hPct: q.change1dPct ?? q.change24hPct, qsource: q.source }));
      const fallback = (rows) => (rows.length ? { instruments: rows, source: `macroData:${String(rows[0].qsource || 'stooq').split(':')[0]}` } : null);
      const stocks = fallback(rowsFor(['equity']));
      const forex = fallback(rowsFor(['currency']));
      const commodities = fallback(rowsFor(['safe_haven', 'energy']));
      value = Object.fromEntries([['stocks', stocks], ['forex', forex], ['commodities', commodities]].filter(([, v]) => v));
      if (!Object.keys(value).length) value = null;
    }
    macroFallbackMemo = { at: now(), value };
    return value;
  }

  /** The shared cross-asset inputs: world (market domain, active read) +
   *  global snapshot + named macro-desk fallbacks. */
  async function crossInputsFor(owner, { globalSnapshot = null, refresh = false, sections = null } = {}) {
    const secs = sections || sectionsFor(owner);
    const snapshot = globalSnapshot || await globalIntelFor(owner, { refresh }).catch(() => null);
    const { world } = await marketDomainFor(owner, secs);
    const fallbacks = snapshot ? await macroFallbacksFor(snapshot) : null;
    return { world, globalIntel: snapshot, fallbacks, now: now() };
  }

  /** Phase 211 — the global intelligence snapshot for one owner (cached). */
  async function globalIntelFor(owner, { refresh = false } = {}) {
    return globalIntel.snapshotFor(owner, { sections: sectionsFor(owner), refresh });
  }

  /** Phase 215 — the goal-scenarios multi-class hook: discover the
   *  traditional classes through the SAME global snapshot, allocate the
   *  owner's capital across the four sleeves. `financial.net.netWorthUsd`
   *  is the capital read (the SAME number the chat quoted — no second
   *  feed); a missing read is NO_CAPITAL_READ, never a default. */
  async function multiClassFor(owner, { financial = null, goal = null } = {}) {
    try {
      const prefs = await preferences.resolve(owner).catch(() => null);
      const riskTolerance = prefs?.riskTolerance || goal?.riskTolerance || 'MODERATE';
      const globalSnapshot = await globalIntelFor(owner).catch(() => null);
      const disc = await traditionalAssets.discover(owner, {
        globalSnapshot: globalSnapshot && globalSnapshot.status !== 'UNAVAILABLE' ? globalSnapshot : null,
        persist: false
      });
      if (!disc?.ok || !disc.result?.count) {
        return { ok: false, code: 'NO_TRADITIONAL_OPPORTUNITIES', detail: 'no readable traditional feed in this pass — the crypto scenarios stand alone' };
      }
      const capital = num(financial?.net?.netWorthUsd);
      return await traditionalAssets.allocateFor(owner, {
        capitalUsd: capital,
        riskTolerance,
        goal,
        opportunities: disc.result.opportunities,
        financial: financial && financial.status !== 'UNAVAILABLE' ? financial : null
      });
    } catch (err) {
      log(`goal-scenarios:multi-class-failed:${String(err?.message || err).slice(0, 80)}`);
      return { ok: false, code: 'MULTICLASS_FAILED', detail: String(err?.message || err).slice(0, 120) };
    }
  }

  /** Phase 211 — cross-asset analysis over the world + global snapshot.
   *  Phase 211.2 — ACTIVE: reads the market through the brain when the state
   *  store is empty, stands the macro desk in for dead class feeds, and
   *  attaches the AI commentary (language-aware, cached, `untrusted`). */
  async function crossAssetFor(owner, { refresh = false, language = 'fa' } = {}) {
    const inputs = await crossInputsFor(owner, { refresh });
    const analysis = analyzeCrossAsset(inputs);
    /* The commentary never breaks the analysis: any failure inside it is
       already an honest status object, and this catch is belt-and-braces. */
    const commentary = await crossCommentary({ analysis, language }).catch(() => null);
    return { ...analysis, commentary: commentary || null };
  }

  /** Phase 211 — the proactive briefing: everything the OS actually read,
   *  prioritized. Cached with a TTL; `refresh` forces a rebuild. Every input
   *  is a REAL read of this pass (the global snapshot comes from the same
   *  cached engine pass the world model used — no second provider round). */
  async function briefingFor(owner, { refresh = false } = {}) {
    const [financial, world, guardianStatus, calibration, prefs, globalSnapshot] = await Promise.all([
      financialStateFor(owner).catch(() => null),
      worldModelFor(owner, { global: true }).catch(() => null),
      guardian.status(owner).catch(() => null),
      learning.calibration(owner).catch(() => null),
      preferences.resolve(owner).catch(() => null),
      globalIntelFor(owner).catch(() => null)
    ]);
    return briefingEngine.briefingFor(owner, {
      financial: financial && financial.status !== 'UNAVAILABLE' ? financial : null,
      world,
      globalIntel: globalSnapshot,
      crossAsset: world?.domains?.global?.crossAsset?.value || null,
      guardian: guardianStatus,
      learning: calibration,
      preferences: prefs
    }, { refresh });
  }

  /** The risk view the decision + confidence engines consume. */
  function riskFor(owner, world = null) {
    const riskSection = stateStore?.peek?.(owner)?.sections?.risk?.data ?? null;
    /* The central risk engine's verdict field is `level`. */
    const level = riskSection?.level || riskSection?.riskLevel || world?.risk?.assessment?.riskLevel || null;
    return {
      level: level ? String(level).toUpperCase() : null,
      securitySignals: Array.isArray(riskSection?.securitySignals) ? riskSection.securitySignals : []
    };
  }

  /* ── the health view: flags + last REAL results, never a promise ─────── */
  async function health(owner) {
    const mig = await migrations.status(owner);
    const policyStatus = await policyEngine.status(owner).catch(() => null);
    const guardianStatus = await guardian.status(owner).catch(() => null);
    const cal = await learning.calibration(owner).catch(() => null);
    const sections = sectionsFor(owner);
    const sectionKeys = Object.keys(sections || {});
    /* Phase 211 — the global subsystem reports the LAST persisted snapshot
       (the last REAL provider results), never a promise about the next one. */
    const lastGlobal = await globalIntel.lastSnapshot(owner).catch(() => null);
    const lastBriefing = await briefingEngine.lastBriefing(owner).catch(() => null);
    return {
      ok: true,
      schema: FI_ROOT_SCHEMA,
      financialIntelligence: FI_ROOT_SCHEMA,
      durable: collections.durable(),
      migrations: mig,
      flags: {
        autonomousPolicy: policyStatus?.flag?.ok ?? null,
        learning: cal?.ok !== false,
        current: CURRENT_MIGRATION_VERSION
      },
      state: {
        sectionsReadable: sectionKeys.length,
        sections: sectionKeys,
        financial: financialStatusOnly(sections)
      },
      subsystems: {
        policy: policyStatus ? { enabled: policyStatus.flag?.ok, count: policyStatus.count, anyEmergency: policyStatus.anyEmergency } : null,
        guardian: guardianStatus ? { lastCheckAt: guardianStatus.lastCheckAt, recentAlerts: guardianStatus.recentAlerts?.length || 0, anyEmergency: guardianStatus.policies?.anyEmergency ?? null } : null,
        learning: cal ? { samples: cal.samples, directionHitRate: cal.directionHitRate } : null,
        autonomy: autonomy.capabilities(),
        /* Phase 212 — the deep-intelligence engines, each reporting its flag
           and its own last-real-result surface (never a promise). */
        deepIntelligence: {
          macroGraph: Boolean(macroGraph),
          whyEngine: Boolean(whyEngine),
          personalProfile: Boolean(personalProfile),
          evaluation: Boolean(evaluation),
          agentCouncil: Boolean(agentCouncil),
          goalScenarios: Boolean(goalScenarios),
          opportunityFit: Boolean(opportunityFit),
          conversationState: Boolean(conversationState),
          walletContext: Boolean(walletContext),
          agentRuntime: Boolean(agentRuntime),
          eventReplanning: Boolean(eventReplanning),
          eventBusAttached: Boolean(eventReplanning && eventReplanning.subscribe),
          /* Phase 214/215 — the new deep engines report their flag state
             from the SAME flags endpoint. */
          routeIntelligence: Boolean(routeIntelligence),
          traditionalAssets: Boolean(traditionalAssets),
          flags: fiFlags(),
          executionPermission: false
        },
        global: lastGlobal ? {
          snapshotId: lastGlobal.snapshotId || lastGlobal.id,
          at: lastGlobal.at,
          available: lastGlobal.available,
          coverage: lastGlobal.coverage,
          domains: Object.fromEntries(Object.entries(lastGlobal.providers || {}).map(([k, v]) => [k, { live: v.live, status: v.status }])),
          briefing: lastBriefing ? { id: lastBriefing.id, at: lastBriefing.at, items: lastBriefing.items?.length || 0, critical: lastBriefing.counts?.critical || 0 } : null
        } : { snapshotId: null, at: null, available: 0, coverage: 0, domains: {}, briefing: lastBriefing ? { id: lastBriefing.id, at: lastBriefing.at, items: lastBriefing.items?.length || 0, critical: lastBriefing.counts?.critical || 0 } : null }
      },
      lastResults: {
        decision: null,
        council: null,
        globalIntelligence: lastGlobal ? { id: lastGlobal.snapshotId || lastGlobal.id, at: lastGlobal.at, available: lastGlobal.available, missing: lastGlobal.missing || [] } : null,
        briefing: lastBriefing ? { id: lastBriefing.briefingId || lastBriefing.id, at: lastBriefing.at, items: lastBriefing.items?.length || 0 } : null
      }
    };
  }

  const fi = {
    schema: FI_ROOT_SCHEMA,
    collections,
    observability,
    memory,
    preferences,
    behavior,
    genome,
    evidence,
    traceStore,
    confidenceEngine,
    research,
    strategyEngine,
    competition,
    simulationEngine,
    runWhatIf,
    /* Phase 11 live runtime */
    routeSimulator: { create: createRouteSimulator, simulateAll: liveRouteSimulate, riskAdjustedScore, simulateRoute: phase11SimulateRoute },
    strategyMonitor: { monitor: liveStrategyMonitor, monitorStrategy: phase11MonitorStrategy },
    smartMoneyIntel: { fetch: liveSmartMoney, build: buildSmartMoneyIntel, enrich: enrichStrategiesWithSmartMoney },
    crossChain,
    decisionEngine,
    policyEngine,
    guardian,
    autonomy,
    council,
    agents,
    learning,
    migrations,
    /* Phase 211 — Global AI Intelligence. */
    globalIntel,
    briefingEngine,
    crossAsset: { analyze: analyzeCrossAsset, digest: crossAssetDigest },
    globalIntelFor,
    crossAssetFor,
    briefingFor,
    financialStateFor,
    worldModelFor,
    worldModelDigest,
    riskFor,
    health,
    sectionsFor,
    flatSectionsFor,
    /* Phase 212 — Deep Intelligence. */
    macroGraph,
    macroGraphFor,
    macroGraphDigest,
    whyEngine,
    personalProfile,
    evaluation,
    agentCouncil,
    goalScenarios,
    opportunityFit,
    conversationState,
    walletContext,
    agentRuntime,
    eventReplanning,
    goalReasoning: { reason: reasonAboutGoal, requiredAnnualizedPct },
    /* Phase 214/215 — the new deep engines + the multi-class hook the
       goal-scenarios engine consumes. */
    routeIntelligence,
    traditionalAssets,
    multiClassFor
  };

  /* Phase 216 — hand the optional server-side on-chain provider (a node RPC
     in a lending deployment; null for a wallet-less server) to the router so
     /deep/lending/quote can read for real when one is wired. */
  setLendingProvider(providers?.lending || null);

  const router = createFiRouter({ fi, ownerFor, stateStore, brain, events, log });
  fi.router = router;
  return fi;
}

/** The honest one-liner for /health: which financial inputs are readable
 *  right now, without shipping the numbers themselves. */
function financialStatusOnly(sections = {}) {
  const wallet = sections.wallet;
  const portfolio = sections.portfolio;
  return {
    wallet: wallet?.data != null ? wallet.status || 'OK' : 'UNREAD',
    portfolio: portfolio?.data != null ? portfolio.status || 'OK' : 'UNREAD'
  };
}

/* Singleton for app.js, mirroring the other server modules. */
let singleton = null;
export function financialIntelligence(options = {}) {
  if (!singleton) singleton = createFinancialIntelligence(options);
  return singleton;
}

export { worldModelDigest };
export default createFinancialIntelligence;
