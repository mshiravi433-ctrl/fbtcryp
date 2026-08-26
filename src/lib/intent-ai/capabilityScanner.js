/**
 * FBT INTENT AI — capability discovery and score.
 *
 * This is a deterministic scanner, not a claim that every repository module is
 * live. Code presence, runtime configuration and operational evidence remain
 * separate. Missing metrics produce `score: null`, never a guessed percentage.
 */

export const CAPABILITY_SCANNER_SCHEMA = 'fbt.intent-capability-scan.v1';
export const CAPABILITY_SCAN_SCHEMA = CAPABILITY_SCANNER_SCHEMA;
export const CAPABILITY_SCORE_SCHEMA = 'fbt.intent-capability-score.v1';
export const CAPABILITY_SCORING = Object.freeze(['usefulness', 'risk', 'cost', 'reliability', 'liquidity', 'expectedImpact', 'executionQuality']);

const metricNames = Object.freeze([
  'usefulness',
  'risk',
  'cost',
  'reliability',
  'liquidity',
  'expectedImpact',
  'executionQuality'
]);

const CATALOG_ROWS = [
  ['smart-wallet', 'Smart Wallet', true, 'Policy-controlled account permissions can constrain execution.'],
  ['wallet-connect', 'WalletConnect', true, 'User wallet connection is required for user-signed execution.'],
  ['swap', 'Swap', true, 'Existing swap routes can prepare and submit user-signed trades.'],
  ['dex-aggregator', 'DEX Aggregator', true, 'Existing aggregators can be compared before the user signs.'],
  ['liquidity-router', 'Liquidity Router', true, 'Route selection can use available aggregator liquidity evidence.'],
  ['bridge', 'Bridge', true, 'Quote support exists; bridge execution must be independently configured.'],
  ['cross-chain-execution', 'Cross-chain Execution', false, 'No atomic cross-chain execution is claimed.'],
  ['defi', 'DeFi', true, 'DeFi routes are capability-dependent and must provide protocol evidence.'],
  ['farming', 'Farming', true, 'Farming is optional and requires an approved protocol adapter.'],
  ['staking', 'Staking', true, 'Staking is optional and requires an approved protocol adapter.'],
  ['lending', 'Lending', true, 'Lending is optional and requires protocol and liquidation evidence.'],
  ['borrowing', 'Borrowing', true, 'Borrowing is optional and must pass leverage/liquidation checks.'],
  ['investment', 'Investment', true, 'Investment advice is analysis until the user authorizes execution.'],
  ['signals', 'Signals', true, 'Signals are evidence, not a guarantee or an execution command.'],
  ['intent-os', 'Intent OS', true, 'The Intent OS compiler and review surface are available.'],
  ['portfolio', 'Portfolio', true, 'Portfolio analysis is available without execution permission.'],
  ['futures', 'Futures', true, 'Futures are high-risk and require an explicitly connected venue.'],
  ['perpetuals', 'Perpetual contracts', true, 'Perpetual contracts require leverage, funding and liquidation evidence.'],
  ['dydx', 'dYdX', true, 'dYdX is conditional on an active session and signer.'],
  ['cex-connectors', 'CEX Connectors', true, 'CEX access requires a scoped broker handle and policy.'],
  ['stablecoin-conversion', 'Stablecoin Conversion', true, 'Stablecoin routes remain user-signed swaps.'],
  ['limit-orders', 'Limit Orders', true, 'Limit orders require an approved order watcher and expiry.'],
  ['stop-loss', 'Stop Loss', true, 'Stop loss is an exit policy, not a guarantee of fill price.'],
  ['take-profit', 'Take Profit', true, 'Take profit is an exit policy, not a guaranteed execution.'],
  ['dca', 'DCA', true, 'DCA is a recurring intent with explicit schedule and cancellation.'],
  ['ai-prediction', 'AI Prediction', true, 'Predictions are uncertain evidence and never a promise.'],
  ['mev-protection', 'MEV Protection', true, 'Protection is available only when transport actually proves it.'],
  ['gas-optimization', 'Gas Optimization', true, 'Gas estimates must be sourced; missing data remains null.'],
  ['risk-engine', 'Risk Engine', true, 'Bounded risk evaluation runs before authorization; it never executes.'],
  ['rwa', 'RWA', false, 'Real-world assets require an external adapter and jurisdiction evidence; none is claimed.'],
  ['payment', 'Payment', false, 'Payments require an external payment adapter with settlement evidence.'],
  ['p2p', 'P2P', false, 'P2P trades require the P2P adapter and its own dispute/settlement evidence.'],
  ['shop', 'Shop', false, 'Shop checkout requires the commerce adapter with merchant settlement evidence.'],
  ['external-ai-agents', 'External AI Agents', true, 'External agents require verification, scope and user opt-in.']
];

