/**
 * AI analysis backend — Multi-AI Intelligence Layer (FBT AI Gateway).
 *
 * ─── WHY THIS IS SERVER-SIDE ──────────────────────────────────────────────
 * These are BILLABLE keys. Provider keys (OpenRouter, Gemini, Groq, Anthropic,
 * DeepSeek, Mistral, Workers AI, AIMLAPI…) shipped in the client bundle would be
 * readable by anyone. So the keys live only in server env vars, and the browser
 * calls our own /api/v1/ai/* and /api/ai/* endpoints.
 *
 * Responses are cached appropriately to optimize costs and latency.
 * ──────────────────────────────────────────────────────────────────────────
 */

import {
  PROVIDER_CONFIGS,
  isProviderConfigured,
  getActiveProviderIds,
  anyAiConfigured,
  routedChat,
  executeProviderChat,
  gatewaySelfTest
} from './aiGateway.js';

const JINA_SEARCH_URL = 'https://s.jina.ai/';
const JINA_KEY = process.env.JINA_API_KEY || '';
const TIMEOUT_MS = Number(process.env.AI_TIMEOUT_MS || 45000);

const GROQ_KEY = process.env.GROQ_API_KEY || '';
const GROQ_MODEL = process.env.GROQ_MODEL || 'openai/gpt-oss-20b';
const GEMINI_KEY = process.env.GEMINI_API_KEY || process.env.VITE_GEMINI_API_KEY || '';
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.0-flash';
const OPENROUTER_KEY = process.env.OPENROUTER_API_KEY || '';
const MODEL = process.env.AI_MODEL || 'openai/gpt-4o-mini';

/** Check if any external AI provider is configured */
export const aiConfigured = () => anyAiConfigured();

/** Active primary provider identifier */
export const aiProvider = () => {
  if (GROQ_KEY) return 'groq';
  if (GEMINI_KEY) return 'gemini';
  if (OPENROUTER_KEY) return 'openrouter';
  if (process.env.ANTHROPIC_API_KEY) return 'anthropic';
  if (process.env.DEEPSEEK_API_KEY) return 'deepseek';
  if (process.env.MISTRAL_API_KEY) return 'mistral';
  if (process.env.AIMLAPI_KEY) return 'aimlapi';
  if (process.env.CLOUDFLARE_API_TOKEN && process.env.CLOUDFLARE_ACCOUNT_ID) return 'workersai';
  return null;
};

/**
 * Diagnostic self-test for configured AI providers.
 */
export async function aiSelfTest() {
  const activeIds = getActiveProviderIds().filter((id) => id !== 'internal');
  const out = {
    groqKeyPresent: Boolean(GROQ_KEY),
    geminiKeyPresent: Boolean(GEMINI_KEY),
    openrouterKeyPresent: Boolean(OPENROUTER_KEY),
    anthropicKeyPresent: Boolean(process.env.ANTHROPIC_API_KEY),
    deepseekKeyPresent: Boolean(process.env.DEEPSEEK_API_KEY),
    mistralKeyPresent: Boolean(process.env.MISTRAL_API_KEY),
    aimlapiKeyPresent: Boolean(process.env.AIMLAPI_KEY),
    workersaiKeyPresent: Boolean(process.env.CLOUDFLARE_API_TOKEN && process.env.CLOUDFLARE_ACCOUNT_ID),
    jinaKeyPresent: Boolean(JINA_KEY),
    provider: aiProvider(),
    activeProviders: activeIds,
    groqModel: GROQ_MODEL,
    geminiModel: GEMINI_MODEL,
    openrouterModel: MODEL
  };

  if (!aiConfigured()) {
    out.ok = false;
    out.reason = 'NO_KEY';
    out.fix =
      'Set GROQ_API_KEY, GEMINI_API_KEY, OPENROUTER_API_KEY or ANTHROPIC_API_KEY in your environment, ' +
      'then redeploy. These must NOT have a VITE_ prefix (except VITE_GEMINI_API_KEY for Android build).';
    return out;
  }

  const started = Date.now();
  try {
    const res = await routedChat({
      taskType: 'fast',
      system: 'Reply with the single word: ok',
      user: 'ping',
      temperature: 0,
      maxTokens: 12,
      json: false
    });
    out.ok = true;
    out.model = res.model;
    out.provider = res.provider;
    out.latencyMs = Date.now() - started;
    out.sample = String(res.text).trim().slice(0, 40);
    return out;
  } catch (err) {
    const msg = String(err.message || err);
    out.ok = false;
    out.latencyMs = Date.now() - started;
    out.error = msg.slice(0, 300);

    if (/API_KEY_INVALID|API key not valid|invalid_api_key|^401/i.test(msg)) {
      out.reason = 'KEY_INVALID';
      out.fix = 'The API key is wrong, was revoked, or has stray characters. Generate a fresh key and paste it with no quotes or spaces.';
    } else if (/^403|PERMISSION_DENIED|SERVICE_DISABLED/i.test(msg)) {
      out.reason = 'KEY_RESTRICTED';
      out.fix = 'The key is valid but not allowed to make this call. Check permissions or IP restrictions in provider console.';
    } else if (/^429|RESOURCE_EXHAUSTED|quota/i.test(msg)) {
      out.reason = 'QUOTA';
      out.fix = 'Rate limit or free-tier quota exhausted. Wait or enable billing.';
    } else if (/model_not_found|does not exist|decommissioned/i.test(msg)) {
      out.reason = 'MODEL_NOT_FOUND';
      out.fix = 'The configured model is not available. Check provider model list.';
    } else if (/abort|timeout/i.test(msg)) {
      out.reason = 'TIMEOUT';
      out.fix = 'The provider did not answer in time.';
    } else {
      out.reason = 'UNKNOWN';
      out.fix = 'See error details.';
    }
    return out;
  }
}

