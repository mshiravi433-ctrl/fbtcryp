/**
 * AI analysis backend — OpenRouter (LLM) + Jina (news search).
 *
 * ─── WHY THIS IS SERVER-SIDE ──────────────────────────────────────────────
 * These are BILLABLE keys. An OpenRouter key shipped in the client bundle is
 * readable by anyone who opens devtools, and scrapers harvest them within
 * hours — you would be paying for other people's inference. So the keys live
 * only in server env vars, and the browser calls our own /api/ai/* endpoints.
 *
 * Responses are cached hard (default 6h) because a daily-refreshed outlook
 * doesn't need regenerating per user, and because LLM calls cost money per
 * request. One cache entry per coin per day keeps the bill flat regardless of
 * how many users you get.
 * ──────────────────────────────────────────────────────────────────────────
 */

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
const JINA_SEARCH_URL = 'https://s.jina.ai/';
const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

const OPENROUTER_KEY = process.env.OPENROUTER_API_KEY || '';
const GROQ_KEY = process.env.GROQ_API_KEY || '';
/**
 * Groq serves open-weight models. `gpt-oss-20b` is the current default because
 * it is on the free tier, answers in well under a second, and is more than
 * capable of the two jobs we give it (narrating indicators, answering support
 * questions from a fixed knowledge base).
 *
 * Groq deprecates model IDs on a published schedule, so this is intentionally
 * an env var: when a shutdown date lands you change one variable rather than
 * redeploying code.
 */
const GROQ_MODEL = process.env.GROQ_MODEL || 'openai/gpt-oss-20b';
const GEMINI_KEY = process.env.GEMINI_API_KEY || '';
const JINA_KEY = process.env.JINA_API_KEY || '';
const MODEL = process.env.AI_MODEL || 'openai/gpt-4o-mini';
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.0-flash';
const SITE_URL = process.env.WEBAPP_URL || 'https://fbt-swap.app';
const TIMEOUT_MS = Number(process.env.AI_TIMEOUT_MS || 45000);

/**
 * Provider preference: Groq -> Gemini -> OpenRouter.
 *
 * Groq is first for a specific, practical reason. Gemini's endpoint is
 * geo-blocked in a number of countries, and a server deployed in the wrong
 * region gets a bare `fetch failed` that looks like the app is broken. Groq
 * has no such restriction, has a genuinely usable free tier, and is
 * OpenAI-compatible so the request shape is the same one OpenRouter already
 * uses.
 *
 * Cost matters here because AI spend scales with users while this app's
 * revenue scales with swap volume — the two are not correlated, so a free
 * tier is a real structural advantage rather than a nicety.
 *
 * Each provider falls through to the next on error, so one outage or quota
 * wall does not take the feature down.
 */
export const aiConfigured = () => Boolean(GROQ_KEY || GEMINI_KEY || OPENROUTER_KEY);

/**
 * Live self-test for the configured provider.
 *
 * "AI doesn't work" is nearly always one of five specific things, and from the
 * outside they all look identical — the UI just falls back. This makes the
 * actual cause visible: sends a one-token prompt to whichever provider is
 * configured and reports precisely what came back.
 *
 * Deliberately NOT cached: the whole point is to reflect the state right now.
 * It costs a fraction of a cent per call, and it is only reachable with the
 * diagnostic secret.
 */
