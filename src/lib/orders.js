/**
 * LIMIT ORDERS & DCA
 * ---------------------------------------------------------------------------
 * Two features, one engine: a stored intent plus a condition that decides when
 * it is ready to execute.
 *
 *   LIMIT — "swap when 1 BNB is worth at least 700 USDT"
 *   DCA   — "swap $50 of USDT into BTC every week"
 *
 * ─── THE HONEST DESIGN CONSTRAINT ───────────────────────────────────────────
 * A real limit order on a centralised exchange fills while you sleep, because
 * the exchange holds your funds and can move them. We are non-custodial: the
 * server has no key and can never sign for a user. That is the whole security
 * model and it is not negotiable.
 *
 * The alternatives were:
 *
 *   1. Custody the funds. Then we can fill automatically — and we become a
 *      money services business, need licences, and one breach loses everyone's
 *      money. This is the thing the entire app is built to avoid.
 *
 *   2. Ask the user to pre-approve an allowance and let a server-side bot
 *      pull the tokens. Slightly better, but an unlimited allowance to an
 *      address we control is functionally custody with extra steps: if our
 *      key leaks, every user who ever set an order is drained.
 *
 *   3. Store the intent locally, watch the price, and ask the user to confirm
 *      when the condition is met.
 *
 * We do (3). It means an order only fills when the user is reachable, which is
 * a genuine limitation and is stated plainly in the UI — a "limit order" that
 * silently does not fill is worse than no feature, because the user believes
 * they have a position they do not have.
 *
 * What makes it still worth building:
 *   • The notification fires even when the app is closed (web push / FCM).
 *   • The swap is one tap from the notification, at the price they asked for.
 *   • Every fill is a fee-bearing swap that would otherwise not have happened.
 *
 * ─── WHY THIS FILE HAS NO NETWORK CODE ──────────────────────────────────────
 * Pure functions only: create, validate, evaluate, schedule. Storage and price
 * fetching live at the edges. That keeps the part that decides whether real
 * money moves fully unit-testable, which is where the bugs would be expensive.
 */

import { apiBase } from './apiBase.js';

const STORAGE_KEY = 'fbt-orders-v1';

/** Hard ceiling on stored orders — a runaway loop must not fill localStorage. */
export const MAX_ORDERS = 50;

/**
 * ─── THE ORDER TYPES, AND WHY THESE ONES ────────────────────────────────────
 * `bracket` and `ladder` were added because they are the two things a serious
 * trader does that this app could not express, and both are *combinations* of
 * a condition we already evaluate correctly rather than new machinery:
 *
 *   bracket (OCO) — "sell if it reaches 800, OR if it falls to 600, whichever
 *     comes first." Take-profit and stop-loss as ONE order. Setting them as
 *     two separate limit orders is the trap it replaces: both stay live, so a
 *     volatile day can fill BOTH and leave the user having sold twice.
 *
 *   ladder — "sell a quarter at 700, a quarter at 750, a quarter at 800..."
 *     Scaling out of a position in steps. Nobody picks the exact top, and a
 *     ladder is what people actually mean by "take profit gradually".
 *
 * Both are honest to build here: each is decided by comparing a live price to
 * a number, which is exactly what `evaluateOrder` already does, so neither
 * requires custody or any new trust assumption.
 */
export const ORDER_TYPES = ['limit', 'dca', 'trailing', 'bracket', 'ladder', 'twap', 'rebalance'];

/**
 * How many rungs a ladder may have.
 *
 * Two is the minimum for it to be a ladder rather than a limit order. Eight is
 * a practical ceiling: each rung is a separate notification and a separate
 * signed swap, and past that the gas and the interruption cost more than the
 * averaging gains.
 */
/**
 * Order types the SERVER can watch while the app is closed.
 *
 * Exported and shared, because this set is applied in two places — the sync
 * itself and the React key that decides when to re-sync — and the pair was
 * already out of step once. Two copies of the same intent is how a trailing
 * stop ends up mirrored by one filter and ignored by the other.
 *
 * ─── DCA AND TWAP JOINED, AND THIS IS THE REPORTED BUG ─────────────────────
 * «برای سفارش خودکار … وقتی زمان سواپ فرا برسه باید سریع متوجه بشه اما
 *  نمیرسه به گوشی.»
 *
 * They used to be excluded here on privacy grounds, which was a real argument
 * that lost to a harder one: a plan whose run is due while the phone is in a
 * pocket has nobody to notice it. The device is asleep, its timers are frozen
 * by Android, and the one machine that is awake — the server — had never been
 * told the schedule existed. So the plan is mirrored, and the payload holds
 * the least that can possibly be enough:
 *
 *   sent:      the pair SYMBOLS, the next due time, the interval, runs left
 *   never sent: the amount, the wallet, the price target (a DCA has none)
 *
 * See server/watch.js for the storage-side note. The client stays the source
 * of truth for the schedule: every sync replaces the server's copy, so a
 * paused or edited plan cannot keep alerting on the old times.
 */
export const WATCHED_TYPES = new Set(['limit', 'trailing', 'bracket', 'ladder', 'rebalance', 'dca', 'twap']);

/** The types whose trigger is the clock rather than a rate. */
export const SCHEDULED_TYPES = new Set(['dca', 'twap']);

/** TWAP: how many slices, and how long the window may be. */
export const TWAP_MIN_SLICES = 2;
export const TWAP_MAX_SLICES = 24;
export const TWAP_MIN_WINDOW_MIN = 15;
export const TWAP_MAX_WINDOW_MIN = 7 * 24 * 60;

/** Rebalance: drift from the last balanced rate, in percent. */
export const REBALANCE_MIN_DRIFT = 2;
export const REBALANCE_MAX_DRIFT = 50;

export const LADDER_MIN_STEPS = 2;
export const LADDER_MAX_STEPS = 8;
export const DCA_INTERVALS = { daily: 86400000, weekly: 604800000, monthly: 2592000000 };

/**
 * LIMIT ORDER EXPIRY OPTIONS — how long a limit order stays active.
 *
 * Three options cover the common cases without overwhelming the form:
 *   1 hour   — scalping a quick move, or testing the waters
 *   24 hours — the standard "today" order
 *   7 days   — patient positioning
 *
 * Longer than 7 days is deliberately absent: a limit set at a price the market
 * left behind weeks ago is not a plan, it is litter that fires at the worst
 * possible moment if the price ever wanders back. The user can always create
 * a new one.
 *
 * Values in milliseconds, keyed by a short tag the UI translates.
 */
export const LIMIT_EXPIRY_OPTIONS = {
  '1h': 3600000,
  '24h': 86400000,
  '7d': 604800000
};

/**
 * Trailing stop distance, in percent, clamped to a sane band.
 *
 * Below ~0.5% ordinary spread noise triggers it constantly; above 50% it is
 * not a stop in any meaningful sense. Rejecting outside the band is better
 * than clamping, because a user who typed 90 meant something we cannot
 * honestly deliver and should be told.
 */
export const TRAIL_MIN_PCT = 0.5;
export const TRAIL_MAX_PCT = 50;

/* -------------------------------------------------------------------------- */
/* creation & validation                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Validate an order before it is stored.
 *
 * Returns an error CODE, not a message: the UI translates it. Returning
 * English here would make the error untranslatable in the twelve languages
 * this app ships.
 */
