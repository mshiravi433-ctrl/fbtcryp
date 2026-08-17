/**
 * CRYPTO RADIO — client side.
 * ---------------------------------------------------------------------------
 * Thin, on purpose. All the parsing and the station list live in
 * `server/audio.js`: four RSS documents per visitor on a mobile connection is
 * exactly what a backend exists to avoid, and doing it there means one fetch
 * is cached for everybody.
 *
 * ─── WHY apiBase() INSTEAD OF A LOCAL CONSTANT ────────────────────────────
 * The APK serves the app from `https://localhost` (Capacitor), so a bare
 * relative '/api' — which is what this file used to build — resolved to
 * `https://localhost/api/calm`, the phone's own static asset server: a
 * guaranteed 404, and the whole Calm tab then rendered nothing. On the web
 * apiBase() IS the relative '/api'; inside the native shell it is the
 * canonical production origin. Browser-facing code must never call localhost.
 */
import { apiBase } from './apiBase';

/** Episodes across every station, newest first. */
export async function getAudio({ timeout = 15000 } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await fetch(`${apiBase()}/audio`, {
      signal: ctrl.signal,
      headers: { accept: 'application/json' }
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

/*
 * CALM — short client-side session cache.
 *
 * Switching News tabs unmounts and remounts CalmPanel. Without this, every
 * remount cost a full round-trip and re-painted the skeleton over data we
 * already had — which read as flicker on the very tab that exists to be calm.
 * The server caches the catalogue for six hours, so five minutes here changes
 * nothing about freshness and everything about perceived stability.
 *
 * Failures are NOT cached: a network hiccup must not pin the tab empty, and
 * the Retry button must always reach the network.
 */
let calmCache = null;
const CALM_CLIENT_TTL = 5 * 60 * 1000;

/** Forget the cached calm payload so the next getCalm() hits the network. */
export function invalidateCalmCache() {
  calmCache = null;
}

/**
 * Calm music — same shape as `getAudio`, different endpoint.
 *
 * Returns items that are field-for-field compatible with the podcast items,
 * which is what lets one `AudioPlayer` and one list renderer serve both. A
 * separate track type would have meant a second player, and two players means
 * two episodes can end up playing at once.
 *
 * `force` bypasses the short session cache (soft refresh, the Retry button).
 * The server additionally accepts ?force=1 to skip its own READ of the
 * long-lived cache, so a poisoned empty cache entry cannot sit on users for
 * six hours — see server/app.js.
 *
 * Throws on HTTP / network failure: the panel distinguishes loading, error
 * and genuinely-empty, and "error" is a state with a Retry button, not a
 * silently blank tab.
 */
export async function getCalm({ timeout = 15000, force = false } = {}) {
  if (!force && calmCache && Date.now() - calmCache.at < CALM_CLIENT_TTL) {
    return calmCache.data;
  }

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await fetch(`${apiBase()}/calm${force ? '?force=1' : ''}`, {
      signal: ctrl.signal,
      headers: { accept: 'application/json' }
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    /* Only a payload with at least one track is worth remembering. An empty
       list may be a transient upstream problem (server/calm.js fails closed
       on archive.org trouble), and caching it would hide every recovery. */
    if (Array.isArray(data?.items) && data.items.length > 0) {
      calmCache = { at: Date.now(), data };
    }
    return data;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Seconds → `H:MM:SS` or `M:SS`.
 *
 * Returns null rather than "0:00" when the duration is unknown, because the
 * feeds genuinely do omit `itunes:duration` sometimes and a confident "0:00"
 * next to a play button reads as a broken file rather than missing metadata.
 */
export function fmtDuration(sec) {
  if (!Number.isFinite(sec) || sec <= 0) return null;
  const s = Math.round(sec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  const pad = (n) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(r)}` : `${m}:${pad(r)}`;
}
