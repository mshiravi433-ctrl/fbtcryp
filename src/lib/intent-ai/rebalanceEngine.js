/**
 * FBT INTENT OS — portfolio rebalance planner.
 * ---------------------------------------------------------------------------
 * Turns live holdings into a reviewable plan:
 *
 *   Wallet → Balances → Portfolio → Target → Difference → Required trades
 *
 * Numbers come from the attested holdings. Missing prices stay missing —
 * they are never guessed. A plan is never an order: `requiresConfirmation`
 * is always true and nothing here signs.
 */

export const REBALANCE_PLAN_SCHEMA = 'fbt.ai-rebalance-plan.v1';

const STABLES = new Set(['USDC', 'USDT', 'DAI', 'BUSD', 'FDUSD', 'TUSD', 'USDP', 'USDD', 'CASH']);

/** Default 40 / 35 / 25 split the product uses when the user did not name weights. */
export const DEFAULT_REBALANCE_TARGET = Object.freeze([
  { symbol: 'BTC', pct: 40 },
  { symbol: 'ETH', pct: 35 },
  { symbol: 'USDC', pct: 25 }
]);

const num = (v) => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));

function round2(n) {
  return Math.round(Number(n) * 100) / 100;
}

function round1(n) {
  return Math.round(Number(n) * 10) / 10;
}

function token(v) {
  return String(v || '').trim().toUpperCase().slice(0, 16);
}

/**
 * Collapse holdings/balances into { symbol, valueUsd, amount, chainId } rows
 * that actually have a priced value. Unpriced rows are listed separately so
 * the UI can say so instead of inventing a dollar figure.
 */
export function normalizeHoldings({ holdings = [], balances = [] } = {}) {
  const bySymbol = new Map();
  const unpriced = [];
  const push = (row) => {
    const symbol = token(row?.symbol);
    if (!symbol) return;
    const valueUsd = num(row.valueUsd ?? row.value);
    const amount = num(row.amount);
    const chainId = num(row.chainId ?? row.chain);
    if (valueUsd == null || valueUsd < 0) {
      if (amount != null && amount > 0) unpriced.push({ symbol, amount, chainId });
      return;
    }
    if (valueUsd === 0 && !(amount > 0)) return;
    const prev = bySymbol.get(symbol) || { symbol, valueUsd: 0, amount: 0, chainId: chainId ?? null };
    prev.valueUsd += valueUsd;
    if (amount != null) prev.amount += amount;
    if (prev.chainId == null && chainId != null) prev.chainId = chainId;
    bySymbol.set(symbol, prev);
  };
  for (const h of Array.isArray(holdings) ? holdings : []) push(h);
  if (bySymbol.size === 0) {
    for (const b of Array.isArray(balances) ? balances : []) push(b);
  }
  const rows = [...bySymbol.values()].map((r) => ({
    symbol: r.symbol,
    valueUsd: round2(r.valueUsd),
    amount: r.amount || null,
    chainId: r.chainId
  })).sort((a, b) => b.valueUsd - a.valueUsd);
  const totalValueUsd = round2(rows.reduce((s, r) => s + r.valueUsd, 0));
  return { rows, totalValueUsd, unpriced };
}

export function currentAllocation(rows, totalValueUsd) {
  if (!(totalValueUsd > 0)) return [];
  return rows.map((r) => ({
    symbol: r.symbol,
    valueUsd: r.valueUsd,
    amount: r.amount,
    chainId: r.chainId,
    pct: round1((r.valueUsd / totalValueUsd) * 100)
  }));
}

function resolveTarget(target, current) {
  if (Array.isArray(target) && target.length) {
    const cleaned = target
      .map((t) => ({ symbol: token(t.symbol), pct: num(t.pct) }))
      .filter((t) => t.symbol && t.pct != null && t.pct >= 0);
    const sum = cleaned.reduce((s, t) => s + t.pct, 0);
    if (cleaned.length && Math.abs(sum - 100) <= 1.5) return cleaned;
    if (cleaned.length && sum > 0) {
      return cleaned.map((t) => ({ symbol: t.symbol, pct: round1((t.pct / sum) * 100) }));
    }
  }
  /* Keep assets the user already holds that sit in the default target;
     if they hold none of BTC/ETH/USDC, keep current weights as the
     "no-op" target rather than inventing a book they don't own. */
  const have = new Set(current.map((c) => c.symbol));
  const overlap = DEFAULT_REBALANCE_TARGET.filter((t) => have.has(t.symbol));
  if (overlap.length >= 2) return DEFAULT_REBALANCE_TARGET.map((t) => ({ ...t }));
  if (current.length) return current.map((c) => ({ symbol: c.symbol, pct: c.pct }));
  return DEFAULT_REBALANCE_TARGET.map((t) => ({ ...t }));
}

