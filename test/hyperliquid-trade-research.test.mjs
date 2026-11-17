/** Offline gates for the first-party-agent → AI Trade evidence bridge. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  TRADE_RESEARCH_MAX_AGE_MS,
  TRADE_RESEARCH_MAX_CHARS,
  normalizeTradeResearch,
  queueTradeResearchForAiTrade,
  subscribeTradeResearch,
  takeQueuedTradeResearch,
  tradeResearchFromTask
} from '../src/lib/hyperliquid/tradeResearch.js';
import {
  AI_PROVIDER_PRESETS,
  buildAnalystMessages,
  requestProposals,
  selectAIProvider
} from '../src/lib/hyperliquid/aiClient.js';

const NOW = 1_800_000_000_000;
const active = {
  id: 'fbt-native-smart-money-tracker',
  name: 'Smart Money Tracker',
  nameFa: 'ردیاب پول هوشمند',
  native: true,
  source: 'native'
};
const task = (patch = {}) => ({
  agentId: 'fbt-native:smart-money-tracker',
  providerId: 'fbt-native',
  state: 'completed',
  terminal: true,
  active: false,
  result: {
    text: 'گزارش دادهٔ زنده',
    citations: ['https://example.test/source'],
    data: {
      agent: 'smart-money-tracker',
      title: 'گزارش جریان پول هوشمند',
      dataStatus: 'live',
      readAt: NOW - 1000,
      citations: ['https://example.test/source'],
      ...patch
    }
  }
});

test('only a completed first-party live report becomes trade evidence', () => {
  const out = tradeResearchFromTask(task(), active, { now: NOW });
  assert.equal(out?.slug, 'smart-money-tracker');
  assert.equal(out?.dataStatus, 'live');
  assert.equal(out?.title, 'گزارش جریان پول هوشمند');
  assert.deepEqual(out?.citations, ['https://example.test/source']);
});

test('a third-party agent cannot enter the FBT evidence lane', () => {
  assert.equal(tradeResearchFromTask(task(), { ...active, native: false, source: 'user' }, { now: NOW }), null);
  assert.equal(tradeResearchFromTask(task(), { ...active, id: 'some-external-agent' }, { now: NOW }), null);
  assert.equal(tradeResearchFromTask(task({ agent: 'smart-money-tracker' }), { ...active, id: 'fbt-native:token-research-agent' }, { now: NOW }), null);
  assert.equal(tradeResearchFromTask({ ...task(), providerId: 'external', agentId: 'external:smart-money-tracker' }, active, { now: NOW }), null);
});

test('partial, unavailable, input-needed and nonterminal plugin results are refused', () => {
  assert.equal(tradeResearchFromTask(task({ dataStatus: 'partial' }), active, { now: NOW }), null);
  assert.equal(tradeResearchFromTask(task({ dataStatus: 'unavailable' }), active, { now: NOW }), null);
  assert.equal(tradeResearchFromTask(task({ needsInput: true }), active, { now: NOW }), null);
  assert.equal(tradeResearchFromTask({ ...task(), state: 'running' }, active, { now: NOW }), null);
  assert.equal(tradeResearchFromTask({ ...task(), terminal: false }, active, { now: NOW }), null);
  assert.equal(tradeResearchFromTask({ ...task(), active: true }, active, { now: NOW }), null);
});

test('a result from a different plugin or without a read timestamp is refused', () => {
  assert.equal(tradeResearchFromTask(task({ agent: 'token-risk-scanner' }), active, { now: NOW }), null);
  assert.equal(tradeResearchFromTask(task({ readAt: null }), active, { now: NOW }), null);
});

test('stale evidence is refused rather than silently called live', () => {
  const old = NOW - TRADE_RESEARCH_MAX_AGE_MS - 1;
  assert.equal(tradeResearchFromTask(task({ readAt: old }), active, { now: NOW }), null);
  assert.equal(tradeResearchFromTask(task({ readAt: NOW + 1 }), active, { now: NOW }), null);
});

test('the prompt boundary revalidates freshness, status, schema and size', () => {
  const fresh = tradeResearchFromTask(task(), active, { now: NOW });
  assert.ok(normalizeTradeResearch(fresh, { now: NOW }));
  assert.equal(normalizeTradeResearch({ ...fresh, dataStatus: 'partial' }, { now: NOW }), null);
  assert.equal(normalizeTradeResearch({ ...fresh, schema: 'other' }, { now: NOW }), null);
  assert.equal(normalizeTradeResearch({ ...fresh, readAt: NOW - TRADE_RESEARCH_MAX_AGE_MS - 1 }, { now: NOW }), null);
  assert.ok(normalizeTradeResearch({ ...fresh, text: 'x'.repeat(TRADE_RESEARCH_MAX_CHARS + 200) }, { now: NOW }).text.length <= TRADE_RESEARCH_MAX_CHARS);
});

test('unsafe citation schemes and credentials are dropped, not normalized', () => {
  const fresh = tradeResearchFromTask(task({ citations: [
    'javascript:alert(1)',
    'http://insecure.test/',
    'https://user:pass@example.test/private',
    'https://127.0.0.1/private',
    'https://good.example/source?api_key=secret',
    'https://good.example/source#fragment',
    'https://good.example/source'
  ] }), active, { now: NOW });
  assert.deepEqual(fresh?.citations, ['https://good.example/source']);
});

test('the report hand-off is ephemeral, explicit, freshness-checked and consumable', () => {
  const fresh = tradeResearchFromTask(task(), active, { now: NOW });
  let notified = null;
  const unsubscribe = subscribeTradeResearch((value) => { notified = value; });
  try {
    assert.equal(queueTradeResearchForAiTrade(fresh, { now: NOW }), true);
    assert.equal(notified?.slug, 'smart-money-tracker');
    assert.equal(takeQueuedTradeResearch({ now: NOW }), null, 'an active consumer receives and consumes the report');
    unsubscribe();
    assert.equal(queueTradeResearchForAiTrade(fresh, { now: NOW }), true);
    assert.equal(takeQueuedTradeResearch({ now: NOW })?.text, 'گزارش دادهٔ زنده');
    assert.equal(takeQueuedTradeResearch({ now: NOW }), null, 'the pending one-shot hand-off is consumed on mount');
    assert.equal(queueTradeResearchForAiTrade({ ...fresh, readAt: NOW - TRADE_RESEARCH_MAX_AGE_MS - 1 }, { now: NOW }), false);
  } finally { unsubscribe(); takeQueuedTradeResearch({ now: NOW }); }
});

test('changing AI provider clears provider-scoped secrets and models', () => {
  const current = { aiProvider: 'openai', aiEndpoint: AI_PROVIDER_PRESETS.openai.endpoint, aiKey: 'openai-secret', aiModel: 'some-model' };
  const grok = selectAIProvider(current, 'grok');
  assert.equal(grok.aiEndpoint, 'https://api.x.ai/v1/chat/completions');
  assert.equal(grok.aiKey, '');
  assert.equal(grok.aiModel, '');
  assert.equal(selectAIProvider(grok, 'grok').aiKey, '');
  const custom = selectAIProvider(grok, 'custom');
  assert.equal(custom.aiEndpoint, '');
  assert.equal(custom.aiKey, '');
});

test('the Grok preset calls the selected xAI endpoint with BYOK and OpenAI-compatible JSON', async () => {
  let request;
  const response = await requestProposals({
    apiKey: 'xai-test-key',
    endpoint: AI_PROVIDER_PRESETS.grok.endpoint,
    model: 'account-selected-model',
    messages: [{ role: 'system', content: 'test' }],
    limits: { allowedCoins: [], maxLeverage: 2, maxStopLossPct: 0.05 },
    fetchImpl: async (url, init) => {
      request = { url, init };
      return { ok: true, json: async () => ({ choices: [{ message: { content: '{"proposals":[]}' } }] }) };
    }
  });
  assert.equal(response.ok, true);
  assert.equal(request.url, AI_PROVIDER_PRESETS.grok.endpoint);
  assert.equal(request.init.headers.authorization, 'Bearer xai-test-key');
  assert.equal(JSON.parse(request.init.body).model, 'account-selected-model');
  assert.equal(request.init.redirect, 'error');
  let unsafeEndpointCalls = 0;
  for (const endpoint of [
    'https://api.x.ai/v1/chat/completions?key=leak',
    'https://user:secret@api.x.ai/v1/chat/completions',
    'https://api.x.ai/v1/chat/completions#fragment'
  ]) {
    const unsafe = await requestProposals({
      apiKey: 'xai-test-key', endpoint, model: 'm',
      messages: [], limits: { allowedCoins: [], maxLeverage: 2, maxStopLossPct: 0.05 },
      fetchImpl: async () => { unsafeEndpointCalls += 1; return { ok: true, json: async () => ({}) }; }
    });
    assert.equal(unsafe.code, 'AI_INVALID_ENDPOINT');
  }
  assert.equal(unsafeEndpointCalls, 0);
});

test('only explicitly opted-in, fresh evidence reaches the analyst prompt as untrusted data', () => {
  const fresh = tradeResearchFromTask(task(), active, { now: NOW });
  const args = {
    rules: { strategy: 'manual', notes: '' },
    caps: { maxOrderUsd: 100, maxLeverage: 2, maxStopLossPct: 0.05, allowedCoins: ['BTC'] },
    account: {}, mids: {}, candles: []
  };
  const absent = buildAnalystMessages({ ...args, now: NOW });
  const included = buildAnalystMessages({ ...args, firstPartyResearch: fresh, now: NOW });
  assert.equal(JSON.parse(absent[1].content).firstPartyResearch, undefined);
  assert.equal(JSON.parse(absent[1].content).riskBudget.maxAdditionalOrderUsd, null);
  assert.equal(JSON.parse(included[1].content).firstPartyResearch.dataStatus, 'live');
  assert.match(included[0].content, /untrusted data/);
  assert.match(included[0].content, /does not trade listed stocks/);
  const stale = buildAnalystMessages({ ...args, firstPartyResearch: { ...fresh, readAt: NOW - TRADE_RESEARCH_MAX_AGE_MS - 1 }, now: NOW });
  assert.equal(JSON.parse(stale[1].content).firstPartyResearch, undefined);
});
