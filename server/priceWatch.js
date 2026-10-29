/**
 * SERVER-SIDE TOKEN PRICE / P&L WATCHER
 * ---------------------------------------------------------------------------
 * THE GAP THIS CLOSES (reported): «بالا و پایین رفتن سود و ضرر توکن ها» alerts
 * appear on the app page but NEVER in the phone's notification bar while the
 * app is closed or the screen is locked.
 *
 * That report was accurate. The favourite-coin price alerts and the top-mover
 * alerts (src/lib/priceAlerts.js) were CLIENT-ONLY: they fired from the Market
 * page's polling loop and could only ever reach someone already looking at the
 * app. Their own header said so («WHY IT CANNOT RUN IN THE BACKGROUND»). The
 * server had push channels (server/push.js + server/fcm.js) and a price
 * watcher for ORDER targets (server/watch.js) — but nothing watched the price
 * MOVES of tracked coins, so no amount of FCM configuration could make those
 * alerts arrive on a locked phone. There was nothing to send.
 *
 * This module is the server twin of src/lib/priceAlerts.js, evaluated on the
 * SAME throttled tick as the order watcher (every app open, the 5-minute
 * GitHub tick, and the daily cron floor) and delivered through the SAME
 * transport (`send` → deliverStagePush → FCM for the APK, VAPID for the web).
 * The cards are identical on every surface because they come from the same
 * design system (src/lib/notificationDesign.js) with the same tags
 * (`fbt-price-<id>` / `fbt-mover-<id>`), so a phone shade row and the in-app
 * bar are one notification, not two competing copies.
 *
 * PRIVACY — identical to server/watch.js and the smart-money watchlist:
 *   STORED:     the push identity (web endpoint or fcm: token), coin SYMBOL
 *               ids, the alert threshold, per-coin baselines/cursors, lang.
 *   NOT STORED: the wallet address, balances, amounts, or anything that can
 *               authorise a transaction. A price watch cannot move money.
 *
 * ─── THE HONESTY RULES TRAVEL WITH THE FEATURE ─────────────────────────────
 * The client-side evaluator refused to alert from bad data (offline snapshot,
 * stale baseline, impossible jumps). A server evaluator has the same duty:
 *
 *   1. A MISSING price is silence, never a trigger and never a new baseline.
 *      One upstream outage must not fire every watch at once — or erase the
 *      reference points the next real move is measured against.
 *   2. A baseline unseen for more than STALE_BASELINE_MS is re-armed silently:
 *      «از آخرین بررسی» stops being a true sentence once "last check" is old.
 *   3. An implied move larger than SHORT_WINDOW_MAX_PCT within
 *      SHORT_WINDOW_MS is treated as a data fault and re-armed without an
 *      alert — the reported «BTC +۴۰٪» class of bug costs trust in every
 *      notification that follows it.
 *   4. Cooldowns only start, and baselines only move, on a DELIVERED alert.
 *      A failed push must be retryable next cycle, not silently swallowed.
 */

import { storeGet, storeSet } from './store.js';
import { fetchSimplePrices, fetchMarkets } from './providers.js';
import { withCache } from './cache.js';
import { parseIdentity } from './watch.js';
import { formatValue, kickerFor, resolveTone } from '../src/lib/notificationDesign.js';

const WATCH_KEY = 'price:watch:v1';
const TICK_KEY = 'price:watch:lastTick';

/** Per-identity cap, so one device cannot fill the store or the price call. */
const MAX_PER_IDENTITY = 50;
const MAX_TOTAL = 20000;

/** A watch with no sync for this long is abandoned and dropped. */
const MAX_AGE = 45 * 86400000;

/** Per-coin cooldown, mirroring the client's ALERT_COOLDOWN_MS. */
const COOLDOWN = 6 * 3600000;

/** Top-mover re-announce rules, mirroring the client's movers store. */
const MOVER_COUNT = 3;
const MOVER_THRESHOLD_PCT = 5;
const MOVER_COOLDOWN = 12 * 3600000;
const MOVER_ESCALATE_PCT = 5;

/** Baseline freshness + the plausibility ceiling (see header). */
const STALE_BASELINE_MS = 7 * 24 * 3600000;
const SHORT_WINDOW_MS = 6 * 3600000;
const SHORT_WINDOW_MAX_PCT = 35;

