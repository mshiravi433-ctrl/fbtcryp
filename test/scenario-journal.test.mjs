import test from "node:test";
import assert from "node:assert/strict";
import { buildScenarioIntelligence } from "../src/lib/intelligence/scenario2.js";
import { buildReaders, buildErasers } from "../src/lib/userDataStores.js";
import {
  readScenarioJournal,
  writeScenarioJournal,
  updateScenarioJournal,
  scenarioJournalScore,
  applyJournalCalibration,
} from "../src/lib/intelligence/scenarioJournal.js";
const DAY = 86400000;
const make = (n, start) =>
  Array.from({ length: n }, (_, i) => ({
    t: start + i * DAY,
    c: 100 * Math.exp(0.002 * i + Math.sin(i * 0.51) * 0.04),
  }));
const store = () => {
  const data = new Map();
  return { getItem: (k) => data.get(k), setItem: (k, v) => data.set(k, v) };
};
test("only forecasts issued while fresh are persisted and resolved after the actual target candle", () => {
  const start = Date.UTC(2026, 0, 1);
  const past = make(115, start);
  const result = buildScenarioIntelligence({ bars: past, horizon: 3 });
  const now = past.at(-1).t + 3600000;
  const initial = updateScenarioJournal([], {
    asset: "bitcoin",
    bars: past,
    result,
    now,
  });
  assert.equal(initial.issued, true);
  assert.equal(initial.entries[0].actual, undefined);
  assert.equal(
    updateScenarioJournal(initial.entries, {
      asset: "bitcoin",
      bars: past,
      result,
      now,
    }).entries.length,
    1,
  );
  const future = make(119, start);
  const later = buildScenarioIntelligence({ bars: future, horizon: 3 });
  const settled = updateScenarioJournal(initial.entries, {
    asset: "bitcoin",
    bars: future,
    result: later,
    now: future.at(-1).t,
  });
  assert.equal(settled.entries[0].resolvedAt, future[117].t);
  assert.ok(["bull", "base", "bear"].includes(settled.entries[0].actual));
  assert.ok(Number.isFinite(settled.entries[0].brier));
  assert.equal(scenarioJournalScore(settled.entries, "bitcoin", 3).resolved, 1);
  assert.equal(
    applyJournalCalibration(later, settled.entries, "bitcoin").liveCalibration
      .applied,
    false,
  );
  assert.equal(
    updateScenarioJournal([], {
      asset: "bitcoin",
      bars: past,
      result,
      now: now + 20 * DAY,
    }).issued,
    false,
  );
  const storage = store();
  assert.equal(writeScenarioJournal(storage, settled.entries), true);
  assert.equal(readScenarioJournal(storage).length, 2);
  assert.deepEqual(readScenarioJournal({ getItem: () => "broken" }), []);
});
test("device calibration only applies after enough resolved forecasts of same asset/horizon/version", () => {
  const bars = make(120, Date.UTC(2026, 0, 1));
  const result = buildScenarioIntelligence({ bars, horizon: 1 });
  const template = updateScenarioJournal([], {
    asset: "bitcoin",
    bars,
    result,
    now: bars.at(-1).t,
  }).entries[0];
  const entries = Array.from({ length: 20 }, (_, i) => ({
    ...template,
    asOf: template.asOf - i * DAY,
    actual: "bull",
    brier: 0.22,
  }));
  const adapted = applyJournalCalibration(result, entries, "bitcoin");
  assert.equal(adapted.liveCalibration.applied, true);
  assert.ok(adapted.probabilities.bull > result.probabilities.bull);
  assert.ok(
    Math.abs(
      Object.values(adapted.probabilities).reduce((a, b) => a + b) - 100,
    ) < 0.02,
  );
  assert.equal(
    applyJournalCalibration(result, entries, "ethereum").liveCalibration
      .applied,
    false,
  );
});

test("privacy export and deletion include the device forecast journal but never the wallet vault", () => {
  const realStorage = globalThis.localStorage;
  const data = new Map([
    ["fbt.scenario-forecast-journal.v1", '[{"asset":"bitcoin"}]'],
    ["fbt-wallet-v1", "encrypted"],
  ]);
  globalThis.localStorage = {
    length: 2,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => data.set(k, v),
    removeItem: (k) => data.delete(k),
    key: (i) => [...data.keys()][i],
  };
  try {
    assert.equal(
      buildReaders().audit()["fbt.scenario-forecast-journal.v1"][0].asset,
      "bitcoin",
    );
    assert.equal(buildErasers().audit().removed, 1);
    assert.equal(data.has("fbt.scenario-forecast-journal.v1"), false);
    assert.equal(data.has("fbt-wallet-v1"), true);
  } finally {
    globalThis.localStorage = realStorage;
  }
});