export function validateOrder(o) {
  if (!o || !ORDER_TYPES.includes(o.type)) return 'BAD_TYPE';
  if (!o.chainId || !Number.isInteger(Number(o.chainId))) return 'BAD_CHAIN';
  if (!o.fromToken?.symbol || !o.toToken?.symbol) return 'BAD_TOKENS';
  if (o.fromToken.symbol === o.toToken.symbol) return 'SAME_TOKEN';

  const amount = Number(o.amountIn);
  if (!Number.isFinite(amount) || amount <= 0) return 'BAD_AMOUNT';

  if (o.type === 'bracket') {
    const tp = Number(o.takeProfitRate);
    const sl = Number(o.stopLossRate);
    if (!Number.isFinite(tp) || tp <= 0) return 'BAD_TARGET';
    if (!Number.isFinite(sl) || sl <= 0) return 'BAD_STOP';
    /*
     * The take-profit must sit ABOVE the stop. Inverted, the two conditions
     * overlap and the order is already "triggered" on both sides the moment it
     * is created — it would fire instantly at whatever the current price is,
     * which is the exact opposite of protecting a position.
     */
    if (tp <= sl) return 'BRACKET_INVERTED';
  }

  if (o.type === 'ladder') {
    const steps = Number(o.steps);
    if (!Number.isInteger(steps) || steps < LADDER_MIN_STEPS || steps > LADDER_MAX_STEPS) {
      return 'BAD_STEPS';
    }
    const start = Number(o.startRate);
    const end = Number(o.endRate);
    if (!Number.isFinite(start) || start <= 0) return 'BAD_TARGET';
    if (!Number.isFinite(end) || end <= 0) return 'BAD_TARGET';
    /*
     * A ladder with start === end is `steps` copies of the same limit order.
     * Rejecting rather than collapsing it: the user meant a range and typed
     * something that is not one, and silently turning it into a single price
     * would fill their whole position at once.
     */
    if (start === end) return 'LADDER_FLAT';
    if (o.direction !== 'above' && o.direction !== 'below') return 'BAD_DIRECTION';
  }

  if (o.type === 'limit') {
    const target = Number(o.targetRate);
    if (!Number.isFinite(target) || target <= 0) return 'BAD_TARGET';
    // A direction is required. Without it "target 700" is ambiguous — fill
    // above or below? — and guessing would fill at the wrong time.
    if (o.direction !== 'above' && o.direction !== 'below') return 'BAD_DIRECTION';
    // Which token the target price is quoted in. Must be one of the pair.
    if (o.priceOf && o.priceOf !== 'from' && o.priceOf !== 'to') return 'BAD_PRICE_OF';
  }

  if (o.type === 'trailing') {
    const pct = Number(o.trailPct);
    if (!Number.isFinite(pct) || pct < TRAIL_MIN_PCT || pct > TRAIL_MAX_PCT) return 'BAD_TRAIL';
    if (o.priceOf && o.priceOf !== 'from' && o.priceOf !== 'to') return 'BAD_PRICE_OF';
  }

  if (o.type === 'dca') {
    if (!DCA_INTERVALS[o.interval]) return 'BAD_INTERVAL';
    const total = Number(o.totalRuns);
    // An open-ended DCA cannot be honestly described ("until when?") and a
    // forgotten one keeps prompting forever.
    if (!Number.isInteger(total) || total < 1 || total > 365) return 'BAD_RUNS';
  }

  if (o.type === 'twap') {
    const slices = Number(o.slices);
    if (!Number.isInteger(slices) || slices < TWAP_MIN_SLICES || slices > TWAP_MAX_SLICES) {
      return 'BAD_SLICES';
    }
    const windowMin = Number(o.windowMin);
    if (!Number.isFinite(windowMin) || windowMin < TWAP_MIN_WINDOW_MIN || windowMin > TWAP_MAX_WINDOW_MIN) {
      return 'BAD_WINDOW';
    }
  }

  if (o.type === 'rebalance') {
    const target = Number(o.targetRate);
    const drift = Number(o.driftPct);
    if (!Number.isFinite(target) || target <= 0) return 'BAD_TARGET';
    if (!Number.isFinite(drift) || drift < REBALANCE_MIN_DRIFT || drift > REBALANCE_MAX_DRIFT) {
      return 'BAD_DRIFT';
    }
    if (o.priceOf && o.priceOf !== 'from' && o.priceOf !== 'to') return 'BAD_PRICE_OF';
  }

  return null;
}

let seq = 0;
function makeId() {
  seq += 1;
  const rand =
    typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID().slice(0, 8)
      : Math.random().toString(36).slice(2, 10);
  return `o_${Date.now().toString(36)}_${seq}_${rand}`;
}

/** Build a stored order. Returns { order } or { error }. */
export function createOrder(input, now = Date.now()) {
  const err = validateOrder(input);
  if (err) return { error: err };

  const base = {
    id: makeId(),
    type: input.type,
    chainId: Number(input.chainId),
    fromToken: input.fromToken,
    toToken: input.toToken,
    amountIn: String(input.amountIn),
    createdAt: now,
    status: input.type === 'dca' ? 'paused' : 'active',
    // A DCA is a reviewable local draft until the user explicitly signs it.
    runsDone: 0,
    lastNotifiedAt: 0,
    ...(input.type === 'dca' && input.goalId ? { goalId: input.goalId } : {})
  };

  if (input.type === 'limit') {
    return {
      order: {
        ...base,
        targetRate: Number(input.targetRate),
        direction: input.direction,
        /*
         * WHICH TOKEN THE TARGET IS PRICED IN.
         *
         * 'from' (default) — "1 FROM is worth N TO", the natural way to think
         *   about selling: "sell my BNB when it reaches 700 USDT".
         *
         * 'to' — "1 TO is worth N FROM", the natural way to think about
         *   buying: "buy BNB when BNB costs 700 USDT" with USDT as the input.
         *
         * Without this, a buy order forced the user to enter the RECIPROCAL:
         * to buy BNB above 700 they had to type 0.00142857 and pick "below",
         * because as BNB rises the USDT→BNB rate falls. Nobody can use that,
         * and anyone who tried would set the opposite of what they meant.
         */
        priceOf: input.priceOf === 'to' ? 'to' : 'from',
        /*
         * EXPIRY — how long the order stays active.
         *
         * The new Level 1 form offers three fixed options (1h, 24h, 7d) via
         * `expiryKey`. The legacy `expiryDays` field is still accepted for
         * backward compatibility with existing stored orders.
         */
        expiryKey: LIMIT_EXPIRY_OPTIONS[input.expiryKey] ? input.expiryKey : null,
        expiresAt: LIMIT_EXPIRY_OPTIONS[input.expiryKey]
          ? now + LIMIT_EXPIRY_OPTIONS[input.expiryKey]
          : now + (Number(input.expiryDays) || 30) * 86400000,
        /*
         * FEE CAP — the maximum platform fee in basis points the user accepts.
         *
         * The standard fee is 50 bps (0.5%). A cap lets the user say "I will
         * not pay more than X bps" and the order stays pending if the quoted
         * fee exceeds it. Null means "accept the standard fee" (the common
         * case). Stored so the UI can show the cap on the order row.
         */
        ...(Number.isFinite(Number(input.maxFeeBps)) && Number(input.maxFeeBps) >= 0
          ? { maxFeeBps: Number(input.maxFeeBps) }
          : {})
      }
    };
  }

  if (input.type === 'bracket') {
    return {
      order: {
        ...base,
        takeProfitRate: Number(input.takeProfitRate),
        stopLossRate: Number(input.stopLossRate),
        priceOf: input.priceOf === 'to' ? 'to' : 'from',
        expiresAt: now + (Number(input.expiryDays) || 30) * 86400000
      }
    };
  }

  if (input.type === 'ladder') {
    const steps = Number(input.steps);
    return {
      order: {
        ...base,
        steps,
        startRate: Number(input.startRate),
        endRate: Number(input.endRate),
        direction: input.direction,
        priceOf: input.priceOf === 'to' ? 'to' : 'from',
        /*
         * Which rungs have already been taken, as a count. A count rather than
         * a list of booleans because rungs always fill in price order: for an
         * `above` ladder, reaching rung 3 means 1 and 2 were passed on the way.
         */
        rungsFilled: 0,
        totalRuns: steps,
        expiresAt: now + (Number(input.expiryDays) || 30) * 86400000
      }
    };
  }

  if (input.type === 'twap') {
    const slices = Number(input.slices);
    const windowMin = Number(input.windowMin);
    return {
      order: {
        ...base,
        slices,
        windowMin,
        totalRuns: slices,
        sliceGapMs: (windowMin * 60_000) / slices,
        nextRunAt: now
      }
    };
  }

  if (input.type === 'rebalance') {
    return {
      order: {
        ...base,
        targetRate: Number(input.targetRate),
        driftPct: Number(input.driftPct),
        priceOf: input.priceOf === 'to' ? 'to' : 'from',
        expiresAt: now + (Number(input.expiryDays) || 30) * 86400000
      }
    };
  }

  if (input.type === 'trailing') {
    return {
      order: {
        ...base,
        trailPct: Number(input.trailPct),
        priceOf: input.priceOf === 'to' ? 'to' : 'from',
        /*
         * The high-water mark. Null until the first price is seen, rather than
         * 0: seeding it at 0 would make the very first observation look like a
         * huge rise, and seeding it at the creation-time price would require a
         * price fetch inside a pure function.
         */
        peakRate: null,
        expiresAt: now + (Number(input.expiryDays) || 30) * 86400000
      }
    };
  }

  return {
    order: {
      ...base,
      interval: input.interval,
      totalRuns: Number(input.totalRuns),
      nextRunAt: now // the first buy is due immediately
    }
  };
}

