/**
 * FBT AI INTELLIGENCE — MARKET PULSE
 * ---------------------------------------------------------------------------
 * Turns the two feeds the app already polls (`/api/global` and `/api/markets`)
 * into the sentences an analysis screen leads with: how wide the move is, how
 * hard it is, whether volume confirmed it, and how much of the market it was
 * actually measured on.
 *
 * ─── THE RULES THIS MODULE EXISTS TO ENFORCE ────────────────────────────────
 *   1. NOTHING IS FILLED IN. A missing 24h change is excluded from breadth and
 *      from the median, never read as 0%. The `counted` number travels with
 *      every derived metric so the UI can say "over 212 of 250 rows".
 *   2. PROVENANCE TRAVELS. Rows carry `dataProvenance` from lib/api
 *      ('live' | 'stale' | 'offline'). The pulse inherits the weakest one; an
 *      offline snapshot can never be presented as a live observation.
 *   3. A LABEL IS A SUMMARY, NOT A FORECAST. `regime.label` describes what the
 *      numbers in this payload did. It carries its drivers so the screen can
 *      show the arithmetic instead of asking the reader to trust a word.
 */
import { median, rangePosition, stdev } from './indicators.js';

export const MARKET_PULSE_VERSION = 'fbt.market-pulse.1';

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/** Provenance rank — 'offline' is worse than 'stale', which is worse than 'live'. */
const PROVENANCE_RANK = { live: 3, stale: 2, offline: 1, unknown: 0 };
export function weakestProvenance(list = []) {
  let worst = 'live';
  let seen = false;
  for (const p of list) {
    if (!p) continue;
    seen = true;
    if ((PROVENANCE_RANK[p] ?? 0) < (PROVENANCE_RANK[worst] ?? 3)) worst = p;
  }
  return seen ? worst : 'unknown';
}

/** The 24h change we are allowed to use: a finite number, or nothing. */
function change24h(row) {
  const v = row?.change24h;
  return isNum(v) ? v : null;
}

/**
 * Intraday swing: (high − low) / price, in percent.
 * This is not volatility in the finance sense (no time series, no annualisation);
 * it is the day's own range, and the UI labels it as such.
 */
function intradaySwingPct(row) {
  const hi = Number(row?.high24h);
  const lo = Number(row?.low24h);
  const px = Number(row?.price);
  if (![hi, lo, px].every(Number.isFinite) || hi <= 0 || lo <= 0 || px <= 0 || hi < lo) return null;
  return ((hi - lo) / px) * 100;
}

/** Turnover: 24h volume as a share of market cap. Thin markets are fragile. */
function turnoverPct(row) {
  const vol = Number(row?.volume);
  const mcap = Number(row?.mcap);
  if (!Number.isFinite(vol) || !Number.isFinite(mcap) || vol <= 0 || mcap <= 0) return null;
  return (vol / mcap) * 100;
}

export function liquidityLabel(turnover) {
  if (!isNum(turnover)) return 'unknown';
  if (turnover >= 25) return 'very-liquid';
  if (turnover >= 8) return 'liquid';
  if (turnover >= 2) return 'normal';
  if (turnover > 0) return 'thin';
  return 'unknown';
}

export function volatilityLabel(swingPct) {
  if (!isNum(swingPct)) return 'unknown';
  if (swingPct < 3) return 'low';
  if (swingPct < 6) return 'normal';
  if (swingPct < 10) return 'high';
  return 'extreme';
}

export function regimeLabel(score) {
  if (!isNum(score)) return 'unknown';
  if (score >= 30) return 'bullish';
  if (score >= 10) return 'mildly-bullish';
  if (score > -10) return 'neutral';
  if (score > -30) return 'mildly-bearish';
  return 'bearish';
}

/** Compact row used by movers rails and the scanner — only real fields. */
export function pickRow(row) {
  return {
    id: row?.id ?? null,
    symbol: String(row?.symbol ?? '').toUpperCase(),
    name: row?.name ?? null,
    image: row?.image ?? null,
    price: Number(row?.price) || 0,
    change1h: isNum(row?.change1h) ? row.change1h : null,
    change24h: change24h(row),
    change7d: isNum(row?.change7d) ? row.change7d : null,
    volume: Number(row?.volume) || 0,
    mcap: Number(row?.mcap) || 0,
    rank: Number(row?.rank) || null,
    high24h: isNum(Number(row?.high24h)) ? Number(row.high24h) : null,
    low24h: isNum(Number(row?.low24h)) ? Number(row.low24h) : null,
    ath: Number(row?.ath) || null,
    athChange: isNum(row?.athChange) ? row.athChange : null,
    sparkline: Array.isArray(row?.sparkline) ? row.sparkline : [],
    provenance: row?.dataProvenance ?? 'unknown'
  };
}

