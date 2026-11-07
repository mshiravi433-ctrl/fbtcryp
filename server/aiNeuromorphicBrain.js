/**
 * FBT NEUROMORPHIC 2050 — PHASE 6: BRAIN-INSPIRED EVIDENCE ENDPOINT
 * ===========================================================================
 * The brain-inspired circuits run on the user's device (`src/lib/neuromorphic/
 * brainInspiredCore.js`), but a claim that cannot be reproduced outside the
 * browser is not evidence. This module runs the *same* deterministic probe on
 * the server — same seed, same synthetic drive, same code path — so anyone can
 * check that the predictive-coding hierarchy really lowers free energy instead
 * of taking it on faith:
 *
 *     GET /api/v1/ai/neuromorphic/brain
 *
 * Honest properties:
 *   · the probe passes `observedReturn: null` on every tick — no realised return
 *     is invented, so dopamine is never "trained" on a fabricated outcome;
 *   · the numbers are measured from the run (free energy first 6 vs last 6 ticks,
 *     forward-model error, actions observed), not constants;
 *   · the response advertises zero server GPU and the hard no-execution wall;
 *   · the result is cached for 60s because it is pure, deterministic and cheap.
 */

import {
  BRAIN_CORE_SCHEMA,
  probeBrainInspiredCore
} from '../src/lib/neuromorphic/brainInspiredCore.js';

export const NEUROMORPHIC_BRAIN_SCHEMA = 'fbt.neuromorphic.brain-endpoint.v1';

const CACHE_TTL_MS = 60_000;
let cache = { at: 0, payload: null };

/**
 * Deterministic brain-core evidence report.
 * @param {{ ticks?: number, seed?: number, now?: () => number }} args
 */
export function getBrainInspiredReport({ ticks = 60, seed = 0x2050fb71, now = () => Date.now() } = {}) {
  const ts = now();
  if (cache.payload && ts - cache.at < CACHE_TTL_MS && cache.payload.ticks === Number(ticks)) {
    return { ...cache.payload, cached: true, at: ts };
  }

  const probe = probeBrainInspiredCore({ ticks, seed });

  const payload = {
    ok: true,
    schema: NEUROMORPHIC_BRAIN_SCHEMA,
    coreSchema: BRAIN_CORE_SCHEMA,
    zeroServerGpu: true,
    deviceCompute: true,
    measured: probe,
    circuits: [
      'thalamic-attention-gate',
      'predictive-coding-2-levels',
      'neuromodulators-dopamine-acetylcholine-norepinephrine-serotonin',
      'prefrontal-working-memory',
      'basal-ganglia-go-nogo',
      'cerebellar-forward-model',
      'theta-gamma-plasticity-window',
      'homeostatic-firing-rate-loop',
      'sharp-wave-ripple-consolidation'
    ],
    honesty: {
      realizedReturnFabricated: false,
      accuracyPrefilled: false,
      note: 'Probe ticks pass observedReturn:null; hitRate/Brier remain owned by the spiking cortex and stay null until real prices resolve them.'
    },
    laws: {
      canExecute: false,
      canSign: false,
      canMoveFunds: false,
      zeroServerGpu: true
    },
    ticks: Number(probe.ticks),
    at: ts
  };

  cache = { at: ts, payload };
  return { ...payload, cached: false };
}

/** Test hook: forget the cached probe so a test can observe a cold run. */
export function __resetBrainReportCache() {
  cache = { at: 0, payload: null };
}
