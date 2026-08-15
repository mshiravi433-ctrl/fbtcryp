/**
 * LEARNING CORE — hot-path loader.
 * ---------------------------------------------------------------------------
 * The two functions the serving path is allowed to touch:
 *
 *   getParams()            — the in-memory cached params object, or null.
 *                            SYNCHRONOUS object read, zero I/O. Warmed lazily
 *                            on the first request (params.js does exactly one
 *                            single-flight Blob fetch per cold start) and
 *                            refreshed in-process after each cron training
 *                            run via warmParamsCache().
 *
 *   applyParams(v, params, horizon?) — a NEW verdict object with calibrated
 *                            confidence and re-weighted layer weights. When
 *                            params is null / missing / stale (>14 days) /
 *                            fallback, returns v UNCHANGED — the sabotage
 *                            fallback that keeps the verdict identical to
 *                            today's engine.
 *
 * Everything is defensive: this module must keep working when Blob is off,
 * when the manifest is corrupt, and even when the rest of server/learning/*
 * has been deleted (app.js imports it behind a guarded dynamic import).
 */

import {
  LAYER_KEYS,
  LAYER_MAX_MULT,
  LAYER_MIN_MULT,
  HORIZONS,
  STALE_PARAMS_DAYS,
  VERDICT_CONFIDENCE_CEILING,
  sanitizeParams
} from './schema.js';
import { getServingParams, servingSnapshot, warmParamsCache } from './params.js';

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/**
 * The current params, synchronously, from memory. Null when nothing is
 * loaded yet (a lazy warm-up is kicked off in the background), when Blob is
 * off, or when the published model is a hardcoded fallback.
 */
export function getParams() {
  const snap = servingSnapshot();
  if (!snap) {
    // Cold instance: warm lazily, serve null NOW — never block a request.
    getServingParams().catch(() => {});
    return null;
  }
  return snap.params ?? null;
}

/** Re-read manifest + params (called in-process after the cron trains). */
export function refreshParams() {
  return warmParamsCache();
}

/** True when the vector is usable: sane, trained, and fresher than 14 days. */
export function paramsUsable(params, now = Date.now()) {
  // Kill switch for the rollout's first day: LEARNING_ENABLED=0 forces the
  // serving path to fallback even when a valid vector is published.
  if (process.env.LEARNING_ENABLED === '0') return false;
  const clean = sanitizeParams(params);
  if (!clean || clean.fallbackHardcoded) return false;
  const trained = Date.parse(clean.trainedAt ?? '');
  if (!Number.isFinite(trained)) return false;
  return now - trained <= STALE_PARAMS_DAYS * 24 * 3600 * 1000;
}

const sigmoid = (x) => 1 / (1 + Math.exp(-x));
const logit = (p) => Math.log(p / (1 - p));

/** Calibrated confidence 0..100 — bounded by the engine's own ceiling. */
function calibrateConfidence(confidence, horizon, params) {
  const cal = params?.calibration2;
  const ceiling = VERDICT_CONFIDENCE_CEILING[horizon] ?? 75;
  const conf = clamp(Number(confidence) || 0, 0, ceiling);
  if (!cal || !Number.isFinite(cal.a) || !Number.isFinite(cal.b) || conf <= 0) return conf;
  const p = sigmoid(cal.a * logit(clamp(conf, 1, 99) / 100) + cal.b);
  const regime = params?.regimeMult ?? {};
  const g = typeof params?._regime === 'string' ? params._regime : null;
  const mult = g && Number.isFinite(regime[g]) ? clamp(regime[g], 0.7, 1.3) : 1;
  return Math.round(clamp(p * 100 * mult, 0, ceiling));
}

/** Combined layer multiplier: published layer band × bandit draw squeezed
 *  into the SAME hard band — the bandit can bias, never blow out. */
function layerMultiplier(params, horizon, key) {
  const base = clamp(Number(params?.layers?.[horizon]?.[key]) || 1, LAYER_MIN_MULT, LAYER_MAX_MULT);
  const banditRaw = clamp(Number(params?.bandit?.[key]) || 1, 0.4, 1.8);
  // Map the wide bandit draw into a gentle ±15% bias around 1.
  const banditSqueezed = clamp(1 + (banditRaw - 1) * 0.15, LAYER_MIN_MULT, LAYER_MAX_MULT);
  return clamp(base * banditSqueezed, LAYER_MIN_MULT, LAYER_MAX_MULT);
}

/**
 * Return a NEW verdict object with calibrated confidence and re-weighted
 * layer weights. `v` is a verdict() result ({ short, long, ... }); pass
 * `horizon` to touch only one side. Never mutates the input; on any doubt
 * (bad params, stale, malformed verdict) returns `v` unchanged.
 */
export function applyParams(v, params = getParams(), horizon = null, now = Date.now()) {
  try {
    if (!v || typeof v !== 'object') return v;
    if (!paramsUsable(params, now)) return v;
    const clean = sanitizeParams(params);
    const out = { ...v };
    const sides = horizon ? [horizon] : HORIZONS;
    for (const h of sides) {
      const side = v[h];
      if (!side || typeof side !== 'object') continue;
      const layers = {};
      for (const key of LAYER_KEYS) {
        const l = side.layers?.[key];
        if (!l || typeof l !== 'object') {
          layers[key] = l;
          continue;
        }
        // Layers with no evidence (weight 0) stay untouched — re-weighting
        // silence into signal would be inventing data.
        const w = Number(l.weight) || 0;
        layers[key] = w > 0 ? { ...l, weight: w * layerMultiplier(clean, h, key) } : l;
      }
      const withRegime = { ...clean, _regime: v.macro?.regime?.regime ?? null };
      out[h] = {
        ...side,
        layers: side.layers ? layers : side.layers,
        confidence: calibrateConfidence(side.confidence, h, withRegime),
        calibrated: true
      };
    }
    return out;
  } catch {
    return v;
  }
}

export default { getParams, applyParams, refreshParams, paramsUsable };
