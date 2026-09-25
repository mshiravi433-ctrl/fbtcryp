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
  getAvailableProviders,
  getFleetSummary,
  getModelCandidates,
  getProviderKeyInfo,
  getProviderHealth,
  normalizeSecretValue,
  classifyAiError,
  orderByHealth,
  getPreferredProvidersForTask,
  anyAiConfigured,
  routedChat,
  executeProviderChat,
  gatewaySelfTest
} from './aiGateway.js';

const JINA_SEARCH_URL = 'https://s.jina.ai/';
const TIMEOUT_MS = Number(process.env.AI_TIMEOUT_MS || 45000);

/*
 * ─── WHY THERE ARE NO PROVIDER KEY CONSTANTS IN THIS FILE ANY MORE ────────
 * This module used to snapshot `GROQ_KEY`, `GEMINI_KEY`, `OPENROUTER_KEY` and
 * three model names into module-level constants at import time, while the
 * gateway read the same variables live. Two consequences, both reported in
 * production:
 *
 *   1. DRIFT — GROQ_MODEL defaulted to `openai/gpt-oss-20b` here and to
 *      `llama-3.3-70b-versatile` in the gateway. The value that reached the
 *      wire was the gateway's, i.e. a model Groq retired on 2026-08-16, so
 *      every Groq call 404'd while this file "knew" the right model.
 *   2. STALENESS — a constant read at import cannot see an env var that the
 *      host injects later, and it cannot be normalized (quotes, newlines,
 *      `Bearer ` prefixes, zero-width characters all survive a dashboard
 *      paste and turn a present key into a 401).
 *
 * Everything now goes through the gateway's live, normalized, alias-aware
 * readers. One source of truth for keys and for model ids.
 */
const jinaKey = () => normalizeSecretValue(process.env.JINA_API_KEY || process.env.JINA_KEY || '');

/** Check if any external AI provider is configured */
export const aiConfigured = () => anyAiConfigured();

/**
 * Active primary provider identifier.
 *
 * Not "the first key that exists" — that is how a fleet with eight keys and one
 * working provider kept reporting a provider that could not answer. This is the
 * seat that would ACTUALLY be asked first right now: the task-preference order,
 * re-sorted by live health (proven-good first, circuit-open last).
 */
export const aiProvider = () => {
  const configured = getPreferredProvidersForTask('general', { configuredOnly: true }).filter((id) => id !== 'internal');
  if (!configured.length) return null;
  return orderByHealth(configured)[0] || null;
};

/** Environment variable names that LOOK like AI keys but are not read by this
 *  build, so an operator who set them gets told instead of wondering. Grok
 *  (xAI), OpenAI and Perplexity were de-registered from the fleet; their duties
 *  are carried by OpenRouter / Anthropic / DeepSeek / AIMLAPI. */
export const IGNORED_AI_ENV_VARS = Object.freeze([
  'GROK_API_KEY',
  'XAI_API_KEY',
  'OPENAI_API_KEY',
  'PERPLEXITY_API_KEY',
  'VITE_GROQ_API_KEY',
  'VITE_OPENROUTER_API_KEY',
  'VITE_ANTHROPIC_API_KEY'
]);

/** Which of the ignored names are actually set in this environment. */
export function ignoredAiEnvVarsPresent() {
  return IGNORED_AI_ENV_VARS.filter((name) => normalizeSecretValue(process.env[name]).length > 0);
}

/**
 * Diagnostic self-test for configured AI providers.
 *
 * Two honesty rules this function did not used to follow:
 *
 *   1. It reported EVERY provider it knew about, not three. A working Groq
 *      deployment used to see `geminiKeyPresent:false, openrouterKeyPresent:false`
 *      next to `enabled:true`.
 *   2. It reported `ok:true` whenever `routedChat` returned — but routedChat
 *      NEVER throws: when all eight keyed providers fail it quietly answers from
 *      the internal rule engine. So the diagnostic said "the AI works" on a
 *      deployment where not one external model could answer. `ok` is now true
 *      only when a real model answered, and the rule-engine case is named.
 */
