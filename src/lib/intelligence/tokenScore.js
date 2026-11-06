/**
 * FBT AI INTELLIGENCE — TOKEN COMPOSITE SCORE
 * ---------------------------------------------------------------------------
 * A 0–100 score per token, built from FINITE, TRACEABLE inputs only, with the
 * weights declared here and shown in the UI. Three properties matter more than
 * the number itself:
 *
 *   1. IT CAN REFUSE. If the feed did not give us enough to judge a dimension,
 *      that dimension is `available: false` and its weight is redistributed.
 *      A token with no candles has no technical score — it does not get 50.
 *   2. COVERAGE IS PART OF THE RESULT. `coverage` is the share of the total
 *      weight that was actually measurable. Below 55% the composite is null:
 *      a confident-looking number built from a third of the evidence is the
 *      exact failure mode this screen exists to avoid.
 *   3. THE RISK DIMENSION IS INVERTED ON PURPOSE. Every other component reads
 *      "higher is better"; so does risk — 80 means LOW risk. Mixing directions
 *      silently is how a dashboard talks someone into a bad trade.
 *
 * The output is analysis, not advice: `caveats` always carries
 * 'not-a-recommendation', and no execution path consumes this value.
 */
import { clamp, percentileRank, rangePosition } from './indicators.js';

export const TOKEN_SCORE_VERSION = 'fbt.token-score.1';

export const SCORE_WEIGHTS = Object.freeze({
  technical: 0.3,
  momentum: 0.2,
  liquidity: 0.2,
  structure: 0.15,
  risk: 0.15
});

export const SCORE_LABELS = Object.freeze({
  technical: { fa: 'تکنیکال', en: 'Technical' },
  momentum: { fa: 'مومنتوم', en: 'Momentum' },
  liquidity: { fa: 'نقدشوندگی', en: 'Liquidity' },
  structure: { fa: 'ساختار قیمت', en: 'Structure' },
  risk: { fa: 'کیفیت ریسک', en: 'Risk quality' }
});

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const MIN_COVERAGE = 0.55;

export function scoreBand(score) {
  if (!isNum(score)) return null;
  if (score >= 75) return 'strong';
  if (score >= 60) return 'constructive';
  if (score >= 45) return 'neutral';
  if (score >= 30) return 'cautious';
  return 'weak';
}

const avg = (list) => {
  const nums = list.filter(isNum);
  return nums.length ? nums.reduce((s, v) => s + v, 0) / nums.length : null;
};

function technicalComponent(pack) {
  if (!pack || pack.bars < 20 || !isNum(pack.close)) {
    return { score: null, evidence: [], reason: 'insufficient-history' };
  }
  const v = pack.values || {};
  const evidence = [];

  /* RSI: 55–60 is where a healthy uptrend lives. Both tails are penalised —
     overbought is exhaustion, oversold is a falling knife, not a buy. */
  let rsiScore = null;
  if (isNum(v.rsi14)) {
    rsiScore = clamp(100 - Math.abs(v.rsi14 - 57) * 2.2, 0, 100);
    evidence.push({ key: 'rsi14', value: v.rsi14, unit: 'index' });
  }

  /* MACD histogram, normalised by ATR so it is comparable across assets. */
  let macdScore = null;
  if (isNum(v.macdHist)) {
    const norm = isNum(v.atr14) && v.atr14 > 0 ? v.macdHist / v.atr14 : null;
    macdScore = isNum(norm) ? clamp(50 + norm * 25, 0, 100) : (v.macdHist > 0 ? 62 : 38);
    evidence.push({ key: 'macd-hist', value: v.macdHist, unit: 'price' });
    if (v.macd != null) evidence.push({ key: 'macd-line', value: v.macd, unit: 'price' });
  }

  /* Moving-average alignment: above SMA20/50/200 is 33/66/100, plus a stack
     bonus when the averages themselves are ordered. */
  let maScore = null;
  const pos = pack.position || {};
  const flags = [pos.aboveSma20, pos.aboveSma50, pos.aboveSma200].filter((x) => x != null);
  if (flags.length) {
    maScore = (flags.filter(Boolean).length / flags.length) * 100;
    const stacked = isNum(v.sma20) && isNum(v.sma50) && isNum(v.sma200) && v.sma20 > v.sma50 && v.sma50 > v.sma200;
    if (stacked) maScore = Math.min(100, maScore + 12);
    evidence.push({ key: 'above-sma20', value: pos.aboveSma20 ? 1 : 0, unit: 'bool' });
    evidence.push({ key: 'above-sma50', value: pos.aboveSma50 ? 1 : 0, unit: 'bool' });
    evidence.push({ key: 'above-sma200', value: pos.aboveSma200 ? 1 : 0, unit: 'bool' });
  }

  /* Bollinger %B: the middle of the upper half is healthy; riding the upper
     band is stretch, and below the lower band is breakdown. */
  let bbScore = null;
  if (isNum(v.bbPercentB)) {
    bbScore = clamp(100 - Math.abs(v.bbPercentB - 0.62) * 130, 0, 100);
    evidence.push({ key: 'bb-percent-b', value: v.bbPercentB, unit: 'ratio' });
  }

  const score = avg([rsiScore, macdScore, maScore, bbScore]);
  return { score, evidence, reason: score == null ? 'insufficient-history' : null };
}