export const CAPABILITY_CATALOG = Object.freeze(CATALOG_ROWS.map(([id, name, implemented, why]) => Object.freeze({
  id,
  name,
  implemented,
  why,
  optional: id !== 'intent-os' && id !== 'portfolio'
})));

const catalogById = new Map(CAPABILITY_CATALOG.map((row) => [row.id, row]));

function bounded(value) {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 && n <= 100 ? n : null;
}

function normalizeMetrics(metrics) {
  if (!metrics || typeof metrics !== 'object' || Array.isArray(metrics)) return null;
  const out = {};
  for (const key of metricNames) {
    const value = bounded(metrics[key]);
    if (value == null) return null;
    out[key] = value;
  }
  return Object.freeze(out);
}

/**
 * Calculate an evidence-backed capability score. `risk` and `cost` are shown
 * as supplied, but are inverted in the aggregate because lower is better.
 */
export function scoreCapability(metrics) {
  const normalized = normalizeMetrics(metrics);
  if (!normalized) {
    return {
      schema: CAPABILITY_SCORE_SCHEMA,
      score: null,
      status: 'insufficient-evidence',
      metrics: null,
      disclaimer: 'A score is withheld until all seven bounded metrics are observed or explicitly evidenced.'
    };
  }
  const score = Math.round(
    normalized.usefulness * 0.15
    + (100 - normalized.risk) * 0.15
    + (100 - normalized.cost) * 0.10
    + normalized.reliability * 0.15
    + normalized.liquidity * 0.10
    + normalized.expectedImpact * 0.20
    + normalized.executionQuality * 0.15
  );
  return {
    schema: CAPABILITY_SCORE_SCHEMA,
    score,
    status: 'observed',
    metrics: normalized,
    disclaimer: 'Observed/evidenced capability score; it does not verify an agent and never replaces Guardian or Risk.'
  };
}

export const capabilityScore = scoreCapability;

function runtimeRow(id, runtime = {}) {
  const candidate = runtime?.[id];
  if (candidate === true) return { configured: true, operational: true, metrics: null, evidence: ['explicit-runtime-configuration'] };
  if (candidate === false) return { configured: false, operational: false, metrics: null, evidence: [] };
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
    return { configured: false, operational: false, metrics: null, evidence: [] };
  }
  return {
    configured: candidate.configured === true,
    operational: candidate.operational !== false,
    metrics: candidate.metrics || null,
    evidence: Array.isArray(candidate.evidence) ? candidate.evidence.filter((v) => typeof v === 'string').slice(0, 12) : [],
    why: typeof candidate.why === 'string' ? candidate.why.slice(0, 240) : null,
    materialImpact: candidate.materialImpact === true,
    requiresUserChoice: candidate.requiresUserChoice !== false
  };
}

function statusFor(row, runtime) {
  if (!row.implemented) return 'not-implemented';
  if (runtime.configured && runtime.operational) return 'available';
  if (runtime.configured && !runtime.operational) return 'configured-not-operational';
  return row.optional ? 'conditional' : 'unavailable';
}

/**
 * Scan every known capability. Callers pass facts from the current wallet,
 * adapter and server capability responses; no network call or hidden probe is
 * performed here.
 */
export function scanCapabilities({ runtime = {}, evidence = {}, intent = null, now = Date.now() } = {}) {
  const rows = CAPABILITY_CATALOG.map((catalog) => {
    const live = runtimeRow(catalog.id, runtime);
    const evidenceMetrics = live.metrics || evidence?.[catalog.id]?.metrics || null;
    const scored = scoreCapability(evidenceMetrics);
    const status = statusFor(catalog, live);
    const why = live.why || catalog.why;
    return {
      schema: CAPABILITY_SCANNER_SCHEMA,
      id: catalog.id,
      name: catalog.name,
      status,
      implemented: catalog.implemented,
      configured: live.configured,
      operational: live.operational,
      optional: catalog.optional,
      score: scored.score,
      scoreStatus: scored.status,
      metrics: scored.metrics,
      evidence: [...live.evidence, ...(Array.isArray(evidence?.[catalog.id]?.sources) ? evidence[catalog.id].sources.slice(0, 8) : [])],
      why,
      materialImpact: live.materialImpact === true || evidence?.[catalog.id]?.materialImpact === true,
      requiresUserChoice: live.requiresUserChoice !== false,
      intentRelevant: !intent || !Array.isArray(intent.requiredCapabilities)
        || intent.requiredCapabilities.includes(catalog.id)
        || intent.requiredCapabilities.includes('*')
    };
  });

  const recommendations = rows
    .filter((row) => row.optional && row.status === 'available' && row.materialImpact && row.requiresUserChoice)
    .map((row) => ({
      capabilityId: row.id,
      title: row.name,
      why: row.why,
      potentialBenefit: row.metrics?.expectedImpact == null ? 'Evidence indicates a material impact.' : `Expected impact score ${row.metrics.expectedImpact}/100.`,
      risk: row.metrics?.risk == null ? 'Risk must be reviewed before enabling.' : `Observed risk score ${row.metrics.risk}/100.`,
      userChoiceRequired: true,
      automaticEnable: false
    }));

  return {
    schema: CAPABILITY_SCANNER_SCHEMA,
    generatedAt: new Date(now).toISOString(),
    intent: intent?.id || null,
    capabilities: rows,
    available: rows.filter((row) => row.status === 'available'),
    conditional: rows.filter((row) => row.status === 'conditional' || row.status === 'configured-not-operational'),
    unavailable: rows.filter((row) => row.status === 'unavailable' || row.status === 'not-implemented'),
    recommendations,
    evidenceComplete: rows.filter((row) => row.scoreStatus === 'observed').length,
    scoreDisclaimer: 'Scores are bounded evidence, not predictions, guarantees or permission.'
  };
}

