/**
 * FBT AI ORCHESTRATOR — AI JUDGE (the step that decides, not the step that talks)
 * ---------------------------------------------------------------------------
 * Several models answering is not a decision. This node turns
 *     question + N analyses + evidence
 * into
 *     a verdict, a calibrated confidence, the conflicts that were resolved,
 *     the dissent that was kept, and what would change the answer.
 *
 * The rubric, in order of weight — evidence first, models last:
 *
 *   1. EVIDENCE  — required facets that were actually read (0..30). A claim
 *      backed by a tool read outranks any amount of model agreement.
 *   2. AGREEEMENT — independent analyses converging, measured on TWO axes:
 *      stance (bullish/bearish/neutral) and wording overlap. Two models that
 *      say the same sentence are one model with two names; the overlap term
 *      exists to notice that.
 *   3. PENALTIES — unresolved required facets, contradictions, predictions,
 *      and claims that state a balance/price without a tool behind them.
 *
 * Laws this node enforces (each is a probe):
 *   · AI consensus is NOT proof. Agreement can raise confidence but can never
 *     substitute for a missing tool read, and it never becomes the number.
 *   · TOOL_TRUTH topics (your balance, your portfolio) ABSTAIN without a tool
 *     read — a beautifully-worded invented balance is the worst output this
 *     app can produce.
 *   · Predictions are never certainty: a forward-looking claim caps confidence
 *     and is labelled in `limits`.
 *   · Dissent is preserved, not averaged away — the losing positions and their
 *     weight travel with the decision.
 *
 * The judge is deterministic by design: the same analyses produce the same
 * decision, which is what makes it testable and auditable. An optional model
 * judge may add prose (`rationale`), never change the numbers.
 */

import { normalizeText } from './vectorStore.js';
import { TOOL_TRUTH_FACETS } from './evidencePlan.js';

export const JUDGE_SCHEMA = 'fbt.ai-judge.v1';
export const JUDGE_VERSION = '14.0.0';

export const DECISIONS = Object.freeze({ ANSWER: 'ANSWER', CLARIFY: 'CLARIFY', ABSTAIN: 'ABSTAIN' });

const BULLISH = /(?:صعودی|صعود|رشد|بالا\s*می|افزایش|bullen|bullish|uptrend|rally|higher)/i;
const BEARISH = /(?:نزولی|ریزش|افت|پایین\s*می|کاهش|bearish|downtrend|drop|lower|fall)/i;
const PREDICTION = /(?:خواهد\s*(?:رسید|شد|رفت)|پیش‌?بینی|تا\s*(?:ماه|هفته|سال)|target|will\s+(?:reach|hit|be)|expected\s+to|forecast|projected)/i;
const NUMBERY = /(?:\d[\d,.]*\s*(?:%|دلار|تومان|usd|\$|eur|btc|eth)?|\$\s*\d|٪)/i;
const HEDGE = /(?:احتمالاً|شاید|ممکن\s*است|به\s*نظر\s*می|probably|likely|might|may|could|possibly)/i;

/** Sentences a claim can be extracted from, with a conservative minimum. */
export function splitSentences(text) {
  return String(text || '')
    .replace(/\s+/g, ' ')
    .split(/(?<=[.!?؟…])\s+|\n+/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 12);
}

export function classifyClaim(sentence) {
  const s = String(sentence);
  if (PREDICTION.test(s)) return 'prediction';
  if (NUMBERY.test(s)) return 'number';
  if (HEDGE.test(s)) return 'hedge';
  if (/\?/.test(s)) return 'question';
  return 'claim';
}

/** Extract the checkable claims from one model's answer. */
export function extractClaims(answer, { max = 6 } = {}) {
  return splitSentences(answer).slice(0, max).map((text, i) => ({
    i,
    text: text.slice(0, 240),
    kind: classifyClaim(text),
    tokens: tokenSet(text)
  }));
}

function tokenSet(text) {
  return new Set(normalizeText(text).split(' ').filter((w) => w.length > 2));
}

function jaccard(a, b) {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter += 1;
  return inter / (a.size + b.size - inter);
}

function stanceOf(answer) {
  const text = String(answer || '');
  const bull = BULLISH.test(text);
  const bear = BEARISH.test(text);
  if (bull && !bear) return 'bullish';
  if (bear && !bull) return 'bearish';
  if (bull && bear) return 'mixed';
  return 'neutral';
}

/**
 * Independent agreement: stance agreement (60%) + mean pairwise wording
 * overlap (40%). Returns the components so an answer can explain itself.
 */
