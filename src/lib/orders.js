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

const STORAGE_KEY = 'fbt-orders-v1';

/** Hard ceiling on stored orders — a runaway loop must not fill localStorage. */
export const MAX_ORDERS = 50;

export const ORDER_TYPES = ['limit', 'dca', 'trailing'];
export const DCA_INTERVALS = { daily: 86400000, weekly: 604800000, monthly: 2592000000 };

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
    status: 'active',
    runsDone: 0,
    lastNotifiedAt: 0
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
        // Limit orders expire. An order set at a price the market left behind
        // a year ago is not a plan, it is litter that fires at the worst
        // possible moment if the price ever wanders back.
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

  // DCA is time-based, so a missing price does not block it: the user asked to
  // buy on a schedule regardless of price. That is the point of DCA.
  if (order.runsDone >= order.totalRuns) return { ready: false, reason: 'COMPLETE' };
  const due = now >= (order.nextRunAt ?? 0);
  return { ready: due, reason: due ? 'DUE' : 'WAITING' };
}

/**
 * Advance an order after a successful fill.
 * Pure: returns the next state rather than mutating.
 */
export function advanceOrder(order, now = Date.now()) {
  if (order.type === 'limit' || order.type === 'trailing') {
    return { ...order, status: 'filled', filledAt: now, runsDone: 1 };
  }
  const runsDone = order.runsDone + 1;
  const done = runsDone >= order.totalRuns;
  return {
    ...order,
    runsDone,
    status: done ? 'filled' : 'active',
    filledAt: done ? now : undefined,
    // Schedule from NOW, not from the previous due time. Scheduling from the
    // due time means a user who was offline for a week comes back to seven
    // overdue buys firing at once.
    nextRunAt: done ? undefined : now + DCA_INTERVALS[order.interval]
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
  if (order.type === 'dca') next.nextRunAt = now;
  /*
   * Reset the trailing peak on resume. Keeping a peak from before the pause
   * would compare today's price against a high that may be weeks stale and
   * trigger an immediate sell the instant the order is re-enabled.
   */
  if (order.type === 'trailing') next.peakRate = null;
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

const API_BASE = (typeof import.meta !== 'undefined' && import.meta.env?.VITE_API_BASE) || '/api';

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

    const items = orders
      .filter((o) => o.status === 'active' && o.type === 'limit')
      .filter((o) => o.fromToken?.coingeckoId && o.toToken?.coingeckoId)
      .map((o) => ({
        id: o.id,
        fromSym: o.fromToken.symbol,
        toSym: o.toToken.symbol,
        fromId: o.fromToken.coingeckoId,
        toId: o.toToken.coingeckoId,
        targetRate: o.targetRate,
        direction: o.direction,
        priceOf: o.priceOf ?? 'from'
      }));

    await fetch(`${API_BASE}/orders/watch`, {
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
    return false;
  }
}

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
  if (order.type !== 'dca') return perRun;

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