export async function aiSelfTest() {
  const out = {
    groqKeyPresent: Boolean(GROQ_KEY),
    geminiKeyPresent: Boolean(GEMINI_KEY),
    openrouterKeyPresent: Boolean(OPENROUTER_KEY),
    jinaKeyPresent: Boolean(JINA_KEY),
    provider: aiProvider(),
    groqModel: GROQ_MODEL,
    geminiModel: GEMINI_MODEL,
    openrouterModel: MODEL
  };

  if (!aiConfigured()) {
    out.ok = false;
    out.reason = 'NO_KEY';
    out.fix =
      'Set GROQ_API_KEY (free tier at console.groq.com, no card needed and not ' +
      'geo-blocked), or GEMINI_API_KEY, or OPENROUTER_API_KEY in your host ' +
      'environment, then redeploy. These must NOT have a VITE_ prefix — that ' +
      'would compile the key into the browser bundle for anyone to read.';
    return out;
  }

  const started = Date.now();
  try {
    const { text, model } = await chat({
      system: 'Reply with the single word: ok',
      user: 'ping',
      temperature: 0,
      maxTokens: 12,
      json: false
    });
    out.ok = true;
    out.model = model;
    out.latencyMs = Date.now() - started;
    out.sample = String(text).trim().slice(0, 40);
    return out;
  } catch (err) {
    const msg = String(err.message || err);
    out.ok = false;
    out.latencyMs = Date.now() - started;
    out.error = msg.slice(0, 300);

    // Translate the provider's error into the thing you actually have to fix.
    if (/API_KEY_INVALID|API key not valid|invalid_api_key|^401/i.test(msg)) {
      out.reason = 'KEY_INVALID';
      out.fix =
        'The key is wrong, was revoked, or has a stray space/quote around it. ' +
        'Generate a fresh one and paste it with no surrounding characters.';
    } else if (/^403|PERMISSION_DENIED|SERVICE_DISABLED/i.test(msg)) {
      out.reason = 'KEY_RESTRICTED';
      out.fix =
        'The key is valid but not allowed to make this call. In Google Cloud ' +
        'Console check that the Generative Language API is enabled, and that ' +
        'any application/IP restriction on the key permits a server-side call ' +
        '(an Android-restricted key will NOT work from a server).';
    } else if (/^429|RESOURCE_EXHAUSTED|quota/i.test(msg)) {
      out.reason = 'QUOTA';
      out.fix = 'Rate limit or free-tier quota exhausted. Wait, or enable billing.';
    } else if (/model_not_found|does not exist|decommissioned|model_decommissioned/i.test(msg)) {
      // Groq retires model IDs on a schedule, so this is a routine failure
      // rather than an exotic one, and it must name the variable to change.
      out.reason = 'MODEL_NOT_FOUND';
      out.fix =
        `The model "${GROQ_KEY ? GROQ_MODEL : GEMINI_MODEL}" is not available. ` +
        (GROQ_KEY
          ? 'Groq retires model IDs periodically — set GROQ_MODEL to a current ' +
            'one, e.g. openai/gpt-oss-20b or openai/gpt-oss-120b.'
          : 'Try GEMINI_MODEL=gemini-2.0-flash or gemini-1.5-flash.');
    } else if (/^404|not found for API version|is not found/i.test(msg)) {
      out.reason = 'MODEL_NOT_FOUND';
      out.fix =
        `The model "${GEMINI_MODEL}" is not available to this key. Try ` +
        'GEMINI_MODEL=gemini-2.0-flash or gemini-1.5-flash.';
    } else if (/abort|timeout/i.test(msg)) {
      out.reason = 'TIMEOUT';
      out.fix =
        'The provider did not answer in time. On Vercel Hobby the function ' +
        'ceiling is 60s (already set in vercel.json); a smaller model helps.';
    } else if (/fetch failed|ENOTFOUND|EAI_AGAIN/i.test(msg)) {
      out.reason = 'NETWORK';
      out.fix = GEMINI_KEY && !GROQ_KEY
        ? 'The server could not reach the provider. Google geo-blocks a number ' +
          'of countries outright, and this is what that looks like. Either move ' +
          'the deployment region, or set GROQ_API_KEY instead — Groq is not ' +
          'geo-restricted and has a free tier.'
        : 'The server could not reach the provider. Check the deployment has ' +
          'outbound internet access.';
    } else {
      out.reason = 'UNKNOWN';
      out.fix = 'See `error` for the provider response.';
    }
    return out;
  }
}
export const newsConfigured = () => Boolean(JINA_KEY);
export const aiProvider = () =>
  GROQ_KEY ? 'groq' : GEMINI_KEY ? 'gemini' : OPENROUTER_KEY ? 'openrouter' : null;

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
/* Jina — recent news for grounding                                           */
/* -------------------------------------------------------------------------- */

/**
 * Fetch recent headlines so the model reasons over current events rather than
 * its training cutoff. Failure here is non-fatal — we degrade to
 * indicators-only analysis rather than blocking the whole response.
 */
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

/**
 * Keyless web search fallback (DuckDuckGo Instant Answer).
 *
 * Jina gives much better results but needs a paid key, so without one the
 * assistant would answer every current-events question from its training
 * cutoff — months stale, stated with full confidence. DDG's public endpoint
 * needs no key and covers exactly the "what is X" questions people ask a help
 * screen.
 *
 * It returns definitions and related topics rather than ranked pages, so it is
 * genuinely weaker than Jina. That is why it runs second, and why a miss is
 * silent: no results simply means the model answers from its own knowledge,
 * which is the previous behaviour and still useful.
 */
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
      // Nested "Topics" groups have no Text of their own; skip them rather
      // than emitting an entry with an empty snippet.
      if (!topic?.Text) continue;
      out.push({
        title: String(topic.Text).split(' - ')[0].slice(0, 120),
        url: topic.FirstURL || '',
        snippet: String(topic.Text).slice(0, 300)
      });
    }
    return out.slice(0, limit);
  } catch {
    // A search failure must never fail the answer.
    return [];
  }
}

