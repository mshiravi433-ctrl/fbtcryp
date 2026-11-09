/**
 * FBT INTENT OS — DIALOGUE READ (what this turn is DOING, and what it depends on)
 * ---------------------------------------------------------------------------
 * The social read answers «چه کسی این را می‌پرسد؟». This module answers the two
 * questions that decide whether the reply is *about the right thing*:
 *
 *   1. WHAT IS BEING ASKED — the shape of the question.
 *      «چرا؟» wants a mechanism. «چقدر؟» wants a number. «کدوم بهتره؟» wants a
 *      comparison with a verdict. «یعنی چی؟» wants a definition. A reply that
 *      answers a why-question with a checklist, or a quantity question with
 *      «بستگی دارد», has not misunderstood a word — it has answered a different
 *      question, which is the most common way an answer looks smart and is
 *      useless.
 *
 *   2. WHAT THE TURN IS DOING IN THE CONVERSATION — its act.
 *      A correction («نه، اشتباه گفتی», «منظورم این نبود») is not a new question:
 *      answering it as one means repeating the wrong thing louder. An elliptical
 *      follow-up («چرا؟», «همون رو بیشتر توضیح بده») is not a standalone question
 *      either: it points at something already said, and a reply that starts a
 *      fresh topic has dropped the thread.
 *
 * Everything here is deterministic, adds no model call, invents no fact, and
 * only runs in the smartest mode. `checkDialogueCompliance` runs on the draft
 * and on the final text, so a mismatch becomes a MUST-FIX for the reviewer
 * instead of a silent miss. The checks are deliberately narrow: each one fires
 * only when the ask is unambiguous and the answer lacks the ONE thing that ask
 * cannot do without.
 */

export const DIALOGUE_READ_SCHEMA = 'fbt.ai-dialogue-read.v1';
export const DIALOGUE_READ_VERSION = '1.0.0';

/* ── folding: Persian/Arabic digits, ZWNJ, Arabic yeh/kaf ─────────────────── */
const PERSIAN_DIGITS = /[\u06F0-\u06F9\u0660-\u0669]/g;

function fold(text) {
  return String(text || '')
    .replace(PERSIAN_DIGITS, (d) => String(d.charCodeAt(0) - (d.charCodeAt(0) >= 0x06F0 ? 0x06F0 : 0x0660)))
    .replace(/\u200c/g, ' ')
    .replace(/[\u064a\u0649]/g, 'ی')
    .replace(/\u0643/g, 'ک')
    .toLowerCase();
}

/** 4+ Persian letters match as a prefix (Persian inflects by suffix); short ones stay strict. */
function phrase(text, p) {
  const term = fold(p);
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const persian = /[\u0600-\u06FF]/.test(term);
  const tail = persian && term.replace(/[^\u0600-\u06FF]/g, '').length >= 4 ? '' : '(?![\\p{L}])';
  return new RegExp(`(?<![\\p{L}])${escaped}${tail}`, 'u').test(text);
}

const anyPhrase = (text, list) => list.some((p) => phrase(text, p));

/* ── vocabulary ───────────────────────────────────────────────────────────── */

const ASK_SHAPES = Object.freeze({
  QUANTITY: 'QUANTITY',
  CAUSAL: 'CAUSAL',
  METHOD: 'METHOD',
  COMPARISON: 'COMPARISON',
  DEFINITION: 'DEFINITION',
  YES_NO: 'YES_NO',
  PREDICTION: 'PREDICTION',
  OPEN: 'OPEN'
});

/* Persian patterns avoid `\b`: it is an ASCII word boundary, so «چرا\b»
   never matches a Persian word. `(?![\p{L}])` is the boundary we mean. */