export const newsConfigured = () => Boolean(JINA_KEY);

async function req(url, options, timeout = TIMEOUT_MS) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await fetch(url, { ...options, signal: ctrl.signal });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      const err = new Error(`${res.status}: ${body.slice(0, 200)}`);
      err.status = res.status;
      throw err;
    }
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

/* -------------------------------------------------------------------------- */
/* Jina / DDG News & Web Search                                               */
/* -------------------------------------------------------------------------- */

export async function fetchNews(query, limit = 6) {
  if (!JINA_KEY) return [];
  try {
    const raw = await req(
      `${JINA_SEARCH_URL}?q=${encodeURIComponent(query)}`,
      {
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${JINA_KEY}`,
          'X-Engine': 'direct',
          'X-Respond-With': 'no-content'
        }
      },
      20000
    );

    const items = raw?.data ?? [];
    return items.slice(0, limit).map((d) => ({
      title: d.title,
      url: d.url,
      snippet: (d.description || d.content || '').slice(0, 300),
      date: d.date ?? null
    }));
  } catch (e) {
    console.warn('[ai] jina search failed:', e.message);
    return [];
  }
}

async function ddgSearch(query, limit = 4) {
  try {
    const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`;
    const raw = await req(url, { headers: { accept: 'application/json' } }, 8000);

    const out = [];
    if (raw?.AbstractText) {
      out.push({
        title: raw.Heading || query,
        url: raw.AbstractURL || '',
        snippet: String(raw.AbstractText).slice(0, 300)
      });
    }
    for (const topic of raw?.RelatedTopics ?? []) {
      if (out.length >= limit) break;
      if (!topic?.Text) continue;
      out.push({
        title: String(topic.Text).split(' - ')[0].slice(0, 120),
        url: topic.FirstURL || '',
        snippet: String(topic.Text).slice(0, 300)
      });
    }
    return out.slice(0, limit);
  } catch {
    return [];
  }
}

export async function webSearch(query, limit = 4) {
  if (JINA_KEY) {
    const viaJina = await fetchNews(query, limit);
    if (viaJina.length) return viaJina;
  }
  return ddgSearch(query, limit);
}

/* -------------------------------------------------------------------------- */
/* Multi-Provider Unified Chat Execution                                      */
/* -------------------------------------------------------------------------- */

const SYSTEM_PROMPT = `You are a disciplined crypto market analyst writing a daily briefing for a trading app.

RULES — these are not optional:
1. Base every claim on the technical indicators and news provided. Do not invent data.
2. Never give a single "price target". Give a RANGE and say what would invalidate it.
3. If indicators conflict or the signal is weak, SAY SO. "Unclear" is a valid, valuable answer.
4. Never promise profit. Never say "guaranteed", "sure thing", "can't lose", or similar.
5. Always mention the main risk to your own view — what would prove you wrong.
6. Be concise and concrete. No filler, no hype, no emoji.
7. You are not giving financial advice; you are summarising market conditions.

Respond with STRICT JSON only, no markdown fences:
{
  "bias": "bullish" | "bearish" | "neutral",
  "confidence": 0-100,
  "headline": "one sentence, max 90 chars",
  "summary": "2-3 sentences on what the data shows",
  "range": { "low": number, "high": number, "horizonDays": number },
  "drivers": ["up to 3 short factors supporting the view"],
  "risks": ["up to 3 short factors that would invalidate it"],
  "invalidation": "one sentence: the price level or event that breaks this thesis"
}`;

function buildUserPrompt({ symbol, name, price, indicators, change24h, change7d, news, lang }) {
  const ind = indicators ?? {};
  const lines = [
    `Asset: ${name} (${symbol})`,
    `Current price: $${price}`,
    `24h change: ${change24h?.toFixed?.(2) ?? '?'}%`,
    `7d change: ${change7d?.toFixed?.(2) ?? '?'}%`,
    ''
  ];

  if (ind.rsi != null) lines.push(`RSI(14): ${ind.rsi.toFixed(1)}`);
  if (ind.macd?.histogram != null) lines.push(`MACD histogram: ${ind.macd.histogram.toFixed(4)}`);
  if (ind.bollinger?.percentB != null) lines.push(`Bollinger %B: ${ind.bollinger.percentB.toFixed(2)}`);
  if (ind.volatility != null) lines.push(`Annualised volatility: ${ind.volatility.toFixed(0)}%`);
  if (ind.ma20 != null) lines.push(`MA20: $${ind.ma20.toFixed(4)}`);
  if (ind.ma50 != null) lines.push(`MA50: $${ind.ma50.toFixed(4)}`);
  if (ind.support != null) lines.push(`Nearest support: $${ind.support.toFixed(4)}`);
  if (ind.resistance != null) lines.push(`Nearest resistance: $${ind.resistance.toFixed(4)}`);

  if (news?.length) {
    lines.push('', 'Recent headlines:');
    news.forEach((n, i) => lines.push(`${i + 1}. ${n.title}${n.snippet ? ` — ${n.snippet.slice(0, 160)}` : ''}`));
  } else {
    lines.push('', 'No recent news available — rely on the indicators only and lower your confidence accordingly.');
  }

  if (lang === 'fa') {
    lines.push('', 'Write "headline", "summary", "drivers", "risks" and "invalidation" in Persian (فارسی). Keep JSON keys in English.');
  } else if (lang === 'ar') {
    lines.push('', 'Write the text fields in Arabic. Keep JSON keys in English.');
  }

  return lines.join('\n');
}

/** Strip markdown fences */
function parseJson(text) {
  let t = String(text || '').trim();
  if (t.startsWith('```')) t = t.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
  const start = t.indexOf('{');
  const end = t.lastIndexOf('}');
  if (start === -1 || end === -1) throw new Error('NO_JSON');
  return JSON.parse(t.slice(start, end + 1));
}

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, Number(v) || 0));

