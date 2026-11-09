/**
 * «هوش مصنوعی را باهوش‌ترین حالت کن» — contract tests
 * ---------------------------------------------------------------------------
 * The switch is only real if these seven properties hold. Each one below is a
 * failure mode that would otherwise ship as a label with no behaviour behind
 * it:
 *
 *   1. the DEFAULT is max, and every spelling (id, alias, Persian) resolves;
 *   2. an unknown value is REPORTED, not obeyed — a typo cannot downgrade the
 *      assistant silently;
 *   3. `max` puts a flagship model id on the wire FIRST, while every historical
 *      candidate stays behind it (a stale flagship is one round-trip, not an
 *      outage);
 *   4. a retired id is still refused as an AUTOMATIC choice and still honoured
 *      when a caller explicitly asks for it (the pre-existing contract);
 *   5. reasoning parameters are attached only where the vendor documents them;
 *   6. `max` raises collaboration depth for substantive turns and NEVER for
 *      small talk;
 *   7. `balanced` reproduces the old request body exactly.
 *
 * Fully offline: fetch is stubbed, no key is needed and no provider is called.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  INTELLIGENCE_MODES,
  resolveIntelligenceMode,
  normalizeIntelligenceMode,
  getIntelligenceProfile,
  intelligenceModelLadder,
  intelligenceProviderOrder,
  intelligenceGeneration,
  intelligenceReasoningFields,
  intelligenceGeminiThinking,
  intelligenceAnthropicThinking,
  intelligenceCollaborationLevel,
  describeIntelligence
} from '../../server/aiIntelligence.js';
import {
  PROVIDER_CONFIGS,
  getModelCandidates,
  getPreferredProvidersForTask,
  executeProviderChat,
  routedChat,
  isRetiredModel,
  resetProviderHealth
} from '../../server/aiGateway.js';
import { planCollaboration } from '../../src/lib/intent-ai/os/collaborationRouter.js';
import {
  INTELLIGENCE_MODES as CLIENT_MODES,
  DEFAULT_INTELLIGENCE_MODE,
  normalizeIntelligenceMode as normalizeClientMode,
  getIntelligenceMode as getClientMode,
  intelligenceModeLabel
} from '../../src/lib/aiIntelligenceMode.js';

/* ── 1. resolution ───────────────────────────────────────────────────────── */

test('default is the smartest mode, in every spelling a caller may send', () => {
  assert.equal(resolveIntelligenceMode(null, { env: {} }).mode, 'max');
  assert.equal(resolveIntelligenceMode(undefined, { env: {} }).source, 'default');
  assert.equal(resolveIntelligenceMode('max', { env: {} }).mode, 'max');
  assert.equal(resolveIntelligenceMode('smartest', { env: {} }).mode, 'max');
  assert.equal(resolveIntelligenceMode('باهوش‌ترین', { env: {} }).mode, 'max');
  assert.equal(resolveIntelligenceMode('سریع', { env: {} }).mode, 'swift');
  assert.equal(resolveIntelligenceMode('balanced', { env: {} }).mode, 'balanced');
});

test('the deployment default is overridable without a code change, and a request wins over it', () => {
  assert.equal(resolveIntelligenceMode(null, { env: { FBT_AI_INTELLIGENCE: 'balanced' } }).mode, 'balanced');
  assert.equal(resolveIntelligenceMode(null, { env: { FBT_AI_INTELLIGENCE: 'swift' } }).source, 'env');
  const chosen = resolveIntelligenceMode('max', { env: { FBT_AI_INTELLIGENCE: 'swift' } });
  assert.equal(chosen.mode, 'max');
  assert.equal(chosen.source, 'request');
  assert.equal(chosen.rejected, 'ENV_OVERRIDDEN');
});

test('an unknown mode is reported and never obeyed', () => {
  const out = resolveIntelligenceMode('ultra-mega', { env: {} });
  assert.equal(out.mode, 'max');
  assert.equal(out.rejected, 'UNKNOWN_MODE');
  assert.equal(out.requested, 'ultra-mega');
  assert.equal(normalizeIntelligenceMode('nonsense'), null);
});

