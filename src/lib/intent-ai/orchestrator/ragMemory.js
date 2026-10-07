/**
 * FBT AI ORCHESTRATOR — RAG MEMORY (retrieval that answers can cite)
 * ---------------------------------------------------------------------------
 * Two collections, one contract:
 *
 *   fbt_knowledge — the hand-checked FBT corpus, indexed once per process
 *                   (knowledgeCenter FBT_KNOWLEDGE + the 36 Help-screen FAQ
 *                   answers). Every passage keeps its id, so an answer can cite
 *                   `kb.wallet.custody` instead of asserting from nowhere.
 *   fbt_memory    — owner-scoped conversation/decision memory: what this user
 *                   asked and what was concluded. Payload-filtered by owner so
 *                   one user's history can never colour another's answer.
 *
 * Retrieval is genuinely hybrid — two INDEPENDENT signals, both reported:
 *   · vector   — the embedded store (vectorStore.js), which tolerates
 *                morphology and typos;
 *   · BM25     — the existing retriever (src/lib/intent-ai/retrieval.js), which
 *                is exact about rare words.
 * The merged score is `0.6*vector + 0.4*bm25`, and a passage found by only one
 * signal survives — a near-synonym the BM25 missed, or an exact term the
 * embedding blurred, is exactly the passage the other half exists for.
 * Each signal is scaled against the best candidate of THIS query (with an
 * absolute gate: a cosine floor, and a raw-BM25 floor), because the two halves
 * live on incomparable scales — BM25 is unbounded, cosine is not. Without the
 * gate a nonsense question would still produce a confident-looking top hit.
 *
 * Honest limits, stated rather than hidden:
 *   · The vector space is lexical/morphological, NOT semantic — no embedding
 *     model runs on this host. That is why the two signals are kept separate
 *     instead of pretending one number is a truth score.
 *   · Memory is capped per owner and pruned oldest-first; pruning works on the
 *     embedded backend, and the remote-Qdrant path reports `capSkipped:true`
 *     rather than pretending it pruned.
 *   · Secrets never enter memory: the same scrubber the learning loop uses runs
 *     on every stored field.
 */

import { FBT_KNOWLEDGE } from '../os/knowledgeCenter.js';
import { faqCorpus } from '../../faqLocal.js';
import { createVectorStore, tokenize, normalizeText } from './vectorStore.js';
import { containsSensitiveKeyOrPhrase } from './redact.js';

export const RAG_SCHEMA = 'fbt.rag-memory.v1';
export const RAG_VERSION = '14.0.0';

export const COLLECTIONS = Object.freeze({
  knowledge: 'fbt_knowledge',
  memory: 'fbt_memory'
});

const MAX_PASSAGE_CHARS = 900;
const MAX_MEMORY_PER_OWNER = Number(process.env.AI_ORCH_MEMORY_PER_OWNER || 50);
const DEDUPE_SCORE = 0.94;
/* Absolute gates below which a signal carries no evidence at all, whatever it
   ranks first in the candidate set. */
const VEC_ABS_FLOOR = 0.08;
const BM25_ABS_FLOOR = 1;

/** Fit a passage into the index without cutting a word in the middle. */
function clip(text, max = MAX_PASSAGE_CHARS) {
  const s = String(text ?? '').replace(/\s+/g, ' ').trim();
  if (s.length <= max) return s;
  return `${s.slice(0, max - 1).trimEnd()}…`;
}

function lexicalScore(queryTokens, text) {
  if (!queryTokens.length) return 0;
  const docTokens = new Set(tokenize(text));
  if (!docTokens.size) return 0;
  let hit = 0;
  for (const t of queryTokens) {
    if (docTokens.has(t)) hit += 1;
    else if (t.includes(' ')) {
      /* A bigram scores if both words are present — word order is not meaning
         for this corpus size, and the strict form would drop true matches. */
      const [a, b] = t.split(' ');
      if (docTokens.has(a) && docTokens.has(b)) hit += 0.6;
    }
  }
  const coverage = hit / queryTokens.length;
  /* Length damping: a long document that merely contains the words is not as
     relevant as a short one built out of them. */
  const damping = 1 / (1 + Math.log10(1 + docTokens.size / 24));
  return Math.max(0, Math.min(1, coverage * damping));
}

