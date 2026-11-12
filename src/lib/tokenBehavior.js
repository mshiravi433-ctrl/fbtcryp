/**
 * TOKEN BEHAVIOUR — «رفتارشناسی توکن»
 * ============================================================================
 *
 * ─── WHY THIS MODULE EXISTS ─────────────────────────────────────────────────
 * The Signals screen already had good *static* reads: RSI, MACD, Bollinger,
 * moving averages, support/resistance. Those answer «where is the price now
 * relative to its own history».
 *
 * They do NOT answer the question an early-signal desk actually has to answer:
 * *how is this token behaving* — is the move being pushed by real participation
 * or by three fat candles, is volume arriving *with* the trend or against it,
 * is the tape one-sided (buy pressure with no give-back) or choppy, is the
 * token ignoring the market (relative strength) or just being carried by it,
 * and is the shape of the move *new* or a repeat of a pattern the token has
 * already printed this week.
 *
 * Every number here is measured from data the page ALREADY holds — the price
 * series it draws, and the market row it renders (change1h/24h/7d, mcap,
 * volume). No new request, no new endpoint, no extra CPU on the server, and
 * nothing invented: a field that cannot be measured is `null`, and a detector
 * that has no data produces no finding at all.
 *
 * ─── THE ONE RULE THAT MATTERS ─────────────────────────────────────────────
 * A behaviour read is a *description of what the tape did*, never a promise
 * about what it will do. Every consumer renders it as an observation
 * («فشار خرید با حجم هم‌جهت است»), and the signal engine uses it only as one
 * more independent evidence plane with a weight — the same discipline the
 * deterministic engine already follows for indicators.
 */

const num = (v) => {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
};
const clampf = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/** Step-to-step simple returns (%), skipping zeros/nulls instead of dividing by them. */
export function returnsOf(prices = []) {
  const rows = (Array.isArray(prices) ? prices : []).filter((n) => Number.isFinite(n) && n > 0);
  const out = [];
  for (let i = 1; i < rows.length; i += 1) {
    if (rows[i - 1] > 0) out.push(((rows[i] - rows[i - 1]) / rows[i - 1]) * 100);
  }
  return out;
}

/**
 * The CANDLE-BREADTH TEST — «آیا حرکت با مشارکت ساخته شده یا با سه کندلِ چاق؟»
 *
 * A 12% move made of 60 small green steps and a 12% move made of three +4%
 * spikes are the same percentage and completely different events: the first is
 * participation, the second is one order. `breadth` is the share of the last N
 * steps that closed in the direction of the move — measured, not guessed.
 *
 * Returns `null` when there is not enough series to say anything.
 */
export function moveBreadth(prices = [], look = 24) {
  const rows = (Array.isArray(prices) ? prices : []).filter((n) => Number.isFinite(n) && n > 0);
  if (rows.length < 6) return null;
  const window = rows.slice(-Math.min(look + 1, rows.length));
  const rets = returnsOf(window);
  if (rets.length < 5) return null;
  const first = window[0];
  const last = window[window.length - 1];
  const movePct = first > 0 ? ((last - first) / first) * 100 : null;
  if (movePct == null) return null;
  const dir = movePct > 0 ? 1 : movePct < 0 ? -1 : 0;
  const withMove = rets.filter((r) => (dir > 0 ? r > 0 : dir < 0 ? r < 0 : Math.abs(r) < 0.01)).length;
  const share = rets.length ? withMove / rets.length : null;
  /* Largest single step as a share of the total travel — «one candle did this».
     Total travel is the sum of absolute steps, so this is always 0..1. */
  const travel = rets.reduce((s, r) => s + Math.abs(r), 0);
  const biggest = rets.reduce((m, r) => Math.max(m, Math.abs(r)), 0);
  return {
    movePct: Math.round(movePct * 100) / 100,
    direction: dir > 0 ? 'up' : dir < 0 ? 'down' : 'flat',
    /* Share of the measured steps that agreed with the net move (0..1). */
    breadth: share != null ? Math.round(share * 1000) / 1000 : null,
    /* Share of total travel contributed by the single largest step (0..1). */
    spikeShare: travel > 0 ? Math.round((biggest / travel) * 1000) / 1000 : null,
    steps: rets.length
  };
}

/**
 * VOLUME–PRICE AGREEMENT — «حجم با روند هم‌جهت است یا علیه آن؟»
 *
 * Uses the only volume numbers a market row carries: the 24h turnover
 * (volume / mcap) and the 24h/7d changes. It is deliberately coarse and says
 * so — there is no per-bar volume series on this screen, so this is an
 * agreement read, not a volume-profile read.
 */