test('all three modes are described with a fa/en label and an explicit authority boundary', () => {
  const d = describeIntelligence({ env: {} });
  assert.equal(d.mode, 'max');
  assert.equal(d.modes.length, 3);
  assert.ok(d.modes.every((m) => m.label.fa && m.label.en && m.description.fa));
  assert.deepEqual(d.authority, { canExecute: false, canSign: false, canMoveFunds: false });
  assert.ok(Object.values(INTELLIGENCE_MODES).every((m) => m.id && m.label.fa));
});

/* ── 2. generation ───────────────────────────────────────────────────────── */

test('max gives a long answer room while never shrinking an explicit budget', () => {
  const g = intelligenceGeneration('max', { maxTokens: 800, temperature: 0.3 });
  assert.equal(g.maxTokens, 1280);
  assert.ok(g.temperature < 0.3, 'max should be slightly more deterministic');
  assert.equal(g.reasoning, true);
  assert.equal(intelligenceGeneration('max', { maxTokens: 5000 }).maxTokens, 3200, 'budget is capped');
  assert.equal(intelligenceGeneration('max', { maxTokens: 100 }).maxTokens, 1200, 'floor applies');
});

test('swift caps the budget, balanced is the historical 1:1 behaviour', () => {
  assert.equal(intelligenceGeneration('swift', { maxTokens: 2000 }).maxTokens, 1200);
  assert.equal(intelligenceGeneration('swift', { maxTokens: 400 }).maxTokens, 320);
  const b = intelligenceGeneration('balanced', { maxTokens: 800, temperature: 0.42 });
  assert.deepEqual(b, { mode: 'balanced', temperature: 0.42, maxTokens: 800, reasoning: false });
});

test('a latency-bound classification is never turned into an essay', () => {
  const g = intelligenceGeneration('max', { maxTokens: 300, taskType: 'intent' });
  assert.equal(g.maxTokens, 300);
  assert.equal(g.reasoning, false);
});

/* ── 3. model ladders ────────────────────────────────────────────────────── */

test('max puts a flagship id first for every provider that has one', () => {
  for (const [id, cfg] of Object.entries(PROVIDER_CONFIGS)) {
    if (cfg.type === 'internal-engine') continue;
    const ladder = intelligenceModelLadder(id, 'max');
    if (!ladder.length) continue;
    const candidates = getModelCandidates(id, null, { mode: 'max' });
    assert.equal(candidates[0], ladder[0], `${id} must try ${ladder[0]} first in max mode`);
    /* The historical default is still reachable behind the flagships. */
    assert.ok(candidates.includes(cfg.defaultModel), `${id} dropped its own default in max mode`);
  }
});

test('balanced keeps the exact pre-existing model order', () => {
  for (const [id, cfg] of Object.entries(PROVIDER_CONFIGS)) {
    if (cfg.type === 'internal-engine') continue;
    const historical = getModelCandidates(id);
    const balanced = getModelCandidates(id, null, { mode: 'balanced' });
    assert.deepEqual(balanced, historical, `${id} changed order under balanced`);
    assert.equal(getModelCandidates(id, null, { mode: 'swift' })[0], historical[0]);
  }
});

test('an explicit model still wins, even a retired one; automatic choices never pick a retired id', () => {
  assert.equal(getModelCandidates('groq', 'llama-3.3-70b-versatile', { mode: 'max' })[0], 'llama-3.3-70b-versatile');
  for (const id of Object.keys(PROVIDER_CONFIGS)) {
    for (const m of getModelCandidates(id, null, { mode: 'max' })) {
      assert.ok(!isRetiredModel(m), `${id} would automatically call retired model ${m}`);
    }
  }
});

