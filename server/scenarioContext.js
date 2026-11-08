/** Read-only, independently degradable market evidence for Scenario Lab.
 * Live point-in-time observations DO NOT retroactively train candle forecasts.
 * Input readers are injectable so failure, staleness and provenance are tested.
 */
import { withCache } from "./cache.js";
import { fetchMacroQuotes } from "./macroData.js";
import { fetchNews } from "./news.js";
import { getCapitalFlows } from "./capitalFlows.js";
import { exchangeFlows } from "./smartMoney/moneyFlow.js";

import { SCENARIO_CONTEXT_SCHEMA } from "../src/lib/intelligence/scenarioContext.js";
export { SCENARIO_CONTEXT_SCHEMA };
const minute = 60_000;
const finite = (v) => typeof v === "number" && Number.isFinite(v);
const recent = (at, now, maxAge) =>
  finite(at) && at > 0 && at <= now + 5 * minute && now - at <= maxAge;
const cleanError = (error) =>
  String(error?.code || "SOURCE_UNAVAILABLE").slice(0, 48);
const blank = (reason) => ({ status: "UNAVAILABLE", reason });

export function normalizeScenarioContext(
  { macro, news, flows, whaleFlows } = {},
  now = Date.now(),
) {
  const quotes = {};
  if (macro && macro.stale !== true) {
    for (const symbol of ["US10Y", "US2Y", "DXY", "EFFR"]) {
      const q = macro.items?.find((x) => x.symbol === symbol);
      if (
        finite(q?.priceUsd) &&
        recent(q.at, now, symbol === "DXY" ? 3 * 86400000 : 7 * 86400000)
      ) {
        quotes[symbol] = {
          status: "OK",
          value: q.priceUsd,
          unit: String(q.unit || "").slice(0, 32),
          change1dPct: finite(q.change1dPct) ? q.change1dPct : null,
          at: q.at,
          source: String(q.source || macro.source || "").slice(0, 80),
        };
      } else quotes[symbol] = blank(q ? "STALE_OR_INVALID_QUOTE" : "NO_QUOTE");
    }
  } else
    for (const symbol of ["US10Y", "US2Y", "DXY", "EFFR"])
      quotes[symbol] = blank(
        macro?.stale ? "STALE_SOURCE" : "SOURCE_UNAVAILABLE",
      );

  const stable = flows?.chainFlows;
  const stablecoin =
    stable?.status === "OK" &&
    !flows.stale &&
    recent(stable.at, now, 30 * minute) &&
    finite(stable.net24hUsd)
      ? {
          status: "OK",
          net24hUsd: stable.net24hUsd,
          at: stable.at,
          source: stable.source,
          note: "Stablecoin supply delta, not verified exchange deposits or a price prediction.",
        }
      : blank(
          stable?.status === "OK"
            ? "STALE_OR_INVALID_FLOW"
            : "SOURCE_UNAVAILABLE",
        );

  const window = whaleFlows?.windows?.["24h"];
  // Exchange-flow buffer is NOT a complete 24-hour chain history. A short
  // observed window cannot be promoted to a market-wide net-flow fact.
  const exchange =
    whaleFlows?.dataStatus === "live" &&
    recent(whaleFlows.at, now, 5 * minute) &&
    window?.dataStatus === "live" &&
    finite(window?.netUsd) &&
    window.events > 0 &&
    finite(window.coverage) &&
    window.coverage >= 0.5
      ? {
          status: "OK",
          netToExchangeUsd: -window.netUsd,
          at: whaleFlows.at,
          coverage: window.coverage,
          events: window.events,
          source: "FBT labelled exchange-wallet scanner",
          note: "Only labelled counterparties in the observed window. Positive = deposits to exchanges; not necessarily selling.",
        }
      : blank(
          whaleFlows?.dataStatus === "stale"
            ? "STALE_SOURCE"
            : "INSUFFICIENT_LABELLED_COVERAGE",
        );

  const items = Array.isArray(news?.items)
    ? news.items
        .filter(
          (n) =>
            recent(n?.at, now, 24 * 60 * minute) &&
            typeof n.title === "string" &&
            n.title.trim(),
        )
        .sort((a, b) => b.at - a.at)
        .slice(0, 6)
        .map((n) => ({
          title: n.title.slice(0, 180),
          source: String(n.source || "").slice(0, 50),
          at: n.at,
          url: /^https:\/\//i.test(n.url || "") ? n.url : null,
          class: String(n.class || "").slice(0, 24),
        }))
    : [];
  const available =
    Object.values(quotes).some((q) => q.status === "OK") ||
    stablecoin.status === "OK" ||
    exchange.status === "OK" ||
    items.length > 0;
  return {
    ok: available,
    schema: SCENARIO_CONTEXT_SCHEMA,
    at: now,
    readOnly: true,
    executes: false,
    quotes,
    stablecoin,
    exchange,
    headlines: {
      status: items.length ? "OK" : "UNAVAILABLE",
      items,
      source: "FBT /api/news RSS aggregation",
      reason: items.length ? null : "NO_RECENT_HEADLINES",
      note: "Headline coverage only; no sentiment score or causal effect inferred.",
    },
    limitations: [
      "EFFR is an observed overnight rate, not a verified policy-rate decision",
      "No aligned historical news/macro/whale observations for probability training",
      "No venue order-book depth for a generic CoinGecko id",
    ],
  };
}

/** Bounded cache + independent failure; no user identifiers or wallet holdings. */
export async function readScenarioContext({
  macro = () =>
    withCache("scenario:macro:v1", 15 * minute, fetchMacroQuotes, {
      swr: true,
    }).then((r) => (r.stale ? { stale: true } : r.value)),
  news = () =>
    withCache("news", 30 * minute, fetchNews, { swr: true }).then((r) =>
      r.stale ? null : r.value,
    ),
  flows = getCapitalFlows,
  whaleFlows = () =>
    withCache("scenario:exchange:v1", minute, exchangeFlows, {
      swr: true,
    }).then((r) => (r.stale ? { dataStatus: "stale" } : r.value)),
  now = Date.now,
} = {}) {
  const readers = [macro, news, flows, whaleFlows];
  const settled = await Promise.allSettled(
    readers.map(async (read) => {
      // Some upstream desks take longer than a request budget. Their eventual
      // completion may warm the cache, but a timed-out value is not shown as live.
      let timer;
      try {
        return await Promise.race([
          read(),
          new Promise((_, reject) => {
            timer = setTimeout(
              () =>
                reject(
                  Object.assign(new Error("TIMEOUT"), { code: "TIMEOUT" }),
                ),
              10_000,
            );
          }),
        ]);
      } finally {
        clearTimeout(timer);
      }
    }),
  );
  const values = settled.map((r) =>
    r.status === "fulfilled" ? r.value : null,
  );
  const context = normalizeScenarioContext(
    {
      macro: values[0],
      news: values[1],
      flows: values[2],
      whaleFlows: values[3],
    },
    now(),
  );
  context.failures = Object.fromEntries(
    ["macro", "news", "flows", "whaleFlows"].flatMap((k, i) =>
      settled[i].status === "rejected"
        ? [[k, cleanError(settled[i].reason)]]
        : [],
    ),
  );
  return context;
}
