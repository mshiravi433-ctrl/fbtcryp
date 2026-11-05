/**
 * SOCIAL FEED — server contract tests.
 *
 * ─── WHY node:test AND NOT vitest ─────────────────────────────────────────
 * This file tests server/social.js, which imports nothing from `src/`. The
 * server suite in this repo runs through `node --test` (see `npm run
 * test:server`, and test/cache-*.mjs beside this) precisely so a server
 * contract does not need the Vite/React toolchain installed to be checked.
 *
 * ─── WHAT IS BEING PROTECTED, AND WHY EACH ONE MATTERS ────────────────────
 * The screen is disposable; these four promises are not:
 *
 *   1. A stranger's text cannot smuggle bidi overrides or control characters
 *      into our DOM (cleanText).
 *   2. Hashtag spam and tag-only adverts never reach the feed (isWantedPost) —
 *      measured live: an unfiltered crypto search is mostly #fyp/#wolink bomb.
 *   3. No response field carries a remote media URL, so the client cannot
 *      accidentally start leaking user IPs to posters' hosts (normalizePost).
 *   4. One five-minute window costs ONE upstream call, not one per visitor
 *      (withCache) — that is the entire traffic budget of the feature.
 */

import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';

import { __clearCacheForTests } from '../server/cache.js';
import {
  SOCIAL_CONFIG,
  cleanText,
  composeIntent,
  fetchAuthorFeed,
  fetchThread,
  fetchTopic,
  fetchTrending,
  isWantedPost,
  normalizePost,
  searchPosts
} from '../server/social.js';

const json = (value, status = 200) => new Response(JSON.stringify(value), {
  status,
  headers: { 'Content-Type': 'application/json' }
});

const post = (overrides = {}) => ({
  uri: 'at://did:plc:abc123/app.bsky.feed.post/3kxyz',
  author: { did: 'did:plc:abc123', handle: 'trader.bsky.social', displayName: 'Trader' },
  record: { text: 'Bitcoin just claimed a new weekly close above the range high.', createdAt: '2026-11-05T10:00:00.000Z' },
  indexedAt: '2026-11-05T10:00:01.000Z',
  likeCount: 12,
  repostCount: 3,
  replyCount: 1,
  quoteCount: 0,
  ...overrides
});

/* A stored reference to the real fetch so the stub can be removed exactly. */
const realFetch = globalThis.fetch;
const stubFetch = (impl) => { globalThis.fetch = impl; };

beforeEach(() => { __clearCacheForTests(); });
afterEach(() => {
  globalThis.fetch = realFetch;
  __clearCacheForTests();
});

describe('cleanText — hostile input', () => {
  it('strips bidi overrides so a post cannot reverse the row it renders in', () => {
    assert.equal(cleanText('abc\u202Edef\u2066ghi'), 'abcdefghi');
  });

  it('strips control characters and collapses whitespace', () => {
    assert.equal(cleanText('a\u0000b\t\tc\n\nd'), 'a b c d');
  });

  it('caps length and tolerates non-strings', () => {
    assert.equal(cleanText('x'.repeat(500)).length, 420);
    assert.equal(cleanText(null), '');
    assert.equal(cleanText(undefined), '');
  });
});

describe('isWantedPost — the filter that keeps the feed readable', () => {
  it('accepts an ordinary post', () => {
    assert.equal(isWantedPost(post()), true);
  });

  it('rejects empty and whitespace-only posts', () => {
    assert.equal(isWantedPost(post({ record: { text: '   ' } })), false);
    assert.equal(isWantedPost({}), false);
  });

  it('rejects hashtag bombs measured in the live Persian result', () => {
    const spam = post({
      record: {
        text: 'Crypto in 30 seconds #bitcoin #ethereum #fypシ゚viralシ #wolink #viralreelschallenge',
        createdAt: '2026-11-05T10:00:00.000Z'
      }
    });
    assert.equal(isWantedPost(spam), false);
  });

  it('rejects a wall of tags with no words of its own', () => {
    const tagsOnly = post({ record: { text: '#bitcoin #btc #crypto #hodl', createdAt: '2026-11-05T10:00:00.000Z' } });
    assert.equal(isWantedPost(tagsOnly), false);
  });

  it('rejects engagement bait and blocked handles', () => {
    assert.equal(isWantedPost(post({ record: { text: 'Send me a DM for early access to the next 100x gem', createdAt: new Date().toISOString() } })), false);
    assert.equal(isWantedPost(post({ author: { handle: 'bsky.app', did: 'did:plc:z' } })), false);
    assert.equal(isWantedPost(post({ author: { handle: '', did: 'did:plc:z' } })), false);
  });
});

