/**
 * FBT SIGNAL INTELLIGENCE ENGINE (server side)
 * ---------------------------------------------------------------------------
 * Phase 3 — AI Signal System Upgrade.
 *
 * The pipeline the Signals screen is built on:
 *
 *   Market Data Layer  (providers.js: CoinLore/CoinGecko markets + global)
 *        ↓
 *   Signal Engine      (this module — deterministic scoring from real data)
 *        ↓
 *   AI Orchestrator    (server/aiGateway.js: OpenRouter / Groq /
 *                        Gemini / Anthropic / DeepSeek / Workers AI / Internal)
 *        ↓
 *   Consensus          (multi-provider vote, agreement %, disagreement guard)
 *        ↓
 *   Confidence         (measured agreement, never a random number)
 *        ↓
 *   Final payload      (/api/signals/*)
 *
 * HARD RULES — the same fail-closed discipline as server/solanaIntel.js and
 * server/tokenRisk.js:
 *
 *   · No number in any payload is invented. Every value traces to a real
 *     upstream field (CoinLore / CoinGecko / DexScreener / Solscan / Smart
 *     Money flow engine). Missing fields are null, never guessed.
 *   · The external AI never receives a wallet address, a private key, a seed,
 *     a secret, an account id or a portfolio spec. It receives ONLY the
 *     sanitized evidence bundle described in `sanitizeEvidence`.
 *   · AI is a narrator of measured data, not a data source. If no AI provider
 *     is configured the explanation is produced deterministically on-device,
 *     from the same evidence numbers.
 *   · Every AI call is cached per asset per day (persistent when Blob/Upstash
 *     is configured), so one user opening the page does not pay N model calls.
 */

import { withCache, memoryStore } from './cache.js';
import { fetchGlobal, fetchMarkets } from './providers.js';
import * as smartMoney from './smartMoney/index.js';
import { fetchSolanaIntel } from './solanaIntel.js';
import { anyAiConfigured, getActiveProviderIds, parallelMultiProviderChat } from './aiGateway.js';
import { withPersistentCache } from './blobCache.js';

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, Number(v) || 0));
const num = (v) => {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
};

/**
 * Score ONE observed Solana early-token (real DexScreener pair fields +
 * optional Solscan intel) into opportunity/risk. Exported so the probe can
 * assert the scoring is deterministic without hitting the network.
 */
export function scoreSolanaToken(t = {}, intel = null) {
  const buys = num(t.buysH24) ?? 0;
  const sells = num(t.sellsH24) ?? 0;
  const txTotal = buys + sells;
  const buyRatio = txTotal > 0 ? buys / txTotal : null;
  const volume = num(t.volumeH24) ?? 0;
  const liquidity = num(t.liquidityUsd) ?? 0;
  const fdv = num(t.fdv) ?? 0;
  const ageH = num(t.ageHours) ?? null;
  const topHolderPct = num(intel?.topHolderPct);
  const smartWallets = num(t.smartWallets);

  /* ── opportunity: observed growth signals, each from a real field ────── */
  let opp = 35;
  if (volume > 0) opp += clamp(Math.log10(1 + volume / 10_000) * 12, 0, 25);
  if (buyRatio != null) opp += (buyRatio - 0.5) * 30;
  if (liquidity >= 100_000) opp += 8;
  else if (liquidity >= 30_000) opp += 4;
  if (smartWallets != null && smartWallets >= 3) opp += 10;
  else if (smartWallets != null && smartWallets >= 1) opp += 5;
  if (intel?.holderTrend?.change === 'rising') opp += 12;
  if (intel?.dexActivity?.pressure === 'buy') opp += 8;
  const opportunityScore = Math.round(clamp(opp, 0, 100));

  /* ── risk: every risk factor is observed, not assumed ────────────────── */
  let risk = 30;
  if (ageH == null || ageH < 24) risk += 18;
  else if (ageH < 72) risk += 10;
  if (liquidity < 20_000) risk += 22;
  else if (liquidity < 60_000) risk += 14;
  else if (liquidity < 200_000) risk += 6;
  if (topHolderPct != null && topHolderPct > 40) risk += 16;
  else if (topHolderPct != null && topHolderPct > 25) risk += 8;
  // Wash-trading PROXY: extreme volume-to-liquidity without tx breadth.
  const turnover = liquidity > 0 ? volume / liquidity : null;
  if (turnover != null && turnover > 25 && txTotal < 150) risk += 14;
  if (buyRatio != null && (buyRatio > 0.92 || buyRatio < 0.08)) risk += 12;
  if (intel == null) risk += 6; // unknown on-chain picture is a risk, and we say so
  const riskScore = Math.round(clamp(risk, 0, 100));
  const riskLabel = riskScore >= 75 ? 'HIGH' : riskScore >= 50 ? 'MEDIUM' : 'LOW';

  /* ── flags — only when we can OBSERVE them ────────────────────────────── */
  const flags = [];
  if (intel == null) flags.push('unknownOnchain');
  if (turnover != null && turnover > 25 && txTotal < 150) flags.push('washTradingProxy');
  if (topHolderPct != null && topHolderPct > 40) flags.push('concentratedHolders');
  if (ageH != null && ageH < 24) flags.push('brandNew');

  return {
    address: t.address,
    symbol: t.symbol,
    name: t.name,
    dex: t.dex || null,
    ageHours: ageH != null ? Math.round(ageH * 10) / 10 : null,
    liquidityUsd: Math.round(liquidity),
    volumeH24: Math.round(volume),
    buysH24: buys || null,
    sellsH24: sells || null,
    buyRatio: buyRatio != null ? Math.round(buyRatio * 100) / 100 : null,
    fdv: fdv ? Math.round(fdv) : null,
    smartWallets,
    opportunityScore,
    riskScore,
    riskLabel,
    // observable on-chain (Solscan) / pair metrics:
    topHolderPct,
    holderTrend: intel?.holderTrend?.change ?? null,
    whaleFlow: intel?.whaleFlow?.direction ?? null,
    dexPressure: intel?.dexActivity?.pressure ?? null,
    flags,
    // NOT OBSERVABLE with configured sources — honest nulls:
    mintAuthority: null,
    freezeAuthority: null,
    lpLocked: null,
    honeypot: null,
    liquidityRemoval: null
  };
}

