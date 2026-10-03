/**
 * SERVER-SIDE PRICE WATCHER
 * ---------------------------------------------------------------------------
 * Watches limit orders while the app is closed and sends one push when a
 * target is reached. The user still signs the swap themselves — this only
 * replaces "you have to keep the app open" with "your phone will tell you".
 *
 * ─── WHAT IS AND IS NOT STORED HERE ─────────────────────────────────────────
 * This is the part worth being careful about, because a watch list is a
 * behavioural profile: "this address wants to sell 40 BNB at 700" is exactly
 * what someone would pay for.
 *
 * Stored:  a push endpoint, a chain id, two token symbols, a target price,
 *          a direction, and a client-chosen id.
 * NOT stored: the wallet address, the amount, any key, any signature, or
 *          anything that could authorise a transaction.
 *
 * The amount stays on the device. The server does not need it to decide
 * whether a price was hit, and a server that cannot name an amount cannot
 * leak one. The notification says "your order is ready" and the app fills in
 * the details locally.
 *
 * ─── WHY IT CANNOT EXECUTE ──────────────────────────────────────────────────
 * There is deliberately no code path here that touches a signer, an allowance
 * or a router. Automating the fill would need either custody or a standing
 * allowance to an address we control, and both mean one leaked server key
 * drains every user who ever set an order. The whole app is built to avoid
 * that, and a revenue feature is not a reason to undo it.
 */

import { storeGet, storeSet } from './store.js';
import { fetchSimplePrices } from './providers.js';

const WATCH_KEY = 'orders:watch:v1';

/** Per-endpoint cap, so one device cannot fill the store. */
const MAX_PER_ENDPOINT = 50;
const MAX_TOTAL = 20000;

/** One alert per watch per 6h, mirroring the client's own cooldown. */
const COOLDOWN = 6 * 3600000;

/** Watches expire, so an abandoned device does not get polled forever. */
const MAX_AGE = 45 * 86400000;

/**
 * The order types this watcher can evaluate.
 *
 * ─── DCA AND TWAP ARE HERE NOW, AND THAT IS THE WHOLE FIX ───────────────────
 * Reported, and it is the reason this watcher exists at all:
 *
 *   «برای سفارش خودکار نوتیفیکیشن fcm و رسیدن روی موبایل کاربر خیلی مهمه چون
 *    وقتی زمان سواپ فرا برسه باید سریع متوجه بشه اما نمیرسه به گوشی.»
 *
 * A time-based plan (DCA — «هر هفته ۵۰ دلار بخر» — and TWAP, N slices across a
 * window) is decided by the CLOCK, not by a price. It used to be excluded here
 * on privacy grounds: sending a schedule tells the server when somebody buys.
 * That reasoning is sound and it lost to a harder fact — a schedule the phone
 * alone knows is a schedule that does not exist when the app is closed, which
 * is exactly when a DCA run has to alert. The phone is not awake; the server
 * is. So the schedule is mirrored, and the trade-off is stated rather than
 * hidden:
 *
 *   STORED:  the pair's SYMBOLS, the next due time, the interval, how many
 *            runs are left, and the push identity.
 *   NOT STORED: the wallet address, the amount, the price target, or anything
 *            that can authorise a transaction. The server cannot tell how much
 *            is being bought, only that a plan of this pair has a run due.
 *
 * `dca` and `twap` are therefore evaluated by `evaluateWatch` against the
 * clock, with no price lookup at all — which also means an upstream price
 * outage can never silence a scheduled alert.
 */
const WATCH_TYPES = new Set(['limit', 'trailing', 'bracket', 'ladder', 'rebalance', 'dca', 'twap']);

/** Types decided by the clock rather than by a rate. */
export const SCHEDULED_TYPES = new Set(['dca', 'twap']);

/**
 * Bounds on a mirrored interval, in ms.
 *
 * The floor is a minute rather than an hour because a TWAP window can be
 * fifteen minutes across twenty-four slices — a legitimate 37-second gap. The
 * ceiling is ninety days so a crafted request cannot park a row that is
 * evaluated forever. None of this is a trust boundary: a shorter interval than
 * the user's real one can only produce an EARLIER alert, and the six-hour
 * per-row cooldown below is what bounds the notification rate.
 */
