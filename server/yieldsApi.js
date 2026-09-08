import { fetchYields, fetchYieldHistory, isYieldPoolId } from './yields.js';

const TTL_MS = 60 * 60_000;
const MAX_AGE_MS = 2 * TTL_MS;
const RETRY_MS = 30_000;

/** Dedicated bounded cache: financial observations may not survive indefinitely
 * as stale data, nor may an upstream error be cached by the CDN as fresh. */
export function createYieldsApi({ pools = fetchYields, history = fetchYieldHistory, now = Date.now } = {}) {
  const cache = new Map();
  const inflight = new Map();
  const failures = new Map();

  async function read(key, producer) {
    const hit = cache.get(key);
    if (hit && now() - hit.at < TTL_MS) return stamp(hit, false);
    const fallback = (error) => {
      if (hit && now() - hit.at < MAX_AGE_MS) return stamp(hit, true);
      throw error;
    };
    const failure = failures.get(key);
    if (failure && now() - failure.at < RETRY_MS) return fallback(failure.error);
    if (!inflight.has(key)) {
      const request = Promise.resolve().then(producer).then((value) => {
        cache.delete(key);
        // Limit memory even if every eligible pool's history is requested.
        if (cache.size >= 501) cache.delete(cache.keys().next().value);
        const entry = { value, at: now() };
        cache.set(key, entry);
        failures.delete(key);
        return entry;
      }).catch((error) => {
        if (failures.size >= 501) failures.delete(failures.keys().next().value);
        failures.set(key, { at: now(), error });
        throw error;
      }).finally(() => inflight.delete(key));
      inflight.set(key, request);
    }
    try { return stamp(await inflight.get(key), false); }
    catch (error) { return fallback(error); }
  }

  function stamp(entry, stale) {
    const value = entry.value;
    const freshness = stale ? 'STALE' : 'FRESH';
    return {
      ...value, freshness,
      ...(value.pools ? { pools: value.pools.map((pool) => ({ ...pool, freshness })) } : {})
    };
  }

  function send(res, data) {
    // Revalidate through this cache: do not let a CDN extend the age of a
    // previously fresh APY by another hour. Freshness also travels in JSON
    // so Android/cross-origin clients do not depend on exposed headers.
    res.set('Cache-Control', 'no-store');
    if (data.freshness === 'STALE') res.set('x-data-stale', '1');
    return res.json(data);
  }
  function fail(res) {
    return res.status(502).set('Cache-Control', 'no-store').json({ error: 'YIELDS_UNAVAILABLE', retryable: true });
  }

  return {
    async list(_req, res) {
      try { return send(res, await read('pools', pools)); }
      catch { return fail(res); }
    },
    async history(req, res) {
      const id = req.params.id;
      if (!isYieldPoolId(id)) return res.status(400).set('Cache-Control', 'no-store').json({ error: 'INVALID_POOL_ID' });
      try {
        const feed = await read('pools', pools);
        if (!feed.pools.some((pool) => pool.id === id)) {
          return res.status(404).set('Cache-Control', 'no-store').json({ error: 'POOL_NOT_FOUND' });
        }
        return send(res, await read(`history:${id}`, () => history(id)));
      } catch { return fail(res); }
    }
  };
}

export const yieldsApi = createYieldsApi();
