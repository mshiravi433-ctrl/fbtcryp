/**
 * FBT INTENT OS — UPGRADE 13: ANSWER GAP + PROVIDER ESCALATION
 * ---------------------------------------------------------------------------
 * Two failures the fleet had today, read from the code rather than assumed:
 *
 *   1. **The shrug was terminal.** When the deterministic layer had nothing,
 *      `buildDegradedAnswer` returned «No external AI model is available right
 *      now and no trusted data was found» — and stopped. That sentence is
 *      *false whenever a key is configured*: the ladder had not been walked, it
 *      had only been entered once. `routedChat` returns on the FIRST provider
 *      that answers with HTTP 200, so a model that replies «I don't know»
 *      finishes the request and every other provider stays idle.
 *   2. **Most turns never asked at all.** `collaborationWanted` is gated on
 *      `level >= 2` and an intent allowlist, so a low-confidence or unclear
 *      turn — the exact ones where a second opinion is worth money — was
 *      answered by the rule engine alone.
 *
 * This module is the missing piece: a *gap detector* plus a *ladder*.
 *
 *   gap? ──▶ for each configured provider not already tried, health-aware,
 *            inside one deadline:
 *              ask → refuse? → next provider
 *              answer usable? → stop, keep provenance
 *            └─ all exhausted → an honest line that names what was tried
 *
 * What it may NOT do, and the reason:
 *   · answer a wallet/portfolio/balance question — those numbers are
 *     `TOOL_TRUTH_INTENTS`: a model is not a ledger, and an invented balance is
 *     the single worst output this app could produce. Refused with
 *     `TOOL_TRUTH_REQUIRED`, before any HTTP call.
 *   · touch execution. No action, no approval, no signature; the returned
 *     object says so in three fields so a caller cannot lose track of it.
 *   · leak secrets: the message goes through `sanitizePrompt`, and raw wallet
 *     data is never sent — only the aggregate context block.
 *   · stall the chat: one deadline for the whole ladder, and a provider that
 *     breaks it is dropped, not awaited.
 */

import {
  executeProviderChat,
  getPreferredProvidersForTask,
  getActiveProviderIds,
  isProviderConfigured,
  sanitizePrompt
} from './aiGateway.js';
import { recordProviderCall, isProviderHealthy } from './aiCollaboration.js';
import { TOOL_TRUTH_INTENTS } from '../src/lib/intent-ai/os/collaborationRouter.js';

export const ESCALATION_SCHEMA = 'fbt.ai-answer-escalation.v13';
export const ESCALATION_VERSION = '13.0.0';

const DEFAULT_DEADLINE_MS = Number(process.env.AI_ESCALATION_DEADLINE_MS || 9000);
const DEFAULT_MAX_PROVIDERS = Number(process.env.AI_ESCALATION_MAX_PROVIDERS || 4);
const MIN_USEFUL_CHARS = Number(process.env.AI_ESCALATION_MIN_CHARS || 24);

/* -------------------------------------------------------------------------- */
/*  WHAT COUNTS AS "NOT AN ANSWER"                                              */
/* -------------------------------------------------------------------------- */

/* Refusals and non-answers, in the twelve languages the assistant may answer
   in plus the boilerplate models fall back to. Deliberately narrow: a real
   answer that also warns the user ("…but this is not financial advice") must
   NOT be discarded, so nothing here matches a hedge. */
