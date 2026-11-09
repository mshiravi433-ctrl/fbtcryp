/**
 * FBT INTENT OS — MULTI-PART QUESTION DECOMPOSITION
 * ---------------------------------------------------------------------------
 * «قیمت BTC چنده و ریسک سبد من با این خبر چیه؟» is one message with two
 * questions. The engine used to hand the whole string to one analyst and one
 * synthesiser, and the shorter half was regularly dropped — not because the
 * model could not answer it, but because nothing in the prompt said the answer
 * owed two things.
 *
 * This module is a deterministic splitter, NOT a second model:
 *   · it never invents a sub-question, never rewrites the user's words;
 *   · it only fires on explicit structure — numbering, newlines, semicolons,
 *     several question marks, or an explicit "and also/و همچنین";
 *   · it gives up (returns []) rather than split a normal Persian sentence at
 *     every «و», which would manufacture parts the user never asked.
 *
 * The parts are used as a COMPLETENESS CHECKLIST in the smartest mode:
 * every analyst is told which parts must be covered, the verifier is told to
 * name any part left unanswered, and the final answer must address each one.
 */

export const QUESTION_DECOMPOSITION_VERSION = '1.0.0';

const PERSIAN_DIGITS = /[\u06F0-\u06F9]/g;
const ARABIC_DIGITS = /[\u0660-\u0669]/g;

function toAsciiDigits(text) {
  return String(text ?? '')
    .replace(PERSIAN_DIGITS, (d) => String(d.charCodeAt(0) - 0x06F0))
    .replace(ARABIC_DIGITS, (d) => String(d.charCodeAt(0) - 0x0660));
}

const ENUMERATION_RE = /(?:^|[\n\r]|[\s:؛;])(?:\d{1,2}|[0-9]{1,2})[).:\-–]\s+/g;
const QUESTION_MARK_RE = /[?؟]/g;