/* -------------------------------------------------------------------------- */
/* evaluation                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * The price of every rung in a ladder, evenly spaced from start to end.
 *
 * Inclusive of BOTH ends: a 4-step ladder from 700 to 800 is
 * [700, 733.33, 766.67, 800], not [700, 725, 750, 775]. The user named two
 * prices and expects to trade at both of them — excluding the end silently
 * means the target they cared most about never fills.
 *
 * Always returned in FILL ORDER, which is not the same as numeric order: a
 * `below` ladder buying the dip fills from the highest price downward. Sorting
 * numerically here would make rung 1 the last one to be reached and the whole
 * ladder would appear frozen.
 */
export function ladderRungs(order) {
  const steps = Number(order?.steps);
  const start = Number(order?.startRate);
  const end = Number(order?.endRate);
  if (!Number.isInteger(steps) || steps < LADDER_MIN_STEPS || steps > LADDER_MAX_STEPS) return [];
  if (!Number.isFinite(start) || !Number.isFinite(end)) return [];

  const gap = (end - start) / (steps - 1);
  const rungs = [];
  for (let i = 0; i < steps; i += 1) rungs.push(start + gap * i);

  /*
   * Fill order. `above` = selling into strength, so ascending. `below` =
   * buying weakness, so descending. Derived from the direction rather than
   * from whether start < end, because a user may enter the range either way
   * round and both readings are legitimate.
   */
  const ascending = order.direction === 'above';
  rungs.sort((a, b) => (ascending ? a - b : b - a));
  return rungs;
}

/**
 * How much of the total amount each rung trades.
 *
 * Equal split, with the REMAINDER ON THE LAST RUNG so the parts always sum to
 * exactly the amount the user entered. Rounding each rung independently is how
 * a 3-step ladder on 100 tokens ends up trading 99.99 and stranding a dust
 * balance the user has to clean up by hand.
 */
export function ladderPortion(order, rungIndex) {
  const total = Number(order?.amountIn);
  const steps = Number(order?.steps);
  if (!Number.isFinite(total) || total <= 0) return null;
  if (!Number.isInteger(steps) || steps < 1) return null;
  const i = Number(rungIndex);
  if (!Number.isInteger(i) || i < 0 || i >= steps) return null;

  const each = total / steps;
  if (i < steps - 1) return each;
  return total - each * (steps - 1);
}

/**
 * Is this order ready to execute?
 *
 * @param {object} order
 * @param {number|null} rate  current price of fromToken denominated in toToken
 * @returns {{ready:boolean, reason:string}}
 */
