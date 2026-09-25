/**
 * FBT SMART INTENT OS — AI UPGRADE 5: COLLABORATIVE INTELLIGENCE ENGINE
 * ---------------------------------------------------------------------------
 * One FBT intelligence layer coordinating the best available AI models, live
 * data, web research and internal tools (§0, §68). The user talks to FBT once;
 * multiple specialized systems work behind the scenes:
 *
 *   Question Analyzer (collaborationRouter)
 *     → AI Router (roles → configured providers, via the existing AI Gateway)
 *       → Independent parallel analyses            Stage 1-2 (§9)
 *         → Compare: agreement / disagreement      Stage 3 (§9)
 *           → Verification of factual claims       Stage 4 (§9, §11)
 *             → Consensus + uncertainty            Stage 5 (§38-39)
 *               → Final FBT answer                 Stage 6 (§37)
 *
 * Laws this engine enforces:
 *   - Never asks every model for everything — the level is decided by the
 *     question analyzer (§4, §45). «سلام» costs one fast model, nothing more.
 *   - AI consensus is NOT proof of truth. Factual claims are only "verified"
 *     when tool data or web evidence supports them; otherwise they are marked
 *     aiConsensusOnly (§11).
 *   - The user never sees "Claude says… / Gemini says…" unless transparency mode
 *     is explicitly requested (§37).
 *   - No secrets, no raw wallet data — aggregated portfolio summaries at most
 *     (§44). Execution authority is untouched: this engine cannot sign, send
 *     or approve anything (§67).
 *   - Graceful degradation: if providers fail or none are configured, the
 *     answer is built from tool data + internal knowledge with an explicit
 *     uncertainty flag — never from invention (§47, §59).
 */

import {
  routedChat,
  parallelMultiProviderChat,
  executeProviderChat,
  isProviderConfigured,
  getActiveProviderIds,
  getPreferredProvidersForTask,
  sanitizePrompt,
  recordProviderCall as recordGatewayProviderCall,
  isProviderHealthy as gatewayProviderHealthy,
  getProviderHealth as gatewayProviderHealth,
  resetProviderHealth as resetGatewayProviderHealth
} from './aiGateway.js';
import { runMultiAiDebate } from './aiConsensus.js';
import { researchWeb, analyzeWithSources } from './aiWebResearch.js';
import { searchKnowledge } from '../src/lib/intent-ai/os/knowledgeCenter.js';
import { retrieve as retrieveBm25 } from '../src/lib/intent-ai/retrieval.js';
import {
  planCollaboration,
  CONVERSATION_KINDS,
  AI_ROLES
} from '../src/lib/intent-ai/os/collaborationRouter.js';
import { renderSocialReply } from '../src/lib/intent-ai/os/conversation/socialVoice.js';
import { SOCIAL_ACTS } from '../src/lib/intent-ai/os/conversation/socialIntent.js';

export const COLLABORATION_SCHEMA = 'fbt.ai-collaboration.v1';
export const COLLABORATION_VERSION = '5.0.0';

const DEADLINE_MS = Number(process.env.AI_COLLAB_DEADLINE_MS || 20000);
const MAX_MODELS = Number(process.env.AI_COLLAB_MAX_MODELS || 4);

/* Round-robin seat of the fleet. Every collaboration run advances it by one,
   so successive questions take turns LEADING with a different provider. This
   is what makes the whole registered fleet "active and working" rather than
   only the top of the task list: over a normal session every provider holds
   the primary seat in turn (the task preference still orders the list, and
   per-role diversity within one question is handled by the seat rotation).
   Level-1 social turns keep offset 0 so a "hello" always uses the fastest
   model, never a rotated-to-one. */
let fleetBaseCursor = 0;
export function nextFleetBaseOffset(n = 1) {
  const off = fleetBaseCursor % Math.max(1, n);
  fleetBaseCursor += 1;
  return off;
}
export function resetFleetCursor() { fleetBaseCursor = 0; }

/* -------------------------------------------------------------------------- */
/*  PROVIDER HEALTH & CIRCUIT BREAKER (§46, §48)                               */
/* -------------------------------------------------------------------------- */

/*
 * ONE STORE, NOT TWO. This module used to keep its own `healthState` Map beside
 * the gateway's, which meant the fleet had two opinions about the same
 * provider: the collaboration engine could park groq while `routedChat` — the
 * path /api/ai/ask, /brief and /outlook actually take — kept paying for its
 * failures on every request, and `/api/v1/ai/gateway/health` reported a circuit
 * the collaboration layer had never heard of (and the reverse). The gateway now
 * owns health because every caller goes through it; these are re-exports so the
 * existing call sites and probes keep working against the same truth.
 *
 * The gateway's record is also the richer one: it carries the classified
 * `reasonCode`, the operator `fix`, and the model that actually answered — so
 * `aiQuestionIntel`'s `providerHealth` and the escalation ladder now publish the
 * same numbers the health endpoint does.
 */
export const recordProviderCall = recordGatewayProviderCall;
export const isProviderHealthy = gatewayProviderHealthy;
export const getProviderHealth = gatewayProviderHealth;

export function resetProviderHealth() {
  resetGatewayProviderHealth();
}

/**
 * Health-aware provider selection.
 *
 * `offset` rotates the primary seat: role i leads with the i-th provider of the
 * ordered list (wrapping), so the independent analyses a question runs are
 * DIFFERENT models instead of every role re-picking the same top provider.
 *
 * `fullFleet` widens the pool to the whole configured fleet — the task's
 * preferred order first, then every other configured provider the task list
 * left out. Without it, providers that only sit in a different task's list
 * (Mistral, Anthropic, …) could never hold a seat, so the "multi-AI" engine
 * silently collapsed to a single model. With it, a rotation across roles
 * reaches every registered provider while the FIRST seat still honours the
 * task's own preference.
 *
 * Providers whose circuit is open are skipped unless everything is open.
 */
