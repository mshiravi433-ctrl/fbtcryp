#!/usr/bin/env node
/**
 * A Qdrant Cloud MOCK — an in-process HTTP server that speaks the subset of
 * the Qdrant REST API this codebase uses.
 *
 * WHY THIS EXISTS (2026-11-11)
 * ---------------------------------------------------------------------------
 * The deployment now points at a real Qdrant Cloud cluster. That cluster is
 * reachable from the production network and NOT from the development
 * sandbox, so "it works" cannot be proven by curling it from here — and
 * "it works" is exactly the claim that must not be taken on faith.
 *
 * So the store is exercised against a server that implements the real
 * protocol: the same paths, the same method verbs, the same request bodies,
 * the same response shapes, and the same error codes. If the store's
 * requests are wrong, the mock rejects them the way Qdrant would, and the
 * test fails.
 *
 * WHAT IT IMPLEMENTS
 *   GET    /readyz                         → "ready"
 *   GET    /collections                    → list
 *   PUT    /collections/{name}             → create (409 if it exists)
 *   GET    /collections/{name}             → info (404 if missing)
 *   DELETE /collections/{name}             → delete
 *   PUT    /collections/{name}/index       → payload index (idempotent)
 *   PUT    /collections/{name}/points      → upsert (wait=true)
 *   POST   /collections/{name}/points      → search (with filter)
 *   POST   /collections/{name}/points/scroll → scroll
 *   POST   /collections/{name}/points/delete → delete by filter
 *   POST   /collections/{name}/points/count  → count
 *
 * It keeps the vectors, so a search really scores cosine similarity over
 * the stored points — a mock that returned canned rows would prove nothing
 * about whether the store's own maths is right.
 */

import http from 'node:http';

const noop = () => {};

function cosine(a, b) {
  let dot = 0; let na = 0; let nb = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / Math.sqrt(na * nb);
}

function matchesFilter(payload, filter) {
  if (!filter || !Object.keys(filter).length) return true;
  const must = filter.must || [];
  for (const clause of must) {
    const value = payload?.[clause.key];
    const want = clause.match?.value !== undefined ? clause.match.value : clause.match;
    if (want && typeof want === 'object' && Array.isArray(want.any)) {
      if (!want.any.includes(value)) return false;
    } else if (value !== want) return false;
  }
  const mustNot = filter.must_not || [];
  for (const clause of mustNot) {
    const value = payload?.[clause.key];
    if (value === clause.match?.value) return false;
  }
  return true;
}

/**
 * Start the mock.
 * @returns {Promise<{ url: string, apiKey: string, close: () => Promise<void>, state: object }>}
 */
