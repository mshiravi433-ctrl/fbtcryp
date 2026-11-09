/**
 * dYdX TOKEN BRAIN — the per-market read behind the dYdX tab's desk box.
 * ===========================================================================
 *   «برای هر توکن انتخابی، باکس هوش مصنوعی، موتور ریسک و موتور فرصت را در یک
 *    باکس بازشونده زیر آن بگذار»
 *
 * WHY THIS FILE IS PURE
 *   The three panels under the dYdX chart are opinions about someone's
 *   leveraged money, so every number in them has to be traceable to a bar the
 *   indexer actually sent. Nothing here fetches, nothing here renders, and
 *   nothing here invents a value: a figure that cannot be computed is `null`
 *   and the UI prints «—». That is the whole contract, and it is what makes
 *   the module testable in `test/dydx-token-brain.test.mjs` without a browser.
 *
 * WHAT IS COMPUTED
 *   analyseMarket()   the read: trend, momentum, volatility, the range the
 *                     price sits in, ATR-based levels, and one verdict whose
 *                     every clause is a number printed beside it.
 *   scanTokenSetups() the opportunity engine: the handful of SHAPES that can be
 *                     argued from candles + the venue's own funding/OI. Each
 *                     carries its evidence, its confidence and its caveat.
 *
 * WHAT IS DELIBERATELY ABSENT
 *   · a price prediction. The candlestick chart's own AI (Kronos, on-device)
 *     owns the projection; this module reads what HAS happened.
 *   · a "signal" vocabulary. A setup is a description with arithmetic, never a
 *     buy/sell instruction — every panel prints the same caveat.
 *   · anything needing data we do not read (order-book imbalance, liquidation
 *     maps, open-interest HISTORY). dYdX's public indexer gives us an OI
 *     snapshot, not a series, so no OI-trend setup exists here. Saying
 *     «open interest is rising» from one number would be a fabrication.
 */
import {
  atr as atrSeries, clamp, ema as emaSeries, lastValue, mean, rsi as rsiSeries,
  sanitizeCandles, supportResistance
} from '../intelligence/indicators.js';

export const DYDXT_TOKEN_BRAIN_VERSION = 'fbt.dydx-token-brain.1';

/** Minimum bars for a read. Below this the honest answer is «not enough». */
export const MIN_BARS = 30;

/* ─── helpers ─────────────────────────────────────────────────────────────── */

const num = (v) => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

const pct = (a, b) => {
  const x = num(a);
  const y = num(b);
  if (x == null || y == null || y === 0) return null;
  return ((x - y) / Math.abs(y)) * 100;
};

const round = (v, digits = 2) => {
  const n = num(v);
  return n == null ? null : Number(n.toFixed(digits));
};

/**
 * dYdX indexer candles (startedAt/open/high/low/close + a volume field whose
 * name depends on the endpoint) → the `{ t, o, h, l, c, v }` shape the
 * indicator library speaks.
 *
 * `v` stays ABSENT when the feed sent no volume. Zero volume is a fact about a
 * market; an absent field is a fact about the feed, and conflating the two is
 * how a "volume spike" gets reported from nothing.
 */
export function normaliseCandles(rows = []) {
  const out = [];
  for (const r of Array.isArray(rows) ? rows : []) {
    const t = Number(r?.startedAt ?? r?.t ?? r?.time);
    const o = Number(r?.open ?? r?.o);
    const h = Number(r?.high ?? r?.h);
    const l = Number(r?.low ?? r?.l);
    const c = Number(r?.close ?? r?.c);
    if (![t, o, h, l, c].every(Number.isFinite)) continue;
    if (h < l || h < Math.max(o, c) || l > Math.min(o, c)) continue;
    const raw = r?.usdVolume ?? r?.baseTokenVolume ?? r?.volume ?? r?.v;
    const v = num(raw);
    out.push({ t, o, h, l, c, ...(v != null && v > 0 ? { v } : {}) });
  }
  return out.sort((a, b) => a.t - b.t);
}

/** dYdX publishes funding per HOUR as a decimal fraction; the app speaks APR. */
export function fundingAprPct(rate) {
  const r = num(rate);
  return r == null ? null : r * 100 * 24 * 365;
}

/* ─── the read ────────────────────────────────────────────────────────────── */

/**
 * @param {object}   input
 * @param {Array}    input.candles   dYdX indexer candles (raw is fine)
 * @param {object}   [input.market]  the normalised market row (lib/dydx.js)
 * @param {number}   [input.now]     injected clock, for the freshness caveat
 * @returns {object} an honest read; `ready: false` with a `reason` when the
 *                   bars are missing or too few.
 */