function healthyProvidersForTask(taskType, { max = MAX_MODELS, exclude = [], offset = 0, fullFleet = false } = {}) {
  const taskList = getPreferredProvidersForTask(taskType, { configuredOnly: true })
    .filter((p) => p !== 'internal' && !exclude.includes(p));
  const allConfigured = getActiveProviderIds()
    .filter((p) => p !== 'internal' && !exclude.includes(p));
  const ordered = fullFleet
    ? [...taskList, ...allConfigured.filter((p) => !taskList.includes(p))]
    : taskList;
  const rotated = offset > 0 && ordered.length
    ? ordered.slice(offset % ordered.length).concat(ordered.slice(0, offset % ordered.length))
    : ordered;
  const healthy = rotated.filter(isProviderHealthy);
  const picked = (healthy.length ? healthy : rotated).slice(0, max);
  return picked;
}

/* -------------------------------------------------------------------------- */
/*  ROLE PROMPTS (§5) — FBT's own voice; no imitation of any AI brand (§50)    */
/* -------------------------------------------------------------------------- */

/* BCP-47 → the name a model understands for "write in this". */
const LANGUAGE_NAMES = Object.freeze({
  en: 'English', fa: 'Persian (فارسی)', ar: 'Arabic (العربية)', tr: 'Turkish (Türkçe)',
  ru: 'Russian (русский)', zh: 'Simplified Chinese (简体中文)', hi: 'Hindi (हिन्दी)',
  ur: 'Urdu (اردو)', id: 'Indonesian (Bahasa Indonesia)', es: 'Spanish (Español)',
  pt: 'Portuguese (Português)', fr: 'French (Français)'
});

/**
 * What language a model must write its text fields in. Falls back to English
 * only for a language the product does not localise to, and says so in the
 * prompt rather than quietly switching.
 */
export function languageInstruction(locale = 'en') {
  const code = String(locale || 'en').toLowerCase().split('-')[0];
  if (LANGUAGE_NAMES[code]) return `${LANGUAGE_NAMES[code]} — the user wrote in ${code}`;
  return `English (the user's language "${code}" is not localised by FBT yet; say nothing about that in the answer)`;
}

const FBT_RULES = [
  'You are one specialist inside FBT\'s own intelligence layer — not a chatbot brand.',
  'Ground every factual claim in the DATA provided. Never invent prices, balances, news, TVL, APYs or dates.',
  'If data is missing, say the point cannot be verified instead of guessing.',
  'This is analysis, never financial advice and never a promise.',
  'Never ask for or mention private keys, seed phrases or passwords.'
].join('\n');

const ROLE_PROMPTS = {
  [AI_ROLES.CONVERSATION_AI]: `You are FBT's Conversation AI.\nHandle greetings, thanks and casual talk naturally, briefly and warmly — one or two sentences, in the user's language. Never pitch products, never dump disclaimers on a "hello".\n${FBT_RULES}`,
  [AI_ROLES.CRYPTO_RESEARCH_AI]: `You are FBT's Crypto Research AI.\nExplain tokens, protocols and blockchain projects clearly: what it does, network, tokenomics, liquidity, risks. Prefer the provided knowledge and data over memory; flag anything time-sensitive as needing fresh data.\n${FBT_RULES}`,
  [AI_ROLES.NEWS_AI]: `You are FBT's News AI.\nInterpret news and events: what happened, who is affected, direct vs indirect market effects, historical parallels. Only use the provided sources; mark unverified reports as leads.\n${FBT_RULES}`,
  [AI_ROLES.MARKET_AI]: `You are FBT's Market AI.\nAssess market conditions from the provided live data: trend, momentum, volatility, drivers. Never give a single price target; give ranges and what would invalidate them.\n${FBT_RULES}`,
  [AI_ROLES.RISK_AI]: `You are FBT's Risk AI.\nFocus on downside: what could go wrong, liquidation and liquidity traps, position sizing, uncertainty. State the strongest case AGAINST the prevailing optimism.\n${FBT_RULES}`,
  [AI_ROLES.PORTFOLIO_AI]: `You are FBT's Portfolio AI.\nAnalyze the provided portfolio summary: allocation, concentration, exposure. Use only the aggregated data given; never request or reference private keys.\n${FBT_RULES}`,
  [AI_ROLES.STRATEGY_AI]: `You are FBT's Strategy AI.\nBuild conditional scenarios (bull/base/bear) and structured approaches (DCA, staging, hedging) — always framed as options with trade-offs, never instructions.\n${FBT_RULES}`,
  [AI_ROLES.VERIFICATION_AI]: `You are FBT's Verification AI.\nYour job is to CHALLENGE the answer: find unsupported claims, contradictions, stale data and overconfidence. For each factual claim, decide whether the provided tool/web evidence supports it.\n${FBT_RULES}`,
  [AI_ROLES.FINAL_ANSWER_AI]: `You are FBT's Final Answer AI.\nSynthesize the specialists' work into ONE coherent FBT answer in the user's language. Never mention model names or providers. State uncertainty honestly. If specialists disagreed, present both views and which evidence supports which.\n${FBT_RULES}`
};

const ANALYSIS_JSON_SHAPE = `
Respond in STRICT JSON:
{
  "answer": "your analysis, 2-5 sentences",
  "claims": [{"claim": "one factual statement", "type": "factual"|"opinion", "confidence": 0-100}],
  "uncertainty": "what you are NOT sure about"
}`;

/* -------------------------------------------------------------------------- */
/*  SECURE CONTEXT — the ONLY thing external models may see (§43-44)           */
/* -------------------------------------------------------------------------- */