const MIN_INTERVAL_MS = 60_000;
const MAX_INTERVAL_MS = 90 * 86400000;

const isId = (v) => typeof v === 'string' && v.length > 0 && v.length <= 64;
const isSym = (v) => typeof v === 'string' && /^[A-Za-z0-9._-]{1,16}$/.test(v);
const isCgId = (v) => typeof v === 'string' && /^[a-z0-9-]{1,64}$/.test(v);

export { parseIdentity };

export async function readWatches() {
  const rows = await storeGet(WATCH_KEY, []);
  return Array.isArray(rows) ? rows : [];
}

/**
 * Register (or replace) the watches for one push endpoint.
 *
 * Replace-all rather than append: the device is the source of truth for its
 * own orders, so a cancelled order disappears on the next sync instead of
 * needing a separate delete call that could be missed.
 */
/**
 * An identity is either a web-push endpoint (https://…) or a native FCM token
 * (fcm:…).
 *
 * Accepting both is what makes order alerts work in the packaged Android app:
 * a Capacitor WebView has no Push API, so an APK user has no https endpoint
 * and could never have registered a watch. Rejecting them here meant the
 * feature was quietly web-only.
 */
function parseIdentity(endpoint) {
  if (typeof endpoint !== 'string') return null;
  if (endpoint.startsWith('https://')) return { kind: 'web', value: endpoint };
  if (endpoint.startsWith('fcm:') && endpoint.length > 44) {
    return { kind: 'fcm', value: endpoint.slice(4) };
  }
  return null;
}

