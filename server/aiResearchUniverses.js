/**
 * FBT NEUROMORPHIC 2050 — PHASE 8: PARALLEL RESEARCH UNIVERSES (SERVER PROBE)
 * ===========================================================================
 * The device engine (`src/lib/neuromorphic/researchUniverses.js`) owns the
 * research. This file only publishes a *reproducible self-test* of that engine
 * so nobody has to trust a screenshot:
 *
 *   · The probe runs the exact same deterministic population on a seeded,
 *     clearly labelled **synthetic** fixture. It proves the mechanics
 *     (no look-ahead, honest pending state, selection, mutation, dispersion,
 *     content hash) — it says nothing about any market, and the payload repeats
 *     that in words (`probe.disclaimer`, `honesty.syntheticDataUsed: true`).
 *   · Real market evidence stays on the device: no candles, no genomes and no
 *     device identifiers are uploaded here.
 *   · Cached for 60 s and computed in a few milliseconds of serverless CPU:
 *     `zeroServerGpu: true`.
 *
 * Hard execution wall: `canExecute: false`, `canSign: false`,
 * `canMoveFunds: false`. This endpoint cannot place, sign or move anything.
 */

import {
  DEFAULT_POPULATION,
  MAX_POPULATION,
  MIN_POPULATION,
  UNIVERSES_CANONICAL_SEED,
  UNIVERSES_SCHEMA,
  probeResearchUniverses
} from '../src/lib/neuromorphic/researchUniverses.js';

export const UNIVERSES_ENDPOINT_SCHEMA = 'fbt.neuromorphic.universes-endpoint.v1';

const CACHE_TTL_MS = 60_000;
let cache = { at: 0, key: '', payload: null };

function cacheKey({ population, steps, seed }) {
  return `${population}|${steps}|${seed}`;
}

/**
 * Deterministic, cached engine self-test.
 * @param {object} [opts]
 * @param {number} [opts.population] 4..32
 * @param {number} [opts.steps] 40..600 (clamped by the probe)
 * @param {number} [opts.seed]
 * @param {() => number} [opts.now]
 */
export function getResearchUniversesProbe({
  population = DEFAULT_POPULATION,
  steps = 160,
  seed = UNIVERSES_CANONICAL_SEED,
  now = () => Date.now()
} = {}) {
  const pop = Math.min(
    MAX_POPULATION,
    Math.max(MIN_POPULATION, Math.round(Number(population) || DEFAULT_POPULATION))
  );
  const stepCount = Math.min(600, Math.max(40, Math.round(Number(steps) || 160)));
  const seedValue = Number(seed) >>> 0;
  const key = cacheKey({ population: pop, steps: stepCount, seed: seedValue });
  const stamp = now();
  if (cache.payload && cache.key === key && stamp - cache.at < CACHE_TTL_MS) {
    return { ...cache.payload, cached: true, servedAt: stamp };
  }

  const report = probeResearchUniverses({ population: pop, steps: stepCount, seed: seedValue });
  const payload = {
    ...report,
    ok: true,
    schema: UNIVERSES_SCHEMA,
    endpointSchema: UNIVERSES_ENDPOINT_SCHEMA,
    scope: 'engine self-test on a synthetic fixture — not market evidence',
    zeroServerGpu: true,
    cached: false,
    laws: {
      canExecute: false,
      canSign: false,
      canMoveFunds: false,
      readOnly: true,
      uploadsRawData: false,
      uploadsDeviceIds: false
    },
    honesty: {
      ...report.honesty,
      syntheticDataUsed: true,
      syntheticFixtureOnly: true,
      uploadsRawCandles: false,
      accuracyIsNotProfitability: true
    }
  };
  cache = { at: stamp, key, payload };
  return { ...payload, cached: false, servedAt: stamp };
}

/** Exposed for tests: forget the cached probe. */
export function __clearResearchUniversesCache() {
  cache = { at: 0, key: '', payload: null };
}
