/**
 * FBT AI GATEWAY — PROVIDER WIRING PROBE
 * ---------------------------------------------------------------------------
 * Regression probe for the reported failure: «ما ۹ تا کلید در ورسل گذاشتیم ولی
 * پروژهٔ هوش مصنوعی به هیچکدام وصل نشده» — nine keys present in the
 * environment, every panel showing «configured», and the assistant still
 * answering from the rule engine.
 *
 * A LIVE self-test against the deployed app (GET /api/v1/ai/gateway/selftest)
 * produced the evidence this probe pins:
 *
 *   openrouter  HEALTHY                      (the only provider that answered)
 *   groq        HTTP 404 model does not exist  → llama-3.3-70b-versatile was
 *                                                shut down for Free/Developer
 *                                                tiers on 2026-08-16
 *   gemini      HTTP 404 model no longer available → gemini-2.0-flash is
 *                                                retired by Google
 *   anthropic   HTTP 400 credit balance too low (+ claude-3-5-sonnet-20241022
 *                                                retired 2025-10-28)
 *   deepseek    HTTP 402 Insufficient Balance
 *   mistral     HTTP 403 tier_not_allowed      → mistral-large-latest is paid
 *   workersai   HTTP 400 code 7000 "No route for that URI" → OUR bug: the
 *                                                model id was URL-encoded, so
 *                                                `@cf/meta/llama-3.1-8b-instruct`
 *                                                became one opaque segment
 *   aimlapi     HTTP 403 out of funds
 *
 * Four code defects made that survivable-looking and unfixable from the
 * outside, and each one gets a check here:
 *
 *   1. `fallbackModels` was declared in the registry and read by NOTHING, so
 *      one stale model id took a whole provider down behind a valid key.
 *   2. Keys were used raw. A dashboard paste carries newlines, wrapping quotes,
 *      a `Bearer ` prefix and zero-width characters — present in the dashboard,
 *      rejected by the provider.
 *   3. Nothing remembered a failure, so every request re-paid for the same
 *      five dead providers before reaching the one that worked.
 *   4. `routedChat` never throws: it quietly answers from the internal rule
 *      engine. `aiSelfTest` read that as success and reported `ok:true`, so the
 *      diagnostic built to answer «چرا وصل نمی‌شود؟» said the AI was fine.
 *
 * Fully offline: `globalThis.fetch` is stubbed per check, so no provider is
 * called and no key is needed.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/* A fully-keyed fleet, with the junk a real dashboard paste carries: wrapping
   quotes, a trailing newline, a `Bearer ` prefix, padded account id. */
const PROVIDER_ENV = {
  OPENROUTER_API_KEY: 'sk-or-test',
  GROQ_API_KEY: '  "gsk-test"\n',
  GEMINI_API_KEY: 'Bearer gem-test',
  ANTHROPIC_API_KEY: 'ant-test',
  DEEPSEEK_API_KEY: 'ds-test',
  MISTRAL_API_KEY: 'mist-test',
  CLOUDFLARE_API_TOKEN: 'cf-test',
  CLOUDFLARE_ACCOUNT_ID: ' 32hexaccountid ',
  AIMLAPI_KEY: 'aiml-test',
  JINA_API_KEY: 'jina-test'
};
const savedEnv = {};
for (const [k, v] of Object.entries(PROVIDER_ENV)) {
  savedEnv[k] = process.env[k];
  process.env[k] = v;
}

const {
  PROVIDER_CONFIGS,
  classifyAiError,
  executeProviderChat,
  getAvailableProviders,
  getFleetSummary,
  getModelCandidates,
  getProviderHealth,
  getProviderKey,
  getProviderKeyInfo,
  isProviderConfigured,
  isRetiredModel,
  normalizeSecretValue,
  orderByHealth,
  recordProviderCall,
  resetProviderHealth,
  routedChat
} = await import('../../server/aiGateway.js');

const ai = await import('../../server/ai.js');