describe('normalizePost — what leaves the server', () => {
  it('never carries a remote media or avatar URL', () => {
    const row = normalizePost(post({
      author: { did: 'did:plc:abc123', handle: 'trader.bsky.social', displayName: 'T', avatar: 'https://cdn.bsky.app/img/avatar/x' },
      embed: { $type: 'app.bsky.embed.images#view', images: [{ thumb: 'https://cdn.bsky.app/img/feed_thumbnail/x' }] }
    }));
    const flat = JSON.stringify(row);
    /* The only URL in a row is the canonical bsky.app post link we build
       ourselves; every byte of CDN/media upstream data must be gone. */
    assert.equal(flat.includes('cdn.bsky.app'), false);
    assert.equal(flat.includes('video.bsky.app'), false);
    assert.equal(/avatar|thumbnail|playlist/i.test(flat), false);
    assert.equal(flat.match(/https?:\/\//g).length, 1);
    assert.equal(row.media, 1);
  });

  it('builds one canonical Bluesky link per post and nothing else clickable', () => {
    const row = normalizePost(post());
    assert.equal(row.url, 'https://bsky.app/profile/trader.bsky.social/post/3kxyz');
    assert.equal(row.rkey, '3kxyz');
  });

  it('coerces missing counters to zero rather than NaN', () => {
    const row = normalizePost(post({ likeCount: undefined, repostCount: null, quoteCount: 'x' }));
    assert.equal(row.likes, 0);
    assert.equal(row.reposts, 0);
    assert.equal(row.quotes, 0);
  });
});

describe('fetchTopic — one upstream window per cache period', () => {
  it('merges, deduplicates, filters and sorts newest first', async () => {
    const older = post({ uri: 'at://did:plc:a/app.bsky.feed.post/1', record: { text: 'Ethereum fees fell again this week, per the tracker.', createdAt: '2026-11-05T08:00:00.000Z' } });
    const newer = post({ uri: 'at://did:plc:a/app.bsky.feed.post/2', record: { text: 'Solana validators approved the next upgrade proposal.', createdAt: '2026-11-05T09:30:00.000Z' } });
    const spam = post({ uri: 'at://did:plc:b/app.bsky.feed.post/3', record: { text: 'free airdrop claim #fyp #wolink', createdAt: '2026-11-05T09:45:00.000Z' } });

    let calls = 0;
    let calledUrl = '';
    stubFetch(async (url) => {
      calls += 1;
      calledUrl = String(url);
      return json({ posts: [older, newer, spam] });
    });

    const rows = await fetchTopic('bitcoin', 10);
    assert.deepEqual(rows.map((r) => r.rkey), ['2', '1']);
    assert.equal(calls, 1);
    assert.equal(calledUrl.includes('api.bsky.app'), true);
    /* The public host is the one the docs recommend and the one that answers
       search with a 403 and an HTML body — pinned so a future "fix" cannot
       quietly switch back. */
    assert.equal(calledUrl.includes('public.api.bsky.app'), false);
  });

  it('serves the cached page to the next caller without touching upstream', async () => {
    let calls = 0;
    stubFetch(async () => { calls += 1; return json({ posts: [post()] }); });
    await fetchTopic('defi', 5);
    await fetchTopic('defi', 5);
    assert.equal(calls, 1);
  });

  it('keeps a tab usable when some of its queries die', async () => {
    let calls = 0;
    stubFetch(async (url) => {
      calls += 1;
      return String(url).includes('q=solana') ? json({ error: 'boom' }, 500) : json({ posts: [post()] });
    });
    /* forYou fans out over four queries; three failures must still leave a feed. */
    const rows = await fetchTopic('forYou', 5);
    assert.equal(rows.length > 0, true);
    assert.equal(calls, 4);
  });

  it('reports an outage when EVERY query fails, instead of an empty tab', async () => {
    /* An empty list would tell the user "nothing here yet" while the truth is
       that we could not reach Bluesky — and they would never retry. */
    stubFetch(async () => { throw new Error('network down'); });
    await assert.rejects(() => fetchTopic('solana', 5), /UPSTREAM_UNAVAILABLE/);
  });

  it('rejects an unknown topic instead of proxying arbitrary searches', async () => {
    await assert.rejects(() => fetchTopic('../../etc/passwd', 5), /UNKNOWN_TOPIC/);
  });

  it('exposes every advertised topic id', () => {
    assert.deepEqual(SOCIAL_CONFIG.topics, ['forYou', 'bitcoin', 'ethereum', 'defi', 'solana', 'fa']);
  });
});

describe('inputs that could become an open proxy', () => {
  it('refuses a hostile actor string without calling upstream', async () => {
    let calls = 0;
    stubFetch(async () => { calls += 1; return json({}); });
    await assert.rejects(() => fetchAuthorFeed('https://evil.example/@x'), /BAD_ACTOR/);
    await assert.rejects(() => fetchAuthorFeed('a b'), /BAD_ACTOR/);
    assert.equal(calls, 0);
  });

  it('refuses a non-post thread uri', async () => {
    await assert.rejects(() => fetchThread('at://did:plc:a/app.bsky.feed.generator/x'), /BAD_URI/);
    await assert.rejects(() => fetchThread('https://bsky.app/profile/x'), /BAD_URI/);
  });

  it('ignores a one-character search instead of spending a request', async () => {
    let calls = 0;
    stubFetch(async () => { calls += 1; return json({}); });
    assert.deepEqual(await searchPosts('a'), []);
    assert.equal(calls, 0);
  });
});

describe('composeIntent — writing happens in Bluesky, never here', () => {
  it('returns a Bluesky composer link with the draft encoded', () => {
    assert.equal(
      composeIntent('سلام #bitcoin'),
      'https://bsky.app/intent/compose?text=%D8%B3%D9%84%D8%A7%D9%85%20%23bitcoin'
    );
  });

  it('clamps the draft to the composer limit', () => {
    const url = composeIntent('x'.repeat(500));
    assert.equal(decodeURIComponent(url.split('=')[1]).length, 280);
  });
});

describe('fetchTrending — upstream links are never trusted verbatim', () => {
  it('prefixes relative links with the Bluesky origin and drops absolute ones', async () => {
    stubFetch(async () => json({
      topics: [
        { topic: 'ETF week', displayName: 'ETF week', link: '/profile/did:plc:a/feed/1' },
        { topic: 'Evil', displayName: 'Evil', link: 'https://evil.example/x' }
      ]
    }));
    const rows = await fetchTrending(4);
    assert.equal(rows[0].url, 'https://bsky.app/profile/did:plc:a/feed/1');
    assert.equal(rows[1].url, 'https://bsky.app/search?q=Evil');
  });
});
