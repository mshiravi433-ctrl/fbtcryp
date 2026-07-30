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

    const target = Number(it.targetRate);
    if (!Number.isFinite(target) || target <= 0) continue;
    if (it.direction !== 'above' && it.direction !== 'below') continue;

    clean.push({
      id: it.id,
      fromSym: it.fromSym,
      toSym: it.toSym,
      fromId: it.fromId,
      toId: it.toId,
      targetRate: target,
      direction: it.direction,
      priceOf: it.priceOf === 'to' ? 'to' : 'from',
      lastNotifiedAt: 0
    });
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
    const hit = w.direction === 'above' ? rate >= w.targetRate : rate <= w.targetRate;

    if (!hit || now - (w.lastNotifiedAt || 0) < COOLDOWN) {
      updated.push(w);
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
        rate: w.targetRate,
        id: w.id
      });
    } catch {
      ok = false;
    }

    if (ok) sent += 1;
    // Only start the cooldown on a successful send, otherwise a transient
    // push failure silences the alert for six hours.
    updated.push(ok ? { ...w, lastNotifiedAt: now } : w);
  }

  if (updated.length !== all.length || triggered > 0) {
    await storeSet(WATCH_KEY, updated);
  }
  return { checked: live.length, triggered, sent, pruned: all.length - live.length };
}