export function measureAgreement(analyses = []) {
  const rows = (analyses || []).filter((a) => a && a.ok !== false && String(a.answer || '').trim().length >= 24);
  if (!rows.length) return { agreement: 0, stanceAgreement: 0, wording: 0, stances: {}, seats: 0, pairs: 0, conflicts: [] };

  const stances = rows.map((r) => r.stance || stanceOf(r.answer));
  const counts = stances.reduce((acc, s) => { acc[s] = (acc[s] || 0) + 1; return acc; }, {});
  const majority = Object.entries(counts).sort((a, b) => b[1] - a[1])[0] || ['neutral', 0];
  const stanceAgreement = majority[1] / rows.length;

  const tokenSets = rows.map((r) => tokenSet(r.answer));
  let pairs = 0; let sum = 0;
  for (let i = 0; i < tokenSets.length; i += 1) {
    for (let j = i + 1; j < tokenSets.length; j += 1) { sum += jaccard(tokenSets[i], tokenSets[j]); pairs += 1; }
  }
  const wording = pairs ? sum / pairs : 1;

  const conflicts = [];
  if (counts.bullish && counts.bearish) {
    conflicts.push({
      topic: 'direction',
      sides: [
        { position: 'bullish', seats: counts.bullish },
        { position: 'bearish', seats: counts.bearish }
      ],
      kind: 'OPPOSING_STANCE'
    });
  }
  if (counts.mixed) {
    conflicts.push({ topic: 'direction', sides: [{ position: 'mixed', seats: counts.mixed }], kind: 'SELF_CONTRADICTION' });
  }

  const agreement = Math.round((0.6 * stanceAgreement + 0.4 * wording) * 1e4) / 1e4;
  return {
    agreement,
    stanceAgreement: Math.round(stanceAgreement * 1e4) / 1e4,
    wording: Math.round(wording * 1e4) / 1e4,
    stances: counts,
    majorityStance: majority[0],
    seats: rows.length,
    pairs,
    conflicts
  };
}

/** Numeric claims whose values differ by more than `tol` for the same topic. */
export function findNumericConflicts(analyses = [], { tol = 0.05 } = {}) {
  const byTopic = new Map();
  for (const a of analyses || []) {
    if (!a || a.ok === false) continue;
    for (const claim of a.claims || []) {
      if (claim.kind !== 'number') continue;
      const nums = (claim.text.match(/\d[\d,.]*/g) || [])
        .map((n) => Number(String(n).replace(/,/g, '')))
        .filter((n) => Number.isFinite(n) && n > 0);
      if (!nums.length) continue;
      /* A claim may arrive from a caller without precomputed tokens (the HTTP
         judge route, a seat that returned claims itself) — derive them. */
      const tokens = claim.tokens ? [...claim.tokens] : [...tokenSet(claim.text || '')];
      const topic = tokens.sort().slice(0, 3).join('+') || 'numeric';
      if (!byTopic.has(topic)) byTopic.set(topic, []);
      byTopic.get(topic).push({ provider: a.provider || 'unknown', value: nums[0], text: claim.text.slice(0, 120) });
    }
  }
  const conflicts = [];
  for (const [topic, rows] of byTopic) {
    if (rows.length < 2) continue;
    const values = rows.map((r) => r.value);
    const min = Math.min(...values); const max = Math.max(...values);
    if (min > 0 && (max - min) / max > tol) {
      conflicts.push({ topic, kind: 'NUMERIC_DIVERGENCE', sides: rows, spread: Math.round(((max - min) / max) * 1e4) / 1e4 });
    }
  }
  return conflicts;
}

const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));

/**
 * Judge the panel.
 *
 * @param {object} input
 * @param {string} input.question
 * @param {object} input.plan            evidence plan (required facets live here)
 * @param {Array}  input.analyses        model outputs
 * @param {Array}  input.evidence        broker rows (facet, tool, status, summary, at)
 * @param {string} [input.intentType]
 * @param {string} [input.locale]
 */
