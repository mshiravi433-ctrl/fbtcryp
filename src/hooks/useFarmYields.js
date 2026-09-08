import { useCallback, useEffect, useRef, useState } from 'react';
import { getYields } from '../lib/yields';
import { emitFarmEvent } from '../lib/farmDeFi';

/** Refresh on return to the app, periodically while visible, or explicitly.
 * Unmount/retry aborts the previous request; late responses cannot win. */
export function useFarmYields() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [revision, setRevision] = useState(0);
  const pending = useRef(false);
  const refresh = useCallback(() => { if (!pending.current) setRevision((v) => v + 1); }, []);

  useEffect(() => {
    const ctrl = new AbortController();
    pending.current = true;
    setRefreshing(true);
    getYields({ signal: ctrl.signal })
      .then((result) => {
        if (ctrl.signal.aborted) return;
        setData(result);
        setError(null);
        emitFarmEvent('FARM_DISCOVERED', { count: result.pools.length, source: result.source });
      })
      .catch((err) => {
        if (ctrl.signal.aborted) return;
        setError(err);
        setData(null); // no unlabelled cached APYs after a failure
      })
      .finally(() => {
        if (ctrl.signal.aborted) return;
        pending.current = false;
        setRefreshing(false);
        setLoading(false);
      });
    return () => { ctrl.abort(); pending.current = false; };
  }, [revision]);

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
    const timer = setTimeout(() => {
      setData(null);
      setError(new Error('YIELDS_EXPIRED'));
      refresh();
    }, Math.max(0, data.at + 2 * 60 * 60_000 - Date.now()));
    return () => clearTimeout(timer);
  }, [data, refresh]);

  return { data, error, loading, refreshing, refresh };
}
