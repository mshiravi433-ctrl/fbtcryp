/**
 * FBT AI INTELLIGENCE — PORTFOLIO PERFORMANCE & ATTRIBUTION
 * ---------------------------------------------------------------------------
 * «بررسی پرتفوی باید از نظر زیان‌دهی، سود، بهترین و ضعیف‌ترین عملکرد بررسی
 *  کند و داده‌های معتبر بده»
 *
 * Answering that needs a number the portfolio room did not have. The lot
 * ledger can produce a REALISED P&L only for assets whose buy price was
 * recorded, and most wallets have none — which is why the old screen printed
 * «نامشخص» in a grey box and moved on. That answer was honest but useless.
 *
 * There is a second, independent measurement available: every holding in the
 * wallet is priced from the market feed, and that same feed carries the
 * asset's own 24h and 7d move. Combining the two gives:
 *
 *   · the portfolio's own return over 24h / 7d, on CURRENT weights;
 *   · how much money that move was worth, per holding and in total;
 *   · which holding carried the book and which one dragged it;
 *   · the winners and losers list, by measured percentage.
 *
 * ─── WHAT THIS IS, AND WHAT IT IS NOT ───────────────────────────────────────
 * This is a PRICE PERFORMANCE of the mix you hold today. It is NOT realised
 * profit: it does not know when you bought, so it cannot claim a gain you did
 * not take. Both facts are printed on screen — `basis` says
 * 'current-weights-times-asset-return' and the UI labels the block as
 * performance, never as profit. Realised/unrealised P&L keeps coming from the
 * lot ledger and stays «نامشخص» when there is no cost basis.
 *
 * ─── THE THREE REFUSALS ─────────────────────────────────────────────────────
 *   1. A holding whose market row is missing is NOT counted as 0% — it is
 *      excluded and named in `missing`. A zero would drag the weighted average
 *      toward a return the asset may not have had.
 *   2. Weight is taken from the live valuation, so a 90%-of-book asset cannot
 *      be outvoted by a dust position that moved 400%.
 *   3. When coverage by weight is below the threshold, the portfolio return is
 *      `null` and `status` is 'partial'/'unavailable'. A number computed on
 *      11% of the book would look exactly like a number computed on 100%.
 */

export const PERFORMANCE_VERSION = 'fbt.portfolio-performance.v1';

/** Below this share of priced weight, a weighted return is not reported. */
export const MIN_COVERED_WEIGHT_PCT = 35;

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

const num = (v) => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

const round = (v, digits = 2) => {
  if (!isNum(v)) return null;
  const f = 10 ** digits;
  return Math.round(v * f) / f;
};

/**
 * Index the market feed by coin id AND by upper-case symbol.
 *
 * Two keys because a wallet row may carry a `coingeckoId` (the accurate key)
 * or only a symbol (native rows assembled in the browser). The id wins when
 * both exist — a symbol can collide, an id cannot.
 */
export function marketIndexOf(markets = []) {
  const byId = new Map();
  const bySymbol = new Map();
  for (const m of Array.isArray(markets) ? markets : []) {
    if (!m) continue;
    if (m.id) byId.set(String(m.id).toLowerCase(), m);
    const sym = String(m.symbol || '').toUpperCase();
    if (sym && !bySymbol.has(sym)) bySymbol.set(sym, m);
  }
  return { byId, bySymbol };
}

function quoteFor(row, index) {
  const id = row?.coingeckoId ? String(row.coingeckoId).toLowerCase() : null;
  const byId = id ? index.byId.get(id) : null;
  if (byId) return byId;
  const sym = String(row?.symbol || '').toUpperCase();
  return sym ? index.bySymbol.get(sym) || null : null;
}

/**
 * Daily performance of the current mix.
 *
 * @param {Array}  rows     buildIntelligence() rows (symbol/value/weight/coingeckoId)
 * @param {Array}  markets  the same /api/markets feed the rest of the app polls
 * @returns {object} performance block (see the header for the honesty rules)
 */