test('the flagship ladder names real ids the registry already knows', () => {
  const known = new Set();
  for (const cfg of Object.values(PROVIDER_CONFIGS)) {
    known.add(cfg.defaultModel);
    for (const m of cfg.fallbackModels || []) known.add(m);
    for (const m of cfg.retiredModels || []) known.add(m);
  }
  for (const [id, ladder] of Object.entries(INTELLIGENCE_MODES.max.modelLadders)) {
    assert.ok(Boolean(PROVIDER_CONFIGS[id]), `ladder names unregistered provider ${id}`);
    for (const m of ladder) {
      assert.ok(known.has(m), `ladder for ${id} invents model id ${m} that the registry never mentions`);
      assert.ok(!isRetiredModel(m), `ladder for ${id} uses retired id ${m}`);
    }
  }
});

/* ── 4. provider order ───────────────────────────────────────────────────── */

test('max orders substantive tasks toward reasoning seats; historical order is untouched', () => {
  assert.equal(getPreferredProvidersForTask('general')[0], 'openrouter', 'the historical order must not move');
  assert.equal(getPreferredProvidersForTask('general', { intelligence: 'max' })[0], 'openai');
  assert.equal(getPreferredProvidersForTask('market', { intelligence: 'max' })[0], 'xai');
  assert.equal(getPreferredProvidersForTask('risk', { intelligence: 'max' })[0], 'anthropic');
  /* A latency-bound job is exempt even in the smartest mode. */
  assert.equal(intelligenceProviderOrder('fast', 'max'), null);
  assert.equal(intelligenceProviderOrder('general', 'balanced'), null);
});

/* ── 5. reasoning knobs ──────────────────────────────────────────────────── */

test('reasoning parameters are attached only where the vendor documents them', () => {
  assert.deepEqual(intelligenceReasoningFields('openai', 'max', 'gpt-4.1'), {});
  assert.deepEqual(intelligenceReasoningFields('openai', 'max', 'o3'), { reasoning_effort: 'high' });
  assert.deepEqual(intelligenceReasoningFields('openrouter', 'max', 'anthropic/claude-sonnet-4-6'), {});
  assert.deepEqual(intelligenceReasoningFields('openrouter', 'max', 'deepseek/deepseek-r1'), { reasoning: { effort: 'high' } });
  assert.deepEqual(intelligenceReasoningFields('groq', 'max', 'openai/gpt-oss-120b'), { reasoning_effort: 'high' });
  assert.deepEqual(intelligenceReasoningFields('mistral', 'max', 'mistral-large-latest'), {});
  assert.deepEqual(intelligenceReasoningFields('openai', 'balanced', 'o3'), {}, 'balanced never adds knobs');
});

test('gemini thinking is a 2.5-family knob only', () => {
  assert.deepEqual(intelligenceGeminiThinking('max', 'gemini-2.5-flash'), {
    thinkingConfig: { includeThoughts: false, thinkingBudget: 4096 }
  });
  assert.deepEqual(intelligenceGeminiThinking('max', 'gemini-2.5-pro'), {
    thinkingConfig: { includeThoughts: false, thinkingBudget: -1 }
  });
  assert.deepEqual(intelligenceGeminiThinking('max', 'gemini-flash-latest'), {});
  assert.deepEqual(intelligenceGeminiThinking('balanced', 'gemini-2.5-pro'), {});
});

test('anthropic thinking always leaves room for the answer and can be switched off', () => {
  const t = intelligenceAnthropicThinking('max', 'claude-sonnet-4-6', 800, { env: {} });
  assert.equal(t.thinking.type, 'enabled');
  assert.ok(t.thinking.budget_tokens < t.maxTokens, 'budget_tokens must be smaller than max_tokens');
  assert.equal(t.omitTemperature, true);
  assert.equal(intelligenceAnthropicThinking('max', 'claude-sonnet-4-6', 800, { env: { FBT_AI_EXTENDED_THINKING: '0' } }), null);
  assert.equal(intelligenceAnthropicThinking('max', 'claude-3-5-haiku-latest', 800, { env: {} }), null);
  assert.equal(intelligenceAnthropicThinking('balanced', 'claude-sonnet-4-6', 800, { env: {} }), null);
});

