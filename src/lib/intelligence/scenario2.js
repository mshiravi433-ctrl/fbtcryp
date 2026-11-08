/** Scenario Intelligence 2.0 — historical, walk-forward estimates, never trade signals.
 * Forecasts are evaluated only after their outcome bar exists. No wallet data
 * is persisted or sent to a model; probabilities are local empirical estimates.
 */
export const SCENARIO_VERSION = "scenario-intelligence-2.0.1";
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
const mean = (xs) => xs.reduce((s, x) => s + x, 0) / xs.length;
const sd = (xs) => {
  const m = mean(xs);
  return Math.sqrt(mean(xs.map((x) => (x - m) ** 2)));
};
const round = (x, digits = 2) => Number(x.toFixed(digits));
const quantile = (sorted, q) => sorted[Math.floor((sorted.length - 1) * q)];
const TYPES = ["bear", "base", "bull"];

export function cleanScenarioBars(bars) {
  if (!Array.isArray(bars)) return [];
  const unique = new Map();
  for (const b of bars) {
    if (Number.isFinite(b?.t) && Number.isFinite(b?.c) && b.c > 0)
      unique.set(b.t, { t: b.t, c: b.c });
  }
  return [...unique.values()].sort((a, b) => a.t - b.t);
}

/** Rebalanced price-return index on timestamp intersections only; missing assets
 * are not quietly treated as cash. Returns coverage separately for disclosure. */
export function portfolioScenarioBars(assets, holdings) {
  const valid = (holdings || []).filter(
    (h) => Number.isFinite(h.valueUsd) && h.valueUsd > 0,
  );
  const total = valid.reduce((s, h) => s + h.valueUsd, 0);
  const included = valid.filter(
    (h) => cleanScenarioBars(assets?.[h.id]).length >= 50,
  );
  if (!included.length || !Number.isFinite(total) || !total)
    return {
      bars: [],
      coveragePct: 0,
      included: [],
      excluded: valid.map((h) => h.id),
    };
  const series = included.map(
    (h) => new Map(cleanScenarioBars(assets[h.id]).map((b) => [b.t, b.c])),
  );
  const dates = [...series[0].keys()]
    .filter((t) => series.every((s) => s.has(t)))
    .sort((a, b) => a - b);
  let value = 100;
  const bars = dates.map((t, i) => {
    if (i) {
      const change = included.reduce(
        (s, h, j) =>
          s + h.valueUsd * (series[j].get(t) / series[j].get(dates[i - 1]) - 1),
        0,
      );
      value *= 1 + change / included.reduce((s, h) => s + h.valueUsd, 0);
    }
    return { t, c: value };
  });
  return {
    bars,
    coveragePct: round(
      (100 * included.reduce((s, h) => s + h.valueUsd, 0)) / total,
      1,
    ),
    included: included.map((h) => h.id),
    excluded: valid.filter((h) => !included.includes(h)).map((h) => h.id),
  };
}

function regime(returns) {
  const recent = sd(returns.slice(-12));
  const prior = sd(returns.slice(-36));
  if (recent > prior * 1.35 && recent > 0.00001) return "volatile";
  const direction = Math.abs(mean(returns.slice(-10))) * Math.sqrt(10);
  return direction > prior * 0.8 ? "trend" : "range";
}
function threshold(returns, h) {
  return Math.max(0.002, sd(returns.slice(-30)) * Math.sqrt(h) * 0.6);
}
function category(ret, band) {
  return ret > band ? "bull" : ret < -band ? "bear" : "base";
}
function forecast(returns, h) {
  const band = threshold(returns, h);
  const r = regime(returns);
  const momentum = (mean(returns.slice(-10)) * h) / band;
  const tilt = clamp(momentum, -1.5, 1.5) * (r === "volatile" ? 0.55 : 1);
  const trend = { bear: 0.3 - tilt * 0.15, base: 0.4, bull: 0.3 + tilt * 0.15 };
  // Historical replay uses only fully matured h-bar observations at this index.
  const observations = [];
  for (let j = 30; j + h <= returns.length; j++) {
    const pastBand = threshold(returns.slice(0, j), h);
    observations.push(
      category(
        returns.slice(j, j + h).reduce((a, b) => a + b, 0),
        pastBand,
      ),
    );
  }
  const counts = Object.fromEntries(
    TYPES.map((k) => [k, observations.filter((v) => v === k).length + 3]),
  );
  const replay = Object.fromEntries(
    TYPES.map((k) => [k, counts[k] / (observations.length + 9)]),
  );
  return { trend, replay, band, regime: r, replayCount: observations.length };
}
function brier(p, actual) {
  return TYPES.reduce((s, k) => s + (p[k] - Number(k === actual)) ** 2, 0);
}
function score(records, model) {
  if (!records.length)
    return { samples: 0, brier: null, accuracyPct: null, score: null };
  const error = mean(records.map((row) => brier(row[model], row.actual)));
  return {
    samples: records.length,
    brier: round(error, 4),
    accuracyPct: round(
      (100 *
        records.filter(
          (row) =>
            TYPES.reduce(
              (a, k) => (row[model][k] > row[model][a] ? k : a),
              "base",
            ) === row.actual,
        ).length) /
        records.length,
      1,
    ),
    score: round(100 * (1 - error / 2), 1),
  };
}
/** Similar-forecast calibration, with Laplace prior on the raw probabilities.
 * Sparse history stays explicitly uncalibrated rather than claiming accuracy. */
