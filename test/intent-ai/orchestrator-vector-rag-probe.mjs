#!/usr/bin/env node
/**
 * FBT AI ORCHESTRATOR — VECTOR MEMORY + RAG probe (Upgrade 14)
 * ────────────────────────────────────────────────────────────────────────────
 * The Qdrant-shaped store and the RAG memory that sits on it, asserted without
 * a server and without a network:
 *
 *   · embeddings are deterministic, normalised and actually discriminating
 *     (a Persian product question lands nearer the FBT knowledge passage about
 *     that product than an unrelated one);
 *   · the collection API behaves like the Qdrant subset callers use
 *     (upsert / search / delete / count / filters / export-import);
 *   · filters fail closed — an unsupported condition does not match, so a
 *     filter bug can never leak another owner's memory into a prompt;
 *   · the remote Qdrant backend speaks the real REST shape (verified against a
 *     mock fetch: collection PUT, points PUT with UUID ids, search POST with
 *     the mapped filter, api-key header) and DEGRADES to the embedded mirror
 *     when the remote is down;
 *   · the RAG layer indexes the verified corpus once, cites what it returns,
 *     keeps memory owner-scoped, dedupes near-identical turns, prunes to the
 *     per-owner cap, and refuses to store anything credential-shaped.
 */
import assert from 'node:assert/strict';
import {
  createVectorStore, createLocalBackend, createQdrantBackend,
  embedText, cosine, tokenize, matchesFilter, qdrantId, VECTOR_SCHEMA
} from '../../src/lib/intent-ai/orchestrator/vectorStore.js';
import { createRagMemory, COLLECTIONS, RAG_SCHEMA } from '../../src/lib/intent-ai/orchestrator/ragMemory.js';

let passed = 0;
let total = 0;
const test = async (name, fn) => {
  total += 1;
  try { await fn(); passed += 1; console.log(`  ✓ ${name}`); }
  catch (err) { console.error(`  ✗ ${name}\n    ${err.message}`); }
};

console.log('\n=== FBT AI ORCHESTRATOR — vector memory + RAG probe ===\n');

const localRag = () => createRagMemory({ store: createVectorStore({ mode: 'local', dim: 256 }) });

