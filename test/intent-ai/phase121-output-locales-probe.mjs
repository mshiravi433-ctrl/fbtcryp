/**
 * PHASES 121–130 — INTENT OS OUTPUT LOCALES
 * Plans, progress lines and honest notes in the twelve UI languages, with
 * locale digits/separators and a visible fallback marker — never a silent
 * half-translated sentence.
 */
import {
  OUTPUT_LOCALE_SCHEMA, OUTPUT_LOCALES,
  formatNumber, formatPct, renderTemplate, localizePlan, localizeProgress, outputLocaleSupport
} from '../../src/lib/intent-ai/index.js';

const results = [];
const check = (name, ok) => results.push({ name, ok: Boolean(ok) });

const NOW = Date.parse('2026-08-28T00:00:00.000Z');
const plan = {
  schema: 'fbt.profit-target-plan.v1',
  generatedAt: new Date(NOW).toISOString(),
  riskProfile: 'balanced',
  horizonDays: 365,
  capitalUsd: 1000,
  target: { mode: 'pct', value: 20 },
  projectedAnnualYieldPct: 8.4,
  neededPct: 20,
  projectedUsdAtHorizon: 1084,
  targetUsdAtHorizon: 1200,
  targetReachability: { feasible: true, yearsEstimate: 2.4, reason: null },
  allocations: [],
  messages: [],
  venuesSeen: 5,
  venuesMissing: [],
  executionRequired: false,
  rawCredentialsInPlan: false
};
const progress = {
  schema: 'fbt.target-progress.v1',
  checkedAt: new Date(NOW).toISOString(),
  startUsd: 1000, currentUsd: 1050, targetUsd: 1200,
  progressPct: 5, elapsedDays: 12, onPace: true, remainingUsd: 150, suggestions: []
};

try {
  check('exactly twelve output locales', OUTPUT_LOCALES.length === 12);
  check('the locale list matches the UI languages', ['en', 'fa', 'ar', 'tr', 'ru', 'zh', 'hi', 'ur', 'id', 'es', 'pt', 'fr'].every((l) => OUTPUT_LOCALES.includes(l)));

  /* ---------- numbers ---------- */
  check('Persian digits are localised', formatNumber(1234.5, 'fa', 1).includes('۱') && !formatNumber(1234.5, 'fa', 1).includes('1'));
  check('Arabic digits are localised', formatNumber(987.25, 'ar').includes('٩'));
  check('Hindi digits are localised', formatNumber(42, 'hi').includes('४'));
  check('decimal-comma locales use a comma', formatNumber(1234.5, 'tr', 1).includes(','));
  check('English keeps a dot', formatNumber(1234.5, 'en', 1) === '1234.5');
  check('a non-number renders as an em-dash', formatNumber('x', 'en') === '—');
  check('percentages carry the locale digits', formatPct(8.4, 'fa').includes('۸'));
  check('percentages keep one decimal', formatPct(8.44, 'en') === '8.4%');

  /* ---------- plan summaries in every locale ---------- */
  for (const lang of OUTPUT_LOCALES) {
    const text = localizePlan(plan, lang);
    check(`plan summary renders in ${lang}`, typeof text === 'string' && text.length > 10 && !text.includes('{{'));
  }
  check('the fa summary contains the capital', localizePlan(plan, 'fa').includes('1000') || localizePlan(plan, 'fa').includes('۱۰۰۰'));
  check('a non-plan is refused', localizePlan(null) === null);
  check('a malformed plan is refused', localizePlan({}) === null);

  /* ---------- progress lines ---------- */
  const line = localizeProgress(progress, 'fa');
  check('progress renders in fa', typeof line === 'string' && line.length > 5);
  check('progress says on-pace in the locale', localizeProgress(progress, 'en').includes('on pace'));
  check('behind-pace renders too', localizeProgress({ ...progress, onPace: false }, 'en').includes('behind pace'));

  /* ---------- honest notes ---------- */
  const en = renderTemplate('plan.notGuaranteed', 'en');
  const fa = renderTemplate('plan.notGuaranteed', 'fa');
  check('the not-guaranteed note exists in both', en.includes('not guaranteed') && fa.includes('تضمین'));
  const unreachable = renderTemplate('plan.targetUnreachable', 'fa', { years: '9.5' });
  check('the unreachable note fills its slot', unreachable.includes('9.5') || unreachable.includes('۹'));

  /* ---------- fallback marker ---------- */
  check('an unknown locale falls back to English with a visible marker', renderTemplate('plan.summary', 'xx', { capital: 1, horizon: 1, yield: 1, venues: 1, target: 1 }).endsWith('(EN)'));
  check('a supported locale has no marker', !localizePlan(plan, 'en').endsWith('(EN)'));

  /* ---------- support report ---------- */
  const support = outputLocaleSupport('fa');
  check('support report confirms fa', support.supported === true && support.fallback === null && support.schema === OUTPUT_LOCALE_SCHEMA);
  check('support report marks unknown with fallback', outputLocaleSupport('xx').supported === false && outputLocaleSupport('xx').fallback === 'en');
  check('the report lists all twelve', outputLocaleSupport('en').locales.length === 12);
} catch (e) {
  check(`unexpected error: ${e.message}`, false);
}

const failed = results.filter((r) => !r.ok);
for (const r of results) console.log(`${r.ok ? '✓' : '✗'} ${r.name}`);
console.log(`${results.length - failed.length}/${results.length} passed`);
if (failed.length) {
  console.error(`FAILED: ${failed.map((r) => r.name).join(' | ')}`);
  process.exitCode = 1;
}
export default results;