export function createRagMemory({
  store = null,
  maxMemoryPerOwner = MAX_MEMORY_PER_OWNER,
  now = Date.now,
  /** Optional BM25 signal; defaults to the repo's own retriever. */
  bm25 = null,
  vectorStoreOptions = {}
} = {}) {
  const vector = store || createVectorStore(vectorStoreOptions);
  const bm25Fn = bm25; // resolved lazily below if not injected
  let knowledgeIndexed = false;
  let indexedAt = null;
  let memSeq = 0;
  const counters = { recalls: 0, writes: 0, dedupes: 0, bm25Hits: 0, vectorHits: 0, pruned: 0, degraded: 0 };

  async function bm25Retrieve(query, { locale, limit }) {
    if (typeof bm25Fn === 'function') return bm25Fn(query, { locale, limit });
    try {
      const mod = await import('../retrieval.js');
      return mod.retrieve(query, { locale, limit });
    } catch {
      return [];
    }
  }

  return {
    schema: RAG_SCHEMA,
    version: RAG_VERSION,
    vectorStore: vector,

    /** Index the verified corpus. Idempotent; `force` re-embeds. */
    async indexKnowledge({ force = false } = {}) {
      if (knowledgeIndexed && !force) {
        const counts = await vector.count(COLLECTIONS.knowledge).catch(() => ({ count: null }));
        return { ok: true, skipped: true, points: counts?.count ?? null, indexedAt };
      }
      await vector.createCollection(COLLECTIONS.knowledge, {});
      const points = [];

      for (const item of FBT_KNOWLEDGE) {
        if (item.status === 'deprecated') continue;
        const text = clip([
          item.titleFa, item.bodyFa, item.titleEn, item.bodyEn, item.category
        ].filter(Boolean).join(' \n '));
        points.push({
          id: `kb:${item.id}`,
          text,
          payload: {
            owner: null,
            kind: 'knowledge',
            source: item.source || 'fbt-knowledge',
            cite: item.id,
            category: item.category,
            status: item.status,
            version: item.version,
            titleFa: item.titleFa || null,
            titleEn: item.titleEn || null,
            textFa: clip(item.bodyFa || '', 600),
            textEn: clip(item.bodyEn || '', 600),
            text
          }
        });
      }

      try {
        for (const faq of faqCorpus()) {
          const answers = faq.answers || {};
          const text = clip([faq.id, (faq.keywords || []).join(' '), ...Object.values(answers)].join(' \n '));
          points.push({
            id: `faq:${faq.id}`,
            text,
            payload: {
              owner: null,
              kind: 'faq',
              source: 'fbt-help',
              cite: faq.id,
              category: 'HELP',
              status: 'verified',
              version: 1,
              titleFa: null,
              titleEn: null,
              textFa: clip(answers.fa || answers.en || '', 600),
              textEn: clip(answers.en || answers.fa || '', 600),
              text
            }
          });
        }
      } catch { /* the FAQ corpus is additive; its failure never blocks the KB */ }

      const out = await vector.upsert(COLLECTIONS.knowledge, points);
      knowledgeIndexed = out.ok !== false;
      indexedAt = now();
      return { ok: Boolean(knowledgeIndexed), points: points.length, written: out.written ?? null, indexedAt, backend: vector.kind, degraded: vector.degraded === true };
    },

    /**
     * Remember one turn for one owner. Near-duplicates update the timestamp
     * instead of growing the collection (an assistant asked the same question
     * five times should not have five identical memories competing for the
     * top slot later).
     */
    async remember({
      owner = null,
      question = '',
      answer = '',
      intentType = null,
      lang = null,
      sources = [],
      id = null,
      kind = 'turn',
      payloadExtra = null
    } = {}) {
      if (!owner) return { ok: false, error: 'OWNER_REQUIRED' };
      const q = clip(question, 300);
      const a = clip(answer, 700);
      if (!q && !a) return { ok: false, error: 'NOTHING_TO_REMEMBER' };
      if (containsSensitiveKeyOrPhrase(`${q} ${a}`)) return { ok: false, error: 'SENSITIVE_CONTENT_REFUSED' };

      await vector.createCollection(COLLECTIONS.memory, {});
      const text = clip(`${q} \n ${a}`);
      const near = await vector.search(COLLECTIONS.memory, {
        text, limit: 1, filter: { must: [{ key: 'owner', match: owner }] }
      }).catch(() => ({ rows: [] }));
      if (!id && near?.rows?.[0]?.score >= DEDUPE_SCORE) {
        counters.dedupes += 1;
        const prior = near.rows[0];
        await vector.upsert(COLLECTIONS.memory, [{
          id: prior.id, text,
          payload: { ...(prior.payload || {}), at: now(), seen: (prior.payload?.seen || 1) + 1 }
        }]);
        return { ok: true, deduped: true, id: prior.id };
      }

      memSeq += 1;
      const pointId = id || `mem:${owner}:${intentType || 'GENERAL'}:${now().toString(36)}:${memSeq}`;
      const write = await vector.upsert(COLLECTIONS.memory, [{
        id: pointId,
        text,
        payload: {
          owner,
          kind,
          question: q,
          answer: a,
          intentType: intentType || 'GENERAL',
          lang: lang || null,
          citations: Array.isArray(sources) ? sources.slice(0, 6).map((s) => s?.cite || s?.id || null).filter(Boolean) : [],
          at: now(),
          ...(payloadExtra && typeof payloadExtra === 'object' ? payloadExtra : {})
        }
      }]);
      counters.writes += 1;
      const prune = await this.pruneOwner(owner, maxMemoryPerOwner);
      return { ok: write.ok !== false, id: pointId, deduped: false, prune };
    },

    /**
     * Keep the newest `keep` memories for one owner. Uses the embedded state,
     * so the remote backend reports `capSkipped` instead of guessing.
     */
    async pruneOwner(owner, keep = maxMemoryPerOwner) {
      if (vector.kind !== 'local' && !vector.exportState().collections?.[COLLECTIONS.memory]) {
        return { ok: false, capSkipped: true, reason: 'REMOTE_BACKEND_NO_SCROLL' };
      }
      const state = vector.exportState();
      const points = state?.collections?.[COLLECTIONS.memory]?.points || [];
      const mine = points.filter((p) => p.payload?.owner === owner);
      if (mine.length <= keep) return { ok: true, removed: 0, kept: mine.length };
      mine.sort((a, b) => Number(b.payload?.at || 0) - Number(a.payload?.at || 0));
      const doomed = mine.slice(keep).map((p) => p.id);
      await vector.delete(COLLECTIONS.memory, doomed);
      counters.pruned += doomed.length;
      return { ok: true, removed: doomed.length, kept: keep };
    },

    /**
     * Hybrid recall. Returns passages with citations — never raw vectors, never
     * another owner's rows.
     */
    async recall({ query = '', owner = null, limit = 5, locale = 'fa', kinds = null, minScore = 0.18 } = {}) {
      const started = now();
      counters.recalls += 1;
      const q = String(query || '').trim();
      if (!q) return { ok: false, schema: RAG_SCHEMA, error: 'QUERY_REQUIRED', passages: [], sources: [], stats: { ms: 0 } };
      const nLimit = Math.max(1, Math.min(20, Number(limit) || 5));
      const queryTokens = tokenize(q);
      const fa = String(locale || 'fa').startsWith('fa');

      await this.indexKnowledge();
      await vector.createCollection(COLLECTIONS.memory, {});

      const [kbHits, memHits] = await Promise.all([
        vector.search(COLLECTIONS.knowledge, { text: q, limit: nLimit * 2 }).catch(() => ({ rows: [] })),
        owner
          ? vector.search(COLLECTIONS.memory, { text: q, limit: nLimit * 2, filter: { must: [{ key: 'owner', match: owner }] } }).catch(() => ({ rows: [] }))
          : Promise.resolve({ rows: [] })
      ]);

      const bm25Rows = await bm25Retrieve(q, { locale, limit: nLimit * 2 });

      /* One entry per CITATION: the two signals address the same passage by
         different ids (the vector store adds a `kb:`/`faq:` prefix, BM25 uses
         the raw knowledge id), so both are folded onto `payload.cite`. */
      const vecRaw = new Map();
      const bmRaw = new Map();
      const payloads = new Map();
      const bmMeta = new Map();
      const memoryKeys = new Set();

      for (const row of kbHits.rows || []) {
        if (row.payload?.owner) continue; // never leak an owner row through the shared collection
        const key = String(row.payload?.cite || row.id);
        vecRaw.set(key, Math.max(vecRaw.get(key) ?? 0, Number(row.score) || 0));
        payloads.set(key, row.payload || {});
        counters.vectorHits += 1;
      }
      for (const row of memHits.rows || []) {
        if (row.payload?.owner !== owner) continue;
        const key = String(row.id);
        vecRaw.set(key, Math.max(vecRaw.get(key) ?? 0, Number(row.score) || 0));
        payloads.set(key, row.payload || {});
        memoryKeys.add(key);
        counters.vectorHits += 1;
      }
      for (const row of bm25Rows || []) {
        const key = String(row.id);
        bmRaw.set(key, Math.max(bmRaw.get(key) ?? 0, Math.max(0, Number(row.score) || 0)));
        bmMeta.set(key, row);
        counters.bm25Hits += 1;
      }

      const topVec = Math.max(0, ...vecRaw.values());
      const topBm = Math.max(0, ...bmRaw.values());
      const vecGate = topVec >= VEC_ABS_FLOOR;
      const bmGate = topBm >= BM25_ABS_FLOOR;

      const merged = new Map();
      for (const key of new Set([...vecRaw.keys(), ...bmRaw.keys()])) {
        const payload = payloads.get(key) || null;
        const meta = bmMeta.get(key) || null;
        const fromMemory = memoryKeys.has(key);
        const vec = vecRaw.get(key) || 0;
        const bm = bmRaw.get(key) || 0;
        const titleFa = payload?.titleFa || (fromMemory ? null : (meta?.titleFa || null));
        const titleEn = payload?.titleEn || (fromMemory ? null : (meta?.titleEn || null));
        const body = fromMemory
          ? (payload?.answer || payload?.question || '')
          : (fa ? (payload?.textFa || payload?.text || '') : (payload?.textEn || payload?.text || ''));
        const title = (fa ? titleFa : titleEn) || titleFa || titleEn || payload?.cite || meta?.title || key;
        const lex = lexicalScore(queryTokens, `${titleFa || ''} ${titleEn || ''} ${payload?.text || meta?.body || ''}`);
        const vecRel = vecGate ? vec / topVec : 0;
        const bmRel = bmGate ? bm / topBm : 0;
        const score = 0.6 * vecRel + 0.4 * Math.max(bmRel, lex * 0.9);
        merged.set(key, {
          id: fromMemory ? key : `cite:${key}`,
          kind: fromMemory ? 'memory' : (payload?.kind || 'knowledge'),
          title,
          text: clip(fromMemory ? body : (body || meta?.body || ''), 500),
          source: payload?.source || meta?.source || 'fbt-knowledge',
          cite: payload?.cite || key,
          category: payload?.category || meta?.category || null,
          status: payload?.status || meta?.status || 'verified',
          lang: payload?.lang || (fa ? 'fa' : 'en'),
          score: Math.round(score * 1e4) / 1e4,
          signals: {
            vector: Math.round(vec * 1e4) / 1e4,
            bm25: Math.round(bm * 1e4) / 1e4,
            lexical: Math.round(lex * 1e4) / 1e4,
            vectorRel: Math.round(vecRel * 1e4) / 1e4,
            bm25Rel: Math.round(bmRel * 1e4) / 1e4
          },
          at: payload?.at || null,
          question: fromMemory ? payload?.question || null : null,
          seen: payload?.seen || null
        });
      }

      let passages = [...merged.values()]
        .filter((p) => p.score >= minScore)
        .filter((p) => !kinds || kinds.includes(p.kind))
        .sort((a, b) => (b.score - a.score) || String(a.id).localeCompare(String(b.id)))
        .slice(0, nLimit);

      if (vector.degraded) counters.degraded += 1;

      return {
        ok: true,
        schema: RAG_SCHEMA,
        version: RAG_VERSION,
        query: clip(q, 200),
        locale: fa ? 'fa' : 'en',
        ownerScoped: Boolean(owner),
        passages,
        sources: passages.map((p) => ({ id: p.id, kind: p.kind, title: p.title, cite: p.cite, source: p.source, score: p.score })),
        stats: {
          ms: now() - started,
          returned: passages.length,
          kbCandidates: (kbHits.rows || []).length,
          memoryCandidates: (memHits.rows || []).length,
          bm25Candidates: (bm25Rows || []).length,
          backend: vector.kind,
          degraded: vector.degraded === true
        }
      };
    },

    async stats() {
      const [kb, mem, health] = await Promise.all([
        vector.count(COLLECTIONS.knowledge).catch(() => ({ count: null })),
        vector.count(COLLECTIONS.memory).catch(() => ({ count: null })),
        vector.health().catch(() => ({ ok: false }))
      ]);
      return {
        schema: RAG_SCHEMA,
        version: RAG_VERSION,
        knowledgePoints: kb?.count ?? null,
        memoryPoints: mem?.count ?? null,
        knowledgeIndexed,
        indexedAt,
        maxMemoryPerOwner,
        backend: vector.kind,
        degraded: vector.degraded === true,
        health,
        counters: { ...counters }
      };
    },

    exportState() { return vector.exportState(); },
    async importState(state) {
      const out = await vector.importState(state);
      if (out?.ok) knowledgeIndexed = Boolean(state?.collections?.[COLLECTIONS.knowledge]?.points?.length);
      return out;
    },
    /** Test hook. */
    _reset() { knowledgeIndexed = false; indexedAt = null; memSeq = 0; for (const k of Object.keys(counters)) counters[k] = 0; }
  };
}

export { lexicalScore as _lexicalScore, clip as _clip, normalizeText as _normalize };
export default createRagMemory;