export async function aiSelfTest() {
  const providers = getAvailableProviders().filter((p) => p.id !== 'internal');
  const summary = getFleetSummary();

  const out = {
    schema: 'fbt.ai-selftest.v2',
    /* Presence + live verdict per provider. Names and booleans only — never a
       key value, never a prefix of one. */
    providers: providers.map((p) => ({
      id: p.id,
      name: p.name,
      keyPresent: p.configured,
      keyEnvVar: p.keySourceEnv || p.envVar,
      acceptedEnvVars: p.acceptedEnvVars,
      keyDirtyInEnv: p.keyDirtyInEnv,
      model: p.defaultModel,
      modelCandidates: p.modelCandidates,
      verdict: p.verdict,
      health: p.health?.availability || (p.configured ? 'UNKNOWN' : 'NEEDS_KEY'),
      reasonCode: p.health?.lastError?.reasonCode || null,
      lastError: p.health?.lastError?.message || null,
      fix: p.health?.lastError?.fix || null,
      lastSuccessAt: p.health?.lastSuccess?.at || null
    })),
    summary,
    provider: aiProvider(),
    activeProviders: getActiveProviderIds().filter((id) => id !== 'internal'),
    ignoredEnvVarsPresent: ignoredAiEnvVarsPresent()
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
    out.model = res.model;
    out.provider = res.provider;
    out.providerName = res.providerName;
    out.engine = res.engine;
    out.latencyMs = Date.now() - started;
    out.sample = String(res.text).trim().slice(0, 40);
    out.failoverTrail = res.failoverTrail || [];

    /* A rule-engine answer is NOT a passing AI self-test. */
    if (res.degraded || res.provider === 'internal') {
      out.ok = false;
      out.reason = 'ALL_PROVIDERS_FAILED';
      out.degraded = true;
      out.fix =
        'Every keyed provider was called and none answered, so the internal rule engine replied. ' +
        'Read `failoverTrail` for the per-provider reason — the usual four are a retired model id, ' +
        'a paid model on a free tier, an empty credit balance, and a key pasted with stray characters.';
      return out;
    }

    out.ok = true;
    out.degraded = false;
    return out;
  } catch (err) {
    const cls = classifyAiError(err);
    out.ok = false;
    out.latencyMs = Date.now() - started;
    out.error = String(err.message || err).slice(0, 300);
    out.reason = cls.kind;
    out.fix = cls.fix;
    return out;
  }
}

