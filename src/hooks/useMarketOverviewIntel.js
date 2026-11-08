import { useCallback, useEffect, useMemo, useState } from 'react';
import { getMarketOverviewIntel, peekCachedOverviewIntel } from '../lib/marketOverviewIntel.js';
import { mergeNetworkTelemetry } from '../lib/fbtSwapNetworks.js';
import { pollWhileVisible } from '../lib/visibilityPoll.js';

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

    /* Every 90 s, for as long as the hook is mounted — which used to include
       every minute the tab spent in the background. This reads a shared intel
       endpoint, so a hidden poll is an answer nobody asked for at the server's
       expense. pollWhileVisible also refreshes immediately on return, which is
       strictly better than the stale 90-second window the old timer gave. */
    const off = pollWhileVisible(async () => {
      const res = await getMarketOverviewIntel({ force: true });
      if (!cancelled) {
        setData(res);
        setLoading(false);
      }
    }, POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      off();
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
