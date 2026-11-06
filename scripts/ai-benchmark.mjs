#!/usr/bin/env node
/**
 * FBT AI BENCHMARK CLI
 * ---------------------------------------------------------------------------
 * Runs the 100-question suite and/or the 15 provider-lab tests against the
 * providers configured in THIS environment, and writes an auditable report.
 *
 *   node scripts/ai-benchmark.mjs --lab
 *   node scripts/ai-benchmark.mjs --smoke --mode single
 *   node scripts/ai-benchmark.mjs --all --mode single --providers openai,anthropic,gemini,xai,deepseek,openrouter
 *   node scripts/ai-benchmark.mjs --all --mode collective --concurrency 2
 *
 * What it will not do:
 *   · invent a result for a provider that has no key;
 *   · call a skipped test a pass;
 *   · report an estimated USD figure as a bill;
 *   · execute, sign or move anything.
 *
 * Exit codes: 0 at least one result produced and every executed question
 *             scored; 2 no provider configured / nothing to run; 1 internal
 *             error. A low score is NOT an error exit — it is the finding.
 */

import { writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import {
  runBenchmark,
  createLocalAsk,
  renderRunMarkdown,
  PRICING_VERSION
} from '../server/aiBenchmark.js';
import { runProviderLab, TEST_CATALOG } from '../server/aiProviderLab.js';
import { getAvailableProviders, getFleetSummary } from '../server/aiGateway.js';
import { suiteMetadata, SMOKE_IDS } from '../server/aiBenchmarkSuite.js';

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) { out._.push(a); continue; }
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next && !next.startsWith('--')) { out[key] = next; i++; }
    else out[key] = true;
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
const list = (v) => String(v ?? '').split(',').map((x) => x.trim()).filter(Boolean);
const num = (v, d) => (Number.isFinite(Number(v)) ? Number(v) : d);

function log(line = '') { process.stdout.write(`${line}\n`); }

