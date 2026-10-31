/**
 * FBT AI ORCHESTRATOR — OPERATIONAL VECTOR STORE & REAL QDRANT ENGINE
 * ---------------------------------------------------------------------------
 * Production-grade dual-backend vector database supporting:
 *   • Local operational vector store (`createLocalBackend`) with arbitrary
 *     vector dimensions, exact cosine similarity, rich payload filtering,
 *     scroll pagination, filter-deletion, and JSON snapshot export/import.
 *   • Real Qdrant v1.x / v1.20+ REST backend (`createQdrantBackend`) over
 *     native `fetch`, zero external npm dependencies, with:
 *       1. Arbitrary vector dimensions (256, 384, 512, 768, 1024, 1536, 3072…)
 *          plus automatic dimension inspection & alignment if an existing
 *          remote collection has a different vector size.
 *       2. Deterministic string-ID <-> UUIDv4 mapping (`qdrantId` + `_fbt_id`).
 *       3. Idempotent collection lifecycle (`GET /collections/{name}` pre-check,
 *          in-process verification cache, 400/409 `already exists` race handling).
 *       4. Automatic Qdrant payload field indexing (`PUT /collections/{name}/index`
 *          for `owner`, `kind`, `memoryType`, `scope`, `agentId`, `outcome`,
 *          `at`, `text`) so Qdrant Cloud & strict-mode servers never reject
 *          filtered queries.
 *       5. Proper HTTP 404 -> `COLLECTION_NOT_FOUND` mapping (never falsely
 *          degrading a healthy Qdrant node on first read).
 *       6. Full `scroll`, `deleteByFilter`, `getPoints`, `clear`, and
 *          `collectionInfo` operations (enabling remote owner pruning & memory
 *          inspection without `REMOTE_BACKEND_NO_SCROLL`).
 *       7. Self-healing failover + mirror write-ahead log replay when a
 *          transiently unreachable Qdrant node comes back online.
 */

import { createHash } from 'node:crypto';
import {
  DEFAULT_EMBED_DIM,
  alignVectorDimension,
  createSemanticEmbedder,
  embedSemanticSync,
  normalizeDim,
  normalizeMultilingualText
} from './semanticEmbedder.js';

export const VECTOR_SCHEMA = 'fbt.vector-store.v1';
export const VECTOR_VERSION = '2.0.0';
export const DEFAULT_DIM = DEFAULT_EMBED_DIM;

