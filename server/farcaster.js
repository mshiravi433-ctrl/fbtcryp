/**
 * FARCASTER — a read-only community feed, hosted by somebody else.
 * ---------------------------------------------------------------------------
 *
 * ─── WHY THIS INSTEAD OF BUILDING A SOCIAL NETWORK ──────────────────────────
 * The review (docs/SOCIAL-AND-P2P-REVIEW-FA.md) measured what our own feed
 * would cost. Vercel Blob's free tier is 10,000 simple operations per MONTH;
 * fifty users opening a feed five times a day is 7,500 reads, and two hundred
 * users is three times over the cap. Beyond money, hosting user posts makes us
 * the publisher: a scam or illegal post in our feed is our problem, and for an
 * app already under store review that is a fresh rejection risk.
 *
 * Farcaster moves both problems off our infrastructure. Reading is free and
 * needs no account, the posts live on their hubs, and moderation is the
 * protocol's concern. We render a feed; we do not host one.
 *
 * ─── NO API KEY, DELIBERATELY ───────────────────────────────────────────────
 * Neynar's hosted API is easier but needs a key, and this project has already
 * had keys rotated, revoked and geo-blocked. Public hubs speak plain HTTP and
 * need nothing. Verified live before writing this: both hosts below answer
 * /v1/info anonymously.
 *
 * ─── WHY TWO HOSTS, IN THIS ORDER ───────────────────────────────────────────
 * Measured, not guessed. hub.pinata.cloud reports a `blockDelay` in the
 * millions — it is far behind the chain — while snap.farcaster.xyz reports a
 * delay of 1-2 blocks. So the official snapshot host is primary and Pinata is
 * only a fallback for when it is unreachable, which is the opposite of what
 * most tutorials suggest.
 *
 * ─── THE THREE API QUIRKS THAT BITE ─────────────────────────────────────────
 * All three were found by calling the real endpoint, not by reading docs:
 *
 *   1. `reverse=true` does NOT reliably sort. The channel query returned
 *      casts from June next to casts from December. We sort by timestamp
 *      ourselves, always.
 *   2. Timestamps are SECONDS SINCE 2021-01-01, not the Unix epoch. Treating
 *      one as Unix time renders every post as 1975.
 *   3. `user_data_type=USER_DATA_TYPE_USERNAME` is ignored — the endpoint
 *      returns every profile field regardless, so the username has to be
 *      picked out of the list client-side.
 */

import { withCache } from './cache.js';

/* Primary first — see the note above about block delay. */
const HUBS = ['https://snap.farcaster.xyz:3381', 'https://hub.pinata.cloud'];

/** Farcaster timestamps count seconds from 2021-01-01T00:00:00Z. */
const FC_EPOCH_MS = 1609459200_000;

/**
 * Channels we surface, as FIP-2 parent URLs.
 *
 * A fixed allow-list rather than a free-text parameter. Letting a caller pass
 * any channel would turn our server into an open proxy for arbitrary
 * Farcaster content — including channels we would not want the app associated
 * with — and it costs us the ability to say what the feed contains.
 */
const CHANNELS = {
  crypto: 'chain://eip155:1/erc721:0x37fb80ef28008704288087831464058a4a3940ae',
  base: 'https://onchainsummer.xyz',
  dev: 'chain://eip155:1/erc721:0x7dd4e31f1530ac682c8ea4d8016e95773e08d8b0'
};

export const CHANNEL_IDS = Object.keys(CHANNELS);

/** 5 minutes. A community feed is not a price — staleness costs nothing. */
const TTL = 5 * 60_000;
const NAME_TTL = 60 * 60_000;

async function hubGet(path) {
  let lastError = null;

  for (const host of HUBS) {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 7000);
      const res = await fetch(`${host}${path}`, {
        headers: { accept: 'application/json' },
        signal: ctrl.signal
      }).finally(() => clearTimeout(timer));

      if (!res.ok) {
        lastError = new Error(`HTTP_${res.status}`);
        continue;
      }
      return await res.json();
    } catch (e) {
      lastError = e;
    }
  }
  throw lastError ?? new Error('HUB_UNREACHABLE');
}

