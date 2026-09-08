/**
 * FBT FINANCIAL INTELLIGENCE OS — Intent Genome (§10).
 * ---------------------------------------------------------------------------
 * One structured, queryable record per user:
 *
 *   { goals, riskProfile, preferredAssets, preferredChains, preferredStrategies,
 *     rejectedStrategies, executionPreferences, behavioralPatterns, confidence }
 *
 * The 0-100 dimension vector is NOT re-implemented: `src/lib/intent-ai/
 * intentGenome.js` already defines the dimensions, DNA matching and bounded
 * evolution, and its probe (phase14) pins them. This module gives that vector
 * a home: it builds the genome from the preference model + behaviour signals +
 * goals, persists it per owner, and answers queries the strategy layer uses to
 * rank candidates ("would this user take a leveraged yield route?").
 *
 * `executionPermission` is always false here. A genome is a description of a
 * person, not a grant (§50).
 */
import { createIntentGenome, matchIntentDNA, evolveIntentGenome, rejectSecretGenomeInput, GENOME_DIMENSIONS } from '../../src/lib/intent-ai/intentGenome.js';

export const GENOME_RECORD_SCHEMA = 'fbt.fi.intent-genome-record.v1';
const ROW_ID = 'genome-v1';

/** Map a resolved preference onto the 0-100 dimension vector. */
export function dimensionsFrom({ preferences = {}, behavior = {}, goals = [] } = {}) {
  const riskMap = { CONSERVATIVE: 20, MODERATE: 45, GROWTH: 70, AGGRESSIVE: 90 };
  const levMap = { NONE: 5, LOW: 30, MODERATE: 60, HIGH: 85 };
  const feeMap = { HIGH: 85, NORMAL: 50, LOW: 20 };
  const horizonMap = { SHORT: 20, MEDIUM: 50, LONG: 85 };
  const styleMap = { MANUAL: 10, CONFIRM_EACH: 30, DCA: 60, AUTONOMOUS_WITHIN_POLICY: 85 };
  const signals = behavior?.signals || {};
  return {
    riskTolerance: riskMap[String(preferences.riskTolerance || '').toUpperCase()]
      ?? (signals.REJECTS_HIGH_RISK_PROTOCOLS ? 25 : 50),
    timeHorizon: horizonMap[String(preferences.investmentHorizon || '').toUpperCase()] ?? 50,
    liquidityNeed: Number.isFinite(Number(preferences.slippageTolerancePct)) ? Math.round(Math.max(10, 90 - preferences.slippageTolerancePct * 12)) : 50,
    feeSensitivity: feeMap[String(preferences.feeSensitivity || '').toUpperCase()] ?? (signals.PREFERS_LOW_FEE_ROUTES ? 80 : 50),
    drawdownTolerance: riskMap[String(preferences.riskTolerance || '').toUpperCase()] ?? 50,
    automationPreference: styleMap[String(preferences.preferredExecutionStyle || '').toUpperCase()] ?? 30,
    privacyPreference: 50
  };
}

