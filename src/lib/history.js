/**
 * WHAT THE PAST ACTUALLY SAYS
 * ---------------------------------------------------------------------------
 * Requested: «سابقه روی این نمودار چی بوده و گذشته به ما چی میگه» — what has
 * happened on this chart before, and what does the past tell us.
 *
 * ─── WHY THIS IS SEPARATE FROM lib/ai.js ────────────────────────────────────
 * `analyze()` answers "what is the chart doing NOW": RSI, MACD, a moving
 * average, a single nearest support and resistance. Every one of those is a
 * snapshot. None of them can answer "has this level held before, and how
 * often" — which is the question a person actually asks before setting a
 * limit order at a price.
 *
 * So this module measures REPEATED BEHAVIOUR across the whole series, and it
 * is deliberately a separate file: it is pure arithmetic over an array of
 * numbers, with no React, no network and no model, so it can be tested
 * exhaustively and cannot slow a screen down.
 *
 * ─── THE RULE THAT SHAPES EVERY FUNCTION HERE ───────────────────────────────
 * NOTHING IN THIS FILE PREDICTS ANYTHING.
 *
 * Every value returned is a count, a frequency or a distance measured from
 * data that already happened. "This level was tested 4 times and held 3" is a
 * fact. "This level will hold" is a forecast, and a forecast dressed as
 * analysis is how a user loses money believing they were told something
 * reliable.
 *
 * The distinction matters commercially too: a screen that says "we found 4
 * touches" and turns out to be right builds trust, while one that says "it
 * will bounce" and is wrong destroys it — and the second one is also the kind
 * of claim that attracts regulatory attention in the market this app serves.
 *
 * ─── SMALL-SAMPLE HONESTY ───────────────────────────────────────────────────
 * Two touches is not a pattern, it is a coincidence with a sample size. Every
 * function that counts occurrences also reports how many observations it had,
 * and the UI is expected to say "not enough history" rather than present a
 * confident-looking 100% built on one event.
 */

/** Clamp helper — kept local so this file imports nothing. */
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/** Strip anything that is not a usable positive price. */
function clean(series) {
  return (series ?? []).filter((n) => Number.isFinite(n) && n > 0);
}

/* -------------------------------------------------------------------------- */
/* price levels that actually repeat                                          */
/* -------------------------------------------------------------------------- */

/**
 * Find price levels the market has visited more than once.
 *
 * ─── HOW IT WORKS, AND WHY NOT THE OBVIOUS WAY ──────────────────────────────
 * The naive approach is to collect local peaks and troughs and call each one
 * a level. That produces dozens of "levels" on any real chart, most of them
 * a single wiggle, and the list is useless.
 *
 * Instead the range is divided into bands (a percentage of price, not a fixed
 * dollar amount — 1% of BTC and 1% of a memecoin are wildly different
 * numbers, and a fixed step would give one coin three bands and another three
 * thousand). Extremes that fall in the same band are the SAME level, so a
 * price the market returned to five times counts as one level with five
 * touches rather than five separate levels.
 *
 * @param {number[]} series   chronological prices
 * @param {object}   [opts]
 * @param {number}   [opts.bandPct=1.5]  band width as a % of price
 * @param {number}   [opts.lookback=4]   bars either side that define an extreme
 * @param {number}   [opts.minTouches=2] a level needs at least this many
 * @returns {Array<{price, touches, kind, lastIndex, held, tested}>}
 */
