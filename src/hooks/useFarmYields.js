import { useCallback, useEffect, useRef, useState } from 'react';
import { getYields } from '../lib/yields';
import { emitFarmEvent } from '../lib/farmDeFi';
import { getFarmProtocolFallback } from '../lib/farmProtocolFallback';

export const FARM_YIELDS_CACHE_KEY = 'fbt-farm-yields-cache-v1';
export const FARM_YIELDS_CACHE_TTL_MS = 2 * 60 * 60_000;

function isSnapshot(value) {
  return Boolean(
    value && typeof value === 'object' &&
    Array.isArray(value.pools) && Array.isArray(value.venues ?? []) &&
    Number.isFinite(Number(value.at)) && Number(value.at) > 0 &&
    Number(value.at) <= Date.now() + 60_000
  );
}

function markStale(snapshot) {
  if (!isSnapshot(snapshot)) return null;
  return {
    ...snapshot,
    pools: snapshot.pools.map((pool) => ({ ...pool, freshness: 'STALE' })),
    venues: (snapshot.venues ?? []).map((pool) => ({ ...pool, freshness: 'STALE' })),
    freshness: 'STALE',
    clientCached: true
  };
}

function readLastGood(now = Date.now()) {
  try {
    const raw = globalThis.localStorage?.getItem(FARM_YIELDS_CACHE_KEY);
    if (!raw) return null;
    const cached = JSON.parse(raw);
    if (!isSnapshot(cached) || cached.freshness === 'STALE') return null;
    const age = now - Number(cached.at);
    if (age < 0 || age >= FARM_YIELDS_CACHE_TTL_MS) return null;
    return markStale(cached);
  } catch {
    return null;
  }
}

function writeLastGood(snapshot) {
  if (!isSnapshot(snapshot) || snapshot.freshness === 'STALE') return false;
  try {
    globalThis.localStorage?.setItem(FARM_YIELDS_CACHE_KEY, JSON.stringify(snapshot));
    return true;
  } catch {
    return false;
  }
}

function snapshotWithinAge(snapshot, now = Date.now()) {
  if (!isSnapshot(snapshot)) return false;
  const age = now - Number(snapshot.at);
  return age >= 0 && age < FARM_YIELDS_CACHE_TTL_MS;
}

/** Refresh on return to the app, periodically while visible, or explicitly.
 * Unmount/retry aborts the previous request; late responses cannot win. The
 * last healthy snapshot is shown as STALE while refreshing, never as current. */
export function useFarmYields({ getReadProvider } = {}) {
  const [initialCache] = useState(readLastGood);
  const [data, setData] = useState(initialCache);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(!initialCache);
  // A hydrated last-good snapshot is rendered while the mount refresh starts.
  const [refreshing, setRefreshing] = useState(Boolean(initialCache));
  const [revision, setRevision] = useState(0);
  const pending = useRef(false);
  const dataRef = useRef(data);
  dataRef.current = data;
  const refresh = useCallback(() => { if (!pending.current) setRevision((v) => v + 1); }, []);

  useEffect(() => {
    const ctrl = new AbortController();
    pending.current = true;
    setRefreshing(true);
    getYields({ signal: ctrl.signal })
      .then(async (result) => {
        if (ctrl.signal.aborted) return;
        if (!isSnapshot(result)) throw new Error('BAD_SHAPE');
        if (result.freshness === 'STALE' && typeof getReadProvider === 'function') {
          let fallback = null;
          try {
            fallback = await getFarmProtocolFallback({ getReadProvider, signal: ctrl.signal });
          } catch {
            fallback = null;
          }
          if (ctrl.signal.aborted) return;
          if (isSnapshot(fallback) && fallback.freshness !== 'STALE') {
            setData(fallback);
            setError(null);
            writeLastGood(fallback);
            emitFarmEvent('FARM_DISCOVERED', {
              count: fallback.pools.length + (fallback.venues?.length ?? 0),
              source: fallback.source
            });
            return;
          }
          result = markStale(result) ?? result;
        }
        setData(result);
        setError(null);
        writeLastGood(result);
        const count = result.pools.length + (result.venues?.length ?? 0);
        emitFarmEvent('FARM_DISCOVERED', { count, source: result.source });
      })
      .catch(async (err) => {
        if (ctrl.signal.aborted) return;
        let fallback = null;
        if (typeof getReadProvider === 'function') {
          try {
            fallback = await getFarmProtocolFallback({ getReadProvider, signal: ctrl.signal });
          } catch {
            fallback = null;
          }
        }
        if (ctrl.signal.aborted) return;
        if (isSnapshot(fallback) && fallback.freshness !== 'STALE') {
          setData(fallback);
          setError(null);
          writeLastGood(fallback);
          emitFarmEvent('FARM_DISCOVERED', {
            count: fallback.pools.length + (fallback.venues?.length ?? 0),
            source: fallback.source
          });
          return;
        }

        const cache = readLastGood() || (snapshotWithinAge(dataRef.current) ? markStale(dataRef.current) : null);
        if (cache) {
          setData(cache);
          setError(null);
          return;
        }
        setError(err);
        setData(null);
      })
      .finally(() => {
        if (ctrl.signal.aborted) return;
        pending.current = false;
        setRefreshing(false);
        setLoading(false);
      });
    return () => { ctrl.abort(); pending.current = false; };
  }, [revision, getReadProvider]);

  useEffect(() => {
    const visibleRefresh = () => { if (document.visibilityState !== 'hidden') refresh(); };
    const timer = setInterval(visibleRefresh, 5 * 60_000);
    document.addEventListener('visibilitychange', visibleRefresh);
    window.addEventListener('online', visibleRefresh);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', visibleRefresh);
      window.removeEventListener('online', visibleRefresh);
    };
  }, [refresh]);

  useEffect(() => {
    if (!data?.at) return undefined;
    const expiresAt = Number(data.at) + FARM_YIELDS_CACHE_TTL_MS;
    const timer = setTimeout(() => {
      if (Date.now() < expiresAt) return;
      setData(null);
      setError(new Error('YIELDS_EXPIRED'));
      refresh();
    }, Math.max(0, expiresAt - Date.now()));
    return () => clearTimeout(timer);
  }, [data, refresh]);

  return { data, error, loading, refreshing, refresh };
}

export const __farmYieldsCacheInternals = Object.freeze({ isSnapshot, markStale, readLastGood, writeLastGood });
