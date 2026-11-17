/**
 * FBT AI — browser-side response-depth contract.
 * ---------------------------------------------------------------------------
 * The browser does not choose a response mode or remember a user preference.
 * Each chat/gateway request is classified on the server from its purpose,
 * complexity, freshness, completeness and safety context. This module only
 * names the three modes the server may report and gives browser requests a
 * timeout long enough for the deepest automatic turn.
 *
 * `auto` is the client default. Legacy callers may still send a stored mode,
 * but auto-aware server routes ignore it; no local setting can override the
 * question-level decision.
 */

export const INTELLIGENCE_MODES = Object.freeze([
  {
    id: 'swift',
    label: { fa: 'سریع', en: 'Swift' },
    hint: { fa: 'برای گفت‌وگوی ساده و پاسخ فوری', en: 'For simple conversation and quick replies' }
  },
  {
    id: 'balanced',
    label: { fa: 'متعادل', en: 'Balanced' },
    hint: { fa: 'برای پرسش روشن و خودبسنده', en: 'For clear, self-contained questions' }
  },
  {
    id: 'max',
    label: { fa: 'هوش عمیق', en: 'Deep' },
    hint: { fa: 'برای پرسش پیچیده، تازه، ناقص یا پرریسک', en: 'For complex, current, incomplete or high-stakes questions' }
  }
]);

export const AUTO_INTELLIGENCE_MODE = 'auto';
export const DEFAULT_INTELLIGENCE_MODE = AUTO_INTELLIGENCE_MODE;

const ALIASES = Object.freeze({
  auto: 'auto',
  automatic: 'auto',
  swift: 'swift',
  fast: 'swift',
  eco: 'swift',
  'سریع': 'swift',
  balanced: 'balanced',
  normal: 'balanced',
  default: 'balanced',
  'متعادل': 'balanced',
  max: 'max',
  smart: 'max',
  smartest: 'max',
  deep: 'max',
  best: 'max',
  ultra: 'max',
  high: 'max',
  'هوش عمیق': 'max',
  'عمیق': 'max',
  'باهوش‌ترین': 'max',
  'باهوش': 'max',
  'حداکثر': 'max'
});

export function normalizeIntelligenceMode(value) {
  const id = String(value ?? '').trim().toLowerCase();
  if (!id) return null;
  if (ALIASES[id]) return ALIASES[id];
  const hit = INTELLIGENCE_MODES.find((m) => m.id === id || m.label.fa === id);
  return hit ? hit.id : null;
}

/* The server chooses the exact budget per question. The client waits long
   enough for the maximum server turn because it cannot know the selected tier
   before the request is analyzed. */
export const INTELLIGENCE_TURN_MS = Object.freeze({
  swift: 15000,
  balanced: 30000,
  max: 58000,
  auto: 58000
});

export function intelligenceTurnBudgetMs(mode = AUTO_INTELLIGENCE_MODE) {
  const id = normalizeIntelligenceMode(mode) || AUTO_INTELLIGENCE_MODE;
  return INTELLIGENCE_TURN_MS[id] || INTELLIGENCE_TURN_MS.auto;
}

export function intelligenceModeLabel(mode, locale = 'fa') {
  const id = normalizeIntelligenceMode(mode) || AUTO_INTELLIGENCE_MODE;
  if (id === AUTO_INTELLIGENCE_MODE) {
    return String(locale || '').toLowerCase().startsWith('en') ? 'Automatic' : 'خودکار';
  }
  const hit = INTELLIGENCE_MODES.find((m) => m.id === id) || INTELLIGENCE_MODES[2];
  return String(locale || '').toLowerCase().startsWith('en') ? hit.label.en : hit.label.fa;
}
