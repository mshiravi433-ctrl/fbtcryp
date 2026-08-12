/**
 * PORTFOLIO INTELLIGENCE — cost basis, P&L, allocation, risk.
 * ---------------------------------------------------------------------------
 * The wallet screen used to show a total and a list. That answers "what do
 * I hold" and not "how am I doing". This module keeps a local lot ledger
 * (average cost) and derives the numbers a serious dashboard leads with.
 *
 * ─── HONEST LIMITS ──────────────────────────────────────────────────────────
 * We do not see every on-chain transfer — only swaps this app recorded and
 * lots the user imported. A cost basis built from a partial history is
 * labelled partial, never presented as a tax form. The tax export is a CSV
 * of WHAT WE SAW, with a header that says so.
 */

const LOTS_KEY = 'fbt-portfolio-lots-v1';
const SNAP_KEY = 'fbt-portfolio-snap-v1';

const STABLES = new Set(['USDT', 'USDC', 'DAI', 'FDUSD', 'TUSD', 'USDE', 'USDD', 'BUSD']);

export function isStableSymbol(sym) {
  return STABLES.has(String(sym || '').toUpperCase());
}

function readJson(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    return parsed ?? fallback;
  } catch {
    return fallback;
  }
}

function writeJson(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export function loadLots() {
  const rows = readJson(LOTS_KEY, []);
  return Array.isArray(rows) ? rows : [];
}

export function saveLots(lots) {
  writeJson(LOTS_KEY, (lots || []).slice(0, 500));
  return true;
}

/**
 * Record a fill. `side` is 'buy' (spent quote, received base) or 'sell'.
 * Average-cost: a buy raises qty and cost; a sell reduces qty proportionally
 * and realises P&L against the average.
 */
export function recordLot({
  symbol,
  chainId = null,
  side,
  qty,
  priceUsd,
  feeUsd = 0,
  at = Date.now(),
  txHash = null
} = {}) {
  const q = Number(qty);
  const p = Number(priceUsd);
  if (!symbol || !Number.isFinite(q) || q <= 0 || !Number.isFinite(p) || p < 0) {
    return { error: 'BAD_LOT' };
  }
  if (side !== 'buy' && side !== 'sell') return { error: 'BAD_SIDE' };

  const lots = loadLots();
  const row = {
    id: `l_${at}_${Math.random().toString(36).slice(2, 8)}`,
    symbol: String(symbol).toUpperCase(),
    chainId: chainId == null ? null : Number(chainId),
    side,
    qty: q,
    priceUsd: p,
    feeUsd: Number.isFinite(Number(feeUsd)) ? Math.max(0, Number(feeUsd)) : 0,
    at,
    txHash
  };
  lots.unshift(row);
  saveLots(lots);
  return { lot: row, lots };
}

/** Average-cost book per symbol. */
export function costBasis(lots = loadLots()) {
  const book = new Map();
  /* Same-millisecond fills must stay in the order they were recorded.
     `unshift` puts newer rows first, so a stable tie-break walks the array
     backwards when timestamps collide — otherwise a buy and its sell in the
     same tick can process as sell-then-buy and invent a zero-qty P&L. */
  const ordered = lots
    .map((l, i) => ({ l, i }))
    .sort((a, b) => (a.l.at ?? 0) - (b.l.at ?? 0) || b.i - a.i)
    .map((x) => x.l);
  for (const l of ordered) {
    const sym = l.symbol;
    const cur = book.get(sym) ?? { symbol: sym, qty: 0, cost: 0, realised: 0, fees: 0, buys: 0, sells: 0 };
    const fee = Number(l.feeUsd) || 0;
    cur.fees += fee;
    if (l.side === 'buy') {
      cur.qty += l.qty;
      cur.cost += l.qty * l.priceUsd + fee;
      cur.buys += 1;
    } else {
      const avg = cur.qty > 0 ? cur.cost / cur.qty : l.priceUsd;
      const sold = Math.min(l.qty, cur.qty);
      cur.realised += sold * (l.priceUsd - avg) - fee;
      if (cur.qty > 0) {
        const remain = Math.max(0, cur.qty - l.qty);
        cur.cost = remain === 0 ? 0 : cur.cost * (remain / cur.qty);
        cur.qty = remain;
      }
      cur.sells += 1;
    }
    book.set(sym, cur);
  }
  return [...book.values()];
}

/**
 * Snapshot the current total so 24h / 7d deltas have something to compare.
 * Called whenever the wallet recomputes a live total.
 */
export function recordSnapshot(totalUsd, now = Date.now()) {
  const n = Number(totalUsd);
  if (!Number.isFinite(n) || n < 0) return null;
  const snaps = readJson(SNAP_KEY, []);
  const rows = Array.isArray(snaps) ? snaps : [];
  const last = rows[rows.length - 1];
  if (last && now - last.at < 10 * 60_000) {
    last.value = n;
    last.at = now;
  } else {
    rows.push({ at: now, value: n });
  }
  const cutoff = now - 30 * 86400000;
  const kept = rows.filter((s) => s.at >= cutoff);
  writeJson(SNAP_KEY, kept);
  return kept;
}

function changeSince(snaps, ms, now = Date.now()) {
  if (!snaps.length) return null;
  const target = now - ms;
  let best = snaps[0];
  for (const s of snaps) {
    if (s.at <= target) best = s;
    else break;
  }
  if (best.at > target + 12 * 3600000 && snaps.length < 3) return null;
  const latest = snaps[snaps.length - 1];
  return { abs: latest.value - best.value, from: best.value, at: best.at };
}

/**
 * Build the dashboard object from live holdings + the lot ledger.
 *
 * `holdings` is the shape useWalletBalances already produces:
 *   { symbol, value, amount, chainId? }
 */
export function buildIntelligence({ holdings = [], lots = loadLots(), now = Date.now() } = {}) {
  const rows = (holdings || []).filter((h) => Number(h.value) > 0);
  const total = rows.reduce((s, r) => s + (Number(r.value) || 0), 0);
  const snaps = recordSnapshot(total, now) || readJson(SNAP_KEY, []);
  const ch24 = changeSince(snaps, 86400000, now);
  const ch7 = changeSince(snaps, 7 * 86400000, now);

  const book = costBasis(lots);
  const bySym = Object.fromEntries(book.map((b) => [b.symbol, b]));

  const priced = rows.map((r) => {
    const b = bySym[String(r.symbol).toUpperCase()];
    const value = Number(r.value) || 0;
    const cost = b && b.qty > 0 ? b.cost : null;
    const pnl = cost != null ? value - cost : null;
    const pnlPct = cost ? (pnl / cost) * 100 : null;
    return {
      symbol: r.symbol,
      name: r.name,
      amount: r.amount,
      value,
      cost,
      pnl,
      pnlPct,
      weight: total > 0 ? (value / total) * 100 : 0,
      stable: isStableSymbol(r.symbol),
      chainId: r.chainId ?? null,
      native: Boolean(r.native)
    };
  });

  const ranked = [...priced].sort((a, b) => (b.pnlPct ?? -Infinity) - (a.pnlPct ?? -Infinity));
  const withPnl = ranked.filter((r) => r.pnlPct != null);
  const best = withPnl[0] ?? null;
  const worst = withPnl.length ? withPnl[withPnl.length - 1] : null;

  const stableUsd = priced.filter((r) => r.stable).reduce((s, r) => s + r.value, 0);
  const topShare = priced[0] && total > 0 ? priced[0].weight : 0;

  const chainMap = new Map();
  for (const r of priced) {
    const k = r.chainId ?? 'unknown';
    chainMap.set(k, (chainMap.get(k) || 0) + r.value);
  }
  const chainAllocation = [...chainMap.entries()]
    .map(([id, value]) => ({ chainId: id, value, weight: total > 0 ? (value / total) * 100 : 0 }))
    .sort((a, b) => b.value - a.value);

  const realised = book.reduce((s, b) => s + b.realised, 0);
  const unrealised = priced.reduce((s, r) => s + (r.pnl ?? 0), 0);
  const costTotal = priced.reduce((s, r) => s + (r.cost ?? 0), 0);

  /* Risk: concentration + non-stable share + missing cost basis. */
  let risk = 20;
  if (topShare >= 70) risk += 30;
  else if (topShare >= 50) risk += 18;
  else if (topShare >= 35) risk += 10;
  const stablePct = total > 0 ? (stableUsd / total) * 100 : 0;
  if (stablePct < 5 && total > 0) risk += 16;
  else if (stablePct < 20) risk += 8;
  if (priced.filter((r) => r.cost == null).length === priced.length && priced.length) risk += 10;
  risk = Math.max(5, Math.min(95, Math.round(risk)));

  return {
    total,
    change24h: ch24,
    change7d: ch7,
    realised,
    unrealised,
    pnl: realised + unrealised,
    cost: costTotal || null,
    rows: priced.sort((a, b) => b.value - a.value),
    best,
    worst,
    stableUsd,
    stablePct,
    topShare,
    whaleExposure: topShare,
    chainAllocation,
    riskScore: risk,
    riskBand: risk >= 70 ? 'high' : risk >= 45 ? 'medium' : 'low',
    partial: priced.some((r) => r.cost == null),
    lotCount: lots.length,
    generatedAt: now
  };
}

/** CSV of recorded lots — not a tax filing. */
export function taxCsv(lots = loadLots()) {
  const header = 'date,side,symbol,qty,price_usd,fee_usd,tx,note';
  const lines = lots.map((l) => {
    const day = new Date(l.at || 0).toISOString();
    return [
      day,
      l.side,
      l.symbol,
      l.qty,
      l.priceUsd,
      l.feeUsd ?? 0,
      l.txHash ?? '',
      'recorded-by-fbt-not-complete'
    ].join(',');
  });
  return [header, ...lines].join('\n');
}
