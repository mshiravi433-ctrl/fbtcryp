import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import fa from './locales/fa.json';
import en from './locales/en.json';
import ar from './locales/ar.json';

export const RTL_LANGS = ['fa', 'ar'];

// Pull the language Telegram reports for this user, fall back to fa.
const tgLang = window?.Telegram?.WebApp?.initDataUnsafe?.user?.language_code;
const initialLang = ['fa', 'en', 'ar'].includes(tgLang) ? tgLang : 'fa';

i18n.use(initReactI18next).init({
  resources: {
    fa: { translation: fa },
    en: { translation: en },
    ar: { translation: ar }
  },
  lng: initialLang,
  fallbackLng: 'en',
  interpolation: { escapeValue: false }
});

export function applyDirection(lang) {
  const dir = RTL_LANGS.includes(lang) ? 'rtl' : 'ltr';
  document.documentElement.setAttribute('dir', dir);
  document.documentElement.setAttribute('lang', lang);
}

applyDirection(initialLang);

export default i18n;