let totalTests = 0;
let passedTests = 0;
async function atest(name, fn) {
  totalTests++;
  try {
    await fn();
    passedTests++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    console.error(`  ✗ ${name}`);
    console.error(`    ${err.message}`);
    throw err;
  }
}

const read = (p) => readFileSync(join(process.cwd(), p), 'utf8');

/** Every request the stub saw, so headers and URLs can be asserted, not guessed. */
let calls = [];
function stubFetch(handler) {
  calls = [];
  globalThis.fetch = async (url, opts = {}) => {
    const rec = {
      url: String(url),
      method: opts.method || 'GET',
      headers: opts.headers || {},
      body: (() => { try { return JSON.parse(opts.body || '{}'); } catch { return {}; } })()
    };
    calls.push(rec);
    const out = await handler(rec, calls.length);
    return new Response(typeof out.body === 'string' ? out.body : JSON.stringify(out.body ?? {}), {
      status: out.status ?? 200,
      headers: { 'content-type': 'application/json' }
    });
  };
}
const okOpenAI = (text = 'ok') => ({ status: 200, body: { choices: [{ message: { content: text } }] } });

/** The right success shape for whichever provider the URL belongs to. */
const okFor = (rec, text = 'ok') => {
  if (rec.url.includes('generativelanguage')) return { status: 200, body: { candidates: [{ content: { parts: [{ text }] } }] } };
  if (rec.url.includes('api.anthropic.com')) return { status: 200, body: { content: [{ type: 'text', text }] } };
  if (rec.url.includes('api.cloudflare.com')) return { status: 200, body: { result: { response: text } } };
  return okOpenAI(text);
};

