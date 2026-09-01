/**
 * FBT WALLET ENGINE — COST BASIS + P&L ENGINE
 * ---------------------------------------------------------------------------
 * "How much did this position cost me, and what have I actually made?" The
 * answer is not the current price minus the first buy — it depends on WHICH
 * units were sold, which is why this engine keeps per-asset lots and matches
 * them FIFO (first-in, first-out) on every sale.
 *
 * Every movement is classified first, because a swap and a deposit change the
 * cost basis differently:
 *
 *   BUY          → open new lots at the buy price
 *   SELL         → reduce lots FIFO, realize P&L
 *   SWAP         → SELL the input (realize) + BUY the output (open lots)
 *   TRANSFER_IN  → open lots at the asset's price at arrival
 *   TRANSFER_OUT → reduce lots FIFO (no P&L — same owner, moved custody)
 *   DEPOSIT      → like TRANSFER_IN (external → self)
 *   WITHDRAWAL   → like TRANSFER_OUT (self → external)
 *
 * ─── HONESTY RULES ──────────────────────────────────────────────────────────
 * · Realized P&L is only ever produced by an actual sale/reduction. A holding
 *   that went up is unrealized — the engine never reports it as "made" until
 *   it is realized.
 * · A sale of more units than the lots hold is clamped and flagged
 *   (`overSold:true`), because inventing negative lots would fabricate P&L.
 * · Fees are added to cost on buys and subtracted from proceeds on sells.
 */

export const COST_BASIS_SCHEMA = 'fbt.cost-basis.v1';

export const TRADE_KINDS = Object.freeze(['BUY', 'SELL', 'SWAP', 'TRANSFER_IN', 'TRANSFER_OUT', 'DEPOSIT', 'WITHDRAWAL']);

const num = (v) => (v === null || v === undefined || v === '' || typeof v === 'boolean'
  ? null
  : (Number.isFinite(Number(v)) ? Number(v) : null));

/**
 * Classify a raw movement into one of the TRADE_KINDS.
 * Accepts explicit `kind`, or infers from `direction` + `self`-ness.
 */
export function classifyTrade(tx = {}) {
  const kind = String(tx.kind || tx.type || '').toUpperCase();
  if (TRADE_KINDS.includes(kind)) return kind;
  if (kind === 'TRANSFER') {
    return tx.direction === 'in' ? 'TRANSFER_IN' : 'TRANSFER_OUT';
  }
  const dir = String(tx.direction || '').toLowerCase();
  if (dir === 'in' || tx.toSelf === true) return tx.fromExternal ? 'DEPOSIT' : 'TRANSFER_IN';
  if (dir === 'out' || tx.fromSelf === true) return tx.toExternal ? 'WITHDRAWAL' : 'TRANSFER_OUT';
  return null;
}

/** A lot: a chunk of an asset acquired at a price. */
export function makeLot({ asset, amount, priceUsd, feeUsd = 0, ts = Date.now() } = {}) {
  const qty = num(amount) ?? 0;
  const price = num(priceUsd) ?? 0;
  const fee = num(feeUsd) ?? 0;
  const costPerUnit = qty > 0 ? (qty * price + fee) / qty : 0;
  return {
    asset: String(asset || '').toUpperCase(),
    amount: qty,
    priceUsd: price,
    feeUsd: fee,
    costPerUnit,
    remaining: qty,
    ts
  };
}

/**
 * Apply one trade to a lot list. Mutates nothing — returns the new lots,
 * the realized P&L for this trade, and an event record.
 *
 *   trades that increase a position: BUY, SWAP (output side), TRANSFER_IN, DEPOSIT
 *   trades that decrease a position: SELL, SWAP (input side), TRANSFER_OUT, WITHDRAWAL
 */