export function evaluateOrder(order, rate, now = Date.now()) {
  if (!order || order.status !== 'active') return { ready: false, reason: 'INACTIVE' };

  if (order.type === 'limit') {
    if (order.expiresAt && now >= order.expiresAt) return { ready: false, reason: 'EXPIRED' };
    // No price means we do not know, which is NOT the same as "not ready".
    // Treating an unknown price as "condition met" would fire orders during
    // an outage at whatever price happened to exist.
    if (!Number.isFinite(rate) || rate <= 0) return { ready: false, reason: 'NO_PRICE' };

    /*
     * `rate` always arrives as "1 FROM = ? TO". When the user priced the
     * target in the TO token instead, invert the observed rate so both sides
     * of the comparison are in the same unit. Inverting the RATE (not the
     * target) keeps the user's number exactly as they typed it, so the UI can
     * echo it back unchanged.
     */
    const observed = order.priceOf === 'to' ? 1 / rate : rate;
    if (!Number.isFinite(observed) || observed <= 0) return { ready: false, reason: 'NO_PRICE' };

    const hit = order.direction === 'above' ? observed >= order.targetRate : observed <= order.targetRate;
    return { ready: hit, reason: hit ? 'TARGET_HIT' : 'WAITING' };
  }

  /*
   * BRACKET (OCO) — take-profit and stop-loss as one order.
   *
   * Reports WHICH side fired, because the two mean opposite things to the
   * user: `TAKE_PROFIT` is the good outcome and `STOP_LOSS` is the protective
   * one, and a notification that cannot tell them apart is close to useless.
   *
   * Take-profit is checked FIRST. If a single price tick somehow satisfies
   * both — possible when the two are close and the feed jumps — filling at the
   * profitable side is the outcome that favours the user, and picking
   * deterministically means the same tick can never produce two different
   * results on two devices.
   */
  if (order.type === 'bracket') {
    if (order.expiresAt && now >= order.expiresAt) return { ready: false, reason: 'EXPIRED' };
    if (!Number.isFinite(rate) || rate <= 0) return { ready: false, reason: 'NO_PRICE' };

    const observed = order.priceOf === 'to' ? 1 / rate : rate;
    if (!Number.isFinite(observed) || observed <= 0) return { ready: false, reason: 'NO_PRICE' };

    if (observed >= order.takeProfitRate) {
      return { ready: true, reason: 'TAKE_PROFIT', side: 'takeProfit', rate: observed };
    }
    if (observed <= order.stopLossRate) {
      return { ready: true, reason: 'STOP_LOSS', side: 'stopLoss', rate: observed };
    }
    return { ready: false, reason: 'WAITING' };
  }

  /*
   * LADDER — sell (or buy) in steps across a price range.
   *
   * Only the NEXT unfilled rung is ever evaluated. Checking all of them would
   * let one large price jump report several rungs ready at once, and the user
   * would get a burst of notifications for a position they can only sell
   * once per signature.
   */
  if (order.type === 'ladder') {
    if (order.expiresAt && now >= order.expiresAt) return { ready: false, reason: 'EXPIRED' };
    if (order.rungsFilled >= order.steps) return { ready: false, reason: 'COMPLETE' };
    if (!Number.isFinite(rate) || rate <= 0) return { ready: false, reason: 'NO_PRICE' };

    const observed = order.priceOf === 'to' ? 1 / rate : rate;
    if (!Number.isFinite(observed) || observed <= 0) return { ready: false, reason: 'NO_PRICE' };

    const target = ladderRungs(order)[order.rungsFilled];
    if (!Number.isFinite(target)) return { ready: false, reason: 'WAITING' };

    const hit = order.direction === 'above' ? observed >= target : observed <= target;
    return {
      ready: hit,
      reason: hit ? 'RUNG_HIT' : 'WAITING',
      rung: order.rungsFilled + 1,
      ofRungs: order.steps,
      target
    };
  }

  /*
   * TRAILING STOP.
   *
   * Follows the price up and sells only after it falls `trailPct` from the
   * best level seen. This is the order people actually want when they say "let
   * it run but don't give the gains back" — a fixed limit either sells too
   * early or never.
   *
   * Two rules that matter:
   *
   *  1. The peak only ever RISES. If a price feed hiccups and returns a low
   *     value, the peak must not follow it down, or the stop would drift
   *     downward and never trigger.
   *
   *  2. An unknown price does nothing at all — it neither updates the peak nor
   *     triggers. Same reasoning as the limit branch: firing on a missing
   *     price sells at whatever number happened to exist during an outage.
   *
   * Pure: returns the new peak for the caller to persist rather than mutating.
   */
  if (order.type === 'trailing') {
    if (order.expiresAt && now >= order.expiresAt) return { ready: false, reason: 'EXPIRED' };
    if (!Number.isFinite(rate) || rate <= 0) return { ready: false, reason: 'NO_PRICE' };

    const observed = order.priceOf === 'to' ? 1 / rate : rate;
    if (!Number.isFinite(observed) || observed <= 0) return { ready: false, reason: 'NO_PRICE' };

    const prevPeak = Number.isFinite(order.peakRate) && order.peakRate > 0 ? order.peakRate : null;
    const peak = prevPeak === null ? observed : Math.max(prevPeak, observed);
    const stopAt = peak * (1 - order.trailPct / 100);

    // On the very first observation there is no drawdown yet by definition,
    // so a stop can never fire on the same tick that establishes the peak.
    const hit = prevPeak !== null && observed <= stopAt;

    return {
      ready: hit,
      reason: hit ? 'TRAIL_HIT' : 'WAITING',
      peak,
      stopAt
    };
  }

  /*
   * TWAP — time-weighted average price. Same honesty constraint as DCA: we
   * cannot sign, so each slice is an alert. The difference is the schedule:
   * N equal slices across a window the user named, not a calendar interval.
   */
  if (order.type === 'twap') {
    if (order.runsDone >= order.totalRuns) return { ready: false, reason: 'COMPLETE' };
    const due = now >= (order.nextRunAt ?? 0);
    return { ready: due, reason: due ? 'DUE' : 'WAITING' };
  }

  /*
   * REBALANCE — fire when the pair has drifted `driftPct` from the rate the
   * user called balanced. Unknown price never fires (same as every other
   * price-triggered type).
   */
  if (order.type === 'rebalance') {
    if (order.expiresAt && now >= order.expiresAt) return { ready: false, reason: 'EXPIRED' };
    if (!Number.isFinite(rate) || rate <= 0) return { ready: false, reason: 'NO_PRICE' };
    const observed = order.priceOf === 'to' ? 1 / rate : rate;
    if (!Number.isFinite(observed) || observed <= 0) return { ready: false, reason: 'NO_PRICE' };
    const target = Number(order.targetRate);
    if (!Number.isFinite(target) || target <= 0) return { ready: false, reason: 'WAITING' };
    const drift = (Math.abs(observed - target) / target) * 100;
    const hit = drift >= order.driftPct;
    return { ready: hit, reason: hit ? 'DRIFT_HIT' : 'WAITING', drift, observed };
  }

  // DCA is time-based, so a missing price does not block it: the user asked to
  // buy on a schedule regardless of price. That is the point of DCA.
  if (order.runsDone >= order.totalRuns) return { ready: false, reason: 'COMPLETE' };
  const due = now >= (order.nextRunAt ?? 0);
  return { ready: due, reason: due ? 'DUE' : 'WAITING' };
}

/* -------------------------------------------------------------------------- */
/* LEVEL 1 LIMIT — quotation-checked readiness                                */
/* -------------------------------------------------------------------------- */

/**
 * Compute the minimum output amount for a limit order, given the input amount
 * and the target rate.
 *
 * This is the FLOOR the user expects: "if I swap X at my target rate, I should
 * get at least Y out." The quotation must meet or exceed this, or the order
 * stays pending — even if the price condition itself is met.
 *
 * ─── ROUNDING ────────────────────────────────────────────────────────────────
 * The result is rounded UP (ceiling) to the token's precision, so the user
 * always gets AT LEAST what they asked for, never a fraction less due to
 * floating-point drift. For USDC (6 decimals) this means the 7th decimal is
 * always rounded up; for ETH (18 decimals) the 19th.
 *
 * @param {object} order
 * @param {number} amountIn  the input amount (in human units, e.g. 1.5 BNB)
 * @param {number} toDecimals  decimals of the output token
 * @returns {number|null}  minimum output in human units, or null if invalid
 */
export function computeMinAmountOut(order, amountIn, toDecimals) {
  if (!order || order.type !== 'limit') return null;
  const amount = Number(amountIn);
  const target = Number(order.targetRate);
  const decimals = Number(toDecimals);
  if (!Number.isFinite(amount) || amount <= 0) return null;
  if (!Number.isFinite(target) || target <= 0) return null;
  if (!Number.isInteger(decimals) || decimals < 0) return null;

  /*
   * The target rate is "1 FROM = target TO" (when priceOf === 'from') or
   * "1 TO = target FROM" (when priceOf === 'to'). In the latter case, the
   * output per unit of input is the RECIPROCAL: if 1 USDT = 0.0014 BNB,
   * then swapping 100 USDT yields 100 * 0.0014 = 0.14 BNB.
   */
  const ratePerUnit = order.priceOf === 'to' ? 1 / target : target;
  if (!Number.isFinite(ratePerUnit) || ratePerUnit <= 0) return null;

  const raw = amount * ratePerUnit;
  /*
   * CEILING at the token's precision. `Math.ceil` on the scaled value ensures
   * the user never receives less than the target, even by a dust amount. For
   * a 1.5 BNB → USDT swap at target 700, raw = 1050.0; with 6 decimals the
   * scaled value is 1050000000, ceiling is 1050000000, back to 1050.000000.
   * For 0.1 ETH → USDC at target 3500, raw = 350.0; scaled = 350000000,
   * ceiling = 350000000, back to 350.000000.
   */
  const scale = 10 ** decimals;
  const scaled = Math.ceil(raw * scale);
  return scaled / scale;
}