export async function putWatches(endpoint, items, lang = 'fa') {
  if (!parseIdentity(endpoint)) throw new Error('BAD_ENDPOINT');
  if (!Array.isArray(items)) throw new Error('BAD_ITEMS');

  const clean = [];
  for (const it of items.slice(0, MAX_PER_ENDPOINT)) {
    if (!isId(it?.id) || !isSym(it?.fromSym) || !isSym(it?.toSym)) continue;

    /*
     * CoinGecko ids are required for the PRICE-triggered types and optional for
     * the scheduled ones: a DCA plan on a token the market feed has never
     * heard of still has a due time, and refusing it would mean "you can only
     * schedule plans for coins CoinGecko lists" — a limitation nobody asked
     * for and nobody could see. The symbols are what the notification names.
     */
    const planned = it?.type === 'dca' || it?.type === 'twap';
    if (!isCgId(it?.fromId) && !planned) continue;
    if (!isCgId(it?.toId) && !planned) continue;

    /*
     * ─── FOUR WATCHABLE TYPES, NOT ONE ──────────────────────────────────────
     * This accepted only price-target rows, which is why trailing stops were
     * never watched while the app was closed — the one order type that cannot
     * be watched by hand.
     *
     * `type` defaults to 'limit' so watches written by an older client keep
     * working after this deploys. A stored row with no type is a limit order,
     * because that is the only kind the old client could send.
     */
    const type = it?.type ?? 'limit';
    if (!WATCH_TYPES.has(type)) continue;

    const row = {
      id: it.id,
      type,
      fromSym: it.fromSym,
      toSym: it.toSym,
      fromId: isCgId(it?.fromId) ? it.fromId : null,
      toId: isCgId(it?.toId) ? it.toId : null,
      priceOf: it.priceOf === 'to' ? 'to' : 'from',
      lastNotifiedAt: 0
    };

    /* ── the scheduled types: a due time, an interval, and how many are left ──
       `nextRunAt` is the client's own number. The server never invents one, so
       the alert fires when the plan says it should, not when a server-side
       counter thinks it should. */
    if (type === 'dca' || type === 'twap') {
      const nextRunAt = Number(it.nextRunAt);
      const intervalMs = Number(it.intervalMs);
      if (!Number.isFinite(nextRunAt) || nextRunAt <= 0) continue;
      if (!Number.isFinite(intervalMs) || intervalMs < MIN_INTERVAL_MS || intervalMs > MAX_INTERVAL_MS) continue;
      row.nextRunAt = Math.round(nextRunAt);
      row.intervalMs = Math.round(intervalMs);
      /* Null means "no known end", which the copy treats as "next run", never
         as "last run" — claiming a final step nobody stated would be a lie. */
      const runsLeft = Number(it.runsLeft);
      row.runsLeft = Number.isFinite(runsLeft) && runsLeft >= 0 ? Math.min(Math.round(runsLeft), 1000) : null;
      clean.push(row);
      continue;
    }

    if (type === 'limit' || type === 'ladder') {
      const target = Number(it.targetRate);
      if (!Number.isFinite(target) || target <= 0) continue;
      if (it.direction !== 'above' && it.direction !== 'below') continue;
      row.targetRate = target;
      row.direction = it.direction;
      if (type === 'ladder') {
        /* Purely cosmetic, for the "rung 2 of 4" line in the notification. */
        const rung = Number(it.rung);
        const ofRungs = Number(it.ofRungs);
        if (Number.isInteger(rung) && rung > 0) row.rung = rung;
        if (Number.isInteger(ofRungs) && ofRungs > 0) row.ofRungs = ofRungs;
      }
    } else if (type === 'rebalance') {
      const target = Number(it.targetRate);
      const drift = Number(it.driftPct);
      if (!Number.isFinite(target) || target <= 0) continue;
      if (!Number.isFinite(drift) || drift < 2 || drift > 50) continue;
      row.targetRate = target;
      row.driftPct = drift;
    } else if (type === 'trailing') {
      const pct = Number(it.trailPct);
      /*
       * Same band the client enforces. Re-checked rather than trusted: a
       * request can be crafted by hand, and a 0% trail would fire on every
       * tick while a 100% one can never fire at all.
       */
      if (!Number.isFinite(pct) || pct < 0.5 || pct > 50) continue;
      row.trailPct = pct;
      const peak = Number(it.peakRate);
      row.peakRate = Number.isFinite(peak) && peak > 0 ? peak : null;
    } else {
      const tp = Number(it.takeProfitRate);
      const sl = Number(it.stopLossRate);
      if (!Number.isFinite(tp) || tp <= 0) continue;
      if (!Number.isFinite(sl) || sl <= 0) continue;
      /* Inverted bracket triggers instantly on both sides — reject it. */
      if (tp <= sl) continue;
      row.takeProfitRate = tp;
      row.stopLossRate = sl;
    }

    clean.push(row);
  }

  const all = await readWatches();
  const others = all.filter((w) => w.endpoint !== endpoint);
  if (others.length >= MAX_TOTAL) return { stored: 0, full: true };

  // Carry over cooldown state so a resync does not re-alert immediately.
  const previous = new Map(all.filter((w) => w.endpoint === endpoint).map((w) => [w.id, w]));
  const next = clean.map((w) => ({
    ...w,
    endpoint,
    lang: String(lang).slice(0, 5),
    at: Date.now(),
    lastNotifiedAt: previous.get(w.id)?.lastNotifiedAt ?? 0
  }));

  await storeSet(WATCH_KEY, [...others, ...next]);
  return { stored: next.length };
}

export async function clearWatches(endpoint) {
  const all = await readWatches();
  const next = all.filter((w) => w.endpoint !== endpoint);
  await storeSet(WATCH_KEY, next);
  return { removed: all.length - next.length };
}

/**
 * Decide whether one watch has triggered.
 *
 * Mirrors `evaluateOrder` in src/lib/orders.js deliberately — the same
 * conditions have to mean the same thing on both sides, or the app and the
 * push notification disagree about whether an order is ready and the user
 * stops trusting both.
 *
 * Returns `{hit, at, side?, peak?}`. `peak` is returned rather than mutated so
 * the caller decides what to persist, the same shape the client uses.
 */
