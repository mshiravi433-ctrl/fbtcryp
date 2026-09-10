/**
 * FBT FINANCIAL INTELLIGENCE OS — AI Self-Evaluation Loop (Phase 212, upgrade 8).
 * ---------------------------------------------------------------------------
 * Decision → Outcome → Evaluation → Learning → Strategy update.
 *
 * learning.js learns from VERIFIED EXECUTIONS. This engine closes the other
 * half of the loop: it re-reads past DECISIONS against what the market and the
 * wallet actually did, and measures the MODELS, not the user:
 *
 *   actualReturnPct      the realized move of the chosen asset/strategy
 *   predictionErrorPct   actual − expected (the number that must shrink)
 *   riskPredictionError  modelled downside vs realized drawdown
 *   executionSlippagePct quoted vs realised fill (when an execution exists)
 *   regime               the market regime the decision was made under — so
 *                        «در این نوع market regime پیش‌بینی قبلی من ۱۸٪ خطا
 *                        داشت» becomes a computed row, not a feeling.
 *
 * THE RULES
 *  1. A decision without a review date is never auto-reviewed.
 *  2. An evaluation is only written when the ACTUAL numbers could be read —
 *     an unread outcome stays pending forever rather than being scored zero.
 *  3. Evaluations feed strategy updates through the learning engine's own
 *     gates (verified-only) — this file measures, it never grants anything.
 */

import { randomUUID } from 'node:crypto';
import { requireFlag } from './flags.js';

export const EVALUATION_SCHEMA = 'fbt.fi.evaluation.v1';
export const EVALUATION_STATUS = Object.freeze(['PENDING', 'EVALUATED', 'UNREADABLE']);

const MIN_REGIME_SAMPLES = 3;
const num = (v) => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
const round = (v, d = 2) => (num(v) === null ? null : Number(Number(v).toFixed(d)));

/** Verdict from the signed error — the honest triage of our own models. */
export function verdictFor({ predictionErrorPct = null, riskPredictionErrorPct = null } = {}) {
  const pe = Math.abs(num(predictionErrorPct) ?? 0);
  const re = Math.abs(num(riskPredictionErrorPct) ?? 0);
  if (pe === 0 && re === 0 && predictionErrorPct === null) return 'UNMEASURED';
  if (pe >= 20 || re >= 25) return 'MODEL_WRONG';
  if (pe >= 10 || re >= 15) return 'MODEL_DRIFTING';
  if (pe >= 5) return 'ACCEPTABLE';
  return 'MODEL_GOOD';
}

/**
 * Evaluate ONE decision against its realized outcome. Pure — the engine
 * wrapper owns storage and the reads.
 *
 * @param {object} p.decision   the decision record (with decision.expectedReturnPct, nextReviewAt…)
 * @param {object} p.actual     { returnPct, drawdownPct, slippagePct, pnlUsd, at }
 * @param {object} [p.strategy] the strategy row (potentialLossPct, riskPct)
 */
export function evaluateDecision({ decision = null, actual = {}, strategy = null, now = Date.now() } = {}) {
  if (!decision) return { ok: false, code: 'NO_DECISION' };
  const expectedReturnPct = num(decision.decision?.expectedReturnPct ?? decision.expectedReturnPct);
  const actualReturnPct = num(actual.returnPct);
  if (actualReturnPct === null) {
    return { ok: false, code: 'OUTCOME_UNREADABLE', detail: 'the realized return could not be read; the decision stays pending, never scored zero' };
  }
  const predictionErrorPct = expectedReturnPct !== null ? round(actualReturnPct - expectedReturnPct, 2) : null;
  const modelledDownsidePct = num(strategy?.potentialLossPct ?? decision.downsidePct);
  const actualDrawdownPct = num(actual.drawdownPct);
  const riskPredictionErrorPct = modelledDownsidePct !== null && actualDrawdownPct !== null
    ? round(Math.abs(actualDrawdownPct) - modelledDownsidePct, 2)
    : null;
  const executionSlippagePct = num(actual.slippagePct);
  return {
    ok: true,
    schema: EVALUATION_SCHEMA,
    id: `evl_${randomUUID().replace(/-/g, '').slice(0, 20)}`,
    decisionId: decision.id,
    strategyId: decision.decision?.strategyId || null,
    kind: decision.decision?.type || null,
    regime: decision.competitionId ? (decision.globalContext?.regime || decision.regime || null) : (decision.globalContext?.regime || null),
    at: now,
    expectedReturnPct,
    actualReturnPct,
    predictionErrorPct,
    modelledDownsidePct,
    actualDrawdownPct,
    riskPredictionErrorPct,
    executionSlippagePct,
    pnlUsd: num(actual.pnlUsd),
    verdict: verdictFor({ predictionErrorPct, riskPredictionErrorPct }),
    status: 'EVALUATED',
    grantsExecution: false,
    note: 'prediction error is signed (actual − expected); regime rows aggregate it so the next decision under the same regime starts informed'
  };
}