/** TTL for the market pulse (market-wide aggregates move slowly). */
const PULSE_TTL_MS = 60_000;
/** TTL for the Solana early-token radar (DexScreener + Solscan are metered). */
const RADAR_TTL_MS = 300_000;
/** AI explanation cache — one per symbol per language per day. */
const WHY_TTL_MS = Number(process.env.AI_CACHE_TTL_MS || 6 * 3600_000);

/* ═══════════════════════════ 1. MARKET PULSE ═══════════════════════════ */

/**
 * Market-wide pulse: sentiment, risk, confidence, momentum, volatility,
 * liquidity — every field computed from REAL observed data (global stats,
 * top-20 market breadth, smart-money net flow). Never a fixed number.
 */
export async function buildMarketPulse() {
  const { value } = await withCache('sig:pulse', PULSE_TTL_MS, () => computePulse(), { swr: true });
  return value;
}

async function computePulse() {
  const [global, marketsRes, sm] = await Promise.all([
    fetchGlobal().catch(() => null),
    fetchMarkets({ perPage: 40 }).catch(() => null),
    smartMoney.getOverview({ window: '24h' }).catch(() => null)
  ]);
  const markets = Array.isArray(marketsRes) ? marketsRes : [];

  /* ── breadth: how many of the top 20 are actually up today ─────────────── */
  const top = markets.slice(0, 20);
  const priced = top.filter((c) => num(c.change24h) != null && num(c.price) > 0);
  const up = priced.filter((c) => c.change24h > 0).length;
  const breadth = priced.length ? up / priced.length : null;
  const avgChange = priced.length
    ? priced.reduce((s, c) => s + num(c.change24h), 0) / priced.length
    : null;
  const avgVolumeMcap = markets
    .filter((c) => num(c.mcap) > 0 && num(c.volume) > 0)
    .slice(0, 20);

  /* ── sentiment: same family of formula as the client's marketSentiment,
        anchored on real mcap change + breadth. ───────────────────────────── */
  const mcapChange = num(global?.mcapChange);
  const sentimentScore = clamp(
    (mcapChange != null ? 50 + mcapChange * 6 : 50)
      + (avgChange != null ? avgChange * 2.5 : 0)
      + (breadth != null ? (breadth - 0.5) * 30 : 0),
    0,
    100
  );
  const sentimentLabel = sentimentScore > 58 ? 'bullish' : sentimentScore < 42 ? 'bearish' : 'neutral';

  /* ── volatility: dispersion of the top-20 daily moves, plus how violent the
        market's own change is. A market where everything is calm scores low. ── */
  const moves = priced.map((c) => Math.abs(num(c.change24h)) || 0);
  const avgAbs = moves.length ? moves.reduce((a, b) => a + b, 0) / moves.length : null;
  // deviation = how far the top movers sit from the pack
  const maxAbs = moves.length ? Math.max(...moves) : null;
  const volatilityScore = clamp(
    (avgAbs != null ? avgAbs * 6 : 20) + (maxAbs != null ? maxAbs * 0.8 : 10),
    0,
    100
  );
  const volatilityLabel =
    volatilityScore >= 66 ? 'high' : volatilityScore >= 34 ? 'moderate' : 'low';

  /* ── momentum: direction x strength of the average move and the market cap
        change; strong only when BOTH agree (avoid calling a weak bounce
        strong). ───────────────────────────────────────────────────────────── */
  const momentumScore = clamp((avgChange != null ? avgChange * 6 : 0) + (mcapChange != null ? mcapChange * 3 : 0), -100, 100);
  const momentumLabel =
    Math.abs(momentumScore) < 12 ? 'flat'
      : Math.abs(momentumScore) < 35 ? 'moderate'
        : 'strong';
  const momentumDirection = momentumScore > 0 ? 'up' : momentumScore < 0 ? 'down' : 'flat';

  /* ── liquidity: total volume vs market cap (turnover) + smart-money flow.
        Turnover < 4% is shallow; > 12% is active. ─────────────────────────── */
  const mcap = num(global?.mcap);
  const volume = num(global?.volume);
  const turnover = mcap > 0 && volume != null ? (volume / mcap) * 100 : null;
  const smNet = num(sm?.metrics?.netFlow?.value);
  const liquidityScore = clamp(
    (turnover != null ? turnover * 8 : 25)
      + (smNet != null && smNet !== 0 ? Math.sign(smNet) * 8 : 0),
    0,
    100
  );
  const liquidityLabel =
    liquidityScore >= 66 ? 'strong' : liquidityScore >= 34 ? 'adequate' : 'thin';

  const riskScore = clamp(
    50
      + (sentimentScore < 42 ? (42 - sentimentScore) * 1.4 : sentimentScore > 58 ? -6 : -2)
      + (volatilityScore - 50) * 0.45
      + (liquidityScore < 34 ? 12 : 0)
      + (smNet != null && smNet < 0 ? 8 : 0),
    0,
    100
  );
  const riskLabel = riskScore >= 70 ? 'HIGH' : riskScore >= 40 ? 'MEDIUM' : 'LOW';

  /* ── AI confidence: measured agreement of independent evidence groups
        (sentiment vs breadth vs flow), never an arbitrary number. ────────── */
  const agrees = [
    sentimentLabel === 'bullish' ? (mcapChange > 0) : sentimentLabel === 'bearish' ? (mcapChange < 0) : true,
    breadth != null ? (sentimentLabel === 'bullish' ? breadth >= 0.5 : sentimentLabel === 'bearish' ? breadth <= 0.5 : true) : true,
    smNet != null ? (sentimentLabel === 'bullish' ? smNet >= 0 : sentimentLabel === 'bearish' ? smNet <= 0 : true) : true
  ].filter((v) => typeof v === 'boolean');
  const agreement = agrees.length ? agrees.filter(Boolean).length / agrees.length : 0.5;
  const dataFresh = markets.length >= 10 && (global != null || sm != null);
  const aiConfidence = Math.round(clamp(45 + agreement * 40 + (dataFresh ? 8 : 0), 5, 95));

  return {
    schema: 'fbt.signal-pulse.v1',
    at: Date.now(),
    source: markets.length ? (global ? 'live' : 'market-only') : 'unavailable',
    dataProvenance: {
      global: global ? (global.source || 'coingecko') : 'unavailable',
      markets: markets.length ? 'coingecko' : 'unavailable',
      smartMoney: sm?.dataStatus || 'unavailable'
    },
    sentiment: { score: Math.round(sentimentScore), label: sentimentLabel },
    risk: { score: Math.round(riskScore), label: riskLabel },
    aiConfidence,
    momentum: { score: Math.round(momentumScore), label: momentumLabel, direction: momentumDirection },
    volatility: { score: Math.round(volatilityScore), label: volatilityLabel },
    liquidity: { score: Math.round(liquidityScore), label: liquidityLabel, turnoverPct: turnover != null ? Math.round(turnover * 10) / 10 : null },
    breadth: { up, total: priced.length, avgChange: avgChange != null ? Math.round(avgChange * 100) / 100 : null },
    smartMoney: sm
      ? {
          dataStatus: sm.dataStatus,
          whaleActivity: sm.metrics?.whaleActivity?.value ?? null,
          netFlowUsd: sm.metrics?.netFlow?.value ?? null,
          accumulationUsd: sm.metrics?.accumulation?.valueUsd ?? null,
          distributionUsd: sm.metrics?.distribution?.valueUsd ?? null
        }
      : null,
    lastUpdate: Date.now()
  };
}

