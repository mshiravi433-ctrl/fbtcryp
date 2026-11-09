/**
 * FBT AI — DECISION GATE (may this turn issue a recommendation at all?)
 * ---------------------------------------------------------------------------
 * Most AI answers are read as advice whether or not advice was asked for. The
 * dangerous case is narrow and specific: the user asks for a DECISION («الان
 * بخرم؟», «نگه دارم یا بفروشم؟»), the evidence is thin — no live market, no
 * source, nothing verified — and the answer still says "buy" in a confident
 * sentence. Three models agreeing does not make that evidence.
 *
 * This gate is deterministic and runs before the answer is written:
 *
 *   1. is this a decision question at all?
 *   2. how much evidence does the turn actually have? (scored from what is in
 *      the context, the citations, the internal knowledge, the analyses and
 *      the claim ledger — nothing is fetched)
 *   3. what is the only defensible verdict at that level?
 *        sufficient  → a recommendation is allowed, with its condition
 *        partial     → only a conditional recommendation
 *        thin        → no-action or a conditional plan; name what is missing
 *   4. after the draft: did the answer obey it? A bare directional instruction
 *      on thin/partial evidence is a DEFICIT handed to the reviewer.
 *
 * Negations and the safe direction are respected: «توصیه نمی‌کنم بخرید» and
 * «نخر» are not violations — refusing to act is always allowed.
 */

export const DECISION_GATE_SCHEMA = 'fbt.ai-decision-gate.v1';

/* Asking for a decision, not for information. */
const DECISION_ASK_RE = /(بخرم|بخواهم بخرم|بفروشم|نگه\s*دارم|بورسم|وارد\s*شوم|خارج\s*شوم|چی\s*کار\s*کنم|چیکار\s*کنم|چه\s*کار\s*کنم|تصمیم|به\s*صلاح|should\s+i|buy\s+or|sell\s+or|hold\s+or|what\s+should\s+i\s+do|worth\s+(?:buying|investing)|is\s+it\s+(?:time|a\s+good\s+time)\s+to)/i;

/* A directional instruction (the thing thin evidence may not carry). */
const ADVICE_RE = /(بخر|بخرید|بخرش|بفروش|بفروشید|بفروشش|وارد\s*شو|وارد\s*شوید|خارج\s*شو|نگه\s*دار|نگهدار|بنداز|\bbuy\b|\bsell\b|\bhold\b|\bgo\s+long\b|\bgo\s+short\b|recommend\s+(?:buying|selling|holding))/gi;

/* A condition turns an instruction into a plan. */
const CONDITION_RE = /(اگر|در\s*صورت|به\s*شرط|مشروط|شرطش|تنها\s*در|فقط\s*در\s*صورت|unless|\bif\b|only\s+if|conditional|as\s+long\s+as)/i;

/* The safe direction: telling someone NOT to act is never the dangerous case. */
const SAFE_DIRECTION_RE = /(نخر|نخرید|نفروش|نگه\s*ندار|صبر\s*کن|دست\s*نگه\s*دار|عجله\s*نکن|do\s+not\s+buy|don'?t\s+buy|do\s+not\s+sell|don'?t\s+sell|wait)/i;

/* A negation anywhere in the run-up to the verb negates it («توصیه نمی‌کنم
   بخرید», «do not buy»). Checking only the final characters missed Persian,
   where the verb form is «نمی‌کنم» and the sentence continues. */
