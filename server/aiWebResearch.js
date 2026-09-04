/**
 * FBT SMART INTENT OS — AI UPGRADE 5: WEB RESEARCH ENGINE
 * ---------------------------------------------------------------------------
 * Connects the Intent OS to live internet research (§12) using the project's
 * EXISTING search stack (server/ai.js webSearch → Jina when keyed, DuckDuckGo
 * otherwise) — no duplicate gateway, no new key requirement.
 *
 *   User Question
 *     ↓ freshness requirement (STATIC/RECENT/LIVE/BREAKING)   §15
 *     ↓ Search Web (existing webSearch)                       §12
 *     ↓ Collect + TIER sources (Tier 1-4)                     §21
 *     ↓ AI analyzes sources (grounded, cited)                 §22
 *     ↓ Cross-check / answer with evidence
 *
 * Honesty laws:
 *   - NEVER fabricate sources. If search returns nothing, the answer says the
 *     fact could not be verified right now (§59).
 *   - Social media is a LEAD, not verified fact (Tier 4) (§21).
 *   - The impact score is analytical, never a guarantee (§19).
 */

import { webSearch } from './ai.js';
import { routedChat, getActiveProviderIds, anyAiConfigured } from './aiGateway.js';
import { sanitizePrompt } from './aiGateway.js';
import { classifyFreshness } from '../src/lib/intent-ai/os/collaborationRouter.js';
import { SLANG_ASSET_MAP } from '../src/lib/intent-ai/os/intentUnderstandingEngine.js';

export const WEB_RESEARCH_SCHEMA = 'fbt.web-research.v1';
export const NEWS_IMPACT_SCHEMA = 'fbt.news-impact.v1';

/* -------------------------------------------------------------------------- */
/*  SOURCE QUALITY TIERS (§21)                                                 */
/* -------------------------------------------------------------------------- */

const TIER_1_HOSTS = [
  'bitcoin.org', 'ethereum.org', 'solana.com', 'tether.to', 'sec.gov', 'fed.gov',
  'federalreserve.gov', 'ecb.europa.eu', 'binance.com/en/support', 'github.com',
  'docs.', 'official', 'bankmarkazi', 'cbi.ir', 'seo.ir', '.gov'
];
const TIER_2_HOSTS = [
  'coindesk.com', 'cointelegraph.com', 'reuters.com', 'bloomberg.com', 'ft.com',
  'wsj.com', 'theblock.co', 'decrypt.co', 'forbes.com', 'apnews.com', 'cnbc.com',
  'bbc.com', 'economist.com'
];
const TIER_3_HOSTS = [
  'cryptoslate.com', 'cryptopotato.com', 'u.today', 'beincrypto.com',
  'bitcoinmagazine.com', 'coinjournal.net', 'thedefiant.io', 'blockworks.co', 'dlnews.com'
];
const TIER_4_HOSTS = [
  'twitter.com', 'x.com', 'reddit.com', 't.me', 'telegram.me', 'medium.com',
  'youtube.com', 'tiktok.com', 'instagram.com', 'discord'
];

export function classifySourceTier(url) {
  const host = String(url || '').toLowerCase();
  if (!host) return 4;
  for (const h of TIER_4_HOSTS) if (host.includes(h)) return 4;
  for (const h of TIER_1_HOSTS) if (host.includes(h)) return 1;
  for (const h of TIER_2_HOSTS) if (host.includes(h)) return 2;
  for (const h of TIER_3_HOSTS) if (host.includes(h)) return 3;
  return 3; // unknown publications default to industry tier, never tier 1
}

export const SOURCE_TIER_LABELS = Object.freeze({
  1: 'Official / primary source',
  2: 'Major news organization',
  3: 'Industry publication',
  4: 'Social media (lead only)'
});

/* -------------------------------------------------------------------------- */
/*  WEB RESEARCH (§12)                                                         */
/* -------------------------------------------------------------------------- */

/**
 * Search the web for a question that needs current information.
 * Uses the existing `webSearch` (Jina if JINA_API_KEY, else DuckDuckGo).
 * Returns tiered sources; social results are kept but ranked last.
 */
