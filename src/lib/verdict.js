/**
 * THE VERDICT ENGINE
 * ---------------------------------------------------------------------------
 * Requested: «میخام قویترین سیگنال‌دهی را داشته باشیم که هر کسی با هر سوادی
 * بفهمه چخبره» — the strongest signal we can honestly build, understandable by
 * anyone regardless of background, over both a short and a long horizon.
 *
 * ─── WHY THIS FILE EXISTS SEPARATELY FROM ai.js ─────────────────────────────
 * `lib/ai.js` answers "what is this chart doing right now". That is one input.
 * It cannot answer "what happens to this token over the next month", because
 * it only ever looks at the token's own price and every indicator inside it is
 * a transform of that same series.
 *
 * This file combines FOUR INDEPENDENT LAYERS, each of which can disagree with
 * the others — which is the entire point, because disagreement between
 * genuinely independent sources is information, while agreement between six
 * transforms of one series is not:
 *
 *   1. TECHNICAL   (lib/ai.js)       — what the chart is doing
 *   2. HISTORICAL  (lib/backtest.js) — how often this setup has actually paid
 *   3. STRUCTURAL  (lib/history.js)  — levels, drawdown, range position
 *   4. MACRO       (lib/macro.js)    — market regime, beta to BTC, cycle
 *
 * ─── THE TWO HORIZONS ARE COMPUTED DIFFERENTLY, NOT SCALED ──────────────────
 * A short-horizon read and a monthly read are not the same number with a
 * different label on it. Most "1D / 7D / 30D" toggles in trading apps are
 * exactly that, and it is a lie by presentation.
 *
 *   SHORT (≈7 days)  is dominated by the technical layer and by the measured
 *                    hit rate of this specific setup. Levels matter. Macro
 *                    barely moves inside a week.
 *   LONG  (≈30 days) inverts the weights. Over a month, RSI is noise and the
 *                    regime and cycle position dominate. The backtest is used
 *                    at its own 30-bar horizon, not the 7-bar one.
 *
 * ─── WHAT THIS WILL NEVER OUTPUT ────────────────────────────────────────────
 *   · a price target
 *   · the word "will"
 *   · a probability above 75
 *   · a sentence — every output is a translation KEY plus numbers, so nothing
 *     here can be machine-translated into a claim we did not make
 *
 * ─── THE STANCE VOCABULARY ──────────────────────────────────────────────────
 * Five stances, and none of them is an instruction:
 *
 *   tailwind   conditions have historically favoured this direction
 *   mildUp     the same, weakly
 *   unclear    the layers disagree, or the evidence is too thin — VERY COMMON
 *              and the correct answer most of the time
 *   mildDown   conditions have historically worked against it, weakly
 *   headwind   the same, strongly
 *
 * "unclear" is the default and requires evidence to move away from. A signal
 * engine whose honest answer is usually "we don't know" is worth more than one
 * that always has an opinion, because the user learns which of the two to act
 * on.
 */

import { backtest, confidenceFrom } from './backtest';
import { historyFacts, baseRate, maxDrawdown, rangePosition } from './history';
import { macroContext } from './macro';

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/**
 * THE CONFIDENCE CEILINGS, exported so nothing can quietly disagree with them.
 *
 * The UI draws its bar against these (see VerdictPanel), and the tests assert
 * against these rather than against copied literals — a duplicated constant in
 * a test goes stale silently and then guards nothing, which has happened in
 * this repo before.
 *
 * 75 is not a tuning parameter. No chart-derived rule on a volatile asset
 * earns a number that reads like certainty, and a "94% confident" badge in a
 * crypto app is a lie with a decimal point on it. The monthly view is capped
 * lower because a month is further away and pretending otherwise would be the
 * easiest way to mislead someone.
 */
export const CONFIDENCE_CEILING = { short: 75, long: 65 };

const clean = (series) =>
  (series ?? [])
    .map((p) => (typeof p === 'object' && p !== null ? p.p : p))
    .filter((n) => Number.isFinite(n) && n > 0);

/* -------------------------------------------------------------------------- */
/* the layers                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Every layer returns the same shape:
 *
 *   { score: -100..100, weight: 0..1, reasons: [{ id, kind, values }] }
 *
 * `weight` is not a tuning knob — it is how much evidence the layer actually
 * has. A layer with no data returns weight 0 and is dropped, rather than
 * contributing a zero score that silently drags the blend toward neutral.
 * Those are very different things and conflating them is how a signal ends up
 * looking confidently neutral when it is really uninformed.
 */

