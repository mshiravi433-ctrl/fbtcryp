import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import en from './locales/en.json';
import { LANGUAGES, RTL_LANGS, SUPPORTED } from './languages';

export { LANGUAGES, RTL_LANGS, SUPPORTED };

const STORAGE_KEY = 'fbt-lang';

/**
 * Twelve languages. fa/en/ar are complete; the rest carry the core surface
 * (navigation, welcome, guide chrome, swap flow, every safety warning) and
 * fall back to English elsewhere.
 *
 * The fallback chain is deliberate: an untranslated string appears in English,
 * never as a raw key. A user seeing `swap.err.NO_ROUTE` assumes the app is
 * broken; a user seeing "No route found" simply reads English for a moment.
 */
/*
 * ─── WHY ONLY ENGLISH IS IMPORTED STATICALLY ────────────────────────────────
 * All twelve locale files used to be imported at the top of this module. They
 * total 508 KB of JSON, and because this module is loaded on the very first
 * line of the app, every one of them landed in the entry chunk. A Persian user
 * downloaded eleven languages they will never see before the first frame could
 * paint — on a slow mobile connection that is seconds of blank screen.
 *
 * Now: English is bundled because it is the fallback for every missing key and
 * must be available synchronously — a missing fallback shows raw keys like
 * `swap.err.NO_ROUTE`, which reads as a broken app. Every other language is a
 * dynamic import, so Rollup emits it as its own chunk and the browser fetches
 * exactly one of them.
 *
 * `import.meta.glob` (not a bare template-literal import) so Vite can see the
 * complete set at build time and emit a chunk per file. A computed
 * `import('./locales/' + code + '.json')` would make Rollup include all of
 * them again as a fallback, which is the trap this is avoiding.
 * ────────────────────────────────────────────────────────────────────────────
 */
const localeLoaders = import.meta.glob('./locales/*.json');

const resources = {
  en: { translation: en }
};

/** Languages already fetched, so a repeat switch is instant. */
const loaded = new Set(['en']);

/**
 * Fetch a locale and register it with i18next.
 *
 * Resolves to false when the language cannot be loaded — the caller keeps the
 * current language rather than switching to a blank one. Falling back to
 * English on a failed fetch would be worse: the user asked for a change, saw
 * a different change happen, and has no idea why.
 */
async function loadLocale(code) {
  if (loaded.has(code)) return true;
  const loader = localeLoaders[`./locales/${code}.json`];
  if (!loader) return false;
  try {
    const mod = await loader();
    i18n.addResourceBundle(code, 'translation', mod.default ?? mod, true, true);
    loaded.add(code);
    return true;
  } catch {
    return false;
  }
}

function detectLang() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved && SUPPORTED.includes(saved)) return saved;
  } catch {
    /* private mode */
  }

  // Telegram tells us the user's app language; trust it when we support it.
  const tgLang = window?.Telegram?.WebApp?.initDataUnsafe?.user?.language_code;
  if (tgLang && SUPPORTED.includes(tgLang)) return tgLang;

  // Then the browser, but only for languages other than English: on most
  // phones in our main market `navigator.language` reports 'en' regardless of
  // what the person actually reads, so 'en' here is not evidence of anything.
  const navLang = (navigator?.language || '').slice(0, 2).toLowerCase();
  if (navLang && navLang !== 'en' && SUPPORTED.includes(navLang)) return navLang;

  /*
   * No signal at all: default to English and let Welcome ask.
   *
   * This used to return 'fa'. Persian is the primary market, but defaulting to
   * it meant anyone whose device gave no usable hint opened a right-to-left
   * app in a script they may not read, and had to find the language control
   * before they could do anything at all.
   *
   * English is the safer neutral here: it is already the fallback locale, so
   * it is the one language guaranteed to have every key translated, and a
   * Persian speaker is one tap away on the very next screen.
   */
  return 'en';
}

/** True when the user has never made an explicit choice. */
export function languageIsUnset() {
  try {
    return !localStorage.getItem(STORAGE_KEY);
  } catch {
    return true;
  }
}

const initialLang = detectLang();

i18n.use(initReactI18next).init({
  resources,
  // Starts on English; the detected language is swapped in below as soon as
  // its chunk resolves. Naming it here would render every key as a miss.
  lng: 'en',
  fallbackLng: 'en',
  supportedLngs: SUPPORTED,
  interpolation: { escapeValue: false },
  returnEmptyString: false
});

/**
 * Apply text direction for a language.
 *
 * `persist` defaults to true because every *user-initiated* change should be
 * remembered — but the boot-time call passes false. That distinction matters:
 * if the initial auto-detected language were written to storage, then
 * `languageIsUnset()` would be false from the very first frame and the welcome
 * language screen could never appear for anyone.
 */
export function applyDirection(lang, persist = true) {
  const dir = RTL_LANGS.includes(lang) ? 'rtl' : 'ltr';
  document.documentElement.setAttribute('dir', dir);
  document.documentElement.setAttribute('lang', lang);
  if (!persist) return;
  try {
    localStorage.setItem(STORAGE_KEY, lang);
  } catch {
    /* private mode — direction still applies for this session */
  }
}

/** Change language + direction in one call, and remember the choice. */
/**
 * Change language + direction in one call, and remember the choice.
 *
 * Async now, because the locale may still need fetching. Direction is applied
 * only AFTER the strings are in place: flipping to RTL while the old
 * language's text is still on screen produces a visible scramble.
 */
export async function setLanguage(lang) {
  if (!SUPPORTED.includes(lang)) return false;
  const ok = await loadLocale(lang);
  if (!ok && lang !== 'en') return false;
  await i18n.changeLanguage(lang);
  applyDirection(lang, true);
  return true;
}

/*
 * Boot: apply direction immediately from the detected language so the very
 * first paint is laid out correctly, then fetch that language's strings.
 * Until they arrive i18next serves English, which is a readable intermediate
 * state rather than a blank or key-filled one.
 */
applyDirection(initialLang, false);
if (initialLang !== 'en') {
  loadLocale(initialLang).then((ok) => {
    if (ok) i18n.changeLanguage(initialLang);
  });
}
i18n.on('languageChanged', (lng) => applyDirection(lng, true));

export default i18n;