function momentumComponent(coin, universe) {
  if (!coin) return { score: null, evidence: [], reason: 'no-row' };
  const params = [
    { key: 'change1h', value: coin.change1h },
    { key: 'change24h', value: coin.change24h },
    { key: 'change7d', value: coin.change7d }
  ].filter((p) => isNum(p.value));

  if (!params.length) return { score: null, evidence: [], reason: 'no-change-data' };

  const ranks = [];
  const evidence = [];
  for (const p of params) {
    const peer = (universe || []).map((r) => r?.[p.key]).filter(isNum);
    const rank = peer.length >= 20 ? percentileRank(peer, p.value) : null;
    evidence.push({ key: p.key, value: p.value, unit: 'pct', rank });
    /* Below 20 peers a percentile is noise, so fall back to the raw magnitude
       with a deliberately conservative mapping (a +20% week is not "perfect"). */
    ranks.push(rank != null ? rank : clamp(50 + p.value * 2.5, 0, 100));
  }
  return { score: avg(ranks), evidence, reason: null };
}

function liquidityComponent(coin, universe) {
  if (!coin) return { score: null, evidence: [], reason: 'no-row' };
  const evidence = [];
  const parts = [];
  const vols = (universe || []).map((r) => Number(r?.volume)).filter((v) => isNum(v) && v > 0);
  if (vols.length >= 20 && isNum(Number(coin.volume)) && Number(coin.volume) > 0) {
    const rank = percentileRank(vols, Number(coin.volume));
    parts.push(rank);
    evidence.push({ key: 'volume-rank', value: rank, unit: 'pct' });
  }
  const vol = Number(coin.volume);
  const mcap = Number(coin.mcap);
  if (isNum(vol) && isNum(mcap) && vol > 0 && mcap > 0) {
    const turnover = (vol / mcap) * 100;
    /* 8% daily turnover is a deep, actively-traded market; 0.2% is a token
       nobody can exit. Log-ish mapping between the two. */
    const turnoverScore = clamp(Math.log10(Math.max(turnover, 0.01) / 0.1) * 33, 0, 100);
    parts.push(turnoverScore);
    evidence.push({ key: 'turnover', value: turnover, unit: 'pct' });
  }
  if (isNum(Number(coin.rank)) && Number(coin.rank) > 0) {
    const rankScore = clamp(100 - Math.log10(Number(coin.rank)) * 30, 0, 100);
    parts.push(rankScore);
    evidence.push({ key: 'rank', value: Number(coin.rank), unit: 'rank' });
  }
  const score = avg(parts);
  return { score, evidence, reason: score == null ? 'no-liquidity-data' : null };
}

function structureComponent(coin, pack) {
  const evidence = [];
  const parts = [];

  const rp = rangePosition(coin?.low24h, coin?.high24h, coin?.price);
  if (isNum(rp)) {
    parts.push(rp * 100);
    evidence.push({ key: 'range-position', value: rp, unit: 'ratio' });
  }

  const close = pack?.close ?? Number(coin?.price);
  const sma200 = pack?.values?.sma200;
  if (isNum(close) && isNum(sma200) && sma200 > 0) {
    const distPct = ((close - sma200) / sma200) * 100;
    /* Being far above the 200-bar mean is strength that is already spent:
       score peaks around +15% and decays toward both 0% and +80%. */
    const score = clamp(100 - Math.abs(distPct - 15) * 1.4, 0, 100);
    parts.push(score);
    evidence.push({ key: 'distance-sma200', value: distPct, unit: 'pct' });
  }

  const athChange = coin?.athChange;
  if (isNum(athChange)) {
    /* Never a "cheap therefore good" score: a token 95% below its ATH scores
       lower than one 30% below, because the market has already voted. */
    const score = clamp(100 + athChange * 0.45, 0, 100);
    parts.push(score);
    evidence.push({ key: 'from-ath', value: athChange, unit: 'pct' });
  }

  const score = avg(parts);
  return { score, evidence, reason: score == null ? 'no-structure-data' : null };
}