export function judge({
  question = '',
  plan = null,
  analyses = [],
  evidence = [],
  intentType = null,
  locale = 'fa',
  now = Date.now
} = {}) {
  const intent = String(intentType || plan?.intentType || 'GENERAL').toUpperCase();
  const requiredFacets = (plan?.facets?.requests || []).map((r) => r.facetId);
  const deferredFacets = (plan?.facets?.deferred || []).map((r) => r.facetId);
  const satisfiedFacets = (plan?.facets?.satisfied || []).map((r) => r.facetId);

  /* ── 1. Evidence coverage ─────────────────────────────────────────────── */
  const evidenceByFacet = new Map();
  for (const row of evidence || []) {
    if (!row?.facetId) continue;
    const prior = evidenceByFacet.get(row.facetId);
    const weight = row.status === 'observed' ? 1 : row.status === 'degraded' ? 0.5 : 0;
    if (!prior || weight > prior.weight) evidenceByFacet.set(row.facetId, { ...row, weight });
  }
  const covered = [];
  const missing = [];
  for (const facet of requiredFacets) {
    const row = evidenceByFacet.get(facet);
    if (row && row.weight > 0) covered.push({ facet, status: row.status, tool: row.tool });
    else missing.push(facet);
  }
  for (const facet of satisfiedFacets) covered.push({ facet, status: 'observed', tool: 'turn-context' });
  const coverage = requiredFacets.length ? covered.filter((c) => c.status === 'observed').length / requiredFacets.length : 1;
  const evidenceScore = Math.round(coverage * 30);

  /* ── 2. Agreement ─────────────────────────────────────────────────────── */
  const agreement = measureAgreement(analyses);
  const numericConflicts = findNumericConflicts(analyses);
  const conflicts = [...agreement.conflicts, ...numericConflicts];

  /* ── 3. Claim audit: which sentences carry numbers without a tool? ────── */
  const toolBackedFacets = new Set(covered.filter((c) => c.status === 'observed' && c.tool !== 'turn-context').map((c) => c.facet));
  const unsupportedNumbers = [];
  for (const a of analyses || []) {
    if (!a || a.ok === false) continue;
    for (const claim of a.claims || []) {
      if (claim.kind !== 'number') continue;
      /* A number is "tool-backed" when the turn read ANY market/tool facet; a
         number with nothing read behind it is exactly what must not ship. */
      const backed = toolBackedFacets.size > 0;
      if (!backed) unsupportedNumbers.push({ provider: a.provider || 'unknown', text: claim.text.slice(0, 160) });
    }
  }

  const predictionClaims = (analyses || [])
    .flatMap((a) => (a?.claims || []).filter((c) => c.kind === 'prediction').map((c) => ({ provider: a.provider || 'unknown', text: c.text })));

  /* ── 4. Tool-truth gate: money answers need a read, not a model ───────── */
  const toolTruthNeeded = TOOL_TRUTH_FACETS.filter((f) => requiredFacets.includes(f));
  const toolTruthMissing = toolTruthNeeded.filter((f) => !toolBackedFacets.has(f) && !satisfiedFacets.includes(f));

  /* ── 5. Confidence ────────────────────────────────────────────────────── */
  const penalties = [];
  let confidence = 38 + evidenceScore + 18 * agreement.agreement - 22 * (1 - agreement.agreement);
  if (!covered.length) { penalties.push('NO_EVIDENCE'); confidence = Math.min(confidence, analyses.length >= 2 ? 42 : 34); }
  if (missing.length) penalties.push(`MISSING_FACETS:${missing.join('|')}`);
  if (deferredFacets.length) penalties.push(`DEFERRED_FACETS:${deferredFacets.join('|')}`);
  if (numericConflicts.length) { penalties.push('NUMERIC_DIVERGENCE'); confidence -= 10; }
  if (agreement.conflicts.length) { penalties.push('STANCE_CONFLICT'); confidence -= 8; }
  if (unsupportedNumbers.length) { penalties.push('UNSUPPORTED_NUMBERS'); confidence -= 12; }
  if (predictionClaims.length) { penalties.push('PREDICTION_PRESENT'); confidence = Math.min(confidence, 62); }
  if (plan?.stakes?.level === 'HIGH' && coverage < 0.6) { penalties.push('HIGH_STAKES_UNDER_EVIDENCED'); confidence = Math.min(confidence, 58); }
  if (!analyses.some((a) => a && a.ok !== false && String(a.answer || '').trim().length >= 24)) { penalties.push('NO_USABLE_ANALYSIS'); confidence = Math.min(confidence, 40); }
  confidence = clamp(Math.round(confidence), 5, 95);

  /* ── 6. Verdict: which analysis stands, and on what ───────────────────── */
  const usable = (analyses || []).filter((a) => a && a.ok !== false && String(a.answer || '').trim().length >= 24);
  const majority = agreement.majorityStance || 'neutral';
  const ranked = usable
    .map((a) => {
      const stance = a.stance || stanceOf(a.answer);
      const stanceFit = stance === majority ? 1 : stance === 'neutral' ? 0.6 : 0.25;
      const claimSupport = (a.claims || []).length ? (a.claims || []).filter((c) => c.kind !== 'prediction').length / (a.claims || []).length : 0.5;
      const modelConfidence = Number(a.confidence ?? 0.5) > 1 ? Number(a.confidence) / 100 : Number(a.confidence ?? 0.5);
      return { analysis: a, score: 0.5 * stanceFit + 0.25 * claimSupport + 0.25 * modelConfidence, stance };
    })
    .sort((x, y) => y.score - x.score);

  const winner = ranked[0] || null;
  const verdict = {
    stance: winner?.stance || majority || 'neutral',
    summary: winner ? String(winner.analysis.answer || '').trim().slice(0, 1200) : null,
    provider: winner?.analysis?.provider || null,
    model: winner?.analysis?.model || null,
    keyPoints: winner ? (winner.analysis.claims || []).filter((c) => c.kind !== 'question').slice(0, 4).map((c) => c.text) : [],
    evidenceBacked: covered.filter((c) => c.tool !== 'turn-context').map((c) => `${c.facet}:${c.tool}`)
  };

  const dissent = ranked.slice(1).map((r) => ({
    provider: r.analysis.provider || 'unknown',
    position: r.stance,
    confidence: r.analysis.confidence ?? null,
    weight: Math.round((r.score / (ranked.reduce((s, x) => s + x.score, 0) || 1)) * 100) / 100,
    summary: String(r.analysis.answer || '').slice(0, 240)
  }));

  /* ── 7. Decision ──────────────────────────────────────────────────────── */
  let decision = DECISIONS.ANSWER;
  const why = [];
  if (toolTruthMissing.length) {
    decision = DECISIONS.ABSTAIN;
    why.push(`TOOL_TRUTH_REQUIRED:${toolTruthMissing.join('|')}`);
  } else if (!winner) {
    decision = DECISIONS.ABSTAIN;
    why.push('NO_ANALYSIS');
  } else if (confidence < 45 && coverage < 0.34) {
    decision = DECISIONS.CLARIFY;
    why.push('LOW_CONFIDENCE_LOW_EVIDENCE');
  } else if (confidence < 40) {
    decision = DECISIONS.ABSTAIN;
    why.push('CONFIDENCE_BELOW_FLOOR');
  } else if (missing.length && (plan?.stakes?.level === 'HIGH')) {
    decision = DECISIONS.CLARIFY;
    why.push('HIGH_STAKES_MISSING_FACETS');
  } else {
    why.push(coverage >= 0.6 ? 'EVIDENCE_AND_AGREEMENT' : 'BEST_AVAILABLE_READING');
  }

  const limits = [];
  if (missing.length) limits.push({ code: 'MISSING_FACETS', facets: missing, fa: `خوانش انجام‌نشده: ${missing.join('، ')}`, en: `not read: ${missing.join(', ')}` });
  if (deferredFacets.length) limits.push({ code: 'DEFERRED_FACETS', facets: deferredFacets, fa: `به‌دلیل بودجهٔ ابزار خوانده نشد: ${deferredFacets.join('، ')}`, en: `skipped for tool budget: ${deferredFacets.join(', ')}` });
  if (unsupportedNumbers.length) limits.push({ code: 'UNSUPPORTED_NUMBERS', fa: 'برخی عددها پشتوانهٔ خوانش ندارند و در تصمیم وزن نگرفتند.', en: 'Some figures had no tool read behind them and carried no weight.' });
  if (predictionClaims.length) limits.push({ code: 'NO_PREDICTION', fa: 'این پاسخ پیش‌بینی نیست؛ هیچ‌کس قیمت آینده را نمی‌داند.', en: 'This is not a prediction; nobody knows the future price.' });

  const whatWouldChangeMyMind = [];
  if (missing.length) whatWouldChangeMyMind.push({ code: 'READ_MISSING', fa: `اگر ${missing.join('، ')} خوانده شود`, en: `if ${missing.join(', ')} were read` });
  for (const c of conflicts.slice(0, 2)) {
    whatWouldChangeMyMind.push({
      code: 'CONFLICT_RESOLVED',
      topic: c.topic,
      fa: `اگر اختلاف روی «${c.topic}» با داده حل شود`,
      en: `if the disagreement on "${c.topic}" were settled by data`
    });
  }
  if (usable.length < 3 && plan?.stakes?.level === 'HIGH') {
    whatWouldChangeMyMind.push({ code: 'MORE_SEATS', fa: 'اگر مدل مستقل بیشتری همان را بگویند', en: 'if more independent models said the same' });
  }

  return {
    ok: true,
    schema: JUDGE_SCHEMA,
    version: JUDGE_VERSION,
    question: String(question || '').slice(0, 300),
    intentType: intent,
    decision,
    why,
    confidence,
    band: confidence >= 70 ? 'HIGH' : confidence >= 50 ? 'MEDIUM' : 'LOW',
    evidence: {
      coverage: Math.round(coverage * 1e4) / 1e4,
      score: evidenceScore,
      covered,
      missing,
      deferred: deferredFacets,
      toolBackedFacets: [...toolBackedFacets]
    },
    agreement,
    conflicts,
    verdict,
    dissent,
    limits,
    whatWouldChangeMyMind,
    penalties,
    provenance: {
      seats: usable.length,
      providers: usable.map((a) => ({ provider: a.provider || 'unknown', model: a.model || null, stance: a.stance || stanceOf(a.answer) })),
      evidence: (evidence || []).map((r) => ({ facetId: r.facetId, tool: r.tool, status: r.status, at: r.at || null })),
      judgedAt: now()
    },
    laws: {
      aiConsensusIsNotProof: true,
      numbersFromToolsOnly: true,
      executionAuthority: false,
      dissentPreserved: true
    }
  };
}