/**
 * Evaluate a limit order with a real quotation, not just a price tick.
 *
 * ─── WHY THIS EXISTS ─────────────────────────────────────────────────────────
 * `evaluateOrder` checks whether the MARKET RATE has reached the target. That
 * is necessary but not sufficient: the actual swap goes through an aggregator
 * (KyberSwap, OpenOcean, LI.FI) which may quote a WORSE rate than the market
 * mid-price due to slippage, thin liquidity, or fees. A limit order that fires
 * on a price tick but fills at a worse rate is the exact failure the user set
 * the limit to avoid.
 *
 * This function takes the quotation result from `getQuote` (or the Solana
 * equivalent) and compares the ACTUAL output against the minimum the user
 * expects. Only if the quotation meets the floor does the order become `ready`.
 *
 * ─── THE THREE OUTCOMES ──────────────────────────────────────────────────────
 *   1. `ready: true` — price condition met AND quotation ≥ minAmountOut.
 *      The swap can be prepared with `minAmountOut` as the slippage floor.
 *   2. `ready: false, reason: 'QUOTE_BELOW_LIMIT'` — price condition met but
 *      quotation < minAmountOut. The order stays pending; the user is told why.
 *   3. `ready: false, reason: 'QUOTE_UNAVAILABLE'` — quotation failed (network,
 *      rate-limit, no route). The order is marked `unavailable` with the error;
 *      it is NOT marked ready, because a missing quote is not a fill.
 *
 * ─── NO AUTOMATIC EXECUTION ──────────────────────────────────────────────────
 * This function returns a STATUS, not a transaction. The UI shows the user a
 * "Swap now" button; the click handler builds and signs the transaction. The
 * server never signs anything. This is the non-custodial guarantee.
 *
 * @param {object} order  the stored limit order
 * @param {number|null} rate  current market rate (from price feed)
 * @param {object|null} quote  result from getQuote: { amountOut, minOut, ... }
 * @param {number} now  timestamp
 * @returns {{ ready: boolean, reason: string, minAmountOut?: number, quoteOut?: number }}
 */
export function evaluateLimitWithQuote(order, rate, quote, now = Date.now()) {
  if (!order || order.type !== 'limit') {
    return { ready: false, reason: 'NOT_LIMIT' };
  }
  if (order.status !== 'active') {
    return { ready: false, reason: 'INACTIVE' };
  }
  if (order.expiresAt && now >= order.expiresAt) {
    return { ready: false, reason: 'EXPIRED' };
  }

  /*
   * Step 1: check the price condition. If the market rate has not reached the
   * target, the order is still waiting — no need to fetch a quotation.
   */
  const baseEval = evaluateOrder(order, rate, now);
  if (!baseEval.ready) {
    return baseEval;
  }

  /*
   * Step 2: the price condition is met. Now check the quotation.
   *
   * A null or missing quote means the aggregator failed — network error,
   * rate-limit, no route, or the token is not supported. This is NOT the same
   * as "quotation below limit": the user's order is fine, but we cannot tell
   * whether it would fill. Marking it `ready` would be dishonest: the swap
   * button would open a screen that immediately errors.
   */
  if (!quote || !Number.isFinite(Number(quote.amountOut))) {
    return {
      ready: false,
      reason: 'QUOTE_UNAVAILABLE',
      quoteError: quote?.error || 'NO_QUOTE'
    };
  }

  /*
   * Step 3: compute the minimum output the user expects, and compare.
   *
   * `quote.amountOut` is the ACTUAL output the aggregator quoted, in human
   * units (e.g. 1050.123456 USDT). `minAmountOut` is the floor computed from
   * the target rate and the input amount. If the quote meets the floor, the
   * order is ready.
   *
   * The comparison uses the QUOTE's output, not the quote's `minOut` (which
   * is the aggregator's own slippage floor and may be lower than the user's
   * limit). The user's limit is the hard floor.
   */
  const quoteOut = Number(quote.amountOut);
  const toDecimals = Number(order.toToken?.decimals ?? 18);
  const minAmountOut = computeMinAmountOut(order, Number(order.amountIn), toDecimals);
  if (minAmountOut === null) {
    return { ready: false, reason: 'BAD_ORDER' };
  }

  if (quoteOut >= minAmountOut) {
    return {
      ready: true,
      reason: 'QUOTE_READY',
      minAmountOut,
      quoteOut
    };
  }

  /*
   * The quotation is below the limit. The order stays pending, and the reason
   * is stored so the UI can explain why: "Price condition met, but the actual
   * swap would yield 1048.50 USDT, which is below your limit of 1050."
   */
  return {
    ready: false,
    reason: 'QUOTE_BELOW_LIMIT',
    minAmountOut,
    quoteOut
  };
}

/* -------------------------------------------------------------------------- */
/* LEVEL 2 — quotation floors for trailing and bracket orders                  */
/* -------------------------------------------------------------------------- */

/**
 * Trailing stop with a quotation floor.
 *
 * The rule itself (peak, stopAt, WAITING / TRAIL_HIT) is `evaluateOrder`'s and
 * is not repeated here. What this adds is the same honesty check the limit
 * order gets: a stop that armed on a price tick but whose real quotation pays
 * less than the stop price stays pending, with the reason recorded.
 *
 * The floor is `stopAt` — the price the trailing rule just armed. The result
 * keeps `peak` and `stopAt` from the base evaluation so the caller can persist
 * the high-water mark exactly as it does without a quotation.
 */
export function evaluateTrailingWithQuote(order, rate, quote, now = Date.now()) {
  if (!order || order.type !== 'trailing') return { ready: false, reason: 'NOT_TRAILING' };
  const base = evaluateOrder(order, rate, now);
  if (!base.ready) return base;

  if (!quote || !Number.isFinite(Number(quote.amountOut))) {
    return { ...base, ready: false, reason: 'QUOTE_UNAVAILABLE', quoteError: quote?.error || 'NO_QUOTE' };
  }

  const minAmountOut = computeMinAmountOut(
    { type: 'limit', targetRate: base.stopAt, priceOf: order.priceOf },
    Number(order.amountIn),
    Number(order.toToken?.decimals ?? 18)
  );
  if (minAmountOut === null) return { ...base, ready: false, reason: 'BAD_ORDER' };

  const quoteOut = Number(quote.amountOut);
  if (quoteOut >= minAmountOut) {
    return { ...base, ready: true, reason: 'QUOTE_READY', minAmountOut, quoteOut };
  }
  return { ...base, ready: false, reason: 'QUOTE_BELOW_LIMIT', minAmountOut, quoteOut };
}

