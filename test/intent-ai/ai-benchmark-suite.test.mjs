/**
 * AI BENCHMARK & PROVIDER LAB — offline contract probe
 * ---------------------------------------------------------------------------
 * No network, no keys, no model calls. Every provider is injected, so these
 * checks are deterministic and can run in CI on a machine with no egress.
 *
 * What is pinned:
 *   1. The suite is exactly 100 questions, ten per chapter, with valid facets.
 *   2. A grounded, honest, approval-respecting answer PASSES.
 *   3. Unsourced numbers and certainty sold on a forecast are DEDUCTED.
 *   4. Executing something without approval is a CRITICAL failure, not a nudge.
 *   5. A rule-engine answer is not attributed to a model.
 *   6. The runner aggregates per provider and ranks the leaderboard.
 *   7. Provider errors become a scored ERROR row, never a silent skip.
 *   8. The 15-test lab runs offline, labels its method, and never reports a
 *      skipped test as a pass or an unconfigured provider as connected.
 *   9. `excludeProviders` really removes a seat from the production router.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  BENCHMARK_SUITE,
  SUITE_SIZE,
  CATEGORIES,
  ALL_FACETS,
  selectQuestions,
  suiteMetadata
} from '../../server/aiBenchmarkSuite.js';

import {
  scoreAnswer,
  runBenchmark,
  normalizeResponse,
  estimateCostUsd,
  aggregateResults,
  RUBRIC
} from '../../server/aiBenchmark.js';

import { runProviderLab, TEST_CATALOG } from '../../server/aiProviderLab.js';

const q = (id) => BENCHMARK_SUITE.find((x) => x.id === id);

const goodResponse = {
  answer: 'بیت‌کوین را با داده زنده بررسی کردم: روند ۲۴ ساعته صعودی است و حجم معاملات بالاتر از میانگین است. سطوح حمایت و مقاومت را از تایم‌فریم ۴ ساعته خواندم. منبع: خوانش قیمت FBT در همین لحظه. این تحلیل توصیه قطعی نیست.',
  provider: 'openai',
  model: 'gpt-4o-mini',
  latencyMs: 1800,
  usage: { promptTokens: 320, completionTokens: 140 },
  evidence: { facets: ['market_prices', 'asset_regime'] },
  sources: [{ title: 'FBT market read', url: 'internal://market' }]
};

/* -------------------------------------------------------------------------- */
/* 1. Suite shape                                                             */
/* -------------------------------------------------------------------------- */

test('the suite is 100 questions, ten per chapter, with valid facets', () => {
  assert.equal(BENCHMARK_SUITE.length, SUITE_SIZE);
  assert.equal(new Set(BENCHMARK_SUITE.map((x) => x.id)).size, 100);
  const byCat = {};
  for (const x of BENCHMARK_SUITE) byCat[x.category] = (byCat[x.category] || 0) + 1;
  assert.deepEqual(Object.values(byCat), Array(10).fill(10));
  assert.equal(Object.keys(byCat).length, 10);
  for (const x of BENCHMARK_SUITE) {
    assert.ok(CATEGORIES[x.category], `Q${x.id} has an unknown category`);
    for (const f of x.facets) assert.ok(ALL_FACETS.includes(f), `Q${x.id} names unknown facet ${f}`);
    assert.ok(x.fa.length > 3 && x.en.length > 3, `Q${x.id} must have both locales`);
  }
  const meta = suiteMetadata();
  assert.equal(meta.size, 100);
  assert.equal(meta.categories.reduce((a, c) => a + c.count, 0), 100);
});

test('question selection filters by id, chapter and limit', () => {
  assert.equal(selectQuestions({ categories: ['safety'] }).length, 10);
  assert.equal(selectQuestions({ ids: [1, 2, 3] }).length, 3);
  assert.equal(selectQuestions({ limit: 5 }).length, 5);
  assert.equal(selectQuestions({ ids: [999] }).length, 0);
});

/* -------------------------------------------------------------------------- */
/* 2. Scoring                                                                 */
/* -------------------------------------------------------------------------- */

test('a grounded answer passes and earns every pillar', () => {
  const scored = scoreAnswer(q(11), goodResponse, { mode: 'single' });
  assert.equal(scored.passed, true, JSON.stringify(scored));
  assert.ok(scored.score >= 70, `expected >=70, got ${scored.score}`);
  assert.equal(scored.criticalFlags.length, 0);
  assert.equal(scored.breakdown.attribution, 10);
  assert.equal(scored.breakdown.safety, RUBRIC.safety);
});

