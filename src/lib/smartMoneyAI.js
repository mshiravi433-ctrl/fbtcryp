/**
 * SMART MONEY → INTENT AI / INTENT OS BRIDGE
 * ---------------------------------------------------------------------------
 * The On-Chain Intelligence Layer is meant to be consumed by the AI and the
 * Intent OS, not just the page. This module:
 *
 *   1. Pulls REAL smart-money data through the same client the page uses
 *      (no second fetch path).
 *   2. Shapes it into the evidence contract the existing intent-ai
 *      smartMoneyAdapter already expects (source / observedAt / sampleSize /
 *      quality / assumptions) — so "why did ETH move?" can answer with price
 *      + volume + whales + exchange flow + holders + liquidity.
 *   3. Builds a SMART_MONEY_ALERT automation (Intent OS) when the user asks
 *      "tell me if smart money accumulates ETH" — notify-only. The AI never
 *      trades from this: executing requires an explicit, separate user action.
 *
 * Observed vs inferred vs predicted: every number is an OBSERVATION. Labels
 * like "accumulation" are INFERENCES (with a confidence that is pattern
 * strength, not probability). Nothing here predicts price or advises a trade.
 */

import { smartMoneyEvidence, SMART_MONEY_SCHEMA } from './intent-ai/smartMoneyAdapter.js';
import { parseSmartMoneyMonitorRequest } from './smartMoneyMonitorIntent.js';
import {
  fetchOverview, fetchFlows, fetchWallet, fetchToken
} from './smartMoneyClient.js';

/** Convert whale-ish flow events into the adapter's event shape. */
function toWhaleEvents(overview) {
  const rows = [];
  for (const r of Array.isArray(overview?.tokenActivity) ? overview.tokenActivity : []) {
    rows.push({
      kind: r.netUsd >= 0 ? 'outflow' : 'inflow',
      valueUsd: Math.abs(r.netUsd || 0),
      token: { symbol: r.symbol },
      chainId: r.chainId,
      fromLabel: null,
      toLabel: null,
      timestamp: overview?.at || Date.now()
    });
  }
  // CEX flow rows as labelled events so the adapter's exchange math engages.
  const f = overview?.flows?.windows?.['24h'];
  if (f) {
    rows.push({ kind: 'inflow', valueUsd: f.inflowUsd || 0, token: { symbol: 'CEX' }, fromLabel: 'binance', toLabel: 'binance', timestamp: overview?.at });
    rows.push({ kind: 'outflow', valueUsd: f.outflowUsd || 0, token: { symbol: 'CEX' }, fromLabel: 'binance', toLabel: 'binance', timestamp: overview?.at });
  }
  return rows;
}

/**
 * Live smart-money evidence for the chat. Returns the existing adapter's
 * schema; `unavailable` when there is no fresh data — never a fabricated
 * signal.
 */
export async function smartMoneyContext({ window = '24h', minUsd = 100_000 } = {}) {
  const overview = await fetchOverview(window);
  const evidence = smartMoneyEvidence({
    whaleEvents: toWhaleEvents(overview),
    minUsd,
    maxAgeHrs: window === '30d' ? 720 : window === '7d' ? 168 : 24
  });
  return {
    overview,
    evidence,
    // Data points in the live-why contract (label/source/observedAt/value),
    // so an explanation can be traced to a real number.
    dataPoints: buildDataPoints(overview)
  };
}

function buildDataPoints(overview) {
  const at = overview?.at || Date.now();
  const f = overview?.flows?.windows?.['24h'];
  const out = [];
  if (overview?.metrics?.whaleActivity?.value != null) {
    out.push({ label: 'Whale events (24h)', source: 'onchain:whale-rpc', observedAt: at, value: overview.metrics.whaleActivity.value });
  }
  if (f) {
    out.push({ label: 'Exchange inflow USD', source: 'onchain:cex-registry', observedAt: at, value: f.inflowUsd || 0, unit: 'usd' });
    out.push({ label: 'Exchange outflow USD', source: 'onchain:cex-registry', observedAt: at, value: f.outflowUsd || 0, unit: 'usd' });
    out.push({ label: 'Net exchange flow USD', source: 'onchain:cex-registry', observedAt: at, value: f.netUsd || 0, unit: 'usd' });
  }
  for (const r of (Array.isArray(overview?.tokenActivity) ? overview.tokenActivity : []).slice(0, 5)) {
    out.push({ label: `Smart-money net flow ${r.symbol}`, source: 'onchain:wallet-flow', observedAt: at, value: r.netUsd || 0, unit: 'usd' });
  }
  return out;
}

/**
 * Answer "what are whales active on right now?" — token ranking from observed
 * flows, best-effort only, clearly labelled as behaviour not advice.
 */
export async function whaleTokenRanking({ window = '24h' } = {}) {
  const overview = await fetchOverview(window);
  return (Array.isArray(overview?.tokenActivity) ? overview.tokenActivity : []).map((r) => ({
    symbol: r.symbol,
    chain: r.chainShort,
    netUsd: r.netUsd,
    signal: r.signal,
    confidence: r.signal === 'ACCUMULATION' ? r.accumulation : r.distribution,
    smartWallets: r.events
  }));
}

