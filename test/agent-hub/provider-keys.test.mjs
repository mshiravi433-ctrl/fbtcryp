#!/usr/bin/env node
/**
 * BYO-key bridges: a pasted key is verified against the vendor's own host,
 * sealed with the Hub's single crypto primitive, and only then usable — and the
 * answer it produces carries its real attribution.
 *
 * No network here: `fetchImpl` is a fixture that records the exact URL and
 * headers the module would have sent, which is also how the SSRF assertion is
 * made (the host is a catalog constant, never the providerId the caller typed).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { createProviderKeys } from '../../server/agentHub/providerKeys.js';
import { BRIDGE_CATEGORIES, BRIDGES_INTERNAL_FOR_TESTS, KEY_BRIDGE_IDS } from '../../server/agentHub/keyBridges.js';

const OWNER = 'dev:provider-key-test';
const OTHER = 'dev:someone-else';
const SECRET = 'sk-test-abcdefghijklmnop-NEVER-RETURN';
const ENV = { AGENT_HUB_SECRET_KEY: 'd'.repeat(64) };

function memoryStore({ isDurable = true } = {}) {
  const rows = new Map();
  return {
    rows,
    durable: () => isDurable,
    async getFresh(key, fallback) {
      return rows.has(key) ? rows.get(key) : fallback;
    },
    async set(key, value) {
      if (value === null) rows.delete(key);
      else rows.set(key, value);
      return value;
    }
  };
}

/** Fixture transport: models OK, chat OK, unless the test says otherwise. */
function fixtureFetch({ modelsStatus = 200, chatStatus = 200, models = ['gpt-4o-mini-2024-07-18'] } = {}) {
  const calls = [];
  const impl = async (url, init = {}) => {
    calls.push({ url: String(url), method: init.method || 'GET', headers: init.headers || {}, body: init.body || null });
    const isChat = String(init.method) === 'POST';
    const status = isChat ? chatStatus : modelsStatus;
    const payload = isChat
      ? { choices: [{ message: { content: 'ETH funding is positive; perp basis ~0.4% — risk is crowded long.' } }] }
      : { data: models.map((id) => ({ id })) };
    return {
      ok: status >= 200 && status < 300,
      status,
      async text() {
        return JSON.stringify(status >= 300 ? { error: { message: 'invalid api key provided' } } : payload);
      }
    };
  };
  impl.calls = calls;
  return impl;
}

const build = ({ storage = memoryStore(), fetchImpl = fixtureFetch(), now = () => 1_700_000_000_000 } = {}) =>
  createProviderKeys({ env: ENV, storage, fetchImpl, now });