export async function researchWeb({ query, limit = 5, freshness = null, locale = 'fa' } = {}) {
  const q = sanitizePrompt(String(query || '').slice(0, 400)).trim();
  if (!q) return { ok: false, error: 'EMPTY_QUERY', sources: [] };

  const resolvedFreshness = freshness || classifyFreshness(q);
  let raw = [];
  try {
    raw = await webSearch(q, Math.min(8, Math.max(3, Number(limit) || 5)));
  } catch {
    raw = [];
  }

  const sources = (Array.isArray(raw) ? raw : [])
    .map((s) => ({
      title: String(s?.title || '').slice(0, 160),
      url: String(s?.url || '').slice(0, 400),
      snippet: String(s?.snippet || '').slice(0, 400),
      tier: classifySourceTier(s?.url)
    }))
    .filter((s) => s.title || s.snippet)
    .sort((a, b) => a.tier - b.tier)
    .slice(0, Math.min(8, Math.max(3, Number(limit) || 5)));

  /* BREAKING events require multi-source corroboration (§20): one lone tweet
     is a lead, not a fact. */
  const distinctHosts = new Set(sources.map((s) => {
    try { return new URL(s.url).hostname.replace(/^www\./, ''); } catch { return s.url; }
  }));
  const corroborated = distinctHosts.size >= 2;

  return {
    ok: sources.length > 0,
    schema: WEB_RESEARCH_SCHEMA,
    query: q,
    freshness: resolvedFreshness,
    sources,
    sourceCount: sources.length,
    corroborated,
    corroboratingHosts: distinctHosts.size,
    needsMoreEvidence: resolvedFreshness === 'BREAKING' && !corroborated,
    at: Date.now()
  };
}

/* -------------------------------------------------------------------------- */
/*  GROUNDED ANALYSIS WITH SOURCES (§22)                                       */
/* -------------------------------------------------------------------------- */

function parseJsonSafe(text) {
  let t = String(text || '').trim();
  if (t.startsWith('```')) t = t.replace(/^```(?:json)?\s*/i, '').replace(/```$/, '').trim();
  const start = t.indexOf('{');
  const end = t.lastIndexOf('}');
  if (start === -1 || end === -1) return null;
  try { return JSON.parse(t.slice(start, end + 1)); } catch { return null; }
}

/**
 * Analyze a question strictly from the collected sources. The model may only
 * cite the numbered sources it was given — citations outside the list are
 * dropped, so no source can be fabricated (§22).
 */
export async function analyzeWithSources({ question, sources = [], context = {}, locale = 'fa' } = {}) {
  const q = sanitizePrompt(String(question || '').slice(0, 600));
  const list = (Array.isArray(sources) ? sources : []).slice(0, 8);
  const isFa = String(locale || 'fa').startsWith('fa') || /[آ-ی]/.test(q);

  if (!list.length) {
    return {
      ok: false,
      schema: WEB_RESEARCH_SCHEMA,
      answer: isFa
        ? 'در حال حاضر منبع معتبری برای تأیید این موضوع پیدا نکردم. نمی‌خواهم بدون شاهد پاسخ قطعی بدهم.'
        : 'I could not find a verifiable source for this right now, so I will not give a definitive answer.',
      sources: [],
      verified: false,
      reason: 'NO_SOURCES'
    };
  }

  const marketLine = context?.market?.priceMap
    ? `LIVE MARKET DATA (authoritative — overrides any conflicting number in the sources): ${JSON.stringify(context.market.priceMap)}`
    : '';

  const system = [
    'You are the FBT research analyst. Answer ONLY from the numbered sources below.',
    'Rules:',
    '- Cite sources by number like [1] next to claims they support.',
    '- If the sources do not cover part of the question, say that part is unverified.',
    '- Never invent a source, number, date, price or quote that is not in the material.',
    '- Social-media sources (tier 4) are leads: attribute them explicitly and do not state them as fact.',
    '- This is analysis, not financial advice.',
    '',
    'Respond in STRICT JSON:',
    '{',
    '  "answer": "the grounded answer with [n] citations",',
    '  "usedSources": [numbers actually used],',
    '  "confidence": 0-100,',
    '  "gaps": ["what the sources do not answer"]',
    '}',
    '',
    isFa ? 'Write "answer" and "gaps" in Persian (فارسی). Keep JSON keys in English.' : 'Write "answer" and "gaps" in English.'
  ].join('\n');

  const user = [
    `Question: ${q}`,
    marketLine,
    '',
    'SOURCES:',
    ...list.map((s, i) => `(${i + 1}) [tier ${s.tier}] ${s.title} — ${s.snippet} (${s.url})`),
    ''
  ].filter(Boolean).join('\n');

  const res = await routedChat({
    taskType: 'research',
    system,
    user,
    temperature: 0.2,
    maxTokens: 700,
    json: true
  });

  const parsed = parseJsonSafe(res.text) || null;
  const used = Array.isArray(parsed?.usedSources)
    ? parsed.usedSources.map(Number).filter((n) => Number.isInteger(n) && n >= 1 && n <= list.length)
    : list.map((_s, i) => i + 1).slice(0, 3);

  const answer = String(parsed?.answer || res.text || '').slice(0, 1600);
  return {
    ok: true,
    schema: WEB_RESEARCH_SCHEMA,
    answer,
    language: isFa ? 'fa' : 'en',
    sources: [...new Set(used)].map((n) => list[n - 1]).filter(Boolean),
    usedSourceNumbers: [...new Set(used)],
    confidence: Math.min(100, Math.max(0, Number(parsed?.confidence) || 50)),
    gaps: Array.isArray(parsed?.gaps) ? parsed.gaps.slice(0, 4).map((g) => String(g).slice(0, 160)) : [],
    verified: used.length > 0 && list.some((s) => s.tier <= 2 && used.includes(list.indexOf(s) + 1)),
    model: res.model,
    provider: res.provider,
    degraded: Boolean(res.degraded),
    at: Date.now()
  };
}

