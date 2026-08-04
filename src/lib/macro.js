/**
 * MACRO / REGIME CONTEXT
 * ---------------------------------------------------------------------------
 * Requested: «تاثیر سیاست کلان و آینده اون ارز تا ماه دیگه بر اساس استدلال‌ها
 * و گذشته باشد» — the effect of the big picture, reasoned from history, out to
 * roughly a month.
 *
 * ─── THE GAP THIS FILLS ─────────────────────────────────────────────────────
 * Everything the app computed before this file read ONE price series in
 * isolation: RSI, MACD, Bollinger, moving averages. All of them are transforms
 * of the same numbers, which is why they agree with each other and why
 * agreement was a worthless confidence measure.
 *
 * But an altcoin does not move on its own chart. In practice the dominant term
 * is "what is Bitcoin doing, and is money rotating into or out of the rest of
 * the market". A coin with a beautiful chart in a market where BTC dominance
 * is climbing through a drawdown is a coin about to be sold. No amount of RSI
 * sees that, because RSI cannot see Bitcoin.
 *
 * ─── WHAT IS MEASURED, AND WHAT IS NOT ──────────────────────────────────────
 * MEASURED (all from data we already fetch, no new API, no key):
 *   · market regime      — is total market cap in an up- or down-trend
 *   · dominance drift    — is capital rotating to BTC or away from it
 *   · beta to BTC        — how hard this asset moves when BTC moves
 *   · cycle position     — where price sits between its own range extremes
 *   · drawdown from ATH  — how far into a bear this asset already is
 *
 * NOT MEASURED, and deliberately not faked:
 *   · interest rates, CPI, central-bank policy. There is no free, reliable,
 *     Iran-reachable feed for these, and a hard-coded "the Fed is hawkish"
 *     string would be a lie the moment it went stale. What macro DOES reach
 *     this app is already priced into total market cap and dominance, which is
 *     what we read.
 *
 * ─── EVERY RETURN VALUE IS A KEY PLUS NUMBERS ───────────────────────────────
 * Never a sentence. The UI translates; this file never writes prose, so no
 * claim can be machine-translated into something subtly false.
 */

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

const clean = (series) =>
  (series ?? [])
    .map((p) => (typeof p === 'object' && p !== null ? p.p : p))
    .filter((n) => Number.isFinite(n) && n > 0);

/** Percent change between the first and last value of a series. */
function pctChange(v) {
  if (v.length < 2) return null;
  const a = v[0];
  const b = v[v.length - 1];
  if (!(a > 0)) return null;
  return ((b - a) / a) * 100;
}

/** Simple returns, aligned pairwise. */
function returns(v) {
  const out = [];
  for (let i = 1; i < v.length; i += 1) {
    if (v[i - 1] > 0) out.push(v[i] / v[i - 1] - 1);
  }
  return out;
}

/**
 * BETA TO BITCOIN — how much this asset amplifies a BTC move.
 *
 * Ordinary least squares slope of assetReturn on btcReturn. Beta 1.8 means a
 * 10% BTC day historically came with an 18% day here, in either direction.
 *
 * ─── WHY THIS IS THE MOST USEFUL SINGLE NUMBER FOR A BEGINNER ───────────────
 * It converts "crypto is risky" into a number they can act on. Someone holding
 * a beta-2.5 altcoin through a BTC correction is taking roughly two and a half
 * times the pain, and almost nobody realises that before it happens.
 *
 * Returns null rather than a guess when the two series cannot be aligned —
 * a beta computed on mismatched timestamps is noise with a decimal point.
 */