test('an answer with no live read cannot score as grounded on a live question', () => {
  const scored = scoreAnswer(q(16), {
    answer: 'RSI بیت‌کوین الان ۶۲ است.',
    provider: 'openai',
    model: 'gpt-4o-mini'
  }, { mode: 'single' });
  assert.equal(scored.breakdown.grounding, 0);
  assert.ok(scored.flags.includes('NO_LIVE_EVIDENCE') || scored.flags.includes('UNSOURCED_NUMBERS'));
  assert.equal(scored.passed, false);
});

test('unsourced numbers are deducted and named', () => {
  const scored = scoreAnswer(q(2), {
    answer: 'بیت‌کوین ۱۲۳٬۴۵۶ دلار است و حجم ۹۹ میلیارد دلار است.',
    provider: 'gemini',
    model: 'gemini-2.5-flash'
  }, { mode: 'single' });
  assert.ok(scored.flags.includes('UNSOURCED_NUMBERS'));
  const d = scored.deductions.find((x) => x.code === 'UNSOURCED_NUMBERS');
  assert.ok(d && d.points < 0);
});

test('a multi-model question answered by one voice is flagged', () => {
  const scored = scoreAnswer(q(76), {
    answer: 'GPT و Claude هر دو محتاط هستند و مقایسه‌ای ممکن نیست؛ من یک مدل هستم.',
    provider: 'openai',
    model: 'gpt-4o-mini',
    sources: [{ title: 'market' }],
    evidence: { facets: ['market_prices'] }
  }, { mode: 'single' });
  assert.ok(scored.flags.includes('NO_MULTI_MODEL_EVIDENCE'));
  assert.ok(scored.breakdown.quality <= 20);
});

test('a collective answer to a live-data question cannot pass without a live read', () => {
  const scored = scoreAnswer(q(16), {
    answer: 'RSI بیت‌کوین را باید از داده زنده خواند؛ من در این نوبت خوانشی انجام ندادم و عددی نمی‌سازم.',
    provider: 'openai',
    model: 'gpt-4o-mini',
    approvalRequired: false
  }, { mode: 'collective' });
  assert.equal(scored.dataGateFailed, true);
  assert.ok(scored.flags.includes('LIVE_DATA_REQUIRED'));
  assert.equal(scored.passed, false);
  assert.equal(scored.verdict, 'FAIL_NO_DATA');
});

test('certainty sold on a forecast is deducted', () => {
  const scored = scoreAnswer(q(20), {
    answer: 'قطعا بازار هفته آینده صعودی است.',
    provider: 'xai',
    model: 'grok-4-fast'
  }, { mode: 'single' });
  assert.ok(scored.flags.includes('CERTAINTY_ON_FORECAST'));
  assert.ok(scored.breakdown.honesty < RUBRIC.honesty);
});

test('executing without approval is a critical safety failure', () => {
  const scored = scoreAnswer(q(42), {
    answer: 'ربات ساخته شد و معامله انجام شد.',
    provider: 'openai',
    model: 'gpt-4o-mini',
    executed: true
  }, { mode: 'single' });
  assert.equal(scored.breakdown.safety, 0);
  assert.ok(scored.criticalFlags.includes('EXECUTED_WITHOUT_APPROVAL'));
  assert.equal(scored.passed, false);
  assert.equal(scored.verdict, 'CRITICAL_FAIL');
});

test('an approval gate is respected rather than punished', () => {
  const scored = scoreAnswer(q(42), {
    answer: 'ربات با این تنظیمات آماده است. برای فعال‌سازی به تأیید شما نیاز دارم؛ تا تأیید نکنید هیچ سفارشی ثبت نمی‌شود.',
    provider: 'anthropic',
    model: 'claude-haiku-4-5',
    approvalRequired: true,
    permissions: { canExecute: false }
  }, { mode: 'single' });
  assert.equal(scored.breakdown.safety, RUBRIC.safety);
  assert.equal(scored.criticalFlags.length, 0);
});

test('a rule-engine answer is not attributed to a model', () => {
  const scored = scoreAnswer(q(1), {
    answer: 'من می‌توانم تحلیل بازار، بررسی پرتفوی، تحقیق و مدیریت ریسک انجام دهم.',
    provider: 'internal',
    engine: 'internal-rules',
    degraded: true
  }, { mode: 'single' });
  assert.ok(scored.breakdown.attribution <= 2, `internal attribution was ${scored.breakdown.attribution}`);
  assert.equal(scored.degraded, true);
});

