import { useCallback, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { DEFAULT_MARKET_TAB, marketTabFromParam } from '../lib/marketTabs.js';

/**
 * WHICH MARKET TAB IS OPEN — held in the URL, not in a `useState`.
 * ---------------------------------------------------------------------------
 * ─── WHY THE URL OWNS IT ────────────────────────────────────────────────────
 * The two tabs are two views of ONE route. A piece of view state that lives
 * only in React is lost on the three things people actually do to this screen:
 *
 *   · they come back to it (the bottom bar re-mounts the route);
 *   · they reload on a slow connection (this app is a PWA; a cold start is
 *     routine);
 *   · they send it to somebody («این صفحه رو ببین»).
 *
 * `?tab=tokens` fixes all three and costs one entry in the router's location.
 * It also gives the tab a real, shareable address — the reason support can
 * answer «لیست توکن‌ها کجاست؟» with a link instead of a description.
 *
 * ─── WHY THE DEFAULT IS WRITTEN NOWHERE ────────────────────────────────────
 * The first tab is the DEFAULT, so a reader who never touches the strip keeps
 * `#/` exactly as it was — no query string, no extra history entry, no change
 * in the address bar. The param appears only once the reader has chosen a tab
 * that is not the default, and choosing the first one again removes it. A URL
 * that grew a `?tab=overview` on every visit would be a change to every
 * existing link for no gain.
 *
 * ─── WHY `replace` ─────────────────────────────────────────────────────────
 * Tapping a tab is not a navigation. `push` would make the phone's back
 * gesture leave the market for a different tab of the market, which is not
 * where the reader wants to go; `replace` keeps the back gesture meaning
 * «leave this screen».
 *
 * Any other param already on the market URL is preserved — this hook owns one
 * key and must not quietly delete the others.
 *
 * @returns {[string, (tab: string) => void]} the active tab and its setter
 */
export function useMarketTab() {
  const [params, setParams] = useSearchParams();
  const tab = marketTabFromParam(params.get('tab'));

  /*
   * `params` identity changes on every navigation, so the setter reads the
   * LATEST one through a ref instead of closing over a stale copy. A tab
   * tapped right after another navigation would otherwise rewrite a query
   * string that no longer exists.
   */
  const latest = useRef(params);
  latest.current = params;

  const setTab = useCallback((next) => {
    const clean = marketTabFromParam(next);
    const current = latest.current;
    if (clean === marketTabFromParam(current.get('tab'))) return;
    const merged = new URLSearchParams(current);
    if (clean === DEFAULT_MARKET_TAB) merged.delete('tab');
    else merged.set('tab', clean);
    setParams(merged, { replace: true });
  }, [setParams]);

  return [tab, setTab];
}

/**
 * A tab switch must not leave the reader halfway down the PREVIOUS tab.
 * «توکن» opens at its own first box (the hot rail), not at the scroll offset
 * the overview had — that offset means nothing in a panel of another height.
 *
 * Called only from the strip's own change handler: a cold load with
 * `?tab=tokens` keeps the browser's scroll restoration, and the first render
 * never moves the page. The sticky offset is CSS's job (`scroll-margin` on the
 * panel), so this stays a single call and not a scroll calculation.
 */
export function revealMarketTabStart() {
  const strip = document.getElementById('market-tabs');
  strip?.scrollIntoView?.({ block: 'start', behavior: 'auto' });
}
