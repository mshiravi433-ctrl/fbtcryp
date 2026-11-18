/**
 * FBT AI — OPIK TRACES WITHOUT THE SDK
 * -------------------------------------------------------------------------
 * The operator asked for per-turn visibility (Comet/Opik) and chose the
 * DEPENDENCY-FREE route: two POST requests instead of a package whose
 * dependency tree is the size of an application (the official `opik` SDK wants
 * an AI SDK, nunjucks, mustache, node-fetch, chalk, zod as a peer …).
 *
 * That choice moves the risk into the wire format, so this probe pins it:
 *
 *   1. the endpoint, the two headers and the body shape the REST API expects
 *      (`POST {base}/v1/private/traces/batch`, `authorization`,
 *      `Comet-Workspace`, `{ traces: [ … ] }`) — read off the packaged SDK, not
 *      guessed;
 *   2. the three promises in server/opikTrace.js: it never throws, it never
 *      waits for the answer, and it never ships the user's words by default;
 *   3. the failure modes an operator actually hits — no key, a key for another
 *      workspace, a collector that answers 401, a network that dies.
 *
 * Fully offline: `globalThis.fetch` is stubbed, so no key is needed and nothing
 * leaves this process.
 */

import assert from 'node:assert/strict';

import {
  opikConfig,
  opikStatus,
  resetOpikStats,
  buildProviderTrace,
  logProviderCallTrace
} from '../../server/opikTrace.js';

const { beginAiTurnBudget } = await import('../../server/aiGateway.js');

let passed = 0;
let total = 0;
async function atest(name, fn) {
  total += 1;
  try {
    await fn();
    passed += 1;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    console.error(`  ✗ ${name}`);
    console.error(`    ${err.message}`);
    throw err;
  }
}

const KEY = 'opik-test-key-do-not-log';
let calls = [];
function stubFetch(handler) {
  calls = [];
  globalThis.fetch = async (url, opts = {}) => {
    calls.push({ url: String(url), method: opts.method, headers: opts.headers || {}, body: String(opts.body || '') });
    return handler({ url: String(url), opts });
  };
}
const okResponse = () => ({ ok: true, status: 204, text: async () => '' });

const ENV = {
  OPIK_API_KEY: KEY,
  OPIK_WORKSPACE: 'mohammad-shiravi-khouzani',
  OPIK_PROJECT_NAME: 'Fbtswap'
};

/* A representative provider call: one seat answering, with the facts the
   gateway already holds. */
const call = (extra = {}) => ({
  provider: 'groq',
  model: 'qwen/qwen3.8-27b',
  ok: true,
  startedAt: Date.UTC(2026, 10, 18, 9, 0, 0),
  durationMs: 840,
  attemptsOnProvider: 2,
  mode: 'max',
  tokensIn: 120,
  tokensOut: 64,
  questionChars: 41,
  answerChars: 512,
  question: 'قیمت بیت‌کوین چقدر است و با ۵۰۰ دلار چه کنم؟',
  answer: 'پاسخ کامل تحلیل…',
  turnId: 'turn-abc',
  turnCalls: 3,
  ...extra
});

await atest('with no key it is a NO-OP, not an error and not a request', async () => {
  stubFetch(okResponse);
  resetOpikStats();
  assert.equal(opikConfig({}).enabled, false);
  assert.equal(opikConfig({}).hasKey, false);
  const out = await logProviderCallTrace(call(), {});
  assert.equal(out.skipped, 'disabled');
  assert.equal(calls.length, 0, 'nothing may leave the process when tracing is off');
  const status = opikStatus({});
  assert.equal(status.enabled, false);
  assert.match(status.reason, /no OPIK_API_KEY/);
});

await atest('the wire format is the one the REST API expects', async () => {
  stubFetch(okResponse);
  resetOpikStats();
  const out = await logProviderCallTrace(call(), ENV);
  assert.equal(out.ok, true);
  assert.equal(calls.length, 1);
  const [req] = calls;
  assert.equal(req.url, 'https://www.comet.com/opik/api/v1/private/traces/batch');
  assert.equal(req.method, 'POST');
  assert.equal(req.headers.authorization, KEY, 'the SDK sends the raw key, not a Bearer token');
  assert.equal(req.headers['Comet-Workspace'], 'mohammad-shiravi-khouzani');
  assert.equal(req.headers['Content-Type'], 'application/json');

  const body = JSON.parse(req.body);
  assert.ok(Array.isArray(body.traces) && body.traces.length === 1);
  const [trace] = body.traces;
  assert.equal(trace.project_name, 'Fbtswap');
  assert.equal(trace.name, 'ai.provider.groq');
  assert.equal(trace.thread_id, 'turn-abc', 'the turn id groups the six calls of one answer');
  assert.equal(trace.start_time, new Date(call().startedAt).toISOString());
  assert.equal(
    new Date(trace.end_time).getTime() - new Date(trace.start_time).getTime(),
    call().durationMs,
    'end - start is the measured latency'
  );
  assert.ok(trace.tags.includes('groq') && trace.tags.includes('ok'));
  assert.equal(trace.metadata.provider, 'groq');
  assert.equal(trace.metadata.model, 'qwen/qwen3.8-27b');
  assert.equal(trace.metadata.tokensOut, 64);
  assert.equal(trace.metadata.intelligenceMode, 'max');
});

