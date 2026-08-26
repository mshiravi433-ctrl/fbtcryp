/**
 * FBT INTENT AI — AGENT SCORING (Phase 4)
 * ---------------------------------------------------------------------------
 * An agent's score is computed ONLY from observed samples. None of it is
 * inferred, predicted, or borrowed. If the sample is too small, the score is
 * honestly marked `insufficient_data` and NO success-rate number is invented.
 *
 * Hard rules:
 *   - sampleSize < MIN_OBSERVED_SAMPLE_SIZE → status='insufficient_data',
 *     successRate=null, score=null. We never round a thin sample up to a %.
 *   - A score is NEVER "verified by score" and NEVER replaces Guardian. Even a
 *     perfect score still goes through Guardian + a capability token.
 *   - The composite score is bounded (0..100) and always carries `observed`.
 *   - A fabricated/empty sample is rejected, never scored.
 */

export const AGENT_SCORE_SCHEMA = 'fbt.agent-score.v1';
export const MIN_OBSERVED_SAMPLE_SIZE = 5;
export const SCORE_IS_OBSERVED = true;
export const SCORE_NEVER_VERIFIES = true; // score is not authority

/** Score an agent from an array of observed outcomes. Fail-closed on thin data. */
export function observedScore(samples = [], opts = {}) {
  if (!Array.isArray(samples)) {
    return honestScore({ status: 'insufficient_data', reason: 'NO_SAMPLES' });
  }
  // Drop malformed samples and fabricated successes.
  const valid = samples.filter((s) => {
    if (!s || typeof s !== 'object') return false;
    if (s.outcome === 'success' && s.confirmed !== true) return false;
    return typeof s.outcome === 'string';
  });

  const sampleSize = valid.length;
  if (sampleSize < MIN_OBSERVED_SAMPLE_SIZE) {
    return honestScore({ status: 'insufficient_data', sampleSize });
  }

  const successCount = valid.filter((s) => s.outcome === 'success').length;
  const successRate = clamp01(successCount / sampleSize);
  const networkLatency = valid.filter((s) => typeof s.latencyMs === 'number' && s.latencyMs > 0)
    .map((s) => s.latencyMs);
  const avgLatencyMs = networkLatency.length
    ? networkLatency.reduce((a, b) => a + b, 0) / networkLatency.length
    : null;

  return honestScore({
    status: 'rated',
    sampleSize,
    successCount,
    successRate,
    score: Math.round(clamp01(successRate) * 100),
    avgLatencyMs,
    // Score is honest evidence, never an auto-trust token.
    verifiedByScore: false
  });
}

function honestScore(fields) {
  return Object.freeze({
    schema: AGENT_SCORE_SCHEMA,
    observed: SCORE_IS_OBSERVED,
    verifiedByScore: false,
    guardianReplacement: false,
    sampleSize: 0,
    successCount: 0,
    successRate: null,
    score: null,
    avgLatencyMs: null,
    reason: null,
    ...fields
  });
}

function clamp01(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.min(1, Math.max(0, n));
}

/** Honest label mapping used by the UI (never 0% or 100% for thin data). */
export function scoreDisplayLabel(score, opts = {}) {
  if (!score || score.status !== 'rated') return { status: 'unknown', label: null, isRated: false };
  return { status: 'rated', label: `${Math.round(score.score)}%`, sampleSize: score.sampleSize, isRated: true };
}
