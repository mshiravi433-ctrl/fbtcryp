import assert from 'node:assert/strict';
import test from 'node:test';
import http from 'node:http';

const ENV_KEYS = [
  'NODE_ENV', 'RATE_LIMIT', 'FBT_AI_PROVIDERS', 'FBT_AI_INTELLIGENCE', 'AI_ORCHESTRATOR',
  'OPENROUTER_API_KEY', 'OPENROUTER_KEY', 'OPEN_ROUTER_API_KEY',
  'OPENAI_API_KEY', 'OPENAI_KEY', 'XAI_API_KEY', 'GROK_API_KEY', 'XAI_KEY',
  'GROQ_API_KEY', 'GROQ_KEY', 'GEMINI_API_KEY', 'GOOGLE_AI_API_KEY', 'GOOGLE_API_KEY',
  'GEMINI_KEY', 'VITE_GEMINI_API_KEY', 'ANTHROPIC_API_KEY', 'CLAUDE_API_KEY',
  'DEEPSEEK_API_KEY', 'DEEPSEEK_KEY', 'MISTRAL_API_KEY', 'MISTRAL_KEY',
  'CLOUDFLARE_API_TOKEN', 'CF_API_TOKEN', 'CLOUDFLARE_AI_TOKEN', 'AIMLAPI_KEY', 'AIMLAPI_API_KEY'
];
const savedEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
const originalFetch = globalThis.fetch;
process.env.NODE_ENV = 'test';
process.env.RATE_LIMIT = '100000';
process.env.FBT_AI_PROVIDERS = 'internal';
process.env.AI_ORCHESTRATOR = '0';
for (const key of ENV_KEYS) {
  if (!['NODE_ENV', 'RATE_LIMIT', 'FBT_AI_PROVIDERS', 'AI_ORCHESTRATOR'].includes(key)) delete process.env[key];
}
/* Make every optional market/provider read fail fast and deterministically. */
globalThis.fetch = async () => { throw new Error('NETWORK_DISABLED_BY_TEST'); };
let app = null;
let importError = null;
try {
  app = (await import('../../server/app.js')).default;
} catch (error) {
  if (error?.code !== 'ERR_MODULE_NOT_FOUND') throw error;
  importError = error;
}

let server = null;
let base = '';
if (app) {
  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
}
const skipRuntime = app ? false : `HTTP runtime dependencies are not installed: ${importError?.message || 'server/app.js unavailable'}`;
async function request(path, body) {
  const res = await originalFetch(`${base}${path}`, body == null ? {} : {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-fbt-device': 'auto-evidence-probe01' },
    body: JSON.stringify(body)
  });
  return { status: res.status, json: await res.json() };
}

test('bare social greeting and model outage use the conversational path', { skip: skipRuntime }, async () => {
  const casual = await request('/api/v1/ai/chat', { message: 'چخبرا؟', locale: 'fa' });
  assert.equal(casual.status, 200);
  assert.match(casual.json.reply.text, /تو چه خبر/);
  assert.equal(casual.json.reply.executed, false);
  for (const message of ['چطوری با دوستم آشتی کنم؟', 'احمق']) {
    const reply = await request('/api/v1/ai/chat', { message, locale: 'fa' });
    assert.equal(reply.status, 503);
    assert.equal(reply.json.error, 'AI_UNAVAILABLE');
  }
});

test('the diagnostic endpoint reports Auto until a request supplies a message', { skip: skipRuntime }, async () => {
  const auto = await request('/api/v1/ai/intelligence');
  assert.equal(auto.status, 200);
  assert.equal(auto.json.mode, 'auto');
  assert.equal(auto.json.defaultMode, 'auto');
  assert.equal(auto.json.selection, 'per-question');
  assert.equal(auto.json.budget.mode, 'auto');
  assert.equal(auto.json.budget.deadlineMs, null);
  assert.ok(auto.json.authority.canExecute === false && auto.json.authority.canSign === false);

  const preview = await request('/api/v1/ai/intelligence?mode=swift');
  assert.equal(preview.status, 200);
  assert.equal(preview.json.mode, 'swift');
  assert.equal(preview.json.selection, 'preview');
  assert.ok(preview.json.budget.deadlineMs > 0);
});

