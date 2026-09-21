/**
 * FBT INTENT OS — UPGRADE 13: DICTATION (understand speech, in any language)
 * ---------------------------------------------------------------------------
 * «حرف زدن را بفهمد» has two halves and the app only had one. The *understanding*
 * half (a spoken sentence arriving at the same parser as a typed one) existed on
 * the old panel; the live surface — `/intent`, the one users actually reach —
 * had no microphone at all, and the panel's handler had two defects that make
 * voice unreliable on exactly the audience this product is built for:
 *
 *   1. `rec.lang = language === 'fa' ? 'fa-IR' : (language || 'en-US')`.
 *      Fine for Persian and English. For Turkish the browser gets `tr` (some
 *      engines reject a bare subtag), for Arabic it gets `ar` and picks Modern
 *      Standard with no dialect hint, for Urdu and Hindi it guesses. A wrong
 *      recognition locale is not a slightly worse transcript — it is silence,
 *      or gibberish the parser then has to explain away.
 *   2. Nothing normalised what came back. Speech engines emit ASCII digits
 *      inside Persian text, a trailing full stop after every utterance, and for
 *      Persian sometimes the *Arabic* ي/ك instead of ی/ک. «۵۰ تتر بخر» heard as
 *      «50 تتر بخر.» is still parseable — but «بیت ي کوین» is not a token
 *      anybody's lexicon knows.
 *
 * This module holds both halves as pure functions so they can be tested without
 * a browser, a microphone, or a network.
 *
 * The safety law, and the reason a voice feature is allowed to exist here at
 * all: **a transcript is a draft, never a submission.** Every path lands in the
 * composer, un sent, because "the microphone said 500 instead of 50" turning into
 * a real order is the single worst failure this surface could have (§26 of the
 * execution-first spec). Nothing in this file returns `shouldAutoSend: true`.
 */

export const DICTATION_SCHEMA = 'fbt.ai-dictation.v13';
export const DICTATION_VERSION = '13.0.0';

/**
 * Recognition locales, in preference order per language. The first entry that
 * the browser advertises (when it advertises at all) is used; if the browser
 * says nothing, the first entry is assumed. Chrome's engine supports fa-IR,
 * tr-TR, ar-SA, ru-RU, zh-CN, hi-IN, ur-PK, id-ID, es-ES, pt-BR, fr-FR.
 */
export const RECOGNITION_LOCALES = Object.freeze({
  en: ['en-US', 'en-GB', 'en'],
  fa: ['fa-IR', 'fa'],
  ar: ['ar-SA', 'ar-EG', 'ar-AE', 'ar'],
  tr: ['tr-TR', 'tr'],
  ru: ['ru-RU', 'ru'],
  zh: ['zh-CN', 'zh-Hans-CN', 'zh-TW', 'zh'],
  hi: ['hi-IN', 'hi'],
  ur: ['ur-PK', 'ur-IN', 'ur'],
  id: ['id-ID', 'id'],
  es: ['es-ES', 'es-MX', 'es'],
  pt: ['pt-BR', 'pt-PT', 'pt'],
  fr: ['fr-FR', 'fr-CA', 'fr']
});

/** The Arabic-script letters a Persian/Urdu keyboard and a speech engine disagree on. */
const LETTER_MAP = Object.freeze({ 'ي': 'ی', 'ك': 'ک', 'ة': 'ه', 'ى': 'ی', 'ؤ': 'و', 'ئ': 'ی' });

/* Dictation artefacts a recognition engine adds and a parser should not have
   to reason about. Matched only at the edges, never inside a sentence. */
const TRAILING_FILLER = /[\s.,!?،؛。？！]+$/u;
const LEADING_FILLER = /^(?:okay|ok google|hey (?:google|siri|alexa)|alright|بفرما|بله)[\s,.:؛]+/i;

/**
 * Rewrite the ASCII digits back into the digit system the reader's language
 * writes with. Only touches digits, so the words the engine mis-heard are left
 * exactly as they were — a transcript must never be silently re-worded.
 */