export function evaluateWatch(w, rate, now = Date.now()) {
  const type = w?.type ?? 'limit';

  /*
   * SCHEDULED (DCA / TWAP) — decided by the clock, BEFORE any price check.
   * Order matters: an upstream outage must not be able to silence a plan whose
   * run is due, and a missing rate is not "unknown" here — it is irrelevant.
   */
  if (type === 'dca' || type === 'twap') {
    const dueAt = Number(w?.nextRunAt);
    if (!Number.isFinite(dueAt) || dueAt <= 0) return { hit: false, reason: 'NO_SCHEDULE' };
    const hit = now >= dueAt;
    return { hit, at: dueAt, scheduled: true, reason: hit ? 'DUE' : 'WAITING' };
  }

  if (!Number.isFinite(rate) || rate <= 0) return { hit: false };

  if (type === 'trailing') {
    const prevPeak = Number.isFinite(w.peakRate) && w.peakRate > 0 ? w.peakRate : null;
    /* The peak only ever rises — a feed hiccup must not drag the stop down. */
    const peak = prevPeak === null ? rate : Math.max(prevPeak, rate);
    const stopAt = peak * (1 - w.trailPct / 100);
    /* Never fire on the tick that establishes the peak: there is no drawdown
       yet, by definition. */
    const hit = prevPeak !== null && rate <= stopAt;
    return { hit, at: stopAt, peak };
  }

  if (type === 'rebalance') {
    const target = Number(w.targetRate);
    if (!Number.isFinite(target) || target <= 0) return { hit: false };
    const drift = (Math.abs(rate - target) / target) * 100;
    return { hit: drift >= w.driftPct, at: rate };
  }

  if (type === 'bracket') {
    /* Take-profit first, for the same reason as the client: when one tick
       satisfies both, the profitable side is the one that favours the user,
       and a deterministic choice keeps every device in agreement. */
    if (rate >= w.takeProfitRate) return { hit: true, at: w.takeProfitRate, side: 'takeProfit' };
    if (rate <= w.stopLossRate) return { hit: true, at: w.stopLossRate, side: 'stopLoss' };
    return { hit: false };
  }

  /* limit and ladder share the plain target comparison. */
  const hit = w.direction === 'above' ? rate >= w.targetRate : rate <= w.targetRate;
  return { hit, at: w.targetRate };
}

/**
 * Check every watch and push for the ones that triggered.
 *
 * @param {(endpoint:string, lang:string, payload:object) => Promise<boolean>} send
 *        Injected so this module stays testable without a push provider — the
 *        part that decides whether to alert is the part worth testing.
 */
