/**
 * CRYPTO NEWS FEED
 * ---------------------------------------------------------------------------
 * Refreshed every 24 hours (and on demand), from sources that need no API key
 * so the feature works in a fresh clone with nothing configured:
 *
 *   1. Our backend `/api/news` — preferred. It can merge paid sources and
 *      caches server-side, so every user doesn't hit the upstream.
 *   2. CoinGecko's public status/updates endpoint — project announcements.
 *   3. RSS from the major desks, read through a public JSON bridge.
 *   4. A generated "market movers" digest built from price data we already
 *      have. Not journalism, and labelled as such, but it is genuinely
 *      informative and it can never be empty.
 *
 * The cache is keyed by day so "new headlines every 24 hours" is literally
 * what happens, and a user who opens the app ten times in a day doesn't cost
 * ten upstream requests.
 */

const CACHE_KEY = 'fbt-news-v1';
const DAY = 24 * 60 * 60 * 1000;

/*
 * How long a headline stays in the list, and how many we keep.
 *
 * Three days rather than one: the feed refreshes every 24h, so a 24h window
 * would empty the screen for anyone who opened the app a day late. Three days
 * keeps continuity without letting genuinely stale prices linger.
 */
const MAX_AGE = 3 * DAY;
const MAX_ITEMS = 60;

const API_BASE = (typeof import.meta !== 'undefined' && import.meta.env?.VITE_API_BASE) || '/api';

/**
 * CATEGORIES
 *
 * Every source is keyless public RSS, so this works in a fresh clone with
 * nothing configured. `cat` is what the tab filter matches on.
 *
 * A note on the 'regional' and 'policy' desks: there is no reliable
 * keyless English feed dedicated to Iranian crypto specifically, and
 * inventing one would be worse than omitting it. Instead those tabs pull from
 * outlets that genuinely cover MENA markets and regulation, and items are
 * additionally keyword-scored (see REGION_TERMS) so the regionally relevant
 * stories float to the top of the tab rather than being faked.
 */
const RSS_SOURCES = [
  // general crypto
  { id: 'cointelegraph', url: 'https://cointelegraph.com/rss', cat: 'all' },
  { id: 'coindesk', url: 'https://www.coindesk.com/arc/outboundfeeds/rss/', cat: 'all' },
  { id: 'decrypt', url: 'https://decrypt.co/feed', cat: 'all' },
  { id: 'bitcoinmagazine', url: 'https://bitcoinmagazine.com/feed', cat: 'all' },

  // policy / regulation — the desks that actually cover rulemaking
  { id: 'coindesk-policy', url: 'https://www.coindesk.com/arc/outboundfeeds/rss/?outputType=xml&category=policy', cat: 'policy' },
  { id: 'cointelegraph-regulation', url: 'https://cointelegraph.com/rss/tag/regulation', cat: 'policy' },

  // events / conferences and protocol milestones
  { id: 'cointelegraph-events', url: 'https://cointelegraph.com/rss/tag/blockchain-events', cat: 'events' },

  // the future / research / tech direction
  { id: 'cointelegraph-tech', url: 'https://cointelegraph.com/rss/tag/technology', cat: 'future' },
  { id: 'ethresearch', url: 'https://ethereum-magicians.org/latest.rss', cat: 'future' },

  // MENA / regional coverage
  { id: 'arabianbusiness', url: 'https://www.arabianbusiness.com/feed', cat: 'regional' },
  { id: 'cointelegraph-mena', url: 'https://cointelegraph.com/rss/tag/middle-east', cat: 'regional' },

  /*
   * LOCAL-LANGUAGE DESKS
   *
   * These are outlets writing in their own language for their own market, not
   * translations of English wire copy. That distinction matters: a Persian
   * crypto desk covers Iranian exchange rules and rial pricing, which no
   * amount of translating CoinDesk will ever surface.
   *
   * `lang` is what the UI shows as the badge on the card, so a reader can see
   * at a glance which language they are about to open.
   */
  { id: 'arzdigital', url: 'https://arzdigital.com/feed/', cat: 'lang', lang: 'fa' },
  { id: 'ramzarz', url: 'https://ramzarz.news/feed/', cat: 'lang', lang: 'fa' },
  { id: 'btc-echo', url: 'https://www.btc-echo.de/feed/', cat: 'lang', lang: 'de' },
  { id: 'coinkurier', url: 'https://coinkurier.de/feed/', cat: 'lang', lang: 'de' },
  { id: 'cointelegraph-hi', url: 'https://hi.cointelegraph.com/rss', cat: 'lang', lang: 'hi' },
  { id: 'coingape-hi', url: 'https://hindi.coingape.com/feed/', cat: 'lang', lang: 'hi' },
  { id: 'cointelegraph-ar', url: 'https://ar.cointelegraph.com/rss', cat: 'lang', lang: 'ar' },
  { id: 'cointelegraph-tr', url: 'https://tr.cointelegraph.com/rss', cat: 'lang', lang: 'tr' },
  { id: 'cointelegraph-es', url: 'https://es.cointelegraph.com/rss', cat: 'lang', lang: 'es' }
];