/* ── 6. collaboration depth ──────────────────────────────────────────────── */

test('max raises a substantive turn to level 4 and protects small talk', () => {
  assert.equal(intelligenceCollaborationLevel('max', 2, { conversationKind: 'GENERAL' }), 4);
  assert.equal(intelligenceCollaborationLevel('max', 1, { conversationKind: 'WHATS_UP' }), 1);
  assert.equal(intelligenceCollaborationLevel('max', 5, { conversationKind: 'HIGH_STAKES' }), 5);
  assert.equal(intelligenceCollaborationLevel('max', 2, { conversationKind: 'GREETING' }), 2);
  assert.equal(intelligenceCollaborationLevel('max', 2, { conversationKind: 'CASUAL' }), 2);
  assert.equal(intelligenceCollaborationLevel('balanced', 2, { conversationKind: 'GENERAL' }), 2);
  assert.equal(intelligenceCollaborationLevel('swift', 4, { conversationKind: 'GENERAL' }), 2);
});

test('a smart plan adds the verifier and reasoning task the raised level claims', () => {
  const base = planCollaboration({ message: 'قیمت بیت‌کوین چنده؟', intentType: 'MARKET_ANALYSIS' });
  const smart = planCollaboration({
    message: 'قیمت بیت‌کوین چنده؟',
    intentType: 'MARKET_ANALYSIS',
    intelligence: 'max',
    intelligenceFloor: 4,
    intelligenceCeiling: 5
  });
  assert.ok(smart.level >= 4);
  assert.ok(smart.level > base.level);
  assert.ok(smart.taskTypes.includes('verification'));
  assert.ok(smart.roles.includes('verification-ai') || smart.roles.some((r) => /VERIFICATION/i.test(String(r))));
  assert.equal(smart.intelligence.mode, 'max');
  assert.equal(smart.intelligence.raised, true);
});

test('the data-computed brief («چخبر») is not turned into a fleet run either', () => {
  const base = planCollaboration({ message: 'چخبر؟' });
  const smart = planCollaboration({
    message: 'چخبر؟',
    intelligence: 'max',
    intelligenceFloor: 4,
    intelligenceCeiling: 5
  });
  assert.equal(smart.level, base.level);
  assert.equal(smart.intelligence.raised, false);
});

test('the smartest mode never turns a greeting into a fleet run', () => {
  const hi = planCollaboration({
    message: 'سلام',
    intelligence: 'max',
    intelligenceFloor: 4,
    intelligenceCeiling: 5
  });
  assert.ok(hi.level <= 2, `a greeting must stay small, got level ${hi.level}`);
  assert.equal(hi.intelligence.smallTalkProtected, true);
  assert.equal(hi.intelligence.raised, false);
});

test('a plan built with no mode is byte-identical to the historical plan', () => {
  const a = planCollaboration({ message: 'چطور بازار است؟', intentType: 'MARKET_ANALYSIS' });
  const b = planCollaboration({ message: 'چطور بازار است؟', intentType: 'MARKET_ANALYSIS', intelligence: null, intelligenceFloor: 0, intelligenceCeiling: 5 });
  assert.equal(a.level, b.level);
  assert.deepEqual(a.taskTypes, b.taskTypes);
  assert.deepEqual(a.roles, b.roles);
});

/* ── 7. the wire: stubbed provider calls ─────────────────────────────────── */

/* These tests exercise the ladder mechanics for EVERY registered provider, so
   the deployment fleet only has three seats is deliberately lifted here. The
   fleet restriction itself is tested in ai-provider-fleet.test.mjs. */
process.env.FBT_AI_PROVIDERS = 'all';

