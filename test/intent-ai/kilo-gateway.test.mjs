/**
 * KILO AI GATEWAY (`https://ai-gateway.kilo.ai/api/v1`) — OPERATIONAL CONTRACT
 * ============================================================================
 * Verifies end-to-end integration of Kilo AI Gateway across:
 *   1. Two-seat architecture (`kilo` paid seat vs `kilofree` free seat);
 *   2. Default fleet inclusion (`kilofree` in `DEFAULT_PROVIDER_FLEET`, `kilo`
 *      excluded until declared in `FBT_AI_PROVIDERS`);
 *   3. Dual auth on `kilofree`:
 *        · Keyed (`KILO_API_KEY` / `KILOCODE_API_KEY` / `KILO_KEY`) → sends
 *          `Authorization: Bearer <key>`
 *        · Keyless anonymous (`VERCEL=1`, `FBT_SERVER_BOOTED=1`, or
 *          `KILO_FREE_ANONYMOUS=1`) → omits `Authorization` header altogether
 *          per Kilo's documented anonymous free-model protocol (200 req/hr/IP);
 *   4. Intelligence modes (`max` flagship ladders, `reasoning: { effort: 'high' }`
 *      on Nemotron/reasoning models, `x-kilocode-mode` on `kilo-auto/*`);
 *   5. Quota budget (`DEFAULT_DAILY_LIMITS.kilofree = 500`, `kilo = 1000`),
 *      Central Brain catalogue, pricing table, and Agent Hub BYO-key bridge.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ANONYMOUS_FREE_SENTINEL,
  PROVIDER_CONFIGS,
  executeProviderChat,
  getActiveProviderIds,
  getAvailableProviders,
  getModelCandidates,
  getPreferredProvidersForTask,
  getProviderKey,
  isAnonymousProviderEnabled,
  isProviderConfigured,
  resetProviderHealth,
  routedChat
} from '../../server/aiGateway.js';
import { DEFAULT_PROVIDER_FLEET, PROVIDER_ALIASES, resolveProviderFleet } from '../../server/aiProviderFleet.js';
import { intelligenceModelLadder, intelligenceReasoningFields } from '../../server/aiIntelligence.js';
import { DEFAULT_DAILY_LIMITS, dailyLimitFor } from '../../server/aiQuotaBudget.js';
import { estimateCostUsd } from '../../server/aiBenchmark.js';
import { bridgeById } from '../../server/agentHub/keyBridges.js';
import { MODEL_FLEET_CATALOGUE } from '../../src/lib/intent-ai/orchestrator/centralBrain.js';

function withEnv(patch, fn) {
  const prev = {};
  for (const k of Object.keys(patch)) {
    prev[k] = process.env[k];
    if (patch[k] === undefined) delete process.env[k];
    else process.env[k] = patch[k];
  }
  try {
    return fn();
  } finally {
    for (const [k, v] of Object.entries(prev)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

test('kilo and kilofree are registered with live OpenAI-compatible Kilo Gateway URLs', () => {
  assert.equal(PROVIDER_CONFIGS.kilo.url, 'https://ai-gateway.kilo.ai/api/v1/chat/completions');
  assert.equal(PROVIDER_CONFIGS.kilofree.url, 'https://ai-gateway.kilo.ai/api/v1/chat/completions');
  assert.equal(PROVIDER_CONFIGS.kilo.type, 'openai-compatible');
  assert.equal(PROVIDER_CONFIGS.kilofree.type, 'openai-compatible');
  assert.equal(PROVIDER_CONFIGS.kilofree.costTier, 'free');

  /* Every automatic candidate on `kilofree` must be a zero-cost `:free` or
     Kilo free-router model so anonymous / zero-balance calls never hit 402. */
  const freeModels = [PROVIDER_CONFIGS.kilofree.baseModel, ...PROVIDER_CONFIGS.kilofree.fallbackModels];
  for (const m of freeModels) {
    const ok = m.endsWith(':free') || m === 'reflection/beam-free' || m === 'kilo-auto/free' || m === 'kilo-auto/small';
    assert.ok(ok, `kilofree candidate must be free, got ${m}`);
  }
});

test('kilofree is in DEFAULT_PROVIDER_FLEET, paid kilo stays opt-in, and aliases resolve', () => {
  assert.ok(DEFAULT_PROVIDER_FLEET.includes('kilofree'));
  assert.equal(DEFAULT_PROVIDER_FLEET.includes('kilo'), false);
  assert.equal(PROVIDER_ALIASES['kilo-gateway'], 'kilo');
  assert.equal(PROVIDER_ALIASES.kilocode, 'kilo');
  assert.equal(PROVIDER_ALIASES['kilo-free'], 'kilofree');
  assert.equal(PROVIDER_ALIASES.kf, 'kilofree');
  assert.deepEqual(resolveProviderFleet('kilo-gateway, kf').providers, ['kilo', 'kilofree']);
});

