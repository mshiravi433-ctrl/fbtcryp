/**
 * The provider FLEET — three keys work, and only three may be called.
 * ---------------------------------------------------------------------------
 * On this deployment the working keys are OpenRouter, Groq and Cloudflare
 * Workers AI. The other seven registered providers have no key or an expired
 * one, and an expired key that is still PRESENT is the expensive case: the
 * gateway used to count it as configured and pay a round-trip on every request
 * before failing over.
 *
 * The fleet is therefore declared (`FBT_AI_PROVIDERS`, default
 * `openrouter,groq,workersai`), not discovered by burning calls. These tests
 * pin the properties that make that safe:
 *
 *   1. the default is exactly the three providers that have keys;
 *   2. `internal` — the rule engine that needs no key — is never excluded;
 *   3. an unusable value never widens the fleet, and never empties it;
 *   4. a provider outside the fleet is not called, has no model tried and does
 *      not appear in the request trail, even when a key is present;
 *   5. diagnostics say OUT_OF_FLEET, not «کلید ندارد», about a keyed provider
 *      the operator chose to leave out;
 *   6. `FBT_AI_PROVIDERS=all` restores "use every key that is present".
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  PROVIDER_FLEET_SCHEMA,
  DEFAULT_PROVIDER_FLEET,
  resolveProviderFleet,
  isProviderInFleet,
  providerFleetExclusion,
  describeProviderFleet
} from '../../server/aiProviderFleet.js';

const ALL_KEYS = {
  OPENROUTER_API_KEY: 'sk-or-test',
  GROQ_API_KEY: 'gsk-test',
  OPENAI_API_KEY: 'sk-test',
  ANTHROPIC_API_KEY: 'ant-test',
  GEMINI_API_KEY: 'gem-test',
  XAI_API_KEY: 'xai-test',
  DEEPSEEK_API_KEY: 'ds-test',
  MISTRAL_API_KEY: 'mist-test',
  CLOUDFLARE_API_TOKEN: 'cf-test',
  CLOUDFLARE_ACCOUNT_ID: 'acct-test',
  AIMLAPI_KEY: 'aiml-test'
};

const saved = {};
for (const [k, v] of Object.entries(ALL_KEYS)) {
  saved[k] = process.env[k];
  process.env[k] = v;
}
const savedFleet = process.env.FBT_AI_PROVIDERS;
delete process.env.FBT_AI_PROVIDERS;

const {
  getActiveProviderIds,
  getAvailableProviders,
  getFleetSummary,
  resetProviderHealth,
  routedChat,
  gatewaySelfTest
} = await import('../../server/aiGateway.js');

function restore() {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  if (savedFleet === undefined) delete process.env.FBT_AI_PROVIDERS;
  else process.env.FBT_AI_PROVIDERS = savedFleet;
}

function withFleet(value, fn) {
  const previous = process.env.FBT_AI_PROVIDERS;
  if (value === undefined) delete process.env.FBT_AI_PROVIDERS;
  else process.env.FBT_AI_PROVIDERS = value;
  try {
    return fn();
  } finally {
    if (previous === undefined) delete process.env.FBT_AI_PROVIDERS;
    else process.env.FBT_AI_PROVIDERS = previous;
  }
}

/* -------------------------------------------------------------------------- */
/*  A. THE DECLARATION                                                        */
/* -------------------------------------------------------------------------- */

test('the default fleet is exactly the three providers whose keys work', () => {
  const fleet = resolveProviderFleet();
  assert.equal(fleet.schema, PROVIDER_FLEET_SCHEMA);
  assert.deepEqual(fleet.providers, ['openrouter', 'groq', 'workersai']);
  assert.deepEqual([...DEFAULT_PROVIDER_FLEET], ['openrouter', 'groq', 'workersai']);
  assert.equal(fleet.source, 'default');
  assert.equal(fleet.restricted, true);
});

test('aliases an operator would actually type resolve, junk is reported', () => {
  assert.deepEqual(resolveProviderFleet('cf, OR ,Groq').providers, ['workersai', 'openrouter', 'groq']);
  assert.deepEqual(resolveProviderFleet('workers-ai').providers, ['workersai']);
  const typo = resolveProviderFleet('openrouter,not-a-provider');
  assert.deepEqual(typo.providers, ['openrouter']);
  assert.deepEqual(typo.rejected, ['not-a-provider']);
});

test('an unusable value neither widens nor empties the fleet', () => {
  for (const raw of ['   ', 'giberish', ',,,']) {
    const fleet = resolveProviderFleet(raw);
    assert.deepEqual(fleet.providers, ['openrouter', 'groq', 'workersai'], `raw=${JSON.stringify(raw)}`);
    assert.equal(fleet.source, 'default');
    assert.equal(fleet.restricted, true);
  }
});

test('`all` lifts the restriction instead of naming a provider called "all"', () => {
  const fleet = resolveProviderFleet('all');
  assert.equal(fleet.providers, null);
  assert.equal(fleet.restricted, false);
  assert.equal(describeProviderFleet.call(null) instanceof Object, true);
});

test('`internal` is never excluded: the assistant always keeps a keyless seat', () => {
  withFleet('openrouter', () => {
    assert.equal(isProviderInFleet('internal'), true);
    assert.equal(isProviderInFleet('groq'), false);
    assert.equal(providerFleetExclusion('openai'), 'NOT_IN_FLEET');
    assert.equal(providerFleetExclusion('openrouter'), null);
  });
});

