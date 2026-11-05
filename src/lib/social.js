/**
 * SOCIAL — client for the read-only Bluesky screen.
 * ---------------------------------------------------------------------------
 * Everything here goes through our own `/api/social*` routes, never straight
 * to Bluesky. See server/social.js for the reasoning; the short version is one
 * shared cache (so a feed refresh costs the user base one upstream request per
 * five minutes instead of one each), one filter (unfiltered crypto search is
 * mostly hashtag spam), and one place that knows which upstream host actually
 * answers search.
 *
 * ─── NOTHING HERE WRITES ───────────────────────────────────────────────────
 * There is no like, no repost, no reply, no post. Writing needs the user's
 * session token, which is the one credential this project does not hold.
 * `composeUrl()` hands the draft to Bluesky's own composer instead.
 *
 * ─── NOTHING HERE LOADS REMOTE MEDIA ──────────────────────────────────────
 * No avatars, no post images. A remote <img> would tell the poster's server
 * our user's IP and give a stranger a slot to display anything inside our app.
 * The cards show an initial and a "has media" marker instead.
 */
import { apiBase } from './apiBase';

/** Bluesky's web client — where a post is actually answered. */
export const BSKY_HOME = 'https://bsky.app';

/** Composer with the draft pre-filled. Nothing is published until the user
 *  reads it and presses Post inside Bluesky. */
export function composeUrl(text = '') {
  const clipped = String(text).slice(0, 280);
  return `${BSKY_HOME}/intent/compose?text=${encodeURIComponent(clipped)}`;
}

/** One abortable JSON GET. Never throws: a dead feed must not break the app. */
async function getJson(path, { timeout = 12000 } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await fetch(`${apiBase()}${path}`, {
      signal: ctrl.signal,
      headers: { accept: 'application/json' }
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Read one topic tab.
 *
 * @returns {Promise<{rows: Array, live: boolean}>} `live:false` means the
 *          request failed — the screen shows a retry, not an empty feed.
 */
export async function fetchTopic(topic = 'forYou', limit = 25) {
  const data = await getJson(`/social?topic=${encodeURIComponent(topic)}&limit=${limit}`);
  if (!data) return { rows: [], live: false };
  return { rows: Array.isArray(data.rows) ? data.rows : [], live: true };
}

/** Free-text search across posts and accounts. */
export async function search(term, limit = 25) {
  const data = await getJson(`/social/search?q=${encodeURIComponent(term)}&limit=${limit}`);
  if (!data) return { posts: [], accounts: [], live: false };
  return {
    posts: Array.isArray(data.posts) ? data.posts : [],
    accounts: Array.isArray(data.accounts) ? data.accounts : [],
    live: true
  };
}

/** One account's recent posts. */
export async function fetchProfile(actor, limit = 20) {
  const data = await getJson(`/social/profile/${encodeURIComponent(actor)}?limit=${limit}`);
  if (!data) return { rows: [], live: false };
  return { rows: Array.isArray(data.rows) ? data.rows : [], live: true };
}

/** One thread: the post and its replies. */
export async function fetchThread(uri, limit = 20) {
  const data = await getJson(`/social/thread?uri=${encodeURIComponent(uri)}&limit=${limit}`);
  if (!data) return { root: null, replies: [], live: false };
  return { root: data.root ?? null, replies: Array.isArray(data.replies) ? data.replies : [], live: true };
}

/** The platform's own trending list — deliberately not crypto-filtered. */
export async function fetchTrending(limit = 6) {
  const data = await getJson(`/social/trending?limit=${limit}`);
  return Array.isArray(data?.topics) ? data.topics : [];
}