export function buildSafeContextBlock({ context = {}, knowledge = [], sources = [] } = {}) {
  const lines = [];
  /*
   * Phase 213 — directives come FIRST and are read as constraints, not data.
   * The only producer today is the open-question ledger (`hints.answerBinding`):
   * "this turn is the answer to the question you asked; acknowledge it and
   * continue — do not re-ask, do not claim something was recorded that was
   * not". Putting them above the data is deliberate: a model that reads the
   * market block first tends to answer as if this were a fresh question, which
   * is exactly the forgetting this exists to stop.
   */
  const directives = Array.isArray(context.directives) ? context.directives.filter((d) => typeof d === 'string' && d.trim()) : [];
  if (directives.length) {
    lines.push('MANDATORY TURN DIRECTIVES (highest priority — apply before answering):');
    for (const d of directives.slice(0, 3)) lines.push(String(d).slice(0, 1600));
  }
  const market = context.market;
  if (market?.priceMap && Object.keys(market.priceMap).length) {
    lines.push(`LIVE MARKET DATA (source of truth — overrides model memory): ${JSON.stringify(market.priceMap)}`);
    if (market.change24hPct != null) lines.push(`BTC 24h change: ${market.change24hPct}%`);
    if (market.dataStatus && market.dataStatus !== 'live') lines.push(`Market data status: ${market.dataStatus}`);
  }
  const portfolio = context.portfolio;
  if (portfolio?.totalValueUsd != null) {
    /* Aggregated summary only — never raw holdings detail beyond symbol/weight,
       never addresses, never keys (§44). */
    const weights = Array.isArray(portfolio.holdings)
      ? portfolio.holdings.slice(0, 8).map((h) => `${h.symbol}${h.valueUsd != null && portfolio.totalValueUsd ? `:${Math.round((h.valueUsd / portfolio.totalValueUsd) * 100)}%` : ''}`)
      : [];
    lines.push(`PORTFOLIO SUMMARY (user-authorized aggregate): total=$${Math.round(portfolio.totalValueUsd)}${weights.length ? `, weights=${weights.join(',')}` : ''}`);
  }
  if (knowledge.length) {
    lines.push('FBT INTERNAL KNOWLEDGE (verified product facts):');
    for (const k of knowledge.slice(0, 4)) lines.push(`- [${k.id} v${k.version} ${k.status}] ${k.title}: ${String(k.body).slice(0, 300)}`);
  }
  if (sources.length) {
    lines.push('WEB SOURCES (cite by number; social=tier4 is a lead only):');
    sources.slice(0, 6).forEach((s, i) => lines.push(`(${i + 1}) [tier ${s.tier}] ${s.title} — ${String(s.snippet).slice(0, 200)}`));
  }
  return sanitizePrompt(lines.join('\n'));
}

/* -------------------------------------------------------------------------- */
/*  STAGE 1-2 — INDEPENDENT PARALLEL ANALYSIS (§9)                             */
/* -------------------------------------------------------------------------- */

function parseJsonSafe(text) {
  let t = String(text || '').trim();
  if (t.startsWith('```')) t = t.replace(/^```(?:json)?\s*/i, '').replace(/```$/, '').trim();
  const start = t.indexOf('{');
  const end = t.lastIndexOf('}');
  if (start === -1 || end === -1) return null;
  try { return JSON.parse(t.slice(start, end + 1)); } catch { return null; }
}

const ROLE_TASK = {
  [AI_ROLES.CONVERSATION_AI]: 'fast',
  [AI_ROLES.CRYPTO_RESEARCH_AI]: 'research',
  [AI_ROLES.NEWS_AI]: 'research',
  [AI_ROLES.MARKET_AI]: 'market',
  [AI_ROLES.RISK_AI]: 'risk',
  [AI_ROLES.PORTFOLIO_AI]: 'reasoning',
  [AI_ROLES.STRATEGY_AI]: 'reasoning',
  [AI_ROLES.VERIFICATION_AI]: 'verification',
  [AI_ROLES.FINAL_ANSWER_AI]: 'reasoning'
};

async function runRole({ role, message, contextBlock, locale, deps, maxTokens = 600, fleet = null, seat = 0 }) {
  const system = `${ROLE_PROMPTS[role] || ROLE_PROMPTS[AI_ROLES.FINAL_ANSWER_AI]}\n${ANALYSIS_JSON_SHAPE}`;
  /*
   * ─── THE USER'S LANGUAGE, NOT THE APP'S TWO ─────────────────────────────
   * This line used to be a ternary: Persian or English. Everything a Turkish,
   * Arabic, Russian or Chinese user asked was therefore answered in English by
   * the fleet — the one layer that was supposed to make the assistant
   * multilingual was itself bilingual. `locale` here is already the detected
   * language of the message when the chat route has one, so a single
   * instruction covers typed and declared language alike.
   */
  const answerLang = languageInstruction(locale);
  const user = [
    `USER QUESTION: ${sanitizePrompt(message)}`,
    contextBlock,
    `Write the "answer"/"claims"/"uncertainty" TEXT FIELDS IN ${answerLang}. JSON keys stay English.`
  ].filter(Boolean).join('\n\n');

  /* deps.selectProviders lets tests inject a fake fleet; production uses the
     health-aware gateway routing.
     When the caller passes the question's ordered `fleet`, role `seat` takes
     that seat (wrapping) as its PRIMARY and the following seats as failover —
     so the independent analyses a question runs are DIFFERENT providers, not
     one model re-picked by every role. Without a fleet (single-role turns,
     older callers) it falls back to the role's own task order, full fleet. */
  const candidates = deps.selectProviders
    ? deps.selectProviders(ROLE_TASK[role] || 'general').slice(0, 2)
    : (Array.isArray(fleet) && fleet.length
        ? (() => {
            const n = fleet.length;
            const start = ((Number(seat) % n) + n) % n;
            return fleet.slice(start).concat(fleet.slice(0, start)).slice(0, 3);
          })()
        : healthyProvidersForTask(ROLE_TASK[role] || 'general', { max: 3, fullFleet: true }));
  const startedAt = Date.now();
  for (const providerId of candidates) {
    try {
      const res = await deps.execute(providerId, {
        system,
        user,
        temperature: 0.3,
        maxTokens,
        json: true
      });
      const parsed = parseJsonSafe(res.text) || { answer: String(res.text || '').slice(0, 900), claims: [], uncertainty: '' };
      /*
       * Only record what the gateway did not. A call through `executeProviderChat`
       * is recorded THERE, with the model that answered; recording it again here
       * would inflate `calls` and average the latency of one request twice. An
       * injected executor (the probes' fake fleet) is the case with no `engine`
       * field, and that one is ours to record.
       */
      if (!res?.engine) recordProviderCall(providerId, { ok: true, durationMs: res.durationMs || Date.now() - startedAt, qualityScore: null });
      return {
        role,
        provider: providerId,
        model: res.model || null,
        answer: String(parsed.answer || '').slice(0, 1200),
        claims: Array.isArray(parsed.claims) ? parsed.claims.slice(0, 6).map((c) => ({
          claim: String(c?.claim || '').slice(0, 240),
          type: c?.type === 'factual' ? 'factual' : 'opinion',
          confidence: Math.min(100, Math.max(0, Number(c?.confidence) || 60))
        })) : [],
        uncertainty: String(parsed.uncertainty || '').slice(0, 300),
        latencyMs: res.durationMs || Date.now() - startedAt,
        ok: true
      };
    } catch (err) {
      /*
       * A gateway failure arrives already classified and already recorded
       * (`err.reasonCode`, `err.fix`): BILLING, MODEL_UNAVAILABLE, AUTH, …
       * Recording it a second time here would double the consecutive-failure
       * count AND overwrite the honest reason with UNKNOWN — destroying the very
       * detail `/api/v1/ai/gateway/health` exists to publish. So only an
       * unclassified failure (an injected executor, a bug in this module) is
       * recorded here.
       */
      if (!err?.reasonCode) {
        recordProviderCall(providerId, { ok: false, durationMs: Date.now() - startedAt, error: String(err?.message || err).slice(0, 200) });
      }
      // fall through to next candidate (§47)
    }
  }
  return { role, provider: null, model: null, answer: '', claims: [], uncertainty: '', ok: false, error: 'NO_PROVIDER_AVAILABLE' };
}

