/**
 * FBT AI ORCHESTRATOR — VECTOR MEMORY (Qdrant-shaped, dependency-free)
 * ---------------------------------------------------------------------------
 * What this is: the retrieval half of RAG, with the API shape of Qdrant
 * (qdrant/qdrant, Apache-2.0) so a real Qdrant can be dropped in later without
 * touching a single caller:
 *
 *     createCollection(name, { size, distance })
 *     upsert(name, points)            // [{ id, vector?, payload }]
 *     search(name, { vector | text, limit, filter, scoreThreshold })
 *     delete(name, ids) / count(name) / listCollections()
 *
 * Why not the `qdrant-js` client plus a Qdrant server: this API runs as ONE
 * Vercel function on a small host. A second always-on container (Qdrant wants
 * ~1 GB RAM) for a corpus of a few hundred verified passages would cost more
 * than the entire app, and a network hop inside the chat deadline is a new way
 * for the assistant to time out. So the default backend is embedded, and a
 * remote Qdrant is used ONLY when the operator sets QDRANT_URL — same method
 * signatures, one env var, no code change.
 *
 * Embeddings are DETERMINISTIC and LOCAL: signed feature hashing over word
 * unigrams, word bigrams and character trigrams (so «کیفپولم» and «کیف پول»
 * land near each other, and an English question can still match a Persian
 * sentence through a shared token). No model download, no per-token cost, no
 * network — which is what makes the answer reproducible in a probe.
 *
 * Honesty: this is a lexical/morphological vector space, not a semantic one.
 * It is combined with the BM25 retriever (src/lib/intent-ai/retrieval.js) in
 * ragMemory.js, and the hybrid score is reported per passage so an answer can
 * say which half found it.
 */

export const VECTOR_SCHEMA = 'fbt.vector-store.v1';
export const VECTOR_VERSION = '14.0.0';
export const DEFAULT_DIM = 256;

const FNV_OFFSET = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

function fnv1a(str) {
  let h = FNV_OFFSET;
  for (let i = 0; i < str.length; i += 1) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, FNV_PRIME) >>> 0;
  }
  return h >>> 0;
}