/** LAYER 1 — the chart, from an already-computed `analyze()` result. */
function technicalLayer(analysis, horizon) {
  if (!analysis) return { score: 0, weight: 0, reasons: [] };

  const reasons = [];
  const ind = analysis.indicators ?? {};

  /*
   * Over a month, an RSI reading from today is close to meaningless — it will
   * have mean-reverted several times before the horizon is reached. So the
   * long view keeps only the STRUCTURAL part of the technical read (where
   * price sits relative to its 20/50 averages) and discards the oscillators.
   */
  let score = analysis.score;
  if (horizon === 'long') {
    const structural = (analysis.signals ?? []).filter((s) => s.key === 'ma20' || s.key === 'cross');
    if (!structural.length) return { score: 0, weight: 0, reasons: [] };
    const tw = structural.reduce((a, s) => a + s.weight, 0);
    score = structural.reduce((a, s) => a + s.score * s.weight, 0) / tw;

    if (ind.ma20 != null && ind.ma50 != null) {
      reasons.push({
        id: ind.ma20 > ind.ma50 ? 'trendStructureUp' : 'trendStructureDown',
        kind: 'neutral',
        values: {}
      });
    }
  } else {
    const strongest = [...(analysis.signals ?? [])].sort((a, b) => Math.abs(b.score) - Math.abs(a.score))[0];
    if (strongest && Math.abs(strongest.score) >= 20) {
      reasons.push({
        id: `ind.${strongest.key}.${strongest.score > 0 ? 'up' : 'down'}`,
        kind: 'neutral',
        values: { value: Math.round(Math.abs(strongest.value ?? 0) * 10) / 10 }
      });
    }
  }

  return {
    score: clamp(score, -100, 100),
    // The chart is the loudest input short-term and a minor one long-term.
    weight: horizon === 'long' ? 0.35 : 1,
    reasons
  };
}

/**
 * LAYER 2 — has this setup actually paid, on this asset's own history?
 *
 * This is the layer that can VETO. A rule with negative measured edge does not
 * merely fail to support the technical read, it argues against it, and that is
 * represented by a score with the opposite sign.
 */
function historicalLayer(series, analysis, horizonBars) {
  const v = clean(series);
  const bt = backtest(v, horizonBars);
  if (!bt || !analysis) return { score: 0, weight: 0, reasons: [] };

  const label = analysis.label ?? 'neutral';
  const side = label.includes('uy') ? bt.buy : label.includes('ell') ? bt.sell : null;
  if (!side || side.total < 8 || side.edge === null) {
    /*
     * The setup has fired fewer than 8 times on this chart. That is not
     * evidence of anything, and saying so out loud is more useful than
     * quietly weighting it at zero — the user learns WHY the app is unsure.
     */
    return {
      score: 0,
      weight: 0,
      reasons: [{ id: 'thinBacktest', kind: 'caution', values: { samples: side?.total ?? 0, horizon: horizonBars } }]
    };
  }

  /*
   * Edge, in percentage points, mapped to the score scale. ±10pp is a large
   * edge in this domain; 6× puts that at ±60 and leaves headroom without ever
   * saturating on ordinary numbers.
   */
  const score = clamp(side.edge * 6 * (label.includes('ell') ? -1 : 1), -100, 100);

  return {
    score,
    weight: clamp(side.total / 30, 0.3, 1),
    reasons: [
      {
        id: side.edge > 2 ? 'edgePositive' : side.edge < -2 ? 'edgeNegative' : 'edgeNone',
        kind: side.edge < -2 ? 'caution' : side.edge > 2 ? 'notable' : 'neutral',
        values: {
          edge: Math.round(side.edge * 10) / 10,
          rate: Math.round(side.rate),
          base: Math.round(bt.baseRate),
          samples: side.total,
          horizon: horizonBars
        }
      }
    ]
  };
}

