/**
 * Multi-chain portfolio aggregation for the Wallet page.
 *
 * Reads the connected address's balances across every supported EVM chain
 * WITHOUT switching the wallet's active network, and prices them in the user's
 * display currency.
 *
 * ─── THE TWO COSTS, AND WHERE EACH IS PAID ─────────────────────────────────
 * A portfolio read is two very different jobs that used to share one cycle:
 *
 *   1. BALANCES — a network round trip per chain (native `eth_getBalance` plus
 *      a `balanceOf` per token). This is the slow one: sixteen chains, and on
 *      a phone over mobile data each public RPC answers in its own time.
 *   2. PRICES   — a multiplication. The market list already refreshes every 30
 *      seconds; nothing about a price changing means the chain has to be asked
 *      again how much the user holds.
 *
 * They are separate now. Balances are read when the account changes, when the
 * user asks for a refresh, when the tab comes back and after a verified
 * settlement — never because a market tick landed. Prices are applied when the
 * numbers are rendered, so a price move re-prices what is already on screen
 * without a single extra RPC call. That alone removed a full sixteen-chain
 * read every 30 seconds for every open wallet page.
 *
 * ─── AND THE FIRST PAINT ───────────────────────────────────────────────────
 * The chains are read in PARALLEL (a small pool, so a public RPC is not
 * hammered), each result is committed the moment it lands, and a previous read
 * for the same address is restored from the device before the first request
 * goes out (src/lib/portfolioSnapshot.js). So the page shows the user's last
 * known holdings immediately — including right after a reload, while the
 * wallet session is still re-attaching — and fills in the truth as it arrives.
 *
 * A chain that fails keeps its last good read and is marked `stale`, never
 * zeroed: an RPC that blinked is not the user's balance going to nothing.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { EVM_CHAINS, EVM_CHAIN_ORDER, TOKENS } from '../lib/chains';
import { getBalances } from '../lib/swap';
import { useMarkets } from './useMarket';
import { onEvent } from '../lib/intent-ai/os/eventBus';
import { readPortfolioSnapshot, writePortfolioSnapshot } from '../lib/portfolioSnapshot';

/**
 * How many chains are read at once.
 *
 * Sixteen at once would be fastest for the user and rude to every public RPC
 * (and a phone's six-connections-per-origin ceiling would queue them anyway);
 * one at a time was what made the page slow. Four is the measured middle:
 * the whole cycle finishes in roughly the time the two slowest chains take.
 */
const CHAIN_CONCURRENCY = 4;

/**
 * Read one chain's balances. Never throws: a failed RPC surfaces as
 * `chainError` so the other fifteen still paint.
 *
 * NO PRICES IN HERE. Amounts are the only thing the network knows; what they
 * are worth is applied at render time (see the aggregate below), so a market
 * tick cannot trigger sixteen more RPC reads.
 */
async function fetchChainHoldings({ chainId, address, getReadProvider }) {
  const cfg = EVM_CHAINS[chainId];
  const list = TOKENS[chainId] ?? [];
  const out = {
    chainId,
    chainShort: cfg.short,
    chainName: cfg.name,
    chainColor: cfg.color,
    native: cfg.native,
    rows: [],
    nativeAmount: 0,
    totalValue: 0,
    pricedCount: 0,
    totalCount: list.length + 1,
    error: null
  };

  try {
    const provider = await getReadProvider(chainId);
    let nativeAmt = null;
    try {
      const { formatEther } = await import('ethers');
      const wei = await provider.getBalance(address);
      nativeAmt = Number(formatEther(wei));
    } catch {
      nativeAmt = null;
    }

    // Token balances via swap.js helper (per-token try/catch inside).
    const bals = await getBalances(provider, list, address);

    // Native first, then tokens.
    if (nativeAmt !== null) {
      out.rows.push({
        key: `${chainId}:native`,
        symbol: cfg.native.symbol,
        name: `${cfg.native.symbol} (Native)`,
        address: null,
        native: true,
        decimals: cfg.native.decimals,
        coingeckoId: cfg.native.coingeckoId,
        amount: nativeAmt,
        chainId
      });
      out.nativeAmount = nativeAmt;
    }

    for (const tk of list) {
      const bal = bals?.[tk.symbol];
      const amount = bal?.formatted ?? 0;
      // Dust: a balance this small is rounding noise, not a holding.
      if (!(amount > 1e-9)) continue;
      out.rows.push({
        key: `${chainId}:${tk.symbol}:${tk.address || 'native'}`,
        symbol: tk.symbol,
        name: tk.name,
        address: tk.address,
        native: false,
        decimals: tk.decimals,
        coingeckoId: tk.coingeckoId ?? null,
        amount,
        chainId
      });
    }
  } catch (err) {
    out.error = err?.message || 'CHAIN_FAILED';
  }
  return out;
}