await atest('by default the user’s words do NOT leave the building', async () => {
  stubFetch(okResponse);
  resetOpikStats();
  await logProviderCallTrace(call(), ENV);
  const raw = calls[0].body;
  const body = JSON.parse(raw);
  assert.equal(body.traces[0].input, undefined, 'no prompt without OPIK_CAPTURE_PROMPTS');
  assert.equal(body.traces[0].output, undefined, 'no answer without OPIK_CAPTURE_PROMPTS');
  assert.ok(!raw.includes('بیت‌کوین'), 'the question text must not appear anywhere in the payload');
  assert.ok(!raw.includes('پاسخ کامل'), 'nor the answer');
  /* …but their SIZE is there, which is what the trace is for. */
  assert.equal(body.traces[0].metadata.questionChars, 41);
  assert.equal(body.traces[0].metadata.answerChars, 512);
});

await atest('OPIK_CAPTURE_PROMPTS=1 is what turns content on', async () => {
  stubFetch(okResponse);
  resetOpikStats();
  await logProviderCallTrace(call(), { ...ENV, OPIK_CAPTURE_PROMPTS: '1' });
  const body = JSON.parse(calls[0].body);
  assert.equal(body.traces[0].input.question, call().question);
  assert.equal(body.traces[0].output.answer, call().answer);
});

await atest('a refusal is a trace with error_info, not a silent hole', async () => {
  stubFetch(okResponse);
  resetOpikStats();
  const fatal = call({
    ok: false,
    provider: 'openrouterfree',
    model: 'nvidia/nemotron-3.5-super-vl:free',
    reasonCode: 'DATA_POLICY',
    status: 404,
    error: 'HTTP 404: matching your guardrail restrictions and data policy',
    answerChars: 0
  });
  await logProviderCallTrace(fatal, ENV);
  const [trace] = JSON.parse(calls[0].body).traces;
  assert.equal(trace.name, 'ai.provider.openrouterfree');
  assert.ok(trace.tags.includes('failed'));
  assert.equal(trace.error_info.exception_type, 'DATA_POLICY');
  assert.match(trace.error_info.message, /guardrail/);
  /* The schema requires this field even with no stack to give. */
  assert.equal(trace.error_info.traceback, '');
});

await atest('a 401 from the collector is counted, and the key never leaks into the counter', async () => {
  stubFetch(() => ({ ok: false, status: 401, text: async () => '{"detail":"Invalid API key"}' }));
  resetOpikStats();
  const out = await logProviderCallTrace(call(), ENV);
  assert.equal(out.ok, false);
  assert.equal(out.status, 401);
  const status = opikStatus(ENV);
  assert.equal(status.counters.failed, 1);
  assert.match(status.counters.lastError, /401/);
  assert.ok(!JSON.stringify(status).includes(KEY), 'the status payload must never carry the key');
  assert.ok(!status.counters.lastError.includes(KEY));
});

await atest('a dead network never rejects into the turn', async () => {
  globalThis.fetch = async () => {
    throw new Error('fetch failed: getaddrinfo ENOTFOUND www.comet.com');
  };
  resetOpikStats();
  await assert.doesNotReject(() => logProviderCallTrace(call(), ENV));
  const status = opikStatus(ENV);
  assert.equal(status.counters.failed, 1);
  assert.match(status.counters.lastError, /ENOTFOUND/);
});

await atest('sampling, off-switch and a dirty paste', async () => {
  stubFetch(okResponse);
  resetOpikStats();
  const sampled = await logProviderCallTrace(call(), { ...ENV, OPIK_SAMPLE_RATE: '0' });
  assert.equal(sampled.skipped, 'sampled-out');
  assert.equal(calls.length, 0, 'a sample rate of zero sends nothing');
  assert.equal(opikStatus({ ...ENV, OPIK_SAMPLE_RATE: '0' }).counters.sampledOut, 1);

  const off = await logProviderCallTrace(call(), { ...ENV, OPIK_ENABLED: 'off' });
  assert.equal(off.skipped, 'disabled', 'an explicit off-switch beats a present key');

  /* The dashboard paste: quotes, a newline, a `Bearer ` prefix, zero-widths. */
  const dirty = opikConfig({ ...ENV, OPIK_API_KEY: `  "Bearer ${KEY}"\n\u200b` });
  assert.equal(dirty.apiKey, KEY);
  assert.equal(dirty.enabled, true);
});

await atest('the turn budget carries the id the traces group under', async () => {
  const budget = beginAiTurnBudget();
  assert.match(String(budget.turnId), /^[0-9a-f-]{36}$/, 'a turn id, so six calls become one thread');
  assert.equal(beginAiTurnBudget().turnId === budget.turnId, false, 'each turn is its own thread');
});

await atest('the trace builder is pure — it does not need a network or an env', async () => {
  const trace = buildProviderTrace(
    { provider: 'workersai', model: '@cf/qwen/qwen3.8-27b', ok: true, durationMs: 1199 },
    opikConfig(ENV)
  );
  assert.equal(trace.project_name, 'Fbtswap');
  assert.equal(trace.name, 'ai.provider.workersai');
  assert.ok(trace.id && trace.id.length >= 32);
  assert.equal(trace.error_info, undefined);
});

console.log(`\n=== OPIK TRACE PROBE RESULT: ${passed}/${total} passed ===\n`);
if (passed !== total) process.exit(1);
