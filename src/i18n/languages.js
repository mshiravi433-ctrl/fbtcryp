/**
 * LANGUAGE REGISTRY
 * ---------------------------------------------------------------------------
 * Ten of the most spoken languages in the world plus the product's own
 * Persian. Each entry carries the endonym (the name of the language *in* that
 * language) because "Persian" means nothing to someone who only reads Persian,
 * and text direction, because getting RTL wrong makes an app unusable rather
 * than merely ugly.
 *
 * COVERAGE, STATED HONESTLY
 * Persian, English and Arabic are fully translated — they are the languages we
 * can actually review. The other eight cover the navigation, onboarding, the
 * first-launch guide, the swap flow and every safety warning; anything not yet
 * translated falls back to English rather than showing a raw key. A missing
 * string is a bug you can see; a machine-translated warning about losing money
 * is a bug you can't.
 */

export const LANGUAGES = [
  { code: 'fa', name: 'Persian', endonym: 'فارسی', dir: 'rtl', flag: '🇮🇷', complete: true },
  { code: 'en', name: 'English', endonym: 'English', dir: 'ltr', flag: '🇬🇧', complete: true },
  { code: 'ar', name: 'Arabic', endonym: 'العربية', dir: 'rtl', flag: '🇸🇦', complete: true },
  { code: 'zh', name: 'Chinese', endonym: '中文', dir: 'ltr', flag: '🇨🇳' },
  { code: 'hi', name: 'Hindi', endonym: 'हिन्दी', dir: 'ltr', flag: '🇮🇳' },
  { code: 'es', name: 'Spanish', endonym: 'Español', dir: 'ltr', flag: '🇪🇸' },
  { code: 'fr', name: 'French', endonym: 'Français', dir: 'ltr', flag: '🇫🇷' },
  { code: 'ru', name: 'Russian', endonym: 'Русский', dir: 'ltr', flag: '🇷🇺' },
  { code: 'tr', name: 'Turkish', endonym: 'Türkçe', dir: 'ltr', flag: '🇹🇷' },
  { code: 'ur', name: 'Urdu', endonym: 'اردو', dir: 'rtl', flag: '🇵🇰' },
  { code: 'id', name: 'Indonesian', endonym: 'Bahasa Indonesia', dir: 'ltr', flag: '🇮🇩' },
  { code: 'pt', name: 'Portuguese', endonym: 'Português', dir: 'ltr', flag: '🇧🇷' }
];

export const SUPPORTED = LANGUAGES.map((l) => l.code);
export const RTL_LANGS = LANGUAGES.filter((l) => l.dir === 'rtl').map((l) => l.code);

export const langMeta = (code) => LANGUAGES.find((l) => l.code === code) ?? LANGUAGES[0];
export const isRtl = (code) => RTL_LANGS.includes(code);
