/**
 * FBT INTENT AI — Spec 65 item 28: Smart Money adapter.
 *
 * Connects the EXISTING whale-tracking panel data (src/lib/whales.js event
 * shape) to Strategy as evidence. Derived views — accumulation, exchange
 * flows, large positions, liquidity concentration — are computed only from
 * actually observed events. No data means `unavailable`; no number is ever
 * invented, and this adapter never executes anything.
 */

import { containsRawSecret, fail, finite, noExecutionPermission } from './phaseBoundary.js';

export const SMART_MONEY_SCHEMA = 'fbt.intent-smart-money.v1';

export const WHALE_EVENT_KINDS = Object.freeze(['transfer', 'mint', 'burn', 'inflow', 'outflow', 'contract']);
const EXCHANGE_LABEL = /binance|coinbase|okx|bybit|kraken|kucoin|bitfinex|exchange/i;
const DEFAULT_MAX_AGE_HRS = 24;

function eventRow(event) {
  if (!event || typeof event !== 'object' || containsRawSecret(event)) return null;
  const kind = WHALE_EVENT_KINDS.includes(event.kind) ? event.kind : null;
  const valueUsd = finite(event.valueUsd);
  if (!kind || valueUsd === null) return null;
  const timestamp = finite(event.timestamp);
  return {
    kind,
    valueUsd,
    symbol: typeof event.token?.symbol === 'string' ? event.token.symbol.slice(0, 24) : null,
    chainId: Number.isFinite(Number(event.chainId)) ? Number(event.chainId) : null,
    fromLabel: typeof event.from?.label === 'string' ? event.from.label : null,
    toLabel: typeof event.to?.label === 'string' ? event.to.label : null,
    timestamp
  };
}

/**
 * Derive smart-money evidence rows from normalized whale events. Output rows
 * match the strategy evidence contract (`source`, `observedAt`, `sampleSize`,
 * `quality`, `assumptions`).
 */
export function smartMoneyEvidence({ whaleEvents = [], minUsd = 100_000, maxAgeHrs = DEFAULT_MAX_AGE_HRS, now = Date.now() } = {}) {
  if (containsRawSecret(whaleEvents)) return fail('RAW_CREDENTIAL_FORBIDDEN');
  const rows = (Array.isArray(whaleEvents) ? whaleEvents : []).slice(0, 500).map(eventRow).filter(Boolean);
  const cutoff = now - maxAgeHrs * 3_600_000;
  const fresh = rows.filter((row) => row.timestamp !== null && row.timestamp >= cutoff && row.valueUsd >= minUsd);

  if (!fresh.length) {
    return noExecutionPermission({
      ok: true,
      schema: SMART_MONEY_SCHEMA,
      status: 'unavailable',
      dataStatus: 'unavailable',
      signals: null,
      strategyEvidence: [],
      note: 'No fresh whale events above the threshold were supplied; smart-money signals stay unavailable instead of being fabricated.',
      checkedAt: now
    });
  }

  const sum = (list) => list.reduce((total, row) => total + row.valueUsd, 0);
  const toExchange = fresh.filter((row) => row.kind === 'inflow' || EXCHANGE_LABEL.test(row.toLabel || ''));
  const fromExchange = fresh.filter((row) => row.kind === 'outflow' || EXCHANGE_LABEL.test(row.fromLabel || ''));
  const inflowUsd = sum(toExchange);
  const outflowUsd = sum(fromExchange);
  const bySymbol = new Map();
  for (const row of fresh) {
    if (!row.symbol) continue;
    const entry = bySymbol.get(row.symbol) || { symbol: row.symbol, totalUsd: 0, events: 0 };
    entry.totalUsd += row.valueUsd;
    entry.events += 1;
    bySymbol.set(row.symbol, entry);
  }
  const topSymbols = [...bySymbol.values()].sort((a, b) => b.totalUsd - a.totalUsd).slice(0, 8);

  const signals = {
    eventCount: fresh.length,
    totalObservedUsd: Math.round(sum(fresh) * 100) / 100,
    exchangeInflowUsd: Math.round(inflowUsd * 100) / 100,
    exchangeOutflowUsd: Math.round(outflowUsd * 100) / 100,
    netExchangeFlowUsd: Math.round((outflowUsd - inflowUsd) * 100) / 100,
    topSymbols,
    interpretation: 'Descriptive only: flows and concentration are observations, not advice and not a prediction.'
  };

  const strategyEvidence = [
    {
      source: 'whale-panel:observed-transfers',
      observedAt: Math.max(...fresh.map((row) => row.timestamp)),
      sampleSize: fresh.length,
      quality: Math.min(1, fresh.length / 25),
      assumptions: ['events-are-onchain-observations', 'labels-may-be-incomplete']
    },
    {
      source: 'whale-panel:exchange-net-flow',
      observedAt: Math.max(...fresh.map((row) => row.timestamp)),
      sampleSize: toExchange.length + fromExchange.length,
      quality: toExchange.length + fromExchange.length >= 5 ? 0.6 : 0.3,
      assumptions: ['exchange-labels-heuristic']
    }
  ];

  return noExecutionPermission({
    ok: true,
    schema: SMART_MONEY_SCHEMA,
    status: 'observed',
    dataStatus: 'live-from-panel-input',
    signals,
    strategyEvidence,
    executes: false,
    adviceOnly: true,
    note: 'Derived from the existing whale panel payload; it feeds Strategy as evidence and never triggers execution.',
    checkedAt: now
  });
}
