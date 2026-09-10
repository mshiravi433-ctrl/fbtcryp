/**
 * FBT FINANCIAL INTELLIGENCE OS — Smart Money Intelligence for AI decisions.
 * ---------------------------------------------------------------------------
 * The Smart Money page already observes whales, flows, accumulation and
 * distribution. Until this module, those observations stopped at the page /
 * global-intel snapshot: they never entered strategy scoring, competition
 * ranking or the decision record as first-class inputs.
 *
 * This module:
 *   1. Reads the REAL smart-money overview (server/smartMoney) — same source
 *      the page uses, no second feed.
 *   2. Derives a bounded intelligence digest: accumulation, distribution,
 *      exchange inflow/outflow, CEX↔DEX direction, whale activity, top tokens,
 *      fresh/dormant signals when present.
 *   3. Emits strategy-contract evidence rows + decision conditions + a
 *      numeric alignment score the competition can fold into risk-adjusted
 *      ranking.
 *
 * Rules (non-negotiable):
 *   · no data → status:'unavailable', never a fabricated whale
 *   · every number is an OBSERVATION; labels like ACCUMULATION are inferences
 *     with coverage, not predictions and not advice
 *   · never executes, never grants permission, never claims insider knowledge
 */
import { smartMoneyEvidence } from '../../src/lib/intent-ai/smartMoneyAdapter.js';

export const SMART_MONEY_INTEL_SCHEMA = 'fbt.fi.smart-money-intel.v1';

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : null);

/** Convert overview tokenActivity + flow windows into the adapter's event shape. */
export function overviewToWhaleEvents(overview = {}) {
  const rows = [];
  const at = overview?.at || Date.now();
  for (const r of overview?.tokenActivity || []) {
    const usd = Math.abs(num(r.netUsd) || 0);
    if (usd <= 0) continue;
    rows.push({
      kind: (num(r.netUsd) || 0) >= 0 ? 'outflow' : 'inflow',
      valueUsd: usd,
      token: { symbol: r.symbol },
      chainId: r.chainId ?? null,
      fromLabel: null,
      toLabel: null,
      timestamp: at
    });
  }
  const windows = overview?.flows?.windows || {};
  const f = windows['24h'] || windows[overview.window] || null;
  if (f) {
    if (num(f.inflowUsd) > 0) {
      rows.push({
        kind: 'inflow',
        valueUsd: num(f.inflowUsd),
        token: { symbol: 'CEX' },
        fromLabel: null,
        toLabel: 'binance',
        timestamp: at
      });
    }
    if (num(f.outflowUsd) > 0) {
      rows.push({
        kind: 'outflow',
        valueUsd: num(f.outflowUsd),
        token: { symbol: 'CEX' },
        fromLabel: 'binance',
        toLabel: null,
        timestamp: at
      });
    }
  }
  return rows;
}

/**
 * Build the AI-facing digest from a smart-money overview (or null).
 * Pure over the overview object — providers are injected by the caller.
 */