export function findLevels(series, { bandPct = 1.5, lookback = 4, minTouches = 2 } = {}) {
  const v = clean(series);
  // Need enough room for at least one full window plus something either side.
  if (v.length < lookback * 2 + 3) return [];

  const extremes = [];
  for (let i = lookback; i < v.length - lookback; i += 1) {
    const w = v.slice(i - lookback, i + lookback + 1);
    const cur = v[i];
    if (cur === Math.max(...w)) extremes.push({ price: cur, index: i, kind: 'high' });
    else if (cur === Math.min(...w)) extremes.push({ price: cur, index: i, kind: 'low' });
  }
  if (!extremes.length) return [];

  /*
   * Group into bands. Sorting first means a single pass can close a band the
   * moment a price falls outside it, instead of comparing every extreme with
   * every other one — O(n log n) rather than O(n²), which matters because
   * this runs on a phone while a chart is on screen.
   */
  extremes.sort((a, b) => a.price - b.price);

  const groups = [];
  let bucket = [extremes[0]];

  for (let i = 1; i < extremes.length; i += 1) {
    const e = extremes[i];
    const anchor = bucket[0].price;
    const width = (anchor * bandPct) / 100;
    if (e.price - anchor <= width) bucket.push(e);
    else {
      groups.push(bucket);
      bucket = [e];
    }
  }
  groups.push(bucket);

  return groups
    .filter((g) => g.length >= minTouches)
    .map((g) => {
      const price = g.reduce((a, e) => a + e.price, 0) / g.length;
      const highs = g.filter((e) => e.kind === 'high').length;
      return {
        price,
        touches: g.length,
        /*
         * A level is whatever it acted as MORE often. A price that capped
         * three rallies and floored one is resistance, and calling it
         * "support/resistance" because it was both would say nothing.
         */
        kind: highs > g.length - highs ? 'resistance' : 'support',
        lastIndex: Math.max(...g.map((e) => e.index))
      };
    })
    .sort((a, b) => b.touches - a.touches);
}

/**
 * How did this level behave the last few times price reached it?
 *
 * "Held" means price approached within the band and then moved AWAY in the
 * direction the level implies — a support that held is one price bounced up
 * from. "Broke" means it carried through.
 *
 * Returns counts, never a probability. `3 of 4` is a fact about the past;
 * "75% chance" is a forecast, and this file does not make those.
 *
 * @returns {{tested:number, held:number, broke:number}}
 */
export function levelRecord(series, level, { bandPct = 1.5, confirmBars = 3 } = {}) {
  const v = clean(series);
  const price = Number(level?.price);
  if (!v.length || !Number.isFinite(price) || price <= 0) {
    return { tested: 0, held: 0, broke: 0 };
  }

  const band = (price * bandPct) / 100;
  const isSupport = level.kind === 'support';

  let tested = 0;
  let held = 0;
  let inside = false;

  for (let i = 0; i < v.length; i += 1) {
    const near = Math.abs(v[i] - price) <= band;

    /*
     * Count a TEST only on ENTERING the band, not on every bar spent inside
     * it. Without this, a price that drifted sideways at the level for
     * twenty bars would report twenty tests — turning one event into a
     * fabricated pattern, which is the exact dishonesty this file exists to
     * avoid.
     */
    if (near && !inside) {
      inside = true;
      const after = v.slice(i + 1, i + 1 + confirmBars);
      // Not enough bars left to judge the outcome; do not guess one.
      if (after.length < confirmBars) break;
      tested += 1;
      const settled = after[after.length - 1];
      if (isSupport ? settled > price + band : settled < price - band) held += 1;
    } else if (!near) {
      inside = false;
    }
  }

  return { tested, held, broke: Math.max(0, tested - held) };
}

/* -------------------------------------------------------------------------- */
/* volume and volatility, relative to this coin's own normal                  */
/* -------------------------------------------------------------------------- */

/**
 * Is today's value unusual FOR THIS COIN?
 *
 * An absolute number means nothing across coins — $50M of volume is a quiet
 * day for BTC and a historic one for a small cap. What is comparable is the
 * ratio to the coin's own recent median.
 *
 * MEDIAN, not mean, deliberately: one listing pump can drag a mean up so far
 * that every subsequent day looks quiet by comparison, which is exactly
 * backwards.
 *
 * @returns {{ratio, median, unusual}|null}
 */
export function relativeToNormal(current, history, { window = 30, unusualAt = 2 } = {}) {
  const v = clean(history).slice(-window);
  const now = Number(current);
  if (v.length < 5 || !Number.isFinite(now) || now <= 0) return null;

  const sorted = [...v].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const median =
    sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;

  if (!(median > 0)) return null;

  const ratio = now / median;
  return { ratio, median, unusual: ratio >= unusualAt || ratio <= 1 / unusualAt };
}

/**
 * Largest peak-to-trough fall within the series, as a percent.
 *
 * The single most useful "what does the past tell us" number for someone
 * about to schedule a recurring buy: it answers "how bad has this got" with
 * a measured figure instead of a feeling.
 */
