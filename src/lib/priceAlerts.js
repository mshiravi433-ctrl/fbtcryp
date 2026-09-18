/**
 * FAVOURITE-COIN PRICE ALERTS
 * ---------------------------------------------------------------------------
 * ─── THE GAP THIS FILLS ─────────────────────────------------────────────────
 * Asked to make sure notifications work for news, favourite-coin price moves,
 * and automatic orders. Audited all three:
 *
 *   news            — WORKS. News.jsx owns a toggle and fires on new items.
 *   automatic orders — WORKS. Orders.jsx evaluates each order and notifies.
 *   price alerts     — DID NOT EXIST.
 *
 * `priceAlerts: true` sat in the notification defaults with a switch in
 * Settings, and a search for consumers outside notify.js returned ZERO. The
 * user could turn it on, the app remembered it was on, and nothing anywhere
 * ever compared a price or sent an alert. That is the same "wired to nothing"
 * shape as the dead Solana RPC setting, except here it silently promises to
 * warn someone about their money.
 *
 * ─── THE OFFLINE SNAPSHOT MUST NEVER PRODUCE AN ALERT ──────────────────────
 * Reported: «بیت کویین ۴۰ درصد رشد کرد که در واقعیت ۴ دهم رشد کرده». The
 * arithmetic here was always correct — the INPUTS were not. `getMarkets()`
 * falls back to a deterministic offline snapshot (`lib/offlineData.js`) when
 * both the backend and CoinGecko are unreachable, and BTC's seeded price
 * there is 67,450. A baseline recorded from that snapshot and a price from
 * the live market (or the reverse) differ by the gap between the two feeds —
 * which is exactly the shape of the report: a confident «+۴۰٪» notification
 * about a market that moved four tenths of a percent.
 *
 * Three guards, each closing one way to manufacture a number:
 *
 *   1. PROVENANCE. A row marked `offline` / `dataProvenance === 'offline'` is
 *      never recorded as a baseline and never compared against one. When the
 *      source changes (live → offline, offline → live, or a legacy baseline
 *      with no recorded source), the baseline is re-recorded silently. One
 *      missed real alert is the honest price of never sending a fake one.
 *
 *   2. FRESHNESS. A baseline not seen for more than `STALE_BASELINE_MS` is
 *      re-recorded without alerting. «از آخرین بررسی» is only a useful
 *      sentence while "last check" is recent; after that the number is
 *      technically true and practically a lie, because the reader compares it
 *      against today's move.
 *
 *   3. THE SHORT-WINDOW CEILING. An implied move larger than
 *      `SHORT_WINDOW_MAX_PCT` between two sightings less than `SHORT_WINDOW_MS`
 *      apart is, for a top-250 coin, a data fault (a mispriced row, a decimal
 *      shift, a feed swap) far more often than a real market event. The alert
 *      is skipped and the baseline re-armed at the new price — a missed
 *      meme-coin pump costs one notification; a fake «BTC +40%» costs the
 *      user's trust in every notification after it.
 *
 * ─── WHY A PERCENTAGE MOVE AND NOT A TARGET PRICE ───────────────────────────
 * A target price ("tell me when BTC hits 70,000") is the Orders screen's job
 * and it already does it properly, with persistence and trailing stops. This
 * is the other question — "did anything I care about move sharply?" — and it
 * needs no setup at all, which is what makes it useful to somebody who has
 * simply starred a few coins.
 *
 * ─── THE BASELINE IS PER-COIN AND PERSISTED ─────────────────────────────────
 * Comparing against the previous poll would mean a coin that slides 1% every
 * five minutes never alerts, while the same total move in one jump does. The
 * baseline is therefore the price when we LAST ALERTED (or first saw the
 * coin), so a slow grind and a sudden jump of the same size both fire.
 *
 * Persisted to localStorage so closing the app does not reset every baseline
 * and produce a burst of alerts on the next open — which would train the user
 * to turn the feature off, and a revoked notification permission costs us the
 * alerts that actually matter.
 *
 * ─── WHY IT CANNOT RUN IN THE BACKGROUND, STATED HONESTLY ───────────────────
 * This checks whenever the market data the app already polls comes back. It
 * therefore only fires while the app is open. Real background alerts need
 * server-sent push against a stored watchlist — `server/push.js` exists but
 * has no VAPID key configured, and the Settings copy already says so rather
 * than implying otherwise. A local alert that fires the moment you open the
 * app is still worth having; pretending it works while closed is not.
 */

import { getNotifySettings, showLocalNotification } from './notify';

const STORE_KEY = 'fbt-price-alert-base-v1';