export function buildPerformance({ rows = [], markets = [] } = {}) {
  const index = marketIndexOf(markets);
  const list = (Array.isArray(rows) ? rows : []).filter((r) => r && r.symbol);
  const total = list.reduce((s, r) => s + (num(r.value) ?? 0), 0);

  const priced = list.filter((r) => isNum(num(r.value)) && Number(r.value) > 0);
  const missing = [];
  const attribution = priced.map((r) => {
    const q = quoteFor(r, index);
    const value = Number(r.value);
    const weight = total > 0 ? (value / total) * 100 : (num(r.weight) ?? null);
    const ch1 = num(q?.change24h);
    const ch7 = num(q?.change7d);

    /* Money moved by the asset's own change. `value` is the value AFTER the
       move, so the pre-move value is value / (1 + r) and the difference is the
       move itself — using `value * r` would overstate a rally and understate a
       sell-off. */
    const moveUsd = (change, at) => {
      if (!isNum(change) || !isNum(at) || at <= 0) return null;
      const before = at / (1 + change / 100);
      return isNum(before) && before > 0 ? at - before : null;
    };
    const move1d = moveUsd(ch1, value);
    const move7d = moveUsd(ch7, value);

    if (ch1 == null && ch7 == null) missing.push(String(r.symbol).toUpperCase());

    return {
      symbol: String(r.symbol).toUpperCase(),
      name: r.name ?? null,
      chainId: r.chainId ?? null,
      valueUsd: value,
      weight,
      change1d: ch1,
      change7d: ch7,
      move1dUsd: move1d,
      move7dUsd: move7d,
      /* Share of the BOOK's move, in percentage points of the portfolio. */
      contribution1d: isNum(move1d) && total > 0 ? round((move1d / total) * 100, 3) : null,
      contribution7d: isNum(move7d) && total > 0 ? round((move7d / total) * 100, 3) : null,
      sparkline: Array.isArray(q?.sparkline) ? q.sparkline : [],
      provenance: q?.dataProvenance ?? 'unknown'
    };
  });

  const weighted = (changeKey, moveKey) => {
    let coveredWeight = 0;
    let coveredValue = 0;
    let acc = 0;
    let moveSum = 0;
    for (const a of attribution) {
      const r = a[changeKey];
      if (!isNum(r) || !isNum(a.weight) || a.weight <= 0) continue;
      acc += a.weight * r;
      coveredWeight += a.weight;
      coveredValue += a.valueUsd;
      if (isNum(a[moveKey])) moveSum += a[moveKey];
    }
    if (coveredWeight <= 0) {
      return { pct: null, coveredWeight: 0, coveredValue: 0, absUsd: null };
    }
    return {
      pct: round(acc / coveredWeight, 2),
      coveredWeight: round(coveredWeight, 2),
      coveredValue: round(coveredValue, 2),
      /* The book's dollar move, summed from per-asset moves — not pct × total,
         which would silently assume the uncovered part moved the same way. */
      absUsd: round(moveSum, 2)
    };
  };

  const d1 = weighted('change1d', 'move1dUsd');
  const d7 = weighted('change7d', 'move7dUsd');

  const ranked = (key) => attribution
    .filter((a) => isNum(a[key]))
    .sort((a, b) => b[key] - a[key]);

  const by1d = ranked('change1d');
  const by7d = ranked('change7d');

  const breadthOf = (key) => {
    const counted = attribution.filter((a) => isNum(a[key]));
    return {
      counted: counted.length,
      up: counted.filter((a) => a[key] > 0.05).length,
      down: counted.filter((a) => a[key] < -0.05).length,
      flat: counted.filter((a) => a[key] >= -0.05 && a[key] <= 0.05).length
    };
  };

  const losses = attribution
    .filter((a) => isNum(a.change1d) && a.change1d < 0)
    .sort((a, b) => a.change1d - b.change1d);

  const coveredShare = total > 0 ? (d1.coveredWeight ?? 0) : 0;
  const status = !priced.length
    ? 'unavailable'
    : missing.length === priced.length
      ? 'unavailable'
      : coveredShare < MIN_COVERED_WEIGHT_PCT
        ? 'partial'
        : missing.length
          ? 'partial'
          : 'complete';

  const dispersion = (() => {
    const vals = attribution.map((a) => a.change1d).filter(isNum);
    if (vals.length < 2) return null;
    const mean = vals.reduce((s, v) => s + v, 0) / vals.length;
    const varr = vals.reduce((s, v) => s + (v - mean) ** 2, 0) / vals.length;
    return round(Math.sqrt(varr), 2);
  })();

  return {
    version: PERFORMANCE_VERSION,
    status,
    /* Named so the UI can print it: this is price performance of what you hold
       now, not a profit you booked. */
    basis: 'current-weights-times-asset-return',
    totalValueUsd: round(total, 2),
    coverage: {
      rows: list.length,
      priced: priced.length,
      withChange1d: attribution.filter((a) => isNum(a.change1d)).length,
      withChange7d: attribution.filter((a) => isNum(a.change7d)).length,
      coveredWeight: d1.coveredWeight,
      coveredSharePct: round(coveredShare, 1)
    },
    returns: {
      d1: d1.pct,
      d7: d7.pct,
      absUsd1d: d1.absUsd,
      absUsd7d: d7.absUsd
    },
    best: {
      d1: by1d[0] ?? null,
      d7: by7d[0] ?? null
    },
    worst: {
      d1: by1d.length ? by1d[by1d.length - 1] : null,
      d7: by7d.length ? by7d[by7d.length - 1] : null
    },
    attribution: attribution.sort((a, b) => b.valueUsd - a.valueUsd),
    /* The holdings that lost money in this window, worst first — this is the
       «زیان‌دهی» list, measured, with the dollar size of the loss. */
    losses: losses.slice(0, 6),
    breadth: { d1: breadthOf('change1d'), d7: breadthOf('change7d') },
    dispersion1d: dispersion,
    missing
  };
}

/**
 * One line answering «آیا این پرتفوی سود می‌دهد؟» without pretending to know
 * the entry price. Used by the chat card and the review header.
 */
export function performanceVerdict(perf, locale = 'fa') {
  const fa = String(locale || '').startsWith('fa');
  if (!perf || perf.status === 'unavailable' || !isNum(perf.returns?.d1)) {
    return fa ? 'عملکرد قابل اندازه‌گیری نیست' : 'Performance cannot be measured';
  }
  const d1 = perf.returns.d1;
  const d7 = perf.returns.d7;
  if (d1 > 0.5 && isNum(d7) && d7 > 0) return fa ? 'سودده در ۲۴ ساعت و ۷ روز' : 'Up over 24h and 7d';
  if (d1 < -0.5 && isNum(d7) && d7 < 0) return fa ? 'زیان‌ده در ۲۴ ساعت و ۷ روز' : 'Down over 24h and 7d';
  if (d1 > 0.5) return fa ? 'سودده در ۲۴ ساعت' : 'Up over 24h';
  if (d1 < -0.5) return fa ? 'زیان‌ده در ۲۴ ساعت' : 'Down over 24h';
  return fa ? 'کم‌حرکت در ۲۴ ساعت' : 'Little movement in 24h';
}
