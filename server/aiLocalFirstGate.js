/**
 * THE LOCAL-FIRST GATE (2026-11-11)
 * ===========================================================================
 * WHY THIS EXISTS
 * ---------------------------------------------------------------------------
 * The project runs on three free tiers, and TWO ceilings bind it at once:
 *
 *   • ~8 minutes of CPU per day (Vercel Hobby Fluid Active CPU)
 *   • OpenRouter's free catalogue: 50 requests per day
 *
 * The second one is the real wall. Measured over the `max` profile, one
 * substantive turn costs SIX provider calls (market, risk, crypto-research,
 * verification, final synthesis, adversarial repair). Against a 50/day cap
 * that is about EIGHT good questions a day.
 *
 * And most of those six calls are spent re-deriving what the repository
 * already knows. The corpus holds 103 verified items; a lexical search over
 * it costs about 10 ms and an offline embedding about 0.1 ms. So a question
 * like «کارمزد پلتفرم FBT چقدر است» — whose answer is sitting in
 * `kb.product.fee`, already verified — currently pays six model calls to
 * paraphrase a fact the project can state outright.
 *
 * That is not a budget problem. It is a QUALITY problem wearing a budget
 * costume: when the answer is retrieved, it is retrieved CORRECTLY and
 * CITABLY; when the answer is generated, it is generated (occasionally
 * wrongly, occasionally with a number nobody verified). Moving the common
 * case from "generated" to "retrieved" makes the AI both cheaper AND more
 * truthful at the same time.
 *
 * WHAT THE GATE DOES
 * ---------------------------------------------------------------------------
 * Before the pipeline spends a single provider call, it asks one question:
 *
 *     "Can the project answer this from its own verified knowledge, with
 *      the same or better honesty than a model would?"
 *
 * If yes, it answers from the local reasoner and returns. If no, it says
 * no and the normal pipeline runs, unchanged.
 *
 * THE THREE RULES THAT KEEP IT HONEST
 * ---------------------------------------------------------------------------
 *   1. THE GATE MAY ONLY SKIP A CALL WHEN IT HAS AN ANSWER. A question the
 *      local corpus does not cover is NOT answered locally. It goes to the
 *      model exactly as before. The gate never turns "I don't know" into a
 *      confident local answer.
 *
 *   2. THE GATE NEVER ANSWERS A LIVE QUESTION. If the question needs
 *      current data — a price, today's market, a breaking event — the gate
 *      steps aside. The local corpus has no live prices, so answering from
 *      it would be a guess with a citation attached, which is worse than a
 *      guess without one.
 *
 *   3. THE GATE REPORTS ITSELF. The result carries `localFirst` with the
 *      reason it fired, so an operator can see how many calls it saved and
 *      a test can prove it did not fire when it should not have.
 *
 * WHAT IT IS NOT
 * ---------------------------------------------------------------------------
 * It is not a second answer path that competes with the main one. The main
 * pipeline is untouched; the gate only decides whether to ENTER it. When it
 * declines, the turn is byte-for-byte what it was before.
 */

import { synthesizeInternalAnswer } from './aiInternalReasoner.js';

/** The environment switch. `0` turns the gate off entirely. */
export function localFirstGateEnabled(env = process.env) {
  const raw = env.AI_LOCAL_FIRST_GATE;
  if (raw === undefined || raw === null || raw === '') return true;   /* on by default */
  return !/^(0|false|off|no)$/i.test(String(raw));
}

/**
 * How strong a lexical hit has to be before the gate is allowed to answer.
 *
 * Measured over a spread of 22 realistic questions, the lexical scorer
 * separates cleanly:
 *
 *   260  «بیت کوین چیست؟»            → definitional, fully covered
 *   172  «سازندگان FBT چه کسانی هستند» → product fact
 *   145  «کارمزد پلتفرم FBT چقدر است» → product fact
 *   105  «ریسک لیکوییدیتی چیست؟»      → related but partial
 *    80  «بازار امروز چطور است؟»       → weak, and LIVE anyway
 *
 * The gap between a covered question (≥100) and an uncovered one (<90) is
 * where the honest threshold sits. 100 is deliberately conservative: a
 * false positive costs the user a worse answer, and a false negative only
 * costs the budget one model call — which is the cheaper mistake.
 */
export const LOCAL_FIRST_MIN_SCORE = 100;

/**
 * The minimum length of a local answer that may be returned as-is. A
 * one-line fragment is not an answer; it is a heading.
 */
export const LOCAL_FIRST_MIN_ANSWER_CHARS = 40;