function cleanPart(text) {
  return String(text || '')
    .replace(/^[\s،,;؛:.\-–]+/, '')
    /* The conjunction that introduced the next part is punctuation, not the
       question: «و همچنین ریسک…» is asked as «ریسک…». */
    .replace(/^(?:و\s*همچنین|و\s*بعد|و\s*نیز|and\s+also|also)\s+/i, '')
    .replace(/[\s،,;؛:.\-–]+$/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function meaningful(part) {
  /* A two-word fragment is not a question; require some substance so the
     checklist cannot become "1) BTC 2) ETH". */
  const letters = part.replace(/[^\p{L}]/gu, '');
  return part.length >= 8 && letters.length >= 4;
}

/**
 * Split a message into the parts it explicitly asks for.
 * @param {string} message
 * @returns {{parts: string[], reason: string|null}}
 */
export function decomposeQuestionDetailed(message) {
  const text = String(message || '').trim();
  if (!text) return { parts: [], reason: null };
  if (text.length > 1200) return { parts: [], reason: 'TOO_LONG' };

  /* 1. Explicit numbering: "1) … 2) …", "۱- … ۲- …". */
  const enumerated = [];
  let match;
  const marks = [];
  ENUMERATION_RE.lastIndex = 0;
  while ((match = ENUMERATION_RE.exec(toAsciiDigits(text))) !== null) {
    marks.push({ markerStart: match.index, contentStart: match.index + match[0].length });
  }
  if (marks.length >= 2) {
    for (let i = 0; i < marks.length; i += 1) {
      const start = marks[i].contentStart;
      /* End at the START of the next marker, so "2)" belongs to the marker,
         not to the tail of the previous question. */
      const end = i + 1 < marks.length ? marks[i + 1].markerStart : text.length;
      enumerated.push(cleanPart(text.slice(start, end)));
    }
    const parts = enumerated.filter(meaningful);
    if (parts.length >= 2) return { parts: parts.slice(0, 4), reason: 'ENUMERATED' };
  }

  /* 2. Newlines / semicolons: a clear separator the user typed on purpose. */
  const lines = text.split(/[\n\r]+|[;؛]+/).map(cleanPart).filter(meaningful);
  if (lines.length >= 2) return { parts: lines.slice(0, 4), reason: 'SEPARATED' };

  /* 3. Several question marks: one per asked question. Keep the mark inside the
     part so the checklist reads like the user's own sentence. */
  const qMarks = (toAsciiDigits(text).match(QUESTION_MARK_RE) || []).length;
  if (qMarks >= 2) {
    const chunks = [];
    let last = 0;
    const re = /[?؟]/g;
    let q;
    while ((q = re.exec(text)) !== null) {
      const piece = cleanPart(text.slice(last, q.index + 1));
      if (piece) chunks.push(piece);
      last = q.index + 1;
    }
    const tail = cleanPart(text.slice(last));
    if (tail) chunks.push(tail);
    const parts = chunks.filter(meaningful);
    if (parts.length >= 2) return { parts: parts.slice(0, 4), reason: 'MULTIPLE_QUESTIONS' };
  }

  /* 4. An explicit "and also / also / و همچنین / و بعد" conjunction. A plain
     «و» is deliberately NOT a separator. */
  const explicitConjunction = /\s(?:و\s*همچنین|و\s*بعد|و\s*نیز|and\s+also|also,|plus,)\s/i;
  if (explicitConjunction.test(text)) {
    const split = text.split(explicitConjunction).map(cleanPart).filter(meaningful);
    if (split.length >= 2) return { parts: split.slice(0, 4), reason: 'EXPLICIT_CONJUNCTION' };
  }

  return { parts: [], reason: null };
}

/** Convenience wrapper: the parts, or an empty array. */
export function decomposeQuestion(message) {
  return decomposeQuestionDetailed(message).parts;
}

/**
 * The checklist line injected into role prompts. Empty when there is nothing
 * to check, so a single-question turn is unchanged.
 */
export function renderSubQuestionChecklist(parts, locale = 'fa') {
  if (!Array.isArray(parts) || parts.length < 2) return '';
  const fa = String(locale || 'fa').toLowerCase().startsWith('fa');
  const lines = parts.map((p, i) => `${i + 1}) ${p}`);
  return fa
    ? `این پیام ${parts.length} بخش دارد. پاسخ باید صریحاً به هر بخش بپردازد؛ بخشی که شاهد یا داده ندارد را با نام همان بخش و صادقانه «خوانده نشد» علامت بزن:\n${lines.join('\n')}`
    : `THIS MESSAGE HAS ${parts.length} PARTS. The answer must address every one explicitly; a part without evidence must be named and marked "not readable", not skipped:\n${lines.join('\n')}`;
}

export default decomposeQuestion;

/* -------------------------------------------------------------------------- */
/*  COVERAGE — did the draft actually answer the parts?                        */
/* -------------------------------------------------------------------------- */

const STOPWORDS = new Set([
  'the', 'and', 'for', 'with', 'that', 'this', 'what', 'which', 'how', 'why',
  'when', 'where', 'who', 'are', 'was', 'were', 'you', 'your', 'can', 'could',
  'should', 'would', 'does', 'did', 'about', 'from', 'into', 'than', 'then',
  'من', 'تو', 'او', 'ما', 'شما', 'آنها', 'این', 'آن', 'که', 'چه', 'چی', 'چیه',
  'چند', 'چطور', 'کجا', 'کی', 'است', 'هست', 'هستش', 'را', 'و', 'با', 'برای',
  'از', 'به', 'در', 'بر', 'هم', 'یا', 'اگر', 'اما', 'یک', 'می', 'شود', 'کنم',
  'کن', 'بده', 'بگو', 'لطفا', 'الان', 'حالا', 'خیلی', 'تورو', 'لطفاً',
  'چنده', 'چیه', 'چیست', 'چگونه', 'کدام', 'بیشتر', 'کمتر', 'الان'
]);

/*
 * The same asset is named two ways in one conversation («BTC» in the user's
 * question, «بیت‌کوین» in the answer). Without this map the coverage check
 * would report an answered question as unanswered — and a checklist that
 * cries wolf is worse than no checklist.
 */
const ASSET_ALIASES = {
  btc: ['بیت‌کوین', 'بیتکوین', 'bitcoin'],
  bitcoin: ['btc', 'بیت‌کوین', 'بیتکوین'],
  'بیت‌کوین': ['btc', 'bitcoin'],
  'بیتکوین': ['btc', 'bitcoin'],
  eth: ['اتریوم', 'ethereum'],
  ethereum: ['eth', 'اتریوم'],
  'اتریوم': ['eth', 'ethereum'],
  sol: ['سولانا', 'solana'],
  solana: ['sol', 'سولانا'],
  'سولانا': ['sol', 'solana']
};

function expandAliases(words) {
  const out = new Set(words);
  for (const w of words) {
    for (const alias of ASSET_ALIASES[w] || []) out.add(alias);
  }
  return out;
}

/*
 * Word folds that must not change meaning: the zero-width non-joiner (which
 * splits «بیت‌کوین» into two tokens), Arabic yeh/kaf spellings, and case.
 */
function fold(text) {
  return String(text || '')
    .replace(/\u200c/g, '')
    .replace(/[\u064a\u0649]/g, 'ی')
    .replace(/\u0643/g, 'ک')
    .toLowerCase();
}

function keywords(part) {
  const tokens = fold(part)
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 3 && !STOPWORDS.has(w) && !/^\d+$/.test(w));
  /* Latin words are matched as-is; Persian has clitics («سبدم», «ریسکِ») so a
     prefix match on a ≥4-letter stem is used for non-Latin scripts. */
  return [...new Set(tokens)].slice(0, 8);
}

/**
 * Deterministic coverage check — a checklist, not a grader.
 * A part counts as covered when at least one of its significant words appears
 * in the answer (or, for Persian, a ≥4-letter stem appears as a prefix).
 * @returns {{covered: boolean[], uncovered: string[]}}
 */
export function assessQuestionCoverage(parts, answer) {
  const list = Array.isArray(parts) ? parts.filter(Boolean) : [];
  const text = fold(answer);
  if (!list.length || !text) return { covered: [], uncovered: [] };
  const words = expandAliases(new Set(text.replace(/[^\p{L}\p{N}]+/gu, ' ').split(/\s+/).filter(Boolean)));
  const covered = list.map((part) => keywords(part).some((kw) => {
    for (const alias of ASSET_ALIASES[kw] || []) if (words.has(alias)) return true;
    if (words.has(kw)) return true;
    if (/^[a-z0-9]+$/.test(kw)) return false;
    if (kw.length < 4) return false;
    const stem = kw.slice(0, 4);
    for (const w of words) if (w.startsWith(stem)) return true;
    return false;
  }));
  return { covered, uncovered: list.filter((_, i) => !covered[i]) };
}

/** The reviewer's checklist: only the parts nothing in the draft touched. */
export function renderUnansweredParts(uncovered, locale = 'fa') {
  if (!Array.isArray(uncovered) || !uncovered.length) return '';
  const fa = String(locale || 'fa').toLowerCase().startsWith('fa');
  const lines = uncovered.map((p, i) => `${i + 1}) ${p}`);
  return fa
    ? `بخش‌هایی از پرسش که در پیش‌نویس پاسخ داده نشده‌اند (در «answer» نهایی پوشش بده یا صریح بگو چرا خوانده نمی‌شود):\n${lines.join('\n')}`
    : `PARTS OF THE QUESTION THE DRAFT DOES NOT ANSWER (cover them in the final "answer", or state exactly which reading is missing):\n${lines.join('\n')}`;
}