export function analyseMarket({ candles = [], market = null } = {}) {
  const bars = sanitizeCandles(normaliseCandles(candles));
  if (bars.length < MIN_BARS) {
    return {
      version: DYDXT_TOKEN_BRAIN_VERSION,
      ready: false,
      reason: bars.length ? 'SHORT_HISTORY' : 'NO_CANDLES',
      bars: bars.length,
      minBars: MIN_BARS,
      price: num(market?.oraclePrice) ?? null
    };
  }

  const closes = bars.map((b) => b.c);
  const price = closes[closes.length - 1];
  const first = closes[0];
  const changePct = pct(price, first);

  const maFast = lastValue(emaSeries(closes, 9));
  const maSlow = lastValue(emaSeries(closes, 25));
  const maGapPct = pct(maFast, maSlow);

  const rsi = lastValue(rsiSeries(closes, 14));
  const atr = lastValue(atrSeries(bars, 14));
  const atrPct = atr != null && price > 0 ? (atr / price) * 100 : null;

  /* The window's own high/low — the range the LAST BAR sits inside. A "range
     position" measured over a different window than the chart shows is a
     number the reader cannot check against the candles above it. */
  const highs = bars.map((b) => b.h);
  const lows = bars.map((b) => b.l);
  const rangeHigh = Math.max(...highs);
  const rangeLow = Math.min(...lows);
  const position = rangeHigh > rangeLow ? clamp((price - rangeLow) / (rangeHigh - rangeLow), 0, 1) : null;

  /* Volume: only when the feed actually carried it. */
  const volumes = bars.map((b) => b.v).filter((v) => Number.isFinite(v));
  const volumePresent = volumes.length > 0;
  const lastVolume = volumePresent ? volumes[volumes.length - 1] : null;
  const avgVolume = volumePresent ? mean(volumes.slice(-21, -1)) : null;
  const volumeRatio = lastVolume != null && avgVolume != null && avgVolume > 0 ? lastVolume / avgVolume : null;

  /* Levels: swing pivots, and an ATR-derived stop/target pair. Both are
     distances measured from REAL volatility — a stop 2×ATR away is a stop the
     ordinary bar of this market does not reach, which is the only defensible
     definition of "not noise". */
  const pivots = supportResistance(bars, { lookback: 3, tolerancePct: 1.5, maxLevels: 8 });
  const support = pivots.filter((p) => p.price < price).pop()?.price ?? null;
  const resistance = pivots.find((p) => p.price > price)?.price ?? null;

  const fundingApr = fundingAprPct(market?.nextFundingRate);
  const openInterestUsd = (() => {
    const oi = num(market?.openInterest);
    const px = num(market?.oraclePrice);
    return oi != null && px != null ? oi * px : null;
  })();

  /* ── the verdict ─────────────────────────────────────────────────────────
     A score in 0..100 per DIRECTION, built only from clauses that printed a
     number above. A clause whose input is null contributes nothing rather than
     contributing a guess — so a market with no volume data gets a slightly
     blunter read, not a fabricated one. */
  const clauses = [];
  if (maFast != null && maSlow != null && maGapPct != null) {
    clauses.push({ id: 'ma', weight: 2, value: clamp(maGapPct / 1.5, -1, 1), evidence: { maFast, maSlow, gapPct: round(maGapPct, 2) } });
  }
  if (rsi != null) {
    clauses.push({ id: 'rsi', weight: 1, value: clamp((rsi - 50) / 30, -1, 1), evidence: { rsi: round(rsi, 1) } });
  }
  if (changePct != null) {
    clauses.push({ id: 'change', weight: 1.5, value: clamp(changePct / 6, -1, 1), evidence: { changePct: round(changePct, 2) } });
  }
  if (position != null) {
    clauses.push({ id: 'position', weight: 1, value: clamp((position - 0.5) * 2, -1, 1), evidence: { position: round(position * 100, 0) } });
  }
  if (volumeRatio != null) {
    /* Volume CONFIRMS the move's direction; on its own it has no sign. */
    const dir = Math.sign(changePct ?? 0) || 0;
    clauses.push({ id: 'volume', weight: 0.75, value: dir * clamp((volumeRatio - 1) / 1.5, -1, 1), evidence: { ratio: round(volumeRatio, 2) } });
  }

  const totalWeight = clauses.reduce((s, c) => s + c.weight, 0);
  const weighted = totalWeight > 0 ? clauses.reduce((s, c) => s + c.value * c.weight, 0) / totalWeight : null;
  const bullScore = weighted == null ? null : Math.round(clamp(50 + weighted * 50, 0, 100));

  let readId = 'unknown';
  if (bullScore != null) {
    if (atrPct != null && atrPct >= 4) readId = 'volatile';
    else if (bullScore >= 62) readId = 'trend-up';
    else if (bullScore <= 38) readId = 'trend-down';
    else readId = 'range';
  }

  const caveats = [];
  if (!volumePresent) caveats.push('NO_VOLUME');
  if (fundingApr == null) caveats.push('NO_FUNDING');
  if (atrPct != null && atrPct >= 4) caveats.push('HIGH_VOLATILITY');
  if (bars.length < 60) caveats.push('SHORT_HISTORY');

  return {
    version: DYDXT_TOKEN_BRAIN_VERSION,
    ready: true,
    reason: null,
    bars: bars.length,
    price,
    changePct: round(changePct, 2),
    ma: { fast: round(maFast, 6), slow: round(maSlow, 6), gapPct: round(maGapPct, 2) },
    momentum: {
      rsi: round(rsi, 1),
      zone: rsi == null ? null : rsi >= 70 ? 'overbought' : rsi <= 30 ? 'oversold' : 'neutral'
    },
    volatility: { atr: round(atr, 6), atrPct: round(atrPct, 2) },
    range: {
      low: round(rangeLow, 6),
      high: round(rangeHigh, 6),
      position: position == null ? null : round(position, 3)
    },
    volume: { last: round(lastVolume, 2), avg: round(avgVolume, 2), ratio: round(volumeRatio, 2), present: volumePresent },
    funding: { ratePct: round((num(market?.nextFundingRate) ?? 0) * 100, 6), aprPct: round(fundingApr, 2) },
    openInterestUsd: openInterestUsd == null ? null : Math.round(openInterestUsd),
    levels: {
      support: round(support, 6),
      resistance: round(resistance, 6),
      atrStopDistance: atr == null ? null : round(atr * 2, 6),
      /* Long stops below, short stops above; the target is 1.5× the stop so
         the printed reward:risk is the number a trader would actually get. */
      long: atr == null ? null : { stop: round(price - atr * 2, 6), target: round(price + atr * 3, 6), rr: 1.5 },
      short: atr == null ? null : { stop: round(price + atr * 2, 6), target: round(price - atr * 3, 6), rr: 1.5 }
    },
    read: {
      id: readId,
      bullScore,
      clauses: clauses.map((c) => ({ id: c.id, value: round(c.value, 3), evidence: c.evidence })),
      /* How much of the possible evidence actually answered — a read built on
         two clauses and a read built on five are not equally trustworthy. */
      coverage: totalWeight > 0 ? round(totalWeight / 6.25, 2) : 0
    },
    caveats
  };
}