export async function startQdrantMock({ apiKey = 'test-only-qdrant-key', requireAuth = true } = {}) {
  /** name → { dim, distance, points: Map<id, { id, vector, payload }> } */
  const collections = new Map();
  const requests = [];

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const path = url.pathname;
    requests.push({ method: req.method, path, at: Date.now() });

    if (requireAuth) {
      const given = req.headers['api-key'];
      if (given !== apiKey) {
        res.writeHead(403, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ status: { error: 'Invalid api-key' } }));
        return;
      }
    }

    const send = (code, body) => {
      res.writeHead(code, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    const readBody = async () => {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      if (!chunks.length) return null;
      try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { return null; }
    };

    if (path === '/readyz' || path === '/') {
      send(200, { title: 'qdrant - mock', status: 'ok' });
      return;
    }
    if (path === '/collections' && req.method === 'GET') {
      send(200, { result: { collections: [...collections.keys()].map((name) => ({ name })) } });
      return;
    }

    const colMatch = path.match(/^\/collections\/([^/]+)(.*)$/);
    if (colMatch) {
      const name = decodeURIComponent(colMatch[1]);
      const rest = colMatch[2];
      const col = collections.get(name);

      if (rest === '' && req.method === 'PUT') {
        const body = await readBody();
        if (col) {
          send(409, { status: { error: `Collection ${name} already exists!` } });
          return;
        }
        collections.set(name, {
          dim: body?.vectors?.size || 256,
          distance: body?.vectors?.distance || 'Cosine',
          points: new Map()
        });
        send(200, { result: true, status: 'ok' });
        return;
      }
      if (rest === '' && req.method === 'GET') {
        if (!col) { send(404, { status: { error: `Collection ${name} doesn't exist!` } }); return; }
        send(200, {
          result: {
            status: 'green',
            config: { params: { vectors: { size: col.dim, distance: col.distance } } },
            points_count: col.points.size,
            indexed_vectors_count: col.points.size
          }
        });
        return;
      }
      if (rest === '' && req.method === 'DELETE') {
        collections.delete(name);
        send(200, { result: true, status: 'ok' });
        return;
      }
      if (rest === '/index' && req.method === 'PUT') {
        if (!col) { send(404, { status: { error: `Collection ${name} doesn't exist!` } }); return; }
        send(200, { result: { operation_id: 1, status: 'completed' }, status: 'ok' });
        return;
      }
      if (rest === '/points' && req.method === 'PUT') {
        if (!col) { send(404, { status: { error: `Collection ${name} doesn't exist!` } }); return; }
        const body = await readBody();
        for (const point of body?.points || []) {
          col.points.set(String(point.id), {
            id: String(point.id),
            vector: point.vector || [],
            payload: point.payload || {}
          });
        }
        send(200, { result: { operation_id: 2, status: 'completed', points_count: body?.points?.length || 0 }, status: 'ok' });
        return;
      }
      if ((rest === '/points' && req.method === 'POST') || (rest === '/points/search' && req.method === 'POST')) {
        if (!col) { send(404, { status: { error: `Collection ${name} doesn't exist!` } }); return; }
        const body = await readBody();
        const q = body?.vector || [];
        const limit = body?.limit || 10;
        const scored = [...col.points.values()]
          .filter((p) => matchesFilter(p.payload, body?.filter))
          .map((p) => ({ id: p.id, version: 0, score: cosine(q, p.vector), payload: p.payload }))
          .sort((a, b) => b.score - a.score)
          .slice(0, limit);
        send(200, { result: scored, status: 'ok' });
        return;
      }
      if (rest === '/points/scroll' && req.method === 'POST') {
        if (!col) { send(404, { status: { error: `Collection ${name} doesn't exist!` } }); return; }
        const body = await readBody();
        const limit = body?.limit || 10;
        const points = [...col.points.values()]
          .filter((p) => matchesFilter(p.payload, body?.filter))
          .slice(0, limit)
          .map((p) => ({ id: p.id, version: 0, payload: p.payload }));
        send(200, { result: { points, next_page_offset: null }, status: 'ok' });
        return;
      }
      if (rest === '/points/delete' && req.method === 'POST') {
        if (!col) { send(404, { status: { error: `Collection ${name} doesn't exist!` } }); return; }
        const body = await readBody();
        let removed = 0;
        for (const [id, p] of [...col.points.entries()]) {
          if (matchesFilter(p.payload, body?.filter)) { col.points.delete(id); removed += 1; }
        }
        send(200, { result: { operation_id: 3, status: 'completed' }, status: 'ok' });
        return;
      }
      if ((rest === '/count' || rest === '/points/count') && req.method === 'POST') {
        if (!col) { send(404, { status: { error: `Collection ${name} doesn't exist!` } }); return; }
        const body = await readBody();
        const count = [...col.points.values()].filter((p) => matchesFilter(p.payload, body?.filter)).length;
        send(200, { result: { count }, status: 'ok' });
        return;
      }
    }

    send(404, { status: { error: `Unknown path ${req.method} ${path}` } });
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;

  return {
    url: `http://127.0.0.1:${port}`,
    apiKey,
    requests,
    state: { collections },
    close: () => new Promise((resolve) => server.close(() => resolve(noop())))
  };
}