const NEGATION_RE = /(نمی|نه|بدون|never|do\s+not|don'?t|\bnot\b)/i;

function hasDirectionalAdvice(text) {
  const body = String(text || '');
  const re = new RegExp(ADVICE_RE.source, 'gi');
  let m;
  while ((m = re.exec(body)) !== null) {
    const before = body.slice(Math.max(0, m.index - 16), m.index);
    if (NEGATION_RE.test(before)) continue;
    return true;
  }
  return false;
}

/**
 * Score the evidence available to THIS turn. No fetching, no guessing: every
 * point comes from something already in hand, and every point is named.
 */
export function assessEvidence({ context = {}, sources = [], knowledge = [], comparison = null, ledger = null } = {}) {
  const reasons = [];
  let score = 0;

  const market = context?.market;
  const hasPrices = Boolean(market?.priceMap && Object.keys(market.priceMap).length);
  const status = market?.dataStatus;
  if (hasPrices && (!status || status === 'live')) {
    score += 2;
    reasons.push('live_market');
  } else if (status && status !== 'live') {
    score -= 1;
    reasons.push('stale_market');
  }

  if (Number.isFinite(Number(context?.portfolio?.totalValueUsd))) {
    score += 1;
    reasons.push('portfolio');
  }

  const sourceCount = Array.isArray(sources) ? sources.length : 0;
  if (sourceCount >= 3) {
    score += 2;
    reasons.push('multiple_sources');
  } else if (sourceCount >= 1) {
    score += 1;
    reasons.push('one_source');
  }

  if (Array.isArray(knowledge) && knowledge.length) {
    score += 1;
    reasons.push('internal_knowledge');
  }

  if (comparison) {
    const agreement = String(comparison.agreement || '');
    const [agree, total] = agreement.split('/').map(Number);
    if (Number.isFinite(agree) && Number.isFinite(total) && total > 0 && agree === total) {
      score += 1;
      reasons.push('models_agree');
    }
    if (comparison.disagreement) {
      score -= 1;
      reasons.push('models_disagree');
    }
  }

  if (ledger) {
    if (Number(ledger.verifiedCount) > 0) {
      score += 2;
      reasons.push('verified_claims');
    }
    if (Number(ledger.conflictCount) > 0) {
      score -= 1;
      reasons.push('conflicting_figures');
    }
  }

  const level = score >= 5 ? 'sufficient' : score >= 3 ? 'partial' : 'thin';
  const missing = ['live_market', 'verified_claims'].filter((r) => !reasons.includes(r));
  return { schema: DECISION_GATE_SCHEMA, level, score, reasons, missing };
}

/**
 * What this turn is allowed to decide.
 * @returns {{schema, applicable, asksDecision, evidence, verdict, recommendationDetected, conditional, compliant}}
 */
export function evaluateDecision({ message = '', evidence = null, answer = '' } = {}) {
  const ev = evidence || assessEvidence({});
  if (!DECISION_ASK_RE.test(String(message || ''))) {
    return {
      schema: DECISION_GATE_SCHEMA,
      applicable: false,
      asksDecision: false,
      evidence: ev,
      verdict: null,
      recommendationDetected: false,
      conditional: false,
      compliant: true
    };
  }
  const recommendationDetected = hasDirectionalAdvice(answer);
  const safeDirection = SAFE_DIRECTION_RE.test(String(answer || ''));
  const conditional = CONDITION_RE.test(String(answer || ''));
  const verdict = ev.level === 'sufficient' ? 'ALLOWED'
    : ev.level === 'partial' ? 'CONDITIONAL' : 'NO_ACTION_OR_CONDITIONAL';
  const compliant = ev.level === 'sufficient'
    || !recommendationDetected
    || safeDirection
    || conditional;
  return {
    schema: DECISION_GATE_SCHEMA,
    applicable: true,
    asksDecision: true,
    evidence: ev,
    verdict,
    recommendationDetected: recommendationDetected && !safeDirection,
    conditional,
    compliant
  };
}

/** The contract the specialists receive BEFORE writing. Empty for non-decisions. */
export function renderDecisionContract({ message = '', evidence = null } = {}) {
  if (!DECISION_ASK_RE.test(String(message || ''))) return '';
  const ev = evidence || assessEvidence({});
  const missing = ev.missing.length ? ` Missing: ${ev.missing.join(', ')}.` : '';
  if (ev.level === 'sufficient') {
    return 'DECISION GATE: this turn asks for a decision and the evidence level is SUFFICIENT. A recommendation is allowed — state its condition, its invalidation, and the confidence the evidence actually supports.';
  }
  if (ev.level === 'partial') {
    return `DECISION GATE: this turn asks for a decision and the evidence level is PARTIAL.${missing} Only a CONDITIONAL recommendation is defensible: every recommendation must carry its condition and say which reading would change it. Never a bare "buy" or "sell".`;
  }
  return `DECISION GATE: this turn asks for a decision and the evidence level is THIN.${missing} The only defensible answer is NO-ACTION or an explicitly conditional plan: name what is missing and which specific reading would settle it. Do not issue a bare directional instruction, and do not convert model agreement into evidence.`;
}

/** The reviewer's MUST-FIX when the draft broke the gate. Empty otherwise. */
export function renderDecisionDeficit(gate) {
  if (!gate || !gate.applicable || gate.compliant) return '';
  return `DECISION DEFICIT — the draft issues a directional recommendation on ${gate.evidence.level} evidence without a condition. `
    + 'Downgrade it to no-action or a conditional plan, add the missing evidence, or state exactly which reading would settle it. '
    + 'Do not soften the wording and keep the instruction.';
}

export default evaluateDecision;
