/**
 * AI BENCHMARK & PROVIDER LAB — HTTP surface
 * ---------------------------------------------------------------------------
 * Mounted at `/api/v1/ai` beside the gateway, orchestrator and memory routes.
 * Additive only: no existing path is renamed, moved or re-implemented.
 *
 *   GET  /benchmark/suite       suite metadata; `?full=1` returns all 100 rows
 *   GET  /benchmark/status      last run + live provider telemetry (cheap)
 *   POST /benchmark/run         run a slice of the suite (costs real tokens)
 *   GET  /lab/tests             the 15-test catalogue
 *   GET  /lab/status            last lab run + catalogue
 *   POST /lab/run               run the connectivity/resilience tests
 *   GET  /intelligence/status   one combined dashboard read
 *
 * ─── COST GUARD ────────────────────────────────────────────────────────────
 * A benchmark call spends real provider quota. Unlike the free health read,
 * POST /benchmark/run is capped: by default at 10 questions and 2 providers
 * (at most 20 model calls). A caller that presents CRON_SECRET gets 100/8.
 * The cap is in the RESPONSE (`limits`) so the dashboard can tell the user why
 * a run was shortened instead of silently truncating.
 *
 * The 100-question full comparison is a deliberate operator job, not a button
 * a stranger can press: `node scripts/ai-benchmark.mjs --local --mode single …`
 * runs it outside the request budget.
 */

import { Router } from 'express';
import { BENCHMARK_SUITE, suiteMetadata, CATEGORIES } from './aiBenchmarkSuite.js';
import { runBenchmark, benchmarkStatus, createLocalAsk, getLastRun } from './aiBenchmark.js';
import { runProviderLab, getLastLabRun, TEST_CATALOG } from './aiProviderLab.js';
import { getAvailableProviders } from './aiGateway.js';

export const BENCHMARK_ROUTES_SCHEMA = 'fbt.ai-benchmark.routes.v1';

const PUBLIC_MAX_QUESTIONS = 10;
const ADMIN_MAX_QUESTIONS = 100;
const PUBLIC_MAX_PROVIDERS = 2;
const ADMIN_MAX_PROVIDERS = 8;
const MAX_MESSAGE = 1200;

function providedSecret(req) {
  return req.get('authorization')?.replace(/^Bearer\s+/i, '') ||
    req.get('x-cron-secret') ||
    String(req.query.key || '') ||
    '';
}

function isAdmin(req) {
  const secret = process.env.CRON_SECRET || '';
  return Boolean(secret) && providedSecret(req) === secret;
}

function intList(value) {
  const arr = Array.isArray(value)
    ? value
    : String(value ?? '').split(',').filter(Boolean);
  return arr
    .map((x) => Number(x))
    .filter((n) => Number.isInteger(n) && n >= 1 && n <= 100);
}

function strList(value) {
  const arr = Array.isArray(value) ? value : String(value ?? '').split(',').filter(Boolean);
  return [...new Set(arr.map((x) => String(x).trim()).filter(Boolean))].slice(0, 10);
}

/**
 * The system under test is THIS deployment, in-process. No caller-supplied URL
 * is accepted: a benchmark endpoint that fetches an arbitrary address would be
 * an SSRF primitive on a server that holds provider keys. Remote evaluation is
 * the CLI's job (`scripts/ai-benchmark.mjs` runs against its own environment).
 */
function buildAsk({ locale = 'fa' }) {
  return createLocalAsk({ locale });
}