export function maxDrawdown(series) {
  const v = clean(series);
  if (v.length < 2) return null;

  let peak = v[0];
  let worst = 0;
  for (const p of v) {
    if (p > peak) peak = p;
    const dd = ((peak - p) / peak) * 100;
    if (dd > worst) worst = dd;
  }
  return worst;
}

/**
 * How often did the price rise over the following `horizon` bars, historically?
 *
 * ─── THIS IS A BASE RATE, NOT A PREDICTION ──────────────────────────────────
 * It says "over this window, 58 of 90 days were followed by a higher price
 * seven days later". That is a description of the sample in front of us. It
 * carries no claim about the next seven days, and the UI must not present it
 * as one — which is why the return value includes `samples`, so a base rate
 * from twelve observations can be labelled as thin rather than shown as a
 * confident percentage.
 */
export function baseRate(series, horizon = 7) {
  const v = clean(series);
  if (v.length < horizon + 10) return null;

  let up = 0;
  let samples = 0;
  for (let i = 0; i + horizon < v.length; i += 1) {
    samples += 1;
    if (v[i + horizon] > v[i]) up += 1;
  }
  if (!samples) return null;

  return { up, samples, pct: (up / samples) * 100 };
}

/**
 * How often, historically, did a {{horizon}}-bar window end UP, FLAT or DOWN?
 *
 * ─── THIS IS A DESCRIPTION OF THE PAST, NOT A FORECAST ──────────────────────
 * `baseRate` collapses the same windows into a single up/down figure. This
 * splits them three ways, because "rose a little" and "rose a lot" are
 * different situations and a two-way number hides that. Like baseRate it
 * reports `samples`, and the UI is expected to refuse to draw a percentage
 * from too few of them.
 *
 * `bandPct` is the band, as a PERCENT of price, inside which a window counts
 * as NEUTRAL. The caller derives it from `projectRange()` (the volatility
 * cone's half-width): a coin that barely moves should not label ordinary
 * noise as "bullish" or "bearish", and a coin that moves a lot should not be
 * called neutral for moving the way it always does.
 *
 * @returns {{up, neutral, down, samples, pctUp, pctNeutral, pctDown}|null}
 */
export function scenarioSplit(series, horizon = 7, bandPct = 1.5) {
  const v = clean(series);
  if (v.length < horizon + 10) return null;

  const band = Math.abs(Number(bandPct));
  if (!Number.isFinite(band) || band <= 0) return null;

  let up = 0;
  let neutral = 0;
  let down = 0;
  for (let i = 0; i + horizon < v.length; i += 1) {
    if (v[i] <= 0) continue;
    const ret = ((v[i + horizon] - v[i]) / v[i]) * 100;
    if (ret > band) up += 1;
    else if (ret < -band) down += 1;
    else neutral += 1;
  }
  const samples = up + neutral + down;
  if (!samples) return null;

  return {
    up,
    neutral,
    down,
    samples,
    pctUp: Math.round((up / samples) * 100),
    pctNeutral: Math.round((neutral / samples) * 100),
    pctDown: Math.round((down / samples) * 100)
  };
}

/**
 * HOW THE PRICE ACTUALLY MOVED, DAY BY DAY — the three numbers people ask for
 * and that a single window-change figure hides.
 *
 * ─── WHY THIS IS A SEPARATE MEASUREMENT ─────────────────────────────────────
 * "It moved 40% this quarter" is compatible with two opposite experiences: a
 * straight line, or four weeks of nothing followed by a spike. The number that
 * tells them apart is the dispersion of the daily moves — and the number that
 * tells you whether a position would have been survivable is the worst single
 * day, which a window change can never show (a −30% day inside a +40% quarter
 * is invisible in the summary).
 *
 * Everything here is arithmetic over returns that already happened:
 *
 *   · avgAbsPct — the mean of |daily move|, i.e. "a typical day"
 *   · medianAbsPct — the same idea with the spikes removed ("two days in three
 *     are calmer than this"), which is the honest way to describe a fat-tailed
 *     series without a forecast
 *   · bestPct/worstPct — the single best and worst days
 *   · upDays/downDays/flatDays and samples — the counts, so a reader can see
 *     how much evidence sits under the averages
 *
 * Measured with a MEDIAN as well as a mean on purpose: one pump makes the mean
 * describe a market that never existed.
 *
 * @param {number[]} series chronological prices
 * @returns {{avgAbsPct, medianAbsPct, bestPct, worstPct, upDays, downDays,
 *            flatDays, samples, insideTwoAvgPct}|null}
 */
