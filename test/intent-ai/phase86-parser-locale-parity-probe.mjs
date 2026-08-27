/**
 * PHASE 86 — PARSER LANGUAGE PARITY
 * The UI language is not the parser language. Every one of the twelve UI
 * locales must reach a real intent — each with its own check — and a language
 * we cannot parse must say so instead of guessing.
 */
import { readFileSync, readdirSync } from 'node:fs';
import {
  parseLocalizedIntent, canonicalizeUtterance, normalizeDigits, isLocaleSupported,
  localeCoverage, assertNoSilentFallback, SUPPORTED_LOCALES, PARSER_LOCALE_SCHEMA
} from '../../src/lib/intent-ai/index.js';

const results = [];
const check = (name, ok) => results.push({ name, ok: Boolean(ok) });

/* One real sentence per UI language. */
const SENTENCES = {
  en: 'swap 500 USDT to ETH',
  fa: 'تبدیل ۵۰۰ USDT به ETH',
  ar: 'تبديل ٥٠٠ USDT الى ETH',
  tr: '500 USDT ETH takas',
  ru: 'обменять 500 USDT на ETH',
  zh: '把 500 USDT 兑换 ETH',
  hi: '500 USDT को ETH बदलें',
  ur: '500 USDT ETH تبدیل',
  id: 'tukar 500 USDT ke ETH',
  es: 'cambiar 500 USDT a ETH',
  pt: 'trocar 500 USDT para ETH',
  fr: 'échanger 500 USDT à ETH'
};