/**
 * Build the trade list that moves current weights onto the target.
 *
 * Overweight legs are sold into a stable (USDC if present, else the largest
 * stable, else the most overweight asset). Underweight legs are bought from
 * that same stable. Dust below $1 is ignored so we never emit a noise swap.
 */
export function buildRebalanceTrades({ current = [], target = [], totalValueUsd = 0, feeBps = 50 } = {}) {
  if (!(totalValueUsd > 0)) return { trades: [], estimatedFeeUsd: null };
  const targetMap = new Map(target.map((t) => [t.symbol, t.pct]));
  const currentMap = new Map(current.map((c) => [c.symbol, c]));
  const symbols = new Set([...currentMap.keys(), ...targetMap.keys()]);

  const deltas = [];
  for (const symbol of symbols) {
    const nowPct = currentMap.get(symbol)?.pct || 0;
    const wantPct = targetMap.get(symbol) || 0;
    const deltaPct = round1(wantPct - nowPct);
    const deltaUsd = round2((deltaPct / 100) * totalValueUsd);
    deltas.push({
      symbol,
      fromPct: nowPct,
      toPct: wantPct,
      deltaPct,
      deltaUsd,
      chainId: currentMap.get(symbol)?.chainId ?? null
    });
  }

  const stable = ['USDC', 'USDT', 'DAI'].find((s) => symbols.has(s)) || [...symbols].find((s) => STABLES.has(s)) || 'USDC';
  const sells = deltas.filter((d) => d.deltaUsd < -1 && d.symbol !== stable);
  const buys = deltas.filter((d) => d.deltaUsd > 1 && d.symbol !== stable);
  const trades = [];

  for (const sell of sells) {
    trades.push({
      type: 'SWAP',
      from: sell.symbol,
      to: stable,
      amountUsd: round2(Math.abs(sell.deltaUsd)),
      chainId: sell.chainId,
      side: 'sell'
    });
  }
  for (const buy of buys) {
    trades.push({
      type: 'SWAP',
      from: stable,
      to: buy.symbol,
      amountUsd: round2(buy.deltaUsd),
      chainId: buy.chainId,
      side: 'buy'
    });
  }

  const volume = trades.reduce((s, t) => s + t.amountUsd, 0);
  const estimatedFeeUsd = feeBps > 0 ? round2(volume * (feeBps / 10_000)) : 0;
  return { trades, estimatedFeeUsd, deltas, stable };
}

/**
 * The one function the OS calls. Returns a plan the Human Response layer
 * can narrate and the execution runtime can walk, or an honest empty plan.
 */
export function planRebalance({
  holdings = [],
  balances = [],
  target = null,
  feeBps = 50,
  now = Date.now()
} = {}) {
  const { rows, totalValueUsd, unpriced } = normalizeHoldings({ holdings, balances });
  const current = currentAllocation(rows, totalValueUsd);
  if (!(totalValueUsd > 0) || !current.length) {
    return {
      ok: false,
      schema: REBALANCE_PLAN_SCHEMA,
      code: rows.length || unpriced.length ? 'UNPRICED_HOLDINGS' : 'EMPTY_PORTFOLIO',
      current: [],
      target: [],
      trades: [],
      totalValueUsd: totalValueUsd || null,
      unpriced,
      requiresConfirmation: true,
      createdAt: now
    };
  }
  const resolvedTarget = resolveTarget(target, current);
  const { trades, estimatedFeeUsd, deltas, stable } = buildRebalanceTrades({
    current,
    target: resolvedTarget,
    totalValueUsd,
    feeBps
  });
  const largest = current[0];
  const riskiest = [...current].sort((a, b) => {
    const sa = STABLES.has(a.symbol) ? -1 : a.pct;
    const sb = STABLES.has(b.symbol) ? -1 : b.pct;
    return sb - sa;
  })[0];
  return {
    ok: true,
    schema: REBALANCE_PLAN_SCHEMA,
    current,
    target: resolvedTarget,
    trades,
    deltas,
    stable,
    totalValueUsd,
    tradeCount: trades.length,
    estimatedFeeUsd,
    largest: largest ? { symbol: largest.symbol, pct: largest.pct } : null,
    riskiest: riskiest && !STABLES.has(riskiest.symbol) ? { symbol: riskiest.symbol, pct: riskiest.pct } : null,
    unpriced,
    requiresConfirmation: true,
    autoExecute: false,
    createdAt: now
  };
}

export function change24hFromMarket(market) {
  const n = num(market?.change24hPct);
  return n == null ? null : round1(n);
}
