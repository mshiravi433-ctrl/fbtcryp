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