/**
 * Universal Chat execution across configured providers via FBT AI Gateway.
 */
export async function chat(opts) {
  if (!aiConfigured()) throw new Error('AI_NOT_CONFIGURED');
  const res = await routedChat({
    taskType: opts.taskType || 'general',
    system: opts.system || '',
    user: opts.user || '',
    temperature: opts.temperature ?? 0.3,
    maxTokens: opts.maxTokens ?? 700,
    json: opts.json ?? true
  });
  return { text: res.text, model: res.model, provider: res.provider };
}

/* -------------------------------------------------------------------------- */
/* Support & General Knowledge Answering                                     */
/* -------------------------------------------------------------------------- */

export async function answerSupportQuestion({ question, context = [], lang = 'fa', web = true }) {
  if (!aiConfigured()) throw new Error('AI_NOT_CONFIGURED');

  const q = String(question || '').slice(0, 500);
  if (!q.trim()) throw new Error('EMPTY_QUESTION');

  const grounded = context.length > 0;
  const facts = context
    .slice(0, 4)
    .map((c, i) => `[${i + 1}] ${String(c).slice(0, 900)}`)
    .join('\n\n');

  let sources = [];
  if (web && !grounded) {
    sources = await webSearch(q, 4);
  }

  const webBlock = sources.length
    ? [
        '',
        'LIVE WEB RESULTS (today — prefer these over your training data for anything time-sensitive):',
        ...sources.map((s2, i) => `(${i + 1}) ${s2.title} — ${s2.snippet}`)
      ].join('\n')
    : '';

  const safety = [
    'SAFETY RULES THAT ALWAYS APPLY:',
    '- Never ask for, or suggest sharing, a seed phrase, private key or password. No legitimate service ever asks.',
    '- On-chain transactions are irreversible. Never imply a swap or transfer can be refunded, reversed or recovered.',
    '- Never recommend buying or selling a specific asset, and never predict a price. Explain instead.',
    '- If you are not sure, say so. A wrong answer about money is worse than no answer.'
  ].join('\n');

  const system = grounded
    ? [
        'You are the support assistant for FBT Swap, a non-custodial crypto exchange.',
        '',
        'This question is about FBT Swap itself, and the REFERENCE below is our own',
        'documentation. It is the ONLY permitted source for facts about this app.',
        '- Never invent a fee, percentage, network, address or recovery method.',
        '- If the reference does not cover part of the question, say so and point to support.',
        '',
        safety,
        '',
        `Reply in language code: ${lang}. Under 90 words, plain and direct.`,
        '',
        'REFERENCE:',
        facts
      ].join('\n')
    : [
        'You are a knowledgeable, friendly crypto educator inside the FBT Swap app.',
        '',
        'Answer the question helpfully using your general knowledge. Explain clearly',
        'for someone who may be new to crypto.',
        '',
        'CRITICAL: you do NOT have documentation about FBT Swap in front of you. If the',
        'question turns out to be about this app specifically — its fees, its supported',
        'networks, its addresses, its features — say you are not certain and tell the',
        'user to check the Help page or contact support. Never guess about FBT Swap.',
        '',
        safety,
        webBlock,
        '',
        `Reply in language code: ${lang}. Under 120 words. No markdown headings.`
      ].join('\n');

  const { text, model } = await chat({
    taskType: 'fast',
    system,
    user: q,
    maxTokens: 420,
    temperature: grounded ? 0.2 : 0.4,
    json: false
  });

  return {
    answer: String(text || '').trim(),
    model,
    grounded,
    sources: sources.map((s2) => ({ title: s2.title, url: s2.url }))
  };
}