/* -------------------------------------------------------------------------- */
/*  NEWS → CRYPTO IMPACT ENGINE (§18-20)                                       */
/* -------------------------------------------------------------------------- */

const EVENT_CLASSES = Object.freeze([
  'REGULATION', 'MACRO', 'ETF_FLOW', 'HACK_EXPLOIT', 'LISTING_DELISTING',
  'PROTOCOL_UPGRADE', 'PARTNERSHIP', 'MARKET_MOVE', 'ADOPTION', 'OTHER'
]);

const EVENT_HINTS = [
  [/regulat|قانون|مقررات|sec\b|رگولاتور|دولت|government|ban\b|ممنوع|approve|تصویب/i, 'REGULATION'],
  [/rate|نرخ بهره|fed\b|فدرال|inflation|تورم|cpi|macro|کلان/i, 'MACRO'],
  [/\betf\b|صندوق قابل معامله/i, 'ETF_FLOW'],
  [/hack|exploit|هک|سرقت|stolen|دزدیده|breach|نفوذ/i, 'HACK_EXPLOIT'],
  [/listing|delist|لیست شدن|حذف از صرافی|اضافه شدن به صرافی/i, 'LISTING_DELISTING'],
  [/upgrade|hard\s*fork|ارتقا|به\s*روزرسانی\s*شبکه|merge/i, 'PROTOCOL_UPGRADE'],
  [/partner|شراکت|همکاری|integration|ادغام/i, 'PARTNERSHIP'],
  [/surge|plunge|rally|ریزش|رشد\s*شدید|سقوط|پامپ|dump|pump/i, 'MARKET_MOVE'],
  [/adopt|پذیرش|payment|پرداخت|merchant/i, 'ADOPTION']
];

export function extractNewsEntities(newsText) {
  const text = String(newsText || '');
  const lower = ` ${text.toLowerCase()} `;
  const assets = new Set();
  for (const [alias, symbol] of Object.entries(SLANG_ASSET_MAP)) {
    const a = String(alias).toLowerCase();
    if (a.length < 3) continue;
    if (lower.includes(` ${a} `) || lower.includes(` ${a},`) || lower.includes(` ${a}.`)) assets.add(symbol);
  }
  let eventClass = 'OTHER';
  for (const [re, cls] of EVENT_HINTS) {
    if (re.test(text)) { eventClass = cls; break; }
  }
  return { assets: [...assets], eventClass };
}

/**
 * News → Crypto impact analysis. Structured score (§19):
 *   impactDirection positive/negative/neutral/mixed
 *   impactStrength  0-100   (analytical, NOT a guarantee)
 *   confidence      0-100
 *   timeHorizon     immediate/short/medium/long
 * Never claims certainty (§18).
 */
