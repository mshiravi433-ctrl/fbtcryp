/**
 * FBT INTENT OS — PHASE 213: WEB SEARCH YOU CAN ASK FOR, IN CHAT
 * ---------------------------------------------------------------------------
 * The complaint this module exists to answer:
 *
 *   «یا اینکه جستجو در نت هم باشد و همه اپشن‌ها فعال باشد»
 *
 * Web research already existed on the server (`server/aiWebResearch.js`, behind
 * `POST /api/v1/ai/research`, tiered sources, Jina when keyed and DuckDuckGo
 * otherwise) and the collaboration layer used it when the router decided a turn
 * needed it. What was missing is the user's own door:
 *
 *   «جستجو کن …» / «سرچ کن …» / «search for …»
 *
 * This module turns that sentence into a real, cited search — or into an honest
 * "I could not search", never a story about what the internet says.
 *
 * Laws:
 *   · Sources are what the search returned. If nothing came back, the message
 *     says so; a fabricated citation is the worst possible answer here.
 *   · Social results (tier 4) are presented as leads, not facts.
 *   · The search never touches execution authority: it informs a turn.
 */

export const SEARCH_CHAT_SCHEMA = 'fbt.chat-search.v1';

export const SOURCE_TIER_LABELS = Object.freeze({
  1: { fa: 'منبع رسمی / اولیه', en: 'Official / primary source' },
  2: { fa: 'رسانه معتبر', en: 'Major news organization' },
  3: { fa: 'نشریه تخصصی', en: 'Industry publication' },
  4: { fa: 'شبکه اجتماعی (فقط سرنخ)', en: 'Social media (lead only)' }
});

export const SEARCH_HONESTY = Object.freeze({
  neverFabricatesSources: true,
  socialIsALead: true,
  searchGrantsNoAuthority: true
});

const isFa = (locale) => String(locale || 'fa').toLowerCase().startsWith('fa');
const fold = (v) => String(v || '').replace(/\u200c/g, ' ').replace(/\s+/g, ' ').trim();

/* -------------------------------------------------------------------------- */
/*  COMMANDS                                                                   */
/* -------------------------------------------------------------------------- */