/* -------------------------------------------------------------------------- */
/*  STAGE 3-4 — COMPARE + VERIFY (§9, §11)                                     */
/* -------------------------------------------------------------------------- */

export function compareAnalyses(analyses = []) {
  const valid = analyses.filter((a) => a.ok && a.answer);
  if (!valid.length) return { agreement: null, disagreements: [], factualClaims: [], opinionClaims: [] };

  const factualClaims = [];
  const opinionClaims = [];
  for (const a of valid) {
    for (const c of a.claims) {
      (c.type === 'factual' ? factualClaims : opinionClaims).push({ ...c, role: a.role, provider: a.provider });
    }
  }

  /* Simple stance comparison on shared keywords: two analyses contradict when
     one asserts a positive stance and another a negative one on the same
     subject. Kept deliberately conservative — disagreement is flagged, never
     silently averaged away (§38). */
  const stanceOf = (text) => {
    const t = String(text || '').toLowerCase();
    const pos = /(صعود|رشد|مثبت|bullish|positive|upside|بالاتر)/.test(t);
    const neg = /(ریزش|نزول|منفی|bearish|negative|downside|پایین تر|کاهش)/.test(t);
    if (pos && !neg) return 'positive';
    if (neg && !pos) return 'negative';
    return 'neutral';
  };
  const stances = valid.map((a) => ({ role: a.role, stance: stanceOf(a.answer) }));
  const hasPos = stances.some((s) => s.stance === 'positive');
  const hasNeg = stances.some((s) => s.stance === 'negative');
  const disagreement = valid.length > 1 && hasPos && hasNeg;

  const agreeing = stances.filter((s) => s.stance === stanceOf(valid[0].answer)).length;
  return {
    agreement: `${agreeing}/${valid.length}`,
    disagreement,
    stances,
    factualClaims: factualClaims.slice(0, 12),
    opinionClaims: opinionClaims.slice(0, 8)
  };
}

/**
 * Verification stage. A factual claim is VERIFIED only when tool data or web
 * evidence supports it — three models agreeing is NOT verification (§11).
 */
export function verifyClaims({ factualClaims = [], context = {}, sources = [] }) {
  const marketJson = context.market?.priceMap ? JSON.stringify(context.market.priceMap) : '';
  const verified = [];
  const aiConsensusOnly = [];

  for (const c of factualClaims) {
    const claim = String(c.claim || '');
    /* Tool-data support: claim mentions a symbol + direction/number that the
       live price map can confirm or deny. */
    let toolSupported = false;
    if (marketJson) {
      for (const [symbol, price] of Object.entries(context.market.priceMap || {})) {
        if (claim.toUpperCase().includes(symbol) && price != null && claim.includes(String(price).slice(0, 6))) {
          toolSupported = true;
          break;
        }
      }
    }
    /* Web support: a tier<=3 source snippet overlaps the claim's keywords. */
    const words = claim.toLowerCase().split(/\s+/).filter((w) => w.length > 4);
    let webSupported = false;
    for (const s of sources) {
      if (s.tier > 3) continue; // social leads never "verify" (§21)
      const hay = `${s.title} ${s.snippet}`.toLowerCase();
      const hits = words.filter((w) => hay.includes(w)).length;
      if (words.length && hits / words.length >= 0.5) { webSupported = true; break; }
    }

    if (toolSupported || webSupported) {
      verified.push({ ...c, basis: toolSupported ? 'tool-data' : 'web-evidence' });
    } else {
      aiConsensusOnly.push({ ...c, note: 'models agree but no trusted source confirms this — stated as analysis, not fact' });
    }
  }
  return { verified, aiConsensusOnly };
}

/* -------------------------------------------------------------------------- */
/*  STAGE 5 — CONSENSUS + UNCERTAINTY (§38-39)                                 */
/* -------------------------------------------------------------------------- */