test('kilofree activates automatically on Vercel / booted server without KILO_API_KEY, and stays quiet in bare offline tests', () => {
  assert.equal(isAnonymousProviderEnabled('kilofree', {}), false);
  assert.equal(isAnonymousProviderEnabled('kilofree', { VERCEL: '1' }), true);
  assert.equal(isAnonymousProviderEnabled('kilofree', { FBT_SERVER_BOOTED: '1' }), true);
  assert.equal(isAnonymousProviderEnabled('kilofree', { VERCEL: '1', KILO_FREE_ANONYMOUS: '0' }), false);
  assert.equal(isAnonymousProviderEnabled('kilofree', { KILO_FREE_ANONYMOUS: '1' }), true);
  /* Paid `kilo` seat never allows anonymous keyless calls. */
  assert.equal(isAnonymousProviderEnabled('kilo', { VERCEL: '1', KILO_FREE_ANONYMOUS: '1' }), false);

  withEnv({ KILO_API_KEY: undefined, KILOCODE_API_KEY: undefined, KILO_KEY: undefined, VERCEL: '1', FBT_AI_PROVIDERS: undefined }, () => {
    assert.equal(getProviderKey('kilofree'), ANONYMOUS_FREE_SENTINEL);
    assert.equal(isProviderConfigured('kilofree'), true);
    assert.equal(isProviderConfigured('kilo'), false);
    assert.ok(getActiveProviderIds().includes('kilofree'));
    const row = getAvailableProviders().find((p) => p.id === 'kilofree');
    assert.equal(row.status, 'ACTIVE');
    assert.equal(row.keyPresent, false);
    assert.equal(row.anonymousFree, true);
    assert.equal(row.keySourceEnv, 'anonymous-free');
  });
});

test('anonymous kilofree omits Authorization header on wire; keyed kilofree/kilo send Bearer token and x-kilocode-mode', async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, opts = {}) => {
    calls.push({
      url: String(url),
      headers: opts.headers || {},
      body: JSON.parse(opts.body || '{}')
    });
    return new Response(JSON.stringify({
      choices: [{ message: { content: 'kilo-live-ok' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 12, completion_tokens: 6 }
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  };

  try {
    resetProviderHealth();
    /* 1. Keyless anonymous call (simulated Vercel runtime, no KILO_API_KEY) */
    await withEnv({
      KILO_API_KEY: undefined,
      KILOCODE_API_KEY: undefined,
      KILO_KEY: undefined,
      KILO_FREE_ANONYMOUS: '1',
      FBT_AI_PROVIDERS: 'kilofree'
    }, async () => {
      const routed = await routedChat({
        taskType: 'market',
        system: 'You are FBT analyst.',
        user: 'Assess BTC structure briefly.',
        intelligence: 'max'
      });
      assert.equal(routed.provider, 'kilofree');
      assert.equal(routed.text, 'kilo-live-ok');
      assert.equal(calls.length, 1);
      assert.equal(calls[0].url, 'https://ai-gateway.kilo.ai/api/v1/chat/completions');
      assert.equal('Authorization' in calls[0].headers, false, 'anonymous free call must NOT send a bogus Authorization header');
      assert.equal(calls[0].body.model, 'nvidia/nemotron-3-ultra-550b-a55b:free');
      assert.deepEqual(calls[0].body.reasoning, { effort: 'high' });
    });

    /* 2. Keyed paid `kilo` call with `kilo-auto/frontier` in `max` mode */
    calls.length = 0;
    resetProviderHealth();
    await withEnv({
      KILO_API_KEY: '  Bearer eyJhbGciOiJIUzI1NiJ9.kilo-test \n',
      FBT_AI_PROVIDERS: 'kilo,kilofree'
    }, async () => {
      const res = await executeProviderChat('kilo', {
        system: 's',
        user: 'u',
        intelligence: 'max'
      });
      assert.equal(res.text, 'kilo-live-ok');
      assert.equal(calls.length, 1);
      assert.equal(calls[0].headers.Authorization, 'Bearer eyJhbGciOiJIUzI1NiJ9.kilo-test');
      assert.equal(calls[0].headers['x-kilocode-mode'], 'plan');
      assert.equal(calls[0].body.model, 'kilo-auto/frontier');
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('max mode ladders, task routes, quotas, pricing, Central Brain, and Agent Hub BYOK bridge include Kilo', () => {
  assert.equal(intelligenceModelLadder('kilo', 'max')[0], 'kilo-auto/frontier');
  assert.equal(intelligenceModelLadder('kilofree', 'max')[0], 'nvidia/nemotron-3-ultra-550b-a55b:free');
  assert.equal(getModelCandidates('kilofree', null, { mode: 'max' })[0], 'nvidia/nemotron-3-ultra-550b-a55b:free');
  assert.deepEqual(intelligenceReasoningFields('kilofree', 'max', 'nvidia/nemotron-3.5-super-vl:free'), { reasoning: { effort: 'high' } });

  for (const task of ['general', 'market', 'research', 'reasoning', 'risk', 'fast']) {
    const route = getPreferredProvidersForTask(task);
    assert.ok(route.includes('kilo') && route.includes('kilofree'), `route "${task}" must include kilo & kilofree`);
  }

  assert.equal(DEFAULT_DAILY_LIMITS.kilofree, 500);
  assert.equal(DEFAULT_DAILY_LIMITS.kilo, 1000);
  assert.equal(dailyLimitFor('kilofree', { AI_DAILY_LIMIT_KILOFREE: '800' }), 800);

  assert.equal(estimateCostUsd('kilofree', 'nvidia/nemotron-3.5-super-vl:free', { inputTokens: 10000, outputTokens: 2000 }).usd, 0);
  assert.ok(estimateCostUsd('kilo', 'kilo-auto/efficient', { inputTokens: 10000, outputTokens: 2000 }).usd > 0);

  assert.ok(MODEL_FLEET_CATALOGUE.kilo);
  assert.ok(MODEL_FLEET_CATALOGUE.kilofree);

  const bridge = bridgeById('kilo');
  assert.ok(bridge, 'Agent Hub BYO-key bridge must include kilo');
  assert.equal(bridge.baseUrl, 'https://ai-gateway.kilo.ai/api/v1');
  assert.equal(bridge.protocol, 'openai');
});