const MIN_THRESHOLD_PCT = 2;
const MAX_THRESHOLD_PCT = 50;
export const DEFAULT_THRESHOLD_PCT = 5;

/* -------------------------------------------------------------------------- */
/* store                                                                       */
/* -------------------------------------------------------------------------- */

export async function readPriceWatches() {
  const rows = await storeGet(WATCH_KEY, []);
  return Array.isArray(rows) ? rows : [];
}

async function writePriceWatches(rows) {
  await storeSet(WATCH_KEY, rows.slice(0, MAX_TOTAL));
}

const isCoinId = (v) => typeof v === 'string' && /^[a-z0-9-]{1,64}$/.test(v);

/**
 * Register (or replace) the price watches for one push identity.
 *
 * Replace-all, like /api/orders/watch: the device is the source of truth for
 * its own starred coins, so an un-starred coin disappears on the next sync.
 *
 * The per-coin BASELINES and mover cursors are server state and survive a
 * re-sync (same rule as `lastNotifiedAt` in server/watch.js): a client that
 * re-uploads its rows must not reset alert dedupe or manufacture a move.
 */
export async function putPriceWatch(identity, { coins, topMovers, thresholdPct, lang } = {}) {
  if (!parseIdentity(identity)) throw new Error('BAD_IDENTITY');
  const all = await readPriceWatches();
  const others = all.filter((w) => w.identity !== identity);
  const old = all.find((w) => w.identity === identity);

  const cleanCoins = [];
  const seen = new Set();
  for (const c of Array.isArray(coins) ? coins : []) {
    const id = String(c?.id || '').trim().toLowerCase();
    if (!isCoinId(id) || seen.has(id)) continue;
    seen.add(id);
    cleanCoins.push({
      id,
      symbol: String(c?.symbol || id).toUpperCase().replace(/[^A-Z0-9._-]/g, '').slice(0, 12) || id.toUpperCase(),
      name: String(c?.name || '').slice(0, 40) || null
    });
    if (cleanCoins.length >= MAX_PER_IDENTITY) break;
  }

  const threshold = Number(thresholdPct);
  const row = {
    identity,
    lang: String(lang || 'fa').slice(0, 5),
    coins: cleanCoins,
    topMovers: topMovers !== false,
    thresholdPct: Number.isFinite(threshold)
      ? Math.min(MAX_THRESHOLD_PCT, Math.max(MIN_THRESHOLD_PCT, threshold))
      : DEFAULT_THRESHOLD_PCT,
    /* Only the coins still watched keep their baseline; a re-starred coin
       starts from a fresh reference rather than comparing against weeks ago —
       the same rule the client applies on un-star. */
    baselines: Object.fromEntries(
      Object.entries(old?.baselines || {}).filter(([id]) => seen.has(id))
    ),
    movers: old?.movers || {},
    /* Refreshed on every sync: an abandoned identity stops being polled. */
    at: Date.now()
  };
  await writePriceWatches([...others, row]);
  return { ok: true, count: cleanCoins.length };
}

/** Aggregate count for the debug status route. */
export async function priceWatchStatus() {
  const rows = await readPriceWatches();
  return {
    identities: rows.length,
    coins: rows.reduce((n, w) => n + (w.coins?.length || 0), 0),
    topMovers: rows.filter((w) => w.topMovers).length
  };
}

/* -------------------------------------------------------------------------- */
/* copy — mirrors the client i18n (notify.price.* / notify.mover.*)            */
/* -------------------------------------------------------------------------- */

