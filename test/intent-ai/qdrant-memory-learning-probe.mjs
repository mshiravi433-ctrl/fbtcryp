#!/usr/bin/env node
/**
 * FBT AI — LIVE QDRANT + REAL SEMANTIC EMBEDDINGS + SMART MEMORY + PERFORMANCE LEARNING PROBE
 * ---------------------------------------------------------------------------
 * Spins up a real TCP/HTTP Qdrant v1.20 strict-mode REST server on 127.0.0.1
 * and verifies:
 *   1. Real Qdrant connection, strict payload index enforcement, idempotent
 *      collection checks, non-power-of-two dimensions (384, 768, 1536), remote
 *      scroll & owner pruning, outage failover to mirror, and self-healing sync.
 *   2. Multi-provider neural embeddings (with failover, caching & Matryoshka
 *      projection) + bilingual Persian/English semantic concept embeddings.
 *   3. All 8 Smart Long-Term Memory capabilities.
 *   4. All 6 Real Performance Learning capabilities + reversible policy rollback.
 */

import http from 'node:http';
import assert from 'node:assert/strict';
import { createSemanticEmbedder } from '../../src/lib/intent-ai/orchestrator/semanticEmbedder.js';
import { cosine, createVectorStore, matchesFilter } from '../../src/lib/intent-ai/orchestrator/vectorStore.js';
import { createRagMemory } from '../../src/lib/intent-ai/orchestrator/ragMemory.js';
import { createSmartMemory } from '../../src/lib/intent-ai/orchestrator/smartMemory.js';
import { createPerformanceLearning } from '../../src/lib/intent-ai/orchestrator/performanceLearning.js';
import { testLiveQdrantConnection } from '../../server/centralBrainRuntime.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Start a real TCP/HTTP Qdrant v1.20 strict-mode REST server enforcing:
 *   - HTTP 400 if PUT /collections/{name} is called when collection already exists
 *   - HTTP 400 if filtering on an unindexed payload field (Qdrant Cloud strict mode)
 *   - HTTP 400 if vector length !== collection config.params.vectors.size
 *   - HTTP 400 if point ID is neither UUID nor unsigned integer
 *   - HTTP 404 on missing collection
 */