/**
 * A question that asks for a JUDGEMENT is never answered locally.
 *
 * This is the rule that keeps the gate from being clever in the wrong way.
 * The corpus contains a definition of Bitcoin, so the question «ریسک ورود
 * به بیت‌کوین چیست؟» retrieves it with a high score (164) — but the
 * definition is NOT the answer. The user asked for an assessment of entry
 * risk, which depends on their position, the current market and a
 * judgement. Answering that from a glossary entry would be a confident
 * non-answer.
 *
 * So the gate distinguishes a LOOKUP from a JUDGEMENT:
 *
 *   lookup    — "what is X", "what does X cost", "where are my keys"
 *               → the corpus holds the answer, verbatim
 *   judgement — "should I", "what is the risk of", "compare", "which is
 *               better", "what should I do about"
 *               → the corpus holds FACTS but not the VERDICT
 *
 * A judgement goes to the model, always. The corpus is the evidence the
 * model reasons over, not the verdict itself.
 */
export const JUDGEMENT_RE = /(?:ریسک\s*(?:ورود|خروج|معامله|سرمایه|سبد|پورتفوی|دارایی)|آیا\s*(?:بخرم|بفروشم|بمانم|بروم|ارزش\s*دارد)|ارزش\s*دارد|بخرم|بفروشم|نگه\s*دارم|نگهداری\s*کنم|چه\s*کنم|چیکار\s*کنم|چه\s*استراتژی|استراتژی\s*مناسب|بهترین\s*(?:کار|گزینه|انتخاب|استراتژی)|مقایسه\s*کن|کدام\s*(?:بهتر|بیشتر|مناسب)|should\s+i|worth\s+(?:it|buying)|better\s+to|compare|which\s+(?:is\s+better|should)|what\s+should\s+i|my\s+portfolio\s+(?:is|looks)|ریسک\s*پرتفوی|پورتفوی\s*من\s*چطور|سبد\s*من\s*چیه|سبد\s*سرمایه\s*گذاری|سناریو|سناریوهای|تحلیل\s+بازار|پیش\s*بینی|پیش‌بینی|چشم\s*انداز\s+بازار|تحلیل\s+ریسک|سناریوی\s+بازار)/i;

/**
 * THE SAFETY PRE-CHECK (2026-11-11)
 * ===========================================================================
 * A person who says «همه پولمو بفروشم» must never be answered by a corpus
 * lookup about fees.
 *
 * This is a FLOOR, not the whole safety net: the real containment lives in
 * the reasoner (`server/aiInternalReasoner.js`) and in the emotional reads,
 * and both of those still run on the model path. What this regex does is
 * stop the LOCAL path from ever being the one that answers a clearly
 * distressed person — because the local path has no emotional reads.
 *
 * It is deliberately broad. A false positive costs one provider call; a
 * false negative costs the one thing that must never be lost.
 */
export const SAFETY_PRECHECK_RE = /(?:ضرر\s*کردم|همه\s*پولمو|همه\s*چیمو|همشو|بفروشم|خسته\s*شدم|خسته‌ام|ناراحتم|دلم\s*تنگه|گریه|دردناک|خودکشی|می‌خوام\s*بمیرم|میخوام\s*بمیرم|شرمنده|خجالت\s*میکشم|از\s*خودم\s*بیزارم|بیزارم|درمانده|فرسوده|از\s*پا\s*افتادم|نومید|امیدم\s*رفت|heartbroken|devastated|hopeless|worthless)/i;

/**
 * THE CHEAP PRE-GATE (2026-11-11)
 * ===========================================================================
 * The full gate needs the safety reads (social, emotion) and the retrieved
 * knowledge. Those cost real CPU — measured at about 90 ms of the `max`
 * path's local work — and the FULL reading layer runs BEFORE the gate
 * today, so a turn that the local corpus can answer outright still paid
 * for the whole reading layer first.
 *
 * The pre-gate answers ONE question, as cheaply as possible:
 *
 *     "Is this turn OBVIOUSLY not answerable locally?"
 *
 * If the turn needs live data, or asks for a judgement, or is multi-part,
 * the answer is known before any expensive read: it goes to the model. So
 * the expensive reads are skipped entirely for the turns that were never
 * going to be answered locally.
 *
 * If the pre-gate says "maybe" — which is the common case for a product
 * question — the pipeline continues, the safety reads run, and the FULL
 * gate decides.
 *
 * The pre-gate NEVER answers a question. It only declines.
 */