export function dailyMoves(series, { flatPct = 0.05 } = {}) {
  const v = clean(series);
  if (v.length < 3) return null;

  const moves = [];
  let upDays = 0;
  let downDays = 0;
  let flatDays = 0;
  for (let i = 1; i < v.length; i += 1) {
    const prev = v[i - 1];
    if (!(prev > 0)) continue;
    const pct = ((v[i] - prev) / prev) * 100;
    moves.push(pct);
    if (pct > flatPct) upDays += 1;
    else if (pct < -flatPct) downDays += 1;
    else flatDays += 1;
  }
  if (moves.length < 2) return null;

  const abs = moves.map(Math.abs);
  const avgAbsPct = abs.reduce((a, b) => a + b, 0) / abs.length;
  const sorted = [...abs].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const medianAbsPct = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;

  /* How much of the series is CALM relative to its own volatility. Reported as
     a share, never as a probability of the next day — it describes the sample. */
  const inside = abs.filter((m) => m <= avgAbsPct * 2).length;

  return {
    avgAbsPct,
    medianAbsPct,
    bestPct: Math.max(...moves),
    worstPct: Math.min(...moves),
    upDays,
    downDays,
    flatDays,
    samples: moves.length,
    insideTwoAvgPct: (inside / abs.length) * 100
  };
}

/**
 * HOW MUCH OF THE SERIES SAT ABOVE ITS OWN MOVING AVERAGE.
 *
 * This is the trend question asked in a way that cannot forecast: instead of
 * "is it above the average now" (a snapshot, and the one thing every indicator
 * screen already says), it counts how many days of the window closed above the
 * average OF THE SAME WINDOW. A market that spent 70 of 90 days above its own
 * average has been behaving one way for three months; one that spent 45 has
 * not been behaving any way at all.
 *
 * Days before the average has a full window are skipped rather than
 * back-filled with a shorter average, because those would compare a 3-day
 * average with a 20-day one and quietly bias the count.
 *
 * @param {number[]} series
 * @param {object}   [opts]
 * @param {number}   [opts.window=20]  the moving average's length
 * @returns {{above, total, pct, window}|null}
 */
export function aboveAverage(series, { window = 20 } = {}) {
  const v = clean(series);
  const len = Math.max(2, Math.floor(Number(window) || 20));
  if (v.length < len + 5) return null;

  let above = 0;
  let total = 0;
  let sum = 0;
  for (let i = 0; i < v.length; i += 1) {
    sum += v[i];
    if (i < len - 1) continue;
    if (i >= len) sum -= v[i - len];
    const avg = sum / len;
    total += 1;
    if (v[i] > avg) above += 1;
  }
  if (total < 5) return null;
  return { above, total, pct: (above / total) * 100, window: len };
}

/**
 * THE CURRENT RUN — how many days in a row the price has moved the same way.
 *
 * A streak is a fact about the past and nothing more: a five-day slide says
 * "this has been one-directional", never "it is due". It is measured on
 * consecutive closes against the previous close, and the direction is reported
 * so the copy can say which way.
 *
 * @returns {{dir:'up'|'down', days:number}|null}
 */
export function currentStreak(series) {
  const v = clean(series);
  if (v.length < 3) return null;

  let days = 0;
  let dir = null;
  for (let i = v.length - 1; i > 0; i -= 1) {
    const delta = v[i] - v[i - 1];
    if (delta === 0) break;
    const step = delta > 0 ? 'up' : 'down';
    if (dir == null) dir = step;
    if (step !== dir) break;
    days += 1;
  }
  if (!dir || days < 2) return null;
  return { dir, days };
}