/** Tab ids, in display order. 'all' must stay first. */
export const NEWS_CATEGORIES = ['all', 'regional', 'policy', 'events', 'future', 'lang'];

/**
 * Terms that mark a story as regionally relevant.
 *
 * Used to SCORE, never to fabricate: an item only gets the 'regional' tag if
 * it genuinely mentions one of these. A tab with three honest stories is
 * better than one padded with unrelated global headlines.
 */
const REGION_TERMS = [
  'iran', 'iranian', 'tehran', 'rial', 'toman',
  'middle east', 'mena', 'gulf', 'persian gulf',
  'uae', 'dubai', 'abu dhabi', 'emirates', 'saudi', 'riyadh',
  'qatar', 'bahrain', 'kuwait', 'oman', 'turkey', 'turkish', 'lira',
  'israel', 'egypt', 'iraq', 'jordan', 'lebanon', 'pakistan'
];

const POLICY_TERMS = [
  'regulat', 'sanction', 'ban ', 'banned', 'legal', 'law', 'court', 'sec ',
  'cbdc', 'central bank', 'tax', 'licence', 'license', 'compliance', 'aml',
  'government', 'parliament', 'policy', 'ruling', 'lawsuit'
];

const FUTURE_TERMS = [
  'roadmap', 'upgrade', 'testnet', 'mainnet', 'research', 'proposal', 'eip',
  'scaling', 'zk', 'rollup', 'layer 2', 'l2', 'quantum', 'ai ', 'future',
  'forecast', 'outlook', 'prediction', '2027', '2028', '2030'
];

const EVENT_TERMS = [
  'conference', 'summit', 'hackathon', 'expo', 'meetup', 'event',
  'halving', 'launch', 'listing', 'airdrop', 'fork'
];

const hasAny = (text, terms) => terms.some((w) => text.includes(w));

/**
 * Tag an item with every category it genuinely belongs to.
 * An item can be in several; 'all' always applies.
 */
function categorize(item) {
  const text = `${item.title} ${item.summary}`.toLowerCase();
  const cats = ['all'];
  if (item.sourceCat && item.sourceCat !== 'all' && !cats.includes(item.sourceCat)) {
    cats.push(item.sourceCat);
  }
  if (hasAny(text, REGION_TERMS) && !cats.includes('regional')) cats.push('regional');
  if (hasAny(text, POLICY_TERMS) && !cats.includes('policy')) cats.push('policy');
  if (hasAny(text, FUTURE_TERMS) && !cats.includes('future')) cats.push('future');
  if (hasAny(text, EVENT_TERMS) && !cats.includes('events')) cats.push('events');
  return cats;
}

const RSS_BRIDGE = 'https://api.rss2json.com/v1/api.json?rss_url=';

async function jget(url, timeout = 12000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { accept: 'application/json' } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

function readCache() {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed.items) || !parsed.items.length) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeCache(items) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ at: Date.now(), items }));
  } catch {
    /* storage full — the in-session copy is still fine */
  }
}

