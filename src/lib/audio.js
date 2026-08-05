/**
 * CRYPTO RADIO — client side.
 * ---------------------------------------------------------------------------
 * Thin, on purpose. All the parsing and the station list live in
 * `server/audio.js`: four RSS documents per visitor on a mobile connection is
 * exactly what a backend exists to avoid, and doing it there means one fetch
 * is cached for everybody.
 */

const API_BASE = (typeof import.meta !== 'undefined' && import.meta.env?.VITE_API_BASE) || '/api';

/** Episodes across every station, newest first. */
export async function getAudio({ timeout = 15000 } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await fetch(`${API_BASE}/audio`, {
      signal: ctrl.signal,
      headers: { accept: 'application/json' }
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
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
