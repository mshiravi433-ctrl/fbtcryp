import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeScenarioContext,
  readScenarioContext,
  SCENARIO_CONTEXT_SCHEMA,
} from "../server/scenarioContext.js";

const now = Date.UTC(2026, 10, 8, 12);
const fixtures = {
  macro: {
    at: now,
    items: [
      {
        symbol: "US10Y",
        priceUsd: 4.15,
        unit: "%",
        change1dPct: 0.4,
        at: now - 86400000,
        source: "treasury:daily",
      },
      {
        symbol: "DXY",
        priceUsd: 103,
        at: now - 86400000,
        source: "stooq:DX.F",
      },
      {
        symbol: "EFFR",
        priceUsd: 4.83,
        unit: "%",
        at: now - 86400000,
        source: "fredcsv:DFF",
      },
    ],
  },
  flows: {
    chainFlows: {
      status: "OK",
      source: "defillama:stablecoins",
      net24hUsd: -1_000_000,
      at: now - 60_000,
    },
  },
  whaleFlows: {
    dataStatus: "live",
    at: now,
    windows: {
      "24h": {
        dataStatus: "live",
        netUsd: -200_000,
        events: 3,
        coverage: 0.75,
      },
    },
  },
  news: {
    items: [
      {
        title: "Treasury rates move",
        source: "source",
        at: now - 60_000,
        url: "https://news.example/story",
      },
      { title: "Old article", at: now - 86400000 * 5 },
      { title: "Unsafe link", at: now, url: "javascript:alert(1)" },
    ],
  },
};
test("context reads real units and signs; never recasts Treasury yield as Fed policy rate or CEX deposits as selling", () => {
  const c = normalizeScenarioContext(fixtures, now);
  assert.equal(c.schema, SCENARIO_CONTEXT_SCHEMA);
  assert.equal(c.executes, false);
  assert.equal(c.quotes.US10Y.value, 4.15);
  assert.equal(c.quotes.US2Y.status, "UNAVAILABLE");
  assert.equal(c.quotes.EFFR.value, 4.83);
  assert.equal(c.quotes.EFFR.source, "fredcsv:DFF");
  assert.equal(c.stablecoin.net24hUsd, -1_000_000);
  assert.equal(c.exchange.netToExchangeUsd, 200_000);
  assert.equal(c.exchange.coverage, 0.75);
  assert.equal(c.headlines.items.length, 2);
  assert.equal(
    c.headlines.items.find((x) => x.title === "Unsafe link").url,
    null,
  );
  assert.ok(c.limitations.some((x) => x.includes("policy-rate")));
});
test("stale or partial sources do not invent live money-flow or rate observations", () => {
  const stale = normalizeScenarioContext(
    {
      ...fixtures,
      macro: { ...fixtures.macro, stale: true },
      flows: { ...fixtures.flows, stale: true },
      whaleFlows: {
        ...fixtures.whaleFlows,
        windows: {
          "24h": { ...fixtures.whaleFlows.windows["24h"], coverage: 0.1 },
        },
      },
    },
    now,
  );
  assert.equal(stale.quotes.US10Y.status, "UNAVAILABLE");
  assert.equal(stale.stablecoin.status, "UNAVAILABLE");
  assert.equal(stale.exchange.status, "UNAVAILABLE");
  assert.equal(
    normalizeScenarioContext({}, now).headlines.status,
    "UNAVAILABLE",
  );
  assert.equal(
    normalizeScenarioContext(
      {
        macro: {
          items: [{ symbol: "US10Y", priceUsd: 4, at: now + 20 * 60_000 }],
        },
      },
      now,
    ).quotes.US10Y.status,
    "UNAVAILABLE",
  );
});
test("independent reader failures preserve successful sections and name the failed ones", async () => {
  const result = await readScenarioContext({
    now: () => now,
    macro: async () => fixtures.macro,
    news: async () => {
      throw Object.assign(new Error("down"), { code: "RSS_DOWN" });
    },
    flows: async () => fixtures.flows,
    whaleFlows: async () => fixtures.whaleFlows,
  });
  assert.equal(result.failures.news, "RSS_DOWN");
  assert.equal(result.quotes.US10Y.status, "OK");
  assert.equal(result.headlines.status, "UNAVAILABLE");
  assert.equal(result.stablecoin.status, "OK");
});