const REFUSAL_PATTERNS = Object.freeze([
  /* english — no trailing \b: it would have to land between a word character
     and a space, and the alternation ends on punctuation-free letters only
     sometimes, which made real refusals like «I do not know the answer, sorry»
     pass as answers. The leading boundary is the one that matters. */
  /\bi\s+(?:do\s*(?:n'?t|not)\s+know|ca(?:nnot|n'?t)\s+(?:answer|help|provide|access|verify|tell|say)|have\s+no\s+(?:access|data|information)|do\s*(?:n'?t|not)\s+have\s+(?:any\s+|live\s+|real\s+)?(?:data|information|access|sources|numbers)|am\s+(?:unsure|not\s+able)|cannot\s+answer|lack\s+the\s+data|did\s+not\s+find)/i,
  /\bi'?m\s+unable\s+to\b/i,
  /as\s+an\s+(?:ai\s+)?language\s+model/i,
  /* persian */ /(?:نمی?\s*دانم|نمی?\s*دونم|اطلاعاتی\s+ندارم|دسترسی\s+ندارم|نمی?\s*تونم\s+پاسخ|پاسخ\s+ندارم|نمی?\s*تونم\s+بگم|جوابی\s+ندارم)/,
  /* arabic */ /(?:لا\s+أعرف|لا\s+استطيع|لا\s+أملك\s+معلومات|لا\s+يمكنني\s+الإجابة)/,
  /* turkish */ /\b(?:bilemiyorum|cevap\s+veremem|bilgim\s+yok|ulaşamıyorum|erişemiyorum)\b/iu,
  /* russian */ /(?:не\s+знаю|не\s+могу\s+ответить|нет\s+данных|не\s+имею\s+доступа)/i,
  /* chinese */ /(?:我不知道|无法回答|没有(相关)?数据|无法获取)/,
  /* hindi + urdu */ /(?:मुझे\s+नहीं\s+पता|उत्तर\s+नहीं\s+दे\s+सकता|कोई\s+मعلومات\s+नہیں|مujhe\s+nahi\s+maloom)/i,
  /* spanish / portuguese / french / indonesian */ /(?:no\s+s[ée]\s+(?:puedo|sabes)\s+responder|no\s+tengo\s+(?:los\s+)?datos|não\s+(?:sei|consigo)\s+responder|não\s+tenho\s+(?:os\s+)?dados|je\s+ne\s+(?:peux|sais)\s+pas\s+répondre|je\s+n['’]?ai\s+pas\s+(?:les\s+)?donn[ée]es|saya\s+tidak\s+tahu|tidak\s+bisa\s+menjawab)/iu,
  /* the sentinel this module asks providers for, and content-free replies */
  /^\s*UNANSWERABLE\s*[.!]?\s*$/i,
  /^\s*[?.!،。]+?\s*$/u
]);

/*
 * The shape of a shrug, whichever language it is shrugging in: somebody says
 * they cannot, no number appears anywhere, and the sentence is too short to
 * have tried. A real answer is allowed to admit limits — «I cannot guarantee a
 * profit, but BTC is at 63.4K» keeps its figures and stays an answer, which is
 * exactly why the digit test is part of the rule and not an afterthought.
 */
const NO_DATA_CLAIM = /(?:\bcannot\b|\bcan'?t\b|\bunable\b|\bnot\s+able\b|\bno\s+(?:live\s+)?(?:data|access|sources)\b|\bdon'?t\s+have\b|\bhaven'?t\s+got\b|نمی?تونم|نمی?\s*تونم|نمی?دانم|ندارم|\bلا\s+أستطيع\b|\bnie\s+umiem\b|\bnon\s+riesco\b)/iu;

/** True when a provider's text is a refusal, a shrug, or too short to be an answer. */
function refuses(text) {
  const t = String(text || '').trim();
  if (!t) return true;
  if (REFUSAL_PATTERNS.some((re) => re.test(t))) return true;
  return NO_DATA_CLAIM.test(t) && !/\d/.test(t) && t.length < 220;
}

const LEAK_RE = /(private\s*key|seed\s*phrase|mnemonic|api[_\s-]?key|0x[a-f0-9]{64})/i;

export function isRefusalOrNonAnswer(text) {
  const t = String(text || '').trim();
  if (!t) return true;
  if (t.length < MIN_USEFUL_CHARS) return true;
  if (refuses(t)) return true;
  /* A "answer" that is only a promise to look into it is not an answer. */
  if (/^\s*(?:let me check|بذار چک کنم|voy a revisar)\b/iu.test(t) && t.length < 60) return true;
  return false;
}

/**
 * Should this turn be escalated to the rest of the fleet?
 *
 * Kept a pure predicate so the rule is testable and visible, instead of being
 * an if-chain buried in a route handler.
 */
export function answerGap({ message = '', text = '', intentType = null, confidence = null, dataStatus = null, hasCard = false, hasPendingIntent = false, socialHandled = false, alreadyEscalated = false, providersConfigured = null } = {}) {
  const reasons = [];
  /* A pending intent or a composed social reply already owns this turn. The
     first owns an execution; the second is a deliberate answer, not a gap —
     escalating a "how are you" into four provider calls is the mistake §4 of
     Upgrade 5 exists to prevent. */
  if (hasPendingIntent) return { escalate: false, reasons: ['PENDING_INTENT_OWNS_TURN'] };
  if (socialHandled) return { escalate: false, reasons: ['SOCIAL_TURN_OWNS_REPLY'] };
  if (hasCard) return { escalate: false, reasons: ['CARD_IS_THE_ANSWER'] };
  const intent = String(intentType || '').toUpperCase();
  if (TOOL_TRUTH_INTENTS.includes(intent)) return { escalate: false, reasons: ['TOOL_TRUTH_REQUIRED'] };

  const body = String(text || '').trim();
  if (!body || body.length < MIN_USEFUL_CHARS) reasons.push('NO_REPLY_TEXT');
  if (isRefusalOrNonAnswer(body)) reasons.push('REPLY_IS_A_NON_ANSWER');
  if (/\b(?:unavailable|not available|در دسترس نبود|no hay datos)\b/i.test(body) && body.length < 220) reasons.push('REPLY_SAYS_NO_DATA');
  if (confidence != null && Number(confidence) < 0.45) reasons.push('LOW_CONFIDENCE');
  if (dataStatus && dataStatus !== 'live' && !/unavailable/.test(String(dataStatus))) reasons.push('DATA_NOT_LIVE');
  if (alreadyEscalated) reasons.push('ALREADY_ESCALATED');
  const configured = providersConfigured === null ? getActiveProviderIds().filter((id) => id !== 'internal').length : providersConfigured;
  if (!configured) reasons.push('NO_EXTERNAL_PROVIDERS');
  /*
   * `blocked` separates «there was a gap and nobody else to ask» from «there
   * was no gap». The first has to be visible in the answer — the deterministic
   * reply stays, and the transparency line can say the fleet was unavailable.
   */
  const blockedBy = reasons.includes('NO_EXTERNAL_PROVIDERS') ? 'NO_EXTERNAL_PROVIDERS'
    : reasons.includes('ALREADY_ESCALATED') ? 'ALREADY_ESCALATED' : null;
  return {
    escalate: reasons.length > 0 && !blockedBy,
    reasons,
    blocked: Boolean(blockedBy),
    blockedBy,
    schema: ESCALATION_SCHEMA
  };
}

/* -------------------------------------------------------------------------- */
/*  THE LADDER                                                                  */
/* -------------------------------------------------------------------------- */

const TIMED_OUT = Object.freeze({ timedOut: true });

/**
 * Race a provider call against the turn's remaining budget.
 *
 * The timer is cleared as soon as either side settles, and it is deliberately
 * NOT unref'd: an unref'd deadline let a short-lived process (a probe, a CLI
 * run, a worker) exit mid-request with a code 0 and nothing to show for it.
 * A promise that rejects is reported as `null` — the provider answered badly;
 * a promise that never settles at all is `TIMED_OUT` — the provider answered
 * late. Those two get different bookkeeping below, so they stay different.
 */
function withDeadline(promise, ms) {
  if (!(ms > 0)) return Promise.resolve(TIMED_OUT);
  const settled = Promise.resolve(promise).catch(() => null);
  let timer = null;
  return Promise.race([
    settled,
    new Promise((resolve) => { timer = setTimeout(() => resolve(TIMED_OUT), ms); })
  ]).finally(() => { if (timer) clearTimeout(timer); settled.catch(() => {}); });
}

const ASK_SYSTEM = [
  'You are FBT, a non-custodial crypto assistant. Answer the user question directly and briefly.',
  'Answer in EXACTLY the language the user wrote in — not English, unless they wrote in English.',
  'Ground every factual claim in the provided data. If the data cannot support an answer, reply with the single word: UNANSWERABLE',
  'Never invent a price, balance, APY, date, or transaction. Never advise on what to buy.',
  'Never mention which model you are, and never mention other providers.',
  'Never ask for or repeat private keys, seed phrases or passwords.'
].join('\n');

/**
 * Walk the remaining providers until one produces something that is actually an
 * answer.
 *
 * @param {object} input
 * @param {string} input.message
 * @param {string} [input.locale]
 * @param {object} [input.context]  aggregate, already-sanitised context block
 * @param {string[]} [input.exclude]  providers already consulted this turn
 * @param {string} [input.taskType]
 * @param {number} [input.deadlineMs]
 * @param {object} [input.deps]  injectable fleet for offline tests: { providers: string[], execute(id, opts) }
 */
export async function escalateToProviders({
  message = '',
  locale = 'en',
  context = {},
  exclude = [],
  taskType = 'general',
  deadlineMs = DEFAULT_DEADLINE_MS,
  maxTokens = 520,
  deps = null
} = {}) {
  const startedAt = Date.now();
  const ask = deps?.execute || executeProviderChat;
  /*
   * A test or a caller may hand the fleet itself. When it does, the environment
   * and the health registry are stepped around entirely — an injected fleet is
   * the caller's statement of who is available, and the ladder must be testable
   * without keys in the machine.
   */
  const injected = Array.isArray(deps?.providers) && deps.providers.length ? [...deps.providers] : null;
  const configuredIds = injected || getActiveProviderIds().filter((id) => id !== 'internal');
  if (!configuredIds.length) {
    return {
      ok: false, schema: ESCALATION_SCHEMA, answeredBy: null, tried: [], skipped: [],
      reason: 'NO_EXTERNAL_PROVIDERS', providerCalls: 0, latencyMs: 0,
      executionAuthorized: false, canSignOrSend: false, changesLimits: false
    };
  }

  /* Order: the gateway's task preference first, then any configured provider
     the preference list left out — the whole point of this ladder is that a
     provider nobody routes to is still better than a shrug. */
  const preferred = injected ? injected
    : getPreferredProvidersForTask(taskType, { configuredOnly: true }).filter((id) => id !== 'internal');
  const queue = [...new Set([...preferred, ...configuredIds])]
    .filter((id) => injected || isProviderConfigured(id))
    .filter((id) => !exclude.includes(id));
  const skippedForHealth = injected ? [] : queue.filter((id) => !isProviderHealthy(id));
  const healthy = injected ? queue : queue.filter((id) => isProviderHealthy(id));
  const order = (healthy.length ? healthy : queue.filter((id) => !skippedForHealth.includes(id))).slice(0, Math.max(1, DEFAULT_MAX_PROVIDERS));

  if (!order.length) {
    return {
      ok: false, schema: ESCALATION_SCHEMA, answeredBy: null, tried: [], skipped: skippedForHealth,
      reason: excludedReason(exclude), providerCalls: 0, latencyMs: 0,
      executionAuthorized: false, canSignOrSend: false, changesLimits: false
    };
  }

  const safeMessage = sanitizePrompt(String(message || '').slice(0, 1800));
  const contextBlock = safeContext(context);
  const user = [
    `USER MESSAGE: ${safeMessage}`,
    contextBlock,
    `Answer in the language of the user message (declared locale: ${String(locale || 'unknown')}).`
  ].filter(Boolean).join('\n\n');

  const tried = [];
  for (const providerId of order) {
    const left = deadlineMs - (Date.now() - startedAt);
    if (left <= 250) {
      tried.push({ provider: providerId, status: 'SKIPPED_DEADLINE' });
      break;
    }
    const started = Date.now();
    let res = null;
    try {
      /* The provider's own client gets the same budget, so the socket is closed
         and not left to bill us for an answer nobody will read. */
      res = await withDeadline(ask(providerId, {
        system: ASK_SYSTEM,
        user,
        temperature: 0.2,
        maxTokens,
        json: false,
        timeout: Math.min(left, 8000)
      }), Math.min(left, 8000));
    } catch (err) {
      tried.push({ provider: providerId, status: 'ERROR', error: String(err?.message || err).slice(0, 120) });
      /*
       * Health is one store, owned by the gateway. A gateway failure already
       * arrived classified and recorded (`err.reasonCode` + `err.fix`); writing
       * it again from here would count one request twice and replace the real
       * reason with UNKNOWN — the exact detail /api/v1/ai/gateway/health publishes.
       * Only a failure the gateway did not classify is recorded here.
       */
      if (!err?.reasonCode) {
        recordProviderCall(providerId, { ok: false, durationMs: Date.now() - started, error: String(err?.message || err).slice(0, 200) });
      }
      continue;
    }
    if (res === TIMED_OUT) {
      tried.push({ provider: providerId, status: 'TIMEOUT', latencyMs: Date.now() - started });
      /*
       * This one IS ours: the escalation deadline expired while the call was
       * still in flight, so the gateway has not seen an outcome. Classified as
       * TIMEOUT (parked 45s) rather than UNKNOWN (60s) because a slow provider
       * is a transient condition, not an account problem.
       */
      recordProviderCall(providerId, { ok: false, durationMs: Date.now() - started, reasonCode: 'TIMEOUT', error: 'escalation deadline exceeded' });
      continue;
    }
    const latencyMs = Date.now() - started;
    const raw = String(res?.text ?? '').trim();
    if (!res || !raw) {
      /* An empty body is a completed call that said nothing — its own class,
         parked briefly (30s), not lumped in with UNKNOWN. */
      recordProviderCall(providerId, { ok: false, durationMs: latencyMs, reasonCode: 'EMPTY', error: 'empty response body' });
      tried.push({ provider: providerId, status: 'EMPTY', latencyMs });
      continue;
    }
    if (LEAK_RE.test(raw)) {
      /* A provider that echoed credential material back is not filtered, it is
         discarded: nothing that looks like a key leaves this function. */
      tried.push({ provider: providerId, status: 'REDACTED_LEAK', latencyMs });
      continue;
    }
    if (isRefusalOrNonAnswer(raw)) {
      tried.push({ provider: providerId, status: 'REFUSED', latencyMs });
      /* A refusal is a completed call, not a failure: the provider worked, it
         just had nothing. Recording it as a failure would open its circuit and
         silently cut the fleet for the next hundred users. */
      recordProviderCall(providerId, { ok: true, durationMs: latencyMs, qualityScore: 20 });
      continue;
    }
    recordProviderCall(providerId, { ok: true, durationMs: latencyMs, qualityScore: 75 });
    return {
      ok: true,
      schema: ESCALATION_SCHEMA,
      answer: raw.slice(0, 2000),
      answeredBy: providerId,
      model: res.model || null,
      tried: [...tried, { provider: providerId, status: 'ANSWERED', latencyMs }],
      skipped: skippedForHealth,
      providerCalls: tried.length + 1,
      latencyMs: Date.now() - startedAt,
      /* Escalation buys words, never authority (§67). */
      executionAuthorized: false,
      canSignOrSend: false,
      changesLimits: false
    };
  }

  return {
    ok: false,
    schema: ESCALATION_SCHEMA,
    answeredBy: null,
    tried,
    skipped: skippedForHealth,
    providerCalls: tried.length,
    latencyMs: Date.now() - startedAt,
    reason: tried.some((t) => t.status === 'REFUSED') ? 'ALL_REFUSED' : 'ALL_UNAVAILABLE',
    executionAuthorized: false,
    canSignOrSend: false,
    changesLimits: false
  };
}

function excludedReason(exclude) {
  if (!Array.isArray(exclude) || !exclude.length) return 'NO_HEALTHY_PROVIDERS';
  return `ALL_CONFIGURED_PROVIDERS_ALREADY_CONSULTED:${exclude.length}`;
}

/** Aggregates only — the same rule §44 sets for collaboration. */
function safeContext(context = {}) {
  const rows = [];
  const market = context.market;
  if (market?.priceMap && Object.keys(market.priceMap).length) {
    rows.push(`MARKET(quote cache): ${Object.entries(market.priceMap).map(([s, p]) => Number.isFinite(Number(p)) ? `${s}=${Number(p)}` : `${s}=unavailable`).join(', ')}${market.change24hPct != null ? `, btc24h=${Number(market.change24hPct).toFixed(2)}%` : ''}`);
  }
  if (Array.isArray(context.yields) && context.yields.length) {
    rows.push(`YIELDS(top): ${context.yields.slice(0, 5).map((y) => `${y.symbol || y.protocol}@${y.apy}%`).join(', ')}`);
  }
  if (Number.isFinite(Number(context.portfolio?.totalValueUsd))) {
    rows.push(`PORTFOLIO(aggregate only): $${Number(context.portfolio.totalValueUsd).toFixed(0)}`);
  }
  return rows.length ? `DATA AVAILABLE TO FBT:\n${rows.join('\n')}` : 'NO DATA AVAILABLE IN THIS TURN — if you cannot answer from that, reply UNANSWERABLE.';
}

export const ESCALATION_EXPORTS = Object.freeze({ ESCALATION_SCHEMA, ESCALATION_VERSION, answerGap, escalateToProviders, isRefusalOrNonAnswer });
export default escalateToProviders;