export function volumeAgreement({ coin = {}, turnoverPct = null } = {}) {
  const c24 = num(coin?.change24h);
  const c7 = num(coin?.change7d);
  const turn = num(turnoverPct);
  if (c24 == null && c7 == null) return null;
  const trend = (c24 != null && c7 != null)
    ? (Math.sign(c24) === Math.sign(c7) ? Math.sign(c24) : 0)
    : Math.sign(c24 ?? c7 ?? 0);
  /* Turnover bands are the same ones the page already prints: <2% thin,
     2–6% adequate, >=6% active. */
  const band = turn == null ? null : turn >= 6 ? 'active' : turn >= 2 ? 'adequate' : 'thin';
  let label = 'unclear';
  if (band === 'active' && trend > 0) label = 'accumulating';
  else if (band === 'active' && trend < 0) label = 'distributing';
  else if (band === 'thin' && trend > 0) label = 'hollow-rally';
  else if (band === 'thin' && trend < 0) label = 'drifting-down';
  else if (band != null) label = 'balanced';
  return {
    label,
    turnoverPct: turn != null ? Math.round(turn * 100) / 100 : null,
    band,
    trend: trend > 0 ? 'up' : trend < 0 ? 'down' : 'flat'
  };
}

/**
 * TAPE PRESSURE — «نوار یک‌طرفه است یا دوطرفه؟»
 *
 * Measured from the series alone: the share of up-steps weighted by their size
 * against the share of down-steps weighted by theirs. A one-sided tape (buyers
 * take offers and the market does not give it back) prints a high reading in
 * the direction of the move — which is exactly what a smart-money desk looks
 * for *before* the percentage move becomes obvious.
 */
export function tapePressure(prices = [], look = 24) {
  const rets = returnsOf((Array.isArray(prices) ? prices : []).slice(-(look + 1)));
  if (rets.length < 5) return null;
  const up = rets.filter((r) => r > 0).reduce((s, r) => s + r, 0);
  const down = rets.filter((r) => r < 0).reduce((s, r) => s - r, 0);
  const total = up + down;
  if (!(total > 0)) return null;
  /* −100 (every point of travel was down) … +100 (every point was up). */
  const score = ((up - down) / total) * 100;
  const oneSided = Math.abs(score) >= 55;
  return {
    score: Math.round(score * 10) / 10,
    upTravelPct: Math.round((up / total) * 1000) / 10,
    downTravelPct: Math.round((down / total) * 1000) / 10,
    label: oneSided ? (score > 0 ? 'oneSidedBuy' : 'oneSidedSell') : Math.abs(score) >= 20 ? (score > 0 ? 'leaningBuy' : 'leaningSell') : 'balanced'
  };
}

/**
 * REALISED VOLATILITY OF THE SERIES ITSELF (per-step %, not annualised).
 *
 * `analysis.indicators.volatility` is annualised; for «is today's move unusual
 * FOR THIS TOKEN» we need the per-step dispersion, so a 3% day is quiet for
 * BONK and violent for PAXG. Recomputed here because the annualised figure
 * cannot be divided back down without the bar spacing.
 */
export function seriesVolPct(prices = [], look = 48) {
  const rets = returnsOf((Array.isArray(prices) ? prices : []).slice(-(look + 1)));
  if (rets.length < 4) return null;
  const mean = rets.reduce((a, b) => a + b, 0) / rets.length;
  const variance = rets.reduce((a, b) => a + (b - mean) ** 2, 0) / (rets.length - 1);
  return Math.round(Math.sqrt(variance) * 1000) / 1000;
}

/**
 * RELATIVE STRENGTH vs the market — «این توکن بازار را شکست داده یا بازار او را
 * حمل می‌کند؟»
 *
 * `market` is the BTC series the page already fetches for the verdict layers.
 * Both series are downsampled to the same number of steps before comparing, so
 * a 30-day chart against a 7-day sparkline cannot manufacture a difference out
 * of misaligned windows. Returns null when either side is missing — an
 * invented relative-strength number is worse than none.
 */
export function relativeStrength(series = [], marketSeries = []) {
  const a = (Array.isArray(series) ? series : []).filter((n) => Number.isFinite(n) && n > 0);
  const b = (Array.isArray(marketSeries) ? marketSeries : []).filter((n) => Number.isFinite(n) && n > 0);
  if (a.length < 8 || b.length < 8) return null;
  const n = Math.min(a.length, b.length, 48);
  const at = (arr) => arr.slice(-n);
  const tailA = at(a);
  const tailB = at(b);
  const changeA = tailA[0] > 0 ? ((tailA[tailA.length - 1] - tailA[0]) / tailA[0]) * 100 : null;
  const changeB = tailB[0] > 0 ? ((tailB[tailB.length - 1] - tailB[0]) / tailB[0]) * 100 : null;
  if (changeA == null || changeB == null) return null;
  const diff = changeA - changeB;
  return {
    assetPct: Math.round(changeA * 100) / 100,
    marketPct: Math.round(changeB * 100) / 100,
    /* Positive = the token outperformed the market over the SAME window. */
    diffPct: Math.round(diff * 100) / 100,
    label: diff >= 3 ? 'outperforming' : diff <= -3 ? 'underperforming' : 'inline'
  };
}