export const newsConfigured = () => Boolean(jinaKey());

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
  const key = jinaKey();
  if (!key) return [];
  try {
    const raw = await req(
      `${JINA_SEARCH_URL}?q=${encodeURIComponent(query)}`,
      {
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${key}`,
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
  if (jinaKey()) {
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
    json: opts.json ?? true,
    preferredProvider: opts.preferredProvider || null
  });
  /*
   * The whole gateway result travels, not just the text. Callers that render
   * this answer need to know WHICH brain produced it: `engine: 'internal-rules'`
   * with `degraded: true` means no external model answered, and showing that
   * text under a «هوش مصنوعی» badge is the exact misreport this fleet had.
   */
  return {
    text: res.text,
    model: res.model,
    provider: res.provider,
    providerName: res.providerName,
    engine: res.engine,
    degraded: Boolean(res.degraded),
    degradedReason: res.degradedReason || null,
    notice: res.notice || null,
    failoverTrail: res.failoverTrail || [],
    durationMs: res.durationMs
  };
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

  const reply = await chat({
    taskType: 'fast',
    system,
    user: q,
    maxTokens: 420,
    temperature: grounded ? 0.2 : 0.4,
    json: false
  });

  return {
    answer: String(reply.text || '').trim(),
    model: reply.model,
    /* Which brain answered. `source: 'internal-rules'` is the honest label when
       every keyed provider failed and the deterministic engine replied — the
       client prints that instead of implying a live model spoke. */
    provider: reply.provider,
    providerName: reply.providerName,
    engine: reply.engine,
    source: reply.degraded ? 'internal-rules' : (grounded ? 'model-grounded' : 'model'),
    degraded: Boolean(reply.degraded),
    degradedReason: reply.degradedReason || null,
    notice: reply.notice || null,
    failoverTrail: reply.failoverTrail || [],
    grounded,
    sources: sources.map((s2) => ({ title: s2.title, url: s2.url }))
  };
}

export async function generateOutlook(payload) {
  if (!aiConfigured()) throw new Error('AI_NOT_CONFIGURED');

  const news = await fetchNews(`${payload.name} ${payload.symbol} crypto news analysis`, 6);

  const reply = await chat({
    taskType: 'market',
    system: SYSTEM_PROMPT,
    user: buildUserPrompt({ ...payload, news }),
    temperature: 0.3,
    maxTokens: 700,
    json: true
  });

  const parsed = parseJson(reply.text);

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
    model: reply.model,
    provider: reply.provider,
    engine: reply.engine,
    degraded: Boolean(reply.degraded),
    degradedReason: reply.degradedReason || null,
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

  const reply = await chat({
    taskType: 'market',
    system: `${SYSTEM_PROMPT}\n\nFor this market-wide brief use exactly this JSON shape:\n{"bias":"bullish|bearish|neutral","confidence":0-100,"headline":"max 90 chars","summary":"2-3 sentences","drivers":["..."],"risks":["..."]}`,
    user,
    temperature: 0.3,
    maxTokens: 500,
    json: true
  });

  const parsed = parseJson(reply.text);
  return {
    bias: ['bullish', 'bearish', 'neutral'].includes(parsed.bias) ? parsed.bias : 'neutral',
    confidence: clamp(parsed.confidence, 0, 90),
    headline: String(parsed.headline ?? '').slice(0, 140),
    summary: String(parsed.summary ?? '').slice(0, 700),
    drivers: Array.isArray(parsed.drivers) ? parsed.drivers.slice(0, 3).map((d) => String(d).slice(0, 160)) : [],
    risks: Array.isArray(parsed.risks) ? parsed.risks.slice(0, 3).map((r) => String(r).slice(0, 160)) : [],
    sources: news.map((n) => ({ title: n.title, url: n.url })),
    model: reply.model,
    provider: reply.provider,
    engine: reply.engine,
    degraded: Boolean(reply.degraded),
    degradedReason: reply.degradedReason || null,
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
    const reply = await chat({
      taskType: 'fast',
      system: 'You classify financial intent for a self-custody wallet. You never produce amounts, assets, chains, permissions or advice — only one label from the given enum. If you cannot decide, return GENERAL.',
      user,
      temperature: 0,
      maxTokens: 60,
      json: true
    });
    const parsed = parseJson(reply.text);
    const intent = String(parsed?.intent || '').trim().toUpperCase();
    if (!allowed.includes(intent)) return { ok: false, reason: 'INTENT_NOT_IN_ENUM', model: reply.model, provider: reply.provider };
    const confidence = clamp(parsed?.confidence, 0, 0.99);
    /*
     * A rule-engine label is still usable, but it must not be recorded as model
     * output: the learning loop scores providers on these decisions, and
     * crediting `internal` with a model's accuracy corrupts exactly the data
     * that decides which provider gets the next seat.
     */
    return {
      ok: true,
      intent,
      confidence: Number(confidence.toFixed(2)),
      model: reply.model,
      provider: reply.provider,
      engine: reply.engine,
      degraded: Boolean(reply.degraded)
    };
  } catch (err) {
    return { ok: false, reason: String(err.message || 'AI_FAILED').slice(0, 120) };
  }
}
