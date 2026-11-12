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
  resetProviderHealth as resetGatewayProviderHealth,
  beginAiTurnBudget,
  providerCallBudgetLeft,
  spendProviderCall
} from './aiGateway.js';
import { runMultiAiDebate } from './aiConsensus.js';
import { researchWeb, analyzeWithSources } from './aiWebResearch.js';
import { resolveIntelligenceMode, intelligenceGeneration, intelligenceDeadlineMs, getIntelligenceProfile } from './aiIntelligence.js';
import {
  aiAnswerCacheKey,
  aiAnswerCachePersist,
  aiAnswerCacheSet,
  aiAnswerCacheTtlMs,
  isCacheableAnswer,
  withAiAnswerCache,
  aiAnswerCacheEnabled
} from './aiAnswerCache.js';
import { searchKnowledge } from '../src/lib/intent-ai/os/knowledgeCenter.js';
import { hybridKnowledgeSearch } from '../src/lib/intent-ai/os/semanticKnowledge.js';
import {
  REASONING_CONTRACT,
  captureReasoning,
  checkReasoningSupportsAnswer,
  buildReasoningLedger,
  renderReasoningLedger,
  reasoningLedgerSummary,
  recordReasoningLedger
} from './aiReasoningLedger.js';
import { renderCortexBlock, cortexReadPayload, marketStateFromFrame } from './aiCortexBridge.js';
import { retrieve as retrieveBm25 } from '../src/lib/intent-ai/retrieval.js';
import { gatherExpandedKnowledge, synthesizeInternalAnswer } from './aiInternalReasoner.js';
import { evaluateLocalFirst, preEvaluateLocalFirst } from './aiLocalFirstGate.js';
import {
  planCollaboration,
  CONVERSATION_KINDS,
  AI_ROLES
} from '../src/lib/intent-ai/os/collaborationRouter.js';
import { renderSocialReply } from '../src/lib/intent-ai/os/conversation/socialVoice.js';
import { auditNumbers, buildEvidenceCorpus, renderUnsourcedBlock } from './aiEvidenceAudit.js';
import { buildClaimLedger, renderClaimLedger } from './aiClaimLedger.js';
import { selectEconomicLenses, renderEconomistLens, economistPersona } from './aiEconomistLens.js';
import { readSocialContext, renderSocialBrief } from '../src/lib/intent-ai/os/conversation/socialRead.js';
import {
  readDialogue,
  renderDialogueBrief,
  checkDialogueCompliance,
  renderDialogueDeficit
} from '../src/lib/intent-ai/os/conversation/dialogueRead.js';
import {
  selectProfessorLenses,
  renderProfessorContract,
  checkFalsifier,
  renderFalsifierDeficit
} from './aiProfessor.js';
import {
  createResearchAgenda,
  deriveResearchFindings,
  selectAgendaItems
} from './aiResearchAgenda.js';
import {
  detectMarketAnalysis,
  buildMarketFrame,
  renderMarketFrame,
  renderMarketContract,
  checkMarketAnalysis,
  renderMarketViolations
} from './aiMarketFrame.js';
import {
  readEmotion,
  renderEmpathyContract,
  checkEmotionTone,
  renderEmotionDeficit
} from './aiEmotionRead.js';
import {
  readDiscourse,
  renderDiscourseContract,
  checkDiscourseMirror,
  renderDiscourseDeficit
} from './aiDiscourseMirror.js';
import {
  readPartialInput,
  renderPartialContract,
  checkPartialAnswer,
  renderPartialDeficit
} from '../src/lib/intent-ai/os/conversation/partialInput.js';
import {
  detectProductQuestion,
  answerProduct,
  renderProductBrief,
  checkProductAnswer,
  renderProductDeficit
} from './aiProductBrain.js';
import {
  readSituation,
  renderSituationContract,
  checkSituationResponse,
  renderSituationDeficit
} from './aiSituationRead.js';
import {
  analyzeRequest,
  renderRequestPlan,
  checkRequestPlan,
  renderRequestDeficit
} from './aiRequestPlan.js';
import { storeGet, storeSet } from './store.js';
import { checkPlanArithmetic, renderStrategyViolations, isPlanParameter } from './aiStrategyPlanCheck.js';
import { assessEvidence, evaluateDecision, renderDecisionContract, renderDecisionDeficit } from './aiDecisionGate.js';
import {
  detectStrategyRequest,
  buildStrategyFrame,
  renderStrategyFrame,
  renderStrategyRubricContract,
  checkStrategyRubric,
  renderStrategyGaps
} from './aiStrategyFrame.js';
import {
  decomposeQuestion,
  assessQuestionCoverage,
  renderSubQuestionChecklist,
  renderUnansweredParts
} from '../src/lib/intent-ai/os/questionDecomposition.js';
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

/*
 * ─── ADVERSARIAL SELF-REVIEWER (smartest mode) ───────────────────────────────
 * A separate voice from the synthesiser: it did not write the draft, it is
 * asked to break it. The only evidence it sees is the same safe context block
 * the draft was allowed to use, so "unsupported" has a precise meaning — not
 * "I personally doubt it", but "this number is not in the block".
 */
const CRITIQUE_SYSTEM = `You are FBT's adversarial self-reviewer. You receive the user's question, a DRAFT ANSWER, and the ONLY evidence the answer was allowed to use. Your job is to make the draft honest and useful — not to rewrite it for style.
Check, in this order:
1. every number, price, percentage, date, balance and fee against the evidence: delete it or mark it unknown if it is not there;
2. certainty: soften claims the evidence cannot support, and add the strongest counter-argument the draft ignores;
3. completeness: answer the question actually asked; if a required reading is missing, name the specific reading.
Keep the user's language and FBT's voice. If the draft is already sound, return it unchanged.
Put the corrected FINAL ANSWER in "answer". Put each change you made (or "no change") as one claim in "claims". Put what remains uncertain in "uncertainty".`;

/*
 * ─── THE REASONING FIELD (§8 — LEVER #4) ───────────────────────────────────
 * The shape grew a "reasoning" object.
 *
 * It used to be prose: the `deepReasoning` line asked the model to identify
 * the deciding facts and reason from them, but the schema had nowhere to put
 * the result — so the reasoning was DISCARDED and only the conclusion came
 * back. A seat that reasoned and a seat that asserted then looked identical
 * to the pipeline, because the pipeline never saw the difference.
 *
 * The field is optional: a seat that does not fill it behaves exactly as it
 * does today. Forcing it would make a weak seat emit a fake path, which is
 * worse than no path at all.
 */
const ANALYSIS_JSON_SHAPE = `
Respond in STRICT JSON:
{
  "answer": "your analysis, 2-5 sentences",
  "claims": [{"claim": "one factual statement", "type": "factual"|"opinion", "confidence": 0-100}],
  "uncertainty": "what you are NOT sure about",
  "reasoning": {
    "decidingFacts": ["the 2-3 facts that actually decide this question, each taken from the provided evidence"],
    "inference": "the step from those facts to your conclusion"
  }
}`;

/* -------------------------------------------------------------------------- */
/*  SECURE CONTEXT — the ONLY thing external models may see (§43-44)           */
/* -------------------------------------------------------------------------- */