export function createBenchmarkRouter() {
  const router = Router();

  router.get('/benchmark/suite', (req, res) => {
    const meta = suiteMetadata();
    if (String(req.query.full || '') === '1') {
      return res.json({ ok: true, schema: BENCHMARK_ROUTES_SCHEMA, ...meta, questions: BENCHMARK_SUITE });
    }
    return res.json({ ok: true, schema: BENCHMARK_ROUTES_SCHEMA, ...meta });
  });

  router.get('/benchmark/status', async (_req, res) => {
    try {
      const status = await benchmarkStatus();
      const lab = await getLastLabRun();
      return res.json({
        ok: true,
        schema: BENCHMARK_ROUTES_SCHEMA,
        ...status,
        lab: lab ? { startedAt: lab.startedAt, summary: lab.summary, ok: lab.ok } : null
      });
    } catch (err) {
      return res.status(500).json({ ok: false, error: 'BENCHMARK_STATUS_FAILED', detail: String(err?.message || err).slice(0, 200) });
    }
  });

  router.post('/benchmark/run', async (req, res) => {
    const admin = isAdmin(req);
    const body = req.body || {};
    const mode = ['single', 'multi', 'collective'].includes(body.mode) ? body.mode : 'single';
    const requested = intList(body.ids);
    const categories = strList(body.categories).filter((c) => CATEGORIES[c]);
    const smoke = body.smoke === true || body.smoke === '1';
    const ids = smoke && !requested.length ? [...suiteMetadata().smokeIds] : requested;
    const maxQ = admin ? ADMIN_MAX_QUESTIONS : PUBLIC_MAX_QUESTIONS;
    const maxP = admin ? ADMIN_MAX_PROVIDERS : PUBLIC_MAX_PROVIDERS;

    let providers = strList(body.providers).filter((id) => id !== 'internal');
    if (mode === 'single' && !providers.length) {
      providers = getAvailableProviders().filter((p) => p.configured && p.id !== 'internal').map((p) => p.id);
    }
    const providersTrimmed = providers.slice(0, maxP);
    const limitRequested = Number(body.limit) > 0 ? Number(body.limit) : null;
    const limit = Math.min(limitRequested ?? maxQ, maxQ);

    const ask = buildAsk({ locale: body.locale === 'en' ? 'en' : 'fa' });

    try {
      const run = await runBenchmark({
        ask,
        mode,
        providers: providersTrimmed,
        ids,
        categories,
        limit,
        concurrency: Math.min(4, Math.max(1, Number(body.concurrency) || 2)),
        persist: Boolean(body.persist !== false),
        label: body.label ? String(body.label).slice(0, 80) : (smoke ? 'smoke' : null)
      });
      return res.json({
        ok: true,
        schema: BENCHMARK_ROUTES_SCHEMA,
        limits: { questions: maxQ, providers: maxP, admin, requestedLimit: limitRequested, appliedLimit: limit },
        note: 'Scores are a deterministic rubric (0–100), not ground truth. Read the flags with the number.',
        run
      });
    } catch (err) {
      const code = err?.reasonCode || (String(err?.message || '').includes('NO_QUESTIONS') ? 'NO_QUESTIONS_SELECTED' : 'BENCHMARK_RUN_FAILED');
      const status = code === 'NO_CONFIGURED_PROVIDER' ? 409 : 400;
      return res.status(status).json({ ok: false, error: code, detail: String(err?.message || err).slice(0, 240), limits: { questions: maxQ, providers: maxP, admin } });
    }
  });

  router.get('/lab/tests', (_req, res) => res.json({
    ok: true,
    schema: BENCHMARK_ROUTES_SCHEMA,
    total: TEST_CATALOG.length,
    tests: TEST_CATALOG
  }));

  router.get('/lab/status', async (_req, res) => {
    const last = await getLastLabRun();
    return res.json({
      ok: true,
      schema: BENCHMARK_ROUTES_SCHEMA,
      catalogue: TEST_CATALOG,
      lastRun: last
        ? {
            startedAt: last.startedAt,
            finishedAt: last.finishedAt,
            durationMs: last.durationMs,
            ok: last.ok,
            summary: last.summary,
            tests: last.tests
          }
        : null
    });
  });

  router.post('/lab/run', async (req, res) => {
    const body = req.body || {};
    const tests = strList(body.tests).filter((id) => TEST_CATALOG.some((t) => t.id === id));
    try {
      const report = await runProviderLab({ tests });
      return res.json({ ok: true, schema: BENCHMARK_ROUTES_SCHEMA, report });
    } catch (err) {
      return res.status(500).json({ ok: false, error: 'LAB_RUN_FAILED', detail: String(err?.message || err).slice(0, 240) });
    }
  });

  /**
   * One read for the dashboard: suite size, last benchmark, last lab, and the
   * live per-provider telemetry (connected / last success / model / latency /
   * tokens / error rate / failover / last health check). Every field is
   * evidence-based; none is derived from a saved setting.
   */
  router.get('/intelligence/status', async (_req, res) => {
    try {
      const [status, lastLab, lastRun] = await Promise.all([
        benchmarkStatus(),
        getLastLabRun(),
        getLastRun()
      ]);
      return res.json({
        ok: true,
        schema: BENCHMARK_ROUTES_SCHEMA,
        suite: status.suite,
        fleet: status.fleet,
        providers: status.providerTelemetry,
        benchmark: {
          lastRun: status.lastRun,
          lastRunId: lastRun?.runId || null
        },
        lab: lastLab
          ? { ok: lastLab.ok, startedAt: lastLab.startedAt, durationMs: lastLab.durationMs, summary: lastLab.summary, tests: lastLab.tests }
          : null,
        caveats: {
          connected: 'True only when this process saw a successful provider call. A key is not a connection.',
          cost: 'Token counts are provider-reported. USD figures are an explicit estimate table, not a bill.',
          scores: 'Deterministic rubric 0–100; a proxy for quality, not ground truth.'
        },
        at: Date.now()
      });
    } catch (err) {
      return res.status(500).json({ ok: false, error: 'INTELLIGENCE_STATUS_FAILED', detail: String(err?.message || err).slice(0, 200) });
    }
  });

  return router;
}

export default createBenchmarkRouter();