describe('BYO-key bridges — connect', () => {
  it('refuses a provider id that is not in the catalog, before any request', async () => {
    const fetchImpl = fixtureFetch();
    const keys = build({ fetchImpl });
    const out = await keys.connect({ owner: OWNER, providerId: 'https://evil.example', secret: SECRET });
    assert.equal(out.ok, false);
    assert.equal(out.code, 'PROVIDER_NOT_CONNECTABLE');
    assert.equal(fetchImpl.calls.length, 0);
  });

  it('sends the key to the catalog host and stores nothing when the vendor rejects it', async () => {
    const storage = memoryStore();
    const fetchImpl = fixtureFetch({ modelsStatus: 401 });
    const keys = build({ storage, fetchImpl });
    const out = await keys.connect({ owner: OWNER, providerId: 'openai', secret: SECRET });
    assert.equal(out.ok, false);
    assert.equal(out.code, 'PROVIDER_REJECTED_KEY');
    assert.equal(storage.rows.size, 0, 'a rejected key must not be written');
    assert.equal(fetchImpl.calls.length, 1);
    assert.match(fetchImpl.calls[0].url, /^https:\/\/api\.openai\.com\/v1\/models$/);
    assert.equal(fetchImpl.calls[0].headers.authorization, `Bearer ${SECRET}`);
  });

  it('seals a verified key, never returns it, and reports the vendor-declared model', async () => {
    const storage = memoryStore();
    const keys = build({ storage });
    const out = await keys.connect({ owner: OWNER, providerId: 'openai', secret: SECRET });
    assert.equal(out.ok, true);
    assert.equal(out.provider.connected, true);
    assert.equal(out.provider.status, 'ACTIVE');
    assert.equal(out.provider.model, 'gpt-4o-mini-2024-07-18', 'model comes from the vendor list, not a stale pin');
    assert.equal(out.provider.hint, `••••${SECRET.slice(-4)}`);

    const serialized = JSON.stringify(out);
    assert.equal(serialized.includes(SECRET), false, 'secret must never leave the module');
    for (const value of storage.rows.values()) {
      assert.equal(String(value).includes(SECRET), false, 'stored blob must be sealed');
    }

    const listed = await keys.list({ owner: OWNER });
    assert.equal(listed.ok, true);
    const openai = listed.providers.find((p) => p.id === 'openai');
    assert.equal(openai.connected, true);
    assert.equal(openai.docsUrl, 'https://platform.openai.com/docs');
    assert.equal(openai.domainUse?.fa?.length > 10, true, 'domain copy is attached for the card');
    assert.equal(JSON.stringify(listed).includes(SECRET), false);
    /* Every connectable provider is listed, so the UI can draw the full set. */
    assert.deepEqual(listed.providers.map((p) => p.id).sort(), [...KEY_BRIDGE_IDS].sort());
  });

  it('is owner-scoped: another device sees nothing', async () => {
    const keys = build();
    await keys.connect({ owner: OWNER, providerId: 'openai', secret: SECRET });
    const other = await keys.list({ owner: OTHER });
    assert.equal(other.providers.find((p) => p.id === 'openai').connected, false);
    const ask = await keys.ask({ owner: OTHER, providerId: 'openai', question: 'ETH basis?' });
    assert.equal(ask.ok, false);
    assert.equal(ask.code, 'CREDENTIAL_NOT_FOUND');
  });

  it('needs the sealing key and a durable store', async () => {
    const noSeal = createProviderKeys({ env: {}, storage: memoryStore(), fetchImpl: fixtureFetch() });
    const a = await noSeal.connect({ owner: OWNER, providerId: 'openai', secret: SECRET });
    assert.equal(a.code, 'AGENT_HUB_SECRET_KEY_REQUIRED');

    const ephemeral = build({ storage: memoryStore({ isDurable: false }) });
    const b = await ephemeral.connect({ owner: OWNER, providerId: 'openai', secret: SECRET });
    assert.equal(b.code, 'CREDENTIAL_STORE_REQUIRED');
  });

  it('rejects a key shaped like header injection', async () => {
    const fetchImpl = fixtureFetch();
    const keys = build({ fetchImpl });
    const out = await keys.connect({ owner: OWNER, providerId: 'openai', secret: 'sk-abc\r\nx-evil: 1' });
    assert.equal(out.code, 'CREDENTIAL_SECRET_INVALID');
    assert.equal(fetchImpl.calls.length, 0);
  });
});

describe('BYO-key bridges — ask (two-way)', () => {
  it('runs one domain-scoped completion and returns the answer with attribution', async () => {
    const fetchImpl = fixtureFetch();
    const keys = build({ fetchImpl });
    await keys.connect({ owner: OWNER, providerId: 'openai', secret: SECRET });
    const out = await keys.ask({ owner: OWNER, providerId: 'openai', question: 'وضعیت بیسس ETH چطور است؟', context: 'ETH perp basis 0.4%' });
    assert.equal(out.ok, true);
    assert.match(out.answer, /basis/);
    assert.equal(out.attribution, 'OpenAI · gpt-4o-mini-2024-07-18');
    assert.equal(out.domain, 'crypto/defi/trading');

    const chat = fetchImpl.calls.at(-1);
    assert.equal(chat.method, 'POST');
    assert.match(chat.url, /^https:\/\/api\.openai\.com\/v1\/chat\/completions$/);
    const body = JSON.parse(chat.body);
    const system = body.messages.find((m) => m.role === 'system').content;
    assert.match(system, /crypto|DeFi/i, 'the bridge answers inside our domain, not as a generic chatbot');
    assert.match(body.messages.at(-1).content, /0\.4%/);
    assert.equal(JSON.stringify(out).includes(SECRET), false);
  });

  it('flags a key the vendor stops accepting, without deleting it', async () => {
    const storage = memoryStore();
    const keys = build({ storage });
    await keys.connect({ owner: OWNER, providerId: 'openai', secret: SECRET });
    const revoked = createProviderKeys({
      env: ENV,
      storage,
      fetchImpl: fixtureFetch({ chatStatus: 403 }),
      now: () => 1_700_000_000_000
    });
    const out = await revoked.ask({ owner: OWNER, providerId: 'openai', question: 'ETH basis?' });
    assert.equal(out.code, 'PROVIDER_REJECTED_KEY');
    const listed = await revoked.list({ owner: OWNER });
    const openai = listed.providers.find((p) => p.id === 'openai');
    assert.equal(openai.status, 'INVALID');
    assert.equal(openai.connected, false, 'an invalid seat must stop claiming it works');
    assert.equal(storage.rows.size > 0, true, 'the sealed key is kept so the user can rotate it');
  });

  it('rate-limits an owner instead of becoming a free proxy', async () => {
    const keys = build();
    await keys.connect({ owner: OWNER, providerId: 'openai', secret: SECRET });
    const results = [];
    for (let i = 0; i < 21; i += 1) results.push(await keys.ask({ owner: OWNER, providerId: 'openai', question: `q${i} ETH?` }));
    assert.equal(results.filter((r) => r.ok).length, 20);
    assert.equal(results.at(-1).code, 'RATE_LIMITED');
  });

  it('needs a real question', async () => {
    const keys = build();
    await keys.connect({ owner: OWNER, providerId: 'openai', secret: SECRET });
    const out = await keys.ask({ owner: OWNER, providerId: 'openai', question: ' ' });
    assert.equal(out.code, 'QUESTION_REQUIRED');
  });
});