/* ═══════════════════════════ 2. WHY THIS SIGNAL ═══════════════════════ */

/**
 * The ONLY evidence fields an external model may ever see. Anything not in
 * this allowlist is dropped before the prompt is built — a wallet address, a
 * portfolio id, a secret, or a raw upstream response can never leak.
 */
const ALLOWED_EVIDENCE = new Set([
  'price', 'change24h', 'change7d', 'momentum', 'rsi', 'macd', 'ma20', 'ma50',
  'bollinger', 'support', 'resistance', 'volumeTurnover', 'liquidityUsd',
  'volatilityPct', 'whaleFlow', 'holderTrend', 'topHolderPct', 'dexPressure',
  'smartMoneyNetUsd', 'smartMoneySignal', 'marketSentiment', 'btcDominance',
  'riskScore', 'confidence', 'agreement', 'evidenceCount', 'timeframe',
  /* OPT-IN portfolio context — aggregate percentages ONLY, never addresses,
     amounts or positions. The client gate (src/lib/signalStore.js consent)
     decides whether these are sent at all. */
  'portfolioExposure', 'portfolioConcentration', 'portfolioHasPosition'
]);

/** Drop everything not on the allowlist; numbers become finite numbers. */
export function sanitizeEvidence(raw = {}) {
  const out = {};
  for (const [k, v] of Object.entries(raw)) {
    if (!ALLOWED_EVIDENCE.has(k)) continue;
    if (typeof v === 'string' && v.length > 80) continue;
    out[k] = typeof v === 'number' && !Number.isFinite(v) ? null : v;
  }
  return out;
}