/** LAYER 3 — structure: where price sits, and how bad the falls have been. */
function structuralLayer(series, horizon) {
  const v = clean(series);
  if (v.length < 20) return { score: 0, weight: 0, reasons: [] };

  const reasons = [];
  let score = 0;

  const pos = rangePosition(v);
  if (pos) {
    /*
     * Range position is read DIFFERENTLY on the two horizons, and this is one
     * of the few places where the same fact honestly implies opposite things:
     *
     *   short — near the top of the range is where rallies stall, so it is a
     *           mild negative for a one-week view.
     *   long  — sustained trading near the highs is what an uptrend looks
     *           like, so over a month it is a mild positive.
     *
     * Both readings are standard and both are defensible; presenting only one
     * of them and calling it "the" interpretation would be the dishonest move.
     */
    const p = pos.pct;
    if (horizon === 'short') score += p > 85 ? -25 : p < 15 ? 15 : 0;
    else score += p > 70 ? 20 : p < 20 ? -15 : 0;

    if (p > 85 || p < 15) {
      reasons.push({ id: p > 85 ? 'nearRangeTop' : 'nearRangeBottom', kind: 'neutral', values: { pct: Math.round(p) } });
    }
  }

  const dd = maxDrawdown(v);
  if (dd != null && dd >= 25) {
    /*
     * A deep drawdown inside the sample window is not a direction signal; it
     * is a SIZE-OF-LOSS warning, so it lowers the stance a little and is
     * always surfaced as caution regardless of which way the score went.
     */
    score -= clamp((dd - 25) * 0.6, 0, 25);
    reasons.push({ id: 'deepFallInWindow', kind: 'caution', values: { pct: Math.round(dd) } });
  }

  return { score: clamp(score, -100, 100), weight: horizon === 'long' ? 0.8 : 0.5, reasons };
}

/** LAYER 4 — the market this asset lives in. Dominant over a month. */
function macroLayer(macro, horizon) {
  if (!macro?.regime) return { score: 0, weight: 0, reasons: [] };

  const reasons = [...(macro.facts ?? [])];
  let score = 0;

  const REGIME_SCORE = { riskOn: 30, btcLed: 5, rotationOut: -35, riskOff: -30 };
  score += REGIME_SCORE[macro.regime.regime] ?? 0;

  /*
   * Beta AMPLIFIES the regime rather than adding to it. That is the correct
   * shape: a high-beta altcoin is not inherently bullish or bearish, it is
   * inherently MORE of whatever the market is doing. Adding beta as its own
   * term would make risky coins look permanently bearish, which is wrong.
   */
  if (macro.beta && macro.beta.r2 >= 0.2) {
    score *= clamp(macro.beta.beta, 0.5, 2);
    score = clamp(score, -100, 100);
  }

  /*
   * Cycle position only enters the LONG view. Over a week, being 80% below an
   * all-time high tells you nothing about the next seven days; over a month it
   * is one of the few things that does carry information.
   */
  if (horizon === 'long' && macro.cycle) {
    const b = macro.cycle.band;
    if (b === 'atHigh' || b === 'nearHigh') score += 10;
    if (b === 'farFromHigh') score -= 10;
  }

  return {
    score: clamp(score, -100, 100),
    // The single biggest weight in the monthly view, and a real but secondary
    // one inside a week.
    weight: horizon === 'long' ? 1 : 0.45,
    reasons
  };
}

/* -------------------------------------------------------------------------- */
/* the blend                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * DISAGREEMENT — measured two ways, because one of them was not enough.
 *
 * When independent layers point opposite ways, the honest output is not the
 * average — it is "we don't know". Averaging +80 and -80 to 0 and calling it
 * "neutral" is a completely different statement from "these two strong,
 * independent readings contradict each other", and only the second one is
 * true.
 *
 * ─── WHY SPREAD ALONE FAILED ────────────────────────────────────────────────
 * The first version used only the standard deviation across layers, with a
 * threshold. It looked reasonable and it almost never fired: a chart screaming
 * +95 inside a rotation-out market (macro -35, structure -25) produces a
 * spread of 59, which sat under the threshold — so the single most dangerous
 * configuration in the whole engine, the one the macro layer was built to
 * catch, was being reported as "slightly in its favour".
 *
 * I only found that by printing the numbers for a deliberately conflicted
 * fixture rather than by reading the code. Spread is a poor detector here
 * because it is scale-dependent: three layers can be violently opposed and
 * still have a modest standard deviation if one of them is near zero.
 *
 * ─── WHAT REPLACED IT ───────────────────────────────────────────────────────
 * A direct SIGN CONFLICT test: do two layers that both carry real weight and
 * a real magnitude point in opposite directions? That is what a human means
 * by "these disagree", it does not depend on scale, and it is legible.
 * Spread is kept as a secondary, softer signal on confidence.
 */