export async function runWatchCycle(send, now = Date.now()) {
  const all = await readWatches();
  if (!all.length) return { checked: 0, triggered: 0, sent: 0 };

  // Drop stale rows before doing any work.
  const live = all.filter((w) => now - (w.at || 0) < MAX_AGE);

  /*
   * One price request for every coin across every PRICE-triggered watch.
   * Scheduled rows are excluded from the lookup entirely — they need no rate,
   * and including their ids would cost a request for data nothing reads.
   */
  const priceRows = live.filter((w) => !SCHEDULED_TYPES.has(w.type ?? 'limit'));
  const ids = [...new Set(priceRows.flatMap((w) => [w.fromId, w.toId]).filter(isCgId))];
  let prices = {};
  let pricesOk = true;
  if (ids.length) {
    try {
      prices = await fetchSimplePrices(ids);
    } catch {
      /*
       * Upstream is down. Price-triggered rows are skipped below rather than
       * treated as hits — an unknown price must never count as "target hit",
       * or one outage fires every open order at once. Scheduled rows still run:
       * their trigger does not depend on the feed.
       */
      pricesOk = false;
    }
  }

  let triggered = 0;
  let sent = 0;
  const updated = [];

  for (const w of live) {
    const scheduled = SCHEDULED_TYPES.has(w.type ?? 'limit');

    let rate = null;
    if (!scheduled) {
      if (!pricesOk) { updated.push(w); continue; }
      const a = prices?.[w.fromId]?.usd;
      const b = prices?.[w.toId]?.usd;
      if (!Number.isFinite(a) || !Number.isFinite(b) || a <= 0 || b <= 0) {
        updated.push(w);
        continue;
      }
      // Same convention as the client: rate is "1 from = ? to", inverted when
      // the user priced the target in the TO token.
      rate = w.priceOf === 'to' ? b / a : a / b;
    }

    const res = evaluateWatch(w, rate, now);

    /*
     * The trailing peak is persisted even when nothing fires. That IS the
     * feature: a high-water mark that only advances while the app is open is
     * not a high-water mark, which is why trailing stops were broken in the
     * background before this.
     */
    let carried = w;
    if (res.peak != null && res.peak !== w.peakRate) carried = { ...w, peakRate: res.peak };

    if (!res.hit || now - (w.lastNotifiedAt || 0) < COOLDOWN) {
      updated.push(carried);
      continue;
    }

    triggered += 1;
    let ok = false;
    try {
      ok = await send(w.endpoint, w.lang, {
        // Deliberately vague about size — the server does not know the amount
        // and should not appear to.
        base: w.priceOf === 'to' ? w.toSym : w.fromSym,
        quote: w.priceOf === 'to' ? w.fromSym : w.toSym,
        /*
         * The price that actually triggered, which is not always a stored
         * target: a trailing stop fires at peak*(1-trail) and a bracket at
         * whichever of two levels was crossed.
         */
        rate: res.at,
        type: w.type ?? 'limit',
        /* `scheduled` is what tells the copy writer that the trigger was the
           clock, not a level: «زمان سواپ رسید» instead of «به هدف رسید». */
        scheduled: Boolean(scheduled),
        /* `takeProfit` vs `stopLoss` — opposite news, and the notification
           must not present them identically. */
        side: res.side ?? null,
        rung: w.rung ?? null,
        ofRungs: w.ofRungs ?? null,
        id: w.id
      });
    } catch {
      ok = false;
    }

    if (ok) sent += 1;

    /*
     * ─── AFTER A SCHEDULED ALERT, MOVE THE DUE TIME FORWARD ─────────────────
     * The device owns the schedule and re-syncs it on the next app open; this
     * server-side step exists so that a phone which stays closed for a week
     * does not get the SAME run alerted on every tick in between. The client's
     * own resync replaces this number wholesale, so the two cannot disagree:
     * the client's value always wins the moment it is sent again.
     *
     * Advanced on SUCCESS only — a failed push must never consume a run the
     * user was never told about. And when the last run has been announced the
     * row is DROPPED rather than parked: a finished plan that keeps its watch
     * alive is one more notification for a step that no longer exists.
     */
    let after = carried;
    if (ok && scheduled) {
      const gap = Number(w.intervalMs);
      let dueAt = Number(w.nextRunAt);
      let guard = 0;
      while (dueAt <= now && guard < 10_000) { dueAt += gap; guard += 1; }
      const left = w.runsLeft == null ? null : Math.max(0, w.runsLeft - 1);
      after = { ...carried, nextRunAt: dueAt, runsLeft: left };
      if (left === 0) continue; // finished: no row, no future alert
    }

    // Only start the cooldown on a successful send, otherwise a transient
    // push failure silences the alert for six hours.
    //
    // Built from `carried`, not `w`, so an advanced trailing peak is kept even
    // on the tick that fires. Rebuilding from `w` would discard it and let the
    // stop drift back down to a stale high-water mark.
    updated.push(ok ? { ...after, lastNotifiedAt: now } : after);
  }

  if (updated.length !== all.length || triggered > 0) {
    await storeSet(WATCH_KEY, updated);
  }
  return {
    checked: live.length,
    triggered,
    sent,
    scheduled: live.filter((w) => SCHEDULED_TYPES.has(w.type ?? 'limit')).length,
    priced: priceRows.length,
    pricesOk,
    pruned: all.length - live.length
  };
}

/* -------------------------------------------------------------------------- */
/* the throttle that makes this run often enough to be useful                  */
/* -------------------------------------------------------------------------- */

const TICK_KEY = 'orders:watch:lastTick';

