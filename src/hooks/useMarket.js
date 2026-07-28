import { useCallback, useEffect, useRef, useState } from 'react';
import { getChart, getCoin, getGlobal, getMarkets, getTrending, searchCoins } from '../lib/api';

/** Generic polling hook — pauses while the tab is hidden to save battery/quota. */
export function usePoll(fn, deps = [], intervalMs = 30000) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [updatedAt, setUpdatedAt] = useState(0);
  const alive = useRef(true);
  const fnRef = useRef(fn);
  fnRef.current = fn;

  const run = useCallback(async () => {
    try {
      const d = await fnRef.current();
      if (!alive.current) return;
      setData(d);
      setUpdatedAt(Date.now());
      setError(null);
    } catch (e) {
      if (alive.current) setError(e);
    } finally {
      if (alive.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    alive.current = true;
    setLoading(true);
    run();

    let timer = setInterval(() => {
      if (document.visibilityState === 'visible') run();
    }, intervalMs);

    const onVisible = () => {
      if (document.visibilityState === 'visible') run();
    };
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      alive.current = false;
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, intervalMs, run]);

  return { data, loading, error, updatedAt, refresh: run };
}

export const useGlobalStats = () => usePoll(() => getGlobal(), [], 45000);
export const useMarkets = (perPage = 50) => usePoll(() => getMarkets({ perPage }), [perPage], 30000);
export const useTrending = () => usePoll(() => getTrending(), [], 120000);
export const useChart = (id, days) => usePoll(() => (id ? getChart(id, days) : Promise.resolve([])), [id, days], 60000);

/**
 * One coin by id, fetched directly instead of being looked up inside the
 * paged markets list. This is what fixes "coin not found" on anything outside
 * the top of the market-cap table.
 */
export const useCoin = (id) => usePoll(() => (id ? getCoin(id) : Promise.resolve(null)), [id], 30000);

/** Debounced universe-wide coin search (name / ticker), not just this page. */
export function useCoinSearch(query, minLength = 2) {
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    const q = String(query || '').trim();
    if (q.length < minLength) {
      setResults([]);
      setSearching(false);
      return undefined;
    }
    setSearching(true);
    let alive = true;
    const timer = setTimeout(() => {
      searchCoins(q)
        .then((r) => alive && setResults(r ?? []))
        .catch(() => alive && setResults([]))
        .finally(() => alive && setSearching(false));
    }, 350);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [query, minLength]);

  return { results, searching };
}

/** Map of `coinId -> price` for portfolio valuation. */
export function usePriceMap(perPage = 50) {
  const { data, loading, updatedAt } = useMarkets(perPage);
  const map = {};
  (data ?? []).forEach((c) => {
    map[c.id] = c.price;
  });
  return { priceMap: map, coins: data ?? [], loading, updatedAt };
}