/** Layers must clear both bars before their disagreement counts. */
const CONFLICT_MIN_WEIGHT = 0.4;
const CONFLICT_MIN_SCORE = 25;

function spreadOf(layers) {
  const active = layers.filter((l) => l.weight > 0);
  if (active.length < 2) return 0;
  const mean = active.reduce((a, l) => a + l.score, 0) / active.length;
  return Math.sqrt(active.reduce((a, l) => a + (l.score - mean) ** 2, 0) / active.length);
}

/**
 * True when two meaningful layers point opposite ways.
 *
 * Both thresholds matter. Without the weight bar, a layer holding almost no
 * evidence could veto a well-supported read; without the score bar, ordinary
 * noise around zero would read as conflict and the engine would answer
 * "unclear" to everything, which is just a different way of being useless.
 */
function hasSignConflict(layers) {
  const strong = layers.filter(
    (l) => l.weight >= CONFLICT_MIN_WEIGHT && Math.abs(l.score) >= CONFLICT_MIN_SCORE
  );
  return strong.some((a) => strong.some((b) => a.score > 0 && b.score < 0));
}

const stanceFor = (score) =>
  score > 35 ? 'tailwind' : score > 12 ? 'mildUp' : score < -35 ? 'headwind' : score < -12 ? 'mildDown' : 'unclear';

/**
 * Build one horizon's verdict.
 *
 * @param {'short'|'long'} horizon
 */
function buildHorizon(horizon, { analysis, series, macro }) {
  const bars = horizon === 'long' ? 30 : 7;

  const layers = {
    technical: technicalLayer(analysis, horizon),
    historical: historicalLayer(series, analysis, bars),
    structural: structuralLayer(series, horizon),
    macro: macroLayer(macro, horizon)
  };

  const list = Object.values(layers);
  const totalWeight = list.reduce((a, l) => a + l.weight, 0);

  if (totalWeight === 0) {
    return {
      horizon,
      days: bars,
      stance: 'unclear',
      confidence: 0,
      score: 0,
      reasons: [{ id: 'noData', kind: 'caution', values: {} }],
      layers,
      conflicted: false,
      disagreement: 0
    };
  }

  const score = list.reduce((a, l) => a + l.score * l.weight, 0) / totalWeight;
  const spread = spreadOf(list);
  const conflicted = hasSignConflict(list);

  /*
   * CONFIDENCE — deliberately not derived from |score|.
   *
   * A big score with two layers fighting deserves LESS confidence than a
   * modest score all four layers agree on. Three things move it, and all
   * three are measured rather than assumed:
   *
   *   · how much evidence exists at all (totalWeight, max ~3.2)
   *   · how much the layers agree (spread)
   *   · whether the historical layer found a real, measured edge
   */
  const evidence = clamp(totalWeight / 2.8, 0, 1);
  const harmony = clamp(1 - spread / 90, 0, 1);
  const measured = layers.historical.weight > 0 ? 1 : 0.55;

  /*
   * The base is 96, not 75.
   *
   * That looks wrong next to a ceiling of 75, and the reason is a bug this
   * replaced: the base used to be 72, so the product could never reach the
   * clamp and the ceiling was dead code — a promise the code was not actually
   * keeping, it just happened to be true. A cap that can never bind is not a
   * cap. With 96 the clamp below is a real constraint that a genuinely
   * well-evidenced, fully-agreeing read will hit.
   */
  let confidence = Math.round(96 * evidence * (0.45 + 0.55 * harmony) * measured);

  /*
   * THE CEILING IS 75 AND IT IS NOT NEGOTIABLE.
   *
   * See lib/backtest.js for the long version. Short version: no chart-derived
   * rule on a volatile asset earns a number that reads like certainty, and a
   * "94% confident" badge in a crypto app is a lie with a decimal point on it.
   * The monthly view is capped lower still — a month is further away, and
   * pretending otherwise would be the single easiest way to mislead someone.
   */
  confidence = clamp(confidence, 0, CONFIDENCE_CEILING[horizon]);

  /*
   * Hard override. Two well-supported layers pointing opposite ways means the
   * app genuinely does not know, and it must say so rather than reporting
   * whichever side won the weighted average. This is the case the macro layer
   * exists to catch: a strong chart inside a market that is selling this
   * whole category.
   */
  const stance = conflicted ? 'unclear' : stanceFor(score);
  if (conflicted) confidence = Math.min(confidence, 30);

  /* Reasons, strongest-evidence layer first, deduplicated by id. */
  const ordered = [...list].sort((a, b) => b.weight - a.weight);
  const seen = new Set();
  const reasons = [];
  for (const l of ordered) {
    for (const r of l.reasons) {
      if (seen.has(r.id)) continue;
      seen.add(r.id);
      reasons.push(r);
    }
  }
  if (conflicted) reasons.unshift({ id: 'layersDisagree', kind: 'caution', values: {} });

  return {
    horizon,
    days: bars,
    stance,
    confidence,
    score: Math.round(score),
    reasons: reasons.slice(0, 5),
    layers,
    conflicted,
    disagreement: Math.round(spread)
  };
}