export function buildSmartMoneyIntel(overview = null, { now = Date.now(), minUsd = 100_000 } = {}) {
  if (!overview || typeof overview !== 'object') {
    return {
      schema: SMART_MONEY_INTEL_SCHEMA,
      status: 'unavailable',
      dataStatus: 'unavailable',
      reason: 'NO_OVERVIEW',
      at: now,
      signals: null,
      strategyEvidence: [],
      decisionConditions: [],
      alignment: null,
      note: 'Smart-money feed was not readable; no whale signal was invented.'
    };
  }

  const dataStatus = overview.dataStatus || overview.streamStatus || 'unavailable';
  if (dataStatus === 'unavailable' && !(overview.tokenActivity || []).length && !overview.metrics) {
    return {
      schema: SMART_MONEY_INTEL_SCHEMA,
      status: 'unavailable',
      dataStatus: 'unavailable',
      reason: 'STREAM_EMPTY',
      at: overview.at || now,
      signals: null,
      strategyEvidence: [],
      decisionConditions: [],
      alignment: null,
      note: 'Scanner produced no labelled events in the window.'
    };
  }

  const m = overview.metrics || {};
  const win = overview.flows?.windows?.['24h'] || overview.flows?.windows?.[overview.window] || null;
  const accumulationUsd = num(m.accumulation?.valueUsd);
  const distributionUsd = num(m.distribution?.valueUsd);
  const whaleCount = num(m.whaleActivity?.value);
  const exchangeInUsd = num(win?.inflowUsd ?? m.exchangeInflow?.value);
  const exchangeOutUsd = num(win?.outflowUsd ?? m.exchangeOutflow?.value);
  const netFlowUsd = num(win?.netUsd ?? m.netFlow?.value)
    ?? (accumulationUsd != null && distributionUsd != null ? accumulationUsd - distributionUsd : null);

  /* CEX → DEX is typically exchange outflow (coins leaving CEX to wallets/DEX).
     DEX → CEX is exchange inflow. Direction is descriptive only. */
  let cexDexDirection = null;
  if (exchangeInUsd != null || exchangeOutUsd != null) {
    const inn = exchangeInUsd || 0;
    const out = exchangeOutUsd || 0;
    if (out > inn * 1.15) cexDexDirection = 'CEX_TO_DEX';
    else if (inn > out * 1.15) cexDexDirection = 'DEX_TO_CEX';
    else cexDexDirection = 'BALANCED';
  }

  const tokens = (overview.tokenActivity || []).slice(0, 10).map((r) => ({
    symbol: r.symbol,
    chain: r.chainShort || r.chainId || null,
    netUsd: num(r.netUsd),
    signal: r.signal || 'NEUTRAL',
    accumulation: num(r.accumulation),
    distribution: num(r.distribution),
    labelledEvents: num(r.labelledEvents) ?? num(r.events),
    wallets: num(r.wallets)
  }));

  const whales = (overview.whales || []).slice(0, 8).map((w) => ({
    address: w.address ? `${String(w.address).slice(0, 6)}…${String(w.address).slice(-4)}` : null,
    chain: w.chainShort || w.chainId || null,
    netUsd: num(w.netUsd),
    riskBand: w.riskBand || null,
    tags: Array.isArray(w.tags) ? w.tags.slice(0, 6) : []
  }));

  const early = (overview.earlyTokens?.tokens || overview.earlyTokens || []).slice?.(0, 5) || [];
  const fresh = (overview.freshWallets?.wallets || overview.freshWallets || []).slice?.(0, 5) || [];
  const liquidity = (overview.liquidityEvents?.events || overview.liquidityEvents || []).slice?.(0, 5) || [];

  /* Adapter evidence (strategy contract). */
  const adapter = smartMoneyEvidence({
    whaleEvents: overviewToWhaleEvents(overview),
    minUsd,
    maxAgeHrs: overview.window === '30d' ? 720 : overview.window === '7d' ? 168 : 24,
    now: overview.at || now
  });

  const signals = {
    window: overview.window || '24h',
    whaleActivity: whaleCount,
    accumulationUsd,
    distributionUsd,
    netFlowUsd,
    exchangeInflowUsd: exchangeInUsd,
    exchangeOutflowUsd: exchangeOutUsd,
    cexDexDirection,
    flowStatus: m.flowStatus || win?.dataStatus || null,
    flowEvents: num(m.flowEvents ?? win?.events),
    topTokens: tokens,
    whales,
    earlyTokenCount: Array.isArray(early) ? early.length : 0,
    freshWalletCount: Array.isArray(fresh) ? fresh.length : 0,
    liquidityEventCount: Array.isArray(liquidity) ? liquidity.length : 0,
    coverage: overview.coverage || null,
    streamStatus: overview.streamStatus || null,
    interpretation: 'Descriptive on-chain behaviour only — not advice, not a prediction, not insider detection.'
  };

  /* Alignment score in [-1, +1]: net accumulation vs distribution, scaled. */
  let alignment = null;
  if (netFlowUsd != null) {
    const scale = Math.max(Math.abs(netFlowUsd), 1_000_000);
    alignment = Math.max(-1, Math.min(1, netFlowUsd / scale));
  }

  const decisionConditions = [];
  if (netFlowUsd != null && Math.abs(netFlowUsd) >= 1_000_000) {
    decisionConditions.push(
      netFlowUsd < 0
        ? `smart money net distributing ~$${Math.round(Math.abs(netFlowUsd) / 1000)}k over the last window (observation, not a veto)`
        : `smart money net accumulating ~$${Math.round(netFlowUsd / 1000)}k over the last window (observation, not a signal to buy)`
    );
  }
  if (cexDexDirection === 'DEX_TO_CEX' && (exchangeInUsd || 0) >= 500_000) {
    decisionConditions.push('exchange inflow dominates (DEX→CEX) — coins moving toward venues, observation only');
  } else if (cexDexDirection === 'CEX_TO_DEX' && (exchangeOutUsd || 0) >= 500_000) {
    decisionConditions.push('exchange outflow dominates (CEX→DEX) — coins leaving venues, observation only');
  }
  if (whaleCount != null && whaleCount >= 20) {
    decisionConditions.push(`elevated whale activity: ${whaleCount} large transfers in window`);
  }
  const hotDist = tokens.filter((t) => t.signal === 'DISTRIBUTION').slice(0, 3);
  if (hotDist.length) {
    decisionConditions.push(`distribution-labelled tokens: ${hotDist.map((t) => t.symbol).join(', ')}`);
  }
  const hotAcc = tokens.filter((t) => t.signal === 'ACCUMULATION').slice(0, 3);
  if (hotAcc.length) {
    decisionConditions.push(`accumulation-labelled tokens: ${hotAcc.map((t) => t.symbol).join(', ')}`);
  }

  return {
    schema: SMART_MONEY_INTEL_SCHEMA,
    status: adapter.status === 'observed' || (whaleCount != null && whaleCount > 0) || netFlowUsd != null
      ? 'observed'
      : 'partial',
    dataStatus: dataStatus === 'live' ? 'live' : dataStatus,
    at: overview.at || now,
    signals,
    strategyEvidence: adapter.strategyEvidence || [],
    adapter,
    decisionConditions,
    alignment,
    executes: false,
    adviceOnly: true,
    note: 'Feeds Strategy + Decision as evidence. Never triggers execution.'
  };
}

