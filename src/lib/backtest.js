/**
 * BACKTESTING — how often has this signal actually been right?
 * ---------------------------------------------------------------------------
 * Requested: «موتور سیگنال‌دهی در بهترین حالت باشد ... میخام به قطعیت بهتری
 * برسی» — a better signal engine, and better certainty.
 *
 * ─── THE FLAW IN THE OLD CONFIDENCE NUMBER ──────────────────────────────────
 * `analyze()` computed confidence from INDICATOR AGREEMENT: if RSI, MACD and
 * the moving averages all pointed the same way, confidence was high.
 *
 * That measures consensus, not correctness. Every one of those indicators is
 * a different arithmetic transform of the SAME price series, so they are
 * heavily correlated by construction — in a strong downtrend they will all
 * scream "oversold" together, agree perfectly, and be wrong together. The
 * number was really "how similar are my formulas", presented to the user as
 * "how sure am I".
 *
 * That is the worst kind of wrong: confidently wrong, about money.
 *
 * ─── WHAT THIS DOES INSTEAD ─────────────────────────────────────────────────
 * It replays the same signal over the coin's own history and counts. If the
 * rule said "buy" 40 times on this chart and price was higher 7 days later 24
 * times, that is 60% — a measured hit rate on real data, not a statement
 * about formula similarity.
 *
 * ─── THE HONESTY RULES, WHICH ARE THE POINT ─────────────────────────────────
 *
 * 1. NO LOOK-AHEAD. Each historical signal is computed using ONLY the bars
 *    that existed at that moment. Using the full series to decide what a
 *    signal "would have been" is the classic backtesting error and it
 *    produces spectacular, fictional results.
 *
 * 2. A SMALL SAMPLE IS REPORTED AS SMALL. Twelve occurrences is not a hit
 *    rate, it is an anecdote. The result carries `samples` and the UI must
 *    refuse to show a percentage below a threshold.
 *
 * 3. IT IS COMPARED TO DOING NOTHING. A 60% hit rate sounds good until you
 *    learn the coin rose on 62% of all days in that period — at which point
 *    the signal is worse than a coin flip. `edge` is the honest number:
 *    hit rate minus base rate. It is frequently negative, and we show it.
 *
 * 4. IT IS STILL NOT A PREDICTION. A hit rate describes what already
 *    happened. Markets change regime; a rule that worked all through a bull
 *    run stops working the day it ends.
 */

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/* -------------------------------------------------------------------------- */
/* indicators, recomputed on a window                                         */
/* -------------------------------------------------------------------------- */

/*
 * Deliberately duplicated from lib/ai.js in a windowed form rather than
 * imported.
 *
 * The versions there take the whole series and return the value AT THE END.
 * Backtesting needs the value at an arbitrary past index using only prior
 * data, and calling the existing helpers on a slice per bar would be
 * O(n * period) allocations — hundreds of array copies on a phone. These
 * operate on an index into one array and allocate nothing.
 */

function rsiAt(v, i, period = 14) {
  if (i < period) return null;
  let gain = 0;
  let loss = 0;
  for (let k = i - period + 1; k <= i; k += 1) {
    const d = v[k] - v[k - 1];
    if (d >= 0) gain += d;
    else loss -= d;
  }
  if (loss === 0) return gain === 0 ? 50 : 100;
  const rs = gain / loss;
  return 100 - 100 / (1 + rs);
}

function smaAt(v, i, period) {
  if (i < period - 1) return null;
  let sum = 0;
  for (let k = i - period + 1; k <= i; k += 1) sum += v[k];
  return sum / period;
}

/* -------------------------------------------------------------------------- */
/* the signal being tested                                                    */
/* -------------------------------------------------------------------------- */

/**
 * The rule, evaluated at one point in history.
 *
 * Intentionally SIMPLER than `analyze()`'s full weighted blend. A rule with
 * six weighted inputs has enough freedom to fit any past series if you tune
 * it, which is overfitting — it would score brilliantly here and fail live.
 * Two well-understood inputs can be honestly measured.
 *
 * @returns {'buy'|'sell'|null} null means "no signal", which is most bars
 */
export function signalAt(v, i) {
  const r = rsiAt(v, i);
  if (r === null) return null;

  const ma20 = smaAt(v, i, 20);
  const ma50 = smaAt(v, i, 50);
  if (ma20 === null || ma50 === null) return null;

  const trendUp = ma20 > ma50;

  // Oversold in an uptrend, or overbought in a downtrend. Requiring the trend
  // to agree is what stops the rule buying every dip of a collapse.
  if (r < 35 && trendUp) return 'buy';
  if (r > 65 && !trendUp) return 'sell';
  return null;
}