/**
 * Bracket (OCO) with a quotation floor.
 *
 * The floor depends on WHICH side fired: take-profit is held to the
 * take-profit rate, stop-loss to the stop-loss rate. `side` is kept on the
 * result so the notification and the history can say which one it was.
 *
 * ⚠ Known trade-off, stated in the design doc: a stop-loss whose real quote is
 * below the stop rate stays pending under this rule. That protects the user
 * from a bad fill, but it also means the exit can be held back in a fast move.
 */
export function evaluateBracketWithQuote(order, rate, quote, now = Date.now()) {
  if (!order || order.type !== 'bracket') return { ready: false, reason: 'NOT_BRACKET' };
  const base = evaluateOrder(order, rate, now);
  if (!base.ready) return base;

  if (!quote || !Number.isFinite(Number(quote.amountOut))) {
    return { ...base, ready: false, reason: 'QUOTE_UNAVAILABLE', quoteError: quote?.error || 'NO_QUOTE' };
  }

  const targetRate = base.side === 'takeProfit' ? order.takeProfitRate : order.stopLossRate;
  const minAmountOut = computeMinAmountOut(
    { type: 'limit', targetRate, priceOf: order.priceOf },
    Number(order.amountIn),
    Number(order.toToken?.decimals ?? 18)
  );
  if (minAmountOut === null) return { ...base, ready: false, reason: 'BAD_ORDER' };

  const quoteOut = Number(quote.amountOut);
  if (quoteOut >= minAmountOut) {
    return { ...base, ready: true, reason: 'QUOTE_READY', minAmountOut, quoteOut, side: base.side };
  }
  return { ...base, ready: false, reason: 'QUOTE_BELOW_LIMIT', minAmountOut, quoteOut, side: base.side };
}

/** Types whose notification waits for a real quotation. Others keep the price-only rule. */
export const QUOTE_CHECKED_TYPES = new Set(['limit', 'trailing', 'bracket']);

/** Route to the quotation-aware evaluator for a type. Other types ignore the quote. */
export function evaluateOrderWithQuote(order, rate, quote, now = Date.now()) {
  switch (order?.type) {
    case 'limit':
      return evaluateLimitWithQuote(order, rate, quote, now);
    case 'trailing':
      return evaluateTrailingWithQuote(order, rate, quote, now);
    case 'bracket':
      return evaluateBracketWithQuote(order, rate, quote, now);
    default:
      return evaluateOrder(order, rate, now);
  }
}

/**
 * Decide whether an order should notify the user right now.
 *
 * Two gates, in order:
 *   1. The price condition (`evaluateOrder`). If it is not met, no quotation
 *      is requested at all — quotes cost an API call each.
 *   2. For QUOTE_CHECKED_TYPES, a real quotation must meet the floor. Only
 *      `QUOTE_READY` sets `notify: true`. A quotation that is below the floor
 *      or failed does not notify.
 *
 * `fetchQuote(order)` is injected so the decision is testable without a
 * network. A throwing fetch is treated as "no quote", never as ready.
 *
 * @returns {Promise<{ready:boolean, reason:string, notify:boolean, needsQuote:boolean,
 *   minAmountOut?:number, quoteOut?:number, quoteSource?:string|null, side?:string}>}
 */
export async function evaluateForNotification(order, rate, fetchQuote, now = Date.now()) {
  const price = evaluateOrder(order, rate, now);
  if (!QUOTE_CHECKED_TYPES.has(order?.type)) {
    return { ...price, notify: price.ready === true, needsQuote: false, quoteSource: null };
  }
  if (!price.ready) {
    return { ...price, notify: false, needsQuote: false, quoteSource: null };
  }

  let quote = null;
  try {
    quote = await fetchQuote(order);
  } catch {
    quote = null;
  }
  const res = evaluateOrderWithQuote(order, rate, quote, now);
  return {
    ...res,
    notify: res.ready === true && res.reason === 'QUOTE_READY',
    needsQuote: true,
    quoteSource: quote?.selectedSolver ?? quote?.source ?? null
  };
}

/**
 * Throttle for quotation requests, one per order at a time.
 *
 * The watcher effect runs on every price tick. Without this gate a limit whose
 * price has been met for an hour would request a quotation hundreds of times.
 * At most one request is in flight per order, and after each check the order
 * waits `minIntervalMs` before the next one.
 */
export const QUOTE_RECHECK_MS = 30_000;

export function createQuoteGate({ minIntervalMs = QUOTE_RECHECK_MS } = {}) {
  const inFlight = new Set();
  const lastAt = new Map();
  return {
    canStart(id, now = Date.now()) {
      return !inFlight.has(id) && now - (lastAt.get(id) ?? -Infinity) >= minIntervalMs;
    },
    start(id) {
      inFlight.add(id);
    },
    finish(id, now = Date.now()) {
      inFlight.delete(id);
      lastAt.set(id, now);
    }
  };
}

/**
 * The quotation an order was last judged ready on, stored on the order.
 *
 * This is what the history later shows as "fill details". It is NOT a receipt.
 * The app has no transaction watcher, so the only real evidence is the quote
 * the watcher saw at the moment the order became ready.
 */
export const READY_QUOTE_MAX_AGE_MS = 10 * 60_000;

export function readyQuoteFields(outcome, now = Date.now()) {
  return {
    readyQuoteAt: now,
    readyQuoteOut: Number.isFinite(Number(outcome?.quoteOut)) ? Number(outcome.quoteOut) : null,
    readyMinOut: Number.isFinite(Number(outcome?.minAmountOut)) ? Number(outcome.minAmountOut) : null,
    readyQuoteSource: outcome?.quoteSource ?? null,
    readyQuoteSide: outcome?.side ?? null
  };
}

/**
 * Fill details to record when the user hands an order off to Swap.
 *
 * Returns null when there is no ready quotation, or it is older than
 * READY_QUOTE_MAX_AGE_MS. A stale quotation would describe a price the market
 * may no longer offer, so it is better to record nothing.
 */
export function fillFromReadyQuote(order, now = Date.now()) {
  if (!order || !Number.isFinite(order.readyQuoteAt)) return null;
  if (now - order.readyQuoteAt > READY_QUOTE_MAX_AGE_MS) return null;
  const amountIn = Number(order.amountIn);
  const out = Number(order.readyQuoteOut);
  if (!Number.isFinite(out) || !(amountIn > 0)) return null;
  return {
    rate: out / amountIn,
    amountOut: out,
    minAmountOut: Number.isFinite(Number(order.readyMinOut)) ? Number(order.readyMinOut) : null,
    source: order.readyQuoteSource ?? null,
    side: order.readyQuoteSide ?? null
  };
}

/* -------------------------------------------------------------------------- */
/* advance                                                                    */
/* -------------------------------------------------------------------------- */

const finiteOrNull = (v) => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/** The fill fields stored on a filled order. Unknown values are null, never 0. */
export function fillDetailsFields(fill) {
  return {
    filledRate: finiteOrNull(fill?.rate),
    filledAmountOut: finiteOrNull(fill?.amountOut),
    filledMinAmountOut: finiteOrNull(fill?.minAmountOut),
    filledQuoteSource: typeof fill?.source === 'string' ? fill.source : null,
    filledSide: typeof fill?.side === 'string' ? fill.side : null
  };
}

/**
 * Advance an order after a successful fill.
 * Pure: returns the next state rather than mutating.
 *
 * Accepts both call shapes so existing callers keep working:
 *   advanceOrder(order)                 — hand-off with no details
 *   advanceOrder(order, now)            — legacy: second argument is a timestamp
 *   advanceOrder(order, fill, now)      — with fill details from fillFromReadyQuote
 */