const ENV_KEYS = {
  OPENROUTER_API_KEY: 'sk-or-test',
  OPENAI_API_KEY: 'sk-oa-test',
  ANTHROPIC_API_KEY: 'ant-test',
  GEMINI_API_KEY: 'gem-test',
  GROQ_API_KEY: 'gsk-test',
  DEEPSEEK_API_KEY: 'ds-test',
  XAI_API_KEY: 'xai-test',
  MISTRAL_API_KEY: 'mist-test',
  CLAIMLAPI_KEY: undefined
};

function withKeys() {
  for (const [k, v] of Object.entries(ENV_KEYS)) {
    if (v) process.env[k] = v;
  }
}

function stubFetch(handler) {
  const calls = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    const body = init.body ? JSON.parse(String(init.body)) : {};
    const rec = { url: String(url), body, headers: init.headers || {} };
    calls.push(rec);
    const out = handler(rec);
    const status = out?.status || 200;
    return {
      ok: status >= 200 && status < 300,
      status,
      text: async () => JSON.stringify(out?.body ?? {}),
      json: async () => out?.body ?? {}
    };
  };
  return { calls, restore: () => { globalThis.fetch = original; } };
}

function okOpenAI(text) {
  return { status: 200, body: { choices: [{ message: { content: text } }], usage: { prompt_tokens: 10, completion_tokens: 5 } } };
}

function okGemini(text) {
  return { status: 200, body: { candidates: [{ content: { parts: [{ text }] } }], usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5 } } };
}

test('the wire really carries the flagship model and the max budget', async () => {
  withKeys();
  resetProviderHealth();
  const stub = stubFetch((rec) => (rec.url.includes('openai.com') ? okOpenAI('smart answer') : okOpenAI('other')));
  try {
    const res = await routedChat({
      taskType: 'reasoning',
      system: 's',
      user: 'u',
      maxTokens: 800,
      preferredProvider: 'openai'
    });
    assert.equal(res.provider, 'openai');
    assert.equal(res.model, 'gpt-4.1');
    assert.equal(res.intelligence.mode, 'max');
    const body = stub.calls[0].body;
    assert.equal(body.max_tokens, 1280, 'the max budget must reach the provider');
    assert.ok(body.temperature <= 0.25, 'max lowers temperature');
  } finally {
    stub.restore();
    resetProviderHealth();
  }
});

test('a stale flagship walks down to the provider default on the same key', async () => {
  withKeys();
  resetProviderHealth();
  const stub = stubFetch((rec) => (rec.url.includes('openai.com') && rec.body.model === 'gpt-4.1'
    ? { status: 404, body: { error: { message: 'The model `gpt-4.1` does not exist', type: 'invalid_request_error', code: 'model_not_found' } } }
    : okOpenAI('fallback answered')));
  try {
    const res = await executeProviderChat('openai', { system: 's', user: 'u', intelligence: 'max' });
    assert.equal(res.text, 'fallback answered');
    assert.notEqual(res.model, 'gpt-4.1');
    assert.equal(res.attempts[0].reasonCode, 'MODEL_UNAVAILABLE');
  } finally {
    stub.restore();
    resetProviderHealth();
  }
});

test('balanced sends exactly the old model and temperature', async () => {
  withKeys();
  resetProviderHealth();
  const stub = stubFetch(() => okOpenAI('old behaviour'));
  try {
    const res = await executeProviderChat('openai', { system: 's', user: 'u', temperature: 0.42, maxTokens: 800, intelligence: 'balanced' });
    assert.equal(res.model, 'gpt-4o-mini');
    const body = stub.calls[0].body;
    assert.equal(body.temperature, 0.42);
    assert.equal(body.max_tokens, 800);
    assert.equal('reasoning_effort' in body, false);
  } finally {
    stub.restore();
    resetProviderHealth();
  }
});

