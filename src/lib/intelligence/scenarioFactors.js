/** Historical conditional associations, NOT causal inference.
 * Inputs are immutable point-in-time snapshots captured prospectively by the
 * server. No backfilled RSS/whale events and no revised-rate vintages.
 * An overlay is shown only if a predeclared matcher beats a price-only
 * point-in-time baseline on disjoint, forward-held-out horizons.
 */
import { cleanScenarioBars, rawScenarioForecast } from "./scenario2.js";
const DAY = 86400000;
const KEYS = ["effr", "yield", "stable", "exchange", "headlines"];
const TYPES = ["bear", "base", "bull"];
const finite = (x) => typeof x === "number" && Number.isFinite(x);
const brier = (p, a) =>
  TYPES.reduce((s, k) => s + (p[k] - Number(k === a)) ** 2, 0);
const category = (ret, band) =>
  ret > band ? "bull" : ret < -band ? "bear" : "base";
const avg = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
const sign = (x) => (x < 0 ? -1 : x > 0 ? 1 : 0);

function evidenceFor(origin, history) {
  // One day embargo: even an OHLC bar stamped at its *opening* cannot see a
  // headline or yield published later that day. No nearest-future joins.
  const candidates = history.filter(
    (r) =>
      finite(r.recordedAt) &&
      r.recordedAt <= origin - DAY &&
      r.recordedAt >= origin - 3 * DAY,
  );
  return candidates.at(-1) || null;
}
function features(row, history) {
  if (!row) return null;
  const prev = history
    .filter(
      (r) =>
        finite(r.recordedAt) &&
        r.recordedAt < row.recordedAt &&
        r.recordedAt >= row.recordedAt - 3 * DAY,
    )
    .at(-1);
  const vector = {
    effr:
      finite(row.effrPct) && finite(prev?.effrPct)
        ? sign(row.effrPct - prev.effrPct)
        : null,
    yield:
      finite(row.yield10yPct) && finite(prev?.yield10yPct)
        ? sign(row.yield10yPct - prev.yield10yPct)
        : null,
    stable: finite(row.stableSupply24hUsd)
      ? sign(row.stableSupply24hUsd)
      : null,
    exchange:
      finite(row.exchangeDeposit24hUsd) && row.exchangeCoverage >= 0.5
        ? sign(row.exchangeDeposit24hUsd)
        : null,
    // News volume, NOT sentiment. A headline does not have a price direction.
    headlines: finite(row.headlineCount)
      ? Number(row.headlineCount >= 3)
      : null,
  };
  return KEYS.filter((k) => vector[k] !== null).length >= 2 ? vector : null;
}
function comparable(a, b) {
  const maskA = KEYS.filter((k) => a[k] !== null);
  const maskB = KEYS.filter((k) => b[k] !== null);
  return (
    maskA.length >= 2 &&
    maskA.join("|") === maskB.join("|") &&
    maskA.every((k) => a[k] === b[k])
  );
}
function conditional(base, current, past) {
  const matched = past.filter((r) => comparable(current, r.features));
  if (matched.length < 15) return null;
  const prior = 30;
  return {
    probabilities: Object.fromEntries(
      TYPES.map((k) => [
        k,
        (base[k] * prior + matched.filter((r) => r.actual === k).length) /
          (prior + matched.length),
      ]),
    ),
    matched: matched.length,
  };
}
function lowerBootstrap(differences) {
  // Predeclared paired one-sided 10th percentile, seeded for reproducibility.
  let seed = 6041;
  const rand = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const means = Array.from({ length: 400 }, () =>
    avg(
      differences.map(
        () => differences[Math.floor(rand() * differences.length)],
      ),
    ),
  );
  return means.sort((a, b) => a - b)[40];
}
export function validateScenarioFactors({
  bars,
  horizon = 3,
  history = [],
} = {}) {
  const src = cleanScenarioBars(bars);
  const h = Number(horizon);
  const unavailable = (reason, info = {}) => ({
    status: "COLLECTING",
    reason,
    validated: false,
    ...info,
  });
  if (
    !Number.isInteger(h) ||
    h < 1 ||
    h > 14 ||
    src.length < 75 + h ||
    !Array.isArray(history)
  )
    return unavailable("INSUFFICIENT_PRICE_HISTORY");
  const gaps = src
    .slice(1)
    .map((b, i) => b.t - src[i].t)
    .sort((a, b) => a - b);
  const interval = gaps[Math.floor(gaps.length / 2)];
  // The archived factor is daily. 4-hour/4-day OHLC is not aligned daily data.
  if (Math.abs(interval - DAY) > DAY * 0.2 || gaps.some((g) => g > DAY * 1.5))
    return unavailable("DAILY_ALIGNMENT_REQUIRED");
  const archive = history
    .filter(
      (r) => r?.schema === "fbt.scenario-evidence.v1" && finite(r.recordedAt),
    )
    .sort((a, b) => a.recordedAt - b.recordedAt);
  const returns = src.slice(1).map((b, i) => Math.log(b.c / src[i].c));
  if (!returns.every(Number.isFinite))
    return unavailable("INVALID_PRICE_HISTORY");
  const observations = [];
  for (let i = 50; i + h < src.length; i += h) {
    const evidence = evidenceFor(src[i].t, archive);
    const vector = features(evidence, archive);
    if (!vector) continue;
    const base = rawScenarioForecast(returns.slice(0, i), h);
    const outcome = category(
      returns.slice(i, i + h).reduce((a, b) => a + b, 0),
      base.band,
    );
    observations.push({
      origin: src[i].t,
      resolved: src[i + h].t,
      features: vector,
      base: base.probabilities,
      actual: outcome,
    });
  }
  if (observations.length < 50)
    return unavailable("INSUFFICIENT_ALIGNED_HISTORY", {
      aligned: observations.length,
      required: 50,
    });
  const evaluated = [];
  for (let i = 30; i < observations.length; i++) {
    const row = observations[i];
    // Only outcomes resolved BEFORE this origin can train its conditional.
    const eligible = observations
      .slice(0, i)
      .filter((r) => r.resolved <= row.origin);
    const proposed = conditional(row.base, row.features, eligible);
    if (!proposed) continue;
    evaluated.push({
      origin: row.origin,
      baseline: brier(row.base, row.actual),
      conditional: brier(proposed.probabilities, row.actual),
    });
  }
  if (evaluated.length < 20)
    return unavailable("INSUFFICIENT_HELD_OUT", {
      aligned: observations.length,
      heldOut: evaluated.length,
      required: 20,
    });
  const differences = evaluated.map((x) => x.baseline - x.conditional);
  const gain = avg(differences);
  const lower = lowerBootstrap(differences);
  const metrics = {
    aligned: observations.length,
    heldOut: evaluated.length,
    baselineBrier: Number(avg(evaluated.map((x) => x.baseline)).toFixed(4)),
    conditionalBrier: Number(
      avg(evaluated.map((x) => x.conditional)).toFixed(4),
    ),
    improvement: Number(gain.toFixed(4)),
    lowerBound: Number(lower.toFixed(4)),
  };
  if (gain < 0.02 || lower <= 0)
    return {
      status: "NOT_VALIDATED",
      validated: false,
      reason: "NO_HELD_OUT_GAIN",
      ...metrics,
    };
  const currentEvidence = features(evidenceFor(src.at(-1).t, archive), archive);
  if (!currentEvidence)
    return unavailable("NO_CURRENT_ALIGNED_EVIDENCE", metrics);
  const base = rawScenarioForecast(returns, h);
  const mature = observations.filter((r) => r.resolved <= src.at(-1).t);
  const adjusted = conditional(base.probabilities, currentEvidence, mature);
  if (!adjusted) return unavailable("NO_CURRENT_COMPARABLE_SAMPLES", metrics);
  return {
    status: "VALIDATED",
    validated: true,
    ...metrics,
    matched: adjusted.matched,
    probabilities: Object.fromEntries(
      TYPES.map((k) => [
        k,
        Number((adjusted.probabilities[k] * 100).toFixed(2)),
      ]),
    ),
    notice:
      "Held-out historical association only; not evidence of causation or a trading instruction.",
  };
}
