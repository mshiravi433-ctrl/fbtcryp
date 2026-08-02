/**
 * Server-side news aggregation.
 *
 * Doing this on the server rather than in the browser buys three things:
 * one upstream request per 24h instead of one per user, no CORS bridge in the
 * request path, and the option to add a paid wire later without shipping a
 * key to the client.
 *
 * Sources are all keyless RSS/JSON from the major desks. Every item keeps its
 * `source` and its original `url` — we aggregate headlines, we do not republish
 * anyone's article body.
 */

const TIMEOUT = Number(process.env.UPSTREAM_TIMEOUT_MS || 12000);

/*
 * ─── WHY THE "OTHER LANGUAGES" TAB WAS ALWAYS EMPTY ─────────────────────────
 * The client (src/lib/news.js) carries nine local-language RSS sources — fa,
 * de, hi, ar, tr, es — but only reaches for them when the backend returns
 * FEWER THAN 12 items. This server returned about 30, every time, so that
 * branch never ran in production and the tab was permanently empty. It looked
 * like the foreign feeds were broken; they were simply never requested.
 *
 * The fix belongs here rather than in the client: fetching a dozen RSS feeds
 * from a phone on a mobile connection is exactly what the backend exists to
 * avoid, and doing it server-side means the result is cached once for every
 * user instead of re-fetched per device.
 *
 * `lang` is now carried per item so the client can badge a headline that is
 * not in the reader's language — without it, tapping a story expecting Persian
 * and landing on German is a trap.
 */
const FEEDS = [
  // English desks
  { id: 'cointelegraph', url: 'https://cointelegraph.com/rss', lang: 'en' },
  { id: 'coindesk', url: 'https://www.coindesk.com/arc/outboundfeeds/rss/', lang: 'en' },
  { id: 'decrypt', url: 'https://decrypt.co/feed', lang: 'en' },
  { id: 'bitcoinmagazine', url: 'https://bitcoinmagazine.com/feed', lang: 'en' },
  { id: 'theblock', url: 'https://www.theblock.co/rss.xml', lang: 'en' },
  { id: 'cryptoslate', url: 'https://cryptoslate.com/feed/', lang: 'en' },

  // Local-language desks. Persian first: it is the primary audience.
  { id: 'arzdigital', url: 'https://arzdigital.com/feed/', lang: 'fa' },
  { id: 'ramzarz', url: 'https://ramzarz.news/feed/', lang: 'fa' },
  { id: 'cointelegraph-ar', url: 'https://ar.cointelegraph.com/rss', lang: 'ar' },
  { id: 'cointelegraph-tr', url: 'https://tr.cointelegraph.com/rss', lang: 'tr' },
  { id: 'cointelegraph-es', url: 'https://es.cointelegraph.com/rss', lang: 'es' },
  { id: 'cointelegraph-hi', url: 'https://hi.cointelegraph.com/rss', lang: 'hi' },
  { id: 'btc-echo', url: 'https://www.btc-echo.de/feed/', lang: 'de' }
];

async function getText(url) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { accept: 'application/rss+xml, application/xml, text/xml, */*', 'user-agent': 'fbt-swap-app/1.0' }
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

/**
 * Minimal RSS/Atom parser.
 *
 * A full XML parser is a dependency and an attack surface for what amounts to
 * pulling five fields out of a well-known document shape. If a feed changes
 * format we lose that feed, not the endpoint — every source is wrapped in its
 * own try/catch upstream.
 */
