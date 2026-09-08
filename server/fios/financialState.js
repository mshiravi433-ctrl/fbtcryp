/**
 * FBT FINANCIAL INTELLIGENCE OS — Canonical Financial State (§6).
 * ---------------------------------------------------------------------------
 * ONE object that answers "what is this user's financial situation right now",
 * built from the SAME state sections the chat reads (so the panel and the
 * brain can never disagree), with every headline number wrapped in a
 * provenance envelope (§5).
 *
 * The arithmetic is NOT re-implemented here: `src/lib/central/financialState.js`
 * already computes net worth, debt, exposure, concentration, drawdown and a
 * derived confidence, and it is the engine the Upgrade-10 kernel and its probe
 * suite exercise. This module's job is the three things that engine does not
 * do: attach provenance per field, keep a snapshot history per owner, and
 * produce the compact digest that is safe to hand to a model (§42).
 */
import { createHash } from 'node:crypto';
import { round } from '../../src/lib/central/schema.js';
import { buildFinancialState, liquidityProfile } from '../../src/lib/central/financialState.js';
import { fromSection, provenanceSummary, unavailable, value, isUsable, readValue } from './provenance.js';

export const FINANCIAL_STATE_SCHEMA = 'fbt.fi.financial-state.v1';

/** Section keys this state is composed from. */
export const FINANCIAL_SECTIONS = Object.freeze([
  'wallet', 'portfolio', 'positions', 'orders', 'lending', 'borrowing',
  'farming', 'liquidity', 'futures', 'dydx', 'transactions', 'goals',
  'markets', 'risk'
]);

/**
 * Accept either a full system state (`{ sections: {...} }`, what
 * `stateStore.peek(owner)` returns) or a plain `{ portfolio: {...} }` map
 * (what the probes and the twin use) and normalise both.
 */
export function normalizeSections(input = {}) {
  const raw = input && input.sections && typeof input.sections === 'object' ? input.sections : input;
  const meta = {};
  const data = {};
  for (const [key, section] of Object.entries(raw || {})) {
    if (!section || typeof section !== 'object') continue;
    const isSectionEnvelope = 'data' in section && ('status' in section || 'updatedAt' in section);
    meta[key] = isSectionEnvelope ? section : { key, data: section, status: 'OK', source: input.source || 'client', updatedAt: section.at || Date.now(), ttlMs: section.ttlMs || 60_000 };
    data[key] = isSectionEnvelope ? section.data : section;
  }
  return { meta, data };
}

const envFor = (meta, key, pick = null) => (meta[key] ? fromSection(meta[key], { pick }) : unavailable('SECTION_NEVER_READ', { source: key }));

/**
 * @param {object} params
 * @param {string} params.owner
 * @param {object} params.sections system state or a plain section map
 * @param {number} [params.now]
 * @returns canonical financial state with provenance per field
 */