export function computeUncertainty({ analyses = [], comparison = {}, evidence = {}, freshness = 'RECENT' }) {
  const valid = analyses.filter((a) => a.ok);
  const modelCount = valid.length || 1;
  const avgClaimConfidence = valid.flatMap((a) => a.claims.map((c) => c.confidence));
  const certainty = avgClaimConfidence.length
    ? Math.round(avgClaimConfidence.reduce((a, b) => a + b, 0) / avgClaimConfidence.length)
    : 50;

  const evidenceQuality = evidence.toolDataUsed ? 'high'
    : evidence.webUsed ? (evidence.corroborated ? 'high' : 'medium')
    : evidence.knowledgeUsed ? 'medium'
    : 'low';

  const modelAgreement = comparison.agreement || '1/1';
  const freshnessFactor = { BREAKING: 0.9, LIVE: 1, RECENT: 0.85, STATIC: 1 }[freshness] ?? 0.85;

  let level = 'LOW';
  const score = certainty * freshnessFactor;
  if (comparison.disagreement || evidenceQuality === 'low' || score < 45) level = 'HIGH';
  else if (evidenceQuality === 'medium' || score < 65) level = 'MEDIUM';

  return {
    level,
    certainty,
    evidenceQuality,
    freshness,
    modelAgreement,
    modelCount,
    disagreement: Boolean(comparison.disagreement)
  };
}

/* -------------------------------------------------------------------------- */
/*  QUALITY SCORE (§36)                                                        */
/* -------------------------------------------------------------------------- */

export function scoreAnswerQuality({ answer = '', uncertainty = {}, evidence = {}, sources = [], comparison = {}, degraded = false }) {
  const clamp = (v) => Math.min(100, Math.max(0, Math.round(v)));
  const completeness = clamp(Math.min(100, (String(answer).length / 8)));
  const freshness = { BREAKING: 80, LIVE: 95, RECENT: 75, STATIC: 85 }[uncertainty.freshness] ?? 70;
  const evidenceScore = evidence.toolDataUsed ? 90 : evidence.webUsed ? (evidence.corroborated ? 85 : 65) : evidence.knowledgeUsed ? 70 : 35;
  const clarity = clamp(60 + Math.min(30, String(answer).length / 40));
  const riskAwareness = /ریسک|risk|احتیاط|caution|عدم قطعیت|uncertain/i.test(String(answer)) ? 85 : 50;
  const hallucinationRisk = degraded ? 60 : (evidence.toolDataUsed || evidence.webUsed ? 15 : comparison.disagreement ? 45 : 30); // lower = better
  const correctness = clamp((evidenceScore + certaintyProxy(uncertainty)) / 2);
  const userRelevance = clamp(answer ? 80 : 20);

  const answerQualityScore = clamp(
    correctness * 0.25 + completeness * 0.1 + freshness * 0.1 + evidenceScore * 0.2 +
    riskAwareness * 0.1 + userRelevance * 0.1 + (100 - hallucinationRisk) * 0.15
  );

  return {
    correctness, completeness, freshness, evidenceQuality: evidenceScore,
    riskAwareness, userRelevance, clarity, hallucinationRisk,
    answerQualityScore
  };
}

const certaintyProxy = (u = {}) => ({ LOW: 85, MEDIUM: 65, HIGH: 40 }[u.level] ?? 60);

/* -------------------------------------------------------------------------- */
/*  DEGRADED PATH — internal-only, honest, tool-grounded (§47, §59)            */
/* -------------------------------------------------------------------------- */

function buildDegradedAnswer({ message, analysis, context = {}, knowledge = [], sources = [], locale = 'fa' }) {
  const isFa = String(locale || 'fa').startsWith('fa');
  const parts = [];

  if (knowledge.length) {
    parts.push(isFa ? knowledge[0].body : knowledge[0].bodyEn || knowledge[0].body);
  }
  const priceMap = context.market?.priceMap;
  if (priceMap && Object.keys(priceMap).length && /بیت|btc|bitcoin|اتر|eth|ethereum|سول|sol|بازار|market|قیمت|price/i.test(message)) {
    const rows = Object.entries(priceMap).filter(([, p]) => p != null).map(([s, p]) => `${s}: $${Number(p).toLocaleString('en-US')}`);
    if (rows.length) {
      parts.push(isFa
        ? `داده زنده بازار: ${rows.join(' | ')}${context.market.change24hPct != null ? ` (تغییر ۲۴ ساعت بیت‌کوین: ${Number(context.market.change24hPct).toFixed(1)}٪)` : ''}.`
        : `Live market data: ${rows.join(' | ')}${context.market.change24hPct != null ? ` (BTC 24h change: ${Number(context.market.change24hPct).toFixed(1)}%)` : ''}.`);
    }
  }
  if (sources.length) {
    parts.push(isFa
      ? `${sources.length} منبع وب پیدا شد؛ بهترین منبع: «${sources[0].title}».`
      : `${sources.length} web source(s) found; top result: "${sources[0].title}".`);
  }
  if (!parts.length) {
    /*
     * The old wording here asserted something the code had not checked: «no
     * external AI model is available», even on a deployment with eight keys
     * where the ladder had simply not been walked. It now says which of the two
     * is true, because the fix differs completely — one is an operator task,
     * the other is a user task.
     */
    const anyKey = getActiveProviderIds().some((id) => id !== 'internal');
    parts.push(!anyKey
      ? (isFa
        ? 'هیچ مدل هوش مصنوعی خارجی روی این سرویس فعال نیست، و دادهٔ معتبری هم برای این سؤال پیدا نشد. مدیر سرویس باید یک کلید (مثلاً GROQ_API_KEY یا OPENROUTER_API_KEY) تنظیم کند تا پاسخ‌های عمیق‌تر ممکن شود.'
        : 'No external AI provider is configured on this deployment, and no trusted data was found for this question. An operator must set a provider key (for example GROQ_API_KEY or OPENROUTER_API_KEY) before deeper answers are possible.')
      : (isFa
        ? 'همهٔ مدل‌های فعال را برای این سؤال صدا زدم و هیچ‌کدام جواب قابل استناد نداد؛ دادهٔ معتبری هم پیدا نشد. بدون شاهد پاسخ قطعی نمی‌دهم.'
        : 'Every configured model was consulted for this question and none returned a citable answer, and no trusted data was found. I will not answer definitively without evidence.'));
  }
  return parts.join('\n\n');
}