test('a live market question with no evidence or provider abstains explicitly', { skip: skipRuntime }, async () => {
  const result = await request('/api/v1/ai/chat', { message: 'قیمت بیت‌کوین الان چنده؟', locale: 'fa' });
  assert.equal(result.status, 200);
  assert.equal(result.json.ok, true);
  const reply = result.json.reply;
  assert.equal(reply.evidence.required, true);
  assert.equal(reply.evidence.available, false);
  assert.equal(reply.evidence.fallbackApplied, true);
  assert.equal(reply.evidence.liveProviderAnswered, false);
  assert.match(reply.text, /منبع زندهٔ تأییدشده‌ای ندارم/);
  assert.match(reply.text, /قیمت.*را حدس نمی‌زنم/);
  assert.match(reply.text, /هیچ ارائه‌دهندهٔ مدل زنده‌ای در این نوبت پاسخ نداد/);
  assert.doesNotMatch(reply.text, /(?:\$|USD|BTC\s*[:=])\s*\d/,
    'no fabricated price may survive the no-evidence path');
  assert.equal(reply.executed, false);
  assert.equal(reply.broadcasts, false);
  assert.equal(reply.intelligence.mode.id, 'max', 'live research gets the deep Auto tier');
  assert.equal(reply.intelligence.mode.source, 'auto');
  assert.equal(reply.intelligence.mode.autoTier.reason, 'RESEARCH_TURN');
});

test('an incomplete buy asks for the missing amount once and cannot execute', { skip: skipRuntime }, async () => {
  const result = await request('/api/v1/ai/chat', { message: 'بیت‌کوین بخر', locale: 'fa' });
  assert.equal(result.status, 200);
  const reply = result.json.reply;
  assert.equal(reply.executed, false);
  assert.equal(reply.broadcasts, false);
  assert.equal(reply.requiresUserSignature, false);
  assert.notEqual(reply.ui?.type, 'ACTION_CARD');
  /* The partial read is published at the envelope root on EVERY reply path:
     the early-return paths (rich objective, conditional, Smart Money) go
     through `chatIntelligenceEnvelope`, and the ordinary path now publishes the
     same flat field instead of burying it inside `mode`. Both copies must
     describe the same read — a turn cannot have understood two different
     things depending on which code answered it. */
  assert.equal(reply.intelligence.partial.questionBudget, 1);
  assert.equal(reply.intelligence.partial.completeness, 'truncated');
  assert.deepEqual(reply.intelligence.partial.missing, ['amount']);
  assert.equal(reply.intelligence.partial.amount, null,
    'the amount is missing, so none may be invented');
  assert.deepEqual(reply.intelligence.partial, reply.intelligence.mode.partial,
    'the flat partial read and the deep mode.partial must be the same reading');
  assert.equal(reply.intelligence.deepThink.enabled, true,
    'deep thinking is on by default and an incomplete message is never answered shallowly');
  assert.match(reply.text, /مبلغ/);
  assert.doesNotMatch(reply.text, /(?:\$|USD|دلار|تومان)\s*\d/,
    'the missing amount is asked for, never invented as a number');
  assert.equal((reply.text.match(/چه مبلغی در ذهن داری/g) || []).length, 1,
    'exactly one amount clarification is allowed');
  /* A wallet-connection clarification makes no factual claim, so it must NOT be
     wrapped in the no-evidence limitation paragraph: the gate exists to stop
     invented prices, not to preface a question with an unrelated disclaimer.
     What it must never do is claim grounding it does not have. */
  assert.equal(reply.intelligence.mode.id, 'max', 'the money-moving turn got the deep tier');
  assert.equal(reply.evidence.required, false, 'a clarification is not a factual answer');
  assert.equal(reply.evidence.available, false);
  assert.equal(reply.evidence.liveProviderAnswered, false);
  assert.equal(reply.evidence.fallbackApplied, false,
    'the clarification is not dressed in a limitation it does not need');
});

test.after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  globalThis.fetch = originalFetch;
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
});