export function applyTrade(lots = [], trade = {}) {
  const kind = classifyTrade(trade);
  const asset = String(trade.asset || trade.symbol || '').toUpperCase();
  if (!kind || !asset) return { ok: false, code: 'UNCLASSIFIABLE', lots, realizedPnl: 0, event: null };

  const qty = num(trade.amount) ?? 0;
  const price = num(trade.priceUsd);
  const fee = num(trade.feeUsd) ?? 0;
  const ts = num(trade.ts) ?? Date.now();
  const list = (Array.isArray(lots) ? lots : []).map((l) => ({ ...l }));

  const increasing = ['BUY', 'TRANSFER_IN', 'DEPOSIT'].includes(kind);
  if (increasing) {
    if (qty <= 0 || price == null) return { ok: false, code: 'NEEDS_PRICE_AND_AMOUNT', lots: list, realizedPnl: 0, event: null };
    const lot = makeLot({ asset, amount: qty, priceUsd: price, feeUsd: fee, ts });
    list.push(lot);
    return {
      ok: true,
      lots: list,
      realizedPnl: 0,
      event: { schema: COST_BASIS_SCHEMA, kind: 'OPEN', asset, amount: qty, priceUsd: price, feeUsd: fee, ts, lot }
    };
  }

  /* Decreasing: reduce FIFO. */
  let toSell = qty;
  let proceeds = 0;
  let costOfSold = 0;
  let overSold = false;
  const assetLots = list.filter((l) => l.asset === asset);
  for (const lot of assetLots) {
    if (toSell <= 0) break;
    const take = Math.min(lot.remaining, toSell);
    costOfSold += take * lot.costPerUnit;
    lot.remaining -= take;
    toSell -= take;
  }
  if (toSell > 0) overSold = true;
  if (price != null) proceeds = qty * price - fee;
  const realizedPnl = kind === 'TRANSFER_OUT' || kind === 'WITHDRAWAL'
    ? 0
    : proceeds - costOfSold;
  /* Keep other assets' lots untouched; return only the surviving units. */
  const other = list.filter((l) => l.asset !== asset);
  const updated = assetLots.map((l) => ({ ...l })).filter((l) => l.remaining > 1e-12);
  return {
    ok: true,
    lots: [...other, ...updated],
    realizedPnl,
    overSold,
    event: {
      schema: COST_BASIS_SCHEMA,
      kind,
      asset,
      amount: qty,
      priceUsd: price,
      feeUsd: fee,
      costOfSold,
      proceeds,
      realizedPnl,
      overSold,
      ts
    }
  };
}

/** Open lots from a SWAP's output side (the bought asset). */
export function applySwapOutput(lots = [], { asset = null, amount = null, priceUsd = null, feeUsd = 0, ts = Date.now() } = {}) {
  return applyTrade(lots, { kind: 'BUY', asset, amount, priceUsd, feeUsd, ts });
}

/**
 * Compute realized + unrealized P&L for every asset with lots.
 * `priceMap` is `{ [ASSET]: currentPriceUsd }`.
 */
export function computePnl(lots = [], priceMap = {}) {
  const byAsset = new Map();
  for (const l of Array.isArray(lots) ? lots : []) {
    if (!byAsset.has(l.asset)) byAsset.set(l.asset, []);
    byAsset.get(l.asset).push(l);
  }
  const positions = [];
  let realizedTotal = 0;
  let unrealizedTotal = 0;
  for (const [asset, assetLots] of byAsset.entries()) {
    const amount = assetLots.reduce((s, l) => s + l.remaining, 0);
    const costBasis = assetLots.reduce((s, l) => s + l.remaining * l.costPerUnit, 0);
    const price = num(priceMap?.[asset]);
    const marketValue = amount > 0 && price != null ? amount * price : null;
    const unrealized = marketValue != null ? marketValue - costBasis : null;
    if (unrealized != null) unrealizedTotal += unrealized;
    positions.push({
      asset,
      amount,
      costBasis,
      marketValue,
      unrealizedPnl: unrealized,
      avgCostPerUnit: amount > 0 ? costBasis / amount : 0,
      lots: assetLots.length
    });
  }
  return {
    schema: 'fbt.pnl.v1',
    positions: positions.sort((a, b) => (b.marketValue ?? 0) - (a.marketValue ?? 0)),
    realizedTotal,
    unrealizedTotal: positions.every((p) => p.unrealizedPnl != null) ? unrealizedTotal : null,
    partial: positions.some((p) => p.unrealizedPnl != null) && positions.some((p) => p.unrealizedPnl == null)
  };
}