export function topMovers(markets = [], { count = 6 } = {}) {
  const rows = (Array.isArray(markets) ? markets : [])
    .filter((r) => isNum(change24h(r)))
    .map(pickRow);
  const byChange = [...rows].sort((a, b) => b.change24h - a.change24h);
  return {
    gainers: byChange.slice(0, count),
    losers: byChange.slice(-count).reverse(),
    ranked: byChange
  };
}

/** Biggest turnover among rows that actually report volume and cap. */
export function topVolume(markets = [], { count = 6 } = {}) {
  return (Array.isArray(markets) ? markets : [])
    .filter((r) => Number(r?.volume) > 0)
    .map(pickRow)
    .sort((a, b) => b.volume - a.volume)
    .slice(0, count);
}

/**
 * Volume surge = turnover at least `multiplier` × the universe median turnover.
 * The median is used, not the mean, because a single stablecoin pair can turn
 * over more than the rest of the market combined and would hide every real
 * surge behind one outlier.
 */
export function volumeSurges(markets = [], { count = 6, multiplier = 2.5 } = {}) {
  const rows = (Array.isArray(markets) ? markets : []).filter((r) => Number(r?.volume) > 0);
  const turnovers = rows.map(turnoverPct).filter(isNum);
  const base = median(turnovers);
  if (!isNum(base) || base <= 0) return { baseline: null, rows: [] };
  const out = rows
    .map((r) => {
      const t = turnoverPct(r);
      return { row: r, turnover: t, ratio: isNum(t) ? t / base : null };
    })
    .filter((x) => isNum(x.ratio) && x.ratio >= multiplier)
    .sort((a, b) => b.ratio - a.ratio)
    .slice(0, count)
    .map((x) => ({ ...pickRow(x.row), turnoverPct: x.turnover, surgeRatio: x.ratio }));
  return { baseline: base, rows: out };
}

/**
 * Build the pulse.
 *
 * @param {object}   input.global      normalized global stats (normalizeGlobal)
 * @param {Array}    input.markets     normalized market rows
 * @param {number}   input.updatedAt   when the client last received the data
 * @param {string}   input.providers   optional label of the upstream feed
 */