/* -------------------------------------------------------------------------- */
/*  MAIN ENTRY — RUN COLLABORATIVE ANALYSIS                                    */
/* -------------------------------------------------------------------------- */

const DEFAULT_DEPS = {
  execute: executeProviderChat,
  parallel: parallelMultiProviderChat,
  debate: runMultiAiDebate,
  routed: routedChat,
  research: researchWeb,
  analyzeSources: analyzeWithSources
};

/**
 * Run the full collaboration protocol for one question.
 *
 * @param {object} params
 * @param {string} params.message      user question
 * @param {object} params.context      safe context (market, portfolio summary, page)
 * @param {string} params.locale       'fa' | 'en' | ...
 * @param {object} params.analysis     pre-computed planCollaboration() result (optional)
 * @param {boolean} params.transparency  expose per-model views (§37)
 * @param {object} params.deps         injectable provider fns (tests)
 * @param {number} params.deadlineMs   hard latency budget
 */
export async function runCollaborativeAnalysis({
  message = '',
  context = {},
  locale = 'fa',
  intentType = null,
  entities = {},
  analysis = null,
  transparency = false,
  deps = {},
  deadlineMs = DEADLINE_MS
} = {}) {
  const D = { ...DEFAULT_DEPS, ...deps };
  const startedAt = Date.now();
  const overBudget = () => Date.now() - startedAt > deadlineMs;
  const withDeadline = (promise, fallback, timeoutMs = deadlineMs) => {
    let timer;
    return Promise.race([
      promise,
      new Promise((resolve) => { timer = setTimeout(() => resolve(fallback), Math.max(500, timeoutMs)); })
    ]).finally(() => clearTimeout(timer));
  };

  const plan = analysis || planCollaboration({ message, intentType, entities, context, locale });
  const isFa = String(locale || 'fa').startsWith('fa');
  const externalConfigured = Boolean(D.selectProviders) || getActiveProviderIds().some((id) => id !== 'internal');

  const result = {
    ok: true,
    schema: COLLABORATION_SCHEMA,
    version: COLLABORATION_VERSION,
    level: plan.level,
    conversationKind: plan.conversationKind,
    complexity: plan.complexity,
    taskTypes: plan.taskTypes,
    roles: plan.roles,
    freshness: plan.freshness,
    emotion: plan.emotion,
    fomo: plan.fomo,
    providersUsed: [],
    modelsConsulted: [],
    answer: '',
    language: isFa ? 'fa' : 'en',
    sources: [],
    claims: [],
    verifiedClaims: [],
    aiConsensusOnly: [],
    consensus: null,
    disagreement: false,
    uncertainty: null,
    quality: null,
    evidence: { toolDataUsed: false, webUsed: false, knowledgeUsed: false, corroborated: false },
    degraded: false,
    transparency: Boolean(transparency),
    perRole: transparency ? [] : undefined,
    latencyMs: 0,
    at: Date.now()
  };

  /* ---- Evidence first: knowledge + web + tools (levels 2+) ---- */
  let knowledge = [];
  if (plan.level >= 2 && plan.freshness === 'STATIC') {
    knowledge = searchKnowledge(message, { locale, limit: 3 });
    /* BM25 retrieval over knowledge + the hand-checked Help answers fills
       the remaining slots (never displaces the knowledge-center hits the
       degraded answer is built from). Passages carry citable ids. */
    try {
      const seen = new Set(knowledge.map((k) => k.id));
      for (const p of retrieveBm25(message, { locale, limit: 3 })) {
        if (knowledge.length >= 4) break;
        if (seen.has(p.id)) continue;
        knowledge.push({ ...p, version: 1, bodyEn: p.body });
        seen.add(p.id);
      }
    } catch { /* retrieval is additive; its failure never blocks a turn */ }
    result.evidence.knowledgeUsed = knowledge.length > 0;
  }
  if (plan.level >= 2) {
    /* Live market/portfolio data injected into the context block IS tool
       grounding (§43) — the answer must be scored as data-backed. */
    result.evidence.toolDataUsed = Boolean(
      (context.market?.priceMap && Object.keys(context.market.priceMap).length) ||
      context.portfolio?.totalValueUsd != null
    );
  }

  let research = null;
  if (plan.needsWeb && plan.level >= 3 && !overBudget()) {
    /* Research gets a slice of the budget, never all of it — a hanging search
       must not eat the whole turn (§46). */
    const researchBudget = Math.min(8000, Math.max(1500, deadlineMs - (Date.now() - startedAt) - 2000));
    research = await withDeadline(D.research({ query: message, locale, freshness: plan.freshness }), null, researchBudget);
    if (research?.sources?.length) {
      result.sources = research.sources.map((s) => ({ title: s.title, url: s.url, tier: s.tier, snippet: String(s.snippet || '').slice(0, 200) }));
      result.evidence.webUsed = true;
      result.evidence.corroborated = Boolean(research.corroborated);
    }
  }

  const contextBlock = buildSafeContextBlock({ context, knowledge, sources: result.sources });

  /* The ordered fleet for THIS question: the dominant task's preferred order
     first, then every other configured provider (health-aware). One shared
     list so the roles below take DISTINCT seats — role i leads with seat i —
     instead of every role re-picking the same top provider. With this the
     engine is genuinely multi-model: the "multi-AI" answer is actually built
     from different providers, and every registered provider holds a real
     seat instead of sitting idle behind the first one that answers. */
  const fleetTask = (Array.isArray(plan.taskTypes)
    ? plan.taskTypes.find((t) => t !== 'intent' && t !== 'summarization')
    : null) || 'general';
  let fleet = externalConfigured
    ? healthyProvidersForTask(fleetTask, { max: Number.MAX_SAFE_INTEGER, fullFleet: true })
    : [];
  /* Rotate the base of the fleet for analysis turns so the whole registered
     fleet takes turns holding the primary seat across a session (see
     fleetBaseCursor). Level 1 keeps offset 0 → the fastest model leads. */
  if (plan.level >= 2 && fleet.length > 1) {
    const base = nextFleetBaseOffset(fleet.length);
    if (base > 0) fleet = fleet.slice(base).concat(fleet.slice(0, base));
  }

  /* ---- Stage 1-2: independent analyses by level (§9) ---- */
  const analyses = [];

  if (plan.level === 1 || !externalConfigured) {
    /* Conversation / simple, or no external provider configured at all. */
    if (plan.conversationKind === CONVERSATION_KINDS.GREETING || plan.conversationKind === CONVERSATION_KINDS.THANKS || plan.conversationKind === CONVERSATION_KINDS.CASUAL) {
      const socialLine = naturalConversationReply(plan.conversationKind, isFa, { locale, social: plan.social });
      result.answer = socialLine || result.answer || '';
      result.degraded = !externalConfigured && plan.level > 1;
    } else if (!externalConfigured) {
      result.answer = buildDegradedAnswer({ message, analysis: plan, context, knowledge, sources: result.sources, locale });
      result.degraded = true;
    } else {
      const single = await withDeadline(runRole({ role: AI_ROLES.CONVERSATION_AI, message, contextBlock, locale, deps: D, maxTokens: 400, fleet, seat: 0 }), null);
      if (single?.ok) {
        analyses.push(single);
        result.answer = single.answer;
      } else {
        result.answer = buildDegradedAnswer({ message, analysis: plan, context, knowledge, sources: result.sources, locale });
        result.degraded = true;
      }
    }
  } else if (plan.level === 2) {
    const role = plan.taskTypes.includes('market') ? AI_ROLES.MARKET_AI
      : plan.taskTypes.includes('crypto-analysis') || plan.taskTypes.includes('research') ? AI_ROLES.CRYPTO_RESEARCH_AI
      : plan.taskTypes.includes('risk') ? AI_ROLES.RISK_AI
      : AI_ROLES.CRYPTO_RESEARCH_AI;
    const single = await withDeadline(runRole({ role, message, contextBlock, locale, deps: D, fleet, seat: 0 }), null);
    if (single?.ok) { analyses.push(single); result.answer = single.answer; }
    else { result.answer = buildDegradedAnswer({ message, analysis: plan, context, knowledge, sources: result.sources, locale }); result.degraded = true; }
  } else if (plan.level === 3) {
    /* Two independent models + tools (+web when live). Each role takes a
       different seat of the shared fleet (seat = role index), so the two
       analyses are genuinely different providers, not one model twice. */
    const roles = pickAnalysisRoles(plan, 2);
    const settled = await withDeadline(
      Promise.all(roles.map((r, i) => runRole({ role: r, message, contextBlock, locale, deps: D, fleet, seat: i }))),
      []
    );
    analyses.push(...(settled || []).filter(Boolean));
    const valid = analyses.filter((a) => a.ok);
    result.answer = valid.length ? mergeTwoAnswers(valid, isFa) : buildDegradedAnswer({ message, analysis: plan, context, knowledge, sources: result.sources, locale });
    result.degraded = valid.length === 0;
  } else {
    /* Levels 4-5: multi-model debate + web + verification (§10, §20). Roles
       take distinct seats of the shared fleet (seat = role index); the
       verifier and the final-answer synthesiser continue the rotation so a
       high-stakes question walks several different providers end to end. */
    const roles = pickAnalysisRoles(plan, plan.level >= 5 ? 3 : 2);
    const settled = await withDeadline(
      Promise.all(roles.map((r, i) => runRole({ role: r, message, contextBlock, locale, deps: D, fleet, seat: i }))),
      []
    );
    analyses.push(...(settled || []).filter(Boolean));

    const valid = analyses.filter((a) => a.ok);
    if (valid.length >= 2 && !overBudget()) {
      /* Cross-examination: the verification role sees the other analyses. */
      const digest = valid.map((a) => `[${a.role}] ${String(a.answer).slice(0, 400)}`).join('\n\n');
      const verifier = await withDeadline(runRole({
        role: AI_ROLES.VERIFICATION_AI,
        message: `${message}\n\nCANDIDATE ANALYSES TO CHALLENGE:\n${digest}`,
        contextBlock,
        locale,
        deps: D,
        fleet,
        seat: roles.length
      }), null);
      if (verifier?.ok) analyses.push(verifier);
    }

    const validFinal = analyses.filter((a) => a.ok && a.role !== AI_ROLES.VERIFICATION_AI);
    if (validFinal.length) {
      /* Stage 6: one clean FBT answer from the specialists' work (§37). */
      const digest = analyses.filter((a) => a.ok).map((a) => `[${a.role}] ${String(a.answer).slice(0, 500)}`).join('\n\n');
      const finalRole = await withDeadline(runRole({
        role: AI_ROLES.FINAL_ANSWER_AI,
        message: `${message}\n\nSPECIALIST WORK:\n${digest}`,
        contextBlock,
        locale,
        deps: D,
        fleet,
        seat: roles.length + 1,
        maxTokens: 800
      }), null);
      result.answer = finalRole?.ok
        ? finalRole.answer
        : mergeTwoAnswers(validFinal, isFa);
      if (finalRole?.ok) analyses.push(finalRole);
    } else {
      result.answer = buildDegradedAnswer({ message, analysis: plan, context, knowledge, sources: result.sources, locale });
      result.degraded = true;
    }
  }

  /* ---- Stage 3-4: compare + verify ---- */
  const comparison = compareAnalyses(analyses);
  result.disagreement = Boolean(comparison.disagreement);
  const verification = verifyClaims({ factualClaims: comparison.factualClaims, context, sources: result.sources });
  result.claims = comparison.factualClaims;
  result.verifiedClaims = verification.verified;
  result.aiConsensusOnly = verification.aiConsensusOnly;

  /* ---- Stage 5: consensus + uncertainty ---- */
  result.consensus = {
    reached: !comparison.disagreement && analyses.filter((a) => a.ok).length > 0,
    agreement: comparison.agreement,
    divergenceDetected: comparison.disagreement,
    note: comparison.disagreement
      ? (isFa ? 'دو تحلیل مختلف وجود دارد؛ شواهد موجود وزن‌دهی شده‌اند اما قطعیت کامل ندارند.' : 'Two different analyses exist; the evidence is weighed but not conclusive.')
      : null
  };
  result.uncertainty = computeUncertainty({ analyses, comparison, evidence: result.evidence, freshness: plan.freshness });

  /* ---- Emotional adaptation (§25-27): acknowledge, never amplify ---- */
  const acknowledgement = formatEmotionalAcknowledgement({ emotion: plan.emotion, fomo: plan.fomo, locale });
  if (acknowledgement) result.answer = prepend(acknowledgement, result.answer);

  /* ---- Quality score (§36) ---- */
  result.quality = scoreAnswerQuality({
    answer: result.answer,
    uncertainty: result.uncertainty,
    evidence: result.evidence,
    sources: result.sources,
    comparison,
    degraded: result.degraded
  });

  /* ---- Transparency (§37): only on explicit request ---- */
  if (transparency) {
    result.perRole = analyses.filter((a) => a.ok).map((a) => ({
      role: a.role, provider: a.provider, model: a.model,
      answer: String(a.answer).slice(0, 400), uncertainty: a.uncertainty
    }));
  }

  result.providersUsed = [...new Set(analyses.filter((a) => a.ok && a.provider).map((a) => a.provider))];
  result.modelsConsulted = [...new Set(analyses.filter((a) => a.ok && a.model).map((a) => a.model))];
  result.latencyMs = Date.now() - startedAt;
  result.at = Date.now();
  return result;
}