/* -------------------------------------------------------------------------- */
/* the backtest                                                               */
/* -------------------------------------------------------------------------- */

/**
 * Replay `signalAt` across the series and count outcomes.
 *
 * @param {number[]} series    chronological prices
 * @param {number}   horizon   bars ahead to judge the outcome
 * @returns {{buy, sell, baseRate, edge, samples}|null}
 */
export function backtest(series, horizon = 7) {
  const v = (series ?? []).filter((n) => Number.isFinite(n) && n > 0);
  /*
   * 50 bars for the slowest indicator + the horizon + enough room afterwards
   * for the result to mean anything. Below this, refuse rather than return a
   * number built on four observations.
   */
  if (v.length < 50 + horizon + 20) return null;

  const tally = {
    buy: { hits: 0, total: 0 },
    sell: { hits: 0, total: 0 }
  };
  /* Tape buckets, filled in the SAME walk — see TAPE_MIN_BUCKET below. */
  const tape = {
    broad: { hits: 0, total: 0, up: 0, buys: 0 },
    spiky: { hits: 0, total: 0, up: 0, buys: 0 }
  };

  let upDays = 0;
  let allDays = 0;

  for (let i = 50; i + horizon < v.length; i += 1) {
    /*
     * THE BASE RATE, over exactly the same window the signals are drawn
     * from. Comparing a signal's hit rate against a base rate measured on a
     * different period would flatter or punish it for no reason.
     */
    allDays += 1;
    if (v[i + horizon] > v[i]) upDays += 1;

    const sig = signalAt(v, i);
    if (!sig) continue;

    const later = v[i + horizon];
    const now = v[i];
    tally[sig].total += 1;
    // A "sell" is correct when price FELL. Judging both directions by "did it
    // go up" would score every sell signal backwards.
    const hit = sig === 'buy' ? later > now : later < now;
    if (hit) tally[sig].hits += 1;

    /* ── the same occurrence, bucketed by the shape of the tape ──────────
       Classified from bars that are ALREADY in the past at this point —
       nothing here looks forward except the outcome being judged. */
    const kind = tapeKindAt(v, i);
    if (!kind) continue;
    const b = tape[kind];
    b.total += 1;
    if (sig === 'buy') b.buys += 1;
    if (later > now) b.up += 1;
    if (hit) b.hits += 1;
  }

  const baseRate = allDays ? (upDays / allDays) * 100 : null;
  const samples = tally.buy.total + tally.sell.total;
  if (!samples || baseRate === null) return null;

  const rate = (t) => (t.total ? (t.hits / t.total) * 100 : null);
  const buyRate = rate(tally.buy);
  const sellRate = rate(tally.sell);

  /*
   * EDGE — the number that matters, and the one most tools hide.
   *
   * A 60% buy hit rate is worthless if the coin rose on 62% of all days: the
   * rule did worse than doing nothing. Edge is hit rate minus the relevant
   * base rate, and for sells the comparison is the DOWN rate, so it is
   * `sellRate - (100 - baseRate)`.
   *
   * This is negative surprisingly often. We show it anyway.
   */
  const buyEdge = buyRate === null ? null : buyRate - baseRate;
  const sellEdge = sellRate === null ? null : sellRate - (100 - baseRate);

  const weighted =
    (tally.buy.total * (buyEdge ?? 0) + tally.sell.total * (sellEdge ?? 0)) / samples;

  return {
    buy: { ...tally.buy, rate: buyRate, edge: buyEdge },
    sell: { ...tally.sell, rate: sellRate, edge: sellEdge },
    baseRate,
    edge: weighted,
    samples,
    horizon,
    /* The same replay, split by the tape — computed in the loop above, so it
       costs one extra divisor and no extra pass over the prices. */
    tape: tapeSummary(tape, horizon)
  };
}

/* -------------------------------------------------------------------------- */
/* tape-conditioned split (2026-11-12)                                        */
/* -------------------------------------------------------------------------- */

/** Six occurrences is the floor for reporting a bucket — see `tapeSummary`. */
const TAPE_MIN_BUCKET = 6;