export function buildMarketPulse({ global = null, markets = [], updatedAt = 0, provider = null } = {}) {
  const rows = Array.isArray(markets) ? markets : [];
  const changes = rows.map(change24h).filter(isNum);
  const counted = changes.length;
  const advancers = changes.filter((c) => c > 0.05).length;
  const decliners = changes.filter((c) => c < -0.05).length;
  const flat = counted - advancers - decliners;
  const advRatio = counted ? advancers / counted : null;

  const swings = rows.map(intradaySwingPct).filter(isNum);
  const turnovers = rows.map(turnoverPct).filter(isNum);
  const positions = rows
    .map((r) => rangePosition(r?.low24h, r?.high24h, r?.price))
    .filter(isNum);

  const mcap = Number(global?.mcap) || null;
  const volume = Number(global?.volume) || null;
  const mcapChange = isNum(global?.mcapChange) ? global.mcapChange : null;
  const volumeChange = isNum(global?.volumeChange) ? global.volumeChange : null;
  const btcDominance = Number(global?.btcDominance) || null;
  const ethDominance = Number(global?.ethDominance) || null;

  const medianChange = median(changes);
  const dispersion = stdev(changes);
  const avgChange = isNum(global?.avgChange) ? global.avgChange : medianChange;
  const avgChangeSource = isNum(global?.avgChange) ? 'global-feed' : (isNum(medianChange) ? 'derived-median' : null);

  const medianSwing = median(swings);
  const medianTurnover = median(turnovers);
  const medianPosition = median(positions);

  /* ── Regime ──────────────────────────────────────────────────────────────
     Four measurable ingredients, fixed weights, and every one of them is
     reported in `drivers` so the card can show its work. When an ingredient
     is missing its weight is redistributed rather than counted as zero —
     "the feed did not say" must not read as "the market did nothing". */
  const ingredients = [
    { key: 'breadth', weight: 0.35, value: counted >= 10 && advRatio != null ? clamp((advRatio - 0.5) * 2, -1, 1) : null },
    { key: 'median-change', weight: 0.3, value: isNum(medianChange) ? clamp(medianChange / 5, -1, 1) : null },
    { key: 'market-cap-change', weight: 0.25, value: isNum(mcapChange) ? clamp(mcapChange / 4, -1, 1) : null },
    {
      key: 'volume-confirmation',
      weight: 0.1,
      value: isNum(volumeChange) && isNum(mcapChange)
        ? clamp(volumeChange / 40, -1, 1) * Math.sign(mcapChange || 1)
        : null
    }
  ];
  const present = ingredients.filter((i) => i.value != null);
  const weightSum = present.reduce((s, i) => s + i.weight, 0);
  const rawScore = weightSum > 0
    ? present.reduce((s, i) => s + i.value * i.weight, 0) / weightSum
    : null;
  const score = isNum(rawScore) ? Math.round(rawScore * 100) : null;

  /* How much of the tape the score was actually computed on. */
  const coverage = rows.length ? counted / rows.length : 0;
  const provenance = weakestProvenance([
    ...rows.map((r) => r?.dataProvenance),
    global?.dataProvenance
  ]);
  let confidence = 0;
  if (isNum(score)) {
    confidence = 55 * Math.min(1, coverage * 1.15) + 25 * (present.length / ingredients.length);
    if (provenance === 'stale') confidence -= 12;
    if (provenance === 'offline') confidence = Math.min(confidence, 20);
    /* A market that is half up and half down is not a trend, whatever the
       average says — disagreement lowers our confidence, not the score. */
    if (isNum(advRatio)) confidence -= Math.abs(advRatio - 0.5) < 0.08 ? 8 : 0;
    confidence = Math.round(clamp(confidence, 5, 92));
  }

  const agreement = advRatio != null ? Math.abs(advRatio - 0.5) * 2 * 100 : 0;
  const trendStrength = isNum(score)
    ? Math.round(clamp(Math.abs(score) * 0.55 + agreement * 0.45, 0, 100))
    : null;

  return {
    version: MARKET_PULSE_VERSION,
    updatedAt,
    provider,
    provenance,
    /* Share of rows the breadth/median figures were computed on, as a percent.
       The report uses it to say out loud when the tape was thin. */
    coveragePct: Math.round(coverage * 100),
    sources: {
      markets: { rows: rows.length, counted, provenance },
      global: { present: Boolean(global), provenance: global?.dataProvenance ?? (global ? 'live' : 'unknown') }
    },
    totals: {
      mcap,
      mcapChange24h: mcapChange,
      volume,
      volumeChange24h: volumeChange,
      btcDominance,
      ethDominance,
      coins: Number(global?.coins) || null,
      markets: Number(global?.markets) || null,
      turnoverPct: isNum(mcap) && isNum(volume) && mcap > 0 ? (volume / mcap) * 100 : (medianTurnover ?? null)
    },
    breadth: {
      advancers,
      decliners,
      flat,
      counted,
      total: rows.length,
      advRatio,
      coverage
    },
    performance: {
      medianChange24h: medianChange,
      avgChange24h: avgChange,
      avgChangeSource,
      dispersionPct: dispersion,
      best24h: changes.length ? Math.max(...changes) : null,
      worst24h: changes.length ? Math.min(...changes) : null
    },
    volatility: {
      label: volatilityLabel(medianSwing),
      medianSwingPct: medianSwing,
      dispersionPct: dispersion
    },
    liquidity: {
      label: liquidityLabel(medianTurnover),
      medianTurnoverPct: medianTurnover
    },
    intraday: { medianRangePosition: medianPosition },
    regime: {
      label: regimeLabel(score),
      score,
      confidence: isNum(score) ? confidence : 0,
      trendStrength,
      drivers: ingredients.map((i) => ({
        key: i.key,
        value: i.value,
        weight: i.weight,
        available: i.value != null
      }))
    },
    movers: topMovers(rows, { count: 6 }),
    volumeSurges: volumeSurges(rows, { count: 6 }),
    /* Things this screen does NOT have wired yet. Printed, so the absence is
       visible instead of being quietly replaced by an invented number. */
    unavailable: [
      'fear-greed',
      'open-interest',
      'funding-rates',
      'liquidations',
      'net-exchange-flow'
    ]
  };
}