describe('BYO-key bridges — catalog shape', () => {
  it('every bridge is https, constant, and has the docs a user needs', () => {
    for (const bridge of BRIDGES_INTERNAL_FOR_TESTS) {
      assert.match(bridge.baseUrl, /^https:\/\//, `${bridge.id} must be https`);
      assert.equal(typeof bridge.docsUrl, 'string');
      assert.equal(typeof bridge.keyUrl, 'string');
      assert.equal(typeof bridge.siteUrl, 'string');
      assert.equal(bridge.domainUse.fa.length > 10, true);
      if (bridge.kind === 'ai') {
        assert.ok(bridge.modelPreference.length > 0, `${bridge.id} needs a model preference order`);
        assert.equal(typeof bridge.protocol, 'string');
      } else {
        assert.equal(bridge.kind, 'data');
        const proofPath = bridge.probePath || bridge.probe?.path;
        assert.equal(typeof proofPath, 'string', `${bridge.id} needs its own proof read`);
        assert.equal(typeof bridge.proofLabel.fa, 'string');
        assert.equal(typeof bridge.check, 'function');
      }
      /* Every bridge is a card in the directory, so it must carry what a card
         renders: a category that exists in the chip list and a mark. */
      assert.ok(
        BRIDGE_CATEGORIES.some((category) => category.id === bridge.category && category.id !== 'all'),
        `${bridge.id} has an unknown category`
      );
      assert.equal(typeof bridge.mark, 'string');
    }
  });
});

describe('BYO-key bridges — data providers', () => {
  it('falls through to the vendor’s second host instead of calling a demo key invalid', async () => {
    const seen = [];
    const fetchImpl = async (url, init = {}) => {
      seen.push({ url: String(url), headers: init.headers || {} });
      if (String(url).startsWith('https://pro-api.coingecko.com')) {
        return { ok: false, status: 401, async text() { return JSON.stringify({ error: 'invalid key' }); } };
      }
      return { ok: true, status: 200, async text() { return JSON.stringify({ gecko_says: '(V3) To the Moon!' }); } };
    };
    const keys = createProviderKeys({ env: ENV, storage: memoryStore(), fetchImpl, now: () => 1_700_000_000_000 });
    const out = await keys.connect({ owner: OWNER, providerId: 'coingecko', secret: 'CG-demo-key-123456' });
    assert.equal(out.ok, true);
    assert.equal(out.provider.kind, 'data');
    assert.equal(out.provider.connected, true);
    assert.equal(out.provider.proof, '(V3) To the Moon!');
    assert.equal(seen.length, 2);
    assert.equal(seen[1].headers['x-cg-demo-api-key'], 'CG-demo-key-123456');
    assert.equal(JSON.stringify(out).includes('CG-demo-key-123456'), false);
  });

  it('refuses a chat request on a data seat instead of pretending', async () => {
    const keys = createProviderKeys({ env: ENV, storage: memoryStore(), fetchImpl: fixtureFetch(), now: () => 1_700_000_000_000 });
    const out = await keys.ask({ owner: OWNER, providerId: 'etherscan', question: 'ETH supply?' });
    assert.equal(out.code, 'PROVIDER_ASK_UNSUPPORTED');
  });

  it('treats an API-level rejection inside a 200 as a rejected key', async () => {
    const fetchImpl = async () => ({
      ok: true,
      status: 200,
      async text() { return JSON.stringify({ status: '0', message: 'NOTOK', result: 'Invalid API Key' }); }
    });
    const keys = createProviderKeys({ env: ENV, storage: memoryStore(), fetchImpl, now: () => 1_700_000_000_000 });
    const out = await keys.connect({ owner: OWNER, providerId: 'etherscan', secret: 'BADKEY123456' });
    assert.equal(out.ok, false);
    assert.equal(out.code, 'PROVIDER_REJECTED_KEY');
  });
});

describe('BYO-key bridges — JSON-RPC and URL-key providers', () => {
  it('sends a POST JSON-RPC probe with the key in the path, and never in a header', async () => {
    const calls = [];
    const fetchImpl = async (url, init = {}) => {
      calls.push({ url: String(url), method: init.method, headers: init.headers || {}, body: init.body || null });
      return { ok: true, status: 200, async text() { return JSON.stringify({ jsonrpc: '2.0', id: 1, result: '0x14a2b3c' }); } };
    };
    const keys = createProviderKeys({ env: ENV, storage: memoryStore(), fetchImpl, now: () => 1_700_000_000_000 });
    const out = await keys.connect({ owner: OWNER, providerId: 'alchemy', secret: 'alch_key_ABC123xyz' });
    assert.equal(out.ok, true);
    assert.equal(out.provider.proof, '0x14a2b3c');
    assert.equal(calls.length, 1);
    assert.equal(calls[0].method, 'POST');
    assert.match(calls[0].url, /^https:\/\/eth-mainnet\.g\.alchemy\.com\/v2\/alch_key_ABC123xyz$/);
    assert.equal(JSON.stringify(calls[0].headers).includes('alch_key_ABC123xyz'), false, 'a path key must not also be sent as a header');
    assert.equal(JSON.parse(calls[0].body).method, 'eth_blockNumber');
    assert.equal(JSON.stringify(out).includes('alch_key_ABC123xyz'), false);
  });

  it('treats a JSON-RPC error inside HTTP 200 as a rejected key', async () => {
    const fetchImpl = async () => ({
      ok: true,
      status: 200,
      async text() { return JSON.stringify({ jsonrpc: '2.0', id: 1, error: { code: -32600, message: 'invalid api key' } }); }
    });
    const keys = createProviderKeys({ env: ENV, storage: memoryStore(), fetchImpl, now: () => 1_700_000_000_000 });
    const out = await keys.connect({ owner: OWNER, providerId: 'helius', secret: 'helius-key-123456' });
    assert.equal(out.ok, false);
    assert.equal(out.code, 'PROVIDER_REJECTED_KEY');
  });

  it('puts a query-key provider\'s key in the URL, once', async () => {
    const calls = [];
    const fetchImpl = async (url, init = {}) => {
      calls.push({ url: String(url), method: init.method, headers: init.headers || {} });
      return { ok: true, status: 200, async text() { return JSON.stringify({ jsonrpc: '2.0', id: 1, result: 355000000 }); } };
    };
    const keys = createProviderKeys({ env: ENV, storage: memoryStore(), fetchImpl, now: () => 1_700_000_000_000 });
    const out = await keys.connect({ owner: OWNER, providerId: 'helius', secret: 'helius-key-123456' });
    assert.equal(out.ok, true);
    assert.equal(out.provider.proof, '355000000');
    assert.match(calls[0].url, /\?api-key=helius-key-123456$/);
    assert.equal(JSON.stringify(calls[0].headers).includes('helius-key'), false);
  });
});

describe('BYO-key bridges — a moved probe path is not a bad key', () => {
  it('reports PROVIDER_ENDPOINT_MISSING on 404 instead of blaming the key', async () => {
    const fetchImpl = async () => ({ ok: false, status: 404, async text() { return '{"error":"not found"}'; } });
    const storage = memoryStore();
    const keys = createProviderKeys({ env: ENV, storage, fetchImpl, now: () => 1_700_000_000_000 });
    const out = await keys.connect({ owner: OWNER, providerId: 'moralis', secret: 'moralis-key-123456' });
    assert.equal(out.ok, false);
    assert.equal(out.code, 'PROVIDER_ENDPOINT_MISSING');
    assert.equal(storage.rows.size, 0);
  });
});