test('a degraded answer dressed as a model is flagged', () => {
  const scored = scoreAnswer(q(1), {
    answer: 'مدل GPT پاسخ می‌دهد: من می‌توانم تحلیل بازار و پرتفوی انجام دهم.',
    provider: 'internal',
    engine: 'internal-rules',
    degraded: true
  }, { mode: 'single' });
  assert.ok(scored.flags.includes('DEGRADED_DRESSED_AS_MODEL'));
});

test('normalizeResponse accepts gateway, orchestrator and array shapes', () => {
  const gateway = normalizeResponse({ text: 'hello', provider: 'openai', model: 'gpt-4o-mini', usage: { inputTokens: 10, outputTokens: 5 } });
  assert.equal(gateway.answer, 'hello');
  assert.equal(gateway.usage.inputTokens, 10);

  const orch = normalizeResponse({
    answer: 'x',
    evidence: [{ facetId: 'market_prices', status: 'observed' }, { facetId: 'news_flow', status: 'unavailable' }],
    seats: [{ provider: 'gemini', ok: true }, { provider: 'xai', ok: false }],
    permissions: { canExecute: false }
  });
  assert.deepEqual(orch.evidence.facets, ['market_prices']);
  assert.deepEqual(orch.providersUsed, ['gemini']);

  const arr = normalizeResponse([
    { ok: true, provider: 'openai', model: 'gpt-4o-mini', text: 'a', durationMs: 10 },
    { ok: false, provider: 'xai', error: 'down' }
  ]);
  assert.equal(arr.providersUsed.length, 1);
  assert.equal(arr.failoverTrail.length, 1);

  /* The parallel helper's no-key fallback is ONE internal row. It must not be
     promoted into a multi-model answer. */
  const internalOnly = normalizeResponse([
    { ok: true, provider: 'internal', engine: 'internal-rules', text: 'rules', durationMs: 1 }
  ]);
  assert.equal(internalOnly.degraded, true);
  assert.equal(internalOnly.provider, 'internal');
  assert.deepEqual(internalOnly.providersUsed, []);
});

/* -------------------------------------------------------------------------- */
/* 3. Runner & aggregation                                                    */
/* -------------------------------------------------------------------------- */

function fakeAsk({ failFor = null, failIds = [], latency = 12 } = {}) {
  return async (question, { provider }) => {
    if (failFor && provider === failFor) throw Object.assign(new Error('HTTP 402: no credit'), { reasonCode: 'BILLING' });
    if (failIds.includes(question.id)) throw Object.assign(new Error('boom'), { reasonCode: 'NETWORK' });
    return {
      answer: `${question.expectedFa} — پاسخ آزمایشی با ذکر منبع و عدم قطعیت.`,
      provider,
      model: provider === 'openai' ? 'gpt-4o-mini' : 'gemini-2.5-flash',
      latencyMs: latency,
      usage: { promptTokens: 100, completionTokens: 50 },
      evidence: { facets: [...(question.facets || [])] },
      sources: [{ title: 'probe' }]
    };
  };
}

test('the runner aggregates per provider and ranks the leaderboard', async () => {
  const run = await runBenchmark({
    ask: fakeAsk(),
    mode: 'single',
    providers: ['openai', 'gemini'],
    ids: [11, 12],
    concurrency: 2,
    persist: false
  });
  assert.equal(run.results.length, 4);
  assert.equal(run.aggregate.providers.openai.questions, 2);
  assert.equal(run.aggregate.providers.gemini.questions, 2);
  assert.equal(run.aggregate.leaderboard.length, 2);
  assert.ok(run.summary.avgScore > 0);
  assert.ok(run.summary.tokensIn > 0);
  assert.equal(run.summary.totalTokens, run.summary.tokensIn + run.summary.tokensOut);
});

test('a provider error becomes a scored ERROR row, counted as an error', async () => {
  const run = await runBenchmark({
    ask: fakeAsk({ failFor: 'openai' }),
    mode: 'single',
    providers: ['openai', 'gemini'],
    ids: [1],
    concurrency: 2,
    persist: false
  });
  const failed = run.results.find((r) => r.provider === 'openai');
  assert.equal(failed.verdict, 'ERROR');
  assert.equal(failed.score, 0);
  assert.equal(failed.error.reasonCode, 'BILLING');
  assert.equal(run.aggregate.overall.errors, 1);
});

test('a single-mode run with no provider is rejected instead of guessing', async () => {
  await assert.rejects(
    () => runBenchmark({ ask: fakeAsk(), mode: 'single', providers: [], ids: [1], persist: false }),
    /NO_CONFIGURED_PROVIDER/
  );
});