export function createGenomeModel({ collections, preferences, memory = null, observability = null, log = () => {}, now = () => Date.now() } = {}) {
  async function load(owner) {
    const { ok, rows, code } = await collections.read('intent_genome', owner);
    if (!ok) return { ok: false, code, row: null };
    return { ok: true, row: rows.find((r) => r?.id === ROW_ID) || null };
  }

  /** Rebuild from live inputs. Explicit preferences dominate by construction,
   *  because they are what the preference model already resolved. */
  async function rebuild(owner, { goals = [], correlationId = null } = {}) {
    const prefs = await preferences.resolve(owner);
    const behavior = memory ? { signals: (await memory.recall(owner, { store: 'behavior' })).rows.behavior || {} } : { signals: {} };
    const behaviorSignals = (await (collections.read('behavior_signals', owner))).rows?.find((r) => r?.id === 'behavior-v1')?.signals || {};
    const dims = dimensionsFrom({ preferences: prefs, behavior: { signals: behaviorSignals }, goals });
    const secretCheck = rejectSecretGenomeInput(dims);
    if (!secretCheck.ok) return { ok: false, code: secretCheck.code };
    const vector = createIntentGenome({ values: dims, source: 'preference-model+behavior', evidence: prefs.known.map((k) => `${k}:${prefs.origins[k]}`) });

    const preferredStrategies = [];
    const rejectedStrategies = [];
    if (prefs.preferredExecutionStyle === 'DCA' || behaviorSignals.PREFERS_DCA) preferredStrategies.push('DCA');
    if (prefs.leverageTolerance === 'NONE' || behaviorSignals.REJECTS_LEVERAGE) rejectedStrategies.push('LEVERAGED_YIELD', 'PERP_DIRECTIONAL');
    if (prefs.riskTolerance === 'CONSERVATIVE' || behaviorSignals.REJECTS_HIGH_RISK_PROTOCOLS) rejectedStrategies.push('NEW_PROTOCOL_YIELD');
    if (prefs.feeSensitivity === 'HIGH' || behaviorSignals.PREFERS_LOW_FEE_ROUTES) preferredStrategies.push('LOW_FEE_ROUTE');
    if (behaviorSignals.USES_CROSS_CHAIN_OFTEN) preferredStrategies.push('CROSS_CHAIN_ARBITRAGE');

    const row = {
      schema: GENOME_RECORD_SCHEMA,
      id: ROW_ID,
      owner,
      vector,
      goals: (Array.isArray(goals) ? goals : []).slice(0, 12).map((g) => ({ id: String(g.id || '').slice(0, 40), name: String(g.name || '').slice(0, 60), targetAmount: Number(g.targetAmount) || null, riskProfile: g.riskProfile || null })),
      riskProfile: {
        level: prefs.riskTolerance,
        origin: prefs.origins.riskTolerance,
        confidence: prefs.confidence.riskTolerance || 0
      },
      preferredAssets: Array.isArray(prefs.preferredAssets) ? prefs.preferredAssets : [],
      preferredChains: Array.isArray(prefs.preferredChains) ? prefs.preferredChains : [],
      preferredStrategies,
      rejectedStrategies,
      executionPreferences: {
        style: prefs.preferredExecutionStyle,
        slippageTolerancePct: prefs.slippageTolerancePct,
        feeSensitivity: prefs.feeSensitivity,
        tradingFrequency: prefs.tradingFrequency
      },
      behavioralPatterns: Object.entries(behaviorSignals).map(([name, s]) => ({ name, samples: s.samples, ratio: s.ratio })),
      confidence: {
        overall: Number(((prefs.coverage * 0.6) + (Object.keys(behaviorSignals).length ? 0.25 : 0) + ((Array.isArray(goals) && goals.length) ? 0.15 : 0)).toFixed(3)),
        byKey: prefs.confidence,
        samples: Object.values(behaviorSignals).reduce((a, s) => a + (s.samples || 0), 0)
      },
      executionPermission: false,
      updatedAt: now()
    };
    const res = await collections.put('intent_genome', owner, row);
    if (observability) observability.emit({ type: 'learning.completed', owner, correlationId, payload: { engine: 'genome', dimensions: GENOME_DIMENSIONS.length } });
    return { ok: true, genome: row, durable: res.durable ?? collections.durable() };
  }

  async function get(owner) {
    const loaded = await load(owner);
    if (!loaded.ok) return { ok: false, code: loaded.code, genome: null };
    if (!loaded.row) return { ok: true, genome: null, code: 'GENOME_NOT_BUILT' };
    return { ok: true, genome: loaded.row };
  }

  /** §10 "queryable by the AI": does this user's genome fit a candidate? */
  async function fit(owner, candidate = {}) {
    const loaded = await get(owner);
    if (!loaded.ok || !loaded.genome) return { ok: false, code: loaded.code || 'GENOME_NOT_BUILT', score: null };
    const g = loaded.genome;
    const kind = String(candidate.kind || candidate.strategyKind || '').toUpperCase();
    const dna = matchIntentDNA(g.vector, candidate.vector || {});
    const rejected = kind && g.rejectedStrategies.includes(kind);
    const preferred = kind && g.preferredStrategies.includes(kind);
    return {
      ok: true,
      kind: kind || null,
      dnaScore: dna.score,
      dnaInterpretation: dna.interpretation,
      preferred: Boolean(preferred),
      rejected: Boolean(rejected),
      /* A rejected strategy is not "scored down", it is refused: the user told
         us, or their verified history did, and that outranks a score. */
      verdict: rejected ? 'REJECTED_BY_GENOME' : preferred ? 'PREFERRED_BY_GENOME' : dna.score >= 70 ? 'GOOD_FIT' : dna.score >= 50 ? 'MIXED_FIT' : 'WEAK_FIT',
      confidence: g.confidence.overall,
      neverGuaranteesOutcome: true,
      executionPermission: false
    };
  }

  /** Bounded evolution from explicit feedback (accept/reject a proposal). */
  async function evolve(owner, feedback = {}, { correlationId = null } = {}) {
    const loaded = await get(owner);
    if (!loaded.ok || !loaded.genome) return { ok: false, code: loaded.code || 'GENOME_NOT_BUILT' };
    const out = evolveIntentGenome(loaded.genome.vector, feedback);
    if (!out.ok) return { ok: false, code: out.code };
    const row = { ...loaded.genome, vector: out.genome, updatedAt: now() };
    const res = await collections.put('intent_genome', owner, row);
    /* Behaviour memory gets the same fact, so the two stores cannot drift. */
    if (memory && feedback.dimension === 'automationPreference') {
      await memory.remember(owner, { key: 'preferredExecutionStyle', value: feedback.accepted ? 'AUTONOMOUS_WITHIN_POLICY' : 'CONFIRM_EACH', provenance: 'USER_SAID', note: 'genome feedback', correlationId });
    }
    return { ok: true, genome: row, changedDimension: out.changedDimension, accessChanged: false, durable: res.durable ?? collections.durable() };
  }

  return { schema: GENOME_RECORD_SCHEMA, rebuild, get, fit, evolve, dimensionsFrom, GENOME_DIMENSIONS };
}
