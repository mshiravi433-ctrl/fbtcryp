import test from "node:test";
import assert from "node:assert/strict";
import {
  evidenceSnapshot,
  readScenarioEvidence,
  recordScenarioEvidence,
} from "../server/scenarioArchive.js";
import { completedScenarioDays } from "../server/providers.js";
import { validateScenarioFactors } from "../src/lib/intelligence/scenarioFactors.js";
const DAY = 86400000;
const start = Date.UTC(2025, 0, 1);
const sign = (i) => ((Math.imul(i + 15, 1103515245) >>> 14) & 1 ? 1 : -1);
function sample(n = 285) {
  const history = Array.from({ length: n }, (_, i) => ({
    schema: "fbt.scenario-evidence.v1",
    day: new Date(start + i * DAY).toISOString().slice(0, 10),
    recordedAt: start + i * DAY + 18 * 3600000,
    effrPct: 4,
    stableSupply24hUsd: sign(i) * 1e7,
    headlineCount: 4,
    yield10yPct: null,
    exchangeDeposit24hUsd: null,
  }));
  let price = 100;
  const bars = Array.from({ length: n }, (_, i) => {
    if (i) price *= Math.exp(0.038 * sign(i - 3) + 0.002 * Math.sin(i * 3));
    return { t: start + i * DAY, c: price };
  });
  return { history, bars };
}
test("daily snapshot is immutable, point-in-time, and requires a real source after UTC 18h", async () => {
  const at = start + 18 * 3600000;
  const context = {
    ok: true,
    schema: "fbt.scenario-context.v1",
    at,
    quotes: { EFFR: { status: "OK", value: 4, source: "fred:DFF" } },
    stablecoin: { status: "OK", net24hUsd: -200, source: "defillama" },
    exchange: { status: "UNAVAILABLE" },
    headlines: { status: "UNAVAILABLE" },
  };
  assert.equal(evidenceSnapshot(context, at - 1), null);
  const row = evidenceSnapshot(context, at);
  assert.equal(row.effrPct, 4);
  assert.equal(row.headlineCount, null);
  assert.equal(row.provenance.stable, "defillama");
  assert.equal(evidenceSnapshot({ ...context, ok: false }, at), null);
  const stored = new Map();
  const write = async (key, value) => {
    if (stored.has(key)) return false;
    stored.set(key, value);
    return true;
  };
  assert.equal(
    (
      await recordScenarioEvidence(context, {
        now: at,
        configured: () => false,
        write,
      })
    ).status,
    "NOT_CONFIGURED",
  );
  assert.equal(
    (
      await recordScenarioEvidence(context, {
        now: at,
        configured: () => true,
        write,
      })
    ).written,
    true,
  );
  assert.equal(
    (
      await recordScenarioEvidence(context, {
        now: at + 1,
        configured: () => true,
        write,
      })
    ).written,
    false,
  );
  const archived = await readScenarioEvidence({
    now: at + DAY,
    days: 2,
    configured: () => true,
    multiGet: async (keys) => keys.map((key) => stored.get(key) ?? null),
  });
  assert.equal(archived.rows.length, 1);
  assert.equal(archived.rows[0].recordedAt, at);
});
test("factors abstain without aligned history, durable evidence or daily prices", () => {
  const { bars, history } = sample();
  assert.equal(validateScenarioFactors({ bars, history: [] }).validated, false);
  assert.equal(
    validateScenarioFactors({ bars: bars.slice(0, 90), history }).validated,
    false,
  );
  assert.equal(
    validateScenarioFactors({
      bars: bars.filter((_, i) => i % 4 === 0),
      history,
    }).reason,
    "INSUFFICIENT_PRICE_HISTORY",
  );
  const sparse = validateScenarioFactors({
    bars,
    history: history.filter((_, i) => i % 4 === 0),
  });
  assert.equal(sparse.validated, false);
});
test("strict embargo and disjoint walk-forward can validate a genuine association, not causality", () => {
  const { bars, history } = sample();
  const result = validateScenarioFactors({ bars, horizon: 1, history });
  assert.equal(result.status, "VALIDATED", JSON.stringify(result));
  assert.ok(result.heldOut >= 20);
  assert.ok(result.conditionalBrier + 0.02 < result.baselineBrier);
  assert.ok(result.lowerBound > 0);
  assert.ok(
    Math.abs(
      Object.values(result.probabilities).reduce((a, b) => a + b, 0) - 100,
    ) < 0.02,
  );
  // Recording a future observation now cannot change an earlier evaluation.
  const extra = {
    ...history[0],
    recordedAt: bars.at(-1).t + DAY,
    stableSupply24hUsd: -999999999,
  };
  assert.deepEqual(
    validateScenarioFactors({ bars, horizon: 1, history: [...history, extra] }),
    result,
  );
  // Deliberately mis-timestamp all evidence AFTER the price bars: fail closed.
  assert.equal(
    validateScenarioFactors({
      bars,
      horizon: 1,
      history: history.map((r) => ({
        ...r,
        recordedAt: r.recordedAt + 500 * DAY,
      })),
    }).validated,
    false,
  );
});

test("daily source timestamps completed buckets AFTER their last sample and refuses the current day", () => {
  const now = start + 4 * DAY + 10 * 3600000;
  const rows = [
    { t: start + 2 * DAY, c: 100 },
    { t: start + 3 * DAY, c: 110 },
    { t: start + 4 * DAY, c: 120 },
  ];
  assert.deepEqual(completedScenarioDays(rows, now), [
    { t: start + 3 * DAY, c: 100 },
    { t: start + 4 * DAY, c: 110 },
  ]);
});
test("insufficient out-of-sample improvement never changes the price-only odds", () => {
  const { history } = sample();
  const independent = history.map((r, i) => ({
    ...r,
    stableSupply24hUsd: i % 2 ? 1e7 : -1e7,
  }));
  let price = 100;
  const bars = history.map((_, i) => {
    if (i) price *= Math.exp(0.02 * Math.sin(i * 17.31));
    return { t: start + i * DAY, c: price };
  });
  const result = validateScenarioFactors({
    bars,
    history: independent,
    horizon: 1,
  });
  assert.equal(result.status, "NOT_VALIDATED");
  assert.equal(result.reason, "NO_HELD_OUT_GAIN");
  assert.equal(result.probabilities, undefined);
});
