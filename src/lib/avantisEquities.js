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

const API_BASE = (typeof import.meta !== 'undefined' && import.meta.env?.VITE_API_BASE) || '/api';

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