function prepend(prefix, text) {
  const t = String(text || '').trim();
  if (!t) return prefix;
  if (t.startsWith(prefix.slice(0, 20))) return t;
  return `${prefix}\n\n${t}`;
}

/**
 * Emotional acknowledgement line (§25-27): acknowledge the concern, never
 * pretend certainty, never give false reassurance, never amplify FOMO.
 * Returns null when no adaptation is warranted.
 */
export function formatEmotionalAcknowledgement({ emotion = {}, fomo = {}, locale = 'fa' } = {}) {
  const isFa = String(locale || 'fa').startsWith('fa');
  const state = String(emotion?.state || 'calm');
  if (state === 'panic' || state === 'fearful') {
    return isFa
      ? 'طبیعی است که نوسان بازار باعث نگرانی شود. بیایید بدون عجله و بر اساس داده بررسی کنیم.'
      : 'It is normal for market swings to feel unsettling. Let us look at this calmly, based on data.';
  }
  if (fomo?.detected) {
    return isFa
      ? 'پیش از هر تصمیم سریع، فرصت و ریسک را کنار هم می‌گذارم — هیچ فرصتی ارزش تصمیم هیجانی ندارد.'
      : 'Before any rushed move, here is the opportunity next to its risk — no opportunity is worth an impulsive decision.';
  }
  if (state === 'frustrated') {
    return isFa
      ? 'متأسفم که تجربه خوبی نداشتی. بیا دقیق و کوتاه مشکل را حل کنیم.'
      : 'Sorry about the rough experience. Let us fix this precisely and briefly.';
  }
  return null;
}