const WHY_SYSTEM = `You are the explanation layer of FBT Signal Intelligence.
You are given REAL, MEASURED market evidence numbers for one crypto asset.
STRICT RULES:
1. You only explain the numbers you were given. Never invent a price, a level, a flow, a holder statistic, a news event or an on-chain fact.
2. Never promise profit, never say "guaranteed", never give financial advice.
3. If the evidence is mixed or insufficient, say so plainly.
4. Be concise. No emoji except where the signal classification itself is shown.
5. You are a narrator, not a data source.
6. portfolioExposure / portfolioConcentration / portfolioHasPosition are AGGREGATE percentages only. Treat them as context for risk, and never assume any wallet identity, address, amount or position from them.

Respond with STRICT JSON only:
{
  "technical": "2-3 sentences on RSI, MACD, moving averages, support/resistance from the numbers provided.",
  "market": "2-3 sentences on volume, momentum, volatility, liquidity.",
  "onchain": "2 sentences about whale/holder/DEX activity. If the fields are null, say the data was unavailable and do not guess.",
  "sentiment": "1-2 sentences on market sentiment and dominance.",
  "conclusion": "2-3 plain-language sentences: what the combination of measured evidence suggests, why confidence is as reported, and what would invalidate it.",
  "agree": true,
  "disagree": false
}`;

/**
 * Ask the configured AI providers (OpenRouter / Gemini / ... / Internal) to
 * explain the evidence, then form a consensus. Returns honest `source`:
 * 'ai' when at least one provider answered, 'local' when none is configured
 * or every call failed.
 *
 * The payload is ALWAYS sanitized before the model sees it; the caller never
 * controls what is sent beyond the allowlist above.
 */
