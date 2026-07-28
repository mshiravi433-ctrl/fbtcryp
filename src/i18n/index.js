import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import fa from './locales/fa.json';
import en from './locales/en.json';
import ar from './locales/ar.json';
import tr from './locales/tr.json';
import ru from './locales/ru.json';
import zh from './locales/zh.json';
import es from './locales/es.json';
import hi from './locales/hi.json';
import fr from './locales/fr.json';
import de from './locales/de.json';

/**
 * TEN LANGUAGES.
 *
 * Persian and English are complete. The other eight have reviewed translations
 * for navigation, shared UI and the swap surface — the screens someone actually
 * touches — and fall back to English elsewhere.
 *
 * That fallback is a deliberate choice, not laziness. Machine-translating ~990
 * keys would produce fluent-sounding but wrong RISK WARNINGS, FEE DISCLOSURES
 * and SECURITY INSTRUCTIONS. A German speaker reading an accurate English
 * warning is fine; one reading a confidently mistranslated warning about
 * losing their seed phrase is not. Translations get promoted as they are
 * reviewed by a speaker, one section at a time.
 */

export const LANGUAGES = [
  { code: 'fa', name: 'فارسی',    english: 'Persian',  flag: '🇮🇷', rtl: true,  complete: true },
  { code: 'en', name: 'English',  english: 'English',  flag: '🇬🇧', rtl: false, complete: true },
  { code: 'ar', name: 'العربية',  english: 'Arabic',   flag: '🇸🇦', rtl: true,  complete: false },
  { code: 'tr', name: 'Türkçe',   english: 'Turkish',  flag: '🇹🇷', rtl: false, complete: false },
  { code: 'ru', name: 'Русский',  english: 'Russian',  flag: '🇷🇺', rtl: false, complete: false },
  { code: 'zh', name: '中文',      english: 'Chinese',  flag: '🇨🇳', rtl: false, complete: false },
  { code: 'es', name: 'Español',  english: 'Spanish',  flag: '🇪🇸', rtl: false, complete: false },
  { code: 'hi', name: 'हिन्दी',    english: 'Hindi',    flag: '🇮🇳', rtl: false, complete: false },
  { code: 'fr', name: 'Français', english: 'French',   flag: '🇫🇷', rtl: false, complete: false },
  { code: 'de', name: 'Deutsch',  english: 'German',   flag: '🇩🇪', rtl: false, complete: false }
];

export const SUPPORTED = LANGUAGES.map((l) => l.code);
export const RTL_LANGS = LANGUAGES.filter((l) => l.rtl).map((l) => l.code);

const STORAGE_KEY = 'fbt-lang';

function detectLang() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved && SUPPORTED.includes(saved)) return saved;
  } catch {
    /* private mode / storage disabled — fall through to detection */
  }

  // Telegram reports the user's actual client language, which is far more
  // reliable than navigator on a phone.
  const tgLang = window?.Telegram?.WebApp?.initDataUnsafe?.user?.language_code;
  if (tgLang) {
    const base = String(tgLang).split('-')[0];
    if (SUPPORTED.includes(base)) return base;
  }

  // Persian is the product's primary market, so it is the default rather than
  // whatever the device happens to report.
  return 'fa';
}

const initialLang = detectLang();

i18n.use(initReactI18next).init({
  resources: {
    fa: { translation: fa },
    en: { translation: en },
    ar: { translation: ar },
    tr: { translation: tr },
    ru: { translation: ru },
    zh: { translation: zh },
    es: { translation: es },
    hi: { translation: hi },
    fr: { translation: fr },
    de: { translation: de }
  },
  lng: initialLang,
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
  returnEmptyString: false
});

export function applyDirection(lang) {
  const dir = RTL_LANGS.includes(lang) ? 'rtl' : 'ltr';
  document.documentElement.setAttribute('dir', dir);
  document.documentElement.setAttribute('lang', lang);
  try {
    localStorage.setItem(STORAGE_KEY, lang);
  } catch {
    /* preference just won't persist */
  }
}

export const isRtl = (lang) => RTL_LANGS.includes(lang);
export const languageMeta = (code) => LANGUAGES.find((l) => l.code === code) ?? LANGUAGES[1];

applyDirection(initialLang);
i18n.on('languageChanged', applyDirection);

export default i18n;