const COPY = {
  price: {
    fa: {
      title: '{symbol} تغییر کرد',
      up: '{symbol} از آخرین بررسی {pct}٪ بالا رفته — الان ${price}',
      down: '{symbol} از آخرین بررسی {pct}٪ پایین آمده — الان ${price}'
    },
    en: {
      title: '{symbol} moved',
      up: '{symbol} is up {pct}% since you last checked — now ${price}',
      down: '{symbol} is down {pct}% since you last checked — now ${price}'
    },
    ar: {
      title: 'تحرّك {symbol}',
      up: 'ارتفع {symbol} بنسبة {pct}٪ منذ آخر مرة — الآن ${price}',
      down: 'انخفض {symbol} بنسبة {pct}٪ منذ آخر مرة — الآن ${price}'
    }
  },
  mover: {
    fa: {
      titleUp: '{symbol} امروز {pct}٪ رشد کرد',
      titleDown: '{symbol} امروز {pct}٪ افت کرد',
      up: '{name} (رتبهٔ {rank}) در ۲۴ ساعت گذشته {pct}٪ بالا رفته — الان ${price}. برای دیدن نمودار بزن.',
      down: '{name} (رتبهٔ {rank}) در ۲۴ ساعت گذشته {pct}٪ پایین آمده — الان ${price}. برای دیدن نمودار بزن.'
    },
    en: {
      titleUp: '{symbol} is up {pct}% today',
      titleDown: '{symbol} is down {pct}% today',
      up: '{name} (rank {rank}) rose {pct}% in the last 24h — now ${price}. Tap to see the chart.',
      down: '{name} (rank {rank}) fell {pct}% in the last 24h — now ${price}. Tap to see the chart.'
    },
    ar: {
      titleUp: 'ارتفع {symbol} بنسبة {pct}٪ اليوم',
      titleDown: 'انخفض {symbol} بنسبة {pct}٪ اليوم',
      up: 'ارتفع {name} (المرتبة {rank}) بنسبة {pct}٪ خلال 24 ساعة — الآن ${price}. اضغط لعرض الرسم البياني.',
      down: 'انخفض {name} (المرتبة {rank}) بنسبة {pct}٪ خلال 24 ساعة — الآن ${price}. اضغط لعرض الرسم البياني.'
    }
  }
};

const fill = (tpl, vars) => String(tpl).replace(/\{(\w+)\}/g, (m, k) =>
  vars[k] != null && vars[k] !== '' ? String(vars[k]) : m);

/** The client formats the card number the same way (Market.jsx). */
function fmtPrice(p) {
  return p >= 1
    ? p.toLocaleString('en-US', { maximumFractionDigits: 2 })
    : String(Number(p.toPrecision(4)));
}

/**
 * Build the full push payload for one price/mover event.
 *
 * Everything decorative comes from the design system so the shade card is
 * byte-identical in shape to the in-app bar: tone from the sign of the move
 * (mint up / crimson down), the big number from formatValue, the tag the
 * client's own local cards use (so a phone shows ONE row per coin, whichever
 * transport got there first).
 */
export function buildPriceMoveAlert({ kind = 'price', coin, pct, price, rank = null, lang = 'fa' }) {
  const L = String(lang || 'fa').split('-')[0];
  const pack = COPY[kind === 'mover' ? 'mover' : 'price'][L] || COPY[kind === 'mover' ? 'mover' : 'price'].en;
  const up = Number(pct) >= 0;
  const abs = Math.abs(Number(pct)).toFixed(1);
  const vars = {
    symbol: coin.symbol,
    name: coin.name || coin.symbol,
    pct: abs,
    price: fmtPrice(Number(price)),
    rank: rank == null ? '—' : rank
  };
  const title = kind === 'mover'
    ? fill(up ? pack.titleUp : pack.titleDown, vars)
    : fill(pack.title, vars);
  const body = fill(up ? pack.up : pack.down, vars);
  const tone = resolveTone({ pnlPct: pct });
  return {
    title: title.slice(0, 64),
    body: body.slice(0, 160),
    url: `/coin/${coin.id}`,
    tag: kind === 'mover' ? `fbt-mover-${coin.id}` : `fbt-price-${coin.id}`,
    tone,
    value: formatValue({ pnlPct: pct }),
    label: coin.symbol,
    kicker: kickerFor({ tone }),
    lang: L
  };
}

/* -------------------------------------------------------------------------- */
/* evaluation                                                                  */
/* -------------------------------------------------------------------------- */

/** Top movers from a cached market page — the same list /api/markets serves. */
async function topMarketRows() {
  const { value } = await withCache('markets:usd:1:100', 120_000, () =>
    fetchMarkets({ page: 1, perPage: 100, vs: 'usd' }));
  return Array.isArray(value) ? value : [];
}

/**
 * One evaluation cycle. `send(identity, message)` delivers through the shared
 * push/FCM transport (the caller wires deliverStagePush). Returns
 * `{ checked, fired, delivered }` — delivery failures are reported, never
 * silenced into a false success.
 *
 * Pure evaluator: all side effects are the injected `send` and the store.
 */