/**
 * THE SHAPE OF THE WORST FALL: where the window's high and low were, and how
 * much of the fall has been given back since.
 *
 * `maxDrawdown` reports the depth. That number alone cannot tell a market that
 * is still near its lows from one that fell and recovered, and those are
 * completely different situations for someone deciding today. The recovery
 * share is measured from the trough to the LAST price, so it is a statement
 * about what has already happened by the end of the window.
 *
 * @returns {{peak, trough, drawdownPct, recoveredPct}|null}
 */
export function drawdownShape(series) {
  const v = clean(series);
  if (v.length < 3) return null;

  let peak = v[0];
  let peakAt = 0;
  let trough = v[0];
  let troughAt = 0;
  let worst = 0;
  for (let i = 0; i < v.length; i += 1) {
    if (v[i] > peak) { peak = v[i]; peakAt = i; }
    const dd = ((peak - v[i]) / peak) * 100;
    if (dd > worst) { worst = dd; trough = v[i]; troughAt = i; }
  }
  /* A fall before the last point only — a shape needs a fall to describe. */
  if (!(worst > 0) || troughAt === 0) return null;

  const last = v[v.length - 1];
  const span = peak - trough;
  const recoveredPct = span > 0 ? clamp(((last - trough) / span) * 100, 0, 100) : 0;
  return { peak, peakAt, trough, troughAt, drawdownPct: worst, recoveredPct };
}

/**
 * HOW FAR THE NEAREST MEASURED LEVEL IS FROM THE CURRENT PRICE, as a percent.
 *
 * `historyFacts` already names the nearest level and how it behaved. The
 * distance is the number that makes it actionable: "3.1% below" is a decision
 * input, "support at 61,200" is trivia. It is computed from the SAME level list
 * `findLevels` produced, so the panel can never quote a level it did not
 * measure, and it returns null when no level is close enough to matter.
 *
 * @returns {{price, kind, distancePct, side:'above'|'below', touches}|null}
 */
export function nearestLevelDistance(series, opts = {}) {
  const v = clean(series);
  if (v.length < 20) return null;
  const levels = findLevels(v, opts);
  if (!levels.length) return null;

  const price = v[v.length - 1];
  const nearest = levels
    .map((l) => ({ ...l, distance: Math.abs(l.price - price) / price }))
    .sort((a, b) => a.distance - b.distance)[0];
  if (!nearest) return null;

  return {
    price: nearest.price,
    kind: nearest.kind,
    touches: nearest.touches,
    distancePct: nearest.distance * 100,
    side: nearest.price >= price ? 'above' : 'below'
  };
}

/**
 * THE LEVELS NEAREST TO THE CURRENT PRICE, with the record of each one.
 *
 * The panel needs more than the single closest level to be useful: someone
 * deciding where to place a limit wants the nearest level BELOW and the
 * nearest ABOVE, because those are the two prices the market has already
 * defended or refused. Both come from the same `findLevels` measurement, each
 * carrying the honest `held / tested` record and the distance in percent.
 *
 * Sorted by distance, capped by `limit`, and never invented: a series with no
 * repeated levels returns an empty list and the panel shows nothing.
 *
 * @param {number[]} series
 * @param {object}   [opts]
 * @param {number}   [opts.limit=4]
 * @returns {Array<{price, kind, touches, held, tested, distancePct, side}>}
 */
export function levelLadder(series, { limit = 4, ...opts } = {}) {
  const v = clean(series);
  if (v.length < 20) return [];
  const levels = findLevels(v, opts);
  if (!levels.length) return [];

  const price = v[v.length - 1];
  return levels
    .map((level) => {
      const record = levelRecord(v, level);
      return {
        price: level.price,
        kind: level.kind,
        touches: level.touches,
        held: record.held,
        tested: record.tested,
        distancePct: (Math.abs(level.price - price) / price) * 100,
        side: level.price >= price ? 'above' : 'below'
      };
    })
    .sort((a, b) => a.distancePct - b.distancePct)
    .slice(0, Math.max(1, Math.floor(limit)));
}

/**
 * THE WINDOW ITSELF, described — how many observations the facts above were
 * measured from, and how many repeated levels the market actually produced.
 *
 * This exists so the panel can state its own sample size on screen. Every
 * conversation about "is this analysis trustworthy" reduces to that number,
 * and a box that shows measurements without it invites the reader to assume
 * more data than there is.
 *
 * @returns {{samples, levels, low, high, price, rangePct}|null}
 */
