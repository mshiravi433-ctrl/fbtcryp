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
/*
 * `class` marks the desk's role in the global intelligence chain.
 *   crypto — the coin desks the reader follows for price/flow news
 *   macro  — the world/business desks. Phase 211.1 widened the FEED with them
 *            because the macro domain (and the cross-asset economic outlook)
 *            must read POLITICS and the macro economy, not only whatever a
 *            crypto headline happens to mention. These are the keyless
 *            wire-class desks (BBC/CNBC/MarketWatch/Yahoo Finance/WSJ/Al
 *            Jazeera/DW) that stand in for the paid wires (Reuters/Bloomberg
 *            have no keyless RSS) — the same role the header comment above
 *            describes for the option of a paid wire later.
 */
const FEEDS = [
  // English crypto desks
  { id: 'cointelegraph', url: 'https://cointelegraph.com/rss', lang: 'en', class: 'crypto' },
  { id: 'coindesk', url: 'https://www.coindesk.com/arc/outboundfeeds/rss/', lang: 'en', class: 'crypto' },
  { id: 'decrypt', url: 'https://decrypt.co/feed', lang: 'en', class: 'crypto' },
  { id: 'bitcoinmagazine', url: 'https://bitcoinmagazine.com/feed', lang: 'en', class: 'crypto' },
  { id: 'theblock', url: 'https://www.theblock.co/rss.xml', lang: 'en', class: 'crypto' },
  { id: 'cryptoslate', url: 'https://cryptoslate.com/feed/', lang: 'en', class: 'crypto' },

  // World/business desks — the macro outlook layer (Phase 211.1).
  { id: 'bbc-business', url: 'https://feeds.bbci.co.uk/news/business/rss.xml', lang: 'en', class: 'macro' },
  { id: 'bbc-world', url: 'https://feeds.bbci.co.uk/news/world/rss.xml', lang: 'en', class: 'macro' },
  { id: 'cnbc-top', url: 'https://www.cnbc.com/id/100003114/device/rss/rss.html', lang: 'en', class: 'macro' },
  { id: 'marketwatch-top', url: 'https://feeds.content.dowjones.io/public/rss/mw_topstories', lang: 'en', class: 'macro' },
  { id: 'yahoo-finance', url: 'https://finance.yahoo.com/news/rssindex', lang: 'en', class: 'macro' },
  { id: 'wsj-markets', url: 'https://feeds.a.dj.com/rss/RSSMarketsMain.xml', lang: 'en', class: 'macro' },
  { id: 'aljazeera-world', url: 'https://www.aljazeera.com/xml/rss/all.xml', lang: 'en', class: 'macro' },
  { id: 'dw-world', url: 'https://rss.dw.com/rdf/rss-en-all', lang: 'en', class: 'macro' },

  // Local-language desks. Persian first: it is the primary audience.
  { id: 'arzdigital', url: 'https://arzdigital.com/feed/', lang: 'fa', class: 'crypto' },
  { id: 'ramzarz', url: 'https://ramzarz.news/feed/', lang: 'fa', class: 'crypto' },
  { id: 'cointelegraph-ar', url: 'https://ar.cointelegraph.com/rss', lang: 'ar', class: 'crypto' },
  { id: 'cointelegraph-tr', url: 'https://tr.cointelegraph.com/rss', lang: 'tr', class: 'crypto' },
  { id: 'cointelegraph-es', url: 'https://es.cointelegraph.com/rss', lang: 'es', class: 'crypto' },
  { id: 'cointelegraph-hi', url: 'https://hi.cointelegraph.com/rss', lang: 'hi', class: 'crypto' },
  { id: 'btc-echo', url: 'https://www.btc-echo.de/feed/', lang: 'de', class: 'crypto' }
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
function parseFeed(xml, sourceId, lang = 'en', feedClass = 'crypto') {
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
      // Carried through so the trim can guarantee the macro desks survive
      // (Phase 211.1) and the client can tell coin news from world news.
      class: feedClass,
      at: Number.isFinite(at) ? at : Date.now()
    });
  }
  return items;
}

/** Fetch and merge every feed. One dead desk must not empty the response. */
export async function fetchNews() {
  const results = await Promise.allSettled(
    FEEDS.map(async (f) => parseFeed(await getText(f.url), f.id, f.lang ?? 'en', f.class ?? 'crypto'))
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
 * @param {number} [opts.keepMacro]    reserved for the macro/world desks
 */
export function trimKeepingLanguages(deduped, { limit = 90, keepPerLang = 6, keepMacro = 12 } = {}) {
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
   * RESERVE A SLOT FOR THE MACRO DESKS TOO (Phase 211.1).
   *
   * The same trap in the other direction: on a day the crypto desks publish
   * fast and the world desks slow, a newest-first cut can contain ZERO
   * business/politics headlines — and the macro domain (and the cross-asset
   * economic outlook that reads politics into the economy) goes quiet while
   * the feed looks perfectly healthy. The world/business desks are tagged
   * `class: 'macro'` in FEEDS; up to keepMacro of them are reserved exactly
   * like the minority languages, so the macro classifier always has fresh
   * politics/economy headlines to classify when a desk answered at all.
   */
  const KEEP_MACRO = keepMacro;
  let macroKept = 0;
  for (const item of deduped) {
    if (macroKept >= KEEP_MACRO) break;
    if ((item.class ?? 'crypto') !== 'macro') continue;
    if (reserved.some((r) => r.id === item.id)) continue;
    reserved.push(item);
    macroKept += 1;
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
