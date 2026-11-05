/**
 * SOCIAL — a READ-ONLY window onto Bluesky, rendered by us instead of a link.
 * ---------------------------------------------------------------------------
 *
 * ─── WHY BLUESKY AND NOT X, IN ONE PARAGRAPH ───────────────────────────────
 * The screen this feeds is modelled on harpy, which died on 2023-02-09 when
 * Twitter removed free API access, and then permanently on 2023-04-07 when
 * Twitter blocked third-party clients. That ban (X Developer Agreement, the
 * "substitute or similar service or product" clause) is still in force, and
 * the current paid API is metered per read — $0.005 per third-party post. A
 * twenty-post feed at fifty users, five opens a day, is around $750 a month
 * for content that earns nothing. Bluesky needs no key, no approval and no
 * payment for public reads. The full numbers are in
 * docs/SOCIAL-HARPY-STYLE-REVIEW-FA.md and
 * docs/SOCIAL-SCREEN-FEATURES-WRITE-AND-COST-FA.md.
 *
 * ─── WHY THE SERVER PROXIES AT ALL, GIVEN THE BROWSER COULD ASK DIRECTLY ───
 * Three reasons, all of them about not letting a stranger's feed control our
 * traffic profile:
 *
 *   1. ONE shared cache. Without it every visitor is one upstream request;
 *      with it a five-minute window costs one request for everyone.
 *   2. ONE filter. Spam is the dominant content in crypto search (measured:
 *      an unfiltered `lang=fa` query returns hashtag bombs — #fypシ゚viralシ,
 *      #wolink, #viralreelschallenge). Filtering in the client is a suggestion;
 *      filtering here is a guarantee.
 *   3. ONE place that knows the upstream host. `public.api.bsky.app` is the
 *      host Bluesky's docs recommend, but it answers search with a 403 and an
 *      HTML body; `api.bsky.app` works. Verified by calling both. Pinning that
 *      here means the correction cannot get lost in a component.
 *
 * ─── WHAT THIS MODULE DELIBERATELY DOES NOT DO ─────────────────────────────
 * No writes, no likes, no session, no user key. Posting is handed to Bluesky's
 * own composer through an intent URL. Holding a user's session token would let
 * us speak as them, which is the exact credential this project has refused to
 * hold on every other surface. There is also no image proxy (avatars are not
 * rendered — see the request handler) and no websocket to the firehose.
 */

import { withCache } from './cache.js';

/** Upstream. NOT `public.api.bsky.app` — search is closed there (403 HTML). */
const APPVIEW = 'https://api.bsky.app/xrpc';

/** Canonical web client, used for "open on Bluesky" links. */
export const BSKY_WEB = 'https://bsky.app';

/**
 * Five minutes.
 *
 * A social feed is not a price. Nobody is harmed by reading a post that is
 * five minutes old, and this TTL is the whole traffic budget: it collapses
 * every reader in the window into a single upstream call. Shorter would
 * multiply our upstream requests for no visible gain; longer would make the
 * feed feel dead.
 */
const TTL = 5 * 60_000;
/** Trending topics rotate slowly; a quarter of an hour is fine. */
const TREND_TTL = 15 * 60_000;

/**
 * The tabs.
 *
 * An ALLOW-LIST, not a caller-supplied query. Accepting free text would turn
 * this route into an open proxy that lets anyone make us fetch arbitrary
 * Bluesky content — including things we would not want the app associated
 * with — and it would cost us the ability to say what the feed contains.
 *
 * `queries` are what actually go upstream (each is a plain search term, so
 * `searchPosts` treats it as a relevance query rather than a literal phrase),
 * and `tag`/`lang` narrow it. `fa` is deliberately NOT a `lang=fa` tab: see
 * the spam note in `cleanPost` — the Persian crypto timeline is dominated by
 * hashtag-bombed video spam, so the Persian tab filters on our own vocabulary
 * instead of on the language tag.
 */
const TOPICS = {
  forYou: { queries: ['bitcoin', 'ethereum crypto', 'defi', 'solana'] },
  bitcoin: { queries: ['bitcoin'], tag: 'bitcoin' },
  ethereum: { queries: ['ethereum'], tag: 'ethereum' },
  defi: { queries: ['defi'], tag: 'defi' },
  solana: { queries: ['solana'], tag: 'solana' },
  /* Persian language crypto, WITHOUT `lang=fa`: measured to be ~all spam. */
  fa: { queries: ['بیت کوین', 'ارز دیجیتال', 'کریپتو'] }
};

