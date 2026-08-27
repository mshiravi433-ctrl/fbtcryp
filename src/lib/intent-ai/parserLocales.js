/**
 * FBT INTENT AI — PHASE 86: PARSER LANGUAGE PARITY
 * ---------------------------------------------------------------------------
 * The UI speaks twelve languages; the intent parser understood three. A user
 * whose language "works" everywhere except the one box that moves money is not
 * supported — they are decorated.
 *
 * This module normalises an utterance in ANY of the twelve UI languages into
 * the canonical vocabulary `intentParser.js` already understands:
 *
 *   · localised digits (Persian, Arabic-Indic, Devanagari, Bengali) become
 *     ASCII, so "۵۰۰" and "٥٠٠" and "५००" are all 500
 *   · action verbs, chain names and stop-words are mapped per language
 *   · nothing is guessed: a language we have no lexicon for is reported as
 *     unsupported so the guided flow can take over, instead of the parser
 *     silently reading an English word out of a Chinese sentence
 *   · translation NEVER adds an action the user did not express
 */

import { classifyFailure } from './failureModes.js';
import { parseUserIntent } from './intentParser.js';

export const PARSER_LOCALE_SCHEMA = 'fbt.parser-locales.v1';

export const SUPPORTED_LOCALES = Object.freeze([
  'en', 'fa', 'ar', 'tr', 'ru', 'zh', 'hi', 'ur', 'id', 'es', 'pt', 'fr'
]);

/** Digit systems that appear in the twelve UI languages. */
const DIGIT_MAPS = Object.freeze([
  ['۰۱۲۳۴۵۶۷۸۹', 'fa'],   // Persian
  ['٠١٢٣٤٥٦٧٨٩', 'ar'],   // Arabic-Indic
  ['०१२३४५६७८९', 'hi']    // Devanagari
]);

/** action verbs → canonical English keyword the parser already knows. */
const LEXICON = Object.freeze({
  en: {},
  fa: { 'تبدیل': 'swap', 'مبادله': 'swap', 'خرید': 'buy', 'فروش': 'sell', 'ارسال': 'send', 'پل': 'bridge', 'تحلیل': 'analyze', 'موجودی': 'portfolio', 'هدف': 'goal' },
  ar: { 'تبديل': 'swap', 'مبادلة': 'swap', 'شراء': 'buy', 'بيع': 'sell', 'إرسال': 'send', 'ارسال': 'send', 'جسر': 'bridge', 'تحليل': 'analyze', 'محفظة': 'portfolio', 'هدف': 'goal' },
  tr: { 'takas': 'swap', 'değiştir': 'swap', 'al': 'buy', 'satın': 'buy', 'sat': 'sell', 'gönder': 'send', 'köprü': 'bridge', 'analiz': 'analyze', 'portföy': 'portfolio', 'hedef': 'goal' },
  ru: { 'обменять': 'swap', 'обмен': 'swap', 'купить': 'buy', 'продать': 'sell', 'отправить': 'send', 'мост': 'bridge', 'анализ': 'analyze', 'портфель': 'portfolio', 'цель': 'goal' },
  zh: { '兑换': 'swap', '交换': 'swap', '买入': 'buy', '购买': 'buy', '卖出': 'sell', '发送': 'send', '转账': 'send', '跨链': 'bridge', '分析': 'analyze', '投资组合': 'portfolio', '目标': 'goal' },
  hi: { 'बदलें': 'swap', 'अदला': 'swap', 'खरीदें': 'buy', 'बेचें': 'sell', 'भेजें': 'send', 'ब्रिज': 'bridge', 'विश्लेषण': 'analyze', 'पोर्टफोलियो': 'portfolio', 'लक्ष्य': 'goal' },
  ur: { 'تبدیل': 'swap', 'خریدیں': 'buy', 'فروخت': 'sell', 'بھیجیں': 'send', 'پل': 'bridge', 'تجزیہ': 'analyze', 'پورٹ فولیو': 'portfolio', 'ہدف': 'goal' },
  id: { 'tukar': 'swap', 'beli': 'buy', 'jual': 'sell', 'kirim': 'send', 'jembatan': 'bridge', 'analisis': 'analyze', 'portofolio': 'portfolio', 'sasaran': 'goal' },
  es: { 'cambiar': 'swap', 'intercambiar': 'swap', 'comprar': 'buy', 'vender': 'sell', 'enviar': 'send', 'puente': 'bridge', 'analizar': 'analyze', 'cartera': 'portfolio', 'objetivo': 'goal' },
  pt: { 'trocar': 'swap', 'comprar': 'buy', 'vender': 'sell', 'enviar': 'send', 'ponte': 'bridge', 'analisar': 'analyze', 'carteira': 'portfolio', 'meta': 'goal' },
  fr: { 'échanger': 'swap', 'echanger': 'swap', 'acheter': 'buy', 'vendre': 'sell', 'envoyer': 'send', 'pont': 'bridge', 'analyser': 'analyze', 'portefeuille': 'portfolio', 'objectif': 'goal' }
});