export function betaToBtc(assetSeries, btcSeries) {
  const a = clean(assetSeries);
  const b = clean(btcSeries);
  if (a.length < 20 || b.length < 20) return null;

  // Align by taking the last N of each. Both come from the same endpoint with
  // the same `days`, so the sampling interval matches; length can differ by a
  // bar or two at the edges.
  const n = Math.min(a.length, b.length);
  const ar = returns(a.slice(-n));
  const br = returns(b.slice(-n));
  const m = Math.min(ar.length, br.length);
  if (m < 15) return null;

  const x = br.slice(-m);
  const y = ar.slice(-m);
  const mx = x.reduce((s, v) => s + v, 0) / m;
  const my = y.reduce((s, v) => s + v, 0) / m;

  let cov = 0;
  let varx = 0;
  for (let i = 0; i < m; i += 1) {
    cov += (x[i] - mx) * (y[i] - my);
    varx += (x[i] - mx) ** 2;
  }
  if (varx === 0) return null;

  const beta = cov / varx;

  /*
   * R² — how much of this asset's movement BTC actually explains. Reporting a
   * beta without it is the standard abuse of the statistic: a beta of 2.0 with
   * R² of 0.05 means the number is fitted to noise and tells you nothing.
   */
  let vary = 0;
  for (let i = 0; i < m; i += 1) vary += (y[i] - my) ** 2;
  const r2 = vary === 0 ? 0 : clamp((cov * cov) / (varx * vary), 0, 1);

  return { beta: Math.round(beta * 100) / 100, r2: Math.round(r2 * 100) / 100, samples: m };
}

/**
 * MARKET REGIME from global stats plus a BTC series.
 *
 * Four regimes, and the names are deliberately about CAPITAL FLOW rather than
 * about a direction to trade:
 *
 *   riskOn      — total cap rising, dominance falling: money spreading out
 *   btcLed      — total cap rising, dominance rising: BTC only, alts lagging
 *   rotationOut — total cap falling, dominance rising: alts sold first
 *   riskOff     — total cap falling, dominance falling too: broad exit
 *
 * `rotationOut` is the one that matters most and the one no indicator sees:
 * it is the regime where a healthy-looking altcoin chart is about to break,
 * because the marginal seller is not reading its chart.
 */
export function marketRegime({ global, btcSeries } = {}) {
  const mcapChange = Number(global?.mcapChange);
  const btcDom = Number(global?.btcDominance);
  const btc = clean(btcSeries);

  /*
   * The 24h cap change alone is too noisy to name a regime with — a single
   * green day in a bear market would flip it. When we have a BTC series we
   * use its 30-bar trend as the slower, dominant term and let the 24h number
   * only break ties.
   */
  const btcTrend = btc.length >= 20 ? pctChange(btc.slice(-30)) : null;

  const rising =
    btcTrend != null ? btcTrend > 1 : Number.isFinite(mcapChange) ? mcapChange > 0.5 : null;
  if (rising === null || !Number.isFinite(btcDom)) return null;

  /*
   * Dominance DRIFT, not level. "BTC dominance is 58%" says nothing on its own
   * — it has been between 38% and 70% across normal markets. What carries
   * information is which way it is moving, and we can only infer that from the
   * relationship between BTC's own trend and the total cap's.
   *
   * If BTC is outrunning the market, dominance is rising by definition.
   */
  let domRising = null;
  if (btcTrend != null && Number.isFinite(mcapChange)) {
    // Compare like with like is impossible here (one is 30-bar, one is 24h),
    // so this only fires when the two disagree strongly enough to be safe.
    if (btcTrend > 2 && mcapChange < 0) domRising = true;
    else if (btcTrend < -2 && mcapChange > 0) domRising = false;
  }
  if (domRising === null && Number.isFinite(global?.btcDominanceChange)) {
    domRising = Number(global.btcDominanceChange) > 0;
  }

  let regime;
  if (rising) regime = domRising === false ? 'riskOn' : domRising === true ? 'btcLed' : 'riskOn';
  else regime = domRising === true ? 'rotationOut' : 'riskOff';

  return {
    regime,
    values: {
      btcDom: Math.round(btcDom * 10) / 10,
      mcapChange: Number.isFinite(mcapChange) ? Math.round(mcapChange * 100) / 100 : null,
      btcTrend: btcTrend == null ? null : Math.round(btcTrend * 10) / 10
    },
    /*
     * `certain` is false when dominance drift had to be inferred rather than
     * read. The UI downgrades the wording in that case instead of asserting a
     * rotation it cannot see.
     */
    certain: domRising !== null
  };
}