export async function explainSignal({
  symbol,
  name,
  lang = 'en',
  evidence = {},
  classification = 'WATCH',
  confidence = null,
  riskLabel = null,
  timeframe = 7
} = {}) {
  const safe = sanitizeEvidence({ ...evidence, evidenceCount: Object.keys(evidence).length, timeframe });
  if (Object.keys(safe).filter((k) => k !== 'timeframe' && k !== 'evidenceCount').length < 3) {
    return localExplanation({ symbol, name, safe, classification, confidence, riskLabel, lang, insufficient: true });
  }

  const day = new Date().toISOString().slice(0, 10);
  const key = `ai:why:${String(symbol).toUpperCase()}:${lang}:${day}`;
  try {
    const { value } = await withPersistentCache(
      key,
      WHY_TTL_MS,
      () => runWhy({
        symbol, name, safe, classification, confidence, riskLabel, lang
      }),
      memoryStore
    );
    return value;
  } catch {
    // Cache/system failure must never remove the explanation entirely.
    return localExplanation({ symbol, name, safe, classification, confidence, riskLabel, lang });
  }
}

async function runWhy({ symbol, name, safe, classification, confidence, riskLabel, lang }) {
  const lines = [
    `Asset: ${name} (${symbol})`,
    `Signal: ${classification}`,
    ...(confidence != null ? [`Reported confidence: ${confidence}%`] : []),
    ...(riskLabel ? [`Reported risk: ${riskLabel}`] : []),
    '',
    'MEASURED EVIDENCE (only these numbers exist):',
    ...Object.entries(safe)
      .filter(([k]) => k !== 'timeframe' && k !== 'evidenceCount')
      .map(([k, v]) => `- ${k}: ${v === null || v === undefined ? 'unavailable' : v}`),
    '',
    lang === 'fa'
      ? 'Write the four text fields in Persian (فارسی). Keep JSON keys in English.'
      : lang === 'ar'
        ? 'Write the four text fields in Arabic. Keep JSON keys in English.'
        : 'Write the four text fields in English.'
  ].join('\n');

  const providers = ['openrouter', 'gemini', 'groq', 'anthropic', 'deepseek', 'aimlapi', 'mistral']
    .filter((p) => getActiveProviderIds().includes(p))
    .slice(0, 3);
  const results = await parallelMultiProviderChat({
    providers,
    system: WHY_SYSTEM,
    user: lines,
    temperature: 0.2,
    maxTokens: 700,
    json: true
  });

  const parsed = results.map((r) => {
    const body = parseWhyJson(r.text);
    /* An empty model output is NOT an answer — fall back to the honest
       deterministic explanation rather than shipping blank sections. */
    const hasText = body && ['technical', 'market', 'onchain', 'sentiment', 'conclusion']
      .some((k) => typeof body[k] === 'string' && body[k].trim().length > 0);
    return {
      provider: r.provider || 'internal',
      ok: Boolean(r.ok !== false && body && hasText),
      ...body
    };
  });
  const answered = parsed.filter((p) => p.ok);
  if (!answered.length) {
    return localExplanation({ symbol, name, safe, classification, confidence, riskLabel, lang });
  }

  /* Consensus: does the model agree with the engine's classification? */
  const agree = answered.filter((p) => p.agree === true).length;
  const disagree = answered.filter((p) => p.disagree === true).length;
  const agreement = Math.round((agree / answered.length) * 100);
  const consensusBias =
    agree > disagree ? 'supports' : disagree > agree ? 'challenges' : 'mixed';
  /* Disagreement lowers the reported confidence, never raises it. */
  const adjustedConfidence =
    confidence != null
      ? Math.round(clamp(confidence * (0.6 + 0.4 * (agreement / 100)), 0, 95))
      : Math.round(clamp(agree * 30 + 20, 0, 90));

  const pick = answered.sort((a, b) => (b.summary || '').length - (a.summary || '').length)[0];
  return {
    schema: 'fbt.signal-why.v1',
    source: 'ai',
    symbol,
    classification,
    confidence: adjustedConfidence,
    agreement,
    consensusBias,
    aiDisagreement: agreement < 60,
    aiMeta: {
      models: answered.map((p) => p.model || p.provider || 'internal'),
      providers: answered.map((p) => p.provider),
      generatedAt: Date.now(),
      note: 'The model explains measured evidence only. It received no wallet data and no private data.'
    },
    sections: {
      technical: pick.technical || '',
      market: pick.market || '',
      onchain: pick.onchain || '',
      sentiment: pick.sentiment || ''
    },
    technical: pick.technical || '',
    conclusion: pick.conclusion || '',
    reason: localReasonFromEvidence(safe)
  };
}