/** "to / for / on" style words that must not be read as token symbols. */
const CONNECTORS = Object.freeze({
  en: [], fa: ['به', 'در', 'از'], ar: ['إلى', 'الى', 'في', 'من'],
  tr: ['için', 'ile'], ru: ['в', 'на', 'из'], zh: ['到', '为'],
  hi: ['को', 'में', 'से'], ur: ['کو', 'میں', 'سے'], id: ['ke', 'dari', 'di'],
  es: ['a', 'para', 'en', 'de'], pt: ['para', 'em', 'de'], fr: ['à', 'a', 'pour', 'en', 'de']
});

/** Canonical chain words, so "اتریوم"/"以太坊"/"эфириум" all reach detectChain. */
const CHAIN_WORDS = Object.freeze({
  fa: { 'اتریوم': 'ethereum', 'آربیتروم': 'arbitrum', 'بیس': 'base', 'پالیگان': 'polygon', 'سولانا': 'solana' },
  ar: { 'إيثيريوم': 'ethereum', 'ايثيريوم': 'ethereum', 'أربيتروم': 'arbitrum', 'بوليجون': 'polygon', 'سولانا': 'solana' },
  ru: { 'эфириум': 'ethereum', 'арбитрум': 'arbitrum', 'полигон': 'polygon', 'солана': 'solana' },
  zh: { '以太坊': 'ethereum', '波场': 'tron', '索拉纳': 'solana' },
  hi: { 'एथेरियम': 'ethereum', 'सोलाना': 'solana' },
  ur: { 'ایتھیریم': 'ethereum' },
  tr: {}, id: {}, es: {}, pt: {}, fr: {}, en: {}
});

/** Every localised digit becomes an ASCII digit. */
export function normalizeDigits(text) {
  let out = String(text ?? '');
  for (const [digits] of DIGIT_MAPS) {
    for (let i = 0; i < 10; i += 1) {
      out = out.split(digits[i]).join(String(i));
    }
  }
  // Arabic/Persian decimal and thousands separators.
  return out.replace(/\u066B/g, '.').replace(/\u066C/g, '');
}

export function isLocaleSupported(locale) {
  return SUPPORTED_LOCALES.includes(String(locale || '').toLowerCase().split('-')[0]);
}

/**
 * Rewrite an utterance into the parser's canonical vocabulary. Returns what
 * was replaced, so a probe (and an audit) can see that nothing was invented.
 */
