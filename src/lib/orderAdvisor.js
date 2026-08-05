/**
 * ORDER ADVISOR — turn measured history into concrete order levels.
 * ---------------------------------------------------------------------------
 * ─── THE GAP THIS FILLS ─────────────────────────────────────────────────────
 * The app already measures the chart properly. `lib/history.js` finds the
 * levels a price keeps returning to and counts how often each one HELD versus
 * BROKE; `lib/verdict.js` weighs four independent layers into a stance.
 *
 * None of that reached the order form. A user opening "new automatic order"
 * faced an empty price box and had to invent a number — which in practice
 * means a round figure near the current price, chosen for no reason. The
 * measurement and the decision lived on different screens.
 *
 * This module joins them: given the same price series the chart already has,
 * it proposes the take-profit, the stop-loss, the trail distance and the
 * ladder range, and states IN NUMBERS why each one was chosen.
 *
 * ─── THE RULE THAT SHAPES EVERY FUNCTION HERE ───────────────────────────────
 * NOTHING HERE PREDICTS ANYTHING — the same rule as lib/history.js, and it
 * matters more here because this output becomes a real order on real money.
 *
 * Every level returned is anchored to something that already happened: a
 * support that was tested four times, the worst drawdown in the window, the
 * observed volatility. The reason string carries the counts, so the user can
 * judge the evidence rather than trust the app.
 *
 * A suggestion is NEVER auto-applied. It fills a field the user can overwrite,
 * and the screen says it is a suggestion. An app that quietly sets someone's
 * stop-loss has made a trade for them.
 *
 * ─── WHY IT REFUSES TO ANSWER MORE OFTEN THAN IT ANSWERS ────────────────────
 * Thin history produces confident-looking nonsense. Two touches is a
 * coincidence with a sample size, not a level. Every function below returns
 * null when the evidence is thin, and null renders as "not enough history" —
 * which is a genuinely useful answer and the one most honest tools never give.
 */

import { findLevels, levelRecord, maxDrawdown } from './history.js';
import { LADDER_MAX_STEPS, LADDER_MIN_STEPS, TRAIL_MAX_PCT, TRAIL_MIN_PCT } from './orders.js';

/**
 * Minimum observations before this module will say anything at all.
 *
 * 30 daily closes is a month. Below that, "the worst drawdown was 4%" is a
 * statement about a fortnight of weather, and a stop-loss placed on it would
 * be knocked out by ordinary noise.
 */
export const MIN_SAMPLES = 30;

/** A level needs this many tests before it is evidence rather than an anecdote. */
export const MIN_TESTS = 3;

const clean = (series) => (series ?? []).filter((n) => Number.isFinite(n) && n > 0);

/**
 * Typical day-to-day movement, as a percent.
 *
 * The MEDIAN absolute daily change, not the mean and not the standard
 * deviation. Crypto series are full of single-day outliers, and both of those
 * measures are dragged upward by one bad afternoon — producing a stop so wide
 * it never protects anything. The median describes the ordinary day, which is
 * the thing a stop has to survive.
 */
export function typicalMovePct(series) {
  const v = clean(series);
  if (v.length < MIN_SAMPLES) return null;

  const moves = [];
  for (let i = 1; i < v.length; i += 1) {
    moves.push(Math.abs((v[i] - v[i - 1]) / v[i - 1]) * 100);
  }
  if (!moves.length) return null;

  moves.sort((a, b) => a - b);
  const mid = Math.floor(moves.length / 2);
  return moves.length % 2 ? moves[mid] : (moves[mid - 1] + moves[mid]) / 2;
}

/**
 * The nearest level ABOVE and BELOW the current price that has actually been
 * tested, with its held/broke record.
 *
 * Returns only levels meeting MIN_TESTS. A level touched twice is where the
 * price happened to turn, not where it reliably turns, and dressing one up as
 * a support is how a stop-loss ends up somewhere arbitrary.
 */
export function anchorLevels(series) {
  const v = clean(series);
  if (v.length < MIN_SAMPLES) return { above: null, below: null };

  const price = v[v.length - 1];
  const levels = findLevels(v);

  let above = null;
  let below = null;

  for (const l of levels) {
    const record = levelRecord(v, l);
    if (record.tested < MIN_TESTS) continue;
    const entry = {
      price: l.price,
      touches: l.touches,
      held: record.held,
      tested: record.tested,
      distancePct: ((l.price - price) / price) * 100
    };
    if (l.price > price) {
      if (!above || l.price < above.price) above = entry;
    } else if (l.price < price) {
      if (!below || l.price > below.price) below = entry;
    }
  }

  return { above, below };
}

/**
 * Suggest a bracket: take-profit above, stop-loss below.
 *
 * ─── HOW EACH SIDE IS CHOSEN ────────────────────────────────────────────────
 * TAKE-PROFIT — the nearest well-tested level above. That is where the market
 * has repeatedly stopped going up, so it is where an exit is most likely to
 * actually fill. When no such level exists, there is no honest anchor and this
 * returns null rather than inventing "current + 10%".
 *
 * STOP-LOSS — the nearest well-tested level below, placed slightly BENEATH it
 * rather than exactly on it. A stop resting exactly on a known support is the
 * single most common way to be stopped out by a wick and then watch the level
 * hold; the buffer is one typical day's move, measured from this coin's own
 * history rather than a fixed percentage.
 *
 * The result is rejected if the reward is not at least as large as the risk.
 * A bracket risking 8% to make 3% is a bad trade regardless of how well the
 * levels are supported, and suggesting one because the arithmetic produced it
 * would be the module doing harm politely.
 */