const COMMAND_PATTERNS = [
  { re: /^(?:لطفا\s*)?(?:از\s*)?(?:اینترنت|نت|وب|گوگل|اینترنتی)\s*(?:هم)?\s*(?:جستجو|جست‌و‌جو|بگرد|سرچ|نگاه)\s*(?:کن|کنید)?/i, freshness: 'LIVE' },
  { re: /^(?:لطفا\s*)?(?:جستجو|جست‌و‌جو|سرچ|بگرد|بگردش|تحقیق)\s*(?:کن|کنید|بکن)?/i, freshness: 'RECENT' },
  { re: /^(?:search|look\s*up|google|browse|research)\s*(?:for|about|the\s*web)?/i, freshness: 'RECENT' },
  { re: /^(?:اخبار|خبر|آخرین\s*اخبار|آخرین\s*خبر|news)\s*(?:دربارهٔ|درباره|از|مربوط\s*به|about|on|of)?/i, freshness: 'BREAKING' },
  { re: /^(?:what'?s\s*new\s*(?:with|about)|latest\s*(?:news\s*)?(?:about|on|with))/i, freshness: 'BREAKING' }
];

/**
 * Is this a search request, and what is the query?
 * Returns null when the sentence is an ordinary turn (the normal pipeline owns
 * it — this module must not steal questions the collaboration router handles).
 */
export function parseSearchRequest(text, { locale = 'fa' } = {}) {
  const raw = String(text || '').trim();
  if (!raw) return null;
  let rest = raw;
  let freshness = 'RECENT';
  let explicit = false;
  for (const entry of COMMAND_PATTERNS) {
    const m = rest.match(entry.re);
    if (m) {
      rest = rest.slice(m[0].length).trim();
      freshness = entry.freshness;
      explicit = true;
      break;
    }
  }
  if (!explicit) {
    /* A trailing «در نت جستجو کن» also counts. */
    const tail = raw.match(/(?:^|\s)(?:در\s*(?:اینترنت|نت|وب)|آنلاین|on\s*the\s*web|online)\s*(?:جستجو|جست‌و‌جو|سرچ|بگرد)?\s*(?:کن|کنید)?\s*$/i);
    if (tail) {
      rest = raw.slice(0, tail.index).trim();
      freshness = 'LIVE';
      explicit = true;
    }
  }
  if (!explicit) return null;
  const query = rest
    .replace(/^[:\-–—،,]\s*/, '')
    .replace(/^(?:دربارهٔ|درباره|از|راجع\s*به|در\s*مورد|about|on|for)\s+/i, '')
    .replace(/[.،!؟?]+$/g, '')
    .trim();
  return {
    ok: true,
    explicit: true,
    query: query || null,
    needsQuery: !query,
    freshness,
    locale: isFa(locale) ? 'fa' : 'en'
  };
}

/** Even when the user did not say "search", a LIVE/BREAKING question needs it. */
export function shouldForceWebSearch(text, { classification = null } = {}) {
  const parsed = parseSearchRequest(text);
  if (parsed) return true;
  const freshness = String(classification?.freshness || '').toUpperCase();
  return freshness === 'LIVE' || freshness === 'BREAKING';
}

/* -------------------------------------------------------------------------- */
/*  RUN                                                                        */
/* -------------------------------------------------------------------------- */

function normalizeSources(rows = []) {
  return (Array.isArray(rows) ? rows : [])
    .filter((s) => s && (s.url || s.title))
    .slice(0, 8)
    .map((s) => ({
      title: String(s.title || s.url).slice(0, 200),
      url: String(s.url || '').slice(0, 500),
      tier: [1, 2, 3, 4].includes(Number(s.tier)) ? Number(s.tier) : 3,
      snippet: String(s.snippet || '').slice(0, 200)
    }));
}

/**
 * Run the search through the injected research function (the browser gateway's
 * `aiResearch` in the app, a fake in tests). Returns a result object; it never
 * throws and never invents data.
 */
export async function runChatSearch({ query, locale = 'fa', research = null, limit = 6 } = {}) {
  const q = fold(query);
  if (!q) return { ok: false, reason: 'NO_QUERY', query: null, sources: [] };
  if (typeof research !== 'function') return { ok: false, reason: 'RESEARCH_UNAVAILABLE', query: q, sources: [] };
  let raw = null;
  try {
    raw = await research({ query: q, locale: isFa(locale) ? 'fa' : 'en', limit, analyze: true });
  } catch (err) {
    return { ok: false, reason: 'RESEARCH_FAILED', detail: String(err?.message || err).slice(0, 160), query: q, sources: [] };
  }
  if (!raw || raw.ok !== true) {
    return { ok: false, reason: raw?.error || raw?.reason || 'SEARCH_FAILED', query: q, sources: [] };
  }
  const sources = normalizeSources(raw.sources || raw.results || []);
  const answer = String(raw.answer || raw.analysis || '').trim();
  return {
    ok: true,
    query: q,
    sources,
    answer: answer || null,
    /* "The search worked and found nothing" is a different fact from "the
       search failed" — the message says which one happened. */
    reason: sources.length ? null : 'NO_RESULTS',
    degraded: Boolean(raw.degraded),
    provider: raw.provider || raw.engine || null,
    knowledgeUsed: Boolean(raw.knowledgeUsed),
    webUsed: raw.webUsed !== false && sources.length > 0
  };
}

/* -------------------------------------------------------------------------- */
/*  RENDER                                                                     */
/* -------------------------------------------------------------------------- */

export function formatSources(sources = [], locale = 'fa') {
  const fa = isFa(locale);
  return normalizeSources(sources).map((s, i) => {
    const tier = SOURCE_TIER_LABELS[s.tier]?.[fa ? 'fa' : 'en'] || '';
    return `${i + 1}. [${tier}] ${s.title}${s.url ? ` — ${s.url}` : ''}`;
  });
}

/**
 * The chat message for a finished search. When the search failed, the message
 * says exactly that and offers the honest next step — it does not describe
 * imaginary findings.
 */
export function searchToMessage(result, { query = null, locale = 'fa' } = {}) {
  const fa = isFa(locale);
  const q = result?.query || fold(query) || '';
  const sources = normalizeSources(result?.sources || []);
  if (result?.ok && sources.length) {
    const lines = [
      fa ? `جستجو در نت برای «${q}» (${sources.length} منبع):` : `Web results for "${q}" (${sources.length} source(s)):`,
      ...(result.answer ? [result.answer] : []),
      ...formatSources(sources, locale)
    ];
    return {
      id: `search_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
      role: 'ai',
      kind: 'assistant',
      content: lines.join('\n'),
      ui: { type: 'TEXT' },
      intelligence: {
        schema: 'fbt.intelligence-meta.v1',
        sources: sources.map((s) => ({ title: s.title, url: s.url, tier: s.tier, snippet: s.snippet })),
        webUsed: true,
        degraded: Boolean(result.degraded),
        query: q
      },
      actions: []
    };
  }
  const reasonText = {
    NO_QUERY: fa ? 'سؤالت را دقیق‌تر بگو تا جستجو کنم.' : 'Tell me the exact question to search for.',
    NO_RESULTS: result?.ok
      ? (fa ? 'جستجو چیزی برنگرداند — منبعی ساخته نمی‌شود.' : 'The search returned nothing — no source is invented.')
      : null,
    RESEARCH_UNAVAILABLE: fa
      ? 'ابزار جستجوی وب در این نسخه در دسترس نیست (سرور پاسخ نداد).'
      : 'The web search tool is unavailable in this build (the server did not respond).',
    SEARCH_FAILED: fa ? 'جستجو چیزی برنگرداند.' : 'The search returned nothing.',
    RESEARCH_FAILED: fa ? 'جستجو با خطا متوقف شد.' : 'The search stopped with an error.'
  }[result?.reason] || (fa ? `جستجو انجام نشد (${result?.reason || 'UNKNOWN'}).` : `The search did not run (${result?.reason || 'UNKNOWN'}).`);
  return {
    id: `search_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
    role: 'ai',
    kind: 'assistant',
    content: [fa ? `جستجو برای «${q}»:` : `Search for "${q}":`, reasonText].join('\n'),
    ui: { type: 'TEXT' },
    intelligence: {
      schema: 'fbt.intelligence-meta.v1',
      sources: [],
      webUsed: false,
      degraded: true,
      query: q,
      reason: result?.reason || 'UNKNOWN'
    },
    actions: []
  };
}

export const SEARCH_CHAT_INFO = Object.freeze({
  schema: SEARCH_CHAT_SCHEMA,
  endpoint: '/api/v1/ai/research',
  maxSources: 8,
  tiers: Object.keys(SOURCE_TIER_LABELS).map(Number)
});