try {
  /* ---------- the UI's languages and the parser's must be the same set ---------- */
  const uiLocales = readdirSync('src/i18n/locales').filter((f) => f.endsWith('.json')).map((f) => f.replace('.json', '')).sort();
  check('the UI ships twelve languages', uiLocales.length === 12);
  check('the parser claims exactly the UI languages', [...SUPPORTED_LOCALES].sort().join(',') === uiLocales.join(','));
  check('every claimed locale has a test sentence', SUPPORTED_LOCALES.every((l) => typeof SENTENCES[l] === 'string'));

  /* ---------- one check per language, as the spec demands ---------- */
  const probes = [];
  for (const locale of SUPPORTED_LOCALES) {
    const parsed = parseLocalizedIntent(SENTENCES[locale], { locale });
    const good = parsed.ok === true
      && parsed.intent?.action === 'swap'
      && parsed.intent?.fromSymbol === 'USDT'
      && parsed.intent?.toSymbol === 'ETH'
      && parsed.intent?.amount === 500;
    probes.push({ locale, parsed: good, sample: SENTENCES[locale] });
    check(`a swap stated in "${locale}" is understood`, good);
  }
  check('every language reached the same intent', probes.every((p) => p.parsed));

  /* ---------- digits ---------- */
  check('Persian digits become numbers', normalizeDigits('۱۲۳۴۵۶۷۸۹۰') === '1234567890');
  check('Arabic-Indic digits become numbers', normalizeDigits('٥٠٠') === '500');
  check('Devanagari digits become numbers', normalizeDigits('५००') === '500');
  check('ASCII digits are untouched', normalizeDigits('500') === '500');
  check('an Arabic decimal separator is understood', normalizeDigits('1٫5') === '1.5');
  check('a Persian amount survives into the intent',
    parseLocalizedIntent('تبدیل ۲۵۰ USDT به ETH', { locale: 'fa' }).intent.amount === 250);
  check('a Hindi amount survives into the intent',
    parseLocalizedIntent('५०० USDT को ETH बदलें', { locale: 'hi' }).intent.amount === 500);

  /* ---------- canonicalisation is translation, not interpretation ---------- */
  const canon = canonicalizeUtterance('تبدیل ۵۰۰ USDT به ETH', { locale: 'fa' });
  check('the canonical text is plain ASCII vocabulary', canon.ok === true && /swap/.test(canon.text));
  check('the original is preserved for audit', canon.original.includes('تبدیل'));
  check('every replacement is recorded', canon.replacements.some((r) => r.from === 'تبدیل' && r.to === 'swap'));
  check('canonicalising never adds an action', canon.addedAction === false);
  check('a sentence with no verb gains no verb',
    canonicalizeUtterance('500 USDT ETH', { locale: 'es' }).replacements.every((r) => r.kind !== 'action'));
  check('a chain name in Persian becomes a chain the parser knows',
    parseLocalizedIntent('تبدیل ۱۰۰ USDT به ETH روی آربیتروم', { locale: 'fa' }).intent.chainId === 42161);
  check('a chain name in Chinese becomes a chain the parser knows',
    parseLocalizedIntent('把 100 USDT 兑换 ETH 以太坊', { locale: 'zh' }).intent.chainId === 1);
  check('empty input is refused', canonicalizeUtterance('   ', { locale: 'en' }).ok === false);

  /* ---------- unsupported languages fail honestly ---------- */
  check('an unsupported locale is known to be unsupported', isLocaleSupported('sw') === false);
  check('a supported locale with a region tag still works', isLocaleSupported('pt-BR') === true);
  const unsupported = parseLocalizedIntent('badilisha 500 USDT kwa ETH', { locale: 'sw' });
  check('an unsupported language does NOT get a guessed parse', unsupported.ok === false);
  check('the unsupported language hands over to the guided flow', unsupported.requiresGuidedFlow === true);
  check('the handover is a translatable notice', unsupported.i18nKey === 'intentAI.parser.localeUnsupported');
  check('no locale at all is also refused', parseLocalizedIntent('swap 500 USDT to ETH', {}).ok === false);
  check('an English sentence in an unsupported locale is still refused',
    parseLocalizedIntent('swap 500 USDT to ETH', { locale: 'sw' }).ok === false);

  /* ---------- a parse is still only a draft ---------- */
  const one = parseLocalizedIntent(SENTENCES.tr, { locale: 'tr' });
  check('a parse carries the locale', one.locale === 'tr' && one.schema === PARSER_LOCALE_SCHEMA);
  check('a parse NEVER authorizes execution', one.executionAuthorized === false);
  check('a parse still requires the confirmation gate', one.requiresConfirmationGate === true);
  check('an ambiguous sentence asks for guidance rather than assuming',
    parseLocalizedIntent('bir şeyler yap', { locale: 'tr' }).requiresGuidedFlow === true);

  /* ---------- coverage and the guard ---------- */
  const coverage = localeCoverage({ probes });
  check('coverage is complete', coverage.ok === true && coverage.covered === 12 && coverage.missing.length === 0);
  check('full parity is a translatable notice', coverage.i18nKey === 'intentAI.parser.localeParity');
  check('a missing language is reported as a gap',
    localeCoverage({ probes: probes.filter((p) => p.locale !== 'ur') }).missing.includes('ur'));
  check('the guard accepts an honest parse', assertNoSilentFallback(one).ok === true);
  check('the guard catches a parse in an unsupported locale',
    assertNoSilentFallback({ ok: true, locale: 'sw' }).reasons.includes('PARSED_UNSUPPORTED_LOCALE'));
  check('the guard catches a parse claiming authority',
    assertNoSilentFallback({ ...one, executionAuthorized: true }).reasons.includes('PARSE_CLAIMS_AUTHORITY'));
  check('the guard rejects a non-parse', assertNoSilentFallback(null).ok === false);

  const locales = ['en', 'fa', 'ar'].map((l) => JSON.parse(readFileSync(`src/i18n/locales/${l}.json`, 'utf8')));
  check('the parser copy is translated in en, fa and ar',
    locales.every((loc) => ['localeParity', 'localeGap', 'localeUnsupported', 'guidedFallback']
      .every((k) => typeof loc?.intentAI?.parser?.[k] === 'string')));

  console.log(JSON.stringify({ probe: 'phase86-parser-locale-parity', passed: results.filter((r) => r.ok).length, results }, null, 2));
  if (results.some((r) => !r.ok)) process.exitCode = 1;
} catch (e) {
  console.error(e);
  process.exitCode = 1;
}

export default results;
