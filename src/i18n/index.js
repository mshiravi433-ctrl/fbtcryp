import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import fa from './locales/fa.json';
import en from './locales/en.json';
import ar from './locales/ar.json';
import zh from './locales/zh.json';
import hi from './locales/hi.json';
import es from './locales/es.json';
import fr from './locales/fr.json';
import ru from './locales/ru.json';
import tr from './locales/tr.json';
import ur from './locales/ur.json';
import id from './locales/id.json';
import pt from './locales/pt.json';
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
const resources = {
  fa: { translation: fa },
  en: { translation: en },
  ar: { translation: ar },
  zh: { translation: zh },
  hi: { translation: hi },
  es: { translation: es },
  fr: { translation: fr },
  ru: { translation: ru },
  tr: { translation: tr },
  ur: { translation: ur },
  id: { translation: id },
  pt: { translation: pt }
};

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

  // No signal at all: show the language picker on first launch (Welcome) and
  // default to Persian, the product's primary language, until then.
  return 'fa';
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
  lng: initialLang,
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
export function setLanguage(lang) {
  if (!SUPPORTED.includes(lang)) return;
  i18n.changeLanguage(lang);
  applyDirection(lang, true);
}

applyDirection(initialLang, false);
i18n.on('languageChanged', (lng) => applyDirection(lng, true));

export default i18n;
