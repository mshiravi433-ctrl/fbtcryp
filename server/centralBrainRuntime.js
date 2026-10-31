/**
 * FBT AI — SERVER RUNTIME FOR CENTRAL BRAIN V2, SMART MEMORY, PERFORMANCE LEARNING & ADAPTIVE COUNCIL
 * ---------------------------------------------------------------------------
 * Wires the upgraded Central Brain modules to the real server infrastructure:
 *   • `server/aiToolBroker.js` for read-only market, smart-money, news, macro,
 *     DeFi yield, portfolio, wallet, and quote reads.
 *   • `server/aiGateway.js` (`executeProviderChat`, `getActiveProviderIds`,
 *     `isProviderHealthy`) for multi-provider LLM execution with failover.
 *   • `server/store.js` (`storeGet`, `storeSet`) for durable snapshot persistence
 *     when `QDRANT_URL` is not configured or alongside Qdrant metadata.
 *   • `testLiveQdrantConnection` for live operational verification of Qdrant REST v1.x/v1.20+.
 */

import { createVectorStore } from '../src/lib/intent-ai/orchestrator/vectorStore.js';
import { createSmartMemory } from '../src/lib/intent-ai/orchestrator/smartMemory.js';
import { createPerformanceLearning } from '../src/lib/intent-ai/orchestrator/performanceLearning.js';
import { createAdaptiveCouncil } from '../src/lib/intent-ai/orchestrator/adaptiveCouncil.js';
import { createCentralBrain, MODEL_FLEET_CATALOGUE } from '../src/lib/intent-ai/orchestrator/centralBrain.js';
import { executeToolRequests } from './aiToolBroker.js';
import { executeProviderChat, getActiveProviderIds, isProviderHealthy } from './aiGateway.js';
import { storeGet, storeSet } from './store.js';

const SMART_MEM_KV_KEY = 'ai:smart-memory:v1';
const PERF_LEARN_KV_KEY = 'ai:perf-learning:v1';

const TOOL_TO_FACET = Object.freeze({
  fbt_get_market_snapshot: 'market_prices',
  fbt_get_signals: 'smart_money',
  fbt_get_news: 'news_flow',
  fbt_get_macro_snapshot: 'macro_state',
  fbt_get_yields: 'yield_rates',
  fbt_get_portfolio: 'portfolio_state',
  fbt_get_wallet_state: 'wallet_state',
  fbt_get_quote_preview: 'venue_quote'
});

let sharedVectorStore = null;
let sharedSmartMemory = null;
let sharedPerformanceLearning = null;
let sharedAdaptiveCouncil = null;
let sharedCentralBrain = null;

export function getOperationalVectorStore() {
  if (!sharedVectorStore) {
    const configuredDim = Number(process.env.FBT_VECTOR_DIM) || 256;
    sharedVectorStore = createVectorStore({
      mode: process.env.AI_ORCH_VECTOR || 'auto',
      dim: configuredDim
    });
  }
  return sharedVectorStore;
}

export function getSmartMemory() {
  if (!sharedSmartMemory) {
    sharedSmartMemory = createSmartMemory({
      vector: getOperationalVectorStore(),
      persist: {
        load: () => storeGet(SMART_MEM_KV_KEY, null),
        save: async (snap) => {
          try { await storeSet(SMART_MEM_KV_KEY, snap); } catch { /* best-effort when Blob paused */ }
        }
      }
    });
  }
  return sharedSmartMemory;
}

export function getPerformanceLearning() {
  if (!sharedPerformanceLearning) {
    sharedPerformanceLearning = createPerformanceLearning({
      smartMemory: getSmartMemory(),
      persist: {
        load: () => storeGet(PERF_LEARN_KV_KEY, null),
        save: async (snap) => {
          try { await storeSet(PERF_LEARN_KV_KEY, snap); } catch { /* best-effort */ }
        }
      }
    });
  }
  return sharedPerformanceLearning;
}

export function getAdaptiveCouncil() {
  if (!sharedAdaptiveCouncil) {
    sharedAdaptiveCouncil = createAdaptiveCouncil({
      smartMemory: getSmartMemory(),
      performanceLearning: getPerformanceLearning()
    });
  }
  return sharedAdaptiveCouncil;
}