export async function generateOutlook(payload) {
  if (!aiConfigured()) throw new Error('AI_NOT_CONFIGURED');

  const news = await fetchNews(`${payload.name} ${payload.symbol} crypto news analysis`, 6);

  const { text, model } = await chat({
    taskType: 'market',
    system: SYSTEM_PROMPT,
    user: buildUserPrompt({ ...payload, news }),
    temperature: 0.3,
    maxTokens: 700,
    json: true
  });

  const parsed = parseJson(text);

  return {
    bias: ['bullish', 'bearish', 'neutral'].includes(parsed.bias) ? parsed.bias : 'neutral',
    confidence: clamp(parsed.confidence, 0, 90),
    headline: String(parsed.headline ?? '').slice(0, 140),
    summary: String(parsed.summary ?? '').slice(0, 700),
    range: parsed.range
      ? {
          low: Number(parsed.range.low) || null,
          high: Number(parsed.range.high) || null,
          horizonDays: Number(parsed.range.horizonDays) || 7
        }
      : null,
    drivers: Array.isArray(parsed.drivers) ? parsed.drivers.slice(0, 3).map((d) => String(d).slice(0, 160)) : [],
    risks: Array.isArray(parsed.risks) ? parsed.risks.slice(0, 3).map((r) => String(r).slice(0, 160)) : [],
    invalidation: String(parsed.invalidation ?? '').slice(0, 240),
    sources: news.map((n) => ({ title: n.title, url: n.url })),
    model,
    generatedAt: Date.now()
  };
}