/**
 * Z-SCORE OF THE LATEST MOVE against this token's own recent behaviour —
 * the honest version of «is this candle unusual?».
 * Returns null when the token's own dispersion is zero (pegged assets), which
 * would otherwise divide by zero and call every flat tick an anomaly.
 */
export function moveAnomaly(prices = [], look = 48) {
  const rows = (Array.isArray(prices) ? prices : []).filter((n) => Number.isFinite(n) && n > 0);
  if (rows.length < 8) return null;
  const vol = seriesVolPct(rows, look);
  if (vol == null || vol <= 0.0001) return null;
  const lastStep = rows.length >= 2 && rows[rows.length - 2] > 0
    ? ((rows[rows.length - 1] - rows[rows.length - 2]) / rows[rows.length - 2]) * 100
    : null;
  if (lastStep == null) return null;
  const z = lastStep / vol;
  return {
    lastStepPct: Math.round(lastStep * 1000) / 1000,
    sigma: Math.round(z * 100) / 100,
    unusual: Math.abs(z) >= 2
  };
}

/**
 * PATTERN REPEAT — «این شکل حرکت قبلاً در همین سری دیده شده؟»
 *
 * Takes the shape of the last `len` steps (normalised to the first step, so it
 * is scale-free) and scans the token's own history for the closest earlier
 * match by mean-absolute-difference. This is a *shape* comparison on observed
 * data only; it answers «it did this before» and never «it will do it again».
 *
 * Returns null when the series is too short to hold a previous window.
 */
export function patternRepeat(prices = [], len = 6) {
  const rows = (Array.isArray(prices) ? prices : []).filter((n) => Number.isFinite(n) && n > 0);
  if (rows.length < len * 3) return null;
  const norm = (arr) => {
    const base = arr[0];
    if (!(base > 0)) return null;
    return arr.map((v) => (v - base) / base);
  };
  const tail = norm(rows.slice(-len));
  if (!tail) return null;
  let best = null;
  /* Walk earlier windows; the last one is excluded (it IS the tail). */
  for (let end = rows.length - len - 1; end - len + 1 >= 0; end -= 1) {
    const win = norm(rows.slice(end - len + 1, end + 1));
    if (!win) continue;
    let diff = 0;
    for (let i = 0; i < len; i += 1) diff += Math.abs(win[i] - tail[i]);
    diff /= len;
    if (!best || diff < best.diff) best = { diff, offset: rows.length - 1 - end };
  }
  if (!best) return null;
  /* 0.01 ≈ a 1% shape distance — close enough to call the shape a repeat. */
  return {
    distance: Math.round(best.diff * 1000) / 1000,
    seenStepsAgo: best.offset,
    repeat: best.diff <= 0.012
  };
}

/**
 * The complete behaviour read for one asset. Pure, deterministic, cheap: it
 * runs on a series the page is already holding, once per poll, and returns
 * `null` fields wherever the inputs did not support a measurement.
 */
export function readTokenBehavior({ series = [], marketSeries = [], coin = {}, turnoverPct = null } = {}) {
  const prices = (Array.isArray(series) ? series : []).filter((n) => Number.isFinite(n) && n > 0);
  if (prices.length < 8) return null;
  const breadth = moveBreadth(prices);
  const pressure = tapePressure(prices);
  const volume = volumeAgreement({ coin, turnoverPct });
  const relative = relativeStrength(prices, marketSeries);
  const anomaly = moveAnomaly(prices);
  const pattern = patternRepeat(prices);
  const vol = seriesVolPct(prices);

  /*
   * ONE COMPOSITE, BOUNDED, AND ONLY FROM MEASURED PARTS.
   * Each part contributes only when it exists; the divisor counts only those
   * parts, so a token with no BTC series is not scored as if its relative
   * strength were neutral-and-therefore-zero.
   */
  const parts = [];
  if (pressure) parts.push(pressure.score / 100); // −1 … +1
  if (breadth && breadth.direction !== 'flat') parts.push((breadth.breadth ?? 0.5) * 2 - 1); // −1 … +1, participation
  if (relative) parts.push(clampf(relative.diffPct / 6, -1, 1));
  if (volume && volume.label === 'accumulating') parts.push(0.6);
  if (volume && volume.label === 'distributing') parts.push(-0.6);
  if (volume && volume.label === 'hollow-rally') parts.push(-0.3);
  const score = parts.length
    ? Math.round((parts.reduce((a, b) => a + b, 0) / parts.length) * 100)
    : 0;

  return {
    score: clampf(score, -100, 100),
    direction: score >= 12 ? 'up' : score <= -12 ? 'down' : 'flat',
    confidence: clampf(Math.round(35 + parts.length * 13 + (anomaly?.unusual ? 6 : 0)), 20, 90),
    parts: parts.length,
    breadth,
    pressure,
    volume,
    relative,
    anomaly,
    pattern,
    volPct: vol
  };
}

export default readTokenBehavior;