/** Persian/Arabic-aware normalisation (same rules the intent engine uses). */
export function normalizeText(text) {
  return String(text ?? '')
    .toLowerCase()
    .replace(/[\u064A\u0649]/g, 'ی')          // ي / ى → ی
    .replace(/\u0643/g, 'ک')                  // ك → ک
    .replace(/[\u200B-\u200F\uFEFF]/g, '')    // ZWNJ and friends removed, not spaced
    .replace(/[\u064B-\u0652\u0640]/g, '')    // diacritics + tatweel
    .replace(/[\u06F0-\u06F9]/g, (d) => String(d.charCodeAt(0) - 0x06F0)) // ۰-۹ → 0-9
    .replace(/[\u0660-\u0669]/g, (d) => String(d.charCodeAt(0) - 0x0660)) // ٠-٩ → 0-9
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

/**
 * Deterministic signed-hash embedding. `dim` must be a power of two for the
 * cheap mask; the factory pads to one.
 */
export function embedText(text, { dim = DEFAULT_DIM } = {}) {
  const size = nextPowerOfTwo(dim);
  const vec = new Float32Array(size);
  const n = normalizeText(text);
  if (!n) return vec;
  for (const gram of tokenize(text)) {
    const h = fnv1a(gram);
    const idx = h & (size - 1);
    const sign = (h >>> 31) & 1 ? -1 : 1;
    /* Length-aware weight: single words carry the meaning, bigrams/trigrams
       stabilise morphology without letting a long document drown a short one. */
    const weight = gram.includes(' ') ? 0.55 : gram.length === 3 ? 0.3 : 1;
    vec[idx] += sign * weight;
  }
  let norm = 0;
  for (let i = 0; i < size; i += 1) norm += vec[i] * vec[i];
  norm = Math.sqrt(norm) || 1;
  for (let i = 0; i < size; i += 1) vec[i] /= norm;
  return vec;
}

function nextPowerOfTwo(n) {
  const v = Math.max(32, Math.min(4096, Number(n) || DEFAULT_DIM));
  let p = 32;
  while (p < v) p *= 2;
  return p;
}

export function cosine(a, b) {
  const len = Math.min(a?.length || 0, b?.length || 0);
  if (!len) return 0;
  let dot = 0; let na = 0; let nb = 0;
  for (let i = 0; i < len; i += 1) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  const d = Math.sqrt(na) * Math.sqrt(nb);
  return d ? dot / d : 0;
}

/* -------------------------------------------------------------------------- */
/*  Filter DSL (a deliberate subset of Qdrant's)                               */
/* -------------------------------------------------------------------------- */

/**
 * Supported filter shape:
 *   { must: [cond], should: [cond], must_not: [cond] }
 *   cond = { key, match: value | { any: [...] } }
 *        | { key, range: { gte, lte, gt, lt } }
 *        | { key, contains: 'substring' }
 * `must` also accepts a bare condition. Unknown keys never match silently
 * "true": an unsupported condition is treated as not matching, so a filter bug
 * cannot leak another owner's memory into a prompt.
 */
export function matchesFilter(payload = {}, filter = null) {
  if (!filter) return true;
  const asArray = (v) => (Array.isArray(v) ? v : v == null ? [] : [v]);
  const cond = (c) => {
    if (!c || typeof c !== 'object' || typeof c.key !== 'string') return false;
    const value = payload[c.key];
    if (c.match !== undefined) {
      const m = c.match;
      if (m && typeof m === 'object' && Array.isArray(m.any)) return m.any.some((x) => x === value);
      return m === value;
    }
    if (c.range && typeof c.range === 'object') {
      const n = Number(value);
      if (!Number.isFinite(n)) return false;
      const { gte, lte, gt, lt } = c.range;
      if (gte != null && !(n >= Number(gte))) return false;
      if (lte != null && !(n <= Number(lte))) return false;
      if (gt != null && !(n > Number(gt))) return false;
      if (lt != null && !(n < Number(lt))) return false;
      return true;
    }
    if (typeof c.contains === 'string') return normalizeText(String(value ?? '')).includes(normalizeText(c.contains));
    return false;
  };
  const must = asArray(filter.must);
  const should = asArray(filter.should);
  const mustNot = asArray(filter.must_not);
  if (must.some((c) => !cond(c))) return false;
  if (mustNot.some((c) => cond(c))) return false;
  if (should.length && !should.some((c) => cond(c))) return false;
  return true;
}

function toQdrantFilter(filter) {
  if (!filter) return undefined;
  const map = (c) => {
    if (c.match !== undefined) {
      const m = c.match;
      if (m && typeof m === 'object' && Array.isArray(m.any)) return { key: c.key, match: { any: m.any } };
      return { key: c.key, match: { value: m } };
    }
    if (c.range) return { key: c.key, range: c.range };
    if (typeof c.contains === 'string') return { key: c.key, match: { text: c.contains } };
    return null;
  };
  const pick = (v) => (Array.isArray(v) ? v : v == null ? [] : [v]).map(map).filter(Boolean);
  const out = {};
  const must = pick(filter.must); if (must.length) out.must = must;
  const should = pick(filter.should); if (should.length) out.should = should;
  const mustNot = pick(filter.must_not); if (mustNot.length) out.must_not = mustNot;
  return Object.keys(out).length ? out : undefined;
}

/** Qdrant point ids must be unsigned integers or UUIDs — hash our string ids. */
export function qdrantId(id) {
  const hex = Array.from({ length: 32 }, (_, i) => {
    const h = fnv1a(`${i}|${String(id)}`);
    return (h % 16).toString(16);
  }).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

/* -------------------------------------------------------------------------- */
/*  Local backend                                                              */
/* -------------------------------------------------------------------------- */

export function createLocalBackend({ dim = DEFAULT_DIM } = {}) {
  const size = nextPowerOfTwo(dim);
  const collections = new Map(); // name -> { dim, distance, points: Map<id, {id, vector, payload}> }

  const need = (name) => {
    const c = collections.get(name);
    if (!c) { const err = new Error(`COLLECTION_NOT_FOUND:${name}`); err.code = 'COLLECTION_NOT_FOUND'; throw err; }
    return c;
  };

  return {
    kind: 'local',
    dimension: size,
    createCollection(name, { size: s = size, distance = 'Cosine' } = {}) {
      if (!collections.has(name)) collections.set(name, { dim: nextPowerOfTwo(s), distance, points: new Map() });
      else if (distance) collections.get(name).distance = distance;
      return { ok: true, name };
    },
    upsert(name, points = []) {
      const c = need(name);
      let written = 0;
      for (const p of points) {
        if (p?.id == null) continue;
        let vector = p.vector instanceof Float32Array ? p.vector : (Array.isArray(p.vector) ? Float32Array.from(p.vector) : null);
        /* A caller may hand over text instead of a vector — embedding belongs
           at the store boundary so no caller has to know the dimension. */
        if (!vector && typeof p.text === 'string' && p.text.trim()) vector = embedText(p.text, { dim: c.dim });
        if (!vector || vector.length !== c.dim) continue;
        c.points.set(String(p.id), { id: String(p.id), vector, payload: p.payload && typeof p.payload === 'object' ? p.payload : {} });
        written += 1;
      }
      return { ok: true, written, count: c.points.size };
    },
    /**
     * Top-k by cosine. A non-positive similarity is NOT a match and is dropped
     * even when no threshold was given (a caller who genuinely wants the
     * anti-correlated tail can pass `scoreThreshold: -1`).
     */
    search(name, { vector, text, limit = 5, filter = null, scoreThreshold = 0, withPayload = true } = {}) {
      const c = need(name);
      const q = vector instanceof Float32Array ? vector : (Array.isArray(vector) ? Float32Array.from(vector) : (text ? embedText(String(text), { dim: c.dim }) : null));
      if (!q) return { ok: false, error: 'VECTOR_OR_TEXT_REQUIRED', rows: [] };
      const nLimit = Math.max(1, Math.min(100, Number(limit) || 5));
      const floor = Number(scoreThreshold) || 0;
      const allowNonPositive = floor < 0;
      const rows = [];
      for (const point of c.points.values()) {
        if (!matchesFilter(point.payload, filter)) continue;
        const score = cosine(q, point.vector);
        if (score < floor) continue;
        if (!allowNonPositive && score <= 0) continue;
        rows.push({ id: point.id, score: Math.round(score * 1e6) / 1e6, ...(withPayload ? { payload: point.payload } : {}) });
      }
      rows.sort((a, b) => b.score - a.score);
      return { ok: true, rows: rows.slice(0, nLimit) };
    },
    delete(name, ids = []) {
      const c = need(name);
      let removed = 0;
      for (const id of ids) if (c.points.delete(String(id))) removed += 1;
      return { ok: true, removed, count: c.points.size };
    },
    clear(name) { const c = need(name); const n = c.points.size; c.points.clear(); return { ok: true, removed: n }; },
    count(name) { return { ok: true, count: need(name).points.size }; },
    listCollections() {
      return [...collections.entries()].map(([name, c]) => ({ name, points: c.points.size, dimension: c.dim, distance: c.distance }));
    },
    health() { return { ok: true, backend: 'local', collections: collections.size, dimension: size }; },
    exportState() {
      const out = {};
      for (const [name, c] of collections) {
        out[name] = {
          dim: c.dim,
          distance: c.distance,
          points: [...c.points.values()].map((p) => ({ id: p.id, vector: Array.from(p.vector), payload: p.payload }))
        };
      }
      return { schema: VECTOR_SCHEMA, kind: 'local', at: Date.now(), collections: out };
    },
    importState(state = {}) {
      if (state.schema !== VECTOR_SCHEMA) return { ok: false, error: 'STATE_SCHEMA_MISMATCH' };
      collections.clear();
      for (const [name, c] of Object.entries(state.collections || {})) {
        this.createCollection(name, { size: c.dim, distance: c.distance });
        this.upsert(name, c.points || []);
      }
      return { ok: true, collections: collections.size };
    }
  };
}

/* -------------------------------------------------------------------------- */
/*  Remote Qdrant backend (used only when QDRANT_URL is configured)            */
/* -------------------------------------------------------------------------- */

export function createQdrantBackend({ url, apiKey = null, dim = DEFAULT_DIM, fetchImpl = null, timeoutMs = 6000 } = {}) {
  const base = String(url || '').replace(/\/+$/, '');
  const doFetch = fetchImpl || globalThis.fetch;
  const headers = { 'content-type': 'application/json', ...(apiKey ? { 'api-key': apiKey } : {}) };

  async function call(path, { method = 'GET', body = null } = {}) {
    if (!base) throw new Error('QDRANT_URL_REQUIRED');
    if (typeof doFetch !== 'function') throw new Error('FETCH_UNAVAILABLE');
    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
    timer?.unref?.();
    try {
      const res = await doFetch(`${base}${path}`, {
        method,
        headers,
        ...(controller ? { signal: controller.signal } : {}),
        ...(body ? { body: JSON.stringify(body) } : {})
      });
      const text = await res.text();
      let json = null;
      try { json = text ? JSON.parse(text) : null; } catch { json = null; }
      if (!res.ok && res.status !== 409) {
        const err = new Error(`QDRANT_HTTP_${res.status}:${String(json?.status?.error || text).slice(0, 120)}`);
        err.status = res.status;
        throw err;
      }
      return json;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  return {
    kind: 'qdrant',
    dimension: nextPowerOfTwo(dim),
    async createCollection(name, { size = nextPowerOfTwo(dim), distance = 'Cosine' } = {}) {
      await call(`/collections/${encodeURIComponent(name)}`, { method: 'PUT', body: { vectors: { size: nextPowerOfTwo(size), distance } } });
      return { ok: true, name };
    },
    async upsert(name, points = []) {
      const rows = points
        .filter((p) => p?.id != null && (p.vector || p.text))
        .map((p) => ({
          id: /^\d+$/.test(String(p.id)) ? Number(p.id) : qdrantId(p.id),
          vector: Array.from(p.vector || embedText(p.text, { dim: nextPowerOfTwo(dim) })),
          payload: { ...(p.payload || {}), _fbt_id: String(p.id) }
        }));
      if (!rows.length) return { ok: true, written: 0 };
      await call(`/collections/${encodeURIComponent(name)}/points?wait=true`, { method: 'PUT', body: { points: rows } });
      return { ok: true, written: rows.length };
    },
    async search(name, { vector, text, limit = 5, filter = null, scoreThreshold = 0, withPayload = true } = {}) {
      const v = vector ? Array.from(vector) : (text ? Array.from(embedText(String(text), { dim: nextPowerOfTwo(dim) })) : null);
      if (!v) return { ok: false, error: 'VECTOR_OR_TEXT_REQUIRED', rows: [] };
      const json = await call(`/collections/${encodeURIComponent(name)}/points/search`, {
        method: 'POST',
        body: { vector: v, limit: Math.max(1, Math.min(100, Number(limit) || 5)), with_payload: withPayload, score_threshold: scoreThreshold || undefined, filter: toQdrantFilter(filter) }
      });
      const rows = (json?.result || []).map((r) => ({
        id: String(r.payload?._fbt_id ?? r.id),
        score: r.score,
        ...(withPayload ? { payload: r.payload || {} } : {})
      }));
      return { ok: true, rows };
    },
    async delete(name, ids = []) {
      const points = ids.map((id) => (/^\d+$/.test(String(id)) ? Number(id) : qdrantId(id)));
      await call(`/collections/${encodeURIComponent(name)}/points/delete?wait=true`, { method: 'POST', body: { points } });
      return { ok: true, removed: points.length };
    },
    async count(name) {
      const json = await call(`/collections/${encodeURIComponent(name)}/points/count`, { method: 'POST', body: { exact: true } });
      return { ok: true, count: json?.result?.count ?? 0 };
    },
    async listCollections() {
      const json = await call('/collections');
      return (json?.result?.collections || []).map((c) => ({ name: c.name, points: null, dimension: null, distance: null }));
    },
    async health() {
      try {
        await call('/collections');
        return { ok: true, backend: 'qdrant', url: base };
      } catch (err) {
        return { ok: false, backend: 'qdrant', error: String(err?.message || err).slice(0, 120) };
      }
    },
    exportState() { return { schema: VECTOR_SCHEMA, kind: 'qdrant', note: 'remote state is owned by the Qdrant server', collections: {} }; },
    importState() { return { ok: false, error: 'REMOTE_STATE_NOT_IMPORTABLE' }; }
  };
}

/* -------------------------------------------------------------------------- */
/*  Store factory                                                              */
/* -------------------------------------------------------------------------- */

/**
 * Build a vector store.
 *
 * mode: 'local' (default, embedded) | 'qdrant' (remote) | 'auto' (remote when
 * QDRANT_URL exists, with an embedded mirror so a remote outage degrades to
 * local retrieval instead of an empty answer).
 */
export function createVectorStore({ mode = process.env.AI_ORCH_VECTOR || 'auto', dim = DEFAULT_DIM, qdrant = null, fetchImpl = null } = {}) {
  const url = qdrant?.url ?? process.env.QDRANT_URL ?? null;
  const apiKey = qdrant?.apiKey ?? process.env.QDRANT_API_KEY ?? null;
  const wantQdrant = (mode === 'qdrant' || mode === 'auto') && Boolean(url);
  const primary = wantQdrant
    ? createQdrantBackend({ url, apiKey, dim, fetchImpl: fetchImpl || qdrant?.fetchImpl || null })
    : createLocalBackend({ dim });
  const mirror = wantQdrant ? createLocalBackend({ dim }) : null;
  let degraded = false;
  let lastError = null;

  const note = (err) => { degraded = true; lastError = String(err?.message || err).slice(0, 160); };
  /* A collection that has not been created yet is an expected state, not a
     backend failure — marking it degraded would make every first fetch of a
     turn look like an outage. */
  const isMissing = (err) => err?.code === 'COLLECTION_NOT_FOUND' || /COLLECTION_NOT_FOUND/.test(String(err?.message || err));
  const missing = () => ({ ok: false, error: 'COLLECTION_NOT_FOUND' });

  const api = {
    schema: VECTOR_SCHEMA,
    version: VECTOR_VERSION,
    get kind() { return primary.kind; },
    get degraded() { return degraded; },
    get lastError() { return lastError; },
    get dimension() { return primary.dimension; },

    async createCollection(name, opts = {}) {
      try {
        const out = await primary.createCollection(name, opts);
        if (mirror) await mirror.createCollection(name, opts);
        return { ok: true, ...out, backend: primary.kind };
      } catch (err) {
        if (isMissing(err)) return missing();
        note(err);
        if (!mirror) return { ok: false, error: lastError };
        await mirror.createCollection(name, opts);
        return { ok: true, name, backend: 'local-mirror', degraded: true };
      }
    },

    async upsert(name, points = []) {
      const embedded = points.map((p) => ({
        id: String(p.id),
        vector: p.vector || embedText(p.text || JSON.stringify(p.payload || {}), { dim: primary.dimension }),
        payload: p.payload || {}
      }));
      try {
        const out = await primary.upsert(name, embedded);
        if (mirror) await mirror.upsert(name, embedded);
        return { ...out, backend: primary.kind };
      } catch (err) {
        if (isMissing(err)) return { ...missing(), written: 0 };
        note(err);
        if (!mirror) return { ok: false, error: lastError, written: 0 };
        const out = await mirror.upsert(name, embedded);
        return { ...out, backend: 'local-mirror', degraded: true, error: lastError };
      }
    },

    async search(name, opts = {}) {
      try {
        const out = await primary.search(name, opts);
        if (!out?.ok && out?.error === 'COLLECTION_NOT_FOUND' && mirror) return mirror.search(name, opts);
        return out;
      } catch (err) {
        if (isMissing(err)) return { ...missing(), rows: [] };
        note(err);
        if (!mirror) return { ok: false, error: lastError, rows: [] };
        const out = await mirror.search(name, opts);
        return { ...out, backend: 'local-mirror', degraded: true, error: lastError };
      }
    },

    async delete(name, ids = []) {
      try { const out = await primary.delete(name, ids); if (mirror) await mirror.delete(name, ids); return out; }
      catch (err) {
        if (isMissing(err)) return { ...missing(), removed: 0 };
        note(err); if (!mirror) return { ok: false, error: lastError };
        const out = await mirror.delete(name, ids); return { ...out, degraded: true, error: lastError };
      }
    },

    async count(name) {
      try { const out = await primary.count(name); if (out?.ok) return out; if (mirror) return mirror.count(name); return out; }
      catch (err) {
        if (isMissing(err)) return { ...missing(), count: 0 };
        note(err); return mirror ? mirror.count(name) : { ok: false, error: lastError, count: 0 };
      }
    },

    async listCollections() {
      try { const out = await primary.listCollections(); if (Array.isArray(out) && out.length) return out; if (mirror) return mirror.listCollections(); return out || []; }
      catch (err) {
        if (isMissing(err)) return mirror ? mirror.listCollections() : [];
        note(err); return mirror ? mirror.listCollections() : [];
      }
    },

    async health() {
      const h = await primary.health();
      return { ...h, degraded, lastError, schema: VECTOR_SCHEMA };
    },

    exportState() { return mirror ? mirror.exportState() : primary.exportState(); },
    async importState(state) { const out = mirror ? mirror.importState(state) : primary.importState(state); return out; }
  };
  return api;
}

export default createVectorStore;