export async function generateMarketBrief({ global, top, lang }) {
  if (!aiConfigured()) throw new Error('AI_NOT_CONFIGURED');

  const news = await fetchNews('crypto market today bitcoin ethereum analysis', 5);

  const movers = (top ?? [])
    .slice(0, 8)
    .map((c) => `${c.symbol} ${c.change24h >= 0 ? '+' : ''}${c.change24h?.toFixed?.(1)}%`)
    .join(', ');

  const user = [
    `Total market cap: $${((global?.mcap ?? 0) / 1e9).toFixed(1)}B (${global?.mcapChange?.toFixed?.(2) ?? '?'}% 24h)`,
    `BTC dominance: ${global?.btcDominance?.toFixed?.(1) ?? '?'}%`,
    `24h volume: $${((global?.volume ?? 0) / 1e9).toFixed(1)}B`,
    `Movers: ${movers}`,
    news.length ? `\nHeadlines:\n${news.map((n, i) => `${i + 1}. ${n.title}`).join('\n')}` : '\nNo news available.',
    lang === 'fa' ? '\nWrite the text fields in Persian. Keep JSON keys in English.' : '',
    lang === 'ar' ? '\nWrite the text fields in Arabic. Keep JSON keys in English.' : ''
  ].join('\n');

  const { text, model } = await chat({
    taskType: 'market',
    system: `${SYSTEM_PROMPT}\n\nFor this market-wide brief use exactly this JSON shape:\n{"bias":"bullish|bearish|neutral","confidence":0-100,"headline":"max 90 chars","summary":"2-3 sentences","drivers":["..."],"risks":["..."]}`,
    user,
    temperature: 0.3,
    maxTokens: 500,
    json: true
  });

  const parsed = parseJson(text);
  return {
    bias: ['bullish', 'bearish', 'neutral'].includes(parsed.bias) ? parsed.bias : 'neutral',
    confidence: clamp(parsed.confidence, 0, 90),
    headline: String(parsed.headline ?? '').slice(0, 140),
    summary: String(parsed.summary ?? '').slice(0, 700),
    drivers: Array.isArray(parsed.drivers) ? parsed.drivers.slice(0, 3).map((d) => String(d).slice(0, 160)) : [],
    risks: Array.isArray(parsed.risks) ? parsed.risks.slice(0, 3).map((r) => String(r).slice(0, 160)) : [],
    sources: news.map((n) => ({ title: n.title, url: n.url })),
    model,
    generatedAt: Date.now()
  };
}

/**
 * INTENT CLASSIFICATION via AI Gateway.
 */
export async function classifyIntentWithModel({ message = '', intents = [], locale = null } = {}) {
  if (!aiConfigured()) return { ok: false, reason: 'AI_NOT_CONFIGURED' };
  const allowed = Array.isArray(intents) && intents.length
    ? [...new Set(intents.map((i) => String(i).toUpperCase()).filter((i) => /^[A-Z_]{3,20}$/.test(i)))]
    : [];
  if (!allowed.length) return { ok: false, reason: 'NO_INTENT_ENUM' };

  const text = String(message || '').slice(0, 900).trim();
  if (!text) return { ok: false, reason: 'EMPTY_MESSAGE' };

  const user = [
    `Route this one customer message into exactly one intent.`,
    `Allowed intents: ${allowed.join(', ')}.`,
    `Rules:`,
    `- A question about whether to act is RESEARCH, never TRADE.`,
    `- A recurring cadence (daily / weekly / every month / automatically) is AUTOMATION.`,
    `- "risk", "hedge", "protect", "revoke an approval" about the customer's own money is PROTECT.`,
    `- An amount plus a horizon plus a risk tolerance, with no verb, is PORTFOLIO (a plan request).`,
    `- Reply with JSON only: {"intent":"<one of the list>","confidence":<0-1>}`,
    locale ? `- The message is in locale ${locale}. Do not translate it, route it.` : '',
    ``,
    `Message: ${text}`
  ].filter(Boolean).join('\n');

  try {
    const { text: raw, model } = await chat({
      taskType: 'fast',
      system: 'You classify financial intent for a self-custody wallet. You never produce amounts, assets, chains, permissions or advice — only one label from the given enum. If you cannot decide, return GENERAL.',
      user,
      temperature: 0,
      maxTokens: 60,
      json: true
    });
    const parsed = parseJson(raw);
    const intent = String(parsed?.intent || '').trim().toUpperCase();
    if (!allowed.includes(intent)) return { ok: false, reason: 'INTENT_NOT_IN_ENUM', model };
    const confidence = clamp(parsed?.confidence, 0, 0.99);
    return { ok: true, intent, confidence: Number(confidence.toFixed(2)), model };
  } catch (err) {
    return { ok: false, reason: String(err.message || 'AI_FAILED').slice(0, 120) };
  }
}