export function buildCanonicalFinancialState({ owner = null, sections = {}, now = Date.now() } = {}) {
  const { meta, data } = normalizeSections(sections);
  const computed = buildFinancialState(data, { now });

  if (computed.status === 'UNAVAILABLE') {
    return {
      schema: FINANCIAL_STATE_SCHEMA,
      status: 'UNAVAILABLE',
      reason: computed.reason || 'NO_FINANCIAL_STATE',
      detail: computed.detail || null,
      missing: computed.missing || [],
      at: now,
      owner,
      confidence: 0,
      provenance: provenanceSummary({}, { now }),
      worldInputs: Object.keys(data)
    };
  }

  const portfolioEnv = envFor(meta, 'portfolio');
  const walletEnv = envFor(meta, 'wallet');
  const marketsEnv = envFor(meta, 'markets');
  const transactionsEnv = envFor(meta, 'transactions');
  const lendingEnv = envFor(meta, 'lending');
  const futuresEnv = envFor(meta, 'futures');
  const farmingEnv = envFor(meta, 'farming');
  const ordersEnv = envFor(meta, 'orders');
  const riskEnv = envFor(meta, 'risk');

  /* Each headline number inherits the provenance of the section that produced
     it. A number we computed from several sections takes the WORST of them
     (`derived` semantics) — net worth is never fresher than the portfolio read
     it summed. */
  const withSource = (v, env, fallbackReason = 'NOT_COMPUTED') => (v === null || v === undefined
    ? unavailable(fallbackReason, { source: env?.source || null, at: env?.at || now })
    : { ...env, value: v, status: 'ok', freshness: env?.freshness || 'LIVE', confidence: env?.confidence ?? 0 });

  const net = {
    netWorthUsd: withSource(computed.netWorthUsd, portfolioEnv, 'DEBT_OR_ASSETS_UNREAD'),
    grossAssetsUsd: withSource(computed.grossAssetsUsd, portfolioEnv),
    availableCapitalUsd: withSource(computed.availableCapitalUsd, portfolioEnv),
    investedCapitalUsd: withSource(computed.investedCapitalUsd, portfolioEnv),
    debtUsd: withSource(computed.debtUsd, lendingEnv, 'DEBT_UNREAD'),
    stableUsd: withSource(computed.stableUsd, portfolioEnv)
  };
  const performance = {
    realizedPnlUsd: withSource(computed.realizedPnlUsd, transactionsEnv, 'PNL_UNREAD'),
    unrealizedPnlUsd: withSource(computed.unrealizedPnlUsd, portfolioEnv, 'PNL_UNREAD'),
    drawdownPct: withSource(computed.drawdownPct, portfolioEnv, 'NO_PEAK_VALUE'),
    blendedYieldPct: withSource(computed.blendedYieldPct, farmingEnv, 'NO_YIELD_POSITIONS')
  };
  const risk = {
    concentration: computed.concentration?.level
      ? withSource(computed.concentration, portfolioEnv)
      : unavailable('CONCENTRATION_UNAVAILABLE', { source: 'portfolio', at: now }),
    leverage: withSource(computed.leverage, futuresEnv, 'NO_LEVERAGED_POSITION'),
    volatilityPct: withSource(computed.volatilityPct, marketsEnv, 'VOLATILITY_UNREAD'),
    netExposureUsd: withSource(computed.netExposureUsd, futuresEnv, 'EXPOSURE_UNAVAILABLE'),
    liquidationRisk: riskEnv && isUsable(fromSection(meta.risk || {}, {})) ? envFor(meta, 'risk', (d) => d?.liquidation || d?.liquidationRisk || null) : unavailable('RISK_SECTION_UNREAD', { source: 'risk', at: now })
  };
  const positions = {
    holdings: portfolioEnv,
    lending: lendingEnv,
    futures: futuresEnv,
    farming: farmingEnv,
    orders: ordersEnv,
    chainExposureUsd: withSource(computed.chainExposureUsd, portfolioEnv),
    assetExposureUsd: withSource(computed.assetExposureUsd, portfolioEnv)
  };

  const liquidity = liquidityProfile(computed, { horizonHours: 24 });
  const fees = transactionsEnv && isUsable(transactionsEnv)
    ? envFor(meta, 'transactions', (d) => (d?.feesUsd ?? d?.totalFeesUsd ?? (Array.isArray(d?.rows) ? round(d.rows.reduce((a, r) => a + (Number(r.feeUsd) || 0), 0), 2) : null)))
    : unavailable('FEES_UNREAD', { source: 'transactions', at: now });

  const all = { ...net, ...performance, ...risk, ...positions, fees, wallet: walletEnv };
  const provenance = provenanceSummary(all, { now });

  const state = {
    schema: FINANCIAL_STATE_SCHEMA,
    status: computed.status,
    at: now,
    owner,
    /* The computed engine result, kept whole: the envelopes above are the
       presentation layer, this is the arithmetic. */
    computed,
    net,
    performance,
    risk,
    positions,
    liquidity,
    fees,
    wallet: walletEnv,
    missing: computed.missing || [],
    confidence: computed.confidence,
    provenance,
    worldInputs: computed.inputs || [],
    note: computed.note || null
  };
  state.id = `fs_${createHash('sha256').update(JSON.stringify({ owner, at: now, nw: computed.netWorthUsd, assets: computed.grossAssetsUsd, missing: state.missing })).digest('hex').slice(0, 20)}`;
  return state;
}