/**
 * Run `worker` over `items`, at most `limit` at a time.
 *
 * Results keep the input order, so a caller can zip them back to their keys
 * without tracking indices — and one rejection is reported as null rather than
 * taking the whole pool down (every worker here already swallows its own
 * errors; this is the belt for the braces).
 */
async function pooledMap(items, limit, worker) {
  const out = new Array(items.length).fill(null);
  let cursor = 0;
  const runners = new Array(Math.max(1, Math.min(limit, items.length))).fill(0).map(async () => {
    for (;;) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) return;
      try {
        out[index] = await worker(items[index], index);
      } catch {
        out[index] = null;
      }
    }
  });
  await Promise.all(runners);
  return out;
}

/** Price one row against the market map. `null` when the market has no price for it. */
function priceRow(row, priceMap) {
  const quote = row.coingeckoId ? priceMap?.[row.coingeckoId] : null;
  const numeric = quote?.price != null && Number.isFinite(Number(quote.price)) ? Number(quote.price) : null;
  return { price: numeric, value: numeric == null ? null : row.amount * numeric,
    priceProvenance: quote?.dataProvenance || 'unavailable' };
}

export function useMultiChainPortfolio(wallet) {
  const address = wallet?.address ?? null;
  const activeChainId = wallet?.chainId ?? null;
  const getReadProvider = wallet?.getReadProvider ?? null;
  const { data: markets, loading: marketsLoading } = useMarkets(250);
  const priceMap = useMemo(() => {
    const m = {};
    (markets ?? []).forEach((c) => { m[c.id] = { price: c.price, dataProvenance: c.dataProvenance }; });
    return m;
  }, [markets]);

  const [chains, setChains] = useState({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [updatedAt, setUpdatedAt] = useState(0);
  /* Has a cycle EVER completed? This is the flag the UI needs to tell «not read
     yet» (a skeleton is honest) from «being refreshed right now» (the number on
     screen is the last good one and must stay there). */
  const [loaded, setLoaded] = useState(false);
  /* True while the rows on screen came from the device rather than from the
     network this session. The hero says so in one word instead of pretending. */
  const [fromSnapshot, setFromSnapshot] = useState(false);
  const seq = useRef(0);
  /** The last successful read per chain — see the merge in load(). */
  const goodRef = useRef({});
  /** Which address the restored snapshot belongs to, so it is seeded once. */
  const seededRef = useRef(null);

  const load = useCallback(async () => {
    if (!address || !getReadProvider) {
      /*
       * `setChains({})` here used to be unconditional. A fresh `{}` is never
       * `Object.is` the previous `{}`, so every call re-rendered, and because
       * `load` is re-created whenever `priceMap` moves (every market refresh)
       * the empty state churned on a timer. Resetting only when there is
       * actually something to reset keeps the identity — and with it the
       * memoised aggregate below — stable for a disconnected wallet.
       */
      setChains((prev) => (prev && Object.keys(prev).length ? {} : prev));
      goodRef.current = {};
      seededRef.current = null;
      setLoaded(false);
      setFromSnapshot(false);
      setUpdatedAt(0);
      setBusy(false);
      return;
    }
    const mine = ++seq.current;
    setBusy(true);
    setError(null);

    const results = await pooledMap(EVM_CHAIN_ORDER, CHAIN_CONCURRENCY, async (cid) => {
      const result = await fetchChainHoldings({ chainId: cid, address, getReadProvider });
      if (seq.current !== mine) return result;
      /*
       * COMMIT AS EACH CHAIN LANDS.
       *
       * The old loop filled one object and called `setChains` at the end, so a
       * user holding assets on BSC waited behind Scroll, zkSync and Robinhood
       * before the first row appeared. Each chain now paints on arrival, which
       * is what makes a sixteen-network read feel like one.
       */
      setChains((prev) => {
        /*
         * A FAILED CHAIN KEEPS ITS LAST GOOD READ.
         *
         * One public RPC timing out used to replace a whole chain's rows with
         * zeros, which moved the portfolio total DOWN — and if the retry a few
         * seconds later succeeded, back up again. The user saw their net worth
         * drop and recover on its own, and the wallet hero (which shows a
         * placeholder while `totalValue === 0`) paid for it with a flicker to
         * «…» — the reported «عدد موجودی به سه نقطه تبدیل می‌شود».
         *
         * Keeping the previous read is the honest choice: the balance we
         * already verified did not become zero, and `stale` says it was not
         * re-read this round. A FIRST failure (nothing to keep) still reports
         * the chain as failed, which is what drives the coverage badge.
         */
        const previous = goodRef.current[cid];
        const next = result.error && previous
          ? { ...previous, stale: true, error: result.error }
          : result;
        if (!result.error) goodRef.current[cid] = result;
        return { ...prev, [cid]: next };
      });
      return result;
    });

    if (seq.current !== mine) return;
    setFromSnapshot(false);
    setBusy(false);
    setLoaded(true);
    setUpdatedAt(Date.now());
    /* Remember what we just verified, for the next document's first paint. */
    writePortfolioSnapshot({ address, chains: results.filter(Boolean) });
  }, [address, getReadProvider]);

  /*
   * THE SNAPSHOT SEED.
   *
   * Runs before the first request of a session, once per address: the numbers
   * the device already verified are on screen in the same frame the page
   * mounts, marked as a previous read, and replaced chain by chain as the
   * fresh cycle lands. It is what makes a reload look like a reload instead of
   * like a wallet that was just disconnected.
   */
  useEffect(() => {
    if (!address || !getReadProvider) return;
    if (seededRef.current === address.toLowerCase()) return;
    seededRef.current = address.toLowerCase();
    const snapshot = readPortfolioSnapshot(address);
    if (!snapshot?.chains?.length) return;
    const seeded = {};
    for (const chain of snapshot.chains) {
      const cfg = EVM_CHAINS[chain.chainId];
      if (!cfg) continue;
      seeded[chain.chainId] = {
        chainId: chain.chainId,
        chainShort: cfg.short,
        chainName: cfg.name,
        chainColor: cfg.color,
        native: cfg.native,
        rows: (chain.rows ?? []).map((row) => ({ ...row })),
        nativeAmount: chain.nativeAmount ?? 0,
        totalValue: 0,
        pricedCount: 0,
        totalCount: (chain.rows ?? []).length,
        error: null,
        stale: true,
        fromSnapshot: true
      };
    }
    if (!Object.keys(seeded).length) return;
    setChains(seeded);
    setLoaded(true);
    setFromSnapshot(true);
    setUpdatedAt(snapshot.at);
  }, [address, getReadProvider]);

  /* Read when the account (or the provider behind it) changes. Prices are NOT
     a dependency — see the header: a market tick re-prices what is on screen,
     it does not re-read the chains. */
  useEffect(() => {
    load();
  }, [load]);

  // Pause when tab hidden; refresh on return.
  useEffect(() => {
    const onVis = () => { if (document.visibilityState === 'visible') load(); };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, [load]);

  /* A verified hosted-checkout settlement is not added to a local balance.
     It causes this same RPC-backed portfolio reader to fetch the wallet again. */
  useEffect(() => onEvent('buySell.completed', () => { void load(); }), [load]);

  // Aggregate view — priced HERE, from the live market map.
  const aggregated = useMemo(() => {
    const byChain = EVM_CHAIN_ORDER.map((cid) => chains[cid]).filter(Boolean).map((chain) => {
      let totalValue = 0;
      let pricedCount = 0;
      const rows = chain.rows.map((row) => {
        const { price, value, priceProvenance } = priceRow(row, priceMap);
        if (value != null) {
          totalValue += value;
          pricedCount += 1;
        }
        return { ...row, price, value, priceProvenance };
      });
      rows.sort((a, b) => {
        if (a.value == null && b.value == null) return b.amount - a.amount;
        if (a.value == null) return 1;
        if (b.value == null) return -1;
        return b.value - a.value;
      });
      return { ...chain, rows, totalValue, pricedCount, totalCount: rows.length };
    });

    const totalValue = byChain.reduce((s, c) => s + (c.totalValue || 0), 0);
    const pricedCount = byChain.reduce((s, c) => s + c.pricedCount, 0);
    const totalCount = byChain.reduce((s, c) => s + c.rows.length, 0);
    const failures = byChain.filter((c) => c.error).map((c) => c.chainShort);
    // The market screen intentionally displays offline/stale snapshots. A
    // wallet USD total derived from them remains useful for browsing but can
    // never be a fresh capital check for an executable strategy.
    const priceDataStatus = !markets?.length ? 'unavailable'
      : markets.every((c) => c.dataProvenance === 'live') ? 'live' : 'stale';
    // Flatten rows across all chains for "All networks"
    const allRows = byChain.flatMap((c) => c.rows);
    allRows.sort((a, b) => {
      if (a.value == null && b.value == null) return b.amount - a.amount;
      if (a.value == null) return 1;
      if (b.value == null) return -1;
      return b.value - a.value;
    });
    return {
      chains: byChain,
      totalValue,
      pricedCount,
      totalCount,
      allRows,
      /* `partial` now also covers a chain whose rows are the previous read:
         the total is still the best number we have, but the coverage badge is
         not allowed to call it fresh. */
      partial: failures.length > 0 || pricedCount < totalCount || byChain.some((c) => c.stale)
        || priceDataStatus !== 'live',
      priceDataStatus,
      staleChains: byChain.filter((c) => c.stale).map((c) => c.chainShort),
      failures
    };
  }, [chains, priceMap, markets]);

  /*
   * ─── THE RETURNED OBJECT IS MEMOISED, AND THAT IS LOAD-BEARING ──────────
   * This hook used to `return { … }` a fresh literal on every render. Two
   * consumers only ever read fields off it, so nobody noticed — until
   * `IntentAIUnified` put the whole object in a `useMemo` dependency list:
   *
   *     const multi = useMultiChainPortfolio(…);            // new identity
   *     const aiContext = useMemo(…, [ …, multi, … ]);      // new identity
   *     useEffect(() => { centralIngest(aiContext); setConvState(…); },
   *               [aiContext, …]);                          // fires again
   *
   * `setConvState` re-renders, `multi` is new again, and the effect re-fires:
   * a self-sustaining loop measured at ~1,700 `POST /api/system/state` per
   * second on the /intent page. That storm saturated the WebView's six
   * connections per origin and tripped the server's per-IP budget, which is
   * what made the rest of the app look like it had lost the internet, and
   * what made the Multi-AI panel's own `/gateway/providers` read come back
   * throttled so it printed «گیت‌وی پاسخ نداد» over an empty fleet.
   *
   * The hook owns its own output identity now: callers may safely depend on
   * the object itself.
   */
  return useMemo(() => ({
    chains: aggregated.chains,
    rows: aggregated.allRows,
    totalValue: aggregated.totalValue,
    pricedCount: aggregated.pricedCount,
    totalCount: aggregated.totalCount,
    partial: aggregated.partial,
    priceDataStatus: aggregated.priceDataStatus,
    staleChains: aggregated.staleChains,
    failedChains: aggregated.failures,
    activeChainId,
    /* `loading` means «a balance read is in flight, or nothing has ever been
       read» — NOT «prices are refreshing». The 30-second market tick is
       `pricing`, and it no longer moves this flag, so the refresh control
       stops spinning every half minute for work that finished seconds ago. */
    loading: busy || !loaded,
    pricing: marketsLoading,
    /* THE FLAG THE HERO NEEDS. `loading` cycles on every read; `loaded` flips
       once and stays. A number already on screen is never replaced by a
       placeholder again — only the FIRST paint shows one. */
    loaded,
    /* The rows on screen are the device's previous read, not this session's. */
    fromSnapshot,
    error,
    updatedAt,
    refresh: load
  }), [
    aggregated.chains, aggregated.allRows, aggregated.totalValue, aggregated.pricedCount,
    aggregated.totalCount, aggregated.partial, aggregated.priceDataStatus, aggregated.staleChains, aggregated.failures,
    activeChainId, busy, loaded, fromSnapshot, marketsLoading, error, updatedAt, load
  ]);
}