/**
 * CYCLE POSITION — how far this asset is from its own all-time high.
 *
 * This is the number that separates "expensive" from "cheap" over a horizon
 * of months, and it is the one a beginner most often has backwards: a coin
 * down 90% feels cheap and is usually still falling, while a coin at a new
 * high feels expensive and is where trends actually live.
 *
 * So the label is about POSITION, never about a decision.
 */
export function cyclePosition({ price, ath, athChange } = {}) {
  const drop = Number.isFinite(athChange)
    ? Math.abs(athChange)
    : Number.isFinite(price) && Number.isFinite(ath) && ath > 0
      ? ((ath - price) / ath) * 100
      : null;
  if (drop == null) return null;

  const band =
    drop < 5 ? 'atHigh' : drop < 25 ? 'nearHigh' : drop < 55 ? 'midCycle' : drop < 85 ? 'deepDrawdown' : 'farFromHigh';

  /*
   * The recovery multiple, which is the honest way to state a drawdown.
   * "Down 90%" is abstract; "needs to 10× just to get back to where it was"
   * is the same fact and is understood instantly.
   */
  const recoveryX = drop >= 99 ? null : Math.round((100 / (100 - drop)) * 10) / 10;

  return { band, values: { drop: Math.round(drop), recoveryX } };
}

/**
 * The full macro read for one asset.
 *
 * Composed here rather than in the UI so the same object can be reused by the
 * verdict engine, the coin screen and the Telegram channel post without three
 * slightly different versions drifting apart.
 *
 * @param {object}   args
 * @param {object}   args.coin       market row (price, ath, athChange…)
 * @param {number[]} args.series     this asset's prices, chronological
 * @param {number[]} args.btcSeries  BTC prices over the same window
 * @param {object}   args.global     global market stats
 */
export function macroContext({ coin = {}, series = [], btcSeries = [], global = null } = {}) {
  const regime = marketRegime({ global, btcSeries });

  /*
   * Bitcoin's beta to itself is 1.0 with an R² of 1.0. That is arithmetically
   * true and completely useless to print — "BTC moves 1× as hard as BTC, and
   * 100% of its movement is explained by BTC" reads as a bug, and it would be
   * the single most-viewed asset on the screen. The regime layer still applies
   * to BTC; only the comparison to itself is dropped.
   */
  const isBtc = /^(bitcoin|btc|wrapped-bitcoin)$/i.test(coin?.id ?? '') || /^W?BTC$/i.test(coin?.symbol ?? '');
  const beta = isBtc ? null : betaToBtc(series, btcSeries);
  const cycle = cyclePosition(coin);

  const facts = [];

  if (regime) {
    facts.push({ id: `regime.${regime.regime}`, kind: regime.regime === 'riskOn' ? 'notable' : 'caution', values: regime.values, certain: regime.certain });
  }

  /*
   * Beta is only reported when BTC explains enough of the movement for the
   * number to mean anything. R² below 0.2 means the fit is noise, and a
   * confident "this moves 2.4× BTC" from noise is exactly the kind of
   * precise-sounding falsehood this codebase exists to avoid.
   */
  if (beta && beta.r2 >= 0.2) {
    facts.push({
      id: beta.beta >= 1.3 ? 'beta.high' : beta.beta <= 0.7 ? 'beta.low' : 'beta.normal',
      kind: beta.beta >= 1.6 ? 'caution' : 'neutral',
      values: { beta: beta.beta, r2: Math.round(beta.r2 * 100), samples: beta.samples }
    });
  }

  if (cycle) {
    facts.push({
      id: `cycle.${cycle.band}`,
      kind: cycle.band === 'farFromHigh' || cycle.band === 'deepDrawdown' ? 'caution' : 'neutral',
      values: cycle.values
    });
  }

  return { regime, beta, cycle, facts };
}