/**
 * The digest handed to a model or a card. Bounded and number-only: no raw
 * holdings dump, no order book, no 40 KB of news (§42 "avoid sending huge raw
 * datasets to the LLM").
 */
export function financialStateDigest(state) {
  if (!state || state.status === 'UNAVAILABLE') {
    return { available: false, reason: state?.reason || 'NO_FINANCIAL_STATE', missing: state?.missing || [] };
  }
  const v = (env) => (isUsable(env) ? env.value : null);
  return {
    available: true,
    status: state.status,
    asOf: state.at,
    netWorthUsd: v(state.net?.netWorthUsd),
    availableCapitalUsd: v(state.net?.availableCapitalUsd),
    investedCapitalUsd: v(state.net?.investedCapitalUsd),
    debtUsd: v(state.net?.debtUsd),
    stableUsd: v(state.net?.stableUsd),
    unrealizedPnlUsd: v(state.performance?.unrealizedPnlUsd),
    realizedPnlUsd: v(state.performance?.realizedPnlUsd),
    drawdownPct: v(state.performance?.drawdownPct),
    blendedYieldPct: v(state.performance?.blendedYieldPct),
    concentration: v(state.risk?.concentration) || null,
    leverage: v(state.risk?.leverage),
    volatilityPct: v(state.risk?.volatilityPct),
    holdingsCount: state.computed?.holdingsCounted ?? null,
    unpricedHoldings: state.computed?.holdingsUnvalued ?? null,
    topAssets: Object.entries(state.computed?.assetExposureUsd || {}).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([symbol, usd]) => ({ symbol, usd })),
    chains: Object.entries(state.computed?.chainExposureUsd || {}).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([chain, usd]) => ({ chain, usd })),
    missing: state.missing || [],
    confidence: state.confidence,
    dataCoverage: state.provenance?.coverage ?? 0,
    staleSources: state.provenance?.stale || []
  };
}

/** Snapshot row for the history collection + the guardian's change detection. */
export function snapshotRow(state) {
  if (!state || state.status === 'UNAVAILABLE') return null;
  return {
    id: state.id,
    at: state.at,
    netWorthUsd: readValue(state.net?.netWorthUsd),
    availableCapitalUsd: readValue(state.net?.availableCapitalUsd),
    debtUsd: readValue(state.net?.debtUsd),
    drawdownPct: readValue(state.performance?.drawdownPct),
    blendedYieldPct: readValue(state.performance?.blendedYieldPct),
    volatilityPct: readValue(state.risk?.volatilityPct),
    leverage: readValue(state.risk?.leverage),
    concentration: readValue(state.risk?.concentration) || null,
    topAsset: state.computed?.concentration?.topAsset || null,
    topSharePct: state.computed?.concentration?.topSharePct ?? null,
    confidence: state.confidence,
    missing: state.missing || []
  };
}

/** Human line for the chat: never a number we did not read. */
export function headline(state) {
  if (!state || state.status === 'UNAVAILABLE') return null;
  const nw = readValue(state.net?.netWorthUsd);
  if (nw === null) return null;
  const parts = [`net worth $${round(nw, 2).toLocaleString('en-US')}`];
  const avail = readValue(state.net?.availableCapitalUsd);
  if (avail !== null) parts.push(`available $${round(avail, 2).toLocaleString('en-US')}`);
  const debt = readValue(state.net?.debtUsd);
  if (debt !== null && debt > 0) parts.push(`debt $${round(debt, 2).toLocaleString('en-US')}`);
  const dd = readValue(state.performance?.drawdownPct);
  if (dd !== null && dd < 0) parts.push(`drawdown ${dd}%`);
  return parts.join(' · ');
}

export { value as provenanceValue };