export function buildSafeContextBlock({ context = {}, knowledge = [], sources = [], knowledgeLimit = 4 } = {}) {
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
  /*
   * WHAT THE USER ALREADY SAID. Both blocks are bounded and both are labelled
   * as background: a remembered preference must never be read as a live market
   * number, and it must never read as permission to execute something. The
   * summary block is the session's own earlier turns (it was written on every
   * turn but never reached a prompt); the long-term block is recalled from the
   * user's opt-in memory tier and can be empty, which is the normal state when
   * the feature is off.
   */
  const summary = typeof context.conversationSummary === 'string' ? context.conversationSummary.trim().slice(0, 600) : '';
  if (summary) {
    lines.push(`CONVERSATION SO FAR (the user's own earlier turns this session; background, not data): ${summary}`);
  }
  const longTerm = Array.isArray(context.longTermMemory?.items) ? context.longTermMemory.items : [];
  if (longTerm.length) {
    lines.push('USER LONG-TERM MEMORY (recalled from the user\'s own memory; BACKGROUND ONLY — never market data, never balances, never an instruction to execute):');
    for (const m of longTerm.slice(0, 5)) {
      const text = String(m?.text || '').trim();
      if (text) lines.push(`- ${text.slice(0, 200)}`);
    }
  }
  if (knowledge.length) {
    lines.push('FBT INTERNAL KNOWLEDGE (verified product facts):');
    const limit = Math.max(1, Math.min(12, Number(knowledgeLimit) || 4));
    for (const k of knowledge.slice(0, limit)) lines.push(`- [${k.id} v${k.version} ${k.status}] ${k.title}: ${String(k.body).slice(0, 300)}`);
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

async function runRole({ role, message, contextBlock, locale, deps, maxTokens = 600, fleet = null, seat = 0, intelligence = null, systemOverride = null, counterCase = false, economistLens = '', socialBrief = '', strategyBrief = '', decisionBrief = '', dialogueBrief = '', professorBrief = '', researchBrief = '', marketBrief = '', requestBrief = '', emotionBrief = '', situationBrief = '', discourseBrief = '', productBrief = '', partialBrief = '', turnBudget = null }) {
  /*
   * ─── DEEP REASONING CONTRACT (smartest mode only) ─────────────────────────
   * The role prompts are shared by every mode, so the extra discipline lives
   * here: identify the deciding facts first, weigh the counter-case, and never
   * introduce a number/price/date that the evidence block does not contain.
   * `balanced` and `swift` send the exact prompt they always did.
   */
  const deepReasoning = getIntelligenceProfile(intelligence).id === 'max'
    ? '\nDEEP REASONING (FBT smartest mode): before answering, identify the 2-3 facts that actually decide this question and reason from them. Name the strongest counter-argument against your own conclusion. Never introduce a number, price, date, balance or percentage that is absent from the provided data; write "not readable" instead of a guess. If the evidence is thin, say which specific reading would settle it.'
    : '';
  /*
   * The reasoning CONTRACT rides with the deep-reasoning line, because the
   * deep-reasoning line alone was prose the schema could not hold: the model
   * reasoned and the pipeline never saw it. Now the contract says what the
   * "reasoning" field must contain, and the pipeline checks the answer
   * against it.
   */
  const reasoningContract = getIntelligenceProfile(intelligence).id === 'max'
    ? '\n' + REASONING_CONTRACT
    : '';
  /*
   * ─── RED TEAM SEAT (smartest mode only) ───────────────────────────────────
   * Three analyses that all reason from the same obvious reading are one
   * analysis paid for three times. The LAST analytical seat is therefore given
   * a dissenting brief: assume the obvious conclusion is wrong and build the
   * strongest evidence-based case against it. It is still bound by the same
   * evidence block and the same JSON shape — dissent, not invention.
   */
  const counterCaseContract = counterCase
    ? '\nRED TEAM (you hold the dissenting seat): the other analysts will argue the obvious reading of this data. Assume that reading is WRONG and build the strongest case the evidence can actually support for the opposite conclusion. Do not hedge into "both sides"; give the counter-conclusion, the evidence that would have to be true for it, and the single reading that would settle which side is right. You may not introduce any number that is absent from the provided data.'
    : '';
  const system = systemOverride
    ? `${systemOverride}\n${ANALYSIS_JSON_SHAPE}${deepReasoning}${reasoningContract}`
    /* The economist's lens is a reasoning contract, not a costume: it rides on
       the specialists and the synthesiser, never on the reviewer (whose job is
       to break the draft, not to reason about the economy). */
    : `${ROLE_PROMPTS[role] || ROLE_PROMPTS[AI_ROLES.FINAL_ANSWER_AI]}\n${ANALYSIS_JSON_SHAPE}${deepReasoning}${reasoningContract}${counterCaseContract}${socialBrief ? `\n${socialBrief}` : ''}${economistLens ? `\n${economistLens}` : ''}${strategyBrief ? `\n${strategyBrief}` : ''}${decisionBrief ? `\n${decisionBrief}` : ''}${dialogueBrief ? `\n${dialogueBrief}` : ''}${professorBrief ? `\n${professorBrief}` : ''}${researchBrief ? `\n${researchBrief}` : ''}${marketBrief ? `\n${marketBrief}` : ''}${requestBrief ? `\n${requestBrief}` : ''}${emotionBrief ? `\n${emotionBrief}` : ''}${situationBrief ? `\n${situationBrief}` : ''}${discourseBrief ? `\n${discourseBrief}` : ''}${productBrief ? `\n${productBrief}` : ''}${partialBrief ? `\n${partialBrief}` : ''}`;
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
    /*
     * A provider this turn has already proved dead is skipped without a
     * request. On the free tier this is the difference between one 429 on
     * OpenRouter and three: the cap is per-day, so the second and third
     * questions are certain to fail too and only spend the budget.
     */
    if (turnBudget?.exhaustedProviders?.has?.(providerId)) continue;
    try {
      /*
       * The call cap, enforced here as well as in the gateway.
       *
       * The gateway is the authority for a real request, but the
       * collaboration layer is the authority for the TURN: it knows which
       * stage is asking and whether the answer already exists. A cap
       * enforced only inside the gateway would be invisible here, and a
       * stage that cannot afford to ask must be told so, not left to
       * discover it by failing.
       *
       * It sits INSIDE the try, so a spent cap is a failed ROLE and not
       * a failed turn: the other roles keep their answers and the
       * synthesiser still has something to work with.
       */
      if (!spendProviderCall(turnBudget)) {
        const capErr = new Error('PROVIDER_CALL_CAP_SPENT');
        capErr.reasonCode = 'QUOTA';
        capErr.fix = 'This turn has spent its provider-call cap; the answer is built from what it already read.';
        throw capErr;
      }
      const res = await deps.execute(providerId, {
        system,
        user,
        temperature: 0.3,
        maxTokens,
        json: true,
        /* The mode travels with the call so the gateway can put the flagship
           model first and attach reasoning fields where they are supported.
           An injected test executor ignores it. */
        intelligence,
        /* The per-turn ledger: a model id that already failed in this turn
           is not tried again, and a provider whose ladder is already dead is
           not re-walked. See "THE TURN BUDGET" in aiGateway.js.
           The gateway calls the option `budget`; the collaboration layer
           calls it `turnBudget`, so both names are passed. */
        turnBudget,
        budget: turnBudget
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
        /*
         * The reasoning path, captured (§8 — LEVER #4). It was asked for and
         * discarded; now it is kept, so the synthesis can see the paths and
         * the pipeline can check a conclusion against its own reasoning.
         */
        reasoning: captureReasoning(parsed),
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

function buildDegradedOutcome(params = {}) {
  const {
    message,
    analysis,
    context = {},
    knowledge = [],
    sources = [],
    locale = 'fa',
    subQuestions = [],
    economistLenses = [],
    professorLenses = [],
    socialRead = null,
    emotionRead = null,
    situationRead = null,
    discourseRead = null,
    dialogueRead = null,
    marketFrame = null,
    strategyFrame = null,
    decisionEvidence = null,
    partialRead = null,
    productRead = null
  } = params;

  const isFa = String(locale || 'fa').startsWith('fa');
  const synth = synthesizeInternalAnswer({
    message,
    locale,
    context,
    knowledge,
    sources,
    subQuestions,
    economistLenses,
    professorLenses,
    socialRead,
    emotionRead,
    situationRead,
    discourseRead,
    dialogueRead,
    marketFrame,
    strategyFrame,
    decisionEvidence,
    partialRead,
    productRead,
    plan: analysis
  });
  if (synth?.ok && synth.answer) {
    return {
      answer: synth.answer,
      knowledgeUsed: Boolean(synth.knowledgeUsed),
      internalSynthesis: Boolean(synth.internalSynthesis),
      safetyContainment: Boolean(synth.safetyContainment)
    };
  }

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
  return {
    answer: parts.join('\n\n'),
    knowledgeUsed: knowledge.length > 0,
    internalSynthesis: false,
    safetyContainment: false
  };
}

function buildDegradedAnswer(params = {}) {
  return buildDegradedOutcome(params).answer;
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
 * @param {number} params.deadlineMs   hard latency budget; when omitted the
 *                                     mode's own budget is used (8s swift,
 *                                     20s balanced, 45s smartest), always
 *                                     clamped under the platform wall clock
 */
export async function runCollaborativeAnalysis({
  message = '',
  context = {},
  locale = 'fa',
  intentType = null,
  entities = {},
  analysis = null,
  intelligence = null,
  transparency = false,
  /* Whose research agenda this turn reads and updates. null = the shared one. */
  owner = null,
  deps = {},
  deadlineMs: requestedDeadlineMs = null
} = {}) {
  /*
   * ═══ THE ANSWER CACHE (2026-11-11) ═══════════════════════════════════════
   *
   * This fleet is three free tiers, and two ceilings bind it at once: about
   * EIGHT MINUTES OF CPU PER DAY (the Hobby Fluid Active CPU allowance) and
   * OpenRouter's free catalogue's 50-requests-a-day cap. A `max` turn spends
   * three of those requests and seconds of CPU. Without a cache the daily
   * allowance is gone in about fifteen questions.
   *
   * So the cache wraps the WHOLE TURN, not one provider call: everything the
   * turn does — the analyses, the verifier, the adversarial repair pass — is
   * inside the producer, and a hit skips all of it.
   *
   * Two rules keep this honest:
   *
   *   1. A HIT REPLAYS THE VERDICT, NOT A GUESS. The cached value carries the
   *      original `providersUsed`, `modelsConsulted`, `claims`,
   *      `verifiedClaims`, `aiConsensusOnly` and `uncertainty`. A client
   *      cannot tell a cached answer from a fresh one, and cannot be misled
   *      by one: the cache does not make a weak answer look strong, it makes
   *      a strong answer free.
   *
   *   2. THE KEY INCLUDES EVERYTHING THAT CHANGES THE ANSWER — the locale,
   *      the mode, the conversation id and history, and the user's own
   *      ground truth. A cache that ignored the last of those would serve one
   *      user's portfolio-grounded answer to another user, which is a
   *      privacy leak and not merely a wrong answer.
   */
  const cacheKey = aiAnswerCacheKey({
    question: message,
    locale,
    intelligence: resolveIntelligenceMode(intelligence ?? analysis?.intelligence?.mode ?? null).mode,
    conversationId: context?.conversationId || null,
    priorMessages: context?.conversationSummary || null,
    /* The user's own ground truth: portfolio, wallet, last assets. Digested
       into the key, never stored. */
    groundTruth: {
      portfolio: context?.portfolio || null,
      wallet: context?.wallet || null,
      lastAssets: context?.lastAssets || null
    },
    surface: context?.surface || null,
    intentType
  });

  const runTurn = () => runCollaborativeAnalysisInner({
    message,
    context,
    locale,
    intentType,
    entities,
    analysis,
    intelligence,
    transparency,
    owner,
    deps,
    deadlineMs: requestedDeadlineMs
  });

  /*
   * AN INJECTED FLEET MEANS THE CACHE IS OFF.
   *
   * `deps` is how a caller supplies its own provider fleet — the test path
   * and the diagnostic path. Two different fleets can answer the SAME
   * question with DIFFERENT answers, and the fleet identity alone does not
   * tell them apart: two mock fleets that expose the same seat names are
   * different fleets with the same name.
   *
   * So a turn with injected dependencies is never cached, and never served
   * from the cache. The cache is for the production path, where the fleet
   * is the deployment's own — the same one, for the same question, which
   * is exactly the case where replaying the answer is right.
   */
  const injectedFleet = Boolean(deps && Object.keys(deps).length > 0);

  if (!cacheKey || injectedFleet || !aiAnswerCacheEnabled()) {
    const value = await runTurn();
    return value;
  }

  /* The TTL needs the freshness class, which is only known once the turn has
     been planned. So the cache is written INSIDE the turn (where `plan` is
     in hand) and this wrapper only READS it. The read is what spares the
     fleet; the write needs the plan's freshness verdict. */
  const cached = await withAiAnswerCache(cacheKey, 0, async () => {
    const value = await runTurn();
    if (!isCacheableAnswer(value, { freshness: value?.freshness })) return value;
    aiAnswerCacheSetForTurn(cacheKey, value, value?.freshness);
    return value;
  }, { enabled: true });

  return cached.value;
}

/**
 * Write one turn's answer into the cache, with the TTL its freshness class
 * earns.
 *
 * Kept separate from the read path so the TTL decision — which needs the
 * plan's freshness verdict — lives next to the plan that produced it.
 */
function aiAnswerCacheSetForTurn(key, value, freshness) {
  try {
    const ttl = aiAnswerCacheTtlMs(freshness);
    aiAnswerCacheSet(key, value, ttl);
    /*
     * And write it where the NEXT lambda can find it.
     *
     * This is the line that makes the cache real on a serverless
     * deployment. The in-memory tier dies with the instance; the durable
     * tier does not, so a question asked twice on two different lambdas
     * costs ONE collaboration instead of two — and on the `:free` tier
     * that is five provider calls saved, out of fifty a day.
     */
    aiAnswerCachePersist(key, value, ttl)?.catch(() => {});
  } catch {
    /* A cache write must never take down a turn that already has an answer. */
  }
}

async function runCollaborativeAnalysisInner({
  message = '',
  context = {},
  locale = 'fa',
  intentType = null,
  entities = {},
  analysis = null,
  intelligence = null,
  transparency = false,
  owner = null,
  deps = {},
  deadlineMs: requestedDeadlineMs = null
} = {}) {
  const D = { ...DEFAULT_DEPS, ...deps };
  const startedAt = Date.now();
  /*
   * ─── THE TURN LEDGER ─────────────────────────────────────────────────────
   * One ledger per question. Every role of this turn shares it, so a model id
   * that proved dead for the Risk AI is not re-tried for the Final Answer, and
   * a provider whose ladder is exhausted is not walked again.
   *
   * Before the ledger, one `max` turn measured 13-16 provider calls; against
   * OpenRouter's 50/day free cap that is a quarter of the daily budget for a
   * single question. The failover itself is NOT removed — a free tier needs
   * failover — but the same dead model id is no longer asked twice in the
   * same question.
   */
  const turnBudget = beginAiTurnBudget();
  /*
   * ─── THE DAY'S ALLOWANCE, AND THE CAP IT LEAVES ─────────────────────────
   *
   * The turn's own cap (six requests) is the normal shape of a deep
   * turn. But the DAY is the scarce thing on the free tier, and a
   * deployment that can count its own spending can decide to spend it
   * deliberately: when the day's allowance is nearly gone, the turn
   * keeps its cap low, so the last requests of the day are spread over
   * several questions instead of spent on the first one.
   *
   * The cap is computed asynchronously, so it is applied as soon as the
   * number arrives — before any role asks. A turn that is already
   * running keeps its normal cap; the next one gets the reduced one.
   */
  let quotaCapApplied = null;
  try {
    const { quotaAwareCallCap } = await import('./aiQuotaBudget.js');
    /*
     * The provider ids to count are the ones this turn would actually
     * use. An injected fleet has its own seat names; the deployment's
     * own fleet is the three free tiers. Either way the list is the
     * ids, and an empty list means «the default fleet».
     */
    let fleetIds = [];
    try {
      const picked = typeof D.selectProviders === 'function' ? await D.selectProviders({ message, locale }) : null;
      if (Array.isArray(picked)) fleetIds = picked.filter((x) => typeof x === 'string' && x);
    } catch {
      fleetIds = [];
    }
    if (!fleetIds.length) fleetIds = ['openrouterfree', 'groq', 'workersai'];
    quotaCapApplied = await quotaAwareCallCap(fleetIds, { baseCap: turnBudget.maxCalls });
    if (quotaCapApplied && Number.isFinite(quotaCapApplied.cap) && quotaCapApplied.cap < turnBudget.maxCalls) {
      turnBudget.maxCalls = quotaCapApplied.cap;
    }
  } catch (err) {
    /* No counter, no reduction. The turn keeps its normal cap. */
    if (process.env.AI_QUOTA_DEBUG === '1') console.warn('[ai-quota] cap lookup failed:', String(err?.message || err));
  }
  /*
   * ─── THE CALL CAP, AND WHAT IT DROPS ────────────────────────────────────
   *
   * The turn has a hard ceiling on provider requests, because the daily
   * allowance is the scarce resource on the free tier — not the latency
   * and not the tokens.
   *
   * When the cap is close, the stages that REFINE the answer are the ones
   * that go: the verifier (a cross-examination of the analyses) and the
   * critic (a repair pass over the draft). The stages that CARRY the
   * answer — the analyses and the synthesiser — always run.
   *
   * The order matters and it is deliberate. A turn that lost its third
   * analysis still has two independent reads; a turn that lost its
   * final answer has nothing to show the user. So the cap is spent from
   * the bottom of the stack up, never from the top down.
   */
  const callsLeft = () => providerCallBudgetLeft(turnBudget);
  /* One call is reserved for the synthesiser. Without this reservation a
     turn could spend its last unit on a verifier and then have nothing
     left to write the answer with. */
  /*
   * Whether ONE more provider call is affordable right now.
   *
   * `>=` and not `>`: a turn with exactly one call left CAN still spend
   * it, and the stage that spends it must be the LAST one — the critic.
   * The two stages therefore ask differently:
   *
   *   · the verifier asks "can I afford this AND still have one left
   *     for the synthesiser?" — because the answer needs the
   *     synthesiser, and a turn with no final answer is a turn with no
   *     answer;
   *   · the critic asks "can I afford this at all?" — because it is last
   *     and optional.
   */
  const canAffordRefinement = () => callsLeft() >= 1;
  /* The verifier must leave room for the synthesiser. */
  const canAffordVerification = () => callsLeft() >= 2;
  /*
   * ─── THE BUDGET IS THE MODE'S, AND IT IS SPENT, NOT RENEWED ──────────────
   * Two defects made the smartest mode unfinishable on a real deployment, and
   * they compounded:
   *
   *   1. the budget was ONE number for every mode — `AI_COLLAB_DEADLINE_MS ||
   *      20000`, tuned when an answer meant 600 tokens from a cheap model. A
   *      `max` turn asks a flagship with a thinking budget for three analyses,
   *      a verifier and a repair pass; 20 s is not that, so the deep stages
   *      raced against an already-spent budget and the turn ended in the
   *      fallback text — indistinguishable from the pre-upgrade app.
   *   2. `withDeadline` defaulted to the WHOLE `deadlineMs` measured from the
   *      moment the stage started, not from the start of the turn. Every stage
   *      therefore got a fresh 20 s: the pipeline could run four stages long
   *      (~80 s) while the serverless function is killed at 60 s and the
   *      browser gives up at 30 s. «هیچ تغییری» was in fact «هیچ پاسخی».
   *
   * Both are fixed by construction now: the mode owns the budget, and every
   * stage gets what the turn has LEFT.
   */
  const budgetMode = resolveIntelligenceMode(intelligence ?? analysis?.intelligence?.mode ?? null);
  const budget = intelligenceDeadlineMs(budgetMode.mode, requestedDeadlineMs);
  const deadlineMs = budget.deadlineMs;
  const remainingMs = () => Math.max(500, deadlineMs - (Date.now() - startedAt));
  const overBudget = () => Date.now() - startedAt > deadlineMs;
  const withDeadline = (promise, fallback, timeoutMs = remainingMs()) => {
    let timer;
    return Promise.race([
      promise,
      new Promise((resolve) => { timer = setTimeout(() => resolve(fallback), Math.max(500, timeoutMs)); })
    ]).finally(() => clearTimeout(timer));
  };

  /*
   * Resolve the mode BEFORE planning when no plan was supplied, so a direct
   * caller (`runCollaborativeAnalysis({ intelligence: 'max' })`) gets the same
   * depth floor the chat route gets. Previously only the route's pre-built plan
   * carried it, and a direct call silently ran at the analyzer's level with
   * `max` budgets — a mode that was half applied.
   */
  const preResolved = budgetMode;
  const preProfile = getIntelligenceProfile(preResolved.mode);
  const plan = analysis || planCollaboration({
    message,
    intentType,
    entities,
    context,
    locale,
    intelligence: preResolved.mode,
    intelligenceFloor: preProfile.collaborationFloor,
    intelligenceCeiling: preProfile.collaborationCeiling
,
    /* Increment 23 — deep thinking is the default; a deployment can turn it
       off with FBT_AI_DEEP_THINK=0 and get the pre-increment behaviour. */
    deepThink: String(process.env.FBT_AI_DEEP_THINK ?? '1') !== '0'
  });
  /* One resolution for the whole run. `analysis.intelligence.mode` is the mode
     the plan was built with; an explicit argument wins over it. */
  const resolvedIntelligence = resolveIntelligenceMode(intelligence ?? plan?.intelligence?.mode ?? null);
  const mode = resolvedIntelligence.mode;
  const modeProfile = getIntelligenceProfile(mode);
  /*
   * Multi-part questions get a checklist, not a second engine. The splitter is
   * deterministic and conservative: it only fires on structure the user typed
   * (numbering, newlines, semicolons, several question marks, «و همچنین»).
   * Only the smartest mode pays for it — `balanced` must stay byte-identical.
   */
  const subQuestions = mode === 'max' ? decomposeQuestion(message) : [];
  /*
   * ─── THE CHEAP PRE-GATE (2026-11-11) ────────────────────────────────────
   *
   * The full local-first gate needs the safety reads and the retrieved
   * knowledge. Those cost real CPU — about 90 ms of the `max` path's local
   * work — and they all ran BEFORE the gate, so a turn the corpus could
   * answer outright still paid for the whole reading layer first.
   *
   * The pre-gate asks ONE cheap question before any of that: is this turn
   * OBVIOUSLY not answerable locally? A live question, a judgement, a
   * multi-part question — all known from the text and the plan alone.
   *
   * It never answers a question. It only DECLINES, and a decline means the
   * expensive reads are skipped for a turn that was never going to be
   * answered locally.
   */
  const localFirstPre = preEvaluateLocalFirst({ message, plan });
  /*
   * ─── ECONOMIST'S LENS (smartest mode, substantive turns only) ──────────────
   * A professor of economics reasons by mechanism, base rate, transmission,
   * incentives and falsifiability — not by narrating the last candle. The
   * lenses are selected deterministically from the question and the router's
   * task types, then appended to every specialist's system prompt. Small talk
   * never reaches level 4, so it never gets this.
   */
  const economistLenses = mode === 'max' && plan.level >= 4
    ? selectEconomicLenses({ message, taskTypes: plan.taskTypes, intentType })
    : [];
  const economistLens = renderEconomistLens(economistLenses);
  /*
   * ─── SOCIAL READ (smartest mode, every substantive turn) ───────────────────
   * Register, tone, the need behind the literal question and how much the
   * message leaves unsaid. The brief tells the specialists how to answer this
   * PERSON; an unremarkable question renders nothing and keeps its prompt.
   */
  const socialRead = mode === 'max' && plan.level >= 2
    ? readSocialContext({ message, locale, history: context?.conversationSummary || '' })
    : null;
  const socialBrief = renderSocialBrief(socialRead);
  /*
   * ─── EMOTION (smartest mode) ───────────────────────────────────────────────
   * `socialRead` gives one label; a person can be grieving AND ashamed AND
   * hopeful at once, and the obligations differ. This reads the emotion on
   * three axes (valence, arousal, dominance), separates self-directed shame
   * from anger at the platform, and says what the answer owes — an
   * acknowledgement, containment, or nothing but the facts. Empty for a
   * neutral message, so an ordinary question keeps its prompt.
   */
  const emotionRead = mode === 'max'
    ? readEmotion({ message, locale, history: context?.conversationSummary || '', social: socialRead })
    : null;
  const emotionBrief = renderEmpathyContract(emotionRead);
  /*
   * ─── SITUATION (smartest mode) ─────────────────────────────────────────────
   * Down 18% and panicking is a different conversation from up 30% and
   * euphoric, and both are different from a portfolio the turn never read. The
   * read joins the aggregate portfolio numbers with the emotion read and says
   * what the answer owes — and what it may never claim (a P&L the turn does
   * not hold, a recovery, more risk after a loss).
   */
  const situationRead = mode === 'max'
    ? readSituation({ context, emotion: emotionRead, social: socialRead, message, locale })
    : null;
  const situationBrief = renderSituationContract(situationRead);
  /*
   * ─── DISCOURSE (smartest mode) ─────────────────────────────────────────────
   * Kind message, kind answer; an order answered in orders; swearing at the
   * situation may be matched at the SAME level once — never above, never a
   * slur, never back at the user; swearing AT the assistant is not mirrored at
   * all. When nothing readable is present the renderer returns '' and the
   * answer stays normal, which is the fallback.
   */
  const discourseRead = mode === 'max'
    ? readDiscourse({ message, locale, social: socialRead, emotion: emotionRead })
    : null;
  const discourseBrief = renderDiscourseContract(discourseRead);
  /*
   * ─── PARTIAL INPUT (every mode) ────────────────────────────────────────────
   * Most messages are not complete sentences. «بیتکوین؟»، «استراتژی من با
   * ۲۰۰۰۰»، «fovl» (typed on the wrong keyboard layout) — a layer that waits for
   * a well-formed question treats all of that as small talk, and one that
   * guesses silently answers a question nobody asked, with numbers nobody gave.
   * So the read runs in EVERY mode (it costs no model call), names the
   * assumption, and allows exactly one question. When the message is complete,
   * the brief is '' and every earlier prompt stays byte-identical.
   */
  const partialRead = readPartialInput({
    message,
    locale,
    context: context || {},
    priorIntent: intentType || plan?.intentType || null
  });
  const partialBrief = renderPartialContract(partialRead);
  /*
   * ─── PRODUCT BRAIN (smartest mode) ─────────────────────────────────────────
   * «FBT چیه؟»، «این صفحه چیکار می‌کنه؟»، «کارمزد چقدره؟»، «سازنده‌هاش کی هستن؟»
   * are not market questions, so no amount of market reasoning answers them —
   * and a model answering from memory invents a founder, a fee or a page. The
   * brain reads the router, the verified knowledge and the real fee, then hands
   * the facts over as the source of truth (with the gaps named out loud).
   */
  const productQuestion = mode === 'max' && detectProductQuestion(message);
  const productRead = productQuestion ? answerProduct({ message, locale }) : null;
  const productBrief = renderProductBrief(productRead);
  /*
   * ─── DIALOGUE READ (smartest mode) ─────────────────────────────────────────
   * The social read says WHO is asking; this says WHAT the turn is doing —
   * a correction, an elliptical follow-up, or a question whose shape (why /
   * how much / which) the answer must match. A distress turn is exempt: it is
   * not a question to be shaped, and the safety brief already governs it.
   */
  const dialogueRead = mode === 'max' && plan.level >= 2 && !socialRead?.distress
    ? readDialogue({ message, locale, history: context?.conversationSummary || '', social: socialRead })
    : null;
  const dialogueBrief = renderDialogueBrief(dialogueRead);
  /*
   * ─── REQUEST PLAN (smartest mode, substantive turns) ───────────────────────
   * socialRead reads the person, dialogueRead reads the question. This one asks
   * the question a reviewer of answers has to ask: what is the user holding
   * when this ends — a verdict, a number, a plan with weights? Which facts does
   * that deliverable require, and did they give them, or is the answer about to
   * invent a budget nobody mentioned? The plan is deterministic and costs no
   * model call; the reviewer is told afterwards which promise the draft broke.
   * A distress turn is exempt: the safety brief already governs it.
   */
  const requestPlan = mode === 'max' && plan.level >= 3 && !socialRead?.distress
    ? analyzeRequest({
      message,
      locale,
      context,
      history: context?.conversationSummary || '',
      social: socialRead,
      dialogue: dialogueRead
    })
    : null;
  const requestBrief = renderRequestPlan(requestPlan);
  /*
   * ─── RESEARCH POSTURE (smartest mode, substantive turns) ───────────────────
   * A professor of this field defines terms, says where every number came from,
   * gives the base rate, and — enforced below, not merely requested — states what
   * would prove the reading wrong. Small talk never reaches level 4.
   */
  const professorLenses = mode === 'max' && plan.level >= 4
    ? selectProfessorLenses({ message, taskTypes: plan.taskTypes })
    : [];
  const professorBrief = renderProfessorContract(professorLenses);
  /*
   * ─── RESEARCH AGENDA (smartest mode) ───────────────────────────────────────
   * Every deep turn already knows what it could not establish; until now that
   * knowledge died with the turn. The agenda keeps it per owner, puts the
   * relevant open questions in front of this turn's models, and records what
   * this turn opened and closed. A store is optional: without one it is inert.
   */
  const researchSession = mode === 'max' && plan.level >= 4
    ? createResearchAgenda({
      load: D.researchLoad || ((ownerKey) => storeGet(`ai:research-agenda:v1:${ownerKey || 'anon'}`, [])),
      save: D.researchSave || ((ownerKey, items) => storeSet(`ai:research-agenda:v1:${ownerKey || 'anon'}`, items))
    })
    : null;
  const priorAgenda = researchSession?.enabled
    ? await withDeadline(researchSession.read(owner), [], 400)
    : [];
  const briefedItems = researchSession?.enabled ? selectAgendaItems(priorAgenda, message, { limit: 3 }) : [];
  const researchBrief = researchSession?.enabled ? researchSession.brief(priorAgenda, message, { limit: 3, locale }) : '';
  /*
   * ─── STRATEGY FRAME + RUBRIC (smartest mode, strategy turns) ───────────────
   * A plan may stand on the user's real capital, their actual weights, the
   * platform fee and the policy caps — and on nothing else. Everything the
   * frame could not read is named as a gap instead of being invented. The
   * rubric tells the model, before it writes, which sections a strategy answer
   * must contain; the reviewer is told afterwards which ones are missing.
   */
  const isStrategyTurn = mode === 'max'
    && ((Array.isArray(plan.taskTypes) && plan.taskTypes.includes('strategy')) || detectStrategyRequest(message));
  const strategyFrame = mode === 'max' && isStrategyTurn
    ? buildStrategyFrame({ context, message })
    : null;
  const strategyBrief = strategyFrame
    ? `${renderStrategyFrame(strategyFrame)}\n${renderStrategyRubricContract()}`
    : '';
  /* Role budgets follow the mode: `max` gives an analysis room for its
     reasoning and its answer instead of a single paragraph. Latency-bound
     conversation roles are exempt (see intelligenceGeneration). */
  const tokensFor = (base, taskType = 'reasoning') =>
    intelligenceGeneration(mode, { maxTokens: base, temperature: 0.3, taskType }).maxTokens;
  /* Evidence depth follows the mode: the smartest seat gets more verified
     product facts to reason over (and to be checked against later). */
  const knowledgeTopK = Math.max(3, Math.min(10, Number(modeProfile.knowledgeTopK) || 4));
  const isFa = String(locale || 'fa').startsWith('fa');
  const externalConfigured = Boolean(D.selectProviders) || getActiveProviderIds().some((id) => id !== 'internal');

  const result = {
    ok: true,
    schema: COLLABORATION_SCHEMA,
    version: COLLABORATION_VERSION,
    level: plan.level,
    intelligence: {
      mode,
      source: resolvedIntelligence.source,
      requested: resolvedIntelligence.requested,
      rejected: resolvedIntelligence.rejected,
      reasoning: Boolean(modeProfile.reasoning),
      plan: plan.intelligence || null
    },
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
    /* null = the mode did not run a review. An object says whether one ran, on
       which seat, and whether its repair was used. */
    critique: null,
    /* Multi-part questions only (smartest mode). null = one question, nothing
       to check — the same shape the reply had before this existed. */
    subQuestions: null,
    /* The deterministic unsourced-number report for this draft. null when the
       mode ran no audit (swift/balanced) — those turns cannot have changed. */
    numericAudit: null,
    /* What the specialists actually asserted, classified before synthesis:
       tool/web-verified, model-consensus-only, and conflicting figures. null
       outside the smartest mode. */
    synthesisLedger: null,
    /* The dissenting seat (smartest mode): which role was asked to argue
       against the obvious reading, and whether it answered. */
    counterCase: null,
    /* The reasoning persona used for this turn (smartest mode): which
       economist lenses the specialists were held to. null otherwise. */
    persona: economistPersona(economistLenses),
    /* The social read of the message (smartest mode): register, tone, the need
       behind the words, and how much was left unsaid. null otherwise. */
    socialRead,
    /* What the turn is DOING (smartest mode): the speech act (correction,
       follow-up, question), the ask shape, and whether the final answer matched
       it. null outside the smartest mode. */
    dialogue: null,
    /* The research posture of this turn: which pedagogy lenses the specialists
       were held to, and whether the final text carries a falsifier. */
    professor: null,
    /* The market frame the analysis stood on: what the data measured, what it
       could not, and whether the final text respected that line. */
    market: null,
    /* How the user is talking (warm, commanding, charged, playful) and whether
       the final text stayed inside that register. null outside max. */
    discourse: null,
    /* The user's money and mood read together, and whether the final text
       respected that. null outside max. */
    situation: null,
    /* What FBT itself is, which pages exist and what the verified product
       knowledge does NOT contain, plus whether the final text stayed inside it.
       Set only on turns that ask about the product. null otherwise. */
    product: null,
    /* What an incomplete message probably meant, what was assumed, and whether
       the final text named the assumption and kept to one question. */
    partial: null,
    /* The emotional state the answer was written for, and whether the final
       text respected it. null outside max, or for a neutral message. */
    emotion: null,
    /* What this turn understood the request to BE: the deliverable, the
       constraints the user actually gave, the slots they did not, and whether
       the final text kept the plan's promises. */
    request: null,
    /* The continuous-improvement loop: which open questions this turn was given,
       which it opened, and which it closed. null when no agenda store is live. */
    research: null,
    /* Strategy turns in the smartest mode: the computed frame the plan stood on
       and the rubric result for the final answer. null otherwise. */
    strategy: null,
    /* The decision verdict for the turn: whether it asked for a decision, the
       evidence level, what that permits, and whether the answer obeyed. */
    decision: null,
    perRole: transparency ? [] : undefined,
    /* The local-first gate's verdict for this turn: did it answer from the
       verified corpus (and so spend zero provider calls), or did it stand
       aside and let the model pipeline run? null before the gate runs. */
    localFirst: null,
    latencyMs: 0,
    at: Date.now()
  };

  /* ---- Evidence first: knowledge + web + tools (levels 2+) ---- */
  let knowledge = [];
  if (plan.level >= 2 && plan.freshness === 'STATIC') {
    /*
     * The HYBRID retriever (§7): the semantic layer widens the candidate
     * pool and the lexical scorer ranks it.
     *
     * Before this, the corpus was reachable only through the words the
     * question used. Measured over 18 questions whose correct answer is
     * known, the lexical-only retriever put the right item first 11 times;
     * the hybrid puts it first 17. The six it fixes are exactly the
     * paraphrases — "how do I attach my wallet", "what does it cost me",
     * "building a balanced basket" — where the question never uses the
     * corpus's vocabulary.
     *
     * The hybrid degrades safely: if the semantic index cannot be built the
     * lexical result is used unchanged, so this can never make grounding
     * worse than it was.
     */
    knowledge = hybridKnowledgeSearch(message, {
      locale,
      limit: 3,
      lexicalSearch: searchKnowledge
    });
    if (!Array.isArray(knowledge) || !knowledge.length) {
      knowledge = searchKnowledge(message, { locale, limit: 3 });
    }
    /* BM25 retrieval over knowledge + the hand-checked Help answers fills
       the remaining slots (never displaces the knowledge-center hits the
       degraded answer is built from). Passages carry citable ids. */
    try {
      const seen = new Set(knowledge.map((k) => k.id));
      for (const p of retrieveBm25(message, { locale, limit: knowledgeTopK })) {
        if (knowledge.length >= knowledgeTopK) break;
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

  /*
   * ─── DECISION GATE (smartest mode, before anyone writes) ───────────────────
   * Is this a decision question, and how much evidence does the turn actually
   * hold? The specialists are told what the evidence level permits BEFORE they
   * write; the Reviewer is told afterwards if the draft ignored it.
   */
  const decisionEvidence = mode === 'max'
    ? assessEvidence({ context, sources: result.sources, knowledge })
    : null;
  const decisionBrief = decisionEvidence
    ? renderDecisionContract({ message, evidence: decisionEvidence })
    : '';

  const subQuestionChecklist = renderSubQuestionChecklist(subQuestions, locale);
  const baseContextBlock = buildSafeContextBlock({ context, knowledge, sources: result.sources, knowledgeLimit: knowledgeTopK });
  const contextBlock = subQuestionChecklist
    ? `${baseContextBlock}\n\n${subQuestionChecklist}`
    : baseContextBlock;

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

  /*
   * ─── MARKET FRAME (smartest mode, market-analysis turns) ───────────────────
   * What this turn's data actually measures — instruments, breadth, dispersion,
   * regime, relative strength — and, just as important, what it cannot carry
   * (no OHLC series, no depth, no funding). The answer may not use an indicator
   * whose input is absent, and may not carry a three-month target on a 24h
   * print without marking it a scenario.
   */
  /* Level 3+ only: a level-2 turn is one model with no brief slots, and holding
     a draft to a contract it never received would be an unfair check. */
  const isMarketTurn = mode === 'max' && plan.level >= 3 && detectMarketAnalysis(message, plan.taskTypes);
  const marketFrame = isMarketTurn ? buildMarketFrame({ context, message, knowledge }) : null;
  const marketBrief = marketFrame
    ? `${renderMarketFrame(marketFrame)}\n${renderMarketContract(marketFrame)}`
    : '';

  /*
   * ─── THE CORTEX READ (lever #5) ────────────────────────────────────────────
   * The cortex is a trained spiking reservoir that reads the SHAPE of the
   * market state. It is a second opinion, not evidence: it carries no prices
   * and it is never allowed to contradict the data.
   *
   * The read is derived from the SAME market frame the specialists are given,
   * so it is not a separate fetch and not a separate world — it is another
   * reading of the data already on the table.
   *
   * The block is EMPTY unless the cortex's own probe passes. That gate is
   * the whole point of wiring it this way: a cortex that cannot separate a
   * state from its mirror contributes nothing, so it cannot make the answer
   * wrong.
   */
  const cortexState = marketFrame ? marketStateFromFrame(marketFrame) : null;
  const cortexBlock = cortexState ? renderCortexBlock({ state: cortexState }) : '';
  const cortexRead = cortexState ? cortexReadPayload({ state: cortexState }) : null;
  let degradedSafetyContainment = false;
  const applyDegraded = () => {
    const out = buildDegradedOutcome({
      message,
      analysis: plan,
      context,
      knowledge,
      sources: result.sources,
      locale,
      subQuestions,
      economistLenses,
      professorLenses,
      socialRead,
      emotionRead,
      situationRead,
      discourseRead,
      dialogueRead,
      marketFrame,
      strategyFrame,
      decisionEvidence,
      partialRead,
      productRead
    });
    result.answer = out.answer;
    result.degraded = true;
    if (out.knowledgeUsed) result.evidence.knowledgeUsed = true;
    if (out.internalSynthesis) result.evidence.internalSynthesis = true;
    if (out.safetyContainment) degradedSafetyContainment = true;
  };
  const isDistressTurn = Boolean(
    socialRead?.distress
    || /(?:خیلی\s*)?ضرر\s*کردم.{0,40}(?:حالم\s*بد|ناراحتم|ترسیدم)|(?:همشو|همه‌شو|همه\s*چیمو|همه\s*پولمو)\s*بفروشم/i.test(String(message || ''))
    || (emotionRead?.acute && ['grief', 'shame', 'burnout'].includes(emotionRead.primary) && Number(emotionRead.intensity) >= 0.7)
  );
  /*
   * ─── THE LOCAL-FIRST GATE (2026-11-11) ──────────────────────────────────
   *
   * A `max` turn costs SIX provider calls. Most of them are spent
   * re-deriving what this repository already states. The gate asks once,
   * BEFORE the first call, whether the verified corpus can answer the
   * question outright; if it can, the answer is retrieved instead of
   * generated.
   *
   * This is not only a budget saver — it is a QUALITY saver. A retrieved
   * fact carries its citation and cannot drift; a generated one can. And
   * the gate is conservative by construction: it declines on live
   * questions, on weak matches, and whenever the local reasoner itself
   * declines. When it declines, the turn is exactly what it was before.
   */
  const localFirst = evaluateLocalFirst({
    message,
    plan,
    knowledge,
    locale,
    context,
    /* The REAL safety reads, so the reasoner's containment contract fires
       on the local path exactly as it does on the model path. */
    socialRead,
    emotionRead
  });
  result.localFirst = {
    used: localFirst.used,
    reason: localFirst.reason,
    matched: localFirst.evidence?.matched || null,
    score: localFirst.evidence?.score || 0,
    providerCallsSaved: localFirst.used ? 6 : 0,
    /* The pre-gate's independent verdict, so a turn's routing is auditable:
       "the gate declined because X" and "the pre-gate had already said Y"
       are different facts and both are worth seeing. */
    preGate: { reason: localFirstPre.reason, skippedFor: localFirstPre.evidence?.skippedFor || null }
  };
  if (localFirst.used) {
    result.answer = localFirst.answer;
    result.degraded = false;
    result.evidence.knowledgeUsed = true;
    result.evidence.internalSynthesis = true;
    result.providersUsed = [];
    result.modelsConsulted = [];
    result.aiConsensusOnly = false;
    result.uncertainty = '';
    result.analyses = [];
    result.verification = null;
    result.critique = null;
    result.counterCase = null;
    result.latencyMs = Date.now() - startedAt;
    result.at = Date.now();
    return result;
  }

  if (plan.level === 1 || !externalConfigured) {
    /*
     * A short message that discloses a state («ناراحتم», «خسته شدم») is not a
     * shrug. In the smartest mode it gets one real, careful reply instead of
     * the canned small-talk line — with the emotion contract attached, so it
     * acknowledges without advising and without a pep talk. Greetings, thanks
     * and ordinary small talk stay on the free path.
     */
    const disclosing = mode === 'max' && externalConfigured && emotionBrief
      && ['grief', 'shame', 'fear', 'burnout', 'loneliness'].includes(emotionRead?.primary)
      && Number(emotionRead?.intensity) >= 0.4
      && plan.conversationKind === CONVERSATION_KINDS.CASUAL;
    if (disclosing) {
      const single = await withDeadline(runRole({
        turnBudget,
        role: AI_ROLES.CONVERSATION_AI,
        message,
        contextBlock,
        locale,
        deps: D,
        maxTokens: tokensFor(300, 'fast'),
        fleet,
        seat: 0,
        intelligence: mode,
        emotionBrief,
        situationBrief
      }), null);
      if (single?.ok) {
        analyses.push(single);
        result.answer = single.answer;
      } else {
        result.answer = naturalConversationReply(plan.conversationKind, isFa, { locale, social: plan.social }) || result.answer || '';
        result.degraded = true;
      }
    } else if (!isDistressTurn && (plan.conversationKind === CONVERSATION_KINDS.GREETING || plan.conversationKind === CONVERSATION_KINDS.THANKS || plan.conversationKind === CONVERSATION_KINDS.CASUAL)) {
      const socialLine = naturalConversationReply(plan.conversationKind, isFa, { locale, social: plan.social });
      result.answer = socialLine || result.answer || '';
      result.degraded = !externalConfigured && plan.level > 1;
    } else if (!externalConfigured) {
      applyDegraded();
    } else {
      const single = await withDeadline(runRole({ role: AI_ROLES.CONVERSATION_AI, message, contextBlock, locale, deps: D, maxTokens: tokensFor(400, 'fast'), fleet, seat: 0, intelligence: mode, turnBudget }), null);
      if (single?.ok) {
        analyses.push(single);
        result.answer = single.answer;
      } else {
        applyDegraded();
      }
    }
  } else if (plan.level === 2) {
    const role = plan.taskTypes.includes('market') ? AI_ROLES.MARKET_AI
      : plan.taskTypes.includes('crypto-analysis') || plan.taskTypes.includes('research') ? AI_ROLES.CRYPTO_RESEARCH_AI
      : plan.taskTypes.includes('risk') ? AI_ROLES.RISK_AI
      : AI_ROLES.CRYPTO_RESEARCH_AI;
    const single = await withDeadline(runRole({ role, message, contextBlock, locale, deps: D, maxTokens: tokensFor(600), fleet, seat: 0, intelligence: mode, emotionBrief, situationBrief, discourseBrief, productBrief, partialBrief, turnBudget }), null);
    if (single?.ok) { analyses.push(single); result.answer = single.answer; }
    else { applyDegraded(); }
  } else if (plan.level === 3) {
    /* Two independent models + tools (+web when live). Each role takes a
       different seat of the shared fleet (seat = role index), so the two
       analyses are genuinely different providers, not one model twice. */
    const roles = pickAnalysisRoles(plan, 2);
    const settled = await withDeadline(
      Promise.all(roles.map((r, i) => runRole({ role: r, message, contextBlock, locale, deps: D, maxTokens: tokensFor(600), fleet, seat: i, intelligence: mode, socialBrief, strategyBrief, decisionBrief, dialogueBrief, professorBrief, researchBrief, marketBrief, requestBrief, emotionBrief, situationBrief, discourseBrief, productBrief, partialBrief, turnBudget }))),
      []
    );
    analyses.push(...(settled || []).filter(Boolean));
    const valid = analyses.filter((a) => a.ok);
    if (valid.length) result.answer = mergeTwoAnswers(valid, isFa);
    else applyDegraded();
  } else {
    /* Levels 4-5: multi-model debate + web + verification (§10, §20). Roles
       take distinct seats of the shared fleet (seat = role index); the
       verifier and the final-answer synthesiser continue the rotation so a
       high-stakes question walks several different providers end to end. */
    /*
     * Independent analyses: the historical rule is 2 at level 4 and 3 at
     * level 5. The smartest mode asks for 3 at level 4 too — three independent
     * reads are what later disagreement and the critique step have to work
     * with. It never exceeds the number of distinct analytical roles.
     */
    const baseAnalyses = plan.level >= 5 ? 3 : 2;
    const wantedAnalyses = Math.max(baseAnalyses, Math.min(5, Number(modeProfile.analysesCount) || baseAnalyses));
    const roles = pickAnalysisRoles(plan, wantedAnalyses, wantedAnalyses);
    const settled = await withDeadline(
      Promise.all(roles.map((r, i) => runRole({
        turnBudget,
        role: r,
        message,
        contextBlock,
        locale,
        deps: D,
        maxTokens: tokensFor(600),
        fleet,
        seat: i,
        intelligence: mode,
        economistLens,
        socialBrief,
        strategyBrief,
        decisionBrief,
        dialogueBrief,
        professorBrief,
        researchBrief,
        marketBrief,
        requestBrief,
        emotionBrief,
        situationBrief,
        discourseBrief,
        productBrief,
        partialBrief,
        /* The last analytical seat is the dissenting one, and only in the
           smartest mode: one of the three reads must be trying to break the
           other two, not agreeing with them. */
        counterCase: modeProfile.selfCritique && i === roles.length - 1
      }))),
      []
    );
    analyses.push(...(settled || []).filter(Boolean));
    if (modeProfile.selfCritique && roles.length) {
      const dissenting = analyses.find((a) => a.ok && a.role === roles[roles.length - 1]);
      result.counterCase = {
        role: roles[roles.length - 1],
        answered: Boolean(dissenting),
        provider: dissenting?.provider || null
      };
    }

    const valid = analyses.filter((a) => a.ok);
    /*
     * The verifier is a REFINEMENT: the analyses are already in hand,
     * and the cross-examination improves them but does not create them.
     * So when the call cap is spent the verifier is what goes, and the
     * turn says so rather than silently answering less.
     */
    const verificationSkippedForBudget = valid.length >= 2 && !canAffordVerification();
    if (verificationSkippedForBudget) {
      result.budget = {
        ...(result.budget || {}),
        verifierSkipped: 'provider call cap reached — the turn answered from its own analyses'
      };
    }
    if (valid.length >= 2 && !overBudget() && !verificationSkippedForBudget) {
      /* Cross-examination: the verification role sees the other analyses. */
      const digest = valid.map((a) => `[${a.role}] ${String(a.answer).slice(0, 400)}`).join('\n\n');
      const verifier = await withDeadline(runRole({
        turnBudget,
        role: AI_ROLES.VERIFICATION_AI,
        message: `${message}\n\nCANDIDATE ANALYSES TO CHALLENGE:\n${digest}`,
        contextBlock,
        locale,
        deps: D,
        fleet,
        seat: roles.length,
        maxTokens: tokensFor(600),
        intelligence: mode,
        economistLens,
        socialBrief,
        strategyBrief,
        decisionBrief,
        dialogueBrief,
        professorBrief,
        researchBrief,
        marketBrief,
        requestBrief,
        emotionBrief,
        situationBrief,
        discourseBrief,
        productBrief,
        partialBrief
      }), null);
      if (verifier?.ok) analyses.push(verifier);
    }

    const validFinal = analyses.filter((a) => a.ok && a.role !== AI_ROLES.VERIFICATION_AI);
    if (validFinal.length) {
      /*
       * ─── CLAIM LEDGER (smartest mode, before synthesis) ─────────────────────
       * The synthesiser used to write before verification ran, so a claim backed
       * by live tool data and a claim three models merely repeated reached it as
       * identical prose. The ledger classifies the analysts' factual claims
       * deterministically and names every subject on which two analysts quote
       * different figures, so the final answer can resolve instead of average.
       */
      let claimLedgerBlock = '';
      if (modeProfile.selfCritique) {
        const preAnalytical = analyses.filter((a) => a.ok && a.answer && a.role !== AI_ROLES.VERIFICATION_AI);
        const preComparison = compareAnalyses(preAnalytical);
        const preVerification = verifyClaims({ factualClaims: preComparison.factualClaims, context, sources: result.sources });
        result.synthesisLedger = buildClaimLedger({
          verified: preVerification.verified,
          consensusOnly: preVerification.aiConsensusOnly,
          factualClaims: preComparison.factualClaims,
          context
        });
        claimLedgerBlock = renderClaimLedger(result.synthesisLedger);
      }
      /* Deep analyses must not be cut to a soundbite before synthesis: at max
         the digest keeps more of each answer; other modes keep the historical
         budget byte for byte. */
      const digestCap = modeProfile.selfCritique ? 800 : 500;
      /* Stage 6: one clean FBT answer from the specialists' work (§37). */
      const digest = analyses.filter((a) => a.ok).map((a) => `[${a.role}] ${String(a.answer).slice(0, digestCap)}`).join('\n\n');

      /*
       * ─── THE REASONING LEDGER (§8 — LEVER #4) ─────────────────────────────
       * The digest carries the specialists' CONCLUSIONS. The ledger carries
       * their PATHS — the deciding facts and the inference from them.
       *
       * Why the synthesiser needs both: two analysts that reached the same
       * answer by different routes are corroborating each other; two that
       * reached it the same way are one opinion paid for twice. From the
       * conclusions alone the synthesiser cannot tell those apart, so it
       * averages them as if they agreed independently.
       *
       * And the ledger carries the CHECK: a conclusion that does not carry
       * the facts its own reasoning named is flagged, and the synthesiser is
       * told not to launder it.
       */
      const reasoningLedger = buildReasoningLedger(analyses);
      result.reasoningLedger = reasoningLedgerSummary(reasoningLedger);
      /* Recorded for the status endpoint, so the layer is observable. */
      recordReasoningLedger(reasoningLedger);
      const reasoningBlock = modeProfile.selfCritique
        ? renderReasoningLedger(reasoningLedger)
        : '';
      /*
       * The verifier's findings used to be just another paragraph in the
       * digest. In the smartest mode the synthesiser is told to RESOLVE them:
       * drop or qualify every claim the evidence does not support, and say
       * which evidence wins when two analyses disagree. That is the difference
       * between "we asked a verifier" and "the answer was verified".
       */
      const verifierFinding = analyses.find((a) => a.ok && a.role === AI_ROLES.VERIFICATION_AI);
      const verifierNote = verifierFinding
        ? `\n\nVERIFIER FINDINGS (resolve every point; remove or qualify anything it flags as unsupported):\n${String(verifierFinding.answer).slice(0, 900)}`
        : '';
      const revisionRule = modeProfile.selfCritique
        ? '\n\nHARD RULE: do not introduce a number, price, date or percentage that is absent from the data above. If two analyses disagree, state which evidence wins and what remains unknown.'
        : '';
      const finalRole = await withDeadline(runRole({
        turnBudget,
        role: AI_ROLES.FINAL_ANSWER_AI,
        /* The paths ride along with the conclusions. */
        message: `${message}\n\nSPECIALIST WORK:\n${digest}${reasoningBlock ? `\n\n${reasoningBlock}` : ''}${claimLedgerBlock ? `\n\n${claimLedgerBlock}` : ''}${cortexBlock ? `\n\n${cortexBlock}` : ''}${verifierNote}${revisionRule}`,
        contextBlock,
        locale,
        deps: D,
        fleet,
        seat: roles.length + 1,
        maxTokens: tokensFor(800),
        intelligence: mode,
        economistLens,
        socialBrief,
        strategyBrief,
        decisionBrief,
        dialogueBrief,
        professorBrief,
        researchBrief,
        marketBrief,
        requestBrief,
        emotionBrief,
        situationBrief,
        discourseBrief,
        productBrief,
        partialBrief
      }), null);
      result.answer = finalRole?.ok
        ? finalRole.answer
        : mergeTwoAnswers(validFinal, isFa);
      if (finalRole?.ok) analyses.push(finalRole);

      /*
       * ─── STRATEGY RUBRIC ON THE DRAFT ──────────────────────────────────────
       * The model was told the eight sections before writing; this records which
       * ones the draft actually contains and hands the missing ones to the
       * reviewer below. Completeness only — it does not claim the plan is good.
       */
      if (strategyFrame) {
        result.strategy = {
          frame: strategyFrame,
          rubric: checkStrategyRubric(result.answer)
        };
      }
      /*
       * Arithmetic is separate from completeness: the draft can have all eight
       * sections and still contradict itself (allocations over 100%, a long
       * whose stop is above the entry, a position bigger than the capital).
       * The reviewer below receives every violation as MUST-FIX; the reply
       * re-checks the FINAL text.
       */
      const draftArithmetic = strategyFrame ? checkPlanArithmetic(result.answer, strategyFrame) : null;
      /*
       * ─── DIALOGUE COMPLIANCE ON THE DRAFT ─────────────────────────────────
       * Did the draft answer the question that was asked? A corrected claim
       * that is restated, a follow-up answered as a new topic, a «چرا» answered
       * with a checklist, a «چقدر» answered with «بستگی دارد» — each is handed
       * to the reviewer as a MUST-FIX. The final text is re-checked below.
       */
      const draftDialogue = dialogueRead
        ? checkDialogueCompliance({ read: dialogueRead, answer: result.answer })
        : null;
      /*
       * ─── FALSIFIER ON THE DRAFT ────────────────────────────────────────────
       * A forecast without a disconfirming condition is the one thing a
       * researcher never ships. Deterministic: prediction markers in the text,
       * falsifier markers absent → MUST-FIX for the reviewer.
       */
      const draftFalsifier = professorBrief ? checkFalsifier({ message, answer: result.answer }) : null;
      /*
       * ─── MARKET FRAME ON THE DRAFT ─────────────────────────────────────────
       * RSI/trendline on a turn with no OHLC series, or a three-month target on
       * a 24h print, is the classic market answer that sounds expert and is
       * unfalsifiable. The reviewer gets each as a MUST-FIX.
       */
      const draftMarket = marketFrame ? checkMarketAnalysis({ frame: marketFrame, answer: result.answer }) : null;
      const draftRequest = requestPlan ? checkRequestPlan({ plan: requestPlan, answer: result.answer }) : null;
      const draftEmotion = emotionRead ? checkEmotionTone({ read: emotionRead, answer: result.answer }) : null;
      const draftSituation = situationRead ? checkSituationResponse({ situation: situationRead, answer: result.answer }) : null;
      const draftDiscourse = discourseRead ? checkDiscourseMirror({ discourse: discourseRead, answer: result.answer }) : null;
      const draftProduct = productRead ? checkProductAnswer({ product: productRead, answer: result.answer }) : null;
      const draftPartial = checkPartialAnswer({ read: partialRead, answer: result.answer });
      /*
       * ─── DECISION VERDICT ON THE DRAFT ─────────────────────────────────────
       * Re-score the evidence now that the analyses, the verifier and the claim
       * ledger exist, then ask the one question that matters: did the draft
       * issue a directional instruction this evidence cannot support?
       */
      if (decisionEvidence) {
        const comparisonForDecision = compareAnalyses(analyses.filter((a) => a.ok
          && a.role !== AI_ROLES.VERIFICATION_AI && a.role !== 'critique'));
        const finalEvidence = assessEvidence({
          context,
          sources: result.sources,
          knowledge,
          comparison: comparisonForDecision,
          ledger: result.synthesisLedger
        });
        const gate = evaluateDecision({ message, evidence: finalEvidence, answer: result.answer });
        /* A non-decision turn is not published as a verdict at all. */
        result.decision = gate.applicable ? gate : null;
      }

      /*
       * ─── NUMERIC EVIDENCE AUDIT (deterministic, no extra call) ─────────────
       * Every meaningful number in the draft is checked against the evidence
       * the draft was allowed to use: live context, verified knowledge, cited
       * sources, and the analysts' own work. The synthesiser AND the verifier
       * are deliberately excluded from the corpus — otherwise the draft (or a
       * reviewer's aside) would source itself and the audit would always be
       * clean. The report never edits the text: the draft's findings go to the
       * reviewer below, and the FINAL text is re-audited for the reply.
       */
      const evidenceCorpus = () => buildEvidenceCorpus({
        context,
        knowledge,
        sources: result.sources,
        analyses: analyses.filter((a) => a.ok
          && a.role !== AI_ROLES.FINAL_ANSWER_AI
          && a.role !== AI_ROLES.VERIFICATION_AI
          && a.role !== 'critique')
      });
      const draftAudit = modeProfile.selfCritique && !result.degraded
        ? auditNumbers(result.answer, evidenceCorpus())
        : null;

      /*
       * ─── ADVERSARIAL SELF-REVIEW (smartest mode) ───────────────────────────
       * One bounded extra call, on a DIFFERENT seat, that receives the draft
       * and the same evidence block and returns a repaired answer. It is
       * allowed to replace the draft only when the repair is substantial
       * (≥60% of the draft's length, or the draft was a two-liner). A review
       * that times out, refuses, or returns a stub leaves the draft standing:
       * this step can only improve an answer, never delete one.
       */
      if (modeProfile.selfCritique && !result.degraded) {
        const draft = String(result.answer || '').trim();
        const remaining = deadlineMs - (Date.now() - startedAt);
        /*
         * The critic is the LAST stage and the most optional one: it
         * improves a draft that already exists and can never create the
         * answer. So when the call cap is spent it is the critic that is
         * dropped, and the turn says that it happened rather than
         * pretending the draft was always this good.
         */
        const critiqueSkippedForBudget = !canAffordRefinement();
        if (critiqueSkippedForBudget) {
          result.budget = {
            ...(result.budget || {}),
            criticSkipped: 'provider call cap reached — the draft was not put through a repair pass'
          };
        }
        if (draft.length >= 80 && remaining > 2500 && !critiqueSkippedForBudget) {
          const critiqueBudget = Math.min(7000, remaining - 800);
          /*
           * Deterministic completeness check on the draft: a part the draft
           * never touches is handed to the reviewer by name, so "the answer
           * dropped half the question" is caught without a second model call.
           */
          const draftCoverage = subQuestions.length >= 2
            ? assessQuestionCoverage(subQuestions, draft)
            : { covered: [], uncovered: [] };
          const unansweredBlock = renderUnansweredParts(draftCoverage.uncovered, locale);
          const unsourcedBlock = renderUnsourcedBlock(draftAudit);
          const strategyGapsBlock = renderStrategyGaps(result.strategy?.rubric);
          const strategyArithmeticBlock = renderStrategyViolations(draftArithmetic);
          const decisionDeficitBlock = renderDecisionDeficit(result.decision);
          const dialogueDeficitBlock = renderDialogueDeficit(draftDialogue);
          const falsifierDeficitBlock = renderFalsifierDeficit(draftFalsifier);
          const marketViolationBlock = renderMarketViolations(draftMarket);
          const requestDeficitBlock = renderRequestDeficit(draftRequest);
          const emotionDeficitBlock = renderEmotionDeficit(draftEmotion);
          const situationDeficitBlock = renderSituationDeficit(draftSituation);
          const discourseDeficitBlock = renderDiscourseDeficit(draftDiscourse);
          const productDeficitBlock = renderProductDeficit(draftProduct);
          const partialDeficitBlock = renderPartialDeficit(draftPartial);
          const criticRole = {
            role: AI_ROLES.VERIFICATION_AI,
            message: `USER QUESTION:\n${message}\n\nDRAFT ANSWER (what the user is about to read):\n${draft}\n\n${contextBlock}${cortexBlock ? `\n\n${cortexBlock}` : ''}${reasoningBlock ? `\n\n${reasoningBlock}` : ''}${claimLedgerBlock ? `\n\n${claimLedgerBlock}` : ''}${unsourcedBlock ? `\n\n${unsourcedBlock}` : ''}${unansweredBlock ? `\n\n${unansweredBlock}` : ''}${strategyGapsBlock ? `\n\n${strategyGapsBlock}` : ''}${strategyArithmeticBlock ? `\n\n${strategyArithmeticBlock}` : ''}${decisionDeficitBlock ? `\n\n${decisionDeficitBlock}` : ''}${dialogueDeficitBlock ? `\n\n${dialogueDeficitBlock}` : ''}${falsifierDeficitBlock ? `\n\n${falsifierDeficitBlock}` : ''}${marketViolationBlock ? `\n\n${marketViolationBlock}` : ''}${requestDeficitBlock ? `\n\n${requestDeficitBlock}` : ''}${emotionDeficitBlock ? `\n\n${emotionDeficitBlock}` : ''}${situationDeficitBlock ? `\n\n${situationDeficitBlock}` : ''}${discourseDeficitBlock ? `\n\n${discourseDeficitBlock}` : ''}${productDeficitBlock ? `\n\n${productDeficitBlock}` : ''}${partialDeficitBlock ? `\n\n${partialDeficitBlock}` : ''}`,
            contextBlock: '',
            locale,
            deps: D,
            fleet,
            seat: roles.length + 2,
            maxTokens: tokensFor(800),
            intelligence: mode,
            systemOverride: CRITIQUE_SYSTEM
          };
          const critic = await withDeadline(runRole({ ...criticRole, turnBudget }), null, critiqueBudget);
          const repaired = String(critic?.answer || '').trim();
          const substantial = repaired.length >= 40 && (
            draft.length < 200 ? repaired.length >= 40 : repaired.length >= Math.round(draft.length * 0.6)
          );
          const changed = critic?.ok && repaired && repaired !== draft;
          /*
           * ─── REPAIR ACCEPTANCE GATE (v2) ─────────────────────────────────
           * Length alone was a weak proxy for "better". Two deterministic
           * regressions are now refused:
           *   1. the repair ADDS a number no evidence can source (the reviewer
           *      may withdraw an invented figure, never introduce one);
           *   2. the repair DROPS a part of the question the draft answered.
           * A refused repair leaves the draft untouched, exactly like a crash.
           */
          const draftUncovered = new Set((draftAudit?.unsourced || []).map((n) => n.value));
          const repairedAudit = repaired ? auditNumbers(repaired, evidenceCorpus()) : null;
          /*
           * A strategy repair may legitimately move a stop or an entry: those
           * are plan parameters, not asserted market facts. Only in a strategy
           * turn are such levels exempt from the "new unsourced number" rule;
           * every other number still has to come from the evidence.
           */
          const introducedNumbers = (repairedAudit?.unsourced || [])
            .filter((n) => !draftUncovered.has(n.value))
            .filter((n) => !(strategyFrame && isPlanParameter(repaired, n.value)));
          const repairedCoverage = subQuestions.length >= 2 && repaired
            ? assessQuestionCoverage(subQuestions, repaired)
            : null;
          const lostCoverage = Boolean(repairedCoverage
            && repairedCoverage.uncovered.length > draftCoverage.uncovered.length);
          const safe = substantial && !introducedNumbers.length && !lostCoverage;
          if (changed && safe) {
            result.critique = {
              used: true,
              provider: critic.provider || null,
              model: critic.model || null,
              changed: true,
              issues: Array.isArray(critic.claims) ? critic.claims.slice(0, 4).map((c) => String(c.claim || '').slice(0, 200)) : [],
              draftLength: draft.length,
              repairedLength: repaired.length,
              reason: 'REPAIRED'
            };
            result.answer = repaired;
            /* Attribution only: an empty `answer` keeps the reviewer out of
               claim comparison (its "changes" are not market claims), while
               the model/provider still reach modelsConsulted/providersUsed. */
            analyses.push({ role: 'critique', provider: critic.provider || null, model: critic.model || null, answer: '', claims: [], ok: true });
          } else {
            result.critique = {
              used: false,
              provider: critic?.provider || null,
              model: critic?.model || null,
              changed: Boolean(changed),
              issues: Array.isArray(critic?.claims) ? critic.claims.slice(0, 4).map((c) => String(c.claim || '').slice(0, 200)) : [],
              draftLength: draft.length,
              repairedLength: repaired.length,
              /* Why a repair was not used, in order of severity. */
              reason: critic?.ok
                ? (introducedNumbers.length ? 'REPAIR_ADDED_UNSOURCED_NUMBER'
                  : lostCoverage ? 'REPAIR_LOST_COVERAGE'
                    : substantial ? 'UNCHANGED' : 'STUB_OR_TRUNCATED')
                : 'NO_CRITIC_ANSWER',
              rejectedNumbers: introducedNumbers.slice(0, 4).map((n) => n.value)
            };
          }
        } else {
          result.critique = { used: false, reason: draft.length < 80 ? 'DRAFT_TOO_SHORT' : 'OUT_OF_TIME' };
        }
      }
    } else {
      applyDegraded();
    }
  }

  /*
   * Publish the completeness result on the FINAL text the user reads (the
   * adversarial review may have repaired it). Deterministic keyword check:
   * it can only ever report a part as unanswered, never edit the answer.
   */
  /*
   * The audit published in the reply describes the text the user actually
   * reads — after the adversarial review had its chance to fix or withdraw a
   * figure. `collaboration.critique` says whether it had to.
   */
  if (modeProfile.selfCritique && !result.degraded) {
    result.numericAudit = auditNumbers(result.answer, buildEvidenceCorpus({
      context,
      knowledge,
      sources: result.sources,
      analyses: analyses.filter((a) => a.ok
        && a.role !== AI_ROLES.FINAL_ANSWER_AI
        && a.role !== AI_ROLES.VERIFICATION_AI
        && a.role !== 'critique')
    }));
  }

  /* The reviewer may have downgraded a recommendation: re-check the FINAL text. */
  if (result.decision?.applicable) {
    result.decision = evaluateDecision({
      message,
      evidence: result.decision.evidence,
      answer: result.answer
    });
  }

  /*
   * Re-check the dialogue contract on the FINAL text, and publish it: which act
   * the turn was, which shape the question had, and whether the answer the user
   * actually reads matched it.
   */
  if (dialogueRead) {
    const finalDialogue = checkDialogueCompliance({ read: dialogueRead, answer: result.answer });
    result.dialogue = {
      schema: dialogueRead.schema,
      act: dialogueRead.act,
      askShape: dialogueRead.askShape,
      applicable: finalDialogue.applicable,
      signals: dialogueRead.signals,
      referent: dialogueRead.referent?.resolvesTo || null,
      issues: finalDialogue.issues.map((i) => i.id),
      compliant: finalDialogue.compliant
    };
  }

  /*
   * Falsifier on the FINAL text (the reviewer may have added one), then the
   * research agenda: this turn's findings are merged and persisted, so the next
   * turn starts from what is still missing instead of from zero.
   */
  if (professorBrief) {
    const finalFalsifier = checkFalsifier({ message, answer: result.answer });
    result.professor = {
      schema: 'fbt.ai-professor.v1',
      lenses: professorLenses,
      falsifier: {
        applicable: finalFalsifier.applicable,
        present: finalFalsifier.hasFalsifier,
        compliant: finalFalsifier.compliant
      }
    };
  }

  /*
   * The cortex read rides on the turn, next to the reasoning ledger. It is
   * the observability for lever #5: without it there is no way to tell a
   * cortex that read the market from one that was asked and said nothing.
   *
   * `cortexRead` is null when the turn was not a market turn — the cortex is
   * only asked about markets.
   */
  if (cortexRead) {
    result.cortexRead = cortexRead;
  }

  if (marketFrame) {
    const finalMarket = checkMarketAnalysis({ frame: marketFrame, answer: result.answer });
    result.market = {
      schema: marketFrame.schema,
      dataStatus: marketFrame.dataStatus,
      stale: marketFrame.stale,
      instruments: marketFrame.instruments.length,
      breadth: marketFrame.breadth,
      dispersionPct: marketFrame.dispersionPct,
      regime: marketFrame.regime,
      relative: marketFrame.relative,
      leadership: marketFrame.leadership,
      horizon: marketFrame.horizon,
      notSupported: marketFrame.notSupported,
      gaps: marketFrame.gaps,
      violations: finalMarket.issues.map((i) => i.id),
      compliant: finalMarket.compliant
    };
  }

  if (emotionRead && emotionRead.primary !== 'neutral') {
    const finalEmotion = checkEmotionTone({ read: emotionRead, answer: result.answer });
    result.emotion = {
      schema: emotionRead.schema,
      primary: emotionRead.primary,
      mixed: emotionRead.mixed,
      valence: emotionRead.valence,
      arousal: emotionRead.arousal,
      dominance: emotionRead.dominance,
      intensity: emotionRead.intensity,
      acute: emotionRead.acute,
      selfDirected: emotionRead.selfDirected,
      cause: emotionRead.cause,
      needs: emotionRead.needs,
      trajectory: emotionRead.trajectory,
      violations: finalEmotion.issues.map((i) => i.id),
      compliant: finalEmotion.compliant
    };
  }

  if (discourseRead && discourseRead.confidence === 'read') {
    const finalDiscourse = checkDiscourseMirror({ discourse: discourseRead, answer: result.answer });
    result.discourse = {
      schema: discourseRead.schema,
      style: discourseRead.style,
      energy: discourseRead.energy,
      warmth: discourseRead.warmth,
      profanity: discourseRead.profanity,
      emoji: discourseRead.emoji,
      signals: discourseRead.signals,
      violations: finalDiscourse.issues.map((i) => i.id),
      compliant: finalDiscourse.compliant
    };
  }

  if (situationRead) {
    const finalSituation = checkSituationResponse({ situation: situationRead, answer: result.answer });
    result.situation = {
      schema: situationRead.schema,
      state: situationRead.state,
      direction: situationRead.direction,
      basis: situationRead.basis,
      pct: situationRead.pct,
      magnitudePct: situationRead.magnitudePct,
      hasRead: situationRead.hasRead,
      concentration: situationRead.concentration,
      cashPct: situationRead.cashPct,
      numbers: situationRead.numbers,
      violations: finalSituation.issues.map((i) => i.id),
      compliant: finalSituation.compliant
    };
  }

  {
    /* Published on every turn: `completeness: complete` is itself the answer to
       "did you understand me, or did you guess?" */
    const finalPartial = checkPartialAnswer({ read: partialRead, answer: result.answer });
    result.partial = {
      schema: partialRead.schema,
      completeness: partialRead.completeness,
      confidence: partialRead.confidence,
      act: partialRead.inferred.act,
      assets: partialRead.inferred.assets,
      missing: partialRead.missing.map((m) => m.slot),
      assumptions: partialRead.assumptions.map((a) => a.slot),
      repairs: partialRead.repairs.map((r) => r.how),
      questionBudget: partialRead.questionBudget,
      violations: finalPartial.issues.map((i) => i.id),
      compliant: finalPartial.compliant
    };
  }

  if (productRead) {
    const finalProduct = checkProductAnswer({ product: productRead, answer: result.answer });
    result.product = {
      schema: productRead.schema,
      intent: productRead.intent,
      confidence: productRead.confidence,
      gaps: productRead.gaps,
      sources: productRead.sources,
      pageCount: productRead.pageCount,
      pages: productRead.pages.map((p) => p.path),
      violations: finalProduct.issues.map((i) => i.id),
      compliant: finalProduct.compliant
    };
  }

  if (requestPlan) {
    const finalRequest = checkRequestPlan({ plan: requestPlan, answer: result.answer });
    result.request = {
      schema: requestPlan.schema,
      deliverable: requestPlan.deliverable,
      constraints: requestPlan.constraints,
      missing: requestPlan.missing,
      expertise: requestPlan.expertise,
      lengthTarget: requestPlan.blueprint.maxSentences,
      violations: finalRequest.issues.map((i) => i.id),
      compliant: finalRequest.compliant
    };
  }

  if (researchSession?.enabled) {
    const findings = deriveResearchFindings({
      strategy: result.strategy,
      decision: result.decision,
      subQuestions: result.subQuestions,
      numericAudit: result.numericAudit,
      dialogue: result.dialogue,
      falsifier: result.professor?.falsifier
        ? { applicable: result.professor.falsifier.applicable, compliant: result.professor.falsifier.compliant }
        : null,
      market: result.market,
      context
    });
    const recorded = await withDeadline(
      researchSession.record(owner, { agenda: priorAgenda, findings, locale }),
      null,
      500
    );
    result.research = recorded
      ? { ...recorded, briefed: briefedItems.map((i) => i.id) }
      : null;
  }

  /* Re-check the FINAL text: the reviewer may have fixed a figure. */
  if (result.strategy) {
    result.strategy.arithmetic = checkPlanArithmetic(result.answer, result.strategy.frame);
  }

  if (subQuestions.length >= 2 && !result.degraded) {
    const coverage = assessQuestionCoverage(subQuestions, result.answer);
    result.subQuestions = {
      parts: subQuestions,
      covered: coverage.covered,
      uncovered: coverage.uncovered,
      complete: coverage.uncovered.length === 0
    };
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
  const acknowledgement = degradedSafetyContainment
    ? null
    : formatEmotionalAcknowledgement({ emotion: plan.emotion, fomo: plan.fomo, locale });
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
  /*
   * The budget travels with the answer. `degraded: true` with
   * `latencyMs ≈ budget.deadlineMs` is a TIMEOUT; the same flag with a two-line
   * latency is a refusal. Before this field those two looked identical on the
   * panel, which is how a mode that was too slow to run was read as a mode that
   * was never implemented.
   */
  result.intelligence.budget = {
    deadlineMs: budget.deadlineMs,
    ceilingMs: budget.ceilingMs,
    source: budget.source,
    usedMs: result.latencyMs,
    overBudget: overBudget()
  };
  /*
   * The PROVIDER budget is published here, at the END of the turn, not
   * midway: a report written before the verifier and the critic have
   * run counts only half the calls the turn actually made, and a
   * budget report that undercounts is worse than none.
   */
  result.budget = {
    ...(result.budget || {}),
    callCap: turnBudget.maxCalls,
    callsUsed: turnBudget.calls || 0,
    capHits: turnBudget.capHits || 0,
    dayHeadroom: quotaCapApplied?.headroom == null ? null : Math.round(quotaCapApplied.headroom * 100),
    dayCounterDurable: quotaCapApplied?.durable === true
  };
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

function pickAnalysisRoles(plan, max, min = Math.min(2, max)) {
  const priority = [
    [AI_ROLES.MARKET_AI, plan.taskTypes.includes('market')],
    [AI_ROLES.CRYPTO_RESEARCH_AI, plan.taskTypes.includes('crypto-analysis') || plan.taskTypes.includes('research')],
    [AI_ROLES.NEWS_AI, plan.taskTypes.includes('news')],
    [AI_ROLES.RISK_AI, plan.taskTypes.includes('risk')],
    [AI_ROLES.STRATEGY_AI, plan.taskTypes.includes('strategy')],
    [AI_ROLES.PORTFOLIO_AI, plan.taskTypes.includes('portfolio')]
  ];
  const chosen = priority.filter(([, wanted]) => wanted).map(([r]) => r).slice(0, max);
  /*
   * Fill up to `min` with DISTINCT analytical roles before repeating a view.
   * The old loop only guaranteed two, so asking for three on a market-only
   * question silently collapsed back to two analyses.
   */
  /* Market + risk lead the fill: they are the two views the protocol always
     had, so a third analysis extends that pair instead of replacing it. */
  const fillPool = [
    AI_ROLES.MARKET_AI,
    AI_ROLES.RISK_AI,
    AI_ROLES.CRYPTO_RESEARCH_AI,
    AI_ROLES.STRATEGY_AI,
    AI_ROLES.PORTFOLIO_AI,
    AI_ROLES.NEWS_AI
  ];
  for (const candidate of fillPool) {
    if (chosen.length >= Math.min(min, max)) break;
    if (!chosen.includes(candidate)) chosen.push(candidate);
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
