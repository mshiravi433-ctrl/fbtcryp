/**
 * AVANTIS EQUITIES — client.
 * ---------------------------------------------------------------------------
 * Reads /api/avantis/equities, which proxies two public keyless upstreams:
 * Avantis' own pair table and Pyth Hermes for prices. See server/avantis.js
 * for why the list is built from Avantis rather than UTEX — UTEX geo-blocks
 * our server, so there is no ticker list to read from them at all.
 *
 * READ-ONLY. Nothing here signs, quotes or routes an order. An Avantis
 * position is a leveraged perpetual, opened on Avantis' own site with the
 * user's own wallet; this module exists so the app can SHOW what is listed
 * instead of only advertising that something is listed.
 */

import { apiBase } from './apiBase.js';

/*
 * THE API ORIGIN IS NOT A CONSTANT ANY MORE.
 *
 * This used to read `import.meta.env?.VITE_API_BASE || '/api'`. That is the
 * exact expression lib/apiBase.js was written to replace, and it is wrong in
 * one place only — but the place that matters: inside the packaged Android
 * app the WebView serves the bundle from https://localhost, so a relative
 * '/api' resolves to the phone's OWN static asset server and every request
 * 404s. On the website the same expression is correct (same origin), which is
 * precisely why these modules looked fine and quietly died in the APK.
 *
 * apiBase() answers the question once: VITE_API_BASE when it is a usable
 * absolute origin, the canonical origin inside the native shell, '/api'
 * everywhere else.
 */
const API_BASE = apiBase();

/**
 * Load the equity list.
 *
 * Never throws. This section sits below the tokenised equities on the Stocks
 * screen, and a third-party outage must not be able to blank the part of the
 * page that shows assets the user can actually buy through us.
 *
 * @returns {Promise<{rows: Array, live: boolean}>}
 */
export async function fetchAvantisEquities() {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 12000);
  try {
    const res = await fetch(`${API_BASE}/avantis/equities`, {
      signal: ctrl.signal,
      headers: { accept: 'application/json' }
    });
    if (!res.ok) return { rows: [], live: false };
    const data = await res.json();
    return { rows: Array.isArray(data?.rows) ? data.rows : [], live: true };
  } catch {
    return { rows: [], live: false };
  } finally {
    clearTimeout(timer);
  }
}