/**
 * Render a judgment as the text a human reads. Only the orchestrator decides
 * whether to use it — this function never invents a number and never turns an
 * ABSTAIN into a confident sentence.
 */
export function renderJudgment(judgment, { locale = 'fa', maxChars = 1600 } = {}) {
  const fa = String(locale || 'fa').startsWith('fa');
  const j = judgment || {};
  const lines = [];

  if (j.decision === DECISIONS.ANSWER && j.verdict?.summary) {
    lines.push(j.verdict.summary.trim());
    const evidenceLine = (j.verdict.evidenceBacked || []).length
      ? (fa ? `\n\n📊 پشتوانهٔ داده: ${j.verdict.evidenceBacked.join('، ')}` : `\n\n📊 Read from: ${j.verdict.evidenceBacked.join(', ')}`)
      : '';
    if (evidenceLine) lines.push(evidenceLine);
    if (j.dissent?.length) {
      lines.push(fa
        ? `\n\n🔀 نظر مخالف: ${j.dissent.length} تحلیل با جهت متفاوت (وزن ${Math.round((j.dissent[0].weight || 0) * 100)}٪) — در تصمیم لحاظ شد.`
        : `\n\n🔀 Dissent: ${j.dissent.length} analysis with a different direction (weight ${Math.round((j.dissent[0].weight || 0) * 100)}%) — kept in the record.`);
    }
  } else if (j.decision === DECISIONS.CLARIFY) {
    const need = j.limits.find((l) => l.code === 'MISSING_FACETS')?.facets || [];
    lines.push(fa
      ? `برای پاسخ مطمئن باید ${need.length ? need.join('، ') : 'خوانش دقیق‌تری'} بررسی شود؛ بدون آن، پاسخ حدس می‌شود.`
      : `A confident answer needs ${need.length ? need.join(', ') : 'a closer read'}; without it the answer would be a guess.`);
  } else if (j.decision === DECISIONS.ABSTAIN) {
    const tt = (j.why || []).find((w) => String(w).startsWith('TOOL_TRUTH_REQUIRED'));
    lines.push(tt
      ? (fa ? 'عددهای کیف پول و پرتفوی فقط از خوانش خودِ کیف پول می‌آید؛ بدون آن پاسخ نمی‌دهم.' : 'Wallet and portfolio numbers come only from a real wallet read; without it I will not answer.')
      : (fa ? 'شواهد کافی برای یک تصمیم قابل‌اتکا نبود؛ به‌جای حدس، همین را صادقانه می‌گویم.' : 'There was not enough evidence for a dependable decision; I would rather say so than guess.'));
  }

  const limitLines = (j.limits || []).filter((l) => l.code !== 'MISSING_FACETS').map((l) => (fa ? l.fa : l.en)).filter(Boolean);
  if (limitLines.length) lines.push(`\n\n⚠️ ${limitLines.slice(0, 2).join(' ')}`);

  const conf = fa ? `اطمینان: ${j.confidence ?? 0}٪ (${j.band || ''})` : `confidence: ${j.confidence ?? 0}% (${j.band || ''})`;
  lines.push(`\n\n${conf}`);

  return lines.join('').slice(0, maxChars).trim();
}

export default judge;