export async function analyzeNewsImpact({ news = '', assets = [], marketContext = {}, locale = 'fa', webEvidence = null } = {}) {
  const text = sanitizePrompt(String(news || '').slice(0, 1200));
  if (!text.trim()) return { ok: false, error: 'EMPTY_NEWS' };

  const extracted = extractNewsEntities(text);
  const affectedAssets = assets.length ? assets : extracted.assets;
  const isFa = String(locale || 'fa').startsWith('fa') || /[آ-ی]/.test(text);

  const system = [
    'You are the FBT News Impact Analyst for crypto markets.',
    'Analyze the DIRECT and INDIRECT impact of this news on crypto assets.',
    'Hard rules:',
    '- Never claim certainty. Every scenario is conditional.',
    '- Base directional calls on how similar events historically affected markets; say when that basis is weak.',
    '- If the news is unverified or single-sourced, lower confidence and say so.',
    '- This is analysis, not financial advice.',
    '',
    'Respond in STRICT JSON:',
    '{',
    '  "eventClass": "REGULATION|MACRO|ETF_FLOW|HACK_EXPLOIT|LISTING_DELISTING|PROTOCOL_UPGRADE|PARTNERSHIP|MARKET_MOVE|ADOPTION|OTHER",',
    '  "summary": "1-2 sentence neutral summary of the event",',
    '  "directImpact": [{"asset":"BTC","direction":"positive|negative|neutral|mixed","reason":"..."}],',
    '  "indirectImpact": ["liquidity effects", "risk-asset correlation", ...],',
    '  "bullScenario": "what supports upside, conditional",',
    '  "bearScenario": "what argues for downside, conditional",',
    '  "neutralScenario": "the base case",',
    '  "impactDirection": "positive|negative|neutral|mixed",',
    '  "impactStrength": 0-100,',
    '  "confidence": 0-100,',
    '  "timeHorizon": "immediate|short|medium|long",',
    '  "uncertainty": "what would change this read"',
    '}',
    '',
    isFa ? 'Write all human text fields in Persian (فارسی). Keep JSON keys in English.' : 'Write all human text fields in English.'
  ].join('\n');

  const user = [
    `NEWS: ${text}`,
    affectedAssets.length ? `AFFECTED ASSETS: ${affectedAssets.join(', ')}` : '',
    marketContext?.priceMap ? `LIVE MARKET CONTEXT: ${JSON.stringify(marketContext.priceMap).slice(0, 300)}` : '',
    webEvidence?.sources?.length
      ? `CORROBORATING WEB SOURCES (${webEvidence.corroborated ? 'multi-source' : 'SINGLE SOURCE — treat as lead'}):\n${webEvidence.sources.slice(0, 5).map((s, i) => `(${i + 1}) [tier ${s.tier}] ${s.title} — ${s.snippet.slice(0, 160)}`).join('\n')}`
      : 'No web corroboration available — treat the news as user-reported and cap confidence at 60.',
    ''
  ].filter(Boolean).join('\n');

  const res = await routedChat({
    taskType: 'market',
    system,
    user,
    temperature: 0.25,
    maxTokens: 800,
    json: true
  });

  const parsed = parseJsonSafe(res.text) || {};
  const direction = ['positive', 'negative', 'neutral', 'mixed'].includes(String(parsed.impactDirection).toLowerCase())
    ? String(parsed.impactDirection).toLowerCase() : 'neutral';
  const horizon = ['immediate', 'short', 'medium', 'long'].includes(String(parsed.timeHorizon).toLowerCase())
    ? String(parsed.timeHorizon).toLowerCase() : 'short';
  const corroborated = Boolean(webEvidence?.corroborated);
  let confidence = Math.min(100, Math.max(0, Number(parsed.confidence) || 40));
  if (!corroborated) confidence = Math.min(60, confidence); // single-source cap (§20)

  return {
    ok: true,
    schema: NEWS_IMPACT_SCHEMA,
    eventClass: EVENT_CLASSES.includes(String(parsed.eventClass).toUpperCase()) ? String(parsed.eventClass).toUpperCase() : extracted.eventClass,
    summary: String(parsed.summary || '').slice(0, 400),
    affectedAssets,
    directImpact: Array.isArray(parsed.directImpact)
      ? parsed.directImpact.slice(0, 6).map((d) => ({
          asset: String(d?.asset || '').slice(0, 12).toUpperCase(),
          direction: ['positive', 'negative', 'neutral', 'mixed'].includes(String(d?.direction).toLowerCase()) ? String(d.direction).toLowerCase() : 'neutral',
          reason: String(d?.reason || '').slice(0, 240)
        }))
      : [],
    indirectImpact: Array.isArray(parsed.indirectImpact) ? parsed.indirectImpact.slice(0, 5).map((x) => String(x).slice(0, 240)) : [],
    bullScenario: String(parsed.bullScenario || '').slice(0, 500),
    bearScenario: String(parsed.bearScenario || '').slice(0, 500),
    neutralScenario: String(parsed.neutralScenario || '').slice(0, 500),
    impactDirection: direction,
    impactStrength: Math.min(100, Math.max(0, Number(parsed.impactStrength) || 0)),
    confidence,
    timeHorizon: horizon,
    uncertainty: String(parsed.uncertainty || '').slice(0, 400),
    corroboration: {
      corroborated,
      sourceCount: webEvidence?.sourceCount || 0,
      treatedAs: corroborated ? 'reported-by-multiple-sources' : 'lead-only'
    },
    disclaimer: isFa
      ? 'این یک تحلیل شرایطی است، نه پیش‌بینی قطعی یا توصیه مالی.'
      : 'This is conditional analysis, not a certain forecast or financial advice.',
    model: res.model,
    provider: res.provider,
    degraded: Boolean(res.degraded),
    aiConfigured: anyAiConfigured(),
    providersAvailable: getActiveProviderIds().filter((id) => id !== 'internal').length,
    at: Date.now()
  };
}

/**
 * Multi-AI news verification helper (§20): search first, then let the impact
 * engine know whether independent sources corroborate the story.
 */
export async function verifyNewsWithWeb(news, { locale = 'fa', limit = 5 } = {}) {
  const query = sanitizePrompt(String(news || '').slice(0, 300));
  const research = await researchWeb({ query, limit, locale });
  return research;
}
