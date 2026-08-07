/**
 * LEADERBOARD CLIENT
 * ---------------------------------------------------------------------------
 * The board used to be entirely local seed data with a notice underneath
 * admitting it was fake. That notice was the right call at the time — passing
 * invented names off as traders is worse than an empty list — but the honest
 * fix is a real board, not a smaller lie.
 *
 * So: the API now stores scores (`server/store.js`), this module reads and
 * writes them, and the seed rows only ever appear as *padding* below the real
 * entries on a brand-new deployment, visually separated and labelled. When the
 * backend is unreachable we fall back to the last board cached on the device
 * and say so, instead of silently showing stale ranks as if they were live.
 *
 * Identity: the verified Telegram user id when we are inside Telegram,
 * otherwise a random client id generated once per install. The server records
 * which one it was, and unverified rows are marked as such — anyone can POST a
 * number to a public endpoint, and hiding that would make the whole board
 * meaningless.
 */

import { tierFor } from './ranks';

const API_BASE = (typeof import.meta !== 'undefined' && import.meta.env?.VITE_API_BASE) || '/api';
const CACHE_KEY = 'fbt-leaderboard-v1';
const CLIENT_KEY = 'fbt-client-id';

export function clientId() {
  try {
    let id = localStorage.getItem(CLIENT_KEY);
    if (!id) {
      id = crypto.randomUUID?.() ?? `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
      localStorage.setItem(CLIENT_KEY, id);
    }
    return id;
  } catch {
    return 'anonymous';
  }
}

async function jfetch(path, init, timeout = 9000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await fetch(`${API_BASE}${path}`, { ...init, signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

function readCache() {
  try {
    return JSON.parse(localStorage.getItem(CACHE_KEY) || 'null');
  } catch {
    return null;
  }
}

function writeCache(payload) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(payload));
  } catch {
    /* nothing to do */
  }
}

/**
 * Fetch the board.
 * @returns {Promise<{rows: Array, live: boolean, durable: boolean, at: number}>}
 */
export async function fetchLeaderboard() {
  try {
    const data = await jfetch('/leaderboard');
    const rows = Array.isArray(data?.rows) ? data.rows : [];
    const payload = { rows, live: true, durable: Boolean(data?.durable), at: data?.at ?? Date.now() };
    writeCache(payload);
    return payload;
  } catch {
    const cached = readCache();
    if (cached?.rows?.length) return { ...cached, live: false };
    return { rows: [], live: false, durable: false, at: 0 };
  }
}

/**
 * Publish this user's score.
 *
 * Fire-and-forget by design: a failed submission must never block the screen
 * or surface an error, because the user did not ask to submit anything — it
 * happens as a side effect of opening the page.
 */
export async function publishScore({ name, points, swaps = 0, referrals = 0, telegramInitData }) {
  if (!points && !name) return null;
  try {
    return await jfetch('/leaderboard', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(telegramInitData ? { 'x-telegram-init-data': telegramInitData } : {})
      },
      body: JSON.stringify({ name, points, swaps, referrals, clientId: clientId() })
    });
  } catch {
    return null;
  }
}

/** Merge the server rows with the local user and attach rank + tier. */
export function decorate(rows, { points = 0, username = '' } = {}) {
  const mine = clientId();

  /*
   * ─── REAL BUG: THE USER APPEARED ON THE BOARD TWICE ───────────────────────
   * This used to look for `anon:${mine}`. The server never writes that. In
   * server/app.js the row id is:
   *
   *   const id = tgId ? `tg:${tgId}` : clientId.slice(0, 64);
   *
   * — the BARE client id for an anonymous user, with no prefix. So the match
   * never fired on our own server row, the "not on the board yet" fallback
   * below then appended a SECOND local row, and the user was listed twice:
   * once with their synced score and once with their local one. Reproduced
   * against the live response shape before changing anything.
   *
   * The old expression was also self-contradicting — a ternary whose condition
   * and whose branch tested the same thing — which is how it survived review.
   *
   * Both id shapes are accepted now: `tg:<id>` for a Telegram-verified row and
   * the bare client id for an anonymous one. `anon:` is kept only so a row
   * cached by an older build still matches instead of duplicating.
   */
  const isMine = (id) => {
    if (typeof id !== 'string' || !id) return false;
    return id === mine || id === `anon:${mine}` || (id.startsWith('tg:') && id.slice(3) === mine);
  };

  const out = rows.map((r) => ({ ...r, isUser: isMine(r.id) }));

  /*
   * Only when our score genuinely is not on the server board yet — a first
   * visit, or a failed publish. Now that `isMine` matches, this stops firing
   * for the common case, which is what removes the duplicate.
   */
  if ((points > 0 || username) && !out.some((r) => r.isUser)) {
    out.push({
      id: mine,
      name: username || 'You',
      points,
      swaps: 0,
      referrals: 0,
      isUser: true,
      pendingSync: true
    });
  }

  /*
   * Sort by points, then by id for a stable order.
   *
   * Without the tiebreak, two users on the same score swap places on every
   * refresh because Array.sort is not required to be stable across engines for
   * equal keys — a board that reshuffles while you watch it looks broken and
   * makes the rank number untrustworthy.
   */
  out.sort((a, b) => (b.points ?? 0) - (a.points ?? 0) || String(a.id).localeCompare(String(b.id)));
  return out.map((r, i) => ({ ...r, rank: i + 1, tier: tierFor(r.points ?? 0) }));
}
