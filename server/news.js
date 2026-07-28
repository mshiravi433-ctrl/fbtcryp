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

const FEEDS = [
  { id: 'cointelegraph', url: 'https://cointelegraph.com/rss' },
  { id: 'coindesk', url: 'https://www.coindesk.com/arc/outboundfeeds/rss/' },
  { id: 'decrypt', url: 'https://decrypt.co/feed' },
  { id: 'bitcoinmagazine', url: 'https://bitcoinmagazine.com/feed' },
  { id: 'theblock', url: 'https://www.theblock.co/rss.xml' },
  { id: 'cryptoslate', url: 'https://cryptoslate.com/feed/' }
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
function parseFeed(xml, sourceId) {
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
      at: Number.isFinite(at) ? at : Date.now()
    });
  }
  return items;
}

/** Fetch and merge every feed. One dead desk must not empty the response. */
export async function fetchNews() {
  const results = await Promise.allSettled(
    FEEDS.map(async (f) => parseFeed(await getText(f.url), f.id))
  );

  const all = results.flatMap((r) => (r.status === 'fulfilled' ? r.value : []));

  const seen = new Set();
  const items = all
    .filter((i) => {
      const k = i.title.toLowerCase();
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .sort((a, b) => b.at - a.at)
    .slice(0, 60);

  if (!items.length) throw new Error('NO_FEEDS_REACHABLE');
  return { items, at: Date.now(), sources: FEEDS.map((f) => f.id) };
}
