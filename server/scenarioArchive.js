/** Append-only point-in-time evidence. This is NOT historical backfilling:
 * RSS and the scanner have no vintage archive. Missing days stay missing.
 * Public market-only rows, never user data. Durable Redis is mandatory.
 */
import {
  upstashConfigured,
  upstashSetIfAbsent,
  upstashMultiGetAtomic,
} from "./blobCache.js";
import { SCENARIO_CONTEXT_SCHEMA } from "../src/lib/intelligence/scenarioContext.js";
export const ARCHIVE_SCHEMA = "fbt.scenario-evidence.v1";
const DAY = 86400000;
const TTL = 400 * DAY;
const keyFor = (day) => `scenario-evidence:v1:${day}`;
const dayOf = (at) => new Date(at).toISOString().slice(0, 10);
const finite = (v) => typeof v === "number" && Number.isFinite(v);

export function evidenceSnapshot(context, now = Date.now()) {
  if (
    context?.schema !== SCENARIO_CONTEXT_SCHEMA ||
    !finite(now) ||
    !context.ok
  )
    return null;
  // A daily origin is fixed only once today's observed window is mature.
  // Never claim a historical value was known on its observation date if read later.
  if (new Date(now).getUTCHours() < 18) return null;
  const rate = context.quotes?.EFFR;
  const yield10y = context.quotes?.US10Y;
  const stable = context.stablecoin;
  const exchange = context.exchange;
  const headlines = context.headlines;
  const row = {
    schema: ARCHIVE_SCHEMA,
    day: dayOf(now),
    recordedAt: now,
    effrPct: rate?.status === "OK" && finite(rate.value) ? rate.value : null,
    yield10yPct:
      yield10y?.status === "OK" && finite(yield10y.value)
        ? yield10y.value
        : null,
    stableSupply24hUsd:
      stable?.status === "OK" && finite(stable.net24hUsd)
        ? stable.net24hUsd
        : null,
    exchangeDeposit24hUsd:
      exchange?.status === "OK" && finite(exchange.netToExchangeUsd)
        ? exchange.netToExchangeUsd
        : null,
    exchangeCoverage:
      exchange?.status === "OK" && finite(exchange.coverage)
        ? exchange.coverage
        : null,
    headlineCount:
      headlines?.status === "OK" && Array.isArray(headlines.items)
        ? headlines.items.length
        : null,
    provenance: {
      effr: rate?.status === "OK" ? rate.source : null,
      treasury: yield10y?.status === "OK" ? yield10y.source : null,
      stable: stable?.status === "OK" ? stable.source : null,
      exchange: exchange?.status === "OK" ? exchange.source : null,
      headlines: headlines?.status === "OK" ? headlines.source : null,
    },
  };
  if (
    [
      row.effrPct,
      row.yield10yPct,
      row.stableSupply24hUsd,
      row.exchangeDeposit24hUsd,
      row.headlineCount,
    ].every((v) => v === null)
  )
    return null;
  return row;
}

export async function recordScenarioEvidence(
  context,
  {
    now = Date.now(),
    configured = upstashConfigured,
    write = upstashSetIfAbsent,
  } = {},
) {
  if (!configured()) return { status: "NOT_CONFIGURED", written: false };
  const snapshot = evidenceSnapshot(context, now);
  if (!snapshot) return { status: "NOT_READY", written: false };
  try {
    const written = await write(keyFor(snapshot.day), snapshot, TTL);
    return {
      status: written ? "RECORDED" : "ALREADY_RECORDED_OR_UNAVAILABLE",
      written,
      day: snapshot.day,
    };
  } catch {
    return { status: "UNAVAILABLE", written: false };
  }
}

export async function readScenarioEvidence({
  now = Date.now(),
  days = 365,
  configured = upstashConfigured,
  multiGet = upstashMultiGetAtomic,
} = {}) {
  if (!configured())
    return { schema: ARCHIVE_SCHEMA, status: "NOT_CONFIGURED", rows: [] };
  const count = Math.min(365, Math.max(1, Math.trunc(days)));
  const keys = Array.from({ length: count }, (_, i) =>
    keyFor(dayOf(now - (count - i - 1) * DAY)),
  );
  try {
    const values = await multiGet(keys);
    if (!Array.isArray(values))
      return { schema: ARCHIVE_SCHEMA, status: "UNAVAILABLE", rows: [] };
    const rows = values.filter(
      (row) =>
        row?.schema === ARCHIVE_SCHEMA &&
        finite(row.recordedAt) &&
        row.recordedAt <= now &&
        row.day === dayOf(row.recordedAt),
    );
    return {
      schema: ARCHIVE_SCHEMA,
      status: "OK",
      rows,
      availableDays: rows.length,
      requestedDays: count,
      note: "Prospectively observed days only. No backfill; gaps are not interpolated.",
    };
  } catch {
    return { schema: ARCHIVE_SCHEMA, status: "UNAVAILABLE", rows: [] };
  }
}