/**
 * Search the web, best source first.
 *
 * Jina when a key is configured, DuckDuckGo otherwise. Returns [] rather than
 * throwing: grounding is an enhancement, and losing it should degrade the
 * answer, not break it.
 */
export async function webSearch(query, limit = 4) {
  if (JINA_KEY) {
    const viaJina = await fetchNews(query, limit);
    if (viaJina.length) return viaJina;
  }
  return ddgSearch(query, limit);
}

/* -------------------------------------------------------------------------- */
/* OpenRouter — the analyst                                                   */
/* -------------------------------------------------------------------------- */

/**
 * The system prompt is deliberately strict about uncertainty. An LLM asked for
 * a price prediction will happily produce a confident number with no basis,
 * and users act on those numbers with real money. We require it to reason from
 * the supplied indicators, to give ranges rather than point targets, and to
 * say when the signal is unclear.
 */
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

/**
 * Call Gemini. Its API shape differs from OpenAI's: the system prompt goes in
 * `systemInstruction`, and JSON mode is `responseMimeType`.
 */
async function geminiChat({ system, user, temperature = 0.3, maxTokens = 700, json = true }) {
  const url = `${GEMINI_BASE}/${GEMINI_MODEL}:generateContent?key=${encodeURIComponent(GEMINI_KEY)}`;

  const raw = await req(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: 'user', parts: [{ text: user }] }],
      generationConfig: {
        temperature,
        maxOutputTokens: maxTokens,
        ...(json ? { responseMimeType: 'application/json' } : {})
      }
    })
  });

  const text = raw?.candidates?.[0]?.content?.parts?.map((p) => p.text).join('') ?? '';
  if (!text) {
    // A blocked prompt returns no candidate but does explain why.
    const reason = raw?.promptFeedback?.blockReason;
    throw new Error(reason ? `BLOCKED:${reason}` : 'EMPTY_RESPONSE');
  }
  return text;
}

/** Call OpenRouter (OpenAI-compatible). */
async function openRouterChat({ system, user, temperature = 0.3, maxTokens = 700, json = true }) {
  const raw = await req(OPENROUTER_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${OPENROUTER_KEY}`,
      'HTTP-Referer': SITE_URL,
      'X-Title': 'FBT Swap',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user }
      ],
      temperature,
      max_tokens: maxTokens,
      ...(json ? { response_format: { type: 'json_object' } } : {})
    })
  });
  const text = raw?.choices?.[0]?.message?.content;
  if (!text) throw new Error('EMPTY_RESPONSE');
  return text;
}

/**
 * Groq speaks the OpenAI chat-completions dialect, so this is the same shape
 * as `openRouterChat` with a different host and no referer headers.
 *
 * One incompatibility worth knowing: Groq's OpenAI compatibility is close but
 * not total. `response_format: json_object` IS supported on the models we use,
 * which is the only non-trivial thing we rely on.
 */
async function groqChat({ system, user, temperature = 0.3, maxTokens = 700, json = true }) {
  const raw = await req(GROQ_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${GROQ_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: GROQ_MODEL,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user }
      ],
      temperature,
      max_tokens: maxTokens,
      ...(json ? { response_format: { type: 'json_object' } } : {})
    })
  });
  const text = raw?.choices?.[0]?.message?.content;
  if (!text) throw new Error('EMPTY_RESPONSE');
  return text;
}

/**
 * Provider-agnostic entry point. Tries each configured provider in turn so a
 * quota error or outage on one doesn't take the feature down.
 */
async function chat(opts) {
  if (GROQ_KEY) {
    try {
      return { text: await groqChat(opts), model: GROQ_MODEL };
    } catch (e) {
      // Only fall through if there is somewhere to fall through TO. Otherwise
      // rethrow, so the diagnostic endpoint reports Groq's real error rather
      // than a generic "not configured".
      if (!GEMINI_KEY && !OPENROUTER_KEY) throw e;
      console.warn('[ai] groq failed, trying next provider:', e.message);
    }
  }
  if (GEMINI_KEY) {
    try {
      return { text: await geminiChat(opts), model: GEMINI_MODEL };
    } catch (e) {
      if (!OPENROUTER_KEY) throw e;
      console.warn('[ai] gemini failed, falling back to openrouter:', e.message);
    }
  }
  if (!OPENROUTER_KEY) throw new Error('AI_NOT_CONFIGURED');
  return { text: await openRouterChat(opts), model: MODEL };
}

/** Strip markdown fences some models add despite instructions. */
function parseJson(text) {
  let t = String(text).trim();
  if (t.startsWith('```')) t = t.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
  const start = t.indexOf('{');
  const end = t.lastIndexOf('}');
  if (start === -1 || end === -1) throw new Error('NO_JSON');
  return JSON.parse(t.slice(start, end + 1));
}

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, Number(v) || 0));

