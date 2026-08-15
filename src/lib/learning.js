/**
 * LEARNING CORE — client half (~1 KB gzipped).
 * ---------------------------------------------------------------------------
 * Three jobs, none of them allowed to slow the app down or change its words:
 *
 *  1. FETCH the published params ONCE per session (memoised; the endpoint is
 *     served from memory on the server, so this is one tiny GET) and turn
 *     them into a verdict `tune` ({ layers: { short, long } }) and an order
 *     `tune` ({ trailMult, ladderStepDiv, stopBufferMult }). When the model
 *     is missing, stale, not trained, or unparseable, both return null and
 *     the engine behaves EXACTLY as it did before this feature.
 *
 *  2. TELEMETRY — strictly opt-in. When settings.contributeTelemetry is on,
 *     the verdict panel submits one anonymized SIGNAL record per coin per
 *     horizon per day, and — on a later visit once the horizon has elapsed —
 *     one RESOLUTION record with the observed bucketed return. The payload
 *     has no address, no key, no IP, no user identifier: the coin becomes a
 *     deterministic 8-hex hash of its public id, and the weights snapshot is
 *     'hc' (hardcoded) or 'p{version}'. Every submission carries the
 *     device-local consent token minted by the Settings flow; the server
 *     rejects submissions without it (401). All of this is fire-and-forget
 *     and never throws.
 *
 *  3. BADGE data — VerdictPanel reads the manifest to print the faint
 *     "Calibrated on the last N outcomes — model v{date}" footnote.
 *
 * The bucketing rules below MUST stay in lock-step with
 * server/learning/schema.js (bucketReturn + CONSENT_RE); there is no shared
 * module between the client bundle and the server on purpose, and the tests
 * assert both sides agree.
 */

import { useSettingsStore } from '../store/useSettingsStore';

const PARAMS_URL = '/api/learning/params';
const TELEMETRY_KEY = 'fbt-telemetry-v1';
const DAY_MS = 24 * 3600 * 1000;
const WINDOW_MS = 60 * DAY_MS; // outcomes older than the training window are pointless

/* ------------------------------- params ---------------------------------- */

let paramsCache = null;
let paramsPromise = null;

/** Fetch the published params once per session. Never throws. */
export function loadLearningParams(force = false) {
  if (paramsCache && !force) return Promise.resolve(paramsCache);
  if (paramsPromise) return paramsPromise;
  paramsPromise = fetch(PARAMS_URL, { headers: { accept: 'application/json' } })
    .then((r) => (r.ok ? r.json() : null))
    .catch(() => null)
    .then((data) => {
      paramsCache = data;
      return data;
    })
    .finally(() => {
      paramsPromise = null;
    });
  return paramsPromise;
}

const num = (v, d) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
};
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/** The active weights snapshot id recorded on every signal record. */
export function weightsSnapshotId(data) {
  return data?.model && data?.params ? `p${data.params.version}` : 'hc';
}

/**
 * Verdict tune: per-horizon per-layer weight multipliers, or null when the
 * model is not in effect (missing / fallback / malformed). Callers pass the
 * result straight to verdict({ tune }).
 */
export function layerTune(data) {
  if (!data?.model || !data?.params?.layers) return null;
  const layers = {};
  for (const h of ['short', 'long']) {
    const row = data.params.layers[h];
    if (!row || typeof row !== 'object') continue;
    layers[h] = {};
    for (const k of ['technical', 'historical', 'structural', 'macro']) {
      layers[h][k] = clamp(num(row[k], 1), 0.85, 1.15);
    }
  }
  return { layers };
}

/** Order tune for orderAdvisor/autopilot, or null. */
export function orderTune(data) {
  if (!data?.model || !data?.params?.order) return null;
  const o = data.params.order;
  return {
    trailMult: clamp(num(o.trailMult, 1), 0.85, 1.15),
    stopBufferMult: clamp(num(o.stopBufferMult, 1), 0.85, 1.15),
    ladderStepDiv: clamp(num(o.ladderStepDiv, 3), 2.4, 3.6)
  };
}

/* ------------------------------- telemetry ------------------------------- */

/** Deterministic 8-hex hash of a coin's public id — never a user fingerprint. */
export function anonCoinId(id) {
  let h = 5381;
  const s = String(id ?? '');
  for (let i = 0; i < s.length; i += 1) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
  return (h >>> 0).toString(16).padStart(8, '0');
}