export const TOPIC_IDS = Object.keys(TOPICS);

/**
 * Strings that mark a post as engagement farming rather than content.
 *
 * Mirrors the hashtags measured in the live `lang=fa` result. Matched
 * case-insensitively against the post text, not just its tags, because
 * spammers paste them without facets often enough to matter.
 */
const SPAM_MARKERS = [
  'fyp',
  'wolink',
  'viralreels',
  'trendingnow',
  'followforfollow',
  'f4f',
  'likeforlike',
  'dm me',
  'dm for',
  'check my bio',
  'link in bio',
  'airdrop claim',
  'double your'
];

/** Accounts whose posts are never useful in a crypto feed. */
const BLOCKED_HANDLES = new Set(['bsky.app']);

const BIDI = /[\u202A-\u202E\u2066-\u2069\u200E\u200F]/g;

/**
 * Make a stranger's string safe for our UI.
 *
 * Same treatment as the Farcaster feed: strip bidi overrides (they can reverse
 * the rendering of a whole row and disguise what a post says), strip control
 * characters, collapse whitespace, cap the length. Rendering happens as text,
 * never as HTML — this function is the second half of that guarantee, not the
 * whole one.
 */
export function cleanText(value, max = 420) {
  return String(value ?? '')
    .replace(BIDI, '')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .trim()
    .slice(0, max);
}

/**
 * Is this post something we are willing to show?
 *
 * Exported for the tests: this is the one function where a mistake is visible
 * to every user, and it is pure, so it can be tested without a network.
 */