export function suggestBracket(series) {
  const v = clean(series);
  if (v.length < MIN_SAMPLES) return null;

  const price = v[v.length - 1];
  const { above, below } = anchorLevels(v);
  if (!above || !below) return null;

  const typical = typicalMovePct(v);
  if (typical == null) return null;

  const takeProfit = above.price;
  /* One ordinary day's move below the support, so noise cannot reach it. */
  const stopLoss = below.price * (1 - typical / 100);
  if (!(takeProfit > price && stopLoss < price)) return null;

  const rewardPct = ((takeProfit - price) / price) * 100;
  const riskPct = ((price - stopLoss) / price) * 100;
  if (riskPct <= 0 || rewardPct <= 0) return null;

  const ratio = rewardPct / riskPct;
  if (ratio < 1) return null;

  return {
    takeProfit,
    stopLoss,
    rewardPct,
    riskPct,
    ratio,
    /*
     * The evidence, passed through so the UI can state it rather than assert
     * that the app "analysed" something. Counts are the whole argument.
     */
    evidence: {
      resistanceTouches: above.touches,
      resistanceHeld: above.held,
      resistanceTested: above.tested,
      supportTouches: below.touches,
      supportHeld: below.held,
      supportTested: below.tested,
      typicalMovePct: typical
    }
  };
}

/**
 * Suggest a trailing-stop distance.
 *
 * Wide enough to survive ordinary movement, tight enough to protect a gain.
 * The anchor is three typical daily moves: at one, the stop is inside the
 * noise and fires almost immediately; much beyond three and it gives back more
 * than most trends produce.
 *
 * Clamped into the band `orders.js` already enforces, and IMPORTED from there
 * rather than retyped — a duplicated constant is how the suggestion and the
 * validator drift apart until the app proposes a value its own form rejects.
 */
export function suggestTrail(series) {
  const typical = typicalMovePct(series);
  if (typical == null) return null;
  /*
   * Zero volatility means no evidence, not "use the tightest possible stop".
   *
   * Caught by driving a flat series through this: it returned a confident
   * 0.5% trail derived from a typical move of exactly 0. That is a suggestion
   * with nothing behind it, and on the tightest setting — so it would fire on
   * the first tick of real movement. A dead or brand-new feed produces exactly
   * this shape, which is precisely when a user should be told there is nothing
   * to measure.
   */
  if (typical <= 0) return null;

  const raw = typical * 3;
  const pct = Math.min(TRAIL_MAX_PCT, Math.max(TRAIL_MIN_PCT, raw));

  const dd = maxDrawdown(clean(series));

  return {
    pct: Math.round(pct * 10) / 10,
    evidence: {
      typicalMovePct: typical,
      /*
       * The worst peak-to-trough fall in the window. Shown beside the
       * suggestion because it is the honest counterweight: a 9% trail would
       * have been stopped out by a 34% drawdown, and the user deserves to see
       * that before deciding this is protection.
       */
      maxDrawdownPct: dd
    }
  };
}

/**
 * Suggest a ladder range for scaling out.
 *
 * Runs from the current price up to the nearest well-tested resistance,
 * because that is the span the market has actually traded through. Extending
 * beyond a level that has repeatedly held would place rungs at prices with no
 * evidence behind them, and those rungs simply never fill.
 *
 * Step count scales with the size of the range: a 3% span does not need six
 * rungs, and splitting a small move into many pieces just multiplies gas and
 * notifications for the same result.
 */
export function suggestLadder(series) {
  const v = clean(series);
  if (v.length < MIN_SAMPLES) return null;

  const price = v[v.length - 1];
  const { above } = anchorLevels(v);
  if (!above) return null;

  const spanPct = ((above.price - price) / price) * 100;
  /* Below ~2% the rungs sit inside the spread and it is not a ladder. */
  if (spanPct < 2) return null;

  const steps = Math.min(
    LADDER_MAX_STEPS,
    Math.max(LADDER_MIN_STEPS, Math.round(spanPct / 3))
  );

  return {
    startRate: price,
    endRate: above.price,
    steps,
    direction: 'above',
    spanPct,
    evidence: {
      resistanceTouches: above.touches,
      resistanceHeld: above.held,
      resistanceTested: above.tested
    }
  };
}

/**
 * Everything at once, for the order form.
 *
 * Each key is independently null-able: a coin can have enough history for a
 * trail suggestion (which needs only volatility) but not for a bracket (which
 * needs two well-tested levels). Returning a partial answer is right —
 * withholding a good suggestion because a different one was unavailable helps
 * nobody.
 */
export function adviseOrder(series) {
  const v = clean(series);
  const ready = v.length >= MIN_SAMPLES;

  return {
    ready,
    samples: v.length,
    minSamples: MIN_SAMPLES,
    price: ready ? v[v.length - 1] : null,
    bracket: ready ? suggestBracket(v) : null,
    trailing: ready ? suggestTrail(v) : null,
    ladder: ready ? suggestLadder(v) : null
  };
}