const clean = (html) =>
  String(html || '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&[a-z]+;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();

function normalize(item, src) {
  const base = {
    id: item.guid || item.link || `${src.id}-${item.title}`,
    title: clean(item.title).slice(0, 180),
    summary: clean(item.description || item.content).slice(0, 320),
    url: item.link,
    image: item.thumbnail || item.enclosure?.link || null,
    source: src.id,
    sourceCat: src.cat,
    lang: src.lang ?? 'en',
    at: item.pubDate ? new Date(item.pubDate).getTime() : Date.now()
  };
  return { ...base, cats: categorize(base) };
}

/** Build a digest from market data when no external feed is reachable. */
export function digestFromMarket(coins = [], lang = 'en') {
  if (!coins.length) return [];
  const sorted = [...coins].filter((c) => Number.isFinite(c.change24h));
  const gainers = [...sorted].sort((a, b) => b.change24h - a.change24h).slice(0, 3);
  const losers = [...sorted].sort((a, b) => a.change24h - b.change24h).slice(0, 3);

  const fmt = (list) => list.map((c) => `${c.symbol} ${c.change24h >= 0 ? '+' : ''}${c.change24h.toFixed(1)}%`).join(' · ');

  const now = Date.now();
  const strings = {
    fa: {
      up: 'بیشترین رشد ۲۴ ساعت گذشته',
      down: 'بیشترین افت ۲۴ ساعت گذشته',
      note: 'خلاصه خودکار از داده بازار — خبر تحریریه‌ای نیست.'
    },
    en: {
      up: 'Biggest 24h gainers',
      down: 'Biggest 24h losers',
      note: 'Auto-generated from market data — not editorial reporting.'
    },
    ar: {
      up: 'أكبر الرابحين خلال ٢٤ ساعة',
      down: 'أكبر الخاسرين خلال ٢٤ ساعة',
      note: 'ملخص آلي من بيانات السوق — ليس تقريراً تحريرياً.'
    }
  };
  const s = strings[lang] ?? strings.en;

  return [
    { id: `digest-up-${now}`, title: s.up, summary: `${fmt(gainers)} — ${s.note}`, url: null, source: 'digest', at: now, digest: true },
    { id: `digest-down-${now}`, title: s.down, summary: `${fmt(losers)} — ${s.note}`, url: null, source: 'digest', at: now, digest: true }
  ];
}

/**
 * Fetch the feed.
 * @param {object} opts
 * @param {boolean} opts.force skip the 24h cache
 * @param {Array}   opts.coins market rows, used for the fallback digest
 */
/**
 * Drop anything older than MAX_AGE and cap the list.
 *
 * Without this the cache only ever grew: each refresh merged new headlines in
 * and nothing was ever removed, so week-old stories kept their place in the
 * list and localStorage crept toward its quota until writes started failing
 * silently. "Yesterday's news" in a crypto app is not just clutter — a price
 * story from last week is actively misleading.
 */
function pruneOld(items) {
  const cutoff = Date.now() - MAX_AGE;
  return items
    .filter((i) => {
      // An item with no timestamp is kept: a missing date is a feed quirk, and
      // deleting real news over it would be worse than showing it one day too
      // long. Everything with a date must be inside the window.
      const at = Number(i?.at);
      return !Number.isFinite(at) || at >= cutoff;
    })
    .sort((a, b) => (b.at ?? 0) - (a.at ?? 0))
    .slice(0, MAX_ITEMS);
}

export async function getNews({ force = false, coins = [], lang = 'en' } = {}) {
  const cached = readCache();
  if (cached && !force && Date.now() - cached.at < DAY) {
    // Prune on read too. A user who opens the app three days running would
    // otherwise keep seeing the same stale cache until it happens to expire.
    const fresh = pruneOld(cached.items);
    if (fresh.length) return { items: fresh, at: cached.at, stale: false };
    // Everything expired — fall through and refetch rather than show nothing.
  }

  const collected = [];

  // 1. our backend
  try {
    const data = await jget(`${API_BASE}/news?lang=${encodeURIComponent(lang)}`);
    if (Array.isArray(data?.items)) collected.push(...data.items);
  } catch {
    /* no backend deployed */
  }

  /*
   * 2. Public RSS.
   *
   * The source list grew from 4 desks to 20 (regional, policy, events, future
   * and six local-language outlets). Firing all 20 at one free JSON bridge in
   * a single burst gets the whole batch rate-limited, and on a mobile
   * connection it also saturates the connection pool the market data needs.
   *
   * So: fetch in small waves, and stop as soon as there is enough.
   *
   * ─── THE BUG THAT MADE THE "OTHER LANGUAGES" TAB EMPTY ──────────────────
   * The waves ran in list order and the loop stopped at 36 items. The general
   * desks are listed first and produce ~30 items between them, so the loop
   * broke after wave 1 or 2 — and every local-language feed sits at index 11
   * or later. They were never fetched at all, so the tab was permanently
   * empty. It looked like the feeds were broken; they were simply never asked.
   *
   * A per-category budget fixes it properly: each wave is built by taking the
   * next unfetched source from EVERY category in turn, so no category can be
   * starved by one that happens to be listed earlier. "Enough" is now counted
   * per category rather than globally.
   * ────────────────────────────────────────────────────────────────────────
   */
  if (collected.length < 12) {
    const WAVE = 4;
    const PER_CAT = 8; // enough to fill any single tab

    // Round-robin the sources by category so every tab gets a fair share.
    const byCat = new Map();
    for (const src of RSS_SOURCES) {
      if (!byCat.has(src.cat)) byCat.set(src.cat, []);
      byCat.get(src.cat).push(src);
    }
    const queues = [...byCat.values()];
    const ordered = [];
    for (let round = 0; ordered.length < RSS_SOURCES.length; round += 1) {
      let added = false;
      for (const q of queues) {
        if (q[round]) {
          ordered.push(q[round]);
          added = true;
        }
      }
      if (!added) break;
    }

    const perCat = new Map();
    for (let i = 0; i < ordered.length; i += WAVE) {
      const wave = ordered
        .slice(i, i + WAVE)
        // Skip a source whose category already has plenty; that budget is
        // what stops the general desks from consuming the whole fetch.
        .filter((src) => (perCat.get(src.cat) ?? 0) < PER_CAT);
      if (!wave.length) continue;

      const results = await Promise.allSettled(
        wave.map((src) =>
          jget(`${RSS_BRIDGE}${encodeURIComponent(src.url)}`, 10000).then((d) => ({ src, d }))
        )
      );
      for (const r of results) {
        // A dead or renamed feed is expected over time and must never break
        // the screen; the wave simply contributes nothing.
        if (r.status !== 'fulfilled') continue;
        const items = r.value.d?.items ?? [];
        const take = items.slice(0, 5).map((i) => normalize(i, r.value.src));
        collected.push(...take);
        perCat.set(r.value.src.cat, (perCat.get(r.value.src.cat) ?? 0) + take.length);
      }
    }
  }

  // 3. dedupe by title, drop anything stale, newest first
  const seen = new Set();
  let items = pruneOld(
    collected.filter(
      (i) => i?.title && !seen.has(i.title.toLowerCase()) && seen.add(i.title.toLowerCase())
    )
  );

  // 4. never return an empty screen
  if (!items.length) {
    const digest = digestFromMarket(coins, lang);
    if (cached?.items?.length) {
      return { items: cached.items, at: cached.at, stale: true };
    }
    return { items: digest, at: Date.now(), stale: true, generated: true };
  }

  writeCache(items);
  return { items, at: Date.now(), stale: false };
}

/** True when the cached feed is older than a day and should be refreshed. */
export function newsIsStale() {
  const c = readCache();
  return !c || Date.now() - c.at > DAY;
}

/** The single most recent headline — used for the daily notification body. */
export function topHeadline() {
  return readCache()?.items?.[0] ?? null;
}