/**
 * Resolve a numeric fid to a username.
 *
 * Cached for an hour: names change rarely, and without this a 20-cast feed
 * would make 20 extra requests on every refresh.
 */
async function usernameFor(fid) {
  const { value } = await withCache(`fc:name:${fid}`, NAME_TTL, async () => {
    try {
      const data = await hubGet(`/v1/userDataByFid?fid=${fid}`);
      const messages = Array.isArray(data?.messages) ? data.messages : [];
      /*
       * The type filter in the query string is ignored by the hub, so pick the
       * username out of the returned set. Falling back to the fid means a
       * profile with no username still renders as something stable rather
       * than "undefined".
       */
      const hit = messages.find(
        (m) => m?.data?.userDataBody?.type === 'USER_DATA_TYPE_USERNAME'
      );
      return hit?.data?.userDataBody?.value || null;
    } catch {
      return null;
    }
  });
  return value || `fid:${fid}`;
}

/** Strip anything that could deceive when rendered in our UI. */
// eslint-disable-next-line no-misleading-character-class
const BIDI = /[\u202A-\u202E\u2066-\u2069\u200E\u200F]/g;

function cleanText(value, max = 320) {
  return String(value ?? '')
    .replace(BIDI, '')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .trim()
    .slice(0, max);
}

/**
 * Read one channel.
 *
 * @param {string} channel one of CHANNEL_IDS
 * @param {number} limit   how many casts to return
 */
export async function fetchChannel(channel = 'crypto', limit = 20) {
  const parentUrl = CHANNELS[channel];
  if (!parentUrl) throw new Error('UNKNOWN_CHANNEL');

  const size = Math.min(Math.max(Number(limit) || 20, 1), 30);

  const { value } = await withCache(`fc:feed:${channel}:${size}`, TTL, async () => {
    /*
     * Over-fetch, because empty and reply-only casts are dropped below. Asking
     * for exactly `size` would routinely return a short feed.
     */
    const data = await hubGet(
      `/v1/castsByParent?url=${encodeURIComponent(parentUrl)}&pageSize=${size * 2}&reverse=true`
    );

    const messages = Array.isArray(data?.messages) ? data.messages : [];

    const rows = messages
      .filter((m) => m?.data?.type === 'MESSAGE_TYPE_CAST_ADD')
      .map((m) => {
        const body = m.data.castAddBody ?? {};
        return {
          hash: String(m.hash ?? ''),
          fid: Number(m.data.fid) || 0,
          /* Quirk 2: Farcaster epoch, not Unix. */
          at: FC_EPOCH_MS + (Number(m.data.timestamp) || 0) * 1000,
          text: cleanText(body.text),
          /*
           * Only the count is exposed, never the URLs. Rendering a remote
           * image from an arbitrary poster would leak our users' IPs to
           * whoever hosts it and hand a stranger a slot to display anything
           * they like inside our app.
           */
          embeds: Array.isArray(body.embeds) ? body.embeds.length : 0
        };
      })
      /* Drop image-only and empty casts: with no text there is nothing to read. */
      .filter((r) => r.text.length > 0 && r.hash)
      /* Quirk 1: sort ourselves — `reverse=true` is not dependable. */
      .sort((a, b) => b.at - a.at)
      .slice(0, size);

    /* Resolve names in parallel; each is individually cached and failure-safe. */
    const names = await Promise.all(rows.map((r) => usernameFor(r.fid)));

    return rows.map((r, i) => ({
      ...r,
      author: names[i],
      /* Deep link to the canonical client, so a reader can reply there. */
      url: `https://farcaster.xyz/${names[i]}/${r.hash.slice(0, 10)}`
    }));
  });

  return value;
}
