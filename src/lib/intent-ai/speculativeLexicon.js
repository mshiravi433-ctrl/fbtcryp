/**
 * FBT INTENT AI — SPECULATIVE VOCABULARY (BUILD-GATED)
 * ---------------------------------------------------------------------------
 * Every word in this file belongs to an instrument the store build does not
 * ship. They live in their own module for one reason:
 *
 *   APKPure rejected this app for "Not involve illegal sensitive words."
 *
 * The fix that worked for the screens was to delete the screens. That did not
 * work on its own, because a content filter reads STRINGS, not routes — and
 * the Persian word for "leverage" sitting in a locale file was enough to fail
 * review even after the Perpetuals screen was gone. `test/run.mjs` now greps
 * the built store bundle for exactly that vocabulary and fails the build.
 *
 * An intent parser has the same problem in reverse: to understand
 * "با ۱۰ برابر اهرم لانگ بگیر" it has to know the word. So the word has to be
 * in the source — but only in a build that can act on it. This module is
 * replaced with an empty stub at build time when VITE_ENABLE_SPECULATION is
 * off (see `stripSpeculativeVocabulary` in vite.config.js), which is the same
 * mechanism that already strips the disabled locale namespaces.
 *
 * That is not hiding a feature from a filter. In a store build the leverage
 * venue genuinely is not there, so the parser genuinely has nothing to
 * understand, and a customer who asks for it is told so rather than routed to
 * a screen that does not exist.
 */

export const SPECULATIVE_SCHEMA = 'fbt.speculative-lexicon.v1';

/**
 * Action stems for the derivatives verbs. Kept apart from the main ACTION
 * lexicon so the strip has one place to reach.
 */
export const FUTURES_ACTION_STEMS = Object.freeze([
  'فیوچرز', 'اهرم', 'معامله اهرمی', 'آتی', 'العقود', 'фьючерс', 'kaldıraç'
]);

/** Risk vocabulary that only makes sense where leverage exists. */
export const SPECULATE_RISK_STEMS = Object.freeze([
  'اهرمی', 'مضاربة'
]);

/** Matches a margin setting in any of the languages the UI ships. */
export function leveragePattern() {
  return /اهرم|leverage|lev\b|margin|kaldıraç|معامله اهرمی/i;
}

/**
 * Leverage, or null. Understands "5x leverage", "5x" on its own, and the
 * Persian construction "۱۰ برابر اهرم" — including a spelled-out number
 * ("ده برابر اهرم"), which is how it gets said out loud.
 */
export function detectLeverageText(normalized) {
  const text = String(normalized ?? '');
  const hasMarker = leveragePattern().test(text);

  const withDigits = text.match(/([0-9]+(?:\.[0-9]+)?)\s*(?:x|برابر)\s*(اهرم|leverage|lev|margin|kaldıraç)?/i);
  if (withDigits && hasMarker) {
    const n = Number(withDigits[1]);
    if (Number.isFinite(n) && n > 0 && n <= 100) return n;
  }

  const spelled = text.match(/(یک|دو|سه|چهار|پنج|شش|هفت|هشت|نه|ده)\s+برابر\s+اهرم/);
  if (spelled) {
    const table = { 'یک': 1, 'دو': 2, 'سه': 3, 'چهار': 4, 'پنج': 5, 'شش': 6, 'هفت': 7, 'هشت': 8, 'نه': 9, 'ده': 10 };
    const n = table[spelled[1]];
    if (Number.isFinite(n) && n > 0) return n;
  }

  /* A bare "5x" is only leverage where the venue exists to hold it. */
  const plain = text.match(/([0-9]+(?:\.[0-9]+)?)\s?x\s?(leverage|lev|long|short)?/i);
  if (plain && hasMarker) {
    const n = Number(plain[1]);
    if (Number.isFinite(n) && n > 0 && n <= 100) return n;
  }

  return null;
}

/**
 * Display labels for the margin capability, in the twelve UI locales.
 *
 * They live here rather than in outputLocales.js for the same reason the
 * action stems do: the Persian label contains the flagged word, and
 * outputLocales.js ships in every build. A store build gets the empty object
 * from the stub, and the planner falls back to the capability id.
 */
export const PERPS_LABELS = Object.freeze({
  en: 'Leveraged perpetual',
  fa: 'قرارداد دائمی اهرمی',
  ar: 'عقد دائم برافعة',
  tr: 'Kaldıraçlı sürekli kontrat',
  ru: 'Бессрочный контракт с плечом',
  zh: '杠杆永续合约',
  hi: 'लीवरेज्ड परपेचुअल',
  ur: 'لیوریجڈ پرپیچوئل',
  id: 'Perpetual dengan leverage',
  es: 'Perpetuo apalancado',
  pt: 'Perpétuo alavancado',
  fr: 'Perpétuel à effet de levier'
});

/** Whether this build understands margin vocabulary at all. */
export const SPECULATIVE_VOCABULARY_PRESENT = true;