export async function runPriceWatchCycle(send, now = Date.now(), deps = {}) {
  const rows = await readPriceWatches();
  const live = rows.filter((w) => now - (w.at || 0) < MAX_AGE);
  if (!live.length) return { checked: 0, fired: 0, delivered: 0 };

  /* ONE price request for every watched coin across every identity. */
  const ids = [...new Set(live.flatMap((w) => (w.coins || []).map((c) => c.id)))];
  let prices = {};
  let pricesOk = true;
  if (ids.length) {
    try {
      prices = await (deps.fetchPrices || fetchSimplePrices)(ids);
    } catch {
      /* Upstream down: favourites are skipped below, never treated as moves. */
      pricesOk = false;
    }
  }

  const needMovers = live.some((w) => w.topMovers);
  let marketRows = [];
  if (needMovers) {
    try {
      marketRows = await (deps.fetchMarkets || topMarketRows)();
    } catch {
      marketRows = [];
    }
  }

  let fired = 0;
  let delivered = 0;
  /*
   * `changed` is what makes the store write happen on a cycle that only
   * RE-ARMS baselines (first sighting, stale re-arm, fault re-arm). The order
   * watcher's write gate (`triggered > 0`) is exactly the shape that would
   * lose those here — and a lost first baseline means the feature never arms
   * at all. Every mutation below sets it.
   */
  let changed = false;
  const next = [];

  for (const w of live) {
    const baselines = { ...(w.baselines || {}) };
    const movers = { ...(w.movers || {}) };

    /* ---------------- favourites: move-from-baseline alerts --------------- */
    for (const coin of w.coins || []) {
      const row = prices?.[coin.id];
      const price = Number(row?.usd);
      /* GUARD 1 — silence is never a trigger and never a baseline. */
      if (!Number.isFinite(price) || price <= 0) continue;

      const base = baselines[coin.id];
      if (!base || !Number.isFinite(base.base) || base.base <= 0) {
        baselines[coin.id] = { base: price, seen: now };
        changed = true;
        continue;
      }
      /* GUARD 2 — a stale baseline re-arms silently. */
      if (Number.isFinite(base.seen) && now - base.seen > STALE_BASELINE_MS) {
        baselines[coin.id] = { base: price, seen: now };
        changed = true;
        continue;
      }

      const changePct = ((price - base.base) / base.base) * 100;
      if (Math.abs(changePct) < w.thresholdPct) {
        baselines[coin.id] = { ...base, seen: now };
        if (base.seen !== now) changed = true;
        continue;
      }
      /* GUARD 3 — a jump this large this fast is a data fault until proven
         otherwise. Re-arm at the new price and say nothing. */
      if (Number.isFinite(base.seen) && now - base.seen <= SHORT_WINDOW_MS
          && Math.abs(changePct) > SHORT_WINDOW_MAX_PCT) {
        baselines[coin.id] = { base: price, seen: now };
        changed = true;
        continue;
      }
      /* Cooldown — but `at` only stamps on a DELIVERED alert (below). */
      if (base.at != null && now - base.at < COOLDOWN) {
        baselines[coin.id] = { ...base, seen: now };
        if (base.seen !== now) changed = true;
        continue;
      }

      fired += 1;
      let ok = false;
      try {
        ok = await send(w.identity, {
          ...buildPriceMoveAlert({ kind: 'price', coin, pct: changePct, price, lang: w.lang }),
          lang: w.lang
        });
      } catch {
        ok = false;
      }
      if (ok) {
        delivered += 1;
        /* Re-baseline to the alert price so the NEXT move is measured from
           here — and stamp `at`, starting the cooldown. A failed send keeps
           the old baseline so the same move re-arms next cycle. */
        baselines[coin.id] = { base: price, seen: now, at: now };
        changed = true;
      } else {
        baselines[coin.id] = { ...base, seen: now };
        changed = true;
      }
    }

    /* ---------------- top movers: the feed's own 24h change --------------- */
    if (w.topMovers && marketRows.length) {
      const ranked = marketRows
        .filter((c) => c && isCoinId(String(c.id || '').toLowerCase())
          && Number.isFinite(Number(c.price)) && Number(c.price) > 0
          && Number.isFinite(Number(c.change24h)) && Math.abs(Number(c.change24h)) >= MOVER_THRESHOLD_PCT)
        .sort((a, b) => (Number(a.rank) || 1e9) - (Number(b.rank) || 1e9))
        .slice(0, MOVER_COUNT);
      for (const m of ranked) {
        const id = String(m.id).toLowerCase();
        const pct = Number(m.change24h);
        const prev = movers[id];
        const fresh = prev && Number.isFinite(prev.at) && now - prev.at < MOVER_COOLDOWN;
        if (fresh) {
          const flipped = Number.isFinite(prev.pct) && Math.sign(prev.pct) !== Math.sign(pct);
          const grew = Number.isFinite(prev.pct) && Math.abs(pct) - Math.abs(prev.pct) >= MOVER_ESCALATE_PCT;
          if (!flipped && !grew) continue;
        }
        fired += 1;
        let ok = false;
        try {
          ok = await send(w.identity, {
            ...buildPriceMoveAlert({
              kind: 'mover',
              coin: { id, symbol: m.symbol, name: m.name },
              pct,
              price: Number(m.price),
              rank: m.rank ?? null,
              lang: w.lang
            }),
            lang: w.lang
          });
        } catch {
          ok = false;
        }
        if (ok) {
          delivered += 1;
          movers[id] = { at: now, pct };
          changed = true;
        }
      }
      /* Forget old mover cursors so the store cannot grow without bound. */
      for (const [id, rec] of Object.entries(movers)) {
        if (!Number.isFinite(rec?.at) || now - rec.at > MOVER_COOLDOWN * 2) {
          delete movers[id];
          changed = true;
        }
      }
    }

    next.push({ ...w, baselines, movers });
  }

  if (changed || next.length !== rows.length) await writePriceWatches(next);
  return {
    checked: live.length,
    fired,
    delivered,
    pricesOk,
    moversAvailable: needMovers ? marketRows.length > 0 : null
  };
}

