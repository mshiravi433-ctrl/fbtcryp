/**
 * FBT INTENT AI — Spec 65 item 37: Confidence Decay.
 *
 * Data ages. Every confidence number that enters a decision must decay with
 * the age of its underlying observation, deterministically. Below the review
 * threshold the data is `stale-review-required` and execution is blocked —
 * the intent must be re-validated, not silently executed on old evidence.
 */

import { bounded, fail, finite, noExecutionPermission } from './phaseBoundary.js';

export const CONFIDENCE_DECAY_SCHEMA = 'fbt.intent-confidence-decay.v1';

export const DEFAULT_HALF_LIFE_HRS = 12;
export const DEFAULT_REVIEW_THRESHOLD = 35;

/**
 * Deterministic exponential decay: confidence × 0.5^(ageHours / halfLife).
 * Unknown observedAt or a future observedAt yields status 'unknown-age' with
 * the base confidence carried but flagged — never silently trusted.
 */
export function decayConfidence({
  baseConfidence = null,
  observedAt = null,
  now = Date.now(),
  halfLifeHrs = DEFAULT_HALF_LIFE_HRS,
  reviewThreshold = DEFAULT_REVIEW_THRESHOLD
} = {}) {
  const base = bounded(baseConfidence);
  if (base === null) {
    return noExecutionPermission({
      ok: true, schema: CONFIDENCE_DECAY_SCHEMA, status: 'insufficient-evidence',
      confidence: null, baseConfidence: null, executionBlocked: true,
      note: 'No bounded confidence was supplied; nothing is invented.'
    });
  }
  const observed = finite(observedAt);
  const halfLife = finite(halfLifeHrs);
  if (observed === null || halfLife === null || halfLife <= 0) {
    return noExecutionPermission({
      ok: true, schema: CONFIDENCE_DECAY_SCHEMA, status: 'unknown-age',
      confidence: base, baseConfidence: base, executionBlocked: true,
      note: 'Observation time is unknown; the value cannot be freshness-checked and is blocked from execution use.'
    });
  }
  if (observed > now) {
    return noExecutionPermission({
      ok: true, schema: CONFIDENCE_DECAY_SCHEMA, status: 'future-observation',
      confidence: base, baseConfidence: base, executionBlocked: true,
      note: 'An observation timestamped in the future is invalid evidence.'
    });
  }
  const ageHours = Math.max(0, (now - observed) / 3_600_000);
  const decayed = Math.round(base * Math.pow(0.5, ageHours / halfLife) * 100) / 100;
  const stale = decayed < reviewThreshold;
  return noExecutionPermission({
    ok: true,
    schema: CONFIDENCE_DECAY_SCHEMA,
    status: stale ? 'stale-review-required' : 'fresh-enough',
    confidence: decayed,
    baseConfidence: base,
    ageHours: Math.round(ageHours * 100) / 100,
    halfLifeHrs,
    reviewThreshold,
    executionBlocked: stale,
    reviewRequired: stale,
    note: stale
      ? 'Decayed confidence fell below the review threshold; the data must be re-validated, not executed on.'
      : 'Decayed confidence remains above the review threshold.'
  });
}

/**
 * Apply decay across an evidence list, returning the rows plus the weakest
 * freshness. One stale row makes the whole set review-required.
 */
export function applyDecayToEvidence(evidence = [], options = {}) {
  if (!Array.isArray(evidence)) return fail('EVIDENCE_LIST_REQUIRED');
  const rows = evidence.slice(0, 24).map((row) => {
    const quality = bounded(row?.quality);
    const decay = decayConfidence({ baseConfidence: quality, observedAt: row?.observedAt, ...options });
    return { source: typeof row?.source === 'string' ? row.source.slice(0, 80) : 'unspecified', observedAt: finite(row?.observedAt), decay };
  });
  const anyStale = rows.some((row) => row.decay.status === 'stale-review-required' || row.decay.status === 'unknown-age');
  const anyInsufficient = rows.some((row) => row.decay.status === 'insufficient-evidence');
  return noExecutionPermission({
    ok: true,
    schema: CONFIDENCE_DECAY_SCHEMA,
    rows,
    weakestStatus: anyStale ? 'stale-review-required' : anyInsufficient ? 'insufficient-evidence' : 'fresh-enough',
    executionBlocked: anyStale,
    reviewRequired: anyStale
  });
}
