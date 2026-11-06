/**
 * FBT AI INTELLIGENCE — PORTFOLIO ANALYSIS
 * ---------------------------------------------------------------------------
 * Sits on top of `lib/portfolioIntel.buildIntelligence()` (which owns cost
 * basis, P&L and the wallet snapshot history) and answers the questions that
 * one number cannot:
 *
 *   · Where is the money concentrated — in a token, or in a NETWORK?
 *   · Do these assets actually move together, or does the list only look
 *     diversified? (Pearsons on DAILY RETURNS, not on prices.)
 *   · What is the honest risk band, and which measurable thing made it so?
 *   · What would we change — with the reason, the horizon and the confidence,
 *     never as a plain "buy this".
 *
 * ─── THE P&L RULE ───────────────────────────────────────────────────────────
 * A wallet balance is not a cost basis. If the lot ledger has no buy price for
 * a holding, the P&L for it is `null` and the whole portfolio's P&L is
 * reported as `unknown` for that part — never as "you are up 0%".
 */
import { clamp } from './indicators.js';

export const PORTFOLIO_ANALYSIS_VERSION = 'fbt.portfolio-analysis.1';

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

export const BUCKETS = Object.freeze([
  { id: 'btc', fa: 'بیت‌کوین', en: 'Bitcoin', symbols: ['BTC', 'WBTC', 'CBBTC'] },
  { id: 'eth', fa: 'اتریوم', en: 'Ethereum', symbols: ['ETH', 'WETH', 'STETH', 'WSTETH', 'RETH'] },
  { id: 'stable', fa: 'استیبل‌کوین', en: 'Stablecoins', symbols: ['USDT', 'USDC', 'DAI', 'FDUSD', 'TUSD', 'USDE', 'USDD', 'BUSD'] },
  { id: 'l1', fa: 'لایه ۱', en: 'Layer 1', symbols: ['SOL', 'ADA', 'AVAX', 'DOT', 'NEAR', 'TRX', 'TON', 'SUI', 'APT', 'SEI', 'BNB', 'ATOM', 'XRP', 'LTC'] },
  { id: 'l2', fa: 'لایه ۲', en: 'Layer 2', symbols: ['ARB', 'OP', 'MATIC', 'POL', 'IMX', 'STRK', 'ZK', 'MNT', 'BLAST'] },
  { id: 'defi', fa: 'دیفای', en: 'DeFi', symbols: ['UNI', 'AAVE', 'MKR', 'CRV', 'LDO', 'GMX', 'SUSHI', 'COMP', 'SNX', 'PENDLE', 'RPL', 'CAKE'] },
  { id: 'ai', fa: 'توکن‌های AI', en: 'AI tokens', symbols: ['FET', 'TAO', 'RNDR', 'RENDER', 'AGIX', 'OCEAN', 'WLD', 'GRT', 'VIRTUAL', 'AI16Z'] },
  { id: 'meme', fa: 'میم‌کوین', en: 'Meme', symbols: ['DOGE', 'SHIB', 'PEPE', 'WIF', 'BONK', 'FLOKI', 'TRUMP', 'MOG'] },
  { id: 'other', fa: 'سایر', en: 'Other', symbols: [] }
]);

const BUCKET_BY_SYMBOL = (() => {
  const map = new Map();
  for (const b of BUCKETS) for (const s of b.symbols) map.set(s, b.id);
  return map;
})();

export const bucketOf = (symbol) => BUCKET_BY_SYMBOL.get(String(symbol || '').toUpperCase()) ?? 'other';

export function bucketLabel(id, locale = 'fa') {
  const b = BUCKETS.find((x) => x.id === id);
  return b ? (locale === 'fa' ? b.fa : b.en) : id;
}

/**
 * Pearson correlation between two equal-length numeric arrays.
 * Returns null below `minSamples`: two points always fit a line, and a
 * correlation computed on 3 days is a story, not a statistic.
 */
export function pearson(a = [], b = [], minSamples = 10) {
  const n = Math.min(a.length, b.length);
  if (n < minSamples) return null;
  const x = a.slice(-n);
  const y = b.slice(-n);
  if (!x.every(isNum) || !y.every(isNum)) return null;
  const mx = x.reduce((s, v) => s + v, 0) / n;
  const my = y.reduce((s, v) => s + v, 0) / n;
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < n; i += 1) {
    sxy += (x[i] - mx) * (y[i] - my);
    sxx += (x[i] - mx) ** 2;
    syy += (y[i] - my) ** 2;
  }
  if (sxx === 0 || syy === 0) return null;
  return sxy / Math.sqrt(sxx * syy);
}

/** Daily returns from a close series (skip non-finite / non-positive). */
export function dailyReturns(closes = []) {
  const out = [];
  for (let i = 1; i < closes.length; i += 1) {
    const prev = closes[i - 1];
    const cur = closes[i];
    if (isNum(prev) && isNum(cur) && prev > 0 && cur > 0) out.push((cur - prev) / prev);
  }
  return out;
}