/* -------------------------------------------------------------------------- */
/* the throttled tick — the same cadence as the order watcher                  */
/* -------------------------------------------------------------------------- */

/**
 * How often the price cycle may be advanced by ANY trigger. Same reasoning as
 * server/watch.js's WATCH_TICK_MIN_MS: Vercel's plan forbids sub-daily crons,
 * so frequency comes from the 5-minute GitHub tick and ordinary traffic, and
 * this window is what keeps that bounded.
 */
export const PRICE_WATCH_TICK_MIN_MS = Math.max(60_000, Number(process.env.PRICE_WATCH_TICK_MIN_MS || 240_000));

let inFlight = null;

export async function priceWatchTickStatus() {
  const last = Number(await storeGet(TICK_KEY, 0)) || 0;
  return { lastTickAt: last || null, minIntervalMs: PRICE_WATCH_TICK_MIN_MS };
}

/**
 * Advance the price cycle, if the window has passed.
 *
 * Same contract as maybeWatchTick: `send` is REQUIRED (a cycle without a
 * sender can only silently drop alerts — that bug shipped for orders once),
 * a crash mid-cycle must not lock the window, and concurrent triggers collapse
 * onto one in-flight run per instance.
 */
export async function maybePriceWatchTick({ send, now = Date.now(), force = false } = {}) {
  if (typeof send !== 'function') return { skipped: 'NO_SENDER' };

  const last = Number(await storeGet(TICK_KEY, 0)) || 0;
  const since = now - last;
  if (!force && since < PRICE_WATCH_TICK_MIN_MS) return { skipped: 'THROTTLED', sinceMs: since };
  if (inFlight) return { skipped: 'IN_FLIGHT' };

  const rows = await readPriceWatches().catch(() => []);
  if (!rows.length) {
    await storeSet(TICK_KEY, now).catch(() => {});
    return { skipped: 'NO_WATCHES', at: now };
  }

  inFlight = runPriceWatchCycle(send, now)
    .catch((err) => ({ error: String(err?.message || err).slice(0, 120) }))
    .finally(() => {
      inFlight = null;
      storeSet(TICK_KEY, Date.now()).catch(() => {});
    });

  const out = await inFlight;
  return { ...out, at: now };
}
