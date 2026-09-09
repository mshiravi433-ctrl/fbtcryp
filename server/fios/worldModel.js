/**
 * FBT FINANCIAL INTELLIGENCE OS — Financial World Model (§4).
 * ---------------------------------------------------------------------------
 * The single object the rest of the pipeline reasons over. Six domains in
 * Phase 210, plus the Phase 211 GLOBAL domain:
 *
 *   USER        wallets, addresses, balances, positions, orders, P&L, fees
 *   GOALS       target, current, deadline, contribution, probability, health
 *   RISK        profile, concentration, volatility, leverage, liquidation
 *   PREFERENCES preferred assets/chains, fee + slippage + leverage tolerance
 *   MARKET      prices, liquidity, volume, volatility, funding, gas, TVL, APY
 *   EXTERNAL    news, macro, protocol announcements, security events
 *   GLOBAL      (Phase 211) smart money, whales, on-chain health, macro
 *               headlines, stocks, forex, commodities, RWA, cross-asset
 *
 * Every leaf is a provenance envelope (§5). A domain that could not be read is
 * present with `unavailable` leaves and a reason — the model never fills a gap
 * with a plausible number, and `provenance.unavailable[]` names exactly which
 * sources were missing so a caller can decide whether it may act at all.
 *
 * This module reads; it never writes to a venue and never holds a key (§50).
 */
import { createHash } from 'node:crypto';
import { fromSection, unavailable, provenanceSummary, isUsable, readValue, value as provenanceValue } from './provenance.js';
import { normalizeSections, buildCanonicalFinancialState, financialStateDigest } from './financialState.js';

export const WORLD_MODEL_SCHEMA = 'fbt.fi.world-model.v1';

/** Which state sections feed which domain. The central brain stores live
   market data under the `crypto` section (`{ symbols: [{symbol, priceUsd}] }`)
   and news under `news`; the `markets`/`signals` names are the provider-shaped
   sections the FI's own fixtures use. Both are read, so the domain works in
   production and in tests.
   Phase 211 ADDS the `global` domain (stocks/forex/commodities/macro/rwa/
   onchain/whales/smartmoney): it is fed by the Global Intelligence Engine's
   snapshot when the caller passes one, and by those section names otherwise
   (the provider-shaped seam fixtures use) — an unread class is an honest
   `unavailable` leaf, never a guessed number. */
export const DOMAIN_SECTIONS = Object.freeze({
  user: ['wallet', 'portfolio', 'positions', 'orders', 'lending', 'borrowing', 'farming', 'liquidity', 'futures', 'dydx', 'transactions'],
  goals: ['goals', 'profitPlan'],
  risk: ['risk', 'alerts'],
  market: ['markets', 'crypto', 'signals'],
  external: ['news', 'events'],
  global: ['stocks', 'forex', 'commodities', 'macro', 'rwa', 'onchain', 'whales', 'smartmoney']
});

/** The Phase 211 global classes and the global-intel domain each maps to. */
export const GLOBAL_DOMAIN_MAP = Object.freeze({
  stocks: 'stocks',
  forex: 'forex',
  commodities: 'commodities',
  macro: 'macro',
  rwa: 'rwa',
  onchain: 'onchain',
  whales: 'whales',
  smartMoney: 'smart_money'
});

/** The world model's global-domain leaf names (digest + walk helpers). */
export const GLOBAL_DOMAIN_LEAVES = Object.freeze([
  'smartMoney', 'whales', 'onchain', 'macro', 'stocks', 'forex', 'commodities', 'rwa', 'crossAsset'
]);

const env = (meta, key, pick = null, fallbackKey = null) => {
  if (!meta[key]) return unavailable(fallbackKey || `${String(key).toUpperCase()}_NEVER_READ`, { source: key });
  const envelope = fromSection(meta[key], { pick });
  /* The section was read but does not carry this field. That is a gap, and a
     gap must be reported as unavailable rather than shown as a null value. */
  if (envelope.value === null || envelope.value === undefined) {
    return unavailable(fallbackKey || `${String(key).toUpperCase()}_NOT_IN_SOURCE`, { source: meta[key].source || key });
  }
  return envelope;
};