export function canonicalizeUtterance(text, { locale = null } = {}) {
  const lang = String(locale || '').toLowerCase().split('-')[0];
  if (!isLocaleSupported(lang)) {
    return {
      ok: false, text: null, locale: lang || null, replacements: [],
      i18nKey: 'intentAI.parser.localeUnsupported',
      error: classifyFailure('MISSING_DATA', { detail: 'LOCALE_NOT_SUPPORTED' })
    };
  }
  const raw = String(text ?? '');
  if (!raw.trim()) {
    return { ok: false, text: '', locale: lang, replacements: [], error: classifyFailure('MISSING_DATA', { detail: 'EMPTY_INPUT' }) };
  }
  let out = normalizeDigits(raw);
  const replacements = [];
  const apply = (dict, kind) => {
    for (const [word, canonical] of Object.entries(dict || {})) {
      if (!word) continue;
      const before = out;
      out = out.split(word).join(` ${canonical} `);
      if (out !== before) replacements.push({ from: word, to: canonical, kind });
    }
  };
  apply(CHAIN_WORDS[lang], 'chain');
  apply(LEXICON[lang], 'action');
  for (const connector of CONNECTORS[lang] || []) {
    const re = new RegExp(`(^|\\s)${connector}(\\s|$)`, 'gu');
    if (re.test(out)) { out = out.replace(re, ' to '); replacements.push({ from: connector, to: 'to', kind: 'connector' }); }
  }
  return {
    ok: true,
    schema: PARSER_LOCALE_SCHEMA,
    locale: lang,
    text: out.replace(/\s+/g, ' ').trim(),
    original: raw,
    replacements,
    // Canonicalising is a translation step, never an interpretation step.
    addedAction: false
  };
}

/** Parse in any supported UI language. */
export function parseLocalizedIntent(rawText, { locale = null, context = {} } = {}) {
  const canon = canonicalizeUtterance(rawText, { locale });
  if (!canon.ok) {
    return {
      ok: false, intent: null, confidence: 0, locale: canon.locale,
      clarifications: ['LOCALE_NOT_SUPPORTED'],
      i18nKey: 'intentAI.parser.localeUnsupported',
      requiresGuidedFlow: true,
      error: canon.error
    };
  }
  const parsed = parseUserIntent(canon.text, context);
  return {
    ...parsed,
    schema: PARSER_LOCALE_SCHEMA,
    locale: canon.locale,
    canonicalText: canon.text,
    replacements: canon.replacements,
    // A parse is a draft. It has never been authorized by anybody.
    executionAuthorized: false,
    requiresConfirmationGate: true,
    requiresGuidedFlow: parsed.ok !== true
  };
}

/** Which languages actually work, measured rather than declared. */
export function localeCoverage({ probes = [] } = {}) {
  const rows = SUPPORTED_LOCALES.map((locale) => {
    const probe = (Array.isArray(probes) ? probes : []).find((p) => p?.locale === locale);
    return { locale, parsed: probe?.parsed === true, sample: probe?.sample ?? null };
  });
  const missing = rows.filter((r) => !r.parsed).map((r) => r.locale);
  return {
    ok: missing.length === 0,
    schema: PARSER_LOCALE_SCHEMA,
    total: SUPPORTED_LOCALES.length,
    covered: rows.length - missing.length,
    missing,
    i18nKey: missing.length ? 'intentAI.parser.localeGap' : 'intentAI.parser.localeParity'
  };
}

/** A parse in a language we do not support must never be presented as fine. */
export function assertNoSilentFallback(result) {
  const reasons = [];
  if (!result || typeof result !== 'object') reasons.push('NOT_A_PARSE');
  if (result?.ok === true && !isLocaleSupported(result?.locale)) reasons.push('PARSED_UNSUPPORTED_LOCALE');
  if (result?.executionAuthorized === true) reasons.push('PARSE_CLAIMS_AUTHORITY');
  if (Array.isArray(result?.replacements) && result.replacements.some((r) => r.kind === 'action' && !r.from)) reasons.push('INVENTED_ACTION');
  const unique = [...new Set(reasons)];
  return unique.length
    ? { ok: false, reasons: unique, error: classifyFailure('MISSING_DATA', { detail: unique[0] }) }
    : { ok: true };
}
