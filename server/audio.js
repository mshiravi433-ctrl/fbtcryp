/**
 * CRYPTO RADIO — spoken news, pulled from real podcast feeds.
 * ---------------------------------------------------------------------------
 * The owner asked for radio and television on the news screen:
 *
 *   «میشود رادیو و تلوزیون را در صفححه اخبار بذلری وپخش انلاین
 *    و بنویسی تازهای رنز ارز»
 *
 * ─── WHAT WAS ACTUALLY BUILDABLE, AND WHAT WAS NOT ──────────────────────────
 * "Television" and "radio" sound like one feature and are two very different
 * engineering problems. Both were investigated before anything was written:
 *
 *   VIDEO — NOT BUILT, deliberately.
 *     The obvious implementation is an embedded YouTube live stream. It fails
 *     for our primary audience: youtube.com does not resolve on most Iranian
 *     networks, so the single most prominent element on the news screen would
 *     be a permanently grey box for the people the app is built for. The
 *     APKPure rejection is a second reason — an app embedding a third-party
 *     video player invites a content-policy review we cannot win in advance.
 *     A dead player is worse than no player.
 *
 *   AUDIO — BUILT, and it is genuinely better here.
 *     Podcast episodes are plain MP3 files served over ordinary HTTPS from
 *     CDNs that are not blocked. They stream through the browser's own
 *     <audio> element with no SDK, no iframe, no third-party script and no new
 *     dependency. They also work on a slow connection, which a video stream
 *     does not, and they keep playing when the screen is off.
 *
 * So this is radio, done properly, rather than television done badly.
 *
 * ─── WHY IT IS A SERVER MODULE AND NOT A LIST OF LINKS ──────────────────────
 * A hard-coded episode URL is stale within a day. These feeds publish daily,
 * so the module parses the RSS and returns the CURRENT episodes — which is
 * the difference between a radio station and a museum.
 *
 * ─── WE DO NOT REHOST ANYTHING ──────────────────────────────────────────────
 * The audio URL returned is the publisher's own CDN link, exactly as it
 * appears in their public feed. We do not proxy the bytes, do not strip their
 * advertising, and every episode carries its show name on screen. That is the
 * same rule the headline aggregator follows: point at the source, credit the
 * source, republish nothing.
 */

const TIMEOUT = Number(process.env.UPSTREAM_TIMEOUT_MS || 12000);

/**
 * The stations.
 *
 * ─── WHY THESE FOUR AND NOT A LONGER LIST ───────────────────────────────────
 * Each had to clear three bars, and most candidates failed at least one:
 *
 *   1. A PUBLIC RSS FEED WITH A REAL AUDIO ENCLOSURE. Several well-known
 *      shows are Spotify- or YouTube-exclusive, which means an embed or an
 *      SDK — the thing this module exists to avoid.
 *   2. PUBLISHES AT LEAST WEEKLY. A monthly show in a "live radio" section is
 *      a broken promise the second time somebody opens it.
 *   3. NEWS, NOT PROMOTION. Shows that are a token project's own marketing
 *      channel were excluded; on a screen next to real headlines they read as
 *      editorial endorsement.
 *
 * `cadence` is stated per station rather than inferred, because "daily" and
 * "weekly" set completely different expectations and guessing wrong makes an
 * up-to-date feed look abandoned.
 */
export const STATIONS = [
  {
    id: 'cryptoreport',
    name: 'Crypto.Report Daily',
    feed: 'https://feed.podbean.com/cryptodotreport/feed.xml',
    lang: 'en',
    cadence: 'daily'
  },
  {
    id: 'unchained',
    name: 'Unchained',
    feed: 'https://feeds.megaphone.fm/LSHML4761942757',
    lang: 'en',
    cadence: 'daily'
  },
  {
    id: 'breakdown',
    name: 'The Breakdown — Blockworks',
    feed: 'https://feeds.megaphone.fm/NLWLLC2118417614',
    lang: 'en',
    cadence: 'weekly'
  },
  {
    /*
     * ─── WHY BANKLESS IS LISTED LAST AND MAY NOT ALWAYS APPEAR ────────────
     * Its feed host answered 500 twice while this was being written, then
     * recovered. That is exactly the case `fetchAudio`'s `allSettled` exists
     * for: a station that is down contributes nothing and the dial still
     * plays.
     *
     * The URL is the one Apple's own directory reports for the show
     * (itunes lookup id 1499409058), not one copied off an aggregator page —
     * several of those pointed at a `rss.` host that is permanently 500 while
     * the `feeds.` host is the live one. Getting that wrong is how you ship a
     * station that never loads and never explains why.
     */
    id: 'bankless',
    name: 'Bankless',
    feed: 'https://feeds.flightcast.com/p83fuj0y0u58o82l41xei7zo.xml',
    lang: 'en',
    cadence: 'weekly'
  }
];