function restoreEnv() {
  for (const [k, v] of Object.entries(savedEnv)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
}

async function runAll() {
  console.log('\n--- AI Provider Wiring (the nine-keys-but-no-AI fix) ---');

  /* ---------------------------------------------------------------- 1. models */
  await atest('no provider defaults to a model its own vendor has retired', () => {
    /*
     * The single most expensive line in this whole incident: a valid key behind
     * a dead model id. Groq shut llama-3.3-70b-versatile down for Free and
     * Developer tiers on 2026-08-16 and Google shut gemini-2.0-flash off, so
     * two of the fleet's three "fast" seats answered 404 to every request while
     * the dashboard showed both keys as saved.
     */
    for (const [id, cfg] of Object.entries(PROVIDER_CONFIGS)) {
      if (cfg.type === 'internal-engine') continue;
      assert.ok(!isRetiredModel(cfg.defaultModel), `${id} defaults to retired model ${cfg.defaultModel}`);
      for (const m of cfg.fallbackModels || []) {
        assert.ok(!(cfg.retiredModels || []).includes(m), `${id} lists its own retired model ${m} as a fallback`);
      }
      /* The automatic candidate list is what actually reaches the wire. */
      for (const m of getModelCandidates(id)) {
        assert.ok(!(cfg.retiredModels || []).includes(m), `${id} would automatically call retired model ${m}`);
      }
    }
    assert.equal(PROVIDER_CONFIGS.groq.defaultModel, 'openai/gpt-oss-20b');
    assert.equal(PROVIDER_CONFIGS.gemini.defaultModel, 'gemini-2.5-flash');
    assert.equal(PROVIDER_CONFIGS.mistral.defaultModel, 'mistral-small-latest');
    assert.ok(isRetiredModel('llama-3.3-70b-versatile'), 'the retired Groq id must stay on the retired list');
    assert.ok(isRetiredModel('gemini-2.0-flash'), 'the retired Gemini id must stay on the retired list');
    assert.ok(isRetiredModel('claude-3-5-sonnet-20241022'), 'the retired Claude id must stay on the retired list');
  });

  await atest('an explicit model is still tried first — a retired id a paying Enterprise account owns is not our call to refuse', async () => {
    stubFetch((rec) => (rec.body.model === 'llama-3.3-70b-versatile' ? okOpenAI('enterprise') : okOpenAI('other')));
    const res = await executeProviderChat('groq', { system: 's', user: 'u', model: 'llama-3.3-70b-versatile', json: false });
    assert.equal(res.model, 'llama-3.3-70b-versatile');
    assert.equal(res.text, 'enterprise');
  });

  await atest('one stale model id no longer takes the provider down: the walk continues to a current model', async () => {
    /*
     * `fallbackModels` existed in the registry and nothing read it. Now a
     * model-level rejection (404 model_not_found, 403 tier_not_allowed) steps to
     * the next candidate on the SAME key — the key was never the problem.
     */
    stubFetch((rec) => (rec.body.model === 'openai/gpt-oss-20b'
      ? okOpenAI('groq-answered')
      : { status: 404, body: { error: { message: `The model \`${rec.body.model}\` does not exist or you do not have access to it.`, type: 'invalid_request_error', code: 'model_not_found' } } }));
    const res = await executeProviderChat('groq', { system: 's', user: 'u', model: 'llama-3.3-70b-versatile', json: false });
    assert.equal(res.model, 'openai/gpt-oss-20b');
    assert.equal(res.text, 'groq-answered');
    assert.equal(res.attempts.length, 1);
    assert.equal(res.attempts[0].reasonCode, 'MODEL_UNAVAILABLE');
  });

  await atest('a paid model on a free tier falls back to the free model on the same key', async () => {
    /* The live Mistral failure: HTTP 403 "not available in your subscription
       tier" for mistral-large-latest. That is a model problem, not a key
       problem, so the same key is retried with the free-tier id. */
    stubFetch((rec) => (rec.body.model === 'mistral-small-latest'
      ? okOpenAI('mistral-answered')
      : { status: 403, body: { message: 'This model is not available in your subscription tier', type: 'tier_not_allowed', code: '1910' } }));
    const res = await executeProviderChat('mistral', { system: 's', user: 'u', model: 'mistral-large-latest', json: false });
    assert.equal(res.model, 'mistral-small-latest');
    assert.equal(res.attempts[0].reasonCode, 'MODEL_TIER');
  });

  /* ------------------------------------------------------------------ 2. keys */
  await atest('a key pasted with quotes, newlines or a Bearer prefix is normalized before it is sent', async () => {
    assert.equal(normalizeSecretValue('  "gsk-test"\n'), 'gsk-test');
    assert.equal(normalizeSecretValue('Bearer gem-test'), 'gem-test');
    assert.equal(normalizeSecretValue('sk-\u200Bor\u200f-test '), 'sk-or-test');
    assert.equal(getProviderKey('groq'), 'gsk-test');
    assert.equal(getProviderKey('gemini'), 'gem-test');
    /* The operator is told the stored copy is dirty — cleaning it silently
       would leave the same trap for the next tool that reads it raw. */
    assert.equal(getProviderKeyInfo('groq').dirtyInEnv, true);
    assert.equal(getProviderKeyInfo('openrouter').dirtyInEnv, false);

    stubFetch((rec) => (rec.url.includes('generativelanguage')
      ? { status: 200, body: { candidates: [{ content: { parts: [{ text: 'ok' }] } }] } }
      : okOpenAI('ok')));
    await executeProviderChat('groq', { system: 's', user: 'u', json: false });
    assert.equal(calls[0].headers.Authorization, 'Bearer gsk-test');
    await executeProviderChat('gemini', { system: 's', user: 'u', json: false });
    const gem = calls.find((c) => c.url.includes('generativelanguage'));
    assert.equal(gem.headers['x-goog-api-key'], 'gem-test');
    /* The credential must not ride in the query string: it lands in every
       access log and in any error text that quotes the URL. */
    assert.ok(!gem.url.includes('key='), `Gemini key leaked into the URL: ${gem.url}`);
  });

  await atest('a key saved under a near-miss variable name is still found, and the report says which name supplied it', () => {
    process.env.GROQ_KEY = 'gsk-alias';
    delete process.env.GROQ_API_KEY;
    assert.equal(isProviderConfigured('groq'), true);
    assert.equal(getProviderKeyInfo('groq').sourceEnv, 'GROQ_KEY');
    delete process.env.GROQ_KEY;
    process.env.GROQ_API_KEY = PROVIDER_ENV.GROQ_API_KEY;
    assert.equal(getProviderKeyInfo('groq').sourceEnv, 'GROQ_API_KEY');
  });

  await atest('variables that look like AI keys but are not read are reported instead of silently ignored', () => {
    /* Grok/OpenAI/Perplexity were de-registered from the fleet, so setting
       GROK_API_KEY or OPENAI_API_KEY does nothing. An operator who set one
       deserves to be told rather than left debugging a dashboard that shows it
       as saved. */
    assert.ok(ai.IGNORED_AI_ENV_VARS.includes('OPENAI_API_KEY'));
    assert.ok(ai.IGNORED_AI_ENV_VARS.includes('XAI_API_KEY'));
    process.env.OPENAI_API_KEY = 'sk-ignored';
    assert.deepEqual(ai.ignoredAiEnvVarsPresent(), ['OPENAI_API_KEY']);
    delete process.env.OPENAI_API_KEY;
    assert.deepEqual(ai.ignoredAiEnvVarsPresent(), []);
  });

  /* ------------------------------------------------------- 3. Workers AI URL */
  await atest('the Workers AI run URL keeps the model path intact (the code-7000 "No route for that URI" bug)', async () => {
    stubFetch(() => ({ status: 200, body: { result: { response: 'cf-answered' } } }));
    const res = await executeProviderChat('workersai', { system: 's', user: 'u', json: false });
    assert.equal(res.text, 'cf-answered');
    assert.equal(
      calls[0].url,
      'https://api.cloudflare.com/client/v4/accounts/32hexaccountid/ai/run/@cf/meta/llama-3.1-8b-instruct'
    );
    /* The padded account id was trimmed; the model kept its `@` and slashes. */
    assert.ok(!calls[0].url.includes('%40'), 'the model id must not be percent-encoded into one segment');
    assert.ok(!calls[0].url.includes('%2F'), 'the model path must keep its slashes');
  });

  await atest('a malformed Cloudflare account is classified as an account problem, not retried across models', async () => {
    stubFetch(() => ({ status: 400, body: { success: false, errors: [{ code: 7000, message: 'No route for that URI' }], result: null } }));
    await assert.rejects(
      () => executeProviderChat('workersai', { system: 's', user: 'u', json: false }),
      (err) => {
        assert.equal(err.reasonCode, 'CF_ACCOUNT');
        assert.match(err.fix, /CLOUDFLARE_ACCOUNT_ID/);
        return true;
      }
    );
    assert.equal(calls.length, 1, 'a URL/account problem must not burn a call per model');
  });

  /* ------------------------------------------------------- 4. Gemini payload */
  await atest('a Gemini answer split across several parts is joined, not truncated to the first', async () => {
    stubFetch(() => ({ status: 200, body: { candidates: [{ content: { parts: [{ text: '{"bias":' }, { text: '"neutral"}' }] } }] } }));
    const res = await executeProviderChat('gemini', { system: 's', user: 'u', json: true });
    assert.equal(res.text, '{"bias":"neutral"}');
  });

  /* ------------------------------------------------------ 5. Anthropic retry */
  await atest('Claude models that reject sampling parameters are retried without them, not written off', async () => {
    /* Current Claude models run adaptive thinking by default and answer 400
       invalid_request_error when `temperature` is sent at all. */
    stubFetch((rec) => (rec.body.temperature !== undefined
      ? { status: 400, body: { type: 'error', error: { type: 'invalid_request_error', message: '`temperature` is not supported with thinking enabled' } } }
      : { status: 200, body: { content: [{ type: 'text', text: 'claude-answered' }] } }));
    const res = await executeProviderChat('anthropic', { system: 's', user: 'u', temperature: 0.4, json: false });
    assert.equal(res.text, 'claude-answered');
    assert.equal(calls.length, 2);
    assert.equal(calls[1].body.temperature, undefined);
  });

  /* ------------------------------------------------- 6. account-level errors */
  await atest('a billing rejection stops the model walk and parks the provider with the reason and the fix', async () => {
    resetProviderHealth();
    stubFetch(() => ({ status: 402, body: { error: { message: 'Insufficient Balance (request_id: 6729e4ea)', type: 'unknown_error' } } }));
    await assert.rejects(
      () => executeProviderChat('deepseek', { system: 's', user: 'u', json: false }),
      (err) => {
        assert.equal(err.reasonCode, 'BILLING');
        assert.match(err.fix, /credit/i);
        return true;
      }
    );
    assert.equal(calls.length, 1, 'no other model fixes an empty balance');
    const h = getProviderHealth().deepseek;
    assert.equal(h.circuitOpen, true);
    assert.equal(h.lastError.reasonCode, 'BILLING');

    /* Anthropic reports an empty credit balance as HTTP 400 — status alone
       would have filed it as a bad request and retried three models. */
    const cls = classifyAiError(Object.assign(new Error('HTTP 400: {"type":"error","error":{"type":"invalid_request_error","message":"Your credit balance is too low to access the Anthropic API."}}'), { status: 400 }), 'anthropic');
    assert.equal(cls.kind, 'BILLING');
    assert.equal(cls.retryNextModel, false);
  });

  await atest('a rejected key is classified as AUTH and never retried model-by-model', () => {
    const cls = classifyAiError(Object.assign(new Error('HTTP 401: {"error":{"message":"Incorrect API key provided","type":"invalid_request_error","code":"invalid_api_key"}}'), { status: 401 }), 'openrouter');
    assert.equal(cls.kind, 'AUTH');
    assert.equal(cls.retryNextModel, false);
    assert.match(cls.fix, /Regenerate/i);
    const quota = classifyAiError(Object.assign(new Error('HTTP 429: rate limit reached'), { status: 429 }), 'groq');
    assert.equal(quota.kind, 'QUOTA');
  });

  /* ------------------------------------------------------ 7. routing memory */
  await atest('routing is health-aware: the provider that answered leads, the parked ones stop being paid for first', async () => {
    resetProviderHealth();
    /* The live shape of the incident: everything parked for billing/auth except
       OpenRouter, which answered. */
    for (const id of ['workersai', 'groq', 'gemini', 'mistral', 'aimlapi']) {
      recordProviderCall(id, { ok: false, durationMs: 90, model: 'x', error: 'HTTP 403', reasonCode: 'BILLING', fix: 'top up' });
    }
    recordProviderCall('openrouter', { ok: true, durationMs: 900, model: 'openai/gpt-4o-mini' });

    const fastOrder = orderByHealth(['workersai', 'groq', 'gemini', 'mistral', 'aimlapi', 'openrouter']);
    assert.equal(fastOrder[0], 'openrouter', 'the proven provider must lead a `fast` task');

    stubFetch((rec) => (rec.url.includes('openrouter.ai') ? okOpenAI('openrouter-answered') : { status: 403, body: { message: "You've run out of funds" } }));
    const res = await routedChat({ taskType: 'fast', system: 's', user: 'u', json: false });
    assert.equal(res.provider, 'openrouter');
    assert.equal(res.degraded, undefined);
    assert.equal(res.engine, 'external-model');
    assert.equal(calls.length, 1, 'a request must not re-pay for five known-dead providers before the working one');
  });

  await atest('AI_PRIMARY_PROVIDER pins the leading seat without a code change', async () => {
    resetProviderHealth();
    process.env.AI_PRIMARY_PROVIDER = 'gemini';
    stubFetch((rec) => (rec.url.includes('generativelanguage')
      ? { status: 200, body: { candidates: [{ content: { parts: [{ text: 'gemini-answered' }] } }] } }
      : okOpenAI('other')));
    const res = await routedChat({ taskType: 'market', system: 's', user: 'u', json: false });
    assert.equal(res.provider, 'gemini');
    delete process.env.AI_PRIMARY_PROVIDER;
  });

  /* --------------------------------------------------------- 8. degradation */
  await atest('when no external model answers, the reply says so instead of wearing a model’s clothes', async () => {
    resetProviderHealth();
    stubFetch(() => ({ status: 402, body: { error: { message: 'Insufficient Balance' } } }));
    const res = await routedChat({ taskType: 'fast', system: 's', user: 'u', json: false });
    assert.equal(res.degraded, true);
    assert.equal(res.provider, 'internal');
    assert.equal(res.engine, 'internal-rules');
    assert.ok(res.notice?.fa && res.notice?.en, 'a degraded answer must carry a human-readable notice in both languages');
    assert.ok(res.failoverTrail.length >= 1, 'the trail must name who was asked and why each refused');
    assert.ok(res.failoverTrail.every((f) => f.reasonCode && f.fix), 'every trail entry carries a classified reason and a fix');
  });

  await atest('the self-test fails when the fleet is degraded — it used to report ok:true over a rule-engine answer', async () => {
    resetProviderHealth();
    stubFetch(() => ({ status: 402, body: { error: { message: 'Insufficient Balance' } } }));
    const report = await ai.aiSelfTest();
    assert.equal(report.ok, false, 'routedChat never throws, so "it returned" is not "a model answered"');
    assert.equal(report.reason, 'ALL_PROVIDERS_FAILED');
    assert.equal(report.degraded, true);
    assert.equal(report.engine, 'internal-rules');
    assert.ok(Array.isArray(report.failoverTrail) && report.failoverTrail.length >= 1);
  });

  await atest('the self-test passes only when a real model answered, and names the model', async () => {
    resetProviderHealth();
    stubFetch((rec) => okFor(rec, 'ok'));
    const report = await ai.aiSelfTest();
    assert.equal(report.ok, true);
    assert.equal(report.degraded, false);
    assert.notEqual(report.provider, 'internal');
    /* All eight keyed providers are reported, not three. The old report named
       only Groq/Gemini/OpenRouter, so a working Anthropic key looked missing. */
    assert.equal(report.providers.length, 8);
    assert.ok(report.providers.every((p) => 'keyPresent' in p && 'verdict' in p && 'model' in p));
  });

  await atest('/api/ai/ask hands the client the engine that answered', async () => {
    resetProviderHealth();
    stubFetch(() => ({ status: 402, body: { error: { message: 'Insufficient Balance' } } }));
    const out = await ai.answerSupportQuestion({ question: 'what is a swap?', context: [], lang: 'en', web: false });
    assert.equal(out.source, 'internal-rules');
    assert.equal(out.degraded, true);
    assert.ok(out.notice?.en, 'the client prints the notice rather than implying a live model spoke');
    assert.ok(typeof out.answer === 'string' && out.answer.length > 0);
  });

  /* ------------------------------------------------------- 9. fleet reporting */
  await atest('the fleet summary separates "a key exists" from "it can answer"', () => {
    resetProviderHealth();
    recordProviderCall('openrouter', { ok: true, durationMs: 800, model: 'openai/gpt-4o-mini' });
    recordProviderCall('groq', { ok: false, durationMs: 70, model: 'openai/gpt-oss-20b', error: 'HTTP 404', reasonCode: 'MODEL_UNAVAILABLE', fix: 'retired id' });
    const summary = getFleetSummary();
    assert.equal(summary.configured, 8, 'eight external keys are present');
    assert.equal(summary.healthy, 1, '…and exactly one of them answered');
    assert.equal(summary.failing, 1);
    assert.deepEqual(summary.healthyIds, ['openrouter']);
    assert.equal(summary.failingIds[0].reason, 'MODEL_UNAVAILABLE');

    const rows = getAvailableProviders();
    const groq = rows.find((r) => r.id === 'groq');
    assert.equal(groq.status, 'ACTIVE', 'the ACTIVE contract is unchanged: a key is present');
    assert.equal(groq.verdict, 'ERROR:MODEL_UNAVAILABLE', '…and the verdict says it cannot answer');
    assert.ok(groq.modelCandidates.length >= 2, 'the panel can show what would be tried next');
  });

  await atest('a failed last call is a verdict, not "untested" (circuit closed)', () => {
    /*
     * One NETWORK failure does not open the circuit — it may heal in seconds —
     * and before this check existed the fleet reported exactly that provider as
     * UNTESTED / AVAILABLE. The live symptom: after a round in which all eight
     * keyed providers had just refused, `/api/v1/ai/gateway/health` said
     * «8 untested, 0 failing» and every card read «هنوز آزموده نشده». The
     * verdict has to follow the evidence, not the breaker.
     */
    resetProviderHealth();
    recordProviderCall('gemini', { ok: false, durationMs: 120, model: 'gemini-2.5-flash', error: 'fetch failed', reasonCode: 'NETWORK', fix: 'egress blocked' });
    const h = getProviderHealth().gemini;
    assert.equal(h.circuitOpen, false, 'a single transient failure must not park the provider');
    assert.equal(h.failedLastCall, true, '…but the store must say its last call failed');
    assert.equal(h.availability, 'DEGRADED');

    const row = getAvailableProviders().find((r) => r.id === 'gemini');
    assert.equal(row.verdict, 'ERROR:NETWORK', 'the panel says it did not answer, with the reason');
    const summary = getFleetSummary();
    assert.equal(summary.failing, 1);
    assert.equal(summary.untested, 7, 'the other seven were never called');
    assert.equal(summary.healthy, 0);
    assert.equal(summary.failingIds[0].reason, 'NETWORK');

    /* And a later success clears it: the verdict is about the LAST call. */
    recordProviderCall('gemini', { ok: true, durationMs: 700, model: 'gemini-2.5-flash' });
    assert.equal(getAvailableProviders().find((r) => r.id === 'gemini').verdict, 'HEALTHY');
    assert.equal(getProviderHealth().gemini.availability, 'AVAILABLE');
    assert.equal(getFleetSummary().failing, 0);
    resetProviderHealth();
  });

  await atest('health is ONE store — the collaboration ladder reads the gateway’s', async () => {
    /*
     * server/aiCollaboration.js kept its own healthState Map for months. Two
     * stores meant two opinions about the same provider: the ladder could park
     * groq while routedChat — the path /api/ai/ask actually takes — kept paying
     * for its failures, and the health endpoint published a circuit the ladder
     * had never heard of. The module now re-exports the gateway's functions.
     */
    const collab = await import('../../server/aiCollaboration.js');
    resetProviderHealth();
    recordProviderCall('deepseek', { ok: false, durationMs: 40, error: 'HTTP 402', reasonCode: 'BILLING', fix: 'top up the account' });

    assert.equal(collab.isProviderHealthy('deepseek'), false, 'the ladder skips what the gateway parked');
    assert.equal(collab.getProviderHealth().deepseek?.lastError?.reasonCode, 'BILLING',
      '…and reports the same classified reason the health endpoint does');
    assert.equal(collab.recordProviderCall, recordProviderCall, 'same function, not a copy');

    collab.resetProviderHealth();
    assert.deepEqual(getProviderHealth(), {}, 'one reset clears the truth for both callers');
  });

  /* ------------------------------------------- 10. no stale ids anywhere else */
  await atest('no other module pins a retired model id behind the gateway’s back', () => {
    /*
     * The gateway is the only place a model id may live. Two modules had their
     * own copies and both were stale: the consensus debate pinned Groq seats to
     * llama-3.3-70b-versatile / mixtral-8x7b-32768, and the packaged app's
     * direct-Gemini client pinned gemini-2.0-flash — so the APK's AI was dead
     * too, independently of the server.
     */
    const retired = ['llama-3.3-70b-versatile', 'gemini-2.0-flash', 'claude-3-5-sonnet-20241022', 'mixtral-8x7b-32768', 'gemma2-9b-it', 'gemini-1.5-pro', 'gemini-1.5-flash'];

    const consensus = read('server/aiConsensus.js').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
    for (const id of retired) {
      assert.ok(!consensus.includes(`'${id}'`), `server/aiConsensus.js still pins retired model ${id}`);
    }
    assert.match(consensus, /model: null/, 'debate seats must use the provider’s current default');

    const direct = read('src/lib/geminiDirect.js').replace(/\/\*[\s\S]*?\*\//g, '');
    assert.ok(!/VITE_GEMINI_MODEL'\)\s*\|\|\s*'gemini-2\.0-flash'/.test(direct), 'the direct client must not default to a shut-down model');
    assert.match(direct, /MODEL_CANDIDATES/, 'the direct client walks a candidate list');
    assert.match(direct, /modelError/, 'the direct client distinguishes a dead model from a dead key');
    assert.match(direct, /x-goog-api-key/, 'the direct client sends the key in a header');

    const aiModule = read('server/ai.js').replace(/\/\*[\s\S]*?\*\//g, '');
    assert.ok(!aiModule.includes("'gemini-2.0-flash'"), 'server/ai.js must not carry its own stale model constant');
    assert.ok(!/const GROQ_MODEL =/.test(aiModule), 'server/ai.js must not duplicate the gateway’s model defaults');
  });

  /* --------------------------------------------------- 11. route-level wiring */
  await atest('the HTTP routes publish the verdict, not only the presence', () => {
    const app = read('server/app.js');
    const statusRoute = /app\.get\('\/api\/ai\/status'[\s\S]*?\n\}\);/.exec(app)?.[0] ?? '';
    assert.match(statusRoute, /getFleetSummary\(\)/, '/api/ai/status must report how many providers can actually answer');
    assert.match(statusRoute, /aiProvider\(\)/, '/api/ai/status must name the seat that answers first');

    const diagnose = /app\.get\('\/api\/ai\/diagnose'[\s\S]*?\n\}\);/.exec(app)?.[0] ?? '';
    assert.match(diagnose, /getAvailableProviders\(\)/, 'the public diagnostic must list every provider');
    assert.match(diagnose, /ignoredAiEnvVarsPresent\(\)/, '…and the key names this build does not read');
    assert.match(diagnose, /req\.query\.key/, 'the advertised ?key= entry must still be read');

    /* A rule-engine brief must not be pinned for six hours: the providers
       recover and the app would keep serving the fallback. */
    assert.match(app, /AI_DEGRADED_TTL/, 'degraded AI output gets its own, short, cache TTL');
    assert.match(app, /ttlForValue: aiTtlFor/, 'the brief and outlook routes must use it');
    assert.equal((app.match(/x-ai-engine/g) || []).length >= 3, true, 'ask, brief and outlook all name the engine on the wire');

    const routes = read('server/aiIntentOS.js');
    assert.match(routes, /router\.get\('\/gateway\/health'/, 'a free health read must exist so a panel can poll without spending tokens');
    assert.match(routes, /summary: getFleetSummary\(\)/, '/gateway/providers must carry the fleet summary');
  });

  resetProviderHealth();
  console.log(`\n=== AI PROVIDER WIRING PROBE RESULT: ${passedTests}/${totalTests} passed ===\n`);
}

runAll()
  .then(() => {
    restoreEnv();
    if (passedTests !== totalTests) process.exit(1);
    process.exit(0);
  })
  .catch((err) => {
    restoreEnv();
    console.error(`\nAI PROVIDER WIRING PROBE FAILED: ${err.message}\n`);
    process.exit(1);
  });