/* First section among `keys` that actually carries a non-null picked value.
   Used where the same fact can arrive under several section names (e.g. the
   brain's `crypto` vs the provider-shaped `markets`). */
const envFirst = (meta, keys, pick = null, fallbackKey = null) => {
  for (const key of keys) {
    if (!meta[key]) continue;
    const envelope = fromSection(meta[key], { pick });
    if (envelope.value === null || envelope.value === undefined) continue;
    return envelope;
  }
  return unavailable(fallbackKey || `${String(keys[0] || 'field').toUpperCase()}_UNREAD`, { source: keys.join('|') });
};

/* Normalised price map from whichever section shape arrived: a literal
   `prices` object, a `coins` array, or the brain's `crypto.symbols` array. */
const pickPrices = (d) => {
  if (d?.prices && typeof d.prices === 'object') return d.prices;
  const rows = Array.isArray(d?.coins) ? d.coins : Array.isArray(d?.symbols) ? d.symbols : null;
  if (rows) {
    const map = {};
    for (const row of rows) {
      const symbol = String(row?.symbol || '').toUpperCase();
      if (symbol && Number.isFinite(Number(row?.priceUsd))) map[symbol] = Number(row.priceUsd);
    }
    return Object.keys(map).length ? map : null;
  }
  return null;
};

/**
 * @param {object} p
 * @param {string} p.owner
 * @param {object} p.sections  system state (`{sections}`) or a plain map
 * @param {object} [p.preferences]  resolved preference model (already merged)
 * @param {object} [p.genome]       intent genome
 * @param {object} [p.research]     latest research bundle (digest only)
 * @param {object} [p.goals]        `{ goals: [...], progress: {...} }`
 * @param {object} [p.capabilities] capability matrix from the brain
 * @param {object} [p.globalIntel]  Phase 211 — Global Intelligence Engine
 *                                  snapshot; fills the `global` domain leaves
 * @param {object} [p.crossAsset]   Phase 211 — cross-asset analysis (regime)
 * @param {number} [p.now]
 */