async function main() {
  const meta = suiteMetadata();
  const providers = getAvailableProviders();
  const external = providers.filter((p) => p.id !== 'internal');
  const configured = external.filter((p) => p.configured);

  log('FBT AI BENCHMARK');
  log(`Suite ${meta.version} · ${meta.size} questions · ${PRICING_VERSION} price table (ESTIMATE)`);
  log(`Fleet: ${configured.length}/${external.length} keyed · ${getFleetSummary().servingFrom.join(', ')}`);
  if (!configured.length) {
    log('');
    log('No external provider is configured in this environment, so no live comparison is possible.');
    log('Set at least one of these and re-run:');
    for (const p of external) log(`  · ${p.id.padEnd(11)} ${p.envVar}`);
    log('');
    log('The suite and the scorer are still importable and offline-testable; this is not a failure of the benchmark.');
    if (!args.lab) process.exit(2);
  }

  const reports = {};

  if (args.lab) {
    log('');
    log('── Provider lab (15 tests) ─────────────────────────────────────────');
    const lab = await runProviderLab({ tests: args.tests ? list(args.tests) : null });
    for (const t of lab.tests) {
      const mark = t.status === 'PASS' ? '✓' : t.status === 'SKIPPED' ? '–' : '✗';
      const extra = t.status === 'SKIPPED'
        ? ` ${t.reasonCode}${t.detail ? ` (${t.detail})` : ''}`
        : t.status === 'PASS'
          ? ` ${t.model || t.servedBy || ''}${t.latencyMs != null ? ` ${t.latencyMs}ms` : ''}`
          : ` ${t.reasonCode || ''} ${t.error || ''}`;
      log(`  ${mark} ${t.fa.padEnd(26)} [${t.method}] ${t.status}${extra}`);
    }
    log(`  summary: ${lab.summary.passed} passed · ${lab.summary.failed} failed · ${lab.summary.skipped} skipped · ${lab.summary.connectedProviderCount} connected`);
    reports.lab = lab;
  }

  if (!args.lab || args.bench || args.all || args.smoke) {
    const mode = ['single', 'multi', 'collective'].includes(args.mode) ? args.mode : 'single';
    const ids = args.ids ? list(args.ids).map(Number) : (args.smoke ? [...SMOKE_IDS] : null);
    const selectedProviders = args.providers
      ? list(args.providers).filter((id) => id !== 'internal')
      : (mode === 'single' ? configured.map((p) => p.id) : null);

    if (mode === 'single' && !selectedProviders.length) {
      log('');
      log('Single-model comparison needs at least one configured provider.');
      if (!args.lab) process.exit(2);
    } else {
      log('');
      log(`── Benchmark (${mode}${ids ? `, ${ids.length} ids` : ''}${args.categories ? `, ${args.categories}` : ''}) ─────────────`);
      const ask = createLocalAsk({ locale: args.locale === 'en' ? 'en' : 'fa' });
      let done = 0;
      const run = await runBenchmark({
        ask,
        mode,
        providers: selectedProviders,
        ids,
        categories: args.categories ? list(args.categories) : null,
        limit: args.limit ? num(args.limit, null) : null,
        concurrency: num(args.concurrency, 3),
        persist: false,
        label: args.label || (args.smoke ? 'smoke' : null),
        onResult: (row) => {
          done += 1;
          const provider = row.provider || 'n/a';
          log(`  ${String(done).padStart(3)} Q${String(row.questionId).padStart(3)} ${provider.padEnd(11)} ${row.score.toString().padStart(3)}/100 ${row.passed ? 'PASS' : row.verdict}${row.flags.length ? ` · ${row.flags.slice(0, 3).join(',')}` : ''}`);
        }
      });
      reports.benchmark = run;
      log('');
      log('── Leaderboard ────────────────────────────────────────────────────');
      for (const row of run.aggregate.leaderboard) {
        log(`  ${row.provider.padEnd(12)} ${String(row.avgScore).padStart(5)} avg · ${(row.passRate * 100).toFixed(1)}% pass · ${row.questions} q · ~$${row.costEstimateUsd}`);
      }
      if (run.aggregate.providers.internal) {
        const i = run.aggregate.providers.internal;
        log(`  ${'internal'.padEnd(12)} ${String(i.avgScore).padStart(5)} avg · ${(i.passRate * 100).toFixed(1)}% pass · ${i.questions} q · rule engine`);
      }
    }
  }

  const outBase = args.out ? String(args.out) : 'reports/ai-benchmark/latest';
  const outPath = outBase.endsWith('.md') ? outBase : `${outBase}.md`;
  const jsonPath = outBase.endsWith('.md') ? outBase.replace(/\.md$/, '.json') : `${outBase}.json`;

  const parts = [];
  if (reports.benchmark) parts.push(renderRunMarkdown(reports.benchmark));
  if (reports.lab) {
    parts.push('');
    parts.push('# Provider Lab');
    parts.push('');
    parts.push('| Test | Method | Status | Evidence |');
    parts.push('|---|---|---|---|');
    for (const t of reports.lab.tests) {
      const evidence = t.status === 'SKIPPED'
        ? `${t.reasonCode}${t.detail ? ` — ${t.detail}` : ''}`
        : t.status === 'PASS'
          ? [t.model, t.servedBy, t.latencyMs != null ? `${t.latencyMs}ms` : null, t.classification?.kind].filter(Boolean).join(' · ')
          : `${t.reasonCode || ''} ${t.error || ''}`.trim();
      parts.push(`| ${t.fa} | ${t.method} | ${t.status} | ${String(evidence).replace(/\|/g, '/')} |`);
    }
    parts.push('');
    parts.push(`Connected (LIVE proof this run): ${reports.lab.summary.connectedProviders.map((p) => `${p.provider}/${p.model || '?'}`).join(', ') || 'none'}`);
  }

  await mkdir(dirname(resolve(outPath)), { recursive: true });
  await writeFile(resolve(outPath), parts.join('\n'), 'utf8');
  await writeFile(resolve(jsonPath), JSON.stringify({ generatedAt: new Date().toISOString(), suite: meta, ...reports }, null, 2), 'utf8');
  log('');
  log(`Report written to ${outPath} and ${jsonPath}`);

  const benchOk = reports.benchmark
    ? reports.benchmark.results.some((r) => r.verdict !== 'ERROR')
    : false;
  const labConnected = reports.lab ? (reports.lab.summary?.connectedProviderCount || 0) > 0 : false;
  if (reports.benchmark) process.exit(benchOk ? 0 : 1);
  /* Lab-only run: "I ran it and nothing was connected" is a finding, not a
     crash, but it must not look like success to a CI job either. */
  process.exit(labConnected ? 0 : 2);
}

main().catch((err) => {
  console.error('BENCHMARK FAILED:', err?.stack || err);
  process.exit(1);
});