/**
 * Reply for a level-1 social turn.
 *
 * This used to be a three-way ternary over `isFa`, which meant ten of the
 * product's twelve languages were answered in English and «چخبر» was answered
 * as a hello. It now defers to the twelve-locale voice table, and keeps the
 * old bilingual strings only as the table's own English fallback.
 */
function naturalConversationReply(kind, isFa, { locale = null, social = null } = {}) {
  const act = social?.act || (kind === CONVERSATION_KINDS.THANKS ? SOCIAL_ACTS.THANKS : kind === CONVERSATION_KINDS.CASUAL ? SOCIAL_ACTS.SMALL_TALK : SOCIAL_ACTS.GREETING);
  const lang = social?.lang || (isFa ? 'fa' : String(locale || 'en').toLowerCase().split('-')[0]) || 'en';
  const rendered = renderSocialReply({ act, lang, seed: `${act}:${lang}` });
  return rendered.ok ? rendered.text : null;
}

function pickAnalysisRoles(plan, max) {
  const priority = [
    [AI_ROLES.MARKET_AI, plan.taskTypes.includes('market')],
    [AI_ROLES.CRYPTO_RESEARCH_AI, plan.taskTypes.includes('crypto-analysis') || plan.taskTypes.includes('research')],
    [AI_ROLES.NEWS_AI, plan.taskTypes.includes('news')],
    [AI_ROLES.RISK_AI, plan.taskTypes.includes('risk')],
    [AI_ROLES.STRATEGY_AI, plan.taskTypes.includes('strategy')],
    [AI_ROLES.PORTFOLIO_AI, plan.taskTypes.includes('portfolio')]
  ];
  const chosen = priority.filter(([, wanted]) => wanted).map(([r]) => r).slice(0, max);
  while (chosen.length < Math.min(2, max)) {
    const fallback = [AI_ROLES.MARKET_AI, AI_ROLES.RISK_AI].find((r) => !chosen.includes(r));
    if (!fallback) break;
    chosen.push(fallback);
  }
  return chosen.length ? chosen : [AI_ROLES.MARKET_AI, AI_ROLES.RISK_AI].slice(0, max);
}

function mergeTwoAnswers(valid, isFa) {
  const uniq = [];
  for (const a of valid) {
    if (!uniq.some((u) => u.answer === a.answer)) uniq.push(a);
  }
  if (uniq.length === 1) return uniq[0].answer;
  return isFa
    ? `${uniq[0].answer}\n\nدیدگاه مکمل:\n${uniq[1].answer}`
    : `${uniq[0].answer}\n\nComplementary view:\n${uniq[1].answer}`;
}
