/**
 * FBT FINANCIAL INTELLIGENCE OS — Learning Engine (batch 6).
 * ---------------------------------------------------------------------------
 * Learning happens AFTER a verified completion — never on a claim, never on
 * a pending fill, never on what a provider "says". One verified execution
 * fans out into the four memory systems, each through the channel it already
 * owns (so there is one rule, enforced in one place: VERIFIED OR NOTHING):
 *
 *   memory.recordOutcome     the strategy-outcome store (§7)
 *   preferences.learnFromOutcome   fee sensitivity / slippage / style (§8)
 *   behavior.ingest          the behaviour model (EXECUTION_CONFIRMED) (§9)
 *   genome.evolve            bounded dimension evolution (§10)
 *
 * and leaves ONE persisted row in `learning_outcomes` naming exactly what it
 * changed — the lessons — plus the prediction-vs-actual pair the calibration
 * view is computed from. A run that changed nothing (e.g. the genome was not
 * built yet) says so; it does not invent a lesson to look productive.
 *
 * WHAT LEARNING NEVER DOES
 *  - grants execution permission (every row carries grantsExecution: false;
 *    authority is the policy engine's and the user's — see policy.js)
 *  - learns from unverified outcomes (the first gate refuses and stops)
 *  - overwrites a stated preference (the preference model's own
 *    WOULD_DOWNGRADE_MEMORY rule applies — a verified fill is evidence,
 *    not an owner)
 *
 * CALIBRATION
 * Each verified outcome with a prior expectation produces an
 * (expected, actual) return pair. `calibration()` reports the direction hit
 * rate and the mean absolute error over those pairs — the honest answer to
 * "how good are our models", with a minimum-sample note instead of a
 * percentage computed from two data points.
 */
import { randomUUID } from 'node:crypto';
import { requireFlag } from './flags.js';

export const LEARNING_SCHEMA = 'fbt.fi.learning.v1';

const MIN_CALIBRATION_SAMPLES = 3;
const MAX_HISTORY = 40;

const num = (v) => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));

/** Which genome dimension an outcome is allowed to move — and only that.
 *  A kind with no dimension mapping changes nothing: evolution is bounded,
 *  which means bounded in DIRECTION as well as in step size. */
const DIMENSION_FOR_KIND = {
  DCA_IN: 'automationPreference',
  YIELD_ON_IDLE: 'timeHorizon',
  REBALANCE: 'liquidityNeed',
  RISK_REDUCTION: 'drawdownTolerance',
  DELEVERAGE: 'drawdownTolerance',
  LEVERAGED_YIELD: 'riskTolerance',
  PERP_DIRECTIONAL: 'riskTolerance'
};