/** Aggregate evaluation rows by market regime — the owner's exact example. */
export function regimeStats(rows = []) {
  const byRegime = {};
  for (const r of (Array.isArray(rows) ? rows : []).filter((x) => x?.status === 'EVALUATED')) {
    const key = String(r.regime || 'UNKNOWN').toUpperCase();
    byRegime[key] = byRegime[key] || { regime: key, samples: 0, errors: [], riskErrors: [], wins: 0 };
    byRegime[key].samples += 1;
    if (num(r.predictionErrorPct) !== null) byRegime[key].errors.push(Math.abs(num(r.predictionErrorPct)));
    if (num(r.riskPredictionErrorPct) !== null) byRegime[key].riskErrors.push(Math.abs(num(r.riskPredictionErrorPct)));
    if (num(r.pnlUsd) !== null && num(r.pnlUsd) >= 0) byRegime[key].wins += 1;
  }
  return Object.values(byRegime).map((row) => ({
    regime: row.regime,
    samples: row.samples,
    meanAbsPredictionErrorPct: row.errors.length ? round(row.errors.reduce((a, b) => a + b, 0) / row.errors.length, 2) : null,
    meanAbsRiskErrorPct: row.riskErrors.length ? round(row.riskErrors.reduce((a, b) => a + b, 0) / row.riskErrors.length, 2) : null,
    winRatePct: row.samples ? round((row.wins / row.samples) * 100, 1) : null,
    reliable: row.samples >= MIN_REGIME_SAMPLES,
    note: row.samples >= MIN_REGIME_SAMPLES
      ? 'enough evaluated samples to act on'
      : `fewer than ${MIN_REGIME_SAMPLES} evaluated samples — direction, not a verdict`
  }));
}

/** The engine wrapper: due-review scheduling, persistence, learning hand-off. */
export function createEvaluationEngine({ collections = null, learning = null, observability = null, log = () => {}, now = () => Date.now() } = {}) {
  /** Decisions whose review window has elapsed and that still have no row. */
  async function reviewDue(owner, { limit = 20 } = {}) {
    if (!collections) return { ok: false, code: 'COLUMNS_NOT_WIRED', due: [] };
    const at = now();
    const { rows: decisions } = await collections.read('decisions', owner);
    const { rows: evaluated } = await collections.read('evaluations', owner);
    const done = new Set(evaluated.filter((r) => r?.schema === EVALUATION_SCHEMA).map((r) => r.decisionId));
    const due = decisions
      .filter((d) => d?.schema === 'fbt.fi.decision.v1' && !done.has(d.id) && num(d.nextReviewAt) !== null && d.nextReviewAt <= at)
      .slice(0, Math.max(1, limit));
    return { ok: true, due, count: due.length };
  }

  /**
   * Evaluate one due decision with the ACTUAL outcome the caller read (the
   * router supplies market/execution reads; this file never guesses them).
   */
  async function evaluate(owner, { decision = null, actual = {}, strategy = null, correlationId = null } = {}) {
    const gate = requireFlag('EVALUATION_LOOP_ENABLED');
    if (!gate.ok) return { ok: false, code: gate.code, flag: gate.flag };
    if (!decision) return { ok: false, code: 'NO_DECISION' };
    const row = evaluateDecision({ decision, actual, strategy, now: now() });
    if (!row.ok) {
      /* An unreadable outcome is RECORDED as unreadable, not skipped silently. */
      const pending = {
        schema: EVALUATION_SCHEMA,
        id: `evl_${randomUUID().replace(/-/g, '').slice(0, 20)}`,
        decisionId: decision.id,
        strategyId: decision.decision?.strategyId || null,
        at: now(),
        status: 'UNREADABLE',
        code: row.code,
        verdict: 'UNMEASURED',
        grantsExecution: false
      };
      await collections?.put('evaluations', owner, pending, { idKey: 'id' }).catch(() => {});
      return { ...row, row: pending };
    }
    const res = await collections.put('evaluations', owner, row, { idKey: 'id' });
    row.durable = res.durable ?? collections.durable();

    /* Strategy update hand-off: a verified execution with a P&L may teach the
       learning engine; the evaluation row is the measurement either way. */
    if (learning && num(actual.pnlUsd) !== null && actual.verified === true) {
      await learning.learn(owner, {
        execution: {
          executionId: actual.executionId || row.id,
          strategyId: row.strategyId || 'unknown',
          kind: row.kind,
          verified: true,
          pnlUsd: num(actual.pnlUsd),
          amountUsd: num(actual.amountUsd),
          slippagePct: num(actual.slippagePct),
          expected: { returnPct: row.expectedReturnPct },
          decisionId: decision.id
        },
        correlationId
      }).catch((err) => log(`evaluation:learning-handoff-failed:${String(err?.message || err).slice(0, 80)}`));
    }
    if (observability) observability.emit({ type: 'evaluation.completed', owner, correlationId, payload: { decisionId: decision.id, verdict: row.verdict, predictionErrorPct: row.predictionErrorPct } });
    return { ok: true, row };
  }

  async function history(owner, { limit = 30 } = {}) {
    if (!collections) return [];
    const { rows } = await collections.read('evaluations', owner);
    return rows.filter((r) => r?.schema === EVALUATION_SCHEMA).slice(0, Math.max(1, limit));
  }

  /** The regime-conditioned calibration the decision layer consults. */
  async function regimes(owner) {
    const rows = await history(owner, { limit: 120 });
    return regimeStats(rows);
  }

  return { schema: EVALUATION_SCHEMA, reviewDue, evaluate, history, regimes, evaluateDecision, regimeStats };
}
