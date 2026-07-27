import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import fa from './locales/fa.json';
import en from './locales/en.json';
import ar from './locales/ar.json';

export const SUPPORTED = ['fa', 'en', 'ar'];
export const RTL_LANGS = ['fa', 'ar'];

const STORAGE_KEY = 'fbt-lang';

function detectLang() {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved && SUPPORTED.includes(saved)) return saved;

  const tgLang = window?.Telegram?.WebApp?.initDataUnsafe?.user?.language_code;
  if (tgLang && SUPPORTED.includes(tgLang)) return tgLang;

  const nav = navigator.language?.slice(0, 2);
  if (nav && SUPPORTED.includes(nav)) return nav;

  return 'fa';
}

const initialLang = detectLang();

i18n.use(initReactI18next).init({
  resources: {
    fa: { translation: fa },
    en: { translation: en },
    ar: { translation: ar }
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
  localStorage.setItem(STORAGE_KEY, lang);
}

applyDirection(initialLang);
i18n.on('languageChanged', applyDirection);

export default i18n;