export function displayDigits(value, lang = null) {
  const set = DIGIT_SETS[String(lang || '').toLowerCase().split('-')[0]] || null;
  if (!set) return String(value ?? '');
  let out = '';
  for (const ch of String(value ?? '')) out += /[0-9]/.test(ch) ? set[Number(ch)] : ch;
  return out;
}

const DIGIT_SETS = Object.freeze({
  fa: '۰۱۲۳۴۵۶۷۸۹',
  ur: '۰۱۲۳۴۵۶۷۸۹',
  ar: '٠١٢٣٤٥٦٧٨٩',
  hi: '०१२३४५६७८९',
  bn: '০১২৩৪৫৬৭৮৯'
});

export function normalizeDigits(value) {
  const sets = ['۰۱۲۳۴۵۶۷۸۹', '٠١٢٣٤٥٦٧٨٩', '०१२३४५६७८९'];
  let out = String(value ?? '');
  for (const set of sets) {
    for (let i = 0; i < 10; i += 1) out = out.split(set[i]).join(String(i));
  }
  return out;
}

/**
 * Clean one dictated utterance into something the intent parser can read.
 *
 * @param {string} raw  what the recognizer returned
 * @param {object} [opts]
 * @param {string} [opts.lang]      the language the reader asked for
 * @param {number} [opts.confidence] engine confidence 0..1, when provided
 * @param {boolean} [opts.isFinal]  interim results are only lightly cleaned
 * @returns {{text: string, changed: boolean, edits: string[], confidence: number|null,
 *   needsConfirmation: boolean, shouldAutoSend: false, schema: string}}
 */
export function normalizeTranscript(raw, { lang = null, confidence = null, isFinal = true } = {}) {
  const source = String(raw ?? '');
  const edits = [];
  let text = source;

  /* ZWNJ → space. The parser folds the same way; doing it here means the
     transcript the user sees is the transcript that gets parsed. */
  if (/\u200c/.test(text)) { text = text.replace(/\u200c/g, ' '); edits.push('zwnj'); }
  /* Invisible direction marks, which RTL speech engines love to emit. */
  if (/[\u200b-\u200f\u202a-\u202e\u2066-\u2069]/.test(text)) {
    text = text.replace(/[\u200b-\u200f\u202a-\u202e\u2066-\u2069]/g, '');
    edits.push('direction-marks');
  }
  /* Persian/Urdu letters mis-emitted as their Arabic code points. */
  const mapped = [...text].map((ch) => LETTER_MAP[ch] ?? ch).join('');
  if (mapped !== text) { text = mapped; edits.push('script-letters'); }
  /* Local digits → ASCII, so «۵۰» and «50» parse through the same path. */
  const digitless = normalizeDigits(text);
  if (digitless !== text) { text = digitless; edits.push('digits'); }
  /* Trailing punctuation and leading assistant-wake phrases. */
  const trimmed = text.replace(TRAILING_FILLER, '').replace(LEADING_FILLER, (m) => (m.length === text.length ? '' : m));
  if (trimmed !== text) { text = trimmed; edits.push('filler'); }
  text = text.replace(/\s+/g, ' ').trim();

  /*
   * `Number(null)` is 0, and 0 means «the engine is sure this is garbage».
   * Plenty of recognizers never report a confidence at all, so the absence of a
   * number is tracked separately from the number zero.
   */
  const reported = confidence !== null && confidence !== undefined && confidence !== '' && Number.isFinite(Number(confidence));
  const conf = reported ? Math.min(1, Math.max(0, Number(confidence))) : null;
  return {
    schema: DICTATION_SCHEMA,
    lang: lang ? String(lang).toLowerCase().split('-')[0] : null,
    text,
    original: source,
    changed: text !== source.trim(),
    edits,
    confidence: conf,
    /* A quiet mic or a half-word is worth a re-read prompt, and it costs the
       user one tap instead of one wrong order. Below 0.55 the engine is
       essentially guessing. */
    needsConfirmation: !isFinal || (conf !== null && conf < 0.55),
    empty: text.length === 0,
    /*
     * What to put in the composer. The parser wants ASCII digits; the person
     * who just spoke Persian wants to read Persian digits. Showing them
     * `50 تتر بخر` after they said «۵۰ تتر بخر» is a small betrayal that adds up,
     * so both strings are returned and each caller takes the one it needs.
     */
    display: displayDigits(text, lang),
    /* The law, spelled out as data so a test can assert it instead of reading
       a comment: dictated text is never submitted by this layer. */
    shouldAutoSend: false,
    executionAuthorized: false
  };
}