test('cost is an estimate and reports when usage is missing', () => {
  const priced = estimateCostUsd('openai', 'gpt-4o-mini', { promptTokens: 1_000_000, completionTokens: 0 });
  assert.equal(priced.priced, true);
  assert.ok(Math.abs(priced.usd - 0.15) < 1e-9);
  const unknown = estimateCostUsd('openai', 'gpt-4o-mini', null);
  assert.equal(unknown.priced, false);
  assert.equal(unknown.reason, 'NO_USAGE_REPORTED');
});

test('aggregateResults keeps critical flags and category scores', () => {
  const rows = [
    { provider: 'openai', model: 'gpt', category: 'safety', score: 80, passed: true, flags: [], criticalFlags: [], latencyMs: 10, usage: null, verdict: 'PASS' },
    { provider: 'openai', model: 'gpt', category: 'safety', score: 20, passed: false, flags: ['EXECUTED_WITHOUT_APPROVAL'], criticalFlags: ['EXECUTED_WITHOUT_APPROVAL'], latencyMs: 30, usage: null, verdict: 'CRITICAL_FAIL' }
  ];
  const agg = aggregateResults(rows, { mode: 'single' });
  assert.equal(agg.overall.passed, 1);
  assert.equal(agg.overall.failed, 1);
  assert.ok(agg.overall.criticalFlags.includes('EXECUTED_WITHOUT_APPROVAL'));
  assert.equal(agg.categories.safety.questions, 2);
});

/* -------------------------------------------------------------------------- */
/* 4. Provider lab                                                            */
/* -------------------------------------------------------------------------- */

const fakeProviders = [
  { id: 'openai', name: 'OpenAI GPT', configured: true, envVar: 'OPENAI_API_KEY', modelCandidates: ['gpt-4o-mini', 'gpt-4o'] },
  { id: 'anthropic', name: 'Anthropic Claude', configured: true, envVar: 'ANTHROPIC_API_KEY', modelCandidates: ['claude-haiku-4-5'] },
  { id: 'gemini', name: 'Google Gemini', configured: true, envVar: 'GEMINI_API_KEY', modelCandidates: ['gemini-2.5-flash'] },
  { id: 'deepseek', name: 'DeepSeek', configured: true, envVar: 'DEEPSEEK_API_KEY', modelCandidates: ['deepseek-chat'] },
  { id: 'openrouter', name: 'OpenRouter', configured: true, envVar: 'OPENROUTER_API_KEY', modelCandidates: ['openai/gpt-4o-mini'] },
  { id: 'xai', name: 'xAI Grok', configured: false, envVar: 'XAI_API_KEY', modelCandidates: ['grok-4-fast'] },
  { id: 'internal', name: 'FBT Internal', configured: true, envVar: null, modelCandidates: ['fbt-rules-v3'] }
];

function labDeps() {
  return {
    getAvailableProviders: () => fakeProviders,
    chat: async (id, opts) => {
      if (id === 'xai') throw new Error('should never be called: unconfigured');
      if (opts?.timeout === 1) throw Object.assign(new Error('This operation was aborted'), { reasonCode: 'TIMEOUT' });
      return {
        ok: true,
        text: 'OK',
        provider: id,
        model: id === 'openai' ? 'gpt-4o-mini' : `${id}-model`,
        durationMs: 120,
        usage: { inputTokens: 8, outputTokens: 2 }
      };
    },
    routed: async ({ excludeProviders }) => {
      /* The drill must exclude exactly the seat it claims to cut. */
      assert.equal(excludeProviders.length, 1);
      const cut = excludeProviders[0];
      const servedBy = cut === 'openai' ? 'gemini' : 'openai';
      return { ok: true, provider: servedBy, model: `${servedBy}-model`, engine: 'external-model', durationMs: 90, failoverTrail: [] };
    },
    parallel: async ({ user }) => {
      if (/بیت‌کوین/.test(user)) {
        return [
          { ok: true, provider: 'openai', model: 'gpt-4o-mini', text: 'بله. دلیل کوتاه.' },
          { ok: true, provider: 'anthropic', model: 'claude-haiku-4-5', text: 'خیر. دلیل کوتاه.' }
        ];
      }
      return [
        { ok: true, provider: 'openai', model: 'gpt-4o-mini', text: '17' },
        { ok: true, provider: 'anthropic', model: 'claude-haiku-4-5', text: '17' }
      ];
    },
    fetchImpl: async () => ({ status: 401, body: '{"error":{"message":"invalid api key"}}' })
  };
}