function riskComponent(coin, pack) {
  const evidence = [];
  const parts = [];

  const hi = Number(coin?.high24h);
  const lo = Number(coin?.low24h);
  const px = Number(coin?.price);
  if (isNum(hi) && isNum(lo) && isNum(px) && px > 0 && hi > lo) {
    const swing = ((hi - lo) / px) * 100;
    parts.push(clamp(100 - swing * 7, 0, 100));
    evidence.push({ key: 'intraday-swing', value: swing, unit: 'pct' });
  }

  const dd = pack?.values?.drawdown;
  if (isNum(dd)) {
    parts.push(clamp(100 + dd * 0.9, 0, 100));
    evidence.push({ key: 'series-drawdown', value: dd, unit: 'pct' });
  }

  const vol = Number(coin?.volume);
  const mcap = Number(coin?.mcap);
  if (isNum(vol) && isNum(mcap) && mcap > 0) {
    const turnover = (vol / mcap) * 100;
    parts.push(clamp(Math.log10(Math.max(turnover, 0.01) / 0.1) * 33, 0, 100));
    evidence.push({ key: 'turnover', value: turnover, unit: 'pct' });
  }

  const score = avg(parts);
  return { score, evidence, reason: score == null ? 'no-risk-data' : null };
}

/**
 * @param {object}   input.coin      one normalized market row
 * @param {object}   input.pack      computeIndicators() output for that token
 * @param {Array}    input.universe  peer rows used for percentile ranking
 * @param {number}   input.now       timestamp for the report line
 */
export function scoreToken({ coin = null, pack = null, universe = [], now = Date.now() } = {}) {
  const raw = {
    technical: technicalComponent(pack),
    momentum: momentumComponent(coin, universe),
    liquidity: liquidityComponent(coin, universe),
    structure: structureComponent(coin, pack),
    risk: riskComponent(coin, pack)
  };

  const components = Object.entries(SCORE_WEIGHTS).map(([key, weight]) => {
    const part = raw[key] || { score: null, evidence: [], reason: 'unavailable' };
    return {
      key,
      weight,
      score: isNum(part.score) ? Math.round(part.score) : null,
      available: isNum(part.score),
      evidence: part.evidence || [],
      reason: part.reason ?? null
    };
  });

  const availableWeight = components.filter((c) => c.available).reduce((s, c) => s + c.weight, 0);
  const coverage = Math.round((availableWeight / Object.values(SCORE_WEIGHTS).reduce((s, w) => s + w, 0)) * 100);
  const weighted = components.filter((c) => c.available).reduce((s, c) => s + c.score * c.weight, 0);
  const composite = availableWeight >= MIN_COVERAGE
    ? Math.round(weighted / availableWeight)
    : null;

  const caveats = ['not-a-recommendation'];
  if (composite == null) caveats.push('insufficient-coverage');
  if (!pack || pack.bars < 200) caveats.push('short-history');
  if (coin?.provenance === 'offline' || coin?.dataProvenance === 'offline') caveats.push('offline-data');
  if (coin?.provenance === 'stale' || coin?.dataProvenance === 'stale') caveats.push('stale-data');

  return {
    version: TOKEN_SCORE_VERSION,
    composite,
    band: scoreBand(composite),
    coverage,
    components,
    weights: SCORE_WEIGHTS,
    caveats,
    computedAt: now,
    bars: pack?.bars ?? 0
  };
}

/** Human-readable summary of what is missing, for the "why no score" line. */
export function missingForScore(result) {
  return (result?.components || []).filter((c) => !c.available).map((c) => ({
    key: c.key,
    weight: c.weight,
    reason: c.reason || 'unavailable'
  }));
}