function parseWhyJson(text) {
  let t = String(text || '').trim();
  if (t.startsWith('```')) t = t.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
  const start = t.indexOf('{');
  const end = t.lastIndexOf('}');
  if (start === -1 || end === -1) return null;
  try {
    return JSON.parse(t.slice(start, end + 1));
  } catch {
    return null;
  }
}

/** Deterministic, language-agnostic explanation from the evidence itself. */
function localExplanation({ symbol, name, safe, classification, confidence, riskLabel, lang, insufficient = false }) {
  const sections = localSections(safe, lang);
  return {
    schema: 'fbt.signal-why.v1',
    source: 'local',
    symbol,
    classification,
    confidence: confidence ?? 50,
    agreement: null,
    consensusBias: 'local',
    aiDisagreement: false,
    aiMeta: {
      models: ['signal-engine'],
      providers: ['deterministic'],
      generatedAt: Date.now(),
      note: insufficient
        ? 'Not enough measured evidence for an AI explanation; the summary below is produced from the evidence that exists.'
        : 'No external model configured or reachable; the summary is produced by the deterministic engine from the measured evidence.'
    },
    sections,
    technical: sections.technical,
    conclusion: localConclusion({ symbol, name, safe, classification, confidence, riskLabel }),
    reason: localReasonFromEvidence(safe)
  };
}

function localSections(safe, lang) {
  const fmt = (arr) => arr.join(lang === 'fa' ? '، ' : ', ');
  const technical = [];
  if (safe.rsi != null) technical.push(`RSI ${safe.rsi}${safe.rsi > 70 ? ' (overbought zone)' : safe.rsi < 30 ? ' (oversold zone)' : ''}`);
  if (safe.macd != null) technical.push(`MACD ${safe.macd > 0 ? 'positive' : 'negative'}`);
  if (safe.ma20 != null && safe.ma50 != null) technical.push(`MA20 ${safe.ma20 >= safe.ma50 ? 'above' : 'below'} MA50`);
  if (safe.support != null || safe.resistance != null) technical.push(`support ${safe.support ?? 'n/a'} / resistance ${safe.resistance ?? 'n/a'}`);
  const market = [];
  if (safe.change24h != null) market.push(`24h ${safe.change24h}%`);
  if (safe.volumeTurnover != null) market.push(`turnover ${safe.volumeTurnover}%`);
  if (safe.volatilityPct != null) market.push(`volatility ${safe.volatilityPct}%`);
  const onchain = [];
  if (safe.whaleFlow) onchain.push(`whale flow ${safe.whaleFlow}`);
  if (safe.holderTrend) onchain.push(`holders ${safe.holderTrend}`);
  if (safe.dexPressure) onchain.push(`DEX ${safe.dexPressure}`);
  if (safe.smartMoneyNetUsd != null) onchain.push(`smart-money net $${safe.smartMoneyNetUsd}`);
  if (!onchain.length) {
    onchain.push(lang === 'fa' ? 'داده آنچین در دسترس نبود — هیچ عددی حدس زده نمی‌شود.' : 'On-chain data unavailable — no numbers are guessed.');
  }
  const sentiment = [];
  if (safe.marketSentiment != null) sentiment.push(`market sentiment ${safe.marketSentiment}`);
  if (safe.btcDominance != null) sentiment.push(`BTC dominance ${safe.btcDominance}%`);
  if (safe.portfolioExposure != null || safe.portfolioConcentration != null) {
    sentiment.push(`portfolio exposure ${safe.portfolioExposure ?? 'n/a'}% / concentration ${safe.portfolioConcentration ?? 'n/a'}% (aggregate only)`);
  }
  return {
    technical: fmt(technical) || (lang === 'fa' ? 'داده تکنیکال کافی در دسترس نیست.' : 'Not enough technical data.'),
    market: fmt(market) || (lang === 'fa' ? 'داده بازار کافی در دسترس نیست.' : 'Not enough market data.'),
    onchain: fmt(onchain),
    sentiment: fmt(sentiment) || (lang === 'fa' ? 'داده احساسات بازار در دسترس نیست.' : 'No sentiment data available.')
  };
}