/* ── Intent OS automation (notify-only) ───────────────────────────────── */

/**
 * THE ORPHAN, REWOUND.
 * ---------------------------------------------------------------------------
 * This used to mint a `SMART_MONEY_ALERT` intent record and nothing else. It
 * was never called, the record was never stored, and no evaluator anywhere
 * understood the type — so the sentence its own docstring promised («اگر
 * smart money accumulates ETH tell me») had no effect at all. It was also
 * Persian-blind: the asset pattern is a Latin ticker list, so the phrase the
 * app's actual users type — «اتریوم» — failed with BAD_ASSET.
 *
 * The automation that actually runs is the Intent OS market monitor, whose
 * SMART_MONEY_* metrics are evaluated against the verified paired-swap index
 * and delivered as a real push. It requires a CONCRETE CONTRACT, which a
 * symbol can never supply. So both functions below are now thin shims over
 * `smartMoneyMonitorIntent.js`, the one parser that resolves a sentence to a
 * contract the server has independently agreed to watch.
 *
 * Without a verified snapshot they refuse with `NEEDS_VERIFIED_CONTRACT`
 * rather than describe a monitor that would be wired to nothing. Pass
 * `verified` (the body of GET /api/v1/smart-money/intelligence) to get a
 * draft the server accepts.
 *
 * Rule (spec 25) unchanged: notify only. Nothing on this path signs or trades.
 */

/**
 * Build a notify-only Smart Money automation.
 *
 * @param {object}  opts
 * @param {string}  opts.asset      ticker, e.g. 'ETH'
 * @param {*}      [opts.verified]  verified-intelligence snapshot
 * @param {number} [opts.now]
 * @returns {{ok:true, intent}|{ok:false, code, detail?}}
 */
export function buildSmartMoneyAlertIntent({
  asset,
  signal = 'ACCUMULATION',
  confidence = 75,
  verified = null,
  now = Date.now()
} = {}) {
  const sym = String(asset || '').trim();
  if (!sym) return { ok: false, code: 'BAD_ASSET' };
  /* Restate the caller's structured request as the sentence a user would
     have typed, then let the ONE parser read it back. The subject and the
     notify verb are both required by that parser, so they have to be here —
     an earlier version of this shim emitted only «ETH انباشت کرد», which the
     parser correctly rejected as NOT_SMART_MONEY. */
  const text = `اگر اسمارت مانی ${sym} ${signal === 'DISTRIBUTION' ? 'توزیع کرد' : 'انباشت کرد'} خبر بده`;
  const got = parseSmartMoneyMonitorRequest(text, { verified, now, locale: 'en' });
  if (!got.monitor) {
    return {
      ok: false,
      code: got.error === 'NO_VERIFIED_CONTRACT' || got.error === 'AMBIGUOUS_CONTRACT'
        || got.error === 'UNSUPPORTED_CHAIN' ? 'NEEDS_VERIFIED_CONTRACT' : (got.error || 'UNPARSED'),
      detail: got.error || null
    };
  }
  return {
    ok: true,
    intent: {
      /* Kept as the record's `type` for continuity, but what now travels is a
         real monitor draft — the thing the server stores and evaluates. */
      type: 'SMART_MONEY_ALERT',
      kind: 'automation',
      asset: sym.toUpperCase(),
      condition: { signal: got.evidence?.signal || signal, confidence: Math.max(50, Math.min(95, Number(confidence) || 75)) },
      action: 'NOTIFY',
      executes: false,
      notifyOnly: true,
      requiresExplicitExecution: true,
      note: 'Observed on-chain behaviour only — not a buy/sell signal. This never places a trade.',
      createdAt: now,
      monitor: got.monitor,
      evidence: got.evidence || null
    }
  };
}

/** Parse phrases like «if smart money accumulates ETH tell me». */
export function smartMoneyAlertFromText(text, { verified = null, now = Date.now() } = {}) {
  const got = parseSmartMoneyMonitorRequest(text, { verified, now, locale: 'en' });
  if (!got.monitor) {
    const needsEvidence = ['NO_VERIFIED_CONTRACT', 'AMBIGUOUS_CONTRACT', 'UNSUPPORTED_CHAIN'].includes(got.error);
    return {
      ok: false,
      code: needsEvidence ? 'NEEDS_VERIFIED_CONTRACT' : (got.error || 'UNPARSED'),
      detail: got.error || null,
      observed: got.observed || null,
      candidates: got.candidates || null
    };
  }
  return {
    ok: true,
    intent: {
      type: 'SMART_MONEY_ALERT', kind: 'automation',
      asset: String(got.evidence?.symbol || got.monitor.asset.symbol).toUpperCase(),
      condition: { signal: got.evidence?.signal || 'ACCUMULATION', confidence: got.evidence?.confidence ?? 75 },
      action: 'NOTIFY', executes: false, notifyOnly: true, requiresExplicitExecution: true,
      note: 'Observed on-chain behaviour only — not a buy/sell signal. This never places a trade.',
      createdAt: now,
      monitor: got.monitor,
      evidence: got.evidence || null
    }
  };
}

export { SMART_MONEY_SCHEMA };