async function getText(url) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: {
        accept: 'application/rss+xml, application/xml, text/xml, */*',
        'user-agent': 'fbt-swap-app/1.0'
      }
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

const strip = (s) =>
  String(s || '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();

const pick = (block, tag) => {
  const m = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i'));
  return m ? strip(m[1]) : '';
};

/** `PT1H2M3S` or `1:02:03` or `3723` → seconds. Null when unparseable. */
function parseDuration(raw) {
  const s = String(raw || '').trim();
  if (!s) return null;
  if (/^\d+$/.test(s)) return Number(s);
  const parts = s.split(':').map(Number);
  if (parts.length && parts.every((n) => Number.isFinite(n))) {
    return parts.reduce((acc, n) => acc * 60 + n, 0);
  }
  return null;
}

/**
 * Pull the playable episodes out of one podcast feed.
 *
 * ─── THE ENCLOSURE IS MANDATORY, AND THAT IS THE WHOLE CORRECTNESS RULE ─────
 * An `<item>` without an `<enclosure url="...">` is an episode with no audio
 * file — a video-only entry, a trailer stub, or a feed that links to a web
 * player instead. Including one produces a play button that does nothing,
 * which on a page advertising "live radio" is the exact dead-button failure
 * this project keeps having to fix.
 *
 * So items with no enclosure are DROPPED rather than returned with a null
 * URL. A shorter list of things that all play beats a longer list where some
 * do not.
 */
export function parseAudioFeed(xml, station) {
  const out = [];
  const blocks = xml.split(/<item[\s>]/i).slice(1);

  for (const raw of blocks.slice(0, 8)) {
    const block = `<item ${raw}`;

    /*
     * `type="audio/..."` is checked as well as the presence of a URL. Some
     * feeds attach a cover image as an enclosure; playing a JPEG produces a
     * silent player stuck at 0:00 with no error, which is the most confusing
     * possible failure.
     */
    const enc = block.match(/<enclosure[^>]*>/i)?.[0] ?? '';
    const audioUrl = enc.match(/url=["']([^"']+)["']/i)?.[1] ?? null;
    const mime = enc.match(/type=["']([^"']+)["']/i)?.[1] ?? '';
    if (!audioUrl || !/^https:\/\//i.test(audioUrl)) continue;
    if (mime && !/^audio\//i.test(mime)) continue;

    const title = pick(block, 'title');
    if (!title) continue;

    const dateStr = pick(block, 'pubDate') || pick(block, 'published');
    const at = dateStr ? Date.parse(dateStr) : NaN;

    out.push({
      id: pick(block, 'guid') || audioUrl,
      title: title.slice(0, 180),
      /*
       * Show notes are long and full of sponsor copy and timestamps. Trimmed
       * hard: this is a one-line "what is this episode about", not an
       * article. The full text is a tap away on the publisher's page.
       */
      summary: (pick(block, 'description') || pick(block, 'itunes:summary')).slice(0, 260),
      audioUrl,
      pageUrl: pick(block, 'link') || null,
      durationSec: parseDuration(pick(block, 'itunes:duration')),
      station: station.id,
      stationName: station.name,
      lang: station.lang,
      at: Number.isFinite(at) ? at : Date.now()
    });
  }
  return out;
}

/**
 * Every station, newest first.
 *
 * `allSettled` and not `all`: one podcast host having a bad afternoon must
 * not empty the whole section. A partial radio dial still plays.
 */
export async function fetchAudio() {
  const results = await Promise.allSettled(
    STATIONS.map(async (s) => parseAudioFeed(await getText(s.feed), s))
  );

  const items = results.flatMap((r) => (r.status === 'fulfilled' ? r.value : []));

  /*
   * Interleaved by recency across ALL stations rather than grouped by show.
   * Grouping would put whichever station happens to be first at the top
   * permanently; sorting by date means the newest thing anyone published is
   * the newest thing on screen, which is what a news reader wants.
   */
  items.sort((a, b) => b.at - a.at);

  return {
    at: Date.now(),
    stations: STATIONS.map(({ id, name, lang, cadence }) => ({ id, name, lang, cadence })),
    /* Capped: this is a section of the news page, not a podcast app. */
    items: items.slice(0, 24),
    /*
     * Honest partial-failure signal. If two of four feeds failed the section
     * still renders, but the UI can say the dial is incomplete instead of
     * implying those shows stopped publishing.
     */
    stationsOk: results.filter((r) => r.status === 'fulfilled' && r.value.length).length,
    stationsTotal: STATIONS.length
  };
}
