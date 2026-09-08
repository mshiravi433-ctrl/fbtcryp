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
import { createMigrations, CURRENT_MIGRATION_VERSION } from './migrations.js';
import { createFiRouter } from './router.js';

export const FI_ROOT_SCHEMA = 'fbt.fi.composition-root.v1';

const num = (v) => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));

export function createFinancialIntelligence({ stateStore = null, events = null, brain = null, ownerFor = null, log = () => {} } = {}) {
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
  const strategyEngine = createStrategyEngine({ collections, evidence, genome, observability, log });
  const competition = createStrategyCompetition({ collections, evidence, observability, log });
  const simulationEngine = createSimulationEngine({ collections, evidence, observability, log });
  const crossChain = createCrossChainReasoner({ evidence, observability, log });
  const decisionEngine = createDecisionEngine({ collections, evidence, traceStore, confidenceEngine, observability, log });

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

  /* ── migrations (batch 7) ────────────────────────────────────────────── */
  const migrations = createMigrations({ collections, log });

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

  /** The world model over the same sections, with the user's own inputs. */
  async function worldModelFor(owner) {
    const sections = sectionsFor(owner);
    const prefs = await preferences.resolve(owner).catch(() => null);
    const gGot = await genome.get(owner).catch(() => ({ ok: false }));
    const model = buildWorldModel({
      owner,
      sections,
      preferences: prefs || null,
      genome: gGot.ok && gGot.genome ? gGot.genome : null,
      now: now()
    });
    return model;
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
        autonomy: autonomy.capabilities()
      },
      lastResults: {
        decision: null,
        council: null
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
    crossChain,
    decisionEngine,
    policyEngine,
    guardian,
    autonomy,
    council,
    agents,
    learning,
    migrations,
    financialStateFor,
    worldModelFor,
    worldModelDigest,
    riskFor,
    health,
    sectionsFor,
    flatSectionsFor
  };

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