/** Must match server/learning/schema.js bucketReturn(). */
export function bucketReturn(pct) {
  if (pct >= 5) return 'up5';
  if (pct >= 2) return 'up2';
  if (pct <= -5) return 'dn5';
  if (pct <= -2) return 'dn2';
  return 'flat';
}

function consentToken() {
  const s = useSettingsStore.getState();
  return s.contributeTelemetry ? s.telemetryToken : '';
}

function telemetryMap() {
  try {
    return JSON.parse(localStorage.getItem(TELEMETRY_KEY) || '{}');
  } catch {
    return {};
  }
}

function saveTelemetryMap(m) {
  try {
    localStorage.setItem(TELEMETRY_KEY, JSON.stringify(m));
  } catch {
    /* private mode — telemetry just stays off */
  }
}

function post(path, rec) {
  const token = consentToken();
  if (!token) return;
  try {
    fetch(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...rec, consent: token }),
      keepalive: true
    }).catch(() => {});
  } catch {
    /* never let telemetry touch the UI path */
  }
}

const lastClose = (series) => {
  const v = (series ?? []).filter((n) => Number.isFinite(n) && n > 0);
  return v[v.length - 1];
};

/**
 * Called by VerdictPanel whenever a verdict renders. Opt-in only, deduped to
 * one signal per coin per horizon per day, capped and pruned so the map
 * cannot grow forever.
 */
export function telemetrySignal({ coin, horizon, stance, confidence, regime, series, data }) {
  try {
    if (!useSettingsStore.getState().contributeTelemetry) return;
    const px = lastClose(series);
    if (!Number.isFinite(px) || px <= 0) return;
    const c = anonCoinId(coin?.id);
    if (!/^[0-9a-f]{8}$/.test(c)) return;
    const key = `${c}|${horizon}`;
    const m = telemetryMap();
    const day = Math.floor(Date.now() / DAY_MS);
    if (m[key] && Math.floor(m[key].ts / DAY_MS) === day) return; // once/day
    for (const k of Object.keys(m)) {
      if (Date.now() - m[k].ts > WINDOW_MS) delete m[k];
    }
    const keys = Object.keys(m);
    if (keys.length >= 500) {
      // Hard cap so the map cannot grow without bound on a heavy user.
      keys.sort((a, b) => m[a].ts - m[b].ts);
      for (const k of keys.slice(0, keys.length - 500 + 1)) delete m[k];
    }
    m[key] = { ts: Date.now(), px };
    saveTelemetryMap(m);
    post('/api/telemetry/signal', {
      t: 's',
      c,
      h: horizon,
      s: stance,
      p: Math.round(clamp(Number(confidence) || 0, 0, 100)),
      g: regime ?? 'unknown',
      w: weightsSnapshotId(data),
      ts: m[key].ts
    });
  } catch {
    /* no-op */
  }
}

/**
 * Called by VerdictPanel on every verdict render. For each pending signal
 * whose horizon has elapsed, computes the return from the price stored at
 * signal time and submits a resolution record. The record is marked done once
 * its longest horizon has elapsed.
 */
export function telemetryResolve({ coin, series }) {
  try {
    if (!useSettingsStore.getState().contributeTelemetry) return;
    const c = anonCoinId(coin?.id);
    if (!/^[0-9a-f]{8}$/.test(c)) return;
    const px = lastClose(series);
    if (!Number.isFinite(px) || px <= 0) return;
    const m = telemetryMap();
    let changed = false;
    const now = Date.now();
    for (const h of ['short', 'long']) {
      const rec = m[`${c}|${h}`];
      if (!rec || rec.done || !Number.isFinite(rec.px) || rec.px <= 0) continue;
      const horizons = h === 'short' ? [1, 7] : [7, 30];
      for (const days of horizons) {
        if (now - rec.ts < days * DAY_MS) continue;
        const pct = ((px - rec.px) / rec.px) * 100;
        post('/api/telemetry/resolve', { t: 'r', c, h, ts: rec.ts, r: { [days]: bucketReturn(pct) } });
        changed = true;
      }
      if (now - rec.ts >= horizons[horizons.length - 1] * DAY_MS) rec.done = true;
    }
    if (changed) saveTelemetryMap(m);
  } catch {
    /* no-op */
  }
}