export function advanceOrder(order, fillOrNow = null, maybeNow = undefined) {
  let fill = null;
  let now = Date.now();
  if (typeof fillOrNow === 'number') {
    now = fillOrNow;
  } else {
    fill = fillOrNow;
    if (typeof maybeNow === 'number') now = maybeNow;
  }

  if (order.type === 'limit' || order.type === 'trailing' || order.type === 'rebalance') {
    return { ...order, status: 'filled', filledAt: now, runsDone: 1, ...fillDetailsFields(fill) };
  }

  /*
   * A bracket is DONE once either side fires — that is the whole point of
   * "one cancels the other". Leaving it active after a stop-loss would let the
   * take-profit fire later on the same position the user has already exited.
   */
  if (order.type === 'bracket') {
    return { ...order, status: 'filled', filledAt: now, runsDone: 1, ...fillDetailsFields(fill) };
  }

  /*
   * A ladder advances one rung at a time and only completes on the last one.
   * Marking it filled early would abandon the remaining position silently,
   * which is worse than not offering the order type at all.
   */
  if (order.type === 'ladder') {
    const rungsFilled = (order.rungsFilled ?? 0) + 1;
    const done = rungsFilled >= order.steps;
    return {
      ...order,
      rungsFilled,
      runsDone: rungsFilled,
      status: done ? 'filled' : 'active',
      filledAt: done ? now : undefined,
      /*
       * Clear the cooldown so the NEXT rung can alert as soon as it is hit.
       * Without this a fast move through two rungs would silence the second
       * for six hours — the user would fill one quarter and believe the rest
       * of the ladder was still waiting when it had already been passed.
       */
      lastNotifiedAt: 0
    };
  }
  const runsDone = order.runsDone + 1;
  const done = runsDone >= order.totalRuns;
  const gap =
    order.type === 'twap'
      ? Number(order.sliceGapMs) || (Number(order.windowMin) * 60000) / (Number(order.slices) || 1)
      : DCA_INTERVALS[order.interval];
  return {
    ...order,
    runsDone,
    status: done ? 'filled' : 'active',
    filledAt: done ? now : undefined,
    // Schedule from NOW, not from the previous due time. Scheduling from the
    // due time means a user who was offline for a week comes back to seven
    // overdue buys firing at once.
    nextRunAt: done ? undefined : now + gap
  };
}

/** Mark expiry so the list can show why an order stopped, rather than hiding it. */
export function expireStale(orders, now = Date.now()) {
  return orders.map((o) =>
    o.status === 'active' && o.expiresAt && now >= o.expiresAt
      ? { ...o, status: 'expired' }
      : o
  );
}

/* -------------------------------------------------------------------------- */
/* pause / resume                                                             */
/* -------------------------------------------------------------------------- */

/**
 * Pause an order without deleting it.
 *
 * Before this the only way to stop an alert was to delete it, which threw away
 * the settings — so a user riding out a volatile week had to rebuild the order
 * afterwards, and most simply would not. A paused DCA also must not silently
 * accumulate missed runs, so resume reschedules from NOW for the same reason
 * advanceOrder does.
 */
export function pauseOrder(order) {
  if (!order || order.status !== 'active') return order;
  return { ...order, status: 'paused' };
}

export function resumeOrder(order, now = Date.now()) {
  if (!order || order.status !== 'paused') return order;
  const next = { ...order, status: 'active' };
  if (order.type === 'dca' || order.type === 'twap') next.nextRunAt = now;
  /*
   * Reset the trailing peak on resume. Keeping a peak from before the pause
   * would compare today's price against a high that may be weeks stale and
   * trigger an immediate sell the instant the order is re-enabled.
   */
  if (order.type === 'trailing') next.peakRate = null;
  /*
   * A ladder keeps its filled rungs across a pause. Resetting them would
   * re-sell portions the user has already sold — the one mistake in this file
   * that would cost real money rather than a missed alert.
   */
  return next;
}

/**
 * Should we notify about this order right now?
 *
 * Rate-limited to once every 6 hours per order. Without this, an order sitting
 * exactly at its target would notify on every price poll — and a user who is
 * spammed turns off notifications entirely, which loses every future fill too.
 */
export const NOTIFY_COOLDOWN = 6 * 3600000;

export function shouldNotify(order, now = Date.now()) {
  return now - (order.lastNotifiedAt || 0) >= NOTIFY_COOLDOWN;
}

/* -------------------------------------------------------------------------- */
/* storage                                                                    */
/* -------------------------------------------------------------------------- */

export function loadOrders() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveOrders(orders) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(orders.slice(0, MAX_ORDERS)));
    return true;
  } catch {
    // Storage full or blocked (private mode). The caller keeps its in-memory
    // copy for this session rather than losing the user's input.
    return false;
  }
}

export function addOrder(order) {
  const orders = loadOrders();
  if (orders.filter((o) => o.status === 'active').length >= MAX_ORDERS) {
    return { error: 'TOO_MANY' };
  }
  const next = [order, ...orders];
  saveOrders(next);
  return { orders: next };
}

export function updateOrder(id, patch) {
  const next = loadOrders().map((o) => (o.id === id ? { ...o, ...patch } : o));
  saveOrders(next);
  return next;
}

export function removeOrder(id) {
  const next = loadOrders().filter((o) => o.id !== id);
  saveOrders(next);
  return next;
}

/* -------------------------------------------------------------------------- */
/* server-side watching                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Mirror the active LIMIT orders to the server so it can alert while the app
 * is closed.
 *
 * ─── WHAT DELIBERATELY DOES NOT GET SENT ────────────────────────────────────
 * No wallet address and no amount. The server needs neither to decide whether
 * a price was hit, and a watch list that names amounts is a shopping list for
 * anyone who breaches it — "this endpoint wants to sell 40 BNB at 700" has
 * real value to the wrong person. The notification says an order is ready; the
 * app fills in the details from local storage.
 *
 * DCA plans are not sent either. They are time-based, so the device can decide
 * on its own without the server learning the schedule.
 *
 * Best-effort: a failure here costs the background alert, not the order. The
 * in-app watcher still works, so this never surfaces an error.
 */