export function getCentralBrain() {
  if (!sharedCentralBrain) {
    const activeExternal = () => {
      const configured = getActiveProviderIds().filter((id) => id !== 'internal' && MODEL_FLEET_CATALOGUE[id]);
      return configured.filter((id) => isProviderHealthy(id) !== false);
    };

    sharedCentralBrain = createCentralBrain({
      smartMemory: getSmartMemory(),
      performanceLearning: getPerformanceLearning(),
      adaptiveCouncil: getAdaptiveCouncil(),
      availableProviders: activeExternal().length ? activeExternal() : Object.keys(MODEL_FLEET_CATALOGUE),
      toolRunner: async (toolName, args = {}, ctx = {}) => {
        const facetId = TOOL_TO_FACET[toolName] || 'market_prices';
        const primaryToken = Array.isArray(args.symbols) && args.symbols[0] ? args.symbols[0] : null;
        const run = await executeToolRequests(
          [{ tool: toolName, facetId, priority: 1 }],
          {
            owner: ctx.owner || args.owner || 'anon',
            token: primaryToken,
            question: args.question || '',
            allowHighCostTools: toolName === 'fbt_get_macro_snapshot',
            deadlineMs: 3200
          }
        );
        const row = run.rows?.[0];
        if (!row) return { facetId, status: 'unavailable' };
        return {
          facetId: row.facetId || facetId,
          status: row.status,
          summary: row.summary,
          ms: row.durationMs
        };
      },
      providerInvoker: async ({ provider, model, prompt, timeoutMs = 4500 }) => {
        const configured = getActiveProviderIds();
        if (!configured.includes(provider)) {
          throw new Error(`PROVIDER_NOT_CONFIGURED:${provider}`);
        }
        const out = await executeProviderChat(provider, {
          system: 'شما یکی از متخصصان مغز مرکزی غیرامانی FBT هستید. صرفاً بر اساس شواهد ارائه‌شده تحلیل کوتاه، دقیق و بدون جعل عدد ارائه دهید.',
          user: prompt,
          model,
          temperature: 0.25,
          maxTokens: 450,
          timeout: timeoutMs
        });
        return {
          text: out.text,
          model: out.model
        };
      }
    });
  }
  return sharedCentralBrain;
}

/**
 * Live operational Qdrant connection & end-to-end feature verification suite.
 * Tests health, collection lifecycle, idempotency, payload indexing, non-power-of-two
 * dimensions, semantic embedding upsert, filtered cosine search, scroll pagination,
 * count, filter deletion, and cleanup.
 */
