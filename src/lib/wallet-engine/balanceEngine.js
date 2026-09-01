/**
 * FBT WALLET ENGINE — UNIVERSAL BALANCE ENGINE
 * ---------------------------------------------------------------------------
 * One balance model for EVM + Solana + Bitcoin. Every source (an EVM provider
 * call, a Solana token account, a BTC UTXO sum) is normalized into the same
 * `fbt.balance.v1` row and then aggregated:
 *
 *   · per-asset totals across chains (your USDC on Ethereum + Base + Solana)
 *   · live-ish USD value (price is supplied, never invented here)
 *   · network detection — which chains actually hold a given asset
 *
 * ─── HONESTY RULES ──────────────────────────────────────────────────────────
 * · `valueUsd` is null when the price is missing. A partial feed renders as a
 *   partial total (`pricedCount < totalCount`), never as a quietly lower sum.
 * · A row with no recognizable family is kept but flagged `family:null` —
 *   dropping it would hide a real holding; guessing would mislabel it.
 */

export const BALANCE_SCHEMA = 'fbt.balance.v1';

const num = (v) => {
  if (v === null || v === undefined || v === '' || typeof v === 'boolean') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/**
 * Normalize a raw balance into `fbt.balance.v1`.
 * Accepts EVM ({chainId, token:{symbol,address,decimals}, formatted}),
 * Solana ({mint, symbol, decimals, uiAmount}) and Bitcoin ({sats, btc}) shapes.
 */
export function normalizeBalance(row = {}) {
  const family = ['evm', 'solana', 'bitcoin', 'ton'].includes(String(row.family || '').toLowerCase())
    ? String(row.family).toLowerCase()
    : (row.chainId != null ? 'evm' : (row.mint ? 'solana' : (row.sats != null || row.btc != null ? 'bitcoin' : null)));
  const symbol = String(row.symbol || row.tk?.symbol || '').toUpperCase() || null;
  const address = row.address || row.token?.address || row.mint || null;
  const decimals = num(row.decimals ?? row.token?.decimals) ?? (family === 'bitcoin' ? 8 : 18);
  const amount = num(row.amount ?? row.formatted ?? row.uiAmount ?? (row.btc != null ? row.btc : (row.sats != null ? Number(row.sats) / 1e8 : null)));
  const priceUsd = num(row.priceUsd ?? row.price);
  const valueUsd = amount != null && priceUsd != null ? amount * priceUsd : null;
  return {
    schema: BALANCE_SCHEMA,
    family,
    chainId: row.chainId ?? (family === 'solana' ? 'solana:mainnet' : (family === 'bitcoin' ? 'bitcoin:mainnet' : null)),
    symbol,
    name: row.name || row.token?.name || symbol || null,
    address: address ? String(address) : null,
    native: Boolean(row.native || row.token?.native || (family === 'bitcoin' && symbol === 'BTC')),
    decimals,
    amount,
    priceUsd,
    valueUsd
  };
}

/** Aggregate normalized rows into totals + per-dimension breakdowns. */
export function aggregateBalances(rows = []) {
  const byAsset = new Map();
  const byFamily = new Map();
  const byChain = new Map();
  let totalUsd = 0;
  let pricedCount = 0;
  let totalCount = 0;

  for (const raw of rows) {
    const r = raw?.schema === BALANCE_SCHEMA ? raw : normalizeBalance(raw);
    totalCount += 1;
    if (r.valueUsd != null) {
      totalUsd += r.valueUsd;
      pricedCount += 1;
    }
    const key = r.symbol || r.address || `?${totalCount}`;
    if (!byAsset.has(key)) byAsset.set(key, []);
    byAsset.get(key).push(r);

    const fk = r.family || 'unknown';
    if (!byFamily.has(fk)) byFamily.set(fk, { family: fk, amount: 0, valueUsd: 0, count: 0, priced: 0 });
    const f = byFamily.get(fk);
    f.count += 1;
    if (r.valueUsd != null) { f.valueUsd += r.valueUsd; f.priced += 1; }

    const ck = r.chainId ?? `${fk}:null`;
    if (!byChain.has(ck)) byChain.set(ck, { chainId: r.chainId, family: r.family, valueUsd: 0, count: 0, priced: 0 });
    const c = byChain.get(ck);
    c.count += 1;
    if (r.valueUsd != null) { c.valueUsd += r.valueUsd; c.priced += 1; }
  }

  const assets = [...byAsset.entries()].map(([symbol, items]) => {
    const priced = items.filter((r) => r.valueUsd != null);
    const valueUsd = priced.length === items.length ? priced.reduce((s, r) => s + r.valueUsd, 0) : null;
    return {
      symbol,
      name: items[0]?.name || symbol,
      items,
      chains: items.length,
      totalAmount: items.reduce((s, r) => s + (r.amount ?? 0), 0),
      valueUsd,
      priced: priced.length
    };
  }).sort((a, b) => (b.valueUsd ?? -1) - (a.valueUsd ?? -1));

  return {
    schema: 'fbt.balance-aggregate.v1',
    totalUsd,
    totalCount,
    pricedCount,
    unpricedCount: totalCount - pricedCount,
    partial: pricedCount > 0 && pricedCount < totalCount,
    byAsset: assets,
    byFamily: [...byFamily.values()],
    byChain: [...byChain.values()]
  };
}

/** The chain references on which a given asset appears. */
export function assetNetworks(rows = [], symbolOrAddress) {
  const q = String(symbolOrAddress || '').trim().toUpperCase();
  const seen = [];
  const seenSet = new Set();
  for (const raw of rows) {
    const r = raw?.schema === BALANCE_SCHEMA ? raw : normalizeBalance(raw);
    const matches = (r.symbol && String(r.symbol).toUpperCase() === q)
      || (r.address && String(r.address).toLowerCase() === q.toLowerCase());
    if (!matches) continue;
    const ref = `${r.family}:${r.chainId ?? ''}`;
    if (seenSet.has(ref)) continue;
    seenSet.add(ref);
    seen.push({ family: r.family, chainId: r.chainId, address: r.address, symbol: r.symbol });
  }
  return seen;
}

/** Detect which families/chains are present in a set of rows at all. */
export function detectNetworks(rows = []) {
  const nets = new Set();
  for (const raw of rows) {
    const r = raw?.schema === BALANCE_SCHEMA ? raw : normalizeBalance(raw);
    if (r.family) nets.add(r.family);
  }
  return [...nets];
}