export function preEvaluateLocalFirst({
  message = '',
  plan = null,
  env = process.env
} = {}) {
  const evidence = { enabled: localFirstGateEnabled(env), reason: 'not-evaluated', skippedFor: null };

  if (!evidence.enabled) {
    evidence.reason = 'disabled';
    return { continue: true, reason: evidence.reason, evidence };
  }

  const text = String(message || '').trim();
  if (!text) {
    evidence.reason = 'empty-message';
    return { continue: true, reason: evidence.reason, evidence };
  }

  /*
   * ─── SAFETY COMES FIRST ──────────────────────────────────────────────────
   * A person who says «همه پولمو بفروشم» must never be answered by a
   * corpus lookup about fees. The safety pre-check is deliberately
   * CONSERVATIVE and CHEAP: it recognises the clearest distress shapes and
   * declines the local path for them, so the turn goes to the model path,
   * where the reasoner's safety containment lives.
   *
   * It is a floor, not the whole safety net: the full safety contract (the
   * emotional reads and the reasoner's containment) still runs on the model
   * path.
   */
  if (SAFETY_PRECHECK_RE.test(text)) {
    evidence.reason = 'safety-precheck';
    evidence.skippedFor = 'safety';
    return { continue: false, reason: evidence.reason, evidence };
  }

  /* A JUDGEMENT is never a lookup, however well the corpus matches it. */
  if (JUDGEMENT_RE.test(text)) {
    evidence.reason = 'judgement-question';
    evidence.skippedFor = 'judgement';
    return { continue: false, reason: evidence.reason, evidence };
  }

  /* A question with more than one part is a multi-part question. */
  const numberedParts = (text.match(/(?:^|[۰-۹0-9]\s*[).،\-:])/g) || []).length;
  if (numberedParts >= 2) {
    evidence.reason = 'multi-part-question';
    evidence.skippedFor = 'multi-part';
    return { continue: false, reason: evidence.reason, evidence };
  }

  const freshness = plan?.freshness || null;
  if (freshness === 'LIVE' || freshness === 'BREAKING' || freshness === 'RECENT') {
    evidence.reason = 'needs-live-data';
    evidence.skippedFor = 'freshness';
    return { continue: false, reason: evidence.reason, evidence };
  }
  if (plan?.needsWeb) {
    evidence.reason = 'needs-web-research';
    evidence.skippedFor = 'needsWeb';
    return { continue: false, reason: evidence.reason, evidence };
  }

  evidence.reason = 'maybe';
  return { continue: true, reason: evidence.reason, evidence };
}

/**
 * Decide whether this turn can be answered locally.
 *
 * @param {object} p
 * @param {string} p.message          the user's question
 * @param {object} p.plan             the collaboration plan (level, freshness, needsWeb…)
 * @param {Array}  p.knowledge        the retrieved knowledge rows (with scores)
 * @param {string} p.locale
 * @param {object} p.context          the turn's live context (market, portfolio…)
 * @param {object} p.env
 * @param {Function} p.synthesize     injected for tests; defaults to the real reasoner
 * @returns {{ answer: string|null, reason: string, used: boolean, evidence: object }}
 */