export function buildWorldModel({
  owner = null, sections = {}, preferences = null, genome = null, research = null,
  goals = null, capabilities = null, globalIntel = null, crossAsset = null, now = Date.now()
} = {}) {
  const { meta, data } = normalizeSections(sections);
  const financial = buildCanonicalFinancialState({ owner, sections, now });

  /* ── USER ─────────────────────────────────────────────────────────────── */
  const wallet = env(meta, 'wallet');
  const user = {
    wallets: wallet,
    addresses: env(meta, 'wallet', (d) => ({
      evm: Array.isArray(d?.evmAddresses) ? d.evmAddresses : (d?.address ? [d.address] : []),
      solana: Array.isArray(d?.solanaAddresses) ? d.solanaAddresses : [],
      chainsRead: Array.isArray(d?.chainsRead) ? d.chainsRead : []
    }), 'WALLET_NOT_CONNECTED'),
    balances: env(meta, 'wallet', (d) => d?.balances || null, 'BALANCES_UNREAD'),
    holdings: financial.positions?.holdings || unavailable('PORTFOLIO_UNREAD'),
    chainExposureUsd: financial.positions?.chainExposureUsd || unavailable('PORTFOLIO_UNREAD'),
    positions: {
      spot: financial.positions?.holdings || unavailable('PORTFOLIO_UNREAD'),
      lending: financial.positions?.lending,
      borrowing: env(meta, 'borrowing'),
      farming: financial.positions?.farming,
      liquidity: env(meta, 'liquidity'),
      futures: financial.positions?.futures,
      dydx: env(meta, 'dydx'),
      orders: financial.positions?.orders,
      conditionalOrders: env(meta, 'orders', (d) => d?.conditional || d?.conditionalOrders || null, 'NO_CONDITIONAL_ORDERS')
    },
    pnl: {
      unrealizedUsd: financial.performance?.unrealizedPnlUsd,
      realizedUsd: financial.performance?.realizedPnlUsd,
      drawdownPct: financial.performance?.drawdownPct
    },
    fees: financial.fees,
    transactions: env(meta, 'transactions'),
    net: financial.net
  };

  /* ── GOALS ────────────────────────────────────────────────────────────── */
  const goalsSection = env(meta, 'goals', (d) => d?.goals || d || null);
  const goalRows = Array.isArray(goals?.goals) ? goals.goals : (isUsable(goalsSection) && Array.isArray(readValue(goalsSection)) ? readValue(goalsSection) : []);
  const goalDomain = {
    rows: goals?.goals ? { ...goalsSection, value: goals.goals, status: 'ok' } : goalsSection,
    progress: goals?.progress
      ? { schema: 'fbt.fi.provenance.v1', status: 'ok', value: goals.progress, source: 'goal-engine', at: goals.progressAt || now, freshness: 'LIVE', ttlMs: 10 * 60_000, confidence: 0.9 }
      : unavailable('GOAL_PROGRESS_NOT_COMPUTED', { source: 'goal-engine' }),
    health: goals?.health || null,
    count: goalRows.length
  };

  /* ── RISK ─────────────────────────────────────────────────────────────── */
  const riskSection = env(meta, 'risk');
  const risk = {
    profile: preferences?.riskTolerance
      ? { schema: 'fbt.fi.provenance.v1', status: 'ok', value: preferences.riskTolerance, source: preferences.riskToleranceOrigin === 'explicit' ? 'user-stated' : 'inferred', at: preferences.updatedAt || now, freshness: 'LIVE', ttlMs: 30 * 24 * 3600_000, confidence: preferences.riskToleranceOrigin === 'explicit' ? 0.95 : 0.6 }
      : unavailable('RISK_PROFILE_UNKNOWN', { source: 'preferences' }),
    concentration: financial.risk?.concentration,
    volatilityExposurePct: financial.risk?.volatilityPct,
    leverage: financial.risk?.leverage,
    liquidationRisk: env(meta, 'risk', (d) => d?.liquidation || d?.liquidationRisk || null, 'LIQUIDATION_RISK_UNREAD'),
    protocolRisk: env(meta, 'risk', (d) => d?.protocol || d?.protocolRisk || null, 'PROTOCOL_RISK_UNREAD'),
    liquidityRisk: financial.liquidity?.status === 'UNAVAILABLE'
      ? unavailable(financial.liquidity?.reason || 'LIQUIDITY_UNAVAILABLE', { source: 'financial-state' })
      : { schema: 'fbt.fi.provenance.v1', status: 'ok', value: financial.liquidity, source: 'financial-state', at: now, freshness: 'LIVE', ttlMs: 60_000, confidence: financial.confidence },
    assessment: riskSection
  };

  /* ── PREFERENCES ──────────────────────────────────────────────────────── */
  const prefEnv = (key, reason) => (preferences && preferences[key] !== undefined && preferences[key] !== null
    ? {
        schema: 'fbt.fi.provenance.v1', status: 'ok', value: preferences[key],
        source: preferences[`${key}Origin`] === 'explicit' ? 'user-stated' : (preferences[`${key}Origin`] === 'behavior' ? 'user-behavior' : 'inferred'),
        at: preferences.updatedAt || now, freshness: 'LIVE',
        ttlMs: 30 * 24 * 3600_000,
        confidence: preferences[`${key}Origin`] === 'explicit' ? 0.95 : preferences[`${key}Origin`] === 'behavior' ? 0.7 : 0.5,
        note: preferences[`${key}Origin`] || null
      }
    : unavailable(reason, { source: 'preferences' }));
  const preferenceDomain = {
    preferredAssets: prefEnv('preferredAssets', 'NO_ASSET_PREFERENCE'),
    preferredChains: prefEnv('preferredChains', 'NO_CHAIN_PREFERENCE'),
    feeSensitivity: prefEnv('feeSensitivity', 'NO_FEE_PREFERENCE'),
    slippageTolerancePct: prefEnv('slippageTolerancePct', 'NO_SLIPPAGE_PREFERENCE'),
    leverageTolerance: prefEnv('leverageTolerance', 'NO_LEVERAGE_PREFERENCE'),
    holdingPeriod: prefEnv('investmentHorizon', 'NO_HORIZON_PREFERENCE'),
    tradingStyle: prefEnv('tradingFrequency', 'NO_STYLE_PREFERENCE'),
    executionStyle: prefEnv('preferredExecutionStyle', 'NO_EXECUTION_PREFERENCE'),
    riskTolerance: risk.profile,
    genome: genome
      ? { schema: 'fbt.fi.provenance.v1', status: 'ok', value: genome, source: 'intent-genome', at: genome.updatedAt || now, freshness: 'LIVE', ttlMs: 30 * 24 * 3600_000, confidence: genome.confidence?.overall ?? 0.5 }
      : unavailable('GENOME_NOT_BUILT', { source: 'intent-genome' })
  };

  /* ── MARKET ───────────────────────────────────────────────────────────── */
  const markets = env(meta, 'markets');
  const crypto = env(meta, 'crypto');
  const market = {
    prices: envFirst(meta, ['markets', 'crypto'], pickPrices, 'PRICES_UNREAD'),
    rows: isUsable(markets) ? markets : crypto,
    volatilityPct: env(meta, 'markets', (d) => d?.volatilityPct || null, 'VOLATILITY_UNREAD'),
    volumeUsd: env(meta, 'markets', (d) => (Array.isArray(d?.coins) ? d.coins.reduce((a, c) => a + (Number(c.volumeUsd) || 0), 0) : d?.totalVolumeUsd ?? null), 'VOLUME_UNREAD'),
    liquidity: env(meta, 'signals', (d) => d?.liquidity || null, 'LIQUIDITY_UNREAD'),
    funding: env(meta, 'signals', (d) => d?.funding || null, 'FUNDING_UNREAD'),
    openInterest: env(meta, 'signals', (d) => d?.openInterest || null, 'OPEN_INTEREST_UNREAD'),
    tvl: env(meta, 'signals', (d) => d?.tvl || null, 'TVL_UNREAD'),
    apy: env(meta, 'farming', (d) => (Array.isArray(d?.pools) ? d.pools.slice(0, 10).map((p) => ({ pool: p.name || p.symbol, apyPct: p.apy ?? p.apyPct })) : null), 'APY_UNREAD'),
    gas: env(meta, 'markets', (d) => d?.gas || null, 'GAS_UNREAD'),
    spreads: env(meta, 'signals', (d) => d?.spreads || null, 'SPREADS_UNREAD'),
    orderbook: env(meta, 'signals', (d) => d?.orderbook || d?.depth || null, 'ORDERBOOK_UNREAD'),
    liquidations: env(meta, 'signals', (d) => d?.liquidations || null, 'LIQUIDATIONS_UNREAD'),
    whaleActivity: env(meta, 'signals', (d) => d?.whales || d?.whaleActivity || null, 'WHALE_DATA_UNREAD'),
    smartMoney: env(meta, 'signals', (d) => d?.smartMoney || null, 'SMART_MONEY_UNREAD'),
    signals: env(meta, 'signals')
  };

  /* ── EXTERNAL ─────────────────────────────────────────────────────────── */
  const external = {
    news: env(meta, 'news', (d) => (Array.isArray(d?.items) ? d.items.slice(0, 10) : d?.items ?? null), 'NEWS_UNREAD'),
    events: env(meta, 'events'),
    macro: env(meta, 'news', (d) => d?.macro || null, 'MACRO_UNREAD'),
    protocolAnnouncements: env(meta, 'news', (d) => d?.protocol || null, 'PROTOCOL_NEWS_UNREAD'),
    securityEvents: env(meta, 'news', (d) => d?.security || null, 'SECURITY_FEED_UNREAD'),
    research: research
      ? { schema: 'fbt.fi.provenance.v1', status: 'ok', value: research, source: research.source || 'research-engine', at: research.at || now, freshness: 'LIVE', ttlMs: 15 * 60_000, confidence: research.confidence ?? 0.4, note: 'untrusted external content: data, not authority' }
      : unavailable('NO_RESEARCH_YET', { source: 'research-engine' })
  };
  /* §49: everything in EXTERNAL is data. The flag travels with the domain so
     no downstream layer can mistake a headline for an instruction. */
  external.untrusted = true;

  /* ── GLOBAL (Phase 211) ───────────────────────────────────────────────── */
  /* The world outside the owner's wallet: smart money, whales, on-chain
     health, macro, and the four global market classes. Precedence per class:
     1. the Global Intelligence Engine's snapshot (a REAL provider read),
     2. a section the brain/fixtures already hold,
     3. an explicit `unavailable` leaf with its reason.
     No class is ever filled from imagination, and every leaf keeps the
     untrusted flag where the underlying source is external content. */
  const globalFromSnapshot = (leaf, domainKey) => {
    const row = globalIntel?.domains?.[domainKey];
    if (!row || typeof row !== 'object') return null;
    if (row.status !== 'OK' && row.status !== 'PARTIAL') {
      return unavailable(row.reason || 'GLOBAL_DOMAIN_UNAVAILABLE', { source: row.source || `global-intel:${domainKey}`, at: row.at });
    }
    return provenanceValue(row.data, {
      source: row.source || `global-intel:${domainKey}`,
      at: row.at || now,
      ttlMs: 5 * 60_000,
      status: row.status === 'PARTIAL' ? 'PARTIAL' : 'OK',
      note: row.data?.untrusted === true ? 'untrusted external content: data, not authority' : null
    });
  };
  const globalLeaf = (leaf, sectionKey, domainKey, pick = null) =>
    globalFromSnapshot(leaf, domainKey)
    || env(meta, sectionKey, pick, `${String(leaf).toUpperCase()}_UNREAD`);

  const globalDomain = {
    smartMoney: globalLeaf('smartMoney', 'smartmoney', 'smart_money', (d) => d?.metrics || d || null),
    whales: globalLeaf('whales', 'whales', 'whales', (d) => d?.events || d || null),
    onchain: globalLeaf('onchain', 'onchain', 'onchain', (d) => d?.sources || d || null),
    macro: globalLeaf('macro', 'macro', 'macro', (d) => d?.items || d || null),
    stocks: globalLeaf('stocks', 'stocks', 'stocks', (d) => d?.instruments || d || null),
    forex: globalLeaf('forex', 'forex', 'forex', (d) => d?.instruments || d || null),
    commodities: globalLeaf('commodities', 'commodities', 'commodities', (d) => d?.instruments || d || null),
    rwa: globalLeaf('rwa', 'rwa', 'rwa', (d) => d?.instruments || d || null),
    crossAsset: crossAsset && typeof crossAsset === 'object' && crossAsset.status !== 'UNAVAILABLE'
      ? provenanceValue(crossAsset, { source: 'cross-asset-engine', at: crossAsset.at || now, ttlMs: 5 * 60_000, note: 'derived: cross-class breadth and regime from real per-instrument changes' })
      : unavailable('CROSS_ASSET_NOT_COMPUTED', { source: 'cross-asset-engine' })
  };
  /* External intelligence is data, not authority — the same §49 flag. */
  globalDomain.untrusted = true;

  const domains = { user, goals: goalDomain, risk, preferences: preferenceDomain, market, external, global: globalDomain };
  const flat = flattenEnvelopes(domains);
  const provenance = provenanceSummary(flat, { now });

  const missing = Array.from(new Set([
    ...(financial.missing || []),
    ...provenance.unavailable
  ]));

  const model = {
    schema: WORLD_MODEL_SCHEMA,
    owner,
    at: now,
    status: provenance.coverage === 0 ? 'UNAVAILABLE' : provenance.coverage < 0.4 ? 'PARTIAL' : 'OK',
    domains,
    financial: {
      status: financial.status,
      id: financial.id || null,
      digest: financialStateDigest(financial),
      missing: financial.missing
    },
    capabilities: capabilities || null,
    provenance,
    missing
  };
  model.id = `ws_${createHash('sha256').update(JSON.stringify({ owner, at: now, rev: financial.id, cov: provenance.coverage })).digest('hex').slice(0, 20)}`;
  return model;
}