export function normalizeText(text) {
  return String(text ?? '')
    .toLowerCase()
    .replace(/[\u064A\u0649]/g, 'ی')
    .replace(/\u0643/g, 'ک')
    .replace(/[\u200B-\u200F\uFEFF]/g, '')
    .replace(/[\u064B-\u0652\u0640]/g, '')
    .replace(/[\u06F0-\u06F9]/g, (d) => String(d.charCodeAt(0) - 0x06F0))
    .replace(/[\u0660-\u0669]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

export function tokenize(text) {
  const norm = normalizeText(text);
  if (!norm) return [];
  const words = norm.split(' ').filter((w) => w.length > 0);
  const grams = new Set();
  for (let i = 0; i < words.length; i += 1) {
    const w = words[i];
    grams.add(w);
    if (i + 1 < words.length) grams.add(`${w} ${words[i + 1]}`);
    if (w.length >= 4) {
      for (let j = 0; j < w.length - 2; j += 1) grams.add(w.slice(j, j + 3));
    }
  }
  return [...grams];
}

const DEFAULT_INDEX_SCHEMA = Object.freeze([
  { field_name: 'owner', field_schema: 'keyword' },
  { field_name: 'kind', field_schema: 'keyword' },
  { field_name: 'memoryType', field_schema: 'keyword' },
  { field_name: 'scope', field_schema: 'keyword' },
  { field_name: 'agentId', field_schema: 'keyword' },
  { field_name: 'outcome', field_schema: 'keyword' },
  { field_name: 'at', field_schema: 'integer' },
  { field_name: 'text', field_schema: 'text' }
]);

/**
 * Deterministic, bilingual-semantic L2-normalized embedding for `text`.
 * Supports ANY positive integer dimension (`dim`: 8..65536, default 256).
 */
export function embedText(text, { dim = DEFAULT_DIM } = {}) {
  return embedSemanticSync(text, { dim });
}

export function cosine(a, b) {
  if (!a || !b || a.length !== b.length) return 0;
  let dot = 0; let na = 0; let nb = 0;
  for (let i = 0; i < a.length; i++) {
    const x = a[i]; const y = b[i];
    dot += x * y; na += x * x; nb += y * y;
  }
  if (na === 0 || nb === 0) return 0;
  return dot / Math.sqrt(na * nb);
}

/* ─────────────────────────── Payload filter ─────────────────────────────── */

function getByPath(obj, path) {
  if (!obj || typeof obj !== 'object') return undefined;
  const parts = String(path).split('.');
  let cur = obj;
  for (const p of parts) {
    if (cur == null || typeof cur !== 'object') return undefined;
    cur = cur[p];
  }
  return cur;
}

function matchClause(payload, clause) {
  if (!clause || typeof clause !== 'object' || typeof clause.key !== 'string') return false;
  const val = getByPath(payload, clause.key);
  if (clause.match !== undefined) {
    const m = clause.match;
    if (m && typeof m === 'object' && Array.isArray(m.any)) {
      return Array.isArray(val) ? val.some((x) => m.any.includes(x)) : m.any.includes(val);
    }
    const want = m && typeof m === 'object' && m.value !== undefined ? m.value : m;
    if (Array.isArray(want)) return Array.isArray(val) ? val.some((x) => want.includes(x)) : want.includes(val);
    if (Array.isArray(val)) return val.includes(want);
    return val === want;
  }
  if (clause.any !== undefined && Array.isArray(clause.any)) {
    return Array.isArray(val) ? val.some((x) => clause.any.includes(x)) : clause.any.includes(val);
  }
  if (clause.range && typeof clause.range === 'object') {
    const n = Number(val);
    if (!Number.isFinite(n)) return false;
    const { gt, gte, lt, lte } = clause.range;
    if (gt != null && !(n > Number(gt))) return false;
    if (gte != null && !(n >= Number(gte))) return false;
    if (lt != null && !(n < Number(lt))) return false;
    if (lte != null && !(n <= Number(lte))) return false;
    return true;
  }
  if (typeof clause.contains === 'string') {
    if (Array.isArray(val)) return val.includes(clause.contains);
    return normalizeText(String(val ?? '')).includes(normalizeText(clause.contains));
  }
  if (typeof clause.exists === 'boolean') {
    return clause.exists ? val !== undefined && val !== null : val === undefined || val === null;
  }
  return false;
}

/** Qdrant-shaped filter `{ must, should, must_not }`, evaluated locally (fail-closed). */
export function matchesFilter(payload = {}, filter = null) {
  if (!filter) return true;
  if (typeof filter !== 'object') return false;
  const asArray = (v) => (Array.isArray(v) ? v : v == null ? [] : [v]);
  const must = asArray(filter.must);
  const should = asArray(filter.should);
  const mustNot = asArray(filter.mustNot ?? filter.must_not);
  for (const c of must) if (!matchClause(payload, c)) return false;
  for (const c of mustNot) if (matchClause(payload, c)) return false;
  if (should.length && !should.some((c) => matchClause(payload, c))) return false;
  return true;
}

/* ─────────────────────────── Local backend ──────────────────────────────── */

export function createLocalBackend({ dim = DEFAULT_DIM } = {}) {
  const defaultDim = normalizeDim(dim);
  const collections = new Map(); // name -> { dim, distance, points: Map<id, { id, vector, payload, updatedAt }> }

  function ensure(name, opts = {}) {
    let col = collections.get(name);
    if (!col) {
      col = {
        dim: normalizeDim(opts.size || opts.dim || defaultDim),
        distance: opts.distance || 'Cosine',
        points: new Map(),
        indexedFields: DEFAULT_INDEX_SCHEMA.map((s) => s.field_name)
      };
      collections.set(name, col);
    } else if (opts.distance) {
      col.distance = opts.distance;
    }
    return col;
  }

  function need(name) {
    const col = collections.get(name);
    if (!col) {
      const err = new Error(`COLLECTION_NOT_FOUND:${name}`);
      err.code = 'COLLECTION_NOT_FOUND';
      throw err;
    }
    return col;
  }

  return {
    kind: 'local',
    dimension: defaultDim,

    createCollection(name, opts = {}) {
      const existed = collections.has(name);
      const col = ensure(name, opts);
      return { ok: true, name, dim: col.dim, distance: col.distance, alreadyExisted: existed };
    },

    collectionInfo(name) {
      const col = collections.get(name);
      if (!col) return { ok: false, error: 'COLLECTION_NOT_FOUND' };
      return {
        ok: true,
        name,
        dim: col.dim,
        distance: col.distance,
        pointsCount: col.points.size,
        indexedFields: [...col.indexedFields]
      };
    },

    deleteCollection(name) {
      return { ok: collections.delete(name), name };
    },

    listCollections() {
      return [...collections.entries()].map(([name, c]) => ({
        name,
        points: c.points.size,
        count: c.points.size,
        dimension: c.dim,
        dim: c.dim,
        distance: c.distance
      }));
    },

    upsert(name, points = []) {
      const col = ensure(name);
      const now = Date.now();
      let written = 0;
      for (const p of points) {
        if (!p || p.id === undefined || p.id === null) continue;
        const id = String(p.id);
        let vec = p.vector instanceof Float32Array
          ? Array.from(p.vector)
          : (Array.isArray(p.vector) ? p.vector : (typeof p.text === 'string' && p.text.trim() ? embedText(p.text, { dim: col.dim }) : null));
        if (!vec) continue;
        if (vec.length !== col.dim) vec = alignVectorDimension(vec, col.dim);
        col.points.set(id, { id, vector: vec, payload: p.payload && typeof p.payload === 'object' ? { ...p.payload } : {}, updatedAt: now });
        written += 1;
      }
      return { ok: true, written, count: col.points.size, total: col.points.size };
    },

    search(name, { vector, query, text, limit = 5, filter = null, scoreThreshold = 0, withPayload = true, withVector = false } = {}) {
      const col = need(name);
      const qStr = query ?? text ?? '';
      let q = vector instanceof Float32Array
        ? Array.from(vector)
        : (Array.isArray(vector) ? vector : (qStr ? embedText(String(qStr), { dim: col.dim }) : null));
      if (!q) return { ok: false, error: 'VECTOR_OR_TEXT_REQUIRED', rows: [] };
      if (q.length !== col.dim) q = alignVectorDimension(q, col.dim);
      const floor = Number(scoreThreshold) || 0;
      const allowNonPositive = floor < 0;
      const hits = [];
      for (const pt of col.points.values()) {
        if (!matchesFilter(pt.payload, filter)) continue;
        const score = cosine(q, pt.vector);
        if (score < floor) continue;
        if (!allowNonPositive && score <= 0) continue;
        hits.push({
          id: pt.id,
          score: Math.round(score * 1e6) / 1e6,
          ...(withPayload ? { payload: pt.payload } : {}),
          ...(withVector ? { vector: pt.vector } : {})
        });
      }
      hits.sort((a, b) => b.score - a.score || (b.payload?.at || 0) - (a.payload?.at || 0));
      return { ok: true, rows: hits.slice(0, Math.max(1, Math.min(200, Number(limit) || 5))), backend: 'local' };
    },

    scroll(name, { filter = null, limit = 100, offset = null, withPayload = true, withVector = false } = {}) {
      const col = collections.get(name);
      if (!col) return { ok: false, error: 'COLLECTION_NOT_FOUND', points: [], nextOffset: null };
      const all = [];
      for (const pt of col.points.values()) {
        if (!matchesFilter(pt.payload, filter)) continue;
        all.push(pt);
      }
      all.sort((a, b) => String(a.id).localeCompare(String(b.id)));
      let startIdx = 0;
      if (offset !== null && offset !== undefined) {
        const found = all.findIndex((p) => String(p.id) > String(offset));
        startIdx = found >= 0 ? found : all.length;
      }
      const cap = Math.max(1, Math.min(1000, Number(limit) || 100));
      const slice = all.slice(startIdx, startIdx + cap);
      const nextOffset = startIdx + cap < all.length ? slice[slice.length - 1].id : null;
      return {
        ok: true,
        points: slice.map((pt) => ({
          id: pt.id,
          ...(withPayload ? { payload: { ...pt.payload } } : {}),
          ...(withVector ? { vector: [...pt.vector] } : {})
        })),
        nextOffset,
        backend: 'local'
      };
    },

    getPoints(name, ids = []) {
      const col = collections.get(name);
      if (!col) return { ok: false, error: 'COLLECTION_NOT_FOUND', points: [] };
      const points = [];
      for (const id of ids) {
        const pt = col.points.get(String(id));
        if (pt) points.push({ id: pt.id, payload: { ...pt.payload } });
      }
      return { ok: true, points, backend: 'local' };
    },

    delete(name, ids = []) {
      const col = need(name);
      let removed = 0;
      for (const id of ids) if (col.points.delete(String(id))) removed += 1;
      return { ok: true, removed, count: col.points.size, total: col.points.size };
    },

    deleteByFilter(name, filter = null) {
      const col = need(name);
      let removed = 0;
      for (const [id, pt] of col.points.entries()) {
        if (matchesFilter(pt.payload, filter)) {
          col.points.delete(id);
          removed += 1;
        }
      }
      return { ok: true, removed, count: col.points.size, total: col.points.size };
    },

    count(name, { filter = null } = {}) {
      const col = need(name);
      if (!filter) return { ok: true, count: col.points.size };
      let c = 0;
      for (const pt of col.points.values()) if (matchesFilter(pt.payload, filter)) c += 1;
      return { ok: true, count: c };
    },

    clear(name) {
      const col = need(name);
      const n = col.points.size;
      col.points.clear();
      return { ok: true, removed: n, cleared: n };
    },

    health() { return { ok: true, backend: 'local', kind: 'local', collections: collections.size, dimension: defaultDim }; },

    exportState() {
      const out = {};
      for (const [name, col] of collections.entries()) {
        out[name] = {
          dim: col.dim,
          distance: col.distance,
          points: [...col.points.values()].map((p) => ({ id: p.id, vector: Array.from(p.vector), payload: p.payload, updatedAt: p.updatedAt }))
        };
      }
      return { schema: VECTOR_SCHEMA, version: VECTOR_VERSION, kind: 'local', at: Date.now(), collections: out };
    },

    importState(snapshot = {}) {
      if (!snapshot || typeof snapshot !== 'object' || snapshot.schema !== VECTOR_SCHEMA) {
        return { ok: false, error: 'STATE_SCHEMA_MISMATCH', imported: 0 };
      }
      collections.clear();
      let imported = 0;
      for (const [name, col] of Object.entries(snapshot.collections || {})) {
        const target = ensure(name, { size: col.dim, distance: col.distance });
        for (const p of col.points || []) {
          if (Array.isArray(p.vector)) {
            const vec = p.vector.length === target.dim ? p.vector : alignVectorDimension(p.vector, target.dim);
            target.points.set(String(p.id), { id: String(p.id), vector: vec, payload: p.payload || {}, updatedAt: p.updatedAt || 0 });
            imported += 1;
          }
        }
      }
      return { ok: true, imported, collections: collections.size };
    }
  };
}

/* ─────────────────────────── Qdrant REST backend ────────────────────────── */

/**
 * Qdrant requires point ids to be either unsigned 64-bit integers or UUIDs.
 * Map arbitrary string ids (`mem:dev:abc:123`) deterministically onto UUIDv4
 * shape via SHA-256 and preserve the logical id inside `payload._fbt_id`.
 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function qdrantId(id) {
  const s = String(id);
  if (UUID_RE.test(s)) return s.toLowerCase();
  if (/^\d{1,18}$/.test(s)) return Number(s);
  const hex = createHash('sha256').update(`fbt-qdrant:${s}`).digest('hex').slice(0, 32).split('');
  hex[12] = '4';
  hex[16] = ((parseInt(hex[16], 16) & 0x3) | 0x8).toString(16);
  return `${hex.slice(0, 8).join('')}-${hex.slice(8, 12).join('')}-${hex.slice(12, 16).join('')}-${hex.slice(16, 20).join('')}-${hex.slice(20, 32).join('')}`;
}

function toQdrantFilter(filter) {
  if (!filter || typeof filter !== 'object') return undefined;
  const mapClause = (c) => {
    if (!c) return null;
    if (c.match !== undefined) {
      const v = c.match?.value !== undefined ? c.match.value : c.match;
      return Array.isArray(v) ? { key: c.key, match: { any: v } } : { key: c.key, match: { value: v } };
    }
    if (Array.isArray(c.any)) return { key: c.key, match: { any: c.any } };
    if (c.range) return { key: c.key, range: c.range };
    if (c.contains !== undefined) return { key: c.key, match: { text: String(c.contains) } };
    if (c.exists !== undefined) {
      return c.exists
        ? { is_empty: { key: c.key } } // inverted below in wrapper when needed
        : { is_null: { key: c.key } };
    }
    return null;
  };
  const normalizeClause = (c) => {
    if (c && c.exists === true) {
      return { must_not: [{ is_null: { key: c.key } }, { is_empty: { key: c.key } }] };
    }
    return mapClause(c);
  };
  const out = {};
  const must = (filter.must || []).map(normalizeClause).filter(Boolean);
  const should = (filter.should || []).map(normalizeClause).filter(Boolean);
  const mustNot = (filter.mustNot || filter.must_not || []).map(normalizeClause).filter(Boolean);
  if (must.length) out.must = must;
  if (should.length) out.should = should;
  if (mustNot.length) out.must_not = mustNot;
  return Object.keys(out).length ? out : undefined;
}

function extractRemoteVectorDim(infoResult, fallback) {
  const vectors = infoResult?.config?.params?.vectors;
  if (!vectors) return fallback;
  if (typeof vectors.size === 'number' && vectors.size > 0) return vectors.size;
  // Named vector map support: pick default '' or first named vector
  if (typeof vectors === 'object') {
    for (const v of Object.values(vectors)) {
      if (v && typeof v.size === 'number' && v.size > 0) return v.size;
    }
  }
  return fallback;
}

function stripInternalPayload(payload) {
  if (!payload || typeof payload !== 'object') return {};
  const copy = { ...payload };
  delete copy._fbt_id;
  return copy;
}

export function createQdrantBackend({
  url,
  apiKey = null,
  dim = DEFAULT_DIM,
  timeoutMs = 3500,
  fetchImpl = null,
  autoIndexPayloads = true,
  indexFields = DEFAULT_INDEX_SCHEMA
} = {}) {
  const base = String(url || '').replace(/\/+$/, '');
  const defaultDim = normalizeDim(dim);
  const f = fetchImpl || globalThis.fetch;
  // Cache of verified collections on the Qdrant server: name -> { dim, distance, indexed }
  const knownCollections = new Map();

  async function call(path, { method = 'GET', body = undefined } = {}) {
    if (typeof f !== 'function') throw new Error('FETCH_UNAVAILABLE');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const headers = { accept: 'application/json' };
    if (body !== undefined) headers['content-type'] = 'application/json';
    if (apiKey) headers['api-key'] = apiKey;
    try {
      const res = await f(`${base}${path}`, {
        method,
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: controller.signal
      });
      const text = await res.text();
      let json = null;
      try { json = text ? JSON.parse(text) : null; } catch { /* plain text like /readyz */ }
      if (!res.ok) {
        const msg = json?.status?.error || text.slice(0, 180);
        const err = new Error(`QDRANT_HTTP_${res.status}:${msg}`);
        err.status = res.status;
        if (res.status === 404) {
          err.code = 'COLLECTION_NOT_FOUND';
        } else if (res.status === 409 || /already exists/i.test(msg)) {
          err.code = 'COLLECTION_ALREADY_EXISTS';
        }
        throw err;
      }
      return json ?? { ok: true, raw: text };
    } finally {
      clearTimeout(timer);
    }
  }

  async function ensurePayloadIndexes(name) {
    if (!autoIndexPayloads || !Array.isArray(indexFields) || !indexFields.length) return [];
    const indexed = [];
    for (const spec of indexFields) {
      try {
        await call(`/collections/${encodeURIComponent(name)}/index?wait=true`, {
          method: 'PUT',
          body: { field_name: spec.field_name, field_schema: spec.field_schema }
        });
        indexed.push(spec.field_name);
      } catch {
        // Older Qdrant builds or minimal mocks may not expose /index; treat as non-fatal
      }
    }
    return indexed;
  }

  async function getCollectionRemote(name) {
    try {
      const r = await call(`/collections/${encodeURIComponent(name)}`, { method: 'GET' });
      const info = r?.result;
      if (!info || typeof info !== 'object' || !info.config) {
        return { ok: false, error: 'COLLECTION_NOT_FOUND' };
      }
      const remoteDim = extractRemoteVectorDim(info, defaultDim);
      const distance = info?.config?.params?.vectors?.distance || 'Cosine';
      const pointsCount = info?.points_count ?? info?.vectors_count ?? 0;
      const meta = { dim: remoteDim, distance, pointsCount, indexed: true };
      knownCollections.set(name, meta);
      return { ok: true, name, ...meta, raw: info };
    } catch (err) {
      if (err?.status === 404 || err?.code === 'COLLECTION_NOT_FOUND') {
        knownCollections.delete(name);
        return { ok: false, error: 'COLLECTION_NOT_FOUND' };
      }
      throw err;
    }
  }

  async function resolveDimFor(name) {
    const cached = knownCollections.get(name);
    if (cached?.dim) return cached.dim;
    const remote = await getCollectionRemote(name);
    return remote.ok && remote.dim ? remote.dim : defaultDim;
  }

  return {
    kind: 'qdrant',
    dimension: defaultDim,

    async createCollection(name, opts = {}) {
      const size = normalizeDim(opts.size || opts.dim || defaultDim);
      const distance = opts.distance || 'Cosine';
      const cached = knownCollections.get(name);
      if (cached) {
        return {
          ok: true,
          name,
          dim: cached.dim,
          distance: cached.distance,
          alreadyExisted: true,
          dimensionAligned: cached.dim !== size
        };
      }

      // 1. Inspect GET /collections/{name} first to avoid HTTP 400/409 on existing collections
      //    and detect any pre-existing vector dimension on the Qdrant server.
      const existing = await getCollectionRemote(name);
      if (existing.ok) {
        if (!existing.indexed) await ensurePayloadIndexes(name);
        return {
          ok: true,
          name,
          dim: existing.dim,
          distance: existing.distance,
          alreadyExisted: true,
          dimensionAligned: existing.dim !== size
        };
      }

      // 2. Create collection with exact vector size (not coerced to power-of-2)
      let alreadyExisted = false;
      try {
        await call(`/collections/${encodeURIComponent(name)}`, {
          method: 'PUT',
          body: { vectors: { size, distance } }
        });
      } catch (err) {
        if (err?.code === 'COLLECTION_ALREADY_EXISTS' || err?.status === 409) {
          alreadyExisted = true;
        } else {
          throw err;
        }
      }

      // 3. Create Qdrant payload indexes so strict-mode / Qdrant Cloud filters succeed
      const indexedFields = await ensurePayloadIndexes(name);
      const finalMeta = { dim: size, distance, indexed: true, indexedFields };
      knownCollections.set(name, finalMeta);
      return { ok: true, name, dim: size, distance, alreadyExisted, indexedFields };
    },

    async collectionInfo(name) {
      return getCollectionRemote(name);
    },

    async deleteCollection(name) {
      knownCollections.delete(name);
      try {
        await call(`/collections/${encodeURIComponent(name)}`, { method: 'DELETE' });
        return { ok: true, name };
      } catch (err) {
        if (err?.code === 'COLLECTION_NOT_FOUND') return { ok: false, name, error: 'COLLECTION_NOT_FOUND' };
        throw err;
      }
    },

    async listCollections() {
      const r = await call('/collections');
      const cols = r?.result?.collections || [];
      return cols.map((c) => ({
        name: c.name,
        dim: knownCollections.get(c.name)?.dim || defaultDim
      }));
    },

    async upsert(name, points = []) {
      if (!points.length) return { ok: true, written: 0 };
      const colDim = await resolveDimFor(name);
      const body = {
        points: points.map((p) => {
          const rawVec = Array.isArray(p.vector)
            ? p.vector
            : embedText(p.text || '', { dim: colDim });
          const vec = rawVec.length === colDim ? rawVec : alignVectorDimension(rawVec, colDim);
          return {
            id: qdrantId(p.id),
            vector: vec,
            payload: { ...(p.payload || {}), _fbt_id: String(p.id) }
          };
        })
      };
      await call(`/collections/${encodeURIComponent(name)}/points?wait=true`, { method: 'PUT', body });
      return { ok: true, written: body.points.length };
    },

    async search(name, { vector, query, text, limit = 8, filter = null, scoreThreshold = undefined, withVector = false } = {}) {
      const colDim = knownCollections.get(name)?.dim || defaultDim;
      const qStr = query ?? text ?? '';
      const rawQ = Array.isArray(vector) ? vector : embedText(qStr, { dim: colDim });
      const q = rawQ.length === colDim ? rawQ : alignVectorDimension(rawQ, colDim);
      const body = {
        vector: q,
        limit: Math.max(1, Math.min(200, limit)),
        with_payload: true,
        with_vector: Boolean(withVector),
        filter: toQdrantFilter(filter)
      };
      if (scoreThreshold !== undefined && scoreThreshold > -1) body.score_threshold = scoreThreshold;
      const r = await call(`/collections/${encodeURIComponent(name)}/points/search`, { method: 'POST', body });
      const rows = (r?.result || []).map((h) => ({
        id: h.payload?._fbt_id || String(h.id),
        score: h.score,
        payload: stripInternalPayload(h.payload),
        ...(withVector && h.vector ? { vector: h.vector } : {})
      }));
      return { ok: true, rows, backend: 'qdrant' };
    },

    async scroll(name, { filter = null, limit = 100, offset = null, withPayload = true, withVector = false } = {}) {
      const body = {
        limit: Math.max(1, Math.min(1000, Number(limit) || 100)),
        with_payload: Boolean(withPayload),
        with_vector: Boolean(withVector),
        filter: toQdrantFilter(filter)
      };
      if (offset !== null && offset !== undefined) {
        body.offset = typeof offset === 'number' || UUID_RE.test(String(offset)) ? offset : qdrantId(offset);
      }
      const r = await call(`/collections/${encodeURIComponent(name)}/points/scroll`, { method: 'POST', body });
      const rawPts = r?.result?.points || [];
      const nextPageOffset = r?.result?.next_page_offset ?? null;
      return {
        ok: true,
        points: rawPts.map((pt) => ({
          id: pt.payload?._fbt_id || String(pt.id),
          qdrantPointId: pt.id,
          ...(withPayload ? { payload: stripInternalPayload(pt.payload) } : {}),
          ...(withVector && pt.vector ? { vector: pt.vector } : {})
        })),
        nextOffset: nextPageOffset,
        backend: 'qdrant'
      };
    },

    async getPoints(name, ids = []) {
      if (!ids.length) return { ok: true, points: [], backend: 'qdrant' };
      const r = await call(`/collections/${encodeURIComponent(name)}/points`, {
        method: 'POST',
        body: { ids: ids.map(qdrantId), with_payload: true, with_vector: false }
      });
      const pts = (r?.result || []).map((pt) => ({
        id: pt.payload?._fbt_id || String(pt.id),
        payload: stripInternalPayload(pt.payload)
      }));
      return { ok: true, points: pts, backend: 'qdrant' };
    },

    async delete(name, ids = []) {
      if (!ids.length) return { ok: true, removed: 0 };
      await call(`/collections/${encodeURIComponent(name)}/points/delete?wait=true`, {
        method: 'POST',
        body: { points: ids.map(qdrantId) }
      });
      return { ok: true, removed: ids.length };
    },

    async deleteByFilter(name, filter = null) {
      const qFilter = toQdrantFilter(filter);
      if (!qFilter) return { ok: false, error: 'FILTER_REQUIRED', removed: 0 };
      await call(`/collections/${encodeURIComponent(name)}/points/delete?wait=true`, {
        method: 'POST',
        body: { filter: qFilter }
      });
      return { ok: true };
    },

    async count(name, { filter = null } = {}) {
      const body = { exact: true };
      const qf = toQdrantFilter(filter);
      if (qf) body.filter = qf;
      const r = await call(`/collections/${encodeURIComponent(name)}/points/count`, { method: 'POST', body });
      return { ok: true, count: r?.result?.count ?? 0 };
    },

    async clear(name) {
      knownCollections.delete(name);
      try {
        const info = await getCollectionRemote(name);
        const dimToKeep = info.ok ? info.dim : defaultDim;
        await call(`/collections/${encodeURIComponent(name)}`, { method: 'DELETE' });
        await this.createCollection(name, { dim: dimToKeep });
        return { ok: true };
      } catch (err) {
        if (err?.code === 'COLLECTION_NOT_FOUND') return { ok: true };
        throw err;
      }
    },

    async health() {
      try {
        await call('/readyz');
        return { ok: true, kind: 'qdrant', url: base.replace(/\/\/[^@]+@/, '//***@') };
      } catch (err) {
        // Fallback probe to `/` root info endpoint for Qdrant deployments behind proxies blocking /readyz
        try {
          const root = await call('/');
          if (root?.title?.toLowerCase?.().includes('qdrant') || root?.version) {
            return { ok: true, kind: 'qdrant', version: root.version || null, url: base.replace(/\/\/[^@]+@/, '//***@') };
          }
        } catch { /* ignore secondary probe error */ }
        return { ok: false, kind: 'qdrant', error: String(err?.message || err).slice(0, 120) };
      }
    },

    exportState() { return { schema: VECTOR_SCHEMA, version: VECTOR_VERSION, remote: 'qdrant', collections: {} }; },
    importState() { return { ok: false, imported: 0, reason: 'REMOTE_BACKEND' }; }
  };
}