/**
 * How often the watch cycle may be advanced by ANY trigger.
 *
 * ─── WHY THIS EXISTS AT ALL (the reported bug, in one line) ─────────────────
 * «وقتی زمان سواپ فرا برسه باید سریع متوجه بشه اما نمیرسه به گوشی.»
 *
 * The cycle was correct, the sender was correct, the channels and the custom
 * tone were correct — and the whole thing still could not arrive on time,
 * because on this hosting plan a cron may fire at most ONCE A DAY. A DCA run
 * due at nine in the morning was announced at nine the next morning at best.
 * A scheduled alert that is up to twenty-four hours late is not a late alert;
 * it is a wrong one, because the price the user was told about has moved.
 *
 * The plan forbids sub-daily Vercel crons (a ten-minute expression makes the
 * whole deployment fail — see docs/VERCEL-CRON-HOBBY-FA.md), so frequency has
 * to come from somewhere else. It comes from three places, in this order of
 * reliability:
 *
 *   1. A GitHub Actions schedule every five minutes hitting /api/cron/watch
 *      with the cron secret (see .github/workflows/order-watch-tick.yml).
 *      Runs whether or not anybody has the app open.
 *   2. THIS FUNCTION: any request the app already makes can advance the cycle,
 *      throttled to one run per window. It costs one store read on the hot
 *      path when it declines, and it means ordinary traffic keeps the clock
 *      ticking even if the workflow is ever disabled.
 *   3. The daily cron, unchanged, as the floor: if both of the above are down,
 *      nothing is silent for longer than a day.
 *
 * ─── WHY THE THROTTLE IS READ-THEN-WRITE, AND WHY THAT IS ACCEPTABLE ────────
 * The store is last-writer-wins (see store.js), so two serverless instances
 * can both read "stale" and both run a cycle. The consequence is a duplicated
 * price read and, in the worst case, two attempts at the same alert — which
 * the per-row cooldown collapses to one notification. Spending a lease (an
 * atomic store) on this would be the wrong trade: the failure mode of a lost
 * lease is a SILENT alert, and the failure mode here is one extra poll.
 */
export const WATCH_TICK_MIN_MS = Math.max(60_000, Number(process.env.WATCH_TICK_MIN_MS || 240_000));

/** In-process guard, so a burst of requests on one instance runs one cycle. */
let inFlight = null;

export async function watchTickStatus() {
  const last = Number(await storeGet(TICK_KEY, 0)) || 0;
  return { lastTickAt: last || null, minIntervalMs: WATCH_TICK_MIN_MS };
}

/**
 * Advance the watch cycle, if the window has passed.
 *
 * @param {{send?:Function, now?:number, force?:boolean}} opts
 *        `send` is required to deliver anything; without it this is a no-op
 *        that still reports honestly (see the wiring note on the daily cron,
 *        which shipped WITHOUT a sender once and silently dropped every alert).
 */
export async function maybeWatchTick({ send, now = Date.now(), force = false } = {}) {
  if (typeof send !== 'function') return { skipped: 'NO_SENDER' };

  const last = Number(await storeGet(TICK_KEY, 0)) || 0;
  const since = now - last;
  if (!force && since < WATCH_TICK_MIN_MS) return { skipped: 'THROTTLED', sinceMs: since };
  if (inFlight) return { skipped: 'IN_FLIGHT' };

  /* No watches means no work and no price request — the cheapest possible
     answer for the overwhelming majority of requests that reach here. */
  const rows = await readWatches().catch(() => []);
  if (!rows.length) {
    await storeSet(TICK_KEY, now).catch(() => {});
    return { skipped: 'NO_WATCHES', at: now };
  }

  inFlight = runWatchCycle(send, now)
    .then((out) => { return out; })
    .catch((err) => ({ error: String(err?.message || err).slice(0, 120) }))
    .finally(() => {
      inFlight = null;
      /* The stamp is written AFTER the run, so a crash mid-cycle does not lock
         the window and silence the next few minutes of traffic. */
      storeSet(TICK_KEY, Date.now()).catch(() => {});
    });

  const out = await inFlight;
  return { ...out, at: now };
}
