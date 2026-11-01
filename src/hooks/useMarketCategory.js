import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getCategory } from '../lib/api';
import { isBinanceRiskSector } from '../lib/marketSectors';

export const CATEGORY_PAGE_SIZE = 250;
const MAX_PAGES = 10;
const REFRESH_MS = 60_000;
const CHECK_MS = 10_000;
const initial = (key = null, loading = false) => ({
  key, pages: [], loading, refreshing: false, loadingMore: false,
  error: false, pageError: false, exhausted: false, updatedAt: 0
});

/**
 * One category + currency is one request generation. A response from an old
 * selection is never allowed to populate the new one. More pages are fetched
 * on demand and all loaded pages are refreshed together while the tab is open.
 */
export function useMarketCategory(sector, vs, active = true) {
  const key = sector ? `${sector}:${vs}` : null;
  const [state, setState] = useState(() => initial());
  const activeRef = useRef(active);
  activeRef.current = active;
  const refreshRef = useRef(null);
  const moreRef = useRef(null);
  const onActiveRef = useRef(null);

  useEffect(() => {
    if (!sector) {
      setState(initial());
      refreshRef.current = null;
      moreRef.current = null;
      onActiveRef.current = null;
      return undefined;
    }
    let alive = true;
    let pages = [];
    let exhausted = false;
    let lastSuccess = 0;
    let lastAttempt = 0;
    let refreshing = false;
    let loadingMore = false;
    const isRisk = isBinanceRiskSector(sector);
    setState(initial(key, true));

    const refresh = async (force = false) => {
      if (!alive || refreshing || loadingMore) return false;
      refreshing = true;
      lastAttempt = Date.now();
      setState((prev) => prev.key === key ? { ...prev, loading: !pages.length, refreshing: pages.length > 0, error: false } : prev);
      try {
        const count = Math.max(1, pages.length);
        const next = await Promise.all(Array.from({ length: count }, (_, i) =>
          getCategory(sector, { vs, perPage: CATEGORY_PAGE_SIZE, page: i + 1, strict: true, force })
        ));
        if (!next.every(Array.isArray)) throw new Error('CATEGORY_DATA_UNAVAILABLE');
        if (!alive) return false;
        const end = next.findIndex((page) => page.length < CATEGORY_PAGE_SIZE);
        pages = end >= 0 ? next.slice(0, end + 1) : next;
        exhausted = end >= 0;
        lastSuccess = Math.min(...pages.map((page) => Number(page.fetchedAt) || Date.now()));
        setState({ key, pages, loading: false, refreshing: false, loadingMore: false,
          error: false, pageError: false, exhausted, updatedAt: lastSuccess });
        return true;
      } catch {
        if (!alive) return false;
        // The last known risk tag is NOT proof of its current classification.
        if (isRisk) { pages = []; exhausted = false; lastSuccess = 0; }
        setState((prev) => prev.key === key ? { ...prev, pages, loading: false, refreshing: false,
          error: true, exhausted, updatedAt: lastSuccess } : prev);
        return false;
      } finally {
        refreshing = false;
      }
    };

    const more = async () => {
      if (!alive || refreshing || loadingMore || !pages.length || exhausted || pages.length >= MAX_PAGES) return false;
      loadingMore = true;
      setState((prev) => prev.key === key ? { ...prev, loadingMore: true, pageError: false } : prev);
      try {
        const rows = await getCategory(sector, { vs, perPage: CATEGORY_PAGE_SIZE, page: pages.length + 1, strict: true, force: true });
        if (!Array.isArray(rows)) throw new Error('CATEGORY_DATA_UNAVAILABLE');
        if (!alive) return false;
        pages = [...pages, rows];
        exhausted = rows.length < CATEGORY_PAGE_SIZE;
        setState((prev) => prev.key === key ? { ...prev, pages, loadingMore: false, pageError: false, exhausted } : prev);
        return true;
      } catch {
        if (alive) {
          if (isRisk) { pages = []; exhausted = false; lastSuccess = 0; }
          setState((prev) => prev.key === key ? { ...prev, pages, loadingMore: false,
            pageError: !isRisk, error: isRisk, exhausted, updatedAt: lastSuccess } : prev);
        }
        return false;
      } finally {
        loadingMore = false;
      }
    };

    refreshRef.current = refresh;
    moreRef.current = more;
    onActiveRef.current = () => {
      if (activeRef.current && Date.now() - Math.max(lastSuccess, lastAttempt) >= REFRESH_MS) refresh(true);
    };
    refresh();
    const timer = setInterval(() => {
      if (activeRef.current && (typeof document === 'undefined' || document.visibilityState === 'visible')) onActiveRef.current?.();
    }, CHECK_MS);
    const onVisible = () => {
      if (document.visibilityState === 'visible') onActiveRef.current?.();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      alive = false;
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [key, sector, vs]);

  useEffect(() => { if (active) onActiveRef.current?.(); }, [active]);
  const refresh = useCallback(() => refreshRef.current?.(true), []);
  const loadMore = useCallback(() => moreRef.current?.(), []);
  // During the render before the effect switches generations, never expose the
  // previous category (or currency) even for a single frame.
  const current = state.key === key ? state : initial(key, Boolean(key));
  const rows = useMemo(() => {
    const byId = new Map();
    for (const page of current.pages) {
      for (const row of page) if (row?.id && !byId.has(row.id)) byId.set(row.id, row);
    }
    return [...byId.values()];
  }, [current.pages]);
  return {
    ...current, rows, refresh, loadMore,
    hasMore: current.pages.length > 0 && !current.exhausted && current.pages.length < MAX_PAGES,
    limitReached: current.pages.length >= MAX_PAGES && !current.exhausted
  };
}