export function isWantedPost(post) {
  const text = String(post?.record?.text ?? '').trim();
  if (!text) return false;
  const handle = String(post?.author?.handle ?? '').toLowerCase();
  if (!handle || BLOCKED_HANDLES.has(handle)) return false;
  const lower = text.toLowerCase();
  if (SPAM_MARKERS.some((marker) => lower.includes(marker))) return false;
  /*
   * A wall of tags and nothing else is an advert. Count the words outside
   * hashtags: if there are none, drop it.
   */
  const words = lower.replace(/#[^\s#]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (words.length < 12) return false;
  return true;
}

/** One upstream GET, with a hard timeout so a hung hub cannot hold a lambda. */
async function xrpc(path, params) {
  const url = new URL(`${APPVIEW}/${path}`);
  for (const [key, value] of Object.entries(params ?? {})) {
    if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 7000);
  try {
    const res = await fetch(url, {
      headers: { accept: 'application/json' },
      signal: ctrl.signal
    });
    if (!res.ok) throw new Error(`HTTP_${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Flatten one `app.bsky.feed.defs#postView` into the shape the screen renders.
 *
 * Only what the screen uses. In particular NO avatar, NO image URL and NO
 * video playlist: the chosen build shows no remote media at all, because a
 * remote <img> would hand the poster's host our users' IP addresses and give a
 * stranger a slot to display anything inside our app. The `media` flag exists
 * so the UI can say "has an image" without loading one.
 */
export function normalizePost(post) {
  const rkey = String(post?.uri ?? '').split('/').pop();
  const handle = String(post?.author?.handle ?? '');
  return {
    id: String(post?.uri ?? ''),
    rkey,
    author: {
      handle,
      name: cleanText(post?.author?.displayName || handle, 60),
      did: String(post?.author?.did ?? '')
    },
    at: Date.parse(post?.record?.createdAt ?? post?.indexedAt ?? '') || 0,
    text: cleanText(post?.record?.text),
    likes: Number(post?.likeCount) || 0,
    reposts: Number(post?.repostCount) || 0,
    replies: Number(post?.replyCount) || 0,
    quotes: Number(post?.quoteCount) || 0,
    media: post?.embed ? 1 : 0,
    /* A canonical link, so replying happens on Bluesky and never here. */
    url: handle && rkey ? `${BSKY_WEB}/profile/${encodeURIComponent(handle)}/post/${rkey}` : ''
  };
}

/** Deduplicate by uri — "for you" merges four queries and will overlap. */
function uniquePosts(lists) {
  const seen = new Set();
  const out = [];
  for (const list of lists) {
    for (const post of list) {
      if (!post?.uri || seen.has(post.uri)) continue;
      seen.add(post.uri);
      out.push(post);
    }
  }
  return out;
}

/**
 * Read one topic.
 *
 * `forYou` merges several searches because the merged, deduplicated, newest-
 * first result reads like a home timeline; every other tab is a single query.
 *
 * Never throws for an unknown topic — the caller turns that into a 400 — and
 * never throws on a dead upstream once a cached copy exists (`withCache` keeps
 * the stale entry as a fallback).
 */
export async function fetchTopic(topic, limit = 25) {
  const conf = TOPICS[topic];
  if (!conf) throw new Error('UNKNOWN_TOPIC');

  const size = Math.min(Math.max(Number(limit) || 25, 1), 40);

  const { value } = await withCache(`bsky:topic:${topic}:${size}`, TTL, async () => {
    /*
     * Per-query page size is deliberately small: four queries of size/2 give
     * a better mix than one large page, and the cache means this fan-out runs
     * once per topic per five minutes for the whole user base.
     */
    const perQuery = topic === 'forYou' ? Math.max(10, Math.ceil((size * 2) / conf.queries.length)) : size * 2;

    const pages = await Promise.all(
      conf.queries.map(async (q) => {
        try {
          const data = await xrpc('app.bsky.feed.searchPosts', {
            q,
            limit: Math.min(perQuery, 100),
            tag: conf.tag,
            sort: 'latest'
          });
          return { ok: true, posts: Array.isArray(data?.posts) ? data.posts : [] };
        } catch {
          /* One dead query must not empty the tab. */
          return { ok: false, posts: [] };
        }
      })
    );

    /*
     * ─── ALL-QUERIES-FAILED IS AN OUTAGE, NOT AN EMPTY TAB ─────────────────
     * Each query is caught individually so that one failure cannot blank a
     * merged tab. But if EVERY one failed, reporting `[]` would tell the user
     * "nothing in this tab yet" while the truth is that we could not reach
     * Bluesky at all — and they would have no reason to retry. Throwing here
     * lets `withCache` serve a stale copy if it has one (a five-minute-old
     * feed beats an error) and otherwise surfaces a real offline state.
     */
    if (!pages.some((page) => page.ok)) throw new Error('UPSTREAM_UNAVAILABLE');

    const posts = pages.map((page) => page.posts);

    const rows = uniquePosts(posts)
      .filter(isWantedPost)
      .map(normalizePost)
      .sort((a, b) => b.at - a.at)
      .slice(0, size);

    return rows;
  });

  return value;
}

/** Search posts by free text. Input is caller-supplied, so it is length-capped. */
export async function searchPosts(term, limit = 25) {
  const q = cleanText(term, 80);
  if (q.length < 2) return [];
  const size = Math.min(Math.max(Number(limit) || 25, 1), 40);

  const { value } = await withCache(`bsky:search:${q.toLowerCase()}:${size}`, TTL, async () => {
    const data = await xrpc('app.bsky.feed.searchPosts', { q, limit: size * 2, sort: 'latest' });
    const posts = Array.isArray(data?.posts) ? data.posts : [];
    return posts.filter(isWantedPost).map(normalizePost).sort((a, b) => b.at - a.at).slice(0, size);
  });
  return value;
}

/** Search accounts whose posts we could then show. Names only, no media. */
export async function searchAccounts(term, limit = 12) {
  const q = cleanText(term, 80);
  if (q.length < 2) return [];
  const size = Math.min(Math.max(Number(limit) || 12, 1), 25);

  const { value } = await withCache(`bsky:actors:${q.toLowerCase()}:${size}`, TTL, async () => {
    const data = await xrpc('app.bsky.actor.searchActors', { q, limit: size });
    const actors = Array.isArray(data?.actors) ? data.actors : [];
    return actors
      .filter((actor) => actor?.handle && !BLOCKED_HANDLES.has(String(actor.handle).toLowerCase()))
      .map((actor) => ({
        did: String(actor.did ?? ''),
        handle: String(actor.handle),
        name: cleanText(actor.displayName || actor.handle, 60),
        bio: cleanText(actor.description, 160),
        url: `${BSKY_WEB}/profile/${encodeURIComponent(actor.handle)}`
      }));
  });
  return value;
}

/** One account's recent posts — the profile screen. */
export async function fetchAuthorFeed(handle, limit = 20) {
  const actor = String(handle ?? '').trim();
  /* Handles are [a-z0-9.-] and DIDs are did:plc:/did:web:. Anything else is
     not worth sending upstream. */
  if (!/^(?:[a-z0-9-]+\.)+[a-z]{2,}$|^did:(?:plc|web):[a-z0-9.:%-]+$/i.test(actor)) {
    throw new Error('BAD_ACTOR');
  }
  const size = Math.min(Math.max(Number(limit) || 20, 1), 40);

  const { value } = await withCache(`bsky:feed:${actor}:${size}`, TTL, async () => {
    const data = await xrpc('app.bsky.feed.getAuthorFeed', {
      actor,
      limit: size * 2,
      filter: 'posts_no_replies'
    });
    const feed = Array.isArray(data?.feed) ? data.feed : [];
    return feed
      .map((item) => item?.post)
      .filter(isWantedPost)
      .map(normalizePost)
      .sort((a, b) => b.at - a.at)
      .slice(0, size);
  });
  return value;
}

/**
 * One thread: the post plus its direct replies.
 *
 * Replies are flattened to the same shape as posts, with `depth` so the UI can
 * indent. Only the first two levels are returned — deeper trees are mostly
 * arguments between strangers and cost requests to fetch.
 */
export async function fetchThread(uri, limit = 20) {
  if (!/^at:\/\/did:(?:plc|web):[a-z0-9.:%-]+\/app\.bsky\.feed\.post\/[a-z0-9]+$/i.test(String(uri ?? ''))) {
    throw new Error('BAD_URI');
  }
  const size = Math.min(Math.max(Number(limit) || 20, 1), 30);

  const { value } = await withCache(`bsky:thread:${uri}:${size}`, TTL, async () => {
    const data = await xrpc('app.bsky.feed.getPostThread', { uri, depth: 2, parentHeight: 0 });
    const thread = data?.thread ?? {};
    const root = thread?.post ? normalizePost(thread.post) : null;
    const replies = Array.isArray(thread?.replies)
      ? thread.replies
          .map((reply) => reply?.post)
          .filter(isWantedPost)
          .map((post) => ({ ...normalizePost(post), depth: 1, media: post?.embed ? 1 : 0 }))
          .filter((row) => row.text)
          .slice(0, size)
      : [];
    return { root, replies };
  });
  return value;
}

/**
 * Trending topics.
 *
 * This is the one endpoint whose labels are editorial, not crypto — it is the
 * platform's own list. Exposed so the screen can offer a "what is happening"
 * strip rather than pretending our four tabs are the whole conversation.
 */
export async function fetchTrending(limit = 8) {
  const size = Math.min(Math.max(Number(limit) || 8, 1), 20);

  const { value } = await withCache(`bsky:trending:${size}`, TREND_TTL, async () => {
    const data = await xrpc('app.bsky.unspecced.getTrendingTopics', { limit: size });
    const topics = Array.isArray(data?.topics) ? data.topics : [];
    return topics.map((topic) => ({
      topic: cleanText(topic?.topic, 70),
      label: cleanText(topic?.displayName || topic?.topic, 70),
      description: cleanText(topic?.description, 160),
      /* `link` is a bluesky.app path; we only ever prefix it with our own
         origin constant, never trust an absolute URL from upstream. */
      url: typeof topic?.link === 'string' && topic.link.startsWith('/')
        ? `${BSKY_WEB}${topic.link}`
        : `${BSKY_WEB}/search?q=${encodeURIComponent(cleanText(topic?.topic, 70))}`
    })).filter((topic) => topic.label);
  });
  return value;
}

/**
 * Where "write a post" actually happens.
 *
 * Returns the composer intent with the draft pre-filled. Nothing is published
 * by us, no key is used, and the user reads and presses Post themselves inside
 * Bluesky. `imageUris`/`videoUri` are undocumented and ignored here on purpose
 * — the client discards http(s) image URIs anyway.
 */
export function composeIntent(text) {
  const body = cleanText(text, 280);
  return `${BSKY_WEB}/intent/compose?text=${encodeURIComponent(body)}`;
}

/** Cache/TTL introspection for the probe endpoint and for tests. */
export const SOCIAL_CONFIG = { TTL, TREND_TTL, APPVIEW, topics: TOPIC_IDS };
