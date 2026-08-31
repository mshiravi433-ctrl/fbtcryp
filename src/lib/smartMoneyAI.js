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
import {
  fetchOverview, fetchFlows, fetchWallet, fetchToken
} from './smartMoneyClient.js';

/** Convert whale-ish flow events into the adapter's event shape. */
function toWhaleEvents(overview) {
  const rows = [];
  for (const r of overview?.tokenActivity || []) {
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
  for (const r of (overview?.tokenActivity || []).slice(0, 5)) {
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
  return (overview?.tokenActivity || []).map((r) => ({
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
 * Build (but never execute) a SMART_MONEY_ALERT automation when the user asks
 * to be notified of smart-money accumulation/distribution.
 *
 * Rule (spec 25): the AI does NOT trade on this. The action is always NOTIFY.
 * Returns an intent record the caller persists via the existing intent store.
 */
export function buildSmartMoneyAlertIntent({
  asset,
  signal = 'ACCUMULATION',
  confidence = 75
} = {}) {
  const sym = String(asset || '').toUpperCase().trim();
  if (!/^[A-Z0-9._-]{2,12}$/.test(sym)) return { ok: false, code: 'BAD_ASSET' };
  const conf = Math.max(50, Math.min(95, Number(confidence) || 75));
  return {
    ok: true,
    intent: {
      type: 'SMART_MONEY_ALERT',
      kind: 'automation',
      asset: sym,
      condition: { signal: signal === 'DISTRIBUTION' ? 'DISTRIBUTION' : 'ACCUMULATION', confidence: conf },
      action: 'NOTIFY',
      executes: false,
      notifyOnly: true,
      requiresExplicitExecution: true,
      note: 'Observed on-chain behaviour only — not a buy/sell signal. This never places a trade.',
      createdAt: Date.now()
    }
  };
}

/** Parse phrases like "if smart money accumulates ETH tell me". */
export function smartMoneyAlertFromText(text) {
  const s = String(text || '').toLowerCase();
  const m = s.match(/(?:smart\s*money|whales?|نهنگ)\s*\S*\s*(accumulat|distribut|انباشت|توزیع)/)
    || s.match(/(accumulat|distribut|انباشت|توزیع)/);
  if (!/tell|notify|alert|notif|اعلان|بگو|خبر|اطلاع/.test(s)) return null;
  const assetMatch = s.match(/\b(ETH|BTC|SOL|BNB|USDC|USDT|[A-Z]{2,8})\b/) || text.match(/\b(ETH|BTC|SOL|BNB)\b/);
  const signal = /distribut|توزیع/.test(s) ? 'DISTRIBUTION' : 'ACCUMULATION';
  const confMatch = s.match(/(\d{2,3})\s*%/);
  return buildSmartMoneyAlertIntent({
    asset: assetMatch ? assetMatch[1] : null,
    signal,
    confidence: confMatch ? Number(confMatch[1]) : 75
  });
}

export { SMART_MONEY_SCHEMA };