/**
 * THE PUBLIC ENTRY POINT.
 *
 * @param {object}   args
 * @param {object}   args.analysis   result of `analyze()` from lib/ai.js
 * @param {number[]} args.series     this asset's prices, chronological
 * @param {number[]} args.btcSeries  BTC prices over the same window
 * @param {object}   args.coin       market row
 * @param {object}   args.global     global market stats
 * @returns {{short, long, macro, facts, agree}|null}
 */
export function verdict({ analysis, series = [], btcSeries = [], coin: coinArg, global = null } = {}) {
  /*
   * ─── A DEFAULT PARAMETER DOES NOT CATCH `null` ──────────────────────────
   * This signature was `coin = {}`, which looks safe and is not: a default
   * only fires for `undefined`. Passing `null` skips it entirely, and
   * `macroContext` then destructures the null and throws.
   *
   * THE CRASH THIS CAUSED, reported as: «برای اولین بار هر توکنی را انتخاب
   * کنی کرش میکنه بار دوم خوبه ... اگر وارد یک صفحه دیگر شوی و دوباره برگردی
   * دوباره کرش میکنه».
   *
   * On a cold open of a coin page three requests race: the coin, its chart,
   * and the markets list. If the CHART resolves before the COIN — which is
   * common, since the chart endpoint is lighter — CoinDetail has
   * `loading === false` but `coin === null`, its "not found" guard does not
   * fire because the coin fetch is still in flight, and it renders
   * `<VerdictPanel coin={null}>`. Straight into this destructure.
   *
   * The second tap succeeds because `getCoin` is memoised by then, so `coin`
   * is populated on the first render. Navigating away and back re-runs the
   * same cold ordering, which is exactly why it came back — and why a
   * module-map explanation was wrong: that failure would have been permanent.
   *
   * Normalising here as well as in the caller is deliberate. This function is
   * called from three screens, and a crash in a read-only analysis panel must
   * never take down a page the user is trying to read a price on.
   */
  const coin = coinArg ?? {};
  const v = clean(series);
  if (!v.length) return null;

  const macro = macroContext({ coin, series: v, btcSeries, global });

  const short = buildHorizon('short', { analysis, series: v, macro });
  const long = buildHorizon('long', { analysis, series: v, macro });

  /*
   * DO THE TWO HORIZONS AGREE?
   *
   * This is the single most useful line for a non-technical reader and it is
   * missing from every retail signal product I have seen. "Weak this week,
   * constructive over a month" is a completely different situation from
   * "negative on both" — the first is a waiting problem, the second is a
   * position-size problem — and reading two gauges side by side does not
   * communicate it. Naming it does.
   */
  const dir = (s) => (s === 'tailwind' || s === 'mildUp' ? 1 : s === 'headwind' || s === 'mildDown' ? -1 : 0);
  const ds = dir(short.stance);
  const dl = dir(long.stance);
  const agree = ds === 0 || dl === 0 ? 'partial' : ds === dl ? 'aligned' : 'conflict';

  return {
    short,
    long,
    macro,
    agree,
    /* Structural facts about the past, for the "why" panel. */
    facts: historyFacts(v, { volume: coin?.volume, days: v.length }),
    baseRate: baseRate(v, 7),
    generatedAt: Date.now()
  };
}
