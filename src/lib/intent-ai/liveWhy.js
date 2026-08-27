/**
 * FBT INTENT AI — PHASE 60: EXPLAINABLE ANALYSIS ON REAL DATA
 * ---------------------------------------------------------------------------
 * A verdict is not an argument. Every recommendation must be able to answer
 * "why?" with its basis: WHICH source, WHEN it was observed, WHAT the numbers
 * were. This module is the gate that makes that impossible to fake.
 *
 *   · a data point without a source or a timestamp is DROPPED, not rounded up
 *     into a confident sentence
 *   · a stale data point is dropped and counted, so the answer can say the
 *     basis was thin
 *   · with nothing left, `whyFromLiveData()` refuses: no data, no reason.
 *     It never emits a recommendation with invented numbers.
 *   · what survives is handed to the existing `whyThisDecision()` so the
 *     Spec-65 contract keeps holding.
 */

import { whyThisDecision, WHY_DECISION_SCHEMA } from './whyTransparency.js';
import { classifyFailure } from './failureModes.js';

export const LIVE_WHY_SCHEMA = 'fbt.live-why.v1';
export const DEFAULT_DATA_MAX_AGE_MS = 6 * 60 * 60 * 1000;

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : null);

/**
 * Keep only data points that can be checked.
 * @returns {{accepted:Array, rejected:Array}}
 */
export function screenDataPoints(dataPoints = [], { now = Date.now(), maxAgeMs = DEFAULT_DATA_MAX_AGE_MS } = {}) {
  const accepted = [];
  const rejected = [];
  for (const raw of Array.isArray(dataPoints) ? dataPoints.slice(0, 24) : []) {
    if (!raw || typeof raw !== 'object') { rejected.push({ label: null, reason: 'NOT_A_DATA_POINT' }); continue; }
    const label = typeof raw.label === 'string' && raw.label ? raw.label.slice(0, 48) : null;
    const source = typeof raw.source === 'string' && raw.source ? raw.source.slice(0, 60) : null;
    const observedAt = num(raw.observedAt ?? raw.at);
    const value = num(raw.value);
    if (!label) { rejected.push({ label: null, reason: 'NO_LABEL' }); continue; }
    if (!source) { rejected.push({ label, reason: 'NO_SOURCE' }); continue; }
    if (observedAt === null) { rejected.push({ label, reason: 'NO_TIMESTAMP' }); continue; }
    if (value === null) { rejected.push({ label, reason: 'NO_NUMBER' }); continue; }
    if (now - observedAt > maxAgeMs) { rejected.push({ label, reason: 'STALE', ageMs: now - observedAt }); continue; }
    accepted.push({
      label,
      source,
      observedAt,
      ageMs: now - observedAt,
      value,
      unit: typeof raw.unit === 'string' ? raw.unit.slice(0, 12) : null
    });
  }
  return { accepted, rejected };
}

/**
 * Build a "why" that is entirely traceable to real data.
 * @param {Array} dataPoints [{ label, source, observedAt, value, unit }]
 */
export function whyFromLiveData({
  action = null,
  decision = null,
  actor = null,
  dataPoints = [],
  alternative = null,
  now = Date.now(),
  maxAgeMs = DEFAULT_DATA_MAX_AGE_MS
} = {}) {
  const screened = screenDataPoints(dataPoints, { now, maxAgeMs });
  if (!screened.accepted.length) {
    // No data is not a reason. The recommendation does not get made.
    return {
      ok: false,
      schema: LIVE_WHY_SCHEMA,
      dataStatus: 'unavailable',
      explainable: false,
      recommendationAllowed: false,
      basis: [],
      rejected: screened.rejected,
      i18nKey: 'intentAI.why.noData',
      i18nParams: {},
      error: classifyFailure('MISSING_DATA', { detail: 'NO_CHECKABLE_DATA' })
    };
  }
  const byLabel = Object.fromEntries(screened.accepted.map((row) => [row.label, row.value]));
  const base = whyThisDecision({
    action,
    decision,
    actor,
    evidence: screened.accepted.map((row) => ({ source: row.source, observedAt: row.observedAt, quality: 1 })),
    costs: byLabel.cost ?? null,
    liquidity: byLabel.liquidity ?? null,
    risk: byLabel.risk ?? null,
    executionLikelihood: byLabel.executionLikelihood ?? null,
    alternative,
    now
  });
  if (base.ok !== true) {
    return {
      ok: false,
      schema: LIVE_WHY_SCHEMA,
      dataStatus: 'live',
      explainable: false,
      recommendationAllowed: false,
      basis: screened.accepted,
      rejected: screened.rejected,
      i18nKey: 'intentAI.why.noData',
      i18nParams: {},
      error: classifyFailure('MISSING_DATA', { detail: base.code || 'WHY_INCOMPLETE' })
    };
  }
  return {
    ok: true,
    schema: LIVE_WHY_SCHEMA,
    decisionSchema: WHY_DECISION_SCHEMA,
    dataStatus: 'live',
    explainable: true,
    recommendationAllowed: true,
    action: base.action,
    reason: base.reason,
    // The checkable basis: source, time, number — for every single figure used.
    basis: screened.accepted,
    rejected: screened.rejected,
    sources: [...new Set(screened.accepted.map((row) => row.source))],
    oldestObservedAt: Math.min(...screened.accepted.map((row) => row.observedAt)),
    newestObservedAt: Math.max(...screened.accepted.map((row) => row.observedAt)),
    factors: base.factors,
    saysBetter: base.saysBetter === true,
    i18nKey: 'intentAI.why.basis',
    i18nParams: {
      count: screened.accepted.length,
      sources: [...new Set(screened.accepted.map((row) => row.source))].join(', '),
      observedAt: Math.max(...screened.accepted.map((row) => row.observedAt))
    },
    executionAuthorized: false,
    explainedAt: now
  };
}

/**
 * Fail-closed guard: a chat answer that states numbers must be able to point
 * at them. Used wherever an analysis reply is assembled.
 */
export function assertExplainable(why) {
  if (!why || why.schema !== LIVE_WHY_SCHEMA || why.ok !== true) {
    return { ok: false, error: classifyFailure('MISSING_DATA', { detail: 'UNEXPLAINED_RECOMMENDATION' }) };
  }
  if (!Array.isArray(why.basis) || !why.basis.length) {
    return { ok: false, error: classifyFailure('MISSING_DATA', { detail: 'NO_BASIS' }) };
  }
  const unsourced = why.basis.filter((row) => !row.source || row.observedAt == null || row.value == null);
  if (unsourced.length) {
    return { ok: false, error: classifyFailure('MISSING_DATA', { detail: 'BASIS_NOT_CHECKABLE' }) };
  }
  return { ok: true };
}
