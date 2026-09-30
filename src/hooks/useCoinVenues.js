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
    setLoading(true);
    let alive = true;

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

    return () => {
      alive = false;
      runId.current += 1;
    };
  }, [key, enabled]);

  return { venues, loading };
}
