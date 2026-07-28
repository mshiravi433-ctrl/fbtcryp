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

const API_BASE = (typeof import.meta !== 'undefined' && import.meta.env?.VITE_API_BASE) || '/api';

/** Public RSS endpoints, read via a JSON bridge that adds CORS headers. */
const RSS_SOURCES = [
  { id: 'cointelegraph', url: 'https://cointelegraph.com/rss' },
  { id: 'coindesk', url: 'https://www.coindesk.com/arc/outboundfeeds/rss/' },
  { id: 'decrypt', url: 'https://decrypt.co/feed' },
  { id: 'bitcoinmagazine', url: 'https://bitcoinmagazine.com/feed' }
];

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

function normalize(item, source) {
  return {
    id: item.guid || item.link || `${source}-${item.title}`,
    title: clean(item.title).slice(0, 180),
    summary: clean(item.description || item.content).slice(0, 320),
    url: item.link,
    image: item.thumbnail || item.enclosure?.link || null,
    source,
    at: item.pubDate ? new Date(item.pubDate).getTime() : Date.now()
  };
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
export async function getNews({ force = false, coins = [], lang = 'en' } = {}) {
  const cached = readCache();
  if (cached && !force && Date.now() - cached.at < DAY) {
    return { items: cached.items, at: cached.at, stale: false };
  }

  const collected = [];

  // 1. our backend
  try {
    const data = await jget(`${API_BASE}/news?lang=${encodeURIComponent(lang)}`);
    if (Array.isArray(data?.items)) collected.push(...data.items);
  } catch {
    /* no backend deployed */
  }

  // 2. public RSS, in parallel — one slow desk shouldn't hold up the rest
  if (collected.length < 12) {
    const results = await Promise.allSettled(
      RSS_SOURCES.map((s) => jget(`${RSS_BRIDGE}${encodeURIComponent(s.url)}`, 10000).then((d) => ({ s, d })))
    );
    for (const r of results) {
      if (r.status !== 'fulfilled') continue;
      const items = r.value.d?.items ?? [];
      collected.push(...items.slice(0, 8).map((i) => normalize(i, r.value.s.id)));
    }
  }

  // 3. dedupe by title, newest first
  const seen = new Set();
  let items = collected
    .filter((i) => i?.title && !seen.has(i.title.toLowerCase()) && seen.add(i.title.toLowerCase()))
    .sort((a, b) => (b.at ?? 0) - (a.at ?? 0))
    .slice(0, 40);

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
