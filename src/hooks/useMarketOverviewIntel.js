import { useCallback, useEffect, useMemo, useState } from 'react';
import { getMarketOverviewIntel, peekCachedOverviewIntel } from '../lib/marketOverviewIntel.js';
import { mergeNetworkTelemetry } from '../lib/fbtSwapNetworks.js';

const POLL_INTERVAL_MS = 90_000;

export function useMarketOverviewIntel({ enabled = true } = {}) {
  const [data, setData] = useState(() => peekCachedOverviewIntel());
  const [loading, setLoading] = useState(() => !peekCachedOverviewIntel());

  const load = useCallback(async ({ force = false } = {}) => {
    setLoading((prev) => (data ? prev : true));
    const next = await getMarketOverviewIntel({ force });
    setData(next);
    setLoading(false);
    return next;
  }, [data]);

  useEffect(() => {
    if (!enabled) return undefined;
    let cancelled = false;

    (async () => {
      const res = await getMarketOverviewIntel({ force: false });
      if (!cancelled) {
        setData(res);
        setLoading(false);
      }
    })();

    const timer = setInterval(async () => {
      const res = await getMarketOverviewIntel({ force: true });
      if (!cancelled) {
        setData(res);
        setLoading(false);
      }
    }, POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [enabled]);

  const swapNetworks = useMemo(() => {
    if (data?.swapNetworks) return data.swapNetworks;
    return mergeNetworkTelemetry({ loading: true });
  }, [data]);

  const refresh = useCallback(() => load({ force: true }), [load]);

  return {
    data,
    defi: data?.defi || null,
    swapNetworks,
    loading,
    offline: Boolean(data?.offline),
    updatedAt: data?.updatedAt || null,
    refresh
  };
}
