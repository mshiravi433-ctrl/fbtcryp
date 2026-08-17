import { useCallback, useEffect, useRef, useState } from 'react';
import { getChart,
  getOhlc, getCoin, getGlobal, getMarkets, getTrending, searchCoins } from '../lib/api';
import { onSoftRefresh } from '../lib/refresh';
import { useSettingsStore } from '../store/useSettingsStore';
import { vsOf } from '../lib/currency';

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

    /*
     * Soft refresh: every mounted poll participates, through the SAME run()
     * its interval uses. No reload, no remount, no second fetch beyond the
     * one the user asked for — and a subscriber unmounting mid-cycle (route
     * change) is safe because run() checks alive.
     */
    const offBus = onSoftRefresh(run);

    return () => {
      alive.current = false;
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
      offBus();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, intervalMs, run]);

  return { data, loading, error, updatedAt, refresh: run };
}

export const useGlobalStats = () => usePoll(() => getGlobal(), [], 45000);
/*
 * Market data is fetched in the user's DISPLAY CURRENCY.
 *
 * Changing the symbol alone would be a lie: EUR beside a dollar number. The
 * conversion is done upstream by the price feed (`vs_currency`), so the number
 * is genuinely in that currency rather than multiplied client-side against a
 * rate that would drift out of date.
 *
 * `vs` is part of the poll key, so switching currency refetches immediately
 * instead of showing converted symbols over stale figures until the next tick.
 */
export const useMarkets = (perPage = 50) => {
  const vs = vsOf(useSettingsStore((s) => s.currency));
  return usePoll(() => getMarkets({ perPage, vs }), [perPage, vs], 30000);
};
export const useTrending = () => usePoll(() => getTrending(), [], 120000);
/**
 * Candles. `id` is null unless the candle tab is actually open, so switching
 * to it is what triggers the request — the line view costs nothing extra.
 */
export const useOhlc = (id, days) =>
  usePoll(() => (id ? getOhlc(id, days) : Promise.resolve([])), [id, days], 60000);
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
