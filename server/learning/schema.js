/**
 * LEARNING CORE — data model.
 * ---------------------------------------------------------------------------
 * The daily machine-learning loop lives ENTIRELY in the backend and costs
 * nothing extra: Vercel Blob is the parameter store and rolling data window,
 * the existing in-memory cache serves parameters on the hot path, and the
 * daily cron already paid for by the Hobby plan runs the training.
 *
 * WHAT IS STORED (two JSON blobs + a manifest pointer):
 *
 *   learning/buckets.ndjson            — append-only outcomes, one compact
 *                                        JSON record per line (<120 bytes).
 *                                        Rolls to learning/buckets-YYYYMMDD.ndjson
 *                                        at 100K records (~12 MB).
 *   learning/params-YYYY-MM-DD.json    — immutable published parameters.
 *   learning/manifest.json             — tiny pointer: which params file is
 *                                        live, when it was trained, how many
 *                                        records, calibration AUC, and whether
 *                                        the run had to fall back to hardcoded.
 *
 * PRIVACY (non-negotiable):
 *   The telemetry record carries NO address, NO public key, NO IP, NO user
 *   identifier. The coin id is a deterministic hash of the public coingecko
 *   id — a label the whole market already shares, not a user fingerprint.
 *   The consent token lives on the device and is never stored server-side;
 *   the endpoint rejects anything without it (401) so a client that never
 *   went through the Settings opt-in cannot submit.
 *
 * HONESTY (non-negotiable):
 *   The published parameters may ONLY modulate:
 *     (a) the four verdict layers' WEIGHTS, inside hard bounds [0.85, 1.15];
 *     (b) the volatility / trailing-pct / ladder-step defaults used by
 *         orderAdvisor and autopilot.
 *   They can never change a stance sentence, a threshold, a confidence
 *   ceiling, or a price level. When training has no data the published
 *   params are a no-op (all multipliers 1.0) and `fallbackHardcoded` is true
 *   — the engine then behaves exactly as it did before this feature existed.
 */

/* -------------------------------------------------------------------------- */
/* record vocabulary                                                          */
/* -------------------------------------------------------------------------- */

export const STANCES = ['tailwind', 'mildUp', 'unclear', 'mildDown', 'headwind'];
export const HORIZONS = ['short', 'long'];
export const REGIMES = ['riskOn', 'btcLed', 'rotationOut', 'riskOff', 'unknown'];

/** The five return buckets — coarse on purpose: 5 buckets, not 100 floats. */
export const RETURN_BUCKETS = ['up5', 'up2', 'flat', 'dn2', 'dn5'];
export const RESOLUTION_KEYS = ['1', '7', '30'];

/** Midpoint of each bucket in percent, used for magnitudes in training. */
export const BUCKET_MID = { up5: 7.5, up2: 3.5, flat: 0, dn2: -3.5, dn5: -7.5 };

/** Map a percent return to its bucket. Mirrored in src/lib/learning.js. */
export function bucketReturn(pct) {
  if (pct >= 5) return 'up5';
  if (pct >= 2) return 'up2';
  if (pct <= -5) return 'dn5';
  if (pct <= -2) return 'dn2';
  return 'flat';
}

/** The direction a stance claims, as -1/0/+1. "unclear" claims nothing. */
export function directionOf(stance) {
  if (stance === 'tailwind' || stance === 'mildUp') return 1;
  if (stance === 'headwind' || stance === 'mildDown') return -1;
  return 0;
}

/** The direction an observed bucket actually went, as -1/0/+1. */
export function bucketSign(bucket) {
  if (bucket === 'up5' || bucket === 'up2') return 1;
  if (bucket === 'dn5' || bucket === 'dn2') return -1;
  return 0;
}

/* -------------------------------------------------------------------------- */
/* storage windows                                                            */
/* -------------------------------------------------------------------------- */

