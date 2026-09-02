/**
 * Multi-chain portfolio aggregation for the Wallet page.
 *
 * Fetches the connected address's balance across every supported EVM chain
 * WITHOUT switching the active wallet network. Uses the user's selected
 * display currency. Concurrency-limited (one chain at a time) so we don't
 * overwhelm public RPCs. Per-chain failure degrades gracefully to an
 * "unavailable" row rather than zero.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { EVM_CHAINS, EVM_CHAIN_ORDER, TOKENS } from '../lib/chains';
import { getBalances } from '../lib/swap';
import { useSettingsStore } from '../store/useSettingsStore';
import { vsOf } from '../lib/currency';
import { useMarkets } from './useMarket';
import { onEvent } from '../lib/intent-ai/os/eventBus';

/**
 * Build normalized holdings for a single chain. Does not throw: failed RPCs
 * surface via `chainError`.
 */
async function fetchChainHoldings({ chainId, address, getReadProvider, priceMap }) {
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
    // Native balance
    let nativeAmt = 0;
    try {
      const { formatEther } = await import('ethers');
      const wei = await provider.getBalance(address);
      nativeAmt = Number(formatEther(wei));
    } catch {
      nativeAmt = null;
    }
    // Token balances via swap.js helper (per-token try/catch inside)
    const bals = await getBalances(provider, list, address);

    // Build rows: native first, then tokens.
    const rows = [];
    if (nativeAmt !== null) {
      const price = cfg.native.coingeckoId ? priceMap?.[cfg.native.coingeckoId] : undefined;
      const valueUsd = Number.isFinite(price) ? nativeAmt * price : null;
      rows.push({
        key: `${chainId}:native`,
        symbol: cfg.native.symbol,
        name: cfg.native.symbol + ' (Native)',
        address: null,
        native: true,
        decimals: cfg.native.decimals,
        coingeckoId: cfg.native.coingeckoId,
        amount: nativeAmt,
        price: Number.isFinite(price) ? price : null,
        value: valueUsd,
        chainId
      });
      if (valueUsd != null) out.totalValue += valueUsd;
      if (valueUsd != null) out.pricedCount += 1;
      out.nativeAmount = nativeAmt;
    }

    for (const tk of list) {
      const bal = bals?.[tk.symbol];
      const amount = bal?.formatted ?? 0;
      const price = tk.coingeckoId ? priceMap?.[tk.coingeckoId] : undefined;
      const value = Number.isFinite(price) ? amount * price : null;
      // Skip dust: < $0.01 when priced, < 1e-9 raw otherwise.
      const isDust = value != null ? value < 0.01 : amount <= 1e-9;
      if (isDust && amount <= 1e-9) continue;
      rows.push({
        key: `${chainId}:${tk.symbol}:${tk.address || 'native'}`,
        symbol: tk.symbol,
        name: tk.name,
        address: tk.address,
        native: false,
        decimals: tk.decimals,
        coingeckoId: tk.coingeckoId ?? null,
        amount,
        price: Number.isFinite(price) ? price : null,
        value,
        chainId
      });
      if (value != null) out.totalValue += value;
      if (value != null) out.pricedCount += 1;
    }
    // Sort rows by value desc, unpriced last
    rows.sort((a, b) => {
      if (a.value == null && b.value == null) return b.amount - a.amount;
      if (a.value == null) return 1;
      if (b.value == null) return -1;
      return b.value - a.value;
    });
    out.rows = rows;
  } catch (err) {
    out.error = err?.message || 'CHAIN_FAILED';
  }
  return out;
}

export function useMultiChainPortfolio(wallet) {
  const address = wallet?.address ?? null;
  const activeChainId = wallet?.chainId ?? null;
  const getReadProvider = wallet?.getReadProvider ?? null;
  const vs = vsOf(useSettingsStore((s) => s.currency));
  const { data: markets, loading: marketsLoading } = useMarkets(250);
  const priceMap = useMemo(() => {
    const m = {};
    (markets ?? []).forEach((c) => { m[c.id] = c.price; });
    return m;
  }, [markets]);

  const [chains, setChains] = useState({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [updatedAt, setUpdatedAt] = useState(0);
  const seq = useRef(0);

  const load = useCallback(async () => {
    if (!address || !getReadProvider) {
      setChains({});
      setLoading(false);
      return;
    }
    const mine = ++seq.current;
    setLoading(true);
    setError(null);
    const next = {};
    // Sequential (concurrency=1) to be gentle to public RPCs.
    for (const cid of EVM_CHAIN_ORDER) {
      if (seq.current !== mine) return; // cancelled
      // eslint-disable-next-line no-await-in-loop
      next[cid] = await fetchChainHoldings({
        chainId: cid, address, getReadProvider, priceMap
      });
    }
    if (seq.current !== mine) return;
    setChains(next);
    setLoading(false);
    setUpdatedAt(Date.now());
  }, [address, getReadProvider, priceMap]);

  // Re-run when account/chain changes or prices update.
  useEffect(() => {
    load();
  }, [load, vs]);

  // Pause when tab hidden.
  useEffect(() => {
    const onVis = () => { if (document.visibilityState === 'visible') load(); };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, [load]);

  /* A verified hosted-checkout settlement is not added to a local balance.
     It causes this same RPC-backed portfolio reader to fetch the wallet again. */
  useEffect(() => onEvent('buySell.completed', () => { void load(); }), [load]);

  // Aggregate view
  const aggregated = useMemo(() => {
    const byChain = EVM_CHAIN_ORDER.map((cid) => chains[cid]).filter(Boolean);
    const totalValue = byChain.reduce((s, c) => s + (c.totalValue || 0), 0);
    const pricedCount = byChain.reduce((s, c) => s + c.pricedCount, 0);
    const totalCount = byChain.reduce((s, c) => s + c.rows.length, 0);
    const failures = byChain.filter((c) => c.error).map((c) => c.chainShort);
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
      partial: failures.length > 0 || pricedCount < totalCount,
      failures
    };
  }, [chains]);

  return {
    chains: aggregated.chains,
    rows: aggregated.allRows,
    totalValue: aggregated.totalValue,
    pricedCount: aggregated.pricedCount,
    totalCount: aggregated.totalCount,
    partial: aggregated.partial,
    failedChains: aggregated.failures,
    activeChainId,
    loading: loading || marketsLoading,
    error,
    updatedAt,
    refresh: load
  };
}