/* -------------------------------------------------------------------------- */
/*  B. THE GATEWAY OBEYS IT                                                  */
/* -------------------------------------------------------------------------- */

test('with every key present, the active fleet is still the three (+internal)', () => {
  resetProviderHealth();
  withFleet(undefined, () => {
    const active = getActiveProviderIds();
    for (const id of ['openrouter', 'groq', 'workersai', 'internal']) {
      assert.ok(active.includes(id), `expected ${id} active, got ${active.join(',')}`);
    }
    for (const id of ['openai', 'anthropic', 'gemini', 'xai', 'deepseek', 'mistral', 'aimlapi']) {
      assert.equal(active.includes(id), false, `${id} must not be active`);
    }
  });
});

test('a keyed but out-of-fleet provider is OUT_OF_FLEET, never «needs key»', () => {
  withFleet(undefined, () => {
    const rows = getAvailableProviders();
    const openai = rows.find((p) => p.id === 'openai');
    assert.equal(openai.configured, false);
    assert.equal(openai.keyPresent, true, 'the key is present — that is the whole trap');
    assert.equal(openai.inFleet, false);
    assert.equal(openai.excludedBy, 'NOT_IN_FLEET');
    assert.equal(openai.status, 'OUT_OF_FLEET');
    assert.equal(openai.verdict, 'OUT_OF_FLEET');

    const openrouter = rows.find((p) => p.id === 'openrouter');
    assert.equal(openrouter.inFleet, true);
    assert.equal(openrouter.excludedBy, null);

    const summary = getFleetSummary();
    assert.equal(summary.fleet.providers.join(','), 'openrouter,groq,workersai');
    assert.deepEqual(summary.outOfFleetWithKey.sort(), ['aimlapi', 'anthropic', 'deepseek', 'gemini', 'mistral', 'openai', 'xai']);
    /* The three in-fleet providers have keys, so nothing is "missing a key". */
    assert.deepEqual(summary.needsKey, []);
  });
});

test('no request ever touches a provider outside the fleet', async () => {
  const urls = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url) => {
    urls.push(String(url));
    return {
      ok: true,
      status: 200,
      json: async () => ({ choices: [{ message: { content: 'ok' } }], usage: {} }),
      text: async () => JSON.stringify({ choices: [{ message: { content: 'ok' } }] })
    };
  };
  try {
    resetProviderHealth();
    await withFleet(undefined, () => routedChat({ taskType: 'general', system: 's', user: 'u', maxTokens: 32 }));
    assert.ok(urls.length >= 1, 'the call must reach a seat');
    for (const url of urls) {
      assert.equal(
        /api\.openai\.com|api\.anthropic\.com|generativelanguage\.googleapis\.com|api\.deepseek\.com|api\.mistral\.ai|api\.aimlapi\.com/.test(url),
        false,
        `called a provider outside the fleet: ${url}`
      );
    }
  } finally {
    globalThis.fetch = original;
  }
});

test('the live self-test reports OUT_OF_FLEET without calling the provider', async () => {
  const original = globalThis.fetch;
  const urls = [];
  globalThis.fetch = async (url) => {
    urls.push(String(url));
    return {
      ok: true,
      status: 200,
      json: async () => ({ choices: [{ message: { content: 'OK' } }], usage: {} }),
      text: async () => JSON.stringify({ choices: [{ message: { content: 'OK' } }] })
    };
  };
  try {
    resetProviderHealth();
    const out = await withFleet(undefined, () => gatewaySelfTest());
    const byId = Object.fromEntries(out.providers.map((p) => [p.id, p]));
    assert.equal(byId.openai.status, 'OUT_OF_FLEET');
    assert.equal(byId.openai.reasonCode, 'NOT_IN_FLEET');
    assert.match(byId.openai.fix, /FBT_AI_PROVIDERS/);
    assert.equal(byId.gemini.status, 'OUT_OF_FLEET');
    assert.equal(typeof out.summary.outOfFleetCount, 'number');
    assert.equal(urls.some((u) => u.includes('api.openai.com')), false);
    assert.equal(urls.some((u) => u.includes('api.anthropic.com')), false);
  } finally {
    globalThis.fetch = original;
  }
});

test('`all` restores the every-key fleet, so nothing is unreachable by accident', () => {
  resetProviderHealth();
  withFleet('all', () => {
    const active = getActiveProviderIds();
    for (const id of ['openrouter', 'groq', 'workersai', 'openai', 'anthropic', 'gemini', 'xai', 'deepseek', 'mistral', 'aimlapi']) {
      assert.ok(active.includes(id), `${id} should be active when the fleet is lifted`);
    }
  });
});

test('the published fleet carries no key and no execution authority', () => {
  const fleet = describeProviderFleet();
  const text = JSON.stringify(fleet);
  assert.equal(text.includes('sk-or-test'), false);
  assert.equal(text.includes('gsk-test'), false);
  assert.deepEqual(fleet.authority, { canExecute: false, canSign: false, canMoveFunds: false });
  assert.equal(fleet.envVar, 'FBT_AI_PROVIDERS');
});

test.after(restore);
