import { useCallback, useEffect, useRef, useState } from 'react';
import { getChart, getGlobal, getMarkets, getTrending } from '../lib/api';

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

/** Map of `coinId -> price` for portfolio valuation. */
export function usePriceMap(perPage = 50) {
  const { data, loading, updatedAt } = useMarkets(perPage);
  const map = {};
  (data ?? []).forEach((c) => {
    map[c.id] = c.price;
  });
  return { priceMap: map, coins: data ?? [], loading, updatedAt };
}
