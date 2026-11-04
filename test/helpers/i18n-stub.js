/**
 * A REAL i18next stand-in for component tests.
 *
 * ─── WHY NOT A `t` THAT ECHOES THE KEY ────────────────────────────────────
 * The common stub `t: (k) => k` makes a screen untestable in the one way that
 * matters here: every teacher answer renders as the same empty template, so
 * "did the answer change?" and "is this sentence Persian?" cannot be asked.
 * That is exactly how a v2-era test suite passed while the page was reported
 * as broken.
 *
 * This stub resolves the committed locale JSON (fa first, then en — the same
 * fallback chain `src/i18n/index.js` uses) and interpolates `{{placeholders}}`
 * the way i18next does. A test can therefore assert on the sentence a Persian
 * reader would actually see, and a missing key still surfaces as the key
 * itself, which is what production does.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildLocaleTree, keyFromPath } from './locale-walk.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const LOCALES = path.join(HERE, '..', '..', 'src', 'i18n', 'locales');

const cache = new Map();
function tree(lang) {
  if (!cache.has(lang)) {
    try {
      cache.set(lang, buildLocaleTree(readFileSync(path.join(LOCALES, `${lang}.json`), 'utf8')));
    } catch {
      cache.set(lang, {});
    }
  }
  return cache.get(lang);
}

export const state = { current: 'fa' };

export function setLang(lang) {
  state.current = lang;
}

const interpolate = (value, options) =>
  String(value).replace(/\{\{\s*(\w+)\s*\}\}/g, (match, name) =>
    options && options[name] != null ? String(options[name]) : match
  );

export function t(key, options) {
  if (typeof options === 'string') return options;
  const opts = typeof options === 'object' && options ? options : {};
  const primary = keyFromPath(tree(state.current), key);
  const fallback = keyFromPath(tree('en'), key);
  const value =
    typeof primary === 'string' && primary.trim() !== ''
      ? primary
      : typeof fallback === 'string' && fallback.trim() !== ''
        ? fallback
        : opts.defaultValue != null
          ? String(opts.defaultValue)
          : key;
  return interpolate(value, opts);
}

export function useTranslation() {
  return {
    t,
    i18n: {
      language: state.current,
      resolvedLanguage: state.current,
      changeLanguage: async (lang) => {
        setLang(lang);
        return true;
      }
    }
  };
}

export default { useTranslation, t, setLang, state };