/**
 * Which recognition locale to ask the browser for.
 *
 * `availableLocales` is the browser's own list when the engine exposes one;
 * honouring it is the difference between "voice works" and "voice works on my
 * laptop".
 */
export function speechRecognitionLangFor(locale = 'en', { availableLocales = null } = {}) {
  const code = String(locale || 'en').toLowerCase().split('-')[0];
  const requested = RECOGNITION_LOCALES[code] || RECOGNITION_LOCALES[code.slice(0, 2)] || [`${code}-${code.toUpperCase()}`, code];
  if (Array.isArray(availableLocales) && availableLocales.length) {
    const have = new Set(availableLocales.map((l) => String(l).toLowerCase()));
    const match = requested.find((l) => have.has(l.toLowerCase()));
    if (match) return { lang: match, code, exact: true, fallbackUsed: false };
    const loose = requested.find((l) => have.has(l.split('-')[0]));
    if (loose) return { lang: loose, code, exact: false, fallbackUsed: true };
  }
  return { lang: requested[0], code, exact: true, fallbackUsed: false, unverified: Boolean(!availableLocales) };
}

/** Does this browser have speech input at all? Never assume it does. */
export function speechSupport(win = (typeof window !== 'undefined' ? window : null), { availableLocales = null, locale = 'en' } = {}) {
  if (!win) return { supported: false, reason: 'NO_WINDOW', ctor: null };
  const Ctor = win.SpeechRecognition || win.webkitSpeechRecognition || null;
  if (!Ctor) return { supported: false, reason: 'NO_RECOGNIZER', ctor: null };
  const pick = speechRecognitionLangFor(locale, { availableLocales });
  const secure = win.isSecureContext !== false;
  return {
    supported: secure,
    reason: secure ? null : 'INSECURE_CONTEXT',
    ctor: Ctor,
    locale: pick.lang,
    localeExact: pick.exact,
    continuous: typeof Ctor.prototype?.continuous === 'boolean' || true,
    interim: true
  };
}

/**
 * The composer needs to know what a spoken turn is allowed to do. It is allowed
 * to fill a text field. Nothing more, and this function is where that is
 * written down in code rather than in a comment.
 */
export function dictatedDraft(currentInput, normalized) {
  const result = typeof normalized === 'string' ? normalizeTranscript(normalized) : (normalized || {});
  /* What the router parses: ASCII digits, cleaned, and including whatever the
     user had already typed — the composer's whole contents are the message. */
  const parsed = String(result.text ?? '').trim();
  const said = String(result.display ?? parsed).trim() || parsed;
  if (!said) return { value: String(currentInput ?? ''), appended: false, shouldAutoSend: false };
  const base = String(currentInput ?? '').trim();
  return {
    /* The field gets the reader's own digits; the parse gets ASCII ones. */
    value: base ? `${base} ${said}`.replace(/\s+/g, ' ').trim() : said,
    normalized: base ? `${base} ${parsed}`.replace(/\s+/g, ' ').trim() : parsed,
    appended: Boolean(base),
    /* A low-confidence transcript lands in the field for a re-read; it is never
       submitted, and the caller is told to ask before it sends. */
    needsConfirmation: Boolean(result.needsConfirmation),
    shouldAutoSend: false,
    requiresUserSend: true
  };
}

export default normalizeTranscript;
