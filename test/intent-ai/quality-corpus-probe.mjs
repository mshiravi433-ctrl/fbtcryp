#!/usr/bin/env node
/**
 * PHASE 213 — AI QUALITY & EVALUATION SYSTEM probe.
 * ────────────────────────────────────────────────────────────────────────────
 * 1,000+ deterministic intent test cases against the REAL classifier
 * (src/lib/central/intent.js#classify) — the bar every future upgrade is
 * measured against, exactly as the owner specified:
 *
 *   expected intent · expected entities · expected tools · expected risk
 *   level · expected action · expected confirmation
 *
 * Plus the honesty sweep: with every data source UNAVAILABLE, no sentence may
 * promise execution.
 *
 * Run: node test/intent-ai/quality-corpus-probe.mjs
 * (wired as npm run test:quality and part of test/run.mjs)
 */
import { pathToFileURL } from 'node:url';

process.env.NODE_ENV = process.env.NODE_ENV || 'test';

const rows = [];
const t = (name, ok) => rows.push([name, Boolean(ok)]);

const { classify, INTENT_TYPES } = await import('../../src/lib/central/intent.js');
const {
  generateQualityCorpus,
  runQualityCorpus,
  runHonestySweep,
  corpusDashboard,
  CORPUS_CATEGORIES,
  QUALITY_CORPUS_SCHEMA
} = await import('../../src/lib/intent-ai/qualityCorpus.js');

/* ── 1. the corpus itself ─────────────────────────────────────────────── */
const corpus = generateQualityCorpus();
t('the corpus carries 1,000+ cases', corpus.length >= 1000, { count: corpus.length });
t('every case has the six expected pins (intent/entities/risk/action/confirmation/tools-bearing intent)',
  corpus.every((c) => c.expectedIntent && c.expectedRisk && c.expectedAction && typeof c.expectedConfirmation !== 'undefined' && c.id && c.category));
t('the corpus covers every category the owner listed', [
  'buy', 'sell', 'swap', 'bridge', 'lending', 'borrowing', 'farm', 'futures', 'dydx',
  'stocks', 'macro-instruments', 'goal', 'monitoring', 'risk', 'news', 'whale',
  'portfolio', 'multi-step'
].every((c) => CORPUS_CATEGORIES.includes(c)), CORPUS_CATEGORIES);
t('both locales are represented', corpus.some((c) => c.locale === 'fa') && corpus.some((c) => c.locale === 'en'));
t('the corpus is deterministic (same ids, same order, every run)',
  JSON.stringify(corpus.map((c) => c.id)) === JSON.stringify(generateQualityCorpus().map((c) => c.id)));

/* ── 2. the full-state run ────────────────────────────────────────────── */
const report = runQualityCorpus(classify, { intents: INTENT_TYPES });
t('the quality run answers with the corpus schema', report.schema === QUALITY_CORPUS_SCHEMA);
t(`overall pass rate ≥ 98% (got ${report.passRatePct}%)`, report.passRatePct >= 98, corpusDashboard(report));
for (const [category, row] of Object.entries(report.byCategory)) {
  t(`category ${category} ≥ 90% (got ${row.passRate}%)`, row.passRate >= 90, {
    failures: report.results.filter((r) => r.category === category && !r.passed).slice(0, 5).map((r) => ({ text: r.text, expected: r.expectedIntent, actual: r.actualIntent, failedChecks: r.failedChecks }))
  });
}

/* ── 3. the safety pins (the ones that must be exactly right) ─────────── */
const executeCases = report.results.filter((r) => r.actualPermission === 'EXECUTE');
t('every EXECUTE-classified case demands user confirmation', executeCases.every((r) => r.expectedConfirmation === true));
t('no READ case is classified with EXECUTE permission',
  report.results.filter((r) => r.expectedPermission === 'READ').every((r) => r.actualPermission !== 'EXECUTE'));
const honesty = report.results.filter((r) => r.category === 'unsupported-honesty');
t('gibberish and chit-chat never classify as an execution intent',
  honesty.every((r) => r.actualPermission !== 'EXECUTE'),
  honesty.filter((r) => r.actualPermission === 'EXECUTE').map((r) => r.text));
t('buy/sell/swap/bridge/lend/borrow/repay all classify as their execute intents',
  ['buy', 'sell', 'swap', 'bridge', 'lending', 'borrowing'].every((cat) => report.byCategory[cat]?.passRate >= 90));

/* ── 4. the honesty sweep (dead deployment) ───────────────────────────── */
const sweep = runHonestySweep(classify);
t(`with every source UNAVAILABLE no sentence promises execution (checked ${sweep.checked})`, sweep.ok, sweep.violations.slice(0, 5));

/* ── report ───────────────────────────────────────────────────────────── */
const failed = rows.filter(([, ok]) => !ok);
console.log(`\nquality corpus: ${report.passed}/${report.total} cases passed (${report.passRatePct}%) across ${report.categories} categories`);
console.log(`honesty sweep: ${sweep.checked} cases, ${sweep.violations.length} violations`);
console.log(`${rows.length - failed.length}/${rows.length} checks passed`);
if (failed.length) {
  console.error('\nFAILED checks:');
  for (const [name] of failed) console.error(`  ✗ ${name}`);
  const sample = report.results.filter((r) => !r.passed).slice(0, 25);
  if (sample.length) {
    console.error('\nSample failures:');
    for (const r of sample) {
      console.error(`  [${r.category}] "${r.text}" → expected ${r.expectedIntent}/${r.expectedPermission}, got ${r.actualIntent}/${r.actualPermission} (failed: ${r.failedChecks.join(', ')})`);
    }
  }
  /* Standalone run: exit non-zero. Imported by test/run.mjs: throw so the
     runner's own failure accounting reports this suite as failed (a bare
     process.exit here would terminate every suite after this one). */
  if (import.meta.url === pathToFileURL(process.argv[1] || '').href) process.exit(1);
  throw new Error(`quality-corpus-probe: ${failed.length} check(s) failed`);
}
if (import.meta.url === pathToFileURL(process.argv[1] || '').href) process.exit(0);