export function historyOverview(series) {
  const v = clean(series);
  if (v.length < 20) return null;
  const low = Math.min(...v);
  const high = Math.max(...v);
  const price = v[v.length - 1];
  return {
    samples: v.length,
    levels: findLevels(v).length,
    low,
    high,
    price,
    rangePct: high > 0 ? ((high - low) / high) * 100 : null
  };
}

/**
 * Where does the current price sit within the range of the series?
 * 0 = at the period low, 100 = at the period high.
 */
export function rangePosition(series) {
  const v = clean(series);
  if (v.length < 2) return null;
  const lo = Math.min(...v);
  const hi = Math.max(...v);
  if (hi <= lo) return null;
  const price = v[v.length - 1];
  return { pct: clamp(((price - lo) / (hi - lo)) * 100, 0, 100), low: lo, high: hi };
}

/* -------------------------------------------------------------------------- */
/* which translation key a fact lives under                                   */
/* -------------------------------------------------------------------------- */

/**
 * The fact ids that only exist for equities (`history.equity.*`).
 *
 * ─── THE BUG THIS FIXES ─────────────────────────────────────────────────────
 * `equitySeriesFacts()` returns historyFacts() PLUS three of its own, and both
 * equity renderers (GoldHistoryBox, EquityAnalysis) formatted EVERY fact with
 * the `history.equity.` prefix. So the shared facts — levelSupport,
 * rangePosition, maxDrawdown, baseRate — were looked up as
 * `history.equity.levelSupport`, a key that does not exist, and i18next
 * returned the KEY ITSELF. On the gold box and the stocks analysis the user
 * read "history.equity.levelSupport" instead of a sentence.
 *
 * The fix lives here rather than in each component so the two renderers, the
 * engine and any future caller cannot drift: a fact knows which namespace it
 * belongs to, and the renderer asks.
 */
export const EQUITY_ONLY_FACTS = new Set(['windowChange', 'avgDailyMove', 'extremes']);

/**
 * The i18n key path for a fact id.
 * @param {string} id
 * @param {object} [opts]
 * @param {boolean} [opts.equity=false] true when the caller renders the
 *        equity series (gold / stocks), which adds three ids of its own
 * @returns {string} e.g. 'history.levelSupport' or 'history.equity.extremes'
 */
export function historyFactKey(id, { equity = false } = {}) {
  return equity && EQUITY_ONLY_FACTS.has(id) ? `history.equity.${id}` : `history.${id}`;
}

/* -------------------------------------------------------------------------- */
/* the summary the UI renders                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Turn a price series into a list of FACTS about its past.
 *
 * Each fact is `{ id, kind, values }` — a translation key plus the numbers to
 * interpolate, never a finished sentence. Building strings here would make
 * the module untranslatable, and this app ships in twelve languages.
 *
 * `kind` is one of 'neutral' | 'caution' | 'notable', used only for colour.
 * It is NOT a buy or sell signal and deliberately has no such value: the
 * moment this file emits "bullish", it has started forecasting.
 *
 * @param {number[]} series      chronological prices
 * @param {object}   [ctx]
 * @param {number}   [ctx.volume]        current 24h volume
 * @param {number[]} [ctx.volumeHistory] past daily volumes
 * @param {number}   [ctx.days=90]       what the series covers, for labels
 */