test('max sends gemini thinking only on the 2.5 family', async () => {
  withKeys();
  resetProviderHealth();
  const stub = stubFetch((rec) => (rec.url.includes('generativelanguage') ? okGemini('gem') : okOpenAI('x')));
  try {
    await executeProviderChat('gemini', { system: 's', user: 'u', intelligence: 'max' });
    const cfg = stub.calls[0].body.generationConfig;
    assert.ok(cfg.thinkingConfig, 'the pro seat should carry a thinking config');
    assert.ok(!stub.calls[0].url.includes('key='), 'key must stay out of the URL');
  } finally {
    stub.restore();
    resetProviderHealth();
  }
});

test('max sends anthropic extended thinking, balanced does not', async () => {
  withKeys();
  resetProviderHealth();
  const stub = stubFetch(() => ({
    status: 200,
    body: { content: [{ type: 'text', text: 'claude answer' }], usage: { input_tokens: 10, output_tokens: 5 } }
  }));
  try {
    await executeProviderChat('anthropic', { system: 's', user: 'u', intelligence: 'max' });
    const maxBody = stub.calls[0].body;
    assert.equal(maxBody.model, 'claude-sonnet-4-6');
    assert.ok(maxBody.thinking && maxBody.thinking.type === 'enabled');
    assert.equal('temperature' in maxBody, false, 'thinking rejects sampling parameters');

    stub.calls.length = 0;
    await executeProviderChat('anthropic', { system: 's', user: 'u', intelligence: 'balanced' });
    const balancedBody = stub.calls[0].body;
    assert.equal(balancedBody.model, 'claude-haiku-4-5');
    assert.equal('thinking' in balancedBody, false);
    assert.equal(balancedBody.temperature, 0.3);
  } finally {
    stub.restore();
    resetProviderHealth();
  }
});

test('a degraded reply still names the mode that was asked for', async () => {
  withKeys();
  resetProviderHealth();
  const stub = stubFetch(() => ({ status: 402, body: { error: { message: 'Insufficient Balance' } } }));
  try {
    const res = await routedChat({ taskType: 'general', system: 's', user: 'u', intelligence: 'swift' });
    assert.equal(res.degraded, true);
    assert.equal(res.intelligence.mode, 'swift');
    assert.equal(res.notice.fa.includes('قاعده‌محور'), true);
  } finally {
    stub.restore();
    resetProviderHealth();
  }
});

test('the profile of max is honest about what it does and does not do', () => {
  const p = getIntelligenceProfile('max');
  assert.equal(p.reasoning, true);
  assert.equal(p.collaborationFloor, 4);
  assert.ok(p.tokenScale > 1);
  assert.ok(Object.keys(p.modelLadders).length >= 8);
  assert.equal(getIntelligenceProfile('nonsense').id, 'max', 'an unknown mode falls back to the default, never to a weaker one');
});


/* ── 8. the browser half ─────────────────────────────────────────────────── */

test('the client defaults to the smartest mode and accepts the same aliases', () => {
  assert.equal(DEFAULT_INTELLIGENCE_MODE, 'max');
  assert.equal(getClientMode(), 'max', 'no window / empty storage resolves to max, never to a weaker mode');
  assert.equal(normalizeClientMode('smartest'), 'max');
  assert.equal(normalizeClientMode('باهوش‌ترین'), 'max', 'the old label still resolves — a saved preference must not silently downgrade');
  assert.equal(normalizeClientMode('هوش عمیق'), 'max', 'the label the UI shows now resolves too');
  assert.equal(normalizeClientMode('fast'), 'swift');
  assert.equal(normalizeClientMode('nonsense'), null);
  assert.equal(CLIENT_MODES.length, 3);
  assert.ok(CLIENT_MODES.every((m) => m.label.fa && m.label.en && m.hint.fa && m.hint.en));
});

test('the mode label is localised in both languages', () => {
  assert.equal(intelligenceModeLabel('max', 'fa'), 'هوش عمیق');
  assert.equal(intelligenceModeLabel('max', 'en-US'), 'Smartest');
  assert.equal(intelligenceModeLabel('swift', 'fa-IR'), 'سریع');
});
