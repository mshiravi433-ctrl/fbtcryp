/**
 * FBT INTENT AI — PHASE 61: LIVE GOAL PROGRESS
 * ---------------------------------------------------------------------------
 * A countdown is not progress. The Spec-65 goal engine already refuses to
 * invent a percentage without an ATTESTED balance; this module produces that
 * attestation from real prices instead of from a hopeful number.
 *
 *   · holdings × live price = the current value, with the price source and
 *     observation time attached to the attestation
 *   · a dead feed, or a price older than `maxAgeMs`, yields progress `null`
 *     with status `unattested` — an honest null, never a fake 0%
 *   · the UI renders a real bar from that percentage and, when it is null,
 *     says the progress is unknown instead of drawing an empty bar as if it
 *     meant "no progress yet"
 */

import { goalProgress, GOAL_PROGRESS_SCHEMA } from './goalProgress.js';
import { classifyFailure } from './failureModes.js';

export const LIVE_GOAL_PROGRESS_SCHEMA = 'fbt.live-goal-progress.v1';
export const DEFAULT_PRICE_MAX_AGE_MS = 10 * 60 * 1000;

// Number(null) === 0 and Number('') === 0, so an absent value must be
// rejected BEFORE the finite check or "missing" silently reads as zero.
const num = (v) => (v === null || v === undefined || v === '' || typeof v === 'boolean'
  ? null
  : (Number.isFinite(Number(v)) ? Number(v) : null));

function unattested(detail, extra = {}) {
  return {
    ok: true,
    schema: LIVE_GOAL_PROGRESS_SCHEMA,
    dataStatus: 'unavailable',
    // The whole point of the phase: null, not zero.
    progressPct: null,
    currentValueUsd: null,
    status: 'unattested',
    progressComputable: false,
    i18nKey: 'intentAI.goalProgress.unknown',
    i18nParams: {},
    reason: detail,
    error: classifyFailure('MISSING_DATA', { detail }),
    ...extra
  };
}

/**
 * Value a set of holdings with live prices.
 * @param {Array}    holdings    [{ symbol, amount }]
 * @param {function} priceSource async (symbols) → { SYM: { usd, at, source } }
 */
export async function valueHoldings({ holdings = [], priceSource, now = Date.now(), maxAgeMs = DEFAULT_PRICE_MAX_AGE_MS } = {}) {
  if (typeof priceSource !== 'function') return { ok: false, reason: 'NO_PRICE_SOURCE' };
  const rows = (Array.isArray(holdings) ? holdings : [])
    .map((row) => ({ symbol: typeof row?.symbol === 'string' ? row.symbol.toUpperCase().slice(0, 12) : null, amount: num(row?.amount) }))
    .filter((row) => row.symbol && row.amount !== null && row.amount >= 0);
  if (!rows.length) return { ok: false, reason: 'NO_HOLDINGS' };

  let priced = null;
  try {
    priced = await priceSource(rows.map((row) => row.symbol));
  } catch {
    return { ok: false, reason: 'PRICE_FEED_FAILED' };
  }
  if (!priced || typeof priced !== 'object') return { ok: false, reason: 'PRICE_FEED_EMPTY' };

  const parts = [];
  for (const row of rows) {
    const quote = priced[row.symbol];
    const price = num(quote?.usd ?? quote?.price ?? quote);
    const at = num(quote?.at ?? quote?.observedAt) ?? now;
    const source = typeof quote?.source === 'string' && quote.source ? quote.source.slice(0, 40) : null;
    if (price === null || price <= 0) return { ok: false, reason: `NO_PRICE:${row.symbol}` };
    if (!source) return { ok: false, reason: `NO_PRICE_SOURCE:${row.symbol}` };
    if (now - at > maxAgeMs) return { ok: false, reason: `PRICE_STALE:${row.symbol}` };
    parts.push({ symbol: row.symbol, amount: row.amount, price, at, source, valueUsd: row.amount * price });
  }
  return {
    ok: true,
    valueUsd: Math.round(parts.reduce((sum, p) => sum + p.valueUsd, 0) * 100) / 100,
    parts,
    oldestAt: Math.min(...parts.map((p) => p.at)),
    sources: [...new Set(parts.map((p) => p.source))]
  };
}

/** Live progress toward a capital target, or an honest null. */
export async function liveGoalProgress({
  targetCapital = null,
  holdings = [],
  priceSource,
  initialCapitalUsd = null,
  now = Date.now(),
  maxAgeMs = DEFAULT_PRICE_MAX_AGE_MS
} = {}) {
  const target = num(targetCapital);
  if (target === null || target <= 0) return unattested('TARGET_CAPITAL_REQUIRED');

  const valued = await valueHoldings({ holdings, priceSource, now, maxAgeMs });
  if (!valued.ok) return unattested(valued.reason);

  const attested = goalProgress({
    targetCapital: target,
    capitalUsd: num(initialCapitalUsd),
    currentBalance: {
      valueUsd: valued.valueUsd,
      checkedAt: valued.oldestAt,
      providerId: valued.sources[0],
      confirmed: true,
      evidenceId: `live-price:${valued.sources.join('+')}:${valued.oldestAt}`
    },
    now
  });
  if (attested.ok !== true || attested.progressComputable !== true) {
    return unattested('ATTESTATION_REFUSED');
  }
  return {
    ok: true,
    schema: LIVE_GOAL_PROGRESS_SCHEMA,
    engineSchema: GOAL_PROGRESS_SCHEMA,
    dataStatus: 'live',
    status: 'attested',
    progressComputable: true,
    targetCapital: target,
    currentValueUsd: valued.valueUsd,
    progressPct: attested.progressPct,
    growthFromInitialPct: attested.growthFromInitialPct,
    remainingUsd: attested.remainingUsd,
    holdings: valued.parts.map(({ symbol, amount, price, source, at }) => ({ symbol, amount, price, source, at })),
    sources: valued.sources,
    observedAt: valued.oldestAt,
    i18nKey: 'intentAI.goalProgress.summary',
    i18nParams: {
      pct: attested.progressPct,
      current: valued.valueUsd,
      target,
      sources: valued.sources.join(', ')
    },
    executionAuthorized: false,
    checkedAt: now
  };
}

/**
 * What the progress bar should render. `known:false` is a distinct visual
 * state — it is NOT a bar at 0%.
 */
export function progressBarState(result) {
  const pct = result && result.progressComputable === true ? num(result.progressPct) : null;
  if (pct === null) {
    return { known: false, pct: null, widthPct: 0, i18nKey: 'intentAI.goalProgress.unknown' };
  }
  return {
    known: true,
    pct,
    widthPct: Math.max(0, Math.min(100, pct)),
    reached: pct >= 100,
    i18nKey: 'intentAI.goalProgress.summary'
  };
}