function calibrate(p, records, model, r) {
  const same = records.filter(
    (row) =>
      row.regime === r &&
      TYPES.every((k) => Math.abs(row[model][k] - p[k]) <= 0.25),
  );
  if (same.length < 20)
    return { probabilities: p, samples: same.length, calibrated: false };
  const prior = 30;
  return {
    probabilities: Object.fromEntries(
      TYPES.map((k) => [
        k,
        (p[k] * prior + same.filter((row) => row.actual === k).length) /
          (prior + same.length),
      ]),
    ),
    samples: same.length,
    calibrated: true,
  };
}
/** Raw, point-in-time baseline for factor walk-forward validation. No later
 * performance weights, calibration rows, or target candles enter this read. */
export function rawScenarioForecast(pastReturns, horizon) {
  if (
    !Array.isArray(pastReturns) ||
    pastReturns.length < 50 ||
    !pastReturns.every(Number.isFinite) ||
    !Number.isInteger(horizon) ||
    horizon < 1 ||
    horizon > 14
  )
    return null;
  const f = forecast(pastReturns, horizon);
  return {
    probabilities: Object.fromEntries(
      TYPES.map((k) => [k, (f.trend[k] + f.replay[k]) / 2]),
    ),
    band: f.band,
  };
}

function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

export function buildScenarioIntelligence({
  bars,
  horizon = 3,
  notionalUsd = 1000,
  seed = 41,
} = {}) {
  const src = cleanScenarioBars(bars);
  const h = Number(horizon);
  if (
    !Number.isInteger(h) ||
    h < 1 ||
    h > 14 ||
    !Number.isFinite(notionalUsd) ||
    notionalUsd <= 0
  )
    return { ok: false, reason: "INVALID_INPUT" };
  if (src.length < 70 + h)
    return {
      ok: false,
      reason: "INSUFFICIENT_HISTORY",
      bars: src.length,
      required: 70 + h,
    };
  const gaps = src
    .slice(1)
    .map((b, i) => b.t - src[i].t)
    .sort((a, b) => a - b);
  const intervalMs = quantile(gaps, 0.5);
  if (intervalMs <= 0 || gaps.some((gap) => gap > intervalMs * 3))
    return { ok: false, reason: "IRREGULAR_HISTORY" };
  const returns = src.slice(1).map((b, i) => Math.log(b.c / src[i].c));
  if (!returns.every(Number.isFinite))
    return { ok: false, reason: "INVALID_HISTORY" };
  if (sd(returns) < 1e-8)
    return { ok: false, reason: "INSUFFICIENT_VARIATION" };
  const rows = [];
  for (let i = 50; i + h < src.length; i += h) {
    // non-overlapping resolved targets; no sample inflation
    const past = returns.slice(0, i); // prediction at bar i; return i begins AFTER bar i
    const f = forecast(past, h);
    const actual = category(
      returns.slice(i, i + h).reduce((a, b) => a + b, 0),
      f.band,
    );
    rows.push({
      origin: src[i].t,
      resolved: src[i + h].t,
      regime: f.regime,
      actual,
      trend: f.trend,
      replay: f.replay,
    });
  }
  if (rows.length < 10)
    return {
      ok: false,
      reason: "INSUFFICIENT_EVALUATION",
      resolvedBars: rows.length,
    };
  const current = forecast(returns, h);
  const performance = {
    trend: score(rows, "trend"),
    replay: score(rows, "replay"),
  };
  const weights = Object.fromEntries(
    ["trend", "replay"].map((k) => [
      k,
      rows.length >= 20 ? 1 / Math.max(0.15, performance[k].brier) : 1,
    ]),
  );
  const weightTotal = weights.trend + weights.replay;
  const trend = calibrate(current.trend, rows, "trend", current.regime);
  const replay = calibrate(current.replay, rows, "replay", current.regime);
  const probabilities = Object.fromEntries(
    TYPES.map((k) => [
      k,
      round(
        (100 *
          (trend.probabilities[k] * weights.trend +
            replay.probabilities[k] * weights.replay)) /
          weightTotal,
        2,
      ),
    ]),
  );
  // Nonparametric moving-block bootstrap preserves short bursts of correlated returns.
  const rand = rng(seed);
  const finals = [];
  for (let p = 0; p < 1200; p++) {
    let logReturn = 0;
    for (let step = 0; step < h; ) {
      const start = Math.floor(rand() * (returns.length - 3));
      for (let j = 0; j < 3 && step < h; j++, step++)
        logReturn += returns[start + j];
    }
    finals.push(notionalUsd * (Math.exp(logReturn) - 1));
  }
  finals.sort((a, b) => a - b);
  const pct = Object.fromEntries(
    [5, 10, 50, 90, 95].map((q) => [`p${q}`, round(quantile(finals, q / 100))]),
  );
  const latest = src.at(-1);
  return {
    ok: true,
    version: SCENARIO_VERSION,
    asOf: latest.t,
    intervalMs,
    horizonBars: h,
    resolvedBars: rows.length,
    regime: current.regime,
    thresholdPct: round(100 * (Math.exp(current.band) - 1), 2),
    probabilities,
    calibration: {
      trend: { samples: trend.samples, calibrated: trend.calibrated },
      replay: { samples: replay.samples, calibrated: replay.calibrated },
    },
    performance,
    notionalUsd,
    uncertaintyUsd: pct,
    probabilityOfLossPct: round(
      (100 * finals.filter((x) => x < 0).length) / finals.length,
      1,
    ),
    method:
      "walk-forward log-return classification, matured outcomes only; moving-block historical bootstrap",
    caveat:
      "Empirical estimates, not reliable odds or investment advice. No news, rates or whale feed is included.",
  };
}

