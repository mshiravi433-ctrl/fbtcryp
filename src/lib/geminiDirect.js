/**
 * Direct Gemini client — used when no backend is deployed.
 *
 * ─── WHY THIS EXISTS, AND THE TRADE-OFF ───────────────────────────────────
 * The preferred path is server-side (server/ai.js): the key stays on a host
 * you control and can never be extracted. But that requires deploying the API,
 * and until that happens the AI features are simply dead in the packaged app —
 * which is worse for users than the alternative below.
 *
 * So: if VITE_GEMINI_API_KEY is present at build time, the app talks to Gemini
 * directly. The key ships inside the APK and CAN be extracted by anyone who
 * decompiles it. That is not a secret we can keep.
 *
 * The mitigation Google provides for exactly this case is an **Android
 * application restriction**: in Google Cloud Console you bind the key to your
 * package name (`ir.fbt.swap`) plus your signing certificate's SHA-1. A key
 * restricted that way is refused when called from anything other than your
 * signed app, so extracting it from the APK gains an attacker very little.
 *
 * ⚠️ Set that restriction before shipping, and put a quota cap on the key.
 * Without the restriction, an extracted key can be used freely and billed to
 * you. See docs/AI-SETUP-FA.md.
 *
 * The server path always wins when both are configured.
 * ──────────────────────────────────────────────────────────────────────────
 */

const KEY = (typeof import.meta !== 'undefined' && import.meta.env?.VITE_GEMINI_API_KEY) || '';
const MODEL =
  (typeof import.meta !== 'undefined' && import.meta.env?.VITE_GEMINI_MODEL) || 'gemini-2.0-flash';
const BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

export const directGeminiAvailable = () => Boolean(KEY);

const TIMEOUT = 45000;

async function call({ system, user, temperature = 0.3, maxTokens = 700, json = true }) {
  if (!KEY) throw new Error('NO_KEY');

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT);

  try {
    const res = await fetch(`${BASE}/${MODEL}:generateContent?key=${encodeURIComponent(KEY)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: ctrl.signal,
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

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      // Surface the common misconfigurations distinctly so the UI can explain
      // them rather than showing a generic failure.
      if (res.status === 400 && /API_KEY_INVALID/i.test(body)) throw new Error('KEY_INVALID');
      if (res.status === 403) throw new Error('KEY_RESTRICTED');
      if (res.status === 429) throw new Error('QUOTA');
      throw new Error(`HTTP_${res.status}`);
    }

    const data = await res.json();
    const text = data?.candidates?.[0]?.content?.parts?.map((p) => p.text).join('') ?? '';
    if (!text) throw new Error(data?.promptFeedback?.blockReason ? 'BLOCKED' : 'EMPTY');
    return text;
  } finally {
    clearTimeout(timer);
  }
}

function parseJson(text) {
  let t = String(text).trim();
  if (t.startsWith('```')) t = t.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
  const a = t.indexOf('{');
  const b = t.lastIndexOf('}');
  if (a === -1 || b === -1) throw new Error('NO_JSON');
  return JSON.parse(t.slice(a, b + 1));
}

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, Number(v) || 0));

/* Same guardrails as the server prompt — an LLM asked for a price target will
   invent a confident number, and users act on those with real money. */
const SYSTEM = `You are a disciplined crypto market analyst writing a daily briefing for a trading app.

RULES — not optional:
1. Base every claim on the indicators provided. Do not invent data.
2. Never give a single price target. Give a RANGE and what invalidates it.
3. If indicators conflict, SAY SO. "Unclear" is a valid answer.
4. Never promise profit. Never say guaranteed, sure thing, or can't lose.
5. Always state the main risk to your own view.
6. Concise and concrete. No hype, no emoji.
7. You are summarising market conditions, not giving financial advice.

Respond with STRICT JSON only:
{"bias":"bullish|bearish|neutral","confidence":0-100,"headline":"max 90 chars",
"summary":"2-3 sentences","range":{"low":number,"high":number,"horizonDays":number},
"drivers":["max 3"],"risks":["max 3"],"invalidation":"one sentence"}`;

