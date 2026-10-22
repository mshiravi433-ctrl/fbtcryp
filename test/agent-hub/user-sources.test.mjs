#!/usr/bin/env node
/**
 * EXTERNAL AGENT HUB — user-supplied sources (unit tests).
 * ---------------------------------------------------------------------------
 * This file exists because the add-source form is the ONE place a user types a
 * URL that the server will then call. Everything that makes that safe is
 * checked here without a network:
 *
 *   · the address itself (scheme, address literal, private name, credentials,
 *     query string, port) — the same rules `httpSafe.js` applies to a
 *     registry provider, applied to a destination nobody reviewed;
 *   · the RPC endpoint taken from the card: same host only, and no invented
 *     endpoint when the card declares none from a non-conventional path;
 *   · the row lifecycle: verified before it is stored, idempotent by URL,
 *     capped per owner, owner-scoped on delete;
 *   · the negative case: a card that is not a card is refused and leaves
 *     nothing behind.
 *
 * The fetch is injected, so "the provider answered" is a fixture and the code
 * under test is the real one.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  createUserAgentSources,
  rpcUrlFromCard,
  sourceIdFor,
  validateCardUrl
} from '../../server/agentHub/userAgents.js';
import { createHubStore } from '../../server/agentHub/store.js';

const CARD = {
  name: 'Fixture Research Agent',
  description: 'A fixture card.',
  version: '1.0.0',
  protocolVersion: '0.3.0',
  url: 'https://agent.example.com/rpc',
  skills: [
    { id: 'research', name: 'Research', description: 'Looks things up.', tags: ['research'] },
    { id: 'risk', name: 'Risk', description: 'Reads a public address.' }
  ]
};

const okRequest = (card = CARD) => async () => ({ ok: true, status: 200, json: card, bytes: 100 });

const makeSources = (overrides = {}) => createUserAgentSources({
  store: createHubStore({}),
  env: {},
  now: () => 1_700_000_000_000,
  request: okRequest(),
  ...overrides
});

let ownerSeq = 0;
const nextOwner = () => `dev:unit-${++ownerSeq}`;

describe('card URL validation', () => {
  it('accepts a normal https card URL on port 443', () => {
    const out = validateCardUrl('https://agent.example.com/.well-known/agent-card.json', { env: {} });
    assert.equal(out.ok, true);
    assert.equal(out.host, 'agent.example.com');
  });

  const refused = [
    ['http://agent.example.com/card', 'PROVIDER_URL_NOT_HTTPS'],
    ['https://127.0.0.1/card', 'PROVIDER_URL_IS_IP'],
    ['https://[::1]/card', 'PROVIDER_URL_IS_IP'],
    ['https://metadata.google.internal/card', 'PROVIDER_URL_PRIVATE_HOST'],
    ['https://printer.local/card', 'PROVIDER_URL_PRIVATE_HOST'],
    ['https://user:secret@agent.example.com/card', 'PROVIDER_URL_HAS_CREDENTIALS'],
    ['https://agent.example.com/card?api_key=abc', 'PROVIDER_URL_HAS_QUERY'],
    ['https://agent.example.com:8443/card', 'PROVIDER_URL_NONSTANDARD_PORT'],
    ['not-a-url', 'SOURCE_URL_INVALID'],
    ['', 'SOURCE_URL_INVALID']
  ];
  for (const [url, code] of refused) {
    it(`refuses ${url || '(empty)'} with ${code}`, () => {
      const out = validateCardUrl(url, { env: {} });
      assert.equal(out.ok, false);
      assert.equal(out.code, code);
    });
  }

  it('allows loopback ONLY with the explicit dev flag outside production', () => {
    assert.equal(validateCardUrl('http://127.0.0.1:1234/card', { env: {} }).ok, false);
    assert.equal(validateCardUrl('http://127.0.0.1:1234/card', { env: { AGENT_HUB_ALLOW_LOOPBACK: '1', NODE_ENV: 'test' } }).ok, true);
    assert.equal(validateCardUrl('http://127.0.0.1:1234/card', { env: { AGENT_HUB_ALLOW_LOOPBACK: '1', NODE_ENV: 'production' } }).ok, false);
  });
});

describe('RPC endpoint from the card', () => {
  const cardUrl = 'https://agent.example.com/.well-known/agent-card.json';

  it('uses the card’s own url when it is on the same host', () => {
    assert.equal(rpcUrlFromCard(CARD, cardUrl, { env: {} }), 'https://agent.example.com/rpc');
  });

  it('refuses an endpoint on a different host', () => {
    const cross = { ...CARD, url: 'https://collector.evil.example/rpc' };
    assert.equal(rpcUrlFromCard(cross, cardUrl, { env: {} }), null);
  });

  it('falls back to the origin only for a conventional discovery path', () => {
    const noUrl = { ...CARD, url: undefined };
    assert.equal(rpcUrlFromCard(noUrl, cardUrl, { env: {} }), 'https://agent.example.com/');
    assert.equal(rpcUrlFromCard(noUrl, 'https://agent.example.com/some/deep/page', { env: {} }), null);
  });
});

describe('source rows', () => {
  it('stores a verified card, scoped to the owner, and lists it as the user’s', async () => {
    const sources = makeSources();
    const owner = nextOwner();
    const added = await sources.add({ owner, cardUrl: 'https://agent.example.com/.well-known/agent-card.json', label: 'Mine' });
    assert.equal(added.ok, true);
    assert.equal(added.source.card.name, 'Fixture Research Agent');
    assert.equal(added.source.status, 'ACTIVE');
    assert.equal(added.source.id, sourceIdFor(owner, added.source.cardUrl));

    const listed = await sources.list({ owner });
    assert.equal(listed.sources.length, 1);
    assert.equal(listed.sources[0].source, 'user');

    const provider = await sources.providerFor({ owner, providerId: added.source.id });
    assert.equal(provider.integrationType, 'A2A');
    assert.equal(provider.accessModel, 'USER_SUPPLIED');
    assert.deepEqual(provider.allowedHosts, ['agent.example.com']);
    assert.equal(provider.rpcUrl, 'https://agent.example.com/rpc');
    assert.equal(sources.publicView(provider).source, 'user');

    /* Another owner sees nothing, and cannot resolve the provider. */
    const other = nextOwner();
    assert.equal((await sources.list({ owner: other })).sources.length, 0);
    assert.equal(await sources.providerFor({ owner: other, providerId: added.source.id }), null);
  });

  it('never stores a card that could not be fetched or is not a card', async () => {
    const owner = nextOwner();
    const unreachable = makeSources({ request: async () => ({ ok: false, code: 'PROVIDER_TIMEOUT' }) });
    const failed = await unreachable.add({ owner, cardUrl: 'https://agent.example.com/card' });
    assert.equal(failed.ok, false);
    assert.equal(failed.code, 'SOURCE_CARD_UNREACHABLE');
    assert.equal((await unreachable.list({ owner })).sources.length, 0);

    const notACard = makeSources({ request: okRequest({ description: 'no name here' }) });
    const invalid = await notACard.add({ owner, cardUrl: 'https://agent.example.com/card' });
    assert.equal(invalid.ok, false);
    assert.equal(invalid.code, 'SOURCE_CARD_INVALID');
    assert.equal((await notACard.list({ owner })).sources.length, 0);
  });

  it('is idempotent by URL instead of duplicating a row', async () => {
    const sources = makeSources();
    const owner = nextOwner();
    const first = await sources.add({ owner, cardUrl: 'https://agent.example.com/card' });
    const second = await sources.add({ owner, cardUrl: 'https://agent.example.com/card' });
    assert.equal(first.ok, true);
    assert.equal(second.ok, true);
    assert.equal(second.existing, true);
    const listed = await sources.list({ owner });
    assert.equal(listed.sources.length, 1);
  });

  it('caps how many sources one owner can add', async () => {
    const sources = makeSources();
    const owner = nextOwner();
    for (let i = 0; i < sources.cap; i += 1) {
      const out = await sources.add({ owner, cardUrl: `https://agent${i}.example.com/card` });
      assert.equal(out.ok, true);
    }
    const overCap = await sources.add({ owner, cardUrl: 'https://one-too-many.example.com/card' });
    assert.equal(overCap.ok, false);
    assert.equal(overCap.code, 'SOURCE_LIMIT_REACHED');
  });

  it('rate-limits a burst of attempts, per owner', async () => {
    /* A failing card costs a real outbound request, so attempts — not just
       stored rows — are what the window counts. */
    const failing = makeSources({ request: async () => ({ ok: false, code: 'PROVIDER_TIMEOUT' }) });
    const owner = nextOwner();
    const codes = [];
    for (let i = 0; i < 14; i += 1) {
      const out = await failing.add({ owner, cardUrl: `https://burst${i}.example.com/card` });
      codes.push(out.code || 'ok');
    }
    assert.ok(codes.slice(0, 12).every((code) => code === 'SOURCE_CARD_UNREACHABLE'), codes.join(','));
    assert.ok(codes.includes('SOURCE_RATE_LIMITED'), codes.join(','));
    /* A different owner is not affected by that burst. */
    const other = await makeSources().add({ owner: nextOwner(), cardUrl: 'https://fresh.example.com/card' });
    assert.equal(other.ok, true);
  });

  it('deletes only for the owner, and a removed source stays removed', async () => {
    const sources = makeSources();
    const owner = nextOwner();
    const added = await sources.add({ owner, cardUrl: 'https://agent.example.com/card' });

    const foreign = await sources.remove({ owner: nextOwner(), sourceId: added.source.id });
    assert.equal(foreign.ok, false);
    assert.equal(foreign.code, 'SOURCE_NOT_FOUND');

    const removed = await sources.remove({ owner, sourceId: added.source.id });
    assert.equal(removed.ok, true);
    assert.equal((await sources.list({ owner })).sources.length, 0);
    assert.equal(await sources.providerFor({ owner, providerId: added.source.id }), null);
    assert.equal((await sources.remove({ owner, sourceId: added.source.id })).code, 'SOURCE_NOT_FOUND');
  });
});
