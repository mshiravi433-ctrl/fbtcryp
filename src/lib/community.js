import { apiBase } from './apiBase';
/**
 * COMMUNITY FEED — client.
 * ---------------------------------------------------------------------------
 * Reads /api/community, which proxies public Farcaster hubs. See
 * server/farcaster.js for why the feed is hosted by the protocol rather than
 * by us: cost (our free storage tier runs out at roughly fifty users) and
 * liability (hosting posts makes us the publisher).
 *
 * This is READ-ONLY by design. There is no post, reply or like call here, and
 * adding one would mean holding a user's Farcaster signing key — the one
 * credential that can speak as them. Writing happens in a real Farcaster
 * client, which is what the link on each row is for.
 */


/** Where a reader goes to reply or to make an account. */
export const FARCASTER_HOME = 'https://farcaster.xyz';

/**
 * Load one channel.
 *
 * Never throws. A dead feed must leave the screen usable — the community tab
 * is the least important thing on this page and must never be able to take
 * the swap screen down with it.
 *
 * @returns {Promise<{rows: Array, live: boolean}>}
 */
export async function fetchCommunity(channel = 'crypto', limit = 20) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 12000);
  try {
    const res = await fetch(
      `${apiBase()}/community?channel=${encodeURIComponent(channel)}&limit=${limit}`,
      { signal: ctrl.signal, headers: { accept: 'application/json' } }
    );
    if (!res.ok) return { rows: [], live: false };
    const data = await res.json();
    return { rows: Array.isArray(data?.rows) ? data.rows : [], live: true };
  } catch {
    return { rows: [], live: false };
  } finally {
    clearTimeout(timer);
  }
}