export function createLearningEngine({
  collections, memory, preferences = null, behavior = null, genome = null,
  observability = null, log = () => {}, now = () => Date.now()
} = {}) {
  /**
   * Learn from ONE verified execution.
   *
   * @param {object} p
   * @param {string} p.owner
   * @param {object} p.execution { executionId, strategyId, verified, verificationId,
   *                                kind, asset?, riskLevel?, amountUsd?, pnlUsd?,
   *                                feesUsd?, slippagePct?, gasUsd?,
   *                                expected: { returnPct?, feeUsd? }, decisionId? }
   * @param {string} [p.correlationId]
   */
  async function learn(owner, { execution = {}, correlationId = null } = {}) {
    const at = now();
    const gate = requireFlag('LEARNING_ENGINE_ENABLED');
    if (!gate.ok) return { ok: false, code: gate.code, flag: gate.flag };

    /* ── the first and most important gate: verified or nothing ───────── */
    if (execution.verified !== true) {
      return {
        ok: false,
        code: 'OUTCOME_NOT_VERIFIED',
        detail: 'learning reads only verified completions; a claimed fill may never have landed, and the models must not find out that way'
      };
    }
    const strategyId = String(execution.strategyId || '').slice(0, 64);
    if (!strategyId) return { ok: false, code: 'STRATEGY_ID_REQUIRED' };

    const amountUsd = num(execution.amountUsd);
    const pnlUsd = num(execution.pnlUsd);
    const feesUsd = num(execution.feesUsd);
    const slippagePct = num(execution.slippagePct);
    const expectedReturnPct = num(execution.expected?.returnPct);
    const actualReturnPct = amountUsd && amountUsd > 0 && pnlUsd !== null ? Math.round((pnlUsd / amountUsd) * 10000) / 100 : null;
    const deltaPct = expectedReturnPct !== null && actualReturnPct !== null ? Math.round((actualReturnPct - expectedReturnPct) * 100) / 100 : null;

    const lessons = [];
    const failures = [];

    /* 1: the outcome store — the expectation is persisted WITH the outcome:
       fee/slip calibration needs (quoted, realised) pairs, and a realised
       number without its quote is a fact with no lesson. */
    const outcome = await memory.recordOutcome(owner, {
      strategyId, verified: true,
      kind: execution.kind ? String(execution.kind).toUpperCase() : null,
      expected: {
        feeUsd: num(execution.expected?.feeUsd),
        returnPct: expectedReturnPct
      },
      pnlUsd, feesUsd, slippagePct
    }, { correlationId });
    if (!outcome.ok) failures.push({ engine: 'memory', code: outcome.code });
    else lessons.push('strategy-outcome memory updated (verified)');

    /* 2: the preference model (its own verified-only + downgrade rules apply) */
    if (preferences) {
      const pref = await preferences.learnFromOutcome(owner, {
        strategyId, verified: true,
        kind: execution.kind || null,
        feesUsd, slippagePct,
        expected: { feeUsd: num(execution.expected?.feeUsd) }
      });
      if (!pref.ok) failures.push({ engine: 'preferences', code: pref.code });
      else {
        for (const inf of pref.inferred || []) {
          lessons.push(inf.skipped
            ? `preference ${inf.key}: inference noted, explicit preference kept`
            : `preference ${inf.key} inferred (${inf.value})`);
        }
      }
    }

    /* 3: the behaviour model (EXECUTION_CONFIRMED requires verified: true) */
    if (behavior) {
      const beh = await behavior.ingest(owner, {
        kind: 'EXECUTION_CONFIRMED', verified: true,
        strategyKind: execution.kind || null,
        asset: execution.asset || null,
        riskLevel: execution.riskLevel || null,
        feesUsd
      }, { correlationId });
      if (!beh.ok) failures.push({ engine: 'behavior', code: beh.code });
      else lessons.push(`behaviour model ingested (signals: ${Object.keys(beh.signals || {}).length})`);
    }

    /* 4: the genome — bounded, dimension-mapped, or honestly skipped */
    if (genome) {
      const gGot = await genome.get(owner);
      if (!gGot.ok || !gGot.genome) {
        lessons.push('genome not built yet; no evolution (it will learn from the next rebuild)');
      } else {
        const dimension = DIMENSION_FOR_KIND[String(execution.kind || '').toUpperCase()] || null;
        if (!dimension) {
          lessons.push(`no genome dimension maps to kind "${execution.kind || 'unknown'}"; no evolution`);
        } else {
          const favorable = pnlUsd === null ? null : pnlUsd >= 0;
          if (favorable === null) {
            lessons.push('outcome carried no P&L; the direction of evolution would be a guess, so none');
          } else {
            const evolved = await genome.evolve(owner, {
              dimension, accepted: favorable, reason: `verified ${favorable ? 'favorable' : 'unfavorable'} outcome for ${strategyId}`
            }, { correlationId });
            if (!evolved.ok) failures.push({ engine: 'genome', code: evolved.code });
            else lessons.push(`genome dimension ${dimension} evolved (${favorable ? 'reinforced' : 'dampened'}, bounded step)`);
          }
        }
      }
    }

    const record = {
      schema: LEARNING_SCHEMA,
      id: `lrn_${randomUUID().replace(/-/g, '').slice(0, 20)}`,
      owner: null,
      at,
      executionId: execution.executionId ? String(execution.executionId).slice(0, 64) : null,
      strategyId,
      kind: execution.kind ? String(execution.kind).toUpperCase() : null,
      verified: true,
      verificationId: execution.verificationId ? String(execution.verificationId).slice(0, 64) : null,
      decisionId: execution.decisionId ? String(execution.decisionId).slice(0, 64) : null,
      expectedReturnPct,
      actualReturnPct,
      deltaPct,
      lessons,
      failures,
      grantsExecution: false,
      durable: null
    };
    const res = await collections.put('learning_outcomes', owner, record, { idKey: 'id' });
    if (!res.ok) return { ok: false, code: res.code, detail: 'the learning ran but its record could not be stored' };
    record.durable = res.durable ?? collections.durable();

    if (observability) {
      observability.emit({
        type: 'learning.completed', owner, correlationId,
        payload: { learningId: record.id, strategyId, lessons: lessons.length, failures: failures.length, deltaPct }
      });
    }
    log(`learning:done:${strategyId}:${lessons.length} lessons, ${failures.length} failures`);
    return { ok: true, record, lessons, failures, durable: record.durable };
  }

  /** The honest answer to "how good are our models". */
  async function calibration(owner, { limit = 60 } = {}) {
    const { rows } = await collections.read('learning_outcomes', owner);
    const paired = rows
      .filter((r) => r?.schema === LEARNING_SCHEMA && r.expectedReturnPct !== null && r.expectedReturnPct !== undefined && r.actualReturnPct !== null && r.actualReturnPct !== undefined)
      .slice(0, limit);
    if (paired.length < MIN_CALIBRATION_SAMPLES) {
      return {
        ok: true,
        schema: LEARNING_SCHEMA,
        samples: paired.length,
        minimum: MIN_CALIBRATION_SAMPLES,
        directionHitRate: null,
        maePct: null,
        note: 'fewer than three verified (expected, actual) pairs; a calibration from two points is a story, not a measurement',
        durable: collections.durable()
      };
    }
    const sign = (v) => (v > 0 ? 1 : v < 0 ? -1 : 0);
    const directionHits = paired.filter((r) => sign(r.actualReturnPct) === sign(r.expectedReturnPct) || (r.expectedReturnPct === 0 && r.actualReturnPct === 0)).length;
    const mae = paired.reduce((a, r) => a + Math.abs(r.deltaPct ?? (r.actualReturnPct - r.expectedReturnPct)), 0) / paired.length;
    return {
      ok: true,
      schema: LEARNING_SCHEMA,
      samples: paired.length,
      minimum: MIN_CALIBRATION_SAMPLES,
      directionHitRate: Math.round((directionHits / paired.length) * 1000) / 1000,
      maePct: Math.round(mae * 100) / 100,
      note: 'direction hits over verified pairs; mae in percentage points — the models are getting better or not, measured',
      durable: collections.durable()
    };
  }

  async function history(owner, { limit = 10 } = {}) {
    const { rows } = await collections.read('learning_outcomes', owner);
    return { ok: true, outcomes: rows.filter((r) => r?.schema === LEARNING_SCHEMA).slice(0, Math.max(1, limit)), durable: collections.durable() };
  }

  return { schema: LEARNING_SCHEMA, learn, calibration, history, MIN_CALIBRATION_SAMPLES };
}