const END_WORD = '(?![\\p{L}])';
const QUANTITY_RE = [
  /چقدر/, /چنده/, /چند\s*(?:تا|درصد|دلار|هزار|میلیون|ساله|وقت|روزه|ماه|سال)/,
  /چه\s*قیمت/, /قیمت(?:ش|شان)?\s*(?:چند|چقدر|چیه)/, /حجم(?:ش)?\s*چقدر/, /چند\s*میلیون/, /چند\s*هزار/,
  /\bhow\s+(?:much|many)\b/, /\bwhat(?:'s| is)\s+the\s+price\b/, /\bhow\s+big\b/
];
const CAUSAL_RE = [/^\s*چرا(?![\p{L}])/u, /چرا/, /به\s*چه\s*دلیل/, /دلیلش\s*چیه/, /\bwhy\b/, /\bhow\s+come\b/];
const METHOD_RE = [/چطور/, /چگونه/, /چه\s*جوری/, /به\s*چه\s*شکلی/, /\bhow\s+(?:do|can|should)\b/];
const COMPARISON_RE = [
  /کدوم/, /کدام/, /مقایسه/, /بهتر\s*(?:هست|است|ه)/, /\bvs\.?\b/, /\bversus\b/, /\bcompare\b/,
  /(?:btc|eth|بیت[\s]*کوین|اتریوم)\s*(?:یا|و)\s*(?:btc|eth|بیت[\s]*کوین|اتریوم)/
];
const DEFINITION_RE = [/یعنی\s*چی/, /یعنی\s*چیه/, /معنی(?:ش)?\s*چیه/, /تعریف/, /\bwhat\s+does\b.*\bmean\b/, /\bwhat\s+is\s+a\b/];
const YES_NO_RE = [/^\s*آیا/, /^\s*میشه/, /^\s*می\s*شه/, /^\s*هست/, /^\s*باید/, /\bis\s+it\b/, /\bshould\s+i\b/, /\bcan\s+i\b/, /\bdo\s+i\b/];
const PREDICTION_RE = [/پیش\s*بینی/, /تا\s*(?:ماه|سال|هفته)\s*(?:بعد|دیگه|آینده)/, /آینده/, /\bforecast\b/, /\bwill\b.*\b(?:go|reach|hit)\b/];

const CORRECTION_RE = [
  'اشتباه', 'غلط', 'منظورم این نبود', 'منظورم این', 'اینطور نبود', 'دوباره گفتی', 'باز گفتی',
  'قبلا گفتی', 'قبلاً گفتی', 'اصلاح', 'تصحیح', 'درست نیست', 'نه،', 'نه ',
  "that's wrong", 'that is wrong', 'you are wrong', "you're wrong", 'i said', 'i meant', 'incorrect'
];
const CORRECTION_ACK_RE = [
  'حق با', 'درست میگ', 'درست می‌گ', 'بله، اشتباه', 'اشتباه بود', 'اشتباه کردم', 'تصحیح', 'اصلاح می',
  'ممنون از تصحیح', 'دقیق‌تر بگم', 'دقیق تر بگم', 'درست است،', 'you are right', "you're right",
  'my mistake', 'i stand corrected', 'to correct', 'correction:'
];

const ANAPHORA_CUES = [
  'این', 'اون', 'آن', 'همون', 'همان', 'همین', 'بالا', 'قبلی', 'قبلاً', 'دوباره',
  'بیشتر توضیح', 'ادامه بده', 'بیشتر بگو', 'چرا؟', 'چرا', 'یعنی چی', 'یعنی چیه',
  'that', 'it', 'this', 'previous', 'above', 'more detail', 'go on', 'elaborate'
];
const REFERENT_MARKERS = ['همان', 'همون', 'منظورم', 'منظور از', 'که گفتم', 'قبلاً گفتم', 'بالاتر گفتم', 'the one i'];

const CLOSING_RE = ['مرسی کافیه', 'ممنون کافیه', 'کاری نیست', 'باشه مرسی', 'اوکی مرسی', 'فعلا خداحافظ', 'خداحافظ', 'thanks that', 'that is all', "that's all"];
const THANKS_RE = ['ممنون', 'مرسی', 'دستت درد نکنه', 'لطف کردی', 'thanks', 'thank you', 'appreciate'];

const DISTRESS_RE = [
  'همه پولمو', 'همه پولم', 'همه چیمو', 'همه چیمو', 'از دست دادم', 'نابود شدم', 'زندگی‌ام', 'زندگیم',
  'دیگه فایده', 'دیگه تحمل', 'خسته شدم از', 'میخوام بمیرم', 'به پایان', 'lost everything', 'ruined me'
];

const STOPWORDS = new Set([
  'که', 'این', 'برای', 'است', 'هست', 'بود', 'شود', 'شده', 'کرد', 'کند', 'کند؟', 'با', 'را', 'از', 'به',
  'در', 'می', 'هم', 'یا', 'و', 'تا', 'چه', 'چی', 'اون', 'آن', 'همان', 'همون', 'خیلی', 'الان', 'یک',
  'the', 'and', 'for', 'with', 'that', 'this', 'from', 'have', 'has', 'are', 'was', 'you', 'your', 'what'
]);

/** Words that are part of the REFERENCE itself, not content of their own. */
const CUE_WORDS = new Set([
  'چرا', 'یعنی', 'بیشتر', 'توضیح', 'ادامه', 'بگو', 'بده', 'بیشتر', 'دوباره', 'بالا', 'قبلی',
  'قبلا', 'همون', 'همان', 'همین', 'این', 'اون', 'آن', 'میشه', 'بگی', 'کنی', 'that', 'this',
  'previous', 'above', 'more', 'detail', 'elaborate', 'explain', 'again'
]);

/* Words that name a topic by category rather than by instance. A referent that
   is only one of these is too vague to check a reply against, so the referent
   check simply does not fire instead of nagging about «قیمت». */
const GENERIC_TOPIC = new Set([
  'قیمت', 'بازار', 'سرمایه', 'ریسک', 'پوزیشن', 'معامله', 'تحلیل', 'استراتژی', 'بازده',
  'درصد', 'دلار', 'تتر', 'کیف', 'پول', 'سود', 'ضرر', 'بیت', 'کوین', 'اتریوم',
  'price', 'market', 'capital', 'risk', 'position', 'trade', 'analysis', 'strategy'
]);

function contentWords(text, limit = 12) {
  const seen = new Set();
  const out = [];
  for (const raw of fold(text).split(/[^\p{L}\p{N}]+/u)) {
    const w = raw.trim();
    if (w.length < 4 || STOPWORDS.has(w) || seen.has(w)) continue;
    seen.add(w);
    out.push(w);
    if (out.length >= limit) break;
  }
  return out;
}

/* ── the read ─────────────────────────────────────────────────────────────── */

/**
 * Read the ask shape and the conversational act of one turn.
 *
 * `history` is the previous context summary (the same string the social read
 * receives). Without it, an elliptical follow-up is still recognised as
 * elliptical, but nothing is claimed about what it refers to.
 */
export function readDialogue({ message = '', locale = 'fa', history = '', social = null } = {}) {
  const raw = String(message || '').trim();
  const text = fold(raw);
  const historyText = fold(history);
  const words = raw.split(/\s+/).filter(Boolean);
  const hasHistory = historyText.trim().length > 0;
  const historyWords = hasHistory ? contentWords(raw.length ? history : '') : [];
  const signals = [];

  /* ── ask shape ─────────────────────────────────────────────────────────── */
  /* «چرا» outranks «چقدر»: «چرا قیمت ۱۲٪ ریخت؟» is a causal question that
     happens to contain a number and the word «قیمت». */
  let askShape = ASK_SHAPES.OPEN;
  if (CAUSAL_RE.some((r) => r.test(text))) askShape = ASK_SHAPES.CAUSAL;
  else if (QUANTITY_RE.some((r) => r.test(text))) askShape = ASK_SHAPES.QUANTITY;
  else if (COMPARISON_RE.some((r) => r.test(text))) askShape = ASK_SHAPES.COMPARISON;
  else if (DEFINITION_RE.some((r) => r.test(text))) askShape = ASK_SHAPES.DEFINITION;
  else if (METHOD_RE.some((r) => r.test(text))) askShape = ASK_SHAPES.METHOD;
  else if (PREDICTION_RE.some((r) => r.test(text))) askShape = ASK_SHAPES.PREDICTION;
  else if (YES_NO_RE.some((r) => r.test(text))) askShape = ASK_SHAPES.YES_NO;

  /* ── conversational act ────────────────────────────────────────────────── */
  const distress = anyPhrase(text, DISTRESS_RE);
  const correction = anyPhrase(text, CORRECTION_RE) && !distress;
  const closing = words.length <= 5 && anyPhrase(text, CLOSING_RE);
  const thanks = !closing && anyPhrase(text, THANKS_RE) && words.length <= 8;
  const hasQuestionMark = /[?؟]/.test(raw);
  /*
   * Elliptical means «nothing but the reference». «چرا BTC ریخت؟» is a full
   * question that happens to contain «چرا»; the test is whether any
   * substantive word is left once the cue words are removed.
   */
  const remainder = contentWords(raw).filter((w) => !CUE_WORDS.has(w));
  const elliptical = words.length <= 7
    && (hasQuestionMark || words.length <= 6)
    && anyPhrase(text, ANAPHORA_CUES)
    && remainder.length === 0;

  let act = 'QUESTION';
  if (distress) act = 'DISTRESS';
  else if (closing) act = 'CLOSING';
  else if (correction) act = 'CORRECTION';
  else if (thanks) act = 'THANKS';
  else if (elliptical) act = 'FOLLOW_UP';
  else if (askShape === ASK_SHAPES.YES_NO) act = 'CONFIRMATION_SEEK';
  else if (askShape === ASK_SHAPES.OPEN && !hasQuestionMark && !/^\s*(?:تحلیل|بررسی|بگو|بذار|بساز|پیشنهاد|calculate|analy[sz]e|plan)/.test(text)) act = 'STATEMENT';

  if (act === 'CORRECTION') signals.push('correction');
  if (act === 'FOLLOW_UP') signals.push('elliptical_follow_up');
  if (distress) signals.push('distress');
  if (askShape !== ASK_SHAPES.OPEN) signals.push(`ask:${askShape}`);

  /* The referent of a follow-up: the last substantive thing that was said. */
  const referentWords = act === 'FOLLOW_UP' && hasHistory
    ? contentWords(historyText, 14).filter((w) => !GENERIC_TOPIC.has(w))
    : [];

  const applicable = !distress
    && act !== 'THANKS'
    && act !== 'CLOSING'
    && (act === 'CORRECTION' || act === 'FOLLOW_UP' || askShape !== ASK_SHAPES.OPEN || (social?.need === 'decision'));

  return {
    schema: DIALOGUE_READ_SCHEMA,
    version: DIALOGUE_READ_VERSION,
    locale,
    act,
    askShape,
    applicable,
    signals,
    distress,
    correction: act === 'CORRECTION',
    followUp: act === 'FOLLOW_UP',
    history: { available: hasHistory, words: historyWords.slice(0, 8) },
    referent: { words: referentWords.slice(0, 10), resolvesTo: referentWords[0] || null },
    question: hasQuestionMark,
    wordCount: words.length
  };
}

/**
 * What the answer owes this turn. Empty for an open statement: an ordinary
 * request keeps the prompt it always had.
 */
export function renderDialogueBrief(read) {
  if (!read || read.schema !== DIALOGUE_READ_SCHEMA || !read.applicable) return '';
  const lines = [];

  if (read.act === 'CORRECTION') {
    lines.push('- they are CORRECTING the previous answer, not asking a new question. In the first sentence, acknowledge the correction plainly (no grovel), name the specific thing that was wrong, and give the corrected version. Do not restate or defend the corrected claim.');
  }
  if (read.act === 'FOLLOW_UP') {
    lines.push('- this is a FOLLOW-UP to what was already said, not a new topic. Open by naming the referent explicitly (the position, the level, the claim you made), then answer. Do not restart the whole analysis.');
  }

  switch (read.askShape) {
    case 'CAUSAL':
      lines.push('- the question is WHY: give the mechanism (what causes what, through which channel). A list of facts without a "because" does not answer a why-question.');
      break;
    case 'QUANTITY':
      lines.push('- the question asks HOW MUCH: the answer must contain the number (or an explicit statement that the number is unavailable). "It depends" without a figure is not an answer.');
      break;
    case 'COMPARISON':
      lines.push('- the question asks WHICH: compare the two on the same criteria and give a verdict with its condition. Describing both separately without a verdict is not an answer.');
      break;
    case 'DEFINITION':
      lines.push('- the question asks WHAT IT MEANS: define the term in one plain sentence first, then why it matters here.');
      break;
    case 'METHOD':
      lines.push('- the question asks HOW: give ordered steps or the mechanism, not a description of the situation.');
      break;
    case 'YES_NO':
    case 'CONFIRMATION_SEEK':
      lines.push('- the question is yes/no: put the verdict in the first sentence (yes, no, or "only if …"), then the reason.');
      break;
    case 'PREDICTION':
      lines.push('- the question asks what will happen: give a scenario with its probability language and what would change it. Never state a forecast as fact.');
      break;
    default:
      break;
  }

  if (!lines.length) return '';
  return `DIALOGUE CONTRACT (what this turn is doing — answer the question that was asked):\n${lines.join('\n')}`;
}

/* ── compliance ───────────────────────────────────────────────────────────── */

const HAS_NUMBER = /(?:\d|[۰-۹]|[٠-٩])/;
const MECHANISM_RE = [
  'چون', 'چونکه', 'چون که', 'به دلیل', 'به‌دلیل', 'دلیلش', 'علتش', 'علت آن', 'به خاطر', 'به‌خاطر',
  'از آنجا که', 'سبب', 'باعث می', 'منجر به', 'در نتیجه', 'because', 'due to', 'that is why', "that's why", 'the reason'
];
const CONTRAST_RE = [
  'اما', 'ولی', 'در مقابل', 'در حالی که', 'برخلاف', 'در عوض', 'به جای', 'نسبت به',
  'however', 'whereas', 'versus', 'compared with', 'while '
];

/**
 * The deterministic after-the-fact check: did the answer match the ask?
 *
 * Only unambiguous asks are gated, and each issue is a MUST-FIX with the exact
 * missing element — never a rewrite of the answer.
 */
export function checkDialogueCompliance({ read, answer = '' } = {}) {
  const text = String(answer || '').trim();
  const issues = [];
  if (!read || read.schema !== DIALOGUE_READ_SCHEMA || !read.applicable || !text) {
    return { schema: DIALOGUE_READ_SCHEMA, applicable: Boolean(read?.applicable), issues, compliant: true };
  }
  const folded = fold(text);
  const head = folded.slice(0, 320);

  if (read.act === 'CORRECTION' && !CORRECTION_ACK_RE.some((p) => phrase(folded, p))) {
    issues.push({
      id: 'CORRECTION_IGNORED',
      severity: 'HIGH',
      detail: 'the user corrected the previous answer, and the reply never acknowledges the correction. Open by accepting it and name what was wrong.'
    });
  }

  if (read.act === 'FOLLOW_UP' && read.referent?.words?.length) {
    const resolved = read.referent.words.some((w) => head.includes(w))
      || anyPhrase(folded, REFERENT_MARKERS);
    if (!resolved) {
      issues.push({
        id: 'REFERENT_UNRESOLVED',
        severity: 'MEDIUM',
        detail: 'the follow-up points at something already said, and the reply never names it. Name the referent in the first sentence.'
      });
    }
  }

  switch (read.askShape) {
    case 'QUANTITY':
      if (!HAS_NUMBER.test(text)) {
        issues.push({
          id: 'QUANTITY_WITHOUT_NUMBER',
          severity: 'MEDIUM',
          detail: 'the question asks how much, and the answer contains no number. Give the figure, or state plainly that it is unavailable and why.'
        });
      }
      break;
    case 'CAUSAL':
      if (!MECHANISM_RE.some((p) => phrase(folded, p))) {
        issues.push({
          id: 'CAUSAL_WITHOUT_MECHANISM',
          severity: 'MEDIUM',
          detail: 'the question asks why, and the answer contains no causal link (no "because", no channel). State what causes what.'
        });
      }
      break;
    case 'COMPARISON':
      if (!CONTRAST_RE.some((p) => phrase(folded, p))) {
        issues.push({
          id: 'COMPARISON_WITHOUT_CONTRAST',
          severity: 'MEDIUM',
          detail: 'the question asks which is better, and the answer never contrasts the two. Compare on the same criteria and give a verdict.'
        });
      }
      break;
    default:
      break;
  }

  return {
    schema: DIALOGUE_READ_SCHEMA,
    applicable: true,
    act: read.act,
    askShape: read.askShape,
    issues,
    compliant: issues.length === 0
  };
}

/** The MUST-FIX block the reviewer receives; empty when nothing is wrong. */
export function renderDialogueDeficit(compliance) {
  if (!compliance || compliance.compliant !== false || !compliance.issues?.length) return '';
  const lines = compliance.issues.slice(0, 3).map((i) => `- [${i.id}] ${i.detail}`);
  return `DIALOGUE DEFICIT (the answer does not match the question it was asked; fix it, do not soften the wording):\n${lines.join('\n')}`;
}

export default readDialogue;
