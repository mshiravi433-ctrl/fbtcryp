/**
 * The one place that answers "where is the API?".
 *
 * ─── WHY THIS EXISTS ──────────────────────────────────────────────────────
 * Ten modules used to each open-code
 *
 *     import.meta.env?.VITE_API_BASE || '/api'
 *
 * and inside the packaged Android app that is wrong: the WebView serves the
 * bundle from `https://localhost` (Capacitor's androidScheme), so a relative
 * `/api/calm` resolves to `https://localhost/api/calm`, which is the phone's
 * OWN static asset server — a guaranteed 404. Browser code must never end up
 * calling localhost for our backend.
 *
 * Market data survived this by accident: lib/api.js falls back to the public
 * CoinGecko endpoints, so the failure was invisible there while /api/calm,
 * /api/audio, /api/news and /api/news/whales simply 404ed and their panels
 * rendered empty. That is exactly how the Calm tab "lost" its music on
 * Android while the market screen looked fine.
 *
 * Resolution order:
 *   1. VITE_API_BASE (explicit build-time override, e.g. a staging backend)
 *   2. The canonical production origin, when running inside the native shell
 *   3. '/api' — same-origin, the ordinary web case (Vercel rewrites handle it)
 */
import { isNativeShell, publicAppUrl } from './nativeShell';

export function apiBase() {
  const configured =
    typeof import.meta !== 'undefined' ? String(import.meta.env?.VITE_API_BASE || '').trim() : '';
  if (configured) return configured.replace(/\/+$/, '');
  return isNativeShell() ? publicAppUrl('/api') : '/api';
}