/**
 * ANSWER A SUPPORT QUESTION ABOUT THIS APP.
 *
 * ─── THE RULE THAT MAKES THIS SAFE ──────────────────────────────────────────
 * A general model asked "what is the fee on FBT Swap?" will confidently invent
 * a number. On a finance app that is not a wrong answer, it is a lie the user
 * may act on. So the model is NEVER the source of facts here.
 *
 * The client sends `context` — the matching hand-written FAQ entries — and the
 * system prompt forbids going beyond them. The model's only job is to rephrase
 * the supplied facts as a direct answer to the exact question asked, in the
 * user's language. Anything not covered gets "I do not know, contact support",
 * which is a correct answer.
 *
 * This is why the client tries its local FAQ matcher FIRST and only calls here
 * when confidence is low: for the common questions a hand-written answer is
 * strictly better, and free.
 * ────────────────────────────────────────────────────────────────────────────
 */
export async function answerSupportQuestion({ question, context = [], lang = 'fa', web = true }) {
  if (!aiConfigured()) throw new Error('AI_NOT_CONFIGURED');

  const q = String(question || '').slice(0, 500);
  if (!q.trim()) throw new Error('EMPTY_QUESTION');

  /*
   * TWO MODES, chosen by whether our own docs matched.
   *
   * The previous prompt said "answer ONLY from the reference", which made the
   * assistant useless for the thing people actually want to ask — "what is a
   * blockchain", "is Bitcoin going up", "what does staking mean". Refusing
   * those is not safety, it is just an unhelpful product.
   *
   * But the reverse is worse: a model asked "what fee does FBT charge?" will
   * invent a number, and an invented fee on a finance app is a lie the user
   * may act on.
   *
   * So the mode depends on the question:
   *
   *   GROUNDED  — our FAQ matched, so the question is about THIS app. The
   *               reference is the only permitted source. No invention.
   *
   *   GENERAL   — no FAQ match, so it is a general crypto question. The model
   *               may use its own knowledge, but it is explicitly told it does
   *               NOT know anything about FBT Swap specifically and must not
   *               guess about our fees, addresses or features.
   *
   * Both modes keep the safety floor: never request a seed phrase, never imply
   * a transaction can be reversed, never give financial advice.
   */
  const grounded = context.length > 0;

  const facts = context
    .slice(0, 4)
    .map((c, i) => `[${i + 1}] ${String(c).slice(0, 900)}`)
    .join('\n\n');

  // Live web results, when a search key is configured. Without this the model
  // answers "what is the price of bitcoin" from its training cutoff, which is
  // months stale and stated with full confidence.
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
    system,
    user: q,
    maxTokens: 420,
    temperature: grounded ? 0.2 : 0.4,
    // The shared chat() defaults to json:true because other callers parse
    // structured output. This one wants prose; leaving the default renders a
    // raw JSON object into the chat bubble.
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
    system: SYSTEM_PROMPT,
    user: buildUserPrompt({ ...payload, news }),
    temperature: 0.3,
    maxTokens: 700
  });

  const parsed = parseJson(text);

  // Normalise and clamp — never trust model output shape blindly.
  return {
    bias: ['bullish', 'bearish', 'neutral'].includes(parsed.bias) ? parsed.bias : 'neutral',
    confidence: clamp(parsed.confidence, 0, 90), // cap at 90: nothing here justifies more
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

/** Short market-wide briefing for the Signals landing card. */
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
    system: `${SYSTEM_PROMPT}\n\nFor this market-wide brief use exactly this JSON shape:\n{"bias":"bullish|bearish|neutral","confidence":0-100,"headline":"max 90 chars","summary":"2-3 sentences","drivers":["..."],"risks":["..."]}`,
    user,
    temperature: 0.3,
    maxTokens: 500
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

/** FAQ answering, grounded in a fixed knowledge base about this app. */
