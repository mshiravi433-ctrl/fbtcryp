/**
 * AUTOPILOT — one tap, one complete order, built from measured history.
 * ---------------------------------------------------------------------------
 * ─── THE PROBLEM WITH EVERY ORDER FORM, INCLUDING OURS ──────────────────────
 * We now have five order types, an advisor that proposes levels, and a
 * verdict engine that weighs four independent layers. That is a lot of power
 * and it is all pointed at somebody who has to know, before they start:
 *
 *   • which of five order types they want
 *   • whether to price it in the FROM token or the TO token
 *   • whether "above" or "below" expresses their intent
 *   • what number to put in the box
 *
 * The request was «کار باهاش ساده اما کارایی خیلی زیاد» — simple to use, very
 * powerful. Those pull in opposite directions unless something removes the
 * decisions rather than merely explaining them.
 *
 * This module removes them. The user answers ONE question — what am I trying
 * to do with this coin — and gets a complete, valid order with every field
 * filled from measurements, plus the evidence in plain language.
 *
 * ─── THREE GOALS, NOT THIRTY ────────────────────────────────────────────────
 * `protect`   — "I hold this and I don't want to give the gains back."
 * `takeProfit`— "I want to sell into strength, gradually."
 * `buyDip`    — "I want in, but not at this price."
 *
 * These are the three things people actually mean. Every additional option
 * would be a decision handed back to the user, which is the thing being
 * removed. If none of the three fits, the ordinary form is still there.
 *
 * ─── THE RULES, WHICH ARE THE WHOLE FILE ────────────────────────────────────
 * 1. NOTHING IS PREDICTED. Every number traces to a count or a measurement
 *    from data that already happened. Inherited from lib/orderAdvisor.js and
 *    non-negotiable, because this output becomes a real order on real money.
 *
 * 2. IT REFUSES MORE OFTEN THAN IT ANSWERS. Thin history, no tested level, or
 *    a reward smaller than the risk all return a refusal WITH a reason. A
 *    confident-looking order built on twelve days of data is worse than no
 *    feature at all.
 *
 * 3. IT NEVER SUBMITS. It returns a draft the user reviews and confirms. An
 *    app that places orders on its own has stopped being non-custodial in
 *    spirit even while remaining so technically.
 *
 * 4. IT NEVER TOUCHES `direction`/`priceOf` GUESSWORK. Those two fields cause
 *    the most expensive mistake on this screen — an order set to the exact
 *    opposite of the intent — so they are DERIVED from the goal, in one place,
 *    and tested.
 */

import { adviseOrder } from './orderAdvisor.js';
import { LADDER_MAX_STEPS, LADDER_MIN_STEPS, validateOrder } from './orders.js';

/** The three things a person actually wants. Exported so the UI cannot drift. */
export const GOALS = ['protect', 'takeProfit', 'buyDip'];

/**
 * Why a goal could not be turned into an order.
 *
 * Codes, not sentences — the UI translates them, and this app ships twelve
 * languages. Returning English here would make the refusal untranslatable,
 * which is the same mistake `validateOrder` already avoids.
 */
export const REFUSALS = {
  NO_HISTORY: 'NO_HISTORY',
  NO_LEVEL: 'NO_LEVEL',
  NO_VOLATILITY: 'NO_VOLATILITY',
  POOR_RATIO: 'POOR_RATIO',
  BAD_AMOUNT: 'BAD_AMOUNT'
};

/**
 * How each goal maps onto the mechanics.
 *
 * ─── WHY THIS IS A TABLE AND NOT AN `if` CHAIN ──────────────────────────────
 * `direction` and `priceOf` are the two fields that cause the worst bug this
 * screen can have: an order that fires at the opposite of what was meant. In
 * an `if` chain the mapping is scattered across three branches and a later
 * edit only has to miss one. As a table it is four lines that can be read at
 * once and asserted directly in a test.
 *
 * `priceOf: 'from'` throughout, because all three goals reason about the coin
 * the user is HOLDING or BUYING, priced in the stable side — which is how
 * people actually talk: "sell my BNB at 700", not "buy USDT at 0.0014".
 */
export const GOAL_SHAPE = {
  protect: { type: 'trailing', direction: null, priceOf: 'from' },
  takeProfit: { type: 'ladder', direction: 'above', priceOf: 'from' },
  buyDip: { type: 'ladder', direction: 'below', priceOf: 'from' }
};

/**
 * Build a complete order draft for a goal.
 *
 * @param {object} p
 * @param {'protect'|'takeProfit'|'buyDip'} p.goal
 * @param {number[]} p.series      price history, oldest first
 * @param {object}   p.fromToken   must carry a coingeckoId to be orderable
 * @param {object}   p.toToken
 * @param {string|number} p.amountIn
 * @param {number}   p.chainId
 *
 * @returns {{draft:object, why:object} | {refused:string, detail?:object}}
 *
 * The return is deliberately one shape or the other, never a draft with a
 * warning attached: a caller that forgets to check a warning flag would place
 * an order the module meant to refuse.
 */
