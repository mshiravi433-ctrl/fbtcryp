import test from "node:test";
import assert from "node:assert/strict";
import {
  buildScenarioIntelligence,
  cleanScenarioBars,
  portfolioScenarioBars,
  scenarioCorrelations,
  stressScenario,
  reverseStress,
} from "../src/lib/intelligence/scenario2.js";

const DAY = 86400000;
function bars(n = 150, drift = 0.002) {
  return Array.from({ length: n }, (_, i) => ({
    t: Date.UTC(2026, 0, 1) + i * DAY,
    c:
      100 *
      Math.exp(
        drift * i + Math.sin(i * 0.51) * 0.045 + Math.sin(i * 0.17) * 0.03,
      ),
  }));
}
test("walk-forward outputs are finite, seeded, and normalised; current odds never require future bars", () => {
  const input = bars();
  const result = buildScenarioIntelligence({ bars: input, horizon: 7 });
  assert.equal(result.ok, true);
  assert.equal(result.resolvedBars, Math.ceil((input.length - 7 - 50) / 7));
  assert.equal(result.asOf, input.at(-1).t);
  assert.ok(
    Math.abs(
      Object.values(result.probabilities).reduce((a, b) => a + b, 0) - 100,
    ) < 0.02,
  );
  assert.ok(result.performance.trend.samples === result.resolvedBars);
  assert.ok(result.uncertaintyUsd.p5 <= result.uncertaintyUsd.p50);
  assert.ok(result.uncertaintyUsd.p50 <= result.uncertaintyUsd.p95);
  assert.deepEqual(
    buildScenarioIntelligence({ bars: input, horizon: 7 }),
    result,
  );
  assert.equal(
    buildScenarioIntelligence({ bars: input.slice(0, 30) }).reason,
    "INSUFFICIENT_HISTORY",
  );
  assert.equal(
    buildScenarioIntelligence({ bars: input, horizon: 0 }).reason,
    "INVALID_INPUT",
  );
  assert.equal(
    buildScenarioIntelligence({ bars: input.map((b) => ({ ...b, c: 100 })) })
      .reason,
    "INSUFFICIENT_VARIATION",
  );
  assert.equal(
    buildScenarioIntelligence({ bars: bars(180), horizon: 1 }).calibration.trend
      .calibrated,
    true,
  );
});
test("no outcome from a future bar enters the matured training set", () => {
  const input = bars();
  for (const h of [1, 3, 7, 14]) {
    const r = buildScenarioIntelligence({
      bars: input.slice(0, 120),
      horizon: h,
    });
    assert.equal(r.resolvedBars, Math.ceil((120 - 50 - h) / h));
    if (r.ok) assert.ok(r.calibration.trend.samples <= r.resolvedBars);
    else assert.equal(r.reason, "INSUFFICIENT_EVALUATION");
  }
  const prefix = input.slice(0, 100);
  assert.deepEqual(
    buildScenarioIntelligence({ bars: prefix }),
    buildScenarioIntelligence({ bars: [...prefix] }),
  );
});
test("portfolio returns match only concurrent dates, retain missing-asset disclosure and correlation", () => {
  const a = bars();
  const b = a.map((r) => ({ ...r, c: r.c * 2 }));
  const assets = { a, b: b.slice(4) };
  const p = portfolioScenarioBars(assets, [
    { id: "a", valueUsd: 600 },
    { id: "b", valueUsd: 300 },
    { id: "c", valueUsd: 100 },
  ]);
  assert.equal(p.coveragePct, 90);
  assert.deepEqual(p.excluded, ["c"]);
  assert.equal(p.bars.length, 146);
  assert.ok(buildScenarioIntelligence({ bars: p.bars }).ok);
  assert.equal(scenarioCorrelations(assets, p.included)[0].correlation, 1);
  assert.equal(
    cleanScenarioBars([
      { t: 1, c: NaN },
      { t: 3, c: 0 },
      { t: 2, c: 3 },
    ]).length,
    1,
  );
});
test("conditional stress is not treated as probability or wallet P&L", () => {
  const s = stressScenario({
    valueUsd: 1000,
    shockPct: -20,
    exitHaircutPct: 5,
  });
  assert.deepEqual(s, {
    beforeUsd: 1000,
    afterUsd: 760,
    deltaUsd: -240,
    conditional: true,
  });
  assert.equal(reverseStress(1000, 30).deltaUsd <= -300, true);
  assert.equal(stressScenario({ valueUsd: 1000, shockPct: -100 }), null);
});