/** Recommendations are opt-in and only surface rows with material evidence. */
export function recommendOptionalCapabilities(scan) {
  return Array.isArray(scan?.recommendations) ? scan.recommendations.map((item) => ({ ...item, automaticEnable: false, userChoiceRequired: true })) : [];
}

/** A decline never stops the strategy; it returns safe alternatives only. */
export function replanAfterCapabilityDecline({ strategies = [], declinedCapability } = {}) {
  if (!Array.isArray(strategies)) return { ok: false, code: 'NO_STRATEGIES' };
  const id = String(declinedCapability || '');
  const alternatives = strategies.filter((strategy) => {
    const uses = Array.isArray(strategy?.uses) ? strategy.uses : [];
    const required = Array.isArray(strategy?.requiredCapabilities) ? strategy.requiredCapabilities : uses;
    return !uses.includes(id) && !required.includes(id);
  });
  if (!alternatives.length) return { ok: false, code: 'NO_SAFE_ALTERNATIVE', alternatives: [] };
  return {
    ok: true,
    declinedCapability: id,
    alternatives: alternatives.map((strategy) => ({ ...strategy })),
    automaticExecution: false,
    requiresReview: true
  };
}

export function capabilityById(id) {
  const row = catalogById.get(String(id));
  return row ? { ...row } : null;
}

/**
 * Spec 65 item 1 — honest pre-flight summary: how many capabilities exist,
 * how many are relevant to the stated intent, how many are optional, and how
 * many actually have evidence. A scan is a read-only discovery step; it never
 * activates anything.
 */
export function scanSummary(scan, { now = Date.now() } = {}) {
  if (!scan || scan.schema !== CAPABILITY_SCANNER_SCHEMA || !Array.isArray(scan.capabilities)) {
    return {
      ok: false,
      schema: CAPABILITY_SCANNER_SCHEMA,
      status: 'unavailable',
      code: 'SCAN_REQUIRED',
      total: 0, relevant: 0, optional: 0, available: 0, unavailable: 0, evidenced: 0,
      scanBeforeStart: true,
      scanIsNotActivation: true,
      summarizedAt: now
    };
  }
  const rows = scan.capabilities;
  const relevant = rows.filter((row) => row.intentRelevant === true);
  const available = rows.filter((row) => row.status === 'available');
  return {
    ok: true,
    schema: CAPABILITY_SCANNER_SCHEMA,
    status: 'scan-only',
    total: rows.length,
    relevant: relevant.length,
    relevantIds: relevant.map((row) => row.id),
    optional: rows.filter((row) => row.optional === true).length,
    available: available.length,
    unavailable: rows.filter((row) => row.status === 'unavailable' || row.status === 'not-implemented').length,
    conditional: rows.filter((row) => row.status === 'conditional' || row.status === 'configured-not-operational').length,
    evidenced: rows.filter((row) => row.scoreStatus === 'observed').length,
    scanBeforeStart: true,
    scanIsNotActivation: true,
    summarizedAt: now
  };
}

/**
 * Spec 65 item 1 — a scan must exist before an intent starts, and it must be
 * a real scan (not an empty object). Returns BLOCK when there is no scan.
 */
export function assertScanBeforeStart(scan) {
  const summary = scanSummary(scan);
  if (!summary.ok) return { ok: false, decision: 'BLOCK', code: 'PRE_START_SCAN_REQUIRED', failClosed: true, scanIsNotActivation: true };
  return { ok: true, decision: 'SCAN_ONLY', summary, scanIsNotActivation: true, executionAuthorized: false };
}