function flattenEnvelopes(node, out = {}) {
  if (!node || typeof node !== 'object') return out;
  if (node.schema === 'fbt.fi.provenance.v1') { out[node.source || 'unknown'] = node; return out; }
  for (const [k, v] of Object.entries(node)) {
    if (k === 'untrusted') continue;
    if (v && typeof v === 'object' && v.schema === 'fbt.fi.provenance.v1') out[`${k}`] = v;
    else if (v && typeof v === 'object') flattenEnvelopes(v, out);
  }
  return out;
}

/** The bounded, model-safe view (§42): numbers and gaps only. */
export function worldModelDigest(model) {
  if (!model) return { available: false, reason: 'NO_WORLD_MODEL' };
  const pick = (e) => (isUsable(e) ? e.value : null);
  return {
    available: true,
    at: model.at,
    status: model.status,
    financial: model.financial?.digest || null,
    goals: { count: model.domains?.goals?.count ?? 0, progress: pick(model.domains?.goals?.progress) },
    risk: {
      profile: pick(model.domains?.risk?.profile),
      concentration: pick(model.domains?.risk?.concentration),
      leverage: pick(model.domains?.risk?.leverage),
      volatilityPct: pick(model.domains?.risk?.volatilityExposurePct)
    },
    preferences: {
      riskTolerance: pick(model.domains?.preferences?.riskTolerance),
      preferredChains: pick(model.domains?.preferences?.preferredChains),
      feeSensitivity: pick(model.domains?.preferences?.feeSensitivity),
      slippageTolerancePct: pick(model.domains?.preferences?.slippageTolerancePct)
    },
    market: {
      priceCount: Object.keys(pick(model.domains?.market?.prices) || {}).length,
      volatilityPct: pick(model.domains?.market?.volatilityPct),
      apy: pick(model.domains?.market?.apy),
      gas: pick(model.domains?.market?.gas)
    },
    external: {
      newsCount: Array.isArray(pick(model.domains?.external?.news)) ? pick(model.domains?.external?.news).length : 0,
      research: model.domains?.external?.research?.status === 'ok' ? { confidence: model.domains.external.research.confidence, at: model.domains.external.research.at } : null,
      untrusted: true
    },
    global: {
      regime: pick(model.domains?.global?.crossAsset)?.regime?.regime || null,
      live: GLOBAL_DOMAIN_LEAVES.filter((l) => isUsable(model.domains?.global?.[l])).length,
      untrusted: true
    },
    coverage: model.provenance?.coverage ?? 0,
    /* Bounded on purpose: the digest is the model-safe view, so the missing
       list is capped here (with the true count) — the FULL list stays on the
       world model and in provenance.unavailable. Phase 211's global domain
       added honest gaps; the digest must stay bounded regardless. */
    missing: (model.missing || []).slice(0, 8),
    missingCount: (model.missing || []).length
  };
}

export { flattenEnvelopes };
