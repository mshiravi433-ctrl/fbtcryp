/**
 * FBT INTENT AI — STRATEGY REFINE (Phase 5)
 * ---------------------------------------------------------------------------
 * Nudges PROPOSED strategy confidence using LOCAL opt-in statistics. It never
 * invents gains, never issues guarantees, and NEVER weakens Guardian / Risk /
 * the Confirmation Gate.
 *
 * Hard rules:
 *   - Confidence is bounded by `MAX_REFINED_CONFIDENCE` (never 100%).
 *   - Every refined proposal carries honest disclaimers:
 *       NOT_GUARANTEED, PARTIAL_LOSS_POSSIBLE.
 *   - Refine is a SUGGESTION only — a refined proposal still goes through
 *     Guardian, Risk, and the Gate. Refine never skips any of them.
 *   - No opt-in memory → refine is a no-op (proposals pass through unchanged).
 */

import { memoryStats } from './adaptiveMemory.js';
import { classifyFailure } from './failureModes.js';

export const REFINE_SCHEMA = 'fbt.strategy-refine.v1';
export const MAX_REFINED_CONFIDENCE = 80; // never a guaranteed 100%
export const REFINE_NUDGE_CAP = 15;       // max confidence points moved per proposal
export const REFINE_DISCLAIMERS = Object.freeze(['NOT_GUARANTEED', 'PARTIAL_LOSS_POSSIBLE']);

/**
 * Refine a set of strategy proposals against local memory.
 * @param {object[]} proposals   strategy proposals from the Strategy Agent
 * @param {object} [opts]        { samples }  opt-in samples (defaults to memory)
 * @returns {{ok:boolean, proposals:object[], refined:number, disclaimers:string[]}}
 */
export function refineStrategies(proposals = [], opts = {}) {
  if (!Array.isArray(proposals)) {
    return { ok: false, error: classifyFailure('MISSING_DATA', { detail: 'NO_PROPOSALS' }) };
  }
  const stats = memoryStats(opts.samples);
  if (!stats.sampleSize) {
    // No opt-in memory: no-op refine, honest.
    return {
      ok: true,
      proposals: proposals.map((p) => ({ ...p })),
      refined: 0,
      disclaimers: REFINE_DISCLAIMERS,
      note: 'NO_LOCAL_MEMORY'
    };
  }

  let refined = 0;
  const out = proposals.map((p) => {
    const base = Number(p.confidence) || 40;
    const historical = stats.byStrategy?.[p.strategy];
    let delta = 0;
    if (historical && historical.count > 0) {
      // Positive history nudges up, negative nudges down; capped by CAP.
      const hitRate = historical.success / historical.count;
      delta = Math.round((hitRate - 0.5) * 2 * REFINE_NUDGE_CAP);
    }
    const confidence = Math.round(Math.min(MAX_REFINED_CONFIDENCE, Math.max(0, base + delta)));
    if (confidence !== base) refined += 1;
    return {
      ...p,
      confidence,
      refinedByMemory: delta !== 0,
      disclaimers: Array.from(new Set([...(p.disclaimers || []), ...REFINE_DISCLAIMERS]))
    };
  });

  return {
    ok: true,
    proposals: out,
    refined,
    disclaimers: REFINE_DISCLAIMERS,
    note: 'refined-from-local-opt-in-memory'
  };
}