async function runAll() {
  await test('embeddings are deterministic, normalised and Persian-aware', () => {
    const a = embedText('کیف پول غیرامانی FBT');
    const b = embedText('کیف پول غیرامانی FBT');
    assert.deepEqual(Array.from(a), Array.from(b), 'same text, same vector');
    assert.ok(Math.abs(cosine(a, a) - 1) < 1e-6, 'self-similarity is 1');

    const q = tokenize('کیف‌پول');
    assert.ok(q.includes('کیفپول') || q.includes('کیف') , `normalisation should strip ZWNJ: ${q.join('|')}`);
    assert.ok(tokenize('۱۴۰٬۰۰۰ تومان').some((t) => t.includes('140')), 'Persian digits become ASCII');
  });

  await test('related text scores higher than unrelated text', () => {
    const query = embedText('کارمزد سواپ چقدر است');
    const near = embedText('هزینه و کارمزد معامله در سواپ چقدر است');
    const far = embedText('هواشناسی فردا بارانی است');
    assert.ok(cosine(query, near) > cosine(query, far) + 0.05, `near ${cosine(query, near)} vs far ${cosine(query, far)}`);
  });

  await test('local backend: upsert, search ordering, limit and threshold', async () => {
    const store = createLocalBackend({ dim: 128 });
    await store.createCollection('t', { size: 128 });
    store.upsert('t', [
      { id: 'k1', text: 'بازده استیکینگ اتریوم چقدر است', payload: { kind: 'yield', n: 1 } },
      { id: 'k2', text: 'کارمزد شبکه برای انتقال توکن', payload: { kind: 'fee', n: 2 } },
      { id: 'k3', text: 'امنیت کیف پول و عبارت بازیابی', payload: { kind: 'security', n: 3 } }
    ]);
    const hit = store.search('t', { text: 'بازده استیکینگ', limit: 2 });
    assert.equal(hit.rows[0].id, 'k1');
    assert.ok(hit.rows.length <= 2 && hit.rows.length >= 1);
    assert.ok(hit.rows.every((r) => r.score > 0), 'a non-positive cosine is not a match');
    const full = store.search('t', { text: 'بازده استیکینگ', limit: 3, scoreThreshold: -1 });
    assert.equal(full.rows.length, 3, 'an explicit negative threshold keeps the whole tail');
    const filtered = store.search('t', { text: 'کارمزد', limit: 3, filter: { must: [{ key: 'kind', match: 'fee' }] } });
    assert.deepEqual(filtered.rows.map((r) => r.id), ['k2']);
    const thresholded = store.search('t', { text: 'هواشناسی', limit: 3, scoreThreshold: 0.9 });
    assert.equal(thresholded.rows.length, 0);
    const noPayload = store.search('t', { text: 'کارمزد', limit: 1, withPayload: false });
    assert.equal(noPayload.rows[0].payload, undefined);
    assert.equal(store.count('t').count, 3);
    assert.equal(store.delete('t', ['k2']).removed, 1);
    assert.equal(store.count('t').count, 2);
    assert.equal(store.listCollections().find((c) => c.name === 't').points, 2);
  });

  await test('filters fail closed and support range/contains/must_not', () => {
    const payload = { owner: 'dev:a', kind: 'turn', score: 7, text: 'بازده استیکینگ' };
    assert.equal(matchesFilter(payload, { must: [{ key: 'owner', match: 'dev:a' }] }), true);
    assert.equal(matchesFilter(payload, { must: [{ key: 'owner', match: 'dev:b' }] }), false);
    assert.equal(matchesFilter(payload, { must_not: [{ key: 'kind', match: 'turn' }] }), false);
    assert.equal(matchesFilter(payload, { should: [{ key: 'kind', match: 'turn' }, { key: 'kind', match: 'x' }] }), true);
    assert.equal(matchesFilter(payload, { must: [{ key: 'score', range: { gte: 5, lt: 10 } }] }), true);
    assert.equal(matchesFilter(payload, { must: [{ key: 'score', range: { gt: 8 } }] }), false);
    assert.equal(matchesFilter(payload, { must: [{ key: 'text', contains: 'استیکینگ' }] }), true);
    /* An unsupported/!missing condition must NOT match — a filter bug cannot
       become a data leak. */
    assert.equal(matchesFilter(payload, { must: [{ key: 'owner' }] }), false);
    assert.equal(matchesFilter(payload, { must: ['not an object'] }), false);
    assert.equal(matchesFilter(payload, null), true);
  });

  await test('state can be exported and imported without losing a point', async () => {
    const store = createLocalBackend({ dim: 64 });
    await store.createCollection('mem', { size: 64 });
    store.upsert('mem', [{ id: 'p1', text: 'سلام دنیا', payload: { owner: 'dev:a' } }]);
    const state = store.exportState();
    assert.equal(state.schema, VECTOR_SCHEMA);
    const restored = createLocalBackend({ dim: 64 });
    assert.equal(restored.importState(state).ok, true);
    const hit = restored.search('mem', { text: 'سلام دنیا', limit: 1 });
    assert.equal(hit.rows[0].id, 'p1');
    assert.equal(restored.importState({ schema: 'bogus' }).ok, false, 'a foreign state is refused');
  });

  await test('remote Qdrant backend speaks the real REST shape', async () => {
    const calls = [];
    const fetchImpl = async (url, init = {}) => {
      calls.push({ url, method: init.method || 'GET', body: init.body ? JSON.parse(init.body) : null, headers: init.headers });
      if (url.endsWith('/points/search')) {
        return {
          ok: true,
          text: async () => JSON.stringify({ result: [{ id: 'uuid-1', score: 0.81, payload: { _fbt_id: 'kb.kb.wallet.custody', kind: 'knowledge' } }] })
        };
      }
      if (url.includes('/points/count')) return { ok: true, text: async () => JSON.stringify({ result: { count: 42 } }) };
      if (url.endsWith('/collections')) return { ok: true, text: async () => JSON.stringify({ result: { collections: [{ name: 'fbt_knowledge' }] } }) };
      return { ok: true, text: async () => JSON.stringify({ result: true, status: 'ok' }) };
    };
    const q = createQdrantBackend({ url: 'https://qdrant.example', apiKey: 'secret-key', dim: 256, fetchImpl });
    await q.createCollection('fbt_knowledge', { size: 256, distance: 'Cosine' });
    const created = calls.find((c) => c.method === 'PUT' && c.url === 'https://qdrant.example/collections/fbt_knowledge');
    assert.deepEqual(created.body, { vectors: { size: 256, distance: 'Cosine' } });
    assert.equal(created.headers['api-key'], 'secret-key');

    await q.upsert('fbt_knowledge', [{ id: 'kb.wallet.custody', text: 'کیف پول غیرامانی', payload: { kind: 'knowledge' } }]);
    const upsert = calls.find((c) => c.url.includes('/points?wait=true'));
    assert.match(upsert.body.points[0].id, /^[0-9a-f-]{36}$/, 'remote ids must be UUIDs');
    assert.equal(upsert.body.points[0].payload._fbt_id, 'kb.wallet.custody');
    assert.equal(upsert.body.points[0].vector.length, 256);

    const res = await q.search('fbt_knowledge', {
      text: 'کیف پول', limit: 3,
      filter: { must: [{ key: 'owner', match: 'dev:a' }], must_not: [{ key: 'kind', match: 'memory' }] }
    });
    const search = calls.find((c) => c.url.endsWith('/points/search'));
    assert.equal(search.body.limit, 3);
    assert.equal(search.body.with_payload, true);
    assert.deepEqual(search.body.filter, {
      must: [{ key: 'owner', match: { value: 'dev:a' } }],
      must_not: [{ key: 'kind', match: { value: 'memory' } }]
    });
    assert.equal(res.rows[0].id, 'kb.kb.wallet.custody', 'the app id travels back through _fbt_id');
    assert.equal(await q.count('fbt_knowledge').then((c) => c.count), 42);
    assert.equal(qdrantId('kb.x'), qdrantId('kb.x'), 'id mapping is deterministic');
  });

  await test('auto mode degrades to the embedded mirror when Qdrant is unreachable', async () => {
    const failing = async () => { throw new Error('ECONNREFUSED'); };
    const store = createVectorStore({ mode: 'qdrant', dim: 128, qdrant: { url: 'https://qdrant.down', fetchImpl: failing } });
    await store.createCollection('fbt_knowledge', { size: 128 });
    const write = await store.upsert('fbt_knowledge', [{ id: 'kb.1', text: 'دانش FBT', payload: { kind: 'knowledge' } }]);
    assert.equal(write.degraded, true);
    const hit = await store.search('fbt_knowledge', { text: 'دانش FBT', limit: 1 });
    assert.equal(hit.rows[0].id, 'kb.1', 'the mirror still answers');
    assert.equal(store.degraded, true);
    assert.match(String(store.lastError), /ECONNREFUSED/);
  });

  await test('RAG indexes the verified corpus once and cites what it returns', async () => {
    const rag = localRag();
    const first = await rag.indexKnowledge();
    assert.equal(first.ok, true);
    assert.ok(first.points >= 40, `expected the knowledge base + FAQ corpus, got ${first.points}`);
    const second = await rag.indexKnowledge();
    assert.equal(second.skipped, true, 'indexing is idempotent');

    const recall = await rag.recall({ query: 'کارمزد سواپ در FBT چقدر است؟', locale: 'fa', limit: 3 });
    assert.equal(recall.ok, true);
    assert.equal(recall.schema, RAG_SCHEMA);
    assert.ok(recall.passages.length >= 1);
    assert.ok(recall.passages.every((p) => p.cite && p.id), 'every passage carries a citation');
    assert.ok(recall.passages.every((p) => p.signals && typeof p.signals.vector === 'number'));
    assert.ok(recall.passages.every((p) => p.score >= 0.18), 'below the floor, noise is dropped');
    assert.ok(recall.sources.length === recall.passages.length);
  });

  await test('a wallet-safety question finds the security passage', async () => {
    const rag = localRag();
    const recall = await rag.recall({ query: 'آیا FBT عبارت بازیابی من را می‌پرسد؟', locale: 'fa', limit: 3 });
    const cites = recall.passages.map((p) => p.cite).join(' ');
    assert.match(cites, /never-asks|security|wallet/i, `expected a wallet/security passage, got ${cites}`);
  });

  await test('memory is owner-scoped and another owner never sees it', async () => {
    const rag = localRag();
    await rag.remember({ owner: 'dev:alice', question: 'طلا بخرم؟', answer: 'بستگی به افق زمانی دارد.', intentType: 'GENERAL', at: 1_700_000_000_000 });
    const mine = await rag.recall({ query: 'طلا بخرم', owner: 'dev:alice', limit: 5, kinds: ['memory'] });
    assert.ok(mine.passages.some((p) => p.kind === 'memory'), 'alice finds her own memory');
    const theirs = await rag.recall({ query: 'طلا بخرم', owner: 'dev:bob', limit: 5, kinds: ['memory'] });
    assert.equal(theirs.passages.filter((p) => p.kind === 'memory').length, 0, 'bob must not see alice’s memory');
  });

  await test('near-identical turns are deduped instead of filling the collection', async () => {
    const rag = localRag();
    const one = await rag.remember({ owner: 'dev:a', question: 'قیمت BTC چنده؟', answer: 'قیمت لحظه‌ای BTC از فید بازار خوانده می‌شود.', at: 1 });
    const two = await rag.remember({ owner: 'dev:a', question: 'قیمت BTC چنده؟', answer: 'قیمت لحظه‌ای BTC از فید بازار خوانده می‌شود.', at: 2 });
    assert.equal(one.deduped, false);
    assert.equal(two.deduped, true, 'the same turn twice is one memory');
    const stats = await rag.stats();
    assert.equal(stats.memoryPoints, 1);
    assert.equal(stats.counters.dedupes, 1);
  });

  await test('per-owner memory is capped, oldest pruned first', async () => {
    const rag = createRagMemory({ store: createVectorStore({ mode: 'local', dim: 128 }), maxMemoryPerOwner: 3 });
    for (let i = 0; i < 5; i += 1) {
      await rag.remember({
        owner: 'dev:a', id: `mem:${i}`, at: 1000 + i,
        question: `پرسش شماره ${i} دربارهٔ بازار`, answer: `پاسخ متفاوت شماره ${i} با جزئیات ${i}`
      });
    }
    const stats = await rag.stats();
    assert.equal(stats.memoryPoints, 3, 'cap enforced');
    assert.equal(stats.counters.pruned, 2);
  });

  await test('credentials are refused by memory, never stored', async () => {
    const rag = localRag();
    const refused = await rag.remember({
      owner: 'dev:a',
      question: 'عبارت بازیابی من: abandon ability able about above absent absorb abstract absurd abuse access accident',
      answer: 'ok'
    });
    assert.equal(refused.ok, false);
    assert.equal(refused.error, 'SENSITIVE_CONTENT_REFUSED');
    const stats = await rag.stats();
    assert.equal(stats.memoryPoints, 0);
  });

  await test('an empty query is refused rather than returning noise', async () => {
    const rag = localRag();
    const out = await rag.recall({ query: '   ', limit: 3 });
    assert.equal(out.ok, false);
    assert.equal(out.error, 'QUERY_REQUIRED');
    assert.deepEqual(out.passages, []);
  });

  await test('memory survives export/import (the persistence path used by the server)', async () => {
    const rag = localRag();
    await rag.remember({ owner: 'dev:a', id: 'mem:x', at: 5, question: 'سؤال قدیمی', answer: 'پاسخ قدیمی دربارهٔ سود' });
    const state = rag.exportState();
    const restored = localRag();
    assert.equal((await restored.importState(state)).ok, true);
    const hit = await restored.recall({ query: 'سؤال قدیمی', owner: 'dev:a', kinds: ['memory'], limit: 3 });
    assert.equal(hit.passages[0].id, 'mem:x');
  });

  console.log(`\n=== VECTOR + RAG PROBE: ${passed}/${total} passed ===\n`);
  if (passed !== total) process.exit(1);
}

runAll().catch((err) => { console.error(`\nVECTOR/RAG PROBE FAILED: ${err.message}\n`); process.exit(1); });
