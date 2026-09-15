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
import { isNativeShell, publicAppUrl } from './nativeShell.js';

/**
 * Is `value` an origin a packaged app can actually reach?
 *
 * Inside the APK the page origin is `https://localhost` (Capacitor's
 * androidScheme), so the values below are not "a different environment" — they
 * are guaranteed failures:
 *
 *   • a RELATIVE base ('/api', 'api') resolves against https://localhost and
 *     404s on the phone's own asset server — the original bug this module
 *     exists for, re-introduced through a build variable instead of the code;
 *   • `http://…`/`https://localhost`/`127.0.0.1` point at the phone itself.
 *
 * Rejected rather than trusted, for the same reason `publicAppUrl()` refuses a
 * stale `VITE_PUBLIC_URL`: a build-time variable that outlives the code that
 * set it is not evidence about production.
 *
 * A staging origin on a real host stays valid — this is not an allowlist.
 */
export function reachableFromNativeShell(value) {
  if (!/^https?:\/\//i.test(value)) return false;
  let host = '';
  try {
    host = new URL(value).hostname;
  } catch {
    return false;
  }
  if (!host) return false;
  if (/^(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])$/i.test(host)) return false;
  /* http:// is also wrong in the shell: androidScheme is https, so the
     WebView blocks the mixed-content request outright. */
  return /^https:\/\//i.test(value);
}

export function apiBase() {
  const configured =
    typeof import.meta !== 'undefined' ? String(import.meta.env?.VITE_API_BASE || '').trim() : '';
  const native = isNativeShell();
  /* On the web an explicit override wins exactly as before — including a
     relative one, which is correct there. Inside the native shell the value
     has to be an absolute, https, non-loopback origin or it is ignored. */
  if (configured && (!native || reachableFromNativeShell(configured))) {
    return configured.replace(/\/+$/, '');
  }
  return native ? publicAppUrl('/api') : '/api';
}