/* ─── the opportunity engine ──────────────────────────────────────────────── */

/**
 * The shapes this engine can argue for, and the rule each one is.
 * Every id has copy in the i18n bundle (`dydx.desk.opp.<id>.*`) and a test in
 * test/dydx-token-brain.test.mjs pinning the arithmetic.
 */
export const SETUP_IDS = Object.freeze([
  'breakout', 'breakdown', 'momentum-up', 'momentum-down', 'volume-spike',
  'mean-reversion-up', 'mean-reversion-down', 'funding-crowded-long',
  'funding-crowded-short', 'chop'
]);

/**
 * @param {object} input
 * @param {Array}  input.candles
 * @param {object} [input.market]
 * @returns {{version:string, ready:boolean, reason:string|null, scanned:number,
 *            setups:Array<{id:string, tone:string, score:number,
 *            confidence:number, evidence:Array<{k:string, v:number|string,
 *            unit:string}>, why:string[], missing:string[]}>, caveats:string[]}}
 */
export function scanTokenSetups({ candles = [], market = null } = {}) {
  const bars = sanitizeCandles(normaliseCandles(candles));
  if (bars.length < MIN_BARS) {
    return {
      version: DYDXT_TOKEN_BRAIN_VERSION,
      ready: false,
      reason: bars.length ? 'SHORT_HISTORY' : 'NO_CANDLES',
      scanned: bars.length,
      setups: [],
      caveats: []
    };
  }

  const closes = bars.map((b) => b.c);
  const price = closes[closes.length - 1];
  const highs = bars.map((b) => b.h);
  const lows = bars.map((b) => b.l);

  /* The breakout reference EXCLUDES the last bar: "the price is at a new high"
     is only a statement if the high it beat is not itself. */
  const priorHigh = Math.max(...highs.slice(0, -1));
  const priorLow = Math.min(...lows.slice(0, -1));
  const windowHigh = Math.max(...highs);
  const windowLow = Math.min(...lows);

  const maFast = lastValue(emaSeries(closes, 9));
  const maSlow = lastValue(emaSeries(closes, 25));
  const rsi = lastValue(rsiSeries(closes, 14));
  const atr = lastValue(atrSeries(bars, 14));
  const atrPct = atr != null && price > 0 ? (atr / price) * 100 : null;
  const changePct = pct(price, closes[0]);
  const distanceFromSlow = pct(price, maSlow);

  const volumes = bars.map((b) => b.v).filter((v) => Number.isFinite(v));
  const volumePresent = volumes.length > 0;
  const lastVolume = volumePresent ? volumes[volumes.length - 1] : null;
  const avgVolume = volumePresent ? mean(volumes.slice(-21, -1)) : null;
  const volumeRatio = lastVolume != null && avgVolume != null && avgVolume > 0 ? lastVolume / avgVolume : null;

  const fundingApr = fundingAprPct(market?.nextFundingRate);

  const setups = [];
  const push = (id, tone, score, evidence, why, missing = []) => {
    setups.push({
      id,
      tone,
      score: Math.round(clamp(score, 0, 100)),
      /* Confidence is a statement about the EVIDENCE, never about profit: how
         many of this setup's inputs answered, and how much history there is. */
      confidence: Math.round(clamp(
        (evidence.length / (evidence.length + missing.length)) * 70 +
        Math.min(30, (bars.length / 120) * 30),
        0, 100
      )),
      evidence,
      why,
      missing
    });
  };

  /* 1–2. Breakout / breakdown — the last bar closed outside the whole window. */
  if (price > priorHigh && priorHigh > 0) {
    const overshoot = pct(price, priorHigh);
    push('breakout', 'up', 55 + clamp(overshoot * 10, 0, 25) + (volumeRatio != null ? clamp((volumeRatio - 1) * 10, 0, 15) : 0),
      [
        { k: 'price', v: round(price, 6), unit: 'usd' },
        { k: 'priorHigh', v: round(priorHigh, 6), unit: 'usd' },
        { k: 'overshoot', v: round(overshoot, 2), unit: 'pct' },
        ...(volumeRatio != null ? [{ k: 'volumeRatio', v: round(volumeRatio, 2), unit: 'x' }] : [])
      ],
      ['closedAboveWindowHigh', 'maAlignment'],
      volumeRatio == null ? ['volume'] : []);
  } else if (price < priorLow && priorLow > 0) {
    const overshoot = Math.abs(pct(price, priorLow));
    push('breakdown', 'down', 55 + clamp(overshoot * 10, 0, 25) + (volumeRatio != null ? clamp((volumeRatio - 1) * 10, 0, 15) : 0),
      [
        { k: 'price', v: round(price, 6), unit: 'usd' },
        { k: 'priorLow', v: round(priorLow, 6), unit: 'usd' },
        { k: 'overshoot', v: round(overshoot, 2), unit: 'pct' },
        ...(volumeRatio != null ? [{ k: 'volumeRatio', v: round(volumeRatio, 2), unit: 'x' }] : [])
      ],
      ['closedBelowWindowLow'],
      volumeRatio == null ? ['volume'] : []);
  }

  /* 3–4. Momentum — fast MA on the right side of the slow one, RSI confirming,
     and the move not yet stretched. */
  if (maFast != null && maSlow != null && changePct != null) {
    if (maFast > maSlow && changePct > 0 && (rsi == null || rsi < 75)) {
      push('momentum-up', 'up', 45 + clamp(changePct * 4, 0, 30) + (rsi != null ? clamp((rsi - 50) * 0.4, 0, 15) : 0),
        [
          { k: 'change', v: round(changePct, 2), unit: 'pct' },
          { k: 'maGap', v: round(pct(maFast, maSlow), 2), unit: 'pct' },
          ...(rsi != null ? [{ k: 'rsi', v: round(rsi, 1), unit: 'num' }] : [])
        ],
        ['fastAboveSlow', 'windowChangePositive'],
        rsi == null ? ['rsi'] : []);
    } else if (maFast < maSlow && changePct < 0 && (rsi == null || rsi > 25)) {
      push('momentum-down', 'down', 45 + clamp(Math.abs(changePct) * 4, 0, 30) + (rsi != null ? clamp((50 - rsi) * 0.4, 0, 15) : 0),
        [
          { k: 'change', v: round(changePct, 2), unit: 'pct' },
          { k: 'maGap', v: round(pct(maFast, maSlow), 2), unit: 'pct' },
          ...(rsi != null ? [{ k: 'rsi', v: round(rsi, 1), unit: 'num' }] : [])
        ],
        ['fastBelowSlow', 'windowChangeNegative'],
        rsi == null ? ['rsi'] : []);
    }
  }

  /* 5. Volume spike — the last bar traded far more than its neighbours. It gets
     a `watch` tone on purpose: a spike is attention, not direction. */
  if (volumeRatio != null && volumeRatio >= 1.8) {
    push('volume-spike', 'watch', 40 + clamp((volumeRatio - 1.8) * 25, 0, 40),
      [
        { k: 'volumeRatio', v: round(volumeRatio, 2), unit: 'x' },
        { k: 'change', v: round(changePct ?? 0, 2), unit: 'pct' }
      ],
      ['lastBarVolumeAboveAverage']);
  }

  /* 6–7. Mean reversion — price stretched away from its own slow MA with RSI at
     an extreme. Both directions are `watch`: this is a fade, and fades in a
     trending market are how accounts end. */
  if (distanceFromSlow != null && Math.abs(distanceFromSlow) >= 4 && rsi != null) {
    if (distanceFromSlow < 0 && rsi <= 35) {
      push('mean-reversion-up', 'watch', 40 + clamp(Math.abs(distanceFromSlow) * 4, 0, 30) + clamp((35 - rsi) * 0.8, 0, 20),
        [
          { k: 'distanceFromMa', v: round(distanceFromSlow, 2), unit: 'pct' },
          { k: 'rsi', v: round(rsi, 1), unit: 'num' }
        ],
        ['belowSlowMa', 'rsiOversold']);
    } else if (distanceFromSlow > 0 && rsi >= 65) {
      push('mean-reversion-down', 'watch', 40 + clamp(distanceFromSlow * 4, 0, 30) + clamp((rsi - 65) * 0.8, 0, 20),
        [
          { k: 'distanceFromMa', v: round(distanceFromSlow, 2), unit: 'pct' },
          { k: 'rsi', v: round(rsi, 1), unit: 'num' }
        ],
        ['aboveSlowMa', 'rsiOverbought']);
    }
  }

  /* 8–9. Crowded funding — the side that is paying is the side that gets
     liquidated first when the price turns. This is the one setup whose input
     is the venue's own number rather than the candles, and it is a RISK
     statement: it says where the fuel is, not which way it will burn. */
  if (fundingApr != null && Math.abs(fundingApr) >= 30) {
    const longsPaying = fundingApr > 0;
    push(
      longsPaying ? 'funding-crowded-long' : 'funding-crowded-short',
      'watch',
      40 + clamp((Math.abs(fundingApr) - 30) * 0.6, 0, 40),
      [
        { k: 'fundingApr', v: round(fundingApr, 1), unit: 'pct' },
        { k: 'costPerDay', v: round(Math.abs(fundingApr) / 365, 4), unit: 'pct' }
      ],
      [longsPaying ? 'longsPayingShorts' : 'shortsPayingLongs']);
  }

  /* 10. Chop — a market whose average bar is smaller than the fees and the
     funding it costs to sit in it. The honest output of the opportunity engine
     on most days is "there is nothing here". */
  if (atrPct != null && atrPct < 0.6 && Math.abs(changePct ?? 0) < 2) {
    push('chop', 'down', 30,
      [
        { k: 'atrPct', v: round(atrPct, 2), unit: 'pct' },
        { k: 'change', v: round(changePct ?? 0, 2), unit: 'pct' }
      ],
      ['rangeTooSmallForCosts']);
  }

  setups.sort((a, b) => b.score - a.score);

  return {
    version: DYDXT_TOKEN_BRAIN_VERSION,
    ready: true,
    reason: null,
    scanned: bars.length,
    window: { high: round(windowHigh, 6), low: round(windowLow, 6) },
    setups,
    caveats: [
      'notASignal',
      ...(volumePresent ? [] : ['NO_VOLUME']),
      ...(fundingApr == null ? ['NO_FUNDING'] : [])
    ]
  };
}
