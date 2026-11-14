/* The Qdrant Cloud path, exercised against a server that speaks the real
 * protocol.
 *
 * The deployment points at a Qdrant Cloud cluster. That cluster is reachable
 * from the production network and not from the development sandbox, so the
 * only honest way to prove the wiring is to run the store against a mock
 * that implements the same paths, verbs, bodies, response shapes and error
 * codes — and to make the store's own maths do the scoring.
 *
 * If the store sends a wrong request, the mock rejects it the way Qdrant
 * would and this fails.
 */
import { strict as assert } from 'node:assert';
import test from 'node:test';
import { startQdrantMock } from './qdrant-cloud-mock.mjs';
import { createVectorStore } from '../../src/lib/intent-ai/orchestrator/vectorStore.js';

const DIM = 384;

test('the Qdrant backend creates, indexes, upserts, searches, scrolls and deletes', async () => {
  const mock = await startQdrantMock();
  try {
    const store = createVectorStore({
      mode: 'qdrant',
      dim: DIM,
      qdrant: { url: mock.url, apiKey: mock.apiKey }
    });

    /* 1. A collection that does not exist yet must not be reported as a
          failure of the STORE — only of the collection. */
    const missing = await store.count('kb');
    assert.equal(missing.ok, false);
    assert.equal(missing.error, 'COLLECTION_NOT_FOUND');
    assert.equal(store.degraded, false, 'a missing collection must not degrade the store');

    /* 2. Creating a collection twice is idempotent. */
    const first = await store.createCollection('kb', { dim: DIM });
    assert.equal(first.ok, true);
    assert.equal(first.dim, DIM);
    const second = await store.createCollection('kb', { dim: DIM });
    assert.equal(second.ok, true);
    assert.equal(second.alreadyExisted, true);

    /* 3. Upsert bilingual semantic points. */
    const up = await store.upsert('kb', [
      { id: 'kb:user:wallet', text: 'کلید خصوصی من کجا نگهداری می شود', payload: { owner: 'user1', kind: 'kb', at: 1 } },
      { id: 'kb:user:fee', text: 'کارمزد پلتفرم FBT چقدر است', payload: { owner: 'user1', kind: 'kb', at: 2 } },
      { id: 'kb:other:secret', text: 'preference of another user', payload: { owner: 'user2', kind: 'kb', at: 3 } }
    ]);
    assert.equal(up.ok, true);
    assert.equal(up.written, 3);

    /* 4. The search must be OWNER-ISOLATED. A vector store that leaks one
          user's rows into another's answer is a privacy defect, not a
          ranking quirk. */
    const search = await store.search('kb', {
      query: 'کارمزد پلتفرم چقدر است',
      limit: 3,
      filter: { must: [{ key: 'owner', match: 'user1' }] }
    });
    assert.equal(search.ok, true);
    assert.ok(search.rows.length >= 1);
    assert.ok(search.rows.every((r) => r.payload?.owner === 'user1'), 'no cross-owner leak');
    assert.equal(search.rows[0].id, 'kb:user:fee', 'the fee row is the right answer');

    /* 5. Scroll paginates the owner's rows. */
    const scrolled = await store.scroll('kb', {
      filter: { must: [{ key: 'owner', match: 'user1' }] },
      limit: 10
    });
    assert.equal(scrolled.ok, true);
    assert.equal(scrolled.points.length, 2);

    /* 6. Delete by filter removes exactly the other owner's rows. */
    await store.deleteByFilter('kb', { must: [{ key: 'owner', match: 'user2' }] });
    const after = await store.count('kb');
    assert.equal(after.count, 2);

    /* 7. The store is healthy — no degradation happened along the way. */
    assert.equal(store.degraded, false, `store degraded: ${store.lastError}`);
  } finally {
    await mock.close();
  }
});

test('the Qdrant backend falls back to the local mirror when the cluster is unreachable', async () => {
  /* A cluster that refuses every connection is the failure the deployment
     must survive: the answer must still arrive, from the mirror, and the
     store must SAY it is degraded rather than pretend it is fine. */
  const store = createVectorStore({
    mode: 'qdrant',
    dim: DIM,
    qdrant: {
      url: 'http://127.0.0.1:1',   /* nothing listens here */
      apiKey: 'test-only-qdrant-key',
      fetchImpl: async () => { throw new Error('ECONNREFUSED'); }
    }
  });

  const created = await store.createCollection('kb', { dim: DIM });
  assert.equal(created.ok, true, 'the local mirror must accept the collection');

  const up = await store.upsert('kb', [
    { id: 'kb:1', text: 'یک سند', payload: { owner: 'user1', kind: 'kb' } }
  ]);
  assert.equal(up.ok, true);

  const search = await store.search('kb', { query: 'سند', limit: 3 });
  assert.equal(search.ok, true, 'the mirror must answer when the cluster is down');
  assert.ok(search.rows.length >= 1);
  assert.equal(store.degraded, true, 'the store must report the outage honestly');
});

test('a collection survives a second store instance against the same cluster', async () => {
  /* This is the whole point of the remote cluster: the index is built ONCE
     and every cold start after that reuses it, instead of rebuilding it
     from the persisted rows in every serverless invocation. */
  const mock = await startQdrantMock();
  try {
    const first = createVectorStore({
      mode: 'qdrant', dim: DIM,
      qdrant: { url: mock.url, apiKey: mock.apiKey }
    });
    await first.createCollection('kb', { dim: DIM });
    await first.upsert('kb', [{ id: 'kb:1', text: 'ماندگاری بین دو نمونه', payload: { owner: 'user1', kind: 'kb' } }]);

    /* A brand new store — a cold start — finds the collection already there. */
    const second = createVectorStore({
      mode: 'qdrant', dim: DIM,
      qdrant: { url: mock.url, apiKey: mock.apiKey }
    });
    const created = await second.createCollection('kb', { dim: DIM });
    assert.equal(created.alreadyExisted, true, 'the cluster must remember the collection');
    const search = await second.search('kb', { query: 'ماندگاری', limit: 3 });
    assert.equal(search.ok, true);
    assert.equal(search.rows[0].id, 'kb:1', 'a cold start must see the rows the last one wrote');
  } finally {
    await mock.close();
  }
});

test('a wrong api-key degrades the store and says so, without losing the answer', async () => {
  /* The cluster rejects the key. The store must then do TWO things at once:
     keep serving the answer from the local mirror, AND report that it is
     degraded — because a silently-working store on a broken cluster is how
     an operator finds out from a user instead of from a dashboard. */
  const mock = await startQdrantMock();
  try {
    const store = createVectorStore({
      mode: 'qdrant', dim: DIM,
      qdrant: { url: mock.url, apiKey: 'wrong-key' }
    });
    const res = await store.createCollection('kb', { dim: DIM });
    assert.equal(res.ok, true, 'the mirror must still answer');
    assert.equal(res.backend, 'local-mirror', 'and it must say the answer came from the mirror');
    assert.equal(res.degraded, true, 'and the store must report the outage');
    assert.equal(store.degraded, true);
    assert.match(String(store.lastError), /403/);

    /* And the mirror really holds the rows. */
    const search = await store.search('kb', { query: 'هرچیز', limit: 3 });
    assert.equal(search.ok, true);
  } finally {
    await mock.close();
  }
});