/** Training reads only this many days back (the rolling data window). */
export const WINDOW_DAYS = 60;
/** buckets.ndjson rolls to a dated file at this many records (~12 MB). */
export const ROLL_LIMIT = 100_000;
/** Published params files older than this are deleted inside the same cron run. */
export const PRUNE_DAYS = 90;
/** Dated bucket files older than the window (+ margin) are pruned too, so the
 *  "rolling window" actually rolls instead of growing forever. */
export const BUCKET_PRUNE_DAYS = WINDOW_DAYS + 30;
/** Below this many resolved records, training publishes a hardcoded no-op. */
export const MIN_TRAIN = 200;
/** A weights-snapshot needs this many resolved records before it counts. */
export const MIN_SNAPSHOT = 30;

/* -------------------------------------------------------------------------- */
/* safety bounds — the hard edges the model may never cross                   */
/* -------------------------------------------------------------------------- */

export const LAYER_KEYS = ['technical', 'historical', 'structural', 'macro'];

/** Per-layer weight multipliers live in [0.85, 1.15] and nowhere else. */
export const LAYER_MIN_MULT = 0.85;
export const LAYER_MAX_MULT = 1.15;
/** The heuristic attribution delta is even tighter (±0.08). */
export const ATTR_MAX_DELTA = 0.08;

export const ORDER_BOUNDS = {
  trailMult: [0.85, 1.15],
  stopBufferMult: [0.85, 1.15],
  ladderStepDiv: [2.4, 3.6] // default 3 — span% / 3 rungs today
};

/** The client consent token format. `ct1:` + 32 hex chars, generated at opt-in. */
export const CONSENT_RE = /^ct1:[0-9a-f]{32}$/;

/* -------------------------------------------------------------------------- */
/* params shape                                                               */
/* -------------------------------------------------------------------------- */

export const PARAMS_VERSION = 1;

function noopLayers() {
  const one = { technical: 1, historical: 1, structural: 1, macro: 1 };
  return { short: { ...one }, long: { ...one } };
}

/** The no-op parameter vector — identical behaviour to today. */
export function defaultParams({ version = 0, trainedAt = null, records = 0 } = {}) {
  return {
    v: PARAMS_VERSION,
    version,
    trainedAt,
    windowDays: WINDOW_DAYS,
    records,
    auc: null,
    fallbackHardcoded: true,
    layers: noopLayers(),
    order: { trailMult: 1, ladderStepDiv: 3, stopBufferMult: 1 },
    calibration: { k: null, b: null }
  };
}

export function paramsAreNoop(params) {
  if (!params?.layers) return true;
  const eps = 1e-9;
  for (const h of HORIZONS) {
    for (const k of LAYER_KEYS) {
      if (Math.abs((params.layers[h]?.[k] ?? 1) - 1) > eps) return false;
    }
  }
  const o = params.order ?? {};
  return Math.abs((o.trailMult ?? 1) - 1) <= eps
    && Math.abs((o.stopBufferMult ?? 1) - 1) <= eps
    && Math.abs((o.ladderStepDiv ?? 3) - 3) <= eps;
}

const num = (v, d) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
};
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/**
 * Defensive parse of anything that might come out of Blob (or a test).
 * Returns a fully-bounded params object, or null for non-object garbage.
 * The client applies its own identical clamps — this is defence in depth,
 * never the only line of defence.
 */