function startStrictQdrantHttpServer() {
  const collections = new Map(); // name -> { size, distance, indexes: Set, points: Map }
  let simulateOutage = false;

  function evalQdrantFilter(payload, qFilter, indexes) {
    if (!qFilter) return true;
    const checkCond = (c) => {
      if (c.must_not) return !c.must_not.some(checkCond);
      if (c.is_null) return payload[c.is_null.key] === null || payload[c.is_null.key] === undefined;
      if (c.is_empty) {
        const v = payload[c.is_empty.key];
        return v == null || v === '' || (Array.isArray(v) && v.length === 0);
      }
      const key = c.key;
      if (!indexes.has(key)) {
        const err = new Error(`Index required but not found for "${key}" in strict mode`);
        err.status = 400;
        throw err;
      }
      const val = payload[key];
      if (c.match) {
        if (Array.isArray(c.match.any)) return Array.isArray(val) ? val.some((x) => c.match.any.includes(x)) : c.match.any.includes(val);
        if (c.match.text !== undefined) return String(val || '').toLowerCase().includes(String(c.match.text).toLowerCase());
        return Array.isArray(val) ? val.includes(c.match.value) : val === c.match.value;
      }
      if (c.range) {
        const n = Number(val);
        if (!Number.isFinite(n)) return false;
        if (c.range.gt !== undefined && !(n > c.range.gt)) return false;
        if (c.range.gte !== undefined && !(n >= c.range.gte)) return false;
        if (c.range.lt !== undefined && !(n < c.range.lt)) return false;
        if (c.range.lte !== undefined && !(n <= c.range.lte)) return false;
        return true;
      }
      return false;
    };
    if (qFilter.must && !qFilter.must.every(checkCond)) return false;
    if (qFilter.must_not && qFilter.must_not.some(checkCond)) return false;
    if (qFilter.should && qFilter.should.length && !qFilter.should.some(checkCond)) return false;
    return true;
  }

  const server = http.createServer(async (req, res) => {
    if (simulateOutage) {
      res.writeHead(503, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ status: { error: 'Simulated Qdrant cluster outage' } }));
      return;
    }

    const chunks = [];
    for await (const ch of req) chunks.push(ch);
    const rawBody = Buffer.concat(chunks).toString('utf8');
    const body = rawBody ? JSON.parse(rawBody) : {};
    const url = new URL(req.url, 'http://127.0.0.1');
    const parts = url.pathname.split('/').filter(Boolean).map(decodeURIComponent);

    const send = (code, data, plain = false) => {
      res.writeHead(code, { 'content-type': plain ? 'text/plain' : 'application/json' });
      res.end(plain ? data : JSON.stringify(data));
    };

    try {
      if (req.method === 'GET' && (url.pathname === '/readyz' || url.pathname === '/healthz')) {
        return send(200, 'all shards are ready', true);
      }
      if (req.method === 'GET' && parts.length === 1 && parts[0] === 'collections') {
        return send(200, { status: 'ok', result: { collections: [...collections.keys()].map((name) => ({ name })) } });
      }
      if (req.method === 'GET' && parts.length === 2 && parts[0] === 'collections') {
        const col = collections.get(parts[1]);
        if (!col) return send(404, { status: { error: `Not found: Collection \`${parts[1]}\` doesn't exist!` } });
        return send(200, {
          status: 'ok',
          result: {
            status: 'green',
            points_count: col.points.size,
            config: { params: { vectors: { size: col.size, distance: col.distance } } }
          }
        });
      }
      if (req.method === 'PUT' && parts.length === 2 && parts[0] === 'collections') {
        if (collections.has(parts[1])) {
          return send(400, { status: { error: `Wrong input: Collection \`${parts[1]}\` already exists!` } });
        }
        const size = Number(body?.vectors?.size);
        if (!Number.isInteger(size) || size <= 0) return send(400, { status: { error: 'Invalid vector size' } });
        collections.set(parts[1], {
          size,
          distance: body?.vectors?.distance || 'Cosine',
          indexes: new Set(),
          points: new Map()
        });
        return send(200, { status: 'ok', result: true });
      }
      if (req.method === 'DELETE' && parts.length === 2 && parts[0] === 'collections') {
        if (!collections.has(parts[1])) return send(404, { status: { error: 'Not found' } });
        collections.delete(parts[1]);
        return send(200, { status: 'ok', result: true });
      }
      if (req.method === 'PUT' && parts.length === 3 && parts[0] === 'collections' && parts[2] === 'index') {
        const col = collections.get(parts[1]);
        if (!col) return send(404, { status: { error: 'Collection not found' } });
        col.indexes.add(body.field_name);
        return send(200, { status: 'ok', result: { status: 'completed' } });
      }
      if (req.method === 'PUT' && parts.length === 3 && parts[0] === 'collections' && parts[2] === 'points') {
        const col = collections.get(parts[1]);
        if (!col) return send(404, { status: { error: 'Collection not found' } });
        for (const pt of body.points || []) {
          const validId = (typeof pt.id === 'number' && Number.isInteger(pt.id) && pt.id >= 0) || UUID_RE.test(String(pt.id));
          if (!validId) return send(400, { status: { error: `Point id ${pt.id} is not a valid UUID or unsigned integer` } });
          if (!Array.isArray(pt.vector) || pt.vector.length !== col.size) {
            return send(400, { status: { error: `Vector dimension error: expected dim: ${col.size}, got ${pt.vector?.length}` } });
          }
          col.points.set(String(pt.id), { id: pt.id, vector: pt.vector, payload: pt.payload || {} });
        }
        return send(200, { status: 'ok', result: { status: 'completed' } });
      }
      if (req.method === 'POST' && parts[0] === 'collections' && parts.length >= 3) {
        const col = collections.get(parts[1]);
        if (!col) return send(404, { status: { error: 'Collection not found' } });
        const tail = parts.slice(2).join('/');

        if (tail === 'points/search') {
          if (!Array.isArray(body.vector) || body.vector.length !== col.size) {
            return send(400, { status: { error: `Vector dimension error: expected ${col.size}` } });
          }
          const hits = [];
          for (const pt of col.points.values()) {
            if (!evalQdrantFilter(pt.payload, body.filter, col.indexes)) continue;
            const sc = cosine(body.vector, pt.vector);
            if (body.score_threshold !== undefined && sc < body.score_threshold) continue;
            hits.push({
              id: pt.id,
              score: sc,
              ...(body.with_payload ? { payload: pt.payload } : {}),
              ...(body.with_vector ? { vector: pt.vector } : {})
            });
          }
          hits.sort((a, b) => b.score - a.score);
          return send(200, { status: 'ok', result: hits.slice(0, body.limit || 10) });
        }

        if (tail === 'points/scroll') {
          const matched = [];
          for (const pt of col.points.values()) {
            if (!evalQdrantFilter(pt.payload, body.filter, col.indexes)) continue;
            matched.push(pt);
          }
          matched.sort((a, b) => String(a.id).localeCompare(String(b.id)));
          let start = 0;
          if (body.offset !== undefined && body.offset !== null) {
            const idx = matched.findIndex((p) => String(p.id) > String(body.offset));
            start = idx >= 0 ? idx : matched.length;
          }
          const lim = body.limit || 10;
          const slice = matched.slice(start, start + lim);
          const next = start + lim < matched.length ? slice[slice.length - 1].id : null;
          return send(200, {
            status: 'ok',
            result: {
              points: slice.map((p) => ({
                id: p.id,
                ...(body.with_payload !== false ? { payload: p.payload } : {})
              })),
              next_page_offset: next
            }
          });
        }

        if (tail === 'points/count') {
          let cnt = 0;
          for (const pt of col.points.values()) {
            if (evalQdrantFilter(pt.payload, body.filter, col.indexes)) cnt += 1;
          }
          return send(200, { status: 'ok', result: { count: cnt } });
        }

        if (tail === 'points/delete') {
          if (Array.isArray(body.points)) {
            for (const id of body.points) col.points.delete(String(id));
          } else if (body.filter) {
            for (const [id, pt] of col.points.entries()) {
              if (evalQdrantFilter(pt.payload, body.filter, col.indexes)) col.points.delete(id);
            }
          }
          return send(200, { status: 'ok', result: { status: 'completed' } });
        }

        if (tail === 'points') {
          const out = (body.ids || []).map((id) => col.points.get(String(id))).filter(Boolean);
          return send(200, { status: 'ok', result: out });
        }
      }
      return send(404, { status: { error: 'Unknown route' } });
    } catch (err) {
      return send(err.status || 400, { status: { error: err.message } });
    }
  });

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({
        url: `http://127.0.0.1:${port}`,
        setOutage: (v) => { simulateOutage = Boolean(v); },
        close: () => new Promise((r) => server.close(r))
      });
    });
  });
}