/**
 * Correlation matrix over the series we managed to download.
 *
 * @param {Record<string, number[]>} seriesBySymbol  daily closes
 * @returns {{pairs: Array, average: number|null, sufficient: string[], insufficient: string[]}}
 */
export function correlationMatrix(seriesBySymbol = {}, { minSamples = 10 } = {}) {
  const symbols = Object.keys(seriesBySymbol).filter((s) => Array.isArray(seriesBySymbol[s]));
  const returns = Object.fromEntries(symbols.map((s) => [s, dailyReturns(seriesBySymbol[s])]));
  const sufficient = symbols.filter((s) => returns[s].length >= minSamples);
  const insufficient = symbols.filter((s) => !sufficient.includes(s));
  const pairs = [];
  for (let i = 0; i < sufficient.length; i += 1) {
    for (let j = i + 1; j < sufficient.length; j += 1) {
      const a = sufficient[i];
      const b = sufficient[j];
      const r = pearson(returns[a], returns[b], minSamples);
      if (r != null) pairs.push({ a, b, r: Math.round(r * 100) / 100, samples: Math.min(returns[a].length, returns[b].length) });
    }
  }
  const average = pairs.length ? pairs.reduce((s, p) => s + p.r, 0) / pairs.length : null;
  return { pairs, average, sufficient, insufficient };
}

/** Allocation by asset class, from the priced rows only. */
export function buildAllocation(rows = [], total = 0) {
  const map = new Map();
  for (const r of rows) {
    if (!isNum(r?.value) || r.value <= 0) continue;
    const id = bucketOf(r.symbol);
    map.set(id, (map.get(id) || 0) + r.value);
  }
  return BUCKETS
    .map((b) => {
      const value = map.get(b.id) || 0;
      return { id: b.id, fa: b.fa, en: b.en, value, weight: total > 0 ? (value / total) * 100 : 0 };
    })
    .filter((b) => b.value > 0)
    .sort((a, b) => b.value - a.value);
}

const clampSym = (v, lo = 0, hi = 100) => clamp(v, lo, hi);

/**
 * The risk read.
 *
 * Starting score 20, then measured penalties. Every penalty carries the number
 * that caused it, in `reasons`, so the badge can never be an unexplained red
 * dot. 0–100 where higher = riskier (this direction is deliberate: the page's
 * other numbers read "higher is better", and the risk badge is the one that
 * must not).
 */
export function assessRisk({ intel = null, allocation = [], correlation = null, rows = [] } = {}) {
  const reasons = [];
  let score = isNum(intel?.riskScore) ? intel.riskScore : 20;
  if (isNum(intel?.riskScore)) {
    reasons.push({ key: 'base-concentration', params: { score: intel.riskScore, topShare: intel.topShare ?? null } });
  }

  if (isNum(correlation?.average) && correlation.average >= 0.7) {
    const add = Math.round((correlation.average - 0.65) * 60);
    score += add;
    reasons.push({ key: 'correlated-assets', params: { avg: correlation.average, add } });
  }

  const topBucket = allocation[0];
  if (topBucket && topBucket.id !== 'stable' && topBucket.weight >= 65) {
    score += 8;
    reasons.push({ key: 'single-sector', params: { bucket: topBucket.id, weight: topBucket.weight } });
  }

  const stable = allocation.find((b) => b.id === 'stable');
  if (intel?.total > 0 && (!stable || stable.weight < 5)) {
    score += 6;
    reasons.push({ key: 'no-cash-buffer', params: { stablePct: stable?.weight ?? 0 } });
  }

  const unpriced = (rows || []).filter((r) => !isNum(r?.value) && Number(r?.amount) > 0).length;
  if (unpriced > 0) {
    score += 5;
    reasons.push({ key: 'unpriced-holdings', params: { count: unpriced } });
  }

  score = Math.round(clampSym(score, 5, 95));
  return {
    score,
    band: score >= 70 ? 'high' : score >= 45 ? 'medium' : 'low',
    reasons,
    /* Not a Monte-Carlo: without a long enough return history a VaR or Sharpe
       would be invented. The UI says which statistics are missing. */
    unavailable: ['value-at-risk', 'sharpe-ratio', 'sortino-ratio', 'maximum-drawdown-portfolio']
  };
}

/**
 * Advisory suggestions. Each one is (action, reason with numbers, horizon,
 * confidence, and 'not-advice'), never a bare "buy X".
 */