export async function directOutlook({ symbol, name, price, indicators = {}, change24h, change7d, lang }) {
  const lines = [
    `Asset: ${name} (${symbol})`,
    `Price: $${price}`,
    `24h: ${change24h?.toFixed?.(2) ?? '?'}%  7d: ${change7d?.toFixed?.(2) ?? '?'}%`
  ];
  if (indicators.rsi != null) lines.push(`RSI(14): ${indicators.rsi.toFixed(1)}`);
  if (indicators.macd?.histogram != null) lines.push(`MACD hist: ${indicators.macd.histogram.toFixed(4)}`);
  if (indicators.bollinger?.percentB != null) lines.push(`Bollinger %B: ${indicators.bollinger.percentB.toFixed(2)}`);
  if (indicators.volatility != null) lines.push(`Volatility: ${indicators.volatility.toFixed(0)}%`);
  if (indicators.support != null) lines.push(`Support: $${indicators.support.toFixed(4)}`);
  if (indicators.resistance != null) lines.push(`Resistance: $${indicators.resistance.toFixed(4)}`);
  lines.push('', 'No live news feed available — rely on indicators and lower your confidence accordingly.');
  if (lang === 'fa') lines.push('', 'Write text fields in Persian. Keep JSON keys in English.');
  if (lang === 'ar') lines.push('', 'Write text fields in Arabic. Keep JSON keys in English.');

  const parsed = parseJson(await call({ system: SYSTEM, user: lines.join('\n') }));

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
    sources: [],
    model: MODEL,
    direct: true,
    generatedAt: Date.now()
  };
}

export async function directBrief({ global, top, lang }) {
  const movers = (top ?? [])
    .slice(0, 8)
    .map((c) => `${c.symbol} ${c.change24h >= 0 ? '+' : ''}${c.change24h?.toFixed?.(1)}%`)
    .join(', ');

  const user = [
    `Total market cap: $${((global?.mcap ?? 0) / 1e9).toFixed(1)}B (${global?.mcapChange?.toFixed?.(2) ?? '?'}% 24h)`,
    `BTC dominance: ${global?.btcDominance?.toFixed?.(1) ?? '?'}%`,
    `Movers: ${movers}`,
    lang === 'fa' ? '\nWrite text fields in Persian. Keep JSON keys in English.' : '',
    lang === 'ar' ? '\nWrite text fields in Arabic. Keep JSON keys in English.' : ''
  ].join('\n');

  const parsed = parseJson(
    await call({
      system: `${SYSTEM}\n\nFor this market-wide brief use exactly:\n{"bias":"...","confidence":0-100,"headline":"...","summary":"...","drivers":["..."],"risks":["..."]}`,
      user,
      maxTokens: 500
    })
  );

  return {
    bias: ['bullish', 'bearish', 'neutral'].includes(parsed.bias) ? parsed.bias : 'neutral',
    confidence: clamp(parsed.confidence, 0, 90),
    headline: String(parsed.headline ?? '').slice(0, 140),
    summary: String(parsed.summary ?? '').slice(0, 700),
    drivers: Array.isArray(parsed.drivers) ? parsed.drivers.slice(0, 3) : [],
    risks: Array.isArray(parsed.risks) ? parsed.risks.slice(0, 3) : [],
    sources: [],
    model: MODEL,
    direct: true,
    generatedAt: Date.now()
  };
}

const KB = `FBT Swap facts — answer only from these plus general crypto knowledge:
- Non-custodial DEX on BNB Chain, Ethereum, Polygon, Arbitrum, Base, Optimism, Avalanche.
- 0.5% platform fee taken from the input token of every swap, on-chain, same transaction.
- Network gas is separate and goes to validators, not FBT.
- Swaps route via the KyberSwap aggregator across all DEXes on the chain.
- Wallets: WalletConnect, browser wallets, or an in-app wallet with the seed AES-GCM encrypted on-device.
- Lose your seed phrase and nobody, including FBT, can recover your funds.
- Swap, Farm and P2P use real money. Only the Games use virtual points with no value.
- Company: Fanos Bazaar Pishgam (FBT Iran), Khomeyni Shahr, Isfahan.
- Support: email fbtswap@gmail.com (the only official contact channel).
- Not a bank or broker; gives no financial advice.

RULES:
- If you don't know, say so and point to Telegram support.
- Never invent features, fees or guarantees.
- If the user mentions their seed phrase, warn them never to share it.
- Under 130 words.`;

export async function directFaq({ question, lang }) {
  const sys =
    KB +
    (lang === 'fa' ? '\n- Answer in Persian.' : lang === 'ar' ? '\n- Answer in Arabic.' : '\n- Answer in English.');
  const text = await call({
    system: sys,
    user: String(question).slice(0, 500),
    temperature: 0.2,
    maxTokens: 400,
    json: false
  });
  return { answer: text.trim(), model: MODEL, direct: true, generatedAt: Date.now() };
}