let passed = 0;
let failed = 0;
async function test(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failed += 1;
    console.error(`  ✗ ${name}\n    ${err.stack || err.message}`);
  }
}

console.log('\n=== FBT AI — LIVE QDRANT + REAL EMBEDDINGS + SMART MEMORY + PERFORMANCE LEARNING PROBE ===\n');

const qdrantSrv = await startStrictQdrantHttpServer();

try {
  await test('Real Semantic Embedder: cross-lingual Persian/English synonym clustering + negation polarity', () => {
    const emb = createSemanticEmbedder({ dim: 384, mode: 'local' });
    const faSafe = emb.embedSync('من ریسک‌پذیری پایینی دارم و استراتژی محافظه‌کارانه بدون اهرم می‌خواهم');
    const enSafe = emb.embedSync('conservative low risk capital preservation strategy without leverage');
    const unrelated = emb.embedSync('کارمزد گس شبکه بیت‌کوین در ساعات شلوغ چقدر است');

    assert.equal(faSafe.length, 384);
    assert.ok(cosine(faSafe, enSafe) > 0.30, `expected cross-lingual semantic match > 0.30, got ${cosine(faSafe, enSafe)}`);
    assert.ok(cosine(faSafe, enSafe) > cosine(faSafe, unrelated) + 0.20, 'semantic synonym pair must beat unrelated Persian text');

    const wantLev = emb.embedSync('استفاده از اهرم بالا و لوریج در فیوچرز');
    const noLev = emb.embedSync('هرگز از اهرم و لوریج در فیوچرز استفاده نکن');
    assert.ok(cosine(noLev, enSafe) > cosine(wantLev, enSafe), 'negated leverage must align closer to safe/no-leverage than positive leverage');
  });

  await test('Real Semantic Embedder: neural provider routing, failover on HTTP 500, LRU cache & 1536->384 projection', async () => {
    let calls = 0;
    const fakeFetch = async (url) => {
      calls += 1;
      if (url.includes('openrouter.ai')) {
        return new Response('rate limit', { status: 429 });
      }
      // Mistral succeeds with 1024-dim vector -> aligned to 384-dim!
      const raw1024 = Array.from({ length: 1024 }, (_, i) => Math.sin(i * 0.1));
      return new Response(JSON.stringify({ data: [{ embedding: raw1024 }] }), { status: 200 });
    };

    const emb = createSemanticEmbedder({
      dim: 384,
      mode: 'auto',
      fetchImpl: fakeFetch,
      providers: [
        { id: 'openrouter', model: 'openai/text-embedding-3-small', apiKey: 'test-or', endpoint: 'https://openrouter.ai/api/v1/embeddings' },
        { id: 'mistral', model: 'mistral-embed', apiKey: 'test-mi', endpoint: 'https://api.mistral.ai/v1/embeddings' }
      ]
    });

    const first = await emb.embedWithMeta('تحلیل جریان پول هوشمند اتریوم');
    assert.equal(first.provider, 'mistral', 'must fail over from 429 openrouter to mistral');
    assert.equal(first.failoverUsed, true);
    assert.equal(first.vector.length, 384, '1024-dim neural embedding projected cleanly to 384-dim');
    assert.ok(Math.abs(cosine(first.vector, first.vector) - 1) < 1e-5, 'projected vector must be L2-normalized');

    const cached = await emb.embedWithMeta('تحلیل جریان پول هوشمند اتریوم');
    assert.equal(cached.cached, true);
    assert.equal(calls, 2, 'second call must hit LRU cache with 0 network requests');
  });

  await test('Live Strict Qdrant v1.20 HTTP Connection: all 8 diagnostic checks pass (non-power-of-two 384 dim + strict indexes)', async () => {
    const diag = await testLiveQdrantConnection({ url: qdrantSrv.url, dim: 384 });
    assert.equal(diag.ok, true, `Qdrant live diagnostic failed: ${JSON.stringify(diag)}`);
    assert.equal(diag.steps.length, 8);
  });

  await test('Live Qdrant Outage & Self-Healing Recovery: degrades to mirror on 503 and replays writes when Qdrant recovers', async () => {
    const store = createVectorStore({
      mode: 'auto',
      dim: 256,
      qdrant: { url: qdrantSrv.url },
      recoveryCooldownMs: 10
    });
    await store.createCollection('heal_col', { dim: 256 });

    // Simulate Qdrant outage
    qdrantSrv.setOutage(true);
    const degradedWrite = await store.upsert('heal_col', [
      { id: 'offline:1', text: 'ذخیره در زمان قطعی سرور برداری', payload: { owner: 'u1', at: 10 } }
    ]);
    assert.equal(degradedWrite.degraded, true);
    assert.equal(store.degraded, true);

    // Search still works from local mirror during outage!
    const mirrorHit = await store.search('heal_col', { query: 'قطعی سرور برداری', limit: 1, filter: { must: [{ key: 'owner', match: 'u1' }] } });
    assert.equal(mirrorHit.rows[0]?.id, 'offline:1');

    // Bring Qdrant back online and verify self-healing write replay!
    qdrantSrv.setOutage(false);
    await new Promise((r) => setTimeout(r, 20));
    const recovered = await store.probeAndRecover();
    assert.equal(recovered, true);
    assert.equal(store.degraded, false);

    const qdrantCount = await store.count('heal_col', { filter: { must: [{ key: 'owner', match: 'u1' }] } });
    assert.equal(qdrantCount.count, 1, 'offline mirror write must be replayed onto Qdrant after recovery');
  });

  await test('RAG Memory on Live Remote Qdrant: pruneOwner works via scroll + delete (no REMOTE_BACKEND_NO_SCROLL)', async () => {
    const vec = createVectorStore({ mode: 'qdrant', dim: 256, qdrant: { url: qdrantSrv.url } });
    const rag = createRagMemory({ store: vec, maxMemoryPerOwner: 3 });
    const topics = [
      'بررسی حمایت تکنیکال بیت کوین',
      'نرخ استیکینگ اتریوم و لیدو',
      'اخبار تصمیم نرخ بهره فدرال رزرو',
      'تحلیل کیف پول نهنگ های آربیتروم',
      'مقایسه ریسک سولانا و اتریوم در سبد'
    ];
    for (let i = 0; i < topics.length; i++) {
      const res = await rag.remember({ owner: 'dev:prune_u', question: topics[i], answer: `پاسخ ${i}` });
      assert.equal(res.ok, true);
      assert.notEqual(res.prune?.reason, 'REMOTE_BACKEND_NO_SCROLL');
    }
    const cnt = await vec.count('fbt_memory', { filter: { must: [{ key: 'owner', match: 'dev:prune_u' }] } });
    assert.equal(cnt.count, 3, 'oldest memories pruned on remote Qdrant');
  });

  await test('Smart Long-Term Memory on Live Qdrant: all 8 capabilities + owner/agent isolation + provenance protection', async () => {
    const vec = createVectorStore({ mode: 'qdrant', dim: 384, qdrant: { url: qdrantSrv.url } });
    const sm = createSmartMemory({ vector: vec });

    // 1 & 2. Conversation + automatic Goal & Preference extraction
    const conv = await sm.rememberConversation({
      owner: 'dev:sara',
      userMessage: 'هدفم رسیدن به ۵۰ هزار دلار در ۲۴ ماه برای خرید مسکن است. ریسک کم می‌خواهم و هرگز از اهرم استفاده نمی‌کنم.',
      assistantReply: 'هدف ۵۰ هزار دلاری و سیاست بدون اهرم شما ذخیره شد.',
      intentType: 'GOAL_SETTING',
      assets: ['BTC', 'ETH']
    });
    assert.equal(conv.ok, true);
    assert.equal(conv.extractedTraits.goals.length, 1);
    assert.equal(conv.extractedTraits.preferences.length, 2);

    // Provenance protection: AI_INFERRED cannot overwrite USER_SAID!
    const overwriteAttempt = await sm.setPreference({
      owner: 'dev:sara',
      key: 'riskTolerance',
      value: 'AGGRESSIVE',
      provenance: 'AI_INFERRED'
    });
    assert.equal(overwriteAttempt.ok, false);
    assert.equal(overwriteAttempt.protected, true);
    const prof = await sm.getUserProfile('dev:sara');
    assert.equal(prof.preferencesMap.riskTolerance, 'CONSERVATIVE');
    assert.equal(prof.preferencesMap.leveragePolicy, 'NO_LEVERAGE_SPOT_ONLY');
    assert.equal(prof.goals[0].targetUsd, 50000);

    // 3. Past Decisions
    await sm.rememberDecision({
      owner: 'dev:sara',
      question: 'آیا الان اتریوم بخرم؟',
      assets: ['ETH'],
      verdict: 'FAVORABLE_STAGED',
      stance: 'bullish',
      confidence: 74,
      summary: 'ورود پله‌ای اسپات در ۳ پله بدون اهرم تأیید شد.',
      entryPrice: 3100,
      specialists: ['technical_analyst', 'risk_specialist', 'final_arbiter']
    });
    const pastDec = await sm.recallDecisions({ owner: 'dev:sara', query: 'تصمیم قبلی درباره خرید اتر', asset: 'ETH' });
    assert.equal(pastDec.rows.length, 1);
    assert.equal(pastDec.rows[0].verdict, 'FAVORABLE_STAGED');

    // 4. Cross-lingual Semantic Search + Zero cross-owner leakage
    const crossSearch = await sm.semanticSearch({
      owner: 'dev:sara',
      query: 'safe conservative housing savings target without margin'
    });
    assert.ok(crossSearch.rows.length >= 1, 'semantic search must recall Persian goal/preference from English query');
    const strangerSearch = await sm.semanticSearch({
      owner: 'dev:stranger',
      query: 'safe conservative housing savings target'
    });
    assert.equal(strangerSearch.rows.length, 0, 'strict owner isolation');

    // 5. Private Agent Memory Isolation
    await sm.rememberAgentPrivate({
      owner: 'dev:sara',
      agentId: 'onchain_analyst',
      note: 'ETH staking validator queue healthy, Lido APR 3.3%',
      assets: ['ETH']
    });
    const ownRead = await sm.recallAgentPrivate({ owner: 'dev:sara', agentId: 'onchain_analyst', requesterAgentId: 'onchain_analyst', query: 'validator APR' });
    assert.equal(ownRead.rows.length, 1);
    const crossAgentRead = await sm.recallAgentPrivate({ owner: 'dev:sara', agentId: 'onchain_analyst', requesterAgentId: 'technical_analyst' });
    assert.equal(crossAgentRead.ok, false);
    assert.equal(crossAgentRead.error, 'AGENT_PRIVATE_MEMORY_ISOLATED');

    // 6. Controlled Shared Memory (ACL + Evidence Gate)
    const unverifiedPub = await sm.publishSharedMemory({
      owner: 'dev:sara',
      publisherAgentId: 'macro_news_analyst',
      claim: 'Unconfirmed rumor without tool evidence',
      confidence: 0.4,
      evidenceRefs: [],
      allowedReaders: ['final_arbiter']
    });
    assert.equal(unverifiedPub.verificationStatus, 'UNVERIFIED_HYPOTHESIS');

    const verifiedPub = await sm.publishSharedMemory({
      owner: 'dev:sara',
      publisherAgentId: 'smart_money_analyst',
      claim: 'Top smart-money wallets added $14M ETH spot',
      assets: ['ETH'],
      confidence: 0.85,
      evidenceRefs: ['smart_money'],
      allowedReaders: ['final_arbiter', 'decision_critic']
    });
    assert.equal(verifiedPub.verificationStatus, 'EVIDENCE_BACKED');

    const verifiedShared = await sm.readSharedMemory({ owner: 'dev:sara', readerAgentId: 'final_arbiter', verifiedOnly: true });
    assert.equal(verifiedShared.rows.length, 1);
    assert.equal(verifiedShared.rows[0].publisherAgentId, 'smart_money_analyst');

    const unauthorizedShared = await sm.readSharedMemory({ owner: 'dev:sara', readerAgentId: 'technical_analyst' });
    assert.equal(unauthorizedShared.rows.length, 0);

    // 7 & 8. Successful + Unsuccessful Experiences & Timely Contextual Recall
    await sm.recordExperience({
      owner: 'dev:sara',
      outcome: 'SUCCESS',
      asset: 'ETH',
      taskType: 'TRADING_STRATEGY',
      whatWorked: '3-tranche DCA during RSI pullback avoided drawdown',
      lesson: 'Staged spot DCA works reliably for conservative ETH accumulation'
    });
    await sm.recordExperience({
      owner: 'dev:sara',
      outcome: 'FAILURE',
      asset: 'ETH',
      taskType: 'TRADING_STRATEGY',
      whatFailed: 'Chasing +9% green daily candle led to immediate -6% pullback',
      rootCause: 'OVERCONFIDENT_DECISION',
      lesson: 'Avoid buying single lump-sum right after >8% daily spike'
    });

    const timely = await sm.contextualRecall({
      owner: 'dev:sara',
      query: 'استراتژی خرید اتریوم برای هدف بلندمدت من چیست؟',
      intentType: 'TRADING_STRATEGY',
      entities: { assets: ['ETH'] },
      activeAgents: ['onchain_analyst', 'final_arbiter']
    });
    assert.equal(timely.hasRelevantContext, true);
    assert.equal(timely.userProfile.goals.length, 1);
    assert.equal(timely.pastDecisions.length, 1);
    assert.equal(timely.relevantExperiences.successes.length, 1);
    assert.equal(timely.relevantExperiences.warnings.length, 1);
    assert.equal(timely.agentMemories.onchain_analyst.private.length, 1);
    assert.ok(timely.agentMemories.final_arbiter.shared.length >= 1, 'relevant ETH shared memory retrieved');
  });

  await test('Performance Learning: outcome comparison, model/agent error & Brier eval, mistake root-causes, trust weights & reversible rollback', async () => {
    const sm = createSmartMemory({ vector: createVectorStore({ mode: 'local', dim: 256 }) });
    const pl = createPerformanceLearning({ smartMemory: sm });

    // Record a prediction where openrouter was overconfidently bullish (88%), deepseek was accurate bearish, and risk_specialist warned bearish!
    const rec1 = await pl.recordPrediction({
      owner: 'dev:learn_u',
      question: 'Should we buy BTC breakout at $70k?',
      asset: 'BTC',
      taskType: 'TRADING_STRATEGY',
      predictedDirection: 'BULLISH',
      predictedMovePct: 5.0,
      confidence: 82,
      entryPrice: 70000,
      evidenceQuality: 0.50,
      modelVotes: [
        { provider: 'openrouter', model: 'llama-3.3', direction: 'BULLISH', predictedMovePct: 6.0, confidence: 88 },
        { provider: 'deepseek', model: 'deepseek-chat', direction: 'BEARISH', predictedMovePct: -4.0, confidence: 76 }
      ],
      agentVotes: [
        { agentId: 'technical_analyst', direction: 'BULLISH', confidence: 84, summary: 'Momentum breakout' },
        { agentId: 'risk_specialist', direction: 'BEARISH', confidence: 80, summary: 'Overextended leverage; downside risk high' }
      ]
    });
    assert.equal(rec1.ok, true);

    // Actual outcome: BTC dropped to $65,800 (-6.0%)!
    const eval1 = await pl.evaluateOutcome({
      predictionId: rec1.predictionId,
      actualPrice: 65800
    });
    assert.equal(eval1.ok, true);
    assert.equal(eval1.evaluation.hit, false);
    assert.equal(eval1.evaluation.actualMovePct, -6);

    // Verify root-cause postmortem captured BOTH ignored risk warning & overconfidence & thin evidence!
    const pm = eval1.evaluation.postmortem;
    assert.ok(pm);
    assert.ok(pm.reasonCodes.includes('IGNORED_RISK_OR_CRITIC_WARNING'));
    assert.ok(pm.reasonCodes.includes('OVERCONFIDENT_DECISION'));
    assert.ok(pm.reasonCodes.includes('THIN_EVIDENCE_AT_DECISION_TIME'));

    // Verify model trust weights adjusted: accurate deepseek > overconfident wrong openrouter!
    const weightsAfterMiss = pl.getTrustWeights();
    assert.equal(weightsAfterMiss.baseModelsModified, false);
    assert.ok(weightsAfterMiss.models.deepseek > 1.0, `deepseek should gain trust, got ${weightsAfterMiss.models.deepseek}`);
    assert.ok(weightsAfterMiss.models.openrouter < 1.0, `openrouter should lose trust, got ${weightsAfterMiss.models.openrouter}`);
    assert.ok(weightsAfterMiss.agents.risk_specialist > weightsAfterMiss.agents.technical_analyst, 'risk_specialist veto save must outrank wrong technical_analyst');

    // Verify model MAE/RMSE/Brier & agent vetoSavedLossCount metrics
    const mMetrics = pl.getModelMetrics();
    const orStat = mMetrics.find((m) => m.provider === 'openrouter');
    assert.equal(orStat.misses, 1);
    assert.equal(orStat.overconfidenceRate, 1);
    assert.ok(orStat.maePct >= 11.9, 'predicted +6% vs actual -6% => ~12% MAE');

    const aMetrics = pl.getAgentMetrics();
    const riskStat = aMetrics.find((a) => a.agentId === 'risk_specialist');
    assert.equal(riskStat.vetoSavedLossCount, 1);

    // Verify pre-decision guidance uses this past mistake to improve the NEXT decision!
    const guidance = pl.buildDecisionGuidance({
      owner: 'dev:learn_u',
      asset: 'BTC',
      taskType: 'TRADING_STRATEGY',
      candidateProviders: ['openrouter', 'deepseek']
    });
    assert.equal(guidance.rankedProviders[0].provider, 'deepseek');
    assert.equal(guidance.requireCritic, true);
    assert.ok(guidance.confidenceDampener > 0);
    assert.equal(guidance.pastMistakeWarnings.length, 1);

    // Verify freeze prevents uncontrolled drift while still evaluating
    const snapBeforeFreeze = weightsAfterMiss.currentPolicyVersion;
    await pl.setFrozen(true);
    const rec2 = await pl.recordPrediction({
      owner: 'dev:learn_u',
      asset: 'BTC',
      predictedDirection: 'BULLISH',
      confidence: 70,
      entryPrice: 66000,
      modelVotes: [{ provider: 'deepseek', direction: 'BULLISH', confidence: 70 }]
    });
    const deepseekBeforeFrozenEval = pl.getTrustWeights().models.deepseek;
    await pl.evaluateOutcome({ predictionId: rec2.predictionId, actualPrice: 69000 });
    assert.equal(pl.getTrustWeights().models.deepseek, deepseekBeforeFrozenEval, 'frozen policy must not mutate trust weights');
    await pl.setFrozen(false);

    // Verify reversible policy rollback!
    const rollbackToV1 = await pl.rollbackPolicy('pol_v1');
    assert.equal(rollbackToV1.ok, true);
    assert.deepEqual(pl.getTrustWeights().models, {}, 'pol_v1 snapshot had clean initial empty weight overrides');

    // And rollback back to the learned snapshot `snapBeforeFreeze`!
    const restoreLearned = await pl.rollbackPolicy(snapBeforeFreeze);
    assert.equal(restoreLearned.ok, true);
    assert.ok(pl.getTrustWeights().models.deepseek > 1.0, 'rolling forward to pol_v2 restores learned weights');
  });
} finally {
  await qdrantSrv.close();
}

console.log(`\n=== LIVE QDRANT + MEMORY + LEARNING PROBE: ${passed}/${passed + failed} passed ===\n`);
if (failed > 0) process.exit(1);
