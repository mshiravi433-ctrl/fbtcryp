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

/** The order types this watcher can evaluate. DCA is time-based and stays on
 *  the device, which also keeps the user's schedule off our servers. */
const WATCH_TYPES = new Set(['limit', 'trailing', 'bracket', 'ladder']);

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
    if (!isCgId(it?.fromId) || !isCgId(it?.toId)) continue;

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
      fromId: it.fromId,
      toId: it.toId,
      priceOf: it.priceOf === 'to' ? 'to' : 'from',
      lastNotifiedAt: 0
    };

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
export function evaluateWatch(w, rate) {
  if (!Number.isFinite(rate) || rate <= 0) return { hit: false };
  const type = w?.type ?? 'limit';

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

  // One price request for every coin across every watch.
  const ids = [...new Set(live.flatMap((w) => [w.fromId, w.toId]))];
  let prices = {};
  try {
    prices = await fetchSimplePrices(ids);
  } catch {
    /*
     * Upstream is down. Return without alerting: an unknown price must never
     * count as "target hit", or one outage fires every open order at once.
     */
    return { checked: live.length, triggered: 0, sent: 0, error: 'PRICES_UNAVAILABLE' };
  }

  let triggered = 0;
  let sent = 0;
  const updated = [];

  for (const w of live) {
    const a = prices?.[w.fromId]?.usd;
    const b = prices?.[w.toId]?.usd;
    if (!Number.isFinite(a) || !Number.isFinite(b) || a <= 0 || b <= 0) {
      updated.push(w);
      continue;
    }

    // Same convention as the client: rate is "1 from = ? to", inverted when
    // the user priced the target in the TO token.
    const rate = w.priceOf === 'to' ? b / a : a / b;

    const res = evaluateWatch(w, rate);

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
    // Only start the cooldown on a successful send, otherwise a transient
    // push failure silences the alert for six hours.
    //
    // Built from `carried`, not `w`, so an advanced trailing peak is kept even
    // on the tick that fires. Rebuilding from `w` would discard it and let the
    // stop drift back down to a stale high-water mark.
    updated.push(ok ? { ...carried, lastNotifiedAt: now } : carried);
  }

  if (updated.length !== all.length || triggered > 0) {
    await storeSet(WATCH_KEY, updated);
  }
  return { checked: live.length, triggered, sent, pruned: all.length - live.length };
}
