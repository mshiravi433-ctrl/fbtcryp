/** Local, opt-in-by-use audit of forecasts that were actually shown on this
 * device. No wallet identifiers, values, addresses, news or remote writes.
 * Retroactive walk-forward backtests live elsewhere; this is real issuance.
 */
import { cleanScenarioBars, SCENARIO_VERSION } from "./scenario2.js";
export const SCENARIO_JOURNAL_KEY = "fbt.scenario-forecast-journal.v1";
const LIMIT = 240;
const finite = (v) => typeof v === "number" && Number.isFinite(v);
const buckets = ["bear", "base", "bull"];
const category = (pct, band) =>
  pct > band ? "bull" : pct < -band ? "bear" : "base";
const brier = (p, actual) =>
  buckets.reduce((s, k) => s + (p[k] - Number(k === actual)) ** 2, 0);

export function readScenarioJournal(storage) {
  try {
    const data = JSON.parse(storage?.getItem(SCENARIO_JOURNAL_KEY) || "[]");
    return Array.isArray(data)
      ? data
          .filter(
            (r) =>
              r?.version === SCENARIO_VERSION &&
              typeof r.asset === "string" &&
              r.asset.length <= 80 &&
              Number.isInteger(r.horizon) &&
              finite(r.asOf) &&
              finite(r.originPrice) &&
              r.originPrice > 0 &&
              finite(r.intervalMs) &&
              finite(r.thresholdPct) &&
              buckets.every(
                (k) =>
                  finite(r.probabilities?.[k]) &&
                  r.probabilities[k] >= 0 &&
                  r.probabilities[k] <= 1,
              ),
          )
          .slice(-LIMIT)
      : [];
  } catch {
    return [];
  }
}
export function writeScenarioJournal(storage, entries) {
  try {
    storage?.setItem(
      SCENARIO_JOURNAL_KEY,
      JSON.stringify(entries.slice(-LIMIT)),
    );
    return true;
  } catch {
    return false;
  }
}

export function updateScenarioJournal(
  entries,
  { asset, bars, result, now = Date.now() } = {},
) {
  const src = cleanScenarioBars(bars);
  if (
    !result?.ok ||
    result.version !== SCENARIO_VERSION ||
    typeof asset !== "string" ||
    !/^[a-z0-9-]{2,80}$/i.test(asset) ||
    !src.length
  )
    return { entries: Array.isArray(entries) ? entries : [], issued: false };
  const h = result.horizonBars;
  const last = src.at(-1);
  const origin = src.find((b) => b.t === result.asOf);
  if (!Number.isInteger(h) || h < 1 || h > 14 || !origin || last.t !== origin.t)
    return { entries: entries || [], issued: false };
  const key = (r) =>
    r.asset === asset && r.horizon === h && r.version === SCENARIO_VERSION;
  const next = (Array.isArray(entries) ? entries : [])
    .slice(-LIMIT)
    .map((r) => {
      if (!key(r) || r.actual || !finite(r.asOf)) return r;
      const i = src.findIndex((b) => b.t === r.asOf);
      if (
        i < 0 ||
        i + h >= src.length ||
        Math.abs(r.intervalMs - result.intervalMs) > r.intervalMs * 0.2
      )
        return r;
      const target = src[i + h];
      // Every intervening bar must be present with roughly the issued cadence;
      // otherwise an outage would silently change a 3-day forecast into 6 days.
      if (
        src
          .slice(i + 1, i + h + 1)
          .some((b, j) => b.t - src[i + j].t > r.intervalMs * 1.5)
      )
        return r;
      const pct = (target.c / r.originPrice - 1) * 100;
      const actual = category(pct, r.thresholdPct);
      return {
        ...r,
        actual,
        resolvedAt: target.t,
        realisedPct: Number(pct.toFixed(3)),
        brier: Number(brier(r.probabilities, actual).toFixed(4)),
      };
    });
  const duplicate = next.some((r) => key(r) && r.asOf === origin.t);
  // The feed can serve an old last candle even though the target should have
  // occurred already. Do not log such a forecast as if it were made in time.
  const fresh =
    finite(now) && now >= origin.t && now - origin.t <= result.intervalMs * 2;
  let issued = false;
  if (
    !duplicate &&
    fresh &&
    buckets.every((k) => finite(result.probabilities[k]))
  ) {
    next.push({
      version: SCENARIO_VERSION,
      asset,
      horizon: h,
      asOf: origin.t,
      issuedAt: now,
      originPrice: origin.c,
      intervalMs: result.intervalMs,
      thresholdPct: result.thresholdPct,
      probabilities: Object.fromEntries(
        buckets.map((k) => [k, result.probabilities[k] / 100]),
      ),
    });
    issued = true;
  }
  return { entries: next.slice(-LIMIT), issued };
}

export function scenarioJournalScore(entries, asset, horizon) {
  const scoped = (Array.isArray(entries) ? entries : []).filter(
    (r) =>
      r.asset === asset &&
      r.horizon === horizon &&
      r.version === SCENARIO_VERSION,
  );
  const resolved = scoped.filter(
    (r) => buckets.includes(r.actual) && finite(r.brier),
  );
  return {
    issued: scoped.length,
    resolved: resolved.length,
    pending: scoped.length - resolved.length,
    brier: resolved.length
      ? Number(
          (resolved.reduce((s, r) => s + r.brier, 0) / resolved.length).toFixed(
            4,
          ),
        )
      : null,
    accuracyPct: resolved.length
      ? Number(
          (
            (100 *
              resolved.filter(
                (r) =>
                  buckets.reduce(
                    (a, k) => (r.probabilities[k] > r.probabilities[a] ? k : a),
                    "base",
                  ) === r.actual,
              ).length) /
            resolved.length
          ).toFixed(1),
        )
      : null,
  };
}

/** Only a mature device audit can affect the *displayed* scenario weights.
 * The backtested model and its score remain unchanged and independently shown. */
export function applyJournalCalibration(result, entries, asset) {
  if (!result?.ok) return result;
  const scoped = (Array.isArray(entries) ? entries : []).filter(
    (r) =>
      r.asset === asset &&
      r.horizon === result.horizonBars &&
      r.version === SCENARIO_VERSION &&
      buckets.includes(r.actual),
  );
  if (scoped.length < 20)
    return {
      ...result,
      liveCalibration: { applied: false, samples: scoped.length },
    };
  const prior = 30;
  const probabilities = Object.fromEntries(
    buckets.map((k) => [
      k,
      Number(
        (
          (result.probabilities[k] * prior +
            100 * scoped.filter((r) => r.actual === k).length) /
          (prior + scoped.length)
        ).toFixed(2),
      ),
    ]),
  );
  return {
    ...result,
    probabilities,
    liveCalibration: { applied: true, samples: scoped.length },
  };
}