export function evaluateLocalFirst({
  message = '',
  plan = null,
  knowledge = [],
  locale = 'fa',
  context = {},
  env = process.env,
  synthesize = synthesizeInternalAnswer,
  socialRead = null,
  emotionRead = null,
  minScore = LOCAL_FIRST_MIN_SCORE,
  minAnswerChars = LOCAL_FIRST_MIN_ANSWER_CHARS
} = {}) {
  const evidence = {
    enabled: localFirstGateEnabled(env),
    reason: 'not-evaluated',
    score: 0,
    matched: null,
    freshness: plan?.freshness || null,
    needsWeb: Boolean(plan?.needsWeb),
    skippedFor: null
  };

  if (!evidence.enabled) {
    evidence.reason = 'disabled';
    return { answer: null, reason: evidence.reason, used: false, evidence };
  }

  const text = String(message || '').trim();
  if (!text) {
    evidence.reason = 'empty-message';
    return { answer: null, reason: evidence.reason, used: false, evidence };
  }

  /*
   * The safety floor is checked FIRST, before every other rule, so the
   * reported reason is the true one: a distressed «همه پولمو بفروشم» is a
   * safety case before it is a judgement case or a live-data case, and the
   * log must say so.
   */
  if (SAFETY_PRECHECK_RE.test(text)) {
    evidence.reason = 'safety-precheck';
    evidence.skippedFor = 'safety';
    return { answer: null, reason: evidence.reason, used: false, evidence };
  }

  /* A JUDGEMENT is never a lookup, however well the corpus matches it. */
  if (JUDGEMENT_RE.test(text)) {
    evidence.reason = 'judgement-question';
    evidence.skippedFor = 'judgement';
    return { answer: null, reason: evidence.reason, used: false, evidence };
  }

  /* A question with more than one part is a multi-part question: the corpus
     can answer the first part and not the second, and a half-answer that
     looks complete is worse than a full answer from the model. */
  const numberedParts = (text.match(/(?:^|[۰-۹0-9]\s*[).،\-:])/g) || []).length;
  if (numberedParts >= 2) {
    evidence.reason = 'multi-part-question';
    evidence.skippedFor = 'multi-part';
    return { answer: null, reason: evidence.reason, used: false, evidence };
  }

  /* RULE 2 — a live question is never answered locally. */
  const freshness = evidence.freshness;
  if (freshness === 'LIVE' || freshness === 'BREAKING' || freshness === 'RECENT') {
    evidence.reason = 'needs-live-data';
    evidence.skippedFor = 'freshness';
    return { answer: null, reason: evidence.reason, used: false, evidence };
  }
  if (evidence.needsWeb) {
    evidence.reason = 'needs-web-research';
    evidence.skippedFor = 'needsWeb';
    return { answer: null, reason: evidence.reason, used: false, evidence };
  }

  /* RULE 1 — without a strong, verified hit there is nothing to answer with. */
  const rows = Array.isArray(knowledge) ? knowledge : [];
  const best = rows
    .filter((k) => k && k.status !== 'deprecated')
    .map((k) => ({ row: k, score: Number(k.score || 0) }))
    .sort((a, b) => b.score - a.score)[0];

  evidence.score = best?.score || 0;
  evidence.matched = best?.row?.id || null;

  if (!best || best.score < minScore) {
    evidence.reason = 'no-strong-match';
    return { answer: null, reason: evidence.reason, used: false, evidence };
  }

  /* A question that names a live asset AND asks for its value needs the
     price, not the definition. The corpus holds definitions; it does not
     hold today's numbers. */
  const asksForLiveValue = /(?:قیمت|چنده|price|how much is|ارزش\s*الان|امروز\s*چند)/i.test(text);
  const hasLivePrice = Boolean(context?.market?.priceMap && Object.keys(context.market.priceMap).length);
  if (asksForLiveValue && !hasLivePrice) {
    evidence.reason = 'asks-for-live-value';
    evidence.skippedFor = 'live-value';
    return { answer: null, reason: evidence.reason, used: false, evidence };
  }

  /* Ask the local reasoner. It may still decline — and if it declines, the
     pipeline runs, which is the whole point of RULE 1. */
  let synth = null;
  try {
    synth = synthesize({
      message: text,
      locale,
      context,
      knowledge: rows,
      sources: [],
      subQuestions: [],
      economistLenses: [],
      professorLenses: [],
      /*
       * The SAFETY reads are NOT null here. The reasoner's containment
       * contract fires on `socialRead.distress` and on
       * `emotionRead.acute` (grief / shame / burnout at intensity ≥ 0.7),
       * and the local path passes those two reads as null — so the
       * containment was silently lost on exactly the turns where it
       * mattered most.
       *
       * The caller passes the REAL reads. A distressed person who also
       * asked about fees gets the safety reply, not the fee sheet.
       */
      socialRead: socialRead || null,
      emotionRead: emotionRead || null,
      situationRead: null,
      discourseRead: null,
      dialogueRead: null,
      marketFrame: null,
      strategyFrame: null,
      decisionEvidence: null,
      partialRead: null,
      productRead: null,
      plan
    });
  } catch {
    synth = null;
  }

  if (!synth?.ok || !String(synth.answer || '').trim()) {
    evidence.reason = 'local-reasoner-declined';
    return { answer: null, reason: evidence.reason, used: false, evidence };
  }

  const answer = String(synth.answer).trim();
  if (answer.length < minAnswerChars) {
    evidence.reason = 'local-answer-too-short';
    return { answer: null, reason: evidence.reason, used: false, evidence };
  }

  evidence.reason = 'answered-from-verified-knowledge';
  return {
    answer,
    reason: evidence.reason,
    used: true,
    evidence: {
      ...evidence,
      internalSynthesis: Boolean(synth.internalSynthesis),
      knowledgeUsed: Boolean(synth.knowledgeUsed),
      answerChars: answer.length
    }
  };
}