export function buildSuggestions({ intel = null, allocation = [], correlation = null, chainAllocation = [] } = {}) {
  const out = [];
  if (!intel || !intel.total) return out;

  const topShare = intel.topShare ?? 0;
  if (topShare >= 45) {
    out.push({
      action: 'reduce-concentration',
      params: { topShare, symbol: intel.rows?.[0]?.symbol ?? null },
      horizon: 'medium',
      risk: topShare >= 65 ? 'high' : 'medium',
      confidence: clampSym(50 + topShare * 0.5, 50, 88),
      evidence: ['top-holding-weight']
    });
  }

  if (isNum(correlation?.average) && correlation.average >= 0.7) {
    out.push({
      action: 'improve-diversification',
      params: { avgCorrelation: correlation.average, pairs: correlation.pairs.length },
      horizon: 'long',
      risk: 'medium',
      confidence: clampSym(45 + (correlation.average - 0.6) * 100, 45, 82),
      evidence: ['return-correlation']
    });
  }

  const topChain = (chainAllocation || [])[0];
  if (topChain && intel.total > 0 && (topChain.value / intel.total) * 100 >= 70) {
    out.push({
      action: 'spread-network-risk',
      params: { chainId: topChain.chainId, weight: (topChain.value / intel.total) * 100 },
      horizon: 'medium',
      risk: 'medium',
      confidence: 62,
      evidence: ['chain-allocation']
    });
  }

  const stable = allocation.find((b) => b.id === 'stable');
  if ((stable?.weight ?? 0) < 5) {
    out.push({
      action: 'review-cash-buffer',
      params: { stablePct: stable?.weight ?? 0 },
      horizon: 'short',
      risk: 'low',
      confidence: 58,
      evidence: ['stablecoin-share']
    });
  }

  if (intel.partial) {
    out.push({
      action: 'record-cost-basis',
      params: { rowsWithoutCost: (intel.rows || []).filter((r) => r.cost == null).length },
      horizon: 'immediate',
      risk: 'low',
      /* This one is certain: we know the ledger has no lot, because we built it. */
      confidence: 95,
      evidence: ['lot-ledger']
    });
  }

  return out.sort((a, b) => b.confidence - a.confidence);
}

/**
 * @param {object} input
 * @param {object} input.intel          buildIntelligence() output
 * @param {object} input.correlation    correlationMatrix() output (optional)
 * @param {Array}  input.seriesUsed     symbols whose candle history was read
 * @param {number} input.now
 */
export function buildPortfolioAnalysis({ intel = null, correlation = null, seriesUsed = [], now = Date.now() } = {}) {
  if (!intel) {
    return {
      version: PORTFOLIO_ANALYSIS_VERSION,
      ok: false,
      reason: 'no-wallet',
      generatedAt: now
    };
  }
  const rows = intel.rows || [];
  const allocation = buildAllocation(rows, intel.total);
  const chainAllocation = intel.chainAllocation || [];
  const risk = assessRisk({ intel, allocation, correlation, rows });

  const withCost = rows.filter((r) => isNum(r?.cost) && r.cost > 0);
  const pnlStatus = rows.length === 0
    ? 'empty'
    : withCost.length === 0
      ? 'unknown'
      : intel.partial
        ? 'partial'
        : 'complete';

  /* Herfindahl over weights (0..1), reported as 0..100 for readability.
     Equal-weight across 10 assets lands near 10; everything in one asset = 100. */
  const hhi = rows.reduce((s, r) => s + ((r.weight ?? 0) / 100) ** 2, 0) * 100;
  /* Effective number of holdings: 1/HHI. A familiar, honest diversification read. */
  const effectiveHoldings = hhi > 0 ? Math.round((100 / hhi) * 10) / 10 : 0;

  return {
    version: PORTFOLIO_ANALYSIS_VERSION,
    ok: true,
    generatedAt: now,
    total: intel.total,
    allocation,
    chainAllocation: chainAllocation.map((c) => ({
      ...c,
      weight: intel.total > 0 ? (c.value / intel.total) * 100 : 0
    })),
    concentration: {
      topShare: intel.topShare ?? 0,
      hhi: Math.round(hhi),
      effectiveHoldings,
      label: (intel.topShare ?? 0) >= 60 ? 'high' : (intel.topShare ?? 0) >= 35 ? 'medium' : 'low'
    },
    correlation: correlation
      ? {
          average: isNum(correlation.average) ? Math.round(correlation.average * 100) / 100 : null,
          pairs: correlation.pairs,
          computedOn: correlation.sufficient,
          insufficient: correlation.insufficient
        }
      : { average: null, pairs: [], computedOn: [], insufficient: seriesUsed },
    pnl: {
      status: pnlStatus,
      realised: intel.realised ?? null,
      unrealised: intel.unrealised ?? null,
      cost: intel.cost ?? null,
      best: intel.best ?? null,
      worst: intel.worst ?? null,
      change24h: intel.change24h,
      change7d: intel.change7d,
      change30d: intel.change30d
    },
    risk,
    suggestions: buildSuggestions({ intel, allocation, correlation, chainAllocation }),
    caveats: [
      'not-advice',
      ...(pnlStatus === 'unknown' ? ['cost-basis-unknown'] : []),
      ...(pnlStatus === 'partial' ? ['cost-basis-partial'] : [])
    ]
  };
}