/**
 * Fetch live overview (server-side) and build the intel digest.
 * Provider seam lets tests inject a fake overview without hitting RPC.
 */
export async function fetchSmartMoneyIntel({
  window = '24h',
  minUsd = 100_000,
  now = Date.now(),
  getOverview = null
} = {}) {
  let overview = null;
  try {
    if (typeof getOverview === 'function') {
      overview = await getOverview({ window });
    } else {
      const mod = await import('../smartMoney/index.js');
      overview = await mod.getOverview({ window });
    }
  } catch (err) {
    return {
      schema: SMART_MONEY_INTEL_SCHEMA,
      status: 'unavailable',
      dataStatus: 'unavailable',
      reason: `PROVIDER_ERROR:${String(err?.message || err).slice(0, 80)}`,
      at: now,
      signals: null,
      strategyEvidence: [],
      decisionConditions: [],
      alignment: null,
      note: 'Smart-money provider failed; nothing was invented.'
    };
  }
  return buildSmartMoneyIntel(overview, { now, minUsd });
}

/**
 * Attach smart-money evidence + notes onto strategy candidates (mutate-safe).
 * Returns new strategy objects; does not invent returns.
 */
export function enrichStrategiesWithSmartMoney(strategies = [], intel = null) {
  if (!intel || intel.status === 'unavailable') {
    return (Array.isArray(strategies) ? strategies : []).map((s) => ({
      ...s,
      smartMoney: null,
      smartMoneyNotes: null
    }));
  }
  const evidence = Array.isArray(intel.strategyEvidence) ? intel.strategyEvidence : [];
  const net = intel.signals?.netFlowUsd ?? null;
  const direction = intel.signals?.cexDexDirection || null;
  const notes = [];
  if (net != null) {
    notes.push(`smart-money net flow $${Math.round(net / 1000)}k (${net >= 0 ? 'accumulation-leaning' : 'distribution-leaning'})`);
  }
  if (direction) notes.push(`flow direction ${direction.replace(/_/g, '→')}`);
  if (intel.signals?.whaleActivity != null) notes.push(`${intel.signals.whaleActivity} whale events in window`);

  return (Array.isArray(strategies) ? strategies : []).map((s) => {
    const kind = String(s.kind || '').toUpperCase();
    /* Bias notes per kind — still observation, never a forced pick. */
    const kindNotes = [...notes];
    if (net != null && net < -1_000_000 && ['DCA_IN', 'YIELD_ON_IDLE'].includes(kind)) {
      kindNotes.push('distribution window — entries carry extra flow-risk (observation)');
    }
    if (net != null && net > 1_000_000 && kind === 'RISK_REDUCTION') {
      kindNotes.push('accumulation window — risk-off shift is more cautious than flow alone suggests');
    }
    if (net != null && net < -1_000_000 && kind === 'RISK_REDUCTION') {
      kindNotes.push('distribution window aligns with a risk-reduction posture');
    }
    return {
      ...s,
      evidence: [...(Array.isArray(s.evidence) ? s.evidence : []), ...evidence].slice(0, 16),
      smartMoney: {
        status: intel.status,
        netFlowUsd: net,
        cexDexDirection: direction,
        whaleActivity: intel.signals?.whaleActivity ?? null,
        alignment: intel.alignment,
        topTokens: (intel.signals?.topTokens || []).slice(0, 5)
      },
      smartMoneyNotes: kindNotes.length ? kindNotes : null,
      assumptions: [
        ...(Array.isArray(s.assumptions) ? s.assumptions : []),
        ...(net != null ? [`smart-money net $${Math.round(net / 1000)}k is an observation, not a forecast`] : [])
      ].slice(0, 12)
    };
  });
}

/**
 * How a strategy's kind aligns with the current smart-money window.
 * Returns a small additive score in roughly [-3, +3] or null when unknown.
 */
export function smartMoneyKindBias(kind, intel = null) {
  if (!intel || intel.alignment === null || intel.alignment === undefined) return null;
  const a = Number(intel.alignment);
  if (!Number.isFinite(a)) return null;
  const k = String(kind || '').toUpperCase();
  /* Distribution (a < 0): favour preservation / risk-reduction / deleverage.
     Accumulation (a > 0): mild favour for measured entry (DCA), not leverage. */
  if (a < -0.2) {
    if (k === 'RISK_REDUCTION' || k === 'DELEVERAGE' || k === 'HOLD') return Math.min(3, Math.abs(a) * 3);
    if (k === 'DCA_IN' || k === 'YIELD_ON_IDLE') return -Math.min(2, Math.abs(a) * 2);
    return 0;
  }
  if (a > 0.2) {
    if (k === 'DCA_IN') return Math.min(2, a * 2);
    if (k === 'HOLD') return Math.min(1, a);
    if (k === 'RISK_REDUCTION') return -Math.min(1.5, a * 1.5);
    return 0;
  }
  return 0;
}

export default fetchSmartMoneyIntel;