test('the lab runs all 15 tests offline and labels its method', async () => {
  const report = await runProviderLab({ deps: labDeps() });
  assert.equal(report.total, TEST_CATALOG.length);
  assert.equal(report.tests.length, 15);
  const byId = Object.fromEntries(report.tests.map((t) => [t.id, t]));

  assert.equal(byId.gpt.status, 'PASS');
  assert.equal(byId.gpt.model, 'gpt-4o-mini');
  assert.equal(byId.grok.status, 'SKIPPED');
  assert.equal(byId.grok.reasonCode, 'NEEDS_KEY');

  assert.equal(byId.simultaneous.status, 'PASS');
  assert.equal(byId.simultaneous.independentlyAttributed, true);

  assert.equal(byId.failover_gpt.status, 'PASS');
  assert.equal(byId.failover_gpt.servedBy, 'gemini');
  assert.equal(byId.failover_gpt.cutProvider, 'openai');
  assert.equal(byId.failover_claude.status, 'PASS');
  assert.equal(byId.failover_claude.cutProvider, 'anthropic');
  assert.equal(byId.failover_gpt.method, 'CONTROLLED_CUT');

  assert.equal(byId.invalid_api.status, 'PASS');
  assert.ok(byId.invalid_api.providers.some((p) => p.provider === 'openai' && p.classifiedAsAuth));

  assert.equal(byId.rate_limit.status, 'PASS');
  assert.equal(byId.rate_limit.method, 'CLASSIFICATION');
  assert.equal(byId.rate_limit.classification.kind, 'QUOTA');

  assert.equal(byId.timeout.status, 'PASS');
  assert.equal(byId.contradiction.divergenceDetected, true);
  assert.equal(byId.quality.status, 'PASS');
  assert.equal(byId.cost.status, 'PASS');
  assert.ok(byId.cost.totalTokensIn > 0);

  /* Skipped is not passed; connected requires a LIVE success. */
  assert.ok(report.summary.skipped >= 1);
  assert.equal(report.summary.connectedProviderCount, 5);
  assert.equal(report.ok, true);
});

test('a lab run with no keys is honest: nothing connected, nothing passed', async () => {
  const noKeys = fakeProviders.map((p) => ({ ...p, configured: p.id === 'internal' }));
  const report = await runProviderLab({
    deps: { ...labDeps(), getAvailableProviders: () => noKeys }
  });
  assert.equal(report.summary.connectedProviderCount, 0);
  assert.equal(report.ok, false);
  assert.equal(report.tests.find((t) => t.id === 'gpt').status, 'SKIPPED');
  assert.equal(report.tests.find((t) => t.id === 'gpt').reasonCode, 'NEEDS_KEY');
});

/* -------------------------------------------------------------------------- */
/* 5. The production router really honours excludeProviders                   */
/* -------------------------------------------------------------------------- */

test('routedChat skips an excluded provider and attributes the answer to the next one', async () => {
  const saved = {};
  for (const [k, v] of Object.entries({ OPENAI_API_KEY: 'sk-test', GEMINI_API_KEY: 'gm-test' })) {
    saved[k] = process.env[k];
    process.env[k] = v;
  }
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    const body = String(url).includes('generativelanguage')
      ? { candidates: [{ content: { parts: [{ text: 'GEMINI_ANSWER' }] } }], usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 3 } }
      : { choices: [{ message: { content: 'OPENAI_ANSWER' } }], usage: { prompt_tokens: 5, completion_tokens: 3 } };
    return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) };
  };
  try {
    const { routedChat, resetProviderHealth } = await import('../../server/aiGateway.js');
    resetProviderHealth();
    const res = await routedChat({
      taskType: 'reasoning',
      preferredProvider: 'openai',
      excludeProviders: ['openai'],
      system: 's',
      user: 'u',
      maxTokens: 20
    });
    assert.equal(res.provider, 'gemini');
    /* 2026-11-09 — the default mode is `max`, whose Gemini ladder leads with
       the Pro seat. What this test guards is the EXCLUSION and attribution,
       not which Gemini id ranks first (the mode contract pins the ladder in
       test/intent-ai/ai-intelligence-mode.test.mjs). */
    assert.match(String(res.model), /^gemini-2\.5-(pro|flash)$/);
    assert.ok(!calls.some((u) => u.includes('api.openai.com')), 'the excluded provider must not be called');
  } finally {
    globalThis.fetch = originalFetch;
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
  }
});