/**
 * Which kind of tape were the twenty bars ENDING AT `i`?
 *
 * ─── WHY THIS EXISTS, AND WHY IT IS NOT A FITTED PARAMETER ─────────────────
 * The behaviour plane (src/lib/tokenBehavior.js) already tells the live card
 * how a token traded: whether the move was carried by most steps or delivered
 * by one candle. Until now that read had no history behind it — it shaped the
 * score on the strength of a plausible argument.
 *
 * This is the historical answer, and it is deliberately dumb: participation
 * (net move over total travel) and the share of the biggest single step,
 * measured on bars that are already in the past whenever it is used. Two plain
 * cuts, no weights, no fitting, no look-ahead:
 *
 *     broad  : participation ≥ 45% and no step owns more than 45% of travel
 *     spiky  : participation < 25%, or one step owns more than 60% of travel
 *     else   : unclassified — the honest middle, and it is NOT reported
 *
 * @returns {'broad'|'spiky'|null}
 */
export function tapeKindAt(v, i) {
  const from = Math.max(1, i - 19);
  if (i - from < 8) return null;
  let upTravel = 0;
  let downTravel = 0;
  let biggest = 0;
  let net = 0;
  for (let k = from + 1; k <= i; k += 1) {
    const d = v[k] - v[k - 1];
    net += d;
    if (d >= 0) upTravel += d;
    else downTravel -= d;
    if (Math.abs(d) > biggest) biggest = Math.abs(d);
  }
  const travel = upTravel + downTravel;
  if (!(travel > 0)) return null;
  const participation = Math.abs(net) / travel;
  const spikeShare = biggest / travel;
  if (participation >= 0.45 && spikeShare <= 0.45) return 'broad';
  if (participation < 0.25 || spikeShare > 0.6) return 'spiky';
  return null;
}

/**
 * Turn the per-bucket tallies into the report the card shows.
 *
 * Each bucket is judged against ITS OWN base rate and per direction: a buy
 * against «how often did price rise in this bucket», a sell against the down
 * rate. Comparing a bucket's hit rate to one pooled number would let a bucket
 * full of sells look skilled in a rally.
 *
 * A bucket below TAPE_MIN_BUCKET is reported as `null`, never as a small
 * number: two lucky trades are not evidence, and an unmeasurable claim is
 * exactly what this app must not print.
 */
function tapeSummary(tape, horizon) {
  const summarise = (b) => {
    if (b.total < TAPE_MIN_BUCKET) return null;
    const rate = (b.hits / b.total) * 100;
    const upRate = (b.up / b.total) * 100;
    const expected = (b.buys * upRate + (b.total - b.buys) * (100 - upRate)) / b.total;
    return {
      n: b.total,
      rate: Math.round(rate * 10) / 10,
      edge: Math.round((rate - expected) * 10) / 10
    };
  };
  const broad = summarise(tape.broad);
  const spiky = summarise(tape.spiky);
  if (!broad && !spiky) return null;
  return { broad, spiky, minBucket: TAPE_MIN_BUCKET, horizon };
}

/**
 * Turn a backtest into a confidence figure for the CURRENT signal.
 *
 * ─── WHY THIS IS CAPPED SO LOW ──────────────────────────────────────────────
 * The ceiling is 75, and that is deliberate. No chart-based rule on a
 * volatile asset deserves a number that reads like certainty, and a "94%
 * confident" badge on a crypto app is a lie with a decimal point on it.
 *
 * A rule with no measurable edge lands near 25–35, which is honest: it means
 * "this fired, and historically that told you almost nothing".
 *
 * @param {object|null} bt        result of backtest()
 * @param {string} label          the current signal
 * @param {number} agreement      indicator agreement, 0-100 (a weak tiebreak)
 */
export function confidenceFrom(bt, label, agreement = 50) {
  /*
   * No backtest — a new coin, or too little history. Fall back to agreement
   * but cap it hard: without evidence we are guessing, and the number must
   * say so rather than inheriting the old inflated scale.
   */
  if (!bt) return clamp(Math.round(agreement * 0.4), 5, 40);

  const side = label.includes('uy') ? bt.buy : label.includes('ell') ? bt.sell : null;
  if (!side || side.total < 8 || side.edge === null) {
    return clamp(Math.round(agreement * 0.4), 5, 40);
  }

  /*
   * Edge drives it. +10pp of edge is genuinely good and lands around 60;
   * negative edge drags below the agreement-only floor, which is correct —
   * a rule that historically underperformed doing nothing should reduce
   * confidence, not merely fail to raise it.
   */
  const edgeScore = 45 + side.edge * 1.6;

  /*
   * Sample size scales how much we trust the edge at all. 8 occurrences is
   * the floor, 40 is where it stops adding — beyond that more data does not
   * make a noisy rule reliable.
   */
  const weight = clamp((side.total - 8) / 32, 0, 1);

  const blended = edgeScore * (0.35 + 0.65 * weight) + agreement * 0.25 * (1 - weight);
  return clamp(Math.round(blended), 5, 75);
}