export function buildAutopilot({ goal, series, fromToken, toToken, amountIn, chainId }) {
  if (!GOALS.includes(goal)) return { refused: REFUSALS.NO_HISTORY };

  const amount = Number(amountIn);
  if (!Number.isFinite(amount) || amount <= 0) return { refused: REFUSALS.BAD_AMOUNT };

  const advice = adviseOrder(series);
  if (!advice.ready) {
    return {
      refused: REFUSALS.NO_HISTORY,
      detail: { samples: advice.samples, need: advice.minSamples }
    };
  }

  const shape = GOAL_SHAPE[goal];
  const base = {
    type: shape.type,
    chainId,
    fromToken,
    toToken,
    amountIn: String(amountIn),
    priceOf: shape.priceOf
  };

  /* ---------------------------------------------------------------- protect */
  if (goal === 'protect') {
    const trail = advice.trailing;
    /*
     * No volatility measurement means no honest trail distance. Falling back
     * to a round 10% would be inventing the one number the whole order turns
     * on — see the flat-series bug in orderAdvisor.js, which produced a
     * confident 0.5% from a typical move of exactly zero.
     */
    if (!trail) return { refused: REFUSALS.NO_VOLATILITY };

    const draft = { ...base, trailPct: trail.pct };
    const err = validateOrder(draft);
    if (err) return { refused: err };

    return {
      draft,
      why: {
        goal,
        headline: 'protect',
        /*
         * The evidence, as numbers the UI states verbatim. Passing the counts
         * rather than a rendered sentence keeps this module free of English
         * and lets each locale phrase it naturally.
         */
        values: {
          trailPct: trail.pct,
          typicalMovePct: trail.evidence.typicalMovePct,
          maxDrawdownPct: trail.evidence.maxDrawdownPct,
          samples: advice.samples
        }
      }
    };
  }

  /* ------------------------------------------------------------ takeProfit */
  if (goal === 'takeProfit') {
    const lad = advice.ladder;
    /*
     * The ladder suggestion needs a resistance with a real record. Without one
     * there is nowhere evidence-backed to sell into, and inventing "current
     * price +10%" would place rungs at prices nothing supports — they simply
     * never fill, and the user believes they have a plan.
     */
    if (!lad) return { refused: REFUSALS.NO_LEVEL };

    const draft = {
      ...base,
      steps: lad.steps,
      startRate: lad.startRate,
      endRate: lad.endRate,
      direction: shape.direction
    };
    const err = validateOrder(draft);
    if (err) return { refused: err };

    return {
      draft,
      why: {
        goal,
        headline: 'takeProfit',
        values: {
          steps: lad.steps,
          start: lad.startRate,
          end: lad.endRate,
          held: lad.evidence.resistanceHeld,
          tested: lad.evidence.resistanceTested,
          samples: advice.samples
        }
      }
    };
  }

  /* ---------------------------------------------------------------- buyDip */
  /*
   * Buying the dip is a ladder DOWNWARD from the current price to the nearest
   * well-tested support. The bracket suggestion already located that support
   * and placed a level beneath it, so it is reused rather than recomputed —
   * two independent derivations of "where is support" would eventually
   * disagree, and the user would see one number in the panel and another in
   * the order.
   */
  const br = advice.bracket;
  if (!br) return { refused: REFUSALS.NO_LEVEL };

  const start = advice.price;
  const end = br.stopLoss;
  if (!(start > end)) return { refused: REFUSALS.NO_LEVEL };

  const spanPct = ((start - end) / start) * 100;
  /* Under ~2% the rungs sit inside the spread and it is not a ladder. */
  if (spanPct < 2) return { refused: REFUSALS.NO_LEVEL };

  const steps = Math.min(LADDER_MAX_STEPS, Math.max(LADDER_MIN_STEPS, Math.round(spanPct / 3)));

  const draft = { ...base, steps, startRate: start, endRate: end, direction: shape.direction };
  const err = validateOrder(draft);
  if (err) return { refused: err };

  return {
    draft,
    why: {
      goal,
      headline: 'buyDip',
      values: {
        steps,
        start,
        end,
        held: br.evidence.supportHeld,
        tested: br.evidence.supportTested,
        samples: advice.samples
      }
    }
  };
}

/**
 * A one-line, non-technical summary of what the draft will do.
 *
 * Returns a translation KEY plus values, never a sentence. The UI renders it;
 * this module stays language-free.
 */
export function summariseDraft(result) {
  if (!result || result.refused) return null;
  return { key: `autopilot.summary.${result.why.headline}`, values: result.why.values };
}
