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
const JINA_SEARCH_URL = 'https://s.jina.ai/';

const OPENROUTER_KEY = process.env.OPENROUTER_API_KEY || '';
const JINA_KEY = process.env.JINA_API_KEY || '';
const MODEL = process.env.AI_MODEL || 'openai/gpt-4o-mini';
const SITE_URL = process.env.WEBAPP_URL || 'https://fbt-swap.app';
const TIMEOUT_MS = Number(process.env.AI_TIMEOUT_MS || 45000);

export const aiConfigured = () => Boolean(OPENROUTER_KEY);
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

export async function generateOutlook(payload) {
  if (!OPENROUTER_KEY) throw new Error('AI_NOT_CONFIGURED');

  const news = await fetchNews(`${payload.name} ${payload.symbol} crypto news analysis`, 6);

  const body = {
    model: MODEL,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: buildUserPrompt({ ...payload, news }) }
    ],
    temperature: 0.3,
    max_tokens: 700,
    response_format: { type: 'json_object' }
  };

  const raw = await req(OPENROUTER_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${OPENROUTER_KEY}`,
      'HTTP-Referer': SITE_URL,
      'X-Title': 'FBT Swap',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });

  const content = raw?.choices?.[0]?.message?.content;
  if (!content) throw new Error('EMPTY_RESPONSE');

  const parsed = parseJson(content);

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
    model: MODEL,
    generatedAt: Date.now()
  };
}

/** Short market-wide briefing for the Signals landing card. */
export async function generateMarketBrief({ global, top, lang }) {
  if (!OPENROUTER_KEY) throw new Error('AI_NOT_CONFIGURED');

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
        {
          role: 'system',
          content: `${SYSTEM_PROMPT}\n\nFor this market-wide brief use exactly this JSON shape:\n{"bias":"bullish|bearish|neutral","confidence":0-100,"headline":"max 90 chars","summary":"2-3 sentences","drivers":["..."],"risks":["..."]}`
        },
        { role: 'user', content: user }
      ],
      temperature: 0.3,
      max_tokens: 500,
      response_format: { type: 'json_object' }
    })
  });

  const parsed = parseJson(raw?.choices?.[0]?.message?.content ?? '');
  return {
    bias: ['bullish', 'bearish', 'neutral'].includes(parsed.bias) ? parsed.bias : 'neutral',
    confidence: clamp(parsed.confidence, 0, 90),
    headline: String(parsed.headline ?? '').slice(0, 140),
    summary: String(parsed.summary ?? '').slice(0, 700),
    drivers: Array.isArray(parsed.drivers) ? parsed.drivers.slice(0, 3).map((d) => String(d).slice(0, 160)) : [],
    risks: Array.isArray(parsed.risks) ? parsed.risks.slice(0, 3).map((r) => String(r).slice(0, 160)) : [],
    sources: news.map((n) => ({ title: n.title, url: n.url })),
    model: MODEL,
    generatedAt: Date.now()
  };
}

/** FAQ answering, grounded in a fixed knowledge base about this app. */
export async function answerFaq({ question, lang }) {
  if (!OPENROUTER_KEY) throw new Error('AI_NOT_CONFIGURED');

  const kb = `FBT Swap facts you must use when answering:
- Non-custodial DEX on BNB Smart Chain. The app never holds user funds and has no deposit address.
- A 0.5% platform fee is taken from the input token of every swap, on-chain, in the same transaction.
- Network gas fees are separate and paid to blockchain validators, not to FBT.
- Swaps route through the KyberSwap aggregator across all BSC DEXes; PancakeSwap V2 is the fallback.
- Wallets: WalletConnect, injected browser wallets, or an in-app wallet whose seed is AES-GCM encrypted on-device.
- If a user loses their seed phrase, nobody — including FBT — can recover their funds.
- Games and the Trade/Invest/Predict screens use virtual NX credits, not real money. Swap and Farm are real.
- Company: FBT iran (Fanous Bazaar Pishgam), Khomeyni Shahr, Isfahan. Support: Telegram @Shiravi4333, email Mshiravi433@gmail.com.
- The app is not a bank, broker or exchange and does not give financial advice.

RULES:
- Answer ONLY from these facts plus general crypto knowledge. If you don't know, say so and point to Telegram support.
- Never invent features, fees, dates or guarantees.
- Never tell anyone to share their seed phrase — warn them instead if they mention it.
- Keep it under 130 words.
${lang === 'fa' ? '- Answer in Persian (فارسی).' : lang === 'ar' ? '- Answer in Arabic.' : '- Answer in English.'}`;

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
        { role: 'system', content: kb },
        { role: 'user', content: String(question).slice(0, 500) }
      ],
      temperature: 0.2,
      max_tokens: 400
    })
  });

  return {
    answer: raw?.choices?.[0]?.message?.content?.trim() ?? '',
    model: MODEL,
    generatedAt: Date.now()
  };
}