/** Pairwise same-timestamp return correlations; refuses short or flat series. */
export function scenarioCorrelations(assets, ids) {
  const out = [];
  for (let i = 0; i < ids.length; i++)
    for (let j = i + 1; j < ids.length; j++) {
      const left = cleanScenarioBars(assets?.[ids[i]]);
      const right = new Map(
        cleanScenarioBars(assets?.[ids[j]]).map((b) => [b.t, b.c]),
      );
      const matched = left.filter((b) => right.has(b.t));
      if (matched.length < 30) continue;
      const a = matched.slice(1).map((b, k) => Math.log(b.c / matched[k].c));
      const b = matched
        .slice(1)
        .map((row, k) => Math.log(right.get(row.t) / right.get(matched[k].t)));
      const sa = sd(a);
      const sb = sd(b);
      if (!sa || !sb) continue;
      const ma = mean(a);
      const mb = mean(b);
      out.push({
        a: ids[i],
        b: ids[j],
        correlation: round(
          clamp(
            mean(a.map((v, k) => (v - ma) * (b[k] - mb))) / (sa * sb),
            -1,
            1,
          ),
          2,
        ),
        samples: a.length,
      });
    }
  return out;
}

/** Conditional what-if, not a likelihood estimate. An exit haircut is only
 * applied to negative exits; returns are changes relative to initial value. */
export function stressScenario({ valueUsd, shockPct, exitHaircutPct = 0 }) {
  if (
    ![valueUsd, shockPct, exitHaircutPct].every(Number.isFinite) ||
    valueUsd <= 0 ||
    shockPct < -95 ||
    shockPct > 300 ||
    exitHaircutPct < 0 ||
    exitHaircutPct > 50
  )
    return null;
  const after = valueUsd * (1 + shockPct / 100) * (1 - exitHaircutPct / 100);
  return {
    beforeUsd: valueUsd,
    afterUsd: round(after),
    deltaUsd: round(after - valueUsd),
    conditional: true,
  };
}
export function reverseStress(valueUsd, lossTargetPct = 30) {
  if (
    !Number.isFinite(valueUsd) ||
    valueUsd <= 0 ||
    !Number.isFinite(lossTargetPct) ||
    lossTargetPct <= 0 ||
    lossTargetPct >= 100
  )
    return null;
  for (let shock = 0; shock >= -95; shock--) {
    for (const haircut of [0, 2, 5, 10]) {
      const result = stressScenario({
        valueUsd,
        shockPct: shock,
        exitHaircutPct: haircut,
      });
      if (result && (-result.deltaUsd / valueUsd) * 100 >= lossTargetPct)
        return { shockPct: shock, exitHaircutPct: haircut, ...result };
    }
  }
  return null;
}