/**
 * How far a coin must move from its baseline before we say anything.
 *
 * 5% is deliberately not configurable yet. It is large enough that a major
 * coin crossing it is genuinely notable, and small enough that it happens
 * often enough to be useful. A setting with no good default is a setting
 * nobody changes.
 */
export const ALERT_THRESHOLD_PCT = 5;

/**
 * Never alert about the same coin more than once in this window, even if it
 * keeps moving. A coin in freefall would otherwise fire on every poll.
 */
export const ALERT_COOLDOWN_MS = 6 * 60 * 60 * 1000;

/**
 * A baseline not refreshed within this window is re-recorded without
 * alerting. See the header: "since you last checked" stops being a useful
 * sentence once the check is days old, because the reader compares the
 * number against today's move.
 */
export const STALE_BASELINE_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * The short-window plausibility ceiling.
 *
 * Within SHORT_WINDOW_MS, an implied move larger than this is treated as a
 * data fault and silently re-armed, never announced. The value sits above
 * anything a top-50 coin has legitimately printed between two 30-second
 * polls of the same feed, and below the offline-gap / decimal-shift class of
 * fault — the reported «۴۰٪» lands squarely inside it.
 */
export const SHORT_WINDOW_MAX_PCT = 35;
export const SHORT_WINDOW_MS = 6 * 60 * 60 * 1000;

/**
 * The data source of a market row, normalised to 'live' | 'offline'.
 *
 * `getMarkets()` stamps every row with `dataProvenance` ('live' | 'offline')
 * and the offline snapshot additionally sets `offline: true` — both are read.
 * A row that carries no provenance at all (a test fixture, a hand-built list)
 * counts as live so the feature keeps working outside production; the guard
 * that matters is that an OFFLINE row is never mistaken for a live one.
 */
function provenanceOf(coin) {
  if (coin?.offline === true) return 'offline';
  if (coin?.dataProvenance === 'offline') return 'offline';
  return 'live';
}

function readStore() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function writeStore(data) {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(data));
  } catch {
    /* Private mode, or a full quota. Alerts degrade to per-session, which is
       strictly better than throwing inside a polling loop. */
  }
}

/** Forget every baseline. Used when the user turns the feature off. */
export function resetPriceBaselines() {
  writeStore({});
}

/**
 * Decide which favourites deserve an alert right now.
 *
 * Split out from the sending so it can be tested without a Notification API:
 * this is the part that decides whether to interrupt somebody, and it must be
 * verifiable.
 *
 * @param {object} p
 * @param {string[]} p.favorites            coin ids the user starred
 * @param {Array<{id:string,symbol?:string,name?:string,price:number}>} p.coins
 * @param {object}  [p.store]               previous baselines, for tests
 * @param {number}  [p.now]
 * @param {number}  [p.threshold]
 * @returns {{alerts: Array, store: object}} what to send, and the new store
 */