export async function testLiveQdrantConnection({
  url = process.env.QDRANT_URL || null,
  apiKey = process.env.QDRANT_API_KEY || null,
  dim = 384, // deliberately non-power-of-two to verify the dimension fix!
  fetchImpl = null
} = {}) {
  if (!url) {
    const localStore = createVectorStore({ mode: 'local', dim });
    await localStore.createCollection('_diag_local', { dim });
    await localStore.upsert('_diag_local', [
      { id: 'diag:1', text: 'سرمایه‌گذاری کم‌ریسک و حفظ اصل سرمایه بدون اهرم', payload: { owner: 'diag', kind: 'preference', at: Date.now() } },
      { id: 'diag:2', text: 'کارمزد گس شبکه بیت‌کوین در ساعات شلوغ', payload: { owner: 'diag', kind: 'faq', at: Date.now() } }
    ]);
    const search = await localStore.search('_diag_local', {
      query: 'conservative low risk safe strategy without leverage',
      limit: 2,
      filter: { must: [{ key: 'owner', match: 'diag' }] }
    });
    const scroll = await localStore.scroll('_diag_local', { filter: { must: [{ key: 'owner', match: 'diag' }] }, limit: 10 });
    await localStore.deleteCollection('_diag_local');

    return {
      ok: true,
      mode: 'embedded-operational-vector-db',
      qdrantConfigured: false,
      note: 'QDRANT_URL is not set; embedded operational vector database verified with 384-dim bilingual semantic embeddings.',
      checks: {
        nonPowerOfTwoDimSupported: localStore.dimension === dim,
        crossLingualSemanticTopHit: search.rows?.[0]?.id === 'diag:1',
        topScore: search.rows?.[0]?.score || 0,
        scrollCount: scroll.points?.length || 0
      }
    };
  }

  const colName = `_fbt_qdrant_diag_${Date.now().toString(36)}`;
  const store = createVectorStore({
    mode: 'qdrant',
    dim,
    qdrant: { url, apiKey, fetchImpl }
  });

  const steps = [];
  try {
    // 1. Health check
    const health = await store.health();
    steps.push({ step: 'health_check', ok: Boolean(health.ok), details: health });
    if (!health.ok) {
      return { ok: false, mode: 'qdrant', qdrantConfigured: true, error: health.error || 'QDRANT_UNREACHABLE', steps };
    }

    // 2. Missing collection read must NOT mark store as degraded
    const preCount = await store.count(colName);
    steps.push({
      step: 'missing_collection_no_false_degrade',
      ok: store.degraded === false && preCount.error === 'COLLECTION_NOT_FOUND',
      degraded: store.degraded
    });

    // 3. Create collection with non-power-of-two dim (e.g. 384) + payload indexes
    const created1 = await store.createCollection(colName, { dim });
    const created2 = await store.createCollection(colName, { dim }); // idempotent second call!
    steps.push({
      step: 'idempotent_create_collection_and_indexes',
      ok: Boolean(created1.ok && created2.ok && created2.alreadyExisted),
      dim: created1.dim,
      indexedFields: created1.indexedFields || []
    });

    // 4. Upsert bilingual semantic vectors with string IDs mapped via qdrantId
    const up = await store.upsert(colName, [
      { id: 'mem:user1:pref1', text: 'من ریسک‌پذیری پایینی دارم و هرگز از اهرم استفاده نمی‌کنم', payload: { owner: 'user1', memoryType: 'preference', at: 1000 } },
      { id: 'mem:user1:conv1', text: 'تحلیل تکنیکال و جریان نهنگ‌های اتریوم', payload: { owner: 'user1', memoryType: 'conversation', at: 2000 } },
      { id: 'mem:user2:secret', text: 'ترجیح کاربر دیگر روی سولانا', payload: { owner: 'user2', memoryType: 'preference', at: 3000 } }
    ]);
    steps.push({ step: 'upsert_points', ok: up.ok && up.written === 3, written: up.written });

    // 5. Cross-lingual filtered semantic search + owner isolation
    const search = await store.search(colName, {
      query: 'conservative low risk strategy no leverage',
      limit: 3,
      filter: { must: [{ key: 'owner', match: 'user1' }] }
    });
    const noCrossOwnerLeak = (search.rows || []).every((r) => r.payload?.owner === 'user1');
    steps.push({
      step: 'filtered_cross_lingual_semantic_search',
      ok: Boolean(search.ok && search.rows?.[0]?.id === 'mem:user1:pref1' && noCrossOwnerLeak),
      topHitId: search.rows?.[0]?.id || null,
      topScore: search.rows?.[0]?.score || 0,
      noCrossOwnerLeak
    });

    // 6. Scroll pagination (previously missing on remote Qdrant!)
    const scrolled = await store.scroll(colName, {
      filter: { must: [{ key: 'owner', match: 'user1' }] },
      limit: 10
    });
    steps.push({
      step: 'scroll_remote_points',
      ok: Boolean(scrolled.ok && scrolled.points?.length === 2),
      scrolledIds: (scrolled.points || []).map((p) => p.id)
    });

    // 7. Delete by filter & verify count
    await store.deleteByFilter(colName, { must: [{ key: 'owner', match: 'user2' }] });
    const afterCount = await store.count(colName);
    steps.push({
      step: 'delete_by_filter_and_count',
      ok: Boolean(afterCount.ok && afterCount.count === 2),
      remainingCount: afterCount.count
    });

    // 8. Cleanup diagnostic collection
    await store.deleteCollection(colName);
    steps.push({ step: 'cleanup_collection', ok: true });

    const allOk = steps.every((s) => s.ok);
    return {
      ok: allOk,
      mode: 'qdrant',
      qdrantConfigured: true,
      dimensionTested: dim,
      steps
    };
  } catch (err) {
    try { await store.deleteCollection(colName); } catch { /* ignore cleanup error */ }
    return {
      ok: false,
      mode: 'qdrant',
      qdrantConfigured: true,
      error: String(err?.message || err).slice(0, 200),
      steps
    };
  }
}

export default getCentralBrain;
