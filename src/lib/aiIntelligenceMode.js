/**
 * FBT AI — INTELLIGENCE MODE (browser half)
 * ---------------------------------------------------------------------------
 * The server owns the contract (`server/aiIntelligence.js`): model ladders,
 * token budgets, collaboration floors. This file owns only one thing — the
 * user's CHOICE, persisted locally and attached to every chat request.
 *
 * Why a localStorage key instead of component state:
 *   · the composer, the intelligence panel and the client transport are three
 *     different components; threading a prop through all of them is how a
 *     setting starts disagreeing with itself;
 *   · a mode that resets on refresh is not a setting, it is a default;
 *   · the server still has the final say — if the stored value is garbage it
 *     resolves to the deployment default and reports `rejected`, so a corrupt
 *     key can never downgrade the assistant silently.
 *
 * Default is `max` ("باهوش‌ترین"), matching the server. The value is sent as
 * `intelligence` on the chat body; the server accepts ids and the Persian
 * spellings through its alias table, so an old client cannot ask for a mode
 * that does not exist.
 */

export const INTELLIGENCE_MODES = Object.freeze([
  {
    id: 'swift',
    label: { fa: 'سریع', en: 'Swift' },
    hint: { fa: 'ارزان و فوری', en: 'Fast & cheap' }
  },
  {
    id: 'balanced',
    label: { fa: 'متعادل', en: 'Balanced' },
    hint: { fa: 'رفتار قبلی', en: 'Previous behaviour' }
  },
  {
    id: 'max',
    label: { fa: 'باهوش‌ترین', en: 'Smartest' },
    hint: { fa: 'مدل‌های پرچم‌دار + راستی‌آزمایی', en: 'Flagships + verification' }
  }
]);

export const INTELLIGENCE_STORAGE_KEY = 'fbt.ai.intelligence.v1';
export const DEFAULT_INTELLIGENCE_MODE = 'max';

const ALIASES = Object.freeze({
  swift: 'swift',
  fast: 'swift',
  eco: 'swift',
  balanced: 'balanced',
  normal: 'balanced',
  default: 'balanced',
  max: 'max',
  smart: 'max',
  smartest: 'max',
  deep: 'max',
  best: 'max',
  ultra: 'max',
  high: 'max'
});

export function normalizeIntelligenceMode(value) {
  const id = String(value ?? '').trim().toLowerCase();
  if (!id) return null;
  if (ALIASES[id]) return ALIASES[id];
  const hit = INTELLIGENCE_MODES.find((m) => m.id === id || m.label.fa === id);
  return hit ? hit.id : null;
}

export function getIntelligenceMode() {
  try {
    const saved = window.localStorage.getItem(INTELLIGENCE_STORAGE_KEY);
    return normalizeIntelligenceMode(saved) || DEFAULT_INTELLIGENCE_MODE;
  } catch {
    return DEFAULT_INTELLIGENCE_MODE;
  }
}

export function setIntelligenceMode(mode) {
  const id = normalizeIntelligenceMode(mode);
  if (!id) return DEFAULT_INTELLIGENCE_MODE;
  try {
    window.localStorage.setItem(INTELLIGENCE_STORAGE_KEY, id);
    /* Same-tab listeners: the `storage` event only fires in OTHER tabs, so a
       custom event is what keeps the composer badge in sync with the panel. */
    window.dispatchEvent(new CustomEvent('fbt:ai-intelligence', { detail: { mode: id } }));
  } catch { /* private mode: the choice lasts for this page, nothing breaks */ }
  return id;
}

export function intelligenceModeLabel(mode, locale = 'fa') {
  const hit = INTELLIGENCE_MODES.find((m) => m.id === normalizeIntelligenceMode(mode)) || INTELLIGENCE_MODES[2];
  return String(locale || '').toLowerCase().startsWith('en') ? hit.label.en : hit.label.fa;
}