export function historyFacts(series, ctx = {}) {
  const v = clean(series);
  const facts = [];
  if (v.length < 20) return facts;

  const days = ctx.days ?? 90;
  const price = v[v.length - 1];

  /* ---- levels the market keeps returning to ---- */
  const levels = findLevels(v);
  const nearest = levels
    .map((l) => ({ ...l, distance: Math.abs(l.price - price) / price }))
    .sort((a, b) => a.distance - b.distance)[0];

  if (nearest) {
    const record = levelRecord(v, nearest);
    if (record.tested >= 2) {
      facts.push({
        id: nearest.kind === 'support' ? 'levelSupport' : 'levelResistance',
        kind: 'notable',
        values: {
          price: nearest.price,
          touches: nearest.touches,
          held: record.held,
          tested: record.tested,
          days
        }
      });
    }
  }

  /* ---- how far away that level is, in the units a decision uses ---- */
  const distance = nearestLevelDistance(v);
  /*
   * Above 25% it stops being "the level near this price" and becomes a
   * different fact about a different level — printed as a near-term input it
   * would mislead, so it is withheld rather than shown with a caveat.
   */
  if (distance && distance.distancePct <= 25) {
    facts.push({
      id: 'levelDistance',
      kind: distance.distancePct <= 3 ? 'notable' : 'neutral',
      values: {
        price: distance.price,
        pct: Math.round(distance.distancePct * 10) / 10,
        side: distance.side,
        touches: distance.touches
      }
    });
  }

  /* ---- where we are in the range ---- */
  const pos = rangePosition(v);
  if (pos) {
    facts.push({
      id: 'rangePosition',
      kind: pos.pct > 85 || pos.pct < 15 ? 'notable' : 'neutral',
      values: { pct: Math.round(pos.pct), low: pos.low, high: pos.high, days }
    });
  }

  /* ---- worst fall in the window ---- */
  const dd = maxDrawdown(v);
  if (dd != null && dd >= 5) {
    facts.push({
      // Caution, because this is the number people under-estimate before
      // committing to a schedule of buys.
      id: 'maxDrawdown',
      kind: dd >= 30 ? 'caution' : 'neutral',
      values: { pct: Math.round(dd), days }
    });
  }

  /* ---- and how much of that fall was given back ---- */
  const shape = drawdownShape(v);
  /*
   * Only worth saying when the fall was big enough to matter (same 5% floor as
   * above) and there is something to report about the recovery. A "+2% given
   * back" line on a 5% dip is noise dressed as analysis.
   */
  if (shape && shape.drawdownPct >= 5 && shape.recoveredPct >= 20) {
    facts.push({
      id: 'drawdownRecovered',
      kind: shape.recoveredPct >= 70 ? 'neutral' : 'caution',
      values: { pct: Math.round(shape.recoveredPct), days }
    });
  }

  /* ---- how the days themselves moved, not just where it started/ended ---- */
  const moves = dailyMoves(v);
  if (moves && moves.samples >= 10) {
    facts.push({
      id: 'volatility',
      // A 4% typical day is a caution in the same language as maxDrawdown:
      // it is the number that decides how large a position is survivable.
      kind: moves.avgAbsPct >= 4 ? 'caution' : 'neutral',
      values: {
        avg: Math.round(moves.avgAbsPct * 100) / 100,
        median: Math.round(moves.medianAbsPct * 100) / 100,
        calm: Math.round(moves.insideTwoAvgPct),
        days
      }
    });
  }

  /* ---- the current run, which is a fact and not a due-date ---- */
  const streak = currentStreak(v);
  if (streak && streak.days >= 3) {
    facts.push({
      id: 'streak',
      kind: streak.days >= 5 ? 'notable' : 'neutral',
      values: { days: streak.days, dir: streak.dir }
    });
  }

  /* ---- how much of the window was spent above its own average ---- */
  const above = aboveAverage(v, { window: 20 });
  if (above && above.total >= 30) {
    facts.push({
      id: 'aboveAverage',
      kind: above.pct >= 70 || above.pct <= 30 ? 'notable' : 'neutral',
      values: {
        pct: Math.round(above.pct),
        above: above.above,
        total: above.total,
        window: above.window,
        days
      }
    });
  }

  /* ---- unusual volume ---- */
  const vol = relativeToNormal(ctx.volume, ctx.volumeHistory);
  if (vol?.unusual) {
    facts.push({
      id: vol.ratio >= 1 ? 'volumeHigh' : 'volumeLow',
      kind: 'notable',
      values: { times: Math.round(vol.ratio * 10) / 10 }
    });
  }

  /* ---- historical base rate ---- */
  const br = baseRate(v, 7);
  /*
   * 30 samples is the threshold below which a percentage is more misleading
   * than helpful. Reporting "67%" from nine observations invites someone to
   * treat noise as an edge.
   */
  if (br && br.samples >= 30) {
    facts.push({
      id: 'baseRate',
      kind: 'neutral',
      values: { pct: Math.round(br.pct), up: br.up, samples: br.samples }
    });
  }

  return facts;
}