export function sanitizeParams(raw) {
  if (!raw || typeof raw !== 'object') return null;
  try {
    const layers = {};
    for (const h of HORIZONS) {
      const src = raw.layers?.[h];
      const row = {};
      for (const k of LAYER_KEYS) {
        row[k] = clamp(num(src?.[k], 1), LAYER_MIN_MULT, LAYER_MAX_MULT);
      }
      layers[h] = row;
    }
    const order = {
      trailMult: clamp(num(raw.order?.trailMult, 1), ...ORDER_BOUNDS.trailMult),
      stopBufferMult: clamp(num(raw.order?.stopBufferMult, 1), ...ORDER_BOUNDS.stopBufferMult),
      ladderStepDiv: clamp(num(raw.order?.ladderStepDiv, 3), ...ORDER_BOUNDS.ladderStepDiv)
    };
    return {
      v: PARAMS_VERSION,
      version: Math.max(0, Math.floor(num(raw.version, 0))),
      trainedAt: typeof raw.trainedAt === 'string' ? raw.trainedAt : null,
      windowDays: num(raw.windowDays, WINDOW_DAYS),
      records: Math.max(0, Math.floor(num(raw.records, 0))),
      auc: raw.auc == null ? null : clamp(num(raw.auc, 0), 0, 1),
      fallbackHardcoded: Boolean(raw.fallbackHardcoded),
      layers,
      order,
      calibration: {
        k: raw.calibration?.k == null ? null : num(raw.calibration.k, 1),
        b: raw.calibration?.b == null ? null : num(raw.calibration.b, 0)
      }
    };
  } catch {
    return null;
  }
}

/* -------------------------------------------------------------------------- */
/* record validation                                                          */
/* -------------------------------------------------------------------------- */

const COIN_RE = /^[0-9a-f]{6,16}$/;
const SNAPSHOT_RE = /^(hc|p[0-9]{1,6})$/;

/**
 * Validate a SIGNAL record coming from the telemetry hook.
 *
 * Returns a frozen, minimal record — the exact bytes that get appended — or
 * null when the submission is malformed. Nothing here touches a user.
 */
export function validateSignal(body) {
  if (!body || typeof body !== 'object') return null;
  const { t: _t, c, h, s, p, g, w, ts } = body;
  if (typeof c !== 'string' || !COIN_RE.test(c)) return null;
  if (!HORIZONS.includes(h)) return null;
  if (!STANCES.includes(s)) return null;
  const conf = Number(p);
  if (!Number.isFinite(conf) || conf < 0 || conf > 100) return null;
  if (typeof g !== 'string' || g.length > 16) return null;
  const regime = REGIMES.includes(g) ? g : 'unknown';
  if (typeof w !== 'string' || !SNAPSHOT_RE.test(w)) return null;
  const at = Number(ts);
  if (!Number.isFinite(at) || at < Date.now() - 48 * 3600 * 1000 || at > Date.now() + 5 * 60 * 1000) return null;
  return Object.freeze({
    t: 's', c, h, s, p: Math.round(conf), g: regime, w, ts: Math.floor(at)
  });
}

/**
 * Validate a RESOLUTION record — the observed outcome, submitted lazily on a
 * later visit once the horizon has elapsed. The server never stores who or
 * which device; training joins signal↔resolution by (c, h, ts).
 */
export function validateResolution(body) {
  if (!body || typeof body !== 'object') return null;
  const { t: _t, c, h, ts, r } = body;
  if (typeof c !== 'string' || !COIN_RE.test(c)) return null;
  if (!HORIZONS.includes(h)) return null;
  const at = Number(ts);
  if (!Number.isFinite(at) || at < Date.now() - 90 * 24 * 3600 * 1000 || at > Date.now() + 5 * 60 * 1000) return null;
  if (!r || typeof r !== 'object') return null;
  const out = {};
  let any = false;
  for (const key of RESOLUTION_KEYS) {
    if (r[key] == null) continue;
    if (!RETURN_BUCKETS.includes(r[key])) return null;
    out[key] = r[key];
    any = true;
  }
  if (!any) return null;
  return Object.freeze({ t: 'r', c, h, ts: Math.floor(at), r: out });
}

/** One line per record; every record must stay well under 120 bytes. */
export const MAX_RECORD_BYTES = 120;

export function recordToLine(rec) {
  return JSON.stringify(rec) + '\n';
}

export function lineToRecord(line) {
  const s = String(line).trim();
  if (!s) return null;
  try {
    const o = JSON.parse(s);
    return o && typeof o === 'object' ? o : null;
  } catch {
    return null;
  }
}