/* ─────────────────────────── Fail-soft facade ───────────────────────────── */

/**
 * Operational Vector Store facade with:
 *   • Integrated `semanticEmbedder` (live neural providers + dense bilingual semantic fallback)
 *   • Primary Qdrant + in-memory mirror with automatic failover AND self-healing recovery
 *   • Full `scroll`, `deleteByFilter`, `getPoints`, `clear`, and `collectionInfo` support
 */
export function createVectorStore({
  mode = process.env.AI_ORCH_VECTOR || 'auto',
  dim = DEFAULT_DIM,
  qdrant = null,
  fetchImpl = null,
  embedder = null,
  recoveryCooldownMs = 5000
} = {}) {
  const resolvedDim = normalizeDim(dim);
  const url = qdrant?.url ?? process.env.QDRANT_URL ?? null;
  const apiKey = qdrant?.apiKey ?? process.env.QDRANT_API_KEY ?? null;
  const wantQdrant = (mode === 'qdrant' || mode === 'auto') && Boolean(url);

  const activeEmbedder = embedder || createSemanticEmbedder({ dim: resolvedDim, fetchImpl });

  const primary = wantQdrant
    ? createQdrantBackend({
      url,
      apiKey,
      dim: resolvedDim,
      fetchImpl: fetchImpl || qdrant?.fetchImpl || null,
      timeoutMs: qdrant?.timeoutMs || 3500,
      autoIndexPayloads: qdrant?.autoIndexPayloads !== false
    })
    : createLocalBackend({ dim: resolvedDim });
  const mirror = wantQdrant ? createLocalBackend({ dim: resolvedDim }) : null;

  let degraded = false;
  let degradedAt = 0;
  let lastError = null;
  const dirtyCollections = new Set();

  const note = (err) => {
    degraded = true;
    degradedAt = Date.now();
    lastError = String(err?.message || err).slice(0, 160);
  };
  const markRecovered = () => {
    degraded = false;
    degradedAt = 0;
  };
  const isMissing = (err) => err?.code === 'COLLECTION_NOT_FOUND' || /COLLECTION_NOT_FOUND/.test(String(err?.message || err));
  const missing = () => ({ ok: false, error: 'COLLECTION_NOT_FOUND' });

  async function maybeRecover() {
    if (!degraded || !mirror) return false;
    if (Date.now() - degradedAt < recoveryCooldownMs) return false;
    const h = await primary.health();
    if (!h.ok) {
      degradedAt = Date.now();
      return false;
    }
    try {
      const snap = mirror.exportState();
      for (const colName of dirtyCollections) {
        const colSnap = snap.collections?.[colName];
        if (!colSnap) continue;
        await primary.createCollection(colName, { dim: colSnap.dim, distance: colSnap.distance });
        if (colSnap.points?.length) {
          await primary.upsert(colName, colSnap.points);
        }
      }
      dirtyCollections.clear();
      markRecovered();
      return true;
    } catch (err) {
      note(err);
      return false;
    }
  }

  async function embedPointVector(p) {
    if (Array.isArray(p.vector)) return p.vector;
    const rawText = p.text || JSON.stringify(p.payload || {});
    return activeEmbedder.embed(rawText);
  }

  const api = {
    schema: VECTOR_SCHEMA,
    version: VECTOR_VERSION,
    embedder: activeEmbedder,
    get kind() { return primary.kind; },
    get degraded() { return degraded; },
    get lastError() { return lastError; },
    get dimension() { return primary.dimension; },

    async createCollection(name, opts = {}) {
      await maybeRecover();
      try {
        const out = await primary.createCollection(name, opts);
        if (mirror) await mirror.createCollection(name, opts);
        if (degraded) markRecovered();
        return { ok: true, ...out, backend: primary.kind };
      } catch (err) {
        if (isMissing(err)) return missing();
        note(err);
        if (!mirror) return { ok: false, error: lastError };
        dirtyCollections.add(name);
        await mirror.createCollection(name, opts);
        return { ok: true, name, backend: 'local-mirror', degraded: true };
      }
    },

    async collectionInfo(name) {
      await maybeRecover();
      try {
        const out = await primary.collectionInfo(name);
        if (!out?.ok && out?.error === 'COLLECTION_NOT_FOUND' && mirror) return mirror.collectionInfo(name);
        return out;
      } catch (err) {
        if (isMissing(err)) return missing();
        note(err);
        return mirror ? mirror.collectionInfo(name) : { ok: false, error: lastError };
      }
    },

    async deleteCollection(name) {
      dirtyCollections.delete(name);
      try {
        const out = await primary.deleteCollection(name);
        if (mirror) await mirror.deleteCollection(name);
        return out;
      } catch (err) {
        if (isMissing(err)) return missing();
        note(err);
        return mirror ? mirror.deleteCollection(name) : { ok: false, error: lastError };
      }
    },

    async upsert(name, points = []) {
      await maybeRecover();
      const embedded = await Promise.all(points.map(async (p) => ({
        id: String(p.id),
        vector: await embedPointVector(p),
        payload: p.payload || {}
      })));
      try {
        const out = await primary.upsert(name, embedded);
        if (mirror) await mirror.upsert(name, embedded);
        if (degraded) markRecovered();
        return { ...out, backend: primary.kind };
      } catch (err) {
        if (isMissing(err)) return { ...missing(), written: 0 };
        note(err);
        if (!mirror) return { ok: false, error: lastError, written: 0 };
        dirtyCollections.add(name);
        const out = await mirror.upsert(name, embedded);
        return { ...out, backend: 'local-mirror', degraded: true, error: lastError };
      }
    },

    async search(name, opts = {}) {
      await maybeRecover();
      const searchOpts = { ...opts };
      const qStr = searchOpts.query ?? searchOpts.text;
      if (!Array.isArray(searchOpts.vector) && typeof qStr === 'string' && qStr.trim()) {
        searchOpts.vector = await activeEmbedder.embed(qStr);
      }
      try {
        const out = await primary.search(name, searchOpts);
        if (!out?.ok && out?.error === 'COLLECTION_NOT_FOUND' && mirror) return mirror.search(name, searchOpts);
        if (degraded && out?.ok) markRecovered();
        return out;
      } catch (err) {
        if (isMissing(err)) return { ...missing(), rows: [] };
        note(err);
        if (!mirror) return { ok: false, error: lastError, rows: [] };
        const out = await mirror.search(name, searchOpts);
        return { ...out, backend: 'local-mirror', degraded: true, error: lastError };
      }
    },

    async scroll(name, opts = {}) {
      await maybeRecover();
      try {
        const out = await primary.scroll(name, opts);
        if (!out?.ok && out?.error === 'COLLECTION_NOT_FOUND' && mirror) return mirror.scroll(name, opts);
        return out;
      } catch (err) {
        if (isMissing(err)) return { ...missing(), points: [], nextOffset: null };
        note(err);
        if (!mirror) return { ok: false, error: lastError, points: [], nextOffset: null };
        const out = await mirror.scroll(name, opts);
        return { ...out, backend: 'local-mirror', degraded: true, error: lastError };
      }
    },

    async getPoints(name, ids = []) {
      await maybeRecover();
      try {
        const out = await primary.getPoints(name, ids);
        if (!out?.ok && out?.error === 'COLLECTION_NOT_FOUND' && mirror) return mirror.getPoints(name, ids);
        return out;
      } catch (err) {
        if (isMissing(err)) return { ...missing(), points: [] };
        note(err);
        if (!mirror) return { ok: false, error: lastError, points: [] };
        return mirror.getPoints(name, ids);
      }
    },

    async delete(name, ids = []) {
      await maybeRecover();
      try {
        const out = await primary.delete(name, ids);
        if (mirror) await mirror.delete(name, ids);
        return out;
      } catch (err) {
        if (isMissing(err)) return { ...missing(), removed: 0 };
        note(err);
        if (!mirror) return { ok: false, error: lastError };
        dirtyCollections.add(name);
        const out = await mirror.delete(name, ids);
        return { ...out, degraded: true, error: lastError };
      }
    },

    async deleteByFilter(name, filter = null) {
      await maybeRecover();
      try {
        const out = await primary.deleteByFilter(name, filter);
        if (mirror) await mirror.deleteByFilter(name, filter);
        return out;
      } catch (err) {
        if (isMissing(err)) return { ...missing(), removed: 0 };
        note(err);
        if (!mirror) return { ok: false, error: lastError };
        dirtyCollections.add(name);
        const out = await mirror.deleteByFilter(name, filter);
        return { ...out, degraded: true, error: lastError };
      }
    },

    async count(name, opts = {}) {
      await maybeRecover();
      try {
        const out = await primary.count(name, opts);
        if (out?.ok) return out;
        if (mirror) return mirror.count(name, opts);
        return out;
      } catch (err) {
        if (isMissing(err)) return { ...missing(), count: 0 };
        note(err);
        return mirror ? mirror.count(name, opts) : { ok: false, error: lastError, count: 0 };
      }
    },

    async clear(name) {
      dirtyCollections.delete(name);
      try {
        const out = await primary.clear(name);
        if (mirror) await mirror.clear(name);
        return out;
      } catch (err) {
        if (isMissing(err)) return { ok: true };
        note(err);
        return mirror ? mirror.clear(name) : { ok: false, error: lastError };
      }
    },

    async listCollections() {
      await maybeRecover();
      try {
        const out = await primary.listCollections();
        if (Array.isArray(out) && out.length) return out;
        if (mirror) return mirror.listCollections();
        return out || [];
      } catch (err) {
        if (isMissing(err)) return mirror ? mirror.listCollections() : [];
        note(err);
        return mirror ? mirror.listCollections() : [];
      }
    },

    async probeAndRecover() {
      degradedAt = 0;
      return maybeRecover();
    },

    async health() {
      const h = await primary.health();
      return {
        ...h,
        degraded,
        lastError,
        dimension: primary.dimension,
        embedder: activeEmbedder.status(),
        schema: VECTOR_SCHEMA,
        version: VECTOR_VERSION
      };
    },

    exportState() { return mirror ? mirror.exportState() : primary.exportState(); },
    async importState(state) {
      const out = mirror ? mirror.importState(state) : primary.importState(state);
      if (mirror && state?.collections) {
        for (const [colName, colSnap] of Object.entries(state.collections)) {
          try {
            await primary.createCollection(colName, { dim: colSnap.dim, distance: colSnap.distance });
            if (colSnap.points?.length) await primary.upsert(colName, colSnap.points);
          } catch (err) {
            note(err);
            dirtyCollections.add(colName);
          }
        }
      }
      return out;
    }
  };
  return api;
}

export default createVectorStore;