export async function syncWatches(orders) {
  try {
    /*
     * Ask for whichever push identity this device actually has. In a browser
     * that is a web-push endpoint; in the packaged Android app it is an FCM
     * token, because a Capacitor WebView has no Push API at all.
     *
     * This used to read pushManager directly, which meant every APK user
     * silently registered nothing and never received an order alert.
     */
    const { pushIdentity } = await import('./notify.js');
    const identity = await pushIdentity();
    // No push identity means there is nothing to notify, so there is no
    // reason to hand the server a watch list at all.
    if (!identity?.endpoint) return false;

    /*
     * ─── EVERY PRICE-TRIGGERED TYPE, NOT JUST `limit` ───────────────────────
     * This filtered `type === 'limit'`, so a TRAILING STOP was never mirrored
     * to the server and only ever fired while the app was open in the
     * foreground. That is precisely backwards: a trailing stop is the one
     * order nobody can watch by hand, because it needs a price checked
     * continuously to track the peak. Its whole reason to exist is to work
     * while you are not looking, and it did not.
     *
     * Brackets and ladders have the same property, so all four go up. DCA
     * stays local — it is time-based, the device already knows the schedule,
     * and sending it would hand the server a behavioural profile it does not
     * need.
     *
     * Each item carries the SHAPE the server needs to evaluate it. A trailing
     * stop's peak is tracked server-side from here on, because a peak that
     * only advances while the app is open is not a peak.
     */
    const items = orders
      .filter((o) => o.status === 'active' && WATCHED_TYPES.has(o.type))
      /*
       * A price-triggered row needs both coin ids, because that is how the
       * watcher prices it. A SCHEDULED row needs neither: its trigger is the
       * clock, and requiring an id would silently drop every DCA on a token
       * the market feed has not indexed — the exact plans most likely to run
       * unattended.
       */
      .filter((o) => SCHEDULED_TYPES.has(o.type)
        || (o.fromToken?.coingeckoId && o.toToken?.coingeckoId))
      .map((o) => {
        const base = {
          id: o.id,
          type: o.type,
          fromSym: o.fromToken.symbol,
          toSym: o.toToken.symbol,
          fromId: o.fromToken.coingeckoId || null,
          toId: o.toToken.coingeckoId || null,
          priceOf: o.priceOf ?? 'from'
        };
        /*
         * ─── THE CLOCK-DRIVEN SHAPES ────────────────────────────────────────
         * `nextRunAt` is the device's own number and the only trigger the
         * server compares against. `runsLeft` is optional and means "unknown"
         * when absent — the copy says «نوبت بعدی» rather than inventing a
         * final step. The interval is what the server advances by after a
         * delivered alert, so a phone that stays closed for a week does not
         * get the same run announced on every tick.
         */
        if (o.type === 'dca' || o.type === 'twap') {
          const intervalMs = o.type === 'twap'
            ? Number(o.sliceGapMs) || (Number(o.windowMin) * 60000) / (Number(o.slices) || 1)
            : DCA_INTERVALS[o.interval];
          const runsLeft = Number.isFinite(Number(o.totalRuns)) && Number.isFinite(Number(o.runsDone))
            ? Math.max(0, Number(o.totalRuns) - Number(o.runsDone))
            : null;
          /*
           * A plan with nothing left to run is finished, whatever its `status`
           * field still says. Uploading it would give the server a due time in
           * the past and one last alert for a step that no longer exists — and
           * a notification about a run that already happened is worse than no
           * notification, because it teaches the user to distrust the rest.
           */
          if (runsLeft === 0) return null;
          return {
            ...base,
            /* A plan whose next run has not been stamped yet (older rows) is
               scheduled from NOW, which is what `advanceOrder` does on the
               first fill — the alternative is a `0`, which the validator
               rejects and the plan silently never syncs. */
            nextRunAt: Number(o.nextRunAt) > 0 ? Number(o.nextRunAt) : Date.now(),
            intervalMs: Number.isFinite(intervalMs) && intervalMs > 0 ? intervalMs : DCA_INTERVALS.daily,
            runsLeft
          };
        }
        if (o.type === 'limit') {
          return { ...base, targetRate: o.targetRate, direction: o.direction };
        }
        if (o.type === 'trailing') {
          return { ...base, trailPct: o.trailPct, peakRate: o.peakRate ?? null };
        }
        if (o.type === 'bracket') {
          return { ...base, takeProfitRate: o.takeProfitRate, stopLossRate: o.stopLossRate };
        }
        /* ladder — only the next unfilled rung matters to the watcher. */
        const rungs = ladderRungs(o);
        return {
          ...base,
          targetRate: rungs[o.rungsFilled ?? 0] ?? null,
          direction: o.direction,
          rung: (o.rungsFilled ?? 0) + 1,
          ofRungs: o.steps
        };
      })
      /*
       * ORDER MATTERS. The mapping above can return `null` (a finished plan
       * has no future run to announce), and the ladder filter below reads
       * `it.type` — so a null that survives to it throws, the outer catch
       * swallows the throw, and the ENTIRE watch list silently stops syncing
       * for that device. The runtime test in test/units.mjs is what caught it:
       * `.filter(Boolean)` has to come first.
       */
      .filter(Boolean)
      /* A ladder with every rung filled has no next target. Sending
         `targetRate: null` would be rejected by the server's validator and
         silently drop the whole batch's tail, so it is filtered here where the
         reason is visible. */
      .filter((it) => it.type !== 'ladder' || Number.isFinite(it.targetRate));

    await fetch(`${apiBase()}/orders/watch`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        endpoint: identity.endpoint,
        items,
        lang: document.documentElement.lang || 'fa'
      })
    });
    return true;
  } catch {
    /* Best-effort by design: a failed sync costs a background alert, never a
       visible error on the user's order screen. */
    return false;
  }
}

/*
 * `pingWatchTick` used to live here. It moved to lib/watchTick.js so the boot
 * path (App.jsx pings it on every open) does not have to load this engine —
 * see the header of that file. Re-exported because pages/Orders.jsx has
 * imported it from here since it was written, and a moved function is not a
 * reason to touch a money screen.
 */
export { pingWatchTick } from './watchTick.js';

/* -------------------------------------------------------------------------- */
/* value & fee estimation                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Estimate the notional USD value an order will trade when it fills.
 *
 * Used for two honest purposes: sorting the list by what matters, and showing
 * the user the size of the trade they are scheduling. A DCA plan reports the
 * value of ALL remaining runs, because "you are committing $600 over 6 weeks"
 * is the number a person needs before confirming, not "$100".
 *
 * Returns null rather than 0 when the price is unknown — 0 would render as a
 * confident "$0.00" next to a real order, and a wrong number about money is
 * worse than an absent one.
 */
export function orderNotionalUsd(order, priceMap) {
  const id = order?.fromToken?.coingeckoId;
  const unit = id && priceMap ? Number(priceMap[id]?.usd ?? priceMap[id]) : NaN;
  const amount = Number(order?.amountIn);
  if (!Number.isFinite(unit) || unit <= 0 || !Number.isFinite(amount) || amount <= 0) return null;

  const perRun = amount * unit;
  if (order.type !== 'dca' && order.type !== 'twap') return perRun;

  const remaining = Math.max(0, (Number(order.totalRuns) || 0) - (Number(order.runsDone) || 0));
  return perRun * remaining;
}

/**
 * Platform fee this order will generate, at the given rate in basis points.
 *
 * This is shown to the USER, not hidden: an order screen that quietly omits
 * the fee while the swap screen charges it is the same contradiction that had
 * to be fixed on the swap screen itself. Someone scheduling six DCA buys
 * should see the total cost of the plan before committing to it.
 */
export function orderFeeUsd(order, priceMap, feeBps) {
  const notional = orderNotionalUsd(order, priceMap);
  if (notional === null) return null;
  const bps = Number(feeBps);
  if (!Number.isFinite(bps) || bps < 0) return null;
  return (notional * bps) / 10000;
}

/** Aggregate pending fee across active orders. Skips unpriced ones. */
export function pipelineFeeUsd(orders, priceMap, feeBps) {
  return (orders || [])
    .filter((o) => o.status === 'active')
    .reduce((sum, o) => sum + (orderFeeUsd(o, priceMap, feeBps) ?? 0), 0);
}