function parseFeed(xml, sourceId, lang = 'en') {
  const items = [];
  const blocks = xml.split(/<item[\s>]|<entry[\s>]/i).slice(1);

  for (const raw of blocks.slice(0, 12)) {
    const block = `<item ${raw}`;
    const title = pick(block, 'title');
    if (!title) continue;

    // Atom puts the URL in a link@href attribute rather than element text.
    const linkText = pick(block, 'link');
    const hrefMatch = block.match(/<link[^>]*href=["']([^"']+)["']/i);
    const url = linkText || hrefMatch?.[1] || null;

    const dateStr = pick(block, 'pubDate') || pick(block, 'published') || pick(block, 'updated');
    const at = dateStr ? Date.parse(dateStr) : Date.now();

    const imgMatch =
      block.match(/<media:content[^>]*url=["']([^"']+)["']/i) ||
      block.match(/<enclosure[^>]*url=["']([^"']+)["']/i);

    items.push({
      id: pick(block, 'guid') || url || `${sourceId}-${title}`,
      title: title.slice(0, 180),
      summary: (pick(block, 'description') || pick(block, 'summary')).slice(0, 320),
      url,
      image: imgMatch?.[1] ?? null,
      source: sourceId,
      // Carried through so the client can badge a foreign-language headline
      // instead of silently mixing it into the reader's own language.
      lang,
      at: Number.isFinite(at) ? at : Date.now()
    });
  }
  return items;
}

/** Fetch and merge every feed. One dead desk must not empty the response. */
export async function fetchNews() {
  const results = await Promise.allSettled(
    FEEDS.map(async (f) => parseFeed(await getText(f.url), f.id, f.lang ?? 'en'))
  );

  const all = results.flatMap((r) => (r.status === 'fulfilled' ? r.value : []));

  const seen = new Set();
  const deduped = all
    .filter((i) => {
      const k = i.title.toLowerCase();
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .sort((a, b) => b.at - a.at);

  const items = trimKeepingLanguages(deduped);
  // Every desk unreachable is an outage, not an empty news day — surface it so
  // the client falls back to its own RSS path instead of caching nothing.
  if (!items.length) throw new Error('NO_FEEDS_REACHABLE');
  return { items, at: Date.now(), sources: FEEDS.map((f) => f.id) };
}

/**
 * Trim the merged feed to a display budget WITHOUT losing minority languages.
 *
 * Exported so it can be unit-tested. The bug it fixes was invisible from the
 * outside — the endpoint returned a perfectly healthy 60 items and the "other
 * languages" tab was empty — so the only way to catch a regression is to
 * assert this function directly.
 *
 * @param {Array}  deduped        items, already de-duplicated, newest first
 * @param {object} [opts]
 * @param {number} [opts.limit]        total items to return
 * @param {number} [opts.keepPerLang]  minimum reserved per non-English language
 */
export function trimKeepingLanguages(deduped, { limit = 90, keepPerLang = 6 } = {}) {
  /*
   * RESERVE A SLOT FOR EVERY LANGUAGE BEFORE TRIMMING.
   *
   * The English desks publish many times more often than the local ones, so a
   * plain newest-first slice can contain zero non-English items on a busy day
   * — and the "Other languages" tab silently empties again, which is the exact
   * bug being fixed. Sorting by recency alone cannot express "keep some of
   * each".
   *
   * So: take up to KEEP_PER_LANG of each language first, then fill the rest
   * with whatever is newest. Recency still decides within a language and
   * across the remainder.
   */
  const KEEP_PER_LANG = keepPerLang;
  const perLang = new Map();
  const reserved = [];
  for (const item of deduped) {
    const lang = item.lang ?? 'en';
    if (lang === 'en') continue;
    const n = perLang.get(lang) ?? 0;
    if (n >= KEEP_PER_LANG) continue;
    perLang.set(lang, n + 1);
    reserved.push(item);
  }

  /*
   * Fill the remaining budget with the newest of everything else, THEN sort
   * the union for display.
   *
   * The trim and the sort must happen in this order. Re-sorting a combined
   * list by recency and slicing afterwards would throw the reserved items back
   * out — the older Persian stories would fall past the cut and the guarantee
   * above would silently buy nothing. Reserve, trim, then sort.
   */
  const LIMIT = limit;
  const reservedIds = new Set(reserved.map((i) => i.id));
  const rest = deduped.filter((i) => !reservedIds.has(i.id));
  return [...reserved, ...rest.slice(0, Math.max(0, LIMIT - reserved.length))].sort(
    (a, b) => b.at - a.at
  );
}
