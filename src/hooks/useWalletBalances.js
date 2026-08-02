import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { TOKENS } from '../lib/chains';
import { getBalances } from '../lib/swap';
import { usePriceMap } from './useMarket';

/**
 * REAL ON-CHAIN HOLDINGS, PRICED IN THE USER'S DISPLAY CURRENCY.
 *
 * ─── WHAT WAS MISSING ───────────────────────────────────────────────────────
 * The wallet screen showed exactly one number: the native coin balance, as a
 * bare quantity. So a user holding 400 USDT and 0.01 BNB saw "0.01" and
 * nothing else — the app knew about the USDT (it quotes swaps against it) and
 * simply never asked for the balance.
 *
 * Worse, there was no fiat total anywhere. "0.4183 BNB" does not answer the
 * question people actually open a wallet to ask, which is "how much do I
 * have". Every real wallet leads with that number.
 *
 * ─── WHY THE PIECES WERE ALREADY THERE ──────────────────────────────────────
 * `getBalances()` in lib/swap.js has always fetched a whole token list in
 * parallel with per-token error isolation, because the Swap screen needs it to
 * render the MAX button. `usePriceMap()` has always returned CoinGecko prices
 * keyed by id, and every built-in token carries a `coingeckoId`. Nothing new
 * had to be invented — the two were simply never joined.
 *
 * ─── PRICING IS BEST-EFFORT AND SAYS SO ─────────────────────────────────────
 * A token with no `coingeckoId`, or one the feed does not cover, gets a
 * balance and NO value. It is still listed, because hiding a real holding is
 * worse than showing it without a price, and `pricedCount` lets the UI admit
 * that the total is partial rather than quietly under-reporting someone's
 * money.
 */
/**
 * Join raw balances to prices, drop dust, and order by value.
 *
 * Exported and pure so it can be asserted directly. The rules below are each
 * a decision that costs real money if it is wrong, and none of them are
 * observable from outside the hook — a component test would only see the
 * final list and could not tell a dust filter from a missing balance.
 *
 * @param {Array}  list      token definitions for the chain
 * @param {object} balances  keyed by symbol, as returned by getBalances()
 * @param {object} priceMap  keyed by coingeckoId
 */
export function buildHoldings(list, balances, priceMap) {
  return (list ?? [])
    .map((tk) => {
      const bal = balances?.[tk.symbol];
      const amount = bal?.formatted ?? 0;
      const price = tk.coingeckoId ? priceMap?.[tk.coingeckoId] : undefined;
      return {
        symbol: tk.symbol,
        name: tk.name,
        address: tk.address,
        native: Boolean(tk.native),
        decimals: tk.decimals,
        coingeckoId: tk.coingeckoId ?? null,
        amount,
        price: Number.isFinite(price) ? price : null,
        value: Number.isFinite(price) ? amount * price : null
      };
    })
    /*
     * Dust is hidden, not zero.
     *
     * A plain `amount > 0` keeps rows like 0.000000000000000001 left over from
     * a rounding remainder, which pushes real holdings off the first screen.
     * The threshold is on VALUE where we have a price (under one cent is
     * noise) and on quantity otherwise, because an unpriced token has no cents
     * to measure — and a memecoin with a huge supply must not be filtered out
     * merely because we cannot price it.
     */
    .filter((r) => (r.value != null ? r.value >= 0.01 : r.amount > 1e-9))
    /*
     * Sorted by fiat value, unpriced last. The largest holding is what the
     * user came to see; alphabetical order would bury it.
     */
    .sort((a, b) => {
      if (a.value == null && b.value == null) return b.amount - a.amount;
      if (a.value == null) return 1;
      if (b.value == null) return -1;
      return b.value - a.value;
    });
}

export function useWalletBalances(wallet) {
  const chainId = wallet?.chainId ?? null;
  const address = wallet?.address ?? null;

  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // Prices come from the same feed the market screen uses, so a coin shows the
  // same number on both — a wallet that disagrees with the market list reads
  // as broken even when both are individually fine.
  const { priceMap } = usePriceMap(100);

  /*
   * Guards a slow response from an old chain overwriting a newer one. Switching
   * network then immediately switching back is enough to interleave two
   * requests, and showing BSC balances under an Ethereum header is a
   * money-screen error, not a cosmetic one.
   */
  const seq = useRef(0);

  const load = useCallback(async () => {
    if (!address || !chainId || !wallet?.getReadProvider) {
      setRows([]);
      return;
    }

    const list = TOKENS[chainId] ?? [];
    if (!list.length) {
      setRows([]);
      return;
    }

    const mine = seq.current + 1;
    seq.current = mine;
    setLoading(true);
    setError(null);

    try {
      const provider = await wallet.getReadProvider(chainId);
      const balances = await getBalances(provider, list, address);
      if (seq.current !== mine) return;

      /*
       * Stored UNFILTERED and unpriced.
       *
       * Filtering here would be a real bug: on a cold start `priceMap` is
       * often still empty, so every token would look unpriced, fall through
       * to the quantity rule, and a 0.4 BNB holding would be dropped as
       * "dust" — then never come back, because the re-price step below only
       * revalues rows that survived. Balances are kept raw; buildHoldings()
       * does the pricing, filtering and ordering on each render instead.
       */
      setRows(list.map((tk) => ({ tk, amount: balances?.[tk.symbol]?.formatted ?? 0 })));
    } catch (err) {
      if (seq.current !== mine) return;
      setError(err?.message || 'BALANCES_FAILED');
      setRows([]);
    } finally {
      if (seq.current === mine) setLoading(false);
    }
    // priceMap is deliberately not read here at all — this function only
    // touches the chain. Pricing happens in the memo below, so a price tick
    // re-renders without triggering another RPC round trip.
  }, [address, chainId, wallet]);

  useEffect(() => {
    load();
  }, [load]);

  /*
   * Re-price without re-reading the chain.
   *
   * Balances change only when a transaction lands; prices change every 30s.
   * Recomputing values here keeps the fiat total live while the RPC stays
   * quiet.
   */
  const priced = useMemo(
    () =>
      buildHoldings(
        rows.map((r) => r.tk),
        Object.fromEntries(rows.map((r) => [r.tk.symbol, { formatted: r.amount }])),
        priceMap
      ),
    [rows, priceMap]
  );

  const total = useMemo(
    () => priced.reduce((sum, r) => sum + (r.value ?? 0), 0),
    [priced]
  );

  const pricedCount = priced.filter((r) => r.value != null).length;

  return {
    rows: priced,
    total,
    /** True when at least one holding could not be priced, so the UI can say so. */
    partial: pricedCount < priced.length,
    loading,
    error,
    refresh: load
  };
}

export default useWalletBalances;