export function evaluatePriceAlerts({
  favorites = [],
  coins = [],
  store = readStore(),
  now = Date.now(),
  threshold = ALERT_THRESHOLD_PCT,
  cooldownMs = ALERT_COOLDOWN_MS,
  staleBaselineMs = STALE_BASELINE_MS,
  shortWindowMaxPct = SHORT_WINDOW_MAX_PCT,
  shortWindowMs = SHORT_WINDOW_MS
} = {}) {
  const next = { ...store };
  const alerts = [];
  const starred = new Set(favorites);

  for (const coin of coins) {
    if (!coin || !starred.has(coin.id)) continue;

    const src = provenanceOf(coin);

    /*
     * GUARD 1a — an offline/deterministic price is not a fact about the
     * market. It is neither a baseline nor an alert input. Recording it would
     * arm the exact bug this fixes: the NEXT live poll then "moved" by the
     * gap between the snapshot and the real market.
     */
    if (src === 'offline') continue;

    const price = Number(coin.price);
    /*
     * `Number(null)` is 0 and 0 is finite — a null price would otherwise
     * become a baseline of zero and then report an infinite move. The
     * positivity check has to come first.
     */
    if (!Number.isFinite(price) || price <= 0) continue;

    const prev = next[coin.id];

    /*
     * GUARD 1b — source continuity. A baseline recorded from a different
     * provenance than the row in hand measures the distance between two
     * FEEDS, not between two prices. The legacy `{base, at}` shape this store
     * used before provenance was tracked has no `src`, and `undefined !== 'live'`
     * — so every pre-upgrade baseline is re-armed exactly once rather than
     * trusted on faith. Safe direction: one missed real alert beats one
     * manufactured «+۴۰٪».
     */
    if (prev && prev.src !== src) {
      next[coin.id] = { base: price, src, seen: now };
      continue;
    }

    if (!prev || !Number.isFinite(prev.base) || prev.base <= 0) {
      /*
       * First sighting (or a corrupted baseline): record, never alert.
       * Alerting here would fire for every favourite the first time the
       * feature is switched on.
       *
       * `at` is deliberately left UNSET. It records when we last ALERTED,
       * not when we last saw the coin — see the cooldown note below.
       * `seen` IS set: it is the freshness clock for GUARD 2.
       */
      next[coin.id] = { base: price, src, seen: now };
      continue;
    }

    /*
     * GUARD 2 — freshness. A baseline nothing has refreshed for days
     * produces "since you last checked" numbers the reader will compare
     * against today's chart and disbelieve. Re-arm silently instead.
     */
    if (prev.seen != null && Number.isFinite(prev.seen) && now - prev.seen > staleBaselineMs) {
      next[coin.id] = { base: price, src, seen: now };
      continue;
    }

    const changePct = ((price - prev.base) / prev.base) * 100;
    if (Math.abs(changePct) < threshold) {
      /* Not a qualifying move — but the sighting still refreshes `seen`, so
         the freshness clock measures the LAST TIME WE SAW THE PRICE, not the
         last alert. */
      next[coin.id] = { ...prev, src, seen: now };
      continue;
    }

    /*
     * GUARD 3 — the short-window ceiling. A move this large this fast is a
     * data fault until proven otherwise: the offline-gap class of bug lands
     * here, as does a decimal shift or a mispriced row. Re-arm at the new
     * price and say nothing — the next poll decides whether the price is
     * real, and if it holds, moves from THERE are honest again.
     */
    if (prev.seen != null && Number.isFinite(prev.seen)
        && now - prev.seen <= shortWindowMs && Math.abs(changePct) > shortWindowMaxPct) {
      next[coin.id] = { base: price, src, seen: now };
      continue;
    }

    /*
     * Moved enough — but respect the cooldown.
     *
     * ─── `at` MUST MEAN "LAST ALERTED", NOT "LAST SEEN" ───────────────────
     * It originally got a timestamp when the baseline was first RECORDED,
     * which meant the very first genuine alert for a coin was swallowed by
     * its own cooldown: the baseline was written at T, the coin crossed the
     * threshold a minute later, and `now - prev.at` was far under six hours.
     * Caught by stepping a simulated price through the function rather than
     * by reading it — the code looked right.
     *
     * So `at` is now absent until we actually alert, and an absent `at`
     * means "never alerted, nothing to wait for".
     */
    if (prev.at != null && now - prev.at < cooldownMs) {
      next[coin.id] = { ...prev, src, seen: now };
      continue;
    }

    alerts.push({
      id: coin.id,
      symbol: (coin.symbol || coin.id).toUpperCase(),
      name: coin.name || coin.id,
      price,
      from: prev.base,
      changePct
    });

    /* Re-baseline to the price we alerted at, so the NEXT alert measures the
       next move rather than repeating this one. */
    next[coin.id] = { base: price, src, seen: now, at: now };
  }

  /*
   * Drop baselines for coins no longer starred, so unstarring and re-starring
   * gives a fresh reference point rather than comparing against a price from
   * weeks ago.
   */
  for (const id of Object.keys(next)) {
    if (!starred.has(id)) delete next[id];
  }

  return { alerts, store: next };
}

/**
 * Check the favourites and notify about anything that moved.
 *
 * Safe to call on every market poll: it is cheap, it self-limits through the
 * cooldown, and it returns early when the user has the feature off.
 *
 * @param {(a: object) => {title: string, body: string}} format  i18n lives in
 *        the caller — this module must not import a translator and decide
 *        wording, because the alert copy has to match the user's language.
 * @returns {number} how many alerts were sent
 */
export function runPriceAlerts({ favorites, coins, format, now = Date.now() } = {}) {
  let settings;
  try {
    settings = getNotifySettings();
  } catch {
    return 0;
  }
  if (!settings?.priceAlerts) return 0;
  if (!favorites?.length || !coins?.length) return 0;

  const { alerts, store } = evaluatePriceAlerts({ favorites, coins, now });
  /*
   * Persist even when nothing fired: the first pass records baselines, and
   * losing them would mean never having a reference to compare against.
   */
  writeStore(store);

  for (const a of alerts) {
    const { title, body } = format?.(a) ?? {};
    if (!title) continue;
    showLocalNotification(title, {
      body,
      /* Tagged per coin so a later alert for the same coin replaces the old
         one instead of stacking a second copy in the shade. */
      tag: `fbt-price-${a.id}`
    });
  }
  return alerts.length;
}