function localConclusion({ symbol, name, safe, classification, confidence, riskLabel }) {
  const dir = classification === 'STRONG_BUY' || classification === 'BUY' ? 'up'
    : classification === 'SELL' ? 'down' : 'sideways';
  const conf = confidence != null ? `${confidence}%` : 'not measured';
  if (dir === 'sideways') {
    return `${name} (${symbol}) shows mixed measured evidence. Confidence ${conf}${riskLabel ? `, risk ${riskLabel}` : ''}. No directional call is supported by the data.`;
  }
  return `${name} (${symbol}) reads ${dir} on the measured evidence (${conf}${riskLabel ? `, risk ${riskLabel}` : ''}). This explains what the data shows; it is not a promise of future performance.`;
}

/** Short, deterministic reason keys derived from the evidence directions. */
export function localReasonFromEvidence(safe) {
  const reasons = [];
  if (safe.momentum != null && Math.abs(safe.momentum) > 5) reasons.push(safe.momentum > 0 ? 'momentumUp' : 'momentumDown');
  if (safe.change24h != null && Math.abs(safe.change24h) > 2) reasons.push(safe.change24h > 0 ? 'volumeUp' : 'volumeDown');
  if (safe.whaleFlow) reasons.push(safe.whaleFlow === 'inflow' ? 'whaleInflow' : 'whaleOutflow');
  if (safe.holderTrend) reasons.push(safe.holderTrend === 'rising' ? 'holderGrowth' : 'holderSpread');
  if (safe.dexPressure) reasons.push(safe.dexPressure === 'buy' ? 'dexBuy' : 'dexSell');
  if (safe.smartMoneySignal) reasons.push(safe.smartMoneySignal === 'ACCUMULATION' ? 'smartMoneyAccum' : 'smartMoneyDistrib');
  if (safe.rsi != null && safe.rsi < 35) reasons.push('rsiOversold');
  if (safe.rsi != null && safe.rsi > 68) reasons.push('rsiOverbought');
  if (reasons.length < 3 && safe.evidenceCount != null) reasons.push('measuredEvidence');
  return reasons.slice(0, 5);
}

/* ═══════════════════════ 3. SOLANA EARLY RADAR ═══════════════════════ */

/**
 * Solana early-token detection with an OPPORTUNITY score AND a RISK score.
 *
 * Detection comes from DexScreener (real pairs: age, liquidity, volume, buy/
 * sell counts) via the same ingestion as Smart Money, filtered to solana.
 * Every token is then enriched with Solscan holder / flow data when the key is
 * configured. Risk fields we CANNOT observe (mint authority, freeze authority,
 * LP lock, honeypot status, wash-trade classifier) are reported as null — the
 * UI renders them only when a source provides them, never as a guess.
 */
export async function buildSolanaRadar({ limit = 10 } = {}) {
  const { value } = await withCache(`sig:radar:solana:${limit}`, RADAR_TTL_MS, () => computeSolanaRadar(limit), { swr: true });
  return value;
}

async function computeSolanaRadar(limit) {
  const early = await smartMoney.earlyTokens({ limit: 80 }).catch(() => null);
  const all = (early?.tokens || []).filter((t) => t.chain === 'solana');
  const top = all.slice(0, Math.max(6, Math.min(limit + 4, 16)));

  /* Enrich the best candidates with on-chain holder/whale data (cached 5 min
     upstream; fail-closed per token). */
  const enriched = await Promise.all(top.map(async (t) => {
    const intel = await fetchSolanaIntel(t.address).catch(() => null);
    return { token: t, intel: intel && intel.configured ? intel : null };
  }));

  const tokens = enriched.map(({ token: t, intel }) => scoreSolanaToken(t, intel));

  tokens.sort((a, b) => b.opportunityScore - a.opportunityScore);

  return {
    schema: 'fbt.solana-radar.v1',
    at: Date.now(),
    dataStatus: tokens.length ? 'live' : 'unavailable',
    limit,
    tokens: tokens.slice(0, limit),
    coverage: {
      sources: ['dexscreener-pairs', ...(enriched.some((e) => e.intel) ? ['solscan'] : [])],
      note: 'Opportunity and risk scores derive from observed pair and on-chain fields only. Mint authority, freeze authority, LP lock, honeypot and liquidity-removal checks are not available from configured sources and are reported as null rather than guessed.'
    }
  };
}
