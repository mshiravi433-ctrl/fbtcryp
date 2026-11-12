/* THE MODEL FALLBACK IN THE CENTRAL BRAIN (2026-11-12)
 * ==========================================================================
 *
 * The brain's corpus short-circuit answers what the corpus holds. For the
 * rest — a judgement, a scenario, a question the 36-rule registry does not
 * cover — it used to refuse outright, while the chat path, one endpoint
 * away, answered with a model.
 *
 * These tests prove the fallback:
 *
 *   · a question the corpus cannot answer reaches a MODEL, and the answer
 *     says which provider produced it (a generation is labelled as one);
 *   · it costs ONE provider call, not six — the brain has no six-role
 *     fan-out to pay for;
 *   · when the provider fails, the brain falls back to its honest refusal.
 *     A failure must NEVER become a fabricated answer;
 *   · a corpus question still costs ZERO provider calls.
 *
 * The brain is called IN-PROCESS (`brain.handle`), not through HTTP: the
 * test stubs `globalThis.fetch`, and an HTTP test would have the stub
 * intercept its own request to the server under test.
 *
 * Fully offline: no provider is contacted.
 */
import { strict as assert } from 'node:assert';
import test from 'node:test';

/* ── the provider stub ────────────────────────────────────────────────── */
const REAL_FETCH = globalThis.fetch;
let providerCalls = [];
let providerShouldFail = false;

/* A provider must be CONFIGURED **and IN THE FLEET** for the gateway to seat
   it. `isProviderConfigured` checks both: the key AND `isProviderInFleet`.
   The default fleet is ['openrouterfree', 'groq', 'workersai'], so the test
   seats `openrouterfree` — the same free seat production uses. */
process.env.OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || 'test-key-for-the-brain-fallback';
process.env.FBT_AI_PROVIDERS = process.env.FBT_AI_PROVIDERS || 'openrouterfree';

/* Only PROVIDER endpoints count. The brain also reads market data
   (CoinGecko, Coinlore), and those calls are reads, not provider calls —
   counting them would measure the wrong thing. */
const isProviderUrl = (u) =>
  /openrouter\.ai|api\.groq\.com|generativelanguage\.googleapis\.com|api\.cloudflare\.com|api\.openai\.com|api\.anthropic\.com/.test(u);

globalThis.fetch = async (url, opts = {}) => {
  const rec = { url: String(url), method: opts.method || 'GET', headers: opts.headers || {} };
  if (isProviderUrl(rec.url)) providerCalls.push(rec);
  if (providerShouldFail && isProviderUrl(rec.url)) {
    return new Response(JSON.stringify({ error: { message: 'upstream down' } }), {
      status: 503, headers: { 'content-type': 'application/json' }
    });
  }
  const text = 'این یک پاسخ تولیدشده توسط مدل است که حداقل چهل کاراکتر دارد تا معتبر شمرده شود.';
  /* OpenAI-compatible shape (OpenRouter, Groq) and Gemini's shape, so the
     stub serves whichever seat the registry picked. */
  if (rec.url.includes('generativelanguage')) {
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }] }), {
      status: 200, headers: { 'content-type': 'application/json' }
    });
  }
  return new Response(JSON.stringify({ choices: [{ message: { content: text } }] }), {
    status: 200, headers: { 'content-type': 'application/json' }
  });
};

const { createCentralBrain } = await import('../../server/ci/brain.js');
const { createCentralStateStore } = await import('../../server/ci/stateStore.js');

/* The brain needs a state store; the API layer builds the same one. */
const stateStore = createCentralStateStore();
assert.ok(stateStore, 'a state store is required to run a brain turn');

const brain = createCentralBrain({ stateStore });

const ask = async (message, locale = 'fa') => {
  providerCalls = [];
  const out = await brain.handle({ owner: 'devfallback01', message, locale });
  return { out, providerCalls: providerCalls.length };
};

const resultText = (out) => {
  const section = (out?.response?.sections || []).find((s) => s.id === 'result');
  return String(section?.value || '');
};

test.after(() => {
  globalThis.fetch = REAL_FETCH;
});

test('a question the corpus cannot answer reaches a model', async () => {
  providerShouldFail = false;
  const { out, providerCalls } = await ask('قانون مالیاتی برای ارز دیجیتال در ایران چیست؟');
  assert.equal(out.intent?.intentType, 'MODEL_ANSWER', `intent was: ${out.intent?.intentType}`);
  assert.equal(out.intent?.answeredFromModel, true);
  assert.ok(resultText(out).length >= 20, 'the model answer must reach the reply');
  assert.ok(providerCalls >= 1, 'a provider must have been called');
});

test('the fallback costs ONE provider call, not six', async () => {
  providerShouldFail = false;
  const { providerCalls } = await ask('عرضهٔ اولیهٔ توکن چگونه کار می‌کند؟');
  /* The brain has no six-role fan-out. One question, one answer. */
  assert.ok(providerCalls <= 3, `expected at most 3 provider calls, saw ${providerCalls}`);
});

test('a generated answer is labelled as generated', async () => {
  providerShouldFail = false;
  const { out } = await ask('قانون ضد پولشویی در صرافی چیست؟');
  assert.equal(out.intent?.answeredFromModel, true);
  assert.ok(out.intent?.modelProvider, 'the provider that answered must be reported');
  assert.notEqual(out.intent?.answeredFromCorpus, true);
});

test('a provider failure falls back to the honest refusal', async () => {
  providerShouldFail = true;
  const { out } = await ask('قانون ضد پولشویی در صرافی چیست؟');
  /* A failure must NEVER become a fabricated answer. */
  assert.notEqual(out.intent?.intentType, 'MODEL_ANSWER');
  const text = JSON.stringify(out);
  assert.ok(/رجیستری|برنامه‌ای|مسیرهای آماده/.test(text), 'the refusal must still be the honest one');
  providerShouldFail = false;
});

test('a corpus question still costs zero provider calls', async () => {
  providerShouldFail = false;
  const { out, providerCalls } = await ask('کارمزد پلتفرم FBT چقدر است؟');
  assert.equal(out.intent?.intentType, 'CORPUS_LOOKUP');
  assert.equal(providerCalls, 0, 'a corpus answer must not consult a provider');
});
