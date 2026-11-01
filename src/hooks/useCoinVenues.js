import { useEffect, useRef, useState } from 'react';
import { getCoinVenues } from '../lib/coinVenues.js';

/**
 * SWAPPABILITY FOR A LIST OF COINS — one request, not one per row.
 * ---------------------------------------------------------------------------
 * Reported: «بیشترشم قابل سواپ نیست» (on the market screen). The list decided
 * every button from the 46-entry curated table and therefore said "no" to
 * almost everything, including tokens our own Solana screen trades.
 *
 * The contract this hook keeps, and the reason it is a hook and not a helper:
 *
 *   • `resolved` is a Map that fills in AS ANSWERS ARRIVE. Rows that already
 *     have a curated answer render their button on the first paint, and the
 *     rest gain one a moment later. Nothing waits on the network to be
 *     tappable, and nothing shows a "cannot swap" placeholder in the gap.
 *   • ids are re-sent only when the SET changes, not when the array identity
 *     does, so a 30s market poll does not re-ask for the same 250 coins.
 *   • a failed batch resolves to an empty Map. The list then keeps showing the
 *     curated buttons it already had — a network blip must never turn a
 *     working swap button into a dead one.
 *
 * @param {string[]} coinIds
 * @param {{enabled?: boolean}} [options]
 * @returns {{venues: Map<string, object>, loading: boolean, refresh: () => void}}
 */
export function useCoinVenues(coinIds, { enabled = true } = {}) {
  const [venues, setVenues] = useState(() => new Map());
  const [loading, setLoading] = useState(false);
  const key = (Array.isArray(coinIds) ? coinIds : []).join(',');
  const runId = useRef(0);

  useEffect(() => {
    if (!enabled) return undefined;
    const ids = key ? key.split(',') : [];
    if (!ids.length) {
      setVenues(new Map());
      return undefined;
    }

    const id = ++runId.current;
    let alive = true;

    /*
     * ─── THE REQUEST WAITS FOR THE LIST, NOT THE OTHER WAY ROUND ─────────────
     *   «صفحه بازار خیلی کند هست … ایکون بعضی باکس‌ها دیر بالا میاد»
     *
     * This batch used to be fired INSIDE the same commit that first painted
     * the rows. On a cold load that put it in direct competition with the two
     * things the screen actually needs: the market feed and the coin artwork.
     * The browser has ~6 connections per host; a 250-id venue lookup that
     * answers with a 15s budget can hold them for the whole of the first
     * screen, and the logos a reader is watching for arrive after it.
     *
     * The answer only decides whether a small «سواپ» button appears beside a
     * row, so it can afford to be a moment late — and never early enough to
     * delay anything else. Two idle callbacks (one for the paint that just
     * committed, one to let the images start) put it after the numbers.
     * `requestIdleCallback` is missing in Safari, so it falls back to a
     * timeout: a late answer is still an answer.
     */
    const start = () => {
      if (!alive) return;
      setLoading(true);
      getCoinVenues(ids)
        .then((map) => {
          if (!alive || id !== runId.current) return;
          setVenues(map);
        })
        .catch(() => {
          if (alive && id === runId.current) setVenues(new Map());
        })
        .finally(() => {
          if (alive && id === runId.current) setLoading(false);
        });
    };
    const idle = (fn, timeout) => (typeof requestIdleCallback === 'function'
      ? requestIdleCallback(fn, { timeout })
      : setTimeout(fn, 0));
    const cancelIdle = (handle) => (typeof cancelIdleCallback === 'function'
      ? cancelIdleCallback(handle)
      : clearTimeout(handle));
    let handle = idle(() => {
      handle = idle(start, 1200);
    }, 600);

    return () => {
      alive = false;
      runId.current += 1;
      cancelIdle(handle);
    };
  }, [key, enabled]);

  return { venues, loading };
}
